#!/usr/bin/env node
// scripts/make_demo.mjs - assemble the D16D colour demo block.
//
// The demo rides in the boot image at PSRAM 0x4E00, in the gap between the BIOS
// code (ends at 0x4D31) and the Forth stacks (0x5800), inside the existing 24K
// image. The 24K image and the standard 25-page installer are unchanged; only
// the demo words at 0x4E00 are added. The block starts with a four-word header:
//
//   0  0x0D16 magic
//   1  format 1
//   2  entry offset (0x404)
//   3  reserved
//
// It runs in the BIOS segment CS=DS=0x04A0 (physical 0x4E00 = 0x04A0:0x0400).
// The source is asm/gfx_demo.asm, assembled at .org 0x404 so every label is
// already a segment offset.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_MAGIC  = 0x0D16;
export const DEMO_FORMAT = 1;
export const DEMO_ENTRY  = 0x0404;
export const DEMO_BASE   = 0x4E00;   // PSRAM word address in the flat image
export const DEMO_SEG    = 0x04A0;   // CS=DS of the demo (physical 0x4A00)
export const DEMO_OFFSET = 0x0400;   // demo offset in that segment
export const DEMO_LIMIT  = 0x0800;   // 2 KiB: the gap to the stacks

function loadAssembler() {
  globalThis.window = globalThis.window || {};
  try { return vm.runInThisContext('Deep16Assembler'); } catch { /* not yet */ }
  const file = path.join(ROOT, 'js', 'deep16_assembler.js');
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: 'deep16_assembler.js' });
  return vm.runInThisContext('Deep16Assembler');
}

export function buildDemo() {
  const Deep16Assembler = loadAssembler();
  const source = fs.readFileSync(path.join(ROOT, 'asm', 'gfx_demo.asm'), 'utf8');
  const res = new Deep16Assembler().assemble(source);
  if (!res.success) throw new Error('asm/gfx_demo.asm does not assemble: ' + res.errors.join('; '));

  let max = DEMO_OFFSET - 1;
  for (const c of res.memoryChanges) {
    if (c.address < DEMO_ENTRY) continue;   // the header owns 0x400..0x403
    if (c.address > max) max = c.address;
  }
  const words = new Uint16Array(Math.max(0, max - DEMO_OFFSET + 1)).fill(0xFFFF);
  words[0] = DEMO_MAGIC;
  words[1] = DEMO_FORMAT;
  words[2] = DEMO_ENTRY;
  words[3] = 0;
  for (const c of res.memoryChanges) {
    if (c.address >= DEMO_ENTRY) words[c.address - DEMO_OFFSET] = c.value & 0xFFFF;
  }
  const size = words.length;
  if (size > DEMO_LIMIT) throw new Error(`demo is ${size} words, over the ${DEMO_LIMIT}-word block`);

  const build = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  return { words, size, build, entry: DEMO_ENTRY, magic: DEMO_MAGIC, seg: DEMO_SEG, offset: DEMO_OFFSET };
}

export function checkDemo(demo) {
  const fail = [];
  if (demo.words[0] !== DEMO_MAGIC) fail.push('magic missing');
  if (demo.words[1] !== DEMO_FORMAT) fail.push('format is not 1');
  if (demo.words[2] !== DEMO_ENTRY) fail.push(`entry is not 0x${DEMO_ENTRY.toString(16)}`);
  if (demo.size <= 4) fail.push('empty demo');
  if (demo.size > DEMO_LIMIT) fail.push('demo over the 2 KiB block');
  if (fail.length) throw new Error('demo block is not valid:\n  - ' + fail.join('\n  - '));
  return true;
}

export function demoHex(demo, perLine = 8) {
  let out = '';
  for (let i = 0; i < demo.size; i++) {
    out += demo.words[i].toString(16).padStart(4, '0');
    out += ((i + 1) % perLine === 0) ? '\n' : ' ';
  }
  return out.replace(/ +$/, '') + '\n';
}

export function writeDemo(outDir, demo) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'demo.hex'), demoHex(demo));
  fs.writeFileSync(path.join(outDir, 'demo.manifest.json'), JSON.stringify({
    source: 'asm/gfx_demo.asm',
    magic: `0x${DEMO_MAGIC.toString(16)}`,
    format: DEMO_FORMAT,
    entry: `0x${DEMO_ENTRY.toString(16)}`,
    base: `0x${DEMO_BASE.toString(16)}`,
    segment: `0x${DEMO_SEG.toString(16)}`,
    size: demo.size,
    build: demo.build,
  }, null, 2) + '\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const demo = buildDemo();
  checkDemo(demo);
  const outDir = path.resolve(ROOT, 'artifacts/image');
  writeDemo(outDir, demo);
  console.log(`demo: ${demo.size} words at 0x${DEMO_BASE.toString(16)}, build ${demo.build}`);
  console.log(`  wrote ${path.relative(ROOT, outDir)}/demo.hex and demo.manifest.json`);
}
