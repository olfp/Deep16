; ============================================================
; ill_block.asm - the ILL handler for the CS=0x3000 system chapter
;
; The trap forces CS'=0 and vector 0 is a 16-bit PC, so the CS=0 entry
; trampoline at 0x4D24 far-jumps here (CS=0x3000, offset 0x0600). The code is
; the same block that used to sit at flat 0x5000; the linker places this
; relative chapter at 0x30000 + offset, which is exactly the BIOS copy's old
; destination.
;
; Cross-chapter values are the flat addresses the copy arithmetic expects:
;   ill_fpu          0x5F1B (the flat softfloat, still copied by the BIOS copy)
;   ill_pc_save_bios 0x57DF (BIOS data cell, copied to CS:0x13DF)
;   BIOS_BASE        0x4A00
; The internal PC-relative deltas are preserved by the -0x4A00 origin shift.
; ============================================================
.equ BIOS_BASE, 0x4A00
.equ ill_pc_save_bios, 0x57DF
.equ ill_fpu, 0x151B
.equ bios_div16_call, 0x55E4
.equ bios_sdiv32, 0x5576
.org 0x0600
.code
ill_handler:
    ; ARCHREV §3: the shadow bank persists across traps. Save R0'..R3' and SP'
    ; before this handler clobbers them, so a trap taken inside another handler
    ; returns with that handler's context intact. SS/DS are still 0 here (the
    ; entry cleared them) and SP' is the reserved stack at 0x5200, so the save
    ; area is in segment 0 beside this handler.
    SUB SP, 1
    ST R0, SP, 0
    SUB SP, 1
    ST R1, SP, 0
    SUB SP, 1
    ST R2, SP, 0
    SUB SP, 1
    ST R3, SP, 0
.ifdef D16D
    MVS R1, CS
    MVS DS, R1                   ; the save area is in the BIOS copy
.endif
    MOV R0, SP
    ADD R0, 4
    SUB SP, 1
    ST R0, SP, 0                ; [S-5] = the old SP'
    ; ill_save_sp sits above 0x4000, so LDI would sign-extend it; build the
    ; address from PC instead.
    MOV R1, PC
ill_save_addr_lr:
    LDI ill_save_sp - ill_save_addr_lr
    ADD R1, R0
    ST SP, R1, 0                ; remember the five-cell save area
.ifdef D16SEG
.ifdef D16D
    ; The save area and tables are in the BIOS copy, so DS=CS.
    MVS R1, CS
    MVS DS, R1
.else
    LDI 0x1000
    MVS DS, R0
.endif
    LDI 0x2000
    MVS SS, R0
.endif
    SMV R13, AR13               ; SP' = caller's data stack
    MOV R3, LR                  ; R3 = interrupted PC (after the trapped word)
.ifdef D16D
    LDI ill_pc_save_bios - BIOS_BASE
.else
    LDI ill_pc_save
.endif
    ST R3, R0, 0                ; Rs=R15 reads this cell
    SMV R13, AR13               ; SP' = caller's data stack
    ; ---- save the caller's shared R4..R12 --------------------------------
    SUB SP, 1
    ST R4, SP, 0
    SUB SP, 1
    ST R5, SP, 0
    SUB SP, 1
    ST R6, SP, 0
    SUB SP, 1
    ST R7, SP, 0
    SUB SP, 1
    ST R8, SP, 0
    SUB SP, 1
    ST R9, SP, 0
    SUB SP, 1
    ST R10, SP, 0
    SUB SP, 1
    ST R11, SP, 0
    SUB SP, 1
    ST R12, SP, 0
    ; ---- fetch the trapped opcode from the caller's CS -------------------
    SMV R1, ACS
    MVS DS, R1
    LD R2, R3, -1
.ifdef D16SEG
.ifdef D16D
    MVS R1, CS
    MVS DS, R1                  ; DS = the BIOS copy for tables/save area
.else
    LDI 0x1000
    MVS DS, R0
.endif
.else
    LSI R0, 0
    MVS DS, R0                  ; DS = 0 for the handler's data stack/code
.endif
.ifdef FPU_KERNEL
    ; FPU words 0xFFF8..0xFFFE go to the soft-float library. NIO (0xFFF7)
    ; and the SYS words still fall through to the normal decoder.
    MOV R3, R2
    SR R3, 8
    LDI 0xFF
    CMP R3, R0
    JNZ ill_decode
    NOP
    LDI -8
    CMP R2, R0
    JC ill_decode
    NOP
    MOV R3, PC
ill_fpu_jmp_lr:
    LDI ill_fpu - ill_fpu_jmp_lr
    ADD R3, R0
    MOV PC, R3
    NOP
ill_decode:
.endif
    ; ---- decode Rd and Rs -----------------------------------------------
    MOV R0, R2
    SR R0, 4
    LSI R3, 0xF
    AND R0, R3                  ; R0 = Rd
    MOV R1, R2
    LSI R3, 0xF
    AND R1, R3                  ; R1 = Rs
    ; hold the indices: [SP]=Rs, [SP+1]=Rd
    SUB SP, 1
    ST R0, SP, 0                ; Rd
    SUB SP, 1
    ST R1, SP, 0                ; Rs
    ; ---- reject reserved/NIO words --------------------------------------
    ; 0xFFF8..0xFFFE (and NIO, 0xFFF7) have top byte 0xFF, so their func5
    ; field reads 0x1F -- the same as DIV32. The handler only emulates DIV
    ; and DIV32, so anything above 0xDEFF returns as a no-op.
    MOV R3, R2
    SR R3, 8
    LDI 0xFF
    CMP R3, R0
    JZ ill_unknown
    NOP
    ; ---- func5 = (instr >> 8) & 0x1F ------------------------------------
    MOV R3, R2
    SR R3, 8
    LDI 0x1F
    AND R3, R0
    LDI 0x1E
    CMP R3, R0
    JZ ill_div16
    NOP
    LDI 0x1F
    CMP R3, R0
    JZ ill_div32
    NOP
    MOV R3, PC
ill_func5_jmp:
    LDI ill_unknown - ill_func5_jmp - 1
    ADD R3, R0
    MOV PC, R3
    NOP

; ---- DIV Rd, Rs ---------------------------------------------------------
ill_div16:
    ; get Rd (the dividend)
    LD R1, SP, 1
    MOV LR, PC
ill_d16_rd_lr:
    LDI ill_after_d16_rd - ill_d16_rd_lr - 1
    ADD LR, R0
    MOV R3, PC
ill_d16_rd_disp:
    LDI ill_get_dispatch - ill_d16_rd_disp - 1
    ADD R3, R0
    MOV PC, R3
    NOP
ill_after_d16_rd:
    SUB SP, 1
    ST R2, SP, 0
    ; get Rs (the divisor)
    LD R1, SP, 1
    MOV LR, PC
ill_d16_rs_lr:
    LDI ill_after_d16_rs - ill_d16_rs_lr - 1
    ADD LR, R0
    MOV R3, PC
ill_d16_rs_disp:
    LDI ill_get_dispatch - ill_d16_rs_disp - 1
    ADD R3, R0
    MOV PC, R3
    NOP
ill_after_d16_rs:
    SUB SP, 1
    ST R2, SP, 0
    ; divide: R7 / R11 -> R0/R1
    LD R11, SP, 0
    ADD SP, 1
    LD R7, SP, 0
    ADD SP, 1
.ifdef D16D
    LDI bios_div16_call - BIOS_BASE
.else
    LDI div16_call
.endif
    LINK
    JMP R0
    NOP
    ; quotient in R0: build NZVC (N=Q[15], Z=(Q==0), V=C=0) for SAPF.
    MOV R12, R0
    LSI R2, 0
    CMP R12, 0
    JNZ ill_d16_flags_n
    NOP
    OR R2, 1                  ; Z = bit 1
ill_d16_flags_n:
    CMP R12, 0
    JNN ill_d16_flags_store
    NOP
    OR R2, 0                  ; N = bit 0
ill_d16_flags_store:
    MOV R3, PC
ill_d16_flags_addr_lr:
    LDI ill_flags - ill_d16_flags_addr_lr
    ADD R3, R0
    ST R2, R3, 0
    MOV R0, R12
    ; result: quotient in R0, destination index in the stack at [SP+1]
    LD R1, SP, 1
    ADD SP, 2
    ; restore the caller's shared registers before writing a shared result
    LD R12, SP, 0
    ADD SP, 1
    LD R11, SP, 0
    ADD SP, 1
    LD R10, SP, 0
    ADD SP, 1
    LD R9, SP, 0
    ADD SP, 1
    LD R8, SP, 0
    ADD SP, 1
    LD R7, SP, 0
    ADD SP, 1
    LD R6, SP, 0
    ADD SP, 1
    LD R5, SP, 0
    ADD SP, 1
    LD R4, SP, 0
    ADD SP, 1
    MOV R2, R0
    MOV LR, PC
ill_d16_put_lr:
    LDI ill_after_d16_put - ill_d16_put_lr - 1
    ADD LR, R0
    MOV R3, PC
ill_d16_put_disp:
    LDI ill_put_dispatch - ill_d16_put_disp - 1
    ADD R3, R0
    MOV PC, R3
    NOP
ill_after_d16_put:
    MOV R2, PC
ill_d16_flags_load_lr:
    LDI ill_flags - ill_d16_flags_load_lr
    ADD R2, R0
    LD R0, R2, 0
    SAPF
    MOV R1, PC
ill_d16_ret_lr:
    LDI ill_return - ill_d16_ret_lr
    ADD R1, R0
    MOV PC, R1
    NOP

; ---- DIV32 Rd, Rs -------------------------------------------------------
ill_div32:
    ; get Rd (the high half)
    LD R1, SP, 1
    MOV LR, PC
ill_d32_hi_lr:
    LDI ill_after_d32_hi - ill_d32_hi_lr - 1
    ADD LR, R0
    MOV R3, PC
ill_d32_hi_disp:
    LDI ill_get_dispatch - ill_d32_hi_disp - 1
    ADD R3, R0
    MOV PC, R3
    NOP
ill_after_d32_hi:
    SUB SP, 1
    ST R2, SP, 0
    ; get Rd+1 (the low half)
    LD R1, SP, 2
    ADD R1, 1
    MOV LR, PC
ill_d32_lo_lr:
    LDI ill_after_d32_lo - ill_d32_lo_lr - 1
    ADD LR, R0
    MOV R3, PC
ill_d32_lo_disp:
    LDI ill_get_dispatch - ill_d32_lo_disp - 1
    ADD R3, R0
    MOV PC, R3
    NOP
ill_after_d32_lo:
    SUB SP, 1
    ST R2, SP, 0
    ; get Rs (the divisor)
    LD R1, SP, 2
    MOV LR, PC
ill_d32_rs_lr:
    LDI ill_after_d32_rs - ill_d32_rs_lr - 1
    ADD LR, R0
    MOV R3, PC
ill_d32_rs_disp:
    LDI ill_get_dispatch - ill_d32_rs_disp - 1
    ADD R3, R0
    MOV PC, R3
    NOP
ill_after_d32_rs:
    SUB SP, 1
    ST R2, SP, 0
    ; divide: R4:R7 / R11 -> R0 quotient, R1 remainder
    LD R11, SP, 0
    ADD SP, 1
    LD R7, SP, 0
    ADD SP, 1
    LD R4, SP, 0
    ADD SP, 1
.ifdef D16D
    LDI bios_sdiv32 - BIOS_BASE
.else
    LDI sdiv32
.endif
    LINK
    JMP R0
    NOP
    ; quotient in R0: build NZVC before the destination writes clobber R0.
    MOV R10, R0
    LSI R12, 0
    CMP R10, 0
    JNZ ill_d32_flags_n
    NOP
    OR R12, 1                 ; Z = bit 1
ill_d32_flags_n:
    CMP R10, 0
    JNN ill_d32_flags_store
    NOP
    OR R12, 0                 ; N = bit 0
ill_d32_flags_store:
    MOV R2, PC
ill_d32_flags_addr_lr:
    LDI ill_flags - ill_d32_flags_addr_lr
    ADD R2, R0
    ST R12, R2, 0
    MOV R0, R10
    ; save the remainder in R3 before the destination load clobbers R1
    MOV R3, R1
    LD R1, SP, 1
    ADD SP, 2
    ; restore the caller's shared registers
    LD R12, SP, 0
    ADD SP, 1
    LD R11, SP, 0
    ADD SP, 1
    LD R10, SP, 0
    ADD SP, 1
    LD R9, SP, 0
    ADD SP, 1
    LD R8, SP, 0
    ADD SP, 1
    LD R7, SP, 0
    ADD SP, 1
    LD R6, SP, 0
    ADD SP, 1
    LD R5, SP, 0
    ADD SP, 1
    LD R4, SP, 0
    ADD SP, 1
    ; quotient -> Rd
    MOV R2, R0
    SUB SP, 1
    ST R3, SP, 0
    MOV LR, PC
ill_d32_pq_lr:
    LDI ill_after_d32_pq - ill_d32_pq_lr - 1
    ADD LR, R0
    MOV R3, PC
ill_d32_pq_disp:
    LDI ill_put_dispatch - ill_d32_pq_disp - 1
    ADD R3, R0
    MOV PC, R3
    NOP
ill_after_d32_pq:
    ; remainder -> Rd+1
    LD R2, SP, 0
    ADD SP, 1
    ADD R1, 1
    MOV LR, PC
ill_d32_pr_lr:
    LDI ill_after_d32_pr - ill_d32_pr_lr - 1
    ADD LR, R0
    MOV R3, PC
ill_d32_pr_disp:
    LDI ill_put_dispatch - ill_d32_pr_disp - 1
    ADD R3, R0
    MOV PC, R3
    NOP
ill_after_d32_pr:
    MOV R2, PC
ill_d32_flags_load_lr:
    LDI ill_flags - ill_d32_flags_load_lr
    ADD R2, R0
    LD R0, R2, 0
    SAPF
    MOV R1, PC
ill_d32_ret_lr:
    LDI ill_return - ill_d32_ret_lr
    ADD R1, R0
    MOV PC, R1
    NOP

; ---- unknown trapped word: skip it ------------------------------------
ill_unknown:
    ADD SP, 2
ill_restore_shared:
    LD R12, SP, 0
    ADD SP, 1
    LD R11, SP, 0
    ADD SP, 1
    LD R10, SP, 0
    ADD SP, 1
    LD R9, SP, 0
    ADD SP, 1
    LD R8, SP, 0
    ADD SP, 1
    LD R7, SP, 0
    ADD SP, 1
    LD R6, SP, 0
    ADD SP, 1
    LD R5, SP, 0
    ADD SP, 1
    LD R4, SP, 0
    ADD SP, 1
    MOV R1, PC
ill_unk_ret_lr:
    LDI ill_return - ill_unk_ret_lr
    ADD R1, R0
    MOV PC, R1
    NOP

; ---- table dispatch helpers -------------------------------------------
; These cannot sit after ill_return any more: the DIV flag code pushed the
; handler past its fixed 0x51A0 IRQ neighbour, and the D16D showcase menu is
; already laid sparsely over 0x4D34..0x547F. Split them across the two holes
; that both the kernel image and the menu leave free (0x4E4C..0x4EAF and
; 0x5143..0x519F). Both are inside the 0x4A00..0x57FF BIOS copy.
.org 0x044C
.code
    NOP                         ; the target-1 pad for the PC-relative jump
ill_get_dispatch:
    MOV R3, PC
    LDI ill_get_table - ill_get_dispatch - 1
    ADD R3, R0
    ADD R3, R1
    LD R2, R3, 0
    MOV PC, R2
    NOP

; Put: R1 = index, R2 = value, LR = continuation.
ill_put_dispatch:
    MOV R3, PC
    LDI ill_put_table - ill_put_dispatch - 1
    ADD R3, R0
    ADD R3, R1
    LD R0, R3, 0
    MOV PC, R0
    NOP

; ---- get stubs ---------------------------------------------------------
ill_get_r0:
    SMV R2, AR0
    JMP LR
    NOP
ill_get_r1:
    SMV R2, AR1
    JMP LR
    NOP
ill_get_r2:
    SMV R2, AR2
    JMP LR
    NOP
ill_get_r3:
    SMV R2, AR3
    JMP LR
    NOP
ill_get_r4:
    MOV R2, R4
    JMP LR
    NOP
ill_get_r5:
    MOV R2, R5
    JMP LR
    NOP
ill_get_r6:
    MOV R2, R6
    JMP LR
    NOP
ill_get_r7:
    MOV R2, R7
    JMP LR
    NOP
ill_get_r8:
    MOV R2, R8
    JMP LR
    NOP
ill_get_r9:
    MOV R2, R9
    JMP LR
    NOP
ill_get_r10:
    MOV R2, R10
    JMP LR
    NOP
ill_get_r11:
    MOV R2, R11
    JMP LR
    NOP
ill_get_r12:
    MOV R2, R12
    JMP LR
    NOP
ill_get_r13:
    SMV R2, AR13
    JMP LR
    NOP
ill_get_r14:
    SMV R2, AR14
    JMP LR
    NOP
ill_get_r15:
.ifdef D16D
    LDI ill_pc_save_bios - BIOS_BASE
.else
    LDI ill_pc_save
.endif
    LD R2, R0, 0
    JMP LR
    NOP

ill_return:
    ; Restore R0'..R3' and SP' from the entry save, then return.
.ifdef D16D
    MVS R1, CS
    MVS DS, R1                   ; the save area is in the BIOS copy
.else
    LDI 0
    MVS DS, R0
.endif
    MVS SS, R0
    MOV R1, PC
ill_ret_addr_lr:
    LDI ill_save_sp - ill_ret_addr_lr
    ADD R1, R0
    LD R13, R1, 0               ; SP' = S-5
    LD R0, SP, 0                ; R0 = the old SP' (S)
    ADD SP, 1
    LD R3, SP, 0
    ADD SP, 1
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    ADD SP, 1
    LD R0, SP, 0                ; the caller's R0'
    ADD SP, 1                   ; SP' = S
    RETI
    NOP

; ---- put stubs ---------------------------------------------------------
; The second hole holds the put stubs, both tables and the save cells.
.org 0x0743
ill_put_r0:
    SMV AR0, R2
    JMP LR
    NOP
ill_put_r1:
    SMV AR1, R2
    JMP LR
    NOP
ill_put_r2:
    SMV AR2, R2
    JMP LR
    NOP
ill_put_r3:
    SMV AR3, R2
    JMP LR
    NOP
ill_put_r4:
    MOV R4, R2
    JMP LR
    NOP
ill_put_r5:
    MOV R5, R2
    JMP LR
    NOP
ill_put_r6:
    MOV R6, R2
    JMP LR
    NOP
ill_put_r7:
    MOV R7, R2
    JMP LR
    NOP
ill_put_r8:
    MOV R8, R2
    JMP LR
    NOP
ill_put_r9:
    MOV R9, R2
    JMP LR
    NOP
ill_put_r10:
    MOV R10, R2
    JMP LR
    NOP
ill_put_r11:
    MOV R11, R2
    JMP LR
    NOP
ill_put_r12:
    MOV R12, R2
    JMP LR
    NOP
; R13/R14/R15 destinations are documented as unsupported: SP/LR are the
; caller's banked stack/link, and the PC is not a GPR.
ill_put_none:
    JMP LR
    NOP

; The tables and the two save cells go in the upper hole; the routines above
; reach them with a 13-bit PC-relative LDI.
ill_get_table:
.ifdef D16D
    .word ill_get_r0,  ill_get_r1,  ill_get_r2,  ill_get_r3
    .word ill_get_r4,  ill_get_r5,  ill_get_r6,  ill_get_r7
    .word ill_get_r8,  ill_get_r9,  ill_get_r10, ill_get_r11
    .word ill_get_r12, ill_get_r13, ill_get_r14, ill_get_r15
.else
    .word ill_get_r0,  ill_get_r1,  ill_get_r2,  ill_get_r3
    .word ill_get_r4,  ill_get_r5,  ill_get_r6,  ill_get_r7
    .word ill_get_r8,  ill_get_r9,  ill_get_r10, ill_get_r11
    .word ill_get_r12, ill_get_r13, ill_get_r14, ill_get_r15
.endif
ill_put_table:
.ifdef D16D
    .word ill_put_r0,  ill_put_r1,  ill_put_r2,  ill_put_r3
    .word ill_put_r4,  ill_put_r5,  ill_put_r6,  ill_put_r7
    .word ill_put_r8,  ill_put_r9,  ill_put_r10, ill_put_r11
    .word ill_put_r12, ill_put_none, ill_put_none, ill_put_none
.else
    .word ill_put_r0,  ill_put_r1,  ill_put_r2,  ill_put_r3
    .word ill_put_r4,  ill_put_r5,  ill_put_r6,  ill_put_r7
    .word ill_put_r8,  ill_put_r9,  ill_put_r10, ill_put_r11
    .word ill_put_r12, ill_put_none, ill_put_none, ill_put_none
.endif

; ---- the saved handler bank (segment 0, beside the handler) -----------
ill_save_sp:
    .word 0
ill_flags:
    .word 0

; ============================================================
; IRQ handler (hardware vector 1)
; ============================================================
; The SIC at 0xF00B0 asserts one level IRQ.  Priority is raster (bit 3)
; before timer (bit 1); the handler services the highest pending source and
; leaves the other bit set, so the level re-enters after RETI.  Raster bumps
; RASTER (0xB8), timer bumps SCRATCH (0xB6).  The entry is a synthetic SWI:
; shadow bank, DS=SS=ES=0, I=0, and the parked instruction's PC, so RETI
; re-runs the instruction the IRQ interrupted.  R0..R3 are the handler's
; shadow scratch; SWI/ILL runs with I=0, so an IRQ never nests on them.


; ---- far-return stubs for the five direct i2f/f2i calls -----------------
; The callers in yet CS=0 store their return PC in the kernel cell 0x2F36
; through the shims at 0x4310/0x4320, then enter i2f/f2i at CS=0x3000. The
; routine's LR point is here; these stubs read the caller PC via ES=0 and
; far-return. The i2f stub uses JML R10 so R2:R3 (the result) survives; the
; f2i stub uses JML R2 so R0 and the R10 flags survive.
.org 0x049F
.code
fpu_sys_i2f_ret:
    LDI 0
    MVS ES, R0
    LDI 0x2F36
    MOV R1, R0
    LDS R11, ES, R1
    LSI R10, 0
    JML R10
    NOP
fpu_sys_f2i_ret:
    MOV R1, R0
    LSI R2, 0
    LDI 0x2F36
    MOV R3, R0
    LDS R11, ES, R3
    MOV R0, R1
    MOV R3, R11
    JML R2
    NOP
