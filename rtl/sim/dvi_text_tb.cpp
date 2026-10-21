// dvi_text_tb.cpp - drive the DVI console's UART and check what it renders.
//
// Sends a short ANSI session at 115200 (219 pixel clocks per bit), checks the
// packed cell words the parser wrote, then samples the active video to compare
// the 8x15 glyph of 'H' with the font ROM and a blank row with black. Finally
// verifies one frame's sync geometry: 525 lines, 800 clocks per line and
// 640x480 display-enable pixels.
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "Vdvi_text_tb.h"
#include "verilated.h"

static Vdvi_text_tb* top;
static int fails = 0;

static void check(const char* what, long got, long exp) {
  if (got != exp) {
    std::printf("FAIL %s: got %ld expected %ld\n", what, got, exp);
    fails++;
  } else {
    std::printf("ok   %s = %ld\n", what, got);
  }
}

static void tick() {
  top->clk = 0; top->eval();
  top->clk = 1; top->eval();
}

static const double BIT = 219.0;   // 25.2 MHz / 115200

static void send_byte(uint8_t b) {
  top->uart_rx = 0;                                  // start
  for (int i = 0; i < (int)BIT; i++) tick();
  for (int bit = 0; bit < 8; bit++) {
    top->uart_rx = (b >> bit) & 1;
    for (int i = 0; i < (int)BIT; i++) tick();
  }
  top->uart_rx = 1;                                  // stop
  for (int i = 0; i < (int)BIT; i++) tick();
}

static void send(const char* s) { while (*s) send_byte((uint8_t)*s++); }

static std::vector<uint16_t> read_font() {
  FILE* f = std::fopen("font8x15.hex", "r");
  if (!f) { std::printf("FAIL cannot open font8x15.hex (run from artifacts/image)\n"); std::exit(1); }
  std::vector<uint16_t> w;
  char line[64];
  while (std::fgets(line, sizeof(line), f)) {
    char* p = line;
    while (*p == ' ' || *p == '\t') p++;
    if (*p == '/' || *p == '\n' || *p == '\0') continue;
    w.push_back((uint16_t)std::strtoul(p, nullptr, 16));
  }
  std::fclose(f);
  return w;
}

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vdvi_text_tb;

  top->clk = 0; top->rst = 1; top->uart_rx = 1;
  for (int i = 0; i < 20; i++) tick();
  top->rst = 0;
  for (int i = 0; i < 20; i++) tick();

  // A tiny session: clear the screen, print "Hi", newline, "A", then position
  // the cursor at row 5, column 10 and print "X".
  send("\x1b[H\x1b[2J\x1b[3J");
  send("Hi\r\nA");
  send("\x1b[5;10HX");

  // The parser writes bytes into the packed cell words the next cycle.
  bool cells_ok = false;
  for (long i = 0; i < 3000000 && !cells_ok; i++) {
    tick();
    cells_ok = (top->dbg_cell0 == ((uint16_t)('i') << 8 | 'H')) &&
               ((top->dbg_cell40 & 0xFF) == 'A') &&
               (((top->dbg_cell164 >> 8) & 0xFF) == 'X');
  }
  check("cells after the session", cells_ok ? 1 : 0, 1);
  std::printf("     cell0=%04x cell40=%04x cell164=%04x\n",
              top->dbg_cell0, top->dbg_cell40, top->dbg_cell164);

  // Capture the glyph at row 0, column 0 (H) and a known blank row (2).
  auto font = read_font();
  const int base = (0x48 - 0x20) * 8;       // 'H'
  bool cap_h[15][8] = {}, seen_h[15][8] = {};
  bool cap_blank = false, seen_blank = true;

  for (long i = 0; i < 2500000; i++) {
    tick();
    const int y = top->dbg_y, x = top->dbg_x;
    if (y >= 60 && y < 75 && x < 8) {
      cap_h[y - 60][x] = top->red != 0;
      seen_h[y - 60][x] = true;
    }
    if (y >= 90 && y < 105 && x < 8) {
      if (top->red != 0) cap_blank = true;
    }
  }

  bool h_ok = true;
  for (int r = 0; r < 15; r++) {
    uint8_t row = (r & 1) ? (font[base + (r >> 1)] >> 8) & 0xFF
                          :  font[base + (r >> 1)] & 0xFF;
    for (int c = 0; c < 8; c++) {
      if (!seen_h[r][c]) h_ok = false;
      const bool exp = ((row >> (7 - c)) & 1) != 0;
      if (cap_h[r][c] != exp) {
        std::printf("FAIL H pixel r%d c%d: got %d expected %d\n",
                    r, c, (int)cap_h[r][c], (int)exp);
        h_ok = false;
      }
    }
  }
  check("glyph H matches the font ROM", h_ok ? 1 : 0, 1);
  check("blank row is black", cap_blank ? 0 : 1, 1);

  // Frame geometry between two vsync falling edges.
  int prev_vs = top->vsync, prev_hs = top->hsync;
  bool in_frame = false;
  long lines = 0, de_pixels = 0, cycles = 0;
  for (long i = 0; i < 1000000; i++) {
    tick();
    const int vs = top->vsync, hs = top->hsync;
    if (prev_vs && !vs) {
      if (!in_frame) { in_frame = true; lines = 0; de_pixels = 0; cycles = 0; }
      else break;
    }
    if (in_frame) {
      cycles++;
      if (!prev_hs && hs) lines++;
      if (top->de) de_pixels++;
    }
    prev_vs = vs; prev_hs = hs;
  }
  check("lines per frame", lines, 525);
  check("pixels per frame with de", de_pixels, 640L * 480L);
  check("clock cycles per frame", cycles, 800L * 525L);

  // Cell read helper: logical row + the current circular row offset.
  auto cell = [&](int logical_row, int col) -> uint16_t {
    const int off = top->dbg_row_off;
    top->dbg_addr = ((logical_row + off) % 24) * 40 + (col >> 1);
    top->eval();
    return (col & 1) ? ((top->dbg_cell >> 8) & 0xFF) : (top->dbg_cell & 0xFF);
  };

  // Hard wrap: 80 columns hold at the last column, then CR+LF moves to the
  // next row. The " ok" must not land on the 80-column row.
  send("\x1b[H\x1b[2J");
  for (int i = 0; i < 6000; i++) tick();
  for (int i = 0; i < 80; i++) send_byte('Z');
  send("\r\n ok\r\n> ");
  for (int i = 0; i < 6000; i++) tick();
  check("hard wrap: first column", cell(0, 0), 'Z');
  check("hard wrap: 80th column", cell(0, 79), 'Z');
  check("ok row starts with a space", cell(1, 0), ' ');
  check("o on the row after 80 columns", cell(1, 1), 'o');
  check("k on the row after 80 columns", cell(1, 2), 'k');
  check("prompt below ok", cell(2, 0), '>');

  // Scroll regression: a long stream must scroll immediately (row offset plus
  // a one-row clear), and the REPL's " ok" must stay on its own row instead of
  // being overwritten by the next prompt. This is the board bug that lost the
  // 'o' and moved "> " onto the last words line.
  send("\x1b[H\x1b[2J");
  for (int i = 0; i < 6000; i++) tick();          // let the clear finish
  for (int line = 0; line < 28; line++) send("0123456789\r\n");
  send(" ok\r\n> ");
  for (int i = 0; i < 6000; i++) tick();          // row clear + prompt

  check("scroll advanced the row offset", top->dbg_row_off, 6);
  check("space before ok", cell(22, 0), ' ');
  check("o in ok", cell(22, 1), 'o');
  check("k in ok", cell(22, 2), 'k');
  check("prompt first char", cell(23, 0), '>');
  check("prompt second char", cell(23, 1), ' ');

  top->final();
  delete top;
  std::printf(fails ? "FAILED (%d)\n" : "PASS\n", fails);
  return fails ? 1 : 0;
}
