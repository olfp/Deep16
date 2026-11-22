// P4: the ILL handler dispatches the FPU trap words to the soft-float
// library. The kernel is assembled with FPU_KERNEL and the library is
// appended at its flat origin (0x5800); the non-FPU build leaves the same
// words as unknown traps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, buildMemory, loadBrowserScripts, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const kernelSource = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
const library = fs.readFileSync(path.join(ROOT, 'asm', 'softfloat.asm'), 'utf8');
const kernel = assemble(`${kernelSource}\n${library}`,
                        { defines: { CONSOLE_UART: 1, D16NANO: 1, FPU_KERNEL: 1 } });
assert.equal(kernel.success, true, kernel.errors.join('; '));

function boot() {
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(buildMemory(kernel));
  sim.segmentRegisters.CS = 0xFFFF;
  sim.d16nano = true;
  sim.running = true;
  for (let i = 0; i < 20_000_000 && sim.running && !sim.memory[kernel.symbols.boot_done]; i++) {
    sim.step();
  }
  for (let i = 0; i < 100_000 && sim.running; i++) sim.step();
  assert.ok(sim.running, 'kernel did not boot to the REPL');
  return sim;
}

function runProgram(sim, source) {
  const program = assemble(source);
  assert.equal(program.success, true, program.errors.join('; '));
  for (const change of program.memoryChanges) sim.memory[change.address] = change.value & 0xFFFF;
  sim.registers[15] = 0x4F00;
  sim.psw = 0;
  sim.segmentRegisters.CS = 0x0000;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  sim.running = true;
  for (let i = 0; i < 300000 && sim.running; i++) sim.step();
  assert.equal(sim.running, false, 'the program must halt');
  return sim;
}

// LDI sign-extends bit 14, so a high word >= 0x4000 is built with a shift.
function loadPair(high, low, highRegister, lowRegister) {
  const h = high & 0xFFFF;
  let source = h < 0x4000
    ? `    LDI 0x${h.toString(16)}\n    MOV ${highRegister}, R0\n`
    : `    LDI 0x${(h >> 1).toString(16)}\n    MOV ${highRegister}, R0\n    SL ${highRegister}, 1\n`;
  source += low < 0x10
    ? `    LSI ${lowRegister}, ${low}\n`
    : `    LDI 0x${low.toString(16)}\n    MOV ${lowRegister}, R0\n`;
  return source;
}

// F0/F1 setup plus markers in shared registers, the trap, then a store of
// F0, F1, the shared markers and the PSW captured immediately after RETI.
function program(opcode, f0High, f0Low, f1High, f1Low) {
  return `
.org 0x4f00
${loadPair(f0High, f0Low, 'R2', 'R3')}
${loadPair(f1High, f1Low, 'R4', 'R5')}
    LDI 0x1234
    MOV R9, R0
    LDI 0x1678
    MOV R10, R0
    ${opcode}
    LPSW R7
    LDI 0x0200
    MOV R6, R0
    ST R2, R6, 0
    ADD R6, 1
    ST R3, R6, 0
    ADD R6, 1
    ST R4, R6, 0
    ADD R6, 1
    ST R5, R6, 0
    ADD R6, 1
    ST R9, R6, 0
    ADD R6, 1
    ST R10, R6, 0
    ADD R6, 1
    ST R7, R6, 0
    HALT
`;
}

function stored(sim) {
  return {
    f0High: sim.memory[0x200],
    f0Low: sim.memory[0x201],
    f1High: sim.memory[0x202],
    f1Low: sim.memory[0x203],
    r9: sim.memory[0x204],
    r10: sim.memory[0x205],
    psw: sim.memory[0x206] & 0xF,
  };
}

test('FADD traps, writes F0 and preserves F1 and the shared registers', () => {
  const sim = boot();
  runProgram(sim, program('FADD', 0x3FC0, 0, 0x4010, 0));
  const out = stored(sim);
  assert.equal(out.f0High, 0x4070, '1.5 + 2.25 = 3.75');
  assert.equal(out.f0Low, 0);
  assert.equal(out.f1High, 0x4010, 'F1 is preserved');
  assert.equal(out.f1Low, 0);
  assert.equal(out.r9, 0x1234, 'shared R9 is preserved');
  assert.equal(out.r10, 0x1678, 'shared R10 is preserved');
});

test('FMUL, FDIV and FSQRT trap through the same handler', () => {
  const mul = boot();
  runProgram(mul, program('FMUL', 0x3FC0, 0, 0x4010, 0));
  assert.deepEqual([stored(mul).f0High, stored(mul).f0Low], [0x4058, 0], '1.5 * 2.25');

  const div = boot();
  runProgram(div, program('FDIV', 0x4040, 0, 0x4000, 0));
  assert.deepEqual([stored(div).f0High, stored(div).f0Low], [0x3FC0, 0], '3 / 2');

  const sqrt = boot();
  runProgram(sqrt, program('FSQRT', 0x4080, 0, 0x4000, 0));
  assert.deepEqual([stored(sqrt).f0High, stored(sqrt).f0Low], [0x4000, 0], 'sqrt(4)');
  assert.deepEqual([stored(sqrt).f1High, stored(sqrt).f1Low], [0x4000, 0], 'FSQRT preserves F1');
});

test('FCMP delivers N/Z/V through SAPF and writes no register', () => {
  const sim = boot();
  runProgram(sim, program('FCMP', 0x3F80, 0, 0x4000, 0));
  const out = stored(sim);
  assert.equal(out.psw, 0x1, '1.0 < 2.0 sets N');
  assert.equal(out.f0High, 0x3F80, 'FCMP preserves F0');
  assert.equal(out.f0Low, 0);
  assert.equal(out.f1High, 0x4000, 'FCMP preserves F1');

  const equal = boot();
  runProgram(equal, program('FCMP', 0x3F80, 0, 0x3F80, 0));
  assert.equal(stored(equal).psw, 0x2, '1.0 == 1.0 sets Z');

  const unordered = boot();
  runProgram(unordered, program('FCMP', 0x7FC0, 0, 0x3F80, 0));
  assert.equal(stored(unordered).psw, 0x4, 'NaN is unordered (V)');
});

test('FEXP and FLOG return the canonical NaN until implemented', () => {
  for (const opcode of ['FEXP', 'FLOG']) {
    const sim = boot();
    runProgram(sim, program(opcode, 0x3F80, 0, 0x3F80, 0));
    assert.equal(stored(sim).f0High, 0x7FC0, `${opcode} -> NaN`);
    assert.equal(stored(sim).f0Low, 0);
  }
});

test('a second FPU trap re-enters the handler with the updated F0', () => {
  const sim = boot();
  runProgram(sim, `
.org 0x4f00
${loadPair(0x3FC0, 0, 'R2', 'R3')}
${loadPair(0x4010, 0, 'R4', 'R5')}
    FADD                 ; F0 = 3.75
${loadPair(0x4000, 0, 'R4', 'R5')}
    FMUL                 ; F0 = 7.5
    LDI 0x0200
    MOV R6, R0
    ST R2, R6, 0
    ADD R6, 1
    ST R3, R6, 0
    HALT
`);
  assert.equal(sim.memory[0x200], 0x40F0, '1.5+2.25 then *2 = 7.5');
  assert.equal(sim.memory[0x201], 0);
});
