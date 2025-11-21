/* deep16_disassembler.js - UPDATED VERSION */
class Deep16Disassembler {
    constructor() {
        // ENHANCED: Always use Rx format except PC for R15
        this.registerNames = [
            'R0','R1','R2','R3','R4','R5','R6','R7',
            'R8','R9','R10','R11','R12','R13','R14','PC'  // R15 becomes PC
        ];
        this.aluOps = ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'MUL', 'DIV', 'SHIFT'];
        this.shiftOps = ['SL', 'SLC', 'SR', 'SRC', 'SRA', 'SAC', 'ROR', 'ROC'];
        this.jumpConditions = ['JZ', 'JNZ', 'JC', 'JNC', 'JN', 'JNN', 'JO', 'JNO'];
        this.systemOps = ['NOP', 'HLT', 'SWI', 'RETI', '', '', '', ''];
        this.segmentNames = ['CS', 'DS', 'SS', 'ES'];
        this.smvSources = ['APC', 'APSW', 'PSW', 'ACS'];
    }

disassemble(instruction) {
    // Check for HALT first (0xFFFF) - this should take highest priority
    if (instruction === 0xFFFF) {
        return 'HLT';
    }
    
    // Check for LDI (opcode bit 15 = 0)
    if ((instruction & 0x8000) === 0) {
        return this.disassembleLDI(instruction);
    }
    
    // Check for LD/ST (opcode bits 15-14 = 10)
    if (((instruction >>> 14) & 0x3) === 0b10) {
        return this.disassembleMemory(instruction);
    }
    
    // Check for ALU2 (opcode bits 15-13 = 110)
    if (((instruction >>> 13) & 0x7) === 0b110) {
        return this.disassembleALU(instruction);
    }
    
    // Check for extended instructions (opcode bits 15-13 = 111)
    if (((instruction >>> 13) & 0x7) === 0b111) {
        return this.disassembleControlFlow(instruction);
    }
    
    return `??? (0x${instruction.toString(16).padStart(4, '0').toUpperCase()})`;
}

// In deep16_disassembler.js - Fix MVS detection
disassembleControlFlow(instruction) {
    // Check for LDS/STS first (opcode bits 15-11 = 11110)
    if ((instruction >>> 11) === 0b11110) {
        return this.disassembleLDSSTS(instruction);
    }
    
    // Check for MOV first (opcode bits 15-10 = 111110)
    if ((instruction >>> 10) === 0b111110) {
        return this.disassembleMOV(instruction);
    }
    
    // Check for LSI (opcode bits 15-9 = 1111110)
    if ((instruction >>> 9) === 0b1111110) {
        return this.disassembleLSI(instruction);
    }
    
    // Check for MVS (opcode bits 15-9 = 111111110)
    if ((instruction >>> 9) === 0b111111110) {
        return this.disassembleMVS(instruction);
    }
    
    // Check for SMV (opcode bits 15-10 = 1111111110)
    if ((instruction >>> 10) === 0b1111111110) {
        return this.disassembleSMV(instruction);
    }
    
    // Check for SOP (Single Operand) instructions (opcode bits 15-8 = 11111110)
    if ((instruction >>> 8) === 0b11111110) {
        return this.disassembleSOP(instruction);
    }
    
    // Check for Jump (opcode bits 15-12 = 1110)
    if ((instruction >>> 12) === 0b1110) {
        return this.disassembleJump(instruction);
    }
    
    // Check for System (opcode bits 15-3 = 1111111111110)
    if ((instruction >>> 3) === 0b1111111111110) {
        return this.disassembleSystem(instruction);
    }
    
    return `??? (0x${instruction.toString(16).padStart(4, '0').toUpperCase()})`;
}
// In deep16_disassembler.js - Fix disassembleSOP method
disassembleSOP(instruction) {
    const type4 = (instruction >>> 4) & 0xF;
    const rx = instruction & 0xF;
    
    console.log(`SOP instruction: 0x${instruction.toString(16)}, type4: ${type4.toString(2)}, rx: ${rx}`);
    
    switch (type4) {
        case 0b0000: return `SWB ${this.registerNames[rx]}`;
        case 0b0001: return `INV ${this.registerNames[rx]}`;
        case 0b0010: return `NEG ${this.registerNames[rx]}`;
        case 0b0100: return `JML ${this.registerNames[rx]}`;  // This should be correct
        case 0b1000: return `SRS ${this.registerNames[rx]}`;
        case 0b1001: return `SRD ${this.registerNames[rx]}`;
        case 0b1010: return `ERS ${this.registerNames[rx]}`;
        case 0b1011: return `ERD ${this.registerNames[rx]}`;
        case 0b1100: 
            const setImm = instruction & 0xF;
            return `SET #0x${setImm.toString(16).toUpperCase()}`;
        case 0b1101:
            const clrImm = instruction & 0xF;
            return `CLR #0x${clrImm.toString(16).toUpperCase()}`;
        case 0b1110:
            const set2Imm = instruction & 0xF;
            return `SET2 #0x${set2Imm.toString(16).toUpperCase()}`;
        case 0b1111:
            const clr2Imm = instruction & 0xF;
            return `CLR2 #0x${clr2Imm.toString(16).toUpperCase()}`;
        default:
            return `SOP??? (0x${instruction.toString(16).padStart(4, '0').toUpperCase()})`;
    }
}

    // NEW: Disassemble MVS instruction
    disassembleMVS(instruction) {
        const d = (instruction >>> 6) & 0x1;
        const rd = (instruction >>> 2) & 0xF;
        const seg = instruction & 0x3;
        
        if (d === 0) {
            return `MVS ${this.registerNames[rd]}, ${this.segmentNames[seg]}`;
        } else {
            return `MVS ${this.segmentNames[seg]}, ${this.registerNames[rd]}`;
        }
    }

    // NEW: Disassemble SMV instruction
    disassembleSMV(instruction) {
        const src2 = (instruction >>> 4) & 0x3;
        const rd = instruction & 0xF;
        
        return `SMV ${this.registerNames[rd]}, ${this.smvSources[src2]}`;
    }

    // NEW: Disassemble JML instruction (from SOP group)
    disassembleJML(instruction) {
        const rx = instruction & 0xF;
        return `JML ${this.registerNames[rx]}`;
    }

    // Enhanced disassembleSystem to handle all system ops
    disassembleSystem(instruction) {
        const sysOp = instruction & 0x7;
        return this.systemOps[sysOp] || `SYS??? (0x${instruction.toString(16).padStart(4, '0').toUpperCase()})`;
    }

    // All existing methods remain the same...
    disassembleLDI(instruction) {
        const immediate = instruction & 0x7FFF;
        return `LDI #0x${immediate.toString(16).padStart(4, '0').toUpperCase()}`;
    }

    disassembleMemory(instruction) {
        const d = (instruction >>> 13) & 0x1;
        const rd = (instruction >>> 9) & 0xF;
        const rb = (instruction >>> 5) & 0xF;
        const offset = instruction & 0x1F;
        
        if (d === 0) {
            return `LD ${this.registerNames[rd]}, [${this.registerNames[rb]}+0x${offset.toString(16).toUpperCase()}]`;
        } else {
            return `ST ${this.registerNames[rd]}, [${this.registerNames[rb]}+0x${offset.toString(16).toUpperCase()}]`;
        }
    }

    disassembleALU(instruction) {
        const aluOp = (instruction >>> 10) & 0x7;
        
        if (aluOp === 0b111) {
            return this.disassembleShift(instruction);
        }
        
        const rd = (instruction >>> 6) & 0xF;
        const w = (instruction >>> 5) & 0x1;
        const i = (instruction >>> 4) & 0x1;
        const operand = instruction & 0xF;
        
        let opStr = this.aluOps[aluOp];
        let operandStr = i === 0 ? this.registerNames[operand] : `#0x${operand.toString(16).toUpperCase()}`;
        
        // Add 32-bit mode indicator for MUL/DIV
        if (i === 1 && (aluOp === 0b101 || aluOp === 0b110)) {
            opStr += '32';
        }
        
        if (w === 0) {
            switch (aluOp) {
                case 0b000: opStr = 'ANW'; break;
                case 0b001: opStr = 'CMP'; break;
                case 0b010: opStr = 'TBS'; break;
                case 0b100: opStr = 'TBC'; break;
                default: break;
            }
        }
        
        return `${opStr} ${this.registerNames[rd]}, ${operandStr}`;
    }

    // NEW: Disassemble LDS/STS
    disassembleLDSSTS(instruction) {
        const d = (instruction >>> 10) & 0x1;
        const seg = (instruction >>> 8) & 0x3;
        const rd = (instruction >>> 4) & 0xF;
        const rs = instruction & 0xF;
        
        if (d === 0) {
            return `LDS ${this.registerNames[rd]}, ${this.segmentNames[seg]}, ${this.registerNames[rs]}`;
        } else {
            return `STS ${this.registerNames[rd]}, ${this.segmentNames[seg]}, ${this.registerNames[rs]}`;
        }
    }



    disassembleShift(instruction) {
        const rd = (instruction >>> 8) & 0xF;
        const shiftType = (instruction >>> 4) & 0x7;
        const count = instruction & 0xF;
        
        return `${this.shiftOps[shiftType]} ${this.registerNames[rd]}, #0x${count.toString(16).toUpperCase()}`;
    }

    disassembleMOV(instruction) {
        const rd = (instruction >>> 6) & 0xF;
        const rs = (instruction >>> 2) & 0xF;
        const imm = instruction & 0x3;
        
        if (imm === 0) {
            return `MOV ${this.registerNames[rd]}, ${this.registerNames[rs]}`;
        } else {
            return `MOV ${this.registerNames[rd]}, ${this.registerNames[rs]}, #0x${imm.toString(16).toUpperCase()}`;
        }
    }

    disassembleLSI(instruction) {
        const rd = (instruction >>> 5) & 0xF;
        let imm = instruction & 0x1F;
        
        if (imm & 0x10) imm |= 0xFFE0;
        
        const immStr = imm >= 0 ? 
            `#0x${imm.toString(16).toUpperCase()}` : 
            `#-0x${(-imm).toString(16).toUpperCase()}`;
            
        return `LSI ${this.registerNames[rd]}, ${immStr}`;
    }

    disassembleJump(instruction) {
        const condition = (instruction >>> 9) & 0x7;
        let offset = instruction & 0x1FF;
        
        if (offset & 0x100) {
            offset = offset - 0x200;
        }
        
        const conditionName = this.jumpConditions[condition];
        const offsetStr = offset >= 0 ? `+${offset}` : `${offset}`;
        
        return `${conditionName} ${offsetStr}`;
    }

    disassembleJumpWithAddress(instruction, currentAddress) {
        const condition = (instruction >>> 9) & 0x7;
        let offset = instruction & 0x1FF;
        
        if (offset & 0x100) {
            offset = offset - 0x200;
        }
        
        const conditionName = this.jumpConditions[condition];
        const offsetStr = offset >= 0 ? `+${offset}` : `${offset}`;
        const targetAddress = (currentAddress + 1 + offset) & 0xFFFF;
        
        return `${conditionName} ${offsetStr}   ; 0x${targetAddress.toString(16).padStart(4, '0').toUpperCase()}`;
    }
}
