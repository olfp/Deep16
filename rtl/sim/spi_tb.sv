// spi_tb - byte transfers with MISO looped back to MOSI.
module spi_tb (
  input  logic        clk,
  input  logic        rst,
  input  logic        we,
  input  logic [3:0]  addr,
  input  logic [15:0] wdata,
  output logic [15:0] rdata,
  output logic        sck,
  output logic        mosi,
  output logic [1:0]  cs_n,
  input  logic        miso
);
  deep16_spi u_dut (
    .clk   (clk),
    .rst   (rst),
    .we    (we),
    .addr  (addr),
    .wdata (wdata),
    .rdata (rdata),
    .sck   (sck),
    .mosi  (mosi),
    .cs_n  (cs_n),
    .miso  (miso)
  );
endmodule
