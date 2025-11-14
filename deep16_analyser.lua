-- deep16_analyzer.lua
-- Deep16 Binary File Analyzer

local Deep16Analyzer = {}
Deep16Analyzer.__index = Deep16Analyzer

function Deep16Analyzer.new()
    local self = setmetatable({}, Deep16Analyzer)
    return self
end

function Deep16Analyzer:load_binary(filename)
    local file = io.open(filename, "rb")
    if not file then
        error("Kann Datei nicht öffnen: " .. filename)
    end
    
    local data = file:read("*a")
    file:close()
    
    return data
end

function Deep16Analyzer:analyze(filename)
    print("Deep16 Binary File Analyzer")
    print("===========================")
    print("Datei: " .. filename)
    print()
    
    local binary_data = self:load_binary(filename)
    
    if #binary_data < 16 then
        error("Datei zu klein für Deep16 Binary Format")
    end
    
    -- Read header
    local magic = binary_data:sub(1, 10)
    if magic ~= "DeepSeek16" then
        error("Ungültiges Deep16 Binary Format (falsche Magic Number)")
    end
    
    -- Parse header
    local version_major = string.byte(binary_data, 11)
    local version_minor = string.byte(binary_data, 12)
    local start_address = (string.byte(binary_data, 13) << 8) | string.byte(binary_data, 14)
    local segment_count = string.byte(binary_data, 15)
    
    print("Header Information:")
    print(string.format("  Magic: %s", magic))
    print(string.format("  Version: %d.%d", version_major, version_minor))
    print(string.format("  Startadresse: 0x%04X", start_address))
    print(string.format("  Anzahl Segmente: %d", segment_count))
    print()
    
    -- Parse segments
    local offset = 16  -- Start after header
    local total_words = 0
    local total_bytes = 0
    
    print("Segment Information:")
    print("-------------------")
    
    for i = 1, segment_count do
        if offset + 5 > #binary_data then
            error("Ungültige Segment-Definition (Datei zu klein)")
        end
        
        local seg_type = string.byte(binary_data, offset)
        local seg_addr = (string.byte(binary_data, offset + 1) << 8) | string.byte(binary_data, offset + 2)
        local seg_length = (string.byte(binary_data, offset + 3) << 8) | string.byte(binary_data, offset + 4)
        
        -- Segment type to string
        local seg_type_str
        if seg_type == 0x01 then
            seg_type_str = "CODE"
        elseif seg_type == 0x02 then
            seg_type_str = "DATA"
        elseif seg_type == 0x03 then
            seg_type_str = "STACK"
        else
            seg_type_str = string.format("UNKNOWN(0x%02X)", seg_type)
        end
        
        -- Calculate segment boundaries
        local seg_end_addr = seg_addr + seg_length - 1
        local seg_data_size = seg_length * 2  -- 2 bytes per word
        
        print(string.format("Segment %d:", i))
        print(string.format("  Typ: %s", seg_type_str))
        print(string.format("  Ladeadresse: 0x%04X", seg_addr))
        print(string.format("  Länge: %d Worte (%d Bytes)", seg_length, seg_data_size))
        print(string.format("  Bereich: 0x%04X - 0x%04X", seg_addr, seg_end_addr))
        
        -- Show first few words for CODE segments
        if seg_type == 0x01 and seg_length > 0 then
            print("  Erste Anweisungen:")
            local data_offset = offset + 5
            for j = 1, math.min(5, seg_length) do
                if data_offset + 1 <= #binary_data then
                    local word = (string.byte(binary_data, data_offset) << 8) | string.byte(binary_data, data_offset + 1)
                    print(string.format("    0x%04X: 0x%04X", seg_addr + j - 1, word))
                    data_offset = data_offset + 2
                end
            end
            if seg_length > 5 then
                print(string.format("    ... (%d weitere Anweisungen)", seg_length - 5))
            end
        end
        
        -- Show data preview for DATA segments
        if seg_type == 0x02 and seg_length > 0 then
            print("  Datenvorschau:")
            local data_offset = offset + 5
            local values = {}
            for j = 1, math.min(8, seg_length) do
                if data_offset + 1 <= #binary_data then
                    local word = (string.byte(binary_data, data_offset) << 8) | string.byte(binary_data, data_offset + 1)
                    table.insert(values, string.format("0x%04X", word))
                    data_offset = data_offset + 2
                end
            end
            print("    [" .. table.concat(values, ", ") .. "]")
            if seg_length > 8 then
                print(string.format("    ... (%d weitere Werte)", seg_length - 8))
            end
        end
        
        total_words = total_words + seg_length
        total_bytes = total_bytes + seg_data_size
        offset = offset + 5 + (seg_length * 2)
        
        print()
    end
    
    -- Summary
    print("Zusammenfassung:")
    print("---------------")
    print(string.format("Gesamtgröße: %d Bytes", #binary_data))
    print(string.format("Code/Data: %d Worte (%d Bytes)", total_words, total_bytes))
    print(string.format("Header-Overhead: %d Bytes", 16))
    print(string.format("Ausführung startet bei: 0x%04X", start_address))
    
    -- Check for unused data
    if offset < #binary_data then
        local unused_bytes = #binary_data - offset
        print(string.format("Warnung: %d ungenutzte Bytes am Dateiende", unused_bytes))
    end
    
    -- Memory usage analysis
    print()
    print("Speichernutzungsanalyse:")
    print("-----------------------")
    
    -- Re-analyze segments for memory map
    offset = 16
    local memory_map = {}
    
    for i = 1, segment_count do
        local seg_type = string.byte(binary_data, offset)
        local seg_addr = (string.byte(binary_data, offset + 1) << 8) | string.byte(binary_data, offset + 2)
        local seg_length = (string.byte(binary_data, offset + 3) << 8) | string.byte(binary_data, offset + 4)
        
        local seg_type_str = (seg_type == 0x01 and "CODE") or (seg_type == 0x02 and "DATA") or (seg_type == 0x03 and "STACK") or "UNKNOWN"
        
        table.insert(memory_map, {
            type = seg_type_str,
            start = seg_addr,
            end_addr = seg_addr + seg_length - 1,
            size = seg_length
        })
        
        offset = offset + 5 + (seg_length * 2)
    end
    
    -- Sort memory map by address
    table.sort(memory_map, function(a, b) return a.start < b.start end)
    
    for i, seg in ipairs(memory_map) do
        print(string.format("  0x%04X - 0x%04X: %s (%d Worte)", 
            seg.start, seg.end_addr, seg.type, seg.size))
    end
    
    -- Check for overlaps
    for i = 1, #memory_map - 1 do
        if memory_map[i].end_addr >= memory_map[i + 1].start then
            print(string.format("Warnung: Segment-Überlappung zwischen %s und %s", 
                memory_map[i].type, memory_map[i + 1].type))
        end
    end
end

-- Disassemble a single instruction (basic version)
function Deep16Analyzer:disassemble_instruction(instruction)
    local opcode = (instruction >> 13) & 0x7
    
    if opcode == 0 then
        -- LDI
        local imm = instruction & 0x7FFF
        return string.format("LDI %d", imm)
    elseif opcode == 2 then
        -- LD/ST
        local d = (instruction >> 13) & 1
        local rd = (instruction >> 9) & 0xF
        local rb = (instruction >> 5) & 0xF
        local offset = instruction & 0x1F
        local mnemonic = (d == 0) and "LD" or "ST"
        return string.format("%s R%d, R%d, %d", mnemonic, rd, rb, offset)
    elseif opcode == 3 then
        -- ALU operations
        local alu_ops = {"ADD", "SUB", "AND", "OR", "XOR", "MUL", "DIV", "SHIFT"}
        local op = (instruction >> 10) & 0x7
        local rd = (instruction >> 6) & 0xF
        local w = (instruction >> 5) & 1
        local i = (instruction >> 4) & 1
        local src = instruction & 0xF
        
        local src_str = (i == 0) and string.format("R%d", src) or tostring(src)
        local suffix = (w == 0) and ", w=0" or ""
        return string.format("%s R%d, %s%s", alu_ops[op + 1], rd, src_str, suffix)
    elseif opcode == 4 then
        -- JMP operations
        local types = {"JMP", "JZ", "JNZ", "JC", "JNC", "JN", "JNN", "LSI"}
        local type_val = (instruction >> 9) & 0x7
        local target = instruction & 0x1FF
        
        -- Convert 9-bit signed to 16-bit signed
        if target >= 0x100 then
            target = target - 0x200
        end
        
        if type_val == 7 then
            -- LSI
            local rd = (instruction >> 5) & 0xF
            local imm = instruction & 0x1F
            if imm >= 0x10 then imm = imm - 0x20 end
            return string.format("LSI R%d, %d", rd, imm)
        else
            return string.format("%s %d", types[type_val + 1], target)
        end
    elseif (instruction & 0xF800) == 0xF800 then
        -- MOV
        local rd = (instruction >> 6) & 0xF
        local rs = (instruction >> 2) & 0xF
        local imm = instruction & 0x3
        return string.format("MOV R%d, R%d, %d", rd, rs, imm)
    elseif instruction == 0xFFF1 then
        return "HLT"
    elseif instruction == 0xFFF0 then
        return "NOP"
    else
        return string.format("0x%04X", instruction)
    end
end

-- Extended analysis with disassembly
function Deep16Analyzer:analyze_with_disassembly(filename)
    print("Deep16 Binary File Analyzer mit Disassemblierung")
    print("================================================")
    
    local binary_data = self:load_binary(filename)
    
    -- Parse header (same as before)
    local magic = binary_data:sub(1, 10)
    local start_address = (string.byte(binary_data, 13) << 8) | string.byte(binary_data, 14)
    local segment_count = string.byte(binary_data, 15)
    
    print(string.format("Datei: %s", filename))
    print(string.format("Startadresse: 0x%04X", start_address))
    print()
    
    -- Analyze segments with disassembly
    local offset = 16
    
    for i = 1, segment_count do
        local seg_type = string.byte(binary_data, offset)
        local seg_addr = (string.byte(binary_data, offset + 1) << 8) | string.byte(binary_data, offset + 2)
        local seg_length = (string.byte(binary_data, offset + 3) << 8) | string.byte(binary_data, offset + 4)
        
        local seg_type_str = (seg_type == 0x01 and "CODE") or (seg_type == 0x02 and "DATA") or (seg_type == 0x03 and "STACK") or "UNKNOWN"
        
        print(string.format("%s Segment (0x%04X - 0x%04X, %d Worte):", 
            seg_type_str, seg_addr, seg_addr + seg_length - 1, seg_length))
        print(string.format("%-8s %-20s %s", "Adresse", "Maschinencode", "Disassemblierung"))
        print(string.format("%-8s %-20s %s", "--------", "-------------", "----------------"))
        
        local data_offset = offset + 5
        
        for j = 1, seg_length do
            if data_offset + 1 <= #binary_data then
                local word = (string.byte(binary_data, data_offset) << 8) | string.byte(binary_data, data_offset + 1)
                local address = seg_addr + j - 1
                local disasm = self:disassemble_instruction(word)
                
                if seg_type == 0x01 then  -- CODE segment
                    print(string.format("0x%04X  0x%04X              %s", address, word, disasm))
                else  -- DATA segment
                    print(string.format("0x%04X  0x%04X              %d", address, word, word))
                end
                
                data_offset = data_offset + 2
            end
        end
        
        offset = offset + 5 + (seg_length * 2)
        print()
    end
end

function main()
    if #arg < 1 then
        print("Usage: lua deep16_analyzer.lua <binary_file.bin> [options]")
        print()
        print("Options:")
        print("  -d    Detaillierte Analyse mit Disassemblierung")
        print("  -h    Diese Hilfe anzeigen")
        print()
        print("Beispiele:")
        print("  lua deep16_analyzer.lua program.bin")
        print("  lua deep16_analyzer.lua program.bin -d")
        os.exit(1)
    end
    
    local filename = arg[1]
    local detailed = false
    
    for i = 2, #arg do
        if arg[i] == "-d" then
            detailed = true
        elseif arg[i] == "-h" then
            print("Deep16 Binary File Analyzer")
            print("Analysiert Deep16 Binary Dateien und zeigt Metadaten, Segmente und Speichernutzung.")
            os.exit(0)
        end
    end
    
    local analyzer = Deep16Analyzer.new()
    
    local success, error_msg = pcall(function()
        if detailed then
            analyzer:analyze_with_disassembly(filename)
        else
            analyzer:analyze(filename)
        end
    end)
    
    if not success then
        print("Fehler: " .. error_msg)
        os.exit(1)
    end
end

if arg and arg[0]:match("deep16_analyzer%.lua") then
    main()
end

return Deep16Analyzer
