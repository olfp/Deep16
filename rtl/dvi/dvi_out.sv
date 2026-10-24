// dvi_out - three TMDS channels plus the clock lane for a DVI/HDMI sink.
//
// The text build runs at 25.2 MHz and the D16nano tile build at 74.25 MHz
// (720p60). The encoder is pipelined in two stages so the same RTL closes at
// both rates; OSER10 serializes each 10-bit TMDS word at 5x the pixel clock
// (DDR), and the ELVDS buffers drive the board's HDMI pairs.
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
  // HDMI spec 5.4 (Figure 5-7), pipelined in two stages so the 74.25 MHz
  // 720p pixel clock closes: stage 1 builds q_m and its one/zero counts,
  // stage 2 applies the running disparity. Standard data and blanking both
  // pass through the same pipeline, so the sync stays aligned with the pixels.
  logic [3:0]        n1d;
  logic [8:0]        q_m;
  logic signed [4:0] n1q, n0q;
  logic [8:0]        q_m_r;
  logic signed [4:0] n1q_r, n0q_r;
  logic              de_r;
  logic [1:0]        ctrl_r;
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
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      q_m_r  <= 9'd0;
      n1q_r  <= 5'sd0;
      n0q_r  <= 5'sd0;
      de_r   <= 1'b0;
      ctrl_r <= 2'b00;
    end else begin
      q_m_r  <= q_m;
      n1q_r  <= n1q;
      n0q_r  <= n0q;
      de_r   <= de;
      ctrl_r <= ctrl;
    end
  end

  always_comb begin
    if (acc == 6'sd0 || n1q_r == n0q_r) begin
      if (q_m_r[8]) begin
        q_out   = {~q_m_r[8], q_m_r[8], q_m_r[7:0]};
        acc_add = n1q_r - n0q_r;
      end else begin
        q_out   = {~q_m_r[8], q_m_r[8], ~q_m_r[7:0]};
        acc_add = n0q_r - n1q_r;
      end
    end else if ((acc > 0 && n1q_r > n0q_r) || (acc < 0 && n1q_r < n0q_r)) begin
      q_out   = {1'b1, q_m_r[8], ~q_m_r[7:0]};
      acc_add = (n0q_r - n1q_r) + (q_m_r[8] ? 6'sd2 : 6'sd0);
    end else begin
      q_out   = {1'b0, q_m_r[8], q_m_r[7:0]};
      acc_add = (n1q_r - n0q_r) - (q_m_r[8] ? 6'sd0 : 6'sd2);
    end
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      tmds <= 10'b1101010100;
      acc  <= 6'sd0;
    end else if (!de_r) begin
      case (ctrl_r)
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
    // The control symbols in the reference designs carry the sync pulse as a
    // high level (the monitor derives polarity from the pulse position), while
    // dvi_text drives the standard active-low levels. Invert here.
    hve_q <= {de, ~vsync, ~hsync};
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
