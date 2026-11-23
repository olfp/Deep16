// FEXP/FLOG accuracy. fexp32/flog32 live at 0x6000 and are only assembled
// under FPU_KERNEL, so the probe sits at 0x4000 where the PC-relative LDI
// reaches the transcendental block. The input is at 0x0200, the result at
// 0x0300, matching the rest of the soft-float tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, buildMemory, loadBrowserScripts, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const LIB = fs.readFileSync(path.join(ROOT, 'asm', 'softfloat.asm'), 'utf8');
const PROBE = 0x4000;

function program(routine) {
  return `
.equ ill_restore_shared,0x4000
.org 0x${PROBE.toString(16)}
start:
    LDI 0x0200
    MOV R5, R0
    LD R6, R5, 0
    LD R7, R5, 1
    MOV R11, PC
call:
    LDI ${routine} - call
    ADD R11, R0
    MOV R3, R11
    LINK
    JMP R11
    NOP
    LDI 0x0300
    MOV R5, R0
    ST R6, R5, 0
    ADD R5, 1
    ST R7, R5, 0
    HALT
${LIB}
`;
}

const bitsOf = (value) => {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  return view.getUint32(0) >>> 0;
};
const f32 = (bits) => {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, bits >>> 0);
  return view.getFloat32(0);
};
const hex = (value) => '0x' + (value >>> 0).toString(16).padStart(8, '0');

// Same-sign floats order by their magnitude bits, so this is the exact
// number of representable steps between two results.
function ulpDistance(a, b) {
  if (a === b) return 0;
  if ((a >>> 31) !== (b >>> 31)) return Infinity;
  return Math.abs((a & 0x7fffffff) - (b & 0x7fffffff));
}

function runner(routine) {
  const res = assemble(program(routine), { defines: { FPU_KERNEL: 1 } });
  assert.equal(res.success, true, res.errors.join('; '));
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0;
  sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0;
  return (bits) => {
    sim.registers[15] = PROBE;
    sim.registers[13] = 0x7f00;
    sim.running = true;
    sim.memory[0x200] = bits >>> 16;
    sim.memory[0x201] = bits & 0xffff;
    for (let i = 0; i < 1000000 && sim.running; i++) sim.step();
    assert.equal(sim.running, false, `${routine} must halt`);
    return ((sim.memory[0x300] << 16) | sim.memory[0x301]) >>> 0;
  };
}

let seed = 0x51ED270B;
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed;
};

test('fexp32 stays within one ulp on normal results', () => {
  const run = runner('fexp32');
  const inputs = [
    0, -0, 1, -1, 0.5, -0.5, 2, -2, 10, -10, 40, -40, 80, -80,
    87, -87, 88, -88, Math.LN2, -Math.LN2, 2 * Math.LN2, -2 * Math.LN2,
  ];
  for (let i = 0; i < 300; i++) inputs.push(-90 + (rnd() % 10000) / 10000 * 181);
  for (const value of inputs) {
    const x = f32(bitsOf(value));
    const want = Math.fround(Math.exp(x));
    const got = run(bitsOf(value));
    if (!Number.isFinite(want)) {
      assert.equal(got, 0x7F800000, `fexp32(${x}) should overflow to +Inf`);
    } else if (want === 0) {
      assert.equal(got, 0, `fexp32(${x}) should flush to +0`);
    } else if (((bitsOf(want) >>> 23) & 0xFF) === 0) {
      assert.equal(got, 0, `fexp32(${x}) should flush a denormal to +0`);
    } else {
      const steps = ulpDistance(got, bitsOf(want));
      assert.ok(steps <= 1,
                `fexp32(${x}): got ${hex(got)}, want ${hex(bitsOf(want))}, ${steps} ulp`);
    }
  }
});

test('flog32 stays within two ulps on normal results', () => {
  const run = runner('flog32');
  const inputs = [
    1, 2, 0.5, Math.E, 10, 0.1, 3.4e38, 3e-38,
    1.0000001, 0.9999999, 4, 0.25,
  ];
  for (let i = 0; i < 300; i++) {
    const exp = 1 + (rnd() % 254);
    inputs.push(f32((exp << 23) | (rnd() & 0x7fffff)));
  }
  for (const value of inputs) {
    const x = f32(bitsOf(value));
    const want = Math.fround(Math.log(x));
    const got = run(bitsOf(value));
    const steps = ulpDistance(got, bitsOf(want));
    assert.ok(steps <= 2,
              `flog32(${x}): got ${hex(got)}, want ${hex(bitsOf(want))}, ${steps} ulp`);
  }
});

test('fexp32 and flog32 handle the special values', () => {
  const exp = runner('fexp32');
  assert.equal(exp(bitsOf(0)), 0x3F800000, 'exp(0) = 1');
  assert.equal(exp(bitsOf(-0)), 0x3F800000, 'exp(-0) = 1');
  assert.equal(exp(0x7F800000), 0x7F800000, 'exp(+Inf) = +Inf');
  assert.equal(exp(0x7FC00000), 0x7FC00000, 'exp(NaN) = NaN');
  assert.equal(exp(bitsOf(200)), 0x7F800000, 'large x overflows');
  assert.equal(exp(bitsOf(-200)), 0, 'large negative x underflows');

  const log = runner('flog32');
  assert.equal(log(bitsOf(0)), 0xFF800000, 'log(+0) = -Inf');
  assert.equal(log(bitsOf(-0)), 0xFF800000, 'log(-0) = -Inf');
  assert.equal(log(bitsOf(-1)), 0x7FC00000, 'log(negative) = NaN');
  assert.equal(log(0x7F800000), 0x7F800000, 'log(+Inf) = +Inf');
  assert.equal(log(0xFF800000), 0x7FC00000, 'log(-Inf) = NaN');
  assert.equal(log(0x7FC00000), 0x7FC00000, 'log(NaN) = NaN');
  assert.equal(log(bitsOf(1)), 0, 'log(1) = +0');
  assert.equal(log(bitsOf(1e-39)), 0xFF800000,
               'a positive denormal flushes to zero, so log is -Inf');
});
