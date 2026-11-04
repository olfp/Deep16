const fs = require('fs');
const Deep16Assembler = require('./js/deep16_assembler.js');
const Deep16Simulator = require('./js/deep16_simulator.js');

async function run() {
    try {
        console.log('Loading test suite...');
        const asmSource = fs.readFileSync('./asm/test_suite.asm', 'utf8');
        const expectedValues = JSON.parse(fs.readFileSync('./test_expected.json', 'utf8'));

        console.log('Assembling...');
        const assembler = new Deep16Assembler();
        let result;
        try {
            result = await assembler.assemble(asmSource);
        } catch (e) {
            console.error('Assembly failed:', e.message);
            if (e.errors) console.error(e.errors);
            return;
        }

        if (result.errors && result.errors.length > 0) {
            console.error('Assembly errors:', result.errors);
            return;
        }

        console.log('Initializing Simulator...');
        const sim = new Deep16Simulator();
        
        // Load program
        for (const change of result.memoryChanges) {
            if (change.address < sim.memory.length) {
                sim.memory[change.address] = change.value;
            }
        }
        
        // Initialize PC
        sim.registers[15] = 0x0100;
        sim.segmentRegisters.CS = 0x0000;
        sim.segmentRegisters.DS = 0x0000; // Explicitly set DS to 0 to match test assumptions
        sim.running = true;
        
        console.log('Running simulation...');
        const MAX_STEPS = 100000;
        let steps = 0;
        
        while (sim.running && steps < MAX_STEPS) {
            sim.step();
            steps++;
            
            // Check for HALT (0xFFFF)
            // Simulator step() usually sets running=false on HALT?
            // Let's check simulator implementation. 
            // HALT returns 0xFFFF opcode, but simulator loop handles it?
            // Usually step() executes one instruction.
            // If HLT is executed, sim.running might be set to false.
        }
        
        if (steps >= MAX_STEPS) {
            console.warn(`Simulation reached MAX_STEPS (${MAX_STEPS}). Infinite loop?`);
        }
        
        console.log(`Simulation stopped after ${steps} steps.`);
        
        // Verification
        console.log('\nVerifying Results...');
        let passed = 0;
        let failed = 0;
        const resultBase = 0x2000;
        
        // We know the order of tests matches the expectedValues array
        // because generate_test_suite.js writes them sequentially.
        
        for (let i = 0; i < expectedValues.length; i++) {
            const addr = resultBase + i;
            const actual = sim.memory[addr];
            const expected = expectedValues[i];
            
            if (actual === expected) {
                // console.log(`Test ${i+1}: PASS (0x${actual.toString(16)})`);
                passed++;
            } else {
                console.error(`Test ${i+1}: FAIL. Addr 0x${addr.toString(16)} = 0x${actual.toString(16)} (Expected: 0x${expected.toString(16)})`);
                failed++;
            }
        }
        
        console.log(`\nSummary: ${passed} Passed, ${failed} Failed.`);
        
        if (failed === 0) {
            console.log('ALL TESTS PASSED.');
        } else {
            process.exit(1);
        }
        
    } catch (e) {
        console.error('Unexpected error:', e);
    }
}

run();
