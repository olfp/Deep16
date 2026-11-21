// P3: the soft-float layer 1+2 routines in asm/softfloat.asm.
//
// The routines are ordinary subroutines, so they are tested directly - no ILL
// trap, no FPU opcode. The library is assembled at 0x1000; the test programs
// place input words at 0x0200 and the result at 0x0300.
//
// Numeric policy (FPUEMUPLAN.md section 8): denormals flush to signed zero,
// one canonical quiet NaN (0x7FC00000), truncate toward zero, infinities are
// generated and consumed, and no exception flags are delivered.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, buildMemory, loadBrowserScripts, runJs, runRtl, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const LIB = fs.readFileSync(path.join(ROOT, 'asm', 'softfloat.asm'), 'utf8');
const LIB_ORIGIN = 0x1000;

function withLib(source) {
  return `${source}\n.org 0x${LIB_ORIGIN.toString(16)}\n${LIB}`;
}

function runJsProgram(source, maxSteps = 200000) {
  const res = assemble(withLib(source));
  assert.equal(res.success, true, res.errors.join('; '));
  const sim = runJs(res, { cs: 0x0000, maxSteps }).sim;
  assert.equal(sim.running, false, 'the program must halt');
  return { sim, res };
}

async function runRtlProgram(source, maxSteps = 200000) {
  const res = assemble(withLib(source));
  assert.equal(res.success, true, res.errors.join('; '));
  return runRtl(res, { cs: 0x0000, maxSteps });
}

const bitsOf = (value) => {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  return view.getUint32(0);
};
const f32 = (hi, lo) => (((hi & 0xFFFF) << 16) | (lo & 0xFFFF)) >>> 0;
const hex = (value) => '0x' + (value >>> 0).toString(16).padStart(8, '0');

// i2f/u2f are exact for every 16-bit input, so the test is exhaustive. The
// loop stores the high word in DS:value and the low word in ES:value; both
// pointers are the value itself, which keeps the harness to one 16-bit counter.
function exhaustiveConversion(routine) {
  const source = `
.org 0
    LDI 0x1000
    MVS DS, R0
    LDI 0x2000
    MVS ES, R0
    LDI 0
    MOV R4, R0
loop:
    LDI ${routine}
    MOV R3, R0
    MOV R0, R4
    LINK
    JMP R3
    NOP
    STS R2, DS, R4
    STS R3, ES, R4
    ADD R4, 1
    CMP R4, 0
    JNZ loop
    NOP
    HALT
`;
  const { sim } = runJsProgram(source, 6000000);
  return sim.memory;
}

function checkConversion(routine, signed) {
  const memory = exhaustiveConversion(routine);
  for (let word = 0; word <= 0xFFFF; word++) {
    const value = signed ? ((word << 16) >> 16) : word;
    const got = ((memory[0x10000 + word] << 16) | memory[0x20000 + word]) >>> 0;
    const want = bitsOf(value);
    if (got !== want) {
      assert.fail(`${routine}(${value}): got ${hex(got)}, want ${hex(want)}`);
    }
  }
}

test('i2f is exact for all 65,536 signed 16-bit values', () => {
  checkConversion('i2f', true);
});

test('u2f is exact for all 65,536 unsigned 16-bit values', () => {
  checkConversion('u2f', false);
});

// A binary-op harness: data words at 0x0200, result at 0x0300.
function binaryProgram(routine, a, b) {
  return `
.org 0
    LDI 0x0200
    MOV R5, R0
    LD R6, R5, 0
    LD R7, R5, 1
    LD R8, R5, 2
    LD R9, R5, 3
    LDI ${routine}
    MOV R3, R0
    LINK
    JMP R3
    NOP
    LDI 0x0300
    MOV R5, R0
    ST R6, R5, 0
    ADD R5, 1
    ST R7, R5, 0
    HALT
.org 0x0200
    .word 0x${((a >>> 16) & 0xFFFF).toString(16)}
    .word 0x${(a & 0xFFFF).toString(16)}
    .word 0x${((b >>> 16) & 0xFFFF).toString(16)}
    .word 0x${(b & 0xFFFF).toString(16)}
`;
}

function binaryResult(sim) {
  return ((sim.memory[0x300] << 16) | sim.memory[0x301]) >>> 0;
}

const vectors = [
  // FADD / FSUB
  ['fadd32', '1.5 + 2.25', f32(0x3FC0, 0), f32(0x4010, 0), f32(0x4070, 0)],
  ['fadd32', '1 + 1', f32(0x3F80, 0), f32(0x3F80, 0), f32(0x4000, 0)],
  ['fadd32', '1 + -1', f32(0x3F80, 0), f32(0xBF80, 0), 0],
  ['fadd32', '3 + -1', f32(0x4040, 0), f32(0xBF80, 0), f32(0x4000, 0)],
  ['fadd32', '1 + -2', f32(0x3F80, 0), f32(0xC000, 0), f32(0xBF80, 0)],
  ['fadd32', '1 + 2^-24 (truncates)', f32(0x3F80, 0), f32(0x3380, 0), f32(0x3F80, 0)],
  ['fadd32', '1 - 2^-24', f32(0x3F80, 0), f32(0xB380, 0), f32(0x3F7F, 0xFFFF)],
  ['fadd32', '1 - 2^-25', f32(0x3F80, 0), f32(0xB300, 0), f32(0x3F7F, 0xFFFF)],
  ['fadd32', '0 + 1.5', 0, f32(0x3FC0, 0), f32(0x3FC0, 0)],
  ['fadd32', '+Inf + 1', f32(0x7F80, 0), f32(0x3F80, 0), f32(0x7F80, 0)],
  ['fadd32', '+Inf + -Inf', f32(0x7F80, 0), f32(0xFF80, 0), 0x7FC00000],
  ['fadd32', 'NaN + 1', f32(0x7FC0, 0), f32(0x3F80, 0), 0x7FC00000],
  ['fsub32', '1.5 - 2.25', f32(0x3FC0, 0), f32(0x4010, 0), f32(0xBF40, 0)],
  ['fsub32', '1 - 1', f32(0x3F80, 0), f32(0x3F80, 0), 0],
  ['fsub32', '3 - 1', f32(0x4040, 0), f32(0x3F80, 0), f32(0x4000, 0)],
  ['fsub32', '1 - 2', f32(0x3F80, 0), f32(0x4000, 0), f32(0xBF80, 0)],
  ['fsub32', '0 - 1', 0, f32(0x3F80, 0), f32(0xBF80, 0)],
  ['fsub32', '1 - 0', f32(0x3F80, 0), 0, f32(0x3F80, 0)],
  // FMUL
  ['fmul32', '1.5 * 2.25', f32(0x3FC0, 0), f32(0x4010, 0), f32(0x4058, 0)],
  ['fmul32', '2 * 3', f32(0x4000, 0), f32(0x4040, 0), f32(0x40C0, 0)],
  ['fmul32', '1 * 1', f32(0x3F80, 0), f32(0x3F80, 0), f32(0x3F80, 0)],
  ['fmul32', '-1 * 1', f32(0xBF80, 0), f32(0x3F80, 0), f32(0xBF80, 0)],
  ['fmul32', '0.5 * 8', f32(0x3F00, 0), f32(0x4100, 0), f32(0x4080, 0)],
  ['fmul32', '1.5 * 0', f32(0x3FC0, 0), 0, 0],
  ['fmul32', '-1.5 * 0', f32(0xBFC0, 0), 0, 0x80000000],
  ['fmul32', '+Inf * 2', f32(0x7F80, 0), f32(0x4000, 0), f32(0x7F80, 0)],
  ['fmul32', '+Inf * -2', f32(0x7F80, 0), f32(0xC000, 0), f32(0xFF80, 0)],
  ['fmul32', '+Inf * 0', f32(0x7F80, 0), 0, 0x7FC00000],
  ['fmul32', 'NaN * 2', f32(0x7FC0, 0), f32(0x4000, 0), 0x7FC00000],
  ['fmul32', 'overflow to +Inf', f32(0x7F00, 0), f32(0x7F00, 0), f32(0x7F80, 0)],
  ['fmul32', 'underflow to +0', f32(0x0100, 0), f32(0x0100, 0), 0],
  ['fmul32', '2^-126 * 2', f32(0x0080, 0), f32(0x4000, 0), f32(0x0100, 0)],
];

test('FADD/FSUB/FMUL match the truncating policy on JS and RTL', async () => {
  for (const [routine, name, a, b, want] of vectors) {
    const source = binaryProgram(routine, a, b);
    const { sim } = runJsProgram(source);
    assert.equal(binaryResult(sim), want, `JS ${name}`);

    const rtl = await runRtlProgram(source);
    const got = ((rtl.memoryAt(0x300, 1)[0] << 16) | rtl.memoryAt(0x301, 1)[0]) >>> 0;
    assert.equal(got, want, `RTL ${name}`);
  }
});

// The 24x24 mantissa multiply is the core of FMUL; pin it directly against a
// BigInt reference, including the truncation and the exponent-increment bit.
test('fmul24 matches a BigInt reference', () => {
  let seed = 0x12345678;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed;
  };
  const reference = (a, b) => {
    const product = BigInt(a) * BigInt(b);
    return (product >> 47n) & 1n
      ? { significand: Number(product >> 24n), increment: 1 }
      : { significand: Number(product >> 23n), increment: 0 };
  };
  for (let i = 0; i < 100; i++) {
    const a = 0x800000 + (rnd() % 0x800000);
    const b = 0x800000 + (rnd() % 0x800000);
    const source = `
.org 0
    LDI fmul24
    MOV R3, R0
    LDI 0x0200
    MOV R6, R0
    LD R4, R6, 0
    LD R5, R6, 1
    LD R0, R6, 2
    LD R1, R6, 3
    LINK
    JMP R3
    NOP
    LDI 0x0300
    MOV R6, R0
    ST R4, R6, 0
    ADD R6, 1
    ST R5, R6, 0
    ADD R6, 1
    ST R10, R6, 0
    HALT
.org 0x0200
    .word 0x${((a >>> 16) & 0xFFFF).toString(16)}
    .word 0x${(a & 0xFFFF).toString(16)}
    .word 0x${((b >>> 16) & 0xFFFF).toString(16)}
    .word 0x${(b & 0xFFFF).toString(16)}
`;
    const { sim } = runJsProgram(source);
    const got = ((sim.memory[0x300] << 16) | sim.memory[0x301]) >>> 0;
    const want = reference(a, b);
    assert.equal(got, want.significand, `fmul24 ${a.toString(16)} * ${b.toString(16)}`);
    assert.equal(sim.memory[0x302], want.increment,
                 `fmul24 exponent increment ${a.toString(16)} * ${b.toString(16)}`);
  }
});
