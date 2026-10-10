// Third core: the Deep16 RTL model (Verilator + Emscripten) next to the JS and
// the Rust/WASM behavioural cores.
//
// The RTL is a behavioural port of js/deep16_simulator.js - that core is the
// golden reference, so every test here compares three-way and fails on the
// first core that disagrees. Two known divergences of the *WASM* core are
// pinned explicitly at the bottom, so they cannot change unnoticed: the RTL
// follows the JS core (sign-extended LD/ST offset, halt only on 0xFFFF).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assemble, loadBrowserScripts, loadRtl, loadWasm, runJs, runRtl, runWasm,
  readScreen, enc, rawProgram, ROOT, SCREEN_ADDR, MEM_WORDS,
} from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

const hex = (v) => '0x' + (v & 0xFFFF).toString(16).padStart(4, '0');

// Decode a 25x80 screen window as text. Row-based, like forth.test.js: cells
// carry attribute bits, so stopping at the first 0xFF would cut the screen
// short. readScreen() cannot be used here because it indexes a full memory
// image and adds SCREEN_ADDR itself.
function screenRows(window, rows_ = 25, cols = 80) {
  const out = [];
  for (let r = 0; r < rows_; r++) {
    let s = '';
    for (let c = 0; c < cols; c++) s += String.fromCharCode((window[r * cols + c] || 0) & 0xFF);
    out.push(s.replace(/\s+$/, ''));
  }
  return out.join('\n');
}

// Run the same program on all three cores and compare the observable state:
// registers, PSW, segments, the screen window and (where meaningful) the step
// count. WASM is skipped where the documented divergences below apply.
async function parity(res, {
  name,
  cs = 0xFFFF, ds = 0x0000, ss = 0x0000, es = 0x0000,
  maxSteps = 200000, keys = [], wasm = true, screenAt = SCREEN_ADDR, screenCount = 25 * 80,
} = {}) {
  assert.ok(res.success, `program does not assemble: ${res.errors.join('; ')}`);

  const js = runJs(res, { cs, ds, ss, es, maxSteps });
  const rtl = await runRtl(res, { cs, ds, ss, es, maxSteps, keys });
  const wa = wasm ? await runWasm(res, { cs, ds, ss, es, maxSteps, keys }) : null;
  const screenFrom = (image) => (image.slice ? image.slice(screenAt, screenAt + screenCount)
                                            : Array.from(image).slice(screenAt, screenAt + screenCount));

  const state = (r, memory) => ({
    registers: r.registers.slice(0, 15).map(hex).join(' '),
    pc: hex(r.registers[15]),
    psw: hex(r.psw ?? js.sim.psw),
    segments: (r.segments ?? [js.sim.segmentRegisters.CS, js.sim.segmentRegisters.DS,
      js.sim.segmentRegisters.SS, js.sim.segmentRegisters.ES]).map(hex).join(' '),
    screen: screenRows(memory, 25, 80),
  });

  const jsState = state({ registers: js.sim.registers, psw: js.sim.psw }, screenFrom(js.memory));
  const rtlState = state(rtl, rtl.memoryAt(screenAt, screenCount));

  assert.deepEqual(rtlState, jsState, `${name}: RTL core diverges from the JS core`);
  if (wa) {
    const waState = state(wa, wa.memoryAt(screenAt, screenCount));
    assert.deepEqual(rtlState, waState, `${name}: RTL core diverges from the WASM core`);
  }
  return { js, rtl, wasm: wa };
}

test('fresh machine state matches on all three cores', async () => {
  await parity(rawProgram([]), { name: 'fresh state', cs: 0xFFFF });
});

test('boot ROM reaches the program entry on all three cores', async () => {
  const res = assemble(`
        .org 0x0100
        LDI 0x1234
        HALT
  `);
  const { rtl } = await parity(res, { name: 'boot ROM', cs: 0xFFFF });
  assert.equal(rtl.registers[0], 0x1234);
  // the ROM's breadcrumb: the entry point is planted at physical 0..2
  assert.deepEqual(rtl.memoryAt(0, 3), [0x0100, 0x0100, 0x0100]);
});

test('reset returns the RTL core to the same state as the other cores', async () => {
  const r = await loadRtl();
  const w = await loadWasm();
  for (const core of [r, w]) {
    core.init(MEM_WORDS);
    core.set_psw(0x1234);
    core.set_segments(0x1111, 0x2222, 0x3333, 0x4444);
    core.set_registers(Uint16Array.from({ length: 16 }, (_, i) => 0x1000 + i));
    core.reset();
  }
  const rtlRegs = Array.from(r.get_registers());
  const wasmRegs = Array.from(w.get_registers());
  assert.deepEqual(rtlRegs, wasmRegs);
  assert.equal(r.get_psw(), 0x0000);
  assert.deepEqual(Array.from(r.get_segments()), [0xFFFF, 0x0000, 0x0000, 0x0000]);
  assert.deepEqual(Array.from(r.get_shadow_state()), [0x0000, 0x0000, 0x0000]);
  assert.equal(rtlRegs[13], 0x7FFF, 'SP parks at the top of the flat segment');
  assert.equal(rtlRegs[15], 0x0000);
});

test('ALU group: logic, shifts, rotates, multiply and divide', async () => {
  const res = assemble(`
        LDI 0x1234
        MOV R1, R0, 0
        LSI R2, 7
        AND R1, R2
        OR R1, R2
        XOR R1, R2
        OR R3, 4
        CLRB R3, 1
        XOR R3, 2
        ADD R1, R2
        SUB R1, R0
        CMP R1, R2
        TBC R3, 2
        TBS R3, 1
        SL R1, 3
        SR R1, 2
        ROL R1, 5
        ROR R1, 5
        SRA R1, 1
        SLA R1, 1
        MUL R1, R2
        DIV R1, R2
        HALT
  `);
  await parity(res, { name: 'ALU group', cs: 0x0000 });
});

test('shift count 0 keeps the carry flag', async () => {
  // SLAC/SRC/RLC/RRC with count 0 must leave C untouched (spec Table 7)
  const res = assemble(`
        LDI 0x0001
        MOV R1, R0, 0
        ADD R1, R1
        ADD R1, R1
        SLAC R1, 0
        HALT
  `);
  await parity(res, { name: 'shift count 0', cs: 0x0000 });
});

test('MUL32/DIV32 pair semantics and the odd-destination refusal', async () => {
  const even = assemble(`
        LSI R2, 12
        LSI R3, 5
        MUL32 R2, R3
        DIV32 R2, R3
        HALT
  `);
  await parity(even, { name: 'MUL32/DIV32', cs: 0x0000 });

  // an odd destination writes nothing at all and reports an all-ones result
  const odd = rawProgram([
    enc.LSI(1, 12), enc.LSI(3, 5),
    enc.MUL32(1, 3), enc.DIV32(1, 3),
    enc.HLT,
  ]);
  const { rtl } = await parity(odd, { name: 'odd destination', cs: 0x0000 });
  assert.equal(rtl.registers[1], 0x000C, 'the refused MUL32 must not write Rd');
  assert.equal(rtl.registers[2], 0x0000);
});

test('load/store with a negative offset', async () => {
  const res = assemble(`
        LSI SP, 15
        LDI 0x7BEF
        MOV R1, R0, 0
        ST R1, SP, -2
        LD R2, SP, -2
        HALT
  `);
  await parity(res, { name: 'negative offset', cs: 0x0000 });
});

test('branch, delay slot and the conditional jump table', async () => {
  const res = assemble(`
        LSI R1, 3
        CMP R1, R1
        JZ SKIP
        LDI 0xEE
        SKIP:
        LSI R2, 7
        JN TAKEN
        LSI R3, 9
        TAKEN:
        LSI R4, 11
        HALT
  `);
  await parity(res, { name: 'branches', cs: 0x0000 });
});

test('LINK/MOV imm2 table and a return through LR', async () => {
  const res = assemble(`
        MOV LR, PC, 2
        LSI R2, 11
        SKIP:
        LSI R3, 13
        MOV PC, LR
        HALT
  `);
  await parity(res, { name: 'LINK', cs: 0x0000 });
});

test('a jump inside a delay slot reproduces the cores quirk', async () => {
  // the inner branch wins and the outer transfer is dropped - both cores do
  // this, so the RTL has to reproduce it rather than "fix" it
  const res = assemble(`
        LSI R1, 3
        CMP R1, R1
        JZ OUTER
        JNZ OUTER
        LSI R2, 1
        OUTER:
        LSI R3, 2
        HALT
  `);
  await parity(res, { name: 'nested branch', cs: 0x0000 });
});

test('MVS/SMV/SOP and the segment registers', async () => {
  const res = assemble(`
        LDI 0x0100
        MOV R1, R0, 0
        MVS DS, R1
        ST R1, R1, 0
        MVS R2, DS
        SMV R3, ADS
        LPSW R4
        INV R5
        NEG R6
        HALT
  `);
  await parity(res, { name: 'segments', cs: 0x0000 });
});

test('SWI enters the handler and RETI restores the context', async () => {
  const base = assemble(`
        LSI R1, 8
        MVS DS, R1
        SWI
        LSI R5, 9
        HALT
        HANDLER:
        LSI R2, 4
        RETI
        HALT
  `);
  assert.ok(base.success, base.errors.join('; '));
  // the handler entry is the vector word at 0000:0002
  const res = {
    success: true,
    errors: [],
    memoryChanges: [...base.memoryChanges, { address: 2, value: 0x0090 }],
  };
  await parity(res, { name: 'SWI/RETI', cs: 0x0000 });
});

test('shadow banking: SPSW enters the shadow set, SMV reads across', async () => {
  const res = assemble(`
        LDI 0x1111
        LSI R1, 0
        SPSW R1
        LSI R2, 3
        SMV R3, AR0
        RETI
        HALT
  `);
  await parity(res, { name: 'shadow', cs: 0x0000 });
});

test('the polled keyboard port behaves like the other cores', async () => {
  // LDS R1, [KBD_STATUS] / LDS R2, [KBD_DATA] through CS=0x000F (0xF0060/2)
  const res = assemble(`
        LDI 0x0060
        MOV R1, R0, 0
        MVS CS, R1
        LDS R5, CS, R1
        LDS R6, CS, R1
        HALT
  `);
  await parity(res, { name: 'keyboard', cs: 0x0000, keys: [0x0041, 0x000A] });
});

test('decode sweep: every instruction word matches the JS core', async () => {
  // 65536 words, one normal fetch and one delay-slot execution each. This is
  // what pins down the reserved words and the SYS defaults - no program ever
  // executes those, but a behavioural port can still get them wrong.
  // scripts/rtl_sweep.mjs runs the same sweep with four register/PSW seeds.
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  const r = await loadRtl();
  r.init(MEM_WORDS);

  const jsWrites = new Set();
  sim.memory = new Proxy(sim.memory, {
    set(target, key, value) { jsWrites.add(key); target[key] = value; return true; },
  });

  const SEED_REGS = [0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007,
                     0x0010, 0x0020, 0x0040, 0x0080, 0x0100, 0x7FFF, 0xBEEF, 0x0100];
  const CODE = 0x0100;

  const jsSeed = (delaySlot) => {
    sim.registers.fill(0);
    for (let i = 0; i < 16; i++) sim.registers[i] = SEED_REGS[i];
    sim.psw = 0x0000;
    sim.segmentRegisters = { CS: 0x0000, DS: 0x0000, SS: 0x0000, ES: 0x0000 };
    for (const k of Object.keys(sim.shadowRegisters)) sim.shadowRegisters[k] = 0;
    sim.delaySlotActive = delaySlot;
    sim.branchTaken = delaySlot;
    sim.delayedPC = delaySlot ? CODE : 0;
    sim.delayedCS = 0x0000;
    sim.delayedToShadow = false;
    sim.lastOperationWasALU = false;
    sim.lastALUResult = 0;
    sim.lastALUOverflow = false;
    sim.shiftCarryOut = null;
    sim.recentMemoryAccess = null;
    sim.running = true;
    sim.memory[CODE] = 0xFFFF;
    sim.memory[2] = CODE;
  };

  const rtlSeed = (delaySlot) => {
    r.set_psw(0x0000);
    r.set_segments(0x0000, 0x0000, 0x0000, 0x0000);
    r.set_registers(Uint16Array.from(SEED_REGS));
    for (let i = 0; i < 12; i++) r.set_debug_state(0x15 + i, 0);
    for (let i = 0; i < 6; i++) r.set_debug_state(0x1B + i, 0);
    r.set_debug_state(0x21, delaySlot ? 0x03 : 0x00);
    r.set_debug_state(0x22, delaySlot ? CODE : 0);
    r.set_debug_state(0x23, 0x0000);
    // sentinel address, so "no memory access" is distinguishable
    r.set_debug_state(0x27, 0xFFFF);
    r.set_debug_state(0x28, 0x000F);
    r.set_debug_state(0x29, 0);
    r.set_debug_state(0x2A, 0);
    r.set_debug_state(0x2B, 0);
    r.set_debug_state(0x2C, 0x0001);
    r.poke(CODE, 0xFFFF);
    r.poke(2, CODE);
  };

  const snapshotJs = () => {
    const acc = sim.recentMemoryAccess;
    // get_registers() (and therefore the RTL core) reports the shadow PC in
    // element 15 while PSW.S=1; the JS core keeps it in the shadow record.
    const regs = Array.from(sim.registers);
    if ((sim.psw & 0x20) !== 0) regs[15] = sim.shadowRegisters.PC;
    return {
      ret: sim.running ? 1 : 0,
      regs: regs.join(','),
      psw: sim.psw,
      segs: [sim.segmentRegisters.CS, sim.segmentRegisters.DS,
             sim.segmentRegisters.SS, sim.segmentRegisters.ES].join(','),
      shadow: [sim.shadowRegisters.PC, sim.shadowRegisters.CS, sim.shadowRegisters.PSW].join(','),
      shadowRegs: [sim.shadowRegisters.R0, sim.shadowRegisters.R1, sim.shadowRegisters.R2,
                    sim.shadowRegisters.R3, sim.shadowRegisters.R13, sim.shadowRegisters.R14].join(','),
      delay: [sim.delaySlotActive ? 1 : 0, sim.delayedPC, sim.delayedCS,
              sim.branchTaken ? 1 : 0, sim.delayedToShadow ? 1 : 0].join(','),
      recent: acc ? `${acc.address}:${acc.type}` : 'none',
    };
  };

  const RECENT_SENTINEL = 0xFFFFF;   // "no memory access" (written by rtlSeed)

  const snapshotRtl = (ret) => {
    const recent = Array.from(r.get_recent_access());
    return {
      ret: ret ? 1 : 0,
      regs: Array.from(r.get_registers()).join(','),
      psw: r.get_psw(),
      segs: Array.from(r.get_segments()).join(','),
      shadow: Array.from(r.get_shadow_state()).join(','),
      shadowRegs: [0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20].map((i) => r.get_debug_state(i)).join(','),
      delay: Array.from(r.get_delay_state()).join(','),
      recent: recent[0] === RECENT_SENTINEL ? 'none' : `${recent[0]}:${recent[5] ? 'ST' : 'LD'}`,
    };
  };

  let mismatches = 0;
  const report = [];
  for (const delaySlot of [false, true]) {
    for (let word = 0; word <= 0xFFFF; word++) {
      jsSeed(delaySlot);
      sim.memory[CODE] = word;
      const jsRet = sim.step();
      const js = snapshotJs();

      rtlSeed(delaySlot);
      r.poke(CODE, word);
      const rtlRet = r.step();
      const hw = snapshotRtl(rtlRet);

      if (JSON.stringify(js) !== JSON.stringify(hw)) {
        mismatches++;
        if (report.length < 8) {
          report.push(`word ${hex(word)}${delaySlot ? ' (delay slot)' : ''}: ` +
            Object.keys(js).filter((k) => String(js[k]) !== String(hw[k]))
              .map((k) => `${k} js=${js[k]} rtl=${hw[k]}`).join('; '));
        }
      }

      // clean up: undo every store this word performed on either core
      for (const addr of jsWrites) {
        if (addr !== CODE && addr !== 2) sim.memory[addr] = 0xFFFF;
      }
      jsWrites.clear();
      sim.memory[CODE] = word;
      const recent = Array.from(r.get_recent_access());
      if (recent[5] && recent[0] < MEM_WORDS && recent[0] !== CODE && recent[0] !== 2) {
        r.poke(recent[0], 0xFFFF);
      }
      r.poke(CODE, word);
      void jsRet;
    }
  }
  assert.equal(mismatches, 0, `decode sweep diverged:\n${report.join('\n')}`);
});

test('the example programs produce the same screen output on all cores', async () => {
  const asmDir = path.join(ROOT, 'asm');
  for (const file of ['far_call.asm', 'fibonacci.asm', 'link_delay_slot.asm',
                      'string_demo.asm', 'swi-test.asm']) {
    const res = assemble(fs.readFileSync(path.join(asmDir, file), 'utf8'));
    await parity(res, { name: file, cs: 0xFFFF, maxSteps: 400000 });
  }
});

test('the Forth REPL boots and answers on the RTL core', async () => {
  const res = assemble(fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8'));
  assert.ok(res.success, res.errors.join('; '));
  const keys = [...'1 2 + .\n'].map((c) => (c === '\n' ? 10 : c.charCodeAt(0)));
  const rtl = await runRtl(res, { cs: 0xFFFF, maxSteps: 600000, keys });
  const wa = await runWasm(res, { cs: 0xFFFF, maxSteps: 600000, keys });
  const screen = screenRows(rtl.memoryAt(SCREEN_ADDR, 25 * 80));
  assert.match(screen, /DeepForth/, 'the banner is missing');
  assert.match(screen, /\b3\b/, '1 2 + did not print');
  const waScreen = screenRows(wa.memoryAt(SCREEN_ADDR, 25 * 80));
  assert.equal(screen, waScreen, 'the RTL screen differs from the WASM core');
});

test('the RTL core counts cycles per retired instruction', async () => {
  const res = assemble(`
        LDI 0x0001
        LSI R1, 2
        ADD R1, R1
        HALT
  `);
  const rtl = await runRtl(res, { cs: 0x0000 });
  assert.equal(rtl.steps, 4);
  const cycles = rtl.cycleCount();
  assert.ok(cycles >= 4 * rtl.steps, `cycle counter looks wrong: ${cycles} for ${rtl.steps} steps`);
  assert.equal(rtl.stepCount(), rtl.steps);
});

// ---------------------------------------------------------------------------
// Documented divergences of the Rust/WASM core. These are pinned here so a
// change to either core shows up as a failing test instead of a silent
// difference; the RTL follows the JS core in both cases (see
// doc/Deep16-RTL.md for the full list).
// ---------------------------------------------------------------------------

test('pinned divergence (closed): LD/ST offsets are sign-extended everywhere', async () => {
  const res = assemble(`
        LSI R1, 4
        LDI 0x1234
        MOV R2, R0, 0
        ST R2, R1, -1
        LD R3, R1, -1
        HALT
  `);
  const js = runJs(res, { cs: 0x0000 });
  const rtl = await runRtl(res, { cs: 0x0000 });
  const wa = await runWasm(res, { cs: 0x0000 });
  assert.equal(rtl.registers[3], js.sim.registers[3], 'the RTL must follow the JS core');
  assert.equal(wa.registers[3], js.sim.registers[3],
    'the WASM core used to add the raw 0..31 offset here; that gap is closed');
});

test('pinned divergence: 0xFFF1 is FSH, a no-op - not a halt', async () => {
  const program = rawProgram([0xFFF1, enc.LDI(0x0042), enc.HLT]);
  const js = runJs(program, { cs: 0x0000 });
  const rtl = await runRtl(program, { cs: 0x0000 });
  assert.equal(js.sim.registers[0], 0x0042, 'the JS core executes past FSH');
  assert.equal(rtl.registers[0], 0x0042, 'the RTL must do the same');
  assert.equal(rtl.steps, js.steps);
});