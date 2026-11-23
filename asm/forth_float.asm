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
; which is also where the direct i2f/f2i calls live. Its scratch cells sit in
; the 0x6600 tail and are addressed PC-relatively, so they stay clear of the
; D16D 0x1F3C/0x1F40 code and the low-memory data cells.
.org 0x6600
f_ten_powers:
    .word 0x3F80, 0x0000
    .word 0x4120, 0x0000
    .word 0x42C8, 0x0000
    .word 0x447A, 0x0000
    .word 0x461C, 0x4000
    .word 0x47C3, 0x5000
    .word 0x4974, 0x2400
    .word 0x4B18, 0x9680
    .word 0x4CBE, 0xBC20
    .word 0x4E6E, 0x6B28
    .word 0x5015, 0x02F9
    .word 0x51BA, 0x43B7
    .word 0x5368, 0xD4A5
    .word 0x5511, 0x84E7
    .word 0x56B5, 0xE621
    .word 0x5863, 0x5FA9
    .word 0x5A0E, 0x1BCA
    .word 0x5BB1, 0xA2BC
    .word 0x5D5E, 0x0B6B
    .word 0x5F0A, 0xC723
    .word 0x60AD, 0x78EC
    .word 0x6258, 0xD727
    .word 0x6407, 0x8678
    .word 0x65A9, 0x6816
    .word 0x6753, 0xC21C
    .word 0x6904, 0x5951
    .word 0x6AA5, 0x6FA6
    .word 0x6C4E, 0xCB8F
    .word 0x6E01, 0x3F39
    .word 0x6FA1, 0x8F08
    .word 0x7149, 0xF2CA
    .word 0x72FC, 0x6F7C
    .word 0x749D, 0xC5AE
    .word 0x7645, 0x3719
    .word 0x77F6, 0x84DF
    .word 0x799A, 0x130C
    .word 0x7B40, 0x97CE
    .word 0x7CF0, 0xBDC2
    .word 0x7E96, 0x7699
f_ten_powers_end:

.org 0x6650
f_ten_powers_neg:
    .word 0x3F80, 0x0000
    .word 0x3DCC, 0xCCCD
    .word 0x3C23, 0xD70A
    .word 0x3A83, 0x126F
    .word 0x38D1, 0xB717
    .word 0x3727, 0xC5AC
    .word 0x3586, 0x37BD
    .word 0x33D6, 0xBF95
    .word 0x322B, 0xCC77
    .word 0x3089, 0x705F
    .word 0x2EDB, 0xE6FF
    .word 0x2D2F, 0xEBFF
    .word 0x2B8C, 0xBCCC
    .word 0x29E1, 0x2E13
    .word 0x2834, 0x24DC
    .word 0x2690, 0x1D7D
    .word 0x24E6, 0x9595
    .word 0x2338, 0x77AA
    .word 0x2193, 0x92EF
    .word 0x1FEC, 0x1E4A
    .word 0x1E3C, 0xE508
    .word 0x1C97, 0x1DA0
    .word 0x1AF1, 0xC901
    .word 0x1941, 0x6D9A
    .word 0x179A, 0xBE15
    .word 0x15F7, 0x9688
    .word 0x1446, 0x1206
    .word 0x129E, 0x74D2
    .word 0x10FD, 0x87B6
    .word 0x0F4A, 0xD2F8
    .word 0x0DA2, 0x4260
    .word 0x0C01, 0xCEB3
    .word 0x0A4F, 0xB11F
    .word 0x08A6, 0x274C
    .word 0x0704, 0xEC3D
    .word 0x0554, 0xAD2E
    .word 0x03AA, 0x2425
    .word 0x0208, 0x1CEA
f_ten_powers_neg_end:

.org 0x6700
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
f_dot_sci:
    .word 0
f_dot_exp:
    .word 0
f_dot_tib:
    .word 0
f_dot_divisors:
    .word 1000
    .word 100
    .word 10
    .word 1
fpu_dot_cells_end:

; The float-literal scanner keeps its state in fifteen cells it allocates on
; the data stack, so no fixed DS/CS cell block is needed. This one cell parks
; the caller's R10 (the threaded-code W) across a scan.
.org 0x18E7
lit_save_r10:
    .word 0
fpu_lit_cells_end:



; ---- float literal scanner ----------------------------------------------
; The tokenizer calls scan_float for every token. The grammar is
;   [-]digits[.digits][e[+/-]digits]
; A token without a dot or an exponent is left to the ordinary integer/word
; scanner. The first pass is register-only and validates the token; the
; second pass parses the integer and fraction digits. The integer part is
; limited to nine digits for both the integer and fraction parts (extra digits are
; validated and ignored). Nothing is pushed or compiled until the whole token
; has validated; on any error >IN goes back to the token start.
.org 0x4330
scan_float:
    LDI 0x18E7
    MOV R11, R0
    STS R10, CS, R11           ; save the caller's W
    SUB SP, 15
    ST R5, SP, 0               ; token start
    LSI R1, 0
    ST R1, SP, 2               ; sign
    ST R1, SP, 3               ; dot
    ST R1, SP, 4               ; integer digit count
    ST R1, SP, 5               ; fraction digit count
    ST R1, SP, 6               ; exponent seen
    ST R1, SP, 7               ; exponent value
    ST R1, SP, 8               ; exponent sign

    MOV R3, R6
    ADD R3, R5
    LD R2, R3, 0
    LDI '-'
    CMP R2, R0
    JNZ sf_scan
    NOP
    LSI R1, 1
    ST R1, SP, 2
    ADD R3, 1

sf_scan:
    LD R2, R3, 0
    LDI '0'
    CMP R2, R0
    JN sf_reject_tramp
    NOP
    LDI '9'
    CMP R0, R2
    JN sf_reject_tramp
    NOP

    LSI R4, 0
sf_int_loop:
    LD R2, R3, 0
    LDI '0'
    CMP R2, R0
    JN sf_int_done
    NOP
    LDI '9'
    CMP R0, R2
    JN sf_int_done
    NOP
    ADD R3, 1
    ADD R4, 1
    CMP R0, R0
    JZ sf_int_loop
    NOP
sf_int_done:
    LDI 10
    CMP R4, R0
    JN sf_int_ok
    NOP
    CMP R0, R0
    JZ sf_reject_tramp
    NOP
sf_int_ok:
    ST R4, SP, 4

    LD R2, R3, 0
    LDI '.'
    CMP R2, R0
    JNZ sf_exp_scan
    NOP
    LSI R1, 1
    ST R1, SP, 3
    ADD R3, 1
    LD R2, R3, 0
    LDI '0'
    CMP R2, R0
    JN sf_reject_tramp
    NOP
    LDI '9'
    CMP R0, R2
    JN sf_reject_tramp
    NOP
    LSI R7, 0
sf_frac_loop:
    LD R2, R3, 0
    LDI '0'
    CMP R2, R0
    JN sf_frac_done
    NOP
    LDI '9'
    CMP R0, R2
    JN sf_frac_done
    NOP
    ADD R3, 1
    ADD R7, 1
    CMP R0, R0
    JZ sf_frac_loop
    NOP
sf_frac_done:
    LDI 9
    CMP R7, R0
    JN sf_frac_store
    NOP
    MOV R7, R0
sf_frac_store:
    ST R7, SP, 5
    CMP R0, R0
    JZ sf_exp_scan
    NOP
sf_exp_scan:
    CMP R0, R0
    JZ sf_exp_scan_go
    NOP
sf_reject_tramp:
    LDI sf_reject
    MOV PC, R0
    NOP
sf_exp_scan_go:
    LD R2, R3, 0
    LDI 'e'
    CMP R2, R0
    JZ sf_exp
    NOP
    LDI 'E'
    CMP R2, R0
    JZ sf_exp
    NOP
    CMP R0, R0
    JZ sf_scan_end
    NOP
sf_exp:
    LSI R1, 1
    ST R1, SP, 6
    ADD R3, 1
    LD R2, R3, 0
    LDI '+'
    CMP R2, R0
    JZ sf_exp_skip
    NOP
    LDI '-'
    CMP R2, R0
    JNZ sf_exp_digits
    NOP
    LSI R1, 1
    ST R1, SP, 8
sf_exp_skip:
    ADD R3, 1
sf_exp_digits:
    LD R2, R3, 0
    LDI '0'
    CMP R2, R0
    JN sf_reject_tramp
    NOP
    LDI '9'
    CMP R0, R2
    JN sf_reject_tramp
    NOP
    LSI R7, 0
sf_exp_loop:
    LD R2, R3, 0
    LDI '0'
    CMP R2, R0
    JN sf_exp_done
    NOP
    LDI '9'
    CMP R0, R2
    JN sf_exp_done
    NOP
    LDI '0'
    SUB R2, R0
    MOV R4, R7
    LDI 10
    MUL R4, R0
    ADD R4, R2
    LDI 99
    CMP R4, R0
    JN sf_exp_ok
    NOP
    MOV R4, R0
sf_exp_ok:
    MOV R7, R4
    ADD R3, 1
    CMP R0, R0
    JZ sf_exp_loop
    NOP
sf_exp_done:
    ST R7, SP, 7
    CMP R0, R0
    JZ sf_scan_end
    NOP
sf_scan_end:
    LD R2, R3, 0
    LDI 0
    CMP R2, R0
    JZ sf_token_end
    NOP
    LDI ' '
    CMP R2, R0
    JZ sf_token_end
    NOP
    CMP R0, R0
    JZ sf_reject_tramp
    NOP

sf_token_end:
    MOV R1, R3
    SUB R1, R6
    ST R1, SP, 1
    LD R1, SP, 4
    CMP R1, 0
    JZ sf_reject_tramp
    NOP
    LD R1, SP, 3
    CMP R1, 0
    JZ sf_kind
    NOP
    LD R1, SP, 5
    CMP R1, 0
    JZ sf_reject_tramp
    NOP
sf_kind:
    LD R1, SP, 3
    CMP R1, 0
    JNZ sf_parse_jump
    NOP
    LD R1, SP, 6
    CMP R1, 0
    JZ sf_reject_tramp
    NOP
sf_parse_jump:
    LDI sf_parse_tramp
    MOV PC, R0
    NOP
fpu_lit_end:

; The build half lives below 0x4000 so its LDI cell accesses and local jumps
; stay short. It still reaches the library/traps above 0x4000 with PC-relative
; calls.


.org fpu_lib_end
; lit_scale: R1 is a signed count. Multiply the value at SP+13/14 by
; 10^|R1| (or divide when R1 is negative) using a table of float32 powers of
; ten. One trap per call replaces the old repeated multiply/divide, which lost
; several low bits by the time a large exponent such as 1e38 was built.
lit_scale:
    CMP R1, 0
    JZ lit_scale_done
    NOP
    MOV R2, R1
    CMP R1, 0
    JNN lit_scale_pos
    NOP
    NEG R2
lit_scale_pos:
    LDI 39
    MOV R3, R0
    CMP R2, R3
    JNC lit_scale_big
    NOP
    MOV R10, PC
lit_scale_tbl:
    LDI f_ten_powers - lit_scale_tbl
    ADD R10, R0
    CMP R1, 0
    JNN lit_scale_base_ok
    NOP
    ; Negative exponents use the reciprocal table, except 10^-38: its
    ; reciprocal is denormal and the library would flush it to zero, so
    ; divide by 10^38 instead and keep values like 2e-38 normal.
    LDI 38
    MOV R3, R0
    CMP R2, R3
    JZ lit_scale_base_ok
    NOP
    LDI 0x50
    ADD R10, R0
lit_scale_base_ok:
    MOV R7, R2
    SL R2, 1
    ADD R10, R2
    LDS R4, CS, R10
    ADD R10, 1
    LDS R5, CS, R10
    LD R2, SP, 13
    LD R3, SP, 14
    CMP R1, 0
    JN lit_scale_neg
    NOP
    FMUL
    CMP R0, R0
    JZ lit_scale_save
    NOP
lit_scale_neg:
    LDI 38
    MOV R3, R0
    CMP R7, R3
    JZ lit_scale_div
    NOP
    FMUL
    CMP R0, R0
    JZ lit_scale_save
    NOP
lit_scale_div:
    FDIV
lit_scale_save:
    ST R2, SP, 13
    ST R3, SP, 14
    JMP LR
    NOP

lit_scale_big:
    ; |n| >= 39: a nonzero value overflows to +inf or underflows to zero;
    ; zero stays zero. The caller applies the sign after scaling.
    LD R2, SP, 13
    LD R3, SP, 14
    CMP R2, 0
    JNZ lit_scale_big_nonzero
    NOP
    CMP R3, 0
    JZ lit_scale_done
lit_scale_big_nonzero:
    CMP R1, 0
    JN lit_scale_big_zero
    NOP
    LDI 0x7F
    MOV R2, R0
    SL R2, 8
    LDI 0x80
    OR R2, R0
    LSI R3, 0
    CMP R0, R0
    JZ lit_scale_save
lit_scale_big_zero:
    LSI R2, 0
    LSI R3, 0
    CMP R0, R0
    JZ lit_scale_save

lit_scale_done:
    JMP LR
    NOP

; lit_scale_frac: the fraction half of sf_build. It always divides by a
; positive power of ten, because multiplying a small integer fraction by a
; reciprocal such as 0.1 exposes the multiplier's low-bit truncation
; (5 * 0.1 came out as 0.5000018). The count is 1..4; 10^1..10^4 are exact.
lit_scale_frac:
    MOV R2, R1
    NEG R2
    MOV R10, PC
lit_scale_frac_tbl:
    LDI f_ten_powers - lit_scale_frac_tbl
    ADD R10, R0
    MOV R11, R2
    SL R11, 1
    ADD R10, R11
    LDS R4, CS, R10
    ADD R10, 1
    LDS R5, CS, R10
    LD R2, SP, 13
    LD R3, SP, 14
    FDIV
    ST R2, SP, 13
    ST R3, SP, 14
    JMP LR
    NOP

; lit_commit: R2 = high, R3 = low. Push the two cells or compile LIT low /
; LIT high, then return to the caller.
lit_commit:
    MOV R7, R3
    MOV R9, R2
    LDI state_var
    MOV R2, R0
    LD R2, R2, 0
    CMP R2, 0
    JNZ lit_commit_compile
    NOP
    SUB SP, 1
    ST R7, SP, 0
    SUB SP, 1
    ST R9, SP, 0
    JMP LR
    NOP
lit_commit_compile:
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    LDI xt_lit
    MOV R4, R0
    ST R4, R3, 0
    ADD R3, 1
    ST R7, R3, 0
    ADD R3, 1
    ST R4, R3, 0
    ADD R3, 1
    ST R9, R3, 0
    ADD R3, 1
    ST R3, R2, 0
    JMP LR
    NOP

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
    MOV R10, PC
fd_cell_1:
    LDI f_dot_high - fd_cell_1
    ADD R10, R0
    STS R2, CS, R10
    MOV R10, PC
fd_cell_2:
    LDI f_dot_low - fd_cell_2
    ADD R10, R0
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
    MOV R11, PC
fd_inf_done:
    LDI fd_done - fd_inf_done
    ADD R11, R0
    MOV PC, R11
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
    MOV R11, PC
fd_nan_done:
    LDI fd_done - fd_nan_done
    ADD R11, R0
    MOV PC, R11
    NOP

fd_finite:
    ; ---- choose fixed or scientific for large finite values ----
    ; |x| >= 32768 has a biased exponent of 142 or more; f2i would clamp.
    MOV R1, R2
    SR R1, 7
    LDI 0xFF
    MOV R4, R0
    AND R1, R4
    LDI 142
    MOV R4, R0
    CMP R1, R4
    JNC fd_sci_jump
    NOP
    ; Zero and denormal inputs stay fixed; f2i flushes them to 0.
    CMP R1, 0
    JZ fd_fixed
    NOP
    ; |x| < 1e-4 would print 0.0000 fixed; use scientific instead.
    LDI 0x38D1
    MOV R4, R0
    CMP R2, R4
    JC fd_sci_jump
    NOP
    JNZ fd_fixed
    NOP
    LDI 0xB7
    MOV R4, R0
    SL R4, 8
    LDI 0x17
    OR R4, R0
    CMP R3, R4
    JC fd_sci_jump
    NOP
fd_fixed:
    LSI R1, 0
    MOV R10, PC
fd_cell_3:
    LDI f_dot_sci - fd_cell_3
    ADD R10, R0
    STS R1, CS, R10
    CMP R0, R0
    JZ fd_print
    NOP
fd_sci_jump:
    MOV R11, PC
fd_sci_jl:
    LDI fd_sci - fd_sci_jl
    ADD R11, R0
    MOV PC, R11
    NOP

fd_print:
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
    MOV R10, PC
fd_cell_4:
    LDI f_dot_int - fd_cell_4
    ADD R10, R0
    STS R9, CS, R10

    ; ---- fraction = abs(f) - float(int) ----
    MOV R10, PC
fd_cell_6:
    LDI f_dot_in - fd_cell_6
    ADD R10, R0
    STS R5, CS, R10            ; park >IN before F1 takes R5
    MOV R10, PC
fd_cell_7:
    LDI f_dot_int - fd_cell_7
    ADD R10, R0
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
    MOV R10, PC
fd_cell_8:
    LDI f_dot_high - fd_cell_8
    ADD R10, R0
    LDS R2, CS, R10            ; F0 = abs value
    MOV R10, PC
fd_cell_9:
    LDI f_dot_low - fd_cell_9
    ADD R10, R0
    LDS R3, CS, R10
    XOR R4, 15                 ; F0 + (-F1)
    FADD
    MOV R10, PC
fd_cell_10:
    LDI f_dot_in - fd_cell_10
    ADD R10, R0
    LDS R5, CS, R10            ; restore >IN

    ; ---- fraction * 10000.0 ----
    MOV R10, PC
fd_cell_11:
    LDI f_dot_in - fd_cell_11
    ADD R10, R0
    STS R5, CS, R10
    LDI 0x230E
    MOV R4, R0
    SL R4, 1                   ; 0x461C = 10000.0 high
    LDI 0x2000
    MOV R5, R0
    SL R5, 1                   ; 0x4000 low
    FMUL
    LDI 0x3F00
    MOV R4, R0
    LSI R5, 0
    FADD                       ; round the four printed digits half up
    MOV R10, PC
fd_cell_12:
    LDI f_dot_in - fd_cell_12
    ADD R10, R0
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
    MOV R9, R0                 ; rounded fraction, 0..10000
    LDI 10000
    MOV R1, R0
    CMP R9, R1
    JNZ fd_frac_no_carry
    NOP
    ; A fraction of 10000 carries into the integer. In scientific form
    ; 9.99996eN becomes 1.0000e(N+1); in fixed form 32767.99999 becomes
    ; 32768.0000, which print_number still prints as an unsigned magnitude.
    LSI R9, 0
    MOV R10, PC
fd_cell_30:
    LDI f_dot_int - fd_cell_30
    ADD R10, R0
    LDS R2, CS, R10
    ADD R2, 1
    MOV R10, PC
fd_cell_31:
    LDI f_dot_sci - fd_cell_31
    ADD R10, R0
    LDS R1, CS, R10
    CMP R1, 0
    JZ fd_frac_store_int
    NOP
    LDI 10
    MOV R1, R0
    CMP R2, R1
    JNZ fd_frac_store_int
    NOP
    LSI R2, 1
    MOV R10, PC
fd_cell_32:
    LDI f_dot_exp - fd_cell_32
    ADD R10, R0
    LDS R1, CS, R10
    ADD R1, 1
    STS R1, CS, R10
fd_frac_store_int:
    MOV R10, PC
fd_cell_33:
    LDI f_dot_int - fd_cell_33
    ADD R10, R0
    STS R2, CS, R10
fd_frac_no_carry:
    MOV R10, PC
fd_cell_13:
    LDI f_dot_frac - fd_cell_13
    ADD R10, R0
    STS R9, CS, R10

    ; ---- print the integer part, then '.' ----
    LDI pn_space_flag
    MOV R10, R0
    LSI R1, 0
    ST R1, R10, 0
    MOV R10, PC
fd_cell_5:
    LDI f_dot_int - fd_cell_5
    ADD R10, R0
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


    ; ---- four digits, leading zeroes ----
    MOV R10, PC
fd_cell_14:
    LDI f_dot_frac - fd_cell_14
    ADD R10, R0
    LDS R2, CS, R10
    MOV R3, PC
fd_div_l:
    LDI f_dot_divisors - fd_div_l
    ADD R3, R0
    LSI R1, 4
    MOV R10, PC
fd_cell_15:
    LDI f_dot_count - fd_cell_15
    ADD R10, R0
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
    MOV R10, PC
fd_cell_16:
    LDI f_dot_count - fd_cell_16
    ADD R10, R0
    LDS R1, CS, R10
    SUB R1, 1
    STS R1, CS, R10
    CMP R1, 0
    JNZ fd_frac_loop
    NOP
    CMP R0, R0
    JZ fd_exponent
    NOP

fd_exponent:
    ; ---- scientific notation: append e and the decimal exponent ----
    MOV R10, PC
fd_cell_17:
    LDI f_dot_sci - fd_cell_17
    ADD R10, R0
    LDS R1, CS, R10
    CMP R1, 0
    JZ fd_done
    NOP
    LDI put_char
    MOV R4, R0
    LDI 'e'
    LINK
    JMP R4
    NOP
    MOV R10, PC
fd_cell_18:
    LDI f_dot_exp - fd_cell_18
    ADD R10, R0
    LDS R2, CS, R10
    CMP R2, 0
    JNN fd_exp_positive
    NOP
    LDI put_char
    MOV R4, R0
    LDI '-'
    LINK
    JMP R4
    NOP
    NEG R2
fd_exp_positive:
    LDI print_number
    MOV R3, R0
    LINK
    JMP R3
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

fd_sci:
    ; Park >IN and TIB. The traps preserve them, but the search and the
    ; print path use the same cells for other scratch values.
    MOV R10, PC
fd_sci_in:
    LDI f_dot_in - fd_sci_in
    ADD R10, R0
    STS R5, CS, R10
    MOV R10, PC
fd_sci_tib:
    LDI f_dot_tib - fd_sci_tib
    ADD R10, R0
    STS R6, CS, R10

    MOV R10, PC
fd_sci_hi0:
    LDI f_dot_high - fd_sci_hi0
    ADD R10, R0
    LDS R2, CS, R10
    MOV R10, PC
fd_sci_lo0:
    LDI f_dot_low - fd_sci_lo0
    ADD R10, R0
    LDS R3, CS, R10

    ; |x| >= 1 uses a binary search for the largest 10^n <= |x|.
    LDI 0x3F80
    MOV R4, R0
    CMP R2, R4
    JC fd_sci_small
    NOP

    LSI R6, 0                  ; low
    LDI 38
    MOV R7, R0                 ; high
    LSI R8, 0                  ; best
fd_sci_bs:
    CMP R7, R6
    JN fd_sci_bs_done
    NOP
    MOV R9, R6
    ADD R9, R7
    SRA R9, 1                  ; mid
    MOV R10, PC
fd_sci_tbl:
    LDI f_ten_powers - fd_sci_tbl
    ADD R10, R0
    MOV R11, R9
    SL R11, 1
    ADD R10, R11
    LDS R4, CS, R10
    ADD R10, 1
    LDS R5, CS, R10
    CMP R2, R4
    JC fd_sci_bs_less
    NOP
    JNZ fd_sci_bs_more
    NOP
    CMP R3, R5
    JC fd_sci_bs_less
    NOP
fd_sci_bs_more:
    MOV R8, R9
    MOV R6, R9
    ADD R6, 1
    CMP R0, R0
    JZ fd_sci_bs
    NOP
fd_sci_bs_less:
    MOV R7, R9
    SUB R7, 1
    CMP R0, R0
    JZ fd_sci_bs
    NOP
fd_sci_bs_done:
    MOV R10, PC
fd_sci_exp:
    LDI f_dot_exp - fd_sci_exp
    ADD R10, R0
    STS R8, CS, R10
    CMP R8, 0
    JZ fd_sci_finish
    NOP
    MOV R10, PC
fd_sci_tbl2:
    LDI f_ten_powers - fd_sci_tbl2
    ADD R10, R0
    MOV R11, R8
    SL R11, 1
    ADD R10, R11
    LDS R4, CS, R10
    ADD R10, 1
    LDS R5, CS, R10
    MOV R10, PC
fd_sci_hi1:
    LDI f_dot_high - fd_sci_hi1
    ADD R10, R0
    LDS R2, CS, R10
    MOV R10, PC
fd_sci_lo1:
    LDI f_dot_low - fd_sci_lo1
    ADD R10, R0
    LDS R3, CS, R10
    FDIV
    MOV R10, PC
fd_sci_hi2:
    LDI f_dot_high - fd_sci_hi2
    ADD R10, R0
    STS R2, CS, R10
    MOV R10, PC
fd_sci_lo2:
    LDI f_dot_low - fd_sci_lo2
    ADD R10, R0
    STS R3, CS, R10
    CMP R0, R0
    JZ fd_sci_finish
    NOP

fd_sci_small:
    ; |x| < 1: multiply the original value by 10^n until it reaches [1,10).
    LSI R8, 1                  ; n
fd_sci_small_loop:
    LDI 39
    MOV R4, R0
    CMP R8, R4
    JNC fd_sci_small_done
    NOP
    MOV R10, PC
fd_sci_tbl3:
    LDI f_ten_powers - fd_sci_tbl3
    ADD R10, R0
    MOV R11, R8
    SL R11, 1
    ADD R10, R11
    LDS R4, CS, R10
    ADD R10, 1
    LDS R5, CS, R10
    MOV R10, PC
fd_sci_hi3:
    LDI f_dot_high - fd_sci_hi3
    ADD R10, R0
    LDS R2, CS, R10
    MOV R10, PC
fd_sci_lo3:
    LDI f_dot_low - fd_sci_lo3
    ADD R10, R0
    LDS R3, CS, R10
    FMUL
    LDI 0x3F80
    MOV R4, R0
    CMP R2, R4
    JNC fd_sci_small_accept
    NOP
    ADD R8, 1
    CMP R0, R0
    JZ fd_sci_small_loop
    NOP
fd_sci_small_accept:
    MOV R4, R8
    NEG R4
    MOV R10, PC
fd_sci_small_exp:
    LDI f_dot_exp - fd_sci_small_exp
    ADD R10, R0
    STS R4, CS, R10
    MOV R10, PC
fd_sci_hi4:
    LDI f_dot_high - fd_sci_hi4
    ADD R10, R0
    STS R2, CS, R10
    MOV R10, PC
fd_sci_lo4:
    LDI f_dot_low - fd_sci_lo4
    ADD R10, R0
    STS R3, CS, R10
    CMP R0, R0
    JZ fd_sci_finish
    NOP

fd_sci_small_done:
    ; Only a denormal/zero input gets here; the caller keeps those fixed.
    LSI R8, 0
    MOV R10, PC
fd_sci_zero_exp:
    LDI f_dot_exp - fd_sci_zero_exp
    ADD R10, R0
    STS R8, CS, R10
    LSI R2, 0
    LSI R3, 0
    MOV R10, PC
fd_sci_hi5:
    LDI f_dot_high - fd_sci_hi5
    ADD R10, R0
    STS R2, CS, R10
    MOV R10, PC
fd_sci_lo5:
    LDI f_dot_low - fd_sci_lo5
    ADD R10, R0
    STS R3, CS, R10

fd_sci_finish:
    MOV R10, PC
fd_sci_in2:
    LDI f_dot_in - fd_sci_in2
    ADD R10, R0
    LDS R5, CS, R10
    MOV R10, PC
fd_sci_tib2:
    LDI f_dot_tib - fd_sci_tib2
    ADD R10, R0
    LDS R6, CS, R10
    LSI R1, 1
    MOV R10, PC
fd_sci_flag:
    LDI f_dot_sci - fd_sci_flag
    ADD R10, R0
    STS R1, CS, R10
    MOV R11, PC
fd_sci_back:
    LDI fd_print - fd_sci_back
    ADD R11, R0
    MOV PC, R11
    NOP

fpu_dot_end:

.org 0x2D2F
sf_parse_tramp:
    MOV R11, PC
sf_parse_tramp_l:
    LDI sf_parse - sf_parse_tramp_l
    ADD R11, R0
    MOV PC, R11
    NOP
sf_build_tramp:
    MOV R11, PC
sf_build_tramp_l:
    LDI sf_build - sf_build_tramp_l
    ADD R11, R0
    MOV PC, R11
    NOP
fpu_lit_tramp_end:

.org 0x6800
sf_parse:
    LD R1, SP, 0
    MOV R3, R6
    ADD R3, R1
    LD R2, R3, 0
    LDI '-'
    CMP R2, R0
    JNZ sf_p_int
    NOP
    ADD R3, 1
sf_p_int:
    LSI R9, 0                  ; integer high (R6 stays TIB)
    LSI R7, 0                  ; integer low
sf_p_int_loop:
    LD R2, R3, 0
    LDI '0'
    CMP R2, R0
    JN sf_p_int_done
    NOP
    LDI '9'
    CMP R0, R2
    JN sf_p_int_done
    NOP
    LDI '0'
    SUB R2, R0
    ; R9:R7 = R9:R7 * 10 + digit
    LDI 10
    MOV R8, R0
    MOV R4, R7
    MUL32 R4, R8
    MOV R10, R9
    MUL32 R10, R8
    ADD R5, R2
    JC sf_p_int_carry
    NOP
    MOV R7, R5
    MOV R9, R11
    ADD R9, R4
    CMP R0, R0
    JZ sf_p_int_next
    NOP
sf_p_int_carry:
    MOV R7, R5
    MOV R9, R11
    ADD R9, R4
    ADD R9, 1
sf_p_int_next:
    ADD R3, 1
    CMP R0, R0
    JZ sf_p_int_loop
    NOP
sf_p_int_done:
    ST R7, SP, 9
    ST R9, SP, 6               ; integer high; exp_seen is no longer needed
    LD R2, R3, 0
    LDI '.'
    CMP R2, R0
    JNZ sf_p_go
    NOP
    ADD R3, 1
    LD R1, SP, 5
    LSI R9, 0                  ; fraction high (R6 stays TIB)
    LSI R7, 0                  ; fraction low
sf_p_frac_loop:
    CMP R1, 0
    JZ sf_p_frac_done
    NOP
    LD R2, R3, 0
    LDI '0'
    CMP R2, R0
    JN sf_p_frac_done
    NOP
    LDI '9'
    CMP R0, R2
    JN sf_p_frac_done
    NOP
    LDI '0'
    SUB R2, R0
    ; R6:R7 = R6:R7 * 10 + digit
    LDI 10
    MOV R8, R0
    MOV R4, R7
    MUL32 R4, R8               ; high:low of low*10
    MOV R10, R9
    MUL32 R10, R8              ; low of high*10 in R11
    ADD R5, R2
    JC sf_p_frac_carry
    NOP
    MOV R7, R5
    MOV R9, R11
    ADD R9, R4
    CMP R0, R0
    JZ sf_p_frac_next
    NOP
sf_p_frac_carry:
    MOV R7, R5
    MOV R9, R11
    ADD R9, R4
    ADD R9, 1
sf_p_frac_next:
    ADD R3, 1
    SUB R1, 1
    CMP R0, R0
    JZ sf_p_frac_loop
    NOP
sf_p_frac_done:
    ST R7, SP, 10
    ST R9, SP, 0               ; fraction high; the token start is no longer needed
sf_p_go:
    LDI sf_build_tramp
    MOV PC, R0
    NOP
fpu_lit_parse_end:

.org fpu_dot_end
sf_build:
    ; Integer float -> SP+11/12.
    LD R10, SP, 9
    MOV R9, R6
    MOV R11, PC
sf_u2f_int_lo:
    LDI u2f - sf_u2f_int_lo
    ADD R11, R0
    MOV R0, R10
    LINK
    JMP R11
    NOP
    MOV R6, R9
    ST R2, SP, 11
    ST R3, SP, 12
    LD R10, SP, 6
    CMP R10, 0
    JZ sf_int_low_only
    NOP
    MOV R9, R6
    MOV R11, PC
sf_u2f_int_hi:
    LDI u2f - sf_u2f_int_hi
    ADD R11, R0
    MOV R0, R10
    LINK
    JMP R11
    NOP
    MOV R6, R9
    ; high * 65536.0 + low
    MOV R4, R2
    MOV R5, R3
    LDI 0x23C0
    MOV R4, R0
    SL R4, 1                   ; 0x4780 = 65536.0 high
    LSI R5, 0
    FMUL
    MOV R4, R2
    MOV R5, R3
    LD R2, SP, 11
    LD R3, SP, 12
    FADD
    ST R2, SP, 11
    ST R3, SP, 12
sf_int_low_only:

    LD R1, SP, 5
    CMP R1, 0
    JZ sf_build_nofrac
    NOP
    LD R10, SP, 10
    MOV R9, R6
    MOV R11, PC
sf_u2f_frac_lo:
    LDI u2f - sf_u2f_frac_lo
    ADD R11, R0
    MOV R0, R10
    LINK
    JMP R11
    NOP
    MOV R6, R9
    ST R2, SP, 13
    ST R3, SP, 14
    ; A fraction above four digits has a nonzero high word.
    LD R10, SP, 0
    CMP R10, 0
    JZ sf_frac_low_only
    NOP
    MOV R9, R6
    MOV R11, PC
sf_u2f_frac_hi:
    LDI u2f - sf_u2f_frac_hi
    ADD R11, R0
    MOV R0, R10
    LINK
    JMP R11
    NOP
    MOV R6, R9
    ; high * 65536.0 + low
    MOV R4, R2
    MOV R5, R3
    LDI 0x23C0
    MOV R4, R0
    SL R4, 1                   ; 0x4780 = 65536.0 high
    LSI R5, 0
    FMUL
    MOV R4, R2
    MOV R5, R3
    LD R2, SP, 13
    LD R3, SP, 14
    FADD
    ST R2, SP, 13
    ST R3, SP, 14
sf_frac_low_only:
    LD R1, SP, 5
    NEG R1                     ; divide by 10^frac_count
    MOV R11, PC
sf_scale1:
    LDI lit_scale_frac - sf_scale1
    ADD R11, R0
    LINK
    JMP R11
    NOP
    LD R2, SP, 11
    LD R3, SP, 12
    LD R4, SP, 13
    LD R5, SP, 14
    FADD
    ST R2, SP, 13
    ST R3, SP, 14
    CMP R0, R0
    JZ sf_build_exp
    NOP
sf_build_nofrac:
    LD R2, SP, 11
    LD R3, SP, 12
    ST R2, SP, 13
    ST R3, SP, 14

sf_build_exp:
    LD R1, SP, 7
    CMP R1, 0
    JZ sf_build_sign
    NOP
    LD R2, SP, 8
    CMP R2, 0
    JZ sf_build_scale
    NOP
    NEG R1
sf_build_scale:
    MOV R11, PC
sf_scale2:
    LDI lit_scale - sf_scale2
    ADD R11, R0
    LINK
    JMP R11
    NOP

sf_build_sign:
    LD R1, SP, 2
    CMP R1, 0
    JZ sf_build_commit
    NOP
    LD R2, SP, 13
    LDI 1
    MOV R1, R0
    SL R1, 15
    XOR R2, R1
    ST R2, SP, 13

sf_build_commit:
    LD R2, SP, 13
    LD R3, SP, 14
    LD R5, SP, 1
    ADD SP, 15
    LDI lit_restore_r10
    LINK
    JMP R0
    NOP
    MOV R11, PC
sf_commit_call:
    LDI lit_commit - sf_commit_call
    ADD R11, R0
    LINK
    JMP R11
    NOP
    LDI interpret_loop
    MOV PC, R0
    NOP
fpu_lit_build_end:

.org 0x48A9
scan_float_probe:
    MOV R3, R6
    ADD R3, R5
    LD R2, R3, 0
    LDI '-'
    CMP R2, R0
    JZ probe_scan
    NOP
    LDI '0'
    CMP R2, R0
    JN probe_no
    NOP
    LDI '9'
    CMP R0, R2
    JN probe_no
    NOP
probe_scan:
    LD R2, R3, 0
    LDI 0
    CMP R2, R0
    JZ probe_no
    NOP
    LDI ' '
    CMP R2, R0
    JZ probe_no
    NOP
    LDI '.'
    CMP R2, R0
    JZ probe_yes
    NOP
    LDI 'e'
    CMP R2, R0
    JZ probe_yes
    NOP
    LDI 'E'
    CMP R2, R0
    JZ probe_yes
    NOP
    ADD R3, 1
    CMP R0, R0
    JZ probe_scan
    NOP
probe_yes:
    MOV R11, PC
probe_yes_l:
    LDI scan_float - probe_yes_l
    ADD R11, R0
    MOV PC, R11
    NOP
probe_no:
    LDI scan_number_normal
    MOV PC, R0
    NOP
fpu_lit_probe_end:

; The two transcendental headers are newest-first in the chain. They live at
; the end of the 0x417D block, which is still inside the DS copy, so FIND can
; read them; the literal parser moved to the 0x6500 tail to make room.
.org fpu_words_end
fpu_trans_base:
h_fexp:
    .word h_flog
    .word 4
    .text "fexp"
    .word word_fexp
h_flog:
    .word h_fdot
    .word 4
    .text "flog"
    .word word_flog

word_fexp:
    LD R2, SP, 0
    LD R3, SP, 1
    FEXP
    ST R2, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP

word_flog:
    LD R2, SP, 0
    LD R3, SP, 1
    FLOG
    ST R2, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP
fpu_trans_end:


.endif
.org 0x18E8
lit_restore_r10:
    LDI 0x18E7
    MOV R11, R0
    LDS R10, CS, R11
    JMP LR
    NOP
sf_reject:
    LD R5, SP, 0
    ADD SP, 15
    LDI lit_restore_r10
    LINK
    JMP R0
    NOP
    LDI scan_number_normal
    MOV PC, R0
    NOP
