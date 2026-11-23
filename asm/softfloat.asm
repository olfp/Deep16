; asm/softfloat.asm - Deep16 soft-float library (prototype, P3)
;
; Standalone use: include it after the caller's .org. In a kernel image,
; FPU_KERNEL places it at 0x5800, above the D16D BIOS/demo data. The D16D
; flash loader copies 0x4A00..0x5FFF into the BIOS segment, so the library
; lands at CS=0x3000 offset 0x0E00 and the ILL handler can call it there.
; Every internal call and tail jump is PC-relative, so the same words run at
; either origin (the flat image or the BIOS copy).
;
; ABI (FPUEMUPLAN.md section 7.1, FLOATIMPL.md section 2):
;   F0 = R2:R3 (high:low), F1 = R4:R5
;   layer-2 arithmetic takes A in R6:R7 and B in R8:R9, result in R6:R7
;   routines return with JMP LR and do not use the stack or DIV
;
; Numeric policy (FPUEMUPLAN.md section 8):
;   - denormals flush to signed zero on input and output
;   - one canonical quiet NaN, 0x7FC00000
;   - round to nearest, ties to even
;   - infinities are generated and consumed
;   - no overflow/underflow exception flags
;
; A pair is the MUL32 layout: high word first. R6 = sign|exp|mant[22:16],
; R7 = mant[15:0]. An unpacked mantissa is R0 = bits 23..16 (low 8 bits used),
; R1 = bits 15..0, with bit 23 = 1 for a normal number.

.ifdef FPU_KERNEL
; The flat origin. In the D16D image the BIOS copy carries the same words at
; CS=0x3000 offset 0x0E00; the PC-relative calls do not care which copy runs.
.org 0x5800
.endif

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
    CMP R0, R0
    JZ i2f_abs
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
    MOV R11, PC
fpu_call_1:
    LDI f_unpack - fpu_call_1
    ADD R11, R0
    LINK
    JMP R11
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

; ---- f_round -----------------------------------------------------------
; Round a normalised 24-bit significand to nearest, ties to even.
; Input: R4:R5 = significand (bit 23 set), R3 = biased exponent,
;        R6 = guard bit, R7 = sticky bit (0/1).
; Output: R4:R5 and R3 adjusted. Clobbers R0, R1, R6, R7, R9.
; Preserves R2, R8, R10, R11, R12.
f_round:
    CMP R6, 0
    JZ f_round_done
    NOP
    CMP R7, 0
    JNZ f_round_up
    NOP
    MOV R0, R5
    LSI R1, 1
    AND R0, R1
    CMP R0, 0
    JZ f_round_done
    NOP
f_round_up:
    ADD R5, 1
    JC f_round_carry
    NOP
    CMP R0, R0
    JZ f_round_done
    NOP
f_round_carry:
    ADD R4, 1
    LDI 0x100
    MOV R9, R0
    CMP R4, R9
    JNZ f_round_done
    NOP
    LDI 0x80
    MOV R4, R0
    LSI R5, 0
    ADD R3, 1
f_round_done:
    JMP LR
    NOP

; ---- fadd32 / fsub32 ---------------------------------------------------
; A in R6:R7, B in R8:R9, result in R6:R7.
; Round to nearest, ties to even. Addition aligns B right and keeps the
; shifted-out bits as guard/sticky. Subtraction with d < 24 aligns A left
; and subtracts exactly; d >= 24 compares the remainder against half an ulp,
; including the half-sized step below a power of two.
; Clobbers R0..R12; preserves R13, R14 (restored), R15.
fsub32:
    XOR R8, 15                 ; flip B's sign
    CMP R0, R0
    JZ fadd32
    NOP

fadd32:
    MOV R12, LR                ; save the public return address
    ; ---- unpack A ----
    MOV R11, PC
fpu_pc_0:
    LDI f_unpack - fpu_pc_0
    ADD R11, R0
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
    MOV R11, PC
fpu_pc_1:
    LDI f_unpack - fpu_pc_1
    ADD R11, R0
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
    MOV R7, PC
fpu_pc_2:
    LDI f_pack - fpu_pc_2
    ADD R7, R0
    LSI R0, 8
    SL R0, 4                   ; 0x80
    LSI R1, 0
    LINK
    JMP R7
    NOP
    MOV R4, PC
fadd_ret_jmp_1:
    LDI fadd_ret - fadd_ret_jmp_1
    ADD R4, R0
    MOV PC, R4
    NOP

fadd_ret_b_inf:
    MOV R10, R8
    MOV R7, PC
fpu_pc_3:
    LDI f_pack - fpu_pc_3
    ADD R7, R0
    LSI R0, 8
    SL R0, 4
    LSI R1, 0
    LINK
    JMP R7
    NOP
    MOV R4, PC
fadd_ret_jmp_2:
    LDI fadd_ret - fadd_ret_jmp_2
    ADD R4, R0
    MOV PC, R4
    NOP

fadd_nan:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0xC0
    OR R6, R0
    LSI R7, 0
    MOV R4, PC
fadd_ret_jmp_3:
    LDI fadd_ret - fadd_ret_jmp_3
    ADD R4, R0
    MOV PC, R4
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
    MOV R4, PC
fadd_zero_jmp:
    LDI fadd_zero - fadd_zero_jmp
    ADD R4, R0
    MOV PC, R4
    NOP
fadd_pack_b:
    MOV R10, R8
    MOV R11, R9
    MOV R6, R0                 ; keep mantB high across the LDI
    MOV R7, PC
fpu_pc_4:
    LDI f_pack - fpu_pc_4
    ADD R7, R0
    MOV R0, R6
    LINK
    JMP R7
    NOP
    MOV R4, PC
fadd_ret_jmp_4:
    LDI fadd_ret - fadd_ret_jmp_4
    ADD R4, R0
    MOV PC, R4
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
    MOV R7, PC
fpu_pc_5:
    LDI f_pack - fpu_pc_5
    ADD R7, R0
    MOV R0, R4
    MOV R1, R5
    LINK
    JMP R7
    NOP
    MOV R4, PC
fadd_ret_jmp_5:
    LDI fadd_ret - fadd_ret_jmp_5
    ADD R4, R0
    MOV PC, R4
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
    LSI R11, 0                 ; bit1 guard, bit2 sticky
fadd_align:
    CMP R10, 0
    JZ fadd_add
    NOP
    MOV R6, R1
    AND R6, R7                 ; bit shifted out of B
    CMP R10, 1
    JZ fadd_align_guard
    NOP
    MOV R9, R6
    SL R9, 2
    OR R11, R9                 ; sticky |= out
    CMP R0, R0
    JZ fadd_align_shift
    NOP
fadd_align_guard:
    MOV R9, R6
    SL R9, 1
    OR R11, R9                 ; the last bit out is the guard
fadd_align_shift:
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
    CMP R0, R0
    JZ fadd_add_jump_norm
    NOP

fadd_add_jump_norm:
    MOV R9, PC
fadd_add_jump_norm_l:
    LDI fadd_normalize - fadd_add_jump_norm_l
    ADD R9, R0
    MOV PC, R9
    NOP

fadd_sub_tiny:
    ; d >= 24: |B| is below one ulp of A. Round A - |B| to nearest, ties to
    ; even, in units of A's LSB. A power of two has a half-sized step just
    ; below it, so its boundary uses 2t on the finer grid.
    LSI R6, 8
    SL R6, 4                   ; 0x80
    CMP R4, R6
    JNZ fadd_tiny_normal
    NOP
    CMP R5, 0
    JNZ fadd_tiny_normal
    NOP
    ; ---- A is a power of two ----
    LSI R6, 12
    SL R6, 1                   ; 24
    CMP R10, R6
    JNZ fadd_tiny_pow2_d25
    NOP
    ; d == 24: 2t in [1, 2). 2t >= 1.5 rounds two steps below A.
    LSI R6, 12
    SL R6, 4                   ; 0xC0
    CMP R0, R6
    JC fadd_tiny_pow2_prev
    NOP
    CMP R0, R0
    JZ fadd_tiny_pow2_prev2
    NOP
fadd_tiny_pow2_d25:
    LSI R6, 12
    SL R6, 1
    ADD R6, 1                  ; 25
    CMP R10, R6
    JNZ fadd_tiny_pow2_a       ; d >= 26 always rounds to A
    NOP
    ; d == 25: 2t in [0.5, 1). Only t > 0.5 rounds to prevfloat; the tie at
    ; 0.5 goes to A.
    LSI R6, 8
    SL R6, 4                   ; 0x80
    CMP R0, R6
    JC fadd_tiny_pow2_a
    JNZ fadd_tiny_pow2_prev
    NOP
    CMP R1, 0
    JNZ fadd_tiny_pow2_prev
    NOP
fadd_tiny_pow2_a:
    CMP R0, R0
    JZ fadd_tiny_far_pack
    NOP
fadd_tiny_pow2_prev:
    ; prevfloat(A) = exponent-1, significand 0xFFFFFF
    SUB R3, 1
    LSI R4, 15
    SL R4, 4
    ADD R4, 15                 ; 0xFF
    LSI R5, 0
    SUB R5, 1                  ; 0xFFFF
    CMP R0, R0
    JZ fadd_tiny_far_pack
    NOP
fadd_tiny_pow2_prev2:
    ; one step below prevfloat(A): exponent-1, significand 0xFFFFFE
    SUB R3, 1
    LSI R4, 15
    SL R4, 4
    ADD R4, 15                 ; 0xFF
    LSI R5, 0
    SUB R5, 2                  ; 0xFFFE
    CMP R0, R0
    JZ fadd_tiny_far_pack
    NOP

fadd_tiny_far_pack:
    MOV R11, PC
fadd_tiny_far_pack_l:
    LDI fadd_pack - fadd_tiny_far_pack_l
    ADD R11, R0
    MOV PC, R11
    NOP

fadd_tiny_normal:
    ; ---- A is not a power of two ----
    LSI R6, 12
    SL R6, 1                   ; 24
    CMP R10, R6
    JNZ fadd_tiny_a            ; d > 24 -> |B| < half an ulp
    NOP
    ; d == 24: t in [0.5, 1). t > 0.5 rounds to prevfloat; t == 0.5 is a
    ; tie, won by the even significand.
    LSI R6, 8
    SL R6, 4                   ; 0x80
    CMP R0, R6
    JNZ fadd_tiny_prev         ; mantB > 0x800000
    NOP
    CMP R1, 0
    JNZ fadd_tiny_prev
    NOP
    MOV R6, R5
    LSI R7, 1
    AND R6, R7
    CMP R6, 0
    JZ fadd_pack               ; A is even
    NOP
fadd_tiny_prev:
    MOV R6, R5
    SUB R6, 1
    JC fadd_tiny_prev_borrow
    NOP
    MOV R5, R6
    CMP R0, R0
    JZ fadd_pack
    NOP
fadd_tiny_prev_borrow:
    MOV R5, R6
    MOV R6, R4
    SUB R6, 1
    MOV R4, R6
    CMP R0, R0
    JZ fadd_pack
    NOP
fadd_tiny_a:
    CMP R0, R0
    JZ fadd_pack
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
    ; guard/sticky from the discarded low 24 bits of D = W2:W1:W0,
    ; still in R7:R6 after the shift loop.
    MOV R8, R6                 ; D0
    MOV R1, R7                 ; D1
    MOV R6, R1
    SR R6, 7
    LSI R9, 1
    AND R6, R9                 ; guard = D bit 23
    LDI 0x7F
    MOV R9, R0                 ; mask
    AND R1, R9
    OR R1, R8                  ; remaining discarded bits
    CMP R1, 0
    JZ fadd_exact_sticky0
    NOP
    LSI R7, 1
    CMP R0, R0
    JZ fadd_exact_sticky
    NOP
fadd_exact_sticky0:
    LSI R7, 0
fadd_exact_sticky:
    CMP R0, R0
    JZ fadd_round_pack
    NOP

fadd_zero:
    LSI R6, 0
    LSI R7, 0
    MOV R4, PC
fadd_ret_jmp_6:
    LDI fadd_ret - fadd_ret_jmp_6
    ADD R4, R0
    MOV PC, R4
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
    JNZ fadd_add_pack
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
    ; The sum carried into bit 24. After the shift the sum's old LSB is the
    ; guard and the old guard joins sticky.
    LSI R7, 1
    MOV R6, R5
    AND R6, R7                 ; new guard
    MOV R0, R11
    LSI R1, 6
    AND R0, R1                 ; old guard/sticky (R9 is the norm mask)
    CMP R0, 0
    JZ fadd_nr_nosticky
    NOP
    LSI R0, 4
    CMP R0, R0
    JZ fadd_nr_sticky
    NOP
fadd_nr_nosticky:
    LSI R0, 0
fadd_nr_sticky:
    SL R6, 1
    OR R6, R0
    MOV R11, R6
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

fadd_add_pack:
    MOV R6, R11
    SR R6, 1
    LSI R7, 1
    AND R6, R7                 ; guard
    MOV R7, R11
    SR R7, 2
    LSI R0, 1
    AND R7, R0                 ; sticky
fadd_round_pack:
    MOV R11, PC
fpu_round_add:
    LDI f_round - fpu_round_add
    ADD R11, R0
    LINK
    JMP R11
    NOP

fadd_pack:
    MOV R10, R2
    MOV R11, R3
    MOV R7, PC
fpu_pc_6:
    LDI f_pack - fpu_pc_6
    ADD R7, R0
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
; R4:R5 is the truncated 24-bit product; R6/R7 carry the guard and sticky
; bits for the caller's f_round call. Uses R2 for the rounding bits, so the
; caller saves the sign. Clobbers R0..R2, R6..R12; preserves R3.
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
    MOV R2, R1                 ; keep T_low
    CMP R0, R0
    JZ fmul24_thigh
    NOP
fmul24_tcarry:
    LSI R8, 1
    MOV R2, R1                 ; keep T_low
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
    ; The rounding bits are taken after normalisation, from T_high (R1) and
    ; T_low (R2); both survive the top24 assembly below.
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
    ; The shift moved product bit 23 into the significand, so the rounding
    ; point is one place lower: guard = T_high bit 6, sticky = bits 5..0 or
    ; T_low.
    MOV R4, R7
    MOV R5, R6
    MOV R6, R1
    SR R6, 6
    LSI R7, 1
    AND R6, R7                 ; guard
    MOV R7, R1
    LDI 0x3F
    AND R7, R0
    OR R7, R2                  ; remaining discarded bits
    CMP R7, 0
    JZ fmul24_out
    NOP
    LSI R7, 1
    CMP R0, R0
    JZ fmul24_out
    NOP
fmul24_norm:
    LSI R10, 1
    MOV R4, R7
    MOV R5, R6
    MOV R6, R1
    SR R6, 7
    LSI R7, 1
    AND R6, R7                 ; guard
    MOV R7, R1
    LDI 0x7F
    AND R7, R0
    OR R7, R2                  ; remaining discarded bits
    CMP R7, 0
    JZ fmul24_out
    NOP
    LSI R7, 1
fmul24_out:
    JMP LR
    NOP

; ---- fmul32 ------------------------------------------------------------
; A in R6:R7, B in R8:R9, result in R6:R7.
; Nearest-even multiply with the same flush/NaN/Inf policy as fadd32.
; Clobbers R0..R12; preserves R13, R14 (restored), R15.
fmul32:
    MOV R12, LR
    ; ---- unpack A ----
    MOV R11, PC
fpu_pc_7:
    LDI f_unpack - fpu_pc_7
    ADD R11, R0
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
    MOV R11, PC
fpu_pc_8:
    LDI f_unpack - fpu_pc_8
    ADD R11, R0
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
    ; fmul24(A=R4:R5, B=R0:R1) -> R4:R5, exponent increment R10,
    ; guard/sticky in R6/R7. fmul24 uses R2 for the rounding bits, so park
    ; the sign on the stack for the call.
    SUB SP, 1
    ST R2, SP, 0
    MOV R7, R0                 ; keep mantB high across the LDI
    MOV R6, PC
fpu_pc_9:
    LDI fmul24 - fpu_pc_9
    ADD R6, R0
    MOV R0, R7
    LINK
    JMP R6
    NOP
    LD R2, SP, 0
    ADD SP, 1
    ADD R3, R10
    MOV R11, PC
fpu_round_mul:
    LDI f_round - fpu_round_mul
    ADD R11, R0
    LINK
    JMP R11
    NOP
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
    CMP R0, R0
    JZ fmul_ret
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
    CMP R0, R0
    JZ fmul_ret
    NOP

fmul_pack:
    MOV R10, R2
    MOV R11, R3
    MOV R7, PC
fpu_pc_10:
    LDI f_pack - fpu_pc_10
    ADD R7, R0
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
    MOV R11, PC
fpu_call_2:
    LDI f_unpack - fpu_call_2
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R2, R10                ; signA
    MOV R3, R11                ; expA
    MOV R4, R0                 ; mantA high
    MOV R5, R1                 ; mantA low
    MOV R6, R8
    MOV R7, R9
    MOV R11, PC
fpu_call_3:
    LDI f_unpack - fpu_call_3
    ADD R11, R0
    LINK
    JMP R11
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
; Nearest-even division. Divide-by-zero returns signed infinity; 0/0 and
; Inf/Inf return the canonical NaN. The quotient significand is produced by
; a 24-step restoring fractional division, then rounded from the remainder,
; so no DIV/DIV32 is used.
fdiv32:
    MOV R12, LR
    ; ---- unpack A ----
    MOV R11, PC
fpu_call_4:
    LDI f_unpack - fpu_call_4
    ADD R11, R0
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
    MOV R11, PC
fpu_call_5:
    LDI f_unpack - fpu_call_5
    ADD R11, R0
    LINK
    JMP R11
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
    ADD R9, 9                  ; 24 fractional bits, then round
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
    ; insert the integer part at bit 24; Q now holds 24 fractional bits
    CMP R8, 0
    JZ fdiv_round
    NOP
    OR R10, 8
fdiv_round:
    ; Q24 = floor(x*2^24), remainder r in R6:R7, E in R3.
    MOV R4, R10
    SR R4, 8
    CMP R4, 0
    JNZ fdiv_round_hi
    NOP
    ; ---- Q24 < 2^24: exponent E-1, significand Q24 ----
    SUB R3, 1
    ; 2r in R6:R7
    MOV R4, R7
    SR R4, 15
    SL R6, 1
    OR R6, R4
    SL R7, 1
    ; guard/sticky = 2r against mB
    CMP R6, R0
    JC fdiv_round_lo_lt
    NOP
    JNZ fdiv_round_lo_gt
    NOP
    CMP R7, R1
    JC fdiv_round_lo_lt
    NOP
    JZ fdiv_round_lo_tie
    NOP
fdiv_round_lo_gt:
    LSI R6, 1
    LSI R7, 1
    CMP R0, R0
    JZ fdiv_round_call
    NOP
fdiv_round_lo_tie:
    LSI R6, 1
    LSI R7, 0
    CMP R0, R0
    JZ fdiv_round_call
    NOP
fdiv_round_lo_lt:
    LSI R6, 0
    LSI R7, 0
    CMP R0, R0
    JZ fdiv_round_call
    NOP
fdiv_round_hi:
    ; ---- Q24 >= 2^24: exponent E, significand Q24 >> 1 ----
    LSI R5, 1
    MOV R8, R11
    AND R8, R5                 ; guard = Q24 bit 0
    CMP R6, 0
    JNZ fdiv_round_hi_sticky
    NOP
    CMP R7, 0
    JNZ fdiv_round_hi_sticky
    NOP
    LSI R7, 0
    CMP R0, R0
    JZ fdiv_round_hi_shift
    NOP
fdiv_round_hi_sticky:
    LSI R7, 1
fdiv_round_hi_shift:
    LSI R5, 1
    MOV R4, R10
    AND R4, R5
    SL R4, 15
    SR R10, 1
    SR R11, 1
    OR R11, R4
    MOV R6, R8
fdiv_round_call:
    MOV R4, R10
    MOV R5, R11
    MOV R11, PC
fpu_round_div:
    LDI f_round - fpu_round_div
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R0, R4
    MOV R1, R5
fdiv_pack:
    MOV R7, PC
fpu_pc_11:
    LDI f_pack - fpu_pc_11
    ADD R7, R0
    MOV R0, R4
    MOV R1, R5
    MOV R10, R2
    MOV R11, R3
    LINK
    JMP R7
    NOP
    CMP R0, R0
    JZ fdiv_ret
    NOP

fdiv_inf:
    MOV R7, PC
fpu_pc_12:
    LDI f_pack - fpu_pc_12
    ADD R7, R0
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
    CMP R0, R0
    JZ fdiv_ret
    NOP

fdiv_zero:
    LSI R6, 0
    CMP R2, 0
    JZ fdiv_zero_done
    NOP
    OR R6, 15
fdiv_zero_done:
    LSI R7, 0
    CMP R0, R0
    JZ fdiv_ret
    NOP

fdiv_nan:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0xC0
    OR R6, R0
    LSI R7, 0
    CMP R0, R0
    JZ fdiv_ret
    NOP

fdiv_ret:
    MOV LR, R12
    JMP LR
    NOP

; ---- fsqrt32 -----------------------------------------------------------
; A in R6:R7, result in R6:R7. Positive finite input only; negative finite
; and -Inf give the canonical NaN, -0 gives -0, +Inf gives +Inf.
; The 48-bit radicand m'<<23 is reduced by a 24-step digit-by-digit square
; root, producing q = floor(sqrt(m'*2^23)); the remainder is compared with
; q+1 to round to nearest (a half-integer root is impossible).
fsqrt32:
    MOV R12, LR
    MOV R11, PC
fpu_call_6:
    LDI f_unpack - fpu_call_6
    ADD R11, R0
    LINK
    JMP R11
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
    ; q has bit 23 set; rem = N - q^2. Round up when rem >= q+1,
    ; since sqrt(N) is above q by more than half. A half-integer sqrt
    ; would need N = q^2+q+1/4, which is not an integer, so ties never
    ; occur and sticky equals the guard.
    MOV R4, R10
    MOV R5, R11
    ADD R5, 1
    JC fsqrt_q1_carry
    NOP
    CMP R0, R0
    JZ fsqrt_compare
    NOP
fsqrt_q1_carry:
    ADD R4, 1
fsqrt_compare:
    CMP R6, R4
    JC fsqrt_no_round
    NOP
    JNZ fsqrt_round
    NOP
    CMP R7, R5
    JC fsqrt_no_round
    NOP
fsqrt_round:
    LSI R6, 1
    LSI R7, 1
    CMP R0, R0
    JZ fsqrt_round_call
    NOP
fsqrt_no_round:
    LSI R6, 0
    LSI R7, 0
fsqrt_round_call:
    MOV R4, R10
    MOV R5, R11
    MOV R11, PC
fpu_round_sqrt:
    LDI f_round - fpu_round_sqrt
    ADD R11, R0
    LINK
    JMP R11
    NOP
fsqrt_pack:
    MOV R7, PC
fpu_pc_13:
    LDI f_pack - fpu_pc_13
    ADD R7, R0
    MOV R0, R4
    MOV R1, R5
    LSI R10, 0                 ; sqrt is non-negative
    MOV R11, R3
    LINK
    JMP R7
    NOP
    CMP R0, R0
    JZ fsqrt_ret
    NOP

fsqrt_inf:
    MOV R7, PC
fpu_pc_14:
    LDI f_pack - fpu_pc_14
    ADD R7, R0
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
    CMP R0, R0
    JZ fsqrt_ret
    NOP

fsqrt_zero:
    LSI R6, 0
    CMP R2, 0
    JZ fsqrt_zero_done
    NOP
    OR R6, 15
fsqrt_zero_done:
    LSI R7, 0
    CMP R0, R0
    JZ fsqrt_ret
    NOP

fsqrt_nan:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0xC0
    OR R6, R0
    LSI R7, 0
    CMP R0, R0
    JZ fsqrt_ret
    NOP

fsqrt_ret:
    MOV LR, R12
    JMP LR
    NOP

; ---- ILL FPU dispatch (kernel build only) ------------------------------
; Entered from the ILL decoder with SP = caller C - 9 (R4..R12 saved),
; R2 = the trapped word, and DS already set for the handler. F0 = R2:R3
; is the caller bank (SMV), F1 = R4:R5 is shared and still live. The result
; is written back to F0; FCMP delivers its flags through SAPF.
.ifdef FPU_KERNEL
ill_fpu:
    MOV R10, R2                 ; opcode
    SMV R6, AR2                 ; A high
    SMV R7, AR3                 ; A low
    MOV R8, R4                  ; B high (F1)
    MOV R9, R5                  ; B low
    LDI -8                      ; 0xFFF8 FADD
    CMP R10, R0
    JZ ill_fpu_add
    NOP
    LDI -7                      ; 0xFFF9 FMUL
    CMP R10, R0
    JZ ill_fpu_mul
    NOP
    LDI -6                      ; 0xFFFA FDIV
    CMP R10, R0
    JZ ill_fpu_div
    NOP
    LDI -5                      ; 0xFFFB FSQRT
    CMP R10, R0
    JZ ill_fpu_sqrt
    NOP
    LDI -2                      ; 0xFFFE FCMP
    CMP R10, R0
    JZ ill_fpu_cmp
    NOP
    LDI -4                      ; 0xFFFC FEXP
    CMP R10, R0
    JZ ill_fpu_exp
    NOP
    LDI -3                      ; 0xFFFD FLOG
    CMP R10, R0
    JZ ill_fpu_log
    NOP
    ; An unknown 0xFFF8..0xFFFE word returns canonical NaN in F0.
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0xC0
    OR R6, R0
    LSI R7, 0
    CMP R0, R0
    JZ ill_fpu_write
    NOP
ill_fpu_add:
    MOV R11, PC
fpu_call_7:
    LDI fadd32 - fpu_call_7
    ADD R11, R0
    LINK
    JMP R11
    NOP
    CMP R0, R0
    JZ ill_fpu_write
    NOP
ill_fpu_mul:
    MOV R11, PC
fpu_call_8:
    LDI fmul32 - fpu_call_8
    ADD R11, R0
    LINK
    JMP R11
    NOP
    CMP R0, R0
    JZ ill_fpu_write
    NOP
ill_fpu_div:
    MOV R11, PC
fpu_call_9:
    LDI fdiv32 - fpu_call_9
    ADD R11, R0
    LINK
    JMP R11
    NOP
    CMP R0, R0
    JZ ill_fpu_write
    NOP
ill_fpu_sqrt:
    MOV R11, PC
fpu_call_10:
    LDI fsqrt32 - fpu_call_10
    ADD R11, R0
    LINK
    JMP R11
    NOP
    CMP R0, R0
    JZ ill_fpu_write
    NOP
ill_fpu_exp:
    MOV R11, PC
fpu_call_12:
    LDI fexp32 - fpu_call_12
    ADD R11, R0
    LINK
    JMP R11
    NOP
    CMP R0, R0
    JZ ill_fpu_write
    NOP
ill_fpu_log:
    MOV R11, PC
fpu_call_13:
    LDI flog32 - fpu_call_13
    ADD R11, R0
    LINK
    JMP R11
    NOP
    CMP R0, R0
    JZ ill_fpu_write
    NOP
ill_fpu_cmp:
    MOV R11, PC
fpu_call_11:
    LDI fcmp32 - fpu_call_11
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R0, R10
    SAPF
    CMP R0, R0
    JZ ill_fpu_restore
    NOP
ill_fpu_write:
    SMV AR2, R6
    SMV AR3, R7
ill_fpu_restore:
    MOV R1, PC
ill_fpu_ret_lr:
    LDI ill_restore_shared - ill_fpu_ret_lr
    ADD R1, R0
    MOV PC, R1
    NOP

; ---- fexp32 / flog32 ---------------------------------------------------
; FEXP/FLOG live above the rest of the library because they are large. The
; flat image carries them at 0x6000 and the D16D loader copies the same words
; to the BIOS segment at offset 0x1600, so every PC-relative call below keeps
; working in both copies.
;
; Both routines use a 16-cell frame on the caller's data stack. The library
; calls preserve SP; LR is saved in cell 0 because f_unpack/f_pack are leaf
; routines that return through LR. Results use the usual R6:R7 pair.
;
; exp: k = round(x / ln2), r = x - k*ln2 with Cody-Waite split constants.
; The degree-7 Horner loop keeps r, p and the coefficients unpacked: each
; term is one fmul24 plus a small exact shift/add and a final f_round. 2^k
; is applied by adding k to the exponent field. log: normalise to m in
; [0.75, 1.5), z = (m-1)/(m+1), and the atanh series through z^9.

.org 0x6000
fexp32:
    SUB SP, 8
    SUB SP, 8
    ST LR, SP, 0
    ST R6, SP, 1               ; x
    ST R7, SP, 2
    MOV R11, PC
fe_u1:
    LDI f_unpack - fe_u1
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R10, SP, 14             ; sign
    ST R11, SP, 15             ; exponent
    ST R0, SP, 10              ; significand high
    ST R1, SP, 11
    LDI 255
    MOV R2, R0
    CMP R11, R2
    JZ fe_special
    NOP
    CMP R11, 0
    JNZ fe_range
    NOP
    ; +-0 -> 1.0
    LDI 0x3F80
    MOV R6, R0
    LSI R7, 0
    CMP R0, R0
    JNZ fe_one_done
    NOP
    MOV R11, PC
fe_j_ret1:
    LDI fe_ret - fe_j_ret1
    ADD R11, R0
    MOV PC, R11
    NOP
fe_one_done:

fe_special:
    LD R1, SP, 11
    LDI 0x80
    MOV R2, R0
    LD R0, SP, 10
    CMP R0, R2
    JNZ fe_nan
    NOP
    CMP R1, 0
    JNZ fe_nan
    NOP
    LD R10, SP, 14
    CMP R10, 0
    JNZ fe_zero
    NOP
    CMP R0, R0
    JZ fe_inf
    NOP

fe_nan:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0xC0
    OR R6, R0
    LSI R7, 0
    MOV R11, PC
fe_j_ret2:
    LDI fe_ret - fe_j_ret2
    ADD R11, R0
    MOV PC, R11
    NOP

fe_zero:
    LSI R6, 0
    LSI R7, 0
    MOV R11, PC
fe_j_ret3:
    LDI fe_ret - fe_j_ret3
    ADD R11, R0
    MOV PC, R11
    NOP

fe_inf:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0x80
    OR R6, R0
    LSI R7, 0
    MOV R11, PC
fe_j_ret4:
    LDI fe_ret - fe_j_ret4
    ADD R11, R0
    MOV PC, R11
    NOP

fe_range:
    ; |x| >= 128 overflows or underflows regardless of the reduction.
    LDI 134
    MOV R2, R0
    LD R11, SP, 15
    CMP R11, R2
    JNC fe_range_big_near
    NOP
    CMP R0, R0
    JZ fe_range_continue
    NOP
fe_range_big_near:
    MOV R11, PC
fe_range_big_near_l:
    LDI fe_range_big - fe_range_big_near_l
    ADD R11, R0
    MOV PC, R11
    NOP
fe_range_continue:
    ; y = x * log2(e)
    LD R6, SP, 1
    LD R7, SP, 2
    LDI 0x3FB8
    MOV R8, R0
    LDI 0xAA
    MOV R9, R0
    SL R9, 8
    LDI 0x3B
    OR R9, R0
    MOV R11, PC
fe_c1:
    LDI fmul32 - fe_c1
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R6, SP, 3
    ST R7, SP, 4
    ; k = round(y): add +-0.5 before the truncating f2i.
    MOV R2, R6
    SR R2, 15
    CMP R2, 0
    JNZ fe_yneg
    NOP
    LDI 0x3F00
    MOV R8, R0
    LSI R9, 0
    CMP R0, R0
    JZ fe_round
    NOP
fe_yneg:
    LDI 0xBF
    MOV R8, R0
    SL R8, 8
    LSI R9, 0
fe_round:
    MOV R11, PC
fe_c2:
    LDI fadd32 - fe_c2
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R2, R6
    MOV R3, R7
    MOV R11, PC
fe_c3:
    LDI f2i - fe_c3
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R0, SP, 7               ; k
    ; kf = i2f(k)
    MOV R11, PC
fe_c4:
    LDI i2f - fe_c4
    ADD R11, R0
    LD R0, SP, 7
    LINK
    JMP R11
    NOP
    ; Cody-Waite reduction: ln2 = ln2_hi + ln2_lo. ln2_hi has enough
    ; trailing zero bits that k*ln2_hi is exact for |k| <= 255, so the
    ; rounding error no longer grows with k.
    MOV R6, R2
    MOV R7, R3
    ST R6, SP, 12              ; kf
    ST R7, SP, 13
    ; t = x - kf*ln2_hi
    LDI 0x3F31
    MOV R8, R0
    LDI 0x72
    MOV R9, R0
    SL R9, 8                   ; 0x7200
    MOV R11, PC
fe_c5:
    LDI fmul32 - fe_c5
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R8, R6
    MOV R9, R7
    LD R6, SP, 1
    LD R7, SP, 2
    MOV R11, PC
fe_c6:
    LDI fsub32 - fe_c6
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R6, SP, 8
    ST R7, SP, 9
    ; r = t - kf*ln2_lo
    LD R6, SP, 12
    LD R7, SP, 13
    LDI 0x35BF
    MOV R8, R0
    LDI 0xBE
    MOV R9, R0
    SL R9, 8
    LDI 0x8E
    OR R9, R0
    MOV R11, PC
fe_c5b:
    LDI fmul32 - fe_c5b
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R8, R6
    MOV R9, R7
    LD R6, SP, 8
    LD R7, SP, 9
    MOV R11, PC
fe_c6b:
    LDI fsub32 - fe_c6b
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R6, SP, 8               ; r
    ST R7, SP, 9
    ; ---- unpack r once; the Horner loop keeps p unpacked ----
    LD R6, SP, 8
    LD R7, SP, 9
    MOV R11, PC
fe_u_r:
    LDI f_unpack - fe_u_r
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R0, SP, 10              ; r significand high
    ST R1, SP, 11              ; r significand low
    ST R11, SP, 12             ; r exponent
    ST R10, SP, 13             ; r sign
    ; r == 0 -> exp(r) = 1
    CMP R0, 0
    JNZ fe_poly_init
    NOP
    CMP R1, 0
    JNZ fe_poly_init
    NOP
    LDI 0x3F80
    MOV R4, R0
    LSI R5, 0
    LDI 127
    MOV R3, R0
    MOV R11, PC
fe_j_scale0:
    LDI fe_scale - fe_j_scale0
    ADD R11, R0
    MOV PC, R11
    NOP

fe_poly_init:
    ; p = c0 = 1/5040, unpacked from the coefficient table
    MOV R11, PC
fe_poly_c0:
    LDI fe_poly_table - fe_poly_c0
    ADD R11, R0
    LDS R4, CS, R11
    ADD R11, 1
    LDS R5, CS, R11
    ADD R11, 1
    LDS R3, CS, R11
    ADD R11, 1
    ST R11, SP, 14             ; next coefficient
    LDI 7
    ST R0, SP, 15              ; remaining stages

fe_poly_loop:
    ; t = r * p
    LD R0, SP, 10
    LD R1, SP, 11
    MOV R7, R0                 ; keep r high across the LDI
    MOV R11, PC
fe_poly_mul:
    LDI fmul24 - fe_poly_mul
    ADD R11, R0
    MOV R0, R7
    LINK
    JMP R11
    NOP
    ; t exponent = r_exp + p_exp - 127 + increment
    LD R8, SP, 12
    ADD R8, R3
    LDI 127
    MOV R1, R0
    SUB R8, R1
    ADD R8, R10
    MOV R3, R8
    MOV R11, PC
fe_poly_round_t:
    LDI f_round - fe_poly_round_t
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R8, R3                 ; t exponent after rounding
    ; load c = (mantissa, exponent)
    LD R11, SP, 14
    LDS R0, CS, R11
    ADD R11, 1
    LDS R1, CS, R11
    ADD R11, 1
    LDS R9, CS, R11
    ADD R11, 1
    ST R11, SP, 14
    ; d = c_exp - t_exp
    MOV R10, R9
    SUB R10, R8
    LSI R11, 8
    CMP R10, R11
    JC fe_poly_fast            ; d < 8
    NOP
    MOV R11, PC
fe_j_slow:
    LDI fe_poly_slow - fe_j_slow
    ADD R11, R0
    MOV PC, R11
    NOP

fe_poly_fast:
    ; A = c_mant << d in R6:R7 (d < 8, so it fits)
    MOV R6, R0
    MOV R7, R1
    CMP R10, 0
    JZ fe_poly_aligned
    NOP
fe_poly_shift_c:
    MOV R2, R7
    SR R2, 15
    SL R6, 1
    OR R6, R2
    SL R7, 1
    SUB R10, 1
    JNZ fe_poly_shift_c
    NOP
fe_poly_aligned:
    LD R10, SP, 13             ; r sign
    CMP R10, 0
    JNZ fe_poly_sub
    NOP
    ; A + t
    ADD R7, R5
    JC fe_poly_add_carry
    NOP
    ADD R6, R4
    CMP R2, R2
    JZ fe_poly_norm
    NOP
fe_poly_add_carry:
    ADD R6, R4
    ADD R6, 1
    CMP R2, R2
    JZ fe_poly_norm
    NOP
fe_poly_sub:
    ; A - t (A > t)
    MOV R2, R7
    SUB R2, R5
    JC fe_poly_sub_borrow
    NOP
    MOV R7, R2
    MOV R2, R6
    SUB R2, R4
    MOV R6, R2
    CMP R2, R2
    JZ fe_poly_norm
    NOP
fe_poly_sub_borrow:
    MOV R7, R2
    MOV R2, R6
    SUB R2, 1
    SUB R2, R4
    MOV R6, R2

fe_poly_norm:
    ; S in R6:R7 at exponent t_exp (R8). Shift right while S >= 2^24,
    ; collecting the guard and sticky bits.
    LDI 0x100
    MOV R1, R0                 ; 0x100
    LSI R9, 0                  ; guard
    LSI R10, 0                 ; sticky
    LSI R11, 1                 ; first shifted-out bit
    LSI R3, 0                  ; right-shift count
fe_poly_norm_loop:
    CMP R6, R1
    JC fe_poly_norm_done
    NOP
    LSI R0, 1
    MOV R2, R7
    AND R2, R0                 ; out bit
    CMP R11, 0
    JZ fe_poly_norm_sticky
    NOP
    MOV R9, R2                 ; guard
    LSI R11, 0
    CMP R0, R0
    JZ fe_poly_norm_shift
    NOP
fe_poly_norm_sticky:
    OR R10, R2                 ; sticky
fe_poly_norm_shift:
    MOV R0, R6
    LSI R2, 1
    AND R0, R2
    SL R0, 15
    SR R6, 1
    SR R7, 1
    OR R7, R0
    ADD R3, 1
    CMP R0, R0
    JZ fe_poly_norm_loop
    NOP
fe_poly_norm_done:
    ; The subtraction case can land below 2^23 only when d=0; shift left
    ; once then, with no discarded bits.
    LSI R0, 8
    SL R0, 4                   ; 0x80
    CMP R6, R0
    JNC fe_poly_round_p
    NOP
    MOV R0, R7
    SR R0, 15
    SL R6, 1
    OR R6, R0
    SL R7, 1
    SUB R3, 1
fe_poly_round_p:
    ; exponent = t_exp + shift; round to nearest with the guard/sticky
    ADD R8, R3
    MOV R4, R6
    MOV R5, R7
    MOV R6, R9
    MOV R7, R10
    MOV R3, R8
    MOV R11, PC
fe_poly_round_p_call:
    LDI f_round - fe_poly_round_p_call
    ADD R11, R0
    LINK
    JMP R11
    NOP

fe_poly_next:
    LD R11, SP, 15
    SUB R11, 1
    ST R11, SP, 15
    CMP R11, 0
    JNZ fe_poly_loop
    NOP

fe_scale:
    ; p *= 2^k, then pack. f_pack handles underflow/overflow edges.
    LD R1, SP, 7               ; k
    ADD R3, R1
    MOV R7, PC
fe_final_pack:
    LDI f_pack - fe_final_pack
    ADD R7, R0
    MOV R0, R4
    MOV R1, R5
    LSI R10, 0
    MOV R11, R3
    LINK
    JMP R7
    NOP
    MOV R11, PC
fe_j_ret_final:
    LDI fe_ret - fe_j_ret_final
    ADD R11, R0
    MOV PC, R11
    NOP

fe_poly_slow:
    ; d >= 8: the exact left shift no longer fits R6:R7. Pack t and c and
    ; use the general add; this only happens for |r| below about 1e-5.
    ; The trampoline clobbered R0, so reload the current coefficient.
    LD R11, SP, 14
    SUB R11, 3
    LDS R0, CS, R11
    ADD R11, 1
    LDS R1, CS, R11
    ST R0, SP, 3               ; c_mant high
    ST R1, SP, 4               ; c_mant low
    LD R10, SP, 13
    MOV R11, R8
    MOV R7, PC
fe_poly_pack_t:
    LDI f_pack - fe_poly_pack_t
    ADD R7, R0
    MOV R0, R4
    MOV R1, R5
    LINK
    JMP R7
    NOP
    ST R6, SP, 8               ; t packed
    ST R7, SP, 9
    LSI R10, 0
    MOV R11, R9
    MOV R7, PC
fe_poly_pack_c:
    LDI f_pack - fe_poly_pack_c
    ADD R7, R0
    LD R0, SP, 3
    LD R1, SP, 4
    LINK
    JMP R7
    NOP
    MOV R8, R6
    MOV R9, R7
    LD R6, SP, 8
    LD R7, SP, 9
    MOV R11, PC
fe_poly_add:
    LDI fadd32 - fe_poly_add
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R11, PC
fe_poly_unpack_p:
    LDI f_unpack - fe_poly_unpack_p
    ADD R11, R0
    LINK
    JMP R11
    NOP
    MOV R4, R0
    MOV R5, R1
    MOV R3, R11
    MOV R11, PC
fe_j_next:
    LDI fe_poly_next - fe_j_next
    ADD R11, R0
    MOV PC, R11
    NOP

fe_poly_table:
    .word 0x00D0, 0x0D01, 114  ; 1/5040
    .word 0x00B6, 0x0B61, 117  ; 1/720
    .word 0x0088, 0x8889, 120  ; 1/120
    .word 0x00AA, 0xAAAB, 122  ; 1/24
    .word 0x00AA, 0xAAAB, 124  ; 1/6
    .word 0x0080, 0x0000, 126  ; 1/2
    .word 0x0080, 0x0000, 127  ; 1
    .word 0x0080, 0x0000, 127  ; 1


fe_range_big:
    LD R10, SP, 14
    CMP R10, 0
    JZ fe_rb_pos
    NOP
    MOV R11, PC
fe_j_zero3:
    LDI fe_zero - fe_j_zero3
    ADD R11, R0
    MOV PC, R11
    NOP
fe_rb_pos:
    MOV R11, PC
fe_j_inf2:
    LDI fe_inf - fe_j_inf2
    ADD R11, R0
    MOV PC, R11
    NOP

fe_ret:
    LD LR, SP, 0
    ADD SP, 8
    ADD SP, 8
    JMP LR
    NOP

; ---- flog32 ------------------------------------------------------------
; Input R6:R7, output R6:R7. Negative and NaN inputs give canonical NaN;
; +-0 and denormals give -inf; +inf gives +inf.
flog32:
    SUB SP, 8
    SUB SP, 8
    ST LR, SP, 0
    ST R6, SP, 1
    ST R7, SP, 2
    MOV R11, PC
fl_u1:
    LDI f_unpack - fl_u1
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R10, SP, 14
    ST R11, SP, 15
    ST R0, SP, 3
    ST R1, SP, 4
    LDI 255
    MOV R2, R0
    CMP R11, R2
    JNZ fl_not_special
    NOP
    MOV R11, PC
fl_j_special:
    LDI fl_special - fl_j_special
    ADD R11, R0
    MOV PC, R11
    NOP
fl_not_special:
    CMP R11, 0
    JNZ fl_not_zero
    NOP
    MOV R11, PC
fl_j_ninf:
    LDI fl_ninf - fl_j_ninf
    ADD R11, R0
    MOV PC, R11
    NOP
fl_not_zero:
    LD R10, SP, 14
    CMP R10, 0
    JZ fl_positive
    NOP
    MOV R11, PC
fl_j_nan:
    LDI fl_nan - fl_j_nan
    ADD R11, R0
    MOV PC, R11
    NOP
fl_positive:
    ; e = exp - 127
    LDI 127
    MOV R2, R0
    LD R11, SP, 15
    SUB R11, R2
    ST R11, SP, 7
    ; m is in [1,2); if it is >= 1.5, halve it and bump e.
    LDI 0xC0
    MOV R2, R0
    LD R0, SP, 3
    CMP R0, R2
    JNC fl_big
    NOP
    LSI R10, 0
    LDI 127
    MOV R11, R0
    CMP R0, R0
    JZ fl_pack
    NOP
fl_big:
    LSI R10, 0
    LDI 126
    MOV R11, R0
    LD R2, SP, 7
    ADD R2, 1
    ST R2, SP, 7
fl_pack:
    MOV R12, PC
fl_c1:
    LDI f_pack - fl_c1
    ADD R12, R0
    LD R0, SP, 3
    LD R1, SP, 4
    LINK
    JMP R12
    NOP
    ST R6, SP, 3               ; m
    ST R7, SP, 4
    ; m - 1
    LD R6, SP, 3
    LD R7, SP, 4
    LDI 0xBF
    MOV R8, R0
    SL R8, 8
    LDI 0x80
    OR R8, R0
    LSI R9, 0
    MOV R11, PC
fl_c2:
    LDI fadd32 - fl_c2
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R6, SP, 10
    ST R7, SP, 11
    ; m + 1
    LD R6, SP, 3
    LD R7, SP, 4
    LDI 0x3F80
    MOV R8, R0
    LSI R9, 0
    MOV R11, PC
fl_c3:
    LDI fadd32 - fl_c3
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ; z = (m-1)/(m+1)
    MOV R8, R6
    MOV R9, R7
    LD R6, SP, 10
    LD R7, SP, 11
    MOV R11, PC
fl_c4:
    LDI fdiv32 - fl_c4
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R6, SP, 5               ; z
    ST R7, SP, 6
    ; z2 = z*z
    MOV R8, R6
    MOV R9, R7
    MOV R11, PC
fl_c5:
    LDI fmul32 - fl_c5
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R6, SP, 8
    ST R7, SP, 9
    ; p = 1/9
    LDI 0x3DE3
    MOV R6, R0
    LDI 0x8E
    MOV R7, R0
    SL R7, 8
    LDI 0x39
    OR R7, R0
    ST R6, SP, 10
    ST R7, SP, 11
    ; p = 1/7 + z2*p
    LD R6, SP, 8
    LD R7, SP, 9
    LD R8, SP, 10
    LD R9, SP, 11
    MOV R11, PC
fl_c6:
    LDI fmul32 - fl_c6
    ADD R11, R0
    LINK
    JMP R11
    NOP
    LDI 0x3E12
    MOV R8, R0
    LDI 0x49
    MOV R9, R0
    SL R9, 8
    LDI 0x25
    OR R9, R0
    MOV R11, PC
fl_c7:
    LDI fadd32 - fl_c7
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R6, SP, 10
    ST R7, SP, 11
    ; p = 1/5 + z2*p
    LD R6, SP, 8
    LD R7, SP, 9
    LD R8, SP, 10
    LD R9, SP, 11
    MOV R11, PC
fl_c8:
    LDI fmul32 - fl_c8
    ADD R11, R0
    LINK
    JMP R11
    NOP
    LDI 0x3E4C
    MOV R8, R0
    LDI 0xCC
    MOV R9, R0
    SL R9, 8
    LDI 0xCD
    OR R9, R0
    MOV R11, PC
fl_c9:
    LDI fadd32 - fl_c9
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R6, SP, 10
    ST R7, SP, 11
    ; p = 1/3 + z2*p
    LD R6, SP, 8
    LD R7, SP, 9
    LD R8, SP, 10
    LD R9, SP, 11
    MOV R11, PC
fl_c10:
    LDI fmul32 - fl_c10
    ADD R11, R0
    LINK
    JMP R11
    NOP
    LDI 0x3EAA
    MOV R8, R0
    LDI 0xAA
    MOV R9, R0
    SL R9, 8
    LDI 0xAB
    OR R9, R0
    MOV R11, PC
fl_c11:
    LDI fadd32 - fl_c11
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R6, SP, 10
    ST R7, SP, 11
    ; p = 1 + z2*p
    LD R6, SP, 8
    LD R7, SP, 9
    LD R8, SP, 10
    LD R9, SP, 11
    MOV R11, PC
fl_c12:
    LDI fmul32 - fl_c12
    ADD R11, R0
    LINK
    JMP R11
    NOP
    LDI 0x3F80
    MOV R8, R0
    LSI R9, 0
    MOV R11, PC
fl_c13:
    LDI fadd32 - fl_c13
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R6, SP, 10
    ST R7, SP, 11
    ; series = 2*z*p
    LD R6, SP, 5
    LD R7, SP, 6
    LD R8, SP, 10
    LD R9, SP, 11
    MOV R11, PC
fl_c14:
    LDI fmul32 - fl_c14
    ADD R11, R0
    LINK
    JMP R11
    NOP
    LDI 0x40
    MOV R8, R0
    SL R8, 8
    LSI R9, 0
    MOV R11, PC
fl_c15:
    LDI fmul32 - fl_c15
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ST R6, SP, 12
    ST R7, SP, 13
    ; e*ln2
    MOV R11, PC
fl_c16:
    LDI i2f - fl_c16
    ADD R11, R0
    LD R0, SP, 7
    LINK
    JMP R11
    NOP
    MOV R6, R2
    MOV R7, R3
    LDI 0x3F31
    MOV R8, R0
    LDI 0x72
    MOV R9, R0
    SL R9, 8
    LDI 0x18
    OR R9, R0
    MOV R11, PC
fl_c17:
    LDI fmul32 - fl_c17
    ADD R11, R0
    LINK
    JMP R11
    NOP
    ; e*ln2 + series
    MOV R8, R6
    MOV R9, R7
    LD R6, SP, 12
    LD R7, SP, 13
    MOV R11, PC
fl_c18:
    LDI fadd32 - fl_c18
    ADD R11, R0
    LINK
    JMP R11
    NOP
    CMP R0, R0
    JZ fl_ret
    NOP

fl_special:
    LD R1, SP, 4
    LDI 0x80
    MOV R2, R0
    LD R0, SP, 3
    CMP R0, R2
    JNZ fl_nan
    NOP
    CMP R1, 0
    JNZ fl_nan
    NOP
    LD R10, SP, 14
    CMP R10, 0
    JNZ fl_nan
    NOP
    CMP R0, R0
    JZ fl_inf
    NOP

fl_ninf:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0x80
    OR R6, R0
    LSI R7, 0
    LDI 0x80
    MOV R2, R0
    SL R2, 8
    OR R6, R2
    CMP R0, R0
    JZ fl_ret
    NOP

fl_inf:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0x80
    OR R6, R0
    LSI R7, 0
    CMP R0, R0
    JZ fl_ret
    NOP

fl_nan:
    LDI 0x7F
    MOV R6, R0
    SL R6, 8
    LDI 0xC0
    OR R6, R0
    LSI R7, 0
    CMP R0, R0
    JZ fl_ret
    NOP

fl_ret:
    LD LR, SP, 0
    ADD SP, 8
    ADD SP, 8
    JMP LR
    NOP

fpu_lib_end:
.endif
