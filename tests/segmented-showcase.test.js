// D16SEG + showcase: the menu runs in the BIOS shadow bank, and its BDOS
// bridge must still find and load a game. Q returns through gfx_back to the
// normal bank and the boot loader. The flat showcase test cannot cover this:
// the shadow bank and the segmented SPI path are what the board uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, MEM_WORDS, ROOT } from './helpers.js';
import { buildShowcase, SHOWCASE_SEG_BASE } from '../scripts/make_showcase.mjs';
import { buildSlices, SCREEN_BASE } from '../scripts/make_slices.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const WINDOW = 0x6000, DS_SEG = 0x1000, BIOS_SEG = 0x3000;
const DS_LO = 0x3000, DS_HI = 0x57dc, BIOS_LO = 0x4a00, BIOS_HI = 0x5fff;
const TILE = 0xF1000;
const glyph = (ch) => (ch.charCodeAt(0) - 0x20) * 32;
const cell = (row, col) => TILE + row * 82 + col;
const MENU_GSEG = 0x4A00 + 0x4E1;

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
  { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1, D16D: 1 } });
assert.equal(kernel.success, true, kernel.errors?.join('; '));
const showcase = buildShowcase();
const slices = buildSlices();

function bootShowcase() {
  const sim = new globalThis.Deep16Simulator();
  const mem = new Array(MEM_WORDS).fill(0xffff);
  for (const c of kernel.memoryChanges) if (c.address < WINDOW) mem[c.address] = c.value & 0xffff;
  for (const [addr, value] of showcase.words) mem[SHOWCASE_SEG_BASE + addr] = value;
  const img = (a) => mem[a];
  for (let w = DS_LO; w <= DS_HI; w++) mem[(DS_SEG << 4) + w] = img(w);
  for (let w = BIOS_LO; w <= BIOS_HI; w++) mem[(BIOS_SEG << 4) + (w - BIOS_LO)] = img(w);
  sim.loadProgram(mem);
  sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);
  // Mirror the tile console to the UART so the test can read the text. The
  // hardware build has CONSOLE_MIRROR off, which is exactly the put_char path
  // whose R2 clobber broke TYPE.
  sim.memory[0xF0064] = 0x80;
  sim.segmentRegisters.CS = 0xffff;
  sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0;
  sim.segmentRegisters.ES = 0;
  sim.running = true;
  let text = '';
  const step = () => {
    sim.step();
    if (sim.uartTx.length) text += String.fromCharCode(...sim.uartTxTake());
  };
  for (let i = 0; i < 60_000_000 && (sim.memory[cell(19, 29)] & 0x0FFF) !== glyph('A'); i++) step();
  assert.equal(sim.memory[cell(19, 29)] & 0x0FFF, glyph('A'), 'menu finished drawing');
  return { sim, step, text: () => text };
}

test('a game chosen from the D16SEG menu loads and enters its segment', () => {
  const { sim, step } = bootShowcase();
  sim.kbdBuffer.push(0x46);                        // F: Flappy
  for (let i = 0; i < 20_000_000 && (sim.memory[MENU_GSEG] & 0xFFFF) !== 0x5000; i++) step();
  assert.equal(sim.memory[MENU_GSEG] & 0xFFFF, 0x5000, 'BDOS loaded Flappy into segment 0x5000');
  for (let i = 0; i < 20_000_000 && sim.segmentRegisters.CS !== 0x5000; i++) step();
  assert.equal(sim.segmentRegisters.CS, 0x5000, 'the kernel entered the game segment');
  assert.ok(sim.running);
});

test('Q returns from the D16SEG menu to a clean Forth prompt', () => {
  const { sim, step, text } = bootShowcase();
  sim.memory[0xF0064] = 0x81;                      // echo/mirror bit for the boot script
  sim.kbdBuffer.push(0x51);                        // Q: Forth
  const from = text().length;
  for (let i = 0; i < 20_000_000 && !text().slice(from).includes('> '); i++) step();
  assert.match(text().slice(from), /Loading essentials/);
  assert.doesNotMatch(text().slice(from), /UUUUUU/);
  sim.memory[0xF0064] = 0x81;                      // keep the mirror on for the result
  for (const ch of '2 2 + .\r') sim.kbdBuffer.push(ch.charCodeAt(0));
  const calc = text().length;
  for (let i = 0; i < 10_000_000 && !text().slice(calc).includes(' 4 '); i++) step();
  assert.match(text().slice(calc), / 4 /);
  assert.ok(sim.running);
});
