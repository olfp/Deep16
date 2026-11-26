// Shared harness for the native LILA tests.
//
// Both tests boot the same segmented D16D image and drive the console the way
// a person at the keyboard does. `native-lila.test.js` types the compiler in
// line by line; `native-lila-slice.test.js` loads it from the config flash,
// the way the device does with `s" lila" need`.
//
// The image carries the FPU: the soft-float library and the Forth float words
// (`f+`, `f.`, `s>f`, ...). The float datatype needs them, so the compiler
// only loads on an FPU board.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadBrowserScripts, ROOT } from './helpers.js';
import { buildSlices, SCREEN_BASE } from '../scripts/make_slices.mjs';

const DS_SEG = 0x1000;

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
  loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_linker.js',
                     'js/deep16_simulator.js', 'js/deep16_d16d_image.js');
  const Deep16D16DImage = vm.runInThisContext('Deep16D16DImage');

  const kernel = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
  const softfloat = fs.readFileSync(path.join(ROOT, 'asm', 'softfloat.asm'), 'utf8');
  const forthFloat = fs.readFileSync(path.join(ROOT, 'asm', 'forth_float.asm'), 'utf8');

  // The FPU image: the soft-float library at 0x5800 and the Forth float words
  // at 0x417D, with the ILL trap wired to the BIOS copy of the library.
  const image = Deep16D16DImage.assembleNano({
    kernel, softfloat, forthFloat,
    defines: { D16D: 1, CONSOLE_MIRROR: 1 },
  });
  const sym = image.result.symbols;

  const slices = buildSlices();
  const sim = new globalThis.Deep16Simulator();
  // The same three copies the RTL flash loader makes: the flat image, the
  // kernel data in DS=0x1000 and the BIOS code in CS=0x3000.
  Deep16D16DImage.scatterD16SEG(image.words, { memory: sim.memory });
  sim.spiFlash.mem.set(slices.bytes, SCREEN_BASE);
  sim.d16nano = true;
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

  // The DeepForth prompt is "> " at the start of a line. The LILA prompt
  // "L> " ends in "> " as well, so the newline in front of it is what tells
  // the two apart.
  const atPrompt = (from) => out.slice(from).endsWith('\n> ');

  // The LILA prompt always follows a CR of its own, so it too starts a line.
  const atLilaPrompt = (from) => out.slice(from).endsWith('\nL> ');

  // Type one line. With drainToPrompt the call waits for the DeepForth
  // prompt; without it, for the LILA prompt, because that is where the
  // `lila` word leaves the machine once it has read a source line.
  function type(text, cap, drainToPrompt) {
    const from = out.length;
    for (const ch of `${text}\n`) sim.kbdBuffer.push(ch === '\n' ? 13 : ch.charCodeAt(0));
    if (drainToPrompt) {
      pump(cap, () => sim.kbdBuffer.length === 0 && atPrompt(from));
      pump(200_000, () => atPrompt(from));
    } else {
      pump(cap, () => sim.kbdBuffer.length === 0 && atLilaPrompt(from));
      pump(200_000, () => atLilaPrompt(from));
    }
    return out.slice(from);
  }

  function line(text, cap = 40_000_000) {
    return type(text, cap, true);
  }

  // What one source line printed: everything after the echo of the line
  // itself and before the prompt that follows it.  `keepCR` leaves the CR
  // bytes in: the console uses them to move the cursor, so the normal path
  // strips them and a string escape test cannot see a CR.
  function lineOutput(text, keepCR = false) {
    const nl = text.indexOf('\n');
    if (nl < 0) return '';
    let body = text.slice(nl + 1);
    if (body.endsWith('L> ')) body = body.slice(0, -3);
    return keepCR ? body : body.replace(/\r/g, '');
  }

  // Type a source program one line at a time. `lila` compiles and runs
  // every line as soon as it is complete, so the output appears while the
  // lines are typed. The result is the program's own output, without the
  // echo of the lines and without the prompts.  `keepCR` keeps the CR
  // bytes, for the string escape tests.
  function runProgram(lines, cap = 20_000_000, keepCR = false) {
    const parts = [];
    type('lila', 2_000_000, false);
    for (const input of lines) {
      parts.push(lineOutput(type(input, 4_000_000, false), keepCR));
    }
    type('', cap, true);            // the blank line ends the session
    const body = parts.join('').replace(/\n$/, '');
    return keepCR ? body : body.replace(/\r/g, '');
  }

  // Type a source program and return everything the console showed, from
  // the `lila` echo on. A blank line ends the session.
  function runSource(src, cap = 20_000_000) {
    const from = out.length;
    type('lila', 2_000_000, false);
    for (const input of src.split('\n')) {
      if (input !== '') type(input, 3_000_000, false);
    }
    type('', cap, true);
    return out.slice(from).replace(/\r/g, '');
  }

  function depth(cap = 4_000_000) {
    const echoed = line('depth . cr', cap);
    const m = echoed.slice(echoed.lastIndexOf('depth . cr') + 'depth . cr'.length)
      .match(/^\s+(-?\d+)/);
    return m ? Number(m[1]) : NaN;
  }

  function boot() {
    for (let i = 0; i < 60_000_000 && !out.endsWith('\n> '); i++) step(1);
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
    runProgram,
    runSource,
    lineOutput,
    depth,
    here,
    limit,
  };
}
