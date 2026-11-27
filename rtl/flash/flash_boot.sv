// flash_boot - copy the flat boot image from the config flash (1 MB) into PSRAM.
//
// The config flash holds the image at 1 MB: a 64-word header (magic, format,
// image words, CRC16), then the flat 28,672-word image packed two words per
// 32-bit flash word (and, with D16SEG, the copies that go to DS and to the BIOS
// segment). It copies while computing the same CRC-16/CCITT-FALSE as the
// generator, compares the result with the header, and hands the entry word to
// the caller. boot_spi_read drives the shared SPI master for the source words.
//
// The CRC covers the flash read, which is the path that can fail (the PSRAM
// write is checked by the cache's own write-through and by the machine running).
// A read-back verify of PSRAM used to follow it; it cost 12 states (the CPU
// read port that paid for it was removed again in phase 2a). A bad header or a
// A bad header or CRC sets `err` and the machine stays in reset (the heartbeat
// LED shows boot_err); rewrite the boot image at config-flash 0x100000.
module flash_boot (
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
  input  logic        bready,
  input  logic        bbusy,

  // The config-flash read shares the SPI master (deep16_spi) with the CPU.
  output logic        spi_we,
  output logic [3:0]  spi_addr,
  output logic [15:0] spi_wdata,
  input  logic [15:0] spi_rdata
);
  localparam logic [31:0] MAGIC  = 32'h44313646;   // 'D16F'
  localparam logic [31:0] FORMAT = 32'd1;
  localparam logic [31:0] FORMAT2 = 32'd2;
  localparam int IMG_WORDS = 28672;                 // 16-bit words (0x7000)
  localparam int FLASH_IMG = 64;                    // first 32-bit word of image
  localparam int IMG_PAIRS = IMG_WORDS / 2;         // 14,336
  localparam int FLASH_WORDS = 14400;               // header + payload 32-bit words
  localparam int MAX_ENTRIES = 18;                  // (64 - 8) / 3

`ifdef D16SEG
  // Phase 4a: after the flat copy, carry the dense BDOS chapter from free
  // flat-image runs into CS=0x4000. Each entry is {len[15:0], src[15:0],
  // dst[15:0]}; the source ranges match Deep16D16DImage.stageChapters().
  localparam int BDOS_WIN_COUNT = 9;
  function automatic [47:0] bdos_win(input logic [3:0] i);
    case (i)
      4'd0: bdos_win = {16'd256,  16'h0000, 16'h0000};
      4'd1: bdos_win = {16'd293,  16'h2E05, 16'h0100};
      4'd2: bdos_win = {16'd149,  16'h40E8, 16'h0225};
      4'd3: bdos_win = {16'd880,  16'h6C90, 16'h02BA};
      4'd4: bdos_win = {16'd11,   16'h6A85, 16'h062A};
      4'd5: bdos_win = {16'd117,  16'h688B, 16'h0635};
      4'd6: bdos_win = {16'd43,   16'h67D5, 16'h06AA};
      4'd7: bdos_win = {16'd29,   16'h5FE3, 16'h06D5};
      default: bdos_win = {16'd64, 16'h2D49, 16'h06F2};
    endcase
  endfunction
`endif

  localparam logic [5:0]
    S_IDLE = 6'd0,
    S_HDR_REQ = 6'd1, S_HDR_WAIT = 6'd2,
    S_CHK = 6'd3,
    S_CP_REQ = 6'd4, S_CP_WAIT = 6'd5,
    S_CRC_LOAD = 6'd6, S_CRC_BIT = 6'd7,
    S_WR0 = 6'd8, S_WR0W = 6'd9, S_WR1 = 6'd10, S_WR1W = 6'd11,
    S_CRC_CHK = 6'd12,
    S_DONE = 6'd19, S_ERR = 6'd20,
    S_WR_B0 = 6'd21, S_WR_B0W = 6'd22,
    S_WR_B1 = 6'd23, S_WR_B1W = 6'd24,
    S_WR_D0 = 6'd29, S_WR_D0W = 6'd30,
    S_WR_D1 = 6'd31, S_WR_D1W = 6'd32,
    S_WIN_LOAD = 6'd33, S_WIN_REQ = 6'd34,
    S_WIN_WAIT = 6'd35, S_WIN_WR = 6'd36, S_WIN_WRW = 6'd37,
    S_HCRC_REQ = 6'd38, S_HCRC_WAIT = 6'd39,
    S_HCRC_LOAD = 6'd40, S_HCRC_BIT = 6'd41, S_HCRC_CHK = 6'd42,
    S_ENT_REQ = 6'd43, S_ENT_WAIT = 6'd44,
    S_ENT_CP_REQ = 6'd45, S_ENT_CP_WAIT = 6'd46,
    S_ENT_CP_WR = 6'd47, S_ENT_CP_WRW = 6'd48;

  logic [5:0]  st;
  logic [5:0]  hdr_i;
  logic [13:0] img_i;
  logic [31:0] img_word;
  logic [31:0] hdr_magic, hdr_format, hdr_words, hdr_crc, hdr_hcrc;
  logic [15:0] hdr_count;
  logic [15:0] crc;
  logic [1:0]  crc_byte;
  logic [2:0]  crc_bit;
  logic [7:0]  crc_b;
  logic [15:0] hcrc;
  logic [31:0] hcrc_word;
  logic [1:0]  hcrc_byte;
  logic [2:0]  hcrc_bit;
  logic [7:0]  hcrc_b;
  logic [4:0]  entry_i;
  logic [1:0]  ent_word_i;
  logic [15:0] ent_seg, ent_base, ent_src, ent_count, ent_flags;
  logic [15:0] ent_pos, ent_word, ent_src_word;
  logic [19:0] ent_dst;
`ifdef D16SEG
  logic [3:0]  win_i;
  logic [10:0] win_pos;
  logic [15:0] win_word;
  logic [47:0] win_desc;
`endif


  // flash controller
  logic [14:0] f_addr;
  logic        f_read, f_done, f_busy;
  logic [31:0] f_rdata;

  boot_spi_read #(.BASE(24'h100000)) u_flash (
    .clk(clk), .rst(rst),
    .start(f_read), .addr(f_addr),
    .rdata(f_rdata), .busy(f_busy), .done(f_done),
    .spi_we(spi_we), .spi_addr(spi_addr), .spi_wdata(spi_wdata),
    .spi_rdata(spi_rdata)
  );

  always_comb begin
    case (crc_byte)
      2'd0: crc_b = img_word[7:0];
      2'd1: crc_b = img_word[15:8];
      2'd2: crc_b = img_word[23:16];
      default: crc_b = img_word[31:24];
    endcase
    case (hcrc_byte)
      2'd0: hcrc_b = hcrc_word[7:0];
      2'd1: hcrc_b = hcrc_word[15:8];
      2'd2: hcrc_b = hcrc_word[23:16];
      default: hcrc_b = hcrc_word[31:24];
    endcase
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      st <= S_IDLE; done <= 1'b0; err <= 1'b0;
      hdr_i <= 6'd0; img_i <= 14'd0;
      hdr_magic <= 32'd0; hdr_format <= 32'd0; hdr_words <= 32'd0; hdr_crc <= 32'd0; hdr_hcrc <= 32'd0;
      hdr_count <= 16'd0;
      crc <= 16'hFFFF; crc_byte <= 2'd0; crc_bit <= 3'd0;
      hcrc <= 16'hFFFF; hcrc_word <= 32'd0; hcrc_byte <= 2'd0; hcrc_bit <= 3'd0;
      entry_i <= 5'd0; ent_word_i <= 2'd0;
      ent_seg <= 16'd0; ent_base <= 16'd0; ent_src <= 16'd0;
      ent_count <= 16'd0; ent_flags <= 16'd0; ent_pos <= 16'd0;
      ent_word <= 16'd0; ent_src_word <= 16'd0; ent_dst <= 20'd0;
      entry_exp <= 16'd0;
      f_addr <= 15'd0; f_read <= 1'b0;
      breq <= 1'b0; bwe <= 1'b0; baddr <= 20'd0; bwdata <= 16'd0;
`ifdef D16SEG
      win_i <= 4'd0; win_pos <= 11'd0; win_word <= 16'd0; win_desc <= 48'd0;
`endif
    end else begin
      breq <= 1'b0;
      f_read <= 1'b0;
      case (st)
        S_IDLE: if (start) begin
          hdr_i <= 6'd0;
          st <= S_HDR_REQ;
        end

        // ---- header ------------------------------------------------------
        S_HDR_REQ: begin
          f_addr <= {9'd0, hdr_i};
          f_read <= 1'b1;
          st <= S_HDR_WAIT;
        end
        S_HDR_WAIT: if (f_done) begin
          case (hdr_i)
            6'd0: hdr_magic  <= f_rdata;
            6'd1: hdr_format <= f_rdata;
            6'd2: hdr_words  <= f_rdata;
            6'd3: hdr_crc    <= f_rdata;
            6'd5: hdr_count  <= f_rdata[15:0];
            6'd6: hdr_hcrc   <= f_rdata;
            default: ;
          endcase
          if (hdr_i == 6'd7) st <= S_CHK;
          else begin hdr_i <= hdr_i + 6'd1; st <= S_HDR_REQ; end
        end
        S_CHK: begin
          if (hdr_magic != MAGIC || (hdr_format != FORMAT && hdr_format != FORMAT2)) begin
            err <= 1'b1;
            st <= S_ERR;
          end else if (hdr_format == FORMAT) begin
            if (hdr_words != 32'(IMG_WORDS)) begin
              err <= 1'b1;
              st <= S_ERR;
            end else begin
              img_i <= 14'd0;
              crc <= 16'hFFFF;
              st <= S_CP_REQ;
            end
          end else begin
            if (hdr_words != 32'(FLASH_WORDS) || hdr_count > MAX_ENTRIES) begin
              err <= 1'b1;
              st <= S_ERR;
            end else begin
              hdr_i <= 6'd0;
              hcrc <= 16'hFFFF;
              img_i <= 14'd0;
              crc <= 16'hFFFF;
              st <= S_HCRC_REQ;
            end
          end
        end

        // ---- format-2 header CRC ----------------------------------------
        // Word 6 is read as zero, so the CRC field cannot cover itself.
        S_HCRC_REQ: begin
          f_addr <= {9'd0, hdr_i};
          f_read <= 1'b1;
          st <= S_HCRC_WAIT;
        end
        S_HCRC_WAIT: if (f_done) begin
          hcrc_word <= (hdr_i == 6'd6) ? 32'd0 : f_rdata;
          hcrc_byte <= 2'd0;
          st <= S_HCRC_LOAD;
        end
        S_HCRC_LOAD: begin
          hcrc[15:8] <= hcrc[15:8] ^ hcrc_b;
          hcrc_bit <= 3'd0;
          st <= S_HCRC_BIT;
        end
        S_HCRC_BIT: begin
          hcrc <= {hcrc[14:0], 1'b0} ^ (hcrc[15] ? 16'h1021 : 16'h0000);
          if (hcrc_bit == 3'd7) begin
            hcrc_bit <= 3'd0;
            if (hcrc_byte == 2'd3) begin
              if (hdr_i == 6'd63) st <= S_HCRC_CHK;
              else begin hdr_i <= hdr_i + 6'd1; st <= S_HCRC_REQ; end
            end else begin hcrc_byte <= hcrc_byte + 2'd1; st <= S_HCRC_LOAD; end
          end else begin
            hcrc_bit <= hcrc_bit + 3'd1;
          end
        end
        S_HCRC_CHK: begin
          if (hcrc == hdr_hcrc[15:0]) st <= S_CP_REQ;
          else begin err <= 1'b1; st <= S_ERR; end
        end

        // ---- copy --------------------------------------------------------
        S_CP_REQ: begin
          f_addr <= 15'(FLASH_IMG + 32'(img_i));
          f_read <= 1'b1;
          st <= S_CP_WAIT;
        end
        S_CP_WAIT: if (f_done) begin
          img_word <= f_rdata;
          // The word at 0x0100 is the kernel's entry point; the core is
          // released with it (this used to be taken from the verify pass).
          if (img_i == 14'h0080) entry_exp <= f_rdata[15:0];
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
          else if (img_i >= 14'h2500 && img_i < 14'h3800) st <= S_WR_B0;
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
          if (img_i >= 14'h2500 && img_i < 14'h3800) st <= S_WR_B0;
          else if (img_i == 14'(IMG_PAIRS - 1)) st <= S_CRC_CHK;
          else begin img_i <= img_i + 14'd1; st <= S_CP_REQ; end
        end

        // The BIOS/demo block also gets a copy in segment 0x3000. The source
        // offset is 0x4A00..0x6FFF; the BIOS segment starts at 0x30000, so the
        // destination is 0x30000 + (source - 0x4A00) = 0x2B600 + source. The
        // soft-float library at 0x5800 lands at BIOS offset 0x0E00 and the
        // transcendental routines at 0x6000 land at 0x1600, so an FPU trap can
        // run both in the BIOS segment.
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
            if (hdr_format == FORMAT2) begin
              if (hdr_count == 16'd0) begin
                done <= 1'b1;
                st <= S_DONE;
              end else begin
                entry_i <= 5'd0;
                ent_word_i <= 2'd0;
                st <= S_ENT_REQ;
              end
            end else begin
`ifdef D16SEG
              win_i <= 4'd0;
              win_pos <= 11'd0;
              st <= S_WIN_LOAD;
`else
              done <= 1'b1;
              st <= S_DONE;
`endif
            end
          end else begin
            err <= 1'b1;
            st <= S_ERR;
          end
        end

`ifdef D16SEG
        // ---- BDOS chapter windows -------------------------------------
        // A window is {len, src, dst}. Source words are in free flat-image
        // runs; the destination is offset dst inside CS=0x4000. Reads may
        // start at an odd word, so select the half of the flash pair.
        S_WIN_LOAD: begin
          win_desc <= bdos_win(win_i);
          st <= S_WIN_REQ;
        end
        S_WIN_REQ: begin
          f_addr <= 15'(FLASH_IMG + ((win_desc[31:16] + {5'd0, win_pos}) >> 1));
          f_read <= 1'b1;
          st <= S_WIN_WAIT;
        end
        S_WIN_WAIT: if (f_done) begin
          win_word <= ((win_desc[31:16] + {5'd0, win_pos}) & 16'd1)
                      ? f_rdata[31:16] : f_rdata[15:0];
          st <= S_WIN_WR;
        end
        S_WIN_WR: if (!bbusy) begin
          breq <= 1'b1; bwe <= 1'b1;
          baddr <= 20'h40000 + {4'd0, win_desc[15:0]} + {9'd0, win_pos};
          bwdata <= win_word;
          st <= S_WIN_WRW;
        end
        S_WIN_WRW: if (bbusy) begin
          if ({5'd0, win_pos} == win_desc[47:32] - 16'd1) begin
            if (win_i == BDOS_WIN_COUNT - 1) begin
              done <= 1'b1;
              st <= S_DONE;
            end else begin
              win_i <= win_i + 4'd1;
              win_pos <= 11'd0;
              st <= S_WIN_LOAD;
            end
          end else begin
            win_pos <= win_pos + 11'd1;
            st <= S_WIN_REQ;
          end
        end
`endif

        // ---- format-2 chapter entries ---------------------------------
        // Read one 3-word entry from the header at 8 + 3*entry_i, then copy
        // ent_count words from the source pair to (seg<<4)+base. The source
        // may start on the high half (flags[0]); entries may repeat ranges.
        S_ENT_REQ: begin
          f_addr <= 15'(8 + {1'b0, entry_i} + {1'b0, entry_i} + entry_i + {10'd0, ent_word_i});
          f_read <= 1'b1;
          st <= S_ENT_WAIT;
        end
        S_ENT_WAIT: if (f_done) begin
          case (ent_word_i)
            2'd0: ent_seg <= f_rdata[15:0];
            2'd1: begin
              ent_base <= f_rdata[15:0];
              ent_src  <= f_rdata[31:16];
            end
            default: begin
              ent_count <= f_rdata[15:0];
              ent_flags <= f_rdata[31:16];
              ent_dst <= ({4'd0, ent_seg} << 4) + {4'd0, ent_base};
              if (f_rdata[15:0] == 16'd0 ||
                  (32'(ent_src) << 1) + 32'(f_rdata[31:16] & 16'h1) +
                    32'(f_rdata[15:0]) > 32'(IMG_WORDS) ||
                  (32'(ent_seg) << 4) + 32'(ent_base) +
                    32'(f_rdata[15:0]) > 32'h100000) begin
                err <= 1'b1;
                st <= S_ERR;
              end else begin
                ent_pos <= 16'd0;
                st <= S_ENT_CP_REQ;
              end
            end
          endcase
          if (ent_word_i != 2'd2) begin
            ent_word_i <= ent_word_i + 2'd1;
            st <= S_ENT_REQ;
          end
        end
        S_ENT_CP_REQ: begin
          ent_src_word <= (ent_src << 1) + (ent_flags & 16'h1) + ent_pos;
          f_addr <= 15'(FLASH_IMG +
                        (((ent_src << 1) + (ent_flags & 16'h1) + ent_pos) >> 1));
          f_read <= 1'b1;
          st <= S_ENT_CP_WAIT;
        end
        S_ENT_CP_WAIT: if (f_done) begin
          ent_word <= ent_src_word[0] ? f_rdata[31:16] : f_rdata[15:0];
          st <= S_ENT_CP_WR;
        end
        S_ENT_CP_WR: if (!bbusy) begin
          breq <= 1'b1; bwe <= 1'b1;
          baddr <= ent_dst + {4'd0, ent_pos};
          bwdata <= ent_word;
          st <= S_ENT_CP_WRW;
        end
        S_ENT_CP_WRW: if (bbusy) begin
          if (ent_pos + 16'd1 == ent_count) begin
            if ({11'd0, entry_i} + 16'd1 == hdr_count) begin
              done <= 1'b1;
              st <= S_DONE;
            end else begin
              entry_i <= entry_i + 5'd1;
              ent_word_i <= 2'd0;
              st <= S_ENT_REQ;
            end
          end else begin
            ent_pos <= ent_pos + 16'd1;
            st <= S_ENT_CP_REQ;
          end
        end

        S_DONE: done <= 1'b1;
        S_ERR:  err  <= 1'b1;
        default: st <= S_ERR;
      endcase
    end
  end
endmodule
