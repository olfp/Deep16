#!/usr/bin/env node
// scripts/make_tile_font.mjs - build the tile bank's text pages and art.
//
// Text is two 1-bit pages, 8 words per glyph (two rows per word, MSB leftmost):
// tile 0 is a blank 32-word art tile, the regular page starts at word 32 and
// the italic page at word 800. A text cell's bits 11:5 are the glyph index;
// the fill reads 32 + index*8 + page*768 + (row >> 1).
//
// The 32 game-art tiles stay 32 words of 4bpp pixels at tile address 0x0C00:
//   words  0..29   15 rows x 2 words, four 4bpp pixels per word
//                  word 2r+0 = pixels 0..3, pixel 0 in bits 3:0
//                  word 2r+1 = pixels 4..7, pixel 4 in bits 3:0
//   word   30      palette pointer (bits 3:0; 16 palettes)
//   word   31      flags (bit 0 H flip, bit 1 V flip, bit 2 priority)
//
// The palette side is a 16-entry RGB332 table copied into the text, art and
// sprite banks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artTiles } from './make_art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TILE_WORDS = 32;
export const FONT_TILES = 96;       // printable ASCII 0x20..0x7F
export const FONT_PAGE_WORDS = FONT_TILES * 8;   // 1bpp: 8 words per glyph
export const FONT_BASE = 32;        // tile 0 is the blank 32-word art tile
export const FONT_PAGE_COUNT = 2;   // regular, then the italic page
export const ART_BASE = FONT_TILES * TILE_WORDS; // 3,072, unchanged
export const TILE_COUNT = 128;      // 96 font slots + 32 game-art tiles
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

// One 1bpp page: the source is 8 words per glyph, two rows per word, MSB
// leftmost. fontPage() is only the fallback when no separate italic page is
// supplied; the FiT build passes the designed ttyp0 italic page instead.
export function fontPage(fontWords, { italic = false } = {}) {
  const out = new Array(FONT_PAGE_WORDS).fill(0);
  for (let i = 0; i < FONT_PAGE_WORDS; i++) {
    let w = fontWords[i] & 0xFFFF;
    if (italic) {
      const row0 = 2 * (i % 8);
      const row1 = row0 + 1;
      const s0 = row0 < 5 ? 2 : row0 < 10 ? 1 : 0;
      const s1 = row1 < 5 ? 2 : row1 < 10 ? 1 : 0;
      const lo = (w & 0xFF) >> s0;
      const hi = ((w >> 8) & 0xFF) >> s1;
      w = ((hi & 0xFF) << 8) | (lo & 0xFF);
    }
    out[i] = w;
  }
  return out;
}

// Two 1bpp pages at 0..1,535, then the 32 art tiles at 3,072. The gap stays
// zero; the art base is unchanged so the game constants do not move. The
// regular and italic pages come from ttyp0-8x15*.hex by default.
export function tileFontWords(fontWords, italicWords = fontPage(fontWords, { italic: true })) {
  const out = new Array(TILE_WORDS * TILE_COUNT).fill(0);
  const regular = fontPage(fontWords);
  const italic  = italicWords;
  for (let i = 0; i < FONT_PAGE_WORDS; i++) {
    out[FONT_BASE + i] = regular[i];
    out[FONT_BASE + FONT_PAGE_WORDS + i] = italic[i];
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

export function writeTileFont(outDir,
                              fontFile = path.join(ROOT, 'rtl', 'dvi', 'ttyp0-8x15.hex'),
                              italicFile = path.join(ROOT, 'rtl', 'dvi', 'ttyp0-8x15-italic.hex')) {
  const font = readFontWords(fontFile);
  const italic = italicFile ? readFontWords(italicFile) : undefined;
  const tiles = tileFontWords(font, italic);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'tilefont.hex'),
                   tiles.map((w) => w.toString(16).padStart(4, '0')).join('\n') + '\n');
  // Three banks for the tile engine: text pairs, art, sprites. The default
  // table is the same in all three; games overwrite the art/sprite banks.
  const bank3 = [...PALETTE_RGB332, ...PALETTE_RGB332, ...PALETTE_RGB332];
  fs.writeFileSync(path.join(outDir, 'tilepal3.hex'),
                   bank3.map((b) => b.toString(16).padStart(2, '0')).join('\n') + '\n');
  return tiles.length;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = path.resolve(process.argv[2] ?? path.join(ROOT, 'artifacts', 'image'));
  const n = writeTileFont(out, process.argv[3], process.argv[4]);
  console.log(`wrote ${path.relative(ROOT, out)}/tilefont.hex (${n} words, ` +
              `${FONT_PAGE_COUNT} x ${FONT_PAGE_WORDS}-word 1bpp pages + art) and tilepal3.hex`);
}
