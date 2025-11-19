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
                    this.registerUI.toggleRegisterSection(e.target);
                }
            });
        });

        window.addEventListener('resize', () => this.memoryUI.updateMemoryDisplay());
    }

    initializeSearchableDropdowns() {
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

    // ... rest of core methods (run, step, reset, jumpToMemoryAddress, etc.)

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
        // ... example loading code ...
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.deepWebUI = new DeepWebUI();
});
