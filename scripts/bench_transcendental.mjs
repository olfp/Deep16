#!/usr/bin/env node
// scripts/bench_transcendental.mjs - measure fexp32/flog32 on the cores.
//
// The probe sits at 0x4000 so its PC-relative LDI reaches fexp32/flog32 at
// 0x6000. Each vector is run once on the JS core and twice on the RTL core:
// step() mode (which pays a pipeline refill per instruction) and run_cycles()
// free-run mode, whose get_free_cycles()/get_free_instr() is the honest CPI.
//
//   node scripts/bench_transcendental.mjs
//
// The transcendental calls are ordinary library calls, so the numbers exclude
// the ILL trap entry/exit.
import fs from 'node:fs';
import {
  assemble, buildMemory, loadBrowserScripts, loadRtl, MEM_WORDS, ROOT,
} from '../tests/helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const LIB = fs.readFileSync(`${ROOT}/asm/softfloat.asm`, 'utf8');
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

function jsRunner(routine) {
  const res = assemble(program(routine), { defines: { FPU_KERNEL: 1 } });
  if (!res.success) throw new Error(res.errors.join('\n'));
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0;
  sim.segmentRegisters.DS = 0;
  sim.segmentRegisters.SS = 0;
  return (bits) => {
    sim.registers[15] = PROBE;
    sim.registers[13] = 0x7f00;
    sim.running = true;
    sim.memory[0x0200] = bits >>> 16;
    sim.memory[0x0201] = bits & 0xffff;
    sim.cycleCount = 0;
    let steps = 0;
    while (sim.running && steps < 200000) { sim.step(); steps++; }
    return { steps, cycles: sim.cycleCount };
  };
}

async function rtlRunner(routine) {
  const res = assemble(program(routine), { defines: { FPU_KERNEL: 1 } });
  if (!res.success) throw new Error(res.errors.join('\n'));
  const rtl = await loadRtl();
  rtl.init(MEM_WORDS);
  const memory = buildMemory(res);
  let highest = 0;
  for (const change of res.memoryChanges) highest = Math.max(highest, change.address);
  const words = new Uint16Array(highest + 1);
  words.set(memory.slice(0, highest + 1));
  rtl.load_program(0, words);
  rtl.set_segments(0, 0, 0, 0);
  return (bits) => {
    // step() run
    rtl.poke(0x0200, bits >>> 16);
    rtl.poke(0x0201, bits & 0xffff);
    let regs = new Uint16Array(16);
    regs[13] = 0x7f00;
    regs[15] = PROBE;
    rtl.set_registers(regs);
    const c0 = rtl.get_cycle_count();
    const i0 = rtl.get_instr_count();
    let steps = 0;
    while (steps < 200000 && rtl.step()) steps++;
    const stepCycles = rtl.get_cycle_count() - c0;
    const instr = rtl.get_instr_count() - i0;

    // free-run the same instruction count from the start
    rtl.poke(0x0200, bits >>> 16);
    rtl.poke(0x0201, bits & 0xffff);
    regs = new Uint16Array(16);
    regs[13] = 0x7f00;
    regs[15] = PROBE;
    rtl.set_registers(regs);
    rtl.run_cycles(instr);
    return {
      steps,
      instr,
      stepCycles,
      freeCycles: rtl.get_free_cycles(),
      freeInstr: rtl.get_free_instr(),
    };
  };
}

const CASES = [
  ['fexp32', [0, 1, -1, 3.5, -3.5, 10, -10, 80, -80]],
  ['flog32', [1, 2, 0.5, 10, 100, 1e-3, 1e9, 3.4e38, 1.0000001]],
];

for (const [routine, values] of CASES) {
  // loadRtl() is a singleton, so finish one routine before init()ing the next.
  const jsRun = jsRunner(routine);
  const rtlRun = await rtlRunner(routine);
  console.log(`\n${routine}`);
  console.log('     input      JS instr   RTL step cyc   RTL free cyc   CPI');
  let sumJs = 0, sumFree = 0, sumCpi = 0;
  for (const value of values) {
    const bits = bitsOf(value);
    const j = jsRun(bits);
    const r = rtlRun(bits);
    const cpi = r.freeCycles / Math.max(1, r.freeInstr);
    sumJs += j.steps;
    sumFree += r.freeCycles;
    sumCpi += cpi;
    console.log(
      String(value).padStart(10),
      String(j.steps).padStart(9),
      String(r.stepCycles).padStart(14),
      String(r.freeCycles).padStart(14),
      cpi.toFixed(2).padStart(6),
    );
  }
  console.log(
    String('mean').padStart(10),
    String(Math.round(sumJs / values.length)).padStart(9),
    ''.padStart(14),
    String(Math.round(sumFree / values.length)).padStart(14),
    (sumCpi / values.length).toFixed(2).padStart(6),
  );
}
