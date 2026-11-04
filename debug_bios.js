const fs = require('fs');
const Deep16Simulator = require('./js/deep16_simulator.js');

async function debugBios() {
    console.log("Debugging BIOS execution...");

    // Initialize Simulator
    const sim = new Deep16Simulator();
    sim.reset();

    // Load ROM
    console.log("Loading ROM...");
    const romBuffer = fs.readFileSync('deep16_rom.bin');
    if (!sim.loadBinaryROM(romBuffer)) {
        console.error("Failed to load ROM.");
        process.exit(1);
    }

    console.log("Starting BIOS execution from 0xFFFF0...");
    console.log("Initial PC:", sim.registers[15].toString(16));
    console.log("Initial CS:", sim.segmentRegisters.CS.toString(16));

    // Start the simulator
    sim.running = true;

    // Run for a limited number of steps to see where it gets stuck
    const MAX_STEPS = 1000;
    
    for (let i = 0; i < MAX_STEPS; i++) {
        const pcBefore = sim.registers[15];
        const csBefore = sim.segmentRegisters.CS;
        
        sim.step();
        
        const pcAfter = sim.registers[15];
        const csAfter = sim.segmentRegisters.CS;
        
        // Log every step to see execution flow
        console.log(`[${i}] PC: 0x${pcBefore.toString(16)} -> 0x${pcAfter.toString(16)}, CS: 0x${csAfter.toString(16)}`);
        
        // Check if we're stuck in a loop
        if (i > 10 && pcAfter === pcBefore && csAfter === csBefore) {
            console.log("STUCK IN INFINITE LOOP at PC:", pcAfter.toString(16));
            break;
        }
        
        // Check if we reached the trampoline code
        if (csAfter === 0xf800 && pcAfter >= 0x159 && pcAfter <= 0x172) {
            console.log("Entering copy loop at PC:", pcAfter.toString(16));
        }
        
        // Check if we successfully jumped to test program
        if (csAfter === 0x0000 && pcAfter === 0x0100) {
            console.log("SUCCESS: Jumped to test program at 0x0100");
            break;
        }
    }
    
    console.log("Debug completed.");
}

debugBios().catch(console.error);