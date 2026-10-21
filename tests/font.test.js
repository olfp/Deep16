// BDF -> DVI font ROM conversion (scripts/bdf_to_font.mjs).
//
// The converter is generic; the font's licence stays the caller's problem.
// Here a synthetic 8x15 and an 8x8 BDF are used, so no third-party font is
// copied into the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBdf, glyphRows, fontWords } from '../scripts/bdf_to_font.mjs';

function bdf(rows, code = 0x41, height = 15) {
  return `STARTFONT 2.1\nFONTBOUNDINGBOX 8 ${height} 0 -3\n` +
    `STARTCHAR A\nENCODING ${code}\nBBX 8 ${height} 0 -3\nBITMAP\n` +
    rows.join('\n') + '\nENDCHAR\nENDFONT\n';
}

test('a 15-row BDF maps one-to-one into the font words', () => {
  const rows = Array.from({ length: 15 }, (_, i) => (0x81 + i).toString(16));
  const glyphs = parseBdf(bdf(rows));
  const words = fontWords(glyphs);
  assert.equal(words.length, 96 * 8);
  const base = (0x41 - 0x20) * 8;
  for (let i = 0; i < 8; i++) {
    const lo = 0x81 + 2 * i;
    const hi = i === 7 ? 0 : 0x81 + 2 * i + 1;
    assert.equal(words[base + i], (lo | (hi << 8)) & 0xFFFF, `word ${i}`);
  }
});

test('a shorter BDF is centred vertically in the 15-row cell', () => {
  const rows = Array.from({ length: 8 }, () => 'ff');
  const glyphs = parseBdf(bdf(rows, 0x41, 8));
  const g = glyphs.get(0x41);
  const r = glyphRows(g, 15);
  assert.equal(r.length, 15);
  // (15 - 8) / 2 = 3 blank rows on top, then eight full rows, then blanks.
  assert.deepEqual(Array.from(r.slice(0, 3)), [0, 0, 0]);
  assert.deepEqual(Array.from(r.slice(3, 11)), Array(8).fill(0xFF));
  assert.deepEqual(Array.from(r.slice(11)), [0, 0, 0, 0]);
});

test('missing printable glyphs fall back to the space glyph', () => {
  const glyphs = parseBdf(bdf(Array(15).fill('00')));
  const words = fontWords(glyphs);
  assert.equal(words.length, 768);
  // 0x7F was not in the source; it must be blank, not undefined.
  assert.deepEqual(words.slice((0x7F - 0x20) * 8, (0x7F - 0x20) * 8 + 8), Array(8).fill(0));
});
