; pole_art.asm - copy the slice's art into the FiT banks.
;
; The tile, sprite and palette banks are shared with the other games: the
; bitstream carries the console font and the bird sprite, and every game
; copies its own art into the banks when it starts. The Pole slice does the
; same, so the art travels with the slice instead of the bitstream.
;
; The art lives in the slice's own segment:
;
;   0x1000  the 32 tile words (tiles 96..127), 1024 words
;   0x1400  the 17 sprite groups, 4352 words
;   0x2500  the three palettes, 48 words
;
; All three copies are block moves:
;   - the art tiles are the last 32 tiles of the tile bank, so they start at
;     tile 96 * 32 words;
;   - the sprite groups are the first 17 of the sprite bank, so they start at
;     group 0 * 256 words;
;   - the palettes are three consecutive 16-word banks of the palette window,
;     so they start at set 0, bank 0.
;
; The copy runs once, before the frame loop, so it costs nothing per frame.
; The three loops are written out instead of sharing one helper: a helper
; would need LINK, and LINK overwrites the return address that the caller
; of pole_art_copy is waiting for.

.equ SEG_TILE_BANK -0x0D00      ; 0xF300: the tile bank
.equ SEG_SPR_BANK  -0x0C00      ; 0xF400: the sprite bank
.equ SEG_PALETTE   -0x0A00      ; 0xF600: the OAM and the palettes

.equ ART_TILE_SRC  0x1000
.equ ART_TILE_DST  0x0C00       ; tile 96 * 32 words
.equ ART_TILE_LEN  1024
.equ ART_SPR_SRC   0x1400
.equ ART_SPR_DST   0x0000       ; group 0 * 256 words
.equ ART_SPR_LEN   4352
.equ ART_PAL_SRC   0x2500
.equ ART_PAL_DST   0x0080       ; palette set 0, bank 0
.equ ART_PAL_LEN   48

; ---------------------------------------------------------------------------
; pole_art_copy: copy the art into the tile, sprite and palette banks.
; The slice runs with DS on its own segment, so the source is read with DS
; and the destination is written with ES. Clobbers every register.
; ---------------------------------------------------------------------------
.org 0x0900
pole_art_copy:
    ; ---- the tile art ----------------------------------------------------
    LDI ART_TILE_SRC
    MOV R2, R0
    LDI ART_TILE_DST
    MOV R3, R0
    LDI ART_TILE_LEN
    MOV R6, R0
    LDI SEG_TILE_BANK
    MVS ES, R0
art_tile_loop:
    LDS R5, DS, R2
    STS R5, ES, R3
    ADD R2, 1
    ADD R3, 1
    SUB R6, 1
    JNZ art_tile_loop
    NOP

    ; ---- the sprite art --------------------------------------------------
    LDI ART_SPR_SRC
    MOV R2, R0
    LDI ART_SPR_DST
    MOV R3, R0
    LDI ART_SPR_LEN
    MOV R6, R0
    LDI SEG_SPR_BANK
    MVS ES, R0
art_spr_loop:
    LDS R5, DS, R2
    STS R5, ES, R3
    ADD R2, 1
    ADD R3, 1
    SUB R6, 1
    JNZ art_spr_loop
    NOP

    ; ---- the palettes ----------------------------------------------------
    LDI ART_PAL_SRC
    MOV R2, R0
    LDI ART_PAL_DST
    MOV R3, R0
    LDI ART_PAL_LEN
    MOV R6, R0
    LDI SEG_PALETTE
    MVS ES, R0
art_pal_loop:
    LDS R5, DS, R2
    STS R5, ES, R3
    ADD R2, 1
    ADD R3, 1
    SUB R6, 1
    JNZ art_pal_loop
    NOP

    JMP LR
    NOP
