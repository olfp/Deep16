; frogger_demo.asm - the FiT per-row scrolling backdrop, widescreen layout.
;
; A Frogger-style backdrop with no player: five river lanes and four road
; lanes, each moving independently, drawn as double-height 32x30 game tiles.
; The point is the horizontal scroll: control 6 gives each tilemap row a 0..7
; pixel fine offset, while the row content itself is rewritten by whole cells
; when the fine offset wraps.
;
; Assembled with .org 0 and placed at physical 0x4350 (CS=DS=0x0435) in the
; free image gap.  The menu jumps here with R10/R11 as the return pair.  Q
; returns to the menu.
;
; Tile art (added to the tile bank by make_tile_font):
;   tile 57 water, 58 road, 59 grass, 60 car red, 61 car yellow, 62 log,
;   63 panel.  The demo installs palette set 2 entries for pixel indices 1..7
;   at run time.
;
; Screen layout, top to bottom (24 tile rows = 12 double-height lanes):
;   0..1   top bank: static; left panel row 0 = SCORE, row 1 = HI
;   2..3   river lane 1
;   4..5   river lane 2
;   6..7   river lane 3 (fast)
;   8..9   river lane 4
;   10..11 river lane 5
;   12..13 median grass
;   14..15 road lane 1
;   16..17 road lane 2
;   18..19 road lane 3
;   20..21 road lane 4 (top truck lane)
;   22..23 bottom bank: static; left panel row 23 = LIVES/TIME
;
; Columns 0..23 are the uniform left panel; columns 24..79 are the 448-pixel
; playfield; 80..81 are its right margins for the fine phase.  The column
; scroll window (control 5 bit 11, bound in control 6 row 31) keeps the panel
; at fine 0 while the playfield rows use their per-row phase.

.equ SEG_TILE -0x0F00          ; 0xF100 tilemap
.equ SEG_CTRL -0x0E00          ; 0xF200 controls
.equ SEG_OAM  -0x0A00          ; 0xF600 OAM + palette
.equ SEG_UART -0xFFC           ; 0xF004 UART/status

; tile values (tile index << 5)
.equ T_WATER  0x720
.equ T_ROAD   0x740
.equ T_GRASS  0x760
.equ T_CAR_R  0x780
.equ T_CAR_Y  0x7A0
.equ T_LOG    0x7C0
.equ T_PANEL  0x000           ; blank tile; palette art entry 0 is the panel

; state (inside the block, after the code)
.equ FR_START  0x380           ; nine 0..15 coarse start cells
.equ FR_PHASE  0x389           ; nine 0..7 fine phases
.equ FR_LASTF  0x392
.equ FR_RET10  0x393
.equ FR_RET11  0x394
.equ FR_DIRTY  0x395           ; nine "row changed last frame" cells
.equ FR_FRONT  0x39E           ; displayed tilemap bank
.equ FR_BACK   0x39F           ; write tilemap bank
.equ FR_TIME   0x3A0           ; time bar cells left (0..56)
.equ FR_TICK   0x3A1           ; frames until the next cell
.equ FR_BARD   0x3A2           ; bar dirty flag

.org 0
fr_entry:
    MVS R0, CS
    MVS DS, R0
    LDI FR_RET10
    MOV R2, R0
    ST R10, R2, 0
    LDI FR_RET11
    MOV R2, R0
    ST R11, R2, 0

    ; Re-entry starts on a known bank pair with no stale dirty rows.
    LSI R3, 0
    LDI FR_FRONT
    MOV R2, R0
    ST R3, R2, 0
    LSI R3, 1
    LDI FR_BACK
    MOV R2, R0
    ST R3, R2, 0
    LSI R3, 0
    LDI FR_DIRTY
    MOV R2, R0
    LSI R4, 9
fr_clear_dirty:
    ST R3, R2, 0
    ADD R2, 1
    SUB R4, 1
    JNZ fr_clear_dirty
    NOP

    ; Time bar starts full; the middle strip shows 56 cells of time.
    LDI FR_TIME
    MOV R2, R0
    LDI 24
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_TICK
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI FR_BARD
    MOV R2, R0
    ST R3, R2, 0

    ; remember the current frame bit so the first wait sees a change
    LDI SEG_UART
    MVS ES, R0
    LDI 0x26
    MOV R2, R0
    LDS R1, ES, R2
    LSI R3, 2
    AND R1, R3
    LDI FR_LASTF
    MOV R2, R0
    ST R1, R2, 0

    ; controls: cursor off, no scroll, page 0, palette set 2
    LDI SEG_CTRL
    MVS ES, R0
    LSI R3, 0
    LSI R2, 0
    STS R3, ES, R2             ; control 0 cursor
    LSI R2, 2
    STS R3, ES, R2             ; control 1 row offset
    LSI R2, 4
    STS R3, ES, R2             ; control 2 scroll_x = 0
    LSI R2, 6
    STS R3, ES, R2             ; control 3 scroll_y = 0
    LSI R2, 8
    STS R3, ES, R2             ; control 4 page 0
    LSI R2, 0x0A
    LDI 0xA00
    MOV R3, R0
    STS R3, ES, R2             ; control 5 palette 2, OAM 0, scroll window
    LSI R2, 0x0C
    LDI 0x2EF8                 ; control 6 row 31: last panel column 23
    MOV R3, R0
    STS R3, ES, R2

    ; clear the OAM descriptors so the menu's sprites do not show through
    LDI SEG_OAM
    MVS ES, R0
    LSI R2, 0
    LSI R3, 0
    LDI 16
    MOV R4, R0
fr_oam_clear:
    STS R3, ES, R2
    ADD R2, 1
    SUB R4, 1
    JNZ fr_oam_clear
    NOP

    ; palette set 2, art bank: entry 0 is the left panel, 1..6 the art
    LDI 0x110
    MOV R2, R0
    LDI 0x49                  ; panel blue-grey
    MOV R3, R0
    STS R3, ES, R2
    ADD R2, 1
    LDI 0x03                  ; water
    MOV R3, R0
    STS R3, ES, R2
    ADD R2, 1
    LDI 0x4A                  ; road
    MOV R3, R0
    STS R3, ES, R2
    ADD R2, 1
    LDI 0x1C                  ; grass
    MOV R3, R0
    STS R3, ES, R2
    ADD R2, 1
    LDI 0xE0                  ; car red
    MOV R3, R0
    STS R3, ES, R2
    ADD R2, 1
    LDI 0xFC                  ; car yellow
    MOV R3, R0
    STS R3, ES, R2
    ADD R2, 1
    LDI 0x89                  ; log brown
    MOV R3, R0
    STS R3, ES, R2

    ; Palette set 2 text bank 0/1, used by the static HUD text cells.
    LDI 0x100
    MOV R2, R0
    LDI 0x49
    MOV R3, R0
    STS R3, ES, R2             ; panel colour behind the HUD text
    ADD R2, 1
    LDI 0xFF
    MOV R3, R0
    STS R3, ES, R2             ; white

    ; Paint both tilemap banks with the same panel, banks, lanes and HUD.  The
    ; demo ping-pongs the banks, so the first swap must expose a complete copy.
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 8
    LSI R3, 0
    STS R3, ES, R2             ; display 0, write bank 0
    LDI fr_init_paint
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 8
    LSI R3, 1
    STS R3, ES, R2             ; display 0, write bank 1
    LDI fr_init_paint
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; enable per-row fine scroll on both rows of every moving lane
    LSI R6, 0
fr_rows_init:
    LDI fr_rows
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2             ; base row
    LDI FR_PHASE
    MOV R2, R0
    ADD R2, R6
    LDS R5, DS, R2             ; initial phase

    ; control 6 for the base row
    LDI 0x100
    MOV R2, R0
    MOV R3, R8
    SL R3, 3
    ADD R2, R3
    ADD R2, R5
    LDI SEG_CTRL
    MVS ES, R0
    LSI R3, 0x0C
    STS R2, ES, R3

    ; control 6 for the second row of the lane
    LDI 0x100
    MOV R2, R0
    MOV R3, R8
    ADD R3, 1
    SL R3, 3
    ADD R2, R3
    ADD R2, R5
    LSI R3, 0x0C
    STS R2, ES, R3

    ADD R6, 1
    LDI 9
    MOV R3, R0
    CMP R6, R3
    JNC fr_rows_done
    NOP
    LDI fr_rows_init
    MOV PC, R0
    NOP
fr_rows_done:

; =====================================================================
; Main loop
; =====================================================================
fr_loop:
    LDI fr_wait
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_keys
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; The display shows FR_FRONT; write into FR_BACK until the end of frame.
    LDI FR_FRONT
    MOV R2, R0
    LD R3, R2, 0
    SL R3, 1
    LDI FR_BACK
    MOV R2, R0
    LD R4, R2, 0
    OR R3, R4
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 8
    STS R3, ES, R2

    ; Rows changed in the previous frame are now displayed but not in the new
    ; back copy; repaint them there before adding this frame's changes.
    LSI R6, 0
fr_dirty_tick:
    LDI FR_DIRTY
    MOV R2, R0
    ADD R2, R6
    LDS R3, DS, R2
    AND R3, R3
    JZ fr_dirty_next
    NOP
    LSI R3, 0
    ST R3, R2, 0
    LDI fr_paint_lane
    MOV R4, R0
    LINK
    JMP R4
    NOP
fr_dirty_next:
    ADD R6, 1
    LDI 9
    MOV R3, R0
    CMP R6, R3
    JNC fr_dirty_done
    NOP
    LDI fr_dirty_tick
    MOV PC, R0
    NOP
fr_dirty_done:

    ; Copy a previous time-bar change into the new back copy.
    LDI FR_BARD
    MOV R2, R0
    LDS R3, DS, R2
    AND R3, R3
    JZ fr_bard_done
    NOP
    LSI R3, 0
    ST R3, R2, 0
    LDI fr_bar
    MOV R4, R0
    LINK
    JMP R4
    NOP
fr_bard_done:

    ; One time-bar cell every 32 frames (about 30 s for 56 cells).
    LDI FR_TICK
    MOV R2, R0
    LDS R3, DS, R2
    ADD R3, 1
    LDI 64
    MOV R4, R0
    CMP R3, R4
    JC fr_tick_small
    NOP
    ; tick wrapped: FR_TICK = 0
    LDI FR_TICK
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    ; FR_TIME--, or reset to 56 when empty
    LDI FR_TIME
    MOV R2, R0
    LDS R5, DS, R2
    AND R5, R5
    JZ fr_tick_reset
    NOP
    SUB R5, 1
    LDI fr_tick_time
    MOV PC, R0
    NOP
fr_tick_reset:
    LDI 24
    MOV R5, R0
fr_tick_time:
    ST R5, R2, 0
    ; Paint the new bar into the back and mark it for the new back copy.
    LDI fr_bar
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI FR_BARD
    MOV R2, R0
    LSI R3, 1
    ST R3, R2, 0
    LDI fr_tick_done
    MOV PC, R0
    NOP
fr_tick_small:
    LDI FR_TICK
    MOV R2, R0
    ST R3, R2, 0
fr_tick_done:

    LSI R6, 0
fr_lane_tick:
    LDI fr_update
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R6, 1
    LDI 9
    MOV R3, R0
    CMP R6, R3
    JNC fr_swap
    NOP
    LDI fr_lane_tick
    MOV PC, R0
    NOP

fr_swap:
    ; Ask for FR_BACK to be displayed at the next frame boundary.  The control
    ; 6 table written above latches on that same boundary, so the coarse cell
    ; shift and the new fine phase become visible together.
    LDI FR_BACK
    MOV R2, R0
    LD R4, R2, 0
    MOV R3, R4
    SL R3, 1
    OR R3, R4
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 8
    STS R3, ES, R2
    ; front = back; back = 1 - back
    LDI FR_FRONT
    MOV R2, R0
    ST R4, R2, 0
    LSI R3, 1
    SUB R3, R4
    LDI FR_BACK
    MOV R2, R0
    ST R3, R2, 0
    LDI fr_loop
    MOV PC, R0
    NOP

; =====================================================================
; One lane: advance its phase/start, write control 6 for both rows, and
; repaint both rows into the back bank when the coarse cell changes.
; R6 = lane index, preserved.
; =====================================================================
fr_update:
    MOV R12, LR
    LDI fr_rows
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2             ; base row
    LDI fr_dirs
    MOV R2, R0
    ADD R2, R6
    LDS R7, DS, R2             ; 0 left, 1 right
    LDI fr_speeds
    MOV R2, R0
    ADD R2, R6
    LDS R5, DS, R2             ; speed
    LDI FR_PHASE
    MOV R2, R0
    ADD R2, R6
    LDS R4, DS, R2             ; phase
    LDI FR_START
    MOV R2, R0
    ADD R2, R6
    LDS R9, DS, R2             ; start
    LSI R10, 0                 ; coarse cell changed

    AND R7, R7
    JNZ fr_up_right
    NOP
    ; left: phase += speed
    ADD R4, R5
    CMP R4, 8
    JC fr_up_store
    NOP
    SUB R4, 8
    ADD R9, 1
    LSI R2, 15
    AND R9, R2
    LSI R10, 1
    LDI fr_up_store
    MOV PC, R0
    NOP
fr_up_right:
    ; right: phase -= speed
    SUB R4, R5
    JNN fr_up_store
    NOP
    ADD R4, 8
    SUB R9, 1
    LSI R2, 15
    AND R9, R2
    LSI R10, 1
fr_up_store:
    LDI FR_PHASE
    MOV R2, R0
    ADD R2, R6
    ST R4, R2, 0
    LDI FR_START
    MOV R2, R0
    ADD R2, R6
    ST R9, R2, 0

    ; control 6 = 0x100 | row << 3 | phase, for both rows of the lane
    LDI 0x100
    MOV R2, R0
    MOV R3, R8
    SL R3, 3
    ADD R2, R3
    ADD R2, R4
    LDI SEG_CTRL
    MVS ES, R0
    LSI R3, 0x0C
    STS R2, ES, R3

    LDI 0x100
    MOV R2, R0
    MOV R3, R8
    ADD R3, 1
    SL R3, 3
    ADD R2, R3
    ADD R2, R4
    LSI R3, 0x0C
    STS R2, ES, R3

    ; The fine phase above and the display swap both latch at the next frame
    ; boundary, so paint the shifted lanes into the back bank now.  The front
    ; bank stays live; no line is composed from a half-written row.
    AND R10, R10
    JZ fr_up_done
    NOP
    LDI fr_paint_lane
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI FR_DIRTY
    MOV R2, R0
    ADD R2, R6
    LSI R3, 1
    ST R3, R2, 0
fr_up_done:
    MOV LR, R12
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Paint both rows of lane R6 into the current write bank with its current
; start.  Preserves R6; clobbers R0-R5,R7-R11,R13,R14.
; ---------------------------------------------------------------------
fr_paint_lane:
    MOV R13, LR
    MOV R11, R6
    LDI fr_rows
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2
    LDI FR_START
    MOV R2, R0
    ADD R2, R6
    LDS R9, DS, R2
    LDI fr_masks
    MOV R2, R0
    ADD R2, R6
    LDS R5, DS, R2
    LDI fr_bgs
    MOV R2, R0
    ADD R2, R6
    LDS R6, DS, R2
    LDI fr_objs
    MOV R2, R0
    ADD R2, R11
    LDS R7, DS, R2
    LDI fr_paint
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; LINK overwrites LR (R14), so reload the base row from the table.
    LDI fr_rows
    MOV R2, R0
    ADD R2, R11
    LDS R8, DS, R2
    ADD R8, 1
    LDI fr_paint
    MOV R4, R0
    LINK
    JMP R4
    NOP
    MOV R6, R11
    MOV LR, R13
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Paint the playfield part of one row: R8 row, R9 start, R5 mask,
; R6 background tile, R7 object tile.  Writes columns 24..81 (56 visible
; cells plus two margins).  Preserves R6/R7/R11/R14; clobbers R0-R5,R8-R10.
; ---------------------------------------------------------------------
fr_paint:
    LDI 82
    MOV R2, R0
    MOV R3, R8
    MUL R3, R2                 ; row * 82
    LDI 24
    MOV R4, R0
    ADD R3, R4                 ; playfield starts at column 24
    LDI SEG_TILE
    MVS ES, R0
    LSI R10, 0
fr_p_col:
    MOV R4, R10
    ADD R4, R9
    LSI R2, 15
    AND R4, R2
    LDI fr_bitmask
    MOV R2, R0
    ADD R2, R4
    LDS R2, DS, R2             ; one-hot bit
    TBS R5, R2
    JZ fr_p_bg
    NOP
    MOV R2, R7
    LDI fr_p_store
    MOV PC, R0
    NOP
fr_p_bg:
    MOV R2, R6
fr_p_store:
    STS R2, ES, R3
    ADD R3, 1
    ADD R10, 1
    LDI 58
    MOV R2, R0
    CMP R10, R2
    JNC fr_p_done
    NOP
    LDI fr_p_col
    MOV PC, R0
    NOP
fr_p_done:
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Paint the middle-strip time bar into the current write bank.
; Rows 12-13, columns 24-79: yellow cells for FR_TIME, panel for the rest.
; Clobbers R0-R5,R8-R10,R13.
; ---------------------------------------------------------------------
fr_bar:
    MOV R13, LR
    LDI FR_TIME
    MOV R2, R0
    LDS R5, DS, R2             ; cells remaining
    LDI 12
    MOV R8, R0
fr_bar_row:
    LDI 82
    MOV R2, R0
    MOV R3, R8
    MUL R3, R2
    LDI SEG_TILE
    MVS ES, R0
    LSI R10, 0
fr_bar_col:
    CMP R10, R5
    JC fr_bar_fill
    NOP
    LSI R2, 0                  ; empty track: panel tile
    LDI fr_bar_store
    MOV PC, R0
    NOP
fr_bar_fill:
    LDI T_CAR_Y
    MOV R2, R0
fr_bar_store:
    STS R2, ES, R3
    ADD R3, 1
    ADD R10, 1
    LDI 24
    MOV R4, R0
    CMP R10, R4
    JNC fr_bar_row_done
    NOP
    LDI fr_bar_col
    MOV PC, R0
    NOP
fr_bar_row_done:
    ADD R8, 1
    LDI 14
    MOV R4, R0
    CMP R8, R4
    JNC fr_bar_done
    NOP
    LDI fr_bar_row
    MOV PC, R0
    NOP
fr_bar_done:
    MOV LR, R13
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Fill one row: panel columns 0..23, grass playfield columns 24..81.
; R8 row.  Clobbers R2-R5; preserves R8.
; ---------------------------------------------------------------------
fr_fill_row:
    LDI 82
    MOV R2, R0
    MOV R3, R8
    MUL R3, R2
    LDI SEG_TILE
    MVS ES, R0

    LDI T_PANEL
    MOV R2, R0
    LSI R4, 0
fr_fill_panel:
    STS R2, ES, R3
    ADD R3, 1
    ADD R4, 1
    LDI 24
    MOV R5, R0
    CMP R4, R5
    JNC fr_fill_grass_start
    NOP
    LDI fr_fill_panel
    MOV PC, R0
    NOP
fr_fill_grass_start:
    LDI T_GRASS
    MOV R2, R0
    LSI R4, 0
fr_fill_grass:
    STS R2, ES, R3
    ADD R3, 1
    ADD R4, 1
    LDI 58
    MOV R5, R0
    CMP R4, R5
    JNC fr_fill_done
    NOP
    LDI fr_fill_grass
    MOV PC, R0
    NOP
fr_fill_done:
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Fill the current write bank with the panel, banks, lanes and HUD.
; Called once per bank; clobbers R0-R14.
; ---------------------------------------------------------------------
fr_init_paint:
    MOV R12, LR

    LSI R8, 0
fr_init_row:
    LDI fr_fill_row
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R8, 1
    LDI 24
    MOV R3, R0
    CMP R8, R3
    JNC fr_init_rows_done
    NOP
    LDI fr_init_row
    MOV PC, R0
    NOP
fr_init_rows_done:

    LSI R6, 0
fr_init_lane:
    LDI fr_paint_lane
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R6, 1
    LDI 9
    MOV R3, R0
    CMP R6, R3
    JNC fr_init_lanes_done
    NOP
    LDI fr_init_lane
    MOV PC, R0
    NOP
fr_init_lanes_done:

    ; Time bar in the static middle strip.
    LDI fr_bar
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; Static HUD in the left panel's top and bottom rows.
    LSI R9, 0
    LSI R10, 2
    LDI str_score
    MOV R8, R0
    LDI fr_text
    MOV R4, R0
    LINK
    JMP R4
    NOP

    LSI R9, 1
    LSI R10, 2
    LDI str_hi
    MOV R8, R0
    LDI fr_text
    MOV R4, R0
    LINK
    JMP R4
    NOP

    LDI 23
    MOV R9, R0
    LSI R10, 2
    LDI str_lives
    MOV R8, R0
    LDI fr_text
    MOV R4, R0
    LINK
    JMP R4
    NOP

    MOV LR, R12
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Draw an ASCII string as text cells.  R8 string pointer, R9 row, R10 col.
; Text cells use font pair 0 and style 0.  Clobbers R1-R3,R5,R8,R13,R14.
; ---------------------------------------------------------------------
fr_text:
    MOV R13, LR
    MOV R14, R9
    LDI 82
    MOV R2, R0
    MOV R3, R14
    MUL R3, R2
    ADD R3, R10
    LDI SEG_TILE
    MVS ES, R0
    LDI 0x2000
    MOV R5, R0
    SL R5, 2                   ; 0x8000, the text-cell bit
fr_t_loop:
    LDS R1, DS, R8
    AND R1, R1
    JZ fr_t_done
    NOP
    LDI 0x20
    MOV R2, R0
    SUB R1, R2
    SL R1, 5
    OR R1, R5
    STS R1, ES, R3
    ADD R3, 1
    ADD R8, 1
    LDI fr_t_loop
    MOV PC, R0
    NOP
fr_t_done:
    MOV LR, R13
    JMP LR
    NOP

; =====================================================================
; Frame sync and Q
; =====================================================================
fr_wait:
    LDI SEG_UART
    MVS ES, R0
    LDI 0x26
    MOV R2, R0
fr_w_loop:
    LDS R1, ES, R2
    LSI R3, 2
    AND R1, R3
    LDI FR_LASTF
    MOV R4, R0
    LD R5, R4, 0
    CMP R1, R5
    JZ fr_w_loop
    NOP
    ST R1, R4, 0
    JMP LR
    NOP

fr_keys:
    LDI SEG_UART
    MVS ES, R0
    LDI 0x26
    MOV R2, R0
    LDS R1, ES, R2
    LSI R3, 8
    AND R1, R3
    JZ fr_k_done
    NOP
    LSI R2, 2
    LDS R1, ES, R2
    LDI 0x71
    MOV R3, R0
    CMP R1, R3
    JZ fr_exit
    NOP
    LDI 0x51
    MOV R3, R0
    CMP R1, R3
    JZ fr_exit
    NOP
fr_k_done:
    JMP LR
    NOP

fr_exit:
    ; clear the per-row table and return the menu to palette set 0
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 0x0A
    LSI R3, 0
    STS R3, ES, R2
    LSI R6, 0
fr_x_loop:
    MOV R2, R6
    SL R2, 3
    LSI R3, 0x0C
    STS R2, ES, R3
    ADD R6, 1
    LDI 26
    MOV R3, R0
    CMP R6, R3
    JNC fr_x_done
    NOP
    LDI fr_x_loop
    MOV PC, R0
    NOP
fr_x_done:
    LSI R2, 8
    LSI R3, 0
    STS R3, ES, R2             ; display and write bank 0 for the menu
    LSI R2, 2
    LSI R3, 0
    STS R3, ES, R2             ; scroll_x = 0
    ; Let the bank-0 swap latch before the menu draws into it.
    LDI fr_wait
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI FR_RET10
    MOV R2, R0
    LD R10, R2, 0
    LDI FR_RET11
    MOV R2, R0
    LD R11, R2, 0
    JML R10
    NOP

; =====================================================================
; Lane data (nine lanes, two rows each)
; =====================================================================
fr_rows:
    .word 2, 4, 6, 8, 10, 14, 16, 18, 20
fr_masks:
    .word 0x0F0F, 0x0F0F, 0x0F0F, 0x0F0F, 0x0F0F
    .word 0x0F0F, 0x0F0F, 0x0F0F, 0x0F0F
fr_bgs:
    .word T_WATER, T_WATER, T_WATER, T_WATER, T_WATER
    .word T_ROAD, T_ROAD, T_ROAD, T_ROAD
fr_objs:
    .word T_LOG, T_LOG, T_LOG, T_LOG, T_LOG
    .word T_CAR_R, T_CAR_Y, T_CAR_R, T_CAR_Y
fr_dirs:
    .word 1, 0, 1, 1, 0        ; river top->bottom: right, left, fast right, right, left
    .word 0, 1, 0, 1           ; road top->bottom: left, right, left, right
fr_speeds:
    .word 1, 1, 2, 1, 1
    .word 1, 1, 1, 1

fr_bitmask:
    .word 0x0001, 0x0002, 0x0004, 0x0008
    .word 0x0010, 0x0020, 0x0040, 0x0080
    .word 0x0100, 0x0200, 0x0400, 0x0800
    .word 0x1000, 0x2000, 0x4000, 0x8000

str_score:
    .text "SCORE 000000"
str_hi:
    .text "HI 000000"
str_lives:
    .text "LIVES 3  TIME 60"

; =====================================================================
; Writable state
; =====================================================================
.org 0x380
fr_start_state:
    .word 0, 3, 6, 9, 12, 1, 4, 7, 10
; Start the lanes at different phases so their coarse shifts (and the
; back-bank repaints) do not all land on the same frame.
fr_phase_state:
    .word 7, 7, 5, 2, 4, 3, 5, 1, 7
fr_last:
    .word 0
fr_ret10:
    .word 0
fr_ret11:
    .word 0
fr_dirty:
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0
fr_front:
    .word 0
fr_back:
    .word 1
fr_time:
    .word 24
fr_tick:
    .word 0
fr_bard:
    .word 0
