// Deep16 RTL - CPU core, phase 2: five-stage pipeline (IF/ID/EX/MEM/WB).
//
// The multi-cycle FSM of phase 1 (git history) is the golden reference for the
// *behaviour*; this core keeps every observable result identical and changes
// only when things happen: step() still retires exactly one instruction and
// the architectural state after a step is what the JS core leaves behind. The
// cycle, stall and flush counters are new.
//
// How order is preserved despite the lookahead
// ---------------------------------------------
// * Every instruction computes the complete "architectural state after me" in
//   EX (the d16_ctx_t bundle: PC, PSW, segments, shadow bank, delay
//   bookkeeping). The bundle is bypassed from MEM and WB into EX, so an
//   instruction sees the writes of all older instructions and none of the
//   younger ones - including PSW flags, which therefore no longer have to be
//   written back before a dependent Jcc can read them.
// * The GPRs stay in the register file with the usual EX/MEM and WB bypass. A
//   memory load produces its result in MEM, so a consumer one instruction
//   later stalls for exactly one cycle (the only hazard in the design).
// * The program counter stays architectural state. The fetch stage keeps no
//   private PC: it fetches from the active PC of the state chain and follows
//   the transfer once the delay slot (or SWI/RETI) has produced it. That is
//   what keeps the Deep16 delay-slot semantics - including the nested-slot
//   quirk where the instruction at the target runs twice - identical to the
//   behavioural cores without any special casing.
// * The one instruction that is fetched before its address is known (the one
//   after a delay slot, the one or two after SWI/RETI) is squashed; that is
//   what get_flush_count() reports.
//
// Debug bus (core state, see the harness for the full map):
//   0x00-0x0E normal regs   0x0F PC   0x10 psw   0x11-0x14 cs/ds/ss/es
//   0x15-0x1A shadow psw/pc/cs/ds/ss/es       0x1B-0x20 shadow r0-r3,13,14
//   0x21 {busy,dts,bt,da}  0x22 delayed_pc  0x23 delayed_cs
//   0x24-0x26 last event code/spc/scs         0x27-0x2C recent access
//   0x2D-0x2E cycles   0x2F instruction in EX
//   0x54-0x55 stalls   0x56-0x57 flushes    0x58-0x59 retired instructions
module deep16_core
  import deep16_pkg::*;
(
  input  logic        clk,
  input  logic        rst,

  input  logic        i_step,        // one pulse = run until one instruction retires
  // Free-run: hold run high across retirements instead of stopping after one.
  // Diagnostic only - it changes *when* the machine runs, never what it
  // computes: every retired instruction produces the same state either way.
  // Without it every step() pays a fixed pipeline refill, which inflates any
  // CPI derived from get_cycle_count(). See harness run_cycles().
  input  logic        i_free,
  // A memory transaction is outstanding: freeze IF/ID/EX, let WB drain. The
  // top pulses this while the data/fetch word is still in flight.
  input  logic        mem_stall,
  output logic        o_done,
  output logic        o_result,      // 0 = the step ran into a halt word
  output logic        o_busy,
  output logic        o_halt,        // a halt word was reached (fetch stays put)
  output logic [31:0] o_instr_count, // retired instructions (board diagnostics)

  // instruction fetch port. `if_preempted` tells the core the word on if_rdata
  // is not its own this cycle: the memory has one read port and a load took it,
  // so the fetch treats the cycle as a miss, holds the address and re-issues.
  output logic [20:0] if_addr,
  input  logic [15:0] if_rdata,
  input  logic        if_preempted,
  // data read port: loads and the SWI vector word, read in MEM
  output logic [20:0] mem_addr,
  output logic        mem_rd,          // the data port is reading this cycle
  input  logic [15:0] mem_rdata,
  /* verilator lint_off UNUSEDSIGNAL */   // the reduced core uses these; this one does not
  input  logic        mem_valid,   // the data port word above is valid this cycle
  input  logic        mem_store_ack, // a store has been written to memory
  /* verilator lint_on UNUSEDSIGNAL */
  // data write port: stores commit in WB, like every other architectural write
  output logic        mem_we,
  output logic [20:0] mem_waddr,
  output logic [15:0] mem_wdata,
  output logic        kbd_pop,
  input  logic        kbd_ready,
  input  logic [15:0] kbd_head,
  // the depth is only read by the debug bus, which the board does not build
`ifdef D16MINI
  /* verilator lint_off UNUSEDSIGNAL */
`endif
  input  logic [7:0]  kbd_count,
`ifdef D16MINI
  /* verilator lint_on UNUSEDSIGNAL */
`endif

  // UART console port (D16MINI.md §4.4/§5): status/data/control at 0xF0040/42/46,
  // read and written in EX like the keyboard port, so a following LDS sees the
  // next byte.
  output logic        uart_tx_we,
  output logic [15:0] uart_tx_data,
  output logic        uart_rx_take,
  output logic        uart_ctrl_we,
  output logic [15:0] uart_ctrl_data,
  input  logic [15:0] uart_status,
  input  logic [15:0] uart_rx_data,

  // FSH retired in WB: the top invalidates every cache line (spec 7.4)
  output logic        cache_flush,

  // The debug bus (harness/IDE state seeding and observation). The board build
  // ties it off and does not build it (§4.3), so the inputs read as unused there.
`ifdef D16MINI
  /* verilator lint_off UNUSEDSIGNAL */
`endif
  input  logic        dbg_en,
  input  logic        dbg_we,
  input  logic [7:0]  dbg_idx,
  input  logic [15:0] dbg_wdata,
  output logic [15:0] dbg_rdata
);
`ifdef D16MINI
  /* verilator lint_on UNUSEDSIGNAL */
`endif

  // ------------------------------------------------------------------ state
  d16_ctx_t    ctx;              // committed architectural state
  logic [15:0] if_pc;            // address the fetch unit reads next
  logic [31:0] cycle_count;
  logic [31:0] stall_count;
  logic [31:0] flush_count;
  logic [31:0] instr_count;

  // The event log and the recent-access record are read only through the debug
  // bus - the IDE's event and access views. On the board that bus is not built,
  // so they are dead registers the synthesizer prunes; Verilator just notes it.
`ifdef D16MINI
  /* verilator lint_off UNUSEDSIGNAL */
`endif
  logic [15:0] last_event_code, last_event_spc, last_event_scs;
  logic [20:0] recent_addr;
  logic [15:0] recent_base, recent_seg_val;
  logic [4:0]  recent_offset;
  logic [1:0]  recent_seg_idx;
  logic        recent_is_store;
`ifdef D16MINI
  /* verilator lint_on UNUSEDSIGNAL */
`endif

  logic run;                     // the pipeline advances while a step is in flight
  logic halt_sticky;             // a halt word was reached; the fetch stays put
  // Declared here rather than with the step control below: slang requires
  // declarations before use (the EX strobes read it), Verilator does not.
  logic step_freeze;

  // --------------------------------------------------------------- pipeline
  // IF/ID and ID/EX carry the instruction plus the two pieces of context the
  // execute stage needs: its own address (PC sources are own+1) and the active
  // CS at fetch time (a branch stores it as its delayed CS).
  typedef struct packed {
    logic        valid;
    logic [15:0] instr;
    logic [15:0] pc0;
    logic [15:0] act_cs;
    logic        halt_word;      // fetched word was 0xFFFF / outside memory
    // Register operands, read in ID (27 MHz step C). Both banks are raw: which
    // one the instruction sees depends on its PSW, which lives in the context
    // chain and is only settled in EX. ra/rd_en travel along for the load-use
    // hazard compare and the EX forwarding.
    logic [3:0]  ra1, ra2, ra3;
    logic        rd_en1, rd_en2, rd_en3;
    logic [15:0] op1_n, op1_s, op2_n, op2_s, op3_n, op3_s;
  } front_t;

  // Everything EX produces, consumed by MEM and committed in WB.
  typedef struct packed {
    logic        valid;
    logic [15:0] instr;          // for the debug view of the later stages
    d16_ctx_t    ctx_next;       // the whole architectural state after EX
    logic        is_swi;         // the vector word is patched in from MEM
    logic        sh_clear;       // SWI zeroes the shadow GPR bank
    logic        reg_we_a, reg_we_b;
    logic [3:0]  reg_wa, reg_wb;
    logic [15:0] reg_da, reg_db;
    logic        reg_bank;       // PSW.S of the writing instruction
    logic        reg_bank_b;     // bank of the B port (SMV: inactive bank)
    logic        mem_we;
    logic [20:0] mem_addr;
    logic [15:0] mem_wdata;
    logic        mem_rd_valid;   // the data port reads in MEM
    logic        mem_is_load;    // reg_da comes from that read (hazard source)
    logic [3:0]  load_rd;
    logic        pc_from_port;   // the new active PC is the memory read word
    logic        appl_pc;        // the delay-slot apply wrote the PC
    logic        appl_spc;       // ... or the shadow PC
    logic        rec_we;
    logic [20:0] rec_addr;
    logic [15:0] rec_base, rec_seg;
    logic [4:0]  rec_off;
    logic [1:0]  rec_segid;
    logic        rec_store;
    logic        evt_we;
    logic [15:0] evt_code, evt_spc, evt_scs;
  } back_t;

  front_t if_id, if_id_n;
  front_t id_ex;
  // MEM/WB keeps the whole struct so the copy from EX/MEM stays a single
  // assignment; the fields only MEM needs (load hazard, SWI flag) travel in
  // the upper bits and are deliberately not read back there.
  /* verilator lint_off UNUSEDSIGNAL */
  back_t  ex_mem, ex_mem_n;
  back_t  mem_wb, mem_wb_n;
  /* verilator lint_on UNUSEDSIGNAL */

  // =====================================================================
  // State bypass network
  // =====================================================================
  d16_ctx_t ctx_e;      // state the EX instruction sees (after MEM and WB)

  always_comb begin
    if      (ex_mem.valid) ctx_e = ex_mem.ctx_next;
    else if (mem_wb.valid) ctx_e = mem_wb.ctx_next;
    else                   ctx_e = ctx;
  end

  // =====================================================================
  // Stage 3: execute
  // =====================================================================
  // ---- instruction class (pure function of the word) --------------------
  // A function now: ID needs it too, to decode the register operands it reads
  // (27 MHz step C - the read used to sit in EX, at the head of the critical
  // cone id_ex.instr -> regfile -> ALU -> next state -> address).
  typedef struct packed {
    logic [2:0] cls;
    logic [3:0] ext;
  } idec_t;

  /* verilator lint_off UNUSEDSIGNAL */
  // (each class only looks at some of the word's bits; that is the point)
  function automatic idec_t decode(input logic valid, input logic [15:0] w);
    idec_t d;
    d = '{cls: 3'd0, ext: 4'd10};
    if (valid) begin
      // SYS prefix is 13 bits: 0xFFF0..0xFFF7. Words 0xFFF8..0xFFFF are
      // reserved and decode to nothing, exactly like the JS core's chain.
      if (w[15:3] == 13'h1FFE)                     d.cls = 3'd1;   // SYS prefix
      else if (!w[15])                             d.cls = 3'd2;   // LDI
      else if (w[15:14] == 2'b10)                  d.cls = 3'd3;   // LD/ST
      else begin
        case (w[15:13])
          3'b110: d.cls = 3'd4;                                    // ALU
          3'b111: begin                                           // extended
            d.cls = 3'd5;
            // ordered exactly like the cores' extended chain
            if      (w[15:12] == 4'b1110)          d.ext = 4'd0;  // Jcc
            else if (w[15:11] == 5'b11110)         d.ext = 4'd1;  // LDS/STS
            else if (w[15:10] == 6'b111110)        d.ext = 4'd2;  // MOV
            else if (w[15:9]  == 7'b1111110)       d.ext = 4'd3;  // LSI
            else if (w[15:8]  == 8'b11111110)      d.ext = 4'd4;  // SMV
            else if (w[15:7]  == 9'b111111110)     d.ext = 4'd5;  // MVS
            else if (w[15:6]  == 10'b1111111110)   d.ext = 4'd6;  // SOP
            else if (w[15:5]  == 11'b11111111110)  d.ext = 4'd7;  // SET/CLR
            else if (w[15:4]  == 12'b111111111110) d.ext = 4'd8;  // JML
            else if (w[15:3]  == 13'b1111111111110) d.ext = 4'd9; // SYS
            else                                   d.ext = 4'd10; // reserved
          end
          default: d.cls = 3'd0;
        endcase
      end
    end
    return d;
  endfunction
  /* verilator lint_on UNUSEDSIGNAL */

  // ---- register read addresses ------------------------------------------
  typedef struct packed {
    logic [3:0] a1, a2, a3;
    logic       e1, e2, e3;
  } rd_t;

  /* verilator lint_off UNUSEDSIGNAL */
  function automatic rd_t read_addrs(input idec_t d, input logic [15:0] w);
    rd_t r;
    r = '{a1: 4'd0, a2: 4'd0, a3: 4'd0, e1: 1'b0, e2: 1'b0, e3: 1'b0};
    case (d.cls)
      3'd3: begin                                // LD/ST: base + ST source
        r.a1 = w[8:5];   r.e1 = 1'b1;
        r.a3 = w[12:9];  r.e3 = 1'b1;
      end
      3'd4: begin                                // ALU: Rd, Rs, Rd+1
        r.a1 = w[7:4];            r.e1 = 1'b1;
        r.a2 = w[3:0];            r.e2 = 1'b1;
        r.a3 = w[7:4] + 4'd1;     r.e3 = 1'b1;
      end
      3'd5: begin
        case (d.ext)
          4'd1: begin                            // LDS/STS
            r.a1 = w[3:0];  r.e1 = 1'b1;
            r.a3 = w[7:4];  r.e3 = 1'b1;
          end
          4'd2: begin r.a1 = w[5:2]; r.e1 = 1'b1; end  // MOV
          4'd3: begin r.a1 = w[8:5]; r.e1 = 1'b1; end  // LSI
          4'd4: begin                            // SMV: reads tap the
            r.e1 = 1'b1;                         // *inactive* bank; the write
            if (w[3:0] >= 4'h4 && w[3:0] <= 4'h7) // form takes its source from
              r.a1 = w[7:4];                      // the *active* bank
            else case (w[3:0])
              4'h9:  r.a1 = 4'd1;
              4'hA:  r.a1 = 4'd2;
              4'hB:  r.a1 = 4'd3;
              4'hD:  r.a1 = 4'd13;
              4'hE:  r.a1 = 4'd14;
              default: r.a1 = 4'd0;
            endcase
          end
          4'd5: begin r.a1 = w[5:2]; r.e1 = 1'b1; end  // MVS
          4'd6: begin r.a1 = w[3:0]; r.e1 = 1'b1; end  // SOP
          4'd8: begin                            // JML
            r.a1 = w[3:0];            r.e1 = 1'b1;
            r.a2 = w[3:0] + 4'd1;     r.e2 = 1'b1;
          end
          default: ;
        endcase
      end
      default: ;
    endcase
    return r;
  endfunction
  /* verilator lint_on UNUSEDSIGNAL */

  logic [2:0]  cls;
  logic [3:0]  ext_id;
  idec_t       idec_ex;

  always_comb begin
    idec_ex = decode(id_ex.valid, id_ex.instr);
    cls     = idec_ex.cls;
    ext_id  = idec_ex.ext;
  end

  idec_t id_dec;
  rd_t   id_rd;

  always_comb begin
    id_dec = decode(if_id.valid, if_id.instr);
    id_rd  = read_addrs(id_dec, if_id.instr);
  end

  // ---- regfile reads with the EX/MEM and WB bypass -----------------------
  logic [15:0] rf1_n, rf1_s, rf2_n, rf2_s, rf3_n, rf3_s;
`ifndef D16MINI
  // Debug-bus plumbing - the harness/IDE state seeding. The board build has
  // none of it (§4.3): the whole bus is behind `ifndef D16MINI`.
  logic        rf_dbg_we;
  logic [15:0] rf_dbg_rdata;
`else
  /* verilator lint_off UNUSEDSIGNAL */
  logic [15:0] rf_dbg_rdata_unused;   // the regfile's debug read, not used here
  /* verilator lint_on UNUSEDSIGNAL */
`endif

  function automatic logic idx_banked(input logic [3:0] idx);
    idx_banked = (idx == 4'd0)  || (idx == 4'd1)  || (idx == 4'd2) || (idx == 4'd3)
              || (idx == 4'd13) || (idx == 4'd14);
  endfunction

  // Does the write port pair of one stage target index a in the bank the
  // reader wants? A write into the other bank does not disturb this read -
  // that is the whole point of the shadow bank.
  function automatic logic fwd_hit(
      input logic [3:0] a,
      input logic       bank,
      input logic       we_a,
      input logic [3:0] wa,
      input logic       we_b,
      input logic [3:0] wb,
      input logic       wbank_a,
      input logic       wbank_b);
    logic hit;
    hit = 1'b0;
    if (we_a && wa == a) hit = 1'b1;
    else if (we_b && wb == a) hit = 1'b1;
    if (hit && idx_banked(a)) begin
      // A hit on the A port uses wbank_a; a hit on B uses wbank_b. A and B
      // never write the same index in one instruction (A is Rd, B is Rd+1 or
      // the SMV destination), so the first matching port is the one that
      // matters.
      if (we_a && wa == a) hit = (wbank_a == bank);
      else                 hit = (wbank_b == bank);
    end
    return hit;
  endfunction

  // R15 is the program counter and therefore part of the state bundle: in the
  // normal bank it was already pre-incremented for this instruction, in the
  // shadow bank it still holds the user PC the handler was entered from.
  wire [15:0] pc_reg_val = ctx_e.psw[FLG_S] ? ctx_e.pc : (ctx_e.pc + 16'd1);

  // The data written to the register file in WB. A load's word is on the memory
  // bus now (the synchronous read), so it is taken from there rather than from
  // the pipeline register.
  wire [15:0] mem_wb_wdata = (mem_wb.valid && mem_wb.mem_is_load && mem_wb.reg_we_a)
                             ? mem_rdata : mem_wb.reg_da;

  // WB forwarding for the ID read: the instruction retiring this cycle has not
  // written the array yet, so its value is muxed in here. Without it an
  // instruction right behind a WB writer would read the stale word.
  function automatic logic [15:0] id_fwd_wb(input logic [3:0] a, input logic bank,
                                            input logic [15:0] base);
    if (mem_wb.valid &&
        fwd_hit(a, bank, mem_wb.reg_we_a, mem_wb.reg_wa, mem_wb.reg_we_b,
                mem_wb.reg_wb, mem_wb.reg_bank, mem_wb.reg_bank_b))
      return (mem_wb.reg_we_a && mem_wb.reg_wa == a) ? mem_wb_wdata : mem_wb.reg_db;
    return base;
  endfunction

  // EX side: the operands are in flip-flops now. Pick the bank with the
  // instruction's own PSW and forward from the two younger stages.
  function automatic logic [15:0] fwd_ex(input logic [3:0] a, input logic bank,
                                         input logic [15:0] n, input logic [15:0] s);
    logic [15:0] base_v;
    base_v = (bank && idx_banked(a)) ? s : n;
    if (a == 4'd15) return pc_reg_val;
    if (ex_mem.valid &&
        fwd_hit(a, bank, ex_mem.reg_we_a, ex_mem.reg_wa, ex_mem.reg_we_b,
                ex_mem.reg_wb, ex_mem.reg_bank, ex_mem.reg_bank_b))
      // A load's word is not in reg_da: EX leaves that at 0 and the synchronous
      // read delivers it on mem_rdata during MEM. Forwarding reg_da for a load
      // made the held EX instruction read 0 whenever the memory stalled - every
      // D16nano load-use pair over PSRAM, seen first as the tile console
      // writing at the row without the scroll offset.
      return (ex_mem.reg_we_a && ex_mem.reg_wa == a)
             ? (ex_mem.mem_is_load ? mem_rdata : ex_mem.reg_da) : ex_mem.reg_db;
    if (mem_wb.valid &&
        fwd_hit(a, bank, mem_wb.reg_we_a, mem_wb.reg_wa, mem_wb.reg_we_b,
                mem_wb.reg_wb, mem_wb.reg_bank, mem_wb.reg_bank_b))
      return (mem_wb.reg_we_a && mem_wb.reg_wa == a) ? mem_wb_wdata : mem_wb.reg_db;
    return base_v;
  endfunction

  logic [15:0] r1, r2, r3, r_inact;
  logic        in_shadow;



  always_comb begin
    in_shadow = ctx_e.psw[FLG_S];
    r1      = fwd_ex(id_ex.ra1, in_shadow, id_ex.op1_n, id_ex.op1_s);
    r2      = fwd_ex(id_ex.ra2, in_shadow, id_ex.op2_n, id_ex.op2_s);
    r3      = fwd_ex(id_ex.ra3, in_shadow, id_ex.op3_n, id_ex.op3_s);
    // SMV taps the inactive bank, so it wants the opposite bank
    r_inact = fwd_ex(id_ex.ra1, ~in_shadow, id_ex.op1_n, id_ex.op1_s);
  end

  deep16_regfile u_regfile (
    .clk       (clk),
    .rst       (rst),
    .raddr1    (id_rd.a1),     .rdata1_n   (rf1_n),      .rdata1_s(rf1_s),
    .raddr2    (id_rd.a2),     .rdata2_n   (rf2_n),      .rdata2_s(rf2_s),
    .raddr3    (id_rd.a3),     .rdata3_n   (rf3_n),      .rdata3_s(rf3_s),
    .wb_bank   (mem_wb.reg_bank),
    .wb_bank_b (mem_wb.reg_bank_b),
    // every write port is gated with the stage's valid bit: a bubble inserted
    // on a load-use stall keeps the fields of the instruction it replaced, and
    // an ungated port would keep firing that stale write every cycle
    .we_a      (mem_wb.valid && mem_wb.reg_we_a),
    .waddr_a   (mem_wb.reg_wa), .wdata_a (mem_wb_wdata),
    .we_b      (mem_wb.valid && mem_wb.reg_we_b),
    .waddr_b   (mem_wb.reg_wb), .wdata_b (mem_wb.reg_db),
    .sh_clear  (mem_wb.valid && mem_wb.sh_clear),
`ifndef D16MINI
    .dbg_we    (rf_dbg_we), .dbg_idx (dbg_idx), .dbg_wdata (dbg_wdata),
    .dbg_in_shadow(ctx.psw[FLG_S]),
    .dbg_rdata (rf_dbg_rdata)
`else
    // tied off, so the regfile's debug port is dead logic and gets pruned
    .dbg_we    (1'b0), .dbg_idx (8'h00), .dbg_wdata (16'h0000),
    .dbg_in_shadow(1'b0),
    .dbg_rdata (rf_dbg_rdata_unused)
`endif
  );

  // ---- ID operands, registered into ID/EX (27 MHz step C) ---------------
  // Read both banks raw; the write retiring this cycle is bypassed here. EX
  // selects the bank and forwards from EX/MEM and MEM/WB.
  logic        id_sh_clear;
  logic [15:0] id_op1_n, id_op1_s, id_op2_n, id_op2_s, id_op3_n, id_op3_s;

  always_comb begin
    // The SWI zeroes the shadow bank; reads see the zero before it commits.
    id_sh_clear = (ex_mem.valid && ex_mem.sh_clear) ||
                  (mem_wb.valid && mem_wb.sh_clear);
    id_op1_n = id_fwd_wb(id_rd.a1, 1'b0, rf1_n);
    id_op1_s = id_fwd_wb(id_rd.a1, 1'b1, id_sh_clear ? 16'h0000 : rf1_s);
    id_op2_n = id_fwd_wb(id_rd.a2, 1'b0, rf2_n);
    id_op2_s = id_fwd_wb(id_rd.a2, 1'b1, id_sh_clear ? 16'h0000 : rf2_s);
    id_op3_n = id_fwd_wb(id_rd.a3, 1'b0, rf3_n);
    id_op3_s = id_fwd_wb(id_rd.a3, 1'b1, id_sh_clear ? 16'h0000 : rf3_s);
  end

  front_t id_ex_n;

  always_comb begin
    id_ex_n        = if_id;
    id_ex_n.ra1    = id_rd.a1;
    id_ex_n.ra2    = id_rd.a2;
    id_ex_n.ra3    = id_rd.a3;
    id_ex_n.rd_en1 = id_rd.e1;
    id_ex_n.rd_en2 = id_rd.e2;
    id_ex_n.rd_en3 = id_rd.e3;
    id_ex_n.op1_n  = id_op1_n;   id_ex_n.op1_s = id_op1_s;
    id_ex_n.op2_n  = id_op2_n;   id_ex_n.op2_s = id_op2_s;
    id_ex_n.op3_n  = id_op3_n;   id_ex_n.op3_s = id_op3_s;
  end

  // The hazard compare and the debug view still name the EX instruction's
  // read indices; they are the registered ones now.
  wire [3:0] ra1 = id_ex.ra1, ra2 = id_ex.ra2, ra3 = id_ex.ra3;
  wire       rd_en1 = id_ex.rd_en1, rd_en2 = id_ex.rd_en2, rd_en3 = id_ex.rd_en3;

  // ---- load-use hazard ---------------------------------------------------
  // Only a memory load produces its result late (in MEM). Everything else -
  // ALU, MUL32/DIV32 pairs, the keyboard port - is ready at the end of EX.
  logic stall;

  always_comb begin
    stall = 1'b0;
    if (id_ex.valid && ex_mem.valid && ex_mem.mem_is_load) begin
      if ((rd_en1 && ra1 == ex_mem.load_rd) ||
          (rd_en2 && ra2 == ex_mem.load_rd) ||
          (rd_en3 && ra3 == ex_mem.load_rd)) stall = 1'b1;
    end
  end

  // ---- iterative divider hold ---------------------------------------------
  // A division takes 16 clocks longer than an ADD, which `stall` above cannot
  // provide: that is
  // a *one-cycle* mechanism that pushes a bubble into MEM on every stalled
  // cycle. The state bundle EX reads (ctx_e) is only two stages deep - ex_mem,
  // then mem_wb, then it falls back to the committed ctx. A bubble every cycle
  // drains that chain after two clocks and EX would compute from stale state.
  //
  // So the division runs in two phases:
  //
  //   drain  - the DIV stays in EX while the one or two instructions ahead of
  //            it retire normally. mem_wb shifts as usual, ex_mem takes a
  //            bubble instead of the DIV. Once both are empty, ctx_e falls
  //            through to the committed ctx - which is exactly the state the
  //            DIV needs, because everything ahead of it has by then retired.
  //   freeze - with ex_mem and mem_wb empty, nothing shifts at all until the
  //            divider reports done.
  //
  // div_started gates start to one pulse per division, so a held instruction
  // cannot restart the divider every clock. It is cleared when the result is
  // *taken* (div_take) rather than when div_req falls: two DIVs back to back
  // keep div_req high the whole time, so clearing on !div_req would never arm
  // the second one and it would silently reuse the first quotient.
  // Declared here, not with the ALU block below: slang (and so the open-source
  // flow) requires declarations before use, where Verilator does not.
  wire         div_req;
  /* verilator lint_off UNUSEDSIGNAL */
  logic        div_busy;       // waveform/debug only; done drives the hold logic
  /* verilator lint_on UNUSEDSIGNAL */
  logic        div_done;
  logic div_started;
  wire  div_take = div_req && div_done;      // EX latches the quotient this cycle
  always_ff @(posedge clk) begin
    if (rst)           div_started <= 1'b0;
    else if (!div_req) div_started <= 1'b0;
    else if (div_take) div_started <= 1'b0;
    else               div_started <= 1'b1;
  end
  wire div_start = div_req && !div_started && !div_busy;
  wire div_drain = div_req && !div_done;
  wire div_stall = div_drain && !ex_mem.valid && !mem_wb.valid;

  // ---- ALU ---------------------------------------------------------------
  logic [15:0] alu_result, alu_rd1_val;
  logic        alu_rd_we, alu_rd1_we, alu_overflow;
  logic [31:0] alu_last32;
  logic [1:0]  alu_carry_mode;
  logic        alu_carry_bit;
  logic [15:0] div_quot, div_rem;

  wire [4:0] alu_func5 = id_ex.instr[12:8];
  wire [3:0] alu_rd    = id_ex.instr[7:4];
  wire [3:0] alu_low4  = id_ex.instr[3:0];

  // Which DIV flavour is in EX, and does it need the iterative divider?
  // DIV   = func5 11110, 16/16 -> dividend {16'h0000, r1}, i.e. r1 alone.
  //         The dividend sits in the LOW half so the quotient lands in the low
  //         16 bits of the divider's output, which is what DIV writes to Rd.
  //         {r1, 16'h0000} would compute r1*65536 / Rs instead.
  // DIV32 = func5 11111, 32/16 -> dividend {r1, r3}
  // DIV32 with an odd destination, and both flavours with a zero divisor, are
  // fixed results that never reach the divider. The dividend select only has to
  // test DIV32: anything else in EX is not a division.
  wire alu_is_div   = (alu_func5 == 5'b11110);
  wire alu_is_div32 = (alu_func5 == 5'b11111);
  // Class-gated: func5 is only the ALU function in the ALU class. Without the
  // gate an SOP word such as 0xFF80 (INV, func5 = 11111) looked like DIV32 and
  // armed the iterative divider, freezing the pipeline for 16 clocks.
  wire div_needs_hw = (cls != 3'd4) ? 1'b0
                : alu_is_div32 ? (!alu_rd[0] && (r2 != 16'h0000))
                : alu_is_div  ?   (r2 != 16'h0000)
                : 1'b0;
  // A load-use stall holds the DIV in EX while its operands are still stale, so
  // the divider must not be armed until the load result is bypassable.
`ifdef D16NANO
  // D16nano: the ISA's DIV/DIV32 are not implemented. The kernel image
  // (asm/forth_nano.asm) divides in software, so the iterative unit and its
  // pipeline hold logic can be left out entirely.
  assign div_req    = 1'b0;
`else
  assign div_req    = id_ex.valid && div_needs_hw && !stall;
`endif

  // Signed division (spec Table 8). The iterative divider is unsigned, so it
  // runs on the magnitudes and the ALU re-applies the sign to the quotient
  // (sign of Rd xor Rs) and the remainder (sign of Rd).
  wire [15:0] div_a_mag = r1[15] ? (~r1 + 16'd1) : r1;
  wire [15:0] div_b_mag = r2[15] ? (~r2 + 16'd1) : r2;
  wire [31:0] div32_val = {r1, r3};
  wire [31:0] div32_mag = r1[15] ? (~div32_val + 32'd1) : div32_val;
  wire [31:0] div_dividend = alu_is_div32 ? div32_mag : {16'h0000, div_a_mag};

`ifdef D16NANO
  assign div_busy = 1'b0;
  assign div_done = 1'b1;
  assign div_quot = 16'hFFFF;
  assign div_rem  = 16'h0000;
`else
  deep16_divider u_div (
    .clk      (clk),
    .rst      (rst),
    .start    (div_start),
    .dividend (div_dividend),
    .divisor  (div_b_mag),
    .busy     (div_busy),
    .done     (div_done),
    .quot     (div_quot),
    .rem      (div_rem)
  );
`endif

  deep16_alu u_alu (
    .func5     (alu_func5),
    .rdv       (r1),
    .opv       (r2),
    .low4      (alu_low4),
    .rd        (alu_rd),
    .psw_in    (ctx_e.psw),
    .div_quot  (div_quot),
    .div_rem   (div_rem),
    .result    (alu_result),
    .rd_we     (alu_rd_we),
    .rd1_we    (alu_rd1_we),
    .rd1_val   (alu_rd1_val),
    .last32    (alu_last32),
    .overflow  (alu_overflow),
    .carry_mode(alu_carry_mode),
    .carry_bit (alu_carry_bit)
  );

  // ---- segment and offset decode ----------------------------------------
  wire [15:0] off_s_f = {{11{id_ex.instr[4]}}, id_ex.instr[4:0]};
  wire sel_stack = (ctx_e.psw[9:6] != 4'd0) &&
                   ((ctx_e.psw[9:6] == id_ex.instr[8:5]) ||
                    (ctx_e.psw[10] && (({1'b0, ctx_e.psw[9:6]} + 5'd1) == {1'b0, id_ex.instr[8:5]})));
  wire sel_extra = (ctx_e.psw[14:11] != 4'd0) &&
                   ((ctx_e.psw[14:11] == id_ex.instr[8:5]) ||
                    (ctx_e.psw[15] && (({1'b0, ctx_e.psw[14:11]} + 5'd1) == {1'b0, id_ex.instr[8:5]})));

  wire [15:0] act_cs_q = ctx_e.psw[FLG_S] ? ctx_e.scs : ctx_e.cs;
  wire [15:0] act_ds   = ctx_e.psw[FLG_S] ? ctx_e.sds : ctx_e.ds;
  wire [15:0] act_ss   = ctx_e.psw[FLG_S] ? ctx_e.sss : ctx_e.ss;
  wire [15:0] act_es   = ctx_e.psw[FLG_S] ? ctx_e.ses : ctx_e.es;

  // ---- EX results --------------------------------------------------------
  // Everything below is what the core computes for one instruction; it is the
  // execute cycle of phase 1, unchanged in behaviour.
  d16_ctx_t  ctx_next_ex;
  logic      reg_we_a, reg_we_b;
  logic [3:0]  reg_wa, reg_wb;
  logic [15:0] reg_da, reg_db;
  logic      reg_bank;
  logic      reg_bank_b;
  logic      mem_we_ex;
  logic [20:0] mem_addr_ex;
  logic [15:0] mem_wdata_ex;
  logic      mem_rd_valid_ex, mem_is_load_ex;
  logic [3:0]  load_rd_ex;
  logic      sh_clear_ex, is_swi_ex;
  logic      rec_we_ex;
  logic [20:0] rec_addr_ex;
  logic [15:0] rec_base_ex, rec_segval_ex;
  logic [4:0]  rec_off_ex;
  logic [1:0]  rec_segid_ex;
  logic      rec_store_ex;
  logic      evt_we_ex;
  logic [15:0] evt_code_ex, evt_spc_ex, evt_scs_ex;
  logic      redirect_ex;
  logic [15:0] redirect_pc_ex;
  logic      load_to_pc_ex, pc_from_port_ex;
  logic      appl_pc_ex, appl_spc_ex;

  logic        flags_we;
  logic        psw_we_ex;
  logic        arms_delay;       // this instruction starts a new delay slot
  logic [31:0] last32;
  logic        ovf;
  logic [1:0]  carry_mode;
  logic        carry_bit;

  logic [15:0] imm_val, mov_src, off_jcc, seg_val, base_val;
  logic [20:0] pa_m;
  logic [15:0] act_pc_in, act_pc_out, act_cs_in, act_cs_out;
  logic [3:0]  f_rd, f_rx;
  logic [1:0]  f_seg;
  logic        in_range, seg_is_stack, seg_is_extra;

  // pipeline control (combinational, driven by the EX stage)
  logic ex_kill, kill_id, flush_id;
  logic      fsh_ex;           // this instruction is FSH
  logic      kbd_take_ex;   // this LDS reads the keyboard FIFO data port
  logic      uart_tx_we_ex, uart_take_ex, uart_ctrl_we_ex;
  logic [15:0] uart_tx_data_ex, uart_ctrl_data_ex;

  wire [15:0] pc_own1 = id_ex.pc0 + 16'd1;   // PC sources see own address + 1

  // Does this instruction run as a delay slot? The branch that arms the slot
  // may still be in ID when the slot is fetched, so the question is answered
  // here, from the state chain - the same state the instruction reads.
  wire delay_in_ex = ctx_e.delay_active;

  // FSH reaches the cache from WB, like every other side effect.
  assign cache_flush = ctx.fsh;

  // UART write payloads are plain wires; the strobes are qualified below.
  assign uart_tx_data   = uart_tx_data_ex;
  assign uart_ctrl_data = uart_ctrl_data_ex;

  always_comb begin
    // ---- defaults -------------------------------------------------------
    ctx_next_ex    = ctx_e;
    reg_we_a       = 1'b0; reg_wa = 4'd0; reg_da = 16'h0000;
    reg_we_b       = 1'b0; reg_wb = 4'd0; reg_db = 16'h0000;
    reg_bank       = ctx_e.psw[FLG_S];
    reg_bank_b     = ctx_e.psw[FLG_S];
    mem_we_ex      = 1'b0; mem_addr_ex = 21'd0; mem_wdata_ex = 16'h0000;
    mem_rd_valid_ex= 1'b0; mem_is_load_ex = 1'b0; load_rd_ex = 4'd0;
    sh_clear_ex    = 1'b0; is_swi_ex = 1'b0; fsh_ex = 1'b0;
    kbd_pop        = 1'b0; kbd_take_ex = 1'b0;
    uart_tx_we_ex  = 1'b0; uart_take_ex = 1'b0; uart_ctrl_we_ex = 1'b0;
    uart_tx_data_ex= 16'h0000; uart_ctrl_data_ex = 16'h0000;

    rec_we_ex = 1'b0; rec_addr_ex = 21'd0; rec_base_ex = 16'h0000;
    rec_segval_ex = 16'h0000; rec_off_ex = 5'd0; rec_segid_ex = 2'd1;
    rec_store_ex = 1'b0;

    evt_we_ex = 1'b0; evt_code_ex = 16'h0000;
    evt_spc_ex = 16'h0000; evt_scs_ex = 16'h0000;

    flags_we = 1'b0; last32 = 32'h00000000; ovf = 1'b0;
    psw_we_ex = 1'b0;
    arms_delay = 1'b0;
    carry_mode = CARRY_HEURISTIC; carry_bit = 1'b0;

    imm_val = 16'h0000; mov_src = 16'h0000; off_jcc = 16'h0000;
    seg_val = 16'h0000; base_val = 16'h0000; pa_m = 21'd0;
    in_range = 1'b0; seg_is_stack = 1'b0; seg_is_extra = 1'b0;
    f_rd = 4'd0; f_rx = 4'd0; f_seg = 2'd0;

    // ---- halt word ------------------------------------------------------
    // Never executes and never advances the PC - exactly like the cores, which
    // check the fetched word before the increment. A halt word in a delay slot
    // is not checked by the behavioural cores either, and Phase 1 stopped it
    // as well, so that corner stays as it was.
    ex_kill = id_ex.valid && id_ex.halt_word && !delay_in_ex;

    // ---- event log of a normal fetch (what was about to run) -------------
    if (id_ex.valid && !ex_kill && !delay_in_ex) begin
      evt_we_ex   = 1'b1;
      evt_code_ex = id_ex.instr;
      evt_spc_ex  = id_ex.pc0;
      evt_scs_ex  = id_ex.act_cs;
    end

    redirect_ex = 1'b0;
    redirect_pc_ex = 16'h0000;
    load_to_pc_ex = 1'b0;
    pc_from_port_ex = 1'b0;
    appl_pc_ex = 1'b0; appl_spc_ex = 1'b0;

    if (id_ex.valid && !ex_kill) begin
      // ---- PC pre-increment of the active bank --------------------------
      if (ctx_e.psw[FLG_S]) ctx_next_ex.spc = ctx_e.spc + 16'd1;
      else                  ctx_next_ex.pc  = ctx_e.pc  + 16'd1;

      case (cls)
        3'd1: begin                                             // SYS prefix
          case (id_ex.instr[2:0])
            3'd0: ;                                             // NOP
            3'd1: begin                                         // FSH: invalidate the cache
              // A no-op in the behavioural cores (they have no cache), but
              // architecturally transparent: it only drops cached copies.
              fsh_ex = 1'b1;
            end
            3'd2: begin                                         // SWI
              ctx_next_ex.spsw = ctx_e.psw;
              ctx_next_ex.psw  = 16'h0001 << FLG_S;   // handler PSW: S=1, rest clear
              ctx_next_ex.scs  = 16'h0000;            // sCS/sDS/sSS/sES
              ctx_next_ex.sds  = 16'h0000;
              ctx_next_ex.sss  = 16'h0000;
              ctx_next_ex.ses  = 16'h0000;
              is_swi_ex       = 1'b1;
              // The handler entry is the vector word at physical 0002, and it is
              // read through the *data port* - exactly like a load into R15. The
              // address is issued here, the word lands in WB, pc_from_port makes
              // the fetch take the redirect from there, and the WB write patches
              // the shadow PC. ctx_next_ex.spc therefore stays the *old* shadow
              // PC this cycle (the fetch does not use it: PSW.S is set, so the
              // active CS is already scs = 0, and the PC comes from mem_late).
              mem_addr_ex     = 21'd2;
              mem_rd_valid_ex = 1'b1;
              sh_clear_ex     = 1'b1;
              evt_we_ex       = 1'b1; evt_code_ex = 16'd2; evt_scs_ex = 16'h0000;
              // evt_spc is the same word; it is patched from the read in WB.
            end
            3'd3: begin                                         // RETI
              if (ctx_e.psw[FLG_S]) begin
                ctx_next_ex.psw  = ctx_e.spsw;
                ctx_next_ex.spsw = 16'h0000;
              end else begin
                ctx_next_ex.psw = ctx_e.psw & ~(16'h0001 << FLG_S);
              end
              psw_we_ex = 1'b1;
              evt_we_ex = 1'b1; evt_code_ex = 16'd3;
            end
            3'd4: begin                                         // SETI
              ctx_next_ex.psw = ctx_e.psw |  (16'h0001 << FLG_I);
              psw_we_ex = 1'b1;
            end
            3'd5: begin                                         // CLRI
              ctx_next_ex.psw = ctx_e.psw & ~(16'h0001 << FLG_I);
              psw_we_ex = 1'b1;
            end
            default: ;
          endcase
        end

        3'd2: begin                                             // LDI
          imm_val = {id_ex.instr[14], id_ex.instr[14:0]};
          reg_we_a = 1'b1; reg_wa = 4'd0; reg_da = imm_val;
          flags_we = 1'b1; last32 = {16'h0000, imm_val};
        end

        3'd3: begin                                             // LD / ST
          f_rd = id_ex.instr[12:9];
          seg_is_stack = sel_stack;
          seg_is_extra = sel_extra;
          if      (seg_is_stack) seg_val = act_ss;
          else if (seg_is_extra) seg_val = act_es;
          else                   seg_val = act_ds;
          base_val = r1;
          pa_m = {seg_val, 4'h0} + {5'b00000, (base_val + off_s_f)};
          mem_addr_ex = pa_m;
          in_range = (pa_m < 21'(MEM_WORDS));
          if (in_range) begin
            if (!id_ex.instr[13]) begin                         // LD
              reg_we_a = 1'b1; reg_wa = f_rd;
              mem_rd_valid_ex = 1'b1;
              mem_is_load_ex  = 1'b1;
              load_rd_ex      = f_rd;
            end else begin                                      // ST
              mem_we_ex = 1'b1; mem_wdata_ex = r3;
            end
          end
          // The recent-access record is updated even for an out-of-range
          // access, like the JS core (the WASM core drops those).
          rec_we_ex = 1'b1;
          rec_addr_ex   = pa_m;
          rec_base_ex   = base_val;
          rec_off_ex    = id_ex.instr[4:0];
          rec_segval_ex = seg_val;
          rec_segid_ex  = seg_is_stack ? 2'd2 : (seg_is_extra ? 2'd3 : 2'd1);
          rec_store_ex  = id_ex.instr[13];
        end

        3'd4: begin                                             // ALU
          reg_we_a = alu_rd_we;  reg_wa = alu_rd; reg_da = alu_result;
          reg_we_b = alu_rd1_we; reg_wb = alu_rd + 4'd1; reg_db = alu_rd1_val;
          flags_we   = 1'b1;
          last32     = alu_last32;
          ovf        = alu_overflow;
          carry_mode = alu_carry_mode;
          carry_bit  = alu_carry_bit;
        end

        3'd5: begin
          case (ext_id)
            4'd0: begin                                         // Jcc
              off_jcc = {{7{id_ex.instr[8]}}, id_ex.instr[8:0]};
              case (id_ex.instr[11:9])
                3'd0:    ctx_next_ex.branch_taken = ctx_e.psw[FLG_Z];
                3'd1:    ctx_next_ex.branch_taken = !ctx_e.psw[FLG_Z];
                3'd2:    ctx_next_ex.branch_taken = ctx_e.psw[FLG_C];
                3'd3:    ctx_next_ex.branch_taken = !ctx_e.psw[FLG_C];
                3'd4:    ctx_next_ex.branch_taken = ctx_e.psw[FLG_N];
                3'd5:    ctx_next_ex.branch_taken = !ctx_e.psw[FLG_N];
                3'd6:    ctx_next_ex.branch_taken = ctx_e.psw[FLG_V];
                default: ctx_next_ex.branch_taken = !ctx_e.psw[FLG_V];
              endcase
              if (ctx_next_ex.branch_taken) begin
                ctx_next_ex.delay_active      = 1'b1;
                arms_delay                   = 1'b1;
                ctx_next_ex.delayed_pc        = pc_own1 + off_jcc;
                ctx_next_ex.delayed_cs        = id_ex.act_cs;
                ctx_next_ex.delayed_to_shadow = ctx_e.psw[FLG_S];
              end
            end

            4'd1: begin                                         // LDS / STS
              f_rd   = id_ex.instr[7:4];
              f_seg  = id_ex.instr[9:8];
              seg_val = (f_seg == 2'd0) ? act_cs_q :
                        (f_seg == 2'd1) ? act_ds   :
                        (f_seg == 2'd2) ? act_ss   : act_es;
              pa_m = {seg_val, 4'h0} + {5'b00000, r1};
              mem_addr_ex = pa_m;
              in_range = (pa_m < 21'(MEM_WORDS));
              rec_we_ex = 1'b1;
              rec_addr_ex = pa_m; rec_base_ex = r1; rec_off_ex = 5'd0;
              rec_segval_ex = seg_val; rec_segid_ex = f_seg;
              rec_store_ex = id_ex.instr[10];
              if (in_range) begin
                if (!id_ex.instr[10]) begin                     // LDS
                  reg_we_a = 1'b1; reg_wa = f_rd;
                  if (pa_m == KBD_STATUS_ADDR) begin
                    reg_da = kbd_ready ? 16'd1 : 16'd0;
                  end else if (pa_m == KBD_DATA_ADDR) begin
                    // read and pop in EX: a following LDS KBD_DATA has to see
                    // the next key, exactly like one instruction per step does
                    reg_da  = kbd_ready ? kbd_head : 16'd0;
                    kbd_take_ex = 1'b1;
                  end else if (pa_m == UART_STATUS_ADDR) begin
                    reg_da = uart_status;
                  end else if (pa_m == UART_DATA_ADDR) begin
                    // read and pop in EX, like the keyboard data port
                    reg_da = uart_rx_data;
                    uart_take_ex = 1'b1;
                  end else begin
                    mem_rd_valid_ex = 1'b1;
                    mem_is_load_ex  = 1'b1;
                    load_rd_ex      = f_rd;
                  end
                end else begin                                  // STS
                  if (pa_m == UART_DATA_ADDR) begin
                    uart_tx_we_ex = 1'b1; uart_tx_data_ex = r3;
                  end else if (pa_m == UART_CTRL_ADDR) begin
                    uart_ctrl_we_ex = 1'b1; uart_ctrl_data_ex = r3;
                  end else begin
                    mem_we_ex = 1'b1; mem_wdata_ex = r3;
                  end
                end
              end
            end

            4'd2: begin                                         // MOV Rd, Rs, imm2
              f_rd    = id_ex.instr[9:6];
              mov_src = (id_ex.instr[5:2] == 4'd15) ? pc_own1 : r1;
              case (id_ex.instr[1:0])
                2'd0:    imm_val = mov_src;
                2'd1:    imm_val = mov_src << 1;
                2'd2:    imm_val = mov_src + 16'd2;
                default: imm_val = (mov_src << 1) | 16'd1;
              endcase
              if (f_rd == 4'd15) begin                           // MOV to PC
                ctx_next_ex.delay_active      = 1'b1;
                arms_delay                   = 1'b1;
                ctx_next_ex.branch_taken      = 1'b1;
                ctx_next_ex.delayed_pc        = imm_val;
                ctx_next_ex.delayed_cs        = id_ex.act_cs;
                ctx_next_ex.delayed_to_shadow = ctx_e.psw[FLG_S];
              end else begin
                reg_we_a = 1'b1; reg_wa = f_rd; reg_da = imm_val;
              end
              flags_we = 1'b1; last32 = {16'h0000, imm_val};
            end

            4'd3: begin                                         // LSI Rd, imm5
              f_rd = id_ex.instr[8:5];
              imm_val = {{11{id_ex.instr[4]}}, id_ex.instr[4:0]};
              reg_we_a = 1'b1; reg_wa = f_rd; reg_da = imm_val;
              flags_we = 1'b1; last32 = {16'h0000, imm_val};
            end

            4'd4: begin                                         // SMV Rd, <alt>
              f_rx = id_ex.instr[7:4];
              case (id_ex.instr[3:0])
                4'h0: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = ctx_e.psw[FLG_S] ? ctx_e.cs  : ctx_e.scs; end
                4'h1: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = ctx_e.psw[FLG_S] ? ctx_e.ds  : ctx_e.sds; end
                4'h2: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = ctx_e.psw[FLG_S] ? ctx_e.ss  : ctx_e.sss; end
                4'h3: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = ctx_e.psw[FLG_S] ? ctx_e.es  : ctx_e.ses; end
                // SMV ARy, Rx: write the inactive bank from the active Rx.
                4'h4, 4'h5, 4'h6, 4'h7: begin
                  reg_we_b   = 1'b1;
                  reg_wb     = {2'b00, id_ex.instr[1:0]};
                  reg_db     = r1;
                  reg_bank_b = ~ctx_e.psw[FLG_S];
                end
                4'hC: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = ctx_e.spsw; end                  // APSW (moved)
                4'h8, 4'h9, 4'hA, 4'hB, 4'hD, 4'hE: begin
                  reg_we_a = 1'b1; reg_wa = f_rx; reg_da = r_inact; end
                4'hF: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = pc_own1; end                     // APC
                default: ;
              endcase
            end

            4'd5: begin                                         // MVS
              f_rd = id_ex.instr[5:2];
              if (!id_ex.instr[6]) begin                         // MVS Rd, SEG
                reg_we_a = 1'b1; reg_wa = f_rd;
                reg_da = (id_ex.instr[1:0] == 2'd0) ? act_cs_q :
                       (id_ex.instr[1:0] == 2'd1) ? act_ds   :
                       (id_ex.instr[1:0] == 2'd2) ? act_ss   : act_es;
              end else begin                                     // MVS SEG, Rd
                if (ctx_e.psw[FLG_S]) begin
                  case (id_ex.instr[1:0])
                    2'd0:    ctx_next_ex.scs = r1;
                    2'd1:    ctx_next_ex.sds = r1;
                    2'd2:    ctx_next_ex.sss = r1;
                    default: ctx_next_ex.ses = r1;
                  endcase
                end else begin
                  case (id_ex.instr[1:0])
                    2'd0:    ctx_next_ex.cs = r1;
                    2'd1:    ctx_next_ex.ds = r1;
                    2'd2:    ctx_next_ex.ss = r1;
                    default: ctx_next_ex.es = r1;
                  endcase
                end
              end
            end

            4'd6: begin                                         // SOP
              f_rx = id_ex.instr[3:0];
              case (id_ex.instr[5:4])
                2'd0: begin                                     // INV Rx
                  reg_we_a = 1'b1; reg_wa = f_rx; reg_da = ~r1;
                  flags_we = 1'b1; last32 = {16'h0000, ~r1};
                end
                2'd1: begin                                     // NEG Rx
                  reg_we_a = 1'b1; reg_wa = f_rx; reg_da = ~r1 + 16'd1;
                  flags_we = 1'b1; last32 = {16'h0000, (~r1 + 16'd1)};
                end
                2'd2: begin ctx_next_ex.psw = r1; psw_we_ex = 1'b1; end   // SPSW Rx
                default: begin                                  // LPSW Rx
                  reg_we_a = 1'b1; reg_wa = f_rx; reg_da = ctx_e.psw;
                end
              endcase
            end

            4'd7: begin                                         // SET/CLR PSW
              if (id_ex.instr[3:0] != 4'd4) begin               // imm4=4 ignored
                if (!id_ex.instr[4]) ctx_next_ex.psw = ctx_e.psw |  (16'h0001 << id_ex.instr[3:0]);
                else                ctx_next_ex.psw = ctx_e.psw & ~(16'h0001 << id_ex.instr[3:0]);
                psw_we_ex = 1'b1;
              end
            end

            4'd8: begin                                         // JML Rx
              f_rx = id_ex.instr[3:0];
              if (!f_rx[0]) begin                                // even Rx only
                ctx_next_ex.delay_active      = 1'b1;
                arms_delay                   = 1'b1;
                ctx_next_ex.branch_taken      = 1'b1;
                ctx_next_ex.delayed_pc        = r2;              // PC = R[Rx+1]
                ctx_next_ex.delayed_cs        = r1;              // CS = R[Rx]
                ctx_next_ex.delayed_to_shadow = ctx_e.psw[FLG_S];
              end
            end

            4'd9: begin
              // SYS through the extended chain: unreachable, every SYS word
              // matches the 0xFFF0 prefix fast path above.
            end

            default: ;                                          // reserved: NOP
          endcase
        end

        default: ;
      endcase

      // FSH is a one-shot like the delay state: it must not stay asserted.
      if (!fsh_ex) ctx_next_ex.fsh = 1'b0;

      // ---- keyboard FIFO pop ----------------------------------------------
      // The FIFO is popped from EX, not from WB, so that an LDS KBD_DATA in
      // the next cycle already sees the next key - one retired instruction
      // per key, exactly like the behavioural cores. That makes this the one
      // side effect outside WB, so it has to be qualified by "this
      // instruction is really leaving EX on this edge":
      //   - the single-step freeze holds the stage between two steps, and a
      //     held instruction would otherwise pop again on the step's last edge,
      //   - a load-use stall holds the instruction for another cycle.
      // The freeze is `step_done && !i_free`: in free-run the machine retires
      // every cycle, so step_done is high almost always while the pipe still
      // advances - gating on step_done alone would mute the console on the
      // board, where there is no step handshake at all.
      kbd_pop = kbd_take_ex && run && !step_freeze && !stall && !mem_stall && kbd_ready;
      // The UART strobes are side effects outside WB too, qualified the same way.
      uart_tx_we   = uart_tx_we_ex   && run && !step_freeze && !stall && !mem_stall;
      uart_rx_take = uart_take_ex     && run && !step_freeze && !stall && !mem_stall;
      uart_ctrl_we = uart_ctrl_we_ex  && run && !step_freeze && !stall && !mem_stall;

      // ---- delay-slot bookkeeping ------------------------------------------
      // A delay slot is armed by a branch and consumed by the very next
      // instruction - which is what makes a branch inside the slot override
      // the outer transfer and a not-taken branch drop it.
      if (!arms_delay) ctx_next_ex.delay_active = 1'b0;

      // ---- PSW flags ------------------------------------------------------
      // An explicit PSW write wins over the NZVC update (as in phase 1).
      if (flags_we && !psw_we_ex) begin
        ctx_next_ex.psw = apply_nzvc(ctx_next_ex.psw, last32, ovf, carry_mode, carry_bit);
      end

      // ---- register writes ------------------------------------------------
      // Index 15 is the PC and lives in the state bundle; everything else goes
      // to the register file in the bank of this instruction's PSW.
      if (reg_we_a && reg_wa == 4'd15) begin
        ctx_next_ex.pc = reg_da;
        reg_we_a = 1'b0;
      end
      if (reg_we_b && reg_wb == 4'd15) begin
        ctx_next_ex.pc = reg_db;
        reg_we_b = 1'b0;
      end

      // ---- delay-slot apply ------------------------------------------------
      // The transfer of the branch that entered this slot is applied after the
      // slot instruction has run, with the values the slot itself produced -
      // which is why a branch inside the slot overrides the outer transfer and
      // a not-taken branch in the slot drops it.
      if (delay_in_ex && ctx_next_ex.branch_taken) begin
        if (ctx_next_ex.delayed_to_shadow) begin
          ctx_next_ex.spc    = ctx_next_ex.delayed_pc;
          ctx_next_ex.scs    = ctx_next_ex.delayed_cs;
          appl_spc_ex        = 1'b1;
        end else begin
          ctx_next_ex.pc     = ctx_next_ex.delayed_pc;
          ctx_next_ex.cs     = ctx_next_ex.delayed_cs;
          appl_pc_ex         = 1'b1;
        end
      end

      // ---- fetch redirect ---------------------------------------------------
      // A redirect is needed whenever the *active* PC or the *active* CS no
      // longer follows the sequential fetch: SWI (new context, vector PC), a
      // load into R15, RETI (back to the user context), a branch apply, and
      // MVS of the active code segment. A branch itself does not redirect -
      // its transfer stays pending while the slot runs.
      //
      // Two of them take their target from the data port (the SWI vector word
      // and a load into R15). The read is issued while the instruction sits in
      // MEM and the word arrives in WB, so the fetch picks those up one stage
      // later, marked by pc_from_port - the WB write patches the PC (or the
      // shadow PC, for the SWI) from the same word.
      act_pc_in     = ctx_e.psw[FLG_S] ? ctx_e.spc : ctx_e.pc;
      act_pc_out    = ctx_next_ex.psw[FLG_S] ? ctx_next_ex.spc : ctx_next_ex.pc;
      act_cs_in     = ctx_e.psw[FLG_S] ? ctx_e.scs : ctx_e.cs;
      act_cs_out    = ctx_next_ex.psw[FLG_S] ? ctx_next_ex.scs : ctx_next_ex.cs;
      load_to_pc_ex = mem_rd_valid_ex && mem_is_load_ex && (load_rd_ex == 4'd15);
      pc_from_port_ex = load_to_pc_ex || is_swi_ex;
      redirect_ex   = pc_from_port_ex ||
                      (act_pc_out != act_pc_in + 16'd1) ||
                      (act_cs_out != act_cs_in);
      if (redirect_ex && !pc_from_port_ex) redirect_pc_ex = act_pc_out;
    end

    // ---- pipeline control --------------------------------------------------
    // A redirect discovered in EX invalidates the two instructions that were
    // fetched behind it: the one in ID and the one in IF/ID. Both are dropped,
    // and the fetch that follows already uses the new active PC. A halt word
    // does the same to everything behind it - nothing runs after it.
    kill_id  = id_ex.valid && (ex_kill || redirect_ex);
    flush_id = id_ex.valid && (ex_kill || redirect_ex);
  end

  // =====================================================================
  // Stage 1: instruction fetch
  // =====================================================================
  // The active CS comes from the state chain *including* the EX stage: the
  // instruction the fetch reads now is the one after the EX instruction, so it
  // must see everything the EX instruction writes (MVS CS, SWI, branch apply).
  logic [15:0] if_cs;
  logic [20:0] if_pa;
  logic        if_halt_word;
  logic        if_valid;
  logic [15:0] if_pc_next;
  // A redirect whose target comes from the data port (the SWI vector word, a
  // load into R15) is not known in EX - the word only lands in WB. Until then
  // the fetch must not take the stale target, and nothing may enter the pipeline
  // behind the redirecting instruction: pc_pending spans that instruction's EX
  // and MEM cycles, mem_late is its WB cycle.
  logic        mem_late, if_redirect, pc_pending;

  // The instruction memory is synchronous (BSRAM): the word on the bus now is
  // the one asked for last cycle. `if_cs_q`/`if_pc_q` are the segment and PC the
  // read was issued for; when they still match this cycle's if_pa the word is
  // the one we want, otherwise it is stale and the fetch holds for a cycle
  // (re-issuing the current address) - which is also how a segment change
  // catches up. This is a prefetch: the address presented is the *next* one, so
  // the registered word lands exactly where the combinational array used to.
  logic [15:0] if_cs_q, if_pc_q;
  logic        if_hit;        // the registered word is for this cycle's if_pa
  logic [15:0] if_next_pc;    // the PC the memory read is being issued for
  // A segment write in flight: hold the fetch until it commits, so the segment
  // can come from the committed context instead of EX's next state (§4.7
  // step A). Only the *effective* fetch segment reaches the address, so that
  // is what each in-flight stage is compared on - a bank write that leaves the
  // active segment alone costs nothing.
  logic        if_hold;
  function automatic logic fetch_seg_diff(input logic s, input logic [15:0] cs,
                                          input logic [15:0] scs);
    return (s ? scs : cs) != (ctx.psw[FLG_S] ? ctx.scs : ctx.cs);
  endfunction

  always_comb begin
    // The fetch segment is the *committed* one. Taking it from ctx_next_ex put
    // the whole EX next-state cone (register file, shadow bank) in front of the
    // BSRAM address. The price is that a segment write is seen one stage later:
    // while it is in flight the fetch is held (if_hold), so no wrong-segment
    // word is ever captured.
    if_hold        = (id_ex.valid  && fetch_seg_diff(ctx_next_ex.psw[FLG_S],
                                                    ctx_next_ex.cs, ctx_next_ex.scs)) ||
                     (ex_mem.valid && fetch_seg_diff(ex_mem.ctx_next.psw[FLG_S],
                                                    ex_mem.ctx_next.cs, ex_mem.ctx_next.scs)) ||
                     (mem_wb.valid && fetch_seg_diff(mem_wb.ctx_next.psw[FLG_S],
                                                    mem_wb.ctx_next.cs, mem_wb.ctx_next.scs));
    if_cs          = ctx.psw[FLG_S] ? ctx.scs : ctx.cs;
    if_pa          = {if_cs, 4'h0} + {5'b00000, if_pc};
    if_valid       = run && !halt_sticky;
    // A load into R15 (or a SWI vector through the data port) redirects the
    // fetch to the loaded word. With the synchronous read that word is on the
    // bus in WB, one stage later than it used to be, so the redirect is taken
    // from there - and not from the (still stale) target in EX.
    mem_late       = mem_wb.valid && mem_wb.pc_from_port;
    pc_pending     = pc_from_port_ex || ex_mem.pc_from_port;
    if_redirect    = (redirect_ex && !pc_from_port_ex) || mem_late;
    // The redirect target is deliberately *not* muxed into the address
    // presented to memory. That mux was ctx_next_ex -> redirect_pc_ex ->
    // if_addr -> BSRAM ADB, the 27 MHz critical path (§4.7). The target is
    // registered into if_pc below, and the wrong-path word issued on the
    // redirect cycle is dropped by the if_hit miss - one cycle per taken
    // redirect, instead of a path that cannot meet 37 ns.
    if_pc_next     = if_redirect ? (mem_late ? mem_rdata : redirect_pc_ex)
                                  : (if_pc + 16'd1);
    // The word on the bus is the one asked for last cycle; if_hit says whether
    // that request was for this cycle's if_pa (a segment change makes it stale),
    // and if_preempted says a load took the read port and the word is not ours.
    if_hit         = (if_cs_q == if_cs) && (if_pc_q == if_pc) && !if_preempted;
    // Issue for the next cycle: hold while the pipeline is stalled or while a
    // port redirect is still in flight, else advance - or re-issue the current
    // address when the word was stale. Nothing EX produces is in this cone.
    if_next_pc     = (stall || div_stall || mem_stall) ? if_pc
                   : (pc_pending && !mem_late) ? if_pc
                   : if_hit               ? (if_pc + 16'd1)
                                          : if_pc;
    if_addr        = {if_cs, 4'h0} + {5'b00000, if_next_pc};
  end

  // The word test needs the memory read data, so it lives in its own block:
  // merged with the address block above, the fetch port would fold back into
  // itself (the same trap phase 1 documents for the data port).
  always_comb begin
    // Only a word that is actually being captured can halt the machine. With
    // the segment taken from the committed context (step A) the address is
    // {old CS, new PC} for the cycle a redirect lands ahead of the commit; that
    // is wrong-path and may point outside memory, which is not a halt.
    if_halt_word = if_hit && ((if_pa >= 21'(MEM_WORDS)) || (if_rdata == 16'hFFFF));
  end

  // ---- register contents of the next pipeline stage ----------------------
  always_comb begin
    if_id_n           = if_id;
    // A redirect whose target only arrives with the data port (SWI vector, a
    // load into R15) also invalidates the fetch for as long as it is in flight:
    // if_pc still holds the old address until the word is on the bus, so
    // anything fetched in that window is wrong-path and must not be captured.
    if_id_n.valid     = if_valid && !flush_id && !pc_pending && !mem_late && !if_hold;
    if_id_n.instr     = if_rdata;
    if_id_n.pc0       = if_pc;
    if_id_n.act_cs    = if_cs;
    if_id_n.halt_word = if_halt_word;
  end

  always_comb begin
    // EX -> MEM
    ex_mem_n        = '0;
    ex_mem_n.instr      = id_ex.instr;
    ex_mem_n.ctx_next   = ctx_next_ex;
    ex_mem_n.is_swi     = is_swi_ex;
    ex_mem_n.sh_clear   = sh_clear_ex;
    ex_mem_n.reg_we_a   = reg_we_a;
    ex_mem_n.reg_wa     = reg_wa;
    ex_mem_n.reg_da     = reg_da;
    ex_mem_n.reg_we_b   = reg_we_b;
    ex_mem_n.reg_wb     = reg_wb;
    ex_mem_n.reg_db     = reg_db;
    ex_mem_n.reg_bank   = reg_bank;
    ex_mem_n.reg_bank_b = reg_bank_b;
    ex_mem_n.mem_we     = mem_we_ex;
    ex_mem_n.mem_addr   = mem_addr_ex;
    ex_mem_n.mem_wdata  = mem_wdata_ex;
    ex_mem_n.mem_rd_valid = mem_rd_valid_ex;
    ex_mem_n.mem_is_load  = mem_is_load_ex;
    ex_mem_n.load_rd      = load_rd_ex;
    ex_mem_n.pc_from_port = pc_from_port_ex;
    ex_mem_n.appl_pc      = appl_pc_ex;
    ex_mem_n.appl_spc     = appl_spc_ex;
    ex_mem_n.rec_we    = rec_we_ex;
    ex_mem_n.rec_addr  = rec_addr_ex;
    ex_mem_n.rec_base  = rec_base_ex;
    ex_mem_n.rec_seg   = rec_segval_ex;
    ex_mem_n.rec_off   = rec_off_ex;
    ex_mem_n.rec_segid = rec_segid_ex;
    ex_mem_n.rec_store = rec_store_ex;
    ex_mem_n.evt_we    = evt_we_ex;
    ex_mem_n.evt_code  = evt_code_ex;
    ex_mem_n.evt_spc   = evt_spc_ex;
    ex_mem_n.evt_scs   = evt_scs_ex;

    // MEM -> WB. A load's data arrives one clock after MEM (the synchronous
    // read) - i.e. in WB - so it is not captured here. mem_wb_wdata below picks
    // it up for the register write and the bypass, and the load-to-PC update
    // happens in the WB write.
    mem_wb_n        = ex_mem;
  end

  // ---- data ports ---------------------------------------------------------
  // The memory is synchronous, so the read address is issued one stage earlier
  // than the data is used: presented in EX, the registered word arrives in MEM
  // - exactly where the combinational array used to deliver it. The write port
  // still serves WB, so stores become visible when their instruction retires,
  // which is what the single-step cores do.
  always_comb begin
    mem_addr  = ex_mem.mem_rd_valid ? ex_mem.mem_addr : 21'd0;
    mem_rd    = ex_mem.mem_rd_valid;
    mem_we    = mem_wb.valid && mem_wb.mem_we;
    mem_waddr = mem_wb.mem_addr;
    mem_wdata = mem_wb.mem_wdata;
  end

  // =====================================================================
  // Step control and pipeline advance
  // =====================================================================
  wire retire_now = run && mem_wb.valid;
  wire pipe_busy  = if_id.valid || id_ex.valid || ex_mem.valid || mem_wb.valid;
  wire halt_done  = run && halt_sticky && !pipe_busy && !mem_stall;
  // No suppression here on purpose. While the DIV waits, the one or two
  // instructions ahead of it retire exactly as they would without the divider,
  // and that retirement is what ends this step() - as it must, since a step is
  // one retired instruction. The divider has its own clock and keeps counting
  // across the step boundary; div_started latches so the next step() finds the
  // same division still in flight rather than restarting it.
  wire step_done  = retire_now || halt_done;
  // The single-step freeze: in step mode the pipeline holds its stage on the
  // retiring edge (see the pipeline advance below); in free-run it never does.
  // EX-side strobes must be gated by this, not by step_done.
  assign step_freeze = step_done && !i_free;

  assign o_busy = run;
  assign o_halt = halt_sticky;
  assign o_instr_count = instr_count;

  always_ff @(posedge clk) begin
    if (rst) begin
      ctx             <= CTX_RESET;
      if_pc           <= 16'h0000;
      if_cs_q         <= 16'h0000;
      if_pc_q         <= 16'hFFFF;   // never matches the reset fetch: one miss
      if_id           <= '0;
      id_ex           <= '0;
      ex_mem          <= '0;
      mem_wb          <= '0;
      run             <= 1'b0;
      halt_sticky     <= 1'b0;
      cycle_count     <= 32'd0;
      stall_count     <= 32'd0;
      flush_count     <= 32'd0;
      instr_count     <= 32'd0;
      last_event_code <= 16'h0000;
      last_event_spc  <= 16'h0000;
      last_event_scs  <= 16'h0000;
      recent_addr     <= 21'd0;
      recent_base     <= 16'h0000;
      recent_seg_val  <= 16'h0000;
      recent_offset   <= 5'd0;
      recent_seg_idx  <= 2'd1;
      recent_is_store <= 1'b0;
      o_done          <= 1'b0;
      o_result        <= 1'b1;
    end else begin
      // The instruction memory read issued this cycle; remember what it was for,
      // so next cycle's if_hit test can tell whether the word is stale.
      //
      // While a serial memory transaction is in flight (mem_stall) the tags must
      // *hold*: the transaction was issued for the address that was current when
      // it started. The PC is frozen during the stall, but a segment write that
      // commits meanwhile changes if_cs - and re-latching the tags would then
      // match the stale word (issued for {old CS, new PC}) against a fetch that
      // now wants {new CS, new PC}. That is exactly the JML-to-0x0100 boot path:
      // the word read from the truncated address 0x0F0 (0xFFFF filler) was
      // captured as the kernel's first instruction and halted the machine.
      if (!mem_stall) begin
        if_cs_q <= if_cs;
        if_pc_q <= if_next_pc;
      end

      // ---- step handshake --------------------------------------------------
      if (!run) begin
        if (i_step) begin
          run         <= 1'b1;
          // re-arm, exactly like the cores setting running = true at the start
          // of every step: the fetch picks up again where the halt word is
          halt_sticky <= 1'b0;
        end
      end else if (step_done && !i_free) begin
        // In free-run the machine keeps going past a retirement: the retiring
        // instruction leaves WB and its successor is already behind it in the
        // pipe, so the pipeline reaches the 1-instruction-per-cycle the design
        // is capable of. A halt word still ends the run (halt_done), and the
        // caller is expected to drop i_free.
        run <= 1'b0;
      end

      o_done   <= step_done;
      o_result <= retire_now;

      // ---- counters --------------------------------------------------------
      if (run) cycle_count <= cycle_count + 32'd1;
      if (run && stall)  stall_count <= stall_count + 32'd1;
      if (run && !stall) begin
        if      (kill_id)  flush_count <= flush_count + 32'd1;
        else if (flush_id) flush_count <= flush_count + 32'd1;
      end

      // ---- write-back (WB) -------------------------------------------------
      // In-order, so the committed state after every step is the state the
      // behavioural core has after the same instruction. Gated by run: an
      // idle cycle must never commit anything.
      if (run && mem_wb.valid) begin
        ctx           <= mem_wb.ctx_next;
        // A load into R15 is the program counter, and the PC lives in the state
        // bundle. The word is on the memory bus now, so it goes there instead of
        // the register file; a delay-slot transfer applied after the instruction
        // wins, exactly as it does in the cores.
        if (mem_wb.mem_is_load && (mem_wb.load_rd == 4'd15) && !mem_wb.appl_pc)
          ctx.pc <= mem_rdata;
        // The SWI's vector word arrives the same way. PSW.S is already set by
        // the time it lands, so the active PC is the *shadow* PC - that is what
        // the handler entry goes into, and what RETI later restores from.
        if (mem_wb.is_swi && !mem_wb.appl_spc)
          ctx.spc <= mem_rdata;
        instr_count   <= instr_count + 32'd1;
        if (mem_wb.evt_we) begin
          last_event_code <= mem_wb.evt_code;
          last_event_spc  <= mem_wb.is_swi ? mem_rdata : mem_wb.evt_spc;
          last_event_scs  <= mem_wb.evt_scs;
        end
        if (mem_wb.rec_we) begin
          recent_addr     <= mem_wb.rec_addr;
          recent_base     <= mem_wb.rec_base;
          recent_seg_val  <= mem_wb.rec_seg;
          recent_offset   <= mem_wb.rec_off;
          recent_seg_idx  <= mem_wb.rec_segid;
          recent_is_store <= mem_wb.rec_store;
        end
      end

      // ---- pipeline advance --------------------------------------------------
      if (run) begin
        if (mem_stall) begin
          // A memory transaction is in flight: hold IF/ID/EX (the address the
          // top is fetching stays put) and let WB drain with a bubble. The
          // instruction in WB commits above; the load in MEM waits here until
          // its word arrives.
          mem_wb <= '0;
          // A redirect whose target arrives with the data port (the SWI vector
          // word, a load into PC) lands in WB - and with a serial memory WB is
          // always a stall cycle, so the advance branch below never sees it.
          // Apply it here: mem_late disappears with mem_wb on the next edge and
          // the redirect would be lost, leaving the fetch on the old path (the
          // SWI would fall through instead of entering the BIOS).
          if (if_redirect) begin
            if_pc <= if_pc_next;
            if_id <= '0;
          end
          // Shared registers (R4-R12) live in the normal slots even while the
          // shadow bank is active. Writing their refreshed value into the _s
          // slot left the slot the ALU reads (_n) at the stale ID capture - a
          // shadow-bank load-use pair over the serial PSRAM (a BIOS call right
          // after a load) then computed with 0. Only banked registers take the
          // _s slot; port 1 also carries SMV's other-bank value.
          if (in_shadow) begin
            if (idx_banked(id_ex.ra1)) id_ex.op1_s <= r1;
            else                       id_ex.op1_n <= r1;
            if (idx_banked(id_ex.ra2)) id_ex.op2_s <= r2;
            else                       id_ex.op2_n <= r2;
            if (idx_banked(id_ex.ra3)) id_ex.op3_s <= r3;
            else                       id_ex.op3_n <= r3;
            id_ex.op1_n <= r_inact;
          end else begin
            id_ex.op1_n <= r1; id_ex.op2_n <= r2; id_ex.op3_n <= r3;
            id_ex.op1_s <= r_inact;
          end
        end else if (step_freeze) begin
          // the step ends here: the retiring instruction leaves WB, the rest
          // of the pipeline waits for the next i_step. The stage is cleared
          // completely - its write ports are wired to the register file and
          // the memory, which must not see a result twice.
          if (retire_now) mem_wb <= '0;
          // The stage cleared above may be the one EX is forwarding from.
          // Keep what EX sees now: with the operands in flip-flops there is no
          // register-file read to fall back on, and the held instruction would
          // otherwise execute the stale ID-time value on the next step. Each
          // field is written with the bank its reader selects: port 1 also
          // serves SMV, which reads the *other* bank.
          // Shared registers (R4-R12) live in the normal slots even while the
          // shadow bank is active. Writing their refreshed value into the _s
          // slot left the slot the ALU reads (_n) at the stale ID capture - a
          // shadow-bank load-use pair over the serial PSRAM (a BIOS call right
          // after a load) then computed with 0. Only banked registers take the
          // _s slot; port 1 also carries SMV's other-bank value.
          if (in_shadow) begin
            if (idx_banked(id_ex.ra1)) id_ex.op1_s <= r1;
            else                       id_ex.op1_n <= r1;
            if (idx_banked(id_ex.ra2)) id_ex.op2_s <= r2;
            else                       id_ex.op2_n <= r2;
            if (idx_banked(id_ex.ra3)) id_ex.op3_s <= r3;
            else                       id_ex.op3_n <= r3;
            id_ex.op1_n <= r_inact;
          end else begin
            id_ex.op1_n <= r1; id_ex.op2_n <= r2; id_ex.op3_n <= r3;
            id_ex.op1_s <= r_inact;
          end
          // A redirect whose target arrives with the data port lands exactly on
          // this edge: the SWI's vector word is read in its own MEM cycle and
          // used in WB - which is where the SWI retires. Freezing the fetch
          // here would drop the target, so the redirect is applied regardless;
          // whatever is on the bus this cycle is wrong-path either way.
          if (if_redirect) begin
            if_pc <= if_pc_next;
            if_id <= '0;
          end
        end else begin
          // A load-use stall keeps shifting WB on purpose: the bubble is the
          // point, the load walks into WB and keeps ctx_e's chain alive.
          // The divider does the opposite - it freezes WB once the pipe ahead
          // of it has drained, so that chain may legitimately fall through.
          if (!div_stall) mem_wb <= mem_wb_n;
          if (!stall && !div_stall) begin
            if (!div_drain) begin
              ex_mem       <= ex_mem_n;
              ex_mem.valid <= id_ex.valid && !ex_kill;
              id_ex       <= id_ex_n;
              id_ex.valid <= if_id.valid && !kill_id;
              // A stale prefetch leaves IF/ID with a bubble (the address is
              // re-issued, or a redirect target is taken); a good word is
              // captured as usual.
              if (if_hit) if_id <= if_id_n;
              else        if_id <= '0;
              // A redirect target is registered here, not presented to the
              // memory this cycle (see the if_pc_next note above).
              // A segment write in flight holds the PC - but not the address:
              // the hold must stay out of the BSRAM address cone. The word
              // fetched meanwhile is wrong-path and dropped by if_hold.
              if_pc        <= if_redirect ? if_pc_next
                           : if_hold      ? if_pc
                                          : if_next_pc;
            end else begin
              // DIV is waiting in EX: it must not move on, and EX/MEM takes a
              // bubble so the instruction before it can retire.
              ex_mem.valid <= 1'b0;
            end
          end else begin
            // Load-use hazard: EX holds its instruction and IF/ID holds the
            // one behind it, a bubble goes into MEM - so the load the EX
            // instruction waits for walks on to WB and can be bypassed from
            // there. Freezing MEM instead would deadlock the machine.
            ex_mem.valid <= 1'b0;
          end
          // A held EX instruction refreshes what it sees into its operand
          // registers. A producer can retire while it waits (the load-use case
          // is exactly that), and the ID-time capture would then be stale with
          // no register-file read left to fall back on.
          if (stall || div_stall || div_drain) begin
            if (in_shadow) begin
              if (idx_banked(id_ex.ra1)) id_ex.op1_s <= r1;
              else                       id_ex.op1_n <= r1;
              if (idx_banked(id_ex.ra2)) id_ex.op2_s <= r2;
              else                       id_ex.op2_n <= r2;
              if (idx_banked(id_ex.ra3)) id_ex.op3_s <= r3;
              else                       id_ex.op3_n <= r3;
              id_ex.op1_n <= r_inact;
            end else begin
              id_ex.op1_n <= r1; id_ex.op2_n <= r2; id_ex.op3_n <= r3;
              id_ex.op1_s <= r_inact;
            end
          end
        end
        // A halt word stops the fetch for good. The address is rewound onto
        // the word itself, so a re-armed step reads it again and halts again -
        // the cores behave the same way, because their PC never leaves it.
        if (ex_kill) begin
          halt_sticky <= 1'b1;
          if_pc       <= id_ex.pc0;
        end
      end

`ifndef D16MINI
      // ---- debug writes (harness state seeding, CPU idle only) -------------
      if (dbg_en && dbg_we && !run) begin
        case (dbg_idx)
          // R15 / the shadow PC: only the active one steers the fetch, the
          // inactive one is plain state (this is what the sweep relies on)
          8'h0F: begin ctx.pc <= dbg_wdata; if (!ctx.psw[FLG_S]) if_pc <= dbg_wdata; end
          8'h10: ctx.psw <= dbg_wdata;
          8'h11: ctx.cs  <= dbg_wdata;
          8'h12: ctx.ds  <= dbg_wdata;
          8'h13: ctx.ss  <= dbg_wdata;
          8'h14: ctx.es  <= dbg_wdata;
          8'h15: ctx.spsw <= dbg_wdata;
          8'h16: begin ctx.spc <= dbg_wdata; if (ctx.psw[FLG_S]) if_pc <= dbg_wdata; end
          8'h17: ctx.scs <= dbg_wdata;
          8'h18: ctx.sds <= dbg_wdata;
          8'h19: ctx.sss <= dbg_wdata;
          8'h1A: ctx.ses <= dbg_wdata;
          8'h21: begin
            ctx.delayed_to_shadow <= dbg_wdata[2];
            ctx.branch_taken      <= dbg_wdata[1];
            ctx.delay_active      <= dbg_wdata[0];
          end
          8'h22: ctx.delayed_pc <= dbg_wdata;
          8'h23: ctx.delayed_cs <= dbg_wdata;
          8'h24: last_event_code <= dbg_wdata;
          8'h25: last_event_spc  <= dbg_wdata;
          8'h26: last_event_scs  <= dbg_wdata;
          8'h27: recent_addr[15:0] <= dbg_wdata;
          8'h28: recent_addr[20:16] <= dbg_wdata[4:0];
          8'h29: recent_base <= dbg_wdata;
          8'h2A: recent_offset <= dbg_wdata[4:0];
          8'h2B: recent_seg_val <= dbg_wdata;
          8'h2C: begin
            recent_seg_idx  <= dbg_wdata[1:0];
            recent_is_store <= dbg_wdata[9];
          end
          default: ;
        endcase
        // Seeding architectural state drops whatever the pipeline had already
        // fetched past the instruction the caller is about to set up - the
        // same thing the single-step cores do implicitly, because they only
        // ever hold the instruction they are executing. The whole stage
        // contents go, not just the valid bits: a result in MEM/WB still
        // drives its write ports.
        if_id  <= '0;
        id_ex  <= '0;
        ex_mem <= '0;
        mem_wb <= '0;
      end
`endif
    end
  end

  // ------------------------------------------------------------- debug reads
  // Simulation scaffolding, all of it: the board build answers nothing (§4.3).
`ifndef D16MINI
  assign rf_dbg_we = dbg_en && dbg_we &&
                     ((dbg_idx < 8'h0F) ||
                      (dbg_idx >= 8'h1B && dbg_idx <= 8'h20));

  always_comb begin
    if ((dbg_idx < 8'h0F) ||
        (dbg_idx >= 8'h1B && dbg_idx <= 8'h20) ||
        (dbg_idx >= 8'h30 && dbg_idx <= 8'h3E)) begin
      dbg_rdata = rf_dbg_rdata;
    end else if (dbg_idx >= 8'hC0 && dbg_idx <= 8'hCF) begin
      // boot ROM window: the harness re-plants it without a second copy
      dbg_rdata = boot_rom_word({28'h0, dbg_idx[3:0]});
    end else begin
      case (dbg_idx)
        8'h0F: dbg_rdata = ctx.pc;
        8'h10: dbg_rdata = ctx.psw;
        8'h11: dbg_rdata = ctx.cs;
        8'h12: dbg_rdata = ctx.ds;
        8'h13: dbg_rdata = ctx.ss;
        8'h14: dbg_rdata = ctx.es;
        8'h15: dbg_rdata = ctx.spsw;
        8'h16: dbg_rdata = ctx.spc;
        8'h17: dbg_rdata = ctx.scs;
        8'h18: dbg_rdata = ctx.sds;
        8'h19: dbg_rdata = ctx.sss;
        8'h1A: dbg_rdata = ctx.ses;
        8'h21: dbg_rdata = {12'h000, pipe_busy, ctx.delayed_to_shadow,
                            ctx.branch_taken, ctx.delay_active};
        8'h22: dbg_rdata = ctx.delayed_pc;
        8'h23: dbg_rdata = ctx.delayed_cs;
        8'h24: dbg_rdata = last_event_code;
        8'h25: dbg_rdata = last_event_spc;
        8'h26: dbg_rdata = last_event_scs;
        8'h27: dbg_rdata = recent_addr[15:0];
        8'h28: dbg_rdata = {11'h000, recent_addr[20:16]};
        8'h29: dbg_rdata = recent_base;
        8'h2A: dbg_rdata = {11'h000, recent_offset};
        8'h2B: dbg_rdata = recent_seg_val;
        // 0x2C: bit 9 = is_store, bits 1:0 = segment index
        8'h2C: dbg_rdata = {6'h00, recent_is_store, 7'h00, recent_seg_idx};
        8'h2D: dbg_rdata = cycle_count[15:0];
        8'h2E: dbg_rdata = cycle_count[31:16];
        8'h2F: dbg_rdata = id_ex.instr;            // instruction in EX
        8'h50: dbg_rdata = {13'h0000, run, halt_sticky, stall};
        8'h51: dbg_rdata = {10'h00, halt_sticky, delay_in_ex, pipe_busy,
                            ctx.delayed_to_shadow, ctx.branch_taken,
                            ctx.delay_active};
        8'h52: dbg_rdata = if_pc;                 // address of the next fetch
        8'h53: dbg_rdata = {8'h00, kbd_count};    // keyboard FIFO depth
        8'h54: dbg_rdata = stall_count[15:0];
        8'h55: dbg_rdata = stall_count[31:16];
        8'h56: dbg_rdata = flush_count[15:0];
        8'h57: dbg_rdata = flush_count[31:16];
        8'h58: dbg_rdata = instr_count[15:0];
        8'h59: dbg_rdata = instr_count[31:16];
        8'h5A: dbg_rdata = {12'h00, mem_wb.valid, ex_mem.valid, id_ex.valid,
                            if_id.valid};
        // pipeline internals, for debugging without a waveform viewer
        8'h5B: dbg_rdata = {9'h000, stall, flush_id, kill_id, ex_kill,
                            id_ex.halt_word, if_halt_word, id_ex.valid};
        8'h5C: dbg_rdata = if_id.instr;
        8'h5E: dbg_rdata = ex_mem.instr;
        8'h5F: dbg_rdata = mem_wb.instr;
        // what the MEM/WB stages are about to write
        8'h60: dbg_rdata = {9'h000, ex_mem.reg_bank, ex_mem.reg_we_b,
                            ex_mem.reg_we_a, ex_mem.reg_wa};
        8'h61: dbg_rdata = ex_mem.reg_da;
        8'h62: dbg_rdata = {15'h0000, mem_wb.sh_clear};
        8'h68: dbg_rdata = {4'h0, ra1, ra2, ra3};
        8'h69: dbg_rdata = r1;
        8'h6A: dbg_rdata = r2;
        8'h6B: dbg_rdata = r3;
        8'h6C: dbg_rdata = {8'h00, ex_mem.valid, ex_mem.reg_bank,
                            ex_mem.reg_we_b, ex_mem.reg_we_a, ex_mem.reg_wa};
        8'h6D: dbg_rdata = {8'h00, mem_wb.valid, mem_wb.reg_bank,
                            mem_wb.reg_we_b, mem_wb.reg_we_a, mem_wb.reg_wa};
        8'h6E: dbg_rdata = {14'h0000, kbd_pop, kbd_ready};
        8'h6F: dbg_rdata = {8'h00, kbd_count};  // keyboard FIFO depth: the host

                                                // reads this to pace typing a file
        8'h65: dbg_rdata = {15'h0000, ex_mem.mem_we};
        8'h66: dbg_rdata = ex_mem.mem_addr[15:0];
        8'h67: dbg_rdata = {11'h0000, ex_mem.mem_addr[20:16]};
        8'h63: dbg_rdata = if_id.pc0;
        8'h64: dbg_rdata = {if_id.act_cs[14:0], if_id.halt_word};
        8'h5D: dbg_rdata = {10'h0, if_id.valid, if_id.halt_word, delay_in_ex,
                            id_ex.valid, id_ex.halt_word, delay_in_ex};
        8'h3F: dbg_rdata = if_pa[15:0];
        8'h4F: dbg_rdata = {11'h000, if_pa[20:16]};
        default: dbg_rdata = 16'h0000;
      endcase
    end
  end
`else
  assign dbg_rdata = 16'h0000;
`endif

endmodule
