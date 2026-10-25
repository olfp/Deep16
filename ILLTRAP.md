ILL Trap Redesign

After we removed DIV/DIV32 from D16nano, emulatting the instrictions via the ILL trap is necessary to keep the code base usable for D16nano and full D16.

Reviewing this revelaed a ISA design flaw: From interrupt contect R0 .. R3 cannot be written (that R13..R15 are not writable does not hurt)

We can remedy this by using the four unused alt_reg4 codes in SMV to encode writes to AR0..AR3.

1. Move SMV APSW, Rx from alt-reg4 = 0100 to alt_reg4 = 1100. This gives us four continous alt_reg4  code 0100..0111.
2. Designate these to SMV Rx, ARy with any x and y being 0..3
3. Change the assember

This enabke implementing ILL, first for DIV/DIV32.

-------------------------------------------------------------------------------

## Implemented (D16nano core3)

- `SMV` alt_sel: APSW moved from 0100 to **1100**. The freed **0100..0111**
  codes are the write form **`SMV ARy, Rx`** (destination first): store the
  active Rx into the *inactive* bank's R[y]. Reads stay `SMV Rx, ARy`
  (1000..1011), `SMV Rx, APSW` (1100), AR13/AR14/APC unchanged.
- The assembler, disassembler, JS/WASM cores and both RTL cores implement it.
- The core3 traps `DIV`/`DIV32` when the full core would have used the
  iterative divider (non-zero divisor, valid destination). The zero-divisor and
  odd-DIV32-destination cases keep the ALU's fixed result.
- Trap entry follows spec 3.2/4.7: vector 0, PSW'=0x0020, shadow segments 0,
  shadow R0..R3/R13 cleared, and the shadow **R14 = interrupted PC** (the word
  after the trapped one) so the handler can fetch the opcode at LR-1.
- `asm/forth_nano.asm` installs vector 0 and carries `ill_handler` at 0x5000.
  The handler saves the caller's shared R4..R12 on the data stack, decodes the
  trapped word, reads the operands through SMV (R0..R3/R13/R14) or directly
  (R4..R12), runs `div16_call`/`sdiv32`, restores the shared registers and
  RETIs. Results go back through the new SMV writes (R0..R3) or directly.
  R13/R14 destinations are deliberately documented as unsupported; any real
  code that divides uses the stack/link registers for other purposes.
- A trap while already in the handler is a double fault (processor reset).
- The standard full D16 keeps the hardware divider; the D16nano kernel keeps
  its software divide for its own Forth words. Only binaries containing a real
  DIV/DIV32 reach the handler.

## Known gap: DIV/DIV32 condition codes

The handler does **not** reproduce the NZVC flags the full core sets from the
quotient (Z = quotient == 0, N = quotient[15], C = V = 0). The zero-divisor
and odd-DIV32-destination cases never trap, so their flags are already right;
only a normal trapping division loses them. Nothing tests this and the kernel
does not branch on flags right after a division, so it has gone unnoticed.
`SAPF` — see `FPUEMUPLAN.md` §3 and §4 — closes it.

## Benchmark (TODO once the board build is exercised)

- Measure DIV and DIV32 through the trap vs the hardware divider on the full
  D16: cycles per operation from `cycle_count`/`get_cycle_count`.
- The core3 runs at 6.75 MHz, the full D16 at 13.5 MHz; report ns/divide for
  both, and the handler's fixed entry/exit cost separately from the software
  divide loop.
- A Forth-level loop (for example 1,000 `/` or `/mod` operations) on the nano
  vs the full build, to show the practical compatibility cost.
