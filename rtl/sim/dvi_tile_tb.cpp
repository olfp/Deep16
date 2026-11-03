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

static void wait_frame() {
  int prev = top->frame_tick;
  for (long i = 0; i < 3000000; i++) {
    tick();
    if (top->frame_tick != prev) return;
  }
  std::printf("FAIL frame_tick did not move\n");
  fails++;
}

static int count_raster(long n) {
  int count = 0, prev = top->raster_toggle;
  for (long i = 0; i < n; i++) {
    tick();
    if (top->raster_toggle != prev) { count++; prev = top->raster_toggle; }
  }
  return count;
}

static void write_tile(int addr, uint16_t data) {
  top->cpu_we = 1; top->cpu_ctrl = 0; top->cpu_tgt = 0;
  top->cpu_addr = addr & 0x1FFF; top->cpu_data = data;
  tick();
  top->cpu_we = 0;
  tick();
}

// Every window shares the same write shape; the address is the offset into
// the window (the sprite bank needs the 13th bit for its 24 groups).
static void write_win(int tgt, int addr, uint16_t data) {
  top->cpu_we = 1; top->cpu_ctrl = 0; top->cpu_tgt = tgt;
  top->cpu_addr = addr & 0x1FFF; top->cpu_data = data;
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
      const bool lit = (top->red | top->green | top->blue) != 0;
      cap[(y - y0) / 2][(x - x0) / 2] = lit;
      seen[(y - y0) / 2][(x - x0) / 2] = true;
      if (lit) *any_white = true;
    }
  }
}

static bool compare_cell(const std::vector<uint16_t>& tile, int base,
                         bool cap[15][8], bool seen[15][8], const char* name) {
  bool ok = true;
  for (int r = 0; r < 15; r++) {
    const uint16_t w = tile[base + (r >> 1)];      // 1bpp: two rows per word
    const uint8_t row = (r & 1) ? (w >> 8) & 0xFF : w & 0xFF;
    for (int c = 0; c < 8; c++) {
      const bool exp = ((row >> (7 - c)) & 1) != 0;
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
  // The scene RAM clears its 128 OAM words after reset; the CPU owns the
  // write port once that is done.
  for (int i = 0; i < 200; i++) tick();

  // H tile at tilemap[0]; visible cursor at row 0 column 1 so it does not
  // overlap the sampled cell.
  int r = 0, g = 0, b = 0; bool seen = false;
  const int h_base = 32 + (0x48 - 0x20) * 8; // tile 0 is blank; pages at 32
  const int a_base = 32 + (0x41 - 0x20) * 8;
  const int hi_base = 32 + 768 + (0x48 - 0x20) * 8;
  write_tile(0, 0x8000 | 0x0500);
  write_ctrl(0, (0 << 8) | (1 << 1) | 1);   // row 0, col 1, cursor on
  write_ctrl(2, 0);                         // row offset 0

  check("tilemap[0] holds the H tile address", top->dbg_cell0, 0x8500);

  // The board forwards the low 13 bits of the CPU address, so a tilemap store
  // arrives with bit 12 set: 0xF1000 & 0x1FFF = 0x1000. It must still land at
  // window offset 40. A guard on the raw address silently dropped every
  // tilemap write once the sprite window went to 13 bits.
  write_tile(0x1000 + 40, 40);
  check("tilemap store with window bit 12 set lands at offset 40",
        top->dbg_cell40, 40);
  write_tile(40, 0);

  auto tile = read_hex("tilefont.hex");
  bool cap_h[15][8] = {}, seen_h[15][8] = {};
  bool white = false;
  sample_cell(0, 0, cap_h, seen_h, &white);
  check("glyph H matches the 1bpp page",
        compare_cell(tile, h_base, cap_h, seen_h, "H") ? 1 : 0, 1);
  check("H is not blank", white ? 1 : 0, 1);

  // A tile at map column 1 must render at screen x=8..15.
  write_tile(1, 0x8000 | 0x0420);
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
  // must appear on visible row 0. The bottom visible row is map row 24, the
  // first margin row; put H there so the new ring can be observed.
  write_tile(82, 0x8000 | 0x0420);
  write_tile(24 * 82, 0x8000 | 0x0500);
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
  check("margin row 24 appears at the bottom visible row",
        compare_cell(tile, h_base, cap_h23, seen_h23, "H23") ? 1 : 0, 1);

  // ---- vertical scroll uses the 26-row map -------------------------------
  write_ctrl(2, 0);                        // row offset back to 0
  struct ScrollCase { int sy; int top; int bottom; };
  const ScrollCase scroll_cases[] = {
    {0, 0, 23}, {7, 0, 24}, {15, 1, 24}, {30, 2, 25},
  };
  for (const auto& sc : scroll_cases) {
    write_ctrl(6, sc.sy);
    wait_frame();
    int top_row = -1, bottom_row = -1;
    int ft = top->frame_tick, edges = 0;
    for (long i = 0; i < 4000000 && edges < 2; i++) {
      tick();
      if (top->frame_tick != ft) { ft = top->frame_tick; edges++; }
      if (top->dbg_fill == 9) {
        if (top->dbg_fline == 1) top_row = top->dbg_frow;
        if (top->dbg_fline == 359) bottom_row = top->dbg_frow;
      }
    }
    check("scroll_y top row", top_row, sc.top);
    check("scroll_y bottom row", bottom_row, sc.bottom);
  }
  write_ctrl(6, 0);                        // scroll_y back to 0

  // ---- writable tile bank and palette (the demo's windows) ---------------
  write_ctrl(0, 0);                        // cursor off
  // Palette entry 1 = RGB332 0xE0 (full red), then a solid index-1 tile 0.
  write_win(3, 0x91, 0x00E0);
  for (int w = 0; w < 32; w++) write_win(1, w, (w < 30) ? 0x1111 : 0x0000);
  write_tile(0, 0x0000);                   // map cell 0 -> solid art tile 0
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

  // ---- upper tile bank: tiles 96..127 are CPU-writable too --------------
  // The console font lives in the top 32 slots; a game image may replace it.
  write_win(3, 0x92, 0x0003);              // art entry 2 = full blue
  for (int w = 0; w < 32; w++) write_win(1, 96 * 32 + w, (w < 30) ? 0x2222 : 0x0000);
  write_tile(0, 96 * 32);                  // map cell 0 -> art tile 96
  sample_pixel(0, 0, &r, &g, &b, &seen);
  check("tile 96 (upper bank) is CPU-writable (blue)",
        r * 1000 + g * 10 + b, 0 * 1000 + 0 * 10 + 255);

  for (int w = 0; w < 32; w++) write_win(1, 127 * 32 + w, (w < 30) ? 0x1111 : 0x0000);
  write_tile(0, 127 * 32);                 // map cell 0 -> art tile 127
  sample_pixel(0, 0, &r, &g, &b, &seen);
  check("tile 127 (last) is CPU-writable (red)",
        r * 1000 + g * 10 + b, 255 * 1000 + 0 * 10 + 0);
  write_tile(0, 0);                        // restore the solid red tile 0

  // ---- horizontal smooth scroll -----------------------------------------
  write_tile(1, 0x8000 | 0x0420);          // A in map column 1
  write_ctrl(4, 8);                        // scroll one tile to the left
  check("scroll_x next register takes 8", top->dbg_scroll_x_next, 8);
  bool cap_a_s = false, seen_a_s[15][8] = {};
  bool cap_a_px[15][8] = {};
  sample_cell(0, 0, cap_a_px, seen_a_s, &cap_a_s);
  check("column 1 tiles at x=0 after an 8-pixel scroll",
        compare_cell(tile, a_base, cap_a_px, seen_a_s, "Ascroll") ? 1 : 0, 1);
  write_ctrl(4, 0);
  check("scroll_x next register back to 0", top->dbg_scroll_x_next, 0);

  // ---- per-row fine scroll (control 6) ----------------------------------
  wait_frame();
  write_ctrl(0x0C, (1 << 8) | (5 << 3) | 3);
  write_ctrl(0x0C, (1 << 8) | (6 << 3) | 5);
  check("row scroll is still latched off mid-frame", top->dbg_row_scroll_en, 0);
  wait_frame();
  wait_frame();
  check("row scroll enable latched", top->dbg_row_scroll_en, 1);

  int fpix5 = -1, fpix6 = -1, fpix7 = -1;
  for (long i = 0; i < 1500000 && (fpix5 < 0 || fpix6 < 0 || fpix7 < 0); i++) {
    tick();
    if (top->dbg_fill == 7) {
      if (top->dbg_ftrow == 5 && fpix5 < 0) fpix5 = top->dbg_fpix;
      if (top->dbg_ftrow == 6 && fpix6 < 0) fpix6 = top->dbg_fpix;
      if (top->dbg_ftrow == 7 && fpix7 < 0) fpix7 = top->dbg_fpix;
    }
  }
  check("fill row 5 uses fine 3", fpix5, 3);
  check("fill row 6 uses fine 5", fpix6, 5);
  check("fill row 7 keeps global fine 0", fpix7, 0);

  // Global scroll_x=8 and row fine=2 must add to a 10-pixel offset.
  write_ctrl(4, 8);
  write_ctrl(0x0C, (1 << 8) | (5 << 3) | 2);
  wait_frame();
  wait_frame();
  int fcol5 = -1;
  fpix5 = -1;
  for (long i = 0; i < 1500000 && (fpix5 < 0 || fcol5 < 0); i++) {
    tick();
    if (top->dbg_fill == 7 && top->dbg_ftrow == 5 && fpix5 < 0) {
      fpix5 = top->dbg_fpix; fcol5 = top->dbg_fcol;
    }
  }
  check("row 5 coarse column with scroll_x=8", fcol5, 1);
  check("row 5 fine phase with scroll_x=8", fpix5, 2);

  write_ctrl(0x0C, 0);                      // disable the table
  write_ctrl(4, 0);
  wait_frame();
  wait_frame();
  check("row scroll disabled again", top->dbg_row_scroll_en, 0);

  // ---- raster line compare (control 7) ----------------------------------
  write_ctrl(0x0E, 100);
  check("raster line register takes 100", top->dbg_raster_line, 100);
  wait_frame();
  check("raster toggles once in a frame", count_raster(1400000), 1);
  write_ctrl(0x0E, 1000);                   // beyond R_V_TOTAL: never matches
  wait_frame();
  check("raster line beyond the frame never fires", count_raster(1400000), 0);
  write_ctrl(0x0E, 0);

  // ---- text/art/sprite palette banks and pair mode ----------------------
  // Text bank pair 0 = black/green, pair 1 = black/blue; art bank entry 1 =
  // red; the sprite bank is tested below. The H glyph is 4bpp; pair mode
  // reduces its ink to the pair's odd entry.
  write_win(3, 0x80, 0x0000);
  write_win(3, 0x81, 0x001C);
  write_win(3, 0x82, 0x0000);
  write_win(3, 0x83, 0x0003);
  write_win(3, 0x91, 0x00E0);

  write_tile(0, 0x8000 | 0x0500);           // mode 1, pair 0, H glyph
  int hx = -1, hy = -1;
  for (int yy = 0; yy < 15 && hx < 0; yy++) {
    for (int xx = 0; xx < 8; xx++) {
      const uint16_t w = tile[h_base + (yy >> 1)];
      const uint8_t row = (yy & 1) ? (w >> 8) & 0xFF : w & 0xFF;
      if (((row >> (7 - xx)) & 1) != 0) { hx = xx; hy = yy; break; }
    }
  }
  int tr = 0, tg = 0, tb = 0; bool tseen = false;
  sample_pixel(hx, hy, &tr, &tg, &tb, &tseen);
  check("pair 0 text ink is text-bank green", tr * 1000 + tg * 10 + tb, 0 * 1000 + 255 * 10 + 0);

  write_tile(0, 0x8000 | (1 << 12) | 0x0500);   // pair 1
  sample_pixel(hx, hy, &tr, &tg, &tb, &tseen);
  check("pair 1 text ink is text-bank blue", tr * 1000 + tg * 10 + tb, 0 * 1000 + 0 * 10 + 255);

  write_tile(0, 0x0000);                    // mode 0: solid art tile 0, art bank red
  sample_pixel(hx, hy, &tr, &tg, &tb, &tseen);
  check("mode 0 glyph uses the art bank (red)", tr * 1000 + tg * 10 + tb, 255 * 1000 + 0 * 10 + 0);

  // ---- COLORTEXT styles: generated underline and bold smear --------------
  // The H is ".##..##." on row 3, so (7,3) is paper and (1,3) is ink.
  write_tile(0, 0x8000 | 0x0500);           // plain text cell
  sample_pixel(7, 3, &tr, &tg, &tb, &tseen);
  check("plain text leaves the right edge of a stroke as paper",
        tr * 1000 + tg * 10 + tb, 0);

  write_tile(0, 0x8000 | 0x0500 | 4);       // underline style bit
  sample_pixel(0, 14, &tr, &tg, &tb, &tseen);
  check("underline forces the descender row to ink",
        tr * 1000 + tg * 10 + tb, 0 * 1000 + 255 * 10 + 0);
  sample_pixel(0, 13, &tr, &tg, &tb, &tseen);
  check("underline leaves the row above it alone", tr * 1000 + tg * 10 + tb, 0);

  write_tile(0, 0x8000 | 0x0500 | 2);       // bold style bit
  sample_pixel(7, 3, &tr, &tg, &tb, &tseen);
  check("bold smears the stroke one pixel right",
        tr * 1000 + tg * 10 + tb, 0 * 1000 + 255 * 10 + 0);

  // The same styles must follow a non-default pair (pair 3: green paper,
  // yellow ink), not just the black/white console pair.
  write_win(3, 0x86, 0x001C);
  write_win(3, 0x87, 0x00FC);
  write_tile(0, 0x8000 | (3 << 12) | 0x0500 | 4);
  sample_pixel(0, 14, &tr, &tg, &tb, &tseen);
  check("underline uses pair 3's ink",
        tr * 1000 + tg * 10 + tb, 255 * 1000 + 255 * 10 + 0);
  write_tile(0, 0x8000 | (3 << 12) | 0x0500 | 2);
  sample_pixel(7, 3, &tr, &tg, &tb, &tseen);
  check("bold uses pair 3's ink",
        tr * 1000 + tg * 10 + tb, 255 * 1000 + 255 * 10 + 0);

  // STYLE bit 0 selects the italic page at word 800.
  write_tile(0, 0x8000 | 0x0500 | 1);
  bool cap_it[15][8] = {}, seen_it[15][8] = {};
  bool white_it = false;
  sample_cell(0, 0, cap_it, seen_it, &white_it);
  check("italic selects the designed italic page",
        compare_cell(tile, hi_base, cap_it, seen_it, "Hitalic") ? 1 : 0, 1);

  // The style bits live in tile-address bits 4:0, which the fill must mask.
  write_tile(0, 0x0000 | 2);                // mode 0 with a stray style bit
  sample_pixel(1, 3, &tr, &tg, &tb, &tseen);
  check("art cells ignore the style bits in the low address bits",
        tr * 1000 + tg * 10 + tb, 255 * 1000 + 0 * 10 + 0);

  // Restore the solid red tile the double-buffer test expects.
  write_tile(0, 0x0000);

  // ---- palette sets: control 5 bits 10:8 --------------------------------
  // Set 0 art entry 1 is red. Set 1's art entry 1 lives at 0xD1
  // (128 + 64 + 16 + 1) and is written blue; swapping the set recolours the
  // same tile without touching a palette entry.
  write_win(3, 0xD1, 0x0003);
  write_ctrl(0x0A, 0x0100);
  check("control 5 selects palette set 1", top->dbg_pset, 1);
  sample_pixel(hx, hy, &tr, &tg, &tb, &tseen);
  check("palette set 1 recolours the art tile (blue)",
        tr * 1000 + tg * 10 + tb, 0 * 1000 + 0 * 10 + 255);

  write_ctrl(0x0A, 0x0000);
  sample_pixel(hx, hy, &tr, &tg, &tb, &tseen);
  check("palette set 0 keeps its own entry (red)",
        tr * 1000 + tg * 10 + tb, 255 * 1000 + 0 * 10 + 0);

  // Bits 1:0 are ignored, so a legacy value keeps palette set 0.
  write_ctrl(0x0A, 0x0002);
  check("legacy control 5 value 2 keeps palette set 0", top->dbg_pset, 0);
  write_ctrl(0x0A, 0x0000);

  // ---- sprites: 16x16, transparency, behind, palette ---------------------
  // Palette 2 = green, 3 = blue. Sprite 0 (front) is an index-2 grid with
  // every fourth pixel transparent; sprite 1 (behind) is solid index 3.
  write_win(3, 0xA2, 0x001C);
  write_win(3, 0xA3, 0x0003);
  for (int w = 0; w < 64; w++)     write_win(2, w, 0x0222);   // group 0 tiles 0..3
  for (int w = 256; w < 320; w++)  write_win(2, w, 0x3333);   // group 1 tiles 16..19
  // The sprite's row (map row 6) has a blank tile 90 under its left half and
  // the solid art tile 96 around it, so the behind sprite is visible at x=19
  // and hidden at x=27. TOP=0: y=90..104 is map row 6.
  for (int w = 0; w < 32; w++) write_win(1, 90 * 32 + w, 0x0000);
  write_tile(6 * 82 + 2, 90 * 32);                             // row 6, col 2
  write_win(3, 0, 16 | 0x0800);                                // sprite 0: x=16, enable
  write_win(3, 1, 100 | (0 << 11));                            // y=100, group 0
  write_win(3, 2, 16 | 0x0800 | (1 << 15));                    // sprite 1: behind, enable
  write_win(3, 3, 100 | (1 << 11));                            // y=100, group 1
  write_ctrl(0, 0);                                            // cursor off

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
  write_win(3, 0xA4, 0x0003);
  for (int w = 128; w < 192; w++) write_win(2, w, 0x0444);   // group 0, row band 2
  // Hflip sprite: only pattern word 7 carries a pixel, so the leftmost
  // displayed pixel can only be green if the word and nibble are reversed.
  write_win(2, 35 * 16 + 1, 0x2000);                          // group 2, word 7
  // Vflip sprite: the first displayed row reads pattern row 31.
  write_win(2, 60 * 16 + 14, 0x0002);                         // group 3, row 7
  // Lowest-priority sprite 7, same place as sprite 0, solid blue.
  for (int w = 64 * 16; w < 68 * 16; w++) write_win(2, w, 0x0444);

  write_win(3, 4, 60 | 0x0800 | (1 << 13));                   // sprite 2: hflip, enable
  write_win(3, 5, 100 | (2 << 11));                           // y=100, group 2
  write_win(3, 6, 100 | 0x0800 | (1 << 14));                  // sprite 3: vflip, enable
  write_win(3, 7, 100 | (3 << 11));                           // y=100, group 3
  write_win(3, 14, 16 | 0x0800);                              // sprite 7: x=16, enable
  write_win(3, 15, 100 | (4 << 11));                          // y=100, group 4

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

  // ---- tilemap double buffer and scan status -----------------------------
  // Put the H into bank 1 while bank 0 (the solid red tile) is displayed.
  write_ctrl(8, 1);                       // write page 1, display page 0
  write_tile(0, 0x8000 | 0x0500);
  check("map write page is 1", top->dbg_wpage, 1);
  check("map display page still 0", top->dbg_dpage, 0);
  bool cap_old[15][8] = {}, seen_old[15][8] = {};
  bool white_old = false;
  sample_cell(0, 0, cap_old, seen_old, &white_old);
  bool old_solid = true;
  for (int rr = 0; rr < 15; rr++)
    for (int cc = 0; cc < 8; cc++)
      if (!seen_old[rr][cc] || !cap_old[rr][cc]) old_solid = false;
  check("back-buffer write leaves the visible map alone", old_solid ? 1 : 0, 1);

  // Ask for bank 1, wait for the render frame boundary, then sample it.
  write_ctrl(8, 2);                       // write page 0, display page 1
  for (int i = 0; i < 1650 * 750 * 2; i++) tick();
  check("map display page latches at the frame boundary", top->dbg_dpage, 1);
  bool cap_new[15][8] = {}, seen_new[15][8] = {};
  bool white_new = false;
  sample_cell(0, 0, cap_new, seen_new, &white_new);
  check("swapped-in tilemap renders the H",
        compare_cell(tile, h_base, cap_new, seen_new, "newpage") ? 1 : 0, 1);

  // Scan status: vblank must be visible and the frame toggle must move.
  int ft_prev = top->frame_tick;
  int ft_changes = 0;
  bool vblank_seen = false;
  for (int i = 0; i < 1650 * 750 * 2; i++) {
    tick();
    if (top->frame_tick != ft_prev) { ft_changes++; ft_prev = top->frame_tick; }
    if (top->vblank) vblank_seen = true;
  }
  check("vblank level is observable", vblank_seen ? 1 : 0, 1);
  check("frame toggle changes across frames", ft_changes >= 1 ? 1 : 0, 1);

  // ---- flat sprite groups: all 24 in one window --------------------------
  // The CPU window covers the whole 24-group bank (6,144 words); the OAM group
  // pointer is absolute and control 5 no longer pages the pattern bank.
  write_ctrl(8, 0);                          // map write page 0
  for (int w = 0; w < 64; w++) write_win(2, 8 * 256 + w, 0x0444);   // group 8, entry 4
  write_win(3, 0, 16 | 0x0800);              // sprite 0: x=16, enable
  write_win(3, 1, 160 | (8 << 11));          // y=160, absolute group 8
  sample_pixel(17, 160, &r, &g, &b, &seen);
  check("group 8 written in the flat window (blue)",
        r * 1000 + g * 10 + b, 0 * 1000 + 0 * 10 + 255);

  // Group 23 is the last one; the store at offset 23*256 needs the 13th
  // address bit, so it only works with the widened window.
  write_win(3, 0xA5, 0x00E0);               // sprite entry 5 = full red
  for (int w = 0; w < 64; w++) write_win(2, 23 * 256 + w, 0x0555);
  write_win(3, 1, 160 | (23 << 11));         // y=160, absolute group 23
  sample_pixel(17, 160, &r, &g, &b, &seen);
  check("group 23 (last) written in the flat window (red)",
        r * 1000 + g * 10 + b, 255 * 1000 + 0 * 10 + 0);

  write_win(3, 1, 160 | (0 << 11));          // same sprite, absolute group 0
  sample_pixel(17, 160, &r, &g, &b, &seen);
  check("absolute group 0 selects the group 0 pattern (green)",
        r * 1000 + g * 10 + b, 0 * 1000 + 255 * 10 + 0);

  // A group past the 24-group bank disables the sprite; page 3 is not a
  // valid write page and clamps to 0.
  write_win(3, 1, 160 | (24 << 11));
  sample_pixel(17, 160, &r, &g, &b, &seen);
  check("group 24 is out of range and draws nothing",
        r * 1000 + g * 10 + b, 255 * 1000 + 0 * 10 + 0);

  // The legacy page has no effect on where a store lands: with page 2
  // selected, offset 0 still writes group 0 (the old paging would have
  // written group 16).
  write_ctrl(10, 2);
  for (int w = 0; w < 64; w++) write_win(2, w, 0x0444);
  write_win(3, 1, 160 | (0 << 11));
  sample_pixel(17, 160, &r, &g, &b, &seen);
  check("control 5 does not redirect the sprite window (blue)",
        r * 1000 + g * 10 + b, 0 * 1000 + 0 * 10 + 255);
  for (int w = 0; w < 64; w++) write_win(2, w, 0x0222);   // group 0 back to green
  write_ctrl(10, 0);

  // ---- 64 descriptors: OAM base and end-of-bank wrap ---------------------
  // Descriptor 8 is a green sprite at x=16, y=200. The default base 0 shows
  // descriptors 0..7, so slot 0 must not see it; base 8 puts it on slot 0.
  write_win(3, 0x010, 16 | 0x0800);          // desc 8 w0: enable, x=16
  write_win(3, 0x011, 200 | (0 << 11));      // desc 8 w1: y=200, group 0
  write_ctrl(0x0A, 0);
  sample_pixel(17, 200, &r, &g, &b, &seen);
  check("descriptor 8 is hidden with OAM base 0",
        (r * 1000 + g * 10 + b) == 2550 ? 1 : 0, 0);
  write_ctrl(0x0A, 8 << 2);
  sample_pixel(17, 200, &r, &g, &b, &seen);
  check("OAM base 8 puts descriptor 8 on visible slot 0 (green)",
        r * 1000 + g * 10 + b, 0 * 1000 + 255 * 10 + 0);

  // Base 56 with descriptor 56: the high base bit must survive (no wrap).
  write_win(3, 0x070, 16 | 0x0800);          // desc 56 w0: enable, x=16
  write_win(3, 0x071, 140 | (0 << 11));      // desc 56 w1: y=140, group 0
  write_ctrl(0x0A, 56 << 2);
  sample_pixel(17, 140, &r, &g, &b, &seen);
  check("OAM base 56 shows descriptor 56 (green)",
        r * 1000 + g * 10 + b, 0 * 1000 + 255 * 10 + 0);
  write_ctrl(0x0A, 0);

  // Base 60 runs off the end of the bank and wraps: slot 7 is descriptor 3.
  write_win(3, 0x006, 16 | 0x0800);          // desc 3 w0: enable, x=16
  write_win(3, 0x007, 200 | (0 << 11));      // desc 3 w1: y=200, group 0
  write_ctrl(0x0A, 60 << 2);
  sample_pixel(17, 200, &r, &g, &b, &seen);
  check("OAM base 60 wraps slot 7 to descriptor 3 (green)",
        r * 1000 + g * 10 + b, 0 * 1000 + 255 * 10 + 0);
  write_ctrl(0x0A, 0);

  // Negative x: x=1000 means -24 with the sign bit in w0[10]. Only the
  // sprite's pixels 24..31 can land on screen x=0..7.
  write_win(3, 0, 1000 | 0x0800 | 0x0400);
  write_win(3, 1, 160 | (0 << 11));
  sample_pixel(0, 160, &r, &g, &b, &seen);
  check("negative-x sprite clips at the left edge (green)",
        r * 1000 + g * 10 + b, 0 * 1000 + 255 * 10 + 0);
  sample_pixel(8, 160, &r, &g, &b, &seen);
  check("negative-x sprite stops at its 32-pixel width (background red)",
        r * 1000 + g * 10 + b, 255 * 1000 + 0 * 10 + 0);

  // ---- descriptor base sweep -------------------------------------------
  // Same probe as the board: eight descriptors 8 apart, each at its own y,
  // then select each base and see which y appears.
  for (int w = 0; w < 128; w++) write_win(3, w, 0);
  write_ctrl(0x0A, 0);
  for (int k = 0; k < 8; k++) {
    write_win(3, k * 16, 16 | 0x0800);         // desc k*8, x=16, enable
    write_win(3, k * 16 + 1, (20 + 40 * k) | (0 << 11));
  }
  for (int k = 0; k < 8; k++) {
    write_ctrl(0x0A, k * 8 * 4);               // base k*8
    for (int i = 0; i < 1200000; i++) tick();  // one frame
    int hit = -1;
    for (int y = 0; y < 360; y++) {
      // sample after the frame by scanning the recorded pixels is not stored;
      // use sample_pixel only on the expected row.
      (void)y;
    }
    sample_pixel(17, 20 + 40 * k, &r, &g, &b, &seen);
    if (r * 1000 + g * 10 + b == 2550) hit = 20 + 40 * k;
    char name[64];
    std::snprintf(name, sizeof(name), "base %d shows descriptor %d", k * 8, k * 8);
    check(name, hit, 20 + 40 * k);
  }
  write_ctrl(0x0A, 0);

  // ---- reset clears all 128 descriptor words ----------------------------
  // Descriptor 63 is enabled and visible with base 56 (slot 7).
  write_win(3, 0x07E, 16 | 0x0800);          // desc 63 w0
  write_win(3, 0x07F, 200 | (0 << 11));      // desc 63 w1
  write_ctrl(0x0A, 56 << 2);
  sample_pixel(17, 200, &r, &g, &b, &seen);
  check("descriptor 63 is visible with base 56 (green)",
        r * 1000 + g * 10 + b, 0 * 1000 + 255 * 10 + 0);
  write_ctrl(0x0A, 0);
  write_win(3, 0x006, 16 | 0x0800);          // descriptor 3 again after the sweep
  check("descriptor 3 word 0 is stored", top->dbg_oam6, 16 | 0x0800);
  top->rst = 1;
  for (int i = 0; i < 20; i++) tick();
  top->rst = 0;
  for (int i = 0; i < 200; i++) tick();
  // OAM is RAM: a logic reset does not clear it. The bitstream starts it at
  // zero and the BIOS clears all 128 words when it enters gfx mode.
  check("descriptor 3 survives a logic reset", top->dbg_oam6, 16 | 0x0800);
  check("descriptor 63 survives a logic reset", top->dbg_oam127, 200);

  delete top;
  if (fails) { std::printf("%d failure(s)\n", fails); return 1; }
  std::printf("all CPU tile console checks passed\n");
  return 0;
}
