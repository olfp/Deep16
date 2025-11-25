use wasm_bindgen::prelude::*;

struct Cpu {
    mem: Vec<u16>,
    reg: [u16; 16],
    psw: u16,
    cs: u16,
    ds: u16,
    ss: u16,
    es: u16,
    running: bool,
    delay_active: bool,
    delayed_pc: u16,
    delayed_cs: u16,
    branch_taken: bool,
    last_alu_result: i32,
    last_op_alu: bool,
    recent_addr: usize,
    recent_base: u16,
    recent_offset: u16,
    recent_seg_val: u16,
    recent_seg_idx: u16,
    recent_is_store: bool,
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
            cs: 0x0000,
            ds: 0x1000,
            ss: 0x8000,
            es: 0x2000,
            running: false,
            delay_active: false,
            delayed_pc: 0,
            delayed_cs: 0,
            branch_taken: false,
            last_alu_result: 0,
            last_op_alu: false,
            recent_addr: 0,
            recent_base: 0,
            recent_offset: 0,
            recent_seg_val: 0,
            recent_seg_idx: 0,
            recent_is_store: false,
        }
    }
    fn reset(&mut self) {
        self.mem.fill(0xFFFF);
        self.reg = [0u16; 16];
        self.reg[13] = 0x7FFF;
        self.reg[15] = 0x0000;
        self.psw = 0;
        self.cs = 0x0000;
        self.ds = 0x1000;
        self.ss = 0x8000;
        self.es = 0x2000;
        self.running = false;
        self.delay_active = false;
        self.delayed_pc = 0;
        self.delayed_cs = 0;
        self.branch_taken = false;
        self.last_alu_result = 0;
        self.last_op_alu = false;
        self.recent_addr = 0;
        self.recent_base = 0;
        self.recent_offset = 0;
        self.recent_seg_val = 0;
        self.recent_seg_idx = 0;
        self.recent_is_store = false;
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
        CPU = Some(Cpu::new(mem_words));
    }
}

#[wasm_bindgen]
pub fn reset() {
    unsafe {
        cpu_mut().reset();
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
    }
}

#[wasm_bindgen]
pub fn get_registers() -> Box<[u16]> {
    unsafe { cpu_ref().reg.to_vec().into_boxed_slice() }
}

#[wasm_bindgen]
pub fn get_psw() -> u16 {
    unsafe { cpu_ref().psw }
}

#[wasm_bindgen]
pub fn get_segments() -> Box<[u16]> {
    unsafe {
        let c = cpu_ref();
        vec![c.cs, c.ds, c.ss, c.es].into_boxed_slice()
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
    let dual = (psw & (1 << 10)) != 0;
    if dual { idx == sr || idx == (sr + 1) } else { idx == sr }
}

fn is_extra_register(psw: u16, idx: usize) -> bool {
    let er = ((psw >> 11) & 0xF) as usize;
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
    let alu_op = (instr >> 10) & 0x7;
    let rd = ((instr >> 6) & 0xF) as usize;
    let w = (instr >> 5) & 0x1;
    let i = (instr >> 4) & 0x1;
    let opnd = (instr & 0xF) as usize;
    let operand = if i == 0 { c.reg[opnd] as i32 } else { (opnd as u16) as i32 };
    let rdv = c.reg[rd] as i32;
    let mut result = rdv;
    match alu_op {
        0 => { result = rdv + operand; }
        1 => { result = rdv - operand; }
        2 => { result = (rdv as u32 & 0xFFFF) as i32 & (operand as u32 & 0xFFFF) as i32; }
        3 => { result = ((rdv as u32 & 0xFFFF) | (operand as u32 & 0xFFFF)) as i32; }
        4 => { result = ((rdv as u32 & 0xFFFF) ^ (operand as u32 & 0xFFFF)) as i32; }
        5 => {
            if i == 1 && rd % 2 == 0 {
                let prod = (rdv as i64) * (operand as i64);
                c.reg[rd] = ((prod >> 16) as u32 & 0xFFFF) as u16;
                c.reg[rd + 1] = (prod as u32 & 0xFFFF) as u16;
                result = prod as i32;
            } else {
                let prod = ((rdv as u32 & 0xFFFF) * (operand as u32 & 0xFFFF)) & 0xFFFF;
                result = prod as i32;
            }
        }
        6 => {
            if operand == 0 { result = 0xFFFF; } else if i == 1 && rd % 2 == 0 {
                let dividend = (((c.reg[rd] as u32) << 16) | (c.reg[rd + 1] as u32)) as u64;
                let q = (dividend / operand as u64) as u32;
                let r = (dividend % operand as u64) as u32;
                c.reg[rd] = (q & 0xFFFF) as u16;
                c.reg[rd + 1] = (r & 0xFFFF) as u16;
                result = q as i32;
            } else {
                let q = (rdv as u32 / operand as u32) as u32;
                let r = (rdv as u32 % operand as u32) as u32;
                c.reg[rd + 1] = (r & 0xFFFF) as u16;
                result = q as i32;
            }
        }
        _ => { return; }
    }
    if w == 1 && alu_op != 5 && alu_op != 6 {
        c.reg[rd] = (result as u32 & 0xFFFF) as u16;
    }
    c.last_alu_result = result;
    c.last_op_alu = true;
}

fn exec_mov(c: &mut Cpu, instr: u16) {
    let rd = ((instr >> 6) & 0xF) as usize;
    let rs = ((instr >> 2) & 0xF) as usize;
    let imm2 = (instr & 0x3) as u16;
    let v = c.reg[rs].wrapping_add(imm2);
    c.reg[rd] = v;
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
        0b0001 => {
            c.reg[rx] = (!c.reg[rx]) & 0xFFFF;
            c.last_alu_result = c.reg[rx] as i32;
            c.last_op_alu = true;
            false
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
        0b0100 => {
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
        let target_pc = ((c.reg[15] as i32) + (off as i16 as i32)) as u16;
        c.delay_active = true;
        c.delayed_pc = target_pc;
        c.delayed_cs = c.cs;
        c.branch_taken = true;
    } else {
        c.branch_taken = false;
    }
    true
}

fn step_one(c: &mut Cpu) -> bool {
    if !c.running { c.running = true; }
    if c.delay_active {
        c.delay_active = false;
        let pc = c.reg[15] as usize;
        if pc >= c.mem.len() { c.running = false; return false; }
        let instr = c.mem[pc];
        let original_pc = c.reg[15];
        c.reg[15] = c.reg[15].wrapping_add(1);
        c.last_op_alu = false;
        c.last_alu_result = 0;
        let is_branch = exec_instruction(c, instr, original_pc);
        update_psw_flags(c);
        if c.branch_taken { c.reg[15] = c.delayed_pc; c.cs = c.delayed_cs; }
        return !is_branch || c.running;
    }
    let pc = c.reg[15] as usize;
    if pc >= c.mem.len() { c.running = false; return false; }
    let instr = c.mem[pc];
    if instr == 0xFFFF { c.running = false; return false; }
    let original_pc = c.reg[15];
    c.reg[15] = c.reg[15].wrapping_add(1);
    c.last_op_alu = false;
    c.last_alu_result = 0;
    let is_branch = exec_instruction(c, instr, original_pc);
    update_psw_flags(c);
    true
}

fn exec_instruction(c: &mut Cpu, instr: u16, _original_pc: u16) -> bool {
    if (instr & 0x8000) == 0 { exec_ldi(c, instr); return false; }
    if ((instr >> 14) & 0x3) == 0b10 { exec_mem(c, instr); return false; }
    let opcode3 = (instr >> 13) & 0x7;
    match opcode3 {
        0b110 => { exec_alu(c, instr); false }
        0b111 => {
            if ((instr >> 12) & 0xF) == 0b1110 { return exec_jump(c, instr); }
            if ((instr >> 11) & 0x1F) == 0b11110 { exec_lds_sts(c, instr); return false; }
            if ((instr >> 10) & 0x3F) == 0b111110 { exec_mov(c, instr); return false; }
            if ((instr >> 9) & 0x7F) == 0b1111110 { exec_lsi(c, instr); return false; }
            if ((instr >> 8) & 0xFF) == 0b11111110 { return exec_sop(c, instr); }
            if ((instr >> 7) & 0x1FF) == 0b111111110 { exec_mvs(c, instr); return false; }
            false
        }
        _ => false,
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
