#!/usr/bin/env node
// scripts/make_slices.mjs - build the config-flash slice image.
//
// A slice is one 4 KB sector (2048 cells): 8 header cells, 2040 payload cells.
// Slice 0 is the master directory; the source objects follow. The image is
// written at 0x200000 by `npm run flash:tile` (the upper, unprotected half of
// the P25Q32U).
//
//   node scripts/make_slices.mjs                 # artifacts/image/slices.bin
//   node scripts/make_slices.mjs --out=FILE
//   node scripts/make_slices.mjs --with-pole     # local developer image
//
// Pole is omitted by default: it is developer-only and not part of the
// verified release. The sources and unit tests stay in the repo.
//
// Header word 0: bit15 WP, bits14:12 magic 5, bits11:8 flags/rate, bits7:0
// type. Cell 1 link (0xFFFF none), cells 2..7 name (12 chars, 2/cell, low
// byte first), payload from cell 8. A directory entry is 8 cells: word0 type
// (flags bits11:8), word1 first slice, cells 2..7 name.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPacman, buildFlappy, buildFrogger, buildPole, buildPoleBench, buildEditor } from './make_showcase.mjs';
import { buildSamples } from './make_samples.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SLICE_WORDS = 2048;
export const SLICE_BYTES = 4096;
export const SLICE_PAYLOAD = 2040;
export const SCREEN_BASE = 0x200000;       // byte address of slice 0
export const MAGIC = 5;

export const TYPES = {
  EMPTY: 0x00, TEST: 0x01, SPRITE: 0x02, TEXT: 0x03, BINARY: 0x04,
  PCM: 0x05, FONT: 0x06, DIRECTORY: 0x07, PACKED: 0x08, RLL: 0x09,
  ULAW: 0x0A, CHUNK: 0x0B, SCREEN: 0x0C,
};

function packName(name = '') {
  const cells = new Uint16Array(6);
  const s = name.slice(0, 12);
  for (let i = 0; i < s.length; i++)
    cells[i >> 1] |= (s.charCodeAt(i) & 0xff) << ((i & 1) * 8);
  return cells;
}

function header({ type, flags = 0, wp = false, link = 0xffff, name = '' }) {
  const cells = new Uint16Array(8);
  cells[0] = (wp ? 0x8000 : 0) | (MAGIC << 12) | ((flags & 0xf) << 8) | (type & 0xff);
  cells[1] = link & 0xffff;
  cells.set(packName(name), 2);
  return cells;
}

function entry({ type, flags = 0, first = 0xffff, name = '' }) {
  const cells = new Uint16Array(8);
  cells[0] = ((flags & 0xf) << 8) | (type & 0xff);
  cells[1] = first & 0xffff;
  cells.set(packName(name), 2);
  return cells;
}

// The loader interprets a line at a time and `evaluate` takes at most 128
// characters, so a longer line cannot be loaded at all. Catch it here rather
// than on the board.
const MAX_LINE = 128;

// The cuts between the slices of a text source. A slice holds 2040
// characters and the cut falls on a line boundary: the loader reads one slice
// at a time and interprets a line at a time, so a line that straddled a cut
// would be split in two.
function sourceCuts(text) {
  const cuts = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + SLICE_PAYLOAD, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end - 1);
      if (nl >= pos) end = nl + 1;
    }
    cuts.push([pos, end]);
    pos = end;
  }
  return cuts;
}

// Split a text source into 2040-char slices, LF-padded. The first slice is a
// TEXT source; continuations are type 0 and linked.
function sourceSlices(text, firstIndex, baseName) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > MAX_LINE) {
      throw new Error(`${baseName}: line ${i + 1} is ${lines[i].length} characters, `
        + `past the ${MAX_LINE} the loader reads per line`);
    }
  }
  const cuts = sourceCuts(text);
  const count = Math.max(1, cuts.length);
  const out = [];
  for (let i = 0; i < count; i++) {
    const words = new Uint16Array(SLICE_WORDS);
    const name = i === 0 ? baseName : `${baseName}${i + 1}`;
    const h = header({
      type: i === 0 ? TYPES.TEXT : TYPES.EMPTY,
      link: i === count - 1 ? 0xffff : firstIndex + i + 1,
      name,
    });
    words.set(h, 0);
    const [from, to] = cuts[i] ?? [0, 0];
    for (let j = 0; j < SLICE_PAYLOAD; j++) {
      const at = from + j;
      words[8 + j] = at < to ? (text.charCodeAt(at) & 0xff) : 10;
    }
    out.push(words);
  }
  return out;
}

// Type-4 binary slices: payload cell 0 = magic 'D16B', 1 = version, 2 = entry
// offset, 3 = word count, 4 = load segment, then the words. Continuations are
// raw payload and are linked, so a game may span any number of 4KB slices.
export const BINARY_MAGIC = 0xd16b;
export const BINARY_VERSION = 1;

function binarySlices(sparse, firstIndex, baseName, entryOffset = 0,
                      segment = 0x2000, flags = 0) {
  const max = sparse.reduce((m, [a]) => Math.max(m, a), -1);
  const dense = new Array(Math.max(0, max + 1)).fill(0xffff);
  for (const [a, v] of sparse) dense[a] = v & 0xffff;
  const payload = [BINARY_MAGIC, BINARY_VERSION, entryOffset, dense.length,
                   segment & 0xffff, ...dense];
  const count = Math.max(1, Math.ceil(payload.length / SLICE_PAYLOAD));
  const out = [];
  for (let i = 0; i < count; i++) {
    const words = new Uint16Array(SLICE_WORDS);
    words.set(header({
      type: i === 0 ? TYPES.BINARY : TYPES.EMPTY,
      flags,
      link: i === count - 1 ? 0xffff : firstIndex + i + 1,
      name: i === 0 ? baseName : `${baseName}${i + 1}`,
    }), 0);
    for (let j = 0; j < SLICE_PAYLOAD; j++) {
      const at = i * SLICE_PAYLOAD + j;
      words[8 + j] = at < payload.length ? payload[at] : 0xffff;
    }
    out.push(words);
  }
  return out;
}

// μ-law samples: one byte per sample, packed two per cell, 0xFF silence pad.
function sampleSlices(bytes, firstIndex, baseName, rateCode) {
  const payload = [];
  for (let i = 0; i < bytes.length; i += 2) {
    payload.push(bytes[i] | ((i + 1 < bytes.length ? bytes[i + 1] : 0xff) << 8));
  }
  const count = Math.max(1, Math.ceil(payload.length / SLICE_PAYLOAD));
  const out = [];
  for (let i = 0; i < count; i++) {
    const words = new Uint16Array(SLICE_WORDS);
    words.set(header({
      type: i === 0 ? TYPES.ULAW : TYPES.EMPTY,
      flags: i === 0 ? rateCode : 0,
      link: i === count - 1 ? 0xffff : firstIndex + i + 1,
      name: i === 0 ? baseName : `${baseName}${i + 1}`,
    }), 0);
    for (let j = 0; j < SLICE_PAYLOAD; j++) {
      const at = i * SLICE_PAYLOAD + j;
      words[8 + j] = at < payload.length ? payload[at] : 0xffff;
    }
    out.push(words);
  }
  return out;
}

function directory(entries) {
  const words = new Uint16Array(SLICE_WORDS);
  words.set(header({ type: TYPES.DIRECTORY, wp: true, name: 'master' }), 0);
  for (let i = 0; i < 255; i++) {
    const e = entries[i] || entry({ type: 0xff, first: 0xffff });
    words.set(e, 8 + i * 8);
  }
  return words;
}

export function buildSlices(options = {}) {
  // Pole is developer-only, so the shipped image leaves it out by default;
  // pass --with-pole or includePole:true for a local build.
  const includePole = options.includePole === true;
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const start = read('forth/start.fth');
  const essentials = read('screens/flash/essentials.fth');
  const edit = read('screens/flash/edit.fth');
  const graphics = read('screens/flash/graphics.fth');
  const audio = read('screens/flash/audio.fth');
  const games = read('screens/flash/games.fth');
  const sd = read('screens/flash/sd.fth');
  const hello = read('screens/flash/hello.fth');
  // The on-device LILA compiler. It is long enough to need eight TEXT
  // slices; a packed source (type 8) would halve that, but the packed
  // loader is one slice at a time - see lila/LILANATIVE.md.
  const lila = read('lila/native/lila-native.fth');
  if (start.length > SLICE_PAYLOAD) {
    throw new Error(`forth/start.fth is ${start.length} chars, past one ${SLICE_PAYLOAD}-char screen`);
  }

  const startFirst = 1;
  const startSlices = sourceSlices(start, startFirst, 'start');
  const essFirst = startFirst + startSlices.length;
  const essSlices = sourceSlices(essentials, essFirst, 'essentials');
  const editFirst = essFirst + essSlices.length;
  const editSlices = sourceSlices(edit, editFirst, 'edit');
  const gfxFirst = editFirst + editSlices.length;
  const gfxSlices = sourceSlices(graphics, gfxFirst, 'graphics');
  const audioFirst = gfxFirst + gfxSlices.length;
  const audioSlices = sourceSlices(audio, audioFirst, 'audio');
  const gamesFirst = audioFirst + audioSlices.length;
  const gameSlices = sourceSlices(games, gamesFirst, 'games');
  const sdFirst = gamesFirst + gameSlices.length;
  const sdSlices = sourceSlices(sd, sdFirst, 'sd-card');
  const editor = buildEditor();
  const editorFirst = sdFirst + sdSlices.length;
  const editorSlices = binarySlices(editor.words, editorFirst, 'editor', 0, editor.seg, 1);
  const pac = buildPacman();
  const pacFirst = editorFirst + editorSlices.length;
  const pacSlices = binarySlices(pac.words, pacFirst, 'pacman');
  const flappy = buildFlappy();
  const flappyFirst = pacFirst + pacSlices.length;
  const flappySlices = binarySlices(flappy.words, flappyFirst, 'flappy', 0, flappy.seg, 1);
  const frogger = buildFrogger();
  const froggerFirst = flappyFirst + flappySlices.length;
  const froggerSlices = binarySlices(frogger.words, froggerFirst, 'frogger', 0, frogger.seg, 1);
  // The Pole road renderer and its on-board timing harness. They are loaded
  // into segment 0x7000, which is free in the D16D segment map. They are
  // opt-in (--with-pole) while Pole stays developer-only.
  let pole = null;
  let poleSlices = [];
  let poleFirst = froggerFirst + froggerSlices.length;
  if (includePole) {
    pole = buildPole();
    poleSlices = binarySlices(pole.words, poleFirst, 'pole', 0, pole.seg, 1);
  }
  const helloFirst = poleFirst + poleSlices.length;
  const helloSlices = sourceSlices(hello, helloFirst, 'hello');
  const samples = buildSamples();
  const ping = samples.ping;
  const pingFirst = helloFirst + helloSlices.length;
  const pingSlices = sampleSlices(ping.bytes, pingFirst, ping.name, ping.rate);
  const swoosh = samples.swoosh;
  const swooshFirst = pingFirst + pingSlices.length;
  const swooshSlices = sampleSlices(swoosh.bytes, swooshFirst, swoosh.name, swoosh.rate);
  // The new object goes last so the slice numbers of everything else stay.
  const lilaFirst = swooshFirst + swooshSlices.length;
  const lilaSlices = sourceSlices(lila, lilaFirst, 'lila');
  // The on-board Pole timing harness. It goes last so the app slices keep
  // their numbers; it is a developer object, not a menu entry.
  let poleBench = null;
  let poleBenchSlices = [];
  const poleBenchFirst = lilaFirst + lilaSlices.length;
  if (includePole) {
    poleBench = buildPoleBench();
    poleBenchSlices = binarySlices(poleBench.words, poleBenchFirst, 'polebench', 0,
                                   poleBench.seg, 1);
  }

  const slices = [directory([
    entry({ type: TYPES.TEXT, first: startFirst, name: 'start' }),
    entry({ type: TYPES.TEXT, first: essFirst, name: 'essentials' }),
    entry({ type: TYPES.TEXT, first: editFirst, name: 'edit' }),
    entry({ type: TYPES.TEXT, first: gfxFirst, name: 'graphics' }),
    entry({ type: TYPES.TEXT, first: audioFirst, name: 'audio' }),
    entry({ type: TYPES.TEXT, first: gamesFirst, name: 'games' }),
    entry({ type: TYPES.TEXT, first: sdFirst, name: 'sd-card' }),
    entry({ type: TYPES.BINARY, flags: 1, first: editorFirst, name: 'editor' }),
    entry({ type: TYPES.BINARY, flags: 1, first: pacFirst, name: 'pacman' }),
    entry({ type: TYPES.BINARY, flags: 1, first: flappyFirst, name: 'flappy' }),
    entry({ type: TYPES.BINARY, flags: 1, first: froggerFirst, name: 'frogger' }),
    ...(includePole ? [entry({ type: TYPES.BINARY, flags: 1, first: poleFirst, name: 'pole' })] : []),
    entry({ type: TYPES.TEXT, first: helloFirst, name: 'hello' }),
    entry({ type: TYPES.ULAW, flags: ping.rate, first: pingFirst, name: ping.name }),
    entry({ type: TYPES.ULAW, flags: swoosh.rate, first: swooshFirst, name: swoosh.name }),
    entry({ type: TYPES.TEXT, first: lilaFirst, name: 'lila' }),
    ...(includePole ? [entry({ type: TYPES.BINARY, flags: 1, first: poleBenchFirst, name: 'polebench' })] : []),
  ]), ...startSlices, ...essSlices, ...editSlices, ...gfxSlices, ...audioSlices, ...gameSlices,
     ...sdSlices, ...editorSlices, ...pacSlices, ...flappySlices, ...froggerSlices, ...poleSlices,
     ...helloSlices, ...pingSlices, ...swooshSlices, ...lilaSlices, ...poleBenchSlices];
  const words = new Uint16Array(slices.length * SLICE_WORDS);
  slices.forEach((w, i) => words.set(w, i * SLICE_WORDS));
  const bytes = Buffer.alloc(slices.length * SLICE_BYTES, 0xff);
  for (let i = 0; i < words.length; i++) {
    bytes.writeUInt16LE(words[i], i * 2);
  }
  const manifest = {
    base: `0x${SCREEN_BASE.toString(16)}`,
    slice_bytes: SLICE_BYTES,
    slices: slices.length,
    objects: {
      start: { first: startFirst, count: startSlices.length, chars: start.length },
      essentials: { first: essFirst, count: essSlices.length, chars: essentials.length },
      edit: { first: editFirst, count: editSlices.length, chars: edit.length },
      graphics: { first: gfxFirst, count: gfxSlices.length, chars: graphics.length },
      audio: { first: audioFirst, count: audioSlices.length, chars: audio.length },
      games: { first: gamesFirst, count: gameSlices.length, chars: games.length },
      sd: { first: sdFirst, count: sdSlices.length, chars: sd.length },
      editor: { first: editorFirst, count: editorSlices.length, words: editor.max + 1,
                segment: `0x${editor.seg.toString(16)}` },
      pacman: { first: pacFirst, count: pacSlices.length, words: pac.max + 1 },
      flappy: { first: flappyFirst, count: flappySlices.length, words: flappy.max + 1 },
      frogger: { first: froggerFirst, count: froggerSlices.length, words: frogger.max + 1 },
      ...(includePole ? {
        pole: { first: poleFirst, count: poleSlices.length, words: pole.max + 1,
                segment: `0x${pole.seg.toString(16)}` },
        polebench: { first: poleBenchFirst, count: poleBenchSlices.length,
                     words: poleBench.max + 1, segment: `0x${poleBench.seg.toString(16)}` },
      } : {}),
      hello: { first: helloFirst, count: helloSlices.length, chars: hello.length },
      ping: { first: pingFirst, count: pingSlices.length, samples: ping.bytes.length,
              rate: ping.rate },
      swoosh: { first: swooshFirst, count: swooshSlices.length, samples: swoosh.bytes.length,
                rate: swoosh.rate },
      lila: { first: lilaFirst, count: lilaSlices.length, chars: lila.length },
    },
  };
  return { words, bytes, manifest };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = process.argv.find((a) => a.startsWith('--out='));
  const out = path.resolve(ROOT, arg ? arg.slice(6) : 'artifacts/image/slices.bin');
  const { bytes, manifest } = buildSlices({
    includePole: process.argv.includes('--with-pole'),
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, bytes);
  fs.writeFileSync(path.join(path.dirname(out), 'slices.manifest.json'),
                   JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  ${path.relative(ROOT, out)}  ${bytes.length} bytes, ${manifest.slices} slices`);
  for (const [name, o] of Object.entries(manifest.objects))
    console.log(`    ${name.padEnd(8)} slice ${o.first}..${o.first + o.count - 1}  ` +
                (o.chars !== undefined ? `${o.chars} chars` : `${o.words} words`));
  console.log(`  flash at 0x${SCREEN_BASE.toString(16)} (sector 512)`);
}
