; frogger_demo.asm - the FiT per-row scrolling backdrop.
;
; A Frogger-style backdrop with no player: five river lanes and five road
; lanes, each moving at its own direction and speed.  The point is the
; horizontal scroll: control 6 gives each tilemap row a 0..7 pixel fine offset,
; while the row content itself is rewritten by whole cells when the fine offset
; wraps.  Nothing else in the engine can move one row independently.
;
; Assembled with .org 0 and placed at physical 0x4350 (CS=DS=0x0435) in the
; free image gap.  The menu jumps here with R10/R11 as the return pair.  Q
; returns to the menu.
;
; Tile art (added to the tile bank by make_tile_font):
;   tile 57 water, 58 road, 59 grass, 60 car red, 61 car yellow, 62 log.
; The demo installs palette set 2 entries for pixel indices 1..6 at run time.
;
; Lane layout (tilemap rows, top to bottom):
;   0..3   top grass bank
;   4..8   river: right, left, right (fast), right, left
;   9      median grass
;   10..14 road: left, right, left, right, left (top lane trucks go left)
;   15..23 bottom grass bank

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

; state (inside the block, after the code)
.equ FR_START  0x300           ; ten 0..15 coarse start cells
.equ FR_PHASE  0x30A           ; ten 0..7 fine phases
.equ FR_LASTF  0x314
.equ FR_RET10  0x315
.equ FR_RET11  0x316

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
    LDI 0x200
    MOV R3, R0
    STS R3, ES, R2             ; control 5 palette set 2, OAM base 0

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

    ; palette set 2, art bank, entries 1..6
    LDI 0x111
    MOV R2, R0
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

    ; fill the whole screen with grass first
    LSI R8, 0
fr_grass_row:
    LSI R9, 0
    LSI R5, 0
    LDI T_GRASS
    MOV R6, R0
    MOV R7, R6
    LDI fr_paint
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R8, 1
    LDI 24
    MOV R3, R0
    CMP R8, R3
    JNC fr_grass_done
    NOP
    LDI fr_grass_row
    MOV PC, R0
    NOP
fr_grass_done:

    ; paint the ten lane rows at their initial coarse positions
    LSI R6, 0
fr_lane_init:
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
    MOV R6, R11
    ADD R6, 1
    LDI 10
    MOV R3, R0
    CMP R6, R3
    JNC fr_lanes_done
    NOP
    LDI fr_lane_init
    MOV PC, R0
    NOP
fr_lanes_done:

    ; enable per-row fine scroll on the lane rows (phase 0)
    LSI R6, 0
fr_rows_init:
    LDI fr_rows
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2
    LDI 0x100
    MOV R2, R0
    MOV R3, R8
    SL R3, 3
    ADD R2, R3
    LDI SEG_CTRL
    MVS ES, R0
    LSI R3, 0x0C
    STS R2, ES, R3
    ADD R6, 1
    LDI 10
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

    LSI R6, 0
fr_lane_tick:
    LDI fr_update
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R6, 1
    LDI 10
    MOV R3, R0
    CMP R6, R3
    JNC fr_loop
    NOP
    LDI fr_lane_tick
    MOV PC, R0
    NOP

; =====================================================================
; One lane: advance its phase/start and set control 6.
; R6 = lane index, preserved.
; =====================================================================
fr_update:
    MOV R12, LR
    LDI fr_rows
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2             ; row
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
    LSI R3, 0                  ; repaint flag

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
    LSI R3, 1
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
    LSI R3, 1
fr_up_store:
    LDI FR_PHASE
    MOV R2, R0
    ADD R2, R6
    ST R4, R2, 0
    LDI FR_START
    MOV R2, R0
    ADD R2, R6
    ST R9, R2, 0

    ; control 6 = 0x100 | row << 3 | phase
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

    ; rewrite the row when the coarse cell changed
    AND R3, R3
    JZ fr_up_done
    NOP
    MOV R11, R6
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
    MOV R6, R11
fr_up_done:
    MOV LR, R12
    JMP LR
    NOP

; =====================================================================
; Paint one row: R8 row, R9 start, R5 mask, R6 background tile,
; R7 object tile.  Preserves R6/R7/R11; clobbers R0-R5,R8-R10.
; =====================================================================
fr_paint:
    LDI 82
    MOV R2, R0
    MOV R3, R8
    MUL R3, R2                 ; row * 82
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
    LDI 80
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
    LSI R2, 2
    LSI R3, 0
    STS R3, ES, R2             ; scroll_x = 0
    LDI FR_RET10
    MOV R2, R0
    LD R10, R2, 0
    LDI FR_RET11
    MOV R2, R0
    LD R11, R2, 0
    JML R10
    NOP

; =====================================================================
; Lane data (ten entries, river rows 4..8 then road rows 10..14)
; =====================================================================
fr_rows:
    .word 4, 5, 6, 7, 8, 10, 11, 12, 13, 14
fr_masks:
    .word 0x1F1F, 0x1F1F, 0x1F1F, 0x1F1F, 0x1F1F
    .word 0x0F0F, 0x0F0F, 0x0F0F, 0x0F0F, 0x0F0F
fr_bgs:
    .word T_WATER, T_WATER, T_WATER, T_WATER, T_WATER
    .word T_ROAD, T_ROAD, T_ROAD, T_ROAD, T_ROAD
fr_objs:
    .word T_LOG, T_LOG, T_LOG, T_LOG, T_LOG
    .word T_CAR_R, T_CAR_Y, T_CAR_R, T_CAR_Y, T_CAR_R
fr_dirs:
    .word 1, 0, 1, 1, 0        ; rows 4..8 top->bottom: right, left, fast right, right, left
    .word 0, 1, 0, 1, 0        ; rows 10..14 top->bottom: left, right, left, right, left
fr_speeds:
    .word 1, 1, 2, 1, 1
    .word 1, 1, 1, 1, 1

fr_bitmask:
    .word 0x0001, 0x0002, 0x0004, 0x0008
    .word 0x0010, 0x0020, 0x0040, 0x0080
    .word 0x0100, 0x0200, 0x0400, 0x0800
    .word 0x1000, 0x2000, 0x4000, 0x8000

; =====================================================================
; Writable state
; =====================================================================
.org 0x300
fr_start_state:
    .word 0, 3, 6, 9, 12, 1, 4, 7, 10, 13
fr_phase_state:
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
fr_last:
    .word 0
fr_ret10:
    .word 0
fr_ret11:
    .word 0
