/* deep16_ui_core.js - Main UI class and core functionality */
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
            code: { start: 0x0000, end: 0x1FFF },
            data: { start: 0x2000, end: 0x3FFF },
            stack: { start: 0x4000, end: 0x7FFF }
        };

        // Web Worker support
        this.worker = null;
        this.workerSupported = typeof Worker !== 'undefined';
        this.useWorker = false;
        this.turboMode = false;

        // Initialize modules
        this.memoryUI = new Deep16MemoryUI(this);
        this.registerUI = new Deep16RegisterUI(this);
        this.screenUI = new Deep16ScreenUI(this); 
        this.simulator.setUI(this);

        // File management
        this.currentFilename = 'Untitled.asm';
        this.fileModified = false;
        this.fileHandle = null; // For File System Access API
    
        // Initialize file menu
        this.initializeFileMenu();

        this.manualAddressChange = false;

        this.examples = [];
        this.loadExamplesList();

        this.initializeEventListeners();
        this.initializeSearchableDropdowns();
        this.initializeTabs();
        this.initializeWorker();
        this.initializeWorkerToggle();
        this.addWorkerStyles();
        this.updateAllDisplays();
        this.addTranscriptEntry("DeepCode initialized and ready", "info");
    }

    initializeWorker() {
        if (!this.workerSupported) {
            console.log('Web Workers not supported, using main thread');
            return;
        }
        
        try {
            this.worker = new Worker('deep16_worker.js');
            this.worker.onmessage = (e) => this.handleWorkerMessage(e);
            this.worker.onerror = (error) => {
                console.error('Worker error:', error);
                this.useWorker = false;
                this.updateWorkerToggle();
            };
        } catch (error) {
            console.error('Failed to create worker:', error);
            this.workerSupported = false;
            this.useWorker = false;
        }
    }

    initializeWorkerToggle() {
        if (!this.workerSupported) return;
        
        const controlPanel = document.querySelector('.control-panel');
        if (controlPanel) {
            const workerBtn = document.createElement('button');
            workerBtn.id = 'worker-btn';
            workerBtn.className = 'control-btn';
            workerBtn.textContent = 'Worker: OFF';
            workerBtn.addEventListener('click', () => this.toggleWorker());
            controlPanel.appendChild(workerBtn);
        }

        const turboBtn = document.createElement('button');
        turboBtn.id = 'turbo-btn';
        turboBtn.className = 'control-btn';
        turboBtn.textContent = 'Turbo: OFF';
        turboBtn.addEventListener('click', () => this.toggleTurboMode());
        controlPanel.appendChild(turboBtn);
        const screenBufBtn = document.createElement('button');
        screenBufBtn.id = 'screen-buffer-btn';
        screenBufBtn.className = 'control-btn';
        screenBufBtn.textContent = 'Screen Buffer: OFF';
        screenBufBtn.addEventListener('click', () => this.toggleScreenBuffer());
        controlPanel.appendChild(screenBufBtn);
    }

    toggleWorker() {
        if (!this.workerSupported) return;
        
        this.useWorker = !this.useWorker;
        const workerBtn = document.getElementById('worker-btn');
        if (workerBtn) {
            workerBtn.textContent = `Worker: ${this.useWorker ? 'ON' : 'OFF'}`;
            workerBtn.className = `control-btn ${this.useWorker ? 'worker-active' : ''}`;
        }
        
        if (this.useWorker && this.worker) {
            // Initialize worker with current state
            this.worker.postMessage({
                type: 'INIT',
                data: {
                    memory: this.simulator.memory,
                    registers: this.simulator.registers,
                    psw: this.simulator.psw
                }
            });
        }
    }

    toggleTurboMode() {
        this.turboMode = !this.turboMode;
        const turboBtn = document.getElementById('turbo-btn');
        if (turboBtn) {
            turboBtn.textContent = `Turbo: ${this.turboMode ? 'ON' : 'OFF'}`;
            turboBtn.className = `control-btn ${this.turboMode ? 'turbo-active' : ''}`;
        }
    }

    toggleScreenBuffer() {
        const flag = !this.screenUI.deferUpdates;
        this.screenUI.setDeferUpdates(flag);
        const btn = document.getElementById('screen-buffer-btn');
        if (btn) {
            btn.textContent = `Screen Buffer: ${flag ? 'ON' : 'OFF'}`;
            btn.className = `control-btn ${flag ? 'screen-buffer-active' : ''}`;
        }
    }

    handleWorkerMessage(e) {
        const { type, data } = e.data;
        
        switch (type) {
            case 'BATCH_UPDATE':
                // Update simulator state from worker
                this.simulator.registers = data.registers;
                this.simulator.psw = data.psw;
                this.simulator.memory = data.memory;
                this.simulator.running = data.running;
                
                // Update UI less frequently for better performance
                if (data.stepsExecuted > 0) {
                    this.updateAllDisplays();
                }
                break;
                
            case 'STEP_RESULT':
                this.simulator.registers = data.registers;
                this.simulator.psw = data.psw;
                this.simulator.memory = data.memory;
                this.simulator.running = data.running;
                this.updateAllDisplays();
                break;
                
            case 'EXECUTION_COMPLETE':
                this.simulator.registers = data.registers;
                this.simulator.psw = data.psw;
                this.simulator.memory = data.memory;
                this.simulator.running = false;
                this.updateAllDisplays();
                this.status("Program completed");
                this.addTranscriptEntry("Program execution completed", "success");
                break;
        }
    }

    addWorkerStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .worker-active {
                background-color: #4CAF50 !important;
                color: white !important;
            }
            .turbo-active {
                background-color: #ff9800 !important;
                color: white !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Add new methods for file operations
    initializeFileMenu() {
        const fileMenuBtn = document.getElementById('file-menu-btn');
        const fileDropdown = document.getElementById('file-dropdown');
        
        // File menu toggle
        fileMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileDropdown.classList.toggle('show');
        });
        
        // File operations
        document.getElementById('new-file-btn').addEventListener('click', () => {
            this.newFile();
            fileDropdown.classList.remove('show');
        });
        document.getElementById('load-file-btn').addEventListener('click', () => {
            this.loadFile();
            fileDropdown.classList.remove('show');
        });
        document.getElementById('save-file-btn').addEventListener('click', () => {
            this.saveFile();
            fileDropdown.classList.remove('show');
        });
        document.getElementById('save-as-btn').addEventListener('click', () => {
            this.saveAsFile();
            fileDropdown.classList.remove('show');
        });
        document.getElementById('print-btn').addEventListener('click', () => {
            this.printFile();
            fileDropdown.classList.remove('show');
        });
        
        // Track editor changes for modified status
        this.editorElement.addEventListener('input', () => {
            this.setFileModified(true);
        });
        
        // Initialize file status
        this.updateFileStatus();
    }

    newFile() {
        if (this.fileModified) {
            if (!confirm('You have unsaved changes. Create new file anyway?')) {
                return;
            }
        }
        
        this.editorElement.value = '; New Deep16 Program\n.org 0x0000\n\nmain:\n    ; Your code here\n    HALT\n';
        this.currentFilename = 'Untitled.asm';
        this.fileHandle = null;
        this.setFileModified(false);
        this.updateFileStatus();
        this.addTranscriptEntry("Created new file", "info");
    }

    async loadFile() {
        if (this.fileModified) {
            if (!confirm('You have unsaved changes. Load new file anyway?')) {
                return;
            }
        }
        
        try {
            // Use File System Access API if available, fallback to traditional input
            if ('showOpenFilePicker' in window) {
                const [fileHandle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'Deep16 Assembly Files',
                        accept: {'text/plain': ['.asm', '.s']}
                    }]
                });
                const file = await fileHandle.getFile();
                const contents = await file.text();
                this.editorElement.value = contents;
                this.currentFilename = file.name;
                this.fileHandle = fileHandle;
                this.setFileModified(false);
                this.addTranscriptEntry(`Loaded file: ${file.name}`, "success");
            } else {
                // Fallback for browsers without File System Access API
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.asm,.s';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            this.editorElement.value = e.target.result;
                            this.currentFilename = file.name;
                            this.setFileModified(false);
                            this.addTranscriptEntry(`Loaded file: ${file.name}`, "success");
                        };
                        reader.readAsText(file);
                    }
                };
                input.click();
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                this.addTranscriptEntry(`Error loading file: ${error.message}`, "error");
            }
        }
        
        this.updateFileStatus();
    }

    async saveFile() {
        try {
            const contents = this.editorElement.value;
            
            if (this.fileHandle) {
                // Save to existing file
                const writable = await this.fileHandle.createWritable();
                await writable.write(contents);
                await writable.close();
                this.setFileModified(false);
                this.addTranscriptEntry(`Saved: ${this.currentFilename}`, "success");
            } else {
                // No file handle, use Save As
                await this.saveAsFile();
            }
        } catch (error) {
            this.addTranscriptEntry(`Error saving file: ${error.message}`, "error");
        }
        
        this.updateFileStatus();
    }

    async saveAsFile() {
        try {
            const contents = this.editorElement.value;
            
            if ('showSaveFilePicker' in window) {
                const fileHandle = await window.showSaveFilePicker({
                    types: [{
                        description: 'Deep16 Assembly Files',
                        accept: {'text/plain': ['.asm']}
                    }],
                    suggestedName: this.currentFilename
                });
                
                const writable = await fileHandle.createWritable();
                await writable.write(contents);
                await writable.close();
                
                this.currentFilename = fileHandle.name;
                this.fileHandle = fileHandle;
                this.setFileModified(false);
                this.addTranscriptEntry(`Saved as: ${fileHandle.name}`, "success");
            } else {
                // Fallback for browsers without File System Access API
                const blob = new Blob([contents], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = this.currentFilename;
                a.click();
                URL.revokeObjectURL(url);
                this.addTranscriptEntry(`Downloaded: ${this.currentFilename}`, "success");
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                this.addTranscriptEntry(`Error saving file: ${error.message}`, "error");
            }
        }
        
        this.updateFileStatus();
    }

    printFile() {
        const contents = this.editorElement.value;
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>${this.currentFilename}</title>
                    <style>
                        body { font-family: 'Courier New', monospace; font-size: 12px; white-space: pre; }
                        .comment { color: #6a9955; }
                    </style>
                </head>
                <body>${contents.replace(/;/g, '<span class="comment">;')}</span></body>
            </html>
        `);
        printWindow.document.close();
        printWindow.print();
        this.addTranscriptEntry("Printed current file", "info");
    }

    setFileModified(modified) {
        this.fileModified = modified;
        this.updateFileStatus();
    }

    updateFileStatus() {
        const filenameElement = document.getElementById('current-filename');
        const statusElement = document.getElementById('file-status');
        
        // Check if elements exist before trying to update them
        if (!filenameElement || !statusElement) {
            console.warn('File status elements not found in DOM');
            return;
        }
        
        filenameElement.textContent = this.currentFilename;
        
        if (this.fileModified) {
            statusElement.textContent = '● Modified';
            statusElement.className = 'file-status-modified';
        } else {
            statusElement.textContent = '● Clean';
            statusElement.className = 'file-status-clean';
        }
    }

    // Edit menu functionality
    undo() {
        document.execCommand('undo');
        this.addTranscriptEntry("Undo", "info");
    }

    redo() {
        document.execCommand('redo');
        this.addTranscriptEntry("Redo", "info");
    }

    cut() {
        document.execCommand('cut');
        this.addTranscriptEntry("Cut", "info");
    }

    copy() {
        document.execCommand('copy');
        this.addTranscriptEntry("Copy", "info");
    }

    paste() {
        document.execCommand('paste');
        this.addTranscriptEntry("Paste", "info");
    }

    selectAll() {
        this.editorElement.select();
        this.addTranscriptEntry("Select All", "info");
    }

    find() {
        const searchText = prompt("Find:");
        if (searchText) {
            const content = this.editorElement.value;
            const index = content.toLowerCase().indexOf(searchText.toLowerCase());
            if (index !== -1) {
                this.editorElement.focus();
                this.editorElement.setSelectionRange(index, index + searchText.length);
                this.addTranscriptEntry(`Found: "${searchText}"`, "success");
            } else {
                this.addTranscriptEntry(`"${searchText}" not found`, "warning");
            }
        }
    }

    initializeEventListeners() {
        // Update these to point to the new elements in editor header
        document.getElementById('assemble-btn').addEventListener('click', () => this.assemble());
        document.getElementById('example-select').addEventListener('change', (e) => this.loadExample(e.target.value));
        document.getElementById('run-btn').addEventListener('click', () => this.run());
        document.getElementById('step-btn').addEventListener('click', () => this.step());
        document.getElementById('reset-btn').addEventListener('click', () => this.reset());
        
        // Add event listeners for Edit menu items
        document.getElementById('undo-btn').addEventListener('click', () => this.undo());
        document.getElementById('redo-btn').addEventListener('click', () => this.redo());
        document.getElementById('cut-btn').addEventListener('click', () => this.cut());
        document.getElementById('copy-btn').addEventListener('click', () => this.copy());
        document.getElementById('paste-btn').addEventListener('click', () => this.paste());
        document.getElementById('select-all-btn').addEventListener('click', () => this.selectAll());
        document.getElementById('find-btn').addEventListener('click', () => this.find());
        
        // Simple symbol select handlers
        document.getElementById('symbol-select').addEventListener('change', (e) => {
            this.onSymbolSelect(e);
        });
        
        document.getElementById('listing-symbol-select').addEventListener('change', (e) => {
            this.onListingSymbolSelect(e);
        });
        
        document.getElementById('view-toggle').addEventListener('click', () => this.toggleView());

        // FIXED: Proper memory address input handling
        const memoryAddressInput = document.getElementById('memory-start-address');
        if (memoryAddressInput) {
            console.log('Setting up memory address input event listeners');
            
            // Handle Enter key
            memoryAddressInput.addEventListener('keypress', (e) => {
                console.log('Key pressed in memory address input:', e.key);
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleMemoryAddressInput();
                }
            });
        }

        // NEW: Segmented navigation
        document.getElementById('goto-segment-btn').addEventListener('click', () => this.gotoSegmentAddress());
        
        // Also handle Enter key in CS/PC inputs
        document.getElementById('cs-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.gotoSegmentAddress();
        });
        document.getElementById('pc-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.gotoSegmentAddress();
        });

        
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        document.querySelectorAll('.section-title').forEach(title => {
            title.addEventListener('click', (e) => {
                if (e.target.classList.contains('section-title')) {
                    this.registerUI.toggleRegisterSection(e.target);
                }
            });
        });

        // Edit menu toggle
        document.getElementById('edit-menu-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('edit-dropdown').classList.toggle('show');
        });

        // Close dropdowns when clicking elsewhere
        document.addEventListener('click', () => {
            document.getElementById('file-dropdown').classList.remove('show');
            document.getElementById('edit-dropdown').classList.remove('show');
        });

        // Update example selector handler
        document.getElementById('example-select').addEventListener('change', (e) => {
            const filename = e.target.value;
            if (filename) {
                this.loadExample(filename);
            }
        });

        // Tab key support for editor
        this.editorElement.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                
                const start = this.editorElement.selectionStart;
                const end = this.editorElement.selectionEnd;
                
                this.editorElement.value = this.editorElement.value.substring(0, start) + 
                                          '\t' + 
                                          this.editorElement.value.substring(end);
                
                this.editorElement.selectionStart = this.editorElement.selectionEnd = start + 1;
            }
        });        
    }

    initializeSearchableDropdowns() {
        console.log('Using simple dropdowns');
    }

    // In deep16_ui_core.js - Replace handleMemoryAddressInput method:
    handleMemoryAddressInput() {
        const input = document.getElementById('memory-start-address');
        if (!input) {
            console.error('Memory address input not found');
            return;
        }
        
        let value = input.value.trim();
        console.log('Memory address input value:', value);
        
        // If empty, use current address
        if (value === '') {
            input.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
            return;
        }
        
        // Remove 0x prefix if present
        if (value.toLowerCase().startsWith('0x')) {
            value = value.substring(2);
        }
        
        // Parse as hex
        const address = parseInt(value, 16);
        console.log('Parsed address:', address, 'isNaN:', isNaN(address));
        
        if (!isNaN(address) && address >= 0 && address < this.simulator.memory.length) {
            console.log('Setting memory start address to:', address);
            this.memoryStartAddress = address;
            input.value = '0x' + address.toString(16).padStart(5, '0').toUpperCase();
            
            // CRITICAL: Call renderMemoryDisplay directly instead of updateMemoryDisplay
            // This bypasses the auto-adjust logic for manual changes
            this.memoryUI.renderMemoryDisplay();
            
            // Add a temporary flag to prevent auto-adjust on the next update
            this.manualAddressChange = true;
            
            console.log('Manual address change completed, calling renderMemoryDisplay directly');
        } else {
            // Invalid address - reset to current
            console.log('Invalid address, resetting to:', this.memoryStartAddress);
            input.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0').toUpperCase();
        }
    }

    gotoSegmentAddress() {
        const csInput = document.getElementById('cs-input');
        const pcInput = document.getElementById('pc-input');
        
        if (!csInput || !pcInput) {
            console.error('CS or PC input not found');
            return;
        }
        
        let csValue = csInput.value.trim();
        let pcValue = pcInput.value.trim();
        
        console.log(`gotoSegmentAddress: CS='${csValue}', PC='${pcValue}'`);
        
        // Parse CS value
        if (csValue.toLowerCase().startsWith('0x')) {
            csValue = csValue.substring(2);
        }
        const csAddress = parseInt(csValue, 16);
        
        // Parse PC value  
        if (pcValue.toLowerCase().startsWith('0x')) {
            pcValue = pcValue.substring(2);
        }
        const pcAddress = parseInt(pcValue, 16);
        
        console.log(`Parsed: CS=0x${csAddress.toString(16)}, PC=0x${pcAddress.toString(16)}`);
        
        // Validate addresses (16-bit segment and offset)
        if (isNaN(csAddress) || csAddress < 0 || csAddress > 0xFFFF) {
            this.addTranscriptEntry(`Invalid CS address: ${csInput.value}`, "error");
            csInput.value = '0x' + this.simulator.segmentRegisters.CS.toString(16).padStart(4, '0');
            return;
        }
        
        if (isNaN(pcAddress) || pcAddress < 0 || pcAddress > 0xFFFF) {
            this.addTranscriptEntry(`Invalid PC address: ${pcInput.value}`, "error");
            pcInput.value = '0x' + this.simulator.registers[15].toString(16).padStart(4, '0');
            return;
        }
        
        // Calculate physical address: CS << 4 + PC (20-bit physical address)
        const physicalAddress = (csAddress << 4) + pcAddress;
        
        console.log(`Physical address calculation: (0x${csAddress.toString(16)} << 4) + 0x${pcAddress.toString(16)} = 0x${physicalAddress.toString(16)}`);
        
        if (physicalAddress >= 0 && physicalAddress < this.simulator.memory.length) {
            // Set the memory start address to show CONTEXT around the target
            // Show 16 addresses before the target so we can scroll up
            const contextStart = Math.max(0, physicalAddress - 16);
            this.memoryStartAddress = contextStart;
            
            // Update the start address input to show the context start
            const startAddressInput = document.getElementById('memory-start-address');
            if (startAddressInput) {
                startAddressInput.value = '0x' + contextStart.toString(16).padStart(5, '0');
            }
            
            // Render the memory display at this context location
            this.manualAddressChange = true;
            this.memoryUI.renderMemoryDisplay();
            
            // Scroll to make the target address visible in the middle of the view
            setTimeout(() => {
                this.memoryUI.scrollToAddress(physicalAddress);
            }, 50);
            
            this.addTranscriptEntry(`Jumped to CS:PC = 0x${csAddress.toString(16).padStart(4, '0')}::0x${pcAddress.toString(16).padStart(4, '0')} (physical: 0x${physicalAddress.toString(16).padStart(5, '0')})`, "success");
        } else {
            this.addTranscriptEntry(`Invalid physical address: 0x${physicalAddress.toString(16).padStart(5, '0')}`, "error");
        }
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
                    const displayText = `${name} (0x${address.toString(16).padStart(5, '0')})`; // 5 hex digits
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
            // Show context around the symbol (some addresses before and after)
            const contextBefore = 16; // Show 16 addresses before the symbol
            const contextAddress = Math.max(0, address - contextBefore);
            this.memoryStartAddress = contextAddress;
            this.memoryUI.renderMemoryDisplay();
            document.getElementById('memory-start-address').value = '0x' + contextAddress.toString(16).padStart(5, '0');
            const symbolName = event.target.options[event.target.selectedIndex].text.split(' (')[0];
            this.addTranscriptEntry(`Memory view showing symbol: ${symbolName} with context`, "info");
            
            // Scroll to the symbol address after a short delay to ensure DOM is updated
            setTimeout(() => {
                this.memoryUI.scrollToAddress(address);
            }, 50);
        }
    }

    updateSegmentNavigationFields() {
        const csInput = document.getElementById('cs-input');
        const pcInput = document.getElementById('pc-input');
        
        if (csInput && pcInput) {
            // Update CS input with current code segment
            csInput.value = '0x' + this.simulator.segmentRegisters.CS.toString(16).padStart(4, '0');
            
            // Update PC input with current program counter  
            pcInput.value = '0x' + this.simulator.registers[15].toString(16).padStart(4, '0');
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
                html += `<span class="listing-address">0x${item.address.toString(16).padStart(5, '0')}</span>`; // 5 hex digits
                html += `<span class="listing-bytes">0x${instructionHex}</span>`;
                html += `<span class="listing-source">${item.line}</span>`;
                html += `</div>`;
            } else if (item.address !== undefined && (item.line.includes('.org') || item.line.includes('.word'))) {
                html += `<div class="listing-line">`;
                html += `<span class="listing-address">0x${item.address.toString(16).padStart(5, '0')}</span>`; // 5 hex digits
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
        
        this.memoryUI.updateMemoryDisplayHeight();
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
        } else if (tabName === 'screen') { 
            this.screenUI.updateScreenDisplay();
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
                // Apply memory changes
                for (const change of result.memoryChanges) {
                    if (change.address < this.simulator.memory.length) {
                        this.simulator.memory[change.address] = change.value;
                    }
                }
                
                // Update segment information for display
                this.memoryUI.buildSegmentInfo(result.listing);
                
                console.log("Simulator memory at 0x0000:", this.simulator.memory[0].toString(16));
                
                this.simulator.registers[15] = 0x0000;
                this.status("Assembly successful! Program loaded.");
                this.addTranscriptEntry("Assembly successful - program loaded", "success");
                document.getElementById('run-btn').disabled = false;
                document.getElementById('step-btn').disabled = false;
                document.getElementById('reset-btn').disabled = false;
                
                this.updateSymbolSelects(result.symbols);
                this.addTranscriptEntry(`Found ${Object.keys(result.symbols).length} symbols`, "info");
                
                this.switchTab('screen');
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

    updateAllDisplays() {
        this.registerUI.updateRegisterDisplay();
        this.registerUI.updatePSWDisplay();
        this.memoryUI.updateMemoryDisplay();
        this.registerUI.updateSegmentRegisters();
        this.registerUI.updateShadowRegisters();
        this.memoryUI.updateRecentMemoryDisplay();
        this.updateSegmentNavigationFields();
        if (this.screenUI.deferUpdates && this.simulator.running) {
            this.screenUI.flushPending();
        } else {
            this.screenUI.updateScreenDisplay();
        }
    }

    run() {
        if (!this.simulator.running) {
            this.simulator.running = true;
            this.status("Running program...");
            this.addTranscriptEntry("Starting program execution", "info");
            
            if (this.useWorker && this.worker) {
                // Use worker for execution
                this.worker.postMessage({
                    type: 'RUN'
                });
            } else {
                // Use main thread with reduced interval
                const runInterval = this.turboMode ? 1 : 10; // 1ms in turbo, 10ms normal
                
                this.runInterval = setInterval(() => {
                    if (!this.simulator.running) {
                        clearInterval(this.runInterval);
                        this.status("Program halted");
                        this.addTranscriptEntry("Program execution stopped", "info");
                        this.updateAllDisplays();
                        return;
                    }

                    const stepsPerTick = this.turboMode ? 1000 : 50;
                    let continueRunning = true;
                    for (let i = 0; i < stepsPerTick && this.simulator.running; i++) {
                        continueRunning = this.simulator.step();
                        if (!continueRunning) break;
                    }

                    if (!continueRunning) {
                        clearInterval(this.runInterval);
                        this.simulator.running = false;
                        this.status("Program completed");
                        this.addTranscriptEntry("Program execution completed", "success");
                        this.updateAllDisplays();
                    }
                }, runInterval);
            }
        }
    }

    step() {
        if (!this.simulator.running) {
            this.simulator.running = true;
        }
        
        if (this.useWorker && this.worker) {
            this.worker.postMessage({
                type: 'STEP'
            });
        } else {
            const continueRunning = this.simulator.step();
            this.updateAllDisplays();
            
            if (!continueRunning) {
                this.simulator.running = false;
                this.status("Program halted");
                this.addTranscriptEntry("Program halted after step", "info");
            } else {
                this.addTranscriptEntry(`Step executed - PC=0x${this.simulator.registers[15].toString(16).padStart(4, '0')}`, "info");
            }
        }
    }

    reset() {
        if (this.runInterval) {
            clearInterval(this.runInterval);
            this.runInterval = null;
        }
        
        if (this.useWorker && this.worker) {
            this.worker.postMessage({
                type: 'RESET'
            });
        }
        
        this.simulator.reset();
        this.memoryStartAddress = 0;
        document.getElementById('memory-start-address').value = '0x0000';
        this.updateAllDisplays();
        this.status("Simulator reset");
        this.addTranscriptEntry("Simulator reset to initial state", "info");
    }

    handleMemoryAddressChange() {
        this.handleMemoryAddressInput();
    }

    jumpToMemoryAddress() {
        this.handleMemoryAddressInput();
        
        // Add a small delay to ensure the memory display updates
        setTimeout(() => {
            this.memoryUI.updateMemoryDisplay();
        }, 10);
    }

    status(message) {
        document.getElementById('status-bar').textContent = `DeepCode: ${message}`;
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

    async loadExamplesList() {
        try {
            const response = await fetch('asm/examples.json');
            if (!response.ok) throw new Error('Examples list not found');
            
            const data = await response.json();
            this.examples = data.examples;
            this.populateExampleSelector();
            
            console.log(`Loaded ${this.examples.length} examples`);
            this.addTranscriptEntry(`Loaded ${this.examples.length} examples from asm/ directory`, "success");
        } catch (error) {
            console.error('Failed to load examples list:', error);
            this.addTranscriptEntry('Warning: Could not load examples list', "warning");
            this.setupFallbackExamples();
        }
    }

    populateExampleSelector() {
        const exampleSelect = document.getElementById('example-select');
        if (!exampleSelect) return;

        // Clear existing options
        exampleSelect.innerHTML = '<option value="">-- Choose Example --</option>';
        
        // Group by category
        const categories = {};
        this.examples.forEach(example => {
            if (!categories[example.category]) {
                categories[example.category] = [];
            }
            categories[example.category].push(example);
        });

        // Add options grouped by category
        Object.keys(categories).sort().forEach(category => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = category;
            
            categories[category].forEach(example => {
                const option = document.createElement('option');
                option.value = example.filename;
                option.textContent = example.name;
                optgroup.appendChild(option);
            });
            
            exampleSelect.appendChild(optgroup);
        });
    }

    setupFallbackExamples() {
        // Fallback to hardcoded examples if JSON loading fails
        this.examples = [
            { name: "Fibonacci Sequence", filename: "fibonacci.a16", category: "Mathematics" },
            { name: "Far Call & Long Jump", filename: "far_call.a16", category: "Advanced" },
            { name: "Screen Demo", filename: "screen_demo.a16", category: "I/O" }
        ];
        this.populateExampleSelector();
    }

    async loadExample(filename) {
        if (!filename) return;
        
        try {
            const response = await fetch(`asm/${filename}`);
            if (!response.ok) throw new Error(`File not found: ${filename}`);
            
            const source = await response.text();
            this.editorElement.value = source;
            
            const example = this.examples.find(ex => ex.filename === filename);
            const displayName = example ? example.name : filename;
            
            this.addTranscriptEntry(`Loaded example: ${displayName}`, "info");
            this.status(`Loaded ${displayName} - Click 'Assemble' to compile`);
            
            // Switch back to editor tab
            this.switchTab('editor');
            
            // Reset the dropdown
            document.getElementById('example-select').value = '';
            
        } catch (error) {
            console.error('Failed to load example:', error);
            this.addTranscriptEntry(`Error loading example: ${error.message}`, "error");
            this.status(`Error loading example: ${error.message}`);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.deepWebUI = new DeepWebUI();
});
