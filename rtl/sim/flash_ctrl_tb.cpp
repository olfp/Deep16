// Unit test for flash608k_ctrl against the model preloaded with the image.
#include <cstdio>
#include <cstdint>
#include "Vflash_ctrl_tb.h"
#include "verilated.h"

static Vflash_ctrl_tb* top;
static int fails = 0;

static void tick() {
  top->clk = 0; top->eval();
  top->clk = 1; top->eval();
}
static void check(const char* what, uint32_t got, uint32_t exp) {
  if (got != exp) { std::printf("FAIL %s: got %08x expected %08x\n", what, got, exp); fails++; }
  else std::printf("ok   %s = %08x\n", what, got);
}
static void command(bool rd, bool pr, bool er, uint32_t a, uint32_t d) {
  top->addr = a; top->wdata = d;
  top->read = rd; top->prog_req = pr; top->erase = er;
  tick();
  top->read = 0; top->prog_req = 0; top->erase = 0;
  for (int i = 0; i < 5000000 && !top->done; i++) tick();
}
static uint32_t read_word(uint32_t a) { command(true, false, false, a, 0); return top->rdata; }

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vflash_ctrl_tb;
  top->clk = 0; top->rst = 1;
  top->addr = 0; top->wdata = 0; top->read = 0; top->prog_req = 0; top->erase = 0;
  for (int i = 0; i < 10; i++) tick();
  top->rst = 0;

  check("header magic", read_word(0), 0x44313646);
  check("header format", read_word(1), 1);
  check("header words", read_word(2), 24576);
  check("image word 0", read_word(64), 0xFFFFFFFF);     // image[0]=image[1]=0xFFFF
  check("image last word", read_word(64 + 12287), 0xFFFFFFFF);

  command(false, true, false, 100, 0xDEADBEEF);
  check("programmed word", read_word(100), 0xDEADBEEF);

  command(false, false, true, 0, 0);                    // erase page 0
  check("erased header magic", read_word(0), 0xFFFFFFFF);
  check("erased programmed word", read_word(100), 0xFFFFFFFF);

  delete top;
  std::printf(fails ? "FAILED (%d)\n" : "PASS\n", fails);
  return fails ? 1 : 0;
}
