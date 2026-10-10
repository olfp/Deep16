// Seeded random instruction-stream test: run random *programs* on the three
// cores and compare the complete state, step by step.
//
// Why this exists next to the decode sweep: the sweep (scripts/rtl_sweep.mjs)
// executes every one of the 65536 instruction words in isolation - one word,
// seeded state, one step, compare. It says nothing about what happens when
// instructions follow each other. Every real bug found in the pipeline work
// this session was a property of a *sequence*, invisible to the sweep:
//
//   - the shadow-bank bypass only appeared inside a handler,
//   - the keyboard FIFO pop only fired while a program polled for keys,
//   - the stale cache line needed an ST immediately followed by an LD.
//
// A random stream is the cheapest thing that covers that shape.
//
// Deterministic: every case is derived from a printed seed, so a failure
// reproduces exactly. `FUZZ_SEEDS=200 node --test tests/fuzz.test.js` runs
// more; `FUZZ_VERBOSE=1` names the diverging instruction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserScripts, loadWasm, loadRtl, MEM_WORDS } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');
const Deep16Simulator = globalThis.Deep16Simulator;

const SEEDS = Number(process.env.FUZZ_SEEDS || 60);
const STEPS = Number(process.env.FUZZ_STEPS || 300);
const VERBOSE = !!process.env.FUZZ_VERBOSE;

const CODE = 0x0100;          // the random program
const HANDLER = 0x0300;       // SWI lands here, so the shadow path really runs
const PROG_WORDS = 96;
// A branch out of the program must not end the run: without something to land
// on, a stray jump hits an untouched 0xFFFF and halts after a handful of
// instructions - exactly the shallow coverage this test exists to beat.
// SYS/NOP (0xFFF0) is architecturally inert, so escapes keep executing.
// Conditional-branch offsets are small, so a 1K window around the program
// covers nearly every escape without costing 8K loads on every core.
const NOP = 0xFFF0;
const WINDOW = [0x0000, 0x0400];

// mulberry32 - small, fast, and reproducible across platforms, which matters
// because a failure reported from Node has to reproduce from the seed alone.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A mixture, not uniform noise: half the words come from classes that actually
// appear in code (loads and stores, ALU, moves, immediates, branches), half are
// fully random so reserved and malformed encodings still get exercised in
// sequence rather than only one at a time.
function randomWord(rand) {
  const r4 = () => rand() & 15;
  switch (Math.floor(rand() * 9)) {
    case 0: return rand() & 0x7FFF;                                        // LDI Rd, imm
    case 1: return 0xC000 | ((rand() & 31) << 8) | (r4() << 4) | r4();      // ALU Rd, Rs
    case 2: return 0xF800 | (r4() << 6) | (r4() << 2) | (rand() & 3);      // MOV Rd, Rs, imm2
    case 3: return 0x8000 | (r4() << 9) | (r4() << 5) | (rand() & 31);      // LD
    case 4: return 0xA000 | (r4() << 9) | (r4() << 5) | (rand() & 31);      // ST
    case 5: return 0xFC00 | (r4() << 5) | (rand() & 31);                    // LSI Rd, imm5
    case 6: return 0xF000 | ((rand() & 3) << 10) | (r4() << 4) | r4();      // LDS / STS
    // SYS (instr[15:3] == 0x1FFE, so 0xFFF0 + op). Weighted towards NOP, but
    // SWI and RETI have to appear or no random program ever enters the shadow
    // bank - and that is precisely where the bypass bug lived. FSH is here
    // because it invalidates the cache.
    case 7: {
      const r = rand();
      const op = r < 0.6 ? 0 : (r < 0.8 ? 2 : (r < 0.9 ? 4 : 1));
      return 0xFFF0 | op;
    }
    default: return rand() & 0xFFFF;                                        // anything at all
  }
}

// Initial register file: values chosen so ALU results actually carry, zero and
// negative produce different flags, and the pointers are in range.
const SEED_REGS = [0x0000, 0x0001, 0xFFFF, 0x7FFF, 0x0004, 0x0005, 0x0100,
                   0x0200, 0x0010, 0x0000, 0x8000, 0x00FF, 0x0003, 0x0006,
                   0x0000, CODE];

// A short SWI handler: some ALU work, then RETI. Random programs execute SWI by
// accident often enough, and this is what puts them into the shadow bank - the
// context where the bypass bug lived.
const HANDLER_WORDS = [0x0001, 0xFC20, 0xC000, 0xFC40, 0xC200, 0xFFE8];

function buildProgram(rand) {
  const words = [];
  for (let i = 0; i < PROG_WORDS; i++) words.push(randomWord(rand));
  return words;
}

// --- state snapshots -------------------------------------------------------

function jsState(sim) {
  const inShadow = (sim.psw & 0x20) !== 0;
  const regs = Array.from(sim.registers);
  if (inShadow) regs[15] = sim.shadowRegisters.PC;
  return {
    regs,
    psw: sim.psw & 0xFFFF,
    segs: [sim.shadowRegisters.CS, sim.shadowRegisters.DS,
           sim.shadowRegisters.SS, sim.shadowRegisters.ES],
    shad: [sim.shadowRegisters.R0, sim.shadowRegisters.R1, sim.shadowRegisters.R2,
           sim.shadowRegisters.R3, sim.shadowRegisters.R13, sim.shadowRegisters.R14],
  };
}

function rtlState() {
  return {
    regs: Array.from(rtl.get_registers()),
    psw: rtl.get_psw(),
    segs: Array.from(rtl.get_segments()),
    shad: [0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20].map((i) => rtl.get_debug_state(i)),
  };
}

function wasmState() {
  return {
    regs: Array.from(wasm.get_registers()),
    psw: wasm.get_psw(),
    segs: Array.from(wasm.get_segments()),
    // the Rust core has no debug bus, so its shadow bank cannot be read
    shad: null,
  };
}

function diffFields(a, b) {
  const out = [];
  for (const k of ['regs', 'psw', 'segs', 'shad']) {
    if (b[k] === null || a[k] === null) continue;
    const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
    if (x !== y) out.push(`${k}: js=${x} ${arguments[2]}=${y}`);
  }
  return out;
}

const wasm = await loadWasm();
const rtl = await loadRtl();

test('random instruction streams agree across the three cores', async () => {
  let checked = 0, longestRun = 0;
  // Coverage counters. A fuzzer that silently never enters the shadow bank
  // would miss exactly the class of bug that motivated it, so assert it.
  let enteredShadow = 0, tookBranch = 0, executedSwi = 0;

  // One memory image for the whole run. Allocating a fresh megaword array per
  // seed and copying it into three cores dominated the runtime; only the NOP
  // window, the program and the handler ever change, so rewrite those.
  const mem = new Array(MEM_WORDS).fill(0xFFFF);
  for (let a = WINDOW[0]; a < WINDOW[1]; a++) mem[a] = NOP;
  mem[2] = HANDLER;

  for (let seed = 1; seed <= SEEDS; seed++) {
    const rand = rng(seed);
    const prog = buildProgram(rand);
    for (let i = 0; i < prog.length; i++) mem[CODE + i] = prog[i];
    for (let i = 0; i < HANDLER_WORDS.length; i++) mem[HANDLER + i] = HANDLER_WORDS[i];

    // --- JS core
    const sim = new Deep16Simulator();
    sim.loadProgram(mem);
    sim.segmentRegisters.CS = 0;
    sim.segmentRegisters.DS = 0;
    sim.segmentRegisters.SS = 0;
    sim.segmentRegisters.ES = 0;
    sim.registers = SEED_REGS.slice();
    sim.psw = 0x0000;
    for (const k of ['PSW', 'PC', 'CS', 'DS', 'SS', 'ES', 'R0', 'R1', 'R2',
                     'R3', 'R13', 'R14']) sim.shadowRegisters[k] = 0;
    sim.shadowRegisters.PC = CODE;
    sim.delaySlotActive = false; sim.branchTaken = false;
    sim.delayedPC = 0; sim.delayedCS = 0; sim.delayedToShadow = false;
    sim.lastOperationWasALU = false; sim.lastALUResult = 0;
    sim.lastALUOverflow = false; sim.shiftCarryOut = null;
    sim.recentMemoryAccess = null;
    sim.running = true;

    // --- Rust core
    wasm.init(MEM_WORDS);
    for (let a = WINDOW[0]; a < WINDOW[1]; a++) {
      wasm.load_program(a, new Uint16Array([mem[a]]));
    }
    for (let i = 0; i < prog.length; i++) {
      wasm.load_program(CODE + i, new Uint16Array([prog[i]]));
    }
    for (let i = 0; i < HANDLER_WORDS.length; i++) {
      wasm.load_program(HANDLER + i, new Uint16Array([HANDLER_WORDS[i]]));
    }
    // no poke() on the Rust core - it has no debugger port, so the SWI vector
    // goes in through load_program like everything else. Seeding state comes
    // after every load_program, because that call re-arms PC and CS.
    wasm.load_program(2, new Uint16Array([HANDLER]));
    wasm.set_segments(0, 0, 0, 0);
    wasm.set_psw(0);
    wasm.set_registers(Uint16Array.from(SEED_REGS));

    // --- RTL core
    rtl.init(MEM_WORDS);
    // load_program takes one address, so step the address - passing CODE for
    // every word would pile the whole program onto one location and leave the
    // rest as 0xFFFF, i.e. a halt word. The NOP window goes across too: filling
    // it only for the JS core gave the three cores different memory, which
    // looked exactly like a core divergence.
    for (let a = WINDOW[0]; a < WINDOW[1]; a++) {
      rtl.load_program(a, new Uint16Array([mem[a]]));
    }
    for (let i = 0; i < prog.length; i++) {
      rtl.load_program(CODE + i, new Uint16Array([prog[i]]));
    }
    for (let i = 0; i < HANDLER_WORDS.length; i++) {
      rtl.load_program(HANDLER + i, new Uint16Array([HANDLER_WORDS[i]]));
    }
    rtl.poke(2, HANDLER);
    rtl.set_segments(0, 0, 0, 0);
    rtl.set_psw(0);
    rtl.set_registers(Uint16Array.from(SEED_REGS));
    for (let i = 0; i < 12; i++) rtl.set_debug_state(0x15 + i, 0);
    for (let i = 0; i < 6; i++) rtl.set_debug_state(0x1B + i, 0);
    rtl.set_debug_state(0x0F, CODE);
    rtl.set_debug_state(0x16, CODE);
    rtl.set_debug_state(0x21, 0);
    rtl.set_debug_state(0x22, 0);
    rtl.set_debug_state(0x23, 0);
    rtl.set_debug_state(0x27, 0xFFFF);
    rtl.set_debug_state(0x28, 0x000F);

    let steps = 0;
    let divergence = null;
    let seedShadow = false, seedBranch = false, seedSwi = false;
    for (; steps < STEPS; steps++) {
      const pcBefore = (sim.psw & 0x20) ? sim.shadowRegisters.PC : sim.registers[15];
      const jsCont = sim.step();
      const rtlCont = !!rtl.step();
      const wasmCont = !!wasm.step();
      if (sim.psw & 0x20) seedShadow = true;
      if ((sim.psw & 0x20 ? sim.shadowRegisters.PC : sim.registers[15]) !== ((pcBefore + 1) & 0xFFFF)) {
        seedBranch = true;
      }

      const j = jsState(sim);
      const vsJs = diffFields(j, rtlState(), 'rtl');
      const wm = diffFields(j, wasmState(), 'wasm');
      if (vsJs.length || wm.length) {
        divergence = {
          step: steps,
          instr: (sim.psw & 0x20 ? sim.shadowRegisters.PC : sim.registers[15]),
          jsCont, rtlCont, wasmCont,
          lines: [...vsJs, ...wm],
        };
        break;
      }
      // a halted core stays halted on all three; nothing left to compare
      if (!jsCont) { steps++; break; }
      if (!rtlCont && !wasmCont) { steps++; break; }
    }
    checked++;
    if (!divergence) {
      longestRun = Math.max(longestRun, steps);
      // Memory too, not just the registers: a store that lands in the wrong
      // place, or does not land at all, is invisible to a register comparison.
      // The low 16K is where a random program realistically reaches; the whole
      // megaword is not worth transferring on every seed.
      const COUNT = 0x4000;
      const jsMem = sim.memory.slice(0, COUNT);
      const rtlMem = Array.from(rtl.get_memory_slice(0, COUNT));
      const wasmMem = Array.from(wasm.get_memory_slice(0, COUNT));
      for (let a = 0; a < COUNT; a++) {
        if (jsMem[a] !== rtlMem[a] || jsMem[a] !== wasmMem[a]) {
          divergence = {
            step: steps,
            instr: a,
            jsCont: true, rtlCont: true, wasmCont: true,
            lines: [`memory[0x${a.toString(16)}]: js=${jsMem[a]} rtl=${rtlMem[a]} ` +
                    `wasm=${wasmMem[a]}`],
          };
          break;
        }
      }
    }
    if (seedShadow) enteredShadow++;
    if (seedBranch) tookBranch++;
    if (seedSwi) executedSwi++;

    if (divergence) {
      const msg = [
        `seed ${seed}, step ${divergence.step}, PC=0x${divergence.instr.toString(16)}`,
        `  js=${divergence.jsCont} rtl=${divergence.rtlCont} wasm=${divergence.wasmCont}`,
        ...divergence.lines.map((l) => '  ' + l),
        `  reproduce: FUZZ_SEEDS=${seed} FUZZ_STEPS=${divergence.step + 2} node --test tests/fuzz.test.js`,
      ].join('\n');
      if (VERBOSE) {
        console.log(`      program: ${prog.map((w) => '0x' + w.toString(16).padStart(4, '0')).join(' ')}`);
      }
      assert.fail(msg);
    }
  }

  assert.ok(checked === SEEDS, 'not every seed ran');
  // A suite that silently halts on step 1 would pass forever while testing
  // nothing, so insist that the programs actually ran.
  assert.ok(longestRun > 20,
            `the random programs only ran ${longestRun} steps - the generator is degenerate`);
  // ...and insist on the contexts that matter. The shadow bank is where the
  // bypass bug lived, so a generator that never entered it would be blind to
  // precisely the failure this test was written for.
  assert.ok(enteredShadow > 0, 'no random program ever entered the shadow bank');
  assert.ok(tookBranch > 0, 'no random program ever took a non-sequential path');
  console.log(`      ${SEEDS} seeds, longest run ${longestRun} steps, ` +
              `${SEEDS * PROG_WORDS} random words executed`);
  console.log(`      coverage: ${enteredShadow} seeds entered the shadow bank, ` +
              `${tookBranch} took a non-sequential path`);
});