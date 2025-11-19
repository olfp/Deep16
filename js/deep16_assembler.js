/* deep16_assembler.js */
class Deep16Assembler {
    constructor() {
        this.labels = {};
        this.symbols = {};
    }

    assemble(source) {
        this.labels = {};
        this.symbols = {};
        const errors = [];
        const memoryChanges = [];
        const assemblyListing = [];
        const segmentMap = new Map();
        let currentSegment = 'code'; // Default segment
        let address = 0;

        const lines = source.split('\n');
        
        // First pass: collect labels, segments, and calculate addresses
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith(';')) continue;

            try {
                if (line.startsWith('.org')) {
                    const orgValue = this.parseImmediate(line.split(/\s+/)[1]);
                    address = orgValue;
                    // Keep current segment type
                } else if (line.startsWith('.code')) {
                    currentSegment = 'code';
                } else if (line.startsWith('.data')) {
                    currentSegment = 'data';
                } else if (line.endsWith(':')) {
                    const label = line.slice(0, -1).trim();
                    this.labels[label] = address;
                    this.symbols[label] = address;
                    segmentMap.set(address, currentSegment);
                } else if (line.startsWith('.word')) {
                    // Data directive - mark as data
                    const values = line.substring(5).trim().split(',').map(v => this.parseImmediate(v.trim()));
                    for (const value of values) {
                        segmentMap.set(address, 'data');
                        address++;
                    }
                } else if (!this.isDirective(line)) {
                    segmentMap.set(address, currentSegment);
                    address++;
                }
            } catch (error) {
                errors.push(`Line ${i + 1}: ${error.message}`);
            }
        }

        // Second pass: generate machine code
        address = 0;
        currentSegment = 'code';
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const originalLine = lines[i];
            
            if (!line || line.startsWith(';')) {
                assemblyListing.push({ line: originalLine });
                continue;
            }

            try {
                if (line.startsWith('.org')) {
                    const orgValue = this.parseImmediate(line.split(/\s+/)[1]);
                    address = orgValue;
                    assemblyListing.push({ address: address, line: originalLine, segment: currentSegment });
                } else if (line.startsWith('.code')) {
                    currentSegment = 'code';
                    assemblyListing.push({ line: originalLine, segment: currentSegment });
                } else if (line.startsWith('.data')) {
                    currentSegment = 'data';
                    assemblyListing.push({ line: originalLine, segment: currentSegment });
                } else if (line.endsWith(':')) {
                    assemblyListing.push({ address: address, line: originalLine, segment: currentSegment });
                } else if (line.startsWith('.word')) {
                    const values = line.substring(5).trim().split(',').map(v => this.parseImmediate(v.trim()));
                    for (const value of values) {
                        memoryChanges.push({ address: address, value: value & 0xFFFF, segment: 'data' });
                        assemblyListing.push({ 
                            address: address, 
                            instruction: value,
                            line: originalLine,
                            segment: 'data'
                        });
                        address++;
                    }
                } else {
                    const instruction = this.encodeInstruction(line, address, i + 1);
                    if (instruction !== null) {
                        memoryChanges.push({ address: address, value: instruction, segment: currentSegment });
                        assemblyListing.push({ 
                            address: address, 
                            instruction: instruction,
                            line: originalLine,
                            segment: currentSegment
                        });
                        address++;
                    } else {
                        assemblyListing.push({ address: address, line: originalLine, segment: currentSegment });
                    }
                }
            } catch (error) {
                errors.push(`Line ${i + 1}: ${error.message}`);
                assemblyListing.push({ 
                    address: address,
                    error: error.message,
                    line: originalLine,
                    segment: currentSegment
                });
                address++;
            }
        }

        return {
            success: errors.length === 0,
            memoryChanges: memoryChanges,
            symbols: this.symbols,
            errors: errors,
            listing: assemblyListing,
            segmentMap: segmentMap
        };
    }

    isDirective(line) {
        return line.startsWith('.org') || line.startsWith('.word');
    }

    parseRegister(reg) {
        if (typeof reg !== 'string') {
            throw new Error(`Invalid register: ${reg}`);
        }
        
        const regMap = {
            // Standard register numbers
            'R0': 0, 'R1': 1, 'R2': 2, 'R3': 3, 'R4': 4, 'R5': 5, 'R6': 6, 'R7': 7,
            'R8': 8, 'R9': 9, 'R10': 10, 'R11': 11, 'R12': 12, 'R13': 13, 'R14': 14, 'R15': 15,
            // Aliases
            'FP': 12, 'SP': 13, 'LR': 14, 'PC': 15
        };
        
        const upperReg = reg.toUpperCase();
        if (upperReg in regMap) return regMap[upperReg];
        
        // Also support case variations of aliases
        const lowerReg = reg.toLowerCase();
        const lowerMap = {
            'fp': 12, 'sp': 13, 'lr': 14, 'pc': 15
        };
        if (lowerReg in lowerMap) return lowerMap[lowerReg];
        
        throw new Error(`Invalid register: ${reg}`);
    }



    parseImmediate(value) {
        if (typeof value !== 'string') {
            throw new Error(`Invalid immediate value: ${value}`);
        }
        
        const trimmed = value.trim();
        if (trimmed.startsWith('0x')) {
            return parseInt(trimmed.substring(2), 16);
        } else if (trimmed.startsWith('$')) {
            return parseInt(trimmed.substring(1), 16);
        } else {
            const num = parseInt(trimmed);
            if (isNaN(num)) {
                throw new Error(`Invalid immediate value: ${value}`);
            }
            return num;
        }
    }

isRegister(value) {
    if (typeof value !== 'string') return false;
    const upper = value.toUpperCase();
    const lower = value.toLowerCase();
    
    // Check for R0-R15
    if (upper.startsWith('R') && !isNaN(parseInt(upper.substring(1)))) {
        const num = parseInt(upper.substring(1));
        return num >= 0 && num <= 15;
    }
    
    // Check for aliases (case insensitive)
    const aliases = ['FP', 'SP', 'LR', 'PC', 'fp', 'sp', 'lr', 'pc'];
    return aliases.includes(upper) || aliases.includes(lower);
}


    encodeInstruction(line, address, lineNumber) {
        const cleanLine = line.split(';')[0].trim();
        if (!cleanLine) return null;

        const parts = cleanLine.split(/[\s,]+/).filter(part => part);
        if (parts.length === 0) return null;

        const mnemonic = parts[0].toUpperCase();

        try {
            switch (mnemonic) {
                // ... existing instructions ...
                case 'MOV': return this.encodeMOV(parts, address, lineNumber);
                case 'ADD': return this.encodeALU(parts, 0b000, address, lineNumber);
                case 'SUB': return this.encodeALU(parts, 0b001, address, lineNumber);
                case 'AND': return this.encodeALU(parts, 0b010, address, lineNumber);
                case 'OR':  return this.encodeALU(parts, 0b011, address, lineNumber);
                case 'XOR': return this.encodeALU(parts, 0b100, address, lineNumber);
                case 'ST':  return this.encodeMemory(parts, true, address, lineNumber);
                case 'LD':  return this.encodeMemory(parts, false, address, lineNumber);
                case 'JZ':  return this.encodeJump(parts, 0b000, address, lineNumber);
                case 'JNZ': return this.encodeJump(parts, 0b001, address, lineNumber);
                case 'JC':  return this.encodeJump(parts, 0b010, address, lineNumber);
                case 'JNC': return this.encodeJump(parts, 0b011, address, lineNumber);
                case 'JN':  return this.encodeJump(parts, 0b100, address, lineNumber);
                case 'JNN': return this.encodeJump(parts, 0b101, address, lineNumber);
                case 'JO':  return this.encodeJump(parts, 0b110, address, lineNumber);
                case 'JNO': return this.encodeJump(parts, 0b111, address, lineNumber);
                
                // NEW: Shift operations
                case 'SL':  return this.encodeShift(parts, 0b000, address, lineNumber);
                case 'SLC': return this.encodeShift(parts, 0b001, address, lineNumber);
                case 'SR':  return this.encodeShift(parts, 0b010, address, lineNumber);
                case 'SRC': return this.encodeShift(parts, 0b011, address, lineNumber);
                case 'SRA': return this.encodeShift(parts, 0b100, address, lineNumber);
                case 'SAC': return this.encodeShift(parts, 0b101, address, lineNumber);
                case 'ROR': return this.encodeShift(parts, 0b110, address, lineNumber);
                case 'ROC': return this.encodeShift(parts, 0b111, address, lineNumber);
                
                // NEW: PSW operations
                case 'SRS': return this.encodeSRS(parts, address, lineNumber);
                case 'SRD': return this.encodeSRD(parts, address, lineNumber);
                case 'ERS': return this.encodeERS(parts, address, lineNumber);
                case 'ERD': return this.encodeERD(parts, address, lineNumber);
                
                // NEW: Segment operations
                case 'MVS': return this.encodeMVS(parts, address, lineNumber);
                
                // NEW: Special moves
                case 'SMV': return this.encodeSMV(parts, address, lineNumber);
                
                // NEW: Long jump
                case 'JML': return this.encodeJML(parts, address, lineNumber);
                
                // ... existing flag operations ...
                case 'SET': return this.encodeSET(parts, address, lineNumber);
                case 'CLR': return this.encodeCLR(parts, address, lineNumber);
                case 'SET2': return this.encodeSET2(parts, address, lineNumber);
                case 'CLR2': return this.encodeCLR2(parts, address, lineNumber);
                
                // ... existing aliases ...
                case 'SETN': return this.encodeSETAlias(0b0000);
                case 'CLRN': return this.encodeCLRAlias(0b1000);
                case 'SETZ': return this.encodeSETAlias(0b0001);
                case 'CLRZ': return this.encodeCLRAlias(0b1001);
                case 'SETV': return this.encodeSETAlias(0b0010);
                case 'CLRV': return this.encodeCLRAlias(0b1010);
                case 'SETC': return this.encodeSETAlias(0b0011);
                case 'CLRC': return this.encodeCLRAlias(0b1011);
                case 'SETI': return this.encodeSET2Alias(0b0000);
                case 'CLRI': return this.encodeCLR2Alias(0b0000);
                case 'SETS': return this.encodeSET2Alias(0b0001);
                case 'CLRS': return this.encodeCLR2Alias(0b0001);
                
                // HALT alias and new encoding
                case 'HALT': 
                case 'HLT': return 0xFFFF;
                
                // System instructions
                case 'RETI': return this.encodeSystem(0b011);
                case 'NOP':  return this.encodeSystem(0b000);
                
                case 'LDI':  return this.encodeLDI(parts, address, lineNumber);
                case 'LSI':  return this.encodeLSI(parts, address, lineNumber);

                case 'LDS': return this.encodeLDSSTS(parts, false, address, lineNumber);
                case 'STS': return this.encodeLDSSTS(parts, true, address, lineNumber);
                
                // NEW: Complete shift operations
                case 'SLC': return this.encodeShift(parts, 0b001, address, lineNumber);
                case 'SRC': return this.encodeShift(parts, 0b011, address, lineNumber);
                case 'SAC': return this.encodeShift(parts, 0b101, address, lineNumber);
                case 'ROC': return this.encodeShift(parts, 0b111, address, lineNumber);
                
                // NEW: Complete SOP operations
                case 'SWB': return this.encodeSWB(parts, address, lineNumber);
                case 'INV': return this.encodeINV(parts, address, lineNumber);
                case 'NEG': return this.encodeNEG(parts, address, lineNumber);
                
                // NEW: MUL/DIV with 32-bit mode
                case 'MUL32': return this.encodeMUL32(parts, address, lineNumber);
                case 'DIV32': return this.encodeDIV32(parts, address, lineNumber);
                    
                default: 
                    if (this.labels[mnemonic] !== undefined) {
                        return null;
                    }
                    throw new Error(`Unknown instruction: ${mnemonic}`);
            }
        } catch (error) {
            throw new Error(`${error.message}`);
        }
    }

    // NEW: Encode SRS instruction
    encodeSRS(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // SRS: [11111110][1000][Rx4]
            return 0b1111111010000000 | (rx << 4);
        }
        throw new Error('SRS requires register operand');
    }

    // NEW: Encode SRD instruction
    encodeSRD(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // SRD: [11111110][1001][Rx4]
            return 0b1111111010010000 | (rx << 4);
        }
        throw new Error('SRD requires register operand');
    }

    // NEW: Encode ERS instruction
    encodeERS(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // ERS: [11111110][1010][Rx4]
            return 0b1111111010100000 | (rx << 4);
        }
        throw new Error('ERS requires register operand');
    }

    // NEW: Encode ERD instruction
    encodeERD(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // ERD: [11111110][1011][Rx4]
            return 0b1111111010110000 | (rx << 4);
        }
        throw new Error('ERD requires register operand');
    }

    // NEW: Encode MVS instruction
    encodeMVS(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            const seg = parts[2].toUpperCase();
            
            const segMap = {
                'CS': 0b00, 'DS': 0b01, 'SS': 0b10, 'ES': 0b11
            };
            
            if (seg in segMap) {
                // MVS: [111111110][d1][Rd4][seg2]
                // d=0: Rd ← Sx (read from segment register)
                return 0b1111111100000000 | (rd << 4) | segMap[seg];
            }
            throw new Error(`Invalid segment register: ${seg}`);
        }
        throw new Error('MVS requires destination register and segment register');
    }

    // NEW: Encode SMV instruction
    encodeSMV(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            const src = parts[2].toUpperCase();
            
            const srcMap = {
                'APC': 0b00, 'APSW': 0b01, 'PSW': 0b10, 'ACS': 0b11
            };
            
            if (src in srcMap) {
                // SMV: [1111111110][src2][Rd4]
                return 0b1111111110000000 | (srcMap[src] << 4) | rd;
            }
            throw new Error(`Invalid SMV source: ${src}`);
        }
        throw new Error('SMV requires destination register and source');
    }

    // NEW: Encode JML instruction
    encodeJML(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // JML: [11111110][0100][Rx4] - JML uses even register Rx (Rx=CS, Rx+1=PC)
            return 0b1111111001000000 | (rx << 4);
        }
        throw new Error('JML requires register operand (even register)');
    }

    encodeMOV(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            const rs = this.parseRegister(parts[2]);
            const imm = 0; // Default immediate is 0
            
            // Correct encoding: [111110][Rd4][Rs4][imm2]
            // Bits: 15-10: opcode, 9-6: Rd, 5-2: Rs, 1-0: imm
            return 0b1111100000000000 | (rd << 6) | (rs << 2) | imm;
        }
        throw new Error('MOV requires destination register and source register');
    }

    // NEW: Encode LDS/STS instructions
    encodeLDSSTS(parts, isStore, address, lineNumber) {
        if (parts.length >= 4) {
            const rd = this.parseRegister(parts[1]);
            const seg = parts[2].toUpperCase();
            const rs = this.parseRegister(parts[3]);
            
            const segMap = {
                'CS': 0b00, 'DS': 0b01, 'SS': 0b10, 'ES': 0b11
            };
            
            if (seg in segMap) {
                // LDS/STS: [11110][d][seg2][Rd4][Rs4]
                // Bits: 15-11: opcode=11110, 10: d, 9-8: seg, 7-4: Rd, 3-0: Rs
                return 0b1111000000000000 | 
                       (isStore ? 0x0400 : 0) | 
                       (segMap[seg] << 8) | 
                       (rd << 4) | 
                       rs;
            }
            throw new Error(`Invalid segment register: ${seg}`);
        }
        throw new Error(`${isStore ? 'STS' : 'LDS'} requires register, segment, and base register`);
    }

    // ENHANCED: Update shift encoding to use proper ALU format
    encodeShift(parts, shiftType, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            const count = this.parseImmediate(parts[2]);
            if (count < 0 || count > 7) {
                throw new Error(`Shift count ${count} out of range (0-7)`);
            }
            // Enhanced shift encoding: [110][111][Rd4][T2][C][count3]
            // Bits: 15-13: opcode=110, 12-10: aluOp=111, 9-6: Rd, 5-4: T2, 3: C, 2-0: count
            const T2 = (shiftType >>> 1) & 0x3;  // Extract T2 from shiftType
            const C = shiftType & 0x1;           // Extract C from shiftType
            return 0b1101110000000000 | (rd << 6) | (T2 << 4) | (C << 3) | count;
        }
        throw new Error('Shift operation requires register and count');
    }

    // NEW: Encode SWB (Swap Bytes)
    encodeSWB(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // SWB: [11111110][0000][Rx4]
            return 0b1111111000000000 | (rx << 4);
        }
        throw new Error('SWB requires register operand');
    }

    // NEW: Encode INV (Invert)
    encodeINV(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // INV: [11111110][0001][Rx4]
            return 0b1111111000010000 | (rx << 4);
        }
        throw new Error('INV requires register operand');
    }

    // NEW: Encode NEG (Negate)
    encodeNEG(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // NEG: [11111110][0010][Rx4]
            return 0b1111111000100000 | (rx << 4);
        }
        throw new Error('NEG requires register operand');
    }

    // NEW: Encode MUL32 (32-bit multiplication)
    encodeMUL32(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            if (rd % 2 !== 0) {
                throw new Error('MUL32 requires even destination register for 32-bit result');
            }
            
            if (this.isRegister(parts[2])) {
                const rs = this.parseRegister(parts[2]);
                // MUL32 register mode: [110][101][Rd4][w1][i1][Rs4]
                return 0b1101010000000000 | (rd << 6) | (1 << 5) | (1 << 4) | rs;
            } else {
                throw new Error('MUL32 requires register operand for 32-bit mode');
            }
        }
        throw new Error('MUL32 requires destination and source registers');
    }

    // NEW: Encode DIV32 (32-bit division)
    encodeDIV32(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            if (rd % 2 !== 0) {
                throw new Error('DIV32 requires even destination register for 32-bit result');
            }
            
            if (this.isRegister(parts[2])) {
                const rs = this.parseRegister(parts[2]);
                // DIV32 register mode: [110][110][Rd4][w1][i1][Rs4]
                return 0b1101100000000000 | (rd << 6) | (1 << 5) | (1 << 4) | rs;
            } else {
                throw new Error('DIV32 requires register operand for 32-bit mode');
            }
        }
        throw new Error('DIV32 requires destination and source registers');
    }

    // ENHANCED: Update ALU to handle MUL/DIV with i flag
    encodeALU(parts, aluOp, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            
            // Check for 32-bit mode suffix
            let iFlag = 0;
            let operand = parts[2];
            
            if (operand.toUpperCase().endsWith(',I=1')) {
                iFlag = 1;
                operand = operand.substring(0, operand.length - 4);
                
                // For MUL/DIV 32-bit mode, rd must be even
                if ((aluOp === 0b101 || aluOp === 0b110) && rd % 2 !== 0) {
                    throw new Error(`32-bit ${aluOp === 0b101 ? 'MUL' : 'DIV'} requires even destination register`);
                }
            }
            
            if (this.isRegister(operand)) {
                const rs = this.parseRegister(operand);
                // ALU2 register mode: [110][op3][Rd4][w1][i][Rs4]
                return 0b1100000000000000 | (aluOp << 10) | (rd << 6) | (1 << 5) | (iFlag << 4) | rs;
            } else {
                const imm = this.parseImmediate(operand);
                if (imm < 0 || imm > 15) {
                    throw new Error(`Immediate value ${imm} out of range (0-15)`);
                }
                // ALU2 immediate mode: [110][op3][Rd4][w1][i1][imm4]
                return 0b1100000000000000 | (aluOp << 10) | (rd << 6) | (1 << 5) | (1 << 4) | imm;
            }
        }
        throw new Error(`ALU operation requires two operands`);
    }


encodeMemory(parts, isStore, address, lineNumber) {
    console.log(`encodeMemory parts:`, parts, `isStore:`, isStore);
    
    if (parts.length >= 3) {
        let rd, rb, offset;
        
        // Check if we're using bracket syntax by looking for [ in any part
        const joinedParts = parts.join(' ');
        console.log(`Joined parts: "${joinedParts}"`);
        
        if (joinedParts.includes('[') && joinedParts.includes(']')) {
            // Bracket syntax: LD R1, [R2+5] or ST R1, [R2] or LD R1, [R2 + 5]
            console.log("Detected bracket syntax");
            
            // Find the part with brackets (usually parts[2] but could be later if commas are involved)
            let bracketPart = parts.find(part => part.includes('[') && part.includes(']'));
            if (!bracketPart) {
                throw new Error(`Invalid bracket syntax in ${isStore ? 'ST' : 'LD'}`);
            }
            
            // Extract content inside brackets
            const bracketMatch = bracketPart.match(/\[([^\]]+)\]/);
            if (!bracketMatch) {
                throw new Error(`Invalid bracket syntax in ${isStore ? 'ST' : 'LD'}`);
            }
            
            const bracketContent = bracketMatch[1];
            console.log(`Bracket content: "${bracketContent}"`);
            
            // Parse Rb and offset - use regex to extract register and optional offset
            // This handles: "R2", "R2+5", "R2 +5", "R2+ 5", "R2 + 5", "R2+21", etc.
            const memoryMatch = bracketContent.match(/^([A-Za-z0-9]+)\s*(\+\s*(\d+))?$/);
            if (!memoryMatch) {
                throw new Error(`Invalid memory address syntax: ${bracketContent}`);
            }
            
            rb = this.parseRegister(memoryMatch[1].trim());
            
            if (memoryMatch[2]) { // If there's an offset part (+ something)
                offset = this.parseImmediate(memoryMatch[3].trim()); // memoryMatch[3] is the number part
            } else {
                offset = 0; // Default offset is 0 if not specified
            }
            
            // Rd is the part before the brackets (usually parts[1])
            rd = this.parseRegister(parts[1]);
        } 
        // Old syntax: LD R1, R2, 5
        else if (parts.length >= 4) {
            console.log("Detected old syntax");
            rd = this.parseRegister(parts[1]);
            rb = this.parseRegister(parts[2]);
            offset = this.parseImmediate(parts[3]);
        }
        else {
            throw new Error(`${isStore ? 'ST' : 'LD'} requires register, base register, and offset`);
        }
        
        console.log(`Parsed: rd=${rd}, rb=${rb}, offset=${offset}`);
        
        if (offset < 0 || offset > 31) {
            throw new Error(`Offset ${offset} out of range (0-31)`);
        }
        
        // LD/ST: [10][d1][Rd4][Rb4][offset5]
        // Bits: 15-14: opcode, 13: d, 12-9: Rd, 8-5: Rb, 4-0: offset
        return (isStore ? 0b1010000000000000 : 0b1000000000000000) | 
               (rd << 9) | (rb << 5) | offset;
    }
    throw new Error(`${isStore ? 'ST' : 'LD'} requires register, base register, and offset`);
}

    encodeLDI(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1]);
            if (imm < 0 || imm > 32767) {
                throw new Error(`LDI immediate ${imm} out of range (0-32767)`);
            }
            return imm & 0x7FFF;
        }
        throw new Error('LDI requires immediate value');
    }

    encodeLSI(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            const imm = this.parseImmediate(parts[2]);
            
            if (imm < -16 || imm > 15) {
                throw new Error(`LSI immediate ${imm} out of range (-16 to 15)`);
            }
            
            const imm5 = imm & 0x1F;
            // Correct encoding: [1111110][Rd4][imm5]
            // Bits: 15-9: opcode, 8-5: Rd, 4-0: imm5
            return 0b1111110000000000 | (rd << 5) | imm5;
        }
        throw new Error('LSI requires register and immediate value');
    }

// In deep16_assembler.js - Fix jump condition encoding
encodeJump(parts, condition, address, lineNumber) {
    if (parts.length >= 2) {
        const targetLabel = parts[1];
        let targetAddress = this.labels[targetLabel];
        if (targetAddress === undefined) {
            throw new Error(`Unknown label: ${targetLabel}`);
        }
        const offset = targetAddress - (address + 1);
        if (offset < -256 || offset > 255) {
            throw new Error(`Jump target too far: ${offset} words from current position`);
        }
        
        // CORRECTED condition mapping according to Table 6.3:
        const conditionCodes = {
            'JZ': 0b000, 'JNZ': 0b001, 'JC': 0b010, 'JNC': 0b011,
            'JN': 0b100, 'JNN': 0b101, 'JO': 0b110, 'JNO': 0b111
        };
        
        const conditionCode = conditionCodes[parts[0].toUpperCase()];
        if (conditionCode === undefined) {
            throw new Error(`Unknown jump condition: ${parts[0]}`);
        }
        
        // JMP: [1110][type3][target9]
        return 0b1110000000000000 | (conditionCode << 9) | (offset & 0x1FF);
    }
    throw new Error('Jump requires target label');
}

    encodeSET(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1]);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`SET immediate ${imm} out of range (0-15)`);
            }
            // SET: [11111110][1100][imm4]  
            // Bits: 15-8: opcode=11111110, 7-4: type=1100, 3-0: imm
            return 0b1111111011000000 | (imm << 4);
        }
        throw new Error('SET requires immediate value');
    }

    encodeCLR(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1]);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`CLR immediate ${imm} out of range (0-15)`);
            }
            // CLR: [11111110][1101][imm4]
            // Bits: 15-8: opcode=11111110, 7-4: type=1101, 3-0: imm
            return 0b1111111011010000 | (imm << 4);
        }
        throw new Error('CLR requires immediate value');
    }

    encodeSET2(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1]);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`SET2 immediate ${imm} out of range (0-15)`);
            }
            // SET2: [11111110][1110][imm4]
            // Bits: 15-8: opcode=11111110, 7-4: type=1110, 3-0: imm
            return 0b1111111011100000 | (imm << 4);
        }
        throw new Error('SET2 requires immediate value');
    }

    encodeCLR2(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1]);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`CLR2 immediate ${imm} out of range (0-15)`);
            }
            // CLR2: [11111110][1111][imm4]
            // Bits: 15-8: opcode=11111110, 7-4: type=1111, 3-0: imm
            return 0b1111111011110000 | (imm << 4);
        }
        throw new Error('CLR2 requires immediate value');
    }

    // Alias methods for flag operations
    encodeSETAlias(imm) {
        return 0b1111111011000000 | (imm << 4);
    }

    encodeCLRAlias(imm) {
        return 0b1111111011010000 | (imm << 4);
    }

    encodeSET2Alias(imm) {
        return 0b1111111011100000 | (imm << 4);
    }

    encodeCLR2Alias(imm) {
        return 0b1111111011110000 | (imm << 4);
    }

    encodeSystem(sysOp) {
        // SYS: [1111111111110][op3]
        // Bits: 15-13: opcode=1111111111110, 2-0: sysOp
        return 0b1111111111110000 | sysOp;
    }
}
/* deep16_assembler.js */
