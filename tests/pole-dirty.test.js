// The Pole dirty redraw: the same picture with fewer written cells.
//
// Run the board harness (64 frames) twice on the JS core, once with the skip
// and once with POLE_NODIRTY, and compare the work and the final map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserScripts, MEM_WORDS } from './helpers.js';
import { assemblePoleBoard } from '../scripts/pole_program.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const SEG = 0x7000;
const TILE_BASE = 0xF1000;
const MAP_COLS = 82;
const REPORT_ROW = 1;

function run(defines) {
  const g = assemblePoleBoard(defines);
  const mem = new Array(MEM_WORDS).fill(0xFFFF);
  for (let i = 0; i < g.memoryChanges.length; i++) {
    const { address, value } = g.memoryChanges[i];
    mem[(SEG << 4) + address] = value & 0xFFFF;
  }
  mem[0x0200] = 0xFFFF;
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(mem);
  Object.assign(sim.segmentRegisters, { CS: SEG, DS: SEG, SS: SEG, ES: 0 });
  sim.registers[10] = 0;
  sim.registers[11] = 0x0200;
  sim.registers[15] = 0;
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 20_000_000) {
    sim.step();
    steps++;
  }
  assert.equal(sim.running, false, 'the harness halted');
  const cells = [];
  for (let row = 0; row < 24; row++) {
    for (let col = 0; col < 80; col++) {
      if (row === REPORT_ROW) continue;
      cells.push(sim.memory[TILE_BASE + row * MAP_COLS + col] & 0xFFFF);
    }
  }
  return { steps, cells };
}

test('the dirty redraw writes fewer cells and keeps the picture', () => {
  const dirty = run({ POLE_FAST: 1 });
  const full = run({ POLE_FAST: 1, POLE_NODIRTY: 1 });
  assert.deepEqual(dirty.cells, full.cells, 'the skipped sky rows must still match');
  assert.ok(dirty.steps < full.steps,
    `dirty ${dirty.steps} steps should be less than full ${full.steps}`);
  const saved = (full.steps - dirty.steps) / full.steps;
  assert.ok(saved > 0.03, `the skip should save more than 3% (got ${(saved * 100).toFixed(1)}%)`);
});
