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
  pacmanDotCount, pacmanMazeWords, pacmanArtTiles, T_FRUIT_L, T_DOT_L, T_PELLET_L,
  pacmanRuntimeSpriteFrames, pacmanGhostSpriteFrames, spriteFrameWords,
} from '../scripts/make_pacman_art.mjs';

for (const f of ['js/deep16_assembler.js', 'js/deep16_simulator.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const Assembler = vm.runInThisContext('Deep16Assembler');
const Simulator = vm.runInThisContext('Deep16Simulator');

// The game does a lot per frame (four ghost timers and sprite interpolation),
// so a simulated frame gets more steps than the old 0x400.  The timers still
// count game loops, not steps.
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

test('the block keeps code below the map and data below the runtime packs', () => {
  assert.ok(pacman.codeEnd <= 0x1000, `code ends at 0x${pacman.codeEnd.toString(16)}`);
  assert.ok(pacman.codeMax < PACMAN_LIMIT);
  const at = (a) => pacman.words.find((w) => w[0] === a)?.[1];
  assert.equal(at(0x1340) !== undefined, true, 'map starts at 0x1340');
  assert.equal(pacman.words.some(([a]) => a >= 0x1900 && a < 0x1980), false, 'state cells stay unwritten');
  assert.ok(pacman.codeMax < 0x2000, 'code and data stay below the slice end');
  assert.ok(pacman.packOffset + pacman.packTiles * 33 + 2 <= 0x1340,
            'tile pack ends before the maze');
});

test('the art pack carries cherries and the ghost sprites carry four colours', () => {
  const tiles = new Map(pacmanArtTiles().map((t) => [t.index, t.grid]));
  assert.ok(tiles.has(T_FRUIT_L) && tiles.has(T_FRUIT_L + 1), 'cherries use two tiles');
  const ghosts = pacmanGhostSpriteFrames();
  assert.deepEqual(ghosts.map((g) => g.group), [18, 5, 13, 21],
                   'ghost sprite groups');
  const body = (grid) => {
    const counts = new Map();
    for (const row of grid) for (const px of row) if (px) counts.set(px, (counts.get(px) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  ghosts.forEach((g, i) => assert.equal(body(g.grid), 6 + i,
                                          `ghost ${i} body palette index`));
});

test('the up and down Pac-Man frames open in the right direction', () => {
  const frames = new Map(pacmanRuntimeSpriteFrames().map((f) => [f.group, f.grid]));
  const up = frames.get(8), down = frames.get(16);
  assert.equal(up[10][16], 0, 'up frame has its mouth at the top');
  assert.equal(up[22][16], 5, 'up frame has its body at the bottom');
  assert.equal(down[10][16], 5, 'down frame has its body at the top');
  assert.equal(down[22][16], 0, 'down frame has its mouth at the bottom');
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
const textTile = (ch) => 0x8000 | ((ch.charCodeAt(0) - 0x20) << 5);
const oam = (sim, d, w) => sim.memory[0xF6000 + d * 2 + w] | 0;

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

// Step until the game leaves CS 0x0433 (the far return to the menu).
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

// Put ghost 0 on Pac-Man's interpolated centre for a collision test.
function putGhostOnPac(sim) {
  const c = st(sim, 'ST_PAC_C'), r = st(sim, 'ST_PAC_R');
  const px = st(sim, 'ST_PAC_PX'), py = st(sim, 'ST_PAC_PY');
  sim.memory[BLOCK + S.ST_GHOST_C] = c;
  sim.memory[BLOCK + S.ST_GHOST_R] = r;
  sim.memory[BLOCK + S.ST_G_FC] = c;
  sim.memory[BLOCK + S.ST_G_FR] = r;
  sim.memory[BLOCK + S.ST_G_PX] = px;
  sim.memory[BLOCK + S.ST_G_PY] = py;
  sim.memory[BLOCK + S.ST_G_DIR] = 0;
  sim.memory[BLOCK + S.ST_G_OFF] = 0;
}

test('the maze draws, Pac-Man moves, and a dot scores ten points', () => {
  const sim = start();
  run(sim, 320);
  assert.equal(st(sim, 'ST_DOTS'), 244);
  assert.deepEqual([st(sim, 'ST_PAC_C'), st(sim, 'ST_PAC_R')], [15, 17]);

  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 40, { key: 0x64, keyFrame: 0 });
  assert.ok(st(sim, 'ST_PAC_C') > 15, 'Pac-Man moved right');
  assert.ok(st(sim, 'ST_SC1') >= 1, 'dots score ten points each');
  assert.equal(st(sim, 'ST_DOTS'), 244 - st(sim, 'ST_SC1'), 'each dot is eaten once');
});

test('Pac-Man moves smoothly in pixels, two per frame', () => {
  const sim = start();
  run(sim, 320);
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 1, { key: 0x06, keyFrame: 0 });
  const xs = [];
  for (let i = 0; i < 9; i++) {
    xs.push(st(sim, 'ST_PAC_PX'));
    run(sim, 1);
  }
  const steps = xs.slice(1).map((x, i) => x - xs[i]);
  assert.ok(xs.length > 4, 'several samples');
  assert.ok(steps.every((d) => d >= 1 && d <= 2), `smooth pixel steps (${steps.join(',')})`);
  assert.ok(new Set(xs).size >= 5, 'Pac-Man is not jumping a whole cell');
});

test('the ghosts also interpolate between cells', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_FRIGHT', 0);
  // Ghost 0 visibly moves left from cell 11 to cell 10.
  sim.memory[BLOCK + S.ST_GHOST_C] = 10;
  sim.memory[BLOCK + S.ST_GHOST_R] = 9;
  sim.memory[BLOCK + S.ST_G_FC] = 11;
  sim.memory[BLOCK + S.ST_G_FR] = 9;
  sim.memory[BLOCK + S.ST_G_DIR] = 3;
  sim.memory[BLOCK + S.ST_G_OFF] = 0;
  sim.memory[BLOCK + S.ST_G_STEP] = 30;
  run(sim, 1);                       // prime the interpolator
  const xs = [];
  for (let i = 0; i < 9; i++) {
    xs.push(sim.memory[BLOCK + S.ST_G_PX]);
    run(sim, 1);
  }
  const steps = xs.slice(1).map((x, i) => Math.abs(x - xs[i]));
  assert.ok(new Set(xs).size >= 4, 'ghost positions change smoothly');
  assert.ok(steps.every((d) => d >= 1 && d <= 2), `ghost pixel steps (${steps.join(',')})`);
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
  run(sim, 9);
  assert.equal(st(sim, 'ST_DOTS'), 174, 'the left arrow ate the dot on arrival');
  assert.ok(st(sim, 'ST_PAC_TMR') >= 1, `dot delay leaves a one-frame pause (${st(sim, 'ST_PAC_TMR')})`);
});

test('the six runtime sprite frames are copied into the sprite bank', () => {
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
    groups.add((oam(sim, 0, 1) >> 11) & 31);
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

test('power pellets use the larger pellet tile', () => {
  const sim = start();
  run(sim, 320);
  // Logical (col,row): (1,3) and (30,3) are pellets; (1,1) is a small dot.
  assert.equal(tileAt(sim, 3, 2), T_PELLET_L, 'pellet left half');
  assert.equal(tileAt(sim, 3, 3), T_PELLET_L + 1, 'pellet right half');
  assert.equal(tileAt(sim, 18, 2), T_PELLET_L, 'lower-left pellet');
  assert.equal(tileAt(sim, 1, 2), T_DOT_L, 'ordinary dot left half');
  assert.equal(tileAt(sim, 1, 3), T_DOT_L + 1, 'ordinary dot right half');
});

test('wall outlines merge, with no line between touching wall cells', () => {
  const sim = start();
  run(sim, 320);
  assert.equal(tileAt(sim, 2, 4), 110 + 3, 'block left: left edge and top');
  assert.equal(tileAt(sim, 2, 5), 118 + 2, 'block left: top only on the right half');
  assert.equal(tileAt(sim, 2, 6), 110 + 2, 'interior left half: top only');
  assert.equal(tileAt(sim, 2, 7), 118 + 2, 'interior right half: top only');
  assert.equal(tileAt(sim, 2, 13), 118 + 3, 'block right: right edge and top');
});

test('Blinky starts outside the lair and the other three leave through the door', () => {
  const sim = start();
  let ready = false;
  for (let i = 0; i < 220 && !ready; i++) {
    run(sim, 1);
    if (st(sim, 'ST_DOTS') === 244 && st(sim, 'ST_PAC_C') === 15 && st(sim, 'ST_PAC_R') === 17) ready = true;
  }
  assert.ok(ready, 'the game initialised');
  const cols = [0, 1, 2, 3].map((i) => sim.memory[BLOCK + S.ST_GHOST_C + i]);
  const rows = [0, 1, 2, 3].map((i) => sim.memory[BLOCK + S.ST_GHOST_R + i]);
  assert.deepEqual(cols, [15, 15, 13, 17], 'lair starting columns');
  assert.deepEqual(rows, [9, 11, 11, 11], 'Blinky above, the rest inside');

  // Keep Pac-Man far away while the three ghosts walk to the door and out.
  put(sim, 'ST_PAC_C', 1); put(sim, 'ST_PAC_R', 1);
  sim.memory[BLOCK + S.ST_PAC_PX] = 24;
  sim.memory[BLOCK + S.ST_PAC_PY] = 22;
  sim.memory[BLOCK + S.ST_PAC_FC] = 1;
  sim.memory[BLOCK + S.ST_PAC_FR] = 1;
  put(sim, 'ST_PAC_TMR', 1000);
  run(sim, 80);
  const inLair = (c, r) => (r === 11 && c >= 12 && c <= 19) || (r === 10 && c >= 14 && c <= 17);
  for (let i = 0; i < 4; i++) {
    const c = sim.memory[BLOCK + S.ST_GHOST_C + i];
    const r = sim.memory[BLOCK + S.ST_GHOST_R + i];
    assert.equal(inLair(c, r), false, `ghost ${i} left the lair (${c},${r})`);
  }
});

test('the four ghosts use their arcade sprite colours', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_FRIGHT', 0);
  for (let i = 0; i < 4; i++) {
    sim.memory[BLOCK + S.ST_GHOST_C + i] = 10 + i;
    sim.memory[BLOCK + S.ST_GHOST_R + i] = 13;
    sim.memory[BLOCK + S.ST_G_FC + i] = 10 + i;
    sim.memory[BLOCK + S.ST_G_FR + i] = 13;
    sim.memory[BLOCK + S.ST_G_DIR + i] = 0;
  }
  run(sim, 1);
  assert.deepEqual([1, 2, 3, 4].map((d) => (oam(sim, d, 1) >> 11) & 31),
                   [18, 5, 13, 21], 'ghost sprite groups');
  assert.deepEqual([0, 1, 2, 3].map((i) => sim.memory[0xF6000 + 0xE6 + i] | 0),
                   [0xE0, 0xF9, 0x1F, 0xF4], 'sprite-palette body colours');
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

test('Pac-Man keeps eating dots while frightened', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_PAC_C', 2);
  put(sim, 'ST_PAC_R', 18);
  put(sim, 'ST_PAC_WANT', 3);
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 12);
  assert.ok(st(sim, 'ST_FRIGHT') > 300, 'the pellet frightened the ghosts');
  assert.equal(st(sim, 'ST_DOTS'), 243, 'only the pellet was eaten so far');

  // Turn around and eat the three dots between the pellet and the wall.
  put(sim, 'ST_PAC_WANT', 4);
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 40);
  assert.equal(st(sim, 'ST_DOTS'), 240, 'three dots eaten while frightened');
  assert.equal(st(sim, 'ST_SC1'), 8, '50 for the pellet plus 30 for three dots');
});

test('frightened ghosts flash white before returning to normal', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_FRIGHT', 110);
  run(sim, 1);
  const pal = [0, 1, 2, 3].map((i) => sim.memory[0xF6000 + 0xE6 + i] | 0);
  assert.ok(pal.every((v) => v === 0x03) || pal.every((v) => v === 0xFF),
            `body palette is blue or white (${pal.map((v) => v.toString(16))})`);
});

test('ghost speeds match the arcade: 9 normal, 13 fright, 16 tunnel', () => {
  let sim = start();
  run(sim, 320);
  put(sim, 'ST_PAC_C', 1); put(sim, 'ST_PAC_R', 11);
  sim.memory[BLOCK + S.ST_GHOST_C] = 10;
  sim.memory[BLOCK + S.ST_GHOST_R] = 11;
  sim.memory[BLOCK + S.ST_GHOST_DIR] = 0;
  put(sim, 'ST_GHOST_T0', 1);
  for (let i = 1; i < 4; i++) sim.memory[BLOCK + S.ST_GHOST_T0 + i] = 500;
  run(sim, 3);
  assert.ok(st(sim, 'ST_GHOST_T0') >= 12, `tunnel timer ${st(sim, 'ST_GHOST_T0')}`);

  sim = start(); run(sim, 320);
  put(sim, 'ST_PAC_C', 1); put(sim, 'ST_PAC_R', 17);
  sim.memory[BLOCK + S.ST_GHOST_C] = 10;
  sim.memory[BLOCK + S.ST_GHOST_R] = 9;
  sim.memory[BLOCK + S.ST_GHOST_DIR] = 0;
  put(sim, 'ST_GHOST_T0', 1); put(sim, 'ST_FRIGHT', 100);
  for (let i = 1; i < 4; i++) sim.memory[BLOCK + S.ST_GHOST_T0 + i] = 500;
  run(sim, 3);
  assert.ok(st(sim, 'ST_GHOST_T0') >= 9 && st(sim, 'ST_GHOST_T0') <= 13,
            `fright timer ${st(sim, 'ST_GHOST_T0')}`);

  sim = start(); run(sim, 320);
  put(sim, 'ST_PAC_C', 1); put(sim, 'ST_PAC_R', 17);
  sim.memory[BLOCK + S.ST_GHOST_C] = 10;
  sim.memory[BLOCK + S.ST_GHOST_R] = 9;
  sim.memory[BLOCK + S.ST_GHOST_DIR] = 0;
  put(sim, 'ST_GHOST_T0', 1); put(sim, 'ST_FRIGHT', 0);
  for (let i = 1; i < 4; i++) sim.memory[BLOCK + S.ST_GHOST_T0 + i] = 500;
  run(sim, 3);
  assert.ok(st(sim, 'ST_GHOST_T0') >= 5 && st(sim, 'ST_GHOST_T0') <= 9,
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
  run(sim, 10);
  assert.equal(st(sim, 'ST_FRUIT_N'), 1, 'the first cherry triggered');
  assert.ok(st(sim, 'ST_FRUIT_T') > 500, 'it stays on screen for about ten seconds');
  assert.equal(tileAt(sim, 13, 30), T_FRUIT_L, 'left cherry tile');
  assert.equal(tileAt(sim, 13, 31), T_FRUIT_L + 1, 'right cherry tile');

  put(sim, 'ST_PAC_C', 16);
  put(sim, 'ST_PAC_R', 13);
  put(sim, 'ST_PAC_WANT', 3);
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 22);
  assert.equal(st(sim, 'ST_SC2'), 1, 'fruit adds one hundred');
  assert.equal(st(sim, 'ST_SC1'), 1, 'the earlier dot is still ten');
  assert.equal(st(sim, 'ST_FRUIT_ST'), 0, 'the cherries are gone');
  assert.ok(st(sim, 'ST_POPUP_T') > 0, 'the 100 bonus is showing');
  assert.equal(sim.memory[0xF1000 + 13 * 82 + 30], textTile('1'), 'popup starts with 1');
  for (let i = 0; i < 50 && st(sim, 'ST_POPUP_T') > 0; i++) run(sim, 1);
  assert.equal(st(sim, 'ST_POPUP_T'), 0, 'popup cleared');
  assert.equal(tileAt(sim, 13, 30), 0, 'left cell cleared after the popup');
  assert.equal(tileAt(sim, 13, 31), 0, 'right cell cleared after the popup');
});

test('the ghost-eat multiplier is 200, 400, 800, 1600', () => {
  const sim = start();
  run(sim, 320);
  assert.deepEqual([0, 1, 2, 3].map((i) => sim.memory[BLOCK + S.pac_ghost_pts + i]),
                   [2, 4, 8, 16]);
  parkGhosts(sim);
  put(sim, 'ST_FRIGHT', 100);
  putGhostOnPac(sim);
  run(sim, 1);
  assert.equal(st(sim, 'ST_SC2'), 2, 'first ghost is 200');
  assert.equal(st(sim, 'ST_GHOST_EAT'), 1);
  assert.ok(st(sim, 'ST_POPUP_T') > 0, '200 bonus is showing');
  for (let i = 0; i < 50 && st(sim, 'ST_POPUP_T') > 0; i++) run(sim, 1);

  putGhostOnPac(sim);
  run(sim, 1);
  assert.equal(st(sim, 'ST_SC2'), 6, 'second ghost is 400');
  assert.equal(st(sim, 'ST_GHOST_EAT'), 2);
});

test('a ghost bonus appears in the maze and restores the tilemap', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_FRIGHT', 100);
  putGhostOnPac(sim);
  run(sim, 1);
  assert.ok(st(sim, 'ST_POPUP_T') > 0, 'popup is running');
  // Pac-Man starts at (15,17); "200" starts at tilemap column 30.
  assert.equal(sim.memory[0xF1000 + 17 * 82 + 30], textTile('2'), 'popup starts with 2');
  assert.equal(sim.memory[0xF1000 + 17 * 82 + 32], textTile('0'), 'popup ends with 0');
  assert.equal(sim.memory[0xF6000] & 0xFFFF, 0, 'Pac-Man sprite hidden');
  for (let i = 0; i < 50 && st(sim, 'ST_POPUP_T') > 0; i++) run(sim, 1);
  assert.equal(st(sim, 'ST_POPUP_T'), 0, 'popup finished');
  assert.equal(sim.memory[0xF1000 + 17 * 82 + 30], 0, 'maze cell restored');
  run(sim, 1);                       // the next play frame redraws Pac-Man
  assert.ok((sim.memory[0xF6000] | 0) & 0x0800, 'Pac-Man sprite is back');
});

test('the last dot wins and the banner returns to the menu after ten seconds', () => {
  const sim = start();
  run(sim, 320, {
    before: (frame, s) => { if (frame === 300) s.memory[BLOCK + S.ST_DOTS] = 1; },
  });
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 40, { key: 0x61, keyFrame: 0 });
  assert.equal(st(sim, 'ST_DOTS'), 0);
  assert.equal(st(sim, 'ST_STATE'), 2, 'win state');
  assert.equal(sim.memory[0xF1000 + 11 * 82 + 28], textTile('Y'), 'banner starts at col 28');
  assert.equal(sim.memory[0xF1000 + 11 * 82 + 35], textTile('!'), 'banner ends at col 35');
  assert.ok(st(sim, 'ST_TIMER') > 550, 'ten-second banner is counting down');
  assert.equal(runToExit(sim, 700), true, 'banner returns to the menu');
  assert.equal(sim.segmentRegisters.CS, 0x04A0);
  assert.equal(sim.registers[15], RET_PC);
});

test('a frightened ghost is worth 200 and goes back to the corridor', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_FRIGHT', 100);
  putGhostOnPac(sim);
  run(sim, 2);
  assert.equal(st(sim, 'ST_STATE'), 0, 'Pac-Man survives');
  assert.equal(st(sim, 'ST_SC2'), 2, '200 points');
  const gc = sim.memory[BLOCK + S.ST_GHOST_C], gr = sim.memory[BLOCK + S.ST_GHOST_R];
  assert.equal(gr, 9, 'back on the corridor row above the house');
  assert.ok(gc >= 14 && gc <= 17, `back in the house corridor (${gc})`);
});

test('a death with lives left respawns and keeps the dots', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_FRIGHT', 0);
  put(sim, 'ST_DOTS', 200);
  put(sim, 'ST_LIVES', 3);
  putGhostOnPac(sim);
  run(sim, 2);
  assert.equal(st(sim, 'ST_LIVES'), 2, 'one life lost');
  assert.equal(st(sim, 'ST_STATE'), 0, 'still playing');
  assert.deepEqual([st(sim, 'ST_PAC_C'), st(sim, 'ST_PAC_R')], [15, 17],
                   'Pac-Man is back at the start');
  assert.equal(st(sim, 'ST_DOTS'), 200, 'the eaten dots remain eaten');
  assert.deepEqual([0, 1, 2, 3].map((i) => sim.memory[BLOCK + S.ST_GHOST_C + i]),
                   [15, 15, 13, 17], 'ghosts are back in their starting cells');
  assert.deepEqual([0, 1, 2, 3].map((i) => sim.memory[BLOCK + S.ST_GHOST_R + i]),
                   [9, 11, 11, 11], 'Blinky outside, the rest inside');

  put(sim, 'ST_PAC_WANT', 4);
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 20);
  assert.ok(st(sim, 'ST_PAC_C') > 15, 'Pac-Man can move after respawning');
});

test('I toggles Immortal mode and infinite lives', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);

  run(sim, 1, { key: 0x69, keyFrame: 0 });   // 'I'
  assert.equal(st(sim, 'ST_IMMORTAL'), 1, 'Immortal mode is on');
  assert.equal(sim.memory[0xF1000 + 2 * 82 + 64], textTile('I'), 'HUD starts with I');
  assert.equal(sim.memory[0xF1000 + 2 * 82 + 71], textTile('L'), 'HUD ends with L');

  // An Immortal death costs no life and respawns immediately.
  put(sim, 'ST_LIVES', 1);
  put(sim, 'ST_FRIGHT', 0);
  putGhostOnPac(sim);
  run(sim, 2);
  assert.equal(st(sim, 'ST_LIVES'), 1, 'no life lost');
  assert.equal(st(sim, 'ST_STATE'), 0, 'still playing');
  assert.deepEqual([st(sim, 'ST_PAC_C'), st(sim, 'ST_PAC_R')], [15, 17],
                   'respawned at the start');
  assert.equal(sim.memory[0xF1000 + 2 * 82 + 64], textTile('I'),
               'Immortal HUD survives the respawn');

  run(sim, 1, { key: 0x69, keyFrame: 0 });   // toggle off
  assert.equal(st(sim, 'ST_IMMORTAL'), 0, 'Immortal mode is off');
  assert.equal(sim.memory[0xF1000 + 2 * 82 + 64], textTile(' '), 'HUD cleared');
});

test('10,000 points awards one extra life', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_LIVES', 3);
  put(sim, 'ST_EXTRA', 0);
  put(sim, 'ST_SC3', 9);
  put(sim, 'ST_SC2', 9);
  put(sim, 'ST_SC1', 9);
  put(sim, 'ST_SC0', 0);
  put(sim, 'ST_PAC_C', 15);
  put(sim, 'ST_PAC_R', 17);
  put(sim, 'ST_PAC_WANT', 3);
  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 10);
  assert.equal(st(sim, 'ST_DOTS'), 243);
  assert.ok(st(sim, 'ST_SC3') >= 10, 'score crossed 10,000');
  assert.equal(st(sim, 'ST_LIVES'), 4, 'bonus life awarded');
  assert.equal(st(sim, 'ST_EXTRA'), 1);

  put(sim, 'ST_PAC_TMR', 1);
  run(sim, 10);
  assert.equal(st(sim, 'ST_DOTS'), 242);
  assert.equal(st(sim, 'ST_LIVES'), 4, 'the bonus life is only awarded once');
});

test('a collision with a ghost ends the game and Q exits early', () => {
  const sim = start();
  run(sim, 320);
  parkGhosts(sim);
  put(sim, 'ST_FRIGHT', 0);
  put(sim, 'ST_LIVES', 1);
  putGhostOnPac(sim);
  run(sim, 2);
  assert.equal(st(sim, 'ST_STATE'), 1, 'game-over state');
  assert.equal(st(sim, 'ST_LIVES'), 0, 'last life lost');
  assert.equal(sim.memory[0xF1000 + 11 * 82 + 28], textTile('G'), 'banner starts at col 28');
  assert.equal(sim.memory[0xF1000 + 11 * 82 + 36], textTile('R'), 'banner ends at col 36');
  assert.equal(runToExit(sim, 20, 0x71), true, 'Q leaves the death banner');
  assert.equal(sim.segmentRegisters.CS, 0x04A0);
  assert.equal(sim.registers[15], RET_PC);
});
