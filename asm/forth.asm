; =============================================
; Enhanced Deep16 Forth Kernel - FIXED PARSING
; =============================================

.org 0x0100
.code

.equ SP R13
.equ SCR R8
.equ TIB R6           ; Text Input Buffer pointer
.equ >IN R5           ; Input pointer offset

; =============================================
; Forth Kernel Implementation
; =============================================

forth_start:
    ; Initialize stack pointer
    LDI 0x7FF0
    MOV SP, R0
    
    ; Set up screen segment for output
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x1000
    MOV SCR, R0
    ERD R8
    
    ; Ensure Data Segment points to physical 0x0000
    LDI 0
    MVS DS, R0

    ; Set up TIB to point to input data
    LDI input_data
    MOV TIB, R0
    LDI 0
    MOV >IN, R0

    ; Jump to text interpreter
    LDI text_interpreter
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Text Interpreter Core - SIMPLIFIED
; =============================================

text_interpreter:    
interpret_loop:
    ; Get current character
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0

    ; Check end of input
    LDI 0
    SUB R2, R0
    JZ interpret_done

    ; Process based on character
    LDI 49            ; '1'
    SUB R2, R0
    JNZ check_2

    ; Found '1' - push to stack
    LDI 1
    SUB SP, 1
    ST R0, SP, 0
    ADD >IN, 1
    LDI interpret_loop
    MOV R1, R0
    MOV PC, R1
    NOP

check_2:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 50            ; '2'
    SUB R2, R0
    JNZ check_plus

    ; Found '2' - push to stack
    LDI 2
    SUB SP, 1
    ST R0, SP, 0
    ADD >IN, 1
    LDI interpret_loop
    MOV R1, R0
    MOV PC, R1
    NOP

check_plus:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 43            ; '+'
    SUB R2, R0
    JNZ check_dot

    ; Found '+' - execute addition
    LD R2, SP, 0      ; second operand
    ADD SP, 1         ; pop FIRST
    LD R1, SP, 0      ; first operand  
    ADD R1, R2        ; add
    ST R1, SP, 0      ; store result
    ADD >IN, 1
    LDI interpret_loop
    MOV R1, R0
    MOV PC, R1
    NOP

check_dot:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 46            ; '.'
    SUB R2, R0
    JNZ skip_char

    ; Found '.' - print number
    LD R1, SP, 0
    ADD SP, 1
    
    ; Convert to ASCII and print
    LDI 48
    ADD R1, R0
    STS R1, ES, SCR
    ADD SCR, 1
    
    ADD >IN, 1
    LDI interpret_loop
    MOV R1, R0
    MOV PC, R1
    NOP

skip_char:
    ; Skip any other character
    ADD >IN, 1
    LDI interpret_loop
    MOV R1, R0
    MOV PC, R1
    NOP

interpret_done:
    HLT

; =============================================
; Data Section
; =============================================

.org 0x0200
input_data:
    .word 49          ; '1'
    .word 50          ; '2'  
    .word 43          ; '+'
    .word 46          ; '.'
    .word 0           ; Null terminator

kernel_end:
    HLT
