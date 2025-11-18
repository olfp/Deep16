// Deep16 Simulator - CPU Execution and State Management
class Deep16Simulator {
    constructor() {
        this.memory = new Array(65536).fill(0xFFFF); // Initialize with 0xFFFF
        this.registers = new Array(16).fill(0);
        this.segmentRegisters = { CS: 0, DS: 0, SS: 0, ES: 0 };
        this.shadowRegisters = { PSW: 0, PC: 0, CS: 0 };
        this.psw = 0;
        this.running = false;
        this.lastOperationWasALU = false;
        this.lastALUResult = 0;
        
        // Initialize registers
        this.registers[13] = 0x7FFF; // SP
        this.registers[15] = 0x0000; // PC
        
        // Don't call initializeTestMemory here - keep memory clean
    }

    reset() {
        this.registers.fill(0);
        this.registers[13] = 0x7FFF;
        this.registers[15] = 0x0000;
        this.psw = 0;
        this.memory.fill(0xFFFF); // Reset to all 0xFFFF
        this.running = false;
        this.lastOperationWasALU = false;
        this.lastALUResult = 0;
        
        // Don't call initializeTestMemory here either
    }

    // Optional: Only call this when you specifically want test data
    initializeTestMemory() {
        // Initialize with some test data but preserve 0xFFFF for unused areas
        for (let i = 0; i < 256; i++) {
            this.memory[i] = (i * 0x111) & 0xFFFF;
        }
        // Set some recognizable patterns
        this.memory[0x0000] = 0x7FFF; // LDI 32767
        this.memory[0x0001] = 0x8010; // LD R1, [R0+0]
        this.memory[0x0002] = 0x3120; // ADD R1, R2
    }
}
    step() {
        if (!this.running) return false;

        const pc = this.registers[15];
        if (pc >= this.memory.length) {
            this.running = false;
            return false;
        }

        const instruction = this.memory[pc];
        
        console.log(`Step: PC=0x${pc.toString(16).padStart(4, '0')}, Instruction=0x${instruction.toString(16).padStart(4, '0')}`);
        
        // Check for HALT (0xFFFF) first
        if (instruction === 0xFFFF) {
            console.log("HALT instruction detected - stopping execution");
            this.running = false;
            return false;
        }
        
        // Store PC before execution for jump calculations
        const originalPC = pc;
        
        // Increment PC by 1 (word addressing)
        this.registers[15] += 1;

        // Reset ALU tracking
        this.lastOperationWasALU = false;
        this.lastALUResult = 0;

        // Decode and execute instruction
        try {
            // Check for LDI first (bit 15 = 0)
            if ((instruction & 0x8000) === 0) {
                console.log("Detected LDI instruction (bit 15 = 0)");
                this.executeLDI(instruction);
            } else {
                const opcode = (instruction >> 13) & 0x7;
                console.log(`Non-LDI opcode: ${opcode.toString(2)} (${opcode})`);
                
                switch (opcode) {
                    case 0b100: 
                        console.log("Memory operation");
                        this.executeMemoryOp(instruction); 
                        break;
                    case 0b110:
                        console.log("ALU operation");
                        this.executeALUOp(instruction); 
                        break;
                    case 0b111: 
                        console.log("Control flow or extended opcode");
                        if ((instruction >> 12) === 0b1110) {
                            console.log("Jump instruction");
                            this.executeJump(instruction, originalPC);
                        } else if ((instruction >> 10) === 0b111110) {
                            console.log("MOV instruction");
                            this.executeMOV(instruction);
                        } else if ((instruction >> 9) === 0b1111110) {
                            console.log("LSI instruction");
                            this.executeLSI(instruction);
                        } else if ((instruction >> 13) === 0b11111) {
                            console.log("System instruction");
                            this.executeSystem(instruction);
                        } else {
                            console.warn("Unknown extended opcode");
                        }
                        break;
                    default:
                        console.warn(`Unknown opcode: ${opcode.toString(2)}`);
                }
            }
        } catch (error) {
            this.running = false;
            console.error('Execution error:', error);
            throw error;
        }

        // Update PSW flags based on the last operation
        this.updatePSWFlags();
        
        console.log(`After step: R0=0x${this.registers[0].toString(16).padStart(4, '0')}, PSW=0x${this.psw.toString(16).padStart(4, '0')}`);
        
        return true;
    }

    executeLDI(instruction) {
        const immediate = instruction & 0x7FFF;
        console.log(`LDI executing: immediate = 0x${immediate.toString(16).padStart(4, '0')}`);
        this.registers[0] = immediate; // LDI always loads into R0
        
        // Set flags for LDI operation
        this.lastALUResult = immediate;
        this.lastOperationWasALU = true;
        
        console.log(`LDI complete: R0 = 0x${this.registers[0].toString(16).padStart(4, '0')}`);
    }

    executeMemoryOp(instruction) {
        const d = (instruction >> 12) & 0x1;
        const rd = (instruction >> 8) & 0xF;
        const rb = (instruction >> 4) & 0xF;
        const offset = instruction & 0x1F;

        const address = this.registers[rb] + offset;

        if (d === 0) { // LD
            if (address < this.memory.length) {
                this.registers[rd] = this.memory[address];
                console.log(`LD: ${this.getRegisterName(rd)} = memory[0x${address.toString(16).padStart(4, '0')}] = 0x${this.memory[address].toString(16).padStart(4, '0')}`);
            }
        } else { // ST
            if (address < this.memory.length) {
                this.memory[address] = this.registers[rd];
                console.log(`ST: memory[0x${address.toString(16).padStart(4, '0')}] = ${this.getRegisterName(rd)} = 0x${this.registers[rd].toString(16).padStart(4, '0')}`);
            }
        }
    }

    executeALUOp(instruction) {
        const aluOp = (instruction >> 10) & 0x7;
        const rd = (instruction >> 8) & 0xF;
        const w = (instruction >> 7) & 0x1;
        const i = (instruction >> 6) & 0x1;
        const operand = instruction & 0xF;

        let result;
        let operandValue;

        if (i === 0) {
            operandValue = this.registers[operand];
        } else {
            operandValue = operand;
        }

        const rdValue = this.registers[rd];
        
        switch (aluOp) {
            case 0b000: // ADD
                result = rdValue + operandValue;
                console.log(`ADD: ${this.getRegisterName(rd)} (0x${rdValue.toString(16)}) + ${i ? '#' : this.getRegisterName(operand)} (0x${operandValue.toString(16)}) = 0x${result.toString(16)}`);
                break;
            case 0b001: // SUB
                result = rdValue - operandValue;
                console.log(`SUB: ${this.getRegisterName(rd)} (0x${rdValue.toString(16)}) - ${i ? '#' : this.getRegisterName(operand)} (0x${operandValue.toString(16)}) = 0x${result.toString(16)}`);
                break;
            case 0b010: // AND
                result = rdValue & operandValue;
                console.log(`AND: ${this.getRegisterName(rd)} (0x${rdValue.toString(16)}) & ${i ? '#' : this.getRegisterName(operand)} (0x${operandValue.toString(16)}) = 0x${result.toString(16)}`);
                break;
            case 0b011: // OR
                result = rdValue | operandValue;
                break;
            case 0b100: // XOR
                result = rdValue ^ operandValue;
                break;
            default: 
                result = rdValue;
                console.warn(`Unimplemented ALU op: ${aluOp}`);
        }

        if (w === 1) {
            this.registers[rd] = result & 0xFFFF;
        }

        // Store result for PSW flag calculation
        this.lastALUResult = result;
        this.lastOperationWasALU = true;
    }

    executeMOV(instruction) {
        const rd = (instruction >> 8) & 0xF;
        const rs = (instruction >> 4) & 0xF;
        const imm = instruction & 0x3;
        this.registers[rd] = this.registers[rs] + imm;
        console.log(`MOV: ${this.getRegisterName(rd)} = ${this.getRegisterName(rs)} + ${imm} = 0x${this.registers[rd].toString(16)}`);
        this.lastALUResult = this.registers[rd];
        this.lastOperationWasALU = true;
    }

    executeLSI(instruction) {
        const rd = (instruction >> 8) & 0xF;
        let imm = (instruction >> 4) & 0x1F;
        if (imm & 0x10) imm |= 0xFFE0; // Sign extend 5-bit value
        this.registers[rd] = imm;
        console.log(`LSI: ${this.getRegisterName(rd)} = ${imm} (0x${imm.toString(16)})`);
        this.lastALUResult = imm;
        this.lastOperationWasALU = true;
    }

    executeJump(instruction, originalPC) {
        const condition = (instruction >> 9) & 0x7;
        let offset = instruction & 0x1FF;
        if (offset & 0x100) offset |= 0xFE00; // Sign extend 9-bit value

        let shouldJump = false;
        switch (condition) {
            case 0b000: shouldJump = true; break; // JMP (unconditional)
            case 0b001: shouldJump = (this.psw & (1 << 1)) !== 0; break; // JZ
            case 0b010: shouldJump = (this.psw & (1 << 1)) === 0; break; // JNZ
            case 0b011: shouldJump = (this.psw & (1 << 3)) !== 0; break; // JC
            case 0b100: shouldJump = (this.psw & (1 << 3)) === 0; break; // JNC
            case 0b101: shouldJump = (this.psw & (1 << 0)) !== 0; break; // JN
            case 0b110: shouldJump = (this.psw & (1 << 0)) === 0; break; // JNN
            case 0b111: shouldJump = (this.psw & (1 << 2)) !== 0; break; // JO
        }

        if (shouldJump) {
            // Adjust PC: we already incremented it, so subtract 1 then add offset
            this.registers[15] = (this.registers[15] - 1) + offset;
            console.log(`JUMP: PC = 0x${this.registers[15].toString(16).padStart(4, '0')} (offset=${offset})`);
        }
    }

    executeSystem(instruction) {
        const sysOp = instruction & 0x7;
        switch (sysOp) {
            case 0b001: // HLT (old encoding)
                this.running = false;
                console.log('HLT: Processor halted');
                break;
            case 0b011: // RETI
                console.log("RETI executed");
                // Simple RETI implementation
                break;
            default:
                console.log(`SYS: op=${sysOp}`);
        }
    }

    updatePSWFlags() {
        if (!this.lastOperationWasALU) return;
        
        this.psw = 0; // Reset flags
        
        if (this.lastALUResult !== undefined) {
            const result = this.lastALUResult & 0xFFFF;
            const signedResult = this.lastALUResult & 0x8000 ? this.lastALUResult - 0x10000 : this.lastALUResult;
            
            // Zero flag
            if (result === 0) this.psw |= (1 << 1);
            
            // Negative flag (sign bit)
            if (result & 0x8000) this.psw |= (1 << 0);
            
            // Carry flag (unsigned overflow)
            if (this.lastALUResult > 0xFFFF || this.lastALUResult < 0) {
                this.psw |= (1 << 3);
            }
            
            // Overflow flag (signed overflow) - simplified
            if (signedResult > 32767 || signedResult < -32768) {
                this.psw |= (1 << 2);
            }
        }
        
        this.lastOperationWasALU = false;
        console.log(`PSW updated: 0x${this.psw.toString(16).padStart(4, '0')} (N=${!!(this.psw & 1)}, Z=${!!(this.psw & 2)}, V=${!!(this.psw & 4)}, C=${!!(this.psw & 8)})`);
    }

    getRegisterName(regIndex) {
        const names = ['R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','FP','SP','LR','PC'];
        return names[regIndex] || `R${regIndex}`;
    }

    getState() {
        return {
            registers: [...this.registers],
            memory: [...this.memory],
            psw: this.psw,
            segmentRegisters: { ...this.segmentRegisters },
            shadowRegisters: { ...this.shadowRegisters },
            running: this.running
        };
    }
}
