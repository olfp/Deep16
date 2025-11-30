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
- **Complete shadow register system** - Hardware-assisted interrupt handling
- **Memory-mapped I/O** - Simple peripheral access

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
LDI  -100        ; R0 = -100 (two's complement)
LDI  label       ; R0 = address of label
```
- **Always loads R0**
- **15-bit immediate** (sign-extended to 16 bits)
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
- **Bypasses pipeline forwarding** to read architectural state
- **No pipeline stall** - operates in normal cycle time
- **Essential for delay slot link instructions**
- **Reads stable register file value** ignoring pending writes

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
AND  R1, 0x0F    ; R1 = R1 AND 0x0F (clear upper bits)
OR   R1, 0x80    ; R1 = R1 OR 0x80 (set bit 7)
XOR  R1, R1      ; R1 = 0 (clear register)
```

**TBC/TBS - Test Bits**
```assembly
TBC  R1, R2      ; R1 AND R2 (set flags only)
TBC  R1, 0x08    ; Test if bit 3 is clear (Z=1 if clear)
TBS  R1, R2      ; R1 XOR R2 (set flags only)  
TBS  R1, 0x08    ; Test if bit 3 matches (Z=1 if same)
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

**SWB - Swap Bytes**
```assembly
SWB  R1          ; R1 = (R1 << 8) | (R1 >> 8)
```
- **Swaps high and low bytes**
- **Use for**: Endian conversion, data packing

### 3.3 Shift and Rotate Instructions

#### 3.3.1 Logical Shifts

**SL/SR - Shift Logical**
```assembly
SL   R1, 2       ; R1 = R1 << 2 (logical left shift)
SR   R1, 3       ; R1 = R1 >> 3 (logical right shift)
```
- **Shifts in zeros**
- **Carry flag** gets last bit shifted out

**SLC/SRC - Shift Logical with Carry**
```assembly
SLC  R1, 1       ; R1 = (R1 << 1) | C
SRC  R1, 1       ; R1 = (R1 >> 1) | (C << 15)
```
- **Carry flag is shifted into register**
- **Use for**: Multi-precision shifts

#### 3.3.2 Arithmetic Shifts

**SLA/SRA - Shift Arithmetic**
```assembly
SLA  R1, 2       ; R1 = R1 << 2 (arithmetic left)
SRA  R1, 3       ; R1 = R1 >> 3 (arithmetic right, sign-extended)
```
- **Preserves sign bit** for two's complement

#### 3.3.3 Rotate Operations

**ROL/ROR - Rotate**
```assembly
ROL  R1, 4       ; R1 = (R1 << 4) | (R1 >> 12)
ROR  R1, 4       ; R1 = (R1 >> 4) | (R1 << 12)
```
- **Bits wrap around** (no carry involvement)

**RLC/RRC - Rotate through Carry**
```assembly
RLC  R1, 1       ; Rotate left through carry
RRC  R1, 1       ; Rotate right through carry
```
- **Carry flag becomes part of rotation**
- **Use for**: Multi-word rotations

### 3.4 Multiply and Divide

**MUL/MUL32 - Multiply**
```assembly
MUL    R2, R3    ; R2 = R2 * R3 (16×16→16-bit)
MUL32  R4, R5    ; R4:R5 = R4 * R5 (R4 must be EVEN)
```
- **MUL32 requires EVEN register** (0,2,4,6,8,10,12,14)
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
- **5-bit unsigned offset** (0-31)
- **Uses DS segment** by default

**Enhanced Syntax (Assembler Preprocessing):**
```assembly
LD   R1, [R2+5]  ; Assembler converts to LD R1, R2, 5
ST   R1, [SP-4]  ; Assembler converts to ST R1, SP, 4
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

**Array Processing:**
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

#### 4.1.2 String Operations

**String Length:**
```assembly
; R1 = string pointer (zero-terminated)
string_length:
    LSI  R2, 0       ; R2 = length counter
length_loop:
    LD   R3, [R1]    ; Load character
    TBC  R3, 0x00FF  ; Test low byte for zero
    JZ   done        ; Found null terminator
    NOP
    ADD  R1, 2       ; Next character
    ADD  R2, 1       ; Increment length
    JMP  length_loop
    NOP
done:
    ; R2 contains string length
```

### 4.2 Memory Management

#### 4.2.1 Stack Usage

**Function with Parameters:**
```assembly
; Caller
    LDI  value1
    ST   R0, [SP-1]  ; Push parameter 1
    LDI  value2  
    ST   R0, [SP-2]  ; Push parameter 2
    JMP  my_function
    ALINK            ; Store return address
    
; Callee
my_function:
    MOV  FP, SP      ; Set frame pointer
    SUB  SP, 4       ; Allocate locals
    ST   LR, [FP+3]  ; Save return address
    
    LD   R1, [FP-1]  ; Access parameter 1
    LD   R2, [FP-2]  ; Access parameter 2
    
    ; ... function body ...
    
    LD   LR, [FP+3]  ; Restore return address
    MOV  SP, FP      ; Restore stack
    JMP  LR          ; Return
    NOP
```

#### 4.2.2 Heap Allocation

**Simple Heap Manager:**
```assembly
; R10 = heap pointer (initialized at program start)
allocate:
    ; R1 = size in words to allocate
    MOV  R2, R10     ; R2 = return pointer
    ADD  R10, R1     ; Advance heap pointer
    ADD  R10, R1     ; *2 for word addressing
    JMP  LR          ; Return allocation
    NOP
```

### 4.3 I/O Programming

#### 4.3.1 Screen Output

**Setup Screen Access:**
```assembly
setup_screen:
    LDI  0x0FFF      ; R0 = 0x0FFF
    INV  R0          ; R0 = 0xF000 (I/O segment)
    MVS  ES, R0      ; ES = 0xF000
    LDI  0x1000      ; R0 = screen buffer offset
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

#### 4.3.2 Timer Programming

**Setup Timer:**
```assembly
setup_timer:
    LDI  0x0FFF
    INV  R0
    MVS  ES, R0      ; ES = 0xF000
    
    LDI  1000        ; 1ms at 1MHz clock
    STS  R0, [0x0024] ; Set timer reload value
    
    LDI  1           ; Start timer
    STS  R0, [0x0020] ; Write to control register
    RET
```

### 4.4 Interrupt Handling

#### 4.4.1 Interrupt Service Routine

**Basic ISR Structure:**
```assembly
interrupt_handler:
    ; We're in interrupt context (PSW.S=1)
    ; SMV accesses NORMAL registers
    
    SMV  R0, APC      ; R0 = interrupted PC
    MOV  R1, R0       ; Save for later
    
    ; Save working registers if needed
    ST   R2, [SP-1]
    ST   R3, [SP-2]
    
    ; ... handle interrupt ...
    
    ; Restore registers
    LD   R3, [SP-2]
    LD   R2, [SP-1]
    
    RETI              ; Return to interrupted code
```

#### 4.4.2 Debugging with Shadow Registers

**Inspect Interrupt State:**
```assembly
debug_interrupt:
    ; Normal mode (PSW.S=0)
    ; SMV accesses SHADOW registers
    
    SMV  R0, APC      ; R0 = last interrupt PC
    SMV  R1, APSW     ; R1 = last interrupt PSW
    SMV  R2, ACS      ; R2 = last interrupt CS
    
    ; Display debug information...
    RET
```

### 4.5 Performance Optimization

#### 4.5.1 Delay Slot Scheduling

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

#### 4.5.2 Register Allocation

**Optimal Register Usage:**
- **R0**: LDI target, temporary calculations
- **R1-R6**: General purpose, caller-save
- **R7-R11**: Local variables within functions
- **R12 (FP)**: Frame pointer (callee-save)
- **R13 (SP)**: Stack pointer (callee-save)
- **R14 (LR)**: Return address (callee-save)

### 4.6 Common Idioms

#### 4.6.1 Constants and Masks

**Frequently Used Constants:**
```assembly
; Common constants in R7-R11 at function start
LSI  R7, -1      ; R7 = 0xFFFF (all ones)
LDI  0x0001
MOV  R8, R0      ; R8 = 1
LDI  0x00FF
MOV  R9, R0      ; R9 = 0x00FF (byte mask)
```

#### 4.6.2 Bit Manipulation

**Set/Clear/Toggle Bits:**
```assembly
; Set bit 3
OR   R1, 0x0008

; Clear bit 5
AND  R1, 0xFFDF

; Toggle bit 7
XOR  R1, 0x0080

; Test bit 2
TBC  R1, 0x0004
JNZ  bit_is_set
```

#### 4.6.3 Multi-Word Operations

**64-bit Addition:**
```assembly
; R1:R2 + R3:R4 → R1:R2
ADD  R2, R4      ; Add low words
JC   carry       ; Check for carry
NOP
high_add:
ADD  R1, R3      ; Add high words
JMP  done
NOP
carry:
ADD  R1, R3      ; Add high words
ADD  R1, 1       ; Add carry
done:
```

---

## 5. Assembler Usage

### 5.1 Enhanced Syntax

**Bracket Notation:**
```assembly
LD   R1, [R2+5]      ; Becomes: LD R1, R2, 5
ST   R1, [SP-4]      ; Becomes: ST R1, SP, 4
LD   R1, [R2]        ; Becomes: LD R1, R2, 0
```

**Plus Notation:**
```assembly
MOV  R1, R2+3        ; Becomes: MOV R1, R2, 3
```

### 5.2 Common Aliases

**Control Flow:**
```assembly
JMP  R1              ; Alias for: MOV PC, R1
LINK                 ; Alias for: MOV LR, PC, 2
ALINK                ; Alias for: MOV LR, PC, 3
```

**Flag Operations:**
```assembly
SETI                 ; Enable interrupts
CLRI                 ; Disable interrupts
SETC                 ; Set carry flag
CLRC                 ; Clear carry flag
```

### 5.3 Directives

**Common Assembler Directives:**
```assembly
.code               ; Code section
.data               ; Data section
.org  0x0100        ; Set origin
.word 0x1234        ; Define word
label:              ; Label definition
```

---

## 6. Troubleshooting Guide

### 6.1 Common Issues

**PC Reading in Delay Slots:**
- **Problem**: Reading PC in delay slot gives wrong address
- **Solution**: Use `ALINK` or `MOV Rx, PC, 3` for architectural read

**Segment Register Access:**
- **Problem**: Memory access uses wrong segment
- **Solution**: Use `LDS/STS` for explicit segment or configure PSW.SR/PSW.ER

**Pipeline Hazards:**
- **Problem**: Reading register immediately after write
- **Solution**: Pipeline handles most hazards automatically; use `AMV` for architectural state

### 6.2 Debugging Tips

**Register Inspection:**
- Use `LPSW` to examine processor state
- Use `SMV` to inspect shadow registers during debugging
- Check PSW flags after arithmetic operations

**Memory Issues:**
- Verify segment registers are properly set
- Check stack pointer alignment
- Use bracket syntax for clarity in memory operations

---

*Deep16 Programmer's Manual v1.0 - Complete practical reference for Deep16 assembly programming*
