const fs = require('fs');
const Deep16Simulator = require('./js/deep16_simulator.js');

function testStartup() {
    console.log("Testing startup sequence...");

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
    console.log("  Physical address:", sim.phys(sim.segmentRegisters.CS, sim.registers[15]).toString(16));
    
    // Check what instruction is at the startup address
    const startupAddr = sim.phys(sim.segmentRegisters.CS, sim.registers[15]);
    const startupInstruction = sim.memory[startupAddr];
    console.log("Startup instruction at", startupAddr.toString(16), ":", startupInstruction.toString(16));
    
    // Start the simulator
    sim.running = true;
    
    // Execute a few steps to see the startup sequence
    console.log("\nExecuting startup sequence...");
    for (let i = 0; i < 10; i++) {
        const pcBefore = sim.registers[15];
        const csBefore = sim.segmentRegisters.CS;
        
        sim.step();
        
        const pcAfter = sim.registers[15];
        const csAfter = sim.segmentRegisters.CS;
        
        console.log(`[${i}] PC: 0x${pcBefore.toString(16)} -> 0x${pcAfter.toString(16)}, CS: 0x${csAfter.toString(16)}`);
        
        // Check if we jumped to BIOS
        if (csAfter === 0xf800) {
            console.log("Successfully jumped to BIOS!");
            break;
        }
    }
}

testStartup();