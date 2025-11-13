-- test_assembler.lua
local Assembler = require("cMIN16a_assembler")

-- Einfacheres Testprogramm das funktioniert
local test_source = [[
; Einfaches Testprogramm für cMIN-16a Assembler
TEST_VALUE = 42
DATA_BASE = 0x1000

.org 0x0000

main:
    ; Segment-Register setup
    LDI DATA_BASE
    MVS DS, R0          ; Data Segment = 0x1000
    
    ; Einfache Register-Operationen testen
    LDI 0x1234          ; R0 = 0x1234
    MOV R1, R0, 0       ; R1 = R0
    LSI R2, TEST_VALUE  ; R2 = 42
    
    ; Einfache Addition testen
    ADD R3, R1, R2      ; R3 = R1 + R2
    
    ; Memory schreiben und lesen testen
    ST R3, [DS:R0, 0]   ; Speichere R3 an Adresse R0
    LD R4, [DS:R0, 0]   ; Lade zurück in R4
    
    ; Vergleich testen (w=0 für CMP)
    SUB R0, R3, R4, w=0 ; Sollte Zero-Flag setzen
    JZ  comparison_ok
    
    ; Fehlerfall
    HLT

comparison_ok:
    ; Erfolg - einfache Loop
    LSI R5, 10          ; Counter
loop:
    SUB R5, R5, 1       ; Counter decrementieren
    JNZ loop            ; Wiederholen bis 0
    
    ; Alles erfolgreich
    HLT

; Einfache Daten
.org DATA_BASE
test_data:
    .dw 0xABCD, 0x1234, 0x5678
]]

-- Test-Funktion
function test_assembler()
    print("cMIN-16a Assembler Basic Test")
    print("=============================")
    
    local assembler = Assembler.new()
    
    -- Schreibe Test-Quellcode
    local file = io.open("test_simple.asm", "w")
    file:write(test_source)
    file:close()
    
    print("Assembliere einfaches Testprogramm...")
    
    -- Assembliere
    local success, machine_code = pcall(function() 
        return assembler:assemble_file("test_simple.asm") 
    end)
    
    if not success then
        print("FEHLER: " .. machine_code)
        os.remove("test_simple.asm")
        return false
    end
    
    print("Erfolg! " .. #machine_code .. " Maschinenworte generiert")
    print("")
    
    -- Zeige alle Instruktionen
    print("Generierter Maschinencode:")
    for i, code in ipairs(machine_code) do
        local addr = i - 1
        print(string.format("  %04X: %04X", addr, code))
    end
    
    -- Einfache Verifikation
    print("")
    print("Verifikation:")
    
    -- Prüfe ob LDI 0x1234 korrekt enkodiert ist
    if machine_code[1] == 0x1234 then
        print("  ✓ LDI 0x1234 korrekt enkodiert")
    else
        print("  ✗ LDI 0x1234 fehlerhaft: " .. string.format("%04X", machine_code[1]))
    end
    
    -- Prüfe ob MOV R1, R0, 0 korrekt enkodiert ist
    -- MOV Format: 111110[Rd4][Rs4][imm2] = 0xF800 | (1<<6) | (0<<2) | 0 = 0xF840
    if machine_code[2] == 0xF840 then
        print("  ✓ MOV R1, R0, 0 korrekt enkodiert")
    else
        print("  ✗ MOV R1, R0, 0 fehlerhaft: " .. string.format("%04X", machine_code[2]))
    end
    
    -- Prüfe ob LSI R2, 42 korrekt enkodiert ist  
    -- LSI Format: 11110[Rd4][imm7] = 0xF000 | (2<<7) | 42 = 0xF000 | 0x280 | 0x2A = 0xF2AA
    if machine_code[3] == 0xF2AA then
        print("  ✓ LSI R2, 42 korrekt enkodiert")
    else
        print("  ✗ LSI R2, 42 fehlerhaft: " .. string.format("%04X", machine_code[3]))
    end
    
    -- Prüfe ob ADD R3, R1, R2 korrekt enkodiert ist
    -- ADD Format: 110[000][Rd4][w1][i0][Rs4] = 0xC000 | (3<<6) | (1<<5) | (2) = 0xC000 | 0xC0 | 0x20 | 0x02 = 0xC0E2
    if machine_code[4] == 0xC0E2 then
        print("  ✓ ADD R3, R1, R2 korrekt enkodiert")
    else
        print("  ✗ ADD R3, R1, R2 fehlerhaft: " .. string.format("%04X", machine_code[4]))
    end
    
    -- Aufräumen
    os.remove("test_simple.asm")
    
    print("")
    print("Test abgeschlossen!")
    return true
end

-- Zusätzlicher Test für Expressions
function test_expressions()
    print("")
    print("Expression Evaluation Test")
    print("==========================")
    
    local assembler = Assembler.new()
    
    -- Teste symbolische Ausdrücke
    assembler.symbol_table["CONST_A"] = 10
    assembler.symbol_table["CONST_B"] = 20
    
    local tests = {
        {"5", 5},
        {"0x10", 16},
        {"CONST_A", 10},
        {"CONST_A + CONST_B", 30},
        {"CONST_B - CONST_A", 10},
        {"0x10 + 5", 21}
    }
    
    for i, test in ipairs(tests) do
        local expr, expected = test[1], test[2]
        local success, result = pcall(function()
            return assembler:evaluate_expression(expr)
        end)
        
        if success and result == expected then
            print("  ✓ '" .. expr .. "' = " .. result)
        else
            print("  ✗ '" .. expr .. "' fehlgeschlagen: " .. tostring(result))
        end
    end
end

-- Hauptprogramm
if arg and arg[0]:match("test_assembler.lua") then
    local success = test_assembler()
    if success then
        test_expressions()
    end
end

return {
    test_assembler = test_assembler,
    test_expressions = test_expressions
}
