/* deep16_ui_screen.js - Screen display subsystem */
class Deep16ScreenUI {
    constructor(ui) {
        this.ui = ui;
        this.screenBaseAddress = 0xF1000; // Base address for screen memory
        this.screenWidth = 80;
        this.screenHeight = 25;
        this.totalChars = this.screenWidth * this.screenHeight; // 2000 characters
        this.screenEndAddress = this.screenBaseAddress + this.totalChars - 1;
        this.deferUpdates = false;
        this.pendingUpdates = new Set();
        this.flushIntervalMs = 33;
        this.flushTimerId = null;
        
        this.initializeScreen();
    }

    initializeScreen() {
        const screenDisplay = document.getElementById('screen-display');
        if (!screenDisplay) return;
        
        // Create the 80x25 character grid
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
        
        if (window.Deep16Debug) console.log(`Screen initialized: ${this.screenWidth}x${this.screenHeight} at 0x${this.screenBaseAddress.toString(16).toUpperCase()}`);
    }

    updateScreenDisplay() {
        // Update all characters from screen memory
        if (this.ui.useWasm && this.ui.wasmAvailable && this.ui.wasmInitialized && window.Deep16Wasm) {
            try {
                if (typeof window.Deep16Wasm.get_memory_slice === 'function') {
                    const slice = window.Deep16Wasm.get_memory_slice(this.screenBaseAddress, this.totalChars);
                    for (let i = 0; i < slice.length; i++) {
                        const charCode = slice[i] & 0xFF;
                        this.updateCharacter(i, charCode);
                    }
                    return;
                } else if (typeof window.Deep16Wasm.get_memory_word === 'function') {
                    for (let i = 0; i < this.totalChars; i++) {
                        const word = window.Deep16Wasm.get_memory_word(this.screenBaseAddress + i);
                        const charCode = word & 0xFF;
                        this.updateCharacter(i, charCode);
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
                    const wordValue = this.ui.simulator.memory[memoryAddress];
                    const charCode = wordValue & 0xFF; // Lower byte contains character
                    this.updateCharacter(i, charCode);
                }
            }
        }
    }

    updateCharacter(charIndex, charCode) {
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
                const charCode = value & 0xFF;
                this.updateCharacter(charIndex, charCode);
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
                const wordValue = this.ui.simulator.memory[memoryAddress];
                const charCode = wordValue & 0xFF;
                this.updateCharacter(charIndex, charCode);
            }
        }
        this.pendingUpdates.clear();
    }
}
