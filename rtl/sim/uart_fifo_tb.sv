// uart_fifo_tb - the RX FIFO under overflow, without the CPU in the way.
//
// Pushes more bytes than the FIFO holds and then drains it: a full FIFO must
// drop the surplus *and not count it*. Before the fix, rx_count went past the
// depth and the read pointer drifted out of step with the tail, so every later
// read returned the wrong slot.
module uart_fifo_tb (
  input  logic        clk,
  input  logic        rst,
  input  logic        push,
  input  logic [15:0] push_data,
  input  logic        take,
  output logic [15:0] data,
  output logic [15:0] status,
  output logic [15:0] count
);
  deep16_uart #(.CLK_HZ(13_500_000)) u_dut (
    .clk          (clk),
    .rst          (rst),
    .tx_we        (1'b0),
    .tx_data      (16'h0000),
    .rx_take      (take),
    .ctrl_we      (1'b0),
    .ctrl_data    (16'h0000),
    .status       (status),
    .rx_data      (data),
    .rx_push      (push),
    .rx_push_data (push_data),
    .tx_count_o   (),
    .rx_count_o   (count),
    .uart_txd     (),
    .uart_rxd     (1'b1)
  );
endmodule
