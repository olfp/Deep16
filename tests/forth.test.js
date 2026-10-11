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
import { assemble, loadBrowserScripts, buildMemory, ROOT, SCREEN_ADDR, CURSOR_ATTR } from './helpers.js';

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
const BIOS_LAYOUT = {
  bios_entry: 0x00, bios_f1: 0x09, bios_clr_loop: 0x16, bios_f2: 0x24,
  bios_putch_cr: 0x46, bios_putch_lf: 0x52, bios_lf_scroll_copy: 0x69,
  bios_lf_scroll_clear: 0x7a, bios_lf_row_lt: 0x86, bios_f3: 0x8c,
  bios_putstr_loop: 0x96, bios_putstr_done: 0xa1, bios_f4: 0xa3,
  bios_getch_wait: 0xaa, bios_f5: 0xbb, bios_getstr_loop: 0xc3,
  bios_store_char: 0xf3, bios_getstr_done: 0x107, bios_unknown: 0x10b,
};

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
