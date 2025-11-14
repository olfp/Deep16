# Deep16 Architecture Specification v3.5 (Milestone 1r11)
## 16-bit RISC Processor with Enhanced Memory Addressing

---

## Einführung

Die **Deep16** Architektur ist ein moderner 16-bit RISC Prozessor, der für Effizienz und Einfachheit optimiert wurde. Mit nur 16-bit festen Instruktionslängen, einem erweiterten Speicher-Adressierungssystem und hardware-unterstütztem Interrupt-Handling bietet Deep16 eine ausgewogene Balance zwischen Leistung und Komplexität. Die Architektur unterstützt segmentierten Speicherzugriff mit impliziten Segmentregistern, erweiterten ALU-Operationen und einem eleganten Shadow-Register-System für schnelle Interrupt-Behandlung.

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
- **Advanced interrupt handling** with automatic context switching
- **Complete word-based memory system**

### Key Features
- All instructions exactly 16 bits
- 16 user-visible registers + PC/PSW/CS shadow views
- Hardware-assisted interrupt context switching
- 4 segment registers for memory management
- Compact encoding with variable-length opcodes
- Enhanced memory addressing with stack/extra registers
- Clean instruction encoding with no conflicts
- Intuitive single-operand instruction category

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
| **CS'**  | **Code Segment Shadow Register** | **16** |

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
|DE|   ER[3:0]   |DS|   SR[3:0]   | | |I|S|C|V|Z|N|
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
 │  │           │  │           │  │  │ │ │ │ │ └─ 0: Negative (1=negative)
 │  │           │  │           │  │  │ │ │ │ └─ 1: Zero (1=zero)
 │  │           │  │           │  │  │ │ │ └─ 2: Overflow (1=overflow)
 │  │           │  │           │  │  │ │ └─ 3: Carry (1=carry)
 │  │           │  │           │  │  │ └─ 4: In ISR (1=Shadow View active)
 │  │           │  │           │  │  └─ 5: Interrupt Enable (1=enabled)
 │  │           │  │           │  └─ 6: (reserved)
 │  │           │  │           └─ 7: (reserved)
 │  │           │  └─ 8-11: SR[3:0] (4-bit Stack Register selection)
 │  │           └─ 12: DS (1=dual registers for stack segment access)
 │  └─ 13-16: ER[3:0] (4-bit Extra Register selection)  
 └─ 17: DE (1=dual registers for extra segment access)
```

**PSW Bit Assignment:**
- **Bits 0-5**: Standard flags (N, Z, V, C, S, I)
- **Bits 6-7**: **Reserved** for future use
- **Bits 8-11**: SR[3:0] - Stack Register selection
- **Bit 12**: DS - Dual registers for stack segment access
- **Bits 13-16**: ER[3:0] - Extra Register selection  
- **Bit 17**: DE - Dual registers for extra segment access

---

## 3. Shadow Register System

### 3.1 Access Switching with Automatic Context Save

**Hardware Implementation:**
- **Two complete sets** of physical registers (PC, PSW, CS) 
- **S-flag in PSW** controls whether "Normal" or "Shadow" view is accessed
- **Automatic PSW copying** on interrupt entry/exit
- **No manual bit syncing** required

### 3.2 Automatic Context Switching

**On Interrupt:**
- `PSW' ← PSW` (Copy entire PSW to shadow - automatic context save)
- `PSW'.S ← 1` (Mark as in interrupt context)
- `PSW'.I ← 0` (Disable interrupts in shadow context)
- `CS ← 0` (Interrupts always run in Segment 0)
- `PC ← interrupt_vector` (Jump to ISR)

**On RETI:**
- `PSW ← PSW'` (Restore original PSW from shadow - automatic context restore)
- Hardware automatically switches back to normal register view

### Benefits of This Approach:
- ✅ **Complete context isolation**: Normal and interrupt contexts fully separated
- ✅ **Automatic state preservation**: No manual register saving required
- ✅ **Zero overhead**: Hardware handles all context switching
- ✅ **Simpler programming**: Interrupt handlers start with clean state

### 3.3 SMV Instruction - Special Move

**Consistent Logic (regardless of S flag):**
- **APC/APSW/ACS** always access the **alternate** (inactive) registers
- **PC/PSW/CS** always access the **current active** registers

| SRC2 | Mnemonic | Effect (Both Modes) |
|------|----------|---------------------|
| 00 | SMV DST, APC | `DST ← alternate_PC` |
| 01 | SMV DST, APSW | `DST ← alternate_PSW` |
| 10 | SMV DST, PSW | `DST ← current_PSW` |
| 11 | SMV DST, ACS | `DST ← alternate_CS` |

---

## 4. Instruction Set Summary

### Complete Opcode Hierarchy

| Opcode | Instruction | Format | Description |
|--------|-------------|--------|-------------|
| 0 | LDI | `[0][imm15]` | Load 15-bit immediate to R0 |
| 10 | LD/ST | `[10][d1][Rd4][Rb4][offset5]` | Load/Store with implicit segment |
| 110 | ALU | `[110][op3][Rd4][w1][i1][Rs/imm4]` | Arithmetic/Logic operations |
| 1110 | JMP | `[1110][type3][target9]` | Jump/branch operations |
| **1111110** | **LSI** | `[1111110][Rd4][imm5]` | **Load Short Immediate** |
| 11110 | LDS/STS | `[11110][d1][seg2][Rd4][Rs4]` | Load/Store with explicit segment |
| 111110 | MOV | `[111110][Rd4][Rs4][imm2]` | Move with offset |
| **11111110** | **SINGLE-OP** | `[11111110][type4][Rx/imm4]` | **Single-operand operations** |
| 111111110 | MVS | `[111111110][d1][Rd4][seg2]` | Move to/from segment |
| 1111111110 | SMV | `[1111111110][src2][Rd4]` | Special move |
| 1111111111110 | SYS | `[1111111111110][op3]` | System operations |

### Single-Operand Operations (type4)
| type4 | Mnemonic | Operand | Description |
|-------|----------|---------|-------------|
| 0000 | JML | Rx | Jump Long (Rx must be even) |
| 0001 | SWB | Rx | Swap Bytes |
| 0010 | INV | Rx | Invert bits |
| 0011 | NEG | Rx | Two's complement |
| 0100 | SRS | Rx | Stack Register Single |
| 0101 | SRD | Rx | Stack Register Dual |
| 0110 | ERS | Rx | Extra Register Single |
| 0111 | ERD | Rx | Extra Register Dual |
| 1000 | SET | imm4 | Set flag bit |
| 1001 | CLR | imm4 | Clear flag bit |
| 1010-1111 | *reserved* | | Future operations |

### SET/CLR Flag Bit Encoding
| imm4 | Operation | Flag Bit |
|------|-----------|----------|
| 0000 | SET | N (bit 0) |
| 0001 | SET | Z (bit 1) |
| 0010 | SET | V (bit 2) |
| 0011 | SET | C (bit 3) |
| 0100 | SET | S (bit 4) |
| 0101 | SET | I (bit 5) |
| 1000 | CLR | N (bit 0) |
| 1001 | CLR | Z (bit 1) |
| 1010 | CLR | V (bit 2) |
| 1011 | CLR | C (bit 3) |
| 1100 | CLR | S (bit 4) |
| 1101 | CLR | I (bit 5) |
| 0110-0111, 1110-1111 | *reserved* | |

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
- **Implicit segment**: Uses PSW SR/ER fields to determine segment
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
Bits: [1111110][ Rd ][ imm5 ]
      7         4     5
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

### 5.8 SINGLE-OP - Single Operand Operations
```
Bits: [11111110][ type4 ][ Rx/imm4 ]
      8          4        4
```
- **type4=0000**: `JML Rx` - Long Jump `PC ← R[Rx]`, `CS ← R[Rx+1]` (Rx must be even)
- **type4=0001**: `SWB Rx` - Swap high/low bytes
- **type4=0010**: `INV Rx` - Invert all bits (ones complement)
- **type4=0011**: `NEG Rx` - Two's complement
- **type4=0100**: `SRS Rx` - Stack Register Single `SR ← Rx`, `DS ← 0`
- **type4=0101**: `SRD Rx` - Stack Register Dual `SR ← Rx`, `DS ← 1`
- **type4=0110**: `ERS Rx` - Extra Register Single `ER ← Rx`, `DE ← 0`
- **type4=0111**: `ERD Rx` - Extra Register Dual `ER ← Rx`, `DE ← 1`
- **type4=1000**: `SET imm4` - Set flag bit (see encoding table)
- **type4=1001**: `CLR imm4` - Clear flag bit (see encoding table)
- **Operands**: 1 (Rx or imm4)

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
Bits: [1111111110][ src2 ][ Rd ]
      10           2       4
```
- **src2=00**: `SMV Rd, APC` - `Rd ← alternate_PC`
- **src2=01**: `SMV Rd, APSW` - `Rd ← alternate_PSW`
- **src2=10**: `SMV Rd, PSW` - `Rd ← current_PSW`
- **src2=11**: `SMV Rd, ACS` - `Rd ← alternate_CS`
- **Operands**: 2 (src, Rd)

### 5.11 SYS - System Operations
```
Bits: [1111111111110][ op3 ]
      13               3
```
- **op3**: 000=NOP, 001=HLT, 010=SWI, 011=RETI, 100-111=reserved
- **Operands**: 0

---

## 6. ALU Operations

### 6.1 ALU Operation Codes (op3)

| op3 | Mnemonic | Description | Flags | i=0 (Register) | i=1 (Immediate) |
|-----|----------|-------------|-------|----------------|-----------------|
| 000 | ADD | Addition | N,Z,V,C | `Rd ← Rd + Rs` | `Rd ← Rd + imm4` |
| 001 | SUB | Subtraction | N,Z,V,C | `Rd ← Rd - Rs` | `Rd ← Rd - imm4` |
| 010 | AND | Logical AND | N,Z | `Rd ← Rd & Rs` | `Rd ← Rd & imm4` |
| 011 | OR | Logical OR | N,Z | `Rd ← Rd | Rs` | `Rd ← Rd | imm4` |
| 100 | XOR | Logical XOR | N,Z | `Rd ← Rd ^ Rs` | `Rd ← Rd ^ imm4` |
| 101 | MUL | Multiplication | N,Z | `Rd ← Rd × Rs` | `Rd:Rd+1 ← Rd × Rs` |
| 110 | DIV | Division | N,Z | `Rd ← Rd ÷ Rs` | `Rd:Rd+1 ← Rd ÷ Rs` |
| 111 | Shift | Shift operations | N,Z,C | Various shift operations | Various shift operations |

### 6.2 MUL/DIV Detailed Behavior

**MUL Operations:**
- **MUL Rd, Rs** (i=0): 16×16→16-bit multiplication
  - `Rd ← Rd × Rs` (single 16-bit result)
- **MUL Rd, Rs** (i=1): 16×16→32-bit multiplication, **Rd must be even**
  - `Rd` receives low 16 bits of result  
  - `Rd+1` receives high 16 bits of result
  - **Operand is always Rs register**

**DIV Operations:**
- **DIV Rd, Rs** (i=0): 16÷16→16-bit division (quotient only)
  - `Rd ← Rd ÷ Rs` (quotient only)
- **DIV Rd, Rs** (i=1): 16÷16→32-bit division, **Rd must be even**
  - `Rd` receives quotient
  - `Rd+1` receives remainder  
  - **Operand is always Rs register**

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
| 111 | *reserved* | | Future jump type |

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

### 7.1 Basic Arithmetic
```assembly
; Initialize registers
LDI 42         ; R0 = 42
MOV R1, R0, 0  ; R1 = 42
LSI R2, 10     ; R2 = 10

; 2-operand arithmetic operations
ADD R1, R2     ; R1 = 42 + 10 = 52
SUB R1, 5      ; R1 = 52 - 5 = 47

; 3-operand simulation using MOV
MOV R3, R1, 0  ; R3 = R1 (copy first operand)
ADD R3, R2     ; R3 = R3 + R2 (R1 + R2)

; Comparison (flags only)
SUB R1, R2, w=0 ; Compare R1 and R2

; 32-bit multiplication (R4 must be even!)
MUL R4, R5, i=1 ; R4:R5 = R4 × R5

; Two's complement with NEG instruction
NEG R2         ; R2 = -R2 (Two's complement)
```

### 7.2 Memory Access with Segment Configuration
```assembly
; Setup PSW for standard memory model using new instructions
SRS R13        ; SR=13(SP), DS=0
SRD R13        ; SR=13(SP), DS=1 (dual mode - SP+FP use SS)
ERS R11        ; ER=11, DE=0 (single mode)

; Stack operations (use SS segment)
LD R1, SP, 0   ; Load from stack (SS:SP + 0)
ST R2, SP, 1   ; Store to stack (SS:SP + 1) 
LD R3, FP, 0   ; Load from stack (SS:FP + 0) - dual registers!

; Data segment operations
LD R4, R7, 0   ; Load from data segment (DS:R7 + 0)
ST R5, R8, 15  ; Store to data segment (DS:R8 + 15)

; Extra segment operations
LD R6, R11, 0  ; Load from extra segment (ES:R11 + 0)
```

### 7.3 Flag Manipulation
```assembly
; Clear all flags
CLR 0x8        ; CLR N
CLR 0x9        ; CLR Z  
CLR 0xA        ; CLR V
CLR 0xB        ; CLR C
CLR 0xC        ; CLR S
CLR 0xD        ; CLR I

; Set specific flags after operations
ADD R1, R2     ; Some operation that sets flags
SET 0x3        ; Force set Carry flag
CLR 0x1        ; Force clear Zero flag

; Interrupt control
SET 0x5        ; Enable interrupts (SET I)
CLR 0x5        ; Disable interrupts (CLR I)
```

### 7.4 Control Flow
```assembly
; Function call
MOV LR, PC, 2  ; Save return address in Link Register
JMP function   ; Call function

function:
    ; Function code
    ADD R1, R1, 1
    MOV PC, LR  ; Return using MOV

; Conditional jumps
ADD R2, R2, 1, w=0 ; Update flags
JZ  zero_case      ; Jump if result was zero
JN  negative_case  ; Jump if result was negative

zero_case:
    ; Handle zero case
    JMP continue

negative_case:
    ; Handle negative case  
    JMP continue

continue:
    ; Continue execution
```

### 7.5 Inter-Segment Subroutine Call
```assembly
; Inter-segment subroutine call
far_call:
    ; Save current CS and PC for return
    SMV R8, ACS     ; R8 = alternate CS (current CS in normal mode)
    MOV R9, PC, 2   ; R9 = return address (PC + 2)
    
    ; Setup target address (CS=0x1000, PC=0x0200)
    LDI 0x1000
    MOV R10, R0, 0  ; R10 = target CS
    LDI 0x0200
    MOV R11, R0, 0  ; R11 = target PC
    
    ; Perform long jump
    JML R10         ; Jump to CS=R10, PC=R11

; In the far subroutine (segment 0x1000)
far_subroutine:
    ; Subroutine code here
    ; ...
    
    ; Return to caller: restore CS and PC
    MOV R10, R8, 0  ; R10 = saved CS
    MOV R11, R9, 0  ; R11 = saved return address
    JML R10         ; Return to original segment
```

### 7.6 Interrupt Handling
```assembly
; Interrupt handler in segment 0
.org 0x0020
irq_handler:
    ; Hardware has automatically:
    ; - Saved PSW to PSW'
    ; - Saved PC to APC  
    ; - Saved CS to ACS
    ; - Disabled interrupts (PSW'.I=0)
    ; - Set shadow mode (PSW'.S=1)
    
    ; Minimal context save
    ST R1, SP, 0
    ST R2, SP, 1
    
    ; Access saved state if needed
    SMV R3, APSW    ; Get saved PSW
    SMV R4, APC     ; Get interrupted PC
    
    ; ... process interrupt ...
    
    ; Restore context
    LD R2, SP, 1
    LD R1, SP, 0
    
    RETI            ; Automatic context restore
```

### 7.7 Number Manipulation
```assembly
; Number conversion examples
LDI 0x1234
MOV R1, R0, 0      ; R1 = 0x1234

SWB R1             ; R1 = 0x3412 (byte swap)
INV R1             ; R1 = 0xCBED (ones complement)  
NEG R1             ; R1 = 0x3414 (two's complement of 0xCBED)

; Absolute value using NEG
LSI R2, -42        ; R2 = -42
JN  make_positive  ; If negative, make positive
JMP done
make_positive:
    NEG R2         ; R2 = 42
done:
    ; R2 contains absolute value
```

---

## 8. Interrupt Handling

### 8.1 Interrupt Vector Table (Word Addresses)

| Word Address | PC Value | Purpose | Priority |
|--------------|---------|---------|----------|
| 0x00000 | 0x0100 | **Reset** (highest priority) | 1 |
| 0x00001 | 0x0200 | **Hardware Interrupt** | 2 |
| 0x00002 | 0x0300 | **Software Interrupt (SWI)** | 3 |
| 0x00003 | 0x0400 | **Exception** (lowest priority) | 4 |

### 8.2 Interrupt Priority
1. Reset (highest priority)
2. Hardware Interrupt
3. Software Interrupt (SWI)
4. Exception (lowest priority)

**All interrupts run in CS=0!**

### 8.3 Automatic Context Switching
- **On interrupt**: Complete PSW/PC/CS state automatically saved to shadow registers
- **On RETI**: Original context automatically restored
- **Zero software overhead** for basic context switching

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

**LD/ST determines segment automatically based on base register and PSW configuration:**

- **If Rb = SR**: Use Stack Segment (SS)
- **If Rb = ER**: Use Extra Segment (ES) 
- **If Rb = R0**: Always uses Data Segment (DS) - special case
- **Otherwise**: Use Data Segment (DS)

### Dual Registers for Segment Access (PSW-controlled)

The PSW contains special control bits for extended segment access:

- **DS bit (bit 12)**: When set, enables dual registers for stack segment access using SR:SR+1 register pair
- **DE bit (bit 17)**: When set, enables dual registers for extra segment access using ER:ER+1 register pair

**Special Register Zero Handling:**
- **SR = 0**: Stack segment access is disabled (SR ignored)
- **ER = 0**: Extra segment access is disabled (ER ignored)

### Examples

**Example 1: Dual Registers for Stack Segment Access (SR=13, DS=1)**
```
PSW Configuration:
  SR[3:0] = 1101 (R13/SP)
  DS = 1 (Dual registers for stack segment access enabled)

Segment Access:
  LD R1, SP, 0    → Uses SS (SP = R13)
  LD R2, FP, 0    → Uses SS (FP = R12, and SR:SR+1 = R13:R12)
  LD R3, R7, 0    → Uses DS (R7 ≠ SR/ER)
```

**Example 2: Single Register for Stack Segment Access (SR=13, DS=0)**
```
PSW Configuration:
  SR[3:0] = 1101 (R13/SP) 
  DS = 0 (Dual registers for stack segment access disabled)

Segment Access:
  LD R1, SP, 0    → Uses SS (SP = R13)
  LD R2, FP, 0    → Uses DS (FP = R12, but dual registers disabled)
  LD R3, R0, 0    → Uses DS (R0 always uses DS)
  LD R4, R7, 0    → Uses DS (R7 ≠ SR/ER)
```

**Example 3: Single Register for Extra Segment Access (ER=11, DE=0)**
```
PSW Configuration:
  ER[3:0] = 1011 (R11)
  DE = 0 (Dual registers for extra segment access disabled)

Segment Access:
  LD R1, R11, 0   → Uses ES (R11 = ER)
  LD R2, R10, 0   → Uses DS (R10 ≠ SR/ER, dual registers disabled)
  LD R3, R0, 0    → Uses DS (R0 always uses DS)
```

### Typical Configuration

- **SR = 13** (SP = Stack Pointer) → Stack access via SS
- **DS = 1** → Enable dual registers for stack segment access (SP and FP)
- **ER = 11** (R11) → Extra segment access via ES  
- **DE = 0** → Single register for extra segment access

This configuration provides:
- **Efficient stack operations** with dual registers for stack segment access (SP and FP both use SS)
- **Flexible extra segment** with single register access (R11 uses ES)
- **Simplified memory model** with clear separation of stack and data segments

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
- **PSW with clean bit layout**
- **4×16-bit segment registers**
- **Shadow register set** (PC', PSW', CS')
- **20-bit address bus**
- **16-bit data bus**
- **Automatic context switching logic**

### 10.4 Instruction Encoding Benefits
- ✅ **No encoding conflicts** - all instructions have clean encoding
- ✅ **Logical grouping** - single-operand ops consolidated
- ✅ **Future expansion** - reserved opcodes available
- ✅ **Intuitive usage** - clear instruction semantics

### 10.5 Performance Optimizations
- **Unified cache**: 4KB recommended for small Deep16 programs
- **Branch prediction**: Simple static prediction
- **Register forwarding**: Essential for 3-stage pipeline efficiency
- **Memory interleaving**: Use burst modes when available

---

*Deep16 Architecture Specification v3.5 (Milestone 1r11) - Complete with clean instruction encoding, single-operand operations, and no encoding conflicts*
