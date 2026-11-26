// The chapter linker (MEMFIXPLAN phase 1).
//
// Phase 1 links one flat chapter and must not change a byte of the image. The
// last test pins the Phase 0 build id and CRC; update those only when a later
// phase intentionally changes the memory layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, loadBrowserScripts } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_linker.js');
const Linker = globalThis.Deep16Linker;
const linker = () => new Linker(globalThis.Deep16Assembler);

const flat = (source, options = {}) => {
  const { window = 0x6000, ...chapter } = options;
  return linker().link({ chapters: [Linker.flat({ sources: [source], ...chapter })], window });
};

test('a flat link reproduces direct assembly word for word', () => {
  const source = 'start:\n  LDI 1\n  .word 0x1234\n  NOP\n';
  const direct = assemble(source);
  const linked = flat(source, { window: 0x20 });

  assert.equal(linked.flatView.success, true);
  assert.deepEqual(linked.flatView.memoryChanges.map((c) => [c.address, c.value]),
                   direct.memoryChanges.map((c) => [c.address, c.value]));

  const expected = new Uint16Array(0x20).fill(0xFFFF);
  for (const c of direct.memoryChanges) expected[c.address] = c.value;
  assert.deepEqual(Array.from(linked.flatView.words), Array.from(expected));
});

test('the manifest names the flat chapter and its window', () => {
  const linked = flat('NOP\n', { window: 0x20 });
  assert.equal(linked.manifest.format, 1);
  assert.equal(linked.manifest.window, 0x20);
  assert.equal(linked.manifest.fill, 0xFFFF);
  assert.equal(linked.manifest.chapters.length, 1);
  assert.equal(linked.manifest.chapters[0].id, 'flat');
  assert.equal(linked.manifest.chapters[0].physical, 0);
  assert.equal(linked.manifest.chapters[0].wordCount, 1);
});

test('two chapters cannot claim the same segment', () => {
  assert.throws(() => linker().link({
    chapters: [Linker.flat({ id: 'a', sources: ['NOP\n'] }),
               Linker.flat({ id: 'b', sources: ['NOP\n'] })],
  }), /both claim segment/);
});

test('two chapters that write one address fail the merge', () => {
  const linked = linker().link({
    chapters: [
      { id: 'a', seg: 0x0000, base: 0, sources: ['.org 0\n  NOP\n'] },
      { id: 'b', seg: 0x0100, base: 0, sources: ['.org 0\n  NOP\n'] },
    ],
    window: 0x2000,
  });
  assert.equal(linked.flatView.success, false);
  assert.match(linked.flatView.errors.join('; '), /both write 0x0/);
});

test('an import is resolved from the placement pass', () => {
  const linked = linker().link({
    chapters: [
      { id: 'a', seg: 0x0000, base: 0, sources: ['.org 0\nA:\n  LDI 7\n'] },
      { id: 'b', seg: 0x0100, base: 0, sources: ['.org 0x1000\nB:\n  LDI A\n'] },
    ],
    imports: { b: ['A'] },
    window: 0x2000,
  });
  assert.equal(linked.flatView.success, true, linked.flatView.errors.join('; '));
  const ldiZero = assemble('LDI 0\n').memoryChanges[0].value;
  assert.equal(linked.chapters[1].words[0], ldiZero, 'B loaded A, whose value is 0');
  assert.equal(linked.chapters[1].physical, 0x1000);
  assert.equal(linked.symbols.B, 0x1000);
});

test('a relative chapter keeps its .org as the in-segment offset', () => {
  const linked = linker().link({
    chapters: [
      Linker.flat({ sources: ['NOP\n'] }),
      { id: 'bdos', seg: 0x4000, base: 0, relative: true,
        sources: ['.org 0x10\nbdos_probe:\n  LSI R0, 1\n  JML R10\n'] },
    ],
    window: 0x20,
  });
  assert.equal(linked.flatView.success, true, linked.flatView.errors.join('; '));
  const bdos = linked.chapters[1];
  assert.equal(bdos.physical, 0x40000);
  assert.equal(bdos.words[0x10], assemble('LSI R0, 1\n').memoryChanges[0].value);
  assert.equal(bdos.words[0x11], assemble('JML R10\n').memoryChanges[0].value);
  assert.equal(linked.flatView.words[0x10], 0xFFFF,
               'the BDOS offset is not in the flat kernel image');
});

test('an unknown import is an error, not a silent zero', () => {
  assert.throws(() => linker().link({
    chapters: [{ id: 'b', seg: 0, base: 0, sources: ['NOP\n'] }],
    imports: { b: ['nope'] },
  }), /unknown symbol 'nope'/);
});

test('the constant pool assigns indices and emits the words', () => {
  const pool = Linker.constantPool([
    { name: 'foo', value: 0x1234 },
    { name: 'far', words: [0x3000, 0x0042] },
  ]);
  assert.deepEqual(pool.equ, { CONST_foo: 0, CONST_far: 1 });
  assert.deepEqual(pool.indices, { foo: 0, far: 1 });
  assert.deepEqual(pool.words, [0x1234, 0x3000, 0x0042]);
  assert.equal(pool.nextIndex, 3);
});

test('the LDC and LDC_FAR source forms are the documented sequences', () => {
  assert.equal(Linker.ldc('R2', 'foo'), 'LDI CONST_foo\nLDS R2, CS, R0');
  assert.equal(Linker.ldcFar('far'),
               'LDI CONST_far\nLDS R10, CS, R0\nADD R0, 1\nLDS R11, CS, R0\nJML R10');
});

test('a pool index past 0x3fff is refused', () => {
  assert.throws(() => Linker.constantPool([{ name: 'x', words: [1, 2] }],
                                         { firstIndex: 0x3FFF }),
                /past 0x3fff/);
});

test('a link can emit the pool words and inject the CONST_ equ', () => {
  const linked = linker().link({
    chapters: [Linker.flat({ sources: ['.org 0\n  LDI CONST_foo\n'] })],
    window: 0x20,
    pool: { entries: [{ name: 'foo', value: 0xBEEF }], address: 0x10 },
  });
  const ldiZero = assemble('LDI 0\n').memoryChanges[0].value;
  assert.equal(linked.flatView.words[0], ldiZero, 'CONST_foo is index 0');
  assert.equal(linked.flatView.words[0x10], 0xBEEF);
  assert.equal(linked.manifest.pool.words, 1);
  assert.deepEqual(linked.manifest.pool.entries, { foo: 0 });
});

test('a pool over live code is a collision', () => {
  assert.throws(() => linker().link({
    chapters: [Linker.flat({ sources: ['.org 0\n  NOP\n'] })],
    window: 0x20,
    pool: { entries: [{ name: 'foo', value: 1 }], address: 0 },
  }), /collides with chapter code/);
});

// The Phase 2b baseline. scripts/make_image.mjs now assembles through the
// linker; if this changes, the linker altered the image (a bug) or a later
// phase deliberately moved the layout (update the pin then).
process.env.D16NANO = '1';
process.env.D16D = '1';
process.env.D16SEG = '1';
const { buildImage, crc16 } = await import('../scripts/make_image.mjs');

test('the Phase 2b image keeps the linker output stable', () => {
  const img = buildImage();
  assert.equal(img.build, '161181bd81d079f3', 'build id changed');
  assert.equal(crc16(img.words), 0xe56b, 'image bytes changed');
  assert.equal(img.words.length, 28672);
  assert.equal(img.biosWords, 8848);
});
