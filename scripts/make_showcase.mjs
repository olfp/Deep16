#!/usr/bin/env node
// scripts/make_showcase.mjs - assemble the D16D showcase menu + Flappy game,
// and the separate Pac-Man block that sits at physical 0x4330.
//
// Both sources are concatenated so the menu and game share labels, constants
// and string data. The result is sparse: only the words the source actually
// defines are returned, so make_image can leave the game state cells and the
// ILL/divtest blocks alone.
//
// Offsets are segment offsets in the BIOS segment 0x04A0:
//   0x334  trampoline (the BIOS jumps here)
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
export const SHOWCASE_HEADER = 0x3E4;
export const SHOWCASE_SEG = 0x04A0;
export const SHOWCASE_SEG_BASE = 0x4A00;      // physical base of the segment
export const MENU_LIMIT = 0x5E0;              // menu may use 0x500..0x5DF
export const PACMAN_SEG = 0x0433;             // physical 0x4330
export const PACMAN_SEG_BASE = 0x4330;
export const PACMAN_LIMIT = 0x6D0;            // block size 0x4330..0x49FF
export const PACMAN_CODE_LIMIT = 0x600;       // code and strings before the map
export const FROGGER_SEG = 0x0435;             // physical 0x4350
export const FROGGER_SEG_BASE = 0x4350;
export const FROGGER_LIMIT = 0x6B0;            // block must end before the BIOS at 0x4A00
export const GAME_LIMIT = 0x0E00;             // game may use 0xA00..0xDFF
export const PS2HOST_SEG = 0x0400;            // physical 0x4000
export const PS2HOST_LIMIT = 0x7F0;           // block must fit one 4 KB slice
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
  const sources = ['asm/showcase/showcase.asm']
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

// Pac-Man is a second, independent block: assembled with .org 0 and placed at
// physical 0x4330.  The menu jumps to it with R10/R11 as the far return pair.
export function buildPacman() {
  const Deep16Assembler = loadAssembler();
  const sources = ['asm/showcase/pacman_map.asm', 'asm/showcase/pacman_game.asm']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const source = sources.join('\n');
  const res = new Deep16Assembler().assemble(source);
  if (!res.success) throw new Error('pacman sources do not assemble: ' + res.errors.join('; '));

  const words = [];
  let max = 0;
  for (const c of res.memoryChanges) {
    if (c.address < 0 || c.address >= PACMAN_LIMIT) {
      throw new Error(`pacman address out of range: 0x${c.address.toString(16)}`);
    }
    words.push([c.address, c.value & 0xFFFF]);
    max = Math.max(max, c.address);
  }
  words.sort((a, b) => a[0] - b[0]);
  const build = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  return {
    words, min: words[0]?.[0] ?? 0, max, size: max + 1, build,
    entry: 0, seg: PACMAN_SEG, codeEnd: res.symbols.p_code_end,
    symbols: res.symbols,
  };
}

export function checkPacman(pacman) {
  const fail = [];
  if (pacman.codeEnd > PACMAN_CODE_LIMIT) {
    fail.push(`code ends at 0x${pacman.codeEnd.toString(16)}, past 0x${PACMAN_CODE_LIMIT.toString(16)}`);
  }
  if (pacman.max >= PACMAN_LIMIT) fail.push(`pacman block reaches 0x${pacman.max.toString(16)}`);
  const at = (a) => pacman.words.find((w) => w[0] === a)?.[1];
  if (at(0x600) === undefined) fail.push('maze map missing at 0x600');
  if (pacman.words.some(([a]) => a >= 0x6A0)) fail.push('pacman writes into the game state cells');
  if (fail.length) throw new Error('pacman block is not valid:\n  - ' + fail.join('\n  - '));
  return true;
}

// Flappy is a type-4 slice loaded into segment 0x5000. The definition file
// carries the constants and the tables that used to be shared with the menu.
export function buildFlappy() {
  const Deep16Assembler = loadAssembler();
  const sources = ['asm/showcase/flappy_defs.asm', 'asm/showcase/flappy_game.asm']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const source = sources.join('\n');
  const res = new Deep16Assembler().assemble(source);
  if (!res.success) throw new Error('flappy does not assemble: ' + res.errors.join('; '));
  const words = [];
  let max = 0;
  for (const c of res.memoryChanges) {
    if (c.address < 0 || c.address >= 0x10000) throw new Error(`flappy address out of range: 0x${c.address.toString(16)}`);
    words.push([c.address, c.value & 0xFFFF]);
    max = Math.max(max, c.address);
  }
  words.sort((a, b) => a[0] - b[0]);
  const build = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  return { words, min: words[0]?.[0] ?? 0, max, size: max + 1, build, entry: 0, seg: 0x5000 };
}

export function checkFlappy(flappy) {
  if (flappy.words[0]?.[0] !== 0) throw new Error('flappy block does not start at offset 0');
  if (flappy.max >= 0x10000) throw new Error('flappy block is too large');
  return true;
}

// The Frogger per-row-scroll backdrop is a type-4 slice loaded at 0x0600.
export function buildFrogger() {
  const Deep16Assembler = loadAssembler();
  const source = fs.readFileSync(path.join(ROOT, 'asm/showcase/frogger_demo.asm'), 'utf8');
  const res = new Deep16Assembler().assemble(source);
  if (!res.success) throw new Error('frogger demo does not assemble: ' + res.errors.join('; '));

  const words = [];
  let max = 0;
  for (const c of res.memoryChanges) {
    if (c.address < 0 || c.address >= FROGGER_LIMIT) {
      throw new Error(`frogger address out of range: 0x${c.address.toString(16)}`);
    }
    words.push([c.address, c.value & 0xFFFF]);
    max = Math.max(max, c.address);
  }
  words.sort((a, b) => a[0] - b[0]);
  const build = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  return {
    words, min: words[0]?.[0] ?? 0, max, size: max + 1, build,
    entry: 0, seg: FROGGER_SEG, symbols: res.symbols,
  };
}

// The PS/2 host sender is a type-4 binary block loaded at segment 0x4000.
// It is called with `0x4000 call-far`, with the command byte on the data stack.
export function buildPs2Host() {
  const Deep16Assembler = loadAssembler();
  const source = fs.readFileSync(path.join(ROOT, 'asm/ps2_host.asm'), 'utf8');
  const res = new Deep16Assembler().assemble(source);
  if (!res.success) throw new Error('ps2 host does not assemble: ' + res.errors.join('; '));
  const words = [];
  let max = 0;
  for (const c of res.memoryChanges) {
    if (c.address < 0 || c.address >= PS2HOST_LIMIT) {
      throw new Error(`ps2 host address out of range: 0x${c.address.toString(16)}`);
    }
    words.push([c.address, c.value & 0xFFFF]);
    max = Math.max(max, c.address);
  }
  words.sort((a, b) => a[0] - b[0]);
  const build = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  return {
    words, min: words[0]?.[0] ?? 0, max, size: max + 1, build,
    entry: 0, seg: PS2HOST_SEG, symbols: res.symbols,
  };
}

export function checkPs2Host(host) {
  if (host.words[0]?.[0] !== 0) throw new Error('ps2 host block does not start at offset 0');
  if (host.max >= PS2HOST_LIMIT) throw new Error('ps2 host block is too large');
  return true;
}

export function checkFrogger(frogger) {
  const fail = [];
  if (frogger.max >= FROGGER_LIMIT) fail.push(`frogger block reaches 0x${frogger.max.toString(16)}`);
  const at = (a) => frogger.words.find((w) => w[0] === a)?.[1];
  if (at(0x300) === undefined) fail.push('frogger state missing at 0x300');
  if (fail.length) throw new Error('frogger block is not valid:\n  - ' + fail.join('\n  - '));
  return true;
}

export function checkShowcase(showcase) {
  const fail = [];
  const at = (a) => showcase.words.find((w) => w[0] === a)?.[1];
  if (at(SHOWCASE_HEADER) !== SHOWCASE_MAGIC) fail.push('magic missing at 0x3E4');
  if (at(SHOWCASE_HEADER + 1) !== SHOWCASE_FORMAT) fail.push('format is not 1');
  if (at(SHOWCASE_HEADER + 2) !== SHOWCASE_ENTRY) fail.push('entry is not 0x334');

  // The sparse writes must not touch the ILL/divtest blocks, the stacks, or
  // the top of the image. The old game state cells at 0x4D5+ are menu data now.
  for (const [a] of showcase.words) {
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
