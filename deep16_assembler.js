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
    const memory = new Array(65536).fill(0);
    const assemblyListing = [];
    let address = 0;

    const lines = source.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith(';')) continue;

        try {
            if (line.startsWith('.org')) {
                const orgValue = this.parseImmediate(line.split(/\s+/)[1]);
                address = orgValue;
            } else if (line.endsWith(':')) {
                const label = line.slice(0, -1).trim();
                this.labels[label] = address;
                this.symbols[label] = address;
            } else if (!this.isDirective(line)) {
                address++;
            }
        } catch (error) {
            errors.push(`Line ${i + 1}: ${error.message}`);
        }
    }

    address = 0;
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
                assemblyListing.push({ address: address, line: originalLine });
            } else if (line.endsWith(':')) {
                assemblyListing.push({ address: address, line: originalLine });
            } else if (line.startsWith('.word')) {
                const values = line.substring(5).trim().split(',').map(v => this.parseImmediate(v.trim()));
                for (const value of values) {
                    if (address < memory.length) {
                        memory[address] = value & 0xFFFF;
                        assemblyListing.push({ 
                            address: address, 
                            instruction: value,
                            line: originalLine 
                        });
                        address++;
                    }
                }
            } else {
                const instruction = this.encodeInstruction(line, address, i + 1);
                if (instruction !== null && address < memory.length) {
                    memory[address] = instruction;
                    assemblyListing.push({ 
                        address: address, 
                        instruction: instruction,
                        line: originalLine 
                    });
                    address++;
                } else {
                    assemblyListing.push({ address: address, line: originalLine });
                }
            }
        } catch (error) {
            errors.push(`Line ${i + 1}: ${error.message}`);
            assemblyListing.push({ 
                address: address,
                error: error.message,
                line: originalLine 
            });
            address++;
        }
    }

    return {
        success: errors.length === 0,
        memory: memory,
        symbols: this.symbols,
        errors: errors,
        listing: assemblyListing
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
            'R0': 0, 'R1': 1, 'R2': 2, 'R3': 3, 'R4': 4, 'R5': 5, 'R6': 6, 'R7': 7,
            'R8': 8, 'R9': 9, 'R10': 10, 'R11': 11, 
            'FP': 12, 'SP': 13, 'LR': 14, 'PC': 15
        };
        
        const upperReg = reg.toUpperCase();
        if (upperReg in regMap) return regMap[upperReg];
        
        if (upperReg.startsWith('R')) {
            const num = parseInt(upperReg.substring(1));
            if (!isNaN(num) && num >= 0 && num <= 15) return num;
        }
        
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
        return (upper.startsWith('R') && !isNaN(parseInt(upper.substring(1)))) || 
               ['SP', 'FP', 'LR', 'PC'].includes(upper);
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
                case 'SL':  return this.encodeShift(parts, 0b000, address, lineNumber);
                case 'SR':  return this.encodeShift(parts, 0b010, address, lineNumber);
                case 'SRA': return this.encodeShift(parts, 0b100, address, lineNumber);
                case 'ROR': return this.encodeShift(parts, 0b110, address, lineNumber);
                case 'SET': return this.encodeSET(parts, address, lineNumber);
                case 'CLR': return this.encodeCLR(parts, address, lineNumber);
                case 'SET2': return this.encodeSET2(parts, address, lineNumber);
                case 'CLR2': return this.encodeCLR2(parts, address, lineNumber);
                case 'SETI': return 0b1111111011100001;
                case 'CLRI': return 0b1111111011110001;
                case 'LDI':  return this.encodeLDI(parts, address, lineNumber);
                case 'LSI':  return this.encodeLSI(parts, address, lineNumber);
                case 'HALT': return 0b1111111111110001;
                case 'NOP':  return 0b1111111111110000;
                case 'RETI': return 0b1111111111110011;
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
    
    encodeALU(parts, aluOp, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            
            if (this.isRegister(parts[2])) {
                const rs = this.parseRegister(parts[2]);
                return 0b1100000000000000 | (aluOp << 10) | (rd << 8) | (rs << 4);
            } else {
                const imm = this.parseImmediate(parts[2]);
                if (imm < 0 || imm > 15) {
                    throw new Error(`Immediate value ${imm} out of range (0-15)`);
                }
                return 0b1100001000000000 | (aluOp << 10) | (rd << 8) | imm;
            }
        }
        throw new Error(`ALU operation requires two operands`);
    }

    encodeMemory(parts, isStore, address, lineNumber) {
        if (parts.length >= 4) {
            const rd = this.parseRegister(parts[1]);
            const rb = this.parseRegister(parts[2]);
            const offset = this.parseImmediate(parts[3]);
            
            if (offset < 0 || offset > 31) {
                throw new Error(`Offset ${offset} out of range (0-31)`);
            }
            
            return (isStore ? 0b1010000000000000 : 0b1000000000000000) | 
                   (rd << 8) | (rb << 4) | offset;
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
            return 0b1111110000000000 | (rd << 8) | (imm5 << 4);
        }
        throw new Error('LSI requires register and immediate value');
    }

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
            return 0b1110000000000000 | (condition << 9) | (offset & 0x1FF);
        }
        throw new Error('Jump requires target label');
    }

    encodeShift(parts, shiftType, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            const count = this.parseImmediate(parts[2]);
            if (count < 0 || count > 7) {
                throw new Error(`Shift count ${count} out of range (0-7)`);
            }
            return 0b1101110000000000 | (rd << 8) | (shiftType << 4) | count;
        }
        throw new Error('Shift operation requires register and count');
    }

    encodeSET(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1]);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`SET immediate ${imm} out of range (0-15)`);
            }
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
            return 0b1111111011110000 | (imm << 4);
        }
        throw new Error('CLR2 requires immediate value');
    }
}
/* deep16_assembler.js */
