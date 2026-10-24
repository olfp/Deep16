// Simulate the one-time installer against a blank FLASH608K model.
#include <cstdio>
#include <cstdint>
#include "Vflash_installer_tb.h"
#include "verilated.h"

static Vflash_installer_tb* top;
static int fails = 0;
static void tick() { top->clk = 0; top->eval(); top->clk = 1; top->eval(); }
static void check(const char* what, long got, long exp) {
  if (got != exp) { std::printf("FAIL %s: got %ld expected %ld\n", what, got, exp); fails++; }
  else std::printf("ok   %s = %ld\n", what, got);
}

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vflash_installer_tb;
  top->clk = 0; top->rst_n = 0;
  for (int i = 0; i < 20; i++) tick();
  top->rst_n = 1;

  // 25 page erases at 120 ms + 12,352 programs = ~3.3 s at 27 MHz.
  bool pass = false, fail = false;
  for (long i = 0; i < 200000000 && !pass && !fail; i++) {
    tick();
    // LED 1 is active low on PASS, LED 2 on FAIL.
    if (((top->led >> 1) & 1) == 0) pass = true;
    if (((top->led >> 2) & 1) == 0) fail = true;
  }
  check("installer PASS", pass ? 1 : 0, 1);
  check("installer FAIL", fail ? 1 : 0, 0);
  check("flash word 0 magic", top->dbg_word0, 0x44313646);
  check("flash word 64 image", top->dbg_word64, 0xFFFFFFFF);
  std::printf(fails ? "FAILED (%d)\n" : "PASS\n", fails);
  delete top;
  return fails ? 1 : 0;
}
