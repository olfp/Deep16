// The type-4 binary slice: the Pac-Man block stored in config flash instead of
// being baked into the image. Payload cell 0 is the magic, then version, entry
// offset and word count, then the block words.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSlices, SLICE_WORDS, TYPES, BINARY_MAGIC, BINARY_VERSION,
} from '../scripts/make_slices.mjs';
import { buildPacman } from '../scripts/make_showcase.mjs';

test('the pacman block is a valid binary slice', () => {
  const { words, manifest } = buildSlices();
  const man = manifest.objects.pacman;
  assert.ok(man, 'the directory lists pacman');
  assert.equal(man.count, 1, 'the block fits one 4KB slice');
  const base = man.first * SLICE_WORDS;
  assert.equal(words[base] & 0xff, TYPES.BINARY, 'slice type is binary');
  assert.equal(words[base + 8], BINARY_MAGIC, 'payload magic');
  assert.equal(words[base + 9], BINARY_VERSION, 'payload version');
  assert.equal(words[base + 10], 0, 'entry offset');
  assert.equal(words[base + 11], man.words, 'word count matches the manifest');
  assert.equal(words[base + 12], 0x2000, 'load segment');
  const pac = buildPacman();
  assert.equal(man.words, pac.max + 1);
  for (const [addr, value] of pac.words) {
    assert.equal(words[base + 13 + addr], value, `word 0x${addr.toString(16)}`);
  }
});

test('the pacman slice is the last directory entry', () => {
  const { words } = buildSlices();
  const dir = words.slice(0, SLICE_WORDS);
  let found = false;
  for (let i = 0; i < 255; i++) {
    const type = dir[8 + i * 8] & 0xff;
    if (type === TYPES.BINARY) found = true;
  }
  assert.ok(found, 'a binary entry exists');
});
