// Deep16 RTL - C++ harness implementation (see harness.h).
#include "harness.h"

#include <cstring>

#include "Vdeep16_top.h"
#include "Vdeep16_top_deep16_top.h"   // the /*verilator public*/ memory array
#include "verilated.h"

namespace {

VerilatedContext* g_ctx = nullptr;
Vdeep16_top*      g_top = nullptr;
uint64_t          g_steps = 0;

// Debug bus indices of the core (see rtl/deep16_core.sv for the full map).
enum : uint8_t {
  DBG_REGS   = 0x00,
  DBG_PSW    = 0x10,
  DBG_CS     = 0x11,
  DBG_DS     = 0x12,
  DBG_SS     = 0x13,
  DBG_ES     = 0x14,
  DBG_SPSW   = 0x15,
  DBG_SPC    = 0x16,
  DBG_SCS    = 0x17,
  DBG_SDS    = 0x18,
  DBG_SSS    = 0x19,
  DBG_SES    = 0x1A,
  DBG_SREG   = 0x1B,   // 0x1B..0x20 = shadow R0'-R3', R13', R14'
  DBG_FLAGS  = 0x21,   // {running, delayed_to_shadow, branch_taken, delay_active}
  DBG_DPC    = 0x22,
  DBG_DCS    = 0x23,
  DBG_EVCODE = 0x24,
  DBG_EVSPC  = 0x25,
  DBG_EVSCS  = 0x26,
  DBG_RECLO  = 0x27,
  DBG_RECHI  = 0x28,
  DBG_RECBASE= 0x29,
  DBG_RECOFF = 0x2A,
  DBG_RECSEG = 0x2B,
  DBG_RECKIND= 0x2C,
  DBG_CYCLEL = 0x2D,
  DBG_CYCLEH = 0x2E,
  DBG_INSTR  = 0x2F,
  DBG_STALLL = 0x54,
  DBG_STALLH = 0x55,
  DBG_FLUSHL = 0x56,
  DBG_FLUSHH = 0x57,
  DBG_INSTL  = 0x58,
  DBG_INSTH  = 0x59,
  DBG_ROM    = 0xC0,   // 0xC0..0xCF = the boot ROM words
  DBG_BANKED = 0x30,   // 0x30..0x3F = active view of the register file
};

void tick() {
  g_top->clk = 0;
  g_top->eval();
  g_top->clk = 1;
  g_top->eval();
  g_ctx->timeInc(1);
}

uint16_t dbg_read(uint8_t idx) {
  g_top->dbg_en = 1;
  g_top->dbg_we = 0;
  g_top->dbg_idx = idx;
  g_top->eval();
  uint16_t v = g_top->dbg_rdata;
  g_top->dbg_en = 0;
  return v;
}

void dbg_write(uint8_t idx, uint16_t value) {
  g_top->dbg_en = 1;
  g_top->dbg_we = 1;
  g_top->dbg_idx = idx;
  g_top->dbg_wdata = value;
  tick();
  g_top->dbg_we = 0;
  g_top->dbg_en = 0;
}

uint16_t* memory() {
  // The array is declared /*verilator public*/ in deep16_top.sv, which makes
  // the module cell reachable from the model object.
  return reinterpret_cast<uint16_t*>(&g_top->deep16_top->mem[0]);
}

// The ROM words are read back through the debug window, so the harness has no
// second copy of the boot code that could drift away from the RTL.
uint32_t mem_words() { return g_top->deep16_top->mem.size(); }

constexpr uint32_t ROM_WORDS = 16;

void rom_copy(uint16_t* m) {
  uint32_t base = mem_words() - ROM_WORDS;
  for (uint32_t i = 0; i < ROM_WORDS; i++) m[base + i] = dbg_read(DBG_ROM + i);
}

void reset_core() {
  // Core reset clears PSW, segments, shadow bank, delay state, event log and
  // the recent-access record (see the reset branch in deep16_core.sv).
  g_top->rst = 1;
  tick();
  tick();
  g_top->rst = 0;
  g_top->eval();
}

void reset_memory() {
  uint16_t* m = memory();
  for (uint32_t i = 0; i < mem_words(); i++) m[i] = 0xFFFF;
  rom_copy(m);
}

}  // namespace

extern "C" {

void init(uint32_t /*mem_words*/) {
  if (!g_top) {
    g_ctx = new VerilatedContext;
    g_top = new Vdeep16_top(g_ctx);
  }
  g_top->clk = 0;
  g_top->rst = 1;
  g_top->i_step = 0;
  g_top->kbd_push = 0;
  g_top->kbd_clear = 0;
  g_top->dbg_en = 0;
  g_top->dbg_we = 0;
  g_top->dbg_idx = 0;
  g_top->dbg_wdata = 0;
  g_top->eval();
  g_steps = 0;
  reset_memory();
  reset_core();
  kbd_clear();      // a fresh core has an empty keyboard FIFO, like the others
}

void reset() {
  reset_memory();
  reset_core();
  kbd_clear();
  g_steps = 0;
}

int step() {
  g_top->i_step = 1;
  tick();                       // take the step request
  g_top->i_step = 0;
  // The pipeline runs until one instruction retires (or a halt word has been
  // reached and the pipe has drained). The guard keeps a stuck pipeline from
  // hanging the browser; a healthy step needs at most ~8 cycles.
  for (uint32_t guard = 0; guard < 4096 && !g_top->o_done; guard++) tick();
  g_steps++;
  return g_top->o_result ? 1 : 0;
}

int run_steps(uint32_t n) {
  int cont = 1;
  for (uint32_t i = 0; i < n; i++) {
    if (!step()) { cont = 0; break; }
  }
  return cont;
}

void get_registers(uint16_t* out) {
  for (int i = 0; i < 16; i++) out[i] = dbg_read(DBG_REGS + i);
  if (dbg_read(DBG_PSW) & (1u << 5)) out[15] = dbg_read(DBG_SPC);
}

uint16_t get_psw() { return dbg_read(DBG_PSW); }

void get_segments(uint16_t* out) {
  bool in_shadow = (dbg_read(DBG_PSW) & (1u << 5)) != 0;
  uint8_t base = in_shadow ? DBG_SCS : DBG_CS;
  for (int i = 0; i < 4; i++) out[i] = dbg_read(base + i);
}

void get_memory_slice(uint32_t start, uint32_t count, uint16_t* out) {
  uint32_t end = start + count;
  if (end > mem_words()) end = mem_words();
  uint16_t* m = memory();
  for (uint32_t a = start; a < end; a++) out[a - start] = m[a];
}

uint16_t get_memory_word(uint32_t addr) {
  return (addr < mem_words()) ? memory()[addr] : 0xFFFF;
}

void set_registers(const uint16_t* regs, uint32_t n) {
  bool in_shadow = (dbg_read(DBG_PSW) & (1u << 5)) != 0;
  if (n > 16) n = 16;
  for (uint32_t i = 0; i < n; i++) {
    if (i == 15 && in_shadow) dbg_write(DBG_SPC, regs[i]);
    else                      dbg_write(DBG_REGS + i, regs[i]);
  }
}

void set_psw(uint16_t psw) { dbg_write(DBG_PSW, psw); }

void set_segments(uint16_t cs, uint16_t ds, uint16_t ss, uint16_t es) {
  dbg_write(DBG_CS, cs);
  dbg_write(DBG_DS, ds);
  dbg_write(DBG_SS, ss);
  dbg_write(DBG_ES, es);
}

void load_program(uint32_t ptr, const uint16_t* data, uint32_t len) {
  if (ptr + len > mem_words()) return;
  uint16_t* m = memory();
  for (uint32_t i = 0; i < len; i++) m[ptr + i] = data[i];
  rom_copy(m);
  dbg_write(DBG_REGS + 15, 0x0000);   // PC = 0, exactly like load_program() in
  dbg_write(DBG_CS, 0xFFFF);          // the WASM core (it re-arms the ROM CS)
}

void kbd_push(uint16_t code) {
  g_top->kbd_push = 1;
  g_top->kbd_push_data = code;
  tick();
  g_top->kbd_push = 0;
}

void kbd_clear() {
  g_top->kbd_clear = 1;
  tick();
  g_top->kbd_clear = 0;
}

void get_recent_access(uint32_t* out) {
  uint32_t addr = (uint32_t)dbg_read(DBG_RECLO) |
                  ((uint32_t)dbg_read(DBG_RECHI) & 0x1Fu) << 16;
  uint16_t kind = dbg_read(DBG_RECKIND);
  out[0] = addr;
  out[1] = dbg_read(DBG_RECBASE);
  out[2] = dbg_read(DBG_RECOFF) & 0x1F;
  out[3] = dbg_read(DBG_RECSEG);
  out[4] = kind & 0x3;
  out[5] = (kind >> 9) & 1;   // bit 9 of 0x2C is the store flag
}

void get_last_event(uint16_t* out) {
  out[0] = dbg_read(DBG_EVCODE);
  out[1] = dbg_read(DBG_SPC);
  out[2] = dbg_read(DBG_SCS);
  out[3] = dbg_read(DBG_PSW);
  out[4] = dbg_read(DBG_SPSW);
}

void get_shadow_state(uint16_t* out) {
  out[0] = dbg_read(DBG_SPC);
  out[1] = dbg_read(DBG_SCS);
  out[2] = dbg_read(DBG_SPSW);
}

uint32_t get_cycle_count() {
  return (uint32_t)dbg_read(DBG_CYCLEL) | ((uint32_t)dbg_read(DBG_CYCLEH) << 16);
}

// Pipeline statistics (phase 2). Stalls are load-use hazards, flushes are
// instructions that were fetched before their address was known and had to be
// discarded (the one after a delay slot, the one or two after SWI/RETI).
uint32_t get_stall_count() {
  return (uint32_t)dbg_read(DBG_STALLL) | ((uint32_t)dbg_read(DBG_STALLH) << 16);
}

uint32_t get_flush_count() {
  return (uint32_t)dbg_read(DBG_FLUSHL) | ((uint32_t)dbg_read(DBG_FLUSHH) << 16);
}

uint32_t get_instr_count() {
  return (uint32_t)dbg_read(DBG_INSTL) | ((uint32_t)dbg_read(DBG_INSTH) << 16);
}

void get_delay_state(uint16_t* out) {
  uint16_t flags = dbg_read(DBG_FLAGS);
  out[0] = flags & 1;              // delay_active
  out[1] = dbg_read(DBG_DPC);
  out[2] = dbg_read(DBG_DCS);
  out[3] = (flags >> 1) & 1;       // branch_taken
  out[4] = (flags >> 2) & 1;       // delayed_to_shadow
}

void poke(uint32_t addr, uint16_t value) {
  if (addr < mem_words()) memory()[addr] = value;
}

uint16_t peek(uint32_t addr) { return get_memory_word(addr); }

uint32_t get_step_count() { return (uint32_t)g_steps; }

void set_debug_state(uint8_t idx, uint16_t value) { dbg_write(idx, value); }

uint16_t get_debug_state(uint8_t idx) { return dbg_read(idx); }

// --- introspection for debugging (not part of the core API) ---------------
// Runs one clock and reports the pipeline state, so a stuck step can be
// located from a test without a waveform viewer. The words are:
//
//   0 run/halt/stall flags   1 stage occupancy   2 EX control signals
//   3 MEM/WB write address   4 MEM/WB write data 5 shadow R0'
//   6 PC (R15)               7 next fetch address
void debug_tick(uint16_t* state_out) {
  tick();
  state_out[0] = dbg_read(0x50);
  state_out[1] = dbg_read(0x5A);
  state_out[2] = dbg_read(0x5B);
  state_out[3] = dbg_read(0x60);
  state_out[4] = dbg_read(0x61);
  state_out[5] = dbg_read(0x1B);
  state_out[6] = dbg_read(0x0F);
  state_out[7] = dbg_read(0x52);
}

// Runs one full step and records the pipeline state of every clock into
// out[8 * n]. Debugging aid: shows which instruction each stage holds while a
// step runs, which is what a divergence needs.
void debug_step_trace(uint16_t* out, uint32_t max_ticks) {
  uint32_t n = 0;
  g_top->i_step = 1;
  tick();
  g_top->i_step = 0;
  while (n < max_ticks && !g_top->o_done) {
    tick();
    uint16_t* o = out + n * 8;
    o[0] = dbg_read(0x50);   // run / halt / stall
    o[1] = dbg_read(0x5A);   // stage occupancy
    o[2] = dbg_read(0x5B);   // EX control signals
    o[3] = dbg_read(0x5C);   // instruction in IF/ID
    o[4] = dbg_read(0x5E);   // instruction in MEM
    o[5] = dbg_read(0x1B);   // shadow R0'
    o[6] = dbg_read(0x0F);   // PC
    o[7] = dbg_read(0x52);   // next fetch address
    n++;
  }
}

}  // extern "C"