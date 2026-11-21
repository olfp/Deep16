// The JS I2S model behind 0xF00A0..0xF00A7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, loadBrowserScripts } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

function simWith(source) {
  const res = assemble(source);
  assert.equal(res.success, true, res.errors?.join('; '));
  const sim = new globalThis.Deep16Simulator();
  for (const ch of res.memoryChanges) sim.memory[ch.address] = ch.value & 0xFFFF;
  sim.running = true;
  return sim;
}

function writeI2s(sim, offset, value) {
  sim.i2sWrite(offset, value);
}

test('the FIFO fills, reports full and drains in order', () => {
  const sim = new globalThis.Deep16Simulator();
  for (let i = 0; i < 128; i++) writeI2s(sim, 0, i);
  assert.equal(sim.i2s.count, 128);
  assert.equal(sim.i2s.full(), true);
  assert.equal(sim.i2s.status() & 2, 2, 'full bit');
  writeI2s(sim, 2, 1);                       // enable, no loop
  const data = sim.i2s.drain(128 / 21093.75);
  assert.equal(data.length, 128);
  assert.equal(data[0], 0);
  assert.equal(data[127], 127);
  assert.equal(sim.i2s.count, 0);
  assert.equal(sim.i2s.status() & 1, 1, 'empty bit');
});

test('control enables, resets and loops the FIFO', () => {
  const sim = new globalThis.Deep16Simulator();
  for (let i = 0; i < 128; i++) writeI2s(sim, 0, i + 1);
  writeI2s(sim, 2, 5);                       // enable + loop
  assert.equal(sim.i2s.enable, true);
  assert.equal(sim.i2s.loop, true);
  const first = sim.i2s.drain(128 / 21093.75);
  assert.equal(first.length, 128);
  assert.equal(first[0], 1);
  assert.equal(first[127], 128);
  const second = sim.i2s.drain(128 / 21093.75);
  assert.equal(second.length, 128, 'loop replays the whole buffer');
  assert.equal(second[0], 1);
  writeI2s(sim, 2, 2);                       // reset, disabled
  assert.equal(sim.i2s.enable, false);
  assert.equal(sim.i2s.count, 0);
});

test('a draining FIFO raises the SIC audio source until W1C', () => {
  const sim = new globalThis.Deep16Simulator();
  for (let i = 0; i < 128; i++) writeI2s(sim, 0, i);
  writeI2s(sim, 2, 9);                       // enable + IRQ
  sim.sicEnable = 4;
  assert.equal(sim.i2s.fifoIrq(), false, 'full is not low');
  sim.i2s.drain(100 / 21093.75);             // 28 left
  sim.updateAudioIrq();
  assert.equal(sim.i2s.low(), true);
  assert.equal(sim.sicPending & 4, 4, 'audio pending');
  assert.equal(sim.irqLine(), true);
  sim.sicWrite(0, 4);                        // W1C
  assert.equal(sim.sicPending & 4, 0);
  sim.updateAudioIrq();
  assert.equal(sim.sicPending & 4, 4, 'still-low level re-latches');
});

test('an empty FIFO without loop reports underrun', () => {
  const sim = new globalThis.Deep16Simulator();
  writeI2s(sim, 2, 1);                       // enable, no loop
  const data = sim.i2s.drain(2 / 21093.75);
  assert.equal(data.length, 2);
  assert.equal(data[0], 0);
  assert.equal(sim.i2s.underrun, true);
  assert.equal(sim.i2s.status() & 8, 8);
});

test('CPU STS/LDS reach the I2S registers', () => {
  const sim = simWith(`
        .org 0x0100
        LDI 0x0FFF
        INV R0
        MVS ES, R0
        LDI 0x00A0
        MOV R12, R0
        LDI 0x1234
        STS R0, ES, R12
        LDI 0x00A2
        MOV R12, R0
        LDI 9
        STS R0, ES, R12
        LDI 0x00A4
        MOV R12, R0
        LDS R1, ES, R12
        LDI 0x00A0
        MOV R12, R0
        LDS R2, ES, R12
        HALT
  `);
  for (let i = 0; i < 1000 && sim.running; i++) sim.step();
  assert.equal(sim.i2s.fifo[0], 0x1234);
  assert.equal(sim.i2s.enable, true);
  assert.equal(sim.i2s.irqEnable, true);
  const status = sim.registers[1] & 0x3F;
  assert.equal(status & 1, 0, 'not empty');
  assert.equal(status & 4, 4, 'low');
  assert.equal(status & 16, 16, 'running');
  assert.equal(status & 32, 32, 'irq');
  assert.equal(sim.registers[2], 1, 'level');
});
