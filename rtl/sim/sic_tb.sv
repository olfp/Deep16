// sic_tb - the four-source SIC: sticky pending, W1C, enable mask, scratch.
module sic_tb (
  input  logic        clk,
  input  logic        rst,
  input  logic        we,
  input  logic [3:0]  addr,
  input  logic [15:0] wdata,
  output logic [15:0] rdata,
  input  logic [3:0]  src,
  output logic        irq
);
  deep16_sic u_dut (
    .clk   (clk),
    .rst   (rst),
    .we    (we),
    .addr  (addr),
    .wdata (wdata),
    .rdata (rdata),
    .src   (src),
    .irq   (irq)
  );
endmodule
