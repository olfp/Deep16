// deep16_ui.js - Updated with Memory Display and Safari Fixes
class DeepWebUI {
    constructor() {
        this.assembler = new Deep16Assembler();
        this.simulator = new Deep16Simulator();
        this.memoryStartAddress = 0;
        this.runInterval = null;
        this.transcriptEntries = [];
        this.maxTranscriptEntries = 50;

        this.initializeEventListeners();
        this.initializeTestMemory(); // Initialize memory with test data
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

    initializeTestMemory() {
        // Add some test values to memory for display purposes
        for (let i = 0; i < 256; i++) {
            // Create a pattern for visibility
            this.simulator.memory[i] = (i * 0x111) & 0xFFFF;
        }
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
        const continueRunning = this.simulator.step();
        const pcAfter = this.simulator.registers[15];
        
        this.updateAllDisplays();
        this.status("Step executed");
        this.addTranscriptEntry(`Step: PC 0x${pcBefore.toString(16).padStart(4, '0')} → 0x${pcAfter.toString(16).padStart(4, '0')}`, "info");
        
        return continueRunning;
    }

    reset() {
        if (this.runInterval) {
            clearInterval(this.runInterval);
            this.addTranscriptEntry("Program execution stopped", "info");
        }
        this.simulator.reset();
        this.memoryStartAddress = 0;
        document.getElementById('memory-start-address').value = '0x0000';
        this.initializeTestMemory(); // Reinitialize test memory
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
            document.getElementById('memory-start-address').value = '0x' + address.toString(16).padStart(4, '0');
            const symbolName = event.target.options[event.target.selectedIndex].text.split(' ')[0];
            this.addTranscriptEntry(`Memory view jumped to symbol: ${symbolName}`, "info");
        }
    }

    updateAllDisplays() {
        this.updateRegisterDisplay();
        this.updatePSWDisplay();
        this.updateMemoryDisplay();
        this.updateSegmentRegisters();
        this.updateShadowRegisters();
    }

    updateRegisterDisplay() {
        const registerGrid = document.getElementById('register-grid');
        let html = '';
        
        const registerNames = [
            'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7',
            'R8', 'R9', 'R10', 'R11', 'FP', 'SP', 'LR', 'PC'
        ];
        
        for (let i = 0; i < 16; i++) {
            const value = this.simulator.registers[i];
            const valueHex = '0x' + value.toString(16).padStart(4, '0').toUpperCase();
            html += `
                <div class="register">
                    <span class="register-name">${registerNames[i]}</span>
                    <span class="register-value">${valueHex}</span>
                </div>
            `;
        }
        
        registerGrid.innerHTML = html;
    }

    updatePSWDisplay() {
        const psw = this.simulator.psw;
        
        // Update individual PSW bits
        document.getElementById('psw-de').textContent = (psw >> 15) & 1;
        document.getElementById('psw-er').textContent = (psw >> 11) & 0xF;
        document.getElementById('psw-ds').textContent = (psw >> 10) & 1;
        document.getElementById('psw-dr').textContent = (psw >> 6) & 0xF;
        document.getElementById('psw-x1').textContent = (psw >> 5) & 1;
        document.getElementById('psw-x2').textContent = (psw >> 4) & 1;
        document.getElementById('psw-i').textContent = (psw >> 3) & 1;
        document.getElementById('psw-s').textContent = (psw >> 2) & 1;
        document.getElementById('psw-c').textContent = (psw >> 1) & 1;
        document.getElementById('psw-v').textContent = (psw >> 0) & 1;
        document.getElementById('psw-z').textContent = (psw >> 1) & 1; // Note: Z flag is typically bit 1
        document.getElementById('psw-n').textContent = (psw >> 0) & 1; // Note: N flag is typically bit 0
        
        // Add visual highlighting for set bits
        const pswBits = document.querySelectorAll('.psw-value');
        pswBits.forEach(bit => {
            const bitValue = parseInt(bit.textContent);
            bit.classList.toggle('on', bitValue === 1);
        });
    }

    updateMemoryDisplay() {
        const memoryDisplay = document.getElementById('memory-display');
        let html = '';
        
        const start = this.memoryStartAddress;
        const end = Math.min(start + 32, this.simulator.memory.length);
        
        if (start >= end) {
            html = '<div class="memory-line">Invalid memory range</div>';
        } else {
            for (let i = start; i < end; i++) {
                const address = i;
                const value = this.simulator.memory[address];
                const valueHex = value.toString(16).padStart(4, '0').toUpperCase();
                
                // Check if this is current PC
                const isPC = (address === this.simulator.registers[15]);
                const pcClass = isPC ? 'pc-marker' : '';
                
                html += `
                    <div class="memory-line ${pcClass}">
                        <span class="memory-address">0x${address.toString(16).padStart(4, '0')}</span>
                        <span class="memory-bytes">0x${valueHex}</span>
                        <span class="memory-disassembly">${this.disassembleInstruction(value)}</span>
                    </div>
                `;
            }
        }
        
        memoryDisplay.innerHTML = html || '<div class="memory-line">No memory content</div>';
    }

    disassembleInstruction(instruction) {
        if (instruction === 0) return 'NOP';
        
        const opcode = (instruction >> 13) & 0x7;
        
        switch (opcode) {
            case 0b000: 
                return `LDI #${instruction & 0x7FFF}`;
                
            case 0b100: 
                const d = (instruction >> 12) & 0x1;
                const rd = (instruction >> 8) & 0xF;
                const rb = (instruction >> 4) & 0xF;
                const offset = instruction & 0x1F;
                return d === 0 ? `LD R${rd}, [R${rb}+${offset}]` : `ST R${rd}, [R${rb}+${offset}]`;
                
            case 0b110:
                const aluOp = (instruction >> 10) & 0x7;
                const aluOps = ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'MUL', 'DIV', 'SHIFT'];
                return `${aluOps[aluOp]} ...`;
                
            case 0b111: 
                if ((instruction >> 12) === 0b1110) {
                    const condition = (instruction >> 9) & 0x7;
                    const conditions = ['JZ', 'JNZ', 'JC', 'JNC', 'JN', 'JNN', 'JO', 'JNO'];
                    const offset = instruction & 0x1FF;
                    return `${conditions[condition]} ${offset}`;
                }
                return 'SYS';
                
            default: 
                return `??? (0x${instruction.toString(16)})`;
        }
    }

    updateSegmentRegisters() {
        document.getElementById('reg-cs').textContent = '0x' + this.simulator.segmentRegisters.CS.toString(16).padStart(4, '0');
        document.getElementById('reg-ds').textContent = '0x' + this.simulator.segmentRegisters.DS.toString(16).padStart(4, '0');
        document.getElementById('reg-ss').textContent = '0x' + this.simulator.segmentRegisters.SS.toString(16).padStart(4, '0');
        document.getElementById('reg-es').textContent = '0x' + this.simulator.segmentRegisters.ES.toString(16).padStart(4, '0');
    }

    updateShadowRegisters() {
        document.getElementById('reg-psw-shadow').textContent = '0x' + this.simulator.shadowRegisters.PSW.toString(16).padStart(4, '0');
        document.getElementById('reg-pc-shadow').textContent = '0x' + this.simulator.shadowRegisters.PC.toString(16).padStart(4, '0');
        document.getElementById('reg-cs-shadow').textContent = '0x' + this.simulator.shadowRegisters.CS.toString(16).padStart(4, '0');
    }

    updateSymbolTable(symbols) {
        const symbolTable = document.getElementById('symbol-table');
        let html = '';
        
        for (const [name, address] of Object.entries(symbols)) {
            html += `
                <div class="symbol-row">
                    <span class="symbol-name">${name}</span>
                    <span class="symbol-address">0x${address.toString(16).padStart(4, '0')}</span>
                </div>
            `;
        }
        
        symbolTable.innerHTML = html || '<div class="symbol-row">No symbols</div>';
    }

    updateSymbolSelect(symbols) {
        const symbolSelect = document.getElementById('symbol-select');
        let html = '<option value="">-- Select Symbol --</option>';
        
        for (const [name, address] of Object.entries(symbols)) {
            html += `<option value="${address}">${name} (0x${address.toString(16).padStart(4, '0')})</option>`;
        }
        
        symbolSelect.innerHTML = html;
    }

    status(message) {
        document.getElementById('status-bar').textContent = `DeepWeb: ${message}`;
    }

    loadExample() {
        // Keep the current example or load a new one
        this.addTranscriptEntry("Fibonacci example loaded into editor", "info");
        this.status("Fibonacci example ready - click 'Assemble' to compile");
    }
}

// Initialize the UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.deepWebUI = new DeepWebUI();
});
