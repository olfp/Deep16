; pole_state.asm - the shared state block handling for the Pole renderer.
;
; The core3 benchmark driver (pole_bench.asm) and the on-board driver
; (pole_board.asm) both call these two helpers, so the board measures exactly
; the state work the benchmark measures. The helpers are leaves: they call
; nothing, so they can end with a plain JMP LR.
;
; The state block (shared with pole_render.asm):
;   0x04B0  the pattern phase
;   0x04B2  the hill phase
;   0x04B4  the horizon in pixels
;   0x04B6  the player's lateral offset
;   0x04B8  the displayed map bank
;   0x04C0  seven opponent records of four words: band, lateral, model, spare

.equ ST_PHASE    0x04B0
.equ ST_HILL     0x04B2
.equ ST_HORIZON  0x04B4
.equ ST_PLAYER_X 0x04B6
.equ ST_BANK     0x04B8
.equ ST_OPP      0x04C0
.equ HILL_TBL    0x0480

; ---------------------------------------------------------------------------
; pole_state_init: fill the state block with the benchmark's start values.
; ---------------------------------------------------------------------------
.org 0x0140
pole_state_init:
    ; the pattern phase
    LDI ST_PHASE
    MOV R2, R0
    LDI 0
    ST R0, R2, 0
    ; the hill phase
    LDI ST_HILL
    MOV R2, R0
    LDI 0
    ST R0, R2, 0
    ; the horizon: 90 pixels before the first hill offset is added
    LDI ST_HORIZON
    MOV R2, R0
    LDI 90
    ST R0, R2, 0
    ; the player sits in the middle of the road
    LDI ST_PLAYER_X
    MOV R2, R0
    LDI 0
    ST R0, R2, 0
    ; the displayed map bank
    LDI ST_BANK
    MOV R2, R0
    LDI 0
    ST R0, R2, 0

    ; three opponents: band, lateral offset, model
    LDI ST_OPP
    MOV R2, R0
    LDI 5
    ST R0, R2, 0
    LDI -64
    ST R0, R2, 1
    LDI 0
    ST R0, R2, 2
    ADD R2, 4
    LDI 9
    ST R0, R2, 0
    LDI 96
    ST R0, R2, 1
    LDI 1
    ST R0, R2, 2
    ADD R2, 4
    LDI 13
    ST R0, R2, 0
    LDI 0
    ST R0, R2, 1
    LDI 2
    ST R0, R2, 2
    ADD R2, 4
    ; the remaining four slots stay outside the road
    LDI -1
    ST R0, R2, 0
    ADD R2, 4
    LDI -1
    ST R0, R2, 0
    ADD R2, 4
    LDI -1
    ST R0, R2, 0
    ADD R2, 4
    LDI -1
    ST R0, R2, 0

    JMP LR
    NOP

; ---------------------------------------------------------------------------
; pole_state_advance: move the track on by one frame.
;
; The pattern phase advances by three, the hill phase by one, and the horizon
; follows the hill table. This is the work the model does in Model.advance.
; ---------------------------------------------------------------------------
.org 0x0180
pole_state_advance:
    ; the pattern phase advances by three
    LDI ST_PHASE
    MOV R2, R0
    LD R3, R2, 0
    LDI 3
    ADD R3, R0
    LDI 63
    AND R3, R0
    ST R3, R2, 0
    ; the hill phase advances by one
    LDI ST_HILL
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    LDI 31
    AND R3, R0
    ST R3, R2, 0
    ; the horizon = 90 + hill_tbl[hill_phase]
    LDI HILL_TBL
    MOV R4, R0
    ADD R4, R3
    LD R4, R4, 0
    LDI 90
    ADD R4, R0
    LDI ST_HORIZON
    MOV R2, R0
    ST R4, R2, 0

    JMP LR
    NOP
