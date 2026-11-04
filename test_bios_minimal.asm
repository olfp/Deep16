; Minimal BIOS test - calls bver and then halts
; Code starts at 0x0:0x100 (segment 0, offset 0x100)
.org 0x0100

; Call BIOS version function (function 0) using SWI
LDI 0           ; Function code 0 = bver
SWI             ; Call BIOS via software interrupt

; The result should be in R0 (0x0001 for version 0.1)
; Store the result for verification at a safe memory location
MOV R1, R0      ; R1 = BIOS result (preserve it first!)
LDI result      ; Use address 0x0200 for result storage
ST R1, [R0]     ; Store result at [0x0200]

; Halt the system
HLT

; Data area
.org 0x0200
result:
.word 0         ; Store the BIOS version result here