# Deep16 Architecture Changes Document

## Latest Changes: Extended Shadow Register Set

### **New: Selective Shadow Registers Added**
- **✅ ADDED**: Shadow registers for critical general-purpose registers:
  - **R0'** - Temporary/LDI destination
  - **R1'** - General purpose/argument
  - **R2'** - General purpose/argument  
  - **R13'** - Stack Pointer (SP)
  - **R14'** - Link Register (LR)
- **✅ PRESERVED**: Existing shadow registers (CS', DS', SS', ES', PC', PSW')
- **✅ TOTAL**: 11 shadow registers (up from 6)

### **Updated Interrupt Behavior**
```
On interrupt:
  // Save critical registers to shadows
  R0' ← R0, R1' ← R1, R2' ← R2, R13' ← R13, R14' ← R14
  PSW' ← PSW
  // Switch to shadow context
  PSW.S ← 1, PSW.I ← 0
  CS/DS/SS/ES ← 0
```

### **Updated SMV Instruction Extension**
**New SMV alt_sel encodings:**
```
0110: AR0  (Alternate R0)
0111: AR1  (Alternate R1)  
1000: AR2  (Alternate R2)
1001: AR13 (Alternate R13/SP)
1010: AR14 (Alternate R14/LR)
```

### **Hardware Impact**
- **Register storage increase**: +80 bits (5 × 16-bit)
- **Muxing complexity**: Moderate increase
- **Estimated LUT increase**: ~100-150 LUTs
- **Total estimated**: ~2,600-2,650 LUTs (still well under 8,000)

## Rationale for Selective Shadows

### **Why These Specific Registers?**
1. **R0'** - LDI always uses R0, interrupts often need to load values
2. **R1'/R2'** - Common argument/return value registers
3. **R13' (SP)** - Critical for stack integrity
4. **R14' (LR)** - Return address preservation

### **Benefits**
- **Reduced interrupt overhead** - 5 critical registers saved automatically
- **Common case optimized** - most interrupt handlers use these registers
- **Minimal hardware cost** - 80 bits vs 256 bits for full set
- **Educational value** - teaches selective context saving

### **Example Usage**
```assembly
fast_interrupt_handler:
    ; R0-R2, R13, R14 already saved in shadows!
    ; Can use them immediately without saving
    LDI  value       ; Uses R0' (shadow R0)
    MOV  R1, R0      ; Safe - using shadow registers
    ; ... handler code ...
    RETI             ; Automatically restores R0-R2, R13, R14
```

## Complete Change History Since Saturday

### **1. Shadow Register System Introduced (Saturday)**
- CS', DS', SS', ES', PC', PSW' - Full segment + control shadows

### **2. Interrupt Optimization (Saturday Evening)**
- Only PSW automatically saved to PSW'
- All segments set to 0 on interrupt
- SMV provides symmetric access

### **3. Instruction Set Refinements**
- SWB removed, now alias for ROL Rx, 8
- LD/ST offsets made signed (-16 to +15)
- Logical immediates as bit positions

### **4. System Architecture Changes**
- No memory protection (CS read/write)
- Reset: CS=0xFFFF, others=0, PC=0x0000
- Vector table: 0x0000=NMI, 0x0001=HW, 0x0002=SWI

### **5. NMI Support Added**
- Ignores PSW.I flag
- Cannot interrupt during other interrupts (discarded)
- Vector at 0x0000

### **6. Selective General Register Shadows (Now)**
- R0', R1', R2', R13', R14' added
- Common-case interrupt optimization
- Minimal hardware increase

## Current Architecture Summary

Deep16 now features a **balanced shadow register system**:
- **Full context**: Segments + PC + PSW
- **Critical registers**: R0, R1, R2, SP, LR  
- **Efficient interrupts**: Automatic save of commonly-used state
- **Educational**: Shows practical context switching
- **FPGA feasible**: ~2,650 LUTs estimated

This represents an optimal balance between hardware complexity, interrupt performance, and educational value for a 16-bit RISC processor.
