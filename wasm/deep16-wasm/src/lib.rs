use wasm_bindgen::prelude::*;

struct Cpu {
    mem: Vec<u16>,
    reg: [u16; 16],
    psw: u16,
    spsw: u16,
    cs: u16,
    scs: u16,
    spc: u16,
    ds: u16,
    ss: u16,
    es: u16,
    running: bool,
    delay_active: bool,
    delayed_pc: u16,
    delayed_cs: u16,
    delayed_to_shadow: bool,
    branch_taken: bool,
    last_alu_result: i32,
    last_op_alu: bool,
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
            scs: 0,
            spc: 0,
            ds: 0x1000,
            ss: 0x8000,
            es: 0x2000,
            running: false,
            delay_active: false,
            delayed_pc: 0,
            delayed_cs: 0,
            delayed_to_shadow: false,
            branch_taken: false,
            last_alu_result: 0,
            last_op_alu: false,
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
        self.scs = 0;
        self.spc = 0;
        self.ds = 0x1000;
        self.ss = 0x8000;
        self.es = 0x2000;
        self.running = false;
        self.delay_active = false;
        self.delayed_pc = 0;
        self.delayed_cs = 0;
        self.delayed_to_shadow = false;
        self.branch_taken = false;
        self.last_alu_result = 0;
        self.last_op_alu = false;
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
        let cs = if (c.psw & (1 << 5)) != 0 { c.scs } else { c.cs };
        vec![cs, c.ds, c.ss, c.es].into_boxed_slice()
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

fn update_psw_flags(c: &mut Cpu) {
    if !c.last_op_alu { return; }
    let mut psw = c.psw & 0xFFF0;
    let res16 = (c.last_alu_result as i64) & 0xFFFF;
    let signed = if (res16 & 0x8000) != 0 { (res16 as i64) - 0x10000 } else { res16 as i64 };
    if res16 == 0 { psw |= 1 << 1; }
    if (res16 & 0x8000) != 0 { psw |= 1 << 0; }
    if c.last_alu_result > 0xFFFF || c.last_alu_result < 0 { psw |= 1 << 3; }
    if signed > 32767 || signed < -32768 { psw |= 1 << 2; }
    c.psw = psw;
    c.last_op_alu = false;
}

fn exec_ldi(c: &mut Cpu, instr: u16) {
    let imm = instr & 0x7FFF;
    c.reg[0] = imm;
    c.last_alu_result = imm as i32;
    c.last_op_alu = true;
}

fn exec_mem(c: &mut Cpu, instr: u16) {
    let d = (instr >> 13) & 0x1;
    let rd = ((instr >> 9) & 0xF) as usize;
    let rb = ((instr >> 5) & 0xF) as usize;
    let off = (instr & 0x1F) as u32;
    let addr_off = (c.reg[rb] as u32).wrapping_add(off);
    let (seg_idx, seg) = if is_stack_register(c.psw, rb) { (2u16, c.ss) } else if is_extra_register(c.psw, rb) { (3u16, c.es) } else { (1u16, c.ds) };
    let pa = phys(seg, addr_off);
    if pa >= c.mem.len() { return; }
    if d == 0 { c.reg[rd] = c.mem[pa]; } else { c.mem[pa] = c.reg[rd]; }
    c.recent_addr = pa;
    c.recent_base = c.reg[rb];
    c.recent_offset = (off & 0x1F) as u16;
    c.recent_seg_val = seg;
    c.recent_seg_idx = seg_idx;
    c.recent_is_store = d == 1;
}

fn exec_alu(c: &mut Cpu, instr: u16) {
    let func5 = (instr >> 8) & 0x1F;
    let rd = ((instr >> 4) & 0xF) as usize;
    let low4 = (instr & 0xF) as u16;
    let rdv = c.reg[rd] as u32 & 0xFFFF;
    let sign = (rdv & 0x8000) != 0;
    let is_reg = func5 == 0b00000 || func5 == 0b00010 || func5 == 0b00100 || func5 == 0b00110 || func5 == 0b01000 || func5 == 0b01010 || func5 == 0b01100 || func5 == 0b01110 || func5 >= 0b11100;
    let opv = if is_reg { c.reg[low4 as usize] as u32 & 0xFFFF } else { low4 as u32 & 0xF };
    let mut result: i32 = rdv as i32;
    match func5 {
        0b00000 | 0b00001 => { result = ((rdv + opv) & 0x1FFFF) as i32; }
        0b00010 | 0b00011 => { result = (rdv as i32 - opv as i32) as i32; }
        0b00100 | 0b00101 => { result = (rdv as i32 - opv as i32) as i32; c.last_alu_result = result; c.last_op_alu = true; return; }
        0b00110 | 0b00111 => { result = ((rdv & opv) & 0xFFFF) as i32; }
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
        0b01010 | 0b01011 => { result = ((rdv | opv) & 0xFFFF) as i32; }
        0b01100 | 0b01101 => { result = ((rdv ^ opv) & 0xFFFF) as i32; }
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
            c.psw = (c.psw & !0x8) | ((carry_out as u16) << 3);
        }
        0b10001 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (16 - count)) & 1) as u16 } else { 0 };
            let mut val = ((rdv << count) & 0x7FFF) as u16;
            if sign { val |= 0x8000; }
            result = val as i32;
            c.psw = (c.psw & !0x8) | ((carry_out as u16) << 3);
        }
        0b10010 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (16 - count)) & 1) as u16 } else { 0 };
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let mut val = ((rdv << count) & 0x7FFF) as u16;
            if sign { val |= 0x8000; }
            if count > 0 { val |= (carry_in << (count - 1)) as u16; }
            result = val as i32;
            c.psw = (c.psw & !0x8) | ((carry_out as u16) << 3);
        }
        0b10011 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (16 - count)) & 1) as u16 } else { 0 };
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let mut val = ((rdv << count) & 0xFFFF) as u16;
            if count > 0 { val |= (carry_in << (count - 1)) as u16; }
            result = val as i32;
            c.psw = (c.psw & !0x8) | ((carry_out as u16) << 3);
        }
        0b10100 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (count - 1)) & 1) as u16 } else { 0 };
            result = (rdv >> count) as i32;
            c.psw = (c.psw & !0x8) | ((carry_out as u16) << 3);
        }
        0b10101 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (count - 1)) & 1) as u16 } else { 0 };
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let fill = if count > 0 { (carry_in as u32) << (15 - count) } else { 0 };
            result = ((rdv >> count) | fill) as i32;
            c.psw = (c.psw & !0x8) | ((carry_out as u16) << 3);
        }
        0b10110 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (count - 1)) & 1) as u16 } else { 0 };
            let sign_mask = if sign { 0xFFFFu32 << (16 - count) } else { 0 };
            result = ((rdv >> count) | (sign_mask & 0xFFFF)) as i32;
            c.psw = (c.psw & !0x8) | ((carry_out as u16) << 3);
        }
        0b10111 => {
            let count = (opv & 0xF) as u32;
            let carry_out = if count > 0 { ((rdv >> (count - 1)) & 1) as u16 } else { 0 };
            let sign_mask = if sign { 0xFFFFu32 << (16 - count) } else { 0 };
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let fill = if count > 0 { (carry_in as u32) << (15 - count) } else { 0 };
            result = ((rdv >> count) | (sign_mask & 0xFFFF) | fill) as i32;
            c.psw = (c.psw & !0x8) | ((carry_out as u16) << 3);
        }
        0b11000 => {
            let count = (opv & 0xF) as u32;
            result = (((rdv << count) | (rdv >> (16 - count))) & 0xFFFF) as i32;
        }
        0b11001 => {
            let count = (opv & 0xF) as u32;
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let fill = if count > 0 { (carry_in as u32) << (count - 1) } else { 0 };
            result = (((rdv << count) | (rdv >> (16 - count)) | fill) & 0xFFFF) as i32;
        }
        0b11010 => {
            let count = (opv & 0xF) as u32;
            result = (((rdv >> count) | (rdv << (16 - count))) & 0xFFFF) as i32;
        }
        0b11011 => {
            let count = (opv & 0xF) as u32;
            let carry_in = ((c.psw >> 3) & 1) as u16;
            let fill = if count > 0 { (carry_in as u32) << (15 - count) } else { 0 };
            let new_carry = if count > 0 { ((rdv >> (count - 1)) & 1) as u16 } else { carry_in };
            result = (((rdv >> count) | (rdv << (16 - count)) | fill) & 0xFFFF) as i32;
            c.psw = (c.psw & !0x8) | (new_carry << 3);
        }
        0b11100 => {
            let prod = ((rdv as u32 & 0xFFFF) * (opv as u32 & 0xFFFF)) & 0xFFFF;
            c.reg[rd] = (prod & 0xFFFF) as u16;
            result = prod as i32;
        }
        0b11101 => {
            let prod = (rdv as u64) * (opv as u64);
            c.reg[rd] = ((prod >> 16) as u32 & 0xFFFF) as u16;
            c.reg[rd + 1] = (prod as u32 & 0xFFFF) as u16;
            result = prod as i32;
        }
        0b11110 => {
            if opv == 0 { result = 0xFFFF; } else {
                let q = ((rdv as u32) / opv) as u32 & 0xFFFF;
                let r = ((rdv as u32) % opv) as u32 & 0xFFFF;
                c.reg[rd] = q as u16;
                c.reg[rd + 1] = r as u16;
                result = q as i32;
            }
        }
        0b11111 => {
            if opv == 0 { result = 0xFFFF; } else {
                let dividend = (((c.reg[rd] as u32) << 16) | (c.reg[rd + 1] as u32)) as u64;
                let q = (dividend / opv as u64) as u32 & 0xFFFF;
                let r = (dividend % opv as u64) as u32 & 0xFFFF;
                c.reg[rd] = q as u16;
                c.reg[rd + 1] = r as u16;
                result = q as i32;
            }
        }
        _ => { }
    }
    c.reg[rd] = (result as u32 & 0xFFFF) as u16;
    c.last_alu_result = result;
    c.last_op_alu = true;
}

fn exec_mov(c: &mut Cpu, instr: u16, original_pc: u16) -> bool {
    let rd = ((instr >> 6) & 0xF) as usize;
    let rs = ((instr >> 2) & 0xF) as usize;
    let imm2 = (instr & 0x3) as u16;

    let value: u16 = if imm2 == 0 {
        c.reg[rs]
    } else if rs == 15 && imm2 == 2 {
        // Standard link (LNK): PC architectural read before jump
        original_pc.wrapping_add(2)
    } else if rs == 15 && imm2 == 3 {
        // Architectural link in delay slot (ALNK): next instruction after delay slot
        original_pc.wrapping_add(1)
    } else if imm2 == 3 {
        // Architectural read bypass (AMV)
        c.reg[rs]
    } else {
        c.reg[rs].wrapping_add(imm2)
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

    c.reg[rd] = value;
    c.last_alu_result = value as i32;
    c.last_op_alu = true;
    false
}

fn exec_lsi(c: &mut Cpu, instr: u16) {
    let rd = ((instr >> 5) & 0xF) as usize;
    let mut imm = (instr & 0x1F) as i16;
    if (imm & 0x10) != 0 { imm |= -1i16 << 5; }
    c.reg[rd] = imm as u16;
}

fn exec_sop(c: &mut Cpu, instr: u16) -> bool {
    let t = (instr >> 4) & 0xF;
    let rx = (instr & 0xF) as usize;
    match t {
        0b0000 => {
            let v = c.reg[rx];
            let swapped = (((v & 0x00FF) << 8) | ((v >> 8) & 0x00FF)) as u16;
            c.reg[rx] = swapped;
            c.last_alu_result = swapped as i32;
            c.last_op_alu = true;
            false
        }
        0b0001 => {
            c.reg[rx] = (!c.reg[rx]) & 0xFFFF;
            c.last_alu_result = c.reg[rx] as i32;
            c.last_op_alu = true;
            false
        }
        0b0100 => {
            if rx % 2 != 0 { return false; }
            let target_cs = c.reg[rx];
            let target_pc = c.reg[rx + 1];
            c.delay_active = true;
            c.delayed_pc = target_pc;
            c.delayed_cs = target_cs;
            c.delayed_to_shadow = (c.psw & (1 << 5)) != 0;
            c.branch_taken = true;
            true
        }
        0b1000 => {
            c.psw = (c.psw & !0x03C0) | (((rx as u16) & 0xF) << 6);
            false
        }
        0b1001 => {
            c.psw = (c.psw & !0x03C0) | (((rx as u16) & 0xF) << 6) | 0x0400;
            false
        }
        0b1010 => {
            c.psw = (c.psw & !0x7800) | (((rx as u16) & 0xF) << 11);
            false
        }
        0b1011 => {
            c.psw = (c.psw & !0x7800) | (((rx as u16) & 0xF) << 11) | 0x8000;
            false
        }
        _ => false,
    }
}

fn exec_mvs(c: &mut Cpu, instr: u16) {
    let d = (instr >> 6) & 0x1;
    let rd = ((instr >> 2) & 0xF) as usize;
    let seg = (instr & 0x3) as u16;
    if d == 0 {
        let v = match seg { 0 => c.cs, 1 => c.ds, 2 => c.ss, _ => c.es };
        c.reg[rd] = v;
    } else {
        let v = c.reg[rd];
        match seg { 0 => c.cs = v, 1 => c.ds = v, 2 => c.ss = v, _ => c.es = v };
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
        exec_sys(c, instr);
        update_psw_flags(c);
        return true;
    }
    let original_pc = active_pc;
    if in_shadow { c.spc = c.spc.wrapping_add(1); } else { c.reg[15] = c.reg[15].wrapping_add(1); }
    c.last_op_alu = false;
    c.last_alu_result = 0;
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
            // System instruction (SWI/RETI/etc.) must be detected before other 0b111* groups
            if (instr & 0xFFF0) == 0xFFF0 { exec_sys(c, instr); return false; }
            if ((instr >> 3) & 0x1FFF) == 0x1FFE { exec_sys(c, instr); return false; }
            if ((instr >> 9) & 0x7F) == 0b1111110 { exec_lsi(c, instr); return false; }
            if ((instr >> 8) & 0xFF) == 0b11111110 { return exec_sop(c, instr); }
            if ((instr >> 7) & 0x1FF) == 0b111111110 { exec_mvs(c, instr); return false; }
            false
        }
        _ => false,
    }
}

fn autoload_rom(c: &mut Cpu) {
    let base = 0xFFFF0usize;
    let rom: [u16; 16] = [
        0x0000, // LDI 0 -> R0
        0xFF41, // MVS DS, R0
        0xFF42, // MVS SS, R0
        0xFC21, // LSI R1, 1
        0xFE01, // SWB R1
        0xA200, // ST R1, [R0+0]
        0xA201, // ST R1, [R0+1]
        0xA202, // ST R1, [R0+2]
        0xFE40, // JML R0
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
    let base = c.reg[rs] as u32;
    let segv = match seg { 0 => c.cs, 1 => c.ds, 2 => c.ss, _ => c.es };
    let pa = phys(segv, base);
    if pa >= c.mem.len() { return; }
    if d == 0 { c.reg[rd] = c.mem[pa]; } else { c.mem[pa] = c.reg[rd]; }
    c.recent_addr = pa;
    c.recent_base = c.reg[rs];
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
            c.spsw = c.psw;
            c.psw = (c.psw & !(1 << 4)) | (1 << 5);
            c.scs = 0x0000;
            let pa = phys(0, 2u32);
            let target = if pa < c.mem.len() { c.mem[pa] & 0xFFFF } else { 0xFFFF };
            c.spc = target;
            c.last_event_code = 2;
            c.last_event_spc = c.spc;
            c.last_event_scs = c.scs;
            false
        }
        3 => { /* RETI */
            // Return from interrupt: clear S-bit
            c.psw = c.psw & !(1 << 5);
            c.last_event_code = 3;
            false
        }
        _ => false,
    }
}
