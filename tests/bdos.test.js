// BDOS: the bitstream-resident system calls at CS=0, 0x2D4A.
//
// BDOS is not an SWI. A caller long-jumps to it with R0 = function, R1 =
// argument and R10:R11 = the return CS:PC, exactly the pair call-far and the
// game launchers use. The function stays in R0, so the jump uses another
// register pair (R2:R3 here) rather than JML R0.
//
//   0  version     -> R0 = 1, R1 = 0x4244
//   1  directory   -> R0 = 0, R1 = 0x8000 (the slice-0 image in PSRAM)
//   2  lookup      -> R1 = name pointer; R0 = first slice, or 0xFFFF
//   3  load        -> R1 = first slice; R0 = segment, R1 = entry
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, buildMemory, loadBrowserScripts, ROOT } from './helpers.js';
import { buildSlices, SCREEN_BASE, SLICE_BYTES } from '../scripts/make_slices.mjs';
import { buildPacman } from '../scripts/make_showcase.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');
const Deep16Simulator = globalThis.Deep16Simulator;

const source = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
const kernel = assemble(source, { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1, D16D: 1 } });
assert.equal(kernel.success, true, kernel.errors?.join('; '));

export const BDOS_ENTRY = 0x2D4A;
const DIR_SEG = 0x8000;
const slices = buildSlices();

test('the BDOS entry is the first word of the free kernel block', () => {
  assert.equal(kernel.symbols.bdos_entry, BDOS_ENTRY);
  // The kernel code must end before it, or the two blocks would overlap.
  const last = Math.max(...Object.entries(kernel.symbols)
    .filter(([name, v]) => typeof v === 'number' && v < BDOS_ENTRY && name !== 'bdos_entry')
    .map(([, v]) => v));
  assert.ok(last < BDOS_ENTRY, `kernel code reaches 0x${last.toString(16)}`);
});

// Call function `fn` with R1 = arg, then halt at 0x0200.
function callBdos(fn, arg = 0, { mem, flash } = {}) {
  const stub = assemble(`
        .org 0x0100
        LDI ${fn}
        MOV R8, R0            ; park the function: LDI always writes R0
        LDI ${arg}
        MOV R9, R0            ; park the argument
        LSI R2, 0
        MOV R10, R2           ; return CS = 0
        LDI 0x0200
        MOV R11, R0           ; return PC = 0x0200
        LDI 0x2D4A
        MOV R3, R0            ; jump PC
        LSI R2, 0             ; jump CS = 0
        MOV R1, R9
        MOV R0, R8
        JML R2
        NOP
        .org 0x0200
        HALT
  `);
  assert.equal(stub.success, true, stub.errors?.join('; '));
  const image = mem || buildMemory(kernel);
  for (const c of stub.memoryChanges) image[c.address] = c.value & 0xFFFF;
  const sim = new Deep16Simulator();
  sim.loadProgram(image);
  sim.spiFlash.mem.set(flash || slices.bytes, SCREEN_BASE);
  Object.assign(sim.segmentRegisters, { CS: 0, DS: 0, SS: 0, ES: 0 });
  sim.registers[15] = 0x0100;
  sim.running = true;
  for (let i = 0; i < 8_000_000 && sim.running; i++) sim.step();
  assert.equal(sim.running, false, 'the call returned to the halt at 0x0200');
  return { sim, r0: sim.registers[0] & 0xFFFF, r1: sim.registers[1] & 0xFFFF };
}

function putWord(bytes, slice, cell, value) {
  const o = slice * SLICE_BYTES + cell * 2;
  bytes[o] = value & 0xFF;
  bytes[o + 1] = (value >> 8) & 0xFF;
}

test('function 0 returns the version and the signature', () => {
  const { r0, r1 } = callBdos(0);
  assert.equal(r0, 1);
  assert.equal(r1, 0x4244);
});

test('an unknown function returns 0xFFFF with an error code', () => {
  const { r0, r1 } = callBdos(99);
  assert.equal(r0, 0xFFFF);
  assert.equal(r1, 1);
});

test('function 1 reads the directory into segment 0x8000', () => {
  const { r0, r1, sim } = callBdos(1);
  assert.equal(r0, 0, 'offset 0');
  assert.equal(r1, DIR_SEG, 'segment 0x8000');
  const at = (w) => sim.memory[(DIR_SEG << 4) + w] & 0xFFFF;
  assert.equal(at(0) & 0x7000, 0x5000, 'slice-0 header magic');
  // first entry: type 3 (screen), first slice 1, name "sd" (two chars a cell)
  assert.equal(at(8), 0x0003);
  assert.equal(at(9), 1);
  assert.equal(at(10), 's'.charCodeAt(0) | ('d'.charCodeAt(0) << 8));
});

test('function 2 finds a name and reports a miss', () => {
  const mem = buildMemory(kernel);
  for (const [i, ch] of [...'pacman'].entries()) mem[0x0400 + i] = ch.charCodeAt(0);
  mem[0x0406] = 0;
  const hit = callBdos(2, 0x0400, { mem });
  assert.equal(hit.r0, 11, 'pacman is slice 11');
  assert.equal(hit.r1, 0);

  const missMem = buildMemory(kernel);
  for (const [i, ch] of [...'nope'].entries()) missMem[0x0400 + i] = ch.charCodeAt(0);
  missMem[0x0404] = 0;
  const out = callBdos(2, 0x0400, { mem: missMem });
  assert.equal(out.r0, 0xFFFF);
  assert.equal(out.r1, 2);
});

test('function 3 loads a type-4 block into its segment', () => {
  const pac = buildPacman();
  const { r0, r1, sim } = callBdos(3, 11);
  assert.equal(r0, 0x2000, 'the segment in the slice header');
  assert.equal(r1, pac.entry);
  const base = r0 << 4;
  for (const [addr, value] of pac.words.slice(0, 8)) {
    assert.equal(sim.memory[base + addr] & 0xFFFF, value, `word ${addr}`);
  }
});

test('function 3 follows a continuation slice', () => {
  // A two-slice block of 2100 words at segment 0x4000: slice 1 carries the
  // five header cells and the first 2035 words, slice 2 the other 65.
  const words = Array.from({ length: 2100 }, (_, i) => (0x1000 + i) & 0xFFFF);
  const payload = [0xD16B, 1, 0, words.length, 0x4000, ...words];
  const flash = new Uint8Array(SLICE_BYTES * 4).fill(0xFF);
  putWord(flash, 1, 0, 0x5004);          // type 4, magic 5
  putWord(flash, 1, 1, 2);               // link
  putWord(flash, 1, 2, 'b' | ('i' << 8));
  putWord(flash, 2, 0, 0x5000);          // continuation: type 0
  putWord(flash, 2, 1, 0xFFFF);
  putWord(flash, 2, 2, 'b' | ('i' << 8));
  for (let i = 0; i < Math.min(payload.length, 2040); i++) putWord(flash, 1, 8 + i, payload[i]);
  for (let i = 2040; i < payload.length; i++) putWord(flash, 2, 8 + (i - 2040), payload[i]);

  const { r0, r1, sim } = callBdos(3, 1, { flash });
  assert.equal(r0, 0x4000, 'the second slice is pulled in through the link');
  assert.equal(r1, 0);
  const base = 0x4000 << 4;
  for (const i of [0, 2034, 2035, 2099]) {
    assert.equal(sim.memory[base + i] & 0xFFFF, words[i], `word ${i}`);
  }
});

test('function 3 rejects a block with a bad magic', () => {
  const flash = new Uint8Array(SLICE_BYTES * 2).fill(0xFF);
  putWord(flash, 1, 0, 0x5004);
  putWord(flash, 1, 1, 0xFFFF);
  putWord(flash, 1, 8, 0x1234);          // not 0xD16B
  const { r0, r1 } = callBdos(3, 1, { flash });
  assert.equal(r0, 0xFFFF);
  assert.equal(r1, 3);
});
