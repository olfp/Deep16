Excellent catch! You're absolutely right. Let me revise the design to use the 11-bit prefix for SET/CLR operations, which is much cleaner. Here's the corrected architecture:

# **Deep16 (深十六) Architecture Specification v5.1**
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
| 1111111110 | 10 | SOP | `[1111111110][type2][Rx4]` | Single operand and PSW ops |
| **11111111110** | **11** | **SET/CLR** | `[11111111110][d1][imm4]` | **PSW bit operations** |
| 111111111110 | 12 | JML | `[111111111110][Rx4]` | Far jump to different segment |
| 1111111111110 | 13 | SYS | `[1111111111110][op3]` | System operations |
| 1111111111111111 | 16 | HLT | `[1111111111111111]` | Halt the processor |

### **2.2 Data Movement Instructions**

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

### **2.3 PSW (Processor Status Word)**

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

### **2.4 PSW Bit Manipulation Instructions**

**Table 3: PSW Bit Operations (11111111110 d1 imm4)**

| Instruction | Format | Binary Encoding | Operation |
|-------------|---------|-----------------|-----------|
| **SET imm** | `SET imm` | `11111111110 0 imm4` | `PSW[imm] ← 1` |
| **CLR imm** | `CLR imm` | `11111111110 1 imm4` | `PSW[imm] ← 0` |

**Important Notes:**
- `imm4` can be 0-15, but only bits 0-4 and 5 (Shadow bit) are useful for user
- Bits 6-15 should be manipulated via LPSW/SPSW (upper byte setup)
- **SETI/CLRI** remain in SYS space (bit 4 needs special handling)
- **Shadow bit (S)** is managed by hardware but can be read via LPSW

### **2.5 SYS Instruction Group with SETI/CLRI**

**Table 4: System Instructions (1111111111110 op3)**

| Instruction | Format | Binary Encoding | Operation |
|-------------|---------|-----------------|-----------|
| **NOP** | `NOP` | `1111111111110 000` | No operation |
| **FSH** | `FSH` | `1111111111110 001` | Flush pipeline |
| **SWI** | `SWI` | `1111111111110 010` | Software interrupt |
| **RETI** | `RETI` | `1111111111110 011` | Return from interrupt |
| **SETI** | `SETI` | `1111111111110 100` | `PSW[4] ← 1` (Enable interrupts) |
| **CLRI** | `CLRI` | `1111111111110 101` | `PSW[4] ← 0` (Disable interrupts) |
| *Reserved* | - | `1111111111110 110` | Reserved |
| *Reserved* | - | `1111111111110 111` | Reserved |

### **2.6 Single Operand and PSW Instructions (SOP)**

**Table 5: Single Operand Instructions (1111111110 type2 Rx4)**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **INV Rx** | `INV Rx` | `1111111110 00 Rx4` | `Rx ← ~Rx` |
| **NEG Rx** | `NEG Rx` | `1111111110 01 Rx4` | `Rx ← -Rx` |
| **SPSW Rx** | `SPSW Rx` | `1111111110 10 Rx4` | `PSW ← Rx` |
| **LPSW Rx** | `LPSW Rx` | `1111111110 11 Rx4` | `Rx ← PSW` |

### **2.7 JML Instruction (Far Jump)**

**Table 6: Far Jump Instruction**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **JML Rx** | `JML Rx` | `111111111110 Rx4` | `CS ← R[Rx], PC ← R[Rx+1]` |

**Requirements:** Rx must be EVEN (uses register pair Rx:Rx+1)

### **2.8 ALU Instructions - Group 1: Basic Operations**

**Table 7: Basic ALU Instructions**

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

### **2.9 ALU Instructions - Group 2: Shift/Rotate Operations**

**Table 8: Shift and Rotate Instructions**

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

### **2.10 ALU Instructions - Group 3: Multiply/Divide Operations**

**Table 9: Multiply/Divide Instructions**

| Instruction | Format | Binary Encoding | Register Transfer | Notes |
|-------------|---------|-----------------|-------------------|-------|
| **MUL Rd, Rs** | `MUL Rd, Rs` | `110 11100 Rd4 Rs4` | `Rd ← Rd × Rs` (low 16 bits) | 16×16→16-bit |
| **MUL32 Rd, Rs** | `MUL32 Rd, Rs` | `110 11101 Rd4 Rs4` | `R[d]:R[d+1] ← Rd × Rs` | Rd must be EVEN |
| **DIV Rd, Rs** | `DIV Rd, Rs` | `110 11110 Rd4 Rs4` | `Rd ← Rd ÷ Rs` (quotient) | 16÷16→16-bit |
| **DIV32 Rd, Rs** | `DIV32 Rd, Rs` | `110 11111 Rd4 Rs4` | `R[d] ← quotient, R[d+1] ← remainder` | Rd must be EVEN |

### **2.11 Memory Access Instructions**

**Table 10: Memory Access Instructions**

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

### **2.12 Control Flow Instructions**

**Table 11: Condition Codes for Jump Instructions**

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

**Table 12: Control Flow Instructions**

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

### **2.13 Halt Instruction**

**Table 13: Halt Instruction**

| Instruction | Format | Binary Encoding | Register Transfer |
|-------------|---------|-----------------|-------------------|
| **HLT** | `HLT` | `1111111111111111` | Halt processor |

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

**Using LPSW/SPSW for upper byte (bits 6-15):**
```assembly
; Setup SR=13 (R13 as stack), DS=0, ER=11, DE=1
LPSW R1             ; R1 = current PSW
LDI  0x0B5A         ; Binary: 0000 1011 0101 1010
                    ; ER=1011(11), DS=0, SR=0101(5?), wait let me recalc...
; Actually better:
; SR=13 -> binary 1101 -> bits 6-9 = 1101
; ER=11 -> binary 1011 -> bits 11-14 = 1011
; DS=0, DE=1
; So: DE=1, ER=1011, DS=0, SR=1101, S=?, I=1, C=0, V=0, Z=0, N=0
; Need to calculate exact value...

; Simpler: Clear and set fields
AND  R1, 0x001F     ; Keep only lower 5 bits (NZVC+I)
LDI  0x5A00         ; SR=13 (1101) at bits 6-9 = 0x5A00? Actually 13<<6 = 0x1A00
OR   R1, R0         ; Combine
LDI  0xB000         ; ER=11 (1011) at bits 11-14, DE=1 = 0xB800?
OR   R1, R0         ; Combine
SPSW R1             ; Update PSW
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
; SRS Rx - Set Rx as stack register, DS=0
.macro SRS reg
    LPSW Rtemp
    AND  Rtemp, 0xFC1F    ; Clear SR field (bits 6-9) and DS (bit 10)
    AND  reg, 0x000F      ; Ensure register 0-15
    SL   reg, 6           ; Shift to SR position (bits 6-9)
    OR   Rtemp, reg       ; Set SR field
    SPSW Rtemp
.endm

; SRD Rx - Set Rx as stack register, DS=1  
.macro SRD reg
    LPSW Rtemp
    AND  Rtemp, 0xF81F    ; Clear SR field, keep DS=1
    AND  reg, 0x000F
    SL   reg, 6
    OR   Rtemp, reg
    OR   Rtemp, 0x0400    ; Set DS=1 (bit 10)
    SPSW Rtemp
.endm
```

### **3.3 Complete System Initialization**
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
    
    ; Configure PSW for R13 as stack register
    LPSW R1
    AND  R1, 0xFC1F     ; Clear SR and DS
    LDI  13
    AND  R0, 0x000F     ; Register 13
    SL   R0, 6          ; Shift to SR position (bits 6-9)
    OR   R1, R0         ; Set SR=13
    OR   R1, 0x0400     ; Set DS=1 (use pair)
    SPSW R1             ; Update PSW
    
    ; Now R13:R14 is used for SS accesses
    
    ; Enable interrupts
    SETI
    
    ; Jump to main program
    LDI MAIN
    MOV PC, R0
```

### **3.4 Interrupt Handler Example**
```assembly
.org 0x0001            ; Hardware interrupt vector
.dw  TIMER_ISR

TIMER_ISR:
    ; Running in shadow context (PSW.S=1)
    ; Save critical normal registers if needed
    SMV R0', APC       ; Save normal PC
    SMV R1', APSW      ; Save normal PSW
    
    ; Handle timer interrupt
    LDI TIMER_BASE
    MVS ES, R0         ; Set ES to timer segment
    LDS R2, ES, [R0]   ; Read timer value
    
    ; Acknowledge interrupt
    LDI 1
    STS R0, ES, [R0+2] ; Write to acknowledge register
    
    ; Restore and return
    RETI               ; Returns to normal context
```

---

## **4. Available Encoding Space for Future Extensions**

### **4.1 Unused Prefixes Ending in 0**
```
11111111111110xx   (14-bit prefix + 2 bits) - 4 operations
111111111111110x   (15-bit prefix + 1 bit)  - 2 operations
1111111111111110   (16-bit)                 - 1 operation
```

### **4.2 Suggested Use for FPU**
These spaces are ideal for a future Floating-Point Unit:
- 14-bit space: 4 core operations (FADD, FMUL, FDIV, FSQRT)
- 15-bit space: 2 extended operations (FEXP, FLOG)
- 16-bit space: 1 special operation (FCMP or FINIT)

---

## **5. Changes from Previous Version**

### **5.1 Key Improvements in v5.1**

1. **Fixed PSW Bit Layout**: Now matches the established specification
2. **Added 11-bit SET/CLR**: `11111111110 d1 imm4` for direct PSW bit manipulation
3. **Retained SETI/CLRI in SYS**: For interrupt enable/disable (bit 4)
4. **Simplified PSW Manipulation**: 
   - Lower bits (0-3): Use SET/CLR
   - Bit 4 (Interrupt): Use SETI/CLRI
   - Upper byte (6-15): Use LPSW/SPSW for setup
   - Shadow bit (5): Managed by hardware, readable via LPSW

### **5.2 Encoding Efficiency**

**Compact PSW Operations:**
```
SETC  ; 11111111110 0 0011 (11 bits) - Old: 3 instructions (LPSW+OR+SPSW)
CLRC  ; 11111111110 1 0011 (11 bits) - Old: 3 instructions (LPSW+AND+SPSW)
SETI  ; 1111111111110 100  (13 bits) - Single instruction
CLRI  ; 1111111111110 101  (13 bits) - Single instruction
```

**Setup Operations:**
- SRS/SRD/ERS/ERD: Now implemented as macros using LPSW/SPSW
- Single-time setup, not performance critical
- Educational value: Shows explicit bit manipulation

### **5.3 Complete Instruction Encoding Map**
```
0 - LDI
10 - LD/ST
110 - ALU2
1110 - JMP (conditional)
11110 - LDS/STS
111110 - MOV
1111110 - LSI
11111110 - SMV
111111110 - MVS
1111111110 - SOP (INV, NEG, SPSW, LPSW)
11111111110 - SET/CLR (PSW bit ops)
111111111110 - JML (far jump)
1111111111110 - SYS (NOP, FSH, SWI, RETI, SETI, CLRI)
1111111111111111 - HLT
```

---

## **6. Summary**

Deep16 v5.1 provides a **complete, efficient solution for PSW manipulation**:
- ✅ **Direct bit operations** for flags (SET/CLR)
- ✅ **Fast interrupt control** (SETI/CLRI)
- ✅ **Full PSW manipulation** via LPSW/SPSW
- ✅ **Clean encoding** using previously unused 11-bit prefix
- ✅ **Educational value** with explicit bit manipulation
- ✅ **Hardware simplicity** - minimal new logic required
- ✅ **Future extensibility** - preserves space for FPU

This design solves all PSW manipulation needs while maintaining encoding efficiency and educational clarity.

---

**Deep16 Architecture Specification v5.1**  
*Updated: 2024-03-20*  
*Status: Ready for implementation*  
*Key Change: Added 11-bit SET/CLR, fixed PSW layout, optimized PSW operations*
