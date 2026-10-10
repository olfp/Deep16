// Smoke test for the RTL WASM package: boot the ROM, run a tiny program,
// compare against the JS core. Run with:  node scripts/rtl_smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis.window || {};
for (const f of ['js/deep16_assembler.js', 'js/deep16_simulator.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const Deep16Simulator = vm.runInThisContext('Deep16Simulator');
const Deep16Assembler = vm.runInThisContext('Deep16Assembler');

const { default: initDeep16Rtl } = await import(path.join(ROOT, 'rtl/pkg/deep16_rtl.js'));
const rtl = await initDeep16Rtl({ wasmBinary: fs.readFileSync(path.join(ROOT, 'rtl/pkg/deep16_rtl_gen.wasm')) });

const asm = (src) => {
  const res = new Deep16Assembler().assemble(src);
  if (!res.success) throw new Error(`program does not assemble:\n${src}\n${res.errors.join('; ')}`);
  return res;
};

function runJs(program, { cs = 0x0000, pc = 0x0000, maxSteps = 5000 } = {}) {
  const sim = new Deep16Simulator();
  const mem = new Array(1048576).fill(0xFFFF);
  for (const ch of program.memoryChanges) mem[ch.address] = ch.value & 0xFFFF;
  sim.loadProgram(mem);
  sim.segmentRegisters.CS = cs;
  sim.segmentRegisters.DS = 0x0000;
  sim.registers[15] = pc;
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < maxSteps) { sim.step(); steps++; }
  return {
    steps,
    registers: Array.from(sim.registers),
    psw: sim.psw,
    segments: [sim.segmentRegisters.CS, sim.segmentRegisters.DS, sim.segmentRegisters.SS, sim.segmentRegisters.ES],
    shadow: [sim.shadowRegisters.PC, sim.shadowRegisters.CS, sim.shadowRegisters.PSW],
  };
}

function runRtl(program, { cs = 0x0000, pc = 0x0000, maxSteps = 5000 } = {}) {
  rtl.init(1048576);
  for (const ch of program.memoryChanges) rtl.load_program(ch.address, new Uint16Array([ch.value & 0xFFFF]));
  rtl.set_segments(cs, 0x0000, 0x0000, 0x0000);
  rtl.set_psw(0x0000);
  const regs = new Uint16Array(16);
  regs[13] = 0x7FFF;
  regs[15] = pc;
  rtl.set_registers(regs);
  let steps = 0;
  let cont = true;
  while (cont && steps < maxSteps) { cont = rtl.step(); steps++; }
  return {
    steps,
    registers: Array.from(rtl.get_registers()),
    psw: rtl.get_psw(),
    segments: Array.from(rtl.get_segments()),
    shadow: Array.from(rtl.get_shadow_state()),
  };
}

const hex = (v) => '0x' + (v & 0xFFFF).toString(16).padStart(4, '0');
let failures = 0;

function compare(label, program, opts = {}) {
  const js = runJs(program, opts);
  const rtlRun = runRtl(program, opts);
  const same = JSON.stringify(js) === JSON.stringify(rtlRun);
  if (!same) {
    failures++;
    console.log(`DIVERGE  ${label}`);
    console.log(`   JS  steps=${js.steps} psw=${hex(js.psw)} segs=${js.segments.map(hex)} shadow=${js.shadow.map(hex)}`);
    console.log(`        regs=${js.registers.map(hex).join(' ')}`);
    console.log(`   RTL steps=${rtlRun.steps} psw=${hex(rtlRun.psw)} segs=${rtlRun.segments.map(hex)} shadow=${rtlRun.shadow.map(hex)}`);
    console.log(`        regs=${rtlRun.registers.map(hex).join(' ')}`);
  } else {
    console.log(`AGREE    ${label}  (${js.steps} steps, psw=${hex(js.psw)})`);
  }
}

// 1) boot ROM only (CS = 0xFFFF)
compare('boot ROM', { memoryChanges: [] }, { cs: 0xFFFF, pc: 0x0000 });

// 2) ALU group
compare('ALU basics', asm(`
        LDI 0x1234
        LSI R1, 7
        ADD R1, R1
        SUB R1, R0
        MUL R1, R2
        DIV R1, R2
        HALT
`));

// 3) shifts and rotates
compare('shifts', asm(`
        LSI R1, 1
        LSI R2, 3
        SL R1, 4
        SR R1, 1
        ROL R1, 2
        ROR R1, 2
        SRA R1, 1
        SLA R1, 1
        SLC R1, 2
        SRC R1, 2
        HALT
`));

// 4) MUL32 / DIV32 including the odd-destination refusal
compare('MUL32/DIV32', asm(`
        LSI R2, 12
        LSI R3, 5
        MUL32 R2, R3
        DIV32 R2, R3
        HALT
`));

// Odd destination must be refused at runtime (MUL32/DIV32 need an even Rd).
// The assembler rejects it, so the words are built by hand: LSI R1,12 /
// LSI R3,5 / MUL32 R1,R3 / DIV32 R1,R3 / HALT.
const MUL32_RD = (rd, rs) => (0b110 << 13) | (0b11101 << 8) | (rd << 4) | rs;
const DIV32_RD = (rd, rs) => (0b110 << 13) | (0b11111 << 8) | (rd << 4) | rs;
const LSI_ = (rd, imm) => 0xFC00 | (rd << 5) | (imm & 0x1F);
compare('MUL32/DIV32 odd destination', {
  success: true,
  errors: [],
  memoryChanges: [LSI_(1, 12), LSI_(3, 5), MUL32_RD(1, 3), DIV32_RD(1, 3), 0xFFFF]
    .map((value, address) => ({ address, value })),
});

// 5) load/store with a negative offset
compare('LD/ST negative offset', asm(`
        LSI SP, 15
        LDI 0x7BEF
        MOV R1, R0, 0
        ST R1, SP, -2
        LD R2, SP, -2
        HALT
`));

// 6) delay slots: Jcc taken, not taken, and a branch in the slot
compare('Jcc + delay slot', asm(`
        LSI R1, 3
        CMP R1, R1
        JZ SKIP
        LDI 0xEE
        SKIP:
        LSI R2, 7
        HALT
`));

// 7) LINK / jump table
// LINK (MOV Rd, PC, 2) and a return through LR in a delay slot
compare('LINK + return', asm(`
        MOV LR, PC, 2
        LSI R2, 11
        SKIP:
        LSI R3, 13
        MOV PC, LR
        LSI R4, 5
        HALT
`));

// 8) MVS/SMV/SOP
compare('segment + special ops', asm(`
        LDI 0x0100
        MOV R1, R0, 0
        MVS DS, R1
        ST R1, R2, 0
        MVS R2, DS
        LPSW R3
        INV R4
        NEG R5
        HALT
`));

// 9) SWI/RETI through the vector at 0000:0002
// SWI takes its handler entry from the vector word at 0000:0002
const swiProgram = asm(`
        LSI R1, 8
        MVS DS, R1
        SWI
        LSI R5, 9
        HALT
`);
{
  const withVector = {
    success: true,
    errors: [],
    memoryChanges: [...swiProgram.memoryChanges, { address: 2, value: 0x0080 }],
  };
  compare('SWI + RETI', withVector, { cs: 0x0000 });
}

console.log(failures === 0 ? '\nRTL SMOKE OK' : `\n${failures} divergence(s)`);
process.exit(failures === 0 ? 0 : 1);