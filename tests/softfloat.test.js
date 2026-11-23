// P3: the soft-float layer 1+2 routines in asm/softfloat.asm.
//
// The routines are ordinary subroutines, so they are tested directly - no ILL
// trap, no FPU opcode. The library is assembled at 0x1000; the test programs
// place input words at 0x0200 and the result at 0x0300.
//
// Numeric policy (FPUEMUPLAN.md section 8): denormals flush to signed zero,
// one canonical quiet NaN (0x7FC00000), round to nearest with ties to even,
// infinities are generated and consumed, and no exception flags are delivered.
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
const V = (value) => bitsOf(value);
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
    ADD R5, 1
    ST R10, R5, 0
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
  ['fadd32', '1 + 2^-24 (tie to even)', f32(0x3F80, 0), f32(0x3380, 0), f32(0x3F80, 0)],
  ['fadd32', '1 + 1.5*2^-24', f32(0x3F80, 0), f32(0x33C0, 0), f32(0x3F80, 1)],
  ['fadd32', '1 - 2^-24 (exact prevfloat)', f32(0x3F80, 0), f32(0xB380, 0), f32(0x3F7F, 0xFFFF)],
  ['fadd32', '1 - 1.5*2^-24', f32(0x3F80, 0), f32(0xB3C0, 0), f32(0x3F7F, 0xFFFE)],
  ['fadd32', '1 - 2^-25 (tie to even)', f32(0x3F80, 0), f32(0xB300, 0), f32(0x3F80, 0)],
  ['fadd32', '0 + 1.5', 0, f32(0x3FC0, 0), f32(0x3FC0, 0)],
  ['fadd32', '1 + 0.75*2^-23', f32(0x3F80, 0), f32(0x33C0, 0), f32(0x3F80, 1)],
  ['fadd32', '2 - 1.5*2^-24', f32(0x4000, 0), f32(0xB3C0, 0), f32(0x3FFF, 0xFFFF)],
  ['fadd32', '+Inf + 1', f32(0x7F80, 0), f32(0x3F80, 0), f32(0x7F80, 0)],
  ['fadd32', '+Inf + -Inf', f32(0x7F80, 0), f32(0xFF80, 0), 0x7FC00000],
  ['fadd32', 'NaN + 1', f32(0x7FC0, 0), f32(0x3F80, 0), 0x7FC00000],
  ['fsub32', '1.5 - 2.25', f32(0x3FC0, 0), f32(0x4010, 0), f32(0xBF40, 0)],
  ['fsub32', '1 - 1', f32(0x3F80, 0), f32(0x3F80, 0), 0],
  ['fsub32', '3 - 1', f32(0x4040, 0), f32(0x3F80, 0), f32(0x4000, 0)],
  ['fsub32', '1 - 2', f32(0x3F80, 0), f32(0x4000, 0), f32(0xBF80, 0)],
  ['fsub32', '0 - 1', 0, f32(0x3F80, 0), f32(0xBF80, 0)],
  ['fsub32', '1 - 0', f32(0x3F80, 0), 0, f32(0x3F80, 0)],
  // Close subtractions across a power-of-two boundary: the exact difference
  // is far below A's exponent, so the guard bits decide the result.
  ['fsub32', '1 - nextbelow(1)', f32(0x3F80, 0), f32(0x3F7F, 0xFFFF), f32(0x3380, 0)],
  ['fsub32', '1 - 2ulp below 1', f32(0x3F80, 0), f32(0x3F7F, 0xFFFE), f32(0x3400, 0)],
  ['fsub32', '1 - 3ulp below 1', f32(0x3F80, 0), f32(0x3F7F, 0xFFFD), f32(0x3440, 0)],
  ['fsub32', '2 - nextbelow(2)', f32(0x4000, 0), f32(0x3FFF, 0xFFFF), f32(0x3400, 0)],
  ['fsub32', '1 - 0.5', f32(0x3F80, 0), f32(0x3F00, 0), f32(0x3F00, 0)],
  ['fsub32', '1 - 0.75', f32(0x3F80, 0), f32(0x3F40, 0), f32(0x3E80, 0)],
  ['fsub32', '3 - nextbelow(3)', f32(0x4040, 0), f32(0x403F, 0xFFFF), f32(0x3480, 0)],
  ['fsub32', '0.5 - nextbelow(0.5)', f32(0x3F00, 0), f32(0x3EFF, 0xFFFF), f32(0x3300, 0)],
  ['fsub32', '1.5 - nextbelow(1.5)', f32(0x3FC0, 0), f32(0x3FBF, 0xFFFF), f32(0x3400, 0)],
  ['fsub32', '3 - 2ulp below 3', f32(0x4040, 0), f32(0x403F, 0xFFFE), f32(0x3500, 0)],
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

test('FADD/FSUB/FMUL match the round-to-nearest policy on JS and RTL', async () => {
  for (const [routine, name, a, b, want] of vectors) {
    const source = binaryProgram(routine, a, b);
    const { sim } = runJsProgram(source);
    assert.equal(binaryResult(sim), want, `JS ${name}`);

    const rtl = await runRtlProgram(source);
    const got = ((rtl.memoryAt(0x300, 1)[0] << 16) | rtl.memoryAt(0x301, 1)[0]) >>> 0;
    assert.equal(got, want, `RTL ${name}`);
  }
});

// The 24x24 mantissa multiply is the core of FMUL; pin the stored 24-bit
// significand, the exponent-increment bit, and the guard/sticky pair against a
// BigInt reference.
test('fmul24 matches a BigInt reference', () => {
  let seed = 0x12345678;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed;
  };
  const reference = (a, b) => {
    const product = BigInt(a) * BigInt(b);
    if ((product >> 47n) & 1n) {
      return {
        significand: Number(product >> 24n),
        increment: 1,
        guard: Number((product >> 23n) & 1n),
        sticky: (product & 0x7FFFFFn) === 0n ? 0 : 1,
      };
    }
    return {
      significand: Number(product >> 23n),
      increment: 0,
      guard: Number((product >> 22n) & 1n),
      sticky: (product & 0x3FFFFFn) === 0n ? 0 : 1,
    };
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
    MOV R8, R0
    ST R4, R8, 0
    ADD R8, 1
    ST R5, R8, 0
    ADD R8, 1
    ST R10, R8, 0
    ADD R8, 1
    ST R6, R8, 0
    ADD R8, 1
    ST R7, R8, 0
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
    assert.equal(sim.memory[0x303], want.guard,
                 `fmul24 guard ${a.toString(16)} * ${b.toString(16)}`);
    assert.equal(sim.memory[0x304], want.sticky,
                 `fmul24 sticky ${a.toString(16)} * ${b.toString(16)}`);
  }
});

// Round an exact magnitude to a float32 significand. The value is
// magnitude * 2^(e-150); magnitude is positive.
function roundMagnitude(sign, magnitude, e) {
  const length = magnitude.toString(2).length;
  let exponent;
  let significand;
  if (length <= 24) {
    significand = magnitude << BigInt(24 - length);
    exponent = e + length - 24;
  } else {
    const shift = BigInt(length - 24);
    let q = magnitude >> shift;
    const rem = magnitude & ((1n << shift) - 1n);
    const half = 1n << (shift - 1n);
    if (rem > half || (rem === half && (q & 1n) === 1n)) q += 1n;
    exponent = e + length - 24;
    if (q === (1n << 24n)) {
      q >>= 1n;
      exponent += 1;
    }
    significand = q;
  }
  if (exponent <= 0) return sign << 31;
  if (exponent >= 255) return (sign << 31) | 0x7F800000;
  return (sign << 31) | (exponent << 23) | Number(significand & 0x7FFFFFn);
}

// Exact BigInt subtraction followed by round-to-nearest, ties to even. This is
// the property the exact left-aligned path must reproduce for every exponent
// difference, not just the hand-picked boundaries above.
function refSubtract(aBits, bBits) {
  const decode = (bits) => {
    const sign = bits >>> 31;
    const exp = (bits >>> 23) & 0xFF;
    const mant = bits & 0x7FFFFF;
    return exp === 0 ? { sign: 0, exp: 0, mant: 0 } : { sign, exp, mant };
  };
  const a = decode(aBits);
  const b = decode(bBits);
  const aZero = a.exp === 0;
  const bZero = b.exp === 0;
  if (aZero && bZero) return 0;
  const e = aZero ? b.exp : bZero ? a.exp : Math.min(a.exp, b.exp);
  const toInt = (v) => {
    if (v.exp === 0) return 0n;
    const magnitude = BigInt(0x800000 | v.mant) << BigInt(v.exp - e);
    return v.sign ? -magnitude : magnitude;
  };
  const d = toInt(a) - toInt(b);
  if (d === 0n) return 0;
  const sign = d < 0n ? 1 : 0;
  const magnitude = d < 0n ? -d : d;
  return roundMagnitude(sign, magnitude, e) >>> 0;
}

// Exact BigInt addition followed by round-to-nearest, ties to even. This
// exercises the aligned-tail path and the d >= 24 half-ulp cases across the
// whole exponent range, not just the hand-picked boundaries above.
function refAdd(aBits, bBits) {
  const decode = (bits) => {
    const sign = bits >>> 31;
    const exp = (bits >>> 23) & 0xFF;
    const mant = bits & 0x7FFFFF;
    return exp === 0 ? { sign: 0, exp: 0, mant: 0 } : { sign, exp, mant };
  };
  const a = decode(aBits);
  const b = decode(bBits);
  const aZero = a.exp === 0;
  const bZero = b.exp === 0;
  if (aZero && bZero) return 0;
  const e = aZero ? b.exp : bZero ? a.exp : Math.min(a.exp, b.exp);
  const toInt = (v) => {
    if (v.exp === 0) return 0n;
    const magnitude = BigInt(0x800000 | v.mant) << BigInt(v.exp - e);
    return v.sign ? -magnitude : magnitude;
  };
  const d = toInt(a) + toInt(b);
  if (d === 0n) return 0;
  const sign = d < 0n ? 1 : 0;
  const magnitude = d < 0n ? -d : d;
  return roundMagnitude(sign, magnitude, e) >>> 0;
}

test('fadd32 matches an exact BigInt reference across exponent differences', () => {
  let seed = 0xADD1234;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 200; i++) {
    const a = ((rnd() & 1) << 31) | ((1 + (rnd() % 254)) << 23) | (rnd() & 0x7FFFFF);
    const b = ((rnd() & 1) << 31) | ((1 + (rnd() % 254)) << 23) | (rnd() & 0x7FFFFF);
    const source = binaryProgram('fadd32', a >>> 0, b >>> 0);
    const { sim } = runJsProgram(source);
    assert.equal(binaryResult(sim), refAdd(a >>> 0, b >>> 0) >>> 0,
                 `fadd32 ${hex(a)} + ${hex(b)}`);
  }
});

test('fsub32 matches an exact BigInt reference across exponent differences', () => {
  let seed = 0xC0FFEE;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 100; i++) {
    const a = ((rnd() & 1) << 31) | ((1 + (rnd() % 254)) << 23) | (rnd() & 0x7FFFFF);
    const b = ((rnd() & 1) << 31) | ((1 + (rnd() % 254)) << 23) | (rnd() & 0x7FFFFF);
    const source = binaryProgram('fsub32', a >>> 0, b >>> 0);
    const { sim } = runJsProgram(source);
    assert.equal(binaryResult(sim), refSubtract(a >>> 0, b >>> 0) >>> 0,
                 `fsub32 ${hex(a)} - ${hex(b)}`);
  }
});

function f2iProgram(valueBits) {
  return `
.org 0
    LDI f2i
    MOV R5, R0
    LDI 0x0200
    MOV R8, R0
    LD R2, R8, 0
    LD R3, R8, 1
    LINK
    JMP R5
    NOP
    MOV R6, R0
    MOV R7, R10
    LDI 0x0300
    MOV R9, R0
    ST R6, R9, 0
    ADD R9, 1
    ST R7, R9, 0
    HALT
.org 0x0200
    .word 0x${((valueBits >>> 16) & 0xFFFF).toString(16)}
    .word 0x${(valueBits & 0xFFFF).toString(16)}
`;
}

test('f2i truncates, clamps and reports N/Z/V', () => {
  const cases = [
    [0x00000000, 0, 0x2],                 // +0 -> Z
    [0x80000000, 0, 0x2],                 // -0 -> Z
    [0x3F800000, 1, 0x0],                 // 1.0
    [bitsOf(1.9999), 1, 0x0],             // truncates toward zero
    [bitsOf(-1.9999), 0xFFFF, 0x1],       // -1, N
    [bitsOf(0.9999), 0, 0x2],             // < 1 -> 0
    [bitsOf(-0.9999), 0, 0x2],
    [bitsOf(32767.9), 0x7FFF, 0x0],       // representable after truncation
    [bitsOf(32768.0), 0x7FFF, 0x4],       // clamp, V
    [bitsOf(-32768.0), 0x8000, 0x1],      // exact -32768, no V
    [bitsOf(-32768.9), 0x8000, 0x5],      // clamp, N|V
    [0x7F800000, 0x7FFF, 0x4],            // +Inf -> +32767, V
    [0xFF800000, 0x8000, 0x5],            // -Inf -> -32768, N|V
    [0x7FC00000, 0, 0x6],                 // NaN -> 0, Z|V
    [bitsOf(65536.0), 0x7FFF, 0x4],
    [0x00000001, 0, 0x2],                 // denormal flushed
    [0x80000001, 0, 0x2],
  ];
  for (const [bits, wantResult, wantFlags] of cases) {
    const { sim } = runJsProgram(f2iProgram(bits));
    assert.equal(sim.memory[0x300], wantResult, `f2i(${hex(bits)}) result`);
    assert.equal(sim.memory[0x301], wantFlags, `f2i(${hex(bits)}) flags`);
  }
});

test('i2f -> f2i round-trips every 16-bit value and V stays clear', () => {
  const source = `
.org 0
    LDI 0x1000
    MVS DS, R0
    LDI 0x2000
    MVS ES, R0
    LDI 0
    MOV R4, R0
loop:
    LDI i2f
    MOV R5, R0
    MOV R0, R4
    LINK
    JMP R5
    NOP
    LDI f2i
    MOV R5, R0
    LINK
    JMP R5
    NOP
    STS R0, DS, R4
    STS R10, ES, R4
    ADD R4, 1
    CMP R4, 0
    JNZ loop
    NOP
    HALT
`;
  const { sim } = runJsProgram(source, 12000000);
  for (let word = 0; word <= 0xFFFF; word++) {
    const wantFlags = ((word & 0x8000) ? 1 : 0) | (word === 0 ? 2 : 0);
    assert.equal(sim.memory[0x10000 + word], word, `round trip ${word}`);
    assert.equal(sim.memory[0x20000 + word], wantFlags, `round-trip flags ${word}`);
  }
});

function compareReference(aBits, bBits) {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, aBits >>> 0);
  view.setUint32(4, bBits >>> 0);
  const a = view.getFloat32(0);
  const b = view.getFloat32(4);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0x4;
  if (a === b) return 0x2;
  if (a < b) return 0x1;
  return 0;
}

test('fcmp32 orders signed floats, zeros and NaNs', async () => {
  const cases = [
    [f32(0x3F80, 0), f32(0x3F80, 0), 0x2],
    [f32(0x3F80, 0), f32(0x4000, 0), 0x1],
    [f32(0x4000, 0), f32(0x3F80, 0), 0x0],
    [f32(0xBF80, 0), f32(0x3F80, 0), 0x1],
    [f32(0x3F80, 0), f32(0xBF80, 0), 0x0],
    [f32(0xBF80, 0), f32(0xC000, 0), 0x0],
    [f32(0xC000, 0), f32(0xBF80, 0), 0x1],
    [0x00000000, 0x80000000, 0x2],
    [0x80000000, f32(0x3F80, 0), 0x1],
    [0x00000000, f32(0xBF80, 0), 0x0],
    [f32(0x7F80, 0), f32(0x3F80, 0), 0x0],
    [f32(0x3F80, 0), f32(0x7F80, 0), 0x1],
    [f32(0xFF80, 0), f32(0x3F80, 0), 0x1],
    [f32(0x7F80, 0), f32(0x7F80, 0), 0x2],
    [f32(0x7FC0, 0), f32(0x3F80, 0), 0x4],
    [f32(0x3F80, 0), f32(0x7FC0, 0), 0x4],
    [f32(0x7FC0, 0), f32(0x7FC0, 0), 0x4],
    [0x00000001, 0x00000000, 0x2],
    [f32(0x3F80, 0), f32(0x3F7F, 0xFFFF), 0x0],
    [f32(0x3F7F, 0xFFFF), f32(0x3F80, 0), 0x1],
  ];
  for (const [a, b, want] of cases) {
    const { sim } = runJsProgram(binaryProgram('fcmp32', a, b));
    assert.equal(sim.memory[0x302], want, `fcmp32 ${hex(a)} ? ${hex(b)}`);

    const rtl = await runRtlProgram(binaryProgram('fcmp32', a, b));
    assert.equal(rtl.memoryAt(0x302, 1)[0], want, `RTL fcmp32 ${hex(a)} ? ${hex(b)}`);
  }
});

test('fcmp32 matches JS ordering on random finite pairs', () => {
  let seed = 0x5EED;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed;
  };
  for (let i = 0; i < 100; i++) {
    const a = ((rnd() & 1) << 31) | ((1 + (rnd() % 254)) << 23) | (rnd() & 0x7FFFFF);
    const b = ((rnd() & 1) << 31) | ((1 + (rnd() % 254)) << 23) | (rnd() & 0x7FFFFF);
    const { sim } = runJsProgram(binaryProgram('fcmp32', a >>> 0, b >>> 0));
    assert.equal(sim.memory[0x302], compareReference(a >>> 0, b >>> 0),
                 `fcmp32 ${hex(a)} ? ${hex(b)}`);
  }
});

function roundQuotient(sign, q, rem, divisor, exponent) {
  // q is floor(value) and rem/divisor is the fractional part at the 24-bit
  // scale. Round half to even, then fold a carry into the exponent.
  const twice = rem * 2n;
  if (twice > divisor || (twice === divisor && (q & 1n) === 1n)) q += 1n;
  if (q === (1n << 24n)) {
    q >>= 1n;
    exponent += 1;
  }
  if (exponent <= 0) return (sign << 31) >>> 0;
  if (exponent >= 255) return ((sign << 31) | 0x7F800000) >>> 0;
  return ((sign << 31) | (exponent << 23) | Number(q & 0x7FFFFFn)) >>> 0;
}

function refDivide(aBits, bBits) {
  const decode = (bits) => ({
    sign: bits >>> 31,
    exp: (bits >>> 23) & 0xFF,
    mant: bits & 0x7FFFFF,
  });
  const a = decode(aBits);
  const b = decode(bBits);
  const aNaN = a.exp === 255 && a.mant !== 0;
  const bNaN = b.exp === 255 && b.mant !== 0;
  if (aNaN || bNaN) return 0x7FC00000;
  const sign = (a.sign ^ b.sign) >>> 0;
  const aInf = a.exp === 255;
  const bInf = b.exp === 255;
  if (aInf && bInf) return 0x7FC00000;
  if (aInf) return ((sign << 31) | 0x7F800000) >>> 0;
  if (bInf) return (sign << 31) >>> 0;
  const aZero = a.exp === 0;
  const bZero = b.exp === 0;
  if (bZero) return aZero ? 0x7FC00000 : ((sign << 31) | 0x7F800000) >>> 0;
  if (aZero) return (sign << 31) >>> 0;
  const mA = BigInt(0x800000 | a.mant);
  const mB = BigInt(0x800000 | b.mant);
  const base = a.exp - b.exp + 127;
  if (mA >= mB) {
    const numerator = mA << 23n;
    return roundQuotient(sign, numerator / mB, numerator % mB, mB, base);
  }
  const numerator = mA << 24n;
  return roundQuotient(sign, numerator / mB, numerator % mB, mB, base - 1);
}

test('fdiv32 matches an exact BigInt reference', async () => {
  const specials = [
    [V(6), V(2)], [V(1), V(1)], [V(1), V(2)], [V(2), V(1)],
    [V(1), V(4)], [V(-6), V(2)], [V(1), V(3)], [V(2), V(3)],
    [V(10), V(4)], [V(3), V(7)], [V(1), V(0)], [V(-1), V(0)],
    [V(0), V(0)], [0x7F800000, V(2)], [V(2), 0x7F800000],
    [0x7F800000, 0x7F800000], [0x7FC00000, V(2)], [V(1), 0x7F800000],
    [V(0), V(2)], [0x80000000, V(2)], [V(1), V(-2)],
  ];
  for (const [a, b] of specials) {
    const source = binaryProgram('fdiv32', a, b);
    const { sim } = runJsProgram(source);
    const want = refDivide(a, b);
    assert.equal(binaryResult(sim), want, `fdiv32 ${hex(a)} / ${hex(b)}`);

    const rtl = await runRtlProgram(source);
    assert.equal(((rtl.memoryAt(0x300, 1)[0] << 16) | rtl.memoryAt(0x301, 1)[0]) >>> 0,
                 want, `RTL fdiv32 ${hex(a)} / ${hex(b)}`);
  }

  let seed = 0xD1F1DE;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 100; i++) {
    const a = ((rnd() & 1) << 31) | ((1 + (rnd() % 254)) << 23) | (rnd() & 0x7FFFFF);
    const b = ((rnd() & 1) << 31) | ((1 + (rnd() % 254)) << 23) | (rnd() & 0x7FFFFF);
    const { sim } = runJsProgram(binaryProgram('fdiv32', a >>> 0, b >>> 0));
    assert.equal(binaryResult(sim), refDivide(a >>> 0, b >>> 0),
                 `fdiv32 ${hex(a)} / ${hex(b)}`);
  }
});

function sqrtProgram(valueBits) {
  return `
.org 0
    LDI fsqrt32
    MOV R5, R0
    LDI 0x0200
    MOV R4, R0
    LD R6, R4, 0
    LD R7, R4, 1
    LINK
    JMP R5
    NOP
    LDI 0x0300
    MOV R4, R0
    ST R6, R4, 0
    ADD R4, 1
    ST R7, R4, 0
    HALT
.org 0x0200
    .word 0x${((valueBits >>> 16) & 0xFFFF).toString(16)}
    .word 0x${(valueBits & 0xFFFF).toString(16)}
`;
}

function refSqrt(bits) {
  const sign = bits >>> 31;
  const exp = (bits >>> 23) & 0xFF;
  const mant = bits & 0x7FFFFF;
  if (exp === 255) {
    if (mant !== 0) return 0x7FC00000;
    return sign ? 0x7FC00000 : 0x7F800000;
  }
  if (exp === 0) return sign ? 0x80000000 : 0x00000000;
  if (sign) return 0x7FC00000;
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, bits >>> 0);
  return bitsOf(Math.fround(Math.sqrt(view.getFloat32(0))));
}

test('fsqrt32 matches a nearest-even reference on JS and RTL', async () => {
  const vectors = [
    [bitsOf(1), 0x3F800000],
    [bitsOf(2), 0x3FB504F3],
    [bitsOf(3), 0x3FDDB3D7],
    [bitsOf(4), 0x40000000],
    [bitsOf(9), 0x40400000],
    [bitsOf(0.25), 0x3F000000],
    [bitsOf(0.5), 0x3F3504F3],
    [bitsOf(10), 0x404A62C2],
    [bitsOf(0.1), 0x3EA1E89B],
    [bitsOf(100), 0x41200000],
    [bitsOf(1.5), 0x3F9CC471],
    [bitsOf(2.25), 0x3FC00000],
    [bitsOf(4.41), 0x40066666],
    [bitsOf(1e-3), 0x3D0186E3],
    [bitsOf(1e9), 0x46F70D8E],
    [f32(0x5F00, 0), 0x4F3504F3],
    [0x00000000, 0x00000000],
    [0x80000000, 0x80000000],
    [bitsOf(-1), 0x7FC00000],
    [0x7FC00000, 0x7FC00000],
    [0x7F800000, 0x7F800000],
    [0xFF800000, 0x7FC00000],
    [0x00000001, 0x00000000],
  ];
  for (const [value, want] of vectors) {
    const source = sqrtProgram(value);
    const { sim } = runJsProgram(source);
    assert.equal(binaryResult(sim), want, `JS fsqrt32 ${hex(value)}`);

    const rtl = await runRtlProgram(source);
    assert.equal(((rtl.memoryAt(0x300, 1)[0] << 16) | rtl.memoryAt(0x301, 1)[0]) >>> 0,
                 want, `RTL fsqrt32 ${hex(value)}`);
  }

  let seed = 0x5A7E;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 100; i++) {
    const value = ((1 + (rnd() % 254)) << 23) | (rnd() & 0x7FFFFF);
    const { sim } = runJsProgram(sqrtProgram(value));
    assert.equal(binaryResult(sim), refSqrt(value >>> 0), `fsqrt32 ${hex(value)}`);
  }
});
