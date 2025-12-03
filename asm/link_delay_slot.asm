.org 0x0100

main:
    LDI subroutine
    MOV R3, R0
    JMP R3
    ALNK LR
return_here:
    HALT

subroutine:
    JMP LR
    NOP
