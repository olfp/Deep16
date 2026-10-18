#!/usr/bin/env node
// scripts/make_image.mjs - build the D16MINI boot image from asm/forth.asm.
//
// D16MINI.md §6.5. The image is the UART (CONSOLE_UART) kernel laid into the
// 26K-word BSRAM window (0x0000-0x67FF) and filled with 0xFFFF, so a run off the
// end of memory hits the halt word instead of `LDI 0` forever (§6.1).
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

export const WINDOW = 0x6800;      // 26 BSRAM blocks x 1024 words (§2)
export const FILL   = 0xFFFF;      // the halt word, everywhere unused (§6.1)
export const BIOS_BASE  = 0x5F00;  // must match asm/forth.asm and D16MINI.md §3
export const STACK_BASE = 0x6000;  // RSTACK_TOP: the dictionary stays below it
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
export function buildImage() {
  const Deep16Assembler = loadAssembler();
  const source = fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8');
  const res = new Deep16Assembler().assemble(source, { defines: { CONSOLE_UART: 1 } });
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

export function manifest(img) {
  return JSON.stringify({
    project: 'D16MINI',
    source: 'asm/forth.asm',
    defines: { CONSOLE_UART: 1 },
    base: '0x00000',
    window: `0x${(WINDOW - 1).toString(16)}`,
    words: WINDOW,
    fill: '0xFFFF',
    dict_free: `0x${img.dictFree.toString(16)}`,
    bios_entry: `0x${img.biosEntry.toString(16)}`,
    bios_words: img.biosWords,
    stack_base: `0x${STACK_BASE.toString(16)}`,
    build: img.build,
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
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'image.hex'), imageHex(img));
    fs.writeFileSync(path.join(outDir, 'image.mi'), imageMi(img));
    fs.writeFileSync(path.join(outDir, 'image.manifest.json'), manifest(img));
  }
  const kb = (img.words.length * 2 / 1024).toFixed(0);
  console.log(`boot image: ${img.words.length} words (${kb} KiB), fill 0xFFFF, build ${img.build}`);
  console.log(`  dict_free 0x${img.dictFree.toString(16)}  BIOS 0x${img.biosEntry.toString(16)} (${img.biosWords} words)  stacks 0x${STACK_BASE.toString(16)}`);
  console.log(`  outside the window (dropped: the board does not back it): ${img.outOfWindow.map((a) => '0x' + a.toString(16)).join(', ') || 'none'}`);
  if (!check) console.log(`  wrote ${path.relative(ROOT, outDir)}/image.{hex,mi,manifest.json}`);
  else console.log('  --check: nothing written');
}
