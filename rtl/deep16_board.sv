// deep16_board.sv - Tang Nano 9K wrapper for D16MINI (D16MINI.md §4.5).
//
// The whole board: a 27 MHz oscillator, one reset button, the UART pins of the
// on-board USB bridge, a PS/2 keyboard pair through an external 5 V -> 3.3 V
// level shifter, and the LEDs. No PLL is added for the keyboard: the PS/2
// receiver oversamples at the CPU clock.
//
// The CPU does not meet 27 MHz (D16MINI.md §4.7: 14.1 MHz worst case), so the
// oscillator is divided by two and the whole machine runs at 13.5 MHz, which
// closes timing with margin. The divider is a two-bit counter on the 27 MHz
// clock; the UART is told the divided frequency so 115200 stays correct.
//
// Everything simulation-shaped is tied off here: i_step/i_free free-run, the
// debug bus is off, and there is no cache to manage. The PS/2 receiver is the
// one live input besides the UART: its ASCII bytes feed both the UART RX FIFO
// and the architectural keyboard FIFO. The memory comes from the boot image
// baked into the bitstream (§6.2.1) or the user flash, so the CPU starts on the
// kernel with no loader and no copy.
//
// Build with `-DD16MINI` (Verilator) / the matching project define (Gowin): it
// is what shrinks deep16_top's memory to the 24 BSRAM blocks and turns on the
// window decode.
module deep16_board (
  input  logic clk,        // 27 MHz oscillator, pin 52
  input  logic rst_n,      // S1 button, active low
  input  logic btn,        // S2 button, active low
  input  logic ps2_clk,    // PS/2 clock, 3.3 V side of the level shifter
  input  logic ps2_data,   // PS/2 data,  3.3 V side of the level shifter
  output logic spi_sck,    // SPI clock: SD socket
  output logic spi_mosi,   // SPI MOSI
  input  logic spi_miso,   // SPI MISO
  output logic spi_cs_n,   // SPI CS0: microSD
  output logic cfg_sck,    // config flash MCLK (MSPI pin 59, GPIO after DONE)
  output logic cfg_mosi,   // config flash MO   (MSPI pin 61)
  input  logic cfg_miso,   // config flash MI   (MSPI pin 62)
  output logic cfg_cs_n,   // config flash MCS_N (MSPI pin 60)
  input  logic uart_rxd,   // from the on-board USB-UART bridge
  output logic uart_txd,   // to the on-board USB-UART bridge
  output logic i2s_bclk,   // I2S bit clock   (J5 pin 5, FPGA 25)
  output logic i2s_lrclk,  // I2S word select (J5 pin 6, FPGA 26)
  output logic i2s_din,    // I2S data        (J5 pin 7, FPGA 27)
  output logic [5:0] led   // 0 heartbeat, 1 run, 2 halt, 3..5 instruction activity
`ifdef PSRAM
  // PSRAM (HyperRAM) pads - magic names, bound to the package's dedicated pads.
  , output logic [1:0] O_psram_ck
  , output logic [1:0] O_psram_ck_n
  , output logic [1:0] O_psram_cs_n
  , output logic [1:0] O_psram_reset_n
  , inout  wire  [1:0] IO_psram_rwds
  , inout  wire  [15:0] IO_psram_dq
`endif
`ifdef DVI
  // HDMI/DVI pairs: lane 0 blue, 1 green, 2 red, 3 clock (Tang Nano 9K pins
  // 71/70, 73/72, 75/74, 69/68; the ELVDS buffers drive the n side).
  , output logic [3:0] hdmi_tx_p
  , output logic [3:0] hdmi_tx_n
`endif
);

  // ---- clock: 27 MHz / 2 = 13.5 MHz ------------------------------------
  // clk_div[0] is 13.5 MHz at 50 % duty. The machine measures 14.1 MHz worst
  // case (D16MINI.md §4.7), so this leaves ~4 % margin - the next step is
  // area reduction, not a faster divided clock. The divider is the only logic
  // in the 27 MHz domain; the UART is told the divided frequency.
  logic [1:0] clk_div;
  logic       clk_cpu;

  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) clk_div <= 2'd0;
    else        clk_div <= clk_div + 2'd1;
  end
`ifdef D16NANO
  // The reduced core is the area lever: 27 MHz / 4 = 6.75 MHz. The standard
  // D16 machine stays at 13.5 MHz.
  assign clk_cpu = clk_div[1];
`else
  assign clk_cpu = clk_div[0];
`endif

`ifdef PSRAM
  // 27 -> 51 MHz for the open-source controller (the point that works on this
  // board); CLKOUTP is the 90-degree clock the PHY needs.
  wire psram_clk, psram_clk_p, psram_lock;
  psram_pll u_psram_pll(
    .clkout (psram_clk),
    .clkoutp(psram_clk_p),
    .lock   (psram_lock),
    .clkoutd(),
    .clkin  (clk)
  );

  wire        psram_read, psram_write, psram_burst, psram_busy, o_boot_done, o_boot_err;
  wire        o_core_halt;
  wire [31:0] o_core_instrs;
  wire [21:0] psram_addr;
  wire [15:0] psram_din, psram_dout, psram_dout2;

  PsramController #(.FREQ(51_000_000), .LATENCY(3)) u_psram_ctrl (
    .clk        (psram_clk),
    .clk_p      (psram_clk_p),
    .resetn     (rst_n),
    .read       (psram_read),
    .write      (psram_write),
    .addr       (psram_addr),
    .din        (psram_din),
    .byte_write (1'b0),
    .burst      (psram_burst),
    .din2       (16'h0000),          // writes are single-word (write-through)
    .dout       (psram_dout),
    .dout2      (psram_dout2),
    .busy       (psram_busy),
    .O_psram_ck (O_psram_ck),
    .IO_psram_rwds(IO_psram_rwds),
    .IO_psram_dq(IO_psram_dq),
    .O_psram_cs_n(O_psram_cs_n)
  );
  assign O_psram_ck_n    = 2'b00;      // single-ended clock (the tested setup)
  assign O_psram_reset_n = {2{rst_n}};
`endif

  // ---- reset -----------------------------------------------------------
  // The button is asynchronous. Register it in the CPU clock domain, then hold
  // reset for a few CPU clocks after it is released, so the pipeline starts
  // from a settled state.
  localparam int unsigned RESET_CYCLES = 16;

  logic [3:0]  rst_sync;
  logic [15:0] rst_hold;
  logic        rst;

  // diagnostic fetch address (PSRAM builds drive it; unused otherwise)
`ifdef PSRAM
  wire [20:0] dbg_if_addr;
`else
  wire [20:0] dbg_if_addr = 21'd0;
`endif

  always_ff @(posedge clk_cpu or negedge rst_n) begin
    if (!rst_n) begin
      rst_sync <= 4'b0000;
      rst_hold <= RESET_CYCLES[15:0];
    end else begin
      rst_sync <= {rst_sync[2:0], 1'b1};
      if (rst_sync != 4'hF)          rst_hold <= RESET_CYCLES[15:0];
      else if (rst_hold != 16'd0)    rst_hold <= rst_hold - 16'd1;
    end
  end
  assign rst = (rst_hold != 16'd0);

`ifdef DVI
  // ---- DVI/HDMI text console -------------------------------------------
  // A second PLL makes the pixel and 5x serializer clocks. The text build
  // uses 25.2/126 MHz (800x525, 640x480@60); the tile build uses 74.25/371.25
  // MHz (1650x750, 1280x720@60) and renders at the DVI PLL's 24.75 MHz
  // (serial / 15). The console mirror listens to the same uart_txd the USB bridge
  // sees, so it shows exactly what a host terminal would.
  wire dvi_pclk, dvi_clk5, dvi_render_clk, dvi_lock;
  dvi_pll u_dvi_pll (
    .clk        (clk),
    .clk_pixel  (dvi_pclk),
    .clk_5x     (dvi_clk5),
    .clk_render (dvi_render_clk),
    .lock       (dvi_lock)
  );

  // `rst` is synchronous to clk_cpu; give the pixel domain its own deassert.
  logic       dvi_rst;
  logic [1:0] dvi_rst_sync;
  always_ff @(posedge dvi_pclk) dvi_rst_sync <= {dvi_rst_sync[0], rst};
  assign dvi_rst = dvi_rst_sync[1] | ~dvi_lock;   // hold until the PLL locks

`ifdef DVI_TILE
  // The render side runs at 24.75 MHz from the DVI PLL (serial / 15).
  logic       dvi_rst_render;
  logic [1:0] dvi_rst_render_sync;
  always_ff @(posedge dvi_render_clk)
    dvi_rst_render_sync <= {dvi_rst_render_sync[0], rst};
  assign dvi_rst_render = dvi_rst_render_sync[1] | ~dvi_lock;
`endif

  logic [7:0] dvi_r, dvi_g, dvi_b;
  logic       dvi_hs, dvi_vs, dvi_de;

`ifdef DVI_TILE
  logic        dvi_vblank, dvi_frame_tick;
  logic        dvi_cpu_we, dvi_cpu_ctrl;
  logic [1:0]  dvi_cpu_tgt;
  logic [11:0] dvi_cpu_addr;
  logic [15:0] dvi_cpu_data;
`ifdef D16NANO
  // Tile/control writes cross from the CPU to the 24.75 MHz render domain. Sixteen entries of {ctrl,addr,data}; the BIOS writes one entry per
  // store and the render side drains one per render clock. No CPU stall is needed:
  // the consumer is nearly twice as fast as the producer, and a dropped entry
  // at full is a renderer glitch, not a memory corruption (the PSRAM mirror is
  // still written by the store).
  localparam int TF_DEPTH = 16;
  localparam int TF_AW    = 4;
  logic [15:0] tf_data [0:TF_DEPTH-1];
  logic [11:0] tf_addr [0:TF_DEPTH-1];
  logic [1:0]  tf_tgt  [0:TF_DEPTH-1];
  logic        tf_ctrl [0:TF_DEPTH-1];
  logic [TF_AW:0] tf_wbin, tf_rbin;
  logic [TF_AW:0] tf_wgray, tf_rgray;
  logic [TF_AW:0] tf_rg_s0, tf_rg_s1;   // read pointer -> write domain
  logic [TF_AW:0] tf_wg_s0, tf_wg_s1;   // write pointer -> read domain

  wire [TF_AW:0] tf_wbin_n = tf_wbin + (tile_we ? 1'b1 : 1'b0);
  wire [TF_AW:0] tf_wgray_n = (tf_wbin_n >> 1) ^ tf_wbin_n;
  wire [TF_AW:0] tf_rbin_n = tf_rbin + (dvi_cpu_we ? 1'b1 : 1'b0);
  wire [TF_AW:0] tf_rgray_n = (tf_rbin_n >> 1) ^ tf_rbin_n;
  wire           tf_full  = (tf_wgray_n == {~tf_rg_s1[TF_AW:TF_AW-1],
                                            tf_rg_s1[TF_AW-2:0]});
  wire           tf_we    = tile_we && !tf_full;
  wire           tf_empty = (tf_rgray == tf_wg_s1);

  always_ff @(posedge clk_cpu) begin
    if (rst) begin
      tf_wbin <= '0; tf_wgray <= '0; tf_rg_s0 <= '0; tf_rg_s1 <= '0;
    end else begin
      tf_rg_s0 <= tf_rgray;
      tf_rg_s1 <= tf_rg_s0;
      if (tf_we) begin
        tf_data[tf_wbin[TF_AW-1:0]] <= tile_data;
        tf_addr[tf_wbin[TF_AW-1:0]] <= tile_addr;
        tf_tgt [tf_wbin[TF_AW-1:0]] <= tile_tgt;
        tf_ctrl[tf_wbin[TF_AW-1:0]] <= tile_ctrl;
        tf_wbin  <= tf_wbin_n;
        tf_wgray <= tf_wgray_n;
      end
    end
  end

  always_ff @(posedge dvi_render_clk) begin
    if (dvi_rst_render) begin
      tf_rbin <= '0; tf_rgray <= '0; tf_wg_s0 <= '0; tf_wg_s1 <= '0;
    end else begin
      tf_wg_s0 <= tf_wgray;
      tf_wg_s1 <= tf_wg_s0;
      if (dvi_cpu_we) begin
        tf_rbin  <= tf_rbin_n;
        tf_rgray <= tf_rgray_n;
      end
    end
  end

  assign dvi_cpu_we   = !tf_empty;
  assign dvi_cpu_ctrl = tf_ctrl[tf_rbin[TF_AW-1:0]];
  assign dvi_cpu_tgt  = tf_tgt [tf_rbin[TF_AW-1:0]];
  assign dvi_cpu_addr = tf_addr[tf_rbin[TF_AW-1:0]];
  assign dvi_cpu_data = tf_data[tf_rbin[TF_AW-1:0]];
`endif

  logic dvi_raster_toggle;

  dvi_tile u_dvi_tile (
    .clk_render (dvi_render_clk),
    .clk_pixel  (dvi_pclk),
    .rst_render (dvi_rst_render),
    .rst_pixel  (dvi_rst),
    .cpu_we   (dvi_cpu_we),
    .cpu_ctrl (dvi_cpu_ctrl),
    .cpu_tgt  (dvi_cpu_tgt),
    .cpu_addr (dvi_cpu_addr),
    .cpu_data (dvi_cpu_data),
    .red      (dvi_r),
    .green    (dvi_g),
    .blue     (dvi_b),
    .hsync    (dvi_hs),
    .vsync    (dvi_vs),
    .de       (dvi_de),
    .vblank   (dvi_vblank),
    .frame_tick (dvi_frame_tick),
    .raster_toggle (dvi_raster_toggle)
  );

`ifdef D16_NANO
  // The render-domain raster toggle is asynchronous to clk_cpu. Two flops and
  // an edge detect turn it into one clk_cpu pulse for SIC bit 3.
  logic        raster_irq;
  logic [1:0]  raster_sync;
  logic        raster_seen;
  always_ff @(posedge clk_cpu) begin
    if (rst) begin raster_sync <= 2'b00; raster_seen <= 1'b0; end
    else begin
      raster_sync <= {raster_sync[0], dvi_raster_toggle};
      raster_seen <= raster_sync[1];
    end
  end
  assign raster_irq = raster_sync[1] ^ raster_seen;
`endif
`else
  dvi_text u_dvi_text (
    .clk     (dvi_pclk),
    .rst     (dvi_rst),
    .uart_rx (uart_txd),
    .red     (dvi_r),
    .green   (dvi_g),
    .blue    (dvi_b),
    .hsync   (dvi_hs),
    .vsync   (dvi_vs),
    .de      (dvi_de)
  );
`endif

  dvi_out u_dvi_out (
    .clk_pixel  (dvi_pclk),
    .clk_5x     (dvi_clk5),
    .rst        (dvi_rst),
    .r          (dvi_r),
    .g          (dvi_g),
    .b          (dvi_b),
    .hsync      (dvi_hs),
    .vsync      (dvi_vs),
    .de         (dvi_de),
    .hdmi_tx_p  (hdmi_tx_p),
    .hdmi_tx_n  (hdmi_tx_n)
  );
`endif

  // ---- display status ---------------------------------------------------
  // vblank and frame_tick come from the scan clock domain. A two-flop
  // synchroniser makes the 16-bit status safe to read from the CPU domain;
  // the frame bit is a toggle, so no multi-bit CDC is involved.
  logic [15:0] rx_avail;   // UART RX FIFO depth: status bit 3 and the PS/2 path
`ifdef D16NANO
  logic [15:0] tile_status;
  logic [1:0]  btn_sync;
  logic        uart_ready_q;
  always_ff @(posedge clk_cpu) begin
    btn_sync     <= {btn_sync[0], ~btn};
    uart_ready_q <= (rx_avail != 16'd0);
  end
`ifdef DVI_TILE
  logic [1:0] dvi_vblank_sync, dvi_frame_sync;
  always_ff @(posedge clk_cpu) begin
    dvi_vblank_sync <= {dvi_vblank_sync[0], dvi_vblank};
    dvi_frame_sync  <= {dvi_frame_sync[0],  dvi_frame_tick};
  end
  // bit 3 is the UART RX-ready level, bit 2 the S2 button: both give the game
  // an input path that does not depend on the UART data read.
  assign tile_status = {12'b0, uart_ready_q, btn_sync[1],
                        dvi_frame_sync[1], dvi_vblank_sync[1]};
`else
  assign tile_status = {12'b0, uart_ready_q, btn_sync[1], 2'b00};
`endif
`endif

  // ---- PS/2 keyboard ---------------------------------------------------
  // The keyboard's 5 V open-collector clock/data lines reach the FPGA through
  // the external level shifter board; the pins here are the 3.3 V side. The
  // receiver runs in the CPU clock domain and its ASCII output feeds both the
  // UART RX FIFO (the D16nano console) and the architectural keyboard FIFO
  // (0xF0060/0xF0062), so the existing BIOS and game input paths need no
  // change.
`ifdef D16NANO
  localparam int PS2_CLK_HZ = 6_750_000;
`else
  localparam int PS2_CLK_HZ = 13_500_000;
`endif
  logic       ps2_valid, ps2_frame_error;
  logic [7:0] ps2_ascii, ps2_scan_code;
  logic [3:0] ps2_modifiers;

  ps2_rx #(.CLK_HZ(PS2_CLK_HZ)) u_ps2 (
    .clk         (clk_cpu),
    .rst         (rst),
    .ps2_clk     (ps2_clk),
    .ps2_data    (ps2_data),
    .valid       (ps2_valid),
    .ascii       (ps2_ascii),
    .scan_code   (ps2_scan_code),
    .modifiers   (ps2_modifiers),
    .frame_error (ps2_frame_error)
  );

  wire ps2_key = ps2_valid && (ps2_ascii != 8'h00);

  // ---- the machine -----------------------------------------------------
`ifdef D16NANO
  logic        tile_we, tile_ctrl;
  logic [1:0]  tile_tgt;
  logic [11:0] tile_addr;
  logic [15:0] tile_data;
`endif
  logic        o_done, o_result, o_busy;
  logic [31:0] cache_hits, cache_misses, cache_penalty;
  logic [15:0] tx_data_out, tx_avail, dbg_rdata;

`ifdef D16_PERIPH
  // One SPI master, two pin sets (see the mux below the instance).
  logic       spi_sck_i, spi_mosi_i, spi_miso_i;
  logic [1:0] spi_cs_i;
`endif

`ifdef D16_NANO
`ifndef DVI_TILE
  logic raster_irq;
  assign raster_irq = 1'b0;
`endif
`endif

  deep16_top u_top (
    .clk  (clk_cpu),
    .rst  (rst),

    // free-run: one retired instruction after another, no step handshake
    .i_step   (1'b1),
    .i_free   (1'b1),
`ifdef D16_NANO
    .raster_irq (raster_irq),
`endif
    .o_done   (o_done),
    .o_result (o_result),
    .o_busy   (o_busy),

    // PS/2 keys arrive on both doors: the D16nano BIOS polls the UART RX
    // FIFO, while the 0xF0060/62 port stays available for software that uses
    // the architectural keyboard interface. On this build only one of them is
    // read, so a key is not consumed twice.
    .kbd_push      (ps2_key),
    .kbd_push_data ({8'h00, ps2_ascii}),
    .kbd_clear     (rst),

    // the console is the pins; the host push/take path is a simulation facility
    .uart_rx_push       (ps2_key),
    .uart_rx_push_data  ({8'h00, ps2_ascii}),
    .uart_tx_take       (1'b0),
    .uart_host_ctrl_we  (1'b0),
    .uart_host_ctrl_data(16'h0000),
    .uart_tx_data_out   (tx_data_out),
    .uart_tx_avail      (tx_avail),
    .uart_rx_avail      (rx_avail),
    .uart_txd           (uart_txd),
    .uart_rxd           (uart_rxd)
`ifdef D16NANO
    , .tile_we          (tile_we)
    , .tile_ctrl        (tile_ctrl)
    , .tile_tgt         (tile_tgt)
    , .tile_addr        (tile_addr)
    , .tile_data        (tile_data)
    , .tile_status      (tile_status)
`endif
`ifdef D16_PERIPH
    , .spi_sck          (spi_sck_i)
    , .spi_mosi         (spi_mosi_i)
    , .spi_miso         (spi_miso_i)
    , .spi_cs_n         (spi_cs_i)
    , .i2s_bclk         (i2s_bclk)
    , .i2s_lrclk        (i2s_lrclk)
    , .i2s_din          (i2s_din)
`endif

    // no debug bus, no cache management on the board
    , .dbg_en    (1'b0),
    .dbg_we    (1'b0),
    .dbg_idx   (8'h00),
    .dbg_wdata (16'h0000),
    .dbg_rdata (dbg_rdata),
    .i_cache_flush   (1'b0),
    .i_cache_inv     (1'b0),
    .i_cache_inv_line(8'h00),
    .o_cache_hits    (cache_hits),
    .o_cache_misses  (cache_misses),
    .o_cache_penalty (cache_penalty)
`ifdef PSRAM
    , .psram_clk    (psram_clk)
    , .psram_read   (psram_read)
    , .psram_write  (psram_write)
    , .psram_burst  (psram_burst)
    , .psram_addr   (psram_addr)
    , .psram_din    (psram_din)
    , .psram_dout   (psram_dout)
    , .psram_dout2  (psram_dout2)
    , .psram_busy   (psram_busy)
    , .o_boot_done  (o_boot_done)
    , .o_boot_err   (o_boot_err)
    , .o_core_halt  (o_core_halt)
    , .o_core_instrs(o_core_instrs)
    , .o_dbg_if_addr(dbg_if_addr)
`endif
  );

`ifndef D16_PERIPH
  assign i2s_bclk  = 1'b0;
  assign i2s_lrclk = 1'b0;
  assign i2s_din   = 1'b0;
`endif

`ifdef D16_PERIPH
  // One SPI master, two pin sets. spi_cs_i[0] is the SD CS, spi_cs_i[1] the
  // config-flash CS; when the flash is selected its pins carry SCK/MOSI/MISO
  // and the SD socket idles.
  wire        cfg_sel = ~spi_cs_i[1];

  assign spi_cs_n = spi_cs_i[0];
  assign cfg_cs_n = spi_cs_i[1];
  assign spi_sck   = cfg_sel ? 1'b0 : spi_sck_i;
  assign spi_mosi  = cfg_sel ? 1'b0 : spi_mosi_i;
  assign cfg_sck   = cfg_sel ? spi_sck_i : 1'b0;
  assign cfg_mosi  = cfg_sel ? spi_mosi_i : 1'b0;
  assign spi_miso_i = cfg_sel ? cfg_miso : spi_miso;
`else
  // The text build has no SPI master; park all SPI pins idle.
  assign spi_sck  = 1'b0;
  assign spi_mosi = 1'b0;
  assign spi_cs_n = 1'b1;
  assign cfg_sck  = 1'b0;
  assign cfg_mosi = 1'b0;
  assign cfg_cs_n = 1'b1;
  /* verilator lint_off UNUSEDSIGNAL */
  wire _unused_cfg_miso = cfg_miso;
  /* verilator lint_on UNUSEDSIGNAL */
`endif

  // ---- heartbeat -------------------------------------------------------
  // The top bit of a free-running counter: ~0.8 Hz, so a powered board blinks
  // without a scope. The CPU has no observable "alive" pin of its own.
  logic [24:0] hb;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) hb <= 25'd0;
    else        hb <= hb + 25'd1;
  end
`ifdef PSRAM
  // All LEDs are active low (0 = lit).
  //   led[0] heartbeat: slow blink = loader done, fast blink = loading
  //   led[1] lit = the core is running (o_busy)
  //   led[2] lit = the core halted on 0xFFFF
  //   led[3..5] blink = instructions retiring (bits 9, 13, 17)
`ifdef DVI_TILE
  // DVI bring-up LEDs (active low): led3 lit = DVI PLL locked, led5 blinking =
  // the renderer produces frames. led0/1/2 are CPU status; led4 is CPU activity.
  // Render-clock heartbeat: proves the 24.75 MHz CLKOUTD3/CLKDIV domain is
  // alive even if the renderer itself never reaches its first frame.
  logic [3:0] q0, q1, q2, q3, q4, q5;
  always_ff @(posedge dvi_render_clk) begin
    if (dvi_rst_render) begin
      q0 <= 4'd0; q1 <= 4'd0; q2 <= 4'd0; q3 <= 4'd0; q4 <= 4'd0; q5 <= 4'd0;
    end else begin
      q0 <= q0 + 4'd1;
      if (q0 == 4'hF) q1 <= q1 + 4'd1;
      if (q0 == 4'hF && q1 == 4'hF) q2 <= q2 + 4'd1;
      if (q0 == 4'hF && q1 == 4'hF && q2 == 4'hF) q3 <= q3 + 4'd1;
      if (q0 == 4'hF && q1 == 4'hF && q2 == 4'hF && q3 == 4'hF) q4 <= q4 + 4'd1;
      if (q0 == 4'hF && q1 == 4'hF && q2 == 4'hF && q3 == 4'hF && q4 == 4'hF)
        q5 <= q5 + 4'd1;
    end
  end
  // Latches, not blinks, so a single event is visible even if the renderer or
  // scan stops after a few lines.
  logic frame_seen, ft_prev;
  always_ff @(posedge dvi_render_clk) begin
    if (dvi_rst_render) begin frame_seen <= 1'b0; ft_prev <= 1'b0; end
    else begin
      ft_prev <= u_dvi_tile.frame_toggle;
      if (u_dvi_tile.frame_toggle != ft_prev) frame_seen <= 1'b1;
    end
  end
  // led2 blinking = 24.75 MHz render clock alive; led3 = DVI PLL lock;
  // led4 = scan path started; led5 = the renderer produced a frame.
  // led0/1 are CPU status.
  assign led[0] = o_boot_err ? 1'b1 : (o_boot_done ? hb[24] : hb[21]);
  assign led[1] = ~o_busy;
  assign led[2] = ~q5[3];
  assign led[3] = ~dvi_lock;
  assign led[4] = ~u_dvi_tile.started;
  assign led[5] = ~frame_seen;
`else
  assign led[0] = o_boot_err ? 1'b1 : (o_boot_done ? hb[24] : hb[21]);
  assign led[1] = ~o_busy;
  assign led[2] = ~o_core_halt;
  assign led[3] = ~o_core_instrs[9];
  assign led[4] = ~o_core_instrs[13];
  assign led[5] = ~o_core_instrs[17];
`endif
`else
  assign led = {5'b11111, hb[24]};
`endif

  // The board reads the console from the pin and has no debug bus or cache, so
  // these are deliberately unread.
  /* verilator lint_off UNUSEDSIGNAL */
  logic _unused;
  assign _unused = &{1'b0, btn, o_done, o_result, o_busy, cache_hits, cache_misses,
                     cache_penalty, tx_data_out, tx_avail, rx_avail, dbg_rdata,
                     dbg_if_addr, ps2_frame_error, ps2_scan_code, ps2_modifiers,
                     spi_miso};
  /* verilator lint_on UNUSEDSIGNAL */

endmodule
