; =============================================
; BIOS Test Suite
; =============================================
; This program tests the BIOS functionality independently of Forth.
; It assumes the ROM has initialized the system and jumped here (0x0100).
;
; Steps:
; 1. Get BIOS Version (SWI 0)
; 2. Print greeting with version (SWI 3)
; 3. Loop:
;    a. Print prompt (SWI 3)
;    b. Get input line (SWI 5)
;    c. Echo input (SWI 3)
;    d. Repeat

.org 0x0100
.code

; Define registers
.equ SP R13

start:
    ; Initialize stack
    LDI 0x7FF0
    MOV SP, R0
    
    ; Initialize DS to 0 (Code and Data in Segment 0)
    LDI 0
    MVS DS, R0
    
    ; 0. Initialize BIOS (SCR, Screen)
    ; SWI 1: binit
    LDI 1
    MOV R4, R0
    SWI
    
    ; 1. Get BIOS Version
    ; SWI 0: bver -> R4 = version
    LDI 0
    MOV R4, R0
    SWI
    
    ; Convert version to ASCII char (assuming version is small, e.g., 1 -> '1')
    LDI '0'
    ADD R4, R0      ; R4 = '0' + version (using R0 which has '0')
    
    ; Store version char in greeting string (High byte for packed string)
    LDI version_char
    MOV R2, R0
    MOV R1, R4      ; R1 = version char (0x0031)
    SL  R1, 8       ; R1 = 0x3100
    ST  R1, R2, 0
    
    ; 2. Print greeting
    ; SWI 3: putstr -> R5 = string address
    LDI 3
    MOV R4, R0
    LDI greeting
    MOV R5, R0
    SWI

loop:
    ; 3a. Print prompt
    LDI 3
    MOV R4, R0
    LDI prompt
    MOV R5, R0
    SWI
    
    ; 3b. Get input line
    ; SWI 5: getstr -> R5 = buffer address
    LDI 5
    MOV R4, R0
    LDI input_buffer
    MOV R5, R0
    SWI
    
    ; 3c. Echo input
    ; First print "You typed: "
    LDI 3
    MOV R4, R0
    LDI echo_prefix
    MOV R5, R0
    SWI
    
    ; Then print buffer
    LDI 3
    MOV R4, R0
    LDI input_buffer
    MOV R5, R0
    SWI
    
    ; Newline
    LDI 3
    MOV R4, R0
    LDI newline
    MOV R5, R0
    SWI
    
    ; Halt instead of loop for testing
    HALT
    
    ; Repeat
    ; LDI loop
    ; MOV R1, R0
    ; MOV PC, R1
    NOP

; Data
greeting:
    .string "Deep16 BIOS Test Suite v"
version_char:
    .string "X"
    .string "\n"
    .word 0

prompt:
    .string "Enter text: "
    .word 0

echo_prefix:
    .string "You typed: "
    .word 0

newline:
    .string "\n"
    .word 0

input_buffer:
    .word 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
    .word 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
    .word 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
    .word 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
