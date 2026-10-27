// ps2_rx_tb.cpp - bit-bang a PS/2 keyboard into the receiver.
//
// The pin timing is much faster than a real keyboard (12 clocks per bit at the
// 1 MHz test clock), but the receiver only cares about falling clock edges and
// stable data, so it exercises the same path. The map file is loaded by
// $readmemh, so the test must run from artifacts/image/.
#include <cstdio>
#include <cstdint>
#include "Vps2_rx_tb.h"
#include "verilated.h"

namespace {

Vps2_rx_tb* top;
int fails = 0;

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
  uint8_t ascii = 0;
  bool error = false;
};

Result collect(int cycles = 24) {
  Result r;
  for (int i = 0; i < cycles; i++) {
    tick();
    if (top->valid) {
      r.valid = true;
      r.ascii = (uint8_t)top->ascii;
    }
    if (top->frame_error) r.error = true;
  }
  return r;
}

void expect(const char* what, Result r, bool want_valid, uint8_t want) {
  const bool ok = (r.valid == want_valid) && (!want_valid || r.ascii == want);
  if (!ok) {
    std::printf("FAIL %-28s valid=%d ascii=0x%02x (want valid=%d ascii=0x%02x)\n",
                what, (int)r.valid, r.ascii, (int)want_valid, want);
    fails++;
  }
}

void expect_error(const char* what, Result r, bool want) {
  if (r.error != want) {
    std::printf("FAIL %-28s frame_error=%d (want %d)\n", what, (int)r.error, (int)want);
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

  // Plain letter.
  send_code(0x1C);
  expect("A make -> a", collect(), true, 'a');

  // Break: 0xF0 then the make code must not emit.
  send_code(0xF0);
  expect("break prefix", collect(), false, 0);
  send_code(0x1C);
  expect("A break -> nothing", collect(), false, 0);

  // Shift.
  send_code(0x12);
  expect("Shift make", collect(), false, 0);
  send_code(0x1C);
  expect("Shift+A -> A", collect(), true, 'A');
  send_code(0xF0);
  expect("Shift break prefix", collect(), false, 0);
  send_code(0x12);
  expect("Shift break", collect(), false, 0);
  send_code(0x1C);
  expect("A after Shift break -> a", collect(), true, 'a');

  // Caps Lock.
  send_code(0x58);
  expect("Caps make", collect(), false, 0);
  send_code(0x1C);
  expect("Caps+A -> A", collect(), true, 'A');
  send_code(0x58);
  expect("Caps make again", collect(), false, 0);
  send_code(0x1C);
  expect("Caps off, A -> a", collect(), true, 'a');

  // Line editing and control keys.
  send_code(0x5A);
  expect("Enter -> CR", collect(), true, '\r');
  send_code(0x66);
  expect("Backspace -> BS", collect(), true, '\b');
  send_code(0x0D);
  expect("Tab -> TAB", collect(), true, '\t');
  send_code(0x76);
  expect("Esc -> ESC", collect(), true, 0x1B);
  send_code(0x29);
  expect("Space -> space", collect(), true, ' ');

  // Shifted punctuation.
  send_code(0x12);
  (void)collect();
  send_code(0x55);
  expect("Shift+= -> +", collect(), true, '+');
  send_code(0xF0);
  (void)collect();
  send_code(0x55);
  (void)collect();
  send_code(0xF0);
  (void)collect();
  send_code(0x12);
  (void)collect();

  // Ctrl+letter.
  send_code(0x14);
  expect("Ctrl make", collect(), false, 0);
  send_code(0x1C);
  expect("Ctrl+A -> 0x01", collect(), true, 0x01);
  send_code(0xF0);
  (void)collect();
  send_code(0x14);
  (void)collect();
  send_code(0x1C);
  expect("A after Ctrl break -> a", collect(), true, 'a');

  // Extended keys are ignored, not mistaken for the keypad codes they share.
  send_code(0xE0);
  expect("E0 prefix", collect(), false, 0);
  send_code(0x75);
  expect("E0 75 (Up) -> nothing", collect(), false, 0);
  send_code(0x75);
  expect("keypad 8 -> 8", collect(), true, '8');

  // BAT/ACK are not keys.
  send_code(0xAA);
  expect("BAT 0xAA", collect(), false, 0);
  send_code(0xFA);
  expect("ACK 0xFA", collect(), false, 0);

  // A bad parity frame is dropped and raises frame_error; the next good frame
  // clears it.
  send_code(0x1C, true);
  {
    Result r = collect();
    expect("bad parity: no key", r, false, 0);
    expect_error("bad parity: error", r, true);
  }
  send_code(0x1C);
  {
    Result r = collect();
    expect("good frame after error", r, true, 'a');
    expect_error("good frame clears error", r, false);
  }

  // Repeat: a keyboard sends the make code again without a break.
  send_code(0x1C);
  expect("repeat 1", collect(), true, 'a');
  send_code(0x1C);
  expect("repeat 2", collect(), true, 'a');

  delete top;
  std::printf("%s\n", fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
