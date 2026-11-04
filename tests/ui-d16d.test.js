// D16D image integration in the IDE: the code-only builder fills the 24K
// window, and the example carries the showcase sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './helpers.js';

globalThis.window = globalThis.window || {};
globalThis.document = {
  addEventListener() {},
  getElementById() { return null; },
};

for (const f of ['js/deep16_assembler.js', 'js/deep16_simulator.js',
                 'js/deep16_d16d_image.js', 'js/deep16_ui_core.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const DeepWebUI = vm.runInThisContext('DeepWebUI');
const Deep16Simulator = vm.runInThisContext('Deep16Simulator');

const kernel = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
const showcase = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'showcase.asm'), 'utf8');
const flappy = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'flappy_game.asm'), 'utf8');
const pacmanMap = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'pacman_map.asm'), 'utf8');
const pacmanGame = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'pacman_game.asm'), 'utf8');

function makeUi() {
  const ui = Object.create(DeepWebUI.prototype);
  ui.simulator = new Deep16Simulator();
  ui.consoleView = 'tiles';
  ui.tileBuild = 'd16d';
  ui.d16dSources = { showcase, flappy, pacmanMap, pacmanGame };
  ui.tileStepsPerTick = 6000;
  ui.tileFrame = 0;
  ui.tileVblank = false;
  ui.tileS2 = false;
  ui.tileClock = null;
  return ui;
}

test('the IDE builder fills the 24K code image and returns the kernel symbols', () => {
  const ui = makeUi();
  const result = ui.buildD16DImage(kernel);
  assert.equal(result.success, true, result.errors.join('; '));
  assert.equal(result.image.words.length, 0x6000);
  assert.equal(ui.simulator.memory[0x4A00], result.image.words[0x4A00]);
  assert.ok(result.symbols.bios_entry, 'kernel symbols survive for the panel');
  assert.equal(result.memoryChanges.length, 0, 'the window was already written');
});

test('a missing showcase source fails rather than assembling the kernel alone', () => {
  const ui = makeUi();
  ui.d16dSources = null;
  const result = ui.buildD16DImage(kernel);
  assert.equal(result.success, false);
  assert.match(result.errors[0], /showcase sources/);
});

test('the examples manifest carries the D16D build tag', () => {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'asm', 'examples.json'), 'utf8'));
  const ex = json.examples.find((e) => e.filename === 'forth_nano.asm');
  assert.ok(ex, 'forth_nano example present');
  assert.equal(ex.build, 'd16d');
});
