// The FiT tile engine, modelled from rtl/dvi/dvi_tile.sv and the checks in
// rtl/sim/dvi_tile_tb.cpp. Graphics are loaded from the flash blob; the engine
// itself starts blank.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './helpers.js';

for (const f of ['js/deep16_flash_assets.js', 'js/deep16_gfx_loader.js', 'js/deep16_tile_engine.js']) {
  const file = path.join(ROOT, f);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: f });
}
const Assets = vm.runInThisContext('Deep16FlashAssets');
const Loader = vm.runInThisContext('Deep16GfxLoader');
const Engine = vm.runInThisContext('Deep16TileEngine');

const TILEMAP = 0xF1000;
const CTRL = 0xF2000;

function blankSim() {
  return {
    spiFlash: { mem: new Uint8Array(4 * 1024 * 1024).fill(0xFF) },
    memory: new Array(1048576).fill(0xFFFF),
  };
}

function loaded() {
  const engine = new Engine();
  const sim = blankSim();
  Loader.load(engine, sim, Assets);
  engine.tilemap[0].fill(0);
  engine.tilemap[1].fill(0);
  engine.oam.fill(0);
  engine.resetControls();
  return { engine, sim };
}

function pixel(engine, x, y) {
  const p = (y * engine.WIDTH + x) * 4;
  return [engine.pixels[p], engine.pixels[p + 1], engine.pixels[p + 2], engine.pixels[p + 3]];
}

function isBlack(px) {
  return px[0] === 0 && px[1] === 0 && px[2] === 0 && px[3] === 255;
}

function cell(engine, row, col, value, bank = 0) {
  engine.write(TILEMAP + row * engine.MAP_COLS + col, value);
}

function solidArt(engine, tile, nibble = 1) {
  const base = tile * 32;
  const word = (nibble & 0xF) * 0x1111;
  for (let i = 0; i < 32; i++) engine.write(0xF3000 + base + i, word);
}

test('power-on is blank; no ROM is seeded', () => {
  const engine = new Engine();
  assert.ok(engine.tileBank.every((w) => w === 0));
  assert.ok(engine.spriteBank.every((w) => w === 0));
  assert.ok(engine.palette.every((p) => p === 0));
  engine.render();
  for (const [x, y] of [[0, 0], [100, 100], [639, 359]]) {
    assert.ok(isBlack(pixel(engine, x, y)), `pixel ${x},${y} is not blank`);
  }
});

test('a text cell renders the font page with its pair colours', () => {
  const { engine } = loaded();
  // 'H' is glyph 40. Text cell: mode, pair 0, style 0, glyph << 5.
  cell(engine, 0, 0, 0x8000 | (40 << 5));
  engine.render();

  const word = engine.tileBank[0x20 + 40 * 8];   // row 0..1, low byte is row 0
  const byte = word & 0xFF;
  for (let x = 0; x < 8; x++) {
    const ink = (byte >> (7 - x)) & 1;
    const px = pixel(engine, x, 0);
    assert.equal(px[0], ink ? 255 : 0, `H pixel ${x}`);
    assert.equal(px[1], ink ? 255 : 0);
    assert.equal(px[2], ink ? 255 : 0);
  }
});

test('text styles: bold smear, underline and the italic page', () => {
  const { engine } = loaded();
  const glyph = 1;
  const page = 0x20 + glyph * 8;
  engine.write(0xF3000 + page, 0x0080);           // regular row 0: leftmost ink
  engine.write(0xF3000 + 0x320 + glyph * 8 + 7, 0x00FF); // italic row 14
  engine.write(0xF5081, 0xE0);                    // text ink red

  cell(engine, 0, 0, 0x8000 | (glyph << 5) | 2);  // bold
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(engine, 1, 0), [255, 0, 0, 255], 'bold smears right');
  assert.ok(isBlack(pixel(engine, 2, 0)));

  engine.tilemap[0].fill(0);
  cell(engine, 0, 0, 0x8000 | (glyph << 5) | 4);  // underline
  engine.render();
  for (let x = 0; x < 8; x++) {
    assert.deepEqual(pixel(engine, x, 14), [255, 0, 0, 255], `underline pixel ${x}`);
  }

  engine.tilemap[0].fill(0);
  cell(engine, 0, 0, 0x8000 | (glyph << 5) | 1);  // italic page
  engine.render();
  assert.deepEqual(pixel(engine, 0, 14), [255, 0, 0, 255]);
});

test('an art cell renders 4bpp from the tile bank and the art palette bank', () => {
  const { engine } = loaded();
  const tile = 96;
  solidArt(engine, tile, 1);
  cell(engine, 0, 0, tile * 32);
  engine.write(0xF5091, 0xE0);                    // art bank entry 1 = red
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(engine, 7, 14), [255, 0, 0, 255]);
});

test('the upper 32 tile slots are writable in the simulation', () => {
  const { engine } = loaded();
  const tile = 127;
  solidArt(engine, tile, 2);
  engine.write(0xF5092, 0x03);                    // art bank entry 2 = blue
  cell(engine, 0, 0, tile * 32);
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [0, 0, 255, 255]);
});

test('the 26-row terminal ring and row offset select a margin row', () => {
  const { engine } = loaded();
  solidArt(engine, 96, 1);
  engine.write(0xF5091, 0xE0);
  cell(engine, 25, 0, 96 * 32);                   // map row 25, first margin
  engine.write(CTRL + 0x2, 25);                   // visible row 0 -> map row 25
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);

  engine.tilemap[0].fill(0);
  cell(engine, 1, 0, 96 * 32);
  engine.render();
  assert.ok(isBlack(pixel(engine, 0, 0)), 'row 1 must not appear at rowOff 25');
});

test('scroll_x takes effect only after the frame latch', () => {
  const { engine } = loaded();
  solidArt(engine, 96, 1);
  engine.write(0xF5091, 0xE0);
  cell(engine, 0, 1, 96 * 32);
  engine.write(CTRL + 0x4, 8);                    // next scroll_x = 8
  engine.render();
  assert.ok(isBlack(pixel(engine, 0, 0)), 'scroll_x is not latched yet');
  engine.tick();
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255], 'column 1 starts at x=0');
});

test('scroll_y carries into the next map row', () => {
  const { engine } = loaded();
  solidArt(engine, 96, 1);
  engine.write(0xF5091, 0xE0);
  cell(engine, 1, 0, 96 * 32);
  engine.write(CTRL + 0x6, 15);                   // one full cell of scroll
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);
});

test('the per-row table replaces only the fine phase', () => {
  const { engine } = loaded();
  const base = 96 * 32;
  for (let i = 0; i < 32; i++) engine.write(0xF3000 + base + i, 0);
  engine.write(0xF3000 + base, 0x1000);           // row 0, pixel 3 only
  engine.write(0xF5091, 0xE0);
  cell(engine, 0, 0, 96 * 32);
  // Row 0 fine phase 3: x=0 samples pixel 3 of the first cell, and x=5 is
  // already the blank cell to its right.
  engine.write(CTRL + 0xC, (1 << 8) | (0 << 3) | 3);
  engine.tick();                                  // the table and enable latch
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);
  assert.ok(isBlack(pixel(engine, 5, 0)), 'fine phase moved past the marker');
});

test('sprites use OAM, the sprite bank and the sprite palette bank', () => {
  const { engine } = loaded();
  for (let i = 0; i < 256; i++) engine.write(0xF4000 + i, 0x1111);
  engine.write(0xF50A1, 0xE0);                    // sprite bank entry 1 = red
  engine.write(0xF5000, 0x0800 | 10);             // slot 0: enable, x=10
  engine.write(0xF5001, 10);                      // y=10, group 0

  engine.render();
  assert.ok(isBlack(pixel(engine, 0, 0)));
  assert.deepEqual(pixel(engine, 10, 10), [255, 0, 0, 255]);
  assert.deepEqual(pixel(engine, 41, 41), [255, 0, 0, 255]);
  assert.ok(isBlack(pixel(engine, 42, 10)), 'sprite is 32 pixels wide');
});

test('sprite slot 0 wins over slot 1', () => {
  const { engine } = loaded();
  for (let i = 0; i < 256; i++) engine.write(0xF4000 + i, 0x1111);       // group 0 red
  for (let i = 0; i < 256; i++) engine.write(0xF4100 + i, 0x1111);       // group 1 blue
  engine.write(0xF50A1, 0xE0);                    // entry 1 red
  engine.write(0xF50A2, 0x03);                    // entry 2 blue
  engine.write(0xF5000, 0x0800);                  // slot 0 group 0 at 0,0
  engine.write(0xF5001, 0);
  engine.write(0xF5002, 0x0800);                  // slot 1 group 1 at 0,0
  engine.write(0xF5003, (1 << 11));
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);
});

test('H flips reverse the whole 32-pixel row', () => {
  const { engine } = loaded();
  // Group 0: pixel (0,0) = index 1, pixel (31,0) = index 2, rest 0.
  engine.write(0xF4000, 0x0001);                  // row 0, cols 0..3: 1,0,0,0
  const word31 = (0 * 4 + 3) * 16 + 0 + 1;        // tile 3, row 0, second half
  engine.write(0xF4000 + word31, 0x2000);         // col 31 = index 2
  engine.write(0xF50A1, 0xE0);                    // red
  engine.write(0xF50A2, 0x03);                    // blue
  engine.write(0xF5000, 0x0800 | 0x2000);         // enable + Hflip
  engine.write(0xF5001, 0);                       // group 0
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [0, 0, 255, 255], 'left pixel was the right one');
});

test('a behind sprite is hidden by a non-zero background pixel', () => {
  const { engine } = loaded();
  solidArt(engine, 96, 1);
  cell(engine, 0, 0, 96 * 32);
  engine.write(0xF5091, 0xE0);                    // background red
  for (let i = 0; i < 256; i++) engine.write(0xF4000 + i, 0x1111);
  engine.write(0xF50A1, 0x03);                    // sprite blue
  engine.write(0xF5000, 0x0800 | 0x8000);         // enable + behind
  engine.write(0xF5001, 0);
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);
  engine.write(0xF5000, 0x0800);                  // clear behind
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [0, 0, 255, 255]);
});

test('V flips read row 31 first', () => {
  const { engine } = loaded();
  engine.write(0xF4000, 0x0001);                  // row 0, col 0 = 1
  const row31 = 12 * 16 + 7 * 2;                  // tile 12, row 7, first half
  engine.write(0xF4000 + row31, 0x0002);          // row 31, col 0 = 2
  engine.write(0xF50A1, 0xE0);                    // red
  engine.write(0xF50A2, 0x03);                    // blue
  engine.write(0xF5000, 0x0800 | 0x4000);         // enable + Vflip
  engine.write(0xF5001, 0);                       // group 0
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixel(engine, 0, 31), [255, 0, 0, 255]);
});

test('a negative-x sprite clips at the left edge', () => {
  const { engine } = loaded();
  for (let i = 0; i < 256; i++) engine.write(0xF4000 + i, 0x1111);
  engine.write(0xF50A1, 0xE0);
  engine.write(0xF5000, 0x0800 | 0x0400 | 1020);  // -4
  engine.write(0xF5001, 0);
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(engine, 27, 0), [255, 0, 0, 255]);
  assert.ok(isBlack(pixel(engine, 28, 0)), 'the sprite is 32 pixels wide from x=-4');
});

test('sprite page 3 clamps to page 0', () => {
  const { engine } = loaded();
  engine.write(CTRL + 0xA, 3);
  assert.equal(engine.spritePage, 0);
  for (let i = 0; i < 256; i++) engine.write(0xF4000 + i, 0x1111);
  engine.write(0xF50A1, 0xE0);
  engine.write(0xF5000, 0x0800);
  engine.write(0xF5001, 0);
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);
});

test('a group at or beyond 24 is disabled', () => {
  const { engine } = loaded();
  for (let i = 0; i < 256; i++) engine.write(0xF4000 + i, 0x1111);
  engine.write(0xF50A1, 0xE0);
  engine.write(0xF5000, 0x0800);
  engine.write(0xF5001, 24 << 11);
  engine.render();
  assert.ok(isBlack(pixel(engine, 0, 0)));
});

test('the sprite write page selects which groups the CPU writes', () => {
  const { engine } = loaded();
  engine.write(CTRL + 0xA, 1);                    // page 1 -> groups 8..15
  for (let i = 0; i < 256; i++) engine.write(0xF4000 + i, 0x1111);
  engine.write(0xF50A1, 0xE0);
  engine.write(0xF5000, 0x0800);
  engine.write(0xF5001, 8 << 11);                 // group 8
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);
});

test('the display bank and scroll_x latch together at tick()', () => {
  const { engine } = loaded();
  solidArt(engine, 96, 1);
  solidArt(engine, 97, 2);
  engine.write(0xF5091, 0xE0);
  engine.write(0xF5092, 0x03);
  cell(engine, 0, 0, 96 * 32);                    // bank 0 red
  engine.write(CTRL + 0x8, 1);                    // write bank 1
  cell(engine, 0, 0, 97 * 32);                    // bank 1 blue
  engine.write(CTRL + 0x8, 3);                    // display bank 1 next
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255], 'old display bank');
  engine.tick();
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [0, 0, 255, 255], 'new display bank');
});

test('palette bank writes are isolated', () => {
  const { engine } = loaded();
  solidArt(engine, 96, 1);
  cell(engine, 0, 0, 96 * 32);
  engine.write(0xF5081, 0x03);                    // text bank entry 1 (unused)
  engine.write(0xF5091, 0xE0);                    // art bank entry 1 red
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);
});

test('the cursor XORs the palette byte and blinks', () => {
  const { engine } = loaded();
  engine.write(CTRL, 0x0001);                     // cursor 0,0 enabled
  engine.render();
  assert.ok(isBlack(pixel(engine, 0, 0)), 'blink phase hides the cursor');
  engine.blink = 1 << 23;
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 255, 255, 255], '0x00 ^ 0xFF');
  assert.ok(isBlack(pixel(engine, 8, 0)), 'cursor is one cell');
});

test('reset keeps banks and the map, clears OAM and controls', () => {
  const { engine } = loaded();
  solidArt(engine, 96, 1);
  engine.write(0xF5091, 0xE0);
  cell(engine, 0, 0, 96 * 32);
  engine.write(0xF5000, 0x0800);
  engine.write(CTRL + 0x2, 7);
  engine.reset();
  assert.equal(engine.tileBank[96 * 32], 0x1111);
  assert.equal(engine.tilemap[0][0], 96 * 32);
  assert.equal(engine.oam[0], 0);
  assert.equal(engine.rowOff, 0);
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255], 'palette survives, map survives');
});

test('RGB332 expands exactly like the RTL', () => {
  const { engine } = loaded();
  solidArt(engine, 96, 2);
  cell(engine, 0, 0, 96 * 32);
  engine.write(0xF5092, 0xE0);                    // 111 000 00
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [255, 0, 0, 255]);
  engine.write(0xF5092, 0x1C);                    // 000 111 00
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [0, 255, 0, 255]);
  engine.write(0xF5092, 0x03);                    // 000 000 11
  engine.render();
  assert.deepEqual(pixel(engine, 0, 0), [0, 0, 255, 255]);
});
