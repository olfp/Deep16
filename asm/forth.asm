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
    JZ interpret_done  ; End of input
    NOP
    
    ; DEBUG: Show current position
    LDI 62            ; '>'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
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

parse_word:
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
    JNZ check_number
    NOP
    
    MOV R3, R2
    AND R3, MASK       ; Low byte
    LDI 34             ; '"'
    SUB R3, R0
    JNZ check_number
    NOP
    
    ; Found ." - handle string
    LDI handle_dot_quote
    MOV R1, R0
    MOV PC, R1
    NOP

check_number:
    ; Try to parse a number first
    LDI parse_number_check_both
    MOV R1, R0
    MOV PC, R1
    NOP

parse_number_check_both:
    ; DEBUG: Show we're trying to parse a number
    LDI 78            ; 'N'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
    ; Check current word for numbers in either byte
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    
    ; Check high byte
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    
    ; Check for digits in high byte - FIXED: use proper range check
    LDI 48             ; '0'
    SUB R3, R0
    JN check_low_byte_fixed  ; Below '0'
    NOP
    ; Now R3 = digit value (0-9 if valid)
    CMP R3, 9
    JC check_low_byte_fixed  ; Above 9 (carry = unsigned less)
    NOP
    
    ; High byte is a valid digit 0-9
    LDI parse_full_number
    MOV R1, R0
    MOV PC, R1
    NOP

check_low_byte_fixed:
    ; Check low byte for digits
    MOV R3, R2
    AND R3, MASK
    
    LDI 48             ; '0'
    SUB R3, R0
    JN not_a_number_both  ; Below '0'
    NOP
    ; Now R3 = digit value (0-9 if valid)  
    CMP R3, 9
    JC not_a_number_both  ; Above 9
    NOP
    
    ; Low byte is a valid digit 0-9
    LDI parse_full_number
    MOV R1, R0
    MOV PC, R1
    NOP

parse_full_number:
    ; DEBUG: Show we found a digit
    LDI 68            ; 'D'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
    ; Parse the actual digit - FIXED LOGIC
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    
    ; Try high byte first
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 48
    SUB R3, R0         ; Convert to number 0-9
    JN try_low_byte_fixed
    NOP
    CMP R3, 9
    JC try_low_byte_fixed
    NOP
    
    ; High byte has valid digit
    MOV R4, R3
    LDI push_number_fixed
    MOV R1, R0
    MOV PC, R1
    NOP

try_low_byte_fixed:
    ; Try low byte
    MOV R3, R2
    AND R3, MASK
    LDI 48
    SUB R3, R0         ; Convert to number 0-9
    JN not_a_number_both
    NOP
    CMP R3, 9
    JC not_a_number_both
    NOP
    
    ; Low byte has valid digit
    MOV R4, R3

push_number_fixed:
    ; DEBUG: Show the digit we found
    LDI 48
    ADD R4, R0         ; Convert back to ASCII for display
    STS R4, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    LDI 48
    SUB R4, R0         ; Convert back to number
    
    ; Push number onto stack
    SUB SP, 1
    ST R4, SP, 0
    
    ; DEBUG: Show stack push
    LDI 80            ; 'P'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
    ; Advance past this word (we consumed it)
    ADD >IN, 1
    
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

not_a_number_both:
    ; DEBUG: Show it's not a number
    LDI 88            ; 'X'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
    ; Not a number, try to interpret as word
    LDI interpret_word_check_both
    MOV R1, R0
    MOV PC, R1
    NOP

interpret_word_check_both:
    ; Interpret a word from input - check both bytes
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    
    ; DEBUG: Show we're interpreting a word
    LDI 87            ; 'W'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
    ; Check operators in either byte
    
    ; Check for single char operators in high byte
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 43             ; '+'
    SUB R3, R0
    JNZ check_multiply_high
    NOP
    ; Found "+" in high byte
    ADD >IN, 1
    LDI exec_add
    MOV R1, R0
    MOV PC, R1
    NOP

check_multiply_high:
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 42             ; '*'
    SUB R3, R0
    JNZ check_dot_high
    NOP
    ; Found "*" in high byte
    ADD >IN, 1
    LDI exec_mul
    MOV R1, R0
    MOV PC, R1
    NOP

check_dot_high:
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 46             ; '.'
    SUB R3, R0
    JNZ check_operators_low
    NOP
    ; Found "." in high byte
    ADD >IN, 1
    LDI exec_dot
    MOV R1, R0
    MOV PC, R1
    NOP

check_operators_low:
    ; Check operators in low byte
    MOV R3, R2
    AND R3, MASK
    LDI 43             ; '+'
    SUB R3, R0
    JNZ check_multiply_low
    NOP
    ; Found "+" in low byte
    ADD >IN, 1
    LDI exec_add
    MOV R1, R0
    MOV PC, R1
    NOP

check_multiply_low:
    MOV R3, R2
    AND R3, MASK
    LDI 42             ; '*'
    SUB R3, R0
    JNZ check_dot_low
    NOP
    ; Found "*" in low byte
    ADD >IN, 1
    LDI exec_mul
    MOV R1, R0
    MOV PC, R1
    NOP

check_dot_low:
    MOV R3, R2
    AND R3, MASK
    LDI 46             ; '.'
    SUB R3, R0
    JNZ check_dup_both
    NOP
    ; Found "." in low byte
    ADD >IN, 1
    LDI exec_dot
    MOV R1, R0
    MOV PC, R1
    NOP

check_dup_both:
    ; Check for "dup" - must be complete in high+low bytes
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 100            ; 'd'
    SUB R3, R0
    JNZ unknown_word_both
    NOP
    
    MOV R3, R2
    AND R3, MASK
    LDI 117            ; 'u'
    SUB R3, R0
    JNZ unknown_word_both
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
    JNZ unknown_word_both
    NOP
    
    ; Found "dup"
    ADD >IN, 2
    LDI exec_dup
    MOV R1, R0
    MOV PC, R1
    NOP

unknown_word_both:
    ; Skip unknown word - just advance by 1
    ADD >IN, 1
    
    ; DEBUG: Show we skipped unknown
    LDI 83            ; 'S'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
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
    STS R3, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
    ; Extract low byte (second character)
    MOV R3, R2
    AND R3, MASK       ; Get low byte directly
    
    ; Check if it's the closing quote
    LDI 34             ; '"'
    SUB R3, R0
    JZ dot_quote_done  ; Found quote, done
    
    ; Restore character and print it
    ADD R3, R0         ; Restore original character
    STS R3, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
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
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    LDI 100           ; 'd'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
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
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    LDI 97            ; 'a'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
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
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    LDI 109           ; 'm'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
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
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    LDI 46            ; '.'
    STS R0, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
    LD R1, SP, 0
    ADD SP, 1
    ADD R1, 0
    JZ exec_dot_zero
    NOP
    LDI 0
    MOV R5, R0
    LDI 10
    MOV R6, R0
exec_dot_digit_loop:
    DIV R1, R6
    MOV R3, R2
    LDI 48
    ADD R3, R0
    SUB SP, 1
    ST R3, SP, 0
    ADD R5, 1
    ADD R1, 0
    JZ exec_dot_print
    NOP
    LDI exec_dot_digit_loop
    MOV R1, R0
    MOV PC, R1
    NOP
exec_dot_zero:
    LDI 48
    SUB SP, 1
    ST R0, SP, 0
    LDI 1
    MOV R5, R0
exec_dot_print:
    ADD R5, 0
    JZ exec_dot_done
    NOP
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
