; String and Character Demo
; Demonstrates character constants and .text on the FiT tile screen.
;
; A FiT text cell is 0x8000 | (ascii - 0x20). The map has 82 columns
; and 26 rows; its first 80x24 cells are the visible window.

.org 0x0100

main:
    ; Initialize stack
    LDI  -1
    MOV  SP, R0
    SR   SP, 1

    ; Set up ES for screen access
    LDI  0x0FFF
    INV  R0
    MVS  ES, R0
    ; Configure ER=11 and DE=1 via PSW
    LPSW R12
    LDI  0x07FF
    MOV  R2, R0
    AND  R12, R2
    LDI  0x5800      ; Sign-extends to 0xD800 (DE=1, ER=11)
    MOV  R2, R0
    OR   R12, R2
    SPSW R12
    ; Ensure DS points to program data
    LDI  0x0000
    MVS  DS, R0

    ; Clear the complete 82x26 map with blank text cells.
    LDI  0x1000
    MOV  R11, R0
    LDI  2132
    MOV  R2, R0
    LDI  0x2000
    SL   R0, 2
    MOV  R3, R0

clear_loop:
    ST   R3, R11, 0
    ADD  R11, 1
    SUB  R2, 1
    JNZ  clear_loop
    NOP              ; branch delay slot

    ; Start in the middle of the visible window: row 12, column 34. The clear
    ; loop left R11 just past the map, so restart it at the map base first.
    LDI  0x1000
    MOV  R11, R0
    LDI  1018
    ADD  R11, R0

    ; Keep the text-mode bit in R7.
    LDI  0x2000
    SL   R0, 2
    MOV  R7, R0

    ; Write the string from the .text section. .text stores one character per
    ; cell and terminates the string with a zero cell.
    LDI  hello_msg
    MOV  R4, R0

write_loop:
    LD   R5, R4, 0
    OR   R5, R5
    JZ   done
    NOP              ; branch delay slot
    LDI  0x20
    MOV  R2, R0
    SUB  R5, R2        ; ascii - 0x20 is the glyph number
    OR   R5, R7        ; add the text-cell bit
    ST   R5, R11, 0
    ADD  R11, 1
    ADD  R4, 1
    LDI  write_loop
    MOV  PC, R0
    NOP

done:
    HALT

; Data section with strings
.org 0x0200
hello_msg:
    .text "Hello, Deep16!"

prompt_msg:
    .text "Enter name: "

; Individual character constants
.org 0x0300
chars:
    .word 'A', 'B', 'C', '\n', '\0'
