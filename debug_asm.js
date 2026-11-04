const fs = require('fs');
const Deep16Assembler = require('./js/deep16_assembler.js');

async function run() {
    const asm = new Deep16Assembler();
    const source = fs.readFileSync('test_asm.asm', 'utf8');
    const result = await asm.assemble(source);
    
    if (result.errors && result.errors.length > 0) {
        console.error(result.errors);
        return;
    }
    
    console.log("Memory Changes:");
    if (result.memoryChanges) {
        // Handle Map or Array
        const changes = Array.isArray(result.memoryChanges) ? result.memoryChanges : Array.from(result.memoryChanges);
        for (const item of changes) {
            // item is {address, value, segment} or [address, value]
            let addr, val;
            if (Array.isArray(item)) { addr = item[0]; val = item[1]; }
            else { addr = item.address; val = item.value; }
            
            console.log(`0x${addr.toString(16)}: 0x${val.toString(16)}`);
        }
    }
}
run();
