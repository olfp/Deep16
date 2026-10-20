// psram_bridge_tb - Verilator wrapper: bridge + behavioural PSRAM IP model.
module psram_bridge_tb (
  input  logic        clk_cpu,
  input  logic        rst_cpu,
  input  logic        clk_ip,
  input  logic        rst_ip,
  input  logic        req,
  input  logic        we,
  input  logic [19:0] addr,
  input  logic [15:0] wdata,
  output logic [15:0] rdata,
  output logic        ready,
  output logic        busy
);
  logic [20:0] ip_addr;
  logic        ip_cmd, ip_cmd_en;
  logic [63:0] ip_wr_data;
  logic [7:0]  ip_mask;
  logic [63:0] ip_rd_data;
  logic        ip_rd_valid;

  deep16_psram_bridge u_bridge (
    .clk_cpu(clk_cpu), .rst_cpu(rst_cpu),
    .clk_ip (clk_ip),  .rst_ip (rst_ip),
    .req(req), .we(we), .addr(addr), .wdata(wdata),
    .rdata(rdata), .ready(ready), .busy(busy),
    .ip_addr(ip_addr), .ip_cmd(ip_cmd), .ip_cmd_en(ip_cmd_en),
    .ip_wr_data(ip_wr_data), .ip_mask(ip_mask),
    .ip_rd_data(ip_rd_data), .ip_rd_valid(ip_rd_valid)
  );

  psram_ip_model u_model (
    .clk(clk_ip), .rst_n(~rst_ip),
    .addr(ip_addr), .cmd(ip_cmd), .cmd_en(ip_cmd_en),
    .wr_data(ip_wr_data), .mask(ip_mask),
    .rd_data(ip_rd_data), .rd_valid(ip_rd_valid)
  );
endmodule
