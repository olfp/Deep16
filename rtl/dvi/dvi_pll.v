// dvi_pll - pixel clock, 5x TMDS serializer clock and render clock.
//
// dvi_text: 25.2 MHz pixel / 126 MHz serial for 800 x 525 (640x480@60).
// dvi_tile: 74.25 MHz pixel / 371.25 MHz serial for 1650 x 750 (720p60).
// The tile renderer runs at 24.75 MHz (the serial clock / 15), i.e. exactly
// two output lines per render line. The TMDS serializer (OSER10) needs 5x the
// pixel clock and produces 10 bits per pixel over DDR, so the link is
// 742.5 Mbit/s per lane at 720p.
//
// The rPLL's VCO must sit in the part's range:
//   tile: 371.25 MHz x 2 = 742.5 MHz  (27 MHz x 55 / 4)
//   text: 126 MHz x 4 = 504 MHz       (27 MHz x 14 / 3)
// CLKDIV then divides the serializer clock by five to the pixel clock.
//
// Gowin primitives only; the Verilator tests cover dvi_text, not this file.
module dvi_pll (
  input  wire clk,        // 27 MHz board oscillator
  output wire clk_pixel,  // 74.25 MHz (tile) / 25.2 MHz (text)
  output wire clk_5x,     // 371.25 MHz (tile) / 126 MHz (text)
  output wire clk_render, // 24.75 MHz (tile renderer)
  output wire lock
);

  wire clk_serial;
  wire clk_pixel_d;
  wire clk_render_3;

  rPLL rpll_inst (
    .CLKOUT   (clk_serial),
    .LOCK     (lock),
    .CLKOUTP  (),
    .CLKOUTD  (clk_pixel_d),
    .CLKOUTD3 (clk_render_3),
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
  defparam rpll_inst.DYN_FBDIV_SEL = "false";
  defparam rpll_inst.DYN_ODIV_SEL = "false";
`ifdef DVI_TILE
  // 27 * 55 / 4 = 371.25 MHz, VCO = 371.25 * 2 = 742.5 MHz.
  defparam rpll_inst.IDIV_SEL = 3;
  defparam rpll_inst.FBDIV_SEL = 54;
  defparam rpll_inst.ODIV_SEL = 2;
`else
  // 27 * 14 / 3 = 126 MHz, VCO = 126 * 4 = 504 MHz.
  defparam rpll_inst.IDIV_SEL = 2;
  defparam rpll_inst.FBDIV_SEL = 13;
  defparam rpll_inst.ODIV_SEL = 4;
`endif
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
`ifdef DVI_TILE
  // CLKOUTD = CLKOUT / 5 = 74.25 MHz (the OSER10 PCLK).
  defparam rpll_inst.DYN_SDIV_SEL = 5;
`else
  defparam rpll_inst.DYN_SDIV_SEL = 2;
`endif
  defparam rpll_inst.CLKOUTD_SRC = "CLKOUT";
  defparam rpll_inst.CLKOUTD3_SRC = "CLKOUT";
  defparam rpll_inst.DEVICE = "GW1NR-9C";

`ifdef DVI_TILE
  // 371.25 / 5 from the rPLL's CLKOUTD, not a CLKDIV at 371.25 MHz.
  assign clk_pixel = clk_pixel_d;
`else
  CLKDIV #(.DIV_MODE("5"), .GSREN("false")) pixel_div (
    .CLKOUT (clk_pixel),
    .HCLKIN (clk_serial),
    .RESETN (lock),
    .CALIB  (1'b1)
  );
`endif

  // CLKOUTD3 = serial / 3 = 123.75 MHz; /5 gives the 24.75 MHz renderer clock.
  CLKDIV #(.DIV_MODE("5"), .GSREN("false")) render_div (
    .CLKOUT (clk_render),
    .HCLKIN (clk_render_3),
    .RESETN (lock),
    .CALIB  (1'b1)
  );

  assign clk_5x = clk_serial;

endmodule
