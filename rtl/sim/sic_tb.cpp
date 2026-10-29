// sic_tb.cpp - pending is sticky and W1C, enable gates the level IRQ, and the
// scratch cell is a plain read/write word.
#include <cstdio>
#include <cstdint>
#include "Vsic_tb.h"
#include "verilated.h"

namespace {
Vsic_tb* top;
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
    std::printf("FAIL %-36s got 0x%04x, want 0x%04x\n", what, got, want);
    fails++;
  }
}
}  // namespace

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vsic_tb;
  top->clk = 0; top->rst = 1; top->we = 0; top->addr = 0; top->wdata = 0;
  top->src = 0;
  idle(4);
  top->rst = 0;
  idle(2);

  expect("pending clears on reset", read_reg(0x0), 0);
  expect("enable clears on reset", read_reg(0x2), 0);
  expect("irq low after reset", top->irq, 0);

  // A pulse sets the sticky bit; it stays after the source drops.
  top->src = 1 << 1;          // timer
  tick();
  top->src = 0;
  idle(2);
  expect("timer pending is sticky", read_reg(0x0), 2);
  expect("status reports pending", read_reg(0x4), 2);
  expect("irq stays low while disabled", top->irq, 0);

  // Enable only the timer: the level asserts.
  write_reg(0x2, 0x2);
  expect("timer enabled", read_reg(0x2), 2);
  expect("irq asserts when enabled", top->irq, 1);
  expect("status reports irq", read_reg(0x4) & 1, 1);

  // W1C clears only the written bit.
  write_reg(0x0, 0x1);        // keyboard bit, not set
  expect("W1C leaves the timer bit", read_reg(0x0), 2);
  write_reg(0x0, 0x2);
  expect("W1C clears the timer bit", read_reg(0x0), 0);
  expect("irq drops after W1C", top->irq, 0);

  // A pulse in the same cycle as W1C still survives.
  top->src = 1 << 1;
  top->addr = 0x0; top->wdata = 0x2; top->we = 1; tick();
  top->we = 0; top->src = 0; tick();
  expect("source wins over simultaneous W1C", read_reg(0x0), 2);
  write_reg(0x0, 0x2);

  // All four bits latch; priority is software's highest-set-bit choice.
  top->src = 0xF; tick(); top->src = 0; tick();
  expect("four sources latch", read_reg(0x0), 0xF);
  write_reg(0x0, 0xF);
  expect("all pending cleared", read_reg(0x0), 0);

  // Scratch is independent of the pending bits.
  write_reg(0x6, 0x1234);
  expect("scratch readback", read_reg(0x6), 0x1234);
  expect("unknown offset reads zero", read_reg(0x8), 0);

  // Disabling the source drops the level but keeps pending.
  top->src = 1 << 3; tick(); top->src = 0; tick();
  write_reg(0x2, 0x0);
  expect("pending survives disable", read_reg(0x0), 8);
  expect("irq low when disabled", top->irq, 0);
  write_reg(0x0, 8);

  delete top;
  std::printf("%s\n", fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
