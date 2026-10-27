; flappy_game.asm - compact Flappy-style showcase game.
;
; Assembled after asm/showcase.asm. The block starts at 0x0A00 and must end
; before 0x0E00. Everything the game executes, including the death sequence,
; lives here: no code is placed in the showcase data gaps. It installs the art
; palette on entry and restores the default palette on exit.
;
; The menu is the title screen. F starts play; the menu's idle timer starts the
; same game in attract mode. There is no text overlay during play: the double-
; buffered map and the bird sprite are the whole scene.

.org 0x0A00

; =====================================================================
; Helpers (also called by the menu)
; =====================================================================
scene_init:
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
scene_clear:
    STS R3, ES, R2
    ADD R2, 1
    SUB R4, 1
    JNZ scene_clear
    NOP

    LDI SEG_OAM
    MVS ES, R0
    LSI R2, 0
    LDI 16
    MOV R4, R0
scene_oam:
    STS R3, ES, R2
    ADD R2, 1
    SUB R4, 1
    JNZ scene_oam
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
draw_text_loop:
    LDS R0, DS, R8
    AND R0, R0
    JZ draw_text_done
    NOP
    SUB R0, R1
    SL R0, 5
    STS R0, ES, R2
    ADD R8, 1
    ADD R2, 1
    LDI draw_text_loop
    MOV PC, R0
    NOP
draw_text_done:
    JMP LR
    NOP

wait_frame:
    LDI SEG_UART
    MVS ES, R0
    LDI 0x26
    MOV R2, R0
wait_frame_loop:
    LDS R1, ES, R2
    LSI R3, 2
    AND R1, R3
    LDI G_LAST_FRAME
    MOV R4, R0
    LD R5, R4, 0
    CMP R1, R5
    JZ wait_frame_loop
    NOP
    ST R1, R4, 0
    JMP LR
    NOP

; R8 = palette table offset in DS (16 words). Writes all 16 entries.
set_palette:
    LDI SEG_OAM
    MVS ES, R0
    LDI 0x80
    MOV R2, R0
    LDI 16
    MOV R5, R0
set_pal_loop:
    LDS R4, DS, R8
    STS R4, ES, R2
    ADD R8, 1
    ADD R2, 1
    SUB R5, 1
    JNZ set_pal_loop
    NOP
    JMP LR
    NOP

set_bird:
    LDI SEG_OAM
    MVS ES, R0
    ; one animation counter drives the wing beat and the dizzy poses
    LDI G_BIRD_ANIM
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0

    ; death poses: dizzy while death == 1, upside down afterwards
    LDI G_DEATH
    MOV R7, R0
    LD R5, R7, 0
    AND R5, R5
    JZ sb_alive
    NOP
    LSI R6, 1
    CMP R5, R6
    JNZ sb_fall
    NOP
    ; bedazzled: groups 3,4,5 ping-pong, one pose every four frames
    MOV R4, R3
    SR R4, 2
    LSI R5, 3
    AND R4, R5
    LDI dizzy_groups
    MOV R5, R0
    ADD R5, R4
    LDS R4, DS, R5
    LSI R6, 0
    LDI sb_emit
    MOV PC, R0
    NOP
sb_fall:
    ; stay bedazzled, upside down, while falling to the ground
    LSI R4, 5
    LSI R6, 1
    LDI sb_emit
    MOV PC, R0
    NOP
sb_alive:
    ; two wing poses cycle slowly: groups 6 and 7
    MOV R4, R3
    SR R4, 3
    LSI R5, 1
    AND R4, R5
    LSI R5, 6
    ADD R4, R5
    LSI R6, 0
sb_emit:
    MOV R5, R4
    SL R5, 10
    AND R6, R6
    JZ sb_novflip
    NOP
    LDI 0x4000
    MOV R7, R0
    OR R5, R7
sb_novflip:
    LDI 0x60
    MOV R7, R0
    OR R5, R7
    LSI R2, 0
    STS R5, ES, R2             ; group<<10 | x=96 (plus vflip when dead)
    LDI G_BIRD_Y
    MOV R4, R0
    LD R5, R4, 0
    LDI 0x0400
    MOV R3, R0
    OR R5, R3
    LSI R2, 1
    STS R5, ES, R2
    JMP LR
    NOP

; =====================================================================
; Tilemap drawing (font '#' pipes, '_' ground)
; =====================================================================
draw_map:
    MOV R10, LR
    LDI SEG_TILE
    MVS ES, R0
    LSI R2, 0
    LDI 2132
    MOV R4, R0
    LSI R3, 0
map_fill:
    STS R3, ES, R2
    ADD R2, 1
    SUB R4, 1
    JNZ map_fill
    NOP

    ; clouds behind the pipes (rows 3 and 6)
    LSI R6, 0
cloud_draw_loop:
    LDI G_CLOUD_X
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2
    LDI cloud_rows
    MOV R2, R0
    ADD R2, R6
    LDS R9, DS, R2
    LDI draw_cloud
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R6, 1
    LSI R4, 4
    CMP R6, R4
    JNZ cloud_draw_loop
    NOP

    ; four pipes, one call each. draw_pipe keeps its scratch in R0/R4 and
    ; never touches R6, so R6 can carry the loop index.
    LSI R6, 0
pipe_call_loop:
    LDI G_PIPE_X
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2
    LDI G_PIPE_GAP
    MOV R2, R0
    ADD R2, R6
    LDS R9, DS, R2
    LDI draw_pipe
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R6, 1
    LSI R4, 4
    CMP R6, R4
    JNZ pipe_call_loop
    NOP

    ; ground: grass row 22, dirt row 23
    LDI 1804
    MOV R2, R0
    LDI T_GRASS
    MOV R3, R0
    LDI 82
    MOV R4, R0
map_ground:
    STS R3, ES, R2
    ADD R2, 1
    SUB R4, 1
    JNZ map_ground
    NOP
    LDI 1886
    MOV R2, R0
    LDI T_DIRT
    MOV R3, R0
    LDI 82
    MOV R4, R0
map_ground2:
    STS R3, ES, R2
    ADD R2, 1
    SUB R4, 1
    JNZ map_ground2
    NOP
    MOV LR, R10
    JMP LR
    NOP

; R8 = pipe_x, R9 = gap row. Preserves R6.
draw_pipe:
    LDI 82
    MOV R1, R0
    LDI G_DRAW_ORIGIN
    MOV R2, R0
    LD R2, R2, 0
    CMP R8, R2
    JC pipe_done
    NOP
    MOV R0, R8
    SUB R0, R2
    SR R0, 3
    MOV R2, R0
    LDI 81
    MOV R3, R0
    CMP R3, R2
    JC pipe_done
    NOP
    LSI R7, 0
pipe_col:
    MOV R3, R2
    ADD R3, R7
    LDI 81
    MOV R4, R0
    CMP R4, R3
    JC pipe_next_col
    NOP
    LSI R5, 0
pipe_row:
    MOV R4, R9
    SUB R4, 1
    CMP R5, R4
    JC pipe_draw
    NOP
    CMP R5, R4
    JZ pipe_draw
    NOP
    MOV R4, R9
    ADD R4, 6
    CMP R5, R4
    JC pipe_skip
    NOP
    CMP R5, R4
    JZ pipe_draw
    NOP
pipe_draw:
    ; body = 96, cap-down (top pipe, row gap-1) = 102, cap-up = 99.
    ; R0 holds the tile: it is dead scratch from here to the end of the row.
    LDI T_PIPE_L
    MOV R4, R9
    SUB R4, 1
    CMP R5, R4
    JNZ pipe_not_capdown
    NOP
    LDI T_CAPD_L
pipe_not_capdown:
    MOV R4, R9
    ADD R4, 6
    CMP R5, R4
    JNZ pipe_not_capup
    NOP
    LDI T_CAPU_L
pipe_not_capup:
    MOV R4, R7
    SL R4, 5
    ADD R4, R0
    STS R4, ES, R3
pipe_skip:
    ADD R3, R1
    ADD R5, 1
    LDI 26
    MOV R4, R0
    CMP R5, R4
    JC pipe_row
    NOP
pipe_next_col:
    ADD R7, 1
    LSI R4, 3
    CMP R7, R4
    JC pipe_col
    NOP
pipe_done:
    JMP LR
    NOP

; =====================================================================
; Game
; =====================================================================
game_entry:
    LDI SEG_DEMO
    MVS DS, R0
    LDI pal_art
    MOV R8, R0
    LDI set_palette
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI G_START_MODE
    MOV R2, R0
    LD R1, R2, 0
    LSI R3, 1
    CMP R1, R3
    JZ attract_start
    NOP
    LDI start_play
    MOV PC, R0
    NOP

attract_start:
    LSI R2, 3
    LDI G_MODE
    MOV R3, R0
    ST R2, R3, 0
    MOV R11, R2
    LDI reset_play
    MOV PC, R0
    NOP

start_play:
    LSI R2, 1
    LDI G_MODE
    MOV R3, R0
    ST R2, R3, 0
    LSI R11, 0
    LDI reset_play
    MOV PC, R0
    NOP

reset_play:
    LSI R2, 0
    LDI G_WORLD
    MOV R3, R0
    ST R2, R3, 0
    LDI G_ORIGIN
    MOV R3, R0
    ST R2, R3, 0
    LDI G_BIRD_VY
    MOV R3, R0
    ST R2, R3, 0
    LDI G_TMP
    MOV R3, R0
    ST R2, R3, 0
    LDI G_FLAP_TIMER
    MOV R3, R0
    ST R2, R3, 0
    LDI G_DEATH
    MOV R3, R0
    ST R2, R3, 0
    ; four cloud world positions, recycled ahead of the view
    LSI R6, 0
ci_loop:
    LDI G_CLOUD_X
    MOV R2, R0
    ADD R2, R6
    LDI cloud_init
    MOV R3, R0
    ADD R3, R6
    LDS R4, DS, R3
    ST R4, R2, 0
    ADD R6, 1
    LSI R4, 4
    CMP R6, R4
    JNZ ci_loop
    NOP
    LSI R3, 0
    LDI G_BIRD_ANIM
    MOV R2, R0
    ST R3, R2, 0
    LSI R2, 0
    LDI G_FRONT
    MOV R3, R0
    ST R2, R3, 0
    LSI R2, 1
    LDI G_BACK
    MOV R3, R0
    ST R2, R3, 0
    LDI 180
    MOV R2, R0
    LDI G_BIRD_Y
    MOV R3, R0
    ST R2, R3, 0

    LDI G_PIPE_X
    MOV R2, R0
    LDI 704
    MOV R3, R0
    LDI 192
    MOV R4, R0
    LSI R5, 4
px_init:
    ST R3, R2, 0
    ADD R3, R4
    ADD R2, 1
    SUB R5, 1
    JNZ px_init
    NOP
    LDI G_PIPE_GAP
    MOV R2, R0
    LSI R3, 8
    LSI R4, 2
    LSI R5, 4
pg_init:
    ST R3, R2, 0
    ADD R3, R4
    ADD R2, 1
    SUB R5, 1
    JNZ pg_init
    NOP
    LDI 1472
    MOV R3, R0
    LDI G_NEXT_PIPE
    MOV R2, R0
    ST R3, R2, 0

    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 8
    LSI R3, 0
    STS R3, ES, R2             ; write page 0, display page 0
    LSI R2, 4
    LSI R3, 0
    STS R3, ES, R2
    LSI R2, 6
    STS R3, ES, R2
    LSI R2, 2
    STS R3, ES, R2
    LSI R2, 0
    STS R3, ES, R2

    LSI R3, 0
    LDI G_DRAW_ORIGIN
    MOV R2, R0
    ST R3, R2, 0
    LDI draw_map
    MOV R4, R0
    LINK
    JMP R4
    NOP

    LDI set_bird
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI -384
    MOV R2, R0
    LDI G_BIRD_VY
    MOV R3, R0
    ST R2, R3, 0               ; start/restart with one flap

play_loop:
    LDI wait_frame
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; OAM first, right after the frame boundary: before the scan reaches the
    ; bird's row, and before the map redraw work.  set_bird also applies the
    ; dizzy / upside-down death pose.
    LDI set_bird
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; death state takes over the frame: dizzy hold, upside-down fall,
    ; a short rest on the ground, then attract.  It lives here in the game
    ; block so no showcase data gap is ever executed.
    LDI G_DEATH
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ no_death
    NOP

    ; a UART key still works while dead: Q quits immediately
    LDI SEG_UART
    MVS ES, R0
    LDI 0x26
    MOV R2, R0
    LDS R1, ES, R2
    LSI R3, 8
    AND R1, R3
    JZ death_state
    NOP
    LSI R2, 2
    LDS R1, ES, R2             ; consume the byte
    LDI 0xDF
    MOV R3, R0
    AND R1, R3
    LDI 0x51
    MOV R3, R0
    CMP R1, R3
    JZ key_quit
    NOP

death_state:
    ; 1 = dizzy, 2 = falling, 3 = resting on the ground
    LDI G_DEATH
    MOV R2, R0
    LD R3, R2, 0
    SUB R3, 2
    JZ death_fall
    NOP
    SUB R3, 1
    JZ death_rest
    NOP
    LD R3, R2, 1               ; dizzy timer
    SUB R3, 1
    ST R3, R2, 1
    JZ death_drop
    NOP
    LDI play_loop
    MOV PC, R0
    NOP
death_drop:
    LSI R3, 2
    ST R3, R2, 0

death_fall:
    ; fixed fast fall; the OAM vflip already turned the bird over
    LDI G_BIRD_Y
    MOV R4, R0
    LD R5, R4, 0
    ADD R5, 6
    ST R5, R4, 0
    LDI 300
    MOV R3, R0
    CMP R3, R5
    JC death_land
    NOP
    LDI play_loop
    MOV PC, R0
    NOP

death_land:
    LDI 300
    MOV R5, R0
    ST R5, R4, 0
    LDI 45
    MOV R5, R0
    LDI G_DEATH_TIMER
    MOV R3, R0
    ST R5, R3, 0
    LSI R3, 3
    LDI G_DEATH
    MOV R2, R0
    ST R3, R2, 0
    LDI play_loop
    MOV PC, R0
    NOP

death_rest:
    LD R3, R2, 1
    SUB R3, 1
    ST R3, R2, 1
    JZ death_end
    NOP
    LDI play_loop
    MOV PC, R0
    NOP
death_end:
    LDI attract_start
    MOV PC, R0
    NOP

no_death:

    LDI G_WORLD
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0
    MOV R1, R3
    LSI R4, 15
    AND R1, R4
    AND R1, R1
    JNZ scroll_now
    NOP
    ; Wrap frame: keep the OLD scroll until the back page is fully drawn.
    ; Otherwise the scroll and the page swap can latch on different frames
    ; and the whole map jumps 16 px for one frame.
    LDI wrap_draw
    MOV PC, R0
    NOP
scroll_now:
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 4
    STS R1, ES, R2
    LDI play_no_swap
    MOV PC, R0
    NOP

wrap_draw:
    ; Double buffer: draw the next 16-pixel slice into the back page, then
    ; ask for it to be displayed at the next frame boundary. The front page
    ; stays live, so the redraw cannot tear.
    ;   page register = (front << 1) | back
    LDI G_FRONT
    MOV R2, R0
    LD R3, R2, 0
    SL R3, 1
    LDI G_BACK
    MOV R2, R0
    LD R4, R2, 0
    OR R3, R4
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 8
    STS R3, ES, R2
    ; origin = the world this slice starts at
    LDI G_WORLD
    MOV R2, R0
    LD R3, R2, 0
    LDI G_ORIGIN
    MOV R5, R0
    ST R3, R5, 0
    LDI G_DRAW_ORIGIN
    MOV R5, R0
    ST R3, R5, 0
    LDI draw_map
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; New scroll 0, written here so it latches together with the page swap.
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 4
    LSI R3, 0
    STS R3, ES, R2
    ; page register = (back << 1) | back: display and write the new page
    LDI G_BACK
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
    LDI G_FRONT
    MOV R2, R0
    ST R4, R2, 0
    LSI R3, 1
    SUB R3, R4
    LDI G_BACK
    MOV R2, R0
    ST R3, R2, 0

play_no_swap:
    ; fall through: the shared input check below handles S2 and the UART
play_check_button:
    LDI SEG_UART
    MVS ES, R0
    LDI 0x26
    MOV R2, R0
    LDS R1, ES, R2             ; 0xF0066: b3 UART key ready, b2 S2
    LDI 0x0C
    MOV R3, R0
    AND R1, R3
    JZ play_no_key
    NOP
    LDI 1
    MOV R10, R0                ; R10: flap request for physics_step
    LDI 0
    MOV R11, R0                ; R11: manual mode (no autopilot)
    LSI R3, 6
    LDI G_FLAP_TIMER
    MOV R2, R0
    ST R3, R2, 0               ; one key = ~6 frames of flap
    LSI R2, 2
    LDS R1, ES, R2             ; pop any UART byte (no-op when S2 only)
    ; Q/q exits. Every other key takes the flap branch.
    LDI 0xDF
    MOV R3, R0
    AND R1, R3
    LDI 0x51
    MOV R3, R0
    CMP R1, R3
    JZ key_quit
    NOP
    ; Make the non-quit path a TAKEN branch: a register jump after a
    ; not-taken JZ following the UART data read was not working.
    LSI R3, 1
    AND R3, R3
    JNZ do_flap
    NOP
key_quit:
    LDI exit_showcase
    MOV PC, R0
    NOP
do_flap:
    LDI play_step
    MOV PC, R0
    NOP

play_no_key:
    AND R11, R11
    JZ play_step
    NOP
    LDI autopilot
    MOV R4, R0
    LINK
    JMP R4
    NOP

play_step:
    LDI physics_step
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pipes_step
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI clouds_step
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI G_TMP
    MOV R2, R0
    LD R1, R2, 0
    AND R1, R1
    JZ play_alive
    NOP
    LSI R3, 0
    LDI G_BIRD_VY
    MOV R2, R0
    ST R3, R2, 0
    LDI G_FLAP_TIMER
    MOV R2, R0
    ST R3, R2, 0
    LSI R3, 1
    LDI G_DEATH
    MOV R2, R0
    ST R3, R2, 0
    LDI 30
    MOV R3, R0
    LDI G_DEATH_TIMER
    MOV R2, R0
    ST R3, R2, 0
    LDI play_loop
    MOV PC, R0

play_alive:
    LDI play_loop
    MOV PC, R0
    NOP

; =====================================================================
; Cloud helper and scroll recycler
; =====================================================================
; R8 = cloud world x, R9 = row. Draws three cloud tiles.
draw_cloud:
    LDI 82
    MOV R1, R0
    LDI G_DRAW_ORIGIN
    MOV R2, R0
    LD R2, R2, 0
    CMP R8, R2
    JC cloud_done
    NOP
    MOV R0, R8
    SUB R0, R2
    SR R0, 3
    MOV R2, R0
    LDI 79
    MOV R3, R0
    CMP R3, R2
    JC cloud_done
    NOP
    MOV R3, R9
    SL R3, 6
    MOV R4, R9
    SL R4, 4
    ADD R3, R4
    MOV R4, R9
    SL R4, 1
    ADD R3, R4
    ADD R3, R2
    LDI T_CLOUD_L
    MOV R4, R0
    STS R4, ES, R3
    LDI T_CLOUD_M
    MOV R4, R0
    ADD R3, 1
    STS R4, ES, R3
    LDI T_CLOUD_R
    MOV R4, R0
    ADD R3, 1
    STS R4, ES, R3
cloud_done:
    JMP LR
    NOP

clouds_step:
    LSI R6, 0
cloud_loop:
    LDI G_CLOUD_X
    MOV R2, R0
    ADD R2, R6
    LD R3, R2, 0
    LDI G_WORLD
    MOV R4, R0
    LD R4, R4, 0
    LDI 40
    MOV R5, R0
    ADD R5, R3
    CMP R5, R4
    JNC cloud_next
    NOP
    LDI 800
    MOV R5, R0
    ADD R3, R5
    ST R3, R2, 0
cloud_next:
    ADD R6, 1
    LSI R4, 4
    CMP R6, R4
    JNZ cloud_loop
    NOP
    JMP LR
    NOP

; =====================================================================
; Physics / pipes / autopilot
; =====================================================================
physics_step:
    LDI G_BIRD_VY
    MOV R2, R0
    LD R1, R2, 0
    LDI 16
    MOV R3, R0
    ADD R1, R3
    LDI 384
    MOV R3, R0
    CMP R3, R1
    JC physics_max
    NOP
    LDI physics_after_gravity
    MOV PC, R0
    NOP
physics_max:
    MOV R1, R3
physics_after_gravity:
    AND R10, R10
    JNZ physics_flap_now
    NOP
    LDI G_FLAP_TIMER
    MOV R3, R0
    LD R4, R3, 0
    AND R4, R4
    JZ physics_no_flap
    NOP
    SUB R4, 1
    ST R4, R3, 0
physics_flap_now:
    LDI 0
    MOV R10, R0                ; consume the one-shot request
    LDI -384
    MOV R1, R0
physics_no_flap:
    ST R1, R2, 0
    MOV R3, R1
    SRA R3, 8
    LDI G_BIRD_Y
    MOV R4, R0
    LD R5, R4, 0
    ADD R5, R3
    JN physics_floor
    NOP
    ST R5, R4, 0
    LDI 300
    MOV R3, R0
    CMP R3, R5
    JC physics_hit
    NOP
    JMP LR
    NOP
physics_floor:
    LSI R5, 0
    ST R5, R4, 0
    LSI R1, 0
    ST R1, R2, 0
    JMP LR
    NOP
physics_hit:
    LSI R3, 1
    LDI G_TMP
    MOV R2, R0
    ST R3, R2, 0
    JMP LR
    NOP

pipes_step:
    LSI R6, 0
pipe_step_loop:
    LDI G_PIPE_X
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2
    LDI G_PIPE_GAP
    MOV R2, R0
    ADD R2, R6
    LDS R9, DS, R2
    LDI G_WORLD
    MOV R2, R0
    LD R3, R2, 0
    MOV R4, R8
    LDI 32
    MOV R5, R0
    ADD R4, R5
    CMP R4, R3
    JC pipe_step_recycle
    NOP

    CMP R8, R3
    JC pipe_step_next
    NOP
    MOV R4, R8
    SUB R4, R3
    LDI 76
    MOV R5, R0
    CMP R4, R5
    JC pipe_step_next
    NOP
    LDI 124
    MOV R5, R0
    CMP R5, R4
    JC pipe_step_next
    NOP

    MOV R5, R9
    SL R5, 4
    MOV R4, R9
    SUB R5, R4
    LDI G_BIRD_Y
    MOV R2, R0
    LD R4, R2, 0
    CMP R4, R5
    JC pipe_step_hit
    NOP
    MOV R5, R9
    ADD R5, 6
    MOV R4, R5
    SL R4, 4
    SUB R4, R5
    MOV R2, R4
    LDI G_BIRD_Y
    MOV R5, R0
    LD R5, R5, 0
    LDI 24
    ADD R5, R0
    CMP R2, R5
    JC pipe_step_hit
    NOP
    LDI pipe_step_next
    MOV PC, R0
    NOP

pipe_step_recycle:
    LDI G_NEXT_PIPE
    MOV R2, R0
    LD R4, R2, 0
    MOV R8, R4
    LDI 192
    MOV R5, R0
    ADD R4, R5
    ST R4, R2, 0
    LDI G_PIPE_X
    MOV R2, R0
    ADD R2, R6
    ST R8, R2, 0
    MOV R4, R8
    SR R4, 6
    LSI R5, 7
    AND R4, R5
    ADD R4, 6
    MOV R9, R4
    LDI G_PIPE_GAP
    MOV R2, R0
    ADD R2, R6
    ST R9, R2, 0
    LDI pipe_step_next
    MOV PC, R0
    NOP

pipe_step_hit:
    LSI R4, 1
    LDI G_TMP
    MOV R2, R0
    ST R4, R2, 0
pipe_step_next:
    ADD R6, 1
    LSI R3, 4
    CMP R6, R3
    JNZ pipe_step_loop
    NOP
    JMP LR
    NOP

autopilot:
    LDI 0x7FFF
    MOV R7, R0
    LDI 180
    MOV R8, R0
    LSI R6, 0
auto_loop:
    LDI G_PIPE_X
    MOV R2, R0
    ADD R2, R6
    LDS R9, DS, R2
    LDI G_WORLD
    MOV R2, R0
    LD R10, R2, 0
    CMP R9, R10
    JC auto_next
    NOP
    MOV R2, R9
    SUB R2, R10
    CMP R2, R7
    JNC auto_next
    NOP
    MOV R7, R2
    LDI G_PIPE_GAP
    MOV R3, R0
    ADD R3, R6
    LDS R4, DS, R3
    MOV R8, R4
    SL R8, 4
    SUB R8, R4
    LDI 33
    MOV R3, R0
    ADD R8, R3
auto_next:
    ADD R6, 1
    LSI R3, 4
    CMP R6, R3
    JNZ auto_loop
    NOP
    LDI G_BIRD_Y
    MOV R2, R0
    LD R1, R2, 0
    CMP R1, R8
    JC auto_no_flap
    NOP
    ; same lift as a key tap: six more frames of flap, so the autopilot
    ; corrects in one gentle hop instead of a one-frame twitch
    LSI R10, 1
    LSI R3, 6
    LDI G_FLAP_TIMER
    MOV R2, R0
    ST R3, R2, 0
    JMP LR
    NOP
auto_no_flap:
    LSI R10, 0
    JMP LR
    NOP

; =====================================================================
; Exit / restore
; =====================================================================
exit_showcase:
    LDI pal_default
    MOV R8, R0
    LDI set_palette
    MOV R4, R0
    LINK
    JMP R4
    NOP
    MOV PC, R12
    NOP

; Sprite groups for the dizzy pose, a ping-pong through three frames.
dizzy_groups:
    .word 3, 4, 5, 4
