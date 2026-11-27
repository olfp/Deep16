; =====================================================================
; asm/editor.asm - the native Deep16 text editor (EDITPLAN v1).
;
; Loaded as a type-4 slice into segment 0x0800 and entered at offset 0.
; The block owns DS=SS=CS=0x0800 while it runs; call-far gives it R10:R11
; as the return pair and runs with I=0, so the BIOS getch poll is used
; directly (the PS/2 controller register is readable without an IRQ).
;
; Memory (segment offsets):
;   0x0000-0x1FFF  code and constants
;   0x2000-0x2FFF  raw slice buffer (2048 cells) + scratch
;   0x3000-0x30FF  file name, NUL-terminated
;   0x3100-0x31FF  status message, NUL-terminated
;   0x3200-0x32FF  state cells
;   0x4000-0xBFFF  text (a gap buffer, pre at 0x4000+cur)
;   0xC000-0xCFFF  stack (unused today)
;
; Display: 80x23 text rows plus status row 23, mode-1 cells at
; 0xF1000 + row*82 + col, word = 0x8000 | pair<<12 | style<<9 | (ch-32).
; =====================================================================

.equ ED_SEG      0x0800
.equ SCR_MAP     0x1000
.equ SCR_W       82
.equ SCR_COLS    80
.equ SCR_ROWS    23
.equ ATTR_TEXT   0x8000
.equ ATTR_MARK   0xF000

.equ NAME_BUF    0x3000
.equ MSG_BUF     0x3100
.equ RAW_BUF     0x3300

; The editor runs with CS = 0x0800 (code) and DS = SS = 0x0900 (data), so the
; data cells cannot collide with the 0x2FB8 bd_count cell BDOS 7 reads from
; the caller's DS. All offsets stay below 0x4000 for LDI.
.equ ed_ret10,   0x3C00
.equ ed_ret11,   0x3C01
.equ ed_slice,   0x3C02
.equ ed_dirty,   0x3C03
.equ ed_pre,     0x3C04
.equ ed_post,    0x3C05
.equ ed_cur,     0x3C06
.equ ed_len,     0x3C07
.equ ed_top,     0x3C08
.equ ed_cline,   0x3C09
.equ ed_ccol,    0x3C0A
.equ ed_lr_draw, 0x3C0B
.equ ed_lr_ask,  0x3C0C
.equ ed_lr_load, 0x3C0D
.equ ed_lr_save, 0x3C0E
.equ ed_lr_bdos, 0x3C0F
.equ ed_lr_stat, 0x3C10
.equ ed_lr_str,  0x3C11
.equ ed_tmp,     0x3C12
.equ ed_tmp2,    0x3C13
.equ ed_tmp3,    0x3C14
.equ ed_quit,    0x3C15
.equ ed_namelen, 0x3C16
.equ ed_lr_num,  0x3C17
.equ ed_lr_open, 0x3C18
.equ ed_lr_nav1, 0x3C19
.equ ed_lr_nav2, 0x3C1A
.equ ed_lr_nav3, 0x3C1B
.equ ed_lr_nav4, 0x3C1C
.equ ed_lr_nav5, 0x3C1D
.equ ed_lr_goto, 0x3C1E
.equ ed_lr_nav6, 0x3C1F

.org 0
ed_start:
        MVS R0, CS
        LDI 0x0900
        MVS DS, R0
        MVS SS, R0
        LDI 0x5000              ; 0xD000: the editor's own stack top
        MOV SP, R0
        LDI ed_ret10
        MOV R2, R0
        ST R10, R2, 0
        LDI ed_ret11
        MOV R2, R0
        ST R11, R2, 0
        LDI -1
        MOV R3, R0
        LDI ed_slice
        MOV R2, R0
        ST R3, R2, 0

        ; empty gap at 0x4000..0xBFFF
        LDI 1
        SL R0, 14
        MOV R3, R0
        LDI ed_pre
        MOV R2, R0
        ST R3, R2, 0
        LDI 0x4000              ; sign-extends to 0xC000: the buffer end
        MOV R3, R0
        LDI ed_post
        MOV R2, R0
        ST R3, R2, 0
        LSI R3, 0
        LDI ed_cur
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_len
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_top
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_quit
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_dirty
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_namelen
        MOV R2, R0
        ST R3, R2, 0

        LDI ed_clear
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_ask_name
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_load
        MOV R4, R0
        LINK
        JMP R4
        NOP

ed_loop:
        LDI ed_draw_all
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_status
        MOV R4, R0
        LINK
        JMP R4
        NOP

ed_wait:
        ; poll the PS/2 controller directly: the block has no SWI vector
        LDI 0x0FFF
        INV R0
        MVS ES, R0
        LDI 0x0060
        MOV R1, R0
        LDS R0, ES, R1
        AND R0, R0
        JZ ed_wait
        NOP
        LDI 0x0062
        MOV R1, R0
        LDS R0, ES, R1
        MOV R6, R0
        LDI 0x00FF
        MOV R1, R0
        AND R6, R1              ; the key

        ; CR / LF
        LDI 13
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_enter
        LDI 10
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_enter
        ; BS / DEL
        LDI 8
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_bs
        LDI 127
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_bs
        ; C-D delete forward
        LDI 4
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_del
        ; C-B / C-F left/right
        LDI 2
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_left
        LDI 6
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_right
        ; C-P / C-N up/down
        LDI 16
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_up
        LDI 14
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_down
        ; C-A / C-E home/end
        LDI 1
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_home
        LDI 5
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_end
        ; C-S save, C-Q quit, C-O open
        LDI 19
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_save
        LDI 17
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_quit
        LDI 15
        MOV R2, R0
        CMP R6, R2
        JZ ed_key_open
        ; printable
        LDI 32
        MOV R2, R0
        CMP R6, R2
        JC ed_loop
        NOP
        LDI 127
        MOV R2, R0
        CMP R6, R2
        JC ed_insert_key
        NOP
        LDI 0xC0
        MOV R2, R0
        CMP R6, R2
        JC ed_loop
        NOP
ed_insert_key:
        MOV R3, R6
        LDI ed_insert
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_enter:
        LDI 10
        MOV R3, R0
        LDI ed_insert
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_bs:
        LDI ed_back
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_del:
        LDI ed_delete
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_left:
        LDI ed_left
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_right:
        LDI ed_right
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_up:
        LDI ed_up
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_down:
        LDI ed_down
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_home:
        LDI ed_home
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_end:
        LDI ed_end
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_save:
        LDI ed_save
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_open:
        LDI ed_open
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP

ed_key_quit:
        LDI ed_quit
        MOV R2, R0
        LD R3, R2, 0
        AND R3, R3
        JNZ ed_quit_armed
        NOP
        ; first quit while dirty: warn
        LDI ed_dirty
        MOV R2, R0
        LD R3, R2, 0
        AND R3, R3
        JZ ed_quit_now
        NOP
        LSI R3, 1
        LDI ed_quit
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_msg_dirty
        MOV R3, R0
        LDI ed_set_msg
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_loop
        MOV PC, R0
        NOP
ed_quit_armed:
ed_quit_now:
        LDI ed_ret10
        MOV R2, R0
        LD R10, R2, 0
        LDI ed_ret11
        MOV R2, R0
        LD R11, R2, 0
        JML R10
        NOP

; ---------------------------------------------------------------------
; ed_bdos: call BDOS with R0 = function, R1 = arg, R4 = arg4.
; Returns the handler's R0/R1. Preserves LR (the caller's).
; ---------------------------------------------------------------------
ed_bdos:
        LDI ed_lr_bdos
        MOV R2, R0
        ST LR, R2, 0
        MOV R9, R7              ; the function is in R7
        MVS R3, CS
        MOV R10, R3
        LDI ed_bdos_back
        MOV R11, R0
        MOV R7, R9              ; the kernel's shared BDOS far-entry stub
        LSI R2, 0
        LDI 0x3FE2              ; bdos_call: sets CS=0x4000, PC=0x0000
        MOV R3, R0
        JML R2
        NOP
ed_bdos_back:
        MOV R4, R0              ; keep the BDOS result out of the LDI
        LDI ed_lr_bdos
        MOV R2, R0
        LD LR, R2, 0
        MOV R0, R4
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_cell: draw R3 at (R1 row, R2 col) with attr R4.
; Clobbers R0, R3, R5 and ES; leaves R1, R2, R4 and R6..R9 alone.
; ---------------------------------------------------------------------
ed_cell:
        ; R3 char -> 128-slot glyph. ASCII first; the seven German Latin-1
        ; codes follow; anything else is a space.
        LDI 0x20
        CMP R3, R0
        JC ed_cell_space
        NOP
        LDI 0x7F
        CMP R3, R0
        JC ed_cell_ascii
        NOP
        LDI 0xC4
        CMP R3, R0
        JZ ed_cell_g0
        NOP
        LDI 0xD6
        CMP R3, R0
        JZ ed_cell_g1
        NOP
        LDI 0xDC
        CMP R3, R0
        JZ ed_cell_g2
        NOP
        LDI 0xDF
        CMP R3, R0
        JZ ed_cell_g3
        NOP
        LDI 0xE4
        CMP R3, R0
        JZ ed_cell_g4
        NOP
        LDI 0xF6
        CMP R3, R0
        JZ ed_cell_g5
        NOP
        LDI 0xFC
        CMP R3, R0
        JZ ed_cell_g6
        NOP
        LDI ed_cell_space
        MOV PC, R0
        NOP
ed_cell_ascii:
        LDI 0x20
        SUB R3, R0
        LDI ed_cell_addr
        MOV PC, R0
        NOP
ed_cell_g0:
        LDI 96
        MOV R3, R0
        LDI ed_cell_addr
        MOV PC, R0
        NOP
ed_cell_g1:
        LDI 97
        MOV R3, R0
        LDI ed_cell_addr
        MOV PC, R0
        NOP
ed_cell_g2:
        LDI 98
        MOV R3, R0
        LDI ed_cell_addr
        MOV PC, R0
        NOP
ed_cell_g3:
        LDI 99
        MOV R3, R0
        LDI ed_cell_addr
        MOV PC, R0
        NOP
ed_cell_g4:
        LDI 100
        MOV R3, R0
        LDI ed_cell_addr
        MOV PC, R0
        NOP
ed_cell_g5:
        LDI 101
        MOV R3, R0
        LDI ed_cell_addr
        MOV PC, R0
        NOP
ed_cell_g6:
        LDI 102
        MOV R3, R0
        LDI ed_cell_addr
        MOV PC, R0
        NOP
ed_cell_space:
        LSI R3, 0
ed_cell_addr:
        MOV R5, R1
        SL R5, 6
        MOV R0, R1
        SL R0, 4
        ADD R5, R0
        MOV R0, R1
        SL R0, 1
        ADD R5, R0
        LDI SCR_MAP
        ADD R5, R0
        ADD R5, R2
        OR R3, R4
        LDI 0x0FFF
        INV R0
        MVS ES, R0
        STS R3, ES, R5
        JMP LR
        NOP

; ed_getc: R1 = pointer -> R0 = char or -1, R1 = next pointer.
; Jumps the gap at ed_pre and stops at 0xC000.
ed_getc:
        LDI ed_pre
        MOV R2, R0
        LD R3, R2, 0
        CMP R1, R3
        JNZ ed_getc_nogap
        NOP
        LDI ed_post
        MOV R2, R0
        LD R1, R2, 0
ed_getc_nogap:
        LDI 0x4000              ; 0xC000
        MOV R2, R0
        CMP R1, R2
        JC ed_getc_ok
        NOP
        LSI R0, -1
        MOV PC, LR
        NOP
ed_getc_ok:
        LD R0, R1, 0
        MOV R4, R0              ; keep the char out of the address load
        ADD R1, 1
        LDI ed_pre
        MOV R2, R0
        LD R3, R2, 0
        CMP R1, R3
        JNZ ed_getc_done
        NOP
        LDI ed_post
        MOV R2, R0
        LD R1, R2, 0
ed_getc_done:
        MOV R0, R4
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_scan: recompute cline/ccol from the pre-gap text, adjust ed_top.
; ---------------------------------------------------------------------
ed_scan:
        LDI 1
        SL R0, 14
        MOV R1, R0              ; ptr = 0x4000
        LDI ed_pre
        MOV R2, R0
        LD R4, R2, 0
        LSI R2, 0               ; line
        LSI R3, 0               ; col
ed_scan_loop:
        CMP R1, R4
        JNC ed_scan_done
        NOP
        LDI 10
        MOV R5, R0
        LD R0, R1, 0
        ADD R1, 1
        CMP R0, R5
        JNZ ed_scan_col
        NOP
        ADD R2, 1
        LSI R3, 0
        LDI ed_scan_loop
        MOV PC, R0
        NOP
        NOP
ed_scan_col:
        ADD R3, 1
        LDI ed_scan_loop
        MOV PC, R0
        NOP
        NOP
ed_scan_done:
        LDI ed_cline
        MOV R5, R0
        ST R2, R5, 0
        LDI ed_ccol
        MOV R5, R0
        ST R3, R5, 0
        ; top: line < top -> top = line; line >= top+22 -> top = line-21
        LDI ed_top
        MOV R5, R0
        LD R0, R5, 0
        CMP R2, R0
        JNC ed_scan_below
        NOP
        ST R2, R5, 0
        JMP LR
        NOP
ed_scan_below:
        LDI ed_top
        MOV R5, R0
        LD R0, R5, 0
        LDI 22
        MOV R1, R0
        ADD R0, R1
        CMP R2, R0
        JC ed_scan_ret
        NOP
        MOV R0, R2
        LDI 21
        MOV R1, R0
        SUB R0, R1
        ST R0, R5, 0
ed_scan_ret:
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_clear: fill the 24x82 tile map with spaces.
; ---------------------------------------------------------------------
ed_clear:
        LDI 0x0FFF
        INV R0
        MVS ES, R0
        LDI SCR_MAP
        MOV R1, R0
        LDI 1
        SL R0, 15               ; 0x8000
        MOV R3, R0
        LDI 1968
        MOV R4, R0
ed_clear_loop:
        STS R3, ES, R1
        ADD R1, 1
        SUB R4, 1
        JNZ ed_clear_loop
        NOP
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_insert: insert R3 at the cursor.
; ---------------------------------------------------------------------
ed_insert:
        LDI ed_pre
        MOV R2, R0
        LD R1, R2, 0
        LDI ed_post
        MOV R5, R0
        LD R0, R5, 0
        CMP R1, R0
        JNC ed_insert_full
        NOP
        ST R3, R1, 0
        ADD R1, 1
        ST R1, R2, 0
        LDI ed_cur
        MOV R2, R0
        LD R0, R2, 0
        ADD R0, 1
        ST R0, R2, 0
        LDI ed_len
        MOV R2, R0
        LD R0, R2, 0
        ADD R0, 1
        ST R0, R2, 0
        LDI ed_dirty
        MOV R2, R0
        LSI R0, 1
        ST R0, R2, 0
ed_insert_full:
        JMP LR
        NOP

; ed_back: delete before the cursor.
ed_back:
        LDI ed_pre
        MOV R2, R0
        LD R1, R2, 0
        LDI 1
        SL R0, 14
        CMP R1, R0
        JZ ed_back_done
        NOP
        SUB R1, 1
        ST R1, R2, 0
        LDI ed_cur
        MOV R2, R0
        LD R0, R2, 0
        SUB R0, 1
        ST R0, R2, 0
        LDI ed_len
        MOV R2, R0
        LD R0, R2, 0
        SUB R0, 1
        ST R0, R2, 0
        LDI ed_dirty
        MOV R2, R0
        LSI R0, 1
        ST R0, R2, 0
ed_back_done:
        JMP LR
        NOP

; ed_delete: delete at the cursor.
ed_delete:
        LDI ed_cur
        MOV R2, R0
        LD R1, R2, 0
        LDI ed_len
        MOV R5, R0
        LD R0, R5, 0
        CMP R1, R0
        JNC ed_delete_done
        NOP
        LDI ed_post
        MOV R2, R0
        LD R1, R2, 0
        ADD R1, 1
        ST R1, R2, 0
        LDI ed_len
        MOV R2, R0
        LD R0, R2, 0
        SUB R0, 1
        ST R0, R2, 0
        LDI ed_dirty
        MOV R2, R0
        LSI R0, 1
        ST R0, R2, 0
ed_delete_done:
        JMP LR
        NOP

; ed_left / ed_right: move the gap one cell.
ed_left:
        LDI ed_cur
        MOV R2, R0
        LD R0, R2, 0
        AND R0, R0
        JZ ed_left_done
        NOP
        LDI ed_pre
        MOV R5, R0
        LD R1, R5, 0
        SUB R1, 1
        ST R1, R5, 0
        LDI ed_post
        MOV R5, R0
        LD R3, R5, 0
        SUB R3, 1
        ST R3, R5, 0
        LD R0, R1, 0
        ST R0, R3, 0
        LDI ed_cur
        MOV R2, R0
        LD R0, R2, 0
        SUB R0, 1
        ST R0, R2, 0
ed_left_done:
        JMP LR
        NOP

ed_right:
        LDI ed_cur
        MOV R2, R0
        LD R3, R2, 0
        LDI ed_len
        MOV R5, R0
        LD R1, R5, 0
        CMP R3, R1
        JNC ed_right_done
        NOP
        LDI ed_pre
        MOV R5, R0
        LD R1, R5, 0
        LDI ed_post
        MOV R5, R0
        LD R3, R5, 0
        LD R0, R3, 0
        ST R0, R1, 0
        ADD R1, 1
        LDI ed_pre
        MOV R5, R0
        ST R1, R5, 0
        ADD R3, 1
        LDI ed_post
        MOV R5, R0
        ST R3, R5, 0
        LDI ed_cur
        MOV R2, R0
        LD R0, R2, 0
        ADD R0, 1
        ST R0, R2, 0
ed_right_done:
        JMP LR
        NOP

; ed_goto: move the cursor to text offset R1 (bounded by the text length).
ed_goto:
        LDI ed_lr_goto
        MOV R2, R0
        ST LR, R2, 0
ed_goto_loop:
        LDI ed_cur
        MOV R2, R0
        LD R0, R2, 0
        CMP R0, R1
        JZ ed_goto_done
        NOP
        JC ed_goto_right
        NOP
        LDI ed_left
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_goto_loop
        MOV PC, R0
        NOP
ed_goto_right:
        LDI ed_right
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_goto_loop
        MOV PC, R0
        NOP
ed_goto_done:
        LDI ed_lr_goto
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ed_bol: move to the beginning of the current line.
ed_bol:
        LDI ed_lr_nav1
        MOV R2, R0
        ST LR, R2, 0
ed_bol_loop:
        LDI ed_cur
        MOV R2, R0
        LD R3, R2, 0
        AND R3, R3
        JZ ed_bol_done
        NOP
        LDI ed_pre
        MOV R2, R0
        LD R1, R2, 0
        SUB R1, 1
        LDI 10
        MOV R3, R0
        LD R0, R1, 0
        CMP R0, R3
        JZ ed_bol_done
        NOP
        LDI ed_left
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_bol_loop
        MOV PC, R0
        NOP
ed_bol_done:
        LDI ed_lr_nav1
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ed_eol: move to the end of the current line (the LF or the text end).
ed_eol:
        LDI ed_lr_nav2
        MOV R2, R0
        ST LR, R2, 0
ed_eol_loop:
        LDI ed_cur
        MOV R2, R0
        LD R3, R2, 0
        LDI ed_len
        MOV R5, R0
        LD R4, R5, 0
        CMP R3, R4
        JZ ed_eol_done
        NOP
        LDI ed_post
        MOV R2, R0
        LD R1, R2, 0
        LDI 10
        MOV R3, R0
        LD R0, R1, 0
        CMP R0, R3
        JZ ed_eol_done
        NOP
        LDI ed_right
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_eol_loop
        MOV PC, R0
        NOP
ed_eol_done:
        LDI ed_lr_nav2
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ed_right_to: R6 = columns to move right, stopping at LF or EOF.
ed_right_to:
        LDI ed_lr_nav3
        MOV R2, R0
        ST LR, R2, 0
ed_rt_loop:
        AND R6, R6
        JZ ed_rt_done
        NOP
        LDI ed_cur
        MOV R2, R0
        LD R3, R2, 0
        LDI ed_len
        MOV R5, R0
        LD R4, R5, 0
        CMP R3, R4
        JZ ed_rt_done
        NOP
        LDI ed_post
        MOV R2, R0
        LD R1, R2, 0
        LDI 10
        MOV R3, R0
        LD R0, R1, 0
        CMP R0, R3
        JZ ed_rt_done
        NOP
        LDI ed_right
        MOV R4, R0
        LINK
        JMP R4
        NOP
        SUB R6, 1
        LDI ed_rt_loop
        MOV PC, R0
        NOP
ed_rt_done:
        LDI ed_lr_nav3
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ed_up: previous line, same column.
ed_up:
        LDI ed_lr_nav4
        MOV R2, R0
        ST LR, R2, 0
        LDI ed_ccol
        MOV R2, R0
        LD R6, R2, 0
        LDI ed_bol
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_cur
        MOV R2, R0
        LD R3, R2, 0
        AND R3, R3
        JZ ed_up_done
        NOP
        LDI ed_left
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_bol
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_right_to
        MOV R4, R0
        LINK
        JMP R4
        NOP
ed_up_done:
        LDI ed_lr_nav4
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ed_down: next line, same column.
ed_down:
        LDI ed_lr_nav5
        MOV R2, R0
        ST LR, R2, 0
        LDI ed_ccol
        MOV R2, R0
        LD R6, R2, 0
        LDI ed_eol
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_cur
        MOV R2, R0
        LD R3, R2, 0
        LDI ed_len
        MOV R5, R0
        LD R4, R5, 0
        CMP R3, R4
        JZ ed_down_done
        NOP
        LDI ed_right
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_right_to
        MOV R4, R0
        LINK
        JMP R4
        NOP
ed_down_done:
        LDI ed_lr_nav5
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ed_home / ed_end
ed_home:
        LDI ed_lr_goto
        MOV R2, R0
        ST LR, R2, 0
        LDI ed_bol
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_lr_goto
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

ed_end:
        LDI ed_lr_nav6
        MOV R2, R0
        ST LR, R2, 0
        LDI ed_eol
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_lr_nav6
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_draw_all: scan, then draw the 23 text rows and the cursor.
; ---------------------------------------------------------------------
ed_draw_all:
        LDI ed_lr_draw
        MOV R2, R0
        ST LR, R2, 0
        LDI ed_scan
        MOV R4, R0
        LINK
        JMP R4
        NOP

        LDI 1
        SL R0, 14
        MOV R3, R0
        LDI ed_tmp
        MOV R2, R0
        ST R3, R2, 0            ; ptr
        LSI R3, 0
        LDI ed_tmp2
        MOV R2, R0
        ST R3, R2, 0            ; line
ed_skip_top:
        LDI ed_tmp2
        MOV R2, R0
        LD R3, R2, 0
        LDI ed_top
        MOV R2, R0
        LD R4, R2, 0
        CMP R3, R4
        JNC ed_skip_done
        NOP
ed_skip_line:
        LDI ed_tmp
        MOV R2, R0
        LD R1, R2, 0
        LDI ed_getc
        MOV R4, R0
        LINK
        JMP R4
        NOP
        MOV R3, R0
        LDI ed_tmp
        MOV R2, R0
        ST R1, R2, 0
        LDI -1
        MOV R2, R0
        CMP R3, R2
        JZ ed_skip_done
        NOP
        LDI 10
        MOV R2, R0
        CMP R3, R2
        JZ ed_skip_next
        NOP
        LDI ed_skip_line
        MOV PC, R0
        NOP
        NOP
ed_skip_next:
        LDI ed_tmp2
        MOV R2, R0
        LD R3, R2, 0
        ADD R3, 1
        ST R3, R2, 0
        LDI ed_skip_top
        MOV PC, R0
        NOP
        NOP
ed_skip_done:
        LSI R6, 0               ; row
ed_draw_row:
        LDI SCR_ROWS
        MOV R2, R0
        CMP R6, R2
        JNC ed_draw_cursor
        NOP
        LSI R7, 0               ; col
ed_draw_col:
        LDI SCR_COLS
        MOV R2, R0
        CMP R7, R2
        JNC ed_draw_next_row
        NOP
        LDI ed_tmp
        MOV R2, R0
        LD R1, R2, 0
        LDI ed_getc
        MOV R4, R0
        LINK
        JMP R4
        NOP
        MOV R3, R0
        LDI ed_tmp
        MOV R2, R0
        ST R1, R2, 0
        LDI -1
        MOV R2, R0
        CMP R3, R2
        JZ ed_draw_pad
        NOP
        LDI 10
        MOV R2, R0
        CMP R3, R2
        JZ ed_draw_next_row
        NOP
        MOV R1, R6
        MOV R2, R7
        LDI 1
        SL R0, 15
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ADD R7, 1
        LDI ed_draw_col
        MOV PC, R0
        NOP
        NOP
ed_draw_pad:
        LDI SCR_COLS
        MOV R2, R0
        CMP R7, R2
        JNC ed_draw_next_row
        NOP
        LDI 32
        MOV R3, R0
        MOV R1, R6
        MOV R2, R7
        LDI 1
        SL R0, 15
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ADD R7, 1
        LDI ed_draw_pad
        MOV PC, R0
        NOP
        NOP
ed_draw_next_row:
        ADD R6, 1
        LDI ed_draw_row
        MOV PC, R0
        NOP
        NOP
ed_draw_cursor:
        LDI ed_cline
        MOV R2, R0
        LD R6, R2, 0
        LDI ed_top
        MOV R2, R0
        LD R3, R2, 0
        SUB R6, R3
        LDI SCR_ROWS
        MOV R2, R0
        CMP R6, R2
        JNC ed_draw_done
        NOP
        LDI ed_ccol
        MOV R2, R0
        LD R7, R2, 0
        LDI SCR_COLS
        MOV R2, R0
        CMP R7, R2
        JNC ed_draw_done
        NOP
        LDI 32
        MOV R3, R0
        LDI ed_pre
        MOV R2, R0
        LD R1, R2, 0
        LDI ed_post
        MOV R2, R0
        LD R2, R2, 0
        CMP R1, R2
        JNC ed_draw_cursor_go
        NOP
        LD R3, R1, 0
ed_draw_cursor_go:
        MOV R1, R6
        MOV R2, R7
        LDI 0x7000
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
ed_draw_done:
        LDI ed_lr_draw
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_digit: R3 = value, R5 = divisor -> R0 = digit, R3 = remainder.
; ---------------------------------------------------------------------
ed_digit:
        LSI R0, 0
ed_digit_loop:
        CMP R3, R5
        JC ed_digit_done
        NOP
        SUB R3, R5
        ADD R0, 1
        LDI ed_digit_loop
        MOV PC, R0
        NOP
        NOP
ed_digit_done:
        JMP LR
        NOP

; ed_num4 / ed_num3: draw R3 at (R1 row, R2 col), decimal, R4 attr.
ed_num4:
        LDI ed_lr_num
        MOV R6, R0
        ST LR, R6, 0
        LDI 1000
        MOV R5, R0
        LDI ed_digit
        MOV R6, R0
        LINK
        JMP R6
        NOP
        MOV R6, R0
        LDI '0'
        MOV R3, R0
        ADD R3, R6
        LDI ed_cell
        MOV R6, R0
        LINK
        JMP R6
        NOP
        ADD R2, 1
        LDI 100
        MOV R5, R0
        LDI ed_digit
        MOV R6, R0
        LINK
        JMP R6
        NOP
        MOV R6, R0
        LDI '0'
        MOV R3, R0
        ADD R3, R6
        LDI ed_cell
        MOV R6, R0
        LINK
        JMP R6
        NOP
        ADD R2, 1
        LDI 10
        MOV R5, R0
        LDI ed_digit
        MOV R6, R0
        LINK
        JMP R6
        NOP
        MOV R6, R0
        LDI '0'
        MOV R3, R0
        ADD R3, R6
        LDI ed_cell
        MOV R6, R0
        LINK
        JMP R6
        NOP
        ADD R2, 1
        LDI 1
        MOV R5, R0
        LDI ed_digit
        MOV R6, R0
        LINK
        JMP R6
        NOP
        MOV R6, R0
        LDI '0'
        MOV R3, R0
        ADD R3, R6
        LDI ed_cell
        MOV R6, R0
        LINK
        JMP R6
        NOP
        ADD R2, 1
        LDI ed_lr_num
        MOV R6, R0
        LD LR, R6, 0
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_status: row 23, name, dirty mark, line:col and message.
; ---------------------------------------------------------------------
ed_status:
        LDI ed_lr_stat
        MOV R2, R0
        ST LR, R2, 0
        ; clear row 23
        LSI R6, 0
ed_stat_clear:
        LDI SCR_COLS
        MOV R2, R0
        CMP R6, R2
        JNC ed_stat_name
        NOP
        LDI 23
        MOV R1, R0
        MOV R2, R6
        LDI 32
        MOV R3, R0
        LDI 0x7000
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ADD R6, 1
        LDI ed_stat_clear
        MOV PC, R0
        NOP
        NOP
ed_stat_name:
        LDI NAME_BUF
        MOV R7, R0
        LSI R8, 0
ed_stat_name_loop:
        LD R3, R7, 0
        AND R3, R3
        JZ ed_stat_star
        NOP
        LDI 12
        MOV R2, R0
        CMP R8, R2
        JNC ed_stat_star
        NOP
        LDI 23
        MOV R1, R0
        MOV R2, R8
        LDI 0x7000
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ADD R7, 1
        ADD R8, 1
        LDI ed_stat_name_loop
        MOV PC, R0
        NOP
        NOP
ed_stat_star:
        LDI ed_dirty
        MOV R2, R0
        LD R3, R2, 0
        AND R3, R3
        JZ ed_stat_pos
        NOP
        LDI 23
        MOV R1, R0
        LSI R2, 13
        LDI '*'
        MOV R3, R0
        LDI 0x7000
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
ed_stat_pos:
        LDI 23
        MOV R1, R0
        LSI R2, 15
        LDI 'L'
        MOV R3, R0
        LDI 0x7000
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ; line at 16
        LDI 23
        MOV R1, R0
        LDI 16
        MOV R2, R0
        LDI ed_cline
        MOV R3, R0
        LD R3, R3, 0
        LDI 0x7000
        MOV R4, R0
        LDI ed_num4
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ; ':' at 20
        LDI 23
        MOV R1, R0
        LDI 20
        MOV R2, R0
        LDI ':'
        MOV R3, R0
        LDI 0x7000
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ; col at 21
        LDI 23
        MOV R1, R0
        LDI 21
        MOV R2, R0
        LDI ed_ccol
        MOV R3, R0
        LD R3, R3, 0
        LDI 0x7000
        MOV R4, R0
        LDI ed_num4
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ; message at 26
        LDI MSG_BUF
        MOV R7, R0
        LDI 26
        MOV R8, R0
ed_stat_msg:
        LD R3, R7, 0
        AND R3, R3
        JZ ed_stat_done
        NOP
        LDI SCR_COLS
        MOV R2, R0
        CMP R8, R2
        JNC ed_stat_done
        NOP
        LDI 23
        MOV R1, R0
        MOV R2, R8
        LDI 0x7000
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ADD R7, 1
        ADD R8, 1
        LDI ed_stat_msg
        MOV PC, R0
        NOP
        NOP
ed_stat_done:
        LDI ed_lr_stat
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP
; ---------------------------------------------------------------------
; ed_draw_text: R1 row, R2 col, R3 = NUL string, R4 attr.
; ---------------------------------------------------------------------
ed_draw_text:
        LDI ed_lr_str
        MOV R2, R0
        ST LR, R2, 0
        MOV R6, R3
        MOV R7, R1
        MOV R8, R2
        MOV R9, R4
ed_dt_loop:
        LDS R3, CS, R6
        AND R3, R3
        JZ ed_dt_done
        NOP
        MOV R1, R7
        MOV R2, R8
        MOV R4, R9
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ADD R6, 1
        ADD R8, 1
        LDI ed_dt_loop
        MOV PC, R0
        NOP
ed_dt_done:
        LDI ed_lr_str
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_set_msg: R3 = NUL string -> MSG_BUF.
; ---------------------------------------------------------------------
ed_set_msg:
        LDI MSG_BUF
        MOV R1, R0
        MOV R2, R3
ed_sm_loop:
        LDS R0, CS, R2
        ST R0, R1, 0
        AND R0, R0
        JZ ed_sm_done
        NOP
        ADD R1, 1
        ADD R2, 1
        LDI ed_sm_loop
        MOV PC, R0
        NOP
ed_sm_done:
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_ask_name: prompt on row 23 and read the name into NAME_BUF.
; ---------------------------------------------------------------------
ed_ask_name:
        LDI ed_lr_ask
        MOV R2, R0
        ST LR, R2, 0
        LDI NAME_BUF
        MOV R2, R0
        LSI R3, 0
        ST R3, R2, 0
        LDI ed_namelen
        MOV R2, R0
        ST R3, R2, 0
        ; clear row 23
        LSI R6, 0
ed_ask_clear:
        LDI SCR_COLS
        MOV R2, R0
        CMP R6, R2
        JNC ed_ask_prompt
        NOP
        LDI 23
        MOV R1, R0
        MOV R2, R6
        LDI 32
        MOV R3, R0
        LDI 0x7000
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ADD R6, 1
        LDI ed_ask_clear
        MOV PC, R0
        NOP
ed_ask_prompt:
        LDI 23
        MOV R1, R0
        LSI R2, 0
        LDI ed_prompt
        MOV R3, R0
        LDI 0x7000
        MOV R4, R0
        LDI ed_draw_text
        MOV R5, R0
        LINK
        JMP R5
        NOP
ed_ask_key:
        LDI 0x0FFF
        INV R0
        MVS ES, R0
        LDI 0x0060
        MOV R1, R0
        LDS R0, ES, R1
        AND R0, R0
        JZ ed_ask_key
        NOP
        LDI 0x0062
        MOV R1, R0
        LDS R0, ES, R1
        MOV R3, R0
        LDI 0x00FF
        MOV R1, R0
        AND R3, R1
        LDI ed_tmp
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_tmp
        MOV R3, R0
        LD R3, R3, 0
        ; CR / LF
        LDI 13
        MOV R2, R0
        CMP R3, R2
        JZ ed_ask_done
        NOP
        LDI 10
        MOV R2, R0
        CMP R3, R2
        JZ ed_ask_done
        NOP
        ; BS / DEL
        LDI 8
        MOV R2, R0
        CMP R3, R2
        JZ ed_ask_bs
        NOP
        LDI 127
        MOV R2, R0
        CMP R3, R2
        JZ ed_ask_bs
        NOP
        ; printable only
        LDI 32
        MOV R2, R0
        CMP R3, R2
        JC ed_ask_key
        NOP
        LDI 127
        MOV R2, R0
        CMP R3, R2
        JNC ed_ask_key
        NOP
        ; len < 40
        LDI ed_namelen
        MOV R2, R0
        LD R6, R2, 0
        LDI 40
        MOV R5, R0
        CMP R6, R5
        JNC ed_ask_key
        NOP
        ; NAME_BUF[len] = char
        LDI NAME_BUF
        MOV R1, R0
        ADD R1, R6
        LDI ed_tmp
        MOV R5, R0
        LD R3, R5, 0
        ST R3, R1, 0
        ADD R1, 1
        LSI R3, 0
        ST R3, R1, 0
        ADD R6, 1
        ST R6, R2, 0
        ; draw at row 23, col 6 + len - 1
        LDI 23
        MOV R1, R0
        MOV R2, R6
        ADD R2, 5
        LDI ed_tmp
        MOV R5, R0
        LD R3, R5, 0
        LDI 0x7000
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
        LDI ed_ask_key
        MOV PC, R0
        NOP
ed_ask_bs:
        LDI ed_namelen
        MOV R2, R0
        LD R6, R2, 0
        AND R6, R6
        JZ ed_ask_key
        NOP
        SUB R6, 1
        ST R6, R2, 0
        LDI NAME_BUF
        MOV R1, R0
        ADD R1, R6
        LSI R3, 0
        ST R3, R1, 0
        ; erase the last character cell
        LDI 23
        MOV R1, R0
        MOV R2, R6
        ADD R2, 6
        LDI 32
        MOV R3, R0
        LDI 0x7000
        MOV R4, R0
        LDI ed_cell
        MOV R5, R0
        LINK
        JMP R5
        NOP
        LDI ed_ask_key
        MOV PC, R0
        NOP
ed_ask_done:
        LDI ed_lr_ask
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_load: look the name up, read one text slice into the gap.
; ---------------------------------------------------------------------
ed_load:
        LDI ed_lr_load
        MOV R2, R0
        ST LR, R2, 0
        LSI R7, 2
        LDI NAME_BUF
        MOV R1, R0
        LSI R4, 0
        LDI ed_bdos
        MOV R5, R0
        LINK
        JMP R5
        NOP
        MOV R6, R0
        MOV R3, R0
        LDI ed_slice
        MOV R2, R0
        ST R3, R2, 0
        LDI -1
        MOV R2, R0
        CMP R6, R2
        JZ ed_load_new
        NOP
        ; read the raw slice
        LSI R7, 11
        LDI ed_slice
        MOV R2, R0
        LD R1, R2, 0
        LDI RAW_BUF
        MOV R4, R0
        LDI ed_bdos
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ; type must be 3 (text)
        LDI RAW_BUF
        MOV R2, R0
        LD R3, R2, 0
        LDI 0x00FF
        MOV R2, R0
        AND R3, R2
        LDI 3
        MOV R2, R0
        CMP R3, R2
        JNZ ed_load_bad
        NOP
        ; size
        LDI 29
        MOV R7, R0
        LDI ed_slice
        MOV R2, R0
        LD R1, R2, 0
        LSI R4, 0
        LDI ed_bdos
        MOV R5, R0
        LINK
        JMP R5
        NOP
        MOV R6, R0              ; fsize result
        LDI 2040
        MOV R2, R0
        CMP R6, R2
        JC ed_load_size
        NOP
        MOV R6, R2
ed_load_size:
        MOV R3, R6
        LDI ed_len
        MOV R2, R0
        ST R3, R2, 0
        ; post = 0xC000 - len
        LDI 0x4000
        MOV R3, R0
        SUB R3, R6
        LDI ed_post
        MOV R2, R0
        ST R3, R2, 0
        ; copy len chars from RAW_BUF+8 to post
        LDI RAW_BUF
        MOV R1, R0
        ADD R1, 8
        LDI ed_post
        MOV R2, R0
        LD R2, R2, 0
        LDI ed_len
        MOV R3, R0
        LD R3, R3, 0
ed_load_copy:
        AND R3, R3
        JZ ed_load_copied
        NOP
        LD R0, R1, 0
        ST R0, R2, 0
        ADD R1, 1
        ADD R2, 1
        SUB R3, 1
        LDI ed_load_copy
        MOV PC, R0
        NOP
ed_load_copied:
        LDI 1
        SL R0, 14
        MOV R3, R0
        LDI ed_pre
        MOV R2, R0
        ST R3, R2, 0
        LSI R3, 0
        LDI ed_cur
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_top
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_dirty
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_msg_empty
        MOV R3, R0
        LDI ed_set_msg
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_lr_load
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP
ed_load_new:
        LDI -1
        MOV R3, R0
        LDI ed_slice
        MOV R2, R0
        ST R3, R2, 0
        LSI R3, 0
        LDI ed_len
        MOV R2, R0
        ST R3, R2, 0
        LDI 1
        SL R0, 14
        MOV R3, R0
        LDI ed_pre
        MOV R2, R0
        ST R3, R2, 0
        LDI 0x4000
        MOV R3, R0
        LDI ed_post
        MOV R2, R0
        ST R3, R2, 0
        LSI R3, 0
        LDI ed_cur
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_top
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_dirty
        MOV R2, R0
        ST R3, R2, 0
        LDI ed_msg_new
        MOV R3, R0
        LDI ed_set_msg
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_lr_load
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP
ed_load_bad:
        LDI ed_msg_bad
        MOV R3, R0
        LDI ed_set_msg
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_msg_bad
        MOV R3, R0
        LDI ed_set_msg
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_lr_load
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_save: write the text as one type-3 slice (create when new).
; ---------------------------------------------------------------------
ed_save:
        LDI ed_lr_save
        MOV R2, R0
        ST LR, R2, 0
        LDI ed_slice
        MOV R2, R0
        LD R6, R2, 0
        LDI -1
        MOV R3, R0
        CMP R6, R3
        JNZ ed_save_have
        NOP
        LDI 27
        MOV R7, R0
        LDI NAME_BUF
        MOV R1, R0
        LSI R4, 3
        LDI ed_bdos
        MOV R5, R0
        LINK
        JMP R5
        NOP
        MOV R6, R0
        LDI -1
        MOV R2, R0
        CMP R6, R2
        JZ ed_save_create_fail
        NOP
        LDI ed_slice
        MOV R2, R0
        ST R6, R2, 0
ed_save_have:
        ; read the slice header/payload into RAW_BUF
        LSI R7, 11
        LDI ed_slice
        MOV R2, R0
        LD R1, R2, 0
        LDI RAW_BUF
        MOV R4, R0
        LDI ed_bdos
        MOV R5, R0
        LINK
        JMP R5
        NOP
        ; one slice only
        LDI RAW_BUF
        MOV R2, R0
        ADD R2, 1
        LDI -1
        MOV R3, R0
        ST R3, R2, 0
        ; copy the pre-gap text
        LDI 1
        SL R0, 14
        MOV R1, R0
        LDI RAW_BUF
        MOV R2, R0
        ADD R2, 8
        LDI ed_cur
        MOV R3, R0
        LD R3, R3, 0
ed_save_pre:
        AND R3, R3
        JZ ed_save_post
        NOP
        LD R0, R1, 0
        ST R0, R2, 0
        ADD R1, 1
        ADD R2, 1
        SUB R3, 1
        LDI ed_save_pre
        MOV PC, R0
        NOP
ed_save_post:
        LDI ed_post
        MOV R1, R0
        LD R1, R1, 0
        LDI ed_len
        MOV R3, R0
        LD R3, R3, 0
        LDI ed_cur
        LD R0, R0, 0
        SUB R3, R0
ed_save_post_loop:
        AND R3, R3
        JZ ed_save_pad
        NOP
        LD R0, R1, 0
        ST R0, R2, 0
        ADD R1, 1
        ADD R2, 1
        SUB R3, 1
        LDI ed_save_post_loop
        MOV PC, R0
        NOP
ed_save_pad:
        ; fill the remaining payload with LF
        LDI ed_len
        MOV R5, R0
        LD R5, R5, 0
        LDI 2040
        MOV R4, R0
        SUB R4, R5
ed_save_pad_loop:
        AND R4, R4
        JZ ed_save_write
        NOP
        LDI 10
        MOV R3, R0
        ST R3, R2, 0
        ADD R2, 1
        SUB R4, 1
        LDI ed_save_pad_loop
        MOV PC, R0
        NOP
ed_save_write:
        ; bd_count = 2048 in the caller's DS
        LDI 0x2FB8
        MOV R2, R0
        LDI 2048
        MOV R3, R0
        ST R3, R2, 0
        LSI R7, 7
        LDI ed_slice
        MOV R2, R0
        LD R1, R2, 0
        LDI RAW_BUF
        MOV R4, R0
        LDI ed_bdos
        MOV R5, R0
        LINK
        JMP R5
        NOP
        MOV R6, R0
        LDI 0x0800
        MOV R2, R0
        CMP R6, R2
        JNZ ed_save_fail
        NOP
        LDI ed_dirty
        MOV R2, R0
        LSI R3, 0
        ST R3, R2, 0
        LDI ed_msg_saved
        MOV R3, R0
        LDI ed_set_msg
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_lr_save
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP
ed_save_fail:
        LDI ed_msg_sfail
        MOV R3, R0
        LDI ed_set_msg
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_lr_save
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP
ed_save_create_fail:
        LDI ed_msg_cfail
        MOV R3, R0
        LDI ed_set_msg
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_lr_save
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ---------------------------------------------------------------------
; ed_open: ask for a name and load it.
; ---------------------------------------------------------------------
ed_open:
        LDI ed_lr_open
        MOV R2, R0
        ST LR, R2, 0
        LDI ed_ask_name
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_load
        MOV R4, R0
        LINK
        JMP R4
        NOP
        LDI ed_lr_open
        MOV R2, R0
        LD LR, R2, 0
        JMP LR
        NOP

; ---------------------------------------------------------------------
; Strings (one character per cell).
; ---------------------------------------------------------------------
ed_prompt:
    .text "file: "
ed_msg_empty:
    .word 0
ed_msg_new:
    .text "new file"
ed_msg_bad:
    .text "not a text slice"
ed_msg_saved:
    .text "saved"
ed_msg_sfail:
    .text "save failed"
ed_msg_cfail:
    .text "create failed"
ed_msg_dirty:
    .text "unsaved: ^S save, ^Q again"
