// Deep16 Assembler - Instruction Encoding and Assembly Logic
class Deep16Assembler {
    constructor() {
        this.labels = {};
        this.symbols = {};
    }

    assemble(source) {
        const lines = source.split('\n');
        let address = 0;
        this.labels = {};
        this.symbols = {};

        // First pass: collect labels and resolve .org
        let lineNumber = 0;
        for (let line of lines) {
            lineNumber++;
            line = this.cleanLine(line);
            if (!line) continue;

            if (line.startsWith('.org')) {
                const orgValue = this.parseImmediate(line.split(' ')[1]);
                address = orgValue;
            } else if (line.endsWith(':')) {
                const label = line.slice(0, -1);
                this.labels[label] = address;
                this.symbols[label] = { address: address, type: 'label', line: lineNumber };
            } else if (line.startsWith('.word')) {
                address += 2;
            } else {
                address += 2;
            }
        }

        // Second pass: assemble instructions
        const memory = new Array(65536).fill(0);
        address = 0;
        const errors = [];

        lineNumber = 0;
        for (let line of lines) {
            lineNumber++;
            line = this.cleanLine(line);
            if (!line) continue;

            if (line.startsWith('.org')) {
                const orgValue = this.parseImmediate(line.split(' ')[1]);
                address = orgValue;
            } else if (line.endsWith(':')) {
                // Label - already handled
            } else if (line.startsWith('.word')) {
                const value = this.parseImmediate(line.split(' ')[1]);
                memory[address] = value & 0xFFFF;
                address += 2;
            } else {
                try {
                    const instruction = this.encodeInstruction(line, address, lineNumber);
                    if (instruction !== null) {
                        memory[address] = instruction;
                        address += 2;
                    } else {
                        errors.push(`Line ${lineNumber}: Unknown instruction: ${line}`);
                    }
                } catch (error) {
                    errors.push(`Line ${lineNumber}: ${error.message}`);
                }
            }
        }

        return {
            memory: memory,
            symbols: this.symbols,
            labels: this.labels,
            errors: errors,
            success: errors.length === 0
        };
    }

    cleanLine(line) {
        return line.split(';')[0].trim().replace(/\s+/g, ' ');
    }

    parseImmediate(value) {
        if (value.startsWith('0x')) {
            return parseInt(value.substring(2), 16);
        }
        return parseInt(value);
    }

    parseRegister(reg) {
        const regMap = {
            'R0': 0, 'R1': 1, 'R2': 2, 'R3': 3, 'R4': 4, 'R5': 5, 'R6': 6, 'R7': 7,
            'R8': 8, 'R9': 9, 'R10': 10, 'R11': 11, 'R12': 12, 'R13': 13, 'R14': 14, 'R15': 15,
            'SP': 13, 'FP': 12, 'LR': 14, 'PC': 15
        };
        const result = regMap[reg.toUpperCase()];
        if (result === undefined) {
            throw new Error(`Unknown register: ${reg}`);
        }
        return result;
    }

    encodeInstruction(line, address, lineNumber) {
        const parts = line.split(/[\s,]+/).filter(part => part);
        if (parts.length === 0) return null;

        const mnemonic = parts[0].toUpperCase();

        try {
            switch (mnemonic) {
                case 'MOV':
                    return this.encodeMOV(parts, address, lineNumber);
                case 'ADD':
                    return this.encodeADD(parts, address, lineNumber);
                case 'SUB':
                    return this.encodeSUB(parts, address, lineNumber);
                case 'ST':
                    return this.encodeST(parts, address, lineNumber);
                case 'LD':
                    return this.encodeLD(parts, address, lineNumber);
                case 'JNZ':
                    return this.encodeJNZ(parts, address, lineNumber);
                case 'HALT':
                    return 0b1111111111110001;
                case 'NOP':
                    return 0b1111111111110000;
                default:
                    return null;
            }
        } catch (error) {
            throw new Error(`Line ${lineNumber}: ${error.message}`);
        }
    }

    encodeMOV(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            if (parts[2].startsWith('R') || parts[2] === 'SP' || parts[2] === 'FP' || parts[2] === 'LR' || parts[2] === 'PC') {
                const rs = this.parseRegister(parts[2]);
                const imm = parts[3] ? this.parseImmediate(parts[3]) : 0;
                return 0b1111100000000000 | (rd << 8) | (rs << 4) | (imm & 0x3);
            } else {
                const imm = this.parseImmediate(parts[2]);
                if (imm >= -16 && imm <= 15) {
                    return 0b1111110000000000 | (rd << 8) | ((imm & 0x1F) << 4);
                } else {
                    throw new Error(`Immediate value ${imm} out of range for MOV (-16 to 15)`);
                }
            }
        }
        return null;
    }

    encodeADD(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            if (parts[2].startsWith('R') || parts[2] === 'SP' || parts[2] === 'FP' || parts[2] === 'LR' || parts[2] === 'PC') {
                const rs = this.parseRegister(parts[2]);
                return 0b1100000000000000 | (rd << 8) | (rs << 4);
            } else {
                const imm = this.parseImmediate(parts[2]);
                return 0b1100001000000000 | (rd << 8) | (imm & 0xF);
            }
        }
        return null;
    }

    encodeSUB(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            if (parts[2].startsWith('R') || parts[2] === 'SP' || parts[2] === 'FP' || parts[2] === 'LR' || parts[2] === 'PC') {
                const rs = this.parseRegister(parts[2]);
                return 0b1100010000000000 | (rd << 8) | (rs << 4);
            } else {
                const imm = this.parseImmediate(parts[2]);
                return 0b1100011000000000 | (rd << 8) | (imm & 0xF);
            }
        }
        return null;
    }

    encodeST(parts, address, lineNumber) {
        if (parts.length >= 4) {
            const rd = this.parseRegister(parts[1]);
            const rb = this.parseRegister(parts[2]);
            const offset = this.parseImmediate(parts[3]);
            return 0b1010000000000000 | (rd << 8) | (rb << 4) | (offset & 0x1F);
        }
        return null;
    }

    encodeLD(parts, address, lineNumber) {
        if (parts.length >= 4) {
            const rd = this.parseRegister(parts[1]);
            const rb = this.parseRegister(parts[2]);
            const offset = this.parseImmediate(parts[3]);
            return 0b1000000000000000 | (rd << 8) | (rb << 4) | (offset & 0x1F);
        }
        return null;
    }

    encodeJNZ(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rcond = this.parseRegister(parts[1]);
            const targetLabel = parts[2];
            let targetAddress = this.labels[targetLabel];
            if (targetAddress === undefined) {
                throw new Error(`Unknown label: ${targetLabel}`);
            }
            const offset = Math.floor((targetAddress - (address + 2)) / 2);
            if (offset < -256 || offset > 255) {
                throw new Error(`Jump target too far: ${offset} words from current position`);
            }
            return 0b1110010000000000 | ((offset & 0x1FF) << 0);
        }
        return null;
    }
}
