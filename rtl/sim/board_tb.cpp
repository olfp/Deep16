// board_tb.cpp - run the D16MINI board build on Verilator and talk to it.
//
// This is the bring-up path minus Gowin: the 26-block window, the boot image
// loaded by $readmemh, the window decode, the reset synchroniser and the
// free-run tie-offs - and the UART *pins* both ways. It runs the board with
// uart_rxd idle, decodes uart_txd at the UART's own bit time, waits for the
// banner and the prompt, then *types a line into the receive pin* and checks
// that it is echoed and evaluated.
//
// Both halves matter. The transmit pin is the console; the receive pin is the
// only part of the UART that exists nowhere else (every other test feeds RX
// through the host push), so this is the one place its start-bit detect, 16x
// oversampler and centre sampling are exercised. Typing `3 4 + .` also runs the
// interpreter, the echo path and the divider in free-run - the mode the board
// uses, where a single-step test cannot see them.
//
// It has found real bugs the step-based tests could not: the EX-side strobes
// (uart_tx_we) were gated on step_done, which in free-run is high almost every
// cycle, so the console was mute on the board while every other test stayed
// green.
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

// Bit time of the console in 27 MHz pin clocks. The board divides the
// oscillator by four and the UART's divisor is 59 CPU clocks (6.75 MHz / 115200
// rounds to 59), so one bit is 59 * 4 = 236 clocks of this testbench.
constexpr int CLK_PER_BIT = 236;

// A minimal 8N1 receiver for the TX pin: wait for the start edge, sample the
// eight data bits at their centres, take the stop bit.
struct UartRx {
  enum { IDLE, START, DATA, STOP } state = IDLE;
  int cnt = 0, bit = 0, data = 0;
  bool armed = false;   // the line has been high at least once since time 0
  std::string out;

  void tick(int txd) {
    switch (state) {
      // At time 0 the TX pin is still 0 - the UART's reset value has not been
      // clocked out yet - and taking that for a start bit mis-frames the first
      // burst. Wait until the line has been high once.
      case IDLE:
        if (txd == 1) armed = true;
        else if (armed) { state = START; cnt = 0; }
        break;
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

// A matching 8N1 transmitter for the RX pin: idle high, then start bit, eight
// data bits LSB first, stop bit - one bit per CLK_PER_BIT clocks.
struct UartTx {
  std::string pending;
  uint16_t frame = 0;          // 10 bits: bit0 start (0), bits 1-8 data, bit9 stop
  int bit = 0, cnt = 0;
  bool sending = false;

  void send(const std::string& s) { pending += s; }
  int level() const { return sending ? ((frame >> bit) & 1) : 1; }

  void tick() {
    if (!sending) {
      if (pending.empty()) return;
      const uint8_t b = static_cast<uint8_t>(pending[0]);
      pending.erase(0, 1);
      frame = static_cast<uint16_t>((1u << 9) | (b << 1));   // stop high, start low
      bit = 0; cnt = 0; sending = true;
      return;
    }
    if (++cnt >= CLK_PER_BIT) {
      cnt = 0;
      if (++bit >= 10) { sending = false; bit = 0; }
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

  const char* banner = (argc > 1) ? argv[1] : "Hello DeepForth!";
  const char* prompt = "\r\n> ";        // the REPL is ready when this comes out
  const char* line   = "3 4 + .";       // what we type into the receive pin
  const char* echo   = "3 4 + . 7  ok"; // what must come back: echo + evaluation

  UartRx rx;
  UartTx tx;
  bool typed = false;
  long clocks = 0;
  // 40 M clocks at 27 MHz is ~1.5 s of board time; the whole exchange needs
  // well under 100 k.
  const long LIMIT = 40'000'000;
  for (; clocks < LIMIT; clocks++) {
    top->uart_rxd = tx.level();
    top->clk = 0; top->eval();
    const int txd = top->uart_txd;
    top->clk = 1; top->eval();
    rx.tick(txd);
    tx.tick();
    if (!typed && rx.out.find(prompt) != std::string::npos) {
      tx.send(std::string(line) + "\r");   // CR ends the line, as a terminal sends it
      typed = true;
    }
    if (typed && rx.out.find(echo) != std::string::npos) break;
  }

  std::printf("--- UART output (%zu bytes after %ld clocks) ---\n%s\n",
              rx.out.size(), clocks, rx.out.c_str());
  const bool gotBanner = rx.out.find(banner) != std::string::npos;
  const bool gotEcho   = rx.out.find(echo) != std::string::npos;
  if (!(gotBanner && gotEcho)) {
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
  std::printf("%s: banner %s, typed line %s\n", (gotBanner && gotEcho) ? "PASS" : "FAIL",
              gotBanner ? "ok" : "MISSING", gotEcho ? "ok" : "MISSING");
  delete top;
  return (gotBanner && gotEcho) ? 0 : 1;
}
