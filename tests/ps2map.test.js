// PS/2 Set-2 -> character map (scripts/make_ps2map.mjs), German QWERTZ.
//
// The RTL receiver is exercised by `npm run sim:ps2`; this pins the table it
// reads, including the modifier combinations that are easy to get wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ps2MapWords, PS2_MAP_WORDS, ALTGR_BASE, EXT_BASE } from '../scripts/make_ps2map.mjs';

const map = ps2MapWords();
const at = (code, { ctrl = false, caps = false, shift = false } = {}) =>
  map[(ctrl ? 1024 : 0) | (caps ? 512 : 0) | (shift ? 256 : 0) | code];

test('the map is one byte per address', () => {
  assert.equal(map.length, PS2_MAP_WORDS);
  assert.equal(PS2_MAP_WORDS, 2048);
});

test('letters, Shift and Caps', () => {
  assert.equal(at(0x1c), 'a'.charCodeAt(0));
  assert.equal(at(0x1c, { shift: true }), 'A'.charCodeAt(0));
  assert.equal(at(0x1c, { caps: true }), 'A'.charCodeAt(0));
  // Shift and Caps cancel for letters.
  assert.equal(at(0x1c, { caps: true, shift: true }), 'a'.charCodeAt(0));
});

test('German y/z are swapped', () => {
  assert.equal(at(0x35), 'z'.charCodeAt(0));   // US Y position
  assert.equal(at(0x35, { shift: true }), 'Z'.charCodeAt(0));
  assert.equal(at(0x1a), 'y'.charCodeAt(0));   // US Z position
  assert.equal(at(0x1a, { shift: true }), 'Y'.charCodeAt(0));
});

test('Shift selects the German upper symbol', () => {
  assert.equal(at(0x55), 0xb4);                    // ´
  assert.equal(at(0x55, { shift: true }), 0x60);   // `
  assert.equal(at(0x36, { shift: true }), '&'.charCodeAt(0));
  assert.equal(at(0x1e, { shift: true }), '"'.charCodeAt(0));
  assert.equal(at(0x3d, { shift: true }), '/'.charCodeAt(0));
  assert.equal(at(0x45, { shift: true }), '='.charCodeAt(0));
});

test('German umlauts and ß use their Latin-1 codes', () => {
  assert.equal(at(0x54), 0xfc);                    // ü
  assert.equal(at(0x54, { shift: true }), 0xdc);   // Ü
  assert.equal(at(0x54, { caps: true }), 0xdc);    // Caps also upper-cases
  assert.equal(at(0x4c), 0xf6);                    // ö
  assert.equal(at(0x4c, { shift: true }), 0xd6);   // Ö
  assert.equal(at(0x52), 0xe4);                    // ä
  assert.equal(at(0x52, { shift: true }), 0xc4);   // Ä
  assert.equal(at(0x4e), 0xdf);                    // ß
  assert.equal(at(0x4e, { shift: true }), '?'.charCodeAt(0));
  assert.equal(at(0x0e), '^'.charCodeAt(0));
  assert.equal(at(0x0e, { shift: true }), 0xb0);   // °
  assert.equal(at(0x5d), '#'.charCodeAt(0));
  assert.equal(at(0x5d, { shift: true }), "'".charCodeAt(0));
});

test('AltGr punctuation lives at the synthetic 0x80+ codes', () => {
  const altgr = (i) => at(ALTGR_BASE + i);
  assert.equal(altgr(0), '@'.charCodeAt(0));
  assert.equal(altgr(1), '{'.charCodeAt(0));
  assert.equal(altgr(2), '['.charCodeAt(0));
  assert.equal(altgr(3), ']'.charCodeAt(0));
  assert.equal(altgr(4), '}'.charCodeAt(0));
  assert.equal(altgr(5), '\\'.charCodeAt(0));
  assert.equal(altgr(6), '|'.charCodeAt(0));
  assert.equal(altgr(7), '~'.charCodeAt(0));
  // The normal modifier bits do not change the AltGr character.
  assert.equal(at(ALTGR_BASE, { ctrl: true }), '@'.charCodeAt(0));
  assert.equal(at(ALTGR_BASE, { shift: true }), '@'.charCodeAt(0));
});

test('extended arrows/Home/End live at the synthetic 0x90+ codes', () => {
  assert.equal(at(EXT_BASE + 0), 0x02);   // Left  -> C-B
  assert.equal(at(EXT_BASE + 1), 0x06);   // Right -> C-F
  assert.equal(at(EXT_BASE + 2), 0x10);   // Up    -> C-P
  assert.equal(at(EXT_BASE + 3), 0x0e);   // Down  -> C-N
  assert.equal(at(EXT_BASE + 4), 0x01);   // Home  -> C-A
  assert.equal(at(EXT_BASE + 5), 0x05);   // End   -> C-E
  // Modifiers do not change the navigation byte.
  assert.equal(at(EXT_BASE, { shift: true }), 0x02);
});

test('control codes', () => {
  assert.equal(at(0x1c, { ctrl: true }), 0x01);   // Ctrl+A
  assert.equal(at(0x35, { ctrl: true }), 0x1a);   // Ctrl+Z (German Z key)
  assert.equal(at(0x1a, { ctrl: true }), 0x19);   // Ctrl+Y (German Y key)
  // Ctrl wins over Shift/Caps for letters.
  assert.equal(at(0x1c, { ctrl: true, shift: true, caps: true }), 0x01);
  // The umlauts have no ASCII control code.
  assert.equal(at(0x54, { ctrl: true }), 0);
  assert.equal(at(0x52, { ctrl: true }), 0);
});

test('line and console keys', () => {
  assert.equal(at(0x5a), 0x0d);   // Enter
  assert.equal(at(0x66), 0x08);   // Backspace
  assert.equal(at(0x0d), 0x09);   // Tab
  assert.equal(at(0x76), 0x1b);   // Esc
  assert.equal(at(0x29), 0x20);   // Space
});

test('numeric keypad produces characters', () => {
  assert.equal(at(0x70), '0'.charCodeAt(0));
  assert.equal(at(0x75), '8'.charCodeAt(0));
  assert.equal(at(0x7c), '*'.charCodeAt(0));
  assert.equal(at(0x79), '+'.charCodeAt(0));
});

test('modifiers and prefixes have no table mapping', () => {
  for (const code of [0x12, 0x59, 0x14, 0x11, 0x58, 0xE0, 0xF0, 0xE1]) {
    for (const ctrl of [false, true]) {
      for (const caps of [false, true]) {
        for (const shift of [false, true]) {
          assert.equal(at(code, { ctrl, caps, shift }), 0, `code 0x${code.toString(16)}`);
        }
      }
    }
  }
});
