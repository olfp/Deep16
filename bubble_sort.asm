; bubble_sort.asm
; Bubble sort implementation for 42 random numbers
; Uses Deep16 assembler syntax

.org 0x0000

; Register usage:
; R0  - Temporary, LDI destination
; R1  - Outer loop counter (i)
; R2  - Inner loop counter (j) 
; R3  - Array pointer
; R4  - Current element (arr[j])
; R5  - Next element (arr[j+1])
; R6  - Swap flag
; R7  - Array size (42)
; R8  - Temporary for comparisons
; R13 - Stack Pointer (SP)

; Constants
ARRAY_SIZE = 42
ARRAY_START = 0x0100

start:
    ; Initialize stack pointer
    LDI 0x0400
    MOV R13, R0, 0      ; SP = 0x0400

    ; Initialize array with random data using a simple PRNG
    JSR init_array

    ; Perform bubble sort
    JSR bubble_sort

    ; Halt when done
    HLT

; Initialize array with pseudo-random data
init_array:
    ; Save return address
    MOV R14, R15, 0     ; LR = return address

    ; Set up array pointer and size
    LDI ARRAY_START
    MOV R3, R0, 0       ; R3 = array pointer
    LDI ARRAY_SIZE
    MOV R7, R0, 0       ; R7 = array size
    
    ; Simple PRNG seed
    LDI 0x5A5A
    MOV R8, R0, 0       ; R8 = PRNG state

init_loop:
    ; Generate pseudo-random number (simple LCG)
    MOV R0, R8, 0       ; R0 = state
    LDI 1103515245 >> 16
    MOV R1, R0, 0
    LDI 1103515245 & 0xFFFF
    MOV R2, R0, 0
    ; Multiply state by 1103515245 (simplified)
    ADD R8, R8, R8      ; state *= 2
    ADD R8, R8, R8      ; state *= 4  
    ADD R8, R8, R1      ; Add high part
    ADD R8, R8, R2      ; Add low part
    
    ; Limit to 16-bit range and store
    AND R8, R8, 0x7FFF  ; Keep 15 bits (0-32767)
    ST R8, R3, 0        ; Store random number
    
    ; Increment pointer and decrement counter
    ADD R3, R3, 1       ; pointer++
    SUB R7, R7, 1       ; counter--
    JNZ init_loop       ; Continue until counter = 0

    ; Restore and return
    MOV R15, R14, 0     ; PC = return address
    RET

; Bubble sort implementation
bubble_sort:
    ; Save return address
    MOV R14, R15, 0     ; LR = return address

    ; Initialize outer loop counter (i = 0)
    LDI 0
    MOV R1, R0, 0       ; R1 = i = 0

outer_loop:
    ; Initialize swap flag to 0 (no swaps)
    LDI 0
    MOV R6, R0, 0       ; R6 = swap_flag = 0
    
    ; Initialize inner loop counter (j = 0)
    LDI 0
    MOV R2, R0, 0       ; R2 = j = 0
    
    ; Calculate inner loop limit: ARRAY_SIZE - 1 - i
    LDI ARRAY_SIZE
    MOV R7, R0, 0       ; R7 = ARRAY_SIZE
    SUB R7, R7, 1       ; R7 = ARRAY_SIZE - 1
    SUB R7, R7, R1      ; R7 = ARRAY_SIZE - 1 - i

inner_loop:
    ; Set array pointer to arr[j]
    LDI ARRAY_START
    MOV R3, R0, 0       ; R3 = array base
    ADD R3, R3, R2      ; R3 = array base + j
    
    ; Load arr[j] and arr[j+1]
    LD R4, R3, 0        ; R4 = arr[j]
    LD R5, R3, 1        ; R5 = arr[j+1]
    
    ; Compare arr[j] and arr[j+1]
    MOV R0, R4, 0       ; Copy arr[j] to R0 for comparison
    SUB R0, R0, R5, w=0 ; Compare arr[j] - arr[j+1]
    
    ; If arr[j] <= arr[j+1], no swap needed
    JN no_swap          ; If negative, arr[j] < arr[j+1]
    JZ no_swap          ; If zero, arr[j] == arr[j+1]
    
    ; Swap arr[j] and arr[j+1]
    ST R5, R3, 0        ; arr[j] = arr[j+1]
    ST R4, R3, 1        ; arr[j+1] = arr[j]
    
    ; Set swap flag
    LDI 1
    MOV R6, R0, 0       ; swap_flag = 1

no_swap:
    ; Increment inner loop counter
    ADD R2, R2, 1       ; j++
    
    ; Check inner loop condition: j < ARRAY_SIZE - 1 - i
    MOV R0, R2, 0       ; Copy j to R0 for comparison
    SUB R0, R0, R7, w=0 ; Compare j - (ARRAY_SIZE - 1 - i)
    JN inner_loop       ; If negative, j < limit, continue inner loop
    
    ; Check if any swaps occurred
    MOV R0, R6, 0       ; Copy swap_flag to R0 for comparison
    SUB R0, R0, 0, w=0  ; Compare swap_flag with 0
    JZ sort_done        ; If no swaps, array is sorted
    
    ; Increment outer loop counter
    ADD R1, R1, 1       ; i++
    
    ; Check outer loop condition: i < ARRAY_SIZE - 1
    MOV R0, R1, 0       ; Copy i to R0 for comparison
    LDI ARRAY_SIZE
    MOV R7, R0, 0       ; R7 = ARRAY_SIZE
    SUB R7, R7, 1       ; R7 = ARRAY_SIZE - 1
    SUB R0, R0, R7, w=0 ; Compare i - (ARRAY_SIZE - 1)
    JN outer_loop       ; If negative, i < limit, continue outer loop

sort_done:
    ; Restore and return
    MOV R15, R14, 0     ; PC = return address
    RET

; Subroutine call/return macros (since we don't have actual CALL/RET instructions)
; JSR label: MOV LR, PC, 2; JMP label
; RET: MOV PC, LR, 0

; Data section (the array will be stored starting at ARRAY_START)
; The array is initialized at runtime, so no .dw needed here
