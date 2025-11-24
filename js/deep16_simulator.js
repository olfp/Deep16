// Deep16 Simulator - Complete CPU Execution and State Management with Delay Slot
class Deep16Simulator {
    constructor() {
        // CORRECTED: 2 megawords = 2^20 words = 1,048,576 words of 16-bit memory
        // This equals 2MB × 2 bytes/word = 4MB physical memory
        this.memory = new Array(1048576).fill(0xFFFF); // 1,048,576 words (2MW)
        this.registers = new Array(16).fill(0);
        this.segmentRegisters = { CS: 0, DS: 0, SS: 0, ES: 0 };
        this.shadowRegisters = { PSW: 0, PC: 0, CS: 0 };
        this.psw = 0;
        this.running = false;
        this.lastOperationWasALU = false;
        this.lastALUResult = 0;
        
        // Delay slot implementation
        this.delaySlotActive = false;
        this.delayedPC = 0;
        this.delayedCS = 0;
        this.branchTaken = false;
        
        // Add ALU operations array for debugging
        this.aluOps = ['ADD', 'SUB', 'AND', 'OR', 'XOR', 'MUL', 'DIV', 'SHIFT'];
        this.shiftOps = ['SL', 'SLC', 'SR', 'SRC', 'SRA', 'SAC', 'ROR', 'ROC'];
        this.jumpConditions = ['JZ', 'JNZ', 'JC', 'JNC', 'JN', 'JNN', 'JO', 'JNO'];
        
        // ENHANCED: Track recent memory accesses with segment information
        this.recentMemoryAccess = null;

        // Initialize registers
        this.registers[13] = 0x7FFF; // SP
        this.registers[15] = 0x0000; // PC
        
        // Initialize segment registers with reasonable defaults
        this.segmentRegisters.CS = 0x0000; // Code at bottom of memory
        this.segmentRegisters.DS = 0x1000; // Data segment  
        this.segmentRegisters.SS = 0x8000; // Stack segment
        this.segmentRegisters.ES = 0x2000; // Extra segment

        // Screen memory mapping
        this.SCREEN_MEMORY_START = 0xF1000;
        this.SCREEN_MEMORY_END = 0xF17CF;
        
        // Reference to UI for screen updates (will be set by UI)
        this.ui = null;
    }

    setUI(ui) {
        this.ui = ui;
    }

    loadProgram(memory) {
        // Copy program into memory, but keep the rest as 0xFFFF
        for (let i = 0; i < memory.length; i++) {
            this.memory[i] = memory[i];
        }
        this.registers[15] = 0x0000;
        this.running = false;
    }

    reset() {
        this.registers.fill(0);
        this.registers[13] = 0x7FFF;
        this.registers[15] = 0x0000;
        this.psw = 0;
        this.memory.fill(0xFFFF);
        this.running = false;
        this.lastOperationWasALU = false;
        this.lastALUResult = 0;
        this.segmentRegisters = { CS: 0, DS: 0, SS: 0, ES: 0 };
        this.shadowRegisters = { PSW: 0, PC: 0, CS: 0 };
        
        // Reset delay slot state
        this.delaySlotActive = false;
        this.delayedPC = 0;
        this.delayedCS = 0;
        this.branchTaken = false;
    }

    step() {
        if (!this.running) return false;

        // Handle delay slot if active
        if (this.delaySlotActive) {
            console.log("=== DELAY SLOT EXECUTION ===");
            this.delaySlotActive = false;
            
            // Execute the delay slot instruction
            const delayInstruction = this.memory[this.registers[15]];
            this.executeInstruction(delayInstruction, this.registers[15]);
            
            // Now apply the delayed branch
            if (this.branchTaken) {
                this.registers[15] = this.delayedPC;
                this.segmentRegisters.CS = this.delayedCS;
                console.log(`Delayed branch applied: PC=0x${this.registers[15].toString(16)}, CS=0x${this.segmentRegisters.CS.toString(16)}`);
            }
            
            return true;
        }

        // Normal instruction execution
        const pc = this.registers[15];
        if (pc >= this.memory.length) {
            this.running = false;
            return false;
        }

        const instruction = this.memory[pc];
        
        console.log(`=== STEP: PC=0x${pc.toString(16).padStart(4, '0')} ===`);
        console.log(`Instruction: 0x${instruction.toString(16).padStart(4, '0')}`);
        console.log(`Registers: R0=0x${this.registers[0].toString(16)}, R3=0x${this.registers[3].toString(16)}`);

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

        // Execute instruction and check if it's a branch/jump
        const isBranch = this.executeInstruction(instruction, originalPC);
        
        // Update PSW flags based on the last operation
        this.updatePSWFlags();
        
        console.log(`After step: R0=0x${this.registers[0].toString(16).padStart(4, '0')}, PSW=0x${this.psw.toString(16).padStart(4, '0')}`);
        
        return true;
    }

    /**
     * Execute instruction and return true if it's a branch/jump that uses delay slot
     */
    executeInstruction(instruction, originalPC) {
        try {
            // Check for LDI first (bit 15 = 0)
            if ((instruction & 0x8000) === 0) {
                console.log("Detected LDI instruction (bit 15 = 0)");
                this.executeLDI(instruction);
                return false;
            }
            // Check for LD/ST (opcode bits 15-14 = 10)
            else if (((instruction >>> 14) & 0x3) === 0b10) {
                console.log("Detected LD/ST instruction (opcode 10)");
                this.executeMemoryOp(instruction);
                return false;
            }
            else {
                // Check 3-bit opcodes
                const opcode = (instruction >>> 13) & 0x7;
                console.log(`3-bit opcode: ${opcode.toString(2).padStart(3, '0')} (${opcode})`);
                
                switch (opcode) {
                    case 0b110: // ALU2 (opcode bits 15-13 = 110)
                        console.log("ALU operation");
                        this.executeALUOp(instruction);
                        return false;
                        
                    case 0b111: // Extended (opcode bits 15-13 = 111)
                        console.log("Control flow or extended opcode");
                        if ((instruction >>> 12) === 0b1110) {
                            console.log("Jump instruction");
                            return this.executeJump(instruction, originalPC);
                        } else if ((instruction >>> 11) === 0b11110) {
                            console.log("LDS/STS instruction");
                            this.executeLDSSTS(instruction);
                            return false;
                        } else if ((instruction >>> 10) === 0b111110) {
                            console.log("MOV instruction");
                            this.executeMOV(instruction);
                            return false;
                        } else if ((instruction >>> 9) === 0b1111110) {
                            console.log("LSI instruction");
                            this.executeLSI(instruction);
                            return false;
                        } else if ((instruction >>> 8) === 0b11111110) {
                            console.log("SOP instruction");
                            return this.executeSOP(instruction);
                        } else if ((instruction >>> 7) === 0b111111110) {
                            console.log("MVS instruction");
                            this.executeMVS(instruction);
                            return false;
                        } else if ((instruction >>> 6) === 0b1111111110) {
                            console.log("SMV instruction");
                            this.executeSMV(instruction);
                            return false;
                        } else if ((instruction >>> 3) === 0b1111111111110) {
                            console.log("System instruction");
                            this.executeSystem(instruction);
                            return false;
                        } else {
                            console.warn("Unknown extended opcode");
                            return false;
                        }
                        
                    default:
                        console.warn(`Unknown 3-bit opcode: ${opcode.toString(2).padStart(3, '0')}`);
                        return false;
                }
            }
        } catch (error) {
            this.running = false;
            console.error('Execution error:', error);
            throw error;
        }
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
        // CORRECTED: Use the same bit extraction as the disassembler
        // LD/ST format: [10][d1][Rd4][Rb4][offset5]
        // Bits: 15-14: opcode=10, 13: d, 12-9: Rd, 8-5: Rb, 4-0: offset
        
        const d = (instruction >>> 13) & 0x1;      // Bit 13
        const rd = (instruction >>> 9) & 0xF;      // Bits 12-9  
        const rb = (instruction >>> 5) & 0xF;      // Bits 8-5
        const offset = instruction & 0x1F;         // Bits 4-0

        // Calculate the effective address offset
        const addressOffset = this.registers[rb] + offset;
        
        // Determine which segment register to use based on PSW configuration
        let segmentRegister;
        let segmentName;
        
        // Check if this is a stack access (uses SS segment)
        const isStackAccess = this.isStackRegister(rb);
        
        // Check if this is an extra segment access (uses ES segment)  
        const isExtraAccess = this.isExtraRegister(rb);
        
        if (isStackAccess) {
            segmentRegister = this.segmentRegisters.SS;
            segmentName = 'SS';
        } else if (isExtraAccess) {
            segmentRegister = this.segmentRegisters.ES;
            segmentName = 'ES';
        } else {
            // Default to Data Segment
            segmentRegister = this.segmentRegisters.DS;
            segmentName = 'DS';
        }
        
        // Calculate 20-bit physical address: (segment << 4) + offset
        const physicalAddress = (segmentRegister << 4) + addressOffset;
        
        console.log(`MemoryOp: d=${d}, rd=${rd} (${this.getRegisterName(rd)}), rb=${rb} (${this.getRegisterName(rb)}), offset=${offset}`);
        console.log(`MemoryOp: R${rb}=0x${this.registers[rb].toString(16)}, offset=0x${addressOffset.toString(16)}`);
        console.log(`MemoryOp: Segment=${segmentName} (0x${segmentRegister.toString(16)}), Physical=0x${physicalAddress.toString(16)}`);

        // ENHANCED: Track the memory access with segment information
        this.recentMemoryAccess = {
            address: physicalAddress,
            baseAddress: this.registers[rb],
            offset: offset,
            segment: segmentName,
            segmentValue: segmentRegister,
            type: d === 0 ? 'LD' : 'ST',
            accessedAt: Date.now()
        };
        
        console.log(`Recent memory access: ${this.recentMemoryAccess.type} at ${segmentName}:0x${addressOffset.toString(16).padStart(4, '0')} (physical: 0x${physicalAddress.toString(16).padStart(5, '0')})`);

        if (d === 0) { // LD
            if (physicalAddress < this.memory.length) {
                const value = this.memory[physicalAddress];
                this.registers[rd] = value;
                console.log(`LD: ${this.getRegisterName(rd)} = [${segmentName}:${this.getRegisterName(rb)}+${offset}] = 0x${value.toString(16).padStart(4, '0')}`);
            } else {
                console.warn(`LD: Physical address 0x${physicalAddress.toString(16)} out of bounds`);
            }
        } else { // ST
            if (physicalAddress < this.memory.length) {
                const value = this.registers[rd];
                this.memory[physicalAddress] = value;
                console.log(`ST: [${segmentName}:${this.getRegisterName(rb)}+${offset}] = ${this.getRegisterName(rd)} (0x${value.toString(16).padStart(4, '0')})`);
                
                // Check if this is a screen memory write
                this.checkScreenUpdate(physicalAddress, value);
            } else {
                console.warn(`ST: Physical address 0x${physicalAddress.toString(16)} out of bounds`);
            }
        }
    }

    // Helper method to determine if a register is used for stack access
    isStackRegister(registerIndex) {
        // Get the current stack register selection from PSW bits 6-9
        const srSelection = (this.psw >>> 6) & 0xF;
        
        // Check if dual stack registers are enabled (PSW bit 10)
        const dualStack = (this.psw & (1 << 10)) !== 0;
        
        if (dualStack) {
            // Dual mode: SR and SR+1 are stack registers
            return registerIndex === srSelection || registerIndex === (srSelection + 1);
        } else {
            // Single mode: only SR is stack register
            return registerIndex === srSelection;
        }
    }

    // Helper method to determine if a register is used for extra segment access
    isExtraRegister(registerIndex) {
        // Get the current extra register selection from PSW bits 11-14
        const erSelection = (this.psw >>> 11) & 0xF;
        
        // Check if dual extra registers are enabled (PSW bit 15)
        const dualExtra = (this.psw & (1 << 15)) !== 0;
        
        if (dualExtra) {
            // Dual mode: ER and ER+1 are extra registers
            return registerIndex === erSelection || registerIndex === (erSelection + 1);
        } else {
            // Single mode: only ER is extra register
            return registerIndex === erSelection;
        }
    }

    executeALUOp(instruction) {
        const aluOp = (instruction >>> 10) & 0x7;
        
        // CORRECTED ALU bit extraction:
        const rd = (instruction >>> 6) & 0xF;
        const w = (instruction >>> 5) & 0x1;
        const i = (instruction >>> 4) & 0x1;
        const operand = instruction & 0xF;

        let result;
        let operandValue;

        if (i === 0) {
            operandValue = this.registers[operand];
        } else {
            operandValue = operand;
        }

        const rdValue = this.registers[rd];
        
        // FIXED: Check if aluOp is valid before using it
        const opName = this.aluOps[aluOp] || `ALU${aluOp}`;
        
        console.log(`ALU Execute: op=${opName}, rd=${rd} (${this.getRegisterName(rd)}), w=${w}, i=${i}, operand=${operand}`);
        console.log(`ALU Execute: R${rd}=0x${rdValue.toString(16)}, operand=0x${operandValue.toString(16)}`);
        
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
                console.log(`OR: ${this.getRegisterName(rd)} (0x${rdValue.toString(16)}) | ${i ? '#' : this.getRegisterName(operand)} (0x${operandValue.toString(16)}) = 0x${result.toString(16)}`);
                break;
            case 0b100: // XOR
                result = rdValue ^ operandValue;
                console.log(`XOR: ${this.getRegisterName(rd)} (0x${rdValue.toString(16)}) ^ ${i ? '#' : this.getRegisterName(operand)} (0x${operandValue.toString(16)}) = 0x${result.toString(16)}`);
                break;
            case 0b101: // MUL
                if (i === 1 && rd % 2 === 0) {
                    // 32-bit multiplication: R[rd]:R[rd+1] = rdValue × operandValue
                    const product = rdValue * operandValue;
                    this.registers[rd] = (product >>> 16) & 0xFFFF;     // High word
                    this.registers[rd + 1] = product & 0xFFFF;          // Low word
                    result = product;
                    console.log(`MUL32: ${this.getRegisterName(rd)}:${this.getRegisterName(rd + 1)} = ${this.getRegisterName(rd)} (0x${rdValue.toString(16)}) × ${i ? '#' : this.getRegisterName(operand)} (0x${operandValue.toString(16)}) = 0x${product.toString(16)}`);
                } else {
                    // 16-bit multiplication
                    result = (rdValue * operandValue) & 0xFFFF;
                    console.log(`MUL: ${this.getRegisterName(rd)} (0x${rdValue.toString(16)}) × ${i ? '#' : this.getRegisterName(operand)} (0x${operandValue.toString(16)}) = 0x${result.toString(16)}`);
                }
                break;
            case 0b110: // DIV
                if (operandValue === 0) {
                    console.warn("DIV: Division by zero");
                    result = 0xFFFF; // Handle division by zero
                } else if (i === 1 && rd % 2 === 0) {
                    // 32-bit division: R[rd] = quotient, R[rd+1] = remainder
                    const dividend = (this.registers[rd] << 16) | this.registers[rd + 1];
                    const quotient = Math.floor(dividend / operandValue);
                    const remainder = dividend % operandValue;
                    this.registers[rd] = quotient & 0xFFFF;
                    this.registers[rd + 1] = remainder & 0xFFFF;
                    result = quotient;
                    console.log(`DIV32: ${this.getRegisterName(rd)}:${this.getRegisterName(rd + 1)} / ${i ? '#' : this.getRegisterName(operand)} (0x${operandValue.toString(16)}) = Q:0x${quotient.toString(16)} R:0x${remainder.toString(16)}`);
                } else {
                    // 16-bit division
                    result = Math.floor(rdValue / operandValue);
                    const remainder = rdValue % operandValue;
                    this.registers[rd + 1] = remainder & 0xFFFF; // Store remainder in next register
                    console.log(`DIV: ${this.getRegisterName(rd)} (0x${rdValue.toString(16)}) / ${i ? '#' : this.getRegisterName(operand)} (0x${operandValue.toString(16)}) = Q:0x${result.toString(16)} R:0x${remainder.toString(16)}`);
                }
                break;
            case 0b111: // SHIFT
                this.executeShift(instruction);
                return; // Shift handles its own result storage
            default: 
                result = rdValue;
                console.warn(`Unimplemented ALU op: ${aluOp}`);
        }

        if (w === 1 && aluOp !== 0b101 && aluOp !== 0b110) { // MUL/DIV handle writing separately
            this.registers[rd] = result & 0xFFFF;
            console.log(`ALU Write: ${this.getRegisterName(rd)} = 0x${this.registers[rd].toString(16).padStart(4, '0')}`);
        }

        // Store result for PSW flag calculation
        this.lastALUResult = result;
        this.lastOperationWasALU = true;
    }

    executeShift(instruction) {
        const rd = (instruction >>> 6) & 0xF;
        const shiftType = (instruction >>> 4) & 0x7;
        const count = instruction & 0xF;
        
        const value = this.registers[rd];
        let result = value;
        
        console.log(`Shift Execute: type=${this.shiftOps[shiftType]}, rd=${this.getRegisterName(rd)}, count=${count}, value=0x${value.toString(16)}`);
        
        switch (shiftType) {
            case 0b000: // SL - Shift Left
                result = (value << count) & 0xFFFF;
                break;
            case 0b001: // SLC - Shift Left with Carry
                result = (value << count) & 0xFFFF;
                // Carry out is the bit shifted out from the left
                if (count > 0) {
                    const carryOut = (value >>> (16 - count)) & 0x1;
                    this.psw = (this.psw & ~0x8) | (carryOut << 3);
                }
                break;
            case 0b010: // SR - Shift Right Logical
                result = (value >>> count) & 0xFFFF;
                break;
            case 0b011: // SRC - Shift Right with Carry
                result = (value >>> count) & 0xFFFF;
                // Carry out is the bit shifted out from the right
                if (count > 0) {
                    const carryOut = (value >>> (count - 1)) & 0x1;
                    this.psw = (this.psw & ~0x8) | (carryOut << 3);
                }
                break;
            case 0b100: // SRA - Shift Right Arithmetic
                // Arithmetic right shift preserves sign bit
                const sign = value & 0x8000;
                result = (value >>> count) | (sign ? (0xFFFF << (16 - count)) : 0);
                break;
            case 0b101: // SAC - Shift Arithmetic with Carry
                const signBit = value & 0x8000;
                result = (value >>> count) | (signBit ? (0xFFFF << (16 - count)) : 0);
                if (count > 0) {
                    const carryOut = (value >>> (count - 1)) & 0x1;
                    this.psw = (this.psw & ~0x8) | (carryOut << 3);
                }
                break;
            case 0b110: // ROR - Rotate Right
                result = ((value >>> count) | (value << (16 - count))) & 0xFFFF;
                break;
            case 0b111: // ROC - Rotate with Carry
                const carryIn = (this.psw >>> 3) & 0x1;
                result = ((value >>> count) | (value << (17 - count)) | (carryIn << (16 - count))) & 0xFFFF;
                // New carry is the bit that rotated out
                const newCarry = (value >>> (count - 1)) & 0x1;
                this.psw = (this.psw & ~0x8) | (newCarry << 3);
                break;
        }
        
        this.registers[rd] = result;
        this.lastALUResult = result;
        this.lastOperationWasALU = true;
        
        console.log(`Shift Complete: ${this.getRegisterName(rd)} = 0x${result.toString(16).padStart(4, '0')}`);
    }

    executeMOV(instruction) {
        // MOV encoding: [111110][Rd4][Rs4][imm2]
        // Bits: 15-10: opcode=111110, 9-6: Rd, 5-2: Rs, 1-0: imm
        
        const rd = (instruction >>> 6) & 0xF;      // Bits 9-6
        const rs = (instruction >>> 2) & 0xF;      // Bits 5-2  
        const imm = instruction & 0x3;             // Bits 1-0
        
        console.log(`=== MOV DEBUG ===`);
        console.log(`Instruction: 0x${instruction.toString(16).padStart(4, '0')}`);
        console.log(`Binary: ${instruction.toString(2).padStart(16, '0')}`);
        console.log(`Extracted: rd=${rd}, rs=${rs}, imm=${imm}`);
        console.log(`Before: R${rd}=0x${this.registers[rd].toString(16)}, R${rs}=0x${this.registers[rs].toString(16)}`);
        
        // FIXED: Use the VALUE of register rs, not the register index
        this.registers[rd] = this.registers[rs] + imm;
        
        console.log(`After: R${rd}=0x${this.registers[rd].toString(16)}`);
        console.log(`Calculation: R${rd} = R${rs} (0x${this.registers[rs].toString(16)}) + ${imm}`);
        
        this.lastALUResult = this.registers[rd];
        this.lastOperationWasALU = true;
    }

    executeLSI(instruction) {
        // LSI encoding: [1111110][Rd4][imm5]
        // Bits: 15-9: opcode=1111110, 8-5: Rd, 4-0: imm5
        
        const rd = (instruction >>> 5) & 0xF;      // Bits 8-5
        let imm = instruction & 0x1F;              // Bits 4-0
        
        // Sign extend 5-bit value
        if (imm & 0x10) {
            imm |= 0xFFE0; // Extend sign for negative numbers
        }
        
        console.log(`LSI Execute: rd=${rd} (${this.getRegisterName(rd)}), imm=${imm} (0x${imm.toString(16)})`);
        
        this.registers[rd] = imm;
        
        console.log(`LSI Execute: ${this.getRegisterName(rd)} = ${this.registers[rd]} (0x${this.registers[rd].toString(16).padStart(4, '0')})`);
        
        this.lastALUResult = imm;
        this.lastOperationWasALU = true;
    }

    executeJump(instruction, originalPC) {
        const condition = (instruction >>> 9) & 0x7;
        let offset = instruction & 0x1FF;
        
        // PROPER 9-bit sign extension
        if (offset & 0x100) {
            offset = offset - 0x200; // Convert to proper signed integer
        }
        
        let shouldJump = false;
        
        console.log(`Jump: condition=${condition}, offset=${offset} (signed), Z-flag=${!!(this.psw & (1 << 1))}`);
        
        switch (condition) {
            case 0b000: shouldJump = (this.psw & (1 << 1)) !== 0; break; // JZ (Zero=1)
            case 0b001: shouldJump = (this.psw & (1 << 1)) === 0; break; // JNZ (Zero=0)
            case 0b010: shouldJump = (this.psw & (1 << 3)) !== 0; break; // JC (Carry=1)
            case 0b011: shouldJump = (this.psw & (1 << 3)) === 0; break; // JNC (Carry=0)
            case 0b100: shouldJump = (this.psw & (1 << 0)) !== 0; break; // JN (Negative=1)
            case 0b101: shouldJump = (this.psw & (1 << 0)) === 0; break; // JNN (Negative=0)
            case 0b110: shouldJump = (this.psw & (1 << 2)) !== 0; break; // JO (Overflow=1)
            case 0b111: shouldJump = (this.psw & (1 << 2)) === 0; break; // JNO (Overflow=0)
        }

        console.log(`Jump decision: ${shouldJump ? 'TAKEN' : 'NOT TAKEN'}`);

        if (shouldJump) {
            // Calculate target address but don't jump yet
            const targetPC = this.registers[15] + offset;
            
            // Set up delay slot
            this.delaySlotActive = true;
            this.delayedPC = targetPC & 0xFFFF;
            this.delayedCS = this.segmentRegisters.CS; // Same CS segment
            this.branchTaken = true;
            
            console.log(`JUMP: Delay slot activated - will jump to 0x${this.delayedPC.toString(16)} after next instruction`);
        } else {
            // Branch not taken, no delay slot needed
            this.branchTaken = false;
        }
        
        return true; // This is a branch instruction
    }

    executeSOP(instruction) {
        const type4 = (instruction >>> 4) & 0xF;
        const rx = instruction & 0xF;
        
        console.log(`SOP Execute: type4=${type4.toString(2)}, rx=${rx} (${this.getRegisterName(rx)})`);
        
        switch (type4) {
            case 0b0000: // SWB - Swap Bytes
                const value = this.registers[rx];
                this.registers[rx] = ((value & 0xFF) << 8) | ((value >>> 8) & 0xFF);
                console.log(`SWB: ${this.getRegisterName(rx)} = 0x${this.registers[rx].toString(16).padStart(4, '0')}`);
                this.lastALUResult = this.registers[rx];
                this.lastOperationWasALU = true;
                return false;
                
            case 0b0001: // INV - Invert bits
                this.registers[rx] = ~this.registers[rx] & 0xFFFF;
                console.log(`INV: ${this.getRegisterName(rx)} = 0x${this.registers[rx].toString(16).padStart(4, '0')}`);
                this.lastALUResult = this.registers[rx];
                this.lastOperationWasALU = true;
                return false;
                
            case 0b0010: // NEG - Two's complement
                this.registers[rx] = (~this.registers[rx] + 1) & 0xFFFF;
                console.log(`NEG: ${this.getRegisterName(rx)} = 0x${this.registers[rx].toString(16).padStart(4, '0')}`);
                this.lastALUResult = this.registers[rx];
                this.lastOperationWasALU = true;
                return false;
                
            case 0b0100: // JML - Jump Long
                return this.executeJML(rx); // Now returns true
                
            case 0b1000: // SRS - Stack Register Single
                this.psw = (this.psw & ~0x03C0) | (rx << 6);
                console.log(`SRS: Stack Register = R${rx}, PSW = 0x${this.psw.toString(16)}`);
                return false;
                
            case 0b1001: // SRD - Stack Register Dual
                this.psw = (this.psw & ~0x03C0) | (rx << 6) | 0x0400;
                console.log(`SRD: Stack Register Dual = R${rx}, PSW = 0x${this.psw.toString(16)}`);
                return false;
                
            case 0b1010: // ERS - Extra Register Single
                this.psw = (this.psw & ~0x7800) | (rx << 11);
                console.log(`ERS: Extra Register = R${rx}, PSW = 0x${this.psw.toString(16)}`);
                return false;
                
            case 0b1011: // ERD - Extra Register Dual
                this.psw = (this.psw & ~0x7800) | (rx << 11) | 0x8000;
                console.log(`ERD: Extra Register Dual = R${rx}, PSW = 0x${this.psw.toString(16)}`);
                return false;
                
            case 0b1100: // SET - Set PSW flags
                const setFlags = instruction & 0xF;
                this.psw |= setFlags;
                console.log(`SET: PSW flags 0x${setFlags.toString(16)} set, PSW = 0x${this.psw.toString(16)}`);
                return false;
                
            case 0b1101: // CLR - Clear PSW flags
                const clrFlags = instruction & 0xF;
                this.psw &= ~clrFlags;
                console.log(`CLR: PSW flags 0x${clrFlags.toString(16)} cleared, PSW = 0x${this.psw.toString(16)}`);
                return false;
                
            case 0b1110: // SET2 - Set upper PSW bits
                const set2Flags = (instruction & 0xF) << 4;
                this.psw |= set2Flags;
                console.log(`SET2: PSW bits 0x${set2Flags.toString(16)} set, PSW = 0x${this.psw.toString(16)}`);
                return false;
                
            case 0b1111: // CLR2 - Clear upper PSW bits
                const clr2Flags = (instruction & 0xF) << 4;
                this.psw &= ~clr2Flags;
                console.log(`CLR2: PSW bits 0x${clr2Flags.toString(16)} cleared, PSW = 0x${this.psw.toString(16)}`);
                return false;
                
            default:
                console.warn(`Unimplemented SOP instruction: type4=${type4.toString(2)}`);
                return false;
        }
    }

    executeJML(rx) {
        // JML Rx: CS = R[Rx], PC = R[Rx+1]
        // rx must be even (0,2,4,6,8,10,12,14)
        
        if (rx % 2 !== 0) {
            console.warn(`JML requires even register, got R${rx}`);
            return false;
        }
        
        const targetCS = this.registers[rx];
        const targetPC = this.registers[rx + 1];
        
        console.log(`JML Execute: R${rx}=0x${targetCS.toString(16)} (CS), R${rx+1}=0x${targetPC.toString(16)} (PC)`);
        
        // Set up delay slot for JML
        this.delaySlotActive = true;
        this.delayedPC = targetPC & 0xFFFF;
        this.delayedCS = targetCS & 0xFFFF;
        this.branchTaken = true;
        
        console.log(`JML: Delay slot activated - will jump to CS=0x${targetCS.toString(16)}, PC=0x${targetPC.toString(16)} after next instruction`);
        
        return true; // This is a branch instruction
    }

    executeMVS(instruction) {
        // MVS: [111111110][d1][Rd4][seg2]
        const d = (instruction >>> 6) & 0x1;
        const rd = (instruction >>> 2) & 0xF;
        const seg = instruction & 0x3;
        
        const segNames = ['CS', 'DS', 'SS', 'ES'];
        
        console.log(`MVS Execute: d=${d}, rd=${this.getRegisterName(rd)}, seg=${segNames[seg]}`);
        
        if (d === 0) {
            // Rd ← Sx (read from segment register)
            switch (seg) {
                case 0: this.registers[rd] = this.segmentRegisters.CS; break;
                case 1: this.registers[rd] = this.segmentRegisters.DS; break;
                case 2: this.registers[rd] = this.segmentRegisters.SS; break;
                case 3: this.registers[rd] = this.segmentRegisters.ES; break;
            }
            console.log(`MVS: ${this.getRegisterName(rd)} = ${segNames[seg]} (0x${this.registers[rd].toString(16)})`);
        } else {
            // Sx ← Rd (write to segment register)
            switch (seg) {
                case 0: this.segmentRegisters.CS = this.registers[rd]; break;
                case 1: this.segmentRegisters.DS = this.registers[rd]; break;
                case 2: this.segmentRegisters.SS = this.registers[rd]; break;
                case 3: this.segmentRegisters.ES = this.registers[rd]; break;
            }
            console.log(`MVS: ${segNames[seg]} = ${this.getRegisterName(rd)} (0x${this.registers[rd].toString(16)})`);
        }
    }

    executeSMV(instruction) {
        // SMV: [1111111110][src2][Rd4]
        const src2 = (instruction >>> 4) & 0x3;
        const rd = instruction & 0xF;
        
        const srcNames = ['APC', 'APSW', 'PSW', 'ACS'];
        
        console.log(`SMV Execute: src=${srcNames[src2]}, rd=${this.getRegisterName(rd)}, S-bit=${!!(this.psw & (1 << 5))}`);
        
        // Check S-bit to determine current context
        const inShadowView = !!(this.psw & (1 << 5));
        
        switch (src2) {
            case 0: // APC - Alternate PC (non-active context PC)
                if (inShadowView) {
                    // In shadow view: APC = normal context PC (current PC)
                    this.registers[rd] = this.registers[15];
                    console.log(`SMV: ${this.getRegisterName(rd)} = APC = PC(normal) = 0x${this.registers[rd].toString(16)}`);
                } else {
                    // In normal view: APC = shadow context PC (PC')
                    this.registers[rd] = this.shadowRegisters.PC;
                    console.log(`SMV: ${this.getRegisterName(rd)} = APC = PC'(shadow) = 0x${this.registers[rd].toString(16)}`);
                }
                break;
                
            case 1: // APSW - Alternate PSW (non-active context PSW)
                if (inShadowView) {
                    // In shadow view: APSW = normal context PSW (current PSW)
                    this.registers[rd] = this.psw;
                    console.log(`SMV: ${this.getRegisterName(rd)} = APSW = PSW(normal) = 0x${this.registers[rd].toString(16)}`);
                } else {
                    // In normal view: APSW = shadow context PSW (PSW')
                    this.registers[rd] = this.shadowRegisters.PSW;
                    console.log(`SMV: ${this.getRegisterName(rd)} = APSW = PSW'(shadow) = 0x${this.registers[rd].toString(16)}`);
                }
                break;
                
            case 2: // PSW - Current context PSW
                if (inShadowView) {
                    // In shadow view: PSW = PSW' (shadow PSW)
                    this.registers[rd] = this.shadowRegisters.PSW;
                    console.log(`SMV: ${this.getRegisterName(rd)} = PSW = PSW'(shadow) = 0x${this.registers[rd].toString(16)}`);
                } else {
                    // In normal view: PSW = current PSW
                    this.registers[rd] = this.psw;
                    console.log(`SMV: ${this.getRegisterName(rd)} = PSW = PSW(normal) = 0x${this.registers[rd].toString(16)}`);
                }
                break;
                
            case 3: // ACS - Alternate CS (non-active context CS)
                if (inShadowView) {
                    // In shadow view: ACS = normal context CS (current CS)
                    this.registers[rd] = this.segmentRegisters.CS;
                    console.log(`SMV: ${this.getRegisterName(rd)} = ACS = CS(normal) = 0x${this.registers[rd].toString(16)}`);
                } else {
                    // In normal view: ACS = shadow context CS (CS')
                    this.registers[rd] = this.shadowRegisters.CS;
                    console.log(`SMV: ${this.getRegisterName(rd)} = ACS = CS'(shadow) = 0x${this.registers[rd].toString(16)}`);
                }
                break;
        }
    }

    executeLDSSTS(instruction) {
        // LDS/STS: [11110][d][seg2][Rd4][Rs4]
        const d = (instruction >>> 10) & 0x1;
        const seg = (instruction >>> 8) & 0x3;
        const rd = (instruction >>> 4) & 0xF;
        const rs = instruction & 0xF;
        
        const segNames = ['CS', 'DS', 'SS', 'ES'];
        const address = this.registers[rs];
        
        console.log(`LDS/STS Execute: d=${d}, seg=${segNames[seg]}, rd=${this.getRegisterName(rd)}, rs=${this.getRegisterName(rs)}, address=0x${address.toString(16)}`);
        
        // Note: In the current flat memory model, segment doesn't affect the physical address
        if (d === 0) { // LDS
            if (address < this.memory.length) {
                this.registers[rd] = this.memory[address];
                console.log(`LDS: ${this.getRegisterName(rd)} = [${segNames[seg]}:${this.getRegisterName(rs)}] = 0x${this.registers[rd].toString(16)}`);
            }
        } else { // STS
            if (address < this.memory.length) {
                this.memory[address] = this.registers[rd];
                console.log(`STS: [${segNames[seg]}:${this.getRegisterName(rs)}] = ${this.getRegisterName(rd)} (0x${this.registers[rd].toString(16)})`);
                
                // Check if this is a screen memory write
                this.checkScreenUpdate(address, this.registers[rd]);
            }
        }
    }

    executeSystem(instruction) {
        const sysOp = instruction & 0x7;
        
        console.log(`System Execute: op=${sysOp}, PSW=0x${this.psw.toString(16)}, S-bit=${!!(this.psw & (1 << 5))}`);
        
        switch (sysOp) {
            case 0b000: // NOP
                console.log("NOP: No operation");
                break;
            case 0b001: // HLT
                this.running = false;
                console.log("HLT: Processor halted");
                break;
            case 0b010: // SWI - Software Interrupt
                this.executeSWI();
                break;
            case 0b011: // RETI - Return from Interrupt
                this.executeRETI();
                break;
            default:
                console.warn(`Unknown system operation: ${sysOp}`);
        }
    }

    /**
     * Execute Software Interrupt with proper context switching
     */
    executeSWI() {
        console.log("SWI: Software interrupt - switching to shadow context");
        
        // Check if interrupts are enabled
        if (!(this.psw & (1 << 4))) {
            console.warn("SWI: Interrupts disabled, ignoring software interrupt");
            return;
        }
        
        // According to section 4: Only PSW is copied to PSW'
        this.shadowRegisters.PSW = this.psw;
        
        console.log(`SWI: PSW' = PSW = 0x${this.shadowRegisters.PSW.toString(16)}`);
        
        // Switch to shadow view: PSW.S ← 1, PSW.I ← 0
        this.psw = (this.psw & ~(1 << 4)) | (1 << 5); // Clear I-bit, set S-bit
        
        // Interrupts run in Segment 0 with new PC
        this.segmentRegisters.CS = 0x0000; // Interrupts run in Segment 0
        this.registers[15] = 0x0004;      // SWI vector at offset 4
        
        console.log(`SWI: Jump to CS=0x${this.segmentRegisters.CS.toString(16)}, PC=0x${this.registers[15].toString(16)}, PSW=0x${this.psw.toString(16)}`);
        console.log(`SWI: Now in shadow context - accessing PC', CS', PSW' views`);
        
        // In a pipelined implementation, this would flush the pipeline
        this.flushPipeline();
    }

    /**
     * Execute Return from Interrupt with context restoration
     */
    executeRETI() {
        console.log("RETI: Return from interrupt - switching to normal context");
        
        // Simply switch back to normal view (clear S-bit)
        // No register copying - pure view switching
        this.psw = this.psw & ~(1 << 5); // Clear S-bit
        
        console.log(`RETI: Switched to normal context - accessing PC, CS, PSW views`);
        console.log(`RETI: PSW=0x${this.psw.toString(16)}, PC=0x${this.registers[15].toString(16)}, CS=0x${this.segmentRegisters.CS.toString(16)}`);
        
        // In a pipelined implementation, this would flush the pipeline
        this.flushPipeline();
    }

    checkScreenUpdate(address, value) {
        if (address >= this.SCREEN_MEMORY_START && address <= this.SCREEN_MEMORY_END) {
            console.log(`Screen memory updated: address=0x${address.toString(16)}, value=0x${value.toString(16)}`);
            
            // Use the existing screen UI method
            if (this.ui && this.ui.screenUI && typeof this.ui.screenUI.handleScreenMemoryWrite === 'function') {
                this.ui.screenUI.handleScreenMemoryWrite(address, value);
            }
        }
    }

    /**
     * Handle hardware interrupt with proper context switching
     * @param {number} vector - Interrupt vector address
     */
    handleHardwareInterrupt(vector) {
        // Check if interrupts are enabled and not already in interrupt context
        if (!(this.psw & (1 << 4)) || (this.psw & (1 << 5))) {
            console.log(`Hardware interrupt ignored: I=${!!(this.psw & (1 << 4))}, S=${!!(this.psw & (1 << 5))}`);
            return false;
        }
        
        console.log(`Hardware interrupt: vector=0x${vector.toString(16)}`);
        
        // According to section 4: Only PSW is copied to PSW'
        this.shadowRegisters.PSW = this.psw;
        
        console.log(`Hardware interrupt: PSW' = PSW = 0x${this.shadowRegisters.PSW.toString(16)}`);
        
        // Switch to shadow view: PSW.S ← 1, PSW.I ← 0
        this.psw = (this.psw & ~(1 << 4)) | (1 << 5); // Clear I-bit, set S-bit
        
        // Hardware interrupts run in Segment 0
        this.segmentRegisters.CS = 0x0000; // Hardware interrupts run in segment 0
        this.registers[15] = vector;
        
        console.log(`Hardware interrupt: Jump to CS=0x${this.segmentRegisters.CS.toString(16)}, PC=0x${this.registers[15].toString(16)}, PSW=0x${this.psw.toString(16)}`);
        console.log(`Hardware interrupt: Now in shadow context - accessing PC', CS', PSW' views`);
        
        // In a pipelined implementation, this would flush the pipeline
        this.flushPipeline();
        
        return true;
    }

    /**
     * Simulate pipeline flush (for context switches)
     */
    flushPipeline() {
        console.log("Pipeline flushed due to context switch");
        // In a real implementation, this would clear pipeline stages
        // For this simulator, we just log it since we're not modeling pipeline stages
    }

    updatePSWFlags() {
        if (!this.lastOperationWasALU) return;
        
        this.psw &= 0xFFF0; // Clear standard flags (keep system bits)
        
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

    // ENHANCED: Method to get expanded memory view with segment info
    getRecentMemoryView() {
        if (!this.recentMemoryAccess) {
            return null;
        }
        
        const access = this.recentMemoryAccess;
        
        // RULE 2: If access is via LD/ST with non-zero offset, display from base address
        let startAddress;
        if (access.offset !== 0) {
            startAddress = access.baseAddress;
        } else {
            // RULE 1: Otherwise, center on the accessed address
            startAddress = Math.max(0, access.address - 8);
        }
        
        // Ensure we show exactly 32 words (4 lines of 8)
        startAddress = Math.max(0, startAddress);
        startAddress = Math.min(startAddress, this.memory.length - 32);
        
        const memoryView = [];
        
        // Get 32 words (4 lines of 8)
        for (let i = 0; i < 32; i++) {
            const addr = startAddress + i;
            if (addr < this.memory.length) {
                const isCurrent = (addr === access.address);
                const isBase = (access.offset !== 0 && addr === access.baseAddress);
                
                memoryView.push({
                    address: addr,
                    value: this.memory[addr],
                    isCurrent: isCurrent,
                    isBase: isBase,
                    isInRange: true
                });
            }
        }
        
        return {
            baseAddress: startAddress,
            memoryWords: memoryView,
            accessInfo: access,
            segmentInfo: {
                name: access.segment,
                value: access.segmentValue,
                physicalAddress: access.address
            }
        };
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

    /**
     * Method to check if we're in interrupt context
     */
    isInInterruptContext() {
        return !!(this.psw & (1 << 5));
    }

    /**
     * Method to get current context information for debugging
     */
    getContextInfo() {
        const inShadowView = this.isInInterruptContext();
        return {
            view: inShadowView ? "Shadow" : "Normal",
            S_bit: inShadowView,
            I_bit: !!(this.psw & (1 << 4)),
            PC: inShadowView ? this.shadowRegisters.PC : this.registers[15],
            CS: inShadowView ? this.shadowRegisters.CS : this.segmentRegisters.CS,
            PSW: inShadowView ? this.shadowRegisters.PSW : this.psw,
            shadowPC: this.shadowRegisters.PC,
            shadowCS: this.shadowRegisters.CS,
            shadowPSW: this.shadowRegisters.PSW
        };
    }
}
