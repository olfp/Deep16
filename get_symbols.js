const fs = require('fs');
const Deep16Assembler = require('./js/deep16_assembler.js');

async function main() {
    const romSource = fs.readFileSync('asm/deep16bios.asm', 'utf8');
    const assembler = new Deep16Assembler();
    const result = await assembler.assemble(romSource);
    
    if (result.errors && result.errors.length > 0) {
        console.error("Errors:", result.errors);
        return;
    }
    
    if (result.symbols) {
        console.log("BIOS Symbols:");
        // Check if symbols is a Map or Object
        const entries = result.symbols instanceof Map ? result.symbols.entries() : Object.entries(result.symbols);
        for (const [label, addr] of entries) {
            console.log(`${label}: 0x${addr.toString(16)}`);
        }
    } else {
        console.log("No labels found. Result keys:", Object.keys(result));
    }
}

main();
