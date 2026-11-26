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
//  24  gfx-read    -> R1 = offset inside 0xF000; R0 = value
//  25  gfx-write   -> R1 = offset, R4 = value
//  26  gfx-copy    -> R1 = source in DS, R4 = offset, bd_count cells
//  27  fcreate     -> R1 = name; R4 = type; R0 = new slice (or 0xFFFF/7)
//  28  fdelete     -> R1 = name; R0 = 0 (or 0xFFFF/8)
//  29  fsize       -> R1 = slice; R0 = payload length
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

// Phase 2b: fns 27..29 live in the BDOS chapter at CS=0x4000. The chapter is
// assembled with its in-segment offsets and copied to 0x40000, exactly what
// the JS scatter and (after phase 4a) the flash loader do.
const bdosBlock = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'bdos_block.asm'), 'utf8'),
                           { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1, D16D: 1 } });
assert.equal(bdosBlock.success, true, bdosBlock.errors?.join('; '));
const BDOS_SEG = 0x4000;

export const BDOS_ENTRY = 0x2D4A;
const DIR_SEG = 0x8000;
const slices = buildSlices();

test('the BDOS entry lives in the CS=0x4000 chapter', () => {
  assert.equal(bdosBlock.symbols.bdos_entry, BDOS_ENTRY);
  assert.equal(kernel.symbols.bdos_entry, undefined, 'the entry left the flat kernel');
  assert.equal(kernel.symbols.bdos_call, 0x3FE2, 'the shared far entry is in the kernel');
});

// LDI carries a 15-bit field sign-extended from bit 14, so it cannot spell
// 0x4000-0xBFFF. Build any 16-bit pattern with the documented recipe (load the
// low 14 bits, then set bits 14/15 with OR Rd, imm).
function loadImm(value) {
  const pattern = value & 0xFFFF;
  const lines = [`LDI 0x${(pattern & 0x3FFF).toString(16)}`];
  if (pattern & 0x4000) lines.push('OR R0, 14');
  if (pattern & 0x8000) lines.push('OR R0, 15');
  return lines.map((l) => `        ${l}`).join('\n');
}

// Call function `fn` with R1 = arg, then halt at 0x0200.
function callBdos(fn, arg = 0, { mem, flash, arg4 = 0 } = {}) {
  const stub = assemble(`
        .org 0x0100
${loadImm(arg4)}
        MOV R4, R0            ; fourth argument (read-slice destination)
        LDI ${fn}
        MOV R8, R0            ; park the function: LDI always writes R0
${loadImm(arg)}
        MOV R9, R0            ; park the argument
        LSI R2, 0
        MOV R10, R2           ; return CS = 0
        LDI 0x0200
        MOV R11, R0           ; return PC = 0x0200
        LDI 0x2D4A
        MOV R3, R0            ; jump PC
        LDI 0x2000
        SL R0, 1
        MOV R2, R0            ; jump CS = 0x4000
        MOV R1, R9
        MOV R0, R8
        JML R2
        NOP
        .org 0x0200
        HALT
  `);
  assert.equal(stub.success, true, stub.errors?.join('; '));
  const image = mem || buildMemory(kernel);
  // The slice chapter is a separate segment; place it where the far
  // trampolines point. Its addresses are offsets, hence BDOS_SEG << 4.
  for (const c of bdosBlock.memoryChanges) image[(BDOS_SEG << 4) + c.address] = c.value & 0xFFFF;
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
        LDI 0x2000
        SL R0, 1
        MOV R2, R0
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
        LDI 0x2000
        SL R0, 1
        MOV R2, R0
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

test('function 7 (fwrite) erases and programs a slice', () => {
  const slice = 100;
  const mem = buildMemory(kernel);
  for (let i = 0; i < 16; i++) mem[0x0400 + i] = 0x1100 + i;
  mem[kernel.symbols.bd_count] = 16;
  const { r0, r1, sim } = callBdos(7, slice, { mem, arg4: 0x0400 });
  assert.equal(r0, 16, 'fwrite returns the cell count');
  assert.equal(r1, 0);
  const off = SCREEN_BASE + slice * SLICE_BYTES;
  for (let i = 0; i < 16; i++) {
    const word = sim.spiFlash.mem[off + i * 2] | (sim.spiFlash.mem[off + i * 2 + 1] << 8);
    assert.equal(word, 0x1100 + i, `cell ${i}`);
  }
  assert.equal(sim.spiFlash.mem[off + 32], 0xFF, 'the rest of the sector stays erased');
});

test('function 7 refuses a write-protected image', () => {
  const mem = buildMemory(kernel);
  mem[0x0400] = 0x8000;                  // bit 15: write protected
  mem[kernel.symbols.bd_count] = 16;
  const wp = callBdos(7, 100, { mem, arg4: 0x0400 });
  assert.equal(wp.r0, 0xFFFF);
  assert.equal(wp.r1, 5, 'the header marks the slice read-only');

  const big = callBdos(7, 512, { mem: buildMemory(kernel) });
  assert.equal(big.r0, 0xFFFF, 'a slice outside 0..511 is refused');
});

function flashWord(sim, off) {
  return sim.spiFlash.mem[off] | (sim.spiFlash.mem[off + 1] << 8);
}

test('the 27..29 slice is no longer in the flat image', () => {
  // The old flat fcreate entry was 0x3FFC. The block now lives at CS=0x4000,
  // so the flat image must have no word there (and the trampolines instead).
  assert.equal(kernel.memoryChanges.find((c) => c.address === 0x3FFC), undefined,
               'flat 0x3FFC must be FILL after the move');
  assert.equal(kernel.symbols.bdos_fcreate, undefined, 'the handler label moved out');
  assert.equal(kernel.symbols.bdos_fcreate_far, 0x3FCE);
});

test('function 27 (fcreate) writes a header and a directory entry', () => {
  const mem = buildMemory(kernel);
  mem[0x3FFC] = 0xFFFF;                 // poison the old flat entry
  for (const [i, ch] of [...'newfile'].entries()) mem[0x0400 + i] = ch.charCodeAt(0);
  mem[0x0407] = 0;
  const { r0, r1, sim } = callBdos(27, 0x0400, { mem, arg4: 3 });
  assert.equal(r0, 511, 'the first allocation comes from the top');
  assert.equal(r1, 0);

  const off = SCREEN_BASE + 511 * SLICE_BYTES;
  assert.equal(flashWord(sim, off), 0x5003, 'header: magic 5 and type 3');
  assert.equal(flashWord(sim, off + 2), 0xFFFF, 'header: no continuation');
  assert.equal(flashWord(sim, off + 4), 'n'.charCodeAt(0) | ('e'.charCodeAt(0) << 8));

  let entry = -1;
  for (let i = 0; i < 255; i++) {
    const e = SCREEN_BASE + 16 + i * 16;
    if (flashWord(sim, e + 2) === 511) { entry = e; break; }
  }
  assert.ok(entry >= 0, 'the directory points at slice 511');
  assert.equal(flashWord(sim, entry) & 0xFF, 3, 'entry type');
  assert.equal(flashWord(sim, entry + 4), 'n'.charCodeAt(0) | ('e'.charCodeAt(0) << 8));
});

test('function 28 (fdelete) clears a directory entry by name', () => {
  const flash = Buffer.from(slices.bytes);
  let entry = -1;
  for (let i = 0; i < 255; i++) {
    const e = 16 + i * 16;
    if (flash.readUInt16LE(e + 2) === 0xFFFF) { entry = e; break; }
  }
  assert.ok(entry >= 0);
  flash.writeUInt16LE(3, entry);
  flash.writeUInt16LE(400, entry + 2);
  flash.writeUInt16LE('g'.charCodeAt(0) | ('o'.charCodeAt(0) << 8), entry + 4);
  flash.writeUInt16LE('n'.charCodeAt(0) | ('e'.charCodeAt(0) << 8), entry + 6);

  const mem = buildMemory(kernel);
  for (const [i, ch] of [...'gone'].entries()) mem[0x0400 + i] = ch.charCodeAt(0);
  mem[0x0404] = 0;
  const { r0, r1, sim } = callBdos(28, 0x0400, { mem, flash });
  assert.equal(r0, 0);
  assert.equal(r1, 0);
  assert.equal(flashWord(sim, SCREEN_BASE + entry + 2), 0xFFFF, 'the entry is free again');

  const miss = callBdos(28, 0x0400, { mem: buildMemory(kernel), flash: slices.bytes });
  assert.equal(miss.r0, 0xFFFF);
  assert.equal(miss.r1, 8);
});

test('function 29 (fsize) reports text and binary lengths', () => {
  const flash = Buffer.alloc(512 * SLICE_BYTES, 0xFF);
  Buffer.from(slices.bytes).copy(flash);
  const text = 400;
  const textOff = text * SLICE_BYTES;
  flash.writeUInt16LE(0x5003, textOff);
  flash.writeUInt16LE(0xFFFF, textOff + 2);
  const body = [...'abc\n'].map((c) => c.charCodeAt(0));
  for (let i = 0; i < 2040; i++) flash.writeUInt16LE(i < body.length ? body[i] : 10, textOff + 16 + i * 2);

  const bin = 401;
  const binOff = bin * SLICE_BYTES;
  flash.writeUInt16LE(0x5004, binOff);
  flash.writeUInt16LE(0xFFFF, binOff + 2);
  flash.writeUInt16LE(123, binOff + 22);      // payload cell 3 = word count

  assert.equal(callBdos(29, text, { flash }).r0, 3, 'trailing LF padding is trimmed');
  assert.equal(callBdos(29, bin, { flash }).r0, 123, 'binary uses the header word count');
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
        LDI 0x2000
        SL R0, 1
        MOV R2, R0
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
        LDI 0x2000
        SL R0, 1
        MOV R2, R0
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
        LDI 0x0140
        MOV R11, R0
        LDI 0x2D4A
        MOV R3, R0
        LDI 0x2000
        SL R0, 1
        MOV R2, R0
        LSI R0, 13
        JML R2
        NOP
        .org 0x0140
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
  const read = callBdos(17, 0);
  assert.equal(read.r0 & 1, 1, 'status says empty');
  assert.equal(read.r0 & 4, 4, 'empty is also below the low mark');
  assert.equal(read.r1, 0, 'empty level');

  const write = callBdos(15, 0x1357);
  assert.equal(write.sim.i2s.count, 1, 'sample queued');
  assert.equal(write.sim.i2s.fifo[0], 0x1357, 'sample word');
  const level = callBdos(17, 0, { mem: buildMemory(kernel) });
  assert.equal(level.r1, 0, 'a fresh machine starts empty');

  const ctrl = callBdos(16, 9);
  assert.equal(ctrl.sim.i2s.enable, true, 'enable');
  assert.equal(ctrl.sim.i2s.irqEnable, true, 'irq enable');
  assert.equal(ctrl.sim.i2s.loop, false, 'loop off');
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

test('functions 24-26 read, write and copy graphics registers', () => {
  const mem = buildMemory(kernel);
  mem[0xF00C6] = 0x1234;
  assert.equal(callBdos(24, 0xC6, { mem }).r0, 0x1234, 'gfx read');

  const write = callBdos(25, 0xC6, { arg4: 0x5678 });
  assert.equal(write.sim.memory[0xF00C6] & 0xFFFF, 0x5678, 'gfx write');

  const copyMem = buildMemory(kernel);
  for (let i = 0; i < 3; i++) copyMem[0x0400 + i] = 0x2000 + i;
  copyMem[kernel.symbols.bd_count] = 3;
  const copy = callBdos(26, 0x0400, { mem: copyMem, arg4: 0x4200 });
  for (let i = 0; i < 3; i++)
    assert.equal(copy.sim.memory[0xF4200 + i] & 0xFFFF, 0x2000 + i, `gfx copy ${i}`);
});
