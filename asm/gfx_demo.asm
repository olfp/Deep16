; gfx_demo.asm - the D16D colour demo block (PSRAM 0x4E00, CS=0x04A0).
;
; The image generator puts a four-word header at 0x6000:
;   0: 0x0D16 magic   1: format 1   2: entry (4)   3: reserved
; and this code starts at offset 0x404. The demo lives in the BIOS segment
; (0x04A0: physical 0x4A00..0x59FF), in the free gap after the BIOS code and
; below the Forth stacks. The BIOS sets DS=0x04A0, leaves gfx_back's offset in
; R12, and jumps to 0x404. On exit the demo jumps back to gfx_back, which
; clears the tilemap/scroll/OAM and returns to Forth.
;
; What it draws:
;   * 48 8x8 4bpp pattern tiles (three 32x32 sprites) generated as colour
;     bands; groups 3..5 are the dizzy poses and 6..7 the game bird frames;
;   * a scrolling '#' field in the 82x26 tilemap;
;   * three sprites bobbing in a wave, updated every frame.
; Any UART key returns to the console.
;
; Registers: R5 (>IN) and R6 (TIB) are the Forth's; the BIOS saves/restores
; them around the call, so the demo may use them freely. R12 is the return
; address and must survive. R13/R14 (SP/LR) are not touched.

.equ SEG_DEMO 0x04A0
.equ SEG_TILE -0x0F00          ; 0xF100: tilemap
.equ SEG_CTRL -0x0E00          ; 0xF200: cursor/row/scroll
.equ SEG_SPR  -0x0C00          ; 0xF400: sprite pattern bank
.equ SEG_OAM  -0x0B00          ; 0xF500: OAM (and palette at +0x80)
.equ SEG_UART -0x0FFC          ; 0xF004: UART status/data

.org 0x404
entry:
    LDI SEG_DEMO
    MVS DS, R0

    ; ---- pattern bank: 128 tiles x 16 words ---------------------------
    LDI SEG_SPR
    MVS ES, R0
    LDI 0
    MOV R2, R0                 ; bank word address
    LDI 0
    MOV R3, R0                 ; tile 0..127
pat_tile:
    MOV R4, R3
    SR  R4, 4                  ; group 0..7
    MOV R5, R4
    SL  R5, 1
    ADD R5, R4                 ; R5 = group*3
    LDI 0
    MOV R6, R0                 ; word 0..15
pat_word:
    MOV R7, R3
    ADD R7, R6
    ADD R7, R5
    LDI 7
    MOV R8, R0
    AND R7, R8
    ADD R7, 1                  ; colour 1..8
    LDI pat_tab
    MOV R9, R0
    ADD R9, R7
    LDS R10, DS, R9            ; 0x1111 * colour
    STS R10, ES, R2
    ADD R2, 1
    ADD R6, 1
    LDI 16
    CMP R6, R0
    JNZ pat_word
    NOP
    ADD R3, 1
    LDI 48
    CMP R3, R0
    JNZ pat_tile
    NOP

    ; ---- tilemap: a diagonal '#' every eight cells --------------------
    LDI SEG_TILE
    MVS ES, R0
    LDI 0
    MOV R2, R0                 ; cell address
    LDI 0
    MOV R3, R0                 ; row 0..25
tm_row:
    LDI 0
    MOV R4, R0                 ; column 0..81
tm_col:
    MOV R5, R3
    ADD R5, R4
    LDI 7
    MOV R6, R0
    AND R5, R6
    LDI 0
    MOV R7, R0
    CMP R5, R7
    JNZ tm_blank
    NOP
    LDI 0x0060                 ; '#' tile address (0x23-0x20)*32
    MOV R7, R0
tm_blank:
    STS R7, ES, R2
    ADD R2, 1
    ADD R4, 1
    LDI 82
    CMP R4, R0
    JNZ tm_col
    NOP
    ADD R3, 1
    LDI 26
    CMP R3, R0
    JNZ tm_row
    NOP

    ; ---- OAM: three 32x32 sprites ------------------------------------
    LDI SEG_OAM
    MVS ES, R0
    LDI 0
    MOV R2, R0                 ; OAM word
    LDI 0
    MOV R3, R0                 ; sprite 0..7
oam_loop:
    LDI spr_x
    MOV R5, R0
    ADD R5, R3
    LDS R4, DS, R5             ; x position
    MOV R5, R3
    SL  R5, 10
    OR  R4, R5                 ; w0 = x | group<<10
    LDI 170
    MOV R6, R0
    LDI 0x0400
    MOV R7, R0
    OR  R6, R7                 ; w1 = y | enable
    MOV R7, R3
    SL  R7, 1
    STS R4, ES, R7
    ADD R7, 1
    STS R6, ES, R7
    ADD R3, 1
    LDI 3
    CMP R3, R0
    JNZ oam_loop
    NOP

    ; ---- animation ----------------------------------------------------
    LDI 0
    MOV R10, R0                ; phase
anim:
    ; scroll_x = phase & 15, scroll_y = (phase >> 1) & 15
    LDI SEG_CTRL
    MVS ES, R0
    MOV R4, R10
    LDI 15
    MOV R5, R0
    AND R4, R5
    LDI 4
    MOV R6, R0
    STS R4, ES, R6
    MOV R4, R10
    SR  R4, 1
    AND R4, R5
    LDI 6
    MOV R6, R0
    STS R4, ES, R6

    ; sprite y = 170 + wave[(phase + sprite*2) & 15]
    LDI SEG_OAM
    MVS ES, R0
    LDI 0
    MOV R3, R0
spr_anim:
    MOV R4, R10
    MOV R5, R3
    SL  R5, 1
    ADD R4, R5
    LDI 15
    MOV R6, R0
    AND R4, R6
    LDI wave
    MOV R6, R0
    ADD R6, R4
    LDS R7, DS, R6
    LDI 170
    MOV R8, R0
    ADD R7, R8
    LDI 0x0400
    MOV R8, R0
    OR  R7, R8                 ; enable bit 10
    MOV R5, R3
    SL  R5, 1
    ADD R5, 1                  ; w1 address
    STS R7, ES, R5
    ADD R3, 1
    LDI 3
    CMP R3, R0
    JNZ spr_anim
    NOP

    ; one visible frame of dwell
    LDI 0x7000
    MOV R3, R0
delay:
    SUB R3, 1
    JNZ delay
    NOP

    ; any UART byte returns to the console
    LDI SEG_UART
    MVS ES, R0
    LDI 0
    MOV R2, R0
    LDS R1, ES, R2
    LDI 1
    MOV R3, R0
    AND R1, R3
    JNZ demo_exit
    NOP
    LDI 2
    MOV R2, R0
    LDS R1, ES, R2             ; consume the byte
    ADD R10, 1
    LDI anim
    MOV PC, R0
    NOP

demo_exit:
    MOV PC, R12                ; gfx_back offset, same BIOS segment
    NOP

; ---- data -------------------------------------------------------------
pat_tab:
    .word 0x0000, 0x1111, 0x2222, 0x3333, 0x4444, 0x5555, 0x6666, 0x7777
    .word 0x8888, 0x9999, 0xAAAA, 0xBBBB, 0xCCCC, 0xDDDD, 0xEEEE, 0xFFFF
spr_x:
    .word 40, 112, 184, 256, 328, 400, 472, 544
wave:
    .word 0, 4, 8, 12, 16, 20, 24, 28, 31, 28, 24, 20, 16, 12, 8, 4
