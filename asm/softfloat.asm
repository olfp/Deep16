; asm/softfloat.asm - Deep16 soft-float library (prototype, P3)
;
; This file is position-dependent: include it after the caller's .org. It has
; no .org of its own so the same source can be placed in the nano/D16D image
; or in a test harness.
;
; ABI (FPUEMUPLAN.md section 7.1, FLOATIMPL.md section 2):
;   F0 = R2:R3 (high:low), F1 = R4:R5
;   layer-2 arithmetic takes A in R6:R7 and B in R8:R9, result in R6:R7
;   routines return with JMP LR and do not use the stack or DIV
;
; Numeric policy (FPUEMUPLAN.md section 8):
;   - denormals flush to signed zero on input and output
;   - one canonical quiet NaN, 0x7FC00000
;   - truncate toward zero
;   - infinities are generated and consumed
;   - no overflow/underflow exception flags
;
; A pair is the MUL32 layout: high word first. R6 = sign|exp|mant[22:16],
; R7 = mant[15:0]. An unpacked mantissa is R0 = bits 23..16 (low 8 bits used),
; R1 = bits 15..0, with bit 23 = 1 for a normal number.

; ---- f_unpack ----------------------------------------------------------
; Input:  R6:R7 = float pair
; Output: R10 = sign (0/1), R11 = biased exponent (0..255),
;         R0:R1 = 24-bit significand (bit 23 set for normals)
; A denormal input (exp == 0) is flushed to zero: R0:R1 = 0.
; Clobbers R0, R1, R10, R11. Preserves R2..R9, R12.
f_unpack:
    MOV R10, R6
    SR R10, 15                 ; sign
    MOV R11, R6
    SR R11, 7
    LDI 0xFF
    MOV R1, R0
    AND R11, R1                ; biased exponent
    MOV R0, R6
    CLRB R0, 15
    MOV R1, R0
    LDI 0x7F
    AND R1, R0                 ; mant[22:16] in bits 6..0
    MOV R0, R1
    OR R0, 7                   ; implicit 1 at bit 23
    MOV R1, R7                 ; mant[15:0]
    CMP R11, 0
    JNZ f_unpack_done
    NOP
    LSI R0, 0                  ; denormal -> zero
    LSI R1, 0
f_unpack_done:
    JMP LR
    NOP

; ---- f_pack ------------------------------------------------------------
; Input:  R10 = sign (0/1), R11 = biased exponent, R0:R1 = significand
; Output: R6:R7 = float pair
; The significand must be normalised (bit 23 set). Zero and denormal results
; become signed zero; exponent >= 255 becomes signed infinity.
; Clobbers R0, R2, R6, R7, R11. Preserves R1, R3..R5, R8..R10, R12.
f_pack:
    CMP R1, 0
    JNZ f_pack_nonzero
    NOP
    CMP R0, 0
    JNZ f_pack_nonzero
    NOP
    ; ---- signed zero ----
    LSI R6, 0
    CMP R10, 0
    JZ f_pack_zero_done
    NOP
    OR R6, 15
f_pack_zero_done:
    LSI R7, 0
    JMP LR
    NOP
f_pack_nonzero:
    ; A negative biased exponent is underflow, not overflow: check the sign
    ; bit before the unsigned >= 255 test.
    CMP R11, 0
    JN f_pack_under_zero
    NOP
    JZ f_pack_under_zero
    NOP
    LSI R2, 15
    SL R2, 4
    ADD R2, 15                 ; 255, without clobbering the mantissa in R0
    CMP R11, R2
    JC f_pack_build
    NOP
    ; ---- exponent overflow: signed infinity ----
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    OR R6, 7                   ; 0x7F80
    LSI R7, 0
    CMP R10, 0
    JZ f_pack_ret
    NOP
    OR R6, 15
f_pack_ret:
    JMP LR
    NOP
f_pack_under_zero:
    ; ---- exponent underflow: signed zero ----
    LSI R6, 0
    CMP R10, 0
    JZ f_pack_under_done
    NOP
    OR R6, 15
f_pack_under_done:
    LSI R7, 0
    JMP LR
    NOP
f_pack_build:
    MOV R6, R11
    SL R6, 7
    MOV R2, R0
    LDI 0x7F
    AND R2, R0                 ; mant[22:16]
    OR R6, R2
    CMP R10, 0
    JZ f_pack_nosign
    NOP
    OR R6, 15
f_pack_nosign:
    MOV R7, R1
    JMP LR
    NOP

; ---- i2f / u2f ---------------------------------------------------------
; i2f: R0 = signed 16-bit -> F0 = R2:R3
; u2f: R0 = unsigned 16-bit -> F0 = R2:R3
; Exact: every 16-bit integer fits float32's 24-bit significand.
; Clobbers R0, R1, R6, R7. Preserves R4, R5, R8..R12.
i2f:
    MOV R1, R0
    LSI R6, 0                  ; sign = 0
    CMP R0, 0
    JNN i2f_abs
    NOP
    LSI R6, 1                  ; sign = 1
    LDI 0
    SUB R0, R1                 ; R0 = 0 - x (unsigned magnitude)
    MOV R1, R0
i2f_abs:
    CMP R1, 0
    JNZ i2f_nonzero
    NOP
    LSI R2, 0
    LSI R3, 0
    JMP LR
    NOP
i2f_nonzero:
    LSI R3, 0                  ; k = 0
    LDI 0x0100
    MOV R7, R0
    CMP R1, R7
    JNC i2f_s8
    NOP
    SL R1, 8
    ADD R3, 8
i2f_s8:
    LDI 0x1000
    MOV R7, R0
    CMP R1, R7
    JNC i2f_s4
    NOP
    SL R1, 4
    ADD R3, 4
i2f_s4:
    LDI 0x2000
    MOV R7, R0
    SL R7, 1                   ; 0x4000 (LDI 0x4000 would sign-extend)
    CMP R1, R7
    JNC i2f_s2
    NOP
    SL R1, 2
    ADD R3, 2
i2f_s2:
    MOV R7, R1
    SR R7, 15
    CMP R7, 0
    JNZ i2f_s1
    NOP
    SL R1, 1
    ADD R3, 1
i2f_s1:
    ; R1 = m in [0x8000,0xFFFF], R3 = k
    LDI 142
    MOV R7, R0                 ; R7 = 142
    SUB R7, R3                 ; R7 = unbiased + 127
    SL R7, 7                   ; exponent field
    MOV R3, R1
    SL R3, 8                   ; low 16 bits of the mantissa field
    MOV R0, R1
    SR R0, 8
    CLRB R0, 7                 ; mant[22:16]
    OR R7, R0
    CMP R6, 0
    JZ i2f_nosign
    NOP
    OR R7, 15                  ; sign
i2f_nosign:
    MOV R2, R7
    JMP LR
    NOP

u2f:
    MOV R1, R0
    LSI R6, 0
    LDI i2f_abs
    JMP R0
    NOP

; ---- f2i ---------------------------------------------------------------
; F0 = R2:R3 -> R0, signed 16-bit, truncating toward zero.
; Returns comparison/clamp flags in R10: N = bit 0, Z = bit 1, V = bit 2,
; C = bit 3 (always 0). V means "not representable, clamped"; NaN gives 0
; with V set. Clobbers R0, R1, R6, R7, R10, R11; preserves R2..R5, R8, R9,
; R12.
f2i:
    MOV R12, LR
    MOV R6, R2
    MOV R7, R3
    LDI f_unpack
    LINK
    JMP R0
    NOP
    MOV R7, R10                ; sign
    LSI R10, 0                 ; flags
    CMP R11, 0
    JNZ f2i_exp_ok
    NOP
    CMP R0, R0
    JZ f2i_zero
    NOP
f2i_exp_ok:
    LSI R6, 15
    SL R6, 4
    ADD R6, 15                 ; 255
    CMP R11, R6
    JZ f2i_special
    NOP
    LSI R6, 8
    SL R6, 4
    SUB R6, 1                  ; 127
    SUB R11, R6                ; u = exp - 127
    CMP R11, 0
    JN f2i_zero
    NOP
    LSI R6, 15
    CMP R11, R6
    JNC f2i_clamp
    NOP
    ; 0 <= u <= 14: V = mant[23:8], then shift right 15-u
    MOV R6, R0
    SL R6, 8
    MOV R0, R1
    SR R0, 8
    OR R6, R0
    LSI R0, 15
    SUB R0, R11
    MOV R11, R0                ; count = 15-u
f2i_shift:
    CMP R11, 0
    JZ f2i_apply_sign
    NOP
    SR R6, 1
    SUB R11, 1
    CMP R0, R0
    JZ f2i_shift
    NOP
f2i_apply_sign:
    CMP R7, 0
    JZ f2i_store
    NOP
    LDI 0
    SUB R0, R6
    MOV R6, R0
f2i_store:
    MOV R0, R6
    CMP R0, 0
    JNZ f2i_set_n
    NOP
    OR R10, 1                  ; Z
    CMP R0, R0
    JZ f2i_ret
    NOP
f2i_set_n:
    MOV R6, R0
    SR R6, 15
    CMP R6, 0
    JZ f2i_ret
    NOP
    OR R10, 0                  ; N
    CMP R0, R0
    JZ f2i_ret
    NOP

f2i_zero:
    LSI R0, 0
    OR R10, 1                  ; Z
    CMP R0, R0
    JZ f2i_ret
    NOP

f2i_special:
    LSI R6, 8
    SL R6, 4                   ; 0x80
    CMP R0, R6
    JNZ f2i_nan
    NOP
    CMP R1, 0
    JNZ f2i_nan
    NOP
    CMP R0, R0
    JZ f2i_clamp
    NOP
f2i_nan:
    LSI R0, 0
    OR R10, 1                  ; Z
    OR R10, 2                  ; V
    CMP R0, R0
    JZ f2i_ret
    NOP

f2i_clamp:
    CMP R7, 0
    JZ f2i_clamp_pos
    NOP
    LSI R6, 15
    CMP R11, R6
    JNZ f2i_clamp_neg
    NOP
    LSI R6, 8
    SL R6, 4
    CMP R0, R6
    JNZ f2i_clamp_neg
    NOP
    CMP R1, 0
    JNZ f2i_clamp_neg
    NOP
    ; exact -32768.0
    LSI R0, 1
    SL R0, 15
    OR R10, 0                  ; N
    CMP R0, R0
    JZ f2i_ret
    NOP
f2i_clamp_neg:
    LSI R0, 1
    SL R0, 15                  ; -32768
    OR R10, 0                  ; N
    OR R10, 2                  ; V
    CMP R0, R0
    JZ f2i_ret
    NOP
f2i_clamp_pos:
    LDI 0
    SUB R0, 1
    SR R0, 1                   ; 32767
    OR R10, 2                  ; V
    CMP R0, R0
    JZ f2i_ret
    NOP
f2i_ret:
    MOV LR, R12
    JMP LR
    NOP

; ---- fadd32 / fsub32 ---------------------------------------------------
; A in R6:R7, B in R8:R9, result in R6:R7.
; Truncation policy: addition discards the aligned tail. Subtraction with
; d < 24 aligns A left and subtracts exactly, so the guard bits survive
; normalisation; d >= 24 uses the previous-float shortcut.
; Clobbers R0..R12; preserves R13, R14 (restored), R15.
fsub32:
    XOR R8, 15                 ; flip B's sign
    LDI fadd32
    JMP R0
    NOP

fadd32:
    MOV R12, LR                ; save the public return address
    ; ---- unpack A ----
    LDI f_unpack
    MOV R11, R0
    LINK
    JMP R11
    NOP
    MOV R2, R10                ; signA
    MOV R3, R11                ; expA
    MOV R4, R0                 ; mantA high
    MOV R5, R1                 ; mantA low
    ; ---- unpack B ----
    MOV R6, R8
    MOV R7, R9
    LDI f_unpack
    MOV R11, R0
    LINK
    JMP R11
    NOP
    MOV R8, R10                ; signB
    MOV R9, R11                ; expB
    ; ---- special exponents ----
    MOV R6, R0
    MOV R7, R1
    LDI 255
    MOV R11, R0
    MOV R0, R6
    MOV R1, R7
    CMP R3, R11
    JZ fadd_special_a
    NOP
    CMP R9, R11
    JZ fadd_special_b
    NOP
    CMP R0, R0
    JZ fadd_finite
    NOP

fadd_special_a:
    LSI R6, 8
    SL R6, 4                   ; 0x80
    CMP R4, R6
    JNZ fadd_nan
    NOP
    CMP R5, 0
    JNZ fadd_nan
    NOP
    CMP R9, R11
    JNZ fadd_ret_a_inf
    NOP
    CMP R0, R6
    JNZ fadd_nan
    NOP
    CMP R1, 0
    JNZ fadd_nan
    NOP
    CMP R2, R8
    JZ fadd_ret_a_inf
    NOP
    CMP R0, R0
    JZ fadd_nan
    NOP

fadd_special_b:
    LSI R6, 8
    SL R6, 4                   ; 0x80
    CMP R0, R6
    JNZ fadd_nan
    NOP
    CMP R1, 0
    JNZ fadd_nan
    NOP
    CMP R0, R0
    JZ fadd_ret_b_inf
    NOP

fadd_ret_a_inf:
    MOV R10, R2
    LDI f_pack
    MOV R7, R0
    LSI R0, 8
    SL R0, 4                   ; 0x80
    LSI R1, 0
    LINK
    JMP R7
    NOP
    LDI fadd_ret
    JMP R0
    NOP

fadd_ret_b_inf:
    MOV R10, R8
    LDI f_pack
    MOV R7, R0
    LSI R0, 8
    SL R0, 4
    LSI R1, 0
    LINK
    JMP R7
    NOP
    LDI fadd_ret
    JMP R0
    NOP

fadd_nan:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0xC0
    OR R6, R0
    LSI R7, 0
    LDI fadd_ret
    JMP R0
    NOP

fadd_finite:
    ; ---- zero operands ----
    CMP R4, 0
    JNZ fadd_a_nonzero
    NOP
    CMP R5, 0
    JNZ fadd_a_nonzero
    NOP
    CMP R0, 0
    JNZ fadd_pack_b
    NOP
    CMP R1, 0
    JNZ fadd_pack_b
    NOP
    LDI fadd_zero              ; +0 + +0 (and the -0 convention)
    JMP R0
    NOP
fadd_pack_b:
    MOV R10, R8
    MOV R11, R9
    MOV R6, R0                 ; keep mantB high across the LDI
    LDI f_pack
    MOV R7, R0
    MOV R0, R6
    LINK
    JMP R7
    NOP
    LDI fadd_ret
    JMP R0
    NOP
fadd_a_nonzero:
    CMP R0, 0
    JNZ fadd_order
    NOP
    CMP R1, 0
    JNZ fadd_order
    NOP
    ; B is zero -> pack A
    MOV R10, R2
    MOV R11, R3
    LDI f_pack
    MOV R7, R0
    MOV R0, R4
    MOV R1, R5
    LINK
    JMP R7
    NOP
    LDI fadd_ret
    JMP R0
    NOP

fadd_order:
    ; make expA >= expB
    CMP R3, R9
    JNC fadd_ordered
    NOP
    MOV R6, R2
    MOV R2, R8
    MOV R8, R6                 ; signs
    MOV R6, R3
    MOV R3, R9
    MOV R9, R6                 ; exponents
    MOV R6, R4
    MOV R4, R0
    MOV R0, R6
    MOV R6, R5
    MOV R5, R1
    MOV R1, R6                 ; mantissas
fadd_ordered:
    MOV R10, R3
    SUB R10, R9                ; d = expA - expB
    ; Opposite signs:
    ;   d >= 24 -> |B| is below one ulp of A, so the result is the previous
    ;              float below |A| (exact, no guard bits needed).
    ;   d < 24  -> align A left to expB and subtract exactly. This keeps the
    ;              guard bits the right-aligned sticky path lost.
    CMP R2, R8
    JZ fadd_align_start
    NOP
    LSI R6, 12
    SL R6, 1                   ; 24
    CMP R10, R6
    JNC fadd_sub_tiny
    NOP
    CMP R0, R0
    JZ fadd_sub_exact
    NOP
fadd_align_start:
    LSI R7, 1
fadd_align:
    CMP R10, 0
    JZ fadd_add
    NOP
    MOV R6, R0
    AND R6, R7
    SL R6, 15
    SR R1, 1
    OR R1, R6
    SR R0, 1
    SUB R10, 1
    CMP R0, R0
    JZ fadd_align
    NOP

fadd_add:
    MOV R6, R5
    ADD R6, R1
    JC fadd_add_carry
    NOP
    MOV R7, R4
    ADD R7, R0
    CMP R0, R0
    JZ fadd_add_store
    NOP
fadd_add_carry:
    MOV R7, R4
    ADD R7, R0
    ADD R7, 1
fadd_add_store:
    MOV R5, R6
    MOV R4, R7
    LDI fadd_normalize
    JMP R0
    NOP

fadd_sub_tiny:
    LSI R6, 8
    SL R6, 4                   ; 0x80
    CMP R4, R6
    JNZ fadd_sub_tiny_dec
    NOP
    CMP R5, 0
    JNZ fadd_sub_tiny_dec
    NOP
    ; A is a power of two: the float below it is exp-1 with an all-ones
    ; significand (e.g. 1 - tiny -> 0x3F7FFFFF).
    SUB R3, 1
    LSI R4, 15
    SL R4, 4
    ADD R4, 15                 ; 0xFF
    LSI R5, 0
    SUB R5, 1                  ; 0xFFFF
    LDI fadd_pack
    JMP R0
    NOP
fadd_sub_tiny_dec:
    MOV R6, R5
    SUB R6, 1
    JC fadd_sub_tiny_borrow
    NOP
    MOV R5, R6
    LDI fadd_pack
    JMP R0
    NOP
fadd_sub_tiny_borrow:
    MOV R5, R6
    MOV R6, R4
    SUB R6, 1
    MOV R4, R6
    LDI fadd_pack
    JMP R0
    NOP

; ---- exact subtraction for d < 24 --------------------------------------
; A and B have opposite signs and expA - expB = d in 0..23. Align A to expB
; (shift left d; the value is up to 47 bits in W2:W1:W0 = R11:R4:R5), subtract
; exactly, then normalise and keep the top 24 bits. This preserves the guard
; bits that a right-aligned sticky subtraction would lose across a
; power-of-two boundary.
fadd_sub_exact:
    LSI R11, 0                 ; W2 = 0
    MOV R6, R10                ; shift count = d
    CMP R6, 0
    JZ fadd_exact_shifted
    NOP
fadd_exact_shift:
    MOV R7, R4
    SR R7, 15
    SL R11, 1
    OR R11, R7                 ; W2 = (W2 << 1) | (W1 >> 15)
    MOV R7, R5
    SR R7, 15
    SL R4, 1
    OR R4, R7                  ; W1 = (W1 << 1) | (W0 >> 15)
    SL R5, 1                   ; W0 <<= 1
    SUB R6, 1
    JNZ fadd_exact_shift
    NOP
fadd_exact_shifted:
    ; compare A' = W2:W1:W0 with B' = 0:R0:R1
    CMP R11, 0
    JNZ fadd_exact_a
    NOP
    CMP R4, R0
    JC fadd_exact_b
    NOP
    JNZ fadd_exact_a
    NOP
    CMP R5, R1
    JC fadd_exact_b
    NOP
fadd_exact_a:
    ; D = A' - B'; result sign remains signA in R2
    MOV R6, R5
    SUB R6, R1
    JC fadd_exact_a_low
    NOP
    MOV R7, R4
    SUB R7, R0
    JC fadd_exact_a_mid
    NOP
    CMP R0, R0
    JZ fadd_exact_norm
    NOP
fadd_exact_a_mid:
    SUB R11, 1
    CMP R0, R0
    JZ fadd_exact_norm
    NOP
fadd_exact_a_low:
    MOV R7, R4
    SUB R7, R0
    JC fadd_exact_a_both
    NOP
    SUB R7, 1
    JC fadd_exact_a_lowcarry
    NOP
    CMP R0, R0
    JZ fadd_exact_norm
    NOP
fadd_exact_a_lowcarry:
    SUB R11, 1
    CMP R0, R0
    JZ fadd_exact_norm
    NOP
fadd_exact_a_both:
    SUB R7, 1
    JC fadd_exact_a_bothcarry
    NOP
    SUB R11, 1
    CMP R0, R0
    JZ fadd_exact_norm
    NOP
fadd_exact_a_bothcarry:
    SUB R11, 2
    CMP R0, R0
    JZ fadd_exact_norm
    NOP

fadd_exact_b:
    MOV R2, R8                 ; result sign follows B
    ; D = B' - A'; the comparison guarantees a positive result below 2^24
    MOV R6, R1
    SUB R6, R5
    JC fadd_exact_b_low
    NOP
    MOV R7, R0
    SUB R7, R4
    LSI R11, 0
    CMP R0, R0
    JZ fadd_exact_norm
    NOP
fadd_exact_b_low:
    MOV R7, R0
    SUB R7, R4
    SUB R7, 1
    LSI R11, 0
    CMP R0, R0
    JZ fadd_exact_norm
    NOP

fadd_exact_norm:
    ; D = R11:R7:R6; zero only on exact cancellation
    CMP R11, 0
    JNZ fadd_exact_nz
    NOP
    CMP R7, 0
    JNZ fadd_exact_nz
    NOP
    CMP R6, 0
    JZ fadd_zero
    NOP
fadd_exact_nz:
    LSI R10, 0                 ; s = 0
fadd_exact_norm_loop:
    MOV R0, R11
    SR R0, 15
    CMP R0, 0
    JNZ fadd_exact_norm_done
    NOP
    MOV R0, R11
    SL R11, 1
    MOV R1, R7
    SR R1, 15
    OR R11, R1
    MOV R1, R6
    SR R1, 15
    SL R7, 1
    OR R7, R1
    SL R6, 1
    ADD R10, 1
    CMP R0, R0
    JZ fadd_exact_norm_loop
    NOP
fadd_exact_norm_done:
    ; significand = D >> 24 = (D2 << 8) | (D1 >> 8)
    MOV R4, R11
    SR R4, 8
    MOV R5, R11
    LSI R0, 15
    SL R0, 4
    ADD R0, 15                 ; 0xFF
    AND R5, R0
    SL R5, 8
    MOV R0, R7
    SR R0, 8
    OR R5, R0
    ; exponent = expB + 24 - s
    MOV R3, R9
    LSI R0, 12
    SL R0, 1                   ; 24
    ADD R3, R0
    SUB R3, R10
    LDI fadd_pack
    JMP R0
    NOP

fadd_zero:
    LSI R6, 0
    LSI R7, 0
    LDI fadd_ret
    JMP R0
    NOP

fadd_normalize:
    ; adding two normals can carry out of bit 23
    LSI R9, 8
    SL R9, 4                   ; mask 0x80 (both paths need it)
    MOV R6, R4
    SR R6, 8
    CMP R6, 0
    JNZ fadd_norm_right
    NOP
fadd_norm_check:
    MOV R6, R4
    AND R6, R9
    CMP R6, 0
    JNZ fadd_pack
    NOP
    CMP R4, 0
    JNZ fadd_norm_left
    NOP
    CMP R5, 0
    JZ fadd_zero
    NOP
fadd_norm_left:
    MOV R6, R5
    SR R6, 15
    SL R4, 1
    OR R4, R6
    SL R5, 1
    SUB R3, 1
    CMP R0, R0
    JZ fadd_norm_check
    NOP
fadd_norm_right:
    MOV R6, R4
    LSI R7, 1
    AND R6, R7
    SL R6, 15
    SR R4, 1
    SR R5, 1
    OR R5, R6
    ADD R3, 1
    CMP R0, R0
    JZ fadd_norm_check
    NOP

fadd_pack:
    MOV R10, R2
    MOV R11, R3
    LDI f_pack
    MOV R7, R0
    MOV R0, R4
    MOV R1, R5
    LINK
    JMP R7
    NOP
fadd_ret:
    MOV LR, R12
    JMP LR
    NOP

; ---- fmul24 ------------------------------------------------------------
; Input:  R4:R5 = A significand, R0:R1 = B significand (24-bit, bit 23 set)
; Output: R4:R5 = normalised 24-bit product significand,
;         R10 = exponent increment (0 or 1)
; The product is truncated toward zero. Clobbers R0..R2, R6..R12;
; preserves R3.
fmul24:
    ; split each 24-bit significand into a 16-bit high and an 8-bit low
    LSI R11, 15
    SL R11, 4
    ADD R11, 15                ; 0xFF
    MOV R6, R4
    SL R6, 8
    MOV R7, R5
    SR R7, 8
    OR R6, R7                  ; aH = bits 23..8
    MOV R7, R5
    AND R7, R11                 ; aL = bits 7..0
    MOV R8, R0
    SL R8, 8
    MOV R9, R1
    SR R9, 8
    OR R8, R9                  ; bH
    MOV R9, R1
    AND R9, R11                 ; bL
    MOV R4, R6
    MUL32 R4, R8               ; P = aH*bH
    MOV R10, R6
    MUL32 R10, R9              ; Q = aH*bL
    MOV R0, R7
    MUL32 R0, R8               ; R = aL*bH
    MOV R6, R7
    MUL32 R6, R9               ; S = aL*bL
    ; C = Q + R (25 bits)
    MOV R8, R11
    ADD R8, R1
    JC fmul24_carry
    NOP
    MOV R9, R10
    ADD R9, R0
    CMP R0, R0
    JZ fmul24_cstore
    NOP
fmul24_carry:
    MOV R9, R10
    ADD R9, R0
    ADD R9, 1
fmul24_cstore:
    MOV R11, R8
    MOV R10, R9                ; C = R10:R11
    ; T_low = ((C & 0xFF) << 8) + S_low
    LSI R9, 15
    SL R9, 4
    ADD R9, 15                 ; 0xFF
    MOV R1, R11
    AND R1, R9                 ; C & 0xFF
    SL R1, 8
    MOV R9, R7
    ADD R1, R9
    JC fmul24_tcarry
    NOP
    LSI R8, 0
    CMP R0, R0
    JZ fmul24_thigh
    NOP
fmul24_tcarry:
    LSI R8, 1
fmul24_thigh:
    ; T_high = (P & 0xFF) + (C_low >> 8) + carry
    LSI R9, 15
    SL R9, 4
    ADD R9, 15                 ; 0xFF
    MOV R1, R5
    AND R1, R9                 ; P & 0xFF
    MOV R0, R11
    SR R0, 8                   ; Cr >> 8
    ADD R1, R0
    ADD R1, R8                 ; T_high
    MOV R8, R1
    SR R8, 8                   ; carry into bit 24 (0/1)
    ; top24 = (P >> 8) + (C >> 16) + carry
    MOV R6, R5
    SR R6, 8
    MOV R7, R4
    SL R7, 8
    OR R6, R7
    MOV R7, R4
    SR R7, 8
    ADD R6, R10
    JC fmul24_topcarry
    NOP
    MOV R9, R8
    ADD R6, R9
    JC fmul24_topcarry2
    NOP
    CMP R0, R0
    JZ fmul24_topdone
    NOP
fmul24_topcarry:
    ADD R7, 1
    MOV R9, R8
    ADD R6, R9
    JC fmul24_topcarry2
    NOP
    CMP R0, R0
    JZ fmul24_topdone
    NOP
fmul24_topcarry2:
    ADD R7, 1
fmul24_topdone:
    ; bit 23 of top24 is bit 7 of R7
    LSI R9, 8
    SL R9, 4                   ; 0x80
    MOV R0, R7
    AND R0, R9
    CMP R0, 0
    JNZ fmul24_norm
    NOP
    ; shift left one; bring in product bit 23 = T_high bit 7
    MOV R0, R1
    SR R0, 7
    LSI R9, 1
    AND R0, R9
    SL R7, 1
    MOV R9, R6
    SR R9, 15
    OR R7, R9
    SL R6, 1
    OR R6, R0
    LSI R10, 0
    CMP R0, R0
    JZ fmul24_out
    NOP
fmul24_norm:
    LSI R10, 1
fmul24_out:
    MOV R4, R7
    MOV R5, R6
    JMP LR
    NOP

; ---- fmul32 ------------------------------------------------------------
; A in R6:R7, B in R8:R9, result in R6:R7.
; Truncating multiply with the same flush/NaN/Inf policy as fadd32.
; Clobbers R0..R12; preserves R13, R14 (restored), R15.
fmul32:
    MOV R12, LR
    ; ---- unpack A ----
    LDI f_unpack
    MOV R11, R0
    LINK
    JMP R11
    NOP
    MOV R2, R10                ; signA
    MOV R3, R11                ; expA
    MOV R4, R0                 ; mantA high
    MOV R5, R1                 ; mantA low
    ; ---- unpack B ----
    MOV R6, R8
    MOV R7, R9
    LDI f_unpack
    MOV R11, R0
    LINK
    JMP R11
    NOP
    MOV R8, R10                ; signB
    MOV R9, R11                ; expB
    ; ---- special exponents ----
    MOV R6, R0
    MOV R7, R1
    LDI 255
    MOV R11, R0
    MOV R0, R6
    MOV R1, R7
    CMP R3, R11
    JZ fmul_special_a
    NOP
    CMP R9, R11
    JZ fmul_special_b
    NOP
    ; ---- finite: sign = signA xor signB ----
    MOV R6, R2
    XOR R6, R8
    MOV R2, R6
    ; exp = expA + expB - 127
    LSI R6, 8
    SL R6, 4
    SUB R6, 1                  ; 127
    ADD R3, R9
    SUB R3, R6
    ; ---- zero operands ----
    CMP R4, 0
    JNZ fmul_check_b
    NOP
    CMP R5, 0
    JNZ fmul_check_b
    NOP
    CMP R0, R0
    JZ fmul_zero
    NOP
fmul_check_b:
    CMP R0, 0
    JNZ fmul_do
    NOP
    CMP R1, 0
    JNZ fmul_do
    NOP
    CMP R0, R0
    JZ fmul_zero
    NOP
fmul_do:
    ; fmul24(A=R4:R5, B=R0:R1) -> R4:R5, exponent increment R10
    MOV R7, R0                 ; keep mantB high across the LDI
    LDI fmul24
    MOV R6, R0
    MOV R0, R7
    LINK
    JMP R6
    NOP
    ADD R3, R10
    CMP R0, R0
    JZ fmul_pack
    NOP

fmul_zero:
    LSI R6, 0
    CMP R2, 0
    JZ fmul_zero_done
    NOP
    OR R6, 15
fmul_zero_done:
    LSI R7, 0
    LDI fmul_ret
    JMP R0
    NOP

fmul_special_a:
    LSI R6, 8
    SL R6, 4                   ; 0x80
    CMP R4, R6
    JNZ fmul_nan
    NOP
    CMP R5, 0
    JNZ fmul_nan
    NOP
    ; A is Inf; Inf * 0 is NaN
    CMP R0, 0
    JNZ fmul_inf
    NOP
    CMP R1, 0
    JZ fmul_nan
    NOP
    CMP R0, R0
    JZ fmul_inf
    NOP

fmul_special_b:
    LSI R6, 8
    SL R6, 4
    CMP R0, R6
    JNZ fmul_nan
    NOP
    CMP R1, 0
    JNZ fmul_nan
    NOP
    ; B is Inf; 0 * Inf is NaN
    CMP R4, 0
    JNZ fmul_inf
    NOP
    CMP R5, 0
    JZ fmul_nan
    NOP
    CMP R0, R0
    JZ fmul_inf
    NOP

fmul_inf:
    MOV R6, R2
    XOR R6, R8
    MOV R2, R6
    LSI R3, 15
    SL R3, 4
    ADD R3, 15                 ; exp = 255
    LSI R0, 8
    SL R0, 4                   ; mant = 0x800000
    LSI R1, 0
    CMP R0, R0
    JZ fmul_pack
    NOP

fmul_nan:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0xC0
    OR R6, R0
    LSI R7, 0
    LDI fmul_ret
    JMP R0
    NOP

fmul_pack:
    MOV R10, R2
    MOV R11, R3
    LDI f_pack
    MOV R7, R0
    MOV R0, R4
    MOV R1, R5
    LINK
    JMP R7
    NOP
fmul_ret:
    MOV LR, R12
    JMP LR
    NOP

; ---- fcmp32 ------------------------------------------------------------
; A in R6:R7, B in R8:R9. Returns flags in R10:
; N = bit 0 (A < B), Z = bit 1 (A == B; +0 == -0), V = bit 2 (unordered,
; either operand is NaN), C = bit 3 (always 0).
; Clobbers R0..R11; preserves R12 (restored), R13, R14, R15.
fcmp32:
    MOV R12, LR
    LDI f_unpack
    LINK
    JMP R0
    NOP
    MOV R2, R10                ; signA
    MOV R3, R11                ; expA
    MOV R4, R0                 ; mantA high
    MOV R5, R1                 ; mantA low
    MOV R6, R8
    MOV R7, R9
    LDI f_unpack
    LINK
    JMP R0
    NOP
    MOV R8, R10                ; signB
    MOV R9, R11                ; expB
    ; mantB R0:R1
    LSI R10, 0                 ; flags
    LSI R6, 15
    SL R6, 4
    ADD R6, 15                 ; 255
    LSI R7, 8
    SL R7, 4                   ; 0x80
    CMP R3, R6
    JNZ fcmp_check_b
    NOP
    CMP R4, R7
    JNZ fcmp_nan
    NOP
    CMP R5, 0
    JNZ fcmp_nan
    NOP
fcmp_check_b:
    CMP R9, R6
    JNZ fcmp_finite
    NOP
    CMP R0, R7
    JNZ fcmp_nan
    NOP
    CMP R1, 0
    JNZ fcmp_nan
    NOP
fcmp_finite:
    CMP R2, R8
    JZ fcmp_same
    NOP
    ; signs differ: both zero is equal, otherwise N = signA
    CMP R4, 0
    JNZ fcmp_diff
    NOP
    CMP R5, 0
    JNZ fcmp_diff
    NOP
    CMP R0, 0
    JNZ fcmp_diff
    NOP
    CMP R1, 0
    JZ fcmp_equal
    NOP
fcmp_diff:
    CMP R2, 0
    JZ fcmp_ret
    NOP
    OR R10, 0                  ; A negative -> A < B
    CMP R0, R0
    JZ fcmp_ret
    NOP
fcmp_same:
    CMP R3, R9
    JC fcmp_mag_b
    NOP
    JNZ fcmp_mag_a
    NOP
    CMP R4, R0
    JC fcmp_mag_b
    NOP
    JNZ fcmp_mag_a
    NOP
    CMP R5, R1
    JC fcmp_mag_b
    NOP
fcmp_equal:
    OR R10, 1
    CMP R0, R0
    JZ fcmp_ret
    NOP
fcmp_mag_a:
    ; |A| > |B|
    CMP R2, 0
    JZ fcmp_ret
    NOP
    OR R10, 0                  ; both negative -> A < B
    CMP R0, R0
    JZ fcmp_ret
    NOP
fcmp_mag_b:
    ; |A| < |B|
    CMP R2, 0
    JNZ fcmp_ret
    NOP
    OR R10, 0                  ; both positive -> A < B
    CMP R0, R0
    JZ fcmp_ret
    NOP
fcmp_nan:
    OR R10, 2                  ; unordered
fcmp_ret:
    MOV LR, R12
    JMP LR
    NOP

; ---- fdiv32 ------------------------------------------------------------
; A in R6:R7, B in R8:R9, result in R6:R7.
; Truncating division. Divide-by-zero returns signed infinity; 0/0 and
; Inf/Inf return the canonical NaN. The quotient significand is produced by
; a 23-step restoring fractional division, so no DIV/DIV32 is used.
fdiv32:
    MOV R12, LR
    ; ---- unpack A ----
    LDI f_unpack
    LINK
    JMP R0
    NOP
    MOV R2, R10                ; signA
    MOV R3, R11                ; expA
    MOV R4, R0                 ; mantA high
    MOV R5, R1                 ; mantA low
    ; ---- unpack B ----
    MOV R6, R8
    MOV R7, R9
    LDI f_unpack
    LINK
    JMP R0
    NOP
    MOV R8, R10                ; signB
    MOV R9, R11                ; expB
    ; mantB in R0:R1
    MOV R6, R2
    XOR R6, R8
    MOV R2, R6                 ; sign = signA xor signB
    LSI R6, 15
    SL R6, 4
    ADD R6, 15                 ; 255
    LSI R7, 8
    SL R7, 4                   ; 0x80
    CMP R3, R6
    JZ fdiv_special_a
    NOP
    CMP R9, R6
    JZ fdiv_special_b
    NOP
fdiv_finite:
    ; B == 0?
    CMP R0, 0
    JNZ fdiv_b_nonzero
    NOP
    CMP R1, 0
    JNZ fdiv_b_nonzero
    NOP
    ; 0/0 -> NaN, finite/0 -> signed infinity
    CMP R4, 0
    JNZ fdiv_inf
    NOP
    CMP R5, 0
    JNZ fdiv_inf
    NOP
    CMP R0, R0
    JZ fdiv_nan
    NOP
fdiv_b_nonzero:
    ; A == 0? -> signed zero
    CMP R4, 0
    JNZ fdiv_do
    NOP
    CMP R5, 0
    JNZ fdiv_do
    NOP
    CMP R0, R0
    JZ fdiv_zero
    NOP

fdiv_special_a:
    CMP R4, R7
    JNZ fdiv_nan
    NOP
    CMP R5, 0
    JNZ fdiv_nan
    NOP
    ; A is Inf: Inf/Inf is NaN, otherwise Inf
    CMP R9, R6
    JNZ fdiv_inf
    NOP
    CMP R0, R7
    JNZ fdiv_nan
    NOP
    CMP R1, 0
    JNZ fdiv_nan
    NOP
    CMP R0, R0
    JZ fdiv_nan
    NOP
fdiv_special_b:
    ; B exp 255: NaN or Inf/finite -> signed zero
    CMP R0, R7
    JNZ fdiv_nan
    NOP
    CMP R1, 0
    JNZ fdiv_nan
    NOP
    CMP R0, R0
    JZ fdiv_zero
    NOP

fdiv_do:
    ; E = expA - expB + 127
    LSI R6, 8
    SL R6, 4
    SUB R6, 1                  ; 127
    SUB R3, R9
    ADD R3, R6
    ; i = (mA >= mB); r0 = mA - i*mB
    CMP R4, R0
    JC fdiv_less
    NOP
    JNZ fdiv_ge
    NOP
    CMP R5, R1
    JC fdiv_less
    NOP
fdiv_ge:
    LSI R8, 1
    MOV R6, R4                 ; mA high
    MOV R4, R5                 ; mA low
    SUB R4, R1                 ; r_low
    JC fdiv_ge_borrow
    NOP
    SUB R6, R0                 ; r_high
    MOV R7, R4
    CMP R0, R0
    JZ fdiv_rem_ready
    NOP
fdiv_ge_borrow:
    SUB R6, 1
    SUB R6, R0
    MOV R7, R4
    CMP R0, R0
    JZ fdiv_rem_ready
    NOP
fdiv_less:
    LSI R8, 0
    MOV R6, R4                 ; r = mA
    MOV R7, R5
fdiv_rem_ready:
    LSI R10, 0                 ; Q high
    LSI R11, 0                 ; Q low
    LSI R9, 15
    ADD R9, 8                  ; 23 fractional bits
fdiv_loop:
    ; r <<= 1 (25 bits)
    MOV R4, R7
    SR R4, 15
    SL R6, 1
    OR R6, R4
    SL R7, 1
    ; compare r with mB
    CMP R6, R0
    JC fdiv_no_sub
    NOP
    JNZ fdiv_sub
    NOP
    CMP R7, R1
    JC fdiv_no_sub
    NOP
fdiv_sub:
    MOV R4, R7
    SUB R4, R1
    JC fdiv_sub_borrow
    NOP
    MOV R5, R6
    SUB R5, R0
    CMP R0, R0
    JZ fdiv_sub_store
    NOP
fdiv_sub_borrow:
    MOV R5, R6
    SUB R5, 1
    SUB R5, R0
fdiv_sub_store:
    MOV R7, R4
    MOV R6, R5
    ; Q = (Q << 1) | 1
    MOV R4, R11
    SR R4, 15
    SL R10, 1
    OR R10, R4
    SL R11, 1
    OR R11, 0
    CMP R0, R0
    JZ fdiv_next
    NOP
fdiv_no_sub:
    MOV R4, R11
    SR R4, 15
    SL R10, 1
    OR R10, R4
    SL R11, 1
fdiv_next:
    SUB R9, 1
    JNZ fdiv_loop
    NOP
    ; add the integer part bit 23
    CMP R8, 0
    JZ fdiv_norm
    NOP
    OR R10, 7
fdiv_norm:
    ; normalise: Q is in [2^22, 2^24)
    LSI R5, 1
    MOV R4, R10
    SR R4, 7
    AND R4, R5
    CMP R4, 0
    JNZ fdiv_pack
    NOP
    MOV R4, R11
    SR R4, 15
    SL R10, 1
    OR R10, R4
    SL R11, 1
    SUB R3, 1
fdiv_pack:
    LDI f_pack
    MOV R7, R0
    MOV R0, R10
    MOV R1, R11
    MOV R10, R2
    MOV R11, R3
    LINK
    JMP R7
    NOP
    LDI fdiv_ret
    JMP R0
    NOP

fdiv_inf:
    LDI f_pack
    MOV R7, R0
    MOV R10, R2
    LSI R11, 15
    SL R11, 4
    ADD R11, 15                ; 255
    LSI R0, 8
    SL R0, 4                   ; 0x80
    LSI R1, 0
    LINK
    JMP R7
    NOP
    LDI fdiv_ret
    JMP R0
    NOP

fdiv_zero:
    LSI R6, 0
    CMP R2, 0
    JZ fdiv_zero_done
    NOP
    OR R6, 15
fdiv_zero_done:
    LSI R7, 0
    LDI fdiv_ret
    JMP R0
    NOP

fdiv_nan:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0xC0
    OR R6, R0
    LSI R7, 0
    LDI fdiv_ret
    JMP R0
    NOP

fdiv_ret:
    MOV LR, R12
    JMP LR
    NOP

; ---- fsqrt32 -----------------------------------------------------------
; A in R6:R7, result in R6:R7. Positive finite input only; negative finite
; and -Inf give the canonical NaN, -0 gives -0, +Inf gives +Inf.
; The 48-bit radicand m'<<23 is reduced by a 24-step digit-by-digit square
; root, producing the 24-bit significand q = floor(sqrt(m')*2^23).
fsqrt32:
    MOV R12, LR
    LDI f_unpack
    LINK
    JMP R0
    NOP
    MOV R2, R10                ; sign
    MOV R3, R11                ; exp
    MOV R4, R0                 ; mant high
    MOV R5, R1                 ; mant low
    LSI R6, 15
    SL R6, 4
    ADD R6, 15                 ; 255
    LSI R7, 8
    SL R7, 4                   ; 0x80
    CMP R3, R6
    JZ fsqrt_special
    NOP
    CMP R4, 0
    JNZ fsqrt_nonzero
    NOP
    CMP R5, 0
    JNZ fsqrt_nonzero
    NOP
    CMP R0, R0
    JZ fsqrt_zero
    NOP
fsqrt_special:
    CMP R4, R7
    JNZ fsqrt_nan
    NOP
    CMP R5, 0
    JNZ fsqrt_nan
    NOP
    CMP R2, 0
    JNZ fsqrt_nan
    NOP
    CMP R0, R0
    JZ fsqrt_inf
    NOP
fsqrt_nonzero:
    CMP R2, 0
    JNZ fsqrt_nan
    NOP
    CMP R0, R0
    JZ fsqrt_do
    NOP

fsqrt_do:
    ; e = exp - 127; m' = m << (e & 1); E = (e - (e&1))/2 + 127
    LSI R0, 8
    SL R0, 4
    SUB R0, 1                  ; 127
    MOV R1, R3
    SUB R1, R0                 ; e
    LSI R0, 1
    MOV R2, R1
    AND R2, R0                 ; e & 1
    CMP R2, 0
    JZ fsqrt_even
    NOP
    MOV R0, R5
    SR R0, 15
    SL R4, 1
    OR R4, R0
    SL R5, 1                   ; m' = 2m
fsqrt_even:
    MOV R3, R1
    SUB R3, R2                 ; e' = e - (e&1)
    SRA R3, 1                  ; e'/2
    LSI R0, 8
    SL R0, 4
    SUB R0, 1
    ADD R3, R0                 ; E
    ; N = m' << 23 in N2:N1:0
    MOV R0, R5
    SL R0, 7                   ; N1
    MOV R1, R5
    SR R1, 9
    MOV R8, R4
    SL R8, 7
    OR R1, R8                  ; N2
    MOV R4, R1
    MOV R5, R0
    LSI R6, 0                  ; rem high
    LSI R7, 0                  ; rem low
    LSI R10, 0                 ; q high
    LSI R11, 0                 ; q low
    LDI 24
    MOV R9, R0                 ; 24 pairs
fsqrt_loop:
    ; pair = N2 >> 14
    MOV R0, R4
    SR R0, 14
    LSI R1, 3
    AND R0, R1
    ; N <<= 2
    MOV R1, R5
    SR R1, 14
    SL R4, 2
    OR R4, R1
    SL R5, 2
    ; rem = (rem << 2) | pair
    MOV R1, R7
    SR R1, 14
    SL R6, 2
    OR R6, R1
    SL R7, 2
    OR R7, R0
    ; trial = (q << 2) | 1, in R1:R0
    MOV R0, R11
    SL R0, 2
    MOV R1, R10
    SL R1, 2
    MOV R8, R11
    SR R8, 14
    OR R1, R8
    OR R0, 0
    ; compare rem with trial
    CMP R6, R1
    JC fsqrt_no_sub
    NOP
    JNZ fsqrt_sub
    NOP
    CMP R7, R0
    JC fsqrt_no_sub
    NOP
fsqrt_sub:
    MOV R8, R7
    SUB R8, R0
    JC fsqrt_borrow
    NOP
    MOV R2, R6
    SUB R2, R1
    CMP R0, R0
    JZ fsqrt_store
    NOP
fsqrt_borrow:
    MOV R2, R6
    SUB R2, 1
    SUB R2, R1
fsqrt_store:
    MOV R7, R8
    MOV R6, R2
    ; q = (q << 1) | 1
    MOV R2, R11
    SR R2, 15
    SL R10, 1
    OR R10, R2
    SL R11, 1
    OR R11, 0
    CMP R0, R0
    JZ fsqrt_next
    NOP
fsqrt_no_sub:
    MOV R2, R11
    SR R2, 15
    SL R10, 1
    OR R10, R2
    SL R11, 1
fsqrt_next:
    SUB R9, 1
    JNZ fsqrt_loop
    NOP
    ; normalise (normally already set)
    LSI R0, 8
    SL R0, 4                   ; 0x80
    MOV R1, R10
    AND R1, R0
    CMP R1, 0
    JNZ fsqrt_pack
    NOP
    MOV R0, R11
    SR R0, 15
    SL R10, 1
    OR R10, R0
    SL R11, 1
    SUB R3, 1
fsqrt_pack:
    LDI f_pack
    MOV R7, R0
    MOV R0, R10
    MOV R1, R11
    LSI R10, 0                 ; sqrt is non-negative
    MOV R11, R3
    LINK
    JMP R7
    NOP
    LDI fsqrt_ret
    JMP R0
    NOP

fsqrt_inf:
    LDI f_pack
    MOV R7, R0
    LSI R10, 0
    LSI R11, 15
    SL R11, 4
    ADD R11, 15                ; 255
    LSI R0, 8
    SL R0, 4                   ; 0x80
    LSI R1, 0
    LINK
    JMP R7
    NOP
    LDI fsqrt_ret
    JMP R0
    NOP

fsqrt_zero:
    LSI R6, 0
    CMP R2, 0
    JZ fsqrt_zero_done
    NOP
    OR R6, 15
fsqrt_zero_done:
    LSI R7, 0
    LDI fsqrt_ret
    JMP R0
    NOP

fsqrt_nan:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0xC0
    OR R6, R0
    LSI R7, 0
    LDI fsqrt_ret
    JMP R0
    NOP

fsqrt_ret:
    MOV LR, R12
    JMP LR
    NOP
