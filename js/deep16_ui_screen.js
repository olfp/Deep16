/* deep16_ui_screen.js - Screen display subsystem */
class Deep16ScreenUI {
    constructor(ui) {
        this.ui = ui;
        this.screenBaseAddress = 0xF1000; // Base address for screen memory
        this.screenWidth = 80;
        this.screenHeight = 24;
        this.totalChars = this.screenWidth * this.screenHeight; // 1920 characters
        this.screenEndAddress = this.screenBaseAddress + this.totalChars - 1;
        this.deferUpdates = false;
        this.pendingUpdates = new Set();
        this.flushIntervalMs = 33;
        this.flushTimerId = null;
        this.lastCursorIndex = null;

        // The high byte of a screen word carries four bits of foreground and
        // four of background colour, in the usual ANSI order. Attribute 0 means
        // "not set" and is drawn in the terminal default - that is what a cell
        // the kernel has just written to holds, so plain text stays readable
        // without the kernel having to know about colours at all.
        //
        // The cursor is not a bit of its own. With both nibbles in use there
        // is no room for one, and none is needed: reverse video is the two
        // nibbles swapped, so the kernel marks the cursor cell with the
        // default colour reversed - black on light grey - and clearing it is
        // the attribute back to 0. The screen therefore has no cursor case at
        // all; it draws the colour it is given and the block appears.
        // Mirrors CURSOR_ATTR in asm/forth.asm.
        this.CURSOR_ATTR = 0x7000;

        this.palette = [
            '#000000', '#cd3131', '#0dbc79', '#e5e510', // 0 black, 1 red, 2 green, 3 yellow
            '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5', // 4 blue, 5 magenta, 6 cyan, 7 white
            '#666666', '#f14c4c', '#23d18b', '#f5f543', // 8..11 bright
            '#3b8eea', '#d670d6', '#29b8db', '#ffffff', // 12..15 bright
        ];

        // What each cell was drawn as last time, so a refresh touches only the
        // cells that actually changed. 1920 cells repainted on every tick would
        // make the whole IDE stutter while a program runs.
        this.lastDrawn = new Int32Array(this.totalChars).fill(-1);

        // Whether all 80 columns fit is not a question the viewport can answer: the
        // screen sits in the editor panel, and the memory panel next to it can
        // be dragged down to almost nothing. So the width is measured where the
        // screen actually is, and the pager - the same one the phone view uses -
        // takes over when there is not enough room.
        this.requiredWidth = 640;              // 80 columns at 8 px
        this.cellWidth = 8;                    // one character cell
        this.minVisibleCols = 20;              // below this the screen is unreadable
        this.windowStart = -1;                 // window of columns currently shown
        this.windowCols = -1;
        this.visibleCols = this.screenWidth;
        this.activePage = 0; // 0 = columns 1-40, 1 = columns 41-80

        // Which console the view shows: 'screen' is the memory-mapped buffer at
        // 0xF1000, 'terminal' is the UART byte stream rendered by SerialTerminal.
        // The same switch decides which way input is routed (see deep16_ui_core).
        this.mode = 'screen';
        this.terminal = (typeof SerialTerminal === 'function')
            ? new SerialTerminal(this.screenWidth, this.screenHeight)
            : null;
        // Separate repaint cache for the terminal: a terminal cell is one
        // character plus the cursor flag, not a 16-bit screen word.
        this.lastTermDrawn = new Int32Array(this.totalChars).fill(-1);

        this.initializeScreen();
    }

    initializeScreen() {
        const screenDisplay = document.getElementById('screen-display');
        if (!screenDisplay) return;

        // Create the 80x24 character grid. The cells are emitted without any
        // whitespace between them: an inline-block span counts the source space
        // as width, which would put a gap between every pair of characters.
        let html = '';
        for (let row = 0; row < this.screenHeight; row++) {
            html += `<div class="screen-row" id="screen-row-${row}">`;
            for (let col = 0; col < this.screenWidth; col++) {
                const charIndex = row * this.screenWidth + col;
                html += `<span class="screen-char" id="screen-char-${charIndex}">&nbsp;</span>`;
            }
            html += `</div>`;
        }
        screenDisplay.innerHTML = html;

        this.setupPager();
        this.setupConsoleView();
        this.buildPalette();
        this.applyColumnMode();

        if (window.Deep16Debug) console.log(`Screen initialized: ${this.screenWidth}x${this.screenHeight} at 0x${this.screenBaseAddress.toString(16).toUpperCase()}`);
    }

    // The 16 squares in the menu row, in the same order the colour nibbles use.
    // Purely a legend: it shows which palette the screen draws with.
    buildPalette() {
        const palette = document.getElementById('screen-palette');
        if (!palette) return;
        let html = '';
        for (let i = 0; i < this.palette.length; i++) {
            html += `<span class="screen-palette-swatch" style="background:${this.palette[i]}"></span>`;
        }
        palette.innerHTML = html;
    }

    // Wire the column pager and re-measure whenever the panel changes size, so
    // dragging the split or rotating the phone re-evaluates how many columns
    // fit.
    setupPager() {
        const prevBtn = document.getElementById('screen-page-prev');
        const nextBtn = document.getElementById('screen-page-next');
        if (prevBtn) prevBtn.addEventListener('click', () => this.setPage(0));
        if (nextBtn) nextBtn.addEventListener('click', () => this.setPage(1));

        // Both, not either: the observer follows the panel, the window listener
        // is the safety net for browsers or moments where it stays silent.
        const host = this.measureElement();
        if (host && typeof ResizeObserver === 'function') {
            this.resizeObserver = new ResizeObserver(() => this.applyColumnMode());
            this.resizeObserver.observe(host);
        }
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('resize', () => this.applyColumnMode());
        }
    }

    // Two boxes, two jobs.
        //
        // Measured: the inner .screen-tab. It carries the padding and the
        // `overflow: hidden` that clip the screen, so it decides whether 640 px
        // fit. The .tab-content wrapper around it is wider by that padding, and
        // measuring the wrong one is how a narrow iPad reports "room enough"
        // while the text runs off the edge.
        //
        // Marked: the outer #screen-tab. The narrow-mode CSS has to reach both
        // the menu row and the screen, and the menu row is a *sibling* of
        // .screen-tab rather than a child - a class on the inner box would leave
        // the menu at 640 px while the screen shrinks to 320.
    measureElement() {
        return document.querySelector('.screen-tab')
            || document.getElementById('screen-tab');
    }

    modeElement() {
        return document.getElementById('screen-tab');
    }

    // Inner width of the tab, i.e. what is actually left for the screen once
    // the tab's own padding is off. Zero when the tab is hidden - an inactive
    // tab has no layout, and measuring it would report "no room" and switch the
    // pager on for the wrong reason.
    availableWidth() {
        const host = this.measureElement();
        if (!host) return null;
        const width = host.clientWidth;
        if (!width) return null;
        let padding = 0;
        try {
            const style = window.getComputedStyle(host);
            padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        } catch (e) { /* no layout engine: fall back to clientWidth */ }
        return width - padding;
    }

    // How many columns fit at 8 px each, never fewer than a readable handful.
    columnsThatFit(available) {
        const cols = Math.floor(available / this.cellWidth);
        return Math.max(this.minVisibleCols, Math.min(this.screenWidth, cols));
    }

    // How many pages the pager needs at the current column count: one if
    // everything fits, otherwise as many as it takes to cover all 80.
    pageCount() {
        if (this.visibleCols >= this.screenWidth) return 1;
        return Math.ceil(this.screenWidth / this.visibleCols);
    }

    applyColumnMode() {
        const available = this.availableWidth();
        if (available === null) return;         // not laid out yet - try again later
        const narrow = available < this.requiredWidth;
        // As many columns as actually fit, not a fixed 40. On a tablet with
        // room for 60 the screen shows 60 and the pager covers the remaining 20;
        // a binary 40/80 would waste a fifth of the width for nothing.
        this.visibleCols = narrow ? this.columnsThatFit(available) : this.screenWidth;
        // With all 80 columns visible the pager is meaningless.
        if (!narrow) this.activePage = 0;
        const host = this.modeElement();
        if (host) host.classList.toggle('screen-narrow', narrow);
        this.setPage(this.activePage);
    }

    setPage(page) {
        const screenDisplay = document.getElementById('screen-display');
        if (!screenDisplay) return;
        const pages = this.pageCount();
        const clamped = Math.max(0, Math.min(pages - 1, page));
        this.activePage = clamped;
        screenDisplay.classList.toggle('page-right', clamped > 0);

        // The window of columns this page shows. Cells outside it are hidden
        // here rather than in CSS, because the window moves with the measured
        // width - a :nth-child() rule cannot follow a number that comes from
        // the layout.
        const cols = Math.min(this.visibleCols, this.screenWidth);
        const start = clamped * cols;
        const end = Math.min(start + cols, this.screenWidth);
        if (this.windowStart !== start || this.windowCols !== cols) {
            this.windowStart = start;
            this.windowCols = cols;
            for (let i = 0; i < this.totalChars; i++) {
                const inRow = i % this.screenWidth;
                const cell = document.getElementById(`screen-char-${i}`);
                if (!cell) continue;
                cell.style.display = (inRow >= start && inRow < end) ? '' : 'none';
            }
            screenDisplay.style.width = `${cols * this.cellWidth}px`;
            const menu = document.querySelector('.screen-menu');
            if (menu) menu.style.width = `${cols * this.cellWidth}px`;
        }

        const label = document.getElementById('screen-page-label');
        if (label) {
            const firstCol = start + 1;
            const lastCol = end;
            label.textContent = pages > 1
                ? `${firstCol}-${lastCol} / ${this.screenWidth}`
                : `${this.screenWidth} columns`;
        }
        const prevBtn = document.getElementById('screen-page-prev');
        const nextBtn = document.getElementById('screen-page-next');
        if (prevBtn) prevBtn.disabled = clamped === 0;
        if (nextBtn) nextBtn.disabled = clamped >= pages - 1;
    }

    // The reverse-video cursor is the only feedback a REPL gives, so the page
    // must follow it. No-op when the cursor has not moved, or when all 80
    // columns are visible anyway.
    ensureCursorVisible() {
        if (this.lastCursorIndex === null) return;
        if (this.visibleCols >= this.screenWidth) return;
        const col = this.lastCursorIndex % this.screenWidth;
        const page = col >= this.visibleCols ? 1 : 0;
        if (page !== this.activePage) this.setPage(page);
    }

    setActive(flag) {
        const screenDisplay = document.getElementById('screen-display');
        if (!screenDisplay) return;
        if (flag) { screenDisplay.classList.add('screen-active'); }
        else { screenDisplay.classList.remove('screen-active'); }
    }

    // ---- console view: screen buffer vs. terminal output ------------------

    setupConsoleView() {
        const btn = document.getElementById('console-view-btn');
        if (btn) btn.addEventListener('click', () => this.toggleConsoleView());
        this.updateConsoleViewButton();
        this.updateConsoleInfo();
    }

    // The one switch. 'screen' shows the memory buffer, 'terminal' shows the
    // UART stream. Switching forces a full repaint because the two views share
    // the same DOM cells but not their contents.
    setConsoleView(mode) {
        const next = (mode === 'terminal') ? 'terminal' : 'screen';
        if (next === this.mode) return this.mode;
        this.mode = next;
        this.lastDrawn.fill(-1);
        this.lastTermDrawn.fill(-1);
        this.lastCursorIndex = null;
        this.updateConsoleViewButton();
        this.updateConsoleInfo();
        this.updateScreenDisplay();
        this.applyColumnMode();
        return this.mode;
    }

    toggleConsoleView() {
        return this.setConsoleView(this.mode === 'terminal' ? 'screen' : 'terminal');
    }

    updateConsoleViewButton() {
        const btn = document.getElementById('console-view-btn');
        if (!btn) return;
        const term = this.mode === 'terminal';
        btn.textContent = term ? 'View: Terminal' : 'View: Screen';
        btn.setAttribute('aria-pressed', term ? 'true' : 'false');
        btn.classList.toggle('screen-view-terminal', term);
    }

    // The info line and the colour legend only make sense for the screen. In
    // terminal mode there are no colours (D16MINI decision C2), so the legend
    // is hidden and the address line is replaced.
    updateConsoleInfo() {
        const term = this.mode === 'terminal';
        const full = document.querySelector ? document.querySelector('.screen-info-full') : null;
        const short = document.querySelector ? document.querySelector('.screen-info-short') : null;
        if (full) {
            full.textContent = term
                ? 'Terminal 80\u00d724 \u00b7 UART console (0xF0042 data, 0xF0040 status)'
                : 'Memory: 0xF1000-0xF17BF (80\u00d724 characters) | Lower byte = ASCII, high byte = 4+4 bits colour';
        }
        if (short) {
            short.textContent = term ? 'Terminal \u00b7 80\u00d724' : '0xF1000-0xF17BF \u00b7 80\u00d724';
        }
        const palette = document.getElementById('screen-palette');
        if (palette) palette.style.display = term ? 'none' : '';
    }

    // Feed bytes the machine emitted on its UART. Called by the IDE, which owns
    // the drain from the active core.
    feedConsole(bytes) {
        if (this.terminal && bytes && bytes.length) this.terminal.writeBytes(bytes);
    }

    // The cursor is still bit 15 of the cell: the kernel writes it, so the
    // screen reads it. That bit is the one thing standing between this and a
    // full four-bit background - see updateCharacter().
    updateScreenDisplay() {
        if (this.mode === 'terminal') { this.updateTerminalDisplay(); return; }
        // Update all characters from screen memory
        if (this.ui.compiledCoreReady()) {
            try {
                if (typeof this.ui.activeCoreModule().get_memory_slice === 'function') {
                    const slice = this.ui.activeCoreModule().get_memory_slice(this.screenBaseAddress, this.totalChars);
                    for (let i = 0; i < slice.length; i++) this.drawWord(i, slice[i] & 0xFFFF);
                    return;
                } else if (typeof this.ui.activeCoreModule().get_memory_word === 'function') {
                    for (let i = 0; i < this.totalChars; i++) {
                        this.drawWord(i, this.ui.activeCoreModule().get_memory_word(this.screenBaseAddress + i) & 0xFFFF);
                    }
                    return;
                }
            } catch (e) {
                console.warn('WASM screen read failed, falling back to JS', e);
            }
        }
        {
            for (let i = 0; i < this.totalChars; i++) {
                const memoryAddress = this.screenBaseAddress + i;
                if (memoryAddress < this.ui.simulator.memory.length) {
                    this.drawWord(i, this.ui.simulator.memory[memoryAddress] & 0xFFFF);
                }
            }
        }
    }

    // Draw the whole grid from the terminal model, cursor included. The key is
    // (character, cursor-on-this-cell) packed into one int so a cell repaints
    // when either changes, and not otherwise.
    updateTerminalDisplay() {
        if (!this.terminal) return;
        const cursor = this.terminal.cursorIndex();
        for (let i = 0; i < this.totalChars; i++) {
            const ch = this.terminal.charAt(i) & 0x7F;
            const isCursor = (i === cursor) ? 1 : 0;
            const key = (ch << 1) | isCursor;
            if (this.lastTermDrawn[i] === key) continue;
            this.lastTermDrawn[i] = key;
            this.updateCharacter(i, ch, 0, isCursor === 1);
        }
        this.lastCursorIndex = cursor;
        this.ensureCursorVisible();
    }

    // Draw one cell, unless it already shows this word.
    drawWord(charIndex, word) {
        if (this.lastDrawn[charIndex] === word) return;
        this.lastDrawn[charIndex] = word;
        // 0xFFFF (uninitialised) and 0x0000 read as blanks, as before.
        const blank = (word === 0xFFFF || word === 0x0000);
        const charCode = blank ? 32 : (word & 0xFF);
        const attr = blank ? 0 : ((word >> 8) & 0xFF);
        // The cursor is recognised from the colour, not from a bit beside it.
        // The class below adds nothing but the outline; the colours themselves
        // come from the attribute like any other cell.
        this.updateCharacter(charIndex, charCode, attr,
                             !blank && (word & 0xFF00) === this.CURSOR_ATTR);
    }

    updateCharacter(charIndex, charCode, attr, isCursor) {
        const charElement = document.getElementById(`screen-char-${charIndex}`);
        if (!charElement) return;

        // Convert character code to display character
        let displayChar = ' ';
        if (charCode >= 32 && charCode <= 126) {
            // Printable ASCII characters
            displayChar = String.fromCharCode(charCode);
        } else if (charCode === 10) {
            // Line feed - handled by position
            displayChar = ' ';
        } else if (charCode === 13) {
            // Carriage return - handled by position
            displayChar = ' ';
        } else if (charCode !== 0) {
            // Non-zero, non-printable - show as dot
            displayChar = '·';
        }
        // charCode 0 remains as space

        charElement.textContent = displayChar;
        charElement.classList.toggle('screen-cursor', !!isCursor);
        // Attribute 0 means "no colour set", which leaves the terminal default
        // alone - a blank cell and ordinary text look the same. Anything else
        // is the two nibbles, written as two inline styles: four bits of
        // foreground and four of background, all sixteen of each reachable.
        // The cursor needs no case of its own: the kernel gives it the
        // reversed default, and that is drawn here like any other colour.
        if (attr === 0) {
            charElement.style.color = '';
            charElement.style.backgroundColor = '';
        } else {
            charElement.style.color = this.palette[attr & 0x0F];
            charElement.style.backgroundColor = this.palette[(attr >> 4) & 0x0F];
        }
    }

    // Method to clear the screen (set all memory to 0)
    clearScreen() {
        for (let i = 0; i < this.totalChars; i++) {
            const memoryAddress = this.screenBaseAddress + i;
            if (memoryAddress < this.ui.simulator.memory.length) {
                this.ui.simulator.memory[memoryAddress] = 0;
            }
        }
        this.updateScreenDisplay();
        this.ui.addTranscriptEntry("Screen cleared", "info");
    }

    // Method to write a string to screen memory at specific position
    writeString(row, col, text) {
        if (row < 0 || row >= this.screenHeight || col < 0 || col >= this.screenWidth) {
            console.warn(`Invalid screen position: row=${row}, col=${col}`);
            return;
        }

        for (let i = 0; i < text.length; i++) {
            const currentCol = col + i;
            if (currentCol >= this.screenWidth) break; // Don't wrap automatically
            
            const charIndex = row * this.screenWidth + currentCol;
            const memoryAddress = this.screenBaseAddress + charIndex;
            if (memoryAddress < this.ui.simulator.memory.length) {
                const charCode = text.charCodeAt(i);
                this.ui.simulator.memory[memoryAddress] = charCode;
            }
        }
        this.updateScreenDisplay();
    }

    // Check if an address is within screen memory range
    isScreenMemory(address) {
        return address >= this.screenBaseAddress && address <= this.screenEndAddress;
    }

    // Handle memory writes to screen area
    handleScreenMemoryWrite(address, value) {
        if (this.isScreenMemory(address)) {
            const charIndex = address - this.screenBaseAddress;
            if (this.deferUpdates) {
                this.pendingUpdates.add(charIndex);
            } else {
                // Draw this one cell. drawWord() picks up the block, because
                // the cursor is the cell's colour rather than a bit beside it.
                this.drawWord(charIndex, value & 0xFFFF);
                // The page follows the cursor, which is a cell attribute the
                // kernel writes, so it has to be re-read from the word.
                if ((value & 0xFF00) === this.CURSOR_ATTR) this.lastCursorIndex = charIndex;
                else if (this.lastCursorIndex === charIndex) this.lastCursorIndex = null;
                this.ensureCursorVisible();
            }
        }
    }

    setDeferUpdates(flag) {
        this.deferUpdates = flag;
        if (flag) {
            this.startFlush();
        } else {
            this.stopFlush();
            this.updateScreenDisplay();
        }
    }

    startFlush() {
        if (this.flushTimerId) return;
        this.flushTimerId = setInterval(() => {
            this.flushPending();
        }, this.flushIntervalMs);
    }

    stopFlush() {
        if (this.flushTimerId) {
            clearInterval(this.flushTimerId);
            this.flushTimerId = null;
        }
    }

    flushPending() {
        if (this.pendingUpdates.size === 0) return;
        for (const charIndex of this.pendingUpdates) {
            const memoryAddress = this.screenBaseAddress + charIndex;
            if (memoryAddress < this.ui.simulator.memory.length) {
                const word = this.ui.simulator.memory[memoryAddress] & 0xFFFF;
                this.drawWord(charIndex, word);
                if ((word & 0xFF00) === this.CURSOR_ATTR) this.lastCursorIndex = charIndex;
                else if (this.lastCursorIndex === charIndex) this.lastCursorIndex = null;
            }
        }
        this.pendingUpdates.clear();
        this.ensureCursorVisible();
    }
}
