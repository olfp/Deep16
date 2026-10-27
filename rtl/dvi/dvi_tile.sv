// dvi_tile - the D16nano tile engine: a 640x360 console on 1280x720p60.
//
// The render side fills 80 x 24 cells of 8 x 15 pixels (640 x 360) at 24.75
// MHz, exactly two output lines per render line (44.44 us).
// The scan side reads each line buffer twice horizontally (x >> 1) and shows
// every source line on two output lines, so the DVI signal is a standard
// 1280 x 720 @ 60 Hz (74.25 MHz, 1650 x 750).
// The dvi_text build keeps its 640 x 480 @ 60 Hz timing.
//
// This is the NES-shaped video path the text console grows into, not another
// character mirror:
//
//   * an 82x26 tilemap of pure 16-bit tile addresses (80x24 visible plus one
//     tile of margin on every side, so hardware scroll_x/scroll_y never runs
//     off the map),
//   * 96 tiles of 32 words: 15 rows x 2 words of 4bpp pixels (30 words), a
//     palette pointer in word 30 and a flags word in word 31,
//   * a 16-entry RGB332 palette,
//   * a line-buffer renderer: while line N is scanned out, line N+1 is built
//     from the tilemap/tile bank into the other buffer. The pixel path is a
//     plain 640x8 read, so a palette lookup can never stall the scan.
//
// The CPU tilemap port and the sprite/OAM windows are live; the terminal
// parser writes tile addresses ((ch - 0x20) * 32) instead of ASCII bytes.
//
// BSRAM: tilemap 2,132 x 16-bit = 3 blocks, tile bank 96 x 32 x 16-bit = 3
// blocks, line buffer 3 x 640 x 8-bit = 1 block. The 16-colour palette is a
// 128-bit distributed ROM. Total 7 blocks.
module dvi_tile #(
  parameter int H_ACTIVE   = 640,   // source canvas: 80 x 24 x 8 x 15
  parameter int V_ACTIVE   = 360,
  parameter int R_H_TOTAL  = 1100,  // 44.44 us at 24.75 MHz
  parameter int R_V_TOTAL  = 375,   // 360 text + 15 blank (the scan is the master)
  parameter int O_H_ACTIVE = 1280,  // 720p60 output
  parameter int O_H_FRONT  = 110,
  parameter int O_H_SYNC   = 40,
  parameter int O_H_BACK   = 220,
  parameter int O_V_ACTIVE = 720,
  parameter int O_V_FRONT  = 5,
  parameter int O_V_SYNC   = 5,
  parameter int O_V_BACK   = 20,
  parameter int ROWS       = 24,
  parameter int CELL_H     = 15,
  parameter int TILE_COLS  = 82,
  parameter int TILE_ROWS  = 26,
  parameter int TILE_COUNT = 128,
  parameter int TILE_AW    = 12
) (
  input  logic        clk_render, // 24.75 MHz fill/render clock
  input  logic        clk_pixel,  // 74.25 MHz scan/TMDS clock
  input  logic        rst_render,
  input  logic        rst_pixel,
  // CPU console port, synchronised into the render domain by the board FIFO.
  input  logic        cpu_we,     // one memory/control write this render clock
  input  logic        cpu_ctrl,   // 1 = control register, 0 = memory window
  input  logic [1:0]  cpu_tgt,    // 0 tilemap, 1 tile bank, 2 sprite bank, 3 OAM/palette
  input  logic [11:0] cpu_addr,
  input  logic [15:0] cpu_data,
  output logic [7:0]  red,
  output logic [7:0]  green,
  output logic [7:0]  blue,
  output logic        hsync,
  output logic        vsync,
  output logic        de,
  // Read-side telemetry for the CPU: a vertical-blank level and a one-bit
  // frame toggle. Both are generated in the scan clock domain and synchronised
  // by the board into the CPU domain.
  output logic        vblank,
  output logic        frame_tick
);
  localparam int O_H_TOTAL = O_H_ACTIVE + O_H_FRONT + O_H_SYNC + O_H_BACK; // 1650
  localparam int O_V_TOTAL = O_V_ACTIVE + O_V_FRONT + O_V_SYNC + O_V_BACK; // 750
  localparam int TEXT_H    = ROWS * CELL_H;                                 // 360
  localparam int TEXT_END  = TEXT_H;

  localparam int TM_WORDS   = TILE_COLS * TILE_ROWS;                // 2,132
  localparam int TM_AW      = 12;
  localparam int TILE_WORDS = TILE_COUNT * 32;                      // 4,096
  localparam int TILE_CPU_WORDS = 96 * 32;                          // CPU sees 96 glyph tiles
  // 24 sprite groups: page 0 Red + demo, page 1 Purple, page 2 Yellow.
  // The CPU window covers one page (8 groups); the rest are preloaded.
  localparam int SPR_GROUPS = 24;
  localparam int SPR_WORDS  = SPR_GROUPS * 256;                    // 6,144
  localparam int SPR_PAGE_WORDS = 8 * 256;                         // 2,048
  localparam int NSPR       = 8;
  localparam int OAM_WORDS  = NSPR * 2;
  localparam int LB_DEPTH   = 3 * 1024;                            // three 1024-byte slots
  localparam int LB_AW      = 12;

  // ---- render timing (fill side, 24.75 MHz) -----------------------------
  logic [11:0] rx;
  logic [9:0]  ry;
  wire render_line_end = (rx == 12'(R_H_TOTAL - 1));
  wire [9:0] ry_next = (ry == 10'(R_V_TOTAL - 1)) ? 10'd0 : ry + 10'd1;

  // ---- producer/consumer handshake -------------------------------------
  // Two line buffers. The render side fills line N into buffer N[0]; the
  // scan side shows line N on two 720p lines and then frees it. Only the
  // toggles cross the clock boundary; the BSRAM has independent clocks.
  localparam logic [3:0] F_IDLE = 4'd0;
  logic [1:0]  wr_buf = 2'd0;
  logic [2:0]  free_seen = 3'd0;        // per buffer, render domain
  logic [2:0]  free_s0, free_s1;       // free_toggle synchronised into render
  logic [2:0]  free_toggle = 3'b111;    // per buffer, scan domain: initially free
  logic [2:0]  ready_toggle = 3'd0;     // per buffer, render domain
  logic        frame_toggle = 1'b0;     // toggles at the render frame boundary
  logic        armed = 1'b0;
  logic [3:0]  fstate;

  wire [2:0] free_sync = free_s1;
  wire line_free = (free_sync[wr_buf] != free_seen[wr_buf]);
  wire fill_wanted = (ry_next < 10'(TEXT_END));
  wire first_line0 = (!armed && (ry_next == 10'd0));
  wire render_stall = (rx == 12'd0) && (fstate == F_IDLE) &&
                      fill_wanted && !line_free && (armed || first_line0);

  always_ff @(posedge clk_render) begin
    if (rst_render) begin
      free_s0 <= 3'b0;
      free_s1 <= 3'b0;
    end else begin
      free_s0 <= free_toggle;
      free_s1 <= free_s0;
    end
  end

  // ---- text row / glyph row, advanced at the end of each render line ----
  logic [4:0] ty;
  logic [3:0] gy;
  logic [4:0] cur_row;          // visible cursor row/column, from the CPU port
  logic [6:0] cur_col;
  logic       cursor_en;
  wire next_is_text = (ry_next < 10'(TEXT_END));
  wire [4:0] next_ty = (ry_next == 10'd0) ? 5'd0
                     : ty + ((gy == 4'(CELL_H - 1)) ? 5'd1 : 5'd0);
  wire [3:0] next_gy = (ry_next == 10'd0) ? 4'd0
                     : ((gy == 4'(CELL_H - 1)) ? 4'd0 : gy + 4'd1);

  // Vertical hardware scroll: scroll_y shifts the next line's glyph row
  // within the 15-line cell. The terminal leaves it at zero; the game code
  // will drive it together with the 26-row map.
  wire [5:0] fill_gy_sum   = {2'b0, next_gy} + {1'b0, scroll_y};
  wire [1:0] fill_gy_carry = (fill_gy_sum >= 6'd30) ? 2'd2
                           : (fill_gy_sum >= 6'd15) ? 2'd1 : 2'd0;
  wire [3:0] fill_gy_val   = 4'(fill_gy_sum - (fill_gy_carry == 2'd2 ? 6'd30
                                          : fill_gy_carry == 2'd1 ? 6'd15 : 6'd0));
  wire [4:0] fill_trow_val = next_ty + {3'b0, fill_gy_carry};

  always_ff @(posedge clk_render) begin
    if (rst_render) begin
      rx <= 12'd0;
      ry <= 10'd0;
    end else if (!render_stall) begin
      rx <= render_line_end ? 12'd0 : rx + 12'd1;
      if (render_line_end) ry <= ry_next;
    end
  end

  always_ff @(posedge clk_render) begin
    if (rst_render) begin
      ty <= 5'd0;
      gy <= 4'd0;
    end else if (render_line_end && !render_stall && next_is_text) begin
      ty <= next_ty;
      gy <= next_gy;
    end
  end

  // The first line 0 is filled at the end of the render frame; the following
  // frame boundary releases the scan path so it starts with line 0.
  always_ff @(posedge clk_render) begin
    if (rst_render) frame_toggle <= 1'b0;
    else if (render_line_end && !render_stall && (ry == 10'(R_V_TOTAL - 1)))
      frame_toggle <= ~frame_toggle;
  end

  // ---- memories ----------------------------------------------------------
  // Every memory below has one write port (the CPU window, via the board
  // FIFO) and one read port (the fill/render path), so each stays one BSRAM.
  //
  // The tilemap has two banks. Bank 0 is the console's map; a game writes the
  // next frame into the other bank and asks for a display swap at a frame
  // boundary. That keeps a 2,132-word redraw off the visible map entirely.
  logic [15:0] tilemap [0:2*TM_WORDS-1];
  logic [15:0] tilefont [0:TILE_WORDS-1];
  logic [15:0] sprite   [0:SPR_WORDS-1];
  // OAM and palette are plain registers, not memories: they are tiny and
  // read from several places, and the flow would otherwise spend a dozen
  // RAM16 primitives on each read port.
  logic [255:0] oam_bits;                 // 16 words of 16 bits (8 sprites x 2)
  logic [127:0] pal_bits;                 // 16 entries of RGB332
  logic [15:0]  pal_init [0:15];
  logic [7:0]  linebuf  [0:LB_DEPTH-1];
  initial begin
    $readmemh("tilefont.hex", tilefont);
    $readmemh("birdsprite.hex", sprite);
    $readmemh("tilepal.hex", pal_init);
    for (int i = 0; i < 16; i++) pal_bits[i*8 +: 8] = pal_init[i][7:0];
  end

  // Sprite row cache: one 32-pixel line per sprite, 8 words of 4 pixels.
  // Loaded during the previous line's blanking; the fill reads it
  // combinationally, so the sprite bank never competes with the pixel path.
  // The pixel under the beam is selected from the sprite-relative x, so the
  // flops are a plain 8x8x16 register file: no per-pixel shift mux and no
  // variable part-select write. Hflip is a read-side word/nibble reversal.
  logic [15:0] spw [0:NSPR-1][0:7];
  // 8 x 11-bit x positions, biased by +32 so a sprite can cross the left
  // edge: negative x is stored as (x - 1024 + 32).
  logic [87:0]  spx0_bits;
  logic [7:0]   spon_bits, spbh_bits, sphf_bits;

  // Sprite bank read port (one word fetched per loader request).
  logic [12:0] spr_raddr;
  logic [15:0] spr_q;


  logic [TM_AW-1:0]  tm_raddr;
  /* verilator lint_off UNUSEDSIGNAL */
  logic [15:0]       tm_q;   // low 12 bits are the tile base; upper bits reserved
  /* verilator lint_on UNUSEDSIGNAL */

  // The CPU owns the memories and the control registers. Control writes
  // (cpu_ctrl) update the cursor, the circular row offset and the two smooth
  // scroll registers; all other writes go to the window selected by cpu_tgt:
  //   0 tilemap   0xF1000..  (2,132 words)
  //   1 tile bank 0xF3000..  (96 x 32 words, writable for the demo)
  //   2 sprites   0xF4000..  (one page: 8 groups x 128 patterns x 16 words)
  //   3 OAM/pal   0xF5000..  (OAM 0x00..0x0F, palette 0x80..0x8F)
  logic [4:0] row_off;
  logic [3:0] scroll_x;   // 0..15: pixel offset into the 82-column map
  logic [3:0] scroll_x_next; // latched with the map page at the frame boundary
  logic [4:0] scroll_y;   // 0..30: pixel offset into the 26-row map
  logic       map_wpage;  // CPU writes target this bank
  logic       map_dpage;  // fill/render reads this bank
  logic       map_dpage_next;
  logic [1:0] sprite_page; // sprite group page (0 Red/demo, 1 Purple, 2 Yellow)

  /* verilator lint_off MULTIDRIVEN */   // power-up palette + runtime CPU writes
  always_ff @(posedge clk_render) begin
    if (rst_render) oam_bits <= '0;
    else if (cpu_we && !cpu_ctrl) begin
      case (cpu_tgt)
        2'd0: if (cpu_addr < 12'(TM_WORDS))
                tilemap[(map_wpage ? 13'(TM_WORDS) : 13'd0) + 13'(cpu_addr)] <= cpu_data;
        2'd1: if (cpu_addr < 12'(TILE_CPU_WORDS)) tilefont[cpu_addr] <= cpu_data;
        2'd2: if (cpu_addr < 12'(SPR_PAGE_WORDS))
                sprite[{sprite_page, cpu_addr[10:0]}] <= cpu_data;
        2'd3: begin
          if (cpu_addr[7:0] < 8'(OAM_WORDS))
            oam_bits[cpu_addr[3:0]*16 +: 16] <= cpu_data;
          else if (cpu_addr[7:0] >= 8'h80 && cpu_addr[7:0] <= 8'h8F)
            pal_bits[cpu_addr[3:0]*8 +: 8] <= cpu_data[7:0];
        end
        default: ;
      endcase
    end
    tm_q <= tilemap[(map_dpage ? 13'(TM_WORDS) : 13'd0) + 13'(tm_raddr)];
    spr_q <= sprite[spr_raddr];
  end
  /* verilator lint_on MULTIDRIVEN */

  always_ff @(posedge clk_render) begin
    if (rst_render) begin
      cur_row   <= 5'd0;
      cur_col   <= 7'd0;
      cursor_en <= 1'b1;
      row_off   <= 5'd0;
      scroll_x_next <= 4'd0;
      scroll_y  <= 5'd0;
      map_wpage <= 1'b0;
      map_dpage_next <= 1'b0;
      sprite_page <= 2'd0;
    end else if (cpu_we && cpu_ctrl) begin
      // 0x00 cursor, 0x02 row offset, 0x04 scroll_x, 0x06 scroll_y,
      // 0x08 {display page, write page}, 0x0A sprite group page.  The display
      // page and scroll_x are
      // latched together at the render frame boundary below; the console sees
      // one frame of latency there, and a game can swap a freshly drawn map
      // and its matching pixel offset atomically.
      case (cpu_addr[3:0])
        4'h0: begin
          cur_row   <= cpu_data[12:8];
          cur_col   <= cpu_data[7:1];
          cursor_en <= cpu_data[0];
        end
        4'h2: row_off  <= cpu_data[4:0];
        4'h4: scroll_x_next <= cpu_data[3:0];
        4'h6: scroll_y <= cpu_data[4:0];
        4'h8: begin
          map_wpage      <= cpu_data[0];
          map_dpage_next <= cpu_data[1];
        end
        4'hA: sprite_page <= cpu_data[1:0];
        default: ;
      endcase
    end
  end

  // The console starts on bank 0. A swap request takes effect only at the
  // render frame boundary, so no line is ever composed from two maps.
  always_ff @(posedge clk_render) begin
    if (rst_render) begin
      map_dpage <= 1'b0;
      scroll_x  <= 4'd0;
    end else if (render_line_end && !render_stall && (ry == 10'(R_V_TOTAL - 1))) begin
      map_dpage <= map_dpage_next;
      scroll_x  <= scroll_x_next;
    end
  end

  logic [TILE_AW-1:0] tf_raddr;
  logic [15:0]        tf_q;

  always_ff @(posedge clk_render) tf_q <= tilefont[tf_raddr];

  logic             lb_we;
  logic [LB_AW-1:0] lb_waddr;
  logic [7:0]       lb_wdata;
  logic [LB_AW-1:0] lb_raddr;
  logic [7:0]       lb_q;

  always_ff @(posedge clk_render) if (lb_we) linebuf[lb_waddr] <= lb_wdata;
  always_ff @(posedge clk_pixel)  lb_q <= linebuf[lb_raddr];

  // 24-row circular terminal window inside a 26-row map. The two extra rows
  // are the vertical scroll margin; the text uses rows 0..23.
  function automatic logic [4:0] wrap_rows(input logic [5:0] s);
    wrap_rows = (s >= 6'(ROWS)) ? (s[4:0] - 5'(ROWS)) : s[4:0];
  endfunction

  // row * 82 without a general multiplier.
  function automatic logic [11:0] row82(input logic [4:0] row);
    row82 = ({7'b0, row} << 6) + ({7'b0, row} << 4) + ({7'b0, row} << 1);
  endfunction

  // =====================================================================
  // Fill path: build line y_next into the other line buffer
  // =====================================================================
  localparam logic [3:0] F_FIRST_CELL = 4'd1,
                         F_FIRST_CELL_Q = 4'd2,
                         F_FIRST_ROW0 = 4'd3,
                         F_FIRST_ROW0_Q = 4'd4,
                         F_FIRST_ROW1 = 4'd5,
                         F_FIRST_ROW1_Q = 4'd6,
                         F_PIX = 4'd7,
                         F_BORDER = 4'd8,
                         F_DONE = 4'd9;

  localparam logic [2:0] N_IDLE = 3'd0,
                         N_CELL = 3'd1,
                         N_CELL_Q = 3'd2,
                         N_ROW0 = 3'd3,
                         N_ROW0_Q = 3'd4,
                         N_ROW1 = 3'd5,
                         N_ROW1_Q = 3'd6,
                         N_READY = 3'd7;

  logic [9:0]  fx;
  logic [9:0]  fline;
  logic [6:0]  fcol;
  logic [3:0]  fpix;
  logic [4:0]  ftrow;
  logic [3:0]  fgy;
  logic [4:0]  frow;
  logic [11:0] fcell;
  logic [15:0] frow0, frow1;
  logic [6:0]  ncol;
  logic [2:0]  nstate;
  logic [11:0] fncell;
  logic [15:0] fnrow0, fnrow1;

  wire [11:0] fill_base = row82(frow);
  wire [11:0] fill_cell_addr = fill_base + 12'(fcol);
  wire [11:0] next_cell_addr = fill_base + 12'(ncol);
  wire [11:0] fill_row_addr = fcell + {7'b0, fgy, 1'b0};

  wire fill_stall = (fstate == F_PIX) && (fpix == 4'd7) &&
                    (fx != 10'(H_ACTIVE - 1)) && (nstate != N_READY);
  wire fill_pixel = (fstate == F_PIX) && !fill_stall;
  wire start_fill = (rx == 12'd0) && (fstate == F_IDLE) && fill_wanted &&
                    line_free && (armed || first_line0);

  wire [3:0] pix_index = (fpix < 4'd4)
                       ? frow0[4'(fpix) * 4 +: 4]
                       : frow1[4'(fpix - 4'd4) * 4 +: 4];

  // Cursor: the terminal's cell block. The line buffer already holds colours,
  // so invert the colour rather than the glyph bit.
  logic [23:0] blink;
  always_ff @(posedge clk_render) begin
    if (rst_render) blink <= 24'd0;
    else blink <= blink + 24'd1;
  end
  wire       cursor_fill      = cursor_en && blink[23] &&
                                (fline < 10'(TEXT_END)) &&
                                (ftrow == cur_row) &&
                                (fx[9:3] == cur_col);

  // ---- fill address mux --------------------------------------------------
  always_comb begin
    tm_raddr = 12'd0;
    tf_raddr = 12'd0;
    case (fstate)
      F_FIRST_CELL: tm_raddr = fill_cell_addr;
      F_FIRST_ROW0: tf_raddr = fill_row_addr;
      F_FIRST_ROW1: tf_raddr = fill_row_addr + 12'd1;
      F_PIX: begin
        case (nstate)
          N_CELL: tm_raddr = next_cell_addr;
          N_ROW0: tf_raddr = fncell + {7'b0, fgy, 1'b0};
          N_ROW1: tf_raddr = fncell + {7'b0, fgy, 1'b0} + 12'd1;
          default: ;
        endcase
      end
      default: ;
    endcase
  end
  // ---- sprite compositor ------------------------------------------------
  // Sprite x is biased by +32 so a negative x (stored in w1[11]) can clip at
  // the left edge.  Both sides of the compare carry the bias, so the pixel
  // offset d is unchanged.
  wire [10:0] fxb = {1'b0, fx[9:0]} + 11'd32;
  function automatic logic [5:0] spr_cand(input logic [3:0] nib,
                                          input logic on, input logic [10:0] x0,
                                          input logic bh);
    logic ok;
    ok = on && (fxb >= x0) && ((fxb - x0) < 11'd32);
    spr_cand = {ok && (nib != 4'd0), bh, nib};
  endfunction

  wire [10:0] sx0 = spx0_bits[0  +: 11];
  wire [10:0] sx1 = spx0_bits[11 +: 11];
  wire [10:0] sx2 = spx0_bits[22 +: 11];
  wire [10:0] sx3 = spx0_bits[33 +: 11];
  wire [10:0] sx4 = spx0_bits[44 +: 11];
  wire [10:0] sx5 = spx0_bits[55 +: 11];
  wire [10:0] sx6 = spx0_bits[66 +: 11];
  wire [10:0] sx7 = spx0_bits[77 +: 11];

  wire [10:0] d0 = fxb - sx0;
  wire [10:0] d1 = fxb - sx1;
  wire [10:0] d2 = fxb - sx2;
  wire [10:0] d3 = fxb - sx3;
  wire [10:0] d4 = fxb - sx4;
  wire [10:0] d5 = fxb - sx5;
  wire [10:0] d6 = fxb - sx6;
  wire [10:0] d7 = fxb - sx7;

  wire [2:0] w0 = d0[4:2] ^ {3{sphf_bits[0]}};
  wire [1:0] nb0 = d0[1:0] ^ {2{sphf_bits[0]}};
  wire [15:0] sh0 = spw[0][w0] >> {nb0, 2'b00};
  wire [3:0]  nib0 = sh0[3:0];
  wire [2:0] w1 = d1[4:2] ^ {3{sphf_bits[1]}};
  wire [1:0] nb1 = d1[1:0] ^ {2{sphf_bits[1]}};
  wire [15:0] sh1 = spw[1][w1] >> {nb1, 2'b00};
  wire [3:0]  nib1 = sh1[3:0];
  wire [2:0] w2 = d2[4:2] ^ {3{sphf_bits[2]}};
  wire [1:0] nb2 = d2[1:0] ^ {2{sphf_bits[2]}};
  wire [15:0] sh2 = spw[2][w2] >> {nb2, 2'b00};
  wire [3:0]  nib2 = sh2[3:0];
  wire [2:0] w3 = d3[4:2] ^ {3{sphf_bits[3]}};
  wire [1:0] nb3 = d3[1:0] ^ {2{sphf_bits[3]}};
  wire [15:0] sh3 = spw[3][w3] >> {nb3, 2'b00};
  wire [3:0]  nib3 = sh3[3:0];
  wire [2:0] w4 = d4[4:2] ^ {3{sphf_bits[4]}};
  wire [1:0] nb4 = d4[1:0] ^ {2{sphf_bits[4]}};
  wire [15:0] sh4 = spw[4][w4] >> {nb4, 2'b00};
  wire [3:0]  nib4 = sh4[3:0];
  wire [2:0] w5 = d5[4:2] ^ {3{sphf_bits[5]}};
  wire [1:0] nb5 = d5[1:0] ^ {2{sphf_bits[5]}};
  wire [15:0] sh5 = spw[5][w5] >> {nb5, 2'b00};
  wire [3:0]  nib5 = sh5[3:0];
  wire [2:0] w6 = d6[4:2] ^ {3{sphf_bits[6]}};
  wire [1:0] nb6 = d6[1:0] ^ {2{sphf_bits[6]}};
  wire [15:0] sh6 = spw[6][w6] >> {nb6, 2'b00};
  wire [3:0]  nib6 = sh6[3:0];
  wire [2:0] w7 = d7[4:2] ^ {3{sphf_bits[7]}};
  wire [1:0] nb7 = d7[1:0] ^ {2{sphf_bits[7]}};
  wire [15:0] sh7 = spw[7][w7] >> {nb7, 2'b00};
  wire [3:0]  nib7 = sh7[3:0];

  wire [5:0] c0 = spr_cand(nib0, spon_bits[0], sx0, spbh_bits[0]);
  wire [5:0] c1 = spr_cand(nib1, spon_bits[1], sx1, spbh_bits[1]);
  wire [5:0] c2 = spr_cand(nib2, spon_bits[2], sx2, spbh_bits[2]);
  wire [5:0] c3 = spr_cand(nib3, spon_bits[3], sx3, spbh_bits[3]);
  wire [5:0] c4 = spr_cand(nib4, spon_bits[4], sx4, spbh_bits[4]);
  wire [5:0] c5 = spr_cand(nib5, spon_bits[5], sx5, spbh_bits[5]);
  wire [5:0] c6 = spr_cand(nib6, spon_bits[6], sx6, spbh_bits[6]);
  wire [5:0] c7 = spr_cand(nib7, spon_bits[7], sx7, spbh_bits[7]);

  // Sprite 0 wins: combine from 7 down to 0 and let a lower index replace.
  logic [5:0] sc;
  always_comb begin
    sc = c7;
    if (c6[5]) sc = c6;
    if (c5[5]) sc = c5;
    if (c4[5]) sc = c4;
    if (c3[5]) sc = c3;
    if (c2[5]) sc = c2;
    if (c1[5]) sc = c1;
    if (c0[5]) sc = c0;
  end

  wire sprite_win = sc[5] && (!sc[4] || (pix_index == 4'd0));


  assign lb_we    = fill_pixel;
  assign lb_waddr = {wr_buf, fx[9:0]};
  assign lb_wdata = sprite_win ? pal_bits[sc[3:0]*8 +: 8]
                  : (pal_bits[pix_index*8 +: 8] ^ {8{cursor_fill}});

  // =====================================================================
  // Fill sequencer
  // =====================================================================
  always_ff @(posedge clk_render) begin
    if (rst_render) begin
      fstate <= F_IDLE;
      fx <= 10'd0;
      fline <= 10'd0;
      fcol <= 7'd0;
      fpix <= 4'd0;
      ftrow <= 5'd0;
      fgy <= 4'd0;
      frow <= 5'd0;
      fcell <= 12'd0;
      frow0 <= 16'd0;
      frow1 <= 16'd0;
      ncol <= 7'd0;
      nstate <= N_IDLE;
      fncell <= 12'd0;
      fnrow0 <= 16'd0;
      fnrow1 <= 16'd0;
    end else begin
      // ---- start the fill for the next line at the start of this one ----
      if (start_fill) begin
        if (first_line0) begin
          armed <= 1'b1;
          wr_buf <= 2'd0;
          free_seen[0] <= free_sync[0];
        end else begin
          free_seen[wr_buf] <= free_sync[wr_buf];
        end
        fline <= ry_next;
        fx <= 10'd0;
        ftrow <= fill_trow_val;
        fgy <= fill_gy_val;
        frow <= wrap_rows({1'b0, fill_trow_val} + {1'b0, row_off});
        fcol <= 7'(scroll_x >> 3);
        fpix <= 4'(scroll_x[2:0]);
        nstate <= N_IDLE;
        fstate <= F_FIRST_CELL;
      end else begin
        case (fstate)
          F_FIRST_CELL: begin
            fstate <= F_FIRST_CELL_Q;
          end
          F_FIRST_CELL_Q: begin
            fcell <= tm_q[11:0];
            fstate <= F_FIRST_ROW0;
          end
          F_FIRST_ROW0: begin
            fstate <= F_FIRST_ROW0_Q;
          end
          F_FIRST_ROW0_Q: begin
            frow0 <= tf_q;
            fstate <= F_FIRST_ROW1;
          end
          F_FIRST_ROW1: begin
            fstate <= F_FIRST_ROW1_Q;
          end
          F_FIRST_ROW1_Q: begin
            frow1 <= tf_q;
            fstate <= F_PIX;
            nstate <= N_CELL;
            ncol <= 7'(fcol + 7'd1);
          end
          F_PIX: begin
            // The next tile is prefetched during the current tile's pixels.
            // Each memory has one cycle of read latency, so the address state
            // is separate from the capture state.
            case (nstate)
              N_CELL: begin
                nstate <= N_CELL_Q;
              end
              N_CELL_Q: begin
                fncell <= tm_q[11:0];
                nstate <= N_ROW0;
              end
              N_ROW0: begin
                nstate <= N_ROW0_Q;
              end
              N_ROW0_Q: begin
                fnrow0 <= tf_q;
                nstate <= N_ROW1;
              end
              N_ROW1: begin
                nstate <= N_ROW1_Q;
              end
              N_ROW1_Q: begin
                fnrow1 <= tf_q;
                nstate <= N_READY;
              end
              default: ;
            endcase

            if (fill_pixel) begin
              if (fx == 10'(H_ACTIVE - 1)) begin
                ready_toggle[wr_buf] <= ~ready_toggle[wr_buf];
                wr_buf <= (wr_buf == 2'd2) ? 2'd0 : wr_buf + 2'd1;
                fstate <= F_DONE;
              end else if (fpix == 4'd7) begin
                fcell <= fncell;
                frow0 <= fnrow0;
                frow1 <= fnrow1;
                fcol <= 7'(fcol + 7'd1);
                fpix <= 4'd0;
                ncol <= 7'(fcol + 7'd2);
                nstate <= N_CELL;
                fx <= fx + 10'd1;
              end else begin
                fpix <= fpix + 4'd1;
                fx <= fx + 10'd1;
              end
            end
          end
          F_BORDER, F_DONE: begin
            if (fx == 10'(H_ACTIVE - 1)) begin
              fstate <= F_DONE;
            end else begin
              fx <= fx + 10'd1;
            end
          end
          default: ;
        endcase

        // F_DONE is the quiet state after the last pixel; the next line's
        // x==0 restarts. Keep it distinct from F_IDLE so the restart does not
        // fire in the same line.
        if (fstate == F_DONE) fstate <= F_IDLE;
      end
    end
  end

  // =====================================================================
  // Sprite line loader: one 16-pixel row per sprite, during blanking
  // =====================================================================
  // Sprite row loader
  // =====================================================================
  // During line y the fill builds y+1 from the cache, which must have been
  // loaded for L = y+1 during line y-1's blanking. Eight 32x32 sprites take
  // 2 OAM cycles + 8 pattern words each; two cycles per word fits the
  // 160-pixel blanking with room to spare.
  //
  // OAM, two words per sprite (16 words):
  //   w0 = {behind, vflip, hflip, group[2:0], x[9:0]}
  //   w1 = {xsign, 3'b0, enable, y[9:0]}  (bit 11 = negative x, bit 10 = enable)
  // A 32x32 sprite is 4x4 8x8 patterns: tile = group*16 + (row/8)*4 + column.
  // Pattern word = tile*16 + (row%8)*2 + (column%4)/4; low nibble leftmost.
  localparam logic [1:0] L_IDLE  = 2'd0,
                         L_SPR   = 2'd1,
                         L_REQ   = 2'd2,
                         L_CAP   = 2'd3;

  logic [1:0]  lstate;
  logic [2:0]  lspr;
  logic [3:0]  lw;
  logic [9:0]  lline;
  logic [4:0]  lgrp;
  logic        lcap;
  logic [4:0]  lrow;
  logic [12:0] laddr;

  wire [3:0]  loidx = {lspr, 1'b0};
  wire [15:0] loam0 = oam_bits[loidx*16 +: 16];
  wire [11:0] loam1 = oam_bits[4'(loidx + 4'd1)*16 +: 12];

  assign spr_raddr = laddr;

  logic [8:0] ltile;
  always_comb begin
    ltile = {lgrp, 4'b0} + {5'b0, lrow[4:3], 2'b0} + {7'b0, lw[2:1]};
    laddr = 13'd0;
    if (lstate == L_REQ)
      laddr = 13'({ltile, 4'd0} + {9'd0, lrow[2:0], 1'b0} + {12'd0, lw[0]});
  end

  always_ff @(posedge clk_render) begin
    if (rst_render) begin
      lstate <= L_IDLE; lspr <= 3'd0; lw <= 4'd0; lline <= 10'd0;
      for (int i = 0; i < NSPR; i++)
        for (int j = 0; j < 8; j++) spw[i][j] <= 16'd0;
      lgrp <= 5'd0; lcap <= 1'b0; lrow <= 5'd0;
      for (int i = 0; i < NSPR; i++) begin
        spx0_bits[i*11 +: 11] <= 11'd0;
        spon_bits[i] <= 1'b0; spbh_bits[i] <= 1'b0; sphf_bits[i] <= 1'b0;
      end
    end else begin
      case (lstate)
        L_IDLE: if (rx == 12'(H_ACTIVE)) begin
          lline  <= ry_next + 10'd1;
          lspr   <= 3'd0;
          lstate <= L_SPR;
        end
        L_SPR: begin
          lgrp <= {sprite_page, loam0[12:10]};
          if (!loam1[10] || (lline < loam1[9:0]) ||
              ((lline - loam1[9:0]) >= 10'd32)) begin
            spon_bits[lspr] <= 1'b0;
            lcap       <= 1'b0;
            lstate     <= L_CAP;          // lw is don't-care in this path
          end else begin
            spon_bits[lspr]  <= 1'b1;
            lcap        <= 1'b1;
            // Bias by +32; a negative x is x-1024+32 = x-992.
            spx0_bits[lspr*11 +: 11] <= loam1[11]
              ? ({1'b0, loam0[9:0]} - 11'd992)
              : ({1'b0, loam0[9:0]} + 11'd32);
            spbh_bits[lspr]  <= loam0[15];
            sphf_bits[lspr]  <= loam0[13];
            lrow        <= loam0[14] ? (5'd31 - 5'(lline - loam1[9:0]))
                                     : 5'(lline - loam1[9:0]);
            lw          <= 4'd0;
            lstate      <= L_REQ;
          end
        end
        L_REQ: lstate <= L_CAP;
        L_CAP: begin
          if (lcap) begin
            // One 16-bit word per pattern fetch: the loader writes the
            // selected word, the compositor reads all eight through a mux.
            spw[lspr][lw[2:0]] <= spr_q;
            if (lw == 4'd7) begin
              if (lspr == 3'(NSPR-1)) lstate <= L_IDLE;
              else begin lspr <= lspr + 3'd1; lstate <= L_SPR; end
            end else begin
              lw     <= lw + 4'd1;
              lstate <= L_REQ;
            end
          end else begin
            if (lspr == 3'(NSPR-1)) lstate <= L_IDLE;
            else begin lspr <= lspr + 3'd1; lstate <= L_SPR; end
          end
        end
        default: lstate <= L_IDLE;
      endcase
    end
  end

  // =====================================================================
  // Scan path: 1280x720p60, each source pixel and line repeated 2x2
  // =====================================================================
  logic [11:0] sx;
  logic [9:0]  sy;
  logic [1:0]  rd_buf;
  logic [9:0]  src_x;        // next source pixel to read; display is one behind
  logic [7:0]  pix_hold;     // doubled output pixel
  logic [2:0]  tail;         // last pixels of the line, registered
  logic        started;
  logic        line_valid;
  logic [2:0]  ready_seen;
  logic        frame_seen;
  logic [2:0]  ready_s0, ready_s1;
  logic        frame_s0, frame_s1;

  wire scan_line_end = (sx == 12'(O_H_TOTAL - 1));
  wire [9:0] sy_next = (sy == 10'(O_V_TOTAL - 1)) ? 10'd0 : sy + 10'd1;
  wire [1:0] next_buf = (rd_buf == 2'd2) ? 2'd0 : rd_buf + 2'd1;
  wire next_line = (sy == 10'(O_V_TOTAL - 1)) ||
                   (((sy + 10'd1) < 10'(O_V_ACTIVE)) && !sy_next[0]);
  wire preload = tail[1] | tail[2];
  wire [1:0] scan_buf = preload ? next_buf : rd_buf;

  always_ff @(posedge clk_pixel) begin
    if (rst_pixel) tail <= 3'b0;
    else tail <= {tail[1:0], (sx == 12'(O_H_TOTAL - 4))};
  end

  always_ff @(posedge clk_pixel) begin
    if (rst_pixel) begin
      ready_s0 <= 3'b0; ready_s1 <= 3'b0;
      frame_s0 <= 1'b0; frame_s1 <= 1'b0;
    end else begin
      ready_s0 <= ready_toggle; ready_s1 <= ready_s0;
      frame_s0 <= frame_toggle; frame_s1 <= frame_s0;
    end
  end

  assign lb_raddr = (!started) ? 12'd0 : {scan_buf, src_x};

  always_ff @(posedge clk_pixel) begin
    if (rst_pixel) begin
      sx <= 12'd0;
      sy <= 10'd0;
      rd_buf <= 2'd0;
      src_x <= 10'd1;
      pix_hold <= 8'd0;
      started <= 1'b0;
      line_valid <= 1'b0;
      ready_seen <= 3'b0;
      frame_seen <= 1'b0;
      free_toggle <= 3'b111;
    end else if (!started) begin
      // Wait for line 0 and the render frame boundary. Address 0 has been
      // standing for a while, so lb_q already holds source pixel 0.
      if ((ready_s1[0] != ready_seen[0]) && (frame_s1 != frame_seen)) begin
        started <= 1'b1;
        ready_seen[0] <= ready_s1[0];
        frame_seen <= frame_s1;
        line_valid <= 1'b1;
        pix_hold <= lb_q;
        src_x <= 10'd1;
      end
    end else if (!scan_line_end) begin
      sx <= sx + 12'd1;
      if (tail[0]) begin
        src_x <= 10'd0;       // preload the next line's source 0
      end else if (sx[0]) begin
        pix_hold <= lb_q;     // hold this source pixel for the next two outputs
        src_x <= src_x + 10'd1;
      end
    end else begin
      sx <= 12'd0;
      sy <= sy_next;
      pix_hold <= lb_q;       // source 0 of the next line
      src_x <= 10'd1;

      // The current source line was shown twice: release its buffer.
      if (sy[0] && (sy < 10'(O_V_ACTIVE)))
        free_toggle[rd_buf] <= ~free_toggle[rd_buf];

      // At the end of a line pair, latch the next source line's buffer.
      if (next_line) begin
        rd_buf <= next_buf;
        if (ready_s1[next_buf] != ready_seen[next_buf]) begin
          ready_seen[next_buf] <= ready_s1[next_buf];
          line_valid <= 1'b1;
        end else begin
          line_valid <= 1'b0;
        end
      end
    end
  end

  assign de    = started && (sx < 12'(O_H_ACTIVE)) && (sy < 10'(O_V_ACTIVE)) && line_valid;
  assign hsync = ~(sx >= 12'(O_H_ACTIVE + O_H_FRONT) &&
                   sx < 12'(O_H_ACTIVE + O_H_FRONT + O_H_SYNC));
  assign vsync = ~(sy >= 10'(O_V_ACTIVE + O_V_FRONT) &&
                   sy <  10'(O_V_ACTIVE + O_V_FRONT + O_V_SYNC));

  // CPU-visible timing. vblank is a level (30 output lines); frame_tick is a
  // one-bit toggle at the end of every output frame. Both are registered in
  // the scan domain and crossed to the CPU by the board's 2FF synchronisers.
  logic vblank_r;
  logic frame_tick_r;
  always_ff @(posedge clk_pixel) begin
    if (rst_pixel) begin
      vblank_r <= 1'b0;
      frame_tick_r <= 1'b0;
    end else begin
      vblank_r <= started && (sy >= 10'(O_V_ACTIVE));
      if (scan_line_end && (sy == 10'(O_V_TOTAL - 1)))
        frame_tick_r <= ~frame_tick_r;
    end
  end
  assign vblank     = vblank_r;
  assign frame_tick = frame_tick_r;

  wire [7:0] pix = line_valid ? pix_hold : 8'h00;
  assign red   = {pix[7:5], pix[7:5], pix[6:5]};
  assign green = {pix[4:2], pix[4:2], pix[3:2]};
  assign blue  = {pix[1:0], pix[1:0], pix[1:0], pix[1:0]};

endmodule
