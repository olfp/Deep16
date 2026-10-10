// Deep16 RTL - CPU core (phase 1: multi-cycle FSM, no pipeline).
//
// A literal port of step()/executeInstruction() from js/deep16_simulator.js,
// which wasm/deep16-wasm/src/lib.rs implements as well. One step() = one
// retired instruction: i_step pulses, the FSM walks FETCH -> EXEC and raises
// o_done. Delay slots, shadow banking, flag heuristics and the branch
// bookkeeping (including the nested-delay-slot quirk) are reproduced as they
// are in the behavioural cores - see doc/Deep16-RTL.md for the corners where
// the two cores disagree and which one the RTL follows.
//
// Debug bus (core state, see deep16_top for the full map):
//   0x00-0x0F normal regs   0x10 psw   0x11-0x14 cs/ds/ss/es
//   0x15-0x1A shadow psw/pc/cs/ds/ss/es       0x1B-0x20 shadow r0-r3,13,14
//   0x21 {running,dts,bt,da}  0x22 delayed_pc  0x23 delayed_cs
//   0x24-0x26 last event code/spc/scs         0x27-0x2C recent access
//   0x2D-0x2E cycle counter
module deep16_core
  import deep16_pkg::*;
(
  input  logic        clk,
  input  logic        rst,

  input  logic        i_step,
  output logic        o_done,
  output logic        o_result,
  output logic        o_busy,

  // memory port; phys() can exceed 20 bits, so the address is 21 bits wide
  output logic [20:0] mem_addr,
  input  logic [15:0] mem_rdata,
  output logic        mem_we,
  output logic [15:0] mem_wdata,
  output logic        kbd_pop,

  input  logic        kbd_ready,
  input  logic [15:0] kbd_head,
  input  logic [7:0]  kbd_count,

  input  logic        dbg_en,
  input  logic        dbg_we,
  input  logic [7:0]  dbg_idx,
  input  logic [15:0] dbg_wdata,
  output logic [15:0] dbg_rdata
);

  // ------------------------------------------------------------------ state
  logic [15:0] psw, cs, ds, ss, es;
  logic [15:0] s_psw, s_pc, s_cs, s_ds, s_ss, s_es;
  logic        running;
  logic        delay_active, branch_taken, delayed_to_shadow;
  logic [15:0] delayed_pc, delayed_cs;
  logic [15:0] last_event_code, last_event_spc, last_event_scs;
  logic [20:0] recent_addr;
  logic [15:0] recent_base, recent_seg_val;
  logic [4:0]  recent_offset;
  logic [1:0]  recent_seg_idx;
  logic        recent_is_store;
  logic [31:0] cycle_count;

  // ------------------------------------------------------------------- fsm
  // S_IDLE -> S_FETCH (address on the bus) -> S_INC (commit the PC
  // increment / decide halt) -> S_EXEC (write-back). The PC increment and the
  // halt decision need the fetched word, so they cannot share a cycle with
  // the address that produced it without a combinational loop.
  typedef enum logic [1:0] { S_IDLE, S_FETCH, S_INC, S_EXEC } fsm_t;
  fsm_t        state;
  logic        d_step;      // this step came through the delay-slot path
  logic [15:0] instr;
  logic [15:0] pc0;         // own address of the instruction being executed
  logic [15:0] pc_fetch;    // active PC latched when the fetch starts
  logic        halt_word;   // fetched word is a halt word (0xFFFF / 0xFFF1)
  logic [15:0] act_cs;      // active CS at fetch time

  // -------------------------------------------------------------- regfile
  logic [3:0]  ra1, ra2, ra3;
  logic [15:0] r1, r2, r3;
  logic [15:0] rn_rdata, rs_rdata;   // raw normal / shadow bank taps
  logic [3:0]  rn_addr, rs_addr;
  logic        rf_we_c, rf_we_a, rf_we_b, rf_sh_clear;
  logic        rf_da_from_mem;   // rf_da comes from the memory read data
  logic        spc_from_mem;      // spc_wd comes from the memory read data
  logic [3:0]  rf_wc, rf_wa, rf_wb;
  logic [15:0] rf_dc, rf_da, rf_db;
  logic        rf_dbg_we;
  logic [7:0]  rf_dbg_idx;
  logic [15:0] rf_dbg_rdata;

  // ------------------------------------------------------------------- ALU
  logic [15:0] alu_result, alu_rd1_val;
  logic        alu_rd_we, alu_rd1_we, alu_overflow;
  logic [31:0] alu_last32;
  logic [1:0]  alu_carry_mode;
  logic        alu_carry_bit;

  wire [4:0] alu_func5 = instr[12:8];
  wire [3:0] alu_rd    = instr[7:4];
  wire [3:0] alu_low4  = instr[3:0];

  deep16_alu u_alu (
    .func5     (alu_func5),
    .rdv       (r1),
    .opv       (r2),
    .rd1_in    (r3),
    .low4      (alu_low4),
    .rd        (alu_rd),
    .psw_in    (psw),
    .result    (alu_result),
    .rd_we     (alu_rd_we),
    .rd1_we    (alu_rd1_we),
    .rd1_val   (alu_rd1_val),
    .last32    (alu_last32),
    .overflow  (alu_overflow),
    .carry_mode(alu_carry_mode),
    .carry_bit (alu_carry_bit)
  );

  deep16_regfile u_regfile (
    .clk      (clk),
    .rst      (rst),
    .in_shadow(psw[FLG_S]),
    .raddr1   (ra1), .raddr2    (ra2), .raddr3    (ra3),
    .rdata1   (r1),  .rdata2    (r2),  .rdata3    (r3),
    .rn_addr  (rn_addr), .rs_addr(rs_addr),
    .rn_rdata (rn_rdata), .rs_rdata(rs_rdata),
    .we_c     (rf_we_c), .waddr_c (rf_wc), .wdata_c (rf_dc),
    .we_a     (rf_we_a), .waddr_a (rf_wa), .wdata_a (rf_da_mux),
    .we_b     (rf_we_b), .waddr_b (rf_wb), .wdata_b (rf_db),
    .sh_clear (rf_sh_clear),
    .dbg_we   (rf_dbg_we), .dbg_idx(rf_dbg_idx),
    .dbg_wdata(dbg_wdata), .dbg_rdata(rf_dbg_rdata)
  );

  // ------------------------------------------------------- decode/execute comb
  logic        flags_we;
  logic [31:0] last32;
  logic        ovf;
  logic [1:0]  carry_mode;
  logic        carry_bit;

  logic        psw_we;   logic [15:0] psw_wd;
  logic        seg_we;   logic [1:0] seg_sel;  logic [15:0] seg_wd;
  logic        sseg_we;  logic [1:0] sseg_sel; logic [15:0] sseg_wd;
  logic        sseg_zero_all;
  logic        spsw_we;  logic [15:0] spsw_wd;
  logic        spc_we;   logic [15:0] spc_wd;
  logic        scs_we;   logic [15:0] scs_wd;
  logic        appl_cs_we; logic [15:0] appl_cs_wd;   // branch apply -> normal CS

  logic        run_we;   logic run_wd;
  logic        dly_act_we, dly_pc_we, dly_cs_we, dly_bt_we, dly_tts_we;
  logic        dly_act_wd, dly_bt_wd, dly_tts_wd;
  logic [15:0] dly_pc_wd, dly_cs_wd;

  logic        evt_we;
  logic [15:0] evt_code_wd, evt_spc_wd, evt_scs_wd;

  logic        rec_we;
  logic [20:0] rec_addr_wd;
  logic [15:0] rec_base_wd, rec_segval_wd;
  logic [4:0]  rec_off_wd;
  logic [1:0]  rec_segid_wd;
  logic        rec_store_wd;

  logic        is_branch;
  logic        result_comb;

  // bank muxes
  logic [15:0] act_cs_q, act_ds, act_ss, act_es;
  logic [15:0] inact_cs, inact_ds, inact_ss, inact_es;
  logic [15:0] inact_gpr;

  // memory port handshake (mem_addr is driven by its own block below so
  // the read data cannot fold back into the address - no comb loop)
  logic        mem_pa_valid;
  logic [20:0] mem_pa;

  // fetch
  logic [15:0] pc_cur;
  logic [20:0] pa_f;
  logic        halt_f;

  // decode class: 0 none, 1 sys, 2 ldi, 3 ld/st, 4 alu, 5 extended
  logic [2:0]  cls;
  logic [3:0]  ext_id;
  logic [2:0]  sysop;

  // per-instruction temporaries
  logic [15:0] imm_val, mov_src;
  logic [3:0]  f_rd, f_rs, f_rx;
  logic [1:0]  f_seg;
  logic [15:0] off_s, seg_val, base_val;
  logic [20:0] pa_m;
  logic        in_range, seg_is_stack, seg_is_extra;
  logic        bt_next;
  logic [15:0] dpc_next, dcs_next;
  logic        tts_next, run_next;

  // SMV inactive-bank register index
  logic [3:0] smv_idx;

  assign act_cs_q = psw[FLG_S] ? s_cs : cs;
  assign act_ds   = psw[FLG_S] ? s_ds : ds;
  assign act_ss   = psw[FLG_S] ? s_ss : ss;
  assign act_es   = psw[FLG_S] ? s_es : es;
  assign inact_cs = psw[FLG_S] ? cs : s_cs;
  assign inact_ds = psw[FLG_S] ? ds : s_ds;
  assign inact_ss = psw[FLG_S] ? ss : s_ss;
  assign inact_es = psw[FLG_S] ? es : s_es;
  assign inact_gpr = psw[FLG_S] ? rn_rdata : rs_rdata;

  assign rn_addr = smv_idx;
  assign rs_addr = smv_idx;

  // ---- LD/ST operand decode ------------------------------------------------
  // Sign-extended imm5 offset and the PSW-driven segment class (spec 3.10:
  // PSW[9:6] selects a stack register, PSW[14:11] an extra-segment register).
  wire [15:0] off_s_f = {{11{instr[4]}}, instr[4:0]};
  wire sel_stack = (psw[9:6] != 4'd0) &&
                   ((psw[9:6] == instr[8:5]) ||
                    (psw[10] && (({1'b0, psw[9:6]} + 5'd1) == {1'b0, instr[8:5]})));
  wire sel_extra = (psw[14:11] != 4'd0) &&
                   ((psw[14:11] == instr[8:5]) ||
                    (psw[15] && (({1'b0, psw[14:11]} + 5'd1) == {1'b0, instr[8:5]})));

  // ---- memory read data ----------------------------------------------------
  // Selected outside the execute block so the memory data never enters the
  // block that computes the memory address.
  wire [15:0] rf_da_mux = rf_da_from_mem ? mem_rdata : rf_da;
  wire [15:0] spc_wd_mux = spc_from_mem ? mem_rdata : spc_wd;

  // ---- fetch address ------------------------------------------------------
  // Kept out of the execute block: nothing that drives the memory address may
  // depend on the memory read data, or the two become a combinational loop.
  assign pc_cur = pc_fetch;                        // latched when the step starts
  assign pa_f   = {act_cs_q, 4'h0} + {5'b00000, pc_fetch};

  // ---- halt condition of a fetch cycle ------------------------------------
  // Both cores stop on an out-of-range fetch and on 0xFFFF (spec Table 5: the
  // only HLT encoding). 0xFFF1 is FSH and stays a no-op - the boot ROM uses it
  // as filler. The word test needs the memory read data, so it is registered
  // into halt_word during the fetch.
  always_comb begin
    halt_f = (pa_f >= 21'(MEM_WORDS));
  end

  // ---- last event of a normal fetch (the IDE's event log) -----------------
  always_comb begin
    evt_we     = 1'b0;
    evt_code_wd = 16'h0000;
    evt_spc_wd = 16'h0000;
    evt_scs_wd = 16'h0000;
    if (state == S_FETCH && !d_step) begin        // every normal fetch
      evt_we = 1'b1;
      evt_code_wd = mem_rdata;
      evt_spc_wd = pc_cur;
      evt_scs_wd = act_cs_q;
    end else if (state == S_EXEC && cls == 3'd1) begin
      if (sysop == 3'd2) begin                    // SWI reports the new shadow PC
        evt_we = 1'b1; evt_code_wd = 16'd2;
        evt_spc_wd = mem_rdata; evt_scs_wd = 16'h0000;
      end else if (sysop == 3'd3) begin           // RETI
        evt_we = 1'b1; evt_code_wd = 16'd3;
      end
    end
  end

  // Memory address mux. Kept apart from the execute block so the memory read
  // data never folds back into the address (combinational loop).
  assign mem_addr = (state == S_FETCH) ? pa_f :
                    ((state == S_EXEC && mem_pa_valid) ? mem_pa : 21'd0);

  always_comb begin
    // ---- defaults -------------------------------------------------------
    rf_we_c = 1'b0; rf_wc = 4'd0; rf_dc = 16'h0000;
    rf_da_from_mem = 1'b0;
    rf_we_a = 1'b0; rf_wa = 4'd0; rf_da = 16'h0000;
    rf_we_b = 1'b0; rf_wb = 4'd0; rf_db = 16'h0000;
    rf_sh_clear = 1'b0;

    mem_pa_valid = 1'b0;
    mem_pa = 21'd0;
    mem_we   = 1'b0; mem_wdata = 16'h0000;
    kbd_pop  = 1'b0;

    flags_we = 1'b0; last32 = 32'h00000000; ovf = 1'b0;
    carry_mode = CARRY_HEURISTIC; carry_bit = 1'b0;

    psw_we = 1'b0; psw_wd = 16'h0000;
    seg_we = 1'b0; seg_sel = 2'd0; seg_wd = 16'h0000;
    sseg_we = 1'b0; sseg_sel = 2'd0; sseg_wd = 16'h0000;
    sseg_zero_all = 1'b0;
    spsw_we = 1'b0; spsw_wd = 16'h0000;
    spc_we = 1'b0; spc_wd = 16'h0000; spc_from_mem = 1'b0;
    scs_we = 1'b0; scs_wd = 16'h0000;
    appl_cs_we = 1'b0; appl_cs_wd = 16'h0000;

    run_we = 1'b0; run_wd = 1'b0;
    dly_act_we = 1'b0; dly_pc_we = 1'b0; dly_cs_we = 1'b0;
    dly_bt_we = 1'b0; dly_tts_we = 1'b0;
    dly_act_wd = 1'b0; dly_bt_wd = 1'b0; dly_tts_wd = 1'b0;
    dly_pc_wd = 16'h0000; dly_cs_wd = 16'h0000;


    rec_we = 1'b0; rec_addr_wd = 21'd0; rec_base_wd = 16'h0000;
    rec_segval_wd = 16'h0000; rec_off_wd = 5'd0; rec_segid_wd = 2'd1;
    rec_store_wd = 1'b0;

    is_branch = 1'b0;

    // ---- instruction fields --------------------------------------------
    sysop   = instr[2:0];
    imm_val = 16'h0000;
    f_rd = 4'd0; f_rs = 4'd0; f_rx = 4'd0; f_seg = 2'd0;
    off_s = 16'h0000; seg_val = 16'h0000;
    base_val = 16'h0000; pa_m = 21'd0; in_range = 1'b0;
    seg_is_stack = 1'b0; seg_is_extra = 1'b0;
    mov_src = 16'h0000;


    // ---- fetch cycle ----------------------------------------------------

    // ---- PC increment commit ---------------------------------------------
    // PC is advanced before execution so a PC read inside the instruction
    // observes own address + 1 (spec 3.3 / 6.2.2). A halting fetch never gets
    // here, so it leaves the PC where it is.
    if (state == S_INC && !halt_word) begin
      if (psw[FLG_S]) begin
        spc_we = 1'b1; spc_wd = pc_cur + 16'd1;
      end else begin
        rf_we_c = 1'b1; rf_wc = 4'd15; rf_dc = pc_cur + 16'd1;
      end
    end

    // ---- execute cycle --------------------------------------------------
    if (state == S_EXEC) begin
      case (cls)
        3'd1: begin                                             // SYS prefix
          case (sysop)
            3'd0: ;                                             // NOP
            3'd1: ;                                             // FSH: no-op
            3'd2: begin                                         // SWI
              spsw_we = 1'b1; spsw_wd = psw;
              psw_we  = 1'b1; psw_wd  = 16'h0001 << FLG_S;   // handler PSW: S=1, rest clear
              sseg_zero_all = 1'b1;                            // sCS/sDS/sSS/sES
              rf_sh_clear = 1'b1;
              mem_pa = 21'd2; mem_pa_valid = 1'b1;             // vector word
              spc_we = 1'b1; spc_from_mem = 1'b1;
            end
            3'd3: begin                                         // RETI
              if (psw[FLG_S]) begin
                psw_we = 1'b1; psw_wd = s_psw;
                spsw_we = 1'b1; spsw_wd = 16'h0000;
              end else begin
                psw_we = 1'b1; psw_wd = psw & ~(16'h0001 << FLG_S);
              end
            end
            3'd4: begin psw_we = 1'b1; psw_wd = psw |  (16'h0001 << FLG_I); end   // SETI
            3'd5: begin psw_we = 1'b1; psw_wd = psw & ~(16'h0001 << FLG_I); end   // CLRI
            default: ;
          endcase
        end

        3'd2: begin                                             // LDI
          imm_val = {instr[14], instr[14:0]};
          rf_we_a = 1'b1; rf_wa = 4'd0; rf_da = imm_val;
          flags_we = 1'b1; last32 = {16'h0000, imm_val};
        end

        3'd3: begin                                             // LD / ST
          f_rd = instr[12:9];
          seg_is_stack = sel_stack;
          seg_is_extra = sel_extra;
          if      (seg_is_stack) seg_val = act_ss;
          else if (seg_is_extra) seg_val = act_es;
          else                   seg_val = act_ds;
          base_val = r1;
          pa_m = {seg_val, 4'h0} + {5'b00000, (base_val + off_s_f)};
          mem_pa = pa_m; mem_pa_valid = 1'b1;
          in_range = (pa_m < 21'(MEM_WORDS));
          if (in_range) begin
            if (!instr[13]) begin                               // LD
              rf_we_a = 1'b1; rf_wa = f_rd; rf_da_from_mem = 1'b1;
            end else begin                                      // ST
              mem_we = 1'b1; mem_wdata = r3;
            end
          end
          // The recent-access record is updated even for an out-of-range
          // access, like the JS core (the WASM core drops those).
          rec_we = 1'b1;
          rec_addr_wd  = pa_m;
          rec_base_wd  = base_val;
          rec_off_wd   = instr[4:0];
          rec_segval_wd = seg_val;
          rec_segid_wd = seg_is_stack ? 2'd2 : (seg_is_extra ? 2'd3 : 2'd1);
          rec_store_wd = instr[13];
        end

        3'd4: begin                                             // ALU
          rf_we_a = alu_rd_we;  rf_wa = alu_rd; rf_da = alu_result;
          rf_we_b = alu_rd1_we; rf_wb = alu_rd + 4'd1; rf_db = alu_rd1_val;
          flags_we   = 1'b1;
          last32     = alu_last32;
          ovf        = alu_overflow;
          carry_mode = alu_carry_mode;
          carry_bit  = alu_carry_bit;
        end

        3'd5: begin
          case (ext_id)
            4'd0: begin                                         // Jcc
              off_s = {{7{instr[8]}}, instr[8:0]};
              case (instr[11:9])
                3'd0:    bt_next = psw[FLG_Z];
                3'd1:    bt_next = !psw[FLG_Z];
                3'd2:    bt_next = psw[FLG_C];
                3'd3:    bt_next = !psw[FLG_C];
                3'd4:    bt_next = psw[FLG_N];
                3'd5:    bt_next = !psw[FLG_N];
                3'd6:    bt_next = psw[FLG_V];
                default: bt_next = !psw[FLG_V];
              endcase
              dly_bt_we = 1'b1; dly_bt_wd = bt_next;
              if (bt_next) begin
                dly_act_we = 1'b1; dly_act_wd = 1'b1;
                dly_pc_we  = 1'b1; dly_pc_wd  = pc0 + 16'd1 + off_s;
                dly_cs_we  = 1'b1; dly_cs_wd  = act_cs;
                dly_tts_we = 1'b1; dly_tts_wd = psw[FLG_S];
                is_branch  = 1'b1;
              end
            end

            4'd1: begin                                         // LDS / STS
              f_rd   = instr[7:4];
              f_rs   = instr[3:0];
              f_seg  = instr[9:8];
              seg_val = (f_seg == 2'd0) ? act_cs_q :
                        (f_seg == 2'd1) ? act_ds   :
                        (f_seg == 2'd2) ? act_ss   : act_es;
              pa_m = {seg_val, 4'h0} + {5'b00000, r1};
              mem_pa = pa_m; mem_pa_valid = 1'b1;
              in_range = (pa_m < 21'(MEM_WORDS));
              rec_we = 1'b1;
              rec_addr_wd = pa_m; rec_base_wd = r1; rec_off_wd = 5'd0;
              rec_segval_wd = seg_val; rec_segid_wd = f_seg;
              rec_store_wd = instr[10];
              if (in_range) begin
                if (!instr[10]) begin                           // LDS
                  rf_we_a = 1'b1; rf_wa = f_rd;
                  if (pa_m == KBD_STATUS_ADDR) begin
                    rf_da = kbd_ready ? 16'd1 : 16'd0;
                  end else if (pa_m == KBD_DATA_ADDR) begin
                    rf_da = kbd_ready ? kbd_head : 16'd0;
                    kbd_pop = kbd_ready;
                  end else begin
                    rf_da_from_mem = 1'b1;
                  end
                end else begin                                  // STS
                  mem_we = 1'b1; mem_wdata = r3;
                end
              end
            end

            4'd2: begin                                         // MOV Rd, Rs, imm2
              f_rd    = instr[9:6];
              f_rs    = instr[5:2];
              mov_src = (f_rs == 4'd15) ? (pc0 + 16'd1) : r1;
              case (instr[1:0])
                2'd0:    imm_val = mov_src;
                2'd1:    imm_val = mov_src << 1;
                2'd2:    imm_val = mov_src + 16'd2;
                default: imm_val = (mov_src << 1) | 16'd1;
              endcase
              if (f_rd == 4'd15) begin                           // MOV to PC
                dly_act_we = 1'b1; dly_act_wd = 1'b1;
                dly_pc_we  = 1'b1; dly_pc_wd  = imm_val;
                dly_cs_we  = 1'b1; dly_cs_wd  = act_cs;
                dly_tts_we = 1'b1; dly_tts_wd = psw[FLG_S];
                dly_bt_we  = 1'b1; dly_bt_wd  = 1'b1;
                is_branch  = 1'b1;
              end else begin
                rf_we_a = 1'b1; rf_wa = f_rd; rf_da = imm_val;
              end
              flags_we = 1'b1; last32 = {16'h0000, imm_val};
            end

            4'd3: begin                                         // LSI Rd, imm5
              f_rd    = instr[8:5];
              imm_val = {{11{instr[4]}}, instr[4:0]};
              rf_we_a = 1'b1; rf_wa = f_rd; rf_da = imm_val;
              flags_we = 1'b1; last32 = {16'h0000, imm_val};
            end

            4'd4: begin                                         // SMV Rd, <alt>
              f_rx = instr[7:4];
              rf_we_a = 1'b1; rf_wa = f_rx;
              case (instr[3:0])
                4'h0: rf_da = inact_cs;
                4'h1: rf_da = inact_ds;
                4'h2: rf_da = inact_ss;
                4'h3: rf_da = inact_es;
                4'h4: rf_da = s_psw;                            // APSW
                4'h8, 4'h9, 4'hA, 4'hB, 4'hD, 4'hE: rf_da = inact_gpr;
                4'hF: rf_da = pc0 + 16'd1;                      // APC
                default: rf_we_a = 1'b0;
              endcase
            end

            4'd5: begin                                         // MVS
              f_rd = instr[5:2];
              if (!instr[6]) begin                               // MVS Rd, SEG
                rf_we_a = 1'b1; rf_wa = f_rd;
                rf_da = (instr[1:0] == 2'd0) ? act_cs_q :
                       (instr[1:0] == 2'd1) ? act_ds   :
                       (instr[1:0] == 2'd2) ? act_ss   : act_es;
              end else begin                                     // MVS SEG, Rd
                if (psw[FLG_S]) begin
                  sseg_we = 1'b1; sseg_sel = instr[1:0]; sseg_wd = r1;
                end else begin
                  seg_we = 1'b1; seg_sel = instr[1:0]; seg_wd = r1;
                end
              end
            end

            4'd6: begin                                         // SOP
              f_rx = instr[3:0];
              case (instr[5:4])
                2'd0: begin                                     // INV Rx
                  rf_we_a = 1'b1; rf_wa = f_rx; rf_da = ~r1;
                  flags_we = 1'b1; last32 = {16'h0000, ~r1};
                end
                2'd1: begin                                     // NEG Rx
                  rf_we_a = 1'b1; rf_wa = f_rx; rf_da = ~r1 + 16'd1;
                  flags_we = 1'b1; last32 = {16'h0000, (~r1 + 16'd1)};
                end
                2'd2: begin psw_we = 1'b1; psw_wd = r1; end       // SPSW Rx
                default: begin                                  // LPSW Rx
                  rf_we_a = 1'b1; rf_wa = f_rx; rf_da = psw;
                end
              endcase
            end

            4'd7: begin                                         // SET/CLR PSW
              if (instr[3:0] != 4'd4) begin                     // imm4=4 ignored
                if (!instr[4]) begin
                  psw_we = 1'b1; psw_wd = psw |  (16'h0001 << instr[3:0]);
                end else begin
                  psw_we = 1'b1; psw_wd = psw & ~(16'h0001 << instr[3:0]);
                end
              end
            end

            4'd8: begin                                         // JML Rx
              f_rx = instr[3:0];
              if (!f_rx[0]) begin                                // even Rx only
                dly_act_we = 1'b1; dly_act_wd = 1'b1;
                dly_pc_we  = 1'b1; dly_pc_wd  = r2;              // PC = R[Rx+1]
                dly_cs_we  = 1'b1; dly_cs_wd  = r1;              // CS = R[Rx]
                dly_tts_we = 1'b1; dly_tts_wd = psw[FLG_S];
                dly_bt_we  = 1'b1; dly_bt_wd  = 1'b1;
                is_branch  = 1'b1;
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
    end

    // ---- branch apply: delay-slot path, after the instruction ----------
    bt_next  = dly_bt_we  ? dly_bt_wd  : branch_taken;
    dpc_next = dly_pc_we  ? dly_pc_wd  : delayed_pc;
    dcs_next = dly_cs_we  ? dly_cs_wd  : delayed_cs;
    tts_next = dly_tts_we ? dly_tts_wd : delayed_to_shadow;
    run_next = run_we     ? run_wd     : running;
    if (state == S_EXEC && d_step && bt_next) begin
      if (tts_next) begin
        // the apply runs after the instruction, so it wins over a SWI vector
        spc_we = 1'b1; spc_wd = dpc_next; spc_from_mem = 1'b0;
        scs_we = 1'b1; scs_wd = dcs_next;
      end else begin
        rf_we_c    = 1'b1; rf_wc = 4'd15; rf_dc = dpc_next;
        appl_cs_we = 1'b1; appl_cs_wd = dcs_next;
      end
    end

    // step() returns !is_branch || running (both cores)
    result_comb = !is_branch || run_next;
  end

  // ---- instruction class decode (pure: only state and instr) --------------
  always_comb begin
    cls = 3'd0;
    ext_id = 4'd10;
    if (state == S_EXEC) begin
      // SYS prefix is 13 bits: 0xFFF0..0xFFF7. Words 0xFFF8..0xFFFF are
      // reserved and decode to nothing, exactly like the JS core's chain.
      if (instr[15:3] == 13'h1FFE)                 cls = 3'd1;   // SYS prefix
      else if (!instr[15])                         cls = 3'd2;   // LDI
      else if (instr[15:14] == 2'b10)              cls = 3'd3;   // LD/ST
      else begin
        case (instr[15:13])
          3'b110: cls = 3'd4;                                     // ALU
          3'b111: begin                                            // extended
            cls = 3'd5;
            // ordered exactly like the cores' extended chain
            if      (instr[15:12] == 4'b1110)       ext_id = 4'd0;  // Jcc
            else if (instr[15:11] == 5'b11110)      ext_id = 4'd1;  // LDS/STS
            else if (instr[15:10] == 6'b111110)     ext_id = 4'd2;  // MOV
            else if (instr[15:9]  == 7'b1111110)    ext_id = 4'd3;  // LSI
            else if (instr[15:8]  == 8'b11111110)   ext_id = 4'd4;  // SMV
            else if (instr[15:7]  == 9'b111111110)  ext_id = 4'd5;  // MVS
            else if (instr[15:6]  == 10'b1111111110) ext_id = 4'd6; // SOP
            else if (instr[15:5]  == 11'b11111111110) ext_id = 4'd7; // SET/CLR
            else if (instr[15:4]  == 12'b111111111110) ext_id = 4'd8; // JML
            else if (instr[15:3]  == 13'b1111111111110) ext_id = 4'd9; // SYS
            else                                   ext_id = 4'd10; // reserved
          end
          default: cls = 3'd0;
        endcase
      end
    end
  end

  // ---- register read addresses (also pure: no register data needed) ------
  always_comb begin
    ra1 = 4'd0;
    ra2 = 4'd0;
    ra3 = 4'd0;
    if (state == S_IDLE || state == S_FETCH) begin
      ra1 = 4'd15;                                // active PC lives in R15
    end else if (state == S_EXEC) begin
      case (cls)
        3'd3: begin                                // LD/ST: base + ST source
          ra1 = instr[8:5];
          ra3 = instr[12:9];
        end
        3'd4: begin                                // ALU: Rd, Rs, Rd+1
          ra1 = instr[7:4];
          ra2 = instr[3:0];
          ra3 = instr[7:4] + 4'd1;
        end
        3'd5: begin                                // extended group
          case (ext_id)
            4'd1: begin                            // LDS/STS
              ra1 = instr[3:0];
              ra3 = instr[7:4];
            end
            4'd2: ra1 = instr[5:2];                // MOV
            4'd3: ra1 = instr[8:5];                // LSI
            4'd4: ra1 = instr[7:4];                // SMV
            4'd5: ra1 = instr[5:2];                // MVS
            4'd6: ra1 = instr[3:0];                // SOP
            4'd8: begin                            // JML
              ra1 = instr[3:0];
              ra2 = instr[3:0] + 4'd1;
            end
            default: ;
          endcase
        end
        default: ;
      endcase
    end
  end

  // SMV reads the inactive bank's GPRs; its register index is pure decode.
  always_comb begin
    smv_idx = 4'd0;
    case (instr[3:0])
      4'h9: smv_idx = 4'd1;
      4'hA: smv_idx = 4'd2;
      4'hB: smv_idx = 4'd3;
      4'hD: smv_idx = 4'd13;
      4'hE: smv_idx = 4'd14;
      default: smv_idx = 4'd0;
    endcase
  end

  assign o_busy = (state != S_IDLE);

  // ------------------------------------------------------------------- FSM
  always_ff @(posedge clk) begin
    cycle_count <= cycle_count + 32'd1;
    o_done   <= 1'b0;
    o_result <= 1'b1;

    if (rst) begin
      state            <= S_IDLE;
      d_step           <= 1'b0;
      instr            <= 16'h0000;
      pc0              <= 16'h0000;
      act_cs           <= 16'hFFFF;
      running          <= 1'b0;
      delay_active     <= 1'b0;
      branch_taken     <= 1'b0;
      delayed_to_shadow<= 1'b0;
      delayed_pc       <= 16'h0000;
      delayed_cs       <= 16'h0000;
      psw   <= 16'h0000;
      cs    <= 16'hFFFF;
      ds    <= 16'h0000;
      ss    <= 16'h0000;
      es    <= 16'h0000;
      s_psw <= 16'h0000;
      s_pc  <= 16'h0000;
      s_cs  <= 16'h0000;
      s_ds  <= 16'h0000;
      s_ss  <= 16'h0000;
      s_es  <= 16'h0000;
      last_event_code <= 16'h0000;
      last_event_spc <= 16'h0000;
      last_event_scs <= 16'h0000;
      recent_addr     <= 21'd0;
      recent_base     <= 16'h0000;
      recent_seg_val  <= 16'h0000;
      recent_offset   <= 5'd0;
      recent_seg_idx  <= 2'd1;
      recent_is_store <= 1'b0;
      cycle_count     <= 32'd0;
    end else begin
      case (state)
        S_IDLE: begin
          if (i_step) begin
            running <= 1'b1;            // the cores re-arm a halted CPU
            d_step  <= delay_active;
            // latch the active PC now: during FETCH the only writer of the
            // program counter is this increment plus a possible branch
            pc_fetch <= psw[FLG_S] ? s_pc : r1;
            state   <= S_FETCH;
          end
        end

        S_FETCH: begin
          if (halt_f) begin
            running  <= 1'b0;
            o_done   <= 1'b1;
            o_result <= 1'b0;
            state    <= S_IDLE;
          end else begin
            instr  <= mem_rdata;
            pc0    <= pc_cur;
            act_cs <= act_cs_q;
            halt_word <= (!d_step) && (mem_rdata == 16'hFFFF);
            state  <= S_INC;
          end
        end

        S_INC: begin
          if (halt_word) begin
            running  <= 1'b0;
            o_done   <= 1'b1;
            o_result <= 1'b0;
            state    <= S_IDLE;
          end else begin
            if (d_step) delay_active <= 1'b0;
            state <= S_EXEC;
          end
        end

        S_EXEC: begin
          o_done   <= 1'b1;
          o_result <= result_comb;
          state    <= S_IDLE;
        end

        default: state <= S_IDLE;
      endcase

      // ---- write-back ------------------------------------------------------
      // Runs in S_INC (PC increment) and S_EXEC (instruction effects). Every
      // write-enable below is driven by the execute block, which only asserts
      // them in the matching state, so this is safe for both.
      if (state == S_INC || state == S_EXEC) begin
          if (run_we) running <= run_wd;
          if (psw_we)  psw <= psw_wd;
          else if (flags_we) psw <= apply_nzvc(psw, last32, ovf, carry_mode, carry_bit);

          if (seg_we) begin
            case (seg_sel)
              2'd0: cs <= seg_wd;
              2'd1: ds <= seg_wd;
              2'd2: ss <= seg_wd;
              default: es <= seg_wd;
            endcase
          end
          if (appl_cs_we) cs <= appl_cs_wd;      // branch apply wins over MVS

          if (sseg_zero_all) begin
            s_cs <= 16'h0000; s_ds <= 16'h0000; s_ss <= 16'h0000; s_es <= 16'h0000;
          end
          if (sseg_we) begin
            case (sseg_sel)
              2'd0: s_cs <= sseg_wd;
              2'd1: s_ds <= sseg_wd;
              2'd2: s_ss <= sseg_wd;
              default: s_es <= sseg_wd;
            endcase
          end
          if (spsw_we) s_psw <= spsw_wd;
          // spc_wd already holds the winning value (branch apply beats the
          // SWI vector, in that order, exactly as the cores do it)
          if (spc_we) s_pc <= spc_wd_mux;
          if (scs_we) s_cs <= scs_wd;

          if (dly_act_we) delay_active <= dly_act_wd;
          if (dly_pc_we)  delayed_pc <= dly_pc_wd;
          if (dly_cs_we)  delayed_cs <= dly_cs_wd;
          if (dly_bt_we)  branch_taken <= dly_bt_wd;
          if (dly_tts_we) delayed_to_shadow <= dly_tts_wd;

          if (evt_we) begin
            last_event_code <= evt_code_wd;
            last_event_spc <= evt_spc_wd;
            last_event_scs <= evt_scs_wd;
          end
          if (rec_we) begin
            recent_addr     <= rec_addr_wd;
            recent_base     <= rec_base_wd;
            recent_seg_val  <= rec_segval_wd;
            recent_offset   <= rec_off_wd;
            recent_seg_idx  <= rec_segid_wd;
            recent_is_store <= rec_store_wd;
          end
      end

      // ---- debug writes (harness state seeding, CPU idle only) --------
      if (dbg_en && dbg_we && state == S_IDLE) begin
        case (dbg_idx)
          8'h10: psw    <= dbg_wdata;
          8'h11: cs     <= dbg_wdata;
          8'h12: ds     <= dbg_wdata;
          8'h13: ss     <= dbg_wdata;
          8'h14: es     <= dbg_wdata;
          8'h15: s_psw  <= dbg_wdata;
          8'h16: s_pc   <= dbg_wdata;
          8'h17: s_cs   <= dbg_wdata;
          8'h18: s_ds   <= dbg_wdata;
          8'h19: s_ss   <= dbg_wdata;
          8'h1A: s_es   <= dbg_wdata;
          8'h21: begin
            running           <= dbg_wdata[3];
            delayed_to_shadow <= dbg_wdata[2];
            branch_taken      <= dbg_wdata[1];
            delay_active      <= dbg_wdata[0];
          end
          8'h22: delayed_pc <= dbg_wdata;
          8'h23: delayed_cs <= dbg_wdata;
          8'h24: last_event_code <= dbg_wdata;
          8'h25: last_event_spc <= dbg_wdata;
          8'h26: last_event_scs <= dbg_wdata;
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
      end
    end
  end

  // ------------------------------------------------------------- debug reads
  assign rf_dbg_we = dbg_en && dbg_we &&
                   ((dbg_idx[7:4] == 4'h0) ||
                    (dbg_idx[7:4] == 4'h1 && dbg_idx[3:0] >= 4'hB));
  assign rf_dbg_idx = dbg_idx;

  always_comb begin
    // 0x00-0x0F normal regs, 0x1B-0x20 shadow regs, 0x30-0x3F active view
    if ((dbg_idx[7:4] == 4'h0) ||
        (dbg_idx[7:4] == 4'h1 && dbg_idx[3:0] >= 4'hB) ||
        (dbg_idx[7:4] == 4'h3)) begin
      dbg_rdata = rf_dbg_rdata;
    end else if (dbg_idx >= 8'hC0 && dbg_idx <= 8'hCF) begin
      // boot ROM window: the harness re-plants it without a second copy
      dbg_rdata = boot_rom_word({28'h0, dbg_idx[3:0]});
    end else begin
      case (dbg_idx)
        8'h10: dbg_rdata = psw;
        8'h11: dbg_rdata = cs;
        8'h12: dbg_rdata = ds;
        8'h13: dbg_rdata = ss;
        8'h14: dbg_rdata = es;
        8'h15: dbg_rdata = s_psw;
        8'h16: dbg_rdata = s_pc;
        8'h17: dbg_rdata = s_cs;
        8'h18: dbg_rdata = s_ds;
        8'h19: dbg_rdata = s_ss;
        8'h1A: dbg_rdata = s_es;
        8'h21: dbg_rdata = {12'h000, running, delayed_to_shadow, branch_taken, delay_active};
        8'h22: dbg_rdata = delayed_pc;
        8'h23: dbg_rdata = delayed_cs;
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
        8'h2F: dbg_rdata = instr;                  // instruction being executed
        8'h50: dbg_rdata = {14'h0, state};        // FSM state (debug aid)
        8'h51: dbg_rdata = {10'h0, halt_word, d_step, running, delayed_to_shadow, branch_taken, delay_active};
        8'h52: dbg_rdata = pc_fetch;                  // active PC latched for the fetch
        8'h53: dbg_rdata = {8'h00, kbd_count};        // keyboard FIFO depth
        8'h3F: dbg_rdata = pa_f[15:0];             // last fetch address (low)
        8'h4F: dbg_rdata = {11'h000, pa_f[20:16]}; // last fetch address (high)
        default: dbg_rdata = 16'h0000;
      endcase
    end
  end

endmodule
