// SerialTerminal - the host side of the serial console (js/deep16_terminal.js).
//
// It is pure logic, so it is tested directly, byte by byte, against the
// protocol the machine emits (D16MINI.md §7.5): printable ASCII, CR, LF, BS,
// and ESC[2J. Anything that is not in the emitted set - above all an arrow
// key's ESC [ A - must be swallowed, never drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './helpers.js';

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'deep16_terminal.js'), 'utf8'),
                    { filename: 'deep16_terminal.js' });
const SerialTerminal = vm.runInThisContext('SerialTerminal');
assert.ok(SerialTerminal, 'deep16_terminal.js must define SerialTerminal');

// every character of `text` as one byte
function bytes(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0xFF);
  return out;
}

test('printable characters land on the grid', () => {
  const t = new SerialTerminal(80, 24);
  t.writeBytes(bytes('Hi'));
  const rows = t.text();
  assert.equal(rows[0].slice(0, 2), 'Hi');
  assert.equal(t.cursorIndex(), 2, 'the cursor sits one past the last character');
});

test('CR returns to column 0 and LF moves to the next row', () => {
  const t = new SerialTerminal(80, 24);
  t.writeBytes([0x41, 0x42, 0x0D, 0x43]);   // "AB\rC"
  assert.equal(t.text()[0].slice(0, 2), 'CB', 'CR did not return to column 0');
  t.writeByte(0x0A);                         // LF: down one row, same column
  assert.equal(t.cursorIndex(), 81, 'LF did not move down one row');
});

test('a backspace steps left so the next character overwrites', () => {
  const t = new SerialTerminal(80, 24);
  t.writeBytes([0x41, 0x42, 0x08, 0x43]);    // "AB\bC"
  assert.equal(t.text()[0].slice(0, 2), 'AC');
});

test('ESC[2J clears the grid and homes the cursor', () => {
  const t = new SerialTerminal(80, 24);
  t.writeBytes(bytes('hello'));
  t.writeBytes(bytes('\x1b[2J'));
  assert.equal(t.text().join('').trim(), '', 'the grid is not empty');
  assert.equal(t.cursorIndex(), 0, 'the cursor is not homed');
});

test('an unrecognised escape sequence is consumed, not printed', () => {
  const t = new SerialTerminal(80, 24);
  // "A" then an up-arrow (ESC [ A) then "B": the arrow must vanish.
  t.writeBytes(bytes('A\x1b[AB'));
  assert.equal(t.text()[0].slice(0, 2), 'AB');
});

test('a bare ESC that is not a CSI is dropped', () => {
  const t = new SerialTerminal(80, 24);
  t.writeBytes([0x41, 0x1B, 0x42]);          // "A" ESC "B" - ESC has no '['
  assert.equal(t.text()[0].slice(0, 1), 'A');
  assert.equal(t.text()[0][1], ' ', 'the byte after a stray ESC must be dropped');
});

test('the grid scrolls at the bottom', () => {
  const t = new SerialTerminal(80, 24);
  t.writeByte(0x41);                          // 'A' on row 0
  for (let i = 0; i < 24; i++) t.writeByte(0x0A);   // 24 line feeds
  assert.equal(t.text()[0].trim(), '', 'row 0 should have scrolled off');
  t.writeByte(0x0D);                          // back to column 0
  t.writeByte(0x42);                          // 'B' on the last visible row
  assert.equal(t.text()[23][0], 'B');
});

test('a line longer than the width autowraps', () => {
  const t = new SerialTerminal(80, 24);
  for (let i = 0; i < 80; i++) t.writeByte(0x61);   // 80 x 'a'
  t.writeByte(0x62);                                 // 'b' wraps
  assert.equal(t.text()[0].trim(), 'a'.repeat(80));
  assert.equal(t.text()[1][0], 'b');
  assert.equal(t.cursorIndex(), 80 + 1);
});
