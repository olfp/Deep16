// core3_pole_bench_tb - the D16nano core running the Pole road renderer.
//
// The program image is loaded into the memory from the C++ side, so the same
// harness measures any build of the renderer. The memory is combinational,
// exactly like the core3_irq_tb harness: the cycle figures are therefore the
// core's own timings without any memory latency, the same caveat the other
// core3 measurements in this repository carry.
//
// The memory is filled from C++ rather than from an initial block here, so
// the 1M-word array does not have to be unrolled into the generated code.
module core3_pole_bench_tb (
  input  logic        clk,
  input  logic        rst,
  output logic        o_done,
  output logic        o_result,
  output logic        o_busy,
  output logic        o_halt,
  output logic [31:0] o_instr_count,
  output logic [31:0] o_cycle_count,
  output logic [20:0] if_addr,
  output logic [20:0] mem_addr,
  output logic        mem_rd,
  output logic        mem_we,
  output logic [20:0] mem_waddr,
  output logic [15:0] mem_wdata
);
  logic [15:0] mem_rdata;
  logic [15:0] if_rdata;

  deep16_core3 u_core (
    .clk            (clk),
    .rst            (rst),
    .irq            (1'b0),
    .i_step         (1'b1),
    .i_free         (1'b1),
    .mem_stall      (1'b0),
    .o_done         (o_done),
    .o_result       (o_result),
    .o_busy         (o_busy),
    .o_halt         (o_halt),
    .o_instr_count  (o_instr_count),
    .o_cycle_count  (o_cycle_count),
    .if_addr        (if_addr),
    .if_rdata       (if_rdata),
    .if_preempted   (1'b0),
    .mem_addr       (mem_addr),
    .mem_rd         (mem_rd),
    .mem_rdata      (mem_rdata),
    .mem_valid      (1'b1),
    .mem_store_ack  (1'b1),
    .mem_we         (mem_we),
    .mem_waddr      (mem_waddr),
    .mem_wdata      (mem_wdata),
    .kbd_pop        (),
    .kbd_ready      (1'b0),
    .kbd_head       (16'h0000),
    .kbd_count      (8'h00),
    .uart_tx_we     (),
    .uart_tx_data   (),
    .uart_rx_take   (),
    .uart_ctrl_we   (),
    .uart_ctrl_data (),
    .uart_status    (16'h0000),
    .uart_rx_data   (16'h0000),
    .cache_flush    (),
    .dbg_en         (1'b0),
    .dbg_we         (1'b0),
    .dbg_idx        (8'h00),
    .dbg_wdata      (16'h0000),
    .dbg_rdata      ()
  );

  // The whole address space, so the renderer can write the FiT windows at
  // 0xF1000 (the map), 0xF2000 (the control registers) and 0xF6000 (the OAM).
  // The C++ side fills it and loads the program image into it.
  logic [15:0] mem [0:20'hFFFFF] /*verilator public_flat_rw*/;

  always_ff @(posedge clk) if (mem_we) mem[mem_waddr] <= mem_wdata;

  wire [15:0] mem_q = mem[mem_addr];
  wire [15:0] fetch_q = mem[if_addr];
  assign mem_rdata = mem_q;
  assign if_rdata = fetch_q;
endmodule
