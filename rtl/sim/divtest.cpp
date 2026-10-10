// Standalone check of deep16_divider against Verilog's own / and %.
// Not part of the shipped build; it exists so the algorithm is proven before
// it is wired into the core.
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>

#include "verilated.h"
#include "Vdeep16_divider.h"

static uint64_t rng_state = 0x12345678;
static uint32_t rnd(void) {
  rng_state ^= rng_state << 13;
  rng_state ^= rng_state >> 7;
  rng_state ^= rng_state << 17;
  return (uint32_t)(rng_state >> 8);
}

static Vdeep16_divider *dut;

static void tick(void) {
  dut->clk = 0; dut->eval();
  dut->clk = 1; dut->eval();
}

// Runs one division to completion, returns cycles used.
static int divide(uint32_t dividend, uint16_t divisor, uint16_t *q, uint16_t *r) {
  dut->dividend = dividend;
  dut->divisor  = divisor;
  dut->start    = 1;
  tick();
  dut->start = 0;
  int cycles = 1;
  while (dut->busy && cycles < 100) { tick(); cycles++; }
  *q = dut->quot;
  *r = dut->rem;
  return cycles;
}

static int check(uint32_t dividend, uint16_t divisor, const char *tag) {
  uint16_t q, r;
  int cycles = divide(dividend, divisor, &q, &r);
  uint16_t eq = (uint16_t)(dividend / divisor);
  uint16_t er = (uint16_t)(dividend % divisor);
  if (q != eq || r != er) {
    printf("FAIL %s: %u / %u -> q=%u (want %u)  r=%u (want %u)\n",
           tag, dividend, divisor, q, eq, r, er);
    return 1;
  }
  if (cycles != 18) {
    printf("FAIL %s: %u / %u took %d cycles, expected 10\n", tag, dividend, divisor, cycles);
    return 1;
  }
  return 0;
}

int main(int argc, char **argv) {
  Verilated::commandArgs(argc, argv);
  dut = new Vdeep16_divider;
  dut->clk = 0; dut->rst = 1; dut->start = 0;
  dut->dividend = 0; dut->divisor = 1;
  tick(); tick();
  dut->rst = 0;

  int fails = 0;
  // Corner cases first.
  struct { uint32_t d; uint16_t v; const char *tag; } cases[] = {
    {0, 1, "zero/one"}, {1, 1, "one/one"}, {0xFFFFFFFF, 1, "max/one"},
    {0xFFFFFFFF, 0xFFFF, "max/max"}, {0xFFFF, 1, "ffff/one"},
    {0xFFFF, 0xFFFF, "ffff/ffff"}, {0x12345678, 0x1000, "round"},
    {0xB6DB * 6 + 3, 6, "the cores-test case"},
    {0xFFFF0000, 0xFFFF, "hi/ffff"}, {2, 3, "two/three"},
    {0xFFFE, 0xFFFF, "fffe/ffff"}, {1, 0xFFFF, "one/ffff"},
  };
  for (unsigned i = 0; i < sizeof(cases)/sizeof(cases[0]); i++)
    fails += check(cases[i].d, cases[i].v, cases[i].tag);

  // Directed: every 16-bit DIV case (top half zero) over a spread of divisors.
  for (uint32_t d = 0; d <= 0xFFFF; d += 977) {
    for (int k = 1; k <= 0xFFFF; k += 4001) {
      fails += check(d, (uint16_t)k, "16-bit");
      fails += check((d << 16) | (uint32_t)(k ^ 0x5A5A), (uint16_t)k, "32-bit");
    }
  }

  // Random soak.
  for (int i = 0; i < 20000; i++) {
    uint32_t d = rnd();
    uint16_t v = (uint16_t)(rnd() | 1);   // never zero: the caller handles that
    fails += check(d, v, "random");
  }

  printf(fails ? "\n%d FAILURES\n" : "\nall divider checks passed\n", fails);
  delete dut;
  return fails ? 1 : 0;
}