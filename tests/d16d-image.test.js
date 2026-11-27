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
import { layoutWords } from '../scripts/make_ps2map.mjs';

process.env.D16NANO = '1';
process.env.D16D = '1';
process.env.D16SEG = '1';
const { buildImage } = await import('../scripts/make_image.mjs');

for (const f of ['js/deep16_assembler.js', 'js/deep16_linker.js', 'js/deep16_d16d_image.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const Deep16D16DImage = vm.runInThisContext('Deep16D16DImage');

const kernel = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
const softfloat = fs.readFileSync(path.join(ROOT, 'asm', 'softfloat.asm'), 'utf8');
const forthFloat = fs.readFileSync(path.join(ROOT, 'asm', 'forth_float.asm'), 'utf8');
const bdosBlock = fs.readFileSync(path.join(ROOT, 'asm', 'bdos_block.asm'), 'utf8');
const illBlock = fs.readFileSync(path.join(ROOT, 'asm', 'ill_block.asm'), 'utf8');
const showcase = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'showcase.asm'), 'utf8');
const flappy = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'flappy_game.asm'), 'utf8');
const flappyDefs = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'flappy_defs.asm'), 'utf8');
const pacmanMap = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'pacman_map.asm'), 'utf8');
const pacmanGame = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'pacman_game.asm'), 'utf8');
const frogger = fs.readFileSync(path.join(ROOT, 'asm', 'showcase', 'frogger_demo.asm'), 'utf8');

const packs = { flappy: flappyArtPack(), pacman: pacmanArtPack(), frogger: froggerArtPack() };
const sources = { kernel, softfloat, forthFloat, bdosBlock, illBlock, showcase, flappy, flappyDefs,
                  pacmanMap, pacmanGame, frogger, packs, layouts: layoutWords() };

test('browser builder matches the Node D16D image word for word', () => {
  const node = buildImage();
  const browser = Deep16D16DImage.build(sources);
  assert.deepEqual(Array.from(browser.words), Array.from(node.words));
  assert.deepEqual(browser.outOfWindow, node.outOfWindow);
  assert.deepEqual(Array.from(browser.bdos.words), Array.from(node.bdos.words),
                   'BDOS chapter matches');
  assert.deepEqual(Array.from(browser.sys.words), Array.from(node.sys.words),
                   'system chapter matches');
  assert.equal(browser.dictFree, node.dictFree);
  assert.equal(browser.biosEntry, node.biosEntry);
  assert.deepEqual(
    [...browser.showcase.words].sort((a, b) => a[0] - b[0]),
    [...node.showcase.words].sort((a, b) => a[0] - b[0]), 'menu block matches');
  assert.deepEqual(browser.pacman.words, node.pacman.words, 'pacman block matches');
  assert.equal(browser.fpu, true, 'the browser build carries the FPU library');
  assert.equal(node.fpu, true, 'the Node build carries the FPU library');
  assert.equal(browser.fpuWords, true, 'the browser build carries the Forth words');
  assert.equal(node.fpuWords, true, 'the Node build carries the Forth words');
  // Phase 4a stages the system chapter at 0x4A00 + offset for the BIOS
  // window: 0x5800 carries f_unpack and 0x6000 carries fexp32.
  assert.equal(node.words[0x5800], node.sys.words[0x0E00], 'the flat 0x5800 slot is the staged library');
  assert.equal(node.words[0x6000], node.sys.words[0x1600], 'the flat 0x6000 slot is the staged fexp32');
  assert.equal(browser.sys.words[0x0E00], node.sys.words[0x0E00], 'library word matches');
  assert.equal(browser.symbols.h_fdot, 0x417D, 'the Forth header block starts at 0x417D');
  assert.equal(browser.symbols.h_fexp, 0x42EF, 'fexp/flog headers end the 0x417D block');
  assert.equal(browser.words[browser.symbols.forth_wl], browser.symbols.h_fexp,
               'forth_wl names the newest float header');
  assert.notEqual(node.words[0x417D], 0xFFFF, 'the Forth float headers are in the image');
  assert.equal(browser.words[browser.symbols.d16d_exit], browser.symbols.d16d_menu_boot,
               'the f. scratch cells do not overwrite the D16D exit block');
  // The games are slices: the words above the FPU image stay empty.
  assert.equal(node.words[0x6FFF], node.bdos.words[0x629], 'the high tail is BDOS staging');
  assert.equal(node.words[0x6FFE], node.bdos.words[0x628], 'the high tail is BDOS staging');
  assert.notEqual(node.words[0x3FE9], 0xffff, 'the literal scanner is in the image');
  assert.equal(browser.symbols.scan_float, 0x3FE9, 'the literal scanner starts at 0x3FE9');
  assert.equal(node.words[0x4330], 0xffff, 'the PACMAN gap carries no FPU code');
  // The block (code, map, tables and tile pack) now runs past the BIOS, so
  // the old flat-image bake path is only a slice loader on the board.
});

test('the showcase does not overwrite any live kernel word', () => {
  const node = buildImage();
  // The menu is laid sparsely over 0x4D34..0x547F. A write over a real kernel
  // word silently replaces it: serial-read used to sit at 0x4E42, under the
  // menu, and xmodem died on the first SOH. The build reports every such hit.
  assert.deepEqual(node.collisions, [], 'no showcase word lands on kernel code');
  assert.equal(node.words[0x4400], 0x89a0, 'serial-read is intact at its new home');
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
  assert.equal(browser.words.length, 0x7000);
  assert.equal(browser.outOfWindow.includes(0xF0064), true, 'echo cell is outside the window');
  for (let a = 0xF3000; a <= 0xF3000 + 32; a++) {
    assert.equal(browser.words[a], undefined);
  }
});

test('the BIOS scatter carries the FPU library to segment 0x3000', () => {
  const image = Deep16D16DImage.build(sources);
  const memory = [];
  Deep16D16DImage.scatterD16SEG(image.words, { bdos: image.bdos, sys: image.sys, memory });
  assert.notEqual(image.bdos.words[0], 0xFFFF, 'the BDOS entry is in the chapter');
  assert.equal(memory[0x40000 + 0], image.bdos.words[0],
               'the scatter placed the BDOS chapter at 0x40000');
  // 0x5800 - 0x4A00 = 0x0E00, and 0x30000 + 0x0E00 = 0x30E00.
  assert.equal(memory[0x30E00], image.sys.words[0x0E00], 'f_unpack reached the system copy');
  // fexp32 sits at 0x6000: 0x6000 - 0x4A00 = 0x1600, so 0x31600.
  assert.equal(memory[0x31600], image.sys.words[0x1600], 'fexp32 reached the system copy');
  const libEnd = image.symbols.fpu_lib_end;
  assert.equal(memory[0x30E00 + (libEnd - 0x5800 - 1)], image.sys.words[0x0E00 + (libEnd - 0x5800 - 1)],
               'the last library word too');
  assert.equal(memory[0x32290], image.words[0x6C90], 'the tail below 0x7000 is copied as the loader does');
});

test('a broken kernel reports the assembler error', () => {
  assert.throws(() => Deep16D16DImage.build({ ...sources, kernel: 'NOT A WORD' }),
                /kernel does not assemble/);
});

test('missing showcase sources are rejected', () => {
  assert.throws(() => Deep16D16DImage.build({ kernel }), /showcase source/);
});

test('the board loader stages both chapters in free flat words', () => {
  const image = Deep16D16DImage.build(sources);
  assert.equal(image.bdosWindows.length, 9, 'nine BDOS windows');
  for (const win of image.bdosWindows) {
    for (let i = 0; i < win.len; i++) {
      assert.equal(image.words[win.src + i], image.bdos.words[win.dst + i],
                   `BDOS window 0x${win.src.toString(16)} + ${i}`);
    }
  }
  // The system chapter sits at 0x4A00 + offset, so the BIOS window carries it.
  for (const offset of [0x049f, 0x0600, 0x0e00, 0x1600, 0x1a75]) {
    assert.equal(image.words[0x4A00 + offset], image.sys.words[offset],
                 `system stage 0x${offset.toString(16)}`);
  }
  assert.equal(image.words[0x4330], 0xFFFF, 'the PACMAN gap stays free');
});
