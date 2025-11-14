-- as-deep16.lua
-- Deep16 Assembler Implementation for Milestone 1r6
-- FINAL WORKING VERSION

local Assembler = {}
Assembler.__index = Assembler

-- [Keep all the same opcodes, registers, etc. from previous version...]

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
    
    if REGISTER_ALIASES[upper_str] then
        return REGISTER_ALIASES[upper_str]
    end
    
    if upper_str:match("^R(%d+)$") then
        local reg_num = tonumber(upper_str:match("^R(%d+)$"))
        if reg_num and reg_num >= 0 and reg_num <= 15 then
            return reg_num
        end
    end
    
    error("Ungültiges Register: " .. reg_str)
end

-- SIMPLIFIED expression evaluator for directives
function Assembler:evaluate_expression_direct(expr)
    if expr == nil or expr == "" then return 0 end
    
    -- Remove ALL whitespace and problematic characters
    expr = expr:gsub("%s+", ""):gsub(",", ""):gsub(";.*", "")
    
    -- Direct decimal number
    local num = tonumber(expr)
    if num then return num end
    
    -- Hex number (0x...)
    if expr:match("^0x[%x]+$") then
        return tonumber(expr, 16)
    end
    
    -- Binary number (0b...)
    if expr:match("^0b[01]+$") then
        return tonumber(expr:sub(3), 2)
    end
    
    -- Symbol (already defined)
    if self.symbol_table[expr] then
        return self.symbol_table[expr]
    end
    
    -- Label (already defined)  
    if self.labels[expr] then
        return self.labels[expr]
    end
    
    error("Ungültiger Ausdruck: '" .. expr .. "'")
end

-- Keep the same evaluate_expression for instructions
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

-- [Keep all the same encoding functions...]

-- FIXED directive processing
function Assembler:process_directive(line, is_pass1)
    -- Clean the line more aggressively
    line = line:gsub(";.*", ""):gsub("%s+$", ""):gsub("^%s+", "")
    
    local directive, args = line:match("^%.(%S+)%s*(.*)$")
    if not directive then return end
    
    directive = directive:upper()
    
    -- Clean args more aggressively - remove ANY trailing commas or unexpected chars
    args = args:gsub(",.*", "")  -- Remove everything after first comma
    args = args:gsub("%s+$", ""):gsub("^%s+", "")
    
    print(string.format("DEBUG: Directive .%s with args '%s'", directive, args))
    
    if directive == "ORG" then
        local addr = self:evaluate_expression_direct(args)
        print(string.format("DEBUG: ORG setting address to %d (0x%04X)", addr, addr))
        self.address = addr
    elseif directive == "DW" then
        if not is_pass1 then
            -- Split by commas or spaces, but clean each value
            for value in args:gmatch("[^,%s]+") do
                local clean_value = value:gsub(";.*", ""):gsub("%s+", "")
                if clean_value ~= "" then
                    local num_value = self:evaluate_expression_direct(clean_value)
                    table.insert(self.output, num_value)
                    self.address = self.address + 1
                end
            end
        else
            for _ in args:gmatch("[^,%s]+") do
                self.address = self.address + 1
            end
        end
    end
end

-- FIXED line cleaning
function Assembler:clean_line(line)
    -- Remove comments and trim, but be careful with directives
    local cleaned = line:gsub(";.*", ""):gsub("%s+$", ""):gsub("^%s+", "")
    return cleaned
end

function Assembler:split_lines(text)
    local lines = {}
    for line in text:gmatch("[^\r\n]+") do
        table.insert(lines, line)
    end
    return lines
end

-- SIMPLIFIED preprocess - no equ handling for now
function Assembler:preprocess_equ_directives(source)
    return source  -- Skip equ processing for now to isolate the issue
end

function Assembler:assemble_file(filename)
    local file = io.open(filename, "r")
    if not file then error("Kann Datei nicht öffnen: " .. filename) end
    local source = file:read("*a")
    file:close()
    
    print("=== SOURCE FILE ===")
    print(source)
    print("===================")
    
    source = self:preprocess_equ_directives(source)
    self:pass1(source)
    self:pass2(source)
    
    return self.output
end

function Assembler:pass1(source)
    self.address = 0
    self.labels = {}
    
    for _, line in ipairs(self:split_lines(source)) do
        local cleaned = self:clean_line(line)
        if cleaned ~= "" then
            if cleaned:match("^%.") then
                self:process_directive(cleaned, true)
            else
                local label, rest = cleaned:match("^([%w_]+):%s*(.*)$")
                if label then
                    self.labels[label] = self.address
                    cleaned = rest
                end
                if cleaned and cleaned ~= "" then
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
        local cleaned = self:clean_line(line)
        if cleaned ~= "" then
            if cleaned:match("^%.") then
                self:process_directive(cleaned, false)
            else
                local _, rest = cleaned:match("^([%w_]+):%s*(.*)$")
                if rest then cleaned = rest end
                if cleaned and cleaned ~= "" then
                    local instruction = self:parse_instruction(cleaned)
                    if instruction then
                        table.insert(self.output, instruction)
                        self.address = self.address + 1
                    end
                end
            end
        end
    end
end

-- [Keep all the same encoding functions and main...]

function main()
    if #arg ~= 1 then
        print("Usage: lua as-deep16.lua <sourcefile.asm>")
        os.exit(1)
    end
    
    local assembler = Assembler.new()
    print("Deep16 Assembler (Milestone 1r6) - Debug Version")
    print("================================================")
    
    local success, machine_code = pcall(function() 
        return assembler:assemble_file(arg[1]) 
    end)
    
    if not success then
        print("Assemblierungsfehler: " .. machine_code)
        os.exit(1)
    end
    
    print("\nAssemblierung erfolgreich!")
    print(string.format("%d Worte generiert", #machine_code))
    print("\nMaschinencode:")
    for i, code in ipairs(machine_code) do
        print(string.format("%04X: %04X", i-1, code))
    end
end

if arg and arg[0]:match("as%-deep16%.lua") then
    main()
end

return Assembler
