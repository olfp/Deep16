// timer_tb.cpp - count milliseconds, compare, clear and stop/start.
#include <cstdio>
#include <cstdint>
#include "Vtimer_tb.h"
#include "verilated.h"

namespace {
Vtimer_tb* top;
int fails = 0;

void tick() {
  top->clk = 0; top->eval();
  top->clk = 1; top->eval();
}

void idle(int n) { for (int i = 0; i < n; i++) tick(); }

void write_reg(uint8_t addr, uint16_t value) {
  top->addr = addr; top->wdata = value; top->we = 1; tick();
  top->we = 0; tick();
}

uint16_t read_reg(uint8_t addr) {
  top->addr = addr; top->we = 0; top->eval();
  return (uint16_t)top->rdata;
}

void expect(const char* what, uint16_t got, uint16_t want) {
  if (got != want) {
    std::printf("FAIL %-30s got 0x%04x, want 0x%04x\n", what, got, want);
    fails++;
  }
}

void expect_range(const char* what, uint16_t got, uint16_t lo, uint16_t hi) {
  if (got < lo || got > hi) {
    std::printf("FAIL %-30s got %u, want %u..%u\n", what, got, lo, hi);
    fails++;
  }
}
}  // namespace

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vtimer_tb;
  top->clk = 0; top->rst = 1; top->we = 0; top->addr = 0; top->wdata = 0;
  idle(8);
  top->rst = 0;
  idle(4);

  // Reset state: running, no match, compare erased.
  expect("CTRL enable after reset", read_reg(0x0) & 1, 1);
  expect("STATUS match after reset", read_reg(0xA) & 1, 0);
  expect("VALUE_LO after reset", read_reg(0x2), 0);
  expect("VALUE_HI after reset", read_reg(0x4), 0);

  // One millisecond at 1 MHz is DIV = 1000.
  idle(1005);
  expect_range("after 1 ms", read_reg(0x2), 1, 2);

  // Compare at 3 ms and wait for the sticky match.
  write_reg(0x6, 3);
  write_reg(0x8, 0);
  expect("CMP_LO readback", read_reg(0x6), 3);
  expect("CMP_HI readback", read_reg(0x8), 0);
  for (int i = 0; i < 4000 && !(read_reg(0xA) & 1); i++) tick();
  expect("match at 3 ms", read_reg(0xA) & 1, 1);
  expect_range("VALUE at match", read_reg(0x2), 3, 4);

  // Clear the flag; it must stay clear until the compare value is reached again.
  write_reg(0x0, 0x0003);       // enable + clear match
  expect("match cleared", read_reg(0xA) & 1, 0);
  idle(1000);
  expect("no re-match before next compare", read_reg(0xA) & 1, 0);

  // Stop: the value must not change.
  write_reg(0x0, 0x0000);
  uint16_t stopped = read_reg(0x2);
  idle(1500);
  expect("value held while stopped", read_reg(0x2), stopped);
  expect("STATUS running low", (read_reg(0xA) >> 1) & 1, 0);

  // Start again: it must advance.
  write_reg(0x0, 0x0001);
  idle(1005);
  expect_range("value advances after start", read_reg(0x2), (uint16_t)(stopped + 1), (uint16_t)(stopped + 3));

  delete top;
  std::printf("%s\n", fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
