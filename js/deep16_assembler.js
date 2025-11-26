/* deep16_assembler.js */
class Deep16Assembler {
    constructor() {
        this.labels = {};
        this.symbols = {};
    }

// In the assemble method, add .text handling
assemble(source) {
    this.labels = {};
    this.symbols = {};
    const errors = [];
    const memoryChanges = [];
    const assemblyListing = [];
    const segmentMap = new Map();
    let currentSegment = 'code';
    let address = 0;

    if (window.Deep16Debug) console.log('=== ASSEMBLER FIRST PASS ===');
    const lines = source.split('\n');
    
    // First pass: collect labels, segments, and calculate addresses
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith(';')) continue;

        try {
            if (line.startsWith('.org')) {
                const orgValue = this.parseImmediate(line.split(/\s+/)[1]);
                const oldAddress = address;
                address = orgValue;
                if (window.Deep16Debug) console.log(`ORG: ${line} -> address changed from 0x${oldAddress.toString(16)} to 0x${address.toString(16)}, segment=${currentSegment}`);
            } else if (line.startsWith('.code')) {
                currentSegment = 'code';
                if (window.Deep16Debug) console.log(`SEGMENT: ${line} -> switching to code segment`);
            } else if (line.startsWith('.data')) {
                currentSegment = 'data';
                if (window.Deep16Debug) console.log(`SEGMENT: ${line} -> switching to data segment`);
            } else if (line.endsWith(':')) {
                const label = line.slice(0, -1).trim();
                this.labels[label] = address;
                this.symbols[label] = address;
                segmentMap.set(address, currentSegment);
                if (window.Deep16Debug) console.log(`LABEL: ${label} at 0x${address.toString(16)}, segment=${currentSegment}`);
            } else if (line.startsWith('.word')) {
                // Data directive - mark as data
                const values = line.substring(5).trim().split(',').map(v => this.parseImmediate(v.trim()));
                if (window.Deep16Debug) console.log(`DATA: ${line} -> ${values.length} words at 0x${address.toString(16)}`);
                for (const value of values) {
                    segmentMap.set(address, 'data');
                    if (window.Deep16Debug) console.log(`  DATA WORD: 0x${address.toString(16)} = 0x${value.toString(16)}`);
                    address++;
                }
            } else if (line.startsWith('.text')) {
                // NEW: .text directive for null-terminated strings
                const textContent = line.substring(5).trim();
                const stringValue = this.parseStringLiteral(textContent);
                if (window.Deep16Debug) console.log(`TEXT: "${stringValue}" -> ${stringValue.length + 1} words at 0x${address.toString(16)}`);
                for (let j = 0; j < stringValue.length; j++) {
                    segmentMap.set(address, 'data');
                    if (window.Deep16Debug) console.log(`  TEXT CHAR: 0x${address.toString(16)} = '${stringValue[j]}' (${stringValue.charCodeAt(j)})`);
                    address++;
                }
                // Add null terminator
                segmentMap.set(address, 'data');
                if (window.Deep16Debug) console.log(`  TEXT NULL: 0x${address.toString(16)} = 0`);
                address++;
            } else if (!this.isDirective(line)) {
                segmentMap.set(address, currentSegment);
                if (window.Deep16Debug) console.log(`CODE: ${line} -> instruction at 0x${address.toString(16)}, segment=${currentSegment}`);
                address++;
            }
        } catch (error) {
            errors.push(`Line ${i + 1}: ${error.message}`);
        }
    }

    // Second pass (similar updates for .text)
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
                if (window.Deep16Debug) console.log(`DATA (pass2): ${values.length} words at 0x${address.toString(16)}`);
                for (const value of values) {
                    memoryChanges.push({ address: address, value: value & 0xFFFF, segment: 'data' });
                    assemblyListing.push({ 
                        address: address, 
                        instruction: value,
                        line: originalLine,
                        segment: 'data'
                    });
                    if (window.Deep16Debug) console.log(`  DATA STORE: memory[0x${address.toString(16)}] = 0x${value.toString(16)}`);
                    address++;
                }
            } else if (line.startsWith('.text')) {
                // NEW: .text directive processing in second pass
                const textContent = line.substring(5).trim();
                const stringValue = this.parseStringLiteral(textContent);
                if (window.Deep16Debug) console.log(`TEXT (pass2): "${stringValue}" at 0x${address.toString(16)}`);
                for (let j = 0; j < stringValue.length; j++) {
                    const charCode = stringValue.charCodeAt(j);
                    memoryChanges.push({ address: address, value: charCode & 0xFFFF, segment: 'data' });
                    assemblyListing.push({ 
                        address: address, 
                        instruction: charCode,
                        line: originalLine,
                        segment: 'data'
                    });
                    if (window.Deep16Debug) console.log(`  TEXT STORE: memory[0x${address.toString(16)}] = '${stringValue[j]}' (0x${charCode.toString(16)})`);
                    address++;
                }
                // Store null terminator
                memoryChanges.push({ address: address, value: 0, segment: 'data' });
                assemblyListing.push({ 
                    address: address, 
                    instruction: 0,
                    line: originalLine,
                    segment: 'data'
                });
                if (window.Deep16Debug) console.log(`  TEXT NULL: memory[0x${address.toString(16)}] = 0`);
                address++;
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
                    if (window.Deep16Debug) console.log(`CODE STORE: memory[0x${address.toString(16)}] = 0x${instruction.toString(16).padStart(4, '0')} from: ${line}`);
                    address++;
                } else {
                    assemblyListing.push({ address: address, line: originalLine, segment: currentSegment });
                    if (window.Deep16Debug) console.log(`CODE SKIP: no instruction generated for: ${line}`);
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
    return line.startsWith('.org') || 
           line.startsWith('.word') || 
           line.startsWith('.text'); 
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

parseStringLiteral(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('"')) {
        throw new Error('String literal must be enclosed in double quotes');
    }

    let endIdx = -1;
    for (let i = 1; i < trimmed.length; i++) {
        if (trimmed[i] === '"' && trimmed[i - 1] !== '\\') {
            endIdx = i;
            break;
        }
    }
    if (endIdx === -1) {
        throw new Error('String literal must be enclosed in double quotes');
    }

    const content = trimmed.substring(1, endIdx);
    let result = '';
    let i = 0;

    while (i < content.length) {
        const currentChar = content[i];

        if (currentChar === '\\') {
            if (i + 1 >= content.length) {
                throw new Error('Incomplete escape sequence');
            }
            const nextChar = content[i + 1];
            switch (nextChar) {
                case 'n': result += '\n'; break;
                case 'r': result += '\r'; break;
                case 't': result += '\t'; break;
                case '0': result += '\0'; break;
                case '\\': result += '\\'; break;
                case '"': result += '"'; break;
                default: throw new Error(`Unknown escape sequence: \\${nextChar}`);
            }
            i += 2;
        } else {
            result += currentChar;
            i += 1;
        }
    }

    return result;
}

    parseImmediate(value) {
        if (typeof value !== 'string') {
            throw new Error(`Invalid immediate value: ${value}`);
        }
        
        const trimmed = value.trim();
    
    // Character constants - single quoted characters and escapes
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        const inner = trimmed.slice(1, -1);
        if (inner.length === 1) {
            return inner.charCodeAt(0);
        }
        if (inner.startsWith('\\') && inner.length === 2) {
            const esc = inner[1];
            switch (esc) {
                case 'n': return 10;
                case 'r': return 13;
                case 't': return 9;
                case '0': return 0;
                case '\\': return 92;
                case "'": return 39;
                case '"': return 34;
                default: throw new Error(`Invalid character escape: \\${esc}`);
            }
        }
        throw new Error(`Invalid character literal: ${value}`);
    }
    
    // NEW: Special character constants
    const specialChars = {
        '\\n': 10,    // Newline
        '\\r': 13,    // Carriage return  
        '\\t': 9,     // Tab
        '\\0': 0,     // Null
        '\\\\': 92,   // Backslash
        '\\\'': 39,   // Single quote
    };
    
    
    
    // Existing hex and decimal parsing
    if (trimmed.startsWith('0x')) {
        return parseInt(trimmed.substring(2), 16);
    } else if (trimmed.startsWith('$')) {
        return parseInt(trimmed.substring(1), 16);
    } else {
        const num = parseInt(trimmed);
        if (!isNaN(num)) {
            return num;
        }
        // Label/symbol immediate support (second pass)
        if (this.labels && this.labels[trimmed] !== undefined) {
            return this.labels[trimmed];
        }
        if (this.symbols && this.symbols[trimmed] !== undefined) {
            return this.symbols[trimmed];
        }
        throw new Error(`Invalid immediate value: ${value}`);
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
                case 'MOV': return this.encodeMOV(parts, address, lineNumber);
                case 'ADD': return this.encodeALU(parts, 0b000, address, lineNumber);
                case 'SUB': return this.encodeALU(parts, 0b001, address, lineNumber);
                case 'AND': return this.encodeALU(parts, 0b010, address, lineNumber);
                case 'OR':  return this.encodeALU(parts, 0b011, address, lineNumber);
                case 'XOR': return this.encodeALU(parts, 0b100, address, lineNumber);
                case 'MUL': return this.encodeALU(parts, 0b101, address, lineNumber);  // NEW
                case 'DIV': return this.encodeALU(parts, 0b110, address, lineNumber);  // NEW
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
                
                // NEW: JMP alias
                case 'JMP': 
                    if (parts.length >= 2 && this.isRegister(parts[1])) {
                        const rx = this.parseRegister(parts[1]);
                        // Encode as MOV PC, Rx
                        return 0b1111100000000000 | (15 << 6) | (rx << 2) | 0;
                    }
                    throw new Error('JMP requires register operand');
                
                // Aliases per Deep16-Arch.md
                case 'AMV': // AMV Rx, Ry => MOV Rx, Ry, 3
                    if (parts.length >= 3) {
                        const rd = this.parseRegister(parts[1]);
                        const rs = this.parseRegister(parts[2]);
                        return 0b1111100000000000 | (rd << 6) | (rs << 2) | 3;
                    }
                    throw new Error('AMV requires two registers');
                case 'LNK': // LNK Rx => MOV Rx, PC, 2
                    if (parts.length >= 2) {
                        const rd = this.parseRegister(parts[1]);
                        return 0b1111100000000000 | (rd << 6) | (15 << 2) | 2;
                    }
                    throw new Error('LNK requires destination register');
                case 'LINK': // LINK => MOV LR, PC, 2
                    return 0b1111100000000000 | (14 << 6) | (15 << 2) | 2;
                case 'ALNK': // ALNK Rx => MOV Rx, PC, 3
                    if (parts.length >= 2) {
                        const rd = this.parseRegister(parts[1]);
                        return 0b1111100000000000 | (rd << 6) | (15 << 2) | 3;
                    }
                    throw new Error('ALNK requires destination register');
                case 'ALINK': // ALINK => MOV LR, PC, 3
                    return 0b1111100000000000 | (14 << 6) | (15 << 2) | 3;
                
                // Shift operations
                case 'SL':  return this.encodeShift(parts, 0b000, address, lineNumber);
                case 'SLC': return this.encodeShift(parts, 0b001, address, lineNumber);
                case 'SR':  return this.encodeShift(parts, 0b010, address, lineNumber);
                case 'SRC': return this.encodeShift(parts, 0b011, address, lineNumber);
                case 'SRA': return this.encodeShift(parts, 0b100, address, lineNumber);
                case 'SAC': return this.encodeShift(parts, 0b101, address, lineNumber);
                case 'ROR': return this.encodeShift(parts, 0b110, address, lineNumber);
                case 'ROC': return this.encodeShift(parts, 0b111, address, lineNumber);
                
                // PSW operations
                case 'SRS': return this.encodeSRS(parts, address, lineNumber);
                case 'SRD': return this.encodeSRD(parts, address, lineNumber);
                case 'ERS': return this.encodeERS(parts, address, lineNumber);
                case 'ERD': return this.encodeERD(parts, address, lineNumber);
                
                // Segment operations
                case 'MVS': return this.encodeMVS(parts, address, lineNumber);
                
                // Special moves
                case 'SMV': return this.encodeSMV(parts, address, lineNumber);
                
                // Long jump
                case 'JML': return this.encodeJML(parts, address, lineNumber);
                
                // Flag operations
                case 'SET': return this.encodeSET(parts, address, lineNumber);
                case 'CLR': return this.encodeCLR(parts, address, lineNumber);
                case 'SET2': return this.encodeSET2(parts, address, lineNumber);
                case 'CLR2': return this.encodeCLR2(parts, address, lineNumber);
                
                // Flag aliases
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
                
                // System instructions
                case 'FSH': return this.encodeSystem(0b001);
                case 'SWI': return this.encodeSystem(0b010);
                case 'RETI': return this.encodeSystem(0b011);
                case 'NOP':  return this.encodeSystem(0b000);
                case 'HALT': 
                case 'HLT': return 0xFFFF;
                
                case 'LDI':  return this.encodeLDIFromLine(cleanLine, address, lineNumber);
                case 'LSI':  return this.encodeLSI(parts, address, lineNumber);

                case 'LDS': return this.encodeLDSSTS(parts, false, address, lineNumber);
                case 'STS': return this.encodeLDSSTS(parts, true, address, lineNumber);
                
                // Complete SOP operations
                case 'SWB': return this.encodeSWB(parts, address, lineNumber);
                case 'INV': return this.encodeINV(parts, address, lineNumber);
                case 'NEG': return this.encodeNEG(parts, address, lineNumber);
                
                // 32-bit operations
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
            return 0b1111111010000000 | rx;
        }
        throw new Error('SRS requires register operand');
    }

    // NEW: Encode SRD instruction
    encodeSRD(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // SRD: [11111110][1001][Rx4]
            return 0b1111111010010000 | rx;
        }
        throw new Error('SRD requires register operand');
    }

    // NEW: Encode ERS instruction
    encodeERS(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // ERS: [11111110][1010][Rx4]
            return 0b1111111010100000 | rx;
        }
        throw new Error('ERS requires register operand');
    }

    // NEW: Encode ERD instruction
    encodeERD(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // ERD: [11111110][1011][Rx4]
            return 0b1111111010110000 | rx;
        }
        throw new Error('ERD requires register operand');
    }

// Update the encodeMVS method to handle both read and write operations:
encodeMVS(parts, address, lineNumber) {
    if (parts.length >= 3) {
        // Check if first operand is a segment register (write operation)
        const firstOperand = parts[1].toUpperCase();
        const secondOperand = parts[2].toUpperCase();
        
        const segMap = {
            'CS': 0b00, 'DS': 0b01, 'SS': 0b10, 'ES': 0b11
        };
        
        if (firstOperand in segMap) {
            const seg = segMap[firstOperand];
            const rd = this.parseRegister(parts[2]);
            return 0b1111111101000000 | (rd << 2) | seg;
        } else if (secondOperand in segMap) {
            const rd = this.parseRegister(parts[1]);
            const seg = segMap[secondOperand];
            return 0b1111111100000000 | (rd << 2) | seg;
        }
        throw new Error(`Invalid MVS operands: ${parts[1]}, ${parts[2]}`);
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

// In deep16_assembler.js - Fix encodeJML
encodeJML(parts, address, lineNumber) {
    if (parts.length >= 2) {
        const rx = this.parseRegister(parts[1]);
        // JML: [11111110][0100][Rx4]
        // Bits: 15-8: 11111110, 7-4: 0100, 3-0: Rx
        // So we need: 0xFE40 | Rx (not Rx << 4)
        return 0b1111111001000000 | rx;  // Remove the shift!
    }
    throw new Error('JML requires register operand (even register)');
}

// Replace the encodeMOV method with this version that calls existing encoding methods:
encodeMOV(parts, address, lineNumber) {
    if (parts.length >= 3) {
        let rd, rs, imm;
        
        // Check if we're using the plus syntax by looking for + in the joined parts
        const joinedParts = parts.join(' ');
        if (window.Deep16Debug) console.log(`MOV joined parts: "${joinedParts}"`);
        
        if (joinedParts.includes('+')) {
            // Plus syntax: MOV R1, R2+3 or MOV R1, R2 + 3
            if (window.Deep16Debug) console.log("Detected MOV plus syntax");
            
            // Extract the register+immediate part using regex
            const movMatch = joinedParts.match(/MOV\s+([A-Za-z0-9]+)\s+([A-Za-z0-9]+)\s*\+\s*(\d+)/);
            if (window.Deep16Debug) console.log(`MOV match:`, movMatch);
            
            if (!movMatch) {
                throw new Error(`Invalid MOV plus syntax: ${joinedParts}`);
            }
            
            rd = this.parseRegister(movMatch[1].trim());
            rs = this.parseRegister(movMatch[2].trim());
            imm = this.parseImmediate(movMatch[3].trim());
            
            // Handle regular MOV with offset
            if (window.Deep16Debug) console.log(`MOV parsed: rd=${rd}, rs=${rs}, imm=${imm}`);
            
            if (imm < 0 || imm > 3) {
                throw new Error(`MOV immediate ${imm} out of range (0-3)`);
            }
            
            // Regular MOV encoding: [111110][Rd4][Rs4][imm2]
            return 0b1111100000000000 | (rd << 6) | (rs << 2) | imm;
        } 
        // Original syntax: MOV R1, R2 or MOV R1, R2, 3
        else if (parts.length >= 3) {
            if (window.Deep16Debug) console.log("Detected original MOV syntax");
            rd = this.parseRegister(parts[1]);
            
            // Check if second operand is a segment register or special register
            const secondOperand = parts[2].toUpperCase();
            
            // Handle MOV between segment registers and general registers
            if (this.isSegmentRegister(secondOperand)) {
                // MOV Rd, Sx -> MVS Rd, Sx (read from segment register)
                if (window.Deep16Debug) console.log(`Detected MOV from segment register: ${secondOperand}`);
                return this.encodeMVS([null, parts[1], parts[2]], address, lineNumber);
            }
            else if (this.isSpecialRegister(secondOperand)) {
                // MOV Rd, special -> SMV Rd, special
                if (window.Deep16Debug) console.log(`Detected MOV from special register: ${secondOperand}`);
                return this.encodeSMV([null, parts[1], parts[2]], address, lineNumber);
            }
            else {
                // Regular register to register move
                rs = this.parseRegister(parts[2]);
                
                if (parts.length >= 4) {
                    imm = this.parseImmediate(parts[3]);
                } else {
                    imm = 0; // Default immediate is 0 if not specified
                }
                
                if (window.Deep16Debug) console.log(`MOV parsed: rd=${rd}, rs=${rs}, imm=${imm}`);
                
                if (imm < 0 || imm > 3) {
                    throw new Error(`MOV immediate ${imm} out of range (0-3)`);
                }
                
                // Regular MOV encoding: [111110][Rd4][Rs4][imm2]
                return 0b1111100000000000 | (rd << 6) | (rs << 2) | imm;
            }
        }
        else {
            throw new Error('MOV requires destination register and source register');
        }
    }
    
    // Handle MOV with segment register as destination
    if (parts.length >= 3) {
        const firstOperand = parts[1].toUpperCase();
        
        if (this.isSegmentRegister(firstOperand)) {
            // MOV Sx, Rd -> MVS Sx, Rd (write to segment register)
            if (window.Deep16Debug) console.log(`Detected MOV to segment register: ${firstOperand}`);
            // For MVS with write, we need to call encodeMVS with the right parameters
            // But encodeMVS expects [MVS, Rd, seg] format, so we need to rearrange
            const tempParts = ['MVS', parts[2], parts[1]]; // Swap operands for MVS encoding
            return this.encodeMVS(tempParts, address, lineNumber);
        }
    }
    
    throw new Error('MOV requires destination register and source register');
}

// Add these helper methods to the Deep16Assembler class:

// Helper method to check if a string is a segment register
isSegmentRegister(reg) {
    const segRegs = ['CS', 'DS', 'SS', 'ES'];
    return segRegs.includes(reg.toUpperCase());
}

// Helper method to check if a string is a special register
isSpecialRegister(reg) {
    const specialRegs = ['APC', 'APSW', 'PSW', 'ACS'];
    return specialRegs.includes(reg.toUpperCase());
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
            if (count < 0 || count > 15) {
                throw new Error(`Shift count ${count} out of range (0-15)`);
            }
        // Correct shift encoding: [110][111][Rd4][type3][count4]
        // Bits: 15-13: opcode=110, 12-10: aluOp=111, 9-6: Rd, 6-4: type, 3-0: count
        return 0b1101110000000000 | (rd << 6) | (shiftType << 4) | (count & 0xF);
        }
        throw new Error('Shift operation requires register and count');
    }

    // NEW: Encode SWB (Swap Bytes)
    encodeSWB(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // SWB: [11111110][0000][Rx4]
            return 0b1111111000000000 | rx;
        }
        throw new Error('SWB requires register operand');
    }

    // NEW: Encode INV (Invert)
    encodeINV(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // INV: [11111110][0001][Rx4]
            return 0b1111111000010000 | rx;
        }
        throw new Error('INV requires register operand');
    }

    // NEW: Encode NEG (Negate)
    encodeNEG(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const rx = this.parseRegister(parts[1]);
            // NEG: [11111110][0010][Rx4]
            return 0b1111111000100000 | rx;
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
    if (window.Deep16Debug) console.log(`encodeMemory parts:`, parts, `isStore:`, isStore);
    
    if (parts.length >= 3) {
        let rd, rb, offset;
        
        // Check if we're using bracket syntax by looking for [ in any part
        const joinedParts = parts.join(' ');
        if (window.Deep16Debug) console.log(`Joined parts: "${joinedParts}"`);
        
        if (joinedParts.includes('[') && joinedParts.includes(']')) {
            // Bracket syntax: LD R1, [R2+5] or ST R1, [R2] or LD R1, [R2 + 5]
            if (window.Deep16Debug) console.log("Detected bracket syntax");
            
            // Extract the entire bracket content from joined parts
            // Look for: ST R0 [R0 +21] - we want "R0 +21"
            const bracketMatch = joinedParts.match(/\[([^\]]+)\]/);
            if (window.Deep16Debug) console.log(`Bracket match:`, bracketMatch);
            
            if (!bracketMatch) {
                throw new Error(`Invalid bracket syntax in ${isStore ? 'ST' : 'LD'}`);
            }
            
            const bracketContent = bracketMatch[1];
            if (window.Deep16Debug) console.log(`Bracket content: "${bracketContent}"`);
            
            // Parse Rb and offset - use more flexible regex
            // This should handle: "R0", "R0+21", "R0 +21", "R0+ 21", "R0 + 21"
            const memoryMatch = bracketContent.match(/^([A-Za-z0-9]+)\s*(\+\s*(\d+))?$/);
            if (window.Deep16Debug) console.log(`Memory match:`, memoryMatch);
            
            if (!memoryMatch) {
                throw new Error(`Invalid memory address syntax: "${bracketContent}"`);
            }
            
            rb = this.parseRegister(memoryMatch[1].trim());
            
            if (memoryMatch[2]) { // If there's an offset part (+ something)
                offset = this.parseImmediate(memoryMatch[3].trim()); // memoryMatch[3] is the number part
            } else {
                offset = 0; // Default offset is 0 if not specified
            }
            
            // Rd is the part before the brackets (find the register before the [)
            // For "ST R0 [R0 +21]", we want "R0" (the second one)
            const beforeBracket = joinedParts.split('[')[0].trim();
            if (window.Deep16Debug) console.log(`Before bracket: "${beforeBracket}"`);
            const rdParts = beforeBracket.split(/\s+/);
            if (window.Deep16Debug) console.log(`Rd parts:`, rdParts);
            rd = this.parseRegister(rdParts[rdParts.length - 1]); // Last part before [
        } 
        // Old syntax: LD R1, R2, 5
        else if (parts.length >= 4) {
            if (window.Deep16Debug) console.log("Detected old syntax");
            rd = this.parseRegister(parts[1]);
            rb = this.parseRegister(parts[2]);
            offset = this.parseImmediate(parts[3]);
        }
        else {
            throw new Error(`${isStore ? 'ST' : 'LD'} requires register, base register, and offset`);
        }
        
        if (window.Deep16Debug) console.log(`Parsed: rd=${rd}, rb=${rb}, offset=${offset}`);
        
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

    encodeLDIFromLine(line, address, lineNumber) {
        const cleaned = line.split(';')[0].trim();
        const rest = cleaned.replace(/^LDI\s+/, '').replace(/,$/, '').trim();
        if (!rest) {
            throw new Error('LDI requires immediate value');
        }
        const imm = this.parseImmediate(rest);
        if (imm < 0 || imm > 32767) {
            throw new Error(`LDI immediate ${imm} out of range (0-32767)`);
        }
        return imm & 0x7FFF;
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
