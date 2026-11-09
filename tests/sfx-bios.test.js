// BIOS game-sound calls (functions 9 and 10).
//
// The games are slices in their own segments; they reach the sound generator
// through the BIOS. These tests install the SWI vector, call the functions the
// way a game does, and inspect the I2S control register and the frame counter.
// The JS core has no I2S model, so the FIFO/control writes land in the MMIO
// memory window; control bit 0/2 and the saved registers are what matter here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, buildMemory, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, D16D: 1 } });
assert.equal(kernel.success, true, kernel.errors?.join('; '));
const sym = kernel.symbols;
const CTRL = 0xF00A2;

// The games use R4-R12 across the call; function 9 must save and restore all
// of them. R0-R2 are the call's scratch, as documented.
const PATTERNS = [0x1234, 0x2345, 0x3456, 0x1567, 0x1678, 0x1789, 0x189A, 0x1234, 0x1321];

function stubSource(effect, frames, ticks) {
  const tick = '        LDI 10\n        SWI\n'.repeat(ticks);
  return `
        .org 0x0100
        LDI ${sym.swi_to_bios}
        MOV R1, R0
        LSI R2, 2
        STS R1, CS, R2
        LDI ${PATTERNS[0]}
        MOV R4, R0
        LDI ${PATTERNS[1]}
        MOV R5, R0
        LDI ${PATTERNS[2]}
        MOV R6, R0
        LDI ${PATTERNS[3]}
        MOV R7, R0
        LDI ${PATTERNS[4]}
        MOV R8, R0
        LDI ${PATTERNS[5]}
        MOV R9, R0
        LDI ${PATTERNS[6]}
        MOV R10, R0
        LDI ${PATTERNS[7]}
        MOV R11, R0
        LDI ${PATTERNS[8]}
        MOV R12, R0
        LDI ${effect}
        MOV R1, R0
        LDI ${frames}
        MOV R2, R0
        LDI 9
        SWI
        ${tick}
        LDI 0x0300
        MOV R3, R0
        ST R4, R3, 0
        ST R5, R3, 1
        ST R6, R3, 2
        ST R7, R3, 3
        ST R8, R3, 4
        ST R9, R3, 5
        ST R10, R3, 6
        ST R11, R3, 7
        ST R12, R3, 8
        HALT
`;
}

function run(effect, frames, ticks = 0) {
  const stub = assemble(stubSource(effect, frames, ticks));
  assert.equal(stub.success, true, stub.errors?.join('; '));
  const mem = buildMemory(kernel);
  for (const c of stub.memoryChanges) mem[c.address] = c.value & 0xFFFF;
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(mem);
  Object.assign(sim.segmentRegisters, { CS: 0xFFFF, DS: 0, SS: 0, ES: 0 });
  sim.running = true;
  for (let i = 0; i < 2_000_000 && sim.running; i++) sim.step();
  assert.equal(sim.running, false, 'the stub returned to HALT');
  return sim;
}

function savedRegs(sim) {
  return Array.from({ length: 9 }, (_, i) => sim.memory[0x0300 + i] & 0xFFFF);
}

test('function 9 starts an effect and preserves the shared registers', () => {
  const sim = run(1, 6);
  assert.equal(sim.memory[CTRL] & 0xFFFF, 0x0005, 'enable + loop');
  assert.equal(sim.memory[sym.sfx_frames] & 0xFFFF, 6, 'six frames queued');
  assert.deepEqual(savedRegs(sim), PATTERNS, 'R4-R12 survived the call');
});

test('function 10 runs the effect down and stops it', () => {
  const one = run(1, 2, 1);
  assert.equal(one.memory[CTRL] & 0xFFFF, 0x0005, 'still playing');
  assert.equal(one.memory[sym.sfx_frames] & 0xFFFF, 1, 'one frame left');

  const two = run(1, 2, 2);
  assert.equal(two.memory[CTRL] & 0xFFFF, 0x0000, 'stopped at the last frame');
  assert.equal(two.memory[sym.sfx_frames] & 0xFFFF, 0, 'counter cleared');
});

test('effect 0 stops the sound and clears the counter', () => {
  const sim = run(0, 10, 1);
  assert.equal(sim.memory[CTRL] & 0xFFFF, 0x0000);
  assert.equal(sim.memory[sym.sfx_frames] & 0xFFFF, 0);
});

test('an out-of-range effect is treated as stop', () => {
  const sim = run(9, 10);
  assert.equal(sim.memory[CTRL] & 0xFFFF, 0x0000);
  assert.equal(sim.memory[sym.sfx_frames] & 0xFFFF, 0);
});
