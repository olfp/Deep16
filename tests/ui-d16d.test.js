// D16D image integration in the IDE: the code-only builder fills the 24K
// window, and the example carries the showcase sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT, readTileText } from './helpers.js';

globalThis.window = globalThis.window || {};
globalThis.document = {
  addEventListener() {},
  getElementById() { return null; },
};

for (const f of ['js/deep16_assembler.js', 'js/deep16_linker.js', 'js/deep16_simulator.js',
                 'js/deep16_d16d_image.js', 'js/deep16_ui_core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const DeepWebUI = vm.runInThisContext('DeepWebUI');
const Deep16Simulator = vm.runInThisContext('Deep16Simulator');

const kernel = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
const softfloat = fs.readFileSync(path.join(ROOT, 'asm', 'softfloat.asm'), 'utf8');
const forthFloat = fs.readFileSync(path.join(ROOT, 'asm', 'forth_float.asm'), 'utf8');
const showcase = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'showcase.asm'), 'utf8');
const flappy = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'flappy_game.asm'), 'utf8');
const pacmanMap = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'pacman_map.asm'), 'utf8');
const pacmanGame = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'pacman_game.asm'), 'utf8');
const frogger = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'frogger_demo.asm'), 'utf8');

const TILE = 0xF1000;
const TILE_COLS = 82;
const cell = (row, column) => TILE + row * TILE_COLS + column;
const glyph = (ch) => (ch.charCodeAt(0) - 0x20);

function makeUi(tileBuild = 'd16d') {
  const ui = Object.create(DeepWebUI.prototype);
  ui.simulator = new Deep16Simulator();
  ui.consoleView = 'tiles';
  ui.tileBuild = tileBuild;
  ui.d16dSources = { softfloat, forthFloat, showcase, flappy, pacmanMap, pacmanGame, frogger };
  ui.tileStepsPerTick = 6000;
  ui.tileFrame = 0;
  ui.tileVblank = false;
  ui.tileS2 = false;
  ui.tileClock = null;
  ui.useWasm = false;
  return ui;
}

test('the IDE builder fills the 28K code image and returns the kernel symbols', () => {
  const ui = makeUi();
  const result = ui.buildD16DImage(kernel);
  assert.equal(result.success, true, result.errors.join('; '));
  assert.equal(result.image.words.length, 0x7000);
  assert.equal(ui.simulator.memory[0x4A00], result.image.words[0x4A00]);
  assert.ok(result.symbols.bios_entry, 'kernel symbols survive for the panel');
  assert.equal(result.memoryChanges.length, 0, 'the window was already written');
});

test('the IDE builder scatters the D16SEG copies and keeps the baked script', () => {
  const ui = makeUi();
  const result = ui.buildD16DImage(kernel);
  assert.equal(result.success, true, result.errors.join('; '));

  const bootPtr = result.symbols.boot_ptr;
  assert.ok(Number.isInteger(bootPtr), 'the kernel exports its boot-script pointer');
  assert.notEqual(result.image.words[bootPtr], 0, 'the flat image keeps the board script');
  assert.equal(ui.simulator.memory[bootPtr], result.image.words[bootPtr],
               'the IDE flat copy keeps the board script');
  assert.equal(ui.simulator.memory[0x10000 + bootPtr], result.image.words[bootPtr],
               'the IDE DS copy keeps the board script');

  assert.equal(ui.simulator.memory[0x10000 + 0x3000],
               result.image.words[0x3000], 'the DS copy matches the flat image');
  assert.equal(ui.simulator.memory[0x30000],
               result.image.words[0x4A00], 'the BIOS copy matches the flat image');
});

test('a missing showcase source fails rather than assembling the kernel alone', () => {
  const ui = makeUi();
  ui.d16dSources = null;
  const result = ui.buildD16DImage(kernel);
  assert.equal(result.success, false);
  assert.match(result.errors[0], /showcase sources/);
});

test('the examples manifest identifies the D16D build by id', () => {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'asm', 'examples.json'), 'utf8'));
  const ex = json.examples.find((e) => e.id === 'd16d-showcase');
  assert.ok(ex, 'D16D showcase example present');
  assert.equal(ex.filename, 'forth_nano.asm');
  assert.equal(ex.build, 'd16d');
});

test('the example loader fetches the fitdemo-enabled DeepForth kernel', async () => {
  const ui = makeUi('nano');
  ui.examples = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'asm', 'examples.json'), 'utf8'),
  ).examples;
  ui.editorElement = { value: '' };
  ui.renderEditorHighlight = () => {};
  ui.status = () => {};
  ui.addTranscriptEntry = () => {};
  ui.switchTab = () => {};
  ui.updateRunButton = () => {};

  // Exercise the same fetch -> editor -> build path as the browser. A unit
  // test that starts from a local kernel string can pass even when the
  // example manifest points at a different, older source.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const relative = String(url).replace(/^\.\//, '');
    const file = path.resolve(ROOT, relative);
    assert.ok(file.startsWith(`${ROOT}${path.sep}`), `unexpected fetch path: ${url}`);
    return {
      ok: fs.existsSync(file),
      async text() { return fs.readFileSync(file, 'utf8'); },
    };
  };
  try {
    await ui.loadExample('deepforth');
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(ui.tileBuild, 'nano');
  assert.match(ui.editorElement.value, /^h_fitdemo:/m,
               'the loaded editor source contains the built-in header');
  assert.match(ui.editorElement.value, /^word_fitdemo:/m,
               'the loaded editor source contains the built-in implementation');

  const result = ui.buildNanoImage(ui.editorElement.value);
  assert.equal(result.success, true, result.errors.join('; '));
  assert.equal(result.symbols.h_fitdemo, 0x4460);
});

test('the generic nano example boots to a PS/2 prompt and evaluates input', () => {
  const ui = makeUi('nano');
  const result = ui.buildNanoImage(kernel);
  assert.equal(result.success, true, result.errors.join('; '));
  assert.equal(result.symbols.CONSOLE_STATUS, 0x60, 'input comes from the PS/2 status port');
  assert.equal(result.symbols.CONSOLE_DATA, 0x62, 'input comes from the PS/2 data port');

  const sim = ui.simulator;
  sim.d16nano = true;
  sim.running = true;

  let steps = 0;
  while (sim.running && steps < 2_000_000 &&
         (readTileText(sim.memory, 0, 0) !== 'Hello DeepForth!' ||
          readTileText(sim.memory, 1, 0) !== '> ')) {
    sim.step();
    steps++;
  }
  assert.equal(readTileText(sim.memory, 0, 0), 'Hello DeepForth!', 'the banner reached the tile map');
  assert.equal(readTileText(sim.memory, 1, 0), '> ', 'the interactive prompt is visible');

  for (const ch of '2 2 + .') sim.kbdBuffer.push(ch.charCodeAt(0));
  sim.kbdBuffer.push(10);

  steps = 0;
  while (sim.running && steps < 200000 && !readTileText(sim.memory, 1, 0).includes(' 4 ')) {
    sim.step();
    steps++;
  }
  assert.match(readTileText(sim.memory, 1, 0), /^> 2 2 \+ \. 4(?:\s|$)/,
               'the PS/2 line was interpreted');
  assert.equal(sim.uartRx.length, 0, 'the serial RX FIFO stayed unused');
});

test('the D16D example boots from the segmented copies into the showcase menu', () => {
  const ui = makeUi('d16d');
  const result = ui.buildD16DImage(kernel);
  assert.equal(result.success, true, result.errors.join('; '));

  const sim = ui.simulator;
  sim.d16nano = true;
  sim.running = true;

  // The first display-status read must still see the erased 0xFFFF value. It
  // tells the D16D BIOS that there is no PS/2 receiver to initialise; only
  // later ticks publish the live 60 Hz status.
  ui.tickTileFrame();
  assert.equal(sim.tileStatus, 0xFFFF);

  let firstReadStatus = null;
  let steps = 0;
  const menuReady = () =>
    (sim.memory[cell(5, 34)] & 0x0FFF) === glyph('D') &&
    (sim.memory[cell(12, 30)] & 0x0FFF) === glyph('Q') &&
    (sim.memory[cell(19, 29)] & 0x0FFF) === glyph('A');

  while (sim.running && steps < 20_000_000 && !menuReady()) {
    sim.step();
    steps++;
    if (firstReadStatus === null && sim.tileStatusReads > 0) firstReadStatus = sim.tileStatus;
    if (steps % 1000 === 0) ui.tickTileFrame();
  }

  assert.equal(firstReadStatus, 0xFFFF, 'the first status read sees the erased value');
  assert.ok(menuReady(), 'the showcase menu was drawn');
  assert.equal(sim.memory[cell(5, 34)] & 0x0FFF, glyph('D'), 'D16 title');
  assert.equal(sim.memory[cell(10, 30)] & 0x0FFF, glyph('F'), 'F FLAPPY');
  assert.equal(sim.memory[cell(12, 30)] & 0x0FFF, glyph('Q'), 'Q FORTH');
  assert.equal(sim.memory[cell(19, 29)] & 0x0FFF, glyph('A'), 'AUTORUN');

  ui.tickTileFrame();
  assert.notEqual(sim.tileStatus, 0xFFFF, 'later ticks publish the live status');
});
