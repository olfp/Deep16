#!/usr/bin/env node
// scripts/make_image.mjs - build the D16MINI boot image from asm/forth.asm.
//
// D16MINI.md §6.5. The image is the UART (CONSOLE_UART) kernel laid into the
// 24K-word BSRAM window (0x0000-0x5FFF) and filled with 0xFFFF, so a run off the
// end of memory hits the halt word instead of `LDI 0` forever (§6.1).
// (24K, not 26 - GowinSynthesis' BSRAM granularity; §2 and §4.7.)
//
// The image is a *synthesis* input - Gowin bakes it into the bitstream, so the
// configuration itself is the "flash to RAM" step (§6.2.1). Two files:
//
//   image.hex   $readmemh, 8 words per line - for Verilator
//   image.mi    one word per line - Gowin INIT_FILE (dialect to confirm on EDK)
//
// plus image.manifest.json (range, fill, build id).
//
// Usage:
//   npm run image                     # writes artifacts/image/
//   npm run image -- --out=/tmp/x     # choose the directory
//   npm run image -- --check          # assert only, write nothing
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const WINDOW = 0x6000;      // 24 BSRAM blocks x 1024 words (§2, §4.7)
export const FILL   = 0xFFFF;      // the halt word, everywhere unused (§6.1)
export const IMG_BLOCK_WORDS = 0x4000; // 16 BSRAM blocks: the packed-image budget
export const BIOS_BASE  = 0x5600;  // must match asm/forth.asm and D16MINI.md §3
export const STACK_BASE = 0x5800;  // RSTACK_TOP: the dictionary stays below it
export const ECHO_FLAG  = 0xF0064; // the kernel's echo cell: outside the window,
                                   // so the board neither backs nor decodes it
                                   // (D16MINI.md §6.4) - it is expected here

function loadAssembler() {
  globalThis.window = globalThis.window || {};
  // A top-level `class` lands in the global lexical scope, so a second run would
  // throw "already declared" - reuse it if something (a test) loaded it first.
  try { return vm.runInThisContext('Deep16Assembler'); } catch { /* not yet */ }
  const file = path.join(ROOT, 'js', 'deep16_assembler.js');
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: 'deep16_assembler.js' });
  return vm.runInThisContext('Deep16Assembler');
}

// Assemble the kernel and lay it into the window. Returns the words plus the
// facts the assertions and the manifest need.
export const DEFINES = { CONSOLE_UART: 1 };
if (process.env.BOOT_DIAG) DEFINES.BOOT_DIAG = 1;     // boot diagnostic build

export function buildImage() {
  const Deep16Assembler = loadAssembler();
  const source = fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8');
  const res = new Deep16Assembler().assemble(source, { defines: DEFINES });
  if (!res.success) throw new Error('forth.asm does not assemble: ' + res.errors.join('; '));

  const words = new Uint16Array(WINDOW).fill(FILL);
  const outOfWindow = new Set();
  for (const c of res.memoryChanges) {
    if (c.address < WINDOW) words[c.address] = c.value & 0xFFFF;
    else outOfWindow.add(c.address);
  }

  const sym = res.symbols;
  const biosWords = (() => {
    let hi = 0;
    for (const c of res.memoryChanges) {
      if (c.address >= sym.bios_entry && c.address < WINDOW) hi = Math.max(hi, c.address);
    }
    return hi - sym.bios_entry + 1;
  })();

  const build = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);

  return {
    words, outOfWindow: [...outOfWindow].sort((a, b) => a - b),
    dictFree: sym.dict_free, biosEntry: sym.bios_entry, biosWords, build,
  };
}

// The invariants §6.5 names. Throws with a readable message; the CLI and the
// test both call it.
export function checkImage(img) {
  const fail = [];
  if (img.dictFree >= STACK_BASE) fail.push(`dict_free 0x${img.dictFree.toString(16)} reaches the stacks (0x${STACK_BASE.toString(16)})`);
  if (img.biosEntry !== BIOS_BASE) fail.push(`BIOS at 0x${img.biosEntry.toString(16)}, expected 0x${BIOS_BASE.toString(16)}`);
  if (img.biosEntry + img.biosWords > STACK_BASE) fail.push(`BIOS (${img.biosWords} words) overruns the stacks`);
  // The only word outside the window is the kernel's echo cell, which the board
  // neither backs nor decodes (§6.4) - anything else means the kernel grew a
  // high address the board cannot back.
  const unexpected = img.outOfWindow.filter((a) => a !== ECHO_FLAG);
  if (unexpected.length) fail.push(`words outside the window: ${unexpected.map((a) => '0x' + a.toString(16)).join(', ')}`);
  if (fail.length) throw new Error('boot image is not valid:\n  - ' + fail.join('\n  - '));
  return true;
}

export function imageHex(img, perLine = 8) {
  let out = '';
  for (let i = 0; i < img.words.length; i++) {
    out += img.words[i].toString(16).padStart(4, '0');
    out += ((i + 1) % perLine === 0) ? '\n' : ' ';
  }
  return out.replace(/ +$/, '') + '\n';
}

export function imageMi(img) {
  // One hex word per line. Gowin's INIT_FILE dialect is not verifiable here
  // (no toolchain); this is the shape EDK reads, to confirm on first synthesis.
  let out = '';
  for (let i = 0; i < img.words.length; i++) out += img.words[i].toString(16).padStart(4, '0') + '\n';
  return out;
}

// Range packing (deep16_psram_mem's loader format).
//
// The flat image is 24,576 words of which only ~15.7k are not FILL: the
// dictionary has reserved gaps, the stacks are empty, and the BIOS sits above
// them. Storing only the non-FILL runs in the BSRAM image costs 16 blocks
// instead of 24 (Gowin pads BSRAM depth to 4,096-word slices, so 24,576 rounds
// up to 24 blocks while 15,700 fits in 16). The loader walks the runs and
// writes FILL everywhere else; the verify walks the same runs.
//
//   word 0            range count N
//   words 1..2N       (start, end) pairs, inclusive, ascending
//   words 2N+1..       the contents of each range, concatenated
export function packImage(img) {
  const ranges = [];
  for (let i = 0; i < img.words.length;) {
    if (img.words[i] === FILL) { i++; continue; }
    const start = i;
    while (i < img.words.length && img.words[i] !== FILL) i++;
    ranges.push([start, i - 1]);
  }
  const words = [ranges.length];
  for (const [s, e] of ranges) words.push(s, e);
  for (const [s, e] of ranges) for (let a = s; a <= e; a++) words.push(img.words[a]);
  return { words, ranges };
}

// The inverse, used by the tests: a packed image must expand exactly.
export function expandImage(packed) {
  const count = packed[0];
  const words = new Uint16Array(WINDOW).fill(FILL);
  let src = 1 + 2 * count;
  for (let r = 0; r < count; r++) {
    const start = packed[1 + 2 * r], end = packed[2 + 2 * r];
    for (let a = start; a <= end; a++) words[a] = packed[src++];
  }
  return { words, src };
}

// The one invariant packing must never break: the loader's 16 blocks hold it,
// and expanding it gives back the flat image exactly.
export function checkPacked(img, packed) {
  const fail = [];
  if (packed.words.length > IMG_BLOCK_WORDS)
    fail.push(`packed image is ${packed.words.length} words, over the ${IMG_BLOCK_WORDS}-word (16-block) budget`);
  // The count lives in one word; the loader reads it into a 5-bit register.
  if (packed.ranges.length > 31) fail.push(`${packed.ranges.length} ranges do not fit the header counter`);
  const back = expandImage(packed.words).words;
  for (let a = 0; a < WINDOW; a++) {
    if (back[a] !== img.words[a]) {
      fail.push(`range expansion differs at 0x${a.toString(16)}: 0x${back[a].toString(16)} vs 0x${img.words[a].toString(16)}`);
      break;
    }
  }
  if (fail.length) throw new Error('packed boot image is not valid:\n  - ' + fail.join('\n  - '));
  return true;
}


export function manifest(img) {
  const pack = packImage(img);
  return JSON.stringify({
    project: 'D16MINI',
    source: 'asm/forth.asm',
    defines: DEFINES,
    base: '0x00000',
    window: `0x${(WINDOW - 1).toString(16)}`,
    words: WINDOW,
    fill: '0xFFFF',
    dict_free: `0x${img.dictFree.toString(16)}`,
    bios_entry: `0x${img.biosEntry.toString(16)}`,
    bios_words: img.biosWords,
    stack_base: `0x${STACK_BASE.toString(16)}`,
    build: img.build,
    pack: {
      format: 'count, (start,end) pairs, payload ranges',
      words: pack.words.length,
      blocks: Math.ceil(pack.words.length / 1024),
      ranges: pack.ranges.length,
    },
  }, null, 2) + '\n';
}

// --------------------------------------------------------------------------
function argValue(name, fallback) {
  const hit = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!hit) return fallback;
  if (hit === name) return true;
  return hit.slice(name.length + 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const img = buildImage();
  checkImage(img);
  const outDir = path.resolve(ROOT, String(argValue('--out', 'artifacts/image')));
  const check = argValue('--check', false);
  if (!check) {
    const packed = packImage(img);
    checkPacked(img, packed);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'image.hex'), imageHex(img));
    fs.writeFileSync(path.join(outDir, 'image.mi'), imageMi(img));
    fs.writeFileSync(path.join(outDir, 'image-packed.hex'),
                     imageHex({ words: packed.words }));
    fs.writeFileSync(path.join(outDir, 'image.manifest.json'), manifest(img));
    // The DVI text renderer reads its font with $readmemh too; keep it beside
    // the image so the Gowin include path and the board sims both find it.
    fs.copyFileSync(path.join(ROOT, 'rtl', 'dvi', 'font8x15.hex'),
                    path.join(outDir, 'font8x15.hex'));
  }
  const kb = (img.words.length * 2 / 1024).toFixed(0);
  console.log(`boot image: ${img.words.length} words (${kb} KiB), fill 0xFFFF, build ${img.build}`);
  console.log(`  dict_free 0x${img.dictFree.toString(16)}  BIOS 0x${img.biosEntry.toString(16)} (${img.biosWords} words)  stacks 0x${STACK_BASE.toString(16)}`);
  console.log(`  outside the window (dropped: the board does not back it): ${img.outOfWindow.map((a) => '0x' + a.toString(16)).join(', ') || 'none'}`);
  const pack = packImage(img);
  console.log(`  packed: ${pack.ranges.length} ranges, ${pack.words.length} words ` +
              `(${Math.ceil(pack.words.length / 1024)} BSRAM blocks of ${IMG_BLOCK_WORDS / 1024})`);
  if (!check) console.log(`  wrote ${path.relative(ROOT, outDir)}/image{,-packed}.hex, image.mi, image.manifest.json`);
  else console.log('  --check: nothing written');
}
