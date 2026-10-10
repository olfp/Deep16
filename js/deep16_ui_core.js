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

        // No serial transfer is in flight yet (see queueSerialSource).
        this.serialSource = null;

        this.initializeEventListeners();
        this.initializeSearchableDropdowns();
        this.initializeTabs();
        // Keyboard input: feed browser key events into simulator keyboard buffer.
        // On iOS the soft keyboard only appears when a real <input> is focused
        // inside the tap gesture, so #terminal-kbd-hook (hidden, focusable, in
        // the Terminal/Screen tab) is that input. While it is focused the keys
        // still belong to the simulator, not to text entry.
        const terminalHook = document.getElementById('terminal-kbd-hook');
        window.addEventListener('keydown', (e) => {
            if (!this.simulator) return;
            const active = document.activeElement;
            const tag = active && active.tagName ? active.tagName.toUpperCase() : '';
            const isHook = !!active && active.id === 'terminal-kbd-hook';
            const isTextual = !!active && (
                (tag === 'INPUT') || (tag === 'TEXTAREA') || (tag === 'SELECT') ||
                (active.isContentEditable === true)
            );
            if (isTextual && !isHook) return;
            if (isHook && (e.ctrlKey || e.metaKey || e.altKey)) return; // keep browser shortcuts (save, reload, ...)
            if (this.screenUI && typeof this.screenUI.setActive === 'function') {
                this.screenUI.setActive(true);
            }
            const code = this.keyEventToCode(e);
            if (code) {
                this.simulator.enqueueKeyCode(code);
                // Compiled cores have their own polled keyboard buffer: mirror
                // every keystroke into whichever one is selected.
                if (this.compiledCoreReady() && typeof this.activeCoreModule().kbd_push === 'function') {
                    this.activeCoreModule().kbd_push(code);
                }
            }
        });

        // Mark screen as active when clicked; clear when focusing inputs
        const screenDisplay = document.getElementById('screen-display');
        if (screenDisplay && this.screenUI && typeof this.screenUI.setActive === 'function') {
            // Tapping the terminal on a touch device summons the iOS soft
            // keyboard: focus the hidden hook input inside the tap gesture.
            screenDisplay.addEventListener('click', () => {
                this.screenUI.setActive(true);
                if (terminalHook && document.activeElement !== terminalHook) {
                    terminalHook.focus({ preventScroll: true });
                }
            });
        }
        document.addEventListener('focusin', (e) => {
            const el = e.target;
            // The hidden hook is the terminal itself pretending to be a text
            // field; focusing it must not clear the terminal-active state.
            if (el && el.id === 'terminal-kbd-hook') return;
            const tag = el && el.tagName ? el.tagName.toUpperCase() : '';
            const isTextual = !!el && ((tag === 'INPUT') || (tag === 'TEXTAREA') || (tag === 'SELECT') || (el.isContentEditable === true));
            if (isTextual && this.screenUI && typeof this.screenUI.setActive === 'function') {
                this.screenUI.setActive(false);
            }
        });
        if (terminalHook) {
            // The hook is only a keyboard conduit: keep it empty so its value
            // cannot grow and linger in an off-screen field.
            terminalHook.addEventListener('input', () => { terminalHook.value = ''; });
        }
        
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
        {
            const phys0 = this.getActivePhysPC();
            const windowSize = 64;
            const memLen = this.simulator.memory.length >>> 0;
            let targetStart = (phys0 - (windowSize >> 1)) >>> 0;
            if (targetStart < 0) targetStart = 0;
            const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
            if (targetStart > maxStart) targetStart = maxStart;
            targetStart &= ~0x7;
            this.memoryStartAddress = targetStart;
            const startAddrInput = document.getElementById('memory-start-address');
            if (startAddrInput) {
                startAddrInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
            }
        }
        const runBtn = document.getElementById('run-btn');
        const stepBtn = document.getElementById('step-btn');
        const resetBtn = document.getElementById('reset-btn');
        const serBtn = document.getElementById('serload-btn');
        if (runBtn) runBtn.disabled = false;
        if (stepBtn) stepBtn.disabled = false;
        if (resetBtn) resetBtn.disabled = false;
        if (serBtn) serBtn.disabled = false;
        this.updateRunIndicator(false);
        this.manualAddressChange = true;
        this.updateAllDisplays();
        this.ensurePCCentered();
        setTimeout(() => { this.memoryUI.scrollToPC(); }, 60);
        this.syncHeaderWidths();
        this.setupMobileLayout();
        this.wasmAvailable = typeof window.Deep16Wasm !== 'undefined';
        this.rtlAvailable = typeof window.Deep16Rtl !== 'undefined';
        // Three cores, one source of truth: 'js' | 'wasm' | 'rtl'. useWasm is
        // kept as a derived flag because a lot of the display code branches on
        // "a compiled core is active"; it is never the thing that is stored.
        this.coreName = 'js';
        this.useWasm = false;
        this.resumeFromBreakpoint = false;
        this.wasmDirtyStart = null;
        this.wasmDirtyEnd = null;
        this.wasmLogLimit = 64;
        this.wasmLogCount = 0;
        const wssamToggle = document.getElementById('wasm-toggle') || document.getElementById('wssam-toggle');
        const coreSelect = document.getElementById('core-select');
        if (coreSelect) {
            let desired = 'js';
            try {
                // new key wins; the old boolean is honoured once so an upgrade
                // does not silently drop someone back to the JS core
                desired = localStorage.getItem('deep16_core')
                    || (localStorage.getItem('deep16_use_wasm') === 'true' ? 'wasm' : 'js');
            } catch {}
            if (!this.coreAvailable(desired)) desired = 'js';
            this.setCore(desired, { mirror: true, announce: false });
            coreSelect.value = this.coreName;
            coreSelect.disabled = !(this.wasmAvailable || this.rtlAvailable);
            coreSelect.addEventListener('change', (e) => {
                const want = e.target.value;
                if (!this.coreAvailable(want)) {
                    this.addTranscriptEntry(`Core ${want} is not available`, "warning");
                    e.target.value = this.coreName;
                    return;
                }
                if (this.runInterval) { this.stop(); }
                const ok = this.setCore(want, { mirror: true });
                if (!ok) {
                    this.addTranscriptEntry(`${this.coreLabel(want)} load failed; staying on ${this.coreLabel(this.coreName)}`, "warning");
                    e.target.value = this.coreName;
                    return;
                }
                try { localStorage.setItem('deep16_core', this.coreName); } catch {}
                try { localStorage.setItem('deep16_use_wasm', this.coreName !== 'js' ? 'true' : 'false'); } catch {}
                this.updateAllDisplays();
            });
        } else if (wssamToggle) {
            let desired = false;
            try { desired = localStorage.getItem('deep16_use_wasm') === 'true'; } catch {}
            wssamToggle.checked = desired;
            wssamToggle.disabled = !this.wasmAvailable;
            wssamToggle.addEventListener('change', (e) => {
                const on = !!e.target.checked;
                // Mirror the JS core into WASM instead of resetting: the
                // toggle must not discard the assembled program or the
                // current machine state.
                if (on && this.wasmAvailable) { this.setCore('wasm', { mirror: true }); }
                else { this.setCore('js', { mirror: false }); }
                e.target.checked = this.useWasm;
                try { localStorage.setItem('deep16_use_wasm', this.useWasm ? 'true' : 'false'); } catch {}
                this.updateAllDisplays();
            });
            this.useWasm = wssamToggle.checked && this.wasmAvailable && !!this.wasmInitialized;
        }
        if (this.wasmAvailable) {
            this.addTranscriptEntry("WASM module detected", "success");
        } else if (window.Deep16WasmReady && typeof window.Deep16WasmReady.then === 'function') {
            this.addTranscriptEntry("WASM module loading...", "info");
            window.Deep16WasmReady.then(() => {
                this.finishWasmInit(wssamToggle, 'wasm');
            }).catch(() => {
                this.addTranscriptEntry("WASM module failed to load", "error");
            });
        } else {
            this.addTranscriptEntry("WASM module not available", "info");
            if (wssamToggle) { wssamToggle.disabled = true; wssamToggle.checked = false; }
        }
        // Third core: same treatment as WASM, but the module that arrives is
        // the RTL model. Both can finish in either order.
        if (this.rtlAvailable) {
            this.addTranscriptEntry("RTL module detected", "success");
        } else if (window.Deep16RtlReady && typeof window.Deep16RtlReady.then === 'function') {
            this.addTranscriptEntry("RTL module loading...", "info");
            window.Deep16RtlReady.then(() => {
                this.finishWasmInit(wssamToggle, 'rtl');
            }).catch(() => {
                this.addTranscriptEntry("RTL module failed to load", "error");
            });
        } else {
            this.addTranscriptEntry("RTL module not available", "info");
        }
        window.addEventListener('deep16-wasm-ready', () => {
            this.finishWasmInit(wssamToggle, 'wasm');
            if (this.wasmInitialized && !this.simulator.running) { this.run(); }
        });
        window.addEventListener('deep16-rtl-ready', () => {
            this.finishWasmInit(wssamToggle, 'rtl');
        });
        this.addTranscriptEntry("DeepCode initialized and ready", "info");
        this.initTabSizeSetting();
        this.setupEditorHighlighting();
    }

    // ---- core selection ---------------------------------------------------
    // Three interchangeable cores. The JS core stays the source of truth: both
    // compiled cores get a mirror of it whenever the selection changes, so
    // switching never throws away the assembled program or the machine state.
    // 'useWasm' stays as the derived "a compiled core is active" flag the
    // display code branches on - the stored value is always coreName.
    coreLabel(name) {
        if (name === 'rtl') return 'RTL (Verilator)';
        if (name === 'wasm') return 'WASM (Rust)';
        return 'JS';
    }

    // ---- serial source (SERLOAD) ------------------------------------------
    // A picked file is not pushed in one go: the RTL core's FIFO is 128 entries
    // deep and silently drops a push that arrives while it is full, which would
    // lose source text in the middle of a file. So the file is kept here and
    // handed over a few characters per run tick, paced by what the machine has
    // actually consumed. SER_FIFO_DEPTH is the smallest queue any core has.
    static get SER_FIFO_DEPTH() { return 128; }
    static get SER_CHUNK() { return 64; }

    // Characters still queued on the active core, or NaN when that core cannot
    // say. NaN means "unknown", and the pump then feeds a single character,
    // which cannot overflow anything.
    serialAvailable() {
        if (this.compiledCoreReady()) {
            const C = this.activeCoreModule();
            return (typeof C.serial_available === 'function') ? C.serial_available() : NaN;
        }
        const s = this.simulator;
        return (s && typeof s.serialAvailable === 'function') ? s.serialAvailable() : NaN;
    }

    // Push into the active core and mirror into the JS one, the way a
    // keystroke is mirrored into both (see the keydown handler). Without the
    // mirror, switching cores mid-file would deliver nothing at all.
    serialPushCode(code) {
        const s = this.simulator;
        if (s && typeof s.serialPush === 'function') s.serialPush(code);
        if (this.compiledCoreReady()) {
            const C = this.activeCoreModule();
            if (typeof C.serial_push === 'function') C.serial_push(code);
        }
    }

    serialSetEof(on = true) {
        const s = this.simulator;
        if (s && typeof s.serialSetEof === 'function') s.serialSetEof(on);
        if (this.compiledCoreReady()) {
            const C = this.activeCoreModule();
            if (typeof C.serial_set_eof === 'function') C.serial_set_eof(on);
        }
    }

    serialClearAll() {
        const s = this.simulator;
        if (s && typeof s.serialClear === 'function') s.serialClear();
        if (this.compiledCoreReady()) {
            const C = this.activeCoreModule();
            if (typeof C.serial_clear === 'function') C.serial_clear();
        }
    }

    // Hand a file to the machine. Nothing is pushed yet: the kernel has to run
    // SERLOAD first, and until then the queue only fills up.
    queueSerialSource(file) {
        const reader = new FileReader();
        reader.onload = () => {
            // A UTF-8 BOM would arrive as three characters and become the first
            // token of the first line. The kernel ends a line on LF as well as
            // CR, so the text is passed on unchanged.
            let text = String(reader.result || '');
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            if (!text) {
                this.addTranscriptEntry(`SERLOAD: ${file.name} is empty`, "warning");
                return;
            }
            this.serialSource = { name: file.name, text, pos: 0, done: false, stalled: false };
            this.addTranscriptEntry(
                `SERLOAD: ${file.name} queued (${text.length} chars) - type SERLOAD on the keyboard, then Run`,
                "info");
            this.status(`${file.name} queued for SERLOAD`);
        };
        reader.onerror = () => {
            this.addTranscriptEntry(`SERLOAD: could not read ${file.name}`, "error");
        };
        reader.readAsText(file);
    }

    // Cancel an in-flight transfer and drop whatever is still queued.
    cancelSerialFeed(reason = '') {
        if (!this.serialSource && !this.serialSourceActive) return;
        this.serialSource = null;
        this.serialClearAll();
        if (reason) this.addTranscriptEntry(`SERLOAD: transfer cancelled (${reason})`, "warning");
    }

    // Feed the queued file, as far as the machine's queue allows. Called from
    // both run loops; returns the number of characters handed over.
    pumpSerialQueue() {
        const src = this.serialSource;
        if (!src || src.done) return 0;
        const avail = this.serialAvailable();
        let room = Number.isFinite(avail) ? (DeepWebUI.SER_FIFO_DEPTH - avail) : 1;
        room = Math.min(room, DeepWebUI.SER_CHUNK);
        if (room <= 0) {
            // The queue is full and only the machine can empty it. Say so once
            // rather than on every tick.
            if (!src.stalled) {
                src.stalled = true;
                this.addTranscriptEntry('SERLOAD: line is full - press Run to let the machine read', "warning");
                this.status('Serial line full - press Run');
            }
            return 0;
        }
        src.stalled = false;
        const start = src.pos;
        const end = Math.min(src.text.length, src.pos + room);
        for (; src.pos < end; src.pos++) this.serialPushCode(src.text.charCodeAt(src.pos));
        if (src.pos >= src.text.length) {
            src.done = true;
            // EOF only after the last character: SER_STATUS reports 2 once the
            // queue has drained, so nothing is truncated.
            this.serialSetEof(true);
            this.addTranscriptEntry(`SERLOAD: all ${src.text.length} chars sent - waiting for EOF`, "info");
            this.status(`SERLOAD: ${src.name} sent completely`);
        }
        return end - start;
    }

    coreAvailable(name) {
        if (name === 'wasm') return !!this.wasmAvailable && !!window.Deep16Wasm;
        if (name === 'rtl') return !!this.rtlAvailable && !!window.Deep16Rtl;
        return name === 'js';
    }

    // The module object of the active compiled core, or null for the JS core.
    activeCoreModule() {
        if (!this.useWasm) return null;
        return this.coreName === 'rtl' ? window.Deep16Rtl : window.Deep16Wasm;
    }

    // True when a compiled core is selected, its module finished loading and
    // its init mirror succeeded. Every "am I not on the JS core?" branch tests
    // this, so a core that is still loading falls back to the JS core instead
    // of throwing on a half-built module.
    compiledCoreReady() {
        if (!this.useWasm) return false;
        const ready = this.coreName === 'rtl' ? this.rtlInitialized : this.wasmInitialized;
        return !!ready && !!this.activeCoreModule();
    }

    // Point coreName at a core, mirroring the JS state into it first. Returns
    // false without changing anything if that core is unavailable or the
    // mirror failed - the caller then keeps the current core.
    setCore(name, { mirror = true, announce = true } = {}) {
        if (!this.coreAvailable(name)) return false;
        if (name !== 'js' && mirror) {
            if (!this.syncStateIntoCore()) return false;
            // A successful mirror is what "initialised" means for a compiled
            // core - record it here too, so selecting a core directly (rather
            // than through finishWasmInit) cannot leave coreName set while
            // compiledCoreReady() still says no.
            if (name === 'rtl') this.rtlInitialized = true; else this.wasmInitialized = true;
        }
        this.coreName = name;
        this.useWasm = name !== 'js';
        // The new core's serial line is empty, while the JS mirror still holds
        // whatever was fed so far. Half a file is worse than none: cancel.
        if (this.serialSource) this.cancelSerialFeed('core changed');
        const select = document.getElementById('core-select');
        if (select) select.value = name;
        if (announce) this.addTranscriptEntry(`Core: ${this.coreLabel(name)}`, "info");
        return true;
    }

    // Live counters of the active core. Only the compiled cores export these;
    // the JS core has no pipeline and no cache, so it shows the name alone
    // rather than zeros that would read like a cache that never hits.
    updateCoreStats() {
        const el = document.getElementById('core-stats');
        if (!el) return;
        const label = this.coreLabel(this.coreName);
        if (!this.compiledCoreReady()) {
            el.textContent = `${label} - keine Zaehler`;
            return;
        }
        const C = this.activeCoreModule();
        const num = (name) => (typeof C[name] === 'function' ? C[name]() : null);
        const instr = num('get_instr_count');
        const cycles = num('get_cycle_count');
        const stalls = num('get_stall_count');
        const flushes = num('get_flush_count');
        const hits = num('get_cache_hits');
        const misses = num('get_cache_misses');

        const parts = [label];
        // CPI over retired instructions - the instruction count, not the step
        // count, because the final halt step retires nothing.
        if (instr) parts.push(`${instr} Befehle`);
        if (cycles !== null && instr) parts.push(`CPI ${(cycles / instr).toFixed(2)}`);
        if (cycles !== null) parts.push(`${cycles} Zyklen`);
        if (stalls !== null && stalls) parts.push(`${stalls} Stalls`);
        if (flushes !== null && flushes) parts.push(`${flushes} Flushes`);
        if (hits !== null && misses !== null && (hits + misses) > 0) {
            const rate = (100 * hits) / (hits + misses);
            parts.push(`Cache ${rate.toFixed(1)}% (${hits}/${hits + misses})`);
        } else if (hits !== null) {
            parts.push('Cache -');
        }
        el.textContent = parts.join('  |  ');
        el.title = `${label}: Zyklen, Stalls (Load-Use), verworfene Fetches, Cache-Treffer/-Misses`;

        // Narrow form for phones: the header row carries Run/Step/Reset next to
        // this, so the full line does not fit. Keep only the two numbers that
        // change what you would do next - CPI and the cache hit rate. It is a
        // separate element rather than a CSS trick so the full line stays
        // readable in the DOM (and to screen readers and tests) either way.
        const mini = document.getElementById('core-stats-mini');
        if (mini) {
            const short = [];
            if (cycles !== null && instr) short.push(`CPI ${(cycles / instr).toFixed(2)}`);
            if (hits !== null && misses !== null && (hits + misses) > 0) {
                short.push(`Cache ${(100 * hits / (hits + misses)).toFixed(1)}%`);
            }
            mini.textContent = short.join(' \u00b7 ');
            mini.title = el.title;
        }
    }

    updateRunIndicator(isRunning) {
        const el = document.getElementById('run-state-indicator');
        if (!el) return;
        if (isRunning) {
            el.textContent = 'Run';
            el.classList.add('run-indicator-running');
            el.classList.remove('run-indicator-halt');
            return;
        }

        const cs = this.simulator.segmentRegisters.CS & 0xFFFF;
        const pc = this.simulator.registers[15] & 0xFFFF;
        const physPC = ((cs << 4) + pc) >>> 0;
        const cur = physPC < this.simulator.memory.length ? (this.simulator.memory[physPC] & 0xFFFF) : 0xFFFF;
        const bpHit = this.memoryUI && this.memoryUI.breakpoints && this.memoryUI.breakpoints.has(physPC);

        if (cur === 0xFFFF) {
            el.textContent = 'Halt';
            el.classList.add('run-indicator-halt');
            el.classList.remove('run-indicator-running');
        } else if (bpHit) {
            el.textContent = `B 0x${physPC.toString(16).padStart(5,'0')}`;
            el.classList.remove('run-indicator-running');
            el.classList.remove('run-indicator-halt');
        } else {
            el.textContent = 'Ready';
            el.classList.remove('run-indicator-running');
            el.classList.remove('run-indicator-halt');
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

        // SERLOAD: hand a source file to the Forth kernel over the serial line.
        // The button only picks the file; the actual transfer runs through
        // pumpSerialQueue() below while the machine steps.
        const serBtn = document.getElementById('serload-btn');
        const serFile = document.getElementById('serload-file');
        if (serBtn) serBtn.addEventListener('click', () => serFile && serFile.click());
        if (serFile) serFile.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) this.queueSerialSource(file);
            // Selecting the same file again has to fire 'change' again.
            e.target.value = '';
        });
        
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
                asm:['LSI','LD','ST','LDS','STS','MVS','SMV','MOV','HALT','JMP','JNZ','JZ','JC','JNC','JN','JNN','JO','JNO','RET','LINK','ALINK','LNK','ALNK','ADD','SUB','CMP','AND','OR','XOR','TBS','TBC','CLRB','MUL','MUL32','DIV','DIV32','SWB','INV','NEG','SRS','SRD','ERS','ERD','SET','CLR','SET2','CLR2','SL','SLA','SLAC','SLC','SR','SRC','SRA','SRAC','ROL','RLC','ROR','RRC','JML','NOP']
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
            const windowSize = 64;
            const memLen = this.simulator.memory.length >>> 0;
            let targetStart = (physicalAddress - (windowSize >> 1)) >>> 0;
            if (targetStart < 0) targetStart = 0;
            const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
            if (targetStart > maxStart) targetStart = maxStart;
            targetStart &= ~0x7;
            this.memoryStartAddress = targetStart;

            const startAddressInput = document.getElementById('memory-start-address');
            if (startAddressInput) {
                startAddressInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
            }

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
            const windowSize = 64;
            const memLen = this.simulator.memory.length >>> 0;
            let targetStart = (address - (windowSize >> 1)) >>> 0;
            if (targetStart < 0) targetStart = 0;
            const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
            if (targetStart > maxStart) targetStart = maxStart;
            targetStart &= ~0x7;
            this.memoryStartAddress = targetStart;
            const startAddressInput = document.getElementById('memory-start-address');
            if (startAddressInput) {
                startAddressInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
            }
            this.manualAddressChange = true;
            this.memoryUI.renderMemoryDisplay();
            const symbolName = event.target.options[event.target.selectedIndex].text.split(' (')[0];
            this.addTranscriptEntry(`Memory view centered on symbol: ${symbolName}`, "info");
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
            // Entering the terminal on a touch device raises the soft keyboard
            // (clicking the tab is a user gesture, so iOS honours the focus).
            const hook = document.getElementById('terminal-kbd-hook');
            if (hook && document.activeElement !== hook) {
                hook.focus({ preventScroll: true });
            }
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
                // Do not modify registers or segments during Assemble
                if (this.useWasm && this.activeCoreModule()) {
                    if (this.syncStateIntoCore()) {
                        this.addTranscriptEntry(`Program loaded into ${this.coreLabel(this.coreName)} core`, "success");
                    } else {
                        this.addTranscriptEntry(`${this.coreLabel(this.coreName)} load failed; falling back to JS`, "warning");
                        this.setCore('js', { mirror: false });
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
                
                this.status("Assembly successful! Program loaded.");
                this.addTranscriptEntry("Assembly successful - program loaded", "success");
                document.getElementById('run-btn').disabled = false;
                document.getElementById('step-btn').disabled = false;
                document.getElementById('reset-btn').disabled = false;
                
                this.updateSymbolSelects(result.symbols);
                this.addTranscriptEntry(`Found ${Object.keys(result.symbols).length} symbols`, "info");
                {
                    const cs0 = this.simulator.segmentRegisters.CS & 0xFFFF;
                    const pc0 = this.simulator.registers[15] & 0xFFFF;
                    const phys0 = ((cs0 << 4) + pc0) >>> 0;
                    const windowSize = 64;
                    const memLen = this.simulator.memory.length >>> 0;
                    let targetStart = (phys0 - (windowSize >> 1)) >>> 0;
                    if (targetStart < 0) targetStart = 0;
                    const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
                    if (targetStart > maxStart) targetStart = maxStart;
                    targetStart &= ~0x7;
                    this.memoryStartAddress = targetStart;
                    const addrInput = document.getElementById('memory-start-address');
                    if (addrInput) {
                        addrInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
                    }
                    this.manualAddressChange = true;
                    this.memoryUI.renderMemoryDisplay();
                    this.ensurePCCentered();
                    setTimeout(() => { this.memoryUI.scrollToPC(); }, 120);
                }
                
                this.switchTab('screen');
            } else {
                const errorMsg = `Assembly failed with ${result.errors.length} error(s)`;
                this.status("Assembly errors - see errors tab for details");
                this.addTranscriptEntry(errorMsg, "error");
                this.switchTab('errors');
            }

            this.updateAllDisplays();
            this.ensurePCCentered();
            setTimeout(() => { this.memoryUI.scrollToPC(); }, 120);
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
        this.updateCoreStats();
    }

    run() {
        // Toggle Run/Stop
        if (this.simulator.running) {
            this.stop();
            return;
        }
        if (this.compiledCoreReady()) {
            this.wasmRun();
        } else {
            this.jsRun();
        }
    }

    // Translate a browser key event into the ASCII-style key code the
    // simulator/BIOS expect (parity with Deep16Simulator.enqueueKeyEvent).
    keyEventToCode(e) {
        if (e.key === 'Enter') return 10;
        if (e.key === 'Backspace') return 8;
        if (e.key === 'Tab') return 9;
        if (e.key.length === 1) return e.key.charCodeAt(0);
        return 0;
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
            // Hand the machine whatever the serial line still has room for,
            // once per tick, paced by what it consumed since the last tick.
            if (this.serialSource) this.pumpSerialQueue();
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
            const physPC = this.getActivePhysPC();
            const start = this.memoryStartAddress || 0;
            const end = Math.min(start + 64, this.simulator.memory.length);
            const pcVisible = physPC >= start && physPC < end;
            const jumpedFar = Math.abs(physPC - this.lastPhysPC) > 16;
            if (!pcVisible && jumpedFar) {
                const windowSize = 64;
                const memLen = this.simulator.memory.length >>> 0;
                let targetStart = (physPC - (windowSize >> 1)) >>> 0;
                if (targetStart < 0) targetStart = 0;
                const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
                if (targetStart > maxStart) targetStart = maxStart;
                targetStart &= ~0x7;
                this.memoryStartAddress = targetStart;
                const startAddressInput = document.getElementById('memory-start-address');
                if (startAddressInput) {
                    startAddressInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
                }
                this.memoryUI.renderMemoryDisplay();
                this.memoryUI.scrollToPC();
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

    getActivePhysPC() {
        if (this.compiledCoreReady()) {
            try {
                const psw = typeof this.activeCoreModule().get_psw === 'function' ? (this.activeCoreModule().get_psw() & 0xFFFF) : 0;
                const sbit = (psw & (1 << 5)) !== 0;
                if (sbit && typeof this.activeCoreModule().get_shadow_state === 'function') {
                    const sh = this.activeCoreModule().get_shadow_state();
                    const pc = sh && sh.length >= 3 ? (sh[0] & 0xFFFF) : (this.simulator.shadowRegisters.PC & 0xFFFF);
                    const cs = sh && sh.length >= 3 ? (sh[1] & 0xFFFF) : (this.simulator.shadowRegisters.CS & 0xFFFF);
                    return ((cs << 4) + pc) >>> 0;
                }
                const segs = typeof this.activeCoreModule().get_segments === 'function' ? this.activeCoreModule().get_segments() : null;
                const regs = typeof this.activeCoreModule().get_registers === 'function' ? this.activeCoreModule().get_registers() : null;
                const cs = segs && segs.length >= 1 ? (segs[0] & 0xFFFF) : (this.simulator.segmentRegisters.CS & 0xFFFF);
                const pc = regs && regs.length >= 16 ? (regs[15] & 0xFFFF) : (this.simulator.registers[15] & 0xFFFF);
                return ((cs << 4) + pc) >>> 0;
            } catch {}
        }
        const sbitSim = (this.simulator.psw & (1 << 5)) !== 0;
        if (sbitSim) {
            const cs = this.simulator.shadowRegisters.CS & 0xFFFF;
            const pc = this.simulator.shadowRegisters.PC & 0xFFFF;
            return ((cs << 4) + pc) >>> 0;
        }
        const cs = this.simulator.segmentRegisters.CS & 0xFFFF;
        const pc = this.simulator.registers[15] & 0xFFFF;
        return ((cs << 4) + pc) >>> 0;
    }
    ensurePCCentered() {
        const phys = this.getActivePhysPC();
        const windowSize = 64;
        const memLen = this.simulator.memory.length >>> 0;
        const start = this.memoryStartAddress >>> 0;
        const end = Math.min(start + windowSize, memLen);
        const margin = 8;
        const pcVisible = phys >= start && phys < end;
        const nearTop = (phys - start) < margin;
        const nearBottom = (end - phys) <= margin;
        if (!pcVisible || nearTop || nearBottom) {
            let targetStart = (phys - (windowSize >> 1)) >>> 0;
            if (targetStart < 0) targetStart = 0;
            const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
            if (targetStart > maxStart) targetStart = maxStart;
            targetStart &= ~0x7;
            this.memoryStartAddress = targetStart;
            const startAddressInput = document.getElementById('memory-start-address');
            if (startAddressInput) {
                startAddressInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
            }
            this.manualAddressChange = true;
            this.memoryUI.renderMemoryDisplay();
        }
    }

    step() {
        const beforePhys = this.getActivePhysPC();
        if (!this.simulator.running) {
            this.simulator.running = true;
        }
        
        if (this.compiledCoreReady()) {
            try {
                if (this.wasmLogCount < this.wasmLogLimit) {
                    const pswCur = typeof this.activeCoreModule().get_psw === 'function' ? (this.activeCoreModule().get_psw() & 0xFFFF) : 0;
                    const sbit = (pswCur & (1 << 5)) !== 0;
                    let aboutCS = 0, aboutPC = 0;
                    if (sbit && typeof this.activeCoreModule().get_shadow_state === 'function') {
                        const sh = this.activeCoreModule().get_shadow_state();
                        aboutPC = sh && sh.length >= 3 ? (sh[0] & 0xFFFF) : 0;
                        aboutCS = sh && sh.length >= 3 ? (sh[1] & 0xFFFF) : 0;
                    } else if (typeof this.activeCoreModule().get_segments === 'function' && typeof this.activeCoreModule().get_registers === 'function') {
                        const segs = this.activeCoreModule().get_segments();
                        const regs = this.activeCoreModule().get_registers();
                        aboutCS = segs && segs.length >= 1 ? (segs[0] & 0xFFFF) : 0;
                        aboutPC = regs && regs.length >= 16 ? (regs[15] & 0xFFFF) : 0;
                    }
                    const aboutPhys = ((aboutCS << 4) + aboutPC) >>> 0;
                    if (typeof this.activeCoreModule().get_memory_word === 'function') {
                        const w = this.activeCoreModule().get_memory_word(aboutPhys) & 0xFFFF;
                        this.addTranscriptEntry(`${this.coreLabel(this.coreName)} fetch: CS=0x${aboutCS.toString(16)}, PC=0x${aboutPC.toString(16)}, instr=0x${w.toString(16)}`, "info");
                    }
                    this.wasmLogCount++;
                }
            } catch {}
            try {
                let csNow = 0, pcNow = 0;
                if (typeof this.activeCoreModule().get_psw === 'function' && typeof this.activeCoreModule().get_shadow_state === 'function') {
                    const pswNow = this.activeCoreModule().get_psw() & 0xFFFF;
                    const sbitNow = (pswNow & (1 << 5)) !== 0;
                    if (sbitNow) {
                        const sh = this.activeCoreModule().get_shadow_state();
                        pcNow = sh && sh.length >= 3 ? (sh[0] & 0xFFFF) : 0;
                        csNow = sh && sh.length >= 3 ? (sh[1] & 0xFFFF) : 0;
                    } else {
                        const segs = this.activeCoreModule().get_segments();
                        const regs = this.activeCoreModule().get_registers();
                        csNow = segs && segs.length ? (segs[0] & 0xFFFF) : 0;
                        pcNow = regs && regs.length ? (regs[15] & 0xFFFF) : 0;
                    }
                }
                const physNow = ((csNow << 4) + pcNow) >>> 0;
                if (typeof this.activeCoreModule().get_memory_word === 'function') {
                    const wNow = this.activeCoreModule().get_memory_word(physNow) & 0xFFFF;
                    this.addTranscriptEntry(`${this.coreLabel(this.coreName)} prefetch: CS=0x${csNow.toString(16)}, PC=0x${pcNow.toString(16)}, instr=0x${wNow.toString(16)}`, "info");
                }
            } catch {}
            const cont = this.activeCoreModule().step();
            const regs = this.activeCoreModule().get_registers();
            for (let i = 0; i < this.simulator.registers.length && i < regs.length; i++) {
                this.simulator.registers[i] = regs[i] & 0xFFFF;
            }
            if (typeof this.activeCoreModule().get_psw === 'function') {
                try { this.simulator.psw = this.activeCoreModule().get_psw() & 0xFFFF; } catch {}
            }
            if (typeof this.activeCoreModule().get_segments === 'function') {
                try {
                    const segs = this.activeCoreModule().get_segments();
                    if (segs && segs.length >= 4) {
                        this.simulator.segmentRegisters.CS = segs[0] & 0xFFFF;
                        this.simulator.segmentRegisters.DS = segs[1] & 0xFFFF;
                        this.simulator.segmentRegisters.SS = segs[2] & 0xFFFF;
                        this.simulator.segmentRegisters.ES = segs[3] & 0xFFFF;
                    }
                } catch {}
            }
            try {
                const sbit = (this.simulator.psw & (1 << 5)) !== 0;
                this.addTranscriptEntry(`${this.coreLabel(this.coreName)} PSW S=${sbit ? 1 : 0}`, "info");
            } catch {}
            if (typeof this.activeCoreModule().get_recent_access === 'function') {
                try {
                    const info = this.activeCoreModule().get_recent_access();
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
                        if (isStore && typeof this.activeCoreModule().get_memory_word === 'function') {
                            try {
                                const w = this.activeCoreModule().get_memory_word(address) & 0xFFFF;
                                if (address < this.simulator.memory.length) {
                                    this.simulator.memory[address] = w;
                                }
                                this.addTranscriptEntry(`${this.coreLabel(this.coreName)} store @0x${address.toString(16).padStart(5,'0')} = 0x${w.toString(16).padStart(4,'0').toUpperCase()} seg=${segNames[segmentIndex]}(0x${segmentValue.toString(16)})`, "info");
                            } catch {}
                        }
                    }
                } catch {}
            }
            if (typeof this.activeCoreModule().get_last_event === 'function') {
                try {
                    const ev = this.activeCoreModule().get_last_event();
                    if (ev && ev.length >= 5 && ev[0] === 2) {
                        const spc = ev[1] & 0xFFFF;
                        const scs = ev[2] & 0xFFFF;
                        const psw = ev[3] & 0xFFFF;
                        this.addTranscriptEntry(`${this.coreLabel(this.coreName)} SWI: S=1, CS'=0x${scs.toString(16)}, PC'=0x${spc.toString(16)} PSW=0x${psw.toString(16)}`, "info");
                    } else if (ev && ev.length >= 5 && ((ev[0] & 0xFFF0) === 0xFFF0)) {
                        const instr = ev[0] & 0xFFFF;
                        const spc = ev[1] & 0xFFFF;
                        const scs = ev[2] & 0xFFFF;
                        this.addTranscriptEntry(`${this.coreLabel(this.coreName)} SYS fetch: instr=0x${instr.toString(16)}, CS=0x${scs.toString(16)}, PC=0x${spc.toString(16)}`, "info");
                    }
                } catch {}
            }
            try {
                const start = this.memoryStartAddress || 0;
                const end = Math.min(start + 64, this.simulator.memory.length);
                if (typeof this.activeCoreModule().get_memory_slice === 'function') {
                    const slice = this.activeCoreModule().get_memory_slice(start, end - start);
                    if (slice && slice.length) {
                        for (let i = 0; i < slice.length; i++) {
                            this.simulator.memory[start + i] = slice[i] & 0xFFFF;
                        }
                    }
                }
            } catch {}
            // Bring new PC into view on large jumps when stepping (${this.coreLabel(this.coreName)})
            const afterPhys = this.getActivePhysPC();
            const start2 = this.memoryStartAddress || 0;
            const end2 = Math.min(start2 + 64, this.simulator.memory.length);
            const pcVisible2 = afterPhys >= start2 && afterPhys < end2;
            const jumpedFar2 = Math.abs(afterPhys - beforePhys) > 16;
            if (this.compactView) {
                const margin = 8;
                const nearTop = (afterPhys - start2) < margin || afterPhys < start2;
                const nearBottom = (end2 - afterPhys) <= margin;
                if (!pcVisible2 || jumpedFar2 || nearTop || nearBottom) {
                    const windowSize = 64;
                    const memLen = this.simulator.memory.length >>> 0;
                    let targetStart = (afterPhys - (windowSize >> 1)) >>> 0;
                    if (targetStart < 0) targetStart = 0;
                    const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
                    if (targetStart > maxStart) targetStart = maxStart;
                    targetStart &= ~0x7;
                    this.memoryStartAddress = targetStart;
                    const startAddressInput = document.getElementById('memory-start-address');
                    if (startAddressInput) {
                        startAddressInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
                    }
                    this.memoryUI.renderMemoryDisplay();
                }
            }
            // Full View: keep PC comfortably inside viewport; recenter near edges
            if (!this.compactView) {
                const margin = 8;
                const nearTop = (afterPhys - start2) < margin;
                const nearBottom = (end2 - afterPhys) <= margin;
                if (!pcVisible2 || jumpedFar2 || nearTop || nearBottom) {
                    const windowSize = 64;
                    const memLen = this.simulator.memory.length >>> 0;
                    let targetStart = (afterPhys - (windowSize >> 1)) >>> 0; // center PC
                    if (targetStart < 0) targetStart = 0;
                    const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
                    if (targetStart > maxStart) targetStart = maxStart;
                    targetStart &= ~0x7; // align to 8-word line
                    this.memoryStartAddress = targetStart;
                }
            }
            const startAddressInput2 = document.getElementById('memory-start-address');
            if (startAddressInput2) {
                startAddressInput2.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
            }
            this.memoryUI.renderMemoryDisplay();
            this.lastPhysPC = afterPhys;
            this.updateAllDisplays();
            if (!cont) {
                this.simulator.running = false;
                this.status("Program halted");
                this.addTranscriptEntry(`Program halted after step (${this.coreLabel(this.coreName)})`, "info");
                this.updateRunButton(false);
            }
            this.addTranscriptEntry(`Step (${this.coreLabel(this.coreName)}): 0x${beforePhys.toString(16).padStart(5,'0')} -> 0x${afterPhys.toString(16).padStart(5,'0')}`, "info");
            this.simulator.running = false;
        } else {
            const continueRunning = this.simulator.step();
            this.simulator.running = false;
            // Bring new PC into view on large jumps when stepping
            const afterPhys = this.getActivePhysPC();
            const start = this.memoryStartAddress || 0;
            const end = Math.min(start + 64, this.simulator.memory.length);
            const pcVisible = afterPhys >= start && afterPhys < end;
            const jumpedFar = Math.abs(afterPhys - beforePhys) > 16;
            if (this.compactView) {
                const margin = 8;
                const nearTop = (afterPhys - start) < margin || afterPhys < start;
                const nearBottom = (end - afterPhys) <= margin;
                if (!pcVisible || jumpedFar || nearTop || nearBottom) {
                    const windowSize = 64;
                    const memLen = this.simulator.memory.length >>> 0;
                    let targetStart = (afterPhys - (windowSize >> 1)) >>> 0;
                    if (targetStart < 0) targetStart = 0;
                    const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
                    if (targetStart > maxStart) targetStart = maxStart;
                    targetStart &= ~0x7;
                    this.memoryStartAddress = targetStart;
                    const startAddressInput = document.getElementById('memory-start-address');
                    if (startAddressInput) {
                        startAddressInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
                    }
                    this.memoryUI.renderMemoryDisplay();
                }
            }
            // Full View: keep PC comfortably inside viewport; recenter near edges
            if (!this.compactView) {
                const margin = 8;
                const nearTop = (afterPhys - start) < margin;
                const nearBottom = (end - afterPhys) <= margin;
                if (!pcVisible || jumpedFar || nearTop || nearBottom) {
                    const windowSize = 64;
                    const memLen = this.simulator.memory.length >>> 0;
                    let targetStart = (afterPhys - (windowSize >> 1)) >>> 0; // center PC
                    if (targetStart < 0) targetStart = 0;
                    const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
                    if (targetStart > maxStart) targetStart = maxStart;
                    targetStart &= ~0x7; // align to 8-word line
                    this.memoryStartAddress = targetStart;
                }
            }
            const startAddressInput3 = document.getElementById('memory-start-address');
            if (startAddressInput3) {
                startAddressInput3.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
            }
            this.memoryUI.renderMemoryDisplay();
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

    // Copy the JS core's complete state into the ${this.coreLabel(this.coreName)} core: memory (ROM, the
    // assembled program, and data written by earlier runs) plus registers,
    // PSW, segments and PC. ${this.coreLabel(this.coreName)} is rebuilt with init() first so no stale
    // state survives, but neither core is reset - assembling or toggling the
    // header switch must never lose the program or the machine state the user
    // is looking at.
    //
    // Call order matters: load_program() leaves PC=0/CS=0xFFFF behind it, and
    // set_registers() places element 15 through the current PSW.S bit, so the
    // state setters run after it with PSW set before registers.
    // Mirror the JS core into the active compiled core (${this.coreLabel(this.coreName)} or RTL). Both
    // expose the same API shape, so this one body serves either. Returns false
    // if that core is not ready or refused the load.
    syncStateIntoCore() {
        const C = this.useWasm ? this.activeCoreModule() : (window.Deep16Wasm || window.Deep16Rtl);
        if (!C) return false;
        try {
            if (typeof C.set_registers !== 'function' || typeof C.set_psw !== 'function') {
                this.addTranscriptEntry(`${this.coreLabel(this.coreName)} package is out of date; rebuild it`, "warning");
                return false;
            }
            C.init(this.simulator.memory.length);
            C.load_program(0, new Uint16Array(this.simulator.memory));
            const seg = this.simulator.segmentRegisters;
            C.set_segments(seg.CS & 0xFFFF, seg.DS & 0xFFFF, seg.SS & 0xFFFF, seg.ES & 0xFFFF);
            C.set_psw(this.simulator.psw & 0xFFFF);
            C.set_registers(new Uint16Array(this.simulator.registers));
            this.wasmDirtyStart = null;
            this.wasmDirtyEnd = null;
            return true;
        } catch (e) {
            if (window.Deep16Debug) console.error(`${this.coreLabel(this.coreName)} state sync failed`, e);
            return false;
        }
    }

    // Shared tail of the async init paths for both compiled cores (the
    // Deep16WasmReady/Deep16RtlReady promises and their matching events):
    // mirror the JS core into the module, mark it ready and restore the stored
    // selection if it names this core. The JS core is the source of truth - a
    // compiled core always gets a copy of whatever state the page is in.
    finishWasmInit(wssamToggle, coreName = 'wasm') {
        const isRtl = coreName === 'rtl';
        if (isRtl) this.rtlAvailable = true;
        const wasSelected = this.coreName === coreName;
        // Mirror into a temporarily selected state so syncStateIntoCore() talks
        // to the module that just arrived.
        const prevCore = this.coreName, prevUse = this.useWasm;
        this.coreName = coreName;
        this.useWasm = true;
        const ok = this.syncStateIntoCore();
        if (ok) {
            if (isRtl) this.rtlInitialized = true; else this.wasmInitialized = true;
            this.addTranscriptEntry(`${this.coreLabel(coreName)} module loaded`, "success");
            if (!wasSelected) {
                // This core was not the active one, so restore the selection.
                this.coreName = prevCore;
                this.useWasm = prevUse;
            }
            if (this.coreName === coreName) {
                this.addTranscriptEntry(`Core: ${this.coreLabel(coreName)}`, "info");
                if (wssamToggle) { wssamToggle.disabled = false; wssamToggle.checked = true; }
            }
            const select = document.getElementById('core-select');
            if (select) { select.disabled = false; select.value = this.coreName; }
        } else {
            this.coreName = prevCore;
            this.useWasm = prevUse;
            if (isRtl) this.rtlInitialized = false; else this.wasmInitialized = false;
            if (wssamToggle) { wssamToggle.disabled = true; wssamToggle.checked = false; }
            this.addTranscriptEntry(`${this.coreLabel(coreName)} init failed; staying on ${this.coreLabel(this.coreName)}`, "warning");
        }
    }

    reset() {
        if (this.runInterval) {
            clearInterval(this.runInterval);
            this.runInterval = null;
        }
        // A reset empties the serial line on both the core and its JS mirror,
        // so a half-sent file would leave the kernel waiting for a line that
        // never comes. Drop the transfer instead of resuming into silence.
        if (this.serialSource) this.cancelSerialFeed('machine reset');
        if (this.compiledCoreReady()) {
            try { this.activeCoreModule().reset(); } catch {}
        }
        
        this.simulator.reset();
        this.wasmDirtyStart = null;
        this.wasmDirtyEnd = null;
        const cs0 = this.simulator.segmentRegisters.CS & 0xFFFF;
        const pc0 = this.simulator.registers[15] & 0xFFFF;
        const phys0 = ((cs0 << 4) + pc0) >>> 0;
        const windowSize = 64;
        const memLen = this.simulator.memory.length >>> 0;
        let targetStart = (phys0 - (windowSize >> 1)) >>> 0;
        if (targetStart < 0) targetStart = 0;
        const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
        if (targetStart > maxStart) targetStart = maxStart;
        targetStart &= ~0x7;
        this.memoryStartAddress = targetStart;
        const addrInput = document.getElementById('memory-start-address');
        if (addrInput) {
            addrInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
        }
        this.manualAddressChange = true;
        this.updateRunButton(false);
        this.updateAllDisplays();
        this.ensurePCCentered();
        setTimeout(() => { this.memoryUI.scrollToPC(); }, 60);
        this.status("Simulator reset");
        this.addTranscriptEntry("Simulator reset to initial state", "info");
        this.switchTab('editor');
        // Auto-run boot ROM after reset
        try {
            this.run();
        } catch {}
    }

    wasmRun() {
        this.simulator.running = true;
        this.lockMemoryStartWhileRunning = true;
        this.status(`Running program (${this.coreLabel(this.coreName)})...`);
        this.addTranscriptEntry(`Starting ${this.coreLabel(this.coreName)} execution`, "info");
        this.updateRunButton(true);
        try {
            if (typeof this.activeCoreModule().get_memory_slice === 'function') {
                const scanStart = 0;
                const scanCount = Math.min(4096, this.simulator.memory.length);
                const slice = this.activeCoreModule().get_memory_slice(scanStart, scanCount);
                if (slice && slice.length) {
                    let hits = [];
                    for (let i = 0; i < slice.length && hits.length < 8; i++) {
                        if ((slice[i] & 0xFFFF) === 0xFFF2) hits.push((scanStart + i) >>> 0);
                    }
                    this.addTranscriptEntry(`WASM scan: found ${hits.length} SWI opcodes${hits.length ? ' at ' + hits.map(a => '0x' + a.toString(16).padStart(5,'0')).join(', ') : ''}`, "info");
                }
            }
            if (typeof this.activeCoreModule().get_memory_word === 'function') {
                const vec = this.activeCoreModule().get_memory_word(((0 << 4) + 2) >>> 0) & 0xFFFF;
                this.addTranscriptEntry(`${this.coreLabel(this.coreName)} vector[2]=0x${vec.toString(16).padStart(4,'0')}`, "info");
            }
        } catch {}
        if (this.resumeFromBreakpoint) {
            try {
                let csVal = this.simulator.segmentRegisters.CS & 0xFFFF;
                let pcVal = this.simulator.registers[15] & 0xFFFF;
                try {
                    const segsCur = this.activeCoreModule().get_segments();
                    if (segsCur && segsCur.length >= 1) csVal = segsCur[0] & 0xFFFF;
                } catch {}
                try {
                    const regsCur = this.activeCoreModule().get_registers();
                    if (regsCur && regsCur.length >= 16) pcVal = regsCur[15] & 0xFFFF;
                } catch {}
                const physPCCheck = ((csVal & 0xFFFF) << 4) + (pcVal & 0xFFFF);
                if (this.memoryUI && this.memoryUI.breakpoints && this.memoryUI.breakpoints.has(physPCCheck)) {
                    this.activeCoreModule().step();
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
            // Same cadence as the JS loop: one pump per tick, not per step.
            if (this.serialSource) this.pumpSerialQueue();
            let cont = true;
            let lastSBit = ((this.simulator.psw & (1 << 5)) !== 0) ? 1 : 0;
            for (let i = 0; i < stepsPerTick && this.simulator.running; i++) {
                let csVal = this.simulator.segmentRegisters.CS & 0xFFFF;
                let pcVal = this.simulator.registers[15] & 0xFFFF;
                try {
                    const segsCur = this.activeCoreModule().get_segments();
                    if (segsCur && segsCur.length >= 1) csVal = segsCur[0] & 0xFFFF;
                } catch {}
                try {
                    const regsCur = this.activeCoreModule().get_registers();
                    if (regsCur && regsCur.length >= 16) pcVal = regsCur[15] & 0xFFFF;
                } catch {}
                try {
                    if (this.wasmLogCount < this.wasmLogLimit) {
                        const pswCur = typeof this.activeCoreModule().get_psw === 'function' ? (this.activeCoreModule().get_psw() & 0xFFFF) : 0;
                        const sbit = (pswCur & (1 << 5)) !== 0;
                        let aboutCS = csVal, aboutPC = pcVal;
                        if (sbit && typeof this.activeCoreModule().get_shadow_state === 'function') {
                            const sh = this.activeCoreModule().get_shadow_state();
                            aboutPC = sh && sh.length >= 3 ? (sh[0] & 0xFFFF) : aboutPC;
                            aboutCS = sh && sh.length >= 3 ? (sh[1] & 0xFFFF) : aboutCS;
                        }
                        const aboutPhys = ((aboutCS << 4) + aboutPC) >>> 0;
                        if (typeof this.activeCoreModule().get_memory_word === 'function') {
                            const w = this.activeCoreModule().get_memory_word(aboutPhys) & 0xFFFF;
                            this.addTranscriptEntry(`${this.coreLabel(this.coreName)} fetch: CS=0x${aboutCS.toString(16)}, PC=0x${aboutPC.toString(16)}, instr=0x${w.toString(16)}`, "info");
                        }
                        this.wasmLogCount++;
                    }
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
                const stepCont = this.activeCoreModule().step();
                try {
                    const pswCur2 = typeof this.activeCoreModule().get_psw === 'function' ? (this.activeCoreModule().get_psw() & 0xFFFF) : 0;
                    const sbit2 = (pswCur2 & (1 << 5)) !== 0 ? 1 : 0;
                    if (sbit2 !== lastSBit) {
                        this.addTranscriptEntry(`${this.coreLabel(this.coreName)} PSW S=${sbit2}`, "info");
                        lastSBit = sbit2;
                    }
                    if (typeof this.activeCoreModule().get_last_event === 'function') {
                        const ev = this.activeCoreModule().get_last_event();
                        if (ev && ev.length >= 5 && ev[0] === 2) {
                            const spc = ev[1] & 0xFFFF;
                            const scs = ev[2] & 0xFFFF;
                            const psw = ev[3] & 0xFFFF;
                            this.addTranscriptEntry(`${this.coreLabel(this.coreName)} SWI: S=1, CS'=0x${scs.toString(16)}, PC'=0x${spc.toString(16)} PSW=0x${psw.toString(16)}`, "info");
                        }
                    }
                } catch {}
                // Capture store per instruction to mirror to JS memory
                if (typeof this.activeCoreModule().get_recent_access === 'function') {
                    try {
                        const info = this.activeCoreModule().get_recent_access();
                        if (info && info.length >= 6) {
                            const address = (info[0] >>> 0);
                            const isStore = ((info[5] >>> 0) === 1);
                            if (isStore && typeof this.activeCoreModule().get_memory_word === 'function') {
                                const w = this.activeCoreModule().get_memory_word(address) & 0xFFFF;
                                if (address < this.simulator.memory.length) {
                                    this.simulator.memory[address] = w;
                                }
                                if (this.screenUI && this.screenUI.isScreenMemory && this.screenUI.handleScreenMemoryWrite) {
                                    if (this.screenUI.isScreenMemory(address)) {
                                        this.screenUI.handleScreenMemoryWrite(address, w);
                                    }
                                }
                                if (this.wasmDirtyStart === null || address < this.wasmDirtyStart) this.wasmDirtyStart = address;
                                if (this.wasmDirtyEnd === null || address > this.wasmDirtyEnd) this.wasmDirtyEnd = address;
                            }
                        }
                    } catch {}
                }
                if (!stepCont) { cont = false; break; }
            }
            const regs = this.activeCoreModule().get_registers();
            for (let i = 0; i < this.simulator.registers.length && i < regs.length; i++) {
                this.simulator.registers[i] = regs[i] & 0xFFFF;
            }
            if (typeof this.activeCoreModule().get_psw === 'function') {
                try { this.simulator.psw = this.activeCoreModule().get_psw() & 0xFFFF; } catch {}
            }
            if (typeof this.activeCoreModule().get_segments === 'function') {
                try {
                    const segs = this.activeCoreModule().get_segments();
                    if (segs && segs.length >= 4) {
                        this.simulator.segmentRegisters.CS = segs[0] & 0xFFFF;
                        this.simulator.segmentRegisters.DS = segs[1] & 0xFFFF;
                        this.simulator.segmentRegisters.SS = segs[2] & 0xFFFF;
                        this.simulator.segmentRegisters.ES = segs[3] & 0xFFFF;
                    }
                } catch {}
            }
            if (typeof this.activeCoreModule().get_recent_access === 'function') {
                try {
                    const info = this.activeCoreModule().get_recent_access();
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
                            if (isStore && typeof this.activeCoreModule().get_memory_word === 'function') {
                                try {
                                    const w = this.activeCoreModule().get_memory_word(address) & 0xFFFF;
                                    if (address < this.simulator.memory.length) {
                                        this.simulator.memory[address] = w;
                                    }
                                    if (this.screenUI && this.screenUI.isScreenMemory && this.screenUI.handleScreenMemoryWrite) {
                                        if (this.screenUI.isScreenMemory(address)) {
                                            this.screenUI.handleScreenMemoryWrite(address, w);
                                        }
                                    }
                                    if (this.wasmDirtyStart === null || address < this.wasmDirtyStart) this.wasmDirtyStart = address;
                                    if (this.wasmDirtyEnd === null || address > this.wasmDirtyEnd) this.wasmDirtyEnd = address;
                                } catch {}
                            }
                    }
                } catch {}
            }
            // Sync a dirty window from ${this.coreLabel(this.coreName)} memory to JS memory to capture intermediate stores
            try {
                if (this.wasmDirtyStart !== null && this.wasmDirtyEnd !== null) {
                    const startDirty = this.wasmDirtyStart >>> 0;
                    const endDirty = this.wasmDirtyEnd >>> 0;
                    const count = Math.min(256, (endDirty - startDirty + 1));
                    if (count > 0 && typeof this.activeCoreModule().get_memory_slice === 'function') {
                        const sliceDirty = this.activeCoreModule().get_memory_slice(startDirty, count);
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
                if (typeof this.activeCoreModule().get_memory_slice === 'function') {
                    const slice = this.activeCoreModule().get_memory_slice(start, end - start);
                    if (slice && slice.length) {
                        for (let i = 0; i < slice.length; i++) {
                            this.simulator.memory[start + i] = slice[i] & 0xFFFF;
                        }
                    }
                }
            } catch {}

            // One-time follow on large jump (${this.coreLabel(this.coreName)}): bring PC into view even when locked
            const physPC = this.getActivePhysPC();
            const wStart = this.memoryStartAddress || 0;
            const wEnd = Math.min(wStart + 64, this.simulator.memory.length);
            const wPcVisible = physPC >= wStart && physPC < wEnd;
            const wJumpedFar = Math.abs(physPC - this.lastPhysPC) > 16;
            if (!wPcVisible && wJumpedFar) {
                const windowSize = 64;
                const memLen = this.simulator.memory.length >>> 0;
                let targetStart = (physPC - (windowSize >> 1)) >>> 0;
                if (targetStart < 0) targetStart = 0;
                const maxStart = memLen > windowSize ? (memLen - windowSize) : 0;
                if (targetStart > maxStart) targetStart = maxStart;
                targetStart &= ~0x7;
                this.memoryStartAddress = targetStart;
                const startAddressInput = document.getElementById('memory-start-address');
                if (startAddressInput) {
                    startAddressInput.value = '0x' + this.memoryStartAddress.toString(16).padStart(5, '0');
                }
                this.memoryUI.renderMemoryDisplay();
                this.memoryUI.scrollToPC();
            }
            this.lastPhysPC = physPC;

            this.updateAllDisplays();
            if (!cont) {
                clearInterval(this.runInterval);
                this.simulator.running = false;
                try {
                    if (this.compiledCoreReady() && typeof this.activeCoreModule().get_memory_slice === 'function') {
                        const addr = this.memoryStartAddress || 0;
                        const slice = this.activeCoreModule().get_memory_slice(addr, Math.min(16, this.simulator.memory.length - addr));
                        const hex = Array.from(slice).map(v => '0x' + (v & 0xFFFF).toString(16).padStart(4, '0').toUpperCase());
                        // Also log Fibonacci window for verification
                        const fibAddr = 0x0200;
                        const fibSlice = this.activeCoreModule().get_memory_slice(fibAddr, 16);
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
                    this.addTranscriptEntry(`Program execution completed (${this.coreLabel(this.coreName)})`, "success");
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
        const serload = document.getElementById('serload-btn');
        const viewToggle = document.getElementById('view-toggle');
        const headerContent = document.querySelector('.header-content');
        const rightControls = document.querySelector('.header-right-controls');
        const indicator = document.getElementById('run-state-indicator');
        if (run && step && reset) {
            this.originalButtonParent = run.parentElement;
            if (indicator) this.originalRunIndicatorParent = indicator.parentElement;
            // build grouped layout: [Run, Step] [Reset, View] [Docs, ${this.coreLabel(this.coreName)}]
            const groupRunStep = document.createElement('div');
            groupRunStep.className = 'mobile-group group-run-step';
            groupRunStep.appendChild(run);
            if (indicator && !window.matchMedia('(max-width: 480px)').matches) {
                groupRunStep.appendChild(indicator);
            }
            groupRunStep.appendChild(step);

            const groupResetView = document.createElement('div');
            groupResetView.className = 'mobile-group group-reset-view';
            groupResetView.appendChild(reset);
            // SERLOAD belongs here for the same reason the other three are
            // moved: on a phone the memory panel header is not what anyone
            // looks at, so a file picker left behind there is unreachable.
            if (serload) {
                this.originalSerloadParent = serload.parentElement;
                groupResetView.appendChild(serload);
                // The mobile buttons are all one fixed width, sized after the
                // view toggle; the ellipsis would only make the label clip.
                serload.textContent = 'SERLOAD';
            }
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
            [run, step, reset, serload, viewToggle, docsBtn].forEach(b => {
                if (b) b.style.width = 'var(--mobile-btn-w)';
            });
            this.repositionMobileIndicator();
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
        const serload = document.getElementById('serload-btn');
        const viewToggle = document.getElementById('view-toggle');
        const rightControls = document.querySelector('.header-right-controls');
        const indicator = document.getElementById('run-state-indicator');
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
        // SERLOAD goes back in front of the view toggle, which is where the
        // markup has it - appendChild would leave it behind the button that
        // used to follow it.
        if (serload && this.originalSerloadParent) {
            const anchor = (viewToggle && viewToggle.parentElement === this.originalSerloadParent)
                ? viewToggle : null;
            this.originalSerloadParent.insertBefore(serload, anchor);
            serload.textContent = 'SERLOAD\u2026';
        }
        if (rightControls && this.originalRightControlsParent) {
            this.originalRightControlsParent.appendChild(rightControls);
        }
        if (indicator && this.originalRunIndicatorParent) {
            this.originalRunIndicatorParent.appendChild(indicator);
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
        this.repositionMobileIndicator();
    }

    repositionMobileIndicator() {
        if (!this.mobileActive) return;
        const indicator = document.getElementById('run-state-indicator');
        if (!indicator) return;
        const isNarrow = window.matchMedia('(max-width: 480px)').matches;
        if (isNarrow) {
            const headerText = document.querySelector('.header-text');
            if (!headerText) return;
            let container = document.getElementById('mobile-run-indicator');
            if (!container) {
                container = document.createElement('div');
                container.id = 'mobile-run-indicator';
                container.className = 'mobile-run-indicator';
                headerText.appendChild(container);
            }
            container.appendChild(indicator);
        } else {
            const groupRunStep = document.querySelector('.group-run-step');
            const step = document.getElementById('step-btn');
            if (groupRunStep && step) {
                groupRunStep.insertBefore(indicator, step);
            }
        }
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
            // cache: 'no-store' — the assets in index.html all carry a ?v= parameter, but
// the example source has none, so the browser may serve a stale asm/forth.asm
// and silently re-run an older kernel. Bypassing the HTTP cache costs nothing
// for a locally served source file.
const response = await fetch(`asm/${filename}`, { cache: 'no-store' });
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
    try {
        window.deepWebUI.reset();
        window.deepWebUI.run();
    } catch {}
});
