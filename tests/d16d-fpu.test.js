// D16D FPU traps: the ILL vector enters the trampoline at flat 0x4D24, which
// switches to CS=0x3000/PC=0x0600. The handler and the soft-float library run
// from the BIOS copy, so the library must be present at BIOS offset 0x0E00
// (flat 0x5800 -> physical 0x30E00). The flat copy of the handler and library
// is poisoned after the scatter: a pass therefore proves the BIOS copy ran.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadBrowserScripts, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_linker.js',
                   'js/deep16_simulator.js', 'js/deep16_d16d_image.js');
const Deep16D16DImage = vm.runInThisContext('Deep16D16DImage');

const kernelSource = fs.readFileSync(path.join(ROOT, 'asm', 'forth_nano.asm'), 'utf8');
const softfloat = fs.readFileSync(path.join(ROOT, 'asm', 'softfloat.asm'), 'utf8');

// One D16D + FPU image, scattered into each test's memory. The library is at
// 0x5800; the kernel's BIOS data ends at 0x57FE, so it is a free run.
const image = Deep16D16DImage.assembleNano({
  kernel: kernelSource,
  softfloat,
  defines: { D16D: 1 },
});
const sym = image.result.symbols;
const LIB = 0x5800;
const FEXP = 0x6000;
const BIOS_LIB = 0x30000 + (LIB - 0x4A00);   // 0x30E00
const BIOS_FEXP = 0x30000 + (FEXP - 0x4A00); // 0x31600
const BIOS_HANDLER = 0x30000 + (0x5000 - 0x4A00);

assert.equal(sym.ill_trampoline, 0x4D24, 'the D16D trap vector is the BIOS trampoline');
assert.notEqual(image.words[LIB], 0xFFFF, 'the library is in the image');
assert.notEqual(image.words[FEXP], 0xFFFF, 'fexp32 is in the image');

function boot() {
  const sim = new globalThis.Deep16Simulator();
  Deep16D16DImage.scatterD16SEG(image.words, { memory: sim.memory });
  // The vector is installed by the kernel boot. Install the same value here;
  // this test starts below the boot so it can run in a few hundred steps.
  sim.memory[0] = sym.ill_trampoline;

  // Prove the BIOS copy, not the flat copy, is what executes.
  assert.equal(sim.memory[BIOS_LIB], image.words[LIB], 'f_unpack copied to 0x30E00');
  assert.equal(sim.memory[BIOS_FEXP], image.words[FEXP], 'fexp32 copied to 0x31600');
  assert.equal(sim.memory[BIOS_HANDLER], image.words[0x5000], 'the handler copied to 0x30600');
  for (let a = 0x5000; a < 0x7000; a++) sim.memory[a] = 0xFFFF;

  sim.d16nano = true;
  sim.running = true;
  sim.segmentRegisters.CS = 0x0000;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  // The kernel's data stack top. The handler saves R4..R12 in the BIOS
  // segment at this offset; 0xFFF0 is above the library at 0x0E00..0x18B5.
  sim.registers[13] = 0xFFF0;
  // The reserved save stack the boot sets for the shadow bank.
  sim.shadowRegisters.R13 = 0x5200;
  sim.registers[15] = 0x4F00;
  sim.psw = 0;
  return sim;
}

// LDI sign-extends bit 14, so a high word >= 0x4000 is built with a shift.
function loadHigh(register, high) {
  const h = high & 0xFFFF;
  return h < 0x4000
    ? `    LDI 0x${h.toString(16)}\n    MOV ${register}, R0\n`
    : `    LDI 0x${(h >> 1).toString(16)}\n    MOV ${register}, R0\n    SL ${register}, 1\n`;
}

function program(opcode, f0High, f1High) {
  return `
.org 0x4f00
${loadHigh('R2', f0High)}
    LSI R3, 0
${loadHigh('R4', f1High)}
    LSI R5, 0
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
    ST R7, R6, 0
    HALT
`;
}

function run(opcode, f0High, f1High) {
  const sim = boot();
  const prog = new globalThis.Deep16Assembler().assemble(program(opcode, f0High, f1High));
  assert.equal(prog.success, true, prog.errors.join('; '));
  for (const change of prog.memoryChanges) sim.memory[change.address] = change.value & 0xFFFF;
  for (let i = 0; i < 300000 && sim.running; i++) sim.step();
  assert.equal(sim.running, false, `${opcode} did not halt`);
  return {
    f0High: sim.memory[0x200],
    f0Low: sim.memory[0x201],
    f1High: sim.memory[0x202],
    f1Low: sim.memory[0x203],
    psw: sim.memory[0x204] & 0xF,
  };
}

test('FADD, FMUL, FDIV and FSQRT trap through the BIOS copy', () => {
  const add = run('FADD', 0x3FC0, 0x4010);
  assert.deepEqual([add.f0High, add.f0Low], [0x4070, 0], '1.5 + 2.25 = 3.75');
  assert.deepEqual([add.f1High, add.f1Low], [0x4010, 0], 'F1 is preserved');

  const mul = run('FMUL', 0x3FC0, 0x4010);
  assert.deepEqual([mul.f0High, mul.f0Low], [0x4058, 0], '1.5 * 2.25');

  const div = run('FDIV', 0x4040, 0x4000);
  assert.deepEqual([div.f0High, div.f0Low], [0x3FC0, 0], '3 / 2');

  const sqrt = run('FSQRT', 0x4080, 0x4000);
  assert.deepEqual([sqrt.f0High, sqrt.f0Low], [0x4000, 0], 'sqrt(4)');
  assert.deepEqual([sqrt.f1High, sqrt.f1Low], [0x4000, 0], 'FSQRT preserves F1');
});

test('FCMP delivers its flags through SAPF from the BIOS copy', () => {
  const less = run('FCMP', 0x3F80, 0x4000);
  assert.equal(less.psw, 0x1, '1.0 < 2.0 sets N');
  assert.deepEqual([less.f0High, less.f0Low], [0x3F80, 0], 'FCMP preserves F0');
  assert.deepEqual([less.f1High, less.f1Low], [0x4000, 0], 'FCMP preserves F1');

  const equal = run('FCMP', 0x3F80, 0x3F80);
  assert.equal(equal.psw, 0x2, '1.0 == 1.0 sets Z');

  const unordered = run('FCMP', 0x7FC0, 0x3F80);
  assert.equal(unordered.psw, 0x4, 'NaN is unordered (V)');
});

test('a second D16D trap re-enters the BIOS handler with the updated F0', () => {
  const sim = boot();
  const prog = new globalThis.Deep16Assembler().assemble(`
.org 0x4f00
${loadHigh('R2', 0x3FC0)}
    LSI R3, 0
${loadHigh('R4', 0x4010)}
    LSI R5, 0
    FADD                 ; F0 = 3.75
${loadHigh('R4', 0x4000)}
    LSI R5, 0
    FADD                 ; F0 = 5.75
    LDI 0x0200
    MOV R6, R0
    ST R2, R6, 0
    ADD R6, 1
    ST R3, R6, 0
    HALT
`);
  assert.equal(prog.success, true, prog.errors.join('; '));
  for (const change of prog.memoryChanges) sim.memory[change.address] = change.value & 0xFFFF;
  for (let i = 0; i < 300000 && sim.running; i++) sim.step();
  assert.equal(sim.running, false, 'the program did not halt');
  assert.equal(sim.memory[0x200], 0x40B8, '1.5+2.25 then +2 = 5.75');
  assert.equal(sim.memory[0x201], 0);
});

function f32(high, low) {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, (((high & 0xFFFF) << 16) | (low & 0xFFFF)) >>> 0, false);
  return view.getFloat32(0);
}

test('FEXP and FLOG run from the BIOS copy on D16D', () => {
  const exp = run('FEXP', 0x3F80, 0x4000);
  const expValue = f32(exp.f0High, exp.f0Low);
  assert.ok(Math.abs(expValue - Math.E) / Math.E < 1e-5,
            `exp(1) = ${expValue}`);
  assert.deepEqual([exp.f1High, exp.f1Low], [0x4000, 0], 'FEXP preserves F1');

  const log = run('FLOG', 0x4000, 0x4000);
  const logValue = f32(log.f0High, log.f0Low);
  assert.ok(Math.abs(logValue - Math.LN2) / Math.LN2 < 1e-5,
            `log(2) = ${logValue}`);

  const nan = run('FLOG', 0xBF80, 0x4000);
  assert.deepEqual([nan.f0High, nan.f0Low], [0x7FC0, 0], 'log(-1) -> NaN');
});
