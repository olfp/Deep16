#!/usr/bin/env node
// scripts/bdf_to_font.mjs - convert an 8x15 BDF font to the DVI font ROM.
//
// The DVI text console stores 96 glyphs (0x20..0x7F), 15 rows each, two rows
// per 16-bit word: low byte = even row, high byte = odd row, MSB leftmost.
// A BDF whose FONTBOUNDINGBOX is 8x15 (the same cell as the console) maps
// directly; a shorter bitmap is centred vertically and padded with blank rows.
//
// Usage:
//   node scripts/bdf_to_font.mjs font.bdf rtl/dvi/font8x15.hex
//
// The font's licence is the caller's responsibility: this script only converts
// a file it is given. The default rtl/dvi/font8x15.hex is generated from the
// public-domain font8x8 table; Nixedsys (github.com/ntwk/nixedsys-font) is a
// good 8x15 candidate but its repository carries no licence file, so it should
// not be committed without permission.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseBdf(text) {
  const out = new Map();
  for (const block of text.split('STARTCHAR ').slice(1)) {
    const enc = /ENCODING\s+(-?\d+)/.exec(block);
    const bbx = /BBX\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)/.exec(block);
    const bm = /BITMAP\s*\r?\n([\s\S]*?)\r?\nENDCHAR/.exec(block);
    if (!enc || !bbx || !bm) continue;
    const code = Number(enc[1]);
    if (code < 0) continue;
    out.set(code, {
      w: Number(bbx[1]),
      h: Number(bbx[2]),
      rows: bm[1].trim().split(/\s+/).map((h) => parseInt(h, 16)),
    });
  }
  return out;
}

// One glyph's 15 rows, padded/centred when the BDF height is not 15.
export function glyphRows(g, rowCount = 15) {
  const rows = new Uint8Array(rowCount);
  const top = Math.max(0, Math.floor((rowCount - g.h) / 2));
  for (let i = 0; i < g.h && top + i < rowCount; i++) rows[top + i] = g.rows[i] & 0xFF;
  return rows;
}

export function fontWords(glyphs) {
  const words = [];
  for (let code = 0x20; code <= 0x7F; code++) {
    const g = glyphs.get(code) ?? glyphs.get(0x20) ?? { w: 8, h: 15, rows: Array(15).fill(0) };
    const rows = glyphRows(g);
    for (let i = 0; i < 15; i += 2) {
      words.push(rows[i] | ((i + 1 < 15 ? rows[i + 1] : 0) << 8));
    }
  }
  return words;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [src, dst = path.join(ROOT, 'rtl', 'dvi', 'font8x15.hex')] = process.argv.slice(2);
  if (!src) {
    console.error('usage: node scripts/bdf_to_font.mjs <font.bdf> [out.hex]');
    process.exit(1);
  }
  const glyphs = parseBdf(fs.readFileSync(src, 'utf8'));
  const printable = [...glyphs.keys()].filter((c) => c >= 0x20 && c <= 0x7F).length;
  if (!printable) {
    console.error(`${src}: no printable ASCII glyphs found`);
    process.exit(1);
  }
  const words = fontWords(glyphs);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, words.map((w) => w.toString(16).padStart(4, '0')).join('\n') + '\n');
  console.log(`wrote ${dst}: 96 glyphs, ${words.length} words (printable ASCII in source: ${printable})`);
}
