-- cMIN16a_assembler.lua
-- cMIN-16a Assembler Implementation in Lua - ENDGÜLTIG KORRIGIERT

local Assembler = {}
Assembler.__index = Assembler

-- Opcode-Definitionen
local OPCODES = {
    LDI = 0x0000,
    LD = 0x8000,
    ST = 0x8000,  
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

local SEGMENTS = { DS = 0, CS = 1, SS = 2, ES = 3 }
local SHIFT_TYPES = { SL = 0, SR = 1, SRA = 2, ROT = 3 }

function Assembler.new()
    local self = setmetatable({}, Assembler)
    self.symbol_table = {}
    self.address = 0
    self.output = {}
    self.current_segment = "CODE"
    self.labels = {}
    return self
end

function Assembler:is_register(str)
    return str:match("^[Rr]%d+$") or str:upper() == "PC" or str:upper() == "LR" or str:upper() == "SP"
end

function Assembler:parse_register(reg_str)
    if reg_str:upper():match("^R(%d+)$") then
        local reg_num = tonumber(reg_str:match("^R(%d+)$"))
        if reg_num and reg_num >= 0 and reg_num <= 15 then
            return reg_num
        end
    elseif reg_str:upper() == "PC" then return 15
    elseif reg_str:upper() == "LR" then return 14
    elseif reg_str:upper() == "SP" then return 13
    end
    error("Ungültiges Register: " .. reg_str)
end

function Assembler:evaluate_expression(expr)
    if expr == nil or expr == "" then return 0 end
    expr = expr:gsub("%s+", "")
    
    -- Prüfe ob es ein Register ist (dann nicht evaluieren)
    if self:is_register(expr) then
        error("Kann Register nicht als Zahl evaluieren: " .. expr)
    end
    
    -- Direkte Zahl
    local num = tonumber(expr)
    if num then return num end
    
    -- Hex-Zahl
    if expr:match("^0x[%x]+$") then
        return tonumber(expr, 16)
    end
    
    -- Symbol
    if self.symbol_table[expr] then
        return self.symbol_table[expr]
    end
    
    -- Label
    if self.labels[expr] then
        return self.labels[expr]
    end
    
    -- Mathematischer Ausdruck
    local processed = expr
    for sym, val in pairs(self.symbol_table) do
        processed = processed:gsub(sym, tostring(val))
    end
    for lbl, val in pairs(self.labels) do
        processed = processed:gsub(lbl, tostring(val))
    end
    
    processed = processed:gsub("0x(%x+)", function(x) return tostring(tonumber(x, 16)) end)
    
    local success, result = pcall(function()
        if processed:match("[^%d%+%-%*%/%(%)]") then
            error("Ungültige Zeichen")
        end
        return load("return " .. processed)()
    end)
    
    if success then return math.floor(result) end
    error("Ungültiger Ausdruck: " .. expr)
end

-- Preprocess für .equ Direktiven (muss VOR Pass1 kommen)
function Assembler:preprocess_equ_directives(source)
    local lines = self:split_lines(source)
    local other_lines = {}
    
    for _, line in ipairs(lines) do
        line = self:clean_line(line)
        if line:match("^%.equ%s+") or line:match("^[%w_]+%s*=%s*") then
            self:process_equ_directive(line)
        else
            table.insert(other_lines, line)
        end
    end
    
    return table.concat(other_lines, "\n")
end

function Assembler:process_equ_directive(line)
    local symbol, value
    
    if line:match("^%.equ") then
        symbol, value = line:match("^%.equ%s+(%S+)%s+(.+)$")
    else
        symbol, value = line:match("^([%w_]+)%s*=%s*(.+)$")
    end
    
    if symbol and value then
        self.symbol_table[symbol] = self:evaluate_expression(value)
        print(string.format("Symbol definiert: %s = %d (0x%04X)", symbol, self.symbol_table[symbol], self.symbol_table[symbol]))
    end
end

function Assembler:encode_ldi(operands)
    if #operands ~= 1 then error("LDI benötigt einen Operand") end
    local imm = self:evaluate_expression(operands[1])
    if imm < 0 or imm > 0x7FFF then error("LDI Immediate zu groß") end
    return imm
end

function Assembler:encode_lsi(operands)
    if #operands ~= 2 then error("LSI benötigt Rd, imm7") end
    local rd = self:parse_register(operands[1])
    local imm = self:evaluate_expression(operands[2])
    if imm < -64 or imm > 63 then error("LSI Immediate außerhalb -64..63") end
    if imm < 0 then imm = 128 + imm end
    return 0xF000 | (rd << 7) | (imm & 0x7F)
end

function Assembler:encode_ldst(mnemonic, operands)
    if #operands ~= 2 then error(mnemonic .. " benötigt Rd, [Seg:Base,offset]") end
    
    local rd = self:parse_register(operands[1])
    local mem_op = operands[2]
    local seg, base, offset = mem_op:match("%[([^:]+):([^,%]]+),?([^%]]*)%]")
    if not seg then error("Ungültiger Memory-Operand") end
    
    local seg_code = SEGMENTS[seg:upper()] or error("Ungültiges Segment")
    local base_reg = self:parse_register(base)
    local offset_val = offset and self:evaluate_expression(offset) or 0
    if offset_val < 0 or offset_val > 3 then error("Offset muss 0-3 sein") end
    
    local opcode = 0x8000 | ((mnemonic == "ST" and 1 or 0) << 13)
    opcode = opcode | (seg_code << 11) | (rd << 7) | (base_reg << 3) | offset_val
    return opcode
end

function Assembler:encode_alu(mnemonic, operands)
    local alu_ops = {ADD=0, SUB=1, AND=2, OR=3, XOR=4, MUL=5, DIV=6}
    local op_val = alu_ops[mnemonic] or error("Unbekannte ALU-Operation")
    
    if #operands < 2 then error(mnemonic .. " benötigt Rd, Rs/imm") end
    
    local rd = self:parse_register(operands[1])
    local w_flag, i_flag, src_val = 1, 0, 0
    
    -- w=0 handling
    if #operands >= 3 and operands[#operands] == "w=0" then
        w_flag = 0
        table.remove(operands, #operands)
    end
    
    -- Entscheidung Register vs Immediate Mode
    if #operands == 2 then
        -- Register mode - prüfe ob zweiter Operand ein Register ist
        if self:is_register(operands[2]) then
            src_val = self:parse_register(operands[2])
            i_flag = 0
        else
            -- Es ist ein Immediate
            src_val = self:evaluate_expression(operands[2])
            if src_val < 0 or src_val > 15 then error("ALU Immediate muss 0-15 sein") end
            i_flag = 1
        end
    else
        -- Immediate mode mit explizitem Wert
        src_val = self:evaluate_expression(operands[2])
        if src_val < 0 or src_val > 15 then error("ALU Immediate muss 0-15 sein") end
        i_flag = 1
    end
    
    return 0xC000 | (op_val << 10) | (rd << 6) | (w_flag << 5) | (i_flag << 4) | src_val
end

function Assembler:encode_shift(operands)
    if #operands < 3 then error("SHIFT benötigt Rd, Typ, Count") end
    
    local rd = self:parse_register(operands[1])
    local shift_type = SHIFT_TYPES[operands[2]:upper()] or error("Ungültiger Shift-Typ")
    local count = self:evaluate_expression(operands[3])
    if count < 0 or count > 7 then error("Shift-Count muss 0-7 sein") end
    
    local c_flag = (#operands >= 4 and operands[4]:upper() == "C=1") and 1 or 0
    
    return 0xCE00 | (rd << 8) | (c_flag << 7) | (shift_type << 5) | count
end

function Assembler:encode_mov(operands)
    if #operands ~= 3 then error("MOV benötigt Rd, Rs, imm2") end
    
    local rd = self:parse_register(operands[1])
    local rs = self:parse_register(operands[2])
    local imm = self:evaluate_expression(operands[3])
    if imm < 0 or imm > 3 then error("MOV Immediate muss 0-3 sein") end
    
    return 0xF800 | (rd << 6) | (rs << 2) | imm
end

function Assembler:encode_jmp(mnemonic, operands)
    local jump_types = {JMP=0, JZ=1, JNZ=2, JC=3, JNC=4, JN=5, JNN=6, JRL=7}
    local type_val = jump_types[mnemonic] or error("Unbekannter Sprung-Typ")
    
    if #operands ~= 1 then error(mnemonic .. " benötigt einen Operand") end
    
    if mnemonic == "JRL" then
        return 0xEE00 | (self:parse_register(operands[1]) << 4)
    else
        local target = self:evaluate_expression(operands[1])
        local relative_offset = target - (self.address + 1)
        
        if relative_offset < -128 or relative_offset > 127 then
            error("Sprung-Offset zu groß: " .. relative_offset)
        end
        
        if relative_offset < 0 then
            relative_offset = 256 + relative_offset
        end
        
        return 0xE000 | (type_val << 8) | (relative_offset & 0xFF)
    end
end

function Assembler:parse_instruction(line)
    local mnemonic, operands_str = line:match("^(%S+)%s*(.*)$")
    if not mnemonic then return nil end
    
    mnemonic = mnemonic:upper()
    local operands = {}
    for op in operands_str:gmatch("[^,%s]+") do
        table.insert(operands, op)
    end
    
    if mnemonic == "LDI" then 
        return self:encode_ldi(operands)
    elseif mnemonic == "LSI" then 
        return self:encode_lsi(operands)
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
    if not file then error("Kann Datei nicht öffnen: " .. filename) end
    local source = file:read("*a")
    file:close()
    
    -- PREPROCESS: .equ Direktiven zuerst verarbeiten
    source = self:preprocess_equ_directives(source)
    
    self:pass1(source)
    self:pass2(source)
    
    return self.output
end

function Assembler:pass1(source)
    self.address = 0
    self.labels = {}
    
    for _, line in ipairs(self:split_lines(source)) do
        line = self:clean_line(line)
        if line ~= "" then
            if line:match("^%.") then
                self:process_directive(line, true)
            else
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
    
    for _, line in ipairs(self:split_lines(source)) do
        line = self:clean_line(line)
        if line ~= "" then
            if line:match("^%.") then
                self:process_directive(line, false)
            else
                local _, rest = line:match("^([%w_]+):%s*(.*)$")
                if rest then line = rest end
                if line and line ~= "" then
                    local instruction = self:parse_instruction(line)
                    if instruction then
                        table.insert(self.output, instruction)
                        self.address = self.address + 1
                    end
                end
            end
        end
    end
end

function Assembler:clean_line(line)
    return line:gsub(";.*", ""):gsub("%s+$", ""):gsub("^%s+", "")
end

function Assembler:split_lines(text)
    local lines = {}
    for line in text:gmatch("[^\r\n]+") do
        table.insert(lines, line)
    end
    return lines
end

function Assembler:process_directive(line, is_pass1)
    local directive, args = line:match("^%.(%S+)%s*(.*)$")
    if not directive then return end
    
    directive = directive:upper()
    args = args:gsub("^%s+", ""):gsub("%s+$", "")
    
    if directive == "ORG" then
        self.address = self:evaluate_expression(args)
    elseif directive == "DW" then
        if not is_pass1 then
            for value in args:gmatch("%S+") do
                table.insert(self.output, self:evaluate_expression(value))
                self.address = self.address + 1
            end
        else
            for _ in args:gmatch("%S+") do
                self.address = self.address + 1
            end
        end
    end
end

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
    
    print("cMIN-16a Machine Code:")
    for i, code in ipairs(machine_code) do
        print(string.format("%04X: %04X", i-1, code))
    end
end

if arg and arg[0]:match("cMIN16a_assembler.lua") then
    main()
end

return Assembler
