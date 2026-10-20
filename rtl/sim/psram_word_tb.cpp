// Verilator test for psram_word_bridge + the word model (13.5 / 51 MHz).
#include <cstdio>
#include <cstdint>
#include "Vpsram_word_tb.h"
#include "verilated.h"

static Vpsram_word_tb* top;
static long t_ns = 0;
static void tick() {
  t_ns++;
  top->clk_ctl = ((t_ns % 20) < 10);   // ~51 MHz
  top->clk_cpu = ((t_ns % 74) < 37);   // ~13.5 MHz
  top->eval();
}
static void wait_cpu_rise() {
  bool last = top->clk_cpu;
  for (int g = 0; g < 100000; g++) {
    tick();
    if (!last && top->clk_cpu) return;
    last = top->clk_cpu;
  }
}
static int fails = 0;
static uint16_t xfer(bool we, uint16_t addr, uint16_t wdata) {
  top->req = 1; top->we = we; top->addr = addr; top->wdata = wdata;
  wait_cpu_rise();
  top->req = 0;
  uint16_t r = 0;
  for (int g = 0; g < 10000; g++) {
    wait_cpu_rise();
    if (top->ready) { r = top->rdata; break; }
  }
  top->eval();
  return r;
}
static void check(const char* what, uint16_t got, uint16_t exp) {
  if (got != exp) { std::printf("FAIL %s: got 0x%04x expected 0x%04x\n", what, got, exp); fails++; }
  else std::printf("ok   %s = 0x%04x\n", what, got);
}
int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vpsram_word_tb;
  top->clk_cpu = 0; top->clk_ctl = 0; top->rst_cpu = 1; top->rst_ctl = 1;
  top->req = 0; top->we = 0; top->addr = 0; top->wdata = 0;
  for (int i = 0; i < 300; i++) tick();
  top->rst_cpu = 0;
  for (int i = 0; i < 300; i++) tick();
  top->rst_ctl = 0;
  for (int i = 0; i < 300; i++) tick();

  xfer(true, 5, 0x1234);
  check("read @5", xfer(false, 5, 0), 0x1234);
  xfer(true, 0, 0xA55A);
  check("read @0", xfer(false, 0, 0), 0xA55A);
  xfer(true, 1023, 0xCAFE);
  check("read @1023", xfer(false, 1023, 0), 0xCAFE);
  check("read @5 again", xfer(false, 5, 0), 0x1234);
  uint16_t exp[8];
  for (int i = 0; i < 8; i++) { exp[i] = (uint16_t)(0x1000 + i * 0x111); xfer(true, 200 + i * 7, exp[i]); }
  for (int i = 0; i < 8; i++) {
    char b[32]; std::snprintf(b, sizeof(b), "burst @%d", 200 + i * 7);
    check(b, xfer(false, 200 + i * 7, 0), exp[i]);
  }
  delete top;
  std::printf(fails ? "FAILED (%d)\n" : "PASS\n", fails);
  return fails ? 1 : 0;
}
