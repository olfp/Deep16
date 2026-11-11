// The D16nano REPL separates the echoed input from the line's output with the
// space printed when Return is pressed. The output words therefore carry no
// leading space of their own, and " ok" only gets its leading space when the
// line actually printed something. This is the board's kernel, so the check
// runs the tile console and reads the rows back from the tilemap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, buildMemory, loadBrowserScripts, ROOT } from './helpers.js';
import { buildSlices, SCREEN_BASE } from '../scripts/make_slices.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const TILEMAP = 0xF1000;     // ES:0x1000 with ES = 0xF000
const COLS = 82;             // map stride; 80 visible plus one tile of margin
const SPACE_TILE = 0;

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1, D16NANO: 1 } });
assert.equal(kernel.success, true, kernel.errors.join('; '));
const sym = kernel.symbols;

test('Return separates the D16nano input from its output', () => {
  const sim = new globalThis.Deep16Simulator();
  const slices = buildSlices();
sim.loadProgram(buildMemory(kernel));
sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);
  sim.segmentRegisters.CS = 0xFFFF;
  sim.running = true;

  const pump = (limit) => {
    for (let i = 0; i < limit && sim.running; i++) sim.step();
  };
  const press = (line) => {
    for (const ch of line) {
      sim.uartRxPush(ch === '\n' ? 13 : ch.charCodeAt(0));
      pump(200000);
    }
  };
  const row = (r) => {
    let out = '';
    for (let c = 0; c < 80; c++) {
      const tile = sim.memory[TILEMAP + r * COLS + c] & 0xFFFF;
      const blank = (tile & 0x0FFF) === SPACE_TILE;
      out += blank ? ' ' : String.fromCharCode(((tile >> 5) & 0x7F) + 0x20);
    }
    return out.replace(/\s+$/, '');
  };

  // Banner, memory summary, then the prompt: wait for the boot script to
  // finish rather than counting steps (the packed source costs a few
  // instructions per character in read_line).
  for (let i = 0; i < 20_000_000 && !sim.memory[sym.boot_done]; i += 1000) pump(1000);
  pump(100_000);
  const r0 = sim.memory[sym.tile_row];
  assert.ok(r0 >= 2, `banner, loading lines, summary and prompt occupy ${r0} rows`);

  press('123 u.\n');
  assert.equal(row(r0), '> 123 u. 123 ok');

  press('1 .\n');
  assert.equal(row(r0 + 1), '> 1 . 1  ok');

  press(': foo ;\n');
  assert.equal(row(r0 + 2), '> : foo ; ok');

  press('." hi there"\n');
  assert.equal(row(r0 + 3), '> ." hi there" hi there ok');

  // cr is output too, even though it prints no glyph: ok keeps its leading
  // space on the row the line feed moved to.
  press('cr\n');
  assert.equal(row(r0 + 4), '> cr');
  assert.equal(row(r0 + 5), ' ok');
});
