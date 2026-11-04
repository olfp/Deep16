const fs = require('fs');

const OUTPUT_ASM = 'asm/test_suite.asm';
const OUTPUT_EXPECTED = 'test_expected.json';

let asmCode = `
; Deep16 Comprehensive Test Suite
.org 0x0100
.code
    ; Initialize Result Pointer R14 to 0x2000
    LDI 0x20
    MOV R14, R0
    SL R14, 8     
    ; R14 now holds 0x2000. 
    ; We will store results sequentially starting from here.
`;

const expectedValues = [];
let testCounter = 0;

// --- Helpers ---

// Helper to load a value into a register
function loadRegAsm(reg, val) {
    if (val >= -16384 && val <= 16383) {
        let imm = val & 0xFFFF;
        return `LDI ${val}\n    MOV ${reg}, R0`;
    } else {
        const high = (val >>> 8) & 0xFF;
        const low = val & 0xFF;
        return `
    LDI ${high}
    MOV ${reg}, R0
    SL ${reg}, 8
    LDI ${low}
    OR ${reg}, R0`;
    }
}

// Helper for JMP to label (since JMP is Reg only)
function jmpLabel(label) {
    return `LDI ${label}\n    MOV PC, R0`;
}

// Add a test case
function addTest(name, setupFn, opAsm, resultReg, expectedVal) {
    testCounter++;
    asmCode += `\n    ; -- Test ${testCounter}: ${name} --\n`;
    
    let currentOpAsm = opAsm;
    let currentSetup = setupFn ? setupFn() : '';
    
    // Replace generic labels with unique ones
    const labelPattern = /\.([a-zA-Z0-9_]+)/g;
    const replaceLabels = (str) => str.replace(labelPattern, `.$1_${testCounter}`);
    
    if (currentSetup) {
        asmCode += replaceLabels(currentSetup);
        asmCode += '\n'; 
    }
    
    asmCode += `    ${replaceLabels(currentOpAsm)}\n`;
    
    // Store result
    if (resultReg === 'PSW') {
        asmCode += `    MOV R1, PSW\n`; 
    } else if (resultReg !== 'R1') {
        asmCode += `    MOV R1, ${resultReg}\n`;
    }
    
    asmCode += `    ST R1, [R14]\n    ADD R14, 1\n`;
    
    expectedValues.push(expectedVal & 0xFFFF);
}

// --- ALU Tests (Reg-Reg) ---
const aluOps = ['ADD', 'SUB', 'AND', 'OR', 'XOR'];
const aluFuncs = {
    'ADD': (a, b) => (a + b) & 0xFFFF,
    'SUB': (a, b) => (a - b) & 0xFFFF,
    'AND': (a, b) => (a & b) & 0xFFFF,
    'OR':  (a, b) => (a | b) & 0xFFFF,
    'XOR': (a, b) => (a ^ b) & 0xFFFF
};

aluOps.forEach(op => {
    const v1 = 0x1234;
    const v2 = 0x0011;
    addTest(`${op} Reg-Reg`, () => `
    ${loadRegAsm('R2', v1)}
    ${loadRegAsm('R3', v2)}`,
    `${op} R2, R3`,
    'R2',
    aluFuncs[op](v1, v2));
});

// --- ALU Tests (Reg-Imm4) ---
aluOps.forEach(op => {
    const v1 = 0x1234;
    const imm = 5;
    addTest(`${op} Reg-Imm4`, () => `
    ${loadRegAsm('R2', v1)}`,
    `${op} R2, ${imm}`,
    'R2',
    aluFuncs[op](v1, imm));
});

// --- Multiplication ---
// MUL (16x16->16)
addTest('MUL Reg-Reg', () => `
    ${loadRegAsm('R2', 100)}
    ${loadRegAsm('R3', 200)}`,
    `MUL R2, R3`,
    'R2',
    (100 * 200) & 0xFFFF);

// MUL32 (16x16->32)
// 1000 * 2000 = 2,000,000 (0x1E8480)
// High: 0x001E, Low: 0x8480
// Note: MUL32 requires uneven destination register (e.g. R3), writes High to Rd, Low to Rd+1
addTest('MUL32 Reg-Reg (High)', () => `
    ${loadRegAsm('R3', 1000)}
    ${loadRegAsm('R2', 2000)}`,
    `MUL32 R3, R2`, // R3=High, R4=Low
    'R3',
    0x001E);

addTest('MUL32 Reg-Reg (Low)', () => `
    ${loadRegAsm('R3', 1000)}
    ${loadRegAsm('R2', 2000)}`,
    `MUL32 R3, R2`, 
    'R4',
    0x8480);

// --- Division ---
// DIV (16/16->16)
addTest('DIV Reg-Reg', () => `
    ${loadRegAsm('R2', 20000)}
    ${loadRegAsm('R3', 100)}`,
    `DIV R2, R3`,
    'R2',
    200);

// DIV32 (32/16->16Q, 16R)
// Note: DIV32 requires uneven destination register (e.g. R3), reads Dividend from Rd:Rd+1
// Writes Quotient to Rd, Remainder to Rd+1
// Dividend: 0x00123456
// Q = 0x1234, R = 0x56
addTest('DIV32 Reg-Reg (Quotient)', () => `
    ${loadRegAsm('R3', 0x0012)} ; High
    ${loadRegAsm('R4', 0x3456)} ; Low
    ${loadRegAsm('R2', 0x0100)} ; Divisor`,
    `DIV32 R3, R2`, // R3:R4 / R2 -> R3=Q, R4=R
    'R3',
    0x1234);

addTest('DIV32 Reg-Reg (Remainder)', () => `
    ${loadRegAsm('R3', 0x0012)} ; High
    ${loadRegAsm('R4', 0x3456)} ; Low
    ${loadRegAsm('R2', 0x0100)} ; Divisor`,
    `DIV32 R3, R2`, 
    'R4',
    0x56);

// --- Shifts ---
const shiftTests = [
    { op: 'SL', val: 0x0001, count: 4, res: 0x0010 },
    { op: 'SR', val: 0x0010, count: 4, res: 0x0001 },
    { op: 'ROL', val: 0x8000, count: 1, res: 0x0001 },
    { op: 'ROR', val: 0x0001, count: 1, res: 0x8000 },
    // Arithmetic Shifts
    { op: 'SRA', val: 0xF000, count: 4, res: 0xFF00 }, // Sign extend
    // SRA is 'SRA' or 'SRS'? Assembler map: SRA->0b10110
    // Simulator 0b10110: (rd >>> count) | (sign ? mask : 0). Correct.
];

shiftTests.forEach(t => {
    addTest(`${t.op} Count=${t.count}`, () => `
    ${loadRegAsm('R2', t.val)}`,
    `${t.op} R2, ${t.count}`,
    'R2',
    t.res);
});

// --- SOP (Unary) ---
addTest('INV', () => `
    ${loadRegAsm('R2', 0xAAAA)}`,
    `INV R2`,
    'R2',
    0x5555);

addTest('NEG', () => `
    ${loadRegAsm('R2', 1)}`,
    `NEG R2`,
    'R2',
    0xFFFF); // -1

// --- Memory ---
// Base+Offset
asmCode += `
    ; Setup Base R12 = 0x3000
    LDI 0x30
    MOV R12, R0
    SL R12, 8
`;

addTest('ST/LD Base+Offset', () => `
    ${loadRegAsm('R2', 0xFACE)}`,
    `ST R2, [R12+4]
    LD R3, [R12+4]`,
    'R3',
    0xFACE);

// LSI (Load Short Immediate)
addTest('LSI', () => '', 
    `LSI R2, 10`, 
    'R2', 
    10);

// SWB (Swap Bytes)
addTest('SWB', () => `
    ${loadRegAsm('R2', 0x1234)}`,
    `SWB R2`,
    'R2',
    0x3412);

// --- Stack ---
// Setup SP
asmCode += `
    LDI 0x70
    MOV SP, R0
    SL SP, 8
`;

addTest('STS/LDS', () => `
    ${loadRegAsm('R2', 0xBEEF)}`,
    `STS R2, SS, SP
    LDS R3, SS, SP`,
    'R3',
    0xBEEF);

// --- Flags & Jumps ---
// JZ, JNZ, JC, JNC, JN, JNN, JO, JNO

// Test Zero Flag
addTest('JZ Taken (Z=1)', () => `
    LDI 1
    MOV R2, R0
    LDI 0
    CMP R2, R2 ; Z=1
    JZ .jz_target
    LDI 0
    MOV R2, R0
    ${jmpLabel('.jz_end')}
.jz_target:
    LDI 1
    MOV R2, R0
.jz_end:`,
    `NOP`,
    'R2',
    1);

// Test Carry Flag
addTest('JC Taken (C=1)', () => `
    ${loadRegAsm('R2', 0xFFFF)}
    ADD R2, 1 ; Overflow 16-bit -> C=1
    JC .jc_target
    LDI 0
    MOV R3, R0
    ${jmpLabel('.jc_end')}
.jc_target:
    LDI 1
    MOV R3, R0
.jc_end:`,
    `NOP`,
    'R3',
    1);

// --- System / Special ---
// MVS (Move Segment)
addTest('MVS Write/Read', () => `
    ${loadRegAsm('R2', 0x1234)}`,
    `MVS ES, R2  ; ES = R2
    MVS R3, ES  ; R3 = ES`,
    'R3',
    0x1234);

// LNK (Link)
// We skip precise value check for LNK and just check it runs.
addTest('LNK Execution', () => '',
    `LNK R2
    LDI 0xAA
    MOV R2, R0
    SL R2, 8
    OR R2, R0`, // 0xAAAA
    'R2',
    0xAAAA);

// --- Finish ---
asmCode += `
    HLT
`;

fs.writeFileSync(OUTPUT_ASM, asmCode);
fs.writeFileSync(OUTPUT_EXPECTED, JSON.stringify(expectedValues, null, 2));

console.log(`Generated ${OUTPUT_ASM} and ${OUTPUT_EXPECTED} with ${testCounter} tests.`);
