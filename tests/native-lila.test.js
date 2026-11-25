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

// The float profile. The kernel's f. prints four decimals and a trailing
// space, not Lua's %.14g, so these expectations are the kernel's, not Lua's.
const floats = [
  ['a float literal', 'print(1.5)', '1.5000 '],
  ['a fraction', 'print(0.25)', '0.2500 '],
  ['an exponent', 'print(1.5e3)', '1500.0000 '],
  ['an exponent without a point', 'print(1e3)', '1000.0000 '],
  ['a negative exponent', 'print(1.5e-3)', '0.0015 '],
  ['division always yields a float', 'print(1 / 2)', '0.5000 '],
  ['an integer division', 'print(3 / 2)', '1.5000 '],
  ['the power is a float', 'print(2 ^ 10)', '1024.0000 '],
  ['a fractional power', 'print(2 ^ 0.5)', '1.4142 '],
  ['a mixed sum', 'print(1.5 + 2)', '3.5000 '],
  ['a mixed difference', 'print(1.5 - 2)', '-0.5000 '],
  ['a mixed product', 'print(1.5 * 2)', '3.0000 '],
  ['the quotient of two integers is an integer', 'print(7 // 2)', '3'],
  ['the quotient of a float is a float', 'print(7.5 // 2)', '3.0000 '],
  ['the remainder of two integers is an integer', 'print(7 % 3)', '1'],
  ['the remainder of a float is a float', 'print(7.5 % 2)', '1.5000 '],
  ['the unary minus binds looser than the power', 'print(-2 ^ 2)', '-4.0000 '],
  ['a negated float', 'print(-1.5)', '-1.5000 '],
  ['an int and a float compare', 'print(1 < 1.5)', 'true'],
  ['an int equals a float', 'print(2 == 2.0)', 'true'],
  ['a float above an int', 'print(1.5 > 1)', 'true'],
];

test('the float profile works', () => {
  for (const [name, src, expected] of floats) {
    assert.equal(h.runProgram([src]), expected, name);
  }
});

test('a float keeps its value from one line to the next', () => {
  assert.equal(h.runProgram(['y = 1.5', 'print(y)']), '1.5000 ');
  assert.equal(h.runProgram(['y = 1.5', 'z = y + 2.5', 'print(z)']), '4.0000 ');
  assert.equal(h.runProgram(['y = 1.5', 'print(y * 4)']), '6.0000 ');
});

test('a float works inside a block', () => {
  assert.equal(h.runProgram(['if 1.5 < 2 then print("yes") else print("no") end']), 'yes');
  assert.equal(h.runProgram(['y = 1.5', 'while y < 10 do y = y + 1 end', 'print(y)']),
               '10.5000 ');
});

test('a float run leaves the data stack at depth 0', () => {
  h.runProgram(['print(1.5 + 2)', 'y = 1.5', 'print(y * 4)']);
  assert.equal(h.depth(), 0);
});

// The string escapes.  The native profile decodes the same set as the host
// compiler in lila/compiler.fs: the simple escapes, the identity escapes,
// \ddd, \xXX, \z and \u{...}.  The console is a byte pipe, so the expected
// values are bytes and a UTF-8 escape is compared as its bytes.
const escapes = [
  ['\\a is a bell', 'print("a\\ab")', 'a\u0007b'],
  ['\\b is a backspace', 'print("a\\bb")', 'a\u0008b'],
  ['\\f is a form feed', 'print("a\\fb")', 'a\u000cb'],
  ['\\n is a line feed', 'print("a\\nb")', 'a\nb'],
  ['\\t is a tab', 'print("a\\tb")', 'a\tb'],
  ['\\v is a vertical tab', 'print("a\\vb")', 'a\u000bb'],
  ['\\\\ is a backslash', 'print("a\\\\b")', 'a\\b'],
  ['\\" is a double quote', 'print("a\\"b")', 'a"b'],
  ["\\' is a single quote", 'print("a\\\'b")', "a'b"],
  ['\\ddd is decimal', 'print("\\065")', 'A'],
  ['\\ddd counts in decimal, not octal', 'print("\\101")', 'e'],
  ['\\ddd takes one digit too', 'print("\\9")', '\t'],
  ['\\ddd takes at most three digits', 'print("\\1234")', '{4'],
  ['\\xXX is hexadecimal', 'print("\\x41")', 'A'],
  ['\\xXX takes two digits', 'print("\\x4a")', 'J'],
  ['\\z skips the spaces after it', 'print("\\z   abc")', 'abc'],
  ['\\z skips a tab too', 'print("a\\z  \\tb")', 'a\tb'],
  ['\\u{...} in ASCII', 'print("\\u{41}")', 'A'],
];

test('the string escapes work', () => {
  for (const [name, src, expected] of escapes) {
    assert.equal(h.runProgram([src]), expected, name);
  }
});

test('a string with escapes leaves the data stack at depth 0', () => {
  h.runProgram(['print("\\065")', 'print("\\x41")', 'print("\\u{20ac}")',
                'print("\\z   abc")', 'x = "a\\nb"']);
  assert.equal(h.depth(), 0);
});

test('a CR escape prints a CR byte', () => {
  // The console uses the CR to move the cursor, so only the raw output
  // path can show one.  A line ends with a CR of its own, so the raw
  // output has two: the one from the escape and the one that ends the
  // line.
  assert.equal(h.runProgram(['print("a\\rb")'], 20_000_000, true), 'a\rb\r');
});

// A code point above 0x7F is two or three UTF-8 bytes, and the console
// carries bytes, so these are compared as hex.
const utf8 = [
  ['\\u{e9} is two bytes', 'print("\\u{e9}")', 'c3 a9'],
  ['\\u{20ac} is three bytes', 'print("\\u{20ac}")', 'e2 82 ac'],
  ['\\u{800} is three bytes', 'print("\\u{800}")', 'e0 a0 80'],
  ['\\u{ffff} is three bytes', 'print("\\u{ffff}")', 'ef bf bf'],
];

test('a \\u escape is UTF-8', () => {
  for (const [name, src, expected] of utf8) {
    const got = h.runProgram([src]);
    const bytes = [...got].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    assert.equal(bytes, expected, name);
  }
});

// An escape outside the profile is rejected with -4.  A backslash that
// swallows the closing quote leaves the string unterminated, which is -5,
// the same diagnosis the host compiler gives.
const badEscapes = [
  ['an unknown letter', 'print("\\q")', -4],
  ['a \\x with one digit', 'print("\\x4")', -4],
  ['a \\x with a bad digit', 'print("\\xzz")', -4],
  ['a decimal over 255', 'print("\\300")', -4],
  ['a \\u without the brace', 'print("\\u{41")', -4],
  ['an empty \\u', 'print("\\u{}")', -4],
  ['a \\u with a bad digit', 'print("\\u{41g}")', -4],
  ['a code point over 0xFFFF', 'print("\\u{10000}")', -4],
  ['a backslash before the line feed', 'print("a\\', -4],
  ['a backslash that swallows the quote', 'print("a\\")', -5],
];

test('an invalid escape is rejected with a code', () => {
  for (const [name, src, code] of badEscapes) {
    const text = h.runSource(src);
    const m = text.match(/LERR (-?\d+)/);
    assert.ok(m, `${name}: no LERR in ${JSON.stringify(text)}`);
    assert.equal(Number(m[1]), code, name);
  }
});

// Syntax outside the profile must be rejected with a code, not reinterpreted.
const rejected = [
  ['and', 'if 1 and 2 then print(1) end', -14],
  ['function', 'function f() end', -21],
  ['local', 'local x = 1', -21],
  ['table', 't = {}', -9],
  ['newline in string', 'print("a\nb")', -3],
  ['literal out of range', 'print(2147483648)', -22],
  ['literal far out of range', 'print(99999999999)', -22],
  ['leading point', 'print(.5)', -9],
  ['trailing point', 'print(1.)', -20],
  ['malformed exponent', 'print(1.5e)', -20],
  ['division by zero', 'print(1 / 0)', -24],
  ['quotient out of range', 'print(100000 // 1)', -25],
  ['string in an arithmetic operator', 'print("a" + 1)', -26],
  ['string in a comparison', 'print("a" == "a")', -26],
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
  const out = h.runProgram(['print(1 / 0)', 'print(5)']);
  assert.match(out, /LERR -24/, out);
  assert.ok(out.endsWith('5'), out);
});

test('a comment-only or empty source compiles to a halt', () => {
  for (const [name, src] of [['comment only', '-- nothing'], ['empty source', '']]) {
    const text = h.runSource(src);
    assert.doesNotMatch(text, /LERR/, name);
    assert.match(text, /ok\n/, name);
  }
});
