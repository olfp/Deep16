Perfekt! Hier ist die überarbeitete cMIN-16a Architecture Specification mit den neuen Befehlen und korrigierten SMV-Mnemonics:

# cMIN-16a Architecture Specification v2.5 (Milestone 1r3)
## 16-bit RISC Processor with Shadow Registers and Segmented Memory

---

## 📋 Inhaltsverzeichnis

1. [Processor Overview](#1-processor-overview)
2. [Register Set](#2-register-set)  
3. [Shadow Register System](#3-shadow-register-system)
4. [Instruction Set Summary](#4-instruction-set-summary)
5. [Detailed Instruction Formats](#5-detailed-instruction-formats)
6. [ALU Operations](#6-alu-operations)
7. [Programming Examples](#7-programming-examples)
8. [Interrupt Handling](#8-interrupt-handling)
9. [Memory Addressing](#9-memory-addressing)

---

## 1. Processor Overview

cMIN-16a is a 16-bit RISC processor with:
- **16-bit fixed-length instructions**
- **16 general-purpose registers** + **shadow registers**
- **Segmented memory addressing** (20-bit physical address space)
- **3-stage pipeline** design
- **Advanced interrupt handling** with automatic context switching

### Key Features
- All instructions exactly 16 bits
- 16 user-visible registers + PC'/PSW'/CS' shadow registers
- Hardware-assisted interrupt context switching
- 4 segment registers for memory management
- Compact encoding with variable-length opcodes
- Register-pair operations for MUL/DIV
- New SWB/INV instructions for data manipulation

---

## 2. Register Set

### 2.1 General Purpose Registers (16-bit)

| Register | Conventional Use |
|----------|------------------|
| R0       | LDI destination, temporary |
| R1-R13   | General purpose |
| R14      | Link Register (LR) |
| R15      | Program Counter (PC) |

### 2.2 Special Registers

| Register | Purpose |
|----------|---------|
| PSW      | Processor Status Word (Flags) |
| PC'      | Program Counter Shadow |
| PSW'     | Processor Status Word Shadow |
| CS'      | Code Segment Shadow |

### 2.3 Segment Registers

| Register | Code | Purpose |
|----------|------|---------|
| CS       | 00   | Code Segment |
| DS       | 01   | Data Segment |
| SS       | 10   | Stack Segment |
| ES       | 11   | Extra Segment |

### 2.4 Processor Status Word (PSW)

```
15                                              0
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
| | | | | | | | | | | | | | |I|S|C|V|Z|N|
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
                                  │  │  │  │  │  └─ Negative
                                  │  │  │  │  └─ Zero
                                  │  │  │  └─ Overflow  
                                  │  │  └─ Carry
                                  │  └─ In ISR (Shadow active)
                                  └─ Interrupt Enable
```

---

## 3. Shadow Register System

### 3.1 Automatic Context Switching

**On Interrupt:**
- `PC' ← PC` (Save current PC to shadow)
- `PSW' ← PSW` (Save current PSW to shadow)  
- `CS' ← CS` (Save current CS to shadow)
- `PC ← interrupt_vector`
- `CS ← interrupt_cs` (from interrupt vector table)
- `PSW.I ← 0` (Disable interrupts)
- `PSW.S ← 1` (Enter ISR mode)

**On RETI:**
- `PC ← PC'` (Restore PC from shadow)
- `PSW ← PSW'` (Restore PSW from shadow)
- `CS ← CS'` (Restore CS from shadow)
- `PSW.I ← 1` (Enable interrupts)
- `PSW.S ← 0` (Leave ISR mode)

### 3.2 SMV Befehl - Special Move

**Opcode:** 1111111110 (10-bit)
**Format:** `[1111111110][SRC2][DST4]`

#### SRC2 Codes - Context Dependent:

**Normal Mode (S=0):**
| SRC2 | Mnemonic | Effect |
|------|----------|--------|
| 00 | SMV DST, APC | `DST ← PC'` (inactive shadow) |
| 01 | SMV DST, APSW | `DST ← PSW'` (inactive shadow) |
| 10 | SMV DST, PSW | `DST ← PSW` (active) |
| 11 | SMV DST, ACS | `DST ← CS'` (inactive shadow) |

**ISR Mode (S=1):**
| SRC2 | Mnemonic | Effect |
|------|----------|--------|
| 00 | SMV DST, PC | `DST ← PC` (inactive normal) |
| 01 | SMV DST, PSW | `DST ← PSW` (active) |
| 10 | SMV DST, APSW | `DST ← PSW'` (inactive shadow) |
| 11 | SMV DST, CS | `DST ← CS` (inactive normal) |

---

## 4. Instruction Set Summary

### Opcode Hierarchy

| Opcode | Instruction | Format | Description |
|--------|-------------|--------|-------------|
| 0 | LDI | `[0][imm15]` | Load 15-bit immediate to R0 |
| 10 | LD/ST | `[10][L/S][Seg][Rd][Base][offset2]` | Load/Store short offset (0-3) |
| 110 | ALU | `[110][op][Rd][w][i][Rs/imm4]` | Arithmetic/Logic operations |
| 1110 | JMP | `[1110][type][target8]` | Jump and branch operations |
| 11110 | LSI | `[11110][Rd][imm7]` | Load short immediate |
| 111110 | MOV | `[111110][Rd][Rs][imm2]` | Move with offset |
| 1111110 | SET/CLR | `[1111110][S/C][bitmask8]` | Set/Clear flags |
| 111111110 | MVS | `[111111110][D][Rd][Seg]` | Move to/from segment |
| 1111111110 | SMV | `[1111111110][SRC][DST]` | Special move |
| **11111111110** | **SWB/INV** | `[11111111110][S][Rx]` | **Swap Bytes / Invert** |
| 111111111110 | LJMP | `[111111111110][Rs]` | Long Jump between segments |
| 1111111111110 | SYS | `[1111111111110][op]` | System operations |

### Shift Instructions (Kompakte Form)
| Instruction | Format | Description |
|-------------|--------|-------------|
| SL | `SL Rd, count3` | Shift Left |
| SLC | `SLC Rd, count3` | Shift Left with Carry |
| SR | `SR Rd, count3` | Shift Right Logical |
| SRC | `SRC Rd, count3` | Shift Right with Carry |
| SRA | `SRA Rd, count3` | Shift Right Arithmetic |
| SAC | `SAC Rd, count3` | Shift Arithmetic with Carry |
| ROR | `ROR Rd, count3` | Rotate Right |
| ROC | `ROC Rd, count3` | Rotate with Carry |

### Neue SWB/INV Befehle
| Instruction | Format | Description |
|-------------|--------|-------------|
| SWB | `SWB Rx` | Swap high and low bytes of Rx |
| INV | `INV Rx` | Invert all bits of Rx (ones complement) |

---

## 5. Detailed Instruction Formats

### 5.1 LDI - Load Long Immediate
```
[0][15-bit immediate]
```
**Effect**: `R0 ← immediate`

### 5.2 LD/ST - Load/Store Short Offset
```
[10][L/S][Seg2][Rd4][Base4][offset2]
```
- **L/S=0**: `Rd ← Mem[Seg:Base + offset]`
- **L/S=1**: `Mem[Seg:Base + offset] ← Rd`
- **offset**: 0-3 (2-bit unsigned immediate)

### 5.3 ALU - Arithmetic/Logic Operations
```
[110][op3][Rd4][w1][i1][Rs/imm4]
```
- **i=0**: `Rd ← Rd op Rs` (if w=1)
- **i=1**: `Rd ← Rd op zero_extend(imm4)` (if w=1)
- **w=0**: Only flags are updated (for CMP/TST)

### 5.4 Shift Instructions
```
[110][111][Rd4][C1][T2][count3]
```
- **C=0**: Normal shift
- **C=1**: Include carry flag in operation
- **T=00**: SL/SLC
- **T=01**: SR/SRC  
- **T=10**: SRA/SAC
- **T=11**: ROR/ROC

### 5.5 JMP - Jump/Branch Operations
```
[1110][type3][target8]
```

### 5.6 LSI - Load Short Immediate
```
[11110][Rd4][imm7]
```
**Effect**: `Rd ← sign_extend(imm7)`

### 5.7 MOV - Move with Offset
```
[111110][Rd4][Rs4][imm2]
```
**Effect**: `Rd ← Rs + zero_extend(imm2)`

### 5.8 SET/CLR - Set/Clear Flags
```
[1111110][S/C1][bitmask8]
```
- **S/C=1**: `PSW ← PSW | bitmask`
- **S/C=0**: `PSW ← PSW & ~bitmask`

### 5.9 MVS - Move to/from Segment
```
[111111110][D1][Rd4][Seg2]
```
- **D=0**: `Rd ← Segment[Seg]`
- **D=1**: `Segment[Seg] ← Rd`

### 5.10 SMV - Special Move
```
[1111111110][SRC2][DST4]
```
**Context-dependent access to shadow/normal registers**

### 5.11 SWB/INV - Swap Bytes / Invert
```
[11111111110][S1][Rx4]
```
- **S=0**: `SWB Rx` - Swap high and low bytes of Rx
- **S=1**: `INV Rx` - Invert all bits of Rx (ones complement)

### 5.12 LJMP - Long Jump
```
[111111111110][Rs4]
```
**Effect**: 
- `CS ← Mem[Rs]` (Load new Code Segment)
- `PC ← Mem[Rs+1]` (Load new Program Counter address)

### 5.13 SYS - System Operations
```
[1111111111110][op3]
```
- 000: NOP
- 001: HLT  
- 010: SWI
- 011: RETI (Return from interrupt)
- 100-111: Reserved

---

## 6. ALU Operations

### 6.1 ALU Operation Codes

| op | Mnemonic | Description | Flags | Register-Paar |
|----|----------|-------------|-------|---------------|
| 000 | ADD | Addition | N,Z,V,C | - |
| 001 | SUB | Subtraction | N,Z,V,C | - |
| 010 | AND | Logical AND | N,Z | - |
| 011 | OR | Logical OR | N,Z | - |
| 100 | XOR | Logical XOR | N,Z | - |
| 101 | MUL | Multiplication | N,Z | **Rd (even) + Rd+1** |
| 110 | DIV | Division | N,Z | **Rd (even) + Rd+1** |
| 111 | Shift | Shift operations | N,Z,C | - |

### 6.2 Shift Instruction Mapping

| Mnemonic | Type | Carry | Description |
|----------|------|-------|-------------|
| SL | 00 | 0 | Shift Left |
| SLC | 00 | 1 | Shift Left with Carry |
| SR | 01 | 0 | Shift Right Logical |
| SRC | 01 | 1 | Shift Right with Carry |
| SRA | 10 | 0 | Shift Right Arithmetic |
| SAC | 10 | 1 | Shift Arithmetic with Carry |
| ROR | 11 | 0 | Rotate Right |
| ROC | 11 | 1 | Rotate with Carry |

### 6.3 SWB/INV Operations

| Instruction | Effect | Example |
|-------------|--------|---------|
| SWB Rx | `Rx[15:8] ↔ Rx[7:0]` | `0x1234 → 0x3412` |
| INV Rx | `Rx ← ~Rx` | `0x00FF → 0xFF00` |

### 6.4 MUL/DIV Register-Paar Konvention

**Für MUL und DIV wird immer ein gerades Register (Rd) angegeben:**
- **Rd muss gerade sein** (0, 2, 4, ..., 14)
- **Ergebnis wird in Register-Paar Rd:Rd+1 gespeichert**

### 6.5 Condition Codes for JMP

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

## 7. Programming Examples

### 7.1 Basic Arithmetic and Control Flow
```assembly
; Initialize and function calls
LDI 0x1234       ; R0 = 0x1234
MOV R1, R0, 0    ; R1 = R0
LSI R2, 100      ; R2 = 100

; Function call
MOV R14, PC, 2   ; Set return address
JMP function

function:
    ADD R3, R1, R2   ; R3 = R1 + R2
    SUB R0, R3, 50, w=0  ; Compare R3 with 50
    JN  less_than
    JRL R14           ; Return

less_than:
    ; Handle less than case
    JRL R14
```

### 7.2 New SWB/INV Instructions
```assembly
; Byte swapping examples
LDI 0x1234
MOV R1, R0, 0    ; R1 = 0x1234
SWB R1           ; R1 = 0x3412

LDI 0x00FF
MOV R2, R0, 0    ; R2 = 0x00FF
INV R2           ; R2 = 0xFF00

; Combined operations
LDI 0xA5A5
MOV R3, R0, 0    ; R3 = 0xA5A5
SWB R3           ; R3 = 0xA5A5 (unchanged)
INV R3           ; R3 = 0x5A5A

; Useful for endianness conversion
LD R4, [DS:R5, 0] ; Load 16-bit value
SWB R4            ; Convert endianness
ST R4, [DS:R6, 0] ; Store converted
```

### 7.3 MUL/DIV with Register Pairs
```assembly
; 32-bit Multiplication
LDI 0x1234
MOV R2, R0, 0      ; R2 = 0x1234
LSI R3, 0x5678     ; R3 = 0x5678 
LDI 0x1000
MOV R4, R0, 0      ; R4 = 0x1000

; R2:R3 * R4 = R0:R1 (64-bit result)
MUL R0, R4         ; R0:R1 = R2:R3 * R4

; 32-bit Division  
LSI R5, 100        ; R5 = 100
DIV R4, R5         ; R4:R5 = R2:R3 / R5
```

### 7.4 Shift Operations (Kompakte Form)
```assembly
; Basic shifts
SL R1, 3           ; R1 = R1 << 3
SR R2, 2           ; R2 = R2 >> 2 (logical)
SRA R3, 1          ; R3 = R3 >>> 1 (arithmetic)
ROR R4, 4          ; R4 = R4 rot>> 4

; Shifts with carry
SLC R1, 2          ; R1 = (R1 << 2) | (C << 0)
SRC R2, 3          ; R2 = (R2 >> 3) | (C << 15)
SAC R3, 1          ; R3 = (R3 >>> 1) | (C << 15)
ROC R4, 2          ; R4 = (R4 rot>> 2) | (C << 15)
```

### 7.5 Memory Access with Correct Offset Range
```assembly
; LD/ST with 0-3 offset only
LD R1, [DS:R2, 0]    ; Load from base + 0
LD R3, [DS:R2, 1]    ; Load from base + 1
ST R4, [DS:R5, 2]    ; Store to base + 2
ST R6, [DS:R7, 3]    ; Store to base + 3

; For larger offsets, use MOV + LD/ST
MOV R8, R2, 0        ; R8 = R2 + 0
LD R9, [DS:R8, 0]    ; Equivalent to offset 0

MOV R10, R2, 1       ; R10 = R2 + 1  
LD R11, [DS:R10, 0]  ; Equivalent to offset 1
```

### 7.6 Advanced Interrupt Handling with SMV
```assembly
; Interrupt Vector Table
.org 0x0008
    JMP advanced_irq_handler

advanced_irq_handler:
    ; AUTO: PC'=original PC, PSW'=original PSW, CS'=original CS, S=1, I=0
    
    ; Complete context save
    ST R1, [SS:SP, 0]
    ST R2, [SS:SP, 1]
    
    ; Save full pre-interrupt state for debugging
    SMV R3, PC       ; R3 = original PC (inactive normal)
    ST R3, [SS:SP, 2]
    SMV R4, PSW      ; R4 = current PSW (active)  
    ST R4, [SS:SP, 3]
    SMV R5, CS       ; R5 = original CS (inactive normal)
    ST R5, [SS:SP, 0] ; Overwrite R1 save (example)
    
    ; Complex ISR logic
    ; ...
    
    ; Restore context
    LD R2, [SS:SP, 1]
    LD R1, [SS:SP, 0]
    
    RETI  ; Auto: PC=PC', PSW=PSW', CS=CS', I=1, S=0
```

### 7.7 Cross-Segment Jumps with LJMP
```assembly
; Long Jump between Code Segments
.org 0x1000  ; Segment CS=1
    LDI jump_table
    MOV R2, R0, 0     ; R2 points to Jump-Table
    LJMP R2           ; Switch to CS=2, PC=0x2000

.org 0x0000  ; Segment CS=2  
    ; Code in new segment...
    LDI return_table
    MOV R3, R0, 0
    LJMP R3           ; Return to original segment

; Jump-Tables in Data-Segment
.org 0x3000  ; DS=3
jump_table:
    .dw 2             ; New CS
    .dw 0x0000        ; New PC (start of CS=2)

return_table:
    .dw 1             ; Original CS  
    .dw 0x1002        ; Return address
```

---

## 8. Interrupt Handling

### 8.1 Extended Interrupt Vector Table

| Address | CS:PC | Purpose |
|---------|-------|---------|
| 0x0000:0000 | CS=0, PC=0x0000 | Reset |
| 0x0000:0004 | CS=0, PC=0x0010 | Software Interrupt (SWI) |
| 0x0000:0008 | CS=0, PC=0x0020 | Hardware Interrupt |
| 0x0000:000C | CS=0, PC=0x0030 | Exception |

---

## 9. Memory Addressing

### 9.1 Segmented Addressing
**Physical Address = (Segment << 4) + Effective Address**

20-bit physical address space (1MB) using 16-bit effective addresses.

### 9.2 Addressing Modes

1. **Short Offset**: Base register + 0-3 bytes
   - Format: `[Seg:Base + offset2]`
   - **Range: 0 to 3 only** (2-bit unsigned immediate)

2. **Medium Offset**: R0-based + 0-127 bytes  
   - Format: `[Seg:R0 + offset7]`
   - Range: 0 to +127 bytes

3. **PC-relative**: Via MOV instruction
   - `MOV Rd, PC, imm2` for small offsets (0-3)
   - `LSI + ALU` for larger offsets

---

*cMIN-16a Architecture Specification v2.5 (Milestone 1r3) - With SWB/INV instructions and corrected SMV mnemonics*
