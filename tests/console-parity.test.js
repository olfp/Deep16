// Three-core console parity (D16MINI.md §8 test 6): the same serial kernel, the
// same typed line, and the same bytes out - on the JS, WASM and RTL cores.
//
// The Rust/WASM core had no UART at all until now, so the console was never
// genuinely three-way: terminal mode fell back to the JS core on any compiled
// core that could not answer. The port is decoded in all three now, so this
// pins the byte stream itself, not just each core against its own expectation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {
  assemble, buildMemory, loadBrowserScripts, loadRtl, loadWasm, ROOT, MEM_WORDS,
} from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'deep16_terminal.js'), 'utf8'),
                    { filename: 'deep16_terminal.js' });
const SerialTerminal = vm.runInThisContext('SerialTerminal');

const uart = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8'),
                      { defines: { CONSOLE_UART: 1 } });

const rowsOf = (term) => term.text().map((r) => r.replace(/\s+$/, ''));

// These tests are about the console, not the boot script: the image now carries
// forth/demo.fth (read_line interprets it before the keyboard) and compiling it
// costs ~1M steps, which would dominate the suite. Zeroing `boot_ptr` boots
// straight to the REPL, exactly as the kernel did before the script existed.
// tests/boot-script.test.js is where the script itself is exercised.
const bootPtr = uart.symbols.boot_ptr;

// Boot the kernel, type `input` into the UART RX, and read the terminal grid
// and the raw TX byte stream back. The step caps differ only in cost: the RTL
// needs several clocks per instruction, the behavioural cores one step each.
function bootJs(input, maxSteps = 40000, script = false) {
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(buildMemory(uart));
  if (!script) sim.memory[bootPtr] = 0;
  sim.segmentRegisters.CS = 0xFFFF;
  for (const ch of input) sim.uartRxPush(ch === '\n' ? 13 : ch.charCodeAt(0));
  const term = new SerialTerminal();
  const stream = [];
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < maxSteps) {
    sim.step(); steps++;
    if (sim.uartTx.length) {
      const bytes = sim.uartTxTake();
      stream.push(...bytes);
      term.writeBytes(bytes);
    }
  }
  return { rows: rowsOf(term), stream };
}

async function bootWasm(input, maxSteps = 40000, script = false) {
  const w = await loadWasm();
  w.init(MEM_WORDS);
  for (const c of uart.memoryChanges) {
    w.load_program(c.address, new Uint16Array([c.value & 0xFFFF]));
  }
  if (!script) w.load_program(bootPtr, new Uint16Array([0]));
  w.set_segments(0xFFFF, 0, 0, 0);
  for (const ch of input) w.uart_rx_push(ch === '\n' ? 13 : ch.charCodeAt(0));
  const term = new SerialTerminal();
  const stream = [];
  let steps = 0, cont = true;
  while (cont && steps < maxSteps) {
    cont = w.step(); steps++;
    const bytes = Array.from(w.uart_tx_take());
    if (bytes.length) { stream.push(...bytes); term.writeBytes(bytes); }
  }
  return { rows: rowsOf(term), stream };
}

async function bootRtl(input, maxSteps = 60000, script = false) {
  const r = await loadRtl();
  r.init(MEM_WORDS);
  for (const c of uart.memoryChanges) {
    r.load_program(c.address, new Uint16Array([c.value & 0xFFFF]));
  }
  if (!script) r.load_program(bootPtr, new Uint16Array([0]));
  r.set_segments(0xFFFF, 0, 0, 0);
  for (const ch of input) r.uart_rx_push(ch === '\n' ? 13 : ch.charCodeAt(0));
  const term = new SerialTerminal();
  const stream = [];
  let steps = 0;
  while (steps < maxSteps) {
    r.step(); steps++;
    const bytes = r.uart_tx_take();
    if (bytes.length) { stream.push(...bytes); term.writeBytes(bytes); }
  }
  return { rows: rowsOf(term), stream };
}

// Run all three with the same input and the same generous caps, then compare.
// The RTL needs more steps because it pays several clocks per instruction.
async function threeWay(input, expect) {
  const js = bootJs(input);
  const wa = await bootWasm(input);
  const rtl = await bootRtl(input);
  if (expect) {
    for (const [name, r] of [['JS', js], ['WASM', wa], ['RTL', rtl]]) {
      assert.ok(r.rows.some((row) => row === expect),
                `${name} never reached ${JSON.stringify(expect)}; terminal was:\n${r.rows.join('\n')}`);
    }
  }
  return { js, wa, rtl };
}

test('the banner and the prompt are byte-identical on all three cores', async () => {
  const { js, wa, rtl } = await threeWay('', '>');
  assert.equal(js.rows[0], 'Hello DeepForth!');
  assert.equal(js.rows[1], '>');
  assert.deepEqual(wa.rows, js.rows, 'WASM terminal diverges');
  assert.deepEqual(rtl.rows, js.rows, 'RTL terminal diverges');
  assert.deepEqual(wa.stream, js.stream, 'WASM byte stream diverges');
  assert.deepEqual(rtl.stream, js.stream, 'RTL byte stream diverges');
});

test('a line that fills the width hard-wraps at 80 columns', async () => {
  // No wrap_if here: `emit` just puts bytes out. The console BIOS must break
  // the line itself at 80, because the terminal may be wider than the machine
  // (or not autowrap at all).
  const input = ': t 90 0 do 65 emit loop ; t\n';
  const js = bootJs(input, 200000);
  const wa = await bootWasm(input, 200000);
  const rtl = await bootRtl(input, 1000000);
  const lines = Buffer.from(js.stream).toString('latin1').split('\r\n');
  for (const l of lines) assert.ok(l.length <= 80, `line of ${l.length} columns`);
  const a = lines.reduce((n, l) => n + (l.match(/A/g) || []).length, 0);
  assert.equal(a, 90, 'all 90 characters came out');
  assert.ok(lines.filter((l) => l.includes('A')).length >= 2, 'the run wrapped');
  assert.deepEqual(wa.stream, js.stream, 'WASM byte stream diverges');
  assert.deepEqual(rtl.stream, js.stream, 'RTL byte stream diverges');
});

test('a typed line is echoed and evaluated identically on all three cores', async () => {
  const { js, wa, rtl } = await threeWay('3 4 + .\n', '> 3 4 + . 7  ok');
  assert.equal(js.rows[1], '> 3 4 + . 7  ok');
  assert.deepEqual(wa.rows, js.rows, 'WASM terminal diverges');
  assert.deepEqual(rtl.rows, js.rows, 'RTL terminal diverges');
  assert.deepEqual(wa.stream, js.stream, 'WASM byte stream diverges');
  assert.deepEqual(rtl.stream, js.stream, 'RTL byte stream diverges');
});

test('backspace is handled identically on all three cores', async () => {
  // "12", backspace, "3 ." evaluates 13; the wire carries BS SP BS.
  const { js, wa, rtl } = await threeWay('12\b3 .\n', '> 13 . 13  ok');
  assert.deepEqual(wa.rows, js.rows, 'WASM terminal diverges');
  assert.deepEqual(rtl.rows, js.rows, 'RTL terminal diverges');
  assert.deepEqual(wa.stream, js.stream, 'WASM byte stream diverges');
  assert.deepEqual(rtl.stream, js.stream, 'RTL byte stream diverges');
});

test('words breaks at a space before the terminal edge', async () => {
  // The UART has no cursor to ask, so the console BIOS counts its output
  // column (uat_tx -> out_col) and wrap_if breaks the list at a space before
  // a name would run past column 80. Without it the whole list is one long
  // line and the host autowraps through the names.
  // The list is long, and the RTL cap counts clocks, not instructions: the JS
  // finishes its output at ~111k steps, the RTL at ~740k clocks.
  const input = 'words\n';
  const js = bootJs(input, 200000);
  const wa = await bootWasm(input, 200000);
  const rtl = await bootRtl(input, 1000000);
  const lines = Buffer.from(js.stream).toString('latin1').split('\r\n');
  assert.ok(lines.length > 10, 'the list wrapped onto several lines');
  // A kernel line may be longer than 80 only where a token plus its separator
  // lands exactly on the edge: the host then autowraps after the space. So
  // every 80th column of such a line must be that space - a non-space there
  // means the terminal split a name.
  for (const l of lines) {
    for (let col = 80; col < l.length; col += 80) {
      assert.equal(l[col - 1], ' ', `autowrap at column ${col} splits a token: ${JSON.stringify(l.slice(0, 90))}`);
    }
  }
  for (const l of lines) assert.ok(l.length <= 80, `line of ${l.length} columns`);
  assert.deepEqual(wa.stream, js.stream, 'WASM byte stream diverges');
  assert.deepEqual(rtl.stream, js.stream, 'RTL byte stream diverges');
});
