// dvi_out - three TMDS channels plus the clock lane for a DVI/HDMI sink.
//
// The pixel clock is only 25.2 MHz, so the encoder does its work combinationally
// in one pixel clock instead of the 18-stage pipeline a 100 MHz pixel clock
// needs. OSER10 serializes each 10-bit TMDS word at 5x the pixel clock (DDR),
// and the ELVDS buffers drive the board's HDMI pairs.
//
// Channel order matches the Tang Nano 9K's HDMI connector: lane 0 = blue,
// lane 1 = green, lane 2 = red, lane 3 = the clock. The sync and blanking
// control words travel on the blue lane; green and red use ctrl = 0, as the
// DVI specification requires.
module tmds_encoder (
  input  logic        clk,
  input  logic        rst,
  input  logic [7:0]  data,
  input  logic [1:0]  ctrl,       // {vsync, hsync}
  input  logic        de,
  output logic [9:0]  tmds
);
  // HDMI spec 5.4 (Figure 5-7), evaluated combinationally per pixel. The
  // running disparity is the only state. This is the same formulation as
  // hdl-util/hdmi's tmds_channel and the DVI white paper, and it is checked
  // against that reference in rtl/sim/tmds_tb (not committed).
  logic [3:0]        n1d;
  logic [8:0]        q_m;
  logic signed [4:0] n1q, n0q;
  logic signed [5:0] acc;
  logic signed [5:0] acc_add;
  logic [9:0]        q_out;

  always_comb begin
    n1d = 4'(data[0]) + 4'(data[1]) + 4'(data[2]) + 4'(data[3]) +
          4'(data[4]) + 4'(data[5]) + 4'(data[6]) + 4'(data[7]);

    q_m[0] = data[0];
    if (n1d > 4 || (n1d == 4 && data[0] == 1'b0)) begin
      q_m[1] = ~(q_m[0] ^ data[1]);
      q_m[2] = ~(q_m[1] ^ data[2]);
      q_m[3] = ~(q_m[2] ^ data[3]);
      q_m[4] = ~(q_m[3] ^ data[4]);
      q_m[5] = ~(q_m[4] ^ data[5]);
      q_m[6] = ~(q_m[5] ^ data[6]);
      q_m[7] = ~(q_m[6] ^ data[7]);
      q_m[8] = 1'b0;
    end else begin
      q_m[1] = q_m[0] ^ data[1];
      q_m[2] = q_m[1] ^ data[2];
      q_m[3] = q_m[2] ^ data[3];
      q_m[4] = q_m[3] ^ data[4];
      q_m[5] = q_m[4] ^ data[5];
      q_m[6] = q_m[5] ^ data[6];
      q_m[7] = q_m[6] ^ data[7];
      q_m[8] = 1'b1;
    end

    n1q = $signed({1'b0, 4'(q_m[0]) + 4'(q_m[1]) + 4'(q_m[2]) + 4'(q_m[3]) +
                         4'(q_m[4]) + 4'(q_m[5]) + 4'(q_m[6]) + 4'(q_m[7])});
    n0q = 5'sd8 - n1q;

    if (acc == 6'sd0 || n1q == n0q) begin
      if (q_m[8]) begin
        q_out   = {~q_m[8], q_m[8], q_m[7:0]};
        acc_add = n1q - n0q;
      end else begin
        q_out   = {~q_m[8], q_m[8], ~q_m[7:0]};
        acc_add = n0q - n1q;
      end
    end else if ((acc > 0 && n1q > n0q) || (acc < 0 && n1q < n0q)) begin
      q_out   = {1'b1, q_m[8], ~q_m[7:0]};
      acc_add = (n0q - n1q) + (q_m[8] ? 6'sd2 : 6'sd0);
    end else begin
      q_out   = {1'b0, q_m[8], q_m[7:0]};
      acc_add = (n1q - n0q) - (q_m[8] ? 6'sd0 : 6'sd2);
    end
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      tmds <= 10'b1101010100;
      acc  <= 6'sd0;
    end else if (!de) begin
      case (ctrl)
        2'b00: tmds <= 10'b1101010100;
        2'b01: tmds <= 10'b0010101011;
        2'b10: tmds <= 10'b0101010100;
        default: tmds <= 10'b1010101011;
      endcase
      acc <= 6'sd0;
    end else begin
      tmds <= q_out;
      acc  <= acc + acc_add;
    end
  end
endmodule

module dvi_out (
  input  logic        clk_pixel,
  input  logic        clk_5x,
  input  logic        rst,
  input  logic [7:0]  r,
  input  logic [7:0]  g,
  input  logic [7:0]  b,
  input  logic        hsync,
  input  logic        vsync,
  input  logic        de,
  output logic [3:0]  hdmi_tx_p,
  output logic [3:0]  hdmi_tx_n
);
  // Register the video inputs once: the encoder's own output register and the
  // serializer then line up, and the extra pixel of latency is invisible.
  logic [23:0] rgb_q;
  logic [2:0]  hve_q;
  always_ff @(posedge clk_pixel) begin
    rgb_q <= {r, g, b};
    hve_q <= {de, vsync, hsync};
  end

  logic [9:0] tmds_b, tmds_g, tmds_r;
  tmds_encoder enc_b (.clk(clk_pixel), .rst(rst), .data(rgb_q[7:0]),
                      .ctrl(hve_q[1:0]), .de(hve_q[2]), .tmds(tmds_b));
  tmds_encoder enc_g (.clk(clk_pixel), .rst(rst), .data(rgb_q[15:8]),
                      .ctrl(2'b00), .de(hve_q[2]), .tmds(tmds_g));
  tmds_encoder enc_r (.clk(clk_pixel), .rst(rst), .data(rgb_q[23:16]),
                      .ctrl(2'b00), .de(hve_q[2]), .tmds(tmds_r));

  logic [3:0] serial;
  OSER10 #(.GSREN("false"), .LSREN("true")) ser_b (
    .PCLK(clk_pixel), .FCLK(clk_5x), .RESET(rst), .Q(serial[0]),
    .D0(tmds_b[0]), .D1(tmds_b[1]), .D2(tmds_b[2]), .D3(tmds_b[3]),
    .D4(tmds_b[4]), .D5(tmds_b[5]), .D6(tmds_b[6]), .D7(tmds_b[7]),
    .D8(tmds_b[8]), .D9(tmds_b[9]));
  OSER10 #(.GSREN("false"), .LSREN("true")) ser_g (
    .PCLK(clk_pixel), .FCLK(clk_5x), .RESET(rst), .Q(serial[1]),
    .D0(tmds_g[0]), .D1(tmds_g[1]), .D2(tmds_g[2]), .D3(tmds_g[3]),
    .D4(tmds_g[4]), .D5(tmds_g[5]), .D6(tmds_g[6]), .D7(tmds_g[7]),
    .D8(tmds_g[8]), .D9(tmds_g[9]));
  OSER10 #(.GSREN("false"), .LSREN("true")) ser_r (
    .PCLK(clk_pixel), .FCLK(clk_5x), .RESET(rst), .Q(serial[2]),
    .D0(tmds_r[0]), .D1(tmds_r[1]), .D2(tmds_r[2]), .D3(tmds_r[3]),
    .D4(tmds_r[4]), .D5(tmds_r[5]), .D6(tmds_r[6]), .D7(tmds_r[7]),
    .D8(tmds_r[8]), .D9(tmds_r[9]));
  // Clock lane: the fixed 10-bit clock pattern (five ones, five zeros).
  OSER10 #(.GSREN("false"), .LSREN("true")) ser_clk (
    .PCLK(clk_pixel), .FCLK(clk_5x), .RESET(rst), .Q(serial[3]),
    .D0(1'b1), .D1(1'b1), .D2(1'b1), .D3(1'b1), .D4(1'b1),
    .D5(1'b0), .D6(1'b0), .D7(1'b0), .D8(1'b0), .D9(1'b0));

  ELVDS_OBUF obuf_b (.I(serial[0]), .O(hdmi_tx_p[0]), .OB(hdmi_tx_n[0]));
  ELVDS_OBUF obuf_g (.I(serial[1]), .O(hdmi_tx_p[1]), .OB(hdmi_tx_n[1]));
  ELVDS_OBUF obuf_r (.I(serial[2]), .O(hdmi_tx_p[2]), .OB(hdmi_tx_n[2]));
  ELVDS_OBUF obuf_c (.I(serial[3]), .O(hdmi_tx_p[3]), .OB(hdmi_tx_n[3]));

endmodule
