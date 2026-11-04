
const fs = require('fs');
const Deep16Assembler = require('./js/deep16_assembler.js');
const Deep16Simulator = require('./js/deep16_simulator.js');

async function run() {
    try {
        console.log('Reading forth.asm...');
        const asmSource = fs.readFileSync('./asm/forth.asm', 'utf8');
        
        console.log('Assembling...');
        const assembler = new Deep16Assembler();
        let result;
        try {
            result = await assembler.assemble(asmSource);
        } catch (e) {
            console.error('Assembly failed:', e.message);
            return;
        }

        if (result.errors && result.errors.length > 0) {
            console.error('Assembly errors:', result.errors);
            return;
        }
        
        console.log('Assembly successful.');
        const memoryChanges = result.memoryChanges;
        const symbols = result.symbolTable || result.symbols || result.labels;
        const cursorOnAddr = symbols['cursor_on'];
        
        console.log(`cursor_on address: 0x${cursorOnAddr ? cursorOnAddr.toString(16) : 'undefined'}`);
        
        console.log('Initializing Simulator...');
        const sim = new Deep16Simulator();
        
        // Load program using memoryChanges
        for (const change of memoryChanges) {
            if (change.address < sim.memory.length) {
                sim.memory[change.address] = change.value;
            }
        }
        
        sim.autoloadROM();
        sim.registers[15] = 0x0100; // Start at 0x0100 (org)
        sim.segmentRegisters.CS = 0x0000;
        sim.running = true;
        
        console.log('Starting simulation...');
        
        let steps = 0;
        const MAX_STEPS = 500000;
        let inBios = false;
        let greetingFound = false;
        let scrollingStarted = false;
        let lastScrollLog = 0;
        
        while (steps < MAX_STEPS && sim.running) {
            const inShadow = (sim.psw & (1 << 5)) !== 0;
            const currentPC = inShadow ? sim.shadowRegisters.PC : sim.registers[15];
            const currentCS = inShadow ? sim.shadowRegisters.CS : sim.segmentRegisters.CS;
            
            // Check for greeting in screen memory
            if (steps % 1000 === 0) {
                let screenContent = '';
                for (let i = 0; i < 32; i++) {
                    const addr = 0xF1000 + i;
                    const val = sim.memory[addr];
                    const char = val & 0xFF;
                    screenContent += (char >= 32 && char <= 126) ? String.fromCharCode(char) : '.';
                }
                if (screenContent.includes("Hello DeepForth") && !greetingFound) {
                    console.log(`\n[${steps}] Greeting detected!`);
                    greetingFound = true;
                    
                    // Inject 50 CRs to trigger scrolling
                    console.log("Injecting 50 CRs to trigger scrolling...");
                    for (let k = 0; k < 50; k++) {
                        sim.kbdBuffer.push(13);
                    }
                }
            }
            
            // Check for cursor_on entry
            if (currentPC === cursorOnAddr && !inShadow) {
                console.log(`\n[${steps}] Entered cursor_on at 0x${currentPC.toString(16)}`);
                console.log(`SCR (Normal)=0x${sim.registers[8].toString(16)}`);
            }

            // Check for BIOS entry
            if (inShadow && !inBios) {
                inBios = true;
                // Only log BIOS entry occasionally or if critical
                if (steps % 5000 === 0) {
                     console.log(`\n[${steps}] Entered BIOS (Shadow Mode) PC=0x${currentPC.toString(16)}`);
                }
            } else if (!inShadow && inBios) {
                inBios = false;
            }
            
            // Check for scrolling loop (ok_scroll_copy at 0x356)
            if (currentPC === 0x356) {
                if (!scrollingStarted) {
                    console.log(`\n[${steps}] Scrolling logic started (PC=0x356)`);
                    scrollingStarted = true;
                }
                if (steps - lastScrollLog > 1000) {
                    console.log(`[${steps}] In scrolling loop... R7=${sim.registers[7]}`);
                    lastScrollLog = steps;
                }
            }
            
            // Check for halt at 0x362 or nearby
            if (currentPC === 0x362) {
                console.log(`\n[${steps}] Reached 0x362 (potential halt point)`);
            }
            
            try {
                const running = sim.step();
                if (!running) {
                    console.log(`Simulation stopped at step ${steps}, PC=0x${currentPC.toString(16)}`);
                    break;
                }
            } catch (e) {
                console.error(`Error at step ${steps}: ${e.message}`);
                break;
            }
            
            steps++;
        }

        console.log('\nSimulation finished.');
        console.log('Checking Screen Memory (0xF1000 - 0xF1020)...');
        
        let screenContent = '';
        for (let i = 0; i < 32; i++) {
            const addr = 0xF1000 + i;
            const val = sim.memory[addr];
            const char = val & 0xFF;
            screenContent += (char >= 32 && char <= 126) ? String.fromCharCode(char) : '.';
        }
        console.log(`Screen Dump: "${screenContent}"`);
        
    } catch (err) {
        console.error("Runtime error:", err);
    }
}

run();
