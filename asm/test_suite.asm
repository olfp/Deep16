
; Deep16 Comprehensive Test Suite
.org 0x0100
.code
    ; Initialize Result Pointer R14 to 0x2000
    LDI 0x20
    MOV R14, R0
    SL R14, 8     
    ; R14 now holds 0x2000. 
    ; We will store results sequentially starting from here.

    ; -- Test 1: ADD Reg-Reg --

    LDI 4660
    MOV R2, R0
    LDI 17
    MOV R3, R0
    ADD R2, R3
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 2: SUB Reg-Reg --

    LDI 4660
    MOV R2, R0
    LDI 17
    MOV R3, R0
    SUB R2, R3
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 3: AND Reg-Reg --

    LDI 4660
    MOV R2, R0
    LDI 17
    MOV R3, R0
    AND R2, R3
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 4: OR Reg-Reg --

    LDI 4660
    MOV R2, R0
    LDI 17
    MOV R3, R0
    OR R2, R3
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 5: XOR Reg-Reg --

    LDI 4660
    MOV R2, R0
    LDI 17
    MOV R3, R0
    XOR R2, R3
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 6: ADD Reg-Imm4 --

    LDI 4660
    MOV R2, R0
    ADD R2, 5
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 7: SUB Reg-Imm4 --

    LDI 4660
    MOV R2, R0
    SUB R2, 5
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 8: AND Reg-Imm4 --

    LDI 4660
    MOV R2, R0
    AND R2, 5
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 9: OR Reg-Imm4 --

    LDI 4660
    MOV R2, R0
    OR R2, 5
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 10: XOR Reg-Imm4 --

    LDI 4660
    MOV R2, R0
    XOR R2, 5
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 11: MUL Reg-Reg --

    LDI 100
    MOV R2, R0
    LDI 200
    MOV R3, R0
    MUL R2, R3
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 12: MUL32 Reg-Reg (High) --

    LDI 1000
    MOV R3, R0
    LDI 2000
    MOV R2, R0
    MUL32 R3, R2
    MOV R1, R3
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 13: MUL32 Reg-Reg (Low) --

    LDI 1000
    MOV R3, R0
    LDI 2000
    MOV R2, R0
    MUL32 R3, R2
    MOV R1, R4
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 14: DIV Reg-Reg --

    
    LDI 78
    MOV R2, R0
    SL R2, 8
    LDI 32
    OR R2, R0
    LDI 100
    MOV R3, R0
    DIV R2, R3
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 15: DIV32 Reg-Reg (Quotient) --

    LDI 18
    MOV R3, R0 ; High
    LDI 13398
    MOV R4, R0 ; Low
    LDI 256
    MOV R2, R0 ; Divisor
    DIV32 R3, R2
    MOV R1, R3
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 16: DIV32 Reg-Reg (Remainder) --

    LDI 18
    MOV R3, R0 ; High
    LDI 13398
    MOV R4, R0 ; Low
    LDI 256
    MOV R2, R0 ; Divisor
    DIV32 R3, R2
    MOV R1, R4
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 17: SL Count=4 --

    LDI 1
    MOV R2, R0
    SL R2, 4
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 18: SR Count=4 --

    LDI 16
    MOV R2, R0
    SR R2, 4
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 19: ROL Count=1 --

    
    LDI 128
    MOV R2, R0
    SL R2, 8
    LDI 0
    OR R2, R0
    ROL R2, 1
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 20: ROR Count=1 --

    LDI 1
    MOV R2, R0
    ROR R2, 1
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 21: SRA Count=4 --

    
    LDI 240
    MOV R2, R0
    SL R2, 8
    LDI 0
    OR R2, R0
    SRA R2, 4
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 22: INV --

    
    LDI 170
    MOV R2, R0
    SL R2, 8
    LDI 170
    OR R2, R0
    INV R2
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 23: NEG --

    LDI 1
    MOV R2, R0
    NEG R2
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; Setup Base R12 = 0x3000
    LDI 0x30
    MOV R12, R0
    SL R12, 8

    ; -- Test 24: ST/LD Base+Offset --

    
    LDI 250
    MOV R2, R0
    SL R2, 8
    LDI 206
    OR R2, R0
    ST R2, [R12+4]
    LD R3, [R12+4]
    MOV R1, R3
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 25: LSI --
    LSI R2, 10
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 26: SWB --

    LDI 4660
    MOV R2, R0
    SWB R2
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    LDI 0x70
    MOV SP, R0
    SL SP, 8

    ; -- Test 27: STS/LDS --

    
    LDI 190
    MOV R2, R0
    SL R2, 8
    LDI 239
    OR R2, R0
    STS R2, SS, SP
    LDS R3, SS, SP
    MOV R1, R3
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 28: JZ Taken (Z=1) --

    LDI 1
    MOV R2, R0
    LDI 0
    CMP R2, R2 ; Z=1
    JZ .jz_target_28
    LDI 0
    MOV R2, R0
    LDI .jz_end_28
    MOV PC, R0
.jz_target_28:
    LDI 1
    MOV R2, R0
.jz_end_28:
    NOP
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 29: JC Taken (C=1) --

    
    LDI 255
    MOV R2, R0
    SL R2, 8
    LDI 255
    OR R2, R0
    ADD R2, 1 ; Overflow 16-bit -> C=1
    JC .jc_target_29
    LDI 0
    MOV R3, R0
    LDI .jc_end_29
    MOV PC, R0
.jc_target_29:
    LDI 1
    MOV R3, R0
.jc_end_29:
    NOP
    MOV R1, R3
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 30: MVS Write/Read --

    LDI 4660
    MOV R2, R0
    MVS ES, R2  ; ES = R2
    MVS R3, ES  ; R3 = ES
    MOV R1, R3
    ST R1, [R14]
    ADD R14, 1

    ; -- Test 31: LNK Execution --
    LNK R2
    LDI 0xAA
    MOV R2, R0
    SL R2, 8
    OR R2, R0
    MOV R1, R2
    ST R1, [R14]
    ADD R14, 1

    HLT
