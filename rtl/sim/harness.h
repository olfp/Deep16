// Deep16 RTL - C++ harness.
//
// Mirrors the export surface of wasm/deep16-wasm/src/lib.rs 1:1 (init, reset,
// step, run_steps, get_*/set_*, load_program, kbd_push/kbd_clear,
// get_recent_access, get_last_event, get_shadow_state) plus a few read-only
// extras the IDE and the test suite want from a third core:
//   get_cycle_count()   - free-running clock counter of the model
//   get_delay_state()   - the pending delay-slot state (debug/sweep)
//   poke()/peek()       - direct memory access for the decode sweep
//
// Everything goes through the model's own ports; the memory array is touched
// directly (it is marked /*verilator public*/), exactly like the WASM core's
// Box<[u16]> slicing, so a WASM build behaves identically to the native one.
#ifndef DEEP16_HARNESS_H
#define DEEP16_HARNESS_H

#include <cstdint>

extern "C" {

void          init(uint32_t mem_words);
void          reset();
int           step();                    // 1 = continue, 0 = halted
int           run_steps(uint32_t n);
void          get_registers(uint16_t* out);      // 16, R15 = active PC
uint16_t      get_psw();
void          get_segments(uint16_t* out);       // 4, active bank
void          get_memory_slice(uint32_t start, uint32_t count, uint16_t* out);
uint16_t      get_memory_word(uint32_t addr);
void          set_registers(const uint16_t* regs, uint32_t n);
void          set_psw(uint16_t psw);
void          set_segments(uint16_t cs, uint16_t ds, uint16_t ss, uint16_t es);
void          load_program(uint32_t ptr, const uint16_t* data, uint32_t len);
void          kbd_push(uint16_t code);
void          kbd_clear();
// Serial line (SERPLAN.md): one character per call, then the EOF flag.
void          serial_push(uint16_t code);
void          serial_set_eof();
void          serial_clear();
uint32_t      serial_available();          // characters still queued (0..127)
void          get_recent_access(uint32_t* out);  // 6
void          get_last_event(uint16_t* out);     // 5
void          get_shadow_state(uint16_t* out);   // 3
uint32_t      get_cycle_count();

// --- extras -----------------------------------------------------------------
void          get_delay_state(uint16_t* out);   // 5: active, pc, cs, taken, shadow
uint32_t      get_stall_count();                // load-use stalls (phase 2)
uint32_t      get_flush_count();                // squashed wrong-path fetches
uint32_t      get_instr_count();                // retired instructions
void          poke(uint32_t addr, uint16_t value);
uint16_t      peek(uint32_t addr);
uint32_t      get_step_count();
void          set_debug_state(uint8_t idx, uint16_t value);   // raw dbg write
uint16_t      get_debug_state(uint8_t idx);                      // raw dbg read
void          debug_tick(uint16_t* out);                          // clock + pipeline snapshot (8)
void          debug_step_trace(uint16_t* out, uint32_t max_ticks);  // 8 words per clock

}  // extern "C"

#endif  // DEEP16_HARNESS_H