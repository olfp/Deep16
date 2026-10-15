// Peephole optimizer (js/deep16_optimizer.js).
//
// Two kinds of test here. The first group pins each rewrite rule and, just as
// important, its guards (delay slot, live R0, live flags) as text in -> text
// out. The second group is the real contract: assemble a program with and
// without the optimizer, run both, and require the same machine state and no
// more steps. That last group runs on the shipped Forth kernel, because a
// 5000-line real program is the only oracle that notices a rule that is
// locally plausible and globally wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assemble, optimize, loadBrowserScripts, runJs, runWasm, ROOT, SCREEN_ADDR } from './helpers.js';

loadBrowserScripts('js/deep16_optimizer.js', 'js/deep16_assembler.js', 'js/deep16_simulator.js');

function opt(src, options) {
  return optimize(src, options);
}

// Strip indentation so the expected text is readable. A trailing newline in
// the source is not an extra line.
function lines(s) {
  return s.replace(/\n$/, '').split('\n').map(l => l.trim());
}

// --------------------------------------------------------------- rules

test('B1: LDI k ; MOV Rd,R0 becomes LSI Rd,k when R0 dies', () => {
  const r = opt(`    LDI 2\n    MOV R2, R0\n    LDI 3\n    MOV R3, R0\n`);
  assert.deepEqual(lines(r.source), ['LSI R2, 2', 'LDI 3', 'MOV R3, R0']);
  assert.equal(r.stats.byRule.B1, 1);
});

test('B1 keeps the LDI when R0 is still live afterwards', () => {
  const src = `    LDI 2\n    MOV R2, R0\n    ADD R5, R0\n`;
  const r = opt(src);
  assert.equal(r.source, src);
  assert.equal(r.stats.byRule.B1, undefined);
});

test('B1 with Rd == R0 needs no R0-dead proof (R0 is the destination)', () => {
  const r = opt(`    LDI 2\n    MOV R0, R0\n`);
  // MOV R0,R0 is dropped as an identity; the LSI remains.
  assert.equal(r.stats.byRule.B1, 1);
  assert.deepEqual(lines(r.source), ['LSI R0, 2']);
});

test('B2: LDI k ; CMP Rd,R0 becomes CMP Rd,k', () => {
  // The LDI must be replaced only because R0 dies here, and the CMP's flags
  // must reach the branch, otherwise DSE would drop the compare as dead.
  const r = opt(`    LDI 0\n    CMP R2, R0\n    LDI 5\n    JZ there\n    NOP\nthere:\n    HLT\n`);
  assert.equal(lines(r.source)[0], 'CMP R2, 0');
  assert.equal(r.stats.byRule.B2, 1);
});

test('B2 refuses when the comparison is R0 against R0', () => {
  const r = opt(`    LDI 0\n    CMP R0, R0\n    LDI 5\n    JZ there\n    NOP\nthere:\n    HLT\n`);
  assert.equal(r.stats.byRule.B2, undefined);
  assert.ok(r.source.includes('CMP R0, R0'));
});

test('B3/B4/B5: literal, bit and clear-bit ALU folds', () => {
  const b3 = opt(`    LDI 3\n    ADD R1, R0\n    LDI 1\n    ADD R2, R0\n`);
  assert.equal(lines(b3.source)[0], 'ADD R1, 3');
  const b4 = opt(`    LDI 0x0080\n    OR R1, R0\n    LDI 1\n    ADD R2, R0\n`);
  assert.equal(lines(b4.source)[0], 'OR R1, 7');
  const b5 = opt(`    LDI -2\n    AND R1, R0\n    LDI 1\n    ADD R2, R0\n`);
  assert.equal(lines(b5.source)[0], 'CLRB R1, 0');
});

test('B4 only folds a single-bit LDI pattern, not 0x4000 (which loads 0xC000)', () => {
  const src = `    LDI 0x4000\n    OR R1, R0\n    LDI 1\n    ADD R2, R0\n`;
  assert.equal(opt(src).stats.byRule.B4, undefined);
});

test('A1: MOV Rd,Rs ; SL Rd,1 becomes MOV Rd, Rs << 1', () => {
  const r = opt(`    MOV R2, R1\n    SL R2, 1\n    LDI 1\n    ADD R3, R0\n`);
  assert.equal(lines(r.source)[0], 'MOV R2, R1 << 1');
  assert.equal(r.stats.byRule.A1, 1);
});

test('A1 refuses when the flag the shift sets is still read', () => {
  const src = `    MOV R2, R1\n    SL R2, 1\n    JC there\n    NOP\nthere:\n    HLT\n`;
  assert.equal(opt(src).stats.byRule.A1, undefined);
  assert.ok(opt(src).source.includes('SL R2, 1'), 'the shift must survive because C is read');
});

test('A2: SL Rs,1 ; MOV Rd,Rs becomes MOV Rd, Rs << 1', () => {
  const r = opt(`    SL R1, 1\n    MOV R2, R1\n    LDI 1\n    ADD R3, R0\n`);
  assert.equal(lines(r.source)[0], 'MOV R2, R1 << 1');
  assert.equal(r.stats.byRule.A2, 1);
});

test('A3/A4: MOV then ADD folds onto the +2 and <<1 opcodes', () => {
  const a3 = opt(`    MOV R2, R1\n    ADD R2, 2\n    LDI 1\n    ADD R3, R0\n`);
  assert.equal(lines(a3.source)[0], 'MOV R2, R1 + 2');
  const a4 = opt(`    MOV R2, R1\n    ADD R2, R1\n    LDI 1\n    ADD R3, R0\n`);
  assert.equal(lines(a4.source)[0], 'MOV R2, R1 << 1');
});

test('A5: MOV Rd,Rs<<1 ; OR Rd,0 becomes the shift-or-1 opcode', () => {
  const r = opt(`    MOV R2, R1 << 1\n    OR R2, 0\n    LDI 1\n    ADD R3, R0\n`);
  assert.equal(lines(r.source)[0], 'MOV R2, R1 << 1 + 1');
  assert.equal(r.stats.byRule.A5, 1);
});

test('A6: LDI ; MOV Rd,R0 ; SL folds to one special-opcode MOV and keeps R0', () => {
  const r = opt(`    LDI 5\n    MOV R2, R0\n    SL R2, 1\n    ADD R9, R0\n`);
  assert.equal(lines(r.source)[0], 'LDI 5');
  assert.equal(lines(r.source)[1], 'MOV R2, R0 << 1');
  assert.equal(r.stats.byRule.A6, 1);
});

test('C2: MOV Rd,Rd is deleted', () => {
  const r = opt(`    MOV R0, R0\n    HLT\n`);
  assert.deepEqual(lines(r.source), ['HLT']);
});

test('stats.removed names the dropped words by original line', () => {
  const r = opt(`    LDI 2\n    MOV R2, R0\n    LDI 3\n    MOV R3, R0\n`);
  assert.ok(r.stats.removed.some(x => x.text === 'MOV R2, R0'), JSON.stringify(r.stats.removed));
  assert.ok(r.stats.removed.every(x => Number.isInteger(x.line) && x.line > 0));
});

// --------------------------------------------------------- safety guards

test('a delay slot is never deleted', () => {
  // C2 would drop MOV R1,R1, but it sits in the branch's delay slot.
  const r = opt(`    JZ there\n    MOV R1, R1\nthere:\n    HLT\n`);
  assert.ok(r.source.includes('MOV R1, R1'), 'the delay-slot word must stay');
});

test('a fusion never removes a delay-slot word', () => {
  // The SL is the delay slot of JZ, so MOV;SL cannot collapse.
  const r = opt(`    MOV R2, R1\n    JZ there\n    SL R2, 1\nthere:\n    HLT\n`);
  assert.ok(r.source.includes('SL R2, 1'), 'the slot instruction keeps its width');
});

test('a label on a deleted instruction survives', () => {
  const r = opt(`start:  MOV R0, R0\n    HLT\n`);
  assert.deepEqual(lines(r.source), ['start:', 'HLT']);
});

test('a rewritten instruction keeps its inline comment', () => {
  const r = opt(`    LDI 2 ; the two\n    MOV R1, R0\n    LDI 9\n    MOV R2, R0\n`);
  assert.equal(lines(r.source)[0], 'LSI R1, 2 ; the two');
});

test('copy propagation substitutes value operands', () => {
  // R2 holds the same value as R0, so storing R2 is storing R0.
  const r = opt(`    LDI 7\n    MOV R2, R0\n    ST R2, R11, 0\n    LDI 9\n    MOV R3, R0\n`);
  assert.ok(r.source.includes('ST R0, R11, 0'), r.source);
});

test('copy propagation never rewrites an LD/ST base register', () => {
  // The segment of a memory access is chosen by the base register NUMBER (see
  // isStackRegister / isExtraRegister in the core), so R2 and R0 are not
  // interchangeable as a base even when they hold the same value.
  const r = opt(`    LDI 0x1000\n    MOV R2, R0\n    LD R1, R2, 0\n    LDI 9\n    MOV R3, R0\n`);
  assert.ok(r.source.includes('LD R1, R2, 0'), 'the base must survive:\n' + r.source);
});

test('copy propagation does not cross a barrier (SWI)', () => {
  const r = opt(`    LDI 7\n    MOV R2, R0\n    SWI\n    ST R2, R11, 0\n`);
  assert.ok(r.source.includes('ST R2, R11, 0'), r.source);
});

test('copy propagation never treats PC as a copyable value', () => {
  // MOV R1, PC captures a position-dependent address; a later read of R1 must
  // not be rewritten into a fresh PC read.
  const r = opt(`    MOV R1, PC\n    MOV R2, R1\n    ADD R3, R2\n    ADD R9, R0\n`);
  assert.ok(!/\bADD R3, PC\b/.test(r.source), r.source);
  assert.ok(!/\bMOV R2, PC\b/.test(r.source), r.source);
});

test('DIV32 reads the pair it writes; MUL32 only writes it', () => {
  // DIV32 Rd, Rs divides the pair Rd:Rd+1 by Rs, so the store that fills the
  // low half is an input to the division. Modelling the pair as output-only
  // made it look like a dead store and dropped it, and the quotient was then
  // computed from whatever the register still held - Forth's number printer
  // turned 12 into 22 that way. MUL32 has no such input: Rd:Rd+1 is its
  // result, so the same store before a MUL32 really is dead.
  const div = opt(`    MOV R1, R2\n    DIV32 R0, R12\n    MOV R4, R1\n`);
  assert.ok(lines(div.source).some(l => /^MOV R1, R2$/.test(l)), div.source);
  const mul = opt(`    MOV R1, R2\n    MUL32 R0, R3\n    MOV R4, R0\n`);
  assert.ok(!lines(mul.source).some(l => /^MOV R1, R2$/.test(l)), mul.source);
});

// ------------------------------------------------- differential execution

// Assemble and run the same program with and without the optimizer; the JS
// core must land in the same state and not need more steps. cs=0 so the
// program at .org 0 is entered directly.
function diff(src, label) {
  const before = assemble(src);
  assert.equal(before.success, true, `${label} (original): ${before.errors.join('; ')}`);
  const optimized = optimize(src);
  const after = assemble(optimized.source);
  assert.equal(after.success, true, `${label} (optimized) does not assemble:\n${optimized.source}\n${after.errors.join('; ')}`);

  const a = runJs(before, { cs: 0x0000 });
  const b = runJs(after, { cs: 0x0000 });
  // R15 (PC) is excluded: fewer words means the halt lands at a lower address,
  // which is expected, not a behaviour change.
  for (let i = 0; i < 15; i++) {
    assert.equal(b.registers[i] & 0xFFFF, a.registers[i] & 0xFFFF,
      `${label}: R${i} differs (optimized ${b.registers[i]} vs original ${a.registers[i]})\n${optimized.source}`);
  }
  assert.equal(b.sim.psw & 0xFFFF, a.sim.psw & 0xFFFF, `${label}: PSW differs\n${optimized.source}`);
  assert.ok(b.steps <= a.steps, `${label}: optimized took ${b.steps} steps, original ${a.steps}`);
  return { before, after, optimized, steps: { before: a.steps, after: b.steps } };
}

// One program per rule family, all ending in HALT so the cores stop.
const RULES_PROGRAM = `
.org 0x0000
        LDI 5
        MOV R1, R0          ; R1 = 5
        MOV R2, R1
        SL  R2, 1           ; R2 = 10   A1
        MOV R3, R1
        ADD R3, 2           ; R3 = 7    A3
        MOV R4, R1
        ADD R4, R1          ; R4 = 10   A4
        MOV R5, R1 << 1
        OR  R5, 0           ; R5 = 11   A5
        LDI 9
        MOV R6, R0
        SL  R6, 1           ; R6 = 18   A6
        LDI 7
        CMP R3, R0          ; R3 - 7    B2 (sets Z)
        LDI 0x0080
        OR  R4, R0          ; R4 |= 0x80  B4
        LDI 1
        OR  R9, R0          ; R9 = 1
        LDI -2
        AND R8, R0          ; R8 &= ~1  B5
        LDI 3
        ADD R9, R0          ; B3
        LDI 0x1000
        MOV R10, R0
        LD  R11, R10, 0     ; copy-prop base; 0x1000 holds 0x00AB
        HALT
.org 0x1000
        .word 0x00AB
`;

test('differential: every rule family leaves the same machine state', () => {
  diff(RULES_PROGRAM, 'rules');
});

test('differential: flags set by a shift are honoured', () => {
  // SL R2,1 shifts a set bit 15 out, so C must reach JC. If A1 fired here and
  // dropped the shift's flag effect, the carry would be lost.
  const src = `
.org 0x0000
        LDI 0x4000          ; loads 0xC000
        MOV R1, R0
        MOV R2, R1
        SL  R2, 1           ; R2 = 0x8000, C = 1
        JC  carry
        NOP
        LDI 0
        MOV R3, R0
        HALT
carry:
        LDI 1
        MOV R3, R0
        HALT
`;
  const { optimized } = diff(src, 'carry');
  assert.ok(optimized.source.includes('SL  R2, 1') || optimized.source.includes('SL R2, 1'),
    'the shift carrying C must survive:\n' + optimized.source);
});

test('differential: a loop that counts down and stores keeps its result', () => {
  const src = `
.org 0x0000
        LDI 5
        MOV R1, R0          ; counter
        LDI 0
        MOV R2, R0          ; accumulator
loop:
        ADD R2, R1          ; acc += counter
        SUB R1, 1           ; counter -= 1
        LDI 0
        CMP R1, R0
        JNZ loop
        NOP
        HALT
`;
  diff(src, 'loop');
});

test('differential: WASM core agrees with JS on the optimized program', async () => {
  const res = assemble(optimize(RULES_PROGRAM).source);
  assert.equal(res.success, true, res.errors.join('; '));
  const js = runJs(res, { cs: 0x0000 });
  const wasm = await runWasm(res, { cs: 0x0000 });
  for (let i = 0; i < 15; i++) {
    assert.equal(wasm.registers[i] & 0xFFFF, js.registers[i] & 0xFFFF, `R${i}`);
  }
  assert.equal(wasm.psw & 0xFFFF, js.psw & 0xFFFF, 'PSW');
});

// ------------------------------------- the whole Forth kernel as oracle

const FORTH_SRC = fs.readFileSync(path.join(ROOT, 'asm', 'forth.asm'), 'utf8');

function replRows(res, input, maxSteps = 600000) {
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  const mem = new Array(1048576).fill(0xFFFF);
  for (const ch of res.memoryChanges) mem[ch.address] = ch.value & 0xFFFF;
  sim.loadProgram(mem);
  sim.segmentRegisters.CS = 0xFFFF;
  sim.segmentRegisters.DS = 0x0000;
  sim.segmentRegisters.SS = 0x0000;
  sim.segmentRegisters.ES = 0x0000;
  for (const ch of input) sim.enqueueKeyCode(ch === '\n' ? 10 : ch.charCodeAt(0));
  sim.running = true;
  let steps = 0;
  while (sim.running && steps < maxSteps) { sim.step(); steps++; }
  const rows = [];
  for (let r = 0; r < 25; r++) {
    let s = '';
    for (let c = 0; c < 80; c++) s += String.fromCharCode(sim.memory[SCREEN_ADDR + r * 80 + c] & 0xFF);
    rows.push(s.replace(/\s+$/, ''));
  }
  return { rows, steps };
}

test('forth.asm still assembles after optimization', () => {
  const optimized = optimize(FORTH_SRC);
  assert.ok(optimized.changed, 'the kernel should offer something to fold');
  const res = assemble(optimized.source);
  assert.equal(res.success, true, `optimized kernel does not assemble:\n${res.errors.join('\n')}`);
});

test('optimization preserves every label definition', () => {
  // A branch target or a jump-table entry is addressed by name, so a dropped
  // label is a quiet miscompile even when the program still assembles.
  const defs = s => new Set(s.split('\n')
    .map(l => (l.split(';')[0].trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/) || [])[1])
    .filter(Boolean));
  const before = defs(FORTH_SRC);
  const after = defs(optimize(FORTH_SRC).source);
  for (const name of before) assert.ok(after.has(name), `label ${name} was dropped`);
});

test('the optimized kernel drives the REPL exactly like the original', () => {
  const original = assemble(FORTH_SRC);
  const optimizedRes = assemble(optimize(FORTH_SRC).source);
  assert.equal(original.success, true, original.errors.join('; '));
  assert.equal(optimizedRes.success, true, optimizedRes.errors.join('\n'));

  const inputs = [
    '',
    '1 2 + .\n',
    '3 4 * . 10 2 / .\n',
    ': square dup * ;\n5 square .\n',
    '5 value v\n9 to v\nv .\n',
    ': t if 111 . then ; 1 t 0 t\n',
    ': cu 0 begin 1+ dup 5 = until ; cu .\n',
    ': fac dup 1 > if dup 1- recurse * then ; 5 fac .\n',
    'variable x drop\n7 x ! x @ .\n4 x +! x @ .\n',
    'create buf\nbuf here = .\n',
    ': const create , does> @ ;\n42 const answer\nanswer .\n',
    'nosuchword\n1 2 + .\n',
  ];
  for (const input of inputs) {
    const a = replRows(original, input);
    const b = replRows(optimizedRes, input);
    assert.deepEqual(b.rows, a.rows,
      `screen differs for input ${JSON.stringify(input)}\n--- original ---\n${a.rows.join('\n')}\n--- optimized ---\n${b.rows.join('\n')}`);
    assert.ok(b.steps <= a.steps, `optimized kernel used more steps for ${JSON.stringify(input)}`);
  }
});
