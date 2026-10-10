// Shared helpers for the Deep16 test suite.
//
// js/*.js are plain browser scripts (no modules, no exports), so they are
// loaded into the global context the same way index.html pulls them in.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MEM_WORDS = 1048576;   // 20-bit address space, 16-bit words
export const SCREEN_ADDR = 0xF1000;

// A top-level `class` in a script lands in the global lexical scope, not on
// globalThis, so the classes are read back by evaluating their names.
export function loadBrowserScripts(...files) {
  for (const f of files) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
  }
  for (const name of ['Deep16Assembler', 'Deep16Disassembler', 'Deep16Simulator']) {
    try {
      globalThis[name] = vm.runInThisContext(name);
    } catch {
      // not defined by this set of files
    }
  }
  return globalThis;
}

export function assemble(source) {
  const { Deep16Assembler } = globalThis;
  return new Deep16Assembler().assemble(source);
}

// Full flat memory image for the JS core.
export function buildMemory(res, fill = 0xFFFF) {
  const mem = new Array(MEM_WORDS).fill(fill);
  for (const ch of res.memoryChanges) mem[ch.address] = ch.value & 0xFFFF;
  return mem;
}

// Run a program on the JS core. cs defaults to 0xFFFF so the built-in ROM
// boots the way it does in the IDE.
export function runJs(res, { cs = 0xFFFF, ds = 0x0000, ss = 0x0000, es = 0x0000, maxSteps = 200000, fill = 0xFFFF, keys = [], serial = '', serialEof = false } = {}) {
  const { Deep16Simulator } = globalThis;
  if (!res.success) throw new Error(`program does not assemble: ${res.errors.join('; ')}`);
  const sim = new Deep16Simulator();
  sim.loadProgram(buildMemory(res, fill));
  sim.segmentRegisters.CS = cs;
  sim.segmentRegisters.DS = ds;
  sim.segmentRegisters.SS = ss;
  sim.segmentRegisters.ES = es;
  sim.running = true;
  for (const code of keys) sim.enqueueKeyCode(code & 0xFFFF);
  // Serial line (SERPLAN.md): preload the queue, then optionally raise EOF.
  if (serial) sim.serialPushString(serial);
  if (serialEof) sim.serialSetEof(true);
  let steps = 0;
  while (sim.running && steps < maxSteps) { sim.step(); steps++; }
  return { sim, steps, registers: sim.registers, memory: sim.memory };
}

export function readScreen(memory, count = 200) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const c = memory[SCREEN_ADDR + i] & 0xFF;
    if (c === 0x00 || c === 0xFF) break;
    out += String.fromCharCode(c);
  }
  return out;
}

let wasm = null;

// The WASM core is a singleton with module-level state, so it can only be
// instantiated once per process.
export async function loadWasm() {
  if (wasm) return wasm;
  const mod = await import(path.join(ROOT, 'wasm/pkg/deep16_wasm.js'));
  await mod.default({
    module_or_path: new WebAssembly.Module(fs.readFileSync(path.join(ROOT, 'wasm/pkg/deep16_wasm_bg.wasm'))),
  });
  wasm = mod;
  return wasm;
}

// Run a program on the WASM core and return the same shape as runJs.
export async function runWasm(res, { cs = 0xFFFF, ds = 0x0000, ss = 0x0000, es = 0x0000, maxSteps = 200000, keys = [], serial = '', serialEof = false } = {}) {
  if (!res.success) throw new Error(`program does not assemble: ${res.errors.join('; ')}`);
  const w = await loadWasm();
  w.init(MEM_WORDS);
  for (const ch of res.memoryChanges) {
    w.load_program(ch.address, new Uint16Array([ch.value & 0xFFFF]));
  }
  w.set_segments(cs, ds, ss, es);
  // Preload the polled keyboard port (parity with Deep16Simulator.enqueueKeyCode):
  // the Forth REPL's BIOS getch/getstr read KBD_STATUS/KBD_DATA at 0xF0060/2.
  for (const code of keys) w.kbd_push(code & 0xFFFF);
  // Serial line (SERPLAN.md): characters first, then the EOF flag.
  for (const ch of serial) w.serial_push(ch.charCodeAt(0));
  if (serialEof) w.serial_set_eof(true);
  let steps = 0;
  let cont = true;
  while (cont && steps < maxSteps) { cont = w.step(); steps++; }
  return {
    steps,
    registers: Array.from(w.get_registers()),
    psw: w.get_psw(),
    segments: Array.from(w.get_segments()),
    memoryAt: (addr, count) => Array.from(w.get_memory_slice(addr, count)),
    kbdPush: (code) => w.kbd_push(code & 0xFFFF),
    serialPush: (code) => w.serial_push(code & 0xFFFF),
  };
}

// The RTL core (Verilator + Emscripten) is a third core with the same export
// surface as the WASM one. rtl/pkg/ is committed, so no build step is needed.
let rtl = null;

export async function loadRtl() {
  if (rtl) return rtl;
  const mod = await import(path.join(ROOT, 'rtl/pkg/deep16_rtl.js'));
  rtl = await mod.default({
    wasmBinary: fs.readFileSync(path.join(ROOT, 'rtl/pkg/deep16_rtl_gen.wasm')),
  });
  return rtl;
}

// Run a program on the RTL core and return the same shape as runWasm.
export async function runRtl(res, { cs = 0xFFFF, ds = 0x0000, ss = 0x0000, es = 0x0000, maxSteps = 200000, keys = [], serial = '', serialEof = false } = {}) {
  if (!res.success) throw new Error(`program does not assemble: ${res.errors.join('; ')}`);
  const r = await loadRtl();
  r.init(MEM_WORDS);
  for (const ch of res.memoryChanges) {
    r.load_program(ch.address, new Uint16Array([ch.value & 0xFFFF]));
  }
  r.set_segments(cs, ds, ss, es);
  for (const code of keys) r.kbd_push(code & 0xFFFF);
  for (const ch of serial) r.serial_push(ch.charCodeAt(0));
  if (serialEof) r.serial_set_eof();
  let steps = 0;
  let cont = true;
  while (cont && steps < maxSteps) { cont = r.step(); steps++; }
  return {
    steps,
    registers: Array.from(r.get_registers()),
    psw: r.get_psw(),
    segments: Array.from(r.get_segments()),
    shadow: Array.from(r.get_shadow_state()),
    memoryAt: (addr, count) => Array.from(r.get_memory_slice(addr, count)),
    kbdPush: (code) => r.kbd_push(code & 0xFFFF),
    cycleCount: () => r.get_cycle_count(),
    stallCount: () => r.get_stall_count(),
    flushCount: () => r.get_flush_count(),
    instrCount: () => r.get_instr_count(),
    stepCount: () => r.get_step_count(),
    delayState: () => Array.from(r.get_delay_state()),
  };
}

// Instruction builders, so a test can bypass the assembler when it needs a
// word the assembler (correctly) refuses to produce. specs: Deep16-Arch.md
export const enc = {
  LDI: (imm) => imm & 0x7FFF,                              // 15-bit immediate
  LSI: (rd, imm) => 0xFC00 | (rd << 5) | (imm & 0x1F),     // 1111110 Rd4 imm5
  LD:  (rd, rb, off) => 0x8000 | (rd << 9) | (rb << 5) | (off & 0x1F),
  ST:  (rd, rb, off) => 0xA000 | (rd << 9) | (rb << 5) | (off & 0x1F),
  MUL32: (rd, rs) => (0b110 << 13) | (0b11101 << 8) | (rd << 4) | rs,
  DIV32: (rd, rs) => (0b110 << 13) | (0b11111 << 8) | (rd << 4) | rs,
  HLT: 0xFFFF,
};

// Assemble a raw word list as if it were a program, so both cores can run it.
export function rawProgram(words) {
  return {
    success: true,
    errors: [],
    memoryChanges: words.map((w, i) => ({ address: i, value: w & 0xFFFF })),
  };
}