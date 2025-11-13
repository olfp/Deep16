# cMIN-16a Architecture Specification v2.1
## A 16-bit RISC Processor with Shadow Registers

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
- 16 user-visible registers + PC/PSW shadow registers
- Hardware-assisted interrupt context switching
- 4 segment registers for memory management
- Compact encoding with variable-length opcodes

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

### 2.3 Segment Registers

| Register | Purpose |
|----------|---------|
| DS       | Data Segment |
| CS       | Code Segment |
| SS       | Stack Segment |
| ES       | Extra Segment |

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
- `PC ← interrupt_vector`
- `PSW.I ← 0` (Disable interrupts)
- `PSW.S ← 1` (Enter ISR mode)

**On RETI:**
- `PC ← PC'` (Restore PC from shadow)
- `PSW ← PSW'` (Restore PSW from shadow)
- `PSW.I ← 1` (Enable interrupts)
- `PSW.S ← 0` (Leave ISR mode)

### 3.2 SMV Befehl - Special Move

**Opcode:** 1111111110 (10-bit)
**Format:** `[1111111110][SRC2][DST4]`

#### SRC2 Codes - Context Dependent:

**Normal Mode (S=0):**
| SRC2 | Mnemonic | Effect |
|------|----------|--------|
| 00 | SMV DST, PC' | `DST ← PC'` |
| 01 | SMV DST, PSW' | `DST ← PSW'` |
| 10 | SMV DST, PSW | `DST ← PSW` |
| 11 | reserved | |

**ISR Mode (S=1):**
| SRC2 | Mnemonic | Effect |
|------|----------|--------|
| 00 | SMV DST, PC | `DST ← PC` |
| 01 | SMV DST, PSW | `DST ← PSW` |
| 10 | SMV DST, PSW' | `DST ← PSW'` |
| 11 | reserved | |

---

## 4. Instruction Set Summary

### Opcode Hierarchy

| Opcode | Instruction | Format | Description |
|--------|-------------|--------|-------------|
| 0 | LDI | `[0][imm15]` | Load 15-bit immediate to R0 |
| 10 | LD/ST | `[10][L/S][Seg][Rd][Base][offset2]` | Load/Store short offset |
| 110 | ALU | `[110][op][Rd][w][i][Rs/imm4]` | Arithmetic/Logic operations |
| 1110 | JMP | `[1110][type][target8]` | Jump and branch operations |
| 11110 | LSI | `[11110][Rd][imm7]` | Load short immediate |
| 111110 | MOV | `[111110][Rd][Rs][imm2]` | Move with offset |
| 1111110 | SET/CLR | `[1111110][S/C][bitmask8]` | Set/Clear flags |
| 111111110 | MVS | `[111111110][D][Rd][Seg]` | Move to/from segment |
| 1111111110 | **SMV** | `[1111111110][SRC][DST]` | **Special move** |
| 1111111111110 | SYS | `[1111111111110][op]` | System operations |

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

### 5.3 ALU - Arithmetic/Logic Operations
```
[110][op3][Rd4][w1][i1][Rs/imm4]
```
- **i=0**: `Rd ← Rd op Rs` (if w=1)
- **i=1**: `Rd ← Rd op zero_extend(imm4)` (if w=1)
- **w=0**: Only flags are updated (for CMP/TST)

### 5.4 SHIFT - Shift Operations (ALU op=111)
```
[110][111][Rd4][C1][T2][count3]
```
- **C=0**: `Rd ← Rd shift count`
- **C=1**: `Rd ← (Rd shift count) | (C << appropriate_position)`
- **T=00**: SL (Shift Left)
- **T=01**: SR (Shift Right Logical)
- **T=10**: SRA (Shift Right Arithmetic)
- **T=11**: ROT (Rotate Right)

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

### 5.11 SYS - System Operations
```
[1111111111110][op3]
```
- 000: NOP
- 001: HLT  
- 010: SWI
- 011: **RETI** (Return from interrupt)
- 100-111: Reserved

---

## 6. ALU Operations

### 6.1 ALU Operation Codes

| op | Mnemonic | Description | Flags |
|----|----------|-------------|-------|
| 000 | ADD | Addition | N,Z,V,C |
| 001 | SUB | Subtraction | N,Z,V,C |
| 010 | AND | Logical AND | N,Z |
| 011 | OR | Logical OR | N,Z |
| 100 | XOR | Logical XOR | N,Z |
| 101 | MUL | Multiplication | N,Z |
| 110 | DIV | Division | N,Z |
| **111** | **SHIFT** | **Shift operations** | **N,Z,C** |

### 6.2 Shift Operations (when op=111)

**Format:** `[110][111][Rd4][C1][T2][count3]`

**Shift Types (T2):**
| T | Operation | Description |
|---|-----------|-------------|
| 00 | SL | Shift Left |
| 01 | SR | Shift Right Logical |
| 10 | SRA | Shift Right Arithmetic |
| 11 | ROT | Rotate Right |

**Carry Flag (C1):**
- **C=0**: Normal shift
- **C=1**: Include carry flag in operation

**Count (count3):** Shift distance 0-7

### 6.3 Condition Codes for JMP

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

### 7.2 Shift Operations
```assembly
; Basic shifts without carry
SHIFT R1, SL, 3, C=0    ; R1 = R1 << 3
SHIFT R2, SR, 2, C=0    ; R2 = R2 >> 2 (logical)
SHIFT R3, SRA, 1, C=0   ; R3 = R3 >>> 1 (arithmetic)
SHIFT R4, ROT, 4, C=0   ; R4 = R4 rot>> 4

; Shifts with carry inclusion
SHIFT R1, SL, 2, C=1    ; R1 = (R1 << 2) | (C << 0)
SHIFT R2, SR, 3, C=1    ; R2 = (R2 >> 3) | (C << 15)

; Multi-byte shift operations
SHIFT R1, SL, 7, C=0    ; R1 << 7
SHIFT R1, SL, 3, C=0    ; R1 << 3 (total << 10)

; Shift loops for larger distances
LSI R5, 15              ; Large shift distance
big_shift:
    SHIFT R6, SL, 1, C=0
    SUB R5, R5, 1, w=0
    JNZ big_shift
```

### 7.3 Advanced Interrupt Handling with SMV
```assembly
; Interrupt Vector Table
.org 0x0008
    JMP advanced_irq_handler

advanced_irq_handler:
    ; AUTO: PC'=original PC, PSW'=original PSW, S=1, I=0
    
    ; Complete context save
    ST R1, [SS:SP, -1]
    ST R2, [SS:SP, -2]
    
    ; Save full pre-interrupt state for debugging
    SMV R3, PC       ; R3 = original PC (before interrupt)
    ST R3, [SS:SP, -3]
    SMV R4, PSW      ; R4 = original PSW (before interrupt)  
    ST R4, [SS:SP, -4]
    SMV R5, PSW'     ; R5 = shadow PSW (for debug)
    ST R5, [SS:SP, -5]
    
    ; Complex ISR logic with full context awareness
    ; ...
    
    ; Restore context
    LD R5, [SS:SP, -5]
    LD R4, [SS:SP, -4]
    LD R3, [SS:SP, -3]
    LD R2, [SS:SP, -2]
    LD R1, [SS:SP, -1]
    
    RETI  ; Auto: PC=PC', PSW=PSW', I=1, S=0
```

### 7.4 Debugging and System Analysis
```assembly
; Debug routine to examine system state
debug_system:
    ; Examine shadow registers (normal mode)
    SMV R1, PC'      ; R1 = last saved PC (from previous interrupt)
    SMV R2, PSW'     ; R2 = last saved PSW
    SMV R3, PSW      ; R3 = current PSW
    
    ; Check if we're in ISR mode
    AND R0, R3, 0x20, w=0  ; Test S flag
    JNZ in_isr_mode
    
    ; Normal mode debug output
    ; ...
    JRL R14

in_isr_mode:
    ; ISR mode debug - different register access
    SMV R4, PC       ; R4 = normal PC (interrupted code)
    SMV R5, PSW      ; R5 = normal PSW (interrupted state)
    ; ...
```

### 7.5 Memory Management
```assembly
; Segment setup and memory access
LDI 0x1000
MVS DS, R0        ; Data Segment = 0x1000

LDI 0x2000  
MVS SS, R0        ; Stack Segment = 0x2000

; Array processing with segments
LSI R1, 0         ; index
LSI R2, 10        ; count
loop:
    MOV R3, R0, R1   ; R3 = base + index
    LD R4, [DS:R3, 0] ; Load from data segment
    ADD R4, R4, 1     ; Process
    ST R4, [DS:R3, 0] ; Store back
    ADD R1, R1, 1     ; Next
    SUB R0, R1, R2, w=0 ; Compare
    JNZ loop
```

### 7.6 Flag Manipulation
```assembly
; Interrupt control and flag management
CLR 0x10          ; Disable interrupts
; Critical section
SET 0x10          ; Enable interrupts

; Arithmetic flag checks
ADD R1, R2, R3    ; Set flags
JC  carry_occurred
JN  negative_result

; Complex flag operations
SET 0x08          ; Set Carry flag
CLR 0x07          ; Clear N,Z,V flags
```

---

## 8. Interrupt Handling

### 8.1 Interrupt Vectors

| Address | Purpose |
|---------|---------|
| 0x0000 | Reset |
| 0x0004 | Software Interrupt (SWI) |
| 0x0008 | Hardware Interrupt |
| 0x000C | Exception |

### 8.2 Simple Interrupt Handler
```assembly
simple_irq:
    ; AUTO: Context already saved in shadows!
    ST R1, [SS:SP, -1]  ; Only save working registers
    ST R2, [SS:SP, -2]
    
    ; Quick ISR processing
    ; ...
    
    LD R2, [SS:SP, -2]
    LD R1, [SS:SP, -1]
    RETI  ; Auto context restore
```

### 8.3 Nested Interrupt Considerations
```assembly
nested_irq_handler:
    ; In ISR (S=1), another interrupt occurs
    ; AUTO: New PC' = current PC, new PSW' = current PSW
    ; Can use SMV to access previous interrupt state
    SMV R6, PSW'     ; R6 = PSW from first interrupt
    ; Handle nested interrupt
    RETI  ; Returns to first ISR, which can then RETI to main
```

---

## 9. Memory Addressing

### 9.1 Segmented Addressing
**Physical Address = (Segment << 4) + Effective Address**

20-bit physical address space (1MB) using 16-bit effective addresses.

### 9.2 Addressing Modes

1. **Short Offset**: Base register + 0-3 bytes
   - Format: `[Seg:Base + offset2]`
   - Range: 0 to +3 bytes

2. **Medium Offset**: R0-based + 0-127 bytes  
   - Format: `[Seg:R0 + offset7]`
   - Range: 0 to +127 bytes

3. **PC-relative**: Via MOV instruction
   - `MOV Rd, PC, imm2` for small offsets
   - `LSI + ALU` for larger offsets

---

## Appendix A: Flag Bitmask Constants

```assembly
; Recommended constants for flag manipulation
N_FLAG  = 0x01  ; Negative flag
Z_FLAG  = 0x02  ; Zero flag
V_FLAG  = 0x04  ; Overflow flag  
C_FLAG  = 0x08  ; Carry flag
S_FLAG  = 0x10  ; In ISR flag
I_FLAG  = 0x20  ; Interrupt enable flag
```

## Appendix B: SMV Usage Reference

### Normal Mode (S=0):
- `SMV Rd, PC'` - Read shadow PC (from last interrupt)
- `SMV Rd, PSW'` - Read shadow PSW (from last interrupt)
- `SMV Rd, PSW` - Read current PSW

### ISR Mode (S=1):
- `SMV Rd, PC` - Read normal PC (interrupted code)
- `SMV Rd, PSW` - Read normal PSW (interrupted state)  
- `SMV Rd, PSW'` - Read shadow PSW (previous interrupt context)

## Appendix C: Shift Operation Reference

### Shift Types:
- **SL**: Shift Left - Fill with zeros from right
- **SR**: Shift Right Logical - Fill with zeros from left  
- **SRA**: Shift Right Arithmetic - Sign extend from left
- **ROT**: Rotate Right - Circular shift

### Carry Flag Usage:
- **C=0**: Normal shift operation
- **C=1**: Include carry flag in least/most significant bit

### Count Range: 0-7 positions

## Appendix D: Performance Characteristics

- **Pipeline Stages**: 3 (Fetch, Decode, Execute)
- **Estimated CPI**: 1.05-1.15
- **Branch Penalty**: 2 cycles (misprediction)
- **Load-Use Stall**: 1 cycle
- **Interrupt Latency**: 3 cycles (with auto context save)
- **Shift Operations**: 1 cycle (all types)

---

*cMIN-16a Architecture Specification v2.1 - Complete with Corrected Shift Operations*
