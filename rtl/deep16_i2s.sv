// deep16_i2s.sv - I2S output at 0xF00A0.
//
// A 128-sample FIFO feeds a standard I2S serialiser: BCLK = clk / 10 = 675 kHz,
// LRCLK = BCLK / 32 = 21.09375 kHz at the board's 6.75 MHz CPU clock.  The
// MAX98357A needs only BCLK, LRCLK and DIN (no MCLK).
//
//   0xA0 DATA    W  push a signed 16-bit sample; read the level (0..128)
//   0xA2 CTRL    W  b0 enable, b1 reset (self-clearing), b2 loop,
//                   b3 irq enable
//   0xA4 STATUS  R  b0 empty, b1 full, b2 low, b3 underrun, b4 running,
//                   b5 irq
//
// The FIFO is a plain array with one write port and one registered read port;
// the synthesiser maps it to one BSRAM slice.  The read pointer advances on the
// left-channel boundary, one sample per frame, and the right channel repeats the
// same sample (mono).
//
// I2S framing: LRCLK changes at bit 0/16 and the bit on that edge is the
// previous channel's LSB (the receiver ignores it); the MSB follows one BCLK
// later.
module deep16_i2s #(
  parameter int FIFO_DEPTH = 128
) (
  input  logic        clk,
  input  logic        rst,
  input  logic        we,
  input  logic [3:0]  addr,
  input  logic [15:0] wdata,
  output logic [15:0] rdata,
  output logic        bclk,
  output logic        lrclk,
  output logic        din,
  output logic        fifo_irq
);
  localparam int AW = $clog2(FIFO_DEPTH);
  localparam int LW = $clog2(FIFO_DEPTH + 1);

  logic [15:0] fifo [0:FIFO_DEPTH-1];
  logic [AW-1:0] wr_ptr, rd_ptr;
  logic          full;
  logic [15:0]   fifo_rdata;

  logic enable, irq_en, loop;
  logic underrun;

  logic [3:0]  div_cnt;      // 0..9
  logic        bclk_r, lrclk_r, din_r;
  logic [4:0]  bit_cnt;      // 0..31
  logic [15:0] shift, sample_hold;
  logic        enable_q, left_pending;

  wire        bclk_half = (div_cnt <= 4'd4);
  wire        edge_fall = (div_cnt == 4'd9);
  wire        left_start = (bit_cnt == 5'd0);
  wire        right_start = (bit_cnt == 5'd16);
  wire        empty = (wr_ptr == rd_ptr) && !full;
  wire [AW-1:0] used = wr_ptr - rd_ptr;
  wire [LW-1:0] level = full ? LW'(FIFO_DEPTH) : LW'(used);
  wire        low   = (level <= LW'(32));
  wire        pop   = enable && edge_fall && left_start;
  wire        reset_fifo = we && (addr == 4'h2) && wdata[1];

  // ---- FIFO -------------------------------------------------------------
  always_ff @(posedge clk) begin
    if (we && addr == 4'h0 && !full) fifo[wr_ptr] <= wdata;
  end

  always_ff @(posedge clk) begin
    if (pop) fifo_rdata <= fifo[rd_ptr];
  end

  always_ff @(posedge clk) begin
    if (rst || reset_fifo) begin
      wr_ptr   <= '0;
      rd_ptr   <= '0;
      full     <= 1'b0;
      underrun <= 1'b0;
      if (rst) begin
        enable <= 1'b0;
        irq_en <= 1'b0;
        loop   <= 1'b0;
      end
    end else begin
      if (we && addr == 4'h0 && !full) begin
        wr_ptr <= wr_ptr + 1'b1;
        full   <= (wr_ptr + 1'b1 == rd_ptr);
      end
      if (pop) begin
        if (!empty) begin
          rd_ptr <= rd_ptr + 1'b1;
          full   <= 1'b0;
        end else if (loop) begin
          // The buffer is the whole FIFO: a full fill left wr_ptr at 0.
          rd_ptr <= '0;
          full   <= 1'b1;
        end else begin
          underrun <= 1'b1;
        end
      end
      if (we) begin
        case (addr)
          4'h2: begin
            enable <= wdata[0];
            irq_en <= wdata[3];
            loop   <= wdata[2];
            if (wdata[1]) underrun <= 1'b0;
          end
          default: ;
        endcase
      end
    end
  end

  assign fifo_irq = enable && irq_en && low;

  // ---- I2S serialiser ---------------------------------------------------
  always_ff @(posedge clk) begin
    if (rst) begin
      div_cnt <= 4'd0;
      bit_cnt <= 5'd0;
      bclk_r  <= 1'b0;
      lrclk_r <= 1'b0;
      din_r   <= 1'b0;
      shift   <= 16'h0000;
      sample_hold <= 16'h0000;
      enable_q    <= 1'b0;
      left_pending <= 1'b0;
    end else begin
      enable_q <= enable;
      if (!enable) begin
        div_cnt <= 4'd0;
        bit_cnt <= 5'd0;
        bclk_r  <= 1'b0;
        lrclk_r <= 1'b0;
        din_r   <= 1'b0;
        shift   <= 16'h0000;
      end else begin
        bclk_r <= bclk_half;
        if (!enable_q) div_cnt <= 4'd0;
        else if (edge_fall) div_cnt <= 4'd0;
        else                div_cnt <= div_cnt + 4'd1;

        if (left_pending) begin
          shift        <= fifo_rdata;
          sample_hold  <= fifo_rdata;
          left_pending <= 1'b0;
        end

        if (edge_fall) begin
          din_r <= shift[15];
          if (left_start) begin
            lrclk_r <= 1'b0;
            if (empty) begin
              shift       <= 16'h0000;
              sample_hold <= 16'h0000;
            end else begin
              left_pending <= 1'b1;   // fifo_rdata lands next cycle
            end
          end else if (right_start) begin
            lrclk_r <= 1'b1;
            shift   <= sample_hold;
          end else begin
            shift <= {shift[14:0], 1'b0};
          end
          bit_cnt <= (bit_cnt == 5'd31) ? 5'd0 : bit_cnt + 1'b1;
        end
      end
    end
  end

  assign bclk  = bclk_r;
  assign lrclk = lrclk_r;
  assign din   = din_r;

  always_comb begin
    case (addr)
      4'h0: rdata = {{(16-LW){1'b0}}, level};
      4'h4: rdata = {10'b0, fifo_irq, enable, underrun, low, full, empty};
      default: rdata = 16'h0000;
    endcase
  end

endmodule
