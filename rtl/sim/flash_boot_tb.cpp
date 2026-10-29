// flash_boot_tb.cpp - run the full config-flash loader and check the copies.
#include <cstdio>
#include <cstdint>
#include "Vflash_boot_tb.h"
#include "verilated.h"

namespace {
Vflash_boot_tb* top;
int fails = 0;

void tick() {
  top->clk = 0; top->eval();
  top->clk = 1; top->eval();
}

void expect(const char* what, uint16_t got, uint16_t want) {
  if (got != want) {
    std::printf("FAIL %-32s got 0x%04x, want 0x%04x\n", what, got, want);
    fails++;
  } else {
    std::printf("ok   %-32s = 0x%04x\n", what, got);
  }
}
}  // namespace

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vflash_boot_tb;
  top->clk = 0; top->rst = 1; top->start = 0;
  for (int i = 0; i < 8; i++) tick();
  top->rst = 0;
  tick();

  top->start = 1; tick(); top->start = 0;
  int cycles = 0;
  while (!top->done && !top->err && cycles < 6000000) { tick(); cycles++; }

  expect("loader finished without error", top->err, 0);
  expect("loader done", top->done, 1);
  expect("entry word 0x0100", top->entry_exp, top->exp_0100);
  expect("flat word 0x0000", top->got_0000, top->exp_0000);
  expect("flat word 0x0100", top->got_0100, top->exp_0100);
  expect("flat word 0x3000", top->got_3000, top->exp_3000);
  expect("DS copy of 0x3000", top->got_ds3000, top->exp_3000);
  expect("BIOS copy of 0x4A00", top->got_bios4a00, top->exp_bios4a00);
  std::printf("cycles: %d\n", cycles);

  delete top;
  std::printf("%s\n", fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
