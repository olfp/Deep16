// deep16_assembler.js - Enhanced with complete ALU support
class Deep16Assembler {
    // ... existing code ...

    encodeInstruction(line, address, lineNumber) {
        const parts = line.split(/[\s,]+/).filter(part => part);
        if (parts.length === 0) return null;

        const mnemonic = parts[0].toUpperCase();

        try {
            switch (mnemonic) {
                case 'MOV': return this.encodeMOV(parts, address, lineNumber);
                case 'ADD': return this.encodeADD(parts, address, lineNumber);
                case 'SUB': return this.encodeSUB(parts, address, lineNumber);
                case 'AND': return this.encodeAND(parts, address, lineNumber);
                case 'OR':  return this.encodeOR(parts, address, lineNumber);
                case 'XOR': return this.encodeXOR(parts, address, lineNumber);
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
                case 'SETI': return 0b1111111011110000; // SET2 1 alias
                case 'CLRI': return 0b1111111011110001; // CLR2 1 alias
                case 'HALT': return 0b1111111111110001;
                case 'NOP':  return 0b1111111111110000;
                default: return null;
            }
        } catch (error) {
            throw new Error(`Line ${lineNumber}: ${error.message}`);
        }
    }

    encodeAND(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            if (parts[2].startsWith('R') || parts[2] === 'SP' || parts[2] === 'FP' || parts[2] === 'LR' || parts[2] === 'PC') {
                const rs = this.parseRegister(parts[2]);
                return 0b1100100000000000 | (rd << 8) | (rs << 4); // AND Rd, Rs
            } else {
                const imm = this.parseImmediate(parts[2]);
                return 0b1100101000000000 | (rd << 8) | (imm & 0xF); // AND Rd, imm4
            }
        }
        return null;
    }

    encodeOR(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            if (parts[2].startsWith('R') || parts[2] === 'SP' || parts[2] === 'FP' || parts[2] === 'LR' || parts[2] === 'PC') {
                const rs = this.parseRegister(parts[2]);
                return 0b1100110000000000 | (rd << 8) | (rs << 4); // OR Rd, Rs
            } else {
                const imm = this.parseImmediate(parts[2]);
                return 0b1100111000000000 | (rd << 8) | (imm & 0xF); // OR Rd, imm4
            }
        }
        return null;
    }

    encodeXOR(parts, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            if (parts[2].startsWith('R') || parts[2] === 'SP' || parts[2] === 'FP' || parts[2] === 'LR' || parts[2] === 'PC') {
                const rs = this.parseRegister(parts[2]);
                return 0b1101000000000000 | (rd << 8) | (rs << 4); // XOR Rd, Rs
            } else {
                const imm = this.parseImmediate(parts[2]);
                return 0b1101001000000000 | (rd << 8) | (imm & 0xF); // XOR Rd, imm4
            }
        }
        return null;
    }

    encodeShift(parts, shiftType, address, lineNumber) {
        if (parts.length >= 3) {
            const rd = this.parseRegister(parts[1]);
            const count = this.parseImmediate(parts[2]);
            if (count < 0 || count > 7) {
                throw new Error(`Shift count ${count} out of range (0-7)`);
            }
            // Shift encoding: [110][111][Rd][1][0][T2][C][count3]
            return 0b1101110000000000 | (rd << 8) | (shiftType << 4) | count;
        }
        return null;
    }

    encodeJZ(parts, address, lineNumber) { return this.encodeJump(parts, 0b000, address, lineNumber); }
    encodeJNZ(parts, address, lineNumber) { return this.encodeJump(parts, 0b001, address, lineNumber); }
    encodeJC(parts, address, lineNumber) { return this.encodeJump(parts, 0b010, address, lineNumber); }
    encodeJNC(parts, address, lineNumber) { return this.encodeJump(parts, 0b011, address, lineNumber); }
    encodeJN(parts, address, lineNumber) { return this.encodeJump(parts, 0b100, address, lineNumber); }
    encodeJNN(parts, address, lineNumber) { return this.encodeJump(parts, 0b101, address, lineNumber); }
    encodeJO(parts, address, lineNumber) { return this.encodeJump(parts, 0b110, address, lineNumber); }
    encodeJNO(parts, address, lineNumber) { return this.encodeJump(parts, 0b111, address, lineNumber); }

    encodeJump(parts, condition, address, lineNumber) {
        if (parts.length >= 2) {
            const targetLabel = parts[1];
            let targetAddress = this.labels[targetLabel];
            if (targetAddress === undefined) {
                throw new Error(`Unknown label: ${targetLabel}`);
            }
            const offset = Math.floor((targetAddress - (address + 2)) / 2);
            if (offset < -256 || offset > 255) {
                throw new Error(`Jump target too far: ${offset} words from current position`);
            }
            return 0b1110000000000000 | (condition << 9) | (offset & 0x1FF);
        }
        return null;
    }

    encodeSET(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1]);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`SET immediate ${imm} out of range (0-15)`);
            }
            return 0b1111111011000000 | (imm << 4);
        }
        return null;
    }

    encodeCLR(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1]);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`CLR immediate ${imm} out of range (0-15)`);
            }
            return 0b1111111011010000 | (imm << 4);
        }
        return null;
    }

    encodeSET2(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1]);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`SET2 immediate ${imm} out of range (0-15)`);
            }
            return 0b1111111011100000 | (imm << 4);
        }
        return null;
    }

    encodeCLR2(parts, address, lineNumber) {
        if (parts.length >= 2) {
            const imm = this.parseImmediate(parts[1]);
            if (imm < 0 || imm > 0xF) {
                throw new Error(`CLR2 immediate ${imm} out of range (0-15)`);
            }
            return 0b1111111011110000 | (imm << 4);
        }
        return null;
    }
}
