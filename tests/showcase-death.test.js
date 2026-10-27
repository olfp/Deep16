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
const G_DEATH = 0x4EFD;
const G_DEATH_TIMER = 0x4EFE;
const G_TMP = 0x4EEF;
const RET_PC = 0x0777;

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
  return sim;
}

// Runs up to `frames` game frames. `hitAt` forces a pipe hit, `keyAt`/`key`
// push one UART byte. Returns the frame log and the final machine state.
function run({ mode = 1, frames = 260, hitAt = -1, keyAt = -1, key = 0 } = {}) {
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

  for (let step = 0; step < (frames + 8) * FRAME_PERIOD; step++) {
    if (step % FRAME_PERIOD === 0) {
      status ^= 2;
      sim.memory[UART_STATUS] = (sim.memory[UART_STATUS] & ~2) | status;
    }
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
    }

    const death = sim.memory[G_DEATH];
    if (death !== lastDeath) {
      transitions.push({ frame, death });
      if (death === 3) landedY = sim.memory[G_BIRD_Y];
      lastDeath = death;
    }
    if (death === 1 || death === 2 || death === 3) {
      const bits = sim.memory[OAM_BASE];
      deathGroups.add(`${(bits >> 10) & 7}:${(bits >> 14) & 1}`);
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

  return { sim, frame, transitions, deathGroups, quitFrame, landedY, minY, maxY, reversals };
}

test('showcase block stays inside the game block', () => {
  assert.ok(showcase.max < 0x0E00, `game block ends at 0x${showcase.max.toString(16)}`);
  assert.ok(showcase.max < 0x0DF0, 'keeps a margin below the 0xE00 stack guard');
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
