/* deep16_ui_registers.js - Register display and PSW handling */
class Deep16RegisterUI {
    constructor(ui) {
        this.ui = ui;
    }

    updateRegisterDisplay() {
        const registerGrid = document.getElementById('register-grid');
        let html = '';
        
        // Register names with both alias and number
        const registerNames = [
            'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7',
            'R8', 'R9', 'R10', 'R11', 'FP / R12', 'SP / R13', 'LR / R14', 'PC / R15'
        ];
        
        for (let i = 0; i < 16; i++) {
            const value = this.ui.simulator.registers[i];
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
        const psw = this.ui.simulator.psw;
        
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

    updateSegmentRegisters() {
        const segmentGrid = document.querySelector('.register-section:nth-child(3) .register-grid');
        if (segmentGrid) {
            segmentGrid.innerHTML = `
                <div class="register-compact">
                    <span class="register-name">CS</span>
                    <span class="register-value">0x${this.ui.simulator.segmentRegisters.CS.toString(16).padStart(4, '0')}</span>
                </div>
                <div class="register-compact">
                    <span class="register-name">DS</span>
                    <span class="register-value">0x${this.ui.simulator.segmentRegisters.DS.toString(16).padStart(4, '0')}</span>
                </div>
                <div class="register-compact">
                    <span class="register-name">SS</span>
                    <span class="register-value">0x${this.ui.simulator.segmentRegisters.SS.toString(16).padStart(4, '0')}</span>
                </div>
                <div class="register-compact">
                    <span class="register-name">ES</span>
                    <span class="register-value">0x${this.ui.simulator.segmentRegisters.ES.toString(16).padStart(4, '0')}</span>
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
                    <span class="register-value">0x${this.ui.simulator.shadowRegisters.PSW.toString(16).padStart(4, '0')}</span>
                </div>
                <div class="register-compact">
                    <span class="register-name">PC'</span>
                    <span class="register-value">0x${this.ui.simulator.shadowRegisters.PC.toString(16).padStart(4, '0')}</span>
                </div>
                <div class="register-compact">
                    <span class="register-name">CS'</span>
                    <span class="register-value">0x${this.ui.simulator.shadowRegisters.CS.toString(16).padStart(4, '0')}</span>
                </div>
            `;
        }
    }

    toggleRegisterSection(titleElement) {
        if (this.ui.compactView) return;
        
        const section = titleElement.closest('.register-section');
        section.classList.toggle('collapsed');
        
        const toggle = titleElement.querySelector('.section-toggle');
        if (section.classList.contains('collapsed')) {
            toggle.textContent = '▶';
        } else {
            toggle.textContent = '▼';
        }
        
        this.ui.memoryUI.updateMemoryDisplayHeight();
    }
}
