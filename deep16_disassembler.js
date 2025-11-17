/* deep16_disassembler.js */
class Deep16Disassembler {
    constructor() {
        this.registerNames = ['R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','FP','SP','LR','PC'];
        this.aluOps = ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'MUL', 'DIV', 'SHIFT'];
        this.shiftOps = ['SL', 'SLC', 'SR', 'SRC', 'SRA', 'SAC', 'ROR', 'ROC'];
        this.jumpConditions = ['JZ', 'JNZ', 'JC', 'JNC', 'JN', 'JNN', 'JO', 'JNO'];
        this.systemOps = ['NOP', 'HLT', 'SWI', 'RETI', '', '', '', ''];
    }

    disassemble(instruction) {
        if (instruction === 0) return 'NOP';
        
        const opcode = (instruction >> 13) & 0x7;
        
        switch (opcode) {
            case 0b000: 
                return this.disassembleLDI(instruction);
            case 0b100: 
                return this.disassembleMemory(instruction);
            case 0b110:
                return this.disassembleALU(instruction);
            case 0b111: 
                return this.disassembleControlFlow(instruction);
            default: 
                return `??? (0x${instruction.toString(16).padStart(4, '0')})`;
        }
    }

    disassembleLDI(instruction) {
        const immediate = instruction & 0x7FFF;
        return `LDI #${immediate}`;
    }

    disassembleMemory(instruction) {
        const d = (instruction >> 12) & 0x1;
        const rd = (instruction >> 8) & 0xF;
        const rb = (instruction >> 4) & 0xF;
        const offset = instruction & 0x1F;
        
        if (d === 0) {
            return `LD ${this.registerNames[rd]}, [${this.registerNames[rb]}+${offset}]`;
        } else {
            return `ST ${this.registerNames[rd]}, [${this.registerNames[rb]}+${offset}]`;
        }
    }

    disassembleALU(instruction) {
        const aluOp = (instruction >> 10) & 0x7;
        
        if (aluOp === 0b111) {
            return this.disassembleShift(instruction);
        }
        
        const rd = (instruction >> 8) & 0xF;
        const w = (instruction >> 7) & 0x1;
        const i = (instruction >> 6) & 0x1;
        const operand = instruction & 0xF;
        
        let opStr = this.aluOps[aluOp];
        let operandStr = i === 0 ? this.registerNames[operand] : `#${operand}`;
        
        if (w === 0) {
            const flagOps = ['ANW', 'CMP', 'TBS', 'TBC', '', '', '', ''];
            opStr = flagOps[aluOp] || opStr;
        }
        
        return `${opStr} ${this.registerNames[rd]}, ${operandStr}`;
    }

    disassembleShift(instruction) {
        const rd = (instruction >> 8) & 0xF;
        const shiftType = (instruction >> 4) & 0x7;
        const count = instruction & 0xF;
        
        return `${this.shiftOps[shiftType]} ${this.registerNames[rd]}, #${count}`;
    }

    disassembleControlFlow(instruction) {
        if ((instruction >> 12) === 0b1110) {
            return this.disassembleJump(instruction);
        }
        
        if ((instruction >> 10) === 0b111110) {
            return this.disassembleMOV(instruction);
        }
        
        if ((instruction >> 9) === 0b1111110) {
            return this.disassembleLSI(instruction);
        }
        
        if ((instruction >> 13) === 0b11111) {
            return this.disassembleSystem(instruction);
        }
        
        return '???';
    }

    disassembleJump(instruction) {
        const condition = (instruction >> 9) & 0x7;
        const offset = instruction & 0x1FF;
        const signedOffset = (offset & 0x100) ? (offset | 0xFE00) : offset;
        return `${this.jumpConditions[condition]} ${signedOffset}`;
    }

    disassembleMOV(instruction) {
        const rd = (instruction >> 8) & 0xF;
        const rs = (instruction >> 4) & 0xF;
        const imm = instruction & 0x3;
        return `MOV ${this.registerNames[rd]}, ${this.registerNames[rs]}, ${imm}`;
    }

    disassembleLSI(instruction) {
        const rd = (instruction >> 8) & 0xF;
        let imm = (instruction >> 4) & 0x1F;
        if (imm & 0x10) imm |= 0xFFE0;
        return `LSI ${this.registerNames[rd]}, ${imm}`;
    }

    disassembleSystem(instruction) {
        const sysOp = instruction & 0x7;
        return this.systemOps[sysOp] || 'SYS';
    }
}
/* deep16_disassembler.js */
