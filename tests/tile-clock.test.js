// D16nano display status at 0xF0066. The IDE's 60 Hz clock writes
// sim.tileStatus; a program reads it with LDS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, buildMemory, loadBrowserScripts } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');
const Deep16Simulator = globalThis.Deep16Simulator;

const STATUS_PROGRAM = `
        .org 0x0100
        LDI 0x0FFF
        INV R0                  ; ES = 0xF000
        MVS ES, R0
        LDI 0x0066
        MOV R2, R0
        LDS R1, ES, R2
        HALT
`;

function readStatus(nano, status) {
  const res = assemble(STATUS_PROGRAM);
  assert.equal(res.success, true, res.errors.join('; '));
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0x0000;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  sim.registers[15] = 0x0100;
  sim.d16nano = nano;
  sim.tileStatus = status;
  sim.running = true;
  for (let i = 0; i < 1000 && sim.running; i++) sim.step();
  return { sim, r1: sim.registers[1] & 0xFFFF };
}

test('0xF0066 returns the host-written display status on D16nano', () => {
  const { r1 } = readStatus(true, 0x000A);
  assert.equal(r1, 0x000A);
});

test('0xF0066 is ordinary memory when the D16nano model is off', () => {
  const { r1 } = readStatus(false, 0x000A);
  assert.equal(r1, 0xFFFF, 'the unfilled word is read, not the status model');
});

test('reset clears the host-driven display status', () => {
  const sim = new Deep16Simulator();
  sim.tileStatus = 0x000F;
  sim.reset();
  assert.equal(sim.tileStatus, null, 'the memory word is the fallback again');
});
