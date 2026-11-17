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
const START = 0xA00;
const PHASE = 0xA09;

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

function start({ play = true } = {}) {
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
  // The game enters in attract; the first frame consumes the start key.
  if (play) sim.kbdBuffer.push(0x20);
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
  const time = sim.memory[BLOCK + 0xA20];
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
  assert.equal(f.word(0xA32), 0, 'no hop animation');

  // horizontal hops stay on the safe bottom bank
  sim.kbdBuffer.push(0x64);            // d
  run(sim, 2);
  assert.equal(f.fxq(), 1856, 'one cell right');
  assert.ok(f.word(0xA32) > 0, 'hop animation armed');
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
  f.set(0xA37, 1); f.set(0xA31, 10); f.set(0xA33, 0); f.set(0xA32, 0);
  sim.kbdBuffer.push(0x73);            // s
  run(sim, 2);
  assert.equal(f.lane(), 11, 'down to the bank');

  f.set(0xA37, 1); f.set(0xA31, 10); f.set(0xA33, 0); f.set(0xA32, 0);
  sim.kbdBuffer.push(0x77);            // w
  run(sim, 2);
  assert.equal(f.lane(), 9, 'up from the road');

  f.set(0xA37, 1); f.set(0xA31, 0); f.set(0xA33, 0); f.set(0xA32, 0);
  sim.kbdBuffer.push(0x73);            // down from the top bank
  run(sim, 2);
  assert.equal(f.lane(), 1, 'down into the top river lane');
});

test('the frog rides the log under it', () => {
  const sim = start();
  run(sim, 60);
  const sym = frogger.symbols;
  const word = (a) => sim.memory[BLOCK + a] & 0xFFFF;
  const col = word(0xA00) & 31;        // lane table 0 = river 5
  const fine = (word(0xA09) & 31) >> 2;
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
  sim.memory[BLOCK + 0xA31] = 1;       // top river lane
  sim.memory[BLOCK + 0xA30] = x * 4;
  run(sim, 6);
  const after = word(0xA30);
  // the lane runs right at one pixel per frame
  assert.equal(after, x * 4 + 24, 'carried by the log');
});

// Shared frog/state helpers for the hazard tests.
function frogState(sim) {
  const word = (a) => sim.memory[BLOCK + a] & 0xFFFF;
  return {
    word,
    lane: () => word(0xA31),
    fxq: () => word(0xA30),
    dead: () => word(0xA33),
    time: () => word(0xA20),
    set(a, v) { sim.memory[BLOCK + a] = v; },
    setLaneX(lane, xpx) { this.set(0xA31, lane); this.set(0xA30, xpx * 4); },
  };
}

function laneCellWord(sim, table) {
  const sym = frogger.symbols;
  const word = (a) => sim.memory[BLOCK + a] & 0xFFFF;
  const col = word(0xA00 + table) & 31;
  const fine = (word(0xA09 + table) & 31) >> 2;
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
  f.set(0xA20, 0);                             // FR_TIME
  f.set(0xA21, 63);                            // FR_TICK
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
  f.set(0xA32, 0);
  sim.kbdBuffer.push(0x77);
  run(sim, 2);
  assert.equal(f.word(0xA34), 1 << 2, 'third bay filled');
  assert.equal(f.lane(), 11, 'back on the bank');
  assert.equal(f.fxq(), 1728, 'back on the bay lattice');
  assert.equal(f.time(), 23, 'timer refilled');
  const [w0, w1] = homeOam(sim, 2);
  assert.equal(w0 & 0x800, 0x800, 'home frog enabled');
  assert.equal(w0 & 0x3ff, 400, 'in the middle of the bay');
  assert.equal(w1 >> 11, 5, 'home frog frame');
  assert.equal(w1 & 0x3ff, 1, 'in the home row');
});

test('the hedge and a filled bay kill the frog', () => {
  const sim = start();
  run(sim, 40);
  const f = frogState(sim);
  // Between bay 0 and bay 1: the hedge at screen x 312.
  f.set(0xA31, 0);
  f.set(0xA30, 312 * 4);
  f.set(0xA33, 0);
  f.set(0xA32, 0);
  run(sim, 1);
  assert.ok(f.dead() > 0, 'the hedge is a death');

  run(sim, 30);
  f.set(0xA34, 1);                       // bay 0 already filled
  f.set(0xA31, 0);
  f.set(0xA30, 272 * 4);
  f.set(0xA33, 0);
  f.set(0xA32, 0);
  run(sim, 1);
  assert.ok(f.dead() > 0, 'a used bay is a death');
  assert.equal(f.word(0xA34), 1, 'the filled bay is unchanged');
});

test('a bay takes the frog anywhere its art fits', () => {
  const sim = start();
  run(sim, 40);
  const f = frogState(sim);
  // Bay 0 spans screen x 264..311; the frog's 30-px art fits at x 281.
  f.set(0xA31, 0);
  f.set(0xA30, 281 * 4);
  f.set(0xA33, 0);
  f.set(0xA32, 0);
  run(sim, 1);
  assert.equal(f.dead(), 0, 'fits in the bay');
  assert.equal(f.word(0xA34), 1, 'bay 0 filled');

  // One pixel further right its art would stick out of the opening.
  f.set(0xA31, 0);
  f.set(0xA30, 282 * 4);
  f.set(0xA33, 0);
  f.set(0xA32, 0);
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

  f.set(0xA34, 0x1e);                    // four bays already filled
  f.set(0xA31, 1);
  f.set(0xA30, 272 * 4);
  f.set(0xA32, 0);
  sim.kbdBuffer.push(0x77);
  run(sim, 2);
  assert.equal(f.word(0xA34), 0x1f, 'all five bays filled');
  assert.ok(f.word(0xA36) > 0, 'level pause armed');
  assert.equal(f.word(0xA37), 3, 'in the level pause');
  assert.equal(f.lane(), 11, 'back on the bank');

  const frozen = f.time();
  run(sim, 20);
  assert.equal(f.time(), frozen, 'timer frozen during the pause');
  assert.ok(f.word(0xA36) > 0, 'still pausing');

  run(sim, 110);
  assert.equal(f.word(0xA36), 0, 'pause over');
  assert.equal(f.word(0xA37), 1, 'back in play');
  assert.equal(f.word(0xA34), 0, 'bays cleared for the next level');
  assert.equal(f.word(0xA35), 1, 'level counted');
  assert.deepEqual(speeds(), before.map((s) => s + 1), 'every lane one step faster');
  assert.equal(f.lane(), 11, 'the next life starts on the bank');
});

test('a vehicle touches the frog, not its whole cell', () => {
  const sim = start();
  run(sim, 40);
  const f = frogState(sim);
  const sym = frogger.symbols;
  for (let i = 0; i < 9; i++) f.set(sym.fr_speeds + i, 0);   // freeze the lanes
  run(sim, 3);

  const lane = 8;                       // road 3, the yellow car
  const table = 6;
  const laneStart = f.word(0xA00 + table) & 31;
  const fine = (f.word(0xA09 + table) & 31) >> 2;
  const mask = f.word(sym.fr_pmask + table);
  const runLen = f.word(sym.fr_runs + table);
  // A car well inside the playfield: its 32-px cell box starts at S.
  let first = -1;
  for (let c = 8; c <= 40; c++) {
    if (((c + laneStart) & mask) < runLen) { first = c; break; }
  }
  assert.ok(first >= 0, 'found a car');
  const S = 192 + first * 8 - fine;
  const E = S + runLen * 8;
  assert.ok(S > 220 && E < 600, `car box ${S}..${E} is inside the field`);

  const place = (x) => {
    f.set(0xA37, 1);                   // back to play between probes
    f.set(0xA33, 0);
    f.set(0xA32, 0);
    f.set(0xA31, lane);
    f.set(0xA30, x * 4);
  };
  place(S - 29);
  run(sim, 1);
  assert.equal(f.dead(), 0, 'one pixel of daylight is safe');
  place(S - 28);
  run(sim, 1);
  assert.ok(f.dead() > 0, 'the frog box meeting the car squashes');

  place(E - 4);
  run(sim, 1);
  assert.ok(f.dead() > 0, 'still touched at the car right edge');
  place(E - 3);
  run(sim, 1);
  assert.equal(f.dead(), 0, 'clear of the car again');
});

// Read n text cells from a tilemap row of the last-written bank.
function hudText(sim, row, col, n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const cell = sim.memory[0xF1000 + row * 82 + col + i];
    out += cell & 0x8000 ? String.fromCharCode(((cell >> 5) & 0x7f) + 0x20) : '?';
  }
  return out;
}

// Middle of the widest object (or water) run under a lane's frog line.
function laneRun(sim, table, object) {
  const sym = frogger.symbols;
  const f = frogState(sim);
  const col = f.word(0xA00 + table) & 31;
  const fine = (f.word(0xA09 + table) & 31) >> 2;
  const mask = f.word(sym.fr_pmask + table);
  const run = f.word(sym.fr_runs + table);
  const on = (px) => ((((fine + (px + 15) - 192) >> 3) + col) & mask) < run;
  let best = null;
  let from = -1;
  for (let px = 192; px <= 611; px++) {
    const want = px <= 610 && (on(px) === object);
    if (want && from < 0) from = px;
    if (!want && from >= 0) {
      if (!best || px - from > best.to - best.from) best = { from, to: px };
      from = -1;
    }
  }
  assert.ok(best, `found a ${object ? 'log' : 'water'} run`);
  return (best.from + best.to) >> 1;
}

test('the board waits in attract for Space', () => {
  const sim = start({ play: false });
  run(sim, 80);
  const f = frogState(sim);
  assert.equal(f.word(0xA37), 0, 'attract');
  assert.equal(f.time(), 23, 'clock frozen');
  assert.equal(f.lane(), 11, 'frog on the bank');
  assert.equal(hudText(sim, 0, 2, 11), 'SCORE 00000');
  assert.equal(hudText(sim, 1, 2, 8), 'HI 00000');
  assert.equal(hudText(sim, 23, 2, 7), 'LIVES 3');
  assert.match(hudText(sim, 10, 0, 24), /PRESS SPACE/);

  sim.kbdBuffer.push(0x77);
  run(sim, 2);
  assert.equal(f.lane(), 11, 'directions are ignored in attract');

  sim.kbdBuffer.push(0x20);
  run(sim, 4);
  assert.equal(f.word(0xA37), 1, 'Space starts play');
  assert.equal(f.word(0xA38), 3, 'three lives');
  assert.doesNotMatch(hudText(sim, 10, 0, 24), /PRESS SPACE/);
  run(sim, 70);
  assert.ok(f.time() < 23, 'the clock runs in play');
});

test('a forward hop scores ten and the HUD follows', () => {
  const sim = start();
  run(sim, 10);
  const f = frogState(sim);
  sim.kbdBuffer.push(0x64);              // sideways
  run(sim, 8);
  assert.equal(f.word(0xA39), 0, 'sideways is free');
  sim.kbdBuffer.push(0x77);              // forward
  run(sim, 3);
  assert.equal(f.word(0xA39), 10, 'ten for a forward hop');
  assert.equal(hudText(sim, 0, 2, 11), 'SCORE 00010');
  assert.equal(hudText(sim, 1, 2, 8), 'HI 00010', 'hi-score follows');
});

test('a home pays 50 plus the remaining time', () => {
  const sim = start();
  run(sim, 10);
  const f = frogState(sim);
  const time = f.time();
  f.set(0xA37, 1);
  f.set(0xA31, 0);
  f.set(0xA30, 400 * 4);
  f.set(0xA33, 0);
  f.set(0xA32, 0);
  run(sim, 2);
  assert.equal(f.word(0xA34) & 4, 4, 'bay 2 filled');
  assert.equal(f.word(0xA39), 50 + 10 * time, 'bay and time bonus');
});

test('each death costs a life and the last one ends the game', () => {
  const sim = start();
  run(sim, 10);
  const f = frogState(sim);
  const die = () => {
    const x = laneRun(sim, 0, false);
    f.set(0xA37, 1);
    f.set(0xA31, 1);
    f.set(0xA30, x * 4);
    f.set(0xA33, 0);
    f.set(0xA32, 0);
    run(sim, 2);
  };

  die();
  assert.equal(f.word(0xA38), 2, 'two lives left');
  assert.equal(f.word(0xA37), 2, 'dying');
  run(sim, 30);
  assert.equal(f.word(0xA37), 1, 'back in play');
  assert.equal(f.word(0xA38), 2);

  f.set(0xA38, 1);
  die();
  assert.equal(f.word(0xA38), 0, 'no lives left');
  run(sim, 30);
  assert.equal(f.word(0xA37), 4, 'game over');
  assert.equal(sim.memory[0xF6000] & 0x800, 0, 'the frog is hidden');
  assert.match(hudText(sim, 10, 0, 24), /GAME OVER/);

  const lane = f.lane();
  sim.kbdBuffer.push(0x77);
  run(sim, 2);
  assert.equal(f.lane(), lane, 'keys are ignored at game over');

  sim.kbdBuffer.push(0x20);
  run(sim, 4);
  assert.equal(f.word(0xA37), 1, 'Space restarts');
  assert.equal(f.word(0xA38), 3, 'three lives again');
  assert.equal(f.word(0xA39), 0, 'score reset');
  assert.doesNotMatch(hudText(sim, 10, 0, 24), /GAME OVER/);
});

test('20000 points buys one extra life', () => {
  const sim = start();
  run(sim, 10);
  const f = frogState(sim);
  const hopSafe = () => {
    const x = laneRun(sim, 0, true);      // lane 1's log under the frog
    f.set(0xA37, 1);
    f.set(0xA31, 2);
    f.set(0xA30, x * 4);
    f.set(0xA33, 0);
    f.set(0xA32, 0);
    sim.kbdBuffer.push(0x77);
    run(sim, 3);
  };

  f.set(0xA39, 19990);
  f.set(0xA38, 3);
  f.set(0xA3B, 0);
  hopSafe();
  assert.equal(f.word(0xA39), 20000);
  assert.equal(f.word(0xA38), 4, 'one more life');
  assert.equal(f.word(0xA3B), 1, 'the bonus is taken');

  f.set(0xA39, 19990);
  f.set(0xA38, 3);
  hopSafe();
  assert.equal(f.word(0xA39), 20000);
  assert.equal(f.word(0xA38), 3, 'the bonus is only paid once');
});

test('the frog faces the way it jumped', () => {
  const sim = start();
  run(sim, 10);
  const f = frogState(sim);
  const face = () => {
    const w0 = sim.memory[0xF6000];
    assert.equal(!!(w0 & 0x8000), false, 'not hidden behind the background');
    return {
      group: (sim.memory[0xF6001] >> 11) & 0x1f,
      h: !!(w0 & 0x2000),
      v: !!(w0 & 0x4000),
    };
  };
  assert.deepEqual(face(), { group: 0, h: false, v: false }, 'faces up at rest');

  sim.kbdBuffer.push(0x64);            // right
  run(sim, 1);
  assert.deepEqual(face(), { group: 3, h: false, v: false }, 'the hop faces right');
  run(sim, 8);
  assert.deepEqual(face(), { group: 1, h: false, v: false }, 'rests facing right');

  sim.kbdBuffer.push(0x61);            // left
  run(sim, 1);
  assert.deepEqual(face(), { group: 3, h: true, v: false }, 'the hop faces left');
  run(sim, 8);
  assert.deepEqual(face(), { group: 1, h: true, v: false }, 'rests facing left');

  f.set(0xA37, 1); f.set(0xA31, 10); f.set(0xA33, 0); f.set(0xA32, 0);
  sim.kbdBuffer.push(0x73);            // down, onto the bank
  run(sim, 2);
  assert.deepEqual(face(), { group: 2, h: false, v: true }, 'the hop faces down');
  run(sim, 8);
  assert.deepEqual(face(), { group: 0, h: false, v: true }, 'rests facing down');

  const x = laneRun(sim, 4, true);     // lane 5's turtles
  f.set(0xA37, 1); f.set(0xA31, 6); f.set(0xA30, x * 4);
  f.set(0xA33, 0); f.set(0xA32, 0);
  sim.kbdBuffer.push(0x77);            // up, onto the turtles
  run(sim, 2);
  assert.deepEqual(face(), { group: 2, h: false, v: false }, 'the hop faces up');
  run(sim, 8);
  assert.deepEqual(face(), { group: 0, h: false, v: false }, 'rests facing up');
});

test('the road keeps an arcade-sized gap to wait in', () => {
  const sym = frogger.symbols;
  const at = (a) => frogger.words.find(([x]) => x === a)?.[1] ?? 0;
  const names = ['truck', 'yellow car', 'fire truck', 'blue car'];
  for (let i = 0; i < 4; i++) {
    const table = 5 + i;
    const period = (at(sym.fr_pmask + table) + 1) * 8;
    const cols = at(sym.fr_cols + table);
    const art = cols * 8 - 2 * (cols === 8 ? 4 : 3);
    const speed = at(sym.fr_speeds + table) / 4;
    const gap = period - art;
    assert.ok(gap >= 80, `${names[i]}: ${gap} px between vehicles`);
    const window = (gap - 26) / speed;         // 26 px is the frog's box
    assert.ok(window >= 70,
      `${names[i]}: ${window.toFixed(0)} frames of waiting room`);
  }
});
