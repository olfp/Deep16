// Retire-trace co-simulation: step the JS core and the RTL core in lockstep
// and report the first retired instruction where the machine states differ.
//
// This is the debugging workhorse for a behavioural port - the decode sweep
// proves every instruction word in isolation, this proves that the *sequence*
// of steps keeps both cores in the same state (delay slots, banking, flags).
//
//   node scripts/rtl_trace.mjs <program.asm> [maxSteps] [--keys "1 2 + ."]
//
// Set DUMP=1 to print every retired step instead of only the divergence.
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
const rtl = await initDeep16Rtl({
  wasmBinary: fs.readFileSync(path.join(ROOT, 'rtl/pkg/deep16_rtl_gen.wasm')),
});

const args = process.argv.slice(2).filter((a) => a !== '--keys');
const maxSteps = Number(args[1] || 20000);
const keysArg = process.argv.includes('--keys')
  ? process.argv[process.argv.indexOf('--keys') + 1] : '';
const keys = [...keysArg].map((c) => (c === '\n' ? 10 : c.charCodeAt(0)));

const source = fs.readFileSync(path.resolve(args[0]), 'utf8');
const res = new Deep16Assembler().assemble(source);
if (!res.success) {
  console.error(res.errors.join('\n'));
  process.exit(1);
}

// ---- JS core -------------------------------------------------------------
const sim = new Deep16Simulator();
const mem = new Array(1048576).fill(0xFFFF);
for (const ch of res.memoryChanges) mem[ch.address] = ch.value & 0xFFFF;
sim.loadProgram(mem);
sim.segmentRegisters.CS = 0xFFFF;
sim.segmentRegisters.DS = 0x0000;
sim.segmentRegisters.SS = 0x0000;
sim.segmentRegisters.ES = 0x0000;
for (const code of keys) sim.enqueueKeyCode(code);
sim.running = true;

// ---- RTL core ------------------------------------------------------------
rtl.init(1048576);
for (const ch of res.memoryChanges) rtl.load_program(ch.address, new Uint16Array([ch.value & 0xFFFF]));
rtl.set_segments(0xFFFF, 0x0000, 0x0000, 0x0000);
for (const code of keys) rtl.kbd_push(code);

// remember what each core actually fetched, so a divergence can be traced to
// the fetch address instead of guessed from the PC alone
let jsExecuted = 0;
const jsExec = sim.executeInstruction.bind(sim);
sim.executeInstruction = (instruction, originalPC) => {
  jsExecuted = instruction;
  return jsExec(instruction, originalPC);
};

// ---- lockstep ------------------------------------------------------------
const hex = (v) => '0x' + (v & 0xFFFF).toString(16).padStart(4, '0');
const shadowKeys = ['PSW', 'PC', 'CS', 'DS', 'SS', 'ES'];

function jsState() {
  const inShadow = (sim.psw & 0x20) !== 0;
  const regs = Array.from(sim.registers);
  if (inShadow) regs[15] = sim.shadowRegisters.PC;
  const segs = inShadow ? sim.shadowRegisters : sim.segmentRegisters;
  return {
    regs: regs.map(hex).join(' '),
    psw: hex(sim.psw),
    segs: [segs.CS, segs.DS, segs.SS, segs.ES].map(hex).join(' '),
    shadow: [sim.shadowRegisters.PC, sim.shadowRegisters.CS, sim.shadowRegisters.PSW].map(hex).join(' '),
    shadowRegs: [sim.shadowRegisters.R0, sim.shadowRegisters.R1, sim.shadowRegisters.R2,
                 sim.shadowRegisters.R3, sim.shadowRegisters.R13, sim.shadowRegisters.R14].map(hex).join(' '),
    delay: [sim.delaySlotActive ? 1 : 0, hex(sim.delayedPC), hex(sim.delayedCS),
            sim.branchTaken ? 1 : 0, sim.delayedToShadow ? 1 : 0].join(' '),
  };
}

function rtlState() {
  const d = Array.from(rtl.get_delay_state());
  return {
    regs: Array.from(rtl.get_registers()).map(hex).join(' '),
    psw: hex(rtl.get_psw()),
    segs: Array.from(rtl.get_segments()).map(hex).join(' '),
    shadow: Array.from(rtl.get_shadow_state()).map(hex).join(' '),
    shadowRegs: [0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20].map((i) => hex(rtl.get_debug_state(i))).join(' '),
    delay: [d[0], hex(d[1]), hex(d[2]), d[3], d[4]].join(' '),
  };
}

// Memory is compared in a few windows: the breadcrumb/vector words the cores
// keep at 0..3, the stack area and the screen. A behavioural port can write
// the wrong word without any register noticing, and a later SWI or screen
// output then diverges for a reason that is far away from the cause.
const MEM_WINDOWS = [[0, 8], [0x7FF0, 0x10], [0x0100, 0x10], [0xF1000, 0x10]];
const memDiff = () => {
  for (const [addr, count] of MEM_WINDOWS) {
    const jsWords = Array.from(sim.memory.slice(addr, addr + count));
    const rtlWords = Array.from(rtl.get_memory_slice(addr, count));
    for (let i = 0; i < count; i++) {
      if (jsWords[i] !== rtlWords[i]) {
        return `mem[${hex(addr + i)}] js=${hex(jsWords[i])} rtl=${hex(rtlWords[i])}`;
      }
    }
  }
  return null;
};

const dump = process.env.DUMP === '1';
let step = 0;
for (; step < maxSteps; step++) {
  const jsRet = sim.step();
  const rtlRet = rtl.step();
  const js = jsState();
  const hw = rtlState();
  const ret = (jsRet ? 1 : 0) === (rtlRet ? 1 : 0);
  const mem = memDiff();
  const same = JSON.stringify(js) === JSON.stringify(hw) && !mem;

  if (dump || (!same && !ret)) {
    const inShadowJs = (sim.psw & 0x20) !== 0;
    const activeCS = inShadowJs ? sim.shadowRegisters.CS : sim.segmentRegisters.CS;
    const activePC = inShadowJs ? sim.shadowRegisters.PC : sim.registers[15];
    const word = sim.memory[sim.phys(activeCS, activePC)];
    const rtlFetch = rtl.get_debug_state(0x3F) | (rtl.get_debug_state(0x4F) << 16);
    console.log(`   fetch js CS:${hex(activeCS)}:${hex(activePC)} word ${hex(word)}` +
      ` | rtl CS:${hex(rtl.get_debug_state(activePC === undefined ? 0x17 : 0x17))}` +
      `:${hex(rtl.get_debug_state(0x16))} pa=${hex(rtlFetch)} word ${hex(rtl.get_debug_state(0x2F))}`);
    console.log(`step ${step + 1} ret js=${jsRet} rtl=${rtlRet}` +
      ` sPC js=${hex(sim.shadowRegisters.PC)} rtl=${hex(rtl.get_debug_state(0x16))}` +
      ` PC js=${hex(sim.registers[15])} rtl=${hex(rtl.get_debug_state(0x0F))}` +
      ` psw js=${hex(sim.psw)} rtl=${hex(rtl.get_psw())}` +
      ` vec js=${hex(sim.memory[2])} rtl=${hex(rtl.peek(2))}`);
  }
  if (!same || !ret) {
    if (mem) console.log('   ' + mem);
    // raw view, so the two cores can be compared field by field
    console.log('   raw js : PC(normal)=%s sPC=%s psw=%s R15=%s',
      hex(sim.registers[15]), hex(sim.shadowRegisters.PC), hex(sim.psw),
      hex(sim.registers[15]));
    console.log('   raw rtl: PC(normal)=%s sPC=%s psw=%s regs[15]=%s instr=%s',
      hex(rtl.get_debug_state(0x0F)), hex(rtl.get_debug_state(0x16)),
      hex(rtl.get_psw()), hex(rtl.get_registers()[15]),
      hex(rtl.get_debug_state(0x2F)));
    for (const key of Object.keys(js)) {
      if (js[key] !== hw[key]) {
        console.log(`   ${key}\n     js  ${js[key]}\n     rtl ${hw[key]}`);
      }
    }
    void shadowKeys;
    console.log(`\ndiverged after ${step + 1} retired instructions`);
    process.exit(1);
  }
  if (!jsRet) {
    console.log(`\nboth cores halted after ${step + 1} retired instructions - no divergence`);
    process.exit(0);
  }
}
console.log(`\nno divergence in ${maxSteps} retired instructions (still running)`);