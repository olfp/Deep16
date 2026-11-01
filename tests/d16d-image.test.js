// Browser D16D image builder vs scripts/make_image.mjs. The browser version is
// code only; graphics are the flash blob, not part of this image.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { ROOT } from './helpers.js';

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

test('browser builder matches the Node D16D image word for word', () => {
  const node = buildImage();
  const browser = Deep16D16DImage.build({ kernel, showcase, flappy });
  assert.deepEqual(Array.from(browser.words), Array.from(node.words));
  assert.deepEqual(browser.outOfWindow, node.outOfWindow);
  assert.equal(browser.dictFree, node.dictFree);
  assert.equal(browser.biosEntry, node.biosEntry);
});

test('the image is code plus the showcase, not graphics', () => {
  const browser = Deep16D16DImage.build({ kernel, showcase, flappy });
  assert.equal(browser.words.length, 0x6000);
  assert.equal(browser.outOfWindow.includes(0xF0064), true, 'echo cell is outside the window');
  // Graphics windows are not part of the 24K image: the flash loader fills them.
  for (let a = 0xF3000; a <= 0xF3000 + 32; a++) {
    assert.equal(browser.words[a], undefined);
  }
});

test('a broken kernel reports the assembler error', () => {
  assert.throws(() => Deep16D16DImage.build({ kernel: 'NOT A WORD', showcase, flappy }),
                /kernel does not assemble/);
});

test('missing showcase sources are rejected', () => {
  assert.throws(() => Deep16D16DImage.build({ kernel }), /showcase and flappy/);
});
