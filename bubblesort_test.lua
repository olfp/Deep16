-- bubblesort_test.lua
local Assembler = require("cMIN16a_assembler")

local bubblesort_source = [[
; =============================================
; cMIN-16a Bubblesort Implementation
; Sortiert 42 16-bit Werte im Data-Segment
; =============================================

; Konstanten
ARRAY_SIZE = 42
DATA_BASE = 0x1000

.org 0x0000

; =============================================
; Hauptprogramm
; =============================================
main:
    ; Segment-Register setup
    LDI DATA_BASE
    MVS DS, R0          ; Data Segment = 0x1000
    
    LDI stack_top
    MOV SP, R0, 0       ; Stack Pointer initialisieren
    
    ; Bubblesort aufrufen
    MOV R14, PC, 2      ; Return-Adresse setzen
    JMP bubblesort
    
    ; Nach Sortierung: Ergebnis prüfen und anhalten
    MOV R14, PC, 2
    JMP verify_sorted
    HLT

; =============================================
; Bubblesort Algorithmus
; =============================================
bubblesort:
    ; Prologue - Register sichern
    ST R1, [SS:SP, -1]
    ST R2, [SS:SP, -2] 
    ST R3, [SS:SP, -3]
    ST R4, [SS:SP, -4]
    ST R5, [SS:SP, -5]
    ST R6, [SS:SP, -6]
    
    ; Initialisierung
    LSI R1, ARRAY_SIZE  ; n = ARRAY_SIZE
    LSI R5, 1           ; swapped = true
    LDI DATA_BASE       ; R0 = Basisadresse
    
outer_loop:
    ; swapped = false
    LSI R5, 0
    
    ; i = 0
    LSI R2, 0
    
inner_loop:
    ; j = n - i - 1
    MOV R3, R1, 0       ; R3 = n
    SUB R3, R3, R2      ; R3 = n - i
    SUB R3, R3, 1       ; R3 = n - i - 1
    
    ; arr[j] laden - R4 = base + j
    MOV R4, R0, 0       ; R4 = base
    ADD R4, R4, R3      ; R4 = base + j (statt MOV R4, R0, R3)
    LD R6, [DS:R4, 0]   ; R6 = arr[j]
    
    ; arr[j+1] laden - R4 = base + j + 1  
    MOV R4, R0, 0       ; R4 = base
    ADD R4, R4, R3      ; R4 = base + j
    ADD R4, R4, 1       ; R4 = base + j + 1
    LD R4, [DS:R4, 0]   ; R4 = arr[j+1]
    
    ; if (arr[j] > arr[j+1])
    SUB R0, R6, R4, w=0 ; Compare arr[j] - arr[j+1]
    JN no_swap          ; Wenn negativ, keine Vertauschung
    
    ; Swap arr[j] und arr[j+1]
    ; Zuerst arr[j+1] = arr[j] speichern
    MOV R7, R0, 0       ; R7 = base
    ADD R7, R7, R3      ; R7 = base + j
    ADD R7, R7, 1       ; R7 = base + j + 1
    ST R6, [DS:R7, 0]   ; arr[j+1] = arr[j]
    
    ; Dann arr[j] = arr[j+1] speichern
    MOV R7, R0, 0       ; R7 = base
    ADD R7, R7, R3      ; R7 = base + j
    ST R4, [DS:R7, 0]   ; arr[j] = arr[j+1]
    
    ; swapped = true
    LSI R5, 1
    
no_swap:
    ; i++
    ADD R2, R2, 1
    
    ; i < n - 1 ?
    MOV R3, R1, 0       ; R3 = n
    SUB R3, R3, 1       ; R3 = n - 1
    SUB R0, R2, R3, w=0 ; Compare i - (n-1)
    JN inner_loop       ; Wenn negativ, weiter im inner loop
    
    ; if (swapped) goto outer_loop
    SUB R0, R5, 0, w=0  ; Test swapped != 0
    JNZ outer_loop
    
    ; Epilogue - Register restaurieren
    LD R6, [SS:SP, -6]
    LD R5, [SS:SP, -5]
    LD R4, [SS:SP, -4]
    LD R3, [SS:SP, -3]
    LD R2, [SS:SP, -2]
    LD R1, [SS:SP, -1]
    
    ; Return
    JRL R14

; =============================================
; Verify Sorted - Prüft ob Array sortiert ist
; =============================================
verify_sorted:
    ST R1, [SS:SP, -1]
    ST R2, [SS:SP, -2]
    ST R3, [SS:SP, -3]
    
    LDI DATA_BASE       ; R0 = Basisadresse
    ; i = 0
    LSI R1, 0
    
verify_loop:
    ; arr[i] laden
    MOV R2, R0, 0       ; R2 = base
    ADD R2, R2, R1      ; R2 = base + i (statt MOV R2, R0, R1)
    LD R2, [DS:R2, 0]   ; R2 = arr[i]
    
    ; arr[i+1] laden
    MOV R3, R0, 0       ; R3 = base
    ADD R3, R3, R1      ; R3 = base + i
    ADD R3, R3, 1       ; R3 = base + i + 1
    LD R3, [DS:R3, 0]   ; R3 = arr[i+1]
    
    ; if (arr[i] > arr[i+1]) dann Fehler
    SUB R0, R2, R3, w=0 ; Compare arr[i] - arr[i+1]
    JN not_error        ; Wenn negativ, OK
    
    ; Fehler gefunden - infinite loop
error:
    JMP error
    
not_error:
    ; i++
    ADD R1, R1, 1
    
    ; i < ARRAY_SIZE - 1 ?
    LSI R2, ARRAY_SIZE
    SUB R2, R2, 1       ; ARRAY_SIZE - 1
    SUB R0, R1, R2, w=0 ; Compare i - (size-1)
    JN verify_loop      ; Wenn negativ, weiter prüfen
    
    ; Alles sortiert!
    LD R3, [SS:SP, -3]
    LD R2, [SS:SP, -2]
    LD R1, [SS:SP, -1]
    JRL R14

; =============================================
; Datenbereich - 42 zufällige 16-bit Werte
; =============================================
.org DATA_BASE

; Unsortierte Test-Daten (42 Werte)
test_data:
    .dw 0x7A3F, 0x15E2, 0x9B44, 0x2F81, 0xC6D3, 0x539A, 0xE827, 0x4C15
    .dw 0x8F69, 0x31D7, 0xA402, 0x6E8B, 0xD95C, 0x0B23, 0x74F8, 0x3A96
    .dw 0xE15D, 0x87C2, 0x2E4F, 0xB938, 0x5C71, 0x93AE, 0x460B, 0xFD24
    .dw 0x6897, 0x1FCA, 0xA535, 0x7DE8, 0x3241, 0xCE9F, 0x8506, 0x5B72
    .dw 0xE0CD, 0x761A, 0x3D85, 0x92F3, 0x494E, 0xB6A1, 0x0D78, 0xF42B
    .dw 0x6194, 0x2EC7

; Stack Bereich
.org 0x2000
stack_bottom:
    .dw 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0  ; 16 Worte Stack
stack_top:
]]

-- =============================================
-- Test-Funktion
-- =============================================
function test_bubblesort()
    print("cMIN-16a Bubblesort Assembler Test")
    print("==================================")
    
    local assembler = Assembler.new()
    
    -- Schreibe Quellcode
    local file = io.open("bubblesort.asm", "w")
    file:write(bubblesort_source)
    file:close()
    
    print("Assembliere Bubblesort...")
    
    -- Assembliere
    local success, machine_code = pcall(function() 
        return assembler:assemble_file("bubblesort.asm") 
    end)
    
    if not success then
        print("FEHLER: " .. machine_code)
        os.remove("bubblesort.asm")
        return false
    end
    
    print("Erfolg! " .. #machine_code .. " Maschinenworte generiert")
    print("")
    
    -- Zeige ersten 20 Instruktionen
    print("Erste 20 Instruktionen:")
    for i = 1, math.min(20, #machine_code) do
        local addr = i - 1
        local code = machine_code[i]
        print(string.format("  %04X: %04X", addr, code))
    end
    
    -- Zeige Datenbereich
    print("")
    print("Datenbereich (ab 0x1000):")
    for i = 1, math.min(10, #machine_code - 0x1000) do
        local addr = 0x1000 + i - 1
        if addr < #machine_code then
            local code = machine_code[addr + 1]  -- Lua ist 1-basiert
            print(string.format("  %04X: %04X", addr, code))
        end
    end
    
    -- Statistiken
    print("")
    print("Statistiken:")
    print("  Code-Größe: " .. (#machine_code - 42) .. " Worte")  -- Ohne Daten
    print("  Daten-Größe: 42 Worte")
    print("  Gesamt: " .. #machine_code .. " Worte")
    
    -- Aufräumen
    os.remove("bubblesort.asm")
    
    return true
end

-- Hauptprogramm
if arg and arg[0]:match("bubblesort_test.lua") then
    test_bubblesort()
end

return test_bubblesort
