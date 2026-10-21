// flash608k_read - read-only timing for the FLASH608K boot loader.
//
// The datasheet read cycle needs an SE low pulse (>=2 ns), SE high, Tacc for
// DOUT, and a 10 us recovery before the next address. The installer keeps the
// full read/program/erase controller; the boot loader only needs this smaller
// read path.
module flash608k_read #(
  parameter int CLK_HZ = 13_500_000
) (
  input  logic        clk,
  input  logic        rst,
  input  logic [14:0] addr,
  input  logic        read,
  output logic [31:0] rdata,
  output logic        busy,
  output logic        done
);
  localparam int T5US  = (CLK_HZ + 199_999) / 200_000;
  localparam int T10US = (CLK_HZ + 99_999) / 100_000;

  localparam logic [2:0]
    S_IDLE = 3'd0, S_SET = 3'd1, S_LOW = 3'd2,
    S_HIGH = 3'd3, S_GET = 3'd4, S_RCV = 3'd5;

  logic [2:0]  st;
  logic [23:0] cnt;
  logic [8:0]  xadr;
  logic [5:0]  yadr;
  logic        xe, ye, se;
  logic [31:0] dout;

  assign busy = (st != S_IDLE);

  flash608k_core u_core (
    .clk(clk),
    .XADR(xadr), .YADR(yadr),
    .XE(xe), .YE(ye), .SE(se),
    .ERASE(1'b0), .PROG(1'b0), .NVSTR(1'b0),
    .DIN(32'd0), .DOUT(dout)
  );

  always_ff @(posedge clk) begin
    done <= 1'b0;
    if (rst) begin
      st <= S_IDLE; cnt <= 24'd0; rdata <= 32'd0;
      xadr <= 9'd0; yadr <= 6'd0;
      xe <= 1'b1; ye <= 1'b1; se <= 1'b1;
    end else begin
      case (st)
        S_IDLE: begin
          xe <= 1'b1; ye <= 1'b1; se <= 1'b1;
          xadr <= addr[14:6];
          yadr <= addr[5:0];
          cnt <= 24'd0;
          if (read) st <= S_SET;
        end
        S_SET: if (cnt == 24'(T5US)) begin
          cnt <= 24'd0; st <= S_LOW;
        end else cnt <= cnt + 24'd1;
        S_LOW: if (cnt == 24'd3) begin
          se <= 1'b1; cnt <= 24'd0; st <= S_HIGH;
        end else begin se <= 1'b0; cnt <= cnt + 24'd1; end
        S_HIGH: if (cnt == 24'd2) begin
          cnt <= 24'd0; st <= S_GET;
        end else cnt <= cnt + 24'd1;
        S_GET: begin
          rdata <= dout;
          cnt <= 24'd0; st <= S_RCV;
        end
        S_RCV: if (cnt == 24'(T10US)) begin
          done <= 1'b1;
          st <= S_IDLE;
        end else cnt <= cnt + 24'd1;
        default: st <= S_IDLE;
      endcase
    end
  end
endmodule
