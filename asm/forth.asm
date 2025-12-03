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
.equ KBD_STATUS 0x0060
.equ KBD_DATA   0x0062

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

    ; Clear screen memory (80*25 cells) and reset SCR to start
    LDI 0x1000
    MOV SCR, R0
    LDI 2000
    MOV R2, R0
clear_scr_loop:
    LDI 0
    STS R0, ES, SCR
    ADD SCR, 1
    SUB R2, 1
    LDI 0
    CMP R2, R0
    JNZ clear_scr_loop
    LDI 0x1000
    MOV SCR, R0
    
cursor_on:
    LDS R1, ES, SCR
    LSI R0, 1
    SL  R0, 15
    OR  R1, R0
    STS R1, ES, SCR
    LDI interpret_loop
    NOP
cursor_off:
    LDS R1, ES, SCR
    LDI 0x7FFF
    AND R1, R0
    STS R1, ES, SCR
    LDI interpret_loop
    NOP
    ; Ensure Data Segment points to physical 0x0000
    LDI 0
    MVS DS, R0
    ; Ensure Code/Stack segments are also 0x0000 for correct jumps/stack
    MVS SS, R0
    MVS CS, R0

    ; Print greeting
    LDI hello_msg
    MOV R1, R0
hello_loop:
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ hello_done
    STS R2, ES, SCR
    ADD SCR, 1
    ADD R1, 1
    LDI hello_loop
    MOV PC, R0
    NOP
hello_done:
    ; Move to start of next line (column 0)
    LDI 0x1000
    MOV R8, R0           
    MOV R9, SCR          
    SUB R9, R8           
    LDI 80               
    MOV R10, R0          
    MOV R11, R9          
    DIV R11, R10         
    MUL R11, R10         
    MOV R12, R9          
    SUB R12, R11         
    SUB R10, R12         
    ADD SCR, R10         
    ; Set TIB to keyboard buffer and reset >IN
    LDI tib_kbd
    MOV TIB, R0
    LDI 0
    MOV >IN, R0
    ; Print prompt and place reversed space cursor
    LDI '>'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LSI R1, 1
    SL  R1, 15
    LDI ' '
    MOV R2, R0
    OR  R2, R1
    STS R2, ES, SCR
    LDI word_accept
    MOV PC, R0
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
    JNZ not_eol
    LDI interpret_done
    MOV PC, R0
    NOP
not_eol:
    LDI ' '
    CMP R2, R0
    JNZ token_start
    ADD >IN, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
token_start:
    LDI '"'
    CMP R2, R0
    JNZ check_apostrophe
    ; Bare string opening: advance inside string and print
    ADD >IN, 1
    LDI print_string_skip
    MOV PC, R0
    NOP
check_apostrophe:
    LDI 39
    CMP R2, R0
    JNZ check_dot_token
    ADD >IN, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
check_dot_token:
    LDI '.'
    CMP R2, R0
    JNZ check_single_tokens
    MOV R3, TIB
    ADD R3, >IN
    ADD R3, 1
    LD R4, R3, 0
    LDI '"'
    CMP R4, R0
    JNZ dot_plain
    LD R5, R3, 1
    LDI ' '
    CMP R5, R0
    JNZ skip_unknown
    MOV R1, R3
    SUB R1, TIB
    MOV >IN, R1
    ADD >IN, 1
    LDI print_string_skip
    MOV PC, R0
    NOP
dot_plain:
    ADD >IN, 1
    LDI word_dot
    MOV PC, R0
    NOP
check_single_tokens:
    LDI '+'
    CMP R2, R0
    JNZ check_star_token
    ADD >IN, 1
    LDI word_plus
    MOV PC, R0
    NOP
check_star_token:
    LDI '*'
    CMP R2, R0
    JNZ check_number_or_word
    ADD >IN, 1
    LDI word_mul
    MOV PC, R0
    NOP
print_string_skip:
    MOV R1, TIB
    ADD R1, >IN
psk_loop:
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ after_string
    LDI ' '
    CMP R2, R0
    JNZ psk_go
    ADD >IN, 1
    ADD R1, 1
    LDI psk_loop
    MOV PC, R0
    NOP
psk_go:
    LDI print_string_body
    MOV PC, R0
    NOP
print_string_body:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ after_string
    LDI '"'
    CMP R2, R0
    JZ after_string
    ; Handle escaped quote \" -> print '"' and continue
    LDI '\\'
    CMP R2, R0
    JNZ print_string_normal
    LD R5, R1, 1
    LDI '"'
    CMP R5, R0
    JNZ print_string_normal
    LDI '"'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD >IN, 2
    LDI print_string_body
    MOV PC, R0
    NOP
print_string_normal:
    STS R2, ES, SCR
    ADD SCR, 1
    ADD >IN, 1
    LDI print_string_body
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
    JNZ dict_continue
    LDI skip_unknown
    MOV PC, R0
    NOP
dict_continue:
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
    LD R2, R7, 0
    ADD >IN, R11
    LDI plus_name
    CMP R2, R0
    JNZ chk_mul
    LDI word_plus
    MOV PC, R0
    NOP
chk_mul:
    LDI mul_name
    CMP R2, R0
    JNZ chk_dup
    LDI word_mul
    MOV PC, R0
    NOP
chk_dup:
    LDI dup_name
    CMP R2, R0
    JNZ chk_dot
    LDI word_dup
    MOV PC, R0
    NOP
chk_dot:
    LDI dot_name
    CMP R2, R0
    JNZ chk_emit
    LDI word_dot
    MOV PC, R0
    NOP
chk_emit:
    LDI emit_name
    CMP R2, R0
    JNZ chk_swap
    LDI word_emit
    MOV PC, R0
    NOP
chk_swap:
    LDI swap_name
    CMP R2, R0
    JNZ chk_drop
    LDI word_swap
    MOV PC, R0
    NOP
chk_drop:
    LDI drop_name
    CMP R2, R0
    JNZ chk_key
    LDI word_drop
    MOV PC, R0
    NOP
chk_key:
    LDI key_name
    CMP R2, R0
    JNZ chk_accept
    LDI word_key
    MOV PC, R0
    NOP
chk_accept:
    LDI accept_name
    CMP R2, R0
    JNZ fallback_next
    LDI word_accept
    MOV PC, R0
    NOP
fallback_next:
    LDI next_entry
    MOV PC, R0
    NOP
advance_token:
    ADD R7, 2
    LDI dict_loop
    MOV PC, R0
    NOP

skip_unknown:
    MOV R3, TIB
    ADD R3, >IN
    LDI 0x1000
    MOV R2, R0
    MOV R4, SCR
    SUB R4, R2
    LDI 80
    MOV R5, R0
    MOV R6, R4
    DIV R6, R5
    ADD R6, 1
    MUL R6, R5
    ADD R2, R6
    MOV SCR, R2
    LDI 'u'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'n'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'd'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'e'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'f'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'i'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'n'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'e'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'd'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'w'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'o'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'r'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'd'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI ':'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LD R2, R3, 0
print_bad_loop:
    ; Ensure printable low-byte only
    LDI 0x00FF
    AND R2, R0
    LDI 0
    CMP R2, R0
    JZ print_bad_done
    LDI ' '
    CMP R2, R0
    JZ print_bad_done
    STS R2, ES, SCR
    ADD SCR, 1
    ADD R3, 1
    LD R2, R3, 0
    LDI 0x00FF
    AND R2, R0
    LDI print_bad_loop
    MOV PC, R0
    NOP
print_bad_done:
    LDI 0x1000
    MOV R2, R0
    MOV R4, SCR
    SUB R4, R2
    LDI 80
    MOV R5, R0
    MOV R6, R4
    DIV R6, R5
    ADD R6, 1
    MUL R6, R5
    ADD R2, R6
    MOV SCR, R2
    LDI '>'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LSI R1, 1
    SL  R1, 15
    LDI ' '
    MOV R2, R0
    OR  R2, R1
    STS R2, ES, SCR
    LDI word_accept
    MOV PC, R0
    NOP
next_entry:
    ADD R7, 2
    LDI dict_loop
    MOV PC, R0
    NOP

interpret_done:
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'o'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 'k'
    STS R0, ES, SCR
    ADD SCR, 1
    ; Move to start of next line using row index
    LDI 0x1000
    MOV R2, R0           ; base
    MOV R3, SCR          ; current address
    SUB R3, R2           ; offset from base
    LDI 80
    MOV R4, R0           ; width
    MOV R5, R3           ; offset copy
    DIV R5, R4           ; R5=row, R6=remainder
    ADD R5, 1            ; row+1
    MUL R5, R4           ; (row+1)*width
    ADD R2, R5           ; base + (row+1)*width
    MOV SCR, R2          ; start of next line
    LDI '>'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LSI R1, 1
    SL  R1, 15
    LDI ' '
    ADD R1, R0
    STS R1, ES, SCR
    LDI word_accept
    MOV PC, R0
    NOP

; =============================================
; Data Section
; =============================================

.org 0x3000
hello_msg:
    .word 'H'
    .word 'e'
    .word 'l'
    .word 'l'
    .word 'o'
    .word ' '
    .word 'D'
    .word 'e'
    .word 'e'
    .word 'p'
    .word 'F'
    .word 'o'
    .word 'r'
    .word 't'
    .word 'h'
    .word '!'
    .word 0

tib_kbd:
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0

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
    .word key_name
    .word word_key
    .word accept_name
    .word word_accept
dict_end:

.code
.org 0x0400
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
    MOV R9, R2
    DIV R9, R12
    MOV R4, R9
    MUL R4, R12
    MOV R7, R2
    SUB R7, R4
    LDI '0'
    ADD R7, R0
    ST R7, R10, 0
    ADD R10, 1
    MOV R2, R9
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
key_name:
    .word 'k'
    .word 'e'
    .word 'y'
    .word 0
accept_name:
    .word 'a'
    .word 'c'
    .word 'c'
    .word 'e'
    .word 'p'
    .word 't'
    .word 0
word_key:
    ; Wait for keyboard data ready
key_wait:
    LDI KBD_STATUS
    MOV R2, R0
    LDS R1, ES, R2
    LDI 0
    CMP R1, R0
    JZ key_wait
    ; Read data
    LDI KBD_DATA
    MOV R2, R0
    LDS R1, ES, R2
    ; Mask to low byte to reliably detect control keys
    LDI 0x00FF
    AND R1, R0
    SUB SP, 1
    ST R1, SP, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_accept:
    LDI tib_kbd
    MOV TIB, R0
    LDI 0
    MOV >IN, R0
    LDI 0
    MOV R11, R0         ; count
acc_loop:
    LSI R0, 1
    SL  R0, 15
    LDS R2, ES, SCR      ; avoid clobbering TIB (R6)
    MOV R3, R2
    OR  R3, R0
    CMP R3, R2
    JZ acc_cursor_ok
    STS R3, ES, SCR
acc_cursor_ok:
    LDI KBD_STATUS
    MOV R2, R0
    LDS R1, ES, R2
    LDI 0
    CMP R1, R0
    JZ acc_loop
    LDI KBD_DATA
    MOV R2, R0
    LDS R1, ES, R2
    LDI 10
    CMP R1, R0
    JNZ acc_check_cr13
    MOV R3, TIB
    ADD R3, >IN
    ADD R3, R11
    LDI 0
    ST R0, R3, 0
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
acc_check_cr13:
    LDI 13
    CMP R1, R0
    JNZ acc_check_bs
    MOV R3, TIB
    ADD R3, >IN
    ADD R3, R11
    LDI 0
    ST R0, R3, 0
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
acc_check_bs:
    LDI 8
    CMP R1, R0
    JNZ acc_store
    LDI 0
    CMP R11, R0
    JZ acc_loop
    SUB R11, 1
    SUB SCR, 1
    LDI ' '
    STS R0, ES, SCR
    SUB SCR, 1
    LDI acc_loop
    MOV PC, R0
    NOP
acc_store:
    MOV R3, TIB
    ADD R3, >IN
    ADD R3, R11
    ST R1, R3, 0
    ; Clear MSB at current cell, write typed char
    LDS R2, ES, SCR
    LDI 0x7FFF
    AND R2, R0
    STS R2, ES, SCR
    STS R1, ES, SCR
    ADD SCR, 1
    LSI R0, 1
    SL  R0, 15
    LDS R2, ES, SCR
    MOV R3, R2
    OR  R3, R0
    CMP R3, R2
    JZ acc_next_cursor_ok
    STS R3, ES, SCR
acc_next_cursor_ok:
    ADD R11, 1
    LDI acc_loop
    MOV PC, R0
    NOP
acc_do_crlf:
    ; Force-clear old cursor cell
    LDI ' '
    STS R0, ES, SCR
    
    LDS R1, ES, SCR
    LDI 0x7FFF
    AND R1, R0
    STS R1, ES, SCR
    ; Set SCR to start of next line directly
    LDI 0x1000
    MOV R2, R0           ; base
    MOV R3, SCR          ; current address
    SUB R3, R2           ; offset from base
    LDI 80
    MOV R4, R0           ; width
    MOV R5, R3           ; offset copy
    DIV R5, R4           ; R5=row, R6=remainder
    ADD R5, 1            ; row+1
    MUL R5, R4           ; (row+1)*width
    ADD R2, R5           ; base + (row+1)*width
    MOV SCR, R2          ; start of next line
    ; Print prompt and reversed space cursor
    LDI '>'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LSI R1, 1
    SL  R1, 15
    LDI ' '
    MOV R2, R0
    OR  R2, R1
    STS R2, ES, SCR
    ; Reset input pointers
    LDI 0
    MOV >IN, R0
    LDI 0
    MOV R11, R0
    ; Continue accept loop
    LDI acc_loop
    MOV PC, R0
    NOP
acc_crlf:
    ; Force-clear old cursor cell
    LDI ' '
    STS R0, ES, SCR
    
    LDS R1, ES, SCR
    LDI 0x7FFF
    AND R1, R0
    STS R1, ES, SCR
    ; Move to start of next line (column 0)
    LDI 0x1000
    MOV R8, R0           
    MOV R9, SCR          
    SUB R9, R8           
    LDI 80               
    MOV R10, R0          
    MOV R11, R9          
    DIV R11, R10         
    MUL R11, R10         
    MOV R12, R9          
    SUB R12, R11         
    SUB R10, R12         
    ADD SCR, R10         
    ; Print prompt and place reversed space cursor on new line
    LDI '>'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LSI R1, 1
    SL  R1, 15
    LDI ' '
    MOV R2, R0
    OR  R2, R1
    STS R2, ES, SCR
acc_done:
    MOV R3, TIB
    ADD R3, >IN
    ADD R3, R11
    LDI 0
    ST R0, R3, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
