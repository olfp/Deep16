# Deep16 Architecture Changes Summary

## Major Architectural Simplifications

### 1. **Instruction Set Cleanup**
- **SWB instruction removed** - now implemented as alias for `ROL Rx, 8`
- **Logical immediate operands** now specify bit positions: `AND R1, 3` = `R1 AND (1 << 3)`
- **Opcode space reclaimed** for future extensions

### 2. **Memory Access Improvements**
- **LD/ST offsets are now sign-extended** (-16 to +15)
- Enables direct negative indexing: `LD R1, [SP-4]`
- Much cleaner stack frame access
- Enhanced assembler syntax supports bracket notation

### 3. **Interrupt System Simplification**
- **Only PSW is automatically saved** to PSW'
- **All segment registers set to 0** during interrupts (CS=0, DS=0, SS=0, ES=0)
- **Simplified context switching** - no segment register saving/restoring
- **Vector table change**: 0x0000 = NMI (was Reset)

### 4. **Reset Behavior Update**
- **CS = 0xFFFF** (boot from top of memory)
- **All other segments = 0x0000** (DS=0, SS=0, ES=0)
- **PC = 0x0000** (start execution at CS:0000)
- Boot ROM expected at 0xFFFF0-0xFFFFF

### 5. **Memory Protection Removed**
- **All memory fully accessible** - no read/write/execute restrictions
- **CS register is read/write** like other segments
- **Self-modifying code permitted**
- Simplified hardware, more flexible programming

### 6. **Critical Semantic Clarifications**
- **LDI performs sign extension**: `LDI -1` loads `0xFFFF` (not `0x7FFF`)
- **Architectural moves (MOV with imm=3) cause no pipeline stall**
- **Cache details minimized** - treated as optional implementation detail

## Impact on Programmers

### ✅ **Positive Changes**
- **Cleaner stack code**: `LD R1, [SP-4]` works directly
- **Efficient constants**: `LDI -1` loads all ones
- **Powerful bit manipulation**: `AND R1, 5` clears all bits except bit 5
- **Simplified interrupt handlers**: No segment register management
- **More flexible memory usage**: No protection restrictions

### ⚠️ **Breaking Changes**
- **LDI now sign-extends** - affects constant loading
- **Logical immediates work differently** than arithmetic immediates
- **Interrupt handlers run in segment 0** - must set up segments if needed
- **Reset vector moved** - NMI at 0x0000, Reset boots from top

### 🔄 **Behavior Changes**
| Instruction | Old Behavior | New Behavior |
|-------------|--------------|--------------|
| `LDI -1` | Loaded `0x7FFF` | Loads `0xFFFF` |
| `AND R1, 3` | `R1 AND 3` | `R1 AND (1<<3)` |
| `LD R1, SP, -4` | Invalid | Valid (sign-extended) |
| Interrupt entry | Saved all segments | Only PSW saved, segments=0 |
| Reset | CS=0xFFFF, others=default | CS=0xFFFF, others=0 |

## Rationale

These changes make Deep16:
- **Simpler to implement** - less hardware complexity
- **Easier to program** - more intuitive instructions
- **More practical** for embedded applications
- **Cleaner architecture** - orthogonal design principles
- **Maintains performance** while reducing complexity

The architecture now better balances educational clarity with practical utility for real embedded systems programming.
