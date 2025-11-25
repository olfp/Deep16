// deep16_worker.js - Web Worker for Deep16 simulation
importScripts('deep16_simulator.js');

let simulator = null;
let isRunning = false;

self.addEventListener('message', function(e) {
    const { type, data } = e.data;
    
    switch (type) {
        case 'INIT':
            simulator = new Deep16Simulator();
            // Initialize simulator state
            if (data.memory) {
                simulator.memory = data.memory;
            }
            if (data.registers) {
                simulator.registers = data.registers;
            }
            if (data.psw !== undefined) {
                simulator.psw = data.psw;
            }
            if (data.segmentRegisters) {
                simulator.segmentRegisters = data.segmentRegisters;
            }
            break;
            
        case 'LOAD_PROGRAM':
            if (simulator) {
                simulator.loadProgram(data.memory);
            }
            break;
            
        case 'RUN':
            if (simulator && !isRunning) {
                isRunning = true;
                runSimulation();
            }
            break;
            
        case 'STEP':
            if (simulator) {
                // Ensure single-step executes even if simulator.running is false
                const prevRunning = simulator.running;
                simulator.running = true;
                const result = simulator.step();
                simulator.running = false;
                self.postMessage({
                    type: 'STEP_RESULT',
                    data: {
                        registers: [...simulator.registers],
                        psw: simulator.psw,
                        memory: simulator.memory,
                        segmentRegisters: { ...simulator.segmentRegisters },
                        continueRunning: result,
                        running: false
                    }
                });
            }
            break;
            
        case 'RESET':
            if (simulator) {
                simulator.reset();
                isRunning = false;
            }
            break;
            
        case 'STOP':
            if (simulator) {
                simulator.running = false;
                isRunning = false;
            }
            break;
    }
});

function runSimulation() {
    if (!simulator || !isRunning) return;
    
    const startTime = performance.now();
    let stepsExecuted = 0;
    
    // Run as many steps as possible in one frame (up to 1000 steps)
    while (isRunning && simulator.running && stepsExecuted < 1000) {
        const continueRunning = simulator.step();
        stepsExecuted++;
        
        if (!continueRunning) {
            isRunning = false;
            simulator.running = false;
            break;
        }
    }
    
self.postMessage({
    type: 'BATCH_UPDATE',
    data: {
        registers: [...simulator.registers],
        psw: simulator.psw,
        memory: simulator.memory,
        segmentRegisters: {...simulator.segmentRegisters}, // Add this
        stepsExecuted: stepsExecuted,
        running: simulator.running && isRunning
    }
});
    
    // If still running, continue in next animation frame
    if (isRunning && simulator.running) {
        setTimeout(runSimulation, 0);
    } else {
        isRunning = false;
        self.postMessage({
            type: 'EXECUTION_COMPLETE',
            data: {
                registers: [...simulator.registers],
                psw: simulator.psw,
                memory: simulator.memory,
                segmentRegisters: { ...simulator.segmentRegisters }
            }
        });
    }
}
