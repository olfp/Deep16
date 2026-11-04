const fs = require('fs');
const path = require('path');
const Deep16Assembler = require('./js/deep16_assembler.js');

async function test() {
    console.log("Testing assembly of asm/forth.asm...");
    const assembler = new Deep16Assembler();
    const source = fs.readFileSync('asm/forth.asm', 'utf-8');
    const result = await assembler.assemble(source);
    
    if (result.success) {
        console.log("Forth assembly successful!");
    } else {
        console.error("Forth assembly failed:", result.errors);
    }
}

test();
