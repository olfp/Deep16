// D16D showcase: the Flappy death sequence and input handling.
//
// The whole showcase is assembled into the BIOS segment (0x04A0) and run on
// the JS core. The test drives the frame flag itself, so a game frame is
// whatever it makes it, and checks the parts that are easy to break:
//
//   - the game block stays below the 0xE00 stack guard;
//   - attract mode flies without dying;
//   - a hit shows the bedazzled poses in groups 3..5, then the vflipped
//     group 5 falling to y = 300, then a rest and a return to attract;
//   - Q is accepted during the death sequence and returns to the caller.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadBrowserScripts } from './helpers.js';
import { buildShowcase, checkShowcase, SHOWCASE_SEG_BASE
} from '../scripts/make_showcase.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAME_PERIOD = 0x1000;       // steps between frame-flag toggles
const UART_STATUS = 0xF0066;       // b1 frame, b3 UART byte waiting
const OAM_BASE = 0xF5000;
const G_START_MODE = 0x4D5;
const G_BIRD_Y = 0x4EDB;
const G_BIRD_VY = 0x4EDC;
const G_DEATH = 0x4EFD;
const G_DEATH_TIMER = 0x4EFE;
const G_TMP = 0x4EEF;
const G_PLAYS = 0x4EDD;
const CONTROL = 0xF200A;
const PAL_BODY = 0xF50A2;
const PAL_BELLY = 0xF50AD;
const RET_PC = 0x0777;
const BIRD_COLOURS = [[0x84, 0xf1], [0xae, 0xb6], [0xfc, 0xf4]];

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const showcase = buildShowcase();
checkShowcase(showcase);

// Symbols are not part of the build result: assemble the two sources once more,
// the same way make_showcase does, to find the entry points.
const source = ['asm/showcase/showcase.asm', 'asm/showcase/flappy_game.asm']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const assembled = new globalThis.Deep16Assembler().assemble(source);
const S = assembled.symbols;

function start(mode) {
  const sim = new globalThis.Deep16Simulator();
  for (const [addr, value] of showcase.words) sim.memory[SHOWCASE_SEG_BASE + addr] = value;
  sim.d16nano = true;
  sim.registers[12] = RET_PC;
  sim.registers[15] = mode === 1 ? S.attract_start : S.start_play;
  sim.segmentRegisters = { CS: 0x04A0, DS: 0x04A0, SS: 0, ES: 0 };
  sim.running = true;
  sim.memory[G_START_MODE] = mode;
  sim.memory[UART_STATUS] = 0;
  sim.memory[G_PLAYS] = 0;
  sim.cycleCount = 0;
  return sim;
}

// Runs up to `frames` game frames. `hitAt` forces a pipe hit, `keyAt`/`key`
// push one UART byte. Returns the frame log and the final machine state.
function run({ mode = 1, frames = 260, hitAt = -1, keyAt = -1, key = 0, holdS2 = 0 } = {}) {
  const sim = start(mode);
  let status = 0;
  let lastFrame = 0;
  let frame = 0;
  let lastDeath = -1;
  const transitions = [];
  const deathGroups = new Set();
  let quitFrame = -1;
  let landedY = -1;
  let minY = Infinity;
  let maxY = -Infinity;
  let prevY = -1;
  let lastDir = 0;
  let reversals = 0;
  let flapFrames = 0;                // frames the bird was moving up at full tilt

  for (let step = 0; step < (frames + 8) * FRAME_PERIOD; step++) {
    if (step % FRAME_PERIOD === 0) {
      status ^= 2;
      // Bit 3 is the UART byte-ready flag: the test sets it for the key frame
      // only, as the hardware clears it once the byte is read.
      sim.memory[UART_STATUS] = (sim.memory[UART_STATUS] & ~(2 | 8)) | status;
    }
    if (holdS2 && frame < holdS2) sim.memory[UART_STATUS] |= 4;   // S2 held
    if (frame === hitAt) sim.memory[G_TMP] = 1;
    if (frame === keyAt) {
      sim.memory[UART_STATUS] |= 8;
      sim.uartRxPush(key);
    }
    sim.step();

    const frameBit = sim.memory[UART_STATUS] & 2;
    if (frameBit !== lastFrame) {
      lastFrame = frameBit;
      frame++;
      // -384 is the flap speed; count game frames spent there, not CPU steps.
      if (sim.memory[G_BIRD_VY] === 0xFE80) flapFrames++;
    }

    const death = sim.memory[G_DEATH];
    if (death !== lastDeath) {
      transitions.push({ frame, death });
      if (death === 3) landedY = sim.memory[G_BIRD_Y];
      lastDeath = death;
    }
    if (death === 1 || death === 2 || death === 3) {
      const w0 = sim.memory[OAM_BASE];
      const w1 = sim.memory[OAM_BASE + 1];
      deathGroups.add(`${(w1 >> 11) & 7}:${(w0 >> 14) & 1}`);
    }
    if (frame > 2) {
      const y = sim.memory[G_BIRD_Y];
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (prevY >= 0 && y !== prevY) {
        const dir = y > prevY ? 1 : -1;
        if (lastDir && dir !== lastDir) reversals++;
        lastDir = dir;
      }
      prevY = y;
    }
    if (sim.registers[15] === RET_PC) {
      quitFrame = frame;
      break;
    }
    if (frame >= frames) break;
  }

  return { sim, frame, transitions, deathGroups, quitFrame, landedY, minY, maxY, reversals,
           flapFrames };
}

test('showcase block stays inside the game block', () => {
  assert.ok(showcase.max < 0x0E00, `game block ends at 0x${showcase.max.toString(16)}`);
  // GAME_LIMIT is the real guard; keep a few words spare below it.
  assert.ok(showcase.max < 0x0DF8, 'keeps a margin below the 0xE00 stack guard');
});

test('the reset picks a bird, its palette and its write page', () => {
  const r = run({ mode: 1, frames: 20 });
  const page = r.sim.memory[CONTROL] & 3;
  assert.ok(page <= 2, `sprite write page ${page}`);
  assert.equal(r.sim.memory[PAL_BODY], BIRD_COLOURS[page][0], 'body palette entry');
  assert.equal(r.sim.memory[PAL_BELLY], BIRD_COLOURS[page][1], 'belly palette entry');

  // The bird OAM group is absolute: page * 8 + a pose in 3..7.
  const birdW1 = r.sim.memory[OAM_BASE + 1];
  const birdGroup = (birdW1 >> 11) & 0x1f;
  assert.ok(birdGroup >= page * 8 + 3 && birdGroup <= page * 8 + 7,
            `bird group ${birdGroup} for page ${page}`);

  // The four cloud sprites are behind the map, in absolute group 2, enabled.
  for (let i = 1; i <= 4; i++) {
    const w0 = r.sim.memory[OAM_BASE + i * 2];
    const w1 = r.sim.memory[OAM_BASE + i * 2 + 1];
    assert.equal((w0 >> 15) & 1, 1, `cloud ${i} behind`);
    assert.equal((w1 >> 11) & 0x1f, 2, `cloud ${i} group`);
    assert.equal(w0 & 0x0800, 0x0800, `cloud ${i} enabled`);
    assert.ok((w1 & 0x3FF) === 45 || (w1 & 0x3FF) === 90, `cloud ${i} row`);
  }
});

test('holding S2 gives one flap, not a climb to the ceiling', () => {
  const r = run({ mode: 0, frames: 120, holdS2: 100 });
  assert.ok(r.minY > 40, `bird keeps altitude while S2 is held (min ${r.minY})`);
  assert.ok(r.sim.memory[G_BIRD_Y] > 100, 'not pinned to the ceiling');
});

test('one UART key gives one flap, not a climb to the ceiling', () => {
  const r = run({ mode: 0, frames: 60, keyAt: 10, key: 0x78 });
  // The flap timer holds -384 for a handful of frames; a repeated flap (the
  // R10 clobber bug) pinned it there for the whole run.
  assert.ok(r.flapFrames <= 10, `one key flaps a few frames (${r.flapFrames})`);
  assert.ok(r.minY > 40, `bird does not climb to the ceiling (min ${r.minY})`);
});

test('attract mode flies without dying', () => {
  const r = run({ mode: 1, frames: 220 });
  const deaths = r.transitions.filter((t) => t.death === 1);
  assert.equal(deaths.length, 0, 'no death in attract mode');
  assert.equal(r.sim.memory[G_DEATH], 0, 'still alive');
  assert.ok(r.minY >= 100 && r.maxY <= 290, `bird stays in play (${r.minY}..${r.maxY})`);
  // The autopilot used to flap one frame at a time, which the capped fall
  // turned into a 2 px up/down buzz. It now taps like a key press, so the
  // bird changes direction a few times, not on almost every frame.
  assert.ok(r.reversals < 30, `autopilot does not buzz (${r.reversals} direction changes)`);
});

test('a cloud crossing the left edge carries the x sign bit', () => {
  const r = run({ mode: 1, frames: 280 });
  let sign = 0;
  for (let i = 1; i <= 4; i++) sign |= (r.sim.memory[OAM_BASE + i * 2] >> 10) & 1;
  assert.equal(sign, 1, 'cloud x sign bit set at least once');
});

test('a hit shows dizzy, then the vflipped fall, then attract', () => {
  const r = run({ mode: 1, frames: 260, hitAt: 120 });
  const states = r.transitions.map((t) => t.death);
  assert.ok(states.includes(1), 'dizzy state entered');
  assert.ok(states.includes(2), 'fall state entered');
  assert.ok(states.includes(3), 'landed state entered');
  assert.equal(r.sim.memory[G_DEATH], 0, 'back to attract');
  assert.equal(r.sim.memory[0x4ED6], 3, 'attract mode');
  const dizzy = [...r.deathGroups].filter((k) => k.endsWith(':0') && /^[345]:/.test(k));
  assert.ok(dizzy.length >= 2, `dizzy pose animates through groups 3..5 (${dizzy.join(',')})`);
  assert.ok(r.deathGroups.has('5:1'), 'fall sprite is group 5, vflipped');
  assert.equal(r.landedY, 300, 'lands on the ground at y = 300');
  assert.ok(r.sim.memory[G_DEATH_TIMER] >= 0);
});

test('Q is accepted during the death sequence', () => {
  const r = run({ mode: 1, frames: 200, hitAt: 120, keyAt: 140, key: 0x51 });
  assert.equal(r.quitFrame, 140, 'Q left the game on the frame it was pressed');
  assert.ok(r.sim.memory[G_DEATH] === 1 || r.sim.memory[G_DEATH] === 2,
            'quit happened while the death sequence was still running');
});

test('a non-Q key does not abort the death sequence', () => {
  const r = run({ mode: 1, frames: 260, hitAt: 120, keyAt: 140, key: 0x78 });
  assert.equal(r.quitFrame, -1, 'stayed in the game');
  assert.equal(r.sim.memory[G_DEATH], 0, 'death ran to completion');
  assert.equal(r.sim.memory[0x4ED6], 3, 'back in attract mode');
});
