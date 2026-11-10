// Pac-Man: the generated maze, the block layout, and the game state machine on
// the JS core.  The game is assembled with .org 0 and placed at 0x4330, so the
// test loads it there and drives the frame flag and UART itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './helpers.js';
import {
  buildPacman, checkPacman, PACMAN_SEG_BASE, PACMAN_LIMIT,
} from '../scripts/make_showcase.mjs';
import { pacmanDotCount, pacmanMazeWords } from '../scripts/make_pacman_art.mjs';
import {
  buildSlices, SLICE_WORDS, TYPES, BINARY_MAGIC, BINARY_VERSION,
} from '../scripts/make_slices.mjs';

for (const f of ['js/deep16_assembler.js', 'js/deep16_simulator.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const Assembler = vm.runInThisContext('Deep16Assembler');
const Simulator = vm.runInThisContext('Deep16Simulator');

const FRAME_PERIOD = 0x400;
const STATUS = 0xF0066;
const RET_PC = 0x0777;
const BLOCK = PACMAN_SEG_BASE;
const SRC = ['asm/showcase/pacman_map.asm', 'asm/showcase/pacman_game.asm']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const S = new Assembler().assemble(SRC).symbols;

const pacman = buildPacman();
checkPacman(pacman);

test('the maze packs 30x23 cells and 250 pickups', () => {
  assert.equal(pacmanMazeWords().length, 92);
  assert.equal(pacmanDotCount(), 250, '246 small dots + 4 power-ups');
});

test('the block fits before the BIOS and keeps the map below the code', () => {
  assert.ok(pacman.codeEnd <= 0x610, `code ends at 0x${pacman.codeEnd.toString(16)}`);
  assert.ok(pacman.codeMax < PACMAN_LIMIT);
  const at = (a) => pacman.words.find((w) => w[0] === a)?.[1];
  assert.equal(at(0x610) !== undefined, true, 'map starts at 0x610');
  assert.equal(pacman.words.some(([a]) => a >= 0x6A0 && a < 0x1000), false, 'state cells stay unwritten');
  assert.equal(BLOCK + pacman.codeMax + 1 <= 0x4A00, true, 'code stays below the BIOS');
});

function start() {
  const sim = new Simulator();
  sim.memory.fill(0);
  for (const [addr, value] of pacman.words) sim.memory[BLOCK + addr] = value;
  sim.d16nano = true;
  sim.segmentRegisters = { CS: 0x0433, DS: 0x0433, SS: 0, ES: 0 };
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

const st = (sim, name) => sim.memory[BLOCK + S[name]];

// One game frame = FRAME_PERIOD steps; the frame bit toggles and a queued UART
// byte keeps bit 3 set until the game reads it.
function run(sim, frames, { key = 0, keyFrame = -1, before = null } = {}) {
  for (let frame = 0; frame < frames; frame++) {
    if (frame === keyFrame) sim.kbdBuffer.push(key);
    if (before) before(frame, sim);
    const status = ((frame & 1) ? 2 : 0) | (sim.uartRxAvailable() > 0 ? 8 : 0);
    sim.memory[STATUS] = status;
    for (let i = 0; i < FRAME_PERIOD && sim.running; i++) sim.step();
  }
}

// Step until the game leaves CS 0x0433 (the far return to the menu), so the
// caller can check the return pair before the zeros after RET_PC run on.
function runToExit(sim, frames, key = 0) {
  for (let frame = 0; frame < frames; frame++) {
    if (key) sim.kbdBuffer.push(key);
    sim.memory[STATUS] = ((frame & 1) ? 2 : 0) | (sim.uartRxAvailable() > 0 ? 8 : 0);
    for (let i = 0; i < FRAME_PERIOD; i++) {
      sim.step();
      if (sim.segmentRegisters.CS !== 0x0433) return true;
    }
  }
  return false;
}

test('the maze draws, Pac-Man moves, and a dot scores ten points', () => {
  const sim = start();
  run(sim, 320);
  assert.equal(st(sim, 'ST_DOTS'), 250);
  assert.deepEqual([st(sim, 'ST_PAC_C'), st(sim, 'ST_PAC_R')], [14, 16]);

  // Right is open: hold D long enough to eat one dot.
  run(sim, 20, { key: 0x64, keyFrame: 0 });
  assert.ok(st(sim, 'ST_PAC_C') > 14, 'Pac-Man moved right');
  assert.ok(st(sim, 'ST_SC1') >= 1, 'dots score ten points each');
  assert.equal(st(sim, 'ST_DOTS'), 250 - st(sim, 'ST_SC1'), 'each dot is eaten once');
});

test('the last dot wins and the banner returns to the menu after ten seconds', () => {
  const sim = start();
  run(sim, 320, {
    before: (frame, s) => { if (frame === 300) s.memory[BLOCK + S.ST_DOTS] = 1; },
  });
  // The cell left of the start pair is a dot.
  run(sim, 10, { key: 0x61, keyFrame: 0 });
  assert.equal(st(sim, 'ST_DOTS'), 0);
  assert.equal(st(sim, 'ST_STATE'), 2, 'win state');
  assert.ok(st(sim, 'ST_TIMER') > 550, 'ten-second banner is counting down');
  assert.equal(runToExit(sim, 700), true, 'banner returns to the menu');
  assert.equal(sim.segmentRegisters.CS, 0x04A0);
  assert.equal(sim.registers[15], RET_PC);
});

test('a frightened ghost is worth 200 and goes back to the corridor', () => {
  const sim = start();
  run(sim, 320);
  sim.memory[BLOCK + S.ST_GHOST_C] = st(sim, 'ST_PAC_C');
  sim.memory[BLOCK + S.ST_GHOST_R] = st(sim, 'ST_PAC_R');
  sim.memory[BLOCK + S.ST_FRIGHT] = 100;
  sim.registers[15] = S.pac_collide;
  run(sim, 2);
  assert.equal(st(sim, 'ST_STATE'), 0, 'Pac-Man survives');
  assert.equal(st(sim, 'ST_SC2'), 2, '200 points');
  assert.deepEqual([sim.memory[BLOCK + S.ST_GHOST_C], sim.memory[BLOCK + S.ST_GHOST_R]], [14, 9]);
});

test('a collision with a ghost ends the game and Q exits early', () => {
  const sim = start();
  run(sim, 320);
  // Put a ghost on Pac-Man's cell and enter the collision routine directly
  // (a real ghost tick would move the ghost off the cell first).
  sim.memory[BLOCK + S.ST_GHOST_C] = st(sim, 'ST_PAC_C');
  sim.memory[BLOCK + S.ST_GHOST_R] = st(sim, 'ST_PAC_R');
  sim.registers[15] = S.pac_collide;
  run(sim, 2);
  assert.equal(st(sim, 'ST_STATE'), 1, 'death state');
  assert.equal(runToExit(sim, 20, 0x71), true, 'Q leaves the death banner');
  assert.equal(sim.segmentRegisters.CS, 0x04A0);
  assert.equal(sim.registers[15], RET_PC);
});
