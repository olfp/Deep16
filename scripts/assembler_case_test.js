import fs from 'fs';
import vm from 'node:vm';
global.window = {};

vm.runInThisContext(fs.readFileSync('./js/deep16_assembler.js','utf8'));

const asm = new Deep16Assembler();

const programBase = `
.org 0x0000
main:
  ldi 0x0100
  mov r4, r0
  st  r1, r4, 0
  add r4, 1
  ST  R2, R4, 0
  Add R4, 1
  sT  r3, r4, 0
  HALT
.org 0x0200
res:
  .word 0
`;

const variants = [
  programBase,
  programBase.toUpperCase(),
  programBase.toLowerCase(),
];

let baseChanges = null;
for (let i = 0; i < variants.length; i++) {
  const res = asm.assemble(variants[i]);
  if (!res.success) {
    console.error('Assembly failed for variant', i, res.errors);
    process.exit(1);
  }
  const changes = res.memoryChanges.map(c => ({a:c.address, v:(c.value & 0xFFFF)}));
  if (!baseChanges) {
    baseChanges = changes;
  } else {
    const same = baseChanges.length === changes.length && baseChanges.every((c, idx) => c.a === changes[idx].a && c.v === changes[idx].v);
    if (!same) {
      console.error('Case-insensitivity test FAILED: variant differs at index', i);
      process.exit(1);
    }
  }
}

console.log('Assembler case-insensitivity test PASSED (upper/lower/mixed)');
