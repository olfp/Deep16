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
    LDI skip_whitespace
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

skip_whitespace:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0       ; Get current word
    ADD R2, 0
    JZ skip_done       ; End of input
    NOP
    
    ; Check both bytes for whitespace
    MOV R3, R2
    SRA R3, 8          ; High byte
    AND R3, MASK
    LDI 32             ; Space
    SUB R3, R0
    JNZ check_low_byte
    NOP
    ; High byte is space, advance
    ADD >IN, 1
    LDI skip_whitespace
    MOV R1, R0
    MOV PC, R1
    NOP
    
check_low_byte:
    MOV R3, R2
    AND R3, MASK       ; Low byte
    LDI 32             ; Space
    SUB R3, R0
    JNZ skip_done      ; Not whitespace
    NOP
    ; Low byte is space, advance
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

parse_word:
    ; Here we'll parse the next word from input
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0       ; Get current word
    
    ; Check for ." (dot-quote) string - look for '.' in high byte and '"' in low byte
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
    LDI parse_number_simple
    MOV R1, R0
    MOV PC, R1
    NOP

parse_number_simple:
    ; Try to parse a number - if it fails, try words
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    
    ; Check high byte for digit
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 48             ; '0'
    SUB R3, R0
    JN not_a_number    ; Below '0'
    NOP
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 57             ; '9'
    SUB R0, R3
    JN not_a_number    ; Above '9'
    NOP
    
    ; It's a digit in high byte - parse it
    LDI 0
    MOV R4, R0         ; accumulator
    
parse_digit_simple:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    
    ; Process high byte
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 48
    SUB R3, R0         ; Convert to number
    JN number_done_simple  ; Not a digit anymore
    NOP
    CMP R3, 10         ; Check if result > 9
    JC number_done_simple  ; Not a digit
    NOP
    
    MOV R5, R4
    LDI 10
    MOV R6, R0
    MUL R5, R6         ; acc * 10
    ADD R5, R3         ; + digit
    MOV R4, R5
    
    ; Process low byte if available
    MOV R3, R2
    AND R3, MASK
    ADD R3, 0
    JZ advance_and_continue
    NOP
    LDI 48
    SUB R3, R0         ; Convert to number
    JN number_done_simple  ; Not a digit
    NOP
    CMP R3, 10         ; Check if result > 9
    JC number_done_simple  ; Not a digit
    NOP
    
    MOV R5, R4
    LDI 10
    MOV R6, R0
    MUL R5, R6         ; acc * 10
    ADD R5, R3         ; + digit
    MOV R4, R5
    
advance_and_continue:
    ADD >IN, 1         ; Advance to next word
    
    ; Check next character
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    ADD R2, 0
    JZ number_done_simple  ; End of input
    
    ; Check if next high byte is digit
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 48             ; '0'
    SUB R3, R0
    JN number_done_simple  ; Not a digit
    NOP
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 57             ; '9'
    SUB R0, R3
    JN number_done_simple  ; Not a digit
    NOP
    
    LDI parse_digit_simple
    MOV R1, R0
    MOV PC, R1
    NOP

number_done_simple:
    ; Push number onto stack
    SUB SP, 1
    ST R4, SP, 0
    
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

not_a_number:
    ; Not a number, try to interpret as word
    LDI interpret_word_simple
    MOV R1, R0
    MOV PC, R1
    NOP

interpret_word_simple:
    ; Interpret a word from input - SIMPLIFIED
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    
    ; Check for single-character operators first
    
    ; Check for "+" in high byte
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 43             ; '+'
    SUB R3, R0
    JNZ check_multiply_simple
    NOP
    ; Found "+"
    ADD >IN, 1
    LDI exec_add
    MOV R1, R0
    MOV PC, R1
    NOP

check_multiply_simple:
    ; Check for "*" in high byte
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 42             ; '*'
    SUB R3, R0
    JNZ check_dot_simple
    NOP
    ; Found "*"
    ADD >IN, 1
    LDI exec_mul
    MOV R1, R0
    MOV PC, R1
    NOP

check_dot_simple:
    ; Check for "." in high byte
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 46             ; '.'
    SUB R3, R0
    JNZ check_dup_simple
    NOP
    ; Found "."
    ADD >IN, 1
    LDI exec_dot
    MOV R1, R0
    MOV PC, R1
    NOP

check_dup_simple:
    ; Check for "dup" - look for 'd' in high byte, 'u' in low byte, 'p' in next high byte
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 100            ; 'd'
    SUB R3, R0
    JNZ unknown_word_simple
    NOP
    
    MOV R3, R2
    AND R3, MASK
    LDI 117            ; 'u'
    SUB R3, R0
    JNZ unknown_word_simple
    NOP
    
    ; Check next word for 'p'
    MOV R1, TIB
    ADD R1, >IN
    ADD R1, 1
    LD R2, R1, 0
    MOV R3, R2
    SRA R3, 8
    AND R3, MASK
    LDI 112            ; 'p'
    SUB R3, R0
    JNZ unknown_word_simple
    NOP
    
    ; Found "dup"
    ADD >IN, 2
    LDI exec_dup
    MOV R1, R0
    MOV PC, R1
    NOP

unknown_word_simple:
    ; Skip unknown word - just advance by 1
    ADD >IN, 1
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; CORRECTED Dot-Quote String Handling
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
    
    ; DEBUG: Print '[' to show we're in string mode
    ; LDI 91            ; '['
    ; STS R0, ES, SCR
    ; ADD SCR, 1
    ; ADD POS, 1
    
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
    
    ; DEBUG: Print ']' to show we processed a word
    ; LDI 93            ; ']'
    ; STS R0, ES, SCR
    ; ADD SCR, 1
    ; ADD POS, 1
    
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
    LD R1, SP, 0
    SUB SP, 1
    ST R1, SP, 0
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

exec_dot:
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
    JNO exec_dot_digit_loop
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
    JNO exec_dot_print
    NOP
exec_dot_done:
    LDI interpret_loop_return
    MOV R1, R0
    MOV PC, R1
    NOP

; =============================================
; User Input String - VERIFIED CORRECT PACKING
; =============================================
user_input:
    ; ." Hello Deep16 strings!" 3 * 7 dup + .
    ; Each word contains two characters: high_byte = first char, low_byte = second char
    .word 0x2E22       ; '.', '"'  - THIS IS CORRECT
    .word 0x4865       ; 'H', 'e'  - 0x48='H', 0x65='e'
    .word 0x6C6C       ; 'l', 'l'  - 0x6C='l', 0x6C='l'
    .word 0x6F20       ; 'o', ' '  - 0x6F='o', 0x20=' '
    .word 0x4465       ; 'D', 'e'  - 0x44='D', 0x65='e'
    .word 0x6570       ; 'e', 'p'  - 0x65='e', 0x70='p'
    .word 0x3136       ; '1', '6'  - 0x31='1', 0x36='6'
    .word 0x2073       ; ' ', 's'  - 0x20=' ', 0x73='s'
    .word 0x7472       ; 't', 'r'  - 0x74='t', 0x72='r'
    .word 0x696E       ; 'i', 'n'  - 0x69='i', 0x6E='n'
    .word 0x6773       ; 'g', 's'  - 0x67='g', 0x73='s'
    .word 0x2122       ; '!', '"'  - 0x21='!', 0x22='"' - CLOSING QUOTE
    .word 0x2033       ; ' ', '3'
    .word 0x202A       ; ' ', '*'
    .word 0x2037       ; ' ', '7'
    .word 0x2064       ; ' ', 'd'
    .word 0x7570       ; 'u', 'p'
    .word 0x202B       ; ' ', '+'
    .word 0x202E       ; ' ', '.'
    .word 0x0000       ; Null terminator

kernel_end:
    HLT
