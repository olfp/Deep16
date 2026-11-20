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
//  11  read-slice  -> R1 = slice, R4 = dest in the caller's DS; R0 = 0
//  12  spi-ctrl    -> R1 = control, R4 = divider (BIOS f20)
//  13  spi-xfer    -> R1 = byte; R0 = received byte (BIOS f21/f22)
//  14  palette     -> R1 = bank*8+pair, R4 = background | ink<<8
//  15  i2s-write   -> R1 = sample
//  16  i2s-ctrl    -> R1 = control
//  17  i2s-read    -> R0 = status, R1 = level
//  18  sic-enable  -> R1 = mask; 19 reads it back into R0
//  20  sic-pending -> R1 = mask
//  21  snd-write   -> R1 = offset, R4 = value; 22 reads it back into R0
//  23  snd-copy    -> R1 = source in DS, R4 = destination; bd_count cells
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
function callBdos(fn, arg = 0, { mem, flash, arg4 = 0 } = {}) {
  const stub = assemble(`
        .org 0x0100
        LDI ${arg4}
        MOV R4, R0            ; fourth argument (read-slice destination)
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
  // BDOS now polls SPI through the BIOS SWIs; give it the segmented BIOS copy
  // and the SWI vector, like the board/flash loader does.
  for (let w = 0x4a00; w <= 0x57ff; w++) image[(0x3000 << 4) + (w - 0x4a00)] = image[w];
  image[2] = kernel.symbols.swi_to_bios;
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
  // first entry: type 3 (text), first slice 1, name "start" (two chars a cell)
  assert.equal(at(8), 0x0003);
  assert.equal(at(9), 1);
  assert.equal(at(10), 's'.charCodeAt(0) | ('t'.charCodeAt(0) << 8));
});

test('function 2 finds a name and reports a miss', () => {
  const mem = buildMemory(kernel);
  for (const [i, ch] of [...'pacman'].entries()) mem[0x0400 + i] = ch.charCodeAt(0);
  mem[0x0406] = 0;
  const hit = callBdos(2, 0x0400, { mem });
  assert.equal(hit.r0, slices.manifest.objects.pacman.first, 'pacman is the first pacman slice');
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
  const { r0, r1, sim } = callBdos(3, slices.manifest.objects.pacman.first);
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

test('a second load starts at offset 0 in its own segment', () => {
  // bd_off is a scratch cell. Leaving it at the first game's word count made
  // the second load copy past the start of its segment and return success
  // with the entry still 0xFFFF: the menu then jumped to a halt word.
  const stub = assemble(`
        .org 0x0100
        LSI R8, 3
        LDI ${slices.manifest.objects.pacman.first}
        MOV R9, R0
        LSI R2, 0
        MOV R10, R2
        LDI 0x0200
        MOV R11, R0
        LDI 0x2D4A
        MOV R3, R0
        LSI R2, 0
        MOV R1, R9
        MOV R0, R8
        JML R2
        NOP
        .org 0x0200
        LSI R8, 3
        LDI ${slices.manifest.objects.flappy.first}
        MOV R9, R0
        LSI R2, 0
        MOV R10, R2
        LDI 0x0300
        MOV R11, R0
        LDI 0x2D4A
        MOV R3, R0
        LSI R2, 0
        MOV R1, R9
        MOV R0, R8
        JML R2
        NOP
        .org 0x0300
        HALT
  `);
  assert.equal(stub.success, true, stub.errors?.join('; '));
  const image = buildMemory(kernel);
  for (let w = 0x4a00; w <= 0x57ff; w++) image[(0x3000 << 4) + (w - 0x4a00)] = image[w];
  image[2] = kernel.symbols.swi_to_bios;
  for (const c of stub.memoryChanges) image[c.address] = c.value & 0xFFFF;
  const sim = new Deep16Simulator();
  sim.loadProgram(image);
  sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);
  Object.assign(sim.segmentRegisters, { CS: 0, DS: 0, SS: 0, ES: 0 });
  sim.registers[15] = 0x0100;
  sim.running = true;
  for (let i = 0; i < 16_000_000 && sim.running; i++) sim.step();
  assert.equal(sim.running, false, 'both loads returned to the halt');
  // Both games begin with `MVS R0, CS` (0xFF00). A stale bd_off leaves the
  // second segment's first word at the erased value 0xFFFF.
  assert.equal(sim.memory[0x2000 << 4] & 0xFFFF, 0xFF00, 'Pac-Man at offset 0');
  assert.equal(sim.memory[0x5000 << 4] & 0xFFFF, 0xFF00, 'Flappy at offset 0');
});

test('function 4 (fopen) finds a name like lookup', () => {
  const mem = buildMemory(kernel);
  for (const [i, ch] of [...'pacman'].entries()) mem[0x0400 + i] = ch.charCodeAt(0);
  mem[0x0406] = 0;
  const hit = callBdos(4, 0x0400, { mem });
  assert.equal(hit.r0, slices.manifest.objects.pacman.first, 'fopen returns the first slice as handle');
  assert.equal(hit.r1, 0, 'fopen reports success in R1');

  const missMem = buildMemory(kernel);
  for (const [i, ch] of [...'nope'].entries()) missMem[0x0400 + i] = ch.charCodeAt(0);
  missMem[0x0404] = 0;
  const miss = callBdos(4, 0x0400, { mem: missMem });
  assert.equal(miss.r0, 0xFFFF, 'fopen reports not found');
});

test('function 5 (fclose) returns success', () => {
  const { r0, r1 } = callBdos(5, 1);
  assert.equal(r0, 0);
  assert.equal(r1, 0);
});

test('function 6 (fread) loads a slice like function 3', () => {
  const pac = buildPacman();
  const { r0, r1 } = callBdos(6, slices.manifest.objects.pacman.first);
  assert.equal(r0, 0x2000, 'fread returns the segment from the slice header');
  assert.equal(r1, pac.entry, 'fread returns the entry point');
});

test('function 7 (fwrite) is not implemented yet', () => {
  const { r0, r1 } = callBdos(7, 1);
  assert.equal(r0, 0xFFFF);
  assert.equal(r1, 4);
});

test('function 11 reads a source slice into callers DS and keeps ES', () => {
  const helloFirst = slices.manifest.objects.hello.first;
  const dest = 0x2000;                  // free during this halted stub
  const { r0, r1, sim } = callBdos(11, helloFirst, { arg4: dest });
  assert.equal(r0, 0);
  assert.equal(r1, 0);
  assert.equal(sim.segmentRegisters.ES, 0, 'ES is restored (0xF000 for the console)');
  assert.equal(sim.segmentRegisters.DS, 0, 'DS is restored');
  const off = helloFirst * SLICE_BYTES;
  for (const cell of [0, 1, 2, 8, 8 + 31, 2047]) {
    const want = slices.bytes[off + cell * 2] | (slices.bytes[off + cell * 2 + 1] << 8);
    assert.equal(sim.memory[dest + cell] & 0xFFFF, want, `word ${cell}`);
  }
});

test('functions 12/13 set the SPI bus and transfer a byte', () => {
  // The essentials SPI words no longer touch 0xF0080..0xF0086. Function 12
  // programs CS/divider through BIOS f20, and function 13 sends one byte
  // through f21 and returns the byte f22 read when the bus went ready.
  // Select CS1 (config flash), send 0x9F and read the first ID byte.
  const stub = assemble(`
        .org 0x0100
        LSI R2, 0
        MOV R10, R2            ; return CS = 0
        LDI 0x0110
        MOV R11, R0
        LDI 0x2D4A
        MOV R3, R0
        LSI R2, 0
        LSI R1, 2              ; control: CS1 asserted
        LSI R4, 0              ; divider
        LSI R0, 12
        JML R2
        NOP
        .org 0x0110
        LDI 0x0400
        MOV R9, R0             ; result destination
        LDI 0x9F
        MOV R1, R0
        LSI R2, 0
        MOV R10, R2
        LDI 0x0120
        MOV R11, R0
        LDI 0x2D4A
        MOV R3, R0
        LSI R2, 0
        LSI R0, 13
        JML R2
        NOP
        .org 0x0120
        MOV R2, R9
        ST R0, R2, 0           ; the 0x9F exchange returns 0xFF
        LDI 0x0402
        MOV R9, R0
        LDI 0xFF               ; clock out one byte and read the ID byte
        MOV R1, R0
        LSI R2, 0
        MOV R10, R2
        LDI 0x0130
        MOV R11, R0
        LDI 0x2D4A
        MOV R3, R0
        LSI R2, 0
        LSI R0, 13
        JML R2
        NOP
        .org 0x0130
        MOV R2, R9
        ST R0, R2, 0
        HALT
  `);
  assert.equal(stub.success, true, stub.errors?.join('; '));
  const image = buildMemory(kernel);
  for (let w = 0x4a00; w <= 0x57ff; w++) image[(0x3000 << 4) + (w - 0x4a00)] = image[w];
  image[2] = kernel.symbols.swi_to_bios;
  for (const c of stub.memoryChanges) image[c.address] = c.value & 0xFFFF;
  const sim = new Deep16Simulator();
  sim.loadProgram(image);
  sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);
  Object.assign(sim.segmentRegisters, { CS: 0, DS: 0, SS: 0, ES: 0 });
  sim.registers[15] = 0x0100;
  sim.running = true;
  for (let i = 0; i < 8_000_000 && sim.running; i++) sim.step();
  assert.equal(sim.running, false, 'the stub reached its halt');
  assert.equal(sim.spi.cs, 2, 'function 12 selected the config flash');
  assert.equal(sim.spi.div, 0, 'function 12 set the divider');
  assert.equal(sim.memory[0x0400] & 0xFFFF, 0xFF, 'the 0x9F command exchange');
  assert.equal(sim.memory[0x0402] & 0xFFFF, 0x85, 'the first manufacturer ID byte');
});

test('function 14 writes a palette entry', () => {
  // R1 = bank*8 + pair; R4 = background | ink<<8. Bank 0, pair 3 -> 0x6086.
  const { r0, sim } = callBdos(14, 3, { arg4: 0x1C1C });
  assert.equal(r0, 0);
  assert.equal(sim.memory[0xF6086] & 0xFFFF, 0x1C, 'text pair 3 paper');
  assert.equal(sim.memory[0xF6087] & 0xFFFF, 0x1C, 'text pair 3 ink');
});

test('functions 15-17 drive and read I2S', () => {
  const mem = buildMemory(kernel);
  mem[0xF00A4] = 0x1234;                 // status
  mem[0xF00A0] = 0x5678;                 // level
  const read = callBdos(17, 0, { mem });
  assert.equal(read.r0, 0x1234, 'status');
  assert.equal(read.r1, 0x5678, 'level');

  const write = callBdos(15, 0x1357);
  assert.equal(write.sim.memory[0xF00A0] & 0xFFFF, 0x1357, 'sample word');
  const ctrl = callBdos(16, 9);
  assert.equal(ctrl.sim.memory[0xF00A2] & 0xFFFF, 9, 'control word');
});

test('function 18 sets the SIC enable mask', () => {
  // The pending register is W1C, so a write of 4 clears rather than sets; the
  // μ-law test drives that path through sample-stop. The read (19) is what
  // sample-irq-off uses to preserve the other sources.
  const set = callBdos(18, 0x0A);
  assert.equal(set.sim.sicEnable & 0xF, 0x0A, 'enable mask');
});

test('functions 21-23 access the sound window', () => {
  const write = callBdos(21, 0x20, { arg4: 7 });
  assert.equal(write.sim.memory[0xE0020] & 0xFFFF, 7, 'window write');
  const read = callBdos(22, 0x20, { mem: write.sim.memory });
  assert.equal(read.r0, 7, 'window read');

  const mem = buildMemory(kernel);
  for (let i = 0; i < 4; i++) mem[0x0400 + i] = 0x1000 + i;
  mem[kernel.symbols.bd_count] = 4;
  const copy = callBdos(23, 0x0400, { mem, arg4: 0x0100 });
  for (let i = 0; i < 4; i++)
    assert.equal(copy.sim.memory[0xE0100 + i] & 0xFFFF, 0x1000 + i, `cell ${i}`);
});
