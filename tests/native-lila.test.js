// The on-device LILA compiler in lila/native/lila-native.fth.
//
// This boots the same segmented D16D image as segmented.test.js, types the
// compiler in through the console, and runs a Lua-subset program on the
// machine. The expected output is a fixture captured from lua5.4, so the test
// does not need a host Lua. It also asserts that a successful run leaves the
// data stack at depth 0: every compile-time and run-time value has been
// consumed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, MEM_WORDS, ROOT } from './helpers.js';
import { buildSlices, SCREEN_BASE } from '../scripts/make_slices.mjs';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const WINDOW = 0x6000;
const DS_SEG = 0x1000;
const BIOS_SEG = 0x3000;
const DS_LO = 0x3000;
const DS_HI = 0x57dc;
const BIOS_LO = 0x4a00;
const BIOS_HI = 0x57ff;

const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1, D16D: 1,
                                     CONSOLE_MIRROR: 1 } });
assert.ok(kernel.success, kernel.errors.join('\n'));
const sym = kernel.symbols;

function scattered() {
  const mem = new Array(MEM_WORDS).fill(0xffff);
  for (const c of kernel.memoryChanges) {
    if (c.address < WINDOW) mem[c.address] = c.value & 0xffff;
  }
  const img = (a) => mem[a];
  for (let w = DS_LO; w <= DS_HI; w++) mem[(DS_SEG << 4) + w] = img(w);
  for (let w = BIOS_LO; w <= BIOS_HI; w++) mem[(BIOS_SEG << 4) + (w - BIOS_LO)] = img(w);
  return mem;
}

const slices = buildSlices();
const sim = new globalThis.Deep16Simulator();
sim.loadProgram(scattered());
sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);
sim.segmentRegisters.CS = 0xffff;
sim.running = true;

let out = '';
function step(n) {
  for (let i = 0; i < n; i++) {
    if (!sim.running) return false;
    sim.step();
    if (sim.uartTx.length) out += String.fromCharCode(...sim.uartTxTake());
  }
  return true;
}

function pump(n, until) {
  for (let i = 0; i < n && sim.running; i++) {
    sim.step();
    if (sim.uartTx.length) out += String.fromCharCode(...sim.uartTxTake());
    if (until && (i & 63) === 0 && until()) return true;
  }
  return false;
}

const atPrompt = (from) => {
  const tail = out.slice(from);
  return tail.includes('\n') && tail.endsWith('> ');
};

function type(text, cap, drainToPrompt) {
  const from = out.length;
  for (const ch of `${text}\n`) sim.kbdBuffer.push(ch === '\n' ? 13 : ch.charCodeAt(0));
  if (drainToPrompt) {
    pump(cap, () => sim.kbdBuffer.length === 0 && atPrompt(from));
    pump(200_000, () => atPrompt(from));
  } else {
    pump(cap, () => sim.kbdBuffer.length === 0);
    pump(100_000, () => sim.kbdBuffer.length === 0);
  }
  return out.slice(from);
}

function line(text, cap = 40_000_000) {
  return type(text, cap, true);
}

// Boot the kernel and wait for the REPL prompt.
const boot = (() => {
  for (let i = 0; i < 60_000_000 && !out.includes('> '); i++) step(1);
  return out;
})();

// Type the compiler source in one line at a time and remember anything the
// outer interpreter rejected.
const compiler = fs.readFileSync(path.join(ROOT, 'lila', 'native', 'lila-native.fth'), 'utf8')
  .split('\n');
const loadFails = [];
let loaded = '';
for (const src of compiler) {
  const echoed = type(src, 8_000_000, true);
  loaded += echoed;
  if (/undefined word|stack underflow|error -?\d+|redefined/i.test(echoed) &&
      !/^: \S+ \(/.test(src)) {
    loadFails.push({ src, echoed: echoed.replace(/\r/g, '').trim().slice(0, 160) });
  }
}

// The program and the fixture lua5.4 5.4.8 prints for it.
const program = [
  'x = 3',
  'y = x + 4 * 2',
  'if y > 10 then print(y) else print(0) end',
  'while x < 6 do x = x + 1 end',
  'print(x)',
  'print("a" .. "b")',
  'print("a" .. "b" .. "c")',
  'print(y > 10)',
  'print(1 ~= 2, 2 <= 2)',
  'print(-y)',
  'print((1 + 2) * 3)',
  'print(70000)',
  'print(100000 * 3)',
  'print(2147483647)',
  'print(-2147483647)',
  'print(65536 + 1)',
  'print(-1 < 0, 100000 > 99999)',
  'if 0 then print("zero") else print("no") end',
  'print(z)',
];
const expected = [
  '11',
  '6',
  'ab',
  'abc',
  'true',
  'true\ttrue',
  '-11',
  '9',
  '70000',
  '300000',
  '2147483647',
  '-2147483647',
  '65537',
  'true\ttrue',
  'zero',
  'nil',
].join('\n');

type('lila', 2_000_000, false);
for (const src of program) type(src, 4_000_000, false);
const programMark = out.length;
type('', 20_000_000, true);   // the blank line ends the source and runs it

const raw = out.slice(programMark).replace(/\r/g, '');
const got = raw.split('\n').map((l) => l.replace(/\s+$/, ''))
  .filter((l) => l !== '' && l !== '>' && l !== ' ok')
  .join('\n');

const depthEcho = line('depth . cr');
const depth = Number(depthEcho.slice(depthEcho.lastIndexOf('depth . cr') + 'depth . cr'.length)
  .match(/^\s+(-?\d+)/)?.[1]);

// Type one source program and return everything printed from the `lila` echo
// on. A blank line ends the source.
function runSource(src, cap = 20_000_000) {
  const from = out.length;
  type('lila', 2_000_000, false);
  for (const input of src.split('\n')) {
    if (input !== '') type(input, 3_000_000, false);
  }
  type('', cap, true);
  return out.slice(from).replace(/\r/g, '');
}

test('the segmented image boots', () => {
  assert.match(boot, /> /);
  assert.equal(sim.segmentRegisters.DS, DS_SEG, 'DS');
});

test('the compiler loads without an interpreter error', () => {
  assert.deepEqual(loadFails, []);
  assert.match(loaded, /> /);
});

test('the program compiles and runs with lua5.4 output', () => {
  assert.equal(got, expected);
  assert.ok(sim.running);
});

test('a successful run leaves the data stack at depth 0', () => {
  assert.equal(depth, 0, depthEcho.replace(/\r/g, ''));
});

// Syntax outside the profile must be rejected with a code, not reinterpreted.
const rejected = [
  ['division', 'print(1 / 2)', -20],
  ['power', 'print(2 ^ 3)', -20],
  ['modulo', 'print(5 % 2)', -20],
  ['and', 'if 1 and 2 then print(1) end', -14],
  ['function', 'function f() end', -21],
  ['local', 'local x = 1', -21],
  ['table', 't = {}', -9],
  ['missing end', 'if 1 then print(1)', -15],
  ['unterminated while', 'while 1 do print(1)', -17],
  ['newline in string', 'print("a\nb")', -3],
  ['unbalanced paren', 'print((1 + 2)', -20],
  ['literal out of range', 'print(2147483648)', -22],
  ['literal far out of range', 'print(99999999999)', -22],
];

test('syntax outside the profile is rejected with a code', () => {
  for (const [name, src, code] of rejected) {
    const text = runSource(src);
    const m = text.match(/LERR (-?\d+)/);
    assert.ok(m, `${name}: no LERR in ${JSON.stringify(text)}`);
    assert.equal(Number(m[1]), code, name);
  }
});

test('a comment-only or empty source compiles to a halt', () => {
  for (const [name, src] of [['comment only', '-- nothing'], ['empty source', '']]) {
    const text = runSource(src);
    assert.doesNotMatch(text, /LERR/, name);
    assert.match(text, /ok\n/, name);
  }
});
