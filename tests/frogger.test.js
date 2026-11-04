// Frogger backdrop: the per-row fine-scroll path.
//
// The demo is a small block at physical 0x4350. It paints ten lanes, rewrites
// each lane's tilemap row by whole cells when the fine offset wraps, and sets
// control 6 for the sub-cell remainder. The test runs it on the JS core and
// checks the lane state, the map and the Q return.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './helpers.js';
import {
  buildFrogger, checkFrogger, FROGGER_SEG_BASE, FROGGER_SEG, FROGGER_LIMIT,
} from '../scripts/make_showcase.mjs';
import { froggerArtTiles } from '../scripts/make_frogger_art.mjs';

for (const f of ['js/deep16_assembler.js', 'js/deep16_simulator.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const Simulator = vm.runInThisContext('Deep16Simulator');

const FRAME_PERIOD = 0x10000;
const STATUS = 0xF0066;
const RET_PC = 0x0777;
const BLOCK = FROGGER_SEG_BASE;
const START = 0x300;
const PHASE = 0x30A;

const frogger = buildFrogger();
checkFrogger(frogger);

test('the block fits the image gap and has six flat tiles', () => {
  assert.equal(frogger.seg, FROGGER_SEG);
  assert.ok(frogger.max < FROGGER_LIMIT);
  assert.equal(BLOCK + frogger.size <= 0x4A00, true, 'below the BIOS');
  const tiles = froggerArtTiles();
  assert.deepEqual(tiles.map((t) => t.index), [57, 58, 59, 60, 61, 62]);
  for (const tile of tiles) {
    assert.ok(tile.grid.every((row) => row.every((p) => p >= 1 && p <= 6)));
  }
});

function start() {
  const sim = new Simulator();
  sim.memory.fill(0);
  for (const [addr, value] of frogger.words) sim.memory[BLOCK + addr] = value;
  sim.d16nano = true;
  sim.segmentRegisters = { CS: FROGGER_SEG, DS: FROGGER_SEG, SS: 0, ES: 0 };
  sim.registers[10] = 0x04A0;
  sim.registers[11] = RET_PC;
  sim.registers[15] = 0;
  sim.running = true;
  sim.memory[STATUS] = 0;
  return sim;
}

function run(sim, frames) {
  for (let f = 0; f < frames; f++) {
    sim.memory[STATUS] = ((f & 1) ? 2 : 0) | (sim.uartRxAvailable() > 0 ? 8 : 0);
    for (let i = 0; i < FRAME_PERIOD && sim.running; i++) sim.step();
  }
}

test('the lanes paint and move in their own directions', () => {
  const sim = start();
  run(sim, 300);

  // The backdrop is actually in the tilemap: five river rows and five road
  // rows, with non-zero cells.
  const tile = (r, c) => sim.memory[0xF1000 + r * 82 + c];
  for (const r of [4, 5, 6, 7, 8, 10, 11, 12, 13, 14]) {
    assert.ok(tile(r, 0) !== 0 || tile(r, 10) !== 0, `row ${r} painted`);
    // The fine phase reads one cell past the 80 visible columns at the right
    // edge; the two margins must be painted too or that edge goes black.
    assert.ok(tile(r, 80) !== 0, `row ${r} right margin painted`);
    assert.ok(tile(r, 81) !== 0, `row ${r} far margin painted`);
  }
  // Palette set 2 entries 1..6 were installed.
  for (let i = 1; i <= 6; i++) {
    assert.notEqual(sim.memory[0xF6000 + 0x110 + i], 0, `palette entry ${i}`);
  }

  const starts = Array.from({ length: 10 }, (_, i) => sim.memory[BLOCK + START + i]);
  const phases = Array.from({ length: 10 }, (_, i) => sim.memory[BLOCK + PHASE + i]);
  for (const p of phases) assert.ok(p >= 0 && p <= 7, `phase ${p}`);

  // River bottom row is left, next right, next fast right, next right, top
  // left. Road bottom is left, next right, etc. `delta` is the modular coarse
  // distance; a right-moving lane decreases its start, a left one increases it.
  const moved = (i, initial) => (starts[i] - initial + 16) & 15;
  const back = (i, initial) => (initial - starts[i] + 16) & 15;
  assert.ok(back(0, 0) > 0, 'river top lane moved right');
  assert.ok(moved(1, 3) > 0, 'river lane 2 moved left');
  assert.ok(back(2, 6) > back(0, 0), 'fast river lane moves farther');
  assert.ok(back(3, 9) > 0, 'river lane 4 moved right');
  assert.ok(moved(4, 12) > 0, 'river bottom lane moved left');
  assert.ok(moved(5, 1) > 0, 'road bottom lane moved left');
  assert.ok(back(6, 4) > 0, 'road lane moved right');
  assert.ok(moved(7, 7) > 0, 'road lane moved left');
  assert.ok(back(8, 10) > 0, 'road lane moved right');
  assert.ok(moved(9, 13) > 0, 'road top lane moved left');
});

test('Q leaves the demo and returns to the menu', () => {
  const sim = start();
  run(sim, 300);
  sim.uartRxPush(0x71);
  let left = false;
  for (let f = 0; f < 40 && !left; f++) {
    sim.memory[STATUS] = ((f & 1) ? 2 : 0) | 8;
    for (let i = 0; i < FRAME_PERIOD && sim.running; i++) {
      sim.step();
      if (sim.segmentRegisters.CS !== FROGGER_SEG) { left = true; break; }
    }
  }
  assert.equal(sim.segmentRegisters.CS, 0x04A0);
  assert.equal(sim.registers[15], RET_PC);
});
