// flash_ctrl_tb - Verilator wrapper for the FLASH608K controller + model.
module flash_ctrl_tb (
  input  logic        clk,
  input  logic        rst,
  input  logic [14:0] addr,
  input  logic [31:0] wdata,
  input  logic        read,
  input  logic        prog_req,
  input  logic        erase,
  output logic [31:0] rdata,
  output logic        busy,
  output logic        done
);
  flash608k_ctrl #(.CLK_HZ(13_500_000)) u_ctrl (
    .clk(clk), .rst(rst),
    .addr(addr), .wdata(wdata),
    .read(read), .prog_req(prog_req), .erase(erase),
    .rdata(rdata), .busy(busy), .done(done)
  );
endmodule
