// The on-device LILA compiler in lila/native/lila-native.fth, typed into the
// console.
//
// This boots the same segmented D16D image as segmented.test.js, types the
// compiler in through the console, and runs a Lua-subset program on the
// machine. The expected output is a fixture captured from lua5.4, so the test
// does not need a host Lua. It also asserts that a successful run leaves the
// data stack at depth 0: every compile-time and run-time value has been
// consumed.
//
// native-lila-slice.test.js loads the same compiler from the config flash.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { bootNative, EXPECTED, PROGRAM } from './native-lila-harness.js';

const h = bootNative();
h.boot();

// Type the compiler source in one line at a time and remember anything the
// outer interpreter rejected.
const compiler = fs.readFileSync(path.join(ROOT, 'lila', 'native', 'lila-native.fth'), 'utf8')
  .split('\n');
const loadFails = [];
let loaded = '';
for (const src of compiler) {
  const echoed = h.type(src, 8_000_000, true);
  loaded += echoed;
  if (/undefined word|stack underflow|error -?\d+|redefined/i.test(echoed) &&
      !/^: \S+ \(/.test(src)) {
    loadFails.push({ src, echoed: echoed.replace(/\r/g, '').trim().slice(0, 160) });
  }
}

// `lila` is a session: every line is compiled and run as soon as it is
// complete, and the state carries from one line to the next.
const got = h.runProgram(PROGRAM);

test('the segmented image boots', () => {
  assert.equal(h.sim.segmentRegisters.DS, 0x1000, 'DS');
  assert.match(h.out.slice(0, 200), /Hello DeepForth!/);
});

test('the compiler loads without an interpreter error', () => {
  assert.deepEqual(loadFails, []);
  assert.match(loaded, /> /);
});

test('the program compiles and runs with lua5.4 output', () => {
  assert.equal(got, EXPECTED);
  assert.ok(h.sim.running);
});

test('a successful run leaves the data stack at depth 0', () => {
  assert.equal(h.depth(), 0);
});

// Syntax outside the profile must be rejected with a code, not reinterpreted.
const rejected = [
  ['division', 'print(1 / 2)', -20],
  ['power', 'print(2 ^ 3)', -20],
  ['modulo', 'print(5 % 2)', -20],
  ['and', 'if 1 and 2 then print(1) end', -14],
  ['function', 'function f() end', -21],
  ['local', 'local x = 1', -21],
  ['table', 't = {}', -9],
  ['newline in string', 'print("a\nb")', -3],
  ['literal out of range', 'print(2147483648)', -22],
  ['literal far out of range', 'print(99999999999)', -22],
];

test('syntax outside the profile is rejected with a code', () => {
  for (const [name, src, code] of rejected) {
    const text = h.runSource(src);
    const m = text.match(/LERR (-?\d+)/);
    assert.ok(m, `${name}: no LERR in ${JSON.stringify(text)}`);
    assert.equal(Number(m[1]), code, name);
  }
});

// A line that ends in the middle of a statement is not an error. The
// session asks for another line and tries the whole pending source again;
// an empty line gives up on it and reports -23.
const unfinished = [
  ['missing end', 'if 1 then print(1)'],
  ['unterminated while', 'while 1 do print(1)'],
  ['unbalanced paren', 'print((1 + 2)'],
  ['missing value', 'x ='],
];

test('a source that ends mid-statement asks for another line', () => {
  for (const [name, src] of unfinished) {
    const text = h.runSource(src);
    const m = text.match(/LERR (-?\d+)/);
    assert.ok(m, `${name}: no LERR in ${JSON.stringify(text)}`);
    assert.equal(Number(m[1]), -23, name);
  }
});

test('the state carries from one line to the next', () => {
  assert.equal(h.runProgram(['x = 3', 'print(x)']), '3');
  assert.equal(h.runProgram(['x = 3', 'y = x + 1', 'print(y)']), '4');
  assert.equal(h.runProgram(['s = "a" .. "b"', 'print(s)']), 'ab');
  // The string arenas live as long as the session does, so a later line
  // cannot overwrite the string an earlier one left behind.
  assert.equal(h.runProgram(['s = "hello"', 't = "world"', 'print(s)']), 'hello');
  assert.equal(h.runProgram(['s = "a" .. "b"', 't = "c" .. "d"', 'print(s)']), 'ab');
});

test('a block can be spread over several lines', () => {
  assert.equal(h.runProgram(['if 1 then', 'print("yes")', 'end']), 'yes');
  assert.equal(h.runProgram(['if 1 == 2 then', 'print("yes")', 'else',
                             'print("no")', 'end']), 'no');
  assert.equal(h.runProgram(['i = 0', 'while i < 3 do', 'i = i + 1', 'end',
                             'print(i)']), '3');
});

test('a rejected line does not poison the next one', () => {
  const out = h.runProgram(['print(1 / 2)', 'print(5)']);
  assert.match(out, /LERR -20/, out);
  assert.ok(out.endsWith('5'), out);
});

test('a comment-only or empty source compiles to a halt', () => {
  for (const [name, src] of [['comment only', '-- nothing'], ['empty source', '']]) {
    const text = h.runSource(src);
    assert.doesNotMatch(text, /LERR/, name);
    assert.match(text, /ok\n/, name);
  }
});
