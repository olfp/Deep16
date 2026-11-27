// flash_boot - copy the flat boot image from the config flash (1 MB) into PSRAM.
//
// The config flash holds the image at 1 MB: a 64-word header (magic, format,
// word count, payload CRC, table count), then the flat 28,672-word image packed
// two words per 32-bit flash word (and, with D16SEG, the copies that go to DS
// and to the BIOS segment). Format 2 also carries the three-word chapter table;
// format 1 is the legacy flat/BIOS path only.
//
// It copies while computing the same CRC-16/CCITT-FALSE as the generator and
// compares the result with the header. The header CRC field is generated for
// software but is not checked here: the fitted GW1NR-9 has no room for the
// second CRC datapath. A bad header or payload CRC sets `err` and the machine
// stays in reset (the heartbeat LED shows boot_err); rewrite the boot image at
// config-flash 0x100000. boot_spi_read drives the shared SPI master.
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


  localparam logic [4:0]
    S_IDLE = 5'd0,
    S_HDR_REQ = 5'd1, S_HDR_WAIT = 5'd2,
    S_CHK = 5'd3,
    S_CP_REQ = 5'd4, S_CP_WAIT = 5'd5,
    S_CRC_LOAD = 5'd6, S_CRC_BIT = 5'd7,
    S_WR0 = 5'd8, S_WR0W = 5'd9, S_WR1 = 5'd10, S_WR1W = 5'd11,
    S_CRC_CHK = 5'd12,
    S_DONE = 5'd13, S_ERR = 5'd14,
    S_WR_B0 = 5'd15, S_WR_B0W = 5'd16,
    S_WR_B1 = 5'd17, S_WR_B1W = 5'd18,
    S_WR_D0 = 5'd19, S_WR_D0W = 5'd20,
    S_WR_D1 = 5'd21, S_WR_D1W = 5'd22,
    S_ENT_REQ = 5'd23, S_ENT_WAIT = 5'd24,
    S_ENT_CP_REQ = 5'd25, S_ENT_CP_WAIT = 5'd26,
    S_ENT_CP_WR = 5'd27, S_ENT_CP_WRW = 5'd28;

  logic [4:0]  st;
  logic [5:0]  hdr_i;
  logic [13:0] img_i;
  logic [31:0] img_word;
  logic [31:0] hdr_magic;
  logic [1:0]  hdr_format;
  logic [15:0] hdr_words, hdr_crc;
  logic [4:0]  hdr_count;
  logic [15:0] crc;
  logic [1:0]  crc_byte;
  logic [2:0]  crc_bit;
  logic [7:0]  crc_b;
  logic [4:0]  entry_i;
  logic [1:0]  ent_word_i;
  logic [3:0]  ent_seg;
  logic [15:0] ent_base, ent_src;
  logic [11:0] ent_count, ent_pos;
  logic        ent_flag;
  logic [15:0] ent_word, ent_src_word;
  logic [19:0] ent_dst;
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
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      st <= S_IDLE; done <= 1'b0; err <= 1'b0;
      hdr_i <= 6'd0; img_i <= 14'd0;
      hdr_magic <= 32'd0; hdr_format <= 2'd0; hdr_words <= 16'd0; hdr_crc <= 16'd0;
      hdr_count <= 5'd0;
      crc <= 16'hFFFF; crc_byte <= 2'd0; crc_bit <= 3'd0;
      entry_i <= 5'd0; ent_word_i <= 2'd0;
      ent_seg <= 4'd0; ent_base <= 16'd0; ent_src <= 16'd0;
      ent_count <= 12'd0; ent_flag <= 1'b0; ent_pos <= 12'd0;
      ent_word <= 16'd0; ent_src_word <= 16'd0; ent_dst <= 20'd0;
      entry_exp <= 16'd0;
      f_addr <= 15'd0; f_read <= 1'b0;
      breq <= 1'b0; bwe <= 1'b0; baddr <= 20'd0; bwdata <= 16'd0;
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
            6'd1: hdr_format <= f_rdata[1:0];
            6'd2: hdr_words  <= f_rdata[15:0];
            6'd3: hdr_crc    <= f_rdata[15:0];
            6'd5: hdr_count  <= f_rdata[4:0];
            default: ;
          endcase
          if (hdr_i == 6'd7) st <= S_CHK;
          else begin hdr_i <= hdr_i + 6'd1; st <= S_HDR_REQ; end
        end
        S_CHK: begin
          if (hdr_magic != MAGIC || (hdr_format != 2'd1 && hdr_format != 2'd2)) begin
            err <= 1'b1;
            st <= S_ERR;
          end else if (hdr_format == FORMAT) begin
            if (hdr_words != 16'(IMG_WORDS)) begin
              err <= 1'b1;
              st <= S_ERR;
            end else begin
              img_i <= 14'd0;
              crc <= 16'hFFFF;
              st <= S_CP_REQ;
            end
          end else begin
            if (hdr_words != 16'(FLASH_WORDS) || hdr_count > MAX_ENTRIES) begin
              err <= 1'b1;
              st <= S_ERR;
            end else begin
              img_i <= 14'd0;
              crc <= 16'hFFFF;
              st <= S_CP_REQ;
            end
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
          if (img_i >= 14'h1800 && img_i <= 14'h1FE1) st <= S_WR_D0;
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
          if (crc == hdr_crc) begin
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
              done <= 1'b1;
              st <= S_DONE;
            end
          end else begin
            err <= 1'b1;
            st <= S_ERR;
          end
        end


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
            2'd0: ent_seg <= f_rdata[15:12];
            2'd1: begin
              ent_base <= f_rdata[15:0];
              ent_src  <= f_rdata[31:16];
            end
            default: begin
              ent_count <= f_rdata[11:0];
              ent_flag  <= f_rdata[16];
              ent_dst   <= {ent_seg, 16'd0} + {4'd0, ent_base};
              if (f_rdata[11:0] == 12'd0) begin
                err <= 1'b1;
                st <= S_ERR;
              end else begin
                ent_pos <= 12'd0;
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
          ent_src_word <= (ent_src << 1) + {15'd0, ent_flag} + ent_pos;
          f_addr <= 15'(FLASH_IMG +
                        (((ent_src << 1) + {15'd0, ent_flag} + ent_pos) >> 1));
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
          if (ent_pos + 12'd1 == ent_count) begin
            if ({10'd0, entry_i} + 5'd1 == hdr_count) begin
              done <= 1'b1;
              st <= S_DONE;
            end else begin
              entry_i <= entry_i + 5'd1;
              ent_word_i <= 2'd0;
              st <= S_ENT_REQ;
            end
          end else begin
            ent_pos <= ent_pos + 12'd1;
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
