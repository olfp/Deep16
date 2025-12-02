# **Deep16 Instruction Set Revision Document v2.1**
## **Changes Made on 2024-03-21 (Updated)**

---

## **Executive Summary**

This document summarizes all changes made to the Deep16 instruction set architecture on 2024-03-21. The changes include: precise encoding definitions, FPU instruction space allocation with ILL trap behavior, hard-wired assembler aliases for flag operations, the AMV instruction clarification, and the new CLRB instruction.

## **1. Critical Changes Since v2.0**

### **1.1 Precise Encoding Hierarchy**
Established exact bit-by-bit encoding for all instruction prefixes, resolving previous ambiguities.

### **1.2 FPU Space Allocation**
Defined three FPU encoding spaces that trap to ILL for software emulation:
- **14-bit prefix**: `11111111111110xx` (4 FPU_CORE operations)
- **15-bit prefix**: `111111111111110x` (2 FPU_EXT operations)
- **16-bit prefix**: `1111111111111110` (1 FCMP operation)

### **1.3 ILL Instruction Behavior**
- FPU instructions trigger ILL trap (like SWI but with PSW' = 0x20)
- **Critical restriction**: ILL must NOT occur in interrupt context (PSW.S=1)
- If attempted in interrupt context: processor reset (double fault)

### **1.4 New Instructions and Clarifications**
1. **AMV** instruction clarified: `MOV Rd, Rs, 3` reads architectural register (bypasses forwarding)
2. **CLRB** instruction added: `Rd ← Rd AND NOT(1 << imm4)` for single-bit clearing
3. **Hard-wired assembler aliases** for flag operations (not macros)

## **2. New/Updated Instruction Specifications**

### **2.1 AMV - Architectural Move**
```
Encoding: 111110 Rd4 Rs4 11
Operation: Rd ← Rs (reads from architectural register file, bypasses forwarding)
Description: Used when the forwarded value is not desired
Assembler: AMV Rd, Rs = MOV Rd, Rs, 3
```

### **2.2 CLRB - Clear Bit**
```
Encoding: 110 00111 Rd4 imm4
Operation: Rd ← Rd AND NOT(1 << imm4)
Description: Clears a single bit (0-15) in the destination register
Purpose: Bit manipulation without needing mask register
```

### **2.3 Hard-wired Assembler Aliases**
These are assembler-level substitutions (compile-time), not macros:

| Alias | Expands To | Binary Encoding |
|-------|------------|-----------------|
| `SETC` | `SET 3` | `11111111110 0 0011` |
| `CLRC` | `CLR 3` | `11111111110 1 0011` |
| `SETV` | `SET 2` | `11111111110 0 0010` |
| `CLRV` | `CLR 2` | `11111111110 1 0010` |
| `SETZ` | `SET 1` | `11111111110 0 0001` |
| `CLRZ` | `CLR 1` | `11111111110 1 0001` |
| `SETN` | `SET 0` | `11111111110 0 0000` |
| `CLRN` | `CLR 0` | `11111111110 1 0000` |

### **2.4 FPU Instruction Space (ILL Traps)**
```
14-bit: 11111111111110 ff  (ff = 00-11) → 4 FPU_CORE operations
15-bit: 111111111111110 f  (f = 0-1)    → 2 FPU_EXT operations  
16-bit: 1111111111111110   (no args)    → 1 FCMP operation
```

**Suggested FPU operations:**
- FADD, FMUL, FDIV, FSQRT (FPU_CORE)
- FEXP, FLOG (FPU_EXT)
- FCMP (floating-point compare)

## **3. Updated Instruction Encoding Hierarchy**

**Table 1: Complete Instruction Encoding (Final v5.2)**

| Opcode | Bits | Instruction | Format | Notes |
|--------|------|-------------|--------|-------|
| 0 | 1 | LDI | `[0][imm15]` | |
| 10 | 2 | LD/ST | `[10][d1][Rd4][Rb4][offset5]` | offset5 is signed (-16 to +15) |
| 110 | 3 | ALU2 | `[110][func5][Rd4][Rs/imm4]` | |
| 1110 | 4 | JMP | `[1110][type3][target9]` | Delayed branch |
| 11110 | 5 | LDS/STS | `[11110][d1][seg2][Rd4][Rs4]` | |
| 111110 | 6 | MOV/AMV | `[111110][Rd4][Rs4][imm2]` | imm2=3 = AMV |
| 1111110 | 7 | LSI | `[1111110][Rd4][imm5]` | |
| 11111110 | 8 | SMV | `[11111110][Rx4][alt_sel4]` | |
| 111111110 | 9 | MVS | `[111111110][d1][Rd4][seg2]` | |
| 1111111110 | 10 | SOP | `[1111111110][type2][Rx4]` | INV, NEG, SPSW, LPSW |
| 11111111110 | 11 | SET/CLR | `[11111111110][d1][imm4]` | |
| 111111111110 | 12 | JML | `[111111111110][Rx4]` | |
| 1111111111110 | 13 | SYS | `[1111111111110][op3]` | NOP, FSH, SWI, RETI, SETI, CLRI |
| **11111111111110** | **14** | **FPU_CORE** | `[11111111111110][ff]` | **ILL trap** |
| **111111111111110** | **15** | **FPU_EXT** | `[111111111111110][f]` | **ILL trap** |
| **1111111111111110** | **16** | **FCMP** | `[1111111111111110]` | **ILL trap** |
| **1111111111111111** | **16** | **HLT** | `[1111111111111111]` | |

## **4. ALU2 func5 Encoding Updates**

**Updated encoding for AND immediate slot:**

| func5 | Instruction | Format | Operation | Change |
|-------|-------------|---------|-----------|--------|
| 00110 | AND Rd, Rs | `AND Rd, Rs` | `Rd ← Rd AND Rs` | No change |
| **00111** | **CLRB Rd, imm** | **`CLRB Rd, imm`** | **`Rd ← Rd AND NOT(1 << imm)`** | **NEW** |
| 01000 | TBC Rd, Rs | `TBC Rd, Rs` | `Rd AND Rs` (flags only) | No change |
| 01001 | TBC Rd, imm | `TBC Rd, imm` | `Rd AND (1 << imm)` (flags only) | No change |

**Rationale:** CLRB provides useful single-bit clearing without needing a mask register, complementing the existing OR immediate (set bit) and XOR immediate (toggle bit).

## **5. Assembler Implementation Changes**

### **5.1 Hard-wired Aliases (vs Macros)**
- **Before**: Flag operations implemented as macros
- **After**: Flag operations implemented as hard-wired assembler aliases
- **Benefit**: Cleaner assembler output, no macro expansion overhead

### **5.2 Common Assembler Aliases**
```assembly
; These are assembler-level substitutions
NOP         ; → 1111111111110 000
JMP Rx      ; → 111110 1111 Rx4 00  (MOV PC, Rx, 0)
MOV Rd, Rs  ; → 111110 Rd4 Rs4 00
AMV Rd, Rs  ; → 111110 Rd4 Rs4 11

; Condition codes use PC-relative addressing
JZ  label   ; → 1110 000 (calculated offset)
JNZ label   ; → 1110 001 (calculated offset)
```

## **6. PSW Bit Layout (Definitive)**

**Classic Visualization:**
```
15                                              0
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|DE|  ER[3:0]  |DS|  SR[3:0]  |S |I |C |V |Z |N |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
```

**Bit Definitions:**
| Bit | Name | Description | Access |
|-----|------|-------------|--------|
| 0 | N | Negative flag | SET/CLR, LPSW/SPSW |
| 1 | Z | Zero flag | SET/CLR, LPSW/SPSW |
| 2 | V | Overflow flag | SET/CLR, LPSW/SPSW |
| 3 | C | Carry flag | SET/CLR, LPSW/SPSW |
| 4 | I | Interrupt Enable | SETI/CLRI, LPSW/SPSW |
| 5 | S | Shadow View | Hardware managed, readable via LPSW |
| 6-9 | SR[3:0] | Stack Register selection | LPSW/SPSW only |
| 10 | DS | Dual Stack | LPSW/SPSW only |
| 11-14 | ER[3:0] | Extra Register selection | LPSW/SPSW only |
| 15 | DE | Dual Extra | LPSW/SPSW only |

**PSW Reset State**: `0x0020` (Shadow bit S=1, interrupts disabled)

## **7. Example Code Changes**

### **7.1 Before (v2.0)**
```assembly
; Flag operations using macros
.macro SETC
    SET 3
.endm

SETC        ; Macro expands to SET 3

; Bit manipulation
AND R1, R2  ; Need mask in R2
```

### **7.2 After (v2.1)**
```assembly
; Flag operations using hard-wired aliases
SETC        ; Assembler directly outputs: 11111111110 0 0011

; Bit manipulation
CLRB R1, 3  ; Clear bit 3 of R1 directly
OR   R1, 5  ; Set bit 5 of R1
XOR  R1, 7  ; Toggle bit 7 of R1

; Architectural move (bypass forwarding)
ADD  R1, R2, 1    ; Writes R1 with forwarding
AMV  R3, R1       ; Reads architectural R1 (old value)
```

## **8. FPU Emulation Example**

### **8.1 ILL Vector Handler**
```assembly
.org 0x0003            ; ILL interrupt vector
.dw  FPU_EMULATOR

FPU_EMULATOR:
    ; Running in shadow context (PSW.S=1)
    SMV R0', APC       ; Get trapped PC
    LD  R1, R0', 0     ; Read trapped instruction
    
    ; Check if it's an FPU instruction
    AND  R2, R1, 0xC000 ; Bits 14-15
    CMP  R2, 0xC000
    JNZ  NOT_FPU
    
    ; Dispatch based on opcode
    ; ... FPU emulation code ...
    
NOT_FPU:
    ; Not FPU - fatal error
    HLT
```

### **8.2 Software FPU Emulation**
FPU operations can be emulated in software:
- Handler decodes trapped FPU instruction
- Uses normal registers for calculations
- Returns with RETI
- Future hardware FPU would use same encoding

## **9. Pipeline and Hazard Updates**

### **9.1 AMV Special Behavior**
- `MOV Rd, Rs, 3` (AMV) reads from architectural register file
- **Bypasses forwarding logic**
- Gets value from register file, not forwarded result
- Useful when the forwarded value is not desired

### **9.2 Example Pipeline Timing**
```assembly
ADD  R1, R2, 1    ; Cycle 1: EX writes R1
                  ; Cycle 2: WB writes R1 to register file
                  ;         Forwarding available for next instruction

AMV  R3, R1       ; Cycle 1: ID reads architectural R1 (old value)
                  ;         Bypasses forwarded value from ADD

MOV  R4, R1, 0    ; Cycle 1: ID reads forwarded R1 (new value)
                  ;         Uses forwarding logic
```

## **10. Tools Impact Updates**

### **10.1 Additional Updates Required**
1. **Assembler**:
   - Add hard-wired aliases for flag operations
   - Implement AMV assembler alias
   - Add CLRB instruction encoding
   - Define FPU instruction placeholders (for emulation)

2. **Simulator/Emulator**:
   - Implement ILL trap for FPU instructions
   - Implement CLRB instruction
   - Handle AMV bypassing forwarding
   - Add FPU emulation support (optional)

3. **Documentation**:
   - Update instruction set reference with CLRB
   - Document AMV behavior with forwarding
   - Document FPU emulation mechanism
   - Update examples with new instructions

## **11. Benefits Summary (Additional)**

1. ✅ **CLRB instruction**: Useful bit manipulation without mask register
2. ✅ **AMV clarification**: Architectural register access when needed
3. ✅ **Hard-wired aliases**: Cleaner assembler output for flag ops
4. ✅ **FPU emulation path**: Future compatibility without hardware changes
5. ✅ **ILL trap behavior**: Clean mechanism for unimplemented instructions
6. ✅ **Complete encoding**: No ambiguities in instruction hierarchy

## **12. Implementation Checklist Updates**

### **Additional Items:**
- [ ] Implement CLRB instruction in ALU
- [ ] Add AMV forwarding bypass logic to pipeline
- [ ] Implement ILL trap mechanism for FPU instructions
- [ ] Add hard-wired assembler aliases (SETC, CLRC, etc.)
- [ ] Create FPU emulation library for ILL handler
- [ ] Test CLRB with all bit positions (0-15)
- [ ] Test AMV with various forwarding scenarios
- [ ] Test ILL trap from normal context only
- [ ] Verify ILL in interrupt context triggers reset

## **13. Performance Impact (Additional)**

### **13.1 CLRB vs Alternative**
```assembly
; Using CLRB (new)
CLRB R1, 3      ; 11+4 bits, 1 instruction

; Alternative (without CLRB)
LDI  0xFFF7     ; ~11 bits (LDI) + 11 bits (AND) = ~22 bits
AND  R1, R0     ; Actually LDI loads into R0, then AND R1, R0

; CLRB saves ~50% code size for single-bit clear
```

### **13.2 AMV Use Cases**
- **When needed**: Debugging, timing-sensitive code, certain algorithms
- **Performance**: Same as MOV but bypasses forwarding
- **Use sparingly**: Breaks normal pipeline optimization

## **14. Final Assessment (Updated)**

**Pros (Additional):**
1. ✅ **CLRB fills useful gap** in bit manipulation instructions
2. ✅ **AMV provides escape hatch** for unusual forwarding cases
3. ✅ **Hard-wired aliases cleaner** than macros
4. ✅ **FPU emulation path clear** for future expansion
5. ✅ **ILL mechanism robust** with safety checks

**Cons (Mitigated):**
1. ⚠️ **More instructions to implement** (CLRB, ILL handling)
2. ⚠️ **AMV could be misused** (breaks normal optimization)
3. ⚠️ **FPU emulation overhead** (but optional)

**Verdict: Excellent evolution!** The architecture is now more complete with useful bit manipulation, clear forwarding control, and a clean path for future FPU implementation.

---

**Document Version:** 2.1  
**Date:** 2024-03-21 (Updated)  
**Status:** Approved for implementation  
**Impact:** Medium (new instructions, aliases, FPU space)  
**Rationale:** Completes bit manipulation suite, clarifies forwarding behavior, establishes FPU emulation path
