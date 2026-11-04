const fs = require('fs');
const Deep16Simulator = require('./js/deep16_simulator.js');

async function debugCopyLoop() {
    console.log("Debugging copy loop execution...");

    // Initialize Simulator
    const sim = new Deep16Simulator();
    
    // Load ROM
    console.log("Loading ROM...");
    const romBuffer = fs.readFileSync('deep16_rom.bin');
    if (!sim.loadBinaryROM(romBuffer)) {
        console.error("Failed to load ROM.");
        process.exit(1);
    }

    // Reset the simulator
    sim.reset();
    
    console.log("After reset:");
    console.log("  PC:", sim.registers[15].toString(16));
    console.log("  CS:", sim.segmentRegisters.CS.toString(16));
    
    // Start the simulator
    sim.running = true;
    
    // Execute until we reach the copy loop
    console.log("\nExecuting until copy loop...");
    let stepCount = 0;
    const MAX_STEPS = 100;
    
    while (stepCount < MAX_STEPS) {
        const pcBefore = sim.registers[15];
        const csBefore = sim.segmentRegisters.CS;
        
        sim.step();
        stepCount++;
        
        const pcAfter = sim.registers[15];
        const csAfter = sim.segmentRegisters.CS;
        
        // Check if we're in the copy loop
        if (csAfter === 0xf800 && pcAfter >= 0x159 && pcAfter <= 0x15e) {
            console.log(`[${stepCount}] PC: 0x${pcBefore.toString(16)} -> 0x${pcAfter.toString(16)}, CS: 0x${csAfter.toString(16)}`);
            
            // Log register values to debug the copy loop
            console.log("  R4 (source):", sim.registers[4].toString(16));
            console.log("  R5 (dest):", sim.registers[5].toString(16));
            console.log("  R6 (end addr):", sim.registers[6].toString(16));
            
            // Check if we're stuck in a loop
            if (stepCount > 50 && pcAfter === 0x159) {
                console.log("STUCK IN COPY LOOP at PC:", pcAfter.toString(16));
                break;
            }
        }
        
        // Check if we successfully completed the copy
        if (csAfter === 0xf800 && pcAfter === 0x172) {
            console.log("Copy loop completed successfully!");
            break;
        }
        
        // Safety break
        if (stepCount >= MAX_STEPS) {
            console.log("Reached maximum step count");
            break;
        }
    }
    
    console.log("Debug completed.");
}

debugCopyLoop();