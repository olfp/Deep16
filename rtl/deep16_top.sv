// Deep16 RTL - top level: memory array, boot ROM, keyboard FIFO, wiring.
//
// Memory lives inside the RTL (2^20 words of 16 bit, filled with 0xFFFF, boot
// ROM at 0xFFFF0) as decided in archive/VERILOG.md - an on-chip FPGA build needs no
// external memory model, and get_memory_slice becomes a pointer away.
module deep16_top
  import deep16_pkg::*;
(
  input  logic        clk,
  input  logic        rst,

  // step interface (one pulse = one retired instruction)
  input  logic        i_step,
  // diagnostic free-run: stay running past a retirement (see deep16_core)
  input  logic        i_free,
`ifdef D16_NANO
  // One clk_cpu pulse when the tile engine reaches the control-7 raster line.
  input  logic        raster_irq,
`endif
  output logic        o_done,
  output logic        o_result,
  output logic        o_busy,

  // keyboard FIFO push (IDE keystrokes)
  input  logic        kbd_push,
  input  logic [15:0] kbd_push_data,
  input  logic        kbd_clear,

  // UART console (D16MINI.md §4.4): the host injects RX bytes here and drains
  // what the CPU transmitted. On the board these become real pins instead.
  input  logic        uart_rx_push,
  input  logic [15:0] uart_rx_push_data,
  input  logic        uart_tx_take,
  input  logic        uart_host_ctrl_we,     // host FIFO reset (IDE), OR-ed with the CPU's
  input  logic [15:0] uart_host_ctrl_data,
  output logic [15:0] uart_tx_data_out,
  output logic [15:0] uart_tx_avail,
  output logic [15:0] uart_rx_avail,
  // the console pins themselves: the board drives uart_rxd from the USB-UART
  // bridge and takes uart_txd back to it. In simulation uart_rxd is tied high
  // (idle) and the receiver is fed by uart_rx_push instead.
  output logic        uart_txd,
  input  logic        uart_rxd,
`ifdef D16NANO
  // CPU tilemap console port (sample in the CPU domain; the board synchronises
  // it into the 25.2 MHz pixel domain). Control writes use tile_ctrl.
  output logic        tile_we,
  output logic        tile_ctrl,
  output logic [1:0]  tile_tgt,
  output logic [11:0] tile_addr,
  output logic [15:0] tile_data,
  // Read-only display status from the tile engine, synchronised into the CPU
  // domain by the board. bit 0 = vblank level, bit 1 = frame toggle.
  input  logic [15:0] tile_status,
`endif
`ifdef D16_PERIPH
  // SPI master (SD card / config flash). The board maps these to the SD
  // socket and the on-board P25Q32U; the protocol runs in software.
  output logic        spi_sck,
  output logic        spi_mosi,
  input  logic        spi_miso,
  output logic [1:0]  spi_cs_n,
  // I2S output: BCLK/LRCLK/DIN to the MAX98357A on J5 5/6/7.
  output logic        i2s_bclk,
  output logic        i2s_lrclk,
  output logic        i2s_din,
`endif

  // harness debug bus
  input  logic        dbg_en,
  input  logic        dbg_we,
  input  logic [7:0]  dbg_idx,
  input  logic [15:0] dbg_wdata,
  output logic [15:0] dbg_rdata,
  // FSH and debugger writes reach the cache from the harness / core
  input  logic        i_cache_flush,
  input  logic        i_cache_inv,
  input  logic [10:3]  i_cache_inv_line,
  output logic [31:0] o_cache_hits,
  output logic [31:0] o_cache_misses,
  output logic [31:0] o_cache_penalty
`ifdef PSRAM
  // PSRAM (board only): the open-source controller's word interface.
  , input  logic        psram_clk      // controller clock (51 MHz)
  , output logic        psram_read
  , output logic        psram_write
  , output logic        psram_burst     // two-word read (cache fill)
  , output logic [21:0] psram_addr
  , output logic [15:0] psram_din
  , input  logic [15:0] psram_dout
  , input  logic [15:0] psram_dout2
  , input  logic        psram_busy
  , output logic        o_boot_done    // loader finished, core released
  , output logic        o_boot_err     // a PSRAM read-back did not match
  , output logic        o_core_halt    // diagnostic: the core hit a halt word
  , output logic [31:0] o_core_instrs  // diagnostic: retired instructions
  , output logic [20:0] o_dbg_if_addr  // diagnostic: fetch address presented
`endif
);

  // ---- main memory (D16MINI.md §4.1, §6.2) -----------------------------
  // Two builds of one array. The board build (`D16MINI`) shrinks it to the 24
  // BSRAM blocks of the window and decodes the whole map: RAM, the 16-word boot
  // ROM (a LUT, not part of the image), and the 0xFFFF fill everywhere else.
  // The simulation build keeps the 1 MB array, where everything below MEM_WORDS
  // is memory and the boot ROM is planted in the array.
`ifdef D16MINI
  // 24 blocks, not the 26 the part has: GowinSynthesis infers a 16-bit RAM as
  // four 4-bit-wide, 4,096-deep slices, so the depth rounds up to 4,096 and
  // 26,624 words measure 28 blocks. 24,576 (24 blocks) is the vendor ceiling
  // (§4.7). nextpnr's 26 was Yosys' 1,024-word packing, not the chip's.
  // The PSRAM build only keeps the *packed* image in this array (16,384 words
  // = 16 blocks), so the loader's source no longer costs 24 blocks.
  `ifdef PSRAM
  localparam int RAM_WORDS = 16384;               // 16 blocks x 1024 words
  `else
  localparam int RAM_WORDS = 24576;               // 24 blocks x 1024 words
  `endif
`else
  localparam int RAM_WORDS = MEM_WORDS;
`endif
  localparam int ADDR_BITS = $clog2(RAM_WORDS);

`ifndef USER_FLASH
  reg [15:0] mem [0:RAM_WORDS-1] /*verilator public*/;
`endif

  // Everything the board does not back reads the fill and drops its writes -
  // including the kernel's echo cell at 0xF0064 (D16MINI.md §6.4): on the board
  // it reads 0xFFFF, so echo stays on, and a toggle write goes nowhere. Echo is
  // software's business if it is wanted; it has no hardware home.
  //
  // The RAM read itself is *unconditional*, and this decode runs after the read
  // register (see the read ports below). That matters: with the decode folded
  // into the read - `(a < RAM_WORDS) ? mem[a] : fill` - the open-source flow
  // stops recognising the array as block RAM and falls back to LUT RAM, which is
  // eight times the chip's logic. Reading mem[] first and muxing the ROM and the
  // fill behind the register keeps the memory a plain two-port RAM.
`ifdef D16MINI
  function automatic logic [15:0] non_ram(input logic [20:0] a);
    if (a >= 21'(ROM_BASE) && a < 21'(ROM_BASE + ROM_WORDS))
      non_ram = boot_rom_word(int'(a) - int'(ROM_BASE));
    else
      non_ram = 16'hFFFF;
  endfunction
`endif

  // ---- keyboard FIFO (polled: KBD_STATUS 0xF0060, KBD_DATA 0xF0062) ----
  // 16 entries is plenty for human typing and keeps the FIFO out of the area
  // budget: at 128 entries it was the largest SSRAM consumer in the build,
  // even though the board tied kbd_push to 0. The count stays 8-bit because
  // the debug bus and the core's status port read it as a word.
  localparam int KBD_FIFO_DEPTH = 16;
  logic [15:0] kbd_fifo [0:KBD_FIFO_DEPTH-1];
  logic [3:0]  kbd_head, kbd_tail;
  logic [7:0]  kbd_count;
  logic        kbd_ready, kbd_full, kbd_pop;
  logic [15:0] kbd_head_data;

  logic [15:0] mem_rdata;
  logic [20:0] mem_addr;
  logic        mem_rd;
  logic        mem_we;
  logic        mem_valid, mem_store_ack;
  logic [20:0] mem_waddr;
  logic [15:0] mem_wdata;
`ifdef PSRAM
  logic        mem_store_ack_raw;   // PSRAM bridge ack before peripheral bypass
  // Config-flash boot read: the loader shares the SPI master until boot_done.
  logic        boot_active;
  logic        boot_spi_we;
  logic [3:0]  boot_spi_addr;
  logic [15:0] boot_spi_wdata, boot_spi_rdata;
`endif
`ifdef D16_PERIPH
  // Timer/SPI stores are claimed by the top-level devices: they must not reach
  // the PSRAM dictionary (0xF0020/0xF0080 are inside the Forth ceiling) and
  // they acknowledge the core immediately. periph_we_q makes the device write
  // a single-cycle strobe even if the core holds mem_we for another cycle.
  wire timer_hit = (mem_waddr >= 21'h0F0020) && (mem_waddr <= 21'h0F002F);
  wire spi_hit   = (mem_waddr >= 21'h0F0080) && (mem_waddr <= 21'h0F008F);
  wire i2s_hit   = (mem_waddr[19:4] == 16'hF00A);
  wire sic_hit   = (mem_waddr[19:4] == 16'hF00B);
  wire periph_we = mem_we && (timer_hit || spi_hit || i2s_hit || sic_hit);
  wire mem_we_mem = mem_we && !periph_we;
  logic periph_we_q;
`else
  wire  mem_we_mem = mem_we;
`endif

`ifdef D16_PERIPH
  // ---- timer and SPI MMIO ----------------------------------------------
  // Both are top-level devices: a store is decoded here and a load is muxed
  // into mem_rdata, so the CPU core needs no new I/O instruction. The timer
  // is the 0xF0020 block; SPI is the 0xF0080 block.
  logic        timer_we, spi_we, i2s_we, sic_we;
  logic [3:0]  timer_addr, spi_addr, i2s_addr, sic_addr;
  logic [15:0] timer_rdata, spi_rdata, i2s_rdata, sic_rdata;
  logic        sic_irq;
  logic [20:0] io_raddr_q;   // address whose data-port word is now valid

  always_ff @(posedge clk) begin
    if (rst) io_raddr_q <= 21'd0;
    else if (mem_rd) io_raddr_q <= mem_addr;
  end

  wire timer_sel = (io_raddr_q >= 21'h0F0020) && (io_raddr_q <= 21'h0F002F);
  wire spi_sel   = (io_raddr_q >= 21'h0F0080) && (io_raddr_q <= 21'h0F008F);
  wire i2s_sel   = (io_raddr_q[19:4] == 16'hF00A);
  wire sic_sel   = (io_raddr_q[19:4] == 16'hF00B);

  always_ff @(posedge clk) begin
    if (rst) periph_we_q <= 1'b0;
    else     periph_we_q <= periph_we;
  end

  assign timer_we   = periph_we && !periph_we_q && timer_hit;
  assign spi_we     = periph_we && !periph_we_q && spi_hit;
  assign i2s_we     = periph_we && !periph_we_q && i2s_hit;
  assign sic_we     = periph_we && !periph_we_q && sic_hit;
  // A load uses the registered read address, a store mem_waddr; the two never
  // coincide, and the registered address is the one the data port is returning.
  assign timer_addr = mem_we ? mem_waddr[3:0] : io_raddr_q[3:0];
  assign spi_addr   = mem_we ? mem_waddr[3:0] : io_raddr_q[3:0];
  assign i2s_addr   = mem_we ? mem_waddr[3:0] : io_raddr_q[3:0];
  assign sic_addr   = mem_we ? mem_waddr[3:0] : io_raddr_q[3:0];

  logic timer_tick;

  deep16_timer #(.CLK_HZ(6_750_000)) u_timer (
    .clk   (clk),
    .rst   (rst),
    .we    (timer_we),
    .addr  (timer_addr),
    .wdata (mem_wdata),
    .rdata (timer_rdata),
    .tick  (timer_tick)
  );

  // Four-source SIC: only the 15 kHz timer is wired in this slice; the raster,
  // audio and keyboard bits are decoded but stay 0 until their sources land.
`ifdef D16_NANO
  wire raster_src = raster_irq;
`else
  wire raster_src = 1'b0;
`endif
  deep16_sic u_sic (
    .clk   (clk),
    .rst   (rst),
    .we    (sic_we),
    .addr  (sic_addr),
    .wdata (mem_wdata),
    .rdata (sic_rdata),
    .src   ({raster_src, 1'b0, timer_tick, 1'b0}),
    .irq   (sic_irq)
  );

  // Config-flash boot read: the loader shares the SPI master and its pins
  // until boot_done, then the CPU owns them.
`ifdef USER_FLASH
  wire        spi_we_m    = boot_active ? boot_spi_we    : spi_we;
  wire [3:0]  spi_addr_m  = boot_active ? boot_spi_addr  : spi_addr;
  wire [15:0] spi_wdata_m = boot_active ? boot_spi_wdata : mem_wdata;
  assign boot_spi_rdata = spi_rdata;   // the loader reads STATUS/DATA too
`else
  wire        spi_we_m    = spi_we;
  wire [3:0]  spi_addr_m  = spi_addr;
  wire [15:0] spi_wdata_m = mem_wdata;
`endif

  deep16_spi u_spi (
    .clk   (clk),
    .rst   (rst),
    .we    (spi_we_m),
    .addr  (spi_addr_m),
    .wdata (spi_wdata_m),
    .rdata (spi_rdata),
    .sck   (spi_sck),
    .mosi  (spi_mosi),
    .cs_n  (spi_cs_n),
    .miso  (spi_miso)
  );


  logic i2s_irq_unused;
  deep16_i2s u_i2s (
    .clk      (clk),
    .rst      (rst),
    .we       (i2s_we),
    .addr     (i2s_addr),
    .wdata    (mem_wdata),
    .rdata    (i2s_rdata),
    .bclk     (i2s_bclk),
    .lrclk    (i2s_lrclk),
    .din      (i2s_din),
    .fifo_irq (i2s_irq_unused)
  );
`endif
`ifndef D16_PERIPH
  /* verilator lint_off UNUSEDSIGNAL */
  logic sic_irq;          // no SIC in this profile: the core's IRQ stays low
  assign sic_irq = 1'b0;
  /* verilator lint_on UNUSEDSIGNAL */
`endif
  logic [15:0] if_rdata;
  logic [20:0] if_addr;
  logic        if_preempted;
  logic        core_halt;
  logic [31:0] core_instrs;
  // Set by the PSRAM path while a transaction is in flight; the BSRAM build
  // always has its word next cycle, so it stays low.
  logic        mem_stall;

  // ---- UART console ------------------------------------------------------
  logic        uart_tx_we, uart_rx_take, uart_ctrl_we;
  logic [15:0] uart_tx_data, uart_ctrl_data;
  logic [15:0] uart_status, uart_rx_data;
  logic [15:0] uart_rx_count;
  /* verilator lint_off UNUSEDSIGNAL */
  logic [15:0] uart_tx_count;   // counts only; the host reads the monitor FIFO
  /* verilator lint_on UNUSEDSIGNAL */

  // ---- synchronous main memory (D16MINI.md §4.1) ------------------------
  // The reads are registered: one clock after the address is presented the word
  // is on the bus. The core prefetches the instruction address and issues the
  // data address in EX, so both land exactly where the combinational array used
  // to deliver them. This build has no cache (D16MINI is cacheless), so the
  // FSH flush and the cache-invalidate inputs have nothing to do.
  // the one read port's registered result, the address it was read for, and
  // whether that address was a load's (rather than the fetch's), plus the
  // store-to-load bypass condition and the store's data
  logic [15:0] ram_q;
  logic [20:0] ram_raddr_q;
  logic        ram_was_data_q;
  logic        ram_hit_q;
  logic [15:0] ram_store_q;
  /* verilator lint_off UNUSEDSIGNAL */
  logic        core_cache_flush;   // the core's FSH: no cache to flush here
  logic        _unused_inputs;
  /* verilator lint_on UNUSEDSIGNAL */
  // Inputs the board build does not use: no cache to flush, and the monitor FIFO
  // that uart_tx_take drains is not built there.
`ifdef PSRAM
  assign _unused_inputs = &{1'b0, i_cache_flush, i_cache_inv, i_cache_inv_line,
                            uart_tx_take};
`else
  // the board-only diagnostics have no reader in the BSRAM builds
  assign _unused_inputs = &{1'b0, i_cache_flush, i_cache_inv, i_cache_inv_line,
                            uart_tx_take, core_halt, core_instrs};
`endif

  // The IDE still shows the cache counters; with no cache they read zero.
  assign o_cache_hits    = 32'd0;
  assign o_cache_misses  = 32'd0;
  assign o_cache_penalty = 32'd0;

`ifdef PSRAM
  logic boot_done, boot_err;
  wire  core_rst = rst || !boot_done;
  assign o_boot_done = boot_done;
  assign o_boot_err  = boot_err;
  assign o_core_halt   = core_halt;
  assign o_core_instrs = core_instrs;
  assign o_dbg_if_addr = if_addr;
`else
  wire  core_rst = rst;
`endif

`ifdef D16NANO
  // D16nano: the reduced IF/ID/EX-commit core (see deep16_core3.sv). The
  // standard D16 machine keeps the five-stage core untouched.
  logic [31:0] core_cycles;
  deep16_core3 u_core (
`else
  deep16_core u_core (
`endif
    .clk       (clk),
    .rst       (core_rst),
`ifdef D16NANO
    .irq       (sic_irq),
`endif
    .i_step    (i_step),
    .i_free    (i_free),
    .mem_stall (mem_stall),
    .o_done    (o_done),
    .o_result  (o_result),
    .o_busy    (o_busy),
    .o_halt    (core_halt),
    .o_instr_count(core_instrs),
`ifdef D16NANO
    .o_cycle_count(core_cycles),
`endif
    .if_addr   (if_addr),
    .if_rdata  (if_rdata),
    .if_preempted(if_preempted),
    .mem_addr  (mem_addr),
    .mem_rd    (mem_rd),
    .mem_rdata (mem_rdata),
    .mem_valid (mem_valid),
    .mem_store_ack (mem_store_ack),
    .mem_we    (mem_we),
    .mem_waddr (mem_waddr),
    .mem_wdata (mem_wdata),
    .kbd_pop   (kbd_pop),
    .kbd_ready (kbd_ready),
    .kbd_head  (kbd_head_data),
    .kbd_count (kbd_count),
    .uart_tx_we    (uart_tx_we),
    .uart_tx_data  (uart_tx_data),
    .uart_rx_take  (uart_rx_take),
    .uart_ctrl_we  (uart_ctrl_we),
    .uart_ctrl_data(uart_ctrl_data),
    .uart_status   (uart_status),
    .uart_rx_data  (uart_rx_data),
    .cache_flush (core_cache_flush),
    .dbg_en    (dbg_en),
    .dbg_we    (dbg_we),
    .dbg_idx   (dbg_idx),
    .dbg_wdata (dbg_wdata),
    .dbg_rdata (dbg_rdata)
  );

  // ---- boot ROM + memory fill ------------------------------------------
  // Written once at startup; the harness refills the array and re-plants the
  // ROM on reset() / load_program(). On the board the array comes from the boot
  // image: the configuration bitstream loads it before the first clock (§6.2.1),
  // so there is no runtime copy and no loader.
`ifdef D16MINI
`ifndef USER_FLASH
  initial begin
    // The image is the *whole* window - the generator fills every unused word
    // with 0xFFFF before it lays the kernel down - so there is no fill loop
    // here. That matters: a 24,576-iteration loop is past slang's unroll limit,
    // and the open-source flow could not elaborate the design with it in place.
    // `npm run image` writes the file, and the path resolves against the tool's
    // working directory - run from artifacts/image/, as build_board_sim.sh does.
    //
    // The PSRAM build reads the range-packed form (16 blocks instead of 24);
    // the loader in deep16_psram_mem expands it into PSRAM.
`ifdef PSRAM
    $readmemh("image-packed.hex", mem);
`else
    $readmemh("image.hex", mem);
`endif
  end
`endif
`else
  initial begin
    for (int i = 0; i < RAM_WORDS; i++) mem[i] = 16'hFFFF;
    for (int i = 0; i < ROM_WORDS; i++) mem[{11'h000, ROM_BASE} + i] = boot_rom_word(i);
  end
`endif

  // ---- synchronous read ports ------------------------------------------
  // Two registered reads, one clock of latency each. The instruction port is
  // addressed by the core's prefetch, so the word is ready when IF wants it.
  // The data port is addressed in MEM and its word lands in WB - exactly where
  // the load's register write and bypass read it (see the core's mem_wb_wdata).
  //
  // There is only **one** read port, shared. A load's data read takes it and the
  // instruction fetch yields that cycle - `if_preempted` turns the preempt into a
  // fetch bubble (one stall per load). That is what makes the memory fit: a Gowin
  // BSRAM block has two ports, and a second read port makes the flow duplicate
  // the whole array (52 blocks against the chip's 26). The hardware could share
  // a port between a read and a write, but neither tool does that for you, so the
  // sharing is done here.
  //
  // The read of mem[] is unconditional - the ROM/fill decode sits behind the
  // register - so the array stays a plain RAM (see non_ram above). The index is
  // the low ADDR_BITS bits of the address: for an address the board cannot back
  // the read is out of the array and its value is discarded by the decode, which
  // is a don't-care rather than a hazard.
  //
  // A store in WB and a load in MEM are one instruction apart, and the array
  // write lands a cycle after the load's read - so a load straight behind a store
  // to the same address would read the *old* word. Stepped runs never see it (the
  // store has retired), free-run does, so the read result is bypassed from the
  // store here.
`ifndef USER_FLASH
  wire        ram_rd_data = mem_rd;
  wire [20:0] ram_raddr   = ram_rd_data ? mem_addr : if_addr;
  wire        ram_hit     = ram_rd_data && mem_we && (mem_waddr == mem_addr);

  always_ff @(posedge clk) begin
    // the RAM read itself, plain and unconditional: a muxed read - the obvious
    // `hit ? bypass : mem[addr]` - stops the flow inferring block RAM
    ram_q          <= mem[ram_raddr[ADDR_BITS-1:0]];
    ram_raddr_q    <= ram_raddr;
    ram_was_data_q <= ram_rd_data;
    ram_hit_q      <= ram_hit;
    ram_store_q    <= mem_wdata;
    // The write port (stores, committed in WB); a store outside the window is
    // dropped - there is no MMIO cell to write, since the UART is decoded in the
    // core and everything else the board does not back is read-only fill.
    //
    // On the PSRAM board this array is the *boot image*, not the memory: every
    // store already lands in PSRAM through deep16_psram_mem. Writing it here as
    // well corrupted the image with the running system's own cells (boot_ptr,
    // boot_done, the wordlist head), so a button reset - which does not
    // reconfigure the FPGA and therefore keeps BSRAM - re-copied last boot's
    // variables and came up with no script and no prompt. A power cycle
    // restored BSRAM from the bitstream, which is why only the reset button
    // showed it.
`ifdef PSRAM
    // boot_done is a real signal, not a constant, so the array keeps its write
    // port and stays BSRAM; removing the port made the flow give up and build
    // the whole image out of LUTs. The core is held in reset until boot_done,
    // so this store path is dead exactly when the kernel runs.
    if (mem_we_mem && !boot_done && mem_waddr < 21'(RAM_WORDS))
      mem[mem_waddr[ADDR_BITS-1:0]] <= mem_wdata;
`else
    if (mem_we_mem && mem_waddr < 21'(RAM_WORDS))
      mem[mem_waddr[ADDR_BITS-1:0]] <= mem_wdata;
`endif
  end
`endif


`ifdef PSRAM
  // ---- PSRAM backing store (board build) --------------------------------
  // The BSRAM array stays as the boot image; this copies it into PSRAM, then
  // serves the core one transaction at a time through the bridge.
`ifndef USER_FLASH
  logic [13:0] img_addr;              // packed image: 16,384 words
  logic [15:0] img_q;
  always_ff @(posedge clk) img_q <= mem[img_addr];
`endif

  deep16_psram_mem u_psram_mem (
    .clk_cpu(clk), .rst(rst), .clk_ip(psram_clk), .ctl_dout_valid(1'b0),
`ifdef USER_FLASH
    .img_addr(), .img_data(16'd0),
`else
    .img_addr(img_addr), .img_data(img_q),
`endif
    .if_addr(if_addr), .if_rdata(if_rdata), .if_preempted(if_preempted),
    .mem_addr(mem_addr), .mem_rd(mem_rd), .mem_rdata(psram_mem_rdata),
    .mem_valid(mem_valid),
    .mem_store_ack(mem_store_ack_raw),
    .mem_we(mem_we_mem), .mem_waddr(mem_waddr), .mem_wdata(mem_wdata),
    .mem_stall(mem_stall), .boot_done(boot_done), .boot_err(boot_err),
    .cache_flush(core_cache_flush),
    .boot_active(boot_active),
    .boot_spi_we(boot_spi_we), .boot_spi_addr(boot_spi_addr),
    .boot_spi_wdata(boot_spi_wdata), .boot_spi_rdata(boot_spi_rdata),
    .ctl_read(psram_read), .ctl_write(psram_write), .ctl_burst(psram_burst),
    .ctl_addr(psram_addr), .ctl_din(psram_din),
    .ctl_dout(psram_dout), .ctl_dout2(psram_dout2), .ctl_busy(psram_busy)
  );
`ifdef D16_PERIPH
  // A timer/SPI store is acknowledged by the top-level device, not by PSRAM.
  assign mem_store_ack = mem_store_ack_raw || periph_we;
`else
  assign mem_store_ack = mem_store_ack_raw;
`endif
  // D16nano benchmark time base: the core's 32-bit CPU cycle counter at the
  // unused I/O cells 0xF0068/0xF006A (the keyboard block uses 0x60..0x64).
`ifdef D16NANO
  logic [15:0] psram_mem_rdata;
  assign mem_rdata = timer_sel ? timer_rdata :
                     spi_sel ? spi_rdata :
                     i2s_sel ? i2s_rdata :
                     sic_sel ? sic_rdata :
                     (mem_addr == 21'h0F0066) ? tile_status :
                     (mem_addr == 21'h0F0068) ? core_cycles[15:0] :
                     (mem_addr == 21'h0F006A) ? core_cycles[31:16] :
                     psram_mem_rdata;
`else
  assign mem_rdata = psram_mem_rdata;
`endif
`else
  // The read result belongs to whoever asked for it: the fetch, or the load. The
  // store-to-load bypass is applied here, behind the read register, so the RAM
  // read stays unconditional.
  wire [15:0] ram_decoded = (ram_raddr_q < 21'(RAM_WORDS)) ? ram_q
`ifdef D16MINI
                          : non_ram(ram_raddr_q);
`else
                          : 16'hFFFF;
`endif
  wire [15:0] ram_data = ram_hit_q ? ram_store_q : ram_decoded;

  // The fetch's word is not on the bus the cycle after a load took the port;
  // the core ignores it and re-issues (deep16_core.sv, if_hit).
  assign if_preempted = ram_was_data_q;
`ifndef PSRAM
  assign mem_stall = 1'b0;
`endif
  assign if_rdata     = ram_was_data_q ? 16'hFFFF : ram_data;
`ifdef D16_PERIPH
  assign mem_rdata    = timer_sel ? timer_rdata :
                        spi_sel ? spi_rdata :
                        i2s_sel ? i2s_rdata :
                        sic_sel ? sic_rdata :
                        (ram_was_data_q ? ram_data : 16'hFFFF);
`else
  assign mem_rdata    = ram_was_data_q ? ram_data : 16'hFFFF;
`endif
  logic mem_rd_d, mem_we_d;
  always_ff @(posedge clk) mem_rd_d <= mem_rd;
  always_ff @(posedge clk) mem_we_d <= mem_we;
  assign mem_valid = mem_rd_d;
  assign mem_store_ack = mem_we_d;
`endif

  // The SWI vector used to be read here combinationally (`mem[2]`), a third
  // asynchronous port on the array - which no BSRAM has, so it kept the whole
  // memory out of block RAM. The core reads it through the data port like a load
  // into R15 now (deep16_core.sv, the SWI branch), so the array is strictly
  // two-port: one shared read, one write.

  // The write port (stores, committed in WB) shares the array with the read
  // above; a store outside the window is dropped - there is no MMIO cell to
  // write: the UART is decoded in the core, and everything else the board does
  // not back is read-only fill.

`ifdef D16NANO
  // CPU console window. Each memory has its own 4K-word page so the window
  // decode is one comparison per window; the tile engine gets a 2-bit target:
  //   0xF1000  tilemap (82x26)     0xF3000  tile bank (96 x 32, writable)
  //   0xF4000  sprite bank        0xF5000  OAM (0x00..0x1F), palette (0x80..0x8F)
  //   0xF2000/2/4/6  cursor, row offset, scroll_x, scroll_y
  //   0xF2008        tilemap page select (bit 0 write, bit 1 display)
  //   0xF200A        sprite write page (0 Red/demo, 1 Purple, 2 Yellow)
  //   0xF200C        control 6: per-row fine scroll
  //   0xF200E        control 7: raster line compare
  wire tile_hit = mem_we && (mem_waddr >= 21'h0F1000) && (mem_waddr <= 21'h0F1853);
  wire bank_hit = mem_we && (mem_waddr >= 21'h0F3000) && (mem_waddr <= 21'h0F3BFF);
  wire spr_hit  = mem_we && (mem_waddr >= 21'h0F4000) && (mem_waddr <= 21'h0F47FF);
  wire attr_hit = mem_we && (mem_waddr >= 21'h0F5000) && (mem_waddr <= 21'h0F50FF);
  wire ctrl_hit = mem_we && ((mem_waddr == 21'h0F2000) || (mem_waddr == 21'h0F2002) ||
                             (mem_waddr == 21'h0F2004) || (mem_waddr == 21'h0F2006) ||
                             (mem_waddr == 21'h0F2008) || (mem_waddr == 21'h0F200A) ||
                             (mem_waddr == 21'h0F200C) || (mem_waddr == 21'h0F200E));
  assign tile_we   = tile_hit || bank_hit || spr_hit || attr_hit || ctrl_hit;
  assign tile_ctrl = ctrl_hit;
  assign tile_tgt  = tile_hit ? 2'd0 : bank_hit ? 2'd1 : spr_hit ? 2'd2 : 2'd3;
  assign tile_addr = ctrl_hit ? {8'd0, mem_waddr[3:0]} : mem_waddr[11:0];
  assign tile_data = mem_wdata;
`endif

  // ---- UART console (D16MINI.md §4.4) ----------------------------------
  // In simulation the receiver is fed by uart_rx_push; on the board uart_rxd is
  // the pin. TX goes to the pin and to a small monitor FIFO the host drains, so
  // reading the console never competes with the shift engine for the TX FIFO.
  // The console's baud divisor is derived from the clock. The board runs the
  // machine at 27 MHz / 2 (deep16_board.sv, D16MINI.md §4.7); the simulation
  // builds keep 27 MHz because their clock is a step tick, not an oscillator.
`ifdef D16NANO
  localparam int UART_CLK_HZ = 6_750_000;   // 27 MHz / 4 on the board
`elsif D16MINI
  localparam int UART_CLK_HZ = 13_500_000;
`else
  localparam int UART_CLK_HZ = 27_000_000;
`endif
`ifdef D16_PERIPH
  // D16nano tile/config-flash: one-byte TX holding register, enough for a
  // polled byte and for X/YMODEM later. The RX FIFO stays 64 bytes.
  localparam bit UART_RX_ONLY  = 1'b0;
  localparam int UART_TX_DEPTH = 1;
`elsif D16NANO
  // The older packed-image tile build keeps its RX-only console: it has no
  // room for the transmitter and does not need it.
  localparam bit UART_RX_ONLY  = 1'b1;
  localparam int UART_TX_DEPTH = 1;
`else
  localparam bit UART_RX_ONLY  = 1'b0;
  localparam int UART_TX_DEPTH = 64;
`endif
  deep16_uart #(.CLK_HZ(UART_CLK_HZ), .TX_DEPTH(UART_TX_DEPTH),
                .RX_ONLY(UART_RX_ONLY)) u_uart (
    .clk          (clk),
    .rst          (rst),
    .tx_we        (uart_tx_we),
    .tx_data      (uart_tx_data),
    .rx_take      (uart_rx_take),
    .ctrl_we      (uart_ctrl_we | uart_host_ctrl_we),
    .ctrl_data    (uart_host_ctrl_we ? uart_host_ctrl_data : uart_ctrl_data),
    .status       (uart_status),
    .rx_data      (uart_rx_data),
    .rx_push      (uart_rx_push),
    .rx_push_data (uart_rx_push_data),
    .tx_count_o   (uart_tx_count),
    .rx_count_o   (uart_rx_count),
    .uart_txd     (uart_txd),
    .uart_rxd     (uart_rxd)
  );

`ifndef D16MINI
  // The monitor FIFO is a simulation/IDE facility (§4.3): it lets the host read
  // the console without competing with the shift engine for the TX FIFO. The
  // board reads the console from the pin, so it is not built.
  localparam int UTX_DEPTH = 256;
  logic [15:0] utx_mem [0:UTX_DEPTH-1];
  logic [7:0]  utx_head, utx_tail, utx_count;
  always_ff @(posedge clk) begin
    if (rst) begin
      utx_head <= 8'd0; utx_tail <= 8'd0; utx_count <= 8'd0;
    end else if (uart_tx_we) begin
      utx_mem[utx_tail] <= uart_tx_data;
      utx_tail  <= utx_tail + 8'd1;
      utx_count <= utx_count + 8'd1;
    end else if (uart_tx_take && utx_count != 8'd0) begin
      utx_head  <= utx_head + 8'd1;
      utx_count <= utx_count - 8'd1;
    end
  end
  assign uart_tx_data_out = (utx_count != 8'd0) ? utx_mem[utx_head] : 16'h0000;
  assign uart_tx_avail    = {8'h00, utx_count};
`else
  assign uart_tx_data_out = 16'h0000;
  assign uart_tx_avail    = 16'h0000;
`endif
  assign uart_rx_avail    = uart_rx_count;

  // ---- keyboard FIFO ---------------------------------------------------
  always_ff @(posedge clk) begin
    if (kbd_clear) begin
      kbd_head  <= 4'd0;
      kbd_tail  <= 4'd0;
      kbd_count <= 8'd0;
    end else if (kbd_push && !kbd_full) begin
      kbd_fifo[kbd_tail] <= kbd_push_data;
      kbd_tail  <= kbd_tail + 4'd1;
      kbd_count <= kbd_count + 8'd1;
    end else if (kbd_pop && kbd_ready) begin
      kbd_head  <= kbd_head + 4'd1;
      kbd_count <= kbd_count - 8'd1;
    end
  end

  assign kbd_ready     = (kbd_count != 8'd0);
  assign kbd_full      = (kbd_count == 8'd16);
  assign kbd_head_data = kbd_fifo[kbd_head];

endmodule
