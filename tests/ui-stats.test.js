// The live counter line of the IDE (js/deep16_ui_core.js), driven against the
// real RTL glue: a stub DOM element captures what would be rendered, and every
// number is checked against the core's own getters - so a renamed getter or a
// wrong divisor shows up here instead of as plausible-looking zeros.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { assemble, loadBrowserScripts, loadRtl, ROOT } from '/home/ubuntu/Deep16/tests/helpers.js';

const captured = { text: '', title: '' };
globalThis.document = {
  addEventListener() {},
  getElementById: (id) => (id === 'core-stats'
    ? { set textContent(v) { captured.text = v; }, set title(v) { captured.title = v; },
        get textContent() { return captured.text; } }
    : null),
  createElement: () => ({ style: {}, appendChild() {}, classList: { add() {} } }),
};
globalThis.window = globalThis.window || {};
loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'deep16_ui_core.js'), 'utf8'),
                    { filename: 'deep16_ui_core.js' });
const DeepWebUI = vm.runInThisContext('DeepWebUI');
const Sim = vm.runInThisContext('Deep16Simulator');

test('the stats line reports only counters the active core really exports', async () => {
  const rtl = await loadRtl();
  globalThis.window.Deep16Rtl = rtl;

  const ui = Object.create(DeepWebUI.prototype);
  ui.simulator = new Sim();
  ui.coreName = 'js'; ui.useWasm = false;
  ui.wasmAvailable = false; ui.rtlAvailable = false;
  ui.wasmInitialized = false; ui.rtlInitialized = false;
  ui.wasmDirtyStart = null; ui.wasmDirtyEnd = null;
  ui.addTranscriptEntry = () => {};

  // The JS core has neither a pipeline nor a cache. It must say so rather than
  // render zeros, which would read like a cache that never hits.
  ui.updateCoreStats();
  assert.match(captured.text, /keine Zaehler/, `JS core rendered ${captured.text}`);

  const res = assemble(`
        .org 0x0100
        LDI 0x1234
        MOV R2, R0, 0
        ADD R2, R2
        ADD R2, R2
        HALT
  `);
  assert.ok(res.success, res.errors.join('; '));

  // Seed the RTL core directly rather than mirroring the whole 1M-word JS
  // memory: this is about the formatting, and the 2 MB transfer is a separate
  // concern (setCore -> syncStateIntoCore, covered in ui-core.test.js).
  rtl.init(1048576);
  for (const c of res.memoryChanges) rtl.load_program(c.address, new Uint16Array([c.value & 0xFFFF]));
  rtl.set_segments(0, 0, 0, 0);
  rtl.set_debug_state(0x0F, 0x0100);
  ui.coreName = 'rtl'; ui.useWasm = true; ui.rtlInitialized = true;
  for (let i = 0; i < 5; i++) rtl.step();
  ui.updateCoreStats();

  const instr = rtl.get_instr_count();
  const cycles = rtl.get_cycle_count();
  const hits = rtl.get_cache_hits();
  const misses = rtl.get_cache_misses();
  console.log('      rendered: ' + captured.text);
  console.log('      core    : instr=' + instr + ' cycles=' + cycles +
              ' hits=' + hits + ' misses=' + misses);

  assert.match(captured.text, /RTL/, 'the core name is missing');
  assert.ok(captured.text.includes(String(instr)), 'instruction count missing');
  assert.ok(captured.text.includes(String(cycles)), 'cycle count missing');
  // CPI is cycles per *retired instruction*, not per step: the final halt step
  // retires nothing and would drag the average down.
  assert.ok(captured.text.includes('CPI ' + (cycles / instr).toFixed(2)),
            `CPI ${(cycles / instr).toFixed(2)} missing from ${captured.text}`);
  assert.match(captured.text, /Cache/, 'the cache field is missing');
  if (hits + misses > 0) {
    assert.ok(captured.text.includes((100 * hits / (hits + misses)).toFixed(1) + '%'),
              'the hit rate does not match the getters');
  }
  assert.match(captured.title, /Cache/, 'the tooltip does not explain the counters');
});
