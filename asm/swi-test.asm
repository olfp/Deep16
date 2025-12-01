; =============================================
; Deep16 SWI Version Demo
; Simple SWI call that returns version number
; =============================================

; =============================================
; Interrupt Vector Table (Segment 0)
; =============================================

.org 0x0000
.word main             ; RESET_VECTOR
.word hw_int_handler   ; HW_INT_VECTOR  
.word swi_handler      ; SWI_VECTOR

; =============================================
; Main Program
; =============================================

.org 0x0100
.code

main:
    ; Initialize stack pointer
    LDI 0x7FF0
    MOV R13, R0        ; SP = 0x7FF0
    
    ; Set up screen segment for output
    LDI 0x0FFF
    INV R0             ; R0 = 0xF000
    MVS ES, R0         ; ES = 0xF000
    LDI 0x1000         ; Screen buffer at 0xF1000
    MOV R8, R0         ; Use R8 as screen pointer
    ERD R8             ; Use R8/R9 for ES access
    LDI 0
    MVS DS, R0
    LDI 2
    MOV R2, R0
    LDI swi_handler
    MOV R1, R0
    STS R1, DS, R2
    
    ; Display initial message without subroutine call
    LDI message1
    MOV R3, R0
print_loop1:
    LD R1, R3, 0
    ADD R1, 0
    JZ after_message1
    NOP
    STS R1, ES, R8
    ADD R8, 1
    ADD R3, 1
    JNO print_loop1
    NOP
after_message1:

    ; Call OS function 0 (GET_VERSION) via SWI
    LDI 0              ; Function number 0 = GET_VERSION
    SWI                ; Software interrupt
    
    ; R0 now contains version number (0x0001)
    ; PRESERVE the version number since LDI will overwrite R0
    MOV R10, R0        ; Save version number in R10
    
    ; Display result without subroutine call
    LDI message2
    MOV R3, R0
print_loop2:
    LD R1, R3, 0
    ADD R1, 0
    JZ after_message2
    NOP
    STS R1, ES, R8
    ADD R8, 1
    ADD R3, 1
    JNO print_loop2
    NOP
after_message2:
    
    ; Display version number - use the preserved value
    MOV R1, R10        ; Get version from R10
    
    ; Convert version number to ASCII and display
    ; High byte = major version
    SWB R1             ; Swap bytes to get major in low byte
    LDI 0x00FF         ; Mask for low byte
    MOV R2, R0
    AND R1, R2         ; Isolate major version
    LDI '0'            ; ASCII '0'
    MOV R2, R0
    ADD R2, R1         ; Add major version
    STS R2, ES, R8     ; Output major version
    ADD R8, 1
    
    ; Demonstrate reading APSW and APC from shadow context
    LDI ' '
    MOV R2, R0
    STS R2, ES, R8
    ADD R8, 1
    LDI 'A'
    MOV R2, R0
    STS R2, ES, R8
    ADD R8, 1
    SMV R1, APSW
    MOV R3, R1
    SR R3, 12
    AND R3, 0xF
    MOV R4, R3
    SUB R4, 10
    JN apsw_n0
    NOP
    LDI 'A'
    MOV R2, R0
    ADD R2, R4
    STS R2, ES, R8
    ADD R8, 1
    JNO apsw_c1
    NOP
apsw_n0:
    LDI '0'
    MOV R2, R0
    ADD R2, R3
    STS R2, ES, R8
    ADD R8, 1
apsw_c1:
    MOV R3, R1
    SR R3, 8
    AND R3, 0xF
    MOV R4, R3
    SUB R4, 10
    JN apsw_n1
    NOP
    LDI 'A'
    MOV R2, R0
    ADD R2, R4
    STS R2, ES, R8
    ADD R8, 1
    JNO apsw_c2
    NOP
apsw_n1:
    LDI '0'
    MOV R2, R0
    ADD R2, R3
    STS R2, ES, R8
    ADD R8, 1
apsw_c2:
    MOV R3, R1
    SR R3, 4
    AND R3, 0xF
    MOV R4, R3
    SUB R4, 10
    JN apsw_n2
    NOP
    LDI 'A'
    MOV R2, R0
    ADD R2, R4
    STS R2, ES, R8
    ADD R8, 1
    JNO apsw_c3
    NOP
apsw_n2:
    LDI '0'
    MOV R2, R0
    ADD R2, R3
    STS R2, ES, R8
    ADD R8, 1
apsw_c3:
    MOV R3, R1
    AND R3, 0xF
    MOV R4, R3
    SUB R4, 10
    JN apsw_n3
    NOP
    LDI 'A'
    MOV R2, R0
    ADD R2, R4
    STS R2, ES, R8
    ADD R8, 1
    JNO apsw_done
    NOP
apsw_n3:
    LDI '0'
    MOV R2, R0
    ADD R2, R3
    STS R2, ES, R8
    ADD R8, 1
apsw_done:
    LDI 'P'
    MOV R2, R0
    STS R2, ES, R8
    ADD R8, 1
    SMV R1, APC
    MOV R3, R1
    SR R3, 12
    AND R3, 0xF
    MOV R4, R3
    SUB R4, 10
    JN apc_n0
    NOP
    LDI 'A'
    MOV R2, R0
    ADD R2, R4
    STS R2, ES, R8
    ADD R8, 1
    JNO apc_c1
    NOP
apc_n0:
    LDI '0'
    MOV R2, R0
    ADD R2, R3
    STS R2, ES, R8
    ADD R8, 1
apc_c1:
    MOV R3, R1
    SR R3, 8
    AND R3, 0xF
    MOV R4, R3
    SUB R4, 10
    JN apc_n1
    NOP
    LDI 'A'
    MOV R2, R0
    ADD R2, R4
    STS R2, ES, R8
    ADD R8, 1
    JNO apc_c2
    NOP
apc_n1:
    LDI '0'
    MOV R2, R0
    ADD R2, R3
    STS R2, ES, R8
    ADD R8, 1
apc_c2:
    MOV R3, R1
    SR R3, 4
    AND R3, 0xF
    MOV R4, R3
    SUB R4, 10
    JN apc_n2
    NOP
    LDI 'A'
    MOV R2, R0
    ADD R2, R4
    STS R2, ES, R8
    ADD R8, 1
    JNO apc_c3
    NOP
apc_n2:
    LDI '0'
    MOV R2, R0
    ADD R2, R3
    STS R2, ES, R8
    ADD R8, 1
apc_c3:
    MOV R3, R1
    AND R3, 0xF
    MOV R4, R3
    SUB R4, 10
    JN apc_n3
    NOP
    LDI 'A'
    MOV R2, R0
    ADD R2, R4
    STS R2, ES, R8
    ADD R8, 1
    JNO apc_done
    NOP
apc_n3:
    LDI '0'
    MOV R2, R0
    ADD R2, R3
    STS R2, ES, R8
    ADD R8, 1
apc_done:
    
    LDI '.'            ; Decimal point
    MOV R2, R0
    STS R2, ES, R8
    ADD R8, 1
    
    MOV R1, R10
    LDI 0x00FF
    MOV R2, R0
    AND R1, R2
    LDI '0'
    MOV R2, R0
    ADD R2, R1
    STS R2, ES, R8
    ADD R8, 1
    SMV R1, AR1
    STS R1, ES, R8
    ADD R8, 1
    
halt:
    HLT

; =============================================
; SWI Handler (Runs in Shadow Context)
; =============================================

swi_handler:
    LDI 0x0001
    LSI R1, 0
    OR R1, 3
    OR R1, 4
    OR R1, 6
    RETI
    NOP

; =============================================
; Hardware Interrupt Handler (placeholder)
; =============================================

hw_int_handler:
    RETI
    NOP

; =============================================
; String Data
; =============================================

message1:
    .word 'S'
    .word 'W'
    .word 'I'
    .word ' '
    .word 'V'
    .word 'e'
    .word 'r'
    .word 's'
    .word 'i'
    .word 'o'
    .word 'n'
    .word ' '
    .word 'D'
    .word 'e'
    .word 'm'
    .word 'o'
    .word 0

message2:
    .word ' '
    .word '-'
    .word ' '
    .word 'O'
    .word 'S'
    .word ' '
    .word 'v'
    .word 'e'
    .word 'r'
    .word 's'
    .word 'i'
    .word 'o'
    .word 'n'
    .word ':'
    .word ' '
    .word 0
