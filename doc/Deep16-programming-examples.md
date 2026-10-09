# Deep16 (深十六) Programming Examples
## Architecture v3.5 (1r13) - Example Programs

---

## 1. Basic Arithmetic Examples

### 1.1 Simple Addition
```assembly
; Add two numbers and store result
.org 0x0000

main:
    LDI  0x3FFF           ; LDI sign-extends, so build 0x7FFF with a shift
    MOV  SP, R0 << 1 + 1  ; Initialize stack (SP = 0x7FFF)
    LSI  R0, 5            ; Load first operand
    LSI  R1, 7            ; Load second operand
    ADD  R0, R1           ; R0 = 5 + 7 = 12
    ST   R0, SP, 0        ; Store result on stack
    HALT
```

### 1.2 Comparison and Conditional Jump
```assembly
; Compare two numbers and branch
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    LSI  R0, 10
    LSI  R1, 5
    
    ; Compare R0 and R1
    SUB  R0, R1, w=0   ; CMP operation - sets flags only
    JN   negative      ; Jump if R0 < R1
    NOP                ; delay slot (NOP preserves flags)
    JZ   equal         ; Jump if R0 == R1
    NOP                ; delay slot
    
    ; R0 > R1 case
    LSI  R2, 1
    LDI  done          ; absolute jump = LDI target + MOV PC, R0 (LDI uses R0)
    MOV  PC, R0
    NOP                ; delay slot
    
negative:
    LSI  R2, -1
    LDI  done
    MOV  PC, R0
    NOP                ; delay slot
    
equal:
    LSI  R2, 0
    
done:
    HALT
```

### 1.3 Bit Manipulation
```assembly
; Bitwise operations example
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    LDI  0x00FF           ; Load test value
    
    ; Various bit operations
    AND  R1, R0, 0xF   ; R1 = 0x000F (mask lower 4 bits)
    OR   R2, R0, 0xF0  ; R2 = 0x00FF (set upper 4 bits)
    XOR  R3, R0, 0xFF  ; R3 = 0x0000 (invert all bits)
    INV  R4, R0        ; R4 = 0xFF00 (ones complement)
    NEG  R5, R0        ; R5 = 0xFF01 (twos complement)
    
    HALT
```

---

## 2. Memory Access Examples

### 2.1 Stack Operations
```assembly
; Stack push/pop operations
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; Initialize stack pointer (SP = 0x7FFF)
    
    ; Push values to stack
    LDI  0x2B3C        ; Build 0x5678 (bit 14 set): LDI sign-extends,
    MOV  R1, R0 << 1   ; so form it as 0x2B3C << 1 = 0x5678
    LDI  0x1234        ; R0 = 0x1234 (LDI always writes R0)
    ST   R0, SP, 0     ; Push R0
    SUB  SP, 1         ; Decrement stack pointer
    ST   R1, SP, 0     ; Push R1
    SUB  SP, 1         ; Decrement stack pointer
    
    ; Pop values from stack
    ADD  SP, 1         ; Increment stack pointer
    LD   R2, SP, 0     ; Pop into R2
    ADD  SP, 1         ; Increment stack pointer  
    LD   R3, SP, 0     ; Pop into R3
    
    HALT
```

### 2.2 Array Processing
```assembly
; Process an array of numbers
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    LDI  array         ; Array base address
    LSI  R1, 0         ; Sum register
    LSI  R2, 5         ; Array length
    
sum_loop:
    LD   R3, R0, 0     ; Load array element
    ADD  R1, R3        ; Add to sum
    ADD  R0, 1         ; Next array element
    SUB  R2, 1         ; Decrement counter (sets flags)
    JNZ  sum_loop      ; Loop until done
    NOP                ; delay slot
    
    ST   R1, SP, 0     ; Store sum on stack
    HALT

.org 0x0100
array:
    .word 10, 20, 30, 40, 50
```

### 2.3 String Copy
```assembly
; Copy a null-terminated string
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    LDI  dest
    MOV  R1, R0        ; Destination buffer
    LDI  src_str       ; Source string (R0 — loaded last, LDI always writes R0)
    
copy_loop:
    LD   R2, R0, 0     ; Load source character
    ST   R2, R1, 0     ; Store to destination
    ADD  R0, 1         ; Next source char
    ADD  R1, 1         ; Next dest char
    
    ; Check for null terminator
    CMP  R2, 0         ; Test if character is 0 (sets flags)
    JNZ  copy_loop     ; Continue if not zero
    NOP                ; delay slot
    
    HALT

.org 0x0200
src_str:
    .word 'H', 'e', 'l', 'l', 'o', 0
    
.org 0x0300  
dest:
    .word 0
```

---

## 3. Control Flow Examples

### 3.1 Function Call with Stack
```assembly
; Function call example with stack frame
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    
    ; Call function (target loaded first — LDI always writes R0)
    LDI  add_function  ; R0 = function address
    MOV  R4, R0        ; keep it in R4
    LDI  20
    MOV  R1, R0        ; Argument 2
    LSI  R0, 10        ; Argument 1
    MOV  LR, PC, 2     ; Save return address (= instruction after the delay slot)
    JMP  R4            ; Jump to add_function
    NOP                ; Delay slot
    
    ; Function result in R0 (return lands here)
    ST   R0, SP, 0     ; Store result
    HALT

add_function:
    ; Function prologue
    ST   FP, SP, 0     ; Save old frame pointer
    SUB  SP, 1         ; Allocate stack frame
    MOV  FP, SP, 0     ; Set new frame pointer
    
    ; Function body
    ADD  R0, R1        ; R0 = R0 + R1
    
    ; Function epilogue  
    ADD  SP, 1         ; Deallocate stack frame
    LD   FP, SP, 0     ; Restore frame pointer
    MOV  PC, LR        ; Return to caller
    NOP                ; delay slot
```

### 3.2 Fibonacci Sequence (Optimized)
```assembly
; Calculate Fibonacci numbers efficiently
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    LDI  result
    MOV  R3, R0        ; Output address (set up before LDI clobbers R0)
    LDI  0             ; F(0) = 0
    LSI  R1, 1         ; F(1) = 1
    LSI  R2, 10        ; Calculate up to F(10)
    
fib_loop:
    ST   R0, R3, 0     ; Store current Fibonacci
    ADD  R3, 1         ; Next output address
    
    ; Calculate next Fibonacci: R0, R1 = R1, R0+R1
    MOV  R4, R1        ; temp = current
    ADD  R1, R0        ; next = current + previous
    MOV  R0, R4        ; previous = temp
    
    SUB  R2, 1         ; decrement counter (sets flags)
    JNZ  fib_loop      ; loop if not zero
    NOP                ; delay slot
    
    HALT

.org 0x0200
result:
    .word 0
```

---

## 4. Interrupt Handling Examples

### 4.1 Minimal Interrupt Handler
```assembly
; Simple interrupt handler
.org 0x0000
main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    SETI               ; Enable interrupts
    ; Main program continues...
    HALT

; Interrupt handler (installed via the vector table)
.org 0x0020
irq_handler:
    ; Hardware automatically saves context to shadow registers
    
    ; Minimal handler - just acknowledge and return
    ST   R0, SP, 0     ; Save R0 if needed
    ; ... process interrupt ...
    LD   R0, SP, 0     ; Restore R0
    
    RETI               ; Hardware restores context
```

### 4.2 Context Saving Interrupt Handler
```assembly
; Interrupt handler with full context save
.org 0x0020
irq_handler:
    ; Save critical registers to stack
    ST   R0, SP, 0
    ST   R1, SP, 1
    ST   R2, SP, 2
    
    ; Access pre-interrupt state if needed
    SMV  R3, APSW      ; Get saved PSW
    SMV  R4, APC       ; Get interrupted PC
    
    ; ... interrupt processing ...
    
    ; Restore registers
    LD   R2, SP, 2
    LD   R1, SP, 1  
    LD   R0, SP, 0
    
    RETI
```

---

## 5. PSW and Segment Control Examples

### 5.1 PSW Flag Manipulation
```assembly
; PSW flag control examples
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    
    ; Clear all standard flags (CLR takes the bit number: N=0, Z=1, V=2, C=3)
    CLR  0             ; CLR N
    CLR  1             ; CLR Z
    CLR  2             ; CLR V
    CLR  3             ; CLR C
    
    ; Set specific flags
    SET  3             ; SET C (Carry)
    SET  1             ; SET Z (Zero)
    
    ; Control interrupt enable
    SETI               ; Enable interrupts (I = PSW bit 4)
    ; ... do critical work ...
    CLRI               ; Disable interrupts
    
    ; Multiple flag operations (one bit per instruction)
    SET  1             ; SET Z first
    SET  3             ; then SET C
    
    HALT
```

### 5.2 Segment Register Configuration
```assembly
; Segment register setup
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    
    ; Configure stack segment
    SRS  R13           ; SR=13(SP), DS=0 (single)
    SRD  R13           ; SR=13(SP), DS=1 (dual - SP+FP use SS)
    
    ; Configure extra segment  
    ERS  R11           ; ER=11, DE=0 (single)
    ERD  R11           ; ER=11, DE=1 (dual - R11+R10 use ES)
    
    ; Move data between segments
    LDI  0x1234
    MVS  DS, R0        ; Move to DS segment register
    MOV  R1, CS        ; Move from CS to R1
    
    ; Stack operations now use SS segment automatically
    ST   R2, SP, 0     ; Uses SS:SP
    ST   R3, FP, 0     ; Uses SS:FP (dual registers enabled)
    
    HALT
```

### 5.3 Far Procedure Call
```assembly
; Inter-segment procedure call
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    
    ; Save current context
    SMV  R8, ACS       ; Save current CS
    
    ; Setup far call target
    LDI  0x1000
    MOV  R10, R0       ; Target CS
    LDI  0x0200
    MOV  R11, R0       ; Target PC
    
    MOV  R9, PC, 2     ; Save return address (= instruction after the delay slot)
    JML  R10           ; Jump to CS=R10, PC=R11
    NOP                ; delay slot
    
    ; ... execution continues in far segment ...

.org 0x1000
far_function:
    ; Far function code here
    
    ; Return to caller
    MOV  R10, R8, 0    ; Restore original CS
    MOV  R11, R9, 0    ; Restore return address
    JML  R10           ; Return to original segment
    NOP                ; delay slot
```

---

## 6. Advanced Examples

### 6.1 Multiplication and Division
```assembly
; 32-bit multiplication and division
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    
    ; 32-bit multiplication: R4:R5 = R2 × R3
    LDI  1000
    MOV  R2, R0        ; Multiplicand
    LDI  500
    MOV  R3, R0        ; Multiplier
    MUL  R4, R3, i=1   ; R4:R5 = R2 × R3 (32-bit result)
    
    ; 32-bit division: R6 = quotient, R7 = remainder
    LDI  10000
    MOV  R2, R0        ; Dividend
    LDI  333
    MOV  R3, R0        ; Divisor
    DIV  R6, R3, i=1   ; R6 = quotient, R7 = remainder
    
    HALT
```

### 6.2 Shift Operations
```assembly
; Various shift operations
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    LDI  0x00FF       ; Test value (R0)
    
    ; Different shift types
    MOV  R1, R0, 0
    SL   R1, 2         ; Shift left 2 positions
    
    MOV  R2, R0, 0  
    SR   R2, 3         ; Shift right logical 3 positions
    
    MOV  R3, R0, 0
    SRA  R3, 2         ; Shift right arithmetic 2 positions
    
    MOV  R4, R0, 0
    ROR  R4, 4         ; Rotate right 4 positions
    
    HALT
```

### 6.3 Memory Block Operations
```assembly
; Copy memory block with overlap handling
.org 0x0000

main:
    LDI  0x3FFF
    MOV  SP, R0 << 1 + 1  ; SP = 0x7FFF
    LDI  dest_block
    MOV  R1, R0        ; Destination
    LDI  32
    MOV  R2, R0        ; Block size in words
    LDI  src_block     ; Source (loaded last — LDI always writes R0)
    
    ; Check for overlap
    CMP  R0, R1, w=0   ; Compare addresses
    JC   copy_backward ; If src < dest, copy backward
    NOP                ; delay slot
    
copy_forward:
    LD   R3, R0, 0
    ST   R3, R1, 0
    ADD  R0, 1
    ADD  R1, 1
    SUB  R2, 1
    JNZ  copy_forward
    NOP                ; delay slot
    LDI  copy_done
    MOV  PC, R0
    NOP                ; delay slot
    
copy_backward:
    ; Calculate end addresses
    ADD  R0, R2
    ADD  R1, R2
    
backward_loop:
    SUB  R0, 1
    SUB  R1, 1
    LD   R3, R0, 0
    ST   R3, R1, 0
    SUB  R2, 1
    JNZ  backward_loop
    NOP                ; delay slot
    
copy_done:
    HALT

.org 0x1000
src_block:
    .word 1, 2, 3, 4, 5, 6, 7, 8
    
.org 0x1100  
dest_block:
    .word 0
```

---

## 7. Common Idioms

### 7.1 Register Clearing
```assembly
; Clear register idioms
    LDI  0             ; Clear R0 (LDI always writes R0)
    XOR  R1, R1        ; Clear R1 (alternative)
    SUB  R2, R2        ; Clear R2 and set Z flag
```

### 7.2 Constant Loading
```assembly
; Load constant idioms
    LSI  R0, 15        ; Load small constant (-16 to 15)
    LDI  42
    MOV  R1, R0        ; Load medium constant (LDI + MOV)
    LDI  1000          ; Load large constant to R0 (immediate 0-32767, sign-extended)
```

### 7.3 Conditional Moves
```assembly
; Conditional operations
.equ value1 5
.equ value2 9
    LDI  value2
    MOV  R1, R0        ; R1 = value2 (LDI always writes R0)
    LDI  value1        ; R0 = value1
    CMP  R0, R1, w=0   ; Compare
    JC   smaller       ; If R0 < R1
    NOP                ; delay slot
    
    ; R0 >= R1 case
    MOV  R2, R0
    LDI  done
    MOV  PC, R0
    NOP                ; delay slot
    
smaller:
    MOV  R2, R1
    
done:
    ; R2 contains max(value1, value2)
```

---

*Deep16 Programming Examples - Architecture v3.5 (1r13)*

This examples document provides practical code snippets for all major Deep16 features, from basic arithmetic to advanced interrupt handling and segment control.
