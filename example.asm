; example.asm
.start 0x0000
.code 0x0000

    LDI 42
    MOV R1, R0, 0
    HLT

.data 0x0100
    .dw 1, 2, 3, 4, 5

.stack 0x0400
