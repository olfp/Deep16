// Shadow-register system regression tests (spec 4.1/4.3/4.4/4.8/4.9, 3.6)
// and JS-core vs WASM-core parity.
//
// These pin the contract the simulator cores must keep:
//  - GP banking: while PSW.S=1 the set {R0,R1,R2,R3,R13,R14} maps to the
//    shadow bank (R0'..R3', R13'=SP', R14'=LR'), everything else is shared.
//  - SWI enters the handler with a *fresh* PSW (0x0020), never a copy; RETI
//    restores the parked PSW into PSW and resets PSW' to 0x0000 (4.9).
//  - SMV reads the *inactive* bank and writes into the *active* bank (3.3/4.8).
//  - SOP decodes as INV/NEG/SPSW/LPSW from bits [5:4] (3.6).
//  - Conditional jumps use a one-instruction delay slot (Table 11/6.2.1).
//
// A custom runner is used so tests can pin PC independently of the boot ROM
// breadcrumb (both cores initially boot to 0x0100 via JML, which rewrites
// physical words 0..2 with 0x0100 -- see swi-test.asm, which re-arms its own
// SWI vector at runtime for the same reason).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assemble, loadBrowserScripts, runJs, runWasm, loadWasm,
  buildMemory, MEM_WORDS, SCREEN_ADDR, ROOT,
} from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const ASM_DIR = path.join(ROOT, 'asm');

function runJsAt(res, { maxSteps = 50000 } = {}) {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0; sim.segmentRegisters.ES = 0;
  sim.psw = 0x0000;
  sim.registers[15] = 0x0100;
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < maxSteps) { sim.step(); steps++; }
  return { sim, steps, registers: sim.registers, psw: sim.psw };
}

async function runWasmAt(res, { maxSteps = 50000 } = {}) {
  const w = await loadWasm();
  w.init(MEM_WORDS);
  for (const ch of res.memoryChanges) {
    w.load_program(ch.address, new Uint16Array([ch.value & 0xFFFF]));
  }
  w.set_segments(0, 0, 0, 0);
  w.set_psw(0x0000);
  const regs = new Uint16Array(16);
  regs[13] = 0x7FFF;
  regs[15] = 0x0100;
  w.set_registers(regs);
  let steps = 0;
  let cont = true;
  while (cont && steps < maxSteps) { cont = w.step(); steps++; }
  return {
    w, steps,
    registers: Array.from(w.get_registers()),
    psw: w.get_psw(),
    shadow: Array.from(w.get_shadow_state()), // [spc, scs, spsw]
  };
}

// Run the same assembled source on both cores at a pinned PC and return both.
async function runBoth(src, maxSteps = 50000) {
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  return {
    res,
    js: runJsAt(res, { maxSteps }),
    wasm: await runWasmAt(res, { maxSteps }),
  };
}

// ---------------------------------------------------------------- Jcc delays

test('Jcc delay slot: the instruction after a taken conditional jump still runs', async () => {
  const src = `
.org 0x0100
LDI 0x0001
LSI R1, 1
CMP R0, R1       ; Z=1
JZ  taken
NOP
LDI 99           ; must NOT execute (JZ taken, delay slot is the NOP)
MOV R2, R0
taken:
LDI 42
MOV R3, R0       ; marker that we arrived
HLT
`;
  const { js, wasm } = await runBoth(src);
  for (const [name, r] of [['JS', js], ['WASM', wasm]]) {
    assert.equal(r.registers[2], 0, `${name}: delay-slot NOP must leave R2 untouched`);
    assert.equal(r.registers[3], 42, `${name}: taken conditional jump should land on target`);
  }
});

test('Jcc delay slot: fall-through first instruction executes when the jump is not taken', async () => {
  const src = `
.org 0x0100
LDI 0x0005
LSI R1, 1
CMP R0, R1       ; Z=0 (5 != 1)
JZ  skip         ; not taken
NOP
LDI 77
MOV R2, R0       ; fall-through: executes
skip:
HLT
`;
  const { js, wasm } = await runBoth(src);
  for (const [name, r] of [['JS', js], ['WASM', wasm]]) {
    assert.equal(r.registers[2], 77, `${name}: not-taken jump must still execute the delay slot`);
  }
});

// ------------------------------------------------- Shadow banking + PSW

test('shadow banking: GPRs are banked, SWI parks PSW, RETI restores flags, SMV reads the inactive bank', async () => {
  const src = `
.org 0x0000
.word main
.word 0
.word handler
.org 0x0100
main:
    LDI 0x1111
    CMP R0, R0        ; Z=1, R0 stays 0x1111
    SWI
    JZ  zrestored
    NOP
    LDI 0x11
    MOV R6, R0        ; only reached if Z was lost across SWI/RETI
zrestored:
    SMV R10, AR0      ; R10 = R0' left behind by handler (0x2222)
    HLT
.org 0x0200
handler:
    LDI 0x2222        ; R0' = 0x2222 (spec 4.3: LDI in a handler targets R0')
    MOV R3, R0        ; R3' = 0x2222
    RETI
`;
  const { js, wasm } = await runBoth(src);
  for (const [name, r] of [['JS', js], ['WASM', wasm]]) {
    assert.equal(r.registers[0], 0x1111, `${name}: normal R0 must survive SWI/RETI`);
    assert.equal(r.registers[3], 0x0000, `${name}: handler wrote R3', normal R3 must stay 0`);
    assert.equal(r.registers[6], 0x0000, `${name}: Z must be restored => marker skipped`);
    assert.equal(r.registers[10], 0x2222, `${name}: SMV Rx, AR0 must read the shadow-bank R0`);
    assert.equal(r.psw & 0x0002, 0x0002, `${name}: Z flag restored by RETI`);
    assert.equal(r.psw & 0x0020, 0x0000, `${name}: S cleared after RETI`);
  }
  // Spec 4.9: PSW' resets to 0x0000 on RETI; the handler's R0' stays readable.
  assert.equal(js.sim.shadowRegisters.PSW, 0, 'JS: PSW slot zeroed by RETI');
  assert.equal(wasm.shadow[2], 0, 'WASM: PSW slot zeroed by RETI');
  assert.equal(js.sim.shadowRegisters.R0, 0x2222, 'JS: R0 shadow retains handler value');
  assert.equal(js.sim.shadowRegisters.R3, 0x2222, 'JS: R3 shadow retains handler value');
});

// ------------------------------------------------------------- SOP group

test('SOP: INV/NEG/SPSW/LPSW decode from bits[5:4] and use the active bank', async () => {
  const src = `
.org 0x0100
LDI 0x0FF0
MOV R1, R0
INV R1            ; 0x0FF0 -> 0xF00F  (INV is tt=00)
NEG R1            ; 0xF00F -> 0x0FF1  (NEG is tt=01)
LDI 0x0009
SPSW R0           ; psw <- 9           (SPSW is tt=10)
LPSW R2           ; R2 <- psw = 9      (LPSW is tt=11)
HLT
`;
  const { js, wasm } = await runBoth(src);
  for (const [name, r] of [['JS', js], ['WASM', wasm]]) {
    assert.equal(r.registers[1], 0x0FF1, `${name}: INV+NEG chain`);
    assert.equal(r.registers[2], 0x0009, `${name}: LPSW reads the live PSW`);
    assert.equal(r.psw & 0xFFFF, 0x0009, `${name}: SPSW loads PSW directly`);
  }
});

// ------------------------------------------------- shipping example parity

test('swi-test prints the same banner on both cores', async () => {
  const src = fs.readFileSync(path.join(ASM_DIR, 'swi-test.asm'), 'utf8');
  const res = assemble(src);
  const js = runJs(res, { maxSteps: 50000 });
  const wasm = await runWasm(res, { maxSteps: 50000 });

  const jsScreen = js.memory.slice(SCREEN_ADDR, SCREEN_ADDR + 240);
  const wasmScreen = wasm.memoryAt(SCREEN_ADDR, 240);
  let a = '', b = '';
  for (const c of jsScreen) { const ch = c & 0xFF; if (ch === 0 || ch === 0xFF) break; a += String.fromCharCode(ch); }
  for (const c of wasmScreen) { const ch = c & 0xFF; if (ch === 0 || ch === 0xFF) break; b += String.fromCharCode(ch); }
  assert.match(a, /SWI Version Demo/);
  assert.equal(b, a, 'WASM banner must match JS banner');
});

test('the Forth kernel greets on the WASM core and stays in its REPL loop', async () => {
  // Regression for: "Das Forth Beispiel laeuft noch nicht mit dem WASM Kern,
  // es erscheineine Ausgabe im Terminal."
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  const wasm = await runWasm(res, { maxSteps: 200000 });
  const screen = wasm.memoryAt(SCREEN_ADDR, 240);
  let out = '';
  for (const c of screen) { const ch = c & 0xFF; if (ch === 0 || ch === 0xFF) break; out += String.fromCharCode(ch); }
  assert.match(out, /Hello DeepForth!/);
  // The REPL waits for keyboard input (not serviced by the WASM core yet), so
  // it keeps stepping: every step must have executed.
  assert.equal(wasm.steps, 200000, 'the kernel must still be running inside its REPL loop');
});

// ------------------------------------------------- WASM keyboard port

function screenText(memoryAt, addr, count) {
  let out = '';
  for (const c of memoryAt(addr, count)) {
    const ch = c & 0xFF;
    if (ch === 0) break;
    if (ch === 0xFF) out += '\u00ff'; // invisible/invalid glyph marker
    else out += String.fromCharCode(ch);
  }
  return out;
}

test('WASM: Forth REPL waits on an empty keyboard instead of echoing phantom keys', async () => {
  // Regression: the WASM core had no keyboard port, so KBD_STATUS (0xF0060)
  // read raw memory (0xFFFF). The REPL's BIOS getstr saw an "always ready"
  // keyboard, consumed a stream of 0xFF keys and filled the screen with
  // invisible characters, then swallowed every real keystroke.
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  const wasm = await runWasm(res, { maxSteps: 150000 });
  assert.equal(wasm.steps, 150000, 'REPL must keep stepping while no key is pending');
  const screen = screenText(wasm.memoryAt, SCREEN_ADDR, 240);
  assert.match(screen, /Hello DeepForth!/);
  assert.ok(!screen.includes('\u00ff'), 'no phantom 0xFF characters on the screen');
  assert.equal(wasm.psw & 0x0020, 0x0020, 'REPL is parked inside the BIOS SWI handler (S=1)');
});

test('WASM: Forth REPL evaluates typed input exactly like the JS core', async () => {
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  const line = '1 2 + .\n'; // Enter maps to LF 10, same as the UI bridge

  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0x8000; sim.segmentRegisters.ES = 0x2000;
  for (const ch of line) sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }
  const jsOut = screenText((a, n) => sim.memory.slice(a, a + n), SCREEN_ADDR, 480);

  const wasm = await runWasm(res, { maxSteps: 600000, keys: [...line].map((ch) => ch.charCodeAt(0)) });
  const wasmOut = screenText(wasm.memoryAt, SCREEN_ADDR, 480);

  assert.match(jsOut, /1 2 \+ \. 3  ok/);
  assert.equal(wasmOut, jsOut, 'WASM REPL must evaluate the line identically to the JS core');
  assert.equal(wasm.steps, 600000, 'the REPL must stay alive after evaluating the line');
});

test('WASM: Forth REPL reports an unknown word with the word, discards the line, and continues', async () => {
  // Regression: the kernel's unknown-word error path clobbered >IN (R5) with
  // the screen column width before echoing the offending token, so it printed
  // memory garbage after "undefined word:", and the interpreter subsequently
  // halted the CPU. Both cores must echo the word itself and come back to a
  // fresh prompt.
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));

  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0x8000; sim.segmentRegisters.ES = 0x2000;
  for (const ch of 'HELLO\n') sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }
  const jsOut = screenText((a, n) => sim.memory.slice(a, a + n), SCREEN_ADDR, 480);

  const wasm = await runWasm(res, { maxSteps: 600000, keys: [...'HELLO\n'].map((ch) => ch.charCodeAt(0)) });
  const wasmOut = screenText(wasm.memoryAt, SCREEN_ADDR, 480);

  assert.match(jsOut, /undefined word: HELLO/);
  assert.ok(jsOut.replace(/\u00ff/g, ' ').trimEnd().endsWith('>'),
    'a fresh prompt must follow the reported error');
  assert.equal(wasmOut, jsOut, 'WASM REPL must report the unknown word identically to the JS core');
  assert.equal(steps, 600000, 'the JS REPL must stay alive after the error');
  assert.equal(wasm.steps, 600000, 'the WASM REPL must stay alive after the error');
});

test('WASM: Forth REPL keeps evaluating lines after an unknown word', async () => {
  // Regression: the unknown-word error path used to stop the REPL loop for
  // good. A valid line typed after the error must still work on both cores.
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  const input = '1 2 + .\nHELLO\n5 6 + .\n';

  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0x8000; sim.segmentRegisters.ES = 0x2000;
  for (const ch of input) sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }
  const jsOut = screenText((a, n) => sim.memory.slice(a, a + n), SCREEN_ADDR, 720);

  const wasm = await runWasm(res, { maxSteps: 600000, keys: [...input].map((ch) => ch.charCodeAt(0)) });
  const wasmOut = screenText(wasm.memoryAt, SCREEN_ADDR, 720);

  assert.match(jsOut, /1 2 \+ \. 3  ok/);
  assert.match(jsOut, /undefined word: HELLO/);
  assert.match(jsOut, /5 6 \+ \. 11  ok/);
  assert.equal(wasmOut, jsOut, 'WASM REPL must keep evaluating lines after an unknown word');
  assert.equal(steps, 600000, 'the JS REPL must stay alive across the error');
  assert.equal(wasm.steps, 600000, 'the WASM REPL must stay alive across the error');
});

test('WASM: Forth REPL runs colon definitions exactly like the JS core', async () => {
  // The indirect-threading engine (NEXT/DOCOL, : and ;) must work on both
  // cores; the WASM parity guards against core-specific register or memory
  // differences the threaded inner interpreter could trip over.
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  const input = ': square dup * ;\n5 square .\n: ab 65 emit 66 emit ;\nab\n';

  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0x8000; sim.segmentRegisters.ES = 0x2000;
  for (const ch of input) sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }
  const jsOut = screenText((a, n) => sim.memory.slice(a, a + n), SCREEN_ADDR, 960);

  const wasm = await runWasm(res, { maxSteps: 600000, keys: [...input].map((ch) => ch.charCodeAt(0)) });
  const wasmOut = screenText(wasm.memoryAt, SCREEN_ADDR, 960);

  assert.match(jsOut, /5 square \. 25  ok/);
  assert.match(jsOut, /abAB ok/);
  assert.equal(wasmOut, jsOut, 'WASM colon definitions must match the JS core');
  assert.equal(steps, 600000, 'the JS REPL must stay alive across the definitions');
  assert.equal(wasm.steps, 600000, 'the WASM REPL must stay alive across the definitions');
});

test('WASM: Forth REPL evaluates the P3 stack, arithmetic and comparison words like the JS core', async () => {
  // The new primitives (over, rot, -, /mod, <, 2dup, ...) end in NEXT and
  // must behave identically on both cores; the 2dup line also pins that a
  // word starting with a digit is not split into number + word.
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  const input = '10 3 - .\n17 5 /mod . .\n3 4 < .\n1 2 2dup depth .\n';

  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0x8000; sim.segmentRegisters.ES = 0x2000;
  for (const ch of input) sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }
  const jsOut = screenText((a, n) => sim.memory.slice(a, a + n), SCREEN_ADDR, 960);

  const wasm = await runWasm(res, { maxSteps: 600000, keys: [...input].map((ch) => ch.charCodeAt(0)) });
  const wasmOut = screenText(wasm.memoryAt, SCREEN_ADDR, 960);

  assert.ok(jsOut.includes('10 3 - . 7  ok'), 'subtraction result');
  assert.ok(jsOut.includes('17 5 /mod . . 3  2  ok'), 'division with remainder');
  assert.ok(jsOut.includes('3 4 < . 65535  ok'), 'comparison true is -1');
  assert.ok(jsOut.includes('1 2 2dup depth . 4  ok'), '2dup is one word');
  assert.equal(wasmOut, jsOut, 'WASM P3 words must match the JS core');
  assert.equal(steps, 600000, 'the JS REPL must stay alive across the P3 words');
  assert.equal(wasm.steps, 600000, 'the WASM REPL must stay alive across the P3 words');
});

test('WASM: Forth REPL runs the control-flow words exactly like the JS core', async () => {
  // if/else/then, begin/while/repeat and recurse compile inline branch
  // offsets into the thread; both cores must resolve them identically.
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  const input = ': fac dup 1 > if dup 1- recurse * then ;\n5 fac .\n: wc 0 begin dup 5 < while 1+ repeat ;\nwc .\n';

  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0x8000; sim.segmentRegisters.ES = 0x2000;
  for (const ch of input) sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }
  const jsOut = screenText((a, n) => sim.memory.slice(a, a + n), SCREEN_ADDR, 960);

  const wasm = await runWasm(res, { maxSteps: 600000, keys: [...input].map((ch) => ch.charCodeAt(0)) });
  const wasmOut = screenText(wasm.memoryAt, SCREEN_ADDR, 960);

  assert.ok(jsOut.includes('5 fac . 120  ok'), 'recurse computes the factorial');
  assert.ok(jsOut.includes('wc . 5  ok'), 'while/repeat counts to five');
  assert.equal(wasmOut, jsOut, 'WASM control flow must match the JS core');
  assert.equal(steps, 600000, 'the JS REPL must stay alive across the control flow');
  assert.equal(wasm.steps, 600000, 'the WASM REPL must stay alive across the control flow');
});

test('WASM: Forth REPL memory words and defining words match the JS core', async () => {
  // Data-cell access, `,`/`allot` and the dovar/doconst runtime bodies must
  // write the same dictionary and yield the same screen on both cores.
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  const input = 'variable x drop\n7 x !\n4 x +! x @ .\n5 constant five\nfive .\nvariable c drop\n65 c c! c c@ .\n';

  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0x8000; sim.segmentRegisters.ES = 0x2000;
  for (const ch of input) sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }
  const jsOut = screenText((a, n) => sim.memory.slice(a, a + n), SCREEN_ADDR, 960);

  const wasm = await runWasm(res, { maxSteps: 600000, keys: [...input].map((ch) => ch.charCodeAt(0)) });
  const wasmOut = screenText(wasm.memoryAt, SCREEN_ADDR, 960);

  assert.ok(jsOut.includes('4 x +! x @ . 11  ok'), '+! accumulates in a variable');
  assert.ok(jsOut.includes('five . 5  ok'), 'constant pushes its value');
  assert.ok(jsOut.includes('65 c c! c c@ . 65  ok'), 'c! and c@ round-trip a char');
  assert.equal(wasmOut, jsOut, 'WASM memory/defining words must match the JS core');
  assert.equal(steps, 600000, 'the JS REPL must stay alive across the memory words');
  assert.equal(wasm.steps, 600000, 'the WASM REPL must stay alive across the memory words');
});

test('WASM: Forth REPL create/does> and value/to match the JS core', async () => {
  // The CREATE/DOES> runtime (dodoes) and the TO store path touch the return
  // stack and IP directly, so both cores must produce the same screen.
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  const input =
    ': const create , does> @ ;\n' +
    '42 const answer\n' +
    'answer .\n' +
    ': arr create cells allot does> swap cells + ;\n' +
    '4 arr a\n' +
    '7 0 a ! 8 3 a !\n' +
    '0 a @ . 3 a @ .\n' +
    '5 value v\n' +
    '9 to v\n' +
    'v .\n' +
    ': setv to v ;\n' +
    '42 setv\n' +
    'v .\n';

  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0x8000; sim.segmentRegisters.ES = 0x2000;
  for (const ch of input) sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }
  const jsOut = screenText((a, n) => sim.memory.slice(a, a + n), SCREEN_ADDR, 2000);

  const wasm = await runWasm(res, { maxSteps: 600000, keys: [...input].map((ch) => ch.charCodeAt(0)) });
  const wasmOut = screenText(wasm.memoryAt, SCREEN_ADDR, 2000);

  assert.ok(jsOut.includes('answer . 42  ok'), 'does> fetches the stored value');
  assert.ok(jsOut.includes('0 a @ . 3 a @ . 7  8  ok'), 'does> computes array addresses');
  assert.ok(jsOut.includes('v . 9  ok'), 'to rewrites a value in interpret state');
  assert.ok(jsOut.includes('v . 42  ok'), 'to compiles a store inside a definition');
  assert.equal(wasmOut, jsOut, 'WASM create/does> and value/to must match the JS core');
  assert.equal(steps, 600000, 'the JS REPL must stay alive across create/does>');
  assert.equal(wasm.steps, 600000, 'the WASM REPL must stay alive across create/does>');
});

test('WASM: Forth REPL vocabularies and the search order match the JS core', async () => {
  // Vocabulary execution rewrites the search order and FIND walks it, so both
  // cores must resolve the same headers.
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  const input =
    ': baz 5 ;\n' +
    'vocabulary foo\n' +
    'foo definitions\n' +
    'baz .\n' +
    ': qux 3 ;\n' +
    'qux .\n' +
    'only forth definitions\n' +
    'qux .\n' +
    ': x 1 ;\n' +
    'vocabulary bar\n' +
    'bar definitions\n' +
    ': x 2 ;\n' +
    'x .\n' +
    'only forth definitions\n' +
    'x .\n';

  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0x8000; sim.segmentRegisters.ES = 0x2000;
  for (const ch of input) sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }
  const jsOut = screenText((a, n) => sim.memory.slice(a, a + n), SCREEN_ADDR, 2000);

  const wasm = await runWasm(res, { maxSteps: 600000, keys: [...input].map((ch) => ch.charCodeAt(0)) });
  const wasmOut = screenText(wasm.memoryAt, SCREEN_ADDR, 2000);

  assert.ok(jsOut.includes('baz . 5  ok'), 'FORTH words stay visible from a vocabulary');
  assert.ok(jsOut.includes('qux . 3  ok'), 'a word defined in the vocabulary resolves');
  assert.ok(jsOut.includes('undefined word: qux'), 'only forth definitions hides it again');
  assert.ok(jsOut.includes('x . 2  ok'), 'vocabulary word shadows the FORTH word');
  assert.equal(wasmOut, jsOut, 'WASM vocabularies must match the JS core');
  assert.equal(steps, 600000, 'the JS REPL must stay alive across the vocabularies');
  assert.equal(wasm.steps, 600000, 'the WASM REPL must stay alive across the vocabularies');
});

test('WASM: Forth REPL words and forget match the JS core', async () => {
  // words clears the screen and walks the first wordlist; forget rewrites the
  // wordlist head and reclaims HERE, so both cores must agree cell for cell.
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  // words clears the screen, so it runs first and forget afterwards; the whole
  // linear screen must still match cell for cell between the two cores.
  const input =
    ': a 1 ; : b 2 ; : c 3 ;\n' +
    'words\n' +
    'a .\n' +
    'forget b\n' +
    'a .\n' +
    'b .\n';

  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0x8000; sim.segmentRegisters.ES = 0x2000;
  for (const ch of input) sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }
  const jsOut = screenText((a, n) => sim.memory.slice(a, a + n), SCREEN_ADDR, 2000);

  const wasm = await runWasm(res, { maxSteps: 600000, keys: [...input].map((ch) => ch.charCodeAt(0)) });
  const wasmOut = screenText(wasm.memoryAt, SCREEN_ADDR, 2000);

  assert.ok(jsOut.includes('undefined word: b'), 'forget hides the forgotten word');
  assert.ok(jsOut.includes('vocabulary'), 'words lists the searched wordlist');
  assert.ok(jsOut.includes('does>'), 'words wraps names without losing them');
  assert.equal(wasmOut, jsOut, 'WASM words/forget must match the JS core');
  assert.equal(steps, 600000, 'the JS REPL must stay alive across words/forget');
  assert.equal(wasm.steps, 600000, 'the WASM REPL must stay alive across words/forget');
});

test('WASM: Forth REPL 2/ abs min and max match the JS core', async () => {
  // 2/ uses SRA, whose sign handling lives in the ALU2 decoder of each core,
  // so the floor behaviour has to agree bit for bit.
  const src = fs.readFileSync(path.join(ASM_DIR, 'forth.asm'), 'utf8');
  const res = assemble(src);
  assert.ok(res.success, res.errors.join('; '));
  const input =
    '7 2/ .\n' +
    '0 3 - 2/ .\n' +
    '5 abs .\n' +
    '0 5 - abs .\n' +
    '3 9 min .\n' +
    '9 3 max .\n' +
    '2/ .\n' +
    '1 min .\n';

  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0xFFFF; sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0x8000; sim.segmentRegisters.ES = 0x2000;
  for (const ch of input) sim.enqueueKeyCode(ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < 600000) { sim.step(); steps++; }
  // 9 screen rows are needed, so the window is 960 bytes wide
  const jsOut = screenText((a, n) => sim.memory.slice(a, a + n), SCREEN_ADDR, 960);

  const wasm = await runWasm(res, { maxSteps: 600000, keys: [...input].map((ch) => ch.charCodeAt(0)) });
  const wasmOut = screenText(wasm.memoryAt, SCREEN_ADDR, 960);

  assert.ok(jsOut.includes('> 7 2/ . 3  ok'), '2/ halves a positive');
  assert.ok(jsOut.includes('> 0 3 - 2/ . 65534  ok'), '2/ floors to -2');
  assert.ok(jsOut.includes('> 0 5 - abs . 5  ok'), 'abs returns the magnitude');
  assert.ok(jsOut.includes('> 9 3 max . 9  ok'), 'max keeps the larger operand');
  assert.ok(jsOut.includes('stack underflow'), 'the new words check their operands');
  assert.equal(wasmOut, jsOut, 'WASM 2//abs/min/max must match the JS core');
  assert.equal(steps, 600000, 'the JS REPL must stay alive across the new arithmetic');
  assert.equal(wasm.steps, 600000, 'the WASM REPL must stay alive across the new arithmetic');
});
