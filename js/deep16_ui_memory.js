/* deep16_ui_memory.js - Memory display and segment handling */
class Deep16MemoryUI {
    constructor(ui) {
        this.ui = ui;
        this.segmentInfo = {
            code: { start: 0x0000, end: 0x1FFF },
            data: { start: 0x2000, end: 0x3FFF },
            stack: { start: 0x4000, end: 0x7FFF }
        };
    }

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

        // Add some padding around segments for better display
        if (segments.code.start !== Infinity) {
            segments.code.start = Math.max(0, segments.code.start - 16);
            segments.code.end = segments.code.end + 32;
        }
        if (segments.data.start !== Infinity) {
            segments.data.start = Math.max(0, segments.data.start - 8);
            segments.data.end = segments.data.end + 16;
        }

        this.segmentInfo = segments;
        return segments;
    }

    isCodeAddress(address) {
        if (!this.ui.currentAssemblyResult || !this.ui.currentAssemblyResult.segmentMap) {
            return false;
        }
        
        const segment = this.ui.currentAssemblyResult.segmentMap.get(address);
        return segment === 'code';
    }

createMemoryLine(address) {
    const value = this.ui.simulator.memory[address];
    const valueHex = value.toString(16).padStart(4, '0').toUpperCase();
    const isPC = (address === this.ui.simulator.registers[15]);
    const pcClass = isPC ? 'pc-marker' : '';
    
    // Check if this should be displayed as code
    if (this.isCodeAddress(address)) {
        let disasm = this.ui.disassembler.disassemble(value);
        
        // Enhanced jump disassembly with absolute addresses
        if ((value >>> 12) === 0b1110) {
            disasm = this.ui.disassembler.disassembleJumpWithAddress(value, address);
        }
        
        const source = this.getSourceForAddress(address);
        
        // FIX: Only show actual hex values for code, never "----"
        const displayValue = `0x${valueHex}`;
        
        let html = `<div class="memory-line code-line ${pcClass}">`;
        html += `<span class="memory-address">0x${address.toString(16).padStart(5, '0')}</span>`;
        html += `<span class="memory-bytes">${displayValue}</span>`;
        html += `<span class="memory-disassembly">${disasm}</span>`;
        if (source) {
            html += `<span class="memory-source">; ${source}</span>`;
        }
        html += `</div>`;
        return html;
    } else {
        // For data, we need to check if this is the start of a data line
        const lineStart = address - (address % 8);
        if (address !== lineStart) {
            return ''; // Skip non-start addresses in data lines
        }
        
        // Create a data line with 8 words
        let html = `<div class="memory-line data-line ${pcClass}">`;
        html += `<span class="memory-address">0x${address.toString(16).padStart(5, '0')}</span>`;
        
        for (let i = 0; i < 8; i++) {
            const dataAddr = address + i;
            if (dataAddr >= this.ui.simulator.memory.length) break;
            
            const dataValue = this.ui.simulator.memory[dataAddr];
            const dataHex = dataValue.toString(16).padStart(4, '0').toUpperCase();
            const dataPC = (dataAddr === this.ui.simulator.registers[15]);
            const dataClass = dataPC ? 'pc-marker' : '';
            
            // For data lines, show "----" for uninitialized memory (0xFFFF)
            const displayData = dataValue === 0xFFFF ? "----" : `0x${dataHex}`;
            
            html += `<span class="memory-data ${dataClass}">${displayData}</span>`;
        }
        
        // Get source for data line
        const source = this.getDataLineSource(address);
        if (source) {
            html += `<span class="memory-source">; ${source}</span>`;
        }
        
        html += `</div>`;
        return html;
    }
}

    getSourceForAddress(address) {
        if (!this.ui.currentAssemblyResult) return '';
        
        const listing = this.ui.currentAssemblyResult.listing;
        
        // First, try to find the exact address with data definition
        for (const item of listing) {
            if (item.address === address) {
                if (item.line && (item.line.includes('.word') || item.line.includes('.byte') || item.line.includes('.space'))) {
                    return item.line.trim(); // Prefer data definitions
                }
                if (item.instruction !== undefined && item.line) {
                    return item.line.trim(); // Code instructions
                }
            }
        }
        
        // If no exact match, find the nearest label or data definition
        let lastLabel = '';
        let lastData = '';
        let lastOrg = '';
        
        for (const item of listing) {
            if (item.line) {
                const line = item.line.trim();
                if (line.endsWith(':')) {
                    lastLabel = line;
                } else if (line.startsWith('.word') || line.startsWith('.byte') || line.startsWith('.space')) {
                    lastData = line;
                } else if (line.startsWith('.org')) {
                    lastOrg = line;
                }
            }
            
            if (item.address === address) {
                // Return the most relevant source
                if (lastData) return lastData;
                if (lastLabel) return lastLabel;
                if (lastOrg) return lastOrg;
            }
        }
        
        return '';
    }

    updateMemoryDisplay() {
        const memoryDisplay = document.getElementById('memory-display');
        if (!memoryDisplay) return;
        
        const start = this.ui.memoryStartAddress || 0;
        const end = Math.min(start + 64, this.ui.simulator.memory.length);

        // Check if current PC is outside the visible range
        const currentPC = this.ui.simulator.registers[15];
        const pcIsVisible = (currentPC >= start && currentPC < end);
        
        // If PC is not visible, adjust the start address to show it
        if (!pcIsVisible && currentPC < this.ui.simulator.memory.length) {
            this.ui.memoryStartAddress = Math.max(0, currentPC - 8);
            const startAddressInput = document.getElementById('memory-start-address');
            if (startAddressInput) {
                startAddressInput.value = '0x' + this.ui.memoryStartAddress.toString(16).padStart(4, '0');
            }
        }

        this.renderMemoryDisplay();
        
        // Auto-scroll to the PC line if it's visible
        if (pcIsVisible) {
            this.scrollToPC();
        }
    }

renderMemoryDisplay() {
    const memoryDisplay = document.getElementById('memory-display');
    if (!memoryDisplay) return;
    
    const start = this.ui.memoryStartAddress || 0;
    const end = Math.min(start + 64, this.ui.simulator.memory.length);

    let html = '';
    
    if (start >= end) {
        html = '<div class="memory-line">Invalid memory range</div>';
    } else {
        let address = start;
        let lastDisplayedAddress = start - 1;
        
        console.log(`Rendering memory from 0x${start.toString(16)} to 0x${end.toString(16)}`);
        
        while (address < end) {
            let lineHtml = '';
            const isCode = this.isCodeAddress(address);
            
            console.log(`Address 0x${address.toString(16)}: isCode=${isCode}`);
            
            if (isCode) {
                // Code displays one instruction per line
                lineHtml = this.createMemoryLine(address);
                if (lineHtml) {
                    // Check for gap before this code line
                    if (address > lastDisplayedAddress + 1 && lastDisplayedAddress >= start) {
                        html += `<div class="memory-gap">...</div>`;
                    }
                    html += lineHtml;
                    lastDisplayedAddress = address;
                }
                address++;
            } else {
                // Data displays 8 words per line
                const lineStart = address;
                lineHtml = this.createMemoryLine(lineStart);
                if (lineHtml) {
                    // Check for gap before this data line
                    if (lineStart > lastDisplayedAddress + 1 && lastDisplayedAddress >= start) {
                        html += `<div class="memory-gap">...</div>`;
                    }
                    html += lineHtml;
                    lastDisplayedAddress = lineStart + 7; // End of data line
                }
                address = lineStart + 8; // Skip to next data line
            }
        }
    }
    
    memoryDisplay.innerHTML = html || '<div class="memory-line">No memory content</div>';
    
    // Scroll to PC if it's in the current view
    const currentPC = this.ui.simulator.registers[15];
    if (currentPC >= start && currentPC < end) {
        this.scrollToPC();
    }
}
    
getDataLineSource(lineStartAddress) {
    if (!this.ui.currentAssemblyResult) return '';
    
    const listing = this.ui.currentAssemblyResult.listing;
    
    console.log(`Checking data line at 0x${lineStartAddress.toString(16)}`);
    
    // Check each address in this data line for data definitions
    for (let i = 0; i < 8; i++) {
        const addr = lineStartAddress + i;
        if (addr >= this.ui.simulator.memory.length) break;
        
        // Look for exact address matches in the listing
        for (const item of listing) {
            if (item.address === addr && item.line) {
                const line = item.line.trim();
                console.log(`Found item at 0x${addr.toString(16)}: "${line}"`);
                
                // Return data definitions (.word, .byte, .space)
                if (line.startsWith('.word') || line.startsWith('.byte') || line.startsWith('.space')) {
                    console.log(`Returning data definition: "${line}"`);
                    return line;
                }
            }
        }
    }
    
    console.log(`No data definition found for line starting at 0x${lineStartAddress.toString(16)}`);
    return ''; // No data definitions in this line
}

getExactSourceForAddress(address) {
    if (!this.ui.currentAssemblyResult) return '';
    
    const listing = this.ui.currentAssemblyResult.listing;
    
    // Look for exact address matches
    for (const item of listing) {
        if (item.address === address && item.line) {
            const line = item.line.trim();
            
            // Return data definitions
            if (line.startsWith('.word') || line.startsWith('.byte') || line.startsWith('.space')) {
                return line;
            }
            
            // For code, return the instruction
            if (item.instruction !== undefined) {
                return line;
            }
            
            // For org directives, return them
            if (line.startsWith('.org')) {
                return line;
            }
            
            // For labels, return them
            if (line.endsWith(':')) {
                return line;
            }
        }
    }
    
    return '';
}

    findNearestLabel(address) {
        if (!this.ui.currentAssemblyResult) return '';
        
        const listing = this.ui.currentAssemblyResult.listing;
        let nearestLabel = '';
        let nearestDistance = Infinity;
        
        for (const item of listing) {
            if (item.address !== undefined && item.line) {
                const line = item.line.trim();
                if (line.endsWith(':') && item.address <= address) {
                    const distance = address - item.address;
                    if (distance < nearestDistance) {
                        nearestDistance = distance;
                        nearestLabel = line;
                    }
                }
            }
        }
        
        // Only return if we found a reasonably close label
        return nearestDistance < Infinity ? nearestLabel : '';
    }

    getLabelAddress(label) {
        if (!this.ui.currentAssemblyResult) return null;
        
        const symbols = this.ui.currentAssemblyResult.symbols;
        const labelName = label.replace(':', '').trim();
        
        return symbols[labelName] !== undefined ? symbols[labelName] : null;
    }

    scrollToPC() {
        const memoryDisplay = document.getElementById('memory-display');
        if (!memoryDisplay) return;
        
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

    updateMemoryDisplayHeight() {
        const memoryDisplay = document.getElementById('memory-display');
        if (!memoryDisplay) return;
        
        setTimeout(() => {
            memoryDisplay.style.height = 'auto';
        }, 10);
    }

updateRecentMemoryDisplay() {
    const recentDisplay = document.getElementById('recent-memory-display');
    if (!recentDisplay) return;
    
    if (!this.ui.simulator.getRecentMemoryView) {
        recentDisplay.innerHTML = 'Memory view not available';
        return;
    }
    
    const memoryView = this.ui.simulator.getRecentMemoryView();
    
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
        html += `<span class="recent-memory-address">0x${lineAddress.toString(16).padStart(5, '0').toUpperCase()}</span>`; // 5 hex digits
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
            
            html += `<span class="${wordClass}" title="Address: 0x${word.address.toString(16).padStart(5, '0').toUpperCase()}">${valueHex}</span>`;
        }
        
        html += `</span></div>`;
    }
    
    // Add access information with 20-bit addresses
    const accessType = accessInfo.type === 'LD' ? 'Load' : 'Store';
    const offsetInfo = accessInfo.offset !== 0 ? 
        ` (base: 0x${accessInfo.baseAddress.toString(16).padStart(5, '0').toUpperCase()} + ${accessInfo.offset})` : 
        '';
    
    html += `<div class="recent-memory-info">${accessType} at 0x${accessInfo.address.toString(16).padStart(5, '0').toUpperCase()}${offsetInfo}</div>`;
    
    recentDisplay.innerHTML = html;
}

// Update memory address change handler for 20-bit addresses
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
        input.value = '0x' + this.ui.memoryStartAddress.toString(16).padStart(5, '0'); // 5 hex digits
    }
}
}
