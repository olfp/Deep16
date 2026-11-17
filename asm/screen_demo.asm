; Deep16 Screen Demo
; Write text cells to the FiT tile map at ES:0x1000 (physical 0xF1000).
;
; A FiT text cell is 0x8000 | ((ascii - 0x20) << 5). The map has 82 columns
; and 26 rows; its first 80x24 cells are the visible window.

.org 0x0100    ; Home Segment - Code starts here

main:
    ; Initialize stack pointer
    LSI  SP, -1      ; R0 = 0xFFFF (sign-extended)
    SR   SP, 1       ; SP = 0x7FFF

    ; Configure Extra Segment for I/O access
    ; Set ES = 0xF000 to access I/O segment (0xF0000-0xFFFFF)
    ; 0xF000 is too large for LDI, so use bit manipulation:
    LDI  0x0FFF      ; R0 = 0x0FFF
    INV  R0          ; R0 = 0xF000 (invert all bits)
    MVS  ES, R0      ; ES = 0xF000

    ; Configure dual registers for ES (ER=11, DE=1) using PSW sequence
    ; Clear ER/DE, then set ER=11 (0xB) and DE=1
    LPSW R12
    LDI  0x07FF
    AND  R12, R0
    LDI  0x5800      ; Sign-extends to 0xD800 at runtime (DE=1, ER=11)
    OR   R12, R0
    SPSW R12

    ; Clear the complete 82x26 map with blank text cells. Glyph zero is the
    ; space, and bit 15 marks the cell as text rather than tile art.
    LDI  0x1000      ; R0 = screen offset in ES (0x1000)
    MOV  R11, R0     ; R11 = current address pointer
    LDI  2132        ; 82 * 26 cells
    MOV  R2, R0
    LDI  0x2000
    SL   R0, 2       ; R0 = 0x8000, the text-cell bit
    MOV  R3, R0      ; blank text cell

clear_loop:
    ST   R3, R11, 0
    ADD  R11, 1
    SUB  R2, 1
    JNZ  clear_loop
    NOP              ; branch delay slot

    ; Write "HELLO DEEP16!" in the middle of the visible window. The old
    ; text-screen position was row 12, column 34; the tile map's extra two
    ; columns make its flat offset 12 * 82 + 34. The clear loop left R11 just
    ; past the map, so restart it at the map base before adding the offset.
    LDI  0x1000
    MOV  R11, R0
    LDI  1018
    ADD  R11, R0

    ; Keep the text-mode bit in R7. Character conversion is done by put_char.
    LDI  0x2000
    SL   R0, 2
    MOV  R7, R0

    LDI  'H'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  'E'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  'L'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  'L'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  'O'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  ' '
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  'D'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  'E'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  'E'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  'P'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  '1'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  '6'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    LDI  '!'
    MOV  R1, R0
    LDI  put_char
    MOV  R4, R0
    LINK
    JMP  R4
    NOP

    HALT

; put_char converts the character in R1 and stores it at the tile-map pointer
; in R11, then advances that pointer by one cell.
put_char:
    LDI  0x20
    MOV  R2, R0
    SUB  R1, R2        ; ascii - 0x20
    SL   R1, 5         ; glyph number * 32
    OR   R1, R7        ; add the text-cell bit
    ST   R1, R11, 0
    ADD  R11, 1
    JMP  LR
    NOP
