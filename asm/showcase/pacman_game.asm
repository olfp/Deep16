; pacman_game.asm - a first playable Pac-Man for the D16D showcase.
;
; Assembled standalone with .org 0 and placed at physical 0x4330, so it runs
; with CS = DS = 0x0433.  The menu enters with JML R0 (CS 0x0433, PC 0) and
; leaves R10/R11 as the far return pair, which the game saves and uses to
; JML back to the menu.
;
; Memory inside the block (offset from 0x4330):
;   0x000..0x5FF  code and its strings
;   0x610..0x66F  the static maze (generated pacman_map.asm)
;   0x678..0x686  direction tables (also generated)
;   0x688..0x69C  palette setup table (also generated)
;   0x6A0..0x6C9  writable game state
;
; The HUD is tilemap row 0.  Maze logical row r is tilemap row 1+r, and
; logical column c starts at tilemap column 8 + 2c.  Every logical cell is
; two 8-pixel cells wide, so the 32x24 maze fills columns 8..71 and rows
; 1..24 exactly.  Sprites are OAM descriptor 0 (Pac-Man); ghosts are two art
; cells each, redrawn only when they move.  Eaten dots are cleared in the
; RAM copy of the maze, so a ghost leaving a cell restores what is really
; left there.

.equ SEG_TILE -0x0F00          ; 0xF100 tilemap
.equ SEG_CTRL -0x0E00          ; 0xF200 controls
.equ SEG_OAM  -0x0A00          ; 0xF600 OAM + palette
.equ SEG_UART -0xFFC           ; 0xF004 UART/status

; generated art tile indices
.equ T_DOT_L     49
.equ T_DOT_R     50
.equ T_PELLET_L  51
.equ T_PELLET_R  52
.equ T_GHOST_L   53
.equ T_GHOST_R   54
.equ T_FRIGHT_L  55
.equ T_FRIGHT_R  56
.equ T_WALL_L    110
.equ T_WALL_R    118

; BIOS sound effects (function 9 starts, function 10 ticks once per frame).
.equ SFX_DEATH   3
.equ SFX_WAKA    4
.equ SFX_EAT     5

; ---- writable state (DS offsets 0x6A0..0x6C9) --------------------------
.equ ST_PAC_C     0x6A0
.equ ST_PAC_R     0x6A1
.equ ST_PAC_DIR   0x6A2
.equ ST_PAC_WANT  0x6A3
.equ ST_PAC_TMR   0x6A4
.equ ST_SC3       0x6C6        ; thousand, hundred, ten, one digits
.equ ST_SC2       0x6C7
.equ ST_SC1       0x6C8
.equ ST_SC0       0x6C9
.equ ST_DOTS      0x6A5
.equ ST_FRAME     0x6A9
.equ ST_LASTF     0x6AA
.equ ST_STATE     0x6AB        ; 0 play, 1 dead, 2 win
.equ ST_TIMER     0x6AC
.equ ST_FRIGHT    0x6AD
.equ ST_GHOST_T   0x6AE
.equ ST_BESTD     0x6AF
.equ ST_BESTDIST  0x6B0
.equ ST_NC        0x6B1
.equ ST_NR        0x6B2
.equ ST_RET10     0x6B3
.equ ST_RET11     0x6B4
.equ ST_LR_DRAW   0x6B5
.equ ST_LR_DGA    0x6B6
.equ ST_LR_TICK   0x6B7
.equ ST_LR_GMV    0x6B8
.equ ST_LR_REST   0x6B9
.equ ST_GHOST_C   0x6BA        ; four words
.equ ST_GHOST_R   0x6BE
.equ ST_GHOST_DIR 0x6C2

.org 0
; =====================================================================
; Entry
; =====================================================================
pac_entry:
    MVS R0, CS
    MVS DS, R0
    LDI ST_RET10
    MOV R2, R0
    ST R10, R2, 0
    LDI ST_RET11
    MOV R2, R0
    ST R11, R2, 0

    LDI pac_scene
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_setpal
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; score digits and frame counters
    LDI ST_SC3
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    ST R3, R2, 1
    ST R3, R2, 2
    ST R3, R2, 3
    LDI ST_DOTS
    MOV R2, R0
    ST R3, R2, 0
    LDI ST_FRAME
    MOV R2, R0
    ST R3, R2, 0
    LDI ST_STATE
    MOV R2, R0
    ST R3, R2, 0
    LDI ST_FRIGHT
    MOV R2, R0
    ST R3, R2, 0
    ; HUD label "SCORE" at row 0, column 33
    LSI R9, 0
    LDI 34
    MOV R10, R0
    LDI str_score
    MOV R8, R0
    LDI draw_text
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; draw the maze and count the dots
pac_draw_maze:
    LDI ST_DOTS
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LSI R7, 0                  ; row
mz_row:
    LSI R6, 0                  ; column
mz_col:
    MOV R8, R6
    MOV R9, R7
    MOV R1, R6
    MOV R2, R7
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LSI R3, 1
    CMP R0, R3
    JZ mz_wall
    NOP
    ; 0, 2 or 3
    AND R0, R0
    JZ mz_blank
    NOP
    LDI ST_DOTS
    MOV R1, R0
    LD R2, R1, 0
    ADD R2, 1
    ST R2, R1, 0
    LSI R3, 3
    CMP R0, R3
    JNZ mz_dot
    NOP
    LDI T_PELLET_L
    MOV R4, R0
    LDI T_PELLET_R
    MOV R2, R0
    LDI mz_scale
    MOV PC, R0
    NOP
mz_dot:
    LDI T_DOT_L
    MOV R4, R0
    LDI T_DOT_R
    MOV R2, R0
mz_scale:
    SL R4, 5
    SL R2, 5
    LDI mz_store
    MOV PC, R0
    NOP
mz_wall:
    ; the ghost door is drawn as text, not wall art
    LSI R3, 10
    CMP R9, R3
    JNZ mz_shape
    NOP
    LDI 14
    MOV R3, R0
    CMP R8, R3
    JN mz_shape
    NOP
    LDI 18
    CMP R8, R3
    JC mz_shape
    NOP
    LDI mz_door
    MOV PC, R0
    NOP
mz_shape:
    LSI R5, 0                 ; shape bits: 1 left, 2 top, 4 bottom
    AND R6, R6
    JZ mz_no_left
    NOP
    MOV R1, R6
    SUB R1, 1
    MOV R2, R7
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LSI R4, 1
    CMP R0, R4
    JZ mz_no_left
    NOP
    OR R5, 0
mz_no_left:
    LDI 31
    MOV R4, R0
    CMP R6, R4
    JNC mz_no_right
    NOP
    MOV R1, R6
    ADD R1, 1
    MOV R2, R7
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LSI R4, 1
    CMP R0, R4
    JZ mz_no_right
    NOP
    OR R5, 0
mz_no_right:
    AND R7, R7
    JZ mz_no_top
    NOP
    MOV R1, R6
    MOV R2, R7
    SUB R2, 1
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LSI R4, 1
    CMP R0, R4
    JZ mz_no_top
    NOP
    OR R5, 1
mz_no_top:
    LDI 23
    MOV R4, R0
    CMP R7, R4
    JNC mz_no_bottom
    NOP
    MOV R1, R6
    MOV R2, R7
    ADD R2, 1
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LSI R4, 1
    CMP R0, R4
    JZ mz_no_bottom
    NOP
    OR R5, 2
mz_no_bottom:
    LDI T_WALL_L
    MOV R4, R0
    ADD R4, R5
    SL R4, 5
    LDI T_WALL_R
    MOV R2, R0
    ADD R2, R5
    SL R2, 5
    LDI mz_store
    MOV PC, R0
    NOP
mz_door:
    LDI 0x03A0
    MOV R4, R0
    OR R4, 15                 ; text tile 0x8000 | pair 3 | '='
    MOV R2, R4
    LDI mz_store
    MOV PC, R0
    NOP
mz_blank:
    LSI R4, 0
    LSI R2, 0
mz_store:
    ; R3 = (row+1)*82 + 10 + 2*column
    MOV R3, R7
    ADD R3, 1
    MOV R1, R3
    SL R3, 6
    SL R1, 4
    ADD R3, R1
    MOV R1, R7
    ADD R1, 1
    SL R1, 1
    ADD R3, R1
    ADD R3, 8
    MOV R1, R6
    SL R1, 1
    ADD R3, R1
    LDI SEG_TILE
    MVS ES, R0
    STS R4, ES, R3
    ADD R3, 1
    STS R2, ES, R3
    ADD R6, 1
    LDI 32
    MOV R3, R0
    CMP R6, R3
    JNC mz_next_row
    NOP
    LDI mz_col
    MOV PC, R0
    NOP
mz_next_row:
    ADD R7, 1
    LDI 24
    MOV R3, R0
    CMP R7, R3
    JNC mz_done
    NOP
    LDI mz_row
    MOV PC, R0
    NOP
mz_done:

    ; Pac-Man starts on the empty centre pair below the house
    LDI ST_PAC_C
    MOV R2, R0
    LDI 15
    MOV R3, R0
    ST R3, R2, 0
    LDI ST_PAC_R
    MOV R2, R0
    LDI 17
    MOV R3, R0
    ST R3, R2, 0
    LDI ST_PAC_DIR
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI ST_PAC_WANT
    MOV R2, R0
    ST R3, R2, 0
    LDI ST_PAC_TMR
    MOV R2, R0
    LSI R3, 4
    ST R3, R2, 0
    LDI ST_GHOST_T
    MOV R2, R0
    LSI R3, 7
    ST R3, R2, 0

    ; four ghosts on the corridor above the house, all facing up
    LDI ST_GHOST_C
    MOV R2, R0
    LDI 14
    MOV R3, R0
    ST R3, R2, 0
    LDI 15
    MOV R3, R0
    ST R3, R2, 1
    LDI 16
    MOV R3, R0
    ST R3, R2, 2
    LDI 17
    MOV R3, R0
    ST R3, R2, 3
    LDI ST_GHOST_R
    MOV R2, R0
    LSI R3, 9
    ST R3, R2, 0
    ST R3, R2, 1
    ST R3, R2, 2
    ST R3, R2, 3
    LDI ST_GHOST_DIR
    MOV R2, R0
    LSI R3, 1
    ST R3, R2, 0
    ST R3, R2, 1
    ST R3, R2, 2
    ST R3, R2, 3

    LDI pac_draw_ghosts
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_sprite
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_draw_score
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; seed the frame detector so the first wait_frame waits one frame
    LDI SEG_UART
    MVS ES, R0
    LDI 0x26
    MOV R2, R0
    LDS R1, ES, R2
    LSI R3, 2
    AND R1, R3
    LDI ST_LASTF
    MOV R2, R0
    ST R1, R2, 0

; =====================================================================
; Main loop
; =====================================================================
pac_loop:
    LDI wait_frame
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; count the current sound effect down once per frame
    LDI 10
    SWI

    LDI ST_STATE
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_play
    NOP
    LDI pac_state
    MOV PC, R0
    NOP

pac_play:
    LDI pac_keys
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI ST_FRAME
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0

    ; frightened countdown; a transition back to normal repaints the ghosts
    LDI ST_FRIGHT
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_ghost_timer
    NOP
    SUB R3, 1
    ST R3, R2, 0
    AND R3, R3
    JNZ pac_ghost_timer
    NOP
    LDI pac_draw_ghosts
    MOV R4, R0
    LINK
    JMP R4
    NOP

pac_ghost_timer:
    LDI ST_GHOST_T
    MOV R2, R0
    LD R3, R2, 0
    SUB R3, 1
    ST R3, R2, 0
    JNZ pac_pac_timer
    NOP
    LSI R3, 7
    ST R3, R2, 0
    LDI pac_ghost_tick
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; a ghost may have landed on Pac-Man
    LDI pac_collide
    MOV PC, R0
    NOP

pac_pac_timer:
    LDI ST_PAC_TMR
    MOV R2, R0
    LD R3, R2, 0
    SUB R3, 1
    ST R3, R2, 0
    JNZ pac_sprite_now
    NOP
    LSI R3, 4
    ST R3, R2, 0
    LDI pac_move
    MOV PC, R0
    NOP

pac_sprite_now:
    LDI pac_sprite
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_loop
    MOV PC, R0
    NOP

; =====================================================================
; End states: wait ten seconds (or Q) and return to the menu
; =====================================================================
pac_state:
    LDI pac_keys
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_sprite
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI ST_TIMER
    MOV R2, R0
    LD R3, R2, 0
    SUB R3, 1
    ST R3, R2, 0
    JNZ pac_state_wait
    NOP
    LDI pac_exit
    MOV PC, R0
    NOP
pac_state_wait:
    LDI pac_loop
    MOV PC, R0
    NOP

; =====================================================================
; Pac-Man movement, dot eating and scoring
; =====================================================================
pac_move:
    LDI ST_PAC_C
    MOV R8, R0
    LD R8, R8, 0
    LDI ST_PAC_R
    MOV R9, R0
    LD R9, R9, 0
    LDI ST_PAC_DIR
    MOV R7, R0
    LD R7, R7, 0
    LDI ST_PAC_WANT
    MOV R6, R0
    LD R6, R6, 0

    ; a requested direction wins when it is open
    AND R6, R6
    JZ pac_move_current
    NOP
    LDI pac_dc
    MOV R2, R0
    ADD R2, R6
    LDS R3, DS, R2
    LDI pac_dr
    MOV R2, R0
    ADD R2, R6
    LDS R4, DS, R2
    MOV R1, R8
    ADD R1, R3
    MOV R2, R9
    ADD R2, R4
    LSI R5, 1                  ; Pac-Man cannot use the ghost door
    LDI pac_is_path
    MOV R4, R0
    LINK
    JMP R4
    NOP
    AND R0, R0
    JZ pac_move_current
    NOP
    MOV R7, R6
    LDI pac_move_apply
    MOV PC, R0
    NOP

pac_move_current:
    AND R7, R7
    JZ pac_move_stop
    NOP
    LDI pac_dc
    MOV R2, R0
    ADD R2, R7
    LDS R3, DS, R2
    LDI pac_dr
    MOV R2, R0
    ADD R2, R7
    LDS R4, DS, R2
    MOV R1, R8
    ADD R1, R3
    MOV R2, R9
    ADD R2, R4
    LSI R5, 1
    LDI pac_is_path
    MOV R4, R0
    LINK
    JMP R4
    NOP
    AND R0, R0
    JZ pac_move_stop
    NOP
    LDI pac_move_apply
    MOV PC, R0
    NOP

pac_move_stop:
    LDI pac_sprite_now
    MOV PC, R0
    NOP

pac_move_apply:
    ; R1/R2 are the (possibly tunnel-wrapped) new cell
    LDI ST_PAC_C
    MOV R3, R0
    ST R1, R3, 0
    LDI ST_PAC_R
    MOV R3, R0
    ST R2, R3, 0
    LDI ST_PAC_DIR
    MOV R3, R0
    ST R7, R3, 0
    MOV R8, R1
    MOV R9, R2

    ; anything to eat?
    MOV R1, R8
    MOV R2, R9
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LSI R3, 2
    CMP R0, R3
    JC pac_move_done           ; 0 empty or 1 wall
    NOP
    ; value 2 (dot) or 3 (pellet): clear it in the RAM map
    MOV R6, R0                 ; keep the value for the score
    LDI pac_map_clear
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; score: dot +10, pellet +50
    LSI R4, 1
    LSI R3, 3
    CMP R6, R3
    JNZ pac_score_add
    NOP
    LSI R4, 5
pac_score_add:
    LDI ST_SC1
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, R4
    LSI R4, 10
    CMP R3, R4
    JC pac_score_ok
    NOP
    LSI R3, 0
    ST R3, R2, 0
    LDI ST_SC2
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    LSI R4, 10
    CMP R3, R4
    JC pac_score_h_ok
    NOP
    LSI R3, 0
    ST R3, R2, 0
    LDI ST_SC3
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0
    LDI pac_score_draw
    MOV PC, R0
    NOP
pac_score_h_ok:
    ST R3, R2, 0
    LDI pac_score_draw
    MOV PC, R0
    NOP
pac_score_ok:
    ST R3, R2, 0
pac_score_draw:
    LDI pac_draw_score
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; erase the eaten cell (two blank art cells)
    LDI ST_PAC_C
    MOV R2, R0
    LD R8, R2, 0
    LDI ST_PAC_R
    MOV R2, R0
    LD R9, R2, 0
    LDI pac_cell_addr
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI SEG_TILE
    MVS ES, R0
    LSI R5, 0
    STS R5, ES, R3
    ADD R3, 1
    STS R5, ES, R3

    ; power pellet: frighten the ghosts
    LSI R3, 3
    CMP R6, R3
    JNZ pac_after_eat
    NOP
    LDI ST_FRIGHT
    MOV R2, R0
    LDI 240
    MOV R3, R0
    ST R3, R2, 0
    LDI pac_draw_ghosts
    MOV R4, R0
    LINK
    JMP R4
    NOP

pac_after_eat:
    LDI SFX_WAKA
    MOV R1, R0
    LSI R2, 2
    LDI 9
    SWI
    LDI ST_DOTS
    MOV R2, R0
    LD R3, R2, 0
    SUB R3, 1
    ST R3, R2, 0
    AND R3, R3
    JZ pac_win
    NOP
pac_move_done:
    ; check the cell Pac-Man just entered as well as the ghost ticks, so he
    ; cannot walk through a ghost between two ghost moves
    LDI pac_collide
    MOV PC, R0
    NOP

pac_win:
    LSI R3, 2
    LDI ST_STATE
    MOV R2, R0
    ST R3, R2, 0
    LDI 600
    MOV R3, R0
    LDI ST_TIMER
    MOV R2, R0
    ST R3, R2, 0
    LSI R9, 11
    LDI 36
    MOV R10, R0
    LDI str_win
    MOV R8, R0
    LDI draw_text
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_sprite
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_loop
    MOV PC, R0
    NOP

; =====================================================================
; Collision: same cell as a ghost.  Frightened ghosts are sent home.
; =====================================================================
pac_collide:
    LDI ST_PAC_C
    MOV R2, R0
    LD R8, R2, 0
    LDI ST_PAC_R
    MOV R2, R0
    LD R9, R2, 0
    LSI R6, 0
pac_col_loop:
    LDI ST_GHOST_C
    MOV R2, R0
    ADD R2, R6
    LDS R3, DS, R2
    CMP R3, R8
    JNZ pac_col_next
    NOP
    LDI ST_GHOST_R
    MOV R2, R0
    ADD R2, R6
    LDS R4, DS, R2
    CMP R4, R9
    JNZ pac_col_next
    NOP

    LDI ST_FRIGHT
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_col_dead
    NOP
    ; eat the ghost: 200 points, back to the house
    LDI ST_SC2
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 2
    LSI R4, 10
    CMP R3, R4
    JC pac_col_sc_ok
    NOP
    LSI R3, 0
    ST R3, R2, 0
    LDI ST_SC3
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0
    LDI pac_col_sc_done
    MOV PC, R0
    NOP
pac_col_sc_ok:
    ST R3, R2, 0
pac_col_sc_done:
    LDI pac_draw_score
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI SFX_EAT
    MOV R1, R0
    LSI R2, 6
    LDI 9
    SWI
    ; erase the ghost where it was drawn, then send it back to the corridor
    LDI ST_GHOST_C
    MOV R7, R0
    ADD R7, R6
    LDS R8, DS, R7
    LDI ST_GHOST_R
    MOV R7, R0
    ADD R7, R6
    LDS R9, DS, R7
    MOV R7, R6
    LDI pac_restore_cell
    MOV R4, R0
    LINK
    JMP R4
    NOP
    MOV R6, R7
    LDI ST_GHOST_C
    MOV R2, R0
    ADD R2, R6
    LDI 15
    MOV R3, R0
    ST R3, R2, 0
    LDI ST_GHOST_R
    MOV R2, R0
    ADD R2, R6
    LSI R3, 9
    ST R3, R2, 0
    LDI pac_draw_ghosts
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_sprite_now
    MOV PC, R0
    NOP

pac_col_dead:
    LSI R3, 1
    LDI ST_STATE
    MOV R2, R0
    ST R3, R2, 0
    LDI 600
    MOV R3, R0
    LDI ST_TIMER
    MOV R2, R0
    ST R3, R2, 0
    LDI SFX_DEATH
    MOV R1, R0
    LDI 30
    MOV R2, R0
    LDI 9
    SWI
    LSI R9, 11
    LDI 35
    MOV R10, R0
    LDI str_over
    MOV R8, R0
    LDI draw_text
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_sprite
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_loop
    MOV PC, R0
    NOP

pac_col_next:
    ADD R6, 1
    LSI R3, 4
    CMP R6, R3
    JNZ pac_col_loop
    NOP
    LDI pac_sprite_now
    MOV PC, R0
    NOP

; =====================================================================
; Ghosts: greedy chase (flee when frightened), door passable
; =====================================================================
pac_ghost_tick:
    LDI ST_LR_TICK
    MOV R2, R0
    ST LR, R2, 0
    LSI R6, 0
pac_gt_move:
    LDI pac_ghost_move
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R6, 1
    LSI R3, 4
    CMP R6, R3
    JNZ pac_gt_move
    NOP
    ; the vacated cells were restored as each ghost moved
    LDI pac_draw_ghosts
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI ST_LR_TICK
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; R6 = ghost index.  Picks the open neighbour closest to (or, when
; frightened, farthest from) Pac-Man, skipping the reverse direction.
pac_ghost_move:
    LDI ST_LR_GMV
    MOV R2, R0
    ST LR, R2, 0
    LDI ST_GHOST_C
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2
    LDI ST_GHOST_R
    MOV R2, R0
    ADD R2, R6
    LDS R9, DS, R2
    ; erase the ghost from the cell it is about to leave
    MOV R7, R6
    LDI pac_restore_cell
    MOV R4, R0
    LINK
    JMP R4
    NOP
    MOV R6, R7

    LSI R3, 0
    LDI ST_BESTD
    MOV R2, R0
    ST R3, R2, 0
    LDI 0x7FFF
    MOV R3, R0
    LDI ST_BESTDIST
    MOV R2, R0
    ST R3, R2, 0

    LSI R7, 1                  ; direction candidate
pac_gm_try:
    ; skip the reverse of the current direction
    LDI pac_rev
    MOV R2, R0
    ADD R2, R7
    LDS R3, DS, R2
    LDI ST_GHOST_DIR
    MOV R2, R0
    ADD R2, R6
    LDS R4, DS, R2
    CMP R3, R4
    JZ pac_gm_next
    NOP

    LDI pac_dc
    MOV R2, R0
    ADD R2, R7
    LDS R4, DS, R2
    LDI pac_dr
    MOV R2, R0
    ADD R2, R7
    LDS R5, DS, R2
    MOV R1, R8
    ADD R1, R4
    MOV R2, R9
    ADD R2, R5
    LSI R5, 1                  ; the door is closed to everyone
    LDI pac_is_path
    MOV R4, R0
    LINK
    JMP R4
    NOP
    AND R0, R0
    JZ pac_gm_next
    NOP

    ; distance to Pac-Man
    LDI ST_PAC_C
    MOV R4, R0
    LD R4, R4, 0
    MOV R3, R1
    SUB R3, R4
    AND R3, R3
    JNN pac_gm_abs_c
    NOP
    NEG R3
pac_gm_abs_c:
    LDI ST_PAC_R
    MOV R4, R0
    LD R4, R4, 0
    MOV R5, R2
    SUB R5, R4
    AND R5, R5
    JNN pac_gm_abs_r
    NOP
    NEG R5
pac_gm_abs_r:
    ADD R3, R5                 ; Manhattan distance
    ; frightened ghosts run away: prefer the largest distance
    LDI ST_FRIGHT
    MOV R4, R0
    LD R4, R4, 0
    AND R4, R4
    JZ pac_gm_closer
    NOP
    NEG R3
pac_gm_closer:
    LDI ST_BESTDIST
    MOV R4, R0
    LD R4, R4, 0
    CMP R3, R4
    JNC pac_gm_next
    NOP
    ; better candidate: remember direction and wrapped target
    LDI ST_BESTD
    MOV R4, R0
    ST R7, R4, 0
    LDI ST_BESTDIST
    MOV R4, R0
    ST R3, R4, 0
    LDI ST_NC
    MOV R4, R0
    ST R1, R4, 0
    LDI ST_NR
    MOV R4, R0
    ST R2, R4, 0
pac_gm_next:
    ADD R7, 1
    LSI R3, 5                  ; directions 1..4, choose after 5
    CMP R7, R3
    JNC pac_gm_choose
    NOP
    LDI pac_gm_try
    MOV PC, R0
    NOP

pac_gm_choose:
    LDI ST_BESTD
    MOV R2, R0
    LD R7, R2, 0
    AND R7, R7
    JZ pac_gm_reverse
    NOP
    LDI ST_NC
    MOV R2, R0
    LD R1, R2, 0
    LDI ST_NR
    MOV R2, R0
    LD R2, R2, 0
    LDI pac_gm_setdir
    MOV PC, R0
    NOP

pac_gm_reverse:
    LDI ST_GHOST_DIR
    MOV R2, R0
    ADD R2, R6
    LDS R3, DS, R2
    AND R3, R3
    JZ pac_gm_done
    NOP
    LDI pac_rev
    MOV R2, R0
    ADD R2, R3
    LDS R7, DS, R2
    LDI pac_dc
    MOV R2, R0
    ADD R2, R7
    LDS R4, DS, R2
    LDI pac_dr
    MOV R2, R0
    ADD R2, R7
    LDS R5, DS, R2
    MOV R1, R8
    ADD R1, R4
    MOV R2, R9
    ADD R2, R5
    LSI R5, 1
    LDI pac_is_path
    MOV R4, R0
    LINK
    JMP R4
    NOP
    AND R0, R0
    JZ pac_gm_done
    NOP

pac_gm_setdir:
    LDI ST_GHOST_DIR
    MOV R4, R0
    ADD R4, R6
    ST R7, R4, 0
pac_gm_apply:
    LDI ST_GHOST_C
    MOV R3, R0
    ADD R3, R6
    ST R1, R3, 0
    MOV R3, R2
    LDI ST_GHOST_R
    MOV R2, R0
    ADD R2, R6
    ST R3, R2, 0
pac_gm_done:
    LDI ST_LR_GMV
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; =====================================================================
; Drawing helpers
; =====================================================================
; R8 = column, R9 = row.  Returns the tilemap offset in R3.
pac_cell_addr:
    MOV R3, R9
    ADD R3, 1
    MOV R4, R3
    SL R4, 6
    MOV R1, R3
    SL R1, 4
    ADD R4, R1
    MOV R1, R3
    SL R1, 1
    ADD R4, R1
    ADD R4, 8
    MOV R1, R8
    SL R1, 1
    ADD R4, R1
    MOV R3, R4
    JMP LR
    NOP

; Static maze value for R1 = column, R2 = row in R0.  Preserves R1/R2.
pac_mapval:
    MOV R3, R2
    SL R3, 2
    MOV R4, R1
    SR R4, 3
    ADD R3, R4
    LDI pacmap
    MOV R4, R0
    ADD R4, R3
    LDS R0, DS, R4
    MOV R3, R1
    LSI R4, 7
    AND R3, R4
    SL R3, 1
pac_mv_shift:
    AND R3, R3
    JZ pac_mv_done
    NOP
    SR R0, 1
    SUB R3, 1
    JNZ pac_mv_shift
    NOP
pac_mv_done:
    LSI R3, 3
    AND R0, R3
    JMP LR
    NOP

; R1 = column, R2 = row: clears the cell's two map bits.  R6 must hold the
; cell value (2 or 3).  Pac-Man only calls this for a cell he just ate.
pac_map_clear:
    MOV R3, R2
    SL R3, 2
    MOV R4, R1
    SR R4, 3
    ADD R3, R4
    LDI pacmap
    MOV R4, R0
    ADD R4, R3
    LDS R0, DS, R4
    MOV R3, R1
    LSI R5, 7
    AND R3, R5
    SL R3, 1                  ; shift count 2*(column & 7)
    LSI R5, 3
mc_shift:
    AND R3, R3
    JZ mc_mask
    NOP
    SL R5, 1
    SUB R3, 1
    JNZ mc_shift
    NOP
mc_mask:
    LSI R3, -1
    XOR R3, R5                ; ~mask
    AND R0, R3
    ST R0, R4, 0
    JMP LR
    NOP

; R1 = column, R2 = row, R5 = 0 allows the ghost door, 1 blocks it.
; Returns R0 = 1 when the cell is walkable.  Wrap columns on the tunnel row.
pac_is_path:
    LSI R3, 11
    CMP R2, R3
    JNZ pac_ip_nowrap
    NOP
    AND R1, R1
    JN pac_ip_wrap_left
    NOP
    LDI 32
    MOV R3, R0
    CMP R1, R3
    JNC pac_ip_wrap_right
    NOP
    LDI pac_ip_nowrap
    MOV PC, R0
    NOP
pac_ip_wrap_left:
    LDI 31
    MOV R1, R0
    LDI pac_ip_nowrap
    MOV PC, R0
    NOP
pac_ip_wrap_right:
    LSI R1, 0
pac_ip_nowrap:
    AND R1, R1
    JN pac_ip_no
    NOP
    LDI 32
    MOV R3, R0
    CMP R1, R3
    JNC pac_ip_no
    NOP
    AND R2, R2
    JN pac_ip_no
    NOP
    LDI 24
    MOV R3, R0
    CMP R2, R3
    JNC pac_ip_no
    NOP
    MOV R3, R2
    SL R3, 2
    MOV R4, R1
    SR R4, 3
    ADD R3, R4
    LDI pacmap
    MOV R4, R0
    ADD R4, R3
    LDS R0, DS, R4
    MOV R3, R1
    LSI R4, 7
    AND R3, R4
    SL R3, 1
pac_ip_shift:
    AND R3, R3
    JZ pac_ip_value
    NOP
    SR R0, 1
    SUB R3, 1
    JNZ pac_ip_shift
    NOP
pac_ip_value:
    LSI R3, 3
    AND R0, R3
    LSI R3, 1
    CMP R0, R3
    JNZ pac_ip_yes
    NOP
    ; a wall: the door is walkable for ghosts only
    LSI R3, 10
    CMP R2, R3
    JNZ pac_ip_no
    NOP
    LDI 14
    MOV R3, R0
    CMP R1, R3
    JN pac_ip_no
    NOP
    LDI 18
    CMP R1, R3
    JNC pac_ip_no
    NOP
pac_ip_door:
    AND R5, R5
    JNZ pac_ip_no
    NOP
pac_ip_yes:
    LSI R0, 1
    JMP LR
    NOP
pac_ip_no:
    LSI R0, 0
    JMP LR
    NOP

; R8/R9 cell: (re)paint the path art, including a dot that has not been eaten.
pac_restore_cell:
    LDI ST_LR_REST
    MOV R2, R0
    ST LR, R2, 0
    ; the ghost door is drawn as text, not a blank path cell
    LSI R3, 10
    CMP R9, R3
    JNZ pac_rc_map
    NOP
    LDI 14
    MOV R3, R0
    CMP R8, R3
    JN pac_rc_map
    NOP
    LDI 18
    CMP R8, R3
    JNC pac_rc_map
    NOP
pac_rc_door:
    LDI pac_cell_addr
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI SEG_TILE
    MVS ES, R0
    LDI 0x03A0
    MOV R5, R0
    OR R5, 15                  ; text tile 0x80 | pair 0x3 | '=' -> 0x83A0
    STS R5, ES, R3
    ADD R3, 1
    STS R5, ES, R3
    LDI pac_rc_done
    MOV PC, R0
    NOP

pac_rc_map:
    MOV R1, R8
    MOV R2, R9
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LSI R5, 0
    LSI R6, 0
    LSI R3, 2
    CMP R0, R3
    JC pac_rc_paint            ; empty or wall -> blank
    NOP
    LSI R3, 3
    CMP R0, R3
    JNZ pac_rc_dot
    NOP
    LDI T_PELLET_L
    MOV R5, R0
    LDI T_PELLET_R
    MOV R6, R0
    LDI pac_rc_shift
    MOV PC, R0
    NOP
pac_rc_dot:
    LDI T_DOT_L
    MOV R5, R0
    LDI T_DOT_R
    MOV R6, R0
pac_rc_shift:
    SL R5, 5
    SL R6, 5
pac_rc_paint:
    LDI pac_cell_addr
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI SEG_TILE
    MVS ES, R0
    STS R5, ES, R3
    ADD R3, 1
    STS R6, ES, R3
pac_rc_done:
    LDI ST_LR_REST
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

pac_draw_ghosts:
    LDI ST_LR_DRAW
    MOV R2, R0
    ST LR, R2, 0
    LSI R6, 0
pac_dg_loop:
    LDI ST_GHOST_C
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2
    LDI ST_GHOST_R
    MOV R2, R0
    ADD R2, R6
    LDS R9, DS, R2
    LDI pac_draw_ghost_at
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R6, 1
    LSI R3, 4
    CMP R6, R3
    JNZ pac_dg_loop
    NOP
    LDI ST_LR_DRAW
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

pac_draw_ghost_at:
    LDI ST_LR_DGA
    MOV R2, R0
    ST LR, R2, 0
    LDI pac_cell_addr
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI ST_FRIGHT
    MOV R2, R0
    LD R2, R2, 0
    AND R2, R2
    JZ pac_dga_normal
    NOP
    LDI T_FRIGHT_L
    MOV R5, R0
    LDI T_FRIGHT_R
    MOV R7, R0
    LDI pac_dga_write
    MOV PC, R0
    NOP
pac_dga_normal:
    LDI T_GHOST_L
    MOV R5, R0
    LDI T_GHOST_R
    MOV R7, R0
pac_dga_write:
    SL R5, 5
    SL R7, 5
    LDI SEG_TILE
    MVS ES, R0
    STS R5, ES, R3
    ADD R3, 1
    STS R7, ES, R3
    LDI ST_LR_DGA
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; =====================================================================
; HUD
; =====================================================================
pac_draw_score:
    LDI SEG_TILE
    MVS ES, R0
    LDI 40
    MOV R2, R0
    LDI ST_SC3
    MOV R7, R0
    LDI 0x10                  ; '0' - 0x20
    MOV R4, R0
    LSI R6, 4
pac_ds_loop:
    LD R3, R7, 0
    ADD R3, R4
    SL R3, 5
    OR R3, 15                 ; text tile flag
    STS R3, ES, R2
    ADD R2, 1
    ADD R7, 1
    SUB R6, 1
    JNZ pac_ds_loop
    NOP
    JMP LR
    NOP

; R8 = NUL-terminated string, R9 = row, R10 = column.
draw_text:
    LDI SEG_TILE
    MVS ES, R0
    MOV R1, R9
    SL R1, 6
    MOV R2, R9
    SL R2, 4
    ADD R1, R2
    MOV R2, R9
    SL R2, 1
    ADD R1, R2
    ADD R1, R10
    MOV R2, R1
    LDI 0x20
    MOV R1, R0
pac_dt_loop:
    LDS R0, DS, R8
    AND R0, R0
    JZ pac_dt_done
    NOP
    SUB R0, R1
    SL R0, 5
    LSI R3, 1
    SL R3, 15
    OR R0, R3
    STS R0, ES, R2
    ADD R8, 1
    ADD R2, 1
    LDI pac_dt_loop
    MOV PC, R0
    NOP
pac_dt_done:
    JMP LR
    NOP

; =====================================================================
; Pac-Man sprite (OAM descriptor 0)
; =====================================================================
pac_sprite:
    LDI SEG_OAM
    MVS ES, R0
    ; x = 72 + 16*column
    LDI ST_PAC_C
    MOV R2, R0
    LD R2, R2, 0
    SL R2, 4
    LDI 72
    MOV R3, R0
    ADD R2, R3

    ; y = 6 + 15*row
    LDI ST_PAC_R
    MOV R3, R0
    LD R3, R3, 0
    MOV R5, R3
    SL R5, 4
    SUB R5, R3
    LDI 6
    MOV R3, R0
    ADD R5, R3

    ; open mouth on the high half of every 16-frame cycle
    LDI ST_FRAME
    MOV R3, R0
    LD R4, R3, 0
    LSI R7, 8
    AND R4, R7
    JZ pac_sp_closed
    NOP
    LSI R3, 0
    LDI pac_sp_dir
    MOV PC, R0
    NOP
pac_sp_closed:
    LSI R3, 1
pac_sp_dir:
    ; up: 8/9, down: 16/17, right/left/stopped: 0/1
    LDI ST_PAC_DIR
    MOV R6, R0
    LD R6, R6, 0
    LSI R7, 1
    CMP R6, R7
    JNZ pac_sp_not_up
    NOP
    LSI R7, 8
    ADD R3, R7
pac_sp_not_up:
    LSI R7, 2
    CMP R6, R7
    JNZ pac_sp_flat
    NOP
    LDI 16
    MOV R7, R0
    ADD R3, R7
pac_sp_flat:
    ; word 1 = group << 11 | y
    MOV R4, R3
    SL R4, 11
    OR R4, R5
    LSI R0, 1
    STS R4, ES, R0
    ; word 0 = 0x0800 | x, with 0x2000 when facing left
    LSI R7, 3
    CMP R6, R7
    JNZ pac_sp_noh
    NOP
    LDI 0x2000
    MOV R7, R0
    OR R2, R7
pac_sp_noh:
    LSI R7, 1
    SL R7, 11
    OR R2, R7
    LSI R0, 0
    STS R2, ES, R0
    JMP LR
    NOP

; =====================================================================
; Keyboard
; =====================================================================
; Reads one UART byte: WASD sets the requested direction, Q exits.
; The PS/2 map produces both cases, so each key is checked twice.
pac_keys:
    LDI SEG_UART
    MVS ES, R0
    LDI 0x20
    MOV R2, R0
    LDS R1, ES, R2
    LSI R3, 1
    AND R1, R3                 ; keyboard FIFO ready
    JZ pac_k_done
    NOP
    LDI 0x22
    MOV R2, R0
    LDS R1, ES, R2
    OR R1, 5                   ; fold either case to lower case
    LDI 0x71
    MOV R3, R0
    CMP R1, R3
    JZ pac_exit
    NOP
    LDI 0x77
    MOV R3, R0
    CMP R1, R3
    JZ pac_k_up
    NOP
    LDI 0x73
    MOV R3, R0
    CMP R1, R3
    JZ pac_k_down
    NOP
    LDI 0x61
    MOV R3, R0
    CMP R1, R3
    JZ pac_k_left
    NOP
    LDI 0x64
    MOV R3, R0
    CMP R1, R3
    JZ pac_k_right
    NOP
pac_k_done:
    JMP LR
    NOP
pac_k_up:
    LSI R3, 1
    LDI pac_k_set
    MOV PC, R0
    NOP
pac_k_down:
    LSI R3, 2
    LDI pac_k_set
    MOV PC, R0
    NOP
pac_k_left:
    LSI R3, 3
    LDI pac_k_set
    MOV PC, R0
    NOP
pac_k_right:
    LSI R3, 4
pac_k_set:
    LDI ST_PAC_WANT
    MOV R2, R0
    ST R3, R2, 0
pac_k_done:
    JMP LR
    NOP

; =====================================================================
; Scene setup, palette and exit
; =====================================================================
pac_scene:
    LDI SEG_CTRL
    MVS ES, R0
    LSI R3, 0
    LSI R2, 8
    STS R3, ES, R2
    LSI R2, 4
    STS R3, ES, R2
    LSI R2, 6
    STS R3, ES, R2
    LSI R2, 2
    STS R3, ES, R2
    LSI R2, 0
    STS R3, ES, R2

    LDI SEG_TILE
    MVS ES, R0
    LSI R2, 0
    LDI 2132
    MOV R4, R0
pac_sc_clear:
    STS R3, ES, R2
    ADD R2, 1
    SUB R4, 1
    JNZ pac_sc_clear
    NOP

    LDI SEG_OAM
    MVS ES, R0
    LSI R2, 0
    LDI 16
    MOV R4, R0
pac_sc_oam:
    STS R3, ES, R2
    ADD R2, 1
    SUB R4, 1
    JNZ pac_sc_oam
    NOP
    JMP LR
    NOP

; Installs palette set 1 and selects it (control 5 bits 10:8).
pac_setpal:
    LDI pac_pal
    MOV R2, R0
    LDS R5, DS, R2
    ADD R2, 1
    LDI SEG_OAM
    MVS ES, R0
pac_pal_loop:
    AND R5, R5
    JZ pac_pal_done
    NOP
    LDS R3, DS, R2
    ADD R2, 1
    LDS R4, DS, R2
    ADD R2, 1
    STS R4, ES, R3
    SUB R5, 1
    JNZ pac_pal_loop
    NOP
pac_pal_done:
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 0x0A
    LSI R3, 1
    SL R3, 8
    STS R3, ES, R2             ; palette set 1
    JMP LR
    NOP

wait_frame:
    LDI SEG_UART
    MVS ES, R0
    LDI 0x26
    MOV R2, R0
pac_wf_loop:
    LDS R1, ES, R2
    LSI R3, 2
    AND R1, R3
    LDI ST_LASTF
    MOV R4, R0
    LD R5, R4, 0
    CMP R1, R5
    JZ pac_wf_loop
    NOP
    ST R1, R4, 0
    JMP LR
    NOP

pac_exit:
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 0x0A
    LSI R3, 0
    STS R3, ES, R2             ; palette set 0 for the menu
    LDI ST_RET10
    MOV R2, R0
    LD R10, R2, 0
    LDI ST_RET11
    MOV R2, R0
    LD R11, R2, 0
    JML R10
    NOP

; =====================================================================
; Strings (kept below 0x500, in front of the generated map)
; =====================================================================
str_score:
    .text "SCORE"
str_win:
    .text "YOU WIN!"
str_over:
    .text "GAME OVER"

; end of the code/string region; the build asserts this stays below 0x500
p_code_end:
