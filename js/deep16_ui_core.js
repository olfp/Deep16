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

        // Initialize modules
        this.memoryUI = new Deep16MemoryUI(this);
        this.registerUI = new Deep16RegisterUI(this);

        // File management
        this.currentFilename = 'Untitled.asm';
        this.fileModified = false;
        this.fileHandle = null; // For File System Access API
    
        // Initialize file menu
        this.initializeFileMenu();

        this.initializeEventListeners();
        this.initializeSearchableDropdowns();
        this.initializeTabs();
        this.updateAllDisplays();
        this.addTranscriptEntry("DeepCode initialized and ready", "info");
    }

    // Add new methods for file operations
// In deep16_ui_core.js - Replace the initializeFileMenu method
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

// Keep all the other file operation methods the same (newFile, loadFile, saveFile, etc.)
// They don't need changes, just make sure they're included

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
    document.getElementById('memory-jump-btn').addEventListener('click', () => this.jumpToMemoryAddress());
    
    // Add event listeners for Edit menu items
    document.getElementById('undo-btn').addEventListener('click', () => this.undo());
    document.getElementById('redo-btn').addEventListener('click', () => this.redo());
    document.getElementById('cut-btn').addEventListener('click', () => this.cut());
    document.getElementById('copy-btn').addEventListener('click', () => this.copy());
    document.getElementById('paste-btn').addEventListener('click', () => this.paste());
    document.getElementById('select-all-btn').addEventListener('click', () => this.selectAll());
    document.getElementById('find-btn').addEventListener('click', () => this.find());
    
    // REMOVE THESE LINES - they reference elements that don't exist anymore:
    // document.getElementById('assemble-menu-btn').addEventListener('click', () => this.assemble());
    // document.getElementById('example-select-menu').addEventListener('change', (e) => this.loadExample(e.target.value));

    // Simple symbol select handlers
    document.getElementById('symbol-select').addEventListener('change', (e) => {
        this.onSymbolSelect(e);
    });
    
    document.getElementById('listing-symbol-select').addEventListener('change', (e) => {
        this.onListingSymbolSelect(e);
    });
    
    document.getElementById('view-toggle').addEventListener('click', () => this.toggleView());

// Temporary direct fix - add this to deep16_ui_core.js constructor or initializeEventListeners
document.getElementById('memory-start-address').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const input = e.target;
        let value = input.value.trim();
        
        if (value.startsWith('0x')) {
            value = value.substring(2);
        }
        
        const address = parseInt(value, 16);
        if (!isNaN(address)) {
            this.memoryStartAddress = address;
            input.value = '0x' + address.toString(16).padStart(5, '0');
            this.memoryUI.updateMemoryDisplay();
        }
    }
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

    window.addEventListener('resize', () => this.memoryUI.updateMemoryDisplay());
}

    initializeSearchableDropdowns() {
        console.log('Using simple dropdowns');
    }

    handleMemoryAddressInput() {
    const input = document.getElementById('memory-start-address');
    if (!input) return;
    
    let value = input.value.trim();
    
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
    
    if (!isNaN(address) && address >= 0 && address < this.simulator.memory.length) {
        this.memoryStartAddress = address;
        input.value = '0x' + address.toString(16).padStart(5, '0').toUpperCase();
        this.memoryUI.updateMemoryDisplay();
    } else {
        // Invalid address - reset to current
        input.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0').toUpperCase();
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
        document.getElementById('memory-start-address').value = '0x' + contextAddress.toString(16).padStart(4, '0');
        const symbolName = event.target.options[event.target.selectedIndex].text.split(' (')[0];
        this.addTranscriptEntry(`Memory view showing symbol: ${symbolName} with context`, "info");
        
        // Scroll to the symbol address after a short delay to ensure DOM is updated
        setTimeout(() => {
            this.memoryUI.scrollToAddress(address);
        }, 50);
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

    updateAllDisplays() {
        this.registerUI.updateRegisterDisplay();
        this.registerUI.updatePSWDisplay();
        this.memoryUI.updateMemoryDisplay();
        this.registerUI.updateSegmentRegisters();
        this.registerUI.updateShadowRegisters();
        this.memoryUI.updateRecentMemoryDisplay();
    }

    run() {
        if (!this.simulator.running) {
            this.simulator.running = true;
            this.status("Running program...");
            this.addTranscriptEntry("Starting program execution", "info");
            
            this.runInterval = setInterval(() => {
                if (!this.simulator.running) {
                    clearInterval(this.runInterval);
                    this.status("Program halted");
                    this.addTranscriptEntry("Program execution stopped", "info");
                    return;
                }
                
                const continueRunning = this.simulator.step();
                this.updateAllDisplays();
                
                if (!continueRunning) {
                    clearInterval(this.runInterval);
                    this.simulator.running = false;
                    this.status("Program completed");
                    this.addTranscriptEntry("Program execution completed", "success");
                }
            }, 100);
        }
    }

    step() {
        if (!this.simulator.running) {
            this.simulator.running = true;
        }
        
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

    reset() {
        if (this.runInterval) {
            clearInterval(this.runInterval);
            this.runInterval = null;
        }
        
        this.simulator.reset();
        this.memoryStartAddress = 0;
        document.getElementById('memory-start-address').value = '0x0000';
        this.updateAllDisplays();
        this.status("Simulator reset");
        this.addTranscriptEntry("Simulator reset to initial state", "info");
    }

    // In deep16_ui_memory.js - update the handleMemoryAddressChange method
handleMemoryAddressChange() {
    const input = document.getElementById('memory-start-address');
    if (!input) return;
    
    let value = input.value.trim();
    
    // Remove 0x prefix if present and parse
    if (value.startsWith('0x')) {
        value = value.substring(2);
    }
    
    const address = parseInt(value, 16);
    if (!isNaN(address) && address >= 0 && address < this.ui.simulator.memory.length) {
        this.ui.memoryStartAddress = address;
        this.updateMemoryDisplay();
    } else {
        // Reset to current value if invalid
        input.value = '0x' + this.ui.memoryStartAddress.toString(16).padStart(5, '0');
    }
}

    jumpToMemoryAddress() {
        this.memoryUI.handleMemoryAddressChange();
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

loadExample(exampleName) {
    let source = '';
    
    switch (exampleName) {
        case 'fibonacci':
            source = `; Deep16 (深十六) Fibonacci Example
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
            break;
            
        case 'far_call':
            source = `; Inter-Segment Call Example
; Demonstrates calling between code segments

; Segment 0: Main program
.org 0x0000

main:
    ; Initialize stack pointer
    LDI  0x7FFF        ; R0 = 0x7FFF
    MOV  SP, R0        ; SP = R0
    
    ; Prepare numbers
    LSI  R1, 12        ; First number = 12
    LSI  R2, 5         ; Second number = 5
    
    ; Setup far call to segment 1
    ; JML R8: CS = R8, PC = R9
    LDI  0x0100        ; R0 = segment 1 (CS)
    MOV  R8, R0        ; R8 = target CS
    LDI  0x0020        ; R0 = function address (PC)
    MOV  R9, R0        ; R9 = target PC
    
    ; Calculate return address
    MOV  LR, PC, 1     ; LR = PC + 1 (address of return_here)
    JML  R8            ; Far call: CS=R8, PC=R9
    
return_here:
    ; Result should be in R3 (12 + 5 = 17)
    HALT

; Segment 1: Math function
.org 0x0020

add_func:
    ; Add two numbers: R3 = R1 + R2
    MOV  R3, R1        ; R3 = R1
    ADD  R3, R2        ; R3 = R3 + R2
    
    ; Return to caller using the return address in LR
    ; JML R10: CS = R10, PC = R11
    LDI  0x0000        ; R0 = segment 0 (CS)
    MOV  R10, R0       ; R10 = return CS
    MOV  R11, LR       ; R11 = return PC (from LR)
    JML  R10           ; Far return: CS=R10, PC=R11

; Segment 1 continuation
.org 0x0100
    HALT`;
            break;
                
        default:
            return;
    }
    
    this.editorElement.value = source;
    this.addTranscriptEntry(`Loaded example: ${exampleName}`, "info");
    this.status(`Loaded ${exampleName} example - Click 'Assemble' to compile`);
    
    // Switch back to editor tab
    this.switchTab('editor');
    
    // Reset the dropdown
    document.getElementById('example-select').value = '';
}
}

document.addEventListener('DOMContentLoaded', () => {
    window.deepWebUI = new DeepWebUI();
});
