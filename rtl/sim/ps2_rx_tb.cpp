// ps2_rx_tb.cpp - bit-bang a PS/2 keyboard into the receiver.
//
// The pin timing is much faster than a real keyboard (12 clocks per bit at the
// 1 MHz test clock), but the receiver only cares about falling clock edges and
// stable data, so it exercises the same path. ASCII mapping is software now,
// so this test pins the raw {extended, modifiers, scan_code} event stream.
#include <cstdio>
#include <cstdint>
#include "Vps2_rx_tb.h"
#include "verilated.h"

namespace {

Vps2_rx_tb* top;
int fails = 0;

constexpr uint8_t MOD_SHIFT = 0x1;
constexpr uint8_t MOD_CTRL  = 0x2;
constexpr uint8_t MOD_ALT   = 0x4;
constexpr uint8_t MOD_CAPS  = 0x8;

void tick() {
  top->clk = 0;
  top->eval();
  top->clk = 1;
  top->eval();
}

void idle(int n) {
  for (int i = 0; i < n; i++) tick();
}

// One PS/2 bit: data is set while the clock is high, then the clock falls (the
// receiver samples there), then returns high before the next bit.
void send_bit(int b, bool final = false) {
  top->ps2_clk = 1;
  top->ps2_data = b;
  idle(4);
  top->ps2_clk = 0;
  idle(4);
  if (!final) {
    top->ps2_clk = 1;
    idle(4);
  }
}

void send_code(uint8_t code, bool bad_parity = false) {
  int ones = 0;
  for (int i = 0; i < 8; i++) ones += (code >> i) & 1;
  int parity = (ones & 1) ? 0 : 1;      // odd parity
  if (bad_parity) parity ^= 1;
  uint16_t frame = (uint16_t)((1u << 10) | (parity << 9) | (code << 1));
  for (int i = 0; i < 11; i++) send_bit((frame >> i) & 1, i == 10);
}

struct Result {
  bool valid = false;
  bool extended = false;
  uint8_t code = 0;
  uint8_t mods = 0;
  bool error = false;
};

Result collect(int cycles = 24) {
  Result r;
  for (int i = 0; i < cycles; i++) {
    tick();
    if (top->valid) {
      r.valid = true;
      r.extended = top->extended;
      r.code = (uint8_t)top->scan_code;
      r.mods = (uint8_t)top->modifiers;
    }
    if (top->frame_error) r.error = true;
  }
  return r;
}

void expect(const char* what, Result r, bool want_valid, uint8_t want_code = 0,
            uint8_t want_mods = 0, bool want_ext = false) {
  const bool ok = (r.valid == want_valid) &&
                  (!want_valid || (r.code == want_code && r.mods == want_mods &&
                                   r.extended == want_ext));
  if (!ok) {
    std::printf("FAIL %-32s valid=%d ext=%d code=0x%02x mods=0x%x "
                "(want valid=%d ext=%d code=0x%02x mods=0x%x)\n",
                what, (int)r.valid, (int)r.extended, r.code, r.mods,
                (int)want_valid, (int)want_ext, want_code, want_mods);
    fails++;
  }
}

void expect_error(const char* what, Result r, bool want) {
  if (r.error != want) {
    std::printf("FAIL %-32s frame_error=%d (want %d)\n", what, (int)r.error, (int)want);
    fails++;
  }
}

}  // namespace

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vps2_rx_tb;
  top->clk = 0;
  top->rst = 1;
  top->ps2_clk = 1;
  top->ps2_data = 1;
  idle(8);
  top->rst = 0;
  idle(4);

  // Plain make.
  send_code(0x1C);
  expect("A make", collect(), true, 0x1C, 0, false);

  // Break: 0xF0 then the make code must not emit.
  send_code(0xF0);
  expect("break prefix", collect(), false);
  send_code(0x1C);
  expect("A break", collect(), false);

  // Shift.
  send_code(0x12);
  expect("Shift make", collect(), false);
  send_code(0x1C);
  expect("Shift+A event", collect(), true, 0x1C, MOD_SHIFT, false);
  send_code(0xF0);
  expect("Shift break prefix", collect(), false);
  send_code(0x12);
  expect("Shift break", collect(), false);
  send_code(0x1C);
  expect("A after Shift break", collect(), true, 0x1C, 0, false);

  // Caps Lock.
  send_code(0x58);
  expect("Caps make", collect(), false);
  send_code(0x1C);
  expect("Caps+A event", collect(), true, 0x1C, MOD_CAPS, false);
  send_code(0x58);
  expect("Caps make again", collect(), false);
  send_code(0x1C);
  expect("Caps off, A", collect(), true, 0x1C, 0, false);

  // Ctrl.
  send_code(0x14);
  expect("Ctrl make", collect(), false);
  send_code(0x1C);
  expect("Ctrl+A event", collect(), true, 0x1C, MOD_CTRL, false);
  send_code(0xF0);
  (void)collect();
  send_code(0x14);
  (void)collect();
  send_code(0x1C);
  expect("A after Ctrl break", collect(), true, 0x1C, 0, false);

  // Extended navigation still reaches software, with the E0 bit set.
  send_code(0xE0);
  expect("E0 prefix", collect(), false);
  send_code(0x75);
  expect("E0 75 (Up)", collect(), true, 0x75, 0, true);
  send_code(0x75);
  expect("keypad 8", collect(), true, 0x75, 0, false);
  send_code(0xE0);
  (void)collect();
  send_code(0x6B);
  expect("E0 6B (Left)", collect(), true, 0x6B, 0, true);
  send_code(0xE0);
  (void)collect();
  send_code(0x74);
  expect("E0 74 (Right)", collect(), true, 0x74, 0, true);
  send_code(0xE0);
  (void)collect();
  send_code(0x72);
  expect("E0 72 (Down)", collect(), true, 0x72, 0, true);
  send_code(0xE0);
  (void)collect();
  send_code(0x6C);
  expect("E0 6C (Home)", collect(), true, 0x6C, 0, true);
  send_code(0xE0);
  (void)collect();
  send_code(0x69);
  expect("E0 69 (End)", collect(), true, 0x69, 0, true);
  // The break of an extended key must not emit.
  send_code(0xE0);
  (void)collect();
  send_code(0xF0);
  (void)collect();
  send_code(0x75);
  expect("E0 F0 75", collect(), false);

  // AltGr (E0 11) sets the Alt bit; the code is still the original key.
  send_code(0xE0);
  (void)collect();
  send_code(0x11);
  expect("AltGr make", collect(), false);
  send_code(0x15);
  expect("AltGr+Q event", collect(), true, 0x15, MOD_ALT, false);
  send_code(0x3E);
  expect("AltGr+8 event", collect(), true, 0x3E, MOD_ALT, false);
  send_code(0xE0);
  (void)collect();
  send_code(0xF0);
  (void)collect();
  send_code(0x11);
  expect("AltGr break", collect(), false);
  send_code(0x15);
  expect("Q after AltGr", collect(), true, 0x15, 0, false);

  // BAT/ACK are not keys.
  send_code(0xAA);
  expect("BAT 0xAA", collect(), false);
  send_code(0xFA);
  expect("ACK 0xFA", collect(), false);

  // A bad parity frame is dropped and raises frame_error; the next good frame
  // clears it.
  send_code(0x1C, true);
  {
    Result r = collect();
    expect("bad parity: no key", r, false);
    expect_error("bad parity: error", r, true);
  }
  send_code(0x1C);
  {
    Result r = collect();
    expect("good frame after error", r, true, 0x1C, 0, false);
    expect_error("good frame clears error", r, false);
  }

  // Repeat: a keyboard sends the make code again without a break.
  send_code(0x1C);
  expect("repeat 1", collect(), true, 0x1C, 0, false);
  send_code(0x1C);
  expect("repeat 2", collect(), true, 0x1C, 0, false);

  delete top;
  std::printf("%s\n", fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
