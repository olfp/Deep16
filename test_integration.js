const fs = require('fs');
const path = require('path');

// Mock browser environment for modules that might need it
global.window = {};
global.document = {
    getElementById: () => ({ value: '' }),
    addEventListener: () => {},
};

// Load modules
const Deep16Assembler = require('./js/deep16_assembler.js');
const Deep16Simulator = require('./js/deep16_simulator.js'); // Assuming I can require this, or I might need to mock if it's not exported
// Note: Deep16Simulator might not be exported. I'll check.
// If not exported, I'll need to read and eval it or add export.
// I recall adding exports to deep16_disassembler.js, but maybe not simulator.

// Helper to load module
function loadModule(filename) {
    const content = fs.readFileSync(filename, 'utf8');
    // Basic hack to export the class if it's not a module
    if (!content.includes('module.exports')) {
        const className = path.basename(filename, '.js').replace(/_/g, '').replace('deep16', 'Deep16').replace('simulator', 'Simulator').replace('assembler', 'Assembler');
        // Actually the classes are Deep16Assembler, Deep16Simulator
        return new Function('window', 'document', content + `\nreturn Deep16${filename.includes('assembler') ? 'Assembler' : 'Simulator'};`)(global.window, global.document);
    }
    return require(filename);
}

async function runIntegrationTest() {
    console.log("Starting Integration Test...");

    // 1. Initialize Simulator
    // I need to check if Deep16Simulator.js has module.exports.
    // If not, I'll use the hack above.
    let SimulatorClass;
    try {
        SimulatorClass = require('./js/deep16_simulator.js');
    } catch (e) {
        // Fallback if not a node module
        SimulatorClass = loadModule('./js/deep16_simulator.js');
    }
    
    // Check if we got the class
    if (typeof SimulatorClass !== 'function') {
         // Maybe it didn't export correctly or I guessed the name wrong.
         // Let's assume for now I might need to fix exports.
         // I'll check file content first.
         console.log("Simulator class not found directly. Checking exports...");
    }

    // 2. Load ROM
    const romPath = 'deep16_rom.bin';
    if (!fs.existsSync(romPath)) {
        console.error(`ROM file ${romPath} not found! Run build_rom.js first.`);
        return;
    }
    const romBuffer = fs.readFileSync(romPath);
    // Parse ROM binary format (Version 2)
    // The simulator has loadBinaryROM or similar? 
    // In deep16_simulator.js, there is `loadROM(romData)`.
    // I need to parse the binary into the format expected by `romData`.
    // Actually, `deep16_ui_core.js` parses it? No, `deep16_simulator.js` has `loadBinaryROM`?
    // Let's check deep16_simulator.js for `loadBinaryROM`.
    // If it's not there (it might be in UI), I'll parse it here.
    
    const sim = new SimulatorClass();
    
    // Parse binary manually to be safe (logic from build_rom.js/ui_core)
    const segments = [];
    let offset = 15; // Skip header
    const versionMajor = romBuffer[10];
    const addrLen = (versionMajor >= 2) ? 4 : 2;
    const segmentCount = romBuffer[14];
    
    for (let i = 0; i < segmentCount; i++) {
        if (offset >= romBuffer.length) break;
        const type = romBuffer[offset++];
        let addr = 0;
        if (addrLen === 4) {
            addr = romBuffer.readUInt32BE(offset);
            offset += 4;
        } else {
            addr = romBuffer.readUInt16BE(offset);
            offset += 2;
        }
        const len = romBuffer.readUInt16BE(offset);
        offset += 2;
        
        const data = [];
        for (let j = 0; j < len; j++) {
            data.push(romBuffer.readUInt16BE(offset));
            offset += 2;
        }
        segments.push({ addr, data });
    }
    
    sim.romData = segments;
    sim.autoloadROM(); // Should load segments into memory
    
    // Verify ROM loaded
    console.log(`ROM loaded. Memory at 0xFFFF0: 0x${sim.memory[0xFFFF0].toString(16)} (Expected: 0x0)`);
    console.log(`Memory at 0xFFF0 (Reset Vector): 0x${sim.memory[0xFFF0].toString(16)} (Expected: JML R0 or NOP?)`);

    // 3. Assemble Forth
    let AssemblerClass;
    try {
        AssemblerClass = require('./js/deep16_assembler.js');
    } catch (e) {
        AssemblerClass = loadModule('./js/deep16_assembler.js');
    }
    const asm = new AssemblerClass();
    const forthSrc = fs.readFileSync('asm/forth.asm', 'utf8');
    // Assemble Forth (assemble handles preprocessing internally)
    const result = await asm.assemble(forthSrc);
    if (result.errors.length > 0) {
        console.error("Forth Assembly Failed:", result.errors);
        return;
    }
    console.log("Forth Assembled Successfully.");
    console.log("Listing length:", result.listing.length);
    if (result.listing.length > 0) {
        console.log("First listing line:", JSON.stringify(result.listing[0]));
        console.log("Last listing line:", JSON.stringify(result.listing[result.listing.length - 1]));
    }
    
    // Load Forth into Simulator
    let loadedCount = 0;
    
    // Prefer memoryChanges if available (Deep16Assembler convention)
    if (result.memoryChanges && result.memoryChanges.length > 0) {
        result.memoryChanges.forEach(change => {
            if (change.address < sim.memory.length) {
                sim.memory[change.address] = change.value;
                loadedCount++;
            }
        });
    } else {
        // Fallback to listing parsing
        result.listing.forEach(line => {
            if (line.address !== undefined) {
                let val = null;
                if (line.instruction !== undefined) val = line.instruction;
                else if (line.hex !== undefined) val = parseInt(line.hex, 16);
                
                if (val !== null && line.address < sim.memory.length) {
                    sim.memory[line.address] = val;
                    loadedCount++;
                }
            }
        });
    }

    console.log(`Loaded ${loadedCount} words of Forth code.`);
    console.log(`Memory at 0x0100 (Forth Start): 0x${sim.memory[0x0100].toString(16)}`);

    
    // 4. Run Simulation
    console.log("Starting Simulation...");
    
    // Set Reset State manually to match what happens on power-on with our ROM
    // The hardware reset usually starts at a specific vector. 
    // In Deep16, it seems we want to start at the startup ROM.
    // The startup ROM is at 0xFFFF0.
    // We should set CS=0xFFFF, PC=0xFFF0 (offset 0 from segment base 0xFFFF0? No. 0xFFFF0 is physical).
    // If CS=0xFFFF, base is 0xFFFF0. So PC=0x0000 -> 0xFFFF0.
    
    sim.segmentRegisters.CS = 0xFFFF;
    sim.registers[15] = 0xFFF0; // Start at 0xFFFF0 + 0xFFF0? No.
    // Wait. 0xFFFF0 physical.
    // If CS=0xFFFF, base is 0xFFFF0.
    // To reach physical 0xFFFF0, PC must be 0x0000.
    // To reach physical 0xFFFFF, PC must be 0x000F.
    // Let's check `deep16_ui_core.js` initialization.
    // `this.simulator.segmentRegisters.CS = 0xFFFF;`
    // And where does it start execution?
    // The simulator `step()` uses `(CS << 4) + PC`.
    // If CS=0xFFFF -> Base 0xFFFF0.
    // We want to execute code at 0xFFFF0. So PC should be 0.
    // BUT the fallback ROM in simulator has code at 0xFFFF0...
    // Let's check where the startup code is in `deep16_rom.asm`.
    // `.org 0xFFFF0`
    // In binary, it's a segment at 0xFFFF0.
    // So we should set PC=0.
    
    sim.registers[15] = 0x0000; 
    sim.running = true;
    
    // Run for some steps
    const MAX_STEPS = 1000;
    let hitForth = false;
    let hitBios = false;
    
    for (let i = 0; i < MAX_STEPS; i++) {
        const psw = sim.psw;
        const inShadow = (psw & (1 << 5)) !== 0;
        const pc = inShadow ? sim.shadowRegisters.PC : sim.registers[15];
        const cs = inShadow ? sim.shadowRegisters.CS : sim.segmentRegisters.CS;
        
        const phys = ((cs << 4) + pc) >>> 0;
        
        // Check if we reached Forth (0x0100 physical approx, CS=0)
        if (cs === 0x0000 && pc === 0x0100) {
            if (!hitForth) console.log(`[Step ${i}] Reached Forth Entry Point! (CS=0, PC=0x0100)`);
            hitForth = true;
        }

        // Check if we reached BIOS (CS=0xF800, PC=0x0000 => Phys 0xF8000)
        if (cs === 0xF800 && pc === 0x0000) {
            console.log(`[Step ${i}] Reached BIOS Entry Point! (CS=0xF800, PC=0x0000)`);
            hitBios = true;
            break; // Stop once we hit BIOS to verify we got there
        }
        
        sim.step();
        
        // if (i < 50 || (hitForth && i < 100)) {
        //      console.log(`[Step ${i}] CS=${cs.toString(16)} PC=${pc.toString(16)} Phys=${phys.toString(16)} Op=${sim.memory[phys]?.toString(16)}`);
        // }
    }
    
    if (hitForth) {
        console.log("SUCCESS: Reached Forth Entry.");
        if (hitBios) {
            console.log("SUCCESS: Reached BIOS via SWI.");
        } else {
            console.warn("WARNING: Did not reach BIOS within step limit.");
        }
    } else {
        console.error("FAILURE: Did not reach Forth entry point within step limit.");
    }
}

runIntegrationTest();
