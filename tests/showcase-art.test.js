// D16D showcase art: the per-game slice packs and the palette table the game
// selects from. The global bitstream sprite bank is blank; every game installs
// its own sprite pack when it starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { birdSpriteWords, SPRITE_WORDS, flappySpriteFrames, flappySpritePack } from '../scripts/make_bird_sprite.mjs';
import { BIRD_COLOURS, BIRD_ORDER } from '../scripts/make_art.mjs';
import { buildShowcase, buildFlappy, buildPacman, buildFrogger } from '../scripts/make_showcase.mjs';
import { pacmanSpriteFrames, pacmanGhostSpriteFrames, pacmanSpritePack } from '../scripts/make_pacman_art.mjs';
import { TILE_BANK_WORDS, TILE_WORDS, readFontWords, tileFontWords } from '../scripts/make_tile_font.mjs';
import { froggerArtTiles } from '../scripts/make_frogger_art.mjs';
import { froggerSpritePack, SPR_MAGIC, SPR_PACK_OFFSET } from '../scripts/make_frogger_sprites.mjs';
import { ROOT } from './helpers.js';

function assertPack(block, pack) {
  const at = (a) => block.words.find((w) => w[0] === a)?.[1];
  assert.equal(at(SPR_PACK_OFFSET), SPR_MAGIC, 'sprite pack magic');
  assert.equal(at(SPR_PACK_OFFSET + 1), pack[1], 'sprite frame count');
  for (let i = 0; i < pack.length; i++) {
    assert.equal(at(SPR_PACK_OFFSET + i), pack[i], `sprite pack word ${i}`);
  }
}

test('the global sprite bank is blank', () => {
  const words = birdSpriteWords();
  assert.equal(words.length, SPRITE_WORDS);
  assert.ok(words.every((word) => word === 0), 'no game art is baked globally');
});

test('Flappy carries its cloud and bird frames in its slice', () => {
  const flappy = buildFlappy();
  assertPack(flappy, flappySpritePack());
  assert.deepEqual(flappySpriteFrames().map((frame) => frame.group),
                   [2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 19, 20, 21, 22, 23]);
  assert.ok(flappySpriteFrames().every((frame) =>
    frame.grid.some((row) => row.some((pixel) => pixel !== 0))), 'frame is not empty');
});

test('Pac-Man carries its munch and ghost frames in its slice', () => {
  const pacman = buildPacman();
  assertPack(pacman, pacmanSpritePack());
  assert.deepEqual(pacmanSpriteFrames().map((frame) => frame.group),
                   [0, 1, 8, 9, 10, 16, 17]);
  assert.deepEqual(pacmanGhostSpriteFrames().map((frame) => frame.group),
                   [18, 5, 13, 21]);
});

test('the game palette table matches the art colours', () => {
  const showcase = buildFlappy();
  const at = (a) => showcase.words.find((w) => w[0] === a)?.[1];
  BIRD_ORDER.forEach((colour, i) => {
    assert.equal(at(0x5D5 + i * 2), BIRD_COLOURS[colour].body, `${colour} body`);
    assert.equal(at(0x5D6 + i * 2), BIRD_COLOURS[colour].belly, `${colour} belly`);
  });
  // The three dizzy poses ping-pong in the shared table.
  assert.deepEqual([0x5DB, 0x5DC, 0x5DD, 0x5DE].map(at), [3, 4, 5, 4]);
});

test('the Frogger art rides in a slice tile pack', () => {
  const frogger = buildFrogger();
  const at = (a) => frogger.words.find((w) => w[0] === a)?.[1];
  assert.equal(frogger.packOffset, 0x1000);
  assert.equal(at(0x1000), 0x0A57, 'pack magic');
  const tiles = froggerArtTiles();
  assert.equal(at(0x1001), tiles.length, 'tile count');
  assert.deepEqual(tiles.map((t) => t.index), [57, 58, 126, 127, 38,
    ...Array.from({ length: 12 }, (_, i) => 26 + i),
    ...Array.from({ length: 62 }, (_, i) => 59 + i)]);
  let cell = 0x1002;
  for (const { index, grid } of tiles) {
    assert.equal(grid.length, 15, `tile ${index} rows`);
    assert.equal(at(cell), index, `tile ${index} index word`);
    cell += 1;
    for (let r = 0; r < 15; r++) {
      assert.equal(grid[r].length, 8, `tile ${index} row ${r} width`);
      for (const p of grid[r]) assert.ok(p >= 0 && p <= 15, `tile ${index} pixel ${p}`);
      const w0 = grid[r][0] | (grid[r][1] << 4) | (grid[r][2] << 8) | (grid[r][3] << 12);
      const w1 = grid[r][4] | (grid[r][5] << 4) | (grid[r][6] << 8) | (grid[r][7] << 12);
      assert.equal(at(cell + 2 * r), w0, `tile ${index} row ${r} low`);
      assert.equal(at(cell + 2 * r + 1), w1, `tile ${index} row ${r} high`);
    }
    assert.equal(at(cell + 30), 0, `tile ${index} palette pointer`);
    assert.equal(at(cell + 31), 0, `tile ${index} flags`);
    cell += 32;
  }

  assertPack(frogger, froggerSpritePack());
});
