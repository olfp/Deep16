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

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, D16D: 1 } });
const showcase = buildShowcase();

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
  while (sim.running && steps < 400000 && sim.memory[cell(19, 29)] !== glyph('A')) {
    sim.step();
    steps++;
  }
  assert.equal(sim.memory[cell(19, 29)], glyph('A'), 'menu finished drawing');
  assert.equal(sim.memory[cell(5, 34)], glyph('D'), 'menu title was drawn');
  return steps;
}

test('the board boots into the Flappy / Forth menu', () => {
  assert.ok(kernel.success, kernel.errors.join('; '));
  const sim = boot();
  toMenu(sim);
  assert.equal(sim.memory[cell(5, 35)], glyph('1'), 'D16 title');
  assert.equal(sim.memory[cell(5, 44)], glyph('9'), 'SHOW 29');
  assert.equal(sim.memory[cell(10, 30)], glyph('F'), 'F FLAPPY');
  assert.equal(sim.memory[cell(12, 30)], glyph('Q'), 'Q FORTH');
  assert.equal(sim.memory[cell(19, 29)], glyph('A'), 'AUTORUN');
});

test('Q returns from the menu to the Forth console', () => {
  const sim = boot();
  let steps = toMenu(sim);
  sim.uartRxPush(0x51);                       // Q
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

test('the idle menu autoruns Flappy after ten seconds', () => {
  const sim = boot();
  let steps = toMenu(sim);
  let frame = 0;
  let bit = 1;
  while (sim.running && steps < 4000000 && sim.memory[0x4ED6] !== 3) {
    if (steps % FRAME_PERIOD === 0) {
      bit ^= 1;
      sim.memory[0xF0066] = (sim.memory[0xF0066] & ~2) | (bit << 1);
      frame++;
    }
    sim.step();
    steps++;
  }
  assert.equal(sim.memory[0x4ED6], 3, 'attract mode started');
  assert.equal(sim.memory[0x4ED5], 1, 'the menu launched in attract mode');
  assert.ok(frame >= 600, `idle timer ran ${frame} frames`);
});
