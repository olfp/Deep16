; asm/forth_float.asm - Forth surface for the soft-float library
;
; Included after asm/softfloat.asm when FPU_WORDS is defined. The words use
; the ILL trap for arithmetic, so they run the same path as assembler FPU
; code (including the D16D BIOS copy). s>f and f>s have no trap opcode, so
; they call i2f/f2i in the flat library directly.
;
; Representation: a float is two cells, high half on top, like the kernel's
; double-cell words. `f+` therefore reads:
;
;       SP+0  B high      SP+2  A high
;       SP+1  B low       SP+3  A low
;
; and leaves the result with its high half on top. The words assume the
; operands are present; they do not duplicate the kernel's underflow checks.
;
; Registers: R5 is >IN and R6 is TIB. Binary words park >IN in R7 across the
; trap (the handler saves/restores R7), and s>f/f>s park TIB in R9 around the
; direct library call. R8 (the cursor) is never touched.

.ifdef FPU_WORDS
.org 0x417D
fpu_words_base:

; ---- headers, newest first ------------------------------------------------
h_fplus:
    .word h_fminus
    .word 2
    .text "f+"
    .word word_fplus
h_fminus:
    .word h_fmul
    .word 2
    .text "f-"
    .word word_fminus
h_fmul:
    .word h_fdiv
    .word 2
    .text "f*"
    .word word_fmul
h_fdiv:
    .word h_fsqrt
    .word 2
    .text "f/"
    .word word_fdiv
h_fsqrt:
    .word h_fnegate
    .word 5
    .text "fsqrt"
    .word word_fsqrt
h_fnegate:
    .word h_fabs
    .word 7
    .text "fnegate"
    .word word_fnegate
h_fabs:
    .word h_flt
    .word 4
    .text "fabs"
    .word word_fabs
h_flt:
    .word h_feq
    .word 2
    .text "f<"
    .word word_flt
h_feq:
    .word h_f0lt
    .word 2
    .text "f="
    .word word_feq
h_f0lt:
    .word h_s2f
    .word 3
    .text "f0<"
    .word word_f0lt
h_s2f:
    .word h_f2s
    .word 3
    .text "s>f"
    .word word_s2f
h_f2s:
    .word h_ffetch
    .word 3
    .text "f>s"
    .word word_f2s
h_ffetch:
    .word h_fstore
    .word 2
    .text "f@"
    .word word_ffetch
h_fstore:
    .word h_segbase
    .word 2
    .text "f!"
    .word word_fstore

; ---- code ----------------------------------------------------------------
.code

; f+ ( fA fB -- fA+fB )
word_fplus:
    MOV R7, R5                 ; park >IN
    LD R4, SP, 0               ; F1 high = B
    LD R5, SP, 1               ; F1 low
    LD R2, SP, 2               ; F0 high = A
    LD R3, SP, 3               ; F0 low
    FADD
    MOV R5, R7                 ; restore >IN
    ADD SP, 2
    ST R2, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP

; f- ( fA fB -- fA-fB ): no FSUB opcode; flip B's sign and add.
word_fminus:
    MOV R7, R5
    LD R4, SP, 0
    LD R5, SP, 1
    LD R2, SP, 2
    LD R3, SP, 3
    XOR R4, 15                 ; F1 sign bit
    FADD
    MOV R5, R7
    ADD SP, 2
    ST R2, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP

; f* ( fA fB -- fA*fB )
word_fmul:
    MOV R7, R5
    LD R4, SP, 0
    LD R5, SP, 1
    LD R2, SP, 2
    LD R3, SP, 3
    FMUL
    MOV R5, R7
    ADD SP, 2
    ST R2, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP

; f/ ( fA fB -- fA/fB )
word_fdiv:
    MOV R7, R5
    LD R4, SP, 0
    LD R5, SP, 1
    LD R2, SP, 2
    LD R3, SP, 3
    FDIV
    MOV R5, R7
    ADD SP, 2
    ST R2, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP

; fsqrt ( f -- f )
word_fsqrt:
    LD R2, SP, 0
    LD R3, SP, 1
    FSQRT
    ST R2, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP

; fnegate ( f -- -f )
word_fnegate:
    LD R2, SP, 0
    XOR R2, 15
    ST R2, SP, 0
    LDI next
    MOV PC, R0
    NOP

; fabs ( f -- |f| )
word_fabs:
    LD R2, SP, 0
    CLRB R2, 15
    ST R2, SP, 0
    LDI next
    MOV PC, R0
    NOP

; f< ( fA fB -- flag ): N and not unordered
word_flt:
    MOV R9, R5                 ; park >IN; FCMP's flags must survive
    LD R4, SP, 0
    LD R5, SP, 1
    LD R2, SP, 2
    LD R3, SP, 3
    FCMP
    LPSW R7                    ; capture N/Z/V before any flag-clobbering MOV
    MOV R5, R9
    LSI R0, 0
    MOV R10, R7
    LSI R1, 4
    AND R10, R1                ; unordered (V)?
    JNZ flt_done
    NOP
    MOV R10, R7
    LSI R1, 1
    AND R10, R1                ; A < B (N)?
    JZ flt_done
    NOP
    LSI R0, 1
flt_done:
    ADD SP, 3
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP

; f= ( fA fB -- flag ): Z and not unordered
word_feq:
    MOV R9, R5
    LD R4, SP, 0
    LD R5, SP, 1
    LD R2, SP, 2
    LD R3, SP, 3
    FCMP
    LPSW R7
    MOV R5, R9
    LSI R0, 0
    MOV R10, R7
    LSI R1, 4
    AND R10, R1                ; unordered (V)?
    JNZ feq_done
    NOP
    MOV R10, R7
    LSI R1, 2
    AND R10, R1                ; equal (Z)?
    JZ feq_done
    NOP
    LSI R0, 1
feq_done:
    ADD SP, 3
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP

; f0< ( f -- flag ): compare with +0.0
word_f0lt:
    MOV R9, R5
    LD R2, SP, 0
    LD R3, SP, 1
    LSI R4, 0
    LSI R5, 0
    FCMP
    LPSW R7
    MOV R5, R9
    LSI R0, 0
    MOV R10, R7
    LSI R1, 4
    AND R10, R1                ; unordered (V)?
    JNZ f0lt_done
    NOP
    MOV R10, R7
    LSI R1, 1
    AND R10, R1                ; A < 0 (N)?
    JZ f0lt_done
    NOP
    LSI R0, 1
f0lt_done:
    ST R0, SP, 1
    ADD SP, 1
    LDI next
    MOV PC, R0
    NOP

; s>f ( n -- f ): direct i2f, no trap opcode.
word_s2f:
    MOV R9, R6                 ; park TIB
    LD R10, SP, 0              ; the LDI below writes R0
    MOV R11, PC
s2f_call:
    LDI i2f - s2f_call
    ADD R11, R0
    MOV R0, R10
    LINK
    JMP R11
    NOP
    MOV R6, R9
    SUB SP, 1
    ST R2, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP

; f>s ( f -- n ): direct f2i, truncating toward zero.
word_f2s:
    MOV R9, R6
    LD R2, SP, 0
    LD R3, SP, 1
    MOV R11, PC
f2s_call:
    LDI f2i - f2s_call
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R6, R9
    ST R0, SP, 1
    ADD SP, 1
    LDI next
    MOV PC, R0
    NOP

; f@ ( addr -- f )
word_ffetch:
    LD R1, SP, 0
    LD R2, R1, 0
    LD R3, R1, 1
    SUB SP, 1
    ST R2, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP

; f! ( f addr -- )
word_fstore:
    LD R1, SP, 0
    LD R2, SP, 1
    LD R3, SP, 2
    ST R2, R1, 0
    ST R3, R1, 1
    ADD SP, 3
    LDI next
    MOV PC, R0
    NOP
fpu_words_end:
.endif
