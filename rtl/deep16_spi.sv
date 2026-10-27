// deep16_spi.sv - byte-wide SPI master at 0xF0080.
//
// One transfer is eight bits, mode 0: SCK idles low, MISO is sampled on the
// rising edge and MOSI changes on the falling edge. The CPU starts a transfer
// by writing DATA and polls STATUS.busy; the protocol (SD commands, flash
// erase/program) lives in software.
//
//   0x80 CTRL    R/W  b1:0 chip selects (1 = asserted, active-low pins)
//   0x82 STATUS  R    b0 busy, b1 done, b3:2 chip selects
//   0x84 DATA    R/W  write a byte to start; read the byte received last
//   0x86 DIV     R/W  half-period divider; SCK = clk / (2 * (DIV + 1))
//
// DIV resets to 0 (3.375 MHz at 6.75 MHz) and software writes 8 for the
// ~375 kHz SD initialisation clock. The chip selects are only asserted while
// the corresponding CTRL bit is set; the master does not toggle them itself.
module deep16_spi (
  input  logic        clk,
  input  logic        rst,
  input  logic        we,
  input  logic [3:0]  addr,
  /* verilator lint_off UNUSEDSIGNAL */
  input  logic [15:0] wdata,      // only the low byte is the SPI data/divider
  /* verilator lint_on UNUSEDSIGNAL */
  output logic [15:0] rdata,
  output logic        sck,
  output logic        mosi,
  output logic [1:0]  cs_n,
  input  logic        miso
);
  logic [1:0] cs_sel;
  logic [7:0] div_reg;
  logic [6:0] tx_shift;
  logic [7:0] rx_shift, rx_data;
  logic [3:0] bit_cnt;
  logic [7:0] div_cnt;
  logic       busy, done, phase;

  assign cs_n = ~cs_sel;

  always_ff @(posedge clk) begin
    if (rst) begin
      cs_sel   <= 2'b00;
      div_reg  <= 8'd0;
      tx_shift <= 7'd0;
      rx_shift <= 8'd0;
      rx_data  <= 8'd0;
      bit_cnt  <= 4'd0;
      div_cnt  <= 8'd0;
      busy     <= 1'b0;
      done     <= 1'b0;
      phase    <= 1'b0;
      sck      <= 1'b0;
      mosi     <= 1'b0;
    end else begin
      if (we) begin
        case (addr)
          4'h0: cs_sel <= wdata[1:0];
          4'h4: if (!busy) begin
            // Start: MSB first, SCK low, CS already set by CTRL.
            tx_shift <= wdata[6:0];
            rx_shift <= 8'd0;
            bit_cnt  <= 4'd0;
            div_cnt  <= 8'd0;
            busy     <= 1'b1;
            done     <= 1'b0;
            phase    <= 1'b0;
            sck      <= 1'b0;
            mosi     <= wdata[7];
          end
          4'h6: div_reg <= wdata[7:0];
          default: ;
        endcase
      end

      if (busy) begin
        if (div_cnt >= div_reg) begin
          div_cnt <= 8'd0;
          if (!phase) begin
            sck      <= 1'b1;
            rx_shift <= {rx_shift[6:0], miso};
            phase    <= 1'b1;
          end else begin
            sck      <= 1'b0;
            tx_shift <= {tx_shift[5:0], 1'b0};
            mosi     <= tx_shift[6];
            phase    <= 1'b0;
            if (bit_cnt == 4'd7) begin
              busy    <= 1'b0;
              done    <= 1'b1;
              rx_data <= rx_shift;
              mosi    <= 1'b0;
            end else begin
              bit_cnt <= bit_cnt + 4'd1;
            end
          end
        end else begin
          div_cnt <= div_cnt + 8'd1;
        end
      end
    end
  end

  always_comb begin
    case (addr)
      4'h0:    rdata = {14'b0, cs_sel};
      4'h2:    rdata = {12'b0, cs_sel, done, busy};
      4'h4:    rdata = {8'h00, rx_data};
      4'h6:    rdata = {8'h00, div_reg};
      default: rdata = 16'h0000;
    endcase
  end

endmodule
