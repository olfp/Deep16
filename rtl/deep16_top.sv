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

  // ---- memory (Entscheidung 4 aus VERILOG.md) -------------------------
  reg [15:0] mem [0:MEM_WORDS-1] /*verilator public*/;

  // ---- keyboard FIFO (polled: KBD_STATUS 0xF0060, KBD_DATA 0xF0062) ----
  localparam int KBD_FIFO_DEPTH = 128;   // a power of two, so the full check fits in 8 bits
  logic [15:0] kbd_fifo [0:KBD_FIFO_DEPTH-1];
  logic [7:0]  kbd_head, kbd_tail, kbd_count;
  logic [6:0]  kbd_head_i, kbd_tail_i;
  logic        kbd_ready, kbd_full, kbd_pop;
  logic [15:0] kbd_head_data;

  logic [15:0] mem_rdata;
  logic [20:0] mem_addr;
  logic        mem_we;
  logic [20:0] mem_waddr;
  logic [15:0] mem_wdata;
  logic [15:0] if_rdata;
  logic [20:0] if_addr;
  // third read port: the SWI vector word at physical 0x0002. A constant
  // address, so the core can know the handler entry in its execute stage
  // instead of one cycle later. Deliberately NOT served from the cache: the
  // IDE installs the handler by poking address 2, and a cached copy would be
  // one FSH away from being stale.
  logic [15:0] vec_rdata;

  // ---- UART console ------------------------------------------------------
  logic        uart_tx_we, uart_rx_take, uart_ctrl_we;
  logic [15:0] uart_tx_data, uart_ctrl_data;
  logic [15:0] uart_status, uart_rx_data;
  logic [15:0] uart_rx_count;
  /* verilator lint_off UNUSEDSIGNAL */
  logic [15:0] uart_tx_count;   // counts only; the host reads the monitor FIFO
  logic        uart_txd;        // TX pin: a board output, unused in simulation
  /* verilator lint_on UNUSEDSIGNAL */

  // ---- cache (phase 3, spec 7.4) ----------------------------------------
  logic        if_hit, dm_hit;
  logic [15:0] if_cached, dm_cached;
  logic [16:0] fill_base;
  logic [127:0] fill_data;
  logic        cache_flush;
  logic        core_cache_flush;
  logic        cache_inv;
  logic [10:3]  cache_inv_line;
  logic [31:0] cache_hits, cache_misses;
  logic        cache_miss_pulse;
  logic [31:0] miss_penalty_cyc;

  assign cache_flush    = i_cache_flush | core_cache_flush;
  assign cache_inv      = i_cache_inv;
  assign cache_inv_line = i_cache_inv_line;
  assign o_cache_hits   = cache_hits;
  assign o_cache_misses = cache_misses;
  assign o_cache_penalty = miss_penalty_cyc;

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
    .vec_rdata (vec_rdata),
    .mem_addr  (mem_addr),
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
  // ROM on reset() / load_program().
  initial begin
    for (int i = 0; i < MEM_WORDS; i++) mem[i] = 16'hFFFF;
    for (int i = 0; i < ROM_WORDS; i++) mem[{11'h000, ROM_BASE} + i] = boot_rom_word(i);
  end

  // ---- cache ------------------------------------------------------------
  // A unified, direct-mapped cache in front of the array. It is transparent:
  // on a hit the array word comes from the cache, on a miss or outside
  // 0x00000-0xEFFFF straight from memory, so both ports always deliver what
  // the bare array would have delivered.
  deep16_cache u_cache (
    .clk         (clk),
    .rst         (rst),
    .if_addr     (if_addr),
    .if_hit      (if_hit),
    .if_rdata    (if_cached),
    .mem_addr    (mem_addr),
    .dm_hit      (dm_hit),
    .mem_rdata   (dm_cached),
    .mem_we      (mem_we),
    .mem_waddr   (mem_waddr),
    .mem_wdata   (mem_wdata),
    .fill_base   (fill_base),
    .fill_data   (fill_data),
    .flush_all   (cache_flush),
    .inv_we      (cache_inv),
    .inv_line    (cache_inv_line),
    .stat_hits   (cache_hits),
    .stat_misses (cache_misses),
    .miss_pulse  (cache_miss_pulse)
  );

  // Read ports. The cache answers on a hit; otherwise the array does, which is
  // why a miss needs no stall. vec_rdata never goes through the cache.
  always_comb begin
    // hit -> the cached word; miss or outside cacheable memory -> the array
    if (dm_hit)                              mem_rdata = dm_cached;
    else if (mem_addr < 21'(MEM_WORDS))      mem_rdata = mem[mem_addr[19:0]];
    else                                     mem_rdata = 16'hFFFF;

    if (if_hit)                              if_rdata = if_cached;
    else if (if_addr < 21'(MEM_WORDS))       if_rdata = mem[if_addr[19:0]];
    else                                     if_rdata = 16'hFFFF;

    vec_rdata = mem[2];

    // the eight words of the line being refilled
    for (int fw = 0; fw < 8; fw++)
      fill_data[fw*16 +: 16] = mem[{fill_base, fw[2:0]}];
  end

  // One write port (stores, which the core commits in its write-back stage).
  // Write-through: the array is always the authoritative copy.
  always_ff @(posedge clk) begin
    if (mem_we && mem_waddr < 21'(MEM_WORDS)) mem[mem_waddr[19:0]] <= mem_wdata;
  end

  // A miss costs one cycle of block fill on top of the access (spec 7.4 puts
  // the penalty at 4-8; the functional behaviour is unaffected either way).
  always_ff @(posedge clk) begin
    if (rst)                    miss_penalty_cyc <= 32'd0;
    else if (cache_miss_pulse)  miss_penalty_cyc <= miss_penalty_cyc + 32'd1;
  end

  // ---- UART console (D16MINI.md §4.4) ----------------------------------
  // In simulation the receiver is fed by uart_rx_push; on the board uart_rxd is
  // the pin. TX goes to the pin and to a small monitor FIFO the host drains, so
  // reading the console never competes with the shift engine for the TX FIFO.
  deep16_uart u_uart (
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
    .uart_rxd     (1'b1)
  );

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
