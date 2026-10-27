#!/usr/bin/env node
// scripts/make_tile_font.mjs - turn the 8x15 text font into the tile engine's
// 32-word 4bpp tiles.
//
// Tile format (VIDEO.md / the D16nano plan):
//
//   words  0..29   15 rows x 2 words, four 4bpp pixels per word
//                  word 2r+0 = pixels 0..3, pixel 0 in bits 3:0
//                  word 2r+1 = pixels 4..7, pixel 4 in bits 3:0
//   word   30      palette pointer (bits 3:0; 16 palettes)
//   word   31      flags (bit 0 H flip, bit 1 V flip, bit 2 priority)
//
// The text tiles use palette 0 and index 1 on the glyph, index 0 on the
// background. A character maps to tile address (ch - 0x20) * 32, which is what
// the console parser writes into the tilemap: the tilemap holds pure 16-bit
// tile addresses, never indices and never attributes.
//
// The palette side is a 16-entry RGB332 table for the first text build. The
// palette pointer in each tile is already in place, so the per-tile 16-palette
// bank drops in without changing the tile format.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artTiles } from './make_art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TILE_WORDS = 32;
export const FONT_TILES = 96;       // printable ASCII 0x20..0x7F
export const TILE_COUNT = 128;      // 96 font glyphs + 32 game-art tiles
export const TILE_BANK_WORDS = TILE_WORDS * TILE_COUNT;

// One 8x15 glyph, two rows per 16-bit word, low byte even row, MSB leftmost.
export function readFontWords(file = path.join(ROOT, 'rtl', 'dvi', 'font8x15.hex')) {
  const words = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('/') || line.startsWith('#')) continue;
    words.push(parseInt(line, 16) & 0xFFFF);
  }
  if (words.length !== FONT_TILES * 8) {
    throw new Error(`${file}: expected ${FONT_TILES * 8} font words, got ${words.length}`);
  }
  return words;
}

// One indexed 8x15 art tile at tileIndex.
function writeIndexedTile(out, tileIndex, grid) {
  const base = tileIndex * TILE_WORDS;
  for (let r = 0; r < 15; r++) {
    const p = grid[r];
    out[base + 2*r]     = (p[0] | (p[1] << 4) | (p[2] << 8) | (p[3] << 12)) & 0xFFFF;
    out[base + 2*r + 1] = (p[4] | (p[5] << 4) | (p[6] << 8) | (p[7] << 12)) & 0xFFFF;
  }
  out[base + 30] = 0;   // palette pointer (the shared palette)
  out[base + 31] = 0;   // flags
}

// TILE_COUNT x 32 words. Glyph pixels become palette index 1, background 0.
// Tiles 96..109 carry the converted free-art pack; the rest stay blank.
export function tileFontWords(fontWords, palette = 0) {
  const out = new Array(TILE_WORDS * TILE_COUNT).fill(0);
  for (let tile = 0; tile < FONT_TILES; tile++) {
    for (let r = 0; r < 15; r++) {
      const w = fontWords[tile * 8 + (r >> 1)];
      const row = (r & 1) ? (w >> 8) & 0xFF : w & 0xFF;
      const p = [];
      for (let c = 0; c < 8; c++) p.push(((row >> (7 - c)) & 1) ? 1 : 0);
      out[tile * TILE_WORDS + 2*r]     = (p[0] | (p[1] << 4) | (p[2] << 8) | (p[3] << 12)) & 0xFFFF;
      out[tile * TILE_WORDS + 2*r + 1] = (p[4] | (p[5] << 4) | (p[6] << 8) | (p[7] << 12)) & 0xFFFF;
    }
    out[tile * TILE_WORDS + 30] = palette & 0xF;
    out[tile * TILE_WORDS + 31] = 0x0000;
  }
  artTiles().forEach((grid, i) => writeIndexedTile(out, 96 + i, grid));
  return out;
}

// RGB332: bits 7:5 red, 4:2 green, 1:0 blue. Entry 0 is the background and
// entry 1 the ordinary text colour; the rest are there for colour text tiles.
export const PALETTE_RGB332 = [
  0x00, // 0 black
  0xFF, // 1 white
  0xE0, // 2 red
  0x1C, // 3 green
  0x03, // 4 blue
  0xFC, // 5 yellow
  0x1F, // 6 cyan
  0xE3, // 7 magenta
  0x92, // 8 grey
  0xB6, // 9 light blue
  0x6D, // 10 light green
  0xDB, // 11 light cyan
  0xE9, // 12 pink
  0xD3, // 13 light magenta
  0xFE, // 14 light yellow
  0xFF, // 15 bright white
];

export function writeTileFont(outDir, fontFile) {
  const font = readFontWords(fontFile);
  const tiles = tileFontWords(font);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'tilefont.hex'),
                   tiles.map((w) => w.toString(16).padStart(4, '0')).join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'tilepal.hex'),
                   PALETTE_RGB332.map((b) => b.toString(16).padStart(2, '0')).join('\n') + '\n');
  return tiles.length;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = path.resolve(process.argv[2] ?? path.join(ROOT, 'artifacts', 'image'));
  const n = writeTileFont(out);
  console.log(`wrote ${path.relative(ROOT, out)}/tilefont.hex (${n} words, ` +
              `${TILE_COUNT} tiles x ${TILE_WORDS} words) and tilepal.hex`);
}
