// Flag semantics (Deep16-Arch.md Table 6: ADD/SUB/CMP = NZVC, logic group =
// NZ00): both cores must produce the same PSW, and the documented cases must
// match the spec. The PSW is preset to 0x000F (all four status flags set) so
// every case shows which bits an instruction sets, clears or preserves.
//
// This locks in four fixes:
//  - the JS core set V on any carry/borrow instead of on signed overflow only
//    (its "simplified" heuristic could never see a real overflow either),
//  - the WASM core did not update the flags for LSI at all, and
//  - both cores lost the shift/rotate carry-out (spec Table 7): the op wrote
//    it into the PSW, where updatePSWFlags wiped it again.
//  - the assembler encoded the SET/CLR flag aliases (SETZ, CLRC, ...) into the
//    SOP range (0xFFA0/0xFFB0), where both cores decode INV/NEG/SPSW/LPSW -
//    SETZ assembled to SPSW R1 and clobbered the whole PSW (spec Table 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, loadBrowserScripts, buildMemory, loadWasm, rawProgram, enc, MEM_WORDS } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');
const wasm = await loadWasm();

const PRESET_PSW = 0x000F;
const N = 1, Z = 2, V = 4, C = 8;

// [label, asm, R1 preloaded, R2 preloaded, expected PSW low nibble or null]
// null = core-equality only (spec is silent or the cores share a known gap,
// see the comment on the shift block below).
const CASES = [
  // Data movement: N/Z from the loaded value, V/C cleared - LDI and LSI alike.
  ['LDI positive',       'LDI 0x1234', 0, 0, 0],
  ['LDI negative',       'LDI -1', 0, 0, N],
  ['LDI zero',           'LDI 0', 0, 0, Z],
  ['LSI positive',       'LSI R1, 4', 0, 0, 0],
  ['LSI negative',       'LSI R1, -3', 0, 0, N],
  ['LSI zero',           'LSI R1, 0', 0, 0, Z],
  ['MOV from register',  'MOV R1, R2', 0x1111, 0x8000, N],
  // Memory leaves the flags alone (the preset survives).
  ['LD leaves flags',    'LD R1, R2, 0', 0, 0x0100, PRESET_PSW],
  ['ST leaves flags',    'ST R1, R2, 0', 0xBEEF, 0x0100, PRESET_PSW],
  // ADD/SUB/CMP: NZVC with V = signed overflow.
  ['ADD without overflow', 'ADD R1, R2', 0x1234, 0x0111, 0],
  ['ADD signed overflow',  'ADD R1, R2', 0x7FFF, 0x0001, N | V],
  ['ADD carry only',       'ADD R1, R2', 0xFFFF, 0x0001, Z | C],
  ['ADD negative imm',     'ADD R1, 1', 0xFFFF, 0, Z | C],
  ['SUB without overflow', 'SUB R1, R2', 0x1234, 0x0002, 0],
  ['SUB signed overflow',  'SUB R1, R2', 0x8000, 0x0001, V],
  ['SUB borrow only',      'SUB R1, R2', 0x0000, 0x0001, N | C],
  ['CMP overflow',         'CMP R1, R2', 0x7FFF, 0xFFFF, N | V | C],
  // Logic group: NZ00 - V and C are cleared, never set.
  ['AND negative result', 'AND R1, R2', 0x8001, 0xFFFF, N],
  ['AND zero result',     'AND R1, R2', 0x8001, 0x0000, Z],
  ['OR negative result',  'OR R1, R2', 0x8001, 0x0001, N],
  ['XOR zero result',     'XOR R1, R2', 0x8001, 0x8001, Z],
  ['CLRB bit 0',          'CLRB R1, 0', 0x8001, 0, N],
  ['TBC operand R0 clear', 'TBC R1, 0', 0x8001, 0, Z],
  ['TBS operand R0 clear', 'TBS R1, 0', 0x8001, 0, 0],
  // PSW bit operations (spec Table 4): [11111111110][d1][imm4]. The old
  // alias encoding (0xFFA0/0xFFB0) decoded as SPSW/LPSW instead - SET rows
  // preset the PSW to 0, because 0x000F already has all four flags set.
  ['CLRZ clears Z',       'CLRZ', 0, 0, N | V | C],
  ['CLRN clears N',       'CLRN', 0, 0, Z | V | C],
  ['CLRV clears V',       'CLRV', 0, 0, N | Z | C],
  ['CLRC clears C',       'CLRC', 0, 0, N | Z | V],
  ['CLR 1 equals CLRZ',   'CLR 1', 0, 0, N | V | C],
  ['SETZ sets Z',         'SETZ', 0, 0, Z, 0],
  ['SETN sets N',         'SETN', 0, 0, N, 0],
  ['SETV sets V',         'SETV', 0, 0, V, 0],
  ['SETC sets C',         'SETC', 0, 0, C, 0],
  ['SET 1 equals SETZ',   'SET 1', 0, 0, Z, 0],
  // Misaligned MUL32: shared error-path flags of both cores (N from 0xFFFF,
  // C from the -1/0xFFFFFFFF result, V clear). The assembler refuses odd
  // destination registers, so this word is injected raw - as a user could in
  // the memory panel.
  ['MUL32 misaligned Rd', enc.MUL32(1, 2), 0x0100, 0x0100, N | C],
  // Shifts/rotates: spec Table 7 - C = the bit shifted out (left ops: original
  // bit 16-count, right ops: original bit count-1), and C stays unchanged when
  // count is 0. The cores used to write that carry into the PSW inside the op,
  // where updatePSWFlags wiped it again - so C was always 0 after a shift.
  ['SL carry out',        'SL R1, 1', 0x8000, 0, Z | C],
  ['SL carry clear',      'SL R1, 1', 0x1234, 0, 0],
  ['SLA carry out',       'SLA R1, 2', 0x4001, 0, C],
  ['SLAC carry out',      'SLAC R1, 2', 0x4001, 0, C],
  ['SLC carry out',       'SLC R1, 1', 0x8000, 0, C],
  ['SR carry out',        'SR R1, 1', 0x0001, 0, Z | C],
  ['SRC carry out',       'SRC R1, 1', 0x0001, 0, C],
  ['SRA carry out',       'SRA R1, 1', 0x0001, 0, Z | C],
  ['SRAC carry out',      'SRAC R1, 1', 0x0001, 0, C],
  ['ROL carry out',       'ROL R1, 1', 0x8001, 0, C],
  ['RLC carry out',       'RLC R1, 1', 0x8001, 0, C],
  ['ROR carry out',       'ROR R1, 1', 0x0001, 0, N | C],
  ['RRC carry out',       'RRC R1, 1', 0x0001, 0, N | C],
  ['SL count 0 keeps C',  'SL R1, 0', 0xC001, 0, N | C],
  ['RRC count 0 keeps C', 'RRC R1, 0', 0x0001, 0, C],
  // The remaining ALU ops keep an equality-only row: the spec is silent on
  // their flag details, so only the agreement of the cores is asserted.
  ['NEG',                 'NEG R1', 0x0001, 0, null],
  ['NEG overflow value',  'NEG R1', 0x8000, 0, null],
  ['INV',                 'INV R1', 0x00FF, 0, null],
  ['MUL',                 'MUL R1, R2', 0x0100, 0x0100, null],
  ['DIV',                 'DIV R1, R2', 0x00FF, 0x0010, null],
];

// A case's `asm` is either assembly text or a raw instruction word.
function buildProgram(asm) {
  if (typeof asm === 'number') return rawProgram([asm, enc.HLT]);
  const prog = assemble(`.org 0x0000\n ${asm}\n HALT\n`);
  assert.equal(prog.success, true, prog.errors.join('; '));
  return prog;
}

function runJs(asm, r1, r2, preset) {
  const prog = buildProgram(asm);
  const sim = new globalThis.Deep16Simulator();
  sim.loadProgram(buildMemory(prog));
  Object.assign(sim.segmentRegisters, { CS: 0, DS: 0, SS: 0, ES: 0 });
  sim.registers.fill(0);
  sim.registers[1] = r1;
  sim.registers[2] = r2;
  sim.psw = preset;
  sim.running = true;
  sim.step();
  return sim.psw & 0xFFFF;
}

function runWasm(asm, r1, r2, preset) {
  const prog = buildProgram(asm);
  wasm.init(MEM_WORDS);
  for (const ch of prog.memoryChanges) {
    wasm.load_program(ch.address, new Uint16Array([ch.value & 0xFFFF]));
  }
  wasm.set_segments(0, 0, 0, 0);
  wasm.set_psw(preset);
  wasm.set_registers(new Uint16Array([0, r1, r2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x7FFF, 0, 0]));
  wasm.step();
  return wasm.get_psw() & 0xFFFF;
}

for (const [label, asm, r1, r2, expected, preset = PRESET_PSW] of CASES) {
  test(`flags: ${label}`, () => {
    const jsPsw = runJs(asm, r1, r2, preset);
    const wasmPsw = runWasm(asm, r1, r2, preset);
    assert.equal(jsPsw, wasmPsw,
      `cores diverge: JS=0x${jsPsw.toString(16)} WASM=0x${wasmPsw.toString(16)}`);
    if (expected !== null) {
      assert.equal(jsPsw & 0xF, expected,
        `expected ${expected.toString(2).padStart(4, '0')} (NZVC), got 0x${jsPsw.toString(16)}`);
    }
  });
}

// SETI/CLRI (spec Table 5, SYS ops) and SETS/CLRS (= SET/CLR 5, spec 5.3)
// live outside the low nibble, so they get full-PSW assertions of their own.
test('flags: SETI/CLRI toggle I (bit 4)', () => {
  const onJs = runJs('SETI', 0, 0, 0);
  const onWasm = runWasm('SETI', 0, 0, 0);
  assert.equal(onJs, onWasm,
    `cores diverge: JS=0x${onJs.toString(16)} WASM=0x${onWasm.toString(16)}`);
  assert.equal(onJs & 0x10, 0x10, `SETI did not set I (psw=0x${onJs.toString(16)})`);

  const offJs = runJs('CLRI', 0, 0, 0x10);
  const offWasm = runWasm('CLRI', 0, 0, 0x10);
  assert.equal(offJs, offWasm,
    `cores diverge: JS=0x${offJs.toString(16)} WASM=0x${offWasm.toString(16)}`);
  assert.equal(offJs & 0x10, 0, `CLRI did not clear I (psw=0x${offJs.toString(16)})`);
});

test('flags: SETS/CLRS toggle S (bit 5)', () => {
  const onJs = runJs('SETS', 0, 0, 0);
  const onWasm = runWasm('SETS', 0, 0, 0);
  assert.equal(onJs, onWasm,
    `cores diverge: JS=0x${onJs.toString(16)} WASM=0x${onWasm.toString(16)}`);
  assert.equal(onJs & 0x20, 0x20, `SETS did not set S (psw=0x${onJs.toString(16)})`);

  const offJs = runJs('CLRS', 0, 0, 0x20);
  const offWasm = runWasm('CLRS', 0, 0, 0x20);
  assert.equal(offJs, offWasm,
    `cores diverge: JS=0x${offJs.toString(16)} WASM=0x${offWasm.toString(16)}`);
  assert.equal(offJs & 0x20, 0, `CLRS did not clear S (psw=0x${offJs.toString(16)})`);
});

// A label may carry a trailing comment - that used to be parsed as an
// instruction ("Unknown instruction: LOOP:"), which no listing should hit.
test('assembler: label with trailing comment', () => {
  const prog = assemble('.org 0x0100\nloop: ; Schleifenanfang\n HALT\n');
  assert.equal(prog.success, true, prog.errors.join('; '));
  assert.equal(prog.symbols.loop, 0x0100);
});
