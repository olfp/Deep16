; pole_render.asm - D16 software road renderer for the FiT tile engine.
;
; The renderer projects the road into the inactive tilemap bank and writes the
; player and the opponents into the OAM. It is a pure function of the state
; block in DS and it never divides: every projection step is a multiply or a
; table lookup, so the frame loop can never reach the core3 DIV/DIV32 ILL trap.
;
; The geometry is the shared integer model in js/deep16_pole_model.js and the
; tables in asm/pole/pole_tables.asm hold the same numbers.
; tests/pole-asm.test.js compares the map this code writes with the model's,
; cell for cell.
;
; Measured cost on the core3 RTL model: 13,565 instructions and 56,697 cycles
; per frame, out of the 112,500 cycles a 60 Hz frame has at 6.75 MHz. About
; 55% of the instructions are the per-cell fill loop below, which writes
; 1,867 cells per frame at four instructions each.
;
; Segment layout (DS = CS = the program segment):
;   0x0100  the entry point
;   0x0120  the benchmark driver (pole_bench.asm)
;   0x01A0  the renderer and its helpers
;   0x0A00  the curve, width, hill and sprite tables (pole_tables.asm)
;   0x0B00  the dirty-redraw helper (pole_state.asm)
;   0x0C00  the art copy (pole_art.asm)
;   0x04B0  the state block
;   0x04DC  the scratch cells
;   0x04F0  the band descriptors: 24 x { centre, half width }
;
; Register use inside the renderer. R14 is the link register and R15 is the
; program counter, so neither may be used for anything else - R15 in
; particular is not a general-purpose register, and loading it moves the PC.
;   R0   the LDI target and the scratch of the moment
;   R1   the row counter, then the OAM slot
;   R2   the scratch of the moment
;   R3   the scratch of the moment
;   R4   the band half width, then the left cell
;   R5   a constant: 63 in the band loop, 7 in the row loop
;   R6   the MUL32 high word, then the fill word
;   R7   the MUL32 low word, then the right cell
;   R8   the band descriptor pointer, then the half width
;   R9   the constant zero (never written after the prologue)
;   R10  the phase, then the left edge offset
;   R11  the accumulated curve offset, then the call target
;   R12  the curve increment, then the row base
;   R13  the horizon

.equ SEG_TILE -0x0F00
.equ SEG_CTRL -0x0E00
.equ SEG_OAM  -0x0A00

; 0.68 in Q16 is 0xAE0C. LDI reaches 0x0000-0x3FFF and 0xC000-0xFFFF only, so
; the middle third - where 0xAE0C lives - has to be built with arithmetic:
; 0x2E0C + 0x8000, and 0x8000 is 0xC000 + 0xC000 truncated to 16 bits.
.equ HALF_Q16_LO 0x2E0C

.equ ART_SKY    96
.equ ART_MTN_A  97
.equ ART_MTN_B  98
.equ ART_MTN_C  99
.equ ART_GRASS_A 100
.equ ART_GRASS_B 101
.equ ART_ROAD_A 102
.equ ART_ROAD_B 103
.equ ART_L_EDGE 104
.equ ART_R_EDGE 112
.equ ART_CENTER 120

.equ ST_PHASE    0x04B0
.equ ST_HILL     0x04B2
.equ ST_HORIZON  0x04B4
.equ ST_PLAYER_X 0x04B6
.equ ST_BANK     0x04B8
.equ ST_OPP      0x04C0
.equ SCR_LR      0x04DC
.equ SCR_COUNT   0x04DE
.equ SCR_PHASE   0x04E0
.equ SCR_HALFQ   0x04E2
.equ SCR_EDGEL   0x04E4
.equ SCR_ROAD    0x04E6
.equ SCR_CENTER  0x04E8
.equ SCR_EDGER   0x04EA
.equ SCR_MID     0x04EC
.equ SCR_GRASS   0x04EE
.equ SCR_SKIP    0x04E1
.equ SCR_T0NEW   0x04E3
.equ BANKT0_0    0x04DD
.equ BANKT0_1    0x04DF
.equ BND_BASE    0x04F0

; The entry point jumps to whichever driver the program was built with:
; pole_bench.asm for the core3 benchmark, pole_board.asm for the board.
.org 0x0100
pole_entry:
    CMP R9, R9
    JZ pole_program
    NOP

.org 0x01A0
pole_render:
    ; ---- keep the caller's return address -------------------------------
    ; The helpers below use LINK, so LR is overwritten; the return address is
    ; parked in a scratch cell and restored at the end.
    LDI SCR_LR
    MOV R2, R0
    ST LR, R2, 0

    ; ---- the constants --------------------------------------------------
    LDI 0
    MOV R9, R0                 ; the permanent zero

    ; HALF_Q16 = 0xAE0C = 0x8000 + 0x2E0C
    LDI HALF_Q16_LO
    MOV R1, R0
    LDI -16384                 ; 0xC000
    ADD R0, R0                 ; 0x8000 (the 17-bit sum wraps)
    ADD R0, R1                 ; 0xAE0C
    MOV R3, R0                 ; keep the value: LDI would clobber R0
    LDI SCR_HALFQ
    MOV R2, R0
    ST R3, R2, 0

    ; ---- load the state -------------------------------------------------
    LDI ST_PHASE
    MOV R2, R0
    LD R10, R2, 0              ; the pattern phase
    LDI SCR_PHASE
    MOV R2, R0
    ST R10, R2, 0              ; the row loop needs the phase as well
    LDI ST_HORIZON
    MOV R2, R0
    LD R13, R2, 0              ; the horizon in pixels

    ; ---- point the write port at the back bank --------------------------
    LDI ST_BANK
    MOV R2, R0
    LD R3, R2, 0               ; the displayed bank
    LDI 1
    SUB R0, R3                 ; the back bank is the other one
    MOV R3, R0
    SL R3, 1                   ; bit 0: the write bank, bit 1: the display bank
    OR R3, R0
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 8
    STS R3, ES, R2

    ; ---- project the bands, nearest row first ---------------------------
    LDI BND_BASE
    MOV R8, R0                 ; the descriptor pointer
    LDI 0
    MOV R11, R0                ; the accumulated curve offset
    MOV R12, R0                ; the curve increment
    LDI 23
    MOV R1, R0                 ; the row
    LDI 63
    MOV R5, R0                 ; the pattern mask

band_loop:
    ; dy = row*15 + 7 - horizon
    MOV R2, R1
    MOV R3, R1
    SL R3, 4
    SUB R3, R2
    ADD R3, 7
    SUB R3, R13
    JN band_done               ; above the horizon: no more road

    ; half_base = (HALF_Q16 * dy) >> 16 - the high word of the product
    LDI SCR_HALFQ
    MOV R2, R0
    LD R2, R2, 0
    MOV R7, R3
    MUL32 R2, R7               ; R2 = the high word, R3 = the low word

    ; the pattern index = (phase + band) & 63
    LDI 23
    MOV R3, R0
    SUB R3, R1                 ; the band
    ADD R3, R10
    AND R3, R5

    ; the road width factor
    LDI WIDTH_TBL
    MOV R7, R0
    ADD R7, R3
    LD R7, R7, 0

    ; half = (half_base * width) >> 8
    MUL R2, R7
    SR R2, 8
    MOV R4, R2

    ; the curve of this band
    LDI CURVE_TBL
    MOV R2, R0
    ADD R2, R3
    LD R2, R2, 0

    ; the curve accumulates outwards: the road under the player stays put
    ; and the bend grows with the distance.
    ADD R11, R12
    ADD R12, R2

    ; the lateral shift = ((x_acc - player_x) * half) >> 8
    LDI ST_PLAYER_X
    MOV R2, R0
    LD R2, R2, 0
    MOV R3, R11
    SUB R3, R2
    MOV R2, R3
    LDI mul_shr8
    MOV R7, R0
    LINK
    JMP R7
    NOP

    ; the centre of the road
    LDI 320
    MOV R3, R0
    ADD R3, R2
    ST R3, R8, 0               ; the centre
    ST R4, R8, 1               ; the half width
    ADD R8, 2
    SUB R1, 1
    CMP R9, R9
    JZ band_loop
    NOP

band_done:
    ; the number of road bands = 23 - row (the row is one above the road)
    LDI 23
    SUB R0, R1
    MOV R3, R0
    LDI SCR_COUNT
    MOV R2, R0
    ST R3, R2, 0

    ; ---- compose the 80x24 visible map ----------------------------------
    LDI SEG_TILE
    MVS ES, R0
    LDI 7
    MOV R5, R0                 ; the sub-cell mask
    LDI 0
    MOV R1, R0                 ; the row
row_loop:
    ; the row base = row * 82
    MOV R12, R1
    MOV R3, R1
    SL R12, 6
    SL R3, 4
    ADD R12, R3
    MOV R3, R1
    SL R3, 1
    ADD R12, R3

    ; rows that are plain sky in this bank already are left untouched
    LDI SCR_SKIP
    MOV R2, R0
    LD R3, R2, 0
    CMP R1, R3
    JNC row_draw
    NOP
    LDI row_next
    MOV PC, R0
    NOP
row_draw:

    ; dy = row*15 + 7 - horizon
    MOV R2, R1
    MOV R3, R1
    SL R3, 4
    SUB R3, R2
    ADD R3, 7
    SUB R3, R13
    JN row_sky

    ; ---- the road row ---------------------------------------------------
    ; the descriptor of band = 23 - row
    LDI 23
    MOV R2, R0
    SUB R2, R1
    SL R2, 1
    LDI BND_BASE
    MOV R3, R0
    ADD R3, R2
    LD R11, R3, 0              ; the centre
    LD R8, R3, 1               ; the half width

    ; the left edge in pixels, clamped to 0..639
    MOV R2, R11
    SUB R2, R8
    CMP R2, R9
    JNN lp_lo
    NOP
    MOV R2, R9
lp_lo:
    LDI 639
    CMP R2, R0
    JN lp_hi
    NOP
    MOV R2, R0
lp_hi:
    ; the right edge in pixels, clamped to 1..640
    MOV R3, R11
    ADD R3, R8
    LDI 1
    CMP R3, R0
    JNN rp_lo
    NOP
    MOV R3, R0
rp_lo:
    LDI 640
    CMP R3, R0
    JN rp_hi
    NOP
    MOV R3, R0
rp_hi:
    ; the left cell and its sub-cell offset
    MOV R4, R2
    SR R4, 3
    MOV R10, R2
    AND R10, R5
    ; the right cell and its sub-cell offset
    MOV R7, R3
    SUB R7, 1
    MOV R8, R7
    SR R7, 3
    AND R8, R5
    ; the centre cell, clamped into the road
    MOV R6, R11
    SRA R6, 3
    CMP R6, R4
    JNN cc0
    NOP
    MOV R6, R4
cc0:
    CMP R6, R7
    JN cc1
    NOP
    MOV R6, R7
cc1:
    LDI SCR_MID
    MOV R3, R0
    ST R6, R3, 0
    ; the centre stripe offset
    MOV R2, R11
    AND R2, R5

    ; ---- the cell words of this row -------------------------------------
    ; Each word is parked in R3 first: LDI would clobber R0. The centre word
    ; comes first because it consumes R2, the centre stripe offset.
    LDI ART_CENTER
    ADD R0, R2
    SL R0, 5
    MOV R3, R0
    LDI SCR_CENTER
    MOV R2, R0
    ST R3, R2, 0
    LDI ART_L_EDGE
    ADD R0, R10
    SL R0, 5
    MOV R3, R0
    LDI SCR_EDGEL
    MOV R2, R0
    ST R3, R2, 0
    LDI ART_R_EDGE
    ADD R0, R8
    SL R0, 5
    MOV R3, R0
    LDI SCR_EDGER
    MOV R2, R0
    ST R3, R2, 0

    ; the road texture alternates every eight bands
    LDI SCR_PHASE
    MOV R3, R0
    LD R10, R3, 0
    LDI 23
    MOV R2, R0
    SUB R2, R1
    ADD R10, R2
    SR R10, 3
    MOV R2, R10
    SR R2, 1
    SL R2, 1
    SUB R10, R2
    LDI ART_ROAD_A
    CMP R10, R9
    JZ road_a
    NOP
    LDI ART_ROAD_B
road_a:
    SL R0, 5
    MOV R3, R0
    LDI SCR_ROAD
    MOV R2, R0
    ST R3, R2, 0

    ; The grass takes the same band parity as the road texture (R10 is still
    ; the parity bit), so the ground scrolls with the road.
    LDI ART_GRASS_A
    ADD R0, R10
    SL R0, 5
    MOV R3, R0
    LDI SCR_GRASS
    MOV R2, R0
    ST R3, R2, 0

    ; ---- write the row --------------------------------------------------
    ; The grass goes down first, on both sides of the road, and the road is
    ; painted over it. A road narrower than one cell can put the left edge
    ; past the right edge, and only this order matches the model there.
    ; the grass before the left edge
    CMP R4, R9
    JZ no_left_grass
    NOP
    LDI SCR_GRASS
    MOV R2, R0
    LD R6, R2, 0
    MOV R2, R12
    MOV R3, R4
    LDI fill_cells
    MOV R11, R0
    LINK
    JMP R11
    NOP
no_left_grass:
    ; the grass after the right edge
    LDI 79
    MOV R3, R0
    SUB R3, R7
    CMP R3, R9
    JZ no_right_grass
    NOP
    LDI SCR_GRASS
    MOV R2, R0
    LD R6, R2, 0
    MOV R2, R12
    ADD R2, R7
    ADD R2, 1
    LDI fill_cells
    MOV R11, R0
    LINK
    JMP R11
    NOP
no_right_grass:
    ; the left edge tile
    MOV R2, R12
    ADD R2, R4
    LDI SCR_EDGEL
    MOV R3, R0
    LD R6, R3, 0
    STS R6, ES, R2
    ; the road between the left edge and the centre stripe
    LDI SCR_MID
    MOV R3, R0
    LD R6, R3, 0
    MOV R3, R6
    SUB R3, R4
    SUB R3, 1
    CMP R3, R9
    JNN cnt_a_ok
    NOP
    MOV R3, R9
cnt_a_ok:
    CMP R3, R9
    JZ no_road_a
    NOP
    LDI SCR_ROAD
    MOV R2, R0
    LD R6, R2, 0
    MOV R2, R12
    ADD R2, R4
    ADD R2, 1
    LDI fill_cells
    MOV R11, R0
    LINK
    JMP R11
    NOP
no_road_a:
    ; the centre stripe
    LDI SCR_MID
    MOV R3, R0
    LD R6, R3, 0
    MOV R2, R12
    ADD R2, R6
    LDI SCR_CENTER
    MOV R3, R0
    LD R6, R3, 0
    STS R6, ES, R2
    ; the road between the centre stripe and the right edge
    LDI SCR_MID
    MOV R3, R0
    LD R6, R3, 0
    MOV R3, R7
    SUB R3, R6
    SUB R3, 1
    CMP R3, R9
    JNN cnt_b_ok
    NOP
    MOV R3, R9
cnt_b_ok:
    CMP R3, R9
    JZ no_road_b
    NOP
    ; the start = rowbase + centreCell + 1
    MOV R2, R12
    ADD R2, R6
    ADD R2, 1
    ; the road word goes in last: loading it clobbers R6
    LDI SCR_ROAD
    MOV R10, R0
    LD R6, R10, 0
    LDI fill_cells
    MOV R11, R0
    LINK
    JMP R11
    NOP
no_road_b:
    ; the right edge tile
    MOV R2, R12
    ADD R2, R7
    LDI SCR_EDGER
    MOV R3, R0
    LD R6, R3, 0
    STS R6, ES, R2
    CMP R9, R9
    JZ row_next
    NOP

    ; ---- the sky row ----------------------------------------------------
row_sky:
    ; The rows above the horizon carry the sky, the mountain row and the
    ; tree line. fill_sky draws all three; the mountain row alternates the
    ; two profiles, so the ridge line has a sixteen pixel period.
    ;
    ; The helper lives outside the row body on purpose: a conditional branch
    ; reaches nine bits, and the row body is already close to that limit.
    LDI fill_sky
    MOV R11, R0
    LINK
    JMP R11
    NOP

row_next:
    ADD R1, 1
    LDI 24
    CMP R1, R0
    JNZ row_loop
    NOP

    ; ---- the sprites ----------------------------------------------------
    LDI SEG_OAM
    MVS ES, R0
    ; slot 0: the player, 28x22, bottom centre
    LDI 0
    MOV R2, R0
    LDI 0x0932                ; enabled, x = 306
    MOV R3, R0
    STS R3, ES, R2
    LDI 0x0148                ; group 0, y = 328
    MOV R3, R0
    LSI R2, 1
    STS R3, ES, R2

    ; slots 1..7: the opponents
    LDI 1
    MOV R1, R0                 ; the slot
    LDI ST_OPP
    MOV R10, R0                ; the record pointer
opp_loop:
    LD R2, R10, 0              ; the band
    LDI SCR_COUNT
    MOV R3, R0
    LD R4, R3, 0               ; the number of road bands
    CMP R2, R4
    JNC opp_hidden              ; no borrow: the band is past the end of the road
    NOP
opp_visible:
    ; the descriptor of the band
    MOV R3, R2
    SL R3, 1
    LDI BND_BASE
    MOV R4, R0
    ADD R4, R3
    LD R5, R4, 0               ; the centre
    LD R6, R4, 1               ; the half width
    ; the lateral offset = (lateral * half) >> 8
    LD R2, R10, 1
    MOV R4, R6
    LDI mul_shr8
    MOV R11, R0
    LINK
    JMP R11
    NOP
    ; the scale bin: band <= 2 -> 0, <= 6 -> 1, <= 11 -> 2, else 3
    LD R3, R10, 0
    LDI 3
    CMP R3, R0
    JN bin0
    NOP
    LDI 7
    CMP R3, R0
    JN bin1
    NOP
    LDI 12
    CMP R3, R0
    JN bin2
    NOP
    LDI 3
    CMP R9, R9
    JZ bin_set
    NOP
bin0:
    LDI 0
    CMP R9, R9
    JZ bin_set
    NOP
bin1:
    LDI 1
    CMP R9, R9
    JZ bin_set
    NOP
bin2:
    LDI 2
bin_set:
    MOV R7, R0                 ; the bin
    ; the sprite width and height
    LDI SPRITE_W
    MOV R8, R0
    ADD R8, R7
    LD R8, R8, 0               ; the width
    LDI SPRITE_H
    MOV R12, R0
    ADD R12, R7
    LD R12, R12, 0             ; the height
    ; x = centre + offset - width/2
    ADD R5, R2
    MOV R3, R8
    SR R3, 1
    SUB R5, R3
    ; the OAM descriptor
    MOV R4, R5                 ; x
    JN x_negative
    NOP
    LDI 1023
    MOV R6, R0
    AND R4, R6
    LDI 0x0800
    OR R4, R0
    CMP R9, R9
    JZ x_done
    NOP
x_negative:
    LDI 1023
    MOV R6, R0
    AND R4, R6
    LDI 0x0C00                ; enabled and the sign bit
    OR R4, R0
x_done:
    ; the group = the model base + the bin
    LDI SPRITE_G
    MOV R6, R0
    LD R2, R10, 2              ; the model
    ADD R6, R2
    LD R6, R6, 0
    ADD R6, R7
    SL R6, 11
    ; y = (23 - band)*15 + 7 - height, masked into the low ten bits
    LDI 23
    MOV R3, R0
    LD R2, R10, 0
    SUB R3, R2                 ; the row
    MOV R2, R3
    SL R2, 4
    SUB R2, R3                 ; row*15
    ADD R2, 7
    SUB R2, R12                ; the height
    LDI 1023
    MOV R8, R0
    AND R2, R8
    OR R6, R2
    ; store the descriptor
    MOV R2, R1
    SL R2, 1
    STS R4, ES, R2
    ADD R2, 1
    STS R6, ES, R2
    CMP R9, R9
    JZ opp_next
    NOP
opp_hidden:
    ; outside the road: the sprite stays disabled
    MOV R2, R1
    SL R2, 1
    LDI 0
    MOV R3, R0
    STS R3, ES, R2
    ADD R2, 1
    STS R3, ES, R2
opp_next:
    ADD R10, 4
    ADD R1, 1
    LDI 8
    CMP R1, R0
    JNZ opp_loop
    NOP

    ; ---- show the new bank ----------------------------------------------
    LDI ST_BANK
    MOV R2, R0
    LD R3, R2, 0
    LDI 1
    SUB R0, R3                 ; the new bank
    MOV R3, R0
    SL R3, 1
    OR R3, R0
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 8
    STS R3, ES, R2
    LDI ST_BANK
    MOV R2, R0
    SR R3, 1                   ; (new << 1) | new >> 1 = the new bank
    ST R3, R2, 0

    ; ---- remember this bank's first non-plain row -----------------------
    AND R3, R3
    JNZ dirty_store1
    NOP
    LDI BANKT0_0
    MOV R2, R0
    LDI SCR_T0NEW
    MOV R5, R0
    LD R4, R5, 0
    ST R4, R2, 0
    LDI dirty_store_done
    MOV PC, R0
    NOP
dirty_store1:
    LDI BANKT0_1
    MOV R2, R0
    LDI SCR_T0NEW
    MOV R5, R0
    LD R4, R5, 0
    ST R4, R2, 0
dirty_store_done:

    ; ---- return ---------------------------------------------------------
    LDI SCR_LR
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; mul_shr8: R2 = a (signed), R4 = b (unsigned) -> R2 = (a*b) >> 8.
; The magnitude is multiplied unsigned and the sign is applied afterwards, so
; the result truncates toward zero. Clobbers R2, R3, R6, R7.
; ---------------------------------------------------------------------------
mul_shr8:
    MOV R3, R2
    CMP R3, R9
    JNN ms8_pos
    NOP
    NEG R3
ms8_pos:
    MOV R6, R3
    MUL32 R6, R4                ; R6 = the high word, R7 = the low word
    SR R7, 8
    SL R6, 8
    OR R6, R7                   ; (a*b) >> 8, truncated to 16 bits
    CMP R2, R9
    JNN ms8_done
    NOP
    NEG R6
ms8_done:
    MOV R2, R6
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; fill_cells: R6 = the cell word, R2 = the map offset, R3 = the count.
; Clobbers R2, R3. The caller keeps the count above zero.
;
; The address bump sits in the delay slot of the branch, so a cell costs four
; instructions: store, decrement, branch, increment. The delay slot always
; runs, so the last pass steps the address one cell too far - harmless,
; because the caller does not use it afterwards.
; ---------------------------------------------------------------------------
fill_cells:
    STS R6, ES, R2
    SUB R3, 1
    JNZ fill_cells
    ADD R2, 1
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; fill_sky: fill the 80 cells of the row above the horizon.
; R3 holds the row's distance to the horizon in pixels, R12 the row's map
; offset and ES the tile segment.
;
; There are three kinds of row:
;   * the tree line, the row that stands on the horizon;
;   * the mountain row, which alternates the two mountain profiles so the
;     ridge line has a sixteen pixel period instead of an eight pixel one;
;   * the plain sky above them.
;
; The two mountain tiles are 97 and 98, so their cell words are 0xC20 and
; 0xC40: the two words differ in bits five and six, and toggling those two
; bits swaps one tile for the other. The mountain loop toggles them after
; every cell and the profiles alternate.
;
; The loops are written out instead of calling fill_cells: a nested LINK
; would overwrite the return address this helper is holding.
; ---------------------------------------------------------------------------
fill_sky:
    LDI -15
    CMP R3, R0
    JN fs_mid
    NOP
    LDI ART_MTN_C
    CMP R9, R9
    JZ fs_fill
    NOP
fs_mid:
    LDI -30
    CMP R3, R0
    JN fs_plain
    NOP
    ; the mountain row: the two profiles alternate across the row
    LDI ART_MTN_A
    SL R0, 5
    MOV R6, R0
    LDI 0x60                 ; the toggle that swaps tile 97 for tile 98
    MOV R7, R0
    MOV R2, R12
    LDI 80
    MOV R4, R0
fs_mtn:
    STS R6, ES, R2
    XOR R6, R7
    SUB R4, 1
    JNZ fs_mtn
    ADD R2, 1
    JMP LR
    NOP
fs_plain:
    LDI ART_SKY
fs_fill:
    SL R0, 5
    MOV R6, R0
    MOV R2, R12
    LDI 80
    MOV R4, R0
fs_loop:
    STS R6, ES, R2
    SUB R4, 1
    JNZ fs_loop
    ADD R2, 1
    JMP LR
    NOP
