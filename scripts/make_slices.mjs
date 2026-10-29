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
//
// Header word 0: bit15 WP, bits14:12 magic 5, bits11:8 flags/rate, bits7:0
// type. Cell 1 link (0xFFFF none), cells 2..7 name (12 chars, 2/cell, low
// byte first), payload from cell 8. A directory entry is 8 cells: word0 type
// (flags bits11:8), word1 first slice, cells 2..7 name.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SLICE_WORDS = 2048;
export const SLICE_BYTES = 4096;
export const SLICE_PAYLOAD = 2040;
export const SCREEN_BASE = 0x200000;       // byte address of slice 0
export const MAGIC = 5;

export const TYPES = {
  EMPTY: 0x00, TEST: 0x01, SPRITE: 0x02, SCREEN: 0x03, BINARY: 0x04,
  PCM: 0x05, FONT: 0x06, DIRECTORY: 0x07, PACKED: 0x08, RLL: 0x09,
  ULAW: 0x0A, CHUNK: 0x0B,
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

// Split a text source into 2040-char slices, LF-padded. The first slice is a
// type-3 source; continuations are type 0 and linked.
function sourceSlices(text, firstIndex, baseName) {
  const count = Math.max(1, Math.ceil(text.length / SLICE_PAYLOAD));
  const out = [];
  for (let i = 0; i < count; i++) {
    const words = new Uint16Array(SLICE_WORDS);
    const name = i === 0 ? baseName : `${baseName}${i + 1}`;
    const h = header({
      type: i === 0 ? TYPES.SCREEN : TYPES.EMPTY,
      link: i === count - 1 ? 0xffff : firstIndex + i + 1,
      name,
    });
    words.set(h, 0);
    for (let j = 0; j < SLICE_PAYLOAD; j++) {
      const at = i * SLICE_PAYLOAD + j;
      words[8 + j] = at < text.length ? (text.charCodeAt(at) & 0xff) : 10;
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

export function buildSlices() {
  const sd = fs.readFileSync(path.join(ROOT, 'screens', 'flash', 'sd.fth'), 'utf8');
  const hello = fs.readFileSync(path.join(ROOT, 'screens', 'flash', 'hello.fth'), 'utf8');
  const catalog = fs.readFileSync(path.join(ROOT, 'screens', 'flash', 'catalog.fth'), 'utf8');
  const sdFirst = 1;
  const sdSlices = sourceSlices(sd, sdFirst, 'sd');
  const helloFirst = sdFirst + sdSlices.length;
  const helloSlices = sourceSlices(hello, helloFirst, 'hello');
  const catFirst = helloFirst + helloSlices.length;
  const catSlices = sourceSlices(catalog, catFirst, 'catalog');
  const slices = [directory([
    entry({ type: TYPES.SCREEN, first: sdFirst, name: 'sd' }),
    entry({ type: TYPES.SCREEN, first: helloFirst, name: 'hello' }),
    entry({ type: TYPES.SCREEN, first: catFirst, name: 'catalog' }),
  ]), ...sdSlices, ...helloSlices, ...catSlices];
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
      sd: { first: sdFirst, count: sdSlices.length, chars: sd.length },
      hello: { first: helloFirst, count: helloSlices.length, chars: hello.length },
      catalog: { first: catFirst, count: catSlices.length, chars: catalog.length },
    },
  };
  return { words, bytes, manifest };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = process.argv.find((a) => a.startsWith('--out='));
  const out = path.resolve(ROOT, arg ? arg.slice(6) : 'artifacts/image/slices.bin');
  const { bytes, manifest } = buildSlices();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, bytes);
  fs.writeFileSync(path.join(path.dirname(out), 'slices.manifest.json'),
                   JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  ${path.relative(ROOT, out)}  ${bytes.length} bytes, ${manifest.slices} slices`);
  for (const [name, o] of Object.entries(manifest.objects))
    console.log(`    ${name.padEnd(8)} slice ${o.first}..${o.first + o.count - 1}  ${o.chars} chars`);
  console.log(`  flash at 0x${SCREEN_BASE.toString(16)} (sector 512)`);
}
