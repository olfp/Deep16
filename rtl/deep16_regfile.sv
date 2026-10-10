// Deep16 RTL - register file with the Deep16 shadow bank (spec 4.1).
//
// While PSW.S=1 the set {R0-R3, R13, R14} lives in the shadow bank; every other
// register is shared. The program counter is *not* stored here any more: in the
// five-stage pipeline it travels inside the state bundle (d16_ctx_t.pc) because
// an instruction has to see the PC as the architectural state it is, so index
// 15 of this array is unused and the core maps R15 onto the bundle.
//
// Every read port returns both banks raw; the bank selection happens in the EX
// stage with the *effective* PSW of the instruction being executed, which is
// what makes SWI/RETI sequences behave: a switch of the context in front of the
// pipeline changes which bank a younger, already fetched instruction reads.
// Write ports carry the bank of their own instruction for the same reason.
module deep16_regfile (
  input  logic        clk,
  input  logic        rst,

  // read ports: raw normal and shadow values, selected by the core
  input  logic [3:0]  raddr1,
  input  logic [3:0]  raddr2,
  input  logic [3:0]  raddr3,
  output logic [15:0] rdata1_n,
  output logic [15:0] rdata1_s,
  output logic [15:0] rdata2_n,
  output logic [15:0] rdata2_s,
  output logic [15:0] rdata3_n,
  output logic [15:0] rdata3_s,

  // raw bank taps - SMV reads the inactive bank without spending a read port
  input  logic [3:0]  rn_addr,
  input  logic [3:0]  rs_addr,
  output logic [15:0] rn_rdata,
  output logic [15:0] rs_rdata,

  // write ports (instruction results, committed in WB)
  input  logic        wb_bank,        // PSW.S of the writing instruction
  input  logic        we_a,
  input  logic [3:0]  waddr_a,
  input  logic [15:0] wdata_a,
  input  logic        we_b,
  input  logic [3:0]  waddr_b,
  input  logic [15:0] wdata_b,
  input  logic        sh_clear,       // SWI: zero the whole shadow bank

  // debug bus: 0x00-0x0E normal bank (0x0F is the core's PC),
  // 0x1B-0x20 shadow bank (R0'-R3', R13', R14'), 0x30-0x3E active view
  input  logic        dbg_we,
  input  logic [7:0]  dbg_idx,
  input  logic [15:0] dbg_wdata,
  input  logic        dbg_in_shadow,
  output logic [15:0] dbg_rdata
);

  logic [15:0] regs  [0:15];   // normal bank, R0-R14
  logic [15:0] shad  [0:5];    // shadow R0', R1', R2', R3', R13', R14'
  logic [15:0] regs_q [0:15];
  logic [15:0] shad_q [0:5];

  function automatic logic is_banked(input logic [3:0] idx);
    is_banked = (idx == 4'd0)  || (idx == 4'd1)  || (idx == 4'd2) || (idx == 4'd3)
             || (idx == 4'd13) || (idx == 4'd14);
  endfunction

  function automatic logic [2:0] shad_idx(input logic [3:0] idx);
    case (idx)
      4'd13:   shad_idx = 3'd4;
      4'd14:   shad_idx = 3'd5;
      default: shad_idx = idx[2:0];
    endcase
  endfunction

  // shadow debug window: 0x1B..0x20 selects shad[0..5]
  wire [2:0] dbg_shad = 3'(dbg_idx[3:0] - 4'hB);

  always_comb begin
    rdata1_n = regs[raddr1];
    rdata2_n = regs[raddr2];
    rdata3_n = regs[raddr3];
    rdata1_s = shad[shad_idx(raddr1)];
    rdata2_s = shad[shad_idx(raddr2)];
    rdata3_s = shad[shad_idx(raddr3)];
    rn_rdata = regs[rn_addr];
    rs_rdata = shad[shad_idx(rs_addr)];
  end

  // Write priority: B (MUL32/DIV32 low word) < A (the instruction's Rd), then
  // the debug bus - the cores write the pair first and Rd second.
  always_comb begin
    for (int i = 0; i < 16; i++) regs_q[i] = regs[i];
    for (int i = 0; i < 6; i++)  shad_q[i] = shad[i];

    if (sh_clear) begin
      for (int i = 0; i < 6; i++) shad_q[i] = 16'h0000;
    end
    if (we_b) begin
      if (wb_bank && is_banked(waddr_b)) shad_q[shad_idx(waddr_b)] = wdata_b;
      else                                regs_q[waddr_b] = wdata_b;
    end
    if (we_a) begin
      if (wb_bank && is_banked(waddr_a)) shad_q[shad_idx(waddr_a)] = wdata_a;
      else                                regs_q[waddr_a] = wdata_a;
    end
    if (dbg_we) begin
      if (dbg_idx[7:4] == 4'h0 && dbg_idx[3:0] != 4'hF) regs_q[dbg_idx[3:0]] = dbg_wdata;
      else if (dbg_idx[7:4] == 4'h1 && dbg_idx[3:0] >= 4'hB) shad_q[dbg_shad] = dbg_wdata;
    end
  end

  // Reset state matches both behavioural cores: every register 0 except SP,
  // which parks at the top of the flat data segment.
  always_ff @(posedge clk) begin
    if (rst) begin
      for (int i = 0; i < 16; i++) regs[i] <= 16'h0000;
      for (int i = 0; i < 6; i++)  shad[i] <= 16'h0000;
      regs[13] <= 16'h7FFF;
    end else begin
      for (int i = 0; i < 16; i++) regs[i] <= regs_q[i];
      for (int i = 0; i < 6; i++)  shad[i] <= shad_q[i];
    end
  end

  always_comb begin
    if (dbg_idx[7:4] == 4'h0 && dbg_idx[3:0] != 4'hF)      dbg_rdata = regs[dbg_idx[3:0]];
    else if (dbg_idx[7:4] == 4'h1 && dbg_idx[3:0] >= 4'hB) dbg_rdata = shad[dbg_shad];
    else if (dbg_idx[7:4] == 4'h3 && dbg_idx[3:0] != 4'hF)
      dbg_rdata = (dbg_in_shadow && is_banked(dbg_idx[3:0])) ? shad[shad_idx(dbg_idx[3:0])]
                                                              : regs[dbg_idx[3:0]];
    else                                                      dbg_rdata = 16'h0000;
  end

endmodule
