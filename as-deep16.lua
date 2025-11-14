-- as-deep16.lua
-- Deep16 Assembler Implementation for Milestone 1r6
-- COMPLETE VERSION with .equ support and binary output

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
    LSI = 0xEE00,
    MOV = 0xF800,
    LDS = 0xF000,
    STS = 0xF000,
    SET = 0xFC00,
    CLR = 0xFC00,
    MVS = 0x3F00,
    SMV = 0x3FC0,
    SWB = 0x7F80,
    INV = 0x7F90,
    NEG = 0xFF80,
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

-- SMV Source Codes
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
    self.segments = {
        CODE = { address = 0x0000, data = {} },
        DATA = { address = 0x0100, data = {} },
        STACK = { address = 0x0400, data = {} }
    }
    self.labels = {}
    self.start_address = 0x0000
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

function Assembler:evaluate_expression_direct(expr)
    if expr == nil or expr == "" then return 0 end
    
    expr = expr:gsub("%s+", ""):gsub(",", ""):gsub(";.*", "")
    
    local num = tonumber(expr)
    if num then return num end
    
    if expr:match("^0x[%x]+$") then
        return tonumber(expr, 16)
    end
    
    if expr:match("^0b[01]+$") then
        return tonumber(expr:sub(3), 2)
    end
    
    if self.symbol_table[expr] then
        return self.symbol_table[expr]
    end
    
    if self.labels[expr] then
        return self.labels[expr]
    end
    
    error("Ungültiger Ausdruck: '" .. expr .. "'")
end

function Assembler:evaluate_expression(expr)
    if expr == nil or expr == "" then return 0 end
    expr = expr:gsub("%s+", "")
    
    if self:is_register(expr) then
        return nil
    end
    
    local num = tonumber(expr)
    if num then return num end
    
    if expr:match("^0x[%x]+$") then
        return tonumber(expr, 16)
    end
    
    if expr:match("^0b[01]+$") then
        return tonumber(expr:sub(3), 2)
    end
    
    if self.symbol_table[expr] then
        return self.symbol_table[expr]
    end
    
    if self.labels[expr] then
        return self.labels[expr]
    end
    
    error("Ungültiger Ausdruck: " .. expr)
end

-- ENCODING FUNCTIONS

function Assembler:encode_ldi(operands)
    if #operands ~= 1 then error("LDI benötigt einen Operand") end
    local imm = self:evaluate_expression(operands[1])
    if imm == nil then error("LDI erwartet Immediate, nicht Register") end
    if imm < 0 or imm > 0x7FFF then error("LDI Immediate zu groß") end
    return imm
end

function Assembler:encode_ldst(mnemonic, operands)
    if #operands ~= 3 then 
        error(mnemonic .. " benötigt Rd, Rb, offset (gefunden: " .. #operands .. " Operanden)")
    end
    
    local rd = self:parse_register(operands[1])
    local rb = self:parse_register(operands[2])
    local offset = self:evaluate_expression(operands[3])
    
    if offset == nil then error("Offset erwartet Immediate, nicht Register") end
    if offset < 0 or offset > 31 then error("Offset muss 0-31 sein") end
    
    local d_bit = (mnemonic == "ST") and 1 or 0
    
    return 0x8000 | (d_bit << 13) | (rd << 9) | (rb << 5) | offset
end

function Assembler:encode_alu(mnemonic, operands)
    local alu_ops = {ADD=0, SUB=1, AND=2, OR=3, XOR=4, MUL=5, DIV=6}
    local op_val = alu_ops[mnemonic] or error("Unbekannte ALU-Operation")
    
    if #operands < 2 then error(mnemonic .. " benötigt Rd, Rs/imm") end
    
    local rd = self:parse_register(operands[1])
    local w_flag, i_flag, src_val = 1, 0, 0
    
    if #operands >= 3 and operands[#operands] == "w=0" then
        w_flag = 0
        table.remove(operands, #operands)
    end
    
    if #operands >= 2 and self:is_register(operands[2]) then
        src_val = self:parse_register(operands[2])
        i_flag = 0
    else
        src_val = self:evaluate_expression(operands[2])
        if src_val == nil then error(mnemonic .. " erwartet Register oder Immediate") end
        if src_val < 0 or src_val > 15 then error("ALU Immediate muss 0-15 sein") end
        i_flag = 1
    end
    
    if (mnemonic == "MUL" or mnemonic == "DIV") and i_flag == 1 and (rd % 2 ~= 0) then
        error(mnemonic .. " mit i=1 benötigt ein gerades Register (R0, R2, R4, ..., R14)")
    end
    
    return 0xC000 | (op_val << 10) | (rd << 6) | (w_flag << 5) | (i_flag << 4) | src_val
end

function Assembler:encode_shift(operands)
    if #operands ~= 2 then error("Shift benötigt Rd, Count") end
    
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

-- FIXED: encode_jmp function
function Assembler:encode_jmp(mnemonic, operands)
    local jump_types = {JMP=0, JZ=1, JNZ=2, JC=3, JNC=4, JN=5, JNN=6}
    local type_val = jump_types[mnemonic] or error("Unbekannter Sprung-Typ")
    
    if #operands ~= 1 then error(mnemonic .. " benötigt einen Operand") end
    
    local target = self:evaluate_expression(operands[1])
    if target == nil then error("Sprungziel erwartet Label oder Adresse") end
    
    -- DEBUG: Check what type of value we got
    if type(target) == "table" then
        error("Label '" .. operands[1] .. "' nicht gefunden oder ungültig")
    end
    
    local relative_offset = target - (self.address + 1)
    
    if relative_offset < -256 or relative_offset > 255 then
        error("Sprung-Offset zu groß: " .. relative_offset .. " (Ziel: " .. target .. ", Aktuell: " .. (self.address + 1) .. ")")
    end
    
    if relative_offset < 0 then
        relative_offset = 512 + relative_offset  -- Convert to 9-bit signed
    end
    
    return 0xE000 | (type_val << 9) | (relative_offset & 0x1FF)
end

function Assembler:encode_lsi(operands)
    if #operands ~= 2 then error("LSI benötigt Rd, imm5") end
    
    local rd = self:parse_register(operands[1])
    local imm = self:evaluate_expression(operands[2])
    if imm == nil then error("LSI erwartet Immediate, nicht Register") end
    if imm < -16 or imm > 15 then error("LSI Immediate außerhalb -16..15") end
    
    if imm < 0 then
        imm = 32 + imm
    end
    
    return 0xE000 | (0x7 << 9) | (rd << 5) | (imm & 0x1F)
end

function Assembler:encode_lds_sts(mnemonic, operands)
    if #operands ~= 3 then error(mnemonic .. " benötigt Rd, Seg, Rs") end
    
    local rd = self:parse_register(operands[1])
    local seg_str = operands[2]:upper()
    local rs = self:parse_register(operands[3])
    
    local seg_code = SEGMENTS[seg_str] or error("Ungültiges Segment: " .. seg_str)
    local d_bit = (mnemonic == "STS") and 1 or 0
    
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
    
    if SEGMENTS[operands[1]:upper()] then
        d_bit = 1
        seg = SEGMENTS[operands[1]:upper()]
        rd = self:parse_register(operands[2])
    elseif SEGMENTS[operands[2]:upper()] then
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
    
    return 0x3FC0 | (src_val << 4) | dst_reg
end

function Assembler:encode_ljmp(operands)
    if #operands ~= 1 then error("LJMP benötigt Rs") end
    
    local rs = self:parse_register(operands[1])
    
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

-- HAUPTPARSER FÜR ALLE BEFEHLE - COMPLETE VERSION
function Assembler:parse_instruction(line)
    local mnemonic, operands_str = line:match("^(%S+)%s*(.*)$")
    if not mnemonic then 
        if line:match("^;") or line == "" then
            return nil
        else
            error("Ungültige Anweisung: " .. line)
        end
    end
    
    mnemonic = mnemonic:upper()
    local operands = {}
    
    for op in operands_str:gmatch("[^,%s]+") do
        table.insert(operands, op)
    end
    
    -- CRITICAL FIX: LSI must be checked BEFORE any other 1110-prefix instructions
    if mnemonic == "LSI" then
        return self:encode_lsi(operands)
    
    -- Then check other instructions
    elseif mnemonic == "LDI" then 
        return self:encode_ldi(operands)
    elseif mnemonic == "LD" or mnemonic == "ST" then 
        return self:encode_ldst(mnemonic, operands)
    elseif mnemonic == "LDS" or mnemonic == "STS" then
        return self:encode_lds_sts(mnemonic, operands)
    elseif mnemonic == "ADD" or mnemonic == "SUB" or mnemonic == "AND" or
           mnemonic == "OR" or mnemonic == "XOR" or mnemonic == "MUL" or
           mnemonic == "DIV" then
        return self:encode_alu(mnemonic, operands)
    elseif mnemonic == "SL" or mnemonic == "SLC" or mnemonic == "SR" or
           mnemonic == "SRC" or mnemonic == "SRA" or mnemonic == "SAC" or
           mnemonic == "ROR" or mnemonic == "ROC" then
        return self:encode_shift({mnemonic, unpack(operands)})
    elseif mnemonic == "JMP" or mnemonic == "JZ" or mnemonic == "JNZ" or
           mnemonic == "JC" or mnemonic == "JNC" or mnemonic == "JN" or
           mnemonic == "JNN" then
        return self:encode_jmp(mnemonic, operands)
    elseif mnemonic == "MOV" then 
        return self:encode_mov(operands)
    elseif mnemonic == "MVS" then
        return self:encode_mvs(operands)
    elseif mnemonic == "SMV" then
        return self:encode_smv(operands)
    elseif mnemonic == "LJMP" then
        return self:encode_ljmp(operands)
    elseif mnemonic == "SWB" or mnemonic == "INV" then
        return self:encode_swb_inv(mnemonic, operands)
    elseif mnemonic == "NEG" then
        return self:encode_neg(operands)
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
    
    -- Remove any problematic characters and normalize line endings
    source = source:gsub('\r\n', '\n'):gsub('\r', '\n')
    
    -- Preprocess: handle .equ directives first
    source = self:preprocess_equ_directives(source)
    
    self:pass1(source)
    self:pass2(source)
    
    return self:generate_binary()
end

-- Enhanced preprocess that handles .equ directives
function Assembler:preprocess_equ_directives(source)
    local lines = self:split_lines(source)
    local other_lines = {}
    
    for _, line in ipairs(lines) do
        local cleaned_line = self:clean_line(line)
        
        -- Handle .equ directive
        if cleaned_line:match("^%.equ%s+") then
            local symbol, value = cleaned_line:match("^%.equ%s+([%w_]+)%s*,?%s*(.+)$")
            if symbol and value then
                -- Remove any trailing commas from value
                value = value:gsub(",.*", "")
                local num_value = self:evaluate_expression_direct(value)
                self.symbol_table[symbol] = num_value
                print(string.format("Symbol definiert: %s = %d (0x%04X)", symbol, num_value, num_value))
            end
        -- Handle symbol=value format (alternative to .equ)
        elseif cleaned_line:match("^[%w_]+%s*=%s*") and not cleaned_line:match(":") then
            local symbol, value = cleaned_line:match("^([%w_]+)%s*=%s*(.+)$")
            if symbol and value then
                -- Remove any trailing commas from value
                value = value:gsub(",.*", "")
                local num_value = self:evaluate_expression_direct(value)
                self.symbol_table[symbol] = num_value
                print(string.format("Symbol definiert: %s = %d (0x%04X)", symbol, num_value, num_value))
            end
        else
            table.insert(other_lines, line)
        end
    end
    
    return table.concat(other_lines, "\n")
end

-- FIXED: pass1 function
function Assembler:pass1(source)
    self.address = 0
    self.labels = {}
    self.current_segment = "CODE"
    
    for _, line in ipairs(self:split_lines(source)) do
        local cleaned = self:clean_line(line)
        if cleaned ~= "" then
            if cleaned:match("^%.") then
                self:process_directive(cleaned, true)
            else
                local label, rest = cleaned:match("^([%w_]+):%s*(.*)$")
                if label then
                    -- Store just the address, not a table
                    self.labels[label] = self.address
                    cleaned = rest
                end
                if cleaned and cleaned ~= "" and not cleaned:match("^;") then
                    self.address = self.address + 1
                end
            end
        end
    end
end

function Assembler:pass2(source)
    self.address = 0
    self.current_segment = "CODE"
    self.segments = {
        CODE = { address = 0x0000, data = {} },
        DATA = { address = 0x0100, data = {} },
        STACK = { address = 0x0400, data = {} }
    }
    
    for _, line in ipairs(self:split_lines(source)) do
        local cleaned = self:clean_line(line)
        if cleaned ~= "" then
            if cleaned:match("^%.") then
                self:process_directive(cleaned, false)
            else
                local _, rest = cleaned:match("^([%w_]+):%s*(.*)$")
                if rest then cleaned = rest end
                if cleaned and cleaned ~= "" and not cleaned:match("^;") then
                    local instruction = self:parse_instruction(cleaned)
                    if instruction then
                        table.insert(self.segments[self.current_segment].data, instruction)
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
    for line in text:gmatch("([^\n]+)") do
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
    elseif directive == "START" then
        self.start_address = self:evaluate_expression_direct(args)
    elseif directive == "CODE" then
        self.current_segment = "CODE"
        if args ~= "" then
            self.segments.CODE.address = self:evaluate_expression_direct(args)
        end
    elseif directive == "DATA" then
        self.current_segment = "DATA"
        if args ~= "" then
            self.segments.DATA.address = self:evaluate_expression_direct(args)
        end
    elseif directive == "STACK" then
        self.current_segment = "STACK"
        if args ~= "" then
            self.segments.STACK.address = self:evaluate_expression_direct(args)
        end
    elseif directive == "DW" then
        if not is_pass1 then
            for value in args:gmatch("%S+") do
                local num_value = self:evaluate_expression_direct(value)
                table.insert(self.segments[self.current_segment].data, num_value)
                self.address = self.address + 1
            end
        else
            for _ in args:gmatch("%S+") do
                self.address = self.address + 1
            end
        end
    end
end

-- Generate binary output for simulator
function Assembler:generate_binary()
    local binary = {}
    
    -- Header: Magic number "DeepSeek16" (10 bytes)
    local magic = "DeepSeek16"
    for i = 1, #magic do
        table.insert(binary, string.byte(magic, i))
    end
    
    -- Version (2 bytes)
    table.insert(binary, 0x00) -- Major version
    table.insert(binary, 0x01) -- Minor version
    
    -- Start address (2 bytes)
    table.insert(binary, (self.start_address >> 8) & 0xFF)
    table.insert(binary, self.start_address & 0xFF)
    
    -- Number of segments (1 byte)
    local segment_count = 0
    for seg_name, seg_data in pairs(self.segments) do
        if #seg_data.data > 0 then
            segment_count = segment_count + 1
        end
    end
    table.insert(binary, segment_count)
    
    -- Segment entries
    for seg_name, seg_data in pairs(self.segments) do
        if #seg_data.data > 0 then
            -- Segment type (1 byte)
            local seg_type = 0
            if seg_name == "CODE" then seg_type = 0x01
            elseif seg_name == "DATA" then seg_type = 0x02
            elseif seg_name == "STACK" then seg_type = 0x03 end
            
            table.insert(binary, seg_type)
            
            -- Load address (2 bytes)
            table.insert(binary, (seg_data.address >> 8) & 0xFF)
            table.insert(binary, seg_data.address & 0xFF)
            
            -- Data length in words (2 bytes)
            local length = #seg_data.data
            table.insert(binary, (length >> 8) & 0xFF)
            table.insert(binary, length & 0xFF)
            
            -- Segment data (each word as 2 bytes)
            for _, word in ipairs(seg_data.data) do
                table.insert(binary, (word >> 8) & 0xFF)
                table.insert(binary, word & 0xFF)
            end
        end
    end
    
    return binary
end

-- Save binary to file
function Assembler:save_binary(filename, binary_data)
    local file = io.open(filename, "wb")
    if not file then
        error("Kann Datei nicht schreiben: " .. filename)
    end
    
    for _, byte in ipairs(binary_data) do
        file:write(string.char(byte))
    end
    
    file:close()
end

function main()
    if #arg < 1 then
        print("Usage: lua as-deep16.lua <sourcefile.asm> [output.bin]")
        os.exit(1)
    end
    
    local input_file = arg[1]
    local output_file = arg[2] or string.gsub(input_file, "%.asm$", ".bin")
    
    local assembler = Assembler.new()
    print("Deep16 Assembler (Milestone 1r6) - Binary Output Version")
    print("========================================================")
    
    local success, binary_data = pcall(function() 
        return assembler:assemble_file(input_file) 
    end)
    
    if not success then
        print("Assemblierungsfehler: " .. binary_data)
        os.exit(1)
    end
    
    -- Save binary file
    assembler:save_binary(output_file, binary_data)
    
    print("\nAssemblierung erfolgreich!")
    print(string.format("Ausgabedatei: %s", output_file))
    print(string.format("Größe: %d Bytes", #binary_data))
    
    -- Print segment summary
    print("\nSegmentübersicht:")
    for seg_name, seg_data in pairs(assembler.segments) do
        if #seg_data.data > 0 then
            print(string.format("  %s: 0x%04X - %d Worte", 
                seg_name, seg_data.address, #seg_data.data))
        end
    end
    print(string.format("Startadresse: 0x%04X", assembler.start_address))
end

if arg and arg[0]:match("as%-deep16%.lua") then
    main()
end

return Assembler
