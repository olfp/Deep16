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
- **Complete shadow register system** - Zero-overhead interrupt context switching
- **5-stage pipelined implementation** - With delayed branch optimization
- **Unified L1 cache option** - Configurable 4KB direct-mapped cache
- **Memory-mapped I/O** - Simplified peripheral access
- **Word-based memory system** - No byte alignment complications

### 1.3 Performance Targets
- **Base CPI**: 1.0-1.3 (ideal to realistic)
- **Operating frequency**: 80MHz in modern FPGAs
- **Branch penalty**: 0 cycles (delayed branch architecture)
- **Cache hit rate**: 85-95% with 4KB unified cache
- **Memory bandwidth**: 160 MB/s at 80MHz

---

## 2. Instruction Set Architecture

### 2.1 Complete Opcode Hierarchy

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
| 11111110 | 8 | SOP | `[11111110][type4][Rx/imm4]` | Various pipeline effects |
| 111111110 | 9 | MVS | `[111111110][d1][Rd4][seg2]` | Segment access in MEM |
| 11111111110 | 11 | SMV | `[11111111110][d1][alt_sel4]` | Alternate context access |
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
| **SMV alt_reg** | `SMV alt_reg` | `11111111110 0 alt_sel4` | `alt_reg ← R0` |
| **SMV R0, alt_reg** | `SMV R0, alt_reg` | `11111111110 1 alt_sel4` | `R0 ← alt_reg` |
| **LPSW** | `LPSW Rx` | `111111111110 Rx4` | `Rx ← PSW` |

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
| **AND Rd, imm** | `AND Rd, imm` | `110 00111 Rd4 imm4` | `Rd ← Rd AND imm` | NZ00 |
| **TBC Rd, Rs** | `TBC Rd, Rs` | `110 01000 Rd4 Rs4` | `Rd AND Rs` (flags only) | NZ00 |
| **TBC Rd, imm** | `TBC Rd, imm` | `110 01001 Rd4 imm4` | `Rd AND imm` (flags only) | NZ00 |
| **OR Rd, Rs** | `OR Rd, Rs` | `110 01010 Rd4 Rs4` | `Rd ← Rd OR Rs` | NZ00 |
| **OR Rd, imm** | `OR Rd, imm` | `110 01011 Rd4 imm4` | `Rd ← Rd OR imm` | NZ00 |
| **XOR Rd, Rs** | `XOR Rd, Rs` | `110 01100 Rd4 Rs4` | `Rd ← Rd XOR Rs` | NZ00 |
| **XOR Rd, imm** | `XOR Rd, imm` | `110 01101 Rd4 imm4` | `Rd ← Rd XOR imm` | NZ00 |
| **TBS Rd, Rs** | `TBS Rd, Rs` | `110 01110 Rd4 Rs4` | `Rd XOR Rs` (flags only) | NZ00 |
| **TBS Rd, imm** | `TBS Rd, imm` | `110 01111 Rd4 imm4` | `Rd XOR imm` (flags only) | NZ00 |

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

### 2.5 ALU Instructions - Group 3: Multiply/Divide Operations

**Table 5: Multiply/Divide Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Notes |
|-------------|---------|-----------------|-------------------|-------|
| **MUL Rd, Rs** | `MUL Rd, Rs` | `110 11100 Rd4 Rs4` | `Rd ← Rd × Rs` (low 16 bits) | 16×16→16-bit |
| **MUL32 Rd, Rs** | `MUL32 Rd, Rs` | `110 11101 Rd4 Rs4` | `R[d]:R[d+1] ← Rd × Rs` | Rd must be EVEN |
| **DIV Rd, Rs** | `DIV Rd, Rs` | `110 11110 Rd4 Rs4` | `Rd ← Rd ÷ Rs` (quotient) | 16÷16→16-bit |
| **DIV32 Rd, Rs** | `DIV32 Rd, Rs` | `110 11111 Rd4 Rs4` | `R[d] ← quotient, R[d+1] ← remainder` | Rd must be EVEN |

### 2.6 Single Operand Instructions

**Table 6: Single Operand Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Flags |
|-------------|---------|-----------------|-------------------|-------|
| **SWB Rx** | `SWB Rx` | `11111110 0000 Rx4` | `Rx ← (Rx << 8) OR (Rx >> 8)` | NZ00 |
| **INV Rx** | `INV Rx` | `11111110 0001 Rx4` | `Rx ← ~Rx` | NZ00 |
| **NEG Rx** | `NEG Rx` | `11111110 0010 Rx4` | `Rx ← -Rx` | NZVC |

### 2.7 Memory Access Instructions

**Table 7: Memory Access Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Address Calculation |
|-------------|---------|-----------------|-------------------|---------------------|
| **LD Rd, Rb, offset** | `LD Rd, Rb, offset` | `10 0 Rd4 Rb4 offset5` | `Rd ← Mem[DS:(Rb + offset)]` | `EA = Rb + zero_extend(offset)` |
| **ST Rd, Rb, offset** | `ST Rd, Rb, offset` | `10 1 Rd4 Rb4 offset5` | `Mem[DS:(Rb + offset)] ← Rd` | `EA = Rb + zero_extend(offset)` |
| **LDS Rd, seg, Rb** | `LDS Rd, seg, Rb` | `11110 0 seg2 Rd4 Rb4` | `Rd ← Mem[seg:Rb]` | `EA = Rb` |
| **STS Rd, seg, Rb** | `STS Rd, seg, Rb` | `11110 1 seg2 Rd4 Rb4` | `Mem[seg:Rb] ← Rd` | `EA = Rb` |

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
| **JML Rx** | `JML Rx` | `11111110 0100 Rx4` | `CS ← R[Rx], PC ← R[Rx+1]` | Far jump, flushes pipeline |

### 2.9 PSW Operations

**Table 10: PSW Segment Assignment Operations**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **SRS Rx** | `SRS Rx` | `11111110 1000 Rx4` | `PSW.SR ← Rx, PSW.DS ← 0` |
| **SRD Rx** | `SRD Rx` | `11111110 1001 Rx4` | `PSW.SR ← Rx, PSW.DS ← 1` |
| **ERS Rx** | `ERS Rx` | `11111110 1010 Rx4` | `PSW.ER ← Rx, PSW.DE ← 0` |
| **ERD Rx** | `ERD Rx` | `11111110 1011 Rx4` | `PSW.ER ← Rx, PSW.DE ← 1` |

**Table 11: PSW Flag Operations**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **SET imm** | `SET imm` | `11111110 1100 imm4` | `PSW[imm] ← 1` |
| **CLR imm** | `CLR imm` | `11111110 1101 imm4` | `PSW[imm] ← 0` |
| **SET2 imm** | `SET2 imm` | `11111110 1110 imm4` | `PSW[imm+4] ← 1` |
| **CLR2 imm** | `CLR2 imm` | `11111110 1111 imm4` | `PSW[imm+4] ← 0` |

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

#### 3.3.1 Cache Architecture (Optional)

**Unified L1 Cache Features:**
- **Size**: 4KB configurable implementation
- **Organization**: Direct-mapped
- **Line size**: 16 bytes (8 instructions or 4 data words)
- **Write policy**: Write-through with write buffer
- **Allocation policy**: Read-allocate

**Cache Tag Structure:**
```
+----------------+--------+-----+
| Tag (15 bits)  | Index (8 bits) | Offset (1 bit) |
+----------------+--------+-----+
```
- **Total address**: 20 bits (1MB physical)
- **Index**: 8 bits (256 cache lines)
- **Offset**: 1 bit (selecting word in 16-byte line)
- **Tag**: 15 bits (remaining address bits)

**Cache Control Registers:**
- **Cache Enable (CE)**: Global cache enable/disable
- **Cache Flush (CF)**: Invalidate all cache lines
- **Cache Lock (CL)**: Lock critical code/data in cache

#### 3.3.2 Memory Access Timing

**Cache Hit:**
- **Instruction fetch**: 1 cycle (IF stage)
- **Data access**: 1 cycle (MEM stage)

**Cache Miss:**
- **Instruction miss**: 3-5 cycle penalty (block load)
- **Data miss**: 3-5 cycle penalty (block load)
- **Write buffer**: 1-entry buffer hides write latency

**No-Cache Operation:**
- **Memory read**: 2-3 cycles (assuming fast SRAM)
- **Memory write**: 1 cycle (with ready signal)

### 3.4 Execution Units

#### 3.4.1 ALU Design
**16-bit Arithmetic Unit:**
- **Operations**: ADD, SUB, CMP with full flag generation
- **Flag logic**: N, Z, V, C with precise exception handling
- **Forwarding**: Results available in same cycle

**Logical Unit:**
- **Bitwise operations**: AND, OR, XOR
- **Test operations**: TBC, TBS (flag-only variants)
- **Single-operand**: INV, NEG, SWB

#### 3.4.2 Shift/Rotate Unit
**Barrel Shifter Design:**
- **Single-cycle** shifts/rotates of 0-15 positions
- **Comprehensive support**: Logical, arithmetic, rotate with/without carry
- **Multi-word capability**: Through carry propagation

#### 3.4.3 Multiply/Divide Unit
**Iterative Design:**
- **MUL**: 8-16 cycles (early termination for small operands)
- **MUL32**: 16 cycles for full 32-bit result
- **DIV**: 16-32 cycles (early termination)
- **Pipelined**: Can proceed concurrently with other operations

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

### 4.2 Cache Implementation Details

#### 4.2.1 Cache Organization

**4KB Unified Cache Structure:**
```
+-------------------------+---------------+----------+
| Tag RAM (256×15 bits)   | Data RAM (256×64 bits) | Valid Bits |
+-------------------------+---------------+----------+
```

**Cache Line Format:**
```
+----------+----------+----------+----------+----------+----------+----------+----------+
| Word 0   | Word 1   | Word 2   | Word 3   | Word 4   | Word 5   | Word 6   | Word 7   |
+----------+----------+----------+----------+----------+----------+----------+----------+
```

#### 4.2.2 Cache Operation

**Read Hit:**
1. Address broken into tag, index, offset
2. Tag comparison with valid bit check
3. Data word selected based on offset
4. Result available in 1 cycle

**Read Miss:**
1. Cache line invalidated (if dirty in write-back mode)
2. Main memory read of entire 16-byte line
3. Cache line updated with new data
4. Requested word forwarded to processor
5. Total penalty: 3-5 cycles

**Write Operation (Write-Through):**
1. Data written to cache (if hit)
2. Simultaneous write to write buffer
3. Write buffer handles main memory update
4. Processor continues immediately

#### 4.2.3 Cache Performance Analysis

**Expected Hit Rates:**
- **Instruction cache**: 90-98% (spatial locality)
- **Data cache**: 80-95% (temporal locality)
- **Unified cache**: 85-96% (balanced workload)

**Performance Impact:**
- **Best case** (95% hit rate): Effective CPI ≈ 1.05
- **Worst case** (no cache): Effective CPI ≈ 1.8-2.2
- **Typical case** (90% hit rate): Effective CPI ≈ 1.15

### 4.3 Memory Protection

#### 4.3.1 Simplified Protection Model
Deep16 employs a simple protection scheme:

**Segment-based Protection:**
- **Code Segment (CS)**: Execute-only
- **Data Segments (DS/SS/ES)**: Read/Write
- **No user/supervisor mode** - Single privilege level
- **No page protection** - Keep it simple philosophy

**Boot ROM Protection:**
- **Write protection** for addresses 0xFFFF0-0xFFFFF
- **Reset vector integrity** guaranteed

---

## 5. Interrupt System Architecture

### 5.1 Complete Shadow Register System

#### 5.1.1 Shadow Register Set
```
Normal Registers    Shadow Registers    Purpose
---------------    ----------------    -------
CS                 CS'                 Code Segment
DS                 DS'                 Data Segment  
SS                 SS'                 Stack Segment
ES                 ES'                 Extra Segment
PC                 PC'                 Program Counter
PSW                PSW'                Processor Status Word
```

#### 5.1.2 Context Switching Mechanism

**Interrupt Entry Sequence:**
1. **Complete state save** to shadow registers (hardware automatic)
2. **PSW modification**: PSW.S=1, PSW.I=0 (enter interrupt context)
3. **Segment setup**: CS=0 (interrupts run in segment 0)
4. **Vector fetch**: PC = memory[interrupt_vector]
5. **Pipeline flush** and restart

**Interrupt Exit Sequence:**
1. **RETI instruction** execution
2. **Context restore**: PSW.S=0 (switch to normal view)
3. **Pipeline flush** and restart from saved PC
4. **No data movement** - pure view switching

### 5.2 Interrupt Handling

#### 5.2.1 Vector Table
**Fixed Locations in Segment 0:**
```
0x0000: RESET_VECTOR    (Cold start and warm reset)
0x0001: HW_INT_VECTOR   (Hardware interrupts)
0x0002: SWI_VECTOR      (Software interrupts)
```

#### 5.2.2 Priority and Masking
**Fixed Priority:**
1. **Reset** (highest priority)
2. **Hardware Interrupts**
3. **Software Interrupts** (lowest priority)

**Interrupt Control:**
- **Global enable/disable**: PSW.I bit
- **Individual masking**: Through interrupt controller
- **Nesting**: Not supported (keep it simple)

### 5.3 SMV Instruction Architecture

#### 5.3.1 Symmetric Access
**Normal Mode (PSW.S=0):**
```assembly
SMV R0, ACS      ; R0 = CS' (read shadow CS)
SMV APC          ; PC' = R0 (write shadow PC)
```

**Interrupt Mode (PSW.S=1):**
```assembly
SMV R0, ACS      ; R0 = CS (read normal CS)  
SMV APC          ; PC = R0 (write normal PC)
```

#### 5.3.2 Use Cases
**Debugging:**
- Inspect interrupted context from normal mode
- Examine normal context from interrupt mode

**Context Manipulation:**
- Modify return address before RETI
- Adjust saved processor state

---

*Deep16 Architecture Specification v2.1 - Complete instruction set tables and microarchitecture*

**Key Features:**
- ✅ **Complete instruction set tables** with bit layouts and register transfers
- ✅ **Detailed pipeline architecture** with hazard handling
- ✅ **Optional unified cache** implementation
- ✅ **Comprehensive interrupt system** with shadow registers
- ✅ **Performance analysis** for different configurations

This architecture provides a complete specification for both educational understanding and practical implementation of the Deep16 processor.
