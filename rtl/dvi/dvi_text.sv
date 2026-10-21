// dvi_text - a character terminal mirrored onto 640x480@60 DVI.
//
// The CPU's serial console is the only console on the D16MINI board. This
// module listens to `uart_txd` at 115200 and keeps an 80x24 cell image of what
// the terminal shows, then scans it out as black-and-white pixels. It needs no
// kernel support and no PSRAM traffic: the image is 960 words (two chars per
// word) and the 8x15 font is 768 words, two BSRAM blocks in total.
//
// Geometry: 80 x 24 cells of 8 x 15 = 640 x 360, centred vertically in the
// 640 x 480 active area (60 lines of border above and below). One cell pair
// (two characters) takes 16 pixels; the renderer prefetches the next pair and
// both font rows during the pair it is displaying, and pair 0 of the next line
// during horizontal blanking. A cell pair needs three BSRAM reads (the pair and
// two font rows) in 16 pixel clocks.
//
// The parser handles what the UART BIOS emits: CR, LF, BS, printable ASCII,
// ESC[H (home), ESC[r;cH (cursor), ESC[2J/3J (clear), ESC[K (erase line), SGR
// (ignored), and the ?1049 alternate-screen requests (clear + home). Scrolling
// is deferred to vertical blanking, where the renderer is idle.
module dvi_text #(
  parameter int H_ACTIVE = 640,
  parameter int H_FRONT  = 16,
  parameter int H_SYNC   = 96,
  parameter int H_BACK   = 48,
  parameter int V_ACTIVE = 480,
  parameter int V_FRONT  = 10,
  parameter int V_SYNC   = 2,
  parameter int V_BACK   = 33,
  parameter int COLS     = 80,
  parameter int ROWS     = 24,
  parameter int CELL_H   = 15,
  parameter int TOP      = 60
) (
  input  logic       clk,       // 25.2 MHz pixel clock
  input  logic       rst,
  input  logic       uart_rx,   // the CPU's uart_txd, 115200 8N1
  output logic [7:0] red,
  output logic [7:0] green,
  output logic [7:0] blue,
  output logic       hsync,
  output logic       vsync,
  output logic       de
);
  localparam int H_TOTAL  = H_ACTIVE + H_FRONT + H_SYNC + H_BACK;  // 800
  localparam int V_TOTAL  = V_ACTIVE + V_FRONT + V_SYNC + V_BACK;  // 525
  localparam int TEXT_H   = ROWS * CELL_H;                         // 360
  localparam int TEXT_END = TOP + TEXT_H;                          // 420

  // ---- sync generation ---------------------------------------------------
  logic [9:0] x, y;
  wire line_end = (x == 10'(H_TOTAL - 1));
  wire [9:0] y_next = (y == 10'(V_TOTAL - 1)) ? 10'd0 : y + 10'd1;

  always_ff @(posedge clk) begin
    if (rst) begin
      x <= 10'd0;
      y <= 10'd0;
    end else begin
      x <= line_end ? 10'd0 : x + 10'd1;
      if (line_end) y <= y_next;
    end
  end

  assign de    = (x < 10'(H_ACTIVE)) && (y < 10'(V_ACTIVE));
  assign hsync = ~(x >= 10'(H_ACTIVE + H_FRONT) &&
                   x <  10'(H_ACTIVE + H_FRONT + H_SYNC));   // negative polarity
  assign vsync = ~(y >= 10'(V_ACTIVE + V_FRONT) &&
                   y <  10'(V_ACTIVE + V_FRONT + V_SYNC));

  wire active_x   = (x < 10'(H_ACTIVE));
  wire [3:0] phase = x[3:0];
  wire [5:0] pair  = x[9:4];
  wire in_text    = (y >= 10'(TOP)) && (y < 10'(TEXT_END)) && active_x;

  // ---- text row / glyph row, advanced at the end of each line -----------
  logic [4:0] ty;
  logic [3:0] gy;
  wire next_is_text = (y_next >= 10'(TOP)) && (y_next < 10'(TEXT_END));
  wire [4:0] next_ty = (y_next == 10'(TOP)) ? 5'd0
                     : ty + ((gy == 4'(CELL_H - 1)) ? 5'd1 : 5'd0);
  wire [3:0] next_gy = (y_next == 10'(TOP)) ? 4'd0
                     : ((gy == 4'(CELL_H - 1)) ? 4'd0 : gy + 4'd1);

  always_ff @(posedge clk) begin
    if (rst) begin
      ty <= 5'd0;
      gy <= 4'd0;
    end else if (line_end && next_is_text) begin
      ty <= next_ty;
      gy <= next_gy;
    end
  end

  // ---- cell and font memories -------------------------------------------
  localparam int CELL_WORDS = (COLS * ROWS) / 2;    // 960
  localparam int FONT_WORDS = 96 * 8;               // 768 (two rows per word)

  logic [15:0] cells [0:CELL_WORDS-1];
  logic [15:0] font  [0:FONT_WORDS-1];

  initial $readmemh("font8x15.hex", font);

  logic [9:0]  rd_addr;
  logic [15:0] cell_q;
  logic [9:0]  font_addr;
  logic [15:0] font_q;

  logic        cell_we;
  logic [9:0]  cell_waddr;
  logic [1:0]  cell_wmask;
  logic [15:0] cell_wdata;

  always_ff @(posedge clk) begin
    if (cell_we) begin
      if (cell_wmask[0]) cells[cell_waddr][7:0]  <= cell_wdata[7:0];
      if (cell_wmask[1]) cells[cell_waddr][15:8] <= cell_wdata[15:8];
    end
    cell_q <= cells[rd_addr];
    font_q <= font[font_addr];
  end

  // ---- renderer pipeline -------------------------------------------------
  logic [7:0] char_even_next, char_odd_next;
  logic [7:0] glyph_even_next, glyph_odd_next;
  logic [7:0] glyph_even_cur,  glyph_odd_cur;
  logic       pf_ready;

  // The 24 text rows are a circular buffer: scrolling only moves row_off and
  // clears one row. Copying 960 words was both slow and unsafe - the UART kept
  // writing to the old bottom row while the copy waited for vertical blanking,
  // which is what overwrote " ok" with the prompt.
  logic [4:0] row_off;
  wire [5:0] scan_sum   = {1'b0, ty} + {1'b0, row_off};
  wire [5:0] nscan_sum  = {1'b0, next_ty} + {1'b0, row_off};
  wire [5:0] term_sum   = {1'b0, cur_row} + {1'b0, row_off};
  // 5-bit subtraction is modulo 32, which is exactly what the 6-bit sum needs:
  // for 24..46 it wraps 0..22, and below 24 the value is already in range.
  wire [4:0] scan_row   = (scan_sum  >= 6'd24) ? (scan_sum[4:0]  - 5'd24) : scan_sum[4:0];
  wire [4:0] nscan_row  = (nscan_sum >= 6'd24) ? (nscan_sum[4:0] - 5'd24) : nscan_sum[4:0];
  wire [4:0] term_row   = (term_sum  >= 6'd24) ? (term_sum[4:0]  - 5'd24) : term_sum[4:0];
  wire [9:0] row_base      = 10'(scan_row) * 10'd40;
  wire [9:0] pf_row_base   = 10'(nscan_row) * 10'd40;
  wire [9:0] cur_row_base  = 10'(term_row) * 10'd40;  // terminal writes
  wire [7:0] pf = 8'(x - 10'(H_ACTIVE));   // 0..159 during the blank

  // Font word for a character at the current glyph row: glyphs are 96 x 15,
  // stored two rows per word so the whole font is one BSRAM block.
  function automatic logic [9:0] font_word(input logic [7:0] ch,
                                            input logic [2:0] row_pair);
    logic [7:0] idx;
    idx = (ch < 8'd32 || ch > 8'd127) ? 8'd32 : ch;
    font_word = (10'(idx - 8'd32) << 3) + 10'(row_pair);
  endfunction

  wire [7:0] glyph_even_sel = gy[0] ? font_q[15:8] : font_q[7:0];
  wire [7:0] glyph_odd_sel  = gy[0] ? font_q[15:8] : font_q[7:0];
  wire [7:0] glyph_even_pf  = next_gy[0] ? font_q[15:8] : font_q[7:0];
  wire [7:0] glyph_odd_pf   = next_gy[0] ? font_q[15:8] : font_q[7:0];

  always_comb begin
    rd_addr = 10'd0;
    if (!active_x) begin
      if (next_is_text && pf == 8'd0) rd_addr = pf_row_base;
    end else if (phase == 4'd1 && pair < 6'd39) begin
      rd_addr = row_base + {4'd0, pair} + 10'd1;
    end
  end

  always_comb begin
    font_addr = 10'd0;
    if (!active_x) begin
      if (next_is_text && pf == 8'd2) font_addr = font_word(char_even_next, next_gy[3:1]);
      else if (next_is_text && pf == 8'd3) font_addr = font_word(char_odd_next, next_gy[3:1]);
    end else if (pair < 6'd39) begin
      if (phase == 4'd3) font_addr = font_word(char_even_next, gy[3:1]);
      else if (phase == 4'd4) font_addr = font_word(char_odd_next, gy[3:1]);
    end
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      char_even_next <= 8'd32; char_odd_next <= 8'd32;
      glyph_even_next <= 8'd0; glyph_odd_next <= 8'd0;
      glyph_even_cur  <= 8'd0; glyph_odd_cur  <= 8'd0;
      pf_ready <= 1'b0;
    end else begin
      if (!active_x) begin
        if (next_is_text && pf == 8'd1) begin
          char_even_next <= cell_q[7:0];
          char_odd_next  <= cell_q[15:8];
        end
        if (next_is_text && pf == 8'd3) glyph_even_next <= glyph_even_pf;
        if (next_is_text && pf == 8'd4) glyph_odd_next  <= glyph_odd_pf;
        if (next_is_text && pf == 8'd5) pf_ready <= 1'b1;
      end else if (pair < 6'd39) begin
        if (phase == 4'd2) begin
          char_even_next <= cell_q[7:0];
          char_odd_next  <= cell_q[15:8];
        end
        if (phase == 4'd4) glyph_even_next <= glyph_even_sel;
        if (phase == 4'd5) glyph_odd_next  <= glyph_odd_sel;
        if (phase == 4'd15) begin
          glyph_even_cur <= glyph_even_next;
          glyph_odd_cur  <= glyph_odd_next;
        end
      end

      if (line_end && pf_ready) begin
        glyph_even_cur <= glyph_even_next;
        glyph_odd_cur  <= glyph_odd_next;
        pf_ready <= 1'b0;
      end
    end
  end

  // ---- terminal: UART receiver, ANSI parser, cell writes -----------------
  logic [1:0] rx_sync;
  always_ff @(posedge clk) rx_sync <= {rx_sync[0], uart_rx};
  wire rx_line = rx_sync[1];

  localparam int BIT_CYCLES = 219;       // 25.2 MHz / 115200 = 218.75
  localparam int HALF_BIT   = 109;

  logic [1:0]  rx_state;
  logic [8:0]  rx_cnt;
  logic [2:0]  rx_bit;
  logic [7:0]  rx_shift;
  logic        rx_valid;

  always_ff @(posedge clk) begin
    rx_valid <= 1'b0;
    if (rst) begin
      rx_state <= 2'd0; rx_cnt <= 9'd0; rx_bit <= 3'd0; rx_shift <= 8'd0;
    end else begin
      case (rx_state)
        2'd0: if (!rx_line) begin rx_state <= 2'd1; rx_cnt <= 9'd0; end
        2'd1: if (rx_cnt == 9'(HALF_BIT)) begin
          if (!rx_line) begin rx_state <= 2'd2; rx_cnt <= 9'd0; rx_bit <= 3'd0; end
          else rx_state <= 2'd0;
        end else rx_cnt <= rx_cnt + 9'd1;
        2'd2: if (rx_cnt == 9'(BIT_CYCLES - 1)) begin
          rx_cnt <= 9'd0;
          rx_shift[rx_bit] <= rx_line;
          if (rx_bit == 3'd7) rx_state <= 2'd3;
          else rx_bit <= rx_bit + 3'd1;
        end else rx_cnt <= rx_cnt + 9'd1;
        2'd3: if (rx_cnt == 9'(BIT_CYCLES - 1)) begin
          rx_state <= 2'd0; rx_valid <= 1'b1;
        end else rx_cnt <= rx_cnt + 9'd1;
      endcase
    end
  end

  // A four-byte queue covers a clear or scroll that is still running when the
  // next character arrives (those take ~40-80 us, a character takes 87 us).
  logic [7:0]  fifo [0:3];
  logic [1:0]  fifo_wr, fifo_rd;
  logic [2:0]  fifo_count;

  logic [4:0]  cur_row;
  logic [6:0]  cur_col;
  logic [1:0]  esc_state;
  logic [7:0]  csi_param;
  logic [1:0]  csi_np;
  logic [7:0]  csi_p0, csi_p1;
  logic        csi_priv;

  logic        clear_pending, clear_active;
  logic [9:0]  clear_i;
  logic        row_clear_pending, row_clear_active;
  logic [9:0]  row_clear_base, row_clear_i;
  logic        term_we;
  logic [9:0]  term_waddr;
  logic        term_byte;
  logic [7:0]  term_char;

  wire busy = clear_active || row_clear_active;
  wire pop_now = !busy && (fifo_count != 3'd0);
  wire push_now = rx_valid && (fifo_count != 3'd4);
  wire [7:0] rx_byte = fifo[fifo_rd];

  // One write port for the cell memory: the parser, the clear loop and the
  // scroll loop are mutually exclusive.
  always_comb begin
    cell_we = 1'b0;
    cell_waddr = 10'd0;
    cell_wmask = 2'b00;
    cell_wdata = 16'h0000;
    if (clear_active) begin
      cell_we = 1'b1;
      cell_waddr = clear_i;
      cell_wmask = 2'b11;
      cell_wdata = 16'h2020;
    end else if (row_clear_active) begin
      cell_we = 1'b1;
      cell_waddr = row_clear_base + row_clear_i;
      cell_wmask = 2'b11;
      cell_wdata = 16'h2020;
    end else if (term_we) begin
      cell_we = 1'b1;
      cell_waddr = term_waddr;
      cell_wmask = term_byte ? 2'b10 : 2'b01;
      cell_wdata = {2{term_char}};
    end
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      fifo_wr <= 2'd0; fifo_rd <= 2'd0; fifo_count <= 3'd0;
      cur_row <= 5'd0; cur_col <= 7'd0;
      esc_state <= 2'd0; csi_param <= 8'd0; csi_np <= 2'd0;
      csi_p0 <= 8'd0; csi_p1 <= 8'd0; csi_priv <= 1'b0;
      clear_pending <= 1'b0; clear_active <= 1'b0; clear_i <= 10'd0;
      row_off <= 5'd0;
      row_clear_pending <= 1'b0; row_clear_active <= 1'b0;
      row_clear_base <= 10'd0; row_clear_i <= 10'd0;
      term_we <= 1'b0; term_char <= 8'd32;
      term_waddr <= 10'd0; term_byte <= 1'b0;
    end else begin
      term_we  <= 1'b0;

      if (push_now) begin
        fifo[fifo_wr] <= rx_shift;
        fifo_wr <= fifo_wr + 2'd1;
      end

      // ---- clear ------------------------------------------------------
      if (clear_pending && !clear_active && !row_clear_active) begin
        clear_active <= 1'b1;
        clear_pending <= 1'b0;
        clear_i <= 10'd0;
      end else if (clear_active) begin
        if (clear_i == 10'(CELL_WORDS - 1)) begin
          clear_active <= 1'b0;
          row_off <= 5'd0;
          row_clear_pending <= 1'b0;
          cur_row <= 5'd0;
          cur_col <= 7'd0;
        end else begin
          clear_i <= clear_i + 10'd1;
        end
      end

      // ---- scroll: advance the row offset, clear the new bottom row ----
      if (row_clear_pending && !row_clear_active && !clear_active) begin
        row_clear_active <= 1'b1;
        row_clear_pending <= 1'b0;
        row_clear_i <= 10'd0;
      end else if (row_clear_active) begin
        if (row_clear_i == 10'(COLS / 2 - 1)) row_clear_active <= 1'b0;
        else row_clear_i <= row_clear_i + 10'd1;
      end

      // ---- parser -----------------------------------------------------
      if (pop_now) begin
        fifo_rd <= fifo_rd + 2'd1;

        case (esc_state)
          2'd0: begin
            if (rx_byte == 8'h1B) begin
              esc_state <= 2'd1;
            end else if (rx_byte == 8'h0D) begin
              cur_col <= 7'd0;
            end else if (rx_byte == 8'h0A) begin
              if (cur_row == 5'd23) begin
                row_off <= (row_off == 5'd23) ? 5'd0 : row_off + 5'd1;
                row_clear_pending <= 1'b1;
                row_clear_base <= 10'(row_off) * 10'd40;  // old bottom row
              end else begin
                cur_row <= cur_row + 5'd1;
              end
            end else if (rx_byte == 8'h08) begin
              if (cur_col != 7'd0) begin
                cur_col <= cur_col - 7'd1;
                term_we <= 1'b1;
                term_char <= 8'h20;
                term_waddr <= 10'(cur_row_base + {4'd0, ((cur_col - 7'd1) >> 1)});
                term_byte <= (((cur_col - 7'd1) & 7'd1) != 7'd0);
              end
            end else if (rx_byte >= 8'h20 && rx_byte <= 8'h7E) begin
              term_we <= 1'b1;
              term_char <= rx_byte;
              term_waddr <= cur_row_base + {4'd0, cur_col[6:1]};
              term_byte <= cur_col[0];
              if (cur_col < 7'd79) cur_col <= cur_col + 7'd1;
            end
          end
          2'd1: begin
            if (rx_byte == 8'h5B) begin
              esc_state <= 2'd2;
              csi_param <= 8'd0; csi_np <= 2'd0;
              csi_p0 <= 8'd0; csi_p1 <= 8'd0; csi_priv <= 1'b0;
            end else begin
              esc_state <= 2'd0;
            end
          end
          default: begin
            if (rx_byte >= 8'h30 && rx_byte <= 8'h39) begin
              if (csi_param <= 8'd200) csi_param <= csi_param * 8'd10 + (rx_byte - 8'h30);
            end else if (rx_byte == 8'h3B) begin
              if (csi_np == 2'd0) csi_p0 <= csi_param;
              else if (csi_np == 2'd1) csi_p1 <= csi_param;
              if (csi_np != 2'd2) csi_np <= csi_np + 2'd1;
              csi_param <= 8'd0;
            end else if (rx_byte == 8'h3F) begin
              csi_priv <= 1'b1;
            end else begin
              // final byte of the sequence
              case (rx_byte)
                8'h48, 8'h66: begin       // H / f: cursor position
                  logic [7:0] rowp, colp;
                  rowp = (csi_np >= 2'd1) ? csi_p0 : csi_param;
                  colp = (csi_np >= 2'd2) ? csi_p1
                       : (csi_np == 2'd1) ? csi_param : 8'd1;
                  cur_row <= (rowp <= 8'd1) ? 5'd0
                           : (rowp > 8'd24) ? 5'd23 : rowp[4:0] - 5'd1;
                  cur_col <= (colp <= 8'd1) ? 7'd0
                           : (colp > 8'd80) ? 7'd79 : colp[6:0] - 7'd1;
                end
                8'h4A: begin               // J: erase display
                  clear_pending <= 1'b1;
                end
                8'h4B: ;                    // K: not used by the kernel
                8'h6D: ;                    // m: SGR, ignored in B/W
                8'h68, 8'h6C: begin         // h / l: private modes
                  if (csi_priv) clear_pending <= 1'b1;
                end
                default: ;
              endcase
              esc_state <= 2'd0;
            end
          end
        endcase
      end

      // The queue count is updated once, from the push and pop conditions.
      fifo_count <= fifo_count + (push_now ? 3'd1 : 3'd0)
                                 - (pop_now  ? 3'd1 : 3'd0);
    end
  end

  // ---- pixels ------------------------------------------------------------
  logic [23:0] blink;
  always_ff @(posedge clk) begin
    if (rst) blink <= 24'd0;
    else blink <= blink + 24'd1;
  end
  wire cursor_on = blink[23];

  wire [7:0] glyph_out = phase[3] ? glyph_odd_cur : glyph_even_cur;
  wire       glyph_bit = glyph_out[3'd7 - phase[2:0]];
  wire [6:0] col_now   = x[9:3];
  wire       cursor_here = in_text && (ty == cur_row) && (col_now == cur_col) && cursor_on;
  wire       pixel = in_text ? (glyph_bit ^ cursor_here) : 1'b0;

  assign red   = pixel ? 8'hFF : 8'h00;
  assign green = pixel ? 8'hFF : 8'h00;
  assign blue  = pixel ? 8'hFF : 8'h00;

endmodule
