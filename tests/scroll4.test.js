// Four-direction FiT camera: helper correctness and the measured CPU cost.
//
// scroll4.asm is a self-contained demo. BENCH_TEST performs one left+up shift
// with markers; BENCH runs eight left+up shifts without waiting for frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, runJs, runRtl, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const SOURCE = fs.readFileSync(path.join(ROOT, 'asm', 'demos', 'scroll4.asm'), 'utf8');
const TILEMAP = 0xF1000;

test('scroll4 demo assembles in all three modes', () => {
  for (const defines of [{}, { BENCH: 1 }, { BENCH_TEST: 1 }]) {
    const res = assemble(SOURCE, { defines });
    assert.equal(res.success, true, res.errors.join('; '));
    assert.ok(res.memoryChanges.length > 0);
  }
});

test('the ring helpers move a cell and fill both margins', () => {
  const res = assemble(SOURCE, { defines: { BENCH_TEST: 1 } });
  const { sim, memory } = runJs(res, { maxSteps: 200000 });
  assert.equal(sim.running, false, 'BENCH_TEST must halt');

  // Left shift: row 1 column 1 (0x2222) moves to row 1 column 0, then the up
  // shift moves that row-1 cell (the old 0x0444) to row 0 column 0.
  assert.equal(memory[TILEMAP + 0] & 0xFFFF, 0x0444);
  assert.equal(memory[TILEMAP + 81] & 0xFFFF, 0x8060, 'new right margin');
  assert.equal(memory[TILEMAP + 2050] & 0xFFFF, 0x8060, 'new bottom row');
  assert.equal(memory[TILEMAP + 2131] & 0xFFFF, 0x8060, 'bottom-right corner');
});

test('the helper cost is measured on the JS and RTL cores', async () => {
  const res = assemble(SOURCE, { defines: { BENCH: 1 } });
  const js = runJs(res, { maxSteps: 500000 });
  assert.equal(js.sim.running, false, 'BENCH must halt');

  const rtl = await runRtl(res, { maxSteps: 500000 });
  assert.ok(rtl.instrCount() > 0);
  assert.ok(rtl.cycleCount() >= rtl.instrCount());

  const pairs = 8;
  const instrPerPair = js.steps / pairs;
  const cyclesPerPair = rtl.cycleCount() / pairs;
  console.log(`scroll4: ${js.steps} instructions for ${pairs} left+up pairs`);
  console.log(`scroll4: ${instrPerPair.toFixed(0)} instructions/pair, ` +
              `${cyclesPerPair.toFixed(0)} RTL cycles/pair ` +
              `(CPI ${(rtl.cycleCount() / rtl.instrCount()).toFixed(2)})`);
  assert.ok(js.steps < 500000, `helper grew unexpectedly: ${js.steps} instructions`);
});
