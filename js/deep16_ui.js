/* deep16_ui.js */
class DeepWebUI {
    constructor() {
        this.assembler = new Deep16Assembler();
        this.simulator = new Deep16Simulator();
        this.disassembler = new Deep16Disassembler();
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
        this.initializeSearchableDropdowns();
        this.initializeTabs();
        this.updateAllDisplays();
        this.addTranscriptEntry("DeepWeb initialized and ready", "info");
    }

    initializeEventListeners() {
        document.getElementById('assemble-btn').addEventListener('click', () => this.assemble());
        document.getElementById('run-btn').addEventListener('click', () => this.run());
        document.getElementById('step-btn').addEventListener('click', () => this.step());
        document.getElementById('reset-btn').addEventListener('click', () => this.reset());
        document.getElementById('example-select').addEventListener('change', (e) => this.loadExample(e.target.value));
        document.getElementById('memory-jump-btn').addEventListener('click', () => this.jumpToMemoryAddress());
        
        // Simple symbol select handlers
        document.getElementById('symbol-select').addEventListener('change', (e) => {
            this.onSymbolSelect(e);
        });
        
        document.getElementById('listing-symbol-select').addEventListener('change', (e) => {
            this.onListingSymbolSelect(e);
        });
        
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

    initializeSearchableDropdowns() {
        // Using simple dropdowns without search for now
        console.log('Using simple dropdowns');
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

    assemble() {
        console.log("Assemble button clicked");
        const source = this.editorElement.value;
        this.status("Assembling...");
        this.addTranscriptEntry("Starting assembly", "info");

        try {
            const result = this.assembler.assemble(source);
            console.log("Assembly result:", result);
            
            this.currentAssemblyResult = result;
            
            if (result.success) {
                // Apply memory changes with segment info
                for (const change of result.memoryChanges) {
                    if (change.address < this.simulator.memory.length) {
                        this.simulator.memory[change.address] = change.value;
                    }
                }
                
                // Store segment information for display
                this.segmentInfo = this.buildSegmentInfo(result.listing);
                
                console.log("Simulator memory at 0x0000:", this.simulator.memory[0].toString(16));
                
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
        } catch (error) {
            console.error("Assembly error:", error);
            this.status("Assembly failed with exception");
            this.addTranscriptEntry(`Assembly exception: ${error.message}`, "error");
        }
    }

    // NEW: Build segment information from assembly results
    buildSegmentInfo(listing) {
        const segments = {
            code: { start: Infinity, end: -Infinity },
            data: { start: Infinity, end: -Infinity }
        };

        for (const item of listing) {
            if (item.address !== undefined && item.segment) {
                const segment = item.segment;
                if (item.address < segments[segment].start) {
                    segments[segment].start = item.address;
                }
                if (item.address > segments[segment].end) {
                    segments[segment].end = item.address;
                }
            }
        }

        // Add some padding around code segments for better display
        if (segments.code.start !== Infinity) {
            segments.code.start = Math.max(0, segments.code.start - 16);
            segments.code.end = segments.code.end + 32;
        }
        if (segments.data.start !== Infinity) {
            segments.data.start = Math.max(0, segments.data.start - 8);
            segments.data.end = segments.data.end + 16;
        }

        return segments;
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
            if (!select) {
                console.error('Symbol select element not found');
                return;
            }
            
            const currentValue = select.value;
            
            let html = '<option value="">-- Select Symbol --</option>';
            
            if (symbols && Object.keys(symbols).length > 0) {
                for (const [name, address] of Object.entries(symbols)) {
                    const displayText = `${name} (0x${address.toString(16).padStart(4, '0')})`;
                    html += `<option value="${address}">${displayText}</option>`;
                }
            }
            
            select.innerHTML = html;
            
            if (currentValue && select.querySelector(`option[value="${currentValue}"]`)) {
                select.value = currentValue;
            }
        });
    }

    onSymbolSelect(event) {
        const address = parseInt(event.target.value);
        if (!isNaN(address) && address >= 0) {
            this.memoryStartAddress = address;
            this.renderMemoryDisplay();
            document.getElementById('memory-start-address').value = '0x' + address.toString(16).padStart(4, '0');
            const symbolName = event.target.options[event.target.selectedIndex].text.split(' (')[0];
            this.addTranscriptEntry(`Memory view jumped to symbol: ${symbolName}`, "info");
        }
    }

    onListingSymbolSelect(event) {
        const address = parseInt(event.target.value);
        if (!isNaN(address) && address >= 0) {
            this.navigateToSymbolInListing(address);
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
            
            this.updateAllDisplays();
            
            if (!continueRunning) {
                clearInterval(this.runInterval);
                this.status("Program finished");
                this.addTranscriptEntry("Program execution completed", "success");
            }
        }, 50);
    }

    step() {
        this.simulator.running = true;
        const pcBefore = this.simulator.registers[15];
        const instruction = this.simulator.memory[pcBefore];
        
        console.log(`UI Step: PC=0x${pcBefore.toString(16).padStart(4, '0')}, Instruction=0x${instruction.toString(16).padStart(4, '0')}`);
        console.log(`Before step - R0=0x${this.simulator.registers[0].toString(16).padStart(4, '0')}`);
        
        const continueRunning = this.simulator.step();
        const pcAfter = this.simulator.registers[15];
        
        console.log(`After step - R0=0x${this.simulator.registers[0].toString(16).padStart(4, '0')}, PSW=0x${this.simulator.psw.toString(16).padStart(4, '0')}`);
        
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
            this.renderMemoryDisplay();
            input.value = '0x' + address.toString(16).padStart(4, '0');
            this.addTranscriptEntry(`Memory view jumped to 0x${address.toString(16).padStart(4, '0')}`, "info");
        } else {
            const errorMsg = `Invalid memory address: ${input.value}`;
            this.status(errorMsg);
            this.addTranscriptEntry(errorMsg, "error");
        }
    }

    updateAllDisplays() {
        this.updateRegisterDisplay();
        this.updatePSWDisplay();
        this.updateMemoryDisplay();
        this.updateSegmentRegisters();
        this.updateShadowRegisters();
        this.updateRecentMemoryDisplay();
    }

    updateRegisterDisplay() {
        const registerGrid = document.getElementById('register-grid');
        let html = '';
        
        // ENHANCED: Register names with both alias and number
        const registerNames = [
            'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7',
            'R8', 'R9', 'R10', 'R11', 'FP / R12', 'SP / R13', 'LR / R14', 'PC / R15'
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
        
        const start = this.memoryStartAddress;
        const end = Math.min(start + 64, this.simulator.memory.length);

        // Check if current PC is outside the visible range
        const currentPC = this.simulator.registers[15];
        const pcIsVisible = (currentPC >= start && currentPC < end);
        
        // If PC is not visible, adjust the start address to show it
        if (!pcIsVisible && currentPC < this.simulator.memory.length) {
            this.memoryStartAddress = Math.max(0, currentPC - 8);
            document.getElementById('memory-start-address').value = '0x' + this.memoryStartAddress.toString(16).padStart(4, '0');
            // Continue to render with the new address
        }

        // Rest of memory display code
        let html = '';
        
        if (start >= end) {
            html = '<div class="memory-line">Invalid memory range</div>';
        } else {
            let currentDataLineStart = -1;
            
            for (let address = start; address < end; address++) {
                const isCodeSegment = this.isCodeAddress(address);
                
                if (isCodeSegment) {
                    html += this.createCodeMemoryLine(address);
                    currentDataLineStart = -1;
                } else {
                    if ((address - start) % 8 === 0) {
                        currentDataLineStart = address;
                        html += this.createDataMemoryLine(address, Math.min(address + 8, end));
                    }
                }
            }
        }
        
        memoryDisplay.innerHTML = html || '<div class="memory-line">No memory content</div>';
        
        // Auto-scroll to the PC line if it's visible
        if (pcIsVisible) {
            this.scrollToPC();
        }
    }

    renderMemoryDisplay() {
        const memoryDisplay = document.getElementById('memory-display');
        const start = this.memoryStartAddress;
        const end = Math.min(start + 64, this.simulator.memory.length);

        let html = '';
        
        if (start >= end) {
            html = '<div class="memory-line">Invalid memory range</div>';
        } else {
            let currentDataLineStart = -1;
            
            for (let address = start; address < end; address++) {
                const isCodeSegment = this.isCodeAddress(address);
                
                if (isCodeSegment) {
                    html += this.createCodeMemoryLine(address);
                    currentDataLineStart = -1;
                } else {
                    if ((address - start) % 8 === 0) {
                        currentDataLineStart = address;
                        html += this.createDataMemoryLine(address, Math.min(address + 8, end));
                    }
                }
            }
        }
        
        memoryDisplay.innerHTML = html || '<div class="memory-line">No memory content</div>';
        
        // Scroll to PC if it's in the current view
        const currentPC = this.simulator.registers[15];
        if (currentPC >= start && currentPC < end) {
            this.scrollToPC();
        }
    }

    scrollToPC() {
        const memoryDisplay = document.getElementById('memory-display');
        const pcLine = memoryDisplay.querySelector('.pc-marker');
        
        if (pcLine) {
            pcLine.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center' 
            });
            
            // Add a highlight animation
            pcLine.style.animation = 'pulse-highlight 1s ease-in-out';
            setTimeout(() => {
                pcLine.style.animation = '';
            }, 1000);
        }
    }

        createCodeMemoryLine(address) {
        const value = this.simulator.memory[address];
        const valueHex = value.toString(16).padStart(4, '0').toUpperCase();
        const isPC = (address === this.simulator.registers[15]);
        const pcClass = isPC ? 'pc-marker' : '';
        let disasm = this.disassembler.disassemble(value);
        
        // Enhanced jump disassembly with absolute addresses
        if ((value >>> 12) === 0b1110) {
            disasm = this.disassembler.disassembleJumpWithAddress(value, address);
        }
        
        const source = this.getSourceForAddress(address);
        
        const displayValue = value === 0xFFFF ? "----" : `0x${valueHex}`;
        
        let html = `<div class="memory-line code-line ${pcClass}">`;
        html += `<span class="memory-address">0x${address.toString(16).padStart(4, '0')}</span>`;
        html += `<span class="memory-bytes">${displayValue}</span>`;
        html += `<span class="memory-disassembly">${disasm}</span>`;
        if (source) {
            html += `<span class="memory-source">; ${source}</span>`;
        }
        html += `</div>`;
        
        return html;
    }

    createDataMemoryLine(startAddr, endAddr) {
        let html = `<div class="memory-line data-line">`;
        html += `<span class="memory-address">0x${startAddr.toString(16).padStart(4, '0')}</span>`;
        
        for (let addr = startAddr; addr < endAddr; addr++) {
            const value = this.simulator.memory[addr];
            const valueHex = value.toString(16).padStart(4, '0').toUpperCase();
            const isPC = (addr === this.simulator.registers[15]);
            const pcClass = isPC ? 'pc-marker' : '';
            const displayValue = value === 0xFFFF ? "----" : `0x${valueHex}`;
            html += `<span class="memory-data ${pcClass}">${displayValue}</span>`;
        }
        
        html += `</div>`;
        return html;
    }

    isCodeAddress(address) {
        if (!this.segmentInfo || !this.segmentInfo.code) {
            return false;
        }
        
        return address >= this.segmentInfo.code.start && address <= this.segmentInfo.code.end;
    }

    getSourceForAddress(address) {
        if (!this.currentAssemblyResult) return '';
        
        const listing = this.currentAssemblyResult.listing;
        
        for (const item of listing) {
            if (item.address === address) {
                if (item.instruction !== undefined) {
                    return item.line ? item.line.trim() : '';
                } else if (item.line && (item.line.includes('.word') || item.line.includes('.org'))) {
                    return item.line.trim();
                }
            }
        }
        
        return '';
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

    updateRecentMemoryDisplay() {
        const recentDisplay = document.getElementById('recent-memory-display');
        const memoryView = this.simulator.getRecentMemoryView();
        
        if (!memoryView) {
            recentDisplay.innerHTML = 'No memory operations yet';
            return;
        }
        
        const { baseAddress, memoryWords, accessInfo } = memoryView;
        
        let html = '';
        
        // Create 4 lines of 8 words each
        for (let line = 0; line < 4; line++) {
            const lineStart = line * 8;
            const lineEnd = lineStart + 8;
            const lineAddress = baseAddress + lineStart;
            
            html += `<div class="recent-memory-line">`;
            html += `<span class="recent-memory-address">0x${lineAddress.toString(16).padStart(4, '0').toUpperCase()}</span>`;
            html += `<span class="recent-memory-data">`;
            
            for (let i = lineStart; i < lineEnd && i < memoryWords.length; i++) {
                const word = memoryWords[i];
                const valueHex = '0x' + word.value.toString(16).padStart(4, '0').toUpperCase();
                
                let wordClass = 'recent-memory-word';
                
                // RULE 2: Highlight base address and accessed address for LD/ST with offset
                if (accessInfo.offset !== 0) {
                    if (word.isBase) {
                        wordClass += ' recent-memory-base';
                    } else if (word.isCurrent) {
                        wordClass += ' recent-memory-current';
                    }
                } 
                // RULE 1: Only highlight accessed address for zero-offset accesses
                else if (word.isCurrent) {
                    wordClass += ' recent-memory-current';
                }
                
                html += `<span class="${wordClass}" title="Address: 0x${word.address.toString(16).padStart(4, '0').toUpperCase()}">${valueHex}</span>`;
            }
            
            html += `</span></div>`;
        }
        
        // Add access information
        const accessType = accessInfo.type === 'LD' ? 'Load' : 'Store';
        const offsetInfo = accessInfo.offset !== 0 ? 
            ` (base: 0x${accessInfo.baseAddress.toString(16).padStart(4, '0').toUpperCase()} + ${accessInfo.offset})` : 
            '';
        
        html += `<div class="recent-memory-info">${accessType} at 0x${accessInfo.address.toString(16).padStart(4, '0').toUpperCase()}${offsetInfo}</div>`;
        
        recentDisplay.innerHTML = html;
    }


    status(message) {
        document.getElementById('status-bar').textContent = `DeepWeb: ${message}`;
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

loadExample(exampleName) {
    let exampleCode = '';
    let exampleTitle = '';

    switch (exampleName) {
        case 'fibonacci':
            exampleCode = `; Deep16 (深十六) Fibonacci Example
; Calculate Fibonacci numbers F(0) through F(10)

.org 0x0000

main:
    LSI  R1, 0        ; F(0) = 0
    LSI  R2, 1        ; F(1) = 1
    LSI  R3, 10       ; Calculate F(2) through F(10)
    LDI  0x0200       ; Output address into R0
    MOV  R4, R0       ; Move to R4 for output pointer
    
    ST   R1, R4, 0    ; Store F(0)
    ADD  R4, 1        ; Next address
    ST   R2, R4, 0    ; Store F(1)  
    ADD  R4, 1        ; Next address
    
fib_loop:
    MOV  R0, R2       ; temp = current
    ADD  R2, R1       ; next = current + previous
    MOV  R1, R0       ; previous = temp
    
    ST   R2, R4, 0    ; Store the NEW Fibonacci number
    ADD  R4, 1        ; Next output address
    
    SUB  R3, 1        ; decrement counter
    JNZ  fib_loop     ; loop if not zero
    
    HALT

.org 0x0200
fibonacci_results:
    .word 0`;
            exampleTitle = "Fibonacci example";
            break;

case 'far_call':
    exampleCode = `; Deep16 (深十六) Far Call Example
; Demonstrates inter-segment procedure calls

.code
.org 0x0000

main:
    ; Initialize stack segment and pointer
    LDI  0x7F00       ; Stack segment base (0x7F00)
    MOV  R13, R0      ; SP = 0x7F00 (grows downward)
    SRD  R13          ; Set SR=13 and enable dual registers (SP+FP use SS)
    
    LDI  100          ; Initialize some test data
    MOV  R1, R0
    LDI  200
    MOV  R2, R0
    LDI  300  
    MOV  R3, R0
    
    ; Save current context for return
    MVS  R8, CS       ; Save current CS to R8
    MOV  R9, PC, 2    ; Save return address to R9
    
    ; Setup far call to segment 0x1000
    LDI  0x1000       ; Target CS = 0x1000
    MOV  R10, R0
    LDI  0x0200       ; Target PC = 0x0200
    MOV  R11, R0
    
    ; Perform far jump (JML uses R10 for CS, R11 for PC)
    JML  R10          ; Jump to CS=R10, PC=R11
    
    ; Execution continues here after far return
    LDI  50
    ADD  R1, R0       ; Modify data after return
    ST   R1, R0, 0    ; Store result
    
    HALT

.data
.org 0x0200
data_buffer:
    .word 0

.code  
.org 0x1000

far_function:
    ; Far function prologue - allocate stack frame
    SUB  R13, 3       ; Allocate space for 3 words: CS, ret_addr, R1
    ST   R8, R13, 0   ; Save caller's CS at [SP+0]
    ST   R9, R13, 1   ; Save return address at [SP+1]
    ST   R1, R13, 2   ; Save R1 at [SP+2]
    
    ; Far function body
    ADD  R1, R2       ; R1 = R1 + R2 (100 + 200 = 300)
    ADD  R1, R3       ; R1 = R1 + R3 (300 + 300 = 600)
    LDI  0x0100
    ST   R1, R0, 0    ; Store intermediate result
    
    ; Call another far function in same segment
    MOV  R14, PC, 2   ; Save return address in LR (R14)
    LDI  0x0300       ; Target PC for nested call
    MOV  R11, R0
    JML  R10          ; CS=R10 (0x1000), PC=R11 (0x0300)
    
    ; Continue after nested call returns
    LDI  50
    ADD  R1, R0       ; R1 = 650 + 50 = 700
    
    ; Far function epilogue - restore from stack frame
    LD   R1, R13, 2   ; Restore R1 from [SP+2]
    LD   R9, R13, 1   ; Restore return address from [SP+1]
    LD   R8, R13, 0   ; Restore caller's CS from [SP+0]
    ADD  R13, 3       ; Deallocate stack frame
    
    ; Return to caller (original segment)
    MOV  R10, R8, 0   ; Restore original CS to R10
    MOV  R11, R9, 0   ; Restore return address to R11
    JML  R10          ; Return to original segment

.code
.org 0x1300

nested_far_function:
    ; Nested function prologue
    SUB  R13, 1       ; Allocate space for return address
    ST   R14, R13, 0  ; Save return address at [SP+0]
    
    ; Nested function body
    LDI  50
    ADD  R1, R0       ; R1 = 600 + 50 = 650
    
    ; Nested function epilogue
    LD   R14, R13, 0  ; Restore return address from [SP+0]
    ADD  R13, 1       ; Deallocate stack frame
    
    ; Return to caller in same segment
    MOV  R11, R14, 0  ; Return address to R11 (CS still in R10)
    JML  R10          ; Return within same segment`;
    exampleTitle = "Far call example";
    break;

        default:
            return; // No example selected
    }

    this.editorElement.value = exampleCode;
    this.addTranscriptEntry(`${exampleTitle} loaded into editor`, "info");
    this.status(`${exampleTitle} ready - click 'Assemble' to compile`);
    
    // Reset the dropdown
    document.getElementById('example-select').value = '';
}
}

document.addEventListener('DOMContentLoaded', () => {
    window.deepWebUI = new DeepWebUI();
});
/* deep16_ui.js */
