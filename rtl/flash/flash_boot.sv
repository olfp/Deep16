// flash_boot - copy the flat boot image from the on-die FLASH608K into PSRAM.
//
// The user flash starts blank, so this loader expects the image installed by
// the flash_installer bitstream: a 64-word header (magic, format, image words,
// CRC16), then the flat 24,576-word image packed two words per 32-bit flash
// word. It copies, computes the same CRC-16/CCITT-FALSE as the generator,
// verifies PSRAM against the flash, and hands the entry word to the caller.
//
// One retry on the first PSRAM mismatch. A bad header or a persistent CRC
// failure sets `err` and the machine stays in reset (the heartbeat LED shows
// boot_err); the installer bitstream has to be run again.
module flash_boot #(
  parameter int CLK_HZ = 13_500_000
) (
  input  logic        clk,
  input  logic        rst,
  input  logic        start,        // tags are clear, begin
  output logic        done,
  output logic        err,
  output logic [15:0] entry_exp,    // word 0x0100 as read from flash

  // PSRAM bridge (the same one the runtime uses)
  output logic        breq,
  output logic        bwe,
  output logic [19:0] baddr,
  output logic [15:0] bwdata,
  input  logic [15:0] brdata,
  input  logic        bready,
  input  logic        bbusy
);
  localparam logic [31:0] MAGIC  = 32'h44313646;   // 'D16F'
  localparam logic [31:0] FORMAT = 32'd1;
  localparam int IMG_WORDS = 24576;                 // 16-bit words
  localparam int FLASH_IMG = 64;                    // first 32-bit word of image
  localparam int IMG_PAIRS = IMG_WORDS / 2;         // 12,288

  localparam logic [5:0]
    S_IDLE = 6'd0,
    S_HDR_REQ = 6'd1, S_HDR_WAIT = 6'd2,
    S_CHK = 6'd3,
    S_CP_REQ = 6'd4, S_CP_WAIT = 6'd5,
    S_CRC_LOAD = 6'd6, S_CRC_BIT = 6'd7,
    S_WR0 = 6'd8, S_WR0W = 6'd9, S_WR1 = 6'd10, S_WR1W = 6'd11,
    S_CRC_CHK = 6'd12,
    S_V_REQ = 6'd13, S_V_WAIT = 6'd14,
    S_V_RD0 = 6'd15, S_V_RD0W = 6'd16, S_V_RD1 = 6'd17, S_V_RD1W = 6'd18,
    S_DONE = 6'd19, S_ERR = 6'd20,
    S_WR_B0 = 6'd21, S_WR_B0W = 6'd22,
    S_WR_B1 = 6'd23, S_WR_B1W = 6'd24,
    S_V_B0 = 6'd25, S_V_B0W = 6'd26,
    S_V_B1 = 6'd27, S_V_B1W = 6'd28,
    S_WR_D0 = 6'd29, S_WR_D0W = 6'd30,
    S_WR_D1 = 6'd31, S_WR_D1W = 6'd32,
    S_V_D0 = 6'd33, S_V_D0W = 6'd34,
    S_V_D1 = 6'd35, S_V_D1W = 6'd36;

  logic [5:0]  st;
  logic [2:0]  hdr_i;
  logic [13:0] img_i;
  logic [31:0] img_word, v_word;
  logic [31:0] hdr_magic, hdr_format, hdr_words, hdr_crc;
  logic [15:0] crc;
  logic [1:0]  crc_byte;
  logic [2:0]  crc_bit;
  logic [7:0]  crc_b;
  logic        retried;

  // flash controller
  logic [14:0] f_addr;
  logic        f_read, f_done, f_busy;
  logic [31:0] f_rdata;

  flash608k_read #(.CLK_HZ(CLK_HZ)) u_flash (
    .clk(clk), .rst(rst),
    .addr(f_addr), .read(f_read),
    .rdata(f_rdata), .busy(f_busy), .done(f_done)
  );

  always_comb begin
    case (crc_byte)
      2'd0: crc_b = img_word[7:0];
      2'd1: crc_b = img_word[15:8];
      2'd2: crc_b = img_word[23:16];
      default: crc_b = img_word[31:24];
    endcase
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      st <= S_IDLE; done <= 1'b0; err <= 1'b0;
      hdr_i <= 3'd0; img_i <= 14'd0;
      hdr_magic <= 32'd0; hdr_format <= 32'd0; hdr_words <= 32'd0; hdr_crc <= 32'd0;
      crc <= 16'hFFFF; crc_byte <= 2'd0; crc_bit <= 3'd0;
      retried <= 1'b0; entry_exp <= 16'd0;
      f_addr <= 15'd0; f_read <= 1'b0;
      breq <= 1'b0; bwe <= 1'b0; baddr <= 20'd0; bwdata <= 16'd0;
    end else begin
      breq <= 1'b0;
      f_read <= 1'b0;
      case (st)
        S_IDLE: if (start) begin
          hdr_i <= 3'd0;
          st <= S_HDR_REQ;
        end

        // ---- header ------------------------------------------------------
        S_HDR_REQ: begin
          f_addr <= {12'd0, hdr_i};
          f_read <= 1'b1;
          st <= S_HDR_WAIT;
        end
        S_HDR_WAIT: if (f_done) begin
          case (hdr_i)
            3'd0: hdr_magic  <= f_rdata;
            3'd1: hdr_format <= f_rdata;
            3'd2: hdr_words  <= f_rdata;
            3'd3: hdr_crc    <= f_rdata;
            default: ;
          endcase
          if (hdr_i == 3'd7) st <= S_CHK;
          else begin hdr_i <= hdr_i + 3'd1; st <= S_HDR_REQ; end
        end
        S_CHK: begin
          if (hdr_magic == MAGIC && hdr_format == FORMAT && hdr_words == 32'(IMG_WORDS)) begin
            img_i <= 14'd0;
            crc <= 16'hFFFF;
            retried <= 1'b0;
            st <= S_CP_REQ;
          end else begin
            err <= 1'b1;
            st <= S_ERR;
          end
        end

        // ---- copy --------------------------------------------------------
        S_CP_REQ: begin
          f_addr <= 15'(FLASH_IMG + 32'(img_i));
          f_read <= 1'b1;
          st <= S_CP_WAIT;
        end
        S_CP_WAIT: if (f_done) begin
          img_word <= f_rdata;
          crc_byte <= 2'd0;
          st <= S_CRC_LOAD;
        end

        S_CRC_LOAD: begin
          crc[15:8] <= crc[15:8] ^ crc_b;
          crc_bit <= 3'd0;
          st <= S_CRC_BIT;
        end
        S_CRC_BIT: begin
          crc <= {crc[14:0], 1'b0} ^ (crc[15] ? 16'h1021 : 16'h0000);
          if (crc_bit == 3'd7) begin
            crc_bit <= 3'd0;
            if (crc_byte == 2'd3) st <= S_WR0;
            else begin crc_byte <= crc_byte + 2'd1; st <= S_CRC_LOAD; end
          end else begin
            crc_bit <= crc_bit + 3'd1;
          end
        end

        S_WR0: if (!bbusy) begin
          breq <= 1'b1; bwe <= 1'b1;
          baddr <= {5'd0, img_i, 1'b0};
          bwdata <= img_word[15:0];
          st <= S_WR0W;
        end
        S_WR0W: if (bbusy) st <= S_WR1;

        S_WR1: if (!bbusy && !bready) begin
          breq <= 1'b1; bwe <= 1'b1;
          baddr <= {5'd0, img_i, 1'b1};
          bwdata <= img_word[31:16];
          st <= S_WR1W;
        end
        S_WR1W: if (bbusy) begin
`ifdef D16SEG
          if (img_i >= 14'h1800 && img_i <= 14'h2BEE) st <= S_WR_D0;
          else if (img_i >= 14'h2500 && img_i < 14'h2C00) st <= S_WR_B0;
          else
`endif
          if (img_i == 14'(IMG_PAIRS - 1)) st <= S_CRC_CHK;
          else begin img_i <= img_i + 14'd1; st <= S_CP_REQ; end
        end

`ifdef D16SEG
        // The kernel data and the BIOS/demo data also get a copy in DS=0x1000.
        // Destination = 0x10000 + source word address.
        S_WR_D0: if (!bbusy) begin
          breq <= 1'b1; bwe <= 1'b1;
          baddr <= 20'h10000 + {5'd0, img_i, 1'b0};
          bwdata <= img_word[15:0];
          st <= S_WR_D0W;
        end
        S_WR_D0W: if (bbusy) st <= S_WR_D1;

        S_WR_D1: if (!bbusy && !bready) begin
          breq <= 1'b1; bwe <= 1'b1;
          baddr <= 20'h10001 + {5'd0, img_i, 1'b0};
          bwdata <= img_word[31:16];
          st <= S_WR_D1W;
        end
        S_WR_D1W: if (bbusy) begin
          if (img_i >= 14'h2500 && img_i < 14'h2C00) st <= S_WR_B0;
          else if (img_i == 14'(IMG_PAIRS - 1)) st <= S_CRC_CHK;
          else begin img_i <= img_i + 14'd1; st <= S_CP_REQ; end
        end

        // The BIOS/demo block also gets a copy in segment 0x3000. The source
        // offset is 0x4A00..0x57FF; the BIOS segment starts at 0x30000, so the
        // destination is 0x30000 + (source - 0x4A00) = 0x2B600 + source.
        S_WR_B0: if (!bbusy) begin
          breq <= 1'b1; bwe <= 1'b1;
          baddr <= 20'h2B600 + {5'd0, img_i, 1'b0};
          bwdata <= img_word[15:0];
          st <= S_WR_B0W;
        end
        S_WR_B0W: if (bbusy) st <= S_WR_B1;

        S_WR_B1: if (!bbusy && !bready) begin
          breq <= 1'b1; bwe <= 1'b1;
          baddr <= 20'h2B601 + {5'd0, img_i, 1'b0};
          bwdata <= img_word[31:16];
          st <= S_WR_B1W;
        end
        S_WR_B1W: if (bbusy) begin
          if (img_i == 14'(IMG_PAIRS - 1)) st <= S_CRC_CHK;
          else begin img_i <= img_i + 14'd1; st <= S_CP_REQ; end
        end
`endif

        S_CRC_CHK: begin
          if (crc == hdr_crc[15:0]) begin
            img_i <= 14'd0;
            st <= S_V_REQ;
          end else begin
            err <= 1'b1;
            st <= S_ERR;
          end
        end

        // ---- verify PSRAM against flash ---------------------------------
        S_V_REQ: begin
          f_addr <= 15'(FLASH_IMG + 32'(img_i));
          f_read <= 1'b1;
          st <= S_V_WAIT;
        end
        S_V_WAIT: if (f_done) begin
          v_word <= f_rdata;
          st <= S_V_RD0;
        end
        S_V_RD0: if (!bbusy && !bready) begin
          breq <= 1'b1; bwe <= 1'b0;
          baddr <= {5'd0, img_i, 1'b0};
          st <= S_V_RD0W;
        end
        S_V_RD0W: if (bready) begin
          if (brdata != v_word[15:0]) begin
            if (!retried) begin
              retried <= 1'b1; img_i <= 14'd0; crc <= 16'hFFFF; st <= S_CP_REQ;
            end else begin err <= 1'b1; st <= S_ERR; end
          end else begin
            if (baddr == 20'h00100) entry_exp <= v_word[15:0];
            st <= S_V_RD1;
          end
        end
        S_V_RD1: if (!bbusy && !bready) begin
          breq <= 1'b1; bwe <= 1'b0;
          baddr <= {5'd0, img_i, 1'b1};
          st <= S_V_RD1W;
        end
        S_V_RD1W: if (bready) begin
          if (brdata != v_word[31:16]) begin
            if (!retried) begin
              retried <= 1'b1; img_i <= 14'd0; crc <= 16'hFFFF; st <= S_CP_REQ;
            end else begin err <= 1'b1; st <= S_ERR; end
          end
`ifdef D16SEG
          else if (img_i >= 14'h1800 && img_i <= 14'h2BEE) begin
            st <= S_V_D0;
          end
          else if (img_i >= 14'h2500 && img_i < 14'h2C00) begin
            st <= S_V_B0;
          end
`endif
          else if (img_i == 14'(IMG_PAIRS - 1)) begin
            done <= 1'b1;
            st <= S_DONE;
          end else begin
            img_i <= img_i + 14'd1;
            st <= S_V_REQ;
          end
        end

`ifdef D16SEG
        // Verify the DS=0x1000 copy.
        S_V_D0: if (!bbusy && !bready) begin
          breq <= 1'b1; bwe <= 1'b0;
          baddr <= 20'h10000 + {5'd0, img_i, 1'b0};
          st <= S_V_D0W;
        end
        S_V_D0W: if (bready) begin
          if (brdata != v_word[15:0]) begin
            if (!retried) begin
              retried <= 1'b1; img_i <= 14'd0; crc <= 16'hFFFF; st <= S_CP_REQ;
            end else begin err <= 1'b1; st <= S_ERR; end
          end else begin
            st <= S_V_D1;
          end
        end
        S_V_D1: if (!bbusy && !bready) begin
          breq <= 1'b1; bwe <= 1'b0;
          baddr <= 20'h10001 + {5'd0, img_i, 1'b0};
          st <= S_V_D1W;
        end
        S_V_D1W: if (bready) begin
          if (brdata != v_word[31:16]) begin
            if (!retried) begin
              retried <= 1'b1; img_i <= 14'd0; crc <= 16'hFFFF; st <= S_CP_REQ;
            end else begin err <= 1'b1; st <= S_ERR; end
          end else if (img_i >= 14'h2500 && img_i < 14'h2C00) begin
            st <= S_V_B0;
          end else if (img_i == 14'(IMG_PAIRS - 1)) begin
            done <= 1'b1;
            st <= S_DONE;
          end else begin
            img_i <= img_i + 14'd1;
            st <= S_V_REQ;
          end
        end

        // Verify the BIOS-segment copy as well.
        S_V_B0: if (!bbusy && !bready) begin
          breq <= 1'b1; bwe <= 1'b0;
          baddr <= 20'h2B600 + {5'd0, img_i, 1'b0};
          st <= S_V_B0W;
        end
        S_V_B0W: if (bready) begin
          if (brdata != v_word[15:0]) begin
            if (!retried) begin
              retried <= 1'b1; img_i <= 14'd0; crc <= 16'hFFFF; st <= S_CP_REQ;
            end else begin err <= 1'b1; st <= S_ERR; end
          end else begin
            st <= S_V_B1;
          end
        end
        S_V_B1: if (!bbusy && !bready) begin
          breq <= 1'b1; bwe <= 1'b0;
          baddr <= 20'h2B601 + {5'd0, img_i, 1'b0};
          st <= S_V_B1W;
        end
        S_V_B1W: if (bready) begin
          if (brdata != v_word[31:16]) begin
            if (!retried) begin
              retried <= 1'b1; img_i <= 14'd0; crc <= 16'hFFFF; st <= S_CP_REQ;
            end else begin err <= 1'b1; st <= S_ERR; end
          end else if (img_i == 14'(IMG_PAIRS - 1)) begin
            done <= 1'b1;
            st <= S_DONE;
          end else begin
            img_i <= img_i + 14'd1;
            st <= S_V_REQ;
          end
        end
`endif

        S_DONE: done <= 1'b1;
        S_ERR:  err  <= 1'b1;
        default: st <= S_ERR;
      endcase
    end
  end
endmodule
