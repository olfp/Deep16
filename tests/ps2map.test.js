// PS/2 Set-2 -> ASCII map (scripts/make_ps2map.mjs).
//
// The RTL receiver is exercised by `npm run sim:ps2`; this pins the table it
// reads, including the modifier combinations that are easy to get wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ps2MapWords, PS2_MAP_WORDS } from '../scripts/make_ps2map.mjs';

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

test('Shift selects the upper symbol', () => {
  assert.equal(at(0x55), '='.charCodeAt(0));
  assert.equal(at(0x55, { shift: true }), '+'.charCodeAt(0));
  assert.equal(at(0x36, { shift: true }), '^'.charCodeAt(0));
  assert.equal(at(0x1e, { shift: true }), '@'.charCodeAt(0));
});

test('control codes', () => {
  assert.equal(at(0x1c, { ctrl: true }), 0x01);   // Ctrl+A
  assert.equal(at(0x1a, { ctrl: true }), 0x1a);   // Ctrl+Z
  assert.equal(at(0x54, { ctrl: true }), 0x1b);   // Ctrl+[
  assert.equal(at(0x5d, { ctrl: true }), 0x1c);   // Ctrl+\
  assert.equal(at(0x5b, { ctrl: true }), 0x1d);   // Ctrl+]
  assert.equal(at(0x36, { ctrl: true }), 0x1e);   // Ctrl+6/^
  assert.equal(at(0x4e, { ctrl: true }), 0x1f);   // Ctrl+-/_
  // Ctrl wins over Shift/Caps for letters.
  assert.equal(at(0x1c, { ctrl: true, shift: true, caps: true }), 0x01);
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

test('modifiers and prefixes have no ASCII mapping', () => {
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
