; pole_game.asm - the playable Pole Position-style racer.
;
; This replaces pole_board.asm as the slice driver. It runs the same renderer
; and state helpers as the benchmark, then adds the game around them:
;
;   - direct PS/2 polling (the slice has no SWI vector of its own);
;   - steering through ST_PLAYER_X, speed through the phase advance;
;   - six opponents in the state block, recycled to the horizon (the
;     player's 64x32 car uses two of the eight OAM slots);
;   - world-space collision on (lateral - playerX);
;   - lap, time and speed on row 0, messages on row 1.
;
; The HUD is drawn after pole_render has selected the new bank, so it lands on
; the visible map and is redrawn every frame.
;
; Segment layout stays as the renderer documents it: code below 0x0C00, art
; at 0x1000/0x1400/0x2600, state and scratch where the renderer expects them.

.equ SEG_IO    -0x1000          ; 0xF000
.equ SEG_TILE  -0x0F00          ; 0xF100

.equ ST_PHASE    0x04B0
.equ ST_HILL     0x04B2
.equ ST_HORIZON  0x04B4
.equ ST_PLAYER_X 0x04B6
.equ ST_BANK     0x04B8
.equ ST_OPP      0x04C0

; The game's own cells, above the renderer's descriptors.
.equ G_SPEED   0x0520
.equ G_LAP     0x0521
.equ G_TICKS   0x0522
.equ G_SEC     0x0523
.equ G_DIST    0x0524
.equ G_CRASH   0x0525
.equ G_FRAME   0x0526
.equ G_FINISH  0x0527
.equ G_RET10   0x0528
.equ G_RET11   0x0529
.equ G_LR1     0x052A
.equ G_LR2     0x052B
.equ G_LR3     0x052C
.equ G_LR4     0x052D
.equ G_ROW     0x052E
.equ G_COL     0x052F

.org 0
pole_start:
    MVS R0, CS
    MVS DS, R0
    LDI G_RET10
    MOV R2, R0
    ST R10, R2, 0
    LDI G_RET11
    MOV R2, R0
    ST R11, R2, 0
    LDI pole_program
    MOV PC, R0
    NOP

.org 0x0120
pole_program:
    LDI game_main
    MOV PC, R0
    NOP

; ---------------------------------------------------------------------------
; game_main: copy the art, initialise the state and run frames until Esc/Q.
; ---------------------------------------------------------------------------
.org 0x0600
game_main:
    LDI pole_art_copy
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pole_state_init
    MOV R4, R0
    LINK
    JMP R4
    NOP

    LSI R3, 0
    LDI G_SPEED
    MOV R2, R0
    ST R3, R2, 0
    LDI G_TICKS
    MOV R2, R0
    ST R3, R2, 0
    LDI G_SEC
    MOV R2, R0
    ST R3, R2, 0
    LDI G_DIST
    MOV R2, R0
    ST R3, R2, 0
    LDI G_CRASH
    MOV R2, R0
    ST R3, R2, 0
    LDI G_FRAME
    MOV R2, R0
    ST R3, R2, 0
    LDI G_FINISH
    MOV R2, R0
    ST R3, R2, 0
    LDI 1
    LDI G_LAP
    MOV R2, R0
    ST R0, R2, 0

    ; one frame before the first key, so the track is on screen
    LDI pole_dirty_prepare
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pole_render
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI game_hud
    MOV R4, R0
    LINK
    JMP R4
    NOP

game_loop:
    ; one iteration is one display frame: the renderer and the logic fit in
    ; the 60 Hz budget, so wait for the frame toggle before the next update
    LDI game_wait_frame
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI game_poll
    MOV R4, R0
    LINK
    JMP R4
    NOP
    MOV R6, R0
    LSI R2, -1
    CMP R6, R2
    JZ game_frame
    NOP

    ; Esc or Q leaves the game
    LDI 0x1B
    MOV R2, R0
    CMP R6, R2
    JZ game_quit
    NOP
    LDI 0x51
    MOV R2, R0
    CMP R6, R2
    JZ game_quit
    NOP
    LDI 0x71
    MOV R2, R0
    CMP R6, R2
    JZ game_quit
    NOP

    ; left: C-B, A, a
    LDI 2
    MOV R2, R0
    CMP R6, R2
    JZ game_left
    NOP
    LDI 0x41
    MOV R2, R0
    CMP R6, R2
    JZ game_left
    NOP
    LDI 0x61
    MOV R2, R0
    CMP R6, R2
    JZ game_left
    NOP
    ; right: C-F, D, d
    LDI 6
    MOV R2, R0
    CMP R6, R2
    JZ game_right
    NOP
    LDI 0x44
    MOV R2, R0
    CMP R6, R2
    JZ game_right
    NOP
    LDI 0x64
    MOV R2, R0
    CMP R6, R2
    JZ game_right
    NOP
    ; up: C-P, W, w
    LDI 0x10
    MOV R2, R0
    CMP R6, R2
    JZ game_up
    NOP
    LDI 0x57
    MOV R2, R0
    CMP R6, R2
    JZ game_up
    NOP
    LDI 0x77
    MOV R2, R0
    CMP R6, R2
    JZ game_up
    NOP
    ; down: C-N, S, s
    LDI 0x0E
    MOV R2, R0
    CMP R6, R2
    JZ game_down
    NOP
    LDI 0x53
    MOV R2, R0
    CMP R6, R2
    JZ game_down
    NOP
    LDI 0x73
    MOV R2, R0
    CMP R6, R2
    JZ game_down
    NOP
    LDI game_frame
    MOV PC, R0
    NOP

game_left:
    LDI ST_PLAYER_X
    MOV R2, R0
    LD R3, R2, 0
    LDI 6
    MOV R4, R0
    SUB R3, R4
    LDI -128
    MOV R4, R0
    CMP R3, R4
    JNC game_left_ok
    NOP
    MOV R3, R4
game_left_ok:
    ST R3, R2, 0
    LDI game_frame
    MOV PC, R0
    NOP
game_right:
    LDI ST_PLAYER_X
    MOV R2, R0
    LD R3, R2, 0
    LDI 6
    MOV R4, R0
    ADD R3, R4
    LDI 128
    MOV R4, R0
    CMP R3, R4
    JC game_right_ok
    NOP
    MOV R3, R4
game_right_ok:
    ST R3, R2, 0
    LDI game_frame
    MOV PC, R0
    NOP
game_up:
    LDI G_SPEED
    MOV R2, R0
    LD R3, R2, 0
    LDI 4
    MOV R4, R0
    ADD R3, R4
    LDI 255
    MOV R4, R0
    CMP R3, R4
    JC game_up_ok
    NOP
    MOV R3, R4
game_up_ok:
    ST R3, R2, 0
    LDI game_frame
    MOV PC, R0
    NOP
game_down:
    LDI G_SPEED
    MOV R2, R0
    LD R3, R2, 0
    LDI 4
    MOV R4, R0
    SUB R3, R4
    AND R3, R3
    JNN game_down_ok
    NOP
    LSI R3, 0
game_down_ok:
    ST R3, R2, 0
    LDI game_frame
    MOV PC, R0
    NOP

game_quit:
    LDI G_RET10
    MOV R2, R0
    LD R10, R2, 0
    LDI G_RET11
    MOV R2, R0
    LD R11, R2, 0
    JML R10
    NOP

game_frame:
    ; ---- the clock and the distance -------------------------------------
    LDI G_TICKS
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0
    LDI 60
    MOV R4, R0
    CMP R3, R4
    JC game_no_sec
    NOP
    LSI R3, 0
    ST R3, R2, 0
    LDI G_SEC
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0
game_no_sec:
    ; coast when no key is held
    LDI G_SPEED
    MOV R2, R0
    LD R3, R2, 0
    LDI G_FRAME
    MOV R4, R0
    LD R5, R4, 0
    LDI 3
    MOV R6, R0
    AND R5, R6
    JNZ game_no_coast
    NOP
    AND R3, R3
    JZ game_no_coast
    NOP
    SUB R3, 1
    ST R3, R2, 0
game_no_coast:
    ; crash timer
    LDI G_CRASH
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ game_crash_done
    NOP
    SUB R3, 1
    ST R3, R2, 0
game_crash_done:
    ; distance += speed >> 4; a lap is 4096 units
    LDI G_SPEED
    MOV R2, R0
    LD R3, R2, 0
    SR R3, 4
    LDI G_DIST
    MOV R4, R0
    LD R5, R4, 0
    ADD R5, R3
    ST R5, R4, 0
    LDI 4096
    MOV R6, R0
    CMP R5, R6
    JC game_no_lap
    NOP
    SUB R5, R6
    ST R5, R4, 0
    LDI G_LAP
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0
    LDI 3
    MOV R4, R0
    CMP R3, R4
    JC game_no_lap
    NOP
    ; lap 4: finish, stop the car
    LDI G_FINISH
    MOV R2, R0
    LSI R3, 1
    ST R3, R2, 0
    LDI G_SPEED
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
game_no_lap:
    ; ---- opponents -------------------------------------------------------
    LDI game_opponents
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; ---- collision -------------------------------------------------------
    LDI game_collide
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; ---- the track -------------------------------------------------------
    LDI pole_state_advance
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; the road scrolls faster with the car: phase += speed >> 5
    LDI G_SPEED
    MOV R2, R0
    LD R3, R2, 0
    SR R3, 5
    LDI ST_PHASE
    MOV R2, R0
    LD R4, R2, 0
    ADD R4, R3
    LDI 63
    MOV R5, R0
    AND R4, R5
    ST R4, R2, 0
    ; ---- draw ------------------------------------------------------------
    LDI pole_dirty_prepare
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pole_render
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI game_hud
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; frame++
    LDI G_FRAME
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0
    LDI game_loop
    MOV PC, R0
    NOP


; ---------------------------------------------------------------------------
; game_wait_frame: spin until the 0xF0066 frame toggle changes. This paces
; the game at the display's 60 Hz instead of letting the loop free-run at
; whatever the renderer costs.
; ---------------------------------------------------------------------------
game_wait_frame:
    LDI SEG_IO
    MVS ES, R0
    LDI 0x0066
    MOV R2, R0
    LDS R1, ES, R2
    LSI R3, 2                 ; bit 1: the frame toggle
    AND R1, R3
    MOV R5, R1
gw_loop:
    LDS R1, ES, R2
    AND R1, R3
    CMP R1, R5
    JZ gw_loop
    NOP
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; game_poll: R0 = a decoded key, or -1 when the FIFO is empty.
; ---------------------------------------------------------------------------
game_poll:
    LDI 4                      ; BIOS getch decodes the raw FIFO event
    SWI
    SMV R0, AR0
    JMP LR
    NOP

 ; ---------------------------------------------------------------------------
; game_opponents: move each active opponent one band closer and recycle it
; to the horizon. The state record is { band, lateral, model, spare }.
; ---------------------------------------------------------------------------
game_opponents:
    LDI G_LR1
    MOV R2, R0
    ST LR, R2, 0
    LDI ST_OPP
    MOV R7, R0
    LSI R6, 6
game_opp_loop:
    LD R2, R7, 0               ; band
    AND R2, R2
    JN game_opp_next
    NOP
    SUB R2, 1
    JNN game_opp_store
    NOP
    ; recycle: band 18 + (frame & 3), lateral from the frame
    LDI G_FRAME
    MOV R3, R0
    LD R3, R3, 0
    LDI 3
    MOV R4, R0
    AND R3, R4
    LDI 18
    ADD R3, R0
    ST R3, R7, 0
    ; lateral = ((frame * 37) & 0xFF) - 128
    LDI G_FRAME
    MOV R3, R0
    LD R3, R3, 0
    LDI 37
    MOV R4, R0
    MOV R8, R3
    MOV R9, R4
    MUL32 R8, R9
    LDI 0x00FF
    MOV R4, R0
    AND R9, R4
    LDI 128
    MOV R4, R0
    SUB R9, R4
    ST R9, R7, 1
    ; model = frame & 3
    LDI G_FRAME
    MOV R3, R0
    LD R3, R3, 0
    LDI 3
    MOV R4, R0
    AND R3, R4
    ST R3, R7, 2
    LDI game_opp_next
    MOV PC, R0
    NOP
game_opp_store:
    ST R2, R7, 0
game_opp_next:
    ADD R7, 4
    SUB R6, 1
    JNZ game_opp_loop
    NOP
    LDI G_LR1
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; game_collide: a crash when an opponent in bands 0..2 is within 28 Q8 units
; of the player's lateral position.
; ---------------------------------------------------------------------------
game_collide:
    LDI G_LR2
    MOV R2, R0
    ST LR, R2, 0
    LDI G_CRASH
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JNZ game_coll_done
    NOP
    LDI G_FINISH
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JNZ game_coll_done
    NOP
    LDI ST_OPP
    MOV R7, R0
    LSI R6, 6
game_coll_loop:
    LD R2, R7, 0
    AND R2, R2
    JN game_coll_next
    NOP
    LDI 3
    MOV R3, R0
    CMP R2, R3
    JNC game_coll_next
    NOP
    LD R4, R7, 1               ; lateral
    LDI ST_PLAYER_X
    MOV R2, R0
    LD R3, R2, 0
    SUB R4, R3                 ; dx
    AND R4, R4
    JNN game_coll_abs
    NOP
    NEG R4
game_coll_abs:
    LDI 28
    MOV R3, R0
    CMP R4, R3
    JNC game_coll_next
    NOP
    ; crash
    LDI G_SPEED
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI G_CRASH
    MOV R2, R0
    LDI 45
    MOV R3, R0
    ST R3, R2, 0
    LDI game_coll_done
    MOV PC, R0
    NOP
game_coll_next:
    ADD R7, 4
    SUB R6, 1
    JNZ game_coll_loop
    NOP
game_coll_done:
    LDI G_LR2
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; HUD: row 0 "LAP n/3  TIME sss  SPEED sss", row 1 the state message.
; ---------------------------------------------------------------------------
game_hud:
    LDI G_LR3
    MOV R2, R0
    ST LR, R2, 0
    ; LAP
    LDI 0
    MOV R1, R0
    LSI R2, 0
    LDI hud_lap
    MOV R3, R0
    LDI game_str
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI 0
    MOV R1, R0
    LSI R2, 4
    LDI G_LAP
    MOV R3, R0
    LD R3, R3, 0
    LDI game_num1
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI 0
    MOV R1, R0
    LSI R2, 5
    LDI hud_of
    MOV R3, R0
    LDI game_str
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; TIME
    LDI 0
    MOV R1, R0
    LSI R2, 8
    LDI hud_time
    MOV R3, R0
    LDI game_str
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI 0
    MOV R1, R0
    LSI R2, 13
    LDI G_SEC
    MOV R3, R0
    LD R3, R3, 0
    LDI game_num3
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; SPEED
    LDI 0
    MOV R1, R0
    LDI 17
    MOV R2, R0
    LDI hud_speed
    MOV R3, R0
    LDI game_str
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI 0
    MOV R1, R0
    LDI 23
    MOV R2, R0
    LDI G_SPEED
    MOV R3, R0
    LD R3, R3, 0
    LDI game_num3
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; row 1 message
    LDI G_FINISH
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ game_hud_crash
    NOP
    LDI hud_finish
    MOV R3, R0
    LDI 1
    MOV R1, R0
    LSI R2, 0
    LDI game_str
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI game_hud_done
    MOV PC, R0
    NOP
game_hud_crash:
    LDI G_CRASH
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ game_hud_press
    NOP
    LDI hud_crash
    MOV R3, R0
    LDI 1
    MOV R1, R0
    LSI R2, 0
    LDI game_str
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI game_hud_done
    MOV PC, R0
    NOP
game_hud_press:
    LDI G_SPEED
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JNZ game_hud_done
    NOP
    LDI hud_press
    MOV R3, R0
    LDI 1
    MOV R1, R0
    LSI R2, 0
    LDI game_str
    MOV R4, R0
    LINK
    JMP R4
    NOP
game_hud_done:
    LDI G_LR3
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; game_cell: R1 row, R2 col, R3 char. Writes one font cell to the visible
; bank (the renderer has just selected it). Pair 0 is the text palette.
; ---------------------------------------------------------------------------
game_cell:
    MOV R5, R1
    SL R5, 6
    MOV R0, R1
    SL R0, 4
    ADD R5, R0
    MOV R0, R1
    SL R0, 1
    ADD R5, R0
    ADD R5, R2
    LDI 32
    CMP R3, R0
    JC game_cell_space
    NOP
    LDI 127
    CMP R3, R0
    JC game_cell_map
    NOP
game_cell_space:
    LDI 32
    MOV R3, R0
game_cell_map:
    LDI 32
    SUB R3, R0
    LDI 1
    SL R0, 15
    OR R3, R0
    LDI SEG_TILE
    MVS ES, R0
    STS R3, ES, R5
    JMP LR
    NOP

; game_str: R1 row, R2 col, R3 = NUL string.
game_str:
    MOV R7, R1
    MOV R8, R2
    MOV R6, R3
    LDI G_LR1
    MOV R2, R0
    ST LR, R2, 0
game_str_loop:
    LD R3, R6, 0
    AND R3, R3
    JZ game_str_done
    NOP
    MOV R1, R7
    MOV R2, R8
    LDI game_cell
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R6, 1
    ADD R8, 1
    LDI game_str_loop
    MOV PC, R0
    NOP
game_str_done:
    LDI G_LR1
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; game_num1: R1 row, R2 col, R3 = 0..9.
game_num1:
    MOV R7, R1
    MOV R8, R2
    LDI G_LR4
    MOV R2, R0
    ST LR, R2, 0
    LDI '0'
    MOV R4, R0
    ADD R3, R4
    MOV R1, R7
    MOV R2, R8
    LDI game_cell
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI G_LR4
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; game_num3: R1 row, R2 col, R3 = 0..999. Three digits, leading zeros.
game_num3:
    LDI G_LR2
    MOV R4, R0
    ST LR, R4, 0
    LDI G_ROW
    MOV R4, R0
    ST R1, R4, 0
    LDI G_COL
    MOV R4, R0
    ST R2, R4, 0
    ; hundreds
    LSI R7, 0
game_num3_h:
    LDI 100
    MOV R4, R0
    CMP R3, R4
    JC game_num3_h_done
    NOP
    SUB R3, R4
    ADD R7, 1
    LDI game_num3_h
    MOV PC, R0
    NOP
game_num3_h_done:
    MOV R9, R3
    LDI G_ROW
    MOV R4, R0
    LD R1, R4, 0
    LDI G_COL
    MOV R4, R0
    LD R2, R4, 0
    MOV R3, R7
    LDI game_num1
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI G_COL
    MOV R4, R0
    LD R2, R4, 0
    ADD R2, 1
    ST R2, R4, 0
    MOV R3, R9
    ; tens
    LSI R7, 0
game_num3_t:
    LDI 10
    MOV R4, R0
    CMP R3, R4
    JC game_num3_t_done
    NOP
    SUB R3, R4
    ADD R7, 1
    LDI game_num3_t
    MOV PC, R0
    NOP
game_num3_t_done:
    MOV R9, R3
    LDI G_ROW
    MOV R4, R0
    LD R1, R4, 0
    LDI G_COL
    MOV R4, R0
    LD R2, R4, 0
    MOV R3, R7
    LDI game_num1
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI G_COL
    MOV R4, R0
    LD R2, R4, 0
    ADD R2, 1
    ST R2, R4, 0
    MOV R3, R9
    LDI G_ROW
    MOV R4, R0
    LD R1, R4, 0
    LDI G_COL
    MOV R4, R0
    LD R2, R4, 0
    LDI game_num1
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI G_LR2
    MOV R4, R0
    LD LR, R4, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; The HUD strings.
; ---------------------------------------------------------------------------
.org 0x0580
hud_lap:
    .text "LAP "
hud_of:
    .text "/3"
hud_time:
    .text "TIME "
hud_speed:
    .text "SPEED "
hud_press:
    .text "PRESS UP"
hud_crash:
    .text "CRASH!"
hud_finish:
    .text "FINISH  Q=QUIT"
