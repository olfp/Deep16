# Deep16 Architecture Changes Since Saturday Morning

## Major Evolution of the Architecture

### **NEW: Complete Shadow Register System (Saturday Morning)**
- **✅ INTRODUCED**: Full shadow register set: **CS', DS', SS', ES', PC', PSW'**
- **✅ INTRODUCED**: **Symmetric SMV instruction** for accessing both contexts
- **✅ INTRODUCED**: **Automatic context saving** on interrupts (original design)
- **Purpose**: Zero-overhead interrupt context switching with full state preservation

### **Saturday Evening: Major Refinements & Simplifications**

#### 1. **Interrupt Handling Optimized**
- **✅ CHANGED**: Interrupt auto-save behavior
  - **Before**: All segments automatically saved to shadows (CS→CS', DS→DS', etc.)
  - **After**: **Only PSW automatically saved** to PSW', segments set to 0
- **✅ CHANGED**: Interrupt segment state
  - **Before**: Segments preserved via shadows
  - **After**: **All segments set to 0** during interrupt handling
- **✅ PRESERVED**: Full shadow register set remains available via SMV
- **✅ PRESERVED**: Symmetric SMV access unchanged

#### 2. **Instruction Set Refinements**
- **❌ REMOVED**: Dedicated SWB instruction (opcode reclaimed)
- **✅ ADDED**: SWB as assembler alias for `ROL Rx, 8`
- **✅ CLARIFIED**: Logical immediate semantics
  - **Before**: `AND R1, 3` = `R1 AND 3` (general 4-bit value)
  - **After**: `AND R1, 3` = `R1 AND (1 << 3)` (bit position only)

#### 3. **Memory Access Enhanced**
- **✅ CHANGED**: LD/ST offset semantics
  - **Before**: 5-bit unsigned offset (0-31)
  - **After**: **5-bit signed offset** (-16 to +15)
- **✅ ADDED**: Negative offset support in enhanced syntax
  - `LD R1, [SP-4]` now valid and clean
- **✅ IMPROVED**: Stack frame access much cleaner

#### 4. **Reset & Boot System Redesigned**
- **✅ CHANGED**: Interrupt vector table
  - **Before**: 0x0000 = Reset vector
  - **After**: **0x0000 = NMI vector**, 0x0001 = HW_INT, 0x0002 = SWI
- **✅ CHANGED**: Reset state
  - **Before**: CS=0xFFFF, DS=0x1000, SS=0x8000, ES=0x2000
  - **After**: **CS=0xFFFF, DS=0x0000, SS=0x0000, ES=0x0000**
- **✅ CHANGED**: Boot behavior
  - **Before**: Complex boot ROM sequence
  - **After**: Direct execution from **CS:0000**

#### 5. **Memory Protection Eliminated**
- **❌ REMOVED**: All memory protection mechanisms
- **✅ CHANGED**: CS register accessibility
  - **Before**: CS read-only (execute protection)
  - **After**: **CS read/write** like other segments
- **✅ ADDED**: Self-modifying code support
- **Result**: **All memory fully accessible** - no restrictions

#### 6. **Critical Semantic Clarifications**
- **✅ CLARIFIED**: LDI sign extension behavior
  - `LDI -1` now correctly loads `0xFFFF` (was ambiguous)
- **✅ CLARIFIED**: Architectural move semantics
  - MOV with immediate=3 causes **no pipeline stall**
  - Simply bypasses forwarding for architectural read
- **✅ MINIMIZED**: Cache implementation details
  - Treated as optional feature rather than core specification

## Before vs After Complete Comparison

### **Shadow Register System**
| Aspect | Initial Design | Current Design |
|--------|----------------|----------------|
| **Shadow Registers** | **Newly introduced** CS',DS',SS',ES',PC',PSW' | **Still present** unchanged |
| **Interrupt Auto-save** | Save all segments to shadows | Save only PSW, set segments to 0 |
| **SMV Access** | **New symmetric access** | **Preserved unchanged** |
| **Context Switching** | Full automatic preservation | Manual via SMV when needed |

### **Instruction Set**
| Instruction | Initial | Current |
|-------------|---------|---------|
| `SWB R1` | Dedicated instruction | Alias for `ROL R1, 8` |
| `AND R1, 3` | `R1 AND 3` | `R1 AND (1<<3)` |
| `LD R1, SP, -4` | Invalid | **Valid** (sign-extended) |
| `LDI -1` | Ambiguous | **0xFFFF** (sign-extended) |

### **System Architecture**
| Component | Initial | Current |
|-----------|---------|---------|
| **Memory Protection** | CS execute-only | **No protection** |
| **Reset Vectors** | 0x0000=Reset | **0x0000=NMI** |
| **Boot Location** | Boot ROM sequence | **CS:0000 directly** |
| **Segment Defaults** | Non-zero defaults | **All zero except CS** |

## Programming Impact Summary

### **New Capabilities**
- ✅ **Shadow register access** via SMV for debugging/context
- ✅ **Negative memory offsets** for cleaner stack code
- ✅ **Self-modifying code** support
- ✅ **Flexible segment usage** - no protection restrictions

### **Changed Behaviors**
- 🔄 **Interrupt handlers** now run in segment 0 by default
- 🔄 **Reset code** starts at CS:0000 directly
- 🔄 **Logical operations** with immediates work differently
- 🔄 **LDI loading** of negative constants now correct

### **Simplifications**
- 🎯 **Less automatic context saving** - faster interrupts
- 🎯 **No protection management** - simpler programming
- 🎯 **Cleaner stack access** with negative offsets
- 🎯 **Reclaimed opcode space** from SWB removal

## Rationale Behind Changes

### **Why Introduce Shadow Registers?**
- **Advanced interrupt handling** capability
- **Debugging support** - inspect interrupted state
- **Future expansion** - task switching support
- **Educational value** - modern processor feature

### **Why Optimize Interrupt Auto-save?**
- **Performance**: Most ISRs don't need segment preservation
- **Simplicity**: Common case (segment 0 ISRs) made faster
- **Flexibility**: Manual save via SMV when actually needed

### **Why Remove Protection?**
- **Embedded reality**: Small systems rarely need MMU
- **Implementation simplicity**: Less complex hardware
- **Programming flexibility**: Dynamic code generation enabled

## Current Architecture Status

The Deep16 has evolved into a **balanced, practical RISC architecture**:

- **✅ Modern features**: Shadow registers for advanced contexts
- **✅ Practical simplifications**: Optimized for common use cases  
- **✅ Clean instruction set**: Orthogonal and consistent
- **✅ Educational value**: Understandable yet feature-rich
- **✅ Implementation ready**: Feasible in FPGA/ASIC

This represents a thoughtful evolution from theoretical completeness to practical elegance while maintaining the core RISC philosophy and educational value.
