// Per-bird weight: Red is the reference, Purple falls 10% slower and lifts
// 10% more, Yellow the reverse.  Run physics_step directly on the JS core so
// the cadence counters can be measured without the menu or the autopilot.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadBrowserScripts, ROOT } from './helpers.js';
loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

// Flappy is a slice at segment 0x5000; the state cells are at 0x50000 + off.
const source = ['asm/showcase/flappy_defs.asm', 'asm/showcase/flappy_game.asm']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const flappy = new globalThis.Deep16Assembler().assemble(source);
const S = flappy.symbols;
const GB = 0x50000;
const flappyMax = flappy.memoryChanges.reduce((m, c) => Math.max(m, c.address), 0);

const G = {
  y: GB + 0x4DB, vy: GB + 0x4DC, flapTimer: GB + 0x4F6, tmp: GB + 0x4EF,
  color: GB + 0x4FF, fallTick: GB + 0x4F0, flapTick: GB + 0x4F1,
};
const HALT_PC = 0x0777;

function physics(color, frames, flap) {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(new Uint16Array(0x100).fill(0xFFFF));
  for (let i = 0; i <= flappyMax; i++) sim.memory[GB + i] = 0xFFFF;
  for (const c of flappy.memoryChanges) sim.memory[GB + c.address] = c.value & 0xFFFF;
  sim.segmentRegisters = { CS: 0x5000, DS: 0x5000, SS: 0, ES: 0 };
  sim.memory[G.y] = 100;
  sim.memory[G.vy] = flap ? -384 : 384;
  sim.memory[G.flapTimer] = flap ? 6 : 0;   // the flap request
  sim.memory[G.tmp] = 0;
  sim.memory[G.color] = color;
  sim.memory[G.fallTick] = 0;
  sim.memory[G.flapTick] = 0;

  for (let i = 0; i < frames; i++) {
    sim.running = true;
    sim.registers[15] = S.physics_step;
    sim.registers[14] = HALT_PC;       // LR: physics_step returns here
    let steps = 0;
    while (sim.running && steps < 100000) {
      sim.step();
      steps++;
    }
  }
  return sim.memory[G.y];
}

test('the three birds fall at 0.9x, 1.0x and 1.1x', () => {
  assert.equal(physics(0, 10, false), 110, 'red fall');
  assert.equal(physics(1, 10, false), 109, 'purple fall');
  assert.equal(physics(2, 10, false), 111, 'yellow fall');
});

test('the three birds lift at 1.1x, 1.0x and 0.9x', () => {
  assert.equal(physics(0, 5, true), 90, 'red lift');
  assert.equal(physics(1, 5, true), 89, 'purple lift');
  assert.equal(physics(2, 5, true), 91, 'yellow lift');
});
