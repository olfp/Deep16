// The serial (CONSOLE_UART) build of the Forth kernel, end to end: boot it on
// the JS core, feed keystrokes into the UART RX, and read the UART TX back
// through the same SerialTerminal the IDE uses.
//
// This is the loop the screen tests cannot close: it proves the kernel actually
// emits on 0xF0042 and reads 0xF0040, so the terminal view shows a real REPL and
// not just a synthetic byte stream.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { assemble, loadBrowserScripts, buildMemory, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'deep16_terminal.js'), 'utf8'),
                    { filename: 'deep16_terminal.js' });
const SerialTerminal = vm.runInThisContext('SerialTerminal');

const src = fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8');
const uart = assemble(src, { defines: { CONSOLE_UART: 1 } });
const screen = assemble(src);

test('the UART build assembles', () => {
  assert.ok(uart.success, uart.errors.join('; '));
});

test('the screen build is untouched by the conditional', () => {
  // The conditional only chooses between two BIOS blocks; with CONSOLE_UART
  // undefined the screen build must still assemble.
  assert.ok(screen.success, screen.errors.join('; '));
  // The UART build defines the UART BIOS labels; the screen build must not.
  assert.equal(uart.symbols['uart_tx'] !== undefined, true, 'UART BIOS must be present');
  assert.equal(screen.symbols['uart_tx'], undefined, 'screen build must not contain the UART BIOS');
});

// Boot the UART kernel, type `input` (one '\n' per line) into the UART RX, and
// return the terminal rows, the raw byte stream and the step count.
function repl(input, maxSteps = 800000) {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(uart));
  // These are UART tests, not boot-script tests: skip forth/demo.fth so the
  // banner is the banner (tests/boot-script.test.js covers the script).
  sim.memory[uart.symbols.boot_ptr] = 0;
  sim.segmentRegisters.CS = 0xFFFF;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  for (const ch of input) sim.uartRxPush(ch === '\n' ? 13 : ch.charCodeAt(0));
  const term = new SerialTerminal();
  const stream = [];
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < maxSteps) {
    sim.step(); steps++;
    if (sim.uartTx.length) {
      const bytes = sim.uartTxTake();
      for (const b of bytes) stream.push(b);
      term.writeBytes(bytes);
    }
  }
  // The terminal grid is full width; compare rows the way the screen tests do,
  // with the trailing blanks stripped.
  const rows = term.text().map((r) => r.replace(/\s+$/, ''));
  return { sim, term, steps, stream, rows };
}

test('the UART kernel boots to the banner and the prompt', () => {
  const { rows, stream } = repl('');
  assert.equal(rows[0], 'Hello DeepForth!', `terminal was:\n${rows.join('\n')}`);
  assert.equal(rows[1], '>');
  // binit clears with ESC[2J, so the stream starts with it.
  assert.deepEqual(stream.slice(0, 4), [27, 0x5B, 0x32, 0x4A], 'binit must send ESC[2J');
});

test('a line typed into the UART is echoed and evaluated', () => {
  const { rows } = repl('3 4 + .\n');
  assert.equal(rows[1], '> 3 4 + . 7  ok', `terminal was:\n${rows.join('\n')}`);
  assert.equal(rows[2], '>');
});

test('backspace erases on the wire and in the buffer', () => {
  // "12", backspace, "3 ." evaluates 13.
  const { rows } = repl('12\b3 .\n');
  assert.equal(rows[1], '> 13 . 13  ok', `terminal was:\n${rows.join('\n')}`);
});

test('a colon definition is accepted over the serial line', () => {
  const { rows } = repl(': foo 41 ;\n42 foo + .\n');
  assert.equal(rows[1], '> : foo 41 ; ok', `terminal was:\n${rows.join('\n')}`);
  assert.equal(rows[2], '> 42 foo + . 83  ok');
});
