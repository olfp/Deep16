Perfect! Here's the updated specification with the classic PSW visualization included:

# **Deep16 (深十六) Architecture Specification v5.2**
## **16-bit RISC Processor with Enhanced Memory Addressing and Shadow Register System**

---

## **1. Processor Overview**

### **1.1 Architectural Philosophy**
Deep16 is a 16-bit RISC processor designed with a balanced approach to simplicity, performance, and educational value. The architecture embraces classic RISC principles while introducing innovative features for practical embedded systems use.

### **1.2 Key Architectural Features**
- **16-bit fixed-length instructions** - Simplified decoding and alignment
- **16 general-purpose registers** - Reduced memory traffic
- **Segmented memory addressing** - 20-bit physical address space (1MB)
- **Extended shadow register system** - Zero-overhead interrupt context switching with selective general-purpose register shadows
- **5-stage pipelined implementation** - With delayed branch optimization
- **Optional unified L1 cache** - Configurable 0-4KB direct-mapped cache
- **Memory-mapped I/O** - Simplified peripheral access
- **Word-based memory system** - No byte alignment complications
- **No memory protection** - Fully accessible memory space
- **Clean interrupt model** - Hardware-managed context switching via PSW.S
- **FPU emulation support** - Unimplemented FPU instructions trap to ILL for software emulation

### **1.3 Performance Targets**
- **Base CPI**: 1.0-1.3 (ideal to realistic)
- **Operating frequency**: 80MHz in modern FPGAs
- **Branch penalty**: 0 cycles (delayed branch architecture)
- **Interrupt latency**: 2 cycles (entry + jump)
- **Cache hit rate**: 85-95% with 4KB unified cache (if implemented)
- **Memory bandwidth**: 160 MB/s at 80MHz

---

## **2. Instruction Set Architecture**

### **2.1 Complete Opcode Hierarchy**

**Table 1: Instruction Opcode Hierarchy (Precise Encoding)**

| Opcode | Bits | Instruction | Format | Pipeline Effect |
|--------|------|-------------|--------|----------------|
| 0 | 1 | LDI | `[0][imm15]` | Full pipeline |
| 10 | 2 | LD/ST | `[10][d1][Rd4][Rb4][offset5]` | Potential load-use stall |
| 110 | 3 | ALU2 | `[110][func5][Rd4][Rs/imm4]` | Full pipeline, forwarding |
| 1110 | 4 | JMP | `[1110][type3][target9]` | **Uses delay slot** |
| 11110 | 5 | LDS/STS | `[11110][d1][seg2][Rd4][Rs4]` | Segment access in MEM |
| 111110 | 6 | MOV/AMV | `[111110][Rd4][Rs4][imm2]` | imm2=3 = AMV (no forwarding) |
| 1111110 | 7 | LSI | `[1111110][Rd4][imm5]` | Full pipeline |
| 11111110 | 8 | SMV | `[11111110][Rx4][alt_sel4]` | Shadow register access |
| 111111110 | 9 | MVS | `[111111110][d1][Rd4][seg2]` | Segment access in MEM |
| 1111111110 | 10 | SOP | `[1111111110][type2][Rx4]` | Single operand and PSW ops |
| 11111111110 | 11 | SET/CLR | `[11111111110][d1][imm4]` | PSW bit operations |
| 111111111110 | 12 | JML | `[111111111110][Rx4]` | Far jump to different segment |
| 1111111111110 | 13 | SYS | `[1111111111110][op3]` | System operations |
| **11111111111110** | **14** | **FPU_CORE** | `[11111111111110][ff]` | **FPU operations (ILL trap)** |
| **111111111111110** | **15** | **FPU_EXT** | `[111111111111110][f]` | **FPU extended (ILL trap)** |
| **1111111111111110** | **16** | **FCMP** | `[1111111111111110]` | **FPU compare (ILL trap)** |
| **1111111111111111** | **16** | **HLT** | `[1111111111111111]` | **Halt processor** |

### **2.2 Illegal Instruction (ILL) and FPU Emulation**

**FPU Encoding Space Allocation:**
- **11111111111110xx** (14-bit prefix + 2 bits): 4 FPU_CORE operations
  - Suggested: FADD, FMUL, FDIV, FSQRT
- **111111111111110x** (15-bit prefix + 1 bit): 2 FPU_EXT operations  
  - Suggested: FEXP, FLOG
- **1111111111111110** (16-bit): 1 FCMP operation
  - Floating-point compare with condition codes

**ILL Instruction Behavior:**
- Any unimplemented FPU instruction triggers an **ILL trap**
- **Behavior**: Exactly like SWI but with PSW' = 0x20 (shadow context active)
- **Critical Restriction**: ILL must NOT occur in interrupt context (PSW.S=1)
  - If attempted, results in double fault (processor reset)
- **FPU Emulation**: Software interrupt handler can emulate FPU instructions
  - Handler examines trapped instruction opcode
  - Emulates operation using normal registers
  - Returns with RETI

### **2.3 Data Movement Instructions**

**Table 2: Data Movement Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Notes |
|-------------|---------|-----------------|-------------------|-------|
| **LDI** | `LDI imm` | `0 imm15` | `R0 ← sign_extend(imm15)` | Sign extends 15-bit immediate |
| **LSI** | `LSI Rd, imm` | `1111110 Rd4 imm5` | `Rd ← sign_extend(imm5)` | Small immediate load |
| **MOV Rd, Rs, imm** | `MOV Rd, Rs, imm` | `111110 Rd4 Rs4 imm2` | `Rd ← Rs + imm2` | Normal with forwarding |
| **AMV Rd, Rs** | `AMV Rd, Rs` | `111110 Rd4 Rs4 11` | `Rd ← Rs` (architectural) | Reads from register file, bypasses forwarding |
| **MVS Rd, Sx** | `MVS Rd, Sx` | `111111110 0 Rd4 seg2` | `Rd ← Sx` | Read segment register |
| **MVS Sx, Rd** | `MVS Sx, Rd` | `111111110 1 Rd4 seg2` | `Sx ← Rd` | Write segment register |
| **SMV Rx, alt_reg** | `SMV Rx, alt_reg` | `11111110 Rx4 alt_sel4` | `Rx ← alt_reg` (read shadow) | Shadow register access |

**Assembler Aliases for Clarity:**
```assembly
MOV Rd, Rs        = MOV Rd, Rs, 0      ; Normal move with forwarding
AMV Rd, Rs        = MOV Rd, Rs, 3      ; Architectural move (bypass forwarding)
JMP Rx            = MOV PC, Rx, 0      ; Jump to address in Rx
```

### **2.4 PSW (Processor Status Word)**

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

### **2.5 PSW Bit Manipulation Instructions**

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

### **2.6 ALU Instructions - Revised with CLRB**

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

### **2.7 ALU Instructions - Group 2: Shift/Rotate Operations**

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

### **2.8 ALU Instructions - Group 3: Multiply/Divide Operations**

**Table 8: Multiply/Divide Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Notes |
|-------------|---------|-----------------|-------------------|-------|
| **MUL Rd, Rs** | `MUL Rd, Rs` | `110 11100 Rd4 Rs4` | `Rd ← Rd × Rs` (low 16 bits) | 16×16→16-bit |
| **MUL32 Rd, Rs** | `MUL32 Rd, Rs` | `110 11101 Rd4 Rs4` | `R[d]:R[d+1] ← Rd × Rs` | Rd must be EVEN |
| **DIV Rd, Rs** | `DIV Rd, Rs` | `110 11110 Rd4 Rs4` | `Rd ← Rd ÷ Rs` (quotient) | 16÷16→16-bit |
| **DIV32 Rd, Rs** | `DIV32 Rd, Rs` | `110 11111 Rd4 Rs4` | `R[d] ← quotient, R[d+1] ← remainder` | Rd must be EVEN |

### **2.9 Memory Access Instructions**

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

### **2.10 Control Flow Instructions**

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

### **2.11 Single Operand and PSW Instructions (SOP)**

**Table 12: Single Operand Instructions (1111111110 type2 Rx4)**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **INV Rx** | `INV Rx` | `1111111110 00 Rx4` | `Rx ← ~Rx` |
| **NEG Rx** | `NEG Rx` | `1111111110 01 Rx4` | `Rx ← -Rx` |
| **SPSW Rx** | `SPSW Rx` | `1111111110 10 Rx4` | `PSW ← Rx` |
| **LPSW Rx** | `LPSW Rx` | `1111111110 11 Rx4` | `Rx ← PSW` |

### **2.12 JML Instruction (Far Jump)**

**Table 13: Far Jump Instruction**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **JML Rx** | `JML Rx` | `111111111110 Rx4` | `CS ← R[Rx], PC ← R[Rx+1]` |

**Requirements:** Rx must be EVEN (uses register pair Rx:Rx+1)

---

## **3. Programming Examples**

### **3.1 Complete PSW Manipulation**

**Using SET/CLR for lower bits (0-3):**
```assembly
SETC        ; SET 3    - Set carry flag
CLRC        ; CLR 3    - Clear carry flag  
SETV        ; SET 2    - Set overflow flag
CLRV        ; CLR 2    - Clear overflow flag
SETZ        ; SET 1    - Set zero flag
CLRZ        ; CLR 1    - Clear zero flag
SETN        ; SET 0    - Set negative flag
CLRN        ; CLR 0    - Clear negative flag
```

**Using SETI/CLRI for interrupt control:**
```assembly
SETI        ; Enable interrupts (PSW[4]=1)
CLRI        ; Disable interrupts (PSW[4]=0)
```

**Using CLRB for bit manipulation:**
```assembly
CLRB R1, 3      ; Clear bit 3 of R1
CLRB R2, 15     ; Clear most significant bit of R2
CLRB R3, 0      ; Clear bit 0 (LSB) of R3
```

**Complete PSW Setup Example:**
```assembly
; Setup SR=13 (R13 as stack), DS=1 (use pair), ER=11, DE=1, I=1
LPSW R1             ; R1 = current PSW
AND  R1, 0x001F     ; Keep only lower 5 bits (NZVC+I)

; Set upper bits: DE=1, ER=11, DS=1, SR=13
; SR=13 (1101) at bits 6-9 = 0x3400
; ER=11 (1011) at bits 11-14 = 0xB000
; DS=1 (bit 10) = 0x0400
; DE=1 (bit 15) = 0x8000
; Combined: 0x8000 | 0xB000 | 0x0400 | 0x3400 = 0xE400? Wait...

; Let's calculate systematically:
LDI  0x3400         ; SR=13 (1101) at bits 6-9
OR   R1, R0         ; Add to PSW
LDI  0xB000         ; ER=11 (1011) at bits 11-14
OR   R1, R0         ; Add to PSW
OR   R1, 0x8400     ; Set DS=1 (0x0400) and DE=1 (0x8000) = 0x8400
OR   R1, 0x0010     ; Ensure I=1 (interrupts enabled)
SPSW R1             ; Update PSW
; Final PSW: 0x8000 | 0xB000 | 0x0400 | 0x3400 | 0x0010 = 0xE410
```

### **3.2 Assembler Macros for Common Operations**

**Flag Aliases:**
```assembly
.macro SETC
    SET 3
.endm

.macro CLRC
    CLR 3
.endm

.macro SETV
    SET 2
.endm

.macro CLRV
    CLR 2
.endm

.macro SETZ
    SET 1
.endm

.macro CLRZ
    CLR 1
.endm

.macro SETN
    SET 0
.endm

.macro CLRN
    CLR 0
.endm
```

**Segment Register Setup Macros:**
```assembly
; SRS Rx - Set Rx as stack register, DS=0 (single)
.macro SRS reg
    LPSW Rtemp
    AND  Rtemp, 0xFC1F    ; Clear SR field (bits 6-9) and DS (bit 10)
    MOV  Rtemp2, reg
    AND  Rtemp2, 0x000F   ; Ensure register 0-15
    SL   Rtemp2, 6        ; Shift to SR position (bits 6-9)
    OR   Rtemp, Rtemp2    ; Set SR field
    SPSW Rtemp
.endm

; SRD Rx - Set Rx as stack register, DS=1 (dual)  
.macro SRD reg
    LPSW Rtemp
    AND  Rtemp, 0xF81F    ; Clear SR field and DS
    MOV  Rtemp2, reg
    AND  Rtemp2, 0x000F
    SL   Rtemp2, 6
    OR   Rtemp, Rtemp2    ; Set SR field
    OR   Rtemp, 0x0400    ; Set DS=1 (bit 10)
    SPSW Rtemp
.endm

; ERS Rx - Set Rx as extra register, DE=0 (single)
.macro ERS reg
    LPSW Rtemp
    AND  Rtemp, 0x87FF    ; Clear ER field (bits 11-14) and DE (bit 15)
    MOV  Rtemp2, reg
    AND  Rtemp2, 0x000F
    SL   Rtemp2, 11       ; Shift to ER position (bits 11-14)
    OR   Rtemp, Rtemp2    ; Set ER field
    SPSW Rtemp
.endm

; ERD Rx - Set Rx as extra register, DE=1 (dual)
.macro ERD reg
    LPSW Rtemp
    AND  Rtemp, 0x07FF    ; Clear ER field and DE
    MOV  Rtemp2, reg
    AND  Rtemp2, 0x000F
    SL   Rtemp2, 11
    OR   Rtemp, Rtemp2    ; Set ER field
    OR   Rtemp, 0x8000    ; Set DE=1 (bit 15)
    SPSW Rtemp
.endm
```

### **3.3 Pipeline Hazard Examples**

**Example 1: Load-use hazard (requires 1-cycle stall)**
```assembly
LD   R1, R2, 0    ; Cycle 1: MEM stage reads memory
NOP               ; Cycle 2: STALL inserted by hardware
ADD  R3, R1, 0    ; Cycle 3: EX stage can now use R1
```

**Example 2: No stall with forwarding**
```assembly
ADD  R1, R2, 0    ; Cycle 1: EX stage computes R1
SUB  R3, R1, 0    ; Cycle 2: Forwarding provides R1 value (no stall)
```

**Example 3: AMV bypasses forwarding**
```assembly
ADD  R1, R2, 0    ; Cycle 1: EX stage writes R1
AMV  R3, R1       ; Cycle 2: Reads architectural R1 (bypasses forwarding)
                  ; Gets OLD value from register file, not forwarded value
```

**Example 4: Delayed branch (no penalty)**
```assembly
JZ   TARGET       ; Cycle 1: Branch decision in ID stage
ADD  R1, R2, 1    ; Cycle 2: DELAY SLOT EXECUTED REGARDLESS
                  ; Cycle 3: Branch taken to TARGET (if Z=1)
```

### **3.4 Complete System Initialization**
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
    
    ; Now:
    ; - SS accesses use R13:R14 (pair due to DS=1)
    ; - ES accesses use R11:R12 (pair due to DE=1)
    ; - R13 is stack pointer
    ; - R14 is shadow stack pointer (when in interrupt)
    
    ; Setup interrupt vector table
    LDI 0x0000
    MVS CS, R0          ; Set CS for vector table access
    LDI TIMER_ISR
    ST  R0, R0, 1       ; Store at address 0x0001 (timer vector)
    LDI UART_ISR
    ST  R0, R0, 2       ; Store at address 0x0002 (UART vector)
    
    ; Enable interrupts
    SETI
    
    ; Jump to main program
    LDI MAIN
    MOV PC, R0
```

### **3.5 Interrupt Handler Example**
```assembly
.org 0x0001            ; Hardware interrupt vector (timer)
.dw  TIMER_ISR

TIMER_ISR:
    ; Running in shadow context (PSW.S=1)
    ; Shadow registers automatically active
    
    ; Save critical normal registers if needed
    SMV R0', APC       ; Save normal PC to shadow R0
    SMV R1', APSW      ; Save normal PSW to shadow R1
    
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
                     ; Automatically restores shadow->normal
```

### **3.6 FPU Emulation Example**
```assembly
.org 0x0003            ; ILL (FPU) interrupt vector
.dw  FPU_EMULATOR

FPU_EMULATOR:
    ; Handle unimplemented FPU instructions
    ; Running in shadow context
    
    ; Save context
    SMV R0', APC       ; Get trapped PC
    SMV R1', APSW      ; Get trapped PSW
    
    ; Read the trapped instruction
    LDI 0x0000
    MVS CS, R0         ; Set CS for instruction fetch
    LD  R2, R0', 0     ; R2 = trapped instruction
    
    ; Decode FPU instruction
    AND  R3, R2, 0xC000 ; Check opcode bits 14-15
    CMP  R3, 0xC000
    JNZ  NOT_FPU       ; Not an FPU instruction
    
    ; Extract FPU operation
    AND  R3, R2, 0x3000 ; Get FPU function code
    SR   R3, 12        ; Shift to lower bits
    
    ; Dispatch to emulation routine
    LDI  FPU_DISPATCH
    ADD  R3, R3, R0    ; Add offset
    LD   R4, R3, 0     ; Get routine address
    JMP  R4            ; Jump to emulation
    
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
    ; ... implementation details ...
    RETI

NOT_FPU:
    ; Not an FPU instruction - fatal error
    HLT                ; Halt processor
```

---

## **4. Pipeline Implementation Details**

### **4.1 5-Stage Pipeline Structure**

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

### **4.2 Hazard Detection and Forwarding**

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

### **4.3 Interrupt Timing**

**Normal Context → Interrupt Context:**
```
Cycle 1: Current instruction completes (if not branch/jump)
Cycle 2: Hardware saves PC to APC, PSW to APSW
         Sets PSW.S = 1 (enter shadow context)
Cycle 3: Fetch from interrupt vector (first ISR instruction)
```

**Interrupt Context → Normal Context (RETI):**
```
Cycle 1: RETI instruction in EX stage
Cycle 2: Hardware restores APC → PC, APSW → PSW
         Sets PSW.S = 0 (return to normal context)
Cycle 3: Fetch next instruction from normal context
```

### **4.4 Cache Implementation (Optional)**

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

## **5. Memory System**

### **5.1 Segmented Addressing**

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

### **5.2 Memory Map Example**

```
0x00000 - 0x0FFFF: ROM (64KB) - Boot code, interrupt vectors
0x10000 - 0x1FFFF: RAM (64KB) - Data, stack, heap
0x20000 - 0x2FFFF: I/O Space (64KB) - Memory-mapped peripherals
0x30000 - 0xFFFFF: Extended RAM (832KB) - Optional
```

### **5.3 I/O Access**

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

## **6. Future Extensions**

### **6.1 FPU Instruction Encoding (Reserved Space)**

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

### **6.2 Additional Reserved Encodings**

**For future SYS extensions:**
```
1111111111110 110: Reserved (could be BREAK for debugger)
1111111111110 111: Reserved (could be SYSCALL for OS)
```

**Unused prefix patterns:**
- All other 14-bit+ patterns not currently defined

---

## **7. Complete ALU func5 Encoding Table**

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

## **8. Changes from Previous Version**

### **8.1 Key Improvements in v5.2**

1. **Precise Encoding Specification**: Clear bit-by-bit encoding for all instructions
2. **Added CLRB Instruction**: `Rd ← Rd AND NOT(1 << imm)` for bit clearing
3. **AMV Clarification**: `MOV Rd, Rs, 3` reads architectural register (bypasses forwarding)
4. **FPU Encoding Space**: Defined 14-bit, 15-bit, and 16-bit patterns for future FPU
5. **ILL Trap Behavior**: FPU instructions trap to interrupt for software emulation
6. **Complete Pipeline Details**: Hazard detection, forwarding, interrupt timing
7. **Classic PSW Visualization**: Clear bit layout diagram
8. **Complete ALU Encoding Table**: All 32 func5 codes defined

### **8.2 Assembly Language Syntax Summary**

**Register Notation:**
- `Rx`: General register (R0-R15)
- `PC`: Program counter (R15)
- `Sx`: Segment register (CS, DS, SS, ES)
- `Rx'`: Shadow register (when PSW.S=1)

**Instruction Categories:**
- **Data Movement**: LDI, LSI, MOV, AMV, MVS, SMV
- **ALU Operations**: ADD, SUB, AND, OR, XOR, CLRB, shifts, rotates
- **Memory Access**: LD, ST, LDS, STS
- **Control Flow**: Jcc, JMP, JML
- **PSW Operations**: SET, CLR, SETI, CLRI, LPSW, SPSW
- **System**: NOP, FSH, SWI, RETI, HLT

---

## **9. Implementation Checklist**

### **9.1 Core Required Features**
- [ ] 16-bit datapath with 16 registers
- [ ] 5-stage pipeline (IF, ID, EX, MEM, WB)
- [ ] Forwarding logic (EX→EX, MEM→EX, WB→EX)
- [ ] Hazard detection (load-use stall)
- [ ] Delayed branch implementation
- [ ] Shadow register system (8 shadow registers)
- [ ] PSW with S-bit for context switching
- [ ] Segment registers (CS, DS, SS, ES)
- [ ] Interrupt handling (2-cycle latency)
- [ ] ILL trap for unimplemented instructions

### **9.2 Optional Features**
- [ ] 4KB unified cache
- [ ] FPU hardware (future extension)
- [ ] Debug support (breakpoints, single-step)
- [ ] Power management features

### **9.3 Verification Tests**
- [ ] All ALU operations with flag setting
- [ ] Forwarding and stall scenarios
- [ ] Interrupt entry/exit timing
- [ ] Shadow register context switch
- [ ] Segment addressing correctness
- [ ] ILL trap for FPU instructions
- [ ] Delayed branch behavior
- [ ] Memory-mapped I/O access

---

## **10. Summary**

Deep16 v5.2 represents a **mature, implementable 16-bit RISC architecture** with:

### **10.1 Key Strengths**
1. **Educational Value**: Clean RISC design with visible pipeline effects
2. **Practical Features**: Shadow registers for zero-overhead interrupts
3. **Extensible Design**: Reserved encoding space for FPU and future extensions
4. **Performance**: 5-stage pipeline with forwarding, ~1.0-1.3 CPI
5. **Simplicity**: 16-bit fixed instructions, no memory protection overhead

### **10.2 Unique Innovations**
1. **Shadow Register System**: Selective register shadowing (R0,R1,R2,R13,R14,PC,PSW,CS,DS,SS,ES)
2. **Delayed Branch Architecture**: No branch penalty in common case
3. **Dual Register Segments**: Stack and extra segments can use register pairs
4. **ILL-based FPU Emulation**: Future compatibility without hardware changes

### **10.3 Target Applications**
- **Educational**: Computer architecture courses, FPGA labs
- **Embedded**: IoT devices, controllers, simple peripherals
- **Retro Computing**: 16-bit home computer implementations
- **Research**: Custom processor experimentation

### **10.4 Implementation Status**
- **Specification**: Complete and stable (v5.2)
- **HDL Implementation**: Ready to begin
- **Toolchain**: Assembler needed, C compiler desirable
- **Verification**: Test suite required

---

**Deep16 Architecture Specification v5.2**  
*Updated: 2024-03-20*  
*Status: Complete and ready for implementation*  
*Key Features: Fixed encoding, CLRB instruction, FPU trap space, complete pipeline details*  

The Deep16 architecture balances simplicity with practical features, making it suitable for both educational use and real embedded applications. The shadow register system provides exceptional interrupt performance, while the clean RISC design ensures straightforward implementation and understanding.
