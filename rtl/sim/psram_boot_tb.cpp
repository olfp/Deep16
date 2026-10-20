// Boot the real Deep16 PSRAM machine in Verilator against psram_word_model.
//
// Watches the console pins, boot_done/boot_err, the core's halt flag, its
// retired-instruction count, and the fetch address presented when it halts.
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <string>
#include "Vpsram_boot_tb.h"
#include "verilated.h"

static Vpsram_boot_tb* top;
static long t_ns = 0;

static void tick() {
  t_ns++;
  top->clk_ip  = ((t_ns % 20) < 10);   // 51 MHz
  top->clk     = ((t_ns % 74) < 37);   // 13.5 MHz
  top->eval();
}

// ---- UART receiver on the CPU clock (115200, 13.5 MHz) -------------------
static const int BIT = 117;            // 13.5e6 / 115200
static int  urx_state = 0, urx_cnt = 0, urx_bit = 0;
static unsigned urx_data = 0;
static char console[4096];
static int  console_len = 0;

static void uart_sample() {
  if (console_len >= (int)sizeof(console) - 1) return;
  if (top->uart_txd == 0) {
    urx_state = 0;
    return;
  }
  console[console_len++] = (char)(urx_data & 0xFF);
  std::printf("%c", (char)(urx_data & 0xFF));
  std::fflush(stdout);
}

static void uart_tick() {
  urx_cnt++;
  switch (urx_state) {
    case 0:
      if (!top->uart_txd) { urx_state = 1; urx_cnt = 0; }
      break;
    case 1:                                  // start bit, verify mid-bit
      if (urx_cnt >= BIT / 2) {
        if (!top->uart_txd) { urx_state = 2; urx_cnt = 0; urx_bit = 0; urx_data = 0; }
        else urx_state = 0;
      }
      break;
    case 2:                                  // sample data bits
      if (urx_cnt >= BIT) {
        urx_cnt = 0;
        urx_data |= (unsigned)(top->uart_txd ? 1 : 0) << urx_bit;
        if (++urx_bit == 8) urx_state = 3;
      }
      break;
    case 3:                                  // stop bit
      if (urx_cnt >= BIT) { urx_cnt = 0; urx_state = 0; uart_sample(); }
      break;
  }
}

// ---- UART transmitter into the console -----------------------------------
// A real host's bit time is 13.5 MHz / 115200 = 117.1875 cycles, i.e. not a
// whole number: the receiver must tolerate the fractional drift. Driving the
// pin at exactly 117 cycles would hide any phase sensitivity, so the line is
// recomputed every CPU cycle from the absolute time of the start edge.
static char tx_queue[512];
static int  tx_qlen = 0, tx_idx = 0;
static double tx_t0 = -1.0;      // start edge of the byte being sent (cycles)
static double tx_now = 0.0;      // CPU cycles since reset
static const double TX_BIT = 117.1875;

static void uart_send(const char* s) { while (*s) tx_queue[tx_qlen++] = *s++; }

static void uart_tx_tick() {
  tx_now += 1.0;
  if (tx_t0 >= 0.0) {
    double k = (tx_now - tx_t0) / TX_BIT;
    if (k >= 10.0) {
      top->uart_rx_in = 1;
      tx_t0 = -1.0;
      tx_idx++;
    } else if (k < 1.0) {
      top->uart_rx_in = 0;                       // start bit
    } else if (k < 9.0) {
      top->uart_rx_in = (tx_queue[tx_idx] >> ((int)k - 1)) & 1;
    } else {
      top->uart_rx_in = 1;                       // stop bit
    }
  }
  if (tx_t0 < 0.0 && tx_idx < tx_qlen) tx_t0 = tx_now;   // next byte starts now
}

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vpsram_boot_tb;
  top->clk = 0; top->clk_ip = 0; top->rst = 1; top->uart_rx_in = 1;
  for (int i = 0; i < 400; i++) tick();
  top->rst = 0;
  for (int i = 0; i < 400; i++) tick();

  top->peek_addr = 0; top->dbg_en = 0;
  bool last_clk = false;
  bool done_seen = false, err_seen = false, halt_seen = false;
  long long total = 0;
  const char* limit_env = std::getenv("SIM_MS");
  const long long LIMIT = limit_env ? (long long)(atof(limit_env) * 1e6) : 400000000LL;
  const bool trace = std::getenv("TRACE") != nullptr;

  for (; total < LIMIT; total++) {
    tick();
    bool rise = (!last_clk && top->clk);
    last_clk = top->clk;
    if (rise) { uart_tick(); uart_tx_tick(); }
    // ---- script: type a line during boot, then press the reset button -----
    // The reset pulse is the interesting part: BSRAM (the cache tags and data)
    // is not cleared by rst, only by reconfiguration, so this is a button
    // reset. A second boot must come up exactly like the first.
    static int phase = 0;
    static long long reset_start = 0;
    static size_t mark2 = 0;
    static bool second_checked = false;
    if (done_seen && phase == 0 && t_ns > 300000000LL) {
      uart_send("the quick brown fox jumps over the lazy dog\r");
      phase = 1;
    } else if (phase == 1 && tx_idx >= tx_qlen && t_ns > 600000000LL) {
      phase = 2;
    } else if (phase == 2 && t_ns > 2200000000LL) {
      mark2 = console_len;
      top->rst = 1;
      reset_start = t_ns;
      phase = 3;
      std::printf("\n[button reset at %lld ms]\n", t_ns / 1000000);
    } else if (phase == 3 && t_ns > reset_start + 1000) {
      top->rst = 0;
      phase = 4;
    } else if (phase == 4 && !second_checked && t_ns > 5200000000LL) {
      second_checked = true;
      std::string second(console + mark2, (size_t)console_len - mark2);
      bool banner = second.find("Hello DeepForth!") != std::string::npos;
      bool summary = second.find("free") != std::string::npos;
      bool prompt = second.find("> ") != std::string::npos;
      std::printf("\n[second boot after reset: banner=%d summary=%d prompt=%d -> %s]\n",
                  (int)banner, (int)summary, (int)prompt,
                  (banner && summary && prompt) ? "OK" : "FAIL");
    }

    static int last_st = -1, last_op = -1, last_rdq = -1, last_hw = -1;
    if (top->dbg_en && rise && top->dbg_breq && top->dbg_bwe) {
      std::printf("WRITE addr=%05x\n", (unsigned)top->dbg_baddr);
    }
    if (top->dbg_en && rise) {
      if ((int)top->dbg_st != last_st || (int)top->dbg_op != last_op ||
          (int)top->dbg_rdq != last_rdq || (int)top->dbg_hw != last_hw) {
        std::printf("t=%9lld st=%x op=%05x rdq=%04x ipa=%05x hit=%d hold=%d "
                    "ifpc=%04x redir=%d late=%d memrd=%d ma=%05x mrd=%04x\n",
                    t_ns, (unsigned)top->dbg_st, (unsigned)top->dbg_op,
                    (unsigned)top->dbg_rdq, (unsigned)top->dbg_ipa,
                    (int)top->dbg_hit, (int)top->dbg_hold,
                    (unsigned)top->dbg_ifpc, (int)top->dbg_redir,
                    (int)top->dbg_memlate, (int)top->dbg_memrd,
                    (unsigned)top->dbg_memaddr, (unsigned)top->dbg_memrdat);
        last_st = top->dbg_st; last_op = top->dbg_op;
        last_rdq = top->dbg_rdq; last_hw = top->dbg_hw;
      }
    }

    if (!done_seen && top->boot_done) {
      done_seen = true; top->dbg_en = trace ? 1 : 0;
      std::printf("\n[boot_done at %lld ns, instrs=%u]\n", t_ns, top->instrs);
    }
    if (!err_seen && top->boot_err) {
      err_seen = true;
      std::printf("\n[BOOT_ERR: read-back mismatch at %lld ns]\n", t_ns);
    }
    if (!halt_seen && top->core_halt) {
      halt_seen = true;
      std::printf("\n[HALT at %lld ns: instrs=%u if_addr=0x%05x]\n",
                  t_ns, top->instrs, top->if_addr);
    }
    if (halt_seen && total > 20000000LL) break;
  }

  std::printf("\n---- psram contents (word : value) ----\n");
  for (unsigned a : {0x00000u, 0x00002u, 0x00100u, 0x03004u, 0x03005u, 0x03006u,
                     0x037b5u, 0x037c1u, 0x037c2u, 0x037c3u, 0x04a06u, 0x06000u, 0x0ffffu}) {
    top->peek_addr = a;
    top->eval();
    std::printf("  %05x : %04x\n", a, (unsigned)top->peek_data);
  }

  std::printf("\n---- summary ----\n");
  std::printf("boot_done=%d boot_err=%d halt=%d instrs=%u if_addr=0x%05x\n",
              (int)top->boot_done, (int)top->boot_err, (int)top->core_halt,
              top->instrs, top->if_addr);
  std::printf("console (%d bytes):\n%.*s\n", console_len, console_len, console);
  {
    static const unsigned char want[11] = {27, '[', 'H', 27, '[', '2', 'J', 27, '[', '3', 'J'};
    bool ok = console_len >= 11;
    for (int i = 0; ok && i < 11; i++) ok = (unsigned char)console[i] == want[i];
    std::printf("console starts with ESC[H ESC[2J ESC[3J: %s\n", ok ? "yes" : "NO");
  }

  unsigned long long reads = (unsigned long long)top->dbg_hits + top->dbg_misses;
  std::printf("cache: %u hits / %u misses (%.1f %% hit), %.2f cycles/instr "
              "(%u instrs in %lld ns at 13.5 MHz)\n",
              top->dbg_hits, top->dbg_misses,
              reads ? 100.0 * top->dbg_hits / reads : 0.0,
              top->instrs ? (double)t_ns / 74.0 / top->instrs : 0.0,
              top->instrs, t_ns);
  top->final();
  delete top;
  return 0;
}
