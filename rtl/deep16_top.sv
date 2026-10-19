// Deep16 RTL - top level: memory array, boot ROM, keyboard FIFO, wiring.
//
// Memory lives inside the RTL (2^20 words of 16 bit, filled with 0xFFFF, boot
// ROM at 0xFFFF0) as decided in VERILOG.md - an on-chip FPGA build needs no
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
  localparam int RAM_WORDS = 24576;               // 24 blocks x 1024 words
`else
  localparam int RAM_WORDS = MEM_WORDS;
`endif
  localparam int ADDR_BITS = $clog2(RAM_WORDS);

  reg [15:0] mem [0:RAM_WORDS-1] /*verilator public*/;

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
  localparam int KBD_FIFO_DEPTH = 128;   // a power of two, so the full check fits in 8 bits
  logic [15:0] kbd_fifo [0:KBD_FIFO_DEPTH-1];
  logic [7:0]  kbd_head, kbd_tail, kbd_count;
  logic [6:0]  kbd_head_i, kbd_tail_i;
  logic        kbd_ready, kbd_full, kbd_pop;
  logic [15:0] kbd_head_data;

  logic [15:0] mem_rdata;
  logic [20:0] mem_addr;
  logic        mem_rd;
  logic        mem_we;
  logic [20:0] mem_waddr;
  logic [15:0] mem_wdata;
  logic [15:0] if_rdata;
  logic [20:0] if_addr;
  logic        if_preempted;

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
  assign _unused_inputs = &{1'b0, i_cache_flush, i_cache_inv, i_cache_inv_line,
                            uart_tx_take};

  // The IDE still shows the cache counters; with no cache they read zero.
  assign o_cache_hits    = 32'd0;
  assign o_cache_misses  = 32'd0;
  assign o_cache_penalty = 32'd0;

  deep16_core u_core (
    .clk       (clk),
    .rst       (rst),
    .i_step    (i_step),
    .i_free    (i_free),
    .o_done    (o_done),
    .o_result  (o_result),
    .o_busy    (o_busy),
    .if_addr   (if_addr),
    .if_rdata  (if_rdata),
    .if_preempted(if_preempted),
    .mem_addr  (mem_addr),
    .mem_rd    (mem_rd),
    .mem_rdata (mem_rdata),
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
  initial begin
    // The image is the *whole* window - the generator fills every unused word
    // with 0xFFFF before it lays the kernel down - so there is no fill loop
    // here. That matters: a 24,576-iteration loop is past slang's unroll limit,
    // and the open-source flow could not elaborate the design with it in place.
    // `npm run image` writes the file, and the path resolves against the tool's
    // working directory - run from artifacts/image/, as build_board_sim.sh does.
    $readmemh("image.hex", mem);
  end
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
    // the write port (stores, committed in WB); a store outside the window is
    // dropped - there is no MMIO cell to write, since the UART is decoded in the
    // core and everything else the board does not back is read-only fill
    if (mem_we && mem_waddr < 21'(RAM_WORDS))
      mem[mem_waddr[ADDR_BITS-1:0]] <= mem_wdata;
  end

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
  assign if_rdata     = ram_was_data_q ? 16'hFFFF : ram_data;
  assign mem_rdata    = ram_was_data_q ? ram_data : 16'hFFFF;

  // The SWI vector used to be read here combinationally (`mem[2]`), a third
  // asynchronous port on the array - which no BSRAM has, so it kept the whole
  // memory out of block RAM. The core reads it through the data port like a load
  // into R15 now (deep16_core.sv, the SWI branch), so the array is strictly
  // two-port: one shared read, one write.

  // The write port (stores, committed in WB) shares the array with the read
  // above; a store outside the window is dropped - there is no MMIO cell to
  // write: the UART is decoded in the core, and everything else the board does
  // not back is read-only fill.

  // ---- UART console (D16MINI.md §4.4) ----------------------------------
  // In simulation the receiver is fed by uart_rx_push; on the board uart_rxd is
  // the pin. TX goes to the pin and to a small monitor FIFO the host drains, so
  // reading the console never competes with the shift engine for the TX FIFO.
  // The console's baud divisor is derived from the clock. The board runs the
  // machine at 27 MHz / 2 (deep16_board.sv, D16MINI.md §4.7); the simulation
  // builds keep 27 MHz because their clock is a step tick, not an oscillator.
`ifdef D16MINI
  localparam int UART_CLK_HZ = 13_500_000;
`else
  localparam int UART_CLK_HZ = 27_000_000;
`endif
  deep16_uart #(.CLK_HZ(UART_CLK_HZ)) u_uart (
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
      kbd_head  <= 8'd0;
      kbd_tail  <= 8'd0;
      kbd_count <= 8'd0;
    end else if (kbd_push && !kbd_full) begin
      kbd_fifo[kbd_tail_i] <= kbd_push_data;
      kbd_tail  <= kbd_tail + 8'd1;
      kbd_count <= kbd_count + 8'd1;
    end else if (kbd_pop && kbd_ready) begin
      kbd_head  <= kbd_head + 8'd1;
      kbd_count <= kbd_count - 8'd1;
    end
  end

  assign kbd_ready     = (kbd_count != 8'd0);
  assign kbd_full      = (kbd_count == 8'd128);
  assign kbd_head_i     = kbd_head[6:0];
  assign kbd_tail_i     = kbd_tail[6:0];
  assign kbd_head_data = kbd_fifo[kbd_head_i];

endmodule
