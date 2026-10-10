// Assembler -> disassembler round trip across the instruction set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, loadBrowserScripts } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_disassembler.js');

const dis = new globalThis.Deep16Disassembler();

// One representative operand pair per mnemonic group. Kept to forms the
// disassembler prints back in a shape the assembler accepts again.
const MNEMONICS = [
  'ADD R1, R2', 'ADD R1, 3', 'SUB R1, R2', 'SUB R1, 3',
  'CMP R1, R2', 'AND R1, R2',
  'TBC R1, R2', 'OR R1, R2', 'OR R1, 3', 'XOR R1, R2', 'XOR R1, 3',
  'TBS R1, R2', 'MUL R1, R2', 'MUL32 R2, R4', 'DIV R1, R2', 'DIV32 R2, R4',
  'SL R1, 2', 'SLA R1, 2', 'SLAC R1, 2', 'SLC R1, 2',
  'SR R1, 2', 'SRC R1, 2', 'SRA R1, 2', 'SRAC R1, 2',
  'ROL R1, 2', 'RLC R1, 2', 'ROR R1, 2', 'RRC R1, 2',
  'MOV R1, R2', 'LDI 0x7', 'LSI R1, -3',
  'LD R1, R2, 4', 'ST R1, R2, -4',
  'SWB R1', 'INV R1', 'NEG R1', 'CLRB R1, 5',
  'SRS R1', 'SRD R1', 'ERS R1', 'ERD R1',
  'SETN', 'CLRN', 'SETZ', 'CLRZ', 'SETV', 'CLRV', 'SETC', 'CLRC',
  'SWI', 'RETI', 'NOP', 'HALT',
];

test('every mnemonic disassembles to something the assembler understands', () => {
  const unparsable = [];
  for (const line of MNEMONICS) {
    const res = assemble(`${line}\n`);
    assert.equal(res.success, true, `${line} should assemble: ${res.errors}`);
    const word = res.memoryChanges[0].value & 0xFFFF;
    const text = dis.disassemble(word);
    const back = assemble(`${text}\n`);
    if (!back.success) unparsable.push({ line, word: word.toString(16), text, errors: back.errors });
  }
  assert.deepEqual(unparsable, [], 'disassembler output must be re-assemblable');
});

test('round trip preserves the machine word for the ALU group', () => {
  const alu = MNEMONICS.filter(l => /^(ADD|SUB|CMP|AND|CLRB|TBC|OR|XOR|TBS|MUL|DIV)/.test(l));
  for (const line of alu) {
    const word = assemble(`${line}\n`).memoryChanges[0].value & 0xFFFF;
    const back = assemble(`${dis.disassemble(word)}\n`);
    assert.equal(back.success, true, `${line} -> ${dis.disassemble(word)}`);
    assert.equal(back.memoryChanges[0].value & 0xFFFF, word, line);
  }
});

// LDI's operand is a 15-bit PATTERN (doc/Deep16-Arch.md 3.4: `R0 <-
// sign_extend(imm15)`), so every one of the 32768 patterns is a legal
// immediate — the sign extension happens in the CPU. The disassembler prints
// that pattern as raw hex, so the assembler has to accept it back. This test
// is the guard against "fixing" the assembler into a signed-range check, which
// would make half the disassembler output unloadable.
test('every LDI pattern survives disassemble -> assemble', () => {
  for (let pattern = 0; pattern <= 0x7FFF; pattern++) {
    const word = pattern & 0xFFFF;
    const text = dis.disassemble(word);
    const back = assemble(`${text}\n`);
    assert.equal(back.success, true, `${text} must assemble again (pattern 0x${word.toString(16).toUpperCase()})`);
    assert.equal(back.memoryChanges[0].value & 0xFFFF, word, text);
  }
});

// The boundaries of the two accepted spellings: raw 0..0x7FFF and signed
// -16384..-1 denote the same 32768 patterns, everything outside is rejected.
test('LDI accepts both spellings of the 15-bit field and nothing beyond', () => {
  for (const imm of [0, 1, 0x3FFF, 0x4000, 0x4E20, 0x7FFF, -1, -4096, -16383, -16384]) {
    const res = assemble(`LDI ${imm}\n`);
    assert.equal(res.success, true, `LDI ${imm} should assemble: ${res.errors}`);
  }
  for (const imm of [0x8000, 32768, -16385, -32768, 65535]) {
    const res = assemble(`LDI ${imm}\n`);
    assert.equal(res.success, false, `LDI ${imm} must be rejected`);
    assert.match(res.errors.join(), /LDI immediate .* out of range/);
  }
});

test('MUL32/DIV32 disassemble with an even destination register', () => {
  const mul32 = assemble('MUL32 R6, R9\n').memoryChanges[0].value & 0xFFFF;
  assert.equal(dis.disassemble(mul32), 'MUL32 R6, R9');
  const div32 = assemble('DIV32 R8, R12\n').memoryChanges[0].value & 0xFFFF;
  assert.equal(dis.disassemble(div32), 'DIV32 R8, R12');
});

test('HALT is recognised as HLT and vice versa', () => {
  const word = assemble('HALT\n').memoryChanges[0].value & 0xFFFF;
  assert.equal(dis.disassemble(word), 'HLT');
  assert.equal(assemble('HLT\n').memoryChanges[0].value & 0xFFFF, word);
});