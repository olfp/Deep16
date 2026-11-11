// The D16D board boots straight into the showcase menu: Flappy, Forth, or
// Flappy automatically after ten seconds. This boots the nano kernel plus the
// showcase block and checks the menu cells, Q to the console, and the idle
// timer launching attract mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, buildMemory, ROOT } from './helpers.js';
import { buildShowcase, SHOWCASE_SEG_BASE } from '../scripts/make_showcase.mjs';
import { buildSlices, SCREEN_BASE } from '../scripts/make_slices.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, D16D: 1,
                                     CONSOLE_MIRROR: 1 } });
const showcase = buildShowcase();
const slices = buildSlices();
const GB = 0x50000;                    // Flappy's slice segment 0x5000

const TILE = 0xF1000;
const cell = (row, col) => TILE + row * 82 + col;
const glyph = (ch) => (ch.charCodeAt(0) - 0x20) * 32;
const FRAME_PERIOD = 0x1000;

function boot() {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  const mem = buildMemory(kernel);
  for (const [addr, value] of showcase.words) mem[SHOWCASE_SEG_BASE + addr] = value;
  sim.loadProgram(mem);
  sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);   // BDOS loads the games
  sim.memory[kernel.symbols.boot_ptr] = 0;   // no baked demo script
  sim.segmentRegisters.CS = 0xFFFF;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  sim.running = true;
  return sim;
}

function toMenu(sim) {
  let steps = 0;
  // The menu draws the title, F, Q and finally the autorun line; waiting for
  // the last one means the whole menu is on screen and the wait loop started.
  while (sim.running && steps < 400000 && (sim.memory[cell(19, 29)] & 0x0FFF) !== glyph('A')) {
    sim.step();
    steps++;
  }
  assert.equal(sim.memory[cell(19, 29)] & 0x0FFF, glyph('A'), 'menu finished drawing');
  assert.equal(sim.memory[cell(5, 34)] & 0x0FFF, glyph('D'), 'menu title was drawn');
  return steps;
}

test('the board boots into the Flappy / Forth menu', () => {
  assert.ok(kernel.success, kernel.errors.join('; '));
  const sim = boot();
  toMenu(sim);
  assert.equal(sim.memory[cell(5, 35)] & 0x0FFF, glyph('1'), 'D16 title');
  assert.equal(sim.memory[cell(5, 44)] & 0x0FFF, glyph('9'), 'SHOW 29');
  assert.equal(sim.memory[cell(10, 30)] & 0x0FFF, glyph('F'), 'F FLAPPY');
  assert.equal(sim.memory[cell(12, 30)] & 0x0FFF, glyph('Q'), 'Q FORTH');
  assert.equal(sim.memory[cell(19, 29)] & 0x0FFF, glyph('A'), 'AUTORUN');
});

test('Q returns from the menu to the Forth console', () => {
  const sim = boot();
  let steps = toMenu(sim);
  sim.kbdBuffer.push(0x51);                       // Q
  let text = '';
  while (sim.running && steps < 1500000) {
    sim.step();
    steps++;
    if (sim.uartTx.length) text += sim.uartTx.splice(0).map((b) => String.fromCharCode(b)).join('');
    if (text.includes('Hello DeepForth!')) break;
  }
  assert.match(text, /Hello DeepForth!/, 'the console banner reached the UART');
  // gfx_back must home the console cursor cells, not just clear the tilemap.
  const topLeft = sim.memory[cell(0, 0)] & 0xFFFF;
  assert.equal(topLeft & 0x0FFF, glyph('H'), 'the console starts at the top-left after Q');
});

// Drive the machine until pred() holds, collecting the UART text. Returns
// the steps used so the callers can keep one overall budget.
function runText(sim, pred, cap, onText = () => {}) {
  let steps = 0;
  while (sim.running && steps < cap && !pred()) {
    sim.step();
    steps++;
    if (sim.uartTx.length) {
      const text = sim.uartTx.splice(0).map((b) => String.fromCharCode(b)).join('');
      onText(text);
    }
  }
  return steps;
}

test('gfx from the console launches the game the menu picks', () => {
  // The menu's game request is handled by the kernel loop at boot. Entering
  // the menu with the `gfx` word must use that same loop, otherwise selecting
  // a game just returns to the prompt.
  const sim = boot();
  let steps = toMenu(sim);
  sim.kbdBuffer.push(0x51);                        // Q: console
  let text = '';
  steps += runText(sim, () => text.includes('> '), 1500000, (t) => { text += t; });
  assert.match(text, /Hello DeepForth!/, 'the console started');

  for (const ch of 'gfx\r') sim.kbdBuffer.push(ch.charCodeAt(0));
  steps += runText(sim, () => (sim.memory[cell(19, 29)] & 0x0FFF) === glyph('A'), 2000000);
  assert.equal(sim.memory[cell(19, 29)] & 0x0FFF, glyph('A'), 'gfx drew the menu again');

  sim.kbdBuffer.push(0x46);                        // F: Flappy
  steps += runText(sim, () => sim.segmentRegisters.CS === 0x5000, 2000000);
  assert.equal(sim.segmentRegisters.CS, 0x5000, 'Flappy is running from the console gfx');
});

test('a game may use R13/SP and still leave the Forth stack intact', () => {
  // Frogger uses R13 as a scratch register. The kernel must save SP around
  // the game far-call, or the next Forth word (dir's first slice) underflows.
  const sim = boot();
  let steps = toMenu(sim);
  sim.kbdBuffer.push(0x51);
  let text = '';
  steps += runText(sim, () => text.includes('> '), 1500000, (t) => { text += t; });
  const sp = sim.registers[13];
  const spTop = sim.memory[kernel.symbols.sp_top];
  assert.equal(sp, spTop, 'the console starts on the kernel stack top');

  for (const ch of 'gfx\r') sim.kbdBuffer.push(ch.charCodeAt(0));
  steps += runText(sim, () => (sim.memory[cell(19, 29)] & 0x0FFF) === glyph('A'), 2000000);
  sim.kbdBuffer.push(0x67);                        // g: Frogger
  steps += runText(sim, () => sim.segmentRegisters.CS === 0x0600, 2000000);
  assert.equal(sim.segmentRegisters.CS, 0x0600, 'Frogger is running');

  // Drive the frame bit and Q often enough to leave the game.
  const ready = () => (sim.memory[cell(19, 29)] & 0x0FFF) === glyph('A');
  let bit = 1;
  let back = false;
  for (let i = 0; i < 8000000; i++) {
    if (i % FRAME_PERIOD === 0) {
      bit ^= 1;
      sim.memory[0xF0066] = (sim.memory[0xF0066] & ~2) | (bit << 1);
    }
    if (i % 200000 === 0 && sim.kbdBuffer.length === 0) sim.kbdBuffer.push(0x51);
    sim.step();
    steps++;
    if (ready()) { back = true; break; }
  }
  assert.ok(back, 'the game returned to the menu');
  assert.equal(sim.registers[13], sp, 'SP is back after the game');
  assert.equal(sim.segmentRegisters.DS, 0, 'DS is back after the game');
});

test('Q in the gfx menu returns to a working Forth prompt', () => {
  const sim = boot();
  toMenu(sim);
  sim.kbdBuffer.push(0x51);                        // Q: console
  let text = '';
  runText(sim, () => text.includes('> '), 1500000, (t) => { text += t; });

  for (const ch of 'gfx\r') sim.kbdBuffer.push(ch.charCodeAt(0));
  runText(sim, () => (sim.memory[cell(19, 29)] & 0x0FFF) === glyph('A'), 2000000);
  const from = text.length;
  sim.kbdBuffer.push(0x51);                        // Q: back to the prompt
  runText(sim, () => text.slice(from).includes('> '), 1000000, (t) => { text += t; });
  assert.equal(sim.segmentRegisters.CS, 0, 'the console is back in the kernel segment');

  for (const ch of '2 2 + .\r') sim.kbdBuffer.push(ch.charCodeAt(0));
  const calc = text.length;
  runText(sim, () => text.slice(calc).includes(' 4 '), 2000000, (t) => { text += t; });
  assert.match(text.slice(calc), / 4 /, 'the interpreter still consumes a line after gfx');
});

test('the idle menu autoruns Flappy after ten seconds', () => {
  const sim = boot();
  let steps = toMenu(sim);
  let frame = 0;
  let bit = 1;
  while (sim.running && steps < 4000000 && sim.memory[GB + 0x4D6] !== 3) {
    if (steps % FRAME_PERIOD === 0) {
      bit ^= 1;
      sim.memory[0xF0066] = (sim.memory[0xF0066] & ~2) | (bit << 1);
      frame++;
    }
    sim.step();
    steps++;
  }
  assert.equal(sim.memory[GB + 0x4D6], 3, 'attract mode started');
  assert.equal(sim.memory[GB + 0x4D5], 1, 'the menu launched in attract mode');
  assert.ok(frame >= 600, `idle timer ran ${frame} frames`);
});
