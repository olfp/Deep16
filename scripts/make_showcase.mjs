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
import { ART_PACK_OFFSET, flappyArtPack, pacmanArtPack, froggerArtPack } from './make_tile_font.mjs';
import { SPR_PACK_OFFSET, froggerSpritePack } from './make_frogger_sprites.mjs';
import { birdSpriteWords } from './make_bird_sprite.mjs';
import {
  ART_OFFSETS, poleTileWords, poleSpriteWords, polePaletteWords,
} from './make_pole_art.mjs';
import { assemblePoleBoard } from './pole_program.mjs';

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
export const PACMAN_LIMIT = 0x2000;           // slice data below runtime sprite packs
export const PACMAN_CODE_LIMIT = 0x1000;      // code and strings before the tile pack
export const FROGGER_SEG = 0x0600;             // physical 0x6000, the slice segment
export const FROGGER_SEG_BASE = 0x6000;
export const FROGGER_LIMIT = 0x1000;           // code and state stay below the tile pack
export const GAME_LIMIT = 0x0E00;             // game may use 0xA00..0xDFF
export const POLE_SEG = 0x7000;                // physical 0x70000 (free segment)
export const FLAPPY_SPR_PACK = 0x2000;          // after the Flappy tile pack

export const POLE_LIMIT = 0x2600;              // the code, then the art blocks

export const STATE_BASE = 0x4D5;              // game state cells
export const RESTORE_BASE = 0x500;            // menu code starts here

// Append a game's tile pack at ART_PACK_OFFSET. `codeMax` keeps the size of
// the code/data part for the checks; `max` covers the pack as well.
function withArtPack(block, pack) {
  const words = block.words.slice();
  for (let i = 0; i < pack.length; i++) words.push([ART_PACK_OFFSET + i, pack[i] & 0xFFFF]);
  words.sort((a, b) => a[0] - b[0]);
  return {
    ...block,
    words,
    codeMax: block.max,
    packOffset: ART_PACK_OFFSET,
    packTiles: pack[1],
    max: Math.max(block.max, ART_PACK_OFFSET + pack.length - 1),
  };
}

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
  const pack = pacmanArtPack();
  if (ART_PACK_OFFSET + pack.length > 0x1340) {
    throw new Error(`pacman tile pack ends at 0x${(ART_PACK_OFFSET + pack.length).toString(16)}, past the maze`);
  }
  const build = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  return withArtPack({
    words, min: words[0]?.[0] ?? 0, max, size: max + 1, build,
    entry: 0, seg: PACMAN_SEG, codeEnd: res.symbols.p_code_end,
    symbols: res.symbols,
  }, pack);
}

export function checkPacman(pacman) {
  const fail = [];
  if (pacman.codeEnd > PACMAN_CODE_LIMIT) {
    fail.push(`code ends at 0x${pacman.codeEnd.toString(16)}, past 0x${PACMAN_CODE_LIMIT.toString(16)}`);
  }
  if ((pacman.codeMax ?? pacman.max) >= PACMAN_LIMIT)
    fail.push(`pacman block reaches 0x${(pacman.codeMax ?? pacman.max).toString(16)}`);
  const at = (a) => pacman.words.find((w) => w[0] === a)?.[1];
  if (at(0x1340) === undefined) fail.push('maze map missing at 0x1340');
  if (pacman.words.some(([a]) => a >= 0x1900 && a < 0x1980))
    fail.push('pacman writes into the game state cells');
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
  const block = withArtPack(
    { words, min: words[0]?.[0] ?? 0, max, size: max + 1, build, entry: 0, seg: 0x5000 },
    flappyArtPack());
  // The bird and Pac-Man frames used to live only in the bitstream sprite
  // bank, so a game that installed its own art (Pole, Frogger) left Flappy
  // with the wrong sprites. Carry the pack in the slice and let Flappy copy
  // it into 0xF400 on entry.
  const sprites = birdSpriteWords();
  for (let i = 0; i < sprites.length; i++) block.words.push([FLAPPY_SPR_PACK + i, sprites[i] & 0xFFFF]);
  block.words.sort((a, b) => a[0] - b[0]);
  block.spriteOffset = FLAPPY_SPR_PACK;
  block.spriteWords = sprites.length;
  block.max = Math.max(block.max, FLAPPY_SPR_PACK + sprites.length - 1);
  return block;
}

export function checkFlappy(flappy) {
  if (flappy.words[0]?.[0] !== 0) throw new Error('flappy block does not start at offset 0');
  if (flappy.max >= 0x10000) throw new Error('flappy block is too large');
  const at = (a) => flappy.words.find((w) => w[0] === a)?.[1];
  if (at(FLAPPY_SPR_PACK) === undefined) throw new Error('flappy sprite pack missing at 0x2000');
  if (flappy.max > 0x3FFF) throw new Error(`flappy block reaches 0x${flappy.max.toString(16)}, past the sprite pack`);
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
  const block = withArtPack({
    words, min: words[0]?.[0] ?? 0, max, size: max + 1, build,
    entry: 0, seg: FROGGER_SEG, symbols: res.symbols,
  }, froggerArtPack());
  // The sprite pack follows the tiles at 0x2000.
  const sprites = froggerSpritePack();
  for (let i = 0; i < sprites.length; i++) block.words.push([SPR_PACK_OFFSET + i, sprites[i] & 0xFFFF]);
  block.words.sort((a, b) => a[0] - b[0]);
  block.spriteOffset = SPR_PACK_OFFSET;
  block.spriteGroups = sprites[1];
  block.max = Math.max(block.max, SPR_PACK_OFFSET + sprites.length - 1);
  return block;
}

export function checkFrogger(frogger) {
  const fail = [];
  if ((frogger.codeMax ?? frogger.max) >= FROGGER_LIMIT)
    fail.push(`frogger block reaches 0x${(frogger.codeMax ?? frogger.max).toString(16)}`);
  const at = (a) => frogger.words.find((w) => w[0] === a)?.[1];
  if (at(0xA00) === undefined) fail.push('frogger state missing at 0xA00');
  if (at(ART_PACK_OFFSET) !== 0x0A57) fail.push('frogger tile pack missing at 0x1000');
  if (at(SPR_PACK_OFFSET) !== 0x0A58) fail.push('frogger sprite pack missing at 0x2000');
  if (fail.length) throw new Error('frogger block is not valid:\n  - ' + fail.join('\n  - '));
  return true;
}

// The Pole road renderer is a type-4 slice loaded at segment 0x7000. It
// carries the renderer, the shared state handling, the on-board timing
// harness and the art: the tile bank, the sprite bank and the palettes, so
// the board draws a real road instead of whatever the last game left in the
// banks.
export function buildPole() {
  const res = assemblePoleBoard();
  const words = [];
  let max = 0;
  for (const c of res.memoryChanges) {
    if (c.address < 0 || c.address >= POLE_LIMIT) {
      throw new Error(`pole address out of range: 0x${c.address.toString(16)}`);
    }
    words.push([c.address, c.value & 0xFFFF]);
    max = Math.max(max, c.address);
  }
  // The art blocks: the 32 tiles, the 17 sprite groups and the palettes.
  const art = [
    [ART_OFFSETS.TILE, poleTileWords()],
    [ART_OFFSETS.SPRITE, poleSpriteWords()],
    [ART_OFFSETS.PALETTE, polePaletteWords()],
  ];
  for (const [base, block] of art) {
    for (let i = 0; i < block.length; i++) {
      const address = base + i;
      if (address >= POLE_LIMIT) {
        throw new Error(`pole art ends at 0x${address.toString(16)}, past the segment`);
      }
      words.push([address, block[i] & 0xFFFF]);
      max = Math.max(max, address);
    }
  }
  words.sort((a, b) => a[0] - b[0]);
  const build = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, 'asm/pole/pole_tables.asm'), 'utf8') +
            fs.readFileSync(path.join(ROOT, 'asm/pole/pole_render.asm'), 'utf8') +
            fs.readFileSync(path.join(ROOT, 'asm/pole/pole_state.asm'), 'utf8') +
            fs.readFileSync(path.join(ROOT, 'asm/pole/pole_board.asm'), 'utf8') +
            fs.readFileSync(path.join(ROOT, 'asm/pole/pole_art.asm'), 'utf8'))
    .digest('hex').slice(0, 16);
  return {
    words, min: words[0]?.[0] ?? 0, max, size: max + 1, build,
    entry: 0, seg: POLE_SEG, symbols: res.symbols,
  };
}

export function checkPole(pole) {
  const fail = [];
  if (pole.words[0]?.[0] !== 0) fail.push('pole block does not start at offset 0');
  if (pole.max >= POLE_LIMIT) fail.push(`pole block reaches 0x${pole.max.toString(16)}`);
  // A type-4 slice carries five header words and 2040 payload words per
  // slice, so the block may span several slices.
  const slices = Math.ceil((pole.max + 1 + 5) / 2040);
  if (slices > 8) fail.push(`the pole block needs ${slices} slices`);
  // The harness's own cells start at 0x0520; the renderer's scratch cells
  // (0x04DC..0x04EC) and the band descriptors (0x04F0..0x051F) are off limits.
  for (const [a] of pole.words) {
    if (a >= 0x04DC && a < 0x0520) {
      fail.push(`write into the renderer's scratch at 0x${a.toString(16)}`);
      break;
    }
  }
  // The code has to end before the art copy at 0x0900, and the art blocks
  // have to sit where asm/pole/pole_art.asm expects them.
  const code = pole.words.filter(([a]) => a < 0x0900).map(([a]) => a);
  if (Math.max(...code) >= 0x0900) {
    fail.push(`the pole code reaches 0x${Math.max(...code).toString(16)}`);
  }
  for (const [base, length] of [[ART_OFFSETS.TILE, 1024],
                                [ART_OFFSETS.SPRITE, 4352],
                                [ART_OFFSETS.PALETTE, 48]]) {
    const at = pole.words.find(([a]) => a === base)?.[1];
    if (at === undefined) fail.push(`the pole art block at 0x${base.toString(16)} is missing`);
    if (base + length > POLE_LIMIT) {
      fail.push(`the pole art block at 0x${base.toString(16)} runs past the segment`);
    }
  }
  if (pole.symbols.pole_render !== 0x01A0) fail.push('the renderer moved');
  if (fail.length) throw new Error('pole block is not valid:\n  - ' + fail.join('\n  - '));
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
