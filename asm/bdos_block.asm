; ============================================================
; bdos_block.asm - the BDOS chapter for CS=0x4000 (MEMFIXPLAN 2b + 2c-1)
;
; Assembled with segment-relative addresses: every .org value is an offset
; inside CS=0x4000, and the linker lays the chapter at 0x40000 + offset. The
; entry is at offset 0x2D4A; kernel callers set CS=0x4000 and PC=0x2D4A.
;
; The chapter owns the entry, jump table, fns 0..7, the SPI/slice helpers,
; the fcreate/fdelete/fsize slice, the flash drivers and the bd_* cells.
; Fns 8..26 are still in the kernel; their table entries are far stubs at
; 0x5000 that set CS=0 and jump to the kernel handler, whose return pair
; R10:R11 goes straight back to the caller. Phase 2c-2 moves them here and
; deletes the stubs.
;
; The kernel keeps copies of the SPI/slice/flash helpers for its own flash
; words and the PS/2 host code.
;
; Three 2b adjustments remain in the copied text, all forced by CS=0x4000:
;   - fd_pack writes the packed name to ES and mirrors it to CS;
;   - the page driver reads its source from ES;
;   - bdos_abort restores DS from bd_wr_ds.
; ============================================================

; ---- entry, jump table and fns 0..7 (copied from the kernel) -----------
.org 0x2D4A
; Function codes are unsigned, so a code at or above BDOS_FN_COUNT is
; unknown. The table is absolute addresses: BDOS runs with CS=0, so a handler
; anywhere in the kernel image (including the 0x4400 free block) is one JMP
; away.
.ifdef D16NANO
.equ BDOS_FN_COUNT, 30          ; 0..29; 27..29 are fcreate/fdelete/fsize
.else
.equ BDOS_FN_COUNT, 27          ; 0..26; 24..26 are the graphics register helpers
.endif
bdos_entry:
    MOV R2, R0                 ; park the function: LDI writes R0
    LDI BDOS_FN_COUNT
    MOV R3, R0
    CMP R2, R3
    JC bdos_jtab_ok
    NOP
    LDI bdos_unknown
    MOV PC, R0
    NOP
bdos_jtab_ok:
    MOV R3, PC
bdos_jtab_add:
    ADD R3, BDOS_JTABLE - bdos_jtab_add
    ADD R3, R2
    LDS R2, CS, R3
    JMP R2
    NOP
BDOS_JTABLE:
    .word bdos_version
    .word bdos_dir
    .word bdos_lookup
    .word bdos_load
    .word bdos_lookup
    .word bdos_fclose
    .word bdos_load
    .word bdos_fwrite
    .word bdos_unknown
.ifdef D16D
    .word bdos_ps2_init
.else
    .word bdos_unknown
.endif
    .word bdos_serial_read
    .word bdos_read_slice
    .word bdos_spi_ctrl
    .word bdos_spi_xfer
    .word bdos_palette
    .word bdos_i2s_write
    .word bdos_i2s_ctrl
    .word bdos_i2s_read
    .word bdos_sic_enable_write
    .word bdos_sic_enable_read
    .word bdos_sic_pending
    .word bdos_sample_write
    .word bdos_sample_read
    .word bdos_sample_copy
    .word bdos_gfx_read
    .word bdos_gfx_write
    .word bdos_gfx_copy
.ifdef D16NANO
    .word bdos_fcreate
    .word bdos_fdelete
    .word bdos_fsize
.endif

bdos_unknown:
    LSI R0, -1
    LSI R1, 1
    JML R10
    NOP

bdos_version:
    LDI 0x2122
    SL R0, 1
    MOV R1, R0
    LSI R0, 1
    JML R10
    NOP

; ---- Step 1 file helpers (slice-backed, read-first) --------------------
bdos_fclose:
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP


bdos_fwrite_stub:
    LSI R0, -1
    LSI R1, 4
    JML R10
    NOP


; ---- SPI byte helpers -------------------------------------------------
; ---- SPI byte helpers -------------------------------------------------
; spi_put: send R3, return through R9.
spi_put:
    LDI 0x84
    MOV R2, R0
    STS R3, DS, R2
    LDI 0x82
    MOV R2, R0
    LDI bd_poll
    LSI R5, -1
    STS R5, CS, R0
spi_put_w:
    LDS R5, DS, R2
    AND R5, R1
    JZ spi_put_ok
    NOP
    LDI bd_poll
    LDS R5, CS, R0
    SUB R5, 1
    STS R5, CS, R0
    JNZ spi_put_w
    NOP
    LDI bdos_abort            ; the flash never finished: give up cleanly
    MOV PC, R0
    NOP
spi_put_ok:
    MOV PC, R8
    NOP

; spi_get: receive into R3, return through R8.
spi_get:
    LSI R3, -1
    LDI 0x84
    MOV R2, R0
    STS R3, DS, R2
    LDI 0x82
    MOV R2, R0
    LDI bd_poll
    LSI R5, -1
    STS R5, CS, R0
spi_get_w:
    LDS R5, DS, R2
    AND R5, R1
    JZ spi_get_ok
    NOP
    LDI bd_poll
    LDS R5, CS, R0
    SUB R5, 1
    STS R5, CS, R0
    JNZ spi_get_w
    NOP
    LDI bdos_abort
    MOV PC, R0
    NOP
spi_get_ok:
    LDI 0x84
    MOV R2, R0
    LDS R3, DS, R2
    MOV PC, R8
    NOP


slice_read:
    ; the flash needs CS high between commands
    LDI 0x80
    MOV R2, R0
    LSI R3, 2
    STS R3, DS, R2
    LSI R3, 3
    LDI spi_put
    MOV R5, R0
    LDI sl_a
    MOV R8, R0
    JMP R5
    NOP
sl_a:
    MOV R3, R7
    SR R3, 1
    SR R3, 1
    SR R3, 1
    SR R3, 1
    LDI 0x20
    ADD R3, R0
    LDI spi_put
    MOV R5, R0
    LDI sl_b
    MOV R8, R0
    JMP R5
    NOP
sl_b:
    MOV R3, R7
    LDI 0x0F
    MOV R2, R0
    AND R3, R2
    SL R3, 1
    SL R3, 1
    SL R3, 1
    SL R3, 1
    LDI spi_put
    MOV R5, R0
    LDI sl_c
    MOV R8, R0
    JMP R5
    NOP
sl_c:
    LSI R3, 0
    LDI spi_put
    MOV R5, R0
    LDI sl_d
    MOV R8, R0
    JMP R5
    NOP
sl_d:
    LSI R7, 0
    LDI 2048
    MOV R6, R0
sl_word:
    LDI spi_get
    MOV R5, R0
    LDI sl_b1
    MOV R8, R0
    JMP R5
    NOP
sl_b1:
    MOV R4, R3
    LDI spi_get
    MOV R5, R0
    LDI sl_b2
    MOV R8, R0
    JMP R5
    NOP
sl_b2:
    SL R3, 8
    OR R4, R3
    STS R4, ES, R7
    ADD R7, 1
    SUB R6, 1
    JNZ sl_word
    NOP
    LDI 0x80
    MOV R2, R0
    LSI R3, 0
    STS R3, DS, R2
    MOV PC, R12
    NOP

; ---- function 1: read the directory into segment 0x8000 ---------------
; Returns R0 = 0, R1 = 0x8000. Entries start at offset 8, eight cells each.
bdos_dir:
    LDI dir_ret
    MOV R9, R0
    LDI dir_read
    MOV R5, R0
    JMP R5
    NOP
dir_ret:
    LDI 0x4000
    SL R0, 1
    MOV R1, R0
    LSI R0, 0
    JML R10
    NOP

dir_read:
    MVS R3, DS
    LDI bd_ds
    MOV R2, R0
    STS R3, CS, R2
    LSI R1, 1
    LDI 0x0FFF
    INV R0
    MVS DS, R0
    LDI 0x86
    MOV R2, R0
    LSI R3, 0
    STS R3, DS, R2
    LDI 0x80
    MOV R2, R0
    LSI R3, 2
    STS R3, DS, R2
    LDI 0x4000
    SL R0, 1
    MVS ES, R0
    LSI R7, 0
    LDI slice_read
    MOV R5, R0
    LDI dr_back
    MOV R12, R0
    JMP R5
    NOP
dr_back:
    LDI 0x80
    MOV R2, R0
    LSI R3, 0
    STS R3, DS, R2
    LDI bd_ds
    MOV R2, R0
    LDS R3, CS, R2
    MVS DS, R3
    MOV PC, R9
    NOP

; ---- function 2: lookup a name ----------------------------------------
; R1 = pointer to a NUL-terminated name in the caller's DS.
; Returns R0 = first slice, or 0xFFFF with R1 = 2.
bdos_lookup:
    LDI bd_name
    MOV R2, R0
    STS R1, CS, R2
    LDI look_ret
    MOV R9, R0
    LDI dir_read
    MOV R5, R0
    JMP R5
    NOP
look_ret:
    LSI R1, 1
    LDI bd_name
    MOV R2, R0
    LDS R7, CS, R2
    LDI 0x4000
    SL R0, 1
    MVS ES, R0
    LSI R3, 8
    LDI 255
    MOV R6, R0
look_entry:
    LDS R4, ES, R3
    LDI 0x00FF
    MOV R2, R0
    AND R4, R2
    LDI 0xFF
    MOV R1, R0
    MOV R2, R0
    CMP R4, R2
    JZ look_none
    NOP
    MOV R5, R3
    ADD R5, 2
    LSI R8, 0
look_char:
    MOV R2, R8
    SR R2, 1
    ADD R2, R5
    LDS R4, ES, R2
    MOV R2, R8
    LSI R0, 1
    AND R2, R0
    JZ look_even
    NOP
    SR R4, 8
look_even:
    LDI 0xFF
    MOV R1, R0
    MOV R2, R0
    AND R4, R2
    MOV R2, R7
    ADD R2, R8
    LDS R1, DS, R2
    CMP R4, R1
    JNZ look_next
    NOP
    LSI R0, 0
    CMP R1, R0
    JZ look_found
    NOP
    ADD R8, 1
    LSI R0, 12
    CMP R8, R0
    JNZ look_char
    NOP
look_found:
    MOV R2, R3
    ADD R2, 1
    LDS R0, ES, R2
    LSI R1, 0
    JML R10
    NOP
look_next:
    ADD R3, 8
    SUB R6, 1
    JNZ look_entry
    NOP
look_none:
    LSI R0, -1
    LSI R1, 2
    JML R10
    NOP

; ---- function 3: load a type-4 binary ---------------------------------
; R1 = first slice. Returns R0 = segment, R1 = entry; 0xFFFF/3 on error.
bdos_load:
    MOV R7, R1
    MVS R3, DS
    LDI bd_ds
    MOV R2, R0
    STS R3, CS, R2
    LSI R1, 1
    LDI 0x0FFF
    INV R0
    MVS DS, R0
    LDI 0x4000
    SL R0, 1
    MVS ES, R0
    LDI 0x86
    MOV R2, R0
    LSI R3, 0
    STS R3, DS, R2
    LDI 0x80
    MOV R2, R0
    LSI R3, 2
    STS R3, DS, R2
    LDI slice_read
    MOV R5, R0
    LDI ld_first
    MOV R12, R0
    JMP R5
    NOP
ld_first:
    LDI 0x4000
    SL R0, 1
    MVS DS, R0
    LSI R2, 8
    LDS R4, DS, R2
    LDI 0x68B5
    SL R0, 1
    ADD R0, 1
    CMP R4, R0
    JNZ ld_bad
    NOP
    LSI R2, 10
    LDS R3, DS, R2
    LDI bd_entry
    MOV R7, R0
    STS R3, CS, R7
    LSI R2, 11
    LDS R3, DS, R2
    LDI bd_left
    MOV R7, R0
    STS R3, CS, R7
    LSI R2, 12
    LDS R3, DS, R2
    LDI bd_seg
    MOV R7, R0
    STS R3, CS, R7
    LSI R2, 1
    LDS R3, DS, R2
    LDI bd_link
    MOV R7, R0
    STS R3, CS, R7
    ; bd_off is a scratch cell: a second game loaded in the same boot must
    ; start at offset 0, not at the previous game's word count.
    LDI bd_off
    MOV R7, R0
    LSI R3, 0
    STS R3, CS, R7
    LSI R2, 13
    LDI 2035
    MOV R5, R0
    LDI ld_copy
    MOV PC, R0
    NOP

ld_copy:
    LDI bd_left
    MOV R7, R0
    LDS R6, CS, R7
    CMP R6, R5
    JC ld_take_left
    NOP
    LDI ld_count_done
    MOV PC, R0
    NOP
ld_take_left:
    MOV R5, R6
ld_count_done:
    MOV R6, R5
    LDI bd_seg
    MOV R7, R0
    LDS R7, CS, R7
    MVS ES, R7
    LDI bd_off
    MOV R7, R0
    LDS R3, CS, R7
ld_copy_word:
    LDS R4, DS, R2
    STS R4, ES, R3
    ADD R2, 1
    ADD R3, 1
    SUB R5, 1
    JNZ ld_copy_word
    NOP
    STS R3, CS, R7
    LDI bd_left
    MOV R7, R0
    LDS R5, CS, R7
    SUB R5, R6
    STS R5, CS, R7
    LSI R3, 0
    CMP R5, R3
    JZ ld_done
    NOP
    LDI bd_link
    MOV R7, R0
    LDS R3, CS, R7
    LSI R7, -1
    CMP R3, R7
    JZ ld_bad
    NOP
    MOV R7, R3
    LDI 0x0FFF
    INV R0
    MVS DS, R0
    LDI 0x4000
    SL R0, 1
    MVS ES, R0
    LDI slice_read
    MOV R5, R0
    LDI ld_cont
    MOV R12, R0
    JMP R5
    NOP
ld_cont:
    LDI 0x4000
    SL R0, 1
    MVS DS, R0
    LSI R2, 1
    LDS R3, DS, R2
    LDI bd_link
    MOV R7, R0
    STS R3, CS, R7
    LSI R2, 8
    LDI 2040
    MOV R5, R0
    LDI ld_copy
    MOV PC, R0
    NOP

ld_done:
    LDI 0x0FFF
    INV R0
    MVS DS, R0
    LDI 0x80
    MOV R2, R0
    LSI R3, 0
    STS R3, DS, R2
    LDI bd_ds
    MOV R2, R0
    LDS R3, CS, R2
    MVS DS, R3
    LDI bd_entry
    MOV R2, R0
    LDS R1, CS, R2
    LDI bd_seg
    MOV R2, R0
    LDS R0, CS, R2
    JML R10
    NOP

ld_bad:
    LDI 0x0FFF
    INV R0
    MVS DS, R0
    LDI 0x80
    MOV R2, R0
    LSI R3, 0
    STS R3, DS, R2
    LDI bd_ds
    MOV R2, R0
    LDS R3, CS, R2
    MVS DS, R3
    LSI R0, -1
    LSI R1, 3
    JML R10
    NOP

; A byte transfer that never completes aborts from inside the helper, so this
; path must not rely on the callers' return registers. DS is 0xF000 here and
; R10/R11 are still the caller's pair.
bdos_abort:
    LDI 0x80
    MOV R2, R0
    LSI R3, 0
    STS R3, DS, R2            ; release the flash
    LDI bd_ds
    MOV R2, R0
    LDS R3, CS, R2
    MVS DS, R3
    LSI R0, -1
    LSI R1, 4                 ; error: the flash did not answer
    JML R10
    NOP

; ---- BDOS state -------------------------------------------------------

.org 0x2F40
bd_ds:
    .word 0
bd_name:
    .word 0
bd_left:
    .word 0
bd_off:
    .word 0
bd_seg:
    .word 0
bd_entry:
    .word 0
bd_link:
    .word 0
bd_poll:
    .word 0
.org 0x2FB9
bd_wr_n:
    .word 0
bd_wr_err:
    .word 0
bd_slice:
    .word 0
bd_wr_name:
    .word 0
bd_type:
    .word 0
bd_new:
    .word 0
bd_ent:
    .word 0
bd_tmp:
    .word 0
bd_tmp2:
    .word 0
bd_wr_ds:
    .word 0
bd_wr_es:
    .word 0
bd_wr_src:
    .word 0
bd_wr_left:
    .word 0
bd_wr_page:
    .word 0
bd_next:
    .word 0

; ---- fcreate / fdelete / fsize (the 0x3FCD..0x417C slice) --------------
.ifdef D16NANO
.org 0x3FCD
.code
; fd_pack: pack the NUL-terminated name at bd_name into 6 cells at
; ES:R4, two characters per cell, zero padded. DS is the caller's DS.
; Returns through LR; clobbers R0 and R2..R9.
fd_pack:
        LDI bd_name
        MOV R2, R0
        LDS R6, CS, R2
        LSI R5, 0
        LSI R8, 0
fd_pack_loop:
        MOV R2, R5
        SL R2, 1
        ADD R2, R6
        LDS R7, DS, R2
        MOV R2, R8
        AND R2, R2
        JNZ fd_pack_z0
        NOP
        MOV R2, R7
        AND R2, R2
        JNZ fd_pack_h0
        NOP
        LSI R8, 1
fd_pack_z0:
        LSI R7, 0
fd_pack_h0:
        MOV R3, R5
        SL R3, 1
        ADD R3, R6
        ADD R3, 1
        LDS R2, DS, R3
        MOV R3, R8
        AND R3, R3
        JNZ fd_pack_z1
        NOP
        MOV R3, R2
        AND R3, R3
        JNZ fd_pack_h1
        NOP
        LSI R8, 1
fd_pack_z1:
        LSI R2, 0
fd_pack_h1:
        SL R2, 8
        OR R7, R2
        MOV R3, R5
        ADD R3, R4
        STS R7, ES, R3           ; the flash driver reads ES:bd_wr_src
        STS R7, CS, R3           ; mirror for the fcreate/fdelete compare
        ADD R5, 1
        LDI 6
        MOV R2, R0
        CMP R5, R2
        JNZ fd_pack_loop
        NOP
        JMP LR
        NOP

; fcreate: R1 = name, R4 = type. Returns R0 = new slice, or 0xFFFF/7.
bdos_fcreate:
        LDI bd_ent
        MOV R2, R0
        STS R12, CS, R2
        MVS R2, DS
        LDI bd_wr_ds
        MOV R3, R0
        STS R2, CS, R3
        MVS R2, ES
        LDI bd_wr_es
        MOV R3, R0
        STS R2, CS, R3
        LDI bd_name
        MOV R2, R0
        STS R1, CS, R2
        LDI bd_type
        MOV R2, R0
        STS R4, CS, R2
        LDI bd_next
        MOV R2, R0
        LDS R3, CS, R2
        LSI R4, 0
        CMP R3, R4
        JNZ fcr_have
        NOP
        LDI 512
        MOV R3, R0
fcr_have:
        SUB R3, 1
        STS R3, CS, R2
        JNZ fcr_ok
        NOP
        LDI fw_restore - 0x4000
        OR R0, 14
        MOV R2, R0
        LSI R0, -1
        LSI R1, 7
        MOV PC, R2
        NOP
fcr_ok:
        LDI bd_new
        MOV R2, R0
        STS R3, CS, R2
        LSI R2, 0
        MVS ES, R2
        LDI 0x2F35
        MOV R4, R0
        LDI fd_pack
        MOV R5, R0
        LINK
        JMP R5
        NOP
        LDI bd_type
        MOV R2, R0
        LDS R3, CS, R2
        LDI 0x1000
        MOV R4, R0
        LDI 1
        SL R0, 14
        OR R4, R0
        OR R3, R4
        LDI 0x2F33
        MOV R2, R0
        STS R3, ES, R2
        LDI 0x2F34
        MOV R2, R0
        LSI R3, -1
        STS R3, ES, R2
        LDI bd_new
        MOV R2, R0
        LDS R7, CS, R2
        LDI bd_wr_src
        MOV R2, R0
        LDI 0x2F33
        MOV R3, R0
        STS R3, CS, R2
        LDI bd_wr_left
        MOV R2, R0
        LSI R3, 8
        STS R3, CS, R2
        LDI 0x0FFF
        MOV R2, R0
        INV R2
        MVS DS, R2
        LSI R1, 1
        LDI fcr_p1 - 0x4000
        OR R0, 14
        MOV R12, R0
        LDI fd_program
        MOV PC, R0
        NOP
fcr_p1:
        LDI 0x4000
        SL R0, 1
        MVS ES, R0
        LSI R7, 0
        LDI fcr_p2 - 0x4000
        OR R0, 14
        MOV R12, R0
        LDI slice_read
        MOV PC, R0
        NOP
fcr_p2:
        LSI R6, 8
        LDI 255
        MOV R5, R0
fcr_find:
        MOV R2, R6
        ADD R2, 1
        LDS R3, ES, R2
        LSI R4, -1
        CMP R3, R4
        JZ fcr_found
        NOP
        ADD R6, 8
        SUB R5, 1
        JNZ fcr_find
        NOP
        LDI fw_restore - 0x4000
        OR R0, 14
        MOV R2, R0
        LSI R0, -1
        LSI R1, 7
        MOV PC, R2
        NOP
fcr_found:
        LDI bd_type
        MOV R2, R0
        LDS R3, CS, R2
        STS R3, ES, R6
        LDI bd_new
        MOV R2, R0
        LDS R3, CS, R2
        MOV R2, R6
        ADD R2, 1
        STS R3, ES, R2
        LSI R5, 0
fcr_copy:
        LDI 0x2F35
        MOV R2, R0
        ADD R2, R5
        LDS R3, CS, R2
        MOV R2, R6
        ADD R2, R5
        ADD R2, 2
        STS R3, ES, R2
        ADD R5, 1
        LDI 6
        MOV R2, R0
        CMP R5, R2
        JNZ fcr_copy
        NOP
        LSI R7, 0
        LDI bd_wr_src
        MOV R2, R0
        LSI R3, 0
        STS R3, CS, R2
        LDI bd_wr_left
        MOV R2, R0
        LDI 2048
        MOV R3, R0
        STS R3, CS, R2
        LDI 0x0FFF
        MOV R2, R0
        INV R2
        MVS DS, R2
        LSI R1, 1
        LDI fcr_p3 - 0x4000
        OR R0, 14
        MOV R12, R0
        LDI fd_program
        MOV PC, R0
        NOP
fcr_p3:
        LDI fw_restore - 0x4000
        OR R0, 14
        MOV R2, R0
        LDI bd_new
        MOV R3, R0
        LDS R0, CS, R3
        LSI R1, 0
        MOV PC, R2
        NOP

; fdelete: R1 = name. Clears the directory entry; 0xFFFF/8 when absent.
bdos_fdelete:
        LDI bd_ent
        MOV R2, R0
        STS R12, CS, R2
        MVS R2, DS
        LDI bd_wr_ds
        MOV R3, R0
        STS R2, CS, R3
        MVS R2, ES
        LDI bd_wr_es
        MOV R3, R0
        STS R2, CS, R3
        LDI bd_name
        MOV R2, R0
        STS R1, CS, R2
        LSI R2, 0
        MVS ES, R2
        LDI 0x2F33
        MOV R4, R0
        LDI fd_pack
        MOV R5, R0
        LINK
        JMP R5
        NOP
        LDI 0x4000
        SL R0, 1
        MVS ES, R0
        LSI R7, 0
        LDI 0x0FFF
        MOV R2, R0
        INV R2
        MVS DS, R2
        LSI R1, 1
        LDI fdl_p1 - 0x4000
        OR R0, 14
        MOV R12, R0
        LDI slice_read
        MOV PC, R0
        NOP
fdl_p1:
        LSI R6, 8
        LDI 255
        MOV R5, R0
fdl_entry:
        MOV R2, R6
        ADD R2, 1
        LDS R3, ES, R2
        LSI R4, -1
        CMP R3, R4
        JZ fdl_next
        NOP
        LSI R7, 0
fdl_cmp:
        LDI 0x2F33
        MOV R2, R0
        ADD R2, R7
        LDS R4, CS, R2
        MOV R2, R6
        ADD R2, R7
        ADD R2, 2
        LDS R3, ES, R2
        CMP R4, R3
        JNZ fdl_next
        NOP
        ADD R7, 1
        LDI 6
        MOV R2, R0
        CMP R7, R2
        JNZ fdl_cmp
        NOP
        LSI R7, 0
fdl_clear:
        MOV R2, R6
        ADD R2, R7
        LSI R3, -1
        STS R3, ES, R2
        ADD R7, 1
        LDI 8
        MOV R2, R0
        CMP R7, R2
        JNZ fdl_clear
        NOP
        LSI R7, 0
        LDI bd_wr_src
        MOV R2, R0
        LSI R3, 0
        STS R3, CS, R2
        LDI bd_wr_left
        MOV R2, R0
        LDI 2048
        MOV R3, R0
        STS R3, CS, R2
        LDI 0x0FFF
        MOV R2, R0
        INV R2
        MVS DS, R2
        LSI R1, 1
        LDI fdl_p2 - 0x4000
        OR R0, 14
        MOV R12, R0
        LDI fd_program
        MOV PC, R0
        NOP
fdl_p2:
        LDI fw_restore - 0x4000
        OR R0, 14
        MOV R2, R0
        LSI R0, 0
        LSI R1, 0
        MOV PC, R2
        NOP
fdl_next:
        ADD R6, 8
        SUB R5, 1
        JNZ fdl_entry
        NOP
        LDI fw_restore - 0x4000
        OR R0, 14
        MOV R2, R0
        LSI R0, -1
        LSI R1, 8
        MOV PC, R2
        NOP

; fsize: R1 = slice. R0 = text length, binary word count, or 2040.
bdos_fsize:
        LDI bd_ent
        MOV R2, R0
        STS R12, CS, R2
        MVS R2, DS
        LDI bd_wr_ds
        MOV R3, R0
        STS R2, CS, R3
        MVS R2, ES
        LDI bd_wr_es
        MOV R3, R0
        STS R2, CS, R3
        LDI 512
        MOV R2, R0
        CMP R1, R2
        JC fsz_ok
        NOP
        LDI fw_restore - 0x4000
        OR R0, 14
        MOV R2, R0
        LSI R0, -1
        LSI R1, 6
        MOV PC, R2
        NOP
fsz_ok:
        MOV R7, R1
        LDI 0x0FFF
        MOV R2, R0
        INV R2
        MVS DS, R2
        LSI R1, 1
        LDI 0x4000
        SL R0, 1
        MVS ES, R0
        LDI fsz_p1 - 0x4000
        OR R0, 14
        MOV R12, R0
        LDI slice_read
        MOV PC, R0
        NOP
fsz_p1:
        LSI R2, 0
        LDS R3, ES, R2
        LDI 0x00FF
        MOV R2, R0
        AND R3, R2
        LDI 4
        MOV R2, R0
        CMP R3, R2
        JZ fsz_bin
        NOP
        LDI 3
        MOV R2, R0
        CMP R3, R2
        JZ fsz_text
        NOP
        LDI fw_restore - 0x4000
        OR R0, 14
        MOV R2, R0
        LDI 2040
        LSI R1, 0
        MOV PC, R2
        NOP
fsz_bin:
        LSI R2, 11
        LDS R3, ES, R2
        LDI fw_restore - 0x4000
        OR R0, 14
        MOV R2, R0
        MOV R0, R3
        LSI R1, 0
        MOV PC, R2
        NOP
fsz_text:
        LDI 2040
        MOV R4, R0
fsz_scan:
        LSI R2, 0
        CMP R4, R2
        JZ fsz_scan_done
        NOP
        MOV R2, R4
        ADD R2, 7
        LDS R3, ES, R2
        LDI 10
        MOV R2, R0
        CMP R3, R2
        JNZ fsz_scan_done
        NOP
        SUB R4, 1
        LDI fsz_scan - 0x4000
        OR R0, 14
        MOV PC, R0
        NOP
fsz_scan_done:
        LDI fw_restore - 0x4000
        OR R0, 14
        MOV R2, R0
        MOV R0, R4
        LSI R1, 0
        MOV PC, R2
        NOP
.endif

.code
; The second block of kernel code. It used to start at 0x0400, which left only
; ten words of headroom after the 0x0100 section — and a routine that grew the
; interpreter by twenty words silently overran it: .org rewinds the address
; counter, so everything past the boundary was overwritten by the code emitted
; below (the REPL hung, with no assembler error). The block that caused it (the
; serial line loader) is gone, and with it the pressure — but 0x0500 keeps real
; headroom rather than the seven words that are left at 0x0400 today. The data
; section sits at 0x3000, the threading engine at 0x2000.

; ============================================================
; BDOS 7: config-flash write driver (erase and page program)
; ============================================================

; ---- fwrite segment restore helper (copied) ----------------------------
.org 0x464E
.code
fw_restore:
        MOV R2, R0
        LDI bd_tmp2
        MOV R3, R0
        STS R2, CS, R3
        MOV R2, R1
        LDI bd_wr_name
        MOV R3, R0
        STS R2, CS, R3
        LDI 0x0FFF
        MOV R2, R0
        INV R2
        MVS DS, R2
        LDI 0x80
        MOV R3, R0
        LSI R4, 0
        STS R4, DS, R3
        LDI bd_wr_es
        MOV R3, R0
        LDS R4, CS, R3
        MVS ES, R4
        LDI bd_wr_ds
        MOV R3, R0
        LDS R4, CS, R3
        MVS DS, R4
        LDI bd_wr_name
        MOV R2, R0
        LDS R1, CS, R2
        LDI bd_ent
        MOV R2, R0
        LDS R12, CS, R2
        LDI bd_tmp2
        MOV R2, R0
        LDS R0, CS, R2
        JML R10
        NOP


; ---- config-flash erase/program driver (copied) ------------------------
.org 0x0475
.code
fd_wren:
        LDI 0x80
        MOV R2, R0
        LSI R3, 2
        STS R3, DS, R2
        LSI R3, 6
        LDI spi_put
        MOV R5, R0
        LDI fd_wren_ok
        MOV R8, R0
        JMP R5
        NOP
fd_wren_ok:
        LDI 0x80
        MOV R2, R0
        LSI R3, 0
        STS R3, DS, R2
        MOV PC, R9
        NOP

fd_wait:
        LDI 0x7FFF
        MOV R6, R0
fd_wait_again:
        LDI 0x80
        MOV R2, R0
        LSI R3, 2
        STS R3, DS, R2
        LSI R3, 5
        LDI spi_put
        MOV R5, R0
        LDI fd_wait_cmd
        MOV R8, R0
        JMP R5
        NOP
fd_wait_cmd:
        LDI spi_get
        MOV R5, R0
        LDI fd_wait_got
        MOV R8, R0
        JMP R5
        NOP
fd_wait_got:
        LDI 0x80
        MOV R2, R0
        LSI R4, 0
        STS R4, DS, R2
        LSI R2, 1
        AND R3, R2
        JZ fd_wait_ok
        NOP
        SUB R6, 1
        JNZ fd_wait_again
        NOP
        LDI bd_wr_err
        MOV R2, R0
        LSI R3, 1
        STS R3, CS, R2
fd_wait_ok:
        MOV PC, R9
        NOP

fd_cmd:
        LDI 0x80
        MOV R2, R0
        LSI R4, 2
        STS R4, DS, R2
        LDI spi_put
        MOV R5, R0
        LDI fd_cmd_b2
        MOV R8, R0
        JMP R5
        NOP
fd_cmd_b2:
        MOV R3, R7
        SR R3, 1
        SR R3, 1
        SR R3, 1
        SR R3, 1
        LDI 0x20
        ADD R3, R0
        LDI spi_put
        MOV R5, R0
        LDI fd_cmd_b1
        MOV R8, R0
        JMP R5
        NOP
fd_cmd_b1:
        MOV R3, R7
        LDI 0x0F
        MOV R2, R0
        AND R3, R2
        SL R3, 1
        SL R3, 1
        SL R3, 1
        SL R3, 1
        OR R3, R6
        LDI spi_put
        MOV R5, R0
        LDI fd_cmd_b0
        MOV R8, R0
        JMP R5
        NOP
fd_cmd_b0:
        LSI R3, 0
        LDI spi_put
        MOV R5, R0
        LDI fd_cmd_done
        MOV R8, R0
        JMP R5
        NOP
fd_cmd_done:
        MOV PC, R9
        NOP

fd_program:
        LDI 0x86
        MOV R2, R0
        LSI R3, 0
        STS R3, DS, R2
        LDI bd_wr_page
        MOV R2, R0
        LSI R3, 0
        STS R3, CS, R2
        LDI fd_pg_e1
        MOV R9, R0
        LDI fd_wren
        MOV PC, R0
        NOP
fd_pg_e1:
        LSI R6, 0
        LDI 0x20
        MOV R3, R0
        LDI fd_pg_e2
        MOV R9, R0
        LDI fd_cmd
        MOV PC, R0
        NOP
fd_pg_e2:
        LDI 0x80
        MOV R2, R0
        LSI R3, 0
        STS R3, DS, R2
        LDI fd_pg_part2 - 0x4000
        OR R0, 14
        MOV PC, R0
        NOP


; ---- config-flash page driver, part 2 (copied) -------------------------
.org 0x483B
.code
fd_pg_part2:
        LDI fd_pg_e3 - 0x4000
        OR R0, 14
        MOV R9, R0
        LDI fd_wait
        MOV PC, R0
        NOP
fd_pg_e3:
        LDI bd_wr_err
        MOV R2, R0
        LSI R3, 0
        STS R3, CS, R2
fd_pg_page:
        LDI bd_wr_left
        MOV R2, R0
        LDS R3, CS, R2
        LSI R4, 0
        CMP R3, R4
        JNZ fd_pg_go
        NOP
        LDI fd_pg_done - 0x4000
        OR R0, 14
        MOV PC, R0
        NOP
fd_pg_go:
        MOV R4, R3
        LDI 128
        MOV R2, R0
        CMP R4, R2
        JC fd_pg_n_done
        NOP
        MOV R4, R2
fd_pg_n_done:
        LDI bd_wr_n
        MOV R2, R0
        STS R4, CS, R2
        LDI fd_pg_p1 - 0x4000
        OR R0, 14
        MOV R9, R0
        LDI fd_wren
        MOV PC, R0
        NOP
fd_pg_p1:
        LDI bd_wr_page
        MOV R2, R0
        LDS R6, CS, R2
        LSI R3, 2
        LDI fd_pg_p2 - 0x4000
        OR R0, 14
        MOV R9, R0
        LDI fd_cmd
        MOV PC, R0
        NOP
fd_pg_p2:
        LDI bd_wr_src
        MOV R2, R0
        LDS R6, CS, R2
        LDI bd_wr_n
        MOV R2, R0
        LDS R9, CS, R2
fd_pg_cell:
        LDS R4, ES, R6
        MOV R3, R4
        LDI 0x00FF
        MOV R2, R0
        AND R3, R2
        LDI spi_put
        MOV R5, R0
        LDI fd_pg_hi - 0x4000
        OR R0, 14
        MOV R8, R0
        JMP R5
        NOP
fd_pg_hi:
        MOV R3, R4
        SR R3, 8
        LDI spi_put
        MOV R5, R0
        LDI fd_pg_next - 0x4000
        OR R0, 14
        MOV R8, R0
        JMP R5
        NOP
fd_pg_next:
        ADD R6, 1
        SUB R9, 1
        JNZ fd_pg_cell
        NOP
        LDI 0x80
        MOV R2, R0
        LSI R3, 0
        STS R3, DS, R2
        LDI bd_wr_src
        MOV R2, R0
        STS R6, CS, R2
        LDI bd_wr_left
        MOV R2, R0
        LDS R3, CS, R2
        LDI bd_wr_n
        MOV R5, R0
        LDS R4, CS, R5
        SUB R3, R4
        STS R3, CS, R2
        LDI bd_wr_page
        MOV R2, R0
        LDS R3, CS, R2
        ADD R3, 1
        STS R3, CS, R2
        LDI fd_pg_p3 - 0x4000
        OR R0, 14
        MOV R9, R0
        LDI fd_wait
        MOV PC, R0
        NOP
fd_pg_p3:
        LDI fd_pg_page - 0x4000
        OR R0, 14
        MOV PC, R0
        NOP
fd_pg_done:
        MOV PC, R12
        NOP


; ============================================================
; BDOS 7 (fwrite): program one slice from the caller buffer
; ============================================================


; ---- far stubs for the handlers still in the kernel (2c-2) -------------
.org 0x5000
.code
bdos_ps2_init:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x1f78
    MOV R3, R0
    JML R2
    NOP
bdos_serial_read:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x0800
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_read_slice:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x0680
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_spi_ctrl:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x0780
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_spi_xfer:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x07c0
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_palette:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x0900
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_i2s_write:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x091d
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_i2s_ctrl:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x0927
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_i2s_read:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x0931
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_sic_enable_write:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x093e
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_sic_enable_read:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x0948
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_sic_pending:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x0950
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_sample_write:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x095a
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_sample_read:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x0965
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_sample_copy:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x0970
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_gfx_read:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x09a0
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_gfx_write:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x09a6
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_gfx_copy:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x09ae
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
bdos_fwrite:
    LSI R2, 0               ; these handlers are still in the kernel (2c-2)
    LDI 0x09c3
    OR R0, 14
    MOV R3, R0
    JML R2
    NOP
