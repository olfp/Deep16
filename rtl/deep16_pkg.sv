// Deep16 RTL - shared constants, pipeline state bundle and PSW helpers.
//
// Golden reference for all behaviour is the pair of behavioural cores
// (js/deep16_simulator.js + wasm/deep16-wasm/src/lib.rs), not the spec text.
// Known spec-vs-core divergences are documented in doc/Deep16-RTL.md; where
// the two cores themselves disagree the JS core wins (it is the spec-faithful
// one: sign-extended LD/ST offsets, 0xFFF1 as a no-op).
package deep16_pkg;

  localparam int MEM_WORDS     = 1048576;          // 2^20 words of 16 bit
  localparam logic [19:0] ROM_BASE = 20'hFFFF0;        // boot ROM at physical FFFF0
  localparam int ROM_WORDS     = 16;

  localparam logic [20:0] KBD_STATUS_ADDR = 21'h0F0060;
  localparam logic [20:0] KBD_DATA_ADDR   = 21'h0F0062;

  // PSW bit positions (doc/Deep16-Arch.md 2.4)
  localparam int FLG_N = 0;
  localparam int FLG_Z = 1;
  localparam int FLG_V = 2;
  localparam int FLG_C = 3;
  localparam int FLG_I = 4;
  localparam int FLG_S = 5;

  // Carry mode selector for apply_nzvc()
  localparam logic [1:0] CARRY_HEURISTIC = 2'b00;  // |last32[31:16]  (>0xFFFF or <0)
  localparam logic [1:0] CARRY_KEEP      = 2'b01;  // shift with count 0: C unchanged
  localparam logic [1:0] CARRY_EXPLICIT  = 2'b10;  // shift: the bit shifted out

  // ---------------------------------------------------------------------
  // Architectural state bundle (phase 2: five-stage pipeline).
  //
  // Everything an instruction can *write* and a younger instruction can
  // *read* lives in one struct, and every instruction computes the whole
  // "state after me" in EX. The bundle is then carried through the pipeline
  // and bypassed (MEM, WB) into EX, so an instruction always sees the state
  // of all older instructions and nothing of younger ones - which is exactly
  // what the single-step behavioural cores do, only with the lookahead a
  // pipeline needs. GPRs stay in the register file and are bypassed the usual
  // way; the program counter is part of the bundle (it is R15).
  // ---------------------------------------------------------------------
  typedef struct packed {
    logic [15:0] pc;          // R15 in the normal bank (the architectural PC)
    logic [15:0] psw;
    logic [15:0] cs, ds, ss, es;              // normal-bank segment registers
    logic [15:0] spsw, spc, scs, sds, sss, ses;   // shadow bank
    logic        delay_active;   // a delay slot is pending
    logic        branch_taken;   // pending branch bookkeeping
    logic [15:0] delayed_pc, delayed_cs;
    logic        delayed_to_shadow;
    logic        fsh;           // FSH retired: invalidate the cache (spec 7.4)
  } d16_ctx_t;

  localparam d16_ctx_t CTX_RESET = {
    16'h0000,                                    // pc
    16'h0000,                                    // psw
    16'hFFFF, 16'h0000, 16'h0000, 16'h0000,      // cs, ds, ss, es
    16'h0000, 16'h0000, 16'h0000,                // spsw, spc, scs
    16'h0000, 16'h0000, 16'h0000,                // sds, sss, ses
    1'b0, 1'b0, 16'h0000, 16'h0000, 1'b0,        // delay state
    1'b0                                         // fsh
  };

  // Replicates updatePSWFlags() of both behavioural cores: NZ from the low
  // 16 bits of the last ALU result, V from the op site, C per carry_mode.
  function automatic logic [15:0] apply_nzvc(
      input logic [15:0] psw_in,
      input logic [31:0] last32,
      input logic        overflow,
      input logic [1:0]  carry_mode,
      input logic        carry_bit
  );
    logic [15:0] psw;
    logic        carry;
    psw = psw_in & 16'hFFF0;                    // keep system bits, clear NZVC
    if (last32[15:0] == 16'h0000) psw[FLG_Z] = 1'b1;
    if (last32[15])                psw[FLG_N] = 1'b1;
    case (carry_mode)
      CARRY_KEEP:     carry = psw_in[FLG_C];
      CARRY_EXPLICIT: carry = carry_bit;
      default:        carry = |last32[31:16];   // > 0xFFFF (unsigned) or < 0
    endcase
    if (carry) psw[FLG_C] = 1'b1;
    if (overflow) psw[FLG_V] = 1'b1;
    return psw;
  endfunction

  // Boot ROM (identical in both behavioural cores): zeroes DS/SS, builds the
  // entry point 0x0100 in R1, plants it at physical 0..2, jumps to 0000:0100.
  // Packed rather than an unpacked array literal so every tool (Verilator,
  // emscripten) elaborates the same words.
  localparam logic [16*ROM_WORDS-1:0] BOOT_ROM_PACKED = 256'hFFF1FFF1FFF1FFF1FFF1FFF1FFF0FFE0A202A201A200D818FC21FF42FF410000;

  function automatic logic [15:0] boot_rom_word(input int unsigned idx);
    boot_rom_word = BOOT_ROM_PACKED[16*idx +: 16];
  endfunction

endpackage
