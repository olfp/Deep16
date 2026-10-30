// The D16nano tile console: the BIOS writes the 82x26 tilemap the DVI tile
// engine renders, so the scroll is two pieces that must agree - the 24-row
// circular window in dvi_tile.sv and the row offset/clear in forth_nano.asm.
//
// This pins the BIOS half: when a line feed at the bottom row scrolls, the row
// that becomes the new bottom must be cleared before the prompt is drawn. The
// first implementation kept the tilemap address in R0 and then loaded the clear
// count with LDI (which always writes R0), so it cleared 82 cells at ES:0x52
// instead of the tilemap row and the scrolled-out first line stayed visible at
// the bottom of the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, buildMemory, loadBrowserScripts, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const TILEMAP = 0xF1000;     // ES:0x1000 with ES = 0xF000
const COLS = 82;             // map stride; 80 visible plus one tile of margin
const ROWS = 24;             // visible rows in the circular window
const SPACE_TILE = 0;        // tile 0 is the space glyph

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1, D16NANO: 1 } });
assert.equal(kernel.success, true, kernel.errors.join('; '));
const sym = kernel.symbols;

const sim = new globalThis.Deep16Simulator();
sim.loadProgram(buildMemory(kernel));
sim.segmentRegisters.CS = 0xFFFF;
sim.running = true;

function pump(limit) {
  for (let i = 0; i < limit && sim.running; i++) sim.step();
}

// The boot script compiles before the first prompt; wait for it rather than
// counting steps (the packed source costs a few instructions per character).
function boot() {
  for (let i = 0; i < 6_000_000 && !sim.memory[sym.boot_done]; i += 1000) pump(1000);
  pump(100_000);
}

function press(ch) {
  sim.uartRxPush(ch === '\n' ? 13 : ch.charCodeAt(0));
  pump(80000);
}

function cell(row, col) {
  return sim.memory[TILEMAP + row * COLS + col] & 0xFFFF;
}

test('a bottom-row line feed clears the row that scrolls in', () => {
  boot();
  assert.equal(sim.memory[sym.tile_row], 2, 'banner and prompt occupy two rows');
  assert.equal(sim.memory[sym.tile_off], 0);

  // Empty lines are the cheapest way down the screen: each prints the prompt
  // and ends with a line feed, and the last few push the row offset up.
  while (sim.memory[sym.tile_row] < ROWS - 1) press('\n');
  assert.equal(sim.memory[sym.tile_row], ROWS - 1);
  assert.equal(sim.memory[sym.tile_off], 0);

  press('\n');
  assert.equal(sim.memory[sym.tile_row], ROWS - 1, 'the cursor row stays at the bottom');
  assert.equal(sim.memory[sym.tile_off], 1, 'the window scrolled by one row');

  // Logical row 23 now maps to physical row (23 + off) % 24 = 0, the row the
  // banner used to occupy before the scroll. It must hold the prompt and
  // nothing else.
  const physical = (ROWS - 1 + 1) % ROWS;
  const first = cell(physical, 0);
  assert.notEqual(first & 0x0FFF, 0x500, 'the Hello tile must have been cleared, not wrapped');
  let text = '';
  for (let c = 0; c < 20; c++) {
    const tile = cell(physical, c);
    const blank = (tile & 0x0FFF) === SPACE_TILE;
    text += blank ? ' ' : String.fromCharCode(((tile >> 5) & 0x7F) + 0x20);
  }
  assert.equal(text.trimEnd(), '>', `bottom row after the scroll is ${JSON.stringify(text)}`);
  for (let c = 2; c < COLS - 1; c++) {
    assert.equal(cell(physical, c) & 0x0FFF, SPACE_TILE, `cell ${c} of the scrolled-in row is not blank`);
  }

  // The next line feed must scroll again; the old bug also wedged the offset
  // because the writes landed in the I/O segment.
  press('\n');
  assert.equal(sim.memory[sym.tile_off], 2);
  assert.equal(sim.memory[sym.tile_row], ROWS - 1);
});

test('the text attribute carries underline, bold and italic into the tilemap cell', () => {
  const styled = (ch, style) => 0x8000 | style | ((ch.charCodeAt(0) - 0x20) * 32);
  const has = (value) => {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (cell(r, c) === value) return true;
    return false;
  };

  sim.memory[sym.text_attr] = 0x8000 | 4;    // underline
  press('A');
  assert.ok(has(styled('A', 4)), 'underline bit reached the cell');

  sim.memory[sym.text_attr] = 0x8000 | 2;    // bold
  press('B');
  assert.ok(has(styled('B', 2)), 'bold bit reached the cell');

  sim.memory[sym.text_attr] = 0x8000 | 1;    // italic
  press('C');
  assert.ok(has(styled('C', 1)), 'italic bit reached the cell');

  sim.memory[sym.text_attr] = 0x8000;
  press('\n');                               // clear the ABC line buffer
});
