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
import {
  pacmanDotCount, pacmanMazeWords, pacmanArtTiles, T_GHOST_L,
  T_FRIGHT_L, T_FLASH_L, T_FRUIT_L, GHOST_COLOURS,
  pacmanRuntimeSpriteFrames, spriteFrameWords,
} from '../scripts/make_pacman_art.mjs';

for (const f of ['js/deep16_assembler.js', 'js/deep16_simulator.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const Assembler = vm.runInThisContext('Deep16Assembler');
const Simulator = vm.runInThisContext('Deep16Simulator');

// The game now does more per frame (four ghost timers, ARM-style colours,
// cherries and the munch animator), so a simulated frame gets more steps than
// the old 0x400.  The timers themselves still count game loops, not steps.
const FRAME_PERIOD = 0x800;
const STATUS = 0xF0066;
const RET_PC = 0x0777;
const BLOCK = PACMAN_SEG_BASE;
const SRC = ['asm/showcase/pacman_map.asm', 'asm/showcase/pacman_game.asm']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const S = new Assembler().assemble(SRC).symbols;

const pacman = buildPacman();
checkPacman(pacman);

test('the maze packs 32x24 cells and 244 pickups', () => {
  assert.equal(pacmanMazeWords().length, 96);
  assert.equal(pacmanDotCount(), 244, '240 small dots + 4 power-ups');
});

test('the block keeps code below the map and data below the tile pack', () => {
  assert.ok(pacman.codeEnd <= 0x900, `code ends at 0x${pacman.codeEnd.toString(16)}`);
  assert.ok(pacman.codeMax < PACMAN_LIMIT);
  const at = (a) => pacman.words.find((w) => w[0] === a)?.[1];
  assert.equal(at(0x900) !== undefined, true, 'map starts at 0x900');
  assert.equal(pacman.words.some(([a]) => a >= 0x9A0 && a < 0xA00), false, 'state cells stay unwritten');
  assert.ok(pacman.codeMax < 0x1000, 'code and data stay below the tile pack');
});

test('the art pack carries four ghost colours, fright, flash and cherries', () => {
  const tiles = new Map(pacmanArtTiles().map((t) => [t.index, t.grid]));
  const body = (grid) => {
    // the body colour is the most common non-zero pixel value
    const counts = new Map();
    for (const row of grid) for (const px of row) if (px) counts.set(px, (counts.get(px) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  GHOST_COLOURS.forEach((colour, i) => {
    assert.equal(body(tiles.get(T_GHOST_L + i * 2)), colour, `ghost ${i} body colour`);
  });
  assert.equal(body(tiles.get(T_FRIGHT_L)), 6, 'frightened body is blue');
  assert.equal(body(tiles.get(T_FLASH_L)), 1, 'flashing body is white');
  assert.ok(tiles.has(T_FRUIT_L) && tiles.has(T_FRUIT_L + 1), 'cherries use two tiles');
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
  sim._frame = 0;
  return sim;
}

const st = (sim, name) => sim.memory[BLOCK + S[name]];
const put = (sim, name, value) => { sim.memory[BLOCK + S[name]] = value; };
const tileAt = (sim, r, c) => (sim.memory[0xF1000 + r * 82 + c] | 0) >> 5;

// One game frame = FRAME_PERIOD steps; the frame bit toggles and a queued UART
// byte keeps bit 3 set until the game reads it.
function run(sim, frames, { key = 0, keyFrame = -1, before = null } = {}) {
  for (let frame = 0; frame < frames; frame++) {
    if (frame === keyFrame) sim.kbdBuffer.push(key);
    if (before) before(frame, sim);
    const status = ((sim._frame++ & 1) ? 2 : 0) | (sim.uartRxAvailable() > 0 ? 8 : 0);
    sim.memory[STATUS] = status;
    for (let i = 0; i < FRAME_PERIOD && sim.running; i++) sim.step();
  }
}

// Step until the game leaves CS 0x0433 (the far return to the menu), so the
// caller can check the return pair before the zeros after RET_PC run on.
function runToExit(sim, frames, key = 0) {
  for (let frame = 0; frame < frames; frame++) {
    if (key) sim.kbdBuffer.push(key);
    sim.memory[STATUS] = ((sim._frame++ & 1) ? 2 : 0) | (sim.uartRxAvailable() > 0 ? 8 : 0);
    for (let i = 0; i < FRAME_PERIOD; i++) {
      sim.step();
      if (sim.segmentRegisters.CS !== 0x0433) return true;
    }
  }
  return false;
}

function parkGhosts(sim) {
  for (let i = 0; i < 4; i++) sim.memory[BLOCK + S.ST_GHOST_T0 + i] = 500;
}

test('the maze draws, Pac-Man moves, and a dot scores ten points', () => {
  const sim = start();
  run(sim, 320);
  assert.equal(st(sim, 'ST_DOTS'), 244);
  assert.deepEqual([st(sim, 'ST_PAC_C'), st(sim, 'ST_PAC_R')], [15, 17]);

  // Left of the start pair is a dot; start the move clock so the test is
  // independent of the timer phase.
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 40, { key: 0x64, keyFrame: 0 });
  assert.ok(st(sim, 'ST_PAC_C') > 15, 'Pac-Man moved right');
  assert.ok(st(sim, 'ST_SC1') >= 1, 'dots score ten points each');
  assert.equal(st(sim, 'ST_DOTS'), 244 - st(sim, 'ST_SC1'), 'each dot is eaten once');
});

test('Pac-Man slows down after eating a dot', () => {
  const sim = start();
  run(sim, 320);
  put(sim, 'ST_DOTS', 175);
  put(sim, 'ST_PAC_C', 15);
  put(sim, 'ST_PAC_R', 17);
  put(sim, 'ST_PAC_WANT', 3);
  put(sim, 'ST_PAC_TMR', 1);
  parkGhosts(sim);
  run(sim, 1);
  assert.equal(st(sim, 'ST_DOTS'), 174, 'the left arrow ate the dot');
  assert.ok(st(sim, 'ST_PAC_TMR') >= 17, `dot delay adds two frames (${st(sim, 'ST_PAC_TMR')})`);
});

test('the half-open and closed frames are copied into the sprite bank', () => {
  const sim = start();
  run(sim, 320);
  for (const { group, grid } of pacmanRuntimeSpriteFrames()) {
    const expected = spriteFrameWords(grid);
    for (let i = 0; i < expected.length; i++) {
      assert.equal(sim.memory[0xF4000 + group * 256 + i], expected[i],
                   `group ${group} word ${i}`);
    }
  }
});

test('the three-frame munch animation cycles while Pac-Man moves', () => {
  const sim = start();
  run(sim, 320);
  const groups = new Set();
  for (let frame = 0; frame < 40; frame++) {
    run(sim, 1, { key: 0x06, keyFrame: frame === 0 ? 0 : -1 });
    groups.add(((sim.memory[0xF6001] | 0) >> 11) & 31);
  }
  assert.ok(groups.has(0), 'open frame');
  assert.ok(groups.has(1), 'half-open frame');
  assert.ok(groups.has(10), 'closed frame');
});

test('the arrow keys steer Pac-Man', () => {
  const sim = start();
  run(sim, 320);
  const c0 = st(sim, 'ST_PAC_C');
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 40, { key: 0x06, keyFrame: 0 });   // Right -> C-F
  assert.ok(st(sim, 'ST_PAC_C') > c0, 'the right arrow moved him right');
  const c1 = st(sim, 'ST_PAC_C');
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 60, { key: 0x02, keyFrame: 0 });   // Left -> C-B
  assert.ok(st(sim, 'ST_PAC_C') < c1, 'the left arrow moved him left');
});

test('wall outlines merge, with no line between touching wall cells', () => {
  const sim = start();
  run(sim, 320);
  // Maze row 2, columns 2..6 are a five-wide wall block: row 1 above is open
  // and row 3 below is wall, so every cell has the top edge only.  The block
  // ends take the outer left/right edges, the interior cells take none.
  assert.equal(tileAt(sim, 2, 4), 110 + 3, 'block left: left edge and top');
  assert.equal(tileAt(sim, 2, 5), 118 + 2, 'block left: top only on the right half');
  assert.equal(tileAt(sim, 2, 6), 110 + 2, 'interior left half: top only');
  assert.equal(tileAt(sim, 2, 7), 118 + 2, 'interior right half: top only');
  assert.equal(tileAt(sim, 2, 13), 118 + 3, 'block right: right edge and top');
});

test('the four ghosts keep their arcade colours', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_FRIGHT', 0);
  // Put them on four distinct empty cells in the corridor below the house.
  for (let i = 0; i < 4; i++) {
    sim.memory[BLOCK + S.ST_GHOST_C + i] = 10 + i;
    sim.memory[BLOCK + S.ST_GHOST_R + i] = 13;
  }
  sim.registers[15] = S.pac_draw_ghosts_now;
  run(sim, 1);
  for (let i = 0; i < 4; i++) {
    assert.equal(tileAt(sim, 13, 2 * (10 + i)), T_GHOST_L + 2 * i,
                 `ghost ${i} left colour tile`);
    assert.equal(tileAt(sim, 13, 2 * (10 + i) + 1), T_GHOST_L + 2 * i + 1,
                 `ghost ${i} right colour tile`);
  }
});

test('an energizer scores 50, frightens for six seconds and resets the multiplier', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_PAC_C', 2);
  put(sim, 'ST_PAC_R', 18);
  put(sim, 'ST_PAC_WANT', 3);
  put(sim, 'ST_PAC_TMR', 1);
  put(sim, 'ST_GHOST_EAT', 2);
  run(sim, 22);
  assert.equal(st(sim, 'ST_DOTS'), 243, 'the pellet was eaten');
  assert.equal(st(sim, 'ST_SC1'), 5, 'an energizer is worth 50');
  assert.ok(st(sim, 'ST_FRIGHT') > 300, `six-second fright timer (${st(sim, 'ST_FRIGHT')})`);
  assert.equal(st(sim, 'ST_GHOST_EAT'), 0, 'the ghost-eat multiplier resets');
});

test('frightened ghosts flash white before returning to normal', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_FRIGHT', 110);
  sim.memory[BLOCK + S.ST_GHOST_C] = 10;
  sim.memory[BLOCK + S.ST_GHOST_R] = 13;
  sim.registers[15] = S.pac_draw_ghosts_now;
  run(sim, 1);
  const t = tileAt(sim, 13, 20);
  assert.ok(t === T_FRIGHT_L || t === T_FLASH_L,
            `fright or flash tile, got ${t}`);
});

test('ghost speeds match the arcade: 17 normal, 24 fright, 32 tunnel', () => {
  let sim = start();
  run(sim, 320);
  put(sim, 'ST_PAC_C', 1); put(sim, 'ST_PAC_R', 11);
  sim.memory[BLOCK + S.ST_GHOST_C] = 10;
  sim.memory[BLOCK + S.ST_GHOST_R] = 11;
  put(sim, 'ST_GHOST_T0', 1);
  for (let i = 1; i < 4; i++) sim.memory[BLOCK + S.ST_GHOST_T0 + i] = 500;
  run(sim, 3);
  assert.ok(st(sim, 'ST_GHOST_T0') >= 29, `tunnel timer ${st(sim, 'ST_GHOST_T0')}`);

  sim = start(); run(sim, 320);
  put(sim, 'ST_PAC_C', 1); put(sim, 'ST_PAC_R', 17);
  sim.memory[BLOCK + S.ST_GHOST_C] = 10;
  sim.memory[BLOCK + S.ST_GHOST_R] = 9;
  put(sim, 'ST_GHOST_T0', 1); put(sim, 'ST_FRIGHT', 100);
  for (let i = 1; i < 4; i++) sim.memory[BLOCK + S.ST_GHOST_T0 + i] = 500;
  run(sim, 3);
  assert.ok(st(sim, 'ST_GHOST_T0') >= 20 && st(sim, 'ST_GHOST_T0') <= 24,
            `fright timer ${st(sim, 'ST_GHOST_T0')}`);

  sim = start(); run(sim, 320);
  put(sim, 'ST_PAC_C', 1); put(sim, 'ST_PAC_R', 17);
  sim.memory[BLOCK + S.ST_GHOST_C] = 10;
  sim.memory[BLOCK + S.ST_GHOST_R] = 9;
  put(sim, 'ST_GHOST_T0', 1); put(sim, 'ST_FRIGHT', 0);
  for (let i = 1; i < 4; i++) sim.memory[BLOCK + S.ST_GHOST_T0 + i] = 500;
  run(sim, 3);
  assert.ok(st(sim, 'ST_GHOST_T0') >= 13 && st(sim, 'ST_GHOST_T0') <= 17,
            `normal timer ${st(sim, 'ST_GHOST_T0')}`);
});

test('cherries appear after 70 dots and are worth 100', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_DOTS', 175);
  put(sim, 'ST_PAC_C', 15);
  put(sim, 'ST_PAC_R', 17);
  put(sim, 'ST_PAC_WANT', 3);
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 6);
  assert.equal(st(sim, 'ST_FRUIT_N'), 1, 'the first cherry triggered');
  assert.ok(st(sim, 'ST_FRUIT_T') > 500, 'it stays on screen for about ten seconds');
  assert.equal(tileAt(sim, 13, 30), T_FRUIT_L, 'left cherry tile');
  assert.equal(tileAt(sim, 13, 31), T_FRUIT_L + 1, 'right cherry tile');

  // Step onto the cherries: 10 (dot) + 100 (fruit).
  put(sim, 'ST_PAC_C', 16);
  put(sim, 'ST_PAC_R', 13);
  put(sim, 'ST_PAC_WANT', 3);
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 22);
  assert.equal(st(sim, 'ST_SC2'), 1, 'fruit adds one hundred');
  assert.equal(st(sim, 'ST_SC1'), 1, 'the earlier dot is still ten');
  assert.equal(st(sim, 'ST_FRUIT_ST'), 0, 'the cherries are gone');
  assert.equal(tileAt(sim, 13, 30), 0, 'left cell cleared');
  assert.equal(tileAt(sim, 13, 31), 0, 'right cell cleared');
});

test('the ghost-eat multiplier is 200, 400, 800, 1600', () => {
  const sim = start();
  run(sim, 320);
  assert.deepEqual([0, 1, 2, 3].map((i) => sim.memory[BLOCK + S.pac_ghost_pts + i]),
                   [2, 4, 8, 16]);
  parkGhosts(sim);
  put(sim, 'ST_FRIGHT', 100);
  sim.memory[BLOCK + S.ST_GHOST_C] = st(sim, 'ST_PAC_C');
  sim.memory[BLOCK + S.ST_GHOST_R] = st(sim, 'ST_PAC_R');
  run(sim, 1);
  assert.equal(st(sim, 'ST_SC2'), 2, 'first ghost is 200');
  assert.equal(st(sim, 'ST_GHOST_EAT'), 1);

  sim.memory[BLOCK + S.ST_GHOST_C] = st(sim, 'ST_PAC_C');
  sim.memory[BLOCK + S.ST_GHOST_R] = st(sim, 'ST_PAC_R');
  run(sim, 1);
  assert.equal(st(sim, 'ST_SC2'), 6, 'second ghost is 400');
  assert.equal(st(sim, 'ST_GHOST_EAT'), 2);
});

test('the last dot wins and the banner returns to the menu after ten seconds', () => {
  const sim = start();
  run(sim, 320, {
    before: (frame, s) => { if (frame === 300) s.memory[BLOCK + S.ST_DOTS] = 1; },
  });
  // The cell left of the start pair is a dot.
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 40, { key: 0x61, keyFrame: 0 });
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
  put(sim, 'ST_FRIGHT', 100);
  sim.registers[15] = S.pac_collide_now;
  run(sim, 2);
  assert.equal(st(sim, 'ST_STATE'), 0, 'Pac-Man survives');
  assert.equal(st(sim, 'ST_SC2'), 2, '200 points');
  const gc = sim.memory[BLOCK + S.ST_GHOST_C], gr = sim.memory[BLOCK + S.ST_GHOST_R];
  assert.equal(gr, 9, 'back on the corridor row above the house');
  assert.ok(gc >= 14 && gc <= 17, `back in the house corridor (${gc})`);
});

test('a collision with a ghost ends the game and Q exits early', () => {
  const sim = start();
  run(sim, 320);
  // Put a ghost on Pac-Man's cell and enter the collision routine directly
  // (a real ghost tick would move the ghost off the cell first).
  sim.memory[BLOCK + S.ST_GHOST_C] = st(sim, 'ST_PAC_C');
  sim.memory[BLOCK + S.ST_GHOST_R] = st(sim, 'ST_PAC_R');
  sim.registers[15] = S.pac_collide_now;
  run(sim, 2);
  assert.equal(st(sim, 'ST_STATE'), 1, 'death state');
  assert.equal(runToExit(sim, 20, 0x71), true, 'Q leaves the death banner');
  assert.equal(sim.segmentRegisters.CS, 0x04A0);
  assert.equal(sim.registers[15], RET_PC);
});
