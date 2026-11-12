// μ-law sample slices: directory entry, packing and G.711 decode.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSlices, SLICE_WORDS, TYPES,
} from '../scripts/make_slices.mjs';
import { buildSamples, ulawDecode } from '../scripts/make_samples.mjs';

test('the ping sample is a μ-law slice with the 11.10 kHz rate code', () => {
  const { words, manifest } = buildSlices();
  const man = manifest.objects.ping;
  assert.ok(man, 'the directory lists ping');
  assert.equal(man.rate, 2);
  const base = man.first * SLICE_WORDS;
  assert.equal(words[base] & 0xff, TYPES.ULAW, 'slice type is μ-law');
  assert.equal((words[base] >> 8) & 0xf, 2, 'flags carry rate code 2');
  assert.equal(words[base + 1], 0xffff, 'one-slice sample');
  // The first payload cells hold two samples each, little sample first.
  const src = buildSamples().ping.bytes;
  for (let i = 0; i < Math.min(16, src.length); i++) {
    const cell = words[base + 8 + (i >> 1)];
    assert.equal((cell >> ((i & 1) * 8)) & 0xff, src[i], `sample ${i}`);
  }
  assert.notEqual(ulawDecode(src[1]), 0, 'the demo is not silence');
});
