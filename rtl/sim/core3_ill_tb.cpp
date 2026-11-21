// core3_ill_tb.cpp - run the core3 undefined-opcode trap program to completion.
#include <cstdio>
#include "Vcore3_ill_tb.h"
#include "verilated.h"

namespace {
Vcore3_ill_tb* top;
int fails = 0;

void tick() {
  top->clk = 0; top->eval();
  top->clk = 1; top->eval();
}

void expect(const char* what, long got, long want) {
  if (got != want) {
    std::printf("FAIL %-40s got 0x%lx, want 0x%lx\n", what, got, want);
    fails++;
  } else {
    std::printf("ok   %-40s = 0x%lx\n", what, got);
  }
}
}  // namespace

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vcore3_ill_tb;
  top->clk = 0; top->rst = 1;
  for (int i = 0; i < 8; i++) tick();
  top->rst = 0;

  int cycles = 0;
  for (; cycles < 5000 && !top->o_halt; cycles++) tick();

  expect("the core reached the halt", top->o_halt, 1);
  expect("the word after NIO ran", top->dbg_0300, 9);
  expect("both traps entered the handler", top->dbg_0301, 2);
  if (cycles >= 5000) std::printf("FAIL cycle cap reached\n");

  delete top;
  std::printf("%s\n", fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
