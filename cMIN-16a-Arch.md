# cMIN-16a Architecture Specification v2.6 (Milestone 1r4)
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
- **Segmented memory addressing** (2MB physical address space)
- **3-stage pipeline** design
- **Advanced interrupt handling** with access switching

### Key Features
- All instructions exactly 16 bits
- 16 user-visible registers + PC/PSW shadow views
- Hardware-assisted interrupt context switching
- 4 segment registers for memory management
- Compact encoding with variable-length opcodes
- Register-pair operations for MUL/DIV
- Complete word-based memory addressing

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
| PC'      | Program Counter Shadow View |
| PSW'     | Processor Status Word Shadow View |

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
                                  │  └─ In ISR (Shadow View active)
                                  └─ Interrupt Enable
```

---

## 3. Shadow Register System

### 3.1 Access Switching (No Data Copying)

**Hardware Implementation:**
- **Single set of physical registers** (PC, PSW)
- **S-flag in PSW** controls whether "Normal" or "Shadow" view is accessed
- **No actual data copying** during interrupts

### 3.2 Automatic Context Switching

**On Interrupt:**
- `PSW.S ← 1` (Switch to Shadow View)
- `PC ← interrupt_vector` (Write to Shadow PC in Shadow Mode)
- `CS ← 0` (Interrupts always run in Segment 0)
- `PSW.I ← 0` (Disable interrupts)

**On RETI:**
- `PSW.S ← 0` (Switch back to Normal View)
- `PSW.I ← 1` (Enable interrupts)

### 3.3 SMV Instruction - Special Move

**Opcode:** 1111111110 (10-bit)
**Format:** `[1111111110][SRC2][DST4]`

#### SRC2 Codes - Access to non-active registers:

**Normal Mode (S=0):**
| SRC2 | Mnemonic | Effect |
|------|----------|--------|
| 00 | SMV DST, APC | `DST ← PC'` (Shadow PC) |
| 01 | SMV DST, APSW | `DST ← PSW'` (Shadow PSW) |
| 10 | SMV DST, PSW | `DST ← PSW` (Normal PSW) |
| 11 | **reserved** | |

**ISR Mode (S=1):**
| SRC2 | Mnemonic | Effect |
|------|----------|--------|
| 00 | SMV DST, PC | `DST ← PC` (Normal PC) |
| 01 | SMV DST, PSW | `DST ← PSW` (Shadow PSW) |
| 10 | SMV DST, APSW | `DST ← PSW'` (Normal PSW) |
| 11 | **reserved** | |

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
| 11111111110 | SWB/INV | `[11111111110][S][Rx]` | Swap Bytes / Invert |
| 111111111110 | LJMP | `[111111111110][Rs]` | Long Jump between segments |
| 1111111111110 | SYS | `[1111111111110][op]` | System operations |

### Shift Instructions (Compact Form)
| Instruction | Format | Description |
|-------------|--------|-------------|
| SL | `SL Rd, count` | Shift Left |
| SLC | `SLC Rd, count` | Shift Left with Carry |
| SR | `SR Rd, count` | Shift Right Logical |
| SRC | `SRC Rd, count` | Shift Right with Carry |
| SRA | `SRA Rd, count` | Shift Right Arithmetic |
| SAC | `SAC Rd, count` | Shift Arithmetic with Carry |
| ROR | `ROR Rd, count` | Rotate Right |
| ROC | `ROC Rd, count` | Rotate with Carry |

### SWB/INV Instructions
| Instruction | Format | Description |
|-------------|--------|-------------|
| SWB | `SWB Rx` | Swap high and low bytes of Rx |
| INV | `INV Rx` | Invert all bits of Rx (ones complement) |

---

## 5. Detailed Instruction Formats

### 5.1 LDI - Load Long Immediate
```
[0][imm15]
```
**Effect**: `R0 ← immediate`
**Operands**: 1 (immediate)

### 5.2 LD/ST - Load/Store Short Offset
```
[10][L/S][Seg2][Rd4][Base4][offset2]
```
- **L/S=0**: `Rd ← Mem[Seg:Base + offset]`
- **L/S=1**: `Mem[Seg:Base + offset] ← Rd`
- **offset**: 0-3 (2-bit unsigned immediate)
**Operands**: 2 (Rd, [Seg:Base,offset])

### 5.3 ALU - Arithmetic/Logic Operations
```
[110][op3][Rd4][w1][i1][Rs/imm4]
```
- **i=0**: `Rd ← Rd op Rs` (if w=1)
- **i=1**: `Rd ← Rd op zero_extend(imm4)` (if w=1)
- **w=0**: Only flags are updated (for CMP/TST)
**Operands**: 2-3 (Rd, Rs/imm, [w=0])

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
**Operands**: 2 (Rd, count)

### 5.5 JMP - Jump/Branch Operations
```
[1110][type3][target8]
```
**Operands**: 1 (target)

### 5.6 LSI - Load Short Immediate
```
[11110][Rd4][imm7]
```
**Effect**: `Rd ← sign_extend(imm7)`
**Operands**: 2 (Rd, imm)

### 5.7 MOV - Move with Offset
```
[111110][Rd4][Rs4][imm2]
```
**Effect**: `Rd ← Rs + zero_extend(imm2)`
**Operands**: 3 (Rd, Rs, imm)

### 5.8 SET/CLR - Set/Clear Flags
```
[1111110][S/C1][bitmask8]
```
- **S/C=1**: `PSW ← PSW | bitmask`
- **S/C=0**: `PSW ← PSW & ~bitmask`
**Operands**: 1 (bitmask)

### 5.9 MVS - Move to/from Segment
```
[111111110][D1][Rd4][Seg2]
```
- **D=0**: `Rd ← Segment[Seg]`
- **D=1**: `Segment[Seg] ← Rd`
**Operands**: 2 (Segment, Rd) or (Rd, Segment)

### 5.10 SMV - Special Move
```
[1111111110][SRC2][DST4]
```
**Context-dependent access to shadow/normal registers**
**Operands**: 2 (SRC, DST)

### 5.11 SWB/INV - Swap Bytes / Invert
```
[11111111110][S1][Rx4]
```
- **S=0**: `SWB Rx` - Swap high and low bytes of Rx
- **S=1**: `INV Rx` - Invert all bits of Rx (ones complement)
**Operands**: 1 (Rx)

### 5.12 LJMP - Long Jump
```
[111111111110][Rs4]
```
**Effect**: 
- `CS ← Mem[Rs]` (Load new Code Segment)
- `PC ← Mem[Rs+1]` (Load new Program Counter address)
**Operands**: 1 (Rs)

### 5.13 SYS - System Operations
```
[1111111111110][op3]
```
- 000: NOP
- 001: HLT  
- 010: SWI
- 011: RETI (Return from interrupt)
- 100-111: Reserved
**Operands**: 0

---

## 6. ALU Operations

### 6.1 ALU Operation Codes

| op | Mnemonic | Description | Flags | Register-Pair |
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

### 6.4 MUL/DIV Register-Pair Convention

**For MUL and DIV, always specify an even register (Rd):**
- **Rd must be even** (0, 2, 4, ..., 14)
- **Result is stored in register pair Rd:Rd+1**

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
MOV R14, PC, 2   ; Set return address (R14 = PC + 2)
JMP function     ; Jump to function

function:
    ADD R3, R1, R2   ; R3 = R1 + R2
    SUB R0, R3, 50, w=0  ; Compare R3 with 50 (w=0 for flags only)
    JN  less_than     ; Jump if negative
    JRL R14           ; Return

less_than:
    ; Handle less than case
    JRL R14           ; Return
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

; Useful for endianness conversion
LD R4, [DS:R5, 0] ; Load 16-bit value
SWB R4            ; Convert endianness
ST R4, [DS:R6, 0] ; Store converted
```

### 7.3 MUL/DIV with Register Pairs
```assembly
; 32-bit Multiplication
LDI 0x1234
MOV R2, R0, 0      ; R2 = 0x1234 (high word)
LSI R3, 0x5678     ; R3 = 0x5678 (low word)
LDI 100
MOV R4, R0, 0      ; R4 = 100

; R2:R3 * R4 = R0:R1 (64-bit result)
MUL R0, R4         ; R0:R1 = R2:R3 * R4

; 32-bit Division  
DIV R2, R4         ; R2:R3 = R2:R3 / R4
```

### 7.4 Shift Operations (Compact Form)
```assembly
; Basic shifts
SL R1, 3           ; R1 = R1 << 3
SR R2, 2           ; R2 = R2 >> 2 (logical)
SRA R3, 1          ; R3 = R3 >>> 1 (arithmetic)
ROR R4, 4          ; R4 = R4 rot>> 4

; Shifts with carry
SLC R1, 2          ; R1 = (R1 << 2) | (C << 0)
SRC R2, 3          ; R2 = (R2 >> 3) | (C << 15)
```

### 7.5 Memory Access with Correct Offset Range
```assembly
; LD/ST with 0-3 offset only
LD R1, [DS:R2, 0]    ; Load from base + 0 words
LD R3, [DS:R2, 1]    ; Load from base + 1 word
ST R4, [DS:R5, 2]    ; Store to base + 2 words
ST R6, [DS:R7, 3]    ; Store to base + 3 words

; For larger offsets, use MOV + LD/ST
MOV R8, R2, 4        ; R8 = R2 + 4 words
LD R9, [DS:R8, 0]    ; Load from R2 + 4 words
```

### 7.6 Advanced Interrupt Handling with SMV
```assembly
; Interrupt Vector Table
.org 0x0000
    JMP irq_handler

irq_handler:
    ; AUTO: Switched to Shadow View, CS=0
    
    ; Save working registers
    ST R1, [SS:SP, 0]
    ST R2, [SS:SP, 1]
    
    ; Debug: examine pre-interrupt state
    SMV R3, PC       ; R3 = original PC (normal view, now inactive)
    ST R3, [SS:SP, 2]
    SMV R4, PSW      ; R4 = current PSW (shadow view, active)
    ST R4, [SS:SP, 3]
    
    ; ISR logic here
    ; ...
    
    ; Restore context
    LD R2, [SS:SP, 1]
    LD R1, [SS:SP, 0]
    
    RETI             ; Switch back to Normal View
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

### 7.8 Segment Management
```assembly
; Segment setup
LDI 0x1000
MVS DS, R0        ; Data Segment = 0x1000

LDI 0x2000  
MVS SS, R0        ; Stack Segment = 0x2000

; Access different segments
LD R1, [DS:R2, 0]   ; Load from data segment
ST R3, [SS:SP, 1]   ; Store to stack segment
LD R4, [ES:R5, 2]   ; Load from extra segment
```

---

## 8. Interrupt Handling

### 8.1 Interrupt Vector Table (Word Addresses)

| Word Address | PC Value | Purpose |
|--------------|---------|---------|
| 0x00000 | 0x0100 | Reset |
| 0x00001 | 0x0200 | Software Interrupt (SWI) |
| 0x00002 | 0x0300 | Hardware Interrupt |
| 0x00003 | 0x0400 | Exception |

**All interrupts run in CS=0!**

### 8.2 Simple Interrupt Handler
```assembly
simple_irq:
    ; AUTO: Switched to Shadow View
    ST R1, [SS:SP, 0]  ; Save working register
    
    ; Quick ISR processing
    ; ...
    
    LD R1, [SS:SP, 0]  ; Restore register
    RETI               ; Switch back to Normal View
```

---

## 9. Memory Addressing

### 9.1 Complete Word-Based Addressing

**The entire cMIN-16a system operates on word basis:**
- **CPU-internal**: 16-bit Effective Address (A[15:0]) - Word Addresses
- **Memory Interface**: 20-bit Word Addresses (A[19:0])
- **Memory chips**: Addressed directly with word addresses
- **No byte-address conversion** at any level

### 9.2 Address Calculation

**Complete System (Word Addresses):**
```
Effective_Address: 16-bit (A[15:0]) - 0x0000 to 0xFFFF Words
Segment: 4-bit (0x0-0xF)
Physical_Word_Address = (Segment << 4) + Effective_Address
```

**Memory Interface:**
- **A[19:0]** - 20-bit Word Addresses
- **D[15:0]** - 16-bit Data Bus
- **No Byte Enable** signals needed

### 9.3 Memory Architecture

**Memory Organization:**
- **20-bit Word Addresses** = 1,048,576 Words total
- **16-bit per Word** = 2MB total capacity
- **Per Segment**: 64K Words = 128KB

**Memory Chip Options:**
- **16-bit memory chips**: 1 chip per word, direct connection
- **4-bit memory chips**: 4 chips in parallel, each providing 4 bits
- **1-bit memory chips**: 16 chips in parallel, each providing 1 bit

### 9.4 Example Memory Access

```assembly
; CPU sends word addresses directly to memory
LD R1, [DS:0x1234, 0]  
; → Physical Word Address = (DS << 4) + 0x1234
; → Memory delivers 16-bit word from this address

ST R2, [DS:0x5678, 1]
; → Physical Word Address = (DS << 4) + 0x5678 + 1
; → Memory stores 16-bit word at this address
```

### 9.5 Advantages of Word-Based Addressing

1. **Simpler Hardware**: No byte-enable logic required
2. **Faster Access**: Always complete 16-bit words
3. **Simpler Memory Controller**: Direct addressing
4. **Consistent Data Width**: 16-bit throughout system

---

## Appendix A: Flag Bitmask Constants

```assembly
; Recommended constants for flag manipulation
N_FLAG  = 0x01  ; Negative flag
Z_FLAG  = 0x02  ; Zero flag
V_FLAG  = 0x04  ; Overflow flag  
C_FLAG  = 0x08  ; Carry flag
S_FLAG  = 0x10  ; In ISR flag (Shadow View active)
I_FLAG  = 0x20  ; Interrupt enable flag
```

## Appendix B: SMV Usage Reference

### Normal Mode (S=0):
- `SMV Rd, APC` - Read shadow PC (inactive in normal mode)
- `SMV Rd, APSW` - Read shadow PSW (inactive in normal mode)
- `SMV Rd, PSW` - Read current PSW (active)

### ISR Mode (S=1):
- `SMV Rd, PC` - Read normal PC (inactive in ISR mode)
- `SMV Rd, PSW` - Read current PSW (active)
- `SMV Rd, APSW` - Read normal PSW (inactive in ISR mode)

## Appendix C: Register Pair Reference

### Available Register Pairs:
- **R0:R1** - Frequently for operation results
- **R2:R3** - General 32-bit values  
- **R4:R5** - General 32-bit values
- **R6:R7** - General 32-bit values
- **R8:R9** - General 32-bit values
- **R10:R11** - General 32-bit values
- **R12:R13** - General 32-bit values  
- **R14:R15** - Link Register & Program Counter pair (use with caution)

### Invalid MUL/DIV Operations:
- `MUL R1, R2` → **Error!** R1 is odd
- `DIV R15, R0` → **Error!** R15 is odd
- `MUL R3, R4` → **Error!** R3 is odd

## Appendix D: Performance Characteristics

- **Pipeline Stages**: 3 (Fetch, Decode, Execute)
- **Estimated CPI**: 1.05-1.15
- **Branch Penalty**: 2 cycles (misprediction)
- **Load-Use Stall**: 1 cycle
- **Interrupt Latency**: 2 cycles (access switching only)
- **Shift Operations**: 1 cycle (all types)
- **MUL/DIV Operations**: 4-8 cycles (depending on operands)

---

*cMIN-16a Architecture Specification v2.6 (Milestone 1r4) - Complete with word-based addressing and corrected instruction examples*
