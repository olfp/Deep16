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

test('LDS/STS reject a fourth operand (no offset field)', () => {
  for (const m of ['LDS R2, DS, R0, 4', 'STS R1, ES, R8, 4']) {
    const res = assemble(`${m}\n`);
    assert.equal(res.success, false, m);
    assert.match(res.errors.join(), /has no offset operand/);
  }
  // The three-operand forms must still work.
  for (const m of ['LDS R2, DS, R0', 'STS R1, ES, R8', 'LDS R1, CS, R5', 'STS R1, SS, LR']) {
    assert.equal(assemble(`${m}\n`).success, true, m);
  }
});

// ---------------------------------------------------------------------------
// Label arithmetic. The evaluator used to be two regular expressions covering
// "label + 4" and "label - 4" and nothing else, so "f0 - f1" was rejected
// while "100 * 8" missed the expression path entirely and assembled to 100.

// Assemble one .word whose operand is `expr`, with `a` at address 1 and `b`
// at address 16, so the label arithmetic has something to say.
const gap15 = Array.from({ length: 15 }, () => '.word 0').join('\n');
const labelWord = (expr) => {
  const res = assemble(`.word ${expr}\na:\n${gap15}\nb:\n`);
  assert.equal(res.success, true, `${expr}: ${(res.errors || []).join('|')}`);
  return res.memoryChanges[0].value;
};

test('the difference of two labels assembles', () => {
  // The case this whole change exists for: b - a is 16 - 1.
  assert.equal(labelWord('b - a'), 15);
  // A word is 16 bits, so a negative difference lands as its two's complement.
  assert.equal(labelWord('a - b'), (-15) & 0xFFFF);
});

test('labels, constants and hex combine with + - * / and parentheses', () => {
  const cases = [
    ['b + a', 17], ['a + 4', 5], ['b - 4', 12],
    ['2 * b', 32], ['b / 4', 4], ['b / 3', 5],          // integer division truncates
    ['(b - a) * 2', 30], ['b - a * 2', 14],              // * binds tighter than -
    ['0x10 + b', 32], ['$10 + b', 32], ['0x20 - 0x10', 16],
    ["b + 'A'", 81], ['-b + 16', 0], ['b + -4', 12],
    ['1 + 2 + 3 + 4', 10], ['((b))', 16],
  ];
  for (const [expr, want] of cases) {
    assert.equal(labelWord(expr), want, expr);
  }
});

test('label arithmetic reaches forward references', () => {
  // Both labels are defined after the .word that uses them, so the first pass
  // has to read them as 0 and the second pass as their real addresses.
  const res = assemble('.word late - early\n.word 0\nearly:\n.word 0\nlate:\n');
  assert.equal(res.success, true, (res.errors || []).join('|'));
  assert.equal(res.memoryChanges[0].value, 1);
});

test('label arithmetic works in an instruction operand, not just .word', () => {
  const res = assemble(`LDI b - a\na:\n${gap15}\nb:\n`);
  assert.equal(res.success, true, (res.errors || []).join('|'));
  assert.equal(wordsOf(res)[0] & 0x7FFF, 15);
});

test('.equ keeps the whole expression, not just its first token', () => {
  // ".equ D, b - a" used to be split on every separator, so D was bound to b
  // and the "- a" was dropped without complaint.
  const res = assemble(`.equ D, b - a\n.word 0\na:\n${gap15}\nb:\n.word D\n`);
  assert.equal(res.success, true, (res.errors || []).join('|'));
  const last = res.memoryChanges[res.memoryChanges.length - 1].value;
  assert.equal(last, 15, 'D should be b - a');
});

test('.equ still binds a bare register alias and a bare number', () => {
  // A register name becomes an alias, usable wherever a register is expected.
  assert.equal(assemble('.equ TIB R6\nMOV TIB, R2\n').success, true);
  assert.equal(assemble('.equ N, 40\n.word N\n').memoryChanges[0].value, 40);
  assert.equal(assemble('.equ D, 0x20\n.word D\n').memoryChanges[0].value, 0x20);
});

test('a visible operator can no longer be quietly ignored', () => {
  // "100 * 8" used to fall through to parseInt and assemble to 100.
  assert.equal(labelWord('100 * 8'), 800);
  assert.equal(labelWord('100 / 8'), 12);
});

test('an unusable expression is reported rather than assembled to a wrong number', () => {
  for (const src of [
    '.word a - b\n',      // neither label is ever defined
    '.word 8 / 0\n',      // division by zero
    '.word (1 + 2\n',     // unbalanced parenthesis
    '.word 1 + 2)\n',     // stray closing parenthesis
    '.word 1 @ 2\n',      // stray character
    '.word 1 + 2 3\n',    // trailing text
  ]) {
    const res = assemble(src);
    assert.equal(res.success, false, `should not assemble: ${src.trim()}`);
    assert.match(res.errors.join(), /expression|label|Division/i, src.trim());
  }
});
