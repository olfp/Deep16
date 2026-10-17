// board_tb.cpp - run the D16MINI board build on Verilator and read the console.
//
// This is the bring-up path minus Gowin: the 26-block window, the boot image
// loaded by $readmemh, the window decode (RAM / boot ROM / echo register / fill),
// the reset synchroniser and the free-run tie-offs, and the UART *pins*. It runs
// the board with uart_rxd idle, decodes uart_txd at the UART's own bit time, and
// checks that the kernel's greeting comes out.
//
// It found a real bug the step-based tests could not: the EX-side strobes
// (uart_tx_we) were gated on step_done, which in free-run is high almost every
// cycle - the console was mute on the board while every other test stayed green.
//
// Built and run by scripts/build_board_sim.sh; the image must be in the working
// directory ($readmemh resolves at run time), which the script arranges.
#include <cstdio>
#include <string>
#include "Vdeep16_board.h"
#include "Vdeep16_board_deep16_board.h"
#include "Vdeep16_board_deep16_top.h"
#include "verilated.h"

namespace {

// A minimal 8N1 receiver for the pin: wait for the start edge, sample the eight
// data bits at their centres, take the stop bit. Bit time is the UART's DIV.
struct UartRx {
  static constexpr int CLK_PER_BIT = 234;   // 27 MHz / 115200
  enum { IDLE, START, DATA, STOP } state = IDLE;
  int cnt = 0, bit = 0, data = 0;
  std::string out;

  void tick(int txd) {
    switch (state) {
      case IDLE:  if (txd == 0) { state = START; cnt = 0; } break;
      case START: if (++cnt >= CLK_PER_BIT / 2) { state = DATA; cnt = 0; bit = 0; data = 0; } break;
      case DATA:
        if (++cnt >= CLK_PER_BIT) {
          cnt = 0;
          data |= txd << bit;
          if (++bit == 8) state = STOP;
        }
        break;
      case STOP:
        if (++cnt >= CLK_PER_BIT) { state = IDLE; cnt = 0; out.push_back(static_cast<char>(data)); }
        break;
    }
  }
};

}  // namespace

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  auto* top = new Vdeep16_board;

  // Power-up: the button is held, the line is idle high.
  top->clk = 0; top->rst_n = 0; top->uart_rxd = 1;
  for (int i = 0; i < 32; i++) { top->clk = 0; top->eval(); top->clk = 1; top->eval(); }
  top->rst_n = 1;

  const char* want = (argc > 1) ? argv[1] : "Hello DeepForth!";
  UartRx rx;
  long clocks = 0;
  // 20 M clocks at 27 MHz is ~0.74 s of board time; the greeting needs ~47 k.
  const long LIMIT = 20'000'000;
  for (; clocks < LIMIT; clocks++) {
    top->clk = 0; top->eval();
    int txd = top->uart_txd;
    top->clk = 1; top->eval();
    rx.tick(txd);
    if (rx.out.find(want) != std::string::npos) break;
  }

  std::printf("--- UART output (%zu bytes after %ld clocks) ---\n%s\n",
              rx.out.size(), clocks, rx.out.c_str());
  bool ok = rx.out.find(want) != std::string::npos;
  if (!ok) {
    // The first place to look when nothing came out: did the machine run at all,
    // and where is it? (The board exposes no debug bus on purpose.)
    auto* t = top->deep16_board->u_top;
    std::printf("state: run=%d halt=%d cs=0x%04x pc=0x%04x tx_count=%u mem[0x100]=0x%04x\n",
                (int)t->__PVT__u_core__DOT__run,
                (int)t->__PVT__u_core__DOT__halt_sticky,
                (unsigned)t->__PVT__u_core__DOT__if_cs,
                (unsigned)t->__PVT__u_core__DOT__if_pc,
                (unsigned)t->__PVT__u_uart__DOT__tx_count,
                (unsigned)t->mem[0x100]);
  }
  std::printf("%s: expected %s\n", ok ? "PASS" : "FAIL", want);
  delete top;
  return ok ? 0 : 1;
}
