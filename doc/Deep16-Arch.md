# Deep16 (深十六) Architecture Specification Milestone 1r15
## 16-bit RISC Processor with Enhanced Memory Addressing

---

## 1. Processor Overview

Deep16 is a 16-bit RISC processor optimized for efficiency and simplicity:
- **16-bit fixed-length instructions**
- **16 general-purpose registers**
- **Segmented memory addressing** (1MW physical address space)
- **4 segment registers** for code, data, stack and extra
- **shadow register views** for interrupts
- **Hardware-assisted interrupt handling**
- **Complete word-based memory system**
- **Extended addressing** 20 bit physical address space
- **5-stage pipelined implementation** with delayed branch

### 1.1 Key Features
- All instructions exactly 16 bits
- 16 user-visible registers, PC is R15
- 4 segment registers, CS, DS, SS, ES
- Processor status word (PSW) for flags and implicit segment selection
- PC'/CS'/PSW' shadow views for interrupt handling
- Compact encoding with variable-length opcodes
- Enhanced memory addressing with stack/extra registers
- **1-slot delayed branch** for improved pipeline efficiency

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

### 2.2 Segment Registers (16-bit)

**Table 2.2: Segment Registers**

| Register | Code | Purpose |
|----------|------|---------|
| CS       | 00   | Code Segment |
| DS       | 01   | Data Segment |
| SS       | 10   | Stack Segment |
| ES       | 11   | Extra Segment |

The effective 20 bit memory address is computed as (segment << 4) + offset. Which segment register to use is either explicit (LDS/STS) or implicit: CS for instruction fetch, SS or ES when specified via PSW SR/ER or else DS.

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

## 3. Pipeline Architecture

### 3.1 5-Stage Pipeline Structure

The Deep16 implements a classic 5-stage RISC pipeline with delayed branch support:

**Pipeline Stages:**
1. **IF** (Instruction Fetch) - Fetch instruction from memory using CS:PC
2. **ID** (Instruction Decode) - Decode instruction, read registers, resolve hazards
3. **EX** (Execute) - ALU operations, effective address calculation, branch resolution
4. **MEM** (Memory Access) - Load/store operations, segment register access
5. **WB** (Write Back) - Write results to register file

### 3.2 Delayed Branch Implementation

**One delay slot** is implemented for all branch and jump instructions:
- The instruction immediately following a branch/jump **always executes**
- Compiler/assembler must schedule useful instructions in the delay slot
- **Applies to**: JMP, JZ, JNZ, JC, JNC, JN, JNN, JO, JNO, JML

**Example:**
```assembly
JZ   target    ; Branch if zero flag set
ADD  R1, R2    ; This instruction ALWAYS executes (delay slot)
; If branch taken, execution continues at target
; If not taken, execution continues after ADD
```

### 3.3 Pipeline Hazard Management

**Data Hazards:**
- **Forwarding paths**: EX→EX, MEM→EX, WB→EX
- **Load-use stalls**: 1-cycle stall for LD/LDS followed by dependent ALU operation
- **Multi-cycle operations**: MUL/DIV may require additional EX cycles

**Control Hazards:**
- **Delayed branch** eliminates bubbles for most branches
- **JML instruction** may require special handling due to CS segment change
- **RETI** requires careful pipeline flush on context switch

**Memory Hazards:**
- **In-order execution** simplifies memory dependency resolution
- **Segment register operations** coordinated in MEM stage

---

## 4. Shadow Register System

### 4.1 Automatic Context Switching

**On Interrupt:**
- `PSW' ← PSW` (Snapshot pre-interrupt state)
- `PSW'.S ← 1`, `PSW'.I ← 0` (Configure shadow context)
- `CS ← 0` (Interrupts run in Segment 0)
- `PC ← interrupt_vector`
- **Pipeline flushed** to ensure clean context switch

**On RETI:**
- Switch to normal view (PSW.S=0)
- No register copying - pure view switching
- Both contexts preserved for debugging
- **Pipeline flushed** on context restoration

### 4.2 SMV Instruction - Special Move

**Table 4.1: SMV Instruction Encoding**

| SRC2 | Mnemonic | Effect |
|------|----------|--------|
| 00 | SMV DST, APC | `DST ← alternate_PC` |
| 01 | SMV DST, APSW | `DST ← alternate_PSW` |
| 10 | SMV DST, PSW | `DST ← current_PSW` |
| 11 | SMV DST, ACS | `DST ← alternate_CS` |

---

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

### 5.2 SOP Operations (type4)

**Table 5.2: Single Operand Instruction Groups**

| Group | type4 | Mnemonic | Operand | Description | Pipeline Notes |
|-------|-------|----------|---------|-------------|----------------|
| GRP1 | 0000 | SWB | Rx | Swap Bytes | Full pipeline |
| GRP1 | 0001 | INV | Rx | Invert bits | Full pipeline |
| GRP1 | 0010 | NEG | Rx | Two's complement | Full pipeline |
| GRP2 | 0100 | JML | Rx | Jump Long (CS=R[Rx+1], PC=R[Rx]) | **Uses delay slot**, may flush |
| GRP3 | 1000 | SRS | Rx | Stack Register Single | PSW update |
| GRP3 | 1001 | SRD | Rx | Stack Register Dual | PSW update |
| GRP3 | 1010 | ERS | Rx | Extra Register Single | PSW update |
| GRP3 | 1011 | ERD | Rx | Extra Register Dual | PSW update |
| GRP4 | 1100 | SET | imm4 | Set flag bits in PSW[3:0] | PSW update |
| GRP4 | 1101 | CLR | imm4 | Clear flag bits in PSW[3:0] | PSW update |
| GRP4 | 1110 | SET2 | imm4 | Set bits in PSW[7:4] | PSW update |
| GRP4 | 1111 | CLR2 | imm4 | Clear bits in PSW[7:4] | PSW update |

**Aliases:**
- `SETI` = `SET2 1` (Set Interrupt Enable: PSW[4]=1)
- `CLRI` = `CLR2 1` (Clear Interrupt Enable: PSW[4]=0)

### 5.3 SET/CLR Flag Bit Encoding

**Table 5.3: SET/CLR Flag Encoding (PSW[3:0])**

| imm4 | Operation | Flag | imm4 | Operation | Flag |
|------|-----------|------|------|-----------|------|
| 0000 | SET | N | 1000 | CLR | N |
| 0001 | SET | Z | 1001 | CLR | Z |
| 0010 | SET | V | 1010 | CLR | V |
| 0011 | SET | C | 1011 | CLR | C |

**Table 5.4: SET2/CLR2 Bit Encoding (PSW[7:4])**

| imm4 | Bit | Purpose |
|------|-----|---------|
| 0000 | 4 | Interrupt Enable (I) |
| 0001 | 5 | Shadow View (S) |
| 0010 | 6 | Reserved |
| 0011 | 7 | Reserved |

---

## 6. Detailed Instruction Formats

### 6.1 LDI - Load Long Immediate
```
Bits: [0][ imm15 ]
      1     15
```
- **Effect**: `R0 ← immediate`
- **Range**: 0 to 32,767
- **Pipeline**: Full 5-stage execution

### 6.2 LD/ST - Load/Store with Implicit Segment
```
Bits: [10][ d ][ Rd ][ Rb ][ offset5 ]
      2    1    4     4      5
```
- **d=0**: Load `Rd ← Mem[implicit_segment:Rb + offset]`
- **d=1**: Store `Mem[implicit_segment:Rb + offset] ← Rd`
- **offset5**: 5-bit unsigned immediate (0-31 words)
- **Pipeline**: Potential 1-cycle stall if load followed by dependent operation

### 6.3 ALU2 - Dual Operand ALU Operations
```
Bits: [110][ op3 ][ Rd ][ w ][ i ][ Rs/imm4 ]
      3     3      4     1    1      4
```
- **w=0**: Update flags only (ANW, CMP, TBS, TBC operations)
- **w=1**: Write result to Rd
- **i=0**: Register mode `Rd ← Rd op Rs`
- **i=1**: Immediate mode `Rd ← Rd op imm4`
- **Pipeline**: Full forwarding support for data hazards

### 6.4 JMP - Jump/Branch Operations
```
Bits: [1110][ type3 ][ target9 ]
      4      3         9
```
- **target9**: 9-bit signed immediate (-256 to +255 words)
- **Pipeline**: **Uses 1 delay slot** - next instruction always executes

### 6.5 LSI - Load Short Immediate
```
Bits: [1111110][ Rd ][ imm5 ]
      7         4     5
```
- **Effect**: `Rd ← sign_extend(imm5)`
- **Range**: -16 to +15
- **Pipeline**: Full 5-stage execution

### 6.6 LDS/STS - Load/Store with Explicit Segment
```
Bits: [11110][ d ][ seg2 ][ Rd ][ Rs ]
      5       1     2       4     4
```
- **d=0**: Load `Rd ← Mem[seg:Rs]`
- **d=1**: Store `Mem[seg:Rs] ← Rd`
- **seg2**: 00=CS, 01=DS, 10=SS, 11=ES
- **Pipeline**: Segment register access in MEM stage

### 6.7 MOV - Move with Offset
```
Bits: [111110][ Rd ][ Rs ][ imm2 ]
      6        4     4      2
```
- **Effect**: `Rd ← Rs + zero_extend(imm2)`
- **Range**: 0-3
- **Pipeline**: Full 5-stage execution

### 6.8 SOP - Single Operand Operations
```
Bits: [11111110][ type4 ][ Rx/imm4 ]
      8          4        4
```
- **GRP1 (000x)**: ALU1 operations (SWB, INV, NEG)
- **GRP2 (0100)**: Special jump (JML) - **uses delay slot**
- **GRP3 (10xx)**: PSW segment assignment (SRS, SRD, ERS, ERD)
- **GRP4 (11xx)**: PSW flag manipulation (SET, CLR, SET2, CLR2)

### 6.9 MVS - Move to/from Segment
```
Bits: [111111110][ d ][ Rd ][ seg2 ]
      9           1    4      2
```
- **d=0**: `Rd ← Sx` where Sx is segment register CS/DS/SS/ES
- **d=1**: `Sx ← Rd` where Sx is segment register CS/DS/SS/ES
- **Pipeline**: Segment register access in MEM stage

### 6.10 SMV - Special Move
```
Bits: [1111111110][ src2 ][ Rd ]
      10           2       4
```
- Access alternate register views (APC, APSW, ACS, PSW)
- **Pipeline**: Special register access with potential stalls

### 6.11 SYS - System Operations
```
Bits: [1111111111110][ op3 ]
      13               3
```
- **op3**: 000=NOP, 001=HLT, 010=SWI, 011=RETI, 100-111=reserved
- **Pipeline**: RETI causes pipeline flush and context switch

---

## 7. ALU Operations

### 7.1 ALU2 Operation Codes (op3)

**Table 7.1: ALU2 Operations**

| op3 | Mnemonic | Description | w=1 (Write) | w=0 (Flags Only) | Pipeline |
|-----|----------|-------------|-------------|------------------|----------|
| 000 | ADD | Addition | `Rd ← Rd + Rs/imm` | ANW (Add No Write) | Full pipeline |
| 001 | SUB | Subtraction | `Rd ← Rd - Rs/imm` | CMP (Compare) | Full pipeline |
| 010 | AND | Logical AND | `Rd ← Rd & Rs/imm` | TBS (Test Bit Set) | Full pipeline |
| 011 | OR | Logical OR | `Rd ← Rd | Rs/imm` | - | Full pipeline |
| 100 | XOR | Logical XOR | `Rd ← Rd ^ Rs/imm` | TBC (Test Bit Clear) | Full pipeline |
| 101 | MUL | Multiplication | `Rd ← Rd × Rs` | - | Multi-cycle EX |
| 110 | DIV | Division | `Rd ← Rd ÷ Rs` | - | Multi-cycle EX |
| 111 | Shift | Shift operations | Various shifts | - | Full pipeline |

### 7.2 MUL/DIV Behavior

**MUL Operations:**
- **MUL Rd, Rs** (i=0): 16×16→16-bit multiplication
- **MUL Rd, Rs** (i=1): 16×16→32-bit multiplication, **Rd must be even**

**DIV Operations:**
- **DIV Rd, Rs** (i=0): 16÷16→16-bit division (quotient)
- **DIV Rd, Rs** (i=1): 16÷16→32-bit division, **Rd must be even**

### 7.3 Shift Operations (ALU op=111)

**Shift Type Encoding:**
```
[ T2 ][ C ][ count3 ]
 2     1     3
```

**Table 7.2: Shift Operations**

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

### 7.4 JMP Conditions (type3)

**Table 7.3: Jump Conditions**

| type3 | Mnemonic | Condition | Pipeline |
|-------|----------|-----------|----------|
| 000 | JZ | Z=1 | **Uses delay slot** |
| 001 | JNZ | Z=0 | **Uses delay slot** |
| 010 | JC | C=1 | **Uses delay slot** |
| 011 | JNC | C=0 | **Uses delay slot** |
| 100 | JN | N=1 | **Uses delay slot** |
| 101 | JNN | N=0 | **Uses delay slot** |
| 110 | JO | V=1 | **Uses delay slot** |
| 111 | JNO | V=0 | **Uses delay slot** |

### 7.5 System Operations (op3)

**Table 7.4: System Operations**

| op3 | Mnemonic | Description | Pipeline Effect |
|-----|----------|-------------|-----------------|
| 000 | NOP | No operation | Full pipeline |
| 001 | FSH | NO OPERATION | Pipeline flush |
| 010 | SWI | Software interrupt | Pipeline flush + context switch |
| 011 | RETI | Return from interrupt | Pipeline flush + context restore |
| 111 | HLT | Halt processor | Pipeline freeze |

---

## 8. Pipeline Implementation Notes

### 8.1 Compiler Considerations for Delayed Branch

**Optimal Delay Slot Scheduling:**
- Prefer **ALU operations** unrelated to branch condition
- Use **register moves** or **immediate loads**
- Avoid **memory operations** that might cause stalls
- **NOP** if no useful instruction can be scheduled

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

### 8.2 Hazard Detection Unit

The pipeline includes hardware to detect:
- **RAW** (Read-After-Write) hazards
- **Load-use** dependencies requiring stalls
- **Control hazards** managed via delayed branch
- **Structural hazards** on register file/memory access

### 8.3 Performance Characteristics

- **Base CPI**: Ideally 1.0 (one instruction per cycle)
- **Realistic CPI**: 1.1-1.3 due to stalls and multi-cycle operations
- **Branch penalty**: 0 cycles (thanks to delayed branch)
- **Load-use penalty**: 1 cycle stall when unavoidable

---

*Deep16 (深十六) Architecture Specification v3.5 (1r14) - With Pipeline Implementation Details*
