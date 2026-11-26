; ============================================================
; bdos_block.asm - BDOS slice for CS=0x4000 (MEMFIXPLAN phase 2b)
;
; This chapter is assembled with segment-relative addresses: every .org value
; below is an offset inside CS=0x4000, not a physical address. The linker lays
; the chapter at 0x40000 + offset, so PC and LDI stay 16-bit offsets and no
; label needs rebasing.
;
; It owns copies of the helpers the slice calls so it never jumps back into
; CS=0: spi_put/spi_get/slice_read, the flash erase/program driver, the
; config-flash page helper, fw_restore and the bd_* cells it shares with them.
; The kernel keeps its own copies for the flash words and the remaining BDOS
; functions until phase 2c.
;
; Three deliberate differences from the copied text, all forced by running at
; CS=0x4000 instead of CS=0:
;   - fd_pack writes the packed name to ES (the driver source) and mirrors it
;     to CS, because fcreate/fdelete compare it with LDS ..., CS;
;   - the page driver reads the source buffer from ES, which is where the
;     header (ES=0) and the directory (ES=0x8000) actually are;
;   - bdos_abort restores DS from bd_wr_ds, the caller DS the slice saves at
;     entry (the entry's bd_ds is not in this segment).
;
; Callers reach fcreate/fdelete/fsize through the kernel's far trampolines at
; 0x3FCE/0x3FD4/0x3FDA. The ABI is unchanged: R1/R4 in, R10:R11 return pair,
; and CS is 0x4000 only inside the handler.
; ============================================================

; ---- SPI byte helpers + slice reader (copied from the kernel) -----------
.org 0x2D89
.code
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

; ---- SPI abort path (copied) --------------------------------------------
.org 0x2F2A
.code
bdos_abort:
    LDI 0x80
    MOV R2, R0
    LSI R3, 0
    STS R3, DS, R2            ; release the flash
    LDI bd_wr_ds               ; the slice's saved caller DS (set at entry)
    MOV R2, R0
    LDS R3, CS, R2
    MVS DS, R3
    LSI R0, -1
    LSI R1, 4                 ; error: the flash did not answer
    JML R10
    NOP

; ---- BDOS state -------------------------------------------------------

; ---- BDOS state cells used by this slice --------------------------------
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
