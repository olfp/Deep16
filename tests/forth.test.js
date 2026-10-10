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
//   - bare strings (`"hi there`) swallow the remainder of the line.
//
// Resolved since: `0 .` prints the trailing space like every other value, and
// `.` is signed while `u.` shows the raw cell — so `0 5 - .` gives -5 and
// `0 5 - u.` gives 65531.
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
  // Column of every cell carrying the block-cursor attribute bit (0x8000), so
  // a cursor left behind on an earlier line shows up as a stale block.
  const cursors = [];
  for (let r = 0; r < 25; r++) {
    const cols = [];
    for (let c = 0; c < 80; c++) {
      if (sim.memory[SCREEN_ADDR + r * 80 + c] & 0x8000) cols.push(c);
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
