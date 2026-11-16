// scripts/pole_program.mjs - assemble the D16 Pole renderer program.
//
// The program is four sources concatenated in load order:
//   asm/pole/pole_tables.asm  the data tables and their addresses
//   asm/pole/pole_render.asm  the renderer
//   asm/pole/pole_state.asm   the shared state handling
//   asm/pole/pole_bench.asm   the benchmark driver
//
// The board build swaps the last source for asm/pole/pole_board.asm, which is
// the same renderer with an on-board timing harness around it.
//
// The tables come first because the assembler resolves .equ constants when it
// reaches them; each source places itself with .org, so the order only
// matters for the symbols and for reading.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const POLE_SOURCES = [
  'asm/pole/pole_tables.asm',
  'asm/pole/pole_render.asm',
  'asm/pole/pole_state.asm',
  'asm/pole/pole_bench.asm',
];

// The on-board harness: the same renderer and the same state handling, with
// the board driver in place of the benchmark driver.
export const POLE_BOARD_SOURCES = [
  'asm/pole/pole_tables.asm',
  'asm/pole/pole_render.asm',
  'asm/pole/pole_state.asm',
  'asm/pole/pole_board.asm',
];

let assembler = null;

export function loadAssembler() {
  if (assembler) return assembler;
  // A test may already have loaded the assembler into the global scope; the
  // class lives in the lexical scope, so ask for it instead of loading it
  // twice (that would be a redeclaration).
  const existing = vm.runInThisContext(
    'typeof Deep16Assembler !== "undefined" ? Deep16Assembler : null');
  if (existing) {
    assembler = existing;
    return assembler;
  }
  globalThis.window = globalThis.window || {};
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/deep16_assembler.js'), 'utf8'),
                      { filename: 'js/deep16_assembler.js' });
  assembler = vm.runInThisContext('Deep16Assembler');
  return assembler;
}

export function poleSource(sources = POLE_SOURCES) {
  return sources
    .map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'))
    .join('\n');
}

export function poleBoardSource() {
  return poleSource(POLE_BOARD_SOURCES);
}

// Assemble the program. defines: { FRAMES: 60, BENCH_RENDER: 1 }
export function assemblePole(defines = {}) {
  return assemble(poleSource(), defines);
}

// Assemble the on-board harness. defines: { POLE_FAST: 1 }
export function assemblePoleBoard(defines = {}) {
  return assemble(poleBoardSource(), defines);
}

function assemble(source, defines) {
  const { Deep16Assembler } = { Deep16Assembler: loadAssembler() };
  const res = new Deep16Assembler().assemble(source, { defines });
  if (!res.success) {
    throw new Error(`the Pole program does not assemble: ${res.errors.join('; ')}`);
  }
  return res;
}

// The program image as a flat word array indexed by physical address.
// The unused words are 0xFFFF, the same value the cores see in an empty
// memory, so the image can be written straight into a memory file.
export function poleImage(res) {
  const words = new Uint16Array(0x10000).fill(0xFFFF);
  for (const change of res.memoryChanges) {
    if (change.address < words.length) words[change.address] = change.value & 0xFFFF;
  }
  return words;
}

// The sparse word list the slice builder wants: [address, value] pairs.
export function poleWords(res) {
  const words = res.memoryChanges
    .map((c) => [c.address, c.value & 0xFFFF])
    .sort((a, b) => a[0] - b[0]);
  return { words, max: words.length ? words[words.length - 1][0] : 0 };
}
