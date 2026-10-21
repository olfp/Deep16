// dvi_pll - 25.2 MHz pixel clock and 126 MHz serial clock for 640x480@60.
//
// 640x480@60 is 800 x 525 pixels at 25.2 MHz exactly. The TMDS serializer
// (OSER10) needs 5x the pixel clock and produces 10 bits per pixel over DDR, so
// the link is 252 Mbit/s per lane.
//
// The rPLL's VCO must sit in the part's range:
//   VCO = CLKOUT x ODIV = 126 MHz x 4 = 504 MHz
//   126 MHz = 27 MHz x 14 / 3  ->  FBDIV_SEL = 13, IDIV_SEL = 2
// CLKDIV then divides the 126 MHz by five to the 25.2 MHz pixel clock.
//
// Gowin primitives only; the Verilator tests cover dvi_text, not this file.
module dvi_pll (
  input  wire clk,        // 27 MHz board oscillator
  output wire clk_pixel,  // 25.2 MHz
  output wire clk_5x,     // 126 MHz
  output wire lock
);

  wire clk_126;

  rPLL rpll_inst (
    .CLKOUT   (clk_126),
    .LOCK     (lock),
    .CLKOUTP  (),
    .CLKOUTD  (),
    .CLKOUTD3 (),
    .RESET    (1'b0),
    .RESET_P  (1'b0),
    .CLKIN    (clk),
    .CLKFB    (1'b0),
    .FBDSEL   (6'b0),
    .IDSEL    (6'b0),
    .ODSEL    (6'b0),
    .PSDA     (4'b0),
    .DUTYDA   (4'b0),
    .FDLY     (4'b0)
  );

  defparam rpll_inst.FCLKIN = "27";
  defparam rpll_inst.DYN_IDIV_SEL = "false";
  defparam rpll_inst.IDIV_SEL = 2;
  defparam rpll_inst.DYN_FBDIV_SEL = "false";
  defparam rpll_inst.FBDIV_SEL = 13;
  defparam rpll_inst.DYN_ODIV_SEL = "false";
  defparam rpll_inst.ODIV_SEL = 4;
  defparam rpll_inst.PSDA_SEL = "0000";
  defparam rpll_inst.DYN_DA_EN = "false";
  defparam rpll_inst.DUTYDA_SEL = "1000";
  defparam rpll_inst.CLKOUT_FT_DIR = 1'b1;
  defparam rpll_inst.CLKOUTP_FT_DIR = 1'b1;
  defparam rpll_inst.CLKOUT_DLY_STEP = 0;
  defparam rpll_inst.CLKOUTP_DLY_STEP = 0;
  defparam rpll_inst.CLKFB_SEL = "internal";
  defparam rpll_inst.CLKOUT_BYPASS = "false";
  defparam rpll_inst.CLKOUTP_BYPASS = "false";
  defparam rpll_inst.CLKOUTD_BYPASS = "false";
  defparam rpll_inst.DYN_SDIV_SEL = 2;
  defparam rpll_inst.CLKOUTD_SRC = "CLKOUT";
  defparam rpll_inst.CLKOUTD3_SRC = "CLKOUT";
  defparam rpll_inst.DEVICE = "GW1NR-9C";

  CLKDIV #(.DIV_MODE("5"), .GSREN("false")) pixel_div (
    .CLKOUT (clk_pixel),
    .HCLKIN (clk_126),
    .RESETN (lock),
    .CALIB  (1'b1)
  );

  assign clk_5x = clk_126;

endmodule
