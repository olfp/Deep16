 simple_test.asm
.org 0x0000

start:
    LDI 42
    MOV R1, R0, 0
    LSI R2, 10
    ADD R3, R1, R2
    ST R3, R13, 0
    LD R5, R13, 0
    JMP start
EOF
