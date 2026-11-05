// Frogger backdrop: the per-row fine-scroll path, widescreen layout.
//
// The demo is a small block at physical 0x4350. It paints nine double-height
// lanes (five river, four road), rewrites each lane's playfield row by whole
// cells when the fine offset wraps, and sets control 6 for both rows of the
// lane. The right 184 px is a uniform panel with a static top/bottom HUD.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './helpers.js';
import {
  buildFrogger, checkFrogger, FROGGER_SEG_BASE, FROGGER_SEG, FROGGER_LIMIT,
} from '../scripts/make_showcase.mjs';
import { froggerArtTiles, FROGGER_PALETTE } from '../scripts/make_frogger_art.mjs';

for (const f of ['js/deep16_assembler.js', 'js/deep16_simulator.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const Simulator = vm.runInThisContext('Deep16Simulator');

const FRAME_PERIOD = 0x10000;
const STATUS = 0xF0066;
const RET_PC = 0x0777;
const BLOCK = FROGGER_SEG_BASE;
const START = 0x380;
const PHASE = 0x389;

const frogger = buildFrogger();
checkFrogger(frogger);

test('the block fits the image gap and carries the art tiles', () => {
  assert.equal(frogger.seg, FROGGER_SEG);
  assert.ok(frogger.max < FROGGER_LIMIT);
  assert.equal(BLOCK + frogger.size <= 0x4A00, true, 'below the BIOS');
  const tiles = froggerArtTiles();
  const expect = [...Array.from({ length: 6 }, (_, i) => 59 + i), 57, 58, 126, 127,
    ...Array.from({ length: 30 }, (_, i) => 65 + i)];
  assert.deepEqual(tiles.map((t) => t.index), expect);
  for (const tile of tiles) {
    assert.equal(tile.grid.length, 15);
    assert.ok(tile.grid.every((row) => row.length === 8 && row.every((p) => p >= 0 && p <= 15)));
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
  // Forty frames: even the fastest lane stays inside one 16-cell wrap, so the
  // coarse starts can be compared directly.
  run(sim, 40);

  // The backdrop is in the tilemap: five double-height river lanes and four
  // double-height road lanes. Columns 0..23 are the panel, 24..79 the
  // playfield and 80..81 the margin cells the fine phase reads.
  const tile = (r, c) => sim.memory[0xF1000 + r * 82 + c];
  const laneRows = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
                    14, 15, 16, 17, 18, 19, 20, 21];
  for (const r of laneRows) {
    assert.ok(tile(r, 24) !== 0, `row ${r} playfield painted`);
    assert.ok(tile(r, 80) !== 0, `row ${r} margin painted`);
    assert.ok(tile(r, 81) !== 0, `row ${r} margin painted`);
    assert.equal(tile(r, 0), 0, `row ${r} panel tile`);
    assert.equal(tile(r, 23), 0, `row ${r} panel tile`);
  }
  // Palette set 2 art bank is the art palette; text 0/1 the HUD.
  for (let i = 0; i < 16; i++) {
    assert.equal(sim.memory[0xF6000 + 0x110 + i], FROGGER_PALETTE[i], `palette entry ${i}`);
  }
  assert.equal(sim.memory[0xF6000 + 0x100], 0x49, 'HUD text background');
  assert.equal(sim.memory[0xF6000 + 0x101], 0xFF, 'HUD text colour');
  // Static HUD text cells in the panel's top and bottom rows.
  assert.notEqual(tile(0, 2) & 0x8000, 0, 'score HUD text');
  assert.notEqual(tile(23, 2) & 0x8000, 0, 'bottom HUD text');

  const starts = Array.from({ length: 9 }, (_, i) => sim.memory[BLOCK + START + i]);
  const phases = Array.from({ length: 9 }, (_, i) => sim.memory[BLOCK + PHASE + i]);
  // Phases are quarter pixels, 0..31.
  for (const p of phases) assert.ok(p >= 0 && p <= 31, `phase ${p}`);

  // River top->bottom: logs right, turtles left, logs right, logs right,
  // turtles left.  Road top->bottom: left, right, left, right.
  // `moved` is the modular coarse distance; a right-moving lane decreases its
  // start, a left one increases it.
  const moved = (i, initial) => (starts[i] - initial + 16) & 15;
  const back = (i, initial) => (initial - starts[i] + 16) & 15;
  assert.ok(back(0, 0) > 0, 'river top lane moved right');
  assert.ok(moved(1, 3) > 0, 'river lane 2 moved left');
  assert.ok(back(2, 6) > back(0, 0), 'fast river lane moves farther than the normal one');
  assert.ok(back(3, 9) < back(0, 0), 'slow river lane moves less than the normal one');
  assert.ok(back(3, 9) > 0, 'river lane 4 moved right');
  assert.ok(moved(4, 12) > 0, 'river bottom lane moved left');
  assert.ok(moved(5, 1) > 0, 'road top lane moved left');
  assert.ok(back(6, 4) > 0, 'road lane 2 moved right');
  assert.ok(moved(7, 7) > 0, 'road lane 3 moved left');
  assert.ok(back(8, 10) > 0, 'road bottom lane moved right');
});

test('the panel strip is a shrinking time bar', () => {
  const sim = start();
  run(sim, 100);
  const time = sim.memory[BLOCK + 0x3a0];
  assert.ok(time > 0 && time < 23, `time ${time}`);
  const at = (r, c) => sim.memory[0xF1000 + r * 82 + c] >> 5;
  for (const r of [12, 13]) {
    assert.equal(at(r, 0), 127, `row ${r} bar start`);
    assert.equal(at(r, time), 0, `row ${r} bar end`);
  }
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
