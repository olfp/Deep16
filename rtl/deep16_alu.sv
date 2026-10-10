// Deep16 RTL - combinational ALU (spec Table 6: 32 operations on Rd/Rs/imm4).
//
// Byte-for-byte port of executeALUOp()/exec_alu() from the behavioural cores,
// including their quirks: the "test" ops (func5 8/9/14/15) report 0/1 in the
// flags without touching Rd, MUL32/DIV32 refuse an odd destination with an
// all-ones result, DIV/DIV32 by zero yield 0xFFFF, and the 17-bit ADD mask plus
// the exact signed SUB difference feed the carry heuristic of apply_nzvc().
module deep16_alu
  import deep16_pkg::*;
(
  input  logic [4:0]  func5,
  input  logic [15:0] rdv,        // active-bank Rd
  input  logic [15:0] opv,        // active-bank Rs (only used when is_reg)
  input  logic [15:0] rd1_in,     // active-bank Rd+1 (DIV32 dividend low word)
  input  logic [3:0]  low4,       // Rs field / imm4
  /* verilator lint_off UNUSEDSIGNAL */
  input  logic [3:0]  rd,         // Rd field (pair alignment check)
  /* verilator lint_on UNUSEDSIGNAL */
  input  logic [15:0] psw_in,
  output logic [15:0] result,     // written to Rd
  output logic        rd_we,
  output logic        rd1_we,     // MUL32/DIV32 write Rd+1
  output logic [15:0] rd1_val,
  output logic [31:0] last32,     // value feeding NZ/C of apply_nzvc()
  output logic        overflow,
  output logic [1:0]  carry_mode,
  output logic        carry_bit
);

  logic        is_reg;
  logic [15:0] opv_i;             // effective second operand
  logic [31:0] zext;              // rdv zero-extended (32-bit shift helper)

  /* verilator lint_off UNUSEDSIGNAL */
  logic [31:0] shl, shr, rot, rotr;
  logic [31:0] fill_lo;           // cbit at count-1    (SLAC/RLC)
  logic [31:0] fill_hi;           // cbit at 15-count   (SRC/RRC)
  logic [31:0] sign_mask;
  logic [31:0] quot32, rem32;
  /* verilator lint_on UNUSEDSIGNAL */
  logic [16:0] sum17;
  logic [16:0] diff17;
  logic        last32_set;      // ops that report a wider/signed result
  logic [31:0] prod32;
  logic [31:0] dividend32;
  logic [3:0]  count;
  logic [4:0]  sh16;              // 16 - count, 5 bits wide

  logic        cbit;            // carry-in (PSW.C) for the rotating shifts

  assign cbit   = psw_in[FLG_C];
  assign is_reg = (func5[4] == 1'b0 && func5[0] == 1'b0) || (func5[4:2] == 3'b111);
  assign opv_i  = is_reg ? opv : {12'h000, low4};
  assign zext   = {16'h0000, rdv};
  assign count  = opv_i[3:0];
  assign sh16   = 5'd16 - {1'b0, count};

  always_comb begin
    // ---- defaults -------------------------------------------------------
    result     = rdv;
    rd_we      = 1'b1;
    rd1_we     = 1'b0;
    rd1_val    = 16'h0000;
    last32     = zext;
    last32_set = 1'b0;
    overflow   = 1'b0;
    carry_mode = CARRY_HEURISTIC;
    carry_bit  = 1'b0;

    // ---- shared intermediates -------------------------------------------
    sum17      = {1'b0, rdv} + {1'b0, opv_i};
    diff17     = {1'b0, rdv} - {1'b0, opv_i};
    shl        = zext << count;
    shr        = zext >> count;
    rot        = (zext << count) | (zext >> sh16);
    rotr       = (zext >> count) | (zext << sh16);
    fill_lo    = (count > 4'd0 && cbit) ? (32'h0000_0001 << (count - 4'd1)) : 32'h0;
    fill_hi    = (count > 4'd0 && cbit) ? (32'h0000_0001 << (5'd15 - {1'b0, count})) : 32'h0;
    sign_mask  = rdv[15] ? (32'hFFFF_FFFF << sh16) : 32'h0;
    prod32     = rdv * opv_i;
    dividend32 = {rdv, rd1_in};
    quot32     = 32'h0;
    rem32      = 32'h0;

    case (func5)
      // ---- logic group: NZC from the result, V from the op site ---------
      5'b00000, 5'b00001: begin                       // ADD / ADDi
        result   = sum17[15:0];
        last32   = {15'h0000, sum17};
        last32_set = 1'b1;
        overflow = (((~(rdv ^ opv_i)) & (rdv ^ sum17[15:0]))  & 16'h8000) != 16'h0000;
      end
      5'b00010, 5'b00011: begin                       // SUB / SUBi
        result   = diff17[15:0];
        last32   = {{15{diff17[16]}}, diff17};
        last32_set = 1'b1;
        overflow = ((((rdv ^ opv_i)) & (rdv ^ diff17[15:0])) & 16'h8000) != 16'h0000;
      end
      5'b00100, 5'b00101: begin                       // CMP / CMPi: no Rd write
        result   = diff17[15:0];
        last32   = {{15{diff17[16]}}, diff17};
        last32_set = 1'b1;
        overflow = ((((rdv ^ opv_i)) & (rdv ^ diff17[15:0])) & 16'h8000) != 16'h0000;
        rd_we    = 1'b0;
      end
      5'b00110: begin                                 // AND Rd, Rs
        result = rdv & opv_i;
      end
      5'b00111: begin                                 // CLRB Rd, imm4
        result = rdv & ~(16'h0001 << low4);
      end
      5'b01000: begin                                 // test AND
        last32 = ((rdv & opv_i) == 16'h0000) ? 32'h0000_0000 : 32'h0000_0001;
        last32_set = 1'b1;
        rd_we  = 1'b0;
      end
      5'b01001: begin                                 // test bit clear, imm4 index
        last32 = (((zext >> opv_i) & 32'h1) == 32'h0) ? 32'd1 : 32'd0;
        last32_set = 1'b1;
        rd_we  = 1'b0;
      end
      5'b01010: begin                                 // OR Rd, Rs
        result = rdv | opv_i;
      end
      5'b01011: begin                                 // SETB Rd, imm4
        result = rdv | (16'h0001 << low4);
      end
      5'b01100: begin                                 // XOR Rd, Rs
        result = rdv ^ opv_i;
      end
      5'b01101: begin                                 // XOR Rd, 1<<imm4
        result = rdv ^ (16'h0001 << low4);
      end
      5'b01110: begin                                 // test OR
        last32 = ((rdv & opv_i) != 16'h0000) ? 32'h0000_0001 : 32'h0000_0000;
        last32_set = 1'b1;
        rd_we  = 1'b0;
      end
      5'b01111: begin                                 // test bit set, imm4 index
        last32 = (((zext >> opv_i) & 32'h1) == 32'h1) ? 32'd1 : 32'd0;
        last32_set = 1'b1;
        rd_we  = 1'b0;
      end

      // ---- shift / rotate group: C is the bit shifted out (Table 7) ---
      5'b10000: begin                                 // SL
        result     = shl[15:0];
        carry_bit  = (count > 4'd0) ? zext[sh16] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end
      5'b10001: begin                                 // SLA
        result     = {1'b0, shl[14:0]} | {rdv[15], 15'h0000};
        carry_bit  = (count > 4'd0) ? zext[sh16] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end
      5'b10010: begin                                 // SLAC
        result     = {1'b0, shl[14:0]} | {rdv[15], 15'h0000} | fill_lo[15:0];
        carry_bit  = (count > 4'd0) ? zext[sh16] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end
      5'b10011: begin                                 // SLC
        result     = shl[15:0] | fill_lo[15:0];
        carry_bit  = (count > 4'd0) ? zext[sh16] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end
      5'b10100: begin                                 // SR
        result     = shr[15:0];
        carry_bit  = (count > 4'd0) ? zext[{1'b0, count} - 5'd1] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end
      5'b10101: begin                                 // SRC
        result     = shr[15:0] | fill_hi[15:0];
        carry_bit  = (count > 4'd0) ? zext[{1'b0, count} - 5'd1] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end
      5'b10110: begin                                 // SRA
        result     = shr[15:0] | sign_mask[15:0];
        carry_bit  = (count > 4'd0) ? zext[{1'b0, count} - 5'd1] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end
      5'b10111: begin                                 // SRAC
        result     = shr[15:0] | sign_mask[15:0] | fill_hi[15:0];
        carry_bit  = (count > 4'd0) ? zext[{1'b0, count} - 5'd1] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end
      5'b11000: begin                                 // ROL
        result     = rot[15:0];
        carry_bit  = (count > 4'd0) ? zext[sh16] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end
      5'b11001: begin                                 // RLC
        result     = rot[15:0] | fill_lo[15:0];
        carry_bit  = (count > 4'd0) ? zext[sh16] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end
      5'b11010: begin                                 // ROR
        result     = rotr[15:0];
        carry_bit  = (count > 4'd0) ? zext[{1'b0, count} - 5'd1] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end
      5'b11011: begin                                 // RRC
        result     = rotr[15:0] | fill_hi[15:0];
        carry_bit  = (count > 4'd0) ? zext[{1'b0, count} - 5'd1] : 1'b0;
        carry_mode = (count > 4'd0) ? CARRY_EXPLICIT : CARRY_KEEP;
      end

      // ---- multiply / divide group (Table 8) ---------------------------
      5'b11100: begin                                 // MUL Rd, Rs
        result = prod32[15:0];
      end
      5'b11101: begin                                 // MUL32 R[d]:R[d+1]
        if (rd[0]) begin                              // odd destination refused
          last32 = 32'hFFFF_FFFF;
        last32_set = 1'b1;
          rd_we  = 1'b0;
        end else begin
          result  = prod32[31:16];
          rd1_we  = 1'b1;
          rd1_val = prod32[15:0];
          last32  = prod32;                           // wide result feeds NZ/C
          last32_set = 1'b1;
        end
      end
      5'b11110: begin                                 // DIV Rd, Rs
        result = (opv_i == 16'h0000) ? 16'hFFFF : (rdv / opv_i);
      end
      5'b11111: begin                                 // DIV32 R[d]:R[d+1]
        if (rd[0]) begin
          last32 = 32'hFFFF_FFFF;
        last32_set = 1'b1;
          rd_we  = 1'b0;
        end else if (opv_i == 16'h0000) begin
          result = 16'hFFFF;
        end else begin
          quot32  = dividend32 / {16'h0000, opv_i};
          rem32   = dividend32 % {16'h0000, opv_i};
          result  = quot32[15:0];
          rd1_we  = 1'b1;
          rd1_val = rem32[15:0];
        end
      end

      default: ;
    endcase

    // Every other op reports the value it writes into Rd (zero extended), which
    // is what updatePSWFlags() sees in both behavioural cores.
    if (!last32_set) last32 = {16'h0000, result};
  end

endmodule
