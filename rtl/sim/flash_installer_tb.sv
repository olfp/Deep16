module flash_installer_tb (
  input  logic       clk,
  input  logic       rst_n,
  output logic [5:0] led,
  output logic [31:0] dbg_word0,
  output logic [31:0] dbg_word64
);
  flash_installer u_inst (.clk(clk), .rst_n(rst_n), .led(led));
  assign dbg_word0  = u_inst.u_flash.u_core.u_model.mem[0];
  assign dbg_word64 = u_inst.u_flash.u_core.u_model.mem[64];
endmodule
