// core3_irq_tb - the D16nano core's hardware-IRQ entry.
//
// The program boots through the ROM to 0x0010, enables interrupts with SETI,
// loads 0x1234 and then stores it at 0x0300. The tb pulses IRQ once while the
// store is in ID: the handler at 0x0100 increments a counter at 0x0301 and
// RETIs. If the entry returned to the following instruction instead of the
// parked store, 0x0300 would stay zero.
module core3_irq_tb (
  input  logic        clk,
  input  logic        rst,
  input  logic        irq,
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
    .irq            (irq),
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

  // Combinational memory is enough for the IRQ-entry test; the board build's
  // registered port is covered by the tile simulation.
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
    // Main at 0x0100 (the ROM's entry point).
    mem[21'h00100] = 16'hFFF4;   // SETI
    mem[21'h00101] = 16'h0300;   // LDI 0x0300
    mem[21'h00102] = 16'hF840;   // MOV R1, R0 -> address 0x0300
    mem[21'h00103] = 16'h1234;   // LDI 0x1234
    mem[21'h00104] = 16'hA020;   // ST R0, R1, 0
    mem[21'h00105] = 16'hFFFF;   // halt
    // Vector 1 and the handler at 0x0200.
    mem[21'h00001] = 16'h0200;
    mem[21'h00200] = 16'h0301;   // LDI 0x0301
    mem[21'h00201] = 16'h8200;   // LD R1, R0, 0
    mem[21'h00202] = 16'hC111;   // ADD R1, 1
    mem[21'h00203] = 16'hA200;   // ST R1, R0, 0
    mem[21'h00204] = 16'hFFF3;   // RETI
    mem[21'h00205] = 16'hFFF0;   // delay slot
    mem[21'h000301] = 16'h0000;  // the handler's counter cell
  end

  always_ff @(posedge clk) if (mem_we) mem[mem_waddr] <= mem_wdata;

  wire [15:0] mem_q = mem[mem_addr];
  wire [15:0] fetch_q = mem[if_addr];
  assign mem_rdata = mem_q;
  assign if_rdata = fetch_q;
  assign dbg_0300 = mem[21'h000300];
  assign dbg_0301 = mem[21'h000301];
endmodule
