// uart_tx_tb - the one-byte TX path used by the D16nano build.
module uart_tx_tb (
  input  logic        clk,
  input  logic        rst,
  input  logic        tx_we,
  input  logic [15:0] tx_data,
  output logic [15:0] status,
  output logic        uart_txd
);
  deep16_uart #(
    .CLK_HZ  (1_000_000),
    .BAUD    (100_000),
    .TX_DEPTH(1),
    .RX_ONLY (1'b0)
  ) u_dut (
    .clk          (clk),
    .rst          (rst),
    .tx_we        (tx_we),
    .tx_data      (tx_data),
    .rx_take      (1'b0),
    .ctrl_we      (1'b0),
    .ctrl_data    (16'h0000),
    .status       (status),
    .rx_data      (),
    .rx_push      (1'b0),
    .rx_push_data (16'h0000),
    .tx_count_o   (),
    .rx_count_o   (),
    .uart_txd     (uart_txd),
    .uart_rxd     (1'b1)
  );
endmodule
