// boot_spi_tb - the config-flash boot reader through the real SPI master.
//
// The flash model answers a mode-0 0x03 read: it samples the command and the
// 24-bit address on the rising edges and drives the data bytes on the falling
// edges. The reader must return the little-endian 32-bit word at BASE + addr*4.
module boot_spi_tb (
  input  logic        clk,
  input  logic        rst,
  input  logic        start,
  input  logic [14:0] addr,
  output logic [31:0] rdata,
  output logic        busy,
  output logic        done
);
  logic        spi_we;
  logic [3:0]  spi_addr;
  logic [15:0] spi_wdata, spi_rdata;
  logic        sck, mosi, miso;
  logic [1:0]  cs_n;

  boot_spi_read #(.BASE(24'h100000)) u_read (
    .clk(clk), .rst(rst),
    .start(start), .addr(addr),
    .rdata(rdata), .busy(busy), .done(done),
    .spi_we(spi_we), .spi_addr(spi_addr),
    .spi_wdata(spi_wdata), .spi_rdata(spi_rdata)
  );

  deep16_spi u_spi (
    .clk(clk), .rst(rst),
    .we(spi_we), .addr(spi_addr), .wdata(spi_wdata), .rdata(spi_rdata),
    .sck(sck), .mosi(mosi), .cs_n(cs_n), .miso(miso)
  );

  // ---- P25Q32U 0x03 read model ----------------------------------------
  localparam int MEM_BYTES = 1 << 21;   // covers 0x100000 + the 0x13000 image
  logic [7:0] mem [0:MEM_BYTES-1];

  integer i;
  initial begin
    for (i = 0; i < MEM_BYTES; i++) mem[i] = 8'hFF;
    // Word 0: 0x04030201, word 1: 0x08070605.
    mem[24'h100000] = 8'h01; mem[24'h100001] = 8'h02;
    mem[24'h100002] = 8'h03; mem[24'h100003] = 8'h04;
    mem[24'h100004] = 8'h05; mem[24'h100005] = 8'h06;
    mem[24'h100006] = 8'h07; mem[24'h100007] = 8'h08;
    // Word 4 (0x100010): 0xDDCCBBAA.
    mem[24'h100010] = 8'hAA; mem[24'h100011] = 8'hBB;
    mem[24'h100012] = 8'hCC; mem[24'h100013] = 8'hDD;
    // Word 1000 (0x100FA0): 0x44332211.
    mem[24'h100FA0] = 8'h11; mem[24'h100FA1] = 8'h22;
    mem[24'h100FA2] = 8'h33; mem[24'h100FA3] = 8'h44;
  end

  logic [23:0] hdr;
  logic [2:0]  bitcnt, bytecnt, dbit;
  logic [23:0] faddr;
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
      fdata <= mem[faddr];
      miso  <= mem[faddr][7];
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
endmodule
