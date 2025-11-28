; =============================================
; Enhanced Deep16 Forth Kernel - PRODUCTION VERSION
; =============================================

.org 0x0100
.code

.equ SP R13
.equ POS R7
.equ SCR R8
.equ MASK R4
.equ TIB R6           ; Text Input Buffer pointer
.equ >IN R5           ; Input pointer offset
.equ CHAR_BUF R9      ; Character buffer pointer
.equ RETURN_ADDR R11  ; For proper subroutine returns

; =============================================
; Forth Kernel Implementation
; =============================================

forth_start:
    ; Initialize stack pointers
    LDI 0x7FF0
    MOV SP, R0
    
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

    ; Initialize text input system
    LDI 0
    MOV >IN, R0

    ; Convert packed input to character-per-word buffer
    LDI convert_input_to_chars
    MOV R1, R0
    MOV PC, R1
    NOP

after_conversion:
    ; Jump to text interpreter
    LDI text_interpreter
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Input Conversion - Packed to Character-per-word
; =============================================

convert_input_to_chars:
    ; Set up source and destination pointers
    LDI user_input    ; Source: packed input
    MOV TIB, R0
    LDI char_buffer   ; Destination: character buffer
    MOV CHAR_BUF, R0
    LDI 0
    MOV >IN, R0
    
convert_loop:
    ; Read packed word from source
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 0
    SUB R2, R0
    JZ convert_done
    
    ; Extract high byte
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    MOV R1, CHAR_BUF
    ST R3, R1, 0
    ADD CHAR_BUF, 1
    
    ; Extract low byte  
    MOV R3, R2
    AND R3, MASK
    MOV R1, CHAR_BUF
    ST R3, R1, 0
    ADD CHAR_BUF, 1
    
    ; Advance to next packed word
    ADD >IN, 1
    LDI convert_loop
    MOV R1, R0
    MOV PC, R1
    NOP

convert_done:
    ; Add null terminator
    LDI 0
    MOV R1, CHAR_BUF
    ST R0, R1, 0
    
    ; Reset TIB to character buffer
    LDI char_buffer
    MOV TIB, R0
    LDI 0
    MOV >IN, R0
    
    LDI after_conversion
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Text Interpreter Core - ROBUST VERSION
; =============================================

text_interpreter:
interpret_loop:
    ; Skip leading whitespace
    LDI skip_whitespace
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_whitespace:
    ; Check end of input
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 0
    SUB R2, R0
    JZ interpret_done

    ; Also check maximum input length
    MOV R3, >IN
    LDI 40
    SUB R3, R0
    JC interpret_done

    ; Parse word or number
    LDI parse_word
    MOV R1, R0
    MOV PC, R1
    NOP
    
interpret_loop_return:
    LDI interpret_loop
    MOV R1, R0
    MOV PC, R1
    NOP

interpret_done:
    HLT

; =============================================
; Whitespace Skipping - ROBUST
; =============================================

skip_whitespace:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 0
    SUB R2, R0
    JZ skip_done
    LDI 32
    SUB R2, R0
    JNZ skip_done
    ADD >IN, 1
    LDI skip_whitespace
    MOV R1, R0
    MOV PC, R1
    NOP
    
skip_done:
    LDI after_whitespace
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Word Parsing - ROBUST with proper number conversion
; =============================================

parse_word:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    
    ; Check for ." string
    LDI 46             ; '.'
    SUB R2, R0
    JNZ check_number
    MOV R1, TIB
    ADD R1, >IN
    ADD R1, 1
    LD R3, R1, 0
    LDI 34             ; '"'
    SUB R3, R0
    JNZ check_number
    LDI handle_dot_quote
    MOV R1, R0
    MOV PC, R1
    NOP

check_number:
    ; Robust number parsing
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    
    ; Check if character is between '0' and '9'
    MOV R3, R2
    LDI 48             ; '0'
    SUB R3, R0
    JN not_a_number    ; Below '0'
    
    MOV R3, R2
    LDI 57             ; '9'  
    SUB R0, R3
    JN not_a_number    ; Above '9'
    
    ; Valid digit - parse multi-digit number
    LDI parse_number
    MOV R1, R0
    MOV PC, R1
    NOP

not_a_number:
    LDI interpret_word
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Number Parsing - Multi-digit support
; =============================================

parse_number:
    LDI 0
    MOV R9, R0        ; Accumulator
    LDI 10
    MOV R10, R0       ; Base
    
parse_digit_loop:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 0
    SUB R2, R0
    JZ number_complete
    
    ; Check if still a digit
    MOV R3, R2
    LDI 48
    SUB R3, R0
    JN number_complete
    MOV R3, R2
    LDI 57
    SUB R0, R3
    JN number_complete
    
    ; Valid digit - add to accumulator
    MOV R3, R2
    LDI 48
    SUB R3, R0        ; Convert to 0-9
    MUL R9, R10       ; accumulator * 10
    ADD R9, R3        ; + digit
    ADD >IN, 1
    LDI parse_digit_loop
    MOV R1, R0
    MOV PC, R1
    NOP

number_complete:
    ; Push accumulated number
    SUB SP, 1
    ST R9, SP, 0
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Word Interpretation - Complete instruction set
; =============================================

interpret_word:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    
    ; Check single character operators
    LDI 43             ; '+'
    SUB R2, R0
    JNZ check_subtract
    ADD >IN, 1
    LDI exec_add
    MOV R1, R0
    MOV PC, R1
    NOP

check_subtract:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 45             ; '-'
    SUB R2, R0
    JNZ check_multiply
    ADD >IN, 1
    LDI exec_sub
    MOV R1, R0
    MOV PC, R1
    NOP

check_multiply:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 42             ; '*'
    SUB R2, R0
    JNZ check_divide
    ADD >IN, 1
    LDI exec_mul
    MOV R1, R0
    MOV PC, R1
    NOP

check_divide:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 47             ; '/'
    SUB R2, R0
    JNZ check_dot
    ADD >IN, 1
    LDI exec_div
    MOV R1, R0
    MOV PC, R1
    NOP

check_dot:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 46             ; '.'
    SUB R2, R0
    JNZ check_dup
    ADD >IN, 1
    LDI exec_dot
    MOV R1, R0
    MOV PC, R1
    NOP

check_dup:
    ; Check for "dup"
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 100           ; 'd'
    SUB R2, R0
    JNZ check_swap
    MOV R1, TIB
    ADD R1, >IN
    ADD R1, 1
    LD R2, R1, 0
    LDI 117           ; 'u'
    SUB R2, R0
    JNZ check_swap
    MOV R1, TIB
    ADD R1, >IN
    ADD R1, 2
    LD R2, R1, 0
    LDI 112           ; 'p'
    SUB R2, R0
    JNZ check_swap
    ADD >IN, 3
    LDI exec_dup
    MOV R1, R0
    MOV PC, R1
    NOP

check_swap:
    ; Check for "swap"
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 115           ; 's'
    SUB R2, R0
    JNZ check_drop
    MOV R1, TIB
    ADD R1, >IN
    ADD R1, 1
    LD R2, R1, 0
    LDI 119           ; 'w'
    SUB R2, R0
    JNZ check_drop
    MOV R1, TIB
    ADD R1, >IN
    ADD R1, 2
    LD R2, R1, 0
    LDI 97            ; 'a'
    SUB R2, R0
    JNZ check_drop
    MOV R1, TIB
    ADD R1, >IN
    ADD R1, 3
    LD R2, R1, 0
    LDI 112           ; 'p'
    SUB R2, R0
    JNZ check_drop
    ADD >IN, 4
    LDI exec_swap
    MOV R1, R0
    MOV PC, R1
    NOP

check_drop:
    ; Check for "drop"
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 100           ; 'd'
    SUB R2, R0
    JNZ unknown_word
    MOV R1, TIB
    ADD R1, >IN
    ADD R1, 1
    LD R2, R1, 0
    LDI 114           ; 'r'
    SUB R2, R0
    JNZ unknown_word
    MOV R1, TIB
    ADD R1, >IN
    ADD R1, 2
    LD R2, R1, 0
    LDI 111           ; 'o'
    SUB R2, R0
    JNZ unknown_word
    MOV R1, TIB
    ADD R1, >IN
    ADD R1, 3
    LD R2, R1, 0
    LDI 112           ; 'p'
    SUB R2, R0
    JNZ unknown_word
    ADD >IN, 4
    LDI exec_drop
    MOV R1, R0
    MOV PC, R1
    NOP

unknown_word:
    ADD >IN, 1
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Dot-Quote String Handling
; =============================================

handle_dot_quote:
    ADD >IN, 2         ; Skip ."
    
dot_quote_loop:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 0
    SUB R2, R0
    JZ dot_quote_done
    LDI 34             ; '"'
    SUB R2, R0
    JZ dot_quote_done
    STS R2, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    ADD >IN, 1
    LDI dot_quote_loop
    MOV R1, R0
    MOV PC, R1
    NOP

dot_quote_done:
    ADD >IN, 1
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Execution Primitives - Complete set
; =============================================

exec_dup:
    LD R1, SP, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

exec_swap:
    LD R1, SP, 0
    LD R2, SP, 1
    ST R1, SP, 1
    ST R2, SP, 0
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

exec_drop:
    ADD SP, 1
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

exec_add:
    LD R2, SP, 0
    LD R1, SP, 1
    ADD R1, R2
    ADD SP, 1
    ST R1, SP, 0
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

exec_sub:
    LD R2, SP, 0
    LD R1, SP, 1
    SUB R1, R2
    ADD SP, 1
    ST R1, SP, 0
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

exec_mul:
    LD R2, SP, 0
    LD R1, SP, 1
    MUL R1, R2
    ADD SP, 1
    ST R1, SP, 0
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

exec_div:
    LD R2, SP, 0
    LD R1, SP, 1
    DIV R1, R2
    ADD SP, 1
    ST R1, SP, 0
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

exec_dot:
    LD R1, SP, 0
    ADD SP, 1
    LDI 0
    MOV R5, R0
    LDI 10
    MOV R6, R0
    
exec_dot_convert:
    DIV R1, R6
    MOV R3, R2
    LDI 48
    ADD R3, R0
    SUB SP, 1
    ST R3, SP, 0
    ADD R5, 1
    ADD R1, 0
    JZ exec_dot_print
    LDI exec_dot_convert
    MOV R1, R0
    MOV PC, R1
    NOP

exec_dot_print:
    ADD R5, 0
    JZ exec_dot_done
    LD R1, SP, 0
    ADD SP, 1
    STS R1, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    SUB R5, 1
    LDI exec_dot_print
    MOV R1, R0
    MOV PC, R1
    NOP

exec_dot_done:
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Data Section
; =============================================

user_input:
    ; Test: ." Hello " 123 456 + dup * . 
    .word 0x2E22       ; '.', '"'
    .word 0x4865       ; 'H', 'e'
    .word 0x6C6C       ; 'l', 'l'
    .word 0x6F20       ; 'o', ' '
    .word 0x2022       ; ' ', '"'
    .word 0x2031       ; ' ', '1'
    .word 0x3233       ; '2', '3'
    .word 0x2034       ; ' ', '4'
    .word 0x3536       ; '5', '6'
    .word 0x202B       ; ' ', '+'
    .word 0x2064       ; ' ', 'd'
    .word 0x7570       ; 'u', 'p'
    .word 0x202A       ; ' ', '*'
    .word 0x202E       ; ' ', '.'
    .word 0x0000       ; Null terminator

char_buffer:
    .word 0,0,0,0,0,0,0,0,0,0
    .word 0,0,0,0,0,0,0,0,0,0
    .word 0,0,0,0,0,0,0,0,0,0
    .word 0,0,0,0,0,0,0,0,0,0

kernel_end:
    HLT
