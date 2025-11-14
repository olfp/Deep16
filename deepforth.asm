; DeepForth Core for Deep16
; Single-segment implementation with proper 2-operand syntax

.equ S0, 0x0400    ; Data stack start (grows upward)
.equ R0, 0x0600    ; Return stack start (grows upward)  
.equ TIB, 0x0800   ; Terminal Input Buffer
.equ DP, 0x1000    ; Dictionary pointer

; Register usage:
; R13 (SP) - Data stack pointer
; R12 (FP) - Return stack pointer
; R11 (IP) - Instruction pointer  
; R10 (W)  - Working register
; R9 (DP)  - Dictionary pointer
; R8 (IN)  - Input buffer index

.forth_cold:
    ; Initialize Forth Virtual Machine
    LDI S0
    MOV SP, R0, 0      ; SP = data stack base
    LDI R0
    MOV FP, R0, 0      ; FP = return stack base
    LDI DP
    MOV R9, R0, 0      ; DP = dictionary base
    LDI 0
    MOV R8, R0, 0      ; IN = input index
    
    JMP forth_quit

;==============================================
; INNER INTERPRETER
;==============================================
.next:
    LD R10, R11, 0     ; W = [IP]
    ADD R11, 1         ; IP = IP + 1
    JMP R10            ; Execute word!

.docol: ; ( -- ) ENTER - for colon definitions
    ST R11, FP, 0      ; push IP to return stack
    ADD FP, 1          ; FP = FP + 1
    LD R11, R10, 1     ; IP = W+1 (skip link field)
    JMP next

.exit:  ; ( -- ) EXIT
    SUB FP, 1          ; FP = FP - 1
    LD R11, FP, 0      ; IP = [FP]
    JMP next

;==============================================
; STACK OPERATIONS
;==============================================
.dup:   ; ( n -- n n )
    SUB SP, 1          ; SP = SP - 1 (make space)
    LD R0, SP, 1       ; R0 = old TOS
    ST R0, SP, 0       ; store copy at new TOS
    JMP next

.drop:  ; ( n -- )
    SUB SP, 1          ; SP = SP - 1
    JMP next

.swap:  ; ( a b -- b a )
    LD R0, SP, 0       ; R0 = TOS (b)
    LD R1, SP, 1       ; R1 = second (a)
    ST R0, SP, 1       ; store b in second position
    ST R1, SP, 0       ; store a in TOS position
    JMP next

.over:  ; ( a b -- a b a )
    SUB SP, 1          ; SP = SP - 1 (make space)
    LD R0, SP, 2       ; R0 = a (was [SP+1] before decrement)
    ST R0, SP, 0       ; store as new TOS
    JMP next

.rot:   ; ( a b c -- b c a )
    LD R0, SP, 0       ; R0 = c (TOS)
    LD R1, SP, 1       ; R1 = b
    LD R2, SP, 2       ; R2 = a
    ST R1, SP, 2       ; b to bottom
    ST R0, SP, 1       ; c to middle  
    ST R2, SP, 0       ; a to top
    JMP next

;==============================================
; ARITHMETIC OPERATIONS
;==============================================
.plus:  ; ( a b -- sum )
    LD R0, SP, 1       ; R0 = a
    LD R1, SP, 0       ; R1 = b
    ADD R0, R1         ; R0 = R0 + R1
    ST R0, SP, 1       ; store result
    SUB SP, 1          ; SP = SP - 1
    JMP next

.minus: ; ( a b -- a-b )
    LD R0, SP, 1       ; R0 = a
    LD R1, SP, 0       ; R1 = b
    SUB R0, R1         ; R0 = R0 - R1
    ST R0, SP, 1       ; store result
    SUB SP, 1          ; SP = SP - 1
    JMP next

.and:   ; ( a b -- a&b )
    LD R0, SP, 1       ; R0 = a
    LD R1, SP, 0       ; R1 = b
    AND R0, R1         ; R0 = R0 & R1
    ST R0, SP, 1
    SUB SP, 1
    JMP next

.or:    ; ( a b -- a|b )
    LD R0, SP, 1       ; R0 = a
    LD R1, SP, 0       ; R1 = b
    OR R0, R1          ; R0 = R0 | R1
    ST R0, SP, 1
    SUB SP, 1
    JMP next

.xor:   ; ( a b -- a^b )
    LD R0, SP, 1       ; R0 = a
    LD R1, SP, 0       ; R1 = b
    XOR R0, R1         ; R0 = R0 ^ R1
    ST R0, SP, 1
    SUB SP, 1
    JMP next

;==============================================
; MEMORY OPERATIONS
;==============================================
.lit:   ; ( -- n ) push literal
    LD R0, R11, 0      ; R0 = literal from IP
    ST R0, SP, 0       ; push to TOS
    ADD SP, 1          ; SP = SP + 1
    ADD R11, 1         ; IP = IP + 1
    JMP next

.fetch: ; ( addr -- n )
    LD R0, SP, 0       ; R0 = addr from TOS
    LD R0, R0, 0       ; R0 = [addr]
    ST R0, SP, 0       ; replace TOS with value
    JMP next

.store: ; ( n addr -- )
    LD R0, SP, 1       ; R0 = n
    LD R1, SP, 0       ; R1 = addr
    ST R0, R1, 0       ; [addr] = n
    SUB SP, 2          ; SP = SP - 2
    JMP next

.cfetch: ; ( addr -- char )
    LD R0, SP, 0       ; R0 = addr
    LD R0, R0, 0       ; R0 = [addr]
    AND R0, R0, 0x00FF ; R0 = R0 & 0x00FF
    ST R0, SP, 0       ; replace TOS with char
    JMP next

.cstore: ; ( char addr -- )
    LD R0, SP, 1       ; R0 = char
    LD R1, SP, 0       ; R1 = addr
    AND R0, R0, 0x00FF ; R0 = R0 & 0x00FF
    ST R0, R1, 0       ; [addr] = char
    SUB SP, 2          ; SP = SP - 2
    JMP next

;==============================================
; DICTIONARY OPERATIONS
;==============================================
.comma: ; ( n -- ) append cell to dictionary
    LD R0, SP, 0       ; R0 = n
    ST R0, R9, 0       ; [DP] = n
    ADD R9, 1          ; DP = DP + 1
    SUB SP, 1          ; SP = SP - 1
    JMP next

.ccomma: ; ( char -- ) append char to dictionary
    LD R0, SP, 0       ; R0 = char
    AND R0, R0, 0x00FF ; R0 = R0 & 0x00FF
    ST R0, R9, 0       ; [DP] = char
    ADD R9, 1          ; DP = DP + 1
    SUB SP, 1          ; SP = SP - 1
    JMP next

.here:  ; ( -- addr ) get dictionary pointer
    MOV R0, R9, 0      ; R0 = DP
    ST R0, SP, 0       ; push to TOS
    ADD SP, 1          ; SP = SP + 1
    JMP next

.allot: ; ( n -- ) allocate memory
    LD R0, SP, 0       ; R0 = n
    ADD R9, R0         ; DP = DP + n
    SUB SP, 1          ; SP = SP - 1
    JMP next

;==============================================
; CONTROL FLOW
;==============================================
.branch: ; ( -- ) unconditional branch
    LD R11, R11, 0     ; IP = IP + offset
    JMP next

.zbranch: ; ( flag -- ) branch if zero
    LD R0, SP, 0       ; R0 = flag
    SUB SP, 1          ; SP = SP - 1
    SUB R0, 0, w=0     ; R0 = R0 - 0 (test flag)
    JNZ .zbranch_no    ; if not zero, skip
    LD R11, R11, 0     ; IP = IP + offset
    JMP next
.zbranch_no:
    ADD R11, 1         ; IP = IP + 1
    JMP next

;==============================================
; I/O OPERATIONS (Stubs)
;==============================================
.emit:  ; ( char -- ) output character
    ; TODO: UART output
    SUB SP, 1          ; SP = SP - 1
    JMP next

.key:   ; ( -- char ) input character  
    ; TODO: UART input
    LDI '?'            ; R0 = '?'
    ST R0, SP, 0       ; push to TOS
    ADD SP, 1          ; SP = SP + 1
    JMP next

.cr:    ; ( -- ) carriage return
    ; TODO: UART newline
    JMP next

.space: ; ( -- ) output space
    LDI ' '            ; R0 = ' '
    ST R0, SP, 0       ; push space
    ADD SP, 1          ; SP = SP + 1
    JMP emit           ; output it

;==============================================
; TEST AND DEMONSTRATION WORDS
;==============================================
.test_add: ; ( -- 7 ) simple test
    LDI 3              ; R0 = 3
    ST R0, SP, 0       ; push 3
    ADD SP, 1          ; SP = SP + 1
    LDI 4              ; R0 = 4  
    ST R0, SP, 0       ; push 4
    ADD SP, 1          ; SP = SP + 1
    JMP plus           ; 3 + 4 = 7
    ; Stack now has: 7

.increment: ; ( addr -- ) increment memory location
    LD R0, SP, 0       ; R0 = addr
    LD R1, R0, 0       ; R1 = [addr]
    ADD R1, 1          ; R1 = R1 + 1
    ST R1, R0, 0       ; [addr] = R1
    SUB SP, 1          ; SP = SP - 1
    JMP next

.times_four: ; ( n -- n*4 )
    LD R0, SP, 0       ; R0 = n
    ADD R0, R0         ; R0 = R0 + R0 = n*2
    ADD R0, R0         ; R0 = R0 + R0 = n*4
    ST R0, SP, 0       ; replace TOS
    JMP next

;==============================================
; OUTER INTERPRETER SHELL
;==============================================
.forth_quit:
    ; Simple test - run test_add and halt
    LDI test_add
    MOV R11, R0, 0     ; IP = test_add
    JMP next           ; Execute test sequence
    
    ; Eventually: text interpreter loop here
    HLT

;==============================================
; UTILITY FUNCTIONS
;==============================================
.type_string: ; ( addr -- ) type string until null
    LD R0, R1, 0       ; R0 = [R1] (current char)
    SUB R0, 0, w=0     ; R0 = R0 - 0 (test for null)
    JZ .type_done
    ST R0, SP, 0       ; push char
    ADD SP, 1          ; SP = SP + 1
    JMP emit           ; output char
    ADD R1, 1          ; R1 = R1 + 1
    JMP type_string
.type_done:
    SUB SP, 1          ; SP = SP - 1
    JMP next

;==============================================
; DATA SECTION
;==============================================
.prompt:
    .db "DeepForth> ", 0

; Core word addresses
.word_docol:   .dw docol
.word_exit:    .dw exit  
.word_dup:     .dw dup
.word_drop:    .dw drop
.word_swap:    .dw swap
.word_plus:    .dw plus
.word_minus:   .dw minus
.word_fetch:   .dw fetch
.word_store:   .dw store

.align 1
