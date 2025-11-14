Perfekt! Hier ist die korrigierte Deep16 Architecture Specification (Milestone 1r5a):

# Deep16 Architecture Specification v3.1 (Milestone 1r5a)
## 16-bit RISC Processor with Enhanced Memory Addressing

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
10. [Implementation Notes](#10-implementation-notes)

---

## 1. Processor Overview

Deep16 is a 16-bit RISC processor with:
- **16-bit fixed-length instructions**
- **16 general-purpose registers** + **shadow register views**
- **Segmented memory addressing** (2MB physical address space)
- **3-stage pipeline** design
- **Advanced interrupt handling** with access switching
- **Complete word-based memory system**

### Key Features
- All instructions exactly 16 bits
- 16 user-visible registers + PC/PSW shadow views
- Hardware-assisted interrupt context switching
- 4 segment registers for memory management
- Compact encoding with variable-length opcodes
- Enhanced memory addressing with stack/extra registers
- Unified jump/LSI instruction encoding

---

## 2. Register Set

### 2.1 General Purpose Registers (16-bit)

| Register | Alias | Conventional Use | Binary |
|----------|-------|------------------|--------|
| R0       |       | LDI destination, temporary | 0000 |
| R1       |       | General purpose | 0001 |
| R2       |       | General purpose | 0010 |
| R3       |       | General purpose | 0011 |
| R4       |       | General purpose | 0100 |
| R5       |       | General purpose | 0101 |
| R6       |       | General purpose | 0110 |
| R7       |       | General purpose | 0111 |
| R8       |       | General purpose | 1000 |
| R9       |       | General purpose | 1001 |
| R10      |       | General purpose | 1010 |
| R11      |       | General purpose | 1011 |
| R12      | FP    | Frame Pointer | 1100 |
| R13      | SP    | Stack Pointer | 1101 |
| R14      | LR    | Link Register | 1110 |
| R15      | PC    | Program Counter | 1111 |

### 2.2 Special Registers

| Register | Purpose | Bits |
|----------|---------|------|
| PSW      | Processor Status Word (Flags) | 16 |
| PC'      | Program Counter Shadow View | 16 |
| PSW'     | Processor Status Word Shadow View | 16 |

### 2.3 Segment Registers (16-bit)

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
| | | |DE|   ER[3:0]   |DS|   SR[3:0]   |I|S|C|V|Z|N|
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
            │  │        │  │        │  │  │  │  │  └─ 0: Negative (1=negative)
            │  │        │  │        │  │  │  │  └─ 1: Zero (1=zero)
            │  │        │  │        │  │  │  └─ 2: Overflow (1=overflow)
            │  │        │  │        │  │  └─ 3: Carry (1=carry)
            │  │        │  │        │  └─ 4: In ISR (1=Shadow View active)
            │  │        │  │        └─ 5: Interrupt Enable (1=enabled)
            │  │        │  └─ 6-9: SR[3:0] (4-bit Stack Register selection)
            │  │        └─ 10: DS (1=use register pair SR:SR+1)
            │  └─ 11-14: ER[3:0] (4-bit Extra Register selection)
            └─ 15: DE (1=use register pair ER:ER+1)
```

**PSW Bit Assignment:**
- **Bits 0-5**: Standard flags (N, Z, V, C, S, I)
- **Bits 6-9**: SR[3:0] - Stack Register selection
- **Bit 10**: DS - Dual Stack mode
- **Bits 11-14**: ER[3:0] - Extra Register selection  
- **Bit 15**: DE - Dual Extra mode

---

## 3. Shadow Register System

### 3.1 Access Switching (No Data Copying)

**Hardware Implementation:**
- **Single set of physical registers** (PC, PSW)
- **S-flag in PSW** controls whether "Normal" or "Shadow" view is accessed
- **No actual data copying** during interrupts
- **CS is always 0 for interrupts**

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

**Access to non-active registers based on PSW.S:**

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

### Complete Opcode Hierarchy

| Opcode | Instruction | Format | Description |
|--------|-------------|--------|-------------|
| 0 | LDI | `[0][imm15]` | Load 15-bit immediate to R0 |
| 10 | LD/ST | `[10][d1][Rd4][Rb4][offset5]` | Load/Store with implicit segment |
| 110 | ALU | `[110][op3][Rd4][w1][i1][Rs/imm4]` | Arithmetic/Logic operations |
| 1110 | JMP | `[1110][type3][target9]` | Jump/branch operations |
| 1110 | LSI | `[1110][111][Rd4][imm5]` | Load Short Immediate |
| 11110 | LDS/STS | `[11110][d1][seg2][Rd4][Rs4]` | Load/Store with explicit segment |
| 111110 | MOV | `[111110][Rd4][Rs4][imm2]` | Move with offset |
| 1111110 | SET/CLR | `[1111110][s1][bitmask8]` | Set/Clear flags |
| 111111110 | MVS | `[111111110][d1][Rd4][seg2]` | Move to/from segment |
| 1111111110 | SMV | `[1111111110][src2][dst4]` | Special move |
| 11111111110 | SWB/INV | `[11111111110][s1][Rx4]` | Swap Bytes / Invert |
| 111111111110 | LJMP | `[111111111110][Rs4]` | Long Jump between segments |
| 1111111111110 | SYS | `[1111111111110][op3]` | System operations |

### Unused Opcodes
- **11**: `[11][***13]` - **UNUSED** (2-bit opcode with 13 free bits)
- **1111111111111**: `[1111111111111][***3]` - **UNUSED** (13-bit opcode with 3 free bits)

---

## 5. Detailed Instruction Formats

### 5.1 LDI - Load Long Immediate
```
Bits: [0][ imm15 ]
      1     15
```
- **Effect**: `R0 ← immediate`
- **Range**: 0 to 32,767
- **Operands**: 1 (immediate)

### 5.2 LD/ST - Load/Store with Implicit Segment
```
Bits: [10][ d ][ Rd ][ Rb ][ offset5 ]
      2    1    4     4      5
```
- **d=0**: Load `Rd ← Mem[implicit_segment:Rb + offset]`
- **d=1**: Store `Mem[implicit_segment:Rb + offset] ← Rd`
- **Implicit segment**: Uses PSW SR/ER fields to determine segment:
  - **If Rb = SR**: Use Stack Segment (SS)
  - **If Rb = ER**: Use Extra Segment (ES) 
  - **Otherwise**: Use Data Segment (DS)
- **offset5**: 5-bit unsigned immediate (0-31 words)
- **Operands**: 3 (Rd, Rb, offset)

### 5.3 ALU - Arithmetic/Logic Operations
```
Bits: [110][ op3 ][ Rd ][ w ][ i ][ Rs/imm4 ]
      3     3      4     1    1      4
```
- **op3**: ALU operation code
- **w=0**: Update flags only (CMP/TST operations)
- **w=1**: Write result to Rd
- **i=0**: Register mode `Rd ← Rd op Rs`
- **i=1**: Immediate mode `Rd ← Rd op imm4`
- **Operands**: 2 (Rd, Rs/imm) + optional `w=0`

### 5.4 JMP - Jump/Branch Operations
```
Bits: [1110][ type3 ][ target9 ]
      4      3         9
```
- **type3**: Jump condition (000-110)
- **target9**: 9-bit signed immediate (-256 to +255 words)
- **Operands**: 1 (target)

### 5.5 LSI - Load Short Immediate
```
Bits: [1110][ 111 ][ Rd ][ imm5 ]
      4      3      4      5
```
- **Effect**: `Rd ← sign_extend(imm5)`
- **Range**: -16 to +15
- **Operands**: 2 (Rd, imm)

### 5.6 LDS/STS - Load/Store with Explicit Segment
```
Bits: [11110][ d ][ seg2 ][ Rd ][ Rs ]
      5       1     2       4     4
```
- **d=0**: Load `Rd ← Mem[seg:Rs]`
- **d=1**: Store `Mem[seg:Rs] ← Rd`
- **seg2**: 00=CS, 01=DS, 10=SS, 11=ES
- **No immediate offset** - pure register indirect
- **Operands**: 3 (Rd, Rs, seg)

### 5.7 MOV - Move with Offset
```
Bits: [111110][ Rd ][ Rs ][ imm2 ]
      6        4     4      2
```
- **Effect**: `Rd ← Rs + zero_extend(imm2)`
- **Range**: 0-3
- **Operands**: 3 (Rd, Rs, imm)

### 5.8 SET/CLR - Set/Clear Flags
```
Bits: [1111110][ s ][ bitmask8 ]
      7         1       8
```
- **s=1**: `PSW ← PSW | bitmask` (SET)
- **s=0**: `PSW ← PSW & ~bitmask` (CLR)
- **Operands**: 1 (bitmask)

### 5.9 MVS - Move to/from Segment
```
Bits: [111111110][ d ][ Rd ][ seg2 ]
      9           1    4      2
```
- **d=0**: `Rd ← Segment[seg]`
- **d=1**: `Segment[seg] ← Rd`
- **Operands**: 2 (Segment, Rd) or (Rd, Segment)

### 5.10 SMV - Special Move
```
Bits: [1111111110][ src2 ][ dst4 ]
      10           2        4
```
- Access shadow/normal registers based on PSW.S
- **Operands**: 2 (src, dst)

### 5.11 SWB/INV - Swap Bytes / Invert
```
Bits: [11111111110][ s ][ Rx ]
      11            1    4
```
- **s=0**: `SWB Rx` - Swap high/low bytes
- **s=1**: `INV Rx` - Invert all bits
- **Operands**: 1 (Rx)

### 5.12 LJMP - Long Jump
```
Bits: [111111111110][ Rs ]
      12             4
```
- **Effect**: `CS ← Mem[Rs]`, `PC ← Mem[Rs+1]`
- **Operands**: 1 (Rs)

### 5.13 SYS - System Operations
```
Bits: [1111111111110][ op3 ]
      13               3
```
- **op3**: 000=NOP, 001=HLT, 010=SWI, 011=RETI, 100-111=reserved
- **Operands**: 0

---

## 6. ALU Operations

### 6.1 ALU Operation Codes (op3)

| op3 | Mnemonic | Description | Flags | i=0 (16-bit) | i=1 (32-bit) |
|-----|----------|-------------|-------|--------------|--------------|
| 000 | ADD | Addition | N,Z,V,C | `Rd ← Rd + Rs` | `Rd ← Rd + imm4` |
| 001 | SUB | Subtraction | N,Z,V,C | `Rd ← Rd - Rs` | `Rd ← Rd - imm4` |
| 010 | AND | Logical AND | N,Z | `Rd ← Rd & Rs` | `Rd ← Rd & imm4` |
| 011 | OR | Logical OR | N,Z | `Rd ← Rd | Rs` | `Rd ← Rd | imm4` |
| 100 | XOR | Logical XOR | N,Z | `Rd ← Rd ^ Rs` | `Rd ← Rd ^ imm4` |
| 101 | MUL | Multiplication | N,Z | `Rd ← Rd × Rs` | `Rd:Rd+1 ← Rd × imm4` |
| 110 | DIV | Division | N,Z | `Rd ← Rd ÷ Rs` | `Rd:Rd+1 ← Rd ÷ imm4` |
| 111 | Shift | Shift operations | N,Z,C | Various shift operations | Various shift operations |

### 6.2 MUL/DIV Detailed Behavior

**MUL Operations:**
- **MUL Rd, Rs** (i=0): 16×16→16-bit multiplication
- **MUL Rd, imm4** (i=1): 16×16→32-bit multiplication, **Rd must be even**
  - `Rd` receives low 16 bits of result
  - `Rd+1` receives high 16 bits of result

**DIV Operations:**
- **DIV Rd, Rs** (i=0): 16÷16→16-bit division (quotient only)
- **DIV Rd, imm4** (i=1): 16÷16→32-bit division, **Rd must be even**
  - `Rd` receives quotient
  - `Rd+1` receives remainder

### 6.3 Shift Operations (ALU op=111)

**Shift Type Encoding (Rs/imm4 field when i=0):**
```
[ T2 ][ C ][ count3 ]
 2     1     3
```

| T2 | C | Mnemonic | Description |
|----|---|----------|-------------|
| 00 | 0 | SL | Shift Left |
| 00 | 1 | SLC | Shift Left with Carry |
| 01 | 0 | SR | Shift Right Logical |
| 01 | 1 | SRC | Shift Right with Carry |
| 10 | 0 | SRA | Shift Right Arithmetic |
| 10 | 1 | SAC | Shift Arithmetic with Carry |
| 11 | 0 | ROR | Rotate Right |
| 11 | 1 | ROC | Rotate with Carry |

**count3**: Shift distance 0-7

### 6.4 JMP Conditions (type3)

| type3 | Mnemonic | Condition | Description |
|-------|----------|-----------|-------------|
| 000 | JMP | Always | Unconditional jump |
| 001 | JZ | Z=1 | Jump if zero |
| 010 | JNZ | Z=0 | Jump if not zero |
| 011 | JC | C=1 | Jump if carry |
| 100 | JNC | C=0 | Jump if no carry |
| 101 | JN | N=1 | Jump if negative |
| 110 | JNN | N=0 | Jump if not negative |
| 111 | LSI | (not a jump) | Load Short Immediate |

### 6.5 System Operations (op3)

| op3 | Mnemonic | Description |
|-----|----------|-------------|
| 000 | NOP | No operation |
| 001 | HLT | Halt processor |
| 010 | SWI | Software interrupt |
| 011 | RETI | Return from interrupt |
| 100 | **reserved** | |
| 101 | **reserved** | |
| 110 | **reserved** | |
| 111 | **reserved** | |

---

## 7. Programming Examples

### 7.1 Basic Arithmetic (Korrigiert)
```assembly
; Initialize registers
LDI 100        ; R0 = 100
MOV R1, R0, 0  ; R1 = 100
LSI R2, -5     ; R2 = -5

; Arithmetic operations - nur 2 Operanden!
ADD R3, R1, R2     ; R3 = 100 + (-5) = 95
SUB R4, R3, 50     ; R4 = 95 - 50 = 45

; Vergleich (nur Flags setzen)
SUB R0, R3, 50, w=0 ; Compare R3 with 50 (flags only)

; 32-bit multiplication
MUL R4, 10, i=1    ; R4:R5 = R4 × 10, Rd muss gerade sein!
```

### 7.2 Memory Access (Korrigiert)
```assembly
; Setup stack register (SR=13 für SP)
SET 0x064D     ; Set SR=13 (SP), DS=0

; Stack operations using implicit segment - kein explizites Segment!
LD R1, [SP, 0]     ; Load from stack (SS:SP + 0)
ST R2, [SP, 1]     ; Store to stack (SS:SP + 1) 
LD R3, [SP, 31]    ; Load from stack (SS:SP + 31)

; Data segment operations (Rb ≠ SR/ER → DS)
LD R4, [R7, 0]     ; Load from data segment (DS:R7 + 0)
ST R5, [R8, 15]    ; Store to data segment (DS:R8 + 15)

; Explizites Segment mit LDS/STS
LDS R6, SS, SP     ; Load from stack segment (explizit)
STS R7, ES, R9     ; Store to extra segment (explizit)
```

### 7.3 Control Flow
```assembly
; Function call
MOV LR, PC, 2      ; Save return address in Link Register
JMP function       ; Call function

function:
    ; Function code
    ADD R1, R1, 1
    MOV PC, LR      ; Return using MOV (kein JRL mehr!)

; Conditional jumps
ADD R2, R2, 1, w=0 ; Update flags
JZ  zero_case      ; Jump if result was zero
JN  negative_case  ; Jump if result was negative
; ... continue ...

zero_case:
    ; Handle zero case
    JMP continue

negative_case:
    ; Handle negative case  
    JMP continue

continue:
    ; Continue execution
```

### 7.4 Interrupt Handling
```assembly
; Interrupt handler in segment 0
.org 0x0020
irq_handler:
    ; AUTO: Switched to Shadow View
    
    ; Save context using stack
    ST R1, [SP, 0]
    ST R2, [SP, 1]
    
    ; Examine pre-interrupt state
    SMV R3, PC       ; Get interrupted PC
    ST R3, [SP, 2]
    
    ; Interrupt processing
    ; ...
    
    ; Restore context
    LD R2, [SP, 1]
    LD R1, [SP, 0]
    
    RETI             ; Return to Normal View
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

### 8.2 Interrupt Priority
1. Reset (highest priority)
2. Hardware Interrupt
3. Software Interrupt (SWI)
4. Exception (lowest priority)

---

## 9. Memory Addressing

### 9.1 Complete Word-Based Addressing

**The entire Deep16 system operates on word basis:**
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

**Memory Capacity:**
- **20-bit Word Addresses** = 1,048,576 Words total
- **16-bit per Word** = 2MB total capacity
- **Per Segment**: 64K Words = 128KB

### 9.3 Implicit Segment Usage

**LD/ST determines segment automatically:**
- **If Rb = SR**: Use Stack Segment (SS)
- **If Rb = ER**: Use Extra Segment (ES) 
- **Otherwise**: Use Data Segment (DS)

**Typische Konfiguration:**
- **SR = 13** (SP = Stack Pointer) → Stack-Zugriffe über SS
- **ER = 12** (FP = Frame Pointer) → Extra-Zugriffe über ES
- **Andere Register** → Data-Zugriffe über DS

---

## 10. Implementation Notes

### 10.1 Pipeline Stages
1. **Fetch**: Read instruction from memory (CS:PC)
2. **Decode**: Parse instruction and read registers
3. **Execute**: Perform operation and write results

### 10.2 Timing Characteristics
- **Most instructions**: 1 cycle (pipelined)
- **Memory operations**: 1 cycle (with cache)
- **MUL/DIV operations**: 4-8 cycles
- **Branch penalty**: 2 cycles (pipeline flush)
- **Interrupt latency**: 3 cycles

### 10.3 Hardware Requirements
- **16×16-bit general purpose registers**
- **PSW with extended flag fields**
- **4×16-bit segment registers**
- **20-bit address bus**
- **16-bit data bus**
- **Shadow register access logic**

### 10.4 Reserved for Future Use
- **Opcode 11**: 13 free bits for future extensions
- **Opcode 1111111111111**: 3 free bits for future system operations
- **PSW bits 15,10**: Already used for DE/DS flags
- **SMV src2=11**: Reserved for future shadow register access

---

*Deep16 Architecture Specification v3.1 (Milestone 1r5a) - Complete with corrected examples and register aliases*
