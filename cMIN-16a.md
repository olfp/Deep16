# cMIN-16a Architecture Specification
## A 16-bit RISC Processor

---

## 📋 Inhaltsverzeichnis

1. [Processor Overview](#1-processor-overview)
2. [Register Set](#2-register-set)  
3. [Instruction Set Summary](#3-instruction-set-summary)
4. [Detailed Instruction Formats](#4-detailed-instruction-formats)
5. [ALU Operations](#5-alu-operations)
6. [Programming Examples](#6-programming-examples)
7. [Memory Addressing](#7-memory-addressing)
8. [Interrupt Handling](#8-interrupt-handling)

---

## 1. Processor Overview

cMIN-16a is a 16-bit RISC processor with:
- **16-bit fixed-length instructions**
- **16 general-purpose registers**
- **Segmented memory addressing** (20-bit physical address space)
- **3-stage pipeline** design
- **Estimated CPI**: 1.05-1.15

### Key Features
- All instructions exactly 16 bits
- 16 user-visible registers
- 4 segment registers for memory management
- Compact encoding with variable-length opcodes
- Hardware multiply/divide support

---

## 2. Register Set

### 2.1 General Purpose Registers (16-bit)

| Register | Conventional Use |
|----------|------------------|
| R0       | LDI destination, temporary |
| R1-R13   | General purpose |
| R14      | Link Register (LR) |
| R15      | Program Counter (PC) |

### 2.2 Segment Registers

| Register | Purpose |
|----------|---------|
| DS       | Data Segment |
| CS       | Code Segment |
| SS       | Stack Segment |
| ES       | Extra Segment |

### 2.3 Status Register (Flags)

```
15                                              0
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
| | | | | | | | | | | | | | | | | | |I|C|V|Z|N|
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
                                  │  │  │  │  └─ Negative
                                  │  │  │  └─ Zero
                                  │  │  └─ Overflow  
                                  │  └─ Carry
                                  └─ Interrupt Enable
```

---

## 3. Instruction Set Summary

### Opcode Hierarchy

| Opcode | Instruction | Format | Description |
|--------|-------------|--------|-------------|
| 0      | LDI         | `[0][imm15]` | Load 15-bit immediate to R0 |
| 10     | LD/ST       | `[10][L/S][Seg][Rd][Base][offset2]` | Load/Store short offset |
| 110    | ALU         | `[110][op][Rd][w][i][Rs/imm4]` | Arithmetic/Logic operations |
| 1110   | JMP         | `[1110][type][target8]` | Jump and branch operations |
| 11110  | LSI         | `[11110][Rd][imm7]` | Load short immediate |
| 111110 | MOV         | `[111110][Rd][Rs][imm2]` | Move with offset |
| 1111110| SET/CLR     | `[1111110][S/C][bitmask8]` | Set/Clear flags |
| 111111110| MVS      | `[111111110][D][Rd][Seg]` | Move to/from segment |
| 1111111111110| SYS | `[1111111111110][op]` | System operations |

---

## 4. Detailed Instruction Formats

### 4.1 LDI - Load Long Immediate
```
[0][15-bit immediate]
```
**Effect**: `R0 ← immediate`

### 4.2 LD/ST - Load/Store Short Offset
```
[10][L/S][Seg2][Rd4][Base4][offset2]
```
- **L/S=0**: `Rd ← Mem[Seg:Base + offset]`
- **L/S=1**: `Mem[Seg:Base + offset] ← Rd`

### 4.3 ALU - Arithmetic/Logic Operations
```
[110][op3][Rd4][w1][i1][Rs/imm4]
```
- **i=0**: `Rd ← Rd op Rs` (if w=1)
- **i=1**: `Rd ← Rd op zero_extend(imm4)` (if w=1)
- **w=0**: Only flags are updated (for CMP/TST)

### 4.4 JMP - Jump/Branch Operations
```
[1110][type3][target8]
```

### 4.5 LSI - Load Short Immediate
```
[11110][Rd4][imm7]
```
**Effect**: `Rd ← sign_extend(imm7)`

### 4.6 MOV - Move with Offset
```
[111110][Rd4][Rs4][imm2]
```
**Effect**: `Rd ← Rs + sign_extend(imm2)`

### 4.7 SET/CLR - Set/Clear Flags
```
[1111110][S/C1][bitmask8]
```
- **S/C=1**: `Flags ← Flags | bitmask`
- **S/C=0**: `Flags ← Flags & ~bitmask`

### 4.8 MVS - Move to/from Segment
```
[111111110][D1][Rd4][Seg2]
```
- **D=0**: `Rd ← Segment[Seg]`
- **D=1**: `Segment[Seg] ← Rd`

### 4.9 SYS - System Operations
```
[1111111111110][op3]
```
- 000: NOP
- 001: HLT  
- 010: SWI
- 011-111: Reserved

---

## 5. ALU Operations

### 5.1 ALU Operation Codes

| op | Mnemonic | Description | Flags |
|----|----------|-------------|-------|
| 000 | ADD | Addition | N,Z,V,C |
| 001 | SUB | Subtraction | N,Z,V,C |
| 010 | AND | Logical AND | N,Z |
| 011 | OR | Logical OR | N,Z |
| 100 | XOR | Logical XOR | N,Z |
| 101 | MUL | Multiplication | N,Z |
| 110 | DIV | Division | N,Z |
| 111 | SHIFT | Shift operations | N,Z,C |

### 5.2 Shift Sub-operations (when op=111)

| imm4[3:2] | Operation | Description |
|-----------|-----------|-------------|
| 00 | SL | Shift Left |
| 01 | SR | Shift Right Logical |
| 10 | SRA | Shift Right Arithmetic |
| 11 | ROT | Rotate Right |

### 5.3 Condition Codes for JMP

| type | Mnemonic | Condition | Flags |
|------|----------|-----------|-------|
| 000 | JMP | Always | - |
| 001 | JZ | Zero | Z=1 |
| 010 | JNZ | Not Zero | Z=0 |
| 011 | JC | Carry | C=1 |
| 100 | JNC | No Carry | C=0 |
| 101 | JN | Negative | N=1 |
| 110 | JNN | Not Negative | N=0 |
| 111 | JRL | Register Indirect | - |

---

## 6. Programming Examples

### 6.1 Basic Arithmetic
```assembly
; Initialize registers
LDI 0x1234       ; R0 = 0x1234
MOV R1, R0, 0    ; R1 = R0
LSI R2, 100      ; R2 = 100

; Arithmetic operations
ADD R3, R1, R2   ; R3 = R1 + R2
SUB R4, R3, 10   ; R4 = R3 - 10
MUL R5, R2, R2   ; R5 = R2 * R2
```

### 6.2 Function Calls
```assembly
; Function call convention using R14 as LR
main:
    MOV R14, PC, 2    ; Set return address
    JMP function
    HLT               ; Halt after return

function:
    ; Function prologue
    ST R1, [SS:SP, -1]   ; Save register
    ; Function body
    ADD R1, R2, R3
    ; Function epilogue  
    LD R1, [SS:SP, -1]   ; Restore register
    JRL R14             ; Return
```

### 6.3 Memory Access
```assembly
; Array processing
LDI array_base   ; R0 = array base address
LSI R1, 0        ; R1 = index
LSI R2, 10       ; R2 = count

loop:
    MOV R3, R0, R1   ; R3 = base + index
    LD R4, [DS:R3, 0] ; Load array element
    ADD R4, R4, 1     ; Increment element
    ST R4, [DS:R3, 0] ; Store back
    ADD R1, R1, 1     ; Next index
    SUB R0, R1, R2, w=0 ; Compare index vs count
    JNZ loop          ; Loop if not zero
```

### 6.4 Flag Manipulation
```assembly
; Interrupt control
CLR 0x10          ; Disable interrupts (clear I flag)
; Critical section code
SET 0x10          ; Enable interrupts (set I flag)

; Arithmetic flags
ADD R1, R2, R3    ; Set flags based on R2 + R3
JC  carry_occurred ; Jump if carry
JN  negative_result ; Jump if negative
```

### 6.5 Segment Management
```assembly
; Setup memory segments
LDI 0x1000
MVS DS, R0        ; Data Segment = 0x1000

LDI 0x2000
MVS SS, R0        ; Stack Segment = 0x2000

; Access different segments
LD R1, [DS:R2, 0] ; Data segment access
LD R3, [CS:PC, 10] ; Code segment access
ST R4, [SS:SP, -1] ; Stack segment access
```

---

## 7. Memory Addressing

### 7.1 Segmented Addressing
**Physical Address = (Segment << 4) + Effective Address**

This provides a 20-bit physical address space (1MB) using 16-bit effective addresses.

### 7.2 Addressing Modes

1. **Short Offset**: Base register ± 3 bytes
   - Format: `[Seg:Base + offset2]`
   - Range: -3 to +0 bytes

2. **Medium Offset**: R0-based ±127 bytes  
   - Format: `[Seg:R0 + offset7]`
   - Range: -127 to +127 bytes

3. **PC-relative**: Via MOV instruction
   - `MOV Rd, PC, imm2` for small offsets
   - `LSI + ALU` for larger offsets

---

## 8. Interrupt Handling

### 8.1 Interrupt Vectors

| Address | Purpose |
|---------|---------|
| 0x0000 | Reset |
| 0x0004 | Software Interrupt (SWI) |
| 0x0008 | Hardware Interrupt |
| 0x000C | Exception |

### 8.2 Interrupt Service Routine
```assembly
interrupt_handler:
    ; Auto: I=0 on interrupt entry
    
    ; Save context
    ST R14, [SS:SP, -1]    ; Save return address
    ST R1, [SS:SP, -2]     ; Save working registers
    ST R2, [SS:SP, -3]
    
    ; Interrupt handling code
    ; ...
    
    ; Restore context
    LD R2, [SS:SP, -3]
    LD R1, [SS:SP, -2]
    LD R14, [SS:SP, -1]
    
    ; Return from interrupt
    SET 0x10               ; Re-enable interrupts
    JRL R14                ; Return
```

---

## Appendix A: Flag Bitmask Constants

```assembly
; Recommended constants for flag manipulation
N_FLAG  = 0x01  ; Negative flag
Z_FLAG  = 0x02  ; Zero flag
V_FLAG  = 0x04  ; Overflow flag  
C_FLAG  = 0x08  ; Carry flag
I_FLAG  = 0x10  ; Interrupt enable flag
```

## Appendix B: Performance Characteristics

- **Pipeline Stages**: 3 (Fetch, Decode, Execute)
- **Estimated CPI**: 1.05-1.15
- **Branch Penalty**: 2 cycles (misprediction)
- **Load-Use Stall**: 1 cycle

---

*cMIN-16a Architecture Specification - Complete*
