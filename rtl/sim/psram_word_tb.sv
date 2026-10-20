// psram_word_tb - Verilator wrapper: word bridge + behavioural controller model.
module psram_word_tb (
  input  logic        clk_cpu,
  input  logic        rst_cpu,
  input  logic        clk_ctl,
  input  logic        rst_ctl,
  input  logic        req,
  input  logic        we,
  input  logic [19:0] addr,
  input  logic [15:0] wdata,
  output logic [15:0] rdata,
  output logic        ready,
  output logic        busy
);
  logic        ctl_read, ctl_write, ctl_busy;
  logic [21:0] ctl_addr;
  logic [15:0] ctl_din, ctl_dout;

  psram_word_bridge u_bridge (
    .clk_cpu(clk_cpu), .rst_cpu(rst_cpu),
    .clk_ctl(clk_ctl), .rst_ctl(rst_ctl),
    .req(req), .we(we), .addr(addr), .wdata(wdata),
    .rdata(rdata), .ready(ready), .busy(busy),
    .ctl_read(ctl_read), .ctl_write(ctl_write),
    .ctl_addr(ctl_addr), .ctl_din(ctl_din), .ctl_dout(ctl_dout), .ctl_busy(ctl_busy)
  );

  psram_word_model u_model (
    .clk(clk_ctl), .rst_n(~rst_ctl),
    .read(ctl_read), .write(ctl_write), .addr(ctl_addr), .din(ctl_din),
    .dout(ctl_dout), .busy(ctl_busy)
  );
endmodule
