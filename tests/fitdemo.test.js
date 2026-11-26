// The nano kernel's `fitdemo` word: one real FiT scene in the generic
// simulator, with a custom tile in the tile bank, text/map cells, and sprites
// enabled through OAM.  This is an integration test on purpose: a dictionary
// header alone would not prove that the CPU windows are addressed correctly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, readTileText } from './helpers.js';

for (const file of [
  'js/deep16_assembler.js',
  'js/deep16_linker.js',
  'js/deep16_simulator.js',
  'js/deep16_d16d_image.js',
  'js/deep16_flash_assets.js',
  'js/deep16_gfx_loader.js',
  'js/deep16_tile_engine.js',
]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
}

const Deep16D16DImage = vm.runInThisContext('Deep16D16DImage');
const Deep16FlashAssets = vm.runInThisContext('Deep16FlashAssets');
const Deep16GfxLoader = vm.runInThisContext('Deep16GfxLoader');
const Deep16TileEngine = vm.runInThisContext('Deep16TileEngine');
const Deep16Simulator = vm.runInThisContext('Deep16Simulator');

const TILE_COLS = 82;
const TILE_BANK = 0xF3000;
const OAM = 0xF6000;

function makeSimulator() {
  const kernel = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
  const image = Deep16D16DImage.buildNano({
    kernel,
    defines: { CONSOLE_MIRROR: 1, CONSOLE_PS2: 1 },
  });

  const sim = new Deep16Simulator();
  Deep16D16DImage.scatterD16SEG(image.words, {
    bootPtr: null,
    memory: sim.memory,
  });

  const engine = new Deep16TileEngine();
  sim.tileEngine = engine;
  sim.d16nano = true;
  Deep16GfxLoader.load(engine, sim, Deep16FlashAssets);
  sim.running = true;
  return { sim, engine };
}

function runUntil(sim, predicate, limit = 2_000_000) {
  let steps = 0;
  while (sim.running && steps < limit && !predicate()) {
    sim.step();
    steps++;
  }
  assert.ok(predicate(), `condition was not reached in ${limit} steps`);
  assert.ok(sim.running, 'the Forth interpreter stopped while running fitdemo');
  return steps;
}

function typeLine(sim, line) {
  for (const ch of line) sim.kbdBuffer.push(ch.charCodeAt(0));
  sim.kbdBuffer.push(10);
}

function pixel(engine, x, y) {
  const at = (y * engine.WIDTH + x) * 4;
  return Array.from(engine.pixels.slice(at, at + 4));
}

test('fitdemo is a built-in word that paints the FiT tile and sprite windows', () => {
  const { sim, engine } = makeSimulator();

  runUntil(sim, () =>
    readTileText(sim.memory, 0, 0) === 'Hello DeepForth!' &&
    readTileText(sim.memory, 1, 0) === '> ');

  typeLine(sim, 'fitdemo');
  runUntil(sim, () => readTileText(sim.memory, 2, 0).startsWith('>'));

  // The word returns to the prompt instead of corrupting the interpreter's
  // input registers or leaving an undefined-word error behind.
  assert.equal(readTileText(sim.memory, 2, 0), '>');
  assert.ok(!readTileText(sim.memory, 0, 0).includes('undefined word'));

  // Text cells and the custom art stripe are both present in map bank 0.
  assert.equal(readTileText(sim.memory, 3, 29), 'FiT tile + sprite demo');
  assert.equal(readTileText(sim.memory, 5, 26), '80x24 tiles / 32x32 sprites');
  assert.equal(readTileText(sim.memory, 12, 21), 'fitdemo: custom tile map + sprite OAM');
  assert.equal(engine.tilemap[0][9 * TILE_COLS + 70], 127,
               'the stripe uses art tile 127');

  // Tile 127 is a red/green checker: alternating 4bpp rows at the top of the
  // writable tile bank.
  assert.equal(engine.tileBank[127 * 32], 0x3232);
  assert.equal(engine.tileBank[127 * 32 + 1], 0x2323);
  assert.equal(sim.memory[TILE_BANK + 127 * 32], 0x3232);

  // Three sprites: cloud group 2 and two bird groups, each with the enable
  // bit, x coordinate, group number and y coordinate in the OAM descriptor.
  assert.deepEqual(Array.from(engine.oam.slice(0, 6)), [
    0x0820, 0x1078,
    0x08A0, 0x3087,
    0x09C0, 0x38E1,
  ]);
  assert.deepEqual(Array.from(sim.memory.slice(OAM, OAM + 6)),
                   Array.from(engine.oam.slice(0, 6)));

  // The rendered frame proves the map and sprite data are usable, rather than
  // merely present in memory.
  engine.render();
  assert.deepEqual(pixel(engine, 560, 135), [255, 0, 0, 255],
                   'the custom art tile is red at its first pixel');
  assert.deepEqual(pixel(engine, 564, 135), [0, 255, 0, 255],
                   'the custom art tile alternates green on the other half');

  let spritePixel = null;
  for (let y = 120; y < 152 && !spritePixel; y++) {
    for (let x = 32; x < 64; x++) {
      const sp = engine.spritePixel(0, x, y);
      if (sp) {
        spritePixel = { x, y, palette: sp.pix };
        break;
      }
    }
  }
  assert.ok(spritePixel, 'the cloud sprite has a visible pixel');
  const rgb = engine.rgb332(engine.palette[32 + spritePixel.palette]);
  assert.deepEqual(pixel(engine, spritePixel.x, spritePixel.y), [...rgb, 255]);
});
