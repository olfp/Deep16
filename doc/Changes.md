# Deep16 Architecture Evolution Document
## Complete History of Changes and Rationale

---

## 1. Overview of Architecture Evolution

Deep16 has undergone significant refinement from its initial conception to the current balanced design. This document chronicles all major changes, providing context and rationale for each evolution.

### 1.1 Evolution Timeline
- **Initial Design**: Classic RISC with basic interrupt handling
- **Saturday Morning**: Introduction of full shadow register system
- **Saturday Evening**: Major simplifications and optimizations  
- **Current**: Extended shadow registers with selective general-purpose shadows
- **Latest**: Instruction encoding optimizations

### 1.2 Design Philosophy Evolution
- **From**: Theoretical completeness with full protection
- **Through**: Practical embedded system considerations
- **To**: Balanced educational/practical design with zero-overhead interrupts

---

## 2. Major Architectural Changes

### 2.1 NEW: Complete Shadow Register System (Saturday Morning)

#### 2.1.1 Original Innovation
- **✅ INTRODUCED**: Full shadow register set: **CS', DS', SS', ES', PC', PSW'**
- **✅ INTRODUCED**: **Symmetric SMV instruction** for accessing both contexts
- **✅ INTRODUCED**: **Automatic context saving** on interrupts
- **Purpose**: Zero-overhead interrupt context switching with full state preservation

#### 2.1.2 Original Interrupt Behavior
```
On interrupt:
  // Save all context to shadows
  CS' ← CS, DS' ← DS, SS' ← SS, ES' ← ES
  PC' ← PC, PSW' ← PSW
  // Switch to shadow context
  PSW.S ← 1
  // Continue execution in shadow context
```

### 2.2 Saturday Evening: Major Refinements & Simplifications

#### 2.2.1 Interrupt Handling Optimized
- **✅ CHANGED**: Interrupt auto-save behavior
  - **Before**: All segments automatically saved to shadows
  - **After**: **Only PSW automatically saved** to PSW', segments set to 0
- **✅ CHANGED**: Interrupt segment state
  - **Before**: Segments preserved via shadows
  - **After**: **All segments set to 0** during interrupt handling
- **✅ PRESERVED**: Full shadow register set remains available via SMV
- **✅ PRESERVED**: Symmetric SMV access unchanged

**Rationale**: Most interrupt handlers don't need segment preservation. Setting segments to 0 is faster and simpler.

#### 2.2.2 Instruction Set Refinements
- **❌ REMOVED**: Dedicated SWB instruction (opcode reclaimed)
- **✅ ADDED**: SWB as assembler alias for `ROL Rx, 8`
- **✅ CLARIFIED**: Logical immediate semantics
  - **Before**: `AND R1, 3` = `R1 AND 3` (general 4-bit value)
  - **After**: `AND R1, 3` = `R1 AND (1 << 3)` (bit position only)

#### 2.2.3 Memory Access Enhanced
- **✅ CHANGED**: LD/ST offset semantics
  - **Before**: 5-bit unsigned offset (0-31)
  - **After**: **5-bit signed offset** (-16 to +15)
- **✅ ADDED**: Negative offset support in enhanced syntax
  - `LD R1, [SP-4]` now valid and clean
- **✅ IMPROVED**: Stack frame access much cleaner

#### 2.2.4 Reset & Boot System Redesigned
- **✅ CHANGED**: Interrupt vector table
  - **Before**: 0x0000 = Reset vector
  - **After**: **0x0000 = NMI vector**, 0x0001 = HW_INT, 0x0002 = SWI
- **✅ CHANGED**: Reset state
  - **Before**: CS=0xFFFF, DS=0x1000, SS=0x8000, ES=0x2000
  - **After**: **CS=0xFFFF, DS=0x0000, SS=0x0000, ES=0x0000**
- **✅ CHANGED**: Boot behavior
  - **Before**: Complex boot ROM sequence
  - **After**: Direct execution from **CS:0000**

#### 2.2.5 Memory Protection Eliminated
- **❌ REMOVED**: All memory protection mechanisms
- **✅ CHANGED**: CS register accessibility
  - **Before**: CS read-only (execute protection)
  - **After**: **CS read/write** like other segments
- **✅ ADDED**: Self-modifying code support
- **Result**: **All memory fully accessible** - no restrictions

#### 2.2.6 Critical Semantic Clarifications
- **✅ CLARIFIED**: LDI sign extension behavior
  - `LDI -1` now correctly loads `0xFFFF` (was ambiguous)
- **✅ CLARIFIED**: Architectural move semantics
  - MOV with immediate=3 causes **no pipeline stall**
  - Simply bypasses forwarding for architectural read

### 2.3 Extended Shadow Register Set (Changes2.md)

#### 2.3.1 NEW: Selective Shadow Registers Added
- **✅ ADDED**: Shadow registers for critical general-purpose registers:
  - **R0'** - Temporary/LDI destination
  - **R1'** - General purpose/argument
  - **R2'** - General purpose/argument  
  - **R13'** - Stack Pointer (SP)
  - **R14'** - Link Register (LR)
- **✅ PRESERVED**: Existing shadow registers (CS', DS', SS', ES', PC', PSW')
- **✅ TOTAL**: 11 shadow registers (up from 6)

#### 2.3.2 Updated Interrupt Behavior
```
On interrupt:
  // Initialize shadow registers to 0
  R0' ← 0, R1' ← 0, R2' ← 0, R13' ← 0, R14' ← 0
  CS' ← 0, DS' ← 0, SS' ← 0, ES' ← 0
  PSW' ← 0x0020  // S=1, I=0
  PC' ← Mem[interrupt_vector]
  // Switch to shadow context via PSW'.S=1
```

#### 2.3.3 Updated SMV Instruction Extension
**New SMV alt_sel encodings:**
```
0110: AR0  (Alternate R0)
0111: AR1  (Alternate R1)  
1000: AR2  (Alternate R2)
1001: AR13 (Alternate R13/SP)
1010: AR14 (Alternate R14/LR)
```

#### 2.3.4 Hardware Impact
- **Register storage increase**: +80 bits (5 × 16-bit)
- **Muxing complexity**: Moderate increase
- **Estimated LUT increase**: ~100-150 LUTs
- **Total estimated**: ~2,600-2,650 LUTs (still well under 8,000)

#### 2.3.5 Rationale for Selective Shadows

**Why These Specific Registers?**
1. **R0'** - LDI always uses R0, interrupts often need to load values
2. **R1'/R2'** - Common argument/return value registers
3. **R13' (SP)** - Critical for stack integrity
4. **R14' (LR)** - Return address preservation

**Benefits:**
- **Reduced interrupt overhead** - 5 critical registers available immediately
- **Common case optimized** - most interrupt handlers use these registers
- **Minimal hardware cost** - 80 bits vs 256 bits for full set
- **Educational value** - teaches selective context saving

### 2.4 Latest: Instruction Encoding Optimizations

#### 2.4.1 SMV Instruction Re-encoding
- **✅ CHANGED**: SMV encoding from 11-bit to 8-bit
  - **Before**: `11111111110[d1][alt_sel4]` (11 bits)
  - **After**: `11111110[Rx4][alt_sel4]` (8 bits)
- **✅ CHANGED**: SMV semantics
  - **Before**: Had read and write variants (d1 control)
  - **After**: **Read-only** - always reads shadow reg to Rx
- **✅ ADDED**: More compact alt_sel encoding scheme

**New alt_sel Encodings:**
```
0000: ACS  (Alternate CS)
0001: ADS  (Alternate DS)
0010: ASS  (Alternate SS)
0011: AES  (Alternate ES)
0100: APSW (Alternate PSW)
1000: AR0  (Alternate R0)
1001: AR1  (Alternate R1)
1010: AR2  (Alternate R2)
1101: AR13 (Alternate R13/SP)
1110: AR14 (Alternate R14/LR)
1111: AR15/APC (Alternate PC)
```

#### 2.4.2 SOP Instruction Re-encoding
- **✅ CHANGED**: SOP encoding from 8-bit to 10-bit
  - **Before**: `11111110[type4][Rx/imm4]` (8 bits)
  - **After**: `1111111110[type2][Rx4]` (10 bits)
- **✅ SIMPLIFIED**: Only 2 SOP instructions remain
  - `INV Rx` (type2=00) - Bitwise complement
  - `NEG Rx` (type2=01) - Two's complement negation

#### 2.4.3 Interrupt Entry/Exit Clarification
**Critical Correction: PSW' Handling**
- **✅ CORRECTED**: PSW' is **NOT** copied from PSW on interrupt
- **✅ CLARIFIED**: PSW' is set to **0x0020** (S=1, I=0)
- **✅ CLARIFIED**: Normal PSW remains unchanged during interrupt

**Correct Interrupt Entry:**
```
PSW'  ← 0x0020    ; S=1, I=0 - switch to shadow context
CS'   ← 0         ; Interrupts run in segment 0
DS'   ← 0
SS'   ← 0  
ES'   ← 0
PC'   ← Mem[interrupt_vector]  ; Jump to handler
; Hardware automatically uses shadow registers (PSW'.S=1)
```

**Correct Interrupt Exit:**
```
On RETI instruction:
  PSW'  ← 0x0000    ; S=0 - switch back to normal context
  ; Hardware automatically uses normal registers (PSW'.S=0)
  ; Execution resumes with original segments and PSW intact
```

---

## 3. Before vs After Complete Comparison

### 3.1 Shadow Register System Evolution

| Aspect | Initial Design | After Saturday | Current Design |
|--------|----------------|----------------|----------------|
| **Shadow Registers** | None | CS',DS',SS',ES',PC',PSW' | +R0',R1',R2',R13',R14' |
| **Interrupt Auto-save** | Manual save | Save all segments | **Only set PSW'=0x0020** |
| **Interrupt Segments** | Preserved | Preserved via shadows | **All set to 0** |
| **SMV Access** | N/A | Read/write symmetric | **Read-only symmetric** |
| **Context Switching** | Software | Hardware via PSW'.S | Hardware via PSW'.S |

### 3.2 Instruction Set Evolution

| Instruction | Initial | After Saturday | Current |
|-------------|---------|----------------|---------|
| `SWB R1` | Dedicated | Alias for `ROL R1, 8` | Alias for `ROL R1, 8` |
| `AND R1, 3` | `R1 AND 3` | `R1 AND (1<<3)` | `R1 AND (1<<3)` |
| `LD R1, SP, -4` | Invalid | **Valid** (signed) | **Valid** (signed) |
| `LDI -1` | Ambiguous | **0xFFFF** | **0xFFFF** |
| `SMV R0, APC` | N/A | Read/write | **Read-only** |
| `INV R1` | Various encodings | 8-bit encoding | **10-bit encoding** |

### 3.3 System Architecture Evolution

| Component | Initial | After Saturday | Current |
|-----------|---------|----------------|---------|
| **Memory Protection** | Full MMU | CS execute-only | **No protection** |
| **Reset Vectors** | 0x0000=Reset | **0x0000=NMI** | **0x0000=NMI** |
| **Boot Location** | Boot ROM | **CS:0000 directly** | **CS:0000 directly** |
| **Segment Defaults** | Various | All zero except CS | All zero except CS |
| **Interrupt Context** | Stack save | Shadow registers | **Extended shadows** |

### 3.4 Performance Characteristics

| Metric | Initial | After Saturday | Current |
|--------|---------|----------------|---------|
| **Interrupt Latency** | ~10 cycles | ~3 cycles | **~2 cycles** |
| **Context Save** | Manual push | Automatic shadow | **Clean shadow init** |
| **Register Usage** | Save all | Save none | **Selective shadows** |
| **Code Density** | Good | Better | **Best** |
| **Hardware Cost** | Low | Moderate | **Optimized** |

---

## 4. Programming Impact Summary

### 4.1 New Capabilities
- ✅ **Extended shadow register access** via SMV for debugging/context
- ✅ **Negative memory offsets** for cleaner stack code (-16 to +15)
- ✅ **Self-modifying code** support (no memory protection)
- ✅ **Flexible segment usage** - CS is read/write like other segments
- ✅ **Fast interrupt handlers** with clean shadow register context
- ✅ **Architectural moves** for stable state access (MOV ..., ..., 3)

### 4.2 Changed Behaviors
- 🔄 **Interrupt handlers** run in segment 0 with clean register context
- 🔄 **Reset code** starts at CS:0000 directly (CS=0xFFFF)
- 🔄 **Logical operations** with immediates use bit positions, not values
- 🔄 **LDI loading** of negative constants uses correct sign extension
- 🔄 **SMV instruction** is now read-only with simpler encoding
- 🔄 **PSW' management** is entirely hardware-controlled

### 4.3 Simplifications
- 🎯 **No manual context saving** in interrupt handlers
- 🎯 **No protection management** - simpler programming model
- 🎯 **Cleaner stack access** with negative offsets
- 🎯 **Reclaimed opcode space** from SWB removal
- 🎯 **Optimized instruction encoding** for common operations
- 🎯 **Predictable interrupt context** (all shadows initialized to 0)

### 4.4 Critical Programming Notes

**Interrupt Handler Writing:**
```assembly
; OLD WAY (manual save):
isr_old:
    PUSH R0
    PUSH R1
    PUSH PSW
    ; ... handler ...
    POP PSW
    POP R1
    POP R0
    RETI

; NEW WAY (shadow registers):
isr_new:
    ; R0', R1', R2', R13', R14' already available as 0
    ; Can use them immediately
    LDI  value    ; Uses R0' (shadow)
    MOV  R1, R0   ; Uses R1' and R0' (shadows)
    ; ... handler ...
    RETI          ; Automatically returns to normal context
```

**Debugging with SMV:**
```assembly
; Inspect interrupted context
debug_interrupt:
    SMV R1, APC      ; R1 = PC' (interrupted address)
    SMV R2, APSW     ; R2 = PSW' (0x0020 if in interrupt)
    SMV R3, AR0      ; R3 = R0' (shadow R0, typically 0)
    ; ... debug code ...
```

---

## 5. Current Architecture Summary

Deep16 has evolved into a **balanced, practical RISC architecture**:

### 5.1 Key Features
- **✅ Modern interrupt handling**: Extended shadow registers for zero-overhead context switching
- **✅ Practical simplifications**: Optimized for common embedded use cases  
- **✅ Clean instruction set**: Orthogonal, consistent, with efficient encoding
- **✅ Educational value**: Understandable yet feature-rich design
- **✅ Implementation ready**: FPGA-feasible (~2,650 LUTs estimated)

### 5.2 Design Balance Achieved
1. **Performance vs Complexity**: Fast interrupts without excessive hardware
2. **Features vs Simplicity**: Useful shadow registers without full duplication
3. **Flexibility vs Predictability**: Self-modifying code with clean interrupt context
4. **Educational vs Practical**: Teachable concepts with real-world applicability

### 5.3 Estimated Implementation Metrics
- **Logic Elements**: ~2,650 LUTs (well under 8,000 target)
- **Memory Bits**: ~176 bits shadow registers + register file
- **Pipeline Stages**: 5 (IF, ID, EX, MEM, WB)
- **Clock Frequency**: 80+ MHz in modern FPGAs
- **Interrupt Latency**: 2 cycles (entry + jump)

### 5.4 Future Extension Points
1. **More shadow registers**: Add R3'-R12' if needed
2. **Cache enhancements**: Optional L1 cache implementation
3. **Debug features**: Hardware breakpoints, watchpoints
4. **Power management**: Sleep modes, clock gating
5. **Vector extensions**: SIMD operations for DSP

---

## 6. Complete Change History Table

| Date | Change | Impact | Rationale |
|------|--------|--------|-----------|
| Saturday AM | Shadow registers introduced | High | Zero-overhead interrupts |
| Saturday PM | Interrupt simplification | High | Common case optimization |
| Saturday PM | LD/ST signed offsets | Medium | Cleaner stack access |
| Saturday PM | Memory protection removed | Medium | Embedded practicality |
| Current | Extended GP shadows | Medium | Common register coverage |
| Current | SMV/SOP re-encoding | Low | Better opcode utilization |
| Current | PSW' correction | Critical | Accurate interrupt behavior |

---

**Final Architecture Status:**

The Deep16 architecture represents a **thoughtful evolution** from theoretical completeness to practical elegance. It maintains core RISC principles while introducing innovative features for modern embedded systems. The balanced shadow register system, clean instruction set, and practical simplifications make it both educational and suitable for real implementation.

This evolution demonstrates how careful refinement can produce a design that is simultaneously simple enough to understand, efficient enough to implement, and practical enough for real-world use - the ideal balance for an educational RISC processor.

*Deep16 Architecture Evolution Document v1.0 - Complete History*
