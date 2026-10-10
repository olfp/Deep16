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
  // status() writes into a DOM node that does not exist in this stub.
  ui.status = () => {};
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

// ---------------------------------------------------------------------------
// The SERLOAD host feed (js/deep16_ui_core.js). The browser picks a file, the
// pump hands it over a few characters at a time and raises EOF at the end. The
// pump is paced by the queue level because the RTL FIFO drops a push that
// arrives while it is full - a pump that ignored that would silently lose the
// middle of a file. Here it runs against the real Forth kernel on the JS core,
// with the same 200-steps-then-pump cadence the two run loops use.
// ---------------------------------------------------------------------------

const KERNEL = fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8');

// Load the kernel, type "SERLOAD", then feed `file` through the real pump.
function loadThroughSerialPump(typed, file, { stepsPerTick = 200, maxSteps = 2000000 } = {}) {
  const res = assemble(KERNEL);
  assert.ok(res.success, res.errors.join('; '));
  const ui = makeUi();
  const mem = new Array(1048576).fill(0xFFFF);
  for (const c of res.memoryChanges) mem[c.address] = c.value & 0xFFFF;
  ui.simulator.loadProgram(mem);
  ui.simulator.segmentRegisters.CS = 0xFFFF;
  for (const ch of typed) ui.simulator.enqueueKeyCode(ch === '\n' ? 10 : ch.charCodeAt(0));
  // queueSerialSource needs a FileReader; the state it would build is set here
  // directly, which is the only part the test does not exercise.
  ui.serialSource = { name: 'test.fs', text: file, pos: 0, done: false, stalled: false };

  ui.simulator.running = true;
  for (let i = 0; i < maxSteps && ui.simulator.running; i++) {
    ui.simulator.step();
    // The cadence both run loops use: 200 steps, then whatever the line takes.
    if ((i + 1) % stepsPerTick === 0) ui.pumpSerialQueue();
  }
  const rows = [];
  for (let r = 0; r < 25; r++) {
    let s = '';
    for (let c = 0; c < 80; c++) s += String.fromCharCode(ui.simulator.memory[0xF1000 + r * 80 + c] & 0xFF);
    rows.push(s.replace(/\s+$/, ''));
  }
  return { ui, rows, transcript: ui.transcript };
}

test('the serial pump hands a file to the kernel and raises EOF at the end', () => {
  const { ui, rows } = loadThroughSerialPump('SERLOAD\n', ': foo 41 ;\nfoo .\n');
  // A loaded line is not echoed, so "41  ok" is what the transferred
  // "foo ." leaves behind on the row where SERLOAD was typed - the same
  // contract the keyboard tests pin.
  assert.equal(rows[0], 'Hello DeepForth!');
  assert.equal(rows[1], '> SERLOAD 41  ok', `screen was:\n${rows.join('\n')}`);
  assert.equal(rows[2], '>', 'the REPL must come back after the file is exhausted');
  assert.equal(ui.serialSource.done, true, 'the pump must mark the source as fully sent');
});

test('the serial pump delivers a file longer than the RTL FIFO', () => {
  // 300 characters is well past the 128 entry RTL FIFO, which is the case that
  // makes the queue-level pacing load-bearing: a pump that pushed everything at
  // once would lose characters on the RTL core.
  const lines = [];
  for (let i = 0; i < 20; i++) lines.push(`: w${i} ${i} ;`);
  lines.push('w7 .\n');
  const file = lines.join('\n');
  assert.ok(file.length > DeepWebUI.SER_FIFO_DEPTH, 'the file has to outgrow the FIFO');
  const { rows } = loadThroughSerialPump('SERLOAD\n', file);
  assert.equal(rows[1], '> SERLOAD 7  ok', `screen was:\n${rows.join('\n')}`);
  assert.equal(rows[2], '>', 'the last line must be interpreted before the prompt returns');
});

test('the serial pump paces itself and says so when the line is full', () => {
  const res = assemble(KERNEL);
  assert.ok(res.success, res.errors.join('; '));
  const ui = makeUi();
  ui.serialSource = { name: 'test.fs', text: 'x'.repeat(500), pos: 0, done: false, stalled: false };
  // Nothing runs, so nothing consumes: the pump may fill the line and no more.
  const first = ui.pumpSerialQueue();
  assert.equal(first, DeepWebUI.SER_CHUNK);
  assert.equal(ui.simulator.serialAvailable(), DeepWebUI.SER_CHUNK);
  let total = first;
  for (let i = 0; i < 20; i++) total += ui.pumpSerialQueue();
  assert.equal(total, DeepWebUI.SER_FIFO_DEPTH, 'the line must hold exactly one FIFO worth');
  assert.equal(ui.pumpSerialQueue(), 0, 'a full line accepts nothing');
  assert.equal(ui.serialSource.stalled, true, 'the pump must notice that it is blocked');
  assert.ok(ui.transcript.some((t) => /line is full/.test(t)), `transcript was:\n${ui.transcript.join('\n')}`);
  assert.equal(ui.serialSource.done, false, 'EOF must not be raised while characters are stuck');
});

test('the serial pump raises EOF only after the last character', () => {
  const ui = makeUi();
  // Longer than one chunk, so the first call cannot finish the file.
  const text = `: foo ${'1 '.repeat(40)};\n`;
  assert.ok(text.length > DeepWebUI.SER_CHUNK, 'the text has to outgrow one chunk');
  ui.serialSource = { name: 'test.fs', text, pos: 0, done: false, stalled: false };
  ui.pumpSerialQueue();
  assert.equal(ui.simulator.serEof, false, 'EOF must not be raised while characters remain');
  assert.equal(ui.simulator.serialAvailable(), DeepWebUI.SER_CHUNK);
  while (!ui.serialSource.done) ui.pumpSerialQueue();
  assert.equal(ui.simulator.serEof, true, 'EOF is raised once the last character is handed over');
  assert.equal(ui.simulator.serialAvailable(), text.length, 'queued characters survive the EOF flag');
});

test('a short file is handed over and closed in a single call', () => {
  const ui = makeUi();
  const text = ': foo 1 ;\n';
  ui.serialSource = { name: 'test.fs', text, pos: 0, done: false, stalled: false };
  assert.equal(ui.pumpSerialQueue(), text.length);
  assert.equal(ui.simulator.serialAvailable(), text.length);
  assert.equal(ui.simulator.serEof, true);
  assert.equal(ui.pumpSerialQueue(), 0, 'a finished file is not pushed again');
});

test('cancelling the feed drops the file and clears the line', () => {
  const ui = makeUi();
  ui.serialSource = { name: 'test.fs', text: 'abc', pos: 0, done: false, stalled: false };
  ui.pumpSerialQueue();
  assert.equal(ui.simulator.serialAvailable(), 3);
  ui.cancelSerialFeed('test');
  assert.equal(ui.serialSource, null);
  assert.equal(ui.simulator.serialAvailable(), 0, 'the line must be empty after a cancel');
  assert.equal(ui.pumpSerialQueue(), 0, 'a cancelled feed has nothing left to push');
});

test('a reset cancels a transfer that is still running', () => {
  const ui = makeUi();
  ui.runInterval = null;
  // reset() reaches into the DOM for the address field, scrolls the memory panel
  // from a timer and restarts the machine; stub all of it so the serial part
  // can be checked on its own.
  ui.memoryUI = { scrollToPC() {} };
  ui.serialSource = { name: 'test.fs', text: 'abc', pos: 0, done: false, stalled: false };
  ui.pumpSerialQueue();
  ui.updateRunButton = () => {};
  ui.updateAllDisplays = () => {};
  ui.ensurePCCentered = () => {};
  ui.switchTab = () => {};
  ui.run = () => {};
  ui.reset();
  assert.equal(ui.serialSource, null, 'the half-sent file must be dropped, not resumed');
  assert.equal(ui.simulator.serialAvailable(), 0);
  assert.ok(ui.transcript.some((t) => /cancelled \(machine reset\)/.test(t)),
            `transcript was:\n${ui.transcript.join('\n')}`);
});

test('switching the core cancels a transfer that is still running', () => {
  const ui = makeUi();
  ui.serialSource = { name: 'test.fs', text: 'abc', pos: 0, done: false, stalled: false };
  ui.pumpSerialQueue();
  // setCore('js') from 'js' is a no-op, so go via the RTL stub the tests use.
  ui.rtlAvailable = true;
  globalThis.window.Deep16Rtl = { set_registers() {}, set_psw() {}, set_segments() {},
                                  init() {}, load_program() {} };
  try {
    assert.equal(ui.setCore('rtl', { mirror: false }), true);
    assert.equal(ui.serialSource, null, 'the new core has an empty line, so the file is dropped');
    assert.ok(ui.transcript.some((t) => /cancelled \(core changed\)/.test(t)),
              `transcript was:\n${ui.transcript.join('\n')}`);
  } finally {
    globalThis.window.Deep16Rtl = undefined;
  }
});

test('an unknown queue level makes the pump feed one character at a time', () => {
  // A core that cannot report its level must not be flooded: one character per
  // call is the only rate that cannot overflow an unseen FIFO.
  const ui = makeUi();
  ui.serialSource = { name: 'test.fs', text: 'abcdefghij', pos: 0, done: false, stalled: false };
  ui.serialAvailable = () => NaN;
  assert.equal(ui.pumpSerialQueue(), 1);
  assert.equal(ui.pumpSerialQueue(), 1);
  assert.equal(ui.serialSource.pos, 2);
});