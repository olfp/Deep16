#!/usr/bin/env node
// scripts/make_showcase.mjs - assemble the D16D showcase menu + Flappy game.
//
// Both sources are concatenated so the menu and game share labels, constants
// and string data. The result is sparse: only the words the source actually
// defines are returned, so make_image can leave the colour demo, the game
// state cells and the ILL/divtest blocks alone.
//
// Offsets are segment offsets in the BIOS segment 0x04A0:
//   0x330  header + trampoline
//   0x339  strings and palettes
//   0x500  menu code
//   0x5E0  default palette
//   0xA00  game code
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHOWCASE_MAGIC = 0x0D16;
export const SHOWCASE_FORMAT = 1;
export const SHOWCASE_ENTRY = 0x334;
export const SHOWCASE_HEADER = 0x330;
export const SHOWCASE_SEG = 0x04A0;
export const SHOWCASE_SEG_BASE = 0x4A00;      // physical base of the segment
export const MENU_LIMIT = 0x5E0;              // menu may use 0x500..0x5DF
export const GAME_LIMIT = 0x0E00;             // game may use 0xA00..0xDFF
export const COLOR_BASE = 0x400;              // colour demo block
export const STATE_BASE = 0x4D5;              // game state cells
export const RESTORE_BASE = 0x500;            // menu code starts here

function loadAssembler() {
  globalThis.window = globalThis.window || {};
  try { return vm.runInThisContext('Deep16Assembler'); } catch { /* not yet */ }
  const file = path.join(ROOT, 'js', 'deep16_assembler.js');
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: 'deep16_assembler.js' });
  return vm.runInThisContext('Deep16Assembler');
}

export function buildShowcase() {
  const Deep16Assembler = loadAssembler();
  const sources = ['asm/showcase/showcase.asm', 'asm/showcase/flappy_game.asm']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const source = sources.join('\n');
  const res = new Deep16Assembler().assemble(source);
  if (!res.success) throw new Error('showcase sources do not assemble: ' + res.errors.join('; '));

  const words = [];
  let max = 0;
  for (const c of res.memoryChanges) {
    if (c.address < 0 || c.address >= 0x10000) throw new Error(`showcase address out of range: 0x${c.address.toString(16)}`);
    words.push([c.address, c.value & 0xFFFF]);
    max = Math.max(max, c.address);
  }
  words.sort((a, b) => a[0] - b[0]);

  const build = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  return {
    words, min: words[0]?.[0] ?? 0, max, size: max + 1, build,
    entry: SHOWCASE_ENTRY, magic: SHOWCASE_MAGIC, seg: SHOWCASE_SEG,
  };
}

export function checkShowcase(showcase) {
  const fail = [];
  const at = (a) => showcase.words.find((w) => w[0] === a)?.[1];
  if (at(SHOWCASE_HEADER) !== SHOWCASE_MAGIC) fail.push('magic missing at 0x330');
  if (at(SHOWCASE_HEADER + 1) !== SHOWCASE_FORMAT) fail.push('format is not 1');
  if (at(SHOWCASE_HEADER + 2) !== SHOWCASE_ENTRY) fail.push('entry is not 0x334');

  // The sparse writes must not touch the colour demo, the game state cells,
  // the ILL/divtest blocks, the stacks, or the top of the image.
  for (const [a] of showcase.words) {
    if (a >= COLOR_BASE && a < STATE_BASE)
      fail.push(`write into the colour-demo block at 0x${a.toString(16)}`);
    if (a >= STATE_BASE && a < RESTORE_BASE)
      fail.push(`write into the game state cells at 0x${a.toString(16)}`);
    if (a >= 0x600 && a < 0xA00)
      fail.push(`write into ILL/divtest at 0x${a.toString(16)}`);
    if (a >= GAME_LIMIT)
      fail.push(`write past the game block at 0x${a.toString(16)}`);
  }
  if (showcase.max >= GAME_LIMIT) fail.push(`showcase reaches 0x${showcase.max.toString(16)}`);
  if (fail.length) throw new Error('showcase block is not valid:\n  - ' + fail.join('\n  - '));
  return true;
}

export function showcaseManifest(showcase) {
  return {
    source: 'asm/showcase/showcase.asm + asm/showcase/flappy_game.asm',
    magic: `0x${SHOWCASE_MAGIC.toString(16)}`,
    format: SHOWCASE_FORMAT,
    entry: `0x${SHOWCASE_ENTRY.toString(16)}`,
    base: `0x${SHOWCASE_SEG_BASE.toString(16)}`,
    segment: `0x${SHOWCASE_SEG.toString(16)}`,
    min: `0x${showcase.min.toString(16)}`,
    max: `0x${showcase.max.toString(16)}`,
    build: showcase.build,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const showcase = buildShowcase();
  checkShowcase(showcase);
  console.log(`showcase: ${showcase.words.length} words, range 0x${showcase.min.toString(16)}..0x${showcase.max.toString(16)}, build ${showcase.build}`);
}
