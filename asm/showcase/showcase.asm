; showcase.asm - the D16D showcase menu and Flappy game.
;
; Image layout (all offsets in the BIOS segment 0x04A0, physical = 0x4A00+off):
;   0x0330  menu header + trampoline (BIOS gfx entry)
;   0x0339  menu strings, cloud table and the game palette
;   0x0400  colour demo (asm/gfx_demo.asm, separate block)
;   0x04D5  game state cells (uninitialised; the game writes them)
;   0x0500  menu code, then the default palette at 0x05E0
;   0x0A00  game helpers, map drawing, game loop and death sequence
;
; The BIOS parks R5/R6 and jumps to the menu trampoline with R12 = gfx_back.
; The menu saves that return, launches the game/colour demo with R12 pointing
; at menu_after, and finally returns to the BIOS.

.equ SEG_DEMO 0x04A0
.equ SEG_TILE -0x0F00          ; 0xF100: tilemap
.equ SEG_CTRL -0x0E00          ; 0xF200: controls
.equ SEG_BANK -0x0D00          ; 0xF300: tile bank
.equ SEG_SPR  -0x0C00          ; 0xF400: sprite bank
.equ SEG_OAM  -0x0B00          ; 0xF500: OAM + palette
.equ SEG_UART -0x0FFC          ; 0xF004: UART/status

.equ G_START_MODE 0x04D5
.equ G_MODE       0x04D6
.equ G_WORLD      0x04D7
.equ G_ORIGIN     0x04D8
.equ G_FRONT      0x04D9
.equ G_BACK       0x04DA
.equ G_BIRD_Y     0x04DB
.equ G_BIRD_VY    0x04DC
.equ G_SCORE      0x04DD
.equ G_BEST       0x04DE
.equ G_PIPE_X     0x04DF
.equ G_PIPE_GAP   0x04E3
.equ G_PIPE_SCORE 0x04E7
.equ G_NEXT_PIPE  0x04EB
.equ G_LAST_FRAME 0x04EC
.equ G_OVER_TIMER 0x04ED
.equ G_DRAW_ORIGIN 0x04EE
.equ G_TMP        0x04EF
.equ G_TMP2       0x04F0
.equ G_KEY        0x04F1
.equ G_FRAME      0x04F2
.equ G_BTN        0x04F3
.equ G_BTN_HOLD   0x04F4
.equ G_FLAP_TIMER 0x04F6
.equ G_CLOUD_X    0x04F8       ; four cloud world x values
.equ G_BIRD_ANIM  0x04FC       ; sprite-frame counter
.equ G_DEATH      0x04FD       ; 0 alive, 1 dizzy, 2 falling, 3 on ground
.equ G_DEATH_TIMER 0x04FE

; Game-art tiles, baked at 96.. from the free art pack.
.equ T_PIPE_L     0x0C00
.equ T_PIPE_M     0x0C20
.equ T_PIPE_R     0x0C40
.equ T_CAPU_L     0x0C60
.equ T_CAPU_M     0x0C80
.equ T_CAPU_R     0x0CA0
.equ T_CAPD_L     0x0CC0
.equ T_CAPD_M     0x0CE0
.equ T_CAPD_R     0x0D00
.equ T_GRASS      0x0D20
.equ T_DIRT       0x0D40
.equ T_CLOUD_L    0x0D60
.equ T_CLOUD_M    0x0D80
.equ T_CLOUD_R    0x0DA0
.equ RESTORE_TAB  0x0500
.equ RESTORE_PAL  0x05E0
.equ COLOR_ENTRY  0x0404

; ---- header and trampoline (BIOS function 6) -------------------------
.org 0x330
    .word 0x0D16, 1, 0x334, 0
.org 0x334
trampoline:
    LDI SEG_DEMO
    MVS DS, R0
    LDI menu_entry
    MOV PC, R0
    NOP

; ---- strings and palettes (gap 0x339..0x3FF, above the trampoline) ----
.org 0x339
str_menu_title:
    .text "D16 SHOW 27"
str_menu_f:
    .text "F  FLAPPY"
str_menu_c:
    .text "C  COLOUR DEMO"
str_menu_q:
    .text "Q  CONSOLE"
str_menu_auto:
    .text "AUTOPLAY 10s"
str_flappy:
    .text "FLAPPY"
str_press_space:
    .text "PRESS SPACE"
str_flap_quit:
    .text "F/SPACE FLAP  Q QUIT"
str_game_over:
    .text "GAME OVER"
str_score:
    .text "SCORE"
str_space_restart:
    .text "SPACE RESTART"
str_q_quit:
    .text "Q QUIT"
str_auto_short:
    .text "AUTOPLAY"

.org 0x3CC
cloud_init:
    .word 100, 300, 500, 700

; The game's shared palette (16 RGB332 entries). Index 0 is the sky and the
; sprite transparent key, 1 is text/cloud white, 5 is the dizzy flower purple,
; 8 is outline black, 10 the cyan, 11 the dizzy iris / star yellow.
.org 0x3D0
pal_art:
    .word 0x005B, 0x00FF, 0x0084, 0x0070
    .word 0x00D5, 0x008E, 0x004C, 0x00B9
    .word 0x0000, 0x00DF, 0x0017, 0x00F4
    .word 0x0074, 0x00F1, 0x0028, 0x00DA
cloud_rows:
    .word 3, 6, 3, 6

.org 0x5E0
pal_default:
    .word 0x0000, 0x00FF, 0x00E0, 0x001C
    .word 0x0003, 0x00FC, 0x001F, 0x00E3
    .word 0x0092, 0x00B6, 0x006D, 0x00DB
    .word 0x00E9, 0x00D3, 0x00FE, 0x00FF

; =====================================================================
; Menu code: 0x0A00..0x0AFF (the helpers and strings live in the game
; block so both screens can share them).
; =====================================================================
.org 0x0500
menu_entry:
    LDI SEG_DEMO
    MVS DS, R0
    LDI menu_ret
    MOV R2, R0
    ST R12, R2, 0

menu_redraw:
    LDI SEG_DEMO
    MVS DS, R0

    LDI scene_init
    MOV R4, R0
    LINK
    JMP R4
    NOP

    LDI 5
    MOV R9, R0
    LDI 34
    MOV R10, R0
    LDI str_menu_title
    MOV R8, R0
    LDI draw_text
    MOV R4, R0
    LINK
    JMP R4
    NOP

    LDI 10
    MOV R9, R0
    LDI 30
    MOV R10, R0
    LDI str_menu_f
    MOV R8, R0
    LDI draw_text
    MOV R4, R0
    LINK
    JMP R4
    NOP

    LDI 12
    MOV R9, R0
    LDI 30
    MOV R10, R0
    LDI str_menu_c
    MOV R8, R0
    LDI draw_text
    MOV R4, R0
    LINK
    JMP R4
    NOP

    LDI 14
    MOV R9, R0
    LDI 30
    MOV R10, R0
    LDI str_menu_q
    MOV R8, R0
    LDI draw_text
    MOV R4, R0
    LINK
    JMP R4
    NOP

    LDI 19
    MOV R9, R0
    LDI 29
    MOV R10, R0
    LDI str_menu_auto
    MOV R8, R0
    LDI draw_text
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; seed the attract countdown from the current output frame
    LDI SEG_UART
    MVS ES, R0
    LDI 0x26
    MOV R2, R0
    LDS R1, ES, R2
    LDI 2
    MOV R3, R0
    AND R1, R3
    LDI menu_last
    MOV R2, R0
    ST R1, R2, 0
    LDI 0
    MOV R2, R0
    LDI menu_frames
    MOV R3, R0
    ST R2, R3, 0

menu_wait:
    LDI SEG_UART
    MVS ES, R0
    LDI 0
    MOV R2, R0
    LDS R1, ES, R2
    LDI 1
    MOV R3, R0
    AND R1, R3
    JZ menu_no_key
    NOP
    LDI 2
    MOV R2, R0
    LDS R1, ES, R2

    LDI 0x46
    MOV R3, R0
    CMP R1, R3
    JZ menu_play
    NOP
    LDI 0x66
    MOV R3, R0
    CMP R1, R3
    JZ menu_play
    NOP
    LDI 0x43
    MOV R3, R0
    CMP R1, R3
    JZ menu_color
    NOP
    LDI 0x63
    MOV R3, R0
    CMP R1, R3
    JZ menu_color
    NOP
    LDI 0x51
    MOV R3, R0
    CMP R1, R3
    JZ menu_quit
    NOP
    LDI 0x71
    MOV R3, R0
    CMP R1, R3
    JZ menu_quit
    NOP
    LDI 0x1B
    MOV R3, R0
    CMP R1, R3
    JZ menu_quit
    NOP
    LDI menu_wait
    MOV PC, R0
    NOP

menu_no_key:
    LDI 0x26
    MOV R2, R0
    LDS R1, ES, R2
    LDI 2
    MOV R3, R0
    AND R1, R3
    LDI menu_last
    MOV R4, R0
    LD R5, R4, 0
    CMP R1, R5
    JZ menu_wait
    NOP
    ST R1, R4, 0
    LDI menu_frames
    MOV R4, R0
    LD R5, R4, 0
    ADD R5, 1
    ST R5, R4, 0
    LDI 600
    MOV R3, R0
    CMP R5, R3
    JC menu_wait
    NOP
    LDI menu_attract
    MOV PC, R0
    NOP

menu_play:
    LDI 0
    MOV R2, R0
    LDI G_START_MODE
    MOV R3, R0
    ST R2, R3, 0
    LDI menu_launch_game
    MOV PC, R0
    NOP

menu_attract:
    LDI 1
    MOV R2, R0
    LDI G_START_MODE
    MOV R3, R0
    ST R2, R3, 0
    LDI menu_launch_game
    MOV PC, R0
    NOP

menu_launch_game:
    LDI SEG_DEMO
    MVS DS, R0
    LDI menu_after
    MOV R12, R0
    LDI game_entry
    MOV PC, R0
    NOP

menu_color:
    LDI SEG_DEMO
    MVS DS, R0
    LDI menu_after
    MOV R12, R0
    LDI COLOR_ENTRY
    MOV PC, R0
    NOP

menu_after:
    LDI SEG_DEMO
    MVS DS, R0
    LDI menu_redraw
    MOV PC, R0
    NOP

menu_quit:
    LDI menu_ret
    MOV R2, R0
    LD R12, R2, 0
    MOV PC, R12
    NOP

menu_ret:
    .word 0
menu_frames:
    .word 0
menu_last:
    .word 0

; =====================================================================
; Shared screen helpers and the game: 0x0B00..0x0DFF
; =====================================================================
