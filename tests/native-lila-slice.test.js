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

h.type('lila', 2_000_000, false);
for (const src of PROGRAM) h.type(src, 4_000_000, false);
const programMark = h.out.length;
h.type('', 20_000_000, true);      // the blank line ends the source and runs it
const got = h.programOutput(programMark);

test('the compiler is in the config-flash directory', () => {
  const lila = h.slices.manifest.objects.lila;
  assert.ok(lila, 'no lila object in the slice manifest');
  assert.ok(lila.chars > 14_280, 'the source is longer than seven slices');
  assert.ok(lila.count >= 8, `the source needs ${lila.count} slices`);
});

test('need loads the compiler from the flash', () => {
  assert.match(load, /Loading lila/, load.replace(/\r/g, ''));
  assert.doesNotMatch(load, /too long/, 'the boot loader refused the source');
  assert.ok(afterLoad > bootHere, 'the compiler took no dictionary');
  assert.ok(h.limit() - h.here() > 5000,
            `only ${h.limit() - h.here()} cells left after the load`);
});

test('the program compiles and runs with lua5.4 output', () => {
  assert.equal(got, EXPECTED);
  assert.ok(h.sim.running);
});

test('a successful run leaves the data stack at depth 0', () => {
  assert.equal(h.depth(), 0);
});
