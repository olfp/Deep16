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
.equ RSTACK_TOP 0x6F00   ; Forth return stack top (grows down)

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
    NOP
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
    MOV R2, R0           ; park the character: R0 is rebuilt below
    LDI 2
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    MOV R0, R2
    STS R0, DS, R7
    SWI
    JMP LR
    NOP
bios_putstr_direct:
    MOV R2, R0           ; park the string address: R0 is rebuilt below
    LDI 3
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    MOV R0, R2
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
    MOV R2, R0           ; park the buffer address: R0 is rebuilt below
    LDI 5
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    MOV R0, R2
    STS R0, DS, R7
    SWI
    JMP LR
    NOP
newline_direct:
    ; CR + LF via BIOS putch so the cursor moves to a fresh line (with
    ; scrolling on the last row). Same newline the interpreter prints
    ; after " ok".
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    LDI 13              ; CR
    STS R0, DS, R7
    SWI
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    LDI 10              ; LF
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
    NOP
    LDI interpret_done
    MOV PC, R0
    NOP
not_eol:
    LDI ' '
    CMP R2, R0
    JNZ token_start
    NOP
    ADD >IN, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
token_start:
    LDI '"'
    CMP R2, R0
    JNZ check_apostrophe
    NOP
    ; Bare string opening: advance inside string and print
    ADD >IN, 1
    LDI print_string_skip
    MOV PC, R0
    NOP
check_apostrophe:
    LDI 39
    CMP R2, R0
    JNZ check_dot_token
    NOP
    ADD >IN, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
check_dot_token:
    LDI '.'
    CMP R2, R0
    JNZ check_number_or_word
    NOP
    MOV R3, TIB
    ADD R3, >IN
    ADD R3, 1
    LD R4, R3, 0
    LDI '"'
    CMP R4, R0
    JNZ dot_plain
    NOP
    LD R5, R3, 1
    LDI ' '
    CMP R5, R0
    JZ farpatch304
    NOP
    LDI skip_unknown
    MOV PC, R0
    NOP
farpatch304:
    NOP
    MOV R1, R3
    SUB R1, TIB
    MOV >IN, R1
    ADD >IN, 1
    LDI print_string_skip
    MOV PC, R0
    NOP
dot_plain:
    ; `.` is an ordinary dictionary word; route it through parse_word so the
    ; compile state and immediate flag are honoured. >IN still sits on '.'.
    LDI parse_word
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
    NOP
    LDI ' '
    CMP R2, R0
    JNZ psk_go
    NOP
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
    NOP
    LDI '"'
    CMP R2, R0
    JZ after_string
    NOP
    ; Handle escaped quote \" -> print '"' and continue
    LDI '\\'
    CMP R2, R0
    JNZ print_string_normal
    NOP
    LD R5, R1, 1
    LDI '"'
    CMP R5, R0
    JNZ print_string_normal
    NOP
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
    NOP
    LDI '9'
    CMP R0, R4
    JN parse_word            ; if '9' < ch => word
    NOP
    ; The first character is a digit, but the word is a number only if the
    ; whole token is digits. Words such as 2dup, 1+ or 0= start with a digit.
number_scan:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ parse_number          ; NUL ends the token => number
    NOP
    LDI ' '
    CMP R4, R0
    JZ parse_number          ; space ends the token => number
    NOP
    LDI '0'
    CMP R4, R0
    JN parse_word            ; a non-digit makes it a word
    NOP
    LDI '9'
    CMP R0, R4
    JN parse_word            ; a non-digit makes it a word
    NOP
    ADD R3, 1
    LDI number_scan
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
    NOP
    LDI ' '
    CMP R4, R0
    JZ finish_number
    NOP
    LDI '0'
    CMP R4, R0
    JN finish_number        ; ch < '0' => stop
    NOP
    LDI '9'
    CMP R0, R4
    JN finish_number        ; '9' < ch => stop
    NOP
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
    ; A number pushes its value; while compiling it becomes LIT <value>.
    LDI state_var
    MOV R2, R0
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JNZ compile_number
    NOP
    MOV R1, R7
    SUB SP, 1
    ST R1, SP, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
compile_number:
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    LDI xt_lit
    MOV R4, R0
    ST R4, R3, 0             ; LIT
    ADD R3, 1
    ST R7, R3, 0             ; the literal
    ADD R3, 1
    ST R3, R2, 0
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
    NOP
    LDI ' '
    CMP R4, R0
    JZ interpret_done
    NOP
    ; Measure the token first: R11 = length. The delimiters stay
    ; untouched so a match can advance >IN by exactly the token length.
    LDI 0
    MOV R11, R0
word_len_loop:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ word_len_done
    NOP
    LDI ' '
    CMP R4, R0
    JZ word_len_done
    NOP
    ADD R3, 1
    ADD R11, 1
    LDI word_len_loop
    MOV PC, R0
    NOP
word_len_done:
    ; Search each wordlist in the search order (R12 = index). Within a
    ; wordlist the headers chain newest first: link | flags+len | name | CFA.
    LDI 0
    MOV R12, R0
find_wl:
    LDI search_order
    MOV R2, R0
    ADD R2, R12
    LD R2, R2, 0             ; head cell address of this wordlist
    LDI 0
    CMP R2, R0
    JZ skip_unknown          ; end of the search order: token is unknown
    NOP
    LD R7, R2, 0             ; newest header in this wordlist
find_loop:
    LDI 0
    CMP R7, R0
    JZ find_next_wl
    NOP
    LD R2, R7, 1             ; flags+len cell
    LDI 0x00FF
    AND R2, R0               ; name length stored in this header
    CMP R2, R11
    JNZ find_next
    NOP
    ; Lengths agree: compare the name characters.
    MOV R10, R7
    ADD R10, 2               ; name starts at header+2
    MOV R3, TIB
    ADD R3, >IN
    MOV R9, R11              ; character countdown
find_cmp:
    LD R2, R3, 0
    LD R4, R10, 0
    CMP R2, R4
    JNZ find_next
    NOP
    ADD R3, 1
    ADD R10, 1
    SUB R9, 1
    LDI 0
    CMP R9, R0
    JNZ find_cmp
    NOP
    ; Match: the CFA (xt) cell sits at header + 2 + length + 1 (NUL from .text).
    MOV R2, R7
    ADD R2, 3
    ADD R2, R11
    MOV R1, R2               ; R1 = xt = CFA cell address
    LD R4, R7, 1             ; flags+len cell
    LDI 1
    SL R0, 15                ; R0 = 0x8000 (IMMEDIATE mask; LDI is 15-bit)
    AND R4, R0               ; R4 = IMMEDIATE flag
    ADD >IN, R11             ; step over the token
    ; While compiling, a non-immediate word is appended to the definition.
    LDI state_var
    MOV R3, R0
    LD R3, R3, 0
    LDI 0
    CMP R3, R0
    JZ find_execute
    NOP
    LDI 0
    CMP R4, R0
    JNZ find_execute
    NOP
    LDI dp_var
    MOV R3, R0
    LD R2, R3, 0
    ST R1, R2, 0             ; compile the xt
    ADD R2, 1
    ST R2, R3, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
find_execute:
    LDI execute_xt
    MOV PC, R0
    NOP
find_next:
    LD R7, R7, 0             ; follow the link field
    LDI find_loop
    MOV PC, R0
    NOP
find_next_wl:
    ADD R12, 1
    LDI find_wl
    MOV PC, R0
    NOP

skip_unknown:
    ; An error aborts any definition in progress, so the next line is
    ; interpreted rather than compiled into the broken word.
    LDI state_var
    MOV R3, R0
    LDI 0
    ST R0, R3, 0
    ; The offending token's offset lives in >IN (R5), but the computation
    ; below reuses R5 for the column width. Park the token offset in R12
    ; (a scratch register on this path) so the bad word can be echoed.
    MOV R12, R5
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
    ADD R3, R12
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
    NOP
    LDI ' '
    CMP R2, R0
    JZ print_bad_done
    NOP
    LDI 10
    CMP R2, R0
    JZ print_bad_done
    NOP
    LDI 13
    CMP R2, R0
    JZ print_bad_done
    NOP
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
    ; The message above returned to skip_unknown_after_prefix via the LINK
    ; return address; arm a fresh return point for the putstr call below.
    LDI err_continue
    MOV LR, R0
    LDI bios_putstr_direct
    MOV R2, R0
    LDI print_buf
    MOV R0, R0
    JMP R2
    NOP
err_continue:
    ; Discard the rest of the line: fresh line, prompt, next input.
    LDI newline_direct
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI print_prompt
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI word_accept
    MOV PC, R0
    NOP

stack_underflow_error:
    LDI 0x1000
    MOV R2, R0
    MOV R4, SCR
    SUB R4, R2
    LDI 80
    MOV R12, R0          ; width (R5 is >IN — leave it alone)
    MOV R9, R4
    DIV R9, R12
    ADD R9, 1
    MUL R9, R12
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
    MOV R12, R0          ; width (R5 is >IN — leave it alone)
    MOV R9, R4
    DIV R9, R12
    ADD R9, 1
    MUL R9, R12
    ADD R2, R9
    MOV SCR, R2
    LDI print_prompt
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI word_accept      ; recover: fresh prompt, then read the next line
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
    NOP
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
    NOP
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
    NOP
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

; --------------------------------------------
; Wort-Header der eingebauten Wörter.
; Format: link | flags+len | name (NUL kommt von .text) | CFA
;   link     Adresse des Vorgänger-Headers, 0 = Ende der Kette
;   flags+len High-Byte Flags (Bit 15 = IMMEDIATE, ab P2), Low-Byte Namenslänge
; Die Kette läuft vom neuesten zum ältesten Wort; die Kopfzelle wird vom
; jeweiligen Wordlist-Kopf (forth_wl oder einem Vokabular) gehalten.
; --------------------------------------------
h_accept:
    .word h_key
    .word 6
    .text "accept"
    .word word_accept
h_key:
    .word h_cr
    .word 3
    .text "key"
    .word word_key
h_cr:
    .word h_drop
    .word 2
    .text "cr"
    .word word_cr
h_drop:
    .word h_swap
    .word 4
    .text "drop"
    .word word_drop
h_swap:
    .word h_emit
    .word 4
    .text "swap"
    .word word_swap
h_emit:
    .word h_dot
    .word 4
    .text "emit"
    .word word_emit
h_dot:
    .word h_dup
    .word 1
    .text "."
    .word word_dot
h_dup:
    .word h_mul
    .word 3
    .text "dup"
    .word word_dup
h_mul:
    .word h_plus
    .word 1
    .text "*"
    .word word_mul
h_plus:
    .word 0
    .word 1
    .text "+"
    .word word_plus

; --- P2 compiler words (chain is newest first, `current` holds its head) ---
h_immediate:
    .word h_state
    .word 0x8009          ; IMMEDIATE flag (0x8000) | length 9
    .text "immediate"
    .word word_immediate
h_state:
    .word h_bracket_end
    .word 5
    .text "state"
    .word word_state
h_bracket_end:
    .word h_bracket_begin
    .word 1
    .text "]"
    .word word_bracket_end
h_bracket_begin:
    .word h_semicolon
    .word 0x8001          ; IMMEDIATE | length 1
    .text "["
    .word word_bracket_begin
h_semicolon:
    .word h_colon
    .word 0x8001          ; IMMEDIATE | length 1
    .word 59              ; name ";" — written as a word because ';' in .text
    .word 0               ; starts a comment
    .word word_semicolon
h_colon:
    .word h_accept
    .word 1
    .text ":"
    .word word_colon

; --- P3 stack, arithmetic and comparison words (newest first) ---
h_depth:
    .word h_0gt
    .word 5
    .text "depth"
    .word word_depth
h_0gt:
    .word h_0lt
    .word 2
    .text "0>"
    .word word_0gt
h_0lt:
    .word h_0eq
    .word 2
    .text "0<"
    .word word_0lt
h_0eq:
    .word h_gt
    .word 2
    .text "0="
    .word word_0eq
h_gt:
    .word h_lt
    .word 1
    .text ">"
    .word word_gt
h_lt:
    .word h_ne
    .word 1
    .text "<"
    .word word_lt
h_ne:
    .word h_eq
    .word 2
    .text "<>"
    .word word_ne
h_eq:
    .word h_2star
    .word 1
    .text "="
    .word word_eq
h_2star:
    .word h_1minus
    .word 2
    .text "2*"
    .word word_2star
h_1minus:
    .word h_1plus
    .word 2
    .text "1-"
    .word word_1minus
h_1plus:
    .word h_2drop
    .word 2
    .text "1+"
    .word word_1plus
h_2drop:
    .word h_2dup
    .word 5
    .text "2drop"
    .word word_2drop
h_2dup:
    .word h_nip
    .word 4
    .text "2dup"
    .word word_2dup
h_nip:
    .word h_rot
    .word 3
    .text "nip"
    .word word_nip
h_rot:
    .word h_over
    .word 3
    .text "rot"
    .word word_rot
h_over:
    .word h_slash_mod
    .word 4
    .text "over"
    .word word_over
h_slash_mod:
    .word h_mod
    .word 4
    .text "/mod"
    .word word_slash_mod
h_mod:
    .word h_div
    .word 3
    .text "mod"
    .word word_mod
h_div:
    .word h_negate
    .word 1
    .text "/"
    .word word_div
h_negate:
    .word h_minus
    .word 6
    .text "negate"
    .word word_negate
h_minus:
    .word h_immediate
    .word 1
    .text "-"
    .word word_minus

; --- additional arithmetic: u. 2/ abs min max ---
; These five are the newest entries in the whole dictionary, so the oldest of
; them links into the vocabulary chain below and forth_wl names the newest.
h_udot:
    .word h_max
    .word 2
    .text "u."
    .word word_udot
h_max:
    .word h_min
    .word 3
    .text "max"
    .word word_max
h_min:
    .word h_abs
    .word 3
    .text "min"
    .word word_min
h_abs:
    .word h_twoshift
    .word 3
    .text "abs"
    .word word_abs
h_twoshift:
    .word h_forget
    .word 2
    .text "2/"
    .word word_two_slash

; --- P3 control-flow words (immediate where they act at compile time) ---
h_recurse:
    .word h_exit
    .word 0x8007          ; IMMEDIATE | length 7
    .text "recurse"
    .word word_recurse
h_exit:
    .word h_repeat
    .word 4
    .text "exit"
    .word exit
h_repeat:
    .word h_while
    .word 0x8006          ; IMMEDIATE
    .text "repeat"
    .word word_repeat
h_while:
    .word h_again
    .word 0x8005          ; IMMEDIATE
    .text "while"
    .word word_while
h_again:
    .word h_until
    .word 0x8005          ; IMMEDIATE
    .text "again"
    .word word_again
h_until:
    .word h_begin
    .word 0x8005          ; IMMEDIATE
    .text "until"
    .word word_until
h_begin:
    .word h_else
    .word 0x8005          ; IMMEDIATE
    .text "begin"
    .word word_begin
h_else:
    .word h_then
    .word 0x8004          ; IMMEDIATE
    .text "else"
    .word word_else
h_then:
    .word h_if
    .word 0x8004          ; IMMEDIATE
    .text "then"
    .word word_then
h_if:
    .word h_depth
    .word 0x8002          ; IMMEDIATE
    .text "if"
    .word word_if

; --- vocabularies (newest first) ---
h_forget:
    .word h_words
    .word 6
    .text "forget"
    .word word_forget
h_words:
    .word h_vocabulary
    .word 5
    .text "words"
    .word word_words
h_vocabulary:
    .word h_definitions
    .word 10
    .text "vocabulary"
    .word word_vocabulary
h_definitions:
    .word h_also
    .word 11
    .text "definitions"
    .word word_definitions
h_also:
    .word h_only
    .word 4
    .text "also"
    .word word_also
h_only:
    .word h_previous
    .word 4
    .text "only"
    .word word_only
h_previous:
    .word h_forth
    .word 8
    .text "previous"
    .word word_previous
h_forth:
    .word h_to
    .word 5
    .text "forth"
    .word word_forth

; --- P3 memory words and the simple defining words (newest first) ---
h_to:
    .word h_value
    .word 0x8002          ; IMMEDIATE | length 2
    .text "to"
    .word word_to
h_value:
    .word h_create
    .word 5
    .text "value"
    .word word_value
h_create:
    .word h_does
    .word 6
    .text "create"
    .word word_create
h_does:
    .word h_variable
    .word 5
    .text "does>"
    .word word_does
h_variable:
    .word h_constant
    .word 8
    .text "variable"
    .word word_variable
h_constant:
    .word h_cellplus
    .word 8
    .text "constant"
    .word word_constant
h_cellplus:
    .word h_cells
    .word 5
    .text "cell+"
    .word word_cellplus
h_cells:
    .word h_comma
    .word 5
    .text "cells"
    .word word_cells
h_comma:
    .word h_allot
    .word 1
    .word 44, 0           ; "," + NUL (a bare comma is assembler syntax)
    .word word_comma
h_allot:
    .word h_here
    .word 5
    .text "allot"
    .word word_allot
h_here:
    .word h_plusstore
    .word 4
    .text "here"
    .word word_here
h_plusstore:
    .word h_cstore
    .word 2
    .text "+!"
    .word word_plusstore
h_cstore:
    .word h_cfetch
    .word 2
    .text "c!"
    .word word_cstore
h_cfetch:
    .word h_store
    .word 2
    .text "c@"
    .word word_cfetch
h_store:
    .word h_fetch
    .word 1
    .text "!"
h_store_cfa:               ; xt cell of `!`, compiled by TO
    .word word_store
h_fetch:
    .word h_recurse
    .word 1
    .text "@"
    .word word_fetch

; --- wordlists: a vocabulary is identified by the address of its head cell,
; --- which chains its definitions newest-first and ends in 0.
forth_wl:
    .word h_udot         ; newest built-in header in the FORTH vocabulary
search_order:            ; wordlists searched by FIND, first one first, 0-ended
    .word forth_wl
    .word 0, 0, 0, 0, 0, 0, 0
current:
    .word forth_wl       ; wordlist new definitions are added to
found_wl:
    .word 0              ; head cell of the wordlist FIND matched last

; BIOS runs in the shadow bank and uses R5 for its own purposes, so a
; primitive that calls SWI must park >IN here and reload it afterwards.
saved_in:
    .word 0

; --- P2 threading state ---
state_var:
    .word 0              ; 0 = interpret, 1 = compile
dp_var:
    .word dict_free      ; next free dictionary cell (grows upwards)
ip_ptr:
    .word resume_list    ; indirect-threaded instruction pointer
rp_ptr:
    .word RSTACK_TOP     ; Forth return stack pointer (grows down)
xt_resume:
    .word outer_resume   ; code of the "back to outer interpreter" word
resume_list:
    .word xt_resume      ; synthetic one-cell thread for execute_xt
xt_lit:
    .word lit
xt_exit:
    .word exit
xt_branch:
    .word branch
xt_0branch:
    .word zbranch
current_xt:
    .word 0              ; xt of the definition being compiled (for recurse)
created_xt:
    .word 0              ; xt of the newest CREATE'd word (for DOES>)
dict_free:               ; colon definitions are built upwards from here

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
    NOP
    JN wp_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wp_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    ADD R1, R2
    ST R1, SP, 0
    LDI next
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
    NOP
    JN wm_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wm_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    MUL R1, R2
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
word_dup:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wd_under
    NOP
    LD R1, SP, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
wd_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP
; . prints the signed value, u. the raw cell. Both share print_number, which
; prints R2 as an unsigned magnitude followed by a trailing space; the leading
; space belongs to the caller.
word_dot:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ dot_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    MOV R2, R1          ; value
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LDI 0
    CMP R2, R0          ; signed test against zero
    JN dot_signed
    NOP
    LDI print_number
    MOV R3, R0          ; R3 carries the target so R2 keeps the value
    LINK
    JMP R3
    NOP
    LDI dot_next        ; JMP LR returns here, not into the signed path
    MOV PC, R0
    NOP
dot_signed:
    LDI '-'
    STS R0, ES, SCR
    ADD SCR, 1
    NEG R2              ; magnitude; -32768 negates to itself and prints as 32768
    LDI print_number
    MOV R3, R0
    LINK
    JMP R3
    NOP
dot_next:
    LDI next
    MOV PC, R0
    NOP
dot_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; u. displays the cell as it stands, without looking at bit 15.
word_udot:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ udot_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    MOV R2, R1
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LDI print_number
    MOV R3, R0
    LINK
    JMP R3
    NOP
    LDI next            ; return lands here, not into the error path
    MOV PC, R0
    NOP
udot_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; print_number prints R2 as an unsigned magnitude plus a trailing space and
; returns to the caller; it calls nothing, so a plain JMP LR is enough.
print_number:
    LDI 0
    CMP R2, R0
    JNZ pn_digits
    NOP
    LDI '0'
    STS R0, ES, SCR
    ADD SCR, 1
    LDI pn_done
    MOV PC, R0
    NOP
pn_digits:
    LDI print_buf
    MOV R10, R0         ; buffer pointer
    LDI 0
    MOV R3, R0          ; digit count
pn_div_loop:
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
    JNZ pn_div_loop
    NOP
pn_print_loop:
    LDI 0
    CMP R3, R0
    JZ pn_done
    NOP
    SUB R3, 1
    SUB R10, 1
    LD R7, R10, 0
    STS R7, ES, SCR
    ADD SCR, 1
    LDI pn_print_loop
    MOV PC, R0
    NOP
pn_done:
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    JMP LR
    NOP
word_emit:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ we_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    LDI 0x00FF
    AND R1, R0
    LDI 10
    CMP R1, R0
    JZ emit_do_cr
    NOP
    LDI 13
    CMP R1, R0
    JZ emit_do_lf
    NOP
    ; Park >IN (R5) across the BIOS call: the shadow-bank BIOS clobbers R5.
    LDI saved_in
    MOV R2, R0
    ST >IN, R2, 0
    LDI 2               ; value = 2
    MOV R3, R0
    LDI 0               ; offset = 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 1               ; offset = 1
    MOV R7, R0
    STS R1, DS, R7      ; DS:[1] = char (R1 still holds the masked char)
    SWI
    LD >IN, R2, 0       ; N.B.: R2 is shadowed, so it survives the SWI
    LDI next
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
    LDI next
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
    NOP
emit_lf_row_lt_local:
    ADD R10, 1           ; next row
emit_lf_row_done_local:
    MUL R10, R11         ; next_row*width
    ADD R9, R10          ; base + next_row*width
    ADD R9, R2           ; + same column
    MOV SCR, R9
    LDI next
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
    NOP
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
    NOP
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
    NOP
    JN ws_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
ws_ok:
    LD R1, SP, 0
    LD R2, SP, 1
    ST R1, SP, 1
    ST R2, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_drop:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wd2_under
    NOP
    ADD SP, 1
    LDI next
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
word_key:
    ; BIOS getch -> char in R0
    ; Park >IN (R5) across the BIOS call: the shadow-bank BIOS clobbers R5.
    LDI saved_in
    MOV R2, R0
    ST >IN, R2, 0
    LDI 4               ; value = 4
    MOV R4, R0
    LDI 0               ; offset = 0
    MOV R7, R0
    STS R4, DS, R7      ; DS:[0] = 4
    SWI
    LDI 1               ; offset = 1
    MOV R7, R0
    LDS R0, DS, R7      ; R0 = DS:[1]
    LD >IN, R2, 0       ; R2 is shadowed, so it survives the SWI
    SUB SP, 1
    ST R0, SP, 0
    LDI next
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
    NOP
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
    LDI next
    MOV PC, R0
    NOP

; =============================================
; P3: stack, arithmetic and comparison primitives
; =============================================
; Every primitive ends in NEXT so it can be compiled into a colon
; definition as well as run from the outer interpreter.
; ---------------------------------------------
word_minus:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wminus_ok
    NOP
    JN wminus_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wminus_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    SUB R1, R2
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_negate:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wnegate_under
    NOP
    LD R1, SP, 0
    NEG R1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
wnegate_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_div:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdiv_ok
    NOP
    JN wdiv_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdiv_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    DIV R1, R2
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_mod:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wmod_ok
    NOP
    JN wmod_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wmod_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    MOV R9, R1
    DIV R9, R2
    MUL R9, R2
    SUB R1, R9
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_slash_mod:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wslashmod_ok
    NOP
    JN wslashmod_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wslashmod_ok:
    LD R2, SP, 0          ; b
    ADD SP, 1
    LD R1, SP, 0          ; a
    MOV R9, R1
    DIV R9, R2            ; quotient
    MOV R7, R9
    MUL R7, R2
    SUB R1, R7            ; remainder = a - quotient*b
    ST R1, SP, 0          ; a's slot becomes the remainder
    SUB SP, 1
    ST R9, SP, 0          ; push the quotient on top
    LDI next
    MOV PC, R0
    NOP

; 2/ is an arithmetic right shift, so it floors as the Forth standard asks:
; -3 2/ is -2, not -1.
word_two_slash:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wtwoshift_under
    NOP
    LD R1, SP, 0
    SRA R1, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
wtwoshift_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_abs:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wabs_under
    NOP
    LD R1, SP, 0
    LDI 0
    CMP R1, R0             ; is n < 0 ?
    JN wabs_neg
    NOP
    LDI next               ; n >= 0 is already its own magnitude
    MOV PC, R0
    NOP
wabs_neg:
    NEG R1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
wabs_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; min and max keep one of the two operands: b is popped first, so the result
; slot is always a's slot.
word_min:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wmin_ok
    NOP
    JN wmin_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wmin_ok:
    LD R2, SP, 0          ; b
    ADD SP, 1
    LD R1, SP, 0          ; a
    CMP R2, R1
    JN wmin_take_b        ; b < a: the smaller one is b
    NOP
    LDI next              ; a <= b: a stays in its slot
    MOV PC, R0
    NOP
wmin_take_b:
    ST R2, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_max:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wmax_ok
    NOP
    JN wmax_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wmax_ok:
    LD R2, SP, 0          ; b
    ADD SP, 1
    LD R1, SP, 0          ; a
    CMP R2, R1
    JN wmax_next          ; b < a: the larger one is a, already in its slot
    NOP
    ST R2, SP, 0          ; b >= a
    LDI next
    MOV PC, R0
    NOP
wmax_next:
    LDI next
    MOV PC, R0
    NOP

word_over:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wover_ok
    NOP
    JN wover_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wover_ok:
    LD R1, SP, 1
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_rot:
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wrot_ok
    NOP
    JN wrot_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wrot_ok:
    LD R1, SP, 2          ; a
    LD R2, SP, 1          ; b
    LD R3, SP, 0          ; c
    ST R2, SP, 2          ; b (deepest)
    ST R3, SP, 1          ; c
    ST R1, SP, 0          ; a (top)
    LDI next
    MOV PC, R0
    NOP

word_nip:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wnip_ok
    NOP
    JN wnip_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wnip_ok:
    LD R1, SP, 0          ; b
    ADD SP, 1             ; drop a
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_2dup:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ w2dup_ok
    NOP
    JN w2dup_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2dup_ok:
    LD R1, SP, 1          ; a
    LD R2, SP, 0          ; b
    SUB SP, 1
    ST R1, SP, 0          ; push a first (deeper)
    SUB SP, 1
    ST R2, SP, 0          ; push b last (on top)
    LDI next
    MOV PC, R0
    NOP

word_2drop:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ w2drop_ok
    NOP
    JN w2drop_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2drop_ok:
    ADD SP, 2
    LDI next
    MOV PC, R0
    NOP

word_1plus:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w1plus_under
    NOP
    LD R1, SP, 0
    ADD R1, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
w1plus_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_1minus:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w1minus_under
    NOP
    LD R1, SP, 0
    SUB R1, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
w1minus_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_2star:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w2star_under
    NOP
    LD R1, SP, 0
    ADD R1, R1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
w2star_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_depth:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0          ; stack base
    MOV R3, SP
    SUB R1, R3            ; depth = base - SP
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

; Shared boolean results for the comparisons. True is the Forth
; convention -1 (0xFFFF); LDI cannot load 0xFFFF directly, so build it.
cmp_false:
    LDI 0
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP
cmp_true:
    LDI 1
    NEG R0
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_eq:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ weq_ok
    NOP
    JN weq_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
weq_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    CMP R1, R2
    JZ cmp_true
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP

word_ne:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wne_ok
    NOP
    JN wne_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wne_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    CMP R1, R2
    JNZ cmp_true
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP

word_lt:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wlt_ok
    NOP
    JN wlt_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wlt_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    CMP R1, R2
    JN cmp_true
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP

word_gt:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wgt_ok
    NOP
    JN wgt_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wgt_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    CMP R2, R1            ; b - a
    JZ cmp_false
    NOP
    JN cmp_true
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP

word_0eq:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w0eq_under
    NOP
    LDI 0
    MOV R2, R0
    LD R1, SP, 0
    CMP R1, R2
    JZ cmp_true
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP
w0eq_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_0lt:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w0lt_under
    NOP
    LDI 0
    MOV R2, R0
    LD R1, SP, 0
    CMP R1, R2
    JN cmp_true
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP
w0lt_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_0gt:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w0gt_under
    NOP
    LDI 0
    MOV R2, R0
    LD R1, SP, 0
    CMP R1, R2
    JZ cmp_false
    NOP
    JN cmp_false
    NOP
    LDI cmp_true
    MOV PC, R0
    NOP
w0gt_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; Unconditional branch: the thread holds an inline offset right after the
; xt. NEXT leaves IP on the offset cell, so target = IP + offset.
branch:
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0
    LD R1, R3, 0
    ADD R3, R1
    ST R3, R2, 0
    LDI next
    MOV PC, R0
    NOP

; Conditional branch: pop a flag, jump when it is zero, else skip the offset.
zbranch:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ zbranch_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    LDI 0
    CMP R1, R0
    JZ zbranch_take
    NOP
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0          ; not taken: skip the offset cell
    LDI next
    MOV PC, R0
    NOP
zbranch_take:
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0
    LD R1, R3, 0
    ADD R3, R1
    ST R3, R2, 0
    LDI next
    MOV PC, R0
    NOP
zbranch_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; ---------------------------------------------
; P3: memory words (word-addressed cells, DS segment)
; ---------------------------------------------
word_fetch:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wfetch_under
    NOP
    LD R1, SP, 0          ; addr
    LD R2, R1, 0
    ST R2, SP, 0
    LDI next
    MOV PC, R0
    NOP
wfetch_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_store:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wstore_ok
    NOP
    JN wstore_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wstore_ok:
    LD R2, SP, 0          ; addr
    ADD SP, 1
    LD R1, SP, 0          ; n
    ST R1, R2, 0
    LDI next
    MOV PC, R0
    NOP

word_cfetch:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wcfetch_under
    NOP
    LD R1, SP, 0          ; addr
    LD R2, R1, 0
    LDI 255
    MOV R3, R0
    AND R2, R3
    ST R2, SP, 0
    LDI next
    MOV PC, R0
    NOP
wcfetch_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_cstore:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wcstore_ok
    NOP
    JN wcstore_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wcstore_ok:
    LD R2, SP, 0          ; addr
    ADD SP, 1
    LD R1, SP, 0          ; char
    LDI 255
    MOV R3, R0
    AND R1, R3
    ST R1, R2, 0
    LDI next
    MOV PC, R0
    NOP

word_plusstore:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wplusstore_ok
    NOP
    JN wplusstore_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wplusstore_ok:
    LD R2, SP, 0          ; addr
    ADD SP, 1
    LD R1, SP, 0          ; n
    LD R3, R2, 0          ; old
    ADD R3, R1
    ST R3, R2, 0
    LDI next
    MOV PC, R0
    NOP

word_here:
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_allot:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wallot_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, R1
    ST R3, R2, 0
    LDI next
    MOV PC, R0
    NOP
wallot_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_comma:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wcomma_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    ST R1, R3, 0
    ADD R3, 1
    ST R3, R2, 0
    LDI next
    MOV PC, R0
    NOP
wcomma_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; A cell is one address unit on Deep16, so `cells` is the identity and
; `cell+` adds one unit.
word_cells:
    LDI next
    MOV PC, R0
    NOP

word_cellplus:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wcellplus_under
    NOP
    LD R1, SP, 0
    ADD R1, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
wcellplus_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; Runtime bodies for defining words. W (R10) is the xt at entry; the data
; cell for a VARIABLE or a CONSTANT lives directly after the CFA cell.
dovar:
    ADD R10, 1            ; data address
    SUB SP, 1
    ST R10, SP, 0
    LDI next
    MOV PC, R0
    NOP

doconst:
    LD R1, R10, 1         ; inline constant
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

; Runtime of a CREATE'd word. W (R10) is the xt; the cell at W+1 holds the
; DOES> thread that was attached (0 when there is none), and the data field
; begins at W+2. A plain created word behaves like a variable.
dodoes:
    LD R1, R10, 1         ; DOES> thread, if any
    ADD R10, 2            ; data field address
    SUB SP, 1
    ST R10, SP, 0         ; push it
    LDI 0
    CMP R1, R0
    JZ dodoes_plain
    NOP
    LDI rp_ptr
    MOV R2, R0
    LD R3, R2, 0
    SUB R3, 1
    LDI ip_ptr
    MOV R4, R0
    LD R7, R4, 0          ; caller's IP
    ST R7, R3, 0
    ST R3, R2, 0          ; RP--
    ST R1, R4, 0          ; IP = DOES> thread
    LDI next
    MOV PC, R0
    NOP
dodoes_plain:
    LDI next
    MOV PC, R0
    NOP

; Runtime of a VOCABULARY word: its body cell is the wordlist head. Executing
; it searches that wordlist first and keeps the built-ins reachable via FORTH.
dovoc:
    ADD R10, 1
    LDI search_order
    MOV R2, R0
    ST R10, R2, 0         ; order[0] = this vocabulary
    ADD R2, 1
    LDI forth_wl
    MOV R1, R0
    ST R1, R2, 0          ; order[1] = FORTH
    ADD R2, 1
    LDI 0
    ST R0, R2, 0
    LDI next
    MOV PC, R0
    NOP

; =============================================
; P2: Indirect-threaded code engine
; =============================================
; A word is addressed by its execution token (xt): the address of its CFA
; cell. The CFA cell of a primitive holds the address of the primitive's
; machine code; for a colon definition it holds `docol` and the threaded
; body (a list of xts) follows immediately after the CFA cell.
;
; The working register W (R10) holds the xt of the word whose code is about
; to run. It is reloaded by NEXT for every word, so primitives may use R10
; freely. IP and the return-stack pointer live in memory because the shadow
; bank BIOS clobbers R9-R12 and would otherwise corrupt the VM state.
.org 0x2000
.code

next:
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0          ; R3 = IP
    LD R10, R3, 0         ; W = [IP] = xt of the next word
    ADD R3, 1
    ST R3, R2, 0          ; IP++
    LD R4, R10, 0         ; code field = [W]
    MOV PC, R4
    NOP

docol:
    ; Enter a colon definition: W (R10) is its xt, body = W + 1.
    LDI rp_ptr
    MOV R2, R0
    LD R3, R2, 0          ; RP
    SUB R3, 1
    LDI ip_ptr
    MOV R4, R0
    LD R1, R4, 0          ; caller's IP
    ST R1, R3, 0          ; push IP on the return stack
    ST R3, R2, 0          ; RP--
    ADD R10, 1
    ST R10, R4, 0         ; IP = body
    LDI next
    MOV PC, R0
    NOP

exit:
    LDI rp_ptr
    MOV R2, R0
    LD R3, R2, 0
    LD R1, R3, 0          ; pop IP
    ADD R3, 1
    ST R3, R2, 0
    LDI ip_ptr
    MOV R4, R0
    ST R1, R4, 0          ; IP = return address
    LDI next
    MOV PC, R0
    NOP

lit:
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0
    LD R1, R3, 0          ; inline literal
    ADD R3, 1
    ST R3, R2, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

execute_xt:
    ; R1 = xt of a word to run from the outer interpreter. A synthetic
    ; one-cell thread makes the word return to outer_resume via NEXT/EXIT.
    LDI ip_ptr
    MOV R2, R0
    LDI resume_list
    MOV R3, R0
    ST R3, R2, 0          ; IP = resume_list
    MOV R10, R1           ; W = xt
    LD R4, R1, 0          ; code field
    MOV PC, R4
    NOP

outer_resume:
    LDI interpret_loop
    MOV PC, R0
    NOP

; ---------------------------------------------
; Compiler words
; ---------------------------------------------
word_colon:
    ; Skip blanks, then measure the name at >IN (R10 = start, R11 = length).
    LDI 0
    MOV R11, R0
colon_skip:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI ' '
    CMP R4, R0
    JNZ colon_name
    NOP
    ADD >IN, 1
    LDI colon_skip
    MOV PC, R0
    NOP
colon_name:
    MOV R10, R3
colon_len:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ colon_len_done
    NOP
    LDI ' '
    CMP R4, R0
    JZ colon_len_done
    NOP
    ADD R3, 1
    ADD R11, 1
    LDI colon_len
    MOV PC, R0
    NOP
colon_len_done:
    ADD >IN, R11          ; step past the name
    ; Build the header at DP: link | flags+len | name | NUL | CFA=docol
    LDI dp_var
    MOV R12, R0
    LD R9, R12, 0         ; R9 = header = old DP
    MOV R2, R9
    LDI current
    MOV R3, R0
    LD R3, R3, 0          ; address of the current wordlist head cell
    LD R4, R3, 0
    ST R4, R2, 0          ; link field
    ADD R2, 1
    ST R11, R2, 0         ; flags+len
    ADD R2, 1
    MOV R1, R10
colon_copy:
    LD R7, R1, 0
    ST R7, R2, 0
    ADD R1, 1
    ADD R2, 1
    SUB R11, 1
    LDI 0
    CMP R11, R0
    JNZ colon_copy
    NOP
    LDI 0
    ST R0, R2, 0          ; NUL terminator (FIND compares lengths first)
    ADD R2, 1
    LDI docol
    MOV R1, R0
    ST R1, R2, 0          ; CFA = docol
    LDI current_xt
    MOV R3, R0
    ST R2, R3, 0          ; remember this definition's xt for recurse
    ADD R2, 1
    ST R2, R12, 0         ; DP = end of CFA
    LDI current
    MOV R3, R0
    LD R3, R3, 0
    ST R9, R3, 0          ; current wordlist head = new header
    LDI state_var
    MOV R3, R0
    LDI 1
    MOV R4, R0
    ST R4, R3, 0          ; STATE = compiling
    LDI interpret_loop
    MOV PC, R0
    NOP

word_semicolon:
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    LDI xt_exit
    MOV R4, R0
    ST R4, R3, 0          ; compile EXIT
    ADD R3, 1
    ST R3, R2, 0
    LDI state_var
    MOV R2, R0
    LDI 0
    ST R0, R2, 0          ; STATE = interpret
    LDI interpret_loop
    MOV PC, R0
    NOP

word_immediate:
    LDI current
    MOV R2, R0
    LD R2, R2, 0          ; address of the current wordlist head cell
    LD R3, R2, 0          ; newest header in it
    LD R4, R3, 1
    LDI 1
    SL R0, 15                ; R0 = 0x8000
    OR R4, R0
    ST R4, R3, 1          ; set IMMEDIATE on the newest header
    LDI interpret_loop
    MOV PC, R0
    NOP

word_state:
    LDI state_var
    MOV R2, R0
    LD R1, R2, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_bracket_begin:
    LDI state_var
    MOV R2, R0
    LDI 0
    ST R0, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_bracket_end:
    LDI state_var
    MOV R2, R0
    LDI 1
    ST R0, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

; ---------------------------------------------
; P3: control-flow compiler words
; They are immediate and run while compiling. Compile-time branch targets
; are kept on the Forth return stack (rp), which is unused at compile time.
; ---------------------------------------------
word_if:
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    LDI xt_0branch
    MOV R4, R0
    ST R4, R3, 0          ; compile 0branch
    ADD R3, 1
    LDI 0
    ST R0, R3, 0          ; placeholder offset
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    SUB R7, 1
    ST R3, R7, 0          ; push the placeholder
    ST R7, R4, 0
    ADD R3, 1
    ST R3, R2, 0          ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_then:
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0          ; placeholder
    ADD R7, 1
    ST R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R2, R2, 0          ; here
    MOV R1, R2
    SUB R1, R3            ; offset = here - placeholder
    ST R1, R3, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_else:
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0          ; addr1 (the if's placeholder)
    ADD R7, 1
    ST R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0          ; DP
    LDI xt_branch
    MOV R9, R0
    ST R9, R1, 0          ; compile branch
    ADD R1, 1
    LDI 0
    ST R0, R1, 0          ; addr2 = placeholder
    MOV R9, R1
    ADD R9, 1             ; here
    SUB R9, R3            ; offset = here - addr1
    ST R9, R3, 0          ; patch the if
    LD R7, R4, 0
    SUB R7, 1
    ST R1, R7, 0          ; push addr2
    ST R7, R4, 0
    ADD R1, 1
    ST R1, R2, 0          ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_begin:
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0          ; here
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    SUB R7, 1
    ST R3, R7, 0          ; push the loop start
    ST R7, R4, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_until:
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0          ; dest
    ADD R7, 1
    ST R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0          ; DP
    LDI xt_0branch
    MOV R9, R0
    ST R9, R1, 0
    ADD R1, 1             ; ph
    MOV R9, R3
    SUB R9, R1            ; offset = dest - ph
    ST R9, R1, 0
    ADD R1, 1
    ST R1, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_again:
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0          ; dest
    ADD R7, 1
    ST R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0          ; DP
    LDI xt_branch
    MOV R9, R0
    ST R9, R1, 0
    ADD R1, 1             ; ph
    MOV R9, R3
    SUB R9, R1            ; offset = dest - ph
    ST R9, R1, 0
    ADD R1, 1
    ST R1, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_while:
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0          ; DP
    LDI xt_0branch
    MOV R9, R0
    ST R9, R1, 0
    ADD R1, 1             ; orig = placeholder
    LDI 0
    ST R0, R1, 0
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    SUB R7, 1
    ST R1, R7, 0          ; push orig on top of dest
    ST R7, R4, 0
    ADD R1, 1
    ST R1, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_repeat:
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0          ; orig
    ADD R7, 1
    LD R1, R7, 0          ; dest
    ADD R7, 1
    ST R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R7, R2, 0          ; DP
    LDI xt_branch
    MOV R10, R0
    ST R10, R7, 0
    ADD R7, 1             ; ph
    LDI 0
    ST R0, R7, 0
    MOV R10, R1
    SUB R10, R7           ; offset = dest - ph
    ST R10, R7, 0
    ADD R7, 1             ; here
    ST R7, R2, 0
    MOV R10, R7
    SUB R10, R3           ; offset = here - orig
    ST R10, R3, 0         ; patch the while
    LDI interpret_loop
    MOV PC, R0
    NOP

word_recurse:
    LDI current_xt
    MOV R4, R0
    LD R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    ST R7, R3, 0          ; compile the current definition's xt
    ADD R3, 1
    ST R3, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

; ---------------------------------------------
; P3: simple defining words (variable, constant)
; ---------------------------------------------
; define_name parses the next token, builds a header at DP (link | flags+len |
; name | NUL), links it in and leaves the CFA cell for the caller to fill.
; Returns R9 = header, R2 = CFA cell address, R12 = dp_var.
; It is called with LINK; an empty name returns to the interpreter.
define_name:
    LDI 0
    MOV R11, R0
dname_skip:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI ' '
    CMP R4, R0
    JNZ dname_start
    NOP
    ADD >IN, 1
    LDI dname_skip
    MOV PC, R0
    NOP
dname_start:
    MOV R10, R3
dname_len:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ dname_done
    NOP
    LDI ' '
    CMP R4, R0
    JZ dname_done
    NOP
    ADD R3, 1
    ADD R11, 1
    LDI dname_len
    MOV PC, R0
    NOP
dname_done:
    ADD >IN, R11
    LDI 0
    CMP R11, R0
    JNZ dname_build
    NOP
    LDI interpret_loop     ; no name: nothing to define
    MOV PC, R0
    NOP
dname_build:
    LDI dp_var
    MOV R12, R0
    LD R9, R12, 0         ; header = old DP
    MOV R2, R9
    LDI current
    MOV R3, R0
    LD R3, R3, 0          ; address of the current wordlist head cell
    LD R4, R3, 0
    ST R4, R2, 0          ; link
    ADD R2, 1
    ST R11, R2, 0         ; flags+len
    ADD R2, 1
    MOV R1, R10
dname_copy:
    LD R7, R1, 0
    ST R7, R2, 0
    ADD R1, 1
    ADD R2, 1
    SUB R11, 1
    LDI 0
    CMP R11, R0
    JNZ dname_copy
    NOP
    LDI 0
    ST R0, R2, 0          ; NUL terminator
    ADD R2, 1             ; R2 = CFA cell address
    LDI current
    MOV R3, R0
    LD R3, R3, 0
    ST R9, R3, 0          ; current wordlist head = new header
    JMP LR
    NOP

; create builds a header whose runtime is dodoes. One cell is reserved after
; the CFA for the DOES> thread pointer, so the data field starts at CFA+2.
; It is a threaded primitive: defining words compile it, so it must return
; via NEXT instead of jumping back to the interpreter.
word_create:
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI created_xt
    MOV R4, R0
    ST R2, R4, 0          ; remember the newest created word
    LDI dodoes
    MOV R1, R0
    ST R1, R2, 0          ; CFA = dodoes
    ADD R2, 1
    LDI 0
    ST R0, R2, 0          ; DOES> pointer = 0 (not attached yet)
    ADD R2, 1
    ST R2, R12, 0         ; DP = data field
    LDI next
    MOV PC, R0
    NOP

; does> attaches the thread that follows it to the most recently created word
; and then leaves the defining word, so that thread runs only when the created
; word itself is executed.
word_does:
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0          ; R3 = IP = start of the DOES> thread
    LDI created_xt
    MOV R4, R0
    LD R1, R4, 0
    ADD R1, 1             ; the word's DOES> pointer cell
    ST R3, R1, 0
    LDI rp_ptr
    MOV R2, R0
    LD R3, R2, 0
    LD R1, R3, 0          ; pop the defining word's return address
    ADD R3, 1
    ST R3, R2, 0
    LDI ip_ptr
    MOV R4, R0
    ST R1, R4, 0          ; IP = caller of the defining word
    LDI next
    MOV PC, R0
    NOP

word_variable:
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI dovar
    MOV R1, R0
    ST R1, R2, 0          ; CFA = dovar
    ADD R2, 1             ; data cell
    LDI 0
    ST R0, R2, 0          ; initial value
    SUB SP, 1
    ST R2, SP, 0          ; leave the variable's address
    ADD R2, 1
    ST R2, R12, 0         ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_constant:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JNZ wconst_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wconst_ok:
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LD R7, SP, 0          ; value to freeze
    ADD SP, 1
    LDI doconst
    MOV R1, R0
    ST R1, R2, 0          ; CFA = doconst
    ADD R2, 1
    ST R7, R2, 0          ; constant value
    ADD R2, 1
    ST R2, R12, 0         ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_value:
    ; Like constant, but the cell may be rewritten with `to`.
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JNZ wvalue_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wvalue_ok:
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LD R7, SP, 0          ; initial value
    ADD SP, 1
    LDI doconst
    MOV R1, R0
    ST R1, R2, 0          ; CFA = doconst
    ADD R2, 1
    ST R7, R2, 0          ; value cell
    ADD R2, 1
    ST R2, R12, 0         ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_to:
    ; `to name` stores the top of stack into name's value cell. Immediate so
    ; it runs while compiling; it then emits code to store at run time.
    LDI find_token
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R1, R0
    JZ to_unknown
    NOP
    ADD R1, 1             ; value cell address
    LDI state_var
    MOV R2, R0
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JZ to_store_now
    NOP
    ; compiling: emit LIT <cell> and the xt of `!`
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    LDI xt_lit
    MOV R4, R0
    ST R4, R3, 0
    ADD R3, 1
    ST R1, R3, 0          ; the value cell address
    ADD R3, 1
    LDI h_store_cfa
    MOV R4, R0
    ST R4, R3, 0          ; xt of `!`
    ADD R3, 1
    ST R3, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
to_store_now:
    LDI sp0_base
    MOV R2, R0
    LD R3, R2, 0
    CMP SP, R3
    JNZ to_have
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
to_have:
    LD R4, SP, 0
    ADD SP, 1
    ST R4, R1, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
to_unknown:
    LDI skip_unknown
    MOV PC, R0
    NOP

; find_token parses the next blank-delimited token and searches the header
; chain. Returns R1 = xt (CFA cell address) and steps >IN past the token on a
; match, or R1 = 0 and >IN at the token start otherwise. Called with LINK.
find_token:
    LDI 0
    MOV R11, R0
ft_skip:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ ft_none
    NOP
    LDI ' '
    CMP R4, R0
    JNZ ft_len
    NOP
    ADD >IN, 1
    LDI ft_skip
    MOV PC, R0
    NOP
ft_len:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ ft_have
    NOP
    LDI ' '
    CMP R4, R0
    JZ ft_have
    NOP
    ADD R3, 1
    ADD R11, 1
    LDI ft_len
    MOV PC, R0
    NOP
ft_have:
    LDI 0
    MOV R12, R0
ft_wl:
    LDI search_order
    MOV R2, R0
    ADD R2, R12
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JZ ft_none
    NOP
    LDI found_wl
    MOV R3, R0
    ST R2, R3, 0          ; remember which wordlist is being searched
    LD R7, R2, 0
ft_loop:
    LDI 0
    CMP R7, R0
    JZ ft_next_wl
    NOP
    LD R2, R7, 1
    LDI 0x00FF
    AND R2, R0
    CMP R2, R11
    JNZ ft_next
    NOP
    MOV R10, R7
    ADD R10, 2
    MOV R3, TIB
    ADD R3, >IN
    MOV R9, R11
ft_cmp:
    LD R2, R3, 0
    LD R4, R10, 0
    CMP R2, R4
    JNZ ft_next
    NOP
    ADD R3, 1
    ADD R10, 1
    SUB R9, 1
    LDI 0
    CMP R9, R0
    JNZ ft_cmp
    NOP
    MOV R1, R7
    ADD R1, 3
    ADD R1, R11           ; R1 = CFA cell address
    ADD >IN, R11
    JMP LR
    NOP
ft_next:
    LD R7, R7, 0
    LDI ft_loop
    MOV PC, R0
    NOP
ft_next_wl:
    ADD R12, 1
    LDI ft_wl
    MOV PC, R0
    NOP
ft_none:
    LDI 0
    MOV R1, R0
    JMP LR
    NOP

; ---------------------------------------------
; P4: vocabularies and the search order
; ---------------------------------------------
; search_order holds wordlist head-cell addresses, first searched first, and
; is 0-terminated. A definition goes into the wordlist in `current`.
word_vocabulary:
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI dovoc
    MOV R1, R0
    ST R1, R2, 0          ; CFA = dovoc
    ADD R2, 1
    LDI 0
    ST R0, R2, 0          ; the new wordlist starts empty
    ADD R2, 1
    ST R2, R12, 0         ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_definitions:
    LDI search_order
    MOV R2, R0
    LD R1, R2, 0          ; first wordlist in the order
    LDI current
    MOV R2, R0
    ST R1, R2, 0          ; new definitions go there
    LDI next
    MOV PC, R0
    NOP

word_also:
    LDI search_order
    MOV R2, R0
    LDI 0
    MOV R9, R0
also_count:
    MOV R4, R2
    ADD R4, R9
    LD R4, R4, 0
    LDI 0
    CMP R4, R0
    JZ also_have
    NOP
    ADD R9, 1
    LDI also_count
    MOV PC, R0
    NOP
also_have:
    LDI 8
    MOV R4, R0
    CMP R9, R4
    JN also_go
    NOP
    LDI next              ; order full: ignore
    MOV PC, R0
    NOP
also_go:
    MOV R1, R9            ; duplicate order[0] by shifting 1..N up
also_shift:
    LDI 0
    CMP R1, R0
    JZ also_done
    NOP
    MOV R4, R2
    ADD R4, R1
    MOV R3, R2
    ADD R3, R1
    SUB R3, 1
    LD R7, R3, 0
    ST R7, R4, 0
    SUB R1, 1
    LDI also_shift
    MOV PC, R0
    NOP
also_done:
    LDI next
    MOV PC, R0
    NOP

word_previous:
    LDI search_order
    MOV R2, R0
    MOV R3, R2
    ADD R3, 1
    LD R7, R3, 0
    LDI 0
    CMP R7, R0
    JNZ prev_go
    NOP
    LDI next              ; only one wordlist: keep it
    MOV PC, R0
    NOP
prev_go:
    LDI 0
    MOV R9, R0
prev_loop:
    MOV R4, R2
    ADD R4, R9
    MOV R3, R4
    ADD R3, 1
    LD R7, R3, 0
    ST R7, R4, 0
    LDI 0
    CMP R7, R0
    JZ prev_done
    NOP
    ADD R9, 1
    LDI prev_loop
    MOV PC, R0
    NOP
prev_done:
    LDI next
    MOV PC, R0
    NOP

word_only:
    LDI forth_wl
    MOV R1, R0
    LDI search_order
    MOV R2, R0
    ST R1, R2, 0
    ADD R2, 1
    LDI 0
    ST R0, R2, 0
    LDI next
    MOV PC, R0
    NOP

word_forth:
    LDI forth_wl
    MOV R1, R0
    LDI search_order
    MOV R2, R0
    ST R1, R2, 0          ; FORTH becomes the first searched wordlist
    LDI next
    MOV PC, R0
    NOP

; words lists the names in the first wordlist of the search order. It clears
; the screen first, so a full listing always fits; the direct ES writes never
; call BIOS, so >IN is untouched.
word_words:
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x1000
    MOV SCR, R0
    LDI 2000
    MOV R2, R0
    LDI ' '
    MOV R1, R0
wwords_clear:
    STS R1, ES, SCR
    ADD SCR, 1
    SUB R2, 1
    LDI 0
    CMP R2, R0
    JNZ wwords_clear
    NOP
    LDI 0x1000
    MOV SCR, R0
    LDI search_order
    MOV R2, R0
    LD R2, R2, 0          ; first wordlist head cell
    LDI 0
    CMP R2, R0
    JZ wwords_ret
    NOP
    LD R3, R2, 0          ; newest header
wwords_hdr:
    LDI 0
    CMP R3, R0
    JZ wwords_ret
    NOP
    LD R2, R3, 1
    LDI 0x00FF
    AND R2, R0            ; name length
    MOV R1, R3
    ADD R1, 2             ; name pointer
wwords_char:
    LDI 0
    CMP R2, R0
    JZ wwords_space
    NOP
    LD R0, R1, 0
    STS R0, ES, SCR
    ADD SCR, 1
    ADD R1, 1
    SUB R2, 1
    LDI wwords_char
    MOV PC, R0
    NOP
wwords_space:
    LDI ' '
    STS R0, ES, SCR
    ADD SCR, 1
    LD R3, R3, 0          ; follow the link field
    LDI wwords_hdr
    MOV PC, R0
    NOP
wwords_ret:
    LDI next
    MOV PC, R0
    NOP

; forget name drops `name` and everything defined after it, reclaims the
; dictionary space and returns to the FORTH vocabulary.
word_forget:
    LDI find_token
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R1, R0
    JZ forget_unknown
    NOP
    LDI found_wl
    MOV R2, R0
    LD R2, R2, 0          ; containing wordlist head cell
    LD R3, R7, 0          ; R7 = header, R3 = its link
    ST R3, R2, 0          ; drop the header and everything newer
    LDI dp_var
    MOV R2, R0
    ST R7, R2, 0          ; HERE = forgotten header
    LDI forth_wl
    MOV R1, R0
    LDI search_order
    MOV R2, R0
    ST R1, R2, 0
    ADD R2, 1
    LDI 0
    ST R0, R2, 0
    LDI current
    MOV R2, R0
    ST R1, R2, 0
    LDI next
    MOV PC, R0
    NOP
forget_unknown:
    LDI skip_unknown
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
    NOP
    ; 0: bver -> R0 = 0x0001 (version 0.1)
    LDI 0x0001
    RETI
    NOP
bios_f1:
    LDI 1
    CMP R1, R0
    JNZ bios_f2
    NOP
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
    NOP
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
    NOP
    LDI 13
    CMP R2, R0
    JZ bios_putch_cr
    NOP
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
    NOP
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
    NOP
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
    NOP
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
    NOP
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
    NOP
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
    NOP
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
    NOP
    LDI KBD_DATA
    MOV R4, R0
    LDS R1, ES, R4
    LDI 0x00FF
    AND R1, R0
    LDI 10
    CMP R1, R0
    JZ bios_getstr_done
    NOP
    LDI 13
    CMP R1, R0
    JZ bios_getstr_done
    NOP
    ; backspace
    LDI 8
    CMP R1, R0
    JNZ bios_store_char
    NOP
    LDI 0
    CMP R11, R0
    JZ bios_getstr_loop
    NOP
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
