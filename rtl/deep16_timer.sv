// deep16_timer.sv - the D16nano system timer at 0xF0020.
//
// A 32-bit millisecond counter with a 32-bit compare value and a sticky match
// flag, plus the 15 kHz tick that drives SIC source bit 1. The compare flag is
// polled; the tick is a one-cycle pulse every 450 clocks at 6.75 MHz.
//
//   0x20 CTRL      R/W  b0 enable, b1 clear match (write), b2 irq enable
//   0x22 VALUE_LO  R    milliseconds, low 16 bits
//   0x24 VALUE_HI  R    milliseconds, high 16 bits
//   0x26 CMP_LO    R/W  compare, low 16 bits
//   0x28 CMP_HI    R/W  compare, high 16 bits
//   0x2A STATUS    R    b0 match, b1 running, b2 irq enable
//
// The compare resets to 0xFFFFFFFF, so a freshly booted machine never matches
// until software programs it. At 6.75 MHz the prescaler is 6750 cycles; the
// counter wraps after 49.7 days.
module deep16_timer #(
  parameter int CLK_HZ = 6_750_000
) (
  input  logic        clk,
  input  logic        rst,
  input  logic        we,
  input  logic [3:0]  addr,
  input  logic [15:0] wdata,
  output logic [15:0] rdata,
  output logic        tick           // 15 kHz, one clk pulse
);
  localparam int DIV = (CLK_HZ + 500) / 1000;   // clock cycles per millisecond
  localparam int TICK_DIV = (CLK_HZ + 7_500) / 15_000;

  logic        enable, irq_en, match;
  logic [15:0] prescale;
  logic [15:0] tick_prescale;
  logic [31:0] ms_count, compare;

  always_ff @(posedge clk) begin
    if (rst) begin
      enable   <= 1'b1;               // a system time base is useful immediately
      irq_en   <= 1'b0;
      match    <= 1'b0;
      prescale <= 16'd0;
      tick_prescale <= 16'd0;
      tick     <= 1'b0;
      ms_count <= 32'd0;
      compare  <= 32'hFFFF_FFFF;      // no match until programmed
    end else begin
      tick <= 1'b0;
      if (we) begin
        case (addr)
          4'h0: begin
            enable <= wdata[0];
            if (wdata[1]) match <= 1'b0;
            irq_en <= wdata[2];
          end
          4'h6: compare[15:0]  <= wdata;
          4'h8: compare[31:16] <= wdata;
          default: ;
        endcase
      end

      if (enable) begin
        if (prescale >= 16'(DIV - 1)) begin
          prescale <= 16'd0;
          ms_count <= ms_count + 32'd1;
          if (ms_count + 32'd1 == compare) match <= 1'b1;
        end else begin
          prescale <= prescale + 16'd1;
        end
        if (tick_prescale >= 16'(TICK_DIV - 1)) begin
          tick_prescale <= 16'd0;
          tick <= 1'b1;
        end else begin
          tick_prescale <= tick_prescale + 16'd1;
        end
      end
    end
  end

  always_comb begin
    case (addr)
      4'h0:    rdata = {13'b0, irq_en, match, enable};
      4'h2:    rdata = ms_count[15:0];
      4'h4:    rdata = ms_count[31:16];
      4'h6:    rdata = compare[15:0];
      4'h8:    rdata = compare[31:16];
      4'hA:    rdata = {13'b0, irq_en, enable, match};
      default: rdata = 16'h0000;
    endcase
  end

endmodule
