; =============================================
; Enhanced Deep16 Forth Kernel - FIXED PARSING
; =============================================

.org 0x0100
.code

.equ SP R13
.equ SCR R8
.equ TIB R6           ; Text Input Buffer pointer
.equ >IN R5           ; Input pointer offset
; Reserve R14 as LR (link register). Store stack base in memory.
.equ KBD_STATUS 0x0060
.equ KBD_DATA   0x0062

; =============================================
; Forth Kernel Implementation
; =============================================

forth_start:
    ; Initialize stack pointer
    LDI 0x7FF0
    MOV SP, R0
    LDI sp0_base
    MOV R2, R0
    ST  SP, R2, 0
    
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

    ; Install SWI vector early to enable BIOS calls
    LDI 0
    MVS DS, R0
    LDI 2
    MOV R2, R0
    LDI swi_to_bios
    MOV R1, R0
    STS R1, DS, R2

    LDI 1
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    SWI
    
cursor_on:
    LDS R1, ES, SCR
    LSI R0, 1
    SL  R0, 15
    OR  R1, R0
    STS R1, ES, SCR
    LDI 3               ; BIOS putstr
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 3
    LDI 1
    MOV R7, R0
    LDI hello_msg
    STS R0, DS, R7      ; DS:[1] = hello_msg
    SWI
    LDI after_print_text
    MOV PC, R0
    NOP

; -------------------------
; Common subroutines
.code
print_text:
    MOV R1, R0
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ print_text_ret
    STS R2, ES, SCR
    ADD SCR, 1
    ADD R1, 1
    LDI print_text
    MOV R2, R0
    MOV R0, R1
    JMP R2
    NOP
print_text_ret:
    JMP LR
    NOP
print_prompt:
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 1               ; DS offset 1
    MOV R7, R0
    LDI '>'
    STS R0, DS, R7      ; DS:[1] = '>'
    SWI
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 1               ; DS offset 1
    MOV R7, R0
    LDI ' '
    STS R0, DS, R7      ; DS:[1] = ' '
    SWI
    JMP LR
    NOP
bios_putch_direct:
    LDI 2
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    STS R0, DS, R7
    SWI
    JMP LR
    NOP
bios_putstr_direct:
    LDI 3
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    STS R0, DS, R7
    SWI
    JMP LR
    NOP
bios_getch_direct:
    LDI 4
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    SWI
    LDI 1
    MOV R7, R0
    LDS R0, DS, R7
    JMP LR
    NOP
bios_getstr_direct:
    LDI 5
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    STS R0, DS, R7
    SWI
    JMP LR
    NOP
cursor_off:
    LDS R1, ES, SCR
    LDI 0x7FFF
    AND R1, R0
    STS R1, ES, SCR
    LDI interpret_loop
    MOV PC, R0
    NOP
    ; Ensure Data Segment points to physical 0x0000
    LDI 0
    MVS DS, R0
    ; Ensure Code/Stack segments are also 0x0000 for correct jumps/stack
    MVS SS, R0
    MVS CS, R0
    LDI 2
    MOV R2, R0
    LDI swi_to_bios
    MOV R1, R0
    STS R1, DS, R2

    ; Print greeting only
    LDI hello_msg
    MOV R1, R0
    LDI after_print_text
    MOV LR, R0
    LDI print_text
    MOV R2, R0
    MOV R0, R1
    JMP R2
    NOP
after_print_text:
    ; Advance to start of next line (column 0)
    LDI 0x1000
    MOV R8, R0           
    MOV R9, SCR          
    SUB R9, R8           
    LDI 80               
    MOV R10, R0          
    MOV R11, R9          
    DIV R11, R10         
    ADD R11, 1           
    MUL R11, R10         
    ADD R8, R11          
    MOV SCR, R8          
    ; Prepare input buffer and counters
    LDI tib_kbd
    MOV TIB, R0
    LDI 0
    MOV >IN, R0
    LDI 0
    MOV R11, R0
    LDI print_prompt
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI word_accept
    MOV PC, R0
    NOP

; Bridge SWI handler: set CS to BIOS segment and jump to offset 0
swi_to_bios:
    ; Build target CS=0xF800 and PC=0 and far jump via JML
    LDI 0x0FFF
    INV R0               ; R0 = 0xF000
    MOV R2, R0           ; R2 = 0xF000
    LDI 0x0800
    MOV R3, R0           ; R3 = 0x0800
    ADD R2, R3           ; R2 = 0xF800 (target CS)
    LDI 0
    MOV R3, R0           ; R3 = 0x0000 (target PC)
    JML R2               ; delayed far jump to CS=R2, PC=R3

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
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ interpret_done
    LDI ' '
    CMP R4, R0
    JZ interpret_done
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
    JZ word_is_match
    LDI next_entry
    MOV PC, R0
    NOP
word_is_match:
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
    JNZ chk_cr
    LDI word_drop
    MOV PC, R0
    NOP
chk_cr:
    LDI cr_name
    CMP R2, R0
    JNZ chk_key
    LDI word_cr
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
    LDI 0x1000
    MOV R2, R0
    MOV R4, SCR
    SUB R4, R2
    LDI 80
    MOV R5, R0
    MOV R9, R4
    DIV R9, R5
    ADD R9, 1
    MUL R9, R5
    ADD R2, R9
    MOV SCR, R2
    LDI print_text
    MOV R2, R0
    LDI unknown_word_msg
    LINK
    JMP R2
    NOP
skip_unknown_after_prefix:
    MOV R3, TIB
    ADD R3, >IN
    LDI print_buf
    MOV R10, R0
    LDI 0
    MOV R11, R0
print_bad_loop:
    LD R2, R3, 0
    LDI 0x00FF
    AND R2, R0
    LDI 0
    CMP R2, R0
    JZ print_bad_done
    LDI ' '
    CMP R2, R0
    JZ print_bad_done
    LDI 10
    CMP R2, R0
    JZ print_bad_done
    LDI 13
    CMP R2, R0
    JZ print_bad_done
    ST R2, R10, 0
    ADD R10, 1
    ADD R3, 1
    ADD R11, 1
    LDI print_bad_loop
    MOV PC, R0
    NOP
print_bad_done:
    LDI 0
    ST R0, R10, 0
    LDI bios_putstr_direct
    MOV R2, R0
    LDI print_buf
    MOV R0, R0
    JMP R2
    NOP
    LD R2, R3, 0
    LDI 0x00FF
    AND R2, R0
    LDI ' '
    CMP R2, R0
    JNZ skip_space_adv
    ADD R3, 1
skip_space_adv:
    MOV R1, R3
    SUB R1, TIB
    MOV >IN, R1
    LDI interpret_loop
    MOV PC, R0
    NOP

stack_underflow_error:
    LDI 0x1000
    MOV R2, R0
    MOV R4, SCR
    SUB R4, R2
    LDI 80
    MOV R5, R0
    MOV R9, R4
    DIV R9, R5
    ADD R9, 1
    MUL R9, R5
    ADD R2, R9
    MOV SCR, R2
    LDI print_text
    MOV R2, R0
    LDI stack_underflow_msg
    LINK
    JMP R2
    NOP
stack_underflow_after:
    LDI 0x1000
    MOV R2, R0
    MOV R4, SCR
    SUB R4, R2
    LDI 80
    MOV R5, R0
    MOV R9, R4
    DIV R9, R5
    ADD R9, 1
    MUL R9, R5
    ADD R2, R9
    MOV SCR, R2
    LDI print_prompt
    MOV R2, R0
    LINK
    JMP R2
    NOP
next_entry:
    ADD R7, 2
    LDI dict_loop
    MOV PC, R0
    NOP

interpret_done:
    LDI 0x1000
    MOV R2, R0
    MOV R3, SCR
    SUB R3, R2
    LDI 80
    MOV R4, R0
    MOV R5, R3
    DIV R5, R4
    LDI 24
    CMP R5, R0
    JNZ ok_after
    LDI 0
    MOV R7, R0
    LDI 1920
    MOV R10, R0
    LDI 80
    MOV R12, R0
ok_scroll_copy:
    MOV R13, R2
    ADD R13, R7
    MOV R11, R2
    ADD R11, R7
    ADD R11, R12
    LDS R1, ES, R11
    STS R1, ES, R13
    ADD R7, 1
    CMP R7, R10
    JNZ ok_scroll_copy
    LDI 0
    MOV R7, R0
    LDI 80
    MOV R9, R0
ok_scroll_clear:
    MOV R13, R2
    ADD R13, R7
    ADD R13, R10
    LDI ' '
    STS R0, ES, R13
    ADD R7, 1
    SUB R9, 1
    LDI 0
    CMP R9, R0
    JNZ ok_scroll_clear
    MOV SCR, R2
    ADD SCR, R10
    LDI ok_after
    MOV PC, R0
    NOP
; No reposition on normal case; keep SCR where result ended
ok_after:
    ; Print " ok"
    LDI 3               ; BIOS putstr
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 3
    LDI 1               ; DS offset 1
    MOV R7, R0
    LDI ok_msg
    STS R0, DS, R7      ; DS:[1] = ok_msg
    SWI
    ; Newline via BIOS: CR then LF
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 1               ; DS offset 1
    MOV R7, R0
    LDI 13              ; CR
    STS R0, DS, R7      ; DS:[1] = 13
    SWI
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 1               ; DS offset 1
    MOV R7, R0
    LDI 10              ; LF
    STS R0, DS, R7      ; DS:[1] = 10
    SWI
    ; Prompt
    LDI print_prompt
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; Read next line into TIB via BIOS and then interpret
    LDI word_accept
    MOV PC, R0
    NOP

; =============================================
; Data Section
; =============================================

.org 0x3000
sp0_base:
    .word 0
hello_msg:
    .text "Hello DeepForth!"

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

unknown_word_msg:
    .text "undefined word: "
stack_underflow_msg:
    .text "stack underflow"
ok_msg:
    .text " ok"

dict_names:
plus_name:
    .text "+"
mul_name:
    .text "*"
dup_name:
    .text "dup"
dot_name:
    .text "."
emit_name:
    .text "emit"
swap_name:
    .text "swap"
drop_name:
    .text "drop"
cr_name:
    .text "cr"
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
    .word cr_name
    .word word_cr
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
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wp_ok
    JN wp_ok
    LDI stack_underflow_error
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
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wm_ok
    JN wm_ok
    LDI stack_underflow_error
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
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wd_under
    LD R1, SP, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
wd_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP
word_dot:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ dot_under
    LD R1, SP, 0
    ADD SP, 1
    MOV R2, R1          ; value
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 0
    CMP R2, R0
    JNZ dot_nonzero
    LDI '0'
    STS R0, ES, SCR
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
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LDI ok_after
    MOV PC, R0
    NOP
dot_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP
word_emit:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ we_under
    LD R1, SP, 0
    ADD SP, 1
    LDI 0x00FF
    AND R1, R0
    LDI 10
    CMP R1, R0
    JZ emit_do_cr
    LDI 13
    CMP R1, R0
    JZ emit_do_lf
    MOV R3, R1
    LDI 2               ; value = 2
    MOV R3, R0
    LDI 0               ; offset = 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 1               ; offset = 1
    MOV R7, R0
    STS R3, DS, R7      ; DS:[1] = char
    SWI
    LDI interpret_loop
    MOV PC, R0
    NOP
we_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

emit_do_cr:
    LDI 0x1000
    MOV R9, R0           ; base
    MOV R10, SCR         ; current address
    SUB R10, R9          ; offset from base
    LDI 80
    MOV R11, R0          ; width
    DIV R10, R11         ; R10=row
    MUL R10, R11         ; row*width
    ADD R9, R10          ; base + row*width
    MOV SCR, R9          ; start of current line, column 0
    LDI interpret_loop
    MOV PC, R0
    NOP

emit_do_lf:
    LDI 0x1000
    MOV R9, R0           ; base
    MOV R10, SCR         ; current address
    SUB R10, R9          ; offset from base
    LDI 80
    MOV R11, R0          ; width
    MOV R2, R10          ; save offset
    DIV R10, R11         ; R10=row
    ; Compute column based on current row before increment
    MOV R12, R10         ; R12=row copy
    MUL R12, R11         ; row*width
    SUB R2, R12          ; col = offset - row*width
    ; Clamp to last row (24)
    LDI 24
    MOV R7, R0
    CMP R10, R7
    JN emit_lf_row_lt_local
emit_lf_row_lt_local:
    ADD R10, 1           ; next row
emit_lf_row_done_local:
    MUL R10, R11         ; next_row*width
    ADD R9, R10          ; base + next_row*width
    ADD R9, R2           ; + same column
    MOV SCR, R9
    LDI interpret_loop
    MOV PC, R0
    NOP
    LDI 0
    MOV R7, R0
    LDI 1920
    MOV R5, R0
    LDI 80
    MOV R12, R0
emit_lf_scroll_copy:
    MOV R13, R9
    ADD R13, R7
    MOV R4, R9
    ADD R4, R7
    ADD R4, R12
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R13, 1
    ADD R4, 1
    LDS R1, ES, R4
    STS R1, ES, R13
    ADD R7, 8
    LDI 24
    MOV R3, R0
    ADD R7, R3
    CMP R7, R5
    JNZ emit_lf_scroll_copy
    LDI 0
    MOV R7, R0
    LDI 80
    MOV R4, R0
emit_lf_scroll_clear:
    MOV R13, R9
    ADD R13, R5
    ADD R13, R7
    LDI ' '
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    ADD R13, 1
    STS R0, ES, R13
    LDI 16
    MOV R3, R0
    ADD R7, R3
    SUB R4, R3
    LDI 0
    CMP R4, R0
    JNZ emit_lf_scroll_clear
    LDI 24
    MOV R10, R0
emit_lf_row_lt:
    ADD R10, 1           ; next row
emit_lf_row_done:
    MUL R10, R11         ; next_row*width
    ADD R9, R10          ; base + next_row*width
    ADD R9, R2           ; + same column
    MOV SCR, R9
    LDI interpret_loop
    MOV PC, R0
    NOP

word_swap:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ ws_ok
    JN ws_ok
    LDI stack_underflow_error
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
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wd2_under
    ADD SP, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
wd2_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

print_buf:
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
key_name:
    .text "key"
accept_name:
    .text "accept"
word_key:
    ; BIOS getch -> char in R0
    LDI 4               ; value = 4
    MOV R4, R0
    LDI 0               ; offset = 0
    MOV R7, R0
    STS R4, DS, R7      ; DS:[0] = 4
    SWI
    LDI 1               ; offset = 1
    MOV R7, R0
    LDS R0, DS, R7      ; R0 = DS:[1]
    SUB SP, 1
    ST R0, SP, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_accept:
    ; Use BIOS getstr to read a line into TIB with echo
    LDI tib_kbd
    MOV TIB, R0
    LDI 5               ; value = 5
    MOV R4, R0
    LDI 0               ; offset = 0
    MOV R7, R0
    STS R4, DS, R7      ; DS:[0] = 5
    LDI 1               ; offset = 1
    MOV R7, R0
    STS TIB, DS, R7     ; DS:[1] = TIB
    SWI
    ; reset input index
    LDI 0
    MOV >IN, R0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_cr:
    ; CR
    LDI 0x1000
    MOV R9, R0           ; base
    MOV R10, SCR         ; current
    SUB R10, R9          ; offset
    LDI 80
    MOV R11, R0          ; width
    DIV R10, R11         ; R10=row
    MUL R10, R11         ; row*width
    ADD R9, R10          ; base + row*width
    MOV SCR, R9          ; col 0
    ; LF same column
    LDI 0x1000
    MOV R9, R0           ; base
    MOV R10, SCR         ; current
    SUB R10, R9          ; offset
    LDI 80
    MOV R11, R0          ; width
    MOV R2, R10          ; save offset
    DIV R10, R11         ; R10=row
    ; Compute column based on current row before increment
    MOV R12, R10         ; R12=row copy
    MUL R12, R11         ; row*width
    SUB R2, R12          ; col = offset - row*width
    ; Clamp to last row (24)
    LDI 24
    MOV R7, R0
    CMP R10, R7
    JN word_cr_row_lt
    CLRZ
    JNZ word_cr_row_done
    NOP
word_cr_row_lt:
    ADD R10, 1
word_cr_row_done:
    MUL R10, R11
    ADD R9, R10
    ADD R9, R2
    MOV SCR, R9
    LDI interpret_loop
    MOV PC, R0
    NOP

; =============================================
; BIOS Implementation (at physical 0xF8000)
; =============================================
.org 0xF8000
.code
bios_entry:
    ; Dispatch on function code stored at DS:0
    LDI 0
    MOV R3, R0
    LDS R1, DS, R3
    CMP R1, R0
    JNZ bios_f1
    ; 0: bver -> R0 = 0x0001 (version 0.1)
    LDI 0x0001
    RETI
    NOP
bios_f1:
    LDI 1
    CMP R1, R0
    JNZ bios_f2
    ; 1: binit -> init screen/keyboard, clear screen
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x1000
    MOV SCR, R0
    ; Clear 80*25 to ' ' using SCR as base (ES selection requires R8)
    LDI 2000
    MOV R2, R0
    LDI ' '
    MOV R3, R0
bios_clr_loop:
    STS R3, ES, SCR
    ADD SCR, 1
    SUB R2, 1
    JNZ bios_clr_loop
    NOP
    ; Place cursor at start
    LDI 0x1000
    MOV SCR, R0
    LSI R0, 1
    SL  R0, 15
    LDS R1, ES, SCR
    OR  R1, R0
    STS R1, ES, SCR
    RETI
    NOP
bios_f2:
    LDI 2
    CMP R1, R0
    JNZ bios_f3
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 2: putch (char from DS:1) with CR/LF handling and scroll
    LDI 1
    MOV R3, R0
    LDS R2, DS, R3      ; R2=char
    LDI 10
    CMP R2, R0
    JZ bios_putch_lf
    LDI 13
    CMP R2, R0
    JZ bios_putch_cr
    ; regular character: clear old cursor, write char, advance, set new cursor
    LDI 0x7FFF
    MOV R5, R0
    LDS R1, ES, SCR
    AND R1, R5
    STS R1, ES, SCR
    STS R2, ES, SCR
    ADD SCR, 1
    LSI R1, 1
    SL  R1, 15
    LDS R3, ES, SCR
    OR  R3, R1
    STS R3, ES, SCR
    RETI
    NOP
bios_putch_cr:
    ; carriage return: go to start of current line
    LDI 0x1000
    MOV R9, R0
    MOV R10, SCR
    SUB R10, R9
    LDI 80
    MOV R11, R0
    DIV R10, R11
    MUL R10, R11
    ADD R9, R10
    MOV SCR, R9
    RETI
    NOP
bios_putch_lf:
    ; line feed: same column next row, scroll at last row
    LDI 0x1000
    MOV R9, R0           ; base
    MOV R10, SCR         ; current
    SUB R10, R9          ; offset
    LDI 80
    MOV R11, R0          ; width
    MOV R4, R10          ; save offset
    DIV R10, R11         ; R10=row
    ; compute column
    MOV R12, R10
    MUL R12, R11
    SUB R4, R12          ; col
    ; clamp row+1 to last row
    ADD R10, 1
    LDI 24
    MOV R3, R0
    CMP R10, R3
    JN bios_lf_row_lt
    ; need to scroll: copy rows 1..24 up, clear last row
    LDI 0
    MOV R2, R0
    LDI 1920
    MOV R5, R0
    LDI 80
    MOV R12, R0
bios_lf_scroll_copy:
    MOV R13, R9
    ADD R13, R2
    MOV R7, R9
    ADD R7, R2
    ADD R7, R12
    LDS R1, ES, R7
    STS R1, ES, R13
    ADD R2, 1
    CMP R2, R5
    JNZ bios_lf_scroll_copy
    NOP
    ; clear last row
    LDI 0
    MOV R2, R0
    LDI 80
    MOV R15, R0
    LDI ' '
    MOV R1, R0
bios_lf_scroll_clear:
    MOV R13, R9
    ADD R13, R2
    ADD R13, R5
    STS R1, ES, R13
    ADD R2, 1
    SUB R15, 1
    LDI 0
    CMP R15, R0
    JNZ bios_lf_scroll_clear
    NOP
    ; set row to last
    LDI 24
    MOV R10, R0
bios_lf_row_lt:
    MUL R10, R11
    ADD R9, R10
    ADD R9, R4          ; +col
    MOV SCR, R9
    RETI
    NOP
bios_f3:
    LDI 3
    CMP R1, R0
    JNZ bios_f4
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 3: putstr (address in DS:1, null-terminated)
    LDI 1
    MOV R3, R0
    LDS R2, DS, R3
bios_putstr_loop:
    LD R1, R2, 0
    LDI 0
    CMP R1, R0
    JZ bios_putstr_done
    STS R1, ES, SCR
    ADD SCR, 1
    ADD R2, 1
    CLRZ
    JNZ bios_putstr_loop
    NOP
bios_putstr_done:
    RETI
    NOP
bios_f4:
    LDI 4
    CMP R1, R0
    JNZ bios_f5
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 4: getch -> R0 = keycode (low byte)
bios_getch_wait:
    LDI KBD_STATUS
    MOV R2, R0
    LDS R1, ES, R2
    LDI 0
    CMP R1, R0
    JZ bios_getch_wait
    LDI KBD_DATA
    MOV R2, R0
    LDS R1, ES, R2
    LDI 0x00FF
    AND R1, R0
    ; Store result to DS:1 for caller
    LDI 1
    MOV R3, R0
    STS R1, DS, R3
    RETI
    NOP
bios_f5:
    LDI 5
    CMP R1, R0
    JNZ bios_unknown
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 5: getstr (buffer addr in DS:1), echo
    LDI 1
    MOV R3, R0
    LDS R2, DS, R3   ; buf
    LDI 0
    MOV R11, R0      ; count
bios_getstr_loop:
    LDI KBD_STATUS
    MOV R4, R0
    LDS R1, ES, R4
    LDI 0
    CMP R1, R0
    JZ bios_getstr_loop
    LDI KBD_DATA
    MOV R4, R0
    LDS R1, ES, R4
    LDI 0x00FF
    AND R1, R0
    LDI 10
    CMP R1, R0
    JZ bios_getstr_done
    LDI 13
    CMP R1, R0
    JZ bios_getstr_done
    ; backspace
    LDI 8
    CMP R1, R0
    JNZ bios_store_char
    LDI 0
    CMP R11, R0
    JZ bios_getstr_loop
    SUB R11, 1
    SUB SCR, 1
    LDI ' '
    STS R0, ES, SCR
    LSI R0, 1
    SL  R0, 15
    LDS R3, ES, SCR
    OR  R3, R0
    STS R3, ES, SCR
    CLRZ
    JNZ bios_getstr_loop
    NOP
bios_store_char:
    ST R1, R2, 0
    ADD R2, 1
    ADD R11, 1
    ; echo directly: clear old cursor, write, advance, set cursor
    LDI 0x7FFF
    MOV R5, R0
    LDS R3, ES, SCR
    AND R3, R5
    STS R3, ES, SCR
    STS R1, ES, SCR
    ADD SCR, 1
    LSI R0, 1
    SL  R0, 15
    LDS R7, ES, SCR
    OR  R7, R0
    STS R7, ES, SCR
    CLRZ
    JNZ bios_getstr_loop
    NOP
bios_getstr_done:
    LDI 0
    ST R0, R2, 0
    RETI
    NOP
bios_unknown:
    RETI
    NOP
