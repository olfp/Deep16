// SMV write forms and the APSW selector move.
//
// Reads keep their old encodings: SMV Rx, AR0..AR3 is alt_sel 1000..1011 and
// SMV Rx, APSW moved from 0100 to 1100. The freed 0100..0111 codes are the
// write form SMV ARy, Rx: it stores the *active* Rx into the *inactive* bank's
// R[y], which is what an ILL handler needs to write the interrupted context's
// R0..R3 (spec 3.3/4.4/4.8).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemble, buildMemory, loadBrowserScripts, runJs, runWasm,
} from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_disassembler.js', 'js/deep16_simulator.js');

const dis = new globalThis.Deep16Disassembler();

function word(source) {
  const res = assemble(source);
  assert.equal(res.success, true, `${source.trim()}: ${res.errors.join('; ')}`);
  return res.memoryChanges[0].value & 0xFFFF;
}

test('SMV encodings: reads keep 1000..1011, APSW moves to 1100, writes use 0100..0111', () => {
  assert.equal(word('SMV R2, AR0\n'), 0xFE28);
  assert.equal(word('SMV R2, AR3\n'), 0xFE2B);
  assert.equal(word('SMV R1, APSW\n'), 0xFE1C);
  assert.equal(word('SMV R0, APSW\n'), 0xFE0C);
  assert.equal(word('SMV AR0, R1\n'), 0xFE14);
  assert.equal(word('SMV AR3, R7\n'), 0xFE77);
  assert.equal(word('SMV AR0, R0\n'), 0xFE04);
  assert.equal(word('SMV R14, APC\n'), 0xFEEF);
  assert.equal(word('ALNK LR\n'), 0xFEEF);
});

test('SMV write/read forms round-trip through the disassembler', () => {
  const words = [0xFE28, 0xFE2B, 0xFE1C, 0xFE0C, 0xFE14, 0xFE77, 0xFE04, 0xFEEF];
  for (const w of words) {
    const text = dis.disassemble(w);
    const back = assemble(`${text}\n`);
    assert.equal(back.success, true, `0x${w.toString(16)} -> ${text}: ${back.errors}`);
    assert.equal(back.memoryChanges[0].value & 0xFFFF, w, text);
  }
  assert.equal(dis.disassemble(0xFE14), 'SMV AR0, R1');
  assert.equal(dis.disassemble(0xFE1C), 'SMV R1, APSW');
});

// The active bank is the shadow while PSW.S=1. The write form stores into the
// *inactive* bank:
//   in the shadow  -> the caller's normal R0
//   in the normal  -> the shadow R0 (read back later with the read form)
const BANK_PROGRAM = `
.org 0x0000
        LDI  0x0020
        SPSW R0             ; enter the shadow bank
        LDI  0x1234
        SMV  AR0, R0        ; caller's normal R0 = 0x1234
        RETI                ; back to the normal bank
        LDI  0x1678
        SMV  AR1, R0        ; shadow R1 = 0x1678 (normal view)
        SMV  R1, AR0        ; normal view reads the shadow R0
        SMV  R2, AR1        ; normal view reads the shadow R1
        HALT
`;

test('SMV writes target the inactive bank on JS and WASM', async () => {
  const res = assemble(BANK_PROGRAM);
  assert.equal(res.success, true, res.errors.join('; '));
  const js = runJs(res, { cs: 0x0000 });
  const wasm = await runWasm(res, { cs: 0x0000 });
  for (const [name, r] of [['JS', js], ['WASM', wasm]]) {
    assert.equal(r.registers[0] & 0xFFFF, 0x1678, `${name}: R0`);
    assert.equal(r.registers[1] & 0xFFFF, 0x1234, `${name}: R1 = shadow R0`);
    assert.equal(r.registers[2] & 0xFFFF, 0x1678, `${name}: R2 = shadow R1`);
  }
});

test('SMV Rx, APSW reads the parked PSW at the moved selector', () => {
  const res = assemble('.org 0x0000\nSMV R3, APSW\nHALT\n');
  assert.equal(res.success, true, res.errors.join('; '));
  const { Deep16Simulator } = globalThis;
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res));
  sim.segmentRegisters.CS = 0x0000;
  sim.shadowRegisters.PSW = 0xBEEF;
  sim.psw = 0x0020;                    // active bank = shadow
  sim.running = true;
  sim.step();
  assert.equal(sim.shadowRegisters.R3, 0xBEEF);
});
