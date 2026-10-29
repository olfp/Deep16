// flash_boot_tb - the full config-flash boot loader into a PSRAM write model.
//
// The flash model answers the 0x03 reads from image.flash.hex (written at
// 0x100000); the PSRAM model stores the flat image, the DS copy and the BIOS
// copy. The loader must finish with done=1, err=0 and the entry word equal to
// the image word at 0x0100.
module flash_boot_tb (
  input  logic        clk,
  input  logic        rst,
  input  logic        start,
  output logic        done,
  output logic        err,
  output logic [15:0] entry_exp,
  output logic [15:0] exp_0000,
  output logic [15:0] exp_0100,
  output logic [15:0] exp_3000,
  output logic [15:0] exp_bios4a00,
  output logic [15:0] got_0100,
  output logic [15:0] got_0000,
  output logic [15:0] got_3000,
  output logic [15:0] got_ds3000,
  output logic [15:0] got_bios4a00
);
  logic        spi_we;
  logic [3:0]  spi_addr;
  logic [15:0] spi_wdata, spi_rdata;
  logic        sck, mosi, miso;
  logic [1:0]  cs_n;

  // PSRAM write model: one transaction at a time, bbusy then bready.
  logic        breq, bwe, bready, bbusy;
  logic [19:0] baddr;
  logic [15:0] bwdata;
  logic [15:0] psram [0:20'hFFFFF];

  always_ff @(posedge clk) begin
    bbusy  <= breq;
    bready <= bbusy;
    if (breq && bwe) psram[baddr] <= bwdata;
  end

  flash_boot u_boot (
    .clk(clk), .rst(rst), .start(start),
    .done(done), .err(err), .entry_exp(entry_exp),
    .breq(breq), .bwe(bwe), .baddr(baddr), .bwdata(bwdata),
    .bready(bready), .bbusy(bbusy),
    .spi_we(spi_we), .spi_addr(spi_addr),
    .spi_wdata(spi_wdata), .spi_rdata(spi_rdata)
  );

  deep16_spi u_spi (
    .clk(clk), .rst(rst),
    .we(spi_we), .addr(spi_addr), .wdata(spi_wdata), .rdata(spi_rdata),
    .sck(sck), .mosi(mosi), .cs_n(cs_n), .miso(miso)
  );

  // ---- the config flash bytes, from image.flash.hex -------------------
  localparam int WORDS = 12352;
  logic [31:0] flash32 [0:WORDS-1];
  initial $readmemh("image.flash.hex", flash32);

  logic [23:0] hdr;
  logic [2:0]  bitcnt, bytecnt, dbit;
  logic [23:0] faddr;
  logic [31:0] fword;
  logic [7:0]  fdata;
  logic        addr_done;

  always @(negedge cs_n[1]) begin
    bitcnt <= 3'd0; bytecnt <= 3'd0; hdr <= 24'd0;
    dbit <= 3'd0; addr_done <= 1'b0; miso <= 1'b1;
  end

  always @(posedge sck) if (!cs_n[1]) begin
    hdr <= {hdr[22:0], mosi};
    bitcnt <= bitcnt + 3'd1;
    if (bitcnt == 3'd7) begin
      bitcnt <= 3'd0;
      if (bytecnt < 3'd3) bytecnt <= bytecnt + 3'd1;
      else if (bytecnt == 3'd3) begin
        bytecnt <= 3'd4;
        faddr <= {hdr[22:0], mosi};
        addr_done <= 1'b1;
      end
    end
  end

  always @(negedge sck) if (!cs_n[1] && addr_done) begin
    if (dbit == 3'd0) begin
      fword <= flash32[faddr[20:2] - 19'h40000];
      fdata <= flash32[faddr[20:2] - 19'h40000] >> (8 * faddr[1:0]);
      miso  <= (flash32[faddr[20:2] - 19'h40000] >> (8 * faddr[1:0])) >> 7;
      dbit  <= 3'd1;
    end else begin
      miso <= fdata[7 - dbit];
      if (dbit == 3'd7) begin
        dbit  <= 3'd0;
        faddr <= faddr + 24'd1;
      end else begin
        dbit <= dbit + 3'd1;
      end
    end
  end

  assign got_0000   = psram[20'h00000];
  assign got_0100   = psram[20'h00100];
  assign got_3000   = psram[20'h03000];
  assign got_ds3000 = psram[20'h13000];
  assign got_bios4a00 = psram[20'h2B600 + 20'h4A00];
  assign exp_0000     = flash32[64] & 16'hFFFF;
  assign exp_0100     = flash32[64 + 128] & 16'hFFFF;
  assign exp_3000     = flash32[64 + 16'h1800] & 16'hFFFF;
  assign exp_bios4a00 = flash32[64 + 16'h2500] & 16'hFFFF;
endmodule
