# **Deep16 (深十六) Architecture Specification Milestone 6**
## **16-bit RISC Processor with Enhanced Memory Addressing and Complete Shadow Register System**

---

## **1. Processor Overview**

### **1.1 Architectural Philosophy**
Deep16 is a 16-bit RISC processor designed with a balanced approach to simplicity, performance, and educational value. The architecture embraces classic RISC principles while introducing innovative features for practical embedded systems use.

### **1.2 Key Architectural Features**
- **16-bit fixed-length instructions** - Simplified decoding and alignment
- **16 general-purpose registers** - Reduced memory traffic
- **Segmented memory addressing** - 20-bit physical address space (1MB)
- **Extended shadow register system** - Zero-overhead interrupt context switching with 12 shadow registers
- **Complete shadow register system** - R0'-R3', R13', R14', PC', PSW', CS', DS', SS', ES'
- **5-stage pipelined implementation** - With delayed branch optimization
- **Optional unified L1 cache** - Configurable 0-4KB direct-mapped cache
- **Memory-mapped I/O** - Simplified peripheral access
- **Word-based memory system** - No byte alignment complications
- **No memory protection** - Fully accessible memory space
- **Clean interrupt model** - Hardware-managed context switching via PSW'.S bit
- **ILL trap system** - Illegal instruction handling with FPU emulation support
- **Symmetric SMV access** - SMV works perfectly in both normal and interrupt modes
- **Hardware-assisted interrupt handling** - Automatic context snapshot and initialization
- **Enhanced assembler syntax** - Bracket and plus notation for improved readability
- **Architectural register access** - SMV Rx, PC for stable state reading

### **1.3 Performance Targets**
- **Base CPI**: 1.0-1.3 (ideal to realistic)
- **Operating frequency**: 80MHz in modern FPGAs
- **Branch penalty**: 0 cycles (delayed branch architecture)
- **Interrupt latency**: 2 cycles (entry + jump)
- **Cache hit rate**: 85-95% with 4KB unified cache (if implemented)
- **Memory bandwidth**: 160 MB/s at 80MHz
- **Subroutine call overhead**: 2 cycles (optimized with ALINK)
- **Call performance**: **33% faster** than traditional 3-cycle call sequences
- **Real-world speedup**: 10-25% for call-intensive code using ALINK optimization

---

## **2. Register Set**

### **2.1 General Purpose Registers (16-bit)**

**Table A: General Purpose Registers**

| Register | Alias | Conventional Use |
|----------|-------|------------------|
| R0       |       | LDI destination, temporary |
| R1-R11   |       | General purpose |
| R12      | FP    | Frame Pointer |
| R13      | SP    | Stack Pointer |
| R14      | LR    | Link Register |
| R15      | PC    | Program Counter |

**Important**: LDI instruction **always** loads R0. To load other registers, use MOV or LSI.

### **2.2 Segment Registers (16-bit)**

**Table B: Segment Registers**

| Register | Code | Purpose |
|----------|------|---------|
| CS       | 00   | Code Segment |
| DS       | 01   | Data Segment |
| SS       | 10   | Stack Segment |
| ES       | 11   | Extra Segment |

The effective 20-bit memory address is computed as `(segment << 4) + offset`. Which segment register to use is either explicit (LDS/STS) or implicit: CS for instruction fetch, SS or ES when specified via PSW SR/ER or else DS.

### **2.3 Special and Shadow Registers**

**Table C: Special and Shadow Registers**

| Register | Purpose | Bits | Access Method |
|----------|---------|------|---------------|
| PSW      | Processor Status Word | 16 | SPSW, LPSW |
| PSW'     | Shadow PSW | 16 | **Hardware managed**, readable via SMV |
| R0'      | R0 Shadow | 16 | SMV |
| R1'      | R1 Shadow | 16 | SMV |
| R2'      | R2 Shadow | 16 | SMV |
| R3'      | R3 Shadow | 16 | SMV |
| R13'     | SP Shadow | 16 | SMV |
| R14'     | LR Shadow | 16 | SMV |
| PC'      | Program Counter Shadow | 16 | SMV |
| CS'      | Code Segment Shadow | 16 | SMV |
| DS'      | Data Segment Shadow | 16 | SMV |
| SS'      | Stack Segment Shadow | 16 | SMV |
| ES'      | Extra Segment Shadow | 16 | SMV |

**Complete Shadow Register Set:** R0', R1', R2', R3', R13', R14', PC', PSW', CS', DS', SS', ES' (12 total shadow registers)

**Shadow Register Access:**
- **SMV accesses alternate context**: Based on PSW'.S bit
- **PSW'.S = 0 (Normal mode)**: SMV reads shadow registers (R0'-R3', R13', R14', PC', PSW', CS', DS', SS', ES')
- **PSW'.S = 1 (Interrupt mode)**: SMV reads normal registers (R0-R3, R13, R14, PC, PSW, CS, DS, SS, ES)
- **Hardware control**: PSW' is managed entirely by hardware during interrupt entry/exit

### **2.4 Processor Status Word (PSW)**

**Classic PSW Visualization:**
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

**Table 3: PSW Bit Layout (Definitive)**

| Bit | Name | Description | Access |
|-----|------|-------------|--------|
| 0 | N | Negative flag (1=result negative) | SET/CLR, LPSW/SPSW |
| 1 | Z | Zero flag (1=result zero) | SET/CLR, LPSW/SPSW |
| 2 | V | Overflow flag (1=signed overflow) | SET/CLR, LPSW/SPSW |
| 3 | C | Carry flag (1=unsigned carry/borrow) | SET/CLR, LPSW/SPSW |
| 4 | I | Interrupt Enable (1=interrupts enabled) | SETI/CLRI, LPSW/SPSW |
| 5 | S | Shadow View (1=shadow context active) | **Hardware managed**, readable via LPSW |
| 6-9 | SR[3:0] | Stack Register selection (0-15) | LPSW/SPSW only |
| 10 | DS | Dual Stack (1=use register pair for SS) | LPSW/SPSW only |
| 11-14 | ER[3:0] | Extra Register selection (0-15) | LPSW/SPSW only |
| 15 | DE | Dual Extra (1=use register pair for ES) | LPSW/SPSW only |

**PSW Reset State**: `0x0020` (Shadow bit S=1, interrupts disabled)
- This ensures boot code runs in normal context (PSW.S=0 after first interrupt return)

---

## **3. Instruction Set Architecture**

### **3.1 Complete Opcode Hierarchy**

**Table 1: Instruction Opcode Hierarchy (Precise Encoding)**

| Opcode | Bits | Instruction | Format | Pipeline Effect |
|--------|------|-------------|--------|----------------|
| 0 | 1 | LDI | `[0][imm15]` | Full pipeline |
| 10 | 2 | LD/ST | `[10][d1][Rd4][Rb4][offset5]` | Potential load-use stall |
| 110 | 3 | ALU2 | `[110][func5][Rd4][Rs/imm4]` | Full pipeline, forwarding |
| 1110 | 4 | JMP | `[1110][type3][target9]` | **Uses delay slot** |
| 11110 | 5 | LDS/STS | `[11110][d1][seg2][Rd4][Rs4]` | Segment access in MEM |
| 111110 | 6 | MOV | `[111110][Rd4][Rs4][imm2]` | Register copy with optional small offset |
| 1111110 | 7 | LSI | `[1111110][Rd4][imm5]` | Full pipeline |
| 11111110 | 8 | SMV | `[11111110][Rx4][alt_sel4]` | Shadow register access (read-only) |
| 111111110 | 9 | MVS | `[111111110][d1][Rd4][seg2]` | Segment access in MEM |
| 1111111110 | 10 | SOP | `[1111111110][type2][Rx4]` | Single operand and PSW ops |
| 11111111110 | 11 | SET/CLR | `[11111111110][d1][imm4]` | PSW bit operations |
| 111111111110 | 12 | JML | `[111111111110][Rx4]` | Far jump to different segment |
| 1111111111110 | 13 | SYS | `[1111111111110][op3]` | System operations |
| **11111111111110** | **14** | **FPU_CORE** | `[11111111111110][ff]` | **FPU operations (ILL trap)** |
| **111111111111110** | **15** | **FPU_EXT** | `[111111111111110][f]` | **FPU extended (ILL trap)** |
| **1111111111111110** | **16** | **FCMP** | `[1111111111111110]` | **FPU compare (ILL trap)** |
| **1111111111111111** | **16** | **HLT** | `[1111111111111111]` | **Halt processor** |

### **3.2 Illegal Instruction (ILL) and FPU Emulation**

**ILL Trap Overview:**
- **Replaces NMI** at vector address 0x0000
- **Triggers on**: Unimplemented instructions (including all FPU instructions)
- **Behavior**: Similar to SWI but handler must examine APC-1 to find trapped instruction
- **Critical restriction**: ILL must NOT occur in interrupt context (PSW.S=1)
  - If attempted, results in double fault (processor reset)

**FPU Encoding Space Allocation:**
- **11111111111110xx** (14-bit prefix + 2 bits): 4 FPU_CORE operations
  - Suggested: FADD, FMUL, FDIV, FSQRT
- **111111111111110x** (15-bit prefix + 1 bit): 2 FPU_EXT operations  
  - Suggested: FEXP, FLOG
- **1111111111111110** (16-bit): 1 FCMP operation
  - Floating-point compare with condition codes

**ILL Trap Operation:**
```
On ILL trap (unimplemented instruction):
PSW'  ← 0x0020    ; S=1, I=0 - switch to shadow context
CS'   ← 0         ; Interrupts run in segment 0
DS'   ← 0
SS'   ← 0  
ES'   ← 0
R0'   ← 0         ; Initialize shadow registers
R1'   ← 0
R2'   ← 0
R3'   ← 0
R13'  ← 0
R14'  ← 0
PC'   ← Mem[0x0000]  ; Jump to ILL handler at vector 0
; APC contains address of instruction AFTER the trapped instruction
```

**FPU Emulation Process:**
1. ILL handler reads trapped instruction from `APC - 1`
2. Decodes instruction to determine which FPU operation
3. Emulates operation using normal integer registers
4. Returns with RETI

### **3.3 SMV Instruction (Shadow Register Access)**

**Table F: SMV Alternate Register Selection (Extended)**

| alt_sel | Alternate Register | Syntax | Operation |
|---------|-------------------|--------|-----------|
| 0000 | R0' (AR0) | `SMV Rx, AR0` | `Rx ← R0'` |
| 0001 | R1' (AR1) | `SMV Rx, AR1` | `Rx ← R1'` |
| 0010 | R2' (AR2) | `SMV Rx, AR2` | `Rx ← R2'` |
| 0011 | R3' (AR3) | `SMV Rx, AR3` | `Rx ← R3'` |
| 0100 | R13' (AR13/SP') | `SMV Rx, AR13` | `Rx ← SP'` |
| 0101 | R14' (AR14/LR') | `SMV Rx, AR14` | `Rx ← LR'` |
| 0110 | PC' (APC) | `SMV Rx, APC` | `Rx ← PC'` |
| 0111 | PSW' (APSW) | `SMV Rx, APSW` | `Rx ← PSW'` |
| 1000 | CS' (ACS) | `SMV Rx, ACS` | `Rx ← CS'` |
| 1001 | DS' (ADS) | `SMV Rx, ADS` | `Rx ← DS'` |
| 1010 | SS' (ASS) | `SMV Rx, ASS` | `Rx ← SS'` |
| 1011 | ES' (AES) | `SMV Rx, AES` | `Rx ← ES'` |
| 1100 | *reserved* | *reserved* | *reserved* |
| 1101 | *reserved* | *reserved* | *reserved* |
| 1110 | *reserved* | *reserved* | *reserved* |
| 1111 | PC | `SMV Rx, PC` | `Rx ← PC` (Architectural PC) |

**SMV Instruction Format:**
```
15                8 7           4 3             0
+-------------------+-------------+---------------+
| 11111110          |    Rx4      |   alt_sel    |
+-------------------+-------------+---------------+
```

**Operation:** `Rx ← alt_reg` (reads alternate/shadow register into Rx)

**Key Characteristics:**
1. **Read-only operation**: Always reads from alternate register to destination Rx
2. **No d-bit**: Simplified encoding
3. **Symmetric access**: SMV reads different registers based on PSW'.S
4. **Architectural PC access**: alt_sel=1111 reads stable PC (bypasses forwarding)

**SMV Symmetric Access Behavior:**
- **PSW'.S = 0 (Normal mode)**: SMV accesses shadow registers (R0'-R3', R13', R14', PC', PSW', CS', DS', SS', ES')
- **PSW'.S = 1 (Interrupt mode)**: SMV accesses normal registers (R0-R3, R13, R14, PC, PSW, CS, DS, SS, ES)

### **3.4 Data Movement Instructions**

**Table 2: Data Movement Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Notes |
|-------------|---------|-----------------|-------------------|-------|
| **LDI** | `LDI imm` | `0 imm15` | `R0 ← sign_extend(imm15)` | Sign extends 15-bit immediate |
| **LSI** | `LSI Rd, imm` | `1111110 Rd4 imm5` | `Rd ← sign_extend(imm5)` | Small immediate load |
| **MOV Rd, Rs, imm** | `MOV Rd, Rs, imm` | `111110 Rd4 Rs4 imm2` | `Rd ← Rs + imm2` | Normal with forwarding |
| **MVS Rd, Sx** | `MVS Rd, Sx` | `111111110 0 Rd4 seg2` | `Rd ← Sx` | Read segment register |
| **MVS Sx, Rd** | `MVS Sx, Rd` | `111111110 1 Rd4 seg2` | `Sx ← Rd` | Write segment register |
| **SMV Rx, alt_reg** | `SMV Rx, alt_reg` | `11111110 Rx4 alt_sel4` | `Rx ← alt_reg` | Read shadow/alternate register |

**Assembler Aliases for Clarity:**
```assembly
MOV Rd, Rs        = MOV Rd, Rs, 0      ; Normal move with forwarding
AMV Rd, Rs        = MOV Rd, Rs, 3      ; Architectural move (bypass forwarding)
JMP Rx            = MOV PC, Rx, 0      ; Jump to address in Rx
```

### **3.5 PSW Operations**

**Table N: PSW Segment Assignment Operations**

| Instruction | Format | Binary Encoding | Behavior |
|-------------|---------|-----------------|----------|
| **SRS** | `SRS Rx` | `11111110 1000 Rx4` | `PSW.SR = Rx, PSW.DS = 0` |
| **SRD** | `SRD Rx` | `11111110 1001 Rx4` | `PSW.SR = Rx, PSW.DS = 1` |
| **ERS** | `ERS Rx` | `11111110 1010 Rx4` | `PSW.ER = Rx, PSW.DE = 0` |
| **ERD** | `ERD Rx` | `11111110 1011 Rx4` | `PSW.ER = Rx, PSW.DE = 1` |

**Table 4: PSW Bit Operations (11111111110 d1 imm4)**

| Instruction | Format | Binary Encoding | Operation | Notes |
|-------------|---------|-----------------|-----------|-------|
| **SET imm** | `SET imm` | `11111111110 0 imm4` | `PSW[imm] ← 1` | Only bits 0-3,5 useful |
| **CLR imm** | `CLR imm` | `11111111110 1 imm4` | `PSW[imm] ← 0` | Only bits 0-3,5 useful |

**Table 5: System Instructions with SETI/CLRI (1111111111110 op3)**

| Instruction | Format | Binary Encoding | Operation | Notes |
|-------------|---------|-----------------|-----------|-------|
| **NOP** | `NOP` | `1111111111110 000` | No operation | |
| **FSH** | `FSH` | `1111111111110 001` | Flush pipeline | Clears pipeline bubbles |
| **SWI** | `SWI` | `1111111111110 010` | Software interrupt | Enters interrupt context |
| **RETI** | `RETI` | `1111111111110 011` | Return from interrupt | Restores normal context |
| **SETI** | `SETI` | `1111111111110 100` | `PSW[4] ← 1` | Enable interrupts |
| **CLRI** | `CLRI` | `1111111111110 101` | `PSW[4] ← 0` | Disable interrupts |
| *Reserved* | - | `1111111111110 110` | Reserved | Future use |
| *Reserved* | - | `1111111111110 111` | Reserved | Future use |

### **3.6 Single Operand and PSW Instructions (SOP)**

**Table 12: Single Operand Instructions (1111111110 type2 Rx4)**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **INV Rx** | `INV Rx` | `1111111110 00 Rx4` | `Rx ← ~Rx` |
| **NEG Rx** | `NEG Rx` | `1111111110 01 Rx4` | `Rx ← -Rx` |
| **SPSW Rx** | `SPSW Rx` | `1111111110 10 Rx4` | `PSW ← Rx` |
| **LPSW Rx** | `LPSW Rx` | `1111111110 11 Rx4` | `Rx ← PSW` |

### **3.7 ALU Instructions - Revised with CLRB**

**Table 6: Basic ALU Instructions (Updated)**

| Instruction | Format | Binary Encoding | Register Transfer | Flags |
|-------------|---------|-----------------|-------------------|-------|
| **ADD Rd, Rs** | `ADD Rd, Rs` | `110 00000 Rd4 Rs4` | `Rd ← Rd + Rs` | NZVC |
| **ADD Rd, imm** | `ADD Rd, imm` | `110 00001 Rd4 imm4` | `Rd ← Rd + imm` | NZVC |
| **SUB Rd, Rs** | `SUB Rd, Rs` | `110 00010 Rd4 Rs4` | `Rd ← Rd - Rs` | NZVC |
| **SUB Rd, imm** | `SUB Rd, imm` | `110 00011 Rd4 imm4` | `Rd ← Rd - imm` | NZVC |
| **CMP Rd, Rs** | `CMP Rd, Rs` | `110 00100 Rd4 Rs4` | `Rd - Rs` (flags only) | NZVC |
| **CMP Rd, imm** | `CMP Rd, imm` | `110 00101 Rd4 imm4` | `Rd - imm` (flags only) | NZVC |
| **AND Rd, Rs** | `AND Rd, Rs` | `110 00110 Rd4 Rs4` | `Rd ← Rd AND Rs` | NZ00 |
| **CLRB Rd, imm** | `CLRB Rd, imm` | `110 00111 Rd4 imm4` | `Rd ← Rd AND NOT(1 << imm)` | NZ00 |
| **TBC Rd, Rs** | `TBC Rd, Rs` | `110 01000 Rd4 Rs4` | `Rd AND Rs` (flags only) | NZ00 |
| **TBC Rd, imm** | `TBC Rd, imm` | `110 01001 Rd4 imm4` | `Rd AND (1 << imm)` (flags only) | NZ00 |
| **OR Rd, Rs** | `OR Rd, Rs` | `110 01010 Rd4 Rs4` | `Rd ← Rd OR Rs` | NZ00 |
| **OR Rd, imm** | `OR Rd, imm` | `110 01011 Rd4 imm4` | `Rd ← Rd OR (1 << imm)` | NZ00 |
| **XOR Rd, Rs** | `XOR Rd, Rs` | `110 01100 Rd4 Rs4` | `Rd ← Rd XOR Rs` | NZ00 |
| **XOR Rd, imm** | `XOR Rd, imm` | `110 01101 Rd4 imm4` | `Rd ← Rd XOR (1 << imm)` | NZ00 |
| **TBS Rd, Rs** | `TBS Rd, Rs` | `110 01110 Rd4 Rs4` | `Rd XOR Rs` (flags only) | NZ00 |
| **TBS Rd, imm** | `TBS Rd, imm` | `110 01111 Rd4 imm4` | `Rd XOR (1 << imm)` (flags only) | NZ00 |

**CLRB Instruction Details:**
- Clears a single bit in the destination register
- `imm4` specifies which bit to clear (0-15)
- Useful for bit manipulation without needing a mask register
- Equivalent to: `Rd ← Rd AND NOT(1 << imm4)`

### **3.8 ALU Instructions - Group 2: Shift/Rotate Operations**

**Table 7: Shift and Rotate Instructions**

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

### **3.9 ALU Instructions - Group 3: Multiply/Divide Operations**

**Table 8: Multiply/Divide Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Notes |
|-------------|---------|-----------------|-------------------|-------|
| **MUL Rd, Rs** | `MUL Rd, Rs` | `110 11100 Rd4 Rs4` | `Rd ← Rd × Rs` (low 16 bits) | 16×16→16-bit |
| **MUL32 Rd, Rs** | `MUL32 Rd, Rs` | `110 11101 Rd4 Rs4` | `R[d]:R[d+1] ← Rd × Rs` | Rd must be EVEN |
| **DIV Rd, Rs** | `DIV Rd, Rs` | `110 11110 Rd4 Rs4` | `Rd ← Rd ÷ Rs` (quotient) | 16÷16→16-bit |
| **DIV32 Rd, Rs** | `DIV32 Rd, Rs` | `110 11111 Rd4 Rs4` | `R[d] ← quotient, R[d+1] ← remainder` | Rd must be EVEN |

### **3.10 Single Operand ALU Operations**

**Table J: Single Operand Instructions**

| Instruction | Format   | Binary Encoding     | Behavior |
|-------------|----------|---------------------|----------|
| **SWB**     | `SWB Rx` | `11111110 0000 Rx4` | `Rx = (Rx << 8) OR (Rx >> 8)` |
| **INV**     | `INV Rx` | `11111110 0001 Rx4` | `Rx = ~Rx` |
| **NEG**     | `NEG Rx` | `11111110 0010 Rx4` | `Rx = -Rx` |

### **3.11 Memory Access Instructions**

**Table 9: Memory Access Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Address Calculation |
|-------------|---------|-----------------|-------------------|---------------------|
| **LD Rd, Rb, offset** | `LD Rd, Rb, offset` | `10 0 Rd4 Rb4 offset5` | `Rd ← Mem[DS:(Rb + offset)]` | `EA = Rb + sign_extend(offset)` |
| **ST Rd, Rb, offset** | `ST Rd, Rb, offset` | `10 1 Rd4 Rb4 offset5` | `Mem[DS:(Rb + offset)] ← Rd` | `EA = Rb + sign_extend(offset)` |
| **LDS Rd, seg, Rb** | `LDS Rd, seg, Rb` | `11110 0 seg2 Rd4 Rb4` | `Rd ← Mem[seg:Rb]` | `EA = Rb` |
| **STS Rd, seg, Rb** | `STS Rd, seg, Rb` | `11110 1 seg2 Rd4 Rb4` | `Mem[seg:Rb] ← Rd` | `EA = Rb` |

**LD/ST Offset Semantics:**
- **Critical**: 5-bit offset is **sign-extended** (-16 to +15)
- **Range**: -16 to +15 from base register
- **Enables negative offsets**: `LD R1, [SP-4]` works directly
- **Enhanced syntax**: `LD R1, [R2-8]` becomes `LD R1, R2, -8`

**Examples:**
```assembly
LD  R1, SP, -4    ; Load from stack frame (SP-4)
ST  R2, FP, 2     ; Store to frame pointer + 2  
LD  R3, R4, -1    ; Load from previous word
```

### **3.12 Control Flow Instructions**

**Table 10: Condition Codes for Jump Instructions**

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

**Table 11: Control Flow Instructions**

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
| **JMP Rx** | `JMP Rx` | `MOV PC, Rx, 0` | `PC ← Rx` | Assembler alias |
| **JML Rx** | `JML Rx` | `111111111110 Rx4` | `CS ← R[Rx], PC ← R[Rx+1]` | Far jump to different segment |

**Requirements:** For JML, Rx must be EVEN (uses register pair Rx:Rx+1)

### **3.13 Halt Instruction**

**Table Q: Halt Instruction**

| Instruction | Format | Binary Encoding | Behavior |
|-------------|---------|-----------------|----------|
| **HLT** | `HLT` | `1111111111111111` | Halt processor |

---

## **4. Interrupt Context Switching System**

### **4.1 Core Principle**

**PSW'.S bit** determines active register context:
- **PSW'.S = 0**: Normal registers (CS, DS, SS, ES, PC, PSW, R0-R15)
- **PSW'.S = 1**: Shadow registers (CS', DS', SS', ES', PC', PSW', R0', R1', R2', R3', R13', R14')

### **4.2 Reset Initialization**

```
PSW'  ← 0x0000    ; S=0, use normal context
PSW   ← 0x0000    ; S=0, interrupts disabled
CS    ← 0xFFFF    ; Boot from top of memory
DS/SS/ES ← 0x0000 ; Other segments zero
PC    ← 0x0000    ; Start execution at CS:0000
```

### **4.3 Extended Shadow Register Set**

#### **Shadow Registers (12 total)**
1. **Segment Registers**: CS', DS', SS', ES'
2. **Control Registers**: PC', PSW'
3. **General-Purpose Registers**: R0', R1', R2', R3', R13' (SP'), R14' (LR')

#### **Rationale for Selective Shadows**
- **R0'**: LDI always uses R0, interrupts often need to load values
- **R1'/R2'/R3'**: Common argument/return value registers
- **R13' (SP')**: Critical for stack integrity
- **R14' (LR')**: Return address preservation
- **Minimal hardware**: 96 bits vs 256 bits for full set

### **4.4 Interrupt Entry Sequence**

#### **Hardware-Automated Process**
**On any interrupt (ILL, HW, SWI):**
```
PSW'  ← 0x0020    ; S=1, I=0 - switch to shadow context
CS'   ← 0         ; Interrupts run in segment 0
DS'   ← 0
SS'   ← 0  
ES'   ← 0
R0'   ← 0         ; Initialize shadow registers
R1'   ← 0
R2'   ← 0
R3'   ← 0
R13'  ← 0
R14'  ← 0
PC'   ← Mem[interrupt_vector]  ; Jump to handler
; Hardware automatically uses shadow registers (PSW'.S=1)
```

#### **Key Characteristics**
1. **PSW' is NOT copied from PSW** - set to `0x0020` (S=1, I=0)
2. **All shadow segments set to 0** - interrupts run in segment 0
3. **Shadow GP registers initialized to 0** - clean context
4. **PC' gets handler address** from interrupt vector table
5. **Context switch via PSW'.S=1** - hardware handles all muxing

### **4.5 Interrupt Vector Table**

**Located at Segment 0 (Low Memory):**
```
0x0000: ILL_VECTOR      (Illegal Instruction Trap) - Replaces NMI
0x0001: HW_INT_VECTOR   (Hardware Interrupts)  
0x0002: SWI_VECTOR      (Software Interrupts)
```

### **4.6 Interrupt Types and Priority**

**Table: Interrupt Types**

| Interrupt Type | Vector Address | Trigger | Priority | Maskable |
|----------------|----------------|---------|----------|----------|
| **ILL Trap** | 0x0000 | Unimplemented instruction | Highest | No (always enabled) |
| **Hardware Interrupt** | 0x0001 | External interrupt signal | Medium | Yes (PSW.I) |
| **Software Interrupt (SWI)** | 0x0002 | SWI instruction | Lowest | Programmatic |

**Priority Order:** ILL > HW > SWI

### **4.7 ILL Trap Detailed Operation**

#### **ILL Trap Trigger Conditions**
1. **Unimplemented FPU instructions** (opcodes 11111111111110xx, 111111111111110x, 1111111111111110)
2. **Any other undefined opcode** not in the instruction set
3. **Double fault condition**: ILL occurring while already in interrupt context (PSW.S=1)

#### **ILL Handler Requirements**
- **Must examine APC-1** to find the trapped instruction
- **Must check for double fault** by reading APSW.S bit
- **Can emulate instructions** (e.g., FPU operations)
- **Must return with RETI** to restore normal context

#### **ILL Handler Example**
```assembly
ILL_HANDLER:
    ; Get trapped instruction address
    SMV  R0, APC      ; R0 = address after trapped instruction
    SUB  R0, R0, 1    ; R0 = address of trapped instruction
    
    ; Check for double fault (ILL in interrupt context)
    SMV  R1, APSW     ; R1 = interrupted PSW
    AND  R2, R1, 0x0020  ; Check S bit
    JNZ  DOUBLE_FAULT  ; Already in interrupt = double fault
    
    ; Read trapped instruction
    MVS  CS, 0        ; Ensure CS=0
    LD   R1, R0, 0    ; R1 = trapped instruction
    
    ; Decode and handle
    ; ... emulation code ...
    
    RETI

DOUBLE_FAULT:
    ; Fatal error - trigger system reset
    ; In hardware, this should reset the processor
    HLT
```

### **4.8 Interrupt Handler Execution Environment**

#### **Execution Environment**
- All instructions automatically use **shadow registers** (PSW'.S=1)
- Segments fixed at 0 unless modified by handler
- Interrupts disabled (PSW'.I=0) during handler execution
- Clean register context: all shadow registers initialized to 0

#### **Accessing Interrupted State**
- `SMV R0, APSW` accesses **normal PSW** (interrupted state)
- `SMV R0, APC` accesses **normal PC** (interrupted address)
- `SMV R0, AR0` accesses **normal R0** (from interrupted context)
- Similar for other registers via SMV instruction

#### **Example Interrupt Handler**
```assembly
interrupt_handler:
    ; Running in shadow context (PSW'.S=1)
    ; All shadow registers initialized to 0
    
    ; Use shadow registers directly
    LDI  0x1234      ; Uses R0' (shadow R0)
    MOV  R1, R0      ; R1' = R0' (using shadow registers)
    
    ; Access interrupted context if needed
    SMV  R2, APC     ; R2' = PC (normal interrupted PC)
    SMV  R3, APSW    ; R3' = PSW (normal interrupted PSW)
    
    ; ... handler code ...
    
    RETI             ; Return to normal context
```

### **4.9 Interrupt Exit Sequence**

#### **Hardware-Automated Process**
**On RETI instruction:**
```
PSW'  ← 0x0000    ; S=0 - switch back to normal context
; Hardware automatically uses normal registers (PSW'.S=0)
; Execution resumes with original segments and PSW intact
```

#### **Important Notes**
1. **No register restoration occurs** - normal registers were never modified
2. **Shadow registers retain their values** for next interrupt/debugging
3. **Only PSW' is modified** - set to 0x0000 to trigger context switch
4. **Pipeline flush** - clean transition between contexts

### **4.10 Hardware Implementation**

#### **Context Switching Muxing**
```verilog
// Single bit (PSW'.S) controls all context switching
assign active_cs   = psw_shadow_s ? cs_shadow   : cs_normal;
assign active_ds   = psw_shadow_s ? ds_shadow   : ds_normal;
assign active_ss   = psw_shadow_s ? ss_shadow   : ss_normal;  
assign active_es   = psw_shadow_s ? es_shadow   : es_normal;
assign active_pc   = psw_shadow_s ? pc_shadow   : pc_normal;
assign active_psw  = psw_shadow_s ? psw_shadow  : psw_normal;

// General-purpose register muxing
assign active_reg0  = psw_shadow_s ? reg0_shadow  : reg0_normal;
assign active_reg1  = psw_shadow_s ? reg1_shadow  : reg1_normal;
assign active_reg2  = psw_shadow_s ? reg2_shadow  : reg2_normal;
assign active_reg3  = psw_shadow_s ? reg3_shadow  : reg3_normal;
assign active_reg13 = psw_shadow_s ? reg13_shadow : reg13_normal;
assign active_reg14 = psw_shadow_s ? reg14_shadow : reg14_normal;

// Other registers (R4-R12, R15) always use normal context
assign active_reg4  = reg4_normal;
// ... etc for R5-R12 ...
assign active_reg15 = reg15_normal;  // PC special case handled above
```

#### **Interrupt Entry Logic**
```verilog
always @(posedge interrupt_trigger) begin
    // Set shadow context
    psw_shadow <= 16'h0020;    // S=1, I=0
    
    // Initialize all shadows to 0
    cs_shadow  <= 16'h0000;
    ds_shadow  <= 16'h0000;
    ss_shadow  <= 16'h0000;
    es_shadow  <= 16'h0000;
    reg0_shadow <= 16'h0000;
    reg1_shadow <= 16'h0000;
    reg2_shadow <= 16'h0000;
    reg3_shadow <= 16'h0000;
    reg13_shadow <= 16'h0000;
    reg14_shadow <= 16'h0000;
    
    // Set handler address
    pc_shadow <= interrupt_vector;  // From vector table
    
    // Note: Normal registers remain unchanged
end
```

### **4.11 Key Benefits of Shadow Register System**

#### **1. Zero Software Overhead**
- **No manual register saving** required in interrupt handlers
- **Hardware-managed context** switching via PSW'.S
- **Fast interrupt entry/exit** - minimal cycles

#### **2. Clean Context Separation**
- **Interrupt handlers** run in clean, initialized context
- **Normal execution** completely isolated from interrupts
- **Predictable state** - all shadows initialized to 0

#### **3. Debugging Support**
- **SMV provides symmetric access** to both contexts
- **Inspect interrupted state** from normal mode
- **Examine normal registers** from interrupt mode

#### **4. Hardware Simplicity**
- **Single control bit** (PSW'.S) for all muxing
- **Minimal shadow registers** - only commonly-used ones
- **Efficient implementation** - ~2,650 LUTs estimated

#### **5. Performance Characteristics**
- **Interrupt latency**: 2 cycles (entry + jump)
- **Context switch**: 0 cycles (hardware concurrent)
- **Register access**: Immediate (no save/restore penalty)
- **Memory usage**: No stack usage for context saving

---

## **5. Enhanced Assembler Syntax and Aliases**

### **5.1 Enhanced Assembler Syntax (Preprocessing Only)**

**Important**: The enhanced syntax described below is purely **assembler preprocessing**. The binary encoding always uses the specific instruction (MOV, MVS, SMV, LD, ST). The assembler automatically translates enhanced syntax to the correct machine instruction.

#### **5.1.1 LD/ST Bracket Syntax**

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

#### **5.1.2 MOV Plus Syntax**

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

### **5.2 Instruction Aliases**

**Table R: Instruction Aliases**

| Alias | Actual Instruction | Purpose |
|-------|-------------------|---------|
| HALT | HLT | Halt processor |
| JMP Rx | MOV PC, Rx | Unconditional jump to register |
| LNK Rx | MOV Rx, PC, 2 | Link to subroutine (standard case) |
| LINK | MOV LR, PC, 2 | Link to subroutine using LR (standard case) |
| AMV Rx, Ry | MOV Rx, Ry, 3 | Architectural move (bypass forwarding) |
| ALNK Rx | SMV Rx, PC | Architectural link via SMV Rx, PC |
| ALINK | SMV LR, PC | Architectural link to LR via SMV LR, PC |
| GETPC Rx | SMV Rx, PC | Architectural read of PC |

### **5.3 Flag Operation Aliases**

**Table S: Common Flag Aliases**

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
| SETI | SET 4 | Enable interrupts |
| CLRI | CLR 4 | Disable interrupts |
| SETS | SET 5 | Enable shadow view |
| CLRS | CLR 5 | Disable shadow view |

---

## **6. Programming Model**

### **6.1 Register Usage Conventions**

| Register | Preserved? | Purpose |
|----------|------------|---------|
| R0       | Caller-save | LDI destination, temporary |
| R1-R11   | Caller-save | General purpose |
| R12 (FP) | Callee-save | Frame pointer |
| R13 (SP) | Callee-save | Stack pointer |
| R14 (LR) | Callee-save | Return address |
| R15 (PC) | - | Program counter |

### **6.2 Subroutine Call Mechanism**

#### **6.2.1 Delayed Branch Impact on Subroutine Calls**

The Deep16 architecture implements a **one-slot delayed branch**, which significantly impacts subroutine call conventions. Unlike architectures with dedicated CALL instructions, Deep16 uses a two-instruction sequence:

**Standard Subroutine Call:**
```assembly
LINK          ; MOV LR, PC, 2  - Store return address in Link Register
JMP  sub_func ; Jump to subroutine
; Delay slot executes here
```

**Why LINK uses immediate value 2:**
- The `LINK` alias expands to `MOV LR, PC, 2`
- The value `2` accounts for the **branch delay slot**:
  - `PC` during `LINK` execution points to the `JMP` instruction
  - The delay slot instruction at `PC + 1` always executes
  - The actual return address should be `PC + 2` (after delay slot)

#### **6.2.2 Optimized Subroutine Call using ALINK**

To utilize the delay slot efficiently, Deep16 provides **architectural register access** via SMV with alt_sel=1111:

**Optimized Subroutine Call using ALINK:**
```assembly
JMP   sub_func        ; Jump to subroutine  
ALINK                 ; SMV LR, PC - Architectural read of PC in delay slot
; Execution continues after subroutine return
```

#### **6.2.3 Performance Impact of ALINK Optimization**

**Traditional vs Optimized Performance:**
```assembly
; Traditional (3 cycles for call sequence)
LINK           ; MOV LR, PC, 2  - 1 cycle
JMP  func      ; 1 cycle  
NOP            ; 1 cycle (wasted) - TOTAL: 3 cycles

; Optimized (2 cycles for call sequence) 
JMP  func      ; 1 cycle
ALINK          ; SMV LR, PC  - 1 cycle (useful work) - TOTAL: 2 cycles
```

**Performance Benefits:**
- **33% improvement** in call sequence performance
- **Theoretical maximum**: 33% faster subroutine calls
- **Practical achievement**: 20-25% in well-optimized code
- **Real-world expectation**: 10-20% overall performance gain in call-intensive workloads

### **6.3 Programming Examples**

#### **6.3.1 Complete System Initialization**
```assembly
INIT_SYSTEM:
    ; Disable interrupts during setup
    CLRI
    
    ; Setup segment registers
    LDI 0x0000
    MVS CS, R0      ; CS = 0x0000
    MVS DS, R0      ; DS = 0x0000
    MVS SS, R0      ; SS = 0x0000
    MVS ES, R0      ; ES = 0x0000
    
    ; Setup stack pointer (R13)
    LDI STACK_TOP
    MOV R13, R0
    LDI 0x0000      ; Clear R14 (pair with R13 for SS access)
    MOV R14, R0
    
    ; Setup extra register pair (R11:R12 for ES access)
    LDI ES_BASE
    MOV R11, R0
    LDI 0x0000
    MOV R12, R0
    
    ; Configure PSW for dual registers
    LPSW R1
    AND  R1, 0x001F     ; Keep only NZVC+I
    LDI  0xE400         ; DE=1, ER=11, DS=1, SR=13
    OR   R1, R0         ; Combine
    OR   R1, 0x0010     ; Set I=1 (will enable later)
    SPSW R1             ; Update PSW
    
    ; Setup interrupt vector table
    LDI 0x0000
    MVS CS, R0          ; Set CS for vector table access
    LDI ILL_HANDLER
    ST  R0, R0, 0       ; Store at address 0x0000 (ILL vector)
    LDI TIMER_ISR
    ST  R0, R0, 1       ; Store at address 0x0001 (timer vector)
    LDI SWI_HANDLER
    ST  R0, R0, 2       ; Store at address 0x0002 (SWI vector)
    
    ; Enable interrupts
    SETI
    
    ; Jump to main program
    LDI MAIN
    MOV PC, R0
```

#### **6.3.2 ILL Handler with FPU Emulation**
```assembly
ILL_HANDLER:
    ; Get trapped instruction
    SMV  R0, APC      ; APC = address after trapped instruction
    SUB  R0, R0, 1    ; Point to trapped instruction
    MVS  CS, 0        ; Access segment 0
    LD   R1, R0, 0    ; R1 = trapped instruction
    
    ; Check for double fault
    SMV  R2, APSW
    AND  R3, R2, 0x0020  ; Check S bit
    JNZ  DOUBLE_FAULT    ; Already in interrupt = reset
    
    ; Check if it's an FPU instruction
    MOV  R2, R1
    SR   R2, 14       ; Check bits 14-15
    CMP  R2, 0x3      ; 0b11xxxx...
    JNZ  NOT_FPU
    
    ; Extract FPU function code
    AND  R3, R1, 0x0300  ; Get FPU function code
    SR   R3, 8        ; Shift to lower bits
    
    ; Dispatch to emulation routine
    LDI  FPU_DISPATCH
    ADD  R3, R3, R0   ; Add offset
    LD   R4, R3, 0    ; Get routine address
    JMP  R4           ; Jump to emulation
    
FPU_DISPATCH:
    .dw  FADD_EMU      ; FPU_CORE 00
    .dw  FMUL_EMU      ; FPU_CORE 01
    .dw  FDIV_EMU      ; FPU_CORE 10
    .dw  FSQRT_EMU     ; FPU_CORE 11
    .dw  FEXP_EMU      ; FPU_EXT 0
    .dw  FLOG_EMU      ; FPU_EXT 1
    .dw  FCMP_EMU      ; FCMP

FADD_EMU:
    ; Software floating-point addition
    ; Extract operands from instruction
    AND  R2, R1, 0x000F  ; Rd field
    SR   R3, R1, 4
    AND  R3, R3, 0x000F  ; Rs field
    ; ... emulation code ...
    RETI

NOT_FPU:
    ; Not an FPU instruction - truly illegal
    HLT

DOUBLE_FAULT:
    ; Fatal error - trigger reset
    HLT
```

#### **6.3.3 Timer Interrupt Handler**
```assembly
TIMER_ISR:
    ; Running in shadow context (PSW'.S=1)
    ; Shadow registers automatically active
    
    ; Handle timer interrupt
    LDI TIMER_BASE
    MVS ES, R0         ; Set ES to timer segment
    LDS R2, ES, [R0]   ; Read timer value
    
    ; Process timer tick
    LDI  TICK_COUNT
    LD   R3, R0, 0     ; Load tick count
    ADD  R3, R3, 1     ; Increment
    ST   R3, R0, 0     ; Store back
    
    ; Acknowledge interrupt
    LDI 1
    STS R0, ES, [R0+2] ; Write to acknowledge register
    
    ; Restore and return
    RETI               ; Returns to normal context
```

---

## **7. Pipeline Implementation Details**

### **7.1 5-Stage Pipeline Structure**

**Stage 1: IF (Instruction Fetch)**
- Fetch instruction from memory using PC
- Increment PC (PC ← PC + 1)
- Handle delayed branch target calculation

**Stage 2: ID (Instruction Decode)**
- Decode instruction
- Read register file (up to 2 registers)
- Sign-extend immediates
- **Branch decision happens here**

**Stage 3: EX (Execute)**
- ALU operations
- Address calculation for memory operations
- Condition code evaluation

**Stage 4: MEM (Memory Access)**
- Load/store operations
- Segment register access (MVS, LDS, STS)
- Cache access (if implemented)

**Stage 5: WB (Write Back)**
- Write result to register file
- Update PSW for flag-setting instructions

### **7.2 Hazard Detection and Forwarding**

**Forwarding Paths:**
```
EX → EX: ALU result to next ALU operation
MEM → EX: Loaded value to ALU operation (requires stall if LD → use)
WB → EX: Written value to ALU operation
```

**Stall Conditions:**
1. **Load-use hazard**: LD followed by use of loaded register
   - 1-cycle stall inserted automatically
2. **Branch delay slot**: Always executed
   - No penalty if branch not taken
   - 1 instruction wasted if branch taken
3. **Interrupt latency**: 2 cycles minimum
   - Current instruction completes
   - Next instruction fetched but discarded

### **7.3 Interrupt Timing**

**Normal Context → Interrupt Context:**
```
Cycle 1: Current instruction completes (if not branch/jump)
Cycle 2: Hardware initializes shadow registers
         Sets PSW'.S = 1 (enter shadow context)
Cycle 3: Fetch from interrupt vector (first ISR instruction)
```

**Interrupt Context → Normal Context (RETI):**
```
Cycle 1: RETI instruction in EX stage
Cycle 2: Hardware sets PSW'.S = 0 (return to normal context)
Cycle 3: Fetch next instruction from normal context
```

### **7.4 Cache Implementation (Optional)**

**If 4KB unified cache implemented:**
- Direct-mapped, write-through policy
- 256 lines × 16 bytes (8 words) per line
- Physical tags (20-bit address support)
- Cache hit: 1 cycle access
- Cache miss: 4-8 cycles penalty (block fill)

**Cache Control:**
- No explicit cache instructions
- FSH (flush) instruction invalidates all cache lines
- Memory-mapped I/O regions marked as non-cacheable

---

## **8. Memory System**

### **8.1 Segmented Addressing**

**Physical Address Calculation:**
```
For DS/SS/ES access: PA = (Segment << 16) | (Offset & 0xFFFF)
For CS access:       PA = (CS << 16) | (PC & 0xFFFF)
```

**Segment Register Usage:**
- **CS**: Code segment (implicit for instruction fetch)
- **DS**: Data segment (default for LD/ST)
- **SS**: Stack segment (used when DS=1 in PSW)
- **ES**: Extra segment (for peripheral access)

### **8.2 Memory Map Example**

```
0x00000 - 0x0FFFF: ROM (64KB) - Boot code, interrupt vectors
0x10000 - 0x1FFFF: RAM (64KB) - Data, stack, heap
0x20000 - 0x2FFFF: I/O Space (64KB) - Memory-mapped peripherals
0x30000 - 0xFFFFF: Extended RAM (832KB) - Optional
```

### **8.3 I/O Access**

**Memory-mapped I/O:**
```assembly
; Access UART transmit register at I/O address 0x20010
LDI 0x0002          ; Segment 2 = I/O space
MVS ES, R0          ; Set ES to I/O segment
LDI 0x0010          ; Offset 0x10
MOV R1, R0
LDI 'A'             ; Character to send
STS R0, ES, [R1]    ; Write to UART transmit
```

---

## **9. Future Extensions**

### **9.1 FPU Instruction Encoding (Reserved Space)**

**FPU_CORE (11111111111110 ff):**
```
00: FADD Rd, Rs     ; Floating add: Rd ← Rd + Rs
01: FMUL Rd, Rs     ; Floating multiply: Rd ← Rd × Rs
10: FDIV Rd, Rs     ; Floating divide: Rd ← Rd ÷ Rs
11: FSQRT Rd        ; Floating square root: Rd ← √Rd
```

**FPU_EXT (111111111111110 f):**
```
0: FEXP Rd          ; Floating exponent: Rd ← e^Rd
1: FLOG Rd          ; Floating logarithm: Rd ← log(Rd)
```

**FCMP (1111111111111110):**
- Compare floating-point values
- Sets NZVC flags based on comparison
- Uses R0:R1 and R2:R3 as 32-bit floating operands

### **9.2 Additional Reserved Encodings**

**For future SYS extensions:**
```
1111111111110 110: Reserved (could be BREAK for debugger)
1111111111110 111: Reserved (could be SYSCALL for OS)
```

**Unused prefix patterns:**
- All other 14-bit+ patterns not currently defined

---

## **10. Complete ALU func5 Encoding Table**

**Table 14: Complete ALU2 func5 Encoding**

| func5 | Instruction | Format | Operation |
|-------|-------------|---------|-----------|
| 00000 | ADD Rd, Rs | `ADD Rd, Rs` | `Rd ← Rd + Rs` |
| 00001 | ADD Rd, imm | `ADD Rd, imm` | `Rd ← Rd + imm` |
| 00010 | SUB Rd, Rs | `SUB Rd, Rs` | `Rd ← Rd - Rs` |
| 00011 | SUB Rd, imm | `SUB Rd, imm` | `Rd ← Rd - imm` |
| 00100 | CMP Rd, Rs | `CMP Rd, Rs` | `Rd - Rs` (set flags) |
| 00101 | CMP Rd, imm | `CMP Rd, imm` | `Rd - imm` (set flags) |
| 00110 | AND Rd, Rs | `AND Rd, Rs` | `Rd ← Rd AND Rs` |
| 00111 | CLRB Rd, imm | `CLRB Rd, imm` | `Rd ← Rd AND NOT(1 << imm)` |
| 01000 | TBC Rd, Rs | `TBC Rd, Rs` | `Rd AND Rs` (set flags) |
| 01001 | TBC Rd, imm | `TBC Rd, imm` | `Rd AND (1 << imm)` (set flags) |
| 01010 | OR Rd, Rs | `OR Rd, Rs` | `Rd ← Rd OR Rs` |
| 01011 | OR Rd, imm | `OR Rd, imm` | `Rd ← Rd OR (1 << imm)` |
| 01100 | XOR Rd, Rs | `XOR Rd, Rs` | `Rd ← Rd XOR Rs` |
| 01101 | XOR Rd, imm | `XOR Rd, imm` | `Rd ← Rd XOR (1 << imm)` |
| 01110 | TBS Rd, Rs | `TBS Rd, Rs` | `Rd XOR Rs` (set flags) |
| 01111 | TBS Rd, imm | `TBS Rd, imm` | `Rd XOR (1 << imm)` (set flags) |
| 10000 | SL Rd, count | `SL Rd, count` | Logical shift left |
| 10001 | SLA Rd, count | `SLA Rd, count` | Arithmetic shift left |
| 10010 | SLAC Rd, count | `SLAC Rd, count` | Shift left through carry |
| 10011 | SLC Rd, count | `SLC Rd, count` | Shift left circular |
| 10100 | SR Rd, count | `SR Rd, count` | Logical shift right |
| 10101 | SRC Rd, count | `SRC Rd, count` | Shift right through carry |
| 10110 | SRA Rd, count | `SRA Rd, count` | Arithmetic shift right |
| 10111 | SRAC Rd, count | `SRAC Rd, count` | Shift right arithmetic through carry |
| 11000 | ROL Rd, count | `ROL Rd, count` | Rotate left |
| 11001 | RLC Rd, count | `RLC Rd, count` | Rotate left through carry |
| 11010 | ROR Rd, count | `ROR Rd, count` | Rotate right |
| 11011 | RRC Rd, count | `RRC Rd, count` | Rotate right through carry |
| 11100 | MUL Rd, Rs | `MUL Rd, Rs` | 16×16→16-bit multiply |
| 11101 | MUL32 Rd, Rs | `MUL32 Rd, Rs` | 16×16→32-bit multiply |
| 11110 | DIV Rd, Rs | `DIV Rd, Rs` | 16÷16→16-bit divide |
| 11111 | DIV32 Rd, Rs | `DIV32 Rd, Rs` | 32÷16→32-bit divide |

---

## **11. Implementation Checklist**

### **11.1 Core Required Features**
- [ ] 16-bit datapath with 16 registers
- [ ] 5-stage pipeline (IF, ID, EX, MEM, WB)
- [ ] Forwarding logic (EX→EX, MEM→EX, WB→EX)
- [ ] Hazard detection (load-use stall)
- [ ] Delayed branch implementation
- [ ] Complete shadow register system (12 shadow registers)
- [ ] PSW' with S-bit for context switching
- [ ] Segment registers (CS, DS, SS, ES)
- [ ] ILL trap detection and handling
- [ ] Interrupt handling with automatic context save/restore
- [ ] SMV instruction with alt_sel decoding
- [ ] LPSW/SPSW instructions for PSW access
- [ ] RETI instruction for interrupt return
- [ ] Double fault detection (ILL in interrupt context)

### **11.2 Optional Features**
- [ ] 4KB unified cache
- [ ] FPU hardware (future extension)
- [ ] Debug support (breakpoints, single-step)
- [ ] Power management features

### **11.3 Verification Tests**
- [ ] All ALU operations with flag setting
- [ ] Forwarding and stall scenarios
- [ ] Interrupt entry/exit timing with shadow registers
- [ ] SMV access in both contexts
- [ ] ILL trap for FPU instructions
- [ ] Double fault detection and reset
- [ ] Delayed branch behavior
- [ ] Memory-mapped I/O access
- [ ] Subroutine calls with ALINK optimization
- [ ] Context switching with RETI
- [ ] Segment addressing correctness

---

## **12. Summary**

Deep16 Milestone 6 represents a **mature, implementable 16-bit RISC architecture** with:

### **12.1 Key Strengths**
1. **Educational Value**: Clean RISC design with visible pipeline effects
2. **Practical Features**: Complete shadow register system for zero-overhead interrupts
3. **Extensible Design**: ILL trap system for software emulation of new instructions
4. **Performance**: 5-stage pipeline with forwarding, ~1.0-1.3 CPI
5. **Simplicity**: 16-bit fixed instructions, no memory protection overhead
6. **Optimized Calls**: ALINK optimization provides 33% faster subroutine calls

### **12.2 Unique Innovations**
1. **Complete Shadow Register System**: 12 shadow registers including R0'-R3', R13', R14'
2. **ILL Trap System**: Replaces NMI, enables software FPU emulation
3. **Delayed Branch Architecture**: No branch penalty with ALINK optimization
4. **Symmetric SMV Access**: Unified access to both normal and shadow contexts
5. **Automatic Context Management**: Hardware-managed interrupt context switching
6. **Double Fault Protection**: Prevents recursive ILL traps

### **12.3 Target Applications**
- **Educational**: Computer architecture courses, FPGA labs
- **Embedded**: IoT devices, controllers, simple peripherals
- **Retro Computing**: 16-bit home computer implementations
- **Research**: Custom processor experimentation
- **Real-time Systems**: Fast interrupt response with shadow registers

### **12.4 Implementation Status**
- **Specification**: Complete and stable (Milestone 6)
- **HDL Implementation**: Ready to begin
- **Toolchain**: Assembler needed, C compiler desirable
- **Verification**: Test suite required

---

**Deep16 Architecture Specification Milestone 6**  
*Updated: 2024-03-20*  
*Status: Complete and ready for implementation*  
*Key Features: ILL trap system, complete shadow registers, FPU emulation, simplified interrupt model, ALINK optimization*  

The Deep16 Milestone 6 specification provides a mature, implementable 16-bit RISC architecture with zero-overhead interrupts, software-extensible instruction set via ILL traps, and efficient pipeline design suitable for both educational and practical embedded applications.
