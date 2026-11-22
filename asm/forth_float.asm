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
h_fdot:
    .word h_fover
    .word 2
    .text "f."
    .word word_fdot
h_fover:
    .word h_fswap
    .word 5
    .text "fover"
    .word word_fover
h_fswap:
    .word h_fdrop
    .word 5
    .text "fswap"
    .word word_fswap
h_fdrop:
    .word h_fdup
    .word 5
    .text "fdrop"
    .word word_fdrop
h_fdup:
    .word h_fplus
    .word 4
    .text "fdup"
    .word word_fdup
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

; fdup ( f -- f f )
word_fdup:
    LD R1, SP, 0
    LD R2, SP, 1
    SUB SP, 2
    ST R1, SP, 0
    ST R2, SP, 1
    LDI next
    MOV PC, R0
    NOP

; fdrop ( f -- )
word_fdrop:
    ADD SP, 2
    LDI next
    MOV PC, R0
    NOP

; fswap ( f1 f2 -- f2 f1 )
word_fswap:
    LD R1, SP, 0
    LD R2, SP, 1
    LD R3, SP, 2
    LD R4, SP, 3
    ST R3, SP, 0
    ST R4, SP, 1
    ST R1, SP, 2
    ST R2, SP, 3
    LDI next
    MOV PC, R0
    NOP

; fover ( f1 f2 -- f1 f2 f1 )
word_fover:
    LD R1, SP, 2
    LD R2, SP, 3
    SUB SP, 2
    ST R1, SP, 0
    ST R2, SP, 1
    LDI next
    MOV PC, R0
    NOP
fpu_words_end:

; ---- f. -----------------------------------------------------------------
; The printer code sits above the library, keeping the header/code gap below
; 0x4330 inside its pacman budget. It runs from the flat image at CS=0,
; which is also where the direct i2f/f2i calls live. Its scratch cells sit
; in a free gap below 0x4000 so an LDI address reaches them without
; sign-extending.
.org 0x1F3C
fpu_dot_base:
f_dot_high:
    .word 0
f_dot_low:
    .word 0
f_dot_int:
    .word 0
f_dot_frac:
    .word 0
f_dot_in:
    .word 0
f_dot_count:
    .word 0
f_dot_divisors:
    .word 1000
    .word 100
    .word 10
    .word 1
fpu_dot_cells_end:

.org fpu_lib_end
; f. ( f -- ) prints a fixed-point decimal: sign, integer part and four
; fractional digits. Values whose integer part does not fit f2i's signed
; 16-bit result print "ovf"; the special values print "nan"/"inf".
word_fdot:
    LD R2, SP, 0
    LD R3, SP, 1
    ADD SP, 2

    ; ---- sign ----
    LDI 1
    MOV R1, R0
    SL R1, 15                  ; 0x8000
    TBC R2, R1
    JZ fd_positive
    NOP
    LDI put_char
    MOV R4, R0
    LDI '-'
    LINK
    JMP R4
    NOP
    CLRB R2, 15
fd_positive:
    LDI f_dot_high
    MOV R10, R0
    STS R2, CS, R10
    LDI f_dot_low
    MOV R10, R0
    STS R3, CS, R10

    ; ---- exponent 0xFF is inf or NaN ----
    MOV R1, R2
    SR R1, 7
    LDI 0xFF
    MOV R4, R0
    AND R1, R4
    CMP R1, R4
    JNZ fd_finite
    NOP
    MOV R1, R2
    LDI 0x7F
    MOV R4, R0
    AND R1, R4
    CMP R1, 0
    JNZ fd_nan
    NOP
    CMP R3, 0
    JNZ fd_nan
    NOP
    LDI put_char
    MOV R4, R0
    LDI 'i'
    LINK
    JMP R4
    NOP
    LDI put_char
    MOV R4, R0
    LDI 'n'
    LINK
    JMP R4
    NOP
    LDI put_char
    MOV R4, R0
    LDI 'f'
    LINK
    JMP R4
    NOP
    CMP R0, R0
    JZ fd_done
    NOP
fd_nan:
    LDI put_char
    MOV R4, R0
    LDI 'n'
    LINK
    JMP R4
    NOP
    LDI put_char
    MOV R4, R0
    LDI 'a'
    LINK
    JMP R4
    NOP
    LDI put_char
    MOV R4, R0
    LDI 'n'
    LINK
    JMP R4
    NOP
    CMP R0, R0
    JZ fd_done
    NOP

fd_finite:
    ; ---- integer part ----
    MOV R9, R6                 ; park TIB
    MOV R11, PC
fd_i2f:
    LDI f2i - fd_i2f
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R6, R9
    MOV R9, R0                 ; keep the integer while the V test uses R0
    LDI 4
    MOV R1, R0
    TBC R10, R1                ; V: clamped, too large for 16 bits
    JNZ fd_ovf
    NOP
    LDI f_dot_int
    MOV R10, R0
    STS R9, CS, R10

    ; ---- print the integer part, then '.' ----
    LDI pn_space_flag
    MOV R10, R0
    LSI R1, 0
    ST R1, R10, 0
    LDI f_dot_int
    MOV R10, R0
    LDS R2, CS, R10
    LDI print_number
    MOV R3, R0
    LINK
    JMP R3
    NOP
    LDI put_char
    MOV R4, R0
    LDI '.'
    LINK
    JMP R4
    NOP

    ; ---- fraction = abs(f) - float(int) ----
    LDI f_dot_in
    MOV R10, R0
    STS R5, CS, R10            ; park >IN before F1 takes R5
    LDI f_dot_int
    MOV R10, R0
    LDS R0, CS, R10
    MOV R10, R0                ; the LDI below writes R0
    MOV R9, R6
    MOV R11, PC
fd_frac_i2f:
    LDI i2f - fd_frac_i2f
    ADD R11, R0
    MOV R0, R10
    LINK
    JMP R11
    NOP
    MOV R6, R9
    MOV R4, R2                 ; F1 = integer part
    MOV R5, R3
    LDI f_dot_high
    MOV R10, R0
    LDS R2, CS, R10            ; F0 = abs value
    LDI f_dot_low
    MOV R10, R0
    LDS R3, CS, R10
    XOR R4, 15                 ; F0 + (-F1)
    FADD
    LDI f_dot_in
    MOV R10, R0
    LDS R5, CS, R10            ; restore >IN

    ; ---- fraction * 10000.0 ----
    LDI f_dot_in
    MOV R10, R0
    STS R5, CS, R10
    LDI 0x230E
    MOV R4, R0
    SL R4, 1                   ; 0x461C = 10000.0 high
    LDI 0x2000
    MOV R5, R0
    SL R5, 1                   ; 0x4000 low
    FMUL
    LDI f_dot_in
    MOV R10, R0
    LDS R5, CS, R10

    ; ---- fraction as an integer 0..9999 ----
    MOV R9, R6
    MOV R11, PC
fd_frac_f2i:
    LDI f2i - fd_frac_f2i
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R6, R9
    MOV R9, R0                 ; keep the fraction while loading the cell address
    LDI f_dot_frac
    MOV R10, R0
    STS R9, CS, R10

    ; ---- four digits, leading zeroes ----
    LDI f_dot_frac
    MOV R10, R0
    LDS R2, CS, R10
    LDI f_dot_divisors
    MOV R3, R0
    LSI R1, 4
    LDI f_dot_count
    MOV R10, R0
    STS R1, CS, R10
fd_frac_loop:
    LDS R1, CS, R3             ; divisor
    LSI R7, 0
fd_frac_sub:
    CMP R2, R1
    JN fd_frac_digit
    NOP
    SUB R2, R1
    ADD R7, 1
    CMP R0, R0
    JZ fd_frac_sub
    NOP
fd_frac_digit:
    LDI '0'
    ADD R7, R0
    LDI put_char
    MOV R11, R0
    MOV R0, R7
    LINK
    JMP R11
    NOP
    ADD R3, 1
    LDI f_dot_count
    MOV R10, R0
    LDS R1, CS, R10
    SUB R1, 1
    STS R1, CS, R10
    CMP R1, 0
    JNZ fd_frac_loop
    NOP
    CMP R0, R0
    JZ fd_done
    NOP

fd_ovf:
    LDI put_char
    MOV R4, R0
    LDI 'o'
    LINK
    JMP R4
    NOP
    LDI put_char
    MOV R4, R0
    LDI 'v'
    LINK
    JMP R4
    NOP
    LDI put_char
    MOV R4, R0
    LDI 'f'
    LINK
    JMP R4
    NOP

fd_done:
    LDI pn_space_flag
    MOV R10, R0
    LSI R1, 1
    ST R1, R10, 0
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    LDI next
    MOV PC, R0
    NOP
fpu_dot_end:
.endif
