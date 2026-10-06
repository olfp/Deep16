// The IDE drives the WASM core through init/load_program/set_segments/
// set_psw/set_registers to mirror the JS core's state (syncStateIntoWasm in
// js/deep16_ui_core.js). These tests pin down that contract: the setters must
// establish an execution state that resumes exactly where the JS core is,
// instead of the boot entry load_program() leaves behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, loadBrowserScripts, loadWasm, MEM_WORDS } from './helpers.js';

loadBrowserScripts('js/deep16_assembler.js', 'js/deep16_simulator.js');

test('mirrored state resumes execution at the mirrored PC', async () => {
  const res = assemble(`
        .org 0x0100
        LDI 0x1234
        HALT
`);
  assert.ok(res.success, res.errors.join('; '));
  const w = await loadWasm();
  w.init(MEM_WORDS);
  for (const ch of res.memoryChanges) {
    w.load_program(ch.address, new Uint16Array([ch.value & 0xFFFF]));
  }
  // The state the UI mirrors from the JS core: CS=0 (post-boot), program
  // entry parked at 0x0100, live registers. load_program() would leave
  // CS=0xFFFF/PC=0, which starts the boot ROM instead of the program.
  w.set_segments(0x0000, 0x0000, 0x0000, 0x0000);
  w.set_psw(0x0000);
  const regs = new Uint16Array(16);
  regs[5] = 0xABCD;   // must survive the mirror untouched
  regs[15] = 0x0100;
  w.set_registers(regs);

  let steps = 0;
  let cont = true;
  while (cont && steps < 1000) { cont = w.step(); steps++; }

  const out = Array.from(w.get_registers());
  assert.equal(out[0], 0x1234, 'program executed from the mirrored PC');
  assert.equal(out[5], 0xABCD, 'mirrored registers survive execution');
});

test('set_registers round-trips the active PC through PSW.S', async () => {
  const w = await loadWasm();
  w.init(MEM_WORDS);
  const regs = new Uint16Array(16);
  regs[3] = 0x1111;

  // Shadow set active: get_registers reports the shadow PC in element 15,
  // so set_registers must place its element 15 there too, and leave the
  // saved user PC - which the JS core cannot see - untouched.
  w.set_psw(1 << 5);
  regs[15] = 0x1234;
  w.set_registers(regs);
  let out = Array.from(w.get_registers());
  assert.equal(out[3], 0x1111, 'general register mirrors while S=1');
  assert.equal(out[15], 0x1234, 'shadow PC round-trips while S=1');

  w.set_psw(0x0000);
  out = Array.from(w.get_registers());
  assert.equal(out[15], 0x0000, 'saved user PC was not clobbered');

  // With S=0 element 15 is plain R15 again.
  regs[15] = 0x4321;
  w.set_registers(regs);
  out = Array.from(w.get_registers());
  assert.equal(out[15], 0x4321, 'R15 mirrors while S=0');
});
