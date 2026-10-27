// Per-bird weight: Red is the reference, Purple falls 10% slower and lifts
// 10% more, Yellow the reverse.  Run physics_step directly on the JS core so
// the cadence counters can be measured without the menu or the autopilot.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadBrowserScripts, ROOT } from './helpers.js';
import { buildShowcase, SHOWCASE_SEG_BASE } from '../scripts/make_showcase.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const source = ['asm/showcase/showcase.asm', 'asm/showcase/flappy_game.asm']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const S = new globalThis.Deep16Assembler().assemble(source).symbols;
const showcase = buildShowcase();

const G = {
  y: 0x4EDB, vy: 0x4EDC, flapTimer: 0x4EF6, tmp: 0x4EEF,
  color: 0x4EFF, fallTick: 0x4EF0, flapTick: 0x4EF1,
};
const HALT_PC = 0x0777;

function physics(color, frames, flap) {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  const mem = new Uint16Array(0x10000).fill(0xFFFF);
  for (const [addr, value] of showcase.words) mem[SHOWCASE_SEG_BASE + addr] = value;
  sim.loadProgram(mem);
  sim.segmentRegisters = { CS: 0x04A0, DS: 0x04A0, SS: 0, ES: 0 };
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
