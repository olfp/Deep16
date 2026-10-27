// D16D showcase art: the sprite bank layout and the palette table the game
// selects from.  These are the pieces that must agree across make_art,
// make_bird_sprite and showcase.asm, so a mistake shows up here instead of on
// the DVI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { birdSpriteWords, SPRITE_WORDS, CLOUD_GROUP } from '../scripts/make_bird_sprite.mjs';
import { BIRD_COLOURS, BIRD_ORDER } from '../scripts/make_art.mjs';
import { buildShowcase } from '../scripts/make_showcase.mjs';

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

  // Page 0 groups 0..1 belong to the colour demo (written at runtime).
  for (const g of [0, 1, 8, 9, 16, 17]) {
    const slice = words.slice(g * GROUP_WORDS, (g + 1) * GROUP_WORDS);
    assert.ok(slice.every((v) => v === 0), `group ${g} stays free`);
  }
});

test('the game palette table matches the art colours', () => {
  const showcase = buildShowcase();
  const at = (a) => showcase.words.find((w) => w[0] === a)?.[1];
  BIRD_ORDER.forEach((colour, i) => {
    assert.equal(at(0x5CB + i * 2), BIRD_COLOURS[colour].body, `${colour} body`);
    assert.equal(at(0x5CC + i * 2), BIRD_COLOURS[colour].belly, `${colour} belly`);
  });
  // The three dizzy poses ping-pong in the shared table.
  assert.deepEqual([0x5D1, 0x5D2, 0x5D3, 0x5D4].map(at), [3, 4, 5, 4]);
});
