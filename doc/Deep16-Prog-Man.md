# Deep16 (深十六) Programmer's Manual
## 16-bit RISC Processor with Enhanced Memory Addressing

---

## 1. Introduction

### 1.1 Overview
Deep16 is a 16-bit RISC processor designed for efficiency, simplicity, and educational use. This manual provides practical guidance for programmers writing assembly code for the Deep16 architecture.

### 1.2 Key Programming Features
- **Fixed 16-bit instructions** - Simple decoding and alignment
- **16 general-purpose registers** - Rich register set for efficient coding
- **Enhanced assembler syntax** - Bracket and plus notation for readability
- **Delayed branch architecture** - One delay slot for performance optimization
- **Simplified shadow register system** - Fast interrupt context switching
- **Memory-mapped I/O** - Simple peripheral access
- **No memory protection** - Full memory accessibility

### 1.3 Performance Characteristics
- **Base performance**: 1.0-1.3 CPI (Cycles Per Instruction)
- **Branch penalty**: 0 cycles (delayed branch)
- **Subroutine calls**: 2 cycles (optimized with ALINK)
- **Call performance**: 33% faster than traditional approaches
- **Real-world speedup**: 10-25% for call-intensive code

---

## 2. Programming Model

### 2.1 Register Set

#### 2.1.1 General Purpose Registers (16-bit)

**Table 1: General Purpose Registers**

| Register | Alias | Preserved? | Purpose |
|----------|-------|------------|---------|
| R0       |       | Caller     | LDI destination, temporary |
| R1-R11   |       | Caller     | General purpose |
| R12      | FP    | Callee     | Frame Pointer |
| R13      | SP    | Callee     | Stack Pointer |
| R14      | LR    | Callee     | Link Register |
| R15      | PC    | -          | Program Counter |

**Important Notes:**
- **LDI instruction always loads R0**
- **Caller-save**: Can be modified by subroutine calls
- **Callee-save**: Must be preserved across calls
- **PC (R15)**: Special register, not used for general computation

#### 2.1.2 Segment Registers (16-bit)

**Table 2: Segment Registers**

| Register | Purpose | Access Method |
|----------|---------|---------------|
| CS       | Code Segment | Implicit (instruction fetch) |
| DS       | Data Segment | Default for memory access |
| SS       | Stack Segment | Used when PSW.SR configured |
| ES       | Extra Segment | Used for I/O and special memory |

**Memory Address Calculation:**
```
Physical Address = (segment << 4) + offset
```

### 2.2 Memory Map

**Physical Memory (1MB):**
```
0x00000 - 0xDFFFF: Home Segment (896KB) - Main program memory
0xE0000 - 0xEFFFF: Graphics Segment (64KB) - Reserved for future use
0xF0000 - 0xFFFFF: I/O Segment (64KB) - Memory-mapped peripherals
   └── 0xF1000 - 0xF17CF: Screen Buffer (2KB) - 80×25 character display
0xFFFF0 - 0xFFFFF: Boot ROM (16 words) - Initialization code
```

### 2.3 Stack Frame Convention

**Standard Stack Frame:**
```
High addresses
+------------+
| Saved LR   | ← FP + 3
+------------+
| Saved FP   | ← FP + 2  
+------------+
| Local 2    | ← FP + 1
+------------+
| Local 1    | ← FP
+------------+
| Parameter n| ← FP - 1
+------------+
| ...        |
+------------+
| Parameter 1| ← FP - n + 1
+------------+
Low addresses
```

---

## 3. Instruction Set Reference

### 3.1 Data Movement Instructions

#### 3.1.1 Basic Data Movement

**LDI - Load Immediate (to R0)**
```assembly
LDI  0x1234      ; R0 = 0x1234
LDI  -100        ; R0 = -100 (two's complement) - loads 0xFF9C
LDI  -1          ; R0 = 0xFFFF (sign extension!)
LDI  label       ; R0 = address of label
```
- **Always loads R0**
- **15-bit immediate** (sign-extended to 16 bits)
- **Critical**: Uses sign extension - `LDI -1` loads `0xFFFF`
- **Use for**: Loading constants, addresses

**MOV - Register to Register with Offset**
```assembly
MOV  R1, R2      ; R1 = R2 + 0
MOV  R1, R2+1    ; R1 = R2 + 1
MOV  R1, R2+2    ; R1 = R2 + 2
```
- **Small offsets (0-2)**: Normal operation with forwarding
- **Offset 3**: Architectural move (bypasses forwarding)

**LSI - Load Sign-Extended Immediate**
```assembly
LSI  R1, 15      ; R1 = 15
LSI  R1, -4      ; R1 = -4
LSI  R1, 0x1F    ; R1 = 31 (max positive)
```
- **5-bit immediate** (sign-extended to 16 bits)
- **Use for**: Small constants, loop counters

#### 3.1.2 Special Data Movement

**Architectural Move (AMV/ALINK)**
```assembly
AMV  R1, R2      ; MOV R1, R2, 3 - Architectural read
ALINK            ; MOV LR, PC, 3 - Architectural link in delay slot
ALNK R5          ; MOV R5, PC, 3 - Architectural link to R5
```
- **Bypasses pipeline forwarding**
- **Reads current architectural state**
- **Essential for delay slot link instructions**
- **No pipeline stall**

**Segment Register Access**
```assembly
MVS  R1, CS      ; R1 = CS (read segment register)
MVS  DS, R1      ; DS = R1 (write segment register)
MVS  ES, R0      ; ES = R0
```

### 3.2 Arithmetic Instructions

#### 3.2.1 Basic Arithmetic

**ADD/SUB - Addition and Subtraction**
```assembly
ADD  R1, R2      ; R1 = R1 + R2
ADD  R1, 5       ; R1 = R1 + 5
SUB  R3, R4      ; R3 = R3 - R4
SUB  SP, 4       ; SP = SP - 4 (allocate stack space)
```
- **Sets flags**: N, Z, V, C
- **4-bit immediate** (unsigned 0-15)

**CMP - Compare**
```assembly
CMP  R1, R2      ; R1 - R2 (set flags only)
CMP  R1, 10      ; R1 - 10 (set flags only)
```
- **Sets flags** without writing result
- **Use for**: Conditional branching

#### 3.2.2 Logical Operations

**AND/OR/XOR - Bitwise Operations**
```assembly
AND  R1, R2      ; R1 = R1 AND R2
AND  R1, 3       ; R1 = R1 AND (1 << 3)  (clear all except bit 3)
OR   R1, 7       ; R1 = R1 OR (1 << 7)   (set bit 7)
XOR  R1, 0       ; R1 = R1 XOR (1 << 0)  (toggle bit 0)
```
- **Immediate operands specify bit positions** (0-15)
- **NOT general 4-bit values** - uses `(1 << imm)`
- **Powerful single-bit manipulation**

**TBC/TBS - Test Bits**
```assembly
TBC  R1, R2      ; R1 AND R2 (set flags only)
TBC  R1, 5       ; Test if bit 5 is clear (Z=1 if clear)
TBS  R1, R2      ; R1 XOR R2 (set flags only)  
TBS  R1, 12      ; Test if bit 12 is set (Z=1 if set)
```
- **Sets flags** without writing result
- **TBC**: AND operation - Z=1 if all tested bits are clear
- **TBS**: XOR operation - Z=1 if all bits match

#### 3.2.3 Single Operand Operations

**INV/NEG - Invert and Negate**
```assembly
INV  R1          ; R1 = ~R1 (bitwise complement)
NEG  R1          ; R1 = -R1 (two's complement negation)
```

**SWB - Swap Bytes (Alias)**
```assembly
SWB  R1          ; R1 = (R1 << 8) | (R1 >> 8) - alias for ROL R1, 8
```
- **Swaps high and low bytes**
- **Example**: `0x1234` becomes `0x3412`

### 3.3 Shift and Rotate Instructions

#### 3.3.1 Logical Shifts

**SL/SR - Shift Logical**
```assembly
SL   R1, 2       ; R1 = R1 << 2 (logical left shift)
SR   R1, 3       ; R1 = R1 >> 3 (logical right shift)
```
- **Shifts in zeros**
- **Carry flag** gets last bit shifted out

#### 3.3.2 Rotate Operations

**ROL/ROR - Rotate**
```assembly
ROL  R1, 4       ; R1 = (R1 << 4) | (R1 >> 12)
ROL  R1, 8       ; R1 = (R1 << 8) | (R1 >> 8) - same as SWB R1
ROR  R1, 4       ; R1 = (R1 >> 4) | (R1 << 12)
```
- **Bits wrap around** (no carry involvement)
- **ROL R1, 8** is identical to **SWB R1**

### 3.4 Multiply and Divide

**MUL/MUL32 - Multiply**
```assembly
MUL    R2, R3    ; R2 = R2 * R3 (16×16→16-bit)
MUL32  R4, R5    ; R4:R5 = R4 * R5 (R4 must be EVEN: 0,2,4,6,8,10,12,14)
```
- **MUL32 requires EVEN register**
- **32-bit result** stored in register pair

**DIV/DIV32 - Divide**
```assembly
DIV    R2, R3    ; R2 = R2 / R3 (16÷16→16-bit quotient)
DIV32  R4, R5    ; R4 = quotient, R5 = remainder (R4 must be EVEN)
```
- **DIV32 requires EVEN register**
- **32-bit dividend**, 16-bit divisor and remainder

### 3.5 Memory Access Instructions

#### 3.5.1 Basic Load/Store

**LD/ST - Load and Store**
```assembly
LD   R1, R2, 5   ; R1 = [DS:R2+5]
ST   R1, R2, 5   ; [DS:R2+5] = R1
```
- **5-bit signed offset** (-16 to +15)
- **Sign-extended** - enables negative offsets!
- **Uses DS segment** by default

**Enhanced Syntax (Assembler Preprocessing):**
```assembly
LD   R1, [R2+5]  ; Assembler converts to LD R1, R2, 5
LD   R1, [SP-4]  ; Assembler converts to LD R1, SP, -4 (negative offset!)
LD   R1, [R2]    ; Offset 0 implied
```

#### 3.5.2 Segment Load/Store

**LDS/STS - Load/Store with Segment**
```assembly
LDS  R1, ES, R2  ; R1 = [ES:R2]
STS  R1, SS, R3  ; [SS:R3] = R1
```
- **Explicit segment specification**
- **Use for**: Accessing stack, I/O, or other segments

### 3.6 Control Flow Instructions

#### 3.6.1 Conditional Jumps

**Conditional Jump Instructions:**
```assembly
JZ   target      ; Jump if Z=1 (zero)
JNZ  target      ; Jump if Z=0 (not zero)
JC   target      ; Jump if C=1 (carry)
JNC  target      ; Jump if C=0 (no carry)
JN   target      ; Jump if N=1 (negative)
JNN  target      ; Jump if N=0 (not negative)
JO   target      ; Jump if V=1 (overflow)
JNO  target      ; Jump if V=0 (no overflow)
```

**9-bit signed offset** (-256 to +255 from PC+1)

#### 3.6.2 Register Jumps

**JMP - Jump to Register**
```assembly
JMP  R1          ; MOV PC, R1 - Jump to address in R1
```

**JML - Long Jump**
```assembly
JML  R2          ; CS = R2, PC = R3 (uses R2:R3 pair)
```
- **Far jump** to different code segment
- **R2** contains segment, **R3** contains offset

### 3.7 Subroutine Calls

#### 3.7.1 Traditional Call (3 cycles)
```assembly
; Clear but inefficient
LINK           ; MOV LR, PC, 2  - Store return address
JMP  function  ; Jump to function
NOP            ; Wasted delay slot
```

#### 3.7.2 Optimized Call (2 cycles)
```assembly
; Efficient using delay slot
JMP   function
ALINK          ; MOV LR, PC, 3 - Architectural read in delay slot
```

**Why This Works:**
- `MOV LR, PC, 3` reads the **architectural PC** (bypasses forwarding)
- Architectural PC during delay slot = address after delay slot
- **No pipeline stall** - operates in normal cycle time

#### 3.7.3 Function Prologue/Epilogue

**Standard Function:**
```assembly
my_function:
    ; Prologue
    MOV  FP, SP      ; Establish frame pointer
    SUB  SP, 8       ; Allocate 8 words local storage
    ST   LR, [FP+3]  ; Save return address
    ST   R12, [FP+2] ; Save callee-saved registers
    
    ; Function body
    ; ... your code ...
    
    ; Epilogue  
    LD   R12, [FP+2] ; Restore registers
    LD   LR, [FP+3]  ; Restore return address
    MOV  SP, FP      ; Deallocate stack frame
    JMP  LR          ; Return to caller
    NOP              ; Delay slot (can be used for cleanup)
```

### 3.8 System Instructions

**PSW Operations:**
```assembly
LPSW R1          ; R1 = PSW (load processor status word)
SETI             ; Enable interrupts (SET2 0)
CLRI             ; Disable interrupts (CLR2 0)
SETC             ; Set carry flag (SET 3)
CLRC             ; Clear carry flag (CLR 3)
```

**Segment Configuration:**
```assembly
SRS  R10         ; Use R10 for stack access (single register)
SRD  R12         ; Use R12/R13 (FP/SP) for stack access (dual registers)
ERS  R11         ; Use R11 for extra segment access
ERD  R10         ; Use R10/R11 for extra segment access
```

**Interrupt Control:**
```assembly
SWI              ; Software interrupt
RETI             ; Return from interrupt
FSH              ; Flush pipeline (synchronization)
```

**Halt:**
```assembly
HLT              ; Halt processor
```

---

## 4. Programming Techniques

### 4.1 Efficient Code Patterns

#### 4.1.1 Loop Structures

**Simple Counter Loop:**
```assembly
    LSI  R1, 100     ; Loop counter
loop:
    ; ... loop body ...
    SUB  R1, 1       ; Decrement counter
    JNZ  loop        ; Continue if not zero
    NOP              ; Delay slot
```

**Array Processing with Negative Offsets:**
```assembly
    LDI  array       ; R0 = array address
    MOV  R2, R0      ; R2 = current pointer
    LSI  R1, 64      ; R1 = element count
process_loop:
    LD   R3, [R2]    ; Load array element
    ; ... process R3 ...
    ADD  R2, 2       ; Next element (16-bit words)
    SUB  R1, 1       ; Decrement count
    JNZ  process_loop
    NOP              ; Delay slot
```

#### 4.1.2 Stack Frame Access

**Efficient Stack Access:**
```assembly
; Using negative offsets for stack frames
LD   R1, [FP-1]     ; Load parameter 1
LD   R2, [FP-2]     ; Load parameter 2  
ST   R3, [FP+1]     ; Store local variable 1
ST   R4, [FP+2]     ; Store local variable 2
```

### 4.2 Memory Management

#### 4.2.1 Initialization

**Reset State Setup:**
```assembly
; After reset:
; CS = 0xFFFF, DS = 0x0000, SS = 0x0000, ES = 0x0000
; SP = 0x7FFF, PC = 0x0000

; Typical startup code:
    LDI  0x1000      ; Setup data segment
    MVS  DS, R0
    LDI  0x8000      ; Setup stack segment  
    MVS  SS, R0
    LDI  0x2000      ; Setup extra segment
    MVS  ES, R0
    LDI  0x7FFF      ; Initialize stack pointer
    MOV  SP, R0
```

#### 4.2.2 Interrupt Handling

**Interrupt Service Routine:**
```assembly
interrupt_handler:
    ; On entry: All segments = 0, PSW' = old PSW
    ; Save working registers
    ST   R1, [SP-1]
    ST   R2, [SP-2]
    
    ; ... handle interrupt ...
    
    ; Restore registers
    LD   R2, [SP-2]
    LD   R1, [SP-1]
    
    RETI              ; Restores original segments and PSW
```

**Debugging Interrupts:**
```assembly
; In normal mode, inspect last interrupt context
debug_interrupt:
    SMV  R0, APC      ; R0 = PC' (interrupted address)
    SMV  R1, APSW     ; R1 = PSW' (interrupted flags)
    ; ... display debug info ...
```

### 4.3 I/O Programming

#### 4.3.1 Screen Output

**Setup Screen Access:**
```assembly
setup_screen:
    LDI  0xF000      ; I/O segment base
    MVS  ES, R0      ; ES = 0xF000
    LDI  0x1000      ; Screen buffer offset
    MOV  R10, R0     ; R10 = screen pointer
    ERD  R10         ; Use R10/R11 for ES access
    RET
```

**Write Character:**
```assembly
; R1 = character to write
; R10 = screen position
write_char:
    STS  R1, [R10]   ; Write character to screen
    ADD  R10, 2      ; Next screen position
    RET
```

### 4.4 Performance Optimization

#### 4.4.1 Delay Slot Scheduling

**Poor Scheduling:**
```assembly
ADD  R1, R2
JZ   target
NOP              ; Wasted cycle
```

**Good Scheduling:**
```assembly
ADD  R1, R2
JZ   target
MOV  R3, R4      ; Useful work in delay slot
```

**Excellent Scheduling (Subroutine Calls):**
```assembly
JMP  function
ALINK            ; Store return address in delay slot
```

#### 4.4.2 Using Negative Offsets

**Stack Frame Access:**
```assembly
; Instead of calculating offsets:
SUB  R0, SP, 4
LD   R1, [R0]

; Use negative offsets directly:
LD   R1, [SP-4]   ; Much cleaner!
```

---

## 5. Instruction Aliases

**Table 3: Instruction Aliases**

| Alias | Actual Instruction | Purpose |
|-------|-------------------|---------|
| **SWB Rx** | `ROL Rx, 8` | Swap bytes in register |
| **HALT** | `HLT` | Halt processor |
| **JMP Rx** | `MOV PC, Rx` | Unconditional jump to register |
| **LNK Rx** | `MOV Rx, PC, 2` | Link to subroutine |
| **ALNK Rx** | `MOV Rx, PC, 3` | Architectural link in delay slot |
| **ALINK** | `MOV LR, PC, 3` | Architectural link to LR |
| **AMV Rx, Ry** | `MOV Rx, Ry, 3` | Architectural move |
| **SETI** | `SET2 0` | Enable interrupts |
| **CLRI** | `CLR2 0` | Disable interrupts |
| **SETC** | `SET 3` | Set carry flag |
| **CLRC** | `CLR 3` | Clear carry flag |

---

## 6. Important Changes Summary

### 6.1 Critical Updates

**LDI Sign Extension:**
- `LDI -1` now loads `0xFFFF` (not `0x7FFF`)
- Essential for loading negative constants

**LD/ST Signed Offsets:**
- 5-bit offset is **sign-extended** (-16 to +15)
- Enables `LD R1, [SP-4]` syntax
- Much cleaner stack frame access

**Logical Immediate as Bit Positions:**
- `AND R1, 3` means `R1 AND (1 << 3)`  
- NOT `R1 AND 3`
- Powerful single-bit manipulation

**Reset State:**
- **CS = 0xFFFF** (boot from top of memory)
- **DS = 0x0000, SS = 0x0000, ES = 0x0000** (all others zero)
- **PC = 0x0000** (start at CS:0000)

**Interrupt Behavior:**
- Only **PSW** is saved to PSW'
- **All segments set to 0** during interrupts
- **Vector 0x0000 = NMI** (not Reset)

**No Memory Protection:**
- All memory fully accessible
- CS is read/write like other segments
- Self-modifying code permitted

### 6.2 Programming Impact

**Positive Changes:**
- Cleaner stack access with negative offsets
- Efficient negative constant loading with LDI
- Powerful bit manipulation with logical immediates
- Simplified interrupt handlers
- More flexible memory usage

**Things to Watch:**
- LDI now sign-extends (affects constant loading)
- Logical immediates work differently than arithmetic
- Interrupt handlers run in segment 0

---

*Deep16 Programmer's Manual v2.0 - Updated with all architectural changes*

This manual reflects the current Deep16 architecture with all recent simplifications and improvements. The changes make the processor more practical for embedded programming while maintaining the clean RISC philosophy.
