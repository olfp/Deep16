// psram_boot_tb - the whole PSRAM machine (D16MINI + PSRAM) against a
// behavioural word-level PSRAM, so the boot can be watched without the board.
//
// The top's BSRAM array is the boot image; deep16_psram_mem copies it into the
// model (which starts erased, 0xFFFF), verifies word 0, releases the core, and
// then serves every fetch/load/store. The model replaces only the controller's
// PHY and busy timing, not any of the sequencer or the CPU.
module psram_boot_tb (
  input  logic        clk,        // 13.5 MHz CPU clock
  input  logic        clk_ip,     // 51 MHz controller clock
  input  logic        rst,
  input  logic        uart_rx_in,
  output logic        uart_txd,
  output logic        boot_done,
  output logic        boot_err,
  output logic        core_halt,
  output logic [31:0] instrs,
  output logic [20:0] if_addr,
  input  logic [19:0] peek_addr,
  output logic [15:0] peek_data,
  input  logic        dbg_en,
  output logic [5:0]  dbg_st,
  output logic [19:0] dbg_op,
  output logic [15:0] dbg_rdq,
  output logic [15:0] dbg_brd,
  output logic [20:0] dbg_ipa,
  output logic        dbg_hw,
  output logic        dbg_hold,
  output logic        dbg_hit,
  output logic        dbg_memrd,
  output logic [20:0] dbg_memaddr,
  output logic        dbg_memlate,
  output logic        dbg_redir,
  output logic [15:0] dbg_ifpc,
  output logic [15:0] dbg_memrdat,
  output logic [19:0] dbg_baddr,
  output logic        dbg_bwe,
  output logic        dbg_breq,
  output logic [31:0] dbg_hits,
  output logic [31:0] dbg_misses
);
  logic        psram_read, psram_write, psram_burst, psram_busy;
  logic [21:0] psram_addr;
  logic [15:0] psram_din, psram_dout, psram_dout2;

  deep16_top u_top (
    .clk       (clk),
    .rst       (rst),
    .i_step    (1'b1),
    .i_free    (1'b1),
    .o_done    (),
    .o_result  (),
    .o_busy    (),
    .kbd_push  (1'b0),
    .kbd_push_data(16'h0000),
    .kbd_clear (1'b0),
    .uart_rx_push(1'b0),
    .uart_rx_push_data(16'h0000),
    .uart_tx_take(1'b0),
    .uart_host_ctrl_we(1'b0),
    .uart_host_ctrl_data(16'h0000),
    .uart_tx_data_out(),
    .uart_tx_avail(),
    .uart_rx_avail(),
    .uart_txd (uart_txd),
    .uart_rxd (uart_rx_in),
    .dbg_en   (1'b0),
    .dbg_we   (1'b0),
    .dbg_idx  (8'h00),
    .dbg_wdata(16'h0000),
    .dbg_rdata(),
    .i_cache_flush   (1'b0),
    .i_cache_inv     (1'b0),
    .i_cache_inv_line(8'h00),
    .o_cache_hits    (),
    .o_cache_misses  (),
    .o_cache_penalty (),
    .psram_clk   (clk_ip),
    .psram_read  (psram_read),
    .psram_write (psram_write),
    .psram_burst (psram_burst),
    .psram_addr  (psram_addr),
    .psram_din   (psram_din),
    .psram_dout  (psram_dout),
    .psram_dout2 (psram_dout2),
    .psram_busy  (psram_busy),
    .o_boot_done (boot_done),
    .o_boot_err  (boot_err),
    .o_core_halt (core_halt),
    .o_core_instrs(instrs),
    .o_dbg_if_addr(if_addr)
  );

  assign dbg_st   = {1'b0, u_top.u_psram_mem.st};   // 6 bits, always
  assign dbg_op   = u_top.u_psram_mem.op_addr;
  assign dbg_rdq  = u_top.u_psram_mem.rd_q;
  assign dbg_brd  = u_top.u_psram_mem.brdata;
  assign dbg_ipa  = u_top.u_core.if_pa;
  assign dbg_hw   = u_top.u_core.if_halt_word;
  assign dbg_hold = u_top.u_core.if_hold;
  assign dbg_hit  = u_top.u_core.if_hit;
  assign dbg_memrd   = u_top.mem_rd;
  assign dbg_memaddr = u_top.mem_addr;
  assign dbg_memlate = u_top.u_core.mem_late;
  assign dbg_redir   = u_top.u_core.if_redirect;
  assign dbg_ifpc    = u_top.u_core.if_pc;
  assign dbg_memrdat = u_top.mem_rdata;
  assign dbg_baddr   = u_top.u_psram_mem.baddr;
  assign dbg_bwe     = u_top.u_psram_mem.bwe;
  assign dbg_breq    = u_top.u_psram_mem.breq;
  assign dbg_hits    = u_top.u_psram_mem.hit_count;
  assign dbg_misses  = u_top.u_psram_mem.miss_count;

  psram_word_model #(.WORDS(1 << 20)) u_model (
    .clk  (clk_ip),
    .rst_n(~rst),
    .read (psram_read),
    .write(psram_write),
    .burst(psram_burst),
    .addr (psram_addr),
    .din  (psram_din),
    .din2 (16'h0000),          // cache fills are reads
    .dout (psram_dout),
    .dout2(psram_dout2),
    .busy (psram_busy),
    .peek_addr(peek_addr),
    .peek_data(peek_data)
  );
endmodule
