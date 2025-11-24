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

fn phys(seg: u16, off: u32) -> usize {
    (((seg as u32) << 4) + off) as usize
}

fn step_one(c: &mut Cpu) -> bool {
    if !c.running {
        c.running = true;
    }
    let pc = c.reg[15] as usize;
    if pc >= c.mem.len() {
        return false;
    }
    let instr = c.mem[pc];
    if instr == 0xFFFF {
        c.running = false;
        return false;
    }
    c.reg[15] = c.reg[15].wrapping_add(1);

    let top2 = (instr >> 14) & 0x3;
    if top2 == 0b10 {
        let d = (instr >> 13) & 0x1;
        let rd = ((instr >> 9) & 0xF) as usize;
        let rb = ((instr >> 5) & 0xF) as usize;
        let off = (instr & 0x1F) as u32;
        let addr_off = (c.reg[rb] as u32).wrapping_add(off);
        let seg = c.ds;
        let pa = phys(seg, addr_off);
        if pa >= c.mem.len() { return true; }
        if d == 0 {
            c.reg[rd] = c.mem[pa];
        } else {
            c.mem[pa] = c.reg[rd];
        }
        return true;
    }

    let top7 = (instr >> 9) & 0x7F;
    if top7 == 0b1111110 {
        let rd = ((instr >> 5) & 0xF) as usize;
        let mut imm = (instr & 0x1F) as i16;
        if (imm & 0x10) != 0 { imm |= -1i16 << 5; }
        c.reg[rd] = imm as u16;
        return true;
    }

    let top6 = (instr >> 10) & 0x3F;
    if top6 == 0b111110 {
        let rd = ((instr >> 6) & 0xF) as usize;
        let rs = ((instr >> 2) & 0xF) as usize;
        let imm2 = (instr & 0x3) as u16;
        c.reg[rd] = c.reg[rs].wrapping_add(imm2);
        return true;
    }

    true
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

