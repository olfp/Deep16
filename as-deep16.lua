; simple_test.asm
; Minimaler Testfall - OHNE ECKIGE KLAMMERN

.org 0x0000

start:
    ; Einfache Arithmetik
    LDI 42         ; R0 = 42
    MOV R1, R0, 0  ; R1 = 42
    LSI R2, 10     ; R2 = 10
    
    ADD R3, R1, R2 ; R3 = 52
    SUB R4, R3, 5  ; R4 = 47
    
    ; Einfache Speicherzugriffe - NEUE SYNTAX OHNE []
    ST R3, SP, 0   ; Store to stack
    LD R5, SP, 0   ; Load from stack
    
    ; Einfache Kontrollfluss
    JMP skip
    LSI R6, 99     ; Wird übersprungen
    
skip:
    LSI R6, 66     ; R6 = 66
    
    ; Zahlmanipulation
    LDI 0x00FF
    MOV R7, R0, 0
    INV R7         ; R7 = 0xFF00
    NEG R7         ; R7 = 0x0100
    
    ; Endlosschleife
loop:
    JMP loop
