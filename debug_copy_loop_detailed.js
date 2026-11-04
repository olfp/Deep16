const fs = require('fs');
const Deep16Assembler = require('./js/deep16_assembler.js');
const Deep16Simulator = require('./js/deep16_simulator.js');

async function debugCopyLoop() {
    console.log("Debugging copy loop execution in detail...");
    
    // Load ROM
    console.log("Loading ROM...");
    const sim = new Deep16Simulator();
    sim.autoloadROM();
    
    // Reset simulator
    sim.reset();
    console.log("After reset:");
    console.log("  PC:", sim.registers[15].toString(16));
    console.log("  CS:", sim.segmentRegisters.CS.toString(16));
    
    console.log("\nExecuting until copy loop...");
    
    let stepCount = 0;
    const MAX_STEPS = 100;
    let inCopyLoop = false;
    
    while (stepCount < MAX_STEPS && !sim.halted) {
        const pcBefore = sim.registers[15];
        const csBefore = sim.segmentRegisters.CS;
        
        try {
            sim.step();
        } catch (e) {
            console.log("Error at step", stepCount, ":", e.message);
            break;
        }
        
        const pcAfter = sim.registers[15];
        const csAfter = sim.segmentRegisters.CS;
        
        // Check if we're in the copy loop (0xf8156 - 0xf815c)
        if (csAfter === 0xf800 && pcAfter >= 0x156 && pcAfter <= 0x15c) {
            if (!inCopyLoop) {
                console.log("\nENTERING COPY LOOP:");
                inCopyLoop = true;
            }
            
            console.log(`[${stepCount}] PC: 0x${pcBefore.toString(16)} -> 0x${pcAfter.toString(16)}, CS: 0x${csAfter.toString(16)}`);
            
            // Log detailed register values
            console.log("  R4 (source):", sim.registers[4].toString(16));
            console.log("  R5 (dest):", sim.registers[5].toString(16));
            console.log("  R12 (count):", sim.registers[12].toString(16));
            
            // Log memory being read/written
            const sourceAddr = (0xf8000 + sim.registers[4]) >>> 0;
            const destAddr = sim.registers[5];
            const sourceVal = sim.memory[sourceAddr];
            const destVal = sim.memory[destAddr];
            
            console.log("  Reading from 0x" + sourceAddr.toString(16) + ": 0x" + sourceVal.toString(16));
            console.log("  Writing to 0x" + destAddr.toString(16) + ": 0x" + destVal.toString(16));
            
            // Check if we're stuck in a loop
            if (stepCount > 50 && pcAfter === 0x159) {
                console.log("STUCK IN COPY LOOP at PC:", pcAfter.toString(16));
                console.log("  R4:", sim.registers[4].toString(16));
                console.log("  R5:", sim.registers[5].toString(16));
                console.log("  R12:", sim.registers[12].toString(16));
                
                // Check what's at the trampoline source
                console.log("\nTrampoline source memory (0xf8166 - 0xf816f):");
                for (let i = 0; i < 9; i++) {
                    const addr = 0xf8166 + i;
                    console.log("  0x" + addr.toString(16) + ": 0x" + sim.memory[addr].toString(16));
                }
                
                // Check what's being copied to destination
                console.log("\nDestination memory (0x0080 - 0x0088):");
                for (let i = 0; i < 9; i++) {
                    const addr = 0x0080 + i;
                    console.log("  0x" + addr.toString(16) + ": 0x" + sim.memory[addr].toString(16));
                }
                
                break;
            }
        }
        
        stepCount++;
    }
    
    console.log("\nDebug completed.");
}

debugCopyLoop().catch(console.error);