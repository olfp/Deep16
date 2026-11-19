// Headless FiT renderer: deterministic frames and PNG framing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScene } from '../scripts/render_tile.mjs';
import { encodePng } from '../scripts/lib_png.mjs';
import { flappySpritePack } from '../scripts/make_bird_sprite.mjs';

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

test('Flappy installs its slice sprite pack and renders motion', () => {
  const r = renderScene({ scene: 'flappy', frames: 5 });
  assert.equal(r.frames.length, 5);
  assert.ok(nonBlack(r.frames[2]) > 1000, 'the game scene is visible');
  assert.notDeepEqual(Array.from(r.frames[2]), Array.from(r.frames[3]), 'the bird moves');
  assert.notDeepEqual(Array.from(r.frames[3]), Array.from(r.frames[4]));

  // The global sprite bank is blank, so the visible bird also proves the
  // game copied its own slice pack into the writable sprite bank.
  const pack = flappySpritePack();
  let at = 2;
  for (let frame = 0; frame < pack[1]; frame++) {
    const group = pack[at++];
    for (let word = 0; word < 256; word++) {
      assert.equal(r.engine.spriteBank[group * 256 + word], pack[at++],
                   `group ${group} word ${word}`);
    }
  }
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

test('the frog hops on keys', () => {
  // Space starts the game; then three hops right on the safe bottom bank.
  const keys = [];
  keys[0] = 0x20;                                    // Space
  for (let f = 6; f < 24; f += 6) keys[f] = 0x64;    // d
  const r = renderScene({ scene: 'frogger', frames: 24, warmup: 200000, keys });
  const e = r.engine;
  assert.ok(e.oam[0] & 0x0800, 'frog sprite is enabled');
  assert.equal((e.oam[1] >> 11) & 0x1f, 1, 'idle side frame, facing right');
  assert.equal(e.oam[0] & 0x2000, 0, 'no H flip when facing right');
  assert.equal(e.oam[1] & 0x3ff, 11 * 30 + 1, 'still on the bottom bank');
  assert.equal(e.oam[0] & 0x3ff, 432 + 3 * 32, 'three cells right');
  // The log carry and the splash/squash deaths are covered by the
  // simulator tests, where the state can be placed deterministically.
});

test('the home row is five bays in a hedge', () => {
  const r = renderScene({ scene: 'frogger', frames: 1, warmup: 200000 });
  const cell = (bank, row, col) => r.engine.tilemap[bank][row * 82 + col];
  const hedge = 38 << 5;
  const bayTop = 26 << 5;
  const bayBottom = 32 << 5;
  for (const bank of [0, 1]) {
    for (const row of [0, 1]) {
      // Nine hedge cells at each end of the playfield.
      for (let c = 24; c < 33; c++) assert.equal(cell(bank, row, c), hedge, `hedge col ${c}`);
      for (let c = 71; c < 80; c++) assert.equal(cell(bank, row, c), hedge, `hedge col ${c}`);
      // Five six-cell openings, two hedge cells apart.
      for (let bay = 0; bay < 5; bay++) {
        const base = 33 + bay * 8;
        for (let c = 0; c < 6; c++) {
          assert.equal(cell(bank, row, base + c),
            (row === 0 ? bayTop : bayBottom) + c * 32, `bay ${bay} col ${c}`);
        }
        assert.equal(cell(bank, row, base + 6), hedge, `gap after bay ${bay}`);
      }
    }
  }
});

test('home frogs fill the bays', () => {
  const empty = renderScene({ scene: 'frogger', frames: 2, warmup: 200000 });
  const filled = renderScene({
    scene: 'frogger', frames: 2, warmup: 200000,
    setup: (sim) => { sim.memory[0x6000 + 0xA34] = 0x1f; },
  });
  for (let bay = 0; bay < 5; bay++) {
    const d = 1 + bay;
    const w0 = filled.engine.oam[d * 2];
    const w1 = filled.engine.oam[d * 2 + 1];
    assert.ok(w0 & 0x0800, `home frog ${bay} enabled`);
    assert.equal(w0 & 0x3ff, 272 + bay * 64, `home frog ${bay} centred`);
    assert.equal((w1 >> 11) & 0x1f, 5, `home frog ${bay} frame`);
    assert.equal(w1 & 0x3ff, 1, `home frog ${bay} in the home row`);
  }
  assert.notDeepEqual(filled.frames[1], empty.frames[1], 'the frogs are on screen');
});

test('the Frogger panel edge stays fixed', () => {
  const r = renderScene({ scene: 'frogger', frames: 20, warmup: 200000 });
  const y = 4 * 15 + 7;
  for (let x = 184; x < 192; x++) {
    const p = (y * 640 + x) * 4;
    assert.deepEqual(
      Array.from(r.frames[9].slice(p, p + 3)),
      Array.from(r.frames[19].slice(p, p + 3)),
      `panel edge pixel ${x} is stable`);
  }
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
