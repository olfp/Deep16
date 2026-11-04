
const Assembler = require('./js/deep16_assembler.js');
const asm = new Assembler();

(async () => {
try {
    const result = await asm.assemble('ST R0, R2, 0');
    if (asm.errors && asm.errors.length > 0) {
        console.log("Assembler Errors:", asm.errors);
    }
    // result is Uint8Array
    if (result.length >= 2) {
        const instruction = (result[0] << 8) | result[1];
        console.log(`ST R0, R2, 0 encoded as: 0x${instruction.toString(16)}`);
        
        if (instruction === 0xA040) {
            console.log("Encoding matches 0xA040 (Correct).");
        } else {
            console.log("Encoding mismatch!");
        }
    } else {
        console.log("Result too short:", result);
    }

    const result2 = await asm.assemble('ST R0, R1, 0');
    if (result2.length >= 2) {
        const instruction2 = (result2[0] << 8) | result2[1];
        console.log(`ST R0, R1, 0 encoded as: 0x${instruction2.toString(16)}`);
    }
    
} catch (e) {
    console.error(e);
}
})();
