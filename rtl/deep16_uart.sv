// deep16_uart.sv - the console UART for the FPGA build (D16MINI.md §4.4).
//
// A byte pipe: an 8N1 transmitter with a FIFO, an 8N1 receiver with a FIFO and
// an overrun flag, and the memory-mapped registers the CPU sees at ES:0x0040
// (status), 0x0042 (data), 0x0044 (divisor) and 0x0046 (control). The baud
// divisor comes from the clock, so no external clock is needed.
//
// The receiver is fed from the `rxd` pin; `rx_push`/`rx_push_data` is a second
// door for the host - the IDE and the tests inject bytes there instead of
// bit-banging the line at 115200.
/* verilator lint_off UNUSEDSIGNAL */   // the CPU bus is 16-bit; only the low
                                        // byte of the data ports is meaningful
module deep16_uart #(
  parameter int CLK_HZ   = 27_000_000,
  parameter int BAUD     = 115200,
  parameter int TX_DEPTH = 64,
  parameter int RX_DEPTH = 64,
  parameter bit RX_ONLY  = 1'b0
) (
  input  logic        clk,
  input  logic        rst,

  // CPU side: one-cycle strobes in, registers out.
  input  logic        tx_we,        // push tx_data
  input  logic [15:0] tx_data,
  input  logic        rx_take,      // pop the RX FIFO
  input  logic        ctrl_we,      // b0 reset RX, b1 reset TX
  input  logic [15:0] ctrl_data,
  output logic [15:0] status,
  output logic [15:0] rx_data,

  // Host side: inject a byte without touching the line.
  input  logic        rx_push,
  input  logic [15:0] rx_push_data,

  // Counts, for the harness / IDE.
  output logic [15:0] tx_count_o,
  output logic [15:0] rx_count_o,

  // Pins.
  output logic        uart_txd,
  input  logic        uart_rxd
);

  localparam int DIV = (CLK_HZ + BAUD / 2) / BAUD;   // 27 MHz / 115200 = 234
  // A one-entry TX FIFO has no index bits; the function returns 0 there and
  // the normal bit slice otherwise. A bare 6-bit index into a [0:0] array is
  // rejected by Verilator -Wall (and would index out of range at runtime).
  localparam int TX_AW = (TX_DEPTH > 1) ? $clog2(TX_DEPTH) : 1;
  function automatic integer tx_idx(input logic [6:0] p);
    tx_idx = (TX_DEPTH > 1) ? int'(p[TX_AW-1:0]) : 0;
  endfunction

  // ---- transmitter -------------------------------------------------------
  logic [7:0]  tx_mem [0:TX_DEPTH-1];
  logic [6:0]  tx_head, tx_tail, tx_count;   // TX_DEPTH = 64 -> 7 bits
  logic [9:0]  tx_shift;                     // {stop, data[7:0], start}
  logic [15:0] tx_timer;
  logic [3:0]  tx_bit;
  logic        tx_busy;

  // ---- receiver ----------------------------------------------------------
  logic [7:0]  rx_mem [0:RX_DEPTH-1];
  logic [7:0]  rx_head, rx_tail, rx_count;
  localparam int RX_AW = $clog2(RX_DEPTH);   // 64 entries -> 6 index bits
  logic [7:0]  rx_shift;
  logic [15:0] rx_timer;
  logic [3:0]  rx_bit;
  logic        rx_busy;
  logic        rx_overrun;

  // ---- divisor / control -------------------------------------------------
  logic [15:0] div_reg;

  // ---- input synchroniser ------------------------------------------------
  // uart_rxd comes from the USB-UART bridge and is asynchronous to clk. The
  // receiver's start-edge detector looks at it every cycle, so one metastable
  // sample can start a frame late (or abort a real one) and the byte comes out
  // with several bits wrong - the "sometimes the echo is mangled" report.
  // Two flops, and the state machine uses only the synchronised copy.
  logic rxd_meta, rxd_sync;
  always_ff @(posedge clk) begin
    if (rst) begin rxd_meta <= 1'b1; rxd_sync <= 1'b1; end
    else begin rxd_meta <= uart_rxd; rxd_sync <= rxd_meta; end
  end

  // FIFO events, one cycle ahead of the registers: the CPU can push while the
  // shifter pops, and the count has to reflect both. Two non-blocking
  // assignments to tx_count in one always_ff would lose one of them - the
  // count under-reports occupancy, the ring wraps and queued bytes are
  // overwritten. That only shows under load: an 80x24 memory map is enough.
  wire tx_push = !RX_ONLY && tx_we && (tx_count != TX_DEPTH[6:0]);
  wire tx_pop  = !RX_ONLY && !tx_busy && (tx_count != 7'd0);
  wire tx_reset = ctrl_we && ctrl_data[1];
  // The same for RX: a byte can be popped by the CPU in the cycle another one
  // arrives from the line (or the host), and one lost count is enough to wrap
  // the ring under a paste.
  wire rx_pop  = rx_take && (rx_count != 8'd0);
  wire rx_stop = rx_busy && (rx_timer == div_reg - 16'd1) && (rx_bit > 4'd8);
  // Count only what actually enters: rx_enqueue drops a byte when the FIFO is
  // full, and counting that one anyway left rx_count above the depth with the
  // head and tail out of step - every later read then returned the wrong slot,
  // which shows up as mangled input after a paste or typing during boot.
  wire rx_enq  = (rx_push || rx_stop) && (rx_count != RX_DEPTH[7:0]);
  wire rx_reset = ctrl_we && ctrl_data[0];

  // One write port. The line receiver and the host injection used to be two
  // rx_enqueue call sites, which is two write ports to the same array - a RAM
  // has one, so the synthesiser gave up and built 128 x 8 out of 1,024
  // flip-flops instead of 16 RAM16 primitives. Muxing the two sources before
  // the write lets it infer SSRAM.
  wire        rx_wr    = (rx_push || rx_stop) && (rx_count != RX_DEPTH[7:0]);
  wire [7:0]  rx_wdata = rx_push ? rx_push_data[7:0] : rx_shift;

  always_ff @(posedge clk) begin
    if (rst) begin
      tx_head <= 7'd0; tx_tail <= 7'd0; tx_count <= 7'd0;
      tx_shift <= 10'd0; tx_timer <= 16'd0; tx_bit <= 4'd0; tx_busy <= 1'b0;
      rx_head <= 8'd0; rx_tail <= 8'd0; rx_count <= 8'd0;
      rx_shift <= 8'd0; rx_timer <= 16'd0; rx_bit <= 4'd0; rx_busy <= 1'b0;
      rx_overrun <= 1'b0;
      div_reg <= DIV[15:0];
      uart_txd <= 1'b1;
    end else begin
      // ---- control ----
      if (ctrl_we) begin
        if (ctrl_data[0]) begin rx_head <= 8'd0; rx_tail <= 8'd0; rx_count <= 8'd0; rx_overrun <= 1'b0; end
        if (ctrl_data[1]) begin tx_head <= 7'd0; tx_tail <= 7'd0; tx_count <= 7'd0; end
      end

      // ---- TX push ----
      if (!RX_ONLY && tx_push) begin
        tx_mem[tx_idx(tx_tail)] <= tx_data[7:0];
        tx_tail  <= tx_tail + 7'd1;
      end

      // ---- TX shift engine ----
      if (RX_ONLY) begin
        uart_txd <= 1'b1;
      end else if (tx_busy) begin
        if (tx_timer == div_reg - 16'd1) begin
          tx_timer <= 16'd0;
          if (tx_bit == 4'd9) begin
            tx_busy <= 1'b0;
            uart_txd <= 1'b1;                 // idle line
          end else begin
            tx_bit   <= tx_bit + 4'd1;
            uart_txd <= tx_shift[tx_bit + 4'd1];
          end
        end else begin
          tx_timer <= tx_timer + 16'd1;
        end
      end else if (tx_pop) begin
        tx_shift <= {1'b1, tx_mem[tx_idx(tx_head)], 1'b0};   // stop, data, start
        tx_head  <= tx_head + 7'd1;
        tx_busy  <= 1'b1;
        tx_bit   <= 4'd0;
        tx_timer <= 16'd0;
        uart_txd <= 1'b0;                     // start bit
      end

      // The one writer of tx_count: both events in one cycle leave it alone.
      // A ctrl reset still wins (and clears head/tail above).
      if (!tx_reset) begin
        case ({tx_push, tx_pop})
          2'b10:   tx_count <= tx_count + 7'd1;
          2'b01:   tx_count <= tx_count - 7'd1;
          default: ;                       // both, or neither
        endcase
      end

      // ---- RX pop ----
      if (rx_pop) begin
        rx_head <= rx_head + 8'd1;
      end

      // ---- RX write (one port, both sources) ----
      if (rx_wr) begin
        rx_mem[rx_tail[RX_AW-1:0]] <= rx_wdata;
        rx_tail <= rx_tail + 8'd1;
      end else if (rx_push || rx_stop) begin
        rx_overrun <= 1'b1;                  // full: drop it, do not count it
      end

      // ---- RX line engine (8N1, sampled at the bit centre) ----
      if (rx_busy) begin
        if (rx_timer == div_reg - 16'd1) begin
          rx_timer <= 16'd0;
          if (rx_bit == 4'd0) begin
            if (rxd_sync) rx_busy <= 1'b0;    // false start: the line went high
            else rx_bit <= 4'd1;
          end else if (rx_bit <= 4'd8) begin
            rx_shift <= {rxd_sync, rx_shift[7:1]};   // LSB first
            rx_bit   <= rx_bit + 4'd1;
          end else begin
            rx_busy <= 1'b0;                  // stop bit; rx_wr stores it below
          end
        end else begin
          rx_timer <= rx_timer + 16'd1;
        end
      end else if (!rxd_sync) begin
        rx_busy  <= 1'b1;                     // start edge
        rx_bit   <= 4'd0;
        rx_shift <= 8'd0;
        rx_timer <= div_reg >> 1;             // skip to the start bit's centre
      end

      // The one writer of rx_count. A simultaneous take and arrival keeps it
      // as it is; a ctrl reset wins (it cleared head/tail above).
      if (!rx_reset) begin
        case ({rx_enq, rx_pop})
          2'b10:   rx_count <= rx_count + 8'd1;
          2'b01:   rx_count <= rx_count - 8'd1;
          default: ;
        endcase
      end
    end
  end

  assign rx_data  = (rx_count != 8'd0) ? {8'h00, rx_mem[rx_head[RX_AW-1:0]]} : 16'h0000;
  assign status   = {12'h000,
                     RX_ONLY ? 1'b1 : (tx_count == 7'd0 && !tx_busy), // b3 tx idle
                     rx_overrun,                       // b2 rx overrun
                     RX_ONLY ? 1'b1 : (tx_count != TX_DEPTH[6:0]),    // b1 tx ready
                     (rx_count != 8'd0)};              // b0 rx ready
  assign tx_count_o = {9'h000, tx_count};
  assign rx_count_o = {8'h00, rx_count};

endmodule
/* verilator lint_on UNUSEDSIGNAL */
