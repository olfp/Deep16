-- test_assembler.lua
local Assembler = require("cMIN16a_assembler")

-- Test-Programm
local test_source = [[
; Testprogramm für cMIN-16a Assembler
ARRAY_SIZE = 8

.org 0x0000

main:
    LDI 0x1000
    MOV R1, R0, 0
    LSI R2, ARRAY_SIZE
    LSI R3, 0
    
loop:
    MOV R4, R1, R3
    LD R5, [DS:R4, 0]
    ADD R5, R5, 1
    ST R5, [DS:R4, 0]
    ADD R3, R3, 1
    SUB R0, R3, R2, w=0
    JNZ loop
    HLT

; Daten
.org 0x1000
    .dw 1, 2, 3, 4, 5, 6, 7, 8
]]

-- Teste den Assembler
function test_assembler()
    local assembler = Assembler.new()
    
    -- Schreibe Test-Quellcode
    local file = io.open("test.asm", "w")
    file:write(test_source)
    file:close()
    
    -- Assembliere
    local machine_code = assembler:assemble_file("test.asm")
    
    print("Test erfolgreich! " .. #machine_code .. " Worte generiert")
    
    -- Aufräumen
    os.remove("test.asm")
end

test_assembler()
