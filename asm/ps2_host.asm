; ps2_host.asm - PS/2 host-to-keyboard sender, loaded at segment 0x4000.
;
; Called with `0x4000 call-far`; the command byte is the top cell of the
; caller's data stack (call-far pops the segment, leaving the byte). The routine
; copies it, pops it, sends start + 8 data bits + odd parity + stop with the
; keyboard's clock, and returns through the call-far pair in R10/R11.
;
; The pads are open-drain through control 6 (0x200C): bit 9 pulls CLK low,
; bit 10 pulls DATA low. The synchronised CLK level is 0xF0066 bit 5.
.org 0
.code
ps2_host:
    LDS R1, SS, SP           ; command byte from the caller's data stack
    ADD SP, 1                ; pop it
    LDI 0x0FFF
    INV R0
    MVS ES, R0               ; ES = 0xF000
    LDI 0x200C
    MOV R2, R0               ; R2 = control 6
    LDI 0x0066
    MOV R3, R0               ; R3 = display status

    ; odd parity: R4 = 1 when the byte has an even number of ones
    MOV R5, R1
    LDI 0
    MOV R4, R0
    LSI R6, 8
ps2h_par_loop:
    MOV R7, R5
    LSI R8, 1
    AND R7, R8
    XOR R4, R7
    SR R5, 1
    SUB R6, 1
    JNZ ps2h_par_loop
    NOP
    LSI R8, 1
    AND R4, R8
    XOR R4, R8

    ; request: CLK low, DATA high, >= 100 us
    LDI 0x0200
    MOV R7, R0
    STS R7, ES, R2
    LDI 250
    MOV R6, R0
ps2h_req_delay:
    SUB R6, 1
    JNZ ps2h_req_delay
    NOP
    LDI 0x0600               ; DATA low (start), CLK still low
    MOV R7, R0
    STS R7, ES, R2
    LDI 0x0400               ; release CLK, DATA still low
    MOV R7, R0
    STS R7, ES, R2

    ; the start bit: wait for the keyboard's first CLK low, then high
    LDI 0x20
    MOV R8, R0
ps2h_start_lo:
    LDS R7, ES, R3
    AND R7, R8
    JNZ ps2h_start_lo
    NOP
ps2h_start_hi:
    LDS R7, ES, R3
    AND R7, R8
    JZ ps2h_start_hi
    NOP

    ; 8 data bits, LSB first; set each while the clock is high, before the
    ; next falling edge.
    LSI R6, 8
ps2h_data_loop:
    MOV R7, R1
    LSI R8, 1
    AND R7, R8
    XOR R7, R8               ; 1 when the bit is 0
    SL R7, 10                ; 0x400 drives DATA low, 0 releases it
    STS R7, ES, R2
    LDI 0x20
    MOV R8, R0
ps2h_d_lo:
    LDS R7, ES, R3
    AND R7, R8
    JNZ ps2h_d_lo
    NOP
ps2h_d_hi:
    LDS R7, ES, R3
    AND R7, R8
    JZ ps2h_d_hi
    NOP
    SR R1, 1
    SUB R6, 1
    JNZ ps2h_data_loop
    NOP

    ; parity bit
    MOV R7, R4
    LSI R8, 1
    AND R7, R8
    XOR R7, R8
    SL R7, 10
    STS R7, ES, R2
    LDI 0x20
    MOV R8, R0
ps2h_p_lo:
    LDS R7, ES, R3
    AND R7, R8
    JNZ ps2h_p_lo
    NOP
ps2h_p_hi:
    LDS R7, ES, R3
    AND R7, R8
    JZ ps2h_p_hi
    NOP

    ; stop bit = 1 (release DATA)
    LDI 0
    MOV R7, R0
    STS R7, ES, R2
ps2h_s_lo:
    LDS R7, ES, R3
    AND R7, R8
    JNZ ps2h_s_lo
    NOP
ps2h_s_hi:
    LDS R7, ES, R3
    AND R7, R8
    JZ ps2h_s_hi
    NOP

    LDI 0
    MOV R7, R0
    STS R7, ES, R2           ; release both lines
    JML R10
    NOP
