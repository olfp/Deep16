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

; ---- fadd32 / fsub32 ---------------------------------------------------
; A in R6:R7, B in R8:R9, result in R6:R7.
; Truncation policy: the exact sum is truncated toward zero. Alignment keeps
; a sticky bit so subtraction can drop the final ulp when the discarded tail
; is nonzero.
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
    CMP R0, R0
    JZ fadd_zero               ; +0 + +0 (and the -0 convention)
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
    ; Opposite signs with d >= 24: |B| is strictly below one ulp of A, so
    ; the exact result is the previous float below |A|. Handle it before the
    ; alignment loop destroys d. (The d < 24 path keeps a sticky bit; it can
    ; be one ulp low when a small difference renormalises across a power of
    ; two - a recorded prototype limitation.)
    CMP R2, R8
    JZ fadd_align_start
    NOP
    LSI R6, 12
    SL R6, 1                   ; 24
    CMP R10, R6
    JNC fadd_sub_tiny
    NOP
fadd_align_start:
    LSI R11, 0                 ; sticky
    LSI R7, 1
fadd_align:
    CMP R10, 0
    JZ fadd_aligned
    NOP
    MOV R6, R1
    AND R6, R7
    OR R11, R6                 ; sticky |= B low bit
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
fadd_aligned:
    CMP R2, R8
    JZ fadd_add
    NOP
    CMP R0, R0
    JZ fadd_sub
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
    CMP R0, R0
    JZ fadd_normalize
    NOP

fadd_sub:
    ; compare |A| and |B|
    CMP R4, R0
    JC fadd_sub_b_bigger
    NOP
    JNZ fadd_sub_a_bigger
    NOP
    CMP R5, R1
    JC fadd_sub_b_bigger
    NOP
fadd_sub_a_bigger:
    MOV R6, R5
    SUB R6, R1
    JC fadd_sub_a_borrow
    NOP
    MOV R7, R4
    SUB R7, R0
    CMP R0, R0
    JZ fadd_sub_a_store
    NOP
fadd_sub_a_borrow:
    MOV R7, R4
    SUB R7, 1
    SUB R7, R0
fadd_sub_a_store:
    MOV R5, R6
    MOV R4, R7
    CMP R4, 0
    JNZ fadd_sub_a_dec
    NOP
    CMP R5, 0
    JNZ fadd_sub_a_dec
    NOP
    CMP R0, R0
    JZ fadd_zero               ; exact difference was only the discarded tail
    NOP
fadd_sub_a_dec:
    CMP R11, 0
    JZ fadd_normalize
    NOP
    MOV R6, R5
    SUB R6, 1
    JC fadd_sub_a_dec_borrow
    NOP
    MOV R5, R6
    CMP R0, R0
    JZ fadd_normalize
    NOP
fadd_sub_a_dec_borrow:
    MOV R5, R6
    MOV R6, R4
    SUB R6, 1
    MOV R4, R6
    CMP R0, R0
    JZ fadd_normalize
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
    CMP R0, R0
    JZ fadd_pack
    NOP
fadd_sub_tiny_dec:
    MOV R6, R5
    SUB R6, 1
    JC fadd_sub_tiny_borrow
    NOP
    MOV R5, R6
    CMP R0, R0
    JZ fadd_pack
    NOP
fadd_sub_tiny_borrow:
    MOV R5, R6
    MOV R6, R4
    SUB R6, 1
    MOV R4, R6
    CMP R0, R0
    JZ fadd_pack
    NOP

fadd_sub_b_bigger:
    MOV R2, R8                 ; result sign follows B
    MOV R6, R1
    SUB R6, R5
    JC fadd_sub_b_borrow
    NOP
    MOV R7, R0
    SUB R7, R4
    CMP R0, R0
    JZ fadd_sub_b_store
    NOP
fadd_sub_b_borrow:
    MOV R7, R0
    SUB R7, 1
    SUB R7, R4
fadd_sub_b_store:
    MOV R5, R6
    MOV R4, R7
    CMP R0, R0
    JZ fadd_normalize
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
