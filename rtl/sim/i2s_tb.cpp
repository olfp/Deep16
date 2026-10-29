// i2s_tb.cpp - FIFO, BCLK/LRCLK timing, I2S framing, loop and underrun.
#include <cstdio>
#include <cstdint>
#include "Vi2s_tb.h"
#include "verilated.h"

namespace {
Vi2s_tb* top;
int fails = 0;
int clk_cycles = 0;

void tick() {
  top->clk = 0; top->eval();
  top->clk = 1; top->eval();
  clk_cycles++;
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

void expect(const char* what, long got, long want) {
  if (got != want) {
    std::printf("FAIL %-34s got 0x%04lx, want 0x%04lx\n", what, got, want);
    fails++;
  }
}

// Wait for a rising edge of bclk, returning the number of clk cycles it took.
int wait_bclk_rise() {
  int n = 0;
  int prev = top->bclk;
  while (n < 1000) {
    tick();
    n++;
    int now = top->bclk;
    if (!prev && now) return n;
    prev = now;
  }
  return -1;
}

// Wait for a falling edge of bclk (the transmitter updates din there).
int wait_bclk_fall() {
  int n = 0;
  int prev = top->bclk;
  while (n < 1000) {
    tick();
    n++;
    int now = top->bclk;
    if (prev && !now) return n;
    prev = now;
  }
  return -1;
}

// Capture one channel: the first rising edge after the LRCLK edge is the
// previous LSB (ignored), the next 16 are the sample, MSB first.
uint16_t capture_channel() {
  // Expected to be called just after the LRCLK edge, with bclk low.
  uint16_t v = 0;
  int rises = 0;
  int prev = top->bclk;
  while (rises < 17) {
    tick();
    int now = top->bclk;
    if (!prev && now) {
      if (rises > 0) v = (uint16_t)((v << 1) | (top->din ? 1 : 0));
      rises++;
    }
    prev = now;
  }
  return v;
}

void reset() {
  top->rst = 1; top->we = 0; top->addr = 0; top->wdata = 0;
  idle(8);
  top->rst = 0;
  idle(4);
}
}  // namespace

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vi2s_tb;
  top->clk = 0;
  reset();

  expect("DATA level after reset", read_reg(0x0), 0);
  expect("CTRL after reset", read_reg(0x2) & 0x1f, 0);
  expect("STATUS empty", read_reg(0x4) & 1, 1);

  // Fill four samples and check the level.
  write_reg(0x0, 0x1234);
  write_reg(0x0, 0xFEDC);
  write_reg(0x0, 0x0000);
  write_reg(0x0, 0x7FFF);
  expect("level after 4 writes", read_reg(0x0), 4);
  expect("STATUS not empty", read_reg(0x4) & 1, 0);

  // Enable and align to a frame boundary, then clear the FIFO so the first
  // frame we capture is the first sample written.
  write_reg(0x2, 0x0001);   // enable
  int guard = 0;
  while (guard++ < 2000 && top->lrclk != 1) tick();
  while (guard++ < 2000 && top->lrclk != 0) tick();
  write_reg(0x2, 0x0002);   // reset while enabled, then fill again
  write_reg(0x0, 0x1234);
  write_reg(0x0, 0xFEDC);
  write_reg(0x0, 0x0000);
  write_reg(0x0, 0x7FFF);
  // Wait for the next right -> left transition, then capture the first frame.
  while (guard++ < 4000 && top->lrclk != 1) tick();
  while (guard++ < 4000 && top->lrclk != 0) tick();
  uint16_t left = capture_channel();
  expect("first sample MSB-first", left, 0x1234);
  expect("level after one frame", read_reg(0x0), 3);

  // BCLK period is 10 clk cycles and LRCLK is 16 BCLK (160 clk) per half.
  int bclk_period = wait_bclk_rise();
  expect("BCLK period", bclk_period, 10);
  int prev_lr = top->lrclk;
  while (guard++ < 4000 && top->lrclk == prev_lr) tick();
  int start = clk_cycles;
  prev_lr = top->lrclk;
  while (guard++ < 4000 && top->lrclk == prev_lr) tick();
  expect("LRCLK half period", clk_cycles - start, 160);

  // Drain the remaining samples and check underrun on an empty FIFO.
  idle(2000);
  expect("STATUS underrun", (read_reg(0x4) >> 3) & 1, 1);
  write_reg(0x2, 0x0002);   // reset clears the flags and the FIFO
  expect("reset clears underrun", (read_reg(0x4) >> 3) & 1, 0);
  expect("reset clears level", read_reg(0x0), 0);

  // Fill four samples and loop them.
  write_reg(0x0, 0x1111);
  write_reg(0x0, 0x2222);
  write_reg(0x0, 0x3333);
  write_reg(0x0, 0x4444);
  write_reg(0x2, 0x0005);   // enable + loop
  idle(4000);               // > 4 frames
  expect("loop keeps the level", read_reg(0x0) >= 1 && read_reg(0x0) <= 4, 1);
  expect("loop: no underrun", (read_reg(0x4) >> 3) & 1, 0);

  // Low-water IRQ: the fixed threshold is 32.  At 32 samples it is low; one
  // more sample lifts it back above the mark.
  write_reg(0x2, 0x0002);
  for (int i = 0; i < 32; i++) write_reg(0x0, (uint16_t)(0x1000 + i));
  write_reg(0x2, 0x0009);   // enable + irq
  expect("irq at 32 samples", top->fifo_irq, 1);
  write_reg(0x0, 0xEEEE);   // 33 samples
  expect("irq above the mark", top->fifo_irq, 0);

  write_reg(0x2, 0x0000);
  delete top;
  std::printf("%s\n", fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
