// deep16_sic.sv - the D16nano four-source interrupt controller at 0xF00B0.
//
//  0xB0 PENDING  R; write 1 clears the bits written (W1C)
//  0xB2 ENABLE   R/W
//  0xB4 STATUS   R  b0 IRQ (any pending & enable), b1 any pending
//  0xB6 SCRATCH  R/W 16-bit software counter (the ISR uses it for the tick)
//  0xB8 RASTER   R/W 16-bit raster counter (the ISR increments it)
//
// Bits: 3 raster, 2 audio, 1 timer, 0 keyboard.  Priority is fixed high to low
// (raster, audio, timer, keyboard); the SIC asserts one level IRQ and the
// software handler reads PENDING, clears the serviced bit and dispatches in
// that order.  Level sources (audio low, keyboard ready) re-latch on the next
// clock if still active; pulse sources (timer, raster) stay pending until W1C.
module deep16_sic (
  input  logic        clk,
  input  logic        rst,
  input  logic        we,
  input  logic [3:0]  addr,
  input  logic [15:0] wdata,
  output logic [15:0] rdata,
  input  logic [3:0]  src,
  output logic        irq
);
  logic [3:0]  pending, enable;
  logic [15:0] scratch, raster;

  always_ff @(posedge clk) begin
    if (rst) begin
      pending <= 4'd0;
      enable  <= 4'd0;
      scratch <= 16'd0;
      raster  <= 16'd0;
    end else begin
      pending <= pending | src;
      if (we) begin
        case (addr)
          4'h0: pending <= (pending & ~wdata[3:0]) | src;
          4'h2: enable  <= wdata[3:0];
          4'h6: scratch <= wdata;
          4'h8: raster  <= wdata;
          default: ;
        endcase
      end
    end
  end

  assign irq = |(pending & enable);

  always_comb begin
    case (addr)
      4'h0: rdata = {12'b0, pending};
      4'h2: rdata = {12'b0, enable};
      4'h4: rdata = {14'b0, |pending, irq};
      4'h6: rdata = scratch;
      4'h8: rdata = raster;
      default: rdata = 16'h0000;
    endcase
  end

endmodule
