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