// The type-4 binary slice: Pac-Man, Flappy and Frogger stored in config flash
// instead of being baked into the image. Payload cell 0 is the magic, then
// version, entry offset and word count, then the block words (which include
// the tile pack at 0x1000). A block may span linked continuation slices.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSlices, SLICE_WORDS, SLICE_PAYLOAD, TYPES, BINARY_MAGIC, BINARY_VERSION,
} from '../scripts/make_slices.mjs';
import { buildPacman } from '../scripts/make_showcase.mjs';

function payloadWord(words, first, i) {
  const n = Math.floor(i / SLICE_PAYLOAD);
  return words[(first + n) * SLICE_WORDS + 8 + (i % SLICE_PAYLOAD)];
}

test('the pacman block is a valid binary slice', () => {
  const { words, manifest } = buildSlices();
  const man = manifest.objects.pacman;
  assert.ok(man, 'the directory lists pacman');
  assert.ok(man.count >= 1, 'at least one slice');
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
    assert.equal(payloadWord(words, man.first, 5 + addr), value,
                 `word 0x${addr.toString(16)}`);
  }
});

test('the directory lists the apps and their flags', () => {
  const { words } = buildSlices();
  const dir = words.slice(0, SLICE_WORDS);
  const entries = [];
  for (let i = 0; i < 255; i++) {
    const type = dir[8 + i * 8] & 0xff;
    if (type === 0xff) break;
    const name = [];
    for (let c = 0; c < 6; c++) {
      const w = dir[8 + i * 8 + 2 + c];
      for (const b of [w & 0xff, w >> 8]) if (b) name.push(String.fromCharCode(b));
    }
    entries.push({ type, flags: (dir[8 + i * 8] >> 8) & 0xf, name: name.join('') });
  }
  const apps = entries.filter((e) => e.flags === 1).map((e) => e.name);
  assert.deepEqual(apps.sort(), ['flappy', 'frogger', 'pacman']);
  assert.ok(entries.some((e) => e.name === 'games' && e.type === TYPES.SCREEN));
  assert.ok(entries.some((e) => e.name === 'ps2host' && e.flags === 0));
});
