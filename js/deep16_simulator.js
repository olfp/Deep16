// Deep16 Simulator - Complete CPU Execution and State Management with Delay Slot
class Deep16Simulator {
    constructor() {
        // CORRECTED: 2 megawords = 2^20 words = 1,048,576 words of 16-bit memory
        // This equals 2MB × 2 bytes/word = 4MB physical memory
        this.memory = new Array(1048576).fill(0xFFFF); // 1,048,576 words (2MW)
        this.registers = new Array(16).fill(0);
        this.segmentRegisters = { CS: 0xFFFF, DS: 0x0000, SS: 0x0000, ES: 0x0000 };
        this.shadowRegisters = { PSW: 0, PC: 0, CS: 0, DS: 0, SS: 0, ES: 0, R0: 0, R1: 0, R2: 0, R13: 0, R14: 0 };
        this.psw = 0;
        this.running = false;
        this.lastOperationWasALU = false;
        this.lastALUResult = 0;
        
        // Delay slot implementation
        this.delaySlotActive = false;
        this.delayedPC = 0;
        this.delayedCS = 0;
        this.branchTaken = false;
        this.delayedToShadow = false;
        
        
        
        // ENHANCED: Track recent memory accesses with segment information
        this.recentMemoryAccess = null;

        // Initialize registers
        this.registers[13] = 0x7FFF; // SP
        this.registers[15] = 0x0000; // PC
        
        // Initialize segment registers for ROM-first reset
        this.segmentRegisters.CS = 0xFFFF; // Execute from ROM segment
        this.segmentRegisters.DS = 0x1000; // Data segment  
        this.segmentRegisters.SS = 0x8000; // Stack segment
        this.segmentRegisters.ES = 0x2000; // Extra segment

        // Screen memory mapping
        this.SCREEN_MEMORY_START = 0xF1000;
        this.SCREEN_MEMORY_END = 0xF17CF;
        
        // Reference to UI for screen updates (will be set by UI)
        this.ui = null;

        // Performance optimization: Precompute register names
        this.registerNames = ['R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11','FP','SP','LR','PC'];

        // Keyboard controller (PS/2 simplified)
        this.ioBase = 0xF0000;
        this.KBD_STATUS_ADDR = this.ioBase + 0x0060;
        this.KBD_DATA_ADDR = this.ioBase + 0x0062;
        this.kbdBuffer = [];
        this.kbdLastData = 0;
    }

    setUI(ui) {
        this.ui = ui;
    }

    loadProgram(memory) {
        // Copy program into memory, but keep the rest as 0xFFFF
        for (let i = 0; i < memory.length; i++) {
            this.memory[i] = memory[i];
        }
        // Autoload ROM at 0xFFF0
        this.autoloadROM();
        this.registers[15] = 0x0000;
        this.running = false;
    }

    reset() {
        this.registers.fill(0);
        this.psw = 0;
        this.memory.fill(0xFFFF);
        this.running = false;
        this.lastOperationWasALU = false;
        this.lastALUResult = 0;
        this.segmentRegisters = { CS: 0xFFFF, DS: 0x0000, SS: 0x0000, ES: 0x0000 };
        this.shadowRegisters = { PSW: 0, PC: 0, CS: 0, DS: 0, SS: 0, ES: 0, R0: 0, R1: 0, R2: 0, R13: 0, R14: 0 };
        
        // Reset delay slot state
        this.delaySlotActive = false;
        this.delayedPC = 0;
        this.delayedCS = 0;
        this.branchTaken = false;

        // Autoload ROM at 0xFFF0
        this.autoloadROM();

        // Reset keyboard buffer
        this.kbdBuffer = [];
        this.kbdLastData = 0;
    }

    phys(seg, off) {
        return ((seg << 4) + (off & 0xFFFF)) >>> 0;
    }

    autoloadROM() {
        const base = 0xFFFF0;
        const rom = [
            0x0000, // LDI 0 -> R0
            0xFF41, // MVS DS, R0
            0xFF42, // MVS SS, R0 (ensure SS=0 so ST with R0 base uses physical 0x0000)
            0xFC21, // LSI R1, 1
            0xD818, // ROL R1, 8
            0xA200, // ST R1, [R0+0]
            0xA201, // ST R1, [R0+1]
            0xA202, // ST R1, [R0+2]
            0xFFE0, // JML R0
            0xFFF0, // NOP (delay slot)
            0xFFF1, // HLT
            0xFFF1, // HLT
            0xFFF1, // HLT
            0xFFF1, // HLT
            0xFFF1, // HLT
            0xFFF1, // HLT
        ];
        for (let i = 0; i < rom.length; i++) {
            const addr = base + i;
            if (addr < this.memory.length) {
                this.memory[addr] = rom[i];
            }
        }
    }

    step() {
        if (!this.running) return false;

        const inShadow = (this.psw & (1 << 5)) !== 0;
        // Handle delay slot if active
        if (this.delaySlotActive) {
            this.delaySlotActive = false;
            const activeCS = inShadow ? (this.shadowRegisters.CS & 0xFFFF) : (this.segmentRegisters.CS & 0xFFFF);
            const activePC = inShadow ? (this.shadowRegisters.PC & 0xFFFF) : (this.registers[15] & 0xFFFF);
            const paDelay = this.phys(activeCS, activePC);
            const delayInstruction = this.memory[paDelay];
            this.executeInstruction(delayInstruction, activePC);
            if (inShadow) { this.shadowRegisters.PC = (this.shadowRegisters.PC + 1) & 0xFFFF; } else { this.registers[15] = (this.registers[15] + 1) & 0xFFFF; }
            if (this.branchTaken) {
                if (this.delayedToShadow) { this.shadowRegisters.PC = this.delayedPC & 0xFFFF; this.shadowRegisters.CS = this.delayedCS & 0xFFFF; }
                else { this.registers[15] = this.delayedPC & 0xFFFF; this.segmentRegisters.CS = this.delayedCS & 0xFFFF; }
            }
            return true;
        }

        // Normal instruction execution
        const pc = (inShadow ? this.shadowRegisters.PC : this.registers[15]) & 0xFFFF;
        const pa = this.phys((inShadow ? this.shadowRegisters.CS : this.segmentRegisters.CS) & 0xFFFF, pc);
        if (pa >= this.memory.length) {
            this.running = false;
            return false;
        }

        const instruction = this.memory[pa];
        
        

        if (instruction === 0xFFFF || instruction === 0xFFF1) {
            this.running = false;
            return false;
        }
        
        // Store PC before execution for jump calculations
        const originalPC = pc;
        
        // Increment PC by 1 (word addressing)
        if (inShadow) { this.shadowRegisters.PC = (this.shadowRegisters.PC + 1) & 0xFFFF; } else { this.registers[15] = (this.registers[15] + 1) & 0xFFFF; }

        // Reset ALU tracking
        this.lastOperationWasALU = false;
        this.lastALUResult = 0;

        // Execute instruction and check if it's a branch/jump
        const isBranch = this.executeInstruction(instruction, originalPC);
        
        // Update PSW flags based on the last operation
        this.updatePSWFlags();
        
        
        
        return true;
    }

    /**
     * Execute instruction and return true if it's a branch/jump that uses delay slot
     */
    executeInstruction(instruction, originalPC) {
        // Track original PC for MOV link/architectural reads
        this.lastOriginalPCForExec = originalPC & 0xFFFF;
        try {
            // Check for LDI first (bit 15 = 0)
            if ((instruction & 0x8000) === 0) {
                this.executeLDI(instruction);
                return false;
            }
            // Check for LD/ST (opcode bits 15-14 = 10)
            else if (((instruction >>> 14) & 0x3) === 0b10) {
                this.executeMemoryOp(instruction);
                return false;
            }
            else {
                // Check 3-bit opcodes
                const opcode = (instruction >>> 13) & 0x7;
                // console.log(`3-bit opcode: ${opcode.toString(2).padStart(3, '0')} (${opcode})`);
                
                switch (opcode) {
                    case 0b110: // ALU2 (opcode bits 15-13 = 110)
                        // console.log("ALU operation");
                        this.executeALUOp(instruction);
                        return false;
                        
                    case 0b111: // Extended (opcode bits 15-13 = 111)
                        // console.log("Control flow or extended opcode");
                        if ((instruction >>> 12) === 0b1110) {
                            // console.log("Jump instruction");
                            return this.executeJump(instruction, originalPC);
                        } else if ((instruction >>> 11) === 0b11110) {
                            // console.log("LDS/STS instruction");
                            this.executeLDSSTS(instruction);
                            return false;
                        } else if ((instruction >>> 10) === 0b111110) {
                            const isBranch = this.executeMOV(instruction);
                            return isBranch;
                        } else if ((instruction >>> 9) === 0b1111110) {
                            // console.log("LSI instruction");
                            this.executeLSI(instruction);
                            return false;
                        } else if ((instruction >>> 8) === 0b11111110) {
                            this.executeSMV(instruction);
                            return false;
                        } else if ((instruction >>> 7) === 0b111111110) {
                            // console.log("MVS instruction");
                            this.executeMVS(instruction);
                            return false;
                        } else if ((instruction >>> 6) === 0b1111111110) {
                            return this.executeSOP(instruction);
                        } else if ((instruction >>> 5) === 0b11111111110) {
                            this.executeSetClr(instruction);
                            return false;
                        } else if ((instruction >>> 4) === 0b111111111110) {
                            const rx = instruction & 0xF;
                            return this.executeJML(rx);
                        } else if ((instruction >>> 3) === 0b1111111111110) {
                            // console.log("System instruction");
                            this.executeSystem(instruction);
                            return false;
                        } else {
                            // console.warn("Unknown extended opcode");
                            return false;
                        }
                        
                    default:
                        // console.warn(`Unknown 3-bit opcode: ${opcode.toString(2).padStart(3, '0')}`);
                        return false;
                }
            }
        } catch (error) {
            this.running = false;
            // console.error('Execution error:', error);
            throw error;
        }
    }

    executeLDI(instruction) {
        let immediate = instruction & 0x7FFF;
        if (immediate & 0x4000) {
            immediate |= 0x8000; // sign-extend 15-bit to 16-bit
        }
        this.registers[0] = immediate & 0xFFFF;
        this.lastALUResult = this.registers[0];
        this.lastOperationWasALU = true;
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
        
        const inShadow = (this.psw & (1 << 5)) !== 0;
        const segs = inShadow ? this.shadowRegisters : this.segmentRegisters;
        if (isStackAccess) {
            segmentRegister = segs.SS;
            segmentName = 'SS';
        } else if (isExtraAccess) {
            segmentRegister = segs.ES;
            segmentName = 'ES';
        } else {
            // Default to Data Segment
            segmentRegister = segs.DS;
            segmentName = 'DS';
        }
        
        // Calculate 20-bit physical address: (segment << 4) + offset
        const physicalAddress = (segmentRegister << 4) + addressOffset;
        
        // console.log(`MemoryOp: d=${d}, rd=${rd} (${this.getRegisterName(rd)}), rb=${rb} (${this.getRegisterName(rb)}), offset=${offset}`);
        // console.log(`MemoryOp: R${rb}=0x${this.registers[rb].toString(16)}, offset=0x${addressOffset.toString(16)}`);
        // console.log(`MemoryOp: Segment=${segmentName} (0x${segmentRegister.toString(16)}), Physical=0x${physicalAddress.toString(16)}`);

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
        
        // console.log(`Recent memory access: ${this.recentMemoryAccess.type} at ${segmentName}:0x${addressOffset.toString(16).padStart(4, '0')} (physical: 0x${physicalAddress.toString(16).padStart(5, '0')})`);

        if (d === 0) { // LD
            if (physicalAddress < this.memory.length) {
                const value = this.memory[physicalAddress];
                this.registers[rd] = value;
                // console.log(`LD: ${this.getRegisterName(rd)} = [${segmentName}:${this.getRegisterName(rb)}+${offset}] = 0x${value.toString(16).padStart(4, '0')}`);
            } else {
                // console.warn(`LD: Physical address 0x${physicalAddress.toString(16)} out of bounds`);
            }
        } else { // ST
            if (physicalAddress < this.memory.length) {
                const value = this.registers[rd];
                this.memory[physicalAddress] = value;
                // console.log(`ST: [${segmentName}:${this.getRegisterName(rb)}+${offset}] = ${this.getRegisterName(rd)} (0x${value.toString(16).padStart(4, '0')})`);
                
                // Check if this is a screen memory write
                this.checkScreenUpdate(physicalAddress, value);
            } else {
                // console.warn(`ST: Physical address 0x${physicalAddress.toString(16)} out of bounds`);
            }
        }
    }

    // Helper method to determine if a register is used for stack access
    isStackRegister(registerIndex) {
        const srSelection = (this.psw >>> 6) & 0xF;
        const dualStack = (this.psw & (1 << 10)) !== 0;
        if (srSelection === 0) return false;
        return dualStack
            ? (registerIndex === srSelection || registerIndex === (srSelection + 1))
            : (registerIndex === srSelection);
    }

    // Helper method to determine if a register is used for extra segment access
    isExtraRegister(registerIndex) {
        const erSelection = (this.psw >>> 11) & 0xF;
        const dualExtra = (this.psw & (1 << 15)) !== 0;
        if (erSelection === 0) return false;
        return dualExtra
            ? (registerIndex === erSelection || registerIndex === (erSelection + 1))
            : (registerIndex === erSelection);
    }

    executeALUOp(instruction) {
        const func5 = (instruction >>> 8) & 0x1F;
        const rd = (instruction >>> 4) & 0xF;
        const low4 = instruction & 0xF;
        const rdValue = this.registers[rd] & 0xFFFF;
        let result = rdValue;
        const cbit = (this.psw >>> 3) & 0x1;
        const sign = (rdValue & 0x8000) !== 0 ? 1 : 0;
        const isReg = func5 === 0b00000 || func5 === 0b00010 || func5 === 0b00100 || func5 === 0b00110 || func5 === 0b01000 || func5 === 0b01010 || func5 === 0b01100 || func5 === 0b01110 || func5 >= 0b11100;
        const opVal = isReg ? (this.registers[low4] & 0xFFFF) : (low4 & 0xF);
        switch (func5) {
            case 0b00000: result = (rdValue + opVal) & 0x1FFFF; break;
            case 0b00001: result = (rdValue + opVal) & 0x1FFFF; break;
            case 0b00010: result = (rdValue - opVal) | 0; break;
            case 0b00011: result = (rdValue - opVal) | 0; break;
            case 0b00100: result = (rdValue - opVal) | 0; this.lastALUResult = result; this.lastOperationWasALU = true; return; 
            case 0b00101: result = (rdValue - opVal) | 0; this.lastALUResult = result; this.lastOperationWasALU = true; return;
            case 0b00110: result = (rdValue & opVal) & 0xFFFF; break;
            case 0b00111: result = (rdValue & opVal) & 0xFFFF; break;
            case 0b01000: {
                const masked = (rdValue & opVal) & 0xFFFF;
                this.lastALUResult = masked === 0 ? 0 : 1;
                this.lastOperationWasALU = true;
                return;
            }
            case 0b01001: {
                const bit = (rdValue >>> opVal) & 0x1;
                this.lastALUResult = bit === 0 ? 1 : 0;
                this.lastOperationWasALU = true;
                return;
            }
            case 0b01010: result = (rdValue | opVal) & 0xFFFF; break;
            case 0b01011: result = (rdValue | opVal) & 0xFFFF; break;
            case 0b01100: result = (rdValue ^ opVal) & 0xFFFF; break;
            case 0b01101: result = (rdValue ^ opVal) & 0xFFFF; break;
            case 0b01110: {
                const masked = (rdValue & opVal) & 0xFFFF;
                this.lastALUResult = masked !== 0 ? 1 : 0;
                this.lastOperationWasALU = true;
                return;
            }
            case 0b01111: {
                const bit = (rdValue >>> opVal) & 0x1;
                this.lastALUResult = bit === 1 ? 1 : 0;
                this.lastOperationWasALU = true;
                return;
            }
            case 0b10000: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (16 - count)) & 0x1) : 0;
                result = (rdValue << count) & 0xFFFF;
                this.psw = (this.psw & ~0x8) | (carryOut << 3);
                break;
            }
            case 0b10001: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (16 - count)) & 0x1) : 0;
                result = ((rdValue << count) & 0x7FFF) | (sign ? 0x8000 : 0);
                this.psw = (this.psw & ~0x8) | (carryOut << 3);
                break;
            }
            case 0b10010: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (16 - count)) & 0x1) : 0;
                const carryFill = count > 0 ? (cbit << (count - 1)) : 0;
                result = ((rdValue << count) & 0x7FFF) | (sign ? 0x8000 : 0) | carryFill;
                this.psw = (this.psw & ~0x8) | (carryOut << 3);
                break;
            }
            case 0b10011: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (16 - count)) & 0x1) : 0;
                const carryFill = count > 0 ? (cbit << (count - 1)) : 0;
                result = ((rdValue << count) & 0xFFFF) | carryFill;
                this.psw = (this.psw & ~0x8) | (carryOut << 3);
                break;
            }
            case 0b10100: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (count - 1)) & 0x1) : 0;
                result = rdValue >>> count;
                this.psw = (this.psw & ~0x8) | (carryOut << 3);
                break;
            }
            case 0b10101: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (count - 1)) & 0x1) : 0;
                const carryFill = count > 0 ? (cbit << (15 - count)) : 0;
                result = (rdValue >>> count) | carryFill;
                this.psw = (this.psw & ~0x8) | (carryOut << 3);
                break;
            }
            case 0b10110: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (count - 1)) & 0x1) : 0;
                const signMask = sign ? 0xFFFF << (16 - count) : 0;
                result = (rdValue >>> count) | (signMask & 0xFFFF);
                this.psw = (this.psw & ~0x8) | (carryOut << 3);
                break;
            }
            case 0b10111: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (count - 1)) & 0x1) : 0;
                const signMask = sign ? 0xFFFF << (16 - count) : 0;
                const carryFill = count > 0 ? (cbit << (15 - count)) : 0;
                result = (rdValue >>> count) | (signMask & 0xFFFF) | carryFill;
                this.psw = (this.psw & ~0x8) | (carryOut << 3);
                break;
            }
            case 0b11000: {
                const count = opVal & 0xF;
                result = ((rdValue << count) | (rdValue >>> (16 - count))) & 0xFFFF;
                break;
            }
            case 0b11001: {
                const count = opVal & 0xF;
                const carryFill = count > 0 ? (cbit << (count - 1)) : 0;
                result = ((rdValue << count) | (rdValue >>> (16 - count)) | carryFill) & 0xFFFF;
                break;
            }
            case 0b11010: {
                const count = opVal & 0xF;
                result = ((rdValue >>> count) | (rdValue << (16 - count))) & 0xFFFF;
                break;
            }
            case 0b11011: {
                const count = opVal & 0xF;
                const carryFill = count > 0 ? (cbit << (15 - count)) : 0;
                result = ((rdValue >>> count) | (rdValue << (16 - count)) | carryFill) & 0xFFFF;
                const newCarry = count > 0 ? ((rdValue >>> (count - 1)) & 0x1) : cbit;
                this.psw = (this.psw & ~0x8) | (newCarry << 3);
                break;
            }
            case 0b11100: {
                result = (rdValue * opVal) & 0xFFFF;
                this.registers[rd] = result & 0xFFFF;
                break;
            }
            case 0b11101: {
                const product = (rdValue * opVal) >>> 0;
                this.registers[rd] = (product >>> 16) & 0xFFFF;
                this.registers[rd + 1] = product & 0xFFFF;
                result = product;
                break;
            }
            case 0b11110: {
                if (opVal === 0) { result = 0xFFFF; break; }
                const q = Math.floor(rdValue / opVal) & 0xFFFF;
                this.registers[rd] = q;
                result = q;
                break;
            }
            case 0b11111: {
                if (opVal === 0) { result = 0xFFFF; break; }
                const dividend = ((this.registers[rd] << 16) | this.registers[rd + 1]) >>> 0;
                const q = Math.floor(dividend / opVal) & 0xFFFF;
                const r = (dividend % opVal) & 0xFFFF;
                this.registers[rd] = q;
                this.registers[rd + 1] = r;
                result = q;
                break;
            }
            default: break;
        }
        this.registers[rd] = result & 0xFFFF;
        this.lastALUResult = result;
        this.lastOperationWasALU = true;
    }

    

    executeMOV(instruction) {
        // MOV encoding: [111110][Rd4][Rs4][imm2]
        // Bits: 15-10: opcode=111110, 9-6: Rd, 5-2: Rs, 1-0: imm
        
        const rd = (instruction >>> 6) & 0xF;
        const rs = (instruction >>> 2) & 0xF;
        const imm = instruction & 0x3;

        let value;
        if (imm === 0) {
            value = this.registers[rs];
        } else if (rs === 15 && imm === 2) {
            // Standard link: use original PC context
            value = (this.lastOriginalPCForExec + 2) & 0xFFFF;
        } else if (rs === 15 && imm === 3) {
            value = (this.lastOriginalPCForExec + 1) & 0xFFFF;
        } else if (imm === 3) {
            // Architectural read bypass: do not add immediate
            value = this.registers[rs];
        } else {
            value = (this.registers[rs] + imm) & 0xFFFF;
        }

        // If destination is PC, treat as jump with delay slot
        if (rd === 15) {
            const inShadow = (this.psw & (1 << 5)) !== 0;
            this.delaySlotActive = true;
            this.delayedPC = value & 0xFFFF;
            this.delayedCS = inShadow ? (this.shadowRegisters.CS & 0xFFFF) : (this.segmentRegisters.CS & 0xFFFF);
            this.delayedToShadow = inShadow;
            this.branchTaken = true;
            this.lastALUResult = value;
            this.lastOperationWasALU = true;
            return true;
        }

        this.registers[rd] = value;
        
        this.lastALUResult = this.registers[rd];
        this.lastOperationWasALU = true;
        return false;
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
        
        // console.log(`LSI Execute: rd=${rd} (${this.getRegisterName(rd)}), imm=${imm} (0x${imm.toString(16)})`);
        
        this.registers[rd] = imm;
        
        // console.log(`LSI Execute: ${this.getRegisterName(rd)} = ${this.registers[rd]} (0x${this.registers[rd].toString(16).padStart(4, '0')})`);
        
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
        
        // console.log(`Jump: condition=${condition}, offset=${offset} (signed), Z-flag=${!!(this.psw & (1 << 1))}`);
        
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

        // console.log(`Jump decision: ${shouldJump ? 'TAKEN' : 'NOT TAKEN'}`);

        if (shouldJump) {
            const inShadow = (this.psw & (1 << 5)) !== 0;
            const currentPC = inShadow ? (this.shadowRegisters.PC & 0xFFFF) : (this.registers[15] & 0xFFFF);
            const targetPC = (currentPC + offset) & 0xFFFF;
            // Immediate branch, no delay slot for conditional jumps
            if (inShadow) {
                this.shadowRegisters.PC = targetPC;
            } else {
                this.registers[15] = targetPC;
            }
            this.branchTaken = true;
        } else {
            this.branchTaken = false;
        }
        return false;
    }

    executeSOP(instruction) {
        const type2 = (instruction >>> 4) & 0x3;
        const rx = instruction & 0xF;

        switch (type2) {
            case 0b00: // INV
                this.registers[rx] = (~this.registers[rx]) & 0xFFFF;
                this.lastALUResult = this.registers[rx];
                this.lastOperationWasALU = true;
                return false;
            case 0b01: // NEG
                this.registers[rx] = (~this.registers[rx] + 1) & 0xFFFF;
                this.lastALUResult = this.registers[rx];
                this.lastOperationWasALU = true;
                return false;
            case 0b10: // SPSW
                this.psw = this.registers[rx] & 0xFFFF;
                return false;
            case 0b11: // LPSW
                this.executeLPSW(instruction);
                return false;
            default:
                return false;
        }
    }

    executeSetClr(instruction) {
        const d = (instruction >>> 4) & 0x1;
        const imm = instruction & 0xF;
        if (imm === 4) return;
        const mask = (1 << imm) & 0xFFFF;
        if (d === 0) {
            this.psw |= mask;
        } else {
            this.psw &= ~mask;
        }
    }

    executeJML(rx) {
        // JML Rx: CS = R[Rx], PC = R[Rx+1]
        // rx must be even (0,2,4,6,8,10,12,14)
        
        if (rx % 2 !== 0) {
            // console.warn(`JML requires even register, got R${rx}`);
            return false;
        }
        
        const targetCS = this.registers[rx];
        const targetPC = this.registers[rx + 1];
        
        // console.log(`JML Execute: R${rx}=0x${targetCS.toString(16)} (CS), R${rx+1}=0x${targetPC.toString(16)} (PC)`);
        
        // Set up delay slot for JML
        const inShadow = (this.psw & (1 << 5)) !== 0;
        this.delaySlotActive = true;
        this.delayedPC = targetPC & 0xFFFF;
        this.delayedCS = targetCS & 0xFFFF;
        this.delayedToShadow = inShadow;
        this.branchTaken = true;
        
        // console.log(`JML: Delay slot activated - will jump to CS=0x${targetCS.toString(16)}, PC=0x${targetPC.toString(16)} after next instruction`);
        
        return true; // This is a branch instruction
    }

    executeMVS(instruction) {
        // MVS: [111111110][d1][Rd4][seg2]
        const d = (instruction >>> 6) & 0x1;
        const rd = (instruction >>> 2) & 0xF;
        const seg = instruction & 0x3;
        
        const segNames = ['CS', 'DS', 'SS', 'ES'];
        const inShadow = (this.psw & (1 << 5)) !== 0;
        const segs = inShadow ? this.shadowRegisters : this.segmentRegisters;
        if (d === 0) {
            switch (seg) {
                case 0: this.registers[rd] = segs.CS; break;
                case 1: this.registers[rd] = segs.DS; break;
                case 2: this.registers[rd] = segs.SS; break;
                case 3: this.registers[rd] = segs.ES; break;
            }
        } else {
            switch (seg) {
                case 0: segs.CS = this.registers[rd] & 0xFFFF; break;
                case 1: segs.DS = this.registers[rd] & 0xFFFF; break;
                case 2: segs.SS = this.registers[rd] & 0xFFFF; break;
                case 3: segs.ES = this.registers[rd] & 0xFFFF; break;
            }
        }
    }

    executeSMV(instruction) {
        const rx = (instruction >>> 4) & 0xF;
        const alt = instruction & 0xF;
        const inShadowView = !!(this.psw & (1 << 5));
        switch (alt) {
            case 0b0000:
                this.registers[rx] = inShadowView ? (this.segmentRegisters.CS & 0xFFFF) : (this.shadowRegisters.CS & 0xFFFF);
                break;
            case 0b0001:
                this.registers[rx] = inShadowView ? (this.segmentRegisters.DS & 0xFFFF) : (this.shadowRegisters.DS & 0xFFFF);
                break;
            case 0b0010:
                this.registers[rx] = inShadowView ? (this.segmentRegisters.SS & 0xFFFF) : (this.shadowRegisters.SS & 0xFFFF);
                break;
            case 0b0011:
                this.registers[rx] = inShadowView ? (this.segmentRegisters.ES & 0xFFFF) : (this.shadowRegisters.ES & 0xFFFF);
                break;
            case 0b0100:
                this.registers[rx] = inShadowView ? (this.psw & 0xFFFF) : (this.shadowRegisters.PSW & 0xFFFF);
                break;
            case 0b1000:
                this.registers[rx] = inShadowView ? (this.registers[0] & 0xFFFF) : (this.shadowRegisters.R0 & 0xFFFF);
                break;
            case 0b1001:
                this.registers[rx] = inShadowView ? (this.registers[1] & 0xFFFF) : (this.shadowRegisters.R1 & 0xFFFF);
                break;
            case 0b1010:
                this.registers[rx] = inShadowView ? (this.registers[2] & 0xFFFF) : (this.shadowRegisters.R2 & 0xFFFF);
                break;
            case 0b1101:
                this.registers[rx] = inShadowView ? (this.registers[13] & 0xFFFF) : (this.shadowRegisters.R13 & 0xFFFF);
                break;
            case 0b1110:
                this.registers[rx] = inShadowView ? (this.registers[14] & 0xFFFF) : (this.shadowRegisters.R14 & 0xFFFF);
                break;
            case 0b1111:
                this.registers[rx] = inShadowView ? (this.registers[15] & 0xFFFF) : (this.shadowRegisters.PC & 0xFFFF);
                break;
            default:
                break;
        }
    }

    executeLPSW(instruction) {
        const rx = instruction & 0xF;
        const inShadowView = !!(this.psw & (1 << 5));
        const value = inShadowView ? (this.shadowRegisters.PSW & 0xFFFF) : (this.psw & 0xFFFF);
        this.registers[rx] = value;
    }

    executeLDSSTS(instruction) {
        // LDS/STS: [11110][d][seg2][Rd4][Rs4]
        const d = (instruction >>> 10) & 0x1;
        const seg = (instruction >>> 8) & 0x3;
        const rd = (instruction >>> 4) & 0xF;
        const rs = instruction & 0xF;
        
        const segNames = ['CS', 'DS', 'SS', 'ES'];
        const address = this.registers[rs] & 0xFFFF;
        const baseSegment = [
            this.segmentRegisters.CS & 0xFFFF,
            this.segmentRegisters.DS & 0xFFFF,
            this.segmentRegisters.SS & 0xFFFF,
            this.segmentRegisters.ES & 0xFFFF,
        ][seg];
        const physicalAddress = this.phys(baseSegment, address);
        
        // console.log(`LDS/STS Execute: d=${d}, seg=${segNames[seg]}, rd=${this.getRegisterName(rd)}, rs=${this.getRegisterName(rs)}, address=0x${address.toString(16)}`);
        
        if (d === 0) { // LDS
            // Keyboard controller reads
            if (physicalAddress === this.KBD_STATUS_ADDR) {
                const ready = this.kbdBuffer.length > 0 ? 1 : 0;
                this.registers[rd] = ready & 0xFFFF;
            } else if (physicalAddress === this.KBD_DATA_ADDR) {
                const data = this.kbdBuffer.length > 0 ? (this.kbdBuffer.shift() & 0xFFFF) : 0;
                this.kbdLastData = data;
                this.registers[rd] = data;
            } else if (physicalAddress < this.memory.length) {
                this.registers[rd] = this.memory[physicalAddress] & 0xFFFF;
            }
        } else { // STS
            if (physicalAddress < this.memory.length) {
                const value = this.registers[rd] & 0xFFFF;
                this.memory[physicalAddress] = value;
                // console.log(`STS: [${segNames[seg]}:${this.getRegisterName(rs)}] -> phys 0x${physicalAddress.toString(16)} = 0x${value.toString(16)}`);
                
                // Check if this is a screen memory write
                this.checkScreenUpdate(physicalAddress, value);
            }
        }
    }

    executeSystem(instruction) {
        const sysOp = instruction & 0x7;
        
        // console.log(`System Execute: op=${sysOp}, PSW=0x${this.psw.toString(16)}, S-bit=${!!(this.psw & (1 << 5))}`);
        
        switch (sysOp) {
            case 0b000:
                break;
            case 0b001:
                break;
            case 0b010:
                this.executeSWI();
                break;
            case 0b011:
                this.executeRETI();
                break;
            default:
        }
    }

    /**
     * Execute Software Interrupt with proper context switching
     */
    executeSWI() {
        this.shadowRegisters.PSW = this.psw;
        this.psw = (this.psw & ~(1 << 4)) | (1 << 5);
        this.shadowRegisters.CS = 0x0000;
        this.shadowRegisters.DS = 0x0000;
        this.shadowRegisters.SS = 0x0000;
        this.shadowRegisters.ES = 0x0000;
        this.shadowRegisters.R0 = 0x0000;
        this.shadowRegisters.R1 = 0x0000;
        this.shadowRegisters.R2 = 0x0000;
        this.shadowRegisters.R13 = 0x0000;
        this.shadowRegisters.R14 = 0x0000;
        const pa = this.phys(0, 2);
        const target = pa < this.memory.length ? (this.memory[pa] & 0xFFFF) : 0xFFFF;
        this.shadowRegisters.PC = target;
        this.flushPipeline();
    }

    /**
     * Execute Return from Interrupt with context restoration
     */
    executeRETI() {
        // console.log("RETI: Return from interrupt - switching to normal context");
        
        // Simply switch back to normal view (clear S-bit)
        // No register copying - pure view switching
        this.psw = this.psw & ~(1 << 5); // Clear S-bit
        
        // console.log(`RETI: Switched to normal context - accessing PC, CS, PSW views`);
        // console.log(`RETI: PSW=0x${this.psw.toString(16)}, PC=0x${this.registers[15].toString(16)}, CS=0x${this.segmentRegisters.CS.toString(16)}`);
        
        // In a pipelined implementation, this would flush the pipeline
        this.flushPipeline();
    }

    checkScreenUpdate(address, value) {
        if (address >= this.SCREEN_MEMORY_START && address <= this.SCREEN_MEMORY_END) {
            // console.log(`Screen memory updated: address=0x${address.toString(16)}, value=0x${value.toString(16)}`);
            
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
        const isNMI = (vector & 0xFFFF) === 0;
        if (!isNMI) {
            if (!(this.psw & (1 << 4)) || (this.psw & (1 << 5))) {
                return false;
            }
        }
        this.shadowRegisters.PSW = this.psw;
        this.psw = (this.psw & ~(1 << 4)) | (1 << 5);
        this.shadowRegisters.CS = 0x0000;
        this.shadowRegisters.DS = 0x0000;
        this.shadowRegisters.SS = 0x0000;
        this.shadowRegisters.ES = 0x0000;
        this.shadowRegisters.R0 = 0x0000;
        this.shadowRegisters.R1 = 0x0000;
        this.shadowRegisters.R2 = 0x0000;
        this.shadowRegisters.R13 = 0x0000;
        this.shadowRegisters.R14 = 0x0000;
        const pa = this.phys(0, vector & 0xFFFF);
        const target = pa < this.memory.length ? (this.memory[pa] & 0xFFFF) : 0xFFFF;
        this.shadowRegisters.PC = target;
        this.flushPipeline();
        return true;
    }

    /**
     * Simulate pipeline flush (for context switches)
     */
    flushPipeline() {
        // console.log("Pipeline flushed due to context switch");
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
        // console.log(`PSW updated: 0x${this.psw.toString(16).padStart(4, '0')} (N=${!!(this.psw & 1)}, Z=${!!(this.psw & 2)}, V=${!!(this.psw & 4)}, C=${!!(this.psw & 8)})`);
    }

    getRegisterName(regIndex) {
        return this.registerNames[regIndex] || `R${regIndex}`;
    }

    // UI hook to enqueue a key (ASCII code) into keyboard buffer
    enqueueKeyCode(code) {
        const c = code & 0xFFFF;
        this.kbdBuffer.push(c);
    }

    enqueueKeyEvent(e) {
        let code = 0;
        if (e.key === 'Enter') code = 10;
        else if (e.key === 'Backspace') code = 8;
        else if (e.key.length === 1) code = e.key.charCodeAt(0);
        else if (e.key === 'Tab') code = 9;
        if (code) this.enqueueKeyCode(code);
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
