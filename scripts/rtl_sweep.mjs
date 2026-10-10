// Decode sweep: execute every one of the 65536 possible instruction words on
// the JS core and on the RTL core, once from a normal fetch and once from a
// delay slot, and compare the complete machine state.
//
// This is where the reserved words, the SYS defaults and the ALU quirks are
// pinned down - a behavioural port cannot be trusted on the words no program
// ever executes. Run with:  node scripts/rtl_sweep.mjs [seedCount]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis.window || {};
for (const f of ['js/deep16_simulator.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const Deep16Simulator = vm.runInThisContext('Deep16Simulator');

const { default: initDeep16Rtl } = await import(path.join(ROOT, 'rtl/pkg/deep16_rtl.js'));
const rtl = await initDeep16Rtl({ wasmBinary: fs.readFileSync(path.join(ROOT, 'rtl/pkg/deep16_rtl_gen.wasm')) });

rtl.init(1048576);   // one model, re-seeded per word

const CODE_ADDR = 0x0100;
const SENTINEL = 0xFFFFF;   // matches 0x0FFFF0 written into the recent record

// Debug bus indices (rtl/sim/harness.h)
const DBG_REGS = 0x00, DBG_PSW = 0x10, DBG_FLAGS = 0x21;
const DBG_RECENT = [0x27, 0x28];   // address low / high

// Registers/PSW seeds: a plain context, one with the stack/extra segment
// selects active, and one inside the shadow bank.
const SEEDS = [
  { regs: [0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007,
           0x0010, 0x0020, 0x0040, 0x0080, 0x0100, 0x7FFF, 0xBEEF, CODE_ADDR],
    psw: 0x0000 },
  { regs: [0x0100, 0x1234, 0x8000, 0xFFFF, 0x0004, 0x0005, 0x0006, 0x0007,
           0x0010, 0x0020, 0x0040, 0x0080, 0x0100, 0x0008, 0x00FF, CODE_ADDR],
    psw: 0x0000 },
  { regs: [0x0007, 0x0011, 0x0022, 0x0033, 0x0004, 0x0005, 0x0006, 0x0007,
           0x0010, 0x0020, 0x0040, 0x0080, 0x0100, 0x0008, 0x00FF, CODE_ADDR],
    psw: 0x1440 },                       // stack select = R5, extra = R6
  { regs: [0x0009, 0x0011, 0x0022, 0x0033, 0x0004, 0x0005, 0x0006, 0x0007,
           0x0010, 0x0020, 0x0040, 0x0080, 0x0100, 0x0008, 0x00FF, CODE_ADDR],
    psw: 0x0821 },                       // S=1 (shadow), I=1, Z=1
];

function hex(v) { return '0x' + (v & 0xFFFF).toString(16).padStart(4, '0'); }

// ---- JS side: one simulator, re-seeded per word --------------------------
const sim = new Deep16Simulator();

// Track every write the behavioural core performs, so each sweep iteration can
// restore the memory image exactly - a store may land anywhere, and a single
// missed restore would silently poison the following words.
const jsWrites = new Set();
sim.memory = new Proxy(sim.memory, {
  set(target, key, value) { jsWrites.add(key); target[key] = value; return true; },
});
// remember the word the core actually executed (the ports of the behavioural
// core do not expose it, and a drifting memory image is otherwise invisible)
let jsExecuted = 0;
const jsExecuteInstruction = sim.executeInstruction.bind(sim);
sim.executeInstruction = (instruction, originalPC) => {
  jsExecuted = instruction;
  return jsExecuteInstruction(instruction, originalPC);
};
const jsShadowKeys = ['PSW', 'PC', 'CS', 'DS', 'SS', 'ES', 'R0', 'R1', 'R2', 'R3', 'R13', 'R14'];

function jsSeed(seed, { delaySlot }) {
  const inShadow = (seed.psw & 0x20) !== 0;
  sim.registers.fill(0);
  for (let i = 0; i < 16; i++) sim.registers[i] = seed.regs[i];
  sim.psw = seed.psw;
  sim.segmentRegisters.CS = 0x0000;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  for (const k of jsShadowKeys) sim.shadowRegisters[k] = 0;
  // In a shadow seed the active PC is the shadow one - it has to point at the
  // word under test as well, otherwise the fetch runs off into empty memory.
  if (inShadow) { sim.shadowRegisters.PC = CODE_ADDR; sim.shadowRegisters.CS = 0x0000; }
  sim.delaySlotActive = false;
  sim.branchTaken = false;
  sim.delayedPC = 0;
  sim.delayedCS = 0;
  sim.delayedToShadow = false;
  sim.lastOperationWasALU = false;
  sim.lastALUResult = 0;
  sim.lastALUOverflow = false;
  sim.shiftCarryOut = null;
  sim.recentMemoryAccess = null;
  sim.running = true;
  if (delaySlot) {
    sim.delaySlotActive = true;
    sim.branchTaken = true;
    sim.delayedPC = CODE_ADDR;
    sim.delayedCS = 0x0000;
    sim.delayedToShadow = inShadow;
  }
  sim.memory[CODE_ADDR] = 0xFFFF;   // placeholder, overwritten per word
  sim.memory[2] = CODE_ADDR;        // SWI vector
}

function jsSnapshot() {
  const inShadow = (sim.psw & 0x20) !== 0;
  const segs = inShadow ? sim.shadowRegisters : sim.segmentRegisters;
  const acc = sim.recentMemoryAccess;
  const regs = Array.from(sim.registers);
  return {
    regs: inShadow ? regs.slice(0, 15).concat([sim.shadowRegisters.PC]) : regs,
    psw: sim.psw,
    segs: [segs.CS, segs.DS, segs.SS, segs.ES],
    shadow: [sim.shadowRegisters.PC, sim.shadowRegisters.CS, sim.shadowRegisters.PSW],
    shadowRegs: [sim.shadowRegisters.R0, sim.shadowRegisters.R1, sim.shadowRegisters.R2,
                 sim.shadowRegisters.R3, sim.shadowRegisters.R13, sim.shadowRegisters.R14],
    delay: [sim.delaySlotActive ? 1 : 0, sim.delayedPC, sim.delayedCS,
            sim.branchTaken ? 1 : 0, sim.delayedToShadow ? 1 : 0],
    recent: acc ? [acc.address, acc.type === 'ST' ? 1 : 0] : [SENTINEL, 0],
    at: sim.running ? jsExecuted : null,   // a halting fetch executes nothing
    fetch: null,
  };
}

function jsStep(seed, word, { delaySlot }) {
  jsSeed(seed, { delaySlot });
  sim.memory[CODE_ADDR] = word;
  const ret = sim.step();
  const after = jsSnapshot();
  const accAfter = sim.recentMemoryAccess;
  after.memAt = (accAfter && accAfter.type === 'ST' && accAfter.address < sim.memory.length)
    ? sim.memory[accAfter.address] : null;
  // restore whatever the word wrote so the next word starts clean
  const acc = sim.recentMemoryAccess;
  for (const addr of jsWrites) {
    if (addr !== CODE_ADDR && addr !== 2) sim.memory[addr] = 0xFFFF;
  }
  jsWrites.clear();
  sim.memory[CODE_ADDR] = word;
  sim.memory[2] = CODE_ADDR;
  return { ret, ...after };
}

// ---- RTL side ------------------------------------------------------------
function rtlSeed(seed, { delaySlot }) {
  const inShadow = (seed.psw & 0x20) !== 0;
  rtl.set_psw(seed.psw);
  rtl.set_segments(0x0000, 0x0000, 0x0000, 0x0000);
  rtl.set_registers(Uint16Array.from(seed.regs));
  for (let i = 0; i < 12; i++) rtl.set_debug_state(0x15 + i, 0);  // shadow state
  for (let i = 0; i < 6; i++) rtl.set_debug_state(0x1B + i, 0);   // shadow registers
  // In a shadow seed the active PC is the shadow one, so steer it at the word
  // under test as well (0x16 = shadow PC, only the active one steers the fetch).
  if (inShadow) rtl.set_debug_state(0x16, CODE_ADDR);
  // set_registers() routes index 15 to the *active* PC, which in a shadow seed
  // is the shadow one - so the normal-bank PC never gets written and stays 0.
  // The JS seed sets both, and PC-relative addressing reads the normal-bank PC
  // in shadow context, so set it explicitly. Without this every PC-relative
  // load in seed 3 loads from address 0.
  rtl.set_debug_state(0x0F, CODE_ADDR);
  rtl.set_debug_state(DBG_FLAGS, 0);                               // clear delay state
  rtl.set_debug_state(0x22, 0);
  rtl.set_debug_state(0x23, 0);
  // sentinel: an address no phys() can produce, so "no memory access" is
  // distinguishable from "accessed address 0"
  rtl.set_debug_state(0x27, 0xFFFF);
  rtl.set_debug_state(0x28, 0x000F);
  rtl.set_debug_state(0x29, 0);
  rtl.set_debug_state(0x2A, 0);
  rtl.set_debug_state(0x2B, 0);
  rtl.set_debug_state(0x2C, 0x0001);
  if (delaySlot) {
    // 0x21: bit0 delay_active, bit1 branch_taken, bit2 delayed_to_shadow
    rtl.set_debug_state(DBG_FLAGS, 0x02 | (inShadow ? 0x04 : 0x00));
    rtl.set_debug_state(0x22, CODE_ADDR);                           // delayed_pc
    rtl.set_debug_state(0x23, 0x0000);                             // delayed_cs
    rtl.set_debug_state(DBG_FLAGS, 0x03 | (inShadow ? 0x04 : 0x00));
  }
  rtl.poke(CODE_ADDR, 0xFFFF);
  rtl.poke(2, CODE_ADDR);
}

function rtlStep(seed, word, { delaySlot }) {
  rtlSeed(seed, { delaySlot });
  rtl.poke(CODE_ADDR, word);
  const ret = rtl.step();
  const regs = Array.from(rtl.get_registers());
  const recent = Array.from(rtl.get_recent_access());
  const addr = recent[0];
  const isStore = recent[5] === 1;
  const snap = {
    regs,
    psw: rtl.get_psw(),
    segs: Array.from(rtl.get_segments()),
    shadow: Array.from(rtl.get_shadow_state()),
    shadowRegs: [0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20].map((i) => rtl.get_debug_state(i)),
    delay: Array.from(rtl.get_delay_state()),
    recent: [addr, isStore ? 1 : 0],
    // `at` is only tracked on the behavioural side: the RTL core does not
    // expose "the instruction that retired", and the debug bus would have to be
    // sampled during the step. The executed word is pinned down by the state
    // comparison itself - every register, flag and segment below comes out of
    // executing this one word.
    at: null,
    fetch: null,
    memAt: isStore && addr < 0x100000 ? rtl.peek(addr) : null,
  };
  if (isStore && addr < 0x100000) rtl.poke(addr, 0xFFFF);
  rtl.poke(CODE_ADDR, word);
  return { ret, ...snap };
}

function diff(a, b) {
  const out = [];
  for (const key of ['ret', 'regs', 'psw', 'segs', 'shadow', 'shadowRegs', 'delay', 'recent', 'memAt']) {
    const x = JSON.stringify(a[key]);
    const y = JSON.stringify(b[key]);
    if (x !== y) out.push(`${key}: js=${x} rtl=${y}`);
  }
  return out;
}

const seeds = Number(process.argv[2] || SEEDS.length);
let checked = 0;
let failures = 0;
const shown = new Map();

for (let si = 0; si < seeds; si++) {
  const seed = SEEDS[si];
  for (const delaySlot of [false, true]) {
    for (let word = 0; word <= 0xFFFF; word++) {
      const js = jsStep(seed, word, { delaySlot });
      const hw = rtlStep(seed, word, { delaySlot });
      checked++;
      // The behavioural core has to have executed exactly the word under test -
      // otherwise the memory image drifted and every comparison below is void.
      if (js.ret && js.at !== word) {
        failures++;
        const key = `jsdrift${si}${delaySlot ? 'd' : 'n'}`;
        if (!shown.has(key)) {
          shown.set(key, true);
          console.log(`word 0x${hex(word)} seed ${si}${delaySlot ? ' (delay slot)' : ''}:`);
          console.log(`   the behavioural core executed 0x${hex(js.at)} instead`);
        }
        continue;
      }
      const d = diff(js, hw);
      if (d.length) {
        failures++;
        const key = `${si}${delaySlot ? 'd' : 'n'}:${d[0].split(':')[0]}`;
        if (!shown.has(key)) {
          shown.set(key, true);
          console.log(`word 0x${hex(word)} seed ${si}${delaySlot ? ' (delay slot)' : ''}`);
          for (const line of d) console.log('   ' + line);
        }
      }
    }
    process.stdout.write(`seed ${si}${delaySlot ? ' delay-slot' : ' normal'}: ${checked} words, ${failures} mismatches\n`);
  }
}

console.log(`\n${checked} word executions compared, ${failures} mismatches`);
process.exit(failures === 0 ? 0 : 1);