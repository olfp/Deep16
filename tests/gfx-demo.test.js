// D16D colour demo: the block the flash image puts at PSRAM 0x6000.
//
// The demo is a standalone segment (CS=DS=0x0600). This test runs it on the JS
// core and checks the parts that do not depend on the DVI pixel domain: the
// generated sprite bank, the OAM entries, the scrolling tilemap, and the far
// return to the BIOS. The sprite compositor itself is covered by
// rtl/sim/dvi_tile_tb.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserScripts } from './helpers.js';
import { buildDemo, checkDemo, DEMO_BASE, DEMO_SEG, DEMO_ENTRY } from '../scripts/make_demo.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const SEG_DEMO = DEMO_SEG;          // 0x04A0, the BIOS segment
const RET_CS = DEMO_SEG;
const RET_PC = 0x0010;

function runDemo() {
  const demo = buildDemo();
  checkDemo(demo);
  const sim = new globalThis.Deep16Simulator();
  for (let i = 0; i < demo.size; i++) sim.memory[DEMO_BASE + i] = demo.words[i];

  // UART has one byte waiting from the start: the demo still initialises and
  // draws one frame before the poll at the end of the frame returns.
  sim.uartRxPush(0x41);
  sim.memory[0x4A00 + RET_PC] = 0xFFFF;

  sim.registers[12] = RET_PC;          // gfx_back offset
  sim.registers[15] = DEMO_ENTRY;      // 0x404 in the BIOS segment
  sim.segmentRegisters = { CS: SEG_DEMO, DS: SEG_DEMO, SS: 0, ES: 0 };
  sim.running = true;

  for (let step = 0; step < 600000; step++) {
    if (sim.segmentRegisters.CS === RET_CS && sim.registers[15] === RET_PC) return { sim, demo };
    sim.step();
  }
  assert.fail(`demo did not return (CS=${sim.segmentRegisters.CS.toString(16)} PC=${sim.registers[15].toString(16)})`);
}

test('D16D demo header and entry', () => {
  const demo = buildDemo();
  checkDemo(demo);
  assert.equal(demo.words[0], 0x0D16, 'magic');
  assert.equal(demo.words[1], 1, 'format');
  assert.equal(demo.words[2], DEMO_ENTRY, 'entry');
  assert.ok(demo.size > 4 && demo.size <= 0x800, 'demo fits the 2 KiB block');
});

test('D16D demo fills the sprite bank, OAM and tilemap, then far-returns', () => {
  const { sim } = runDemo();

  // Pattern bank: group 0 tile 0 word 0 uses colour 1 (0x1111).
  assert.equal(sim.memory[0xF4000], 0x1111, 'first pattern word');
  assert.ok(sim.memory[0xF4000 + 48 * 16 - 1] !== 0xFFFF,
            'last colour-demo pattern word written (groups 3..7 hold the bird)');

  // Three OAM slots, all enabled (bit 10 of w1) and in group 0..2.
  for (let i = 0; i < 3; i++) {
    assert.equal(sim.memory[0xF5000 + i * 2] & 0x3FF, [40, 112, 184][i],
                 `sprite ${i} x`);
    assert.equal((sim.memory[0xF5000 + i * 2] >> 10) & 7, i, `sprite ${i} group`);
    assert.equal(sim.memory[0xF5001 + i * 2] & 0x0400, 0x0400, `sprite ${i} enabled`);
    // The first animation frame has already run: y = 170 + wave[2*i].
    const wave = [0, 4, 8, 12, 16, 20, 24, 28, 31, 28, 24, 20, 16, 12, 8, 4];
    assert.equal(sim.memory[0xF5001 + i * 2] & 0x3FF, 170 + wave[(2 * i) & 15],
                 `sprite ${i} y`);
  }

  // Tilemap: '#' at (row+col)%8==0, spaces elsewhere.
  assert.equal(sim.memory[0xF1000], 0x0060, 'cell 0 hash');
  assert.equal(sim.memory[0xF1001], 0x0000, 'cell 1 space');
  assert.equal(sim.memory[0xF1000 + 82], 0x0000, 'row 1 col 0 blank');
  assert.equal(sim.memory[0xF1000 + 82 + 7], 0x0060, 'row 1 col 7 hash');
  assert.equal(sim.memory[0xF1000 + 82 + 1], 0x0000, 'row 1 col 1 blank');

  // Scroll registers were written during the frame (phase 0 writes 0).
  assert.equal(sim.memory[0xF2004], 0, 'scroll_x');
  assert.equal(sim.memory[0xF2006], 0, 'scroll_y');
});
