# Deep16 (深十六) Architecture Specification Milestone 1r20
## 16-bit RISC Processor with Enhanced Memory Addressing

---

## 1. Processor Overview

Deep16 is a 16-bit RISC processor optimized for efficiency and simplicity:
- **16-bit fixed-length instructions**
- **16 general-purpose registers**
- **Segmented memory addressing** (1MB physical address space)
- **4 segment registers** for code, data, stack and extra
- **shadow register views** for interrupts
- **Hardware-assisted interrupt handling**
- **Complete word-based memory system** (no byte operations)
- **Extended addressing** 20-bit physical address space
- **5-stage pipelined implementation** with delayed branch

### 1.1 Key Features
- All instructions exactly 16 bits
- 16 user-visible registers, PC is R15
- 4 segment registers: CS, DS, SS, ES
- Processor status word (PSW) for flags and implicit segment selection
- PC'/CS'/PSW' shadow views for interrupt handling
- Compact encoding with variable-length opcodes
- Enhanced memory addressing with stack/extra registers
- **1-slot delayed branch** for improved pipeline efficiency
- **Word-only memory operations** (simplifies alignment)
- **No memory protection** (keep it simple)
- **Universal MOV instruction** with automatic encoding selection
- **Enhanced assembler syntax** with bracket and plus notation

---

## 2. Register Set

### 2.1 General Purpose Registers (16-bit)

**Table 2.1: General Purpose Registers**

| Register | Alias | Conventional Use |
|----------|-------|------------------|
| R0       |       | LDI destination, temporary |
| R1-R11   |       | General purpose |
| R12      | FP    | Frame Pointer |
| R13      | SP    | Stack Pointer |
| R14      | LR    | Link Register |
| R15      | PC    | Program Counter |

**Important**: LDI instruction **always** loads R0. To load other registers, use MOV or LSI.

### 2.2 Segment Registers (16-bit)

**Table 2.2: Segment Registers**

| Register | Code | Purpose |
|----------|------|---------|
| CS       | 00   | Code Segment |
| DS       | 01   | Data Segment |
| SS       | 10   | Stack Segment |
| ES       | 11   | Extra Segment |

The effective 20-bit memory address is computed as `(segment << 4) + offset`. Which segment register to use is either explicit (LDS/STS) or implicit: CS for instruction fetch, SS or ES when specified via PSW SR/ER or else DS.

### 2.3 Special Registers

**Table 2.3: Special Registers**

| Register | Purpose | Bits |
|----------|---------|------|
| PSW      | Processor Status Word | 16 |
| PC'      | Program Counter Shadow | 16 |
| PSW'     | PSW Shadow | 16 |
| CS'      | Code Segment Shadow | 16 |

### 2.4 Processor Status Word (PSW)

```
15                                              0
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|DE|  ER[3:0]  |DS|  SR[3:0]  |S |I |C |V |Z |N |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
 │  │           │  │           │  │  │  │  │  └─ 0: Negative (1=negative)
 │  │           │  │           │  │  │  │  └─ 1: Zero (1=zero)
 │  │           │  │           │  │  │  └─ 2: Overflow (1=overflow)
 │  │           │  │           │  │  └─ 3: Carry (1=carry)
 │  │           │  │           │  └─ 4: Interrupt Enable (1=enabled)
 │  │           │  │           └─ 5: Shadow View (1=active)
 │  │           │  └─ 6-9: SR[3:0] (Stack Register selection)
 │  │           └─ 10: DS (1=dual registers for stack segment)
 │  └─ 11-14: ER[3:0] (Extra Register selection)  
 └─ 15: DE (1=dual registers for extra segment)
```

---

## 3. Memory Architecture

### 3.1 Physical Memory Map (1MB)

```
0x00000 - 0xDFFFF: Home Segment (896KB) - Code execution starts here
0xE0000 - 0xEFFFF: Graphics Segment (64KB) - Reserved for future 640x400 display
0xF0000 - 0xFFFFF: I/O Segment (64KB) - Memory-mapped peripherals
   └── 0xF1000 - 0xF17CF: Screen Buffer (2KB) - 80×25 character display
```

### 3.2 Memory Access Characteristics
- **Word-based only** - No byte addressable operations
- **No alignment restrictions** - All addresses are word-aligned
- **No memory protection** - Simple and predictable
- **Memory-mapped I/O** - Peripherals accessed via load/store

### 3.3 Screen Memory Mapping
- **Location**: 0xF1000-0xF17CF (80×25 characters × 2 bytes)
- **Format**: Lower byte = ASCII character, Upper byte = attributes (reserved)
- **Access**: Use ES segment with offset for efficient writes

**Correct screen setup:**
```assembly
LDI  0x0FFF      ; LDI always loads R0
INV  R0          ; R0 = 0xF000
MVS  ES, R0      ; ES = 0xF000
LDI  0x0000      ; Base offset to R0
MOV  R10, R0     ; Copy to R10
ERD  R10         ; Use R10/R11 for ES access, sets DE=1 automatically
```

---

## 4. Interrupt System

### 4.1 Interrupt Vector Table

**Located at Segment 0 (Low Memory):**
```
0x0000: RESET_VECTOR    (PC loaded from here on reset)
0x0001: HW_INT_VECTOR   (PC loaded from here on hardware interrupt)  
0x0002: SWI_VECTOR      (PC loaded from here on software interrupt)
```

### 4.2 Reset State
- **PC ← Mem[0x0000]** (Load PC from reset vector at address 0x0000)
- **CS = 0x0000**, **PSW = 0x0000**
- All other registers = undefined
- Execution begins at physical address CS:PC

### 4.3 Shadow Register System

**On Interrupt:**
- `PSW' ← PSW` (Snapshot pre-interrupt state)
- `PSW'.S ← 1`, `PSW'.I ← 0` (Configure shadow context)
- `CS ← 0` (Interrupts run in Segment 0)
- `PC ← Mem[interrupt_vector]` (Load PC from vector table)
- **Pipeline flushed** to ensure clean context switch

**On RETI:**
- Switch to normal view (PSW.S=0)
- No register copying - pure view switching
- Both contexts preserved for debugging
- **Pipeline flushed** on context restoration

---

## 5. Instruction Set Enhancements

### 5.1 Enhanced Assembler Syntax

The Deep16 assembler supports flexible syntax for memory operations and register moves:

#### 5.1.1 LD/ST Bracket Syntax

**Traditional Syntax:**
```assembly
LD   R1, R2, 5        ; Load from [R2+5] to R1
ST   R1, R2, 5        ; Store R1 to [R2+5]
```

**Enhanced Bracket Syntax:**
```assembly
LD   R1, [R2+5]       ; Load from [R2+5] to R1
LD   R1, [R2]         ; Load from [R2+0] to R1 (offset 0 implied)
LD   R1, [R2 + 5]     ; Spaces allowed around +
ST   R1, [SP-4]       ; Store to stack frame
ST   R0, [FP+3]       ; Store to frame pointer with offset
```

#### 5.1.2 MOV Plus Syntax

**Traditional Syntax:**
```assembly
MOV  R1, R2, 3        ; R1 ← R2 + 3
```

**Enhanced Plus Syntax:**
```assembly
MOV  R1, R2+3         ; R1 ← R2 + 3
MOV  R1, R2 + 3       ; Spaces allowed around +
MOV  R3, SP-4         ; Calculate stack-relative address
```

### 5.2 Universal MOV Instruction

The `MOV` instruction automatically selects the appropriate encoding based on operands:

| Operand Types | Actual Encoding | Description |
|---------------|-----------------|-------------|
| `MOV Rd, Rs` | MOV | Register-to-register move |
| `MOV Rd, Rs, imm` | MOV | Register move with offset (0-3) |
| `MOV Rd, Rs+imm` | MOV | Enhanced plus syntax |
| `MOV Rd, Sx` | MVS Rd, Sx | Read from segment register |
| `MOV Sx, Rd` | MVS Sx, Rd | Write to segment register |
| `MOV Rd, PSW` | SMV Rd, PSW | Read from special register |
| `MOV Rd, APC` | SMV Rd, APC | Read from alternate PC |

### 5.3 PSW Segment Assignment Instructions

**Table 5.3: PSW Segment Assignment Operations**

| Instruction | Format | Encoding | Purpose |
|-------------|---------|----------|---------|
| **SRS** | `SRS Rx` | `[11111110][1000][Rx4]` | Stack Register Single - Use Rx for SS |
| **SRD** | `SRD Rx` | `[11111110][1001][Rx4]` | Stack Register Dual - Use Rx/Rx+1 for SS |
| **ERS** | `ERS Rx` | `[11111110][1010][Rx4]` | Extra Register Single - Use Rx for ES |
| **ERD** | `ERD Rx` | `[11111110][1011][Rx4]` | Extra Register Dual - Use Rx/Rx+1 for ES |

**Important**: SRD and ERD instructions automatically set the DS/DE flags in PSW.

**Correct usage example:**
```assembly
LDI  0x0000      ; Base offset to R0 (LDI always loads R0)
MOV  R10, R0     ; Copy to R10
ERD  R10         ; Use R10/R11 for ES access, sets DE=1 automatically
```

### 5.4 Single Operand ALU Operations

**Table 5.4: Single Operand Instructions**

| Instruction | Format | Encoding | Description |
|-------------|---------|----------|-------------|
| **SWB** | `SWB Rx` | `[11111110][0000][Rx4]` | Swap Bytes in Rx |
| **INV** | `INV Rx` | `[11111110][0001][Rx4]` | Invert all bits in Rx |
| **NEG** | `NEG Rx` | `[11111110][0010][Rx4]` | Two's complement negation of Rx |

**Usage Example:**
```assembly
LDI  0x1234      ; LDI always loads R0
MOV  R1, R0      ; Copy to R1
SWB  R1          ; R1 = 0x3412
INV  R1          ; R1 = 0xCBED
NEG  R1          ; R1 = 0x3413 (two's complement)
```

### 5.5 Special Move Operations

**Table 5.5: SMV Instruction**

| Instruction | Format | Encoding | Description |
|-------------|---------|----------|-------------|
| **SMV** | `SMV Rd, APC` | `[1111111110][00][Rd4]` | Read Alternate PC to Rd |
| **SMV** | `SMV Rd, APSW` | `[1111111110][01][Rd4]` | Read Alternate PSW to Rd |
| **SMV** | `SMV Rd, PSW` | `[1111111110][10][Rd4]` | Read Current PSW to Rd |
| **SMV** | `SMV Rd, ACS` | `[1111111110][11][Rd4]` | Read Alternate CS to Rd |

**Usage Example:**
```assembly
SMV R1, PSW          ; Read current PSW to R1
SMV R2, APC          ; Read alternate PC (interrupt return address) to R2
```

### 5.6 Long Jump Instruction

**Table 5.6: JML Instruction**

| Instruction | Format | Encoding | Description |
|-------------|---------|----------|-------------|
| **JML** | `JML Rx` | `[11111110][0100][Rx4]` | Jump Long - CS=R[Rx+1], PC=R[Rx] |

**Usage Example:**
```assembly
; Set up far jump address
LDI  0x1000      ; Target offset to R0
MOV  R2, R0      ; Copy to R2
LDI  0x0001      ; Target segment to R0  
MOV  R3, R0      ; Copy to R3
JML  R2          ; Jump to CS=R3=0x0001, PC=R2=0x1000
```

### 5.7 Explicit Segment Memory Operations

**Table 5.7: LDS/STS Instructions**

| Instruction | Format | Encoding | Description |
|-------------|---------|----------|-------------|
| **LDS** | `LDS Rd, seg, Rb` | `[11110][0][seg2][Rd4][Rb4]` | Load from explicit segment |
| **STS** | `STS Rd, seg, Rb` | `[11110][1][seg2][Rd4][Rb4]` | Store to explicit segment |

**Segment Encoding:**
- `00` = CS, `01` = DS, `10` = SS, `11` = ES

**Usage Example:**
```assembly
LDS R1, ES, R10      ; Load from ES:R10 to R1
STS R2, CS, R15      ; Store R2 to CS:PC (unusual but possible)
```

### 5.8 Complete Shift Operations

**Table 5.8: Enhanced Shift Instructions**

| Instruction | Format | Encoding | Description |
|-------------|---------|----------|-------------|
| **SLC** | `SLC Rd, count` | `[110][111][Rd4][00][1][count3]` | Shift Left with Carry |
| **SRC** | `SRC Rd, count` | `[110][111][Rd4][01][1][count3]` | Shift Right with Carry |
| **SAC** | `SAC Rd, count` | `[110][111][Rd4][10][1][count3]` | Shift Arithmetic with Carry |
| **ROC** | `ROC Rd, count` | `[110][111][Rd4][11][1][count3]` | Rotate with Carry |

### 5.9 System Operations

**Table 5.9: Complete System Instructions**

| Instruction | Format | Encoding | Description | Pipeline Effect |
|-------------|---------|----------|-------------|-----------------|
| **NOP** | `NOP` | `[1111111111110][000]` | No operation | Full pipeline |
| **FSH** | `FSH` | `[1111111111110][001]` | Pipeline flush | Pipeline flush |
| **SWI** | `SWI` | `[1111111111110][010]` | Software interrupt | Pipeline flush + context switch |
| **RETI** | `RETI` | `[1111111111110][011]` | Return from interrupt | Pipeline flush + context restore |
| **HLT** | `HLT` | `[1111111111110][111]` | Halt processor | Pipeline freeze |

### 5.10 Complete Instruction Summary

**Table 5.10: Comprehensive Instruction Set**

| Category | Instructions | Notes |
|----------|--------------|-------|
| **Data Movement** | MOV, LDI, LSI, MVS, SMV | LDI always loads R0 |
| **ALU Operations** | ADD, SUB, AND, OR, XOR, MUL, DIV | |
| **32-bit ALU** | MUL32, DIV32 | Explicit 32-bit results |
| **Single Operand ALU** | SWB, INV, NEG | Byte swap, invert, negate |
| **Shift/Rotate** | SL, SLC, SR, SRC, SRA, SAC, ROR, ROC | Complete set with carry variants |
| **Memory Access** | LD, ST, LDS, STS | Bracket and traditional syntax |
| **Control Flow** | JZ, JNZ, JC, JNC, JN, JNN, JO, JNO, JML | All use delay slot |
| **PSW Operations** | SRS, SRD, ERS, ERD, SET, CLR, SET2, CLR2 | SRD/ERD set DS/DE flags |
| **System** | NOP, FSH, SWI, RETI, HLT | Complete system control |

### 5.11 Flag Operation Aliases

**Table 5.11: Common Flag Aliases**

| Alias | Actual Instruction | Purpose |
|-------|-------------------|---------|
| SETN | SET 0 | Set Negative flag |
| CLRN | CLR 0 | Clear Negative flag |
| SETZ | SET 1 | Set Zero flag |
| CLRZ | CLR 1 | Clear Zero flag |
| SETV | SET 2 | Set Overflow flag |
| CLRV | CLR 2 | Clear Overflow flag |
| SETC | SET 3 | Set Carry flag |
| CLRC | CLR 3 | Clear Carry flag |
| SETI | SET2 0 | Enable interrupts |
| CLRI | CLR2 0 | Disable interrupts |
| SETS | SET2 1 | Enable shadow view |
| CLRS | CLR2 1 | Disable shadow view |

---

## 6. Pipeline Architecture

### 6.1 5-Stage Pipeline Structure

**Pipeline Stages:**
1. **IF** (Instruction Fetch) - Fetch instruction from memory using CS:PC
2. **ID** (Instruction Decode) - Decode instruction, read registers, resolve hazards
3. **EX** (Execute) - ALU operations, effective address calculation, branch resolution
4. **MEM** (Memory Access) - Load/store operations, segment register access
5. **WB** (Write Back) - Write results to register file

### 6.2 Delayed Branch Implementation

**One delay slot** is implemented for all branch and jump instructions:
- The instruction immediately following a branch/jump **always executes**
- Compiler/assembler must schedule useful instructions in the delay slot
- **Applies to**: JMP, JZ, JNZ, JC, JNC, JN, JNN, JO, JNO, JML

**Example Optimization:**
```assembly
; Suboptimal - empty delay slot
ADD  R1, R2
JZ   target
NOP            ; Wasted cycle

; Optimized - useful work in delay slot  
ADD  R1, R2
JZ   target
MOV  R3, R4    ; Useful work executes regardless of branch
```

### 6.3 Performance Characteristics

- **Base CPI**: Ideally 1.0 (one instruction per cycle)
- **Realistic CPI**: 1.1-1.3 due to stalls and multi-cycle operations
- **Branch penalty**: 0 cycles (thanks to delayed branch)
- **Load-use penalty**: 1 cycle stall when unavoidable
- **FPGA Target**: 80MHz achievable in modern FPGAs

---

## 7. Programming Model

### 7.1 Register Usage Conventions

| Register | Preserved? | Purpose |
|----------|------------|---------|
| R0       | Caller-save | LDI destination, temporary |
| R1-R11   | Caller-save | General purpose |
| R12 (FP) | Callee-save | Frame pointer |
| R13 (SP) | Callee-save | Stack pointer |
| R14 (LR) | Callee-save | Return address |
| R15 (PC) | - | Program counter |

### 7.2 Stack Frame Layout
```
High addresses
+------------+
| Saved LR   | ← FP + 3
+------------+
| Saved FP   | ← FP + 2  
+------------+
| Local 2    | ← FP + 1
+------------+
| Local 1    | ← FP
+------------+
| Parameter n| ← FP - 1
+------------+
| ...        |
+------------+
| Parameter 1| ← FP - n + 1
+------------+
Low addresses
```

### 7.3 Common Idioms

**Function Prologue (Enhanced Syntax):**
```assembly
; Save frame and link, allocate stack space
MOV  FP, SP          ; Set new frame pointer
LSI  R0, -4          ; Allocate 4 words to R0
ADD  SP, SP, R0      ; Adjust stack pointer
ST   LR, [FP+3]      ; Save return address using bracket syntax
ST   OldFP, [FP+2]   ; Save old frame pointer
```

**Correct Screen Output (Enhanced Syntax):**
```assembly
; Efficient screen writing using ES segment
setup_screen:
    LDI  0x0FFF       ; LDI always loads R0
    INV  R0           ; R0 = 0xF000
    MVS  ES, R0       ; ES = 0xF000
    LDI  0x0000       ; Base offset to R0
    MOV  R10, R0      ; Copy to R10
    ERD  R10          ; Use R10/R11 for ES access, sets DE=1

write_char:
    LDI  'A'          ; Character to R0
    MOV  R1, R0       ; Copy to R1  
    STS  R1, [R10+0x1000]   ; Write to screen using bracket syntax
```

**Array Access (Enhanced Syntax):**
```assembly
; Access array element using enhanced syntax
LDI  array_base
MOV  R1, R0          ; R1 = array base address
LDI  2
MOV  R2, R0          ; R2 = index
MOV  R3, R1+R2       ; R3 = array_base + index (calculate address)
LD   R4, [R3]        ; Load array element using bracket syntax

; Or combined in one operation:
LD   R4, [R1+R2]     ; Load array element directly
```

**Stack Operations (Enhanced Syntax):**
```assembly
; Push multiple values using enhanced syntax
ST   R1, [SP-1]      ; Push R1
ST   R2, [SP-2]      ; Push R2  
ST   R3, [SP-3]      ; Push R3
LSI  R0, -3
ADD  SP, SP, R0      ; Adjust stack pointer

; Pop values
LD   R3, [SP]        ; Pop R3
LD   R2, [SP+1]      ; Pop R2
LD   R1, [SP+2]      ; Pop R1
LSI  R0, 3
ADD  SP, SP, R0      ; Adjust stack pointer
```

**Interrupt Handler:**
```assembly
interrupt_handler:
    ; Automatic context switch to shadow registers
    SMV  R0, APSW     ; Read pre-interrupt PSW to R0
    MOV  R5, R0       ; Copy to R5 for processing
    SMV  R0, APC      ; Read pre-interrupt PC to R0
    MOV  R6, R0       ; Copy to R6
    
    ; Interrupt processing...
    
    RETI              ; Return and restore context
```

**Far Function Call:**
```assembly
far_call:
    ; R2 = target offset, R3 = target segment
    ST   R2, [SP-1]   ; Save target offset
    ST   R3, [SP-2]   ; Save target segment  
    LDI  return_here
    MOV  R4, R0       ; Copy to R4
    ST   R4, [SP-3]   ; Save return address
    JML  R2           ; Far jump

return_here:
    ; Execution continues here after far return
```

---

## 8. Implementation Notes

### 8.1 FPGA Implementation
- **Target Frequency**: 80MHz in modern FPGAs
- **Memory Interface**: 20 address lines, 16 data lines
- **Block RAM**: Can be used for zero-wait-state memory
- **Pipeline registers**: Standard flip-flop implementation

### 8.2 Simulator Integration
- **DeepWeb IDE**: Complete development environment
- **Assembler**: Supports all enhanced syntax features
- **Simulator**: Cycle-accurate with visual debugging
- **Screen Subsystem**: 80×25 character display at 0xF1000

### 8.3 Toolchain Support
- **Assembler Directives**: `.code`, `.data`, `.org`, `.word`, `.text`
- **Label Support**: Forward and backward references
- **Error Reporting**: Comprehensive with line numbers
- **Listing Output**: Includes addresses and generated code
- **Enhanced Syntax**: Bracket notation for LD/ST, plus notation for MOV

---

*Deep16 (深十六) Architecture Specification v4.0 (1r20) - Complete with Enhanced Syntax Documentation*

**New Features Documented:**
- ✅ LD/ST bracket syntax: `LD R1, [R2+5]`, `ST R0, [SP-4]`
- ✅ MOV plus syntax: `MOV R1, R2+3`, `MOV R3, SP-4`
- ✅ All examples updated with enhanced syntax where appropriate
- ✅ Array access and stack operation examples with new syntax
```
