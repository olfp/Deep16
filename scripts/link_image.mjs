#!/usr/bin/env node
// scripts/link_image.mjs - thin Node wrapper around js/deep16_linker.js.
//
// This is the debugging/manifest view of the link step, not the image writer:
// scripts/make_image.mjs still owns the flat image, the showcase blocks and the
// flash CRC. Phase 1 links one flat chapter, so the manifest here is exactly
// the chapter table the later phases will grow.
//
// Usage:
//   node scripts/link_image.mjs                    # manifest as JSON
//   node scripts/link_image.mjs --out=link.json    # write it
//   node scripts/link_image.mjs --check            # summary only
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function load(file, name) {
  globalThis.window = globalThis.window || {};
  try { return vm.runInThisContext(name); } catch { /* not loaded yet */ }
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  return vm.runInThisContext(name);
}

const NANO = !!process.env.D16NANO;
const D16D = !!process.env.D16D;
const D16SEG = !!process.env.D16SEG;
const FPU = process.env.FPU === '1' || D16D;

const defines = { CONSOLE_UART: 1 };
if (NANO) defines.D16NANO = 1;
if (D16SEG) defines.D16SEG = 1;
if (D16D) defines.D16D = 1;
if (FPU) defines.FPU_KERNEL = 1;

const kernelPath = NANO
  ? path.join(ROOT, 'asm', 'forth_nano.asm')
  : path.join(ROOT, 'archive', 'forth.asm');
const sources = [fs.readFileSync(kernelPath, 'utf8')];
if (FPU) {
  sources.push(fs.readFileSync(path.join(ROOT, 'asm', 'softfloat.asm'), 'utf8'));
  sources.push(fs.readFileSync(path.join(ROOT, 'asm', 'forth_float.asm'), 'utf8'));
  defines.FPU_WORDS = 1;
}

const Deep16Assembler = load('js/deep16_assembler.js', 'Deep16Assembler');
const Deep16Linker = load('js/deep16_linker.js', 'Deep16Linker');
const linked = new Deep16Linker(Deep16Assembler).link({
  chapters: [Deep16Linker.flat({ id: 'flat', base: 0, sources })],
  defines,
  window: FPU ? 0x7000 : 0x6000,
  fill: 0xFFFF,
});

const out = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? null;
const check = process.argv.includes('--check');
if (out) {
  fs.writeFileSync(out, JSON.stringify(linked.manifest, null, 2) + '\n');
  console.log(`wrote ${out}`);
} else if (!check) {
  process.stdout.write(JSON.stringify(linked.manifest, null, 2) + '\n');
}

const chapter = linked.chapters[0];
console.log(`flat chapter: ${chapter.wordCount} words at physical 0x${chapter.physical.toString(16)}, ` +
            `${Object.keys(linked.symbols).length} symbols`);
console.log(`out of window: ${linked.flatView.outOfWindow.length
  ? linked.flatView.outOfWindow.map((a) => '0x' + a.toString(16)).join(', ')
  : 'none'}`);
