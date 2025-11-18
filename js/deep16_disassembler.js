/* deep16_disassembler.js - FINAL CORRECTED VERSION */
class Deep16Disassembler {
    constructor() {
        this.registerNames = ['R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','FP','SP','LR','PC'];
        this.aluOps = ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'MUL', 'DIV', 'SHIFT'];
        this.shiftOps = ['SL', 'SLC', 'SR', 'SRC', 'SRA', 'SAC', 'ROR', 'ROC'];
        this.jumpConditions = ['JMP', 'JZ', 'JNZ', 'JC', 'JNC', 'JN', 'JNN', 'JO'];
        this.systemOps = ['NOP', 'HLT', 'SWI', 'RETI', '', '', '', ''];
    }

    disassemble(instruction) {
        // Check for HALT first (0xFFFF)
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

    disassembleLDI(instruction) {
        const immediate = instruction & 0x7FFF;
        return `LDI #0x${immediate.toString(16).padStart(4, '0').toUpperCase()}`;
    }

    disassembleMemory(instruction) {
        // LD/ST format: [10][d1][Rd4][Rb4][offset5]
        // CORRECTED BIT POSITIONS:
        // Bits: 15-14: opcode=10, 13: d, 12-9: Rd, 8-5: Rb, 4-0: offset
        const d = (instruction >>> 12) & 0x1;      // Bit 13
        const rd = (instruction >>> 8) & 0xF;      // Bits 12-9  
        const rb = (instruction >>> 4) & 0xF;      // Bits 8-5  ← FIXED!
        const offset = instruction & 0x1F;         // Bits 4-0
        
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
        
        const rd = (instruction >>> 8) & 0xF;
        const w = (instruction >>> 7) & 0x1;
        const i = (instruction >>> 6) & 0x1;
        const operand = instruction & 0xF;
        
        let opStr = this.aluOps[aluOp];
        let operandStr = i === 0 ? this.registerNames[operand] : `#0x${operand.toString(16).toUpperCase()}`;
        
        if (w === 0) {
            const flagOps = ['ANW', 'CMP', 'TBS', 'TBC', '', '', '', ''];
            opStr = flagOps[aluOp] || opStr;
        }
        
        return `${opStr} ${this.registerNames[rd]}, ${operandStr}`;
    }

    disassembleShift(instruction) {
        const rd = (instruction >>> 8) & 0xF;
        const shiftType = (instruction >>> 4) & 0x7;
        const count = instruction & 0xF;
        
        return `${this.shiftOps[shiftType]} ${this.registerNames[rd]}, #0x${count.toString(16).toUpperCase()}`;
    }

    disassembleControlFlow(instruction) {
        // Check for MOV first (opcode bits 15-10 = 111110)
        if ((instruction >>> 10) === 0b111110) {
            return this.disassembleMOV(instruction);
        }
        
        // Check for LSI (opcode bits 15-9 = 1111110)
        if ((instruction >>> 9) === 0b1111110) {
            return this.disassembleLSI(instruction);
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
        const offset = instruction & 0x1FF;
        const signedOffset = (offset & 0x100) ? (offset | 0xFE00) : offset;
        
        const offsetStr = signedOffset >= 0 ? 
            `+0x${signedOffset.toString(16).toUpperCase()}` : 
            `-0x${(-signedOffset).toString(16).toUpperCase()}`;
            
        return `${this.jumpConditions[condition]} ${offsetStr}`;
    }

    disassembleSystem(instruction) {
        const sysOp = instruction & 0x7;
        return this.systemOps[sysOp] || 'SYS';
    }
}
