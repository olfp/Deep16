// ps2_rx_tb - drive the PS/2 receiver pin-by-pin and check the ASCII output.
module ps2_rx_tb (
  input  logic       clk,
  input  logic       rst,
  input  logic       ps2_clk,
  input  logic       ps2_data,
  output logic       valid,
  output logic [7:0] ascii,
  output logic [7:0] scan_code,
  output logic [3:0] modifiers,
  output logic       frame_error
);
  ps2_rx #(.CLK_HZ(1_000_000)) u_dut (
    .clk         (clk),
    .rst         (rst),
    .ps2_clk     (ps2_clk),
    .ps2_data    (ps2_data),
    .valid       (valid),
    .ascii       (ascii),
    .scan_code   (scan_code),
    .modifiers   (modifiers),
    .frame_error (frame_error)
  );
endmodule
