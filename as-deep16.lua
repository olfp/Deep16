-- as-deep16.lua
-- Deep16 Assembler Implementation for Milestone 1r6

local Assembler = {}
Assembler.__index = Assembler

-- Opcode-Definitionen für Deep16 Milestone 1r6
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
    LSI = 0xEE00,  -- JMP type3=111 with LSI format
    MOV = 0xF800,
    LDS = 0xF000,  -- 11110 opcode
    STS = 0xF000,
    SET = 0xFC00,
    CLR = 0xFC00,
    MVS = 0x3F00,
    SMV = 0x3FC0,
    SWB = 0x7F80,
    INV = 0x7F90,
    NEG = 0xFF80,  -- 111111111110 opcode
    NOP = 0xFFF0,
    HLT = 0xFFF2,
    SWI = 0xFFF4,
    RETI = 0xFFF6
}

-- Shift Type Mapping
local SHIFT_TYPES = { 
    SL = 0, SLC = 0, 
    SR = 1, SRC = 1,
    SRA = 2, SAC = 2,
    ROR = 3, ROC = 3
}

-- Segment Register Codes
local SEGMENTS = { CS = 0, DS = 1, SS = 2, ES = 3 }

-- SMV Source Codes (korrigiert für konsistente Semantik)
local SMV_SOURCES = { 
    ["APC"] = 0, ["PC"] = 0,
    ["APSW"] = 1, ["PSW"] = 2
}

-- Register Aliases
local REGISTER_ALIASES = {
    FP = 12,
    SP = 13, 
    LR = 14,
    PC = 15
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

function Assembler:is_register(str)
    return str:match("^[Rr]%d+$") or REGISTER_ALIASES[str:upper()] or str:upper() == "PC"
end

function Assembler:parse_register(reg_str)
    local upper_str = reg_str:upper()
    
    -- Check for aliases first
    if REGISTER_ALIASES[upper_str] then
        return REGISTER_ALIASES[upper_str]
    end
    
    -- Check for R0-R15 format
    if upper_str:match("^R(%d+)$") then
        local reg_num = tonumber(upper_str:match("^R(%d+)$"))
        if reg_num and reg_num >= 0 and reg_num <= 15 then
            return reg_num
        end
    end
    
    error("Ungültiges Register: " .. reg_str)
end

function Assembler:evaluate_expression(expr)
    if expr == nil or expr == "" then return 0 end
    expr = expr:gsub("%s+", "")
    
    -- Prüfe ob es ein Register ist (dann nicht evaluieren)
    if self:is_register(expr) then
        return nil -- Signal dass es ein Register ist
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

-- Preprocess für .equ Direktiven
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
        local num_value = self:evaluate_expression_direct(value)
        self.symbol_table[symbol] = num_value
        print(string.format("Symbol definiert: %s = %d (0x%04X)", symbol, num_value, num_value))
    end
end

function Assembler:evaluate_expression_direct(expr)
    if expr == nil or expr == "" then return 0 end
    expr = expr:gsub("%s+", "")
    
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
    
    -- Mathematischer Ausdruck
    local processed = expr
    for sym, val in pairs(self.symbol_table) do
        processed = processed:gsub(sym, tostring(val))
    end
    
    processed = processed:gsub("0x(%x+)", function(x) return tostring(tonumber(x, 16)) end)
    
    local success, result = pcall(function()
        return load("return " .. processed)()
    end)
    
    if success then return math.floor(result) end
    error("Ungültiger Ausdruck: " .. expr)
end

-- ENCODING FUNKTIONEN (aktualisiert für Deep16)

function Assembler:encode_ldi(operands)
    if #operands ~= 1 then error("LDI benötigt einen Operand") end
    local imm = self:evaluate_expression(operands[1])
    if imm == nil then error("LDI erwartet Immediate, nicht Register") end
    if imm < 0 or imm > 0x7FFF then error("LDI Immediate zu groß") end
    return imm
end

function Assembler:encode_ldst(mnemonic, operands)
    if #operands ~= 3 then error(mnemonic .. " benötigt Rd, Rb, offset") end
    
    local rd = self:parse_register(operands[1])
    local rb = self:parse_register(operands[2])
    local offset = self:evaluate_expression(operands[3])
    
    if offset == nil then error("Offset erwartet Immediate, nicht Register") end
    if offset < 0 or offset > 31 then error("Offset muss 0-31 sein") end
    
    local d_bit = (mnemonic == "ST") and 1 or 0
    
    -- Format: [10][d1][Rd4][Rb4][offset5]
    return 0x8000 | (d_bit << 13) | (rd << 9) | (rb << 5) | offset
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
    
    -- Für MUL/DIV 32-bit: Rd muss gerade sein
    if (mnemonic == "MUL" or mnemonic == "DIV") and i_flag == 1 and (rd % 2 ~= 0) then
        error(mnemonic .. " mit i=1 benötigt ein gerades Register (R0, R2, R4, ..., R14)")
    end
    
    -- Entscheidung Register vs Immediate Mode
    if #operands >= 2 and self:is_register(operands[2]) then
        -- Register mode
        src_val = self:parse_register(operands[2])
        i_flag = 0
    else
        -- Immediate mode
        src_val = self:evaluate_expression(operands[2])
        if src_val == nil then error(mnemonic .. " erwartet Register oder Immediate") end
        if src_val < 0 or src_val > 15 then error("ALU Immediate muss 0-15 sein") end
        i_flag = 1
    end
    
    return 0xC000 | (op_val << 10) | (rd << 6) | (w_flag << 5) | (i_flag << 4) | src_val
end

function Assembler:encode_shift(operands)
    if #operands < 2 then error("Shift benötigt Rd, Count") end
    
    local mnemonic = operands[1]:upper()
    local rd = self:parse_register(operands[2])
    local count = 0
    
    if #operands >= 3 then
        count = self:evaluate_expression(operands[3])
        if count == nil then error("Shift Count erwartet Immediate") end
    end
    
    if count < 0 or count > 7 then error("Shift-Count muss 0-7 sein") end
    
    local shift_type = SHIFT_TYPES[mnemonic] or error("Ungültiger Shift-Typ: " .. mnemonic)
    local c_flag = (mnemonic:match("C$")) and 1 or 0
    
    return 0xCE00 | (rd << 8) | (c_flag << 7) | (shift_type << 5) | count
end

function Assembler:encode_jmp(mnemonic, operands)
    local jump_types = {JMP=0, JZ=1, JNZ=2, JC=3, JNC=4, JN=5, JNN=6}
    local type_val = jump_types[mnemonic] or error("Unbekannter Sprung-Typ")
    
    if #operands ~= 1 then error(mnemonic .. " benötigt einen Operand") end
    
    local target = self:evaluate_expression(operands[1])
    if target == nil then error("Sprungziel erwartet Label oder Adresse") end
    
    local relative_offset = target - (self.address + 1)
    
    if relative_offset < -256 or relative_offset > 255 then
        error("Sprung-Offset zu groß: " .. relative_offset)
    end
    
    if relative_offset < 0 then
        relative_offset = 512 + relative_offset  -- 9-bit signed
    end
    
    -- Format: [1110][type3][target9]
    return 0xE000 | (type_val << 9) | (relative_offset & 0x1FF)
end

function Assembler:encode_lsi(operands)
    if #operands ~= 2 then error("LSI benötigt Rd, imm5") end
    
    local rd = self:parse_register(operands[1])
    local imm = self:evaluate_expression(operands[2])
    if imm == nil then error("LSI erwartet Immediate, nicht Register") end
    if imm < -16 or imm > 15 then error("LSI Immediate außerhalb -16..15") end
    
    if imm < 0 then
        imm = 32 + imm  -- 5-bit signed
    end
    
    -- Format: [1110][111][Rd4][imm5]
    return 0xE000 | (0x7 << 9) | (rd << 5) | (imm & 0x1F)
end

function Assembler:encode_lds_sts(mnemonic, operands)
    if #operands ~= 3 then error(mnemonic .. " benötigt Rd, Seg, Rs") end
    
    local rd = self:parse_register(operands[1])
    local seg_str = operands[2]:upper()
    local rs = self:parse_register(operands[3])
    
    local seg_code = SEGMENTS[seg_str] or error("Ungültiges Segment: " .. seg_str)
    local d_bit = (mnemonic == "STS") and 1 or 0
    
    -- Format: [11110][d1][seg2][Rd4][Rs4]
    return 0xF000 | (d_bit << 11) | (seg_code << 9) | (rd << 5) | rs
end

function Assembler:encode_mov(operands)
    if #operands ~= 3 then error("MOV benötigt Rd, Rs, imm2") end
    
    local rd = self:parse_register(operands[1])
    local rs = self:parse_register(operands[2])
    local imm = self:evaluate_expression(operands[3])
    if imm == nil then error("MOV Immediate erwartet Zahl") end
    if imm < 0 or imm > 3 then error("MOV Immediate muss 0-3 sein") end
    
    return 0xF800 | (rd << 6) | (rs << 2) | imm
end

function Assembler:encode_mvs(operands)
    if #operands ~= 2 then error("MVS benötigt zwei Operanden") end
    
    local d_bit, rd, seg
    
    -- Prüfe ob erste Operand ein Segment-Register ist
    if SEGMENTS[operands[1]:upper()] then
        -- Format: MVS DS, R0  (Schreiben in Segment)
        d_bit = 1
        seg = SEGMENTS[operands[1]:upper()]
        rd = self:parse_register(operands[2])
    elseif SEGMENTS[operands[2]:upper()] then
        -- Format: MVS R1, CS  (Lesen aus Segment)  
        d_bit = 0
        rd = self:parse_register(operands[1])
        seg = SEGMENTS[operands[2]:upper()]
    else
        error("MVS erwartet ein Segment und ein Register")
    end
    
    return 0x3F00 | (d_bit << 8) | (rd << 4) | seg
end

function Assembler:encode_smv(operands)
    if #operands ~= 2 then error("SMV benötigt zwei Operanden") end
    
    local src_str = operands[1]:upper()
    local dst_str = operands[2]
    
    local src_val = SMV_SOURCES[src_str]
    if not src_val then
        error("Ungültige Quelle für SMV: " .. src_str .. " (erlaubt: APC, APSW, PSW, PC)")
    end
    
    local dst_reg = self:parse_register(dst_str)
    
    -- Format: [1111111110][src2][dst4]
    return 0x3FC0 | (src_val << 4) | dst_reg
end

function Assembler:encode_ljmp(operands)
    if #operands ~= 1 then error("LJMP benötigt Rs") end
    
    local rs = self:parse_register(operands[1])
    
    -- LJMP ist jetzt SMV mit src2=11
    return 0x3FC0 | (0x3 << 4) | rs
end

function Assembler:encode_swb_inv(mnemonic, operands)
    if #operands ~= 1 then error(mnemonic .. " benötigt Rx") end
    
    local rx = self:parse_register(operands[1])
    local s_bit = (mnemonic == "INV") and 1 or 0
    
    return 0x7F80 | (s_bit << 4) | rx
end

function Assembler:encode_neg(operands)
    if #operands ~= 1 then error("NEG benötigt Rx") end
    
    local rx = self:parse_register(operands[1])
    
    return 0xFF80 | rx
end

function Assembler:encode_setclr(mnemonic, operands)
    if #operands ~= 1 then error(mnemonic .. " benötigt Bitmask") end
    
    local bitmask = self:evaluate_expression(operands[1])
    if bitmask == nil then error(mnemonic .. " erwartet Bitmask") end
    if bitmask < 0 or bitmask > 0xFF then error("Bitmask muss 0-255 sein") end
    
    local s_bit = (mnemonic == "SET") and 1 or 0
    
    return 0xFC00 | (s_bit << 8) | bitmask
end

function Assembler:encode_sys(mnemonic, operands)
    local sys_ops = {
        NOP = 0x0, HLT = 0x1, SWI = 0x2, RETI = 0x3
    }
    
    local op_val = sys_ops[mnemonic] or error("Unbekannte System-Operation: " .. mnemonic)
    
    return 0xFFF0 | op_val
end

-- HAUPTPARSER FÜR ALLE BEFEHLE

function Assembler:parse_instruction(line)
    local mnemonic, operands_str = line:match("^(%S+)%s*(.*)$")
    if not mnemonic then return nil end
    
    mnemonic = mnemonic:upper()
    local operands = {}
    for op in operands_str:gmatch("[^,%s]+") do
        table.insert(operands, op)
    end
    
    -- ALU Operationen
    if mnemonic == "ADD" or mnemonic == "SUB" or mnemonic == "AND" or
       mnemonic == "OR" or mnemonic == "XOR" or mnemonic == "MUL" or
       mnemonic == "DIV" then
        return self:encode_alu(mnemonic, operands)
    
    -- Shift Operationen
    elseif mnemonic == "SL" or mnemonic == "SLC" or mnemonic == "SR" or
           mnemonic == "SRC" or mnemonic == "SRA" or mnemonic == "SAC" or
           mnemonic == "ROR" or mnemonic == "ROC" then
        return self:encode_shift({mnemonic, unpack(operands)})
    
    -- Sprungoperationen
    elseif mnemonic == "JMP" or mnemonic == "JZ" or mnemonic == "JNZ" or
           mnemonic == "JC" or mnemonic == "JNC" or mnemonic == "JN" or
           mnemonic == "JNN" then
        return self:encode_jmp(mnemonic, operands)
    
    -- LSI (Load Short Immediate)
    elseif mnemonic == "LSI" then
        return self:encode_lsi(operands)
    
    -- Datenoperationen
    elseif mnemonic == "LDI" then 
        return self:encode_ldi(operands)
    elseif mnemonic == "LD" or mnemonic == "ST" then 
        return self:encode_ldst(mnemonic, operands)
    elseif mnemonic == "LDS" or mnemonic == "STS" then
        return self:encode_lds_sts(mnemonic, operands)
    elseif mnemonic == "MOV" then 
        return self:encode_mov(operands)
    
    -- Segment- und Spezialoperationen
    elseif mnemonic == "MVS" then
        return self:encode_mvs(operands)
    elseif mnemonic == "SMV" then
        return self:encode_smv(operands)
    elseif mnemonic == "LJMP" then
        return self:encode_ljmp(operands)
    
    -- Neue Operationen
    elseif mnemonic == "SWB" or mnemonic == "INV" then
        return self:encode_swb_inv(mnemonic, operands)
    elseif mnemonic == "NEG" then
        return self:encode_neg(operands)
    
    -- Flag- und Systemoperationen
    elseif mnemonic == "SET" or mnemonic == "CLR" then
        return self:encode_setclr(mnemonic, operands)
    elseif mnemonic == "NOP" or mnemonic == "HLT" or mnemonic == "SWI" or mnemonic == "RETI" then
        return self:encode_sys(mnemonic, operands)
    
    else 
        error("Unbekannter Befehl: " .. mnemonic) 
    end
end

-- RESTLICHE FUNKTIONEN

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
        self.address = self:evaluate_expression_direct(args)
    elseif directive == "DW" then
        if not is_pass1 then
            for value in args:gmatch("%S+") do
                table.insert(self.output, self:evaluate_expression_direct(value))
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
        print("Usage: lua as-deep16.lua <sourcefile.asm>")
        os.exit(1)
    end
    
    local assembler = Assembler.new()
    print("Deep16 Assembler (Milestone 1r6)")
    print("================================")
    
    local success, machine_code = pcall(function() 
        return assembler:assemble_file(arg[1]) 
    end)
    
    if not success then
        print("Assemblierungsfehler: " .. machine_code)
        os.exit(1)
    end
    
    print("\nAssemblierung erfolgreich!")
    print("Maschinencode:")
    for i, code in ipairs(machine_code) do
        print(string.format("%04X: %04X", i-1, code))
    end
end

if arg and arg[0]:match("as%-deep16%.lua") then
    main()
end

return Assembler
