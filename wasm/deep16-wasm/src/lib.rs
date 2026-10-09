use wasm_bindgen::prelude::*;

// Memory-mapped keyboard controller (parity with the JS core): polled I/O only.
// KBD_STATUS reads 1 while a key is pending, KBD_DATA pops the waiting key.
const KBD_STATUS_ADDR: usize = 0xF0060;
const KBD_DATA_ADDR: usize = 0xF0062;

struct Cpu {
    mem: Vec<u16>,
    reg: [u16; 16],
    psw: u16,
    spsw: u16,
    cs: u16,
    sds: u16,
    sss: u16,
    ses: u16,
    scs: u16,
    spc: u16,
    ds: u16,
    ss: u16,
    es: u16,
    sr0: u16,
    sr1: u16,
    sr2: u16,
    sr3: u16,
    sr13: u16,
    sr14: u16,
    running: bool,
    delay_active: bool,
    delayed_pc: u16,
    delayed_cs: u16,
    delayed_to_shadow: bool,
    branch_taken: bool,
    last_alu_result: i32,
    last_op_alu: bool,
    last_alu_overflow: bool,
    // Tri-state carry from the last shift/rotate: None = not a shift (the
    // generic unsigned-overflow heuristic decides C), Some(-1) = shift with
    // count 0 (C stays unchanged), Some(0|1) = spec Table 7 carry-out.
    shift_carry_out: Option<i32>,
    kbd: Vec<u16>,
    kbd_last: u16,
    recent_addr: usize,
    recent_base: u16,
    recent_offset: u16,
    recent_seg_val: u16,
    recent_seg_idx: u16,
    recent_is_store: bool,
    last_event_code: u16,
    last_event_spc: u16,
    last_event_scs: u16,
}

static mut CPU: Option<Cpu> = None;

impl Cpu {
    fn new(mem_words: usize) -> Cpu {
        let mut reg = [0u16; 16];
        reg[13] = 0x7FFF;
        reg[15] = 0x0000;
        Cpu {
            mem: vec![0xFFFF; mem_words],
            reg,
            psw: 0,
            spsw: 0,
            cs: 0xFFFF,
            sds: 0,
            sss: 0,
            ses: 0,
            scs: 0,
            spc: 0,
            ds: 0x0000,
            ss: 0x0000,
            es: 0x0000,
            sr0: 0,
            sr1: 0,
            sr2: 0,
            sr3: 0,
            sr13: 0,
            sr14: 0,
            running: false,
            delay_active: false,
            delayed_pc: 0,
            delayed_cs: 0,
            delayed_to_shadow: false,
            branch_taken: false,
            last_alu_result: 0,
            last_op_alu: false,
            last_alu_overflow: false,
            shift_carry_out: None,
            kbd: Vec::new(),
            kbd_last: 0,
            recent_addr: 0,
            recent_base: 0,
            recent_offset: 0,
            recent_seg_val: 0,
            recent_seg_idx: 0,
            recent_is_store: false,
            last_event_code: 0,
            last_event_spc: 0,
            last_event_scs: 0,
        }
    }
    fn reset(&mut self) {
        self.mem.fill(0xFFFF);
        self.reg = [0u16; 16];
        self.reg[13] = 0x7FFF;
        self.reg[15] = 0x0000;
        self.psw = 0;
        self.spsw = 0;
        self.cs = 0xFFFF;
        self.sds = 0;
        self.sss = 0;
        self.ses = 0;
        self.scs = 0;
        self.spc = 0;
        self.ds = 0x0000;
        self.ss = 0x0000;
        self.es = 0x0000;
        self.sr0 = 0;
        self.sr1 = 0;
        self.sr2 = 0;
        self.sr3 = 0;
        self.sr13 = 0;
        self.sr14 = 0;
        self.running = false;
        self.delay_active = false;
        self.delayed_pc = 0;
        self.delayed_cs = 0;
        self.delayed_to_shadow = false;
        self.branch_taken = false;
        self.last_alu_result = 0;
        self.last_op_alu = false;
        self.last_alu_overflow = false;
        self.shift_carry_out = None;
        self.kbd.clear();
        self.kbd_last = 0;
        self.recent_addr = 0;
        self.recent_base = 0;
        self.recent_offset = 0;
        self.recent_seg_val = 0;
        self.recent_seg_idx = 0;
        self.recent_is_store = false;
        self.last_event_code = 0;
        self.last_event_spc = 0;
        self.last_event_scs = 0;
    }
}

unsafe fn cpu_mut() -> &'static mut Cpu {
    CPU.as_mut().expect("CPU not initialized")
}
unsafe fn cpu_ref() -> &'static Cpu {
    CPU.as_ref().expect("CPU not initialized")
}

#[wasm_bindgen]
pub fn init(mem_words: usize) {
    unsafe {
        let mut c = Cpu::new(mem_words);
        autoload_rom(&mut c);
        CPU = Some(c);
    }
}

#[wasm_bindgen]
pub fn reset() {
    unsafe {
        let c = cpu_mut();
        c.reset();
        autoload_rom(c);
    }
}

#[wasm_bindgen]
pub fn set_segments(cs: u16, ds: u16, ss: u16, es: u16) {
    unsafe {
        let c = cpu_mut();
        c.cs = cs;
        c.ds = ds;
        c.ss = ss;
        c.es = es;
    }
}

#[wasm_bindgen]
pub fn load_program(ptr: usize, data: Box<[u16]>) {
    unsafe {
        let c = cpu_mut();
        let len = data.len();
        if ptr + len > c.mem.len() {
            return;
        }
        for i in 0..len {
            c.mem[ptr + i] = data[i];
        }
        c.reg[15] = 0;
        c.cs = 0xFFFF;
    }
}

/// Overwrite the register file (R0..R15) from outside, mirroring
/// `get_registers`: while the shadow set is active (PSW.S = 1) element 15 is
/// the active (shadow) PC instead of R15, so the two calls round-trip and the
/// saved user PC stays untouched. Call `set_psw` first - element 15 is placed
/// according to the PSW.S bit that is current at call time.
#[wasm_bindgen]
pub fn set_registers(regs: &[u16]) {
    unsafe {
        let c = cpu_mut();
        let n = regs.len().min(16);
        for i in 0..n {
            if i == 15 && (c.psw & (1 << 5)) != 0 {
                c.spc = regs[15];
            } else {
                c.reg[i] = regs[i];
            }
        }
    }
}

/// Overwrite the PSW. Call before `set_registers`, which interprets its last
/// element through the S bit, exactly as `get_registers` reports it.
#[wasm_bindgen]
pub fn set_psw(psw: u16) {
    unsafe {
        cpu_mut().psw = psw;
    }
}

#[wasm_bindgen]
pub fn get_registers() -> Box<[u16]> {
    unsafe {
        let c = cpu_ref();
        let mut v = c.reg.to_vec();
        if (c.psw & (1 << 5)) != 0 { v[15] = c.spc; }
        v.into_boxed_slice()
    }
}

#[wasm_bindgen]
pub fn get_psw() -> u16 {
    unsafe { cpu_ref().psw }
}

#[wasm_bindgen]
pub fn get_segments() -> Box<[u16]> {
    unsafe {
        let c = cpu_ref();
        let in_shadow = (c.psw & (1 << 5)) != 0;
        let cs = if in_shadow { c.scs } else { c.cs };
        let ds = if in_shadow { c.sds } else { c.ds };
        let ss = if in_shadow { c.sss } else { c.ss };
        let es = if in_shadow { c.ses } else { c.es };
        vec![cs, ds, ss, es].into_boxed_slice()
    }
}

fn phys(seg: u16, off: u32) -> usize {
    (((seg as u32) << 4) + off) as usize
}

#[wasm_bindgen]
pub fn get_memory_slice(start: usize, count: usize) -> Box<[u16]> {
    unsafe {
        let c = cpu_ref();
        let end = start.saturating_add(count);
        let end = end.min(c.mem.len());
        c.mem[start..end].to_vec().into_boxed_slice()
    }
}

#[wasm_bindgen]
pub fn get_memory_word(addr: usize) -> u16 {
    unsafe {
        let c = cpu_ref();
        if addr < c.mem.len() { c.mem[addr] } else { 0xFFFF }
    }
}

fn is_stack_register(psw: u16, idx: usize) -> bool {
    let sr = ((psw >> 6) & 0xF) as usize;
    if sr == 0 { return false; }
    let dual = (psw & (1 << 10)) != 0;
    if dual { idx == sr || idx == (sr + 1) } else { idx == sr }
}

fn is_extra_register(psw: u16, idx: usize) -> bool {
    let er = ((psw >> 11) & 0xF) as usize;
    if er == 0 { return false; }
    let dual = (psw & (1 << 15)) != 0;
    if dual { idx == er || idx == (er + 1) } else { idx == er }
}

/// Read a general-purpose register through the active-bank view
/// (spec 4.1): while PSW.S=1 the set {R0-R3, R13, R14} lives in the shadow
/// bank (R0'-R3', R13'=SP', R14'=LR'); every other register is shared.
fn gp_read(c: &Cpu, idx: usize) -> u16 {
    if (c.psw & (1 << 5)) != 0 {
        match idx {
            0 => { return c.sr0; }
            1 => { return c.sr1; }
            2 => { return c.sr2; }
            3 => { return c.sr3; }
            13 => { return c.sr13; }
            14 => { return c.sr14; }
            _ => {}
        }
    }
    c.reg[idx]
}

/// Write a general-purpose register through the active-bank view (spec 4.1).
fn gp_write(c: &mut Cpu, idx: usize, val: u16) {
    if (c.psw & (1 << 5)) != 0 {
        match idx {
            0 => { c.sr0 = val; return; }
            1 => { c.sr1 = val; return; }
            2 => { c.sr2 = val; return; }
            3 => { c.sr3 = val; return; }
            13 => { c.sr13 = val; return; }
            14 => { c.sr14 = val; return; }
            _ => {}
        }
    }
    c.reg[idx] = val;
}

fn update_psw_flags(c: &mut Cpu) {
    if !c.last_op_alu { return; }
    let old_c = (c.psw >> 3) & 1; // read before the nibble is cleared
    let mut psw = c.psw & 0xFFF0;
    let res16 = (c.last_alu_result as i64) & 0xFFFF;
    if res16 == 0 { psw |= 1 << 1; }
    if (res16 & 0x8000) != 0 { psw |= 1 << 0; }
    // Carry flag: a shift/rotate writes the bit it shifted out (spec Table 7)
    // and keeps C unchanged when count is 0; every other instruction uses the
    // unsigned-overflow heuristic. Mirrors the JS core.
    let carry = match c.shift_carry_out {
        None => if c.last_alu_result > 0xFFFF || c.last_alu_result < 0 { 1 } else { 0 },
        Some(v) if v < 0 => old_c as i32,
        Some(v) => v,
    };
    if carry != 0 { psw |= 1 << 3; }
    // Overflow flag: signed overflow computed by the ADD/SUB/CMP sites in
    // exec_alu (spec Table 6); false everywhere else. Mirrors the JS core.
    if c.last_alu_overflow { psw |= 1 << 2; }
    c.psw = psw;
    c.last_op_alu = false;
    c.last_alu_overflow = false;
    c.shift_carry_out = None;
}

fn exec_ldi(c: &mut Cpu, instr: u16) {
    let mut imm = instr & 0x7FFF;
    if (imm & 0x4000) != 0 { imm |= 0x8000; }
    // LDI always targets the active R0 (spec 4.3: in a handler this is R0')
    gp_write(c, 0, imm);
    c.last_alu_result = imm as i32;
    c.last_op_alu = true;
}

fn exec_mem(c: &mut Cpu, instr: u16) {
    let d = (instr >> 13) & 0x1;
    let rd = ((instr >> 9) & 0xF) as usize;
    let rb = ((instr >> 5) & 0xF) as usize;
    // The 5-bit offset is signed (-16..+15), exactly as in the JS core and
    // spec 3.6 ("LD R1, [SP-4] works directly"): sign-extend it, then fold the
    // base + offset sum into 16 bits *before* the segment is added, so the
    // wrap-around case (base 0, offset -4 -> 0xFFFC) matches the JS core too.
    let off = (instr & 0x1F) as u32;
    let off = if off & 0x10 != 0 { off | 0xFFFF_FFE0 } else { off };
    let base_val = gp_read(c, rb);
    let addr_off = (base_val as u32).wrapping_add(off) & 0xFFFF;
    let in_shadow = (c.psw & (1 << 5)) != 0;
    let (seg_idx, seg) = if is_stack_register(c.psw, rb) {
        (2u16, if in_shadow { c.sss } else { c.ss })
    } else if is_extra_register(c.psw, rb) {
        (3u16, if in_shadow { c.ses } else { c.es })
    } else {
        (1u16, if in_shadow { c.sds } else { c.ds })
    };
    let pa = phys(seg, addr_off);
    if pa >= c.mem.len() { return; }
    if d == 0 {
        let v = c.mem[pa];
        gp_write(c, rd, v);
    } else {
        let v = gp_read(c, rd);
        c.mem[pa] = v;
    }
    c.recent_addr = pa;
    c.recent_base = base_val;
    c.recent_offset = (off & 0xFFFF) as u16;
    c.recent_seg_val = seg;
    c.recent_seg_idx = seg_idx;
    c.recent_is_store = d == 1;
}

fn exec_alu(c: &mut Cpu, instr: u16) {
    let func5 = (instr >> 8) & 0x1F;
    let rd = ((instr >> 4) & 0xF) as usize;
    let low4 = (instr & 0xF) as u16;
    let rdv = gp_read(c, rd) as u32 & 0xFFFF;
    let sign = (rdv & 0x8000) != 0;
    let is_reg = func5 == 0b00000 || func5 == 0b00010 || func5 == 0b00100 || func5 == 0b00110 || func5 == 0b01000 || func5 == 0b01010 || func5 == 0b01100 || func5 == 0b01110 || func5 >= 0b11100;
    let opv = if is_reg {
        let idx = low4 as usize;
        gp_read(c, idx) as u32
    } else { low4 as u32 & 0xF } & 0xFFFF;
    let mut result: i32 = rdv as i32;
    let mut wide_result: Option<i32> = None; // full 32-bit result for MUL32
    // V (signed overflow, spec Table 6: ADD/SUB/CMP = NZVC) is computed here
    // where both operands are known: ADD overflows when equal operand signs
    // produce a different result sign, SUB/CMP when different operand signs
    // produce a result whose sign differs from the minuend. Every other
    // instruction leaves last_alu_overflow false (NZ00 for the logic group,
    // V=0 for loads/shifts) - mirrors the JS core.
    match func5 {
        0b00000 | 0b00001 => {
            result = ((rdv + opv) & 0x1FFFF) as i32;
            c.last_alu_overflow = (((!(rdv ^ opv)) & (rdv ^ (result as u32 & 0xFFFF))) & 0x8000) != 0;
        }
        0b00010 | 0b00011 => {
            result = (rdv as i32 - opv as i32) as i32;
            c.last_alu_overflow = (((rdv ^ opv) & (rdv ^ (result as u32 & 0xFFFF))) & 0x8000) != 0;
        }
        0b00100 | 0b00101 => {
            result = (rdv as i32 - opv as i32) as i32;
            c.last_alu_overflow = (((rdv ^ opv) & (rdv ^ (result as u32 & 0xFFFF))) & 0x8000) != 0;
            c.last_alu_result = result;
            c.last_op_alu = true;
            return;
        }
        0b00110 => { result = ((rdv & opv) & 0xFFFF) as i32; }
        0b00111 => {
            // CLRB Rd, imm - imm4 is a bit index (spec Table 6)
            result = ((rdv & !(1u32 << low4)) & 0xFFFF) as i32;
        }
        0b01000 => {
            let masked = (rdv & opv) & 0xFFFF;
            c.last_alu_result = if masked == 0 { 0 } else { 1 };
            c.last_op_alu = true;
            return;
        }
        0b01001 => {
            let bit = ((rdv >> opv) & 1) as i32;
            c.last_alu_result = if bit == 0 { 1 } else { 0 };
            c.last_op_alu = true;
            return;
        }
        0b01010 => { result = ((rdv | opv) & 0xFFFF) as i32; }
        // Immediate forms: imm4 is a bit index, the core supplies 1 << imm
        0b01011 => { result = ((rdv | (1u32 << low4)) & 0xFFFF) as i32; }
        0b01100 => { result = ((rdv ^ opv) & 0xFFFF) as i32; }
        0b01101 => { result = ((rdv ^ (1u32 << low4)) & 0xFFFF) as i32; }
        0b01110 => {
            let masked = (rdv & opv) & 0xFFFF;
            c.last_alu_result = if masked != 0 { 1 } else { 0 };
            c.last_op_alu = true;
            return;
        }
        0b01111 => {
            let bit = ((rdv >> opv) & 1) as i32;
            c.last_alu_result = if bit == 1 { 1 } else { 0 };
            c.last_op_alu = true;
            return;
        }
        0b10000 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (16 - count)) & 1) as u16 } else { 0 };
            result = ((rdv << count) & 0xFFFF) as i32;
            c.shift_carry_out = Some(if count > 0 { carry_out as i32 } else { -1 });
        }
        0b10001 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (16 - count)) & 1) as u16 } else { 0 };
            let mut val = ((rdv << count) & 0x7FFF) as u16;
            if sign { val |= 0x8000; }
            result = val as i32;
            c.shift_carry_out = Some(if count > 0 { carry_out as i32 } else { -1 });
        }
        0b10010 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (16 - count)) & 1) as u16 } else { 0 };
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let mut val = ((rdv << count) & 0x7FFF) as u16;
            if sign { val |= 0x8000; }
            if count > 0 { val |= (carry_in << (count - 1)) as u16; }
            result = val as i32;
            c.shift_carry_out = Some(if count > 0 { carry_out as i32 } else { -1 });
        }
        0b10011 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (16 - count)) & 1) as u16 } else { 0 };
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let mut val = ((rdv << count) & 0xFFFF) as u16;
            if count > 0 { val |= (carry_in << (count - 1)) as u16; }
            result = val as i32;
            c.shift_carry_out = Some(if count > 0 { carry_out as i32 } else { -1 });
        }
        0b10100 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (count - 1)) & 1) as u16 } else { 0 };
            result = (rdv >> count) as i32;
            c.shift_carry_out = Some(if count > 0 { carry_out as i32 } else { -1 });
        }
        0b10101 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (count - 1)) & 1) as u16 } else { 0 };
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let fill = if count > 0 { (carry_in as u32) << (15 - count) } else { 0 };
            result = ((rdv >> count) | fill) as i32;
            c.shift_carry_out = Some(if count > 0 { carry_out as i32 } else { -1 });
        }
        0b10110 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (count - 1)) & 1) as u16 } else { 0 };
            let sign_mask = if sign { 0xFFFFu32 << (16 - count) } else { 0 };
            result = ((rdv >> count) | (sign_mask & 0xFFFF)) as i32;
            c.shift_carry_out = Some(if count > 0 { carry_out as i32 } else { -1 });
        }
        0b10111 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (count - 1)) & 1) as u16 } else { 0 };
            let sign_mask = if sign { 0xFFFFu32 << (16 - count) } else { 0 };
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let fill = if count > 0 { (carry_in as u32) << (15 - count) } else { 0 };
            result = ((rdv >> count) | (sign_mask & 0xFFFF) | fill) as i32;
            c.shift_carry_out = Some(if count > 0 { carry_out as i32 } else { -1 });
        }
        0b11000 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (16 - count)) & 1) as i32 } else { -1 };
            c.shift_carry_out = Some(carry_out);
            result = (((rdv << count) | (rdv >> (16 - count))) & 0xFFFF) as i32;
        }
        0b11001 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (16 - count)) & 1) as i32 } else { -1 };
            c.shift_carry_out = Some(carry_out);
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let fill = if count > 0 { (carry_in as u32) << (count - 1) } else { 0 };
            result = (((rdv << count) | (rdv >> (16 - count)) | fill) & 0xFFFF) as i32;
        }
        0b11010 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (count - 1)) & 1) as i32 } else { -1 };
            c.shift_carry_out = Some(carry_out);
            result = (((rdv >> count) | (rdv << (16 - count))) & 0xFFFF) as i32;
        }
        0b11011 => {
            let count = (opv & 0xF) as u32;
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let fill = if count > 0 { (carry_in as u32) << (15 - count) } else { 0 };
            let new_carry = if count > 0 { ((rdv >> (count - 1)) & 1) as u16 } else { carry_in };
            c.shift_carry_out = Some(if count > 0 { new_carry as i32 } else { -1 });
            result = (((rdv >> count) | (rdv << (16 - count)) | fill) & 0xFFFF) as i32;
        }
        0b11100 => {
            // MUL: the write-back epilogue stores `result` via gp_write
            result = ((rdv as u32 & 0xFFFF) * (opv as u32 & 0xFFFF) & 0xFFFF) as i32;
        }
        0b11101 => {
            // MUL32: R[d]:R[d+1] <- Rd * Rs (spec Table 8). Rd must be EVEN so the
            // pair is aligned; anything else would index outside the register file.
            if rd % 2 != 0 || rd + 1 >= 16 {
                c.last_alu_result = -1;
                c.last_op_alu = true;
                return;
            } else {
                let prod = (rdv as u64) * (opv as u64);
                let high = ((prod >> 16) as u32 & 0xFFFF) as u16;
                gp_write(c, rd + 1, (prod as u32 & 0xFFFF) as u16);
                // The write-back below stores `result` in Rd, so it must carry the
                // HIGH word -- otherwise it would clobber the pair we just stored.
                result = high as i32;
                wide_result = Some(prod as i32);
            }
        }
        0b11110 => {
            if opv == 0 { result = 0xFFFF; } else {
                result = ((rdv / opv) & 0xFFFF) as i32;
            }
        }
        0b11111 => {
            // DIV32: R[d] <- quotient, R[d+1] <- remainder of the 32-bit value R[d]:R[d+1]
            if rd % 2 != 0 || rd + 1 >= 16 {
                c.last_alu_result = -1;
                c.last_op_alu = true;
                return;
            } else if opv == 0 { result = 0xFFFF; } else {
                let dividend = (((gp_read(c, rd) as u32) << 16) | (gp_read(c, rd + 1) as u32)) as u64;
                let q = (dividend / opv as u64) as u32 & 0xFFFF;
                let r = (dividend % opv as u64) as u32 & 0xFFFF;
                gp_write(c, rd + 1, r as u16);
                result = q as i32;
            }
        }
        _ => { }
    }
    let res16 = (result as u32 & 0xFFFF) as u16;
    gp_write(c, rd, res16);
    c.last_alu_result = wide_result.unwrap_or(result);
    c.last_op_alu = true;
}

fn exec_mov(c: &mut Cpu, instr: u16, original_pc: u16) -> bool {
    let rd = ((instr >> 6) & 0xF) as usize;
    let rs = ((instr >> 2) & 0xF) as usize;
    let imm2 = (instr & 0x3) as u16;

    // Architectural PC source: a PC read yields own address + 1 in every
    // context (spec 3.3/6.2.2), derived from the instruction's own address.
    let src: u16 = if rs == 15 {
        original_pc.wrapping_add(1)
    } else {
        gp_read(c, rs)
    };

    // imm2 function table (all forwarded reads, no architectural bypass):
    //   0: Rd <- Rs
    //   1: Rd <- Rs << 1
    //   2: Rd <- Rs + 2        (LINK = MOV Rd, PC, 2 -> own + 3, the
    //                           instruction after the delay slot)
    //   3: Rd <- (Rs << 1) | 1
    // The former imm2=3 meanings (ALNK = PC own+1, AMV = unforwarded GPR
    // read) are retired: ALNK is now SMV Rd, APC per spec Table R, and the
    // no-forward read lives only in SMV.
    let value: u16 = match imm2 {
        0 => src,
        1 => src << 1,
        2 => src.wrapping_add(2),
        _ => (src << 1) | 1,
    };

    // MOV to PC is a branch with one delay slot
    if rd == 15 {
        let in_shadow = (c.psw & (1 << 5)) != 0;
        c.delay_active = true;
        c.delayed_pc = value;
        c.delayed_cs = if in_shadow { c.scs } else { c.cs };
        c.delayed_to_shadow = in_shadow;
        c.branch_taken = true;
        c.last_alu_result = value as i32;
        c.last_op_alu = true;
        return true;
    }

    if (c.psw & (1 << 5)) != 0 {
        match rd { 0 => c.sr0 = value, 1 => c.sr1 = value, 2 => c.sr2 = value, 3 => c.sr3 = value, 13 => c.sr13 = value, 14 => c.sr14 = value, _ => c.reg[rd] = value }
    } else { c.reg[rd] = value }
    c.last_alu_result = value as i32;
    c.last_op_alu = true;
    false
}

fn exec_lsi(c: &mut Cpu, instr: u16) {
    let rd = ((instr >> 5) & 0xF) as usize;
    let mut imm = (instr & 0x1F) as i16;
    if (imm & 0x10) != 0 { imm |= -1i16 << 5; }
    gp_write(c, rd, imm as u16);
    // LSI updates flags like its big sibling LDI: N/Z from the loaded value,
    // V/C clear (imm is kept as the 16-bit pattern, so C stays 0). The JS core
    // has always done this; the WASM core used to leave the flags untouched.
    c.last_alu_result = imm as u16 as i32;
    c.last_op_alu = true;
}

fn exec_sop(c: &mut Cpu, instr: u16) -> bool {
    // Spec 3.6 SOP: [1111111110][tt2][Rx4] with 00=INV, 01=NEG, 10=SPSW, 11=LPSW
    let t = (instr >> 4) & 0x3;
    let rx = (instr & 0xF) as usize;
    match t {
        0 => { // INV Rx: Rx <- ~Rx (active-bank register)
            let v = (!gp_read(c, rx)) & 0xFFFF;
            gp_write(c, rx, v);
            c.last_alu_result = v as i32;
            c.last_op_alu = true;
            false
        }
        1 => { // NEG Rx: Rx <- -Rx
            let v = ((!gp_read(c, rx)).wrapping_add(1)) & 0xFFFF;
            gp_write(c, rx, v);
            c.last_alu_result = v as i32;
            c.last_op_alu = true;
            false
        }
        2 => { // SPSW Rx: PSW <- Rx (active-bank view, spec 2.4)
            c.psw = gp_read(c, rx);
            false
        }
        3 => { // LPSW Rx: Rx <- PSW (live architectural PSW; interrupted state
               // comes from SMV Rx, APSW, spec 4.8)
            gp_write(c, rx, c.psw);
            false
        }
        _ => false,
    }
}

fn exec_set_clr(c: &mut Cpu, instr: u16) {
    let d = (instr >> 4) & 0x1;
    let imm = instr & 0xF;
    if imm == 4 { return; }
    let mask = (1u16 << imm) & 0xFFFF;
    if d == 0 { c.psw |= mask; } else { c.psw &= !mask; }
}

fn exec_jml(c: &mut Cpu, instr: u16) -> bool {
    let rx = (instr & 0xF) as usize;
    if rx % 2 != 0 { return false; }
    let target_cs = gp_read(c, rx);
    let target_pc = gp_read(c, rx + 1);
    let in_shadow = (c.psw & (1 << 5)) != 0;
    c.delay_active = true;
    c.delayed_pc = target_pc;
    c.delayed_cs = target_cs;
    c.delayed_to_shadow = in_shadow;
    c.branch_taken = true;
    true
}

fn exec_smv(c: &mut Cpu, instr: u16) {
    let rx = ((instr >> 4) & 0xF) as usize;
    let alt = (instr & 0xF) as u16;
    let in_shadow = (c.psw & (1 << 5)) != 0;
    // SMV always reads the *inactive* bank: in shadow view (S=1) the normal
    // registers, in normal view (S=0) the shadow registers. The result is
    // written into the *active* bank via gp_write (spec 3.3 / 4.8).
    match alt {
        0b0000 => { gp_write(c, rx, if in_shadow { c.cs } else { c.scs }); }
        0b0001 => { gp_write(c, rx, if in_shadow { c.ds } else { c.sds }); }
        0b0010 => { gp_write(c, rx, if in_shadow { c.ss } else { c.sss }); }
        0b0011 => { gp_write(c, rx, if in_shadow { c.es } else { c.ses }); }
        0b0100 => {
            // APSW: spsw holds the *other* context's PSW -- the interrupted PSW
            // during handler execution, PSW' (0x0000 after RETI, spec 4.9) in
            // normal view (spec 4.8).
            gp_write(c, rx, c.spsw);
        }
        0b1000 => { gp_write(c, rx, if in_shadow { c.reg[0] } else { c.sr0 }); }
        0b1001 => { gp_write(c, rx, if in_shadow { c.reg[1] } else { c.sr1 }); }
        0b1010 => { gp_write(c, rx, if in_shadow { c.reg[2] } else { c.sr2 }); }
        0b1011 => { gp_write(c, rx, if in_shadow { c.reg[3] } else { c.sr3 }); }
        0b1101 => { gp_write(c, rx, if in_shadow { c.reg[13] } else { c.sr13 }); }
        0b1110 => { gp_write(c, rx, if in_shadow { c.reg[14] } else { c.sr14 }); }
        0b1111 => {
            // APC: the architectural (active) PC -- shadow PC in handler
            // context, normal PC otherwise (spec 3.3 / 6.2.2 ALINK).
            gp_write(c, rx, if in_shadow { c.spc } else { c.reg[15] });
        }
        _ => { }
    }
}

fn exec_mvs(c: &mut Cpu, instr: u16) {
    let d = (instr >> 6) & 0x1;
    let rd = ((instr >> 2) & 0xF) as usize;
    let seg = (instr & 0x3) as u16;
    let in_shadow = (c.psw & (1 << 5)) != 0;
    if d == 0 {
        // MVS Rd, SEG: segment register -> active-bank GPR Rd
        let v = match seg {
            0 => if in_shadow { c.scs } else { c.cs },
            1 => if in_shadow { c.sds } else { c.ds },
            2 => if in_shadow { c.sss } else { c.ss },
            _ => if in_shadow { c.ses } else { c.es },
        };
        gp_write(c, rd, v);
    } else {
        // MVS SEG, Rd: active-bank GPR Rd -> segment register
        let v = gp_read(c, rd);
        match seg {
            0 => if in_shadow { c.scs = v } else { c.cs = v },
            1 => if in_shadow { c.sds = v } else { c.ds = v },
            2 => if in_shadow { c.sss = v } else { c.ss = v },
            _ => if in_shadow { c.ses = v } else { c.es = v },
        };
    }
}

fn exec_jump(c: &mut Cpu, instr: u16) -> bool {
    let cond = (instr >> 9) & 0x7;
    let mut off = instr & 0x1FF;
    if (off & 0x100) != 0 { off = (off as i32 - 0x200) as u16; }
    let z = (c.psw & (1 << 1)) != 0;
    let cflag = (c.psw & (1 << 3)) != 0;
    let nflag = (c.psw & (1 << 0)) != 0;
    let oflag = (c.psw & (1 << 2)) != 0;
    let mut j = false;
    match cond {
        0 => j = z,
        1 => j = !z,
        2 => j = cflag,
        3 => j = !cflag,
        4 => j = nflag,
        5 => j = !nflag,
        6 => j = oflag,
        _ => j = !oflag,
    }
    if j {
        let in_shadow = (c.psw & (1 << 5)) != 0;
        let current_pc = if in_shadow { c.spc } else { c.reg[15] } as i32;
        let target_pc = (current_pc + (off as i16 as i32)) as u16;
        c.delay_active = true;
        c.delayed_pc = target_pc;
        c.delayed_cs = if in_shadow { c.scs } else { c.cs };
        c.delayed_to_shadow = in_shadow;
        c.branch_taken = true;
    } else {
        c.branch_taken = false;
    }
    true
}

fn step_one(c: &mut Cpu) -> bool {
    if !c.running { c.running = true; }
    let in_shadow = (c.psw & (1 << 5)) != 0;
    if c.delay_active {
        c.delay_active = false;
        let active_cs = if in_shadow { c.scs } else { c.cs };
        let active_pc = if in_shadow { c.spc } else { c.reg[15] };
        let pa = phys(active_cs, active_pc as u32);
        if pa >= c.mem.len() { c.running = false; return false; }
        let instr = c.mem[pa];
        let original_pc = active_pc;
        if in_shadow { c.spc = c.spc.wrapping_add(1); } else { c.reg[15] = c.reg[15].wrapping_add(1); }
        c.last_op_alu = false;
        c.last_alu_result = 0;
        c.last_alu_overflow = false;
        c.shift_carry_out = None;
        let is_branch = exec_instruction(c, instr, original_pc);
        update_psw_flags(c);
        if c.branch_taken {
            if c.delayed_to_shadow { c.spc = c.delayed_pc; c.scs = c.delayed_cs; } else { c.reg[15] = c.delayed_pc; c.cs = c.delayed_cs; }
        }
        return !is_branch || c.running;
    }
    let active_cs = if in_shadow { c.scs } else { c.cs };
    let active_pc = if in_shadow { c.spc } else { c.reg[15] };
    let pa = phys(active_cs, active_pc as u32);
    if pa >= c.mem.len() { c.running = false; return false; }
    let instr = c.mem[pa];
    if instr == 0xFFFF { c.running = false; return false; }
    c.last_event_code = instr;
    c.last_event_spc = active_pc;
    c.last_event_scs = active_cs;
    if (instr & 0xFFF0) == 0xFFF0 {
        if in_shadow { c.spc = c.spc.wrapping_add(1); } else { c.reg[15] = c.reg[15].wrapping_add(1); }
        // Reset ALU tracking so a stale result cannot smear flags across an
        // SWI/RETI PSW transition (matches the JS core and the paths below).
        c.last_op_alu = false;
        c.last_alu_result = 0;
        c.last_alu_overflow = false;
        c.shift_carry_out = None;
        exec_sys(c, instr);
        update_psw_flags(c);
        return true;
    }
    let original_pc = active_pc;
    if in_shadow { c.spc = c.spc.wrapping_add(1); } else { c.reg[15] = c.reg[15].wrapping_add(1); }
    c.last_op_alu = false;
    c.last_alu_result = 0;
    c.last_alu_overflow = false;
    c.shift_carry_out = None;
    let _is_branch = exec_instruction(c, instr, original_pc);
    update_psw_flags(c);
    true
}

fn exec_instruction(c: &mut Cpu, instr: u16, original_pc: u16) -> bool {
    // Fast-path: System instructions (NOP/HLT/SWI/RETI)
    if (instr & 0xFFF0) == 0xFFF0 { exec_sys(c, instr); return false; }
    if (instr & 0x8000) == 0 { exec_ldi(c, instr); return false; }
    if ((instr >> 14) & 0x3) == 0b10 { exec_mem(c, instr); return false; }
    let opcode3 = (instr >> 13) & 0x7;
    match opcode3 {
        0b110 => { exec_alu(c, instr); false }
        0b111 => {
            if ((instr >> 12) & 0xF) == 0b1110 { return exec_jump(c, instr); }
            if ((instr >> 11) & 0x1F) == 0b11110 { exec_lds_sts(c, instr); return false; }
            if ((instr >> 10) & 0x3F) == 0b111110 { return exec_mov(c, instr, original_pc); }
            if ((instr >> 9) & 0x7F) == 0b1111110 { exec_lsi(c, instr); return false; }
            if ((instr >> 8) & 0xFF) == 0b11111110 { exec_smv(c, instr); return false; }
            if ((instr >> 7) & 0x1FF) == 0b111111110 { exec_mvs(c, instr); return false; }
            if ((instr >> 6) & 0x3FF) == 0b1111111110 { return exec_sop(c, instr); }
            if ((instr >> 5) & 0x7FF) == 0b11111111110 { exec_set_clr(c, instr); return false; }
            if ((instr >> 4) & 0xFFF) == 0b111111111110 { return exec_jml(c, instr); }
            if ((instr >> 3) & 0x1FFF) == 0b1111111111110 { exec_sys(c, instr); return false; }
            false
        }
        _ => false,
    }
}

// Boot ROM at 0xFFFF0. It zeroes DS/SS, builds the entry point 0x0100 in R1,
    // stores that value at physical 0x0000..0x0002 as a breadcrumb, and jumps to
    // CS:R1 = 0000:0100 (JML R0 takes CS from R0 and PC from R1).
    fn autoload_rom(c: &mut Cpu) {
    let base = 0xFFFF0usize;
    let rom: [u16; 16] = [
        0x0000, // LDI 0 -> R0          (R0 = 0)
        0xFF41, // MVS DS, R0          (flat data addressing)
        0xFF42, // MVS SS, R0          (stack sits at physical 0x0000)
        0xFC21, // LSI R1, 1
        0xD818, // ROL R1, 8           (R1 = 0x0100, the entry point)
        0xA200, // ST R1, [R0+0]       (writes 0x0100 at physical 0x0000)
        0xA201, // ST R1, [R0+1]       (          ...      0x0001)
        0xA202, // ST R1, [R0+2]       (          ...      0x0002)
        0xFFE0, // JML R0              (CS = R0 = 0, PC = R1 = 0x0100)
        0xFFF0, // NOP (delay slot)
        0xFFF1, // HLT
        0xFFF1, // HLT
        0xFFF1, // HLT
        0xFFF1, // HLT
        0xFFF1, // HLT
        0xFFF1, // HLT
    ];
    for i in 0..rom.len() {
        let addr = base + i;
        if addr < c.mem.len() { c.mem[addr] = rom[i]; }
    }
}

fn exec_lds_sts(c: &mut Cpu, instr: u16) {
    // [11110][d1][seg2][Rd4][Rs4]
    let d = (instr >> 10) & 0x1;
    let seg = (instr >> 8) & 0x3;
    let rd = ((instr >> 4) & 0xF) as usize;
    let rs = (instr & 0xF) as usize;
    let in_shadow = (c.psw & (1 << 5)) != 0;
    let base = gp_read(c, rs) as u32;
    // The explicit segment uses the active bank's shadow/normal segments
    let segv = match seg {
        0 => if in_shadow { c.scs } else { c.cs },
        1 => if in_shadow { c.sds } else { c.ds },
        2 => if in_shadow { c.sss } else { c.ss },
        _ => if in_shadow { c.ses } else { c.es },
    };
    let pa = phys(segv, base);
    if pa >= c.mem.len() { return; }
    if d == 0 {
        // Polled keyboard controller (parity with the JS core): STATUS is 1
        // while a key is pending, DATA pops the next key. Anything else is a
        // plain memory load through the active-bank view.
        if pa == KBD_STATUS_ADDR {
            gp_write(c, rd, if c.kbd.is_empty() { 0 } else { 1 });
        } else if pa == KBD_DATA_ADDR {
            let data = if c.kbd.is_empty() { 0 } else { c.kbd.remove(0) & 0xFFFF };
            c.kbd_last = data;
            gp_write(c, rd, data);
        } else {
            let v = c.mem[pa];
            gp_write(c, rd, v);
        }
    } else {
        let v = gp_read(c, rd);
        c.mem[pa] = v;
    }
    c.recent_addr = pa;
    c.recent_base = base as u16;
    c.recent_offset = 0;
    c.recent_seg_val = segv;
    c.recent_seg_idx = seg as u16;
    c.recent_is_store = d == 1;
}

#[wasm_bindgen]
pub fn step() -> bool {
    unsafe {
        let c = cpu_mut();
        step_one(c)
    }
}

/// Push one key code into the polled keyboard buffer (parity with the JS
/// core's `simulator.enqueueKeyCode`). Called from the IDE for every
/// keystroke while the WASM core is selected.
#[wasm_bindgen]
pub fn kbd_push(code: u16) {
    unsafe {
        cpu_mut().kbd.push(code & 0xFFFF);
    }
}

#[wasm_bindgen]
pub fn kbd_clear() {
    unsafe {
        let c = cpu_mut();
        c.kbd.clear();
        c.kbd_last = 0;
    }
}

#[wasm_bindgen]
pub fn run_steps(n: u32) -> bool {
    unsafe {
        let c = cpu_mut();
        let mut cont = true;
        for _ in 0..n {
            if !step_one(c) { cont = false; break; }
        }
        cont
    }
}
#[wasm_bindgen]
pub fn get_recent_access() -> Box<[u32]> {
    unsafe {
        let c = cpu_ref();
        vec![
            c.recent_addr as u32,
            c.recent_base as u32,
            c.recent_offset as u32,
            c.recent_seg_val as u32,
            c.recent_seg_idx as u32,
            if c.recent_is_store { 1 } else { 0 },
        ].into_boxed_slice()
    }
}

#[wasm_bindgen]
pub fn get_last_event() -> Box<[u16]> {
    unsafe {
        let c = cpu_ref();
        vec![c.last_event_code, c.spc, c.scs, c.psw, c.spsw].into_boxed_slice()
    }
}

#[wasm_bindgen]
pub fn get_shadow_state() -> Box<[u16]> {
    unsafe {
        let c = cpu_ref();
        vec![c.spc, c.scs, c.spsw].into_boxed_slice()
    }
}
fn exec_sys(c: &mut Cpu, instr: u16) -> bool {
    let op = (instr & 0x7) as u16;
    match op {
        0 => { /* NOP */ false }
        1 => { /* HLT */ c.running = false; false }
        2 => { /* SWI */
            // Spec 4.4: park the interrupted PSW, then enter the handler with a
            // fresh PSW (S=1, I=0, flags clear) -- NOT a copy of the old one.
            c.spsw = c.psw;
            c.psw = 0x0020;
            c.scs = 0x0000;
            c.sds = 0x0000;
            c.sss = 0x0000;
            c.ses = 0x0000;
            c.sr0 = 0x0000;
            c.sr1 = 0x0000;
            c.sr2 = 0x0000;
            c.sr3 = 0x0000;
            c.sr13 = 0x0000;
            c.sr14 = 0x0000;
            let pa = phys(0, 2u32);
            let target = if pa < c.mem.len() { c.mem[pa] & 0xFFFF } else { 0xFFFF };
            c.spc = target;
            c.last_event_code = 2;
            c.last_event_spc = c.spc;
            c.last_event_scs = c.scs;
            false
        }
        3 => { /* RETI */
            // Spec 4.9: restore the original (interrupted) PSW -- flags, I and
            // all fields intact -- and reset PSW' to 0x0000.
            if (c.psw & (1 << 5)) != 0 {
                c.psw = c.spsw;
                c.spsw = 0;
            } else {
                // Spurious RETI outside a handler: keep S clear / unchanged
                c.psw = c.psw & !(1 << 5);
            }
            c.last_event_code = 3;
            false
        }
        4 => { /* SETI */
            c.psw |= 1 << 4;
            false
        }
        5 => { /* CLRI */
            c.psw &= !(1 << 4);
            false
        }
        _ => false,
    }
}
