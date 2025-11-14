; simple_test.asm
; Korrekter Testfall für Deep16

.org 0x0000

start:
    ; Einfache Arithmetik
    LDI 42         ; R0 = 42
    MOV R1, R0, 0  ; R1 = 42
    LSI R2, 10     ; R2 = 10
    
    ADD R3, R1, R2 ; R3 = 52
    SUB R4, R3, 5  ; R4 = 47
    
    ; Einfache Speicherzugriffe - Use R13 instead of SP alias
    ST R3, R13, 0   ; Store to stack (SP = R13)
    LD R5, R13, 0   ; Load from stack
    
    ; Einfache Kontrollfluss
    JMP skip
    LSI R6, 99     ; Wird übersprungen
    
skip:
    LSI R6, 6      ; R6 = 6
    
    ; Zahlmanipulation
    LDI 0x00FF
    MOV R7, R0, 0
    INV R7         ; R7 = 0xFF00 (ones complement)
    NEG R7         ; R7 = 0x0100 (two's complement of 0xFF00)
    
    ; Endlosschleife
loop:
    JMP loop
