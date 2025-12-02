# **Deep16 Programmer's Manual v5.1**
## **Complete Guide to Programming the Deep16 Processor**

---

## **1. Introduction**

### **1.1 About Deep16**
Deep16 is a 16-bit RISC processor designed for educational use and practical embedded systems. With its clean instruction set, segmented memory architecture, and innovative shadow register system, Deep16 provides a balance of simplicity, performance, and learning value.

### **1.2 Target Audience**
- **Students** learning computer architecture
- **Educators** teaching processor design
- **Hobbyists** building embedded systems
- **Developers** creating applications for Deep16

### **1.3 Documentation Structure**
- **This Manual**: Programming techniques and examples
- **Architecture Manual**: Complete instruction set and hardware details
- **Changes Document**: Revision history and encoding updates

---

## **2. Getting Started**

### **2.1 Development Environment**

**Required Tools:**
1. **Deep16 Assembler** - Converts assembly to machine code
2. **Deep16 Simulator** - Cycle-accurate processor simulation
3. **DeepCode IDE** - Integrated development environment
4. **FPGA Tools** - For hardware implementation (optional)

**Installation:**
```bash
# Clone the Deep16 repository
git clone https://github.com/deep16/deep16-tools
cd deep16-tools
make install
```

### **2.2 First Program**
```assembly
; hello.asm - Simple Deep16 program
.code 0x0000          ; Code segment 0

START:
    LDI  'H'          ; Load 'H' into R0
    MOV  R1, R0       ; Copy to R1
    LDI  0xF000       ; Screen segment
    INV  R0           ; R0 = 0x0FFF -> INV -> 0xF000
    MVS  ES, R0       ; Set ES to screen segment
    STS  R1, [0x1000] ; Write 'H' to screen position 0
    
    LDI  'e'          ; Next character
    MOV  R1, R0
    STS  R1, [0x1001] ; Write to next position
    
    HLT               ; Halt execution

.end
```

**Assemble and Run:**
```bash
deep16-asm hello.asm -o hello.bin
deep16-sim hello.bin
```

---

## **3. Core Programming Concepts**

### **3.1 Register Usage**

**General Purpose Registers:**
```assembly
R0  - LDI destination, temporary
R1  - General purpose
R2  - General purpose
R3  - General purpose
R4  - General purpose  
R5  - General purpose
R6  - General purpose
R7  - General purpose
R8  - General purpose
R9  - General purpose
R10 - General purpose (often used for ES access)
R11 - General purpose (often used for ES access)
R12 - Frame Pointer (FP)
R13 - Stack Pointer (SP)
R14 - Link Register (LR)
R15 - Program Counter (PC) - read-only
```

**Segment Registers:**
```assembly
CS - Code Segment (implicit for instruction fetch)
DS - Data Segment (default for LD/ST)
SS - Stack Segment (controlled by PSW.SR)
ES - Extra Segment (controlled by PSW.ER)
```

### **3.2 Addressing Modes**

**Direct Register:**
```assembly
MOV R1, R2       ; R1 = R2
ADD R3, R4       ; R3 = R3 + R4
```

**Register with Offset:**
```assembly
LD  R1, SP, -4   ; Load from stack frame
ST  R2, FP, 2    ; Store to frame pointer + 2
```

**Immediate:**
```assembly
LDI 0x1234       ; R0 = 0x1234
LSI R1, 5        ; R1 = 5
ADD R2, 3        ; R2 = R2 + 3
```

**Memory Indirect:**
```assembly
LDS R1, ES, [R2] ; Load from ES:R2
STS R3, DS, [R4] ; Store to DS:R4
```

### **3.3 PSW (Processor Status Word)**

**Bit Layout:**
```
Bit 0: N - Negative
Bit 1: Z - Zero  
Bit 2: V - Overflow
Bit 3: C - Carry
Bit 4: I - Interrupt Enable
Bit 5: S - Shadow View (read-only for user)
Bit 6-9: SR - Stack Register selection
Bit 10: DS - Dual Stack (0=single, 1=pair)
Bit 11-14: ER - Extra Register selection
Bit 15: DE - Dual Extra (0=single, 1=pair)
```

**Manipulating PSW:**
```assembly
; Flag operations
SETC            ; Set carry flag
CLRC            ; Clear carry flag
SETV            ; Set overflow flag
CLRV            ; Clear overflow flag
SETZ            ; Set zero flag
CLRZ            ; Clear zero flag
SETN            ; Set negative flag
CLRN            ; Clear negative flag

; Interrupt control
SETI            ; Enable interrupts
CLRI            ; Disable interrupts

; Full PSW access
LPSW R1         ; Load PSW into R1
; ... modify R1 ...
SPSW R1         ; Store R1 back to PSW

; Individual bit operations (bits 0-15)
SET  5          ; Set bit 5 (Shadow bit - read only)
CLR  3          ; Clear bit 3 (Carry)
```

---

## **4. Instruction Reference by Category**

### **4.1 Data Movement**

**Load Immediate:**
```assembly
LDI 0x1234       ; R0 = 0x1234 (sign-extended)
LSI R1, 31       ; R1 = 31 (sign-extended 5-bit)
```

**Register Moves:**
```assembly
MOV R1, R2       ; R1 = R2
MOV R3, R4, 1    ; R3 = R4 + 1
MOV R5, R6, 2    ; R5 = R6 + 2
MOV R7, R8, 3    ; R7 = R8 (architectural read)
```

**Segment Register Access:**
```assembly
MVS R1, CS       ; R1 = CS
MVS DS, R2       ; DS = R2
MVS ES, R3       ; ES = R3
```

**Shadow Register Access:**
```assembly
SMV R1, APC      ; R1 = PC' (shadow PC)
SMV R2, APSW     ; R2 = PSW' (shadow PSW)
SMV R3, AR0      ; R3 = R0' (shadow R0)
```

### **4.2 Arithmetic Operations**

**Addition/Subtraction:**
```assembly
ADD R1, R2       ; R1 = R1 + R2
ADD R3, 5        ; R3 = R3 + 5
SUB R4, R5       ; R4 = R4 - R5
SUB R6, 3        ; R6 = R6 - 3
```

**Comparison:**
```assembly
CMP R1, R2       ; Set flags based on R1 - R2
CMP R3, 0        ; Set flags based on R3 - 0
```

**Multiplication/Division:**
```assembly
MUL R1, R2       ; R1 = R1 × R2 (16-bit result)
MUL32 R4, R5     ; R4:R5 = R4 × R5 (R4 must be even)
DIV R1, R2       ; R1 = R1 ÷ R2 (quotient)
DIV32 R4, R5     ; R4 = quotient, R5 = remainder (R4 must be even)
```

### **4.3 Logical Operations**

**Bitwise Operations:**
```assembly
AND R1, R2       ; R1 = R1 & R2
AND R3, 5        ; R3 = R3 & (1 << 5)  - Clear all except bit 5
OR  R4, R5       ; R4 = R4 | R5
OR  R6, 7        ; R6 = R6 | (1 << 7)   - Set bit 7
XOR R7, R8       ; R7 = R7 ^ R8
XOR R9, 0        ; R9 = R9 ^ (1 << 0)   - Toggle bit 0
```

**Bit Testing:**
```assembly
TBC R1, R2       ; Test if ANY bits in R2 are SET in R1
                 ; Z=0 if any set, Z=1 if all clear
TBC R3, 5        ; Test if bit 5 is SET in R3
                 ; Z=0 if set, Z=1 if clear
TBS R4, R5       ; Test if R4 matches R5 exactly
                 ; Z=1 if exact match, Z=0 if any difference
```

**Single Operand Operations:**
```assembly
INV R1           ; R1 = ~R1 (bitwise complement)
NEG R2           ; R2 = -R2 (two's complement)
SWB R3           ; R3 = (R3 << 8) | (R3 >> 8) (byte swap)
```

### **4.4 Shift and Rotate Operations**

**Logical Shifts:**
```assembly
SL  R1, 3        ; R1 = R1 << 3 (logical left)
SR  R2, 2        ; R2 = R2 >> 2 (logical right)
```

**Arithmetic Shifts:**
```assembly
SLA R1, 3        ; R1 = R1 << 3 (arithmetic left)
SRA R2, 2        ; R2 = R2 >> 2 (arithmetic right, sign extended)
```

**Rotations:**
```assembly
ROL R1, 4        ; R1 = (R1 << 4) | (R1 >> 12)
ROR R2, 8        ; R2 = (R2 >> 8) | (R2 << 8) (byte swap)
```

**Carry-based Operations:**
```assembly
SLC R1, 3        ; Left shift with carry insertion
SRC R2, 2        ; Right shift with carry insertion
RLC R3, 1        ; Rotate left through carry
RRC R4, 1        ; Rotate right through carry
```

### **4.5 Memory Operations**

**Basic Load/Store:**
```assembly
LD  R1, R2, 0    ; R1 = [DS:R2]
LD  R3, SP, -4   ; R3 = [DS:SP-4] (stack access)
ST  R4, FP, 2    ; [DS:FP+2] = R4 (frame access)
```

**Segment-based Access:**
```assembly
LDS R1, ES, [R2] ; R1 = [ES:R2]
STS R3, CS, [R4] ; [CS:R4] = R3
```

### **4.6 Control Flow**

**Conditional Jumps:**
```assembly
JZ  label        ; Jump if Z=1 (zero)
JNZ label        ; Jump if Z=0 (not zero)
JC  label        ; Jump if C=1 (carry)
JNC label        ; Jump if C=0 (no carry)
JN  label        ; Jump if N=1 (negative)
JNN label        ; Jump if N=0 (not negative)
JO  label        ; Jump if V=1 (overflow)
JNO label        ; Jump if V=0 (no overflow)
```

**Unconditional Jump:**
```assembly
MOV PC, R1       ; Jump to address in R1
JMP R1           ; Assembler alias for above
```

**Far Jump (Different Segment):**
```assembly
; Setup: R2 = segment, R3 = offset
JML R2           ; CS = R2, PC = R3 (R2 must be even)
```

**Subroutine Calls:**
```assembly
; Traditional call (clear but inefficient)
LINK             ; MOV LR, PC, 2
JMP  subroutine
NOP              ; Wasted delay slot

; Optimized call (uses delay slot)
JMP   subroutine
ALINK            ; MOV LR, PC, 3 (in delay slot)

; Return from subroutine
JMP  LR          ; Return to caller
NOP              ; Delay slot
```

### **4.7 System Operations**

**Pipeline Control:**
```assembly
NOP              ; No operation
FSH              ; Flush pipeline
```

**Interrupt Handling:**
```assembly
SWI              ; Software interrupt
RETI             ; Return from interrupt
SETI             ; Enable interrupts
CLRI             ; Disable interrupts
```

**Processor Control:**
```assembly
HLT              ; Halt processor
```

---

## **5. Programming Techniques**

### **5.1 Function Calling Convention**

**Standard Prologue:**
```assembly
my_function:
    ; Save frame and allocate stack
    MOV  FP, SP          ; Set frame pointer
    SUB  SP, 8           ; Allocate 8 words
    ST   LR, [FP+7]      ; Save return address
    ST   OldFP, [FP+6]   ; Save old frame pointer
    ; ... function body ...
```

**Standard Epilogue:**
```assembly
    ; Restore and return
    LD   LR, [FP+7]      ; Restore return address
    MOV  SP, FP          ; Restore stack pointer
    JMP  LR              ; Return to caller
    NOP                  ; Delay slot
```

**Parameter Passing:**
```assembly
; Caller:
    LDI  param1
    MOV  R1, R0          ; Parameter 1 in R1
    LDI  param2
    MOV  R2, R0          ; Parameter 2 in R2
    JMP  function
    ALINK                ; Set return address
    
; Callee (function):
    ST   R1, [FP-1]      ; Save parameter 1
    ST   R2, [FP-2]      ; Save parameter 2
```

You're absolutely right! I made an error in the interrupt handling section. Let me correct this critical misunderstanding:

## **5.2 Interrupt Handling (Corrected)**

### **Correct Understanding of Interrupt Context**

**During Normal Execution (PSW.S=0):**
- `R0` refers to normal R0
- `PC` refers to normal PC  
- `PSW` refers to normal PSW
- Shadow registers are accessed via `SMV Rx, AR0`, `SMV Rx, APC`, etc.

**During Interrupt Execution (PSW.S=1):**
- `R0` refers to **shadow R0'** (the interrupt context register)
- `PC` refers to **shadow PC'** (the interrupt PC)
- `PSW` refers to **shadow PSW'** (the interrupt PSW)
- Normal registers are accessed via `SMV Rx, AR0`, `SMV Rx, APC`, etc.

### **Correct Interrupt Service Routine Example**

```assembly
timer_isr:
    ; We are in INTERRUPT CONTEXT (PSW.S=1)
    ; R0 here refers to R0' (shadow register)
    ; PC here refers to PC' (shadow PC)
    ; PSW here refers to PSW' (shadow PSW)
    
    ; Save critical NORMAL registers if needed
    ; To access normal R0, use SMV with AR0
    SMV  R0, AR0       ; R0' = R0 (normal) - Read normal R0 into shadow R0'
    ; Actually careful: SMV Rx, AR0 reads AR0 (normal R0) into Rx (shadow R0')
    ; So R0' now contains the value of normal R0
    
    ; Save normal PC (where interrupt occurred)
    SMV  R1, APC       ; R1' = APC (normal PC)
    ; R1' (shadow) now contains normal PC value
    
    ; Save normal PSW
    SMV  R2, APSW      ; R2' = APSW (normal PSW)
    
    ; Now we can use shadow registers R0', R1', R2' freely
    ; They won't affect the normal program's registers
    
    ; Handle timer interrupt using shadow registers
    LDI  TIMER_BASE    ; Load into R0' (shadow)
    MVS  ES, R0        ; ES' = timer segment (using shadow R0')
    LDS  R3, ES, [R0]  ; R3' = timer value (using shadow registers)
    
    ; Acknowledge interrupt
    LDI  1
    STS  R0, ES, [R0+2] ; Write using shadow registers
    
    ; If we modified normal registers via SMV writes, restore them
    ; But we only read, so no restoration needed
    
    ; Return from interrupt
    RETI               ; Hardware switches back to normal context
                      ; PSW'.S = 0, back to normal registers
```

### **Understanding SMV in Different Contexts**

**SMV Always Reads Alternate Context:**
```
Format: SMV Rx, alt_sel

In Normal Mode (PSW.S=0):
  SMV R1, AR0    ; R1 = R0' (reads shadow R0' into normal R1)
  SMV R1, APC    ; R1 = PC' (reads shadow PC' into normal R1)

In Interrupt Mode (PSW.S=1):
  SMV R1, AR0    ; R1 = R0 (reads normal R0 into shadow R1')
  SMV R1, APC    ; R1 = PC (reads normal PC into shadow R1')
```

**Key Insight:** `SMV` always reads **from the alternate context into the current context**.

### **Complete Interrupt Handling Example**

```assembly
; ============================================
; INTERRUPT VECTOR SETUP
; ============================================
.org 0x0001            ; Hardware interrupt vector
.dw  timer_interrupt_handler

; ============================================
; INTERRUPT HANDLER
; ============================================
timer_interrupt_handler:
    ; ****************************************************************
    ; CRITICAL: We are in INTERRUPT CONTEXT (PSW.S=1)
    ; All register references (R0, R1, etc.) refer to SHADOW REGISTERS
    ; To access NORMAL registers, use SMV with ARx prefixes
    ; ****************************************************************
    
    ; ----------------------------------------------------------------
    ; 1. SAVE NORMAL CONTEXT (if handler might modify normal regs)
    ; ----------------------------------------------------------------
    ; Save normal R0-R2 to shadow registers (so we can use them)
    SMV  R0, AR0        ; R0' = R0 (normal) - save normal R0 to shadow R0'
    SMV  R1, AR1        ; R1' = R1 (normal) - save normal R1 to shadow R1'
    SMV  R2, AR2        ; R2' = R2 (normal) - save normal R2 to shadow R2'
    
    ; Save normal R13 (SP) and R14 (LR) if interrupt might nest
    SMV  R3, AR13       ; R3' = R13 (normal SP)
    SMV  R4, AR14       ; R4' = R14 (normal LR)
    
    ; Save normal PC and PSW for debugging
    SMV  R5, APC        ; R5' = PC (normal) - where interrupt occurred
    SMV  R6, APSW       ; R6' = PSW (normal) - state during interrupt
    
    ; ----------------------------------------------------------------
    ; 2. SET UP INTERRUPT WORKING ENVIRONMENT
    ; ----------------------------------------------------------------
    ; Configure ES for I/O access (using shadow registers)
    LDI  0x0FFF         ; Load into R0' (shadow)
    INV  R0             ; R0' = 0xF000 (I/O segment)
    MVS  ES, R0         ; ES' = 0xF000 (using shadow R0')
    
    ; ----------------------------------------------------------------
    ; 3. HANDLE THE INTERRUPT
    ; ----------------------------------------------------------------
    ; Read timer value
    LDS  R7, ES, [0x0020]  ; R7' = timer value
    
    ; Process timer interrupt
    ; ... timer handling code using shadow registers ...
    
    ; Acknowledge interrupt to controller
    LDI  1
    STS  R0, ES, [0x0012]  ; Acknowledge (using shadow R0')
    
    ; ----------------------------------------------------------------
    ; 4. RESTORE NORMAL CONTEXT (if we saved it)
    ; ----------------------------------------------------------------
    ; If we modified normal registers via SMV writes, restore them
    ; But SMV is READ-ONLY from alternate context, so we can't modify
    ; normal registers directly. If we need to modify normal state,
    ; we must do it explicitly or leave it modified.
    
    ; Example: If we wanted to increment a counter in normal memory
    LDI  COUNTER_ADDR
    MOV  R1, R0          ; R1' = counter address
    LD   R2, R1, 0       ; R2' = counter value (from normal memory via DS)
    ADD  R2, 1           ; Increment
    ST   R2, R1, 0       ; Store back
    
    ; ----------------------------------------------------------------
    ; 5. RETURN FROM INTERRUPT
    ; ----------------------------------------------------------------
    RETI                 ; Hardware: PSW'.S = 0, back to normal context
                        ; All shadow register values are preserved
                        ; for next interrupt or debugging
```

### **Debugging Interrupt State**

**From Normal Mode:**
```assembly
; Check what happened during last interrupt
debug_last_interrupt:
    ; We're in NORMAL MODE (PSW.S=0)
    ; SMV accesses SHADOW registers (interrupt context)
    
    SMV  R1, APC        ; R1 = PC' (interrupt PC - where interrupt handler jumped)
    SMV  R2, APSW       ; R2 = PSW' (interrupt PSW - typically 0x0020)
    SMV  R3, AR0        ; R3 = R0' (shadow R0' value from interrupt)
    
    ; Display these for debugging
    ; ... debug code ...
    RET
```

**From Interrupt Mode (for nested interrupts):**
```assembly
nested_interrupt_handler:
    ; We're in INTERRUPT MODE (PSW.S=1) from first interrupt
    ; Now handling nested interrupt
    
    ; Save previous interrupt's shadow registers
    ; SMV now reads NORMAL registers (since we're in interrupt mode)
    ; But we want previous interrupt's shadow registers...
    ; This is tricky - we need to save to memory
    
    ; Better design: Don't allow nested interrupts
    ; Or use different mechanism for saving context
```

### **Interrupt-Related Macros**

```assembly
; Macro to save normal registers to shadow context
.macro SAVE_NORMAL_REGS
    SMV  R0, AR0        ; Save normal R0 to shadow R0'
    SMV  R1, AR1        ; Save normal R1 to shadow R1'
    SMV  R2, AR2        ; Save normal R2 to shadow R2'
    ; Add more as needed
.endm

; Macro to check if we're in interrupt context
.macro CHECK_INTERRUPT_CONTEXT
    LPSW R0             ; Load PSW of current context
    TBC  R0, 5          ; Test Shadow bit (bit 5)
    JNZ  in_interrupt   ; If set, we're in interrupt context
    ; ... normal mode code ...
in_interrupt:
    ; ... interrupt mode code ...
.endm
```

### **Important Rules for Interrupt Handlers**

1. **Register References**: In interrupt mode, `Rx` refers to shadow `Rx'`
2. **SMV Behavior**: Always reads from alternate context into current context
3. **Context Preservation**: Shadow registers persist across interrupts
4. **No Register Pollution**: Interrupts don't modify normal registers (unless via memory)
5. **Fast Interrupts**: Don't need to save/restore registers (use shadows)
6. **Debugging**: Use SMV to examine both contexts

### **Complete System with Interrupts**

```assembly
; ============================================
; SYSTEM INITIALIZATION WITH INTERRUPTS
; ============================================
system_init:
    ; Disable interrupts during setup
    CLRI
    
    ; Set interrupt vectors
    LDI  timer_isr
    MOV  R1, R0
    ST   R1, [0x0001]   ; HW interrupt vector
    
    LDI  swi_isr
    MOV  R1, R0
    ST   R1, [0x0002]   ; SWI vector
    
    ; Configure timer for interrupts
    LDI  0x0FFF
    INV  R0
    MVS  ES, R0         ; ES = I/O segment
    
    LDI  1000           ; 1ms at 1MHz
    STS  R0, [0x0024]   ; Timer reload
    
    LDI  0x03           ; Start + interrupt enable
    STS  R0, [0x0020]   ; Timer control
    
    ; Enable in interrupt controller
    LDI  0x01           ; Enable timer interrupt
    STS  R0, [0x0010]   ; Interrupt mask
    
    ; Enable interrupts globally
    SETI
    
    ; Main program loop
main_loop:
    ; ... main program ...
    JMP  main_loop
    NOP

; ============================================
; TIMER INTERRUPT HANDLER (CORRECT)
; ============================================
timer_isr:
    ; INTERRUPT CONTEXT: Using shadow registers
    
    ; Use shadow R0' for I/O address
    LDI  0x0FFF
    INV  R0             ; R0' = 0xF000
    
    ; We could save normal registers if needed:
    ; SMV R1, AR0       ; Save normal R0 to shadow R1'
    
    ; But for simple timer, just handle it
    MVS  ES, R0         ; ES' = I/O segment
    
    ; Read timer (optional)
    LDS  R1, ES, [0x0022]  ; R1' = timer value
    
    ; Acknowledge
    LDI  1
    STS  R0, ES, [0x0012]  ; Acknowledge
    
    ; Update a counter in normal memory
    LDI  timer_counter
    MOV  R2, R0          ; R2' = counter address
    LD   R3, R2, 0       ; R3' = counter value (from normal memory)
    ADD  R3, 1           ; Increment in shadow register
    ST   R3, R2, 0       ; Store back to normal memory
    
    RETI

; ============================================
; DATA SECTION
; ============================================
.data
timer_counter: .dw 0
```

### **5.3 Screen Output**

**Screen Setup:**
```assembly
setup_screen:
    LDI  0x0FFF
    INV  R0             ; R0 = 0xF000 (screen segment)
    MVS  ES, R0         ; ES = 0xF000
    
    ; Use R10:R11 for efficient screen writes
    LDI  0x1000         ; Screen buffer offset
    MOV  R10, R0
    LDI  0
    MOV  R11, R0
    ; ERD R10 would set PSW.ER=10, PSW.DE=1
    ; But we need LPSW/SPSW for that...
    LPSW R1
    AND  R1, 0xFC3F     ; Clear ER field
    LDI  10
    AND  R0, 0x000F
    SL   R0, 8          ; Shift to ER position
    OR   R1, R0
    OR   R1, 0x0800     ; Set DE=1
    SPSW R1
    RET
```

**Character Output:**
```assembly
print_char:
    ; R1 contains character
    ; R10:R11 contains screen position
    STS  R1, [R10+0]    ; Write character
    ADD  R10, 1         ; Next position
    ADC  R11, 0         ; Handle carry
    RET
```

### **5.4 String Operations**

**String Length:**
```assembly
; Input: R1 = string address in DS
; Output: R2 = length
strlen:
    LDI  0
    MOV  R2, R0         ; R2 = length counter
strlen_loop:
    LD   R3, R1, 0      ; Load character
    CMP  R3, 0          ; Check for null terminator
    JZ   strlen_done
    ADD  R1, 1          ; Next character
    ADD  R2, 1          ; Increment length
    JMP  strlen_loop
    NOP
strlen_done:
    RET
```

**String Copy:**
```assembly
; Input: R1 = source, R2 = destination
strcpy:
    LD   R3, R1, 0      ; Load character
    ST   R3, R2, 0      ; Store character
    CMP  R3, 0          ; Check for null
    JZ   strcpy_done
    ADD  R1, 1          ; Next source
    ADD  R2, 1          ; Next destination
    JMP  strcpy
    NOP
strcpy_done:
    RET
```

### **5.5 Math Operations**

**32-bit Addition:**
```assembly
; Input: R0:R1 = a, R2:R3 = b
; Output: R0:R1 = a + b
add32:
    ADD  R1, R3         ; Add low words
    ADC  R0, R2         ; Add high words with carry
    RET
```

**32-bit Subtraction:**
```assembly
; Input: R0:R1 = a, R2:R3 = b  
; Output: R0:R1 = a - b
sub32:
    SUB  R1, R3         ; Subtract low words
    SBC  R0, R2         ; Subtract high words with borrow
    RET
```

**16×16→32-bit Multiplication:**
```assembly
; Input: R0 = a, R1 = b
; Output: R2:R3 = a × b
mul16to32:
    MUL32 R2, R1        ; R2:R3 = R2 × R1 (R2 must be even)
    ; Need to save R0 first, then use even register...
    MOV  R4, R0         ; Save a
    LDI  0
    MOV  R2, R0         ; R2 = 0 (even)
    MOV  R2, R4         ; R2 = a
    MUL32 R2, R1        ; R2:R3 = a × b
    RET
```

---

## **6. Common Patterns and Idioms**

### **6.1 Delay Slot Optimization**

**Always fill delay slots:**
```assembly
; BAD - Wasted cycle
CMP  R1, R2
JZ   equal
NOP              ; Wasted

; GOOD - Useful work
CMP  R1, R2
JZ   equal
MOV  R3, R4      ; Executes regardless

; BEST - ALINK optimization
JMP  subroutine
ALINK            ; Set return address in delay slot
```

### **6.2 Constant Generation**

**Common Constants:**
```assembly
; Generate 0
LDI  0           ; R0 = 0

; Generate 1
LDI  1           ; R0 = 1

; Generate -1
LDI  -1          ; R0 = 0xFFFF (sign-extended)

; Generate 0xFFFF (all ones)
LDI  -1          ; R0 = 0xFFFF

; Generate 0xF000 (screen segment)
LDI  0x0FFF
INV  R0          ; R0 = 0xF000
```

### **6.3 Loop Structures**

**Counted Loop:**
```assembly
    LDI  100
    MOV  R1, R0         ; R1 = counter
loop:
    ; ... loop body ...
    SUB  R1, 1          ; Decrement counter
    JNZ  loop           ; Continue if not zero
    NOP
```

**Pointer-based Loop:**
```assembly
    MOV  R1, start      ; R1 = pointer
    MOV  R2, end        ; R2 = end pointer
loop:
    CMP  R1, R2
    JZ   done           ; Reached end
    ; ... process [R1] ...
    ADD  R1, 1          ; Next element
    JMP  loop
    NOP
done:
```

### **6.4 Conditional Execution**

**If-Then:**
```assembly
    CMP  R1, R2
    JNZ  not_equal
    ; ... then code ...
    JMP  end_if
    NOP
not_equal:
    ; ... else code ...
end_if:
```

**If-Then-Else:**
```assembly
    CMP  R1, 0
    JZ   is_zero
    ; ... not zero code ...
    JMP  end_if
    NOP
is_zero:
    ; ... zero code ...
end_if:
```

### **6.5 Switch/Case Implementation**

```assembly
    ; R1 contains value
    CMP  R1, 0
    JZ   case0
    CMP  R1, 1
    JZ   case1
    CMP  R1, 2
    JZ   case2
    JMP  default
    NOP
    
case0:
    ; ... case 0 code ...
    JMP  end_switch
    NOP
    
case1:
    ; ... case 1 code ...
    JMP  end_switch
    NOP
    
case2:
    ; ... case 2 code ...
    JMP  end_switch
    NOP
    
default:
    ; ... default code ...
    
end_switch:
```

---

## **7. System Programming**

### **7.1 Memory Layout**

```
0x00000-0xDFFFF: Home Segment (896KB)
0xE0000-0xEFFFF: Graphics Segment (64KB) - Future use
0xF0000-0xFFFFF: I/O Segment (64KB)
   0xF0000-0xF000F: System LED Controller
   0xF0010-0xF001F: Interrupt Controller (SIC)
   0xF0020-0xF002F: Timer/Counter
   0xF0030-0xF003F: Video Display Controller
   0xF0040-0xF004F: Serial Port (UART)
   0xF0060-0xF006F: Keyboard Controller
   0xF1000-0xF17CF: Screen Buffer (80×25 characters)
0xFFFF0-0xFFFFF: Boot ROM (16 words)
```

### **7.2 I/O Programming Examples**

**Timer Programming:**
```assembly
setup_timer:
    LDI  0x0FFF
    INV  R0             ; R0 = 0xF000
    MVS  ES, R0         ; ES = I/O segment
    
    ; Configure for 1ms interrupts at 1MHz
    LDI  1000           ; Reload value
    STS  R0, [0x0024]   ; Timer reload register
    
    LDI  0x03           ; Start timer + enable interrupt
    STS  R0, [0x0020]   ; Timer control register
    RET
```

**Keyboard Input:**
```assembly
read_key:
    LDI  0x0FFF
    INV  R0
    MVS  ES, R0
    
wait_key:
    LDS  R1, [0x0060]   ; Keyboard status
    TBC  R1, 0          ; Test data ready bit
    JZ   wait_key       ; Wait if no key
    
    LDS  R2, [0x0062]   ; Read scan code
    RET
```

**Serial Communication:**
```assembly
serial_putc:
    ; R1 contains character
    LDI  0x0FFF
    INV  R0
    MVS  ES, R0
    
wait_tx:
    LDS  R2, [0x0040]   ; Serial status
    TBC  R2, 1          ; Test TX ready
    JZ   wait_tx
    
    STS  R1, [0x0042]   ; Send character
    RET
```

### **7.3 Boot Sequence**

**Boot ROM Code:**
```assembly
; Located at 0xFFFF0-0xFFFFF
.org 0xFFFF0

boot_start:
    LDI  0x0000
    MVS  DS, R0         ; DS = 0x0000
    MVS  SS, R0         ; SS = 0x0000
    
    LDI  0x7FFF
    MOV  SP, R0         ; SP = 0x7FFF (top of stack)
    
    LDI  0x0100         ; User program start
    MOV  R1, R0
    ST   R1, [0x0000]   ; Set reset vector
    
    LDI  user_start
    MOV  PC, R0         ; Jump to user code
    NOP
    
user_start:
    ; User program begins here
```

---

## **8. Advanced Topics**

### **8.1 Shadow Register System**

**Understanding Contexts:**
- **Normal Context** (PSW.S=0): Uses normal registers
- **Shadow Context** (PSW.S=1): Uses shadow registers
- **Automatic switch** on interrupt entry/exit

**Accessing Other Context:**
```assembly
; In normal mode, read shadow registers
SMV R1, APC      ; R1 = PC' (shadow PC)
SMV R2, APSW     ; R2 = PSW' (shadow PSW)

; In interrupt mode, read normal registers  
SMV R1, APC      ; R1 = PC (normal PC)
SMV R2, APSW     ; R2 = PSW (normal PSW)
```

### **8.2 Memory Segmentation**

**Address Calculation:**
```
Physical Address = (Segment << 4) + Offset
```

**Segment Selection:**
- **CS**: Always for instruction fetch
- **DS**: Default for data (LD/ST)
- **SS**: When PSW.SR points to register
- **ES**: When PSW.ER points to register or explicit LDS/STS

**Setting Up Segments:**
```assembly
; Setup for screen access
LDI  0xF000
MVS  ES, R0         ; ES = screen segment
LDI  10
MOV  R10, R0
; Use LPSW/SPSW to set PSW.ER=10, PSW.DE=1
```

### **8.3 Performance Optimization**

**Minimize Pipeline Stalls:**
- Always fill delay slots
- Use ALINK for subroutine calls
- Schedule independent instructions after loads

**Efficient Register Usage:**
- Keep frequently used values in registers
- Use R0 for immediate values
- Reserve R12-R14 for stack frame

**Memory Access Patterns:**
- Group memory operations together
- Use negative offsets for stack access
- Cache frequently accessed data in registers

---

## **9. Debugging Techniques**

### **9.1 Common Issues**

**Pipeline Hazards:**
```assembly
; Problem: Load-use hazard
LD   R1, R2, 0
ADD  R3, R1        ; Stalls - R1 not ready yet

; Solution: Schedule other work
LD   R1, R2, 0
ADD  R4, R5        ; Independent operation
ADD  R3, R1        ; Now R1 is ready
```

**Incorrect Return Address:**
```assembly
; Wrong: LINK in wrong place
LINK               ; MOV LR, PC, 2
JMP  func
ADD  R1, R2        ; This becomes return address!

; Correct: Optimized call
JMP  func
ALINK              ; MOV LR, PC, 3 (in delay slot)
```

### **9.2 Debugging Tools**

**Register Inspection:**
```assembly
; Dump registers to screen
debug_regs:
    LPSW R1
    ; ... display R1 and other registers ...
    RET
```

**Memory Dump:**
```assembly
; Dump memory region
; R1 = start address, R2 = count
dump_mem:
    LD   R3, R1, 0
    ; ... display R3 ...
    ADD  R1, 1
    SUB  R2, 1
    JNZ  dump_mem
    NOP
    RET
```

### **9.3 Using the Simulator**

**Common Commands:**
```
run                - Execute program
step               - Single step
regs               - Show registers
mem 0x1000 16      - Show 16 words at 0x1000
break 0x1234       - Set breakpoint
watch R1           - Watch register R1
trace              - Enable instruction trace
```

**Example Session:**
```
deep16-sim program.bin
> break 0x0100
> run
Breakpoint at 0x0100
> regs
R0: 0x0000  R1: 0x1234  R2: 0x0000 ...
> step
> regs
R0: 0x0001  R1: 0x1234  R2: 0x0000 ...
```

---

## **10. Appendix**

### **10.1 Quick Reference Card**

**Instruction Formats:**
```
LDI:       0 imm15
LD/ST:     10 d Rd Rb offset
ALU2:      110 func Rd Rs/imm
JMP:       1110 type target
LDS/STS:   11110 d seg Rd Rb
MOV:       111110 Rd Rs imm
LSI:       1111110 Rd imm
SMV:       11111110 Rx alt_sel
MVS:       111111110 d Rd seg
SOP:       1111111110 type Rx
SET/CLR:   11111111110 d imm
JML:       111111111110 Rx
SYS:       1111111111110 op
HLT:       1111111111111111
```

**Common Aliases:**
```
JMP Rx     = MOV PC, Rx
LINK       = MOV LR, PC, 2
ALINK      = MOV LR, PC, 3
SWB Rx     = ROL Rx, 8
SETC       = SET 3
CLRC       = CLR 3
SETI       = SETI (SYS)
CLRI       = CLRI (SYS)
```

### **10.2 PSW Bit Reference**

```
Bit  Operation      Instruction
---  -----------    -----------
0    Set Negative   SET 0 / SETN
     Clear Negative CLR 0 / CLRN
1    Set Zero       SET 1 / SETZ
     Clear Zero     CLR 1 / CLRZ
2    Set Overflow   SET 2 / SETV
     Clear Overflow CLR 2 / CLRV
3    Set Carry      SET 3 / SETC
     Clear Carry    CLR 3 / CLRC
4    Enable Int     SETI (SYS)
     Disable Int    CLRI (SYS)
5    Shadow View    Read via LPSW
6-9  Stack Register LPSW/SPSW
10   Dual Stack     LPSW/SPSW
11-14 Extra Register LPSW/SPSW
15   Dual Extra     LPSW/SPSW
```

### **10.3 Common Constants**

```assembly
ZERO    = 0x0000
ONE     = 0x0001
MINUS1  = 0xFFFF
SCREEN  = 0xF000
STACK_TOP = 0x7FFF
```

### **10.4 Revision History**

**v5.1 (2024-03-20):**
- Added 11-bit SET/CLR instructions
- Moved LPSW to SOP space (shorter encoding)
- Moved JML to 12-bit prefix
- Added SETI/CLRI to SYS space
- Fixed PSW bit layout
- Updated all examples

**v5.0 (2024-03-20):**
- Initial comprehensive programmer's manual
- Complete instruction reference
- Programming examples and patterns
- System programming guide

---

## **11. Getting Help**

### **11.1 Resources**
- **GitHub Repository**: https://github.com/deep16
- **Documentation**: https://deep16.dev/docs
- **Forum**: https://forum.deep16.dev
- **Examples**: https://github.com/deep16/examples

### **11.2 Reporting Issues**
```bash
# Create issue on GitHub
deep16-bugreport program.asm error.log
```

### **11.3 Contributing**
1. Fork the repository
2. Create a feature branch
3. Submit a pull request
4. Include tests and documentation

---

**Deep16 Programmer's Manual v5.1**  
*Updated: 2024-03-20*  
*For Deep16 Architecture Specification v5.1*  

*Happy Programming!*
