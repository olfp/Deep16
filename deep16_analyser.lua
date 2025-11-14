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

function Deep16Analyzer:print_hex_dump(data, max_bytes)
    print("Hex dump of file:")
    max_bytes = max_bytes or math.min(64, #data)
    for i = 1, max_bytes do
        if i % 16 == 1 then
            io.write(string.format("%04X: ", i-1))
        end
        io.write(string.format("%02X ", string.byte(data, i)))
        if i % 16 == 0 then
            io.write("\n")
        end
    end
    if max_bytes % 16 ~= 0 then
        io.write("\n")
    end
    print()
end

function Deep16Analyzer:analyze(filename)
    print("Deep16 Binary File Analyzer")
    print("===========================")
    print("Datei: " .. filename)
    
    local binary_data = self:load_binary(filename)
    
    print(string.format("Dateigröße: %d Bytes", #binary_data))
    
    -- Show hex dump for debugging
    self:print_hex_dump(binary_data, 32)
    
    if #binary_data < 16 then
        print("ERROR: Datei zu klein für Deep16 Binary Format (mindestens 16 Bytes benötigt)")
        return
    end
    
    -- Read and check magic number
    local magic = binary_data:sub(1, 10)
    print(string.format("Magic Number: '%s'", magic))
    
    if magic ~= "DeepSeek16" then
        print("WARNUNG: Ungültige Magic Number (erwartet: 'DeepSeek16')")
        print("Trotzdem versuche, Datei zu analysieren...")
    end
    
    -- Parse header
    local version_major = string.byte(binary_data, 11)
    local version_minor = string.byte(binary_data, 12)
    local start_address = (string.byte(binary_data, 13) << 8) | string.byte(binary_data, 14)
    local segment_count = string.byte(binary_data, 15)
    
    print("\nHeader Information:")
    print(string.format("  Magic: %s", magic))
    print(string.format("  Version: %d.%d", version_major, version_minor))
    print(string.format("  Startadresse: 0x%04X", start_address))
    print(string.format("  Anzahl Segmente: %d", segment_count))
    
    -- Parse segments
    local offset = 16  -- Start after header
    local total_words = 0
    local total_bytes = 0
    
    print("\nSegment Information:")
    print("-------------------")
    
    for i = 1, segment_count do
        if offset + 5 > #binary_data then
            print(string.format("ERROR: Segment %d: Nicht genug Daten (benötigt 5 Bytes, nur %d verfügbar)", 
                i, #binary_data - offset))
            break
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
        
        -- Check if we have enough data for this segment
        local expected_data_size = seg_length * 2
        if offset + 5 + expected_data_size - 1 > #binary_data then
            print(string.format("ERROR: Segment %d: Nicht genug Daten für %d Worte (benötigt %d Bytes, nur %d verfügbar)", 
                i, seg_length, expected_data_size, #binary_data - offset - 5))
            break
        end
        
        -- Calculate segment boundaries
        local seg_end_addr = seg_addr + seg_length - 1
        local seg_data_size = seg_length * 2  -- 2 bytes per word
        
        print(string.format("\nSegment %d:", i))
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
    end
    
    -- Summary
    print("\nZusammenfassung:")
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
    if segment_count > 0 then
        print("\nSpeichernutzungsanalyse:")
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
end

function main()
    if #arg < 1 then
        print("Usage: lua deep16_analyzer.lua <binary_file.bin>")
        print()
        print("Beispiele:")
        print("  lua deep16_analyzer.lua program.bin")
        os.exit(1)
    end
    
    local filename = arg[1]
    
    local analyzer = Deep16Analyzer.new()
    
    local success, error_msg = pcall(function()
        analyzer:analyze(filename)
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
