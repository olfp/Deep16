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
        this.screenUI = new Deep16ScreenUI(this); 
        this.simulator.setUI(this);

        // File management
        this.currentFilename = 'Untitled.asm';
        this.fileModified = false;
        this.fileHandle = null; // For File System Access API
    
        // Initialize file menu
        this.initializeFileMenu();

        this.manualAddressChange = false;
        this.followPC = false;
        this.lockMemoryStartWhileRunning = false;
        this.lastPhysPC = 0;

        this.examples = [];
        this.loadExamplesList();

        this.initializeEventListeners();
        this.initializeSearchableDropdowns();
        this.initializeTabs();
        
        try {
            this.simulator.autoloadROM();
        } catch {}
        this.simulator.segmentRegisters.CS = 0xFFFF;
        this.currentAssemblyResult = {
            listing: [],
            symbols: {},
            segmentMap: new Map(),
            success: true,
            errors: []
        };
        for (let a = 0xFFFF0; a <= 0xFFFFF; a++) {
            this.currentAssemblyResult.segmentMap.set(a, 'code');
        }
        this.memoryStartAddress = 0xFFFF0;
        const startAddrInput = document.getElementById('memory-start-address');
        if (startAddrInput) {
            startAddrInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
        }
        const runBtn = document.getElementById('run-btn');
        const stepBtn = document.getElementById('step-btn');
        const resetBtn = document.getElementById('reset-btn');
        if (runBtn) runBtn.disabled = false;
        if (stepBtn) stepBtn.disabled = false;
        if (resetBtn) resetBtn.disabled = false;
        this.updateRunIndicator(false);
        this.manualAddressChange = true;
        this.updateAllDisplays();
        this.syncHeaderWidths();
        this.setupMobileLayout();
        this.wasmAvailable = typeof window.Deep16Wasm !== 'undefined';
        this.useWasm = false;
        this.resumeFromBreakpoint = false;
        this.wasmDirtyStart = null;
        this.wasmDirtyEnd = null;
        const wssamToggle = document.getElementById('wssam-toggle');
        if (wssamToggle) {
            wssamToggle.checked = true;
            wssamToggle.disabled = !this.wasmAvailable;
            wssamToggle.addEventListener('change', (e) => {
                const on = !!e.target.checked;
                this.useWasm = on && this.wasmAvailable && !!this.wasmInitialized;
                if (this.runInterval) { this.stop(); }
                this.addTranscriptEntry(`WASM: ${this.useWasm ? 'ON' : 'OFF'}`, "info");
            });
        }
        if (this.wasmAvailable) {
            this.addTranscriptEntry("WASM module detected", "success");
        } else if (window.Deep16WasmReady && typeof window.Deep16WasmReady.then === 'function') {
            this.addTranscriptEntry("WASM module loading...", "info");
            window.Deep16WasmReady.then(() => {
                this.wasmAvailable = true;
                try {
                    window.Deep16Wasm.init(this.simulator.memory.length);
                    if (typeof this.simulator.autoloadROM === 'function') {
                        this.simulator.autoloadROM();
                        this.simulator.segmentRegisters.CS = 0xFFFF;
                    }
                    for (let a = 0xFFFF0; a <= 0xFFFFF; a++) {
                        const v = this.simulator.memory[a] & 0xFFFF;
                        window.Deep16Wasm.load_program(a, new Uint16Array([v]));
                    }
                    const seg = this.simulator.segmentRegisters;
                    window.Deep16Wasm.set_segments(0xFFFF, seg.DS & 0xFFFF, seg.SS & 0xFFFF, seg.ES & 0xFFFF);
                    this.wasmInitialized = true;
                    this.useWasm = false;
                    if (wssamToggle) { wssamToggle.disabled = false; wssamToggle.checked = false; }
                    this.addTranscriptEntry("WASM module loaded (default OFF)", "success");
                
                    this.addTranscriptEntry("ROM loaded into WASM core", "success");
                    this.addTranscriptEntry("Segments synced to WASM", "info");
                } catch (e) {
                    this.addTranscriptEntry("WASM init failed; using JS core", "warning");
                    this.useWasm = false;
                    this.wasmInitialized = false;
                    if (wssamToggle) { wssamToggle.disabled = true; wssamToggle.checked = false; }
                }
            }).catch(() => {
                this.addTranscriptEntry("WASM module failed to load", "error");
            });
        } else {
            this.addTranscriptEntry("WASM module not available", "info");
            if (wssamToggle) { wssamToggle.disabled = true; wssamToggle.checked = false; }
        }
        window.addEventListener('deep16-wasm-ready', () => {
            this.wasmAvailable = true;
            try {
                window.Deep16Wasm.init(this.simulator.memory.length);
                if (typeof this.simulator.autoloadROM === 'function') {
                    this.simulator.autoloadROM();
                    this.simulator.segmentRegisters.CS = 0xFFFF;
                }
                for (let a = 0xFFFF0; a <= 0xFFFFF; a++) {
                    const v = this.simulator.memory[a] & 0xFFFF;
                    window.Deep16Wasm.load_program(a, new Uint16Array([v]));
                }
                const seg = this.simulator.segmentRegisters;
                window.Deep16Wasm.set_segments(0xFFFF, seg.DS & 0xFFFF, seg.SS & 0xFFFF, seg.ES & 0xFFFF);
                this.wasmInitialized = true;
                this.useWasm = false;
                if (wssamToggle) { wssamToggle.disabled = false; wssamToggle.checked = false; }
                this.addTranscriptEntry("WASM module loaded (default OFF)", "success");
                this.addTranscriptEntry("ROM loaded into WASM core", "success");
                this.addTranscriptEntry("Segments synced to WASM", "info");
            } catch (e) {
                this.addTranscriptEntry("WASM init failed; using JS core", "warning");
                this.useWasm = false;
                this.wasmInitialized = false;
                if (wssamToggle) { wssamToggle.disabled = true; wssamToggle.checked = false; }
            }
        });
        this.addTranscriptEntry("DeepCode initialized and ready", "info");
        this.initTabSizeSetting();
        this.setupEditorHighlighting();
    }

    updateRunIndicator(isRunning) {
        const el = document.getElementById('run-state-indicator');
        if (!el) return;
        if (isRunning) {
            el.textContent = 'Run';
            el.classList.remove('run-indicator-halt');
            el.classList.add('run-indicator-running');
        } else {
            el.textContent = 'Halt';
            el.classList.remove('run-indicator-running');
            el.classList.add('run-indicator-halt');
        }
    }

    updateRunButton(isRunning) {
        const runBtn = document.getElementById('run-btn');
        if (runBtn) {
            if (isRunning) {
                runBtn.textContent = 'Stop';
                runBtn.classList.add('stop-btn');
            } else {
                runBtn.textContent = 'Run';
                runBtn.classList.remove('stop-btn');
            }
        }
        this.updateRunIndicator(isRunning);
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
        this.renderEditorHighlight();
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
                this.renderEditorHighlight();
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
                            this.renderEditorHighlight();
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
        if (window.Deep16Debug) console.log('Setting up memory address input event listeners');
            
            // Handle Enter key
            memoryAddressInput.addEventListener('keypress', (e) => {
                if (window.Deep16Debug) console.log('Key pressed in memory address input:', e.key);
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

        const docsMenuBtn = document.getElementById('docs-menu-btn');
        const docsDropdown = document.getElementById('docs-dropdown');
        if (docsMenuBtn && docsDropdown) {
            docsMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                docsDropdown.classList.toggle('show');
            });
            docsDropdown.addEventListener('click', (e) => {
                const target = e.target;
                if (target && target.tagName === 'BUTTON') {
                    const which = target.getAttribute('data-doc');
                    if (which === 'arch') {
                        this.openMarkdownOverlay('doc/Deep16-Arch.md', 'Deep16 Architecture');
                    } else if (which === 'ide') {
                        this.openMarkdownOverlay('doc/User-man.md', 'DeepCode IDE Manual');
                    }
                    docsDropdown.classList.remove('show');
                }
            });
        }

        // Close dropdowns when clicking elsewhere
        document.addEventListener('click', () => {
            document.getElementById('file-dropdown').classList.remove('show');
            document.getElementById('edit-dropdown').classList.remove('show');
            const dd = document.getElementById('docs-dropdown');
            if (dd) dd.classList.remove('show');
        });

        window.addEventListener('resize', () => this.syncHeaderWidths());
        window.addEventListener('resize', () => this.setupMobileLayout());

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
                const size = this.tabSize || 4;
                const spaces = ' '.repeat(Math.max(2, Math.min(8, size)));
                const start = this.editorElement.selectionStart;
                const end = this.editorElement.selectionEnd;
                this.editorElement.value = this.editorElement.value.substring(0, start) + spaces + this.editorElement.value.substring(end);
                this.editorElement.selectionStart = this.editorElement.selectionEnd = start + spaces.length;
                this.renderEditorHighlight();
            }
        });        
        this.editorElement.addEventListener('input', () => this.renderEditorHighlight());
        const tabInput = document.getElementById('tab-size-input');
        if (tabInput) {
            tabInput.addEventListener('change', () => this.updateTabSizeFromInput());
        }
    }

    initTabSizeSetting() {
        const stored = parseInt(localStorage.getItem('deep16.tabSize') || '4', 10);
        this.tabSize = isNaN(stored) ? 4 : Math.max(2, Math.min(8, stored));
        const tabInput = document.getElementById('tab-size-input');
        if (tabInput) tabInput.value = String(this.tabSize);
    }

    updateTabSizeFromInput() {
        const tabInput = document.getElementById('tab-size-input');
        if (!tabInput) return;
        let v = parseInt(tabInput.value, 10);
        if (isNaN(v)) v = this.tabSize || 4;
        v = Math.max(2, Math.min(8, v));
        this.tabSize = v;
        tabInput.value = String(v);
        localStorage.setItem('deep16.tabSize', String(v));
    }

    setupEditorHighlighting() {
        this.editorElement = document.getElementById('editor');
        this.editorHighlight = document.getElementById('editor-highlight');
        this.renderEditorHighlight();
        if (this.editorElement && this.editorHighlight) {
            this.editorHighlight.scrollTop = this.editorElement.scrollTop;
            this.editorHighlight.scrollLeft = this.editorElement.scrollLeft;
            this.editorElement.addEventListener('scroll', () => {
                this.editorHighlight.scrollTop = this.editorElement.scrollTop;
                this.editorHighlight.scrollLeft = this.editorElement.scrollLeft;
            });
        }
    }

    renderEditorHighlight() {
        if (!this.editorHighlight || !this.editorElement) return;
        const src = this.editorElement.value;
        const lines = src.split('\n');
        const regNames = ['R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','R12','R13','R14','R15','SP','FP','LR','PC'];
        const mnemonics = ['LDI','LD','ST','ADD','SUB','AND','OR','XOR','MUL','DIV','SHIFT','JMP','JZ','JNZ','JC','JNC','JN','JNN','LSI','MOV','LDS','STS','SET','CLR','MVS','SMV','SWB','INV','NEG','NOP','HLT','SWI','RETI','SRS','SRD','ERS','ERD','SET2','CLR2','JML'];
        const reCmt = /(^\s*;.*)$/;
        const reLitHex = /\b0x[0-9a-fA-F]+\b/g;
        const reLitNum = /\b\d+\b/g;
        const reStr = /"[^"]*"|'[^']*'/g;
        const reReg = new RegExp(`\\b(${regNames.join('|')})\\b`, 'gi');
        const reMn = new RegExp(`\\b(${mnemonics.join('|')})\\b`, 'gi');
        const labelDefs = new Set();
        for (const s of lines) {
            const m = s.match(/^\s*([A-Za-z_][\w]*)\s*:\s*(?:;.*)?$/);
            if (m) labelDefs.add(m[1]);
        }
        const lblList = Array.from(labelDefs);
        const reLbl = lblList.length ? new RegExp(`\\b(${lblList.map(x=>x.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')).join('|')})\\b`, 'gi') : null;
        const applyLine = (s) => {
            if (reCmt.test(s)) return `<span class="hl-cmt">${this.escapeHtml(s)}</span>`;
            const def = s.match(/^\s*([A-Za-z_][\w]*)\s*:(.*)$/);
            if (def) {
                const label = this.escapeHtml(def[1]);
                let rest = def[2] || '';
                let t = this.escapeHtml(rest);
                t = t.replace(reStr, (m) => `<span class=\"hl-lit\">${m}</span>`);
                t = t.replace(reLitHex, (m) => `<span class=\"hl-imm\">${m}</span>`);
                t = t.replace(reLitNum, (m) => `<span class=\"hl-imm\">${m}</span>`);
                t = t.replace(reReg, (m) => `<span class=\"hl-reg\">${m}</span>`);
                t = t.replace(reMn, (m) => `<span class=\"hl-mn\">${m}</span>`);
                if (reLbl) t = t.replace(reLbl, (m) => `<span class=\"hl-lbl\">${m}</span>`);
                return `<span class=\"hl-lbl-def\">${label}</span>:` + t;
            }
            let t = this.escapeHtml(s);
            t = t.replace(reStr, (m) => `<span class=\"hl-lit\">${m}</span>`);
            t = t.replace(reLitHex, (m) => `<span class=\"hl-imm\">${m}</span>`);
            t = t.replace(reLitNum, (m) => `<span class=\"hl-imm\">${m}</span>`);
            t = t.replace(reReg, (m) => `<span class=\"hl-reg\">${m}</span>`);
            t = t.replace(reMn, (m) => `<span class=\"hl-mn\">${m}</span>`);
            if (reLbl) t = t.replace(reLbl, (m) => `<span class=\"hl-lbl\">${m}</span>`);
            return t;
        };
        const html = lines.map(applyLine).join('\n');
        this.editorHighlight.innerHTML = html;
    }

    escapeHtml(s) {
        return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    }

    openMarkdownOverlay(path, title) {
        const overlay = document.getElementById('doc-overlay');
        const body = document.getElementById('doc-overlay-body');
        const ttl = document.getElementById('doc-overlay-title');
        const closeBtn = document.getElementById('doc-overlay-close');
        if (!overlay || !body || !ttl || !closeBtn) return;
        fetch(path).then(r => r.text()).then(md => {
            ttl.textContent = title;
            body.innerHTML = this.renderMarkdown(md);
            overlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }).catch(() => {
            ttl.textContent = title;
            body.innerHTML = `<pre>Unable to load ${title} (${path})</pre>`;
            overlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        });
        const close = () => {
            overlay.style.display = 'none';
            document.body.style.overflow = '';
        };
        closeBtn.onclick = close;
        overlay.onclick = (e) => {
            if (e.target === overlay) close();
        };
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
        }, { once: true });
    }

    renderMarkdown(md) {
        const esc = (s) => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        const isSafeUrl = (u) => /^https?:\/\//i.test(u);
        const lines = md.replace(/\r\n?/g,'\n').split('\n');
        let out = '';
        let inCode = false;
        let codeLang = '';
        let codeBuffer = [];
        let listType = null; // 'ul' or 'ol'
        let inBlockquote = false;
        let inTable = false;
        let tableRows = [];
        let tableAlign = [];
        const flushList = () => { if (listType) { out += `</${listType}>`; listType = null; } };
        const flushBlockquote = () => { if (inBlockquote) { out += '</blockquote>'; inBlockquote = false; } };
        const flushTable = () => {
            if (!inTable) return;
            // Build table HTML
            if (tableRows.length) {
                out += '<table class="md-table">';
                const hdr = tableRows[0];
                out += '<thead><tr>' + hdr.map((c,i)=>`<th style="text-align:${tableAlign[i]||'left'}">${esc(c.trim())}</th>`).join('') + '</tr></thead>';
                const bodyRows = tableRows.slice(1);
                out += '<tbody>' + bodyRows.map(row => '<tr>' + row.map((c,i)=>`<td style="text-align:${tableAlign[i]||'left'}">${esc(c.trim())}</td>`).join('') + '</tr>').join('') + '</tbody>';
                out += '</table>';
            }
            inTable = false; tableRows = []; tableAlign = [];
        };
        for (let i=0; i<lines.length; i++) {
            let line = lines[i];
            // Fenced code blocks
            const fence = line.match(/^\s*```(.*)$/);
            if (fence) {
                if (!inCode) {
                    codeLang = fence[1].trim();
                    out += `<pre><code${codeLang?` class=\"language-${esc(codeLang)}\"`:''}>`;
                    inCode = true;
                    codeBuffer = [];
                } else {
                    const highlighted = this.highlightCode(codeBuffer.join('\n'), codeLang);
                    out += highlighted + '</code></pre>';
                    inCode = false; codeLang = ''; codeBuffer = [];
                }
                continue;
            }
            if (inCode) { codeBuffer.push(line); continue; }
            // Tables (GFM): header + separator
            const isPipeLine = line.trim().startsWith('|') || (line.includes('|') && !line.trim().startsWith('#'));
            const next = lines[i+1] || '';
            const isSeparator = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);
            if (!inTable && isPipeLine && isSeparator) {
                flushList(); flushBlockquote();
                const headerCells = line.replace(/^\s*\|?|\|\s*$/g,'').split('|');
                const sepCells = next.replace(/^\s*\|?|\|\s*$/g,'').split('|');
                tableAlign = sepCells.map(s => (s.includes(':') && s.trim().startsWith(':') && s.trim().endsWith(':')) ? 'center' : (s.trim().endsWith(':') ? 'right' : (s.trim().startsWith(':') ? 'left' : 'left')));
                tableRows = [headerCells]; inTable = true; i++; // consume separator
                continue;
            }
            if (inTable) {
                if (line.trim() === '' || !line.includes('|')) { flushTable(); /* fall through to normal */ }
                else { const cells = line.replace(/^\s*\|?|\|\s*$/g,'').split('|'); tableRows.push(cells); continue; }
            }
            // Blockquotes
            const bq = line.match(/^\s*>\s?(.*)$/);
            if (bq) {
                flushList();
                if (!inBlockquote) { out += '<blockquote>'; inBlockquote = true; }
                let txt = bq[1];
                txt = esc(txt).replace(/`([^`]+)`/g, '<code>$1</code>');
                txt = txt.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/~~([^~]+)~~/g,'<del>$1</del>');
                txt = txt.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,(m,a,u)=> isSafeUrl(u)?`<img alt="${esc(a)}" src="${u}">`:esc(m));
                txt = txt.replace(/\[([^\]]+)\]\(([^)]+)\)/g,(m,a,u)=> isSafeUrl(u)?`<a href="${u}" target="_blank" rel="noopener noreferrer">${esc(a)}</a>`:esc(m));
                txt = txt.replace(/https?:\/\/\S+/g,(u)=> isSafeUrl(u)?`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`:esc(u));
                out += `<p>${txt}</p>`;
                continue;
            } else { flushBlockquote(); }
            // Headings
            const h = line.match(/^(#{1,6})\s+(.*)$/);
            if (h) { flushList(); out += `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`; continue; }
            // Horizontal rule
            if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) { flushList(); out += '<hr>'; continue; }
            // Lists (including GFM task lists)
            const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
            const ul = line.match(/^\s*[-*+]\s+(.*)$/);
            const ol = line.match(/^\s*(\d+)\.\s+(.*)$/);
            if (task) {
                if (listType !== 'ul') { flushList(); out += '<ul>'; listType = 'ul'; }
                const checked = /x/i.test(task[1]) ? ' checked' : '';
                out += `<li><input type="checkbox" disabled${checked}> ${esc(task[2])}</li>`; continue;
            }
            if (ul) {
                if (listType !== 'ul') { flushList(); out += '<ul>'; listType = 'ul'; }
                let txt = ul[1];
                txt = esc(txt).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/~~([^~]+)~~/g,'<del>$1</del>');
                out += `<li>${txt}</li>`; continue;
            }
            if (ol) {
                if (listType !== 'ol') { flushList(); out += '<ol>'; listType = 'ol'; }
                let txt = ol[2];
                txt = esc(txt).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/~~([^~]+)~~/g,'<del>$1</del>');
                out += `<li>${txt}</li>`; continue;
            }
            if (listType && line.trim() === '') { flushList(); continue; }
            // Paragraph / inline formatting
            if (line.trim() === '') { out += '<p></p>'; continue; }
            let txt = esc(line)
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
                .replace(/\*([^*]+)\*/g,'<em>$1</em>')
                .replace(/~~([^~]+)~~/g,'<del>$1</del>')
                .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,(m,a,u)=> isSafeUrl(u)?`<img alt="${esc(a)}" src="${u}">`:esc(m))
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g,(m,a,u)=> isSafeUrl(u)?`<a href="${u}" target="_blank" rel="noopener noreferrer">${esc(a)}</a>`:esc(m))
                .replace(/https?:\/\/\S+/g,(u)=> isSafeUrl(u)?`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`:esc(u));
            out += `<p>${txt}</p>`;
        }
        flushList(); flushBlockquote(); flushTable();
        if (inCode) { const highlighted = this.highlightCode(codeBuffer.join('\n'), codeLang); out += highlighted + '</code></pre>'; }
        return out;
    }

    highlightCode(code, lang) {
        const esc = (s) => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        let html = esc(code);
        // Protect comments first
        html = html.replace(/\/\*[\s\S]*?\*\//g, (m) => `<span class="hl-cmt">${m}</span>`);
        html = html.replace(/\/\/[^\n]*/g, (m) => `<span class="hl-cmt">${m}</span>`);
        const split = html.split(/(<span class=\"hl-cmt\">[\s\S]*?<\/span>)/);
        const processSeg = (seg) => {
            // Numbers (hex and dec)
            seg = seg.replace(/\b0x[0-9a-fA-F]+\b/g, (m) => `<span class="hl-num">${m}</span>`);
            seg = seg.replace(/\b\d+\b/g, (m) => `<span class="hl-num">${m}</span>`);
            // Keywords
            const kwSets = {
                js: ['var','let','const','function','return','if','else','for','while','switch','case','break','continue','import','export','class','new','try','catch','finally','throw','await','async','yield','this','null','true','false','undefined'],
                ts: ['interface','type','enum','implements','extends','public','private','protected','readonly','abstract'],
                py: ['def','return','if','elif','else','for','while','try','except','finally','class','import','from','as','pass','break','continue','with','lambda','True','False','None'],
                c: ['int','char','float','double','void','return','if','else','for','while','switch','case','break','continue','struct','union','typedef','enum','sizeof','static','const'],
                cpp:['namespace','using','template','class','public','private','protected','virtual','override','auto'],
                rust:['fn','let','mut','struct','enum','impl','trait','match','if','else','loop','for','while','return','pub','use','crate','mod'],
                asm:['LSI','ST','MOV','HALT','JMP','JNZ','JZ','CALL','RET','PUSH','POP','ADD','SUB','MUL','DIV','AND','OR','XOR','NOT','SHL','SHR','NOP']
            };
            const langKey = (lang||'').toLowerCase();
            let kws = [];
            if (langKey === 'javascript' || langKey === 'js') kws = kwSets.js;
            else if (langKey === 'typescript' || langKey === 'ts') kws = kwSets.js.concat(kwSets.ts);
            else if (langKey === 'python' || langKey === 'py') kws = kwSets.py;
            else if (langKey === 'c') kws = kwSets.c;
            else if (langKey === 'cpp' || langKey === 'c++') kws = kwSets.c.concat(kwSets.cpp);
            else if (langKey === 'rust') kws = kwSets.rust;
            else if (langKey === 'a16' || langKey === 'asm') kws = kwSets.asm;
            if (kws.length) {
                const re = new RegExp(`\\b(${kws.map(k=>k.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')).join('|')})\\b`,'g');
                seg = seg.replace(re, '<span class="hl-kw">$1</span>');
            }
            return seg;
        };
        for (let i=0; i<split.length; i++) {
            if (!split[i]) continue;
            if (!split[i].startsWith('<span class="hl-cmt">')) split[i] = processSeg(split[i]);
        }
        return split.join('');
    }

    initializeSearchableDropdowns() {
        if (window.Deep16Debug) console.log('Using simple dropdowns');
    }

    // In deep16_ui_core.js - Replace handleMemoryAddressInput method:
    handleMemoryAddressInput() {
        const input = document.getElementById('memory-start-address');
        if (!input) {
            console.error('Memory address input not found');
            return;
        }
        
        let value = input.value.trim();
        if (window.Deep16Debug) console.log('Memory address input value:', value);
        
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
        if (window.Deep16Debug) console.log('Parsed address:', address, 'isNaN:', isNaN(address));
        
        if (!isNaN(address) && address >= 0 && address < this.simulator.memory.length) {
            if (window.Deep16Debug) console.log('Setting memory start address to:', address);
            this.memoryStartAddress = address;
            input.value = '0x' + address.toString(16).padStart(5, '0').toUpperCase();
            
            // CRITICAL: Call renderMemoryDisplay directly instead of updateMemoryDisplay
            // This bypasses the auto-adjust logic for manual changes
            this.memoryUI.renderMemoryDisplay();
            
            // Add a temporary flag to prevent auto-adjust on the next update
            this.manualAddressChange = true;
            
            if (window.Deep16Debug) console.log('Manual address change completed, calling renderMemoryDisplay directly');
        } else {
            // Invalid address - reset to current
            if (window.Deep16Debug) console.log('Invalid address, resetting to:', this.memoryStartAddress);
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
        
        if (window.Deep16Debug) console.log(`gotoSegmentAddress: CS='${csValue}', PC='${pcValue}'`);
        
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
        
        if (window.Deep16Debug) console.log(`Parsed: CS=0x${csAddress.toString(16)}, PC=0x${pcAddress.toString(16)}`);
        
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
        
        if (window.Deep16Debug) console.log(`Physical address calculation: (0x${csAddress.toString(16)} << 4) + 0x${pcAddress.toString(16)} = 0x${physicalAddress.toString(16)}`);
        
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
        const compactContainer = this.mobileActive ? document.getElementById('machine-tab') : document.querySelector('.memory-panel');
        const viewToggle = document.getElementById('view-toggle');
        
        if (this.compactView) {
            if (compactContainer) compactContainer.classList.add('compact-view');
            viewToggle.textContent = this.mobileActive ? 'Full\u00A0V.' : 'Full View';
            this.addTranscriptEntry("Switched to Compact view - PSW only", "info");
        } else {
            if (compactContainer) compactContainer.classList.remove('compact-view');
            viewToggle.textContent = this.mobileActive ? 'Compact' : 'Compact View';
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
        } else if (tabName === 'machine') {
            this.registerUI.updateRegisterDisplay();
            this.registerUI.updatePSWDisplay();
            this.registerUI.updateSegmentRegisters();
            this.memoryUI.updateMemoryDisplayHeight();
        }

        this.syncHeaderWidths();
    }

    assemble() {
        if (window.Deep16Debug) console.log("Assemble button clicked");
        const source = this.editorElement.value;
        this.status("Assembling...");
        this.addTranscriptEntry("Starting assembly", "info");

        try {
            const result = this.assembler.assemble(source);
            if (window.Deep16Debug) console.log("Assembly result:", result);
            
            this.currentAssemblyResult = result;
            
            if (result.success) {
                // Apply memory changes
                for (const change of result.memoryChanges) {
                    if (change.address < this.simulator.memory.length) {
                        this.simulator.memory[change.address] = change.value;
                    }
                }
                // Ensure ROM is present in JS simulator and segments reflect ROM-first boot
                try {
                    if (typeof this.simulator.autoloadROM === 'function') {
                        this.simulator.autoloadROM();
                    }
                    this.simulator.segmentRegisters.CS = 0xFFFF;
                } catch {}
                if (this.useWasm && window.Deep16Wasm) {
                    const loadIntoWasm = () => {
                        try {
                            window.Deep16Wasm.init(this.simulator.memory.length);
                            try {
                                if (typeof this.simulator.autoloadROM === 'function') {
                                    this.simulator.autoloadROM();
                                    this.simulator.segmentRegisters.CS = 0xFFFF;
                                }
                                for (let a = 0xFFFF0; a <= 0xFFFFF; a++) {
                                    const v = this.simulator.memory[a] & 0xFFFF;
                                    window.Deep16Wasm.load_program(a, new Uint16Array([v]));
                                }
                            } catch {}
                            for (const change of result.memoryChanges) {
                                const arr = new Uint16Array([change.value]);
                                window.Deep16Wasm.load_program(change.address, arr);
                            }
                            const seg = this.simulator.segmentRegisters;
                            window.Deep16Wasm.set_segments(0xFFFF, seg.DS & 0xFFFF, seg.SS & 0xFFFF, seg.ES & 0xFFFF);
                            this.addTranscriptEntry("Program loaded into WASM core", "success");
                        } catch (e) {
                            this.addTranscriptEntry("WASM load failed; falling back to JS", "warning");
                            this.useWasm = false;
                        }
                    };
                    if (window.Deep16WasmReady && typeof window.Deep16WasmReady.then === 'function') {
                        window.Deep16WasmReady.then(() => loadIntoWasm());
                    } else {
                        loadIntoWasm();
                    }
                }
                
                // Update segment information for display
                // Mark ROM region as code in segmentMap so memory panel shows disassembly
                try {
                    if (!result.segmentMap) { result.segmentMap = new Map(); }
                    for (let a = 0xFFFF0; a <= 0xFFFFF; a++) {
                        result.segmentMap.set(a, 'code');
                    }
                } catch {}
                this.memoryUI.buildSegmentInfo(result.listing);
                
                if (window.Deep16Debug) console.log("Simulator memory at 0x0000:", this.simulator.memory[0].toString(16));
                
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
        this.screenUI.updateScreenDisplay();
    }

    run() {
        // Toggle Run/Stop
        if (this.simulator.running) {
            this.stop();
            return;
        }
        if (this.useWasm && this.wasmAvailable && this.wasmInitialized && window.Deep16Wasm) {
            this.wasmRun();
        } else {
            this.jsRun();
        }
    }

    workerRun() {
        this.simulator.running = true;
        this.status("Running program (Worker)...");
        this.addTranscriptEntry("Starting worker execution", "info");
        this.updateRunButton(true);
        this.worker.postMessage({ type: 'RUN' });
    }

    jsRun() {
        this.simulator.running = true;
        this.status("Running program...");
        this.addTranscriptEntry("Starting program execution", "info");
        this.updateRunButton(true);
        if (this.resumeFromBreakpoint) {
            try {
                const physPCCheck = ((this.simulator.segmentRegisters.CS & 0xFFFF) << 4) + (this.simulator.registers[15] & 0xFFFF);
                if (this.memoryUI && this.memoryUI.breakpoints && this.memoryUI.breakpoints.has(physPCCheck)) {
                    this.simulator.step();
                }
            } catch {}
            this.resumeFromBreakpoint = false;
        }
        const runInterval = 10;
        this.runInterval = setInterval(() => {
            if (!this.simulator.running) {
                clearInterval(this.runInterval);
                this.status("Program halted");
                this.addTranscriptEntry("Program execution stopped", "info");
                this.updateAllDisplays();
                this.updateRunButton(false);
                return;
            }
            
            const stepsPerTick = 200;
            let continueRunning = true;
            for (let i = 0; i < stepsPerTick && this.simulator.running; i++) {
                const physPCCheck = ((this.simulator.segmentRegisters.CS & 0xFFFF) << 4) + (this.simulator.registers[15] & 0xFFFF);
                if (this.memoryUI && this.memoryUI.breakpoints && this.memoryUI.breakpoints.has(physPCCheck)) {
                    continueRunning = false;
                    this.simulator.running = false;
                    this.status(`Breakpoint hit at 0x${physPCCheck.toString(16).padStart(5,'0')}`);
                    this.addTranscriptEntry(`Breakpoint hit at 0x${physPCCheck.toString(16).padStart(5,'0')}`, "warning");
                    this.resumeFromBreakpoint = true;
                    break;
                }
                continueRunning = this.simulator.step();
                if (!continueRunning) break;
            }

            // One-time follow on large jump: bring PC into view even when locked
            const physPC = ((this.simulator.segmentRegisters.CS & 0xFFFF) << 4) + (this.simulator.registers[15] & 0xFFFF);
            const start = this.memoryStartAddress || 0;
            const end = Math.min(start + 64, this.simulator.memory.length);
            const pcVisible = physPC >= start && physPC < end;
            const jumpedFar = Math.abs(physPC - this.lastPhysPC) > 16;
            if (!pcVisible && jumpedFar) {
                this.memoryStartAddress = Math.max(0, physPC - 8);
                const startAddressInput = document.getElementById('memory-start-address');
                if (startAddressInput) {
                    startAddressInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
                }
                this.memoryUI.renderMemoryDisplay();
            }
            this.lastPhysPC = physPC;

            if (!continueRunning) {
                clearInterval(this.runInterval);
                this.simulator.running = false;
                const physPCNow = ((this.simulator.segmentRegisters.CS & 0xFFFF) << 4) + (this.simulator.registers[15] & 0xFFFF);
                if (this.memoryUI && this.memoryUI.breakpoints && this.memoryUI.breakpoints.has(physPCNow)) {
                    this.status(`Program halted at breakpoint 0x${physPCNow.toString(16).padStart(5,'0')}`);
                    this.addTranscriptEntry(`Program halted at breakpoint 0x${physPCNow.toString(16).padStart(5,'0')}`, "warning");
                    this.resumeFromBreakpoint = true;
                } else {
                    this.status("Program completed");
                    this.addTranscriptEntry("Program execution completed", "success");
                }
                this.updateAllDisplays();
                this.updateRunButton(false);
            }
        }, runInterval);
    }

    stop() {
        if (this.runInterval) {
            clearInterval(this.runInterval);
            this.runInterval = null;
        }
        this.simulator.running = false;
        this.status("Program halted");
        this.addTranscriptEntry("Program execution stopped", "info");
        this.updateAllDisplays();
        this.updateRunButton(false);
    }

    step() {
        const beforePC = this.simulator.registers[15] & 0xFFFF;
        const beforeCS = this.simulator.segmentRegisters.CS & 0xFFFF;
        const beforePhys = (beforeCS << 4) + beforePC;
        if (!this.simulator.running) {
            this.simulator.running = true;
        }
        
        if (this.useWasm && this.wasmAvailable && this.wasmInitialized && window.Deep16Wasm) {
            const cont = window.Deep16Wasm.step();
            const regs = window.Deep16Wasm.get_registers();
            for (let i = 0; i < this.simulator.registers.length && i < regs.length; i++) {
                this.simulator.registers[i] = regs[i] & 0xFFFF;
            }
            if (typeof window.Deep16Wasm.get_psw === 'function') {
                try { this.simulator.psw = window.Deep16Wasm.get_psw() & 0xFFFF; } catch {}
            }
            if (typeof window.Deep16Wasm.get_segments === 'function') {
                try {
                    const segs = window.Deep16Wasm.get_segments();
                    if (segs && segs.length >= 4) {
                        this.simulator.segmentRegisters.CS = segs[0] & 0xFFFF;
                        this.simulator.segmentRegisters.DS = segs[1] & 0xFFFF;
                        this.simulator.segmentRegisters.SS = segs[2] & 0xFFFF;
                        this.simulator.segmentRegisters.ES = segs[3] & 0xFFFF;
                    }
                } catch {}
            }
            if (typeof window.Deep16Wasm.get_recent_access === 'function') {
                try {
                    const info = window.Deep16Wasm.get_recent_access();
                    if (info && info.length >= 6) {
                        const segNames = ['CS','DS','SS','ES'];
                        const address = info[0] >>> 0;
                        const baseAddress = info[1] >>> 0;
                        const offset = info[2] >>> 0;
                        const segmentValue = info[3] >>> 0;
                        const segmentIndex = info[4] >>> 0;
                        const isStore = (info[5] >>> 0) === 1;
                        this.simulator.recentMemoryAccess = {
                            address: address,
                            baseAddress: baseAddress,
                            offset: offset,
                            segment: segNames[segmentIndex] || 'DS',
                            segmentValue: segmentValue,
                            type: isStore ? 'ST' : 'LD',
                            accessedAt: Date.now()
                        };
                        if (isStore && typeof window.Deep16Wasm.get_memory_word === 'function') {
                            try {
                                const w = window.Deep16Wasm.get_memory_word(address) & 0xFFFF;
                                if (address < this.simulator.memory.length) {
                                    this.simulator.memory[address] = w;
                                }
                                this.addTranscriptEntry(`WASM store @0x${address.toString(16).padStart(5,'0')} = 0x${w.toString(16).padStart(4,'0').toUpperCase()} seg=${segNames[segmentIndex]}(0x${segmentValue.toString(16)})`, "info");
                            } catch {}
                        }
                    }
                } catch {}
            }
            try {
                const start = this.memoryStartAddress || 0;
                const end = Math.min(start + 64, this.simulator.memory.length);
                if (typeof window.Deep16Wasm.get_memory_slice === 'function') {
                    const slice = window.Deep16Wasm.get_memory_slice(start, end - start);
                    if (slice && slice.length) {
                        for (let i = 0; i < slice.length; i++) {
                            this.simulator.memory[start + i] = slice[i] & 0xFFFF;
                        }
                    }
                }
            } catch {}
            // Bring new PC into view on large jumps when stepping (WASM)
            const afterPC = this.simulator.registers[15] & 0xFFFF;
            const afterCS = this.simulator.segmentRegisters.CS & 0xFFFF;
            const afterPhys = (afterCS << 4) + afterPC;
            const start2 = this.memoryStartAddress || 0;
            const end2 = Math.min(start2 + 64, this.simulator.memory.length);
            const pcVisible2 = afterPhys >= start2 && afterPhys < end2;
            const jumpedFar2 = Math.abs(afterPhys - beforePhys) > 16;
            if (!pcVisible2 && jumpedFar2) {
                this.memoryStartAddress = Math.max(0, afterPhys - 8);
                const startAddressInput = document.getElementById('memory-start-address');
                if (startAddressInput) {
                    startAddressInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
                }
                this.memoryUI.renderMemoryDisplay();
            }
            this.lastPhysPC = afterPhys;
            this.updateAllDisplays();
            if (!cont) {
                this.simulator.running = false;
                this.status("Program halted");
                this.addTranscriptEntry("Program halted after step (WASM)", "info");
                this.updateRunButton(false);
            }
            this.addTranscriptEntry(`Step (WASM): 0x${beforePhys.toString(16).padStart(5,'0')} -> 0x${afterPhys.toString(16).padStart(5,'0')}`, "info");
            this.simulator.running = false;
        } else {
            const continueRunning = this.simulator.step();
            this.simulator.running = false;
            // Bring new PC into view on large jumps when stepping
            const afterPC = this.simulator.registers[15] & 0xFFFF;
            const afterCS = this.simulator.segmentRegisters.CS & 0xFFFF;
            const afterPhys = (afterCS << 4) + afterPC;
            const start = this.memoryStartAddress || 0;
            const end = Math.min(start + 64, this.simulator.memory.length);
            const pcVisible = afterPhys >= start && afterPhys < end;
            const jumpedFar = Math.abs(afterPhys - beforePhys) > 16;
            if (!pcVisible && jumpedFar) {
                this.memoryStartAddress = Math.max(0, afterPhys - 8);
                const startAddressInput = document.getElementById('memory-start-address');
                if (startAddressInput) {
                    startAddressInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
                }
                this.memoryUI.renderMemoryDisplay();
            }
            this.lastPhysPC = afterPhys;
            this.updateAllDisplays();
            
            if (!continueRunning) {
                this.simulator.running = false;
                this.status("Program halted");
                this.addTranscriptEntry("Program halted after step", "info");
                this.updateRunButton(false);
            } else {
                this.addTranscriptEntry(`Step (JS): 0x${beforePhys.toString(16).padStart(5,'0')} -> 0x${afterPhys.toString(16).padStart(5,'0')}`, "info");
            }
        }
    }

    reset() {
        if (this.runInterval) {
            clearInterval(this.runInterval);
            this.runInterval = null;
        }
        if (this.useWasm && this.wasmAvailable && this.wasmInitialized && window.Deep16Wasm) {
            try { window.Deep16Wasm.reset(); } catch {}
        }
        
        this.simulator.reset();
        this.wasmDirtyStart = null;
        this.wasmDirtyEnd = null;
        this.memoryStartAddress = 0xFFFF0;
        const addrInput = document.getElementById('memory-start-address');
        if (addrInput) {
            addrInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
        }
        this.manualAddressChange = true;
        this.updateRunButton(false);
        this.updateAllDisplays();
        this.status("Simulator reset");
        this.addTranscriptEntry("Simulator reset to initial state", "info");
    }

    wasmRun() {
        this.simulator.running = true;
        this.lockMemoryStartWhileRunning = true;
        this.status("Running program (WASM)...");
        this.addTranscriptEntry("Starting WASM execution", "info");
        this.updateRunButton(true);
        if (this.resumeFromBreakpoint) {
            try {
                let csVal = this.simulator.segmentRegisters.CS & 0xFFFF;
                let pcVal = this.simulator.registers[15] & 0xFFFF;
                try {
                    const segsCur = window.Deep16Wasm.get_segments();
                    if (segsCur && segsCur.length >= 1) csVal = segsCur[0] & 0xFFFF;
                } catch {}
                try {
                    const regsCur = window.Deep16Wasm.get_registers();
                    if (regsCur && regsCur.length >= 16) pcVal = regsCur[15] & 0xFFFF;
                } catch {}
                const physPCCheck = ((csVal & 0xFFFF) << 4) + (pcVal & 0xFFFF);
                if (this.memoryUI && this.memoryUI.breakpoints && this.memoryUI.breakpoints.has(physPCCheck)) {
                    window.Deep16Wasm.step();
                }
            } catch {}
            this.resumeFromBreakpoint = false;
        }
        const runInterval = 10;
        this.runInterval = setInterval(() => {
            if (!this.simulator.running) {
                clearInterval(this.runInterval);
                this.status("Program halted");
                this.addTranscriptEntry("Program execution stopped", "info");
                this.updateAllDisplays();
                this.updateRunButton(false);
                return;
            }
            const stepsPerTick = 200;
            let cont = true;
            for (let i = 0; i < stepsPerTick && this.simulator.running; i++) {
                let csVal = this.simulator.segmentRegisters.CS & 0xFFFF;
                let pcVal = this.simulator.registers[15] & 0xFFFF;
                try {
                    const segsCur = window.Deep16Wasm.get_segments();
                    if (segsCur && segsCur.length >= 1) csVal = segsCur[0] & 0xFFFF;
                } catch {}
                try {
                    const regsCur = window.Deep16Wasm.get_registers();
                    if (regsCur && regsCur.length >= 16) pcVal = regsCur[15] & 0xFFFF;
                } catch {}
                const physPCCheck = ((csVal & 0xFFFF) << 4) + (pcVal & 0xFFFF);
                if (this.memoryUI && this.memoryUI.breakpoints && this.memoryUI.breakpoints.has(physPCCheck)) {
                    cont = false;
                    this.simulator.running = false;
                    this.status(`Breakpoint hit at 0x${physPCCheck.toString(16).padStart(5,'0')}`);
                    this.addTranscriptEntry(`Breakpoint hit at 0x${physPCCheck.toString(16).padStart(5,'0')}`, "warning");
                    this.resumeFromBreakpoint = true;
                    break;
                }
                const stepCont = window.Deep16Wasm.step();
                // Capture store per instruction to mirror to JS memory
                if (typeof window.Deep16Wasm.get_recent_access === 'function') {
                    try {
                        const info = window.Deep16Wasm.get_recent_access();
                        if (info && info.length >= 6) {
                            const address = (info[0] >>> 0);
                            const isStore = ((info[5] >>> 0) === 1);
                            if (isStore && typeof window.Deep16Wasm.get_memory_word === 'function') {
                                const w = window.Deep16Wasm.get_memory_word(address) & 0xFFFF;
                                if (address < this.simulator.memory.length) {
                                    this.simulator.memory[address] = w;
                                }
                                if (this.wasmDirtyStart === null || address < this.wasmDirtyStart) this.wasmDirtyStart = address;
                                if (this.wasmDirtyEnd === null || address > this.wasmDirtyEnd) this.wasmDirtyEnd = address;
                            }
                        }
                    } catch {}
                }
                if (!stepCont) { cont = false; break; }
            }
            const regs = window.Deep16Wasm.get_registers();
            for (let i = 0; i < this.simulator.registers.length && i < regs.length; i++) {
                this.simulator.registers[i] = regs[i] & 0xFFFF;
            }
            if (typeof window.Deep16Wasm.get_psw === 'function') {
                try { this.simulator.psw = window.Deep16Wasm.get_psw() & 0xFFFF; } catch {}
            }
            if (typeof window.Deep16Wasm.get_segments === 'function') {
                try {
                    const segs = window.Deep16Wasm.get_segments();
                    if (segs && segs.length >= 4) {
                        this.simulator.segmentRegisters.CS = segs[0] & 0xFFFF;
                        this.simulator.segmentRegisters.DS = segs[1] & 0xFFFF;
                        this.simulator.segmentRegisters.SS = segs[2] & 0xFFFF;
                        this.simulator.segmentRegisters.ES = segs[3] & 0xFFFF;
                    }
                } catch {}
            }
            if (typeof window.Deep16Wasm.get_recent_access === 'function') {
                try {
                    const info = window.Deep16Wasm.get_recent_access();
                    if (info && info.length >= 6) {
                        const segNames = ['CS','DS','SS','ES'];
                        const address = info[0] >>> 0;
                        const baseAddress = info[1] >>> 0;
                        const offset = info[2] >>> 0;
                        const segmentValue = info[3] >>> 0;
                        const segmentIndex = info[4] >>> 0;
                        const isStore = (info[5] >>> 0) === 1;
                        this.simulator.recentMemoryAccess = {
                            address: address,
                            baseAddress: baseAddress,
                            offset: offset,
                            segment: segNames[segmentIndex] || 'DS',
                            segmentValue: segmentValue,
                            type: isStore ? 'ST' : 'LD',
                            accessedAt: Date.now()
                        };
                        if (isStore && typeof window.Deep16Wasm.get_memory_word === 'function') {
                            try {
                                const w = window.Deep16Wasm.get_memory_word(address) & 0xFFFF;
                                if (address < this.simulator.memory.length) {
                                    this.simulator.memory[address] = w;
                                }
                                if (this.wasmDirtyStart === null || address < this.wasmDirtyStart) this.wasmDirtyStart = address;
                                if (this.wasmDirtyEnd === null || address > this.wasmDirtyEnd) this.wasmDirtyEnd = address;
                            } catch {}
                        }
                    }
                } catch {}
            }
            // Sync a dirty window from WASM memory to JS memory to capture intermediate stores
            try {
                if (this.wasmDirtyStart !== null && this.wasmDirtyEnd !== null) {
                    const startDirty = this.wasmDirtyStart >>> 0;
                    const endDirty = this.wasmDirtyEnd >>> 0;
                    const count = Math.min(256, (endDirty - startDirty + 1));
                    if (count > 0 && typeof window.Deep16Wasm.get_memory_slice === 'function') {
                        const sliceDirty = window.Deep16Wasm.get_memory_slice(startDirty, count);
                        if (sliceDirty && sliceDirty.length) {
                            for (let i = 0; i < sliceDirty.length; i++) {
                                const addr = startDirty + i;
                                if (addr < this.simulator.memory.length) this.simulator.memory[addr] = sliceDirty[i] & 0xFFFF;
                            }
                        }
                    }
                }
            } catch {}
            try {
                const start = this.memoryStartAddress || 0;
                const end = Math.min(start + 64, this.simulator.memory.length);
                if (typeof window.Deep16Wasm.get_memory_slice === 'function') {
                    const slice = window.Deep16Wasm.get_memory_slice(start, end - start);
                    if (slice && slice.length) {
                        for (let i = 0; i < slice.length; i++) {
                            this.simulator.memory[start + i] = slice[i] & 0xFFFF;
                        }
                    }
                }
            } catch {}

            // One-time follow on large jump (WASM): bring PC into view even when locked
            const physPC = ((this.simulator.segmentRegisters.CS & 0xFFFF) << 4) + (this.simulator.registers[15] & 0xFFFF);
            const wStart = this.memoryStartAddress || 0;
            const wEnd = Math.min(wStart + 64, this.simulator.memory.length);
            const wPcVisible = physPC >= wStart && physPC < wEnd;
            const wJumpedFar = Math.abs(physPC - this.lastPhysPC) > 16;
            if (!wPcVisible && wJumpedFar) {
                this.memoryStartAddress = Math.max(0, physPC - 8);
                const startAddressInput = document.getElementById('memory-start-address');
                if (startAddressInput) {
                    startAddressInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
                }
                this.memoryUI.renderMemoryDisplay();
            }
            this.lastPhysPC = physPC;

            this.updateAllDisplays();
            if (!cont) {
                clearInterval(this.runInterval);
                this.simulator.running = false;
                try {
                    if (this.useWasm && window.Deep16Wasm && typeof window.Deep16Wasm.get_memory_slice === 'function') {
                        const addr = this.memoryStartAddress || 0;
                        const slice = window.Deep16Wasm.get_memory_slice(addr, Math.min(16, this.simulator.memory.length - addr));
                        const hex = Array.from(slice).map(v => '0x' + (v & 0xFFFF).toString(16).padStart(4, '0').toUpperCase());
                        // Also log Fibonacci window for verification
                        const fibAddr = 0x0200;
                        const fibSlice = window.Deep16Wasm.get_memory_slice(fibAddr, 16);
                        const fibHex = Array.from(fibSlice).map(v => '0x' + (v & 0xFFFF).toString(16).padStart(4, '0').toUpperCase());
                    }
                } catch {}
                this.lockMemoryStartWhileRunning = false;
                this.wasmDirtyStart = null;
                this.wasmDirtyEnd = null;
                const physPCNow = ((this.simulator.segmentRegisters.CS & 0xFFFF) << 4) + (this.simulator.registers[15] & 0xFFFF);
                if (this.memoryUI && this.memoryUI.breakpoints && this.memoryUI.breakpoints.has(physPCNow)) {
                    this.status(`Program halted at breakpoint 0x${physPCNow.toString(16).padStart(5,'0')}`);
                    this.addTranscriptEntry("Program execution halted at breakpoint (WASM)", "warning");
                    this.resumeFromBreakpoint = true;
                } else {
                    this.status("Program completed");
                    this.addTranscriptEntry("Program execution completed (WASM)", "success");
                }
                this.updateRunButton(false);
            }
        }, runInterval);
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

    setupMobileLayout() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile && !this.mobileActive) {
            this.mobileActive = true;
            this.initializeMobileControls();
            this.initializeMachineTab();
            const headerTitle = document.querySelector('.header-text h1');
            const subtitle = document.querySelector('.header-text .subtitle');
            if (headerTitle) {
                this.originalHeaderTitle = headerTitle.textContent;
                headerTitle.textContent = (window.matchMedia('(max-width: 480px)').matches) ? 'D16' : 'Deep16';
            }
            if (subtitle) { subtitle.style.display = 'none'; }
            this.initializeMiniMenu();
            this.updateTabLabels();

            const machineTab = document.getElementById('machine-tab');
            const viewToggle = document.getElementById('view-toggle');
            if (machineTab) {
                machineTab.classList.add('compact-view');
                this.compactView = true;
                if (viewToggle) viewToggle.textContent = 'Full\u00A0V.';
                if (this.memoryUI && typeof this.memoryUI.updateMemoryDisplayHeight === 'function') {
                    this.memoryUI.updateMemoryDisplayHeight();
                }
            }

            this.updateHeaderHeight();
            this.installResizeWatcher();
        } else if (!isMobile && this.mobileActive) {
            this.mobileActive = false;
            this.restoreDesktopLayout();
            const headerTitle = document.querySelector('.header-text h1');
            const subtitle = document.querySelector('.header-text .subtitle');
            if (headerTitle && this.originalHeaderTitle) {
                headerTitle.textContent = this.originalHeaderTitle;
            }
            if (subtitle) { subtitle.style.display = ''; }
            this.restoreMiniMenu();

            const memoryPanel = document.querySelector('.memory-panel');
            const machineTab = document.getElementById('machine-tab');
            const viewToggle = document.getElementById('view-toggle');
            if (machineTab) {
                machineTab.classList.remove('compact-view');
            }
            if (memoryPanel) {
                memoryPanel.classList.remove('compact-view');
                this.compactView = false;
                if (viewToggle) viewToggle.textContent = 'Compact View';
                if (this.memoryUI && typeof this.memoryUI.updateMemoryDisplayHeight === 'function') {
                    this.memoryUI.updateMemoryDisplayHeight();
                }
            }

            this.updateHeaderHeight();
        }
    }

    initializeMobileControls() {
        const mobileCtrls = document.getElementById('mobile-controls');
        if (!mobileCtrls) return;
        const run = document.getElementById('run-btn');
        const step = document.getElementById('step-btn');
        const reset = document.getElementById('reset-btn');
        const viewToggle = document.getElementById('view-toggle');
        const headerContent = document.querySelector('.header-content');
        const rightControls = document.querySelector('.header-right-controls');
        if (run && step && reset) {
            this.originalButtonParent = run.parentElement;
            // build grouped layout: [Run, Step] [Reset, View] [Docs, WASM]
            const groupRunStep = document.createElement('div');
            groupRunStep.className = 'mobile-group group-run-step';
            groupRunStep.appendChild(run);
            groupRunStep.appendChild(step);

            const groupResetView = document.createElement('div');
            groupResetView.className = 'mobile-group group-reset-view';
            groupResetView.appendChild(reset);
            if (viewToggle) {
                this.originalViewToggleParent = viewToggle.parentElement;
                groupResetView.appendChild(viewToggle);
                viewToggle.textContent = this.compactView ? 'Full\u00A0V.' : 'Compact';
            }
            const groupDocsWasm = document.createElement('div');
            groupDocsWasm.className = 'mobile-group group-docs-wasm';
            if (rightControls) {
                this.originalRightControlsParent = rightControls.parentElement;
                groupDocsWasm.appendChild(rightControls);
            }

            mobileCtrls.textContent = '';
            mobileCtrls.appendChild(groupRunStep);
            mobileCtrls.appendChild(groupResetView);
            mobileCtrls.appendChild(groupDocsWasm);
            mobileCtrls.style.display = 'flex';
            if (headerContent) {
                headerContent.appendChild(mobileCtrls);
            }

            // unify button widths to match "Full V." width
            if (viewToggle) {
                const w = Math.ceil(viewToggle.offsetWidth);
                document.documentElement.style.setProperty('--mobile-btn-w', w + 'px');
            }
            const docsBtn = document.getElementById('docs-menu-btn');
            [run, step, reset, viewToggle, docsBtn].forEach(b => {
                if (b) b.style.width = 'var(--mobile-btn-w)';
            });
        }
    }

    initializeMiniMenu() {
        const miniMenu = document.getElementById('mini-menu');
        const miniBtn = document.getElementById('mini-menu-btn');
        const miniPanel = document.getElementById('mini-menu-panel');
        const fileDropdown = document.getElementById('file-dropdown');
        const editDropdown = document.getElementById('edit-dropdown');
        if (!miniMenu || !miniBtn || !miniPanel || !fileDropdown || !editDropdown) return;

        // Move dropdowns into mini panel
        this.originalFileMenuParent = fileDropdown.parentElement;
        this.originalEditMenuParent = editDropdown.parentElement;
        miniPanel.appendChild(fileDropdown);
        miniPanel.appendChild(editDropdown);
        miniMenu.style.display = 'flex';

        // Ensure both dropdowns are visible inside mini panel
        fileDropdown.classList.add('show');
        editDropdown.classList.add('show');

        // Toggle mini panel visibility and triangle rotation
        if (!this.miniMenuInitialized) {
            miniBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isShown = miniPanel.classList.toggle('show');
                miniBtn.classList.toggle('open', isShown);
            });
            document.addEventListener('click', () => {
                miniPanel.classList.remove('show');
                miniBtn.classList.remove('open');
            });
            this.miniMenuInitialized = true;
        }
    }

    restoreMiniMenu() {
        const miniMenu = document.getElementById('mini-menu');
        const miniPanel = document.getElementById('mini-menu-panel');
        const fileDropdown = document.getElementById('file-dropdown');
        const editDropdown = document.getElementById('edit-dropdown');
        if (!miniMenu || !miniPanel || !fileDropdown || !editDropdown) return;

        // Move back to original parents
        if (this.originalFileMenuParent) this.originalFileMenuParent.appendChild(fileDropdown);
        if (this.originalEditMenuParent) this.originalEditMenuParent.appendChild(editDropdown);
        miniPanel.classList.remove('show');
        miniMenu.style.display = 'none';
    }

    initializeMachineTab() {
        const tabButtons = document.querySelector('.tab-buttons');
        const screenBtn = Array.from(tabButtons.querySelectorAll('.tab-button')).find(b => b.dataset.tab === 'screen');
        let machineBtn = Array.from(tabButtons.querySelectorAll('.tab-button')).find(b => b.dataset.tab === 'machine');
        if (!machineBtn) {
            machineBtn = document.createElement('button');
            machineBtn.className = 'tab-button';
            machineBtn.dataset.tab = 'machine';
            machineBtn.textContent = 'Machine';
            tabButtons.insertBefore(machineBtn, screenBtn);
            machineBtn.addEventListener('click', (e) => this.switchTab('machine'));
        }

        let machineTab = document.getElementById('machine-tab');
        if (!machineTab) {
            machineTab = document.createElement('div');
            machineTab.id = 'machine-tab';
            machineTab.className = 'tab-content';
            const tabContainer = document.querySelector('.tab-container');
            tabContainer.appendChild(machineTab);
        }

        const registersContainer = document.querySelector('.registers-container');
        const memoryControls = document.querySelector('.memory-controls');
        const memoryDisplay = document.getElementById('memory-display');
        const recentPanel = document.querySelector('.recent-memory-panel');

        if (registersContainer && memoryControls && memoryDisplay && recentPanel) {
            this.origRegistersParent = registersContainer.parentElement;
            this.origMemoryControlsParent = memoryControls.parentElement;
            this.origMemoryDisplayParent = memoryDisplay.parentElement;
            this.origRecentPanelParent = recentPanel.parentElement;
            machineTab.appendChild(registersContainer);
            machineTab.appendChild(memoryControls);
            machineTab.appendChild(memoryDisplay);
            machineTab.appendChild(recentPanel);
        }
    }

    restoreDesktopLayout() {
        const run = document.getElementById('run-btn');
        const step = document.getElementById('step-btn');
        const reset = document.getElementById('reset-btn');
        const viewToggle = document.getElementById('view-toggle');
        const rightControls = document.querySelector('.header-right-controls');
        if (run && step && reset && this.originalButtonParent) {
            this.originalButtonParent.appendChild(run);
            this.originalButtonParent.appendChild(step);
            this.originalButtonParent.appendChild(reset);
            const mobileCtrls = document.getElementById('mobile-controls');
            if (mobileCtrls) mobileCtrls.style.display = 'none';
        }
        if (viewToggle && this.originalViewToggleParent) {
            this.originalViewToggleParent.appendChild(viewToggle);
            viewToggle.textContent = 'Compact View';
        }
        if (rightControls && this.originalRightControlsParent) {
            this.originalRightControlsParent.appendChild(rightControls);
        }

        const machineTab = document.getElementById('machine-tab');
        const registersContainer = document.querySelector('.registers-container');
        const memoryControls = document.querySelector('.memory-controls');
        const memoryDisplay = document.getElementById('memory-display');
        const recentPanel = document.querySelector('.recent-memory-panel');
        if (machineTab && this.origRegistersParent && this.origMemoryControlsParent && this.origMemoryDisplayParent && this.origRecentPanelParent) {
            this.origRegistersParent.appendChild(registersContainer);
            this.origMemoryControlsParent.appendChild(memoryControls);
            this.origMemoryDisplayParent.appendChild(memoryDisplay);
            this.origRecentPanelParent.appendChild(recentPanel);
            machineTab.remove();
            const tabButtons = document.querySelector('.tab-buttons');
            const machineBtn = Array.from(tabButtons.querySelectorAll('.tab-button')).find(b => b.dataset.tab === 'machine');
            if (machineBtn) machineBtn.remove();
        }
        this.removeResizeWatcher();
    }

    updateHeaderHeight() {
        const headerContainer = document.querySelector('.header-container');
        if (headerContainer) {
            const hh = headerContainer.offsetHeight;
            document.documentElement.style.setProperty('--header-height', hh + 'px');
        }
        const headerTitle = document.querySelector('.header-text h1');
        if (headerTitle && this.mobileActive) {
            headerTitle.textContent = (window.matchMedia('(max-width: 480px)').matches) ? 'D16' : 'Deep16';
        }
        this.updateTabLabels();
    }

    installResizeWatcher() {
        if (this._resizeHandler) return;
        this._resizeHandler = () => this.updateHeaderHeight();
        window.addEventListener('resize', this._resizeHandler, { passive: true });
    }

    removeResizeWatcher() {
        if (!this._resizeHandler) return;
        window.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = null;
    }

    updateTabLabels() {
        const isNarrow = window.matchMedia('(max-width: 480px)').matches;
        const tabButtons = document.querySelector('.tab-buttons');
        if (!tabButtons) return;
        const editorBtn = Array.from(tabButtons.querySelectorAll('.tab-button')).find(b => b.dataset.tab === 'editor');
        const listingBtn = Array.from(tabButtons.querySelectorAll('.tab-button')).find(b => b.dataset.tab === 'listing');
        const machineBtn = Array.from(tabButtons.querySelectorAll('.tab-button')).find(b => b.dataset.tab === 'machine');
        const errorsBtn = Array.from(tabButtons.querySelectorAll('.tab-button')).find(b => b.dataset.tab === 'errors');
        if (isNarrow) {
            if (editorBtn) editorBtn.textContent = 'Edit';
            if (listingBtn) listingBtn.textContent = 'List';
            if (machineBtn) machineBtn.textContent = 'CPU';
        } else {
            if (editorBtn) editorBtn.textContent = 'Editor';
            if (listingBtn) listingBtn.textContent = 'Listing';
            if (machineBtn) machineBtn.textContent = 'Machine';
        }
        // Errors remains the same
    }

    syncHeaderWidths() {
        const editorPanel = document.querySelector('.editor-panel');
        const memoryPanel = document.querySelector('.memory-panel');
        if (!editorPanel || !memoryPanel) return;
        const leftW = editorPanel.getBoundingClientRect().width;
        const rightW = memoryPanel.getBoundingClientRect().width;
        const totalW = leftW + rightW;
        if (totalW <= 0) return;
        const leftPct = (leftW / totalW) * 100;
        const rightPct = 100 - leftPct;
        document.documentElement.style.setProperty('--left-col-pct', leftPct + '%');
        document.documentElement.style.setProperty('--right-col-pct', rightPct + '%');
    }

    async loadExamplesList() {
        try {
            const response = await fetch('asm/examples.json');
            if (!response.ok) throw new Error('Examples list not found');
            
            const data = await response.json();
            this.examples = data.examples;
            this.populateExampleSelector();
            
            if (window.Deep16Debug) console.log(`Loaded ${this.examples.length} examples`);
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
            this.renderEditorHighlight();
            
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
