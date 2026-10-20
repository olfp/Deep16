// Verilator test for deep16_psram_bridge + the behavioural PSRAM IP model.
//
// Two asynchronous clocks: clk_ip ~74.25 MHz (13 ns), clk_cpu ~13.5 MHz (74 ns).
// The CPU side issues one request at a time and checks every read-back.
#include <cstdio>
#include <cstdint>
#include "Vpsram_bridge_tb.h"
#include "verilated.h"

static Vpsram_bridge_tb* top;
static long t_ns = 0;

static void tick() {
  t_ns++;
  top->clk_ip  = ((t_ns % 13) < 6);
  top->clk_cpu = ((t_ns % 74) < 37);
  top->eval();
}

static void wait_cpu_rise() {
  bool last = top->clk_cpu;
  for (int guard = 0; guard < 100000; guard++) {
    tick();
    if (!last && top->clk_cpu) return;
    last = top->clk_cpu;
  }
}

static int fails = 0;

// One CPU transaction. Returns the read data (0 for writes).
static uint16_t xfer(bool we, uint16_t addr, uint16_t wdata) {
  // present the request on the cycle before the rising edge
  top->req = 1; top->we = we; top->addr = addr; top->wdata = wdata;
  wait_cpu_rise();          // latched here
  top->req = 0;
  // wait for the completion pulse
  uint16_t r = 0;
  for (int guard = 0; guard < 10000; guard++) {
    wait_cpu_rise();
    if (top->ready) { r = top->rdata; break; }
  }
  top->eval();
  return r;
}

static void check(const char* what, uint16_t got, uint16_t exp) {
  if (got != exp) {
    std::printf("FAIL %s: got 0x%04x expected 0x%04x\n", what, got, exp);
    fails++;
  } else {
    std::printf("ok   %s = 0x%04x\n", what, got);
  }
}

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vpsram_bridge_tb;

  top->clk_ip = 0; top->clk_cpu = 0; top->rst_ip = 1; top->rst_cpu = 1;
  top->req = 0; top->we = 0; top->addr = 0; top->wdata = 0;
  for (int i = 0; i < 200; i++) tick();

  // release reset in the CPU domain first, then the IP domain
  top->rst_cpu = 0;
  for (int i = 0; i < 200; i++) tick();
  top->rst_ip = 0;
  for (int i = 0; i < 200; i++) tick();

  // write/read a word; the first access also fetches the line
  (void)xfer(true, 5, 0x1234);                 // writes: rdata is don't-care
  check("read  0x1234 @5", xfer(false, 5, 0), 0x1234);

  // same 32-byte block: served from the line
  check("read  block hit @6", xfer(false, 6, 0), 0x0000);
  (void)xfer(true, 6, 0xabcd);
  check("read  0xabcd @6", xfer(false, 6, 0), 0xabcd);

  // a different block: full fetch
  (void)xfer(true, 20, 0x5555);
  check("read  0x5555 @20", xfer(false, 20, 0), 0x5555);

  // and back to the first block: the line was evicted, fetch again
  check("read  0x1234 @5 again", xfer(false, 5, 0), 0x1234);

  // a burst of writes/reads across blocks
  uint16_t exp[8];
  for (int i = 0; i < 8; i++) {
    exp[i] = (uint16_t)(0x1000 + i * 0x111);
    xfer(true, 100 + i * 3, exp[i]);
  }
  for (int i = 0; i < 8; i++) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "burst @%d", 100 + i * 3);
    check(buf, xfer(false, 100 + i * 3, 0), exp[i]);
  }

  delete top;
  std::printf(fails ? "FAILED (%d)\n" : "PASS\n", fails);
  return fails ? 1 : 0;
}
