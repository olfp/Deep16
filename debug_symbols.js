
const fs = require('fs');
const Deep16Assembler = require('./js/deep16_assembler.js');

async function debugSymbols() {
    const asm = new Deep16Assembler();
    const source = fs.readFileSync('asm/deep16bios.asm', 'utf8');
    const result = await asm.assemble(source);
    console.log("Result keys:", Object.keys(result));
    if (result.errors && result.errors.length) console.log("Errors:", result.errors);


    console.log("Symbols:");
    for (const [label, addr] of Object.entries(result.symbols)) {
        console.log(`  ${label}: 0x${addr.toString(16)}`);
    }
}

debugSymbols();
