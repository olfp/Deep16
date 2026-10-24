// dvi_tile_tb.cpp - drive the CPU tilemap port and check the rendered cells.
//
// There is no UART parser in dvi_tile any more: every tile and cursor/scroll
// change arrives through the CPU port. The test writes the H tile, samples the
// 8x15 cell from the line-buffer output, checks a blank row, verifies the
// 1280x720 @ 60 Hz frame geometry (1650 x 750 clocks), then writes an A into
// tilemap row 1 and scrolls the row offset by one to prove the hardware scroll
// path.
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <vector>
#include "Vdvi_tile_tb.h"
#include "verilated.h"

static Vdvi_tile_tb* top;
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

static void write_tile(int addr, uint16_t data) {
  top->cpu_we = 1; top->cpu_ctrl = 0; top->cpu_tgt = 0;
  top->cpu_addr = addr & 0xFFF; top->cpu_data = data;
  tick();
  top->cpu_we = 0;
  tick();
}

// Tile bank (1) and OAM/palette (3) share the same write shape as the tilemap.
static void write_win(int tgt, int addr, uint16_t data) {
  top->cpu_we = 1; top->cpu_ctrl = 0; top->cpu_tgt = tgt;
  top->cpu_addr = addr & 0xFFF; top->cpu_data = data;
  tick();
  top->cpu_we = 0;
  tick();
}

// Control register 0: {row[4:0], col[6:0], enable}; 2: row offset.
static void write_ctrl(int reg, uint16_t data) {
  top->cpu_we = 1; top->cpu_ctrl = 1;
  top->cpu_addr = reg & 0xFFF; top->cpu_data = data;
  tick();
  top->cpu_we = 0;
  tick();
}

static std::vector<uint16_t> read_hex(const char* name) {
  FILE* f = std::fopen(name, "r");
  if (!f) { std::printf("FAIL cannot open %s (run from artifacts/image)\n", name); std::exit(1); }
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

// Last RGB seen at one screen pixel over several frames.
static void sample_pixel(int px, int py, int* r, int* g, int* b, bool* seen) {
  for (int i = 0; i < 3000000; i++) {
    tick();
    if (top->de && top->dbg_x == 2 * px && top->dbg_y == 2 * py) {
      *r = top->red; *g = top->green; *b = top->blue; *seen = true;
    }
  }
}

static void sample_cell(int row, int col, bool cap[15][8], bool seen[15][8], bool* any_white) {
  for (int i = 0; i < 3000000; i++) {
    tick();
    const int y = top->dbg_y, x = top->dbg_x;
    if (!top->de) continue;
    const int y0 = row * 30;
    const int x0 = col * 16;
    if (y >= y0 && y < y0 + 30 && x >= x0 && x < x0 + 16 &&
        ((y - y0) & 1) == 0 && ((x - x0) & 1) == 0) {
      cap[(y - y0) / 2][(x - x0) / 2] = top->red != 0;
      seen[(y - y0) / 2][(x - x0) / 2] = true;
      if (top->red != 0) *any_white = true;
    }
  }
}

static bool compare_cell(const std::vector<uint16_t>& tile, int base,
                         bool cap[15][8], bool seen[15][8], const char* name) {
  bool ok = true;
  for (int r = 0; r < 15; r++) {
    const uint16_t w0 = tile[base + 2 * r];
    const uint16_t w1 = tile[base + 2 * r + 1];
    for (int c = 0; c < 8; c++) {
      const uint16_t w = (c < 4) ? w0 : w1;
      const int idx = (w >> (4 * (c & 3))) & 0xF;
      const bool exp = idx != 0;
      if (!seen[r][c]) ok = false;
      if (cap[r][c] != exp) {
        std::printf("FAIL %s pixel r%d c%d: got %d expected %d\n",
                    name, r, c, (int)cap[r][c], (int)exp);
        ok = false;
      }
    }
  }
  return ok;
}

int main(int argc, char** argv) {
  Verilated::commandArgs(argc, argv);
  top = new Vdvi_tile_tb;

  top->clk = 0; top->rst = 1;
  top->cpu_we = 0; top->cpu_ctrl = 0; top->cpu_tgt = 0; top->cpu_addr = 0; top->cpu_data = 0;
  top->dbg_addr = 0;
  for (int i = 0; i < 20; i++) tick();
  top->rst = 0;
  for (int i = 0; i < 20; i++) tick();

  // H tile at tilemap[0]; visible cursor at row 0 column 1 so it does not
  // overlap the sampled cell.
  const int h_base = (0x48 - 0x20) * 32;
  const int a_base = (0x41 - 0x20) * 32;
  write_tile(0, 0x0500);
  write_ctrl(0, (0 << 8) | (1 << 1) | 1);   // row 0, col 1, cursor on
  write_ctrl(2, 0);                         // row offset 0

  check("tilemap[0] holds the H tile address", top->dbg_cell0, 0x0500);

  auto tile = read_hex("tilefont.hex");
  bool cap_h[15][8] = {}, seen_h[15][8] = {};
  bool white = false;
  sample_cell(0, 0, cap_h, seen_h, &white);
  check("glyph H matches the 4bpp tile bank",
        compare_cell(tile, h_base, cap_h, seen_h, "H") ? 1 : 0, 1);
  check("H is not blank", white ? 1 : 0, 1);

  // A tile at map column 1 must render at screen x=8..15.
  write_tile(1, 0x0420);
  write_ctrl(0, 0);              // cursor off for the renderer check
  bool cap_c1[15][8] = {}, seen_c1[15][8] = {};
  bool white_c1 = false;
  sample_cell(0, 1, cap_c1, seen_c1, &white_c1);
  check("tilemap column 1 renders the A",
        compare_cell(tile, a_base, cap_c1, seen_c1, "A1") ? 1 : 0, 1);
  write_ctrl(0, (0 << 8) | (1 << 1) | 1);   // cursor back at col 1

  // A blank row below.
  bool cap_blank = false;
  for (int i = 0; i < 1500000; i++) {
    tick();
    const int y = top->dbg_y, x = top->dbg_x;
    if (top->de && y >= 30 && y < 60 && x < 16 && top->red != 0) cap_blank = true;
  }
  check("next text row is black", cap_blank ? 0 : 1, 1);

  // Frame geometry between two vsync falling edges.
  int prev_vs = top->vsync, prev_hs = top->hsync;
  bool in_frame = false;
  long lines = 0, de_pixels = 0, cycles = 0;
  for (long i = 0; i < 3000000; i++) {
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
  check("lines per frame", lines, 750);
  check("pixels per frame with de", de_pixels, 1280L * 720L);
  check("clock cycles per frame", cycles, 1650L * 750L);

  // Scroll: put A in tilemap row 1, then move the row offset by one. The A
  // must appear on visible row 0 and the H (tilemap row 0) on visible row 23.
  write_tile(82, 0x0420);
  write_ctrl(2, 1);
  bool cap_a[15][8] = {}, seen_a[15][8] = {};
  bool white_a = false;
  sample_cell(0, 0, cap_a, seen_a, &white_a);
  check("A after one-row scroll",
        compare_cell(tile, a_base, cap_a, seen_a, "A") ? 1 : 0, 1);
  check("scrolled row is not blank", white_a ? 1 : 0, 1);
  check("row offset is one", top->dbg_row_off, 1);

  bool cap_h23[15][8] = {}, seen_h23[15][8] = {};
  bool white_h23 = false;
  sample_cell(23, 0, cap_h23, seen_h23, &white_h23);
  check("H wrapped to the bottom visible row",
        compare_cell(tile, h_base, cap_h23, seen_h23, "H23") ? 1 : 0, 1);

  // ---- writable tile bank and palette (the demo's windows) ---------------
  write_ctrl(2, 0);                        // row offset back to 0
  write_ctrl(0, 0);                        // cursor off
  // Palette entry 1 = RGB332 0xE0 (full red), then a solid index-1 tile 0.
  write_win(3, 0x81, 0x00E0);
  for (int w = 0; w < 32; w++) write_win(1, w, (w < 30) ? 0x1111 : 0x0000);
  write_tile(0, 0x0000);                   // map cell 0 -> tile 0
  bool cap_solid = false;
  unsigned solid_r = 0, solid_g = 0, solid_b = 0;
  for (int i = 0; i < 3000000; i++) {
    tick();
    if (!top->de) continue;
    if (top->dbg_y == 0 && top->dbg_x < 8) {
      cap_solid = true;
      solid_r = top->red; solid_g = top->green; solid_b = top->blue;
    }
  }
  check("bank tile renders", cap_solid ? 1 : 0, 1);
  check("bank tile uses palette entry 1 (red)", (long)solid_r, 0xFF);
  check("palette green is zero", (long)solid_g, 0);
  check("palette blue is zero", (long)solid_b, 0);

  // ---- horizontal smooth scroll -----------------------------------------
  write_tile(1, 0x0420);                   // A in map column 1
  write_ctrl(4, 8);                        // scroll one tile to the left
  check("scroll_x register takes 8", top->dbg_scroll_x, 8);
  bool cap_a_s = false, seen_a_s[15][8] = {};
  bool cap_a_px[15][8] = {};
  sample_cell(0, 0, cap_a_px, seen_a_s, &cap_a_s);
  check("column 1 tiles at x=0 after an 8-pixel scroll",
        compare_cell(tile, a_base, cap_a_px, seen_a_s, "Ascroll") ? 1 : 0, 1);
  write_ctrl(4, 0);
  check("scroll_x register back to 0", top->dbg_scroll_x, 0);

  // ---- sprites: 16x16, transparency, behind, palette ---------------------
  // Palette 2 = green, 3 = blue. Sprite 0 (front) is an index-2 grid with
  // every fourth pixel transparent; sprite 1 (behind) is solid index 3.
  write_win(3, 0x82, 0x001C);
  write_win(3, 0x83, 0x0003);
  for (int w = 0; w < 64; w++)     write_win(2, w, 0x0222);   // group 0 tiles 0..3
  for (int w = 256; w < 320; w++)  write_win(2, w, 0x3333);   // group 1 tiles 16..19
  // A blank background tile (index 0) under the sprite's left half. With
  // TOP=0, map row 6 is y=90..104, the row the sprite at y=100 sits on.
  for (int w = 0; w < 32; w++) write_win(1, 90 * 32 + w, 0x0000);
  write_tile(6 * 82 + 2, 90 * 32);                             // row 6, col 2
  write_win(3, 0, 16 | (0 << 10));                             // sprite 0: x=16, group 0
  write_win(3, 1, 100 | (1 << 10));                            // y=100, enable
  write_win(3, 2, 16 | (1 << 10) | (1 << 15));                 // sprite 1: group 1, behind
  write_win(3, 3, 100 | (1 << 10));
  write_ctrl(0, 0);                                            // cursor off

  int r = 0, g = 0, b = 0; bool seen = false;
  sample_pixel(17, 100, &r, &g, &b, &seen);
  check("front sprite pixel is green", r * 1000 + g * 10 + b, 0 * 1000 + 255 * 10 + 0);
  sample_pixel(19, 100, &r, &g, &b, &seen);
  check("transparent sprite pixel shows the behind sprite (blue)", r * 1000 + g * 10 + b, 0 * 1000 + 0 * 10 + 255);
  sample_pixel(27, 100, &r, &g, &b, &seen);
  check("behind sprite is hidden by background index 1 (red)", r * 1000 + g * 10 + b, 255 * 1000 + 0 * 10 + 0);
  sample_pixel(10, 100, &r, &g, &b, &seen);
  check("left of the sprite is background red", r * 1000 + g * 10 + b, 255 * 1000 + 0 * 10 + 0);
  sample_pixel(17, 80, &r, &g, &b, &seen);
  check("above the sprite is background red", r * 1000 + g * 10 + b, 255 * 1000 + 0 * 10 + 0);
  sample_pixel(17, 140, &r, &g, &b, &seen);
  check("below the sprite is background red", r * 1000 + g * 10 + b, 255 * 1000 + 0 * 10 + 0);

  // ---- 32x32 rows, flips, and the full eight-sprite priority chain -------
  // Palette 4 = blue. Group 0 tiles 8..11 are the second 8-row band of the
  // first sprite, so a sample at y=116 must read a different pattern row.
  write_win(3, 0x84, 0x0003);
  for (int w = 128; w < 192; w++) write_win(2, w, 0x0444);   // group 0, row band 2
  // Hflip sprite: only pattern word 7 carries a pixel, so the leftmost
  // displayed pixel can only be green if the word and nibble are reversed.
  write_win(2, 35 * 16 + 1, 0x2000);                          // group 2, word 7
  // Vflip sprite: the first displayed row reads pattern row 31.
  write_win(2, 60 * 16 + 14, 0x0002);                         // group 3, row 7
  // Lowest-priority sprite 7, same place as sprite 0, solid blue.
  for (int w = 64 * 16; w < 68 * 16; w++) write_win(2, w, 0x0444);

  write_win(3, 4, 60 | (2 << 10) | (1 << 13));                // sprite 2: hflip
  write_win(3, 5, 100 | (1 << 10));
  write_win(3, 6, 100 | (3 << 10) | (1 << 14));               // sprite 3: vflip
  write_win(3, 7, 100 | (1 << 10));
  write_win(3, 14, 16 | (4 << 10));                           // sprite 7: group 4
  write_win(3, 15, 100 | (1 << 10));

  sample_pixel(17, 116, &r, &g, &b, &seen);
  check("32x32 sprite reads its second 8-row band (blue)",
        r * 1000 + g * 10 + b, 0 * 1000 + 0 * 10 + 255);
  sample_pixel(60, 100, &r, &g, &b, &seen);
  check("hflip reverses pattern words and nibbles (green)",
        r * 1000 + g * 10 + b, 0 * 1000 + 255 * 10 + 0);
  sample_pixel(100, 100, &r, &g, &b, &seen);
  check("vflip reads pattern row 31 first (green)",
        r * 1000 + g * 10 + b, 0 * 1000 + 255 * 10 + 0);
  sample_pixel(17, 100, &r, &g, &b, &seen);
  check("sprite 0 still beats sprite 7 (green)",
        r * 1000 + g * 10 + b, 0 * 1000 + 255 * 10 + 0);

  delete top;
  if (fails) { std::printf("%d failure(s)\n", fails); return 1; }
  std::printf("all CPU tile console checks passed\n");
  return 0;
}
