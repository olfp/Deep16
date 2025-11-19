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

    updateMemoryDisplay() {
        const memoryDisplay = document.getElementById('memory-display');
        
        const start = this.ui.memoryStartAddress;
        const end = Math.min(start + 64, this.ui.simulator.memory.length);

        // Check if current PC is outside the visible range
        const currentPC = this.ui.simulator.registers[15];
        const pcIsVisible = (currentPC >= start && currentPC < end);
        
        // If PC is not visible, adjust the start address to show it
        if (!pcIsVisible && currentPC < this.ui.simulator.memory.length) {
            this.ui.memoryStartAddress = Math.max(0, currentPC - 8);
            document.getElementById('memory-start-address').value = '0x' + this.ui.memoryStartAddress.toString(16).padStart(4, '0');
        }

        this.renderMemoryDisplay();
        
        // Auto-scroll to the PC line if it's visible
        if (pcIsVisible) {
            this.scrollToPC();
        }
    }

    renderMemoryDisplay() {
        const memoryDisplay = document.getElementById('memory-display');
        const start = this.ui.memoryStartAddress;
        const end = Math.min(start + 64, this.ui.simulator.memory.length);

        let html = '';
        
        if (start >= end) {
            html = '<div class="memory-line">Invalid memory range</div>';
        } else {
            let address = start;
            while (address < end) {
                // Check if current address is code
                if (this.isCodeAddress(address)) {
                    // Code displays one instruction per line
                    html += this.createMemoryLine(address);
                    address++;
                } else {
                    // Data displays 8 words per line
                    const lineStart = address;
                    html += this.createMemoryLine(lineStart);
                    address += 8; // Skip to next data line
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
    
    // Strategy 1: Check if the line start address has an exact source
    const exactSource = this.getExactSourceForAddress(lineStartAddress);
    if (exactSource) {
        return exactSource;
    }
    
    // Strategy 2: Check if any address in this line has a data definition
    for (let i = 0; i < 8; i++) {
        const addr = lineStartAddress + i;
        const source = this.getExactSourceForAddress(addr);
        if (source && (source.startsWith('.word') || source.startsWith('.byte') || source.startsWith('.space'))) {
            return source;
        }
    }
    
    // Strategy 3: Find the nearest label before this line
    return this.findNearestLabel(lineStartAddress);
}

// NEW: Get exact source for a specific address - FIXED VERSION
getExactSourceForAddress(address) {
    if (!this.ui.currentAssemblyResult) return '';
    
    const listing = this.ui.currentAssemblyResult.listing;
    
    // First, look for exact address matches with data definitions
    for (const item of listing) {
        if (item.address === address) {
            const line = item.line ? item.line.trim() : '';
            
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
        }
    }
    
    return '';
}

getDataLineSource(lineStartAddress) {
    if (!this.ui.currentAssemblyResult) return '';
    
    const listing = this.ui.currentAssemblyResult.listing;
    
    // Strategy 1: Check if the line start address has an exact source
    const exactSource = this.getExactSourceForAddress(lineStartAddress);
    if (exactSource) {
        return exactSource;
    }
    
    // Strategy 2: Check if any address in this line has a data definition
    for (let i = 0; i < 8; i++) {
        const addr = lineStartAddress + i;
        const source = this.getExactSourceForAddress(addr);
        if (source && (source.startsWith('.word') || source.startsWith('.byte') || source.startsWith('.space'))) {
            return source;
        }
    }
    
    // Strategy 3: Find the nearest label before this line
    return this.findNearestLabel(lineStartAddress);
}

// NEW: Get exact source for a specific address - FIXED VERSION
getExactSourceForAddress(address) {
    if (!this.ui.currentAssemblyResult) return '';
    
    const listing = this.ui.currentAssemblyResult.listing;
    
    // First, look for exact address matches with data definitions
    for (const item of listing) {
        if (item.address === address) {
            const line = item.line ? item.line.trim() : '';
            
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
        }
    }
    
    return '';
}

    // NEW: Find the nearest label before an address
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
        
        return nearestLabel;
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

    getContextSourceForAddress(address) {
        if (!this.ui.currentAssemblyResult) return '';
        
        const listing = this.ui.currentAssemblyResult.listing;
        
        // Look for the closest data definition before this address
        let closestData = '';
        let closestDistance = Infinity;
        
        for (const item of listing) {
            if (item.address !== undefined && item.line) {
                const line = item.line.trim();
                if (line.startsWith('.word') || line.startsWith('.byte') || line.startsWith('.space')) {
                    const distance = address - item.address;
                    if (distance >= 0 && distance < closestDistance) {
                        closestDistance = distance;
                        closestData = line;
                    }
                } else if (line.endsWith(':') && item.address <= address) {
                    // Also consider labels as context
                    const distance = address - item.address;
                    if (distance >= 0 && distance < 16) { // Within 16 words
                        return line; // Use label as context
                    }
                }
            }
        }
        
        return closestData;
    }

    scrollToPC() {
        const memoryDisplay = document.getElementById('memory-display');
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
        setTimeout(() => {
            memoryDisplay.style.height = 'auto';
        }, 10);
    }

    updateRecentMemoryDisplay() {
        const recentDisplay = document.getElementById('recent-memory-display');
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
            html += `<span class="recent-memory-address">0x${lineAddress.toString(16).padStart(4, '0').toUpperCase()}</span>`;
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
                
                html += `<span class="${wordClass}" title="Address: 0x${word.address.toString(16).padStart(4, '0').toUpperCase()}">${valueHex}</span>`;
            }
            
            html += `</span></div>`;
        }
        
        // Add access information
        const accessType = accessInfo.type === 'LD' ? 'Load' : 'Store';
        const offsetInfo = accessInfo.offset !== 0 ? 
            ` (base: 0x${accessInfo.baseAddress.toString(16).padStart(4, '0').toUpperCase()} + ${accessInfo.offset})` : 
            '';
        
        html += `<div class="recent-memory-info">${accessType} at 0x${accessInfo.address.toString(16).padStart(4, '0').toUpperCase()}${offsetInfo}</div>`;
        
        recentDisplay.innerHTML = html;
    }
}
