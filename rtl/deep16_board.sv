// deep16_board.sv - Tang Nano 9K wrapper for D16MINI (D16MINI.md §4.5).
//
// The whole board: a 27 MHz oscillator, one reset button, the UART pins of the
// on-board USB bridge, and an LED. No PLL, no PSRAM, no framebuffer - the
// console is the UART and a host terminal owns the screen.
//
// The CPU does not meet 27 MHz (D16MINI.md §4.7: ~10.6 MHz worst case), so the
// oscillator is divided by four and the whole machine runs at 6.75 MHz, which
// closes timing with margin. The divider is a two-bit counter on the 27 MHz
// clock; the UART is told the divided frequency so 115200 stays correct.
//
// Everything simulation-shaped is tied off here: i_step/i_free free-run, the
// keyboard FIFO is empty and dead, the debug bus is off, and there is no cache
// to manage. The memory comes from the boot image baked into the bitstream
// (§6.2.1), so the CPU starts on the kernel with no loader and no copy.
//
// Build with `-DD16MINI` (Verilator) / the matching project define (Gowin): it
// is what shrinks deep16_top's memory to the 24 BSRAM blocks and turns on the
// window decode.
module deep16_board (
  input  logic clk,        // 27 MHz oscillator, pin 52
  input  logic rst_n,      // S1 button, active low
  input  logic uart_rxd,   // from the on-board USB-UART bridge
  output logic uart_txd,   // to the on-board USB-UART bridge
  output logic led         // heartbeat: a live board is visibly alive
);

  // ---- clock: 27 MHz / 4 = 6.75 MHz ------------------------------------
  // clk_div[1] is 6.75 MHz at 50 % duty. The machine measures ~10.0 MHz worst
  // case (D16MINI.md §4.7), so this leaves ~49 % margin. The divider is the
  // only logic in the 27 MHz domain; the UART is told the divided frequency.
  logic [1:0] clk_div;
  logic       clk_cpu;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) clk_div <= 2'd0;
    else        clk_div <= clk_div + 2'd1;
  end
  assign clk_cpu = clk_div[1];

  // ---- reset -----------------------------------------------------------
  // The button is asynchronous. Register it in the CPU clock domain, then hold
  // reset for a few CPU clocks after it is released, so the pipeline starts
  // from a settled state.
  localparam int unsigned RESET_CYCLES = 16;

  logic [3:0]  rst_sync;
  logic [15:0] rst_hold;
  logic        rst;

  always_ff @(posedge clk_cpu or negedge rst_n) begin
    if (!rst_n) begin
      rst_sync <= 4'b0000;
      rst_hold <= RESET_CYCLES[15:0];
    end else begin
      rst_sync <= {rst_sync[2:0], 1'b1};
      if (rst_sync != 4'hF)          rst_hold <= RESET_CYCLES[15:0];
      else if (rst_hold != 16'd0)    rst_hold <= rst_hold - 16'd1;
    end
  end
  assign rst = (rst_hold != 16'd0);

  // ---- the machine -----------------------------------------------------
  logic        o_done, o_result, o_busy;
  logic [31:0] cache_hits, cache_misses, cache_penalty;
  logic [15:0] tx_data_out, tx_avail, rx_avail, dbg_rdata;

  deep16_top u_top (
    .clk  (clk_cpu),
    .rst  (rst),

    // free-run: one retired instruction after another, no step handshake
    .i_step   (1'b1),
    .i_free   (1'b1),
    .o_done   (o_done),
    .o_result (o_result),
    .o_busy   (o_busy),

    // no keyboard: the console is the UART, the screen ports are dead (§5)
    .kbd_push      (1'b0),
    .kbd_push_data (16'h0000),
    .kbd_clear     (1'b0),

    // the console is the pins; the host push/take path is a simulation facility
    .uart_rx_push       (1'b0),
    .uart_rx_push_data  (16'h0000),
    .uart_tx_take       (1'b0),
    .uart_host_ctrl_we  (1'b0),
    .uart_host_ctrl_data(16'h0000),
    .uart_tx_data_out   (tx_data_out),
    .uart_tx_avail      (tx_avail),
    .uart_rx_avail      (rx_avail),
    .uart_txd           (uart_txd),
    .uart_rxd           (uart_rxd),

    // no debug bus, no cache management on the board
    .dbg_en    (1'b0),
    .dbg_we    (1'b0),
    .dbg_idx   (8'h00),
    .dbg_wdata (16'h0000),
    .dbg_rdata (dbg_rdata),
    .i_cache_flush   (1'b0),
    .i_cache_inv     (1'b0),
    .i_cache_inv_line(8'h00),
    .o_cache_hits    (cache_hits),
    .o_cache_misses  (cache_misses),
    .o_cache_penalty (cache_penalty)
  );

  // ---- heartbeat -------------------------------------------------------
  // The top bit of a free-running counter: ~0.8 Hz, so a powered board blinks
  // without a scope. The CPU has no observable "alive" pin of its own.
  logic [24:0] hb;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) hb <= 25'd0;
    else        hb <= hb + 25'd1;
  end
  assign led = hb[24];

  // The board reads the console from the pin and has no debug bus or cache, so
  // these are deliberately unread.
  /* verilator lint_off UNUSEDSIGNAL */
  logic _unused;
  assign _unused = &{1'b0, o_done, o_result, o_busy, cache_hits, cache_misses,
                     cache_penalty, tx_data_out, tx_avail, rx_avail, dbg_rdata};
  /* verilator lint_on UNUSEDSIGNAL */

endmodule
