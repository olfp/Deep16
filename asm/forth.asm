; =============================================
; Enhanced Deep16 Forth Kernel - FINAL CORRECTED VERSION
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
    
    ; Initialize instruction pointer
    LDI user_program
    MOV IP, R0
    
    ; Set up screen segment for output
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x1000
    MOV SCR, R0
    ERD R8
    
    ; Clear screen position counter
    LDI 0
    MOV POS, R0

    ; Set up AND mask for byte operations
    LDI 0x00FF
    MOV MASK, R0

    ; Ensure Data Segment points to physical 0x0000
    LDI 0
    MVS DS, R0
    
    ; Set up NEXT jump target
    LDI next
    MOV NEXT, R0

    ; Jump to inner interpreter
    MOV PC, NEXT
    NOP

; =============================================
; Forth Inner Interpreter
; =============================================

next:
    LD R1, IP, 0
    ADD IP, 1
    MOV PC, R1
    NOP

; =============================================
; Stack Primitives
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

; =============================================
; Memory Operations
; =============================================

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
    ; High byte (first character)
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
    ; Low byte (second character)
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
    ; Calculate current column: position % 80
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
    ; Calculate spaces to next line: 80 - current_column
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
; Arithmetic Operations
; =============================================

d_add:
    LD R2, SP, 0
    LD R1, SP, 1
    ADD R1, R2
    ADD SP, 1
    ST R1, SP, 0
    MOV PC, NEXT
    NOP

d_sub:
    LD R2, SP, 0
    LD R1, SP, 1
    SUB R1, R2
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

; .H (DOT_HEX) - print top of stack as hexadecimal
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
    LDI hex_store_digit
    MOV R4, R0
    MOV PC, R4
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
    .word 0
    .word 0
    .word 0
    .word 0

d_halt:
    HLT

; =============================================
; Demo Program
; =============================================
user_program:
    .word d_lit
    .word program_msg
    .word d_tell        ; Print "Deep16 Forth"
    .word d_lit
    .word 42
    .word d_dot         ; Print "42"
    .word d_lit
    .word hex_msg
    .word d_tell        ; Print " hex: "
    .word d_lit
    .word 0xABCD
    .word d_dot_hex     ; Print "ABCD" (hexadecimal output)
    .word d_cr
    .word d_lit
    .word calc_msg
    .word d_tell        ; Print "Test: "
    .word d_lit
    .word 10
    .word d_lit
    .word 7
    .word d_add         ; 10 + 7 = 17
    .word d_lit
    .word 3
    .word d_mul         ; 17 * 3 = 51
    .word d_dot         ; Print "51"
    .word d_cr
    .word d_halt

; Correctly packed strings (high byte first, low byte second)
program_msg:
    .word 0x4465       ; 'D' 'e'
    .word 0x6570       ; 'e' 'p'
    .word 0x3631       ; '6' '1'
    .word 0x2046       ; ' ' 'F'
    .word 0x6F72       ; 'o' 'r'
    .word 0x7468       ; 't' 'h'
    .word 0x0000       ; Null terminator

hex_msg:
    .word 0x2068       ; ' ' 'h'
    .word 0x6578       ; 'e' 'x'
    .word 0x3A20       ; ':' ' '
    .word 0x0000       ; Null terminator

calc_msg:
    .word 0x5465       ; 'T' 'e'
    .word 0x7374       ; 's' 't'
    .word 0x3A20       ; ':' ' '
    .word 0x0000       ; Null terminator

; =============================================
; Dictionary Headers
; =============================================

dict_start:
; EXIT
.word 0
.word 0x4004
.word 0x4558           ; 'E' 'X'
.word 0x5449           ; 'T' 'I'
.word 0x0000
.word d_exit

; LIT
.word dict_start
.word 0x4003
.word 0x4C49           ; 'L' 'I'
.word 0x0054           ; 'T' + padding
.word d_lit

; .H (DOT_HEX)
.word dict_start+12
.word 0x4002
.word 0x2E48           ; '.' 'H'
.word d_dot_hex

kernel_end:
    HLT
