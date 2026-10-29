// deep16_core3 - the reduced D16nano core: IF / ID / EX-commit.
//
// One instruction is in flight. The instruction semantics are the proven EX
// stage of the five-stage core (delay slots, SWI/RETI, shadow bank, MUL32,
// flags, segment arithmetic); what is gone is the speculative front end, the
// EX/MEM/WB forwarding network and the load-use interlock. Every instruction
// therefore executes against the committed context, reads its operands from
// the register file in ID, and commits its whole next state in EX.
//
// Memory is synchronous and shared with the fetch. A load (or the SWI vector
// word) is issued in EX and commits one cycle later, or after the serial PSRAM
// transaction finishes; a fetch holds its address until the registered read
// matches it. DIV/DIV32 are intentionally absent: asm/forth_nano.asm divides in
// software.
//
// The target is 6.75 MHz (27 MHz / 4) on the Tang Nano 9K; the point of the
// smaller core is area, not instruction throughput.

module deep16_core3
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
  output logic [31:0] o_cycle_count, // CPU cycles (D16nano benchmark time base)

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
  input  logic        mem_valid,   // the data port word above is valid this cycle
  input  logic        mem_store_ack, // a store has been written to memory
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
  // ---- register read addresses ------------------------------------------
  typedef struct packed {
    logic [3:0] a1, a2, a3;
    logic       e1, e2, e3;
  } rd_t;
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
  function automatic logic idx_banked(input logic [3:0] idx);
    idx_banked = (idx == 4'd0)  || (idx == 4'd1)  || (idx == 4'd2) || (idx == 4'd3)
              || (idx == 4'd13) || (idx == 4'd14);
  endfunction

  // ------------------------------------------------------------- state
  d16_ctx_t ctx;
  logic [31:0] cycle_count, instr_count;
  logic        run, halt_sticky;
  logic [15:0] last_event_code, last_event_spc, last_event_scs;
  logic [20:0] recent_addr;
  logic [15:0] recent_base, recent_seg_val;
  logic [4:0]  recent_offset;
  logic [1:0]  recent_seg_idx;
  logic        recent_is_store;

  // The instruction being executed and its ID-time operands.
  typedef struct packed {
    logic        valid;
    logic [15:0] instr;
    logic [15:0] pc0;
    logic [15:0] act_cs;
    logic        halt_word;
    logic [3:0]  ra1, ra2, ra3;
    logic        rd_en1, rd_en2, rd_en3;
    logic [15:0] op1_n, op1_s, op2_n, op2_s, op3_n, op3_s;
    } front_t;

  front_t ex;

  // ------------------------------------------------------------- decode
  idec_t id_dec;
  rd_t   id_rd;
  logic [15:0] rf1_n, rf1_s, rf2_n, rf2_s, rf3_n, rf3_s;

  always_comb begin
    id_dec = decode(ex.valid, ex.instr);
    id_rd  = read_addrs(id_dec, ex.instr);
  end

  wire [2:0] cls    = id_dec.cls;
  wire [3:0] ext_id = id_dec.ext;

  // Operands selected in EX from the ID capture: banked registers use the
  // instruction's bank, shared ones always live in the normal half.
  wire in_shadow = ctx.psw[FLG_S];
  wire [15:0] r1 = (in_shadow && idx_banked(ex.ra1)) ? ex.op1_s : ex.op1_n;
  wire [15:0] r2 = (in_shadow && idx_banked(ex.ra2)) ? ex.op2_s : ex.op2_n;
  wire [15:0] r3 = (in_shadow && idx_banked(ex.ra3)) ? ex.op3_s : ex.op3_n;
  // SMV taps the inactive bank: for a banked register that is the opposite
  // slot, for a shared one the same normal value.
  wire [15:0] r_inact = ((~in_shadow) && idx_banked(ex.ra1)) ? ex.op1_s : ex.op1_n;

  logic [15:0] alu_result, alu_rd1_val;
  logic        alu_rd_we, alu_rd1_we, alu_overflow;
  logic [31:0] alu_last32;
  logic [1:0]  alu_carry_mode;
  logic        alu_carry_bit;
  logic        div_req, div_busy, div_done;
  logic [15:0] div_quot, div_rem;

  // ------------------------------------------------------------- result bus
  wire [4:0] alu_func5 = ex.instr[12:8];
  wire [3:0] alu_rd    = ex.instr[7:4];
  wire [3:0] alu_low4  = ex.instr[3:0];

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
  // D16nano: DIV/DIV32 are not implemented; an ILL trap hands the instruction
  // to the kernel's software divide. Only the cases that would have needed the
  // iterative divider trap: the zero-divisor and odd-DIV32-destination cases
  // keep the ALU's fixed result and match the full core without a trap.
  wire ill_div    = ex.valid && div_needs_hw && !ctx.psw[FLG_S];
  wire ill_double = ex.valid && div_needs_hw &&  ctx.psw[FLG_S];

  assign div_req = 1'b0;
  assign div_busy = 1'b0;
  assign div_done = 1'b1;
  assign div_quot = 16'hFFFF;
  assign div_rem  = 16'h0000;

  // Signed division (spec Table 8). The iterative divider is unsigned, so it
  // runs on the magnitudes and the ALU re-applies the sign to the quotient
  // (sign of Rd xor Rs) and the remainder (sign of Rd).
  wire [15:0] div_a_mag = r1[15] ? (~r1 + 16'd1) : r1;
  wire [15:0] div_b_mag = r2[15] ? (~r2 + 16'd1) : r2;
  wire [31:0] div32_val = {r1, r3};
  wire [31:0] div32_mag = r1[15] ? (~div32_val + 32'd1) : div32_val;
  wire [31:0] div_dividend = alu_is_div32 ? div32_mag : {16'h0000, div_a_mag};

  deep16_alu u_alu (
    .func5     (alu_func5),
    .rdv       (r1),
    .opv       (r2),
    .low4      (alu_low4),
    .rd        (alu_rd),
    .psw_in    (ctx.psw),
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
  wire [15:0] off_s_f = {{11{ex.instr[4]}}, ex.instr[4:0]};
  wire sel_stack = (ctx.psw[9:6] != 4'd0) &&
                   ((ctx.psw[9:6] == ex.instr[8:5]) ||
                    (ctx.psw[10] && (({1'b0, ctx.psw[9:6]} + 5'd1) == {1'b0, ex.instr[8:5]})));
  wire sel_extra = (ctx.psw[14:11] != 4'd0) &&
                   ((ctx.psw[14:11] == ex.instr[8:5]) ||
                    (ctx.psw[15] && (({1'b0, ctx.psw[14:11]} + 5'd1) == {1'b0, ex.instr[8:5]})));

  wire [15:0] act_cs_q = ctx.psw[FLG_S] ? ctx.scs : ctx.cs;
  wire [15:0] act_ds   = ctx.psw[FLG_S] ? ctx.sds : ctx.ds;
  wire [15:0] act_ss   = ctx.psw[FLG_S] ? ctx.sss : ctx.ss;
  wire [15:0] act_es   = ctx.psw[FLG_S] ? ctx.ses : ctx.es;

  // ---- EX results --------------------------------------------------------
  // Everything below is what the core computes for one instruction; it is the
  // execute cycle of phase 1, unchanged in behaviour.
  d16_ctx_t  ctx_next;
  logic      reg_we_a, reg_we_b;
  logic [3:0]  reg_wa, reg_wb;
  logic [15:0] reg_da, reg_db;
  logic      reg_bank;
  logic      reg_bank_b;        // bank for the B write port; the SMV write
                                // deliberately targets the *inactive* bank
  logic      mem_we_ex;
  logic [20:0] mem_addr_ex;
  logic [15:0] mem_wdata_ex;
  logic      mem_rd_valid_ex, mem_is_load_ex;
  logic [3:0]  load_rd_ex;
  logic      is_swi_ex;
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

  wire [15:0] pc_own1 = ex.pc0 + 16'd1;   // PC sources see own address + 1

  // Does this instruction run as a delay slot? The branch that arms the slot
  // may still be in ID when the slot is fetched, so the question is answered
  // here, from the state chain - the same state the instruction reads.
  wire delay_in_ex = ctx.delay_active;

  always_comb begin
    // ---- defaults -------------------------------------------------------
    ctx_next    = ctx;
    reg_we_a       = 1'b0; reg_wa = 4'd0; reg_da = 16'h0000;
    reg_we_b       = 1'b0; reg_wb = 4'd0; reg_db = 16'h0000;
    reg_bank       = ctx.psw[FLG_S];
    reg_bank_b     = ctx.psw[FLG_S];
    mem_we_ex      = 1'b0; mem_addr_ex = 21'd0; mem_wdata_ex = 16'h0000;
    mem_rd_valid_ex= 1'b0; mem_is_load_ex = 1'b0; load_rd_ex = 4'd0;
    is_swi_ex = 1'b0; fsh_ex = 1'b0;
    kbd_take_ex    = 1'b0;
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
    ex_kill = ex.valid && ex.halt_word && !delay_in_ex;

    // ---- event log of a normal fetch (what was about to run) -------------
    if (ex.valid && !ex_kill && !delay_in_ex) begin
      evt_we_ex   = 1'b1;
      evt_code_ex = ex.instr;
      evt_spc_ex  = ex.pc0;
      evt_scs_ex  = ex.act_cs;
    end

    redirect_ex = 1'b0;
    redirect_pc_ex = 16'h0000;
    load_to_pc_ex = 1'b0;
    pc_from_port_ex = 1'b0;
    appl_pc_ex = 1'b0; appl_spc_ex = 1'b0;

    if (ex.valid && !ex_kill) begin
      // ---- PC pre-increment of the active bank --------------------------
      if (ctx.psw[FLG_S]) ctx_next.spc = ctx.spc + 16'd1;
      else                  ctx_next.pc  = ctx.pc  + 16'd1;

      case (cls)
        3'd1: begin                                             // SYS prefix
          case (ex.instr[2:0])
            3'd0: ;                                             // NOP
            3'd1: begin                                         // FSH: invalidate the cache
              // A no-op in the behavioural cores (they have no cache), but
              // architecturally transparent: it only drops cached copies.
              fsh_ex = 1'b1;
            end
            3'd2: begin                                         // SWI
              ctx_next.spsw = ctx.psw;
              ctx_next.psw  = 16'h0001 << FLG_S;   // handler PSW: S=1, rest clear
              ctx_next.scs  = 16'h0000;            // sCS/sDS/sSS/sES
              ctx_next.sds  = 16'h0000;
              ctx_next.sss  = 16'h0000;
              ctx_next.ses  = 16'h0000;
              is_swi_ex       = 1'b1;
              // The handler entry is the vector word at physical 0002, and it is
              // read through the *data port* - exactly like a load into R15. The
              // address is issued here, the word lands in WB, pc_from_port makes
              // the fetch take the redirect from there, and the WB write patches
              // the shadow PC. ctx_next.spc therefore stays the *old* shadow
              // PC this cycle (the fetch does not use it: PSW.S is set, so the
              // active CS is already scs = 0, and the PC comes from mem_late).
              mem_addr_ex     = 21'd2;
              mem_rd_valid_ex = 1'b1;
              evt_we_ex       = 1'b1; evt_code_ex = 16'd2; evt_scs_ex = 16'h0000;
              // evt_spc is the same word; it is patched from the read in WB.
            end
            3'd3: begin                                         // RETI
              if (ctx.psw[FLG_S]) begin
                ctx_next.psw  = ctx.spsw;
                ctx_next.spsw = 16'h0000;
              end else begin
                ctx_next.psw = ctx.psw & ~(16'h0001 << FLG_S);
              end
              psw_we_ex = 1'b1;
              evt_we_ex = 1'b1; evt_code_ex = 16'd3;
            end
            3'd4: begin                                         // SETI
              ctx_next.psw = ctx.psw |  (16'h0001 << FLG_I);
              psw_we_ex = 1'b1;
            end
            3'd5: begin                                         // CLRI
              ctx_next.psw = ctx.psw & ~(16'h0001 << FLG_I);
              psw_we_ex = 1'b1;
            end
            3'd6: begin                                         // SAPF
              // spsw[N,Z,V,C] <- R0'[3:0]; bits 15:4 are hardware-preserved
              ctx_next.spsw[3:0] = ex.op1_s[3:0];
            end
            default: ;
          endcase
        end

        3'd2: begin                                             // LDI
          imm_val = {ex.instr[14], ex.instr[14:0]};
          reg_we_a = 1'b1; reg_wa = 4'd0; reg_da = imm_val;
          flags_we = 1'b1; last32 = {16'h0000, imm_val};
        end

        3'd3: begin                                             // LD / ST
          f_rd = ex.instr[12:9];
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
            if (!ex.instr[13]) begin                         // LD
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
          rec_off_ex    = ex.instr[4:0];
          rec_segval_ex = seg_val;
          rec_segid_ex  = seg_is_stack ? 2'd2 : (seg_is_extra ? 2'd3 : 2'd1);
          rec_store_ex  = ex.instr[13];
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
              off_jcc = {{7{ex.instr[8]}}, ex.instr[8:0]};
              case (ex.instr[11:9])
                3'd0:    ctx_next.branch_taken = ctx.psw[FLG_Z];
                3'd1:    ctx_next.branch_taken = !ctx.psw[FLG_Z];
                3'd2:    ctx_next.branch_taken = ctx.psw[FLG_C];
                3'd3:    ctx_next.branch_taken = !ctx.psw[FLG_C];
                3'd4:    ctx_next.branch_taken = ctx.psw[FLG_N];
                3'd5:    ctx_next.branch_taken = !ctx.psw[FLG_N];
                3'd6:    ctx_next.branch_taken = ctx.psw[FLG_V];
                default: ctx_next.branch_taken = !ctx.psw[FLG_V];
              endcase
              if (ctx_next.branch_taken) begin
                ctx_next.delay_active      = 1'b1;
                arms_delay                   = 1'b1;
                ctx_next.delayed_pc        = pc_own1 + off_jcc;
                ctx_next.delayed_cs        = ex.act_cs;
                ctx_next.delayed_to_shadow = ctx.psw[FLG_S];
              end
            end

            4'd1: begin                                         // LDS / STS
              f_rd   = ex.instr[7:4];
              f_seg  = ex.instr[9:8];
              seg_val = (f_seg == 2'd0) ? act_cs_q :
                        (f_seg == 2'd1) ? act_ds   :
                        (f_seg == 2'd2) ? act_ss   : act_es;
              pa_m = {seg_val, 4'h0} + {5'b00000, r1};
              mem_addr_ex = pa_m;
              in_range = (pa_m < 21'(MEM_WORDS));
              rec_we_ex = 1'b1;
              rec_addr_ex = pa_m; rec_base_ex = r1; rec_off_ex = 5'd0;
              rec_segval_ex = seg_val; rec_segid_ex = f_seg;
              rec_store_ex = ex.instr[10];
              if (in_range) begin
                if (!ex.instr[10]) begin                     // LDS
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
              f_rd    = ex.instr[9:6];
              mov_src = (ex.instr[5:2] == 4'd15) ? pc_own1 : r1;
              case (ex.instr[1:0])
                2'd0:    imm_val = mov_src;
                2'd1:    imm_val = mov_src << 1;
                2'd2:    imm_val = mov_src + 16'd2;
                default: imm_val = (mov_src << 1) | 16'd1;
              endcase
              if (f_rd == 4'd15) begin                           // MOV to PC
                ctx_next.delay_active      = 1'b1;
                arms_delay                   = 1'b1;
                ctx_next.branch_taken      = 1'b1;
                ctx_next.delayed_pc        = imm_val;
                ctx_next.delayed_cs        = ex.act_cs;
                ctx_next.delayed_to_shadow = ctx.psw[FLG_S];
              end else begin
                reg_we_a = 1'b1; reg_wa = f_rd; reg_da = imm_val;
              end
              flags_we = 1'b1; last32 = {16'h0000, imm_val};
            end

            4'd3: begin                                         // LSI Rd, imm5
              f_rd = ex.instr[8:5];
              imm_val = {{11{ex.instr[4]}}, ex.instr[4:0]};
              reg_we_a = 1'b1; reg_wa = f_rd; reg_da = imm_val;
              flags_we = 1'b1; last32 = {16'h0000, imm_val};
            end

            4'd4: begin                                         // SMV Rd, <alt>
              f_rx = ex.instr[7:4];
              case (ex.instr[3:0])
                4'h0: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = ctx.psw[FLG_S] ? ctx.cs  : ctx.scs; end
                4'h1: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = ctx.psw[FLG_S] ? ctx.ds  : ctx.sds; end
                4'h2: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = ctx.psw[FLG_S] ? ctx.ss  : ctx.sss; end
                4'h3: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = ctx.psw[FLG_S] ? ctx.es  : ctx.ses; end
                // SMV ARy, Rx: write the *inactive* bank's R[y] from the
                // active Rx. The B port carries the inactive bank.
                4'h4, 4'h5, 4'h6, 4'h7: begin
                  reg_we_b   = 1'b1;
                  reg_wb     = {2'b00, ex.instr[1:0]};
                  reg_db     = r1;
                  reg_bank_b = ~ctx.psw[FLG_S];
                end
                4'hC: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = ctx.spsw; end              // APSW (moved)
                4'h8, 4'h9, 4'hA, 4'hB, 4'hD, 4'hE: begin
                  reg_we_a = 1'b1; reg_wa = f_rx; reg_da = r_inact; end
                4'hF: begin reg_we_a = 1'b1; reg_wa = f_rx;
                       reg_da = pc_own1; end               // APC
                default: ;
              endcase
            end

            4'd5: begin                                         // MVS
              f_rd = ex.instr[5:2];
              if (!ex.instr[6]) begin                         // MVS Rd, SEG
                reg_we_a = 1'b1; reg_wa = f_rd;
                reg_da = (ex.instr[1:0] == 2'd0) ? act_cs_q :
                       (ex.instr[1:0] == 2'd1) ? act_ds   :
                       (ex.instr[1:0] == 2'd2) ? act_ss   : act_es;
              end else begin                                     // MVS SEG, Rd
                if (ctx.psw[FLG_S]) begin
                  case (ex.instr[1:0])
                    2'd0:    ctx_next.scs = r1;
                    2'd1:    ctx_next.sds = r1;
                    2'd2:    ctx_next.sss = r1;
                    default: ctx_next.ses = r1;
                  endcase
                end else begin
                  case (ex.instr[1:0])
                    2'd0:    ctx_next.cs = r1;
                    2'd1:    ctx_next.ds = r1;
                    2'd2:    ctx_next.ss = r1;
                    default: ctx_next.es = r1;
                  endcase
                end
              end
            end

            4'd6: begin                                         // SOP
              f_rx = ex.instr[3:0];
              case (ex.instr[5:4])
                2'd0: begin                                     // INV Rx
                  reg_we_a = 1'b1; reg_wa = f_rx; reg_da = ~r1;
                  flags_we = 1'b1; last32 = {16'h0000, ~r1};
                end
                2'd1: begin                                     // NEG Rx
                  reg_we_a = 1'b1; reg_wa = f_rx; reg_da = ~r1 + 16'd1;
                  flags_we = 1'b1; last32 = {16'h0000, (~r1 + 16'd1)};
                end
                2'd2: begin ctx_next.psw = r1; psw_we_ex = 1'b1; end   // SPSW Rx
                default: begin                                  // LPSW Rx
                  reg_we_a = 1'b1; reg_wa = f_rx; reg_da = ctx.psw;
                end
              endcase
            end

            4'd7: begin                                         // SET/CLR PSW
              if (ex.instr[3:0] != 4'd4) begin               // imm4=4 ignored
                if (!ex.instr[4]) ctx_next.psw = ctx.psw |  (16'h0001 << ex.instr[3:0]);
                else                ctx_next.psw = ctx.psw & ~(16'h0001 << ex.instr[3:0]);
                psw_we_ex = 1'b1;
              end
            end

            4'd8: begin                                         // JML Rx
              f_rx = ex.instr[3:0];
              if (!f_rx[0]) begin                                // even Rx only
                ctx_next.delay_active      = 1'b1;
                arms_delay                   = 1'b1;
                ctx_next.branch_taken      = 1'b1;
                ctx_next.delayed_pc        = r2;              // PC = R[Rx+1]
                ctx_next.delayed_cs        = r1;              // CS = R[Rx]
                ctx_next.delayed_to_shadow = ctx.psw[FLG_S];
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
      if (!fsh_ex) ctx_next.fsh = 1'b0;

      // ---- ILL trap for DIV/DIV32 ----------------------------------------
      // Same entry sequence as the SWI, but the vector is 0 and the shadow LR
      // is the interrupted PC (the instruction after the trapped one), which is
      // what the handler needs to fetch the opcode at PC-1. The caller's R0..R3
      // are left untouched in the normal bank; the new SMV write form lets the
      // handler put the quotients there.
      if (ill_div) begin
        ctx_next.spsw = ctx.psw;
        ctx_next.psw  = 16'h0020;         // S=1, I=0, flags clear
        ctx_next.scs  = 16'h0000;
        ctx_next.sds  = 16'h0000;
        ctx_next.sss  = 16'h0000;
        ctx_next.ses  = 16'h0000;
        ctx_next.branch_taken = 1'b0;     // a delay-slot DIV must not let the
        ctx_next.delay_active = 1'b0;     // branch override the trap
        reg_we_a   = 1'b0; reg_wa = 4'd0; reg_da = 16'h0000;
        reg_we_b   = 1'b1; reg_wb = 4'd14; reg_db = pc_own1;
        reg_bank_b = 1'b1;                // shadow R14 = interrupted PC
        is_swi_ex   = 1'b1;               // reuse the SWI vector fetch path
        mem_addr_ex = 21'd0;              // ILL vector at physical 0
        mem_rd_valid_ex = 1'b1; mem_is_load_ex = 1'b0;
        evt_we_ex = 1'b1; evt_code_ex = 16'd0; evt_scs_ex = 16'h0000;
        flags_we = 1'b0;
      end

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
      // The board-side strobes are driven from the commit cycle below.

      // ---- delay-slot bookkeeping ------------------------------------------
      // A delay slot is armed by a branch and consumed by the very next
      // instruction - which is what makes a branch inside the slot override
      // the outer transfer and a not-taken branch drop it.
      if (!arms_delay) ctx_next.delay_active = 1'b0;

      // ---- PSW flags ------------------------------------------------------
      // An explicit PSW write wins over the NZVC update (as in phase 1).
      if (flags_we && !psw_we_ex) begin
        ctx_next.psw = apply_nzvc(ctx_next.psw, last32, ovf, carry_mode, carry_bit);
      end

      // ---- register writes ------------------------------------------------
      // Index 15 is the PC and lives in the state bundle; everything else goes
      // to the register file in the bank of this instruction's PSW.
      if (reg_we_a && reg_wa == 4'd15) begin
        ctx_next.pc = reg_da;
        reg_we_a = 1'b0;
      end
      if (reg_we_b && reg_wb == 4'd15) begin
        ctx_next.pc = reg_db;
        reg_we_b = 1'b0;
      end

      // ---- delay-slot apply ------------------------------------------------
      // The transfer of the branch that entered this slot is applied after the
      // slot instruction has run, with the values the slot itself produced -
      // which is why a branch inside the slot overrides the outer transfer and
      // a not-taken branch in the slot drops it.
      if (delay_in_ex && ctx_next.branch_taken) begin
        if (ctx_next.delayed_to_shadow) begin
          ctx_next.spc    = ctx_next.delayed_pc;
          ctx_next.scs    = ctx_next.delayed_cs;
          appl_spc_ex        = 1'b1;
        end else begin
          ctx_next.pc     = ctx_next.delayed_pc;
          ctx_next.cs     = ctx_next.delayed_cs;
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
      act_pc_in     = ctx.psw[FLG_S] ? ctx.spc : ctx.pc;
      act_pc_out    = ctx_next.psw[FLG_S] ? ctx_next.spc : ctx_next.pc;
      act_cs_in     = ctx.psw[FLG_S] ? ctx.scs : ctx.cs;
      act_cs_out    = ctx_next.psw[FLG_S] ? ctx_next.scs : ctx_next.cs;
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
    kill_id  = ex.valid && (ex_kill || redirect_ex);
    flush_id = ex.valid && (ex_kill || redirect_ex);
  end

  // ------------------------------------------------------------- I/O ports
  assign if_addr  = {if_cs, 4'h0} + {5'b00000, if_pc};
  assign mem_we    = ((fsm == F_EXEC) || (fsm == F_STORE)) && mem_we_ex;
  assign mem_waddr = mem_addr_ex;
  assign mem_wdata = mem_wdata_ex;
  assign mem_rd    = ((fsm == F_EXEC) && mem_rd_valid_ex) || (fsm == F_LOAD);
  assign mem_addr  = mem_addr_ex;

  assign cache_flush = ctx.fsh;
  assign uart_tx_data   = uart_tx_data_ex;
  assign uart_ctrl_data = uart_ctrl_data_ex;
  assign uart_tx_we   = commit && uart_tx_we_ex;
  assign uart_rx_take = commit && uart_take_ex;
  assign uart_ctrl_we = commit && uart_ctrl_we_ex;
  assign kbd_pop      = commit && kbd_take_ex && kbd_ready;

  assign o_busy = run;
  assign o_halt = halt_sticky;
  assign o_instr_count = instr_count;
  assign o_cycle_count = cycle_count;

  // ------------------------------------------------------------- fetch
  wire [15:0] if_pc = ctx.psw[FLG_S] ? ctx.spc : ctx.pc;
  wire [15:0] if_cs = ctx.psw[FLG_S] ? ctx.scs : ctx.cs;
  wire [20:0] if_pa = {if_cs, 4'h0} + {5'b00000, if_pc};

  logic [15:0] if_cs_q, if_pc_q;
  wire if_hit = (if_cs_q == if_cs) && (if_pc_q == if_pc) && !if_preempted;
  wire if_halt_word = if_hit && ((if_pa >= 21'(MEM_WORDS)) || (if_rdata == 16'hFFFF));

  // ------------------------------------------------------------- commit
  // A load's word is mem_rdata; everything else is the EX result. The SWI
  // vector word arrives the same way and patches the shadow PC.
  logic commit;
  always_comb begin
    commit = (fsm == F_EXEC && !mem_rd_valid_ex && !mem_we_ex) ||
             (fsm == F_LOAD && mem_valid) ||
             (fsm == F_STORE && mem_store_ack);
  end

  wire [15:0] wb_data_a = (mem_rd_valid_ex && mem_is_load_ex) ? mem_rdata : reg_da;

  deep16_regfile u_regfile (
    .clk       (clk),
    .rst       (rst),
    .raddr1    (id_rd.a1), .rdata1_n (rf1_n), .rdata1_s (rf1_s),
    .raddr2    (id_rd.a2), .rdata2_n (rf2_n), .rdata2_s (rf2_s),
    .raddr3    (id_rd.a3), .rdata3_n (rf3_n), .rdata3_s (rf3_s),
    .wb_bank   (ctx.psw[FLG_S]),
    .wb_bank_b (reg_bank_b),
    .we_a      (commit && reg_we_a),
    .waddr_a   (reg_wa), .wdata_a (wb_data_a),
    .we_b      (commit && reg_we_b),
    .waddr_b   (reg_wb), .wdata_b (reg_db),
    .dbg_we    (1'b0), .dbg_idx (8'h00), .dbg_wdata (16'h0000),
    .dbg_in_shadow (1'b0), .dbg_rdata (rf_dbg_rdata_unused)
  );

  // ------------------------------------------------------------- FSM
  logic [2:0] fsm;
  localparam logic [2:0] F_FETCH = 3'd0, F_ID = 3'd1, F_EXEC = 3'd2,
                         F_LOAD = 3'd3, F_STORE = 3'd4, F_HALT = 3'd5;

  always_ff @(posedge clk) begin
    if (rst) begin
      ctx        <= CTX_RESET;
      ex         <= '0;
      fsm        <= F_FETCH;
      run        <= 1'b0;
      halt_sticky<= 1'b0;
      if_cs_q    <= 16'h0000;
      if_pc_q    <= 16'hFFFF;
      cycle_count<= 32'd0;
      instr_count<= 32'd0;
      o_done     <= 1'b0;
      o_result   <= 1'b1;
      last_event_code <= 16'h0000;
      last_event_spc  <= 16'h0000;
      last_event_scs  <= 16'h0000;
      recent_addr     <= 21'd0;
      recent_base     <= 16'h0000;
      recent_seg_val  <= 16'h0000;
      recent_offset   <= 5'd0;
      recent_seg_idx  <= 2'd1;
      recent_is_store <= 1'b0;
      ex.valid <= 1'b0;
    end else begin
      o_done   <= 1'b0;
      if (run) cycle_count <= cycle_count + 32'd1;

      // The fetch tags hold while a serial transaction is in flight.
      if (!mem_stall) begin
        if_cs_q <= if_cs;
        if_pc_q <= if_pc;
      end

      // ---- step handshake --------------------------------------------
      if (!run) begin
        if (i_step) begin
          run         <= 1'b1;
          halt_sticky <= 1'b0;
        end
      end else if (commit && !i_free) begin
        run <= 1'b0;
      end

      // ---- commit -----------------------------------------------------
      if (run && commit && ill_double) begin
        // The ILL trap fired while already in the handler: double fault.
        // Treat it as a processor reset (spec 4.7).
        ctx         <= CTX_RESET;
        fsm         <= F_FETCH;
        run         <= 1'b0;
        halt_sticky <= 1'b1;
        o_result    <= 1'b0;
        ex.valid    <= 1'b0;
        o_done      <= 1'b1;
      end else if (run && commit) begin
`ifdef D16CORE3_DBG
        $display("COMMIT pc=%04x instr=%04x -> pc=%04x cs=%04x psw=%04x we=%d wa=%x wd=%04x st=%d sa=%05x sd=%04x",
                 ex.pc0, ex.instr, ctx_next.pc, ctx_next.cs, ctx_next.psw,
                 reg_we_a, reg_wa, wb_data_a, mem_we_ex, mem_addr_ex, mem_wdata_ex);
`endif
        ctx <= ctx_next;
        // A load into R15 writes the PC; a delay-slot apply already won.
        if (mem_rd_valid_ex && mem_is_load_ex && (load_rd_ex == 4'd15) &&
            !appl_pc_ex)
          ctx.pc <= mem_rdata;
        // The SWI vector word arrives on the data port; the handler PSW is
        // already in ctx_next, so this lands in the shadow PC.
        if (is_swi_ex && !appl_spc_ex)
          ctx.spc <= mem_rdata;

        instr_count <= instr_count + 32'd1;
        o_done      <= 1'b1;
        o_result    <= 1'b1;
        ex.valid <= 1'b0;

        if (evt_we_ex) begin
          last_event_code <= evt_code_ex;
          last_event_spc  <= is_swi_ex ? mem_rdata : evt_spc_ex;
          last_event_scs  <= evt_scs_ex;
        end
        if (rec_we_ex) begin
          recent_addr     <= rec_addr_ex;
          recent_base     <= rec_base_ex;
          recent_seg_val  <= rec_segval_ex;
          recent_offset   <= rec_off_ex;
          recent_seg_idx  <= rec_segid_ex;
          recent_is_store <= rec_store_ex;
        end
      end

      // ---- state machine ---------------------------------------------
      if (run) begin
        case (fsm)
          F_FETCH: if (if_hit) begin
`ifdef D16CORE3_DBG
            $display("FETCH cs=%04x pc=%04x word=%04x", if_cs, if_pc, if_rdata);
`endif
            if (if_halt_word) begin
              halt_sticky <= 1'b1;
              o_done      <= 1'b1;
              o_result    <= 1'b0;
              fsm         <= F_HALT;
            end else begin
              ex.instr     <= if_rdata;
              ex.pc0       <= if_pc;
              ex.act_cs    <= if_cs;
              ex.halt_word <= 1'b0;
              ex.valid     <= 1'b1;
              fsm          <= F_ID;
            end
          end
          F_ID: begin
            ex.ra1    <= id_rd.a1;
            ex.ra2    <= id_rd.a2;
            ex.ra3    <= id_rd.a3;
            ex.op1_n  <= rf1_n; ex.op1_s <= rf1_s;
            ex.op2_n  <= rf2_n; ex.op2_s <= rf2_s;
            ex.op3_n  <= rf3_n; ex.op3_s <= rf3_s;
            fsm       <= F_EXEC;
          end
          F_EXEC: begin
`ifdef D16CORE3_DBG
            if (mem_we_ex) $display("STORE issue addr=%05x data=%04x", mem_addr_ex, mem_wdata_ex);
`endif
            if (mem_rd_valid_ex)   fsm <= F_LOAD;
            else if (mem_we_ex)    fsm <= F_STORE;
            else                   fsm <= F_FETCH;
          end
          F_LOAD:  if (mem_valid) fsm <= F_FETCH;
          F_STORE: begin
`ifdef D16CORE3_DBG
            $display("STORE wait ack=%d stall=%d fsm=%0d exv=%d wex=%d we=%d", mem_store_ack, mem_stall, fsm, ex.valid, mem_we_ex, mem_we);
`endif
            if (mem_store_ack) fsm <= F_FETCH;
          end
          F_HALT: ;
          default: fsm <= F_FETCH;
        endcase
      end
    end
  end

  // The five-stage core's debug bus is not built on the board; the D16nano
  // core is board-only, so the scaffold is tied off.
  /* verilator lint_off UNUSEDSIGNAL */
  logic [15:0] rf_dbg_rdata_unused;
  /* verilator lint_on UNUSEDSIGNAL */
  assign dbg_rdata = 16'h0000;
endmodule
