-- cMIN16a_assembler.lua
-- cMIN-16a Assembler Implementation in Lua

local Assembler = {}
Assembler.__index = Assembler

-- Opcode-Definitionen
local OPCODES = {
    LDI = 0x0000,
    LD = 0x8000,  -- Mit L/S=0
    ST = 0x8000,  -- Mit L/S=1  
    ADD = 0xC000,
    SUB = 0xC200,
    AND = 0xC400,
    OR = 0xC600,
    XOR = 0xC800,
    MUL = 0xCA00,
    DIV = 0xCC00,
    SHIFT = 0xCE00,
    JMP = 0xE000,
    JZ = 0xE200,
    JNZ = 0xE400,
    JC = 0xE600,
    JNC = 0xE800,
    JN = 0xEA00,
    JNN = 0xEC00,
    JRL = 0xEE00,
    MOV = 0xF800,
    LSI = 0xF000,
    SET = 0xFC00,
    CLR = 0xFC00,
    MVS = 0x3F00,
    SMV = 0x3FC0,
    NOP = 0xFFF0,
    HLT = 0xFFF2,
    SWI = 0xFFF4,
    RETI = 0xFFF6
}

-- Segment-Codes
local SEGMENTS = {
    DS = 0, CS = 1, SS = 2, ES = 3
}

-- Shift-Typen
local SHIFT_TYPES = {
    SL = 0, SR = 1, SRA = 2, ROT = 3
}

function Assembler.new()
    local self = setmetatable({}, Assembler)
    self.symbol_table = {}
    self.address = 0
    self.output = {}
    self.current_segment = "CODE"
    self.labels = {}
    return self
end

function Assembler:parse_register(reg_str)
    -- Parse Register wie R0, R15, PC, LR
    if reg_str:upper():match("^R(%d+)$") then
        local reg_num = tonumber(reg_str:upper():match("^R(%d+)$"))
        if reg_num and reg_num >= 0 and reg_num <= 15 then
            return reg_num
        end
    elseif reg_str:upper() == "PC" then
        return 15
    elseif reg_str:upper() == "LR" then
        return 14
    elseif reg_str:upper() == "SP" then
        return 13  -- Konvention
    end
    error("Ungültiges Register: " .. reg_str)
end

function Assembler:evaluate_expression(expr)
    -- Einfacher Expression-Parser
    -- Ersetze Symbole
    for symbol, value in pairs(self.symbol_table) do
        expr = expr:gsub(symbol, tostring(value))
    end
    
    -- Ersetze Hex-Notation
    expr = expr:gsub("0x(%x+)", function(x) return tonumber(x, 16) end)
    
    -- Einfache Auswertung (Achtung: eval() in Lua ist komplexer)
    -- Für Produktionscode sollte man einen richtigen Parser verwenden
    local success, result = pcall(load("return " .. expr))
    if success then
        return math.floor(result)
    else
        error("Ungültiger Ausdruck: " .. expr)
    end
end

function Assembler:encode_ldi(operands)
    -- [0][15-bit immediate]
    if #operands ~= 1 then
        error("LDI benötigt genau einen Operand")
    end
    
    local immediate = self:evaluate_expression(operands[1])
    if immediate < 0 or immediate > 0x7FFF then
        error("LDI Immediate zu groß: " .. immediate)
    end
    
    return immediate  -- Opcode 0 ist implizit
end

function Assembler:encode_ldst(mnemonic, operands)
    -- [10][L/S][Seg2][Rd4][Base4][offset2]
    if #operands ~= 4 then
        error(mnemonic .. " benötigt Rd, [Seg:Base,offset]")
    end
    
    local rd = self:parse_register(operands[1])
    
    -- Parse Memory-Operand [Seg:Base,offset]
    local mem_op = operands[2]
    local seg, base, offset = mem_op:match("%[([^:]+):([^,%]]+),?([^%]]*)%]")
    
    if not seg then
        error("Ungültiger Memory-Operand: " .. mem_op)
    end
    
    local seg_code = SEGMENTS[seg:upper()] or error("Ungültiges Segment: " .. seg)
    local base_reg = self:parse_register(base)
    local offset_val = offset and self:evaluate_expression(offset) or 0
    
    if offset_val < 0 or offset_val > 3 then
        error("Offset muss 0-3 sein: " .. offset_val)
    end
    
    local opcode = 0x8000  -- Basis-Opcode 10
    local l_s = (mnemonic == "ST") and 1 or 0
    
    opcode = opcode | (l_s << 13)
    opcode = opcode | (seg_code << 11)
    opcode = opcode | (rd << 7)
    opcode = opcode | (base_reg << 3)
    opcode = opcode | offset_val
    
    return opcode
end

function Assembler:encode_alu(mnemonic, operands)
    -- [110][op3][Rd4][w1][i1][Rs/imm4]
    local alu_ops = {
        ADD = 0, SUB = 1, AND = 2, OR = 3,
        XOR = 4, MUL = 5, DIV = 6
    }
    
    local op_val = alu_ops[mnemonic]
    if not op_val then
        error("Unbekannte ALU-Operation: " .. mnemonic)
    end
    
    if #operands < 2 then
        error(mnemonic .. " benötigt Rd, Rs/imm")
    end
    
    local rd = self:parse_register(operands[1])
    local w_flag = 1  -- Default: Writeback
    local i_flag = 0  -- Default: Register mode
    local src_val = 0
    
    -- Check for w=0 (CMP/TST)
    if #operands >= 3 and operands[#operands] == "w=0" then
        w_flag = 0
        table.remove(operands, #operands)
    end
    
    if #operands == 2 then
        -- Register mode
        local rs = self:parse_register(operands[2])
        src_val = rs
        i_flag = 0
    else
        -- Immediate mode
        local imm = self:evaluate_expression(operands[2])
        if imm < 0 or imm > 15 then
            error("ALU Immediate muss 0-15 sein: " .. imm)
        end
        src_val = imm
        i_flag = 1
    end
    
    local opcode = 0xC000  -- Basis-Opcode 110
    opcode = opcode | (op_val << 10)
    opcode = opcode | (rd << 6)
    opcode = opcode | (w_flag << 5)
    opcode = opcode | (i_flag << 4)
    opcode = opcode | src_val
    
    return opcode
end

function Assembler:encode_shift(operands)
    -- [110][111][Rd4][C1][T2][count3]
    if #operands < 3 then
        error("SHIFT benötigt Rd, Typ, Count [,C=1]")
    end
    
    local rd = self:parse_register(operands[1])
    local shift_type = SHIFT_TYPES[operands[2]:upper()] 
    if not shift_type then
        error("Ungültiger Shift-Typ: " .. operands[2])
    end
    
    local count = self:evaluate_expression(operands[3])
    if count < 0 or count > 7 then
        error("Shift-Count muss 0-7 sein: " .. count)
    end
    
    local c_flag = 0
    if #operands >= 4 and operands[4]:upper() == "C=1" then
        c_flag = 1
    end
    
    local opcode = 0xCE00  -- ALU-op 111
    opcode = opcode | (rd << 8)
    opcode = opcode | (c_flag << 7)
    opcode = opcode | (shift_type << 5)
    opcode = opcode | count
    
    return opcode
end

function Assembler:encode_mov(operands)
    -- [111110][Rd4][Rs4][imm2]
    if #operands ~= 3 then
        error("MOV benötigt Rd, Rs, imm2")
    end
    
    local rd = self:parse_register(operands[1])
    local rs = self:parse_register(operands[2])
    local imm = self:evaluate_expression(operands[3])
    
    if imm < 0 or imm > 3 then
        error("MOV Immediate muss 0-3 sein: " .. imm)
    end
    
    local opcode = 0xF800  -- Basis-Opcode 111110
    opcode = opcode | (rd << 6)
    opcode = opcode | (rs << 2)
    opcode = opcode | imm
    
    return opcode
end

function Assembler:encode_jmp(mnemonic, operands)
    -- [1110][type3][target8]
    local jump_types = {
        JMP = 0, JZ = 1, JNZ = 2, JC = 3, 
        JNC = 4, JN = 5, JNN = 6, JRL = 7
    }
    
    local type_val = jump_types[mnemonic]
    if not type_val then
        error("Unbekannter Sprung-Typ: " .. mnemonic)
    end
    
    if #operands ~= 1 then
        error(mnemonic .. " benötigt genau einen Operand")
    end
    
    local target = operands[1]
    
    if mnemonic == "JRL" then
        -- Register indirect
        local rm = self:parse_register(target)
        local opcode = 0xEE00  -- JRL Opcode
        opcode = opcode | (rm << 4)
        return opcode
    else
        -- PC-relative Sprung
        local offset = self:evaluate_expression(target)
        if offset < -256 or offset > 255 then
            error("Sprung-Offset zu groß: " .. offset)
        end
        
        -- Konvertiere zu 8-bit signed
        if offset < 0 then
            offset = 256 + offset
        end
        
        local opcode = 0xE000  -- Basis-Opcode 1110
        opcode = opcode | (type_val << 8)
        opcode = opcode | (offset & 0xFF)
        
        return opcode
    end
end

function Assembler:parse_instruction(line, line_num)
    local mnemonic, operands_str = line:match("^(%S+)%s*(.*)$")
    if not mnemonic then return nil end
    
    mnemonic = mnemonic:upper()
    
    -- Parse Operanden
    local operands = {}
    for operand in operands_str:gmatch("[^,%s]+") do
        table.insert(operands, operand)
    end
    
    -- Encode basierend auf Mnemonic
    if mnemonic == "LDI" then
        return self:encode_ldi(operands)
    elseif mnemonic == "LD" or mnemonic == "ST" then
        return self:encode_ldst(mnemonic, operands)
    elseif mnemonic == "MOV" then
        return self:encode_mov(operands)
    elseif mnemonic == "SHIFT" then
        return self:encode_shift(operands)
    elseif mnemonic == "JMP" or mnemonic == "JZ" or mnemonic == "JNZ" or
           mnemonic == "JC" or mnemonic == "JNC" or mnemonic == "JN" or
           mnemonic == "JNN" or mnemonic == "JRL" then
        return self:encode_jmp(mnemonic, operands)
    elseif mnemonic == "ADD" or mnemonic == "SUB" or mnemonic == "AND" or
           mnemonic == "OR" or mnemonic == "XOR" or mnemonic == "MUL" or
           mnemonic == "DIV" then
        return self:encode_alu(mnemonic, operands)
    else
        error("Unbekannter Befehl: " .. mnemonic)
    end
end

function Assembler:assemble_file(filename)
    local file = io.open(filename, "r")
    if not file then
        error("Kann Datei nicht öffnen: " .. filename)
    end
    
    local source = file:read("*a")
    file:close()
    
    -- Zwei-Pass Assemblierung
    self:pass1(source)
    self:pass2(source)
    
    return self.output
end

function Assembler:pass1(source)
    self.address = 0
    self.labels = {}
    
    for line_num, line in ipairs(self:split_lines(source)) do
        line = line:gsub(";.*", ""):gsub("%s+$", "")  -- Remove comments and trailing whitespace
        
        if line ~= "" then
            -- Handle Direktiven
            if line:match("^%.") then
                self:process_directive(line, line_num, true)
            else
                -- Check for label
                local label, rest = line:match("^([%w_]+):%s*(.*)$")
                if label then
                    self.labels[label] = self.address
                    line = rest
                end
                
                if line and line ~= "" then
                    self.address = self.address + 1
                end
            end
        end
    end
end

function Assembler:pass2(source)
    self.address = 0
    self.output = {}
    
    for line_num, line in ipairs(self:split_lines(source)) do
        line = line:gsub(";.*", ""):gsub("%s+$", "")
        
        if line ~= "" then
            -- Handle Direktiven
            if line:match("^%.") then
                self:process_directive(line, line_num, false)
            else
                -- Remove label for processing
                local _, rest = line:match("^([%w_]+):%s*(.*)$")
                if rest then
                    line = rest
                end
                
                if line and line ~= "" then
                    local instruction = self:parse_instruction(line, line_num)
                    if instruction then
                        table.insert(self.output, instruction)
                        self.address = self.address + 1
                    end
                end
            end
        end
    end
end

function Assembler:split_lines(text)
    local lines = {}
    for line in text:gmatch("[^\r\n]+") do
        table.insert(lines, line)
    end
    return lines
end

function Assembler:process_directive(line, line_num, is_pass1)
    local directive, args = line:match("^%.(%S+)%s*(.*)$")
    directive = directive:upper()
    
    if directive == "ORG" then
        local address = tonumber(args:match("0x(%x+)")) or tonumber(args)
        if address then
            self.address = address
        end
    elseif directive == "EQU" then
        local symbol, value = args:match("^(%S+)%s+(.+)$")
        if symbol and value then
            self.symbol_table[symbol] = self:evaluate_expression(value)
        end
    elseif directive == "DW" then
        if not is_pass1 then
            for value in args:gmatch("%S+") do
                local num = self:evaluate_expression(value)
                table.insert(self.output, num)
                self.address = self.address + 1
            end
        else
            -- In Pass1 nur Adresse erhöhen
            local count = 0
            for _ in args:gmatch("%S+") do
                count = count + 1
            end
            self.address = self.address + count
        end
    end
end

-- Hauptfunktion
function main()
    if #arg ~= 1 then
        print("Usage: lua cMIN16a_assembler.lua <sourcefile.asm>")
        os.exit(1)
    end
    
    local assembler = Assembler.new()
    local success, machine_code = pcall(function() 
        return assembler:assemble_file(arg[1]) 
    end)
    
    if not success then
        print("Assemblierungsfehler: " .. machine_code)
        os.exit(1)
    end
    
    -- Ausgabe im Hex-Format
    print("cMIN-16a Machine Code:")
    for i, code in ipairs(machine_code) do
        print(string.format("%04X: %04X", i-1, code))
    end
end

-- Nur ausführen wenn direkt aufgerufen
if arg and arg[0]:match("cMIN16a_assembler.lua") then
    main()
end

return Assembler
