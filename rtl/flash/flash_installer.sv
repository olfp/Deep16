// flash_installer - one-time programmer for the on-die FLASH608K.
//
// The user flash has no initial value and cannot be written by the Gowin
// programmer: only FPGA logic can reach it. This bitstream exists solely to
// install the image. It loads image.flash.hex (header + flat image), erases the
// 25 pages it needs, programs all 12,352 32-bit words, and reads them back.
//
// LEDs (active low): 0 blinks while working, 1 steady = PASS, 2 steady = FAIL.
// After PASS, flash the normal USER_FLASH bitstream; the image stays in the
// user flash across reconfiguration.
module flash_installer (
  input  logic       clk,       // 27 MHz
  input  logic       rst_n,
  output logic [5:0] led
);
  localparam int FLASH_WORDS = 12352;   // 64-word header + 12,288 image words
  localparam int PAGES = 25;            // 25 x 2048 B = 50 KB (header + image)

  logic [31:0] img [0:FLASH_WORDS-1];
  initial $readmemh("image.flash.hex", img);

  logic [13:0] img_a;
  logic [31:0] img_q;
  always_ff @(posedge clk) img_q <= img[img_a];

  logic        flash_read, flash_prog, flash_erase;
  logic [14:0] flash_addr;
  logic [31:0] flash_wdata, flash_rdata;
  logic        flash_busy, flash_done;

  flash608k_ctrl #(.CLK_HZ(27_000_000)) u_flash (
    .clk(clk), .rst(~rst_n),
    .addr(flash_addr), .wdata(flash_wdata),
    .read(flash_read), .prog_req(flash_prog), .erase(flash_erase),
    .rdata(flash_rdata), .busy(flash_busy), .done(flash_done)
  );

  localparam logic [3:0]
    S_WAIT = 4'd0,
    S_E_SET = 4'd1, S_E_WAIT = 4'd2,
    S_P_LOAD = 4'd3, S_P_ROM = 4'd4, S_P_REQ = 4'd5, S_P_WAIT = 4'd6,
    S_V_LOAD = 4'd7, S_V_ROM = 4'd8, S_V_REQ = 4'd9, S_V_WAIT = 4'd10,
    S_PASS = 4'd11, S_FAIL = 4'd12;

  logic [3:0]  st;
  logic [19:0] wait_cnt;
  logic [4:0]  page;
  logic [13:0] i;
  logic [23:0] hb;

  always_ff @(posedge clk) begin
    hb <= hb + 24'd1;
    if (!rst_n) begin
      st <= S_WAIT; wait_cnt <= 20'd0; page <= 5'd0; i <= 14'd0;
      img_a <= 14'd0; flash_addr <= 15'd0; flash_wdata <= 32'd0;
      flash_read <= 1'b0; flash_prog <= 1'b0; flash_erase <= 1'b0; hb <= 24'd0;
    end else begin
      flash_read <= 1'b0; flash_prog <= 1'b0; flash_erase <= 1'b0;
      case (st)
        // ~1 ms of power-on settling before touching the flash.
        S_WAIT: begin
          if (wait_cnt == 20'(27_000)) st <= S_E_SET;
          else wait_cnt <= wait_cnt + 20'd1;
        end

        // ---- erase the pages we use -------------------------------------
        S_E_SET: begin
          flash_addr <= 15'(page) * 15'd512;
          flash_erase <= 1'b1;
          st <= S_E_WAIT;
        end
        S_E_WAIT: if (flash_done) begin
          if (page == 5'(PAGES - 1)) begin
            i <= 14'd0;
            st <= S_P_LOAD;
          end else begin
            page <= page + 5'd1;
            st <= S_E_SET;
          end
        end

        // ---- program every 32-bit word ----------------------------------
        S_P_LOAD: begin
          img_a <= i;
          st <= S_P_ROM;
        end
        S_P_ROM: st <= S_P_REQ;      // the BSRAM ROM read has one cycle latency
        S_P_REQ: begin
          flash_addr <= {1'b0, i};
          flash_wdata <= img_q;
          flash_prog <= 1'b1;
          st <= S_P_WAIT;
        end
        S_P_WAIT: if (flash_done) begin
          if (i == 14'(FLASH_WORDS - 1)) begin
            i <= 14'd0;
            st <= S_V_LOAD;
          end else begin
            i <= i + 14'd1;
            st <= S_P_LOAD;
          end
        end

        // ---- read back and compare --------------------------------------
        S_V_LOAD: begin
          img_a <= i;
          st <= S_V_ROM;
        end
        S_V_ROM: st <= S_V_REQ;
        S_V_REQ: begin
          flash_addr <= {1'b0, i};
          flash_read <= 1'b1;
          st <= S_V_WAIT;
        end
        S_V_WAIT: if (flash_done) begin
          if (flash_rdata != img_q) begin
            st <= S_FAIL;
          end else if (i == 14'(FLASH_WORDS - 1)) begin
            st <= S_PASS;
          end else begin
            i <= i + 14'd1;
            st <= S_V_LOAD;
          end
        end

        S_PASS: st <= S_PASS;
        S_FAIL: st <= S_FAIL;
        default: st <= S_FAIL;
      endcase
    end
  end

  // LEDs are active low. 0: heartbeat while working / steady when done.
  assign led[0] = (st == S_PASS) ? 1'b0 : (st == S_FAIL) ? 1'b1 : hb[23];
  assign led[1] = (st == S_PASS) ? 1'b0 : 1'b1;
  assign led[2] = (st == S_FAIL) ? 1'b0 : 1'b1;
  assign led[5:3] = 3'b111;

endmodule
