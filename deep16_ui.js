// deep16_ui.js - Updated with Transcript Support
class DeepWebUI {
    constructor() {
        this.assembler = new Deep16Assembler();
        this.simulator = new Deep16Simulator();
        this.memoryStartAddress = 0;
        this.runInterval = null;
        this.transcriptEntries = [];
        this.maxTranscriptEntries = 50;

        this.initializeEventListeners();
        this.updateAllDisplays();
        this.addTranscriptEntry("DeepWeb initialized and ready", "info");
    }

    initializeEventListeners() {
        document.getElementById('assemble-btn').addEventListener('click', () => this.assemble());
        document.getElementById('run-btn').addEventListener('click', () => this.run());
        document.getElementById('step-btn').addEventListener('click', () => this.step());
        document.getElementById('reset-btn').addEventListener('click', () => this.reset());
        document.getElementById('load-example').addEventListener('click', () => this.loadExample());
        document.getElementById('memory-jump-btn').addEventListener('click', () => this.jumpToMemoryAddress());
        document.getElementById('symbol-select').addEventListener('change', (e) => this.onSymbolSelect(e));
        
        document.getElementById('memory-start-address').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.jumpToMemoryAddress();
        });
    }

    addTranscriptEntry(message, type = "info") {
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        this.transcriptEntries.unshift({
            timestamp: timestamp,
            message: message,
            type: type
        });

        // Keep only the last N entries
        if (this.transcriptEntries.length > this.maxTranscriptEntries) {
            this.transcriptEntries = this.transcriptEntries.slice(0, this.maxTranscriptEntries);
        }

        this.updateTranscriptDisplay();
    }

    updateTranscriptDisplay() {
        const transcript = document.getElementById('transcript');
        let html = '';

        this.transcriptEntries.forEach(entry => {
            const entryClass = `transcript-entry ${entry.type}`;
            html += `
                <div class="${entryClass}">
                    <span class="transcript-time">${entry.timestamp}</span>
                    <span class="transcript-message">${entry.message}</span>
                </div>
            `;
        });

        transcript.innerHTML = html;
    }

    assemble() {
        const source = document.getElementById('editor').value;
        this.status("Assembling...");
        this.addTranscriptEntry("Starting assembly", "info");

        const result = this.assembler.assemble(source);
        
        if (result.success) {
            this.simulator.loadProgram(result.memory);
            this.status("Assembly successful! Program loaded.");
            this.addTranscriptEntry("Assembly successful - program loaded", "success");
            document.getElementById('run-btn').disabled = false;
            document.getElementById('step-btn').disabled = false;
            document.getElementById('reset-btn').disabled = false;
            this.updateSymbolTable(result.symbols);
            this.updateSymbolSelect(result.symbols);
        } else {
            const errorMsg = `Assembly failed with ${result.errors.length} error(s)`;
            this.status("Assembly errors - see transcript for details");
            this.addTranscriptEntry(errorMsg, "error");
            result.errors.forEach(error => {
                this.addTranscriptEntry(error, "error");
            });
        }

        this.updateAllDisplays();
    }

    run() {
        this.simulator.running = true;
        this.status("Running program...");
        this.addTranscriptEntry("Starting program execution", "info");
        
        this.runInterval = setInterval(() => {
            if (!this.simulator.running) {
                clearInterval(this.runInterval);
                this.status("Program halted");
                this.addTranscriptEntry("Program execution halted", "info");
                return;
            }
            
            const continueRunning = this.simulator.step();
            if (!continueRunning) {
                clearInterval(this.runInterval);
                this.status("Program finished");
                this.addTranscriptEntry("Program execution completed", "success");
            }
            
            this.updateAllDisplays();
        }, 50);
    }

    step() {
        this.simulator.running = true;
        const pcBefore = this.simulator.registers[15];
        this.simulator.step();
        const pcAfter = this.simulator.registers[15];
        
        this.updateAllDisplays();
        this.status("Step executed");
        this.addTranscriptEntry(`Step: PC 0x${pcBefore.toString(16).padStart(4, '0')} → 0x${pcAfter.toString(16).padStart(4, '0')}`, "info");
    }

    reset() {
        if (this.runInterval) {
            clearInterval(this.runInterval);
            this.addTranscriptEntry("Program execution stopped", "info");
        }
        this.simulator.reset();
        this.memoryStartAddress = 0;
        document.getElementById('memory-start-address').value = '0x0000';
        this.updateAllDisplays();
        this.status("Reset complete");
        this.addTranscriptEntry("System reset", "info");
    }

    jumpToMemoryAddress() {
        const input = document.getElementById('memory-start-address');
        let address = input.value.trim();

        if (address.startsWith('0x')) {
            address = parseInt(address.substring(2), 16);
        } else {
            address = parseInt(address);
        }

        if (!isNaN(address) && address >= 0 && address < this.simulator.memory.length) {
            this.memoryStartAddress = address;
            this.updateMemoryDisplay();
            input.value = '0x' + address.toString(16).padStart(4, '0');
            this.addTranscriptEntry(`Memory view jumped to 0x${address.toString(16).padStart(4, '0')}`, "info");
        } else {
            const errorMsg = `Invalid memory address: ${input.value}`;
            this.status(errorMsg);
            this.addTranscriptEntry(errorMsg, "error");
        }
    }

    onSymbolSelect(event) {
        const address = parseInt(event.target.value);
        if (!isNaN(address)) {
            this.memoryStartAddress = address;
            this.updateMemoryDisplay();
            const symbolName = event.target.options[event.target.selectedIndex].text.split(' ')[0];
            this.addTranscriptEntry(`Memory view jumped to symbol: ${symbolName}`, "info");
        }
    }

    // ... (rest of the methods remain the same, but add transcript entries to other actions)
    status(message) {
        document.getElementById('status-bar').textContent = `DeepWeb: ${message}`;
    }

    loadExample() {
        this.addTranscriptEntry("Fibonacci example loaded into editor", "info");
        this.status("Fibonacci example ready - click 'Assemble' to compile");
    }

    // ... (other methods remain unchanged)
}
