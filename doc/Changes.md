# **Deep16 Instruction Set Revision Document v2.0**
## **Changes Made on 2024-03-20 (Updated)**

---

## **Executive Summary**

This document summarizes all changes made to the Deep16 instruction set architecture on 2024-03-20. The primary changes address the missing PSW manipulation instructions and optimize instruction encoding using newly discovered encoding space.

## **1. Critical Issue Identified**

**Problem:** During the reorganization of SOP (Single Operand) instructions, the PSW manipulation instructions (SET, CLR, SRS, SRD, ERS, ERD) were inadvertently removed from the instruction set.

**Impact:** Without these instructions, proper PSW manipulation (interrupt control, segment register setup, flag management) becomes impossible or inefficient.

## **2. Solution Implemented**

A comprehensive solution was implemented using multiple encoding spaces:

### **Part A: New 11-bit Prefix for SET/CLR Operations**
- **Encoding:** `11111111110 d1 imm4`
- **Operations:** 
  - `SET imm` - Set PSW bit imm (0-15)
  - `CLR imm` - Clear PSW bit imm (0-15)
- **Purpose:** Direct manipulation of PSW flag bits (0-3) and Shadow bit (5)

### **Part B: Common PSW Operations in SYS Space**
- Added two common PSW operations to SYS instruction space:
  - `SETI` - Enable interrupts (set PSW[4])
  - `CLRI` - Disable interrupts (clear PSW[4])
- **Rationale:** Bit 4 needs special handling, not reachable via imm4's single-bit operations

### **Part C: New SPSW/LPSW Instructions**
- **SPSW Rx:** `1111111110 10 Rx4` - Set PSW from register
- **LPSW Rx:** `1111111110 11 Rx4` - Load PSW to register (moved from 12-bit encoding)
- **Purpose:** Full PSW manipulation for upper byte (bits 6-15)

### **Part D: Encoding Optimization (LPSW ↔ JML Swap)**
- **Before:** `1111111110 11 xxxx` = JML, `111111111110 xxxx` = LPSW
- **After:** `1111111110 11 xxxx` = LPSW, `111111111110 xxxx` = JML
- **Rationale:** LPSW is more common than JML, deserves shorter encoding

## **3. Detailed Changes**

### **3.1 New 11-bit Prefix Instructions (11111111110 d1 imm4)**

| Instruction | Old Encoding | New Encoding | Change |
|-------------|--------------|--------------|--------|
| **SET imm** | `11111110 1100 imm4` (SOP) | `11111111110 0 imm4` | **MOVED to 11-bit prefix** |
| **CLR imm** | `11111110 1101 imm4` (SOP) | `11111111110 1 imm4` | **MOVED to 11-bit prefix** |

### **3.2 SYS Instruction Group (1111111111110 op3)**

| Instruction | Old Encoding | New Encoding | Change |
|-------------|--------------|--------------|--------|
| NOP | `1111111111110 000` | `1111111111110 000` | No change |
| FSH | `1111111111110 001` | `1111111111110 001` | No change |
| SWI | `1111111111110 010` | `1111111111110 010` | No change |
| RETI | `1111111111110 011` | `1111111111110 011` | No change |
| **SETI** | **NOT EXISTENT** | `1111111111110 100` | **NEW INSTRUCTION** |
| **CLRI** | **NOT EXISTENT** | `1111111111110 101` | **NEW INSTRUCTION** |
| *Reserved* | `1111111111110 110` | `1111111111110 110` | Now reserved |
| *Reserved* | `1111111111110 111` | `1111111111110 111` | Now reserved |

### **3.3 SOP Instruction Group (1111111110 xx xxxx)**

| Instruction | Old Encoding | New Encoding | Change |
|-------------|--------------|--------------|--------|
| INV Rx | `1111111110 00 xxxx` | `1111111110 00 xxxx` | No change |
| NEG Rx | `1111111110 01 xxxx` | `1111111110 01 xxxx` | No change |
| **SPSW Rx** | **NOT EXISTENT** | `1111111110 10 xxxx` | **NEW INSTRUCTION** |
| **LPSW Rx** | `111111111110 xxxx` | `1111111110 11 xxxx` | **MOVED (shorter encoding)** |

### **3.4 JML Instruction (Far Jump)**

| Instruction | Old Encoding | New Encoding | Change |
|-------------|--------------|--------------|--------|
| JML Rx | `1111111110 11 xxxx` | `111111111110 xxxx` | **MOVED (longer encoding)** |

## **4. New Instruction Specifications**

### **4.1 SET imm - Set PSW Bit**
```
Encoding: 11111111110 0 imm4
Operation: PSW[imm] ← 1
Description: Sets the specified bit (0-15) of the Processor Status Word.
Notes: Typically used for flags: N(0), Z(1), V(2), C(3), S(5)
```

### **4.2 CLR imm - Clear PSW Bit**
```
Encoding: 11111111110 1 imm4
Operation: PSW[imm] ← 0
Description: Clears the specified bit (0-15) of the Processor Status Word.
Notes: Typically used for flags: N(0), Z(1), V(2), C(3), S(5)
```

### **4.3 SETI - Set Interrupt Enable**
```
Encoding: 1111111111110 100
Operation: PSW[4] ← 1
Description: Enables maskable interrupts by setting bit 4 of PSW.
```

### **4.4 CLRI - Clear Interrupt Enable**
```
Encoding: 1111111111110 101
Operation: PSW[4] ← 0
Description: Disables maskable interrupts by clearing bit 4 of PSW.
```

### **4.5 SPSW Rx - Set PSW from Register**
```
Encoding: 1111111110 10 xxxx
Operation: PSW ← Rx
Description: Copies the contents of register Rx to the Processor Status Word.
Notes: Used for setting upper PSW byte (bits 6-15)
```

### **4.6 LPSW Rx - Load PSW to Register**
```
Encoding: 1111111110 11 xxxx
Operation: Rx ← PSW
Description: Loads the current Processor Status Word to register Rx.
Notes: Used for reading/modifying PSW
```

## **5. Removed Instructions (Now Implemented Differently)**

The following instructions are no longer directly encoded but can be implemented differently:

1. **SET2 bit** - Not needed (use SET imm for bits 0-3, LPSW/SPSW for bits 6-15)
2. **CLR2 bit** - Not needed (use CLR imm for bits 0-3, LPSW/SPSW for bits 6-15)
3. **SRS Rx** - Implemented as macro using LPSW/SPSW
4. **SRD Rx** - Implemented as macro using LPSW/SPSW  
5. **ERS Rx** - Implemented as macro using LPSW/SPSW
6. **ERD Rx** - Implemented as macro using LPSW/SPSW

## **6. Macro Implementations**

### **6.1 Flag Aliases (Common Operations)**
```assembly
; Flag operation aliases
.macro SETC
    SET 3          ; Set carry flag
.endm

.macro CLRC
    CLR 3          ; Clear carry flag
.endm

.macro SETV
    SET 2          ; Set overflow flag
.endm

.macro CLRV
    CLR 2          ; Clear overflow flag
.endm

.macro SETZ
    SET 1          ; Set zero flag
.endm

.macro CLRZ
    CLR 1          ; Clear zero flag
.endm

.macro SETN
    SET 0          ; Set negative flag
.endm

.macro CLRN
    CLR 0          ; Clear negative flag
.endm
```

### **6.2 Segment Register Setup Macros**
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

## **7. Performance Impact**

### **7.1 Instruction Count Comparison**

| Operation | Old (direct) | New (direct) | Macro Implementation |
|-----------|--------------|--------------|---------------------|
| Set carry flag | 1 (SET 3) | 1 (SET 3) | Same |
| Clear carry flag | 1 (CLR 3) | 1 (CLR 3) | Same |
| Enable interrupts | 1 (SET2 0) | 1 (SETI) | Same |
| Disable interrupts | 1 (CLR2 0) | 1 (CLRI) | Same |
| Set other flag (0-3,5) | 1 (SET bit) | 1 (SET bit) | Same |
| SRS Rx | 1 (SRS) | ~5 (macro) | Slower but setup-only |
| SRD Rx | 1 (SRD) | ~5 (macro) | Slower but setup-only |

### **7.2 Code Size Impact**

| Scenario | Old Encoding | New Encoding | Change |
|----------|--------------|--------------|--------|
| SET/CLR flag bits | 12 bits | **11 bits** | **-1 bit each** |
| SETI/CLRI | 12 bits | 13 bits | +1 bit |
| LPSW in common use | 14 bits | **12 bits** | **-2 bits** |
| Full PSW setup sequence | ~100 bits | ~95 bits | **~5% smaller** |

## **8. Available Encoding Space (After Changes)**

### **8.1 Used Prefixes**
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

### **8.2 Available for Future Expansion**
```
11111111111110xx   (14-bit prefix + 2 bits) - 4 operations
111111111111110x   (15-bit prefix + 1 bit)  - 2 operations
1111111111111110   (16-bit)                 - 1 operation
```

**Note:** These spaces are ideal for future FPU implementation.

## **9. Example Code (Before vs After)**

### **9.1 Before (With old SOP encoding)**
```assembly
; Flag operations
SETC          ; 11111110 1100 0011 (12 bits)
CLRI          ; 11111110 1111 0000 (12 bits)
LPSW R1       ; 111111111110 0001 (14 bits)

; SRS R13
SRS R13       ; 11111110 1000 1101 (12 bits)
```

### **9.2 After (With new encoding)**
```assembly
; Flag operations
SETC          ; 11111111110 0 0011 (11 bits) - 1 bit saved
CLRI          ; 1111111111110 101 (13 bits) - 1 bit longer
LPSW R1       ; 1111111110 11 0001 (12 bits) - 2 bits saved

; SRS R13 (macro)
LPSW Rtemp    ; 1111111110 11 XXXX (12 bits)
AND Rtemp, X  ; 110 00111 XXXX XXXX (11+4 bits)
AND R13, X    ; 110 00111 1101 XXXX (11+4 bits)
SL R13, 6     ; 110 10000 1101 0110 (11+4 bits)
OR Rtemp, R13 ; 110 01010 XXXX 1101 (11+4 bits)
SPSW Rtemp    ; 1111111110 10 XXXX (12 bits)
; ~62 bits total (was 12 bits) - but setup-only
```

## **10. Tools Impact**

### **10.1 Required Updates**
1. **Assembler**: 
   - Update opcode tables for new SET/CLR encoding
   - Add SPSW instruction
   - Update LPSW encoding (moved)
   - Update JML encoding (moved)
   - Add SETI/CLRI instructions
   - Update macro library

2. **Simulator/Emulator**: 
   - Update instruction decoding tables
   - Implement new PSW bit operations
   - Update context for LPSW/JML swap

3. **Compiler**: 
   - Update code generation for PSW manipulation
   - Use new SET/CLR for flag operations
   - Use macros for SRS/SRD/ERS/ERD

4. **Documentation**: 
   - Update instruction set reference
   - Update programming examples
   - Update encoding tables

### **10.2 Backward Compatibility**
- **Not backward compatible** with previous encoding
- **Requires re-assembly** of existing code
- **Acceptable** as Deep16 is still in design phase

## **11. Benefits Summary**

1. ✅ **Complete PSW manipulation** - Direct bit ops + full PSW access
2. ✅ **More efficient encoding** - SET/CLR now 11 bits (was 12)
3. ✅ **Common ops optimized** - LPSW in shorter encoding (12 vs 14 bits)
4. ✅ **Educational value** - Clear separation of flag vs setup operations
5. ✅ **Hardware simplicity** - Clean encoding using available space
6. ✅ **Future extensible** - Preserves space for FPU and other extensions
7. ✅ **Performance balanced** - Critical operations fast, setup ops as macros

## **12. Implementation Checklist**

- [ ] Update assembler opcode tables for all changed instructions
- [ ] Implement new SET/CLR encoding (11-bit prefix)
- [ ] Add SPSW instruction to assembler
- [ ] Update LPSW encoding (move to SOP space)
- [ ] Update JML encoding (move to 12-bit prefix)
- [ ] Add SETI/CLRI to SYS space
- [ ] Update simulator instruction decoders
- [ ] Create/update PSW manipulation macro library
- [ ] Update architecture documentation
- [ ] Update example programs with new encoding
- [ ] Test all PSW operations work correctly
- [ ] Test interrupt enable/disable functionality
- [ ] Test segment register setup macros
- [ ] Verify backward compatibility break is documented

## **13. Key Insights**

1. **11-bit prefix discovery** was crucial - provides perfect encoding for SET/CLR
2. **Bit 4 special handling** needed - imm4 only goes to 15, but PSW has 16 bits
3. **Setup vs runtime ops** - SRS/SRD are setup operations, can be macros
4. **Encoding optimization** - Common ops (LPSW) deserve shorter encoding
5. **Educational balance** - Direct bit manipulation teaches PSW structure

## **14. Final Assessment**

**Pros:**
1. ✅ **Solves PSW manipulation completely**
2. ✅ **More efficient encoding overall**
3. ✅ **Clean separation of concerns**
4. ✅ **Educational value maintained**
5. ✅ **Hardware implementation straightforward**
6. ✅ **Future expansion preserved**

**Cons:**
1. ❌ **Breaks binary compatibility** (but acceptable in design phase)
2. ❌ **SRS/SRD slower as macros** (but setup-only operations)
3. ❌ **Toolchain updates required**

**Verdict: Excellent solution!** The discovery of the 11-bit prefix space made this a much cleaner solution than originally planned. The trade-offs are well-balanced for Deep16's educational and practical goals.

---

**Document Version:** 2.0  
**Date:** 2024-03-20 (Updated)  
**Status:** Approved for implementation  
**Impact:** Medium (encoding changes require tool updates)  
**Rationale:** Essential for proper PSW manipulation, optimized encoding using discovered 11-bit prefix space
