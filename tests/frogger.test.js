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
import { froggerSpriteFrames } from '../scripts/make_frogger_sprites.mjs';

for (const f of ['js/deep16_assembler.js', 'js/deep16_simulator.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const Simulator = vm.runInThisContext('Deep16Simulator');

const FRAME_PERIOD = 0x10000;
const STATUS = 0xF0066;
const RET_PC = 0x0777;
const BLOCK = FROGGER_SEG_BASE;
const START = 0x800;
const PHASE = 0x809;

const frogger = buildFrogger();
checkFrogger(frogger);

test('the slice carries the art and sprite packs', () => {
  assert.equal(frogger.seg, FROGGER_SEG);
  assert.ok(frogger.codeMax < FROGGER_LIMIT, 'code below the tile pack');
  assert.equal(BLOCK + frogger.max + 1 <= 0x10000, true, 'block fits its segment');
  const packAt = (a) => frogger.words.find((w) => w[0] === a)?.[1];
  assert.equal(packAt(0x1000), 0x0A57, 'tile pack magic');
  assert.equal(packAt(0x1000 + 1), froggerArtTiles().length, 'tile count');
  assert.equal(packAt(0x2000), 0x0A58, 'sprite pack magic');
  assert.equal(packAt(0x2000 + 1), froggerSpriteFrames().length, 'sprite group count');
  const tiles = froggerArtTiles();
  const expect = [57, 58, 126, 127, 38,
    ...Array.from({ length: 12 }, (_, i) => 26 + i),
    ...Array.from({ length: 62 }, (_, i) => 59 + i)];
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
  // Stand-alone game: no kernel/BIOS; the sound SWI calls become no-ops.
  sim.memory[2] = 0xE000;
  sim.memory[0xE000] = 0xFFF3;
  return sim;
}

function run(sim, frames) {
  // The frame bit must keep alternating across calls: the game waits for a
  // change, so restarting the counter at 0 would stall back-to-back calls.
  for (let f = 0; f < frames; f++) {
    sim.testFrame = ((sim.testFrame ?? 0) + 1) & 0xffff;
    sim.memory[STATUS] = ((sim.testFrame & 1) ? 2 : 0) | (sim.uartRxAvailable() > 0 ? 8 : 0);
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
  const time = sim.memory[BLOCK + 0x820];
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
  sim.kbdBuffer.push(0x71);
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

test('the frog hops one lane or one cell per key', () => {
  const sim = start();
  run(sim, 20);
  const f = frogState(sim);
  assert.equal(f.lane(), 11, 'starts on the bottom bank');
  assert.equal(f.fxq(), 1728, 'on the bay lattice');
  assert.equal(f.word(0x832), 0, 'no hop animation');

  // horizontal hops stay on the safe bottom bank
  sim.kbdBuffer.push(0x64);            // d
  run(sim, 2);
  assert.equal(f.fxq(), 1856, 'one cell right');
  assert.ok(f.word(0x832) > 0, 'hop animation armed');
  run(sim, 8);

  sim.kbdBuffer.push(0x02);            // left arrow
  run(sim, 2);
  assert.equal(f.fxq(), 1728, 'one cell left');
  run(sim, 8);

  // a held key does not hop again while the animation runs
  sim.kbdBuffer.push(0x64);
  run(sim, 1);
  sim.kbdBuffer.push(0x64);
  run(sim, 1);
  assert.equal(f.fxq(), 1856, 'one hop only');
  run(sim, 8);

  // vertical hops, with the road's cars possibly killing the frog after
  // the lane has changed: reset the death state between checks
  f.set(0x831, 10); f.set(0x833, 0); f.set(0x832, 0);
  sim.kbdBuffer.push(0x73);            // s
  run(sim, 2);
  assert.equal(f.lane(), 11, 'down to the bank');

  f.set(0x831, 10); f.set(0x833, 0); f.set(0x832, 0);
  sim.kbdBuffer.push(0x77);            // w
  run(sim, 2);
  assert.equal(f.lane(), 9, 'up from the road');

  f.set(0x831, 0); f.set(0x833, 0); f.set(0x832, 0);
  sim.kbdBuffer.push(0x73);            // down from the top bank
  run(sim, 2);
  assert.equal(f.lane(), 1, 'down into the top river lane');
});

test('the frog rides the log under it', () => {
  const sim = start();
  run(sim, 60);
  const sym = frogger.symbols;
  const word = (a) => sim.memory[BLOCK + a] & 0xFFFF;
  const col = word(0x800) & 31;        // lane table 0 = river 5
  const fine = (word(0x809) & 31) >> 2;
  const mask = word(sym.fr_pmask);
  const runLen = word(sym.fr_runs);
  // Pick the middle of a log, not its leading edge.
  let best = null;
  let from = -1;
  for (let px = 192; px <= 611; px++) {
    const on = px <= 610 && ((((fine + (px + 15) - 192) >> 3) + col) & mask) < runLen;
    if (on && from < 0) from = px;
    if (!on && from >= 0) {
      if (!best || px - from > best.to - best.from) best = { from, to: px };
      from = -1;
    }
  }
  assert.ok(best, 'found a log');
  const x = (best.from + best.to) >> 1;
  sim.memory[BLOCK + 0x831] = 1;       // top river lane
  sim.memory[BLOCK + 0x830] = x * 4;
  run(sim, 6);
  const after = word(0x830);
  // the lane runs right at one pixel per frame
  assert.equal(after, x * 4 + 24, 'carried by the log');
});

// Shared frog/state helpers for the hazard tests.
function frogState(sim) {
  const word = (a) => sim.memory[BLOCK + a] & 0xFFFF;
  return {
    word,
    lane: () => word(0x831),
    fxq: () => word(0x830),
    dead: () => word(0x833),
    time: () => word(0x820),
    set(a, v) { sim.memory[BLOCK + a] = v; },
    setLaneX(lane, xpx) { this.set(0x831, lane); this.set(0x830, xpx * 4); },
  };
}

function laneCellWord(sim, table) {
  const sym = frogger.symbols;
  const word = (a) => sim.memory[BLOCK + a] & 0xFFFF;
  const col = word(0x800 + table) & 31;
  const fine = (word(0x809 + table) & 31) >> 2;
  const mask = word(sym.fr_pmask + table);
  const run = word(sym.fr_runs + table);
  return (px) => ((((fine + (px + 15) - 192) >> 3) + col) & mask) < run;
}

test('water without a log is a splash, then a respawn', () => {
  const sim = start();
  run(sim, 40);
  const f = frogState(sim);
  const onLog = laneCellWord(sim, 0);          // lane 1 = river 5
  let x = -1;
  for (let px = 192; px <= 610 && x < 0; px++) if (!onLog(px)) x = px;
  assert.ok(x >= 0, 'found open water');
  f.setLaneX(1, x);
  run(sim, 2);
  assert.ok(f.dead() > 0, 'splash starts a death');
  run(sim, 30);
  assert.equal(f.dead(), 0, 'death finished');
  assert.equal(f.lane(), 11, 'back on the bottom bank');
  assert.equal(f.fxq(), 1728);
  assert.equal(f.time(), 23, 'timer refilled');
});

test('a vehicle on the road squashes the frog', () => {
  const sim = start();
  run(sim, 40);
  const f = frogState(sim);
  const onCar = laneCellWord(sim, 8);          // lane 10 = road 1
  let x = -1;
  for (let px = 192; px <= 610 && x < 0; px++) if (onCar(px)) x = px;
  assert.ok(x >= 0, 'found a car');
  f.setLaneX(10, x);
  run(sim, 3);
  assert.ok(f.dead() > 0, 'squash starts a death');
});

test('the timer running out kills the frog', () => {
  const sim = start();
  run(sim, 40);
  const f = frogState(sim);
  f.set(0x820, 0);                             // FR_TIME
  f.set(0x821, 63);                            // FR_TICK
  run(sim, 2);
  assert.ok(f.dead() > 0, 'timeout starts a death');
});

test('riding past the playfield edge kills the frog', () => {
  const sim = start();
  run(sim, 40);
  const f = frogState(sim);
  const onLog = laneCellWord(sim, 0);
  // river 5 runs right: sit on a log close enough to be carried out
  let x = -1;
  for (let px = 610; px >= 560 && x < 0; px--) if (onLog(px)) x = px;
  assert.ok(x >= 0, 'found a log near the edge');
  f.setLaneX(1, x);
  run(sim, 4);
  assert.ok(f.dead() > 0, 'carried off the edge');
});

// A home frog sprite in OAM slot 1 + bay.
function homeOam(sim, bay) {
  const d = 1 + bay;
  return [sim.memory[0xF6000 + d * 2], sim.memory[0xF6001 + d * 2]];
}

test('the frog lands in a bay and comes back to the bank', () => {
  const sim = start();
  run(sim, 40);
  const f = frogState(sim);
  // Bay 2 is centred on screen x 400; hop up from the river lane above it.
  f.setLaneX(1, 400);
  f.set(0x832, 0);
  sim.kbdBuffer.push(0x77);
  run(sim, 2);
  assert.equal(f.word(0x834), 1 << 2, 'third bay filled');
  assert.equal(f.lane(), 11, 'back on the bank');
  assert.equal(f.fxq(), 1728, 'back on the bay lattice');
  assert.equal(f.time(), 23, 'timer refilled');
  const [w0, w1] = homeOam(sim, 2);
  assert.equal(w0 & 0x800, 0x800, 'home frog enabled');
  assert.equal(w0 & 0x3ff, 400, 'in the middle of the bay');
  assert.equal(w1 >> 11, 3, 'home frog frame');
  assert.equal(w1 & 0x3ff, 1, 'in the home row');
});

test('the hedge and a filled bay kill the frog', () => {
  const sim = start();
  run(sim, 40);
  const f = frogState(sim);
  // Between bay 0 and bay 1: the hedge at screen x 312.
  f.set(0x831, 0);
  f.set(0x830, 312 * 4);
  f.set(0x833, 0);
  f.set(0x832, 0);
  run(sim, 1);
  assert.ok(f.dead() > 0, 'the hedge is a death');

  run(sim, 30);
  f.set(0x834, 1);                       // bay 0 already filled
  f.set(0x831, 0);
  f.set(0x830, 272 * 4);
  f.set(0x833, 0);
  f.set(0x832, 0);
  run(sim, 1);
  assert.ok(f.dead() > 0, 'a used bay is a death');
  assert.equal(f.word(0x834), 1, 'the filled bay is unchanged');
});

test('a bay takes the frog anywhere its art fits', () => {
  const sim = start();
  run(sim, 40);
  const f = frogState(sim);
  // Bay 0 spans screen x 264..311; the frog's 30-px art fits at x 281.
  f.set(0x831, 0);
  f.set(0x830, 281 * 4);
  f.set(0x833, 0);
  f.set(0x832, 0);
  run(sim, 1);
  assert.equal(f.dead(), 0, 'fits in the bay');
  assert.equal(f.word(0x834), 1, 'bay 0 filled');

  // One pixel further right its art would stick out of the opening.
  f.set(0x831, 0);
  f.set(0x830, 282 * 4);
  f.set(0x833, 0);
  f.set(0x832, 0);
  run(sim, 1);
  assert.ok(f.dead() > 0, 'the hedge takes the overflow');
});

test('the fifth bay completes the level and speeds the lanes up', () => {
  const sim = start();
  run(sim, 40);
  const f = frogState(sim);
  const sym = frogger.symbols;
  const speeds = () => Array.from({ length: 9 }, (_, i) => f.word(sym.fr_speeds + i));
  const before = speeds();

  f.set(0x834, 0x1e);                    // four bays already filled
  f.set(0x831, 1);
  f.set(0x830, 272 * 4);
  f.set(0x832, 0);
  sim.kbdBuffer.push(0x77);
  run(sim, 2);
  assert.equal(f.word(0x834), 0x1f, 'all five bays filled');
  assert.ok(f.word(0x836) > 0, 'level pause armed');
  assert.equal(f.lane(), 11, 'back on the bank');

  const frozen = f.time();
  run(sim, 20);
  assert.equal(f.time(), frozen, 'timer frozen during the pause');
  assert.ok(f.word(0x836) > 0, 'still pausing');

  run(sim, 110);
  assert.equal(f.word(0x836), 0, 'pause over');
  assert.equal(f.word(0x834), 0, 'bays cleared for the next level');
  assert.equal(f.word(0x835), 1, 'level counted');
  assert.deepEqual(speeds(), before.map((s) => s + 1), 'every lane one step faster');
  assert.equal(f.lane(), 11, 'the next life starts on the bank');
});
