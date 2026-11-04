; =============================================
; Standalone Deep16 ROM (BIOS + Startup)
; =============================================
.binary "deep16_rom.bin"

; =============================================
; BIOS Implementation (at physical 0xF8000)
; =============================================
.equ SCR R8
.equ KBD_STATUS 0x0060
.equ KBD_DATA   0x0062

.include "asm/deep16bios.asm"

; =============================================
; BIOS Initialization & Trampoline
; =============================================
bios_init:
    ; Setup segments for copy
    ; DS = 0xF800 (Current CS/BIOS)
    ; ES = 0x0000 (Target RAM)
    
    LDI 0x7800      ; sign extended to F800
    MVS DS, R0
    
    LDI 0x0000
    MVS ES, R0
    
    ; Copy trampoline to 0x0080
    LDI 0x5000      ; emulate old ESD, DE=1, ER=10
    LPSW R1
    OR R1, R0
    SPSW R1          ; R10 uses ES
    LDI 0x0080
    MOV R10, R0     ; Source address in ES
    LDI trampoline_code - bios_entry ; dest in R0
    ; copy four trampoline wors
    LD  R1, R0, 0
    ST  R1, R10, 0
    LD  R1, R0, 1
    ST  R1, R10, 1
    LD  R1, R0, 2
    ST  R1, R10, 2
    LD  R1, R0, 3
    ST  R1, R10, 3
    
    ; Set SWI Vector (0x0002) -> 0x0080
    LSI R1, 2
    LDI 0x0080
    STS R0, ES, R1
    
    ; Jump to User Program (0x0100)
    LDI 0x0100
    MOV R1, R0
    LDI 0x0000
    JML R0
    NOP

trampoline_code:
    LDI 0x7800      ; sign exteneded to R0 = 0xF8000
    LSI R1, 0       ; R1 = 0x0000
    JML R0          ; Jump to F800:0000
    NOP
trampoline_end:

; =============================================
; Startup ROM (0xFFFF0-0xFFFFF) - SEPARATE SEGMENT
; =============================================
.org 0xFFFF0
.code
startup_rom:
    ; Jump to BIOS Init (0xF800:bios_init)
    LDI 0x7800      ; sign exgtended to F800
    MOV R2, R0      ; R2 = BIOS segemnt

    LDI bios_init - bios_entry  ; Load bios_init addr
    MOV R3, R0      ; R3 = bios_init
    
    JML R2
    NOP
