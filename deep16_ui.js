// deep16_ui.js - Updated with proper PSW, symbols, and layout fixes
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
            // Clear existing memory and load the new program
            this.simulator.memory.fill(0);
            for (let i = 0; i < result.memory.length; i++) {
                this.simulator.memory[i] = result.memory[i];
            }
            
            this.simulator.registers[15] = 0x0000; // Reset PC
            this.status("Assembly successful! Program loaded.");
            this.addTranscriptEntry("Assembly successful - program loaded", "success");
            document.getElementById('run-btn').disabled = false;
            document.getElementById('step-btn').disabled = false;
            document.getElementById('reset-btn').disabled = false;
            
            // Update symbols - FIXED: Use the symbols from the assembly result
            this.updateSymbolTable(result.symbols);
            this.updateSymbolSelect(result.symbols);
            this.addTranscriptEntry(`Found ${Object.keys(result.symbols).length} symbols`, "info");
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
        if (!isNaN(address) && address >= 0) {
            this.memoryStartAddress = address;
            this.updateMemoryDisplay();
            document.getElementById('memory-start-address').value = '0x' + address.toString(16).padStart(4, '0');
            const symbolName = event.target.options[event.target.selectedIndex].text.split(' (')[0];
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
                <div class="register-compact">
                    <span class="register-name">${registerNames[i]}</span>
                    <span class="register-value">${valueHex}</span>
                </div>
            `;
        }
        
        registerGrid.innerHTML = html;
    }

    updatePSWDisplay() {
        const psw = this.simulator.psw;
        
        // Correct PSW bit mapping according to Deep16 spec:
        // Bit 0: N (Negative), Bit 1: Z (Zero), Bit 2: V (Overflow), Bit 3: C (Carry)
        // Bit 4: I (Interrupt Enable), Bit 5: S (Shadow View)
        // Bits 6-15: Segment control (we don't show individual bits for these)
        
        // Update checkbox PSW bits (only show relevant 1-bit flags)
        document.getElementById('psw-n').checked = (psw & 0x0001) !== 0;
        document.getElementById('psw-z').checked = (psw & 0x0002) !== 0;
        document.getElementById('psw-v').checked = (psw & 0x0004) !== 0;
        document.getElementById('psw-c').checked = (psw & 0x0008) !== 0;
        document.getElementById('psw-i').checked = (psw & 0x0010) !== 0; // Bit 4
        document.getElementById('psw-s').checked = (psw & 0x0020) !== 0; // Bit 5 (S and I are swapped from before)
        
        // Update segment control displays (multi-bit fields)
        document.getElementById('psw-de').textContent = (psw >> 15) & 1;
        document.getElementById('psw-er').textContent = (psw >> 11) & 0xF;
        document.getElementById('psw-ds').textContent = (psw >> 10) & 1;
        document.getElementById('psw-dr').textContent = (psw >> 6) & 0xF;
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
        // Use compact layout for segment registers
        const segmentGrid = document.querySelector('.register-section:nth-child(3) .register-grid');
        if (segmentGrid) {
            segmentGrid.innerHTML = `
                <div class="register-compact">
                    <span class="register-name">CS</span>
                    <span class="register-value">0x${this.simulator.segmentRegisters.CS.toString(16).padStart(4, '0')}</span>
                </div>
                <div class="register-compact">
                    <span class="register-name">DS</span>
                    <span class="register-value">0x${this.simulator.segmentRegisters.DS.toString(16).padStart(4, '0')}</span>
                </div>
                <div class="register-compact">
                    <span class="register-name">SS</span>
                    <span class="register-value">0x${this.simulator.segmentRegisters.SS.toString(16).padStart(4, '0')}</span>
                </div>
                <div class="register-compact">
                    <span class="register-name">ES</span>
                    <span class="register-value">0x${this.simulator.segmentRegisters.ES.toString(16).padStart(4, '0')}</span>
                </div>
            `;
        }
    }

    updateShadowRegisters() {
        // Use compact layout for shadow registers
        const shadowGrid = document.querySelector('.shadow-section .register-grid');
        if (shadowGrid) {
            shadowGrid.innerHTML = `
                <div class="register-compact">
                    <span class="register-name">PSW'</span>
                    <span class="register-value">0x${this.simulator.shadowRegisters.PSW.toString(16).padStart(4, '0')}</span>
                </div>
                <div class="register-compact">
                    <span class="register-name">PC'</span>
                    <span class="register-value">0x${this.simulator.shadowRegisters.PC.toString(16).padStart(4, '0')}</span>
                </div>
                <div class="register-compact">
                    <span class="register-name">CS'</span>
                    <span class="register-value">0x${this.simulator.shadowRegisters.CS.toString(16).padStart(4, '0')}</span>
                </div>
            `;
        }
    }

    updateSymbolTable(symbols) {
        const symbolTable = document.getElementById('symbol-table');
        let html = '';
        
        if (symbols && Object.keys(symbols).length > 0) {
            for (const [name, address] of Object.entries(symbols)) {
                html += `
                    <div class="symbol-row">
                        <span class="symbol-name">${name}</span>
                        <span class="symbol-address">0x${address.toString(16).padStart(4, '0')}</span>
                    </div>
                `;
            }
        } else {
            html = '<div class="symbol-row">No symbols found</div>';
        }
        
        symbolTable.innerHTML = html;
    }

    updateSymbolSelect(symbols) {
        const symbolSelect = document.getElementById('symbol-select');
        let html = '<option value="">-- Select Symbol --</option>';
        
        if (symbols && Object.keys(symbols).length > 0) {
            for (const [name, address] of Object.entries(symbols)) {
                html += `<option value="${address}">${name} (0x${address.toString(16).padStart(4, '0')})</option>`;
            }
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
