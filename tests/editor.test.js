// The native editor (EDITPLAN): a type-4 slice at segment 0x0800 with its data
// in segment 0x0900. This boots the editor directly, feeds the name prompt and
// edit keys, and checks the screen and the saved config-flash slice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, buildMemory, loadBrowserScripts, ROOT } from './helpers.js';
import { buildSlices, SCREEN_BASE, SLICE_BYTES } from '../scripts/make_slices.mjs';
import { buildEditor } from '../scripts/make_showcase.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1, D16D: 1 } });
assert.equal(kernel.success, true, kernel.errors?.join('; '));
const editor = buildEditor();
const slices = buildSlices();
const hello = slices.manifest.objects.hello;
const ED_SEG = 0x0800;
const DATA_SEG = 0x0900;

function boot() {
  const mem = buildMemory(kernel);
  for (const [addr, value] of editor.words) mem[(ED_SEG << 4) + addr] = value;
  mem[0x0200] = 0xFFFF;                 // HALT: the far-call return
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(mem);
  sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);
  Object.assign(sim.segmentRegisters, { CS: ED_SEG, DS: DATA_SEG, SS: DATA_SEG, ES: 0 });
  sim.registers[13] = 0xD000;
  sim.registers[10] = 0;
  sim.registers[11] = 0x0200;
  sim.registers[15] = 0;
  sim.running = true;
  return sim;
}

function typeKeys(sim, text) {
  for (const ch of text) sim.kbdBuffer.push(ch.charCodeAt(0));
}

test('the editor loads a slice, edits it, saves it and exits', () => {
  const sim = boot();
  const shell = 'hello\n';
  const keys = [0x05, '!'.charCodeAt(0), 0x13, 0x11];   // End, !, ^S, ^Q
  typeKeys(sim, shell);
  for (const k of keys) sim.kbdBuffer.push(k);

  let steps = 0;
  while (sim.running && steps < 30_000_000) {
    sim.step();
    steps++;
  }
  assert.equal(sim.running, false, 'the editor returned to the halt at 0x0200');

  // The first text row shows the hello source.
  const cell = (row, col) => sim.memory[0xF1000 + row * 82 + col] & 0xFFFF;
  const firstLine = slices.bytes.subarray(
    hello.first * SLICE_BYTES + 16, hello.first * SLICE_BYTES + 16 + 80);
  assert.equal(cell(0, 0), 0x8000 | (firstLine[0] - 32), 'row 0 starts with the file');
  assert.equal(cell(0, 2), 0x8000 | (firstLine[4] - 32), 'row 0 col 2');

  // '!' landed at the end of the first line.
  const off = SCREEN_BASE + hello.first * SLICE_BYTES;
  const words = [];
  for (let i = 0; i < 2048; i++) words.push(sim.spiFlash.mem[off + i * 2] | (sim.spiFlash.mem[off + i * 2 + 1] << 8));
  assert.equal(words[0], 0x5003, 'the saved slice is still type 3');
  assert.equal(words[1], 0xFFFF, 'single-slice file');
  const lineEnd = words.slice(8, 8 + 200).indexOf(10);
  assert.ok(lineEnd > 0, 'the first line has a newline');
  assert.equal(words[8 + lineEnd - 1], '!'.charCodeAt(0), 'the edit was written back');
});

test('the editor draws and saves a German character', () => {
  const sim = boot();
  typeKeys(sim, 'hello\n');
  for (const k of [0x05, 0xE4, 0x13, 0x11]) sim.kbdBuffer.push(k);

  let steps = 0;
  while (sim.running && steps < 30_000_000) { sim.step(); steps++; }
  assert.equal(sim.running, false, 'the editor returned to the halt at 0x0200');

  let found = false;
  for (let r = 0; r < 24 && !found; r++) {
    for (let c = 0; c < 80; c++) {
      if ((sim.memory[0xF1000 + r * 82 + c] & 0x1FF) === 100) { found = true; break; }
    }
  }
  assert.ok(found, 'the ä uses glyph slot 100 on the screen');

  const off = SCREEN_BASE + hello.first * SLICE_BYTES;
  let saved = false;
  for (let i = 0; i < 2040; i++) {
    if ((sim.spiFlash.mem[off + i * 2] | (sim.spiFlash.mem[off + i * 2 + 1] << 8)) === 0xE4) {
      saved = true;
      break;
    }
  }
  assert.ok(saved, 'the saved slice carries the Latin-1 byte 0xE4');
});
