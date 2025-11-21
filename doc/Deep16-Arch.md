# Deep16 (深十六) Architecture Specification v3.5 (1r13)
## 16-bit RISC Processor with Enhanced Memory Addressing

---

## 1. Processor Overview

Deep16 is a 16-bit RISC processor optimized for efficiency and simplicity:
- **16-bit fixed-length instructions**
- **16 general-purpose registers** + **shadow register views**
- **Segmented memory addressing** (2MB physical address space)
- **3-stage pipeline** design
- **Hardware-assisted interrupt handling**
- **Complete word-based memory system**

### 1.1 Key Features
- All instructions exactly 16 bits
- 16 user-visible registers + PC/PSW/CS shadow views
- Compact encoding with variable-length opcodes
- Enhanced memory addressing with stack/extra registers
- Clean instruction encoding with no conflicts

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

The effective 20 bit memory address is computed as (segment << 4) + offset. Which sehment register to use is either explicit (LDS/STS) or implicit: CS for intruction fetch, SS or ES when specified cua PSW SR/ER or else DS.

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

## 3. Shadow Register System

### 3.1 Automatic Context Switching

**On Interrupt:**
- `PSW' ← PSW` (Snapshot pre-interrupt state)
- `PSW'.S ← 1`, `PSW'.I ← 0` (Configure shadow context)
- `CS ← 0` (Interrupts run in Segment 0)
- `PC ← interrupt_vector`

**On RETI:**
- Switch to normal view (PSW.S=0)
- No register copying - pure view switching
- Both contexts preserved for debugging

### 3.2 SMV Instruction - Special Move

**Table 3.1: SMV Instruction Encoding**

| SRC2 | Mnemonic | Effect |
|------|----------|--------|
| 00 | SMV DST, APC | `DST ← alternate_PC` |
| 01 | SMV DST, APSW | `DST ← alternate_PSW` |
| 10 | SMV DST, PSW | `DST ← current_PSW` |
| 11 | SMV DST, ACS | `DST ← alternate_CS` |

---

## 4. Instruction Set Summary

### 4.1 Complete Opcode Hierarchy

**Table 4.1: Instruction Opcode Hierarchy**

| Opcode | Bits | Instruction | Format |
|--------|------|-------------|--------|
| 0 | 1 | LDI | `[0][imm15]` |
| 10 | 2 | LD/ST | `[10][d1][Rd4][Rb4][offset5]` |
| 110 | 3 | ALU2 | `[110][op3][Rd4][w1][i1][Rs/imm4]` |
| 1110 | 4 | JMP | `[1110][type3][target9]` |
| 11110 | 5 | LDS/STS | `[11110][d1][seg2][Rd4][Rs4]` |
| 111110 | 6 | MOV | `[111110][Rd4][Rs4][imm2]` |
| 1111110 | 7 | LSI | `[1111110][Rd4][imm5]` |
| 11111110 | 8 | SOP | `[11111110][type4][Rx/imm4]` |
| 111111110 | 9 | MVS | `[111111110][d1][Rd4][seg2]` |
| 1111111110 | 10 | SMV | `[1111111110][src2][Rd4]` |
| 1111111111110 | 13 | SYS | `[1111111111110][op3]` |

### 4.2 SOP Operations (type4)

**Table 4.2: Single Operand Instruction Groups**

| Group | type4 | Mnemonic | Operand | Description |
|-------|-------|----------|---------|-------------|
| GRP1 | 0000 | SWB | Rx | Swap Bytes |
| GRP1 | 0001 | INV | Rx | Invert bits |
| GRP1 | 0010 | NEG | Rx | Two's complement |
| GRP2 | 0100 | JML | Rx | Jump Long (CS=R[Rx+1], PC=R[Rx]) |
| GRP3 | 1000 | SRS | Rx | Stack Register Single |
| GRP3 | 1001 | SRD | Rx | Stack Register Dual |
| GRP3 | 1010 | ERS | Rx | Extra Register Single |
| GRP3 | 1011 | ERD | Rx | Extra Register Dual |
| GRP4 | 1100 | SET | imm4 | Set flag bits in PSW[3:0] |
| GRP4 | 1101 | CLR | imm4 | Clear flag bits in PSW[3:0] |
| GRP4 | 1110 | SET2 | imm4 | Set bits in PSW[7:4] |
| GRP4 | 1111 | CLR2 | imm4 | Clear bits in PSW[7:4] |

**Aliases:**
- `SETI` = `SET2 1` (Set Interrupt Enable: PSW[4]=1)
- `CLRI` = `CLR2 1` (Clear Interrupt Enable: PSW[4]=0)

### 4.3 SET/CLR Flag Bit Encoding

**Table 4.3: SET/CLR Flag Encoding (PSW[3:0])**

| imm4 | Operation | Flag | imm4 | Operation | Flag |
|------|-----------|------|------|-----------|------|
| 0000 | SET | N | 1000 | CLR | N |
| 0001 | SET | Z | 1001 | CLR | Z |
| 0010 | SET | V | 1010 | CLR | V |
| 0011 | SET | C | 1011 | CLR | C |

**Table 4.4: SET2/CLR2 Bit Encoding (PSW[7:4])**

| imm4 | Bit | Purpose |
|------|-----|---------|
| 0000 | 4 | Interrupt Enable (I) |
| 0001 | 5 | Shadow View (S) |
| 0010 | 6 | Reserved |
| 0011 | 7 | Reserved |

---

## 5. Detailed Instruction Formats

### 5.1 LDI - Load Long Immediate
```
Bits: [0][ imm15 ]
      1     15
```
- **Effect**: `R0 ← immediate`
- **Range**: 0 to 32,767

### 5.2 LD/ST - Load/Store with Implicit Segment
```
Bits: [10][ d ][ Rd ][ Rb ][ offset5 ]
      2    1    4     4      5
```
- **d=0**: Load `Rd ← Mem[implicit_segment:Rb + offset]`
- **d=1**: Store `Mem[implicit_segment:Rb + offset] ← Rd`
- **offset5**: 5-bit unsigned immediate (0-31 words)

### 5.3 ALU2 - Dual Operand ALU Operations
```
Bits: [110][ op3 ][ Rd ][ w ][ i ][ Rs/imm4 ]
      3     3      4     1    1      4
```
- **w=0**: Update flags only (ANW, CMP, TBS, TBC operations)
- **w=1**: Write result to Rd
- **i=0**: Register mode `Rd ← Rd op Rs`
- **i=1**: Immediate mode `Rd ← Rd op imm4`

### 5.4 JMP - Jump/Branch Operations
```
Bits: [1110][ type3 ][ target9 ]
      4      3         9
```
- **target9**: 9-bit signed immediate (-256 to +255 words)

### 5.5 LSI - Load Short Immediate
```
Bits: [1111110][ Rd ][ imm5 ]
      7         4     5
```
- **Effect**: `Rd ← sign_extend(imm5)`
- **Range**: -16 to +15

### 5.6 LDS/STS - Load/Store with Explicit Segment
```
Bits: [11110][ d ][ seg2 ][ Rd ][ Rs ]
      5       1     2       4     4
```
- **d=0**: Load `Rd ← Mem[seg:Rs]`
- **d=1**: Store `Mem[seg:Rs] ← Rd`
- **seg2**: 00=CS, 01=DS, 10=SS, 11=ES

### 5.7 MOV - Move with Offset
```
Bits: [111110][ Rd ][ Rs ][ imm2 ]
      6        4     4      2
```
- **Effect**: `Rd ← Rs + zero_extend(imm2)`
- **Range**: 0-3

### 5.8 SOP - Single Operand Operations
```
Bits: [11111110][ type4 ][ Rx/imm4 ]
      8          4        4
```
- **GRP1 (000x)**: ALU1 operations (SWB, INV, NEG)
- **GRP2 (0100)**: Special jump (JML)
- **GRP3 (10xx)**: PSW segment assignment (SRS, SRD, ERS, ERD)
- **GRP4 (11xx)**: PSW flag manipulation (SET, CLR, SET2, CLR2)

### 5.9 MVS - Move to/from Segment
```
Bits: [111111110][ d ][ Rd ][ seg2 ]
      9           1    4      2
```
- **d=0**: `Rd ← Sx` where Sx is segment register CS/DS/SS/ES
- **d=1**: `Sx ← Rd` where Sx is segment register CS/DS/SS/ES

### 5.10 SMV - Special Move
```
Bits: [1111111110][ src2 ][ Rd ]
      10           2       4
```
- Access alternate register views (APC, APSW, ACS, PSW)

### 5.11 SYS - System Operations
```
Bits: [1111111111110][ op3 ]
      13               3
```
- **op3**: 000=NOP, 001=HLT, 010=SWI, 011=RETI, 100-111=reserved

---

## 6. ALU Operations

### 6.1 ALU2 Operation Codes (op3)

**Table 6.1: ALU2 Operations**

| op3 | Mnemonic | Description | w=1 (Write) | w=0 (Flags Only) |
|-----|----------|-------------|-------------|------------------|
| 000 | ADD | Addition | `Rd ← Rd + Rs/imm` | ANW (Add No Write) |
| 001 | SUB | Subtraction | `Rd ← Rd - Rs/imm` | CMP (Compare) |
| 010 | AND | Logical AND | `Rd ← Rd & Rs/imm` | TBS (Test Bit Set) |
| 011 | OR | Logical OR | `Rd ← Rd | Rs/imm` | - |
| 100 | XOR | Logical XOR | `Rd ← Rd ^ Rs/imm` | TBC (Test Bit Clear) |
| 101 | MUL | Multiplication | `Rd ← Rd × Rs` | - |
| 110 | DIV | Division | `Rd ← Rd ÷ Rs` | - |
| 111 | Shift | Shift operations | Various shifts | - |

### 6.2 MUL/DIV Behavior

**MUL Operations:**
- **MUL Rd, Rs** (i=0): 16×16→16-bit multiplication
- **MUL Rd, Rs** (i=1): 16×16→32-bit multiplication, **Rd must be even**

**DIV Operations:**
- **DIV Rd, Rs** (i=0): 16÷16→16-bit division (quotient)
- **DIV Rd, Rs** (i=1): 16÷16→32-bit division, **Rd must be even**

### 6.3 Shift Operations (ALU op=111)

**Shift Type Encoding:**
```
[ T2 ][ C ][ count3 ]
 2     1     3
```

**Table 6.2: Shift Operations**

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

### 6.4 JMP Conditions (type3)

**Table 6.3: Jump Conditions**

| type3 | Mnemonic | Condition |
|-------|----------|-----------|
| 000 | JZ | Z=1 |
| 001 | JNZ | Z=0 |
| 010 | JC | C=1 |
| 011 | JNC | C=0 |
| 100 | JN | N=1 |
| 101 | JNN | N=0 |
| 110 | JO | V=1 |
| 111 | JNO | V=0 |

### 6.5 System Operations (op3)

**Table 6.4: System Operations**

| op3 | Mnemonic | Description |
|-----|----------|-------------|
| 000 | NOP | No operation |
| 001 | HLT | Halt processor |
| 010 | SWI | Software interrupt |
| 011 | RETI | Return from interrupt |

---

*Deep16 (深十六) Architecture Specification v3.5 (1r11a) - Final Version with CLR2/SET2*

## ✅ Final Changes Applied:

1. **✅ CLR2/SET2**: New operations for PSW[7:4] control
2. **✅ Aliases**: SETI = SET2 1, CLRI = CLR2 1
3. **✅ Separate Tables**: Clear encoding for both PSW nibbles
4. **✅ Flexible Design**: Can control multiple upper PSW bits at once

The architecture now has a much more flexible and powerful PSW control mechanism!
