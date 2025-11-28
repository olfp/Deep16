; =============================================
; Enhanced Deep16 Forth Kernel - FINAL FIXED VERSION
; =============================================

.org 0x0100
.code

.equ IP R11
.equ RSP R12
.equ SP R13
.equ NEXT R10
.equ POS R7
.equ SCR R8
.equ MASK R4

; =============================================
; Forth Kernel Implementation
; =============================================

forth_start:
    ; Initialize stack pointers
    LDI 0x7FF0
    MOV SP, R0
    LDI 0x7FE0
    MOV RSP, R0
    
    LDI user_program
    MOV IP, R0
    
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x1000
    MOV SCR, R0
    ERD R8
    
    LDI 0
    MOV POS, R0
    LDI 0x00FF
    MOV MASK, R0
    LDI 0
    MVS DS, R0
    LDI next
    MOV NEXT, R0
    MOV PC, NEXT
    NOP

next:
    LD R1, IP, 0
    ADD IP, 1
    MOV PC, R1
    NOP

; =============================================
; Core Primitives
; =============================================

d_exit:
    LD IP, RSP, 0
    ADD RSP, 1
    MOV PC, NEXT
    NOP

d_lit:
    LD R1, IP, 0
    ADD IP, 1
    SUB SP, 1
    ST R1, SP, 0
    MOV PC, NEXT
    NOP

d_dup:
    LD R1, SP, 0
    SUB SP, 1
    ST R1, SP, 0
    MOV PC, NEXT
    NOP

d_drop:
    ADD SP, 1
    MOV PC, NEXT
    NOP

d_swap:
    LD R1, SP, 0
    LD R2, SP, 1
    ST R1, SP, 1
    ST R2, SP, 0
    MOV PC, NEXT
    NOP

d_fetch:
    LD R1, SP, 0
    LD R1, R1, 0
    ST R1, SP, 0
    MOV PC, NEXT
    NOP

d_store:
    LD R1, SP, 0
    LD R2, SP, 1
    ST R2, R1, 0
    ADD SP, 2
    MOV PC, NEXT
    NOP

; =============================================
; I/O Operations
; =============================================

d_emit:
    LD R1, SP, 0
    ADD SP, 1
    STS R1, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    LDI 2000
    MOV R2, R0
    SUB R2, POS
    JNZ emit_done
    NOP
    LDI 0x1000
    MOV SCR, R0
    LDI 0
    MOV POS, R0
emit_done:
    MOV PC, NEXT
    NOP

d_tell:
    LD R3, SP, 0
    ADD SP, 1
tell_loop:
    LD R1, R3, 0
    ADD R1, 0
    JZ tell_done
    NOP
    ; High byte
    MOV R2, R1
    SRA R2, 8
    AND R2, MASK
    ADD R2, 0
    JZ skip_high
    NOP
    STS R2, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    LDI 2000
    MOV R6, R0
    SUB R6, POS
    JNZ high_ok
    NOP
    LDI 0x1000
    MOV SCR, R0
    LDI 0
    MOV POS, R0
high_ok:
skip_high:
    ; Low byte
    MOV R2, R1
    AND R2, MASK
    ADD R2, 0
    JZ tell_next_word
    NOP
    STS R2, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    LDI 2000
    MOV R6, R0
    SUB R6, POS
    JNZ tell_next_word
    NOP
    LDI 0x1000
    MOV SCR, R0
    LDI 0
    MOV POS, R0
tell_next_word:
    ADD R3, 1
    JNO tell_loop
    NOP
tell_done:
    MOV PC, NEXT
    NOP

d_cr:
    MOV R1, POS
    LDI 80
    MOV R2, R0
cr_mod_loop:
    SUB R1, R2
    JN cr_done_mod
    NOP
    JNO cr_mod_loop
    NOP
cr_done_mod:
    ADD R1, R2
    LDI 80
    SUB R0, R1
    MOV R2, R0
    ADD R2, 0
    JZ cr_done
    NOP
    ADD SCR, R2
    ADD POS, R2
cr_done:
    MOV PC, NEXT
    NOP

; =============================================
; Arithmetic
; =============================================

d_add:
    LD R2, SP, 0
    LD R1, SP, 1
    ADD R1, R2
    ADD SP, 1
    ST R1, SP, 0
    MOV PC, NEXT
    NOP

d_mul:
    LD R2, SP, 0
    LD R1, SP, 1
    MUL R1, R2
    ADD SP, 1
    ST R1, SP, 0
    MOV PC, NEXT
    NOP

; =============================================
; Print Operations
; =============================================

d_dot:
    LD R1, SP, 0
    ADD SP, 1
    ADD R1, 0
    JZ dot_zero
    NOP
    LDI 0
    MOV R5, R0
    LDI 10
    MOV R6, R0
dot_digit_loop:
    DIV R1, R6
    MOV R3, R2
    LDI 48
    ADD R3, R0
    SUB SP, 1
    ST R3, SP, 0
    ADD R5, 1
    ADD R1, 0
    JZ dot_print
    NOP
    JNO dot_digit_loop
    NOP
dot_zero:
    LDI 48
    SUB SP, 1
    ST R0, SP, 0
    LDI 1
    MOV R5, R0
dot_print:
    ADD R5, 0
    JZ dot_done
    NOP
    LD R1, SP, 0
    ADD SP, 1
    STS R1, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    SUB R5, 1
    JNO dot_print
    NOP
dot_done:
    MOV PC, NEXT
    NOP

; .H - print hexadecimal (FIXED to show correct order)
d_dot_hex:
    LD R1, SP, 0
    ADD SP, 1
    ; Store digits in correct order
    LDI 4
    MOV R5, R0
    LDI hex_buffer
    MOV R6, R0
hex_store:
    MOV R2, R1
    AND R2, 0x000F
    LDI 9
    MOV R3, R0
    SUB R3, R2
    JC hex_letter
    NOP
    LDI 48
    ADD R2, R0
    JMP hex_store_digit
    NOP
hex_letter:
    LDI 55
    ADD R2, R0
hex_store_digit:
    ST R2, R6, 0
    ADD R6, 1
    SRA R1, 4
    SUB R5, 1
    JNZ hex_store
    NOP
    ; Print in reverse order for correct display
    LDI 4
    MOV R5, R0
    LDI hex_buffer+3
    MOV R6, R0
hex_print:
    LD R2, R6, 0
    STS R2, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    SUB R6, 1
    SUB R5, 1
    JNZ hex_print
    NOP
    MOV PC, NEXT
    NOP

hex_buffer:
    .word 0, 0, 0, 0

d_halt:
    HLT

; =============================================
; Demo Program
; =============================================
user_program:
    .word d_lit, program_msg, d_tell
    .word d_lit, 42, d_dot
    .word d_lit, hex_msg, d_tell  
    .word d_lit, 0xABCD, d_dot_hex
    .word d_cr
    .word d_lit, calc_msg, d_tell
    .word d_lit, 10, d_lit, 7, d_add
    .word d_lit, 3, d_mul, d_dot
    .word d_cr, d_halt

program_msg:
    .word 0x4465, 0x6570, 0x3631, 0x2046, 0x6F72, 0x7468, 0x0000

hex_msg:
    .word 0x2068, 0x6578, 0x3A20, 0x0000

calc_msg:
    .word 0x5465, 0x7374, 0x3A20, 0x0000

kernel_end:
    HLT
