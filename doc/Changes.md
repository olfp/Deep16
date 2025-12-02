You're absolutely right. Let me create a comprehensive document that integrates **all changes** from both the original v2.0 (March 20) and the new v2.1 (March 21) updates:

# **Deep16 Instruction Set Revision Document v2.1**
## **Comprehensive Changes Made on 2024-03-20 through 2024-03-21**

---

## **Executive Summary**

This document summarizes **all changes** made to the Deep16 instruction set architecture between March 20-21, 2024. The changes address: PSW manipulation instructions, encoding optimization, FPU space allocation, ILL trap behavior, new CLRB instruction, AMV clarification, and hard-wired assembler aliases.

## **1. Overview of All Changes**

### **Phase 1: March 20 (v2.0) - PSW Manipulation Crisis**
- **Problem**: PSW manipulation instructions (SET, CLR, SRS, SRD, ERS, ERD) were missing
- **Solution**: Discovered 11-bit prefix space, created comprehensive PSW manipulation system

### **Phase 2: March 21 (v2.1) - Refinements and Extensions**
- **Additions**: CLRB instruction, AMV clarification, FPU encoding space
- **Optimizations**: Hard-wired assembler aliases, precise encoding definitions
- **Future-proofing**: ILL trap mechanism for unimplemented FPU instructions

## **2. Complete Encoding Hierarchy (Final)**

**Table 1: Deep16 v5.2 Instruction Encoding Map**

| Prefix | Bits | Instruction Group | Key Instructions | Status |
|--------|------|-------------------|------------------|--------|
| 0 | 1 | LDI | `LDI imm` | **No change** |
| 10 | 2 | LD/ST | `LD Rd, Rb, offset`, `ST Rd, Rb, offset` | **No change** |
| 110 | 3 | ALU2 | `ADD`, `SUB`, `AND`, `OR`, `XOR`, `CLRB`, shifts, rotates, multiply/divide | **NEW: Added CLRB** |
| 1110 | 4 | JMP | `JZ`, `JNZ`, `JC`, `JNC`, `JN`, `JNN`, `JO`, `JNO` | **No change** |
| 11110 | 5 | LDS/STS | `LDS Rd, seg, Rb`, `STS Rd, seg, Rb` | **No change** |
| 111110 | 6 | MOV/AMV | `MOV Rd, Rs, imm`, `AMV Rd, Rs` | **NEW: AMV clarified** |
| 1111110 | 7 | LSI | `LSI Rd, imm` | **No change** |
| 11111110 | 8 | SMV | `SMV Rx, alt_reg` | **No change** |
| 111111110 | 9 | MVS | `MVS Rd, Sx`, `MVS Sx, Rd` | **No change** |
| 1111111110 | 10 | SOP | `INV Rx`, `NEG Rx`, `SPSW Rx`, `LPSW Rx` | **NEW: LPSW moved here from 12-bit** |
| 11111111110 | 11 | SET/CLR | `SET imm`, `CLR imm` | **NEW: Created from discovered space** |
| 111111111110 | 12 | JML | `JML Rx` | **CHANGED: Moved from 10-bit** |
| 1111111111110 | 13 | SYS | `NOP`, `FSH`, `SWI`, `RETI`, `SETI`, `CLRI` | **NEW: Added SETI/CLRI** |
| 11111111111110 | 14 | FPU_CORE | `FADD`, `FMUL`, `FDIV`, `FSQRT` | **NEW: ILL trap space** |
| 111111111111110 | 15 | FPU_EXT | `FEXP`, `FLOG` | **NEW: ILL trap space** |
| 1111111111111110 | 16 | FCMP | `FCMP` | **NEW: ILL trap space** |
| 1111111111111111 | 16 | HLT | `HLT` | **No change** |

## **3. Detailed Changes from Original Specification**

### **3.1 PSW Manipulation System (March 20)**

**Problem**: During SOP reorganization, PSW manipulation instructions were lost.

**Solution**: Created a complete PSW manipulation system using three encoding spaces:

1. **11-bit SET/CLR** (`11111111110 d1 imm4`):
   - Direct PSW bit manipulation (bits 0-3,5)
   - Aliases: `SETC`, `CLRC`, `SETV`, `CLRV`, `SETZ`, `CLRZ`, `SETN`, `CLRN`

2. **13-bit SYS additions** (`1111111111110 op3`):
   - `SETI`, `CLRI` for interrupt control
   - Bit 4 needs special handling (not reachable via imm4)

3. **10-bit SOP changes** (`1111111110 type2 Rx4`):
   - Added `SPSW Rx` (Set PSW from register)
   - Moved `LPSW Rx` here from 12-bit encoding (more common)

### **3.2 Encoding Optimization: LPSW ↔ JML Swap**

**Before:**
- `1111111110 11 xxxx` = JML (far jump)
- `111111111110 xxxx` = LPSW (load PSW)

**After:**
- `1111111110 11 xxxx` = LPSW (more common, shorter encoding)
- `111111111110 xxxx` = JML (less common, longer encoding)

### **3.3 New Instructions (March 21)**

1. **CLRB Rd, imm** (`110 00111 Rd4 imm4`):
   - `Rd ← Rd AND NOT(1 << imm4)`
   - Completes bit manipulation suite (OR sets, XOR toggles, CLRB clears)
   - Replaces problematic `AND Rd, imm` encoding

2. **AMV Rd, Rs** (clarification):
   - Assembler alias for `MOV Rd, Rs, 3`
   - Reads from architectural register file, bypasses forwarding
   - Useful for specific timing/code requirements

### **3.4 FPU and ILL System**

**FPU Encoding Space Allocation:**
- 14-bit: 4 FPU_CORE operations (FADD, FMUL, FDIV, FSQRT)
- 15-bit: 2 FPU_EXT operations (FEXP, FLOG)
- 16-bit: 1 FCMP operation

**ILL Trap Behavior:**
- Unimplemented FPU instructions trigger ILL trap
- Behaves like SWI but with PSW' = 0x20 (shadow context active)
- **Critical restriction**: ILL must NOT occur in interrupt context (PSW.S=1)
- If attempted in interrupt context: processor reset (double fault)

### **3.5 Hard-wired Assembler Aliases**

**Changed from macros to direct assembler substitutions:**
```assembly
; BEFORE (macros)
.macro SETC
    SET 3
.endm

; AFTER (hard-wired aliases)
SETC    ; Assembler directly outputs: 11111111110 0 0011
```

**Full alias table:**
| Alias | Expands To | Purpose |
|-------|------------|---------|
| `SETC` | `SET 3` | Set carry flag |
| `CLRC` | `CLR 3` | Clear carry flag |
| `SETV` | `SET 2` | Set overflow flag |
| `CLRV` | `CLR 2` | Clear overflow flag |
| `SETZ` | `SET 1` | Set zero flag |
| `CLRZ` | `CLR 1` | Clear zero flag |
| `SETN` | `SET 0` | Set negative flag |
| `CLRN` | `CLR 0` | Clear negative flag |
| `AMV Rd, Rs` | `MOV Rd, Rs, 3` | Architectural move |
| `JMP Rx` | `MOV PC, Rx, 0` | Jump indirect |

## **4. PSW Bit Layout (Definitive)**

**Classic Visualization:**
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

**Access Methods:**
- **Bits 0-3 (NZVC)**: SET/CLR aliases (`SETC`, `CLRC`, etc.)
- **Bit 4 (I)**: `SETI`, `CLRI` instructions
- **Bit 5 (S)**: Hardware managed, readable via `LPSW`
- **Bits 6-15 (SR, DS, ER, DE)**: `LPSW`/`SPSW` with bit manipulation

## **5. Complete ALU2 func5 Encoding Table**

**Updated with CLRB instruction:**

| func5 | Instruction | Operation | Notes |
|-------|-------------|-----------|-------|
| 00000 | ADD Rd, Rs | `Rd ← Rd + Rs` | Sets NZVC |
| 00001 | ADD Rd, imm | `Rd ← Rd + imm` | Sets NZVC |
| 00010 | SUB Rd, Rs | `Rd ← Rd - Rs` | Sets NZVC |
| 00011 | SUB Rd, imm | `Rd ← Rd - imm` | Sets NZVC |
| 00100 | CMP Rd, Rs | `Rd - Rs` (flags only) | Sets NZVC |
| 00101 | CMP Rd, imm | `Rd - imm` (flags only) | Sets NZVC |
| 00110 | AND Rd, Rs | `Rd ← Rd AND Rs` | Sets NZ00 |
| **00111** | **CLRB Rd, imm** | **`Rd ← Rd AND NOT(1 << imm)`** | **NEW: Sets NZ00** |
| 01000 | TBC Rd, Rs | `Rd AND Rs` (flags only) | Sets NZ00 |
| 01001 | TBC Rd, imm | `Rd AND (1 << imm)` (flags only) | Sets NZ00 |
| 01010 | OR Rd, Rs | `Rd ← Rd OR Rs` | Sets NZ00 |
| 01011 | OR Rd, imm | `Rd ← Rd OR (1 << imm)` | Sets NZ00 |
| 01100 | XOR Rd, Rs | `Rd ← Rd XOR Rs` | Sets NZ00 |
| 01101 | XOR Rd, imm | `Rd ← Rd XOR (1 << imm)` | Sets NZ00 |
| 01110 | TBS Rd, Rs | `Rd XOR Rs` (flags only) | Sets NZ00 |
| 01111 | TBS Rd, imm | `Rd XOR (1 << imm)` (flags only) | Sets NZ00 |
| 10000-11011 | Shift/Rotate ops | Various shifts/rotates | Sets C flag |
| 11100-11111 | Multiply/Divide | MUL, MUL32, DIV, DIV32 | Special behavior |

## **6. Example Code Evolution**

### **6.1 Flag Operations**
```assembly
; OLD (before all changes) - Hypothetical
SET2 3          ; Set carry (instruction lost in reorganization)

; INTERMEDIATE (March 20) - Using macros
.macro SETC
    SET 3
.endm
SETC            ; Macro expands to SET 3

; FINAL (March 21) - Hard-wired alias
SETC            ; Assembler directly outputs SET 3 encoding
```

### **6.2 Bit Manipulation**
```assembly
; OLD - Clear bit 3 of R1 (inefficient)
LDI  0xFFF7     ; Load mask
AND  R1, R0     ; Apply mask

; FINAL - Using CLRB
CLRB R1, 3      ; Single instruction, 11+4 bits
```

### **6.3 PSW Full Setup**
```assembly
; Setup complete PSW (SR=13, DS=1, ER=11, DE=1, I=1)
LPSW R1                 ; Load current PSW (12 bits, was 14)
AND  R1, 0x001F         ; Keep NZVC+I
LDI  0xE410             ; DE=1, ER=11, DS=1, SR=13, I=1
OR   R1, R0             ; Combine
SPSW R1                 ; Store back (12 bits)

; Enable interrupts
SETI                    ; 13 bits (special for bit 4)
```

## **7. Tools Impact (Combined)**

### **7.1 Assembler Updates Required**
1. **New instructions**: SET, CLR, SETI, CLRI, SPSW, CLRB
2. **Changed encodings**: LPSW (10-bit), JML (12-bit)
3. **Hard-wired aliases**: SETC, CLRC, etc. (not macros)
4. **FPU placeholders**: FADD, FMUL, etc. (trap to ILL)
5. **AMV alias**: `AMV Rd, Rs` → `MOV Rd, Rs, 3`

### **7.2 Simulator/Emulator Updates**
1. **PSW bit operations**: Implement SET/CLR behavior
2. **ILL trap mechanism**: Handle unimplemented FPU instructions
3. **CLRB instruction**: New ALU operation
4. **AMV behavior**: Bypass forwarding logic
5. **LPSW/JML swap**: Update instruction decoding tables

### **7.3 Documentation Updates**
1. **Instruction set reference**: Complete with all new instructions
2. **Encoding tables**: Updated hierarchy and bit patterns
3. **Examples**: Updated with new syntax and instructions
4. **Pipeline details**: AMV forwarding behavior
5. **FPU emulation**: ILL trap mechanism documentation

## **8. Performance Impact Analysis**

### **8.1 Code Size Impact**

| Operation | Original | v2.0 (March 20) | v2.1 (March 21) | Change |
|-----------|----------|-----------------|-----------------|--------|
| SET flag bit | 12 bits | **11 bits** | **11 bits** | **-1 bit** |
| CLR flag bit | 12 bits | **11 bits** | **11 bits** | **-1 bit** |
| LPSW (common) | 14 bits | **12 bits** | **12 bits** | **-2 bits** |
| SRS setup | 1 instr | ~5 instr macro | ~5 instr macro | Slower but setup-only |
| CLRB bit | 2 instr | 2 instr | **1 instr** | **50% smaller** |
| Enable interrupts | ? | 13 bits | 13 bits | New capability |

### **8.2 Execution Speed**
- **Flag operations**: Same speed (1 cycle)
- **PSW full setup**: Slower as macro but setup-only operation
- **CLRB**: Faster than equivalent AND with mask
- **AMV**: Same speed as MOV but different forwarding behavior

## **9. Benefits Summary (Combined)**

1. ✅ **Complete PSW manipulation**: Direct bits + full register access
2. ✅ **Optimized encoding**: Common ops (LPSW) in shorter encoding
3. ✅ **Bit manipulation suite**: OR (set), XOR (toggle), CLRB (clear)
4. ✅ **Forwarding control**: AMV provides architectural access when needed
5. ✅ **Clean assembler**: Hard-wired aliases instead of macros for flags
6. ✅ **Future expansion**: FPU encoding space with ILL trap mechanism
7. ✅ **Educational value**: Clear PSW structure and manipulation methods
8. ✅ **Hardware simplicity**: Clean encoding using discovered space

## **10. Implementation Priority**

### **Phase 1: Core PSW System (Essential)**
- [ ] SET/CLR instructions (11-bit prefix)
- [ ] SETI/CLRI instructions (SYS space)
- [ ] SPSW/LPSW instructions (SOP space)
- [ ] LPSW/JML encoding swap

### **Phase 2: New Instructions**
- [ ] CLRB instruction (ALU2 func5=00111)
- [ ] AMV behavior (MOV with imm2=3 bypasses forwarding)
- [ ] Hard-wired assembler aliases

### **Phase 3: FPU/ILL System**
- [ ] ILL trap mechanism
- [ ] FPU instruction placeholders
- [ ] FPU emulation library (software)

### **Phase 4: Toolchain Updates**
- [ ] Assembler with new encodings and aliases
- [ ] Simulator with all new instructions
- [ ] Documentation updates
- [ ] Example programs

## **11. Backward Compatibility**

- **Not backward compatible** with any previous encoding
- **Complete re-assembly** required for existing code
- **Acceptable** as Deep16 is in design phase
- **Migration path**: Update assembler, reassemble all code

## **12. Rationale for Changes**

### **12.1 Why 11-bit prefix for SET/CLR?**
- Discovered unused encoding space
- Perfect fit for PSW bit operations
- More efficient than previous 12-bit encoding

### **12.2 Why CLRB instead of AND immediate?**
- AND immediate could only manipulate low 4 bits
- CLRB provides full 16-bit bit manipulation
- Complements existing OR/XOR immediate
- More useful in practice

### **12.3 Why hard-wired aliases vs macros?**
- Cleaner assembler output
- No macro expansion overhead
- Easier for assembler to optimize
- Better error messages

### **12.4 Why FPU ILL trap?**
- Future compatibility without hardware changes
- Software emulation possible today
- Same binary works with/without FPU hardware
- Clean expansion path

## **13. Final Assessment**

**Deep16 v5.2 represents a mature, complete architecture:**

1. **✅ Problem Solved**: PSW manipulation was completely missing, now fully supported
2. **✅ Encoding Optimized**: Common operations in shorter encodings
3. **✅ Feature Complete**: Bit manipulation, PSW control, future expansion
4. **✅ Educational Value**: Clear architecture with visible design choices
5. **✅ Practical Value**: Useful for embedded systems with interrupt handling

**Trade-offs Accepted:**
1. **Breaking changes**: Required but acceptable in design phase
2. **Macro-based setup**: SRS/SRD as macros but setup-only operations
3. **ILL overhead**: FPU emulation has performance cost

**Conclusion**: The changes from March 20-21 transform Deep16 from an incomplete specification to a fully-featured, implementable 16-bit RISC architecture ready for HDL implementation.

---

**Document Version:** 2.1 (Comprehensive)  
**Date:** 2024-03-21  
**Status:** Approved for implementation  
**Impact:** High (breaking changes, new instructions)  
**Rationale:** Essential for functional processor, optimized encoding, future expansion
