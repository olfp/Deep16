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
  parameter int RX_DEPTH = 128
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

  // ---- transmitter -------------------------------------------------------
  logic [7:0]  tx_mem [0:TX_DEPTH-1];
  logic [6:0]  tx_head, tx_tail, tx_count;   // TX_DEPTH = 64 -> 7 bits
  logic [9:0]  tx_shift;                     // {stop, data[7:0], start}
  logic [15:0] tx_timer;
  logic [3:0]  tx_bit;
  logic        tx_busy;

  // ---- receiver ----------------------------------------------------------
  logic [7:0]  rx_mem [0:RX_DEPTH-1];
  logic [7:0]  rx_head, rx_tail, rx_count;   // RX_DEPTH = 128 -> 8 bits
  logic [7:0]  rx_shift;
  logic [15:0] rx_timer;
  logic [3:0]  rx_bit;
  logic        rx_busy;
  logic        rx_overrun;

  // ---- divisor / control -------------------------------------------------
  logic [15:0] div_reg;

  // Push helper: a byte into the RX FIFO, dropping it (and flagging) when full.
  task automatic rx_enqueue(input logic [7:0] byte_in);
    if (rx_count == RX_DEPTH[7:0]) begin
      rx_overrun <= 1'b1;
    end else begin
      rx_mem[rx_tail[6:0]] <= byte_in;
      rx_tail  <= rx_tail + 8'd1;
      rx_count <= rx_count + 8'd1;
    end
  endtask

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
      if (tx_we && tx_count != TX_DEPTH[6:0]) begin
        tx_mem[tx_tail[5:0]] <= tx_data[7:0];
        tx_tail  <= tx_tail + 7'd1;
        tx_count <= tx_count + 7'd1;
      end

      // ---- TX shift engine ----
      if (tx_busy) begin
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
      end else if (tx_count != 7'd0) begin
        tx_shift <= {1'b1, tx_mem[tx_head[5:0]], 1'b0};   // stop, data, start
        tx_head  <= tx_head + 7'd1;
        tx_count <= tx_count - 7'd1;
        tx_busy  <= 1'b1;
        tx_bit   <= 4'd0;
        tx_timer <= 16'd0;
        uart_txd <= 1'b0;                     // start bit
      end

      // ---- RX pop ----
      if (rx_take && rx_count != 8'd0) begin
        rx_head  <= rx_head + 8'd1;
        rx_count <= rx_count - 8'd1;
      end

      // ---- RX injection (host) ----
      if (rx_push) rx_enqueue(rx_push_data[7:0]);

      // ---- RX line engine (8N1, sampled at the bit centre) ----
      if (rx_busy) begin
        if (rx_timer == div_reg - 16'd1) begin
          rx_timer <= 16'd0;
          if (rx_bit == 4'd0) begin
            if (uart_rxd) rx_busy <= 1'b0;    // false start: the line went high
            else rx_bit <= 4'd1;
          end else if (rx_bit <= 4'd8) begin
            rx_shift <= {uart_rxd, rx_shift[7:1]};   // LSB first
            rx_bit   <= rx_bit + 4'd1;
          end else begin
            rx_busy <= 1'b0;                  // stop bit
            rx_enqueue(rx_shift);
          end
        end else begin
          rx_timer <= rx_timer + 16'd1;
        end
      end else if (!uart_rxd) begin
        rx_busy  <= 1'b1;                     // start edge
        rx_bit   <= 4'd0;
        rx_shift <= 8'd0;
        rx_timer <= div_reg >> 1;             // skip to the start bit's centre
      end
    end
  end

  assign rx_data  = (rx_count != 8'd0) ? {8'h00, rx_mem[rx_head[6:0]]} : 16'h0000;
  assign status   = {12'h000,
                     (tx_count == 7'd0 && !tx_busy),   // b3 tx idle
                     rx_overrun,                       // b2 rx overrun
                     (tx_count != TX_DEPTH[6:0]),      // b1 tx ready
                     (rx_count != 8'd0)};              // b0 rx ready
  assign tx_count_o = {9'h000, tx_count};
  assign rx_count_o = {8'h00, rx_count};

endmodule
/* verilator lint_on UNUSEDSIGNAL */
