// Headless FiT renderer: deterministic frames and PNG framing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScene } from '../scripts/render_tile.mjs';
import { encodePng } from '../scripts/lib_png.mjs';

function nonBlack(rgba) {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] || rgba[i + 1] || rgba[i + 2]) n++;
  }
  return n;
}

test('the menu renders a deterministic 640x360 frame', () => {
  const a = renderScene({ scene: 'menu', frames: 1 });
  const b = renderScene({ scene: 'menu', frames: 1 });
  assert.equal(a.width, 640);
  assert.equal(a.height, 360);
  assert.ok(nonBlack(a.frames[0]) > 400, `menu has ${nonBlack(a.frames[0])} lit pixels`);
  assert.deepEqual(Array.from(a.frames[0]), Array.from(b.frames[0]));
});

test('Flappy renders motion frame to frame', () => {
  const r = renderScene({ scene: 'flappy', frames: 5 });
  assert.equal(r.frames.length, 5);
  assert.ok(nonBlack(r.frames[2]) > 1000, 'the game scene is visible');
  assert.notDeepEqual(Array.from(r.frames[2]), Array.from(r.frames[3]), 'the bird moves');
  assert.notDeepEqual(Array.from(r.frames[3]), Array.from(r.frames[4]));
});

test('Pac-Man renders the maze and moving sprites', () => {
  const r = renderScene({ scene: 'pacman', frames: 20, keys: [0x64] });
  assert.equal(r.frames.length, 20);
  assert.ok(nonBlack(r.frames[19]) > 2000, 'the maze, dots and sprites are visible');
  assert.notDeepEqual(Array.from(r.frames[5]), Array.from(r.frames[19]), 'Pac-Man moved');
});

test('the Frogger backdrop scrolls its lanes', () => {
  const r = renderScene({ scene: 'frogger', frames: 20, warmup: 200000 });
  assert.ok(nonBlack(r.frames[19]) > 2000, 'the ten lanes are visible');
  assert.notDeepEqual(Array.from(r.frames[10]), Array.from(r.frames[19]), 'the lanes move');
});

test('the menu launches Frogger on G and Q returns to bank 0', () => {
  const keys = new Array(180).fill(0);
  keys[5] = 0x47;   // G
  keys[120] = 0x71; // Q
  const r = renderScene({ scene: 'menu', frames: 180, warmup: 0x4000,
                          stepsPerFrame: 0x8000, keys });
  assert.equal(r.sim.segmentRegisters.CS, 0x04A0, 'back in the menu segment');
  assert.equal(r.engine.mapDisplay, 0, 'menu is drawn on bank 0');
  assert.equal(r.engine.mapWrite, 0);
  assert.equal(r.engine.rowScrollEn, 0, 'per-row table is cleared');
  assert.ok(nonBlack(r.frames[179]) > 400, 'menu text is visible again');
});

test('the console scene boots the nano kernel', () => {
  const r = renderScene({ scene: 'console', frames: 1 });
  assert.ok(nonBlack(r.frames[0]) > 400, 'the banner/prompt is rendered');
});

test('the PNG encoder writes an RGBA image', () => {
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 3] = 255;
  }
  const png = encodePng(4, 4, rgba);
  assert.deepEqual(Array.from(png.slice(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 4, 'IHDR width');
  assert.equal(png.readUInt32BE(20), 4, 'IHDR height');
  assert.equal(png[24], 8, '8-bit');
  assert.equal(png[25], 6, 'RGBA');
});
