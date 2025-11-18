// Deep16 Simulator - CPU Execution and State Management
class Deep16Simulator {
    constructor() {
        this.memory = new Array(65536).fill(0xFFFF);
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
    }

    // ... other methods remain the same ...

    executeMOV(instruction) {
        // MOV encoding: [111110][Rd4][Rs4][imm2]
        // Bits: 15-10: opcode=111110, 9-6: Rd, 5-2: Rs, 1-0: imm
        
        const rd = (instruction >>> 6) & 0xF;      // Bits 9-6
        const rs = (instruction >>> 2) & 0xF;      // Bits 5-2  
        const imm = instruction & 0x3;             // Bits 1-0
        
        console.log(`MOV Execute: rd=${rd} (${this.getRegisterName(rd)}), rs=${rs} (${this.getRegisterName(rs)}), imm=${imm}`);
        
        this.registers[rd] = this.registers[rs] + imm;
        
        console.log(`MOV Execute: ${this.getRegisterName(rd)} = ${this.getRegisterName(rs)} + ${imm} = ${this.registers[rd]}`);
        
        this.lastALUResult = this.registers[rd];
        this.lastOperationWasALU = true;
    }

    // ... rest of the file unchanged ...
}
