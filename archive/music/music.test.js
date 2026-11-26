// The offline ABC synthesizer and its mu-law slice object.
//
// make_music.mjs turns a small ABC subset into the bytes the audio IRQ
// player expects (G.711 mu-law, two samples per cell, rate code 2). The
// parser is deliberately strict: an unsupported construct is an error, not a
// silently wrong note.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLAPPY_LOOP_ABC, MUSIC_RATE, RATE_ULAW_11100,
  parseABC, renderMusic, flappyMusicBytes,
} from './make_music.mjs';

test('the built-in loop parses as four 4/4 bars', () => {
  const p = parseABC(FLAPPY_LOOP_ABC);
  assert.equal(p.title, 'Flappy Loop');
  assert.equal(p.key, 'C');
  assert.equal(p.bpm, 132);
  assert.equal(p.meter, '4/4');
  assert.equal(p.notes.length, 15);
  assert.equal(p.chords.length, 4);
  assert.equal(p.length, 4, 'four whole notes = four 4/4 bars');
  assert.deepEqual(p.notes.slice(0, 4).map((n) => n.midi), [67, 72, 76, 72]);
});

test('render length follows tempo and rate, and the bytes are mu-law', () => {
  const { bytes, seconds } = renderMusic(FLAPPY_LOOP_ABC);
  assert.equal(bytes.length, Math.ceil(seconds * MUSIC_RATE));
  assert.ok(Math.abs(seconds - 7.27) < 0.02, `seconds ${seconds}`);
  assert.ok(bytes.length > 80000);
  assert.ok(bytes.every((b) => b >= 0 && b <= 255));
  assert.ok(new Set(bytes).size > 32, 'the samples are not one constant code');
});

test('durations, accidentals, key signatures and ties', () => {
  const p = parseABC(`X:1
T:t
M:4/4
L:1/4
Q:1/4=100
K:G
^F _A =B C2 D/2 E3/2 | F F-
`);
  // ^F = 66, _A = 68, =B = 71, C = 60, D = 62, E = 64, K:G F = 66.
  const midis = p.notes.map((n) => n.midi);
  assert.deepEqual(midis.slice(0, 6), [66, 68, 71, 60, 62, 64]);
  assert.equal(midis[6], 66, 'the key signature sharps F');
  assert.equal(p.notes[6].dur, 0.5, 'the tie extends the note');
});

test('the ABC subset rejects unsupported constructs', () => {
  const body = `X:1
T:t
M:4/4
L:1/8
Q:1/4=120
K:C
`;
  assert.throws(() => parseABC(body + '(3 C D E\n'), /tuplet/);
  assert.throws(() => parseABC(body + '{c}C\n'), /grace/);
  assert.throws(() => parseABC(body + 'C D E F G A B H\n'), /unsupported token/);
});
