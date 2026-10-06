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