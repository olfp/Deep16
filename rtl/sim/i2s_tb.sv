// i2s_tb - the I2S serialiser, framing, FIFO level and loop/underrun.
module i2s_tb (
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
  deep16_i2s u_dut (
    .clk      (clk),
    .rst      (rst),
    .we       (we),
    .addr     (addr),
    .wdata    (wdata),
    .rdata    (rdata),
    .bclk     (bclk),
    .lrclk    (lrclk),
    .din      (din),
    .fifo_irq (fifo_irq)
  );
endmodule
