// Deep16 RTL - iterative radix-4 restoring divider (spec Table 8, DIV/DIV32).
//
// Why this exists
// ---------------
// The combinational form this replaces was
//     quot32 = dividend32 / {16'h0000, opv_i};
//     rem32  = dividend32 % {16'h0000, opv_i};
// Verilog sees 32/32 there (the divisor is zero-extended), so synthesis infers
// two full 32-bit dividers of which only the low 16 bits are ever used. The
// architecture actually wants 32/16: quotient in Rd, remainder in Rd+1, both
// 16 bit wide. A real 32/16 restoring divider needs only an 18-bit working
// value (16-bit divisor, shifted left by 2 for radix-4, plus the digit) - not
// 33 bits.
//
// Running the steps one per clock also decouples the datapath width from the
// clock: the critical path is a single iteration, not sixteen chained ones.
//
// Algorithm (radix-4 restoring, 16 iterations)
//   rem  = 0
//   rest = dividend                     // all 32 bits, consumed 2 per iteration
//   repeat 16 times:
//     shifted = (rem << 2) | rest[31:30]     // 18 bits
//     rest   <<= 2
//     digit = shifted >= 3*divisor ? 3
//           : shifted >= 2*divisor ? 2
//           : shifted >=   divisor ? 1 : 0
//     rem      = shifted - digit*divisor    // stays < divisor
//     quotient = (quotient << 2) | digit    // 16-bit register: the first
//                                            // eight digits shift out, which
//                                            // is exactly DIV32's Rd width
// The digit has to reach 3: shifted can be as large as 4*divisor-1, and
// (4*divisor-1) - 2*divisor is still >= divisor, so a two-way select would
// leave the remainder too large and every later step would be wrong.
//
// Why 16 iterations and not 8: seeding rem with dividend[31:16] would only be
// legal if that half were already < divisor, which it is not for a small
// divisor (0xFFFFFFFF/1 has a top half of 0xFFFF against a divisor of 1). The
// full 32-bit quotient has to be formed and truncated, so all 32 dividend bits
// are consumed from rem = 0 - two per iteration. Sixteen iterations is still
// half of the 32 a radix-2 unit would need for the same dividend.
//
// The final remainder is < divisor, matching DIV32's Rd/Rd+1 pair. DIV (16/16)
// is the same circuit with the top dividend half zeroed, which the caller does
// by passing dividend[31:16] = 0.
//
// The caller holds the pipeline (deep16_core's div_stall) while busy and reads
// quot/rem once busy has fallen. Neither output is combinationally derived from
// busy, so the values are stable to read in the same cycle busy falls.

module deep16_divider
  import deep16_pkg::*;
(
  input  logic        clk,
  input  logic        rst,

  input  logic        start,        // pulse: begin a division (ignored while busy)
  input  logic [31:0] dividend,
  input  logic [15:0] divisor,

  output logic        busy,
  // Sticky: rises when the result is ready, clears on the next start. Masked
  // combinationally by start so that a division issued right after a finished
  // one cannot read the previous quotient for a cycle.
  output logic        done,
  output logic [15:0] quot,         // valid once done has risen
  output logic [15:0] rem           // valid once done has risen
);

  localparam logic [4:0] STEPS = 5'd16;   // 32 dividend bits, 2 per iteration

  // Working width: rem < divisor <= 0xFFFF, shifted left by 2 and offset by a
  // 2-bit digit reaches 4*0xFFFF-1 = 0x3FFFF, which needs 18 bits.
  localparam int W = 18;

  // rem_q itself never exceeds divisor-1 (16 bits); only `shifted` needs the
  // extra two bits. Keeping the register at 16 saves two flip-flops and makes
  // the "rem stays below divisor" invariant visible in the type.
  logic [15:0] rem_q;
  logic [31:0]  rest_q;             // dividend bits not yet consumed
  logic [W-1:0] one_div;            // divisor
  logic [W-1:0] two_div;            // 2 * divisor
  logic [W-1:0] three_div;          // 3 * divisor
  logic [15:0]  quot_q;
  logic [4:0]   step_q;             // iterations remaining, STEPS..1
  logic         done_q;

  // ---- one iteration, purely combinational ------------------------------
  logic [W-1:0] shifted;
  // Only the low 16 bits of a difference are ever kept (the winner is < divisor),
  // so the high bits of these intermediates are deliberately unused.
  /* verilator lint_off UNUSEDSIGNAL */
  logic [W-1:0] rem_p1, rem_p2, rem_p3;
  /* verilator lint_on UNUSEDSIGNAL */
  logic         ge1, ge2, ge3;
  logic [1:0]   digit;
  logic [15:0] rem_nxt;
  logic [15:0]  quot_nxt;

  always_comb begin
    shifted = {rem_q, rest_q[31:30]};      // rem << 2 | next digit pair, 18 bits
    rem_p1  = shifted - one_div;
    rem_p2  = shifted - two_div;
    rem_p3  = shifted - three_div;
    ge3     = (shifted >= three_div);
    ge2     = (shifted >= two_div);
    ge1     = (shifted >= one_div);

    if (ge3) begin
      digit   = 2'd3;
      rem_nxt = rem_p3[15:0];
    end else if (ge2) begin
      digit   = 2'd2;
      rem_nxt = rem_p2[15:0];
    end else if (ge1) begin
      digit   = 2'd1;
      rem_nxt = rem_p1[15:0];
    end else begin
      digit   = 2'd0;
      rem_nxt = shifted[15:0];
    end

    quot_nxt = {quot_q[13:0], digit};
  end

  always_ff @(posedge clk) begin
    if (rst) begin
      busy      <= 1'b0;
      rem_q     <= '0;
      rest_q    <= '0;
      one_div   <= '0;
      two_div   <= '0;
      three_div <= '0;
      quot_q    <= '0;
      step_q    <= '0;
      done_q    <= 1'b0;
    end else if (!busy) begin
      if (start) begin
        // A division by zero is answered by the caller (0xFFFF), so the
        // divider never sees one here; anything else starts eight iterations.
        busy      <= 1'b1;
        rem_q     <= '0;
        rest_q    <= dividend;
        one_div   <= {2'b00, divisor};
        two_div   <= {1'b0, divisor, 1'b0};
        three_div <= {1'b0, divisor, 1'b0} + {2'b00, divisor};
        quot_q    <= 16'h0000;
        step_q    <= STEPS;
        done_q    <= 1'b0;
      end
    end else if (step_q != 5'd0) begin
      rem_q   <= rem_nxt;
      rest_q  <= {rest_q[29:0], 2'b00};
      quot_q  <= quot_nxt;
      step_q  <= step_q - 5'd1;
    end else begin
      busy   <= 1'b0;                 // the last iteration landed last edge
      done_q <= 1'b1;
    end
  end

  // Not gated by busy: the caller reads these in the same cycle done rises.
  assign done = done_q && !start;
  assign quot = quot_q;
  assign rem  = rem_q;

endmodule
