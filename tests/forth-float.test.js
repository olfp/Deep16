// The Forth surface for the soft-float library. A float is two cells, high
// half on top; the arithmetic words go through the ILL trap, while s>f/f>s
// call i2f/f2i directly. This boots the D16SEG nano kernel with the FPU words
// and types real Forth lines, so it covers the dictionary chain, the stack
// marshalling and the REPL, not just the raw routines.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadBrowserScripts, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js', 'js/deep16_d16d_image.js');
const Deep16D16DImage = vm.runInThisContext('Deep16D16DImage');

const kernel = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
const softfloat = fs.readFileSync(path.join(ROOT, 'asm', 'softfloat.asm'), 'utf8');
const forthFloat = fs.readFileSync(path.join(ROOT, 'asm', 'forth_float.asm'), 'utf8');

const image = Deep16D16DImage.buildNano({ kernel, softfloat, forthFloat });
assert.equal(image.fpu, true, 'the FPU library is included');
assert.equal(image.fpuWords, true, 'the Forth words are included');
assert.equal(image.symbols.h_fdot, 0x417D, 'the Forth headers start at 0x417D');
assert.equal(image.symbols.h_fexp, 0x42EB, 'the transcendental headers end the 0x417D block');

// `.org` rewinds silently, so prove the 0x417D block really was a free gap in
// the kernel+library image before the words were appended.
const plain = new globalThis.Deep16Assembler().assemble(`${kernel}\n${softfloat}`, {
  defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1, FPU_KERNEL: 1 },
});
assert.equal(plain.success, true, plain.errors.join('; '));
const occupied = new Set(plain.memoryChanges.map((c) => c.address));
for (let a = image.symbols.fpu_words_base; a < image.symbols.fpu_words_end; a++) {
  assert.ok(!occupied.has(a), `the float block overwrites 0x${a.toString(16)}`);
}
for (let a = image.symbols.fpu_dot_base; a < image.symbols.fpu_dot_cells_end; a++) {
  assert.ok(!occupied.has(a), `the f. scratch cells overwrite 0x${a.toString(16)}`);
}
for (const [lo, hi, what] of [
  ['lit_save_r10', 'lit_save_r10', 'the R10 save cell'],
  ['scan_float_probe', 'fpu_lit_probe_end', 'the literal probe'],
  ['scan_float', 'fpu_lit_end', 'the literal scanner'],
  ['sf_parse', 'fpu_lit_parse_end', 'the literal parser'],
  ['sf_build', 'fpu_lit_build_end', 'the literal build'],
  ['sf_parse_tramp', 'fpu_lit_tramp_end', 'the literal trampolines'],
  ['sf_reject', 'sf_reject', 'the literal reject path'],
  ['fpu_trans_base', 'fpu_trans_end', 'fexp/flog'],
]) {
  for (let a = image.symbols[lo]; a <= image.symbols[hi]; a++) {
    assert.ok(!occupied.has(a), `${what} overwrites 0x${a.toString(16)}`);
  }
}
assert.ok(image.symbols.word_fdot > image.symbols.fpu_lib_end,
          'f. follows the library and its helpers');
assert.ok(image.symbols.fpu_dot_end <= 0x7000, 'f. fits the image window');

function boot() {
  const sim = new globalThis.Deep16Simulator();
  Deep16D16DImage.scatterD16SEG(image.words, { memory: sim.memory });
  sim.d16nano = true;
  sim.running = true;
  // The flat copy is the one holding the headers and code.
  assert.equal(sim.memory[image.symbols.forth_wl], image.symbols.h_fexp,
               'forth_wl names the newest float header');

  let out = '';
  const step = () => {
    if (!sim.running) return false;
    sim.step();
    if (sim.uartTx.length) out += String.fromCharCode(...sim.uartTxTake());
    return true;
  };
  for (let i = 0; i < 4_000_000 && sim.running && !out.includes('> '); i++) step();
  assert.ok(sim.running, 'the kernel did not boot to the REPL');
  return { sim, step, text: () => out };
}

function line(ctx, source, cap = 3_000_000) {
  const from = ctx.text().length;
  for (const ch of source) ctx.sim.kbdBuffer.push(ch.charCodeAt(0));
  ctx.sim.kbdBuffer.push(10);
  for (let i = 0; i < cap && ctx.sim.running; i++) {
    ctx.step();
    const seg = ctx.text().slice(from);
    if ((seg.includes(' ok') || seg.includes('error')) && seg.includes('> ')) break;
  }
  return ctx.text().slice(from);
}

test('Forth arithmetic words use the trap and the two-cell float layout', () => {
  const ctx = boot();
  // 1.5 = 0x3FC0, 2.25 = 0x4010. The high cell is on top.
  assert.match(line(ctx, '0 16320 0 16400 f+ . .'), /f\+ \. \. 16496 0  ok/);
  assert.match(line(ctx, '0 16320 0 16400 f- . .'), /f- \. \. -16576 0  ok/);
  assert.match(line(ctx, '0 16320 0 16400 f* . .'), /f\* \. \. 16472 0  ok/);
  assert.match(line(ctx, '0 16448 0 16384 f/ . .'), /f\/ \. \. 16320 0  ok/);
  assert.match(line(ctx, '0 16512 fsqrt . .'), /fsqrt \. \. 16384 0  ok/);
  assert.match(line(ctx, '0 16320 fnegate u. u.'), /fnegate u\. u\. 49088 0  ok/);
  assert.match(line(ctx, '0 49088 fabs u. u.'), /fabs u\. u\. 16320 0  ok/);
});

test('Forth comparisons read FCMP flags before they are clobbered', () => {
  const ctx = boot();
  assert.match(line(ctx, '0 16320 0 16400 f< .'), /f< \. 1  ok/);
  assert.match(line(ctx, '0 16400 0 16320 f< .'), /f< \. 0  ok/);
  assert.match(line(ctx, '0 16320 0 16320 f= .'), /f= \. 1  ok/);
  assert.match(line(ctx, '0 16320 0 16400 f= .'), /f= \. 0  ok/);
  assert.match(line(ctx, '0 49088 f0< .'), /f0< \. 1  ok/);
  assert.match(line(ctx, '0 16320 f0< .'), /f0< \. 0  ok/);
  // The canonical NaN is unordered, so both comparisons are false.
  assert.match(line(ctx, '0 32704 0 16320 f< .'), /f< \. 0  ok/);
  assert.match(line(ctx, '0 32704 0 16320 f= .'), /f= \. 0  ok/);
});

test('s>f, f>s and f@/f! move whole floats', () => {
  const ctx = boot();
  assert.match(line(ctx, '3 s>f u. u.'), /s>f u\. u\. 16448 0  ok/);
  assert.match(line(ctx, '3 s>f f>s .'), /f>s \. 3  ok/);
  assert.match(line(ctx, '0 16320 f>s .'), /f>s \. 1  ok/, '1.5 truncates to 1');
  assert.match(line(ctx, '0 49088 f>s .'), /f>s \. -1  ok/, '-1.5 truncates to -1');

  assert.match(line(ctx, 'variable fx'), /variable fx ok/);
  assert.match(line(ctx, '0 16320 fx f!'), /fx f! ok/);
  assert.match(line(ctx, 'fx f@ u. u.'), /fx f@ u\. u\. 16320 0  ok/);
});

test('f. prints fixed-point decimals, scientific notation and the special values', () => {
  const ctx = boot();
  assert.match(line(ctx, '0 16320 f.'), /f\. 1\.5000  ok/);
  assert.match(line(ctx, '0 16400 f.'), /f\. 2\.2500  ok/);
  assert.match(line(ctx, '0 16128 f.'), /f\. 0\.5000  ok/);
  assert.match(line(ctx, '0 16000 f.'), /f\. 0\.2500  ok/);
  assert.match(line(ctx, '0 49088 f.'), /f\. -1\.5000  ok/);
  assert.match(line(ctx, '0 0 f.'), /f\. 0\.0000  ok/);
  assert.match(line(ctx, '0 32768 f.'), /f\. -0\.0000  ok/);
  assert.match(line(ctx, '0 18176 f.'), /f\. 3\.2767e4  ok/);
  assert.match(line(ctx, '1e10 f.'), /f\. 1\.0000e10  ok/);
  assert.match(line(ctx, '1e5 f.'), /f\. 1\.0000e5  ok/);
  assert.match(line(ctx, '-1e10 f.'), /f\. -1\.0000e10  ok/);
  assert.match(line(ctx, '65535.0 f.'), /f\. 6\.5534e4  ok/);
  assert.match(line(ctx, '9e-5 f.'), /f\. 9\.0000e-5  ok/);
  assert.match(line(ctx, '2e-38 f.'), /f\. 2\.0000e-38  ok/);
  assert.match(line(ctx, '1e-38 f.'), /f\. 0\.0000  ok/);
  assert.match(line(ctx, '0 32704 f.'), /f\. nan  ok/);
  assert.match(line(ctx, '0 32640 f.'), /f\. inf  ok/);
  // Two floats on one line prove f. leaves >IN and TIB intact.
  assert.match(line(ctx, '0 16320 f. 0 16400 f.'), /1\.5000 2\.2500  ok/);
});

test('float literal tokens push two cells or compile two LIT cells', () => {
  const ctx = boot();
  assert.match(line(ctx, '1.5 u. u.'), /1\.5 u\. u\. 16320 0  ok/);
  assert.match(line(ctx, '2.25 u. u.'), /2\.25 u\. u\. 16400 0  ok/);
  assert.match(line(ctx, '1e3 u. u.'), /1e3 u\. u\. 17530 0  ok/);
  assert.match(line(ctx, '1.5e2 f.'), /f\. 150\.0000  ok/);
  assert.match(line(ctx, '1.5e-2 f.'), /f\. 0\.0150  ok/);
  assert.match(line(ctx, '1.23456 f.'), /f\. 1\.2344  ok/);
  assert.match(line(ctx, '12345.6789 f.'), /f\. 12345\.6787  ok/);
  assert.match(line(ctx, ': t1 1.5 ; t1 f.'), /t1 f\. 1\.5000  ok/);
  assert.match(line(ctx, ': t2 2.25 ; t2 f.'), /t2 f\. 2\.2500  ok/);
  // Invalid forms fall back to the ordinary word scanner.
  assert.match(line(ctx, '1.5x .'), /undefined word: 1\.5x/);
  assert.match(line(ctx, '1..5 .'), /undefined word: 1\.\.5/);
  assert.match(line(ctx, '1e .'), /undefined word: 1e/);
  assert.match(line(ctx, '1. .'), /undefined word: 1\./);
});

test('fexp and flog compute and print', () => {
  const ctx = boot();
  assert.match(line(ctx, '1.0 fexp f.'), /f\. 2\.7182  ok/);
  assert.match(line(ctx, '2.0 flog f.'), /f\. 0\.6931  ok/);
  assert.match(line(ctx, '0.0 fexp f.'), /f\. 1\.0000  ok/);
  assert.match(line(ctx, '1.0 flog f.'), /f\. 0\.0000  ok/);
  assert.match(line(ctx, '-1.0 flog f.'), /f\. nan  ok/);
  assert.match(line(ctx, '100.0 fexp f.'), /f\. inf  ok/);
});

test('fdup, fdrop, fswap and fover shuffle whole floats', () => {
  const ctx = boot();
  assert.match(line(ctx, '0 16320 fdup f+ f.'), /fdup f\+ f\. 3\.0000  ok/);
  assert.match(line(ctx, '0 16320 0 16400 fdrop f.'), /fdrop f\. 1\.5000  ok/);
  assert.match(line(ctx, '0 16320 0 16400 fswap f.'), /fswap f\. 1\.5000  ok/);
  assert.match(line(ctx, '0 16320 0 16400 fover f. f. f.'),
               /fover f\. f\. f\. 1\.5000 2\.2500 1\.5000  ok/);
});
