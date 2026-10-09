// DeepForth REPL — behavioural contract (phase P0 of the DeepForth expansion).
//
// Each test boots the kernel fresh, types into the keyboard FIFO and reads
// the 80x25 screen back. The assertions pin the externally visible REPL
// behaviour: input echo, results, " ok", the prompt, error reporting and
// recovery — on the JS core (the WASM core parity is covered by
// shadow.test.js).
//
// Known quirks that are deliberately NOT pinned here because later phases
// rework them (see the DeepForth expansion plan):
//   - `.` terminates the input line: `1 . 2 .` discards the rest of the line,
//   - `0 .` prints without the trailing space and does NOT terminate the line
//     (nonzero `.` does both) — pinned as-is in the number test,
//   - bare strings (`"hi there`) swallow the remainder of the line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, buildMemory, ROOT, SCREEN_ADDR } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const src = fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8');
const res = assemble(src);

test('forth.asm assembles', () => {
  assert.ok(res.success, res.errors.join('; '));
});

// Boot the REPL, type `input` (one '\n' per line) and return the screen
// rows (trailing whitespace stripped), the executed step count and whether
// the CPU is still running inside the REPL.
function repl(input, maxSteps = 600000) {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  for (const ch of input) sim.enqueueKeyCode(ch === '\n' ? 10 : ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < maxSteps) { sim.step(); steps++; }
  const rows = [];
  for (let r = 0; r < 25; r++) {
    let s = '';
    for (let c = 0; c < 80; c++) {
      s += String.fromCharCode(sim.memory[SCREEN_ADDR + r * 80 + c] & 0xFF);
    }
    rows.push(s.replace(/\s+$/, ''));
  }
  return { rows, steps, running: sim.running };
}

test('boots to the banner and an empty prompt', () => {
  const { rows, running } = repl('');
  assert.equal(rows[0], 'Hello DeepForth!');
  assert.equal(rows[1], '>');
  assert.ok(running, 'the REPL must wait for input');
});

test('evaluates a line: echo, result and " ok"', () => {
  const { rows, running } = repl('3 4 + .\n');
  assert.equal(rows[1], '> 3 4 + . 7  ok');
  assert.equal(rows[2], '>');
  assert.ok(running, 'the REPL must come back to the prompt');
});

test('the core stack words: * dup swap drop and chained arithmetic', () => {
  const { rows, running } = repl(
    '2 3 * .\n' +
    '7 dup + .\n' +
    '5 6 swap .\n' +
    '1 2 drop .\n' +
    '2 3 + 4 * .\n'
  );
  assert.equal(rows[1], '> 2 3 * . 6  ok');
  assert.equal(rows[2], '> 7 dup + . 14  ok');
  assert.equal(rows[3], '> 5 6 swap . 5  ok');
  assert.equal(rows[4], '> 1 2 drop . 1  ok');
  assert.equal(rows[5], '> 2 3 + 4 * . 20  ok');
  assert.ok(running, 'the REPL must survive all five lines');
});

test('number printing covers zero and multi-digit values', () => {
  const { rows } = repl('0 .\n42 .\n');
  assert.equal(rows[1], '> 0 . 0 ok'); // quirk: zero prints no trailing space
  assert.equal(rows[2], '> 42 . 42  ok');
});

test('emit prints the popped character', () => {
  const { rows } = repl('65 emit\n');
  assert.equal(rows[1], '> 65 emitA ok');
});

test('emit keeps >IN so words after it still run', () => {
  // Regression: the shadow-bank BIOS clobbers R5, which is >IN. word_emit
  // therefore used to swallow the rest of the input line.
  const { rows } = repl('65 emit 66 emit\n');
  assert.equal(rows[1], '> 65 emit 66 emitAB ok');
  assert.equal(rows[2], '>');
});

test('cr moves the " ok" onto the next row', () => {
  const { rows } = repl('cr\n');
  assert.equal(rows[1], '> cr');
  assert.equal(rows[2], ' ok');
  assert.equal(rows[3], '>');
});

test('stack underflow is reported and the REPL continues', () => {
  const { rows, running } = repl('+\n1 2 + .\n');
  assert.equal(rows[1], '> +');
  assert.equal(rows[2], 'stack underflow');
  assert.equal(rows[3], '> 1 2 + . 3  ok');
  assert.equal(rows[4], '>');
  assert.ok(running, 'the REPL must keep evaluating after the underflow');
});

test('tokens are resolved through the dictionary (no single-char fast path)', () => {
  // P1: `+`/`*` used to be dispatched before the dictionary saw them, so a
  // token like `+foo` executed `+` and then treated `foo` as the next word.
  // Now the whole token goes through FIND and is either a known word or
  // reported as unknown.
  const { rows } = repl('+foo\n1 2 + 3 * .\n');
  assert.equal(rows[1], '> +foo');
  assert.equal(rows[2], 'undefined word: +foo');
  assert.equal(rows[3], '> 1 2 + 3 * . 9  ok');
});

test('an unknown word is echoed, the line discarded, the REPL continues', () => {
  const { rows, running } = repl('HELLO\n1 2 + .\n');
  assert.equal(rows[1], '> HELLO');
  assert.equal(rows[2], 'undefined word: HELLO');
  assert.equal(rows[3], '> 1 2 + . 3  ok');
  assert.equal(rows[4], '>');
  assert.ok(running, 'the REPL must keep evaluating after the error');
});
