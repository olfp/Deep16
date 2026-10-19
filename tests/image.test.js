// The D16MINI boot image (scripts/make_image.mjs, D16MINI.md §6.5).
//
// The image is a synthesis input, so it cannot be run here - but its content can
// be checked exactly: every assembled word in the window, the 0xFFFF fill, the
// BIOS at its fixed address, and the one word that must stay out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildImage, checkImage, imageHex, WINDOW, FILL, BIOS_BASE, STACK_BASE, ECHO_FLAG }
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
  // register form is the shorter of the two (updated with that change). 272
  // after uart_tx grew the output-column counter and the hard wrap (§4.4).
  assert.equal(img.biosWords, 272, 'the UART BIOS size');
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
