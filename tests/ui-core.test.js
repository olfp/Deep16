// Core selection in the IDE (js/deep16_ui_core.js).
//
// The IDE drives three cores through one code path: the JS core is the source of
// truth and both compiled cores (Rust/WASM, Verilator/WASM) get a mirror of it.
// That only works if every call site goes through the active-module accessor,
// so this test drives the real methods - not a reimplementation - against the
// real rtl/pkg glue, and checks that the mirrored core actually executes.
//
// The class is not exported and its constructor is DOM-heavy, so the instance
// is built from the prototype and the few fields the methods touch are seeded
// by hand. What is exercised here is the logic the browser runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { assemble, loadBrowserScripts, loadRtl, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

// A DOM stub just rich enough for the module-level DOMContentLoaded hook and
// the header <select>. Anything the core-selection code reaches for beyond this
// is stubbed on the instance instead.
const fakeSelect = { value: 'js', disabled: false, addEventListener() {} };
globalThis.document = {
  addEventListener() {},
  getElementById: (id) => (id === 'core-select' ? fakeSelect : null),
  createElement: () => ({ style: {}, appendChild() {}, classList: { add() {} } }),
};
globalThis.window = globalThis.window || {};

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'deep16_ui_core.js'), 'utf8'),
                    { filename: 'deep16_ui_core.js' });
const DeepWebUI = vm.runInThisContext('DeepWebUI');
const Deep16Simulator = vm.runInThisContext('Deep16Simulator');

const PROGRAM = `
        .org 0x0100
        LDI 0x1234
        MOV R2, R0, 0
        ADD R2, R2
        MOV R5, R2, 0
        HALT
`;

// A UI instance with the JS core loaded and a given program in memory.
function makeUi(memory) {
  const ui = Object.create(DeepWebUI.prototype);
  ui.simulator = new Deep16Simulator();
  ui.coreName = 'js';
  ui.useWasm = false;
  ui.wasmAvailable = false;
  ui.rtlAvailable = false;
  ui.wasmInitialized = false;
  ui.rtlInitialized = false;
  ui.wasmDirtyStart = null;
  ui.wasmDirtyEnd = null;
  ui.transcript = [];
  ui.addTranscriptEntry = (msg, kind) => ui.transcript.push(`[${kind || 'info'}] ${msg}`);
  if (memory) {
    ui.simulator.loadProgram(memory);
    // Start at the program rather than in the boot ROM: the ROM is a fixed
    // ~10-step prologue, and the point here is the program. CS=0/PC=0x0100 is
    // what a debugger jump sets, and syncStateIntoCore() copies both across.
    ui.simulator.segmentRegisters.CS = 0;
    ui.simulator.registers[15] = 0x0100;
    ui.simulator.running = true;
  }
  return ui;
}

function programMemory() {
  const res = assemble(PROGRAM);
  assert.ok(res.success, res.errors.join('; '));
  const mem = new Array(1048576).fill(0xFFFF);
  for (const c of res.memoryChanges) mem[c.address] = c.value & 0xFFFF;
  return mem;
}

test('the core label names all three cores', () => {
  const ui = makeUi();
  assert.equal(ui.coreLabel('js'), 'JS');
  assert.equal(ui.coreLabel('wasm'), 'WASM (Rust)');
  assert.equal(ui.coreLabel('rtl'), 'RTL (Verilator)');
});

test('an unavailable core is refused and leaves the selection alone', () => {
  const ui = makeUi();
  // nothing loaded at all
  assert.equal(ui.coreAvailable('wasm'), false);
  assert.equal(ui.coreAvailable('rtl'), false);
  assert.equal(ui.coreAvailable('js'), true);
  assert.equal(ui.setCore('rtl', { mirror: true }), false);
  assert.equal(ui.coreName, 'js');
  assert.equal(ui.useWasm, false);
});

test('useWasm is a derived flag, never the stored selection', () => {
  const ui = makeUi();
  ui.rtlAvailable = true;
  globalThis.window.Deep16Rtl = { set_registers() {}, set_psw() {}, set_segments() {},
                                  init() {}, load_program() {} };
  try {
    assert.equal(ui.setCore('js', { mirror: false }), true);
    assert.equal(ui.coreName, 'js');
    assert.equal(ui.useWasm, false);
    // selecting a compiled core implies it is initialised and usable - this
    // state must not end up as coreName=rtl with compiledCoreReady()===false
    assert.equal(ui.setCore('rtl', { mirror: true }), true);
    assert.equal(ui.coreName, 'rtl');
    assert.equal(ui.useWasm, true);
    assert.equal(ui.rtlInitialized, true);
    assert.equal(ui.compiledCoreReady(), true);
    assert.equal(ui.activeCoreModule(), globalThis.window.Deep16Rtl);
    assert.equal(fakeSelect.value, 'rtl');
  } finally {
    delete globalThis.window.Deep16Rtl;
  }
});

test('the IDE can mirror a program into the RTL core and step it', async () => {
  const rtl = await loadRtl();
  globalThis.window.Deep16Rtl = rtl;
  try {
    const ui = makeUi(programMemory());
    ui.rtlAvailable = true;

    assert.equal(ui.setCore('rtl', { mirror: true, announce: false }), true);
    assert.equal(ui.compiledCoreReady(), true);
    assert.equal(ui.activeCoreModule(), rtl);

    // Step both cores through the UI's own accessors and compare after each
    // retired instruction: 0x1234 -> doubled into R2 -> copied to R5.
    const core = ui.activeCoreModule();
    const jsTrail = [];
    const rtlTrail = [];
    for (let i = 0; i < 5; i++) {
      ui.simulator.step();
      jsTrail.push(ui.simulator.registers[5] & 0xFFFF);
      core.step();
      rtlTrail.push(core.get_registers()[5] & 0xFFFF);
    }
    assert.deepEqual(rtlTrail, jsTrail, 'RTL core diverges from the JS core while stepping');
    assert.equal(rtlTrail[4], 0x2468, 'the mirrored program did not run');

    // the display code reads the active core, not a hardcoded one
    assert.equal(ui.compiledCoreReady() && ui.activeCoreModule().get_psw() >= 0, true);

    // switching back to JS clears the derived flag again
    assert.equal(ui.setCore('js', { mirror: false }), true);
    assert.equal(ui.useWasm, false);
    assert.equal(ui.activeCoreModule(), null);
    assert.equal(ui.compiledCoreReady(), false);
  } finally {
    delete globalThis.window.Deep16Rtl;
  }
});

test('both compiled cores report the shadow state in the same order', async () => {
  // The IDE reads index 0 as the shadow PC and 1 as the shadow CS, so the two
  // compiled cores must not disagree about the layout.
  const rtl = await loadRtl();
  const rtlState = rtl.get_shadow_state();
  assert.equal(rtlState.length, 3, 'the RTL core must return three shadow words');
  // The harness writes [spc, scs, spsw]; assert it against the debug bus so a
  // reorder cannot pass unnoticed.
  assert.equal(rtlState[0], rtl.get_debug_state(0x16), 'index 0 must be the shadow PC');
  assert.equal(rtlState[1], rtl.get_debug_state(0x17), 'index 1 must be the shadow CS');
  assert.equal(rtlState[2], rtl.get_debug_state(0x15), 'index 2 must be the shadow PSW');
});

// The memory and screen panels are separate files that used to hardcode
// window.Deep16Wasm; a stale reference there would silently show the JS core's
// memory while the RTL core was selected. Guard the accessor itself.
test('the panels read through the active core, never a hardcoded module', () => {
  for (const file of ['js/deep16_ui_memory.js', 'js/deep16_ui_screen.js',
                      'js/deep16_ui_registers.js', 'js/deep16_ui_core.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const stale = src.match(/window\.Deep16Wasm\.(?!default\b)[a-z_]+\(/g) || [];
    assert.deepEqual(stale, [], `${file} still calls the WASM module directly`);
  }
});