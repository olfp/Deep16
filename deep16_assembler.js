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
                
                // Flag aliases for SET/CLR (PSW[3:0])
                case 'SETN': return this.encodeSET(parts, 0b0000, address, lineNumber);
                case 'CLRN': return this.encodeCLR(parts, 0b1000, address, lineNumber);
                case 'SETZ': return this.encodeSET(parts, 0b0001, address, lineNumber);
                case 'CLRZ': return this.encodeCLR(parts, 0b1001, address, lineNumber);
                case 'SETV': return this.encodeSET(parts, 0b0010, address, lineNumber);
                case 'CLRV': return this.encodeCLR(parts, 0b1010, address, lineNumber);
                case 'SETC': return this.encodeSET(parts, 0b0011, address, lineNumber);
                case 'CLRC': return this.encodeCLR(parts, 0b1011, address, lineNumber);
                
                // Flag aliases for SET2/CLR2 (PSW[7:4])
                case 'SETI': return this.encodeSET2(parts, 0b0000, address, lineNumber);
                case 'CLRI': return this.encodeCLR2(parts, 0b0000, address, lineNumber);
                case 'SETS': return this.encodeSET2(parts, 0b0001, address, lineNumber);
                case 'CLRS': return this.encodeCLR2(parts, 0b0001, address, lineNumber);
                
                // HALT alias and new encoding
                case 'HALT': 
                case 'HLT': return 0xFFFF; // All ones for HALT
                
                // RETI as system call
                case 'RETI': return this.encodeSystem(parts, 0b001, address, lineNumber);
                
                case 'LDI':  return this.encodeLDI(parts, address, lineNumber);
                case 'LSI':  return this.encodeLSI(parts, address, lineNumber);
                case 'NOP':  return 0b1111111111110000;
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

    // Add system instruction encoding
    encodeSystem(parts, sysOp, address, lineNumber) {
        // SYS: [1111111111110][op3]
        // Bits: 15-13: opcode=1111111111110, 2-0: sysOp
        return 0b1111111111110000 | sysOp;
    }

    // Update SET/CLR to accept immediate or use provided value for aliases
    encodeSET(parts, immediate, address, lineNumber) {
        let immValue;
        if (typeof immediate === 'number') {
            immValue = immediate;
        } else if (parts.length >= 2) {
            immValue = this.parseImmediate(parts[1]);
        } else {
            throw new Error('SET requires immediate value');
        }
        
        if (immValue < 0 || immValue > 0xF) {
            throw new Error(`SET immediate ${immValue} out of range (0-15)`);
        }
        // SET: [11111110][1100][imm4]  
        // Bits: 15-8: opcode=11111110, 7-4: type=1100, 3-0: imm
        return 0b1111111011000000 | (immValue << 4);
    }

    encodeCLR(parts, immediate, address, lineNumber) {
        let immValue;
        if (typeof immediate === 'number') {
            immValue = immediate;
        } else if (parts.length >= 2) {
            immValue = this.parseImmediate(parts[1]);
        } else {
            throw new Error('CLR requires immediate value');
        }
        
        if (immValue < 0 || immValue > 0xF) {
            throw new Error(`CLR immediate ${immValue} out of range (0-15)`);
        }
        // CLR: [11111110][1101][imm4]
        // Bits: 15-8: opcode=11111110, 7-4: type=1101, 3-0: imm
        return 0b1111111011010000 | (immValue << 4);
    }

    encodeSET2(parts, immediate, address, lineNumber) {
        let immValue;
        if (typeof immediate === 'number') {
            immValue = immediate;
        } else if (parts.length >= 2) {
            immValue = this.parseImmediate(parts[1]);
        } else {
            throw new Error('SET2 requires immediate value');
        }
        
        if (immValue < 0 || immValue > 0xF) {
            throw new Error(`SET2 immediate ${immValue} out of range (0-15)`);
        }
        // SET2: [11111110][1110][imm4]
        // Bits: 15-8: opcode=11111110, 7-4: type=1110, 3-0: imm
        return 0b1111111011100000 | (immValue << 4);
    }

    encodeCLR2(parts, immediate, address, lineNumber) {
        let immValue;
        if (typeof immediate === 'number') {
            immValue = immediate;
        } else if (parts.length >= 2) {
            immValue = this.parseImmediate(parts[1]);
        } else {
            throw new Error('CLR2 requires immediate value');
        }
        
        if (immValue < 0 || immValue > 0xF) {
            throw new Error(`CLR2 immediate ${immValue} out of range (0-15)`);
        }
        // CLR2: [11111110][1111][imm4]
        // Bits: 15-8: opcode=11111110, 7-4: type=1111, 3-0: imm
        return 0b1111111011110000 | (immValue << 4);
    }

}
/* deep16_assembler.js */
