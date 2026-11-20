; pole_board.asm - the on-board timing harness for the Pole renderer.
;
; The program runs the renderer for POLE_FRAMES frames and measures the cost
; with the board's own clocks:
;   * the 32-bit millisecond timer at 0xF0022/0xF0024 (the primary number)
;   * the 16-bit CPU cycle counter at 0xF0068 (the cross-check)
;
; The report goes out over the UART and is drawn into the visible tilemap, so
; the number can be read off the screen as well as off the serial console:
;
;   POLE frames=01024 ms=08300 cyc16=12345 cyc_per_frame=054693 core3=056697
;
; The core3 baseline is 56,697 cycles/frame, measured by scripts/bench_pole.mjs
; on the RTL core with combinational memory. The board number includes the
; PSRAM cache misses, so it is expected to be higher.
;
; The program is a type-4 slice: it is loaded into segment 0x7000 and entered
; at offset 0 with R10:R11 as the far return pair.
;
; Segment layout:
;   0x0000  the slice entry
;   0x0100  pole_entry, the stub the renderer file starts with
;   0x0120  pole_program, the jump into the driver
;   0x0140  pole_state_init
;   0x0180  pole_state_advance
;   0x01A0  the renderer
;   0x0A00  the tables
;   0x04B0  the state block
;   0x04DC  the renderer's scratch cells
;   0x04F0  the band descriptors
;   0x0520  the frame counter and the harness's own cells
;   0x0580  the report strings
;   0x0600  the driver and its helpers
;   0x0C00  the art copy (asm/pole/pole_art.asm)
;   0x1000  the tile art (32 tiles, 1024 words)
;   0x1400  the sprite art (17 groups, 4352 words)
;   0x2500  the palettes (48 words)

.equ SEG_TILE -0x0F00          ; 0xF100: the tilemap
.equ SEG_CTRL -0x0E00          ; 0xF200: the control registers
.equ SEG_IO   -0x1000          ; 0xF000: the MMIO window

; The millisecond timer counts 6750 clocks at 6.75 MHz, so one millisecond is
; 6750 cycles and the cycles per frame are (the delta in ms) * 6750 / the
; frame count. The frame count is a power of two, so the division is a shift.
.ifdef POLE_FAST
    .equ POLE_FRAMES 64
    .equ POLE_SHIFT 6
    .equ POLE_SHIFT2 10
    .equ POLE_MASK 0x003F
.else
    .equ POLE_FRAMES 1024
    .equ POLE_SHIFT 10
    .equ POLE_SHIFT2 6
    .equ POLE_MASK 0x03FF
.endif

; The report row: the first road row is six, so the top of the screen is sky.
.equ REPORT_ROW 1

; ---------------------------------------------------------------------------
; The slice entry. The slice runs in its own segment, so DS has to follow CS,
; and the far return pair has to be parked somewhere the helpers do not use.
; ---------------------------------------------------------------------------
.org 0
pole_start:
    MVS R0, CS
    MVS DS, R0                  ; the slice's own segment
    LDI POLE_RET10
    MOV R2, R0
    ST R10, R2, 0
    LDI POLE_RET11
    MOV R2, R0
    ST R11, R2, 0
    LDI pole_program
    MOV PC, R0
    NOP

; ---------------------------------------------------------------------------
; pole_program: the renderer file's stub jumps here.
; ---------------------------------------------------------------------------
.org 0x0120
pole_program:
    LDI board_main
    MOV PC, R0
    NOP

; ---------------------------------------------------------------------------
; The harness's cells. They are all written to zero here, because the slice
; loader fills the gaps of the image with 0xFFFF.
; ---------------------------------------------------------------------------
.org 0x0520
ST_FRAMES:
    .word POLE_FRAMES            ; the frames left to render
B_LR:
    .word 0                      ; report_char's return address
B_LR2:
    .word 0                      ; emit_dec's and emit_str's return address
B_LR3:
    .word 0                      ; emit_num5's return address
B_MS0_LO:
    .word 0                      ; the timer at the start, low
B_MS0_HI:
    .word 0                      ; the timer at the start, high
B_CYC0:
    .word 0                      ; the cycle counter at the start
B_MS_LO:
    .word 0                      ; the millisecond delta, low
B_MS_HI:
    .word 0                      ; the millisecond delta, high
B_CYC:
    .word 0                      ; the cycle counter delta
B_QHI:
    .word 0                      ; the cycles per frame, high word
B_QLO:
    .word 0                      ; the cycles per frame, low word
B_COL:
    .word 0                      ; the report's screen column
DEC5_TBL:
    .word 10000, 1000, 100, 10, 1
POLE_RET10:
    .word 0                      ; the far return pair
POLE_RET11:
    .word 0
B_LR4:
    .word 0                      ; print_dec32's return address
DEC10K:
    .word 10000                 ; the divisor the 32-bit printer counts
DEC4_TBL:
    .word 1000, 100, 10, 1

; ---------------------------------------------------------------------------
; The report strings. One character per cell, so a string is a NUL-terminated
; run of words that the UART and the screen helpers walk.
; ---------------------------------------------------------------------------
.org 0x0580
str_pole:
    .text "POLE "
.ifdef POLE_FAST
.org 0x0586
str_frames:
    .text "frames=00064 "
.else
.org 0x0586
str_frames:
    .text "frames=01024 "
.endif
.org 0x0594
str_ms:
    .text "ms="
.org 0x0598
str_cyc16:
    .text " cyc16="
.org 0x05A0
str_cpf:
    .text " cyc_per_frame="
.org 0x05B0
str_core3:
    .text " core3=056697"

; ---------------------------------------------------------------------------
; The driver.
; ---------------------------------------------------------------------------
.org 0x0600
board_main:
    ; ---- the art ---------------------------------------------------------
    ; The tile, sprite and palette banks are shared with the other games, so
    ; the slice copies its own art in before the first frame. The copy is
    ; outside the measured loop.
    LDI pole_art_copy
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; ---- the state ------------------------------------------------------
    LDI pole_state_init
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; ---- the clocks at the start -----------------------------------------
    LDI SEG_IO
    MVS ES, R0
    LDI 0x0022
    MOV R2, R0
    LDS R3, ES, R2              ; the millisecond timer, low half
    LDI 0x0024
    MOV R2, R0
    LDS R4, ES, R2              ; the millisecond timer, high half
    LDI B_MS0_LO
    MOV R2, R0
    ST R3, R2, 0
    LDI B_MS0_HI
    MOV R2, R0
    ST R4, R2, 0
    LDI 0x0068
    MOV R2, R0
    LDS R3, ES, R2              ; the cycle counter
    LDI B_CYC0
    MOV R2, R0
    ST R3, R2, 0

    ; ---- the frame loop --------------------------------------------------
    ; The state advance and the renderer are the same work the core3
    ; benchmark measures, so the board number is directly comparable.
    ; The frame counter lives in memory: the renderer uses every register.
board_loop:
    LDI pole_state_advance
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pole_dirty_prepare
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pole_render
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI ST_FRAMES
    MOV R2, R0
    LD R3, R2, 0
    SUB R3, 1
    ST R3, R2, 0
    CMP R3, 0
    JNZ board_loop
    NOP

    ; ---- the clocks at the end -------------------------------------------
    LDI SEG_IO
    MVS ES, R0
    LDI 0x0022
    MOV R2, R0
    LDS R3, ES, R2              ; the millisecond timer, low half
    LDI 0x0024
    MOV R2, R0
    LDS R4, ES, R2              ; the millisecond timer, high half
    LDI B_MS0_LO
    MOV R2, R0
    LD R5, R2, 0                ; the low half at the start
    LDI B_MS0_HI
    MOV R2, R0
    LD R6, R2, 0                ; the high half at the start
    ; the delta: a borrow out of the low half takes one from the high half
    ; (the high difference is the current high minus the start high, less the
    ; borrow the low half produced).
    CMP R3, R5
    JNC bm_no_borrow
    NOP
    SUB R4, 1
bm_no_borrow:
    SUB R4, R6                  ; the high half of the delta
    SUB R3, R5                  ; the low half of the delta
    LDI B_MS_LO
    MOV R2, R0
    ST R3, R2, 0
    LDI B_MS_HI
    MOV R2, R0
    ST R4, R2, 0

    ; the cycle counter delta: the low half only, so it wraps at 65536
    LDI 0x0068
    MOV R2, R0
    LDS R3, ES, R2
    LDI B_CYC0
    MOV R2, R0
    LD R5, R2, 0
    SUB R3, R5
    LDI B_CYC
    MOV R2, R0
    ST R3, R2, 0

    ; ---- the cycles per frame --------------------------------------------
    ; Q = (the millisecond delta * 6750) >> POLE_SHIFT, as a 32-bit value.
    ; The delta is 32 bits, so it is split: the low half gives the cycles of
    ; (L * 6750) >> POLE_SHIFT, and the high half gives the rest, (H <<
    ; (16 - POLE_SHIFT)) * 6750. The split is exact because 65536 * 6750 is
    ; a multiple of the shift, so nothing is lost between the two halves.
    ; H << (16 - POLE_SHIFT) has to fit in a register, which holds as long as
    ; the run is shorter than 65536 * 2^POLE_SHIFT milliseconds.
    ; R6:R7 = the high/low words of Q
    LDI B_MS_LO
    MOV R2, R0
    LD R4, R2, 0                ; L: the low half of the millisecond delta
    LDI 6750
    MOV R3, R0
    MUL32 R4, R3                ; R4 = the high word, R5 = the low word
    MOV R6, R4
    SR R6, POLE_SHIFT           ; the high word of Q1
    MOV R7, R4
    LDI POLE_MASK
    AND R7, R0
    SL R7, POLE_SHIFT2
    MOV R8, R5
    SR R8, POLE_SHIFT
    OR R7, R8                   ; the low word of Q1
    ; the high half of the delta
    LDI B_MS_HI
    MOV R2, R0
    LD R8, R2, 0                ; H
    SL R8, POLE_SHIFT2          ; H << (16 - POLE_SHIFT)
    LDI 6750
    MOV R9, R0
    MUL32 R8, R9                ; R8 = the high word, R9 = the low word
    ; Q = Q1 + (R8:R9)
    ADD R7, R9
    JC q_carry
    NOP
    ADD R6, R8
    CMP R9, R9
    JZ q_done
    NOP
q_carry:
    ADD R6, R8
    ADD R6, 1
q_done:
    LDI B_QHI
    MOV R2, R0
    ST R6, R2, 0
    LDI B_QLO
    MOV R2, R0
    ST R7, R2, 0

    ; ---- the report ------------------------------------------------------
    ; The text goes into the bank that is on the screen, so it is visible.
    LDI ST_BANK
    MOV R2, R0
    LD R3, R2, 0
    MOV R4, R3
    SL R4, 1
    ADD R3, R4                  ; three times the bank: write and display
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 8
    STS R3, ES, R2
    ; the report starts in the first column
    LDI B_COL
    MOV R2, R0
    LDI 0
    ST R0, R2, 0

    ; A non-zero millisecond high half means the run was longer than 65.5
    ; seconds: mark the line. The numbers below are still exact.
    LDI B_MS_HI
    MOV R2, R0
    LD R3, R2, 0
    CMP R3, 0
    JZ bm_text
    NOP
    LDI 33
    MOV R1, R0
    LDI report_char
    MOV R2, R0
    LINK
    JMP R2
    NOP
bm_text:
    LDI str_pole
    MOV R9, R0
    LDI emit_str
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI str_frames
    MOV R9, R0
    LDI emit_str
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI str_ms
    MOV R9, R0
    LDI emit_str
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; the millisecond delta: the whole 32-bit value
    LDI B_MS_HI
    MOV R2, R0
    LD R4, R2, 0
    LDI B_MS_LO
    MOV R2, R0
    LD R5, R2, 0
    LDI print_dec32
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI str_cyc16
    MOV R9, R0
    LDI emit_str
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI B_CYC
    MOV R2, R0
    LD R1, R2, 0
    LDI emit_num5
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI str_cpf
    MOV R9, R0
    LDI emit_str
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; the cycles per frame: the whole 32-bit value, so a board slower than
    ; the core3 (and slower than 65535 cycles) still prints its own number
    LDI B_QHI
    MOV R2, R0
    LD R4, R2, 0
    LDI B_QLO
    MOV R2, R0
    LD R5, R2, 0
    LDI print_dec32
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI str_core3
    MOV R9, R0
    LDI emit_str
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; the newline goes to the UART only
    LDI 10
    MOV R1, R0
    LDI report_char
    MOV R2, R0
    LINK
    JMP R2
    NOP

    ; ---- back to the caller ----------------------------------------------
    LDI POLE_RET10
    MOV R2, R0
    LD R10, R2, 0
    LDI POLE_RET11
    MOV R2, R0
    LD R11, R2, 0
    JML R10
    NOP

; ---------------------------------------------------------------------------
; report_char: R1 = the character.
; Sends the byte to the UART and draws it into the visible tilemap. The
; screen column lives in B_COL, so the helpers do not have to keep it.
; Only the printable characters are drawn; the newline is for the UART.
; ---------------------------------------------------------------------------
report_char:
    LDI B_LR
    MOV R2, R0
    ST LR, R2, 0
    ; ---- the UART --------------------------------------------------------
    LDI SEG_IO
    MVS ES, R0
    LDI 0x0040
    MOV R2, R0
rc_wait:
    LDS R3, ES, R2              ; the console status
    LDI 2
    AND R3, R0                  ; bit 1: the transmitter is ready
    JZ rc_wait
    NOP
    LDI 0x0042
    MOV R2, R0
    STS R1, ES, R2              ; send the byte
    ; ---- the screen ------------------------------------------------------
    LDI 0x20
    CMP R1, R0
    JNC rc_draw
    NOP
    CMP R9, R9                  ; not printable: the UART only
    JZ rc_done
    NOP
rc_draw:
    ; the cell index = the row * 82 + the column
    LDI B_COL
    MOV R2, R0
    LD R3, R2, 0
    LDI REPORT_ROW
    MOV R4, R0
    SL R4, 6
    ADD R3, R4
    MOV R4, R0
    SL R4, 4
    ADD R3, R4
    MOV R4, R0
    SL R4, 1
    ADD R3, R4
    ; the cell word = 0x8000 | ((the character - 0x20) << 5)
    LDI 0x20
    MOV R4, R0
    SUB R1, R4
    SL R1, 5
    LSI R5, 1
    SL R5, 15
    OR R1, R5
    LDI SEG_TILE
    MVS ES, R0
    STS R1, ES, R3
    ; the next column
    LDI B_COL
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0
rc_done:
    LDI B_LR
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; emit_str: R9 = the address in DS of a NUL-terminated string.
; ---------------------------------------------------------------------------
emit_str:
    LDI B_LR2
    MOV R2, R0
    ST LR, R2, 0
es_loop:
    LDS R1, DS, R9
    AND R1, R1
    JZ es_done
    NOP
    LDI report_char
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ADD R9, 1
    LDI es_loop
    MOV PC, R0
    NOP
es_done:
    LDI B_LR2
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; emit_dec: print a number in decimal.
;   R7  the value
;   R8  the number of digits
;   R9  the address in DS of the divisor table
;   R10 1: always print a digit, 0: skip the leading zeros
; The value is taken apart by repeated subtraction, so there is no divide.
; ---------------------------------------------------------------------------
emit_dec:
    LDI B_LR2
    MOV R2, R0
    ST LR, R2, 0
ed_loop:
    LD R3, R9, 0                ; the divisor
    LDI 0
    MOV R4, R0                  ; the digit
    LDI 10
    MOV R5, R0
ed_sub:
    CMP R7, R3
    JC ed_digit                 ; a borrow: the value is below the divisor
    NOP
    SUB R7, R3
    ADD R4, 1
    CMP R4, R5
    JNZ ed_sub
    NOP
ed_digit:
    CMP R4, 0
    JNZ ed_print
    NOP
    CMP R10, 0
    JNZ ed_print
    NOP
    CMP R11, 0
    JZ ed_next
    NOP
ed_print:
    LDI 48
    ADD R4, R0                  ; '0' + the digit
    MOV R1, R4
    LDI report_char
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 1
    MOV R11, R0                 ; a digit has been printed
ed_next:
    ADD R9, 1
    SUB R8, 1
    CMP R8, 0
    JNZ ed_loop
    NOP
    LDI B_LR2
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; emit_num5: R1 = the value. Five digits, zero padded.
; ---------------------------------------------------------------------------
emit_num5:
    LDI B_LR3
    MOV R2, R0
    ST LR, R2, 0
    MOV R7, R1
    LDI 5
    MOV R8, R0
    LDI DEC5_TBL
    MOV R9, R0
    LDI 1
    MOV R10, R0                 ; always print
    LDI 0
    MOV R11, R0
    LDI emit_dec
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI B_LR3
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; emit_num5u: R1 = the value. Five digits, the leading zeros skipped.
; ---------------------------------------------------------------------------
emit_num5u:
    LDI B_LR3
    MOV R2, R0
    ST LR, R2, 0
    MOV R7, R1
    LDI 5
    MOV R8, R0
    LDI DEC5_TBL
    MOV R9, R0
    LDI 0
    MOV R10, R0                 ; skip the leading zeros
    LDI 0
    MOV R11, R0
    LDI emit_dec
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI B_LR3
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; emit_num4: R1 = the value. Four digits, zero padded.
; ---------------------------------------------------------------------------
emit_num4:
    LDI B_LR3
    MOV R2, R0
    ST LR, R2, 0
    MOV R7, R1
    LDI 4
    MOV R8, R0
    LDI DEC4_TBL
    MOV R9, R0
    LDI 1
    MOV R10, R0                 ; always print
    LDI 0
    MOV R11, R0
    LDI emit_dec
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI B_LR3
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; ---------------------------------------------------------------------------
; print_dec32: R4:R5 = the 32-bit value. Prints it in decimal.
;
; The value is taken apart by repeated subtraction, so there is no divide.
; The ten-thousands are counted first and the rest follows in four digits, so
; the two pieces make the exact decimal number: 70000 is a count of 7 and a
; rest of 0000. The count has to fit in a register, which holds for every
; value below 655,360,000; a larger value would print a wrong rest.
; ---------------------------------------------------------------------------
print_dec32:
    LDI B_LR4
    MOV R2, R0
    ST LR, R2, 0
    ; the count of the ten-thousands
    LDI 0
    MOV R6, R0
    LDI -1
    MOV R13, R0                 ; the count limit (65535)
pd32_count:
    ; is the value at least 10000?
    CMP R4, 0
    JNZ pd32_sub                ; the high word is not 0: at least 65536
    NOP
    ; the high word is 0: the value reaches 10000 at a low word of 10000
    LDI DEC10K
    MOV R2, R0
    LD R7, R2, 0
    CMP R5, R7
    JC pd32_rest                ; the low word is below 10000
    NOP
pd32_sub:
    ; the value -= 10000
    LDI DEC10K
    MOV R2, R0
    LD R7, R2, 0
    CMP R5, R7
    JC pd32_borrow              ; the low word is below 10000: it borrows
    NOP
    SUB R5, R7
    CMP R9, R9
    JZ pd32_next
    NOP
pd32_borrow:
    SUB R5, R7                  ; the low word wraps around
    SUB R4, 1                   ; and the high word takes the borrow
pd32_next:
    ADD R6, 1
    CMP R6, R13
    JNZ pd32_count
    NOP
pd32_rest:
    ; the count, then the rest in four digits. The helpers use R1-R5 and
    ; R7-R11, so the rest is parked in R12 first.
    MOV R12, R5
    MOV R1, R6
    LDI emit_num5u
    MOV R2, R0
    LINK
    JMP R2
    NOP
    MOV R1, R12
    LDI emit_num4
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI B_LR4
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP
