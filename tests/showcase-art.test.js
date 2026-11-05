// D16D showcase art: the sprite bank layout and the palette table the game
// selects from.  These are the pieces that must agree across make_art,
// make_bird_sprite and showcase.asm, so a mistake shows up here instead of on
// the DVI.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { birdSpriteWords, SPRITE_WORDS, CLOUD_GROUP } from '../scripts/make_bird_sprite.mjs';
import { BIRD_COLOURS, BIRD_ORDER } from '../scripts/make_art.mjs';
import { buildShowcase } from '../scripts/make_showcase.mjs';
import { TILE_BANK_WORDS, TILE_WORDS, readFontWords, tileFontWords } from '../scripts/make_tile_font.mjs';
import { froggerArtTiles } from '../scripts/make_frogger_art.mjs';
import { ROOT } from './helpers.js';

const GROUP_WORDS = 16 * 16;

test('sprite bank holds three bird pages plus the shared cloud', () => {
  const words = birdSpriteWords();
  assert.equal(words.length, SPRITE_WORDS);
  assert.equal(words.length, 24 * GROUP_WORDS);

  for (let page = 0; page < BIRD_ORDER.length; page++) {
    const base = page * 8 * GROUP_WORDS;
    // Cloud at relative group 2, then the three dizzy poses and two wings.
    for (const g of [CLOUD_GROUP, 3, 4, 5, 6, 7]) {
      const slice = words.slice(base + g * GROUP_WORDS, base + (g + 1) * GROUP_WORDS);
      assert.ok(slice.some((v) => v !== 0), `page ${page} group ${g} is not empty`);
    }
  }

  // The cloud is one image duplicated on the three pages, so the OAM group is
  // independent of the chosen bird.
  const cloud = words.slice(CLOUD_GROUP * GROUP_WORDS, (CLOUD_GROUP + 1) * GROUP_WORDS);
  for (const page of [1, 2]) {
    const base = page * 8 * GROUP_WORDS;
    assert.deepEqual(
      words.slice(base + CLOUD_GROUP * GROUP_WORDS, base + (CLOUD_GROUP + 1) * GROUP_WORDS),
      cloud, `page ${page} cloud matches page 0`);
  }

  // The six groups Flappy leaves free hold the Pac-Man frames: right open and
  // closed (0/1), up (8/9) and down (16/17).
  for (const g of [0, 1, 8, 9, 16, 17]) {
    const slice = words.slice(g * GROUP_WORDS, (g + 1) * GROUP_WORDS);
    assert.ok(slice.some((v) => v !== 0), `group ${g} holds a Pac-Man frame`);
  }
  assert.notDeepEqual(
    words.slice(0, GROUP_WORDS),
    words.slice(GROUP_WORDS, 2 * GROUP_WORDS),
    'open and closed right frames differ');
});

test('the game palette table matches the art colours', () => {
  const showcase = buildShowcase();
  const at = (a) => showcase.words.find((w) => w[0] === a)?.[1];
  BIRD_ORDER.forEach((colour, i) => {
    assert.equal(at(0x5D5 + i * 2), BIRD_COLOURS[colour].body, `${colour} body`);
    assert.equal(at(0x5D6 + i * 2), BIRD_COLOURS[colour].belly, `${colour} belly`);
  });
  // The three dizzy poses ping-pong in the shared table.
  assert.deepEqual([0x5DB, 0x5DC, 0x5DD, 0x5DE].map(at), [3, 4, 5, 4]);
});

test('the tile bank carries the Frogger art and nothing else in the gap', () => {
  const font = readFontWords(path.join(ROOT, 'rtl', 'dvi', 'ttyp0-8x15.hex'));
  const italic = readFontWords(path.join(ROOT, 'rtl', 'dvi', 'ttyp0-8x15-italic.hex'));
  const words = tileFontWords(font, italic);
  assert.equal(words.length, TILE_BANK_WORDS);
  const tiles = froggerArtTiles();
  const expect = [...Array.from({ length: 8 }, (_, i) => 59 + i), 57, 58, 126, 127,
    ...Array.from({ length: 40 }, (_, i) => 67 + i)];
  assert.deepEqual(tiles.map((t) => t.index), expect);
  for (const { index, grid } of tiles) {
    assert.equal(grid.length, 15, `tile ${index} rows`);
    const base = index * TILE_WORDS;
    for (let r = 0; r < 15; r++) {
      assert.equal(grid[r].length, 8, `tile ${index} row ${r} width`);
      for (const p of grid[r]) assert.ok(p >= 0 && p <= 15, `tile ${index} pixel ${p}`);
      const w0 = grid[r][0] | (grid[r][1] << 4) | (grid[r][2] << 8) | (grid[r][3] << 12);
      const w1 = grid[r][4] | (grid[r][5] << 4) | (grid[r][6] << 8) | (grid[r][7] << 12);
      assert.equal(words[base + 2 * r], w0, `tile ${index} row ${r} low`);
      assert.equal(words[base + 2 * r + 1], w1, `tile ${index} row ${r} high`);
    }
    assert.equal(words[base + 30], 0, `tile ${index} palette pointer`);
    assert.equal(words[base + 31], 0, `tile ${index} flags`);
  }
});
