; scroll4.asm - four-direction FiT camera helpers and a diagonal demo.
;
; The visible window is the centre of the 82x26 map:
;
;   columns 1..80, rows 1..24
;   scroll_x = 8 is centre, scroll_y = 15 is centre
;
; Moving one pixel/frame, the demo shifts the whole map by one row/column when
; an axis reaches its extreme, then resets that axis to the centre. The new
; margin cell is written by the helper, so it is ready when it enters the
; visible window.
;
; Build with BENCH to measure the helper only (no frame wait):
;   BENCH_TEST=1  two shifts with markers, for correctness
;   BENCH=1       eight left+up shifts, for timing

.equ SEG_TILE -0x0F00       ; 0xF100: tilemap
.equ SEG_CTRL -0x0E00       ; 0xF200: controls
.equ SEG_IO   -0x1000       ; 0xF000: display status at 0xF0066

.equ CAMX     0x0200
.equ CAMY     0x0202
.equ FRAMES   0x0204

.equ COLS     82
.equ MAP_ROWS 26
.equ MAP_CELLS 2132

.org 0x0100

.ifdef BENCH_TEST
    ; Cell 0 must become the old row-1/col-0 cell (0x0444) after a left shift
    ; followed by an up shift; the two margins must hold the '#' text cell.
    LDI SEG_TILE
    MVS ES, R0
    LDI 0
    MOV R2, R0
    LDI 0x1111
    MOV R3, R0
    STS R3, ES, R2
    LDI 1
    MOV R2, R0
    LDI 0x2222
    MOV R3, R0
    STS R3, ES, R2
    LDI 82
    MOV R2, R0
    LDI 0x3333
    MOV R3, R0
    STS R3, ES, R2
    LDI 83
    MOV R2, R0
    LDI 0x0444
    MOV R3, R0
    STS R3, ES, R2

    LDI shift_left
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI shift_up
    MOV R4, R0
    LINK
    JMP R4
    NOP
    HALT

.else
.ifdef BENCH
    ; Eight diagonal steps. Measure the cycles around these calls.
    LDI 8
    MOV R6, R0
bench_loop:
    LDI shift_left
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI shift_up
    MOV R4, R0
    LINK
    JMP R4
    NOP
    SUB R6, 1
    JNZ bench_loop
    NOP
    HALT

.else
    ; ---- diagonal demo -------------------------------------------------
    LDI SEG_TILE
    MVS ES, R0

    ; A vertical stripe pattern in text cells: space, '#' pairs. Text pair 0
    ; is the default black/white pair.
    LSI R3, 1
    SL R3, 15                  ; 0x8000: text mode, pair 0, glyph space
    LDI 0
    MOV R2, R0
    LDI MAP_CELLS
    MOV R4, R0
fill_map:
    STS R3, ES, R2
    LDI 0x0060                 ; '#' glyph address
    MOV R1, R0
    XOR R3, R1
    ADD R2, 1
    SUB R4, 1
    JNZ fill_map
    NOP

    ; Centre the window, row offset 0, write/display bank 0, cursor off.
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 0
    LSI R3, 0
    STS R3, ES, R2             ; cursor off
    LSI R2, 2
    STS R3, ES, R2             ; row_off = 0
    LSI R2, 8
    STS R3, ES, R2             ; write/display bank 0
    LSI R2, 4
    LSI R3, 8
    STS R3, ES, R2             ; scroll_x centre
    LSI R2, 6
    LSI R3, 15
    STS R3, ES, R2             ; scroll_y centre

    LDI CAMX
    MOV R2, R0
    LSI R3, 8
    ST R3, R2, 0
    LDI CAMY
    MOV R2, R0
    LSI R3, 15
    ST R3, R2, 0
    LDI FRAMES
    MOV R2, R0
    LDI 48
    MOV R3, R0
    ST R3, R2, 0

demo_loop:
    LDI wait_frame
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; x++: at 16, shift left and reset to the centre.
    LDI CAMX
    MOV R2, R0
    LD R1, R2, 0
    ADD R1, 1
    ST R1, R2, 0
    LDI 16
    MOV R3, R0
    CMP R1, R3
    JN x_ok
    NOP
    LDI shift_left
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI CAMX
    MOV R2, R0
    LSI R3, 8
    ST R3, R2, 0
x_ok:
    LDI CAMX
    MOV R2, R0
    LD R1, R2, 0
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 4
    STS R1, ES, R2

    ; y++: at 31, shift up and reset to the centre.
    LDI CAMY
    MOV R2, R0
    LD R1, R2, 0
    ADD R1, 1
    ST R1, R2, 0
    LDI 31
    MOV R3, R0
    CMP R1, R3
    JN y_ok
    NOP
    LDI shift_up
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI CAMY
    MOV R2, R0
    LSI R3, 15
    ST R3, R2, 0
y_ok:
    LDI CAMY
    MOV R2, R0
    LD R1, R2, 0
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 6
    STS R1, ES, R2

    LDI FRAMES
    MOV R2, R0
    LD R1, R2, 0
    SUB R1, 1
    ST R1, R2, 0
    JNZ demo_loop
    NOP
    HALT
.endif
.endif

; ---------------------------------------------------------------------
; wait_frame - spin until the 60 Hz frame toggle changes.
; ---------------------------------------------------------------------
wait_frame:
    LDI SEG_IO
    MVS ES, R0
    LDI 0x0066
    MOV R2, R0
    LDS R1, ES, R2
    LSI R3, 2
    AND R1, R3
    MOV R5, R1
wf_loop:
    LDS R1, ES, R2
    AND R1, R3
    CMP R1, R5
    JZ wf_loop
    NOP
    JMP LR
    NOP

; ---------------------------------------------------------------------
; shift_left - move the 82x26 map one column left, fill column 81.
;
; The visible centre is columns 1..80, so the new column 81 is hidden after
; the caller resets scroll_x to 8.
; ---------------------------------------------------------------------
shift_left:
    LDI SEG_TILE
    MVS ES, R0
    LDI 0
    MOV R2, R0                 ; dst
    LDI 1
    MOV R3, R0                 ; src
    LDI MAP_ROWS
    MOV R5, R0
sl_row:
    LDI 81
    MOV R4, R0
sl_col:
    LDS R1, ES, R3
    STS R1, ES, R2
    ADD R2, 1
    ADD R3, 1
    SUB R4, 1
    JNZ sl_col
    NOP
    ADD R2, 1                  ; skip the old last column
    ADD R3, 1                  ; next row, column 1
    SUB R5, 1
    JNZ sl_row
    NOP

    ; Fill the new margin column with '#'.
    LSI R3, 1
    SL R3, 15
    LDI 0x0060
    MOV R1, R0
    OR R3, R1
    LDI 81
    MOV R2, R0
    LDI MAP_ROWS
    MOV R4, R0
sl_margin:
    STS R3, ES, R2
    LDI COLS
    ADD R2, R0
    SUB R4, 1
    JNZ sl_margin
    NOP
    JMP LR
    NOP

; ---------------------------------------------------------------------
; shift_up - move the 82x26 map one row up, fill row 25.
;
; Rows 1..25 are contiguous, so the copy is one 2,050-cell run.
; ---------------------------------------------------------------------
shift_up:
    LDI SEG_TILE
    MVS ES, R0
    LDI 0
    MOV R2, R0                 ; dst = row 0
    LDI COLS
    MOV R3, R0                 ; src = row 1
    LDI 2050
    MOV R4, R0
su_copy:
    LDS R1, ES, R3
    STS R1, ES, R2
    ADD R2, 1
    ADD R3, 1
    SUB R4, 1
    JNZ su_copy
    NOP

    LSI R3, 1
    SL R3, 15
    LDI 0x0060
    MOV R1, R0
    OR R3, R1
    LDI 2050
    MOV R2, R0
    LDI COLS
    MOV R4, R0
su_margin:
    STS R3, ES, R2
    ADD R2, 1
    SUB R4, 1
    JNZ su_margin
    NOP
    JMP LR
    NOP
