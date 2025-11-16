// deep16_ui.js - Updated with tab system and error navigation
class DeepWebUI {
    constructor() {
        this.assembler = new Deep16Assembler();
        this.simulator = new Deep16Simulator();
        this.memoryStartAddress = 0;
        this.runInterval = null;
        this.transcriptEntries = [];
        this.maxTranscriptEntries = 50;
        this.currentAssemblyResult = null;
        this.editorElement = document.getElementById('editor');

        this.initializeEventListeners();
        this.initializeTestMemory();
        this.initializeTabs();
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

        // Tab buttons
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });
    }

    initializeTabs() {
        // Show editor tab by default
        this.switchTab('editor');
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tabName);
        });

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}-tab`);
        });

        // If switching to listing tab and we have assembly results, update it
        if (tabName === 'listing' && this.currentAssemblyResult) {
            this.updateAssemblyListing();
        }
    }

    initializeTestMemory() {
        // Add some test values to memory for display purposes
        for (let i = 0; i < 256; i++) {
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
        const source = this.editorElement.value;
        this.status("Assembling...");
        this.addTranscriptEntry("Starting assembly", "info");

        const result = this.assembler.assemble(source);
        this.currentAssemblyResult = result;
        
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
            
            this.updateSymbolTable(result.symbols);
            this.updateSymbolSelect(result.symbols);
            this.addTranscriptEntry(`Found ${Object.keys(result.symbols).length} symbols`, "info");
            
            // Switch to errors tab (will show "no errors" message)
            this.switchTab('errors');
        } else {
            const errorMsg = `Assembly failed with ${result.errors.length} error(s)`;
            this.status("Assembly errors - see errors tab for details");
            this.addTranscriptEntry(errorMsg, "error");
            
            // Switch to errors tab to show the errors
            this.switchTab('errors');
        }

        this.updateAllDisplays();
        this.updateErrorsList();
        this.updateAssemblyListing();
    }

    updateErrorsList() {
        const errorsList = document.getElementById('errors-list');
        
        if (!this.currentAssemblyResult) {
            errorsList.innerHTML = '<div class="no-errors">No assembly performed yet</div>';
            return;
        }

        const errors = this.currentAssemblyResult.errors;
        
        if (errors.length === 0) {
            errorsList.innerHTML = '<div class="no-errors">No errors - Assembly successful!</div>';
        } else {
            let html = '';
            errors.forEach((error, index) => {
                // Extract line number from error message if available
                const lineMatch = error.match(/Line (\d+):/);
                const lineNumber = lineMatch ? parseInt(lineMatch[1]) - 1 : 0;
                
                html += `
                    <div class="error-item" data-line="${lineNumber}">
                        <div class="error-location">Line ${lineNumber + 1}</div>
                        <div class="error-message">${error}</div>
                    </div>
                `;
            });
            errorsList.innerHTML = html;

            // Add click handlers for error navigation
            document.querySelectorAll('.error-item').forEach(item => {
                item.addEventListener('click', () => {
                    const lineNumber = parseInt(item.dataset.line);
                    this.navigateToError(lineNumber);
                });
            });
        }
    }

    navigateToError(lineNumber) {
        // Switch to editor tab
        this.switchTab('editor');
        
        // Focus the editor
        this.editorElement.focus();
        
        // Move cursor to the error line
        const lines = this.editorElement.value.split('\n');
        let position = 0;
        for (let i = 0; i < lineNumber && i < lines.length; i++) {
            position += lines[i].length + 1; // +1 for newline
        }
        
        this.editorElement.setSelectionRange(position, position);
        
        // Scroll to the line
        const lineHeight = 16; // Approximate line height
        this.editorElement.scrollTop = (lineNumber - 3) * lineHeight;
        
        this.addTranscriptEntry(`Navigated to error at line ${lineNumber + 1}`, "info");
    }

updateAssemblyListing() {
    const listingContent = document.getElementById('listing-content');
    
    if (!this.currentAssemblyResult) {
        listingContent.innerHTML = 'No assembly performed yet';
        return;
    }

    const { listing } = this.currentAssemblyResult;
    let html = '';
    
    for (const item of listing) {
        if (item.error) {
            // Error line - show error message
            html += `<div class="listing-line" style="color: #f44747;">`;
            html += `<span class="listing-address"></span>`;
            html += `<span class="listing-bytes"></span>`;
            html += `<span class="listing-source">ERR: ${item.error}</span>`;
            html += `</div>`;
            
            // Also show the original source line that caused the error
            if (item.line) {
                html += `<div class="listing-line">`;
                html += `<span class="listing-address"></span>`;
                html += `<span class="listing-bytes"></span>`;
                html += `<span class="listing-source" style="color: #ce9178;">${item.line}</span>`;
                html += `</div>`;
            }
        } else if (item.instruction !== undefined) {
            // Instruction line - one line per memory location
            const instructionHex = item.instruction.toString(16).padStart(4, '0').toUpperCase();
            html += `<div class="listing-line">`;
            html += `<span class="listing-address">0x${item.address.toString(16).padStart(4, '0')}</span>`;
            html += `<span class="listing-bytes">0x${instructionHex}</span>`;
            html += `<span class="listing-source">${item.line}</span>`;
            html += `</div>`;
        } else if (item.address !== undefined && (item.line.includes('.org') || item.line.includes('.word'))) {
            // Directive that affects address - show address but no instruction
            html += `<div class="listing-line">`;
            html += `<span class="listing-address">0x${item.address.toString(16).padStart(4, '0')}</span>`;
            html += `<span class="listing-bytes"></span>`;
            html += `<span class="listing-source">${item.line}</span>`;
            html += `</div>`;
        } else if (item.line && item.line.trim().endsWith(':')) {
            // Label line - show without address
            html += `<div class="listing-line">`;
            html += `<span class="listing-address"></span>`;
            html += `<span class="listing-bytes"></span>`;
            html += `<span class="listing-source" style="color: #569cd6;">${item.line}</span>`;
            html += `</div>`;
        } else if (item.line && (item.line.trim().startsWith(';') || item.line.trim() === '')) {
            // Comment or empty line
            html += `<div class="listing-line">`;
            html += `<span class="listing-address"></span>`;
            html += `<span class="listing-bytes"></span>`;
            html += `<span class="listing-source" style="color: #6a9955;">${item.line}</span>`;
            html += `</div>`;
        } else if (item.line) {
            // Other source lines (shouldn't happen, but just in case)
            html += `<div class="listing-line">`;
            html += `<span class="listing-address"></span>`;
            html += `<span class="listing-bytes"></span>`;
            html += `<span class="listing-source">${item.line}</span>`;
            html += `</div>`;
        }
    }

    listingContent.innerHTML = html || 'No assembly output';
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
        this.initializeTestMemory();
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
    
    // PSW bit mapping according to Deep16 spec (bit 15 to bit 0):
    // Bit 15: DE, Bits 14-11: ER, Bit 10: DS, Bits 9-6: SR, 
    // Bit 5: S, Bit 4: I, Bit 3: C, Bit 2: V, Bit 1: Z, Bit 0: N
    
    // Update checkboxes (1-bit flags)
    document.getElementById('psw-de').checked = (psw & 0x8000) !== 0; // Bit 15
    document.getElementById('psw-ds').checked = (psw & 0x0400) !== 0; // Bit 10
    document.getElementById('psw-s').checked = (psw & 0x0020) !== 0;  // Bit 5
    document.getElementById('psw-i').checked = (psw & 0x0010) !== 0;  // Bit 4
    document.getElementById('psw-c').checked = (psw & 0x0008) !== 0;  // Bit 3
    document.getElementById('psw-v').checked = (psw & 0x0004) !== 0;  // Bit 2
    document.getElementById('psw-z').checked = (psw & 0x0002) !== 0;  // Bit 1
    document.getElementById('psw-n').checked = (psw & 0x0001) !== 0;  // Bit 0
    
    // Update multi-bit fields
    document.getElementById('psw-er').textContent = (psw >> 11) & 0xF; // Bits 14-11
    document.getElementById('psw-sr').textContent = (psw >> 6) & 0xF;  // Bits 9-6
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
        this.addTranscriptEntry("Fibonacci example loaded into editor", "info");
        this.status("Fibonacci example ready - click 'Assemble' to compile");
    }
}

// Initialize the UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.deepWebUI = new DeepWebUI();
});
