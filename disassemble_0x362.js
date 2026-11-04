const fs = require('fs');
const Deep16Assembler = require('./js/deep16_assembler.js');
const Deep16Disassembler = require('./js/deep16_disassembler.js');

const asmSource = fs.readFileSync('./asm/forth.asm', 'utf8');
const assembler = new Deep16Assembler();
const result = assembler.assemble(asmSource);

if (result.errors && result.errors.length > 0) {
    console.error('Assembly errors:', result.errors);
    process.exit(1);
}

const memory = new Uint16Array(65536);
for (const change of result.memoryChanges) {
    memory[change.address] = change.value;
}

const disassembler = new Deep16Disassembler();
console.log('Disassembly around 0x362:');
for (let addr = 0x350; addr < 0x370; addr++) {
    const val = memory[addr];
    const disasm = disassembler.disassemble(val, addr);
    const prefix = addr === 0x362 ? '-> ' : '   ';
    console.log(`${prefix}0x${addr.toString(16)}: ${val.toString(16).padStart(4, '0')}  ${disasm}`);
}
