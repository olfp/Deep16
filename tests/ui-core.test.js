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
// The file upload on the Screen tab (js/deep16_ui_core.js). The browser picks an
// ASCII file and types it into the machine: every character becomes a keystroke,
// every line ending a Return. Nothing else happens - the kernel sees the same
// key sequence a person typing the file would produce.
//
// The typing is paced by the keyboard queue level, because the RTL core has a
// 128 entry FIFO and drops a keystroke that arrives while it is full. A pump
// that ignored that would lose the middle of a file on that core and nowhere
// else - the worst kind of bug. Here it runs against the real Forth kernel on
// the JS core, with the 200-steps-then-pump cadence the run loops use.
// ---------------------------------------------------------------------------

const KERNEL = fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8');

// Boot the kernel and type `file` into it through the real pump.
function typeThroughPump(file, { stepsPerTick = 200, maxSteps = 2000000, run = true } = {}) {
  const res = assemble(KERNEL);
  assert.ok(res.success, res.errors.join('; '));
  const ui = makeUi();
  const mem = new Array(1048576).fill(0xFFFF);
  for (const c of res.memoryChanges) mem[c.address] = c.value & 0xFFFF;
  ui.simulator.loadProgram(mem);
  ui.simulator.segmentRegisters.CS = 0xFFFF;
  // queueFileUpload needs a FileReader; the state it would build is set here
  // directly, which is the only part the test does not exercise.
  ui.fileUpload = { name: 'test.fs', keys: ui.fileToKeys(file), pos: 0, done: false, stalled: false };

  ui.simulator.running = run;
  for (let i = 0; i < maxSteps && ui.simulator.running; i++) {
    ui.simulator.step();
    if ((i + 1) % stepsPerTick === 0) ui.pumpKeyQueue();
  }
  const rows = [];
  for (let r = 0; r < 25; r++) {
    let s = '';
    for (let c = 0; c < 80; c++) s += String.fromCharCode(ui.simulator.memory[0xF1000 + r * 80 + c] & 0xFF);
    rows.push(s.replace(/\s+$/, ''));
  }
  return { ui, rows, transcript: ui.transcript };
}

test('an uploaded file is typed into the kernel and its definitions work', () => {
  // The whole point: a file goes in as if typed, and what it defines is callable.
  const { ui, rows } = typeThroughPump(': foo 41 ;\n42 foo + .\n');
  assert.equal(rows[0], 'Hello DeepForth!');
  assert.equal(rows[1], '> : foo 41 ; ok', `screen was:\n${rows.join('\n')}`);
  assert.equal(rows[2], '> 42 foo + . 83  ok', `screen was:\n${rows.join('\n')}`);
  assert.equal(ui.fileUpload.done, true, 'the pump must mark the file as fully typed');
  assert.equal(ui.simulator.kbdAvailable(), 0, 'nothing may be left in the queue');
});

test('every line ending in the file becomes a Return', () => {
  const ui = makeUi();
  // LF, CRLF and CR all end a line: the browser gives CRLF for a file written
  // on Windows, LF for one written anywhere else, and a bare CR shows up in
  // files moved from a classic Mac.
  assert.deepEqual(ui.fileToKeys('a\nb'), [97, 13, 98, 13]);
  assert.deepEqual(ui.fileToKeys('a\r\nb'), [97, 13, 98, 13]);
  assert.deepEqual(ui.fileToKeys('a\rb'), [97, 13, 98, 13]);
  // The Return is what executes a line, so the last one always gets one -
  // without it the final definition would sit unread at the prompt.
  assert.deepEqual(ui.fileToKeys('a\n'), [97, 13]);
  assert.deepEqual(ui.fileToKeys('a'), [97, 13]);
  // Blank lines inside the file are kept - a person typing it would press
  // Return on them too.
  assert.deepEqual(ui.fileToKeys('a\n\nb'), [97, 13, 13, 98, 13]);
});

test('an uploaded file is typed far past the RTL keyboard FIFO', () => {
  // 40 definitions is well over the 128 character keyboard FIFO, the case that
  // makes the queue-level pacing load-bearing.
  const lines = [];
  for (let i = 0; i < 40; i++) lines.push(`: w${i} ${i} ;`);
  lines.push('w7 .');
  const file = lines.join('\n');
  assert.ok(file.length > DeepWebUI.KBD_FIFO_DEPTH, 'the file has to outgrow the FIFO');
  const { rows } = typeThroughPump(file);
  // 41 lines do not fit on a 25 row screen, so this is looked up by content
  // rather than by row number: the screen has scrolled by then.
  assert.equal(rows.find((r) => r.includes('w7 .')), '> w7 . 7  ok',
               `screen was:\n${rows.join('\n')}`);
  // The REPL is idle again afterwards: the last prompt is a bare one, which is
  // what proves the final line was executed rather than left at the prompt.
  const prompts = rows.filter((r) => r.startsWith('>'));
  assert.equal(prompts[prompts.length - 1], '>', 'the REPL must come back after the file');
  // Nothing of the beginning may be left over: every line was interpreted, not
  // just the last.
  assert.ok(!rows.some((r) => r.includes('undefined word')),
            `a line did not make it through:\n${rows.join('\n')}`);
});

test('the typing pump paces itself and says so when the queue is full', () => {
  const ui = makeUi();
  ui.fileUpload = { name: 'test.fs', keys: new Array(500).fill(120), pos: 0, done: false, stalled: false };
  // Nothing runs, so nothing consumes: the pump may fill the queue and no more.
  const first = ui.pumpKeyQueue();
  assert.equal(first, DeepWebUI.KBD_CHUNK);
  assert.equal(ui.simulator.kbdAvailable(), DeepWebUI.KBD_CHUNK);
  let total = first;
  for (let i = 0; i < 20; i++) total += ui.pumpKeyQueue();
  assert.equal(total, DeepWebUI.KBD_FIFO_DEPTH, 'the queue may hold exactly one FIFO worth');
  assert.equal(ui.pumpKeyQueue(), 0, 'a full queue accepts nothing');
  assert.equal(ui.fileUpload.stalled, true, 'the pump must notice that it is blocked');
  assert.ok(ui.transcript.some((t) => /queue is full/.test(t)), `transcript was:\n${ui.transcript.join('\n')}`);
  assert.equal(ui.fileUpload.done, false, 'a file that is not fully typed is not done');
});

test('an unknown queue level makes the pump type one character at a time', () => {
  // A core that cannot report its level must not be flooded: one character per
  // call is the only rate that cannot overflow an unseen FIFO.
  const ui = makeUi();
  ui.fileUpload = { name: 'test.fs', keys: new Array(10).fill(120), pos: 0, done: false, stalled: false };
  ui.kbdAvailable = () => NaN;
  assert.equal(ui.pumpKeyQueue(), 1);
  assert.equal(ui.pumpKeyQueue(), 1);
  assert.equal(ui.fileUpload.pos, 2);
});

test('cancelling an upload drops the file and clears the queue', () => {
  const ui = makeUi();
  ui.fileUpload = { name: 'test.fs', keys: [97, 98, 99], pos: 0, done: false, stalled: false };
  ui.pumpKeyQueue();
  assert.equal(ui.simulator.kbdAvailable(), 3);
  ui.cancelFileUpload('test');
  assert.equal(ui.fileUpload, null);
  assert.equal(ui.simulator.kbdAvailable(), 0, 'the queue must be empty after a cancel');
  assert.equal(ui.pumpKeyQueue(), 0, 'a cancelled upload has nothing left to type');
});

test('a reset cancels an upload that is still running', () => {
  const ui = makeUi();
  ui.runInterval = null;
  // reset() reaches into the DOM for the address field, scrolls the memory panel
  // from a timer and restarts the machine; stub all of it so the upload can be
  // checked on its own.
  ui.memoryUI = { scrollToPC() {} };
  ui.fileUpload = { name: 'test.fs', keys: [97, 98, 99], pos: 0, done: false, stalled: false };
  ui.pumpKeyQueue();
  ui.updateRunButton = () => {};
  ui.updateAllDisplays = () => {};
  ui.ensurePCCentered = () => {};
  ui.switchTab = () => {};
  ui.run = () => {};
  ui.reset();
  assert.equal(ui.fileUpload, null, 'a half-typed file must be dropped, not resumed');
  assert.equal(ui.simulator.kbdAvailable(), 0);
  assert.ok(ui.transcript.some((t) => /cancelled \(machine reset\)/.test(t)),
            `transcript was:\n${ui.transcript.join('\n')}`);
});

test('switching the core cancels an upload that is still running', () => {
  const ui = makeUi();
  ui.fileUpload = { name: 'test.fs', keys: [97, 98, 99], pos: 0, done: false, stalled: false };
  ui.pumpKeyQueue();
  // setCore('js') from 'js' is a no-op, so go via the RTL stub the tests use.
  ui.rtlAvailable = true;
  globalThis.window.Deep16Rtl = { set_registers() {}, set_psw() {}, set_segments() {},
                                  init() {}, load_program() {}, kbd_clear() {} };
  try {
    assert.equal(ui.setCore('rtl', { mirror: false }), true);
    assert.equal(ui.fileUpload, null, 'the new core has an empty queue, so the file is dropped');
    assert.ok(ui.transcript.some((t) => /cancelled \(core changed\)/.test(t)),
              `transcript was:\n${ui.transcript.join('\n')}`);
  } finally {
    globalThis.window.Deep16Rtl = undefined;
  }
});
// ---------------------------------------------------------------------------
// On a phone the memory panel header is not what anyone looks at: Run, Step,
// Reset and the view toggle are MOVED into the header groups by
// initializeMobileControls(). A control left behind there is invisible on mobile.
// These tests drive the real functions against a small DOM model and check
// where the button ends up, rather than grepping for its id: grepping passed
// happily while the button was never moved.
// ---------------------------------------------------------------------------

// A node with just enough of the DOM API for the two layout functions.
function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    style: {},
    children: [],
    parentElement: null,
    offsetWidth: 50,
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) {
      if (child.parentElement) child.parentElement.removeChild(child);
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, ref) {
      if (child.parentElement) child.parentElement.removeChild(child);
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
      child.parentElement = this;
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentElement = null;
      return child;
    },
    querySelector: () => null,
  };
  return el;
}

// The header as index.html has it: the buttons live in the memory panel header,
// the file input beside them, and the Kern/Docs block in the header.
function mobileDom() {
  const panelControls = makeEl();
  panelControls.className = 'memory-panel-controls';
  const headerContent = makeEl();
  headerContent.className = 'header-content';
  const rightControls = makeEl();
  rightControls.className = 'header-right-controls';
  headerContent.appendChild(rightControls);

  const ids = {};
  for (const name of ['run-btn', 'step-btn', 'reset-btn', 'view-toggle']) {
    const btn = makeEl('button');
    btn.id = name;
    btn.textContent = name;
    ids[name] = btn;
    panelControls.appendChild(btn);
  }
  // The Docs button lives in the header controls, not in the memory panel - the
  // mobile layout moves that whole block as one.
  const docsBtn = makeEl('button');
  docsBtn.id = 'docs-menu-btn';
  ids['docs-menu-btn'] = docsBtn;
  rightControls.appendChild(docsBtn);
  const indicator = makeEl('span');
  indicator.id = 'run-state-indicator';
  ids['run-state-indicator'] = indicator;
  panelControls.appendChild(indicator);
  const mobileCtrls = makeEl();
  mobileCtrls.id = 'mobile-controls';
  ids['mobile-controls'] = mobileCtrls;

  return { panelControls, headerContent, rightControls, mobileCtrls, ids };
}

// Run the two functions against the model, with the globals they reach for
// swapped in and put back afterwards.
function withMobileDom(fn) {
  const dom = mobileDom();
  const prevDoc = globalThis.document;
  const prevMatch = globalThis.window.matchMedia;
  globalThis.document = {
    getElementById: (id) => dom.ids[id] || null,
    createElement: (tag) => makeEl(tag),
    querySelector: (sel) => (sel === '.header-content' ? dom.headerContent
                           : sel === '.header-right-controls' ? dom.rightControls : null),
    // the button width is published as a custom property on :root
    documentElement: { style: { setProperty() {} } },
  };
  globalThis.window.matchMedia = () => ({ matches: false });
  try {
    return fn(dom, makeUi());
  } finally {
    globalThis.document = prevDoc;
    globalThis.window.matchMedia = prevMatch;
  }
}

test('every button in the memory panel header reaches the mobile layout', () => {
  withMobileDom((dom, ui) => {
    ui.initializeMobileControls();
    assert.equal(dom.mobileCtrls.children.length, 3, 'the mobile layout builds three groups');
    const moved = dom.mobileCtrls.children.flatMap((g) => g.children);
    for (const name of ['run-btn', 'step-btn', 'reset-btn', 'view-toggle']) {
      assert.ok(moved.includes(dom.ids[name]),
                `${name} is left behind in the memory panel - unreachable on a phone`);
      assert.equal(dom.ids[name].parentElement.parentElement, dom.mobileCtrls,
                   `${name} did not end up in a mobile group`);
    }
  });
});

test('the mobile layout hands every control back to the desktop header', () => {
  withMobileDom((dom, ui) => {
    ui.initializeMobileControls();
    ui.restoreDesktopLayout();
    for (const name of ['run-btn', 'step-btn', 'reset-btn', 'view-toggle']) {
      assert.equal(dom.ids[name].parentElement, dom.panelControls,
                   `${name} was not moved back`);
    }
    assert.equal(dom.rightControls.parentElement, dom.headerContent);
    assert.equal(dom.ids['run-state-indicator'].parentElement, dom.panelControls);
  });
});

test('the controls keep their order after the round trip through mobile', () => {
  withMobileDom((dom, ui) => {
    const before = dom.panelControls.children.map((c) => c.id);
    ui.initializeMobileControls();
    ui.restoreDesktopLayout();
    assert.deepEqual(dom.panelControls.children.map((c) => c.id), before,
                     'the desktop order must survive a resize round trip');
  });
});