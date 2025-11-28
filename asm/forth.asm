; =============================================
; Enhanced Deep16 Forth Kernel
; Fixed string handling version
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
    MOV SP, R0        ; Data stack grows down from 0x7FF0
    LDI 0x7FE0
    MOV RSP, R0       ; Return stack at 0x7FE0
    
    ; Initialize instruction pointer
    LDI user_program
    MOV IP, R0
    
    ; Set up screen segment for output
    LDI 0x0FFF
    INV R0            ; R0 = 0xF000
    MVS ES, R0        ; ES = 0xF000
    LDI 0x1000        ; Screen at 0xF1000
    MOV SCR, R0
    ERD R8            ; Use R8/R9 for ES access
    
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
    LD R1, IP, 0      ; Get codeword
    ADD IP, 1         ; Advance IP
    MOV PC, R1        ; Execute
    NOP

; =============================================
; Stack Primitives
; =============================================

d_exit:
    LD IP, RSP, 0     ; Pop R11 from return stack
    ADD RSP, 1
    MOV PC, NEXT
    NOP

d_lit:
    LD R1, IP, 0      ; Get literal value
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
    LD R1, SP, 0      ; Get address from stack
    LD R1, R1, 0      ; Fetch value from memory
    ST R1, SP, 0      ; Replace TOS with value
    MOV PC, NEXT
    NOP

d_store:
    LD R1, SP, 0      ; Address (TOS)
    LD R2, SP, 1      ; Value (second)
    ST R2, R1, 0      ; Store value at address
    ADD SP, 2         ; Drop both items
    MOV PC, NEXT
    NOP

; =============================================
; I/O Operations
; =============================================

d_emit:
    LD R1, SP, 0      ; Get character from stack
    ADD SP, 1
    
    STS R1, ES, SCR   ; ES screen write
    ADD SCR, 1
    ADD POS, 1
    
    ; Simple bounds checking
    LDI 2000
    MOV R2, R0
    SUB R2, POS       ; 2000 - current_position
    JNZ emit_done
    NOP
    LDI 0x1000        ; Reset screen pointer
    MOV SCR, R0
    LDI 0             ; Reset position counter
    MOV POS, R0
    
emit_done:
    MOV PC, NEXT
    NOP

; TELL - print packed string until zero byte (FIXED VERSION)
d_tell:
    LD R3, SP, 0      ; Get string address
    ADD SP, 1

tell_loop:
    LD R1, R3, 0      ; Get packed word
    ADD R1, 0
    JZ tell_done
    NOP

    ; Process high byte first (correct order)
    MOV R2, R1
    SWB R2           ; Swap bytes to get correct order
    SRA R2, 8        ; Shift right to get high byte in low position
    AND R2, MASK
    ADD R2, 0
    JZ skip_high
    NOP
    STS R2, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    LDI 2000
    MOV R2, R0
    SUB R2, POS
    JNZ high_ok
    NOP
    LDI 0x1000
    MOV SCR, R0
    LDI 0
    MOV POS, R0
high_ok:

skip_high:
    ; Process low byte
    MOV R2, R1
    AND R2, MASK     ; Get low byte
    ADD R2, 0
    JZ tell_next_word
    NOP
    STS R2, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    
    LDI 2000
    MOV R2, R0
    SUB R2, POS
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
    MOV R1, POS       ; Copy position
    LDI 80
    MOV R2, R0
cr_mod_loop:
    SUB R1, R2        ; Subtract 80
    JN cr_done_mod    ; If negative, done
    NOP
    JNO cr_mod_loop
    NOP
cr_done_mod:
    ADD R1, R2        ; Add back the last 80
    ; Now R1 = current column
    
    ; Calculate spaces to next line: 80 - current_column
    LDI 80
    SUB R0, R1        ; 80 - current_column
    MOV R2, R0        ; R2 = spaces needed
    
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
    LD R2, SP, 0      ; a
    LD R1, SP, 1      ; b
    ADD R1, R2        ; b+a
    ADD SP, 1         ; drop a
    ST R1, SP, 0      ; push result
    MOV PC, NEXT
    NOP

d_sub:
    LD R2, SP, 0      ; a
    LD R1, SP, 1      ; b  
    SUB R1, R2        ; b-a
    ADD SP, 1         ; drop a
    ST R1, SP, 0      ; push result
    MOV PC, NEXT
    NOP

d_mul:
    LD R2, SP, 0      ; a
    LD R1, SP, 1      ; b
    MUL R1, R2        ; b*a
    ADD SP, 1         ; drop a
    ST R1, SP, 0      ; push result
    MOV PC, NEXT
    NOP

; =============================================
; Print Operations
; =============================================

d_dot:
    LD R1, SP, 0      ; value
    ADD SP, 1         ; pop
    ADD R1, 0
    JZ dot_zero
    NOP

    LDI 0
    MOV R5, R0        ; count = 0
    LDI 10
    MOV R6, R0        ; divisor

dot_digit_loop:
    DIV R1, R6
    MOV R3, R2        ; remainder
    LDI 48
    ADD R3, R0        ; Convert to ASCII
    SUB SP, 1
    ST R3, SP, 0      ; push digit
    ADD R5, 1
    ADD R1, 0
    JZ dot_print
    NOP
    JNO dot_digit_loop
    NOP

dot_zero:
    LDI 48            ; '0'
    SUB SP, 1
    ST R0, SP, 0
    LDI 1
    MOV R5, R0        ; count = 1

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
    LD R1, SP, 0      ; value
    ADD SP, 1         ; pop
    LDI 4
    MOV R5, R0        ; digit count
    
hex_loop:
    MOV R2, R1
    AND R2, 0x000F    ; Get lowest nibble
    ; Check if digit > 9 using register comparison
    LDI 9
    MOV R3, R0
    SUB R3, R2        ; 9 - digit
    JC is_hex_letter  ; If digit > 9
    NOP
    ; Digit 0-9
    LDI 48
    ADD R2, R0
    LDI hex_output
    MOV R6, R0
    MOV PC, R6        ; Jump to output
    NOP
is_hex_letter:
    ; Digit A-F  
    LDI 55            ; 'A' - 10
    ADD R2, R0
hex_output:
    STS R2, ES, SCR
    ADD SCR, 1
    ADD POS, 1
    SRA R1, 4         ; Shift to next nibble
    SUB R5, 1
    JNZ hex_loop
    NOP
    
    MOV PC, NEXT
    NOP

d_halt:
    HLT

; =============================================
; Demo Program with CORRECT string packing
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

; CORRECT string packing - high byte first, then low byte
program_msg:
    .word 0x4465       ; 'D' 'e' (high: 'D', low: 'e')
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
.word 0x4558           ; 'E' 'X' (correct order)
.word 0x5449           ; 'T' 'I'
.word 0x0000
.word d_exit

; LIT  
.word dict_start
.word 0x4003
.word 0x4C49           ; 'L' 'I' (correct order)
.word 0x0054           ; 'T' + padding
.word d_lit

; .H (DOT_HEX)
.word dict_start+12
.word 0x4002
.word 0x2E48           ; '.' 'H' (correct order)
.word d_dot_hex

kernel_end:
    HLT
