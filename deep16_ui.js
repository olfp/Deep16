/* deep16_ui.js */
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
        this.symbolsExpanded = false;
        this.registersExpanded = true;
        this.compactView = false;
        this.segmentInfo = {
            code: { start: 0x0000, end: 0x00FF },
            data: { start: 0x0100, end: 0x03FF },
            stack: { start: 0x0400, end: 0x7FFF }
        };

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
        document.getElementById('listing-symbol-select').addEventListener('change', (e) => this.onListingSymbolSelect(e));
        document.getElementById('view-toggle').addEventListener('click', () => this.toggleView());
        
        document.getElementById('memory-start-address').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.jumpToMemoryAddress();
        });

        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        document.querySelectorAll('.section-title').forEach(title => {
            title.addEventListener('click', (e) => {
                if (e.target.classList.contains('section-title')) {
                    this.toggleRegisterSection(e.target);
                }
            });
        });

        window.addEventListener('resize', () => this.updateMemoryDisplay());
    }

    toggleView() {
        this.compactView = !this.compactView;
        const memoryPanel = document.querySelector('.memory-panel');
        const viewToggle = document.getElementById('view-toggle');
        
        if (this.compactView) {
            memoryPanel.classList.add('compact-view');
            viewToggle.textContent = 'Full View';
            this.addTranscriptEntry("Switched to Compact view - PSW only", "info");
        } else {
            memoryPanel.classList.remove('compact-view');
            viewToggle.textContent = 'Compact View';
            this.addTranscriptEntry("Switched to Full view - All registers visible", "info");
        }
        
        this.updateMemoryDisplayHeight();
    }

    toggleRegisterSection(titleElement) {
        if (this.compactView) return;
        
        const section = titleElement.closest('.register-section');
        section.classList.toggle('collapsed');
        
        const toggle = titleElement.querySelector('.section-toggle');
        if (section.classList.contains('collapsed')) {
            toggle.textContent = '▶';
        } else {
            toggle.textContent = '▼';
        }
        
        this.updateMemoryDisplayHeight();
    }

    updateMemoryDisplayHeight() {
        const memoryDisplay = document.getElementById('memory-display');
        setTimeout(() => {
            memoryDisplay.style.height = 'auto';
        }, 10);
    }

    initializeTabs() {
        this.switchTab('editor');
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tabName);
        });

        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}-tab`);
        });

        if (tabName === 'listing' && this.currentAssemblyResult) {
            this.updateAssemblyListing();
        }
    }

    initializeTestMemory() {
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
            this.simulator.memory.fill(0);
            for (let i = 0; i < result.memory.length; i++) {
                this.simulator.memory[i] = result.memory[i];
            }
            
            this.simulator.registers[15] = 0x0000;
            this.status("Assembly successful! Program loaded.");
            this.addTranscriptEntry("Assembly successful - program loaded", "success");
            document.getElementById('run-btn').disabled = false;
            document.getElementById('step-btn').disabled = false;
            document.getElementById('reset-btn').disabled = false;
            
            this.updateSymbolSelects(result.symbols);
            this.addTranscriptEntry(`Found ${Object.keys(result.symbols).length} symbols`, "info");
            
            this.switchTab('listing');
        } else {
            const errorMsg = `Assembly failed with ${result.errors.length} error(s)`;
            this.status("Assembly errors - see errors tab for details");
            this.addTranscriptEntry(errorMsg, "error");
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

            document.querySelectorAll('.error-item').forEach(item => {
                item.addEventListener('click', () => {
                    const lineNumber = parseInt(item.dataset.line);
                    this.navigateToError(lineNumber);
                });
            });
        }
    }

    navigateToError(lineNumber) {
        this.switchTab('editor');
        this.editorElement.focus();
        
        const lines = this.editorElement.value.split('\n');
        let position = 0;
        for (let i = 0; i < lineNumber && i < lines.length; i++) {
            position += lines[i].length + 1;
        }
        
        this.editorElement.setSelectionRange(position, position);
        const lineHeight = 16;
        this.editorElement.scrollTop = (lineNumber - 3) * lineHeight;
        
        this.addTranscriptEntry(`Navigated to error at line ${lineNumber + 1}`, "info");
    }

    updateSymbolSelects(symbols) {
        const symbolSelects = [
            document.getElementById('symbol-select'),
            document.getElementById('listing-symbol-select')
        ];
        
        symbolSelects.forEach(select => {
            let html = '<option value="">-- Select Symbol --</option>';
            
            if (symbols && Object.keys(symbols).length > 0) {
                for (const [name, address] of Object.entries(symbols)) {
                    html += `<option value="${address}">${name} (0x${address.toString(16).padStart(4, '0')})</option>`;
                }
            }
            
            select.innerHTML = html;
        });
    }

    onListingSymbolSelect(event) {
        const address = parseInt(event.target.value);
        if (!isNaN(address) && address >= 0) {
            this.navigateToSymbolInListing(address);
            event.target.value = '';
        }
    }

    navigateToSymbolInListing(symbolAddress) {
        const listingContent = document.getElementById('listing-content');
        const lines = listingContent.querySelectorAll('.listing-line');
        
        lines.forEach(line => line.classList.remove('symbol-highlight'));
        
        let targetLine = null;
        for (const line of lines) {
            const addressSpan = line.querySelector('.listing-address');
            if (addressSpan) {
                const lineAddress = parseInt(addressSpan.textContent.replace('0x', ''), 16);
                if (lineAddress === symbolAddress) {
                    targetLine = line;
                    break;
                }
            }
        }
        
        if (targetLine) {
            targetLine.classList.add('symbol-highlight');
            targetLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            const symbolName = Object.entries(this.currentAssemblyResult.symbols).find(
                ([name, addr]) => addr === symbolAddress
            )?.[0] || 'unknown';
            
            this.addTranscriptEntry(`Navigated to symbol: ${symbolName} (0x${symbolAddress.toString(16).padStart(4, '0')})`, "info");
        } else {
            this.addTranscriptEntry(`Symbol not found in listing at address 0x${symbolAddress.toString(16).padStart(4, '0')}`, "warning");
        }
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
                html += `<div class="listing-line" style="color: #f44747;">`;
                html += `<span class="listing-address"></span>`;
                html += `<span class="listing-bytes"></span>`;
                html += `<span class="listing-source">ERR: ${item.error}</span>`;
                html += `</div>`;
                
                if (item.line) {
                    html += `<div class="listing-line">`;
                    html += `<span class="listing-address"></span>`;
                    html += `<span class="listing-bytes"></span>`;
                    html += `<span class="listing-source" style="color: #ce9178;">${item.line}</span>`;
                    html += `</div>`;
                }
            } else if (item.instruction !== undefined) {
                const instructionHex = item.instruction.toString(16).padStart(4, '0').toUpperCase();
                html += `<div class="listing-line">`;
                html += `<span class="listing-address">0x${item.address.toString(16).padStart(4, '0')}</span>`;
                html += `<span class="listing-bytes">0x${instructionHex}</span>`;
                html += `<span class="listing-source">${item.line}</span>`;
                html += `</div>`;
            } else if (item.address !== undefined && (item.line.includes('.org') || item.line.includes('.word'))) {
                html += `<div class="listing-line">`;
                html += `<span class="listing-address">0x${item.address.toString(16).padStart(4, '0')}</span>`;
                html += `<span class="listing-bytes"></span>`;
                html += `<span class="listing-source">${item.line}</span>`;
                html += `</div>`;
            } else if (item.line && item.line.trim().endsWith(':')) {
                html += `<div class="listing-line">`;
                html += `<span class="listing-address"></span>`;
                html += `<span class="listing-bytes"></span>`;
                html += `<span class="listing-source" style="color: #569cd6;">${item.line}</span>`;
                html += `</div>`;
            } else if (item.line && (item.line.trim().startsWith(';') || item.line.trim() === '')) {
                html += `<div class="listing-line">`;
                html += `<span class="listing-address"></span>`;
                html += `<span class="listing-bytes"></span>`;
                html += `<span class="listing-source" style="color: #6a9955;">${item.line}</span>`;
                html += `</div>`;
            } else if (item.line) {
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
        
        document.getElementById('psw-de').checked = (psw & 0x8000) !== 0;
        document.getElementById('psw-ds').checked = (psw & 0x0400) !== 0;
        document.getElementById('psw-s').checked = (psw & 0x0020) !== 0;
        document.getElementById('psw-i').checked = (psw & 0x0010) !== 0;
        document.getElementById('psw-c').checked = (psw & 0x0008) !== 0;
        document.getElementById('psw-v').checked = (psw & 0x0004) !== 0;
        document.getElementById('psw-z').checked = (psw & 0x0002) !== 0;
        document.getElementById('psw-n').checked = (psw & 0x0001) !== 0;
        
        document.getElementById('psw-er').textContent = (psw >> 11) & 0xF;
        document.getElementById('psw-sr').textContent = (psw >> 6) & 0xF;
    }

    updateMemoryDisplay() {
        const memoryDisplay = document.getElementById('memory-display');
        let html = '';
        
        const start = this.memoryStartAddress;
        const end = Math.min(start + this.getWordsPerLine() * 8, this.simulator.memory.length);

        if (start >= end) {
            html = '<div class="memory-line">Invalid memory range</div>';
        } else {
            const wordsPerLine = this.getWordsPerLine();
            
            for (let lineStart = start; lineStart < end; lineStart += wordsPerLine) {
                const lineEnd = Math.min(lineStart + wordsPerLine, end);
                html += this.createMemoryLine(lineStart, lineEnd, wordsPerLine);
            }
        }
        
        memoryDisplay.innerHTML = html || '<div class="memory-line">No memory content</div>';
    }

    getWordsPerLine() {
        const screenWidth = window.innerWidth;
        if (screenWidth < 480) return 2;
        if (screenWidth < 768) return 4;
        if (screenWidth < 1024) return 8;
        return 16;
    }

    createMemoryLine(startAddr, endAddr, wordsPerLine) {
        const isCodeSegment = this.isCodeAddress(startAddr);
        let html = '';
        
        html += `<div class="memory-line-header">`;
        html += `<span class="memory-address">0x${startAddr.toString(16).padStart(4, '0')}</span>`;
        
        for (let i = startAddr; i < endAddr; i++) {
            const value = this.simulator.memory[i];
            const valueHex = value.toString(16).padStart(4, '0').toUpperCase();
            const isPC = (i === this.simulator.registers[15]);
            const pcClass = isPC ? 'pc-marker' : '';
            
            html += `<span class="memory-bytes ${pcClass}">0x${valueHex}</span>`;
        }
        
        html += `</div>`;
        
        if (isCodeSegment) {
            html += `<div class="memory-disassembly-line">`;
            for (let i = startAddr; i < endAddr; i++) {
                const instruction = this.simulator.memory[i];
                const disasm = this.disassembleInstruction(instruction);
                const source = this.getSourceForAddress(i);
                
                html += `<span class="memory-disassembly">${disasm}</span>`;
                if (source) {
                    html += `<span class="memory-source">; ${source}</span>`;
                }
            }
            html += `</div>`;
        } else {
            html += `<div class="memory-data-line">`;
            for (let i = startAddr; i < endAddr; i++) {
                const value = this.simulator.memory[i];
                html += `<span class="memory-data">.dw 0x${value.toString(16).padStart(4, '0')}</span>`;
            }
            html += `</div>`;
        }
        
        return html;
    }

    isCodeAddress(address) {
        return address >= this.segmentInfo.code.start && address < this.segmentInfo.code.end;
    }

    getSourceForAddress(address) {
        if (!this.currentAssemblyResult) return '';
        
        const listing = this.currentAssemblyResult.listing;
        const item = listing.find(item => item.address === address);
        return item ? item.line.trim() : '';
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
                const regNames = ['R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','FP','SP','LR','PC'];
                return d === 0 ? 
                    `LD ${regNames[rd]}, [${regNames[rb]}+${offset}]` : 
                    `ST ${regNames[rd]}, [${regNames[rb]}+${offset}]`;
                    
            case 0b110:
                return this.disassembleALU(instruction);
                
            case 0b111: 
                return this.disassembleControlFlow(instruction);
                
            default: 
                return `??? (0x${instruction.toString(16)})`;
        }
    }

    disassembleALU(instruction) {
        const aluOp = (instruction >> 10) & 0x7;
        const rd = (instruction >> 8) & 0xF;
        const w = (instruction >> 7) & 0x1;
        const i = (instruction >> 6) & 0x1;
        const operand = instruction & 0xF;
        
        const aluOps = ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'MUL', 'DIV', 'SHIFT'];
        const regNames = ['R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','FP','SP','LR','PC'];
        
        let opStr = aluOps[aluOp];
        let operandStr = i === 0 ? regNames[operand] : `#${operand}`;
        
        if (aluOp === 0b111) {
            return this.disassembleShift(instruction);
        }
        
        if (w === 0) {
            const flagOps = ['ANW', 'CMP', 'TBS', 'TBC', '', '', '', ''];
            opStr = flagOps[aluOp] || opStr;
        }
        
        return `${opStr} ${regNames[rd]}, ${operandStr}`;
    }

    disassembleShift(instruction) {
        const rd = (instruction >> 8) & 0xF;
        const shiftType = (instruction >> 4) & 0x7;
        const count = instruction & 0xF;
        
        const shiftOps = ['SL', 'SLC', 'SR', 'SRC', 'SRA', 'SAC', 'ROR', 'ROC'];
        const regNames = ['R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','FP','SP','LR','PC'];
        
        return `${shiftOps[shiftType]} ${regNames[rd]}, #${count}`;
    }

    disassembleControlFlow(instruction) {
        if ((instruction >> 12) === 0b1110) {
            const condition = (instruction >> 9) & 0x7;
            const conditions = ['JZ', 'JNZ', 'JC', 'JNC', 'JN', 'JNN', 'JO', 'JNO'];
            const offset = instruction & 0x1FF;
            const signedOffset = (offset & 0x100) ? (offset | 0xFE00) : offset;
            return `${conditions[condition]} ${signedOffset}`;
        }
        
        if ((instruction >> 10) === 0b111110) {
            const rd = (instruction >> 8) & 0xF;
            const rs = (instruction >> 4) & 0xF;
            const imm = instruction & 0x3;
            const regNames = ['R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','FP','SP','LR','PC'];
            return `MOV ${regNames[rd]}, ${regNames[rs]}, ${imm}`;
        }
        
        if ((instruction >> 9) === 0b1111110) {
            const rd = (instruction >> 8) & 0xF;
            let imm = (instruction >> 4) & 0x1F;
            if (imm & 0x10) imm |= 0xFFE0;
            const regNames = ['R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','FP','SP','LR','PC'];
            return `LSI ${regNames[rd]}, ${imm}`;
        }
        
        if ((instruction >> 13) === 0b11111) {
            const sysOp = instruction & 0x7;
            const sysOps = ['NOP', 'HLT', 'SWI', 'RETI', '', '', '', ''];
            return sysOps[sysOp] || 'SYS';
        }
        
        return '???';
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

    status(message) {
        document.getElementById('status-bar').textContent = `DeepWeb: ${message}`;
    }

    loadExample() {
        const fibonacciExample = `; Deep16 (深十六) Fibonacci Example
; Calculate Fibonacci numbers

.org 0x0000

main:
    LDI  0x7FFF    ; Load stack pointer value into R0
    MOV  SP, R0    ; Initialize stack pointer
    LSI  R0, 0     ; F(0) = 0
    LSI  R1, 1     ; F(1) = 1
    LSI  R2, 10    ; Calculate up to F(10)
    LDI  0x0200    ; Output address into R0
    MOV  R3, R0    ; Move to R3
    
fib_loop:
    ST   R0, R3, 0     ; Store current Fibonacci
    ADD  R3, 1         ; Next output address
    
    MOV  R4, R1        ; temp = current
    ADD  R1, R0        ; next = current + previous
    MOV  R0, R4        ; previous = temp
    
    SUB  R2, 1         ; decrement counter
    JNZ  fib_loop      ; loop if not zero
    
    HALT

.org 0x0200
fibonacci_results:
    .word 0`;
        
        this.editorElement.value = fibonacciExample;
        this.addTranscriptEntry("Fibonacci example loaded into editor", "info");
        this.status("Fibonacci example ready - click 'Assemble' to compile");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.deepWebUI = new DeepWebUI();
});
/* deep16_ui.js */
