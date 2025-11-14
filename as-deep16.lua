-- as-deep16.lua
-- Deep16 Assembler Implementation for Milestone 1r6
-- COMPLETE VERSION with all instructions

local Assembler = {}
Assembler.__index = Assembler

-- [Keep all the same opcodes, registers, etc. from previous version...]

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
    
    -- ADD THE MISSING INSTRUCTIONS:
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

-- ADD THE MISSING ENCODING FUNCTIONS:

function Assembler:encode_lds_sts(mnemonic, operands)
    if #operands ~= 3 then error(mnemonic .. " benötigt Rd, Seg, Rs") end
    
    local rd = self:parse_register(operands[1])
    local seg_str = operands[2]:upper()
    local rs = self:parse_register(operands[3])
    
    local seg_code = SEGMENTS[seg_str] or error("Ungültiges Segment: " .. seg_str)
    local d_bit = (mnemonic == "STS") and 1 or 0
    
    return 0xF000 | (d_bit << 11) | (seg_code << 9) | (rd << 5) | rs
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

function Assembler:encode_setclr(mnemonic, operands)
    if #operands ~= 1 then error(mnemonic .. " benötigt Bitmask") end
    
    local bitmask = self:evaluate_expression(operands[1])
    if bitmask == nil then error(mnemonic .. " erwartet Bitmask") end
    if bitmask < 0 or bitmask > 0xFF then error("Bitmask muss 0-255 sein") end
    
    local s_bit = (mnemonic == "SET") and 1 or 0
    
    return 0xFC00 | (s_bit << 8) | bitmask
end

-- [Keep all other functions the same...]
