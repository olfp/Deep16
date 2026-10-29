// boot_spi_tb.cpp - read four known words from the model config flash.
#include <cstdio>
#include <cstdint>
#include "Vboot_spi_tb.h"
#include "verilated.h"

namespace {
Vboot_spi_tb* top;
int fails = 0;

void tick() {
  top->clk = 0; top->eval();
  top->clk = 1; top->eval();
}

uint32_t read_word(uint16_t addr) {
  top->addr = addr & 0x7FFF;
  top->start = 1; tick();
  top->start = 0;
  for (int i = 0; i < 2000 && !top->done; i++) tick();
  if (!top->done) {
    std::printf("FAIL timeout at word %u\n", addr);
    fails++;
  }
  uint32_t value = top->rdata;
  tick();                       // let S_DONE return to S_IDLE
  return value;
}

void expect(const char* what, uint32_t got, uint32_t want) {
  if (got != want) {
    std::printf("FAIL %-28s got 0x%08x, want 0x%08x\n", what, got, want);
    fails++;
  } else {
    std::printf("ok   %-28s = 0x%08x\n", what, got);
  }
}
}  // namespace

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vboot_spi_tb;
  top->clk = 0; top->rst = 1; top->start = 0; top->addr = 0;
  for (int i = 0; i < 8; i++) tick();
  top->rst = 0;
  tick();

  expect("word 0", read_word(0), 0x04030201);
  expect("word 1", read_word(1), 0x08070605);
  expect("word 4", read_word(4), 0xDDCCBBAA);
  expect("word 1000", read_word(1000), 0x44332211);
  expect("erased word 2", read_word(2), 0xFFFFFFFF);
  // Back to word 0 after a jump: the address is latched per transfer.
  expect("word 0 again", read_word(0), 0x04030201);

  delete top;
  std::printf("%s\n", fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
