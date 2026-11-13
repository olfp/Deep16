// Browser D16D image builder vs scripts/make_image.mjs. The browser version is
// code only; graphics are the flash blob, not part of this image. Flappy,
// Frogger and Pac-Man are flash slices, so the image carries only the menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { flappyArtPack, pacmanArtPack, froggerArtPack } from '../scripts/make_tile_font.mjs';

process.env.D16NANO = '1';
process.env.D16D = '1';
process.env.D16SEG = '1';
const { buildImage } = await import('../scripts/make_image.mjs');

for (const f of ['js/deep16_assembler.js', 'js/deep16_d16d_image.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const Deep16D16DImage = vm.runInThisContext('Deep16D16DImage');

const kernel = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
const showcase = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'showcase.asm'), 'utf8');
const flappy = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'flappy_game.asm'), 'utf8');
const flappyDefs = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'flappy_defs.asm'), 'utf8');
const pacmanMap = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'pacman_map.asm'), 'utf8');
const pacmanGame = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'pacman_game.asm'), 'utf8');
const frogger = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'frogger_demo.asm'), 'utf8');

const packs = { flappy: flappyArtPack(), pacman: pacmanArtPack(), frogger: froggerArtPack() };
const sources = { kernel, showcase, flappy, flappyDefs, pacmanMap, pacmanGame, frogger, packs };

test('browser builder matches the Node D16D image word for word', () => {
  const node = buildImage();
  const browser = Deep16D16DImage.build(sources);
  assert.deepEqual(Array.from(browser.words), Array.from(node.words));
  assert.deepEqual(browser.outOfWindow, node.outOfWindow);
  assert.equal(browser.dictFree, node.dictFree);
  assert.equal(browser.biosEntry, node.biosEntry);
  assert.deepEqual(
    [...browser.showcase.words].sort((a, b) => a[0] - b[0]),
    [...node.showcase.words].sort((a, b) => a[0] - b[0]), 'menu block matches');
  assert.deepEqual(browser.pacman.words, node.pacman.words, 'pacman block matches');
  // The games are slices: the gap below the BIOS and the game area are empty.
  assert.equal(node.words[0x4350], 0xffff, 'frogger is not baked into the image');
  assert.equal(node.words[0x5F00], 0xffff, 'flappy is not baked into the image');
  assert.equal(node.words[0x4330 + 0x610], 0xffff, 'the maze is not in the image');
  assert.deepEqual(Array.from(Deep16D16DImage.build({
    ...sources, bakePacman: true,
  }).words).slice(0x4330 + 0x610, 0x4330 + 0x611), [0x5555], 'baking still works');
});

test('the showcase does not overwrite any live kernel word', () => {
  const node = buildImage();
  // The menu is laid sparsely over 0x4D34..0x547F. A write over a real kernel
  // word silently replaces it: serial-read used to sit at 0x4E42, under the
  // menu, and xmodem died on the first SOH. The build reports every such hit.
  assert.deepEqual(node.collisions, [], 'no showcase word lands on kernel code');
  assert.equal(node.words[0x4400], 0x83a0, 'serial-read is intact at its new home');
  assert.equal(node.words[0x444e], 0x4400, 'its header points at it');
});

test('the slice blocks are built with their load segments', () => {
  const browser = Deep16D16DImage.build(sources);
  assert.equal(browser.flappy.seg, 0x5000);
  assert.equal(browser.frogger.seg, 0x0600);
  assert.equal(browser.pacman.seg, 0x2000);
  assert.equal(browser.flappy.words[0][0], 0, 'flappy starts at its entry');
  assert.equal(browser.frogger.words[0][0], 0, 'frogger starts at its entry');
  assert.ok(browser.flappy.codeMax < 0x1000, 'flappy code ends below the pack');
  assert.ok(browser.frogger.codeMax < 0x1000, 'frogger code ends below the pack');
  assert.ok(browser.frogger.max > 0x1000, 'the frogger pack rides at 0x1000');
});

test('the image is code plus the showcase, not graphics', () => {
  const browser = Deep16D16DImage.build(sources);
  assert.equal(browser.words.length, 0x6000);
  assert.equal(browser.outOfWindow.includes(0xF0064), true, 'echo cell is outside the window');
  for (let a = 0xF3000; a <= 0xF3000 + 32; a++) {
    assert.equal(browser.words[a], undefined);
  }
});

test('a broken kernel reports the assembler error', () => {
  assert.throws(() => Deep16D16DImage.build({ ...sources, kernel: 'NOT A WORD' }),
                /kernel does not assemble/);
});

test('missing showcase sources are rejected', () => {
  assert.throws(() => Deep16D16DImage.build({ kernel }), /showcase source/);
});
