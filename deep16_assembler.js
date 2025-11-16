// deep16_assembler.js - Enhanced with complete ALU support and proper result structure
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
        let address = 0;

        const lines = source.split('\n');
        
        // First pass: collect labels and symbols
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

        // Second pass: generate machine code
        address = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith(';')) continue;

            try {
                if (line.startsWith('.org')) {
                    const orgValue = this.parseImmediate(line.split(/\s+/)[1]);
                    address = orgValue;
                } else if (line.endsWith(':')) {
                    // Labels already processed in first pass
                    continue;
                } else if (line.startsWith('.word')) {
                    const values = line.substring(5).trim().split(',').map(v => this.parseImmediate(v.trim()));
                    for (const value of values) {
                        if (address < memory.length) {
                            memory[address] = value & 0xFFFF;
                            address++;
                        }
                    }
                } else {
                    const instruction = this.encodeInstruction(line, address, i + 1);
                    if (instruction !== null && address < memory.length) {
                        memory[address] = instruction;
                        address++;
                    }
                }
            } catch (error) {
                errors.push(`Line ${i + 1}: ${error.message}`);
            }
        }

        return {
            success: errors.length === 0,
            memory: memory,
            symbols: this.symbols,
            errors: errors
        };
    }

    isDirective(line) {
        return line.startsWith('.org') || line.startsWith('.word');
    }

    parseRegister(reg) {
        const regMap = {
            'R0': 0, 'R1': 1, 'R2': 2, 'R3': 3, 'R4': 4, 'R5': 5, 'R6': 6, 'R7': 7,
            'R8': 8, 'R9': 9, 'R10': 10, 'R11': 11, 
            'FP': 12, 'SP': 13, 'LR': 14, 'PC': 15
        };
        
        if (reg in regMap) return regMap[reg];
        if (reg.startsWith('R')) {
            const num = parseInt(reg.substring(1));
            if (num >= 0 && num <= 15) return num;
        }
        throw new Error(`Invalid register: ${reg}`);
    }

    parseImmediate(value) {
        if (value.startsWith('0x')) {
            return parseInt(value.substring(2), 16);
        } else if (value.startsWith('$')) {
            return parseInt(value.substring(1), 16);
        } else {
            return parseInt(value);
        }
    }

    encodeInstruction(line, address, lineNumber) {
        // Remove comments
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
                case 'ST':  return this.encodeST(parts, address, lineNumber);
                case 'LD':  return this.encodeLD(parts, address, lineNumber);
                case 'JZ':  return this.encodeJZ(parts, address, lineNumber);
                case 'JNZ': return this.encodeJNZ(parts, address, lineNumber);
                case 'JC':  return this.encodeJC(parts, address, lineNumber);
                case 'JNC': return this.encodeJNC(parts, address, lineNumber);
                case 'JN':  return this.encodeJN(parts, address, lineNumber);
                case 'JNN': return this.encodeJNN(parts, address, lineNumber);
                case 'JO':  return this.encodeJO(parts, address, lineNumber);
                case 'JNO': return this.encodeJNO(parts, address, lineNumber);
                case 'SL':  return this.encodeShift(parts, 0b000, address, lineNumber);
                case 'SR':  return this.encodeShift(parts, 0b010, address, lineNumber);
                case 'SRA': return this.encodeShift(parts, 0b100, address, lineNumber);
                case 'ROR': return this.encodeShift(parts, 0b110, address, lineNumber);
                case 'SET': return this.encodeSET(parts, address, lineNumber);
                case 'CLR': return this.encodeCLR(parts, address, lineNumber);
                case 'SET2': return this.encodeSET2(parts, address, lineNumber);
                case 'CLR2': return this.encodeCLR2(parts, address, lineNumber);
                case 'SETI': return 0b1111111011100001; // SET2 1 alias
                case 'CLRI': return 0b1111111011110001; // CLR2 1 alias
                case 'HALT': return 0b1111111111110001;
                case 'NOP':  return 0b1111111111110000;
                case 'RETI': return 0b1111111111110011;
                default: 
                    // Check if it's a label reference
                    if (this.labels[mnemonic] !== undefined) {
                        return null; // Labels don't generate instructions
                    }
                    throw new Error(`Unknown instruction: ${mnemonic}`);
            }
        } catch (error) {
            throw new Error(`Line ${lineNumber}: ${error.message}`);
        }
    }

    encodeMOV(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            const rs = this.parseRegister(parts[2]);
            return 0b1111100000000000 | (rd << 8) | (rs << 4);
        }
        throw new Error('MOV requires two registers');
    }

    encodeALU(parts, aluOp, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            if (parts[2].startsWith('R') || ['SP', 'FP', 'LR', 'PC'].includes(parts[2])) {
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

    encodeST(parts, address, lineNumber) {
        if (parts.length >= 4) {
            const rd = this.parseRegister(parts[1]);
            const rb = this.parseRegister(parts[2]);
            const offset = this.parseImmediate(parts[3]);
            if (offset < 0 || offset > 31) {
                throw new Error(`Offset ${offset} out of range (0-31)`);
            }
            return 0b1010000000000000 | (rd << 8) | (rb << 4) | offset;
        }
        throw new Error('ST requires register, base register, and offset');
    }

    encodeLD(parts, address, lineNumber) {
        if (parts.length >= 4) {
            const rd = this.parseRegister(parts[1]);
            const rb = this.parseRegister(parts[2]);
            const offset = this.parseImmediate(parts[3]);
            if (offset < 0 || offset > 31) {
                throw new Error(`Offset ${offset} out of range (0-31)`);
            }
            return 0b1000000000000000 | (rd << 8) | (rb << 4) | offset;
        }
        throw new Error('LD requires register, base register, and offset');
    }

    encodeJZ(parts, address, lineNumber) { 
        return this.encodeJump(parts, 0b000, address, lineNumber); 
    }
    encodeJNZ(parts, address, lineNumber) { 
        return this.encodeJump(parts, 0b001, address, lineNumber); 
    }
    encodeJC(parts, address, lineNumber) { 
        return this.encodeJump(parts, 0b010, address, lineNumber); 
    }
    encodeJNC(parts, address, lineNumber) { 
        return this.encodeJump(parts, 0b011, address, lineNumber); 
    }
    encodeJN(parts, address, lineNumber) { 
        return this.encodeJump(parts, 0b100, address, lineNumber); 
    }
    encodeJNN(parts, address, lineNumber) { 
        return this.encodeJump(parts, 0b101, address, lineNumber); 
    }
    encodeJO(parts, address, lineNumber) { 
        return this.encodeJump(parts, 0b110, address, lineNumber); 
    }
    encodeJNO(parts, address, lineNumber) { 
        return this.encodeJump(parts, 0b111, address, lineNumber); 
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
