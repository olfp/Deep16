// Every game carries its own graphics in its type-4 slice. The global tile
// bank has only the console font, and the global sprite bank is blank, so a
// running game must install all of its art from the slice image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScene } from '../scripts/render_tile.mjs';
import { buildFlappy } from '../scripts/make_showcase.mjs';
import {
  flappyArtPack, pacmanArtPack, froggerArtPack, readFontWords, tileFontWords,
} from '../scripts/make_tile_font.mjs';
import { flappySpritePack, birdSpriteWords } from '../scripts/make_bird_sprite.mjs';
import { PAC_PALETTE, pacmanSpritePack } from '../scripts/make_pacman_art.mjs';
import { FROGGER_PALETTE } from '../scripts/make_frogger_art.mjs';
import { froggerSpritePack } from '../scripts/make_frogger_sprites.mjs';

function unpackArt(pack) {
  const tiles = new Map();
  let at = 2;
  for (let i = 0; i < pack[1]; i++) {
    const index = pack[at++];
    tiles.set(index, pack.slice(at, at + 32));
    at += 32;
  }
  return tiles;
}

function unpackSprites(pack) {
  const groups = new Map();
  let at = 2;
  for (let i = 0; i < pack[1]; i++) {
    const group = pack[at++];
    groups.set(group, pack.slice(at, at + 256));
    at += 256;
  }
  return groups;
}

function usedArtTiles(engine) {
  const used = new Set();
  for (const bank of engine.tilemap) {
    for (const cell of bank) {
      if (cell & 0x8000) continue;              // text cell: shared console font
      const index = (cell & 0x0FE0) >> 5;
      if (index !== 0) used.add(index);         // tile 0 is the blank tile
    }
  }
  return [...used].sort((a, b) => a - b);
}

function usedSpriteGroups(engine) {
  const used = new Set();
  for (let d = 0; d < 64; d++) {
    const w0 = engine.oam[d * 2];
    const w1 = engine.oam[d * 2 + 1];
    const group = (w1 >> 11) & 0x1F;
    if ((w0 & 0x0800) && group < 24) used.add(group);
  }
  return [...used].sort((a, b) => a - b);
}

function flappyPalette() {
  const flappy = buildFlappy();
  const at = (address) => flappy.words.find((word) => word[0] === address)?.[1];
  return Array.from({ length: 16 }, (_, i) => at(0x3D0 + i));
}

function paletteEntries(engine, set, bank) {
  return Array.from(engine.palette.slice(set * 64 + bank * 16, set * 64 + bank * 16 + 16));
}

test('the bitstream carries no game tiles or sprites', () => {
  const regular = readFontWords(new URL('../rtl/dvi/ttyp0-8x15.hex', import.meta.url));
  const italic = readFontWords(new URL('../rtl/dvi/ttyp0-8x15-italic.hex', import.meta.url));
  const tiles = tileFontWords(regular, italic);
  assert.ok(tiles.slice(49 * 32).every((word) => word === 0), 'art slots 49-127 start blank');
  assert.ok(birdSpriteWords().every((word) => word === 0), 'all 24 sprite groups start blank');
});

test('Flappy runs from its slice tile, sprite and palette data', () => {
  const frame = renderScene({ scene: 'flappy', frames: 5 });
  assertGameAssets(frame.engine, 'Flappy', flappyArtPack(), flappySpritePack());
  assert.deepEqual(paletteEntries(frame.engine, 0, 1), flappyPalette(), 'art palette');
  assert.deepEqual(paletteEntries(frame.engine, 0, 2), flappyPalette(), 'sprite palette');
});

test('Pac-Man runs from its slice tile, sprite and palette data', () => {
  const frame = renderScene({ scene: 'pacman', frames: 20, keys: [0x64] });
  assertGameAssets(frame.engine, 'Pac-Man', pacmanArtPack(), pacmanSpritePack());
  for (const [offset, value] of PAC_PALETTE) {
    assert.equal(frame.engine.palette[offset - 0x80], value,
                 `palette 0xF60${offset.toString(16).padStart(2, '0')}`);
  }
});

test('Frogger runs from its slice tile, sprite and palette data', () => {
  const frame = renderScene({ scene: 'frogger', frames: 20, warmup: 200000 });
  assertGameAssets(frame.engine, 'Frogger', froggerArtPack(), froggerSpritePack());
  assert.deepEqual(paletteEntries(frame.engine, 2, 1), FROGGER_PALETTE, 'art palette');
  assert.deepEqual(paletteEntries(frame.engine, 2, 2), FROGGER_PALETTE, 'sprite palette');
});

function assertGameAssets(engine, name, artPack, spritePack) {
  const art = unpackArt(artPack);
  const sprites = unpackSprites(spritePack);

  // The slice image really carries the complete packs.
  assert.ok(art.size > 0, `${name} tile pack is not empty`);
  assert.ok(sprites.size > 0, `${name} sprite pack is not empty`);

  // The installed tile bank matches every word in the slice's tile pack.
  for (const [index, words] of art) {
    for (let i = 0; i < 32; i++) {
      assert.equal(engine.tileBank[index * 32 + i], words[i],
                   `${name} tile ${index} word ${i}`);
    }
  }
  for (const [group, words] of sprites) {
    for (let i = 0; i < 256; i++) {
      assert.equal(engine.spriteBank[group * 256 + i], words[i],
                   `${name} sprite group ${group} word ${i}`);
    }
  }

  // Every art tile and sprite group this game actually uses came from its
  // pack, not from an unowned slot left behind by the bitstream.
  for (const index of usedArtTiles(engine)) {
    assert.ok(art.has(index), `${name} uses tile ${index} outside its tile pack`);
  }
  for (const group of usedSpriteGroups(engine)) {
    assert.ok(sprites.has(group), `${name} uses sprite group ${group} outside its pack`);
  }

  // Nothing in the art area outside this game's pack is non-blank.
  for (let index = 49; index < 128; index++) {
    if (art.has(index)) continue;
    assert.ok(engine.tileBank.slice(index * 32, index * 32 + 32).every((word) => word === 0),
              `${name} leaves foreign art in tile ${index}`);
  }
  for (let group = 0; group < 24; group++) {
    if (sprites.has(group)) continue;
    assert.ok(engine.spriteBank.slice(group * 256, group * 256 + 256).every((word) => word === 0),
              `${name} leaves foreign art in sprite group ${group}`);
  }
}
