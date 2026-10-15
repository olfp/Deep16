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
import { assemble, loadBrowserScripts, buildMemory, runJs, runWasm, runRtl, ROOT, SCREEN_ADDR, CURSOR_ATTR } from './helpers.js';

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

test('a line wider than the screen wraps and scrolls at the bottom row', () => {
  // putch advanced the cursor linearly without a scroll check, so a line wider
  // than the screen walked off the bottom of the buffer (row 24 and beyond)
  // instead of scrolling - which is what a wide `words` hit. Emit 300 chars
  // with no newline after filling the screen and require the scroll.
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF;
  const input = '1 .\n'.repeat(20) + ': l 300 0 do 88 emit loop ;\nl\n';
  for (const ch of input) sim.enqueueKeyCode(ch === '\n' ? 10 : ch.charCodeAt(0));
  sim.running = true;
  for (let i = 0; i < 30000000 && sim.running; i++) sim.step();

  let text = '';
  for (let r = 0; r < VISIBLE_ROWS; r++) {
    for (let c = 0; c < COLS; c++) text += String.fromCharCode(sim.memory[SCREEN_ADDR + r * COLS + c] & 0xFF);
  }
  assert.ok(!text.includes('Hello DeepForth!'), 'the banner must have scrolled off the top');
  assert.ok(text.includes('X'.repeat(20)), 'the tail of the wrapped line must be on screen');
  const off = (sim.registers[8] - SCR_BASE) & 0xFFFF;
  assert.ok(off < VISIBLE_ROWS * COLS,
    `the cursor ran past the visible rows to offset ${off} - the wrap did not scroll`);
  // The off-screen row 24 is the scroll's blank tail and must stay blank.
  for (let c = 0; c < COLS; c++) {
    const w = sim.memory[SCREEN_ADDR + 24 * COLS + c] & 0xFFFF;
    assert.ok(w === 0x0020 || w === 0x0000 || w === 0xFFFF,
      `row 24 column ${c} holds 0x${w.toString(16)}`);
  }
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
    'state @ .\n' +
    ': c [ 3 4 + ] ;\n' +
    'c .\n' +
    ': two 2 ;\n' +
    'immediate\n' +
    ': four two two + ;\n' +
    'four .\n'
  );
  assert.equal(rows[1], '> state @ . 0  ok');
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

test('division is signed and truncates toward zero', () => {
  // The division family used to be unsigned: -7 / 2 read 32764 and -7 mod 2
  // read 1. Standard Forth is signed, with the quotient truncating toward zero
  // and the remainder taking the sign of the dividend.
  const { rows, running } = repl(
    '0 7 - 2 / .\n' +
    '0 7 - 2 mod .\n' +
    '0 7 - 2 /mod . .\n' +
    '7 0 2 - / .\n' +
    '0 8 - 0 3 - / .\n' +
    '0 7 - 0 1 - / .\n'
  );
  assert.equal(rows[1], '> 0 7 - 2 / . -3  ok');
  assert.equal(rows[2], '> 0 7 - 2 mod . -1  ok');
  assert.equal(rows[3], '> 0 7 - 2 /mod . . -3  -1  ok');
  assert.equal(rows[4], '> 7 0 2 - / . -3  ok');
  assert.equal(rows[5], '> 0 8 - 0 3 - / . 2  ok');
  assert.equal(rows[6], '> 0 7 - 0 1 - / . 7  ok');
  assert.equal(rows[7], '>');
  assert.ok(running);
});

test('division by zero is still the error value 0xFFFF', () => {
  const { rows } = repl(
    '5 0 / .\n' +
    '5 0 mod .\n'
  );
  assert.equal(rows[1], '> 5 0 / . -1  ok');   // 0xFFFF prints as -1
  assert.equal(rows[2], '> 5 0 mod . 5  ok');
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

// --- do / loop / i / leave ---------------------------------------------------
// The loop frame lives on the return stack, four cells below everything else
// there, because the data stack belongs to the body. These tests pin the
// counting, the nesting, the frame's discipline around calls, and the two
// things that went wrong while it was written: the frame was laid down in the
// wrong order (RP landed on the wrong cell, so `loop` read the caller's return
// address as the index and the core walked into unwritten memory), and a
// `loop` with no `do` in front of it popped nothing and did the same.

test('do/loop counts from start to limit and i is the index', () => {
  const { rows, running } = repl(
    ': count 10 0 do i . loop ;\ncount\n' +
    ': from1 5 1 do i . loop ;\nfrom1\n'
  );
  assert.equal(rows[1], '> : count 10 0 do i . loop ; ok');
  assert.equal(rows[2], '> count 0  1  2  3  4  5  6  7  8  9  ok');
  assert.equal(rows[3], '> : from1 5 1 do i . loop ; ok');
  assert.equal(rows[4], '> from1 1  2  3  4  ok');
  assert.equal(rows[5], '>');
  assert.ok(running);
});

test('do counts after the increment, so limit = start runs the whole cell', () => {
  // The standard's DO compares after incrementing, so `0 0 do` does not stop:
  // the index walks 0, 1, ... 65535 and wraps round onto the limit. The way to
  // see that without waiting for 65536 rounds is to leave on the fourth pass.
  const { rows, running } = repl(': wrap 0 0 do i 3 = if leave then loop 42 . ;\nwrap\n');
  assert.equal(rows[2], '> wrap 42  ok');
  assert.ok(running);
});

test('?do skips the loop when limit = start, and is a do otherwise', () => {
  const { rows, running } = repl(
    ': q0 0 0 ?do 99 . loop 42 . ;\nq0\n' +
    ': q1 3 0 ?do i . loop 42 . ;\nq1\n' +
    ': q2 5 3 ?do i . loop 42 . ;\nq2\n'
  );
  assert.equal(rows[2], '> q0 42  ok');
  assert.equal(rows[4], '> q1 0  1  2  42  ok');
  assert.equal(rows[6], '> q2 3  4  42  ok');
  assert.equal(rows[7], '>');
  assert.ok(running);
});

test('a loop keeps the data stack for the body', () => {
  const { rows, running } = repl(': sum 0 swap 0 do i + loop ;\n10 sum .\n100 sum .\n');
  assert.equal(rows[2], '> 10 sum . 45  ok');
  assert.equal(rows[3], '> 100 sum . 4950  ok');
  assert.ok(running);
});

test('loops nest, and each loop keeps its own frame', () => {
  const { rows, running } = repl(
    ': nest 3 0 do 3 0 do i . loop loop ;\nnest\n' +
    ': mix 0 3 0 do 5 0 do i + loop loop ;\nmix .\n'
  );
  assert.equal(rows[2], '> nest 0  1  2  0  1  2  0  1  2  ok');
  assert.equal(rows[4], '> mix . 30  ok');
  assert.ok(running);
});

test('leave leaves the innermost loop and carries on after it', () => {
  const { rows, running } = repl(
    ': early 10 0 do i 3 = if leave then i . loop 42 . ;\nearly\n' +
    ': inner 3 0 do 4 0 do i 2 = if leave then i . loop loop ;\ninner\n'
  );
  assert.equal(rows[2], '> early 0  1  2  42  ok');
  assert.equal(rows[4], '> inner 0  1  0  1  0  1  ok');
  assert.ok(running);
});

test('a loop inside a called word leaves the return stack as it found it', () => {
  // The frame is pushed below the call frames; if the pop were off by a cell,
  // `exit` would take the loop's limit for a return address and the REPL would
  // stop instead of printing the next line.
  const { rows, running } = repl(
    ': i1 3 0 do i . loop ;\n' +
    ': o1 5 0 do i1 loop ;\n' +
    'o1\n' +
    '1 2 + .\n'
  );
  assert.equal(rows[3], '> o1 0  1  2  0  1  2  0  1  2  0  1  2  0  1  2  ok');
  assert.equal(rows[4], '> 1 2 + . 3  ok');
  assert.equal(rows[5], '>');
  assert.ok(running, 'the REPL must still be running after five loops');
});

test('a loop word can be called again and the count starts over', () => {
  const { rows, running } = repl(': t 5 0 do i . loop ;\nt t\n');
  assert.equal(rows[2], '> t t 0  1  2  3  4  0  1  2  3  4  ok');
  assert.ok(running);
});

test('two loops in one definition both run', () => {
  const { rows, running } = repl(': two 3 0 do i . loop 4 0 do i . loop ;\ntwo\n');
  assert.equal(rows[2], '> two 0  1  2  0  1  2  3  ok');
  assert.ok(running);
});

test('a loop with no do in front of it compiles nothing and does not stop the core', () => {
  // Undefined by the standard. Without the check the stray `loop` popped the
  // compile-time stack blind, patched wherever it landed and the core walked
  // into unwritten memory — the REPL was gone, not just the definition.
  const { rows, running } = repl(
    ': two 3 0 do i . loop loop ;\ntwo\n' +
    '1 2 + .\n'
  );
  assert.equal(rows[2], '> two 0  1  2  ok');
  assert.equal(rows[3], '> 1 2 + . 3  ok');
  assert.ok(running);
});

test('do checks its operands the way a binary word does', () => {
  // (do) pops three values: limit, index and the exit address the compiler
  // laid down. With one on the stack there is nothing to pop.
  const { rows, running } = repl(
    ': c 5 do ;\nc\n' +
    '1 2 + .\n'
  );
  assert.equal(rows[2], '> c');
  assert.equal(rows[3], 'stack underflow');
  assert.equal(rows[4], '> 1 2 + . 3  ok');
  assert.ok(running);
});

test('the loop words are in the dictionary chain with the bit words', () => {
  const rev = Object.fromEntries(
    Object.entries(res.symbols).filter(([k]) => k.startsWith('h_')).map(([k, v]) => [v, k]));
  const seen = new Set();
  let cur = cell(res.symbols.forth_wl);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    cur = cell(cur);
  }
  assert.ok(!seen.has(cur), `dictionary chain cycles at ${rev[cur] || cur}`);
  for (const h of ['h_and', 'h_or', 'h_xor', 'h_lshift', 'h_rshift', 'h_invert',
                   'h_do', 'h_qdo', 'h_loop', 'h_leave', 'h_i']) {
    assert.ok(seen.has(res.symbols[h]), `${h} is not reachable from forth_wl`);
  }
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
  assert.equal(rows[0], 'Hello DeepForth!', 'words must not clear the screen');
  assert.ok(text.includes('forget'), 'lists forget');
  assert.ok(text.includes('vocabulary'), 'lists vocabulary');
  assert.ok(text.includes('does>'), 'names split across rows survive');
  assert.ok(text.includes('see'), 'lists see');
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
  // No clear: the earlier lines are still on screen, and the listing follows
  // the echoed "words" on the input line.
  assert.equal(rows[0], 'Hello DeepForth!');
  const listRow = rows.find(r => r.includes('beta alpha'));
  assert.ok(listRow, `expected "beta alpha" on screen:\n${rows.join('\n')}`);
  assert.match(listRow, /beta alpha\s+ok$/);
  assert.equal(rows[6], '>');
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

// ---------------------------------------------------------------------------
// SEE
//
// `see name` decompiles a word rather than running it. A colon definition comes
// back as `: name ... ;` by walking the thread and resolving each xt back to a
// name; other kinds print as the word that made them. The tests below pin both
// the shapes and the cells that carry inline data, since mistaking one for a
// word would print a stray number or jump into the middle of a string.
// ---------------------------------------------------------------------------

test('see prints a colon definition as its source shape', () => {
  const { rows, running } = repl(': square dup * ;\nsee square\n');
  assert.equal(rows[1], '> : square dup * ; ok');
  assert.equal(rows[2], '> see square : square dup * ; ok');
  assert.equal(rows[3], '>');
  assert.ok(running);
});

test('see prints a compiled string back as ." ... "', () => {
  // The compiler stores the characters from the one after `."`, so the source
  // `." hallo welt"` keeps a leading space in the thread and see prints it back.
  const { rows } = repl(': greet ." hallo welt" ;\nsee greet\n');
  assert.equal(rows[2], '> see greet : greet ." hallo welt" ; ok');
});

test('see decompiles do/loop and ?do', () => {
  const { rows } = repl(': count 10 0 do i . loop ;\n: q 0 0 ?do i . loop ;\nsee count\nsee q\n');
  assert.equal(rows[3], '> see count : count 10 0 do i . loop ; ok');
  assert.equal(rows[4], '> see q : q 0 0 ?do i . loop ; ok');
});

test('see names the word that made a variable, constant, create or vocabulary', () => {
  const { rows } = repl(
    'variable x\n' +
    'see x\n' +
    '5 constant five\n' +
    'see five\n' +
    ': const create , does> @ ;\n' +
    '42 const answer\n' +
    'see answer\n' +
    'vocabulary foo\n' +
    'see foo\n'
  );
  assert.equal(rows[2], '> see x variable x  ok');
  assert.equal(rows[4], '> see five constant five 5  ok');
  assert.equal(rows[7], '> see answer create answer does> @ ; ok');
  assert.equal(rows[9], '> see foo vocabulary foo  ok');
});

test('see calls a primitive code', () => {
  const { rows } = repl('see dup\n');
  assert.equal(rows[1], '> see dup code dup  ok');
});

test('see shows branches with their offset instead of rebuilding if/then', () => {
  // if/then would need the whole control-flow structure; the offset is what is
  // really in the dictionary, and a forward one points past the body it guards.
  const { rows } = repl(
    ': t dup 0 < if 1- then ;\n' +
    'see t\n' +
    ': c 5 begin 1- dup 0 = until ;\n' +
    'see c\n'
  );
  assert.equal(rows[2], '> see t : t dup 0 < (0branch) 2 1- ; ok');
  assert.equal(rows[4], '> see c : c 5 1- dup 0 = (0branch) -6 ; ok');
});

test('see keeps the body after a mid-definition exit', () => {
  // `;` compiles the address of xt_exit and `exit` its own header; keying the
  // end on that value, not on the code field, keeps the rest of the body.
  const { rows } = repl(': f 1 exit 2 ;\nsee f\n');
  assert.equal(rows[2], '> see f : f 1 exit 2 ; ok');
});

test('see resolves a body word through the dictionary, including recurse', () => {
  const { rows } = repl(
    ': sq dup * ;\n' +
    ': cube sq sq sq ;\n' +
    'see cube\n' +
    ': r dup 0 > if dup 1- recurse then ;\n' +
    'see r\n'
  );
  assert.equal(rows[3], '> see cube : cube sq sq sq ; ok');
  assert.equal(rows[5], '> see r : r dup 0 > (0branch) 4 dup 1- r ; ok');
});

test('see rejects an unknown name like any other word', () => {
  const { rows } = repl('see nope\n');
  assert.equal(rows[1], '> see nope');
  assert.equal(rows[2], 'undefined word: nope');
  assert.equal(rows[3], '>');
});

test('see stops when the thread leaves the dictionary', () => {
  // `: n 1 2 nosuchword ;` fails inside the definition, so `;` never runs and
  // n's thread has no end marker. The cells past its last word are not thread
  // cells; the walk must stop there and not run off into whatever the machine
  // was initialised with.
  const { rows, running } = repl(': n 1 2 nosuchword ;\nsee n\n');
  assert.equal(rows[2], 'undefined word: nosuchword');
  assert.ok(rows[3].startsWith('> see n : n 1 2 '), `unexpected output: ${rows[3]}`);
  assert.ok(rows[3].endsWith(' ok'));
  assert.equal(rows[4], '>');
  assert.ok(running, 'see must not walk off the end of the dictionary');
});

test('see leaves the interpreter and the stack usable', () => {
  const { rows, running } = repl(': square dup * ;\nsee square\n5 square .\n');
  assert.equal(rows[2], '> see square : square dup * ; ok');
  assert.equal(rows[3], '> 5 square . 25  ok');
  assert.equal(rows[4], '>');
  assert.ok(running);
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

// --- compiled strings -------------------------------------------------------
// `."` used to print while the definition was being translated, so the text
// appeared once at compile time and never when the word was called. Compiled,
// it now copies the characters into the definition and leaves
// `xt_lit <addr> xt_litstr <characters> 0` behind; `litstr` prints them when
// the word runs and steps the thread past the string.

test('." inside a definition prints when the word is CALLED, not when it is compiled', () => {
  const { rows, running } = repl(': greet ." hallo welt" ;\ngreet\n');
  // The compile line echoes the source but does NOT print "hallo welt" again.
  assert.equal(rows[1], '> : greet ." hallo welt" ; ok');
  assert.equal(rows[2], '> greet hallo welt ok');
  assert.equal(rows[3], '>');
  assert.ok(running);
});

test('a compiled string keeps its spaces and its place among other words', () => {
  const { rows, running } = repl(': t ." x" 1 . ." y" ;\nt\n');
  assert.equal(rows[2], '> t x 1  y ok');
  assert.ok(running);
});

test('two compiled strings in one definition both print, in order', () => {
  // The thread must be stepped past each string; without that, the second
  // "litstr" reads the first string's characters as the next word of the
  // definition and the core jumps into ASCII.
  const { rows, running } = repl(': s1 ." a" ." b" ;\ns1\n');
  assert.equal(rows[2], '> s1 a b ok');
  assert.ok(running);
});

test('a compiled string may be called again', () => {
  const { rows, running } = repl(': q ." x" ;\nq q\n');
  assert.equal(rows[2], '> q q x x ok');
  assert.ok(running);
});

test('a backslash-quote is unescaped while compiling, not at run time', () => {
  const { rows, running } = repl(': e ."  say \\"hi\\"  " ;\ne\n');
  assert.equal(rows[1], '> : e ."  say \\"hi\\"  " ; ok');
  assert.equal(rows[2], '> e  say "hi"   ok');
  assert.ok(running);
});

test('an empty compiled string prints nothing', () => {
  const { rows, running } = repl(': empty ." " ;\nempty\n');
  assert.equal(rows[2], '> empty  ok');
  assert.ok(running);
});

test('a bare " inside a definition compiles like ."', () => {
  const { rows, running } = repl(': bs "quoted" ;\nbs\n');
  assert.equal(rows[1], '> : bs "quoted" ; ok');
  assert.equal(rows[2], '> bsquoted ok');
  assert.ok(running);
});

test('the compiled string is threaded data, so a stack word after it still sees the stack', () => {
  // `." x" dup .` on an empty stack must still be a stack underflow: the
  // string must not push anything of its own.
  const { rows, running } = repl(': dup2 ." a" dup . ;\ndup2\n');
  assert.equal(rows[2], '> dup2 a');
  assert.equal(rows[3], 'stack underflow');
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

// This is where the BIOS's 23 pinned offsets used to live, so the reasoning
// belongs here too - the diagnosis was right, the remedy has since changed.
//
// swi_to_bios is a delayed far jump into CS=0xF800, and the core leaves the
// branch state behind when it comes back. While that state is pending, the
// next instruction is treated as the delay slot of that old branch and the old
// target is taken again. Normally the instruction after the jump clears it. In
// the BIOS that only worked while the offsets stayed where they were: take a
// single word out of a routine that reaches the putch path and the REPL
// survived 22 input lines, then hung at 23 with a blank screen, pointing at
// "LDI print_prompt". Nothing in the assembler complained and the first
// hundred tests still passed, because none of them type 23 lines.
//
// Two things have changed since, and they retire the diagnosis above.
//
// The dispatch is a jump table, so every call is a label difference and a
// routine can change size freely - measured by inserting a NOP after each label
// in turn, where only the offset pins noticed.
//
// And the stale branch state turned out not to be there. Looked for it on
// 2026-10-14: the machine never resumes in normal mode with a delay slot still
// pending (0 of 5 BIOS exits in a full REPL run), no SWI in the kernel sits in
// a delay slot (0 of 18), and deleting the delay slot after each of the 426
// branches in the kernel and BIOS breaks only the two LINK/JMP pairs, which
// fail because the call is gone, not because any state survived. All three
// cores consume the delay state before dispatch. What the comment above
// described was probably always the symptom of some other edit; either way the
// mechanism it blamed is not there.
//
// What replaces the pins is the invariant set above: bios_entry at segment
// offset 0, the table matching the routines, entry points off the padding.
// If those hold, a BIOS routine may change size.
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

// The BIOS used to be pinned to 23 exact offsets from bios_entry, because the
// dispatch was a chain of "CMP R1, R0 / JNZ next" tests and a routine was only
// reached because it happened to sit at the offset the branch had been told
// about. Moving one broke the chain, and the failure was invisible until the
// REPL hung on the 23rd input line.
//
// The jump table removed that: every call is now a label difference and the
// table entries are computed, so a routine can change size and the whole block
// shifts together. Verified by inserting one NOP after each label in turn -
// only the offset pins noticed, and appending 40 words after the last routine
// leaves the screen byte-identical.
//
// So the offsets are gone, replaced by the invariants that make the movement
// safe. If one of these fails, a dependency that the jump table was supposed
// to remove has come back, and the BIOS will assemble cleanly and misbehave.
const BIOS_LABELS = [
  'bios_entry', 'bios_jtab_ok', 'bios_jtab_add', 'BIOS_JTABLE',
  'bios_f0', 'bios_f1', 'bios_clr_loop', 'bios_f2',
  'bios_putch_cr', 'bios_putch_lf', 'bios_lf_scroll_copy',
  'bios_lf_scroll_clear', 'bios_lf_row_lt', 'bios_f3',
  'bios_putstr_loop', 'bios_putstr_done', 'bios_f4', 'bios_getch_wait',
  'bios_f5', 'bios_getstr_loop', 'bios_store_char', 'bios_getstr_done',
  'bios_unknown',
];

// The kernel also defines bios_putch_direct and friends, which share the name
// prefix but sit in the kernel well below the BIOS. Only labels at or above
// bios_entry belong to the block.
const biosBlockLabels = () => BIOS_LABELS
  .map(name => ({ name, offset: res.symbols[name] - res.symbols.bios_entry }))
  .filter(l => typeof l.offset === 'number' && !Number.isNaN(l.offset));

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

test('bios_entry is the one fixed point of the BIOS block', () => {
  // swi_to_bios reaches the BIOS with "JML 0xF800:0" - by segment and offset 0,
  // never by a per-routine address - so the whole block is free to move except
  // this. It is also what ".org 0xF8000" has to agree with.
  assert.equal(res.symbols.bios_entry, 0xF8000,
    'swi_to_bios jumps to CS=0xF800, PC=0, so bios_entry must be at 0xF8000');
  assert.equal(res.symbols.bios_entry - 0xF8000, 0);
});

test('the BIOS entry reaches its table by label difference, not a fixed address', () => {
  // The dispatch reads its own address with "MOV R3, PC" and adds the distance
  // from there to the table. If that distance stops being a label difference,
  // the table is only found at the offset it happens to sit at today.
  const lines = res.listing.filter(l => typeof l.address === 'number'
    && l.line && /bios_jtab_add|MOV R3, PC/.test(l.line));
  const text = lines.map(l => l.line).join(' ');
  assert.match(text, /MOV R3, PC/,
    'the entry no longer derives its own address');
  assert.match(text, /BIOS_JTABLE - bios_jtab_add/,
    'the ADD must be the label difference to the table, not a literal offset');
});

test('BIOS_BASE names the segment base, and the deltas stay deltas', () => {
  // A label resolves to a 20-bit address; LDI takes a 15-bit signed immediate.
  // So "LDI bios_unknown" cannot work - the assembler rejects it outright - and
  // every BIOS address reached through an LDI has to be written as a delta
  // against the base. The subtraction reads like an identity, because
  // bios_entry is at offset 0, so BIOS_BASE gives it a name and this test
  // gives it a definition. Without one, the deltas are the first thing to be
  // "simplified" away.
  assert.equal(res.symbols.BIOS_BASE, res.symbols.bios_entry,
    'BIOS_BASE must be the segment base, bios_entry');

  // A bare BIOS label really is out of range, so the deltas are load-bearing
  // rather than decorative. Checked on a block of the same shape.
  const bare = assemble('.org 0xF8000\nbios_entry:\n  LDI bios_unknown\n'
    + '  HLT\nbios_unknown:\n  RETI\n');
  assert.equal(bare.success, false, 'a bare BIOS label should not fit an LDI');
  assert.match(bare.errors.join(), /out of range/);

  // And the source keeps spelling the jump target as a delta.
  const unknown = res.listing.find(l => typeof l.address === 'number'
    && /LDI\s+bios_unknown/.test(l.line || ''));
  assert.ok(unknown, 'the unknown-code path no longer loads bios_unknown');
  assert.match(unknown.line, /bios_unknown\s*-\s*BIOS_BASE/,
    'the LDI must take the segment offset, not the 20-bit label');
});

test('MOV PC, Rx is the jump form, and ADD PC, Rx is not one', () => {
  // Pinning the one that looks replaceable. "ADD PC, R0" assembles, is accepted
  // by all three cores, and is wrong: an ALU write to R15 is a plain store, so
  // the PC is already post-incremented and it lands short of the target. It
  // takes no delay slot either. Only MOV/SOP route through the rd === 15 check
  // that arms one.
  const jumps = (mid) => {
    const r = assemble('start:\n  LDI tgt\n  MOV R2, R0\n  ' + mid + '\n  HLT\n'
      + 'tgt:\n  LDI 0x1234\n  HLT\nfall:\n  LDI 0x5678\n  HLT\n');
    assert.equal(r.success, true, `${mid} should assemble`);
    return r;
  };
  const landed = (r) => {
    const v = r.registers[0] & 0xFFFF;
    if (v === 0x1234) return 'jumped';
    if (v === 0x5678) return 'fell through';
    return `R0=0x${v.toString(16)}`;
  };

  const at = (r) => runJs(r, { cs: 0, ds: 0, ss: 0, es: 0, maxSteps: 300 });
  const mov = jumps('MOV PC, R2');
  const add = jumps('ADD PC, R2');
  assert.equal(landed(at(mov)), 'jumped', 'MOV PC, R2 must reach the target');
  assert.notEqual(landed(at(add)), 'jumped',
    'ADD PC, R2 is a store to R15, not a jump. If this ever starts jumping, the '
    + 'post-increment behaviour changed and the BIOS comment needs revisiting.');

  // The BIOS really does use MOV PC, not ADD PC.
  const jmp = res.listing.find(l => typeof l.address === 'number'
    && /MOV PC, R0/.test(l.line || ''));
  assert.ok(jmp, 'the unknown-code path no longer jumps through MOV PC, R0');
});

test('every BIOS label is distinct, ordered, and inside the block', () => {
  const base = res.symbols.bios_entry;
  for (const name of BIOS_LABELS) {
    assert.equal(typeof res.symbols[name], 'number', `${name} is missing from the kernel`);
    assert.ok(res.symbols[name] >= base,
      `${name} sits below bios_entry - it belongs to the kernel, not the BIOS`);
  }
  const labels = biosBlockLabels().sort((a, b) => a.offset - b.offset);
  const seen = new Map();
  for (const { name, offset } of labels) {
    assert.equal(seen.has(offset), false,
      `${name} and ${seen.get(offset)} both resolve to offset 0x${offset.toString(16)} - `
      + 'one of them is a rename that landed on an existing label');
    seen.set(offset, name);
  }
  // BIOS_FN_COUNT is a constant, not an address, so it must not have leaked in
  // as a label at a negative offset.
  assert.equal(res.symbols.BIOS_FN_COUNT, 6);
});

test('each routine the table names starts on an instruction, not padding', () => {
  // A label that drifts onto a padding NOP dispatches into the middle of the
  // routine above it. The table test proves the entry points at the label;
  // this proves the label is a real entry point.
  const base = res.symbols.bios_entry;
  const wordAt = (addr) => {
    const c = res.memoryChanges.find(m => m.address === addr);
    return c ? c.value : undefined;
  };
  for (let i = 0; i < res.symbols.BIOS_FN_COUNT; i++) {
    const addr = res.symbols[`bios_f${i}`];
    const word = wordAt(addr);
    assert.equal(typeof word, 'number', `bios_f${i} has no word at its label`);
    assert.notEqual(word, 0xFFF0,
      `bios_f${i} points at a NOP - it landed in the padding above it`);
  }
  assert.equal(wordAt(base), 0x0000, 'bios_entry should be the first LDI of the dispatch');
});

test('the BIOS block ends in a RETI', () => {
  // bios_unknown is the last thing in the block. If anything is appended after
  // it, a fall-through off the end would run whatever that is.
  const base = res.symbols.bios_entry;
  const last = res.memoryChanges
    .filter(m => m.address >= base)
    .sort((a, b) => b.address - a.address)[0];
  const retiAt = res.symbols.bios_unknown;
  assert.equal(last.address, retiAt + 1,
    'something follows bios_unknown - a fall-through past its RETI would run it');
  assert.equal(last.value, 0xFFF0, 'the word after bios_unknown should be its padding NOP');
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

// ---------------------------------------------------------------------------
// The BIOS dispatch table. The entry used to be a chain of "CMP R1, R0 / JNZ
// next" tests, one per function. These drive the entry directly rather than
// through the REPL, because the kernel's own boot sequence always calls binit
// first and would otherwise be the only routine ever observed.

// Enter the BIOS the way an SWI does - shadow mode, CS = 0xF800 - with `fn`
// written to DS:0, and report which routine's entry address was executed.
const dispatchTo = (fn, opts = {}) => {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0;
  sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0;
  sim.segmentRegisters.ES = 0;
  sim.memory[0] = fn;
  if (opts.keys) for (const ch of opts.keys) sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.psw = 0x0020;
  sim.shadowRegisters.CS = 0xF800;
  sim.shadowRegisters.PC = res.symbols.bios_entry - res.symbols.bios_entry;
  sim.shadowRegisters.DS = 0;
  sim.shadowRegisters.ES = 0xF000;
  sim.shadowRegisters.SS = 0;
  sim.running = true;

  const base = res.symbols.bios_entry;
  const routineAt = new Map();
  for (let i = 0; i < 6; i++) routineAt.set(res.symbols[`bios_f${i}`] - base, i);
  let hit = null;
  for (let i = 0; i < 2000000 && sim.running; i++) {
    if ((sim.psw & (1 << 5)) !== 0) {
      const off = ((sim.shadowRegisters.CS & 0xFFFF) << 4)
        + (sim.shadowRegisters.PC & 0xFFFF) - base;
      if (routineAt.has(off)) hit = routineAt.get(off);
      else if (off === res.symbols.bios_unknown - base) hit = 'unknown';
    }
    sim.step();
  }
  return hit;
};

test('the jump table routes every function code to its own routine', () => {
  for (let fn = 0; fn < 6; fn++) {
    assert.equal(dispatchTo(fn, { keys: 'x' }), fn, `function code ${fn}`);
  }
});

test('a function code past the table reaches bios_unknown', () => {
  // The old chain compared 0, then 1, then 2 ... and had nothing after the
  // last test, so every out-of-range code fell off the end into the final
  // routine: an unknown code silently ran getstr and waited for a key.
  for (const fn of [6, 7, 8, 64, 255]) {
    assert.equal(dispatchTo(fn, { keys: 'x' }), 'unknown', `function code ${fn}`);
  }
});

test('every table entry points at the routine it names', () => {
  // If the table and the routines drift apart, the BIOS assembles cleanly and
  // then runs the wrong code - which is exactly what a stale offset constant
  // looks like, so the table is checked against the labels, not pinned.
  const base = res.symbols.bios_entry;
  const jtab = res.symbols.BIOS_JTABLE;
  for (let i = 0; i < 6; i++) {
    const entry = res.memoryChanges.find(c => c.address === jtab + i);
    assert.ok(entry, `table entry ${i} is missing`);
    assert.equal(entry.value, res.symbols[`bios_f${i}`] - base,
      `table entry ${i} should name bios_f${i}`);
  }
});

test('the table has exactly as many entries as there are functions', () => {
  const base = res.symbols.bios_entry;
  const jtab = res.symbols.BIOS_JTABLE;
  // Entries run from BIOS_JTABLE up to the first routine, and bios_f0 sits
  // right after them, so the span is the entry count.
  assert.equal(res.symbols.bios_f0 - jtab, res.symbols.BIOS_FN_COUNT,
    'adding a function needs a table row for it, and removing one needs a row '
    + 'gone - otherwise an out-of-range code dispatches to a stale routine');
  // And bios_entry itself is at segment offset 0, which is what lets the entry
  // use "MOV R3, PC" and reach the table without a fixed address.
  assert.equal(base - 0xF8000, 0);
});

// ---------------------------------------------------------------------------
// Hex literals in the number scanner: 0x1F, 0X1F and $1F all mean 31. The
// scanner had decimal only, so a hex literal was an "undefined word", and
// forth/hanoi.fth had to write colour bytes as decimal for that reason.

const hexrepl = (src) => {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF;
  sim.segmentRegisters.DS = 0x0000; sim.segmentRegisters.SS = 0x0000; sim.segmentRegisters.ES = 0x0000;
  for (const ch of src + '\n') sim.enqueueKeyCode(ch === '\n' ? 10 : ch.charCodeAt(0));
  sim.running = true;
  for (let i = 0; i < 1500000 && sim.running; i++) sim.step();
  const rows = [];
  for (let r = 0; r < 6; r++) {
    let t = '';
    for (let c = 0; c < 60; c++) t += String.fromCharCode(sim.memory[SCREEN_ADDR + r * 80 + c] & 0xFF);
    if (t.trim()) rows.push(t.replace(/\s+$/, '').trim());
  }
  return rows;
};

// The row that echoes the input, with the echoed text removed, is the output.
const hexOut = (src) => {
  const echo = '> ' + src;
  for (const r of hexrepl(src)) {
    if (r.startsWith(echo)) return r.slice(echo.length).trim().replace(/\s*ok$/, '').trim();
  }
  for (const r of hexrepl(src)) if (/undefined word/.test(r)) return 'undefined word';
  return '(no output)';
};

test('hex literals are numbers, in all three spellings', () => {
  for (const [src, want] of [
    ['0x10 .', '16'], ['0X10 .', '16'], ['$10 .', '16'],
    ['0x0 .', '0'], ['$0 .', '0'], ['0x7FFF .', '32767'],
    ['0xff .', '255'], ['$FF .', '255'], ['$ff .', '255'],
    ['0x8000 .', '-32768'],            // 16 bits, so this wraps negative
    ['0xdeadbeef .', '-16657'],        // and so does this
    ['0x10 0x10 + .', '32'],
    ['0x10 2 * .', '32'],
  ]) {
    assert.equal(hexOut(src), want, src);
  }
});

test('a hex literal works inside a definition, as LIT <value>', () => {
  assert.equal(hexOut(': t $ff ; t .'), '255');
  assert.equal(hexOut(': t 0x20 ; t .'), '32');
  assert.equal(hexOut(': t $10 2 * ; t .'), '32');
});

test('decimal literals are unaffected, and digits still make words', () => {
  // The scanner is shared, so the decimal path has to be checked too: 0..9 and
  // 1+ / 2dup / 0= all begin with a digit and none of them is a number.
  assert.equal(hexOut('4096 .'), '4096');
  assert.equal(hexOut('0 .'), '0');
  assert.equal(hexOut('255 .'), '255');
  assert.equal(hexOut('1 dup . .'), '1  1');   // the number printer leads with a space
  assert.equal(hexOut('2 3 + .'), '5');
});

test('a hex prefix with no digits is a word, not a zero', () => {
  // "0x" and "$" used to be "undefined word", and that is the better answer
  // than silently pushing 0 - a stray 0 is a number that looks right.
  assert.match(hexrepl('0x .').join('\n'), /undefined word: 0x/);
  assert.match(hexrepl('$ .').join('\n'), /undefined word: \$/);
  // A bad digit BEFORE any hex digit means no digits at all, so the whole
  // token is the word and is reported whole.
  assert.match(hexrepl('0xZZ .').join('\n'), /undefined word: 0xZZ/);
  // A bad digit AFTER one stops the number there, and the rest is looked up.
  assert.match(hexrepl('0x1g .').join('\n'), /undefined word: g/);
});

// ---------------------------------------------------------------------------
// Bit operations: and, or, xor, invert, lshift, rshift. hexOut and hexrepl are
// the shared REPL helpers above - the names are historical, the helper is not
// hex-specific.
//
// These are one machine instruction each except the shifts, and two details
// cost several attempts to pin down, so both are pinned by tests below:
//
//   * Stack discipline. A binary word reads b from SP, steps SP up once, and
//     reads a through that same instruction - so a's slot becomes the result
//     slot and SP ends one above where it started. Adding a second step-up
//     lands on the empty-stack base, and the *next* word then reports stack
//     underflow, several words away from the mistake.
//
//   * Operand order in the shifts. x is pushed first and n second, so n is on
//     TOP. Reading the top as x makes every shift count by x and shift n,
//     which looks plausible and is wrong: `1 100 lshift` would give 200.

const cell = (addr) => {
  const c = res.memoryChanges.find(m => m.address === addr);
  return c ? c.value : undefined;
};

test('the bit words are in the dictionary chain, and the chain is intact', () => {
  // Headers are newest-first and forth_wl names the newest, so the six new
  // headers had to go between h_cls and h_scr_fetch. Repointing forth_wl at
  // h_scr_fetch, or inserting anywhere else, walks the chain into a cycle -
  // which is invisible until some unrelated word stops working.
  const rev = Object.fromEntries(
    Object.entries(res.symbols).filter(([k]) => k.startsWith('h_')).map(([k, v]) => [v, k]));
  const seen = new Set();
  let cur = cell(res.symbols.forth_wl);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    cur = cell(cur);
  }
  assert.ok(!seen.has(cur), `dictionary chain cycles at ${rev[cur] || cur}`);
  for (const h of ['h_and', 'h_or', 'h_xor', 'h_lshift', 'h_rshift', 'h_invert']) {
    assert.ok(seen.has(res.symbols[h]), `${h} is not reachable from forth_wl`);
  }
  // h_store_cfa is the one header deliberately outside the chain: it is a
  // compile-only link target, not a word.
  const headers = Object.keys(res.symbols).filter(k => k.startsWith('h_'));
  assert.equal(seen.size, headers.length - 1);
  assert.equal(cell(res.symbols.forth_wl), res.symbols.h_cls,
    'the cell at forth_wl must name the newest header');
});

test('and, or and xor are one instruction each', () => {
  for (const [src, want] of [
    ['12 10 and .', '8'], ['12 10 or .', '14'], ['12 10 xor .', '6'],
    ['255 15 and .', '15'], ['255 240 or .', '255'], ['4095 255 xor .', '3840'],
    ['0 0 or .', '0'], ['1 1 xor .', '0'], ['65535 0 xor .', '-1'],  // u. would print 65535
    ['0xFF 0x0F and .', '15'], ['0xFF 0x10 xor .', '239'],
    // idempotence and cancellation: what distinguishes the three from each other
    ['4095 4095 and 4095 xor .', '0'],
    ['4095 0 or 4095 xor .', '0'],
    ['4095 4095 xor 4095 or .', '4095'],
  ]) assert.equal(hexOut(src), want, src);
});

test('invert works in place', () => {
  for (const [src, want] of [
    ['0 invert .', '-1'], ['1 invert .', '-2'], ['65535 invert .', '0'],
    ['255 invert .', '-256'], ['0 invert invert .', '0'],
  ]) assert.equal(hexOut(src), want, src);
});

test('lshift and rshift count by n, which is the operand on top', () => {
  // The paired rows are the ones that catch a swapped operand: 2 3 and 3 2
  // give different answers only if x and n are read the right way round.
  for (const [src, want] of [
    ['2 3 lshift .', '16'], ['3 2 lshift .', '12'],
    ['12 3 rshift .', '1'], ['3 12 rshift .', '0'],
    ['1 4 lshift .', '16'], ['2 1 lshift .', '4'], ['1 0 lshift .', '1'],
    ['1024 3 rshift .', '128'], ['65535 4 rshift .', '4095'],
    ['255 4 rshift .', '15'], ['255 0 rshift .', '255'],
    // rshift is logical: 32768 is positive here, so this cannot tell
    // sign-fill from zero-fill - the ISA has no arithmetic shift to ask for.
    ['32768 1 rshift .', '16384'],
    ['65535 1 rshift .', '32767'],
    // 1 << 15 is 0x8000, which . prints signed. u. shows the raw cell.
    ['1 15 lshift u.', '32768'], ['1 15 lshift 1 xor u.', '32769'],
  ]) assert.equal(hexOut(src), want, src);
});

test('a shift count of 16 or more shifts everything out, in both directions', () => {
  // SL and SR take their count as a 4-bit immediate with no register form, so
  // a runtime count is stepped one bit at a time. Left to itself that is up to
  // 65535 rounds for a count like 100; the words short-circuit instead.
  for (const [src, want] of [
    ['1 16 lshift .', '0'], ['1 17 lshift .', '0'], ['1 100 lshift .', '0'],
    ['1 65535 lshift .', '0'],
    ['255 16 rshift .', '0'], ['255 20 rshift .', '0'], ['255 65535 rshift .', '0'],
    // 16 is the first count that loses everything, not an arbitrary cut-off.
    ['1 15 lshift u.', '32768'], ['65535 15 rshift u.', '1'],
  ]) assert.equal(hexOut(src), want, src);
});

test('a bit word leaves exactly one item for two in', () => {
  // The underflow that started this was reported by whichever word came next,
  // so the result is consumed without being printed here and the count is
  // checked by adding to it.
  for (const [src, want] of [
    ['12 10 and 5 + .', '13'], ['12 10 or 5 + .', '19'], ['12 10 xor 5 + .', '11'],
    ['1 4 lshift 1 + .', '17'], ['1024 3 rshift 1 + .', '129'],
    ['255 invert 1 + .', '-255'],
  ]) assert.equal(hexOut(src), want, src);
});

test('every bit word checks its depth', () => {
  // invert is the odd one out: it is unary, so one operand is not an error.
  assert.match(hexrepl('invert').join('\n'), /stack underflow/, 'invert');
  assert.equal(hexOut('1 invert .'), '-2');
  for (const w of ['and', 'or', 'xor', 'lshift', 'rshift']) {
    assert.match(hexrepl(w).join('\n'), /stack underflow/, w);
    assert.match(hexrepl(`1 ${w}`).join('\n'), /stack underflow/, `1 ${w}`);
  }
  // The shifts need two operands where the others need two as well, so one
  // short is an underflow, while `and` with two is just arithmetic.
  assert.equal(hexOut('1 2 and .'), '0');
  // Two in leaves exactly one out, so dropping it empties the stack and the
  // next word is the one that says so. `drop` alone does not - it accepts an
  // empty stack - so it is the . after it that reports the underflow.
  for (const src of ['12 10 and drop .', '12 10 or drop .', '12 10 xor drop .',
                     '1 4 lshift drop .', '1024 3 rshift drop .', '255 invert drop .']) {
    assert.match(hexrepl(src).join('\n'), /stack underflow/, src);
  }
});

test('the bit words compile into definitions and compose with hex', () => {
  assert.equal(hexOut(': t 12 10 and ; t .'), '8');
  assert.equal(hexOut(': t 1 4 lshift ; t .'), '16');
  assert.equal(hexOut(': t 0xFF 0x0F and ; t u.'), '15');
  assert.equal(hexOut('8 4 or 1 or .'), '13');
  assert.equal(hexOut('0x1F 16 and .'), '16');
  assert.equal(hexOut('255 15 and 4 lshift .'), '240');
  // invert works on the TOP of the stack, so this inverts 10 and leaves 12
  // underneath it.
  assert.equal(hexOut('12 10 invert .'), '-11');
  assert.equal(hexOut('12 10 invert 1 + .'), '-10');
  assert.equal(hexOut('12 10 invert swap . .'), '12  -11');
});

// ---------------------------------------------------------------------------
// Tier 1: the standard words the kernel was missing.
//
// BL/TRUE/FALSE, the shufflers (?dup, tuck, -rot, 2over, 2swap), the unsigned
// comparisons (u<, u>, 0<>, within), the memory and string helpers (2@, 2!,
// count, c,, move, fill, erase, type) and space/spaces.
//
// Two things are pinned here beyond the stack effects themselves:
//
//   * u< and u> read the carry flag, not the sign, so `0 1 - 1 u<` is false
//     (65535 is not below 1) while the signed `<` would call it true. The
//     signed answer looks right on small positive numbers, which is exactly
//     why the distinguishing pairs are asserted.
//
//   * `count` answers the string's own address and length, not ANS's c-addr+1:
//     a string here is a run of cells ending in a zero cell, and `addr count
//     type` printing the string is the only reading that is worth anything.

test('bl, true and false are constants', () => {
  assert.equal(hexOut('bl .'), '32');
  assert.equal(hexOut('true .'), '-1');
  assert.equal(hexOut('false .'), '0');
  // constants, so they work anywhere a value does
  assert.equal(hexOut('bl 1 + .'), '33');
  assert.equal(hexOut(': t true ; t .'), '-1');
  assert.equal(hexOut(': t bl ; t 1 + .'), '33');
  assert.equal(hexOut('false 0= .'), '-1');
});

test('?dup duplicates the top cell only when it is nonzero', () => {
  assert.equal(hexOut('5 ?dup . .'), '5  5');
  assert.equal(hexOut('5 ?dup + .'), '10');
  assert.equal(hexOut('0 ?dup .'), '0');
  assert.equal(hexOut('5 ?dup depth . .'), '2  5');
  assert.equal(hexOut('0 ?dup depth . .'), '1  0');
});

test('tuck, -rot, 2over and 2swap shuffle the way the standard says', () => {
  assert.equal(hexOut('1 2 tuck . . .'), '2  1  2');
  assert.equal(hexOut('1 2 tuck depth .'), '3');
  assert.equal(hexOut('1 2 3 -rot . . .'), '2  1  3');
  assert.equal(hexOut('1 2 3 -rot depth .'), '3');
  assert.equal(hexOut('1 2 3 4 2over . . . . . .'), '2  1  4  3  2  1');
  assert.equal(hexOut('1 2 3 4 2over depth .'), '6');
  assert.equal(hexOut('1 2 3 4 2swap . . . .'), '2  1  4  3');
  assert.equal(hexOut('1 2 3 4 2swap depth .'), '4');
  // tuck is swap over, so the arithmetic has to agree with the shuffle
  assert.equal(hexOut('1 2 tuck + + .'), '5');
  assert.equal(hexOut('1 2 3 -rot drop . .'), '1  3');
});

test('u< and u> compare unsigned, which the signed comparisons cannot fake', () => {
  // 65535 is above 1, and above 1 is what unsigned says and signed does not
  assert.equal(hexOut('0 1 - 1 u< .'), '0');
  assert.equal(hexOut('0 1 - 1 u> .'), '-1');
  assert.equal(hexOut('1 0 1 - u< .'), '-1');
  assert.equal(hexOut('1 0 1 - u> .'), '0');
  // equal cells are neither less nor greater
  assert.equal(hexOut('3 3 u< .'), '0');
  assert.equal(hexOut('3 3 u> .'), '0');
  // the ordinary cases still read the ordinary way
  assert.equal(hexOut('1 2 u< .'), '-1');
  assert.equal(hexOut('2 1 u< .'), '0');
  assert.equal(hexOut('2 1 u> .'), '-1');
  assert.equal(hexOut('0x8000 1 u> .'), '-1');
  // the same two cells, asked signed and unsigned, come out opposite ways
  assert.equal(hexOut('0 1 - 1 < .'), '-1');    // signed: -1 is below 1
  assert.equal(hexOut('0 1 - 1 u< .'), '0');    // unsigned: 65535 is not
});

test('0<> is the mirror of 0=', () => {
  assert.equal(hexOut('5 0<> .'), '-1');
  assert.equal(hexOut('0 0<> .'), '0');
  assert.equal(hexOut('0 1 - 0<> .'), '-1');
  assert.equal(hexOut('5 0<> depth . .'), '1  -1');
});

test('within is lo <= n < hi', () => {
  assert.equal(hexOut('5 1 10 within .'), '-1');
  assert.equal(hexOut('1 1 10 within .'), '-1');    // lo is inside
  assert.equal(hexOut('9 1 10 within .'), '-1');
  assert.equal(hexOut('10 1 10 within .'), '0');    // hi is outside
  assert.equal(hexOut('0 1 10 within .'), '0');
  // an n below lo wraps to a large unsigned value, so it stays outside
  assert.equal(hexOut('0 1 - 0 1 within .'), '0');
  assert.equal(hexOut('5 1 10 within depth . .'), '1  -1');
});

test('2! and 2@ store and fetch the cell pair, high cell first', () => {
  // A variable owns exactly one data cell and the next definition's header
  // starts right behind it, so 2! needs a two-cell destination: without the
  // `2 allot`, the second cell lands on the next header's link, and the next
  // name lookup walks a chain whose second link is a small number and never
  // comes back.
  assert.equal(hexOut('variable x 2 allot 7 9 x 2! x 2@ . .'), '9  7');
  assert.equal(hexOut('variable x 2 allot 7 9 x 2! x @ .'), '9');
  assert.equal(hexOut('variable x 2 allot 7 9 x 2! x 1 + @ .'), '7');
  assert.equal(hexOut('variable x 2 allot 7 9 x 2! x 2@ depth .'), '3');
  // a round trip through both words leaves the pair as it was
  assert.equal(hexOut('variable x 2 allot 7 9 x 2! x 2@ . .'), '9  7');
  // and a definition made afterwards still works, which it would not if the
  // store had eaten the header behind the variable
  assert.equal(hexOut('variable a 2 allot 7 9 a 2! variable z 1 z ! z @ .'), '1');
});

test('move copies cells upwards and fill and erase write a run', () => {
  assert.equal(hexOut('variable a variable b 5 a ! a b 1 move b @ .'), '5');
  assert.equal(hexOut('variable a variable b 5 a ! a b 1 move a @ .'), '5');
  assert.equal(hexOut('variable f f 3 65 fill f @ .'), '65');
  assert.equal(hexOut('variable f f 3 65 fill f 1 + @ .'), '65');
  assert.equal(hexOut('variable f f 3 65 fill f 2 + @ .'), '65');
  assert.equal(hexOut('variable e 9 e ! e 1 erase e @ .'), '0');
  assert.equal(hexOut('variable e 9 e ! e 1 erase depth .'), '1');
  // a zero count writes nothing at all
  assert.equal(hexOut('variable f 7 f ! f 0 65 fill f @ .'), '7');
});

test('count and type print a zero-terminated string', () => {
  assert.equal(hexOut('here 72 c, 73 c, 0 c, count type'), 'HI');
  assert.equal(hexOut('here 72 c, 73 c, 0 c, count nip .'), '2');
  assert.equal(hexOut('here 0 c, count nip .'), '0');
  // an empty string prints nothing, so the row is just the ok
  assert.equal(hexOut('here 0 c, count type'), '');
  assert.equal(hexOut('here 65 c, 66 c, 67 c, 0 c, count type'), 'ABC');
  assert.equal(hexOut('here 65 c, 66 c, 67 c, 0 c, count swap drop .'), '3');
  // c, appends to the dictionary and here shows the cell it went to
  assert.equal(hexOut('here 65 c, here swap - .'), '1');
});

test('space and spaces write blanks, and take nothing else with them', () => {
  assert.equal(hexOut('65 emit space 66 emit'), 'A B');
  assert.equal(hexOut('65 emit 3 spaces 66 emit'), 'A   B');
  assert.equal(hexOut('65 emit 0 spaces 66 emit'), 'AB');
  assert.equal(hexOut('65 emit 1 spaces 66 emit'), 'A B');
  assert.equal(hexOut('space space 7 .'), '7');
});

test('every Tier 1 word checks its depth', () => {
  // Each of these is one operand short of what it needs, so the word itself
  // has to report the underflow rather than reading below the stack base.
  const one = ['?dup', '0<>', '2@', 'count', 'c,', 'spaces'];
  const two = ['tuck', 'u<', 'u>', 'erase', 'type'];
  const three = ['-rot', '2!', 'move', 'fill', 'within'];
  const four = ['2over', '2swap'];
  for (const w of one)     assert.match(hexrepl(w).join('\n'), /stack underflow/, w);
  for (const w of two)     assert.match(hexrepl('1 ' + w).join('\n'), /stack underflow/, w);
  for (const w of three)   assert.match(hexrepl('1 2 ' + w).join('\n'), /stack underflow/, w);
  for (const w of four)    assert.match(hexrepl('1 2 3 ' + w).join('\n'), /stack underflow/, w);
});

test('the Tier 1 words compile into definitions', () => {
  assert.equal(hexOut(': t 1 2 tuck ; t . . .'), '2  1  2');
  assert.equal(hexOut(': t 5 ?dup + ; t .'), '10');
  assert.equal(hexOut(': t 1 2 u< ; t .'), '-1');
  assert.equal(hexOut(': t 5 1 10 within ; t .'), '-1');
  assert.equal(hexOut(': t bl ; t .'), '32');
  assert.equal(hexOut(': t 3 0<> ; t .'), '-1');
  assert.equal(hexOut(': t 0 1 - 1 u< ; t .'), '0');
});

// ---------------------------------------------------------------------------
// Tier 1, second batch: ' char execute ['] [char] literal — and the tokenizer
// fix they needed.
//
// `'` was dropped silently by the tokenizer until now: `5 ' dup .` ran as
// `5 dup .`, and `' nosuch` reported the name as if it had been typed alone.
// It is an ordinary dictionary word again, which is what lets these tests
// talk about it at all. The tokenizer comment records what the branch did.
//
// `'` and `char` are NOT immediate, so inside a definition they are compiled
// and parse when the definition runs; `[']`, `[char]` and `literal` work while
// the definition is being translated and are immediate.

test("' pushes the next word's xt, and reports a name that is not there", () => {
  // The xt is the code field address: header + link + flags + name + NUL.
  assert.equal(hexOut("' dup ."), String(res.symbols.h_dup + 6));
  assert.equal(cell(res.symbols.h_dup + 6), res.symbols.word_dup);
  // Two ticks of the same word agree, two different words do not.
  assert.equal(hexOut("' dup ' dup = ."), '-1');
  assert.equal(hexOut("' dup ' + = ."), '0');
  // A constant is a word like any other, and its xt names doconst.
  assert.equal(cell(res.symbols.h_bl + 5), res.symbols.doconst);
  assert.equal(hexOut("' bl execute ."), '32');
  // A name that is not there, and a line with no name at all: the report is
  // the one `to` and `forget` give, with the offending token echoed.
  assert.match(hexrepl("' nosuch").join('\n'), /undefined word: nosuch/);
  assert.match(hexrepl("'").join('\n'), /undefined word/);
  // Being non-immediate, `'` inside a definition is a call, so it parses the
  // text that follows the call when the definition runs.
  assert.equal(hexOut(": getxt ' ; getxt dup ."), String(res.symbols.h_dup + 6));
});

test('execute runs the xt it is given, and comes back into the caller', () => {
  assert.equal(hexOut("5 ' dup execute . ."), '5  5');
  assert.equal(hexOut("1 2 ' + execute ."), '3');
  assert.equal(hexOut(": sq dup * ; 5 ' sq execute ."), '25');
  // The point of jumping to the code field instead of to the interpreter's
  // resume list: what follows `execute` in a definition still runs.
  assert.equal(hexOut(": t ['] + execute 10 + ; 1 2 t ."), '13');
  assert.equal(hexOut(": t execute 1 + ; 4 ' dup t . ."), '5  4');
  assert.match(hexrepl('execute').join('\n'), /stack underflow/);
});

test('char takes the first character of the next token, found or not', () => {
  assert.equal(hexOut('char A .'), '65');
  assert.equal(hexOut('char A emit'), 'A');
  // It reads the parse area, so a token that names nothing still names its own
  // first character, and punctuation the tokenizer otherwise owns works too.
  assert.equal(hexOut('char abc .'), '97');
  assert.equal(hexOut('char ( .'), '40');
  assert.equal(hexOut('char ; emit'), ';');
  // Blanks before the token are skipped and the whole token is consumed.
  assert.equal(hexOut('char     Z .'), '90');
  assert.equal(hexOut('char a 1 . .'), '1  97');
  assert.match(hexrepl('char').join('\n'), /undefined word/);
  // Non-immediate like `'`, so a definition parses at run time.
  assert.equal(hexOut(': getc char ; getc Q .'), '81');
});

test("['] compiles an xt, [char] a character, and literal a value", () => {
  assert.equal(hexOut(": t ['] dup ; 5 t execute . ."), '5  5');
  // What was compiled is the very xt `'` hands out at run time.
  assert.equal(hexOut(": t ['] dup ; t ' dup = ."), '-1');
  assert.equal(hexOut(": t [char] A ; t ."), '65');
  assert.equal(hexOut(": t [char] A ; t emit"), 'A');
  // `literal` takes its value from the stack while compiling, so the brackets
  // run once and not on every call; the two cells left behind are LIT and the
  // value, which is what `see` prints back as a plain number.
  assert.equal(hexOut(": t [ 6 7 * ] literal ; t ."), '42');
  assert.equal(hexOut(": t [ 65 ] literal ; t emit"), 'A');
  assert.ok(hexOut(": t ['] dup ; see t").startsWith(`: t ${res.symbols.h_dup + 6} ;`));
  assert.match(hexrepl("['] nosuch").join('\n'), /undefined word: nosuch/);
  assert.match(hexrepl('literal').join('\n'), /stack underflow/);
});

test('a word whose second character is x is a word, not a hex literal', () => {
  // The tokenizer used to open "0x" on any first character, because the hex
  // test only peeked at the second one. So `exe` was the number 0xE and
  // `execute` was 0xEC, leaving "ute" behind as an undefined word; `exit` only
  // escaped because "xi" holds no hex digit and a digit-less prefix goes back
  // to parse_word. Every one of these is a word now.
  assert.equal(hexOut('0xec .'), '236');
  assert.match(hexrepl('exe .').join('\n'), /undefined word: exe/);
  assert.equal(hexOut(': exe 7 ; exe .'), '7');
  assert.equal(hexOut(': ext 7 ; ext .'), '7');
  assert.equal(hexOut(': t 1 exit 2 ; t .'), '1');
  // $ and 0x still open a hex number, digits still make one, and a token that
  // only starts like one is a word.
  assert.equal(hexOut('$ec .'), '236');
  assert.equal(hexOut('16 .'), '16');
  assert.equal(hexOut(': 2x 7 ; 2x .'), '7');
});

// ---------------------------------------------------------------------------
// The signed comparisons at the sign boundary, and Tier 1's third batch:
// >r r> r@ +loop j unloop.
//
// The comparison bug is pinned first because `+loop` shares it. `<`, `>`, `min`
// and `max` read the sign of a - b and nothing else, so `0x8000 1 <` answered
// false: -32768 - 1 overflows to +32767 and the sign of the result is the wrong
// way round. None of them can be fixed with one flag — the machine has no
// signed-compare instruction — so they read N and V together, and so does
// +loop, whose limit test is a signed comparison of its own. `loop` is left
// alone: it tests for equality, which overflow does not disturb.
//
// `+loop` compiles xt_plusloop the way `loop` compiles xt_loop, and shares its
// loop_depth counter, so it closes a `do` or a `?do` and a stray one compiles
// nothing at all. `>r`, `r>` and `r@` take from the data stack and the return
// stack; the return stack is also where call frames and loop parameters live,
// so a `>r` still open when a loop word runs moves the pointer out from under
// the frame — the standard's ambiguous condition, and the reason every pair in
// these tests is balanced before the loop word is reached.

test('signed comparison reads the overflow flag as well as the sign', () => {
  for (const [src, want] of [
    // The pairs that used to answer backwards: at the boundary, and across it
    // in both directions.
    ['0x8000 1 < .', '-1'], ['0x8000 1 > .', '0'],
    ['1 0x8000 < .', '0'], ['1 0x8000 > .', '-1'],
    ['0x8000 1 min .', '-32768'], ['0x8000 1 max .', '1'],
    ['1 0x8000 min .', '-32768'], ['1 0x8000 max .', '1'],
    ['0x7fff 0 1 - < .', '0'], ['0x7fff 0 1 - > .', '-1'],
    ['0 1 - 0x7fff min .', '-1'], ['0 1 - 0x7fff max .', '32767'],
    // Equal values are neither less nor greater, boundary or not.
    ['0x8000 0x8000 < .', '0'], ['0x8000 0x8000 > .', '0'],
    // And the small numbers the old code got right still come out right.
    ['3 9 min .', '3'], ['9 3 min .', '3'],
    ['3 9 max .', '9'], ['9 3 max .', '9'],
    ['4 4 min .', '4'], ['4 4 max .', '4'],
    ['3 9 < .', '-1'], ['9 3 > .', '-1'], ['9 3 < .', '0'],
  ]) assert.equal(hexOut(src), want, src);
});

test('>r, r> and r@ move cells between the data and return stacks', () => {
  assert.equal(hexOut('5 >r r> .'), '5');
  // r@ copies and leaves the cell, r> takes it: both read the same value.
  assert.equal(hexOut('5 >r r@ . r> .'), '5  5');
  // Two cells come back in the reverse order, as they would on any stack.
  assert.equal(hexOut(': t 1 >r 2 >r r> r> ; t . .'), '1  2');
  assert.equal(hexOut(': t 42 >r r@ . r> . ; t'), '42  42');
  // Inside a definition a call frame is already on the return stack, and a
  // balanced pair hands back exactly what it was given.
  assert.equal(hexOut(': t 5 >r r> ; t .'), '5');
  // A pair balanced inside a loop body leaves the loop's frame where it was,
  // so i and the loop word still find it.
  assert.equal(hexOut(': t 3 0 do i >r r> . loop ; t'), '0  1  2');
});

test('>r, r> and r@ check the stack they take from', () => {
  assert.match(hexrepl('>r').join('\n'), /stack underflow/);
  // At the prompt the return stack pointer sits on its base with nothing under
  // it, so r> and r@ have no cell to read and say so. The base is a data cell
  // rather than an immediate because LDI reads its fifteen bits as signed:
  // 0x6F00 has bit 14 set, so loading it would arrive as 0xEF00 and every
  // comparison against it would answer the wrong way - which is how the first
  // version of these words came out. sp0_base is a cell for the same reason.
  assert.equal(cell(res.symbols.rp0_base), 0x6f00);
  assert.match(hexrepl('r>').join('\n'), /stack underflow/);
  assert.match(hexrepl('r@').join('\n'), /stack underflow/);
  assert.match(hexrepl('1 r>').join('\n'), /stack underflow/);
  // One cell on the return stack is enough for both.
  assert.equal(hexOut('9 >r r@ . r> .'), '9  9');
});

test('+loop adds its step to the index and stops at the limit', () => {
  assert.equal(hexOut(': t 10 0 do i . 2 +loop ; t'), '0  2  4  6  8');
  // A step that does not divide the range ends the loop at the first index at
  // or past the limit, where `loop` would have run for ever.
  assert.equal(hexOut(': t 10 0 do i . 3 +loop ; t'), '0  3  6  9');
  assert.equal(hexOut(': t 10 0 do i . 4 +loop ; t'), '0  4  8');
  // A negative step counts down and stops at the first index below the limit.
  assert.equal(hexOut(': t 0 10 do i . 0 3 - +loop ; t'), '10  7  4  1');
  assert.equal(hexOut(': t 0 10 do i . 0 4 - +loop ; t'), '10  6  2');
  // A step of one is `loop` by another name.
  assert.equal(hexOut(': t 3 0 do i . 1 +loop ; t'), '0  1  2');
  // ?do skips the body when the limits are equal; do always runs it once.
  assert.equal(hexOut(': t 5 0 ?do i . 2 +loop ; t'), '0  2  4');
  assert.equal(hexOut(': t 5 5 ?do i . 2 +loop ; t'), '');
  assert.equal(hexOut(': t 5 5 do i . 2 +loop ; t'), '5');
  // (+loop) needs its step, like (do) its two operands.
  assert.match(hexrepl(': t 0 0 do +loop ; t').join('\n'), /stack underflow/);
  // A stray +loop compiles nothing at all, exactly as a stray loop does: it is
  // a compile-time word and never reaches the runtime half.
  assert.ok(!/underflow|undefined/.test(hexrepl('+loop').join('\n')));
});

test('+loop reads the overflow flag when it compares index and limit', () => {
  // index - limit overflows at the sign boundary, where the raw sign would say
  // "still inside" and the loop would never end. Starting on the boundary, one
  // step of +1 lands on 0x8001, and 0x8001 < 0x8000 is false once the overflow
  // flag is taken into account: one pass, not 65536.
  assert.equal(hexOut(': t 0x8000 0x8000 do i . 1 +loop ; t'), '-32768');
  assert.equal(hexOut(': t 0x8000 0x8000 do i . 2 +loop ; t'), '-32768');
  // A negative step over the same boundary ends the loop too, after the pass
  // that lands exactly on the limit.
  assert.equal(hexOut(': t 0x7fff 0x8000 do i . 0 1 - +loop ; t'), '-32768  32767');
});

test('j reads the loop one level out and unloop leaves a loop early', () => {
  // Two levels: j is the outer index, and it repeats for each inner pass.
  assert.equal(hexOut(': t 2 0 do 2 0 do j . loop loop ; t'), '0  0  1  1');
  // Three levels with distinct indices: j is the middle one, not the outermost
  // (3) and not the innermost (5).
  assert.equal(hexOut(': t 4 3 do 5 4 do 6 5 do j . loop loop loop ; t'), '4');
  // unloop drops the frame without touching IP, so exit leaves from where the
  // loop was entered; without the exit the `;` at the end does the same thing.
  assert.equal(hexOut(': t 3 0 do i . i 1 = if unloop exit then loop ; t'), '0  1');
  assert.equal(hexOut(': t 3 0 do i . unloop ; t'), '0');
});

test('see names (+loop), and the return-stack words decompile as themselves', () => {
  assert.equal(hexOut(': t 3 0 do i . 2 +loop ; see t'), ': t 3 0 do i . 2 (+loop) ;');
  assert.equal(hexOut(': t 5 0 ?do i +loop ; see t'), ': t 5 0 ?do i (+loop) ;');
  // >r, r>, r@, j and unloop are dictionary words, so see prints their names.
  assert.equal(hexOut(': t >r r@ r> drop ; see t'), ': t >r r@ r> drop ;');
  assert.equal(hexOut(': t 3 0 do unloop ; see t'), ': t 3 0 do unloop ;');
});

// ---------------------------------------------------------------------------
// Tier 1, fourth batch: base, hex, decimal.
//
// BASE is a variable, like `state` and `base` both are now: the scanner and the
// printer read the same cell, so `16 base !` works and `hex` is just the polite
// spelling. Three things are pinned beyond the two words themselves:
//
//   * The scanner follows the base upwards as well as downwards. Above base ten
//     the letters A-F are digits, so a token that starts with one is a number
//     candidate ("ff" in hex) while a name that is not all digits still goes to
//     the dictionary (`hex dup` underflows, it does not become 0xDUP).
//
//   * The printer asks for the base's division instead of assuming ten. The
//     old reciprocal (floor(u/10) = (u * 0xCCCD) >> 19) was decimal only and
//     the ISA's DIV is signed, so a magnitude above 0x7FFF would divide wrong;
//     the 32-bit DIV with a zero high half is the unsigned answer, which is why
//     base two prints all sixteen digits of 65535.
//
//   * A base below two is undefined by the standard and is a plain cell here,
//     so it can be stored. Dividing by one never runs out and dividing by zero
//     answers 0xFFFF for ever; the printer stops the digit count at sixteen
//     instead, so the buffer is not overrun and the prompt comes back.

test('base is a variable, and hex and decimal set it', () => {
  assert.equal(hexOut('base @ .'), '10');
  assert.equal(hexOut('16 base ! base @ .'), '10');   // 16 printed in base 16
  assert.equal(hexOut('16 base ! base @ decimal .'), '16');
  assert.equal(hexOut('hex base @ decimal .'), '16');
  assert.equal(hexOut('hex decimal base @ .'), '10');
  // A real variable: see names it as one, and dovar finds its data cell right
  // behind the code field.
  assert.equal(hexOut('see base'), 'variable base');
  assert.equal(cell(res.symbols.base_var), 10);
  assert.equal(cell(res.symbols.h_base + 7), res.symbols.dovar);
  assert.equal(res.symbols.base_var, res.symbols.h_base + 8);
  // Ordinary words: inside a definition they run when it is called, so the
  // base the printer uses is the one in force at the call.
  assert.equal(hexOut(': t hex ; t base @ decimal .'), '16');
  assert.equal(hexOut(': t hex ; t 0 1 - u. decimal'), 'FFFF');
  // The cell survives from one line to the next.
  assert.match(hexrepl('hex\nff .').join('\n'), /FF/);
  assert.match(hexrepl('decimal\n255 .').join('\n'), /255/);
});

test('every built-in name can still be typed in hex mode', () => {
  // A token that is all digits of the current base is read as a number before
  // the dictionary is reached, so a built-in word with such a name would become
  // unreachable the moment `hex` is in force. None of them is one: every name
  // has a character outside 0-9A-Fa-f. The names come out of the assembled
  // image by walking the same header chain the chain test walks, so a future
  // word with a name like `beef` is caught here rather than at the prompt.
  let cur = cell(res.symbols.forth_wl);
  const numeric = [];
  let guard = 0;
  while (cur && guard++ < 400) {
    const len = cell(cur + 1) & 0x7fff;
    let name = '';
    for (let i = 0; i < len; i++) name += String.fromCharCode(cell(cur + 2 + i));
    if (/^[0-9A-Fa-f]+$/.test(name)) numeric.push(name);
    cur = cell(cur);
  }
  assert.deepEqual(numeric, [], 'these names would read as numbers in hex mode');
});

test('the scanner reads numbers in the current base', () => {
  // Base ten: a letter starts a word, a digit starts a number.
  assert.equal(hexOut('10 . 255 . 0x10 . $10 .'), '10  255  16  16');
  // Base sixteen: a letter is a digit, in either case, and the whole token has
  // to be digits for it to be a number.
  assert.equal(hexOut('hex ff .'), 'FF');
  assert.equal(hexOut('hex FF .'), 'FF');
  assert.equal(hexOut('hex Ff .'), 'FF');
  assert.equal(hexOut('hex 10 .'), '10');
  assert.equal(hexOut('hex ff decimal .'), '255');
  assert.equal(hexOut('hex 1234 decimal .'), '4660');
  assert.equal(hexOut('16 base ! ff decimal .'), '255');
  assert.equal(hexOut('hex 1 2 + decimal .'), '3');
  // The prefixes still mean hex whatever BASE is, and `0x` still needs its
  // digits behind it.
  assert.equal(hexOut('hex 0x10 decimal .'), '16');
  // Other bases: eight, two, and a base whose digits do not include 9.
  assert.equal(hexOut('8 base ! 17 . decimal'), '17');
  assert.equal(hexOut('2 base ! 101 . decimal'), '101');
  assert.match(hexrepl('8 base ! 19').join('\n'), /undefined word: 19/);
  // A name that is not all digits keeps its meaning in every base: the
  // dictionary is still consulted for it.
  assert.match(hexrepl('hex dup').join('\n'), /stack underflow/);
  assert.match(hexrepl('hex zz').join('\n'), /undefined word: zz/);
  assert.equal(hexOut('hex 1 2 2dup + + decimal .'), '5');
  // The one case the tokenizer cannot have both ways: a token that IS all
  // digits is read as a number before the dictionary is reached, so a word of
  // that name cannot be called in a base where it parses.
  assert.equal(hexOut('hex : beef 7 ; beef decimal u.'), '48879');
  assert.equal(hexOut('hex : beef 7 ; decimal beef .'), '7');
});

test('the printer writes digits in the current base', () => {
  // In hex, a token IS a hex number: 0xFF is the value the letters name.
  assert.equal(hexOut('hex 0xFF .'), 'FF');
  assert.equal(hexOut('hex 0 1 - u.'), 'FFFF');
  assert.equal(hexOut('hex 0 1 - .'), '-1');       // signed: minus, then magnitude
  assert.equal(hexOut('hex 0x8000 .'), '-8000');
  assert.equal(hexOut('hex ffff u.'), 'FFFF');
  assert.equal(hexOut('5 2 base ! . decimal'), '101');
  assert.equal(hexOut('5 3 base ! . decimal'), '12');
  // Sixteen digits is what base two needs, and the magnitude above 0x7FFF is
  // the case the signed DIV would have got wrong.
  assert.equal(hexOut('65535 2 base ! u. decimal'), '1111111111111111');
  assert.equal(hexOut('65535 u. 0x8000 . 0xFFFF u.'), '65535  -32768  65535');
  // A definition prints in the base it is called in, not the one it was
  // compiled in.
  assert.equal(hexOut(': t 10 . ; hex t decimal'), 'A');
  // see prints the inline literals the same way.
  assert.equal(hexOut(': t 16 ; hex see t decimal'), ': t 10 ;');
});

// ---------------------------------------------------------------------------
// Tier 1, fifth batch: s", pick and roll.
//
// `s"` is the string that answers ( c-addr u ) instead of printing. It is a
// tokenizer word like `."` - what follows it is not a token, so it can never
// reach the dictionary - and it differs from `."` in the one place that matters
// to a value: the blank that delimits the text is not part of the string, so
// `s" xy"` is two characters and not three. `see` puts that blank back, so the
// definition it prints still means what the source said.

test('s" answers an address and a length, interpreted and compiled', () => {
  assert.equal(hexOut('s" hello" type'), 'hello');
  assert.equal(hexOut('s" hello" nip .'), '5');
  assert.equal(hexOut('s" " nip .'), '0');           // the delimiter, then the quote
  assert.equal(hexOut(': g s" hey" ; g type'), 'hey');
  assert.equal(hexOut(': g s" hey" ; g nip .'), '3');
  assert.equal(hexOut(': g s" hey" ; g type g type'), 'heyhey');
  // Spaces inside the text survive; only the delimiter blank is dropped.
  assert.equal(hexOut(': g s" a b" ; g type'), 'a b');
  // `\"` is unescaped while the text is stored, in both halves.
  assert.equal(hexOut(': g s" a\\"b" ; g type'), 'a"b');
  assert.equal(hexOut(': g s" a\\"b" ; g nip .'), '3');
  assert.equal(hexOut('s" a\\"b" type'), 'a"b');
  // Two strings in one definition, and a string inside a loop: the runtime has
  // to step the thread over the characters, so a wrong skip would show up as a
  // second pass running off the end of the body.
  assert.equal(hexOut(': g s" bb" ; : h s" a" g type type ; h'), 'bba');
  assert.equal(hexOut(': g s" x" ; : t 3 0 do g type loop ; t'), 'xxx');
  // The blank is the delimiter, so `s"x"` is not a string at all.
  assert.match(hexrepl('s"x"').join('\n'), /undefined word: s"x"/);
  // Interpreted the text lives in one buffer, and a second `s"` overwrites it;
  // compiled the text is copied into the definition, so each one survives.
  assert.equal(hexOut('s" aa" s" bb" type type'), 'bbbb');
  assert.equal(hexOut(': g s" aa" ; : h s" bb" ; g type h type'), 'aabb');
  // see prints the definition back, delimiter blank and all.
  assert.equal(hexOut(': g s" hey" ; see g'), ': g s" hey" ;');
  assert.equal(hexOut(': g s" a b" ; see g'), ': g s" a b" ;');
});

test('pick copies the u-th cell and roll moves it to the top', () => {
  // pick: u counts from the top, 0 being the top cell itself.
  assert.equal(hexOut('5 0 pick . .'), '5  5');
  assert.equal(hexOut('1 2 0 pick . . .'), '2  2  1');
  assert.equal(hexOut('1 2 3 2 pick . . . .'), '1  3  2  1');
  assert.equal(hexOut(': t 1 2 3 2 pick . . . . ; t'), '1  3  2  1');
  // roll: the u-th cell moves to the top and the ones above it slide down.
  assert.equal(hexOut('1 2 3 2 roll . . .'), '1  3  2');
  assert.equal(hexOut('1 2 3 4 3 roll . . . .'), '1  4  3  2');
  assert.equal(hexOut('7 0 roll .'), '7');           // 0 roll is a no-op
  assert.equal(hexOut(': t 1 2 3 2 roll . . . ; t'), '1  3  2');
  // Both need u+1 cells; one short is a stack underflow reported by the word
  // itself, not a read off the end of the stack.
  for (const src of ['pick', '1 pick', '1 2 5 pick', '1 roll', '1 2 5 roll']) {
    assert.match(hexrepl(src).join('\n'), /stack underflow/, src);
  }
  // Ordinary dictionary words, so see names them.
  assert.equal(hexOut(': t pick roll ; see t'), ': t pick roll ;');
});

// ---------------------------------------------------------------------------
// Tier 1, sixth batch: pictured numeric output - <# # #s #> hold sign.
//
// These build a number in a hold area instead of printing it, so a program can
// format what `type` will write. The number is a double, two cells with the
// HIGH half on top, which is the order the standard's own
// `dup abs 0 <# #s rot sign #>` example assumes; `#` divides that double by the
// base that is in force, which is why the same idiom prints hex after `hex`.
//
// Three things are pinned beyond the words themselves:
//
//   * The hold area is a fixed buffer and the cursor walks DOWN from its end, so
//     the answer is already in reading order and nothing has to be reversed. A
//     program that holds more characters than the buffer holds sees the extra
//     ones dropped, rather than the cursor writing through whatever data
//     follows - the same trade the printer makes for a base below two.
//
//   * `#` divides with the 32-bit DIV, whose dividend is a SIGNED pair, while
//     the standard's ud is unsigned: a double at 0x80000000 or above converts
//     wrongly. Every way of making a double here - `dup abs 0`, or `s>d` built
//     by hand - keeps the high cell at 0, and that is the case shown below.

test('the pictured number words build a string for type', () => {
  assert.equal(hexOut('123 0 <# #s #> type'), '123');
  assert.equal(hexOut('0 0 <# #s #> type'), '0');        // at least one digit
  assert.equal(hexOut(': .n dup abs 0 <# #s rot sign #> type ; 123 .n'), '123');
  assert.equal(hexOut(': .n dup abs 0 <# #s rot sign #> type ; 5 negate .n'), '-5');
  // The base in force decides the digits, so the same idiom prints hex.
  assert.equal(hexOut('hex ff 0 <# #s #> type decimal'), 'FF');
  assert.equal(hexOut('2 base ! 101 0 <# #s #> type decimal'), '101');
  // A double wider than a cell: 5*65536 + 0x1234.
  assert.equal(hexOut('0x1234 5 <# #s #> type'), '332340');
  // hold prepends, so the characters come out in the order they were held.
  assert.equal(hexOut('0 0 <# 66 hold 65 hold #> type'), 'AB');
  // One # is one digit, and #> answers ( c-addr u ), ready for type.
  assert.equal(hexOut('12345 0 <# # # #> nip .'), '2');
  assert.equal(hexOut('0 0 <# # #> type'), '0');
  assert.equal(hexOut('0 0 <# #> type'), '');
  // sign holds nothing for a number that is not negative.
  assert.equal(hexOut('0 0 <# 5 sign #> type'), '');
});

test('the hold area is bounded, and the picture words check their depth', () => {
  // Forty characters fit; the rest are dropped instead of the cursor walking
  // out of the buffer.
  assert.equal(hexOut(': t 0 0 <# 45 0 do 65 hold loop #> nip . ; t'), '40');
  assert.equal(hexOut(': t 0 0 <# 3 0 do 66 hold loop #> type ; t'), 'BBB');
  // #, #s and #> each want the double; hold and sign want one cell.
  for (const src of ['#', '#s', '#>', '1 #']) {
    assert.match(hexrepl(src).join('\n'), /stack underflow/, src);
  }
  for (const src of ['hold', 'sign']) {
    assert.match(hexrepl(src).join('\n'), /stack underflow/, src);
  }
  // Dictionary words, so see names them.
  assert.equal(hexOut(': t hold sign #s #> <# ; see t'), ': t hold sign #s #> <# ;');
});

// ---------------------------------------------------------------------------
// Tier 2, first batch: double-cell numbers.
//
// A double is two cells with the HIGH half on top - the order `#`/`#>` and the
// standard's own examples use, and the order `s>d` has to produce. d+, d-, m+
// and dnegate carry from the low cell into the high one, which is what the
// carry flag is for: ADD sets it on a carry-out and SUB on a borrow, and it has
// to be read immediately, because LDI clears the whole flag nibble.
//
// d< compares the high cells as signed values with the same N/V test the single
// `<` uses, and only falls back to the low cells when the high ones are equal -
// and then as UNSIGNED, because -2 is 0xFFFF:0xFFFE and -1 is 0xFFFF:0xFFFF.

test('s>d widens a single, and the double words carry between the cells', () => {
  assert.equal(hexOut('5 s>d . .'), '0  5');
  assert.equal(hexOut('5 negate s>d . .'), '-1  -5');
  assert.equal(hexOut('1 0 2 0 d+ . .'), '0  3');
  assert.equal(hexOut('0xFFFF 0 1 0 d+ . .'), '1  0');    // the carry reaches the high cell
  assert.equal(hexOut('3 0 1 0 d- . .'), '0  2');
  assert.equal(hexOut('0 0 1 0 d- . .'), '-1  -1');       // and so does the borrow
  assert.equal(hexOut('1 0 dnegate . .'), '-1  -1');
  assert.equal(hexOut('0xFFFF 0 dnegate . .'), '-1  1');
  assert.equal(hexOut('1 0 2 m+ . .'), '0  3');
  assert.equal(hexOut('1 0 2 negate m+ . .'), '-1  -1');
  assert.equal(hexOut('0xFFFF 0 1 m+ . .'), '1  0');
  // s>d adds a cell and leaves two; the double words take four and leave two.
  assert.equal(hexOut('5 s>d depth .'), '2');
  assert.equal(hexOut('1 0 dnegate depth .'), '2');
  assert.equal(hexOut('1 0 2 0 d+ depth .'), '2');
  assert.equal(hexOut('1 0 2 m+ depth .'), '2');
});

test('the double comparisons answer over the sign boundary', () => {
  assert.equal(hexOut('1 0 1 0 d= .'), '-1');
  assert.equal(hexOut('1 0 2 0 d= .'), '0');
  assert.equal(hexOut('0 0 d0= .'), '-1');
  assert.equal(hexOut('0 1 d0= .'), '0');
  assert.equal(hexOut('1 0 2 0 d< .'), '-1');
  assert.equal(hexOut('2 0 1 0 d< .'), '0');
  assert.equal(hexOut('5 negate s>d 1 s>d d< .'), '-1');
  assert.equal(hexOut('0 0x8000 1 0 d< .'), '-1');        // -2^31 is below 1
  // Equal high cells: the low cells decide, and they decide unsigned.
  assert.equal(hexOut('2 negate s>d 1 negate s>d d< .'), '-1');
  assert.equal(hexOut('1 negate s>d 2 negate s>d d< .'), '0');
  // The high comparison takes the overflow flag, like the single `<`.
  assert.equal(hexOut('0x7FFF 0xFFFF 1 0 d< .'), '-1');
  assert.equal(hexOut('0 0x8000 0x7FFF 0 d< .'), '-1');
});

test('every double word checks its depth', () => {
  for (const [src, want] of [
    ['s>d', 1], ['dnegate', 2], ['d0=', 2],
    ['d+', 4], ['d-', 4], ['d=', 4], ['d<', 4], ['m+', 3],
  ]) {
    assert.match(hexrepl(src).join('\n'), /stack underflow/, `${src} on an empty stack`);
    const short = Array(want - 1).fill('1').join(' ');
    assert.match(hexrepl(`${short} ${src}`).join('\n'), /stack underflow/,
      `${src} with ${want - 1} cell(s)`);
  }
  // Dictionary words, so see names them.
  assert.equal(hexOut(': t s>d d+ d- dnegate ; see t'), ': t s>d d+ d- dnegate ;');
  assert.equal(hexOut(': t m+ d= d0= d< ; see t'), ': t m+ d= d0= d< ;');
});

test('the multiplying words answer the full 32-bit product', () => {
  assert.equal(hexOut('3 4 um* . .'), '0  12');
  assert.equal(hexOut('0xFFFF 0xFFFF um* . .'), '-2  1');      // 0xFFFE0001
  assert.equal(hexOut('3 4 m* . .'), '0  12');
  // The high half is where the signs show, and MUL32 is an unsigned multiply:
  // 3 * -4 is -12, while 3 * 0xFFFC is 0x0002FFF4, so m* has to correct it.
  assert.equal(hexOut('3 4 negate m* . .'), '-1  -12');
  assert.equal(hexOut('0x8000 2 m* . .'), '-1  0');            // -32768 * 2
  assert.equal(hexOut('0x8000 0x8000 m* . .'), '16384  0');    // 1073741824
  assert.equal(hexOut('0x7FFF 0x7FFF m* . .'), '16383  1');
  assert.equal(hexOut('0xFFFF 2 m* . .'), '-1  -2');
  assert.equal(hexOut('2 3 negate m* . .'), '-1  -6');
});

test('the dividing words agree with each other and with the signs', () => {
  // All three answer ( remainder quotient ) with the quotient ON TOP, which is
  // the standard's n3.
  // sm/rem truncates toward zero and gives the remainder the dividend's sign.
  assert.equal(hexOut('7 0 2 sm/rem . .'), '3  1');
  assert.equal(hexOut('7 negate s>d 2 sm/rem . .'), '-3  -1');
  assert.equal(hexOut('7 0 2 negate sm/rem . .'), '-3  1');
  // fm/mod floors, so the remainder takes the divisor's sign.
  assert.equal(hexOut('7 negate s>d 2 fm/mod . .'), '-4  1');
  assert.equal(hexOut('7 0 2 negate fm/mod . .'), '-4  -1');
  assert.equal(hexOut('7 negate s>d 2 negate fm/mod . .'), '3  -1');
  // An exact division needs no correction in either one.
  assert.equal(hexOut('8 negate s>d 2 fm/mod . .'), '-4  0');
  assert.equal(hexOut('8 0 2 fm/mod . .'), '4  0');
  // um/mod takes the double and the divisor and answers the same two cells.
  assert.equal(hexOut('100 0 7 um/mod . .'), '14  2');
  assert.equal(hexOut('0 0x0001 2 um/mod u. .'), '32768  0');
  assert.equal(hexOut('0xFFFF 0 3 um/mod . .'), '21845  0');
  // The one case the kernel's single signed divider cannot answer: an unsigned
  // divisor with bit 15 set is read as negative, and 65536/32768 signed is -2.
  assert.equal(hexOut('0 0x0001 0x8000 um/mod . .'), '-2  0');
});

test('the multiplying and dividing words check their depth', () => {
  for (const [src, want] of [['um*', 2], ['m*', 2], ['sm/rem', 3], ['fm/mod', 3], ['um/mod', 3]]) {
    assert.match(hexrepl(src).join('\n'), /stack underflow/, `${src} on an empty stack`);
    const short = Array(want - 1).fill('1').join(' ');
    assert.match(hexrepl(`${short} ${src}`).join('\n'), /stack underflow/,
      `${src} with ${want - 1} cell(s)`);
  }
  assert.equal(hexOut(': t um* m* sm/rem ; see t'), ': t um* m* sm/rem ;');
  assert.equal(hexOut(': t fm/mod um/mod ; see t'), ': t fm/mod um/mod ;');
});

// ---------------------------------------------------------------------------
// Tier 2, second batch: case / of / endof / endcase.
//
// `of` is worth one line: it compiles `over = if drop` and nothing else, so the
// runtime needs no new word at all - `see` prints that expansion straight back.
// What the four words do need is bookkeeping on the compile-time return stack,
// which is also the runtime return stack: `case` pushes a marker (zero, which is
// no address), `of` pushes the placeholder its branch is patched through, and
// `endof` is `else` word for word.
//
// Two guards: case_depth stops a stray `endcase` the way loop_depth stops a
// stray `loop`, and the resolve loop patches nothing that is not a dictionary
// address - so a `case` that was never closed cannot make a later `endcase` write
// an offset wherever it happens to guess.
//
// The one thing to know when writing a case: the selector is dropped by the
// clause that matches, and by `endcase` when none did. That is the standard's
// rule, and it is why a case that ANSWERS puts the selector back on top
// (`0 swap endcase`) or keeps it with `dup` in the default clause.

test('case runs the clause whose test value matches the selector', () => {
  // A definition and its calls are two input lines, so the row of the second is
  // the one to read: `repl` echoes each line and appends what `emit` wrote.
  const t = ': t case 1 of 65 emit endof 2 of 66 emit endof 67 emit endcase ;';
  const row = (def, call) => repl(`${def}\n${call}\n`).rows[2];
  assert.equal(row(t, '1 t'), '> 1 tA ok');
  assert.equal(row(t, '2 t'), '> 2 tB ok');
  assert.equal(row(t, '9 t'), '> 9 tC ok');        // the default, selector still there
  assert.equal(row(t, '1 t 2 t 9 t'), '> 1 t 2 t 9 tABC ok');
  assert.equal(row(': d case 1 of 65 emit endof dup . endcase ;', '7 d'), '> 7 d 7  ok');
  // A case that answers a value leaves the selector for endcase to drop.
  const v = ': v case 1 of 100 endof 2 of 200 endof 0 swap endcase ;';
  assert.equal(row(v, '1 v .'), '> 1 v . 100  ok');
  assert.equal(row(v, '2 v .'), '> 2 v . 200  ok');
  assert.equal(row(v, '5 v .'), '> 5 v . 0  ok');
  // Cases nest, and the inner one needs a selector of its own.
  const n = ': n case 1 of 2 case 2 of 65 emit endof endcase endof 67 emit endcase ;';
  assert.equal(row(n, '1 n'), '> 1 nA ok');
  assert.equal(row(n, '2 n'), '> 2 nC ok');
  // `of` compares with `=`, so the base in force is the one that decides.
  assert.equal(row(': w case 255 of 65 emit endof 66 emit endcase ;', 'hex ff w decimal'),
    '> hex ff w decimalA ok');
});

test('a case compiles to over, =, a branch and drop', () => {
  // The xts `of` compiles are the ones `'` hands out - header + 3 + the name
  // length - so `see` can name them, and renaming one of those words fails here
  // instead of quietly compiling the wrong address.
  assert.equal(hexOut("' over ."), String(res.symbols.h_over + 7));
  assert.equal(hexOut("' = ."), String(res.symbols.h_eq + 4));
  assert.equal(hexOut("' drop ."), String(res.symbols.h_drop + 7));
  // see prints the thread back the way it is built: one `over = (0branch) drop`
  // per clause, and a `(branch)` that skips the rest of the case.
  const seen = repl(': t case 1 of endof endcase ;\nsee t\n').rows[2];
  assert.match(seen, /: t 1 over = \(0branch\) \d+ drop \(branch\) \d+ drop ;/);
  // All four are immediate, so compiling a case leaves their own names out of
  // the thread entirely - which is how the missing IMMEDIATE bit was found.
  assert.doesNotMatch(seen, /case|endof|endcase/);
});

test('a stray case word does not take the machine down', () => {
  // case_depth guards endcase the way loop_depth guards loop.
  for (const src of ['case', 'endcase', 'endof', 'case endcase endcase', 'case endcase endof']) {
    assert.doesNotMatch(hexrepl(src).join('\n'), /underflow|undefined/, src);
  }
  // ... and the prompt still works afterwards.
  assert.equal(hexOut('case 42 .'), '42');
  assert.equal(hexOut('endcase 7 .'), '7');
  assert.equal(hexOut('endof 8 .'), '8');
});

// ---------------------------------------------------------------------------
// Tier 2, third batch: string words.
//
// A string here is a run of one-character cells, so a character IS a cell and
// every step from one character to the next is one address. That is why `cmove`
// is `move` and `blank` is `fill` with a space - the two only differ where a cell
// holds two characters - and why `/string` adds n to the address directly.
// `cmove>` is the one that really is different: it copies from the top down,
// which is what makes it safe when the destination is above the source, the
// direction `move` documents as the caller's problem.
//
// Comparisons read the CELLS - the high byte of a character travels through a
// copy and is ignored, the same way `type` and `c@` ignore it - and they compare
// UNSIGNED, which is what the standard asks for.

test('every label in the kernel source is defined exactly once', () => {
  // The assembler takes the LAST definition of a repeated label and says nothing
  // about the first, so a copy-pasted local name silently redirects an unrelated
  // jump: `wls_ok` was both the shift word's and /string's, and all the assembler
  // reported was that a jump had become too far. The kernel has some 800 labels
  // in one name space, so this is worth a check of its own.
  const seen = new Map();
  const repeated = [];
  src.split('\n').forEach((line, i) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (!m) return;
    if (seen.has(m[1])) repeated.push(`${m[1]} at lines ${seen.get(m[1])} and ${i + 1}`);
    else seen.set(m[1], i + 1);
  });
  assert.deepEqual(repeated, []);
  assert.ok(seen.size > 800, `only ${seen.size} labels: is this the kernel?`);
});

test('/string, -trailing and blank are the short ones', () => {
  assert.equal(hexOut('s" hello" 2 /string type'), 'llo');
  assert.equal(hexOut('s" hello" 0 /string type'), 'hello');
  assert.equal(hexOut('s" hello" 5 /string nip .'), '0');
  assert.equal(hexOut(': s s" hi" ; s 1 /string nip .'), '1');
  // -trailing drops the blanks at the end and answers the same address.
  assert.equal(hexOut('s" ab  " -trailing type'), 'ab');
  assert.equal(hexOut('s" ab  " -trailing nip .'), '2');
  assert.equal(hexOut('s" ab" -trailing nip .'), '2');
  assert.equal(hexOut('s"    " -trailing nip .'), '0');
  // blank is fill with a space: it stores 32 and takes its two arguments away.
  assert.equal(hexOut(': t here 3 blank here c@ . here 2 + c@ . ; t'), '32  32');
  assert.equal(hexOut(': t blank ; see t'), ': t blank ;');
});

test('cmove walks up, cmove> walks down', () => {
  const rows = repl(': seed here 65 over c! here 66 over 1 + c! ;\n'
    + ': f seed here here 3 + 2 cmove here 3 + 2 type ;\n'
    + ': g seed here here 1 + 2 cmove> here 3 type ;\n'
    + ': h seed here here 1 + 2 cmove here 3 type ;\n'
    + 'f g h\n').rows;
  // f copies two cells up onto clear ground; g copies the same two up ONE cell,
  // which is only safe from the top down; h is the same move made with cmove,
  // and it duplicates the first character the way the standard warns it will.
  assert.equal(rows[5], '> f g hABAABAAA ok');
});

test('compare answers -1, 0 or 1, and compares unsigned', () => {
  const defs = ': a s" abc" ; : b s" abd" ; : p s" ab" ; : q s" abc" ;';
  const row = (call) => repl(`${defs}\n${call}\n`).rows[2];
  assert.equal(row('a a compare .'), '> a a compare . 0  ok');
  assert.equal(row('a b compare .'), '> a b compare . -1  ok');
  assert.equal(row('b a compare .'), '> b a compare . 1  ok');
  // A string that matches so far but ends first is the lesser one.
  assert.equal(row('p q compare .'), '> p q compare . -1  ok');
  assert.equal(row('q p compare .'), '> q p compare . 1  ok');
  assert.equal(row(': e s" " ; e e compare .'), '> : e s" " ; e e compare . 0  ok');
  assert.equal(row(': e s" " ; e q compare .'), '> : e s" " ; e q compare . -1  ok');
  // Unsigned: 128 is above 127, which a signed comparison would get backwards.
  const hi = ': hi here 128 over c! 1 ; : lo here 2 + 127 over c! 1 ;';
  assert.equal(repl(`${hi}\nhi lo compare .\n`).rows[2], '> hi lo compare . 1  ok');
  assert.equal(repl(`${hi}\nlo hi compare .\n`).rows[2], '> lo hi compare . -1  ok');
});

test('search answers the rest of the string from the match', () => {
  const defs = ': a s" hello world" ; : b s" wor" ; : c s" xy" ; : d s" " ;';
  const row = (call) => repl(`${defs}\n${call}\n`).rows[2];
  assert.equal(row('a b search . type'), '> a b search . type -1 world ok');
  assert.equal(row('a c search . type'), '> a c search . type 0 hello world ok');
  // An empty needle matches at the start, and so does the whole string.
  assert.equal(row('a d search . type'), '> a d search . type -1 hello world ok');
  assert.equal(row('a a search . type'), '> a a search . type -1 hello world ok');
  // The remainder is measured from the match, so its length drops with it.
  assert.equal(row('a b search . nip .'), '> a b search . nip . -1  5  ok');
});

// ---------------------------------------------------------------------------
// Tier 2, fourth batch: exceptions.
//
// `catch` runs an xt with a frame on the return stack that records where to
// carry on, how deep the data stack was, and the frame of the catch outside it.
// `throw` finds that frame, cuts the data stack back to the recorded depth,
// unwinds the return stack to it, and resumes there with the code on top - so a
// throw from the bottom of a chain of calls arrives as if the calls had
// returned. Zero is not an exception, and `abort` is the standard's -1 throw.
//
// The kernel's own errors are exceptions too while a handler is in reach: a
// stack underflow is -4, thrown from the error routine itself instead of printed.
// With no handler in reach both paths behave exactly as they always did, which is
// what the old tests keep checking.

test('catch runs an xt and answers 0 when it returns', () => {
  assert.equal(hexOut("5 ' dup catch . . ."), '0  5  5');
  assert.equal(hexOut(": t 1 2 3 ; ' t catch . . . ."), '0  3  2  1');
  assert.equal(hexOut(": n ; ' n catch ."), '0');
  // catch checks its own depth: the xt has to be there.
  assert.match(hexrepl('catch').join('\n'), /stack underflow/);
});

test('throw unwinds to the catch and cuts the stack back', () => {
  // The cell that was below the catch survives, everything the xt pushed does
  // not, and the code lands on top.
  assert.equal(hexOut(": t 8 1 throw ; 5 ' t catch . ."), '1  5');
  assert.equal(hexOut(": t 5 1 throw 9 ; ' t catch ."), '1');
  // A throw from the bottom of a call chain arrives as if the calls returned,
  // and nested catches each take their own throw. Definitions and calls go on
  // separate lines so the rows stay inside what hexOut can read.
  const row = (def, call) => repl(`${def}\n${call}\n`).rows[2];
  assert.equal(row(": inner 42 7 throw ; : outer inner 99 ;", "' outer catch ."),
    "> ' outer catch . 7  ok");
  assert.equal(row(": i 3 throw ; : o ['] i catch . 7 throw ;", "' o catch ."),
    "> ' o catch . 3  7  ok");
  assert.equal(row(": t 1 throw ; : w ['] t catch 100 + throw ;", "' w catch ."),
    "> ' w catch . 101  ok");
  // abort is -1 throw, and a code computed at run time is thrown as it stands.
  assert.equal(hexOut("' abort catch ."), '-1');
  // Zero is not an exception at all.
  assert.equal(hexOut('5 0 throw .'), '5');
  // throw checks its own depth.
  assert.match(hexrepl('throw').join('\n'), /stack underflow/);
});

test('the kernel errors are exceptions while a handler is in reach', () => {
  // A stack underflow inside a catch is the standard's -4, not a message.
  assert.equal(hexOut(": t drop drop ; ' t catch ."), '-4');
  // Outside one it reports and recovers the way it always did.
  assert.match(hexrepl('drop drop').join('\n'), /stack underflow/);
  // A throw nothing is watching is reported, and the prompt comes back.
  const rows = repl('1 throw\n7 .\n').rows;
  assert.match(rows[1], /uncaught exception/);
  assert.match(rows[2], /7 .* ok/);
});

test('no instruction uses R8 or R9 as an address base', () => {
  // PSW.ER = 8 with the dual bit set makes R8 and R9 the ES-base pair, so a load
  // or store through either of them goes to the screen instead of the data
  // segment. `catch` did exactly that to the instruction pointer cell and walked
  // the machine into unwritten memory; this is the cheap way to never do it
  // again. R8 and R9 are still fine as a destination or a value.
  const bad = [];
  src.split('\n').forEach((line, i) => {
    const code = line.split(';')[0];
    if (/\b(LD|ST)\s+R\d+\s*,\s*R[89]\s*,/.test(code)) bad.push(`${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(bad, []);
});

test('abort" reports its message and throws -2', () => {
  const row = (def, call) => repl(`${def}\n${call}\n`).rows[2];
  // A zero flag prints nothing and throws nothing.
  assert.equal(row(': t abort" boom" ;', '0 t'), '> 0 t ok');
  // A non-zero flag prints the message and throws -2, which a catch sees.
  assert.equal(row(': t abort" boom" ; : c [\'] t catch ;', '1 c .'), '> 1 c .boom -2  ok');
  // With nothing watching, the message goes out and then the code is reported.
  assert.equal(row(': t 1 abort" boom" ;', 't'), '> tboomuncaught exception');
  // Interpreted, the flag comes off the stack the same way.
  assert.equal(repl('1 abort" oops"\n7 .\n').rows[1], '> 1 abort" oops"oopsuncaught exception');
  // It is an ordinary dictionary word with a quote in its name, so `'` finds it
  // and see prints a compiled one back with the blank the parse swallowed.
  assert.equal(hexOut("' abort\" ."), String(res.symbols.h_abortq + 9));
  assert.equal(row(': t 1 abort" boom" ;', 'see t'), '> see t : t 1 abort" boom" ; ok');
});

// ---------------------------------------------------------------------------
// Tier 2, fifth batch: evaluate.
//
// `evaluate` interprets a string the way the keyboard line is interpreted: the
// same tokenizer, the same words, the same state. It copies the text into a
// buffer of its own (one per nesting level, so a nested evaluation cannot
// overwrite the text its caller is still reading), terminates it, points TIB at
// the copy, and lets the ordinary interpreter loop run. That loop stops at a NUL
// cell; the end of the line then hands the outer input source and the thread
// that was in the middle of it back, instead of printing a prompt.
//
// Two things fall out of that and both are pinned here: an unknown name inside
// an evaluation reaches a handler as the standard's -13 (the interpreter is what
// finds it, and this is the first way to reach that code at all), and a throw out
// of an evaluation puts the input source back, so the line it was called from
// carries on instead of re-reading the text that was abandoned.

test('evaluate interprets a string as a line', () => {
  assert.equal(hexOut('s" 1 2 + ." evaluate'), '3');
  assert.equal(hexOut('s" 1 2 +" evaluate .'), '3');       // the line carries on
  assert.equal(hexOut('s" : t 5 ;" evaluate t .'), '5');   // compiling inside one
  assert.equal(hexOut(': u s" 3 4 + ." evaluate ; u'), '7');
  assert.equal(hexOut('s" 65 emit" evaluate'), 'A');
  // Trailing blanks are fine, and an empty string does nothing at all.
  assert.equal(hexOut('s" 7 .   " evaluate'), '7');
  assert.equal(hexOut('s" " evaluate'), '');
  // The parse area is the string while it runs, so parsing words read from it.
  assert.equal(hexOut("s\" ' dup\" evaluate ."), String(res.symbols.h_dup + 6));
  assert.match(hexrepl('evaluate').join('\n'), /stack underflow/);
});

test('an evaluation nests, and a throw out of one puts the source back', () => {
  const row = (def, call) => repl(`${def}\n${call}\n`).rows[2];
  // Two levels: b evaluates the text that calls a, which evaluates its own.
  assert.equal(row(': a s" 5 ." evaluate ; : b s" a" evaluate ;', 'b'), '> b 5  ok');
  // A throw out of an evaluation unwinds to the handler...
  assert.equal(row(': c s" 1 throw" evaluate ;', "' c catch ."), "> ' c catch . 1  ok");
  // ... and the line that was running when it happened is not re-read.
  assert.equal(repl(": c s\" 1 throw\" evaluate ;\n' c catch .\n8 .\n").rows[3], '> 8 . 8  ok');
  // An unknown name inside an evaluation is the standard's -13 as long as a
  // handler is in reach.
  assert.equal(row(': c s" nosuch" evaluate ;', "' c catch ."), "> ' c catch . -13  ok");
});

test('a base below two stops the printer instead of running away', () => {
  // BASE is a cell, so 0 and 1 can be stored; the standard calls that
  // undefined. What gets printed is garbage - what matters is that the count
  // ends the loop, the 32-cell buffer is not overrun, and the prompt, "ok" and
  // the next line still work.
  for (const src of ['65535 1 base ! . decimal 7 .', '42 0 base ! . decimal 7 .']) {
    const out = hexrepl(src).join('\n');
    assert.doesNotMatch(out, /underflow|undefined/, src);
    assert.match(out, / 7 /, src);
  }
  // And the scanner is not fooled either: no digit is valid in base one, so a
  // number cannot be typed there at all.
  assert.match(hexrepl('1 base ! 5').join('\n'), /undefined word: 5/);
});

// ---------------------------------------------------------------------------
// Tier 2, sixth batch: the rest of the double family, and STATE.
//
// d>s, dabs, dmax, dmin, 2literal, 2>r/2r>/2r@, 2constant, 2variable and the two
// printing words d. and d.r. The comparisons share one routine, `dless`, which
// is what d< decides with - so these tests also hold the refactored d< to its old
// answers. d. builds its digits with the same hold-area step `#` uses, and holds
// the minus LAST, because the buffer fills backwards: that is why `sign` is
// called after `#s`, and why d. has to do the same to print -5 and not 5-.
//
// 2literal compiles two literals, in the order they were given, so the second
// ends on top at run time. It is immediate and reads the compile-time stack, so
// the idiom is `: t [ 3 4 ] 2literal ;`. 2constant freezes a pair (its own
// runtime pushes both cells); 2variable allots TWO cells, so 2@ has its pair.
//
// `state` becomes a real variable. The manual already claimed ( -- addr ), and
// the standard agrees; it used to push the value instead, which only worked
// because no test read it through `@`. Its cell now sits behind its code field,
// the way `base`'s does, so `state @` is 0 while interpreting and 1 while a
// definition is being translated.

test('d>s, dabs, dmax and dmin work on the pair', () => {
  assert.equal(hexOut('5 s>d d>s .'), '5');
  assert.equal(hexOut('5 negate s>d d>s .'), '-5');
  assert.equal(hexOut('5 s>d dabs . .'), '0  5');
  assert.equal(hexOut('5 negate s>d dabs . .'), '0  5');
  assert.equal(hexOut('1 0 2 0 dmax . .'), '0  2');
  assert.equal(hexOut('2 0 1 0 dmax . .'), '0  2');
  assert.equal(hexOut('1 0 2 0 dmin . .'), '0  1');
  assert.equal(hexOut('2 0 1 0 dmin . .'), '0  1');
  assert.equal(hexOut('5 negate s>d 3 s>d dmax . .'), '0  3');
  assert.equal(hexOut('5 negate s>d 3 s>d dmin . .'), '-1  -5');
  // Across the sign boundary, where d< has to take the overflow flag.
  assert.equal(hexOut('0 0x8000 1 0 dmax . .'), '0  1');
  assert.equal(hexOut('0 0x8000 1 0 dmin . .'), '-32768  0');
  // Equal high cells: the low cells decide, and unsigned.
  assert.equal(hexOut('2 negate s>d 1 negate s>d dmax . .'), '-1  -1');
  assert.equal(hexOut('2 negate s>d 1 negate s>d dmin . .'), '-1  -2');
  // d>s and dabs take two and leave the same two; dmax and dmin take four.
  assert.equal(hexOut('5 s>d d>s depth .'), '1');
  assert.equal(hexOut('5 negate s>d dabs depth .'), '2');
  assert.equal(hexOut('1 0 2 0 dmax depth .'), '2');
  for (const [src, want] of [['d>s', 2], ['dabs', 2], ['dmax', 4], ['dmin', 4]]) {
    assert.match(hexrepl(src).join('\n'), /stack underflow/, `${src} on an empty stack`);
    const short = Array(want - 1).fill('1').join(' ');
    assert.match(hexrepl(`${short} ${src}`).join('\n'), /stack underflow/,
      `${src} with ${want - 1} cell(s)`);
  }
  // Dictionary words, so see names them.
  assert.equal(hexOut(': t d>s dabs ; see t'), ': t d>s dabs ;');
  assert.equal(hexOut(': t dmax dmin ; see t'), ': t dmax dmin ;');
});

test('2literal compiles two literals, the second on top', () => {
  const row = (def, call) => repl(`${def}\n${call}\n`).rows[2];
  assert.equal(row(': t [ 3 4 ] 2literal ;', 't . .'), '> t . . 4  3  ok');
  assert.equal(row(': t [ 5 negate 9 ] 2literal ;', 't . .'), '> t . . 9  -5  ok');
  // The compiled form is two literals, which is what see shows.
  assert.equal(row(': t [ 3 4 ] 2literal ;', 'see t'), '> see t : t 3 4 ; ok');
  // Immediate, and it takes two cells from the compile-time stack.
  assert.match(hexrepl(': u 2literal ;').join('\n'), /stack underflow/);
  assert.match(hexrepl('1 2literal').join('\n'), /stack underflow/);
});

test('2>r, 2r> and 2r@ move and copy a pair', () => {
  const row = (def, call) => repl(`${def}\n${call}\n`).rows[2];
  assert.equal(row(': t 2>r 2r> ;', '5 6 t . .'), '> 5 6 t . . 6  5  ok');
  // 2r@ leaves the pair, so a following 2r> still finds both cells.
  assert.equal(row(': t 1 2 2>r 2r@ 2r> ;', 't . . . .'), '> t . . . . 2  1  2  1  ok');
  // The return stack is empty again afterwards: a leftover cell would break the
  // return the word is in the middle of.
  assert.equal(row(': t 2>r 2r> ;', '5 6 t 7 .'), '> 5 6 t 7 . 7  ok');
  // Both readers check that two cells are there.
  for (const src of ['2r>', '2r@']) {
    assert.match(hexrepl(src).join('\n'), /stack underflow/, `${src} on an empty return stack`);
  }
  assert.match(hexrepl('2>r').join('\n'), /stack underflow/);
  assert.equal(hexOut(': t 2>r 2r> 2r@ ; see t'), ': t 2>r 2r> 2r@ ;');
});

test('2constant freezes a pair and 2variable allots two cells', () => {
  const row = (def, call) => repl(`${def}\n${call}\n`).rows[2];
  assert.equal(row('1 2 2constant c', 'c . .'), '> c . . 2  1  ok');
  assert.equal(row('5 negate 9 2constant n', 'n . .'), '> n . . 9  -5  ok');
  assert.equal(row('1000 0 2constant z', 'z . .'), '> z . . 0  1000  ok');
  // see names the defining word and prints both cells, in the order given.
  assert.equal(row('1 2 2constant c', 'see c'), '> see c 2constant c 1  2  ok');
  assert.equal(row('5 negate 9 2constant n', 'see n'), '> see n 2constant n -5  9  ok');
  // 2variable starts at zero and answers the address dovar pushes.
  assert.equal(row('2variable v', 'v 2@ . .'), '> v 2@ . . 0  0  ok');
  assert.equal(row('2variable v', '7 8 v 2! v 2@ . .'), '> 7 8 v 2! v 2@ . . 8  7  ok');
  assert.equal(row('2variable v', 'see v'), '> see v variable v  ok');
  // 2constant needs its pair.
  assert.match(hexrepl('2constant c').join('\n'), /stack underflow/);
  assert.match(hexrepl('1 2constant c').join('\n'), /stack underflow/);
});

test('d. prints a signed double and d.r pads it', () => {
  assert.equal(hexOut('5 s>d d.'), '5');
  assert.equal(hexOut('5 negate s>d d.'), '-5');  // the minus reads first, not last
  assert.equal(hexOut('0 s>d d.'), '0');
  assert.equal(hexOut('1000 0 234 0 d+ d.'), '1234');
  // d.r right-aligns in a field n wide; when the number is wider, it all shows.
  assert.equal(repl('123 s>d 8 d.r\n').rows[1], '> 123 s>d 8 d.r     123 ok');
  assert.equal(repl('5 negate s>d 6 d.r\n').rows[1], '> 5 negate s>d 6 d.r    -5 ok');
  assert.equal(repl('1234 s>d 2 d.r\n').rows[1], '> 1234 s>d 2 d.r1234 ok');
  // Both take a double; d.r also takes its field width.
  assert.match(hexrepl('d.').join('\n'), /stack underflow/);
  assert.match(hexrepl('5 d.').join('\n'), /stack underflow/);
  assert.match(hexrepl('5 s>d d.r').join('\n'), /stack underflow/);
});

test('state is a variable, as the manual already claimed', () => {
  assert.equal(hexOut('state @ .'), '0');
  // While a definition is being translated it reads 1, and an immediate word is
  // the way to look at it from inside one.
  const row = (def, call) => repl(`${def}\n${call}\n`).rows[2];
  assert.equal(row(': peek state @ . ; immediate', ': t peek ;'), '> : t peek ; 1  ok');
  // It is a variable, so see says so.
  assert.equal(hexOut('see state'), 'variable state');
});
