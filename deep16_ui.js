// DeepWeb UI Controller - Event Handling and Display Updates
class DeepWebUI {
    constructor() {
        this.assembler = new Deep16Assembler();
        this.simulator = new Deep16Simulator();
        this.memoryStartAddress = 0;
        this.runInterval = null;

        this.initializeEventListeners();
        this.updateAllDisplays();
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
    }

    assemble() {
        const source = document.getElementById('editor').value;
        this.status("Assembling...");

        const result = this.assembler.assemble(source);
        
        if (result.success) {
            this.simulator.loadProgram(result.memory);
            this.status("Assembly successful! Program loaded.");
            document.getElementById('run-btn').disabled = false;
            document.getElementById('step-btn').disabled = false;
            document.getElementById('reset-btn').disabled = false;
            this.updateSymbolTable(result.symbols);
            this.updateSymbolSelect(result.symbols);
        } else {
            this.status("Assembly errors: " + result.errors.join('; '));
        }

        this.updateAllDisplays();
    }

    run() {
        this.simulator.running = true;
        this.status("Running program...");
        
        this.runInterval = setInterval(() => {
            if (!this.simulator.running) {
                clearInterval(this.runInterval);
                this.status("Program halted");
                return;
            }
            
            const continueRunning = this.simulator.step();
            if (!continueRunning) {
                clearInterval(this.runInterval);
                this.status("Program finished");
            }
            
            this.updateAllDisplays();
        }, 50);
    }

    step() {
        this.simulator.running = true;
        this.simulator.step();
        this.updateAllDisplays();
        this.status("Step executed");
    }

    reset() {
        if (this.runInterval) {
            clearInterval(this.runInterval);
        }
        this.simulator.reset();
        this.memoryStartAddress = 0;
        document.getElementById('memory-start-address').value = '0x0000';
        this.updateAllDisplays();
        this.status("Reset complete");
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
        } else {
            this.status("Invalid memory address: " + input.value);
        }
    }

    onSymbolSelect(event) {
        const address = parseInt(event.target.value);
        if (!isNaN(address)) {
            this.memoryStartAddress = address;
            this.updateMemoryDisplay();
        }
    }

    updateAllDisplays() {
        this.updateRegisterDisplay();
        this.updateMemoryDisplay();
    }

    updateRegisterDisplay() {
        const state = this.simulator.getState();
        
        // Update general registers
        const grid = document.getElementById('register-grid');
        let html = '';
        for (let i = 0; i < 16; i++) {
            const regName = i === 12 ? 'FP' : i === 13 ? 'SP' : i === 14 ? 'LR' : i === 15 ? 'PC' : `R${i}`;
            const value = state.registers[i];
            const isPC = i === 15;
            const valueClass = isPC ? 'register-value pc-value' : 'register-value';
            html += `
                <div class="register">
                    <span class="register-name">${regName}</span>
                    <span class="${valueClass}">0x${value.toString(16).padStart(4, '0')}</span>
                </div>
            `;
        }
        grid.innerHTML = html;

        // Update PSW display
        this.updatePSWDisplay(state.psw);
        
        // Update segment registers
        document.getElementById('reg-cs').textContent = `0x${state.segmentRegisters.CS.toString(16).padStart(4, '0')}`;
        document.getElementById('reg-ds').textContent = `0x${state.segmentRegisters.DS.toString(16).padStart(4, '0')}`;
        document.getElementById('reg-ss').textContent = `0x${state.segmentRegisters.SS.toString(16).padStart(4, '0')}`;
        document.getElementById('reg-es').textContent = `0x${state.segmentRegisters.ES.toString(16).padStart(4, '0')}`;
        
        // Update shadow registers
        document.getElementById('reg-psw-shadow').textContent = `0x${state.shadowRegisters.PSW.toString(16).padStart(4, '0')}`;
        document.getElementById('reg-pc-shadow').textContent = `0x${state.shadowRegisters.PC.toString(16).padStart(4, '0')}`;
        document.getElementById('reg-cs-shadow').textContent = `0x${state.shadowRegisters.CS.toString(16).padStart(4, '0')}`;
    }

    updatePSWDisplay(psw) {
        const bits = [
            { id: 'psw-de', bit: 17 }, { id: 'psw-er', bit: 13 }, 
            { id: 'psw-ds', bit: 12 }, { id: 'psw-dr', bit: 11 },
            { id: 'psw-x1', bit: 6 }, { id: 'psw-x2', bit: 7 },
            { id: 'psw-i', bit: 5 }, { id: 'psw-s', bit: 4 },
            { id: 'psw-c', bit: 3 }, { id: 'psw-v', bit: 2 },
            { id: 'psw-z', bit: 1 }, { id: 'psw-n', bit: 0 }
        ];

        bits.forEach(bitInfo => {
            const element = document.getElementById(bitInfo.id);
            const value = (psw >> bitInfo.bit) & 1;
            element.textContent = value;
            element.className = value ? 'psw-value on' : 'psw-value';
        });

        document.getElementById('psw-hex').textContent = `Full: 0x${psw.toString(16).padStart(4, '0')}`;
    }

    updateMemoryDisplay() {
        const display = document.getElementById('memory-display');
        const state = this.simulator.getState();
        let html = '';
        const startAddr = this.memoryStartAddress;
        const endAddr = Math.min(startAddr + 512, state.memory.length);

        for (let addr = startAddr; addr < endAddr; addr += 16) {
            const currentPC = state.registers[15];
            const isPC = (addr <= currentPC && currentPC < addr + 16);
            let lineClass = 'memory-line';
            if (isPC) lineClass += ' pc-marker';

            html += `<div class="${lineClass}">`;
            html += `<div class="memory-address">W:0x${addr.toString(16).padStart(4, '0')}</div>`;
            html += `<div class="memory-bytes">`;

            for (let i = 0; i < 16; i++) {
                const wordAddr = addr + i;
                if (wordAddr < state.memory.length) {
                    const word = state.memory[wordAddr];
                    html += `${word.toString(16).padStart(4, '0')} `;
                }
            }

            html += `</div></div>`;
        }

        display.innerHTML = html;
    }

    updateSymbolTable(symbols) {
        const table = document.getElementById('symbol-table');
        let html = '';

        if (Object.keys(symbols).length === 0) {
            html = '<div style="color: #666; text-align: center; padding: 10px;">No symbols defined</div>';
        } else {
            for (const [name, symbol] of Object.entries(symbols)) {
                html += `
                    <div class="symbol-row">
                        <span class="symbol-name">${name}</span>
                        <span class="symbol-address">0x${symbol.address.toString(16).padStart(4, '0')}</span>
                    </div>
                `;
            }
        }

        table.innerHTML = html;
    }

    updateSymbolSelect(symbols) {
        const select = document.getElementById('symbol-select');
        let html = '<option value="">-- Select Symbol --</option>';

        for (const [name, symbol] of Object.entries(symbols)) {
            html += `<option value="${symbol.address}">${name} (0x${symbol.address.toString(16).padStart(4, '0')})</option>`;
        }

        select.innerHTML = html;
    }

    status(message) {
        document.getElementById('status-bar').textContent = `DeepWeb: ${message}`;
    }

    loadExample() {
        // Example is already loaded in the editor by default
        this.status("Fibonacci example ready - click 'Assemble' to compile");
    }
}

// Initialize DeepWeb when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.deepWeb = new DeepWebUI();
});
