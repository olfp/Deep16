; flappy_defs.asm - constants and data for the standalone Flappy slice.
;
; Flappy is loaded into its own segment by BDOS, so it cannot share the
; menu's segment. The game reads its own segment from CS, and the data tables
; it used to borrow from showcase.asm live here. The offsets are the ones the
; game code expects (they are segment-relative, so they move with it).
.equ SEG_TILE -0x0F00          ; 0xF100: tilemap
.equ SEG_CTRL -0x0E00          ; 0xF200: controls
.equ SEG_BANK -0x0D00          ; 0xF300: tile bank
.equ SEG_SPR  -0x0C00          ; 0xF400: sprite bank
.equ SEG_OAM  -0x0A00          ; 0xF600: OAM + palette
.equ SEG_UART -0x0FFC          ; 0xF004: UART/status

.equ G_START_MODE 0x04D5
.equ G_MODE       0x04D6
.equ G_WORLD      0x04D7
.equ G_ORIGIN     0x04D8
.equ G_FRONT      0x04D9
.equ G_BACK       0x04DA
.equ G_BIRD_Y     0x04DB
.equ G_BIRD_VY    0x04DC
.equ G_PLAYS      0x04DD
.equ G_BEST       0x04DE
.equ G_PIPE_X     0x04DF
.equ G_PIPE_GAP   0x04E3
.equ G_PIPE_SCORE 0x04E7
.equ G_NEXT_PIPE  0x04EB
.equ G_LAST_FRAME 0x04EC
.equ G_OVER_TIMER 0x04ED
.equ G_DRAW_ORIGIN 0x04EE
.equ G_TMP        0x04EF
.equ G_FALL_TICK  0x04F0
.equ G_FLAP_TICK  0x04F1
.equ G_FRAME      0x04F2
.equ G_BTN        0x04F3
.equ G_BTN_HOLD   0x04F4
.equ G_FLAP_TIMER 0x04F6
.equ G_CLOUD_X    0x04F8
.equ G_BIRD_ANIM  0x04FC
.equ G_DEATH      0x04FD
.equ G_DEATH_TIMER 0x04FE
.equ G_BIRD_COLOR 0x04FF
.equ G_BIRD_GROUP 0x04F5

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
cloud_y:
    .word 45, 90, 45, 90

.org 0x5D5
; Body and belly palette entries per bird, picked at every reset.  Index 2 is
; the body, 13 the belly; the dizzy flower/star keep 5/11.
bird_colors:
    .word 0x0084, 0x00F1       ; red
    .word 0x00AE, 0x00B6       ; purple
    .word 0x00FC, 0x00F4       ; yellow
; Sprite groups for the dizzy pose, a ping-pong through three frames.
dizzy_groups:
    .word 3, 4, 5, 4

.org 0x5E0
pal_default:
    .word 0x0000, 0x00FF, 0x00E0, 0x001C
    .word 0x0003, 0x00FC, 0x001F, 0x00E3
    .word 0x0092, 0x00B6, 0x006D, 0x00DB
    .word 0x00E9, 0x00D3, 0x00FE, 0x00FF

; The far return pair the menu handed over, parked while the game runs.
.org 0x4D0
flappy_ret10:
    .word 0
flappy_ret11:
    .word 0
