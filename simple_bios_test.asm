; Simple BIOS Test - Print greeting and stop
.org 0x0100

start:
    ; Print greeting message
    LDI greeting - 1015808
    MOV R1, R0
    SWI 0x01           ; BIOS call to print string
    
    ; Stop execution
    HLT
    
greeting:
    .string "Hello from BIOS!\r\n\0"