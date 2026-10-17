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

  // ---- synchronous main memory (D16MINI.md §4.1) ------------------------
  // The reads are registered: one clock after the address is presented the word
  // is on the bus. The core prefetches the instruction address and issues the
  // data address in EX, so both land exactly where the combinational array used
  // to deliver them. This build has no cache (D16MINI is cacheless), so the
  // FSH flush and the cache-invalidate inputs have nothing to do.
  logic [15:0] if_rdata_q;
  /* verilator lint_off UNUSEDSIGNAL */
  logic        core_cache_flush;   // the core's FSH: no cache to flush here
  logic        _cache_inputs_unused;
  /* verilator lint_on UNUSEDSIGNAL */
  assign _cache_inputs_unused = &{1'b0, i_cache_flush, i_cache_inv, i_cache_inv_line};

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

  // ---- synchronous read ports ------------------------------------------
  // Two registered reads: the instruction port (addressed by the core's
  // prefetch, so the word is ready when IF wants it) and the data port
  // (addressed in EX, consumed in MEM). Out of range answers 0xFFFF, the halt
  // word, exactly as the bare array did.
  always_ff @(posedge clk) begin
    if_rdata_q <= (if_addr < 21'(MEM_WORDS)) ? mem[if_addr[19:0]] : 16'hFFFF;
  end
  assign if_rdata = if_rdata_q;

  // The data port is still combinational: a registered data read fights the
  // frozen-pipeline model's store-to-load timing (the store commits in WB, after
  // the load would have sampled), so it needs a load-result stage or forwarding
  // first. See D16MINI.md Phase 2.
  always_comb begin
    mem_rdata = (mem_addr < 21'(MEM_WORDS)) ? mem[mem_addr[19:0]] : 16'hFFFF;
  end

  // The SWI vector is a constant address, read straight through so the handler
  // entry is known in EX as before. (A register fed by the write path is the
  // next step; it needs the host load path to keep it in sync.)
  assign vec_rdata = mem[2];

  // One write port (stores, committed in WB).
  always_ff @(posedge clk) begin
    if (mem_we && mem_waddr < 21'(MEM_WORDS)) mem[mem_waddr[19:0]] <= mem_wdata;
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
