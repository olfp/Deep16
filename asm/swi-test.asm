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
    LPSW R11           ; Read PSW
    LDI 0x07FF         ; Clear ER[3:0] and DE bits (keep low 11 bits)
    MOV R2, R0
    AND R11, R2
    LDI 0x4000         ; Set DE=1 and ER=8 (R8) via sign-extend
    MOV R2, R0
    OR R11, R2
    SPSW R11           ; Write back PSW
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
    LDI 0              ; Function number 0 = GET_VERSION, in the caller's R0
    SWI                ; Software interrupt
    
    ; The handler read that number with SMV R2, AR0 and answered in its own R0.
    ; RETI copies nothing, so the caller brings the answer home itself.
    SMV R10, AR0       ; Save version number in R10 (reads the handler's R0)
    
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
; The calling convention: the caller leaves the function number in its own R0
; and the parameters in R1..R3; while PSW.S=1 the handler's own R0-R3 are the
; *shadow* bank, so SMV is the only door to the caller's registers (spec 3.3).
; The answer goes back the other way: the handler writes its own R0 and the
; caller collects it with SMV Rx, AR0 after RETI, which copies nothing (4.9).

swi_handler:
    SMV R2, AR0        ; R2 = the function number the caller asked for
    LDI 0
    CMP R2, R0
    JNZ swi_unknown    ; only function 0, GET_VERSION, exists here
    NOP
    LDI 0x0001         ; the handler's own R0: the version, read back by SMV
    LSI R1, 0
    OR R1, 0        ; set bit 0
    OR R1, 1        ; set bit 1
    OR R1, 2        ; set bit 2 -> R1 = 7 (OR Rd, imm takes a bit index)
    RETI
    NOP
swi_unknown:
    LDI '?'            ; an unknown function answers with a question mark
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
