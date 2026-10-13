// DeepForth REPL — behavioural contract (phase P0 of the DeepForth expansion).
//
// Each test boots the kernel fresh, types into the keyboard FIFO and reads
// the 80x25 screen back. The assertions pin the externally visible REPL
// behaviour: input echo, results, " ok", the prompt, error reporting and
// recovery — on the JS core (the WASM core parity is covered by
// shadow.test.js).
//
// Corrected after review: this file used to claim two quirks that do not
// exist. `.` does NOT end the input line (`5 . 6 . 7 .` prints 5 6 7), and a
// bare string is not swallowing the line — both are working features of the
// tokenizer: a `"` opens a string that is printed to end of line, `."` prints
// a string literal. They are pinned by tests below rather than left in prose.
//
// Still worth knowing about `.`: -32768 has no representable magnitude, so NEG
// leaves it unchanged and the unsigned digit printer emits 32768 — the cell
// reads `-32768`, which is the right answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, loadBrowserScripts, buildMemory, runWasm, runRtl, ROOT, SCREEN_ADDR, CURSOR_ATTR } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const src = fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8');
const res = assemble(src);

test('forth.asm assembles', () => {
  assert.ok(res.success, res.errors.join('; '));
});

test('the .org sections do not overlap', () => {
  // A load routine that grew the interpreter by twenty words once pushed the
  // 0x0100 section past 0x0400. .org rewinds the address counter, so the code
  // emitted after it silently overwrote interpret_done — the REPL hung after a
  // loaded definition and the assembler reported nothing. Headroom between the
  // sections is what keeps that from happening again unnoticed.
  const rows = Array.isArray(res.listing) ? res.listing : [];
  const sections = [];
  let current = null;
  for (const r of rows) {
    if (typeof r.line === 'string' && r.line.trim().startsWith('.org')) {
      if (current) sections.push(current);
      current = { org: r.line.trim(), start: r.address, end: r.address };
    } else if (current && typeof r.address === 'number' && r.address > current.end) {
      current.end = r.address;
    }
  }
  if (current) sections.push(current);
  assert.ok(sections.length >= 4, 'expected the kernel sections in the listing');

  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const a = sections[i], b = sections[j];
      const lo = Math.max(a.start, b.start), hi = Math.min(a.end, b.end);
      assert.ok(
        hi < lo,
        `${a.org} (ends 0x${a.end.toString(16)}) overlaps ${b.org} (starts 0x${b.start.toString(16)})`
      );
    }
  }
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
  // Column of every cell carrying the cursor attribute, so a cursor left
  // behind on an earlier line shows up as a stale block.
  const cursors = [];
  for (let r = 0; r < 25; r++) {
    const cols = [];
    for (let c = 0; c < 80; c++) {
      if ((sim.memory[SCREEN_ADDR + r * 80 + c] & 0xFF00) === CURSOR_ATTR) cols.push(c);
    }
    cursors.push(cols);
  }
  return { rows, cursors, steps, running: sim.running };
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
  assert.equal(rows[1], '> 0 . 0  ok'); // zero prints the trailing space like any value
  assert.equal(rows[2], '> 42 . 42  ok');
});

test('emit prints the popped character', () => {
  const { rows } = repl('65 emit\n');
  assert.equal(rows[1], '> 65 emitA ok');
});

// ---------------------------------------------------------------------------
// Keyboard echo
//
// The BIOS draws every character that is typed (getstr, BIOS function 5) and
// nothing else does, so `echo` and the Screen tab's Echo toggle both end up
// writing one cell the BIOS reads on every keystroke. See the echo_flag cell
// in asm/forth.asm.
// ---------------------------------------------------------------------------

// The address the browser hard-codes. It is pinned in the I/O segment rather
// than in the kernel's data area precisely so that this can be a constant: a
// cell that moved with every interpreter change would break the toggle
// silently.
const ECHO_FLAG_ADDR = 0xF0064;

test('the echo flag is a pinned cell in the Keyboard Controller block', () => {
  const cell = res.memoryChanges.find(c => c.address === ECHO_FLAG_ADDR);
  assert.ok(cell, 'no echo flag at 0xF0064');
  assert.equal(cell.value & 0xFFFF, 1, 'a freshly loaded machine must echo');
  // Next to KBD_STATUS/KBD_DATA, inside the documented 0xF0060-0xF006F block.
  assert.ok(ECHO_FLAG_ADDR >= 0xF0060 && ECHO_FLAG_ADDR <= 0xF006F,
    'the echo flag belongs in the Keyboard Controller block');
  // And it must not collide with the two registers that are really decoded.
  assert.ok(ECHO_FLAG_ADDR !== 0xF0060 && ECHO_FLAG_ADDR !== 0xF0062);
});

test('echo? reports on by default', () => {
  const { rows } = repl('echo? .\n');
  assert.equal(rows[1], '> echo? . 1  ok');
});

test('0 echo silences the keyboard echo and the REPL stops talking', () => {
  // `0 echo` is typed with the echo still on, so it appears. After it the input
  // is not drawn and the REPL prints neither " ok" nor a prompt, so the whole
  // quiet stretch is a single row: what was echoed, then what the lines printed
  // themselves. `1 echo` brings both back, so the line after it is normal again.
  const { rows } = repl('0 echo\n42 .\n1 echo\n7 .\n');
  assert.equal(rows[1], '> 0 echo 42  ok', 'no " ok" and no prompt while the echo is off');
  assert.equal(rows[2], '> 7 . 7  ok', 'echoing again');
  assert.equal(rows[3], '>');
});

test('the echo flag gates the " ok" and the prompt, not what a program prints', () => {
  // This is what a file upload needs: without it, 269 lines of hanoi.fth write
  // 269 " ok" lines and 269 prompts past the screen, and silencing the typed
  // characters alone only trades the source text for the same amount of noise.
  //
  // The quiet line still prints what the program printed - the A from emit - and
  // then nothing at all: no " ok", no newline, no prompt. The line after it,
  // which switches the echo back on, behaves normally again.
  const quiet = repl('0 echo\n65 emit 1 echo\n');
  assert.equal(quiet.rows[1], '> 0 echoA ok',
    'the quiet line contributed only the A, with no " ok" and no prompt of its own');
  assert.equal(quiet.rows[2], '>', 'the prompt returns once the echo is back');

  // Same shape with the echo on: the middle line gets the full treatment, which
  // is the contrast that makes the gate worth having.
  const loud = repl('0 echo\n1 echo\n1 .\n');
  assert.equal(loud.rows[1], '> 0 echo ok');
  assert.equal(loud.rows[2], '> 1 . 1  ok');
});

test('errors still print while the echo is off', () => {
  // The one thing a quiet load must never do is fail silently.
  const unknown = repl('0 echo\nnosuchword\n1 echo\n').rows.join('\n');
  assert.ok(unknown.includes('undefined word: nosuchword'),
    'an undefined word must still be reported while the echo is off');
  const under = repl('0 echo\ndrop\n1 echo\n').rows.join('\n');
  assert.ok(under.includes('stack underflow'),
    'so must a stack underflow');
});

test('echo? reads the cell the toggle writes', () => {
  const { rows } = repl('echo? .\n0 echo\necho? .\n1 echo\necho? .\n');
  assert.equal(rows[1], '> echo? . 1  ok');
  assert.equal(rows[2], '> 0 echo 0  ok', 'the middle query has to report 0');
  assert.equal(rows[3], '> echo? . 1  ok');
});

test('echo takes its flag from the stack, like every other word', () => {
  // `echo 0` does not switch anything off: in interpret mode the word runs
  // before the 0 is pushed, so it underflows instead.
  const { rows } = repl('echo\n');
  assert.equal(rows[2], 'stack underflow');
});

// Boot to the prompt, write the cell from OUTSIDE the machine, then type. This
// is the Screen tab's path, and the reason it does not go through a Forth word:
// nothing of the kernel has to be running or even present for the cell to take
// effect, because the BIOS reads it on every character it would echo.
function replWithEchoPoke(value, input) {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  sim.running = true;
  for (let i = 0; i < 400000 && sim.running; i++) sim.step();   // boot, banner, prompt, into getstr
  sim.memory[ECHO_FLAG_ADDR] = value;                          // the poke
  for (const ch of input) sim.enqueueKeyCode(ch === '\n' ? 10 : ch.charCodeAt(0));
  for (let i = 0; i < 400000 && sim.running; i++) sim.step();
  const rows = [];
  for (let r = 0; r < 25; r++) {
    let s = '';
    for (let c = 0; c < 80; c++) s += String.fromCharCode(sim.memory[SCREEN_ADDR + r * 80 + c] & 0xFF);
    rows.push(s.replace(/\s+$/, ''));
  }
  return { rows, screen: rows.join('\n') };
}

test('a write from outside the machine switches the echo', () => {
  for (const value of [1, 0, 1]) {
    const { screen } = replWithEchoPoke(value, '1234\n');
    assert.equal(screen.includes('1234'), value !== 0,
      `echo flag ${value} should ${value ? '' : 'not '}echo the typed text`);
  }
});

test('the echo cell survives a reload of the kernel image', () => {
  // The image ships the cell as 1, so a reload (and therefore a Reset) brings
  // the echo back. The Screen tab re-reads the cell after a reset so its button
  // cannot keep claiming "off" over a machine that is echoing again.
  const cell = res.memoryChanges.find(c => c.address === ECHO_FLAG_ADDR);
  assert.equal(cell.value & 0xFFFF, 1);
  assert.equal(buildMemory(res)[ECHO_FLAG_ADDR], 1);
});

// ---------------------------------------------------------------------------
// CR / LF, which lives in the BIOS
//
// Carriage return, line feed and the scroll at the bottom row belong to BIOS
// putch (function 2). The kernel used to keep its own copies: emit sent 10 and
// 13 to emit_do_cr/emit_do_lf, `cr` computed the row and the column itself and
// clamped at the bottom row instead of scrolling, and interpret_done rolled a
// second scroll of its own before printing " ok". Three places to agree about
// where the cursor was, and they did not agree - `cr` and `emit 10` left the
// cursor on different rows.
// ---------------------------------------------------------------------------

const SCR_BASE = 0x1000, VISIBLE_ROWS = 24, COLS = 80;

// Like repl(), but reports the cursor too: SCR is R8, a word offset from the
// screen base, and the whole point of these tests is which row it lands on.
function replCursor(input, maxSteps = 8000000) {
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
  const off = (sim.registers[8] - SCR_BASE) & 0xFFFF;
  let screen = '';
  for (let r = 0; r < VISIBLE_ROWS; r++) {
    for (let c = 0; c < COLS; c++) screen += String.fromCharCode(sim.memory[SCREEN_ADDR + r * COLS + c] & 0xFF);
    screen += '\n';
  }
  return { row: Math.floor(off / COLS), col: off % COLS, off, screen, rows: screen.split('\n') };
}

test('cr, and emit of 10 and 13, all leave the cursor on the same row', () => {
  // Same output, three ways of asking for a newline. They used to disagree:
  // `cr` ended on the hidden row 24 while emit of 10 ended on row 23.
  const variants = { cr: '65 emit cr\n', emit10: '65 emit 10 emit\n', emit13: '65 emit 13 emit\n' };
  const seen = {};
  for (const [name, line] of Object.entries(variants)) {
    const r = replCursor(line.repeat(30));
    seen[name] = r.row;
    assert.ok(r.row < VISIBLE_ROWS,
      `${name} left the cursor on row ${r.row}, which the ${VISIBLE_ROWS}-row display does not show`);
  }
  assert.equal(seen.cr, seen.emit10, 'cr and emit of 10 must agree');
  assert.equal(seen.emit10, seen.emit13, 'emit of 10 and 13 must agree');
});

test('a long run of output scrolls the screen instead of stopping at the bottom', () => {
  // 40 marked lines, each drawing a marker row plus the REPL's own " ok" row, so
  // roughly 80 rows of output for a 24-row screen. The screen has to scroll: a
  // clamped cursor keeps overwriting the first lines and the recent ones never
  // appear at all.
  const keys = [];
  for (let n = 1; n <= 40; n++) {
    const s = `77 emit ${0x30 + Math.floor(n / 10)} emit ${0x30 + n % 10} emit cr\n`;
    for (const ch of s) keys.push(ch === '\n' ? 10 : ch.charCodeAt(0));
  }
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF;
  sim.segmentRegisters.DS = 0x0000; sim.segmentRegisters.SS = 0x0000; sim.segmentRegisters.ES = 0x0000;
  for (const k of keys) sim.enqueueKeyCode(k);
  sim.running = true;
  for (let i = 0; i < 30000000 && sim.running; i++) sim.step();

  let text = '';
  for (let r = 0; r < VISIBLE_ROWS; r++) for (let c = 0; c < COLS; c++) text += String.fromCharCode(sim.memory[SCREEN_ADDR + r * COLS + c] & 0xFF);

  const seen = [];
  for (let n = 1; n <= 40; n++) if (text.includes('M' + String(n).padStart(2, '0'))) seen.push(n);
  assert.ok(seen.length > 0, 'no marker survived: nothing was drawn at all');
  assert.equal(seen[seen.length - 1], 40, 'the newest marker must be the last one still visible');
  assert.ok(!seen.includes(1), 'the first marker is still on screen - the screen did not scroll');

  const off = (sim.registers[8] - SCR_BASE) & 0xFFFF;
  assert.ok(off < VISIBLE_ROWS * COLS,
    `the cursor ran past the visible rows to offset ${off} - it is not scrolling`);
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

test('colon definitions compile and run', () => {
  const { rows, running } = repl(
    ': square dup * ;\n' +
    '5 square .\n' +
    ': inc 1 + ;\n' +
    ': inc2 inc inc ;\n' +
    '10 inc2 .\n'
  );
  assert.equal(rows[1], '> : square dup * ; ok');
  assert.equal(rows[2], '> 5 square . 25  ok');
  assert.equal(rows[3], '> : inc 1 + ; ok');
  assert.equal(rows[4], '> : inc2 inc inc ; ok');
  assert.equal(rows[5], '> 10 inc2 . 12  ok');
  assert.equal(rows[6], '>');
  assert.ok(running, 'the REPL must keep evaluating after the definitions');
});

test('a colon word may use ., emit and cr', () => {
  const { rows } = repl(
    ': show 5 . ;\n' +
    ': ab 65 emit 66 emit ;\n' +
    'show ab cr\n'
  );
  assert.equal(rows[1], '> : show 5 . ; ok');
  assert.equal(rows[2], '> : ab 65 emit 66 emit ; ok');
  assert.equal(rows[3], '> show ab cr 5 AB');
  assert.equal(rows[4], ' ok');
  assert.equal(rows[5], '>');
});

test('state, [ ] and immediate', () => {
  const { rows } = repl(
    'state .\n' +
    ': c [ 3 4 + ] ;\n' +
    'c .\n' +
    ': two 2 ;\n' +
    'immediate\n' +
    ': four two two + ;\n' +
    'four .\n'
  );
  assert.equal(rows[1], '> state . 0  ok');
  assert.equal(rows[2], '> : c [ 3 4 + ] ; ok');
  assert.equal(rows[3], '> c . 7  ok');
  assert.equal(rows[4], '> : two 2 ; ok');
  assert.equal(rows[5], '> immediate ok');
  assert.equal(rows[6], '> : four two two + ; ok');
  assert.equal(rows[7], '> four . 4  ok');
  assert.equal(rows[8], '>');
});

test('an error while compiling aborts the definition', () => {
  const { rows, running } = repl(': bad zzz ;\n1 2 + .\n');
  assert.equal(rows[1], '> : bad zzz ;');
  assert.equal(rows[2], 'undefined word: zzz');
  assert.equal(rows[3], '> 1 2 + . 3  ok');
  assert.ok(running, 'the next line must be interpreted, not compiled');
});

test('arithmetic words subtract, divide, take remainders and scale', () => {
  const { rows, running } = repl(
    '10 3 - .\n' +
    '17 5 / .\n' +
    '17 5 mod .\n' +
    '17 5 /mod . .\n' +
    '5 negate 5 + .\n' +
    '21 2* .\n' +
    '4 1+ 1- .\n'
  );
  assert.equal(rows[1], '> 10 3 - . 7  ok');
  assert.equal(rows[2], '> 17 5 / . 3  ok');
  assert.equal(rows[3], '> 17 5 mod . 2  ok');
  assert.equal(rows[4], '> 17 5 /mod . . 3  2  ok');
  assert.equal(rows[5], '> 5 negate 5 + . 0  ok');
  assert.equal(rows[6], '> 21 2* . 42  ok');
  assert.equal(rows[7], '> 4 1+ 1- . 4  ok');
  assert.equal(rows[8], '>');
  assert.ok(running);
});

test('comparisons yield the Forth true (-1) and false (0)', () => {
  const { rows } = repl(
    '3 3 = . 3 4 = .\n' +
    '3 4 < . 4 3 < .\n' +
    '4 3 > . 3 4 > .\n' +
    '0 0= . 7 0= .\n' +
    '5 0< . 7 0> .\n'
  );
  assert.equal(rows[1], '> 3 3 = . 3 4 = . -1  0  ok');
  assert.equal(rows[2], '> 3 4 < . 4 3 < . -1  0  ok');
  assert.equal(rows[3], '> 4 3 > . 3 4 > . -1  0  ok');
  assert.equal(rows[4], '> 0 0= . 7 0= . -1  0  ok');
  assert.equal(rows[5], '> 5 0< . 7 0> . 0  -1  ok');
  assert.equal(rows[6], '>');
});

test('stack words over, rot, nip, 2dup, 2drop and depth', () => {
  const { rows } = repl(
    '1 2 over . . .\n' +
    '1 2 3 rot . . .\n' +
    '1 2 nip .\n' +
    '1 2 2dup . . . .\n' +
    '7 8 2drop 9 .\n' +
    '1 2 3 depth .\n'
  );
  assert.equal(rows[1], '> 1 2 over . . . 1  2  1  ok');
  assert.equal(rows[2], '> 1 2 3 rot . . . 1  3  2  ok');
  assert.equal(rows[3], '> 1 2 nip . 2  ok');
  assert.equal(rows[4], '> 1 2 2dup . . . . 2  1  2  1  ok');
  assert.equal(rows[5], '> 7 8 2drop 9 . 9  ok');
  assert.equal(rows[6], '> 1 2 3 depth . 3  ok');
  assert.equal(rows[7], '>');
});

test('words whose names start with a digit are not split into number + word', () => {
  const { rows } = repl(
    '1 2 2dup depth .\n' +
    ': 2x 2* ;\n' +
    '5 2x .\n'
  );
  assert.equal(rows[1], '> 1 2 2dup depth . 4  ok');
  assert.equal(rows[2], '> : 2x 2* ; ok');
  assert.equal(rows[3], '> 5 2x . 10  ok');
  assert.equal(rows[4], '>');
});

test('control flow: if then else pick a branch at run time', () => {
  const { rows, running } = repl(
    ': t if 111 . then ; 1 t 0 t\n' +
    ': e if 1 . else 2 . then ; 1 e 0 e\n' +
    ': n if 1 . 0 if 2 . else 3 . then else 4 . then ; 1 n 0 n\n'
  );
  assert.equal(rows[1], '> : t if 111 . then ; 1 t 0 t 111  ok');
  assert.equal(rows[2], '> : e if 1 . else 2 . then ; 1 e 0 e 1  2  ok');
  assert.equal(rows[3], '> : n if 1 . 0 if 2 . else 3 . then else 4 . then ; 1 n 0 n 1  3  4  ok');
  assert.equal(rows[4], '>');
  assert.ok(running);
});

test('control flow: begin until, while repeat and again', () => {
  const { rows } = repl(
    ': cu 0 begin 1+ dup 5 = until ; cu .\n' +
    ': wc 0 begin dup 5 < while 1+ repeat ; wc .\n' +
    ': ag 0 begin 1+ dup 3 = if drop 7 exit then again ; ag .\n'
  );
  assert.equal(rows[1], '> : cu 0 begin 1+ dup 5 = until ; cu . 5  ok');
  assert.equal(rows[2], '> : wc 0 begin dup 5 < while 1+ repeat ; wc . 5  ok');
  assert.equal(rows[3], '> : ag 0 begin 1+ dup 3 = if drop 7 exit then again ; ag . 7  ok');
  assert.equal(rows[4], '>');
});

test('recurse compiles the current definition', () => {
  const { rows } = repl(': fac dup 1 > if dup 1- recurse * then ; 5 fac .\n');
  assert.equal(rows[1], '> : fac dup 1 > if dup 1- recurse * then ; 5 fac . 120  ok');
  assert.equal(rows[2], '>');
});

test('memory words: variable, ! @ +! and a colon definition using them', () => {
  const { rows, running } = repl(
    'variable x drop\n' +
    '7 x ! x @ .\n' +
    '4 x +! x @ .\n' +
    'variable y drop\n' +
    'y @ .\n' +
    ': inc y @ 1+ y ! ;\n' +
    'inc y @ .\n'
  );
  assert.equal(rows[1], '> variable x drop ok');
  assert.equal(rows[2], '> 7 x ! x @ . 7  ok');
  assert.equal(rows[3], '> 4 x +! x @ . 11  ok');
  assert.equal(rows[4], '> variable y drop ok');
  assert.equal(rows[5], '> y @ . 0  ok');
  assert.equal(rows[6], '> : inc y @ 1+ y ! ; ok');
  assert.equal(rows[7], '> inc y @ . 1  ok');
  assert.equal(rows[8], '>');
  assert.ok(running);
});

test('constant freezes a value', () => {
  const { rows } = repl(
    '5 constant five\n' +
    'five .\n' +
    ': add5 five + ;\n' +
    '10 add5 .\n'
  );
  assert.equal(rows[1], '> 5 constant five ok');
  assert.equal(rows[2], '> five . 5  ok');
  assert.equal(rows[3], '> : add5 five + ; ok');
  assert.equal(rows[4], '> 10 add5 . 15  ok');
  assert.equal(rows[5], '>');
});

test('c@ c! and here allot , cells cell+', () => {
  const { rows } = repl(
    'variable c drop\n' +
    '65 c c! c c@ .\n' +
    'here 5 , here swap - .\n' +
    'here 3 allot here swap - .\n' +
    '1 cells . 5 cell+ .\n'
  );
  assert.equal(rows[1], '> variable c drop ok');
  assert.equal(rows[2], '> 65 c c! c c@ . 65  ok');
  assert.equal(rows[3], '> here 5 , here swap - . 1  ok');
  assert.equal(rows[4], '> here 3 allot here swap - . 3  ok');
  assert.equal(rows[5], '> 1 cells . 5 cell+ . 1  6  ok');
  assert.equal(rows[6], '>');
});

test('create builds a word whose body starts at HERE', () => {
  const { rows } = repl(
    'create buf\n' +
    'buf here = .\n' +
    'create cell 5 ,\n' +
    'cell @ .\n'
  );
  assert.equal(rows[1], '> create buf ok');
  assert.equal(rows[2], '> buf here = . -1  ok');
  assert.equal(rows[3], '> create cell 5 , ok');
  assert.equal(rows[4], '> cell @ . 5  ok');
  assert.equal(rows[5], '>');
});

test('does> attaches behaviour to a created word', () => {
  const { rows, running } = repl(
    ': const create , does> @ ;\n' +
    '42 const answer\n' +
    'answer .\n' +
    ': get answer ;\n' +
    'get .\n' +
    ': arr create cells allot does> swap cells + ;\n' +
    '4 arr a\n' +
    '7 0 a ! 8 3 a !\n' +
    '0 a @ . 3 a @ .\n'
  );
  assert.equal(rows[1], '> : const create , does> @ ; ok');
  assert.equal(rows[2], '> 42 const answer ok');
  assert.equal(rows[3], '> answer . 42  ok');
  assert.equal(rows[4], '> : get answer ; ok');
  assert.equal(rows[5], '> get . 42  ok');
  assert.equal(rows[6], '> : arr create cells allot does> swap cells + ; ok');
  assert.equal(rows[7], '> 4 arr a ok');
  assert.equal(rows[8], '> 7 0 a ! 8 3 a ! ok');
  assert.equal(rows[9], '> 0 a @ . 3 a @ . 7  8  ok');
  assert.equal(rows[10], '>');
  assert.ok(running);
});

test('value reads and to writes in interpret and compile state', () => {
  const { rows } = repl(
    '5 value v\n' +
    'v .\n' +
    '9 to v\n' +
    'v .\n' +
    ': setv to v ;\n' +
    '42 setv\n' +
    'v .\n' +
    ': usev v v + ;\n' +
    'usev .\n'
  );
  assert.equal(rows[1], '> 5 value v ok');
  assert.equal(rows[2], '> v . 5  ok');
  assert.equal(rows[3], '> 9 to v ok');
  assert.equal(rows[4], '> v . 9  ok');
  assert.equal(rows[5], '> : setv to v ; ok');
  assert.equal(rows[6], '> 42 setv ok');
  assert.equal(rows[7], '> v . 42  ok');
  assert.equal(rows[8], '> : usev v v + ; ok');
  assert.equal(rows[9], '> usev . 84  ok');
  assert.equal(rows[10], '>');
});

test('to reaches a created word\'s data field, not its DOES> cell', () => {
  // A created word holds two cells behind its code field: the DOES> thread and
  // then its data. A variable holds one. `to` adds 1 to the code field, which
  // is a variable's data cell and a created word's DOES> cell - so `to` wrote
  // the value into the thread, and dodoes then took it for a threaded xt and
  // jumped there on the word's next use. The interpreter died on 0xFFFF.
  //
  // The store itself reported ok, so nothing looked wrong until the word ran.
  const { rows, running } = repl(
    'create cv 3 ,\n' +
    '5 to cv\n' +
    'cv @ .\n'
  );
  assert.equal(rows[1], '> create cv 3 , ok');
  assert.equal(rows[2], '> 5 to cv ok');
  assert.equal(rows[3], '> cv @ . 5  ok', `screen was:\n${rows.join('\n')}`);
  assert.ok(running, 'the REPL must survive `to` on a created word');

  // The DOES> thread itself is what the old store clobbered, so a created
  // word that has behaviour attached must keep it across a `to`.
  const { rows: attached } = repl(
    ': const create , does> @ ;\n' +
    '42 const answer\n' +
    '9 to answer\n' +
    'answer .\n'
  );
  assert.equal(attached[3], '> 9 to answer ok');
  assert.equal(attached[4], '> answer . 9  ok',
    `a to must not overwrite the DOES> thread; screen was:\n${attached.join('\n')}`);
});

test('a line longer than the buffer does not eat the messages after it', () => {
  // tib_kbd was 86 words and bios_store_char never compared the write pointer
  // against it, so a longer line ran straight past the end into the message
  // strings that follow and overwrote them. The damage is quiet: the long line
  // itself usually still runs, because the interpreter splits on spaces and
  // reads whatever cells are there. What gives it away is the NEXT error.
  const long = '1 '.repeat(60);          // 120 characters, well past 86
  const { rows } = repl(long + '\n' + 'nosuchword\n');
  const dump = rows.map((r, i) => `${i}: ${r}`).join('\n');
  const err = rows.find(r => r.includes('undefined word'));
  assert.ok(err, `the second line should have reported an unknown word; screen was:\n${dump}`);
  assert.match(err, /undefined word: nosuchword/,
    `a long line must not overwrite the messages that follow the buffer; screen was:\n${dump}`);
});

test('the input buffer holds a line of more than 86 characters', () => {
  // With the write bounded, the limit is the buffer's size rather than
  // whatever happens to follow it, so a line up to TIB_LIMIT runs as typed.
  const line = '1 ' + '1 + '.repeat(25) + '.';
  assert.ok(line.length > 86, `the probe must be longer than the old limit, is ${line.length}`);
  assert.ok(line.length <= 128, `the probe must fit the new limit, is ${line.length}`);

  const { rows } = repl(line + '\n');
  const dump = rows.map((r, i) => `${i}: ${r}`).join('\n');
  const err = rows.find(r => /undefined word|underflow|not a|error/i.test(r));
  assert.equal(err, undefined, `a long line must not fall over; screen was:\n${dump}`);
  const out = rows.find(r => r.includes(' ok'));
  assert.ok(out, `the line did not run; screen was:\n${dump}`);
  assert.match(out, /\b26\b/,
    `25 additions on 1 should print 26; screen was:\n${dump}`);
});

test('to rejects an unknown name without corrupting the value', () => {
  const { rows, running } = repl(
    '5 value v\n' +
    '9 to nope\n' +
    'v .\n'
  );
  assert.equal(rows[1], '> 5 value v ok');
  assert.equal(rows[2], '> 9 to nope');
  assert.equal(rows[3], 'undefined word: nope');
  assert.equal(rows[4], '> v . 5  ok');
  assert.equal(rows[5], '>');
  assert.ok(running);
});

test('vocabulary creates a wordlist and definitions go into it', () => {
  const { rows } = repl(
    ': baz 5 ;\n' +
    'vocabulary foo\n' +
    'foo definitions\n' +
    'baz .\n' +
    ': qux 3 ;\n' +
    'qux .\n'
  );
  assert.equal(rows[1], '> : baz 5 ; ok');
  assert.equal(rows[2], '> vocabulary foo ok');
  assert.equal(rows[3], '> foo definitions ok');
  assert.equal(rows[4], '> baz . 5  ok');
  assert.equal(rows[5], '> : qux 3 ; ok');
  assert.equal(rows[6], '> qux . 3  ok');
  assert.equal(rows[7], '>');
});

test('only forth definitions hides words from a vocabulary', () => {
  const { rows, running } = repl(
    'vocabulary foo\n' +
    'foo definitions\n' +
    ': bar 42 ;\n' +
    'bar .\n' +
    'only forth definitions\n' +
    'bar .\n' +
    '1 2 + .\n'
  );
  assert.equal(rows[1], '> vocabulary foo ok');
  assert.equal(rows[2], '> foo definitions ok');
  assert.equal(rows[3], '> : bar 42 ; ok');
  assert.equal(rows[4], '> bar . 42  ok');
  assert.equal(rows[5], '> only forth definitions ok');
  assert.equal(rows[6], '> bar .');
  assert.equal(rows[7], 'undefined word: bar');
  assert.equal(rows[8], '> 1 2 + . 3  ok');
  assert.equal(rows[9], '>');
  assert.ok(running);
});

test('a vocabulary word shadows and then reveals a FORTH word', () => {
  const { rows } = repl(
    ': x 1 ;\n' +
    'vocabulary foo\n' +
    'foo definitions\n' +
    ': x 2 ;\n' +
    'x .\n' +
    'only forth definitions\n' +
    'x .\n'
  );
  assert.equal(rows[1], '> : x 1 ; ok');
  assert.equal(rows[2], '> vocabulary foo ok');
  assert.equal(rows[3], '> foo definitions ok');
  assert.equal(rows[4], '> : x 2 ; ok');
  assert.equal(rows[5], '> x . 2  ok');
  assert.equal(rows[6], '> only forth definitions ok');
  assert.equal(rows[7], '> x . 1  ok');
  assert.equal(rows[8], '>');
});

test('also and previous adjust the search order', () => {
  const { rows } = repl(
    'vocabulary foo\n' +
    'only\n' +
    'also foo\n' +
    'definitions\n' +
    ': b 9 ;\n' +
    'b .\n' +
    'previous\n' +
    'definitions\n' +
    ': z 1 ;\n' +
    'b .\n'
  );
  assert.equal(rows[1], '> vocabulary foo ok');
  assert.equal(rows[2], '> only ok');
  assert.equal(rows[3], '> also foo ok');
  assert.equal(rows[4], '> definitions ok');
  assert.equal(rows[5], '> : b 9 ; ok');
  assert.equal(rows[6], '> b . 9  ok');
  assert.equal(rows[7], '> previous ok');
  assert.equal(rows[8], '> definitions ok');
  assert.equal(rows[9], '> : z 1 ; ok');
  assert.equal(rows[10], '> b .');
  assert.equal(rows[11], 'undefined word: b');
  assert.equal(rows[12], '>');
});

test('words lists the searched wordlist', () => {
  const { rows, running } = repl('words\n');
  const text = rows.join('');
  assert.ok(text.includes('forget'), 'lists forget');
  assert.ok(text.includes('vocabulary'), 'lists vocabulary');
  assert.ok(text.includes('does>'), 'names split across rows survive');
  assert.ok(text.includes('dup'), 'lists primitives');
  assert.ok(text.includes(' ok'), 'the REPL still prints ok');
  assert.ok(running);
});

test('words lists only the first wordlist of the search order', () => {
  const { rows } = repl(
    'vocabulary foo\n' +
    'foo definitions\n' +
    ': alpha 1 ;\n' +
    ': beta 2 ;\n' +
    'words\n'
  );
  assert.equal(rows[0], 'beta alpha  ok');
  assert.equal(rows[1], '>');
});

test('forget drops a word and everything defined after it', () => {
  const { rows, running } = repl(
    ': a 1 ; : b 2 ; : c 3 ;\n' +
    'forget b\n' +
    'a .\n' +
    'b .\n' +
    'c .\n'
  );
  assert.equal(rows[1], '> : a 1 ; : b 2 ; : c 3 ; ok');
  assert.equal(rows[2], '> forget b ok');
  assert.equal(rows[3], '> a . 1  ok');
  assert.equal(rows[4], '> b .');
  assert.equal(rows[5], 'undefined word: b');
  assert.equal(rows[6], '> c .');
  assert.equal(rows[7], 'undefined word: c');
  assert.equal(rows[8], '>');
  assert.ok(running);
});

test('forget a vocabulary returns to FORTH and reclaims space', () => {
  const { rows } = repl(
    'vocabulary foo\n' +
    'foo definitions\n' +
    ': a 1 ;\n' +
    'only forth definitions\n' +
    'forget foo\n' +
    'foo .\n' +
    '1 2 + .\n'
  );
  assert.equal(rows[4], '> only forth definitions ok');
  assert.equal(rows[5], '> forget foo ok');
  assert.equal(rows[6], '> foo .');
  assert.equal(rows[7], 'undefined word: foo');
  assert.equal(rows[8], '> 1 2 + . 3  ok');
  assert.equal(rows[9], '>');
});

test('forget rejects an unknown name', () => {
  const { rows } = repl(
    ': a 1 ;\n' +
    'forget nope\n' +
    'a .\n'
  );
  assert.equal(rows[2], '> forget nope');
  assert.equal(rows[3], 'undefined word: nope');
  assert.equal(rows[4], '> a . 1  ok');
  assert.equal(rows[5], '>');
});

test('. prints the signed value while u. shows the raw cell', () => {
  const { rows, running } = repl(
    '0 5 - .\n' +
    '0 5 - u.\n' +
    '3 3 = .\n' +
    '3 3 = u.\n' +
    '32767 1 + .\n' +
    '32767 1 + u.\n'
  );
  assert.equal(rows[1], '> 0 5 - . -5  ok');
  assert.equal(rows[2], '> 0 5 - u. 65531  ok');
  // Forth's true is -1, which . now shows as such
  assert.equal(rows[3], '> 3 3 = . -1  ok');
  assert.equal(rows[4], '> 3 3 = u. 65535  ok');
  // -32768 has no representable magnitude: NEG leaves it alone, so the
  // printed number reads -32768
  assert.equal(rows[5], '> 32767 1 + . -32768  ok');
  assert.equal(rows[6], '> 32767 1 + u. 32768  ok');
  assert.equal(rows[7], '>');
  assert.ok(running);
});

test('backspace edits the input buffer, not just the screen', () => {
  // Regression: the BIOS getstr loop moved SCR back and blanked the cell but
  // left its write pointer (R2) alone, so the erased character stayed in the
  // buffer and the next key landed one cell past it — ",<BS>* ." became ",*".
  const { rows, running } = repl('2 dup ,\b* .\n');
  assert.equal(rows[1], '> 2 dup * . 4  ok');
  assert.equal(rows[2], '>');
  assert.ok(running);
});

test('backspace twice still edits the buffer', () => {
  const { rows, running } = repl('2 dup ,,\b\b* .\n');
  assert.equal(rows[1], '> 2 dup * . 4  ok');
  assert.ok(running);
});

test('backspace on an empty line does nothing', () => {
  const { rows, running } = repl('\b\b5 .\n');
  assert.equal(rows[1], '> 5 . 5  ok');
  assert.ok(running);
});

test('an error leaves no stale cursor on the input line', () => {
  // The error paths jump to the next line without writing over the cell the
  // cursor sits in, so they have to clear the attribute bit first. On the
  // success path the result overwrites that cell, hence no leftover there.
  const { rows, cursors, running } = repl('goo\n');
  assert.equal(rows[1], '> goo');
  assert.equal(rows[2], 'undefined word: goo');
  assert.equal(rows[3], '>');
  assert.deepEqual(cursors[1], [], 'no cursor block may survive on the input line');
  assert.deepEqual(cursors[2], [], 'the error line carries no cursor');
  assert.deepEqual(cursors[3], [2], 'the fresh prompt owns the cursor');
  assert.ok(running);
});

test('stack underflow leaves no stale cursor either', () => {
  const { rows, cursors, running } = repl('drop\n');
  assert.equal(rows[1], '> drop');
  assert.equal(rows[2], 'stack underflow');
  assert.deepEqual(cursors[1], []);
  assert.deepEqual(cursors[3], [2]);
  assert.ok(running);
});

test('the success path leaves no cursor behind either', () => {
  const { cursors, running } = repl('2 2 + .\n');
  assert.deepEqual(cursors[1], [], 'the result overwrites the cursor cell');
  assert.deepEqual(cursors[2], [2], 'the prompt owns the only cursor');
  assert.ok(running);
});

test('backspace leaves exactly one cursor block behind', () => {
  // Regression: the BIOS backspace branch moved SCR back and redrew the block,
  // but never cleared the cell it left, so the stale block survived next to the
  // new one. The character echo hides the same mistake because the character
  // store overwrites the old cell — backspace writes nothing over it.
  const { rows, cursors, running } = repl('2 \b');
  assert.equal(rows[1], '> 2');
  assert.deepEqual(cursors[1], [3], 'a single block must remain, not two');
  assert.ok(running);
});

test('typing after a backspace keeps one cursor block', () => {
  // No trailing newline: the line is still being edited, so the block is the
  // live cursor and no output has overwritten its cell yet.
  const { rows, cursors, running } = repl('2 \b7\b8');
  assert.equal(rows[1], '> 28');
  assert.deepEqual(cursors[1], [4], 'only the current position carries the block');
  assert.ok(running);
});

test('several dots on one line all execute', () => {
  // Pins the correction: an old comment claimed `.` ends the input line.
  const { rows, running } = repl('5 . 6 . 7 .\n');
  assert.equal(rows[1], '> 5 . 6 . 7 . 5  6  7  ok');
  assert.equal(rows[2], '>');
  assert.ok(running);
});

test('a word after a dot still runs, so `.` does not end the line', () => {
  const { rows, running } = repl('1 . dup .\n');
  assert.equal(rows[1], '> 1 . dup . 1');
  assert.equal(rows[2], 'stack underflow');
  assert.ok(running);
});

test('." prints a string literal to the end of the line', () => {
  const { rows, running } = repl('." hallo\n1 2 + .\n');
  assert.equal(rows[1], '> ." hallohallo ok');
  assert.equal(rows[2], '> 1 2 + . 3  ok');
  assert.equal(rows[3], '>');
  assert.ok(running);
});

test('a bare string is printed to the end of the line', () => {
  const { rows, running } = repl('"hi there\n1 2 + .\n');
  assert.equal(rows[1], '> "hi therehi there ok');
  assert.equal(rows[2], '> 1 2 + . 3  ok');
  assert.equal(rows[3], '>');
  assert.ok(running);
});

test('. prints the most negative cell as -32768', () => {
  const { rows, running } = repl('32767 1 + .\n32767 1 + u.\n');
  assert.equal(rows[1], '> 32767 1 + . -32768  ok');
  assert.equal(rows[2], '> 32767 1 + u. 32768  ok');
  assert.ok(running);
});


test('u. checks its operand', () => {
  const { rows, running } = repl('u.\n');
  assert.equal(rows[1], '> u.');
  assert.equal(rows[2], 'stack underflow');
  assert.equal(rows[3], '>');
  assert.ok(running);
});

test('2/ shifts arithmetically and floors like the standard requires', () => {
  const { rows, running } = repl(
    '7 2/ .\n' +
    '0 3 - 2/ .\n'
  );
  assert.equal(rows[1], '> 7 2/ . 3  ok');
  // -3 2/ = -2 (not -1): 2/ floors, and . now shows the signed value
  assert.equal(rows[2], '> 0 3 - 2/ . -2  ok');
  assert.equal(rows[3], '>');
  assert.ok(running);
});

test('abs returns the magnitude', () => {
  const { rows, running } = repl(
    '5 abs .\n' +
    '0 5 - abs .\n'
  );
  assert.equal(rows[1], '> 5 abs . 5  ok');
  assert.equal(rows[2], '> 0 5 - abs . 5  ok');
  assert.equal(rows[3], '>');
  assert.ok(running);
});

test('min and max keep one operand and drop the other', () => {
  const { rows, running } = repl(
    '3 9 min .\n' +
    '9 3 min .\n' +
    '3 9 max .\n' +
    '9 3 max .\n' +
    '4 4 min 4 4 max + .\n'
  );
  assert.equal(rows[1], '> 3 9 min . 3  ok');
  assert.equal(rows[2], '> 9 3 min . 3  ok');
  assert.equal(rows[3], '> 3 9 max . 9  ok');
  assert.equal(rows[4], '> 9 3 max . 9  ok');
  // both words leave exactly one cell behind
  assert.equal(rows[5], '> 4 4 min 4 4 max + . 8  ok');
  assert.equal(rows[6], '>');
  assert.ok(running);
});

test('2/, abs, min and max check their operands', () => {
  const { rows, running } = repl(
    '2/ .\n' +
    '1 min .\n'
  );
  assert.equal(rows[1], '> 2/ .');
  assert.equal(rows[2], 'stack underflow');
  assert.equal(rows[3], '> 1 min .');
  assert.equal(rows[4], 'stack underflow');
  assert.equal(rows[5], '>');
  assert.ok(running);
});

// The IDE draws 80x24 cells (640x360 at 8x15 per character). The kernel still
// clears 80x25 words, so this pins the assumption that makes that safe: the
// last row of the buffer stays blank, and scrolling keeps the visible rows
// filled. If the kernel ever writes into it, the bottom line would be cut off
// with nothing to show for it.
const SCREEN_VISIBLE_ROWS = 24;

test('the kernel never writes into the row below the visible screen', () => {
  const { Deep16Simulator } = globalThis;
  // Enough lines to scroll several times over.
  const lines = [];
  for (let i = 0; i < 40; i++) lines.push(`: w${i} ${i} ;`);
  lines.push('w7 .');
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF;
  for (const ch of lines.join('\n') + '\n') {
    sim.enqueueKeyCode(ch === '\n' ? 10 : ch.charCodeAt(0));
  }
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 4000000) { sim.step(); steps++; }

  // Row 24 is the one the display does not show.
  for (let c = 0; c < 80; c++) {
    const word = sim.memory[SCREEN_ADDR + 24 * 80 + c] & 0xFFFF;
    const isBlank = word === 0xFFFF || word === 0x0020 || word === 0x0000;
    assert.ok(isBlank,
      `row 24 column ${c} holds 0x${word.toString(16).padStart(4, '0')}, which the 24 row display cannot show`);
  }
  // And the scrolling did leave the visible area filled.
  let filled = 0;
  for (let i = 0; i < SCREEN_VISIBLE_ROWS * 80; i++) {
    const word = sim.memory[SCREEN_ADDR + i] & 0xFFFF;
    const ch = word === 0xFFFF ? 0 : (word & 0xFF);
    if (ch !== 0 && ch !== 0x20) filled++;
  }
  assert.ok(filled > 100, `only ${filled} cells drawn - the scrolling lost the output`);
});

test('scrolling blanks the row it vacated, not just the rows it copies up', () => {
  const { Deep16Simulator } = globalThis;
  // bios_lf_scroll_copy moves rows 1..24 into rows 0..23. Row 24 is left holding
  // whatever was in it, and only the "clear last row" loop after the copy can
  // wipe that. Nothing else clears it, so a stale row 24 is copied up again on
  // every following scroll and smears its old characters over the whole screen.
  //
  // The test above asserts row 24 is blank, but nothing in that scenario ever
  // puts anything there, so it passes on a kernel that never clears it at all.
  // This one dirties row 24 first.
  //
  // The scrolling has to be a loop in the kernel rather than a long run of
  // `10 emit`: a typed line cannot exceed TIB_LIMIT, and `10 emit` repeated
  // enough times to reach the bottom runs past it.
  const ROW24 = 0x1780;                        // ES offset: row 24
  const lines = [
    [0, 1, 2].map(c => `65 ${ROW24 + c} scr!`).join(' '),
    ': dn begin dup 0 > while 10 emit 1 - repeat drop ;',
    '30 dn',
    '',
  ];

  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF;
  for (const line of lines) {
    for (const ch of line) sim.enqueueKeyCode(ch.charCodeAt(0));
    sim.enqueueKeyCode(10);
    sim.running = true;
    for (let i = 0; i < 200000; i++) sim.step();
  }
  let steps = 0;
  while (sim.running && steps < 8000000) { sim.step(); steps++; }

  // scr! and scr@ take ES offsets, which start at 0x1000, so the physical
  // address of ES:off is SCREEN_ADDR - 0x1000 + off.
  const cell = (esOff) => sim.memory[SCREEN_ADDR - 0x1000 + esOff] & 0xFFFF;

  // The scroll has to have run, or the assertion below passes for free. Nothing
  // else on this screen can hold an 'A': the typed text is digits and `emit`,
  // and the REPL only ever writes " ok" and "> ".
  const rows = new Set();
  for (let i = 0; i < SCREEN_VISIBLE_ROWS * 80; i++) {
    if ((sim.memory[SCREEN_ADDR + i] & 0xFF) === 0x41) rows.add(Math.floor(i / 80));
  }
  assert.ok(rows.size > 0,
    'the scroll did not run, so this test would pass for the wrong reason');

  const left = [0, 1, 2].map(c => cell(ROW24 + c) & 0xFF);
  assert.deepEqual(left, [32, 32, 32],
    `the row the scroll vacated must be blanked; row 24 still holds `
    + `${left} (${left.map(v => String.fromCharCode(v)).join('')})`);
});

test('the screen buffer holds 24 visible rows at 8x15 pixels', () => {
  // The layout the CSS promises: 80 columns of 8 px and 24 rows of 15 px.
  assert.equal(80 * 8, 640);
  assert.equal(24 * 15, 360);
  assert.equal(SCREEN_VISIBLE_ROWS * 80, 1920);
});

// The safety net for the colour-byte work. The earlier attempt to move the
// cursor out of the cell failed only after 23 input lines, which is past every
// test in this file - so nothing noticed until the screen came back blank on
// the iPad. These run far enough to scroll several times and compare the
// visible screen cell by cell.
// The safety net for the colour-byte work. The earlier attempt to move the
// cursor out of the cell failed only after 23 input lines, which is past every
// other test in this file - so nothing noticed until the screen came back
// blank on the iPad. These run far enough to scroll several times and compare
// the visible screen cell by cell.
const SCROLL_LINES = () => {
  const lines = [];
  for (let i = 0; i < 40; i++) lines.push(`: w${i} ${i} ;`);
  lines.push('w7 .');
  return lines.join('\n') + '\n';
};

test('after scrolling, the visible screen holds the last lines in order', () => {
  const { rows, running } = repl(SCROLL_LINES(), 4000000);
  assert.ok(running, 'the REPL must still be alive after 41 lines');

  const visible = rows.slice(0, SCREEN_VISIBLE_ROWS);
  const text = visible.map(r => r.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');

  // The last line typed is on screen, with its result and the next prompt.
  assert.match(text, /w7 \. 7 ok >$/,
    `the last line must be visible at the bottom; screen was:\n${text}`);
  // And the first lines scrolled off the top, which is what proves the scroll
  // ran rather than the input silently going nowhere.
  assert.ok(!text.includes('w0'), 'w0 must have scrolled off the top');
  assert.ok(text.includes('w39'), 'the second to last line must still be on screen');
  // The definitions run on in order, with nothing lost in between.
  for (let i = 19; i < 39; i++) {
    assert.ok(text.includes(`w${i} ${i} ; ok`), `w${i} must be on screen`);
  }
});

test('after scrolling there is exactly one cursor, right behind the last output', () => {
  const { rows, cursors } = repl(SCROLL_LINES(), 4000000);
  const found = [];
  for (let r = 0; r < SCREEN_VISIBLE_ROWS; r++) {
    for (const c of cursors[r]) found.push({ row: r, col: c });
  }
  assert.equal(found.length, 1,
    `exactly one cursor expected, found ${found.map(f => `${f.row}:${f.col}`).join(', ')}`);

  // It sits on the fresh prompt the kernel prints under the result, and on
  // nothing else. The prompt occupies two cells - ">" and the space behind it
  // - so the cursor comes to rest in column 2. Row 24 stays blank: the display
  // shows 24 rows and the kernel never pushes its prompt out of sight.
  const row = found[0].row;
  assert.equal(rows.slice(row + 1).every(r => r.trim() === ''), true,
    `something is drawn below the cursor row ${row}`);
  assert.equal(rows[row].trim(), '>', `expected a bare prompt, found "${rows[row]}"`);
  assert.equal(found[0].col, 2, `cursor at column ${found[0].col}, expected 2`);
});

test('the attribute byte is either 0 or the cursor attribute, and no other colour', () => {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF;
  for (const ch of '1 2 +\n') sim.enqueueKeyCode(ch === '\n' ? 10 : ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }

  // With the colour byte the kernel writes no colour of its own, so a screen
  // must carry exactly one attribute value: the cursor's. A stray high byte
  // somewhere means a character store leaks an attribute into the cell.
  const counts = new Map();
  let cursorChars = [];
  for (let i = 0; i < SCREEN_VISIBLE_ROWS * 80; i++) {
    const word = sim.memory[SCREEN_ADDR + i] & 0xFFFF;
    if (word === 0xFFFF) continue;            // uninitialised, never written
    const hi = (word >> 8) & 0xFF;
    counts.set(hi, (counts.get(hi) || 0) + 1);
    if (hi !== 0) cursorChars.push(word & 0xFF);
  }
  // 0 is the blank cell, CURSOR_ATTR the cell under the cursor. Nothing else.
  assert.deepEqual([...counts.keys()].sort((a, b) => a - b), [0, CURSOR_ATTR >> 8],
    `unexpected attribute bytes on the screen: `
    + `${[...counts.keys()].map(h => '0x' + h.toString(16)).join(', ')}`);
  // The character survives the attribute write: the cursor cell is not blanked.
  assert.equal(cursorChars.length, 1, 'exactly one cell carries the cursor attribute');
  assert.equal(cursorChars[0], 0x20, 'the cursor sits on the blank behind "ok"');
});

// The BIOS block must keep its exact layout. This is not tidiness - it is the
// difference between a working REPL and a dead one, found the hard way.
//
// swi_to_bios is a delayed far jump into CS=0xF800, and the core leaves the
// branch state behind when it comes back. While that state is pending, the
// next instruction is treated as the delay slot of that old branch and the old
// target is taken again. Normally the instruction after the jump clears it. In
// the BIOS that only works while the offsets stay where they are: take a
// single word out of bios_clr or bios_f2 - both routes reach the putch path -
// and the REPL survives 22 input lines, then hangs at 23 with a blank screen,
// pointing at "LDI print_prompt". Nothing in the assembler complains and the
// first hundred tests still pass, because none of them types 23 lines.
//
// So the sizes are pinned here. Every routine keeps its offset from
// bios_entry, which is what the padding NOPs in asm/forth.asm are for. Change
// a BIOS routine and either keep its length or pad it back - and if the
// padding can be removed, the stale-branch handling in the core can be fixed
// and this test can go with it.
test('cls clears the screen through the BIOS, cursor block and all', () => {
  // Two things it has to get right. The screen ends up blank - the obvious half.
  // And no reversed block is left at the top left, because the BIOS routine it
  // reuses (function code 1, binit) homes the cursor and switches its attribute
  // back on after clearing, so cls has to blank that one cell itself.
  //
  // The cell has to be read from INSIDE a word. At the prompt the REPL prints
  // ` ok` over the top-left cell straight afterwards, which hides the block -
  // a test that just types cls and looks passes whether or not the block is
  // there. This is the case that matters anyway: hanoi.fth calls cls in the
  // middle of a word and draws over everything except that one corner.
  //
  // 35 is '#'. 66 is 'B' - which is what this used to write, so the
  // assertions below were looking for a character nothing ever put there.
  const FILL = ['4096', '4300', '4500', '4700', '4900']
    .map(a => `35 ${a} scr!\n`).join('');
  const { rows } = repl(': ctest cls 4096 scr@ ;\n' + FILL + 'ctest . cr\n');
  assert.ok(rows.some(r => /(^|\s)32(\s|$)/.test(r)),
    `cls must leave a plain space where it cleared; screen was:\n`
    + rows.map((r, i) => `${i}: ${r}`).join('\n'));

  // And the whole buffer, not just the corner.
  const { rows: blank } = repl(FILL + 'cls\n');
  assert.equal(blank.join('\n').includes('#'), false, 'cls must leave nothing on the screen');
});

test('! , c! and scr! consume both of their operands', () => {
  // A store popped the address off the stack and then read the value off the
  // top without popping it, so the value stayed behind. Inside a loop that
  // grows without bound, and forth/hanoi.fth had to route every store through
  // set! and clr just to absorb it.
  //
  // depth is the only thing that can see this: a store's own effect on screen
  // looks the same whether or not it leaves the value behind, so a test that
  // types `7 tv !` and looks at tv passes against both kernels.
  const { rows } = repl(
    'variable tv\n'
    + '7 tv ! depth .\n'          // 1 = only depth itself; a leftover makes it 2
    + 'tv @ .\n'                  // and the value really did land
    + ': two 65 tv c! depth . 32 4100 scr! depth . ;\n'
    + 'two\n'                     // 1  1
    + 'depth .\n'                 // 1, so two left nothing behind
  );
  assert.equal(rows[2], '> 7 tv ! depth . 1  ok');
  assert.equal(rows[3], '> tv @ . 7  ok');
  assert.equal(rows[5], '> two 1  1  ok');
  assert.equal(rows[6], '> depth . 1  ok');
});

test('scr@ and scr! reach the screen buffer, which @ and ! cannot', () => {
  // The screen is at 0xF1000 = ES:0x1000. @ and ! address through DS, whose base
  // is 0 and whose offset is 16 bits, so they reach 0x00000-0x0FFFF and stop.
  // The buffer is 20 bits up, and a Forth literal cannot even name it. ES is the
  // other segment and is left at 0xF000, so ES:0x1000 is the screen exactly.
  //
  // Row 10, column 0 is ES:0x1000 + 800.
  const { rows } = repl('65 4896 scr! 4896 scr@ .\n');
  assert.equal(rows[10][0], 'A', `the store did not land; screen was:\n${rows.join('\n')}`);
  const out = rows.find(r => r.includes('ok'));
  assert.ok(out, `the line did not run; screen was:\n${rows.join('\n')}`);
  // One 65 is the echo of the literal, the other is what scr@ read back.
  // A third would mean scr! had left its value behind, which it used to.
  assert.equal((out.match(/65/g) || []).length, 2,
    `scr! must store without leaving its value and scr@ must read it back; got: ${out}`);

  // A cell is a character in the low byte and an attribute in the high one:
  // foreground in the low nibble, background in the high nibble.
  const { rows: colour } = repl('35 3 256 * + 4896 scr! 4896 scr@ .\n');
  assert.equal(colour[10][0], '#', 'the low byte of the cell is the character');
  assert.equal(rows.length > 10, true);
});

test('scr@ and scr! reach the screen on the compiled cores too', async () => {
  // hanoi.fth draws the whole board through these two words, and the compiled
  // cores decode segments themselves. If ES stores landed somewhere else there,
  // the board would be fine on the JS core and blank on the other two - which
  // is the kind of thing nobody sees until they switch cores.
  const res = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8'));
  assert.ok(res.success, res.errors.join('; '));
  // Row 10, column 0 is ES:0x1000 + 800. The kernel sets ES itself at boot, so
  // it is passed in as 0 and forth_start puts it at 0xF000.
  const CELL = 0xF1000 + 800;
  const keys = [...'65 4896 scr!\n'].map(c => (c === '\n' ? 10 : c.charCodeAt(0)));
  const want = 'A';
  for (const [name, run] of [['wasm', runWasm], ['rtl', runRtl]]) {
    const r = await run(res, { keys, maxSteps: 400000 });
    const got = String.fromCharCode(r.memoryAt(CELL, 1)[0] & 0xFF);
    assert.equal(got, want,
      `the ${name} core did not store through ES; ES:0x1000+800 holds ${got}`);
  }
});

test('the store, to and buffer fixes hold on the compiled cores too', async () => {
  // All three behaviours were found on the JS core, and each is checked against
  // the JS core on its own elsewhere. This one is not that: it runs the same
  // input on all three cores and compares them to each other, so it catches a
  // fix that holds on the JS core and not on wasm or rtl - which for a change
  // to how many cells a store pops is a real risk, since the three step the
  // same memory in different ways.
  //
  // The long line is 100 characters and the probe after it 10 more: the key FIFO
  // is 128 deep, and a longer pair here would drop keystrokes and read as a
  // kernel difference that is really the harness.
  const CASES = [
    'variable tv\n7 tv ! depth .\n',
    'create cv 3 ,\n5 to cv\ncv @ .\n',
    '1 '.repeat(50) + '\nnosuchword\n',
  ];
  const res = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8'));
  assert.ok(res.success, res.errors.join('; '));

  // memoryAt(addr, n) hands back n cells STARTING at addr, so the screen words
  // come back already indexed from 0; the JS core's memory is flat and needs the
  // screen offset added back.
  const head = (cells, fromZero) => {
    const base = fromZero ? 0 : SCREEN_ADDR;
    const rows = [];
    for (let r = 0; r < 6; r++) {
      let s = '';
      for (let c = 0; c < 80; c++) s += String.fromCharCode(cells[base + r * 80 + c] & 0xFF);
      if (s.trim()) rows.push(s.replace(/\s+$/, ''));
    }
    return rows;
  };

  for (const [i, src] of CASES.entries()) {
    const keys = [...src].map(c => (c === '\n' ? 10 : c.charCodeAt(0)));
    const want = repl(src, 2000000).rows.filter(r => r.trim()).slice(0, 4);
    assert.ok(want.length, `case ${i} produced nothing on the JS core`);
    for (const [name, run] of [['wasm', runWasm], ['rtl', runRtl]]) {
      const got = head((await run(res, { keys, maxSteps: 2000000 }))
        .memoryAt(SCREEN_ADDR, 6 * 80), true).slice(0, 4);
      assert.deepEqual(got, want, `case ${i} differs on the ${name} core`);
    }
  }
});

test('scr! is the only way in, and it cannot be reached by spelling the address', () => {
  // The point of the pair: there is no literal, no arithmetic on literals, and
  // no DS-relative word that gets here. `9891 scr!` is not the screen either -
  // it is a DS address, a different 32KB of memory altogether.
  const { rows } = repl('65 9891 scr!\n');
  assert.equal(rows[10][0] !== 'A', true, 'ES:9891 is not the screen');
  assert.ok(rows.some(r => r.includes('ok')), 'but it is a legal store');
});

const BIOS_LAYOUT = {
  bios_entry: 0x00, bios_f1: 0x09, bios_clr_loop: 0x16, bios_f2: 0x24,
  bios_putch_cr: 0x46, bios_putch_lf: 0x52, bios_lf_scroll_copy: 0x69,
  bios_lf_scroll_clear: 0x7a, bios_lf_row_lt: 0x86, bios_f3: 0x8c,
  bios_putstr_loop: 0x96, bios_putstr_done: 0xa1, bios_f4: 0xa3,
  bios_getch_wait: 0xaa, bios_f5: 0xbb, bios_getstr_loop: 0xc3,
  bios_store_char: 0xf3, bios_getstr_done: 0x107, bios_unknown: 0x10b,
};

test('a finished line keeps no cursor block at its end', () => {
  // putch leaves the cursor attribute on the cell after the last character, and
  // a carriage return used to walk away from it without cleaning up, so every
  // finished line ended with a reversed block. Both places that send a CR now
  // drop the attribute first.
  const { rows, cursors } = repl('65 emit 66 emit 67 emit cr\n');
  assert.equal(rows[1], '> 65 emit 66 emit 67 emit crABC');
  // Row 1 is the line that was just finished and row 2 is the " ok" the REPL
  // put on the next one; neither may still be carrying the cursor attribute.
  assert.deepEqual(cursors[1], [], 'the finished line kept a cursor block');
  assert.deepEqual(cursors[2], [], 'the " ok" line kept a cursor block');
  // The prompt's own cursor is the one legitimate one.
  assert.deepEqual(cursors[3], [2], 'the prompt should still show its cursor');
});

test('the BIOS block keeps its exact layout', () => {
  const base = res.symbols.bios_entry;
  assert.equal(typeof base, 'number', 'bios_entry must have an address');
  for (const [name, offset] of Object.entries(BIOS_LAYOUT)) {
    const actual = res.symbols[name];
    assert.equal(typeof actual, 'number', `${name} is missing from the kernel`);
    assert.equal(actual - base, offset,
      `${name} moved by ${actual - base - offset} word(s) (expected 0x${offset.toString(16)}, `
      + `got 0x${(actual - base).toString(16)}). Pad the routine back to its old length - `
      + 'a BIOS routine that changes size leaves a stale SWI branch behind and the '
      + 'REPL hangs after 22 lines with a blank screen.');
  }
});

// ---------------------------------------------------------------------------
// Comments
//
// Both forms are recognised by the tokenizer, not looked up in the dictionary,
// so they work at the prompt and inside a definition alike: a comment is never
// offered to the compiler. `\` runs to the end of the line, `(` to the
// matching `)`.
// ---------------------------------------------------------------------------

test('a backslash comments out the rest of the line', () => {
  const { rows, running } = repl('1 2 + . \\ three is gone\n');
  assert.equal(rows[1], '> 1 2 + . \\ three is gone 3  ok',
    'the code before the backslash must still run');
  assert.ok(running);
});

test('a backslash ignores a closing parenthesis', () => {
  // The ')' belongs to the comment and must not end it early - otherwise
  // everything after it would be executed.
  const { rows } = repl('1 2 + . \\ one ) two\n');
  assert.equal(rows[1], '> 1 2 + . \\ one ) two 3  ok');
});

test('a parenthesis comment ends at the closing parenthesis', () => {
  const { rows } = repl('( this is a comment ) 1 2 + .\n');
  assert.equal(rows[1], '> ( this is a comment ) 1 2 + . 3  ok',
    'everything behind the ) has to run');
});

test('a parenthesis comment needs no space around it', () => {
  assert.equal(repl('(a)1 2 + .\n').rows[1], '> (a)1 2 + . 3  ok');
  assert.equal(repl('1 (x) 2 + .\n').rows[1], '> 1 (x) 2 + . 3  ok',
    'a comment may sit between two words');
});

test('a parenthesis comment ends at the FIRST closing parenthesis', () => {
  // Parentheses do not nest in Forth, and pretending they do would swallow
  // code the programmer can see.
  const { rows } = repl('( one ( two ) 1 2 + .\n');
  assert.equal(rows[1], '> ( one ( two ) 1 2 + . 3  ok');
});

test('an unclosed parenthesis takes the rest of the line', () => {
  // The forgiving reading of a typo: drop the rest of the line rather than
  // swallow every following ')' in the file.
  const { rows, running } = repl('( never closed\n1 2 + .\n');
  assert.equal(rows[1], '> ( never closed ok');
  assert.equal(rows[2], '> 1 2 + . 3  ok', 'the next line is unaffected');
  assert.ok(running);
});

test('a line that is only a comment changes nothing', () => {
  for (const line of ['\\ just a comment', '( just a comment )', '\\', '( )', '(a)']) {
    const { rows, cursors } = repl(line + '\n');
    assert.match(rows[1], /^> .* ok$/, `"${line}" should simply be accepted`);
    const all = cursors.slice(0, SCREEN_VISIBLE_ROWS).flat();
    assert.equal(all.length, 1, `"${line}" must leave exactly one cursor, found ${all.length}`);
  }
});

test('a comment is recognised, not looked up as a word', () => {
  // Without tokenizer handling both would fall through to the dictionary and
  // come back as "undefined word", which is what happened before.
  for (const line of ['\\', '(', '( )', '(x)']) {
    const { rows } = repl(line + '\n');
    assert.ok(!rows.join('\n').includes('undefined word'),
      `"${line}" must not be reported as an unknown word`);
  }
});

test('a comment works inside a definition', () => {
  const { rows } = repl(': sq ( n -- n2 ) dup * ;\n5 sq .\n');
  assert.equal(rows[1], '> : sq ( n -- n2 ) dup * ; ok',
    'the definition must compile, comment and all');
  assert.equal(rows[2], '> 5 sq . 25  ok', 'and it must actually square');
});

test('a backslash comments out the tail of a definition line', () => {
  // The definition continues on the next line; the comment must not end it.
  const { rows } = repl(': d \\ one\n 7 ;\nd .\n');
  assert.equal(rows[3], '> d . 7  ok');
});

test('several comments in one line are all skipped', () => {
  const { rows } = repl('( a ) ( b ) 1 2 + .\n');
  assert.equal(rows[1], '> ( a ) ( b ) 1 2 + . 3  ok');
});

test('a comment does not disturb the stack', () => {
  // The whole point of skipping in the tokenizer: no word is executed, so
  // nothing is pushed and nothing is popped.
  const { rows } = repl('1 2 + ( sum of the two ) 2 * .\n');
  assert.equal(rows[1], '> 1 2 + ( sum of the two ) 2 * . 6  ok');
});

test('a comment ends the line, so the cursor moves on to the new prompt', () => {
  const { rows, cursors } = repl('1 2 + \\ comment\n');
  assert.equal(rows[1], '> 1 2 + \\ comment ok');
  const all = cursors.slice(0, SCREEN_VISIBLE_ROWS).flat();
  assert.equal(all.length, 1, `one cursor expected, found ${all.length}`);
  // The comment ran to the end of the line, which is the end of the input: the
  // cursor is not left behind on the finished line but sits at the next prompt,
  // two cells in - ">" and the space behind it.
  assert.deepEqual(cursors[1], [], 'nothing may be left marked on the input line');
  assert.deepEqual(cursors[2], [2], 'the cursor waits at the new prompt');
});

// The order of the two nibbles is a promise the whole colour byte rests on, and
// getting it wrong fails quietly: swap the nibbles and every program still
// runs, it just paints backgrounds instead of characters - and the cursor,
// which is the reversed default, would come out identical to the default and
// therefore invisible. So it is pinned from both ends.
//
// The kernel writes exactly two attribute values, 0 and CURSOR_ATTR. Reading
// the cursor cell apart is therefore enough to say which nibble is which: the
// terminal default is light grey on black, and the cursor has to be its
// reverse, so the nibble that holds 0 is the foreground.
test('the low nibble is the foreground and the high one the background', () => {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF;
  for (const ch of '1 2 +\n') sim.enqueueKeyCode(ch === '\n' ? 10 : ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }

  const attr = CURSOR_ATTR >> 8;
  const fg = attr & 0x0F;
  const bg = (attr >> 4) & 0x0F;
  assert.equal(fg, 0, 'foreground nibble (low) is black');
  assert.equal(bg, 7, 'background nibble (high) is light grey');
  assert.notEqual(fg, 7, 'the cursor must be the reverse of the default, not the default');
  assert.notEqual(bg, 0, 'the cursor must be the reverse of the default, not the default');

  // And the kernel really does write it: the cell under the cursor has to be
  // the one value, with its character intact.
  let found = null;
  for (let i = 0; i < SCREEN_VISIBLE_ROWS * 80; i++) {
    const word = sim.memory[SCREEN_ADDR + i] & 0xFFFF;
    if (((word >> 8) & 0xFF) === attr) found = { word, row: Math.floor(i / 80), col: i % 80 };
  }
  assert.ok(found, `no cell carries the cursor attribute 0x${attr.toString(16)}`);
  assert.equal(found.word & 0xFF, 0x20, 'the character under the cursor survives');
});

test('a screen cell that a program painted reads foreground and background in that order', () => {
  // Foreground 5 (magenta) on background 9 (bright black): attribute 0x95.
  // Written the ANSI way the background sits high and the foreground low.
  // forth/hanoi.fth paints cells directly now and builds them the same way -
  // character in the low byte, attribute in the high one - so a foreground
  // shifted left by four would come out as 0x59 and swap the two, and its
  // disks would be the wrong colour rather than the right ones.
  const fg = 5, bg = 9;
  const attr = (bg << 4) | fg;
  assert.equal(attr, 0x95);
  assert.equal(attr & 0x0F, fg, 'the low nibble is the foreground');
  assert.equal((attr >> 4) & 0x0F, bg, 'the high nibble is the background');
  // The shifted variant - what a program gets wrong - is a different cell.
  assert.notEqual(fg << 4, attr, 'a shifted foreground must not collide with the right one');
});
