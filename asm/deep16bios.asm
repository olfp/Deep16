; =============================================
; BIOS Implementation (at physical 0xF8000)
; =============================================
.org 0xF8000
.equ BIOS_BASE 0xF8000
.equ KBD_STATUS 0x0060
.equ KBD_DATA   0x0062
.code
bios_entry:
    ; Establish safe environment
    LDI 0
    MOV R2, R0
    MVS DS, R2      ; DS = 0x0000 (RAM) for variables

    ; Dispatch on function code stored in R0
    ; Arguments in R1
    LDI 0
    CMP R0, R0
    JNZ bios_f1
    ; 0: bver -> R0 = 0x0001 (version 0.1)
    LDI 0x0001
    RETI
    NOP
bios_f1:
    LDI 1
    CMP R0, R0
    JNZ bios_f2
    ; 1: binit -> init screen/keyboard, clear screen
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    
    ; Initialize SCR pointer in memory (at 0x00A0)
    LDI 0x00A0
    MOV R2, R0
    LDI 0x1000
    ST R0, R2, 0    ; [0x00A0] = 0x1000
    
    ; Clear 80*25 to ' '
    ; Use R9 as SCR (loaded from memory)
    LDI 0x1000
    MOV R9, R0      ; SCR = 0x1000
    
    LDI 2000
    MOV R2, R0
    LDI 0x20        ; ' '
    MOV R3, R0
bios_clr_loop:
    STS R3, ES, R9
    ADD R9, 1
    SUB R2, 1
    JNZ bios_clr_loop
    NOP
    ; Place cursor at start (0x1000)
    ; Update memory SCR
    LDI 0x00A0
    MOV R2, R0
    LDI 0x1000
    MOV R9, R0
    ST R9, R2, 0
    
    ; Show cursor
    LSI R0, 1
    SL  R0, 15
    LDS R1, ES, R9
    OR  R1, R0
    STS R1, ES, R9
    RETI
    NOP
bios_f2:
    LDI 2
    CMP R0, R0
    JNZ bios_f3
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 2: putch (char from R5)
    MOV R8, R5          ; R8=char (Preserved for bios_putch_core)
    MOV R14, PC         ; Link (stores PC of next instr)
    ADD R14, 6          ; Skip call sequence (JNZ+NOP)
    JNZ bios_putch_core
    NOP                 ; Delay slot
    RETI
    NOP

bios_putch_core:
    ; Input: R8 (char)
    ; Uses: R2, R6, R9(SCR), R10-R12
    
    ; Load SCR from [0x00A0] into R9
    LDI 0x00A0
    MOV R2, R0
    LD R9, R2, 0
    
    MOV R2, R8
    LDI 10
    CMP R2, R0
    JZ bios_putch_lf
    LDI 13
    CMP R2, R0
    JZ bios_putch_cr
    ; regular character
    MOV R10, R8         ; char
    LDI 0x00FF
    AND R10, R0         ; char only (0x00XX)
    LDI 0x0F00
    OR R10, R0          ; Combine with attribute
    
    STS R10, ES, R9     ; Write to screen [ES:SCR]
    
    ADD R9, 1
    LSI R1, 1
    SL  R1, 15
    LDS R3, ES, R9
    OR  R3, R1
    STS R3, ES, R9
    
    ; Save SCR and Return
    LDI 0x00A0
    MOV R2, R0
    ST R9, R2, 0
    MOV PC, R14
    NOP

bios_putch_cr:
    LDI 0x1000
    MOV R10, R0
    MOV R11, R9     ; SCR copy
    SUB R11, R10    ; offset
    LDI 80
    MOV R12, R0
    DIV R11, R12
    MUL R11, R12
    ADD R10, R11    ; New SCR
    MOV R9, R10
    
    ; Save SCR and Return
    LDI 0x00A0
    MOV R2, R0
    ST R9, R2, 0
    MOV PC, R14
    NOP

bios_putch_lf:
    LDI 0x1000
    MOV R10, R0     ; Base
    MOV R11, R9     ; SCR
    SUB R11, R10    ; Offset
    LDI 80
    MOV R12, R0
    MOV R6, R11     ; Save Offset
    DIV R11, R12    ; Row
    MOV R2, R11     ; Row copy
    MUL R2, R12     ; Row * 80
    SUB R6, R2      ; Col = Offset - (Row*80)
    
    LDI 24
    CMP R11, R0
    JZ bios_scroll
    
    LDI 80
    ADD R9, R0
    
    ; Save SCR and Return
    LDI 0x00A0
    MOV R2, R0
    ST R9, R2, 0
    MOV PC, R14
    NOP

bios_scroll:
    ; Scroll up
    ; Uses R10 (dest), R11 (src), R12 (count)
    LDI 0x1000
    MOV R10, R0     ; Dest = 0x1000
    LDI 80
    MOV R11, R0
    ADD R11, R10    ; Src = 0x1000 + 80
    LDI 1920
    MOV R12, R0     ; Count
bios_scroll_loop:
    LDS R1, ES, R11
    STS R1, ES, R10
    ADD R10, 1
    ADD R11, 1
    SUB R12, 1
    JNZ bios_scroll_loop
    NOP
    
    ; Clear last line
    LDI 80
    MOV R12, R0
    LDI ' '
    MOV R2, R0
bios_scroll_clr:
    STS R2, ES, R10
    ADD R10, 1
    SUB R12, 1
    JNZ bios_scroll_clr
    NOP
    
    ; New SCR = Base + 1920 + Col (R6)
    LDI 0x1000
    MOV R10, R0
    LDI 1920
    ADD R10, R0
    ADD R10, R6
    MOV R9, R10
    
    ; Save SCR and Return
    LDI 0x00A0
    MOV R2, R0
    ST R9, R2, 0
    MOV PC, R14
    NOP

bios_f3:
    LDI 3
    CMP R0, R0
    JNZ bios_f4
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 3: putstr (address in R5, null-terminated)
    MOV R7, R5          ; Use R7 for pointer
bios_putstr_loop:
    LD R1, R7, 0
    ; High Byte
    MOV R3, R1
    SR R3, 8
    LDI 0x00FF
    AND R3, R0
    JZ bios_putstr_done
    
    MOV R8, R3
    MOV R14, PC
    ADD R14, 6          ; Skip call sequence (JNZ+NOP)
    JNZ bios_putch_core
    NOP                 ; Delay slot
    NOP                 ; Delay slot
    
    ; Low Byte
    LD R1, R7, 0        ; Reload R1 as putch clobbers it
    MOV R3, R1
    LDI 0x00FF
    AND R3, R0
    JZ bios_putstr_done
    
    MOV R8, R3
    MOV R14, PC
    ADD R14, 6          ; Skip call sequence (JNZ+NOP)
    JNZ bios_putch_core
    NOP                 ; Delay slot
    NOP                 ; Delay slot
    
    ADD R7, 1
    CLRZ
    JNZ bios_putstr_loop
    NOP
bios_putstr_done:
    RETI
    NOP
bios_f4:
    LDI 4
    CMP R0, R0
    JNZ bios_f5
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 4: getch -> R4 = keycode (low byte)
bios_getch_wait:
    LDI KBD_STATUS
    MOV R2, R0
    LDS R1, ES, R2
    LDI 0
    CMP R1, R0
    JZ bios_getch_wait
    LDI KBD_DATA
    MOV R2, R0
    LDS R1, ES, R2
    LDI 0x00FF
    AND R1, R0
    ; Return in R0
    MOV R0, R1
    RETI
    NOP
bios_f5:
    LDI 5
    CMP R0, R0
    JNZ bios_unknown
    ; 5: getstr (buffer addr in R5), echo
    MOV R2, R5       ; buf
    LDI 0
    MOV R11, R0      ; count
    MOV R12, R0      ; word accumulator
    MOV R13, R0      ; toggle (0=High, 1=Low)
    
    ; Set ES = 0xF000 for KBD and Screen
    LDI 0x0FFF
    INV R0
    MVS ES, R0

bios_getstr_loop:
    LDI KBD_STATUS
    MOV R6, R0
    LDS R1, ES, R6
    LDI 0
    CMP R1, R0
    JZ bios_getstr_loop
    
    LDI KBD_DATA
    MOV R6, R0
    LDS R1, ES, R6
    LDI 0x00FF
    AND R1, R0
    
    ; Check special keys
    LDI 10
    CMP R1, R0
    JZ bios_getstr_done
    LDI 13
    CMP R1, R0
    JZ bios_getstr_done
    LDI 8
    CMP R1, R0
    JZ bios_backspace
    
    ; Store Char Logic
    LDI 0
    CMP R13, R0
    JNZ bios_store_low
    
    ; Store High
    MOV R12, R1
    SL R12, 8
    LDI 1
    MOV R13, R0
    
    JNZ bios_echo_char

bios_store_low:
    OR R12, R1
    ST R12, R2, 0
    ADD R2, 1
    LDI 0
    MOV R13, R0
    MOV R12, R0
    
bios_echo_char:
    ADD R11, 1
    ; Echo logic
    ; Load SCR from memory [0x00A0] to R9
    LDI 0x00A0
    MOV R2, R0      ; Use R2 as temp pointer (instead of R6)
    LD R9, R2, 0
    
    ; Write Char (R1) to Screen
    MOV R7, R1
    LDI 0x0F00
    OR R7, R0       ; Combine with attribute
    STS R7, ES, R9
    
    ; Advance Cursor
    ADD R9, 1
    
    ; Show cursor at new position
    LSI R0, 1
    SL  R0, 15
    LDS R7, ES, R9
    OR  R7, R0
    STS R7, ES, R9
    
    ; Save SCR back to memory - reload R6 to ensure it's correct
    LDI 0x00A0
    MOV R6, R0
    ST R9, R6, 0
    
    JNZ bios_getstr_loop

bios_backspace:
    LDI 0
    CMP R11, R0
    JZ bios_getstr_loop
    
    SUB R11, 1
    
    ; Load SCR from memory [0x00A0] to R9
    LDI 0x00A0
    MOV R6, R0
    LD R9, R6, 0
    
    SUB R9, 1
    
    ; Clear char (Space)
    LDI 0x0F20
    MOV R7, R0
    STS R7, ES, R9
    
    ; Show cursor
    LSI R0, 1
    SL  R0, 15
    LDS R7, ES, R9
    OR  R7, R0
    STS R7, ES, R9
    
    ; Save SCR back to memory
    LDI 0x00A0
    MOV R6, R0
    ST R9, R6, 0
    
    ; Backspace storage logic
    LDI 0
    CMP R13, R0
    JNZ bios_back_low
    
    ; Back High (was 0, waiting for High -> remove Low of prev word)
    SUB R2, 1
    LD R12, R2, 0
    LDI 0x00FF
    INV R0
    AND R12, R0
    LDI 1
    MOV R13, R0
    
    JNZ bios_getstr_loop
    
bios_back_low:
    ; Back Low (was 1, waiting for Low -> remove High of curr word)
    LDI 0
    MOV R13, R0
    MOV R12, R0
    
    JNZ bios_getstr_loop

bios_getstr_done:
    ; Terminate
    LDI 0
    CMP R13, R0
    JZ bios_term_aligned
    ; Pending High
    ST R12, R2, 0  ; Low byte is 0
    RETI
bios_term_aligned:
    LDI 0
    ST R0, R2, 0
    RETI
    RETI
    NOP
bios_unknown:
    RETI
    NOP
