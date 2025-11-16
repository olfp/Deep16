// Deep16 Simulator - CPU Execution and State Management
class Deep16Simulator {
    constructor() {
        this.memory = new Array(65536).fill(0);
        this.registers = new Array(16).fill(0);
        this.segmentRegisters = { CS: 0, DS: 0, SS: 0, ES: 0 };
        this.shadowRegisters = { PSW: 0, PC: 0, CS: 0 };
        this.psw = 0;
        this.running = false;
        this.lastALUResult = 0;
        
        // Initialize registers
        this.registers[13] = 0x7FFF; // SP
        this.registers[15] = 0x0000; // PC
    }

    loadProgram(memory) {
        this.memory = [...memory];
        this.registers[15] = 0x0000;
        this.running = false;
    }

    reset() {
        this.registers.fill(0);
        this.registers[13] = 0x7FFF;
        this.registers[15] = 0x0000;
        this.psw = 0;
        this.memory.fill(0);
        this.running = false;
        this.lastALUResult = 0;
    }

    step() {
        if (!this.running) return false;

        const pc = this.registers[15];
        if (pc >= this.memory.length) {
            this.running = false;
            return false;
        }

        const instruction = this.memory[pc];
        this.registers[15] += 2;

        // Decode and execute instruction
        const opcode = (instruction >> 13) & 0x7;

        try {
            switch (opcode) {
                case 0b100: this.executeMemoryOp(instruction); break;
                case 0b110: this.executeALUOp(instruction); break;
                case 0b111: 
                    if ((instruction >> 12) === 0b1110) {
                        this.executeJump(instruction);
                    } else if ((instruction >> 10) === 0b111110) {
                        this.executeMOV(instruction);
                    } else if ((instruction >> 9) === 0b1111110) {
                        this.executeLSI(instruction);
                    } else if ((instruction >> 13) === 0b11111) {
                        this.executeSystem(instruction);
                    }
                    break;
            }
        } catch (error) {
            this.running = false;
            throw error;
        }

        this.updatePSWFlags();
        return true;
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
            }
        } else { // ST
            if (address < this.memory.length) {
                this.memory[address] = this.registers[rd];
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

        switch (aluOp) {
            case 0b000: result = this.registers[rd] + operandValue; break;
            case 0b001: result = this.registers[rd] - operandValue; break;
            case 0b010: result = this.registers[rd] & operandValue; break;
            case 0b011: result = this.registers[rd] | operandValue; break;
            case 0b100: result = this.registers[rd] ^ operandValue; break;
            default: result = this.registers[rd]; break;
        }

        if (w === 1) {
            this.registers[rd] = result & 0xFFFF;
        }

        this.lastALUResult = result;
    }

    executeMOV(instruction) {
        const rd = (instruction >> 8) & 0xF;
        const rs = (instruction >> 4) & 0xF;
        const imm = instruction & 0x3;
        this.registers[rd] = this.registers[rs] + imm;
    }

    executeLSI(instruction) {
        const rd = (instruction >> 8) & 0xF;
        let imm = (instruction >> 4) & 0x1F;
        if (imm & 0x10) imm |= 0xFFE0;
        this.registers[rd] = imm;
    }

    executeJump(instruction) {
        const condition = (instruction >> 9) & 0x7;
        let offset = instruction & 0x1FF;
        if (offset & 0x100) offset |= 0xFE00;

        let shouldJump = false;
        switch (condition) {
            case 0b000: shouldJump = true; break;
            case 0b001: shouldJump = (this.psw & (1 << 1)) !== 0; break;
            case 0b010: shouldJump = (this.psw & (1 << 1)) === 0; break;
        }

        if (shouldJump) {
            this.registers[15] += offset;
        }
    }

    executeSystem(instruction) {
        const sysOp = instruction & 0x7;
        switch (sysOp) {
            case 0b001: 
                this.running = false;
                break;
        }
    }

    updatePSWFlags() {
        this.psw = 0;
        if (this.lastALUResult !== undefined) {
            const result = this.lastALUResult & 0xFFFF;
            if (result === 0) this.psw |= (1 << 1);
            if (result & 0x8000) this.psw |= (1 << 0);
            if (this.lastALUResult > 0xFFFF || this.lastALUResult < 0) {
                this.psw |= (1 << 3);
            }
        }
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
