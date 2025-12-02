; =============================================
; Enhanced Deep16 Forth Kernel - FIXED PARSING
; =============================================

.org 0x0100
.code

.equ SP R13
.equ SCR R8
.equ TIB R6           ; Text Input Buffer pointer
.equ >IN R5           ; Input pointer offset
.equ SP0 R14          ; Stack base snapshot for underflow checks

; =============================================
; Forth Kernel Implementation
; =============================================

forth_start:
    ; Initialize stack pointer
    LDI 0x7FF0
    MOV SP, R0
    MOV SP0, SP
    
    ; Set up screen segment for output
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x1000
    MOV SCR, R0
    ; Configure PSW: ER=8 (R8), DE=1 via LPSW/SPSW
    LPSW R12
    LDI 0x07FF
    AND R12, R0
    LDI 0x4000      ; Sign-extends to 0xC000 (DE=1, ER=8)
    OR  R12, R0
    SPSW R12
    ; Ready for screen output at ES:SCR
    
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
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ interpret_done
    LDI ' '
    CMP R2, R0
    JNZ token_start
    ADD >IN, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
token_start:
    LDI '.'
    CMP R2, R0
    JNZ check_number_or_word
    MOV R3, TIB
    ADD R3, >IN
    ADD R3, 1
    LD R4, R3, 0
    LDI '"'
    CMP R4, R0
    JNZ check_number_or_word
    ADD >IN, 2
print_string:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI '"'
    CMP R2, R0
    JZ after_string
    STS R2, ES, SCR
    ADD SCR, 1
    ADD >IN, 1
    LDI print_string
    MOV PC, R0
    NOP
after_string:
    ADD >IN, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
check_number_or_word:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI '0'
    CMP R4, R0
    JN parse_word            ; if ch < '0' => word
    LDI '9'
    CMP R0, R4
    JN parse_word            ; if '9' < ch => word
    LDI parse_number         ; digit in range => parse number
    MOV PC, R0
    NOP
parse_number:
    LDI 0
    MOV R7, R0
parse_number_loop:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ finish_number
    LDI ' '
    CMP R4, R0
    JZ finish_number
    LDI '0'
    CMP R4, R0
    JN finish_number        ; ch < '0' => stop
    LDI '9'
    CMP R0, R4
    JN finish_number        ; '9' < ch => stop
    ; digit in range
    LDI '0'
    SUB R4, R0
    LDI 10
    MOV R12, R0
    MOV R1, R7
    MUL R1, R12
    ADD R1, R4
    MOV R7, R1
    ADD >IN, 1
    LDI parse_number_loop
    MOV PC, R0
    NOP
finish_number:
    MOV R1, R7
    SUB SP, 1
    ST R1, SP, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
parse_word:
    LDI dict_start
    MOV R9, R0
    MOV R7, R9
dict_loop:
    LD R1, R7, 0
    MOV R2, R7
    LDI dict_end
    CMP R2, R0
    JZ skip_unknown
    MOV R3, TIB
    ADD R3, >IN
    LDI 0
    MOV R11, R0
    MOV R10, R1
    MOV R3, TIB
    ADD R3, >IN
    LDI 0
    MOV R11, R0
word_cmp_loop:
    LD R2, R3, 0
    LD R4, R10, 0
    LDI 0
    CMP R2, R0
    JZ word_cmp_done
    LDI ' '
    CMP R2, R0
    JZ word_cmp_done
    CMP R2, R4
    JNZ advance_token
    ADD R3, 1
    ADD R10, 1
    ADD R11, 1
    LDI word_cmp_loop
    MOV PC, R0
    NOP
word_cmp_done:
    LD R4, R10, 0
    LDI 0
    CMP R4, R0
    JNZ next_entry
    LD R1, R7, 1
    ADD >IN, R11
    MOV PC, R1
    NOP
advance_token:
    ADD R7, 2
    LDI dict_loop
    MOV PC, R0
    NOP

skip_unknown:
    MOV R3, TIB
    ADD R3, >IN
skip_scan:
    LD R2, R3, 0
    LDI 0
    CMP R2, R0
    JZ interpret_loop
    LDI ' '
    CMP R2, R0
    JZ interpret_loop
    ADD R3, 1
    ADD >IN, 1
    LDI skip_scan
    MOV PC, R0
    NOP
next_entry:
    ADD R7, 2
    LDI dict_loop
    MOV PC, R0
    NOP

interpret_done:
    HLT

; =============================================
; Data Section
; =============================================

.org 0x0200
input_data:
    .text ".\" Hello String DeepForth! The answer is \" 3 7 * dup + ."

dict_names:
plus_name:
    .word '+'
    .word 0
mul_name:
    .word '*'
    .word 0
dup_name:
    .word 'd'
    .word 'u'
    .word 'p'
    .word 0
dot_name:
    .word '.'
    .word 0
emit_name:
    .word 'e'
    .word 'm'
    .word 'i'
    .word 't'
    .word 0
swap_name:
    .word 's'
    .word 'w'
    .word 'a'
    .word 'p'
    .word 0
drop_name:
    .word 'd'
    .word 'r'
    .word 'o'
    .word 'p'
    .word 0
dict_start:
    .word plus_name
    .word word_plus
    .word mul_name
    .word word_mul
    .word dup_name
    .word word_dup
    .word dot_name
    .word word_dot
    .word emit_name
    .word word_emit
    .word swap_name
    .word word_swap
    .word drop_name
    .word word_drop
dict_end:
word_plus:
    MOV R9, SP
    ADD R9, 2
    CMP R9, SP0
    JZ wp_ok
    JN wp_ok
    LDI interpret_loop
    MOV PC, R0
    NOP
wp_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    ADD R1, R2
    ST R1, SP, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
word_mul:
    MOV R9, SP
    ADD R9, 2
    CMP R9, SP0
    JZ wm_ok
    JN wm_ok
    LDI interpret_loop
    MOV PC, R0
    NOP
wm_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    MUL R1, R2
    ST R1, SP, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
word_dup:
    CMP SP, SP0
    JZ wd_under
    LD R1, SP, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
wd_under:
    LDI interpret_loop
    MOV PC, R0
    NOP
word_dot:
    CMP SP, SP0
    JZ dot_under
    LD R1, SP, 0
    ADD SP, 1
    MOV R2, R1          ; value
    LDI 0
    CMP R2, R0
    JNZ dot_nonzero
    LDI '0'
    STS R0, ES, SCR     ; R0 contains '0'
    ADD SCR, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
dot_nonzero:
    LDI print_buf
    MOV R10, R0         ; buffer pointer
    LDI 0
    MOV R3, R0          ; digit count
dot_div_loop:
    LDI 10
    MOV R12, R0
    MOV R6, R2
    DIV R6, R12
    MOV R4, R6
    MUL R4, R12
    MOV R7, R2
    SUB R7, R4
    LDI '0'
    ADD R7, R0
    ST R7, R10, 0
    ADD R10, 1
    MOV R2, R6
    ADD R3, 1           ; count++
    LDI 0
    CMP R2, R0
    JNZ dot_div_loop
    ; print digits in reverse
dot_print_loop:
    LDI 0
    CMP R3, R0
    JZ dot_done
    SUB R3, 1
    SUB R10, 1
    LD R7, R10, 0
    STS R7, ES, SCR
    ADD SCR, 1
    LDI dot_print_loop
    MOV PC, R0
    NOP
dot_done:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JNZ dot_continue
    LDI interpret_done
    MOV PC, R0
    NOP
dot_continue:
    LDI interpret_loop
    MOV PC, R0
    NOP
dot_under:
    LDI interpret_loop
    MOV PC, R0
    NOP
word_emit:
    CMP SP, SP0
    JZ we_under
    LD R1, SP, 0
    ADD SP, 1
    STS R1, ES, SCR
    ADD SCR, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
we_under:
    LDI interpret_loop
    MOV PC, R0
    NOP

word_swap:
    MOV R9, SP
    ADD R9, 2
    CMP R9, SP0
    JZ ws_ok
    JN ws_ok
    LDI interpret_loop
    MOV PC, R0
    NOP
ws_ok:
    LD R1, SP, 0
    LD R2, SP, 1
    ST R1, SP, 1
    ST R2, SP, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_drop:
    CMP SP, SP0
    JZ wd2_under
    ADD SP, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
wd2_under:
    LDI interpret_loop
    MOV PC, R0
    NOP

print_buf:
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
