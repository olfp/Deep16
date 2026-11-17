; frogger_demo.asm - the FiT Frogger game, widescreen layout.
;
; Five river lanes and four road lanes, each moving independently, drawn as
; double-height 24x30 game cells, with a frog sprite that hops across them,
; rides the logs and turtles and fills five home bays. The point of the
; per-row scroll is control 6: it gives each tilemap row a 0..7 pixel fine
; offset, while the row content is rewritten by whole cells when the fine
; offset wraps. The lane phase is kept in quarter pixels (0..31) so the speeds
; can differ by a quarter pixel per frame.
;
; Assembled with .org 0 and loaded as a type-4 slice at segment 0x0600.  The
; menu jumps here with R10/R11 as the return pair.  Q returns to the menu.
;
; Tile art rides in the slice's tile pack at 0x1000 (magic 0x0A57):
;   26..37 the home bay (six cells x two rows: water and a lily pad),
;   38 hedge, 57 water, 58 road, 59..63 a log, 69..76 a turtle, 77..84 the blue
;   car, 85..92 the yellow car, 93..104 the fire truck, 105..120 the truck,
;   126 grass and 127 the time bar.  Each moving object is a 32x30 cell, i.e.
;   four tiles wide and two tile rows tall; the 26-pixel art is centred in it
;   and every vehicle is stretched to the same 26x20 box so they all have the
;   same length.  The demo installs the 16-entry palette in set 2's art bank
;   at run time.
;
; Sprite art rides in the slice's sprite pack at 0x2000 (magic 0x0A58):
;   0 idle facing up, 1 idle facing right, 2 hop up, 3 hop right, 4 squash,
;   5 home frog, 6 fly.  Facing left is group 1/3 with the OAM H flip; facing
;   down is group 0/2 with the V flip.
;
; Screen layout, top to bottom (24 tile rows = 12 double-height lanes):
;   0..1   home row: hedge with five bays; panel row 0 = SCORE, row 1 = HI
;   2..3   river 5 (top): logs, normal speed, moving right
;   4..5   river 4: turtles, a little slower, moving left
;   6..7   river 3: logs, fast, moving right
;   8..9   river 2: logs, slow, moving right
;   10..11 river 1 (bottom): turtles, a little slower, moving left
;   12..13 median grass
;   14..15 road 4 (top): the truck, moving left, heavy and slow
;   16..17 road 3: the yellow car, moving right
;   18..19 road 2: the fire truck, moving left
;   20..21 road 1: the blue car, moving right, slowest
;   22..23 bottom bank: static; panel row 23 = LIVES/TIME
;
; Columns 0..23 are the 192-pixel panel and columns 24..79 are the 448-pixel
; playfield; 80..81 are the margin cells the fine phase reads at the screen
; edge.  The column scroll window (control 5 bit 11, bound and side in
; control 6 row 31) keeps the panel at fine 0 while the playfield rows use
; their phase.  The panel sits on the left so the scrolling edge that objects
; cross is the screen edge, not a visible window boundary.

.equ SEG_TILE -0x0F00          ; 0xF100 tilemap
.equ SEG_CTRL -0x0E00          ; 0xF200 controls
.equ SEG_OAM  -0x0A00          ; 0xF600 OAM + palette
.equ SEG_UART -0xFFC           ; 0xF004 UART/status

; tile values (tile index << 5)
.equ T_WATER  0x720           ; 57 water
.equ T_ROAD   0x740           ; 58 asphalt
.equ T_LOG    0x760           ; 59..68 log: cap, cap, middle, cap, cap
.equ T_TURTLE 0x8A0           ; 69..76 turtle
.equ T_CAR_B  0x9A0           ; 77..84 blue car
.equ T_CAR_Y  0xAA0           ; 85..92 yellow car
.equ T_FIRE   0xBA0           ; 93..104 fire truck, six cells
.equ T_TRUCK  0xD20           ; 105..120 truck, eight cells
.equ T_GRASS  0xFC0           ; 126 ground
.equ T_BAR    0xFE0           ; 127 time-bar cell
.equ T_HEDGE  0x4C0           ; 38 hedge wall (home row)
.equ T_BAY    0x340           ; 26..37 home bay: six cells, two rows
.equ T_PANEL  0x000           ; blank tile; palette art entry 0 is the panel

; BIOS sound effects (function 9 starts, function 10 ticks once per frame).
.equ SFX_DEATH 3
.equ SFX_TICK  5

; the frog's facing, set by the last hop
.equ DIR_UP    0
.equ DIR_RIGHT 1
.equ DIR_DOWN  2
.equ DIR_LEFT  3

; game states
.equ ST_READY 0                ; attract: the board scrolls, Space starts
.equ ST_PLAY  1
.equ ST_DYING 2
.equ ST_LEVEL 3
.equ ST_OVER  4                ; game over: Space starts a new game
; the panel prompt (FR_MSG)
.equ MSG_NONE  0
.equ MSG_PRESS 1
.equ MSG_OVER  2
; HUD fields that need repainting (FR_HUD)
.equ HUD_SCORE 1
.equ HUD_HI    2
.equ HUD_LIVES 4
.equ HUD_MSG   8

; state (inside the block, after the code)
.equ FR_START  0xA00           ; nine 0..15 coarse start cells
.equ FR_PHASE  0xA09           ; nine 0..31 quarter-pixel phases
.equ FR_LASTF  0xA12
.equ FR_RET10  0xA13
.equ FR_RET11  0xA14
.equ FR_DIRTY  0xA15           ; nine "row changed last frame" cells
.equ FR_FRONT  0xA1E           ; displayed tilemap bank
.equ FR_BACK   0xA1F           ; write tilemap bank
.equ FR_TIME   0xA20           ; time bar cells left (0..56)
.equ FR_TICK   0xA21           ; frames until the next cell
.equ FR_BARD   0xA22           ; bar dirty flag
.equ FR_FXQ    0xA30           ; frog x in quarter pixels
.equ FR_LANE   0xA31           ; frog lane 0..11 (0 = top bank)
.equ FR_HOP    0xA32           ; hop animation frames left
.equ FR_DEAD   0xA33           ; death countdown frames
.equ FR_HOMES  0xA34           ; five "bay filled" bits
.equ FR_LEVEL  0xA35           ; completed levels
.equ FR_PAUSE  0xA36           ; level-complete pause frames left
.equ FR_STATE  0xA37           ; ST_* game state
.equ FR_LIVES  0xA38           ; lives left
.equ FR_SCORE  0xA39           ; 16-bit score
.equ FR_HI     0xA3A           ; best score this session
.equ FR_EXTRA  0xA3B           ; 20000-point extra life taken
.equ FR_HUD    0xA3C           ; HUD fields changed this frame
.equ FR_HUD2   0xA3D           ; the same fields again next frame
.equ FR_MSG    0xA3E           ; MSG_* panel prompt
.equ FR_DIR    0xA3F           ; DIR_* facing of the last hop

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

    ; Time bar starts full; the right panel shows 23 cells of time.
    LDI FR_TIME
    MOV R2, R0
    LDI 23
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_TICK
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI FR_BARD
    MOV R2, R0
    ST R3, R2, 0

    ; frog starts on the bottom bank, centred on the bay lattice
    LDI FR_FXQ
    MOV R2, R0
    LDI 1728
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_LANE
    MOV R2, R0
    LDI 11
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_HOP
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI FR_DEAD
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_HOMES
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_LEVEL
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_PAUSE
    MOV R2, R0
    ST R3, R2, 0
    ; attract mode with three lives and no score; Space starts the game
    LDI FR_STATE
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_SCORE
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_HI
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_EXTRA
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_HUD2
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_LIVES
    MOV R2, R0
    LDI 3
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_MSG
    MOV R2, R0
    LDI MSG_PRESS
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_DIR
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI FR_HUD
    MOV R2, R0
    LDI 15
    MOV R3, R0
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
    LDI 0x2EF8                 ; control 6 row 31: column 23, left panel
    MOV R3, R0
    STS R3, ES, R2

    ; ---- install the slice packs -------------------------------------
    ; Tile pack at 0x1000: magic, count, then index + 32 words per tile.
    LDI 0x1000
    MOV R8, R0
    LDS R4, DS, R8
    LDI 0x0A57
    MOV R5, R0
    CMP R4, R5
    JNZ fr_tiles_done
    NOP
    ADD R8, 1
    LDS R5, DS, R8
    AND R5, R5
    JZ fr_tiles_done
    NOP
    ADD R8, 1
    LDI 0x7980
    SL R0, 1
    MVS ES, R0                 ; 0xF300: tile bank
fr_tiles_loop:
    LDS R2, DS, R8
    ADD R8, 1
    MOV R3, R2
    SL R3, 5                   ; index * 32 words
    LSI R6, 0
fr_tile_words:
    LDS R1, DS, R8
    STS R1, ES, R3
    ADD R8, 1
    ADD R3, 1
    ADD R6, 1
    LDI 32
    MOV R4, R0
    CMP R6, R4
    JNC fr_tile_done
    NOP
    LDI fr_tile_words
    MOV PC, R0
    NOP
fr_tile_done:
    SUB R5, 1
    AND R5, R5
    JZ fr_tiles_done
    NOP
    LDI fr_tiles_loop
    MOV PC, R0
    NOP
fr_tiles_done:

    ; Sprite pack at 0x2000: magic, count, then group + 256 words per frame.
    LDI 0x2000
    MOV R8, R0
    LDS R4, DS, R8
    LDI 0x0A58
    MOV R5, R0
    CMP R4, R5
    JNZ fr_sprites_done
    NOP
    ADD R8, 1
    LDS R5, DS, R8
    AND R5, R5
    JZ fr_sprites_done
    NOP
    ADD R8, 1
    LDI 0x7400                 ; 0xF400: sprite bank (bit 14 sign-extends)
    MVS ES, R0
fr_sprites_loop:
    LDS R2, DS, R8
    ADD R8, 1
    MOV R3, R2
    SL R3, 8                   ; group * 256 words
    LSI R6, 0
fr_sprite_words:
    LDS R1, DS, R8
    STS R1, ES, R3
    ADD R8, 1
    ADD R3, 1
    ADD R6, 1
    LDI 256
    MOV R4, R0
    CMP R6, R4
    JNC fr_sprite_done
    NOP
    LDI fr_sprite_words
    MOV PC, R0
    NOP
fr_sprite_done:
    SUB R5, 1
    AND R5, R5
    JZ fr_sprites_done
    NOP
    LDI fr_sprites_loop
    MOV PC, R0
    NOP
fr_sprites_done:

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

    ; palette set 2, art bank: the 16 entries of fr_pal
    LDI 0x110
    MOV R2, R0
    LDI fr_pal
    MOV R8, R0
    LSI R6, 0
fr_pal_loop:
    LDS R3, DS, R8
    STS R3, ES, R2
    ADD R2, 1
    ADD R8, 1
    ADD R6, 1
    LDI 16
    MOV R4, R0
    CMP R6, R4
    JNC fr_pal_done
    NOP
    LDI fr_pal_loop
    MOV PC, R0
    NOP
fr_pal_done:

    ; the same 16 entries in the sprite bank, so sprite index 0 is transparent
    LDI 0x120
    MOV R2, R0
    LDI fr_pal
    MOV R8, R0
    LSI R6, 0
fr_pal2_loop:
    LDS R3, DS, R8
    STS R3, ES, R2
    ADD R2, 1
    ADD R8, 1
    ADD R6, 1
    LDI 16
    MOV R4, R0
    CMP R6, R4
    JNC fr_pal2_done
    NOP
    LDI fr_pal2_loop
    MOV PC, R0
    NOP
fr_pal2_done:

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

    ; the stored phase is in quarter pixels; the register takes whole pixels
    MOV R7, R5
    SR R7, 2

    ; control 6 for the base row
    LDI 0x100
    MOV R2, R0
    MOV R3, R8
    SL R3, 3
    ADD R2, R3
    ADD R2, R7
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
    ADD R2, R7
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
    ; count the current sound effect down once per frame
    LDI 10
    SWI
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

    ; Repaint the HUD fields that changed into the new back copy.
    LDI fr_hud_paint
    MOV R4, R0
    LINK
    JMP R4
    NOP

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

    ; The clock runs only while playing: one cell every 64 frames.
    LDI FR_STATE
    MOV R2, R0
    LDS R3, DS, R2
    LDI ST_PLAY
    MOV R4, R0
    CMP R3, R4
    JNZ fr_tick_done
    NOP
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
    LDI fr_die
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI 23
    MOV R5, R0
fr_tick_time:
    ST R5, R2, 0
    ; The last few time cells get an audible warning tick.
    LDI 6
    MOV R3, R0
    CMP R5, R3
    JNC fr_tick_no_warn
    NOP
    LDI SFX_TICK
    MOV R1, R0
    LSI R2, 1
    LDI 9
    SWI
fr_tick_no_warn:
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
    JNC fr_frog_tick
    NOP
    LDI fr_lane_tick
    MOV PC, R0
    NOP

fr_frog_tick:
    ; ride whatever is under the frog, then place its sprite
    LDI fr_frog_update
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_frog_draw
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_homes_draw
    MOV R4, R0
    LINK
    JMP R4
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
    ; left: phase += speed, wrapping at 32 quarter pixels
    ADD R4, R5
    LDI 32
    MOV R3, R0
    CMP R4, R3
    JC fr_up_store
    NOP
    SUB R4, R3
    ADD R9, 1
    LDI 31
    MOV R2, R0
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
    LDI 32
    MOV R3, R0
    ADD R4, R3
    SUB R9, 1
    LDI 31
    MOV R2, R0
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

    ; control 6 = 0x100 | row << 3 | phase>>1, for both rows of the lane
    MOV R7, R4
    SR R7, 2
    LDI 0x100
    MOV R2, R0
    MOV R3, R8
    SL R3, 3
    ADD R2, R3
    ADD R2, R7
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
    ADD R2, R7
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
; Paint both tile rows of lane R6 into the current write bank.  Preserves R6;
; clobbers R0-R5,R7-R12,R13,R14.
; ---------------------------------------------------------------------
fr_paint_lane:
    MOV R13, LR
    MOV R11, R6
    LDI fr_rows
    MOV R2, R0
    ADD R2, R6
    LDS R8, DS, R2
    LSI R7, 0                  ; first tile row
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
    LSI R7, 1                  ; second tile row
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
; Paint one tile row of lane R11.  R7 = 0 for the top tile row, 1 for the
; bottom; R8 = map row.  Writes columns 24..81 (the playfield and its two
; margin cells).  Clobbers R0-R5,R7,R9,R10,R12.
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

    ; coarse start of the lane
    LDI FR_START
    MOV R2, R0
    ADD R2, R11
    LDS R9, DS, R2

    ; background tile: fr_bgs[lane * 2 + tile row]
    LDI fr_bgs
    MOV R2, R0
    MOV R4, R11
    SL R4, 1
    ADD R2, R4
    ADD R2, R7
    LDS R6, DS, R2

    ; object base, moved down one object row for the bottom tile row
    LDI fr_objs
    MOV R2, R0
    ADD R2, R11
    LDS R8, DS, R2
    AND R7, R7
    JZ fr_p_row0
    NOP
    LDI fr_cols
    MOV R2, R0
    ADD R2, R11
    LDS R2, DS, R2
    SL R2, 5                   ; object columns * 32 words
    ADD R8, R2
fr_p_row0:

    LDI fr_runs
    MOV R2, R0
    ADD R2, R11
    LDS R5, DS, R2             ; run length in cells
    LDI fr_pmask
    MOV R2, R0
    ADD R2, R11
    LDS R1, DS, R2             ; pattern period mask
    LDI fr_parm
    MOV R2, R0
    ADD R2, R11
    LDS R7, DS, R2             ; slice mask

    LDI fr_kind
    MOV R2, R0
    ADD R2, R11
    LDS R2, DS, R2
    AND R2, R2
    JNZ fr_p_log
    NOP

    ; ---- objects that repeat one slice per cell (cars, turtle groups) ----
    LSI R10, 0
fr_ps_cell:
    MOV R4, R10
    ADD R4, R9
    AND R4, R1                 ; cell in the lane pattern
    CMP R4, R5
    JNC fr_ps_bg               ; past the run: background
    NOP
    AND R4, R7                 ; slice inside the object
    MOV R2, R4
    SL R2, 5
    ADD R2, R8
    LDI fr_ps_store
    MOV PC, R0
    NOP
fr_ps_bg:
    MOV R2, R6
fr_ps_store:
    STS R2, ES, R3
    ADD R3, 1
    ADD R10, 1
    LDI 58
    MOV R2, R0
    CMP R10, R2
    JNC fr_p_done
    NOP
    LDI fr_ps_cell
    MOV PC, R0
    NOP

    ; ---- logs: two-cell caps, a repeating middle, mirrored right cap ----
fr_p_log:
    LSI R10, 0
fr_pl_cell:
    MOV R4, R10
    ADD R4, R9
    AND R4, R1                 ; cell in the lane pattern
    CMP R4, R5
    JNC fr_pl_bg               ; past the run: background
    NOP
    LSI R2, 2
    CMP R4, R2
    JC fr_pl_cap_l
    NOP
    MOV R2, R5
    SUB R2, 2
    CMP R4, R2
    JNC fr_pl_cap_r
    NOP
    LSI R2, 2                  ; middle tile
    LDI fr_pl_emit
    MOV PC, R0
    NOP
fr_pl_cap_l:
    MOV R2, R4
    LDI fr_pl_emit
    MOV PC, R0
    NOP
fr_pl_cap_r:
    MOV R2, R4
    SUB R2, R5
    ADD R2, 5                  ; 3 + (i - (run - 2))
    LDI fr_pl_emit
    MOV PC, R0
    NOP
fr_pl_emit:
    SL R2, 5
    ADD R2, R8
    LDI fr_pl_store
    MOV PC, R0
    NOP
fr_pl_bg:
    MOV R2, R6
fr_pl_store:
    STS R2, ES, R3
    ADD R3, 1
    ADD R10, 1
    LDI 58
    MOV R2, R0
    CMP R10, R2
    JNC fr_p_done
    NOP
    LDI fr_pl_cell
    MOV PC, R0
    NOP
fr_p_done:
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Paint the middle-strip time bar into the current write bank.
; Rows 12-13, columns 57-79: yellow cells for FR_TIME, panel for the rest.
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
    ; the bar fills the panel's middle rows, columns 0..22
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
    LDI T_BAR
    MOV R2, R0
fr_bar_store:
    STS R2, ES, R3
    ADD R3, 1
    ADD R10, 1
    LDI 23
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
; Fill one row: grass playfield columns 0..56 (column 56 is the guard the
; fine phase reads) and panel columns 57..81.
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

    ; Home row: hedge across the top bank with five open bays.
    LDI fr_paint_homes
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; Static HUD in the right panel's top and bottom rows.
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
; Paint the home row into the current write bank: a hedge across the top
; bank with five open bays (six cells wide, two rows, at columns 33, 41,
; ...) showing water and a lily pad.  Clobbers R0-R6,R9,R10,R13.
; ---------------------------------------------------------------------
fr_paint_homes:
    MOV R13, LR
    LSI R9, 0                  ; tile row 0, then 1
fr_ph_row:
    LDI 82
    MOV R2, R0
    MOV R3, R9
    MUL R3, R2
    LDI 24
    MOV R2, R0
    ADD R3, R2                 ; playfield starts at column 24
    LDI SEG_TILE
    MVS ES, R0
    LSI R10, 0                 ; playfield column
fr_ph_col:
    LDI T_HEDGE
    MOV R6, R0
    LDI 9
    MOV R4, R0
    CMP R10, R4
    JC fr_ph_store             ; left of the first bay
    NOP
    MOV R2, R10
    SUB R2, R4                 ; q = column - 9
    LDI 40
    MOV R5, R0
    CMP R2, R5
    JNC fr_ph_store            ; past the last bay
    NOP
    LDI 7
    MOV R5, R0
    AND R2, R5                 ; cell inside the eight-cell pitch
    LDI 6
    MOV R5, R0
    CMP R2, R5
    JNC fr_ph_store            ; the two-cell gap between bays
    NOP
    ; bay tile = 26 + row * 6 + cell
    MOV R5, R9
    LDI 6
    MOV R4, R0
    MUL R5, R4
    ADD R5, R2
    LDI 26
    MOV R4, R0
    ADD R5, R4
    MOV R6, R5
    SL R6, 5
fr_ph_store:
    STS R6, ES, R3
    ADD R3, 1
    ADD R10, 1
    LDI 56
    MOV R4, R0
    CMP R10, R4
    JNC fr_ph_col_done
    NOP
    LDI fr_ph_col
    MOV PC, R0
    NOP
fr_ph_col_done:
    ADD R9, 1
    LDI 2
    MOV R4, R0
    CMP R9, R4
    JNC fr_ph_done
    NOP
    LDI fr_ph_row
    MOV PC, R0
    NOP
fr_ph_done:
    MOV LR, R13
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
; Live HUD: only the fields whose FR_HUD bits are set are repainted, and
; the same fields again next frame so both tilemap banks carry the text.
; =====================================================================
fr_hud_paint:
    MOV R6, LR
    LDI FR_HUD
    MOV R2, R0
    LDS R7, DS, R2
    LDI FR_HUD2
    MOV R2, R0
    LDS R4, DS, R2
    OR R7, R4
    AND R7, R7
    JZ fr_h_done
    NOP
    ; this frame's new changes repeat once, into the other bank
    LDI FR_HUD
    MOV R2, R0
    LDS R4, DS, R2
    LDI FR_HUD2
    MOV R2, R0
    ST R4, R2, 0
    LDI FR_HUD
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0

    MOV R3, R7
    LDI HUD_SCORE
    MOV R4, R0
    AND R3, R4
    JZ fr_h_no_score
    NOP
    LSI R9, 0
    LSI R10, 2
    LDI str_score_lbl
    MOV R8, R0
    LDI fr_text
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI FR_SCORE
    MOV R2, R0
    LDS R5, DS, R2
    LSI R9, 0
    LSI R10, 8
    LDI fr_num
    MOV R4, R0
    LINK
    JMP R4
    NOP
fr_h_no_score:
    MOV R3, R7
    LDI HUD_HI
    MOV R4, R0
    AND R3, R4
    JZ fr_h_no_hi
    NOP
    LSI R9, 1
    LSI R10, 2
    LDI str_hi_lbl
    MOV R8, R0
    LDI fr_text
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI FR_HI
    MOV R2, R0
    LDS R5, DS, R2
    LSI R9, 1
    LSI R10, 5
    LDI fr_num
    MOV R4, R0
    LINK
    JMP R4
    NOP
fr_h_no_hi:
    MOV R3, R7
    LDI HUD_LIVES
    MOV R4, R0
    AND R3, R4
    JZ fr_h_no_lives
    NOP
    LDI 23
    MOV R9, R0
    LSI R10, 2
    LDI str_lives_lbl
    MOV R8, R0
    LDI fr_text
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI FR_LIVES
    MOV R2, R0
    LDS R5, DS, R2
    LDI 23
    MOV R9, R0
    LSI R10, 8
    LDI fr_digit1
    MOV R4, R0
    LINK
    JMP R4
    NOP
fr_h_no_lives:
    MOV R3, R7
    LDI HUD_MSG
    MOV R4, R0
    AND R3, R4
    JZ fr_h_done
    NOP
    LDI fr_msg_paint
    MOV R4, R0
    LINK
    JMP R4
    NOP
fr_h_done:
    MOV LR, R6
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Five decimal digits.  R5 = value, R9 = row, R10 = column.  Clobbers
; R1-R5,R11-R13; preserves R6-R10.
; ---------------------------------------------------------------------
fr_num:
    MOV R13, LR
    LDI 82
    MOV R2, R0
    MOV R3, R9
    MUL R3, R2
    ADD R3, R10
    MOV R2, R3                 ; destination
    LDI SEG_TILE
    MVS ES, R0
    LDI fr_places
    MOV R11, R0
    LSI R12, 0
fr_n_loop:
    LDS R1, DS, R11            ; place value
    LSI R3, 0
fr_n_sub:
    CMP R5, R1
    JC fr_n_emit
    NOP
    SUB R5, R1
    ADD R3, 1
    LDI fr_n_sub
    MOV PC, R0
    NOP
fr_n_emit:
    LDI 0x10                   ; glyph for '0' + digit
    MOV R4, R0
    ADD R3, R4
    SL R3, 5
    LDI 0x2000                 ; the text-cell bit, 0x8000
    MOV R4, R0
    SL R4, 2
    OR R3, R4
    STS R3, ES, R2
    ADD R2, 1
    ADD R11, 1
    ADD R12, 1
    LDI 5
    MOV R4, R0
    CMP R12, R4
    JNC fr_n_done
    NOP
    LDI fr_n_loop
    MOV PC, R0
    NOP
fr_n_done:
    MOV LR, R13
    JMP LR
    NOP

; ---------------------------------------------------------------------
; One decimal digit.  R5 = value, R9 = row, R10 = column.
; ---------------------------------------------------------------------
fr_digit1:
    MOV R13, LR
    LDI 82
    MOV R2, R0
    MOV R3, R9
    MUL R3, R2
    ADD R3, R10
    LDI SEG_TILE
    MVS ES, R0
    LDI 0x10
    MOV R4, R0
    ADD R5, R4
    SL R5, 5
    LDI 0x2000
    MOV R4, R0
    SL R4, 2
    OR R5, R4
    STS R5, ES, R3
    MOV LR, R13
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Clear the prompt row and paint the current message (row 10).
; ---------------------------------------------------------------------
fr_msg_paint:
    MOV R12, LR
    LDI 82
    MOV R2, R0
    LDI 10
    MOV R3, R0
    MUL R3, R2
    LDI SEG_TILE
    MVS ES, R0
    LSI R4, 0
    LSI R5, 0
fr_m_clear:
    STS R5, ES, R3
    ADD R3, 1
    ADD R4, 1
    LDI 24
    MOV R2, R0
    CMP R4, R2
    JNC fr_m_paint
    NOP
    LDI fr_m_clear
    MOV PC, R0
    NOP
fr_m_paint:
    LDI FR_MSG
    MOV R2, R0
    LDS R3, DS, R2
    AND R3, R3
    JZ fr_m_done
    NOP
    LDI MSG_PRESS
    MOV R4, R0
    CMP R3, R4
    JNZ fr_m_over
    NOP
    LSI R9, 10
    LSI R10, 6
    LDI str_press
    MOV R8, R0
    LDI fr_text
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_m_done
    MOV PC, R0
    NOP
fr_m_over:
    LSI R9, 10
    LSI R10, 7
    LDI str_over
    MOV R8, R0
    LDI fr_text
    MOV R4, R0
    LINK
    JMP R4
    NOP
fr_m_done:
    MOV LR, R12
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
    MOV R12, LR
    LDI SEG_UART
    MVS ES, R0
    LDI 0x20
    MOV R2, R0
    LDS R1, ES, R2
    LSI R3, 1
    AND R1, R3
    JZ fr_k_done
    NOP
    LDI 0x22
    MOV R2, R0
    LDS R1, ES, R2
    LDI 0x71
    MOV R3, R0
    CMP R1, R3
    JZ fr_k_exit
    NOP
    LDI 0x51
    MOV R3, R0
    CMP R1, R3
    JZ fr_k_exit
    NOP
    ; Space starts the game from attract, or a new one after GAME OVER.
    LDI 0x20
    MOV R3, R0
    CMP R1, R3
    JZ fr_k_space
    NOP
    ; The direction keys only steer a live game.
    LDI FR_STATE
    MOV R2, R0
    LDS R3, DS, R2
    LDI ST_PLAY
    MOV R4, R0
    CMP R3, R4
    JNZ fr_k_done
    NOP

    ; ---- hop keys: arrows and WASD --------------------------------
    LDI 0x77                  ; w
    MOV R3, R0
    CMP R1, R3
    JZ fr_k_up
    NOP
    LDI 0x10                  ; up arrow
    MOV R3, R0
    CMP R1, R3
    JZ fr_k_up
    NOP
    LDI 0x73                  ; s
    MOV R3, R0
    CMP R1, R3
    JZ fr_k_down
    NOP
    LDI 0x0E                  ; down arrow
    MOV R3, R0
    CMP R1, R3
    JZ fr_k_down
    NOP
    LDI 0x61                  ; a
    MOV R3, R0
    CMP R1, R3
    JZ fr_k_left
    NOP
    LDI 0x02                  ; left arrow
    MOV R3, R0
    CMP R1, R3
    JZ fr_k_left
    NOP
    LDI 0x64                  ; d
    MOV R3, R0
    CMP R1, R3
    JZ fr_k_right
    NOP
    LDI 0x06                  ; right arrow
    MOV R3, R0
    CMP R1, R3
    JZ fr_k_right
    NOP
    LDI fr_k_done
    MOV PC, R0
    NOP

fr_k_up:
    LDI FR_HOP
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JNZ fr_k_done
    NOP
    LDI FR_LANE
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ fr_k_done
    NOP
    SUB R3, 1
    ST R3, R2, 0
    ; face up before the hop
    LDI FR_DIR
    MOV R2, R0
    LDI DIR_UP
    MOV R3, R0
    ST R3, R2, 0
    ; a forward hop is worth ten points
    LDI 10
    MOV R5, R0
    LDI fr_score_add
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_k_hop
    MOV PC, R0
    NOP

fr_k_down:
    LDI FR_HOP
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JNZ fr_k_done
    NOP
    LDI FR_LANE
    MOV R2, R0
    LD R3, R2, 0
    LDI 11
    MOV R4, R0
    CMP R3, R4
    JNC fr_k_done
    NOP
    ADD R3, 1
    ST R3, R2, 0
    LDI FR_DIR
    MOV R2, R0
    LDI DIR_DOWN
    MOV R3, R0
    ST R3, R2, 0
    LDI fr_k_hop
    MOV PC, R0
    NOP

fr_k_left:
    LDI FR_HOP
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JNZ fr_k_done
    NOP
    LDI FR_FXQ
    MOV R2, R0
    LD R3, R2, 0
    LDI 896
    MOV R4, R0
    CMP R3, R4
    JC fr_k_done
    NOP
    LDI 128
    MOV R4, R0
    SUB R3, R4
    ST R3, R2, 0
    LDI FR_DIR
    MOV R2, R0
    LDI DIR_LEFT
    MOV R3, R0
    ST R3, R2, 0
    LDI fr_k_hop
    MOV PC, R0
    NOP

fr_k_right:
    LDI FR_HOP
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JNZ fr_k_done
    NOP
    LDI FR_FXQ
    MOV R2, R0
    LD R3, R2, 0
    LDI 2312
    MOV R4, R0
    CMP R4, R3
    JC fr_k_done
    NOP
    LDI 128
    MOV R4, R0
    ADD R3, R4
    ST R3, R2, 0
    LDI FR_DIR
    MOV R2, R0
    LDI DIR_RIGHT
    MOV R3, R0
    ST R3, R2, 0
    LDI fr_k_hop
    MOV PC, R0
    NOP

fr_k_hop:
    LDI FR_HOP
    MOV R2, R0
    LSI R3, 5
    ST R3, R2, 0
    LDI fr_k_done
    MOV PC, R0
    NOP
fr_k_space:
    LDI FR_STATE
    MOV R2, R0
    LDS R3, DS, R2
    AND R3, R3
    JZ fr_k_start
    NOP
    LDI ST_OVER
    MOV R4, R0
    CMP R3, R4
    JZ fr_k_start
    NOP
    LDI fr_k_done
    MOV PC, R0
    NOP
fr_k_start:
    LDI fr_start_game
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_k_done
    MOV PC, R0
    NOP
fr_k_exit:
    LDI fr_exit
    MOV PC, R0
    NOP
fr_k_done:
    MOV LR, R12
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Frog sprite: slot 0, group 0 idle or 1 hopping, at (x, lane * 30 + 1).
; Clobbers R2-R7.
; ---------------------------------------------------------------------
fr_frog_draw:
    LDI FR_STATE
    MOV R2, R0
    LDS R6, DS, R2
    LDI ST_OVER
    MOV R4, R0
    CMP R6, R4
    JZ fr_fd_off
    NOP
    LDI FR_FXQ
    MOV R2, R0
    LD R3, R2, 0
    SR R3, 2                   ; x pixels
    LDI FR_LANE
    MOV R2, R0
    LD R5, R2, 0
    LDI 30
    MOV R4, R0
    MUL R5, R4                 ; lane * 30
    ADD R5, 1
    ; facing: right/left use the side art (group +1), left also flips H,
    ; down flips V on the upright art.
    LDI FR_DIR
    MOV R2, R0
    LDS R6, DS, R2
    LSI R7, 0                  ; flip flags
    LDI DIR_DOWN
    MOV R4, R0
    CMP R6, R4
    JNZ fr_fd_not_down
    NOP
    LDI 0x1000                 ; V flip (bit 14; LDI would sign-extend)
    MOV R7, R0
    SL R7, 2
fr_fd_not_down:
    LDI DIR_LEFT
    MOV R4, R0
    CMP R6, R4
    JNZ fr_fd_not_left
    NOP
    LDI 0x2000                 ; H flip
    MOV R7, R0
fr_fd_not_left:
    MOV R8, R6
    LSI R4, 1
    AND R8, R4                 ; side art when the direction is odd
    LDI FR_DEAD
    MOV R2, R0
    LD R6, R2, 0
    AND R6, R6
    JZ fr_fd_not_dead
    NOP
    LSI R6, 4                  ; squash frame
    LSI R7, 0                  ; the squash has no facing
    LDI fr_fd_group
    MOV PC, R0
    NOP
fr_fd_not_dead:
    LDI FR_HOP
    MOV R2, R0
    LD R6, R2, 0
    AND R6, R6
    JZ fr_fd_idle
    NOP
    LSI R6, 2                  ; hop
    LDI fr_fd_side
    MOV PC, R0
    NOP
fr_fd_idle:
    LSI R6, 0
fr_fd_side:
    ADD R6, R8
fr_fd_group:
    SL R6, 11
    OR R5, R6                  ; w1 = group << 11 | y
    LDI 0x800
    MOV R4, R0
    OR R4, R7                  ; flip flags
    OR R4, R3                  ; enable | x
    LDI SEG_OAM
    MVS ES, R0
    LSI R2, 0
    STS R4, ES, R2
    LSI R2, 1
    STS R5, ES, R2
    JMP LR
    NOP
fr_fd_off:
    LDI SEG_OAM
    MVS ES, R0
    LSI R2, 0
    LSI R3, 0
    STS R3, ES, R2
    LSI R2, 1
    STS R3, ES, R2
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Draw the five home frogs from FR_HOMES into OAM slots 1..5.  A filled bay
; shows the home frog in the middle of its opening.  Clobbers R2-R7.
; ---------------------------------------------------------------------
fr_homes_draw:
    LDI FR_HOMES
    MOV R2, R0
    LDS R4, DS, R2             ; filled bays
    LDI SEG_OAM
    MVS ES, R0
    LSI R5, 1                  ; OAM slot 1..5
fr_hd_loop:
    MOV R2, R5
    SL R2, 1                   ; descriptor words
    MOV R3, R5
    SUB R3, 1
    LDI fr_homebits
    MOV R6, R0
    ADD R6, R3
    LDS R6, DS, R6
    AND R6, R4
    JZ fr_hd_off
    NOP
    ; x = 272 + 64 * bay, the middle of the opening
    LDI 64
    MOV R7, R0
    MUL R3, R7
    LDI 272
    MOV R7, R0
    ADD R3, R7
    LDI 0x800
    MOV R7, R0
    OR R3, R7
    LDI 0x2801                 ; home frog group, y 1
    MOV R7, R0
    LDI fr_hd_on
    MOV PC, R0
    NOP
fr_hd_off:
    LSI R3, 0
    LSI R7, 0
fr_hd_on:
    STS R3, ES, R2
    ADD R2, 1
    STS R7, ES, R2
    ADD R5, 1
    LDI 6
    MOV R3, R0
    CMP R5, R3
    JNC fr_hd_done
    NOP
    LDI fr_hd_loop
    MOV PC, R0
    NOP
fr_hd_done:
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Frog logic for one frame: the level pause, the death countdown, then the
; home, splash and squash checks and the ride.  Clobbers R2-R7,R13.
; ---------------------------------------------------------------------
fr_frog_update:
    MOV R13, LR
    LDI FR_STATE
    MOV R2, R0
    LDS R3, DS, R2
    LDI ST_LEVEL
    MOV R4, R0
    CMP R3, R4
    JZ fr_fu_level_wait
    NOP
    LDI ST_DYING
    MOV R4, R0
    CMP R3, R4
    JZ fr_fu_death_wait
    NOP
    LDI ST_PLAY
    MOV R4, R0
    CMP R3, R4
    JZ fr_fu_play
    NOP
    ; attract or game over: the board runs, the frog does not
    LDI fr_fu_done
    MOV PC, R0
    NOP

; A completed level holds the board still for two seconds.
fr_fu_level_wait:
    LDI FR_PAUSE
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ fr_fu_done
    NOP
    SUB R3, 1
    ST R3, R2, 0
    AND R3, R3
    JNZ fr_fu_done
    NOP
    LDI fr_next_level
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_fu_done
    MOV PC, R0
    NOP

; The squash plays out; then a new life or GAME OVER.
fr_fu_death_wait:
    LDI FR_DEAD
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ fr_fu_done
    NOP
    SUB R3, 1
    ST R3, R2, 0
    AND R3, R3
    JNZ fr_fu_done
    NOP
    LDI FR_LIVES
    MOV R2, R0
    LDS R3, DS, R2
    AND R3, R3
    JZ fr_fu_over
    NOP
    LDI fr_respawn
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_fu_done
    MOV PC, R0
    NOP
fr_fu_over:
    LDI fr_game_over
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_fu_done
    MOV PC, R0
    NOP

fr_fu_play:
    LDI FR_HOP
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ fr_fu_nohop
    NOP
    SUB R3, 1
    ST R3, R2, 0
fr_fu_nohop:

    LDI FR_LANE
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JZ fr_fu_home              ; top bank: a home bay or the hedge
    NOP
    LDI 11
    MOV R4, R0
    CMP R3, R4
    JZ fr_fu_done              ; bottom bank
    NOP
    LDI 6
    MOV R4, R0
    CMP R3, R4
    JZ fr_fu_done              ; median
    NOP

    LDI 5
    MOV R4, R0
    CMP R4, R3
    JC fr_fu_road              ; lanes 7..10
    NOP

    ; ---- river: splash without a log or turtle, else ride ----
    SUB R3, 1
    LDI fr_cell_i
    MOV R4, R0
    LINK
    JMP R4
    NOP
    CMP R5, R6
    JC fr_fu_ride              ; i < run: on an object
    NOP
    LDI fr_die
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_fu_done
    MOV PC, R0
    NOP

fr_fu_ride:
    LDI fr_speeds
    MOV R2, R0
    ADD R2, R3
    LDS R6, DS, R2
    LDI fr_dirs
    MOV R2, R0
    ADD R2, R3
    LDS R7, DS, R2
    LDI FR_FXQ
    MOV R2, R0
    LD R4, R2, 0
    AND R7, R7
    JZ fr_fu_left
    NOP
    ADD R4, R6
    LDI fr_fu_moved
    MOV PC, R0
    NOP
fr_fu_left:
    SUB R4, R6
fr_fu_moved:
    ST R4, R2, 0
    LDI 768
    MOV R3, R0
    CMP R4, R3
    JC fr_fu_carried
    NOP
    LDI 2440
    MOV R3, R0
    CMP R3, R4
    JC fr_fu_carried
    NOP
    LDI fr_fu_done
    MOV PC, R0
    NOP
fr_fu_carried:
    LDI fr_die
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_fu_done
    MOV PC, R0
    NOP

fr_fu_road:
    ; lanes 7..10: squash when the frog's box overlaps a vehicle
    SUB R3, 2
    LDI fr_touch
    MOV R4, R0
    LINK
    JMP R4
    NOP
    AND R5, R5
    JZ fr_fu_done
    NOP
    LDI fr_die
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_fu_done
    MOV PC, R0
    NOP

fr_fu_home:
    ; A bay is 48 px wide on a 64-px pitch.  The frog's 30-px art has to sit
    ; inside the opening: x in [left - 1, left + 17].
    LDI FR_FXQ
    MOV R2, R0
    LD R3, R2, 0
    LDI 1052                   ; first bay's left edge - 1, screen quarter px
    MOV R4, R0
    CMP R3, R4
    JC fr_fu_hedge
    NOP
    SUB R3, R4                 ; x - first edge
    MOV R5, R3
    LDI 255
    MOV R4, R0
    AND R3, R4                 ; position inside a 64-px pitch
    LDI 72                     ; 19 px of landing room
    MOV R4, R0
    CMP R4, R3
    JC fr_fu_hedge             ; too far right for the bay
    NOP
    SR R5, 8                   ; bay 0..4
    LDI 4
    MOV R4, R0
    CMP R4, R5
    JC fr_fu_hedge             ; past the last bay
    NOP
    LDI fr_homebits
    MOV R2, R0
    ADD R2, R5
    LDS R6, DS, R2             ; this bay's bit
    LDI FR_HOMES
    MOV R2, R0
    LDS R7, DS, R2             ; bays already filled
    AND R7, R6
    JNZ fr_fu_hedge            ; landing on a used bay is a death
    NOP
    LDS R7, DS, R2
    OR R7, R6
    ST R7, R2, 0
    ; 50 for the bay and 10 for every time cell still on the bar
    LDI FR_TIME
    MOV R2, R0
    LDS R5, DS, R2
    MOV R6, R5
    SL R6, 3
    SL R5, 1
    ADD R6, R5                 ; time * 10
    LDI 50
    MOV R5, R0
    ADD R5, R6
    LDI fr_score_add
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; all five?
    LDI FR_HOMES
    MOV R2, R0
    LDS R7, DS, R2
    LDI 31
    MOV R4, R0
    CMP R7, R4
    JZ fr_fu_level
    NOP
    LDI fr_respawn
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI fr_fu_done
    MOV PC, R0
    NOP

fr_fu_level:
    ; Fifth bay: hold the board for two seconds, then the next level.
    LDI FR_PAUSE
    MOV R2, R0
    LDI 120
    MOV R3, R0
    ST R3, R2, 0
    LDI fr_respawn
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI FR_STATE
    MOV R2, R0
    LDI ST_LEVEL
    MOV R3, R0
    ST R3, R2, 0
    LDI fr_fu_done
    MOV PC, R0
    NOP

fr_fu_hedge:
    LDI fr_die
    MOV R4, R0
    LINK
    JMP R4
    NOP

fr_fu_done:
    MOV LR, R13
    JMP LR
    NOP

; ---------------------------------------------------------------------
; R3 = lane table index -> R5 = 1 when the frog's collision box overlaps
; an object in that lane, else 0.  The box is the middle 26 px of the
; sprite (its 30-px art with 2 px of grace), so a car touches it about
; when its art reaches the frog's art.  Testing the box's two edge cells
; is enough: every object is 32 px or more, so it cannot fit between
; them.  Clobbers R2,R4-R7,R12; preserves R3.
; ---------------------------------------------------------------------
fr_touch:
    MOV R12, LR
    LSI R6, 0
fr_touch_box:
    LDI fr_boxpts
    MOV R2, R0
    ADD R2, R6
    LDS R4, DS, R2             ; box offset in the 32-px sprite
    LDI FR_FXQ
    MOV R2, R0
    LD R5, R2, 0
    SR R5, 2
    ADD R5, R4                 ; x + offset
    LDI FR_PHASE
    MOV R2, R0
    ADD R2, R3
    LDS R4, DS, R2
    SR R4, 2
    ADD R5, R4                 ; + the lane's fine phase
    LDI 192
    MOV R4, R0
    SUB R5, R4
    SR R5, 3                   ; map cell under this edge
    LDI FR_START
    MOV R2, R0
    ADD R2, R3
    LDS R4, DS, R2
    ADD R5, R4
    LDI fr_pmask
    MOV R2, R0
    ADD R2, R3
    LDS R4, DS, R2
    AND R5, R4                 ; pattern cell
    LDI fr_runs
    MOV R2, R0
    ADD R2, R3
    LDS R4, DS, R2
    CMP R5, R4
    JC fr_touch_hit
    NOP
    ADD R6, 1
    LDI 2
    MOV R4, R0
    CMP R6, R4
    JNC fr_touch_none
    NOP
    LDI fr_touch_box
    MOV PC, R0
    NOP
fr_touch_hit:
    LSI R5, 1
    LDI fr_touch_done
    MOV PC, R0
    NOP
fr_touch_none:
    LSI R5, 0
fr_touch_done:
    MOV LR, R12
    JMP LR
    NOP

; ---------------------------------------------------------------------
; R3 = lane table index -> R5 = pattern cell, R6 = run length.
; Clobbers R2,R4,R5,R6; preserves R3.
; ---------------------------------------------------------------------
fr_cell_i:
    LDI FR_PHASE
    MOV R2, R0
    ADD R2, R3
    LDS R5, DS, R2
    SR R5, 2
    LDI FR_FXQ
    MOV R2, R0
    LD R6, R2, 0
    SR R6, 2
    ADD R6, 15
    ADD R5, R6
    LDI 192
    MOV R4, R0
    SUB R5, R4
    SR R5, 3
    LDI FR_START
    MOV R2, R0
    ADD R2, R3
    LDS R6, DS, R2
    ADD R5, R6
    LDI fr_pmask
    MOV R2, R0
    ADD R2, R3
    LDS R6, DS, R2
    AND R5, R6
    LDI fr_runs
    MOV R2, R0
    ADD R2, R3
    LDS R6, DS, R2
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Start a death: 24 frames of the squash frame and the death sound.
; ---------------------------------------------------------------------
fr_die:
    LDI FR_DEAD
    MOV R2, R0
    LD R3, R2, 0
    AND R3, R3
    JNZ fr_die_out
    NOP
    ; only a live game loses a frog
    LDI FR_STATE
    MOV R2, R0
    LDS R3, DS, R2
    LDI ST_PLAY
    MOV R4, R0
    CMP R3, R4
    JNZ fr_die_out
    NOP
    ; a life goes now; the squash plays before the respawn or GAME OVER
    LDI FR_LIVES
    MOV R2, R0
    LDS R3, DS, R2
    AND R3, R3
    JZ fr_die_no_life
    NOP
    SUB R3, 1
    ST R3, R2, 0
fr_die_no_life:
    LDI FR_HUD
    MOV R2, R0
    LDS R3, DS, R2
    LDI HUD_LIVES
    MOV R4, R0
    OR R3, R4
    ST R3, R2, 0
    LDI FR_STATE
    MOV R2, R0
    LDI ST_DYING
    MOV R3, R0
    ST R3, R2, 0
    LDI SFX_DEATH
    MOV R1, R0
    LSI R2, 1
    LDI 9
    SWI
    LDI 24
    MOV R3, R0
    LDI FR_DEAD
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_HOP
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
fr_die_out:
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Back to the bottom bank with a fresh timer.
; ---------------------------------------------------------------------
fr_respawn:
    LDI FR_STATE
    MOV R2, R0
    LDI ST_PLAY
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_FXQ
    MOV R2, R0
    LDI 1728
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_LANE
    MOV R2, R0
    LDI 11
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_HOP
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI FR_DIR
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI FR_TIME
    MOV R2, R0
    LDI 23
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_TICK
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI FR_BARD
    MOV R2, R0
    LSI R3, 1
    ST R3, R2, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Start the next level: clear the bays, step every lane's speed up by one
; quarter pixel towards its cap, and put the frog back on the bank.
; ---------------------------------------------------------------------
fr_next_level:
    MOV R12, LR
    LDI FR_HOMES
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI FR_LEVEL
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0
    LSI R6, 0
fr_nl_lane:
    LDI fr_speeds
    MOV R2, R0
    ADD R2, R6
    LDS R3, DS, R2
    LDI fr_caps
    MOV R4, R0
    ADD R4, R6
    LDS R5, DS, R4
    CMP R3, R5
    JNC fr_nl_capped            ; speed >= cap
    NOP
    ADD R3, 1
    ST R3, R2, 0
fr_nl_capped:
    ADD R6, 1
    LDI 9
    MOV R3, R0
    CMP R6, R3
    JNC fr_nl_done
    NOP
    LDI fr_nl_lane
    MOV PC, R0
    NOP
fr_nl_done:
    LDI fr_respawn
    MOV R4, R0
    LINK
    JMP R4
    NOP
    MOV LR, R12
    JMP LR
    NOP

; ---------------------------------------------------------------------
; Start (or restart) a game: three lives, no score, base lane speeds and
; the frog on the bank.  Called from the key handler before the write bank
; is chosen, so it only sets state and HUD flags, never paints.
; ---------------------------------------------------------------------
fr_start_game:
    MOV R13, LR
    LDI FR_STATE
    MOV R2, R0
    LDI ST_PLAY
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_LIVES
    MOV R2, R0
    LDI 3
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_SCORE
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI FR_EXTRA
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_LEVEL
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_HOMES
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_DEAD
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_PAUSE
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_MSG
    MOV R2, R0
    ST R3, R2, 0
    LDI FR_DIR
    MOV R2, R0
    ST R3, R2, 0
    ; the whole HUD, including the cleared prompt
    LDI FR_HUD
    MOV R2, R0
    LDI 15
    MOV R3, R0
    ST R3, R2, 0
    ; back to the base lane speeds
    LSI R6, 0
fr_sg_speed:
    LDI fr_base_speeds
    MOV R2, R0
    ADD R2, R6
    LDS R3, DS, R2
    LDI fr_speeds
    MOV R2, R0
    ADD R2, R6
    ST R3, R2, 0
    ADD R6, 1
    LDI 9
    MOV R3, R0
    CMP R6, R3
    JNC fr_sg_done
    NOP
    LDI fr_sg_speed
    MOV PC, R0
    NOP
fr_sg_done:
    LDI fr_respawn
    MOV R4, R0
    LINK
    JMP R4
    NOP
    MOV LR, R13
    JMP LR
    NOP

; ---------------------------------------------------------------------
; R5 = points.  Adds them to the score, tracks the session hi-score,
; awards the 20000-point extra life once and flags the HUD fields.
; Clobbers R2-R7; preserves R12 and R13.
; ---------------------------------------------------------------------
fr_score_add:
    LDI FR_SCORE
    MOV R2, R0
    LDS R3, DS, R2
    ADD R3, R5
    JNC fr_sa_score_ok
    NOP
    LSI R3, 0
    SUB R3, 1                  ; clamp at 65535
fr_sa_score_ok:
    ST R3, R2, 0
    ; hi-score
    LDI FR_HI
    MOV R2, R0
    LDS R4, DS, R2
    CMP R3, R4
    JC fr_sa_no_hi
    NOP
    ST R3, R2, 0
    LDI FR_HUD
    MOV R2, R0
    LDS R4, DS, R2
    LDI HUD_HI
    MOV R5, R0
    OR R4, R5
    ST R4, R2, 0
fr_sa_no_hi:
    LDI FR_HUD
    MOV R2, R0
    LDS R4, DS, R2
    LDI HUD_SCORE
    MOV R5, R0
    OR R4, R5
    ST R4, R2, 0
    ; one extra life at 20000
    LDI FR_EXTRA
    MOV R2, R0
    LDS R4, DS, R2
    AND R4, R4
    JNZ fr_sa_done
    NOP
    LDI 0x2710
    MOV R4, R0
    SL R4, 1                   ; 20000
    CMP R3, R4
    JC fr_sa_done
    NOP
    LDI FR_EXTRA
    MOV R2, R0
    LSI R4, 1
    ST R4, R2, 0
    LDI FR_LIVES
    MOV R2, R0
    LDS R4, DS, R2
    LDI 9
    MOV R5, R0
    CMP R4, R5
    JNC fr_sa_no_life
    NOP
    ADD R4, 1
    ST R4, R2, 0
fr_sa_no_life:
    LDI FR_HUD
    MOV R2, R0
    LDS R4, DS, R2
    LDI HUD_LIVES
    MOV R5, R0
    OR R4, R5
    ST R4, R2, 0
fr_sa_done:
    JMP LR
    NOP

; ---------------------------------------------------------------------
; The last life is gone: show GAME OVER and wait for Space.
; ---------------------------------------------------------------------
fr_game_over:
    LDI FR_STATE
    MOV R2, R0
    LDI ST_OVER
    MOV R3, R0
    ST R3, R2, 0
    LDI FR_MSG
    MOV R2, R0
    LDI MSG_OVER
    MOV R3, R0
    ST R3, R2, 0
    ; the bays clear, and the home frogs go with the mask
    LDI FR_HOMES
    MOV R2, R0
    LSI R3, 0
    ST R3, R2, 0
    LDI FR_HUD
    MOV R2, R0
    LDS R3, DS, R2
    LDI HUD_MSG
    MOV R4, R0
    OR R3, R4
    ST R3, R2, 0
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
fr_bgs:
    .word T_WATER, T_WATER, T_WATER, T_WATER, T_WATER
    .word T_WATER, T_WATER, T_WATER, T_WATER, T_WATER
    .word T_ROAD, T_ROAD, T_ROAD, T_ROAD
    .word T_ROAD, T_ROAD, T_ROAD, T_ROAD
fr_objs:
    .word T_LOG, T_TURTLE, T_LOG, T_LOG, T_TURTLE
    .word T_TRUCK, T_CAR_Y, T_FIRE, T_CAR_B
; Cells on per pattern period and the period's mask (7/15/31).  The long,
; middle and short logs are 24, 18 and 12 cells; a turtle group is 12 cells,
; the truck 8, the fire truck 6 and a car 4.
fr_runs:
    .word 18, 8, 24, 12, 12
    .word 8, 4, 6, 4
fr_pmask:
    .word 31, 15, 31, 15, 15
    .word 31, 15, 15, 15
; 1 = log (caps and a repeating middle), 0 = one slice per cell.
fr_kind:
    .word 1, 0, 1, 1, 0
    .word 0, 0, 0, 0
; Tile columns per object; the second tile row is this many tiles on.
fr_cols:
    .word 5, 4, 5, 5, 4
    .word 8, 4, 6, 4
; Slice mask inside the object (ignored for logs).
fr_parm:
    .word 3, 3, 3, 3, 3
    .word 7, 3, 7, 3
fr_pal:
    .word 0x49, 0x00, 0xFF, 0xFE, 0xD8, 0xE0, 0xCC, 0x60
    .word 0x84, 0xF8, 0x92, 0x10, 0x0C, 0x02, 0x0A, 0x25
fr_dirs:
    .word 1, 0, 1, 1, 0        ; river: logs right, turtles left
    .word 0, 1, 0, 1           ; road top->bottom: left, right, left, right
; Phase is kept in quarter pixels (0..31), so 4 is 1 px/frame.  The river's
; normal log is 4, its slow log 2 and its fast log 6; the turtles are 3.  The
; road climbs from 2 (0.5 px/frame) at the bottom to 6 (1.5) at the top.
fr_speeds:
    .word 4, 3, 6, 2, 3
    .word 4, 4, 3, 2
; A fresh game restores this table.  The road follows the arcade's balance:
; the heavy truck is the slowest lane, not the fastest, and its 64-px run is
; one per 256 px (pmask 31) so the gap is long enough to wait in.
fr_base_speeds:
    .word 4, 3, 6, 2, 3
    .word 4, 4, 3, 2
; One bit per bay, left to right.
fr_homebits:
    .word 1, 2, 4, 8, 16
; Each lane's speed cap (quarter pixels per frame) after the level steps.
fr_caps:
    .word 8, 6, 10, 5, 6
    .word 8, 8, 6, 5
; The frog's collision box inside its 32-px sprite: left edge, right edge.
fr_boxpts:
    .word 3, 28
; Decimal place values for the score and hi-score fields.
fr_places:
    .word 10000, 1000, 100, 10, 1

str_score:
    .text "SCORE 00000"
str_hi:
    .text "HI 00000"
str_lives:
    .text "LIVES 3"
; labels and prompts used by the live HUD
str_score_lbl:
    .text "SCORE "
str_hi_lbl:
    .text "HI "
str_lives_lbl:
    .text "LIVES "
str_press:
    .text "PRESS SPACE"
str_over:
    .text "GAME OVER"

; =====================================================================
; Writable state
; =====================================================================
.org 0xA00
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
    .word 23
fr_tick:
    .word 0
fr_bard:
    .word 0
.org 0xA30
fr_fxq:
    .word 1728                 ; x = 432 px, on the bay lattice
fr_lane:
    .word 11                   ; bottom bank
fr_hop:
    .word 0
fr_dead:
    .word 0
fr_homes:
    .word 0
fr_level:
    .word 0
fr_pause:
    .word 0
fr_state:
    .word 0
fr_lives:
    .word 3
fr_score:
    .word 0
fr_hi:
    .word 0
fr_extra:
    .word 0
fr_hud:
    .word 0
fr_hud2:
    .word 0
fr_msg:
    .word 0
fr_dir:
    .word 0
