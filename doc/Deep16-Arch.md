# Deep16 (深十六) Architecture Specification Milestone 1r21
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

### 5.1 Enhanced Assembler Syntax (Preprocessing Only)

**Important**: The enhanced syntax described below is purely **assembler preprocessing**. The binary encoding always uses the specific instruction (MOV, MVS, SMV, LD, ST). The assembler automatically translates enhanced syntax to the correct machine instruction.

#### 5.1.1 LD/ST Bracket Syntax

**Assembler Input (Enhanced Syntax):**
```assembly
LD   R1, [R2+5]       ; Assembler preprocessing
ST   R1, [SP-4]       ; Assembler preprocessing
LD   R1, [R2]         ; Offset 0 implied
```

**Actual Binary Encoding:**
```assembly
LD   R1, R2, 5        ; Machine instruction: [10][0][R1][R2][5]
ST   R1, SP, 4        ; Machine instruction: [10][1][R1][SP][4]  
LD   R1, R2, 0        ; Machine instruction: [10][0][R1][R2][0]
```

#### 5.1.2 MOV Plus Syntax

**Assembler Input (Enhanced Syntax):**
```assembly
MOV  R1, R2+3         ; Assembler preprocessing
MOV  R3, SP-4         ; Assembler preprocessing
```

**Actual Binary Encoding:**
```assembly
MOV  R1, R2, 3        ; Machine instruction: [111110][R1][R2][3]
MOV  R3, SP, 0        ; Note: Negative offsets not supported in MOV
```

### 5.2 Universal MOV Instruction (Assembler Preprocessing)

The `MOV` mnemonic is processed by the assembler to select the appropriate instruction encoding:

| Assembler Input | Actual Instruction | Binary Encoding |
|-----------------|-------------------|-----------------|
| `MOV Rd, Rs` | MOV | `[111110][Rd][Rs][0]` |
| `MOV Rd, Rs, imm` | MOV | `[111110][Rd][Rs][imm]` |
| `MOV Rd, Rs+imm` | MOV | `[111110][Rd][Rs][imm]` |
| `MOV Rd, Sx` | MVS Rd, Sx | `[111111110][0][Rd][seg]` |
| `MOV Sx, Rd` | MVS Sx, Rd | `[111111110][1][Rd][seg]` |
| `MOV Rd, PSW` | SMV Rd, PSW | `[1111111110][10][Rd]` |
| `MOV Rd, APC` | SMV Rd, APC | `[1111111110][00][Rd]` |

**Important**: The processor only understands the specific instructions (MOV, MVS, SMV). The universal MOV is purely an assembler convenience feature.

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
| **Memory Access** | LD, ST, LDS, STS | Bracket syntax is assembler preprocessing |
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

*Deep16 (深十六) Architecture Specification v4.1 (1r21) - Clarified Assembler Preprocessing*

**Key Clarifications:**
- ✅ Enhanced syntax (bracket/plus notation) is purely assembler preprocessing
- ✅ Binary encoding always uses specific instructions (MOV, MVS, SMV, LD, ST)
- ✅ Universal MOV is assembler convenience, not processor feature
- ✅ Clear separation between assembler input and machine encoding
