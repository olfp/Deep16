// The D16MINI boot image (scripts/make_image.mjs, D16MINI.md §6.5).
//
// The image is a synthesis input, so it cannot be run here - but its content can
// be checked exactly: every assembled word in the window, the 0xFFFF fill, the
// BIOS at its fixed address, and the one word that must stay out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildImage, checkImage, imageHex, packImage, expandImage, checkPacked,
         IMG_BLOCK_WORDS, WINDOW, FILL, BIOS_BASE, STACK_BASE, ECHO_FLAG }
  from '../scripts/make_image.mjs';
import { assemble, loadBrowserScripts, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js');

const img = buildImage();
const res = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8'),
                     { defines: { CONSOLE_UART: 1 } });

test('the image is the whole window, filled with the halt word', () => {
  assert.equal(img.words.length, WINDOW, 'the whole BSRAM window');
  // Every word not written by the program is 0xFFFF (the halt word), not 0.
  const written = new Set(res.memoryChanges.filter((c) => c.address < WINDOW).map((c) => c.address));
  for (let a = 0; a < WINDOW; a++) {
    if (!written.has(a)) assert.equal(img.words[a], FILL, `0x${a.toString(16)} is not the fill`);
  }
});

test('every assembled word in the window is in the image', () => {
  for (const c of res.memoryChanges) {
    if (c.address >= WINDOW) continue;
    assert.equal(img.words[c.address], c.value & 0xFFFF, `word at 0x${c.address.toString(16)}`);
  }
});

test('the BIOS sits at its fixed address', () => {
  assert.equal(img.biosEntry, BIOS_BASE);
  // 222 words before the calling convention moved from memory to registers; the
  // register form is the shorter of the two (updated with that change). 319
  // after uart_tx grew the output-column counter, the hard wrap and the ANSI
  // state (§4.4), 368 after binit grew to home + ESC[2J + ESC[3J.
  assert.equal(img.biosWords, 368, 'the UART BIOS size');
  assert.equal(img.words[BIOS_BASE], res.memoryChanges.find((c) => c.address === BIOS_BASE).value);
  assert.ok(BIOS_BASE + img.biosWords <= STACK_BASE, 'the BIOS must not reach the stacks');
});

test('the only word outside the window is the echo flag', () => {
  assert.deepEqual(img.outOfWindow, [ECHO_FLAG],
                   'the kernel echo cell is outside the window, so the board drops it');
});

test('checkImage accepts a good image', () => {
  assert.equal(checkImage(img), true);
});

test('checkImage rejects a dictionary that reaches the stacks', () => {
  assert.throws(() => checkImage({ ...img, dictFree: STACK_BASE }), /reaches the stacks/);
  assert.throws(() => checkImage({ ...img, biosEntry: 0xF8000 }),
                new RegExp(`expected 0x${BIOS_BASE.toString(16)}`));
  assert.throws(() => checkImage({ ...img, outOfWindow: [0xF8000] }), /outside the window/);
});

test('the $readmemh form round-trips', () => {
  const parsed = imageHex(img).trim().split(/\s+/).map((h) => parseInt(h, 16));
  assert.equal(parsed.length, WINDOW);
  assert.deepEqual(parsed, Array.from(img.words));
});

test('range packing expands back to the flat image exactly', () => {
  const packed = packImage(img);
  assert.equal(checkPacked(img, packed), true);
  const back = expandImage(packed.words);
  assert.deepEqual(Array.from(back.words), Array.from(img.words));
  assert.equal(back.src, packed.words.length, 'every payload word is consumed');
});

test('the packed image fits 16 BSRAM blocks', () => {
  const packed = packImage(img);
  assert.ok(packed.words.length <= IMG_BLOCK_WORDS,
            `${packed.words.length} words do not fit ${IMG_BLOCK_WORDS}`);
  assert.ok(packed.ranges.length <= 31, 'the count fits the loader register');
  // The format is count, then (start,end) pairs, then contiguous payload.
  assert.equal(packed.words[0], packed.ranges.length);
  const payload = packed.words.length - 1 - 2 * packed.ranges.length;
  assert.equal(payload, packed.ranges.reduce((n, [s, e]) => n + e - s + 1, 0));
  for (let r = 1; r < packed.ranges.length; r++) {
    assert.ok(packed.ranges[r - 1][1] + 1 < packed.ranges[r][0], 'ranges are disjoint and ascending');
  }
});

test('checkPacked rejects an image over the block budget', () => {
  const huge = { words: Array(WINDOW).fill(0x1234), ranges: Array(WINDOW).fill([0, 0]) };
  assert.throws(() => checkPacked(img, huge), /over the/);
});
