// Assembler behaviour, including the MUL32/DIV32 regression:
// the destination-register parity check used to be inverted, which made
// every spec-legal 32-bit instruction impossible to assemble and let
// "MUL32 R15, R6" through into the register file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assemble, loadBrowserScripts, ROOT } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js');

const wordsOf = (res) => res.memoryChanges.filter(c => c.segment !== 'data').map(c => c.value & 0xFFFF);

test('MUL32/DIV32 accept an EVEN destination register', () => {
  for (const [mnemonic, func5] of [['MUL32', 0b11101], ['DIV32', 0b11111]]) {
    for (const rd of [0, 2, 4, 6, 8, 10, 12, 14]) {
      const res = assemble(`${mnemonic} R${rd}, R6\n`);
      assert.equal(res.success, true, `${mnemonic} R${rd} should assemble: ${res.errors}`);
      // spec Table 8: 110 func5 Rd4 Rs4
      assert.equal(wordsOf(res)[0], (0b110 << 13) | (func5 << 8) | (rd << 4) | 6);
    }
  }
});

test('MUL32/DIV32 reject an ODD destination register', () => {
  for (const mnemonic of ['MUL32', 'DIV32']) {
    for (const rd of [1, 3, 5, 7, 9, 11, 13, 15]) {
      const res = assemble(`${mnemonic} R${rd}, R6\n`);
      assert.equal(res.success, false, `${mnemonic} R${rd} must be rejected`);
      assert.match(res.errors.join(), /EVEN destination register/);
    }
  }
});

test('MUL32 R15, R6 - the word that used to crash the WASM core - is not produced', () => {
  const res = assemble('MUL32 R15, R6\n');
  assert.equal(res.success, false);
  assert.match(res.errors.join(), /EVEN/);
  assert.equal(res.memoryChanges.filter(c => c.segment !== 'data').length, 0);
});

test('no duplicate MUL32/DIV32 switch cases are left in the assembler', () => {
  const src = fs.readFileSync(`${ROOT}/js/deep16_assembler.js`, 'utf8');
  assert.equal(src.match(/case 'MUL32'/g).length, 1, 'MUL32 must appear in exactly one switch case');
  assert.equal(src.match(/case 'DIV32'/g).length, 1, 'DIV32 must appear in exactly one switch case');
  assert.equal(/encodeMUL32|encodeDIV32/.test(src), false, 'the dead encoders must be gone');
});

test('ALU group encodes as 110 func5 Rd4 Rs4', () => {
  const cases = [
    ['ADD R1, R2', 0b00000], ['ADD R1, 3', 0b00001],
    ['SUB R1, R2', 0b00010], ['SUB R1, 3', 0b00011],
    ['CMP R1, R2', 0b00100], ['CMP R1, 3', 0b00101],
    ['AND R1, R2', 0b00110], ['CLRB R1, 3', 0b00111],
    ['TBC R1, R2', 0b01000], ['TBC R1, 3', 0b01001],
    ['OR R1, R2', 0b01010], ['OR R1, 3', 0b01011],
    ['XOR R1, R2', 0b01100], ['XOR R1, 3', 0b01101],
    ['TBS R1, R2', 0b01110], ['TBS R1, 3', 0b01111],
    ['MUL R1, R2', 0b11100],
    ['MUL32 R2, R6', 0b11101],
    ['DIV R1, R2', 0b11110],
    ['DIV32 R2, R6', 0b11111],
  ];
  for (const [line, func5] of cases) {
    const res = assemble(`${line}\n`);
    assert.equal(res.success, true, `${line}: ${res.errors}`);
    const rd = Number(/^(\w+)\s+R(\d+)/.exec(line)[2]);
    const operand = line.split(',')[1].trim();
    // The bit-index immediates (CLRB/TBC/OR/XOR/TBS) store the index itself;
    // the core expands it to 1 << imm. The literal ones (ADD/SUB/CMP) store
    // the value. Either way the field is just the 4-bit operand.
    const low4 = /^R/i.test(operand) ? Number(operand.slice(1)) : Number(operand);
    assert.equal(wordsOf(res)[0], (0b110 << 13) | (func5 << 8) | (rd << 4) | low4, line);
  }
});

test('CLRB is a recognised mnemonic', () => {
  const res = assemble('CLRB R1, 2\n');
  assert.equal(res.success, true, res.errors.join('; '));
  const word = res.memoryChanges[0].value & 0xFFFF;
  // spec: 110 00111 Rd4 imm4, imm4 = the bit index to clear -> low4 = 2
  assert.equal(word >>> 8 & 0x1F, 0b00111);
  assert.equal(word & 0xF, 2);
});

test('AND has no immediate form any more', () => {
  const res = assemble('AND R1, 3\n');
  assert.equal(res.success, false);
  assert.match(res.errors.join(), /CLRB/);
  // The register form must still work.
  assert.equal(assemble('AND R1, R2\n').success, true);
});

test('CLRB rejects a register operand', () => {
  const res = assemble('CLRB R1, R2\n');
  assert.equal(res.success, false);
  assert.match(res.errors.join(), /bit number/);
});

test('unknown mnemonics are reported', () => {
  const res = assemble('FLARP R1, 2\n');
  assert.equal(res.success, false);
  assert.match(res.errors.join(), /Unknown instruction: FLARP/);
});

test('mnemonics and registers are case insensitive', () => {
  const variants = ['mul32 r4, r6', 'MUL32 R4, R6', 'MuL32 r4, R6'];
  const first = wordsOf(assemble(`${variants[0]}\n`));
  for (const v of variants.slice(1)) {
    assert.deepEqual(wordsOf(assemble(`${v}\n`)), first, v);
  }
});

test('LDI always targets R0', () => {
  const res = assemble('LDI 0xF\n');
  assert.equal(res.success, true);
  assert.equal(wordsOf(res)[0] & 0xF, 0xF);
});