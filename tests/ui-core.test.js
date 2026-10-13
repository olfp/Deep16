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
// The screen subsystem lives in its own file; the column-pager tests drive it
// directly, so it has to be in scope here.
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'deep16_ui_screen.js'), 'utf8'),
                    { filename: 'deep16_ui_screen.js' });
const DeepWebUI = vm.runInThisContext('DeepWebUI');
const Deep16Simulator = vm.runInThisContext('Deep16Simulator');
const Deep16ScreenUI = vm.runInThisContext('Deep16ScreenUI');
assert.ok(Deep16ScreenUI, 'deep16_ui_screen.js must define Deep16ScreenUI');

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
// Holding the memory panel still while a file loads.
//
// The panel is held still by a guard inside the three functions that draw it,
// not at the call sites. Guarding the callers was tried first and did not work:
// jsRun follows the PC when it jumps and calls renderMemoryDisplay() from
// there, on its own, so the panel kept redrawing through the whole load - the
// kernel jumps between the dictionary and the screen buffer thousands of times
// while it types a file in. This drives that caller, not updateAllDisplays().
// ---------------------------------------------------------------------------

test('the memory panel does not redraw while a file is being loaded', () => {
  const memSrc = fs.readFileSync(path.join(ROOT, 'js', 'deep16_ui_memory.js'), 'utf8');
  const memoryUI = vm.runInThisContext(memSrc, { filename: 'deep16_ui_memory.js' });
  const Deep16MemoryUI = vm.runInThisContext('Deep16MemoryUI');
  assert.ok(Deep16MemoryUI, 'deep16_ui_memory.js must define Deep16MemoryUI');

  // A stand-in for the memory panel that counts what it is asked to draw.
  const ui = makeUi();
  ui.memoryStartAddress = 0;
  let drawn = 0;
  const panel = Object.create(Deep16MemoryUI.prototype);
  panel.ui = ui;
  panel.renderMemoryDisplay = () => { drawn++; };
  panel.updateMemoryDisplay = Deep16MemoryUI.prototype.updateMemoryDisplay;
  panel.updateRecentMemoryDisplay = Deep16MemoryUI.prototype.updateRecentMemoryDisplay;
  panel.uploadBusy = Deep16MemoryUI.prototype.uploadBusy;

  // A DOM stub standing in for the panel's own element, so updateMemoryDisplay
  // runs its full path and ends at renderMemoryDisplay - which is the counter.
  const host = { innerHTML: '' };
  const savedGet = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => (id === 'memory-display' ? host : null);
  try {
    // Nothing loading: the panel is drawn.
    ui.fileUpload = null;
    assert.equal(panel.uploadBusy(), false, 'nothing loading');
    panel.updateMemoryDisplay();
    assert.equal(drawn, 1, 'with nothing loading the panel is drawn');

    // An upload in flight - queued, not done - is what the run loop sees.
    ui.fileUpload = { name: 'hanoi.fth', keys: [1], pos: 0, done: false, stalled: false };
    assert.equal(panel.uploadBusy(), true, 'an unfinished upload counts as loading');
    panel.updateMemoryDisplay();
    panel.updateRecentMemoryDisplay();
    assert.equal(drawn, 1, 'the memory panel must not be drawn while loading');

    // Finished, not cancelled: done is set and the view is released again.
    ui.fileUpload.done = true;
    assert.equal(panel.uploadBusy(), false, 'a finished upload is not loading');
    panel.updateMemoryDisplay();
    assert.equal(drawn, 2, 'and the panel comes back');
  } finally {
    globalThis.document.getElementById = savedGet;
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
function typeThroughPump(file, { stepsPerTick = 200, maxSteps = 12000000, run = true, echoWrap = false } = {}) {
  const res = assemble(KERNEL);
  assert.ok(res.success, res.errors.join('; '));
  const ui = makeUi();
  const mem = new Array(1048576).fill(0xFFFF);
  for (const c of res.memoryChanges) mem[c.address] = c.value & 0xFFFF;
  ui.simulator.loadProgram(mem);
  ui.simulator.segmentRegisters.CS = 0xFFFF;
  // echoWrap reproduces what queueFileUpload builds: `0 echo`, the file, `1 echo`.
  // Without it the test types plain text and every character is drawn.
  const body = ui.fileToKeys(file);
  const keys = echoWrap
    ? [...ui.fileToKeys('0 echo\n'), ...body, ...ui.fileToKeys('1 echo\n')]
    : body;
  if (echoWrap) ui.echoOn = false;
  // queueFileUpload needs a FileReader; the state it would build is set here
  // directly, which is the only part the test does not exercise.
  ui.fileUpload = { name: 'test.fs', keys, pos: 0, done: false, stalled: false, echoRestore: echoWrap };

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

test('loading hanoi.fth types the file in silently and then draws the board', () => {
  // The whole point of the echo switch, end to end: the file's ten thousand
  // keystrokes go in and nothing is drawn, because the echo is off for the whole
  // of them - including the tail, which is what used to be printed.
  //
  // It used to be printed because the Screen tab counted the upload as finished
  // when the last keystroke was handed to the queue. It runs a chunk ahead of
  // the machine, so at that point the last page of the file was still unread,
  // and the echo was put back on under the machine's feet.
  const src = fs.readFileSync(path.join(ROOT, 'forth', 'hanoi.fth'), 'utf8');
  const { ui, rows } = typeThroughPump(src, { echoWrap: true, maxSteps: 400000000 });
  assert.equal(ui.fileUpload.done, true, 'the whole file must have been typed in');
  assert.equal(ui.simulator.kbdAvailable(), 0, 'and read by the machine');

  // No line of the file may appear on the screen. These are the distinctive
  // ones from the tail that used to be drawn, plus one from the middle.
  for (const needle of ['dup init', 'mv-src set!', 'mv-dst set!', 'mv-tmp set!',
                         'hanoi ;', 'hanoi-demo', 'swap-src-tmp', 'hanoi-solve']) {
    for (const row of rows) {
      assert.equal(row.includes(needle), false,
        `"${needle}" was drawn on the screen; screen was:\n${rows.join('\n')}`);
    }
  }
  // The file really did go in, though: the kernel was asked to define it.
  assert.ok(rows.some(r => r.includes('Hello DeepForth!')), 'the kernel booted');

  // And it is callable, which is what "it loaded" actually means.
  for (const c of 'hanoi-demo') ui.simulator.enqueueKeyCode(c.charCodeAt(0));
  ui.simulator.enqueueKeyCode(13);
  for (let i = 0; i < 20000000 && ui.simulator.running; i++) ui.simulator.step();
  const screen = [];
  for (let r = 0; r < 25; r++) {
    let s = '';
    for (let c = 0; c < 80; c++) s += String.fromCharCode(ui.simulator.memory[0xF1000 + r * 80 + c] & 0xFF);
    screen.push(s);
  }
  const text = screen.join('\n');

  // hanoi-demo draws, it does not print. Five disks stacked on peg C, the two
  // pegs it emptied left as bare poles, and the ground along the bottom row.
  // The three peg columns are 12, 39 and 66 and the disks are on rows 18-22.
  //
  // Rows 0-3 are where the REPL's own ` ok` and prompt land when the word
  // returns, so peg A's pole is not asserted there - the prompt writes over
  // the cell the hardware cursor is sitting in, which is peg A's column.
  // Pegs B and C are far from that and are asserted on every row.
  const PEG = [12, 39, 66];
  assert.equal(screen[23], 'X'.repeat(80),
    `the ground must fill the bottom row; screen was:\n${text}`);
  for (let r = 0; r <= 17; r++) {
    for (const col of [39, 66]) {
      assert.equal(screen[r][col], '|', `pole at column ${col} missing on row ${r}`);
    }
    assert.equal(screen[r].includes('#'), false, `no disk belongs above row 18 (row ${r})`);
  }
  // Rows 18-22 hold the five disks, widest at the bottom, each centred on peg C
  // and covering its own pole. Pegs A and B are empty, so their poles show.
  for (const [row, width] of [[18, 11], [19, 9], [20, 7], [21, 5], [22, 3]]) {
    const line = screen[row];
    const first = line.indexOf('#');
    const last = line.lastIndexOf('#');
    assert.equal(last - first + 1, width, `row ${row} should hold one ${width}-wide disk`);
    assert.equal((first + last) / 2, 66, `the disk on row ${row} is not centred on peg C`);
    assert.equal(line[12], '|', `peg A should be empty on row ${row}`);
    assert.equal(line[39], '|', `peg B should be empty on row ${row}`);
    assert.equal(line[66], '#', `the disk on row ${row} should cover peg C's pole`);
  }
  // Every disk its own colour, and coloured correctly: the character is in the
  // low byte and the foreground in the low nibble of the high byte. Getting
  // that second part wrong would swap the colours for background and leave the
  // board readable but not like this.
  const fg = (row, col) => (ui.simulator.memory[0xF1000 + row * 80 + col] >> 8) & 0x0F;
  assert.ok([fg(18, 66), fg(19, 66), fg(20, 66), fg(21, 66), fg(22, 66)]
    .every(c => c >= 1 && c <= 6), 'every disk must carry one of the six colours');
  assert.equal(new Set([fg(18, 66), fg(19, 66), fg(20, 66), fg(21, 66), fg(22, 66)]).size, 5,
    'the five disks must all be different colours');
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
    // A real classList, so a test can assert on a class the code sets. The
    // stubs used to be no-ops, which would let anything pass.
    classes: new Set(),
    classList: {
      add(name) { el.classes.add(name); },
      remove(name) { el.classes.delete(name); },
      contains(name) { return el.classes.has(name); },
      toggle(name, force) {
        const on = force === undefined ? !el.classes.has(name) : !!force;
        if (on) el.classes.add(name); else el.classes.delete(name);
        return on;
      },
    },
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
// ---------------------------------------------------------------------------
// Whether all 80 columns fit is measured where the screen is, not guessed from
// the viewport. The screen lives in the editor panel and the memory panel beside
// it can be dragged down far enough to clip 640 px on a desktop that is itself
// wide - a media query would call that "room enough" and cut the text off with
// no way to reach it.
// ---------------------------------------------------------------------------

// A tab element whose layout width the test can set.
function screenDom(width) {
  // The inner .screen-tab is what gets measured - it carries the padding and
  // the overflow that clip the screen.
  const inner = makeEl();
  inner.className = 'screen-tab';
  inner.clientWidth = width;
  const tab = makeEl();
  tab.id = 'screen-tab';
  tab.clientWidth = width;          // the outer wrapper, wider by the padding
  const display = makeEl();
  display.id = 'screen-display';
  inner.appendChild(display);
  tab.appendChild(inner);
  const ids = { 'screen-tab': tab, 'screen-display': display };
  for (const n of ['screen-page-prev', 'screen-page-next']) {
    const b = makeEl('button');
    b.id = n;
    ids[n] = b;
  }
  const label = makeEl('span');
  label.id = 'screen-page-label';
  ids['screen-page-label'] = label;
  return { tab, inner, display, ids };
}

// A screen UI instance with the layout-dependent fields seeded, driving the
// real applyColumnMode() / ensureCursorVisible().
function screenInstance(dom) {
  const s = Object.create(Deep16ScreenUI.prototype);
  s.screenWidth = 80;
  s.screenHeight = 24;
  s.totalChars = 80 * 24;
  s.requiredWidth = 640;
  s.cellWidth = 8;
  s.minVisibleCols = 20;
  s.windowStart = -1;
  s.windowCols = -1;
  s.activePage = 0;
  s.visibleCols = 80;
  s.lastCursorIndex = null;
  // measureElement() and modeElement() are deliberately NOT stubbed here: the
  // whole point is to run the real ones against the document stub, which hands
  // out the inner box for '.screen-tab' and the wrapper for '#screen-tab'.
  // Stubbing them made every test pass whatever the code did.
  // Die echte setPage(): sie blendet die Zellen aus und setzt die Breite.
  s.screenDisplay = dom.display;
  return s;
}

function withScreenDom(width, fn) {
  const dom = screenDom(width);
  const prevDoc = globalThis.document;
  const prevResize = globalThis.ResizeObserver;
  const prevGet = globalThis.window.getComputedStyle;
  globalThis.document = {
    getElementById: (id) => dom.ids[id] || null,
    querySelector: (sel) => (sel === '.screen-tab' ? dom.inner : null),
    createElement: (tag) => makeEl(tag),
    documentElement: { style: { setProperty() {} } },
  };
  // No layout engine here, so the tab's padding reads as zero.
  globalThis.window.getComputedStyle = () => ({ paddingLeft: '0px', paddingRight: '0px' });
  globalThis.ResizeObserver = undefined;    // exercise the window-listener path
  try {
    return fn(dom, screenInstance(dom));
  } finally {
    globalThis.document = prevDoc;
    globalThis.ResizeObserver = prevResize;
    globalThis.window.getComputedStyle = prevGet;
  }
}

test('all 80 columns show when the tab is wide enough', () => {
  withScreenDom(900, (dom, s) => {
    s.applyColumnMode();
    assert.equal(s.visibleCols, 80, '80 columns at 8px fit in 900px');
    assert.equal(dom.tab.classes.has('screen-narrow'), false);
  });
});

test('the pager takes over when the tab is too narrow for 80 columns', () => {
  withScreenDom(500, (dom, s) => {
    s.applyColumnMode();
    assert.equal(s.visibleCols, 62, 'as many columns as fit: floor(500/8) = 62');
    assert.equal(dom.tab.classes.has('screen-narrow'), true,
                 'the class that shows the pager and hides columns 41-80 must be set');
  });
});

test('exactly at the threshold all 80 columns still show', () => {
  withScreenDom(640, (dom, s) => {
    s.applyColumnMode();
    assert.equal(s.visibleCols, 80, '640 px is exactly the width of the screen');
  });
});

test('a tab with no layout yet is left alone rather than called too narrow', () => {
  // An inactive tab has clientWidth 0. Reading that as "no room" would switch
  // the pager on and hide half the screen for no reason.
  withScreenDom(0, (dom, s) => {
    s.applyColumnMode();
    assert.equal(s.visibleCols, 80, 'a tab without layout must not trigger the pager');
    assert.equal(dom.tab.classes.has('screen-narrow'), false);
  });
});

test('going back to full width hides the pager again', () => {
  withScreenDom(500, (dom, s) => {
    s.applyColumnMode();
    assert.equal(dom.tab.classes.has('screen-narrow'), true);
    dom.inner.clientWidth = 900;
    dom.tab.clientWidth = 900;
    s.applyColumnMode();
    assert.equal(dom.tab.classes.has('screen-narrow'), false);
    assert.equal(s.visibleCols, 80);
    assert.equal(s.activePage, 0, 'the pager returns to the first page');
  });
});

test('the cursor follows the pager only while it is in use', () => {
  withScreenDom(320, (dom, s) => {   // 320px -> 40 columns, two pages
    s.visibleCols = 40;
    // Column 70 with all 80 visible: nothing to page to.
    s.visibleCols = 80;
    s.lastCursorIndex = 70;
    s.ensureCursorVisible();
    assert.equal(s.activePage, 0, 'no page switch when everything is visible');
    // Same cursor with the pager active: column 70 is on the second page.
    s.visibleCols = 40;
    s.ensureCursorVisible();
    assert.equal(s.activePage, 1, 'the cursor pulls the pager along');
    // A cursor in the first 40 goes back.
    s.lastCursorIndex = 5;
    s.ensureCursorVisible();
    assert.equal(s.activePage, 0);
  });
});

// The outer wrapper is wider than the box that clips. That difference is only
// a dozen pixels, but on a tablet sitting right at the boundary it is the
// difference between "80 columns fit" and half the screen running off the edge.
test('the width is measured on the clipping box, not on the wider wrapper', () => {
  withScreenDom(640, (dom, s) => {
    // The wrapper has room to spare, the box that actually clips does not.
    dom.tab.clientWidth = 700;
    dom.inner.clientWidth = 600;       // 600 < 640: the screen would be cut
    s.applyColumnMode();
    assert.equal(s.visibleCols, 75,
      'measured on the clipping box: floor(600/8) = 75. The wider wrapper would '
      + 'give 80 and the last column would be cut off');
    assert.equal(dom.tab.classes.has('screen-narrow'), true);
  });
});

test('the narrow class lands on the wrapper so the menu row shrinks too', () => {
  withScreenDom(400, (dom, s) => {
    s.applyColumnMode();
    assert.equal(dom.tab.classes.has('screen-narrow'), true,
      '.screen-menu is a sibling of .screen-tab, so the class has to be on the '
      + 'wrapper or the menu row stays 640px wide while the screen shrinks');
    assert.equal(dom.inner.classes.has('screen-narrow'), false,
      'the class belongs on the wrapper, not on the measured box');
  });
});

// The screen UI is built while the Screen tab is still hidden - it has no
// width then, and the measurement is skipped on purpose. The moment the tab is
// actually shown is the first chance to find out how much room there is. On a
// narrow iPad in portrait that is the difference between the pager and a screen
// running off the edge.
test('switching to the Screen tab re-measures the width', () => {
  const prevDoc = globalThis.document;
  const ui = makeUi();
  let measured = 0;
  ui.screenUI = {
    updateScreenDisplay() {},
    applyColumnMode() { measured++; },
  };
  ui.updateAssemblyListing = () => {};
  ui.syncHeaderWidths = () => {};
  // No tabs and no keyboard hook in this stub, so only the measuring branch runs.
  globalThis.document = {
    querySelectorAll: () => [],
    getElementById: () => null,
    activeElement: null,
  };
  try {
    ui.switchTab('screen');
  } finally {
    globalThis.document = prevDoc;
  }
  assert.equal(measured, 1,
    'the Screen tab is only measurable once it is shown - switchTab must ask');
});

// The old narrow mode was a binary 40 or 80, which wasted up to a fifth of the
// width: a tablet with room for 60 columns showed 40 and paged over 20 that
// would have fitted. The count is now derived from the measured width.
test('the column count follows the width instead of jumping 40 to 80', () => {
  for (const [width, want] of [[480, 60], [520, 65], [560, 70], [640, 80]]) {
    withScreenDom(width, (dom, s) => {
      s.applyColumnMode();
      assert.equal(s.visibleCols, want, `${width}px should show ${want} columns`);
    });
  }
});

test('a tablet showing 60 columns needs two pages, not one', () => {
  withScreenDom(480, (dom, s) => {       // 60 columns
    s.applyColumnMode();
    assert.equal(s.pageCount(), 2, '60 of 80 columns need a second page');
    s.setPage(1);
    assert.equal(s.activePage, 1);
    assert.equal(dom.display.style.width, '480px', 'the second page is as wide as the first');
    assert.equal(dom.ids['screen-page-label'].textContent, '61-80 / 80');
    s.setPage(5);                          // far past the end
    assert.equal(s.activePage, 1, 'a page number beyond the last is clamped');
  });
});

test('a width that fits fewer than a readable number still shows something', () => {
  withScreenDom(64, (dom, s) => {        // 8 cells' worth - far too narrow
    s.applyColumnMode();
    assert.equal(s.visibleCols, 20, 'clamped up to the minimum, not down to nothing');
    assert.equal(dom.tab.classes.has('screen-narrow'), true);
  });
});


// ---------------------------------------------------------------------------
// Cell colours
//
// The high byte is four bits of background and four of foreground. Until the
// colour byte was completed the background was masked to three bits, because
// bit 15 was the kernel's cursor marker and those eight bright backgrounds
// were unreachable. The cursor is now the reversed default colour, so nothing
// is left over - all sixteen of both are addressable.
// ---------------------------------------------------------------------------

// The real constructor, so palette and CURSOR_ATTR come from the code under
// test rather than from a second copy in this file.
function withCells(count, fn) {
  const ids = {};
  for (let i = 0; i < count; i++) {
    const cell = makeEl('span');
    cell.id = `screen-char-${i}`;
    ids[cell.id] = cell;
  }
  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById: (id) => ids[id] || null,
    querySelector: () => null,
    createElement: (tag) => makeEl(tag),
  };
  try {
    return fn(ids, new Deep16ScreenUI({}));
  } finally {
    globalThis.document = prevDoc;
  }
}

test('the background nibble reaches all sixteen colours', () => {
  withCells(16, (ids, s) => {
    for (let bg = 0; bg < 16; bg++) {
      s.lastDrawn[bg] = -1;                 // bypass the repaint cache
      s.drawWord(bg, ((bg << 4) | 7) << 8 | 0x41);   // (bg << 4) | fg
      assert.equal(ids[`screen-char-${bg}`].style.backgroundColor, s.palette[bg],
        `background ${bg} must use palette entry ${bg}`);
      assert.equal(ids[`screen-char-${bg}`].style.color, s.palette[7],
        'the foreground is unaffected by the background nibble');
    }
  });
});

test('the foreground nibble reaches all sixteen colours', () => {
  withCells(16, (ids, s) => {
    for (let fg = 0; fg < 16; fg++) {
      s.lastDrawn[fg] = -1;
      s.drawWord(fg, ((1 << 4) | fg) << 8 | 0x41);   // (bg << 4) | fg
      assert.equal(ids[`screen-char-${fg}`].style.color, s.palette[fg],
        `foreground ${fg} must use palette entry ${fg}`);
      assert.equal(ids[`screen-char-${fg}`].style.backgroundColor, s.palette[1],
        'the background is unaffected by the foreground nibble');
    }
  });
});

test('the cursor is the reversed default colour, drawn like any other cell', () => {
  withCells(3, (ids, s) => {
    s.drawWord(0, (s.CURSOR_ATTR | 0x20));      // a space under the cursor
    const cell = ids['screen-char-0'];
    assert.equal(cell.style.color, s.palette[0], 'black on ...');
    assert.equal(cell.style.backgroundColor, s.palette[7], '... light grey');
    assert.equal(cell.classes.has('screen-cursor'), true, 'and the outline follows');
    assert.equal(cell.textContent, ' ', 'the character under the cursor survives');
  });
});

test('attribute 0 is the terminal default and carries no cursor marker', () => {
  withCells(2, (ids, s) => {
    s.drawWord(0, 0x0041);                      // 'A', no attribute
    const cell = ids['screen-char-0'];
    assert.equal(cell.textContent, 'A');
    assert.equal(cell.style.color, '');
    assert.equal(cell.style.backgroundColor, '');
    assert.equal(cell.classes.has('screen-cursor'), false);
  });
});

test('the repaint cache still lets a changed cell through', () => {
  withCells(1, (ids, s) => {
    s.drawWord(0, 0x0041);
    assert.equal(ids['screen-char-0'].textContent, 'A');
    // Same word again: nothing to do.
    ids['screen-char-0'].textContent = 'unveraendert';
    s.drawWord(0, 0x0041);
    assert.equal(ids['screen-char-0'].textContent, 'unveraendert',
      'an unchanged word must not be redrawn');
    // The cursor moves on: a different word, so the cell is redrawn.
    s.drawWord(0, s.CURSOR_ATTR | 0x41);
    assert.equal(ids['screen-char-0'].classes.has('screen-cursor'), true);
    s.drawWord(0, 0x0041);
    assert.equal(ids['screen-char-0'].classes.has('screen-cursor'), false,
      'and the marker goes away again when the cursor does');
  });
});

// The nibble order is pinned from the drawing end as well as in the kernel
// tests. Written the ANSI way, the background sits high and the foreground
// low; swap the two in the code below and the two palettes are exchanged,
// which no other test here would notice.
test('the low nibble is the foreground and the high one the background', () => {
  withCells(2, (ids, s) => {
    const fg = 5, bg = 9;                 // magenta on bright black
    s.drawWord(0, (((bg << 4) | fg) << 8) | 0x41);
    assert.equal(ids['screen-char-0'].style.color, s.palette[fg],
      `palette[${fg}] must be the character colour`);
    assert.equal(ids['screen-char-0'].style.backgroundColor, s.palette[bg],
      `palette[${bg}] must be the background`);
    // The mistake this guards against: the foreground shifted into the high
    // nibble paints the cell in the character colour and puts the background
    // on the glyph.
    const falsch = (fg << 4) | bg;
    assert.notEqual(falsch, (bg << 4) | fg, 'the two orders must give different cells');
  });
});

// ---------------------------------------------------------------------------
// .fth files are typed into the kernel, not opened in the editor
//
// The editor's Assemble button runs the Deep16 machine-code assembler over
// whatever the editor holds and writes the result straight into memory. Hand it
// Forth source and the running kernel is assembled over. So a .fth must never
// reach the editor - and it cannot be left to the file dialog's accept
// attribute, because iOS Safari does not enforce that and lets any file be
// picked from Files or iCloud Drive.
// ---------------------------------------------------------------------------

test('a .fth file is recognised as Forth source, a .asm file is not', () => {
  const ui = makeUi();
  for (const name of ['hanoi.fth', 'Hanoi.FTH', 'notes.forth', 'a/b/c.Fth']) {
    assert.equal(ui.isForthSourceFile(name), true, `${name} is Forth source`);
  }
  for (const name of ['kernel.asm', 'prog.s', 'forth.asm', 'hanoi.txt', 'fth', '']) {
    assert.equal(ui.isForthSourceFile(name), false, `${name || '(leer)'} is not Forth source`);
  }
  assert.equal(ui.isForthSourceFile(undefined), false, 'no name at all is not Forth source');
});

test('the Open dialog offers assembly files only - .fth belongs on Upload', async () => {
  // The Upload button already carries accept=".fs,.fth,.forth,.4th,.txt".
  // Adding .fth to Open as well would put it in a dialog that cannot do
  // anything with it.
  const ui = makeUi();
  ui.editorElement = { value: '' };
  ui.fileModified = false;
  ui.updateFileStatus = () => {};
  let accept = null;
  const prevPicker = globalThis.window.showOpenFilePicker;
  delete globalThis.window.showOpenFilePicker;
  const prevCreate = globalThis.document.createElement;
  globalThis.document.createElement = () => ({
    set accept(v) { accept = v; },
    click() { /* nur die accept-Abfrage zaehlt hier */ },
  });
  try {
    await ui.loadFile();
    assert.equal(accept, '.asm,.s', 'Open darf keine .fth anbieten');
  } finally {
    globalThis.document.createElement = prevCreate;
    if (prevPicker !== undefined) globalThis.window.showOpenFilePicker = prevPicker;
  }
});

test('opening a .fth types it in and leaves the editor alone', async () => {
  const ui = makeUi();
  ui.editorElement = { value: '; Inhalt, der unangetastet bleiben muss\n' };
  ui.fileModified = false;
  ui.updateFileStatus = () => {};
  let confirmCalled = false;
  const prevConfirm = globalThis.confirm;
  globalThis.confirm = () => { confirmCalled = true; return true; };

  const hochgeladen = [];
  ui.uploadForthSource = (file) => hochgeladen.push(file);
  // The assembler must not even be reachable from this path.
  ui.assembler = { assemble() { throw new Error('der Assembler darf hier nicht laufen'); } };

  // No showOpenFilePicker -> the plain <input type=file> fallback runs, which is
  // the path an iPad takes.
  const prevPicker = globalThis.window.showOpenFilePicker;
  delete globalThis.window.showOpenFilePicker;
  const datei = { name: 'hanoi.fth' };
  let onchange = null;
  const prevCreate = globalThis.document.createElement;
  globalThis.document.createElement = () => ({
    set accept(v) { this._accept = v; },
    get accept() { return this._accept; },
    set onchange(v) { onchange = v; },
    click() { onchange({ target: { files: [datei] } }); },
  });

  try {
    await ui.loadFile();
    assert.deepEqual(hochgeladen, [datei], 'die Datei muss an den Upload gehen');
    assert.equal(ui.editorElement.value, '; Inhalt, der unangetastet bleiben muss\n',
      'der Editor darf nicht überschrieben werden');
  } finally {
    globalThis.confirm = prevConfirm;
    globalThis.document.createElement = prevCreate;
    if (prevPicker !== undefined) globalThis.window.showOpenFilePicker = prevPicker;
  }
});

test('opening an .asm file still goes into the editor', async () => {
  const ui = makeUi();
  ui.editorElement = { value: '' };
  ui.fileModified = false;
  ui.updateFileStatus = () => {};
  ui.renderEditorHighlight = () => {};
  ui.setFileModified = () => {};
  ui.currentFilename = 'start.asm';
  ui.addTranscriptEntry = () => {};
  let hochgeladen = 0;
  ui.uploadForthSource = () => { hochgeladen++; };

  const prevPicker = globalThis.window.showOpenFilePicker;
  delete globalThis.window.showOpenFilePicker;
  let onchange = null;
  const prevCreate = globalThis.document.createElement;
  globalThis.document.createElement = () => ({
    set accept(v) { this._accept = v; },
    get accept() { return this._accept; },
    set onchange(v) { onchange = v; },
    click() { onchange({ target: { files: [{ name: 'prog.asm' }] } }); },
  });
  // readAsText is called on a fresh FileReader; feed it back synchronously.
  const prevFR = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsText() { this.result = 'LDI 1\nHALT\n'; if (this.onload) this.onload({ target: this }); }
  };

  try {
    await ui.loadFile();
    assert.equal(hochgeladen, 0, 'eine .asm-Datei darf nicht getippt werden');
    assert.equal(ui.editorElement.value, 'LDI 1\nHALT\n', 'sie landet im Editor');
    assert.equal(ui.currentFilename, 'prog.asm');
  } finally {
    globalThis.document.createElement = prevCreate;
    globalThis.FileReader = prevFR;
    if (prevPicker !== undefined) globalThis.window.showOpenFilePicker = prevPicker;
  }
});

test('uploadForthSource says why the editor stayed empty', () => {
  const ui = makeUi();
  const gesehen = [];
  ui.addTranscriptEntry = (msg, kind) => gesehen.push(`${kind}: ${msg}`);
  let uebergeben = null;
  ui.queueFileUpload = (file) => { uebergeben = file; };
  const datei = { name: 'hanoi.fth' };
  ui.uploadForthSource(datei);
  assert.equal(uebergeben, datei, 'die Datei muss weitergegeben werden');
  assert.equal(gesehen.length, 1);
  assert.match(gesehen[0], /Forth source/);
  assert.match(gesehen[0], /hanoi\.fth/,
    'der Grund muss im Protokoll stehen, sonst sieht ein leerer Editor aus wie Datenverlust');
  assert.match(gesehen[0], /Upload/,
    'und es muss sagen, wo .fth-Dateien hingehören');
});

test('an upload that finishes puts the button back and releases the memory view', () => {
  // The completion path used to mark src.done and leave this.fileUpload in
  // place. The button then kept reading "Cancel", and because updateAllDisplays()
  // takes `busy` from the same field, the memory view stayed held still for good
  // once any file had been typed in.
  const btn = fakeButton();
  withUploadButton(btn, () => {
    const ui = makeUi();
    ui.updateEchoButton = () => {};
    ui.setUploadHint = () => {};
    ui.echoOn = false;
    let memoryUpdates = 0;
    ui.memoryUI = { updateMemoryDisplay() { memoryUpdates++; } };
    ui.simulator.memory = ui.simulator.memory || [];
    ui.fileUpload = {
      name: 'sq.fth',
      keys: [97, 13], pos: 0, done: false, stalled: false, echoRestore: true,
    };
    ui.updateUploadButton();
    assert.equal(btn.textContent, 'Cancel');

    ui.kbdAvailable = () => 0;                 // room in the queue
    ui.kbdPushCode = () => {};
    assert.equal(ui.pumpKeyQueue(), 2, 'both keystrokes were handed over');

    assert.equal(ui.fileUpload.done, true, 'the finished object is kept for inspection');
    assert.equal(ui.uploadInFlight(), false, 'but nothing is in flight any more');
    assert.equal(btn.textContent, 'Upload', 'the button has to go back to Upload');
    assert.equal(btn.classList.has('screen-upload-cancel'), false);
    assert.ok(memoryUpdates > 0, 'the memory view is refreshed once the upload is over');

    // The echo is not back yet: the keystrokes have been handed over, not read.
    assert.equal(ui.echoOn, false, 'the echo stays off until the machine has read the file');
    assert.equal(ui.fileUpload.echoPending, true);

    // Once the queue has drained - the machine caught up - the net is pulled.
    ui.pumpKeyQueue();
    assert.equal(ui.echoOn, true, 'the echo comes back once the queue is empty');
    assert.equal(ui.fileUpload.echoPending, false);

    // And a later updateAllDisplays() must not still see it as busy.
    let memory = 0, screen = 0;
    ui.registerUI = { updateRegisterDisplay() {}, updatePSWDisplay() {},
                      updateSegmentRegisters() {}, updateShadowRegisters() {} };
    ui.memoryUI = { updateMemoryDisplay() { memory++; }, updateRecentMemoryDisplay() { memory++; } };
    ui.updateSegmentNavigationFields = () => {};
    ui.screenUI = { updateScreenDisplay() { screen++; } };
    ui.updateCoreStats = () => {};
    ui.updateAllDisplays();
    assert.equal(memory, 2, 'the memory view is live again');
    assert.equal(screen, 1);
  });
});

// ---------------------------------------------------------------------------
// Upload: the echo commands it types, and the button that cancels it

test('the echo is not put back on while the machine has unread keystrokes queued', () => {
  // The tail of the file was being printed because the echo was restored the
  // moment the last keystroke was handed to the queue. The pump runs KBD_CHUNK
  // characters ahead of the machine, so at that moment up to KBD_FIFO_DEPTH
  // characters - a page of the file - were still waiting to be read, and the
  // machine typed them out with prompts.
  //
  // Handing over is not reading, so the net is only pulled once the queue has
  // actually drained.
  const ui = makeUi();
  ui.updateEchoButton = () => {};
  ui.setUploadHint = () => {};
  ui.echoOn = false;
  let queued = [];
  ui.fileUpload = {
    name: 'sq.fth', keys: [97, 98, 99, 100, 13], pos: 0, done: false, stalled: false,
    echoRestore: true,
  };
  ui.kbdPushCode = (c) => queued.push(c);
  // The machine is behind: three characters are still waiting to be read.
  ui.kbdAvailable = () => 3;

  ui.pumpKeyQueue();
  assert.equal(ui.fileUpload.done, true, 'every keystroke was handed over');
  assert.equal(ui.echoOn, false, 'but the echo must still be off');
  assert.equal(ui.fileUpload.echoPending, true, 'the net is left pending');

  // Still unread: pumping again must not pull it either.
  ui.pumpKeyQueue();
  assert.equal(ui.echoOn, false, 'still unread, still off');

  // The machine has read them all.
  ui.kbdAvailable = () => 0;
  ui.pumpKeyQueue();
  assert.equal(ui.echoOn, true, 'the echo comes back exactly once the queue is empty');
  assert.equal(ui.fileUpload.echoPending, false, 'and the net is spent');
});

test('a file being loaded owns the keyboard: typed keys are discarded', () => {
  // Keys typed during a load land in the same FIFO as the file itself, in the
  // middle of a line the machine is reading, so they are read as part of that
  // line and corrupt the load. They are dropped, not queued for later.
  const ui = makeUi();
  ui.screenUI = { setActive() {} };
  ui.addTranscriptEntry = () => {};
  ui.setUploadHint = () => {};
  globalThis.document.activeElement = { id: 'terminal-kbd-hook', tagName: 'INPUT' };

  const key = (k) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false });

  // Nothing loading: the key goes to the machine.
  ui.handleTerminalKey(key('a'));
  assert.equal(ui.simulator.kbdAvailable(), 1, 'a key with no load running reaches the machine');
  ui.kbdClearAll();

  // Loading: dropped, and not queued either.
  ui.fileUpload = { name: 'hanoi.fth', keys: [97, 13, 98], pos: 0, done: false, stalled: false };
  ui.uploadKeysDropped = false;
  ui.handleTerminalKey(key('b'));
  ui.handleTerminalKey(key('c'));
  assert.equal(ui.simulator.kbdAvailable(), 0, 'no key may reach the queue while loading');
  assert.equal(ui.uploadKeysDropped, true, 'and the user is told once, not per key');

  // Done: the keyboard is the user's again.
  ui.fileUpload.done = true;
  ui.handleTerminalKey(key('d'));
  assert.equal(ui.simulator.kbdAvailable(), 1, 'the keyboard works again once the load is over');
  ui.kbdClearAll();
  globalThis.document.activeElement = null;
});
//
// An upload silences the echo, and the two commands that do that are part of
// the keystroke stream rather than only poked into memory: a poke is a snapshot,
// and anything that reloads the image afterwards (Reset, a core switch, a fresh
// assemble) puts the cell back and then the whole file is drawn on the screen.
// ---------------------------------------------------------------------------

// Minimal button stub: textContent, title, aria-pressed and a class set.
function fakeButton() {
  const classes = new Set();
  return {
    textContent: '', title: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    classList: {
      toggle(c, on) { on ? classes.add(c) : classes.delete(c); },
      has(c) { return classes.has(c); },
    },
  };
}

// point getElementById at the stub for one test
function withUploadButton(btn, fn) {
  const prev = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => (id === 'file-upload-btn' ? btn : prev(id));
  try { return fn(); } finally { globalThis.document.getElementById = prev; }
}

test('the Upload button becomes a red Cancel while a file is queued', () => {
  const btn = fakeButton();
  withUploadButton(btn, () => {
    const ui = makeUi();
    ui.updateEchoButton = () => {};
    ui.setUploadHint = () => {};
    ui.cleared = false;
    ui.kbdClearAll = () => { ui.cleared = true; };

    ui.fileUpload = null;
    ui.echoOn = true;
    ui.updateUploadButton();
    assert.equal(btn.textContent, 'Upload');
    assert.equal(btn.classList.has('screen-upload-cancel'), false);
    assert.equal(btn.attrs['aria-pressed'], 'false');

    ui.fileUpload = { name: 'hanoi.fth', keys: [], pos: 0, done: false, stalled: false, echoRestore: true };
    ui.updateUploadButton();
    assert.equal(btn.textContent, 'Cancel', 'the button is the only progress indicator there is');
    assert.equal(btn.classList.has('screen-upload-cancel'), true);
    assert.equal(btn.attrs['aria-pressed'], 'true');

    ui.cancelFileUpload('cancelled by the user');
    assert.equal(ui.fileUpload, null);
    assert.equal(ui.cleared, true, 'the keystroke queue has to be emptied');
    assert.equal(ui.echoOn, true, 'a cancelled load must not leave the echo off');
    assert.equal(btn.textContent, 'Upload', 'the button goes back');
    assert.equal(btn.classList.has('screen-upload-cancel'), false);
    assert.ok(ui.transcript.some(t => t.includes('cancelled by the user')));
  });
});

test('an upload types 0 echo before the file and 1 echo after it', () => {
  const prev = globalThis.FileReader;
  // Enough of a FileReader to run queueFileUpload's onload path.
  globalThis.FileReader = class {
    readAsText() { this.result = ': sq dup * ;\n'; this.onload(); }
  };
  try {
    const ui = makeUi();
    ui.setUploadHint = () => {};
    ui.updateUploadButton = () => {};
    ui.updateEchoButton = () => {};

    ui.queueFileUpload({ name: 'sq.fth', size: 14 });
    assert.ok(ui.fileUpload, 'the file must be queued');
    const typed = ui.fileUpload.keys
      .map(c => (c === 13 ? '\n' : String.fromCharCode(c))).join('');
    assert.ok(typed.startsWith('0 echo\n'), `the stream starts with 0 echo, got ${JSON.stringify(typed.slice(0, 12))}`);
    assert.ok(typed.includes(': sq dup * ;\n'), 'the file is in between the two commands');
    assert.ok(typed.endsWith('1 echo\n'), `the stream ends with 1 echo, got ${JSON.stringify(typed.slice(-10))}`);
    // The poke is the fast path, not the only one: the machine is told too.
    assert.equal(ui.echoOn, false, 'the Screen tab state follows the stream');
  } finally {
    if (prev === undefined) delete globalThis.FileReader; else globalThis.FileReader = prev;
  }
});

test('the memory display is held still while a file is typing itself in', () => {
  const ui = makeUi();
  let memoryUpdates = 0, screenUpdates = 0;
  ui.registerUI = {
    updateRegisterDisplay() {}, updatePSWDisplay() {},
    updateSegmentRegisters() {}, updateShadowRegisters() {},
  };
  ui.memoryUI = {
    updateMemoryDisplay() { memoryUpdates++; },
    updateRecentMemoryDisplay() { memoryUpdates++; },
  };
  ui.updateSegmentNavigationFields = () => {};
  ui.screenUI = { updateScreenDisplay() { screenUpdates++; } };
  ui.updateCoreStats = () => {};

  ui.fileUpload = null;
  ui.updateAllDisplays();
  assert.equal(memoryUpdates, 2, 'idle: both memory views refresh');
  assert.equal(screenUpdates, 1);

  memoryUpdates = 0; screenUpdates = 0;
  ui.fileUpload = { name: 'hanoi.fth', keys: [], pos: 0, done: false, stalled: false };
  ui.updateAllDisplays();
  assert.equal(memoryUpdates, 0, 'while typing itself in, the memory view is not worth redrawing');
  assert.equal(screenUpdates, 1, 'but the screen is the one being watched');
});
