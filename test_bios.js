const fs = require('fs');
const Deep16Assembler = require('./js/deep16_assembler.js');
const Deep16Simulator = require('./js/deep16_simulator.js');

// Helper to delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting BIOS Integration Test...");

    // 1. Initialize Simulator
    const sim = new Deep16Simulator();
    sim.reset();

    // 2. Load ROM (BIOS + Startup)
    console.log("Loading ROM...");
    if (!fs.existsSync('deep16_rom.bin')) {
        console.error("Error: deep16_rom.bin not found. Please run 'node build_rom.js' first.");
        process.exit(1);
    }
    const romBuffer = fs.readFileSync('deep16_rom.bin');
    if (!sim.loadBinaryROM(romBuffer)) {
        console.error("Failed to load ROM.");
        process.exit(1);
    }
    
    // Verify Startup ROM presence
    const startupWord = sim.memory[0xFFFF0];
    console.log(`Memory at 0xFFFF0: 0x${startupWord.toString(16)} (Expected: 0xfff)`);

    // Dump BIOS Symbols (Auxiliary)
    try {
        if (fs.existsSync('asm/bios.asm')) {
            console.log("Assembling BIOS for symbols...");
            const romSource = fs.readFileSync('asm/bios.asm', 'utf8');
            const biosAssembler = new Deep16Assembler();
            const romResult = await biosAssembler.assemble(romSource);
            
            console.log("BIOS Symbols:");
            const importantLabels = ['bios_entry', 'bios_getstr_loop', 'bios_getstr_done', 'bios_putstr_loop', 'bios_putstr_done', 'bios_putch_core', 'bios_back_low'];
            if (romResult.labels) {
                for (const [label, addr] of Object.entries(romResult.labels)) {
                    if (importantLabels.includes(label)) {
                        console.log(`  ${label}: 0x${addr.toString(16)}`);
                    }
                }
            }
        }
    } catch (e) {
        console.log("Symbol loading skipped: " + e.message);
    }

    // 3. Assemble and Load BIOS Test Program
    console.log("Assembling BIOS Test Suite...");
    const asm = new Deep16Assembler();
    const source = fs.readFileSync('asm/bios_test.asm', 'utf8');
    
    // Use assemble() which handles preprocessing (includes) and 2-pass assembly
    const assemblyResult = await asm.assemble(source);
    
    // Check for errors (array or single object)
    if (assemblyResult.errors && assemblyResult.errors.length > 0) {
        console.error("Assembly failed:", assemblyResult.errors);
        process.exit(1);
    } else if (assemblyResult.error) {
        console.error("Assembly failed:", assemblyResult.error);
        process.exit(1);
    }
    
    // Validate object code existence
    // Note: assembler uses 'memoryChanges' for output, not 'objectCode' in recent versions
    if (!assemblyResult.memoryChanges && !assemblyResult.objectCode) {
        console.error("Assembly produced no object code. Result keys:", Object.keys(assemblyResult));
        process.exit(1);
    }
    
    let codeSize = 0;
    if (assemblyResult.objectCode) {
        codeSize = assemblyResult.objectCode.length;
    } else if (assemblyResult.memoryChanges) {
        if (Array.isArray(assemblyResult.memoryChanges)) {
            codeSize = assemblyResult.memoryChanges.length;
        } else if (assemblyResult.memoryChanges instanceof Map) {
            codeSize = assemblyResult.memoryChanges.size;
        } else {
             // fallback for array-like object
             codeSize = Object.keys(assemblyResult.memoryChanges).length;
        }
    }

    console.log("BIOS Test Suite Assembled Successfully.");
    console.log(`Loaded ${codeSize} words of code.`);
    
    // Inspect specific instructions if needed
    // LDI greeting is at offset around 54
    // Find "greeting" address
    // We can't easily query label map here as it's not returned in simple result
    // But we can trace execution.

    // Apply memory changes from assembler
    if (assemblyResult.memoryChanges) {
        // memoryChanges is an array of objects {address, value, segment} in current version
        if (Array.isArray(assemblyResult.memoryChanges)) {
            for (const change of assemblyResult.memoryChanges) {
                if (change.address < sim.memory.length) {
                    sim.memory[change.address] = change.value;
                }
            }
        } else {
            // Map fallback
            for (const [addr, val] of assemblyResult.memoryChanges) {
                if (addr < sim.memory.length) {
                    sim.memory[addr] = val;
                }
            }
        }
    } else if (assemblyResult.objectCode) {
         // Fallback for older assembler version if applicable
         for(let i=0; i<assemblyResult.objectCode.length; i++) {
             sim.memory[0x0100 + i] = assemblyResult.objectCode[i];
         }
    }

    // DEBUG: Dump loaded test memory
console.log("DEBUG: Dumping Test Memory (0x0100 - 0x0180):");
for (let addr = 0x0100; addr < 0x0180; addr += 8) {
    let line = `0x${addr.toString(16)}: `;
    for (let j = 0; j < 8; j++) {
        line += `0x${sim.memory[addr + j].toString(16)} `;
    }
    console.log(line);
}

// DEBUG: Dump ROM Memory (0xF80C0 - 0xF8140)
    console.log("DEBUG: Dumping ROM Memory (0xF80C0 - 0xF8140):");
    for (let addr = 0xF80C0; addr < 0xF8140; addr += 8) {
        let line = `0x${addr.toString(16)}: `;
        for (let j = 0; j < 8; j++) {
            if (addr + j < sim.memory.length) {
                line += `0x${sim.memory[addr + j].toString(16).padStart(4, '0')} `;
            }
        }
        console.log(line);
    }
    
    // 4. Run Simulation
    console.log("Starting Simulation...");
    sim.running = true;
    
    // Mock UI for Screen Output
    let screenOutput = "";
    sim.ui = {
        screenUI: {
            handleScreenMemoryWrite: (addr, val) => {
                // Only capture printable ASCII
                const charCode = val & 0xFF;
                if (charCode !== 32) {
                     console.log(`[Screen] Write at 0x${addr.toString(16)}: '${String.fromCharCode(charCode)}' (0x${val.toString(16)})`);
                }
                if (charCode >= 32 && charCode <= 126) {
                    screenOutput += String.fromCharCode(charCode);
                } else if (charCode === 10) {
                    screenOutput += "\n";
                }
            }
        },
        markCodeSegment: (addr, len) => {} // No-op
    };

    const MAX_STEPS = 300000;
    let inputSent = false;
    let success = false;

    console.log('Starting BIOS test simulation...');

    // Initial SCR check
    console.log(`Initial SCR Pointer (at 0x00A0): 0x${sim.memory[0x00A0].toString(16)}`);

    for (let i = 0; i < MAX_STEPS; i++) {
        sim.step();
         
        const inShadow = (sim.psw & (1 << 5)) !== 0;
        const pc = inShadow ? (sim.shadowRegisters.PC & 0xFFFF) : (sim.registers[15] & 0xFFFF);
        const cs = inShadow ? (sim.shadowRegisters.CS & 0xFFFF) : (sim.segmentRegisters.CS & 0xFFFF);
        
        // Monitor SCR pointer changes - allow BIOS time to initialize it first
            if (i > 100 && i % 100 === 0) {
                 const scr = sim.memory[0x00A0];
                 if (scr > 0x1800 && scr !== 0x0000 && scr !== 0xFFFF) { // 0x0000 and 0xFFFF are initial states
                     console.log(`[ALERT] SCR Corruption detected at step ${i}! PC=0x${pc.toString(16)} CS=0x${cs.toString(16)} SCR=0x${scr.toString(16)}`);
                     // Dump registers
                     console.log(`R0-R7: ${sim.registers.slice(0,8).map(r=>r.toString(16)).join(' ')}`);
                     console.log(`R8-R15: ${sim.registers.slice(8,16).map(r=>r.toString(16)).join(' ')}`);
                     break;
                 }
            }

        
        // Skip clear loop trace (CS=0xF800, PC=0x17..0x1A)
        const isClearLoop = (cs === 0xF800 && pc >= 0x0017 && pc <= 0x001A);
        // Skip getstr wait loop (CS=0xF800, PC=0xdd..0xe2)
        const isWaitLoop = (cs === 0xF800 && pc >= 0x00dd && pc <= 0x00e2);
        
        // Debugging loop exit condition
        if (cs === 0xF800 && pc === 0x00e1) {
             const r1 = sim.registers[1];
             const r0 = sim.registers[0];
             const es = inShadow ? (sim.shadowRegisters.ES & 0xFFFF) : (sim.segmentRegisters.ES & 0xFFFF);
             if (r1 !== 0) { // Only log if we have data
                 console.log(`[DEBUG] CMP R1, R0 at 0xE1: R1=${r1} (0x${r1.toString(16)}), R0=${r0} (0x${r0.toString(16)}), ES=0x${es.toString(16)}`);
             }
        }

        if (cs === 0xF800 && pc >= 0x00e4 && pc <= 0x00ea) {
             console.log(`[DEBUG] Post-Loop execution: PC=${pc.toString(16)}`);
        }
        
        if (i % 10000 === 0) console.log(`[PROGRESS] Step ${i}`);

        // Trace BIOS and Test code (skipping loops)
        if ((cs === 0 || cs === 0xF800) && !isClearLoop && !isWaitLoop) {
             const phys = ((cs << 4) + pc) >>> 0;
             const instr = sim.memory[phys];
             const r14 = inShadow ? sim.shadowRegisters.R14 : sim.registers[14];
             const scrPtr = sim.memory[0x00A0];
             console.log(`[${i}] CS:${cs.toString(16)} PC:${pc.toString(16)} R14:${r14.toString(16)} Inst:${instr ? instr.toString(16) : '??'} SCR_MEM:${scrPtr.toString(16)}`);
        }
         
         // Inject keystrokes
        if (i === 1000) {
            sim.enqueueKeyCode('T'.charCodeAt(0));
        }
        if (i === 2000) {
            sim.enqueueKeyCode('e'.charCodeAt(0));
        }
        if (i === 3000) {
            sim.enqueueKeyCode('s'.charCodeAt(0));
        }
        if (i === 4000) {
            sim.enqueueKeyCode('t'.charCodeAt(0));
        }
        if (i === 5000) {
            sim.enqueueKeyCode(13); // Enter
            inputSent = true;
        }

        // Check for success condition periodically
        if (inputSent && i % 1000 === 0) {
            const screenMem = sim.memory.slice(sim.SCREEN_MEMORY_START, sim.SCREEN_MEMORY_END);
            const chars = [];
            for (let j = 0; j < screenMem.length; j++) {
                const val = screenMem[j];
                const charCode = val & 0xFF;
                if (charCode >= 32 && charCode <= 126) {
                    chars.push(String.fromCharCode(charCode));
                } else {
                    chars.push(' ');
                }
            }
            const screenText = chars.join('');
            if (screenText.includes('You typed: Test')) {
                console.log('SUCCESS: Found "You typed: Test" in screen buffer!');
                success = true;
                break;
            }
        }
    }

    // Final Debug Dump
    const scrPtr = sim.memory[0x00A0];
    console.log(`Final SCR Pointer (at 0x00A0): 0x${scrPtr.toString(16)} (Expected ~0x1000+)`);
    console.log(`Shadow DS: 0x${sim.shadowRegisters.DS.toString(16)}`);

    const screenMem = sim.memory.slice(sim.SCREEN_MEMORY_START, sim.SCREEN_MEMORY_END);
    const chars = [];
    for (let i = 0; i < screenMem.length; i++) {
        const val = screenMem[i];
        const charCode = val & 0xFF;
        if (charCode >= 32 && charCode <= 126) {
            chars.push(String.fromCharCode(charCode));
        } else {
            chars.push(' ');
        }
    }
    const screenText = chars.join('');

    // Write full screen dump to file
     fs.writeFileSync('screen_dump.txt', screenText);
    console.log('Screen dump written to screen_dump.txt');

    console.log('Screen Buffer End Segment: "' + screenText.slice(-50) + '"');

    if (!success) {
        console.log('TIMEOUT: Simulation did not complete successfully.');
        process.exit(1);
    } else {
        console.log('Test Passed!');
    }
}

runTest();
