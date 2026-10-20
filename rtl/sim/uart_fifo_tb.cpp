// uart_fifo_tb: overflow must drop bytes without counting them.
#include <cstdio>
#include "Vuart_fifo_tb.h"
#include "verilated.h"

static Vuart_fifo_tb* top;
static int fails = 0;

static void tick() { top->clk = 0; top->eval(); top->clk = 1; top->eval(); }

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vuart_fifo_tb;
  top->clk = 0; top->rst = 1; top->push = 0; top->take = 0; top->push_data = 0;
  for (int i = 0; i < 4; i++) tick();
  top->rst = 0;
  for (int i = 0; i < 4; i++) tick();

  // 200 bytes into the 64-deep FIFO, one per cycle.
  for (int i = 0; i < 200; i++) {
    top->push = 1; top->push_data = (uint16_t)(i & 0xFF);
    tick();
    top->push = 0;
    tick();
  }

  unsigned count = top->count & 0xFFFF;
  std::printf("after 200 pushes: count = %u (want 64), overrun = %u\n",
              count, (top->status >> 2) & 1);
  if (count != 64) { std::printf("FAIL count\n"); fails++; }
  if (((top->status >> 2) & 1) != 1) { std::printf("FAIL overrun flag\n"); fails++; }

  // Drain: the first 64 bytes must be 0..63, in order.
  int got = 0;
  for (;;) {
    bool ready = (top->status & 1) != 0;
    if (!ready) break;
    unsigned b = top->data & 0xFF;
    if (b != (unsigned)(got & 0xFF)) {
      std::printf("FAIL byte %d: got %u\n", got, b); fails++; break;
    }
    top->take = 1; tick(); top->take = 0; tick();
    got++;
    if (got > 300) break;              // a desynced count would never empty
  }
  std::printf("drained %d bytes (want 64), count now %u\n", got, top->count & 0xFFFF);
  if (got != 64) { std::printf("FAIL drain\n"); fails++; }
  if ((top->count & 0xFFFF) != 0) { std::printf("FAIL count not empty\n"); fails++; }

  top->final();
  delete top;
  std::printf("%s\n", fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
