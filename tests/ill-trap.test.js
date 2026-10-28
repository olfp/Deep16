// D16nano ILL trap: DIV/DIV32 are absent from the core3 and trap to vector 0.
// The kernel's ill_handler (asm/forth_nano.asm) decodes the trapped word, runs
// the software divide, writes the caller's destination through SMV (R0..R3) or
// directly (R4..R12), restores the shared registers and RETIs. The JS core
// models the same trap when `d16nano` is set.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, buildMemory, loadBrowserScripts, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1, D16NANO: 1 } });
assert.equal(kernel.success, true, kernel.errors.join('; '));

// A free patch area: the demo starts at 0x4E00, the ILL handler at 0x5000.
const PATCH = 0x4f00;

function boot() {
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(buildMemory(kernel));
  sim.segmentRegisters.CS = 0xffff;
  sim.d16nano = true;
  sim.running = true;
  for (let i = 0; i < 6_000_000 && sim.running && !sim.memory[kernel.symbols.boot_done]; i++) {
    sim.step();
  }
  for (let i = 0; i < 100_000 && sim.running; i++) sim.step();
  assert.ok(sim.running, 'kernel did not boot to the REPL');
  return sim;
}

function runProgram(sim, source) {
  const prog = assemble(source);
  assert.equal(prog.success, true, prog.errors.join('; '));
  for (const ch of prog.memoryChanges) sim.memory[ch.address] = ch.value & 0xFFFF;
  sim.registers[15] = PATCH;
  sim.psw = 0;                    // leave the boot's BIOS getstr context
  sim.segmentRegisters.CS = 0x0000;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  sim.running = true;
  for (let i = 0; i < 200000 && sim.running; i++) sim.step();
  return sim;
}

test('DIV traps and writes a caller R0 destination through SMV', () => {
  const sim = boot();
  runProgram(sim, `
.org 0x4f00
    LDI 100
    MOV R1, R0          ; R1 = 100
    LDI 7
    MOV R2, R0          ; R2 = 7
    MOV R0, R1          ; R0 = 100
    DIV R0, R2          ; R0 = 14
    HALT
`);
  assert.equal(sim.registers[0], 14);
  assert.equal(sim.registers[1], 100);
  assert.equal(sim.registers[2], 7);
});

test('DIV writes a shared destination and preserves the other shared regs', () => {
  const sim = boot();
  runProgram(sim, `
.org 0x4f00
    LDI 100
    MOV R9, R0          ; dividend in shared R9
    LDI 7
    MOV R3, R0          ; divisor in caller R3
    LDI 0x1234
    MOV R6, R0          ; an unrelated shared value
    DIV R9, R3          ; R9 = 14
    HALT
`);
  assert.equal(sim.registers[9], 14);
  assert.equal(sim.registers[6], 0x1234);
  assert.equal(sim.registers[3], 7);
});

test('DIV is signed, truncating toward zero', () => {
  const sim = boot();
  runProgram(sim, `
.org 0x4f00
    LDI 100
    NEG R0              ; -100
    MOV R1, R0
    LDI 7
    MOV R2, R0
    MOV R0, R1
    DIV R0, R2          ; -14
    HALT
`);
  assert.equal(sim.registers[0] & 0xFFFF, (-14) & 0xFFFF);
});

test('DIV32 writes quotient and remainder and preserves shared registers', () => {
  const sim = boot();
  runProgram(sim, `
.org 0x4f00
    LDI 0
    MOV R4, R0          ; high half 0
    LDI 100
    MOV R5, R0          ; low half 100
    LDI 7
    MOV R1, R0          ; divisor
    LDI 0x2345
    MOV R8, R0          ; unrelated shared
    DIV32 R4, R1        ; R4 = 14, R5 = 2
    HALT
`);
  assert.equal(sim.registers[4], 14);
  assert.equal(sim.registers[5], 2);
  assert.equal(sim.registers[8], 0x2345);
});

test('DIV32 quotient in R0 and remainder in R1 go through SMV', () => {
  const sim = boot();
  runProgram(sim, `
.org 0x4f00
    LDI 0
    MOV R0, R0          ; R0 high
    LDI 100
    MOV R1, R0          ; R1 low
    LDI 7
    MOV R2, R0          ; divisor
    DIV32 R0, R2        ; R0 = 14, R1 = 2
    HALT
`);
  assert.equal(sim.registers[0], 14);
  assert.equal(sim.registers[1], 2);
  assert.equal(sim.registers[2], 7);
});
