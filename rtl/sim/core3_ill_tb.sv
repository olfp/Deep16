// core3_ill_tb - the D16nano core's undefined-opcode trap (P1).
//
// The program runs a reserved FPU word (0xFFF8) and then NIO (0xFFF7). Both
// must enter the handler at vector 0 (0x0200), which counts entries at 0x0301
// and RETIs; the words after each trap then store 7 and 9 at 0x0300. A core
// that silently no-ops the undefined words would store 7 and 9 but leave the
// counter at 0, and one that stops on them would never reach the second store.
module core3_ill_tb (
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
  output logic [15:0] mem_wdata,
  output logic [15:0] dbg_0300,
  output logic [15:0] dbg_0301
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

  logic [15:0] mem [0:20'hFFFFF];
  initial begin
    for (int i = 0; i < 21'h100000; i++) mem[i] = 16'hFFFF;
    // Boot ROM: CS=0, PC=0x0010.
    mem[21'hFFFF0] = 16'h0000;   // LDI 0
    mem[21'hFFFF1] = 16'hFF41;   // MVS DS, R0
    mem[21'hFFFF2] = 16'hFF42;   // MVS SS, R0
    mem[21'hFFFF3] = 16'hFC21;   // LSI R1, 1
    mem[21'hFFFF4] = 16'hD818;   // ROL R1, 8 -> 0x0100
    mem[21'hFFFF5] = 16'hFFE0;   // JML R0
    mem[21'hFFFF6] = 16'hFFF0;   // delay slot

    // Main at 0x0100: reserved word, then NIO.
    mem[21'h00100] = 16'hFFF8;   // reserved/FPU word -> trap
    mem[21'h00101] = 16'h0300;   // LDI 0x0300
    mem[21'h00102] = 16'hF840;   // MOV R1, R0
    mem[21'h00103] = 16'h0007;   // LDI 7
    mem[21'h00104] = 16'hA020;   // ST R0, R1, 0 -> [0x0300] = 7
    mem[21'h00105] = 16'hFFF7;   // NIO -> trap
    mem[21'h00106] = 16'h0009;   // LDI 9
    mem[21'h00107] = 16'hA020;   // ST R0, R1, 0 -> [0x0300] = 9
    mem[21'h00108] = 16'hFFFF;   // halt

    // Vector 0 and the handler at 0x0200. It must leave R1 (0x0300) alone.
    mem[21'h00000] = 16'h0200;
    mem[21'h00200] = 16'h0301;   // LDI 0x0301
    mem[21'h00201] = 16'h9400;   // LD R10, R0, 0
    mem[21'h00202] = 16'hC1A1;   // ADD R10, 1
    mem[21'h00203] = 16'hB400;   // ST R10, R0, 0
    mem[21'h00204] = 16'hFFF3;   // RETI
    mem[21'h00205] = 16'hFFF0;   // delay slot
    mem[21'h00301] = 16'h0000;   // the handler's counter cell
  end

  always_ff @(posedge clk) if (mem_we) mem[mem_waddr] <= mem_wdata;

  assign mem_rdata = mem[mem_addr];
  assign if_rdata  = mem[if_addr];
  assign dbg_0300  = mem[21'h000300];
  assign dbg_0301  = mem[21'h000301];
endmodule
