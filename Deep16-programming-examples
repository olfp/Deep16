# Deep16 (深十六) Programming Examples
## Architecture v3.5 (1r13) - Example Programs

---

## 1. Basic Arithmetic Examples

### 1.1 Simple Addition
```assembly
; Add two numbers and store result
.org 0x0000

main:
    MOV  SP, 0x7FFF    ; Initialize stack
    MOV  R0, 5         ; Load first operand
    MOV  R1, 7         ; Load second operand
    ADD  R0, R1        ; R0 = 5 + 7 = 12
    ST   R0, SP, 0     ; Store result on stack
    HALT
```

### 1.2 Comparison and Conditional Jump
```assembly
; Compare two numbers and branch
.org 0x0000

main:
    MOV  SP, 0x7FFF
    MOV  R0, 10
    MOV  R1, 5
    
    ; Compare R0 and R1
    SUB  R0, R1, w=0   ; CMP operation - sets flags only
    JN   negative      ; Jump if R0 < R1
    JZ   equal         ; Jump if R0 == R1
    
    ; R0 > R1 case
    MOV  R2, 1
    JMP  done
    
negative:
    MOV  R2, -1
    JMP  done
    
equal:
    MOV  R2, 0
    
done:
    HALT
```

### 1.3 Bit Manipulation
```assembly
; Bitwise operations example
.org 0x0000

main:
    MOV  SP, 0x7FFF
    MOV  R0, 0x00FF    ; Load test value
    
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
    MOV  SP, 0x7FFF    ; Initialize stack pointer
    
    ; Push values to stack
    MOV  R0, 0x1234
    MOV  R1, 0x5678
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
    MOV  SP, 0x7FFF
    MOV  R0, array     ; Array base address
    MOV  R1, 0         ; Sum register
    MOV  R2, 5         ; Array length
    
sum_loop:
    LD   R3, R0, 0     ; Load array element
    ADD  R1, R3        ; Add to sum
    ADD  R0, 1         ; Next array element
    SUB  R2, 1         ; Decrement counter
    JNZ  R2, sum_loop  ; Loop until done
    
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
    MOV  SP, 0x7FFF
    MOV  R0, src_str   ; Source string
    MOV  R1, dest      ; Destination buffer
    
copy_loop:
    LD   R2, R0, 0     ; Load source character
    ST   R2, R1, 0     ; Store to destination
    ADD  R0, 1         ; Next source char
    ADD  R1, 1         ; Next dest char
    
    ; Check for null terminator
    TBS  R2, 0xFF      ; Test if character is 0
    JNZ  R2, copy_loop ; Continue if not zero
    
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
    MOV  SP, 0x7FFF
    MOV  R0, 10        ; Argument 1
    MOV  R1, 20        ; Argument 2
    
    ; Call function
    MOV  LR, PC, 2     ; Save return address
    JMP  add_function
    
    ; Function result in R0
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
```

### 3.2 Fibonacci Sequence (Optimized)
```assembly
; Calculate Fibonacci numbers efficiently
.org 0x0000

main:
    MOV  SP, 0x7FFF
    MOV  R0, 0         ; F(0) = 0
    MOV  R1, 1         ; F(1) = 1
    MOV  R2, 10        ; Calculate up to F(10)
    MOV  R3, result    ; Output address
    
fib_loop:
    ST   R0, R3, 0     ; Store current Fibonacci
    ADD  R3, 1         ; Next output address
    
    ; Calculate next Fibonacci: R0, R1 = R1, R0+R1
    MOV  R4, R1        ; temp = current
    ADD  R1, R0        ; next = current + previous
    MOV  R0, R4        ; previous = temp
    
    SUB  R2, 1         ; decrement counter
    JNZ  R2, fib_loop  ; loop if not zero
    
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
    MOV  SP, 0x7FFF
    SETI               ; Enable interrupts
    ; Main program continues...
    HALT

; Interrupt handler at vector address
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
    MOV  SP, 0x7FFF
    
    ; Clear all standard flags
    CLR  0x8           ; CLR N
    CLR  0x9           ; CLR Z
    CLR  0xA           ; CLR V
    CLR  0xB           ; CLR C
    
    ; Set specific flags
    SET  0x3           ; SET C (Carry)
    SET  0x1           ; SET Z (Zero)
    
    ; Control interrupt enable
    SETI               ; SET2 1 - Enable interrupts
    ; ... do critical work ...
    CLRI               ; CLR2 1 - Disable interrupts
    
    ; Multiple flag operations
    SET  0xB           ; SET C and Z (0xB = 1011)
    
    HALT
```

### 5.2 Segment Register Configuration
```assembly
; Segment register setup
.org 0x0000

main:
    MOV  SP, 0x7FFF
    
    ; Configure stack segment
    SRS  R13           ; SR=13(SP), DS=0 (single)
    SRD  R13           ; SR=13(SP), DS=1 (dual - SP+FP use SS)
    
    ; Configure extra segment  
    ERS  R11           ; ER=11, DE=0 (single)
    ERD  R11           ; ER=11, DE=1 (dual - R11+R10 use ES)
    
    ; Move data between segments
    MOV  R0, 0x1234
    MVS  R0, DS        ; Move to DS segment register
    MVS  R1, CS        ; Move from CS to R1
    
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
    MOV  SP, 0x7FFF
    
    ; Save current context
    SMV  R8, ACS       ; Save current CS
    MOV  R9, PC, 2     ; Save return address
    
    ; Setup far call target
    MOV  R10, 0x1000   ; Target CS
    MOV  R11, 0x0200   ; Target PC
    
    ; Perform far jump
    JML  R10           ; Jump to CS=R10, PC=R11
    
    ; ... execution continues in far segment ...

.org 0x1000
far_function:
    ; Far function code here
    
    ; Return to caller
    MOV  R10, R8, 0    ; Restore original CS
    MOV  R11, R9, 0    ; Restore return address
    JML  R10           ; Return to original segment
```

---

## 6. Advanced Examples

### 6.1 Multiplication and Division
```assembly
; 32-bit multiplication and division
.org 0x0000

main:
    MOV  SP, 0x7FFF
    
    ; 32-bit multiplication: R4:R5 = R2 × R3
    MOV  R2, 1000      ; Multiplicand
    MOV  R3, 500       ; Multiplier
    MUL  R4, R3, i=1   ; R4:R5 = R2 × R3 (32-bit result)
    
    ; 32-bit division: R6 = quotient, R7 = remainder
    MOV  R2, 10000     ; Dividend
    MOV  R3, 333       ; Divisor
    DIV  R6, R3, i=1   ; R6 = quotient, R7 = remainder
    
    HALT
```

### 6.2 Shift Operations
```assembly
; Various shift operations
.org 0x0000

main:
    MOV  SP, 0x7FFF
    MOV  R0, 0x00FF    ; Test value
    
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
    MOV  SP, 0x7FFF
    MOV  R0, src_block
    MOV  R1, dest_block
    MOV  R2, 32        ; Block size in words
    
    ; Check for overlap
    CMP  R0, R1, w=0   ; Compare addresses
    JC   copy_backward ; If src < dest, copy backward
    
copy_forward:
    LD   R3, R0, 0
    ST   R3, R1, 0
    ADD  R0, 1
    ADD  R1, 1
    SUB  R2, 1
    JNZ  R2, copy_forward
    JMP  copy_done
    
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
    JNZ  R2, backward_loop
    
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
    MOV  R0, 0         ; Clear R0
    XOR  R1, R1        ; Clear R1 (alternative)
    SUB  R2, R2, w=0   ; Clear R2 and set Z flag
```

### 7.2 Constant Loading
```assembly
; Load constant idioms
    LSI  R0, 15        ; Load small constant (-16 to 15)
    MOV  R1, 42        ; Load medium constant (0-255 via MOV)
    LDI  1000          ; Load large constant to R0 (0-32767)
```

### 7.3 Conditional Moves
```assembly
; Conditional operations
    MOV  R0, value1
    MOV  R1, value2
    CMP  R0, R1, w=0   ; Compare
    JC   smaller       ; If R0 < R1
    
    ; R0 >= R1 case
    MOV  R2, R0
    JMP  done
    
smaller:
    MOV  R2, R1
    
done:
    ; R2 contains max(value1, value2)
```

---

*Deep16 Programming Examples - Architecture v3.5 (1r13)*

This examples document provides practical code snippets for all major Deep16 features, from basic arithmetic to advanced interrupt handling and segment control.
