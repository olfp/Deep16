// Deep16 Simulator - Complete CPU Execution and State Management with Delay Slot
class Deep16Simulator {
    constructor() {
        // CORRECTED: 2 megawords = 2^20 words = 1,048,576 words of 16-bit memory
        // This equals 2MB × 2 bytes/word = 4MB physical memory
        this.memory = new Array(1048576).fill(0xFFFF); // 1,048,576 words (2MW)
        this.registers = new Array(16).fill(0);
        this.segmentRegisters = { CS: 0xFFFF, DS: 0x0000, SS: 0x0000, ES: 0x0000 };
        this.shadowRegisters = { PSW: 0, PC: 0, CS: 0, DS: 0, SS: 0, ES: 0, R0: 0, R1: 0, R2: 0, R3: 0, R13: 0, R14: 0 };
        this.psw = 0;
        this.running = false;
        this.lastOperationWasALU = false;
        this.lastALUResult = 0;
        this.lastALUOverflow = false;
        this.shiftCarryOut = null;
        
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
        this.lastALUOverflow = false;
        this.shiftCarryOut = null;
        this.segmentRegisters = { CS: 0xFFFF, DS: 0x0000, SS: 0x0000, ES: 0x0000 };
        this.shadowRegisters = { PSW: 0, PC: 0, CS: 0, DS: 0, SS: 0, ES: 0, R0: 0, R1: 0, R2: 0, R3: 0, R13: 0, R14: 0 };
        
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

    // Boot ROM at 0xFFFF0. It zeroes DS/SS, builds the entry point 0x0100 in
    // R1, stores that value at physical 0x0000..0x0002 as a breadcrumb, and
    // jumps to CS:R1 = 0000:0100 (JML R0 takes CS from R0 and PC from R1).
    autoloadROM() {
        const base = 0xFFFF0;
        const rom = [
            0x0000, // LDI 0 -> R0          (R0 = 0)
            0xFF41, // MVS DS, R0          (flat data addressing)
            0xFF42, // MVS SS, R0          (stack sits at physical 0x0000)
            0xFC21, // LSI R1, 1
            0xD818, // ROL R1, 8           (R1 = 0x0100, the entry point)
            0xA200, // ST R1, [R0+0]       (writes 0x0100 at physical 0x0000)
            0xA201, // ST R1, [R0+1]       (          ...      0x0001)
            0xA202, // ST R1, [R0+2]       (          ...      0x0002)
            0xFFE0, // JML R0              (CS = R0 = 0, PC = R1 = 0x0100)
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
            // Reset ALU tracking so a stale result cannot smear flags across
            // the SWI/RETI PSW transition (matches the WASM core's step_one).
            this.lastOperationWasALU = false;
            this.lastALUResult = 0;
            this.lastALUOverflow = false;
            this.shiftCarryOut = null;
            this.executeInstruction(delayInstruction, activePC);
            this.updatePSWFlags();
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
        this.lastALUOverflow = false;
        this.shiftCarryOut = null;

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

    // ---- Shadow-register banking (spec 4.1) -------------------------------
    // While PSW.S=1 the registers R0-R3, R13 and R14 live in the shadow bank
    // (R0'-R3', R13'=SP', R14'=LR'); every other register is shared between
    // both contexts. All instruction execution goes through these helpers.
    isShadowedGPR(index) {
        if ((this.psw & (1 << 5)) === 0) return false;
        return index === 0 || index === 1 || index === 2 || index === 3 || index === 13 || index === 14;
    }

    readGPR(index) {
        if (this.isShadowedGPR(index)) {
            switch (index) {
                case 0: return this.shadowRegisters.R0 & 0xFFFF;
                case 1: return this.shadowRegisters.R1 & 0xFFFF;
                case 2: return this.shadowRegisters.R2 & 0xFFFF;
                case 3: return this.shadowRegisters.R3 & 0xFFFF;
                case 13: return this.shadowRegisters.R13 & 0xFFFF;
                case 14: return this.shadowRegisters.R14 & 0xFFFF;
            }
        }
        return this.registers[index] & 0xFFFF;
    }

    writeGPR(index, value) {
        value &= 0xFFFF;
        if (this.isShadowedGPR(index)) {
            switch (index) {
                case 0: this.shadowRegisters.R0 = value; return;
                case 1: this.shadowRegisters.R1 = value; return;
                case 2: this.shadowRegisters.R2 = value; return;
                case 3: this.shadowRegisters.R3 = value; return;
                case 13: this.shadowRegisters.R13 = value; return;
                case 14: this.shadowRegisters.R14 = value; return;
            }
        }
        this.registers[index] = value;
    }

    executeLDI(instruction) {
        let immediate = instruction & 0x7FFF;
        if (immediate & 0x4000) {
            immediate |= 0x8000; // sign-extend 15-bit to 16-bit
        }
        this.writeGPR(0, immediate);
        this.lastALUResult = immediate & 0xFFFF;
        this.lastOperationWasALU = true;
    }

    executeMemoryOp(instruction) {
        // CORRECTED: Use the same bit extraction as the disassembler
        // LD/ST format: [10][d1][Rd4][Rb4][offset5]
        // Bits: 15-14: opcode=10, 13: d, 12-9: Rd, 8-5: Rb, 4-0: offset
        
        const d = (instruction >>> 13) & 0x1;      // Bit 13
        const rd = (instruction >>> 9) & 0xF;      // Bits 12-9  
        const rb = (instruction >>> 5) & 0xF;      // Bits 8-5
        let offset = instruction & 0x1F;         // Bits 4-0
        if (offset & 0x10) {
            offset |= 0xFFE0; // sign-extend imm5
        }

        // Calculate the effective address offset (base register via the
        // active-bank banking helpers, spec 4.1)
        const addressOffset = (this.readGPR(rb) + offset) & 0xFFFF;
        
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
            baseAddress: this.readGPR(rb),
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
                this.writeGPR(rd, value);
                // console.log(`LD: ${this.getRegisterName(rd)} = [${segmentName}:${this.getRegisterName(rb)}+${offset}] = 0x${value.toString(16).padStart(4, '0')}`);
            } else {
                // console.warn(`LD: Physical address 0x${physicalAddress.toString(16)} out of bounds`);
            }
        } else { // ST
            if (physicalAddress < this.memory.length) {
                const value = this.readGPR(rd);
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
        const rdValue = this.readGPR(rd);
        let result = rdValue;
        let wideResult = null; // 32-bit result for MUL32, kept out of the Rd write-back below
        const cbit = (this.psw >>> 3) & 0x1;
        const sign = (rdValue & 0x8000) !== 0 ? 1 : 0;
        const isReg = func5 === 0b00000 || func5 === 0b00010 || func5 === 0b00100 || func5 === 0b00110 || func5 === 0b01000 || func5 === 0b01010 || func5 === 0b01100 || func5 === 0b01110 || func5 >= 0b11100;
        const opVal = isReg ? this.readGPR(low4) : (low4 & 0xF);
        // V (signed overflow, spec Table 6: ADD/SUB/CMP = NZVC) is computed at
        // the op site where both operands are known: ADD overflows when equal
        // operand signs produce a different result sign, SUB/CMP when different
        // operand signs produce a result whose sign differs from the minuend.
        // Every other instruction leaves lastALUOverflow false (NZ00 for the
        // logic group, V=0 for loads/shifts).
        switch (func5) {
            case 0b00000: result = (rdValue + opVal) & 0x1FFFF; this.lastALUOverflow = ((~(rdValue ^ opVal)) & (rdValue ^ (result & 0xFFFF)) & 0x8000) !== 0; break;
            case 0b00001: result = (rdValue + opVal) & 0x1FFFF; this.lastALUOverflow = ((~(rdValue ^ opVal)) & (rdValue ^ (result & 0xFFFF)) & 0x8000) !== 0; break;
            case 0b00010: result = (rdValue - opVal) | 0; this.lastALUOverflow = (((rdValue ^ opVal) & (rdValue ^ (result & 0xFFFF))) & 0x8000) !== 0; break;
            case 0b00011: result = (rdValue - opVal) | 0; this.lastALUOverflow = (((rdValue ^ opVal) & (rdValue ^ (result & 0xFFFF))) & 0x8000) !== 0; break;
            case 0b00100: result = (rdValue - opVal) | 0; this.lastALUOverflow = (((rdValue ^ opVal) & (rdValue ^ (result & 0xFFFF))) & 0x8000) !== 0; this.lastALUResult = result; this.lastOperationWasALU = true; return; 
            case 0b00101: result = (rdValue - opVal) | 0; this.lastALUOverflow = (((rdValue ^ opVal) & (rdValue ^ (result & 0xFFFF))) & 0x8000) !== 0; this.lastALUResult = result; this.lastOperationWasALU = true; return;
            case 0b00110: result = (rdValue & opVal) & 0xFFFF; break;
            case 0b00111: {
                // CLRB Rd, imm - imm4 is a bit index (spec Table 6)
                result = (rdValue & ~(1 << low4)) & 0xFFFF;
                break;
            }
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
            // Immediate forms: imm4 is a bit index, the core supplies 1 << imm
            case 0b01011: result = (rdValue | (1 << low4)) & 0xFFFF; break;
            case 0b01100: result = (rdValue ^ opVal) & 0xFFFF; break;
            case 0b01101: result = (rdValue ^ (1 << low4)) & 0xFFFF; break;
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
                this.shiftCarryOut = count > 0 ? carryOut : -1;
                break;
            }
            case 0b10001: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (16 - count)) & 0x1) : 0;
                result = ((rdValue << count) & 0x7FFF) | (sign ? 0x8000 : 0);
                this.shiftCarryOut = count > 0 ? carryOut : -1;
                break;
            }
            case 0b10010: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (16 - count)) & 0x1) : 0;
                const carryFill = count > 0 ? (cbit << (count - 1)) : 0;
                result = ((rdValue << count) & 0x7FFF) | (sign ? 0x8000 : 0) | carryFill;
                this.shiftCarryOut = count > 0 ? carryOut : -1;
                break;
            }
            case 0b10011: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (16 - count)) & 0x1) : 0;
                const carryFill = count > 0 ? (cbit << (count - 1)) : 0;
                result = ((rdValue << count) & 0xFFFF) | carryFill;
                this.shiftCarryOut = count > 0 ? carryOut : -1;
                break;
            }
            case 0b10100: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (count - 1)) & 0x1) : 0;
                result = rdValue >>> count;
                this.shiftCarryOut = count > 0 ? carryOut : -1;
                break;
            }
            case 0b10101: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (count - 1)) & 0x1) : 0;
                const carryFill = count > 0 ? (cbit << (15 - count)) : 0;
                result = (rdValue >>> count) | carryFill;
                this.shiftCarryOut = count > 0 ? carryOut : -1;
                break;
            }
            case 0b10110: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (count - 1)) & 0x1) : 0;
                const signMask = sign ? 0xFFFF << (16 - count) : 0;
                result = (rdValue >>> count) | (signMask & 0xFFFF);
                this.shiftCarryOut = count > 0 ? carryOut : -1;
                break;
            }
            case 0b10111: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (count - 1)) & 0x1) : 0;
                const signMask = sign ? 0xFFFF << (16 - count) : 0;
                const carryFill = count > 0 ? (cbit << (15 - count)) : 0;
                result = (rdValue >>> count) | (signMask & 0xFFFF) | carryFill;
                this.shiftCarryOut = count > 0 ? carryOut : -1;
                break;
            }
            case 0b11000: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (16 - count)) & 0x1) : 0;
                this.shiftCarryOut = count > 0 ? carryOut : -1;
                result = ((rdValue << count) | (rdValue >>> (16 - count))) & 0xFFFF;
                break;
            }
            case 0b11001: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (16 - count)) & 0x1) : 0;
                this.shiftCarryOut = count > 0 ? carryOut : -1;
                const carryFill = count > 0 ? (cbit << (count - 1)) : 0;
                result = ((rdValue << count) | (rdValue >>> (16 - count)) | carryFill) & 0xFFFF;
                break;
            }
            case 0b11010: {
                const count = opVal & 0xF;
                const carryOut = (count > 0) ? ((rdValue >>> (count - 1)) & 0x1) : 0;
                this.shiftCarryOut = count > 0 ? carryOut : -1;
                result = ((rdValue >>> count) | (rdValue << (16 - count))) & 0xFFFF;
                break;
            }
            case 0b11011: {
                const count = opVal & 0xF;
                const carryFill = count > 0 ? (cbit << (15 - count)) : 0;
                result = ((rdValue >>> count) | (rdValue << (16 - count)) | carryFill) & 0xFFFF;
                const newCarry = count > 0 ? ((rdValue >>> (count - 1)) & 0x1) : cbit;
                this.shiftCarryOut = count > 0 ? newCarry : -1;
                break;
            }
            case 0b11100: {
                // MUL: the write-back epilogue below stores `result` via writeGPR
                result = (rdValue * opVal) & 0xFFFF;
                break;
            }
            case 0b11101: {
                // MUL32: R[d]:R[d+1] <- Rd * Rs (spec Table 8). Rd must be EVEN so the
                // pair is aligned; anything else would write outside the register file.
                if ((rd & 1) !== 0 || rd + 1 > 15) {
                    this.lastALUResult = 0xFFFFFFFF;
                    this.lastOperationWasALU = true;
                    return;
                }
                const product = (rdValue * opVal) >>> 0;
                const high = (product >>> 16) & 0xFFFF;
                this.writeGPR(rd + 1, product & 0xFFFF);
                // The epilogue below writes `result` into Rd, so it must carry the HIGH
                // word -- otherwise it would clobber the pair we just stored.
                result = high;
                wideResult = product;
                break;
            }
            case 0b11110: {
                if (opVal === 0) { result = 0xFFFF; break; }
                result = Math.floor(rdValue / opVal) & 0xFFFF;
                break;
            }
            case 0b11111: {
                // DIV32: R[d] <- quotient, R[d+1] <- remainder of the 32-bit value R[d]:R[d+1]
                if ((rd & 1) !== 0 || rd + 1 > 15) {
                    this.lastALUResult = 0xFFFFFFFF;
                    this.lastOperationWasALU = true;
                    return;
                }
                if (opVal === 0) { result = 0xFFFF; break; }
                const dividend = ((this.readGPR(rd) << 16) | this.readGPR(rd + 1)) >>> 0;
                const q = Math.floor(dividend / opVal) & 0xFFFF;
                const r = (dividend % opVal) & 0xFFFF;
                this.writeGPR(rd + 1, r);
                result = q;
                break;
            }
            default: break;
        }
        this.writeGPR(rd, result);
        this.lastALUResult = wideResult !== null ? wideResult : result;
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
            value = this.readGPR(rs);
        } else if (rs === 15 && imm === 2) {
            // Standard link: use original PC context
            value = (this.lastOriginalPCForExec + 2) & 0xFFFF;
        } else if (rs === 15 && imm === 3) {
            value = (this.lastOriginalPCForExec + 1) & 0xFFFF;
        } else if (imm === 3) {
            // Architectural read bypass: do not add immediate
            value = this.readGPR(rs);
        } else {
            value = (this.readGPR(rs) + imm) & 0xFFFF;
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

        this.writeGPR(rd, value);

        this.lastALUResult = value;
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
        
        this.writeGPR(rd, imm);
        
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
            // Spec Table 11: conditional jumps use a one-slot delay slot. The
            // instruction after the jump executes before control transfers;
            // step() consumes it through the delay-slot machinery below.
            this.delaySlotActive = true;
            this.delayedPC = targetPC;
            this.delayedCS = inShadow ? (this.shadowRegisters.CS & 0xFFFF) : (this.segmentRegisters.CS & 0xFFFF);
            this.delayedToShadow = inShadow;
            this.branchTaken = true;
        } else {
            this.branchTaken = false;
        }
        return shouldJump;
    }

    executeSOP(instruction) {
        const type2 = (instruction >>> 4) & 0x3;
        const rx = instruction & 0xF;

        switch (type2) {
            case 0b00: { // INV
                const v = (~this.readGPR(rx)) & 0xFFFF;
                this.writeGPR(rx, v);
                this.lastALUResult = v;
                this.lastOperationWasALU = true;
                return false;
            }
            case 0b01: { // NEG
                const v = (~this.readGPR(rx) + 1) & 0xFFFF;
                this.writeGPR(rx, v);
                this.lastALUResult = v;
                this.lastOperationWasALU = true;
                return false;
            }
            case 0b10: // SPSW
                this.psw = this.readGPR(rx);
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
        
        const targetCS = this.readGPR(rx);
        const targetPC = this.readGPR(rx + 1);
        
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
                case 0: this.writeGPR(rd, segs.CS); break;
                case 1: this.writeGPR(rd, segs.DS); break;
                case 2: this.writeGPR(rd, segs.SS); break;
                case 3: this.writeGPR(rd, segs.ES); break;
            }
        } else {
            const value = this.readGPR(rd);
            switch (seg) {
                case 0: segs.CS = value; break;
                case 1: segs.DS = value; break;
                case 2: segs.SS = value; break;
                case 3: segs.ES = value; break;
            }
        }
    }

    executeSMV(instruction) {
        const rx = (instruction >>> 4) & 0xF;
        const alt = instruction & 0xF;
        const inShadowView = !!(this.psw & (1 << 5));
        // SMV always reads the *inactive* bank: in shadow view (S=1) the normal
        // registers, in normal view (S=0) the shadow registers. The result is
        // written into the *active* bank via writeGPR (spec 3.3 / 4.8).
        switch (alt) {
            case 0b0000:
                this.writeGPR(rx, inShadowView ? this.segmentRegisters.CS : this.shadowRegisters.CS);
                break;
            case 0b0001:
                this.writeGPR(rx, inShadowView ? this.segmentRegisters.DS : this.shadowRegisters.DS);
                break;
            case 0b0010:
                this.writeGPR(rx, inShadowView ? this.segmentRegisters.SS : this.shadowRegisters.SS);
                break;
            case 0b0011:
                this.writeGPR(rx, inShadowView ? this.segmentRegisters.ES : this.shadowRegisters.ES);
                break;
            case 0b0100:
                // APSW: shadowRegisters.PSW holds the *other* context's PSW --
                // the interrupted PSW during handler execution, PSW' (0x0000
                // after RETI, spec 4.9) in normal view (spec 4.8).
                this.writeGPR(rx, this.shadowRegisters.PSW & 0xFFFF);
                break;
            case 0b1000:
                this.writeGPR(rx, inShadowView ? this.registers[0] : this.shadowRegisters.R0);
                break;
            case 0b1001:
                this.writeGPR(rx, inShadowView ? this.registers[1] : this.shadowRegisters.R1);
                break;
            case 0b1010:
                this.writeGPR(rx, inShadowView ? this.registers[2] : this.shadowRegisters.R2);
                break;
            case 0b1011:
                this.writeGPR(rx, inShadowView ? this.registers[3] : this.shadowRegisters.R3);
                break;
            case 0b1101:
                this.writeGPR(rx, inShadowView ? this.registers[13] : this.shadowRegisters.R13);
                break;
            case 0b1110:
                this.writeGPR(rx, inShadowView ? this.registers[14] : this.shadowRegisters.R14);
                break;
            case 0b1111:
                // APC: the architectural (active) PC -- shadow PC in handler
                // context, normal PC otherwise (spec 3.3 / 6.2.2 ALINK)
                this.writeGPR(rx, inShadowView ? this.shadowRegisters.PC : this.registers[15]);
                break;
            default:
                break;
        }
    }

    executeLPSW(instruction) {
        const rx = instruction & 0xF;
        // LPSW Rx: Rx <- PSW. Always the live architectural PSW so the S bit
        // is observable in handler context too (spec 2.4); for the interrupted
        // state the handler uses SMV Rx, APSW (spec 4.8).
        this.writeGPR(rx, this.psw & 0xFFFF);
    }

    executeLDSSTS(instruction) {
        // LDS/STS: [11110][d][seg2][Rd4][Rs4]
        const d = (instruction >>> 10) & 0x1;
        const seg = (instruction >>> 8) & 0x3;
        const rd = (instruction >>> 4) & 0xF;
        const rs = instruction & 0xF;
        
        const segNames = ['CS', 'DS', 'SS', 'ES'];
        const address = this.readGPR(rs);
        const inShadow = (this.psw & (1 << 5)) !== 0;
        const segs = inShadow ? this.shadowRegisters : this.segmentRegisters;
        const baseSegment = [
            segs.CS & 0xFFFF,
            segs.DS & 0xFFFF,
            segs.SS & 0xFFFF,
            segs.ES & 0xFFFF,
        ][seg];
        const physicalAddress = this.phys(baseSegment, address);
        
        // console.log(`LDS/STS Execute: d=${d}, seg=${segNames[seg]}, rd=${this.getRegisterName(rd)}, rs=${this.getRegisterName(rs)}, address=0x${address.toString(16)}`);
        
        if (d === 0) { // LDS
            // Keyboard controller reads
            if (physicalAddress === this.KBD_STATUS_ADDR) {
                const ready = this.kbdBuffer.length > 0 ? 1 : 0;
                this.writeGPR(rd, ready);
            } else if (physicalAddress === this.KBD_DATA_ADDR) {
                const data = this.kbdBuffer.length > 0 ? (this.kbdBuffer.shift() & 0xFFFF) : 0;
                this.kbdLastData = data;
                this.writeGPR(rd, data);
            } else if (physicalAddress < this.memory.length) {
                this.writeGPR(rd, this.memory[physicalAddress] & 0xFFFF);
            }
        } else { // STS
            if (physicalAddress < this.memory.length) {
                const value = this.readGPR(rd);
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
            case 0b100: // SETI (spec Table 5)
                this.psw |= (1 << 4);
                break;
            case 0b101: // CLRI (spec Table 5)
                this.psw &= ~(1 << 4);
                break;
            default:
        }
    }

    /**
     * Execute Software Interrupt with proper context switching
     */
    executeSWI() {
        // Spec 4.4: park the interrupted PSW, then enter the handler with a
        // fresh PSW (S=1, I=0, flags clear) -- NOT a copy of the old one.
        this.shadowRegisters.PSW = this.psw & 0xFFFF;
        this.psw = 0x0020;
        this.shadowRegisters.CS = 0x0000;
        this.shadowRegisters.DS = 0x0000;
        this.shadowRegisters.SS = 0x0000;
        this.shadowRegisters.ES = 0x0000;
        this.shadowRegisters.R0 = 0x0000;
        this.shadowRegisters.R1 = 0x0000;
        this.shadowRegisters.R2 = 0x0000;
        this.shadowRegisters.R3 = 0x0000;
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
        
        // Spec 4.9: restore the original (interrupted) PSW -- flags, I and all
        // fields must be intact -- and reset PSW' to 0x0000. No register
        // copying: the normal registers were never modified.
        if ((this.psw & (1 << 5)) !== 0) {
            this.psw = this.shadowRegisters.PSW & 0xFFFF;
            this.shadowRegisters.PSW = 0;
        } else {
            // Spurious RETI outside a handler: legacy behaviour, just make sure S stays clear
            this.psw = this.psw & ~(1 << 5);
        }
        
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
        // Same entry convention as SWI (spec 4.4): park the interrupted PSW,
        // then a fresh handler PSW (S=1, I=0).
        this.shadowRegisters.PSW = this.psw & 0xFFFF;
        this.psw = 0x0020;
        this.shadowRegisters.CS = 0x0000;
        this.shadowRegisters.DS = 0x0000;
        this.shadowRegisters.SS = 0x0000;
        this.shadowRegisters.ES = 0x0000;
        this.shadowRegisters.R0 = 0x0000;
        this.shadowRegisters.R1 = 0x0000;
        this.shadowRegisters.R2 = 0x0000;
        this.shadowRegisters.R3 = 0x0000;
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
        
        const oldC = (this.psw >>> 3) & 0x1; // read before the nibble is cleared
        this.psw &= 0xFFF0; // Clear standard flags (keep system bits)
        
        if (this.lastALUResult !== undefined) {
            const result = this.lastALUResult & 0xFFFF;
            
            // Zero flag
            if (result === 0) this.psw |= (1 << 1);
            
            // Negative flag (sign bit)
            if (result & 0x8000) this.psw |= (1 << 0);
            
            // Carry flag: a shift/rotate writes the bit it shifted out
            // (spec Table 7) and keeps C unchanged when count is 0; every
            // other instruction uses the unsigned-overflow heuristic.
            let carry;
            if (this.shiftCarryOut === null) {
                carry = (this.lastALUResult > 0xFFFF || this.lastALUResult < 0) ? 1 : 0;
            } else {
                carry = this.shiftCarryOut < 0 ? oldC : this.shiftCarryOut;
            }
            if (carry) this.psw |= (1 << 3);
            
            // Overflow flag (signed overflow): computed by the ADD/SUB/CMP
            // sites in executeALUOp; false everywhere else (spec Table 6).
            if (this.lastALUOverflow) {
                this.psw |= (1 << 2);
            }
        }
        
        this.lastOperationWasALU = false;
        this.lastALUOverflow = false;
        this.shiftCarryOut = null;
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
