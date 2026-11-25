// The on-device LILA compiler, loaded from the config flash the way the
// device loads it.
//
// The board keeps its Forth sources in the upper half of the on-board SPI
// flash as slices (USERFLASH.md). `s" lila" need` finds the compiler in the
// master directory and runs `screen`, which copies the slice chain into
// text-buf and includes it. This test drives that path on the JS core: the
// same boot image, the same slice image, the same loader words.
//
// It is the device-faithful twin of native-lila.test.js, which types the
// compiler in line by line instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootNative, EXPECTED, PROGRAM } from './native-lila-harness.js';

const h = bootNative();
h.boot();

const bootHere = h.here();
const load = h.line('s" lila" need', 60_000_000);
const afterLoad = h.here();

const got = h.runProgram(PROGRAM);

test('the compiler is in the config-flash directory', () => {
  const lila = h.slices.manifest.objects.lila;
  assert.ok(lila, 'no lila object in the slice manifest');
  assert.ok(lila.chars > 16_320, 'the source is longer than eight slices');
  assert.ok(lila.count >= 10, `the source needs ${lila.count} slices`);
  // The boot loader reads the source into text-buf, which holds eleven
  // slices; a twelfth would not fit.
  assert.ok(lila.count <= 11, `the source needs ${lila.count} slices`);
  assert.ok(lila.chars <= 22_440, `the source is ${lila.chars} characters`);
});

test('need loads the compiler from the flash', () => {
  assert.match(load, /Loading lila/, load.replace(/\r/g, ''));
  assert.doesNotMatch(load, /too long/, 'the boot loader refused the source');
  assert.ok(afterLoad > bootHere, 'the compiler took no dictionary');
  assert.ok(h.limit() - h.here() > 1000,
            `only ${h.limit() - h.here()} cells left after the load`);
});

test('the program compiles and runs with lua5.4 output', () => {
  assert.equal(got, EXPECTED);
  assert.ok(h.sim.running);
});

test('the compiler loaded from the flash has the float profile', () => {
  assert.equal(h.runProgram(['print(1.5)']), '1.5000 ');
  assert.equal(h.runProgram(['print(7 // 2)', 'print(1 / 2)']), '3\n0.5000 ');
});

test('the compiler loaded from the flash decodes the string escapes', () => {
  assert.equal(h.runProgram(['print("a\\nb")']), 'a\nb');
  assert.equal(h.runProgram(['print("\\x41")']), 'A');
  assert.equal(h.runProgram(['print("\\u{20ac}")']), '\u00e2\u0082\u00ac');
  assert.equal(h.runProgram(['print("\\z   abc")']), 'abc');
  assert.match(h.runSource('print("\\q")'), /LERR -4/);
});

test('a successful run leaves the data stack at depth 0', () => {
  assert.equal(h.depth(), 0);
});
