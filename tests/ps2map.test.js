// PS/2 Set-2 layouts and the software decoder reference
// (scripts/make_ps2map.mjs). The RTL receiver is exercised by `npm run sim:ps2`;
// this file pins the data the BIOS decoder reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutWords, layoutEntry, LAYOUT_WORDS, LAYOUT_COUNT, LAYOUTS,
         decodeEvent, makeEvent, EXT } from '../scripts/make_ps2map.mjs';

const at = (code, mods = {}, layout = 0) => decodeEvent(makeEvent(code, mods), layout);

test('the table has one 256-word entry per layout', () => {
  assert.equal(LAYOUT_WORDS, 256);
  assert.equal(LAYOUT_COUNT, LAYOUTS.length);
  assert.equal(layoutWords().length, LAYOUT_COUNT * LAYOUT_WORDS);
  assert.deepEqual(LAYOUTS.map((l) => l.name), ['de', 'us']);
});

test('German QWERTZ: letters, Shift and Caps', () => {
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

test('US QWERTY swaps the same physical keys back', () => {
  const us = 1;
  assert.equal(at(0x1a, {}, us), 'z'.charCodeAt(0));   // US Z position
  assert.equal(at(0x1a, { shift: true }, us), 'Z'.charCodeAt(0));
  assert.equal(at(0x35, {}, us), 'y'.charCodeAt(0));   // US Y position
  assert.equal(at(0x1e, { shift: true }, us), '@'.charCodeAt(0));
  assert.equal(at(0x26, { shift: true }, us), '#'.charCodeAt(0));
  assert.equal(at(0x5d, {}, us), '\\'.charCodeAt(0));
});

test('Shift selects the German upper symbol', () => {
  assert.equal(at(0x55), 0xb4);                    // ´
  assert.equal(at(0x55, { shift: true }), 0x60);   // `
  assert.equal(at(0x36, { shift: true }), '&'.charCodeAt(0));
  assert.equal(at(0x1e, { shift: true }), '"'.charCodeAt(0));
  assert.equal(at(0x3d, { shift: true }), '/'.charCodeAt(0));
  assert.equal(at(0x45, { shift: true }), '='.charCodeAt(0));
});

test('German umlauts and ss use their Latin-1 codes', () => {
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

test('AltGr punctuation is looked up by the original scan code', () => {
  assert.equal(at(0x15, { alt: true }), '@'.charCodeAt(0));
  assert.equal(at(0x3d, { alt: true }), '{'.charCodeAt(0));
  assert.equal(at(0x3e, { alt: true }), '['.charCodeAt(0));
  assert.equal(at(0x46, { alt: true }), ']'.charCodeAt(0));
  assert.equal(at(0x45, { alt: true }), '}'.charCodeAt(0));
  assert.equal(at(0x4e, { alt: true }), '\\'.charCodeAt(0));
  assert.equal(at(0x41, { alt: true }), '|'.charCodeAt(0));
  assert.equal(at(0x5b, { alt: true }), '~'.charCodeAt(0));
  // The normal modifier bits do not change the AltGr character.
  assert.equal(at(0x15, { alt: true, ctrl: true }), '@'.charCodeAt(0));
  assert.equal(at(0x15, { alt: true, shift: true }), '@'.charCodeAt(0));
  // US has no AltGr entries, so it falls through to the plain key.
  assert.equal(at(0x15, { alt: true }, 1), 'q'.charCodeAt(0));
});

test('extended arrows/Home/End stay fixed control bytes', () => {
  for (const [code, byte] of Object.entries(EXT)) {
    assert.equal(at(Number(code), { extended: true }), byte);
    // Modifiers do not change the navigation byte.
    assert.equal(at(Number(code), { extended: true, shift: true, ctrl: true }), byte);
  }
  assert.equal(at(0x75, { extended: true }), 0x10);   // Up -> C-P
  assert.equal(at(0x75), '8'.charCodeAt(0));          // keypad 8
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

test('codes above 0x7F are rejected before the 128-entry table', () => {
  // F7 is 0x83 in Set-2; no layout has an entry there.
  assert.equal(at(0x83), 0);
  assert.equal(at(0xff), 0);
  assert.equal(layoutEntry(0).length, LAYOUT_WORDS);
});

test('legacy ASCII (bit 15 clear) passes through unchanged', () => {
  assert.equal(decodeEvent('A'.charCodeAt(0)), 'A'.charCodeAt(0));
  assert.equal(decodeEvent(0x0d), 0x0d);
  // Even a Latin-1 byte is not treated as a raw event.
  assert.equal(decodeEvent(0xfc), 0xfc);
});
