// flash608k_ctrl - level-timed read/program/erase for the FLASH608K.
//
// The primitive has no clock: XADR/YADR and the control levels must be held
// for the datasheet times. This controller turns a one-cycle command into the
// sequence and reports `done`. Program is one 32-bit word (Tprog <= 16 us);
// erase is one 2,048-byte page (Terase <= 120 ms).
module flash608k_ctrl #(
  parameter int CLK_HZ = 13_500_000
) (
  input  logic        clk,
  input  logic        rst,
  input  logic [14:0] addr,       // 32-bit word address (row*64 + column)
  input  logic [31:0] wdata,
  input  logic        read,       // one-cycle commands
  input  logic        prog_req,
  input  logic        erase,      // page containing addr
  output logic [31:0] rdata,
  output logic        busy,
  output logic        done
);
  // Datasheet minima, rounded up; T120MS is CLK_HZ * 120 / 1000.
  localparam int T5US   = (CLK_HZ + 199_999) / 200_000;
  localparam int T10US  = (CLK_HZ + 99_999) / 100_000;
  localparam int T16US  = (CLK_HZ + 62_499) / 62_500;
  localparam int T120MS = (CLK_HZ / 25) * 3;

  // UG295 figures 3-7/3-8/3-9 (FLASH64KZ timing, shared by FLASH608K):
  //   read: SE low pulse (>=2 ns), then high; DOUT after Tacc; 10 us recovery.
  //   write: SE low, ERASE low, XADR -> XE (Tpgs), PROG, NVSTR (Tnvs),
  //          YE write pulse, then PROG/NVSTR deassert.
  //   erase: ERASE -> NVSTR (Tnvs), Terase, deassert both.
  localparam logic [4:0]
    S_IDLE = 5'd0,
    S_R_SET = 5'd1, S_R_LOW = 5'd2, S_R_HIGH = 5'd3, S_R_GET = 5'd4, S_R_RCV = 5'd5,
    S_P1 = 5'd6, S_P2 = 5'd7, S_P3 = 5'd8, S_P4 = 5'd9, S_P5 = 5'd10,
    S_P6 = 5'd11, S_P7 = 5'd12, S_P8 = 5'd13, S_P9 = 5'd14,
    S_E1 = 5'd15, S_E2 = 5'd16, S_E3 = 5'd17, S_E4 = 5'd18,
    S_E5 = 5'd19, S_E6 = 5'd20, S_E7 = 5'd21;

  logic [4:0]  st;
  logic [23:0] cnt;
  logic [8:0]  xadr;
  logic [5:0]  yadr;
  logic        xe, ye, se, er, pr, nv;
  logic [31:0] din;
  logic [31:0] dout;

  assign busy = (st != S_IDLE);

  flash608k_core u_core (
    .clk(clk),
    .XADR(xadr), .YADR(yadr),
    .XE(xe), .YE(ye), .SE(se),
    .ERASE(er), .PROG(pr), .NVSTR(nv),
    .DIN(din), .DOUT(dout)
  );

  always_ff @(posedge clk) begin
    done <= 1'b0;
    if (rst) begin
      st <= S_IDLE; cnt <= 24'd0; rdata <= 32'd0;
      xadr <= 9'd0; yadr <= 6'd0;
      xe <= 1'b1; ye <= 1'b1; se <= 1'b1;
      er <= 1'b0; pr <= 1'b0; nv <= 1'b0; din <= 32'd0;
    end else begin
      case (st)
        // Read mode is the idle level, so a loader can just move the address
        // and sample DOUT after the access time.
        S_IDLE: begin
          xe <= 1'b1; ye <= 1'b1; se <= 1'b1;
          er <= 1'b0; pr <= 1'b0; nv <= 1'b0;
          xadr <= addr[14:6];
          yadr <= addr[5:0];
          cnt <= 24'd0;
          if (read) begin
            xadr <= addr[14:6];
            yadr <= addr[5:0];
            xe <= 1'b1; ye <= 1'b1; se <= 1'b1;
            er <= 1'b0; pr <= 1'b0; nv <= 1'b0;
            st <= S_R_SET;
          end
          if (prog_req) begin
            din <= wdata;
            xadr <= addr[14:6];
            yadr <= addr[5:0];
            xe <= 1'b0; ye <= 1'b0; se <= 1'b0;
            er <= 1'b0; pr <= 1'b0; nv <= 1'b0;
            st <= S_P1;
          end
          if (erase) begin
            xadr <= {addr[14:9], 3'b000};
            yadr <= 6'd0;
            xe <= 1'b0; ye <= 1'b0; se <= 1'b0;
            pr <= 1'b0; er <= 1'b0; nv <= 1'b0;
            st <= S_E1;
          end
        end

        // ---- read: SE low pulse, DOUT, T_rcv ----------------------------
        S_R_SET: if (cnt == 24'(T5US)) begin
          cnt <= 24'd0; st <= S_R_LOW;    // address/XE/YE set up
        end else cnt <= cnt + 24'd1;
        S_R_LOW: if (cnt == 24'd3) begin
          se <= 1'b1; cnt <= 24'd0; st <= S_R_HIGH;
        end else begin se <= 1'b0; cnt <= cnt + 24'd1; end
        S_R_HIGH: if (cnt == 24'd2) begin
          cnt <= 24'd0; st <= S_R_GET;
        end else cnt <= cnt + 24'd1;
        S_R_GET: begin
          rdata <= dout;
          cnt <= 24'd0; st <= S_R_RCV;
        end
        S_R_RCV: if (cnt == 24'(T10US)) begin
          done <= 1'b1;
          st <= S_IDLE;
        end else cnt <= cnt + 24'd1;

        // ---- program -----------------------------------------------------
        S_P1: if (cnt == 24'(T10US)) begin
          xe <= 1'b1; cnt <= 24'd0; st <= S_P2;
        end else cnt <= cnt + 24'd1;
        S_P2: if (cnt == 24'(T5US)) begin
          pr <= 1'b1; cnt <= 24'd0; st <= S_P3;
        end else cnt <= cnt + 24'd1;
        S_P3: if (cnt == 24'(T5US)) begin
          nv <= 1'b1; cnt <= 24'd0; st <= S_P4;
        end else cnt <= cnt + 24'd1;
        S_P4: if (cnt == 24'(T5US)) begin
          ye <= 1'b1; cnt <= 24'd0; st <= S_P5;
        end else cnt <= cnt + 24'd1;
        S_P5: if (cnt == 24'(T16US)) begin
          ye <= 1'b0; cnt <= 24'd0; st <= S_P6;
        end else cnt <= cnt + 24'd1;
        S_P6: if (cnt == 24'd2) begin
          pr <= 1'b0; cnt <= 24'd0; st <= S_P7;
        end else cnt <= cnt + 24'd1;
        S_P7: if (cnt == 24'(T5US)) begin
          nv <= 1'b0; cnt <= 24'd0; st <= S_P8;
        end else cnt <= cnt + 24'd1;
        S_P8: if (cnt == 24'(T5US)) begin
          xe <= 1'b0; cnt <= 24'd0; st <= S_P9;
        end else cnt <= cnt + 24'd1;
        S_P9: begin
          done <= 1'b1;
          st <= S_IDLE;
        end

        // ---- page erase ---------------------------------------------------
        S_E1: if (cnt == 24'(T10US)) begin
          xe <= 1'b1; cnt <= 24'd0; st <= S_E2;
        end else cnt <= cnt + 24'd1;
        S_E2: if (cnt == 24'(T5US)) begin
          er <= 1'b1; cnt <= 24'd0; st <= S_E3;
        end else cnt <= cnt + 24'd1;
        S_E3: if (cnt == 24'(T5US)) begin
          nv <= 1'b1; cnt <= 24'd0; st <= S_E4;
        end else cnt <= cnt + 24'd1;
        S_E4: if (cnt == 24'(T120MS)) begin
          er <= 1'b0; cnt <= 24'd0; st <= S_E5;
        end else cnt <= cnt + 24'd1;
        S_E5: if (cnt == 24'(T5US)) begin
          nv <= 1'b0; cnt <= 24'd0; st <= S_E6;
        end else cnt <= cnt + 24'd1;
        S_E6: if (cnt == 24'(T10US)) begin
          xe <= 1'b0; cnt <= 24'd0; st <= S_E7;
        end else cnt <= cnt + 24'd1;
        S_E7: begin
          done <= 1'b1;
          st <= S_IDLE;
        end

        default: st <= S_IDLE;
      endcase
    end
  end
endmodule
