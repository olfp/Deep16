# Deep16 (深十六) Architecture Specification
## 16-bit RISC Processor with Enhanced Memory Addressing

---

## 1. Processor Overview

### 1.1 Architectural Philosophy
Deep16 is a 16-bit RISC processor designed with a balanced approach to simplicity, performance, and educational value. The architecture embraces classic RISC principles while introducing innovative features for practical embedded systems use.

### 1.2 Key Architectural Features
- **16-bit fixed-length instructions** - Simplified decoding and alignment
- **16 general-purpose registers** - Reduced memory traffic
- **Segmented memory addressing** - 20-bit physical address space (1MB)
- **Extended shadow register system** - Zero-overhead interrupt context switching with selective general-purpose register shadows
- **5-stage pipelined implementation** - With delayed branch optimization
- **Optional unified L1 cache** - Configurable 0-4KB direct-mapped cache
- **Memory-mapped I/O** - Simplified peripheral access
- **Word-based memory system** - No byte alignment complications
- **No memory protection** - Fully accessible memory space
- **Clean interrupt model** - Hardware-managed context switching via PSW'.S

### 1.3 Performance Targets
- **Base CPI**: 1.0-1.3 (ideal to realistic)
- **Operating frequency**: 80MHz in modern FPGAs
- **Branch penalty**: 0 cycles (delayed branch architecture)
- **Interrupt latency**: 2 cycles (entry + jump)
- **Cache hit rate**: 85-95% with 4KB unified cache (if implemented)
- **Memory bandwidth**: 160 MB/s at 80MHz

---

## 2. Instruction Set Architecture (UPDATED)

### 2.1 Complete Opcode Hierarchy (Revised)

**Table 1: Instruction Opcode Hierarchy**

| Opcode | Bits | Instruction | Format | Pipeline Effect |
|--------|------|-------------|--------|----------------|
| 0 | 1 | LDI | `[0][imm15]` | Full pipeline |
| 10 | 2 | LD/ST | `[10][d1][Rd4][Rb4][offset5]` | Potential load-use stall |
| 110 | 3 | ALU2 | `[110][func5][Rd4][Rs/imm4]` | Full pipeline, forwarding |
| 1110 | 4 | JMP | `[1110][type3][target9]` | **Uses delay slot** |
| 11110 | 5 | LDS/STS | `[11110][d1][seg2][Rd4][Rs4]` | Segment access in MEM |
| 111110 | 6 | MOV | `[111110][Rd4][Rs4][imm2]` | imm2=3 disables forwarding |
| 1111110 | 7 | LSI | `[1111110][Rd4][imm5]` | Full pipeline |
| 11111110 | 8 | SMV | `[11111110][Rx4][alt_sel4]` | Shadow register access |
| 111111110 | 9 | MVS | `[111111110][d1][Rd4][seg2]` | Segment access in MEM |
| 1111111110 | 10 | SOP | `[1111111110][type2][Rx4]` | Single operand and JML |
| 111111111110 | 12 | LPSW | `[111111111110][Rx4]` | Load PSW of current context |
| 1111111111110 | 13 | SYS | `[1111111111110][op3]` | Pipeline flush on RETI |
| 1111111111111111 | 16 | HLT | `[1111111111111111]` | Halt the processor |

### 2.2 Data Movement Instructions

**Table 2: Data Movement Instructions**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **LDI** | `LDI imm` | `0 imm15` | `R0 ← sign_extend(imm15)` |
| **LSI** | `LSI Rd, imm` | `1111110 Rd4 imm5` | `Rd ← sign_extend(imm5)` |
| **MOV** | `MOV Rd, Rs, imm` | `111110 Rd4 Rs4 imm2` | `Rd ← Rs + zero_extend(imm2)` |
| **MVS Rd, Sx** | `MVS Rd, Sx` | `111111110 0 Rd4 seg2` | `Rd ← Sx` |
| **MVS Sx, Rd** | `MVS Sx, Rd` | `111111110 1 Rd4 seg2` | `Sx ← Rd` |
| **SMV Rx, alt_reg** | `SMV Rx, alt_reg` | `11111110 Rx4 alt_sel4` | `Rx ← alt_reg` (read shadow) |

**Extended SMV alt_sel encodings:**
```
0000: ACS  (Alternate CS)       1000: AR0  (Alternate R0)
0001: ADS  (Alternate DS)       1001: AR1  (Alternate R1)
0010: ASS  (Alternate SS)       1010: AR2  (Alternate R2)
0011: AES  (Alternate ES)       1101: AR13 (Alternate R13/SP)
0100: APSW (Alternate PSW)      1110: AR14 (Alternate R14/LR)
                               1111: APC  (Alternate PC)
```

**LDI Sign Extension Behavior:**
- **Critical**: LDI performs **sign extension** of the 15-bit immediate
- **LDI -1** loads `0xFFFF` into R0 (not `0x7FFF`)
- **LDI 32767** loads `0x7FFF` into R0  
- **LDI -32768** loads `0x8000` into R0
- This enables loading both positive and negative constants efficiently

**MOV Special Semantics:**
- `imm2 = 0,1,2`: `Rd ← Rs + imm2` (normal operation with forwarding)
- `imm2 = 3`: `Rd ← Rs + 0` (architectural read, bypasses forwarding)

### 2.3 ALU Instructions - Group 1: Basic Operations

**Table 3: Basic ALU Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Flags |
|-------------|---------|-----------------|-------------------|-------|
| **ADD Rd, Rs** | `ADD Rd, Rs` | `110 00000 Rd4 Rs4` | `Rd ← Rd + Rs` | NZVC |
| **ADD Rd, imm** | `ADD Rd, imm` | `110 00001 Rd4 imm4` | `Rd ← Rd + imm` | NZVC |
| **SUB Rd, Rs** | `SUB Rd, Rs` | `110 00010 Rd4 Rs4` | `Rd ← Rd - Rs` | NZVC |
| **SUB Rd, imm** | `SUB Rd, imm` | `110 00011 Rd4 imm4` | `Rd ← Rd - imm` | NZVC |
| **CMP Rd, Rs** | `CMP Rd, Rs` | `110 00100 Rd4 Rs4` | `Rd - Rs` (flags only) | NZVC |
| **CMP Rd, imm** | `CMP Rd, imm` | `110 00101 Rd4 imm4` | `Rd - imm` (flags only) | NZVC |
| **AND Rd, Rs** | `AND Rd, Rs` | `110 00110 Rd4 Rs4` | `Rd ← Rd AND Rs` | NZ00 |
| **AND Rd, imm** | `AND Rd, imm` | `110 00111 Rd4 imm4` | `Rd ← Rd AND (1 << imm)` | NZ00 |
| **TBC Rd, Rs** | `TBC Rd, Rs` | `110 01000 Rd4 Rs4` | `Rd AND Rs` (flags only) | NZ00 |
| **TBC Rd, imm** | `TBC Rd, imm` | `110 01001 Rd4 imm4` | `Rd AND (1 << imm)` (flags only) | NZ00 |
| **OR Rd, Rs** | `OR Rd, Rs` | `110 01010 Rd4 Rs4` | `Rd ← Rd OR Rs` | NZ00 |
| **OR Rd, imm** | `OR Rd, imm` | `110 01011 Rd4 imm4` | `Rd ← Rd OR (1 << imm)` | NZ00 |
| **XOR Rd, Rs** | `XOR Rd, Rs` | `110 01100 Rd4 Rs4` | `Rd ← Rd XOR Rs` | NZ00 |
| **XOR Rd, imm** | `XOR Rd, imm` | `110 01101 Rd4 imm4` | `Rd ← Rd XOR (1 << imm)` | NZ00 |
| **TBS Rd, Rs** | `TBS Rd, Rs` | `110 01110 Rd4 Rs4` | `Rd XOR Rs` (flags only) | NZ00 |
| **TBS Rd, imm** | `TBS Rd, imm` | `110 01111 Rd4 imm4` | `Rd XOR (1 << imm)` (flags only) | NZ00 |

**Logical Immediate Operand Semantics:**
- **Critical**: For AND, OR, XOR, TBS, TBC with immediate operands:
  - The 4-bit immediate specifies a **bit position** (0-15)
  - The operation is performed with `(1 << imm)` as the second operand
  - **NOT** a general 4-bit immediate value

**Examples:**
```assembly
AND  R1, 3        ; R1 = R1 AND (1 << 3)  → Clear all bits except bit 3
OR   R1, 7        ; R1 = R1 OR (1 << 7)   → Set bit 7
XOR  R1, 0        ; R1 = R1 XOR (1 << 0)  → Toggle bit 0
TBC  R1, 5        ; Test if bit 5 is clear in R1
TBS  R1, 12       ; Test if bit 12 is set in R1
```

**Arithmetic vs Logical Immediate Differences:**
- **ADD/SUB/CMP**: `imm4` is treated as unsigned value 0-15
- **AND/OR/XOR/TBS/TBC**: `imm4` specifies bit position for `(1 << imm)`

### 2.4 ALU Instructions - Group 2: Shift/Rotate Operations

**Table 4: Shift and Rotate Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Carry Behavior |
|-------------|---------|-----------------|-------------------|----------------|
| **SL Rd, count** | `SL Rd, count` | `110 10000 Rd4 count4` | `Rd ← Rd << count` | C = bit[15] shifted out |
| **SLA Rd, count** | `SLA Rd, count` | `110 10001 Rd4 count4` | `Rd ← Rd << count` (arithmetic) | C = bit[15] shifted out |
| **SLAC Rd, count** | `SLAC Rd, count` | `110 10010 Rd4 count4` | `Rd ← (Rd << count) OR (C << (count-1))` | C = bit[15] shifted out |
| **SLC Rd, count** | `SLC Rd, count` | `110 10011 Rd4 count4` | `Rd ← (Rd << count) OR (C << (count-1))` | C = bit[15] shifted out |
| **SR Rd, count** | `SR Rd, count` | `110 10100 Rd4 count4` | `Rd ← Rd >> count` | C = bit[0] shifted out |
| **SRC Rd, count** | `SRC Rd, count` | `110 10101 Rd4 count4` | `Rd ← (Rd >> count) OR (C << (15-count))` | C = bit[0] shifted out |
| **SRA Rd, count** | `SRA Rd, count` | `110 10110 Rd4 count4` | `Rd ← Rd >> count` (arithmetic) | C = bit[0] shifted out |
| **SRAC Rd, count** | `SRAC Rd, count` | `110 10111 Rd4 count4` | `Rd ← (Rd >> count) OR (C << (15-count))` (arithmetic) | C = bit[0] shifted out |
| **ROL Rd, count** | `ROL Rd, count` | `110 11000 Rd4 count4` | `Rd ← (Rd << count) OR (Rd >> (16-count))` | C = bit shifted out |
| **RLC Rd, count** | `RLC Rd, count` | `110 11001 Rd4 count4` | `Rd ← (Rd << count) OR (C << (count-1)) OR (Rd >> (16-count))` | C = bit shifted out |
| **ROR Rd, count** | `ROR Rd, count` | `110 11010 Rd4 count4` | `Rd ← (Rd >> count) OR (Rd << (16-count))` | C = bit shifted out |
| **RRC Rd, count** | `RRC Rd, count` | `110 11011 Rd4 count4` | `Rd ← (Rd >> count) OR (C << (15-count)) OR (Rd << (16-count))` | C = bit shifted out |

**Special Case - Byte Swap:**
- **ROL Rx, 8**: Performs byte swap operation `(Rx << 8) | (Rx >> 8)`
- **SWB Rx**: Assembler alias for `ROL Rx, 8`
- **Example**: `0x1234` becomes `0x3412`

### 2.5 ALU Instructions - Group 3: Multiply/Divide Operations

**Table 5: Multiply/Divide Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Notes |
|-------------|---------|-----------------|-------------------|-------|
| **MUL Rd, Rs** | `MUL Rd, Rs` | `110 11100 Rd4 Rs4` | `Rd ← Rd × Rs` (low 16 bits) | 16×16→16-bit |
| **MUL32 Rd, Rs** | `MUL32 Rd, Rs` | `110 11101 Rd4 Rs4` | `R[d]:R[d+1] ← Rd × Rs` | Rd must be EVEN |
| **DIV Rd, Rs** | `DIV Rd, Rs` | `110 11110 Rd4 Rs4` | `Rd ← Rd ÷ Rs` (quotient) | 16÷16→16-bit |
| **DIV32 Rd, Rs** | `DIV32 Rd, Rs` | `110 11111 Rd4 Rs4` | `R[d] ← quotient, R[d+1] ← remainder` | Rd must be EVEN |

### 2.6 Single Operand Instructions (REVISED)

**Table 6: Single Operand and JML Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Notes |
|-------------|---------|-----------------|-------------------|-------|
| **INV Rx** | `INV Rx` | `1111111110 00 Rx4` | `Rx ← ~Rx` | Bitwise complement |
| **NEG Rx** | `NEG Rx` | `1111111110 01 Rx4` | `Rx ← -Rx` | Two's complement negation |
| **JML Rx** | `JML Rx` | `1111111110 11 Rx4` | `CS ← R[Rx], PC ← R[Rx+1]` | Far jump, Rx must be EVEN |

**JML Requirements:**
- **Rx must be EVEN** (0, 2, 4, 6, 8, 10, 12, 14)
- **Uses register pair**: Rx contains segment, Rx+1 contains offset
- **Pipeline flush** required on execution
- **Assembler alias**: Far jump to different code segment

### 2.7 Memory Access Instructions

**Table 7: Memory Access Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Address Calculation |
|-------------|---------|-----------------|-------------------|---------------------|
| **LD Rd, Rb, offset** | `LD Rd, Rb, offset` | `10 0 Rd4 Rb4 offset5` | `Rd ← Mem[DS:(Rb + offset)]` | `EA = Rb + sign_extend(offset)` |
| **ST Rd, Rb, offset** | `ST Rd, Rb, offset` | `10 1 Rd4 Rb4 offset5` | `Mem[DS:(Rb + offset)] ← Rd` | `EA = Rb + sign_extend(offset)` |
| **LDS Rd, seg, Rb** | `LDS Rd, seg, Rb` | `11110 0 seg2 Rd4 Rb4` | `Rd ← Mem[seg:Rb]` | `EA = Rb` |
| **STS Rd, seg, Rb** | `STS Rd, seg, Rb` | `11110 1 seg2 Rd4 Rb4` | `Mem[seg:Rb] ← Rd` | `EA = Rb` |

**LD/ST Offset Semantics:**
- **Critical**: 5-bit offset is **sign-extended** (-16 to +15)
- **Enables negative offsets**: `LD R1, [SP-4]` works directly
- **Enhanced syntax**: `LD R1, [R2-8]` becomes `LD R1, R2, -8`
- **Range**: -16 to +15 from base register

**Examples:**
```assembly
LD  R1, SP, -4    ; Load from stack frame (SP-4)
ST  R2, FP, 2     ; Store to frame pointer + 2  
LD  R3, R4, -1    ; Load from previous word
```

### 2.8 Control Flow Instructions

**Table 8: Condition Codes for Jump Instructions**

| Condition | Code | Mnemonic | Test | Jump Condition |
|-----------|------|----------|------|----------------|
| Zero | 000 | JZ | Z = 1 | Result was zero |
| Not Zero | 001 | JNZ | Z = 0 | Result was non-zero |
| Carry | 010 | JC | C = 1 | Carry occurred |
| No Carry | 011 | JNC | C = 0 | No carry occurred |
| Negative | 100 | JN | N = 1 | Result was negative |
| Not Negative | 101 | JNN | N = 0 | Result was non-negative |
| Overflow | 110 | JO | V = 1 | Overflow occurred |
| No Overflow | 111 | JNO | V = 0 | No overflow occurred |

**Table 9: Control Flow Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Notes |
|-------------|---------|-----------------|-------------------|-------|
| **JZ target** | `JZ target` | `1110 000 target9` | `if (Z) PC ← PC + 1 + sign_extend(target)` | Uses delay slot |
| **JNZ target** | `JNZ target` | `1110 001 target9` | `if (!Z) PC ← PC + 1 + sign_extend(target)` | Uses delay slot |
| **JC target** | `JC target` | `1110 010 target9` | `if (C) PC ← PC + 1 + sign_extend(target)` | Uses delay slot |
| **JNC target** | `JNC target` | `1110 011 target9` | `if (!C) PC ← PC + 1 + sign_extend(target)` | Uses delay slot |
| **JN target** | `JN target` | `1110 100 target9` | `if (N) PC ← PC + 1 + sign_extend(target)` | Uses delay slot |
| **JNN target** | `JNN target` | `1110 101 target9` | `if (!N) PC ← PC + 1 + sign_extend(target)` | Uses delay slot |
| **JO target** | `JO target` | `1110 110 target9` | `if (V) PC ← PC + 1 + sign_extend(target)` | Uses delay slot |
| **JNO target** | `JNO target` | `1110 111 target9` | `if (!V) PC ← PC + 1 + sign_extend(target)` | Uses delay slot |
| **JMP Rx** | `JMP Rx` | `MOV PC, Rx` | `PC ← Rx` | Assembler alias |

### 2.9 PSW Operations

**Table 10: PSW Segment Assignment Operations**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **SRS Rx** | `SRS Rx` | Use SET/CLR with appropriate bits | `PSW.SR ← Rx, PSW.DS ← 0` |
| **SRD Rx** | `SRD Rx` | Use SET/CLR with appropriate bits | `PSW.SR ← Rx, PSW.DS ← 1` |
| **ERS Rx** | `ERS Rx` | Use SET/CLR with appropriate bits | `PSW.ER ← Rx, PSW.DE ← 0` |
| **ERD Rx** | `ERD Rx` | Use SET/CLR with appropriate bits | `PSW.ER ← Rx, PSW.DE ← 1` |

**Table 11: PSW Flag Operations**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **LPSW Rx** | `LPSW Rx` | `111111111110 Rx4` | `Rx ← PSW` |
| **SET imm** | `SET imm` | Use appropriate bit setting | `PSW[imm] ← 1` |
| **CLR imm** | `CLR imm` | Use appropriate bit clearing | `PSW[imm] ← 0` |
| **SET2 imm** | `SET2 imm` | Use appropriate bit setting | `PSW[imm+4] ← 1` |
| **CLR2 imm** | `CLR2 imm` | Use appropriate bit clearing | `PSW[imm+4] ← 0` |

### 2.10 System Operations

**Table 12: System Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Pipeline Effect |
|-------------|---------|-----------------|-------------------|-----------------|
| **NOP** | `NOP` | `1111111111110 000` | No operation | Normal flow |
| **FSH** | `FSH` | `1111111111110 001` | Flush pipeline | Clear pipeline |
| **SWI** | `SWI` | `1111111111110 010` | Software interrupt | Flush, enter interrupt |
| **RETI** | `RETI` | `1111111111110 011` | Return from interrupt | Flush, restore context |

### 2.11 Halt Instruction

**Table 13: Halt Instruction**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **HLT** | `HLT` | `1111111111111111` | Halt processor |

---

## 3. Microarchitecture

### 3.1 Pipeline Structure

#### 3.1.1 5-Stage Pipeline
```
Stage    Purpose                    Key Operations
-----    -----------------------   ------------------------------------
IF       Instruction Fetch         - Read instruction from cache/memory
                                    - Increment PC
                                    - Handle branch prediction

ID       Instruction Decode        - Decode instruction
                                    - Read register file  
                                    - Resolve hazards
                                    - Calculate branch targets

EX       Execute                   - ALU operations
                                    - Address calculation
                                    - Branch condition evaluation
                                    - Shift/rotate operations

MEM      Memory Access             - Data cache access
                                    - Segment register access  
                                    - I/O operations
                                    - Cache miss handling

WB       Write Back                - Write results to register file
                                    - Update pipeline state
```

#### 3.1.2 Pipeline Register Structure
Each pipeline stage is separated by registers containing:
- **Instruction word** and associated metadata
- **Register values** and intermediate results
- **Control signals** for subsequent stages
- **Exception and interrupt** state information

### 3.2 Hazard Handling

#### 3.2.1 Data Hazards
**Types of Data Hazards:**
1. **RAW (Read After Write)** - Most common, handled by forwarding
2. **WAR (Write After Read)** - Eliminated by in-order execution
3. **WAW (Write After Write)** - Eliminated by in-order execution

**Forwarding Paths:**
- **EX/MEM → EX**: ALU results available immediately
- **MEM/WB → EX**: Memory load results with 1-cycle latency
- **Architectural Move**: Bypasses forwarding for stable state access

#### 3.2.2 Control Hazards
**Delayed Branch Solution:**
- **One delay slot** following every branch/jump
- **Compiler responsibility** to schedule useful instructions
- **Zero cycle penalty** for correctly scheduled branches

**Branch Resolution:**
- **Conditional branches**: Resolved in EX stage
- **Register jumps**: Resolved in ID stage  
- **Far jumps (JML)**: Require pipeline flush

### 3.3 Memory Hierarchy

#### 3.3.1 Basic Memory Access
**No-Cache Operation:**
- **Instruction fetch**: 1-3 cycles (depending on memory technology)
- **Data access**: 1-3 cycles  
- **Simple interface**: Direct connection to memory controller

**With Optional Cache:**
- **Cache hit**: 1 cycle
- **Cache miss**: 3-5 cycle penalty
- **Write buffer**: Hides write latency

#### 3.3.2 Memory Interface
**20-bit physical address** (1MB address space)
**16-bit data bus** (word-based access only)
**Simple control signals**: Read, Write, Ready

---

## 4. Memory System Architecture

### 4.1 Segmented Addressing

#### 4.1.1 Address Generation
**Physical Address Calculation:**
```
Physical Address = (Segment Base << 4) + Effective Address
```

**Segment Register Usage:**
- **CS**: Always used for instruction fetch
- **DS**: Default for data access (LD/ST instructions)
- **SS**: Used when PSW.SR points to stack operations
- **ES**: Used for explicit access or PSW.ER configuration

#### 4.1.2 Implicit Segment Selection
The PSW controls which segment register is used for data accesses:

**Stack Segment Selection (PSW.SR):**
```
PSW.SR = 13, PSW.DS = 0  → SP accesses SS
PSW.SR = 12, PSW.DS = 1  → FP/SP pair accesses SS
```

**Extra Segment Selection (PSW.ER):**
```
PSW.ER = 11, PSW.DE = 0  → R11 accesses ES  
PSW.ER = 10, PSW.DE = 1  → R10/R11 pair accesses ES
```

### 4.2 No Memory Protection

**Simplified Memory Model:**
- **All memory is readable, writable, and executable**
- **No segment protection** - any segment can contain code or data
- **No privilege levels** - single execution mode
- **Self-modifying code permitted**
- **CS register is read/write** - can be modified like any segment register

**Benefits:**
- **Simpler hardware** - no protection checks
- **Flexible programming** - dynamic code generation allowed
- **Educational clarity** - no complex protection concepts
- **Embedded suitability** - typical for small microcontrollers

### 4.3 Cache Architecture (Optional)

**Basic Cache Features (if implemented):**
- **Unified L1 cache** - instructions and data
- **Direct-mapped** - simple implementation
- **Write-through** - simple coherence
- **Configurable size** - 0-4KB typical

**Cache Operation:**
- **Transparent to software** - no management instructions required
- **Optional implementation** - can be omitted for simplicity
- **Performance enhancement** - reduces memory bandwidth requirements

---

## 5. Interrupt System Architecture (UPDATED)

### 5.1 Extended Shadow Register System

#### 5.1.1 Core Principle
**PSW'.S bit** controls active register context:
- **PSW'.S = 0**: Normal registers (CS, DS, SS, ES, PC, PSW, R0-R15)
- **PSW'.S = 1**: Shadow registers (CS', DS', SS', ES', PC', PSW', R0', R1', R2', R13', R14')

#### 5.1.2 Shadow Register Set (11 total)
- **Segment Shadows**: CS', DS', SS', ES'
- **Control Shadows**: PC', PSW'
- **GP Register Shadows**: R0', R1', R2', R13' (SP'), R14' (LR')

#### 5.1.3 Reset Initialization
```
PSW'  ← 0x0000    ; S=0, use normal context
PSW   ← 0x0000    ; S=0, interrupts disabled
CS    ← 0xFFFF    ; Boot from top of memory
DS/SS/ES ← 0x0000 ; Other segments zero
PC    ← 0x0000    ; Start execution at CS:0000
```

### 5.2 Interrupt Entry Sequence

**On any interrupt (NMI, HW, SWI):**
```
PSW'  ← 0x0020    ; S=1, I=0 - switch to shadow context
CS'   ← 0         ; Interrupts run in segment 0
DS'   ← 0
SS'   ← 0  
ES'   ← 0
R0'   ← 0         ; Initialize shadow registers
R1'   ← 0
R2'   ← 0
R13'  ← 0
R14'  ← 0
PC'   ← Mem[interrupt_vector]  ; Jump to handler
; Hardware automatically uses shadow registers (PSW'.S=1)
```

**Critical Notes:**
1. **PSW' is NOT copied from PSW** - set to `0x0020` (S=1, I=0)
2. **All shadow registers initialized to 0** - clean interrupt context
3. **Normal registers remain unchanged** - accessible via SMV
4. **Hardware context switch** via PSW'.S=1

### 5.3 Interrupt Handler Execution

- All instructions automatically use **shadow registers** (PSW'.S=1)
- Segments fixed at 0 unless modified by handler
- Interrupts disabled (PSW'.I=0) during handler
- Access normal context via SMV: `SMV Rx, APSW` reads normal PSW

### 5.4 Interrupt Exit Sequence

**On RETI instruction:**
```
PSW'  ← 0x0000    ; S=0 - switch back to normal context
; Hardware automatically uses normal registers (PSW'.S=0)
; Execution resumes with original segments and PSW intact
```

**Important:**
- **No register restoration** - normal registers were never modified
- **Shadow registers retain values** for next interrupt/debugging
- **Only PSW' modified** - set to 0x0000 to trigger context switch
- **Pipeline flush** - clean transition

### 5.5 SMV Instruction (UPDATED)

**Format:** `11111110 Rx4 alt_sel4`
**Operation:** `Rx ← alt_reg` (read shadow register to Rx)

**Symmetric Access:**
- **Normal Mode (PSW.S=0, PSW'.S=0):**
  ```assembly
  SMV R1, APC      ; R1 = PC' (shadow PC)
  SMV R2, APSW     ; R2 = PSW' (shadow PSW, typically 0x0020 if in interrupt)
  ```

- **Interrupt Mode (PSW.S=0, PSW'.S=1):**
  ```assembly
  SMV R1, APC      ; R1 = PC (normal PC)
  SMV R2, APSW     ; R2 = PSW (normal PSW)
  ```

### 5.6 Interrupt Vector Table

**Located at Segment 0 (Low Memory):**
```
0x0000: NMI_VECTOR      (Non-Maskable Interrupt)
0x0001: HW_INT_VECTOR   (Hardware Interrupts)  
0x0002: SWI_VECTOR      (Software Interrupts)
```

### 5.7 NMI (Non-Maskable Interrupt)

**Special Characteristics:**
- **Ignores PSW.I flag** - cannot be disabled
- **Vector at 0x0000** - separate from maskable interrupts
- **Not nestable** - discarded if already in interrupt
- **Same shadow mechanism** - identical context switching

### 5.8 Hardware Implementation

```verilog
// Single bit (PSW'.S) controls all context switching
assign active_cs   = psw_shadow_s ? cs_shadow   : cs_normal;
assign active_ds   = psw_shadow_s ? ds_shadow   : ds_normal;
assign active_ss   = psw_shadow_s ? ss_shadow   : ss_normal;  
assign active_es   = psw_shadow_s ? es_shadow   : es_normal;
assign active_pc   = psw_shadow_s ? pc_shadow   : pc_normal;
assign active_psw  = psw_shadow_s ? psw_shadow  : psw_normal;

// General-purpose shadow register muxing
assign active_reg0  = psw_shadow_s ? reg0_shadow  : reg0_normal;
assign active_reg1  = psw_shadow_s ? reg1_shadow  : reg1_normal;
assign active_reg2  = psw_shadow_s ? reg2_shadow  : reg2_normal;
assign active_reg13 = psw_shadow_s ? reg13_shadow : reg13_normal;
assign active_reg14 = psw_shadow_s ? reg14_shadow : reg14_normal;

// Other registers always use normal context
assign active_reg3  = reg3_normal;
// ... R4-R12 ...
assign active_reg15 = reg15_normal;  // PC handled separately above
```

### 5.9 Key Benefits

1. **Zero Software Overhead** - no manual register saving
2. **Fast Interrupt Entry** - only PSW' update and initialization
3. **Clean Context Separation** - interrupts run in clean shadow context
4. **Debugging Support** - SMV provides symmetric access to both contexts
5. **Simple Hardware** - single control bit for all muxing
6. **Minimal State** - only 11 shadow registers vs full duplication

### 5.10 Example Usage

**Fast Interrupt Handler:**
```assembly
timer_isr:
    ; Running in shadow context (PSW'.S=1)
    ; All shadow registers initialized to 0
    
    LDI  TIMER_ADDR     ; Uses R0' (shadow)
    MVS  ES, R0         ; ES' = timer segment
    LDS  R1, ES, [R0]   ; R1' = timer value
    ; ... process ...
    RETI                ; Return to normal context
```

**Debugging from Normal Mode:**
```assembly
check_interrupt:
    SMV  R1, APC      ; R1 = PC' (where interrupt occurred)
    SMV  R2, APSW     ; R2 = PSW' (0x0020 if in interrupt)
    SMV  R3, AR0      ; R3 = R0' (shadow R0)
    ; ... debug display ...
```

---

## 6. I/O System Architecture

### 6.1 Memory-Mapped I/O

#### 6.1.1 I/O Address Space
**I/O Segment (0xF0000-0xFFFFF):**
```
0xF0000-0xF000F: System LED Controller
0xF0010-0xF001F: Interrupt Controller (SIC)
0xF0020-0xF002F: Timer/Counter
0xF0030-0xF003F: Video Display Controller  
0xF0040-0xF004F: Serial Port (UART)
0xF0060-0xF006F: Keyboard Controller
0xF1000-0xF17CF: Screen Buffer (80×25 characters)
```

#### 6.1.2 I/O Access Characteristics
- **Word-based access** only (no byte I/O)
- **No cacheing** of I/O addresses (uncacheable region)
- **Wait states** possible for slow peripherals
- **Interrupt-driven** operation recommended

### 6.2 Peripheral Integration

#### 6.2.1 Standard Peripheral Set
**Essential Peripherals:**
- **Timer/Counter**: System timing and event counting
- **UART**: Serial communication
- **Keyboard Controller**: PS/2 keyboard input
- **Video Controller**: Text and basic graphics
- **Interrupt Controller**: Centralized interrupt management

#### 6.2.2 Custom Peripheral Support
**Extension Mechanism:**
- **Reserved address ranges** for custom peripherals
- **Standard interrupt assignment** for new devices
- **Plug-and-play** address decoding

---

## 7. Instruction Aliases

**Table 14: Instruction Aliases**

| Alias | Actual Instruction | Purpose |
|-------|-------------------|---------|
| **SWB Rx** | `ROL Rx, 8` | Swap bytes in register |
| **HALT** | `HLT` | Halt processor |
| **JMP Rx** | `MOV PC, Rx` | Unconditional jump to register |
| **LNK Rx** | `MOV Rx, PC, 2` | Link to subroutine |
| **ALNK Rx** | `MOV Rx, PC, 3` | Architectural link in delay slot |
| **ALINK** | `MOV LR, PC, 3` | Architectural link to LR |
| **AMV Rx, Ry** | `MOV Rx, Ry, 3` | Architectural move |
| **SETI** | `SET2 0` | Enable interrupts |
| **CLRI** | `CLR2 0` | Disable interrupts |
| **SETC** | `SET 3` | Set carry flag |
| **CLRC** | `CLR 3` | Clear carry flag |

---

## 8. Updated Changes Summary

### 8.1 Critical Updates (v4.0)

**Shadow Register System:**
- **Extended shadow set**: CS', DS', SS', ES', PC', PSW', R0', R1', R2', R13', R14'
- **Clean initialization**: All shadows set to 0 on interrupt entry
- **PSW' handling**: Set to 0x0020 (S=1, I=0), NOT copied from PSW

**SMV Instruction:**
- **New encoding**: `11111110 Rx4 alt_sel4`
- **Read-only**: Only reads shadow registers to Rx
- **Symmetric access**: Reads normal regs in interrupt mode, shadow regs in normal mode

**Instruction Encoding:**
- **SOP re-encoded**: `1111111110 type2 Rx4`
  - `type2=00`: INV Rx
  - `type2=01`: NEG Rx  
  - `type2=11`: JML Rx (Far Jump)
- **JML moved to SOP group**: More efficient encoding
- **Compact opcodes**: Better utilization of instruction space

**JML Instruction (Corrected):**
- **New encoding**: `1111111110 11 Rx4`
- **Operation**: `CS = R[Rx], PC = R[Rx+1]` (Far jump)
- **Requirement**: Rx must be EVEN (uses register pair)
- **Effect**: Pipeline flush required

**Interrupt Behavior:**
- **Fast entry**: 2-cycle latency with clean context
- **No manual save/restore**: Hardware manages everything
- **Segment 0 execution**: Interrupts run in segment 0

### 8.2 Performance Characteristics
- **Interrupt latency**: 2 cycles
- **Context switch**: 0 cycles (hardware concurrent)
- **Register access**: Immediate in shadow context
- **Hardware cost**: ~2,650 LUTs estimated

### 8.3 Programming Impact

**Positive Changes:**
- ✅ **Zero-overhead interrupts** - no manual register saving
- ✅ **Clean interrupt context** - all shadows initialized to 0
- ✅ **Debugging support** via SMV symmetric access
- ✅ **Fast ISRs** - can use shadow registers immediately
- ✅ **Cleaner stack access** with negative offsets (-16 to +15)
- ✅ **Efficient constant loading** with LDI sign extension
- ✅ **Simplified JML encoding** - now part of SOP group

**Things to Watch:**
- 🔄 **LDI now sign-extends** - `LDI -1` loads `0xFFFF`
- 🔄 **Logical immediates use bit positions** - `AND R1, 3` means `R1 AND (1<<3)`
- 🔄 **SMV is read-only** - cannot write shadow registers directly
- 🔄 **Interrupts run in segment 0** - handlers must be in low memory
- 🔄 **JML requires EVEN register** - uses register pair (Rx:Rx+1)

### 8.4 Complete Instruction Encoding Summary

**Key Opcode Patterns:**
- **0xxxx xxxx xxxx xxxx**: LDI (load immediate)
- **10xx xxxx xxxx xxxx**: LD/ST (memory access)
- **110x xxxx xxxx xxxx**: ALU2 (arithmetic/logical)
- **1110 xxxx xxxx xxxx**: JMP (conditional jumps)
- **11110 xxxx xxxx xxxx**: LDS/STS (segment access)
- **111110 xxxx xxxx xxxx**: MOV (register move)
- **1111110 xxxx xxxx xxxx**: LSI (load small immediate)
- **11111110 xxxx xxxx xxxx**: SMV (shadow register access)
- **111111110 xxxx xxxx xxxx**: MVS (move segment)
- **1111111110 xxxx xxxx xxxx**: SOP (INV, NEG, JML)
- **111111111110 xxxx xxxx xxxx**: LPSW (load PSW)
- **1111111111110 xxxx xxxx xxxx**: SYS (system operations)
- **1111111111111111**: HLT (halt)

---

*Deep16 Architecture Specification v4.0 - Updated with Extended Shadow Registers and Corrected JML Encoding*

This architecture represents a **balanced, practical RISC design** suitable for both educational use and real embedded systems implementation. The extended shadow register system provides zero-overhead interrupt context switching while maintaining hardware simplicity and clean programming model.
