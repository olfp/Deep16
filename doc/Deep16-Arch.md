# Deep16 (深十六) Architecture Specification Milestone 2
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
- **Non-forwarded load capability** for architectural state access

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
- **Architectural register access** via MOV with immediate=3

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
0xFFFF0 - 0xFFFFF: Boot ROM (16 words) - Initial boot sequence
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
- **Initial registers**: `CS = 0xFFFF`, `DS = 0x1000`, `SS = 0x8000`, `ES = 0x2000`, `SP (R13) = 0x7FFF`, `PC (R15) = 0x0000`, `PSW = 0x0000`
- **Boot ROM** at `0xFFFF0..0xFFFFF` executes first and establishes runtime segments, performs basic diagnostics, and jumps to low memory.
- **Execution begins** at physical address computed by the boot ROM's jump (default `CS:PC = 0x0000:0x0100`).

#### 4.2.1 Boot ROM Sequence (at 0xFFFF0)
```
0xFFFF0: 0x0000    ; LDI  #0x0000 -> R0
0xFFFF1: 0xFF41    ; MVS  DS, R0
0xFFFF2: 0xFF42    ; MVS  SS, R0
0xFFFF3: 0xFC21    ; LSI  R1, 1
0xFFFF4: 0xFE01    ; SWB  R1
0xFFFF5: 0xA200    ; ST   R1, [R0+0]
0xFFFF6: 0xA201    ; ST   R1, [R0+1]
0xFFFF7: 0xA201    ; ST   R1, [R0+1]
0xFFFF8: 0xFE40    ; JML  R0        ; Jump to CS=R0, PC=R1
0xFFFF9: 0xFFF0    ; NOP             ; Delay slot
0xFFFFA: 0xFFFF    ; HLT
0xFFFFB: 0xFFFF    ; HLT
0xFFFFC: 0xFFFF    ; HLT
0xFFFFD: 0xFFFF    ; HLT
0xFFFFE: 0xFFFF    ; HLT
0xFFFFF: 0xFFFF    ; HLT
```

Default effect:
- Sets `DS = 0x0000` and `SS = 0x0000`
- Prepares `R1 = 0x0100` via `LSI` and `SWB`
- Stores diagnostic words at physical `0x00000..`
- Performs `JML R0` using the `(R0,R1)` pair → jumps to `CS=0x0000`, `PC=0x0100`

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

## 5. Instruction Set

## 5. Instruction Set Summary

### 5.1 Complete Opcode Hierarchy

**Table 5.1: Instruction Opcode Hierarchy**

| Opcode | Bits | Instruction | Format | Pipeline Notes |
|--------|------|-------------|--------|----------------|
| 0 | 1 | LDI | `[0][imm15]` | Full pipeline |
| 10 | 2 | LD/ST | `[10][d1][Rd4][Rb4][offset5]` | Potential load-use stall |
| 110 | 3 | ALU2 | `[110][op3][Rd4][w1][i1][Rs/imm4]` | Full pipeline, forwarding |
| 1110 | 4 | JMP | `[1110][type3][target9]` | **Uses delay slot** |
| 11110 | 5 | LDS/STS | `[11110][d1][seg2][Rd4][Rs4]` | Segment access in MEM |
| 111110 | 6 | MOV | `[111110][Rd4][Rs4][imm2]` | Full pipeline |
| 1111110 | 7 | LSI | `[1111110][Rd4][imm5]` | Full pipeline |
| 11111110 | 8 | SOP | `[11111110][type4][Rx/imm4]` | Various pipeline effects |
| 111111110 | 9 | MVS | `[111111110][d1][Rd4][seg2]` | Segment access in MEM |
| 1111111110 | 10 | SMV | `[1111111110][src2][Rd4]` | Special register access |
| 1111111111110 | 13 | SYS | `[1111111111110][op3]` | Pipeline flush on RETI |
| 111111111111111 | 16 | HLT ˋ[111111111111111]ˋ | Halt the processor |

The immediate values of LDI, LD/ST, ALU2, MOV and SOP are insigned. JMP and LSI take signed immediates.

### 5.1 Data Movement Instructions

**Table 5.1: Data Movement Instructions**

| Instruction | Format | Binary Encoding | Opcode Prefix | Behavior |
|-------------|---------|-----------------|---------------|----------|
| **MOV** | `MOV Rd, Rs, imm` | `111110 Rd4 Rs4 imm2` | 0xF8 | `Rd = Rs + imm` |
| **LDI** | `LDI imm` | `0 imm15` | 0x00 | `R0 = imm` |
| **LSI** | `LSI Rd, imm` | `1111110 Rd4 imm5` | 0xFC | `Rd = imm` (sign-extended) |
| **MVS** | `MVS Rd, Sx` | `111111110 0 Rd4 seg2` | 0x1FE | `Rd = Sx` |
| **MVS** | `MVS Sx, Rd` | `111111110 1 Rd4 seg2` | 0x1FE | `Sx = Rd` |
| **SMV** | `SMV Rd, APC` | `1111111110 00 Rd4` | 0x3FC | `Rd = PC'` |
| **SMV** | `SMV Rd, APSW` | `1111111110 01 Rd4` | 0x3FC | `Rd = PSW'` |
| **SMV** | `SMV Rd, PSW` | `1111111110 10 Rd4` | 0x3FC | `Rd = PSW` |
| **SMV** | `SMV Rd, ACS` | `1111111110 11 Rd4` | 0x3FC | `Rd = CS'` |

### 5.2 ALU Instructions

**Table 5.2: ALU Instructions**

| Instruction | Format | Binary Encoding | Opcode Prefix | Behavior |
|-------------|---------|-----------------|---------------|----------|
| **ADD** | `ADD Rd, Rs` | `110 000 Rd4 1 0 Rs4` | 0xC0 | `Rd = Rd + Rs`, set flags |
| **ADD** | `ADD Rd, imm` | `110 000 Rd4 1 1 imm4` | 0xC0 | `Rd = Rd + imm`, set flags |
| **SUB** | `SUB Rd, Rs` | `110 001 Rd4 1 0 Rs4` | 0xC4 | `Rd = Rd - Rs`, set flags |
| **SUB** | `SUB Rd, imm` | `110 001 Rd4 1 1 imm4` | 0xC4 | `Rd = Rd - imm`, set flags |
| **AND** | `AND Rd, Rs` | `110 010 Rd4 1 0 Rs4` | 0xC8 | `Rd = Rd & Rs`, set flags |
| **AND** | `AND Rd, imm` | `110 010 Rd4 1 1 imm4` | 0xC8 | `Rd = Rd & imm`, set flags |
| **OR** | `OR Rd, Rs` | `110 011 Rd4 1 0 Rs4` | 0xCC | `Rd = Rd | Rs`, set flags |
| **OR** | `OR Rd, imm` | `110 011 Rd4 1 1 imm4` | 0xCC | `Rd = Rd | imm`, set flags |
| **XOR** | `XOR Rd, Rs` | `110 100 Rd4 1 0 Rs4` | 0xD0 | `Rd = Rd ^ Rs`, set flags |
| **XOR** | `XOR Rd, imm` | `110 100 Rd4 1 1 imm4` | 0xD0 | `Rd = Rd ^ imm`, set flags |
| **MUL** | `MUL Rd, Rs` | `110 101 Rd4 1 0 Rs4` | 0xD4 | `Rd = Rd * Rs`, set flags |
| **MUL** | `MUL Rd, imm` | `110 101 Rd4 1 1 imm4` | 0xD4 | `Rd = Rd * imm`, set flags |
| **DIV** | `DIV Rd, Rs` | `110 110 Rd4 1 0 Rs4` | 0xD8 | `Rd = Rd / Rs`, set flags |
| **DIV** | `DIV Rd, imm` | `110 110 Rd4 1 1 imm4` | 0xD8 | `Rd = Rd / imm`, set flags |

### 5.3 32-bit ALU Instructions

**Table 5.3: 32-bit ALU Instructions**

| Instruction | Format | Binary Encoding | Opcode Prefix | Behavior |
|-------------|---------|-----------------|---------------|----------|
| **MUL32** | `MUL32 Rd, Rs` | `110 101 Rd4 1 1 Rs4` | 0xD4 | `R[d]:R[d+1] = Rd * Rs` |
| **DIV32** | `DIV32 Rd, Rs` | `110 110 Rd4 1 1 Rs4` | 0xD8 | `R[d]:R[d+1] = Rd / Rs` |

### 5.4 Single Operand ALU Operations

**Table 5.4: Single Operand Instructions**

| Instruction | Format | Binary Encoding | Opcode Prefix | Behavior |
|-------------|---------|-----------------|---------------|----------|
| **SWB** | `SWB Rx` | `11111110 0000 Rx4` | 0xFE | `Rx = (Rx << 8) | (Rx >> 8)` |
| **INV** | `INV Rx` | `11111110 0001 Rx4` | 0xFE | `Rx = ~Rx` |
| **NEG** | `NEG Rx` | `11111110 0010 Rx4` | 0xFE | `Rx = -Rx` |

### 5.5 Shift and Rotate Instructions

**Table 5.5: Shift and Rotate Instructions**

| Instruction | Format | Binary Encoding | Opcode Prefix | Behavior |
|-------------|---------|-----------------|---------------|----------|
| **SL** | `SL Rd, count` | `110 111 Rd4 000 count4` | 0xDC | `Rd = Rd << count`, C = MSB |
| **SLC** | `SLC Rd, count` | `110 111 Rd4 001 count4` | 0xDC | `Rd = (Rd << count) | (C << (count-1))`, C = MSB |
| **SR** | `SR Rd, count` | `110 111 Rd4 010 count4` | 0xDC | `Rd = Rd >> count`, C = LSB |
| **SRC** | `SRC Rd, count` | `110 111 Rd4 011 count4` | 0xDC | `Rd = (Rd >> count) | (C << (15-count))`, C = LSB |
| **SRA** | `SRA Rd, count` | `110 111 Rd4 100 count4` | 0xDC | `Rd = Rd >> count` (arithmetic), C = LSB |
| **SAC** | `SAC Rd, count` | `110 111 Rd4 101 count4` | 0xDC | `Rd = (Rd >> count) | (C << (15-count))` (arithmetic), C = LSB |
| **ROR** | `ROR Rd, count` | `110 111 Rd4 110 count4` | 0xDC | `Rd = (Rd >> count) | (Rd << (16-count))` |
| **ROC** | `ROC Rd, count` | `110 111 Rd4 111 count4` | 0xDC | `Rd = (Rd >> count) | (C << (15-count)) | (Rd << (16-count))` |

### 5.6 Memory Access Instructions

**Table 5.6: Memory Access Instructions**

| Instruction | Format | Binary Encoding | Opcode Prefix | Behavior |
|-------------|---------|-----------------|---------------|----------|
| **LD** | `LD Rd, Rb, offset` | `10 0 Rd4 Rb4 offset5` | 0x80 | `Rd = Mem[DS:(Rb + offset)]` |
| **ST** | `ST Rd, Rb, offset` | `10 1 Rd4 Rb4 offset5` | 0xA0 | `Mem[DS:(Rb + offset)] = Rd` |
| **LDS** | `LDS Rd, seg, Rb` | `11110 0 seg2 Rd4 Rb4` | 0xF0 | `Rd = Mem[seg:Rb]` |
| **STS** | `STS Rd, seg, Rb` | `11110 1 seg2 Rd4 Rb4` | 0xF2 | `Mem[seg:Rb] = Rd` |

### 5.7 Control Flow Instructions

**Table 5.7: Condition Codes for Jump Instructions**

| Condition | Code | Mnemonic | Test |
|-----------|------|----------|------|
| Zero | 000 | JZ | Z = 1 |
| Not Zero | 001 | JNZ | Z = 0 |
| Carry | 010 | JC | C = 1 |
| No Carry | 011 | JNC | C = 0 |
| Negative | 100 | JN | N = 1 |
| Not Negative | 101 | JNN | N = 0 |
| Overflow | 110 | JO | V = 1 |
| No Overflow | 111 | JNO | V = 0 |

**Table 5.8: Control Flow Instructions**

| Instruction | Format | Binary Encoding | Opcode Prefix | Behavior |
|-------------|---------|-----------------|---------------|----------|
| **JZ** | `JZ target` | `1110 000 target9` | 0xE0 | `if (Z) PC = PC + 1 + target` |
| **JNZ** | `JNZ target` | `1110 001 target9` | 0xE0 | `if (!Z) PC = PC + 1 + target` |
| **JC** | `JC target` | `1110 010 target9` | 0xE0 | `if (C) PC = PC + 1 + target` |
| **JNC** | `JNC target` | `1110 011 target9` | 0xE0 | `if (!C) PC = PC + 1 + target` |
| **JN** | `JN target` | `1110 100 target9` | 0xE0 | `if (N) PC = PC + 1 + target` |
| **JNN** | `JNN target` | `1110 101 target9` | 0xE0 | `if (!N) PC = PC + 1 + target` |
| **JO** | `JO target` | `1110 110 target9` | 0xE0 | `if (V) PC = PC + 1 + target` |
| **JNO** | `JNO target` | `1110 111 target9` | 0xE0 | `if (!V) PC = PC + 1 + target` |
| **JML** | `JML Rx` | `11111110 0100 Rx4` | 0xFE | `CS = R[Rx], PC = R[Rx+1]` |

### 5.8 PSW Operations

**Table 5.9: PSW Segment Assignment Operations**

| Instruction | Format | Binary Encoding | Opcode Prefix | Behavior |
|-------------|---------|-----------------|---------------|----------|
| **SRS** | `SRS Rx` | `11111110 1000 Rx4` | 0xFE | `PSW.SR = Rx, PSW.DS = 0` |
| **SRD** | `SRD Rx` | `11111110 1001 Rx4` | 0xFE | `PSW.SR = Rx, PSW.DS = 1` |
| **ERS** | `ERS Rx` | `11111110 1010 Rx4` | 0xFE | `PSW.ER = Rx, PSW.DE = 0` |
| **ERD** | `ERD Rx` | `11111110 1011 Rx4` | 0xFE | `PSW.ER = Rx, PSW.DE = 1` |

**Table 5.10: PSW Flag Operations**

| Instruction | Format | Binary Encoding | Opcode Prefix | Behavior |
|-------------|---------|-----------------|---------------|----------|
| **SET** | `SET imm` | `11111110 1100 imm4` | 0xFE | `PSW[imm] = 1` |
| **CLR** | `CLR imm` | `11111110 1101 imm4` | 0xFE | `PSW[imm] = 0` |
| **SET2** | `SET2 imm` | `11111110 1110 imm4` | 0xFE | `PSW[imm+4] = 1` |
| **CLR2** | `CLR2 imm` | `11111110 1111 imm4` | 0xFE | `PSW[imm+4] = 0` |

### 5.9 System Operations

**Table 5.11: System Instructions**

| Instruction | Format | Binary Encoding | Opcode Prefix | Behavior |
|-------------|---------|-----------------|---------------|----------|
| **NOP** | `NOP` | `1111111111110 000` | 0x1FFC | No operation |
| **FSH** | `FSH` | `1111111111110 001` | 0x1FFC | Flush pipeline |
| **SWI** | `SWI` | `1111111111110 010` | 0x1FFC | Software interrupt |
| **RETI** | `RETI` | `1111111111110 011` | 0x1FFC | Return from interrupt |

### 5.10 Halt Instruction

**Table 5.12: Halt Instruction**

| Instruction | Format | Binary Encoding | Opcode Prefix | Behavior |
|-------------|---------|-----------------|---------------|----------|
| **HLT** | `HLT` | `1111111111111111` | 0xFFFF | Halt processor |

### 5.11 Enhanced Assembler Syntax (Preprocessing Only)

**Important**: The enhanced syntax described below is purely **assembler preprocessing**. The binary encoding always uses the specific instruction (MOV, MVS, SMV, LD, ST). The assembler automatically translates enhanced syntax to the correct machine instruction.

#### 5.11.1 LD/ST Bracket Syntax

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

#### 5.11.2 MOV Plus Syntax

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

### 5.12 MOV Special Immediate Value

The immediate value `3` in MOV instructions has special meaning:
- **MOV Rx, Ry, 3**: Architectural register read - reads the current architectural value of Ry, ignoring any pending writes in the pipeline
- When detected by hardware (immediate value = 3), forwarding is bypassed and the register file is read directly
- This enables correct PC reading for link instructions in delay slots
- For general registers, this provides a mechanism to read stable architectural state

### 5.13 Instruction Aliases

**Table 5.13: Instruction Aliases**

| Alias | Actual Instruction | Purpose |
|-------|-------------------|---------|
| HALT | HLT | Halt processor |
| JMP Rx | MOV PC, Rx | Unconditional jump to register |
| LNK Rx | MOV Rx, PC, 2 | Link to subroutine (standard case) |
| LINK | MOV LR, PC, 2 | Link to subroutine using LR (standard case) |
| AMV Rx, Ry | MOV Rx, Ry, 3 | Architectural move (bypass forwarding) |
| ALNK Rx | MOV Rx, PC, 3 | Architectural link in delay slot |
| ALINK | MOV LR, PC, 3 | Architectural link to LR in delay slot |

### 5.14 Flag Operation Aliases

**Table 5.14: Common Flag Aliases**

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

## Usage Examples

**Traditional approach (LNK before jump):**
```assembly
LNK R14           ; MOV R14, PC, 2 - R14 = return_here
JMP R3            ; Jump to subroutine
NOP               ; Wasted delay slot
return_here: NOP  ; Return here
```

**Optimized approach (ALNK in delay slot):**
```assembly
JMP R3            ; Jump to subroutine  
ALNK R14          ; MOV R14, PC, 3 - Architectural read of PC
return_here: NOP  ; Return here
```

**General architectural read:**
```assembly
ADD R1, R2        ; R1 being written in pipeline
AMV R3, R1        ; MOV R3, R1, 3 - Read architectural R1 (bypass forwarding)
```

Both link approaches correctly set R14 to `return_here`.

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
- **Applies to**: All conditional jumps (JZ, JNZ, JC, JNC, JN, JNN, JO, JNO), JML

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

### 6.3 Forwarding and Hazard Handling

The pipeline implements comprehensive forwarding to resolve data hazards:

**Standard Forwarding:**
- EX/MEM → EX: Forward results from previous ALU operation
- MEM/WB → EX: Forward results from load/memory operations
- Eliminates most data hazard stalls

**Architectural Register Access:**
- **MOV Rx, Ry, 3**: Bypasses all forwarding mechanisms
- Reads the current architectural value from register file
- Essential for correct PC reading in delay slot link instructions
- Provides stable state access for synchronization operations

### 6.4 Performance Characteristics

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
    MOV  ES, R0       ; Enhanced MOV to segment register
    LDI  0x0000       ; Base offset to R0
    MOV  R10, R0      ; Enhanced MOV syntax
    ERD  R10          ; Use R10/R11 for ES access, sets DE=1

write_char:
    LDI  'H'          ; Character to R0
    MOV  R1, R0       ; Copy to R1  
    STS  R1, [R10+0x1000]    ; Enhanced bracket syntax for screen write
    
    RET
```

**Far Function Call:**
```assembly
far_call:
    ; R2 = target segment, R3 = target offset
    ST   R2, [SP-1]   ; Save target segment
    ST   R3, [SP-2]   ; Save target offset
    LDI  return_here
    MOV  R4, R0       ; Copy to R4
    ST   R4, [SP-3]   ; Save return address
    JML  R2           ; Far jump to CS=R2, PC=R3

return_here:
    ; Execution continues here after far return
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
- **Instruction Aliases**: HALT, JMP, LNK, LINK, AMV, ALNK, ALINK, and flag operations

---

*Deep16 (深十六) Architecture Specification v4.6 (1r22) - Complete with HLT as Separate Opcode*

**Key Updates:**
- ✅ HLT moved to dedicated opcode 0xFFFF (all ones)
- ✅ Boot ROM updated with HLT instructions (0xFFFF)
- ✅ System instructions table updated (HLT removed)
- ✅ Halt instruction added as separate section
- ✅ All tables renumbered accordingly
- ✅ Boot ROM sequence corrected with new HLT encoding
