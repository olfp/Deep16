// Shared harness for the native LILA tests.
//
// Both tests boot the same segmented D16D image and drive the console the way
// a person at the keyboard does. `native-lila.test.js` types the compiler in
// line by line; `native-lila-slice.test.js` loads it from the config flash,
// the way the device does with `s" lila" need`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, MEM_WORDS, ROOT } from './helpers.js';
import { buildSlices, SCREEN_BASE } from '../scripts/make_slices.mjs';

const WINDOW = 0x6000;
const DS_SEG = 0x1000;
const BIOS_SEG = 0x3000;
const DS_LO = 0x3000;
const DS_HI = 0x57dc;
const BIOS_LO = 0x4a00;
const BIOS_HI = 0x57ff;

// The fixture program, and the output lua5.4 5.4.8 prints for it.
export const PROGRAM = [
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

export const EXPECTED = [
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

export function bootNative() {
  loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

  const kernel = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8'),
                          { defines: { CONSOLE_UART: 1, D16NANO: 1, D16SEG: 1, D16D: 1,
                                       CONSOLE_MIRROR: 1 } });
  assert.ok(kernel.success, kernel.errors.join('\n'));
  const sym = kernel.symbols;

  const mem = new Array(MEM_WORDS).fill(0xffff);
  for (const c of kernel.memoryChanges) {
    if (c.address < WINDOW) mem[c.address] = c.value & 0xffff;
  }
  for (let w = DS_LO; w <= DS_HI; w++) mem[(DS_SEG << 4) + w] = mem[w];
  for (let w = BIOS_LO; w <= BIOS_HI; w++) mem[(BIOS_SEG << 4) + (w - BIOS_LO)] = mem[w];

  const slices = buildSlices();
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(mem);
  sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);
  sim.segmentRegisters.CS = 0xffff;
  sim.running = true;

  // The kernel's cells live in DS=0x1000, not in the flat copy the assembler
  // wrote at 0x0000-0x5FFF, so every symbol read has to go through the segment.
  const ds = (addr) => sim.memory[(DS_SEG << 4) + addr];
  const here = () => ds(sym.dp_var);
  const limit = () => ds(sym.dict_limit_var);

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

  // Type one line. With drainToPrompt the call waits for the REPL prompt;
  // without it, for the keyboard buffer to empty (the `lila` word reads its
  // own source with accept, so there is no prompt until it has run).
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

  // Type one source program and return everything printed from the `lila`
  // echo on. A blank line ends the source.
  function runSource(src, cap = 20_000_000) {
    const from = out.length;
    type('lila', 2_000_000, false);
    for (const input of src.split('\n')) {
      if (input !== '') type(input, 3_000_000, false);
    }
    type('', cap, true);
    return out.slice(from).replace(/\r/g, '');
  }

  // The program's own output: the lines between the blank line and the
  // prompt, without the prompt and the interpreter's " ok".
  function programOutput(from) {
    return out.slice(from).replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''))
      .filter((l) => l !== '' && l !== '>' && l !== ' ok').join('\n');
  }

  function depth(cap = 4_000_000) {
    const echoed = line('depth . cr', cap);
    const m = echoed.slice(echoed.lastIndexOf('depth . cr') + 'depth . cr'.length)
      .match(/^\s+(-?\d+)/);
    return m ? Number(m[1]) : NaN;
  }

  function boot() {
    for (let i = 0; i < 60_000_000 && !out.includes('> '); i++) step(1);
    return out;
  }

  return {
    sim,
    sym,
    slices,
    get out() { return out; },
    boot,
    type,
    line,
    runSource,
    programOutput,
    depth,
    here,
    limit,
  };
}
