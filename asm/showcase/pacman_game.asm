; pacman_game.asm - a first playable Pac-Man for the D16D showcase.
;
; Assembled standalone with .org 0 and placed at physical 0x4330, so it runs
; with CS = DS = 0x0433.  The menu enters with JML R0 (CS 0x0433, PC 0) and
; leaves R10/R11 as the far return pair, which the game saves and uses to
; JML back to the menu.
;
; Memory inside the block (offset from 0x4330):
;   0x000..0x5FF  code and its strings
;   0x900..0x95F  the static maze (generated pacman_map.asm)
;   0x968..0x975  direction tables (also generated)
;   0x978..0x97B  ghost-eat point table (also generated)
;   0x980..0x99E  palette setup table (also generated)
;   0x9A0..0x9D9  writable game state
;   0xA00..0xE07  four sprite frames copied into the sprite bank at startup
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
.equ SEG_SPR  -0x0C00          ; 0xF400 sprite bank
.equ SEG_OAM  -0x0A00          ; 0xF600 OAM + palette
.equ SEG_UART -0xFFC           ; 0xF004 UART/status

; generated art tile indices
.equ T_DOT_L     49
.equ T_DOT_R     50
.equ T_PELLET_L  51
.equ T_PELLET_R  52
.equ T_GATE_L    65
.equ T_GATE_R    66
.equ T_FRUIT_L   67
.equ T_FRUIT_R   68
.equ T_WALL_L    110
.equ T_WALL_R    118

; BIOS sound effects (function 9 starts, function 10 ticks once per frame).
.equ SFX_DEATH   3
.equ SFX_WAKA    4
.equ SFX_EAT     5

; ---- writable state (DS offsets 0x9A0..0x9D9) --------------------------
.equ ST_PAC_C     0x9A0
.equ ST_PAC_R     0x9A1
.equ ST_PAC_DIR   0x9A2
.equ ST_PAC_WANT  0x9A3
.equ ST_PAC_TMR   0x9A4
.equ ST_SC3       0x9C6        ; thousand, hundred, ten, one digits
.equ ST_SC2       0x9C7
.equ ST_SC1       0x9C8
.equ ST_SC0       0x9C9
.equ ST_DOTS      0x9A5
.equ ST_FRAME     0x9A9
.equ ST_LASTF     0x9AA
.equ ST_STATE     0x9AB        ; 0 play, 1 dead, 2 win
.equ ST_TIMER     0x9AC
.equ ST_FRIGHT    0x9AD
.equ ST_BESTD     0x9AF
.equ ST_BESTDIST  0x9B0
.equ ST_NC        0x9B1
.equ ST_NR        0x9B2
.equ ST_RET10     0x9B3
.equ ST_RET11     0x9B4
.equ ST_LR_DRAW   0x9B5
.equ ST_LR_DGA    0x9B6
.equ ST_LR_TICK   0x9B7
.equ ST_LR_GMV    0x9B8
.equ ST_LR_REST   0x9B9
.equ ST_GHOST_C   0x9BA        ; four words
.equ ST_GHOST_R   0x9BE
.equ ST_GHOST_DIR 0x9C2
.equ ST_GHOST_T0  0x9CA        ; one move countdown per ghost
.equ ST_GHOST_EAT 0x9CE        ; 0..3, reset by an energizer
.equ ST_PAC_ANIM  0x9CF        ; munch phase 0 open, 1 half, 2 closed, 3 half
.equ ST_PAC_MUNCH 0x9D0        ; frames per munch phase
.equ ST_PAC_MOVE  0x9D1        ; 1 while Pac-Man is actually moving
.equ ST_FRUIT_N   0x9D2        ; how many fruits have appeared (0..2)
.equ ST_FRUIT_T   0x9D3        ; frames left on screen, 0 = none
.equ ST_FRUIT_ST  0x9D4        ; 1 while the cherries are drawn
.equ ST_SV6       0x9D5        ; score-add scratch
.equ ST_SV7       0x9D6
.equ ST_SVLR      0x9D7
.equ ST_LR_COL    0x9D8        ; collision routine return address
.equ ST_PAL0      0x9B5        ; saved sprite-palette entries 6..9
.equ ST_PAL1      0x9B6
.equ ST_PAL2      0x9B7
.equ ST_PAL3      0x9DD
.equ ST_EAT_C     0x9DE        ; cell whose pickup is processed on arrival
.equ ST_EAT_R     0x9DF
.equ ST_EAT_V     0x9B9        ; map value + 1, 0 = no pending pickup
; ---- smooth-movement state (0x9D9..0x9FF) -----------------------------
.equ ST_PAC_FC    0x9E0        ; cell Pac-Man is leaving
.equ ST_PAC_FR    0x9E1
.equ ST_PAC_OFF   0x9E2        ; 1/16-pixel progress into the current move
.equ ST_PAC_PX    0x9E3        ; interpolated sprite centre
.equ ST_PAC_PY    0x9E4
.equ ST_PAC_NEXT  0x9E5        ; 1 when another move is queued
.equ ST_G_FC      0x9E6        ; four ghosts: cell being left
.equ ST_G_FR      0x9EA
.equ ST_G_OFF     0x9EE        ; 1/16-pixel progress
.equ ST_G_DIR     0x9F2        ; direction of the current visual move, 0 = still
.equ ST_G_STEP    0x9F6        ; 1/16 pixels per frame for the current move
.equ ST_G_PX      0x9FA
.equ ST_G_PY      0x9D9

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
    ; keep the sprite-palette entries Flappy's bird art uses
    LDI SEG_OAM
    MVS ES, R0
    LDI 0x00E6
    MOV R2, R0
    LDS R3, ES, R2
    LDI ST_PAL0
    MOV R4, R0
    ST R3, R4, 0
    ADD R2, 1
    LDS R3, ES, R2
    LDI ST_PAL1
    MOV R4, R0
    ST R3, R4, 0
    ADD R2, 1
    LDS R3, ES, R2
    LDI ST_PAL2
    MOV R4, R0
    ST R3, R4, 0
    ADD R2, 1
    LDS R3, ES, R2
    LDI ST_PAL3
    MOV R4, R0
    ST R3, R4, 0
    LDI pac_setpal
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; keep Flappy's dizzy groups, then install the Pac-Man and ghost frames
    ; into the writable sprite bank.  The baked bank is untouched.
    LDI pac_save_groups
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_copy_frames
    MOV R4, R0
    LDI pac_sprite_data
    MOV R1, R0
    LDI pac_sprite_groups
    MOV R5, R0
    LSI R6, 6
    LINK
    JMP R4
    NOP
    LDI pac_copy_frames
    MOV R4, R0
    LDI pac_ghost_data
    MOV R1, R0
    LDI pac_ghost_groups
    MOV R5, R0
    LSI R6, 4
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
    LDI ST_GHOST_EAT
    MOV R2, R0
    ST R3, R2, 0
    LDI ST_PAC_ANIM
    MOV R2, R0
    ST R3, R2, 0
    LDI ST_PAC_MUNCH
    MOV R2, R0
    LSI R3, 4
    ST R3, R2, 0
    LSI R3, 0
    LDI ST_PAC_MOVE
    MOV R2, R0
    ST R3, R2, 0
    LDI ST_FRUIT_N
    MOV R2, R0
    ST R3, R2, 0
    LDI ST_FRUIT_T
    MOV R2, R0
    ST R3, R2, 0
    LDI ST_FRUIT_ST
    MOV R2, R0
    ST R3, R2, 0
    LDI ST_EAT_V
    MOV R2, R0
    ST R3, R2, 0
    ; HUD label "SCORE" in the right margin, row 0 column 65
    LSI R9, 0
    LDI 65
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
    CMP R0, 1
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
    CMP R8, 14
    JN mz_shape
    NOP
    LDI 18
    CMP R8, R3
    JNC mz_shape
    NOP
    LDI mz_door
    MOV PC, R0
    NOP
mz_shape:
    ; Wall cell outlines: top/bottom are shared, left and right are separate
    ; bits so an edge between two touching walls is never drawn.
    LSI R5, 0
    AND R9, R9
    JZ mz_top_open
    NOP
    MOV R1, R8
    MOV R2, R9
    SUB R2, 1
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    CMP R0, 1
    JZ mz_top_done
    NOP
mz_top_open:
    OR R5, 1
mz_top_done:
    LDI 23
    MOV R3, R0
    CMP R9, R3
    JNC mz_bottom_open
    NOP
mz_bottom_edge:
    MOV R1, R8
    MOV R2, R9
    ADD R2, 1
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    CMP R0, 1
    JZ mz_bottom_done
    NOP
mz_bottom_open:
    OR R5, 2
mz_bottom_done:
    MOV R12, R5
    AND R8, R8
    JZ mz_left_open
    NOP
    MOV R1, R8
    SUB R1, 1
    MOV R2, R9
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    CMP R0, 1
    JZ mz_left_done
    NOP
mz_left_open:
    OR R5, 0
mz_left_done:
    LDI 31
    MOV R3, R0
    CMP R8, R3
    JNC mz_right_open
    NOP
mz_right_edge:
    MOV R1, R8
    ADD R1, 1
    MOV R2, R9
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    CMP R0, 1
    JZ mz_right_done
    NOP
mz_right_open:
    OR R12, 0
mz_right_done:
    LDI T_WALL_L
    MOV R4, R0
    ADD R4, R5
    SL R4, 5
    LDI T_WALL_R
    MOV R2, R0
    ADD R2, R12
    SL R2, 5
    LDI mz_store
    MOV PC, R0
    NOP
mz_door:
    LDI T_GATE_L
    MOV R4, R0
    LDI T_GATE_R
    MOV R2, R0
    LDI mz_scale
    MOV PC, R0
    NOP
mz_blank:
    LSI R4, 0
    LSI R2, 0
mz_store:
    ; R3 = row*82 + 8 + 2*column
    MOV R3, R7
    MOV R1, R3
    SL R3, 6
    SL R1, 4
    ADD R3, R1
    MOV R1, R7
    SL R1, 1
    ADD R3, R1
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
    LDI 8
    MOV R3, R0
    ST R3, R2, 0
    ; smooth-movement origin and sprite centre for Pac-Man
    LDI ST_PAC_FC
    MOV R2, R0
    LDI 15
    MOV R3, R0
    ST R3, R2, 0
    LDI ST_PAC_FR
    MOV R2, R0
    LDI 17
    MOV R3, R0
    ST R3, R2, 0
    LDI ST_PAC_OFF
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI ST_PAC_NEXT
    MOV R2, R0
    ST R3, R2, 0
    LDI ST_PAC_PX
    MOV R2, R0
    LDI 248
    MOV R3, R0
    ST R3, R2, 0
    LDI ST_PAC_PY
    MOV R2, R0
    LDI 262
    MOV R3, R0
    ST R3, R2, 0
    ; staggered ghost phases; each timer resets to its own speed after a move
    LDI ST_GHOST_T0
    MOV R2, R0
    LDI 9
    MOV R3, R0
    ST R3, R2, 0
    LDI 11
    MOV R3, R0
    ST R3, R2, 1
    LDI 13
    MOV R3, R0
    ST R3, R2, 2
    LDI 15
    MOV R3, R0
    ST R3, R2, 3

    ; four ghosts on the corridor above the house, all facing up
    LDI ST_GHOST_C
    MOV R2, R0
    LDI 15
    MOV R3, R0
    ST R3, R2, 0
    ST R3, R2, 1
    LDI 13
    MOV R3, R0
    ST R3, R2, 2
    LDI 17
    MOV R3, R0
    ST R3, R2, 3
    LDI ST_GHOST_R
    MOV R2, R0
    LSI R3, 9
    ST R3, R2, 0
    LSI R3, 11
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
    ; smooth origins; the first ghost_anim computes their sprite centres
    LDI ST_G_FC
    MOV R2, R0
    LDI 15
    MOV R3, R0
    ST R3, R2, 0
    ST R3, R2, 1
    LDI 13
    MOV R3, R0
    ST R3, R2, 2
    LDI 17
    MOV R3, R0
    ST R3, R2, 3
    LDI ST_G_FR
    MOV R2, R0
    LSI R3, 9
    ST R3, R2, 0
    LSI R3, 11
    ST R3, R2, 1
    ST R3, R2, 2
    ST R3, R2, 3
    LDI ST_G_DIR
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    ST R3, R2, 1
    ST R3, R2, 2
    ST R3, R2, 3

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

    ; cherries count down and disappear
    LDI ST_FRUIT_T
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_fright
    NOP
    SUB R3, 1
    ST R3, R2, 0
    JNZ pac_fright
    NOP
    LDI ST_FRUIT_ST
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LSI R5, 0
    LSI R7, 0
    LDI pac_fruit_paint
    MOV R4, R0
    LINK
    JMP R4
    NOP

pac_fright:
    LDI ST_FRIGHT
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_ghost_timer
    NOP
    SUB R3, 1
    ST R3, R2, 0

pac_ghost_timer:
    ; one countdown per ghost: tunnel 40%, frightened 50%, normal 75%
    LSI R6, 0
pac_gt_loop:
    LDI ST_GHOST_T0
    MOV R2, R0
    ADD R2, R6
    LDS R3, DS, R2
    SUB R3, 1
    ST R3, R2, 0
    JNZ pac_gt_next
    NOP
    LDI pac_ghost_move
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI ST_GHOST_R
    MOV R2, R0
    ADD R2, R6
    LDS R3, DS, R2
    CMP R3, 11
    JZ pac_gt_tunnel
    NOP
    LDI ST_FRIGHT
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_gt_normal
    NOP
    LDI 13
    MOV R3, R0
    LDI 20
    MOV R4, R0
    LDI pac_gt_set
    MOV PC, R0
    NOP
pac_gt_tunnel:
    LDI 16
    MOV R3, R0
    LDI 16
    MOV R4, R0
    LDI pac_gt_set
    MOV PC, R0
    NOP
pac_gt_normal:
    LDI 9
    MOV R3, R0
    LDI 30
    MOV R4, R0
pac_gt_set:
    LDI ST_GHOST_T0
    MOV R2, R0
    ADD R2, R6
    ST R3, R2, 0
    LDI ST_G_STEP
    MOV R2, R0
    ADD R2, R6
    ST R4, R2, 0
pac_gt_next:
    ADD R6, 1
    LSI R3, 4
    CMP R6, R3
    JNZ pac_gt_loop
    NOP

    ; update ghost colours and interpolated positions, then Pac-Man's
    LDI pac_ghost_palette
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_ghost_anim
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_anim
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_eat_arrive
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; collisions use the interpolated sprite centres
    LDI pac_collide
    MOV R4, R0
    LINK
    JMP R4
    NOP

pac_munch:
    LDI ST_PAC_MOVE
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_pac_timer
    NOP
    LDI ST_PAC_MUNCH
    MOV R2, R0
    LD R3, R2, 0
    SUB R3, 1
    ST R3, R2, 0
    JNZ pac_pac_timer
    NOP
    LSI R3, 4
    ST R3, R2, 0
    LDI ST_PAC_ANIM
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    LSI R4, 3
    AND R3, R4
    ST R3, R2, 0

pac_pac_timer:
    LDI ST_PAC_TMR
    MOV R2, R0
    LD R3, R2, 0
    SUB R3, 1
    ST R3, R2, 0
    JNZ pac_sprite_now
    NOP
    LDI ST_FRIGHT
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_pac_base
    NOP
    LSI R3, 7
    LDI pac_pac_set
    MOV PC, R0
    NOP
pac_pac_base:
    LDI 8
    MOV R3, R0
pac_pac_set:
    LDI ST_PAC_TMR
    MOV R2, R0
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
    LDI pac_ghost_sprite
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
    LDI ST_PAC_NEXT
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI pac_sprite_now
    MOV PC, R0
    NOP

pac_move_apply:
    ; R1/R2 are the (possibly tunnel-wrapped) new cell
    LDI ST_PAC_C
    MOV R3, R0
    LD R4, R3, 0
    LDI ST_PAC_FC
    MOV R3, R0
    ST R4, R3, 0
    LDI ST_PAC_R
    MOV R3, R0
    LD R4, R3, 0
    LDI ST_PAC_FR
    MOV R3, R0
    ST R4, R3, 0
    LDI ST_PAC_C
    MOV R3, R0
    ST R1, R3, 0
    LDI ST_PAC_R
    MOV R3, R0
    ST R2, R3, 0
    LDI ST_PAC_DIR
    MOV R3, R0
    ST R7, R3, 0
    LDI ST_PAC_OFF
    MOV R3, R0
    LSI R4, 0
    ST R4, R3, 0
    LDI ST_PAC_NEXT
    MOV R3, R0
    LSI R4, 1
    ST R4, R3, 0
    LDI ST_PAC_MOVE
    MOV R3, R0
    ST R4, R3, 0
    MOV R8, R1
    MOV R9, R2

    ; remember the target cell's pickup until the sprite reaches it
    MOV R1, R8
    MOV R2, R9
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R0, 1
    MOV R6, R0
    LDI ST_EAT_V
    MOV R2, R0
    ST R6, R2, 0
    LDI ST_EAT_C
    MOV R2, R0
    ST R8, R2, 0
    LDI ST_EAT_R
    MOV R2, R0
    ST R9, R2, 0
    LDI pac_sprite_now
    MOV PC, R0
    NOP

; Process the pickup in the cell Pac-Man has just reached.
pac_eat_arrive:
    LDI ST_LR_COL
    MOV R2, R0
    ST LR, R2, 0
    LDI ST_EAT_V
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_ea_done
    NOP
    LDI ST_PAC_OFF
    MOV R2, R0
    LD R3, R2, 0
    LDI ST_PAC_DIR
    MOV R2, R0
    LD R7, R2, 0
    LSI R4, 2
    CMP R7, R4
    JNC pac_ea_dist_h
    NOP
    LDI 240
    MOV R6, R0
    LDI pac_ea_dist_cmp
    MOV PC, R0
    NOP
pac_ea_dist_h:
    LDI 256
    MOV R6, R0
pac_ea_dist_cmp:
    CMP R3, R6
    JC pac_ea_done
    NOP
    LDI ST_EAT_V
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI ST_PAC_C
    MOV R2, R0
    LD R8, R2, 0
    LDI ST_PAC_R
    MOV R2, R0
    LD R9, R2, 0
    MOV R1, R8
    MOV R2, R9
    LDI pac_mapval
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LSI R3, 2
    CMP R0, R3
    JC pac_ea_fruit
    NOP
    MOV R6, R0                 ; keep the value for the score
    LDI pac_map_clear
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; score: dot +10, pellet +50
    LDI pac_score_add
    MOV R4, R0
    LSI R0, 0
    LSI R1, 1
    LSI R3, 3
    CMP R6, R3
    JNZ pac_eat_score
    NOP
    LSI R1, 5
pac_eat_score:
    LINK
    JMP R4
    NOP

    ; eating slows the next move: +2 frames for a dot, +6 for an energizer
    LDI ST_PAC_TMR
    MOV R2, R0
    LD R3, R2, 0
    LSI R4, 1
    LSI R5, 3
    CMP R6, R5
    JNZ pac_eat_delay
    NOP
    LSI R4, 3
pac_eat_delay:
    ADD R3, R4
    ST R3, R2, 0

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

    ; power pellet: frighten the ghosts for six seconds
    LSI R3, 3
    CMP R6, R3
    JNZ pac_after_eat
    NOP
    LDI ST_FRIGHT
    MOV R2, R0
    LDI 360
    MOV R3, R0
    ST R3, R2, 0
    LDI ST_GHOST_EAT
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0

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

    ; cherries: first at 70 dots eaten (174 left), second at 170 (74 left)
    LDI ST_FRUIT_N
    MOV R2, R0
    LD R4, R2, 0
    LDI 174
    MOV R5, R0
    CMP R3, R5
    JZ pac_fruit_first
    NOP
    LDI 74
    MOV R5, R0
    CMP R3, R5
    JZ pac_fruit_second
    NOP
    LDI pac_after_fruit
    MOV PC, R0
    NOP
pac_fruit_first:
    AND R4, R4
    JNZ pac_after_fruit
    NOP
    LSI R5, 1
    LDI pac_fruit_spawn
    MOV PC, R0
    NOP
pac_fruit_second:
    LSI R3, 1
    CMP R4, R3
    JNZ pac_after_fruit
    NOP
    LSI R5, 2
pac_fruit_spawn:
    ST R5, R2, 0               ; ST_FRUIT_N
    LDI ST_FRUIT_T
    MOV R2, R0
    LDI 570
    MOV R3, R0
    ST R3, R2, 0
    LDI ST_FRUIT_ST
    MOV R2, R0
    LSI R3, 1
    ST R3, R2, 0
    LDI T_FRUIT_L
    MOV R5, R0
    LDI T_FRUIT_R
    MOV R7, R0
    LDI pac_fruit_paint
    MOV R4, R0
    LINK
    JMP R4
    NOP
pac_after_fruit:
    ; last pickup wins
    LDI ST_DOTS
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_win
    NOP
pac_ea_fruit:
    ; cherries under the house
    LDI ST_PAC_C
    MOV R2, R0
    LD R3, R2, 0
    CMP R3, 15
    JNZ pac_ea_done
    NOP
    LDI ST_PAC_R
    MOV R2, R0
    LD R3, R2, 0
    CMP R3, 13
    JNZ pac_ea_done
    NOP
    LDI ST_FRUIT_ST
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_ea_done
    NOP
    LDI pac_score_add
    MOV R4, R0
    LSI R0, 1
    LSI R1, 0
    LINK
    JMP R4
    NOP
    LDI ST_FRUIT_T
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI ST_FRUIT_ST
    MOV R2, R0
    ST R3, R2, 0
    LSI R5, 0
    LSI R7, 0
    LDI pac_fruit_paint
    MOV R4, R0
    LINK
    JMP R4
    NOP
pac_ea_done:
    LDI ST_LR_COL
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
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
    LDI 28
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
; Test/setup entry: check once and then end the frame like the old routine.
pac_collide_now:
    LDI pac_collide
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pac_sprite_now
    MOV PC, R0
    NOP

pac_collide:
    LDI ST_LR_COL
    MOV R2, R0
    ST LR, R2, 0
    LDI ST_PAC_PX
    MOV R2, R0
    LD R8, R2, 0
    LDI ST_PAC_PY
    MOV R2, R0
    LD R9, R2, 0
    LSI R6, 0
pac_col_loop:
    LDI ST_G_PX
    MOV R2, R0
    ADD R2, R6
    LDS R3, DS, R2
    MOV R4, R3
    SUB R4, R8
    AND R4, R4
    JNN pac_col_xabs
    NOP
    NEG R4
pac_col_xabs:
    LDI 12
    MOV R5, R0
    CMP R4, R5
    JNC pac_col_next
    NOP
    LDI ST_G_PY
    MOV R2, R0
    ADD R2, R6
    LDS R3, DS, R2
    MOV R4, R3
    SUB R4, R9
    AND R4, R4
    JNN pac_col_yabs
    NOP
    NEG R4
pac_col_yabs:
    LDI 10
    MOV R5, R0
    CMP R4, R5
    JNC pac_col_next
    NOP

    LDI ST_FRIGHT
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_col_dead
    NOP
    ; eat the ghost: 200/400/800/1600 points, back to the house
    LDI pac_score_add
    MOV R4, R0
    LDI ST_GHOST_EAT
    MOV R2, R0
    LD R5, R2, 0
    LDI pac_ghost_pts
    MOV R3, R0
    ADD R3, R5
    LDS R0, DS, R3
    LSI R1, 0
    LINK
    JMP R4
    NOP
    ; the next ghost eaten on this energizer is worth twice as much
    LDI ST_GHOST_EAT
    MOV R2, R0
    LD R5, R2, 0
    LSI R3, 3
    CMP R5, R3
    JNC pac_col_pts_done
    NOP
    ADD R5, 1
    ST R5, R2, 0
pac_col_pts_done:
    LDI SFX_EAT
    MOV R1, R0
    LSI R2, 6
    LDI 9
    SWI
    ; send it back to the corridor and reset its smooth position
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
    LDI ST_G_FC
    MOV R2, R0
    ADD R2, R6
    LDI 15
    MOV R3, R0
    ST R3, R2, 0
    LDI ST_G_FR
    MOV R2, R0
    ADD R2, R6
    LSI R3, 9
    ST R3, R2, 0
    LDI ST_G_OFF
    MOV R2, R0
    ADD R2, R6
    LSI R3, 0
    ST R3, R2, 0
    LDI ST_G_DIR
    MOV R2, R0
    ADD R2, R6
    ST R3, R2, 0
    LDI ST_G_PX
    MOV R2, R0
    ADD R2, R6
    LDI 248
    MOV R3, R0
    ST R3, R2, 0
    LDI ST_G_PY
    MOV R2, R0
    ADD R2, R6
    LDI 142
    MOV R3, R0
    ST R3, R2, 0
    LDI pac_col_return
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
    LDI 28
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
pac_col_return:
    LDI ST_LR_COL
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; =====================================================================
; Ghosts: greedy chase (flee when frightened), door passable
; =====================================================================
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
    ; remember the cell the sprite is leaving
    LDI ST_G_FC
    MOV R2, R0
    ADD R2, R6
    ST R8, R2, 0
    LDI ST_G_FR
    MOV R2, R0
    ADD R2, R6
    ST R9, R2, 0
    LDI ST_G_OFF
    MOV R2, R0
    ADD R2, R6
    LSI R3, 0
    ST R3, R2, 0
    LDI ST_G_DIR
    MOV R2, R0
    ADD R2, R6
    ST R3, R2, 0

    ; ghosts inside the lair leave through the door; outside it stays shut
    LSI R12, 1
    LSI R3, 11
    CMP R9, R3
    JNZ pac_gm_door_row
    NOP
    LDI 12
    MOV R3, R0
    CMP R8, R3
    JC pac_gm_door_done
    NOP
    LDI 20
    MOV R3, R0
    CMP R8, R3
    JNC pac_gm_door_done
    NOP
    LSI R12, 0
    LDI pac_gm_house
    MOV PC, R0
    NOP
pac_gm_door_row:
    LSI R3, 10
    CMP R9, R3
    JNZ pac_gm_door_done
    NOP
    LDI 14
    MOV R3, R0
    CMP R8, R3
    JC pac_gm_door_done
    NOP
    LDI 18
    MOV R3, R0
    CMP R8, R3
    JNC pac_gm_door_done
    NOP
    LSI R12, 0
    LDI pac_gm_house
    MOV PC, R0
    NOP
pac_gm_door_done:

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
    MOV R5, R12                ; the door is open only inside the lair
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
    MOV R5, R12
    LDI pac_is_path
    MOV R4, R0
    LINK
    JMP R4
    NOP
    AND R0, R0
    JZ pac_gm_done
    NOP

pac_gm_house:
    LDI 15
    MOV R3, R0
    CMP R8, R3
    JZ pac_gm_house_up
    NOP
    JNC pac_gm_house_left
    NOP
    LSI R7, 4
    MOV R1, R8
    ADD R1, 1
    MOV R2, R9
    LDI pac_gm_setdir
    MOV PC, R0
    NOP
pac_gm_house_left:
    LSI R7, 3
    MOV R1, R8
    SUB R1, 1
    MOV R2, R9
    LDI pac_gm_setdir
    MOV PC, R0
    NOP
pac_gm_house_up:
    LSI R7, 1
    MOV R1, R8
    MOV R2, R9
    SUB R2, 1
    LDI pac_gm_setdir
    MOV PC, R0
    NOP

pac_gm_setdir:
    LDI ST_GHOST_DIR
    MOV R4, R0
    ADD R4, R6
    ST R7, R4, 0
    LDI ST_G_DIR
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
    MOV R4, R3
    SL R4, 6
    MOV R1, R3
    SL R1, 4
    ADD R4, R1
    MOV R1, R3
    SL R1, 1
    ADD R4, R1
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
    CMP R0, 1
    JNZ pac_ip_yes
    NOP
    ; a wall: the door is walkable for ghosts only
    LSI R3, 10
    CMP R2, R3
    JNZ pac_ip_no
    NOP
    CMP R1, 14
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

; =====================================================================
; HUD
; =====================================================================
pac_draw_score:
    LDI SEG_TILE
    MVS ES, R0
    LDI 71                     ; row 0, column 71 (after SCORE)
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

; Add R0 hundreds and R1 tens to the score and redraw it.  R6/R7 are
; preserved; R4/R5 are scratch.
pac_score_add:
    MOV R5, R0                 ; hundreds
    MOV R4, R1                 ; tens
    LDI ST_SV6
    MOV R2, R0
    ST R6, R2, 0
    LDI ST_SV7
    MOV R2, R0
    ST R7, R2, 0
    LDI ST_SVLR
    MOV R2, R0
    ST LR, R2, 0
    MOV R7, R5                 ; hundreds
    MOV R6, R4                 ; tens
    ; tens digit
    LDI ST_SC1
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, R6
    LSI R5, 0                  ; carry into the hundreds
    LSI R4, 10
    CMP R3, R4
    JC pac_sa_t_store
    NOP
    SUB R3, R4
    LSI R5, 1
pac_sa_t_store:
    ST R3, R2, 0
    ; hundreds digit plus the carry
    LDI ST_SC2
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, R7
    ADD R3, R5
pac_sa_h_loop:
    LSI R4, 10
    CMP R3, R4
    JC pac_sa_h_store
    NOP
    SUB R3, R4
    LDI ST_SC3
    MOV R4, R0
    LD R5, R4, 0
    ADD R5, 1
    ST R5, R4, 0
    LDI pac_sa_h_loop
    MOV PC, R0
    NOP
pac_sa_h_store:
    ST R3, R2, 0
    ; redraw the score, then restore the caller's R6/R7 and return
    LDI pac_draw_score
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI ST_SV6
    MOV R2, R0
    LD R6, R2, 0
    LDI ST_SV7
    MOV R2, R0
    LD R7, R2, 0
    LDI ST_SVLR
    MOV R2, R0
    LD LR, R2, 0
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

; Draw the cherries (R5/R7 = left/right tile; 0,0 erases) at cell (15,13).
pac_fruit_paint:
    LDI ST_SVLR
    MOV R2, R0
    ST LR, R2, 0
    LSI R8, 15
    LSI R9, 13
    LDI pac_cell_addr
    MOV R4, R0
    LINK
    JMP R4
    NOP
    SL R5, 5
    SL R7, 5
    LDI SEG_TILE
    MVS ES, R0
    STS R5, ES, R3
    ADD R3, 1
    STS R7, ES, R3
    LDI ST_SVLR
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; R8=column, R9=row, R3=offset pixels, R7=direction (1 up, 2 down,
; 3 left, 4 right).  Returns the sprite centre in R2/R5.
pac_cell_px:
    MOV R2, R8
    SL R2, 4
    ADD R2, 8
    MOV R5, R9
    MOV R4, R5
    SL R5, 4
    SUB R5, R4
    ADD R5, 7
    LSI R4, 1
    CMP R7, R4
    JZ pac_cp_up
    NOP
    LSI R4, 2
    CMP R7, R4
    JZ pac_cp_down
    NOP
    LSI R4, 3
    CMP R7, R4
    JZ pac_cp_left
    NOP
    ADD R2, R3
    JMP LR
    NOP
pac_cp_up:
    SUB R5, R3
    JMP LR
    NOP
pac_cp_down:
    ADD R5, R3
    JMP LR
    NOP
pac_cp_left:
    SUB R2, R3
    JMP LR
    NOP

; Advance Pac-Man's 1/16-pixel position and stop at the cell centre when no
; further move is queued.
pac_anim:
    LDI ST_SVLR
    MOV R2, R0
    ST LR, R2, 0
    LDI ST_PAC_MOVE
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_an_pos
    NOP
    LDI ST_PAC_DIR
    MOV R2, R0
    LD R7, R2, 0
    LSI R4, 2
    CMP R7, R4
    JNC pac_an_horiz
    NOP
    LDI 240
    MOV R6, R0
    LDI pac_an_step
    MOV PC, R0
    NOP
pac_an_horiz:
    LDI 256
    MOV R6, R0
pac_an_step:
    LDI ST_FRIGHT
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_an_norm
    NOP
    LDI 36
    MOV R4, R0
    LDI pac_an_add
    MOV PC, R0
    NOP
pac_an_norm:
    LDI 32
    MOV R4, R0
pac_an_add:
    LDI ST_PAC_OFF
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, R4
    CMP R3, R6
    JC pac_an_store
    NOP
    MOV R3, R6
pac_an_store:
    ST R3, R2, 0
    CMP R3, R6
    JC pac_an_pos
    NOP
    LDI ST_PAC_NEXT
    MOV R2, R0
    LD R4, R2, 0
    AND R4, R4
    JNZ pac_an_pos
    NOP
    LDI ST_PAC_MOVE
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
pac_an_pos:
    LDI ST_PAC_FC
    MOV R2, R0
    LD R8, R2, 0
    LDI ST_PAC_FR
    MOV R2, R0
    LD R9, R2, 0
    LDI ST_PAC_OFF
    MOV R2, R0
    LD R3, R2, 0
    SR R3, 4
    LDI ST_PAC_DIR
    MOV R2, R0
    LD R7, R2, 0
    LDI pac_cell_px
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI ST_PAC_PX
    MOV R4, R0
    ST R2, R4, 0
    LDI ST_PAC_PY
    MOV R4, R0
    ST R5, R4, 0
    LDI ST_SVLR
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; Advance all four ghost sprites between their from-cell and target cell.
pac_ghost_anim:
    LDI ST_SVLR
    MOV R2, R0
    ST LR, R2, 0
    LSI R6, 0
pac_ga_loop:
    LDI ST_G_DIR
    MOV R2, R0
    ADD R2, R6
    LDS R7, DS, R2
    LDI ST_G_FC
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2
    LDI ST_G_FR
    MOV R2, R0
    ADD R2, R6
    LDS R9, DS, R2
    AND R7, R7
    JZ pac_ga_still
    NOP
    LDI ST_G_OFF
    MOV R1, R0
    ADD R1, R6
    LDS R3, DS, R1
    LSI R4, 2
    CMP R7, R4
    JNC pac_ga_horiz
    NOP
    LDI 240
    MOV R5, R0
    LDI pac_ga_step
    MOV PC, R0
    NOP
pac_ga_horiz:
    LDI 256
    MOV R5, R0
pac_ga_step:
    LDI ST_G_STEP
    MOV R2, R0
    ADD R2, R6
    LDS R4, DS, R2
    ADD R3, R4
    CMP R3, R5
    JC pac_ga_store
    NOP
    MOV R3, R5
pac_ga_store:
    ST R3, R1, 0
    LDI pac_ga_pos
    MOV PC, R0
    NOP
pac_ga_still:
    LSI R3, 0
pac_ga_pos:
    SR R3, 4
    LDI pac_cell_px
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI ST_G_PX
    MOV R4, R0
    ADD R4, R6
    ST R2, R4, 0
    LDI ST_G_PY
    MOV R4, R0
    ADD R4, R6
    ST R5, R4, 0
    ADD R6, 1
    LSI R3, 4
    CMP R6, R3
    JNZ pac_ga_loop
    NOP
    LDI ST_SVLR
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; Re-tint the four ghost bodies through the sprite palette.
pac_ghost_palette:
    LDI SEG_OAM
    MVS ES, R0
    LDI pac_ghost_colours
    MOV R1, R0
    LDI ST_FRIGHT
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ pac_gp_copy
    NOP
    LDI 120
    MOV R4, R0
    CMP R4, R3
    JC pac_gp_blue
    NOP
    LDI ST_FRAME
    MOV R2, R0
    LD R3, R2, 0
    LDI 16
    MOV R4, R0
    AND R3, R4
    JZ pac_gp_blue
    NOP
    LDI pac_ghost_colours
    MOV R1, R0
    ADD R1, 8
    LDI pac_gp_copy
    MOV PC, R0
    NOP
pac_gp_blue:
    LDI pac_ghost_colours
    MOV R1, R0
    ADD R1, 4
pac_gp_copy:
    LDI 0x00E6
    MOV R2, R0
    LSI R6, 4
pac_gp_loop:
    LDS R3, DS, R1
    STS R3, ES, R2
    ADD R1, 1
    ADD R2, 1
    SUB R6, 1
    JNZ pac_gp_loop
    NOP
    JMP LR
    NOP

; Four ghost sprites in OAM descriptors 1..4.
pac_ghost_sprite:
    LDI SEG_OAM
    MVS ES, R0
    LSI R6, 0
pac_gs_loop:
    LDI ST_G_PX
    MOV R2, R0
    ADD R2, R6
    LDS R2, DS, R2
    LDI 16
    MOV R3, R0
    SUB R2, R3
    LDI ST_G_PY
    MOV R3, R0
    ADD R3, R6
    LDS R5, DS, R3
    LDI 16
    MOV R3, R0
    SUB R5, R3
    LDI pac_ghost_groups
    MOV R3, R0
    ADD R3, R6
    LDS R3, DS, R3
    SL R3, 11
    OR R3, R5
    MOV R4, R6
    ADD R4, 1
    SL R4, 1
    ADD R4, 1
    STS R3, ES, R4
    LDI 0x0800
    MOV R3, R0
    OR R3, R2
    MOV R4, R6
    ADD R4, 1
    SL R4, 1
    STS R3, ES, R4
    ADD R6, 1
    LSI R3, 4
    CMP R6, R3
    JNZ pac_gs_loop
    NOP
    JMP LR
    NOP

; =====================================================================
; Pac-Man sprite (OAM descriptor 0)
; =====================================================================
pac_sprite:
    LDI SEG_OAM
    MVS ES, R0
    ; the interpolated centre, minus half a 32x32 sprite
    LDI ST_PAC_PX
    MOV R2, R0
    LD R2, R2, 0
    LDI 16
    MOV R3, R0
    SUB R2, R3
    LDI ST_PAC_PY
    MOV R3, R0
    LD R5, R3, 0
    LDI 16
    MOV R3, R0
    SUB R5, R3

    ; munch phase: 0 open, 1 half, 2 closed, 3 half
    LDI ST_PAC_ANIM
    MOV R3, R0
    LD R3, R3, 0
    LSI R7, 2
    CMP R3, R7
    JZ pac_sp_closed
    NOP
    LSI R7, 1
    AND R3, R7                 ; 0 open, 1 half
    LDI pac_sp_dir
    MOV PC, R0
    NOP
pac_sp_closed:
    LSI R3, 10                 ; shared closed frame
    LDI pac_sp_write
    MOV PC, R0
    NOP
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

pac_sp_write:
    ; shared closed frame: group 10 << 11 | y, no H flip
    MOV R4, R3
    SL R4, 11
    OR R4, R5
    LSI R0, 1
    STS R4, ES, R0
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
; Reads one UART byte: WASD or the arrow keys set the requested direction,
; Q exits.  Arrows are the E0 navigation bytes 0x10/0x0e/0x02/0x06;
; WASD is case-folded first because the PS/2 map produces both cases.
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
    ; arrow keys arrive as the PS/2 E0 navigation bytes, before case folding
    LDI 0x10
    MOV R3, R0
    CMP R1, R3
    JZ pac_k_up
    NOP
    CMP R1, 14
    JZ pac_k_down
    NOP
    CMP R1, 2
    JZ pac_k_left
    NOP
    CMP R1, 6
    JZ pac_k_right
    NOP
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

; R1 = DS source, R5 = table of target sprite groups, R6 = group count.
pac_copy_frames:
    LDI ST_SVLR
    MOV R2, R0
    ST LR, R2, 0
    LDI SEG_SPR
    MVS ES, R0
pac_cf_group:
    LDS R2, DS, R5
    SL R2, 8
    LSI R8, 0
    LDI 256
    MOV R3, R0
pac_cf_word:
    LDS R4, DS, R1
    MOV R7, R2
    ADD R7, R8
    STS R4, ES, R7
    ADD R1, 1
    ADD R8, 1
    SUB R3, 1
    JNZ pac_cf_word
    NOP
    ADD R5, 1
    SUB R6, 1
    JNZ pac_cf_group
    NOP
    LDI ST_SVLR
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; Save the three Flappy dizzy groups Pac-Man reuses, so Flappy still works
; after a game.  768 words live at DS 0x2000, above the slice image.
pac_save_groups:
    LDI ST_SVLR
    MOV R2, R0
    ST LR, R2, 0
    LDI SEG_SPR
    MVS ES, R0
    LDI 0x2000
    MOV R1, R0
    LDI pac_saved_groups
    MOV R5, R0
    LSI R6, 3
pac_sg_group:
    LDS R2, DS, R5
    SL R2, 8
    LSI R8, 0
    LDI 256
    MOV R3, R0
pac_sg_word:
    MOV R7, R2
    ADD R7, R8
    LDS R4, ES, R7
    ST R4, R1, 0
    ADD R1, 1
    ADD R8, 1
    SUB R3, 1
    JNZ pac_sg_word
    NOP
    ADD R5, 1
    SUB R6, 1
    JNZ pac_sg_group
    NOP
    LDI ST_SVLR
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

pac_restore_groups:
    LDI ST_SVLR
    MOV R2, R0
    ST LR, R2, 0
    LDI SEG_SPR
    MVS ES, R0
    LDI 0x2000
    MOV R1, R0
    LDI pac_saved_groups
    MOV R5, R0
    LSI R6, 3
pac_rg_group:
    LDS R2, DS, R5
    SL R2, 8
    LSI R8, 0
    LDI 256
    MOV R3, R0
pac_rg_word:
    MOV R7, R2
    ADD R7, R8
    LD R4, R1, 0
    STS R4, ES, R7
    ADD R1, 1
    ADD R8, 1
    SUB R3, 1
    JNZ pac_rg_word
    NOP
    ADD R5, 1
    SUB R6, 1
    JNZ pac_rg_group
    NOP
    LDI ST_SVLR
    MOV R2, R0
    LD LR, R2, 0
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
    LDI pac_restore_groups
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI SEG_OAM
    MVS ES, R0
    LDI 0x00E6
    MOV R2, R0
    LDI ST_PAL0
    MOV R4, R0
    LD R3, R4, 0
    STS R3, ES, R2
    ADD R2, 1
    LDI ST_PAL1
    MOV R4, R0
    LD R3, R4, 0
    STS R3, ES, R2
    ADD R2, 1
    LDI ST_PAL2
    MOV R4, R0
    LD R3, R4, 0
    STS R3, ES, R2
    ADD R2, 1
    LDI ST_PAL3
    MOV R4, R0
    LD R3, R4, 0
    STS R3, ES, R2
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
