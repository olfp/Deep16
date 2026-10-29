// core3_irq_tb.cpp - pulse IRQ while the store is in ID and check the handler.
#include <cstdio>
#include <cstdint>
#include "Vcore3_irq_tb.h"
#include "verilated.h"

namespace {
Vcore3_irq_tb* top;
int fails = 0;

void tick() {
  top->clk = 0; top->eval();
  top->clk = 1; top->eval();
}

void expect(const char* what, long got, long want) {
  if (got != want) {
    std::printf("FAIL %-36s got 0x%lx, want 0x%lx\n", what, got, want);
    fails++;
  } else {
    std::printf("ok   %-36s = 0x%lx\n", what, got);
  }
}
}  // namespace

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vcore3_irq_tb;
  top->clk = 0; top->rst = 1; top->irq = 0;
  for (int i = 0; i < 8; i++) tick();
  top->rst = 0;

  // Pulse IRQ once, while the store at 0x0104 is being fetched/decoded. The
  // pulse is held for two clocks so the ID stage sees it; no second pulse is
  // allowed after RETI re-fetches the same store.
  bool fired = false;
  int pulse = 0;
  int cycles = 0;
  for (; cycles < 5000 && !top->o_halt; cycles++) {
    if (!fired && top->if_addr == 0x000104) {
      pulse = 4;
      fired = true;
    }
    top->irq = pulse > 0 ? 1 : 0;
    if (pulse > 0) pulse--;
    tick();
  }

  expect("the core reached the halt", top->o_halt, 1);
  expect("the parked store still ran", top->dbg_0300, 0x1234);
  expect("the IRQ handler ran once", top->dbg_0301, 1);
  if (cycles >= 5000) std::printf("FAIL cycle cap reached\n");

  delete top;
  std::printf("%s\n", fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
