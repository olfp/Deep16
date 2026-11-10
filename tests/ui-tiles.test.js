// Tiles console mode and the 640x360 canvas. The class constructor is DOM-heavy,
// so this test supplies a small fake document with one real canvas context.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './helpers.js';

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  toggle(c, on) {
    const next = on === undefined ? !this.set.has(c) : !!on;
    if (next) this.set.add(c); else this.set.delete(c);
    return next;
  }
  contains(c) { return this.set.has(c); }
}

function fakeEl(id = '') {
  return {
    id, textContent: '', innerHTML: '', style: {}, disabled: false, value: '',
    dataset: {}, className: '', classList: new FakeClassList(),
    children: [], width: 0, height: 0,
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, appendChild(child) { this.children.push(child); },
    focus() {}, querySelector() { return null; },
  };
}

function makeCanvas() {
  const canvas = fakeEl('screen-tile-canvas');
  const image = { data: new Uint8ClampedArray(640 * 360 * 4) };
  const ctx = {
    imageSmoothingEnabled: true,
    putCalls: 0,
    createImageData(w, h) {
      assert.equal(w, 640);
      assert.equal(h, 360);
      return image;
    },
    putImageData(data) {
      assert.equal(data, image);
      this.putCalls++;
    },
  };
  canvas.getContext = () => ctx;
  canvas.ctx = ctx;
  canvas.image = image;
  return canvas;
}

const els = {
  'console-mode-btn': fakeEl('console-mode-btn'),
  'screen-display': fakeEl('screen-display'),
  'screen-pager': fakeEl('screen-pager'),
  'screen-palette': fakeEl('screen-palette'),
};
const infoFull = fakeEl('info-full');
const infoShort = fakeEl('info-short');
let canvas = null;

globalThis.window = globalThis.window || {};
globalThis.window.addEventListener = () => {};
globalThis.localStorage = {
  store: new Map(),
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
  setItem(k, v) { this.store.set(k, String(v)); },
};
globalThis.document = {
  addEventListener() {},
  getElementById: (id) => els[id] || null,
  querySelector: (sel) => (sel === '.screen-info-full' ? infoFull
                         : sel === '.screen-info-short' ? infoShort : null),
  createElement: (tag) => {
    if (tag === 'canvas') {
      canvas = makeCanvas();
      return canvas;
    }
    return fakeEl(tag);
  },
};

for (const f of ['js/deep16_terminal.js', 'js/deep16_simulator.js',
                 'js/deep16_flash_assets.js', 'js/deep16_gfx_loader.js',
                 'js/deep16_tile_engine.js', 'js/deep16_ui_screen.js',
                 'js/deep16_ui_core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const DeepWebUI = vm.runInThisContext('DeepWebUI');
const Deep16Simulator = vm.runInThisContext('Deep16Simulator');
const Deep16ScreenUI = vm.runInThisContext('Deep16ScreenUI');
const Deep16TileEngine = vm.runInThisContext('Deep16TileEngine');

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
  ui.consoleView = 'screen';
  ui.tileBuild = null;
  ui.tileClock = null;
  ui.tileFrame = 0;
  ui.tileVblank = false;
  ui.tileS2 = false;
  ui.tileStepsPerTick = 6000;
  ui.tileEngine = new Deep16TileEngine();
  ui.simulator.tileEngine = ui.tileEngine;
  ui.transcript = [];
  ui.addTranscriptEntry = (msg, kind) => ui.transcript.push(`[${kind || 'info'}] ${msg}`);
  ui.status = () => {};
  ui.setUploadHint = () => {};
  ui.updateUploadButton = () => {};
  ui.updateTraceButton = () => {};
  ui.updateEchoButton = () => {};
  ui.screenUI = new Deep16ScreenUI(ui);
  return ui;
}

test('tile mode updates the button, the view and the build defines', () => {
  const ui = makeUi();
  ui.setConsoleMode('tiles');
  assert.equal(ui.consoleMode(), 'tiles');
  assert.equal(ui.screenUI.mode, 'tiles');
  assert.equal(els['console-mode-btn'].textContent, 'Tiles');
  assert.deepEqual(ui.assembleDefines(), { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1,
                                           CONSOLE_MIRROR: 1 });
  assert.ok(els['screen-display'].classList.contains('tile-view'));
  assert.ok(canvas.classList.contains('visible'));
  assert.equal(els['screen-pager'].style.display, 'none');
  assert.match(infoFull.textContent, /FiT 640/);
});

test('tile mode with the D16D example adds the showcase define', () => {
  const ui = makeUi();
  ui.tileBuild = 'd16d';
  ui.setConsoleMode('tiles');
  assert.deepEqual(ui.assembleDefines(), { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1,
                                           CONSOLE_MIRROR: 1, D16D: 1 });
});

test('the canvas paints the engine buffer', () => {
  const ui = makeUi();
  ui.setConsoleMode('tiles');
  const engine = ui.tileEngine;

  // A solid art tile at the top-left, with a red art-palette entry.
  for (let i = 0; i < 32; i++) engine.write(0xF3000 + 96 * 32 + i, 0x1111);
  engine.write(0xF6091, 0xE0);
  engine.write(0xF1000, 96 * 32);

  canvas.ctx.putCalls = 0;
  ui.screenUI.updateScreenDisplay();
  assert.equal(canvas.ctx.putCalls, 1);
  assert.deepEqual(Array.from(canvas.image.data.slice(0, 4)), [255, 0, 0, 255]);
});

test('switching away hides the canvas and restores the text view', () => {
  const ui = makeUi();
  ui.setConsoleMode('tiles');
  ui.setConsoleMode('screen');
  assert.equal(ui.consoleMode(), 'screen');
  assert.equal(ui.screenUI.mode, 'screen');
  assert.equal(els['console-mode-btn'].textContent, 'Screen');
  assert.ok(!els['screen-display'].classList.contains('tile-view'));
  assert.ok(!canvas.classList.contains('visible'));
  assert.equal(els['screen-pager'].style.display, '');
  assert.deepEqual(ui.assembleDefines(), {});
});

test('the console button cycles screen -> terminal -> tiles -> screen', () => {
  const ui = makeUi();
  assert.equal(ui.consoleMode(), 'screen');
  ui.toggleConsoleMode();
  assert.equal(ui.consoleMode(), 'terminal');
  ui.toggleConsoleMode();
  assert.equal(ui.consoleMode(), 'tiles');
  ui.toggleConsoleMode();
  assert.equal(ui.consoleMode(), 'screen');
});

test('loadTileAssets fills the engine and the JS memory from flash', () => {
  const ui = makeUi();
  ui.setConsoleMode('tiles');
  assert.equal(ui.loadTileAssets(), true);
  assert.equal(ui.tileEngine.tileBank[0], 0);
  assert.ok(ui.tileEngine.tileBank.some((w) => w !== 0), 'font/art words loaded');
  assert.equal(ui.tileEngine.palette[1], 0xFF);
  assert.equal(ui.simulator.memory[0xF6080 + 1], 0xFF);
  assert.equal(ui.simulator.spiFlash.mem[0x300000], 0x44);   // 'D'
});

test('the tile clock composes 0xF0066 and ticks the engine', () => {
  const ui = makeUi();
  ui.setConsoleMode('tiles');
  ui.simulator.running = true;
  ui.simulator.enqueueKeyCode(65);
  ui.tileS2 = true;
  const before = ui.tileEngine.frame;
  ui.tickTileFrame();
  assert.equal(ui.tileFrame, 1);
  assert.equal(ui.simulator.tileStatus & 0x2, 0x2, 'frame toggle');
  // The PS/2 keyboard is the keyboard FIFO now; 0xF0066 bit 3 is the separate
  // serial UART, so a key must not set it.
  assert.equal(ui.simulator.tileStatus & 0x8, 0, 'UART ready stays clear');
  assert.equal(ui.simulator.kbdAvailable(), 1, 'the key is in the keyboard FIFO');
  assert.equal(ui.simulator.tileStatus & 0x4, 0x4, 'S2');
  assert.equal(ui.tileEngine.frame, before ^ 1, 'engine frame ticked');
});

test('the tile clock starts and stops without leaking a timer', () => {
  const ui = makeUi();
  ui.setConsoleMode('tiles');
  ui.startTileClock();
  assert.ok(ui.tileClock, 'clock created');
  ui.stopTileClock();
  assert.equal(ui.tileClock, null);
});

test('tile mode uses the larger instruction budget', () => {
  const ui = makeUi();
  assert.equal(ui.instructionsPerTick(), 200);
  ui.setConsoleMode('tiles');
  assert.equal(ui.instructionsPerTick(), 6000);
});

test('tile-mode stores skip the text-cell renderer', () => {
  const ui = makeUi();
  ui.setConsoleMode('tiles');
  let textWrites = 0;
  ui.screenUI.handleScreenMemoryWrite = () => { textWrites++; };
  ui.simulator.checkScreenUpdate(0xF1000, 0x8000);
  assert.equal(textWrites, 0);
  assert.equal(ui.tileEngine.tilemap[0][0], 0x8000);
});
