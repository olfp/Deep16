// Boot the real Deep16 PSRAM machine in Verilator against psram_word_model.
//
// Watches the console pins, boot_done/boot_err, the core's halt flag, its
// retired-instruction count, and the fetch address presented when it halts.
#include <cstdio>
#include <cstdint>
#include <cstdlib>
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

// ---- UART transmitter into the console (115200, 13.5 MHz) ----------------
static char tx_queue[256];
static int  tx_qlen = 0, tx_idx = 0;
static int  tx_state = 0, tx_cnt = 0, tx_bit = 0;
static unsigned tx_byte = 0;

static void uart_send(const char* s) { while (*s) tx_queue[tx_qlen++] = *s++; }

static void uart_tx_tick() {
  if (tx_state == 0) {
    if (tx_idx >= tx_qlen) { top->uart_rx_in = 1; return; }
    tx_byte = (unsigned char)tx_queue[tx_idx];
    tx_state = 1; tx_cnt = 0; tx_bit = 0;
  }
  tx_cnt++;
  if (tx_state == 1) {            // start bit
    top->uart_rx_in = 0;
    if (tx_cnt >= BIT) { tx_state = 2; tx_cnt = 0; }
  } else if (tx_state == 2) {     // data bits
    top->uart_rx_in = (tx_byte >> tx_bit) & 1;
    if (tx_cnt >= BIT) { tx_cnt = 0; tx_bit++; if (tx_bit == 8) tx_state = 3; }
  } else if (tx_state == 3) {     // stop bit
    top->uart_rx_in = 1;
    if (tx_cnt >= BIT) { tx_state = 0; tx_cnt = 0; tx_idx++; }
  }
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
    static int phase = 0;
    if (done_seen && phase == 0 && t_ns > 20000000LL) { uart_send("mem\r"); phase = 1; }
    else if (phase == 1 && tx_idx >= tx_qlen && t_ns > 60000000LL) {
      uart_send("free d.\r"); phase = 2;
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
  for (unsigned a : {0x00000u, 0x00002u, 0x00010u, 0x00012u, 0x00100u, 0x00101u,
                     0x037c1u, 0x037c2u, 0x04a06u, 0x05600u, 0x06000u, 0x06707u, 0x0ffffu}) {
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
