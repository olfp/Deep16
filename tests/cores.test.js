// CPU core behaviour, and JS core vs WASM core parity.
//
// The MUL32/DIV32 cases here are the regression tests for the bug where the
// assembler demanded an odd destination register: with the parity check
// inverted no spec-legal 32-bit instruction could be assembled, while
// "MUL32 R15, R6" passed and then wrote past the end of the register file
// (Rust panic, JS grew a 17th register).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, loadBrowserScripts, runJs, runWasm, rawProgram, enc, loadWasm, MEM_WORDS } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

// Data page: DS = 0x100 -> physical 0x1000, loaded with LD Rd, R0, offset.
const MUL32_PROGRAM = `
.org 0x0000
        LDI 0x0
        LD  R4, R0, 0        ; R4 = 0x1234
        LD  R6, R0, 1        ; R6 = 0x0010
        MUL32 R4, R6         ; R4:R5 = 0x00012340
        HALT
.org 0x1000
        .word 0x1234, 0x0010
`;

const DIV32_PROGRAM = `
.org 0x0000
        LDI 0x0
        LD  R12, R0, 0       ; R12 = 0x0005
        LD  R13, R0, 1       ; R13 = 0x0003   -> dividend 0x00050003
        LD  R6, R0, 2        ; R6  = 0x0007   -> divisor
        DIV32 R12, R6        ; R12 = 46811 (0xB6DB), R13 = 6
        HALT
.org 0x1000
        .word 0x0005, 0x0003, 0x0007
`;

const ALU_PROGRAM = `
.org 0x0000
        LDI 0x0
        LD  R1, R0, 0
        LD  R2, R0, 1
        ADD R3, R1
        SUB R4, R2
        AND R5, R1
        OR  R6, R2
        XOR R7, R1
        MUL R8, R2
        SL  R9, 3
        ROL R10, 5
        SRA R11, 2
        HALT
.org 0x1000
        .word 0x1234, 0x000F
`;

test('the hand-encoded words match what the assembler produces', () => {
  const cases = [
    ['LSI R6, 4', enc.LSI(6, 4)],
    ['MUL32 R4, R6', enc.MUL32(4, 6)],
    ['DIV32 R12, R6', enc.DIV32(12, 6)],
    ['HALT', enc.HLT],
  ];
  for (const [line, word] of cases) {
    const res = assemble(`${line}\n`);
    assert.equal(res.success, true, `${line}: ${res.errors}`);
    assert.equal(res.memoryChanges[0].value & 0xFFFF, word, line);
  }
});

test('MUL32 puts the high word in Rd and the low word in Rd+1', () => {
  const res = assemble(MUL32_PROGRAM);
  assert.equal(res.success, true, res.errors.join('; '));
  const { registers } = runJs(res, { cs: 0x0000, ds: 0x0100 });
  // 0x1234 * 0x0010 = 0x00012340
  assert.equal(registers[4] & 0xFFFF, 0x0001, 'R4 must hold the high word');
  assert.equal(registers[5] & 0xFFFF, 0x2340, 'R5 must hold the low word');
});

test('DIV32 leaves quotient in Rd and remainder in Rd+1', () => {
  const res = assemble(DIV32_PROGRAM);
  assert.equal(res.success, true, res.errors.join('; '));
  const { registers } = runJs(res, { cs: 0x0000, ds: 0x0100 });
  assert.equal(registers[12] & 0xFFFF, 46811);
  assert.equal(registers[13] & 0xFFFF, 6);
});

test('JS and WASM cores agree on MUL32', async () => {
  const res = assemble(MUL32_PROGRAM);
  const js = runJs(res, { cs: 0x0000, ds: 0x0100 });
  const wasm = await runWasm(res, { cs: 0x0000, ds: 0x0100 });
  assert.deepEqual(wasm.registers, js.registers.map(v => v & 0xFFFF));
  assert.equal(wasm.registers[4], 0x0001);
  assert.equal(wasm.registers[5], 0x2340);
});

test('JS and WASM cores agree on DIV32', async () => {
  const res = assemble(DIV32_PROGRAM);
  const js = runJs(res, { cs: 0x0000, ds: 0x0100 });
  const wasm = await runWasm(res, { cs: 0x0000, ds: 0x0100 });
  assert.deepEqual(wasm.registers, js.registers.map(v => v & 0xFFFF));
});

test('JS and WASM cores agree on the rest of the ALU group', async () => {
  const res = assemble(ALU_PROGRAM);
  const js = runJs(res, { cs: 0x0000, ds: 0x0100 });
  const wasm = await runWasm(res, { cs: 0x0000, ds: 0x0100 });
  assert.deepEqual(wasm.registers, js.registers.map(v => v & 0xFFFF));
});

// The bit-index immediates: OR/XOR expand imm4 to 1 << imm, CLRB clears that
// bit. 0x1234 has bit 12 set and bit 3 clear.
const BIT_PROGRAM = `
.org 0x0000
        LDI 0x0
        LD  R1, R0, 0
        OR  R1, 3          ; set bit 3        -> 0x123C
        XOR R1, 3          ; toggle it back   -> 0x1234
        CLRB R1, 12        ; clear bit 12     -> 0x0234
        HALT
.org 0x1000
        .word 0x1234
`;

test('CLRB and the bit-index immediates do what spec Table 6 says', async () => {
  const res = assemble(BIT_PROGRAM);
  assert.equal(res.success, true, res.errors.join('; '));
  const js = runJs(res, { cs: 0x0000, ds: 0x0100 });
  const wasm = await runWasm(res, { cs: 0x0000, ds: 0x0100 });
  assert.equal(js.registers[1] & 0xFFFF, 0x0234, 'JS core');
  assert.deepEqual(wasm.registers, js.registers.map(v => v & 0xFFFF), 'WASM core must agree');
});

test('AND immediate is gone but AND with a register still works', async () => {
  const prog = `
.org 0x0000
        LDI 0x0
        LD  R1, R0, 0
        LDI 0x00F0
        AND R1, R0
        HALT
.org 0x1000
        .word 0x1234
`;
  const res = assemble(prog);
  assert.equal(res.success, true, res.errors.join('; '));
  const js = runJs(res, { cs: 0x0000, ds: 0x0100 });
  assert.equal(js.registers[1] & 0xFFFF, 0x0030);
});

test('an odd destination register does not escape the register file (JS)', () => {
  // The assembler refuses this word, but the memory panel lets a user type it
  // in directly, so the core has to cope as well.
  const prog = rawProgram([enc.LSI(6, 4), enc.MUL32(15, 6), enc.HLT]);
  const { registers } = runJs(prog, { cs: 0x0000 });
  assert.equal(registers.length, 16, 'the register file must stay at 16 entries');
  assert.equal(registers[16], undefined, 'R16 must not be created');
  assert.equal(registers[6] & 0xFFFF, 4, 'R6 must be untouched by the rejected MUL32');
});

test('an odd destination register does not panic the WASM core', async () => {
  const prog = rawProgram([enc.LSI(6, 4), enc.MUL32(15, 6), enc.HLT]);
  const wasm = await runWasm(prog, { cs: 0x0000 });
  assert.equal(wasm.registers.length, 16);
  assert.equal(wasm.registers[6], 4, 'R6 must be untouched by the rejected MUL32');
});

test('an odd destination register on DIV32 is rejected too', async () => {
  const prog = rawProgram([enc.LSI(6, 4), enc.DIV32(13, 6), enc.HLT]);
  const js = runJs(prog, { cs: 0x0000 });
  assert.equal(js.registers.length, 16);
  const wasm = await runWasm(prog, { cs: 0x0000 });
  assert.equal(wasm.registers.length, 16);
});

// R14/R15 is left out on purpose: R15 is the PC, so a MUL32 writing into
// R14:R15 overwrites the program counter. That is a property of the ISA, not
// a bug in the core.
test('MUL32 with an even destination works at every aligned pair', async () => {
  // 255 * 258 = 65790 = 0x0100FE: high word 0x0001, low word 0x00FE, so both
  // halves of the pair are non-zero and a swapped result would be visible.
  // R0 stays 0 and serves as the LD base, so the load into R{rd+1} must come
  // first - for rd = 0 it is the only order that keeps the base intact.
  for (const rd of [0, 2, 4, 6, 8, 10, 12]) {
    const src = `
.org 0x0000
        LDI  0x0
        LD   R${rd + 1}, R0, 1
        LD   R${rd}, R0, 0
        MUL32 R${rd}, R${rd + 1}
        HALT
.org 0x1000
        .word 0x00FF, 0x0102
`;
    const res = assemble(src);
    assert.equal(res.success, true, res.errors.join('; '));
    const js = runJs(res, { cs: 0x0000, ds: 0x0100 });
    assert.equal(js.registers[rd] & 0xFFFF, 0x0001, `JS high word for R${rd}`);
    assert.equal(js.registers[rd + 1] & 0xFFFF, 0x00FE, `JS low word for R${rd + 1}`);
    const wasm = await runWasm(res, { cs: 0x0000, ds: 0x0100 });
    assert.equal(wasm.registers[rd], 0x0001, `WASM high word for R${rd}`);
    assert.equal(wasm.registers[rd + 1], 0x00FE, `WASM low word for R${rd + 1}`);
  }
});

// Spec 6.2.1: LINK must save the instruction AFTER the branch delay slot as
// the return address. Both cores used to save the slot address itself, so the
// delay-slot instruction executed a second time when the subroutine returned -
// invisible for the shipped NOP slots, wrong for real code.
//   0x0000 LDI link_sub / 0x0001 MOV R4 / 0x0002 LINK / 0x0003 JMP R4 /
//   0x0004 ADD (delay slot) / 0x0005 HALT (zurueck) /
//   0x0006 JMP LR (link_sub) / 0x0007 NOP
const LINK_PROGRAM = `
.org 0x0000
        LDI  link_sub
        MOV  R4, R0
        LINK
        JMP  R4
        ADD  R6, 1          ; delay slot: useful work, must run exactly once
zurueck:
        HALT
link_sub:
        JMP  LR
        NOP
`;

test('LINK points LR past the delay slot (spec 6.2.1)', async () => {
  const res = assemble(LINK_PROGRAM);
  assert.equal(res.success, true, res.errors.join('; '));
  const js = runJs(res, { cs: 0x0000 });
  assert.equal(js.registers[14], 0x0005,
    `JS: LR = 0x${js.registers[14].toString(16)}, expected 0x0005 (zurueck)`);
  assert.equal(js.registers[6], 1,
    `JS: delay slot executed ${js.registers[6]}x, expected 1`);
  const wasm = await runWasm(res, { cs: 0x0000 });
  assert.equal(wasm.registers[14], 0x0005,
    `WASM: LR = 0x${wasm.registers[14].toString(16)}, expected 0x0005 (zurueck)`);
  assert.equal(wasm.registers[6], 1,
    `WASM: delay slot executed ${wasm.registers[6]}x, expected 1`);
});

// The IDE's Assemble explicitly does NOT touch registers or segments
// (deep16_ui_core.js: "Do not modify registers or segments during Assemble"),
// so whatever new()/reset() produce is exactly the state a program starts in -
// and exactly what the book tells the reader to expect. Both cores must agree
// on it, including SP = 0x7FFF, the flat segments and the installed boot ROM.
function jsSnapshot(sim) {
  return {
    registers: Array.from(sim.registers),
    psw: sim.psw,
    segments: [sim.segmentRegisters.CS, sim.segmentRegisters.DS,
               sim.segmentRegisters.SS, sim.segmentRegisters.ES],
    bootROM: Array.from({ length: 16 }, (_, i) => sim.memory[0xFFFF0 + i]),
  };
}

function wasmSnapshot(w) {
  return {
    registers: Array.from(w.get_registers()),
    psw: w.get_psw(),
    segments: Array.from(w.get_segments()),
    bootROM: Array.from(w.get_memory_slice(0xFFFF0, 16)),
  };
}

function assertFreshState(s, label) {
  assert.equal(s.registers[13], 0x7FFF, `${label}: SP starts at 0x7FFF`);
  assert.deepEqual(s.segments, [0xFFFF, 0x0000, 0x0000, 0x0000],
    `${label}: CS/DS/SS/ES`);
  assert.equal(s.psw, 0, `${label}: PSW`);
  assert.deepEqual(s.bootROM.slice(0, 3), [0x0000, 0xFF41, 0xFF42],
    `${label}: boot ROM installed`);
}

test('fresh-machine state is identical in both cores', async () => {
  const w = await loadWasm();
  w.init(MEM_WORDS);
  const js = jsSnapshot(new Deep16Simulator());
  const wa = wasmSnapshot(w);
  assert.deepEqual(wa, js, 'WASM init() differs from new Deep16Simulator()');
  assertFreshState(js, 'fresh');
});

test('reset state is identical in both cores', async () => {
  const w = await loadWasm();
  w.init(MEM_WORDS);
  const sim = new Deep16Simulator();

  // Dirty both machines the same way, then reset them.
  sim.registers.fill(0xAAAA);
  sim.psw = 0x0361;
  sim.segmentRegisters.DS = 0x1234;
  sim.segmentRegisters.ES = 0x5678;
  const junk = new Uint16Array(16).fill(0xAAAA);
  w.set_registers(junk);
  w.set_psw(0x0361);
  w.set_segments(0x0000, 0x1234, 0x5678, 0x9ABC);

  sim.reset();
  w.reset();
  const js = jsSnapshot(sim);
  const wa = wasmSnapshot(w);
  assert.deepEqual(wa, js, 'WASM reset() differs from JS reset()');
  assertFreshState(js, 'reset');
});

// The documented boot state (book kap02): the ROM zeroes DS/SS, jumps to
// 0x0100 with CS = 0, and leaves SP at 0x7FFF and the PSW at 0. ES is never
// touched by the ROM - a fresh machine must already sit at 0.
const BOOT_PROGRAM = `
.org 0x0100
        MOV  R6, PC          ; R6 = 0x0101: execution really reached 0x0100
        HALT
`;

test('boot lands on 0x0100 with the documented state (both cores)', async () => {
  const res = assemble(BOOT_PROGRAM);
  assert.equal(res.success, true, res.errors.join('; '));

  const js = runJs(res);
  assert.equal(js.registers[6], 0x0101, 'JS: boot did not start at 0x0100');
  assert.equal(js.registers[13], 0x7FFF, 'JS: SP after boot');
  assert.equal(js.sim.psw, 0, 'JS: PSW after boot');
  assert.deepEqual(
    [js.sim.segmentRegisters.CS, js.sim.segmentRegisters.DS,
     js.sim.segmentRegisters.SS, js.sim.segmentRegisters.ES],
    [0x0000, 0x0000, 0x0000, 0x0000], 'JS: segments after boot');

  const wa = await runWasm(res);
  assert.equal(wa.registers[6], 0x0101, 'WASM: boot did not start at 0x0100');
  assert.equal(wa.registers[13], 0x7FFF, 'WASM: SP after boot');
  assert.equal(wa.psw, 0, 'WASM: PSW after boot');
  assert.deepEqual(wa.segments, [0x0000, 0x0000, 0x0000, 0x0000],
    'WASM: segments after boot');
});

// Spec 3.6: the 5-bit LD/ST offset is sign-extended (-16..+15), and that is
// what makes a stack frame readable ("LD R1, [SP-4] works directly"). The JS
// core did this; the WASM core added the raw 0..31 field and read the wrong
// word for every negative offset. Data page DS = 0x100 -> physical 0x1000;
// the base is built with LDI+MOV because LSI's 5-bit immediate is signed.
const NEG_OFFSET_PROGRAM = `
.org 0x0000
        LDI 16
        MOV R2, R0          ; base R2 = 16 -> physical 0x1010
        LD  R3, R2, -16     ; 0x1000
        LD  R4, R2, -8      ; 0x1008
        LD  R5, R2, -1      ; 0x100F
        LD  R6, R2, 0       ; 0x1010
        LD  R7, R2, 7       ; 0x1017
        LD  R8, R2, 15      ; 0x101F
        LDI 0x1234
        ST  R0, R2, -16     ; 0x1000 <- 0x1234
        HALT
.org 0x1000
        .word 0xA000, 0, 0, 0, 0, 0, 0, 0
        .word 0xA008, 0, 0, 0, 0, 0, 0
        .word 0xA00F, 0xA010, 0, 0, 0, 0, 0, 0
        .word 0xA017, 0, 0, 0, 0, 0, 0, 0, 0xA01F
`;

test('negative LD/ST offsets reach the right word (JS + WASM parity)', async () => {
  const res = assemble(NEG_OFFSET_PROGRAM);
  assert.equal(res.success, true, res.errors.join('; '));
  const expected = { 3: 0xA000, 4: 0xA008, 5: 0xA00F, 6: 0xA010, 7: 0xA017, 8: 0xA01F };
  const js = runJs(res, { cs: 0x0000, ds: 0x0100 });
  for (const [r, v] of Object.entries(expected)) {
    assert.equal(js.registers[r] & 0xFFFF, v, `JS R${r} at offset`);
  }
  assert.equal(js.memory[0x1000] & 0xFFFF, 0x1234, 'JS: store through offset -16');
  const wasm = await runWasm(res, { cs: 0x0000, ds: 0x0100 });
  assert.deepEqual(wasm.registers, js.registers.map(v => v & 0xFFFF));
  assert.equal(wasm.memoryAt(0x1000, 1)[0], 0x1234, 'WASM: store through offset -16');
});

test('the 5-bit LD offset is signed across the whole range -16..+15 (both cores)', async () => {
  for (let off = -16; off <= 15; off++) {
    const addr = 0x1010 + off;
    const src = `
.org 0x0000
        LDI 16
        MOV R2, R0
        LD  R3, R2, ${off}
        HALT
.org 0x${addr.toString(16)}
        .word 0x${addr.toString(16)}
`;
    const res = assemble(src);
    assert.equal(res.success, true, `offset ${off}: ${res.errors.join('; ')}`);
    const js = runJs(res, { cs: 0x0000, ds: 0x0100 });
    assert.equal(js.registers[3] & 0xFFFF, addr, `JS offset ${off}`);
    const wasm = await runWasm(res, { cs: 0x0000, ds: 0x0100 });
    assert.equal(wasm.registers[3], addr, `WASM offset ${off}`);
  }
});

test('the raw LD encoding sign-extends its offset (both cores)', async () => {
  // Bypass the assembler so the encoding itself is pinned: base R2 = 8,
  // offset -4 must hit physical 4, not 8 + 0x1C = 0x24.
  const words = new Array(0x30).fill(0);
  words[0] = enc.LSI(2, 8);      // R2 = 8
  words[1] = enc.LD(1, 2, -4);   // LD R1, R2, -4
  words[2] = enc.HLT;
  words[0x04] = 0xABCD;          // what a signed read must fetch
  words[0x24] = 0x1234;          // what an unsigned read would fetch
  const prog = rawProgram(words);
  const js = runJs(prog, { cs: 0x0000 });
  assert.equal(js.registers[1] & 0xFFFF, 0xABCD, 'JS must sign-extend the offset');
  const wasm = await runWasm(prog, { cs: 0x0000 });
  assert.equal(wasm.registers[1], 0xABCD, 'WASM must sign-extend the offset');
  assert.deepEqual(wasm.registers, js.registers.map(v => v & 0xFFFF));
});

test('base 0 with offset -4 reads 0xFFFC, not 0x1C (both cores)', async () => {
  // The wrap-around edge: base + offset folds into 16 bits *before* the
  // segment is added, so the JS core reads physical 0xFFFC. The WASM core
  // used to read 0x1C. Kept as an assembler program because 0xFFFC lies far
  // above the code, which keeps the fixture small.
  const src = `
.org 0x0000
        LDI 0
        LD  R1, R0, -4
        HALT
.org 0x001C
        .word 0x1234
.org 0xFFFC
        .word 0xABCD
`;
  const res = assemble(src);
  assert.equal(res.success, true, res.errors.join('; '));
  const js = runJs(res, { cs: 0x0000 });
  assert.equal(js.registers[1] & 0xFFFF, 0xABCD, 'JS must sign-extend the offset');
  const wasm = await runWasm(res, { cs: 0x0000 });
  assert.equal(wasm.registers[1], 0xABCD, 'WASM must sign-extend the offset');
  assert.deepEqual(wasm.registers, js.registers.map(v => v & 0xFFFF));
});

// Spec Table 5: system instructions live in 0xFFF0..0xFFF7 (top 13 bits
// 1111111111110); only 0xFFFF is HLT. The JS core used to stop on 0xFFF1 (a
// legacy hack) while the WASM core dispatched all of 0xFFF0..0xFFFF as system
// words and treated op 1 as HLT — so 0xFFF1 and 0xFFFA behaved differently.
test('the system space is 0xFFF0..0xFFF7; 0xFFF8..0xFFFE are no-ops (both cores)', async () => {
  for (const word of [0xFFF0, 0xFFF1, 0xFFF7, 0xFFF8, 0xFFFA, 0xFFFE]) {
    const prog = rawProgram([word, 0x0007, enc.HLT]);
    const js = runJs(prog, { cs: 0x0000 });
    assert.equal(js.registers[0] & 0xFFFF, 7, `JS: 0x${word.toString(16)} must be a no-op`);
    const wasm = await runWasm(prog, { cs: 0x0000 });
    assert.equal(wasm.registers[0], 7, `WASM: 0x${word.toString(16)} must be a no-op`);
    assert.deepEqual(wasm.registers, js.registers.map(v => v & 0xFFFF),
      `0x${word.toString(16)}: cores must agree`);
  }
});

test('0xFFFF halts, 0xFFF1 (FSH) runs on (both cores)', async () => {
  const halt = rawProgram([enc.HLT]);
  assert.equal(runJs(halt, { cs: 0x0000 }).steps, 1, 'JS: HLT stops after one step');
  assert.equal((await runWasm(halt, { cs: 0x0000 })).steps, 1, 'WASM: HLT stops after one step');

  const fsh = rawProgram([0xFFF1, 0x0007, enc.HLT]);
  const js = runJs(fsh, { cs: 0x0000 });
  assert.equal(js.registers[0] & 0xFFFF, 7, 'JS: 0xFFF1 must not halt');
  const wasm = await runWasm(fsh, { cs: 0x0000 });
  assert.equal(wasm.registers[0], 7, 'WASM: 0xFFF1 must not halt');
  assert.deepEqual(wasm.registers, js.registers.map(v => v & 0xFFFF));
});