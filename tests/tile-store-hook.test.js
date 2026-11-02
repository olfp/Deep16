// Store routing for the FiT engine: every video-window store reaches the
// engine in order, and tile mode stops the text-cell renderer from drawing over
// the same 0xF1000 words.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './helpers.js';

for (const f of ['js/deep16_simulator.js', 'js/deep16_tile_engine.js']) {
  const file = path.join(ROOT, f);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: f });
}
const Simulator = vm.runInThisContext('Deep16Simulator');
const Engine = vm.runInThisContext('Deep16TileEngine');

test('video-window stores reach the engine in order', () => {
  const sim = new Simulator();
  const engine = new Engine();
  sim.tileEngine = engine;

  sim.checkScreenUpdate(0xF3000, 0x1234);        // tile bank word 0
  sim.checkScreenUpdate(0xF3001, 0x5678);
  assert.equal(engine.tileBank[0], 0x1234);
  assert.equal(engine.tileBank[1], 0x5678);

  sim.checkScreenUpdate(0xF2002, 7);             // control 1: row offset
  assert.equal(engine.rowOff, 7);

  sim.checkScreenUpdate(0xF1000, 0x8000 | (40 << 5));
  assert.equal(engine.tilemap[0][0], 0x8000 | (40 << 5));

  sim.checkScreenUpdate(0xF6081, 0xE0);          // text palette entry 1
  assert.equal(engine.palette[1], 0xE0);
});

test('stores outside the video windows do not touch the engine', () => {
  const sim = new Simulator();
  const engine = new Engine();
  sim.tileEngine = engine;
  sim.checkScreenUpdate(0x1000, 0xFFFF);
  sim.checkScreenUpdate(0xF0064, 1);
  assert.equal(engine.tileBank[0], 0);
  assert.equal(engine.palette[0], 0);
});

test('tile mode stops the text renderer drawing over 0xF1000', () => {
  const sim = new Simulator();
  const engine = new Engine();
  sim.tileEngine = engine;
  let textWrites = 0;
  sim.ui = {
    mode: 'tiles',
    consoleMode() { return this.mode; },
    screenUI: {
      isScreenMemory: (addr) => addr >= 0xF1000 && addr <= 0xF17BF,
      handleScreenMemoryWrite() { textWrites++; },
    },
  };

  sim.checkScreenUpdate(0xF1000, 0x8000);
  assert.equal(textWrites, 0, 'tile mode owns the buffer');
  assert.equal(engine.tilemap[0][0], 0x8000);

  sim.ui.mode = 'screen';
  sim.checkScreenUpdate(0xF1000, 0x8001);
  assert.equal(textWrites, 1, 'text mode still uses the cell renderer');
});

test('an absent engine leaves the text path alone', () => {
  const sim = new Simulator();
  let textWrites = 0;
  sim.ui = {
    consoleMode: () => 'screen',
    screenUI: {
      isScreenMemory: () => true,
      handleScreenMemoryWrite() { textWrites++; },
    },
  };
  sim.checkScreenUpdate(0xF1000, 0x0041);
  assert.equal(textWrites, 1);
});
