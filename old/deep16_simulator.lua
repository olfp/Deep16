-- deep16_simulator.lua
-- Deep16 Simulator with Memory Output - UPDATED VERSION

local Deep16Simulator = {}
Deep16Simulator.__index = Deep16Simulator

function Deep16Simulator.new()
    local self = setmetatable({}, Deep16Simulator)
    
    -- 16 general purpose registers
    self.registers = {}
    for i = 0, 15 do
        self.registers[i] = 0
    end
    
    -- Special registers
    self.PC = 0x0000  -- Program Counter
    self.PSW = 0x0000 -- Processor Status Word
    self.CS = 0x0000  -- Code Segment
    self.DS = 0x0001  -- Data Segment  
    self.SS = 0x0002  -- Stack Segment
    self.ES = 0x0003  -- Extra Segment
    
    -- Shadow registers
    self.PC_shadow = 0x0000
    self.PSW_shadow = 0x0000
    self.CS_shadow = 0x0000
    
    -- Memory: 2MB total (1M words), organized as 16 segments of 64K words
    self.memory = {}
    for i = 0, 0xFFFFF do
        self.memory[i] = 0
    end
    
    -- Execution state
    self.halted = false
    self.cycle_count = 0
    self.interrupt_enabled = true
    
    -- PSW flag positions
    self.PSW_FLAGS = {
        N = 0,  -- Negative
        Z = 1,  -- Zero
        V = 2,  -- Overflow
        C = 3,  -- Carry
        S = 4,  -- Shadow mode
        I = 5   -- Interrupt enable
    }
    
    return self
end

function Deep16Simulator:get_PSW_flag(flag)
    local mask = 1 << self.PSW_FLAGS[flag]
    return (self.PSW & mask) ~= 0
end

function Deep16Simulator:set_PSW_flag(flag, value)
    local mask = 1 << self.PSW_FLAGS[flag]
    if value then
        self.PSW = self.PSW | mask
    else
        self.PSW = self.PSW & ~mask
    end
end

function Deep16Simulator:get_segment_register(seg_code)
    if seg_code == 0 then return self.CS
    elseif seg_code == 1 then return self.DS
    elseif seg_code == 2 then return self.SS
    elseif seg_code == 3 then return self.ES
    end
    return 0
end

function Deep16Simulator:calculate_physical_address(segment, offset)
    -- Physical address = (segment << 4) + offset (word addresses)
    return (segment << 4) + offset
end

function Deep16Simulator:read_memory_word(address)
    -- Read 16-bit word from physical memory (word address)
    if address < 0 or address > 0xFFFFF then
        error(string.format("Memory read out of bounds: 0x%05X", address))
    end
    return self.memory[address]
end

function Deep16Simulator:write_memory_word(address, value)
    -- Write 16-bit word to physical memory (word address)
    if address < 0 or address > 0xFFFFF then
        error(string.format("Memory write out of bounds: 0x%05X", address))
    end
    self.memory[address] = value & 0xFFFF
end

function Deep16Simulator:load_binary(filename)
    local file = io.open(filename, "rb")
    if not file then
        error("Cannot open file: " .. filename)
    end
    
    local data = file:read("*a")
    file:close()
    
    -- Parse Deep16 binary format
    local magic = data:sub(1, 10)
    if magic ~= "DeepSeek16" then
        error("Invalid Deep16 binary format")
    end
    
    local start_address = (string.byte(data, 13) << 8) | string.byte(data, 14)
    local segment_count = string.byte(data, 15)
    
    print(string.format("Loading binary: start=0x%04X, segments=%d", start_address, segment_count))
    
    local offset = 16
    for i = 1, segment_count do
        if offset + 5 > #data then break end
        
        local seg_type = string.byte(data, offset)
        local seg_addr = (string.byte(data, offset + 1) << 8) | string.byte(data, offset + 2)
        local seg_length = (string.byte(data, offset + 3) << 8) | string.byte(data, offset + 4)
        
        print(string.format("  Loading segment %d: type=%d, addr=0x%04X, words=%d", 
              i, seg_type, seg_addr, seg_length))
        
        local data_offset = offset + 5
        for j = 0, seg_length - 1 do
            if data_offset + 1 <= #data then
                local word = (string.byte(data, data_offset) << 8) | string.byte(data, data_offset + 1)
                -- For CODE segments, load at CS:address
                -- For DATA segments, load at DS:address  
                if seg_type == 0x01 then -- CODE
                    local phys_addr = self:calculate_physical_address(self.CS, seg_addr + j)
                    self:write_memory_word(phys_addr, word)
                elseif seg_type == 0x02 then -- DATA
                    local phys_addr = self:calculate_physical_address(self.DS, seg_addr + j)
                    self:write_memory_word(phys_addr, word)
                elseif seg_type == 0x03 then -- STACK
                    local phys_addr = self:calculate_physical_address(self.SS, seg_addr + j)
                    self:write_memory_word(phys_addr, word)
                end
                data_offset = data_offset + 2
            end
        end
        
        offset = offset + 5 + (seg_length * 2)
    end
    
    self.PC = start_address
    self.registers[13] = 0x0400 -- Initialize SP
end

function Deep16Simulator:fetch_instruction()
    local phys_addr = self:calculate_physical_address(self.CS, self.PC)
    local instruction = self:read_memory_word(phys_addr)
    self.PC = self.PC + 1
    return instruction
end

function Deep16Simulator:update_flags_arithmetic(result, a, b, operation)
    -- Update N, Z, V, C flags based on arithmetic operation
    local result16 = result & 0xFFFF
    
    -- Negative flag
    self:set_PSW_flag("N", (result16 & 0x8000) ~= 0)
    
    -- Zero flag
    self:set_PSW_flag("Z", result16 == 0)
    
    -- Carry flag (for addition/subtraction)
    if operation == "add" then
        self:set_PSW_flag("C", result > 0xFFFF)
    elseif operation == "sub" then
        self:set_PSW_flag("C", a < b)
    end
    
    -- Overflow flag (simplified)
    if operation == "add" then
        local a_sign = (a & 0x8000) ~= 0
        local b_sign = (b & 0x8000) ~= 0
        local r_sign = (result16 & 0x8000) ~= 0
        self:set_PSW_flag("V", (a_sign == b_sign) and (a_sign ~= r_sign))
    elseif operation == "sub" then
        local a_sign = (a & 0x8000) ~= 0
        local b_sign = (b & 0x8000) ~= 0
        local r_sign = (result16 & 0x8000) ~= 0
        self:set_PSW_flag("V", (a_sign ~= b_sign) and (a_sign ~= r_sign))
    end
end

function Deep16Simulator:update_flags_logical(result)
    local result16 = result & 0xFFFF
    self:set_PSW_flag("N", (result16 & 0x8000) ~= 0)
    self:set_PSW_flag("Z", result16 == 0)
    self:set_PSW_flag("V", false)
    self:set_PSW_flag("C", false)
end

function Deep16Simulator:execute_alu(instruction)
    local alu_op = (instruction >> 10) & 0x7
    local rd = (instruction >> 6) & 0xF
    local w = (instruction >> 5) & 1
    local i = (instruction >> 4) & 1
    local src_val = instruction & 0xF

    local operand
    if i == 0 then -- Register mode
        operand = self.registers[src_val]
    else -- Immediate mode
        operand = src_val
    end

    local result
    local update_flags = true

    if alu_op == 0 then -- ADD
        result = self.registers[rd] + operand
        if w == 1 then
            self.registers[rd] = result & 0xFFFF
        end
        self:update_flags_arithmetic(result, self.registers[rd], operand, "add")
        
    elseif alu_op == 1 then -- SUB
        result = self.registers[rd] - operand
        if w == 1 then
            self.registers[rd] = result & 0xFFFF
        end
        self:update_flags_arithmetic(result, self.registers[rd], operand, "sub")
        
    elseif alu_op == 2 then -- AND
        result = self.registers[rd] & operand
        if w == 1 then
            self.registers[rd] = result
        end
        self:update_flags_logical(result)
        
    elseif alu_op == 3 then -- OR
        result = self.registers[rd] | operand
        if w == 1 then
            self.registers[rd] = result
        end
        self:update_flags_logical(result)
        
    elseif alu_op == 4 then -- XOR
        result = self.registers[rd] ~ operand
        if w == 1 then
            self.registers[rd] = result
        end
        self:update_flags_logical(result)
        
    else
        print(string.format("ALU op %d not implemented yet", alu_op))
        -- For now, just do nothing for unimplemented ALU ops
    end
end

function Deep16Simulator:execute_jump(instruction)
    local type_field = (instruction >> 9) & 0x7
    
    if type_field == 0x7 then -- LSI
        local rd = (instruction >> 5) & 0xF
        local imm = instruction & 0x1F
        -- Sign extend 5-bit immediate
        if (imm & 0x10) ~= 0 then
            imm = imm | 0xFFE0
        end
        self.registers[rd] = imm
        
    else -- JMP
        local target = instruction & 0x1FF
        -- Sign extend 9-bit offset
        if (target & 0x100) ~= 0 then
            target = target | 0xFE00
        end
        
        local jump = false
        if type_field == 0 then -- JMP (always)
            jump = true
        elseif type_field == 1 then -- JZ
            jump = self:get_PSW_flag("Z")
        elseif type_field == 2 then -- JNZ
            jump = not self:get_PSW_flag("Z")
        elseif type_field == 3 then -- JC
            jump = self:get_PSW_flag("C")
        elseif type_field == 4 then -- JNC
            jump = not self:get_PSW_flag("C")
        elseif type_field == 5 then -- JN
            jump = self:get_PSW_flag("N")
        elseif type_field == 6 then -- JNN
            jump = not self:get_PSW_flag("N")
        end
        
        if jump then
            self.PC = self.PC + target
        end
    end
end

function Deep16Simulator:execute_instruction(instruction)
    local opcode = instruction & 0xF000
    
    if opcode == 0x0000 then -- LDI
        local imm = instruction & 0x7FFF
        self.registers[0] = imm
        
    elseif opcode == 0x8000 then -- LD/ST
        local d = (instruction >> 13) & 1
        local rd = (instruction >> 9) & 0xF
        local rb = (instruction >> 5) & 0xF
        local offset = instruction & 0x1F
        
        -- Determine segment based on base register
        local segment
        if rb == 13 then -- SP uses SS
            segment = self.SS
        else
            segment = self.DS -- Default to DS
        end
        
        local eff_addr = self.registers[rb] + offset
        local phys_addr = self:calculate_physical_address(segment, eff_addr)
        
        if d == 0 then -- LD
            self.registers[rd] = self:read_memory_word(phys_addr)
        else -- ST
            self:write_memory_word(phys_addr, self.registers[rd])
        end
        
    elseif opcode == 0xC000 then -- ALU operations
        self:execute_alu(instruction)
        
    elseif opcode == 0xE000 then -- JMP/LSI
        self:execute_jump(instruction)
        
    elseif (instruction & 0xFC00) == 0xF800 then -- MOV
        local rd = (instruction >> 6) & 0xF
        local rs = (instruction >> 2) & 0xF
        local imm = instruction & 0x3
        self.registers[rd] = self.registers[rs] + imm
        
    elseif (instruction & 0xFF00) == 0x3F00 then -- MVS
        local d = (instruction >> 8) & 1
        local rd = (instruction >> 4) & 0xF
        local seg = instruction & 0x3
        
        if d == 0 then -- Move from segment to register
            self.registers[rd] = self:get_segment_register(seg)
        else -- Move from register to segment
            if seg == 0 then self.CS = self.registers[rd]
            elseif seg == 1 then self.DS = self.registers[rd]
            elseif seg == 2 then self.SS = self.registers[rd]
            elseif seg == 3 then self.ES = self.registers[rd] end
        end
        
    elseif instruction == 0xFFF0 then -- NOP
        -- Do nothing
        
    elseif instruction == 0xFFF2 then -- HLT
        self.halted = true
        
    else
        print(string.format("Unknown instruction: 0x%04X at PC=0x%04X", instruction, self.PC-1))
        -- Don't halt immediately, just skip and continue
        -- self.halted = true
    end
end

function Deep16Simulator:initialize_array_with_random_data()
    -- Initialize the array at DS:0x0100 with some test data
    local test_data = {
        45, 23, 78, 12, 89, 34, 67, 90, 11, 56,
        33, 77, 44, 22, 99, 1, 65, 32, 87, 54,
        21, 76, 43, 9, 88, 31, 66, 100, 2, 55,
        34, 79, 46, 13, 91, 35, 68, 92, 14, 57,
        36, 78, 47
    }
    
    for i = 0, 41 do
        local value = test_data[i + 1] or (i * 3 + 7) % 100  -- Fallback pattern
        local phys_addr = self:calculate_physical_address(self.DS, 0x0100 + i)
        self:write_memory_word(phys_addr, value)
    end
    
    print("Array initialized with test data")
end

function Deep16Simulator:run(max_cycles)
    max_cycles = max_cycles or 100000
    print(string.format("Starting simulation at PC=0x%04X", self.PC))
    
    while not self.halted and self.cycle_count < max_cycles do
        local instruction = self:fetch_instruction()
        self:execute_instruction(instruction)
        self.cycle_count = self.cycle_count + 1
        
        if self.cycle_count % 10000 == 0 then
            print(string.format("Cycle %d, PC=0x%04X", self.cycle_count, self.PC))
        end
    end
    
    if self.halted then
        print(string.format("Simulation halted after %d cycles", self.cycle_count))
    else
        print(string.format("Simulation stopped after %d cycles (max reached)", self.cycle_count))
    end
end

function Deep16Simulator:dump_memory_range(segment, start_addr, count)
    print(string.format("\nMemory dump (Segment %d, Address 0x%04X - 0x%04X):", 
          segment, start_addr, start_addr + count - 1))
    
    for i = 0, count - 1 do
        if i % 8 == 0 then
            if i > 0 then io.write("\n") end
            io.write(string.format("0x%04X: ", start_addr + i))
        end
        
        local phys_addr = self:calculate_physical_address(segment, start_addr + i)
        local value = self:read_memory_word(phys_addr)
        io.write(string.format("%5d ", value))
    end
    io.write("\n")
end

function Deep16Simulator:dump_registers()
    print("\nRegister dump:")
    for i = 0, 15 do
        local alias = ""
        if i == 12 then alias = " (FP)"
        elseif i == 13 then alias = " (SP)" 
        elseif i == 14 then alias = " (LR)"
        elseif i == 15 then alias = " (PC)"
        end
        print(string.format("  R%d: 0x%04X %d%s", i, self.registers[i], self.registers[i], alias))
    end
    print(string.format("  PSW: 0x%04X", self.PSW))
    print(string.format("  CS: 0x%04X, DS: 0x%04X, SS: 0x%04X, ES: 0x%04X", 
          self.CS, self.DS, self.SS, self.ES))
end

function main()
    if #arg < 1 then
        print("Usage: lua deep16_simulator.lua <binary_file.bin> [max_cycles]")
        print()
        print("Examples:")
        print("  lua deep16_simulator.lua bubble_sort.bin")
        print("  lua deep16_simulator.lua program.bin 50000")
        os.exit(1)
    end
    
    local filename = arg[1]
    local max_cycles = arg[2] and tonumber(arg[2]) or 100000
    
    local simulator = Deep16Simulator.new()
    
    local success, error_msg = pcall(function()
        simulator:load_binary(filename)
        
        -- Initialize array with test data instead of zeros
        simulator:initialize_array_with_random_data()
        
        -- Show initial array state
        print("\nInitial array state (first 10 elements):")
        simulator:dump_memory_range(1, 0x0100, 10)
        
        simulator:run(max_cycles)
        
        -- Show final state
        simulator:dump_registers()
        
        -- Show sorted array
        print("\nFinal array state:")
        simulator:dump_memory_range(1, 0x0100, 42)
        
        -- Verify if array is sorted
        local sorted = true
        local prev = -1
        for i = 0, 41 do
            local phys_addr = simulator:calculate_physical_address(1, 0x0100 + i)
            local current = simulator:read_memory_word(phys_addr)
            if current < prev then
                sorted = false
                print(string.format("Sort error at position %d: %d < %d", i, current, prev))
                break
            end
            prev = current
        end
        
        if sorted then
            print("\n✓ Array is properly sorted!")
        else
            print("\n✗ Array is NOT sorted correctly!")
        end
    end)
    
    if not success then
        print("Simulation error: " .. error_msg)
        os.exit(1)
    end
end

if arg and arg[0]:match("deep16_simulator%.lua") then
    main()
end

return Deep16Simulator
