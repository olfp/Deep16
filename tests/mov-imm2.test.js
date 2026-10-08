// MOV imm2 redesign (see doc/ARCHREV.md): imm2 is now a pure function select
//
//   0: Rd <- Rs            1: Rd <- Rs << 1
//   2: Rd <- Rs + 2        3: Rd <- (Rs << 1) | 1
//
// with "a PC read yields own address + 1" as the architectural source rule
// (spec 3.3/6.2.2). The old imm2=3 meanings are retired: ALNK/ALINK now
// encode SMV Rx, APC (spec Table R - the no-forward read lives only in SMV),
// AMV never shipped as a mnemonic, and the assembler rejects the
// meaning-changed ', 1' / ', 3' / '+1' / '+3' forms so a pre-redesign
// source fails loudly instead of silently shifting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, loadBrowserScripts, runJs, runWasm } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_disassembler.js', 'js/deep16_simulator.js');

const dis = new globalThis.Deep16Disassembler();

function word(source) {
  const res = assemble(source);
  assert.equal(res.success, true, `${source.trim()}: ${res.errors.join('; ')}`);
  return res.memoryChanges[0].value & 0xFFFF;
}

// ---------------------------------------------------------- imm2 function set

// LDI always writes R0 and sign-extends a 15-bit immediate.
const FUNCTION_PROGRAM = `
.org 0x0000
        LDI  0x1234
        MOV  R1, R0             ; imm2=0: copy
        MOV  R2, R0 << 1        ; imm2=1: shift left
        MOV  R3, R0 + 2         ; imm2=2: +2 (LINK shape on a data source)
        MOV  R4, R0 << 1 + 1    ; imm2=3: shift-or-1
        LDI  0x7FFF
        MOV  R5, R0 << 1        ; 0xFFFF << 1 wraps to 0xFFFE
        MOV  R6, R0 + 2         ; 0xFFFF + 2 wraps to 0x0001
        MOV  R7, R0 << 1 + 1    ; (0xFFFF << 1) | 1 = 0xFFFF
        HALT
`;

test('imm2 function table {copy, <<1, +2, <<1|1} agrees on both cores', async () => {
  const res = assemble(FUNCTION_PROGRAM);
  assert.equal(res.success, true, res.errors.join('; '));
  const expected = {
    1: 0x1234, 2: 0x2468, 3: 0x1236, 4: 0x2469,
    5: 0xFFFE, 6: 0x0001, 7: 0xFFFF,
  };
  const js = runJs(res, { cs: 0x0000 });
  const wasm = await runWasm(res, { cs: 0x0000 });
  for (const [rd, value] of Object.entries(expected)) {
    assert.equal(js.registers[rd] & 0xFFFF, value, `JS: R${rd}`);
    assert.equal(wasm.registers[rd], value, `WASM: R${rd}`);
  }
});

// ------------------------------------------------- architectural PC reads

// The JS core used to increment PC *after* the delay-slot instruction, so a
// PC read inside a delay slot returned the slot address itself (0x0003)
// while the WASM core returned own+1 (0x0004) - a cross-core divergence the
// shipped tests could not see because they only asserted "halts".
//
//   0x0000 LDI 0x0004 / 0x0001 MOV R4, R0 / 0x0002 JMP R4 /
//   0x0003 <PC read in the delay slot> / 0x0004 HALT
const SLOT_PROGRAM = (pcRead) => `
.org 0x0000
        LDI   0x0004
        MOV   R4, R0
        JMP   R4
        ${pcRead}
        HALT
`;

const SLOT_CASES = [
  ['SMV LR, APC', 0x0004, 'architectural PC read in a delay slot (SMV, spec 3.3)'],
  ['ALNK LR', 0x0004, 'ALNK alias = SMV LR, APC (spec Table R)'],
  ['MOV LR, PC', 0x0004, 'plain PC read in a delay slot'],
  ['MOV LR, PC + 2', 0x0006, 'LINK shape in a delay slot: (own+1) + 2'],
];

for (const [slot, expected, label] of SLOT_CASES) {
  test(`delay-slot PC read: ${label} -> 0x${expected.toString(16)}`, async () => {
    const res = assemble(SLOT_PROGRAM(slot));
    assert.equal(res.success, true, res.errors.join('; '));
    const js = runJs(res, { cs: 0x0000 });
    assert.equal(js.registers[14], expected,
      `JS: LR = 0x${js.registers[14].toString(16)}, expected 0x${expected.toString(16)}`);
    const wasm = await runWasm(res, { cs: 0x0000 });
    assert.equal(wasm.registers[14], expected,
      `WASM: LR = 0x${wasm.registers[14].toString(16)}, expected 0x${expected.toString(16)}`);
  });
}

test('PC reads outside a delay slot are own+1 on both cores', async () => {
  const res = assemble(`
.org 0x0000
        MOV   LR, PC           ; 0x0000: LR = 0x0001
        SMV   R9, APC          ; 0x0001: R9 = 0x0002
        HALT
`);
  assert.equal(res.success, true, res.errors.join('; '));
  const js = runJs(res, { cs: 0x0000 });
  assert.equal(js.registers[14], 0x0001, `JS: LR = 0x${js.registers[14].toString(16)}`);
  assert.equal(js.registers[9], 0x0002, `JS: R9 = 0x${js.registers[9].toString(16)}`);
  const wasm = await runWasm(res, { cs: 0x0000 });
  assert.equal(wasm.registers[14], 0x0001, `WASM: LR = 0x${wasm.registers[14].toString(16)}`);
  assert.equal(wasm.registers[9], 0x0002, `WASM: R9 = 0x${wasm.registers[9].toString(16)}`);
});

// End-to-end ALNK call: the delay-slot read feeds JMP LR directly, and the
// subroutine captures the return address in R8 so a wrong value cannot hide
// behind a re-executed (but otherwise harmless) SMV - which is exactly how
// the previous JS-core bug slipped past the shipped link_delay_slot test.
const ALNK_CALL_PROGRAM = `
.org 0x0000
        LDI   link_sub         ; 0x0000
        MOV   R4, R0           ; 0x0001
        JMP   R4               ; 0x0002 -> link_sub
        ALNK  LR               ; 0x0003 delay slot: LR = 0x0004
zurueck:
        ADD   R6, 1            ; 0x0004 must run exactly once
        HALT                   ; 0x0005
link_sub:
        MOV   R8, LR           ; 0x0006 capture the return address in flight
        ADD   R7, 1            ; 0x0007 subroutine work
        JMP   LR               ; 0x0008
        NOP                    ; 0x0009 delay slot
`;

test('ALNK in a delay slot hands the subroutine the address past the slot (both cores)', async () => {
  const res = assemble(ALNK_CALL_PROGRAM);
  assert.equal(res.success, true, res.errors.join('; '));
  for (const [name, reg] of [['JS', runJs(res, { cs: 0x0000 })],
                             ['WASM', await runWasm(res, { cs: 0x0000 })]]) {
    assert.equal(reg.registers[14], 0x0004, `${name}: LR = 0x${reg.registers[14].toString(16)}`);
    assert.equal(reg.registers[8], 0x0004,
      `${name}: captured return address 0x${reg.registers[8].toString(16)}, expected 0x0004`);
    assert.equal(reg.registers[6], 1, `${name}: zurueck ran ${reg.registers[6]}x`);
    assert.equal(reg.registers[7], 1, `${name}: subroutine ran ${reg.registers[7]}x`);
  }
});

// ----------------------------------------------------------- golden words

test('golden words: LINK unchanged, ALNK/ALINK re-encoded as SMV', () => {
  // LINK kept its encoding: imm2=2 still means Rs+2, PC still reads own+1.
  assert.equal(word('LINK\n'), 0xFBBE);
  assert.equal(word('LNK R5\n'), 0xF97E);
  assert.equal(word('MOV R1, R2 + 2\n'), 0xF84A);
  assert.equal(word('MOV LR, PC, 2\n'), 0xFBBE);

  // ALNK/ALINK moved from the MOV form (0xFBBF/0xFBBE-style) to SMV Rx, APC.
  assert.equal(word('ALNK LR\n'), 0xFEEF);
  assert.equal(word('ALINK\n'), 0xFEEF);
  assert.equal(word('SMV R14, APC\n'), 0xFEEF);
  assert.equal(word('MOV R5, APC\n'), 0xFE5F);

  // The shift forms occupy the encoding slots the old +1/+3 syntax used.
  assert.equal(word('MOV R1, R2 << 1\n'), 0xF849);
  assert.equal(word('MOV R1, R2 << 1 + 1\n'), 0xF84B);

  // The retired ALNK spelling is now an ordinary shift, not an alias.
  assert.equal(dis.disassemble(0xFBBF), 'MOV R14, PC << 1 + 1');
  assert.equal(dis.disassemble(0xF849), 'MOV R1, R2 << 1');
  assert.equal(dis.disassemble(0xF84B), 'MOV R1, R2 << 1 + 1');
  assert.equal(dis.disassemble(0xF84A), 'MOV R1, R2 + 2');
  assert.equal(dis.disassemble(0xFEEF), 'ALINK');
  assert.equal(dis.disassemble(0xFE5F), 'ALNK R5');
});

test('MOV/SMV words round-trip through the disassembler', () => {
  for (const w of [0xF848, 0xF849, 0xF84A, 0xF84B, 0xFBBE, 0xF97E, 0xFEEF, 0xFE5F]) {
    const text = dis.disassemble(w);
    const back = assemble(`${text}\n`);
    assert.equal(back.success, true, `0x${w.toString(16)} -> ${text}: ${back.errors}`);
    assert.equal(back.memoryChanges[0].value & 0xFFFF, w, text);
  }
});

// ------------------------------------------------------ syntax gate

test('assembler accepts the shift syntax and the unchanged 0/+2 forms', () => {
  assert.equal(word('MOV R1, R2\n'), 0xF848);
  assert.equal(word('MOV R1, R2, 0\n'), 0xF848);
  assert.equal(word('MOV R1, R2, 2\n'), 0xF84A);
  assert.equal(word('MOV R1, R2 +2\n'), 0xF84A);
  assert.equal(word('MOV R1, R2+2\n'), 0xF84A);
  assert.equal(word('MOV R1, R2 << 1\n'), 0xF849);
  assert.equal(word('MOV R1, R2<<1\n'), 0xF849);
  assert.equal(word('mov r1, r2 << 1\n'), 0xF849);
  assert.equal(word('MOV R1, R2 << 1 + 1\n'), 0xF84B);
});

test('assembler rejects the meaning-changed immediates with a hint', () => {
  const rejected = [
    'MOV R1, R2, 1', 'MOV R1, R2, 3', 'MOV R1, R2 +1', 'MOV R1, R2+1',
    'MOV R1, R2 +3', 'MOV R1, R2+3', 'MOV LR, PC, 3', 'MOV R1, R2 << 2',
  ];
  for (const line of rejected) {
    const res = assemble(`${line}\n`);
    assert.equal(res.success, false, `${line} must be rejected`);
    assert.match(res.errors.join('; '), /<<\s*1/,
      `${line}: error must point at the shift syntax (${res.errors.join('; ')})`);
  }

  // AMV - the retired unforwarded read - never became a mnemonic.
  const amv = assemble('AMV R1, R2\n');
  assert.equal(amv.success, false);
  assert.match(amv.errors.join('; '), /Unknown instruction: AMV/);
});

// ------------------------------------------------- constant reachability

// LDI sign-extends a 15-bit immediate, so on its own it can only load values
// whose bit15 equals bit14. For any 16-bit target T the pair
//   LDI x ; MOV Rd, R0 << 1  (T even)  or  << 1 + 1  (T odd)
// reaches T: the shift drops x's bit15, so exactly one of x / x^0x8000 is
// LDI-reachable, and for the odd case the 0x10000 wrap cancels as well.
function encodeConstant(target) {
  const base = target >>> 1;
  const x = [base, base ^ 0x8000]
    .find((v) => ((v >> 15) & 1) === ((v >> 14) & 1));
  return { imm15: x & 0x7FFF, imm2: (target & 1) ? 3 : 1 };
}

test('every 16-bit constant is reachable with LDI + one MOV imm2 shift', () => {
  for (let t = 0; t <= 0xFFFF; t++) {
    const { imm15, imm2 } = encodeConstant(t);
    // What LDI actually loads is the sign-extended 15-bit pattern...
    const loaded = (imm15 & 0x4000) ? (imm15 | 0x8000) : imm15;
    const built = ((loaded << 1) & 0xFFFF) | (imm2 === 3 ? 1 : 0);
    assert.equal(built, t,
      `0x${t.toString(16)}: LDI 0x${imm15.toString(16)} + imm2=${imm2} built 0x${built.toString(16)}`);
  }
});

test('LDI + MOV imm2 shift loads sampled constants on both cores', async () => {
  const targets = [
    0x0000, 0x0001, 0x0002, 0x0003, 0x1234, 0x1235, 0x3FFF,
    0x4000, 0x7FFF, 0x8000, 0x8001, 0xAAAA, 0xFFFE, 0xFFFF,
  ];
  for (const t of targets) {
    const { imm15, imm2 } = encodeConstant(t);
    const res = assemble(`
.org 0x0000
        LDI  0x${imm15.toString(16).toUpperCase()}
        MOV  R1, R0 ${imm2 === 1 ? '<< 1' : '<< 1 + 1'}
        HALT
`);
    assert.equal(res.success, true, `0x${t.toString(16)}: ${res.errors.join('; ')}`);
    const js = runJs(res, { cs: 0x0000 });
    assert.equal(js.registers[1] & 0xFFFF, t,
      `JS: wanted 0x${t.toString(16)}, got 0x${(js.registers[1] & 0xFFFF).toString(16)}`);
    const wasm = await runWasm(res, { cs: 0x0000 });
    assert.equal(wasm.registers[1], t,
      `WASM: wanted 0x${t.toString(16)}, got 0x${wasm.registers[1].toString(16)}`);
  }
});
