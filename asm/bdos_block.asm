; ============================================================
; bdos_block.asm - the BDOS chapter for CS=0x4000 (MEMFIXPLAN 2b + 2c)
;
; Assembled with segment-relative addresses: every .org value is an offset
; inside CS=0x4000, and the linker lays the chapter at 0x40000 + offset. The
; entry is at offset 0x0000; kernel callers set CS=0x4000 and PC=0x0000.
;
; The chapter owns the entry, jump table, all 30 functions, the SPI/slice
; helpers, the fcreate/fdelete/fsize slice, the flash drivers, the PS/2 host
; helpers and the bd_* cells. The kernel keeps flat copies of the gap handlers
; for the non-nano profile, where the restored flat table dispatches through
; them; under D16D the chapter table is the only dispatcher.
;
; Three 2b adjustments remain in the copied text, all forced by CS=0x4000:
;   - fd_pack writes the packed name to ES and mirrors it to CS;
;   - the page driver reads its source from ES;
;   - bdos_abort restores DS from bd_wr_ds.
; ============================================================

; ---- entry, jump table and fns 0..7 (copied from the kernel) -----------
.org 0x0000
; Function codes are unsigned, so a code at or above BDOS_FN_COUNT is
; unknown. The table holds in-segment offsets: BDOS runs with CS=BDOS_SEG, so
; the dispatcher reads the word with LDS R2, CS, R3 and JMPs to it.
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

.org 0x01ED
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
.org 0x01F6
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

; ---- fcreate / fdelete / fsize --------------
.ifdef D16NANO
.org 0x0206
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
        LDI fw_restore
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
        LDI bd_name_scratch + 2
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
        LDI bd_name_scratch
        MOV R2, R0
        STS R3, ES, R2
        LDI bd_name_scratch + 1
        MOV R2, R0
        LSI R3, -1
        STS R3, ES, R2
        LDI bd_new
        MOV R2, R0
        LDS R7, CS, R2
        LDI bd_wr_src
        MOV R2, R0
        LDI bd_name_scratch
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
        LDI fcr_p1
        MOV R12, R0
        LDI fd_program
        MOV PC, R0
        NOP
fcr_p1:
        LDI 0x4000
        SL R0, 1
        MVS ES, R0
        LSI R7, 0
        LDI fcr_p2
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
        LDI fw_restore
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
        LDI bd_name_scratch + 2
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
        LDI fcr_p3
        MOV R12, R0
        LDI fd_program
        MOV PC, R0
        NOP
fcr_p3:
        LDI fw_restore
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
        LDI bd_name_scratch
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
        LDI fdl_p1
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
        LDI bd_name_scratch
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
        LDI fdl_p2
        MOV R12, R0
        LDI fd_program
        MOV PC, R0
        NOP
fdl_p2:
        LDI fw_restore
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
        LDI fw_restore
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
        LDI fw_restore
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
        LDI fsz_p1
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
        LDI fw_restore
        MOV R2, R0
        LDI 2040
        LSI R1, 0
        MOV PC, R2
        NOP
fsz_bin:
        LSI R2, 11
        LDS R3, ES, R2
        LDI fw_restore
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
        LDI fsz_scan
        MOV PC, R0
        NOP
fsz_scan_done:
        LDI fw_restore
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
.org 0x03B8
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
.org 0x03DC
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
        LDI fd_pg_part2
        MOV PC, R0
        NOP


; ---- config-flash page driver, part 2 (copied) -------------------------
.org 0x045E
.code
fd_pg_part2:
        LDI fd_pg_e3
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
        LDI fd_pg_done
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
        LDI fd_pg_p1
        MOV R9, R0
        LDI fd_wren
        MOV PC, R0
        NOP
fd_pg_p1:
        LDI bd_wr_page
        MOV R2, R0
        LDS R6, CS, R2
        LSI R3, 2
        LDI fd_pg_p2
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
        LDI fd_pg_hi
        MOV R8, R0
        JMP R5
        NOP
fd_pg_hi:
        MOV R3, R4
        SR R3, 8
        LDI spi_put
        MOV R5, R0
        LDI fd_pg_next
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
        LDI fd_pg_p3
        MOV R9, R0
        LDI fd_wait
        MOV PC, R0
        NOP
fd_pg_p3:
        LDI fd_pg_page
        MOV PC, R0
        NOP
fd_pg_done:
        MOV PC, R12
        NOP


; ============================================================
; BDOS 7 (fwrite): program one slice from the caller buffer
; ============================================================

; ---- the PS/2 host helpers (copied) ---------------------------------
.ifdef D16D
.org 0x04CD
.code
; R1 = byte -> R0 = 1 when the keyboard clocked the frame, 0 otherwise.
bps2_send:
    LDI 7
    SWI
    SMV R0, AR0
    JMP LR
    NOP

; R1 = milliseconds; waits on the millisecond timer with I=1.
bps2_wait_ticks:
    MOV R6, R1
    LDI 8
    SWI
    SMV R1, AR1
    MOV R7, R1
    ADD R7, R6
bps2_wt_loop:
    LDI 8
    SWI
    SMV R1, AR1
    MOV R6, R1
    SUB R6, R7
    JN bps2_wt_loop
    NOP
    JMP LR
    NOP

; R1 = milliseconds -> R0 = 1 when the frame toggle changed, 0 on timeout.
bps2_wait_frame:
    MOV R6, R1
    LDI 8
    SWI
    SMV R0, AR0
    SMV R1, AR1
    LDI 0x0080
    MOV R7, R0
    AND R7, R0
    MOV R8, R1
    ADD R8, R6
bps2_wf_loop:
    LDI 8
    SWI
    SMV R0, AR0
    SMV R1, AR1
    MOV R9, R0
    LDI 0x0080
    MOV R2, R0
    AND R9, R2
    CMP R9, R7
    JNZ bps2_wf_seen
    NOP
    MOV R9, R1
    SUB R9, R8
    JN bps2_wf_loop
    NOP
    LSI R0, 0
    JMP LR
    NOP
bps2_wf_seen:
    LSI R0, 1
    JMP LR
    NOP


; ---- bdos_ps2_init (copied) ---------------------------------
.org 0x0501
bdos_ps2_init:
    LDI bps2_ret_cs
    MOV R2, R0
    STS R10, CS, R2
    ADD R2, 1
    STS R11, CS, R2

    ; Erased memory (the JS core has no PS/2 model) reads 0xFFFF.
    LDI 8
    SWI
    SMV R0, AR0
    LSI R2, -1
    CMP R0, R2
    JZ bps2_done
    NOP

    ; The keyboard's power-on self test can take over a second. Wait it out
    ; before the first command, so a 0xFF reset does not land in the middle of
    ; it. After the settle, reset once: that provokes a fresh BAT (the LED
    ; blink) on a keyboard that missed its own power-on test.
    LDI 1200
    MOV R1, R0
    LDI bps2_wait_ticks
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI 0xFF
    MOV R1, R0
    LDI bps2_send
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI 800                  ; let the BAT finish
    MOV R1, R0
    LDI bps2_wait_ticks
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; Enable (0xF4) blindly, several times. Do not wait for the ACK frame:
    ; the receiver can miss it while the keyboard still enables and scans.
    ; Eight tries over about two seconds cover a keyboard that comes up late.
    LDI bps2_attempt
    MOV R2, R0
    LSI R3, 8
    STS R3, CS, R2
bps2_enable:
    LDI 0xF4
    MOV R1, R0
    LDI bps2_send
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI 250
    MOV R1, R0
    LDI bps2_wait_ticks
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI bps2_attempt
    MOV R2, R0
    LDS R3, CS, R2
    SUB R3, 1
    STS R3, CS, R2
    AND R3, R3
    JNZ bps2_enable
    NOP
bps2_flush:
    ; Drain the hardware FIFO through the non-blocking console read.
    LDI 4
    SWI
    SMV R0, AR0
    LSI R2, -1
    CMP R0, R2
    JNZ bps2_flush
    NOP
bps2_done:
    LDI bps2_ret_cs
    MOV R2, R0
    LDS R10, CS, R2
    ADD R2, 1
    LDS R11, CS, R2
    LSI R0, 0
    JML R10
    NOP
.endif


; ---- bdos_serial_read (copied) ---------------------------------
.org 0x054C
.code
bdos_serial_read:
    ; ( addr pairs -- n )  read `pairs` UART bytes-pairs, packing two bytes
    ; into one cell: low byte first.  One PSRAM store per pair instead of per
    ; byte: on the board every store is a serial PSRAM transaction and one per
    ; byte was slower than 115200, so the 16-deep RX FIFO overran.
    ; BDOS function 10: R1 = addr, R4 = pairs; BDOS has no stack. The return
    ; pair is parked in the 0x44E0 cells: the loop below uses R10 for the
    ; first byte, and R8 cannot be used under ER=8.
    LDI sread_ret_cs
    STS R10, CS, R0
    ADD R0, 1
    STS R11, CS, R0
    MOV R2, R1               ; addr
    MOV R1, R4               ; pairs
    LSI R3, 0                ; pairs stored
    LDI 0x0FFF
    INV R0
    MVS ES, R0               ; ES = 0xF000
    LDI 0x40
    MOV R4, R0               ; UART status
    LDI 0x42
    MOV R9, R0               ; UART data
    LSI R0, 1                ; bit 0 mask
sread_loop:
    AND R1, R1
    JZ sread_done
    NOP
sread_wa:
    LDS R7, ES, R4           ; status
    AND R7, R0
    JNZ sread_ga
    NOP
    LDI 0x60                 ; idle: a PS/2 key aborts
    MOV R12, R0
    LDS R7, ES, R12
    LSI R0, 1
    AND R7, R0
    JNZ sread_done
    NOP
    CLRZ
    JNZ sread_wa
    NOP
sread_ga:
    LDS R10, ES, R9          ; first byte
sread_wb:
    LDS R7, ES, R4           ; wait for the second byte
    AND R7, R0
    JNZ sread_gb
    NOP
    CLRZ
    JNZ sread_wb
    NOP
sread_gb:
    LDS R7, ES, R9           ; second byte
    SL R7, 8
    OR R7, R10
    ST R7, R2, 0             ; one store per pair
    ADD R2, 1
    ADD R3, 1
    SUB R1, 1
    JNZ sread_loop
    NOP
sread_done:
    LDI sread_ret_cs
    LDS R10, CS, R0
    ADD R0, 1
    LDS R11, CS, R0
    MOV R0, R3               ; count
    LSI R1, 0
    JML R10
    NOP


; ---- bdos_read_slice (copied) ---------------------------------
.org 0x0588
.code
bdos_read_slice:
    MVS R3, DS
    LDI bd_src_ds
    MOV R2, R0
    STS R3, CS, R2
    MVS R3, ES
    LDI bd_src_es
    MOV R2, R0
    STS R3, CS, R2
    LDI bd_src_dest
    MOV R2, R0
    STS R4, CS, R2
    MOV R7, R1               ; slice_read takes the slice in R7
    LSI R1, 1                ; direct SPI busy mask
    LDI 0x0FFF
    INV R0
    MVS DS, R0               ; SPI registers
    LDI 0x86
    MOV R2, R0
    LSI R3, 0
    STS R3, DS, R2           ; SPDIV = 0, like dir_read and bdos_load
    LDI 0x4000
    SL R0, 1
    MVS ES, R0               ; 0x8000: the BDOS slice buffer
    LDI slice_read
    MOV R5, R0
    LDI brs_back / 2
    SL R0, 1
    MOV R12, R0
    JMP R5
    NOP
brs_back:
    LDI 0x4000
    SL R0, 1
    MVS DS, R0               ; source segment
    LDI bd_src_ds
    MOV R2, R0
    LDS R3, CS, R2
    MVS ES, R3               ; caller's DS
    LDI bd_src_dest
    MOV R2, R0
    LDS R3, CS, R2           ; caller's destination
    LSI R2, 0
    LDI 2048
    MOV R5, R0
brs_copy:
    LDS R4, DS, R2
    STS R4, ES, R3
    ADD R2, 1
    ADD R3, 1
    SUB R5, 1
    JNZ brs_copy
    NOP
    LDI bd_src_es
    MOV R2, R0
    LDS R3, CS, R2
    MVS ES, R3               ; BDOS preserves ES, and the caller may be the SPI
                             ; console holding 0xF000 there
    LDI bd_src_ds
    MOV R2, R0
    LDS R3, CS, R2
    MVS DS, R3               ; back to the caller's data segment
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP

; ============================================================
; SPI Forth wrappers and BDOS functions 12/13
;
; essentials no longer touches 0xF0080..0xF0086. The CS/divider word and one
; byte transfer go through BDOS, which uses the non-blocking BIOS f20..f22
; primitives and keeps the Forth-side API unchanged.
; ============================================================

; ---- bdos_spi_ctrl (copied) ---------------------------------
.org 0x05C7
.code
bdos_spi_ctrl:
    ; 12: R1 = control, R4 = divider. BIOS f20 writes both registers.
    MOV R2, R4
    LDI 20
    SWI
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP


; ---- bdos_spi_xfer (copied) ---------------------------------
.org 0x05CF
.code
bdos_spi_xfer:
    ; 13: R1 = byte; returns R0 = received byte. Busy-waits through f22.
    MOV R7, R1
    LDI 21
    SWI
    LDI bd_poll
    LSI R5, -1
    STS R5, CS, R0
sxi_wait:
    LDI 22
    SWI
    SMV R0, AR0
    AND R0, R0
    JNZ sxi_done
    NOP
    LDI bd_poll
    MOV R2, R0
    LDS R5, CS, R2
    SUB R5, 1
    STS R5, CS, R2
    JNZ sxi_wait
    NOP
    LSI R0, 0
    LSI R1, 4
    JML R10
    NOP
sxi_done:
    ; The ready poll already read SPI_DATA into the handler's R1; reading it
    ; again would advance the flash's response stream.
    SMV R0, AR1
    LSI R1, 0
    JML R10
    NOP

; ============================================================
; BDOS 14..23: palette, I2S, SIC and the sound window
; ============================================================

; ============================================================
; BDOS 7: config-flash write driver, part 2
; ============================================================

; ---- bdos_fwrite (copied) ---------------------------------
.org 0x05EB
.code
bdos_fwrite:
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
        LDI bd_slice
        MOV R2, R0
        STS R1, CS, R2
        LDI bd_wr_src
        MOV R2, R0
        STS R4, CS, R2
        LDI 512
        MOV R2, R0
        CMP R1, R2
        JC fw_slice_ok
        NOP
fw_err5:
        LDI fw_restore
        MOV R2, R0
        LSI R0, -1
        LSI R1, 5
        MOV PC, R2
        NOP
fw_slice_ok:
        LDI bd_wr_ds
        MOV R2, R0
        LDS R2, CS, R2
        MVS ES, R2
        LDI bd_count
        MOV R2, R0
        LDS R3, DS, R2
        LSI R4, 0
        CMP R3, R4
        JNZ fw_count_ok
        NOP
        LDI 2048
        MOV R3, R0
fw_count_ok:
        LDI 2049
        MOV R2, R0
        CMP R3, R2
        JC fw_count_ok2
        NOP
        LDI fw_restore
        MOV R2, R0
        LSI R0, -1
        LSI R1, 6
        MOV PC, R2
        NOP
fw_count_ok2:
        LDI fw_part2
        MOV PC, R0
        NOP


; ---- palette/I2S/SIC/sample (copied) ---------------------------------
.org 0x0625
.code
bdos_palette:
    ; 14: R1 = bank * 8 + pair, R4 = background | ink << 8.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    MOV R2, R1
    SR R1, 3                 ; bank
    LDI 7
    MOV R3, R0
    AND R2, R3               ; pair
    SL R1, 4                 ; bank * 16
    SL R2, 1                 ; pair * 2
    ADD R1, R2
    LDI 0x2080               ; 0x6080 cannot be an LDI immediate: it sign-extends
    MOV R2, R0
    LDI 1
    SL R0, 14
    OR R2, R0
    ADD R1, R2
    MOV R3, R4
    LDI 0x00FF
    MOV R5, R0
    AND R3, R5               ; background
    STS R3, ES, R1
    SR R4, 8                 ; ink
    ADD R1, 1
    STS R4, ES, R1
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP
bdos_i2s_write:
    ; 15: R1 = sample.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x00A0
    MOV R2, R0
    STS R1, ES, R2
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP
bdos_i2s_ctrl:
    ; 16: R1 = control.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x00A2
    MOV R2, R0
    STS R1, ES, R2
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP
bdos_i2s_read:
    ; 17: R0 = status, R1 = level.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x00A4
    MOV R2, R0
    LDS R1, ES, R2
    MOV R3, R1
    LDI 0x00A0
    MOV R2, R0
    LDS R1, ES, R2
    MOV R0, R3
    JML R10
    NOP
bdos_sic_enable_write:
    ; 18: R1 = mask.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x00B2
    MOV R2, R0
    STS R1, ES, R2
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP
bdos_sic_enable_read:
    ; 19: R0 = mask.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x00B2
    MOV R2, R0
    LDS R0, ES, R2
    JML R10
    NOP
bdos_sic_pending:
    ; 20: R1 = mask.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x00B0
    MOV R2, R0
    STS R1, ES, R2
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP
bdos_sample_write:
    ; 21: R1 = offset, R4 = value.
    LDI 0x1FFF
    INV R0
    MVS ES, R0
    STS R4, ES, R1
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP
bdos_sample_read:
    ; 22: R1 = offset -> R0 = value.
    LDI 0x1FFF
    INV R0
    MVS ES, R0
    LDS R0, ES, R1
    MOV R3, R0
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    MOV R0, R3
    JML R10
    NOP
bdos_sample_copy:
    ; 23: R1 = source in DS, R4 = destination offset; bd_count cells.
    LDI 0x1FFF
    INV R0
    MVS ES, R0
    LDI bd_count
    MOV R2, R0
    LD R3, R2, 0
    LDI 0
    CMP R3, R0
    JZ bdos_sample_copy_done
    NOP
bdos_sample_copy_loop:
    LDS R5, DS, R1
    STS R5, ES, R4
    ADD R1, 1
    ADD R4, 1
    SUB R3, 1
    JNZ bdos_sample_copy_loop
    NOP
bdos_sample_copy_done:
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP

; ============================================================
; BDOS 24..26: the remaining graphics registers
; ============================================================

; ============================================================
; Forth entry for BDOS 7 (fwrite)
; ============================================================

; ---- gfx 24..26 (copied) ---------------------------------
.org 0x06AE
.code
bdos_gfx_read:
    ; 24: R1 = offset inside 0xF000 -> R0 = value.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDS R0, ES, R1
    JML R10
    NOP
bdos_gfx_write:
    ; 25: R1 = offset, R4 = value.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    STS R4, ES, R1
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP
bdos_gfx_copy:
    ; 26: R1 = source in DS, R4 = offset, bd_count cells.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI bd_count
    MOV R2, R0
    LD R3, R2, 0
    LDI 0
    CMP R3, R0
    JZ bdos_gfx_copy_done
    NOP
bdos_gfx_copy_loop:
    LDS R5, DS, R1
    STS R5, ES, R4
    ADD R1, 1
    ADD R4, 1
    SUB R3, 1
    JNZ bdos_gfx_copy_loop
    NOP
bdos_gfx_copy_done:
    LSI R0, 0
    LSI R1, 0
    JML R10
    NOP

; ============================================================
; PS/2 host: reset and enable the keyboard (D16D only)
; ============================================================
; The receiver (rtl/ps2_rx.sv) is receive-only by itself: some keyboards do not
; scan until the host resets them. The sender drives the open-drain pads
; through control 6 (0x200C): bit 9 pulls CLK low, bit 10 pulls DATA low. The
; synchronised levels are 0xF0066 bits 5/6, and bit 7 is the receiver's frame
; toggle (one flip per good frame, ACK and BAT included), so the init can wait
; for the keyboard's answer instead of sleeping blindly.
;
; This block used to be asm/ps2_host.asm, a type-4 slice loaded at segment
; 0x4000 by screens/flash/games.fth. It lives in the BIOS now and binit calls
; it, so the keyboard is ready before the menu or the prompt is reached.
; Function 7 sends one byte, function 8 re-runs the init without clearing.
.ifdef CONSOLE_UART
; Common BIOS state (LAYERPLAN 1.4). 0x5790 is inside every CONSOLE_UART
; BIOS block: 0x4A00 for D16NANO/D16D, 0x5600 for the D16MINI UART build.

; ---- cells used by the copied gap handlers -----------------------------
.org 0x06D2
bd_src_ds:
    .word 0
bd_src_dest:
    .word 0
bd_src_es:
    .word 0
; bd_count is DS-relative and shared with the kernel (function 7 writes it
; through the caller's DS before the far call). Keep the kernel's offset; a
; chapter-local copy would be read from the wrong segment.
.equ bd_count, 0x2FB8

; ---- fwrite flash programming step (copied) ----------------------------
.org 0x06D8
.code
fw_part2:
        LDI bd_wr_left
        MOV R2, R0
        STS R3, CS, R2
        LDI bd_tmp
        MOV R2, R0
        STS R3, CS, R2
        LDI bd_wr_src
        MOV R2, R0
        LDS R4, CS, R2
        LDS R3, ES, R4
        LDI 1
        SL R0, 15
        AND R3, R0
        JZ fw_unprot
        NOP
        LDI fw_err5
        MOV PC, R0
        NOP
fw_unprot:
        LDI 0x0FFF
        MOV R2, R0
        INV R2
        MVS DS, R2
        LSI R1, 1
        LDI fd_fw_ret

        MOV R12, R0
        LDI bd_slice
        MOV R2, R0
        LDS R7, CS, R2
        LDI fd_program
        MOV PC, R0
        NOP
fd_fw_ret:
        LDI bd_wr_err
        MOV R2, R0
        LDS R3, CS, R2
        LSI R4, 0
        CMP R3, R4
        JZ fw_ok
        NOP
        LDI fw_restore
        MOV R2, R0
        LSI R0, -1
        LSI R1, 4
        MOV PC, R2
        NOP
fw_ok:
        LDI fw_restore
        MOV R2, R0
        LDI bd_tmp
        MOV R3, R0
        LDS R0, CS, R3
        LSI R1, 0
        MOV PC, R2
        NOP


.endif

; ---- scratch cells the copied handlers addressed numerically -----------
; The old flat block left these words unwritten and reached them by absolute
; address. Dense layout gives them names.
.org 0x070F
bd_name_scratch:
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
bps2_ret_cs:
    .word 0
bps2_ret_pc:
    .word 0
bps2_attempt:
    .word 0
    .word 0
sread_ret_cs:
    .word 0
sread_ret_pc:
    .word 0
