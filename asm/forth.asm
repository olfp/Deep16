; =============================================
; Enhanced Deep16 Forth Kernel with Text Interpreter
; =============================================

.org 0x0100
.code

.equ SP R13
.equ POS R7
.equ SCR R8
.equ MASK R4
.equ TIB R6           ; Text Input Buffer pointer
.equ >IN R5           ; Input pointer offset
.equ RETURN_ADDR R11   ; For subroutine returns

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
    MOV >IN, R0        ; Input offset starts at 0

    ; Jump to text interpreter directly
    LDI text_interpreter
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Screen Output Utilities
; =============================================

; Print character with return address in R11
print_char:
    STS R0, ES, SCR    ; Print the character in R0
    ADD SCR, 1
    ADD POS, 1
    
    ; Return to caller
    MOV PC, R11
    NOP

; Print debug character with return address in R11  
debug_char:
    STS R0, ES, SCR    ; Print the character in R0
    ADD SCR, 1
    ADD POS, 1
    ; Return to caller
    MOV PC, R11
    NOP

; =============================================
; Text Interpreter Core
; =============================================

text_interpreter:
    ; Set up TIB (Text Input Buffer) for user input
    LDI user_input
    MOV TIB, R0
    LDI 0
    MOV >IN, R0        ; Reset input offset
    
interpret_loop:
    ; Skip leading whitespace
    LDI skip_whitespace_careful
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_whitespace:
    ; Check if we're at end of input
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0       ; Get current word
    ADD R2, 0
    JZ interpret_done  ; End of input (null terminator)
    NOP
    
    ; Also check for maximum input length to prevent infinite loop
    MOV R3, >IN
    LDI 10             ; Reasonable maximum input length
    SUB R3, R0
    JC interpret_done  ; If >IN >= 10, we've gone too far
    NOP
    
    ; DEBUG: Show current position
    LDI 62            ; '>'
    MOV R0, R0
    LDI after_debug_char
    MOV R11, R0       ; Set return address
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_debug_char:
    ; Parse word or number
    LDI parse_word_fixed
    MOV R1, R0
    MOV PC, R1
    NOP
    
interpret_loop_return:
    LDI interpret_loop
    MOV R1, R0
    MOV PC, R1
    NOP

interpret_done:
    ; Show completion message
    LDI 10            ; Newline
    MOV R0, R0
    LDI after_newline
    MOV R11, R0
    LDI print_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_newline:
    LDI 68            ; 'D'
    MOV R0, R0
    LDI after_d
    MOV R11, R0
    LDI print_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_d:
    LDI 79            ; 'O'
    MOV R0, R0
    LDI after_o
    MOV R11, R0
    LDI print_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_o:
    LDI 78            ; 'N'
    MOV R0, R0
    LDI after_n
    MOV R11, R0
    LDI print_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_n:
    LDI 69            ; 'E'
    MOV R0, R0
    LDI after_e
    MOV R11, R0
    LDI print_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_e:
    ; Halt when done interpreting
    HLT

skip_whitespace_careful:
    ; Only skip PURE whitespace words (both bytes are space)
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0       ; Get current word
    ADD R2, 0
    JZ skip_done_careful  ; End of input
    NOP
    
    ; Check if BOTH bytes are whitespace
    MOV R3, R2
    SRA R3, 8          ; High byte
    AND R3, MASK
    LDI 32             ; Space
    SUB R3, R0
    JNZ skip_done_careful  ; High byte not space
    NOP
    
    MOV R3, R2
    AND R3, MASK       ; Low byte
    LDI 32             ; Space
    SUB R3, R0
    JNZ skip_done_careful  ; Low byte not space
    NOP
    
    ; Both bytes are space, advance past this word
    ADD >IN, 1
    LDI skip_whitespace_careful
    MOV R1, R0
    MOV PC, R1
    NOP
    
skip_done_careful:
    LDI after_whitespace
    MOV R1, R0
    MOV PC, R1
    NOP

parse_word_fixed:
    ; Here we'll parse the next word from input
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0       ; Get current word
    
    ; Check for ." (dot-quote) string
    MOV R3, R2
    SRA R3, 8          ; High byte
    AND R3, MASK
    LDI 46             ; '.'
    SUB R3, R0
    JNZ check_number_fixed
    NOP
    
    MOV R3, R2
    AND R3, MASK       ; Low byte
    LDI 34             ; '"'
    SUB R3, R0
    JNZ check_number_fixed
    NOP
    
    ; Found ." - handle string
    LDI handle_dot_quote
    MOV R1, R0
    MOV PC, R1
    NOP

check_number_fixed:
    ; Try to parse a number
    LDI 78            ; 'N' - show we're trying number
    MOV R0, R0
    LDI after_n_debug
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_n_debug:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    
    ; For our test input "1 2 + .", the digits are in the LOW byte
    ; Let's DEBUG what we're actually reading
    MOV R3, R2
    AND R3, MASK       ; Get low byte
    MOV R0, R3         ; Move to R0 for printing
    LDI after_char_debug
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_char_debug:
    ; Check if low byte is digit '0'-'9'
    MOV R3, R2
    AND R3, MASK       ; Get low byte
    
    ; First check if >= '0'
    LDI 48             ; '0'
    SUB R3, R0         ; R3 = char - '0'
    JN not_a_number_fixed  ; Below '0' (negative result)
    NOP
    
    ; Now check if <= '9' 
    MOV R3, R2         ; Reload original character
    AND R3, MASK
    LDI 57             ; '9'
    SUB R0, R3         ; R0 = '9' - char
    JN not_a_number_fixed  ; Above '9' (negative result means char > '9')
    NOP
    
    ; Valid digit found! Convert to number
    MOV R3, R2
    AND R3, MASK       ; Get low byte
    LDI 48             ; '0'
    SUB R3, R0         ; R3 now contains 0-9
    
    LDI 68            ; 'D' - show digit found
    MOV R0, R0
    LDI after_d_debug
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_d_debug:
    ; Push the digit value
    SUB SP, 1
    ST R3, SP, 0
    
    LDI 80            ; 'P' - show pushed
    MOV R0, R0
    LDI after_p_debug
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_p_debug:
    ; Advance input
    ADD >IN, 1
    
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

not_a_number_fixed:
    ; DEBUG: Show it's not a number
    LDI 88            ; 'X'
    MOV R0, R0
    LDI after_x_debug
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_x_debug:
    ; Not a number, try to interpret as word
    LDI interpret_word_fixed
    MOV R1, R0
    MOV PC, R1
    NOP

interpret_word_fixed:
    ; Interpret a word from input
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    
    ; DEBUG: Show we're interpreting a word
    LDI 87            ; 'W'
    MOV R0, R0
    LDI after_w_debug
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_w_debug:
    ; Let's DEBUG what character we're checking
    MOV R3, R2
    AND R3, MASK       ; Get low byte
    MOV R0, R3         ; Move to R0 for printing
    LDI after_char2_debug
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_char2_debug:
    ; For our test input, operators are in LOW byte
    ; Check low byte for operators
    MOV R3, R2
    AND R3, MASK       ; Get low byte
    
    LDI 43             ; '+'
    SUB R3, R0
    JNZ check_multiply_fixed
    NOP
    ; Found "+"
    LDI 43            ; DEBUG: Show we found '+'
    MOV R0, R0
    LDI after_plus_debug
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_plus_debug:
    ADD >IN, 1
    LDI exec_add
    MOV R1, R0
    MOV PC, R1
    NOP

check_multiply_fixed:
    MOV R3, R2
    AND R3, MASK
    LDI 42             ; '*'
    SUB R3, R0
    JNZ check_dot_fixed
    NOP
    ; Found "*"
    LDI 42            ; DEBUG: Show we found '*'
    MOV R0, R0
    LDI after_star_debug
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_star_debug:
    ADD >IN, 1
    LDI exec_mul
    MOV R1, R0
    MOV PC, R1
    NOP

check_dot_fixed:
    MOV R3, R2
    AND R3, MASK
    LDI 46             ; '.'
    SUB R3, R0
    JNZ check_dup_fixed
    NOP
    ; Found "."
    LDI 46            ; DEBUG: Show we found '.'
    MOV R0, R0
    LDI after_dot_debug
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_dot_debug:
    ADD >IN, 1
    LDI exec_dot
    MOV R1, R0
    MOV PC, R1
    NOP

check_dup_fixed:
    ; Check for "dup" 
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 100            ; 'd'
    SUB R3, R0
    JNZ unknown_word_fixed
    NOP
    
    MOV R3, R2
    AND R3, MASK
    LDI 117            ; 'u'
    SUB R3, R0
    JNZ unknown_word_fixed
    NOP
    
    ; Check next word starts with 'p'
    MOV R1, TIB
    ADD R1, >IN
    ADD R1, 1
    LD R2, R1, 0
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 112            ; 'p'
    SUB R3, R0
    JNZ unknown_word_fixed
    NOP
    
    ; Found "dup"
    ADD >IN, 2
    LDI exec_dup
    MOV R1, R0
    MOV PC, R1
    NOP

unknown_word_fixed:
    ; Skip unknown word
    ADD >IN, 1
    LDI 83            ; 'S' - show skipped
    MOV R0, R0
    LDI after_s_debug
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_s_debug:
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Dot-Quote String Handling
; =============================================

handle_dot_quote:
    ; Handle ." string" - skip the ." and print until next "
    ADD >IN, 1         ; Skip the ." word (0x2E22)
    
dot_quote_loop:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0       ; Get current word
    ADD R2, 0
    JZ dot_quote_done  ; End of input
    
    ; Extract high byte (first character)
    MOV R3, R2
    SRA R3, 8          ; Shift high byte to low position
    AND R3, MASK       ; Mask to get just the byte
    
    ; Check if it's the closing quote
    LDI 34             ; '"'
    SUB R3, R0
    JZ dot_quote_done  ; Found quote, done
    
    ; Restore character and print it
    ADD R3, R0         ; Restore original character
    MOV R0, R3
    LDI after_char1_print
    MOV R11, R0
    LDI print_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_char1_print:
    ; Extract low byte (second character)
    MOV R3, R2
    AND R3, MASK       ; Get low byte directly
    
    ; Check if it's the closing quote
    LDI 34             ; '"'
    SUB R3, R0
    JZ dot_quote_done  ; Found quote, done
    
    ; Restore character and print it
    ADD R3, R0         ; Restore original character
    MOV R0, R3
    LDI after_char2_print
    MOV R11, R0
    LDI print_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_char2_print:
    ; Advance to next word
    ADD >IN, 1
    LDI dot_quote_loop
    MOV R1, R0
    MOV PC, R1
    NOP

dot_quote_done:
    ; Quote found - skip this word and continue
    ADD >IN, 1
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; Execution wrappers that return to text interpreter
; =============================================

exec_dup:
    ; DEBUG: Show executing dup
    LDI 69            ; 'E'
    MOV R0, R0
    LDI after_e_exec
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_e_exec:
    LDI 100           ; 'd'
    MOV R0, R0
    LDI after_d_exec
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_d_exec:
    LD R1, SP, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

exec_add:
    ; DEBUG: Show executing add
    LDI 69            ; 'E'
    MOV R0, R0
    LDI after_e_add
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_e_add:
    LDI 97            ; 'a'
    MOV R0, R0
    LDI after_a_add
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_a_add:
    LD R2, SP, 0
    LD R1, SP, 1
    ADD R1, R2
    ADD SP, 1
    ST R1, SP, 0
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

exec_mul:
    ; DEBUG: Show executing mul
    LDI 69            ; 'E'
    MOV R0, R0
    LDI after_e_mul
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_e_mul:
    LDI 109           ; 'm'
    MOV R0, R0
    LDI after_m_mul
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_m_mul:
    LD R2, SP, 0
    LD R1, SP, 1
    MUL R1, R2
    ADD SP, 1
    ST R1, SP, 0
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

exec_dot:
    ; DEBUG: Show executing dot
    LDI 69            ; 'E'
    MOV R0, R0
    LDI after_e_dot
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_e_dot:
    LDI 46            ; '.'
    MOV R0, R0
    LDI after_dot_dot
    MOV R11, R0
    LDI debug_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_dot_dot:
    LD R1, SP, 0
    ADD SP, 1
    ADD R1, 0
    JZ exec_dot_zero
    NOP
    
    ; Convert number to string and print
    LDI 0
    MOV R5, R0        ; digit counter
    LDI 10
    MOV R6, R0        ; divisor
    
exec_dot_convert_loop:
    DIV R1, R6
    MOV R3, R2        ; remainder (digit 0-9)
    LDI 48
    ADD R3, R0        ; convert to ASCII
    SUB SP, 1
    ST R3, SP, 0      ; push digit to stack
    ADD R5, 1         ; increment digit count
    ADD R1, 0         ; check if quotient is zero
    JZ exec_dot_print_digits
    NOP
    LDI exec_dot_convert_loop
    MOV R1, R0
    MOV PC, R1
    NOP

exec_dot_zero:
    LDI 48
    SUB SP, 1
    ST R0, SP, 0
    LDI 1
    MOV R5, R0

exec_dot_print_digits:
    ADD R5, 0
    JZ exec_dot_done
    NOP
    LD R1, SP, 0
    ADD SP, 1
    MOV R0, R1
    LDI after_digit_print
    MOV R11, R0
    LDI print_char
    MOV R1, R0
    MOV PC, R1
    NOP
    
after_digit_print:
    SUB R5, 1
    LDI exec_dot_print_digits
    MOV R1, R0
    MOV PC, R1
    NOP

exec_dot_done:
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; User Input String - SIMPLIFIED FOR TESTING
; =============================================
user_input:
    ; Simple test: 1 2 + . 
    .word 0x2031       ; ' ', '1'  (high byte=' ', low byte='1')
    .word 0x2032       ; ' ', '2'  (high byte=' ', low byte='2')
    .word 0x202B       ; ' ', '+'  (high byte=' ', low byte='+')  
    .word 0x202E       ; ' ', '.'  (high byte=' ', low byte='.')
    .word 0x0000       ; Null terminator

kernel_end:
    HLT
