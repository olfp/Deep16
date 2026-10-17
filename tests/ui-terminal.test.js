// The Screen tab's console switch and UART input routing (deep16_ui_core.js +
// deep16_ui_screen.js). The class constructor is DOM-heavy, so the instance is
// built from the prototype and the fields the methods touch are seeded by hand,
// the same way tests/ui-core.test.js does it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './helpers.js';

function fakeEl() {
  return { textContent: '', style: {}, disabled: false, value: '', dataset: {},
           classList: { add() {}, remove() {}, toggle() {} },
           setAttribute() {}, getAttribute() { return null; },
           addEventListener() {}, appendChild() {}, focus() {} };
}
const els = { 'core-select': fakeEl(), 'console-view-btn': fakeEl() };
globalThis.document = {
  addEventListener() {},
  getElementById: (id) => els[id] || null,
  querySelector: () => null,
  createElement: () => fakeEl(),
};
globalThis.window = globalThis.window || {};

for (const f of ['js/deep16_terminal.js', 'js/deep16_simulator.js',
                 'js/deep16_ui_screen.js', 'js/deep16_ui_core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const DeepWebUI = vm.runInThisContext('DeepWebUI');
const Deep16Simulator = vm.runInThisContext('Deep16Simulator');
const Deep16ScreenUI = vm.runInThisContext('Deep16ScreenUI');
assert.ok(Deep16ScreenUI, 'deep16_ui_screen.js must define Deep16ScreenUI');

function makeUi() {
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
  ui.status = () => {};
  // DOM-backed helpers the pump and the toggles reach for.
  ui.setUploadHint = () => {};
  ui.updateUploadButton = () => {};
  ui.updateTraceButton = () => {};
  ui.updateEchoButton = () => {};
  ui.screenUI = new Deep16ScreenUI(ui);
  return ui;
}

test('the console view starts on the screen buffer', () => {
  const ui = makeUi();
  assert.equal(ui.screenUI.mode, 'screen');
  assert.equal(ui.consoleMode(), 'screen');
  assert.ok(ui.screenUI.terminal, 'the terminal model must exist');
});

test('toggling switches the mode and the button label', () => {
  const ui = makeUi();
  ui.screenUI.setConsoleView('terminal');
  assert.equal(ui.screenUI.mode, 'terminal');
  assert.equal(ui.consoleMode(), 'terminal');
  assert.equal(els['console-view-btn'].textContent, 'View: Terminal');
  ui.screenUI.toggleConsoleView();
  assert.equal(ui.screenUI.mode, 'screen');
  assert.equal(els['console-view-btn'].textContent, 'View: Screen');
});

test('bytes emitted by the core land in the terminal view', () => {
  const ui = makeUi();
  ui.screenUI.setConsoleView('terminal');
  // What the machine would put on the wire: "Hi\r\n>"
  ui.simulator.uartTx.push(0x48, 0x69, 0x0D, 0x0A, 0x3E);
  ui.pumpConsole();
  const rows = ui.screenUI.terminal.text();
  assert.equal(rows[0].slice(0, 2), 'Hi');
  assert.equal(rows[1][0], '>');
  assert.equal(ui.simulator.uartTx.length, 0, 'the backlog is drained exactly once');
});

test('keys route to the UART RX in terminal mode', () => {
  const ui = makeUi();
  ui.screenUI.setConsoleView('terminal');
  ui.kbdPushCode(65);                       // 'A'
  assert.equal(ui.simulator.uartRxAvailable(), 1, 'the key is in the UART RX');
  assert.equal(ui.simulator.kbdAvailable(), 0, 'and not in the keyboard FIFO');
  assert.equal(ui.kbdAvailable(), 1, 'the pump sees one byte queued');
  assert.equal(ui.simulator.uartRx[0], 65, 'the byte survives unmasked to the port');
});

test('keys route to the keyboard FIFO in screen mode', () => {
  const ui = makeUi();
  ui.kbdPushCode(66);                       // 'B'
  assert.equal(ui.simulator.kbdAvailable(), 1);
  assert.equal(ui.simulator.uartRxAvailable(), 0);
});

test('clearing the queue clears whichever one is routed', () => {
  const ui = makeUi();
  ui.screenUI.setConsoleView('terminal');
  ui.kbdPushCode(1);
  ui.kbdPushCode(2);
  ui.kbdClearAll();
  assert.equal(ui.simulator.uartRxAvailable(), 0);
});

test('an uploaded file types itself into the UART in terminal mode', () => {
  const ui = makeUi();
  ui.screenUI.setConsoleView('terminal');
  ui.fileUpload = {
    name: 't.fs', keys: ui.fileToKeys('hi\n'), pos: 0, done: false, stalled: false,
  };
  const typed = ui.pumpKeyQueue();
  assert.ok(typed > 0, 'the pump typed something');
  assert.equal(ui.simulator.uartRxAvailable(), typed, 'and it went to the UART RX');
  assert.equal(ui.simulator.kbdAvailable(), 0, 'nothing went to the keyboard');
});
