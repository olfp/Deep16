// Deep16 RTL - register file with the Deep16 shadow bank (spec 4.1).
//
// While PSW.S=1 the set {R0-R3, R13, R14} lives in the shadow bank; every other
// register (including PC/R15) is shared. Three write ports exist because one
// instruction can touch two registers (MUL32/DIV32 write the Rd:Rd+1 pair) and
// the PC has the last word on collisions - the order is C > A > B, matching the
// cores: pair write first, Rd write second, branch apply last.
module deep16_regfile (
  input  logic        clk,
  input  logic        rst,
  input  logic        in_shadow,

  // banked read ports (active view) - instruction operands
  input  logic [3:0]  raddr1,
  input  logic [3:0]  raddr2,
  input  logic [3:0]  raddr3,
  output logic [15:0] rdata1,
  output logic [15:0] rdata2,
  output logic [15:0] rdata3,

  // raw bank taps - SMV reads the inactive bank without a register read port
  input  logic [3:0]  rn_addr,
  input  logic [3:0]  rs_addr,
  output logic [15:0] rn_rdata,
  output logic [15:0] rs_rdata,

  // write ports
  input  logic        we_c,
  input  logic [3:0]  waddr_c,
  input  logic [15:0] wdata_c,
  input  logic        we_a,
  input  logic [3:0]  waddr_a,
  input  logic [15:0] wdata_a,
  input  logic        we_b,
  input  logic [3:0]  waddr_b,
  input  logic [15:0] wdata_b,
  input  logic        sh_clear,      // SWI: zero the whole shadow bank

  // debug bus: 0x00-0x0F normal bank, 0x10-0x15 shadow bank (0..3,13,14),
  // 0x20-0x2F banked (active view) reads
  input  logic        dbg_we,
  input  logic [7:0]  dbg_idx,
  input  logic [15:0] dbg_wdata,
  output logic [15:0] dbg_rdata
);

  logic [15:0] regs  [0:15];   // normal bank, R15 is the program counter
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

  function automatic logic [15:0] banked_read(input logic [3:0] idx);
    banked_read = (in_shadow && is_banked(idx)) ? shad[shad_idx(idx)] : regs[idx];
  endfunction

  always_comb begin
    rdata1   = banked_read(raddr1);
    rdata2   = banked_read(raddr2);
    rdata3   = banked_read(raddr3);
    rn_rdata = regs[rn_addr];
    rs_rdata = shad[shad_idx(rs_addr)];
  end

  // Write priority: B (MUL32/DIV32 low word) < A (the instruction's Rd) <
  // C (PC increment / branch apply), then the debug bus. Every element gets a
  // single non-blocking write per cycle, in exactly that order.
  // shadow debug window: 0x1B..0x20 selects shad[0..5]
  wire [2:0] dbg_shad = 3'(dbg_idx[3:0] - 4'hB);

  always_comb begin
    for (int i = 0; i < 16; i++) regs_q[i] = regs[i];
    for (int i = 0; i < 6; i++)  shad_q[i] = shad[i];

    if (sh_clear) begin
      for (int i = 0; i < 6; i++) shad_q[i] = 16'h0000;
    end
    if (we_b) begin
      if (in_shadow && is_banked(waddr_b)) shad_q[shad_idx(waddr_b)] = wdata_b;
      else                                  regs_q[waddr_b] = wdata_b;
    end
    if (we_a) begin
      if (in_shadow && is_banked(waddr_a)) shad_q[shad_idx(waddr_a)] = wdata_a;
      else                                  regs_q[waddr_a] = wdata_a;
    end
    if (we_c) begin
      if (in_shadow && is_banked(waddr_c)) shad_q[shad_idx(waddr_c)] = wdata_c;
      else                                  regs_q[waddr_c] = wdata_c;
    end
    if (dbg_we) begin
      if (dbg_idx[7:4] == 4'h0)      regs_q[dbg_idx[3:0]] = dbg_wdata;
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
      regs[15] <= 16'h0000;
    end else begin
      for (int i = 0; i < 16; i++) regs[i] <= regs_q[i];
      for (int i = 0; i < 6; i++)  shad[i] <= shad_q[i];
    end
  end

  always_comb begin
    if (dbg_idx[7:4] == 4'h0)      dbg_rdata = regs[dbg_idx[3:0]];
    else if (dbg_idx[7:4] == 4'h1 && dbg_idx[3:0] >= 4'hB) dbg_rdata = shad[dbg_shad];
    else if (dbg_idx[7:4] == 4'h3) dbg_rdata = banked_read(dbg_idx[3:0]);
    else                              dbg_rdata = 16'h0000;
  end

endmodule
