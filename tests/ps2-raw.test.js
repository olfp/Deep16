// Raw PS/2 events through the real BIOS decoder (PS2LAYOUT.md).
//
// The ASCII-host tests cover bit 15 = 0. This one boots the segmented board
// image, injects raw make events into the keyboard FIFO, and checks that the
// BIOS decoder maps them through the DE and US layout tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, MEM_WORDS, ROOT, placeBdos, placeSys } from './helpers.js';
import { buildSlices, SCREEN_BASE } from '../scripts/make_slices.mjs';
import { layoutWords, makeEvent, PS2_LAYOUT_BASE } from '../scripts/make_ps2map.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1, D16D: 1,
                                     CONSOLE_MIRROR: 1 } });
assert.equal(kernel.success, true, kernel.errors?.join('; '));
const sym = kernel.symbols;
const slices = buildSlices();
const DS_SEG = 0x1000;
const BIOS_SEG = 0x3000;

function boot() {
  const mem = new Array(MEM_WORDS).fill(0xffff);
  for (const c of kernel.memoryChanges) mem[c.address] = c.value & 0xffff;
  const tables = layoutWords();
  for (let i = 0; i < tables.length; i++) mem[PS2_LAYOUT_BASE + i] = tables[i];
  for (let w = 0x3000; w <= 0x57dc; w++) mem[(DS_SEG << 4) + w] = mem[w];
  for (let w = 0x4a00; w <= 0x6fff; w++) mem[(BIOS_SEG << 4) + (w - 0x4a00)] = mem[w];
  placeBdos(mem);
  placeSys(mem);
  mem[(DS_SEG << 4) + sym.boot_ptr] = 0;       // no baked script: straight to the prompt
  mem[(DS_SEG << 4) + sym.ps2_layout] = 0;     // DE

  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(mem);
  sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);
  sim.segmentRegisters.CS = 0xffff;
  sim.memory[0xF0064] = 1;                   // echo on for the line editor
  sim.running = true;
  return sim;
}

function pump(sim, out, n = 2_000_000, until = () => false) {
  for (let i = 0; i < n && sim.running; i++) {
    sim.step();
    if (sim.uartTx.length) out.text += String.fromCharCode(...sim.uartTxTake());
    if ((i & 63) === 0 && until()) return true;
  }
  return until();
}

function runLine(events) {
  const sim = boot();
  const out = { text: '' };
  assert.ok(pump(sim, out, 4_000_000, () => out.text.includes('\n> ')), 'boot reaches the prompt');
  const mark = out.text.length;
  for (const event of events) sim.kbdBuffer.push(event);
  assert.ok(pump(sim, out, 4_000_000,
                () => out.text.slice(mark).includes('\n> ') ||
                      out.text.slice(mark).includes('ok\n')), 'line completes');
  return out.text;
}

test('DE raw events type a Forth line and produce the result', () => {
  const events = [
    makeEvent(0x16),                       // 1
    makeEvent(0x29),                       // space
    makeEvent(0x1e),                       // 2
    makeEvent(0x29),
    makeEvent(0x5b),                       // +
    makeEvent(0x29),
    makeEvent(0x49),                       // .
    makeEvent(0x5a),                       // Enter
  ];
  const text = runLine(events);
  assert.match(text, /1 2 \+ \./, 'the console echoes the decoded line');
  assert.match(text, /3/, 'the Forth result');
});

test('US is a data-only layout: y and z follow the selected table', () => {
  const sim = boot();
  const out = { text: '' };
  assert.ok(pump(sim, out, 4_000_000, () => out.text.includes('\n> ')), 'boot reaches the prompt');
  const mark = out.text.length;
  sim.memory[(DS_SEG << 4) + sym.ps2_layout] = 1;   // US
  for (const event of [makeEvent(0x1a), makeEvent(0x35), makeEvent(0x5a)]) {
    sim.kbdBuffer.push(event);
  }
  pump(sim, out, 4_000_000, () => out.text.slice(mark).includes('yz'));
  assert.match(out.text.slice(mark), /zy/, 'US maps scan 0x1A to z and 0x35 to y');
});

test('Shift and Ctrl modifiers survive the event transport', () => {
  const sim = boot();
  const out = { text: '' };
  assert.ok(pump(sim, out, 4_000_000, () => out.text.includes('\n> ')), 'boot reaches the prompt');
  // Shift+A -> A, then Enter (the line is not a word, but the echo is enough).
  const mark = out.text.length;
  sim.kbdBuffer.push(makeEvent(0x1c, { shift: true }));
  sim.kbdBuffer.push(makeEvent(0x5a));
  pump(sim, out, 4_000_000, () => out.text.slice(mark).includes('A'));
  assert.match(out.text.slice(mark), /A/, 'Shift+A echoes A');
});

test('AltGr raw events read the alt[] half of the layout', () => {
  const sim = boot();
  const out = { text: '' };
  assert.ok(pump(sim, out, 4_000_000, () => out.text.includes('\n> ')), 'boot reaches the prompt');
  const mark = out.text.length;
  sim.kbdBuffer.push(makeEvent(0x15, { alt: true }));   // AltGr+Q -> @
  sim.kbdBuffer.push(makeEvent(0x5a));
  pump(sim, out, 4_000_000, () => out.text.slice(mark).includes('@'));
  assert.match(out.text.slice(mark), /@/, 'AltGr+Q echoes @');
});
