// timer_tb - the 1 ms timer and the 15 kHz tick at a 1 MHz test clock
// (DIV = 1000, tick every 67 cycles).
module timer_tb (
  input  logic        clk,
  input  logic        rst,
  input  logic        we,
  input  logic [3:0]  addr,
  input  logic [15:0] wdata,
  output logic [15:0] rdata,
  output logic        tick
);
  deep16_timer #(.CLK_HZ(1_000_000)) u_dut (
    .clk   (clk),
    .rst   (rst),
    .we    (we),
    .addr  (addr),
    .wdata (wdata),
    .rdata (rdata),
    .tick  (tick)
  );
endmodule
