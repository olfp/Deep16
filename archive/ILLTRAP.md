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

## NIO — the last free SYS opcode

`SYS` is class 1 (`w[15:3] == 13'h1FFE`), i.e. `0xFFF0..0xFFF7`, with the low
three bits selecting the operation (`rtl/deep16_core3.sv:445-495`). Sub-ops 0-5
are taken (NOP, FSH, SWI, RETI, SETI, CLRI), 6 is `SAPF` (`FPUEMUPLAN.md` §3),
and 7 — `0xFFF7` — is the only fully free word left in the ISA: the FPU range
`0xFFF8..0xFFFE` and HALT (`0xFFFF`) are allocated, and nothing else in the
65,536 words is unused. `doc/Deep16-Arch.md` §9.2 still describes this word as
"could be SYSCALL for OS".

Decision: sub-op 7 is **NIO** — *Non-implemented Opcode* — and it raises the
ILL trap instead of acting as a NOP.

Reasons:

- A reserved word that silently NOPs hides bugs. Anything that decodes into the
  last hole — a mis-assembled word, a corrupt image, an experiment that never
  landed — currently falls through and the CPU continues with whatever happens
  to be in the registers.
- It gives the kernel a deliberate assertion/stub: put `NIO` where code is
  supposed to be and an unfinished path faults loudly at a known PC instead of
  doing nothing. That is worth more than the single word it costs.
- The trap then covers every hole in the encoding, at the same time the FPU
  words start trapping (`FPUEMUPLAN.md` P1). Two mechanisms that both mean "not
  implemented" should not disagree.

It is **not** an FPU opcode and must not become one: the seven-word FPU range
stays as specified, so `NIO` cannot be used to smuggle in an eighth operation.

Implementation notes:

- Decode: `cls == 1 && instr[2:0] == 3'd7` takes the same undefined-opcode path
  as an `ext_id == 10` word — vector 0, `LR = pc_own1`, opcode readable at
  `LR-1`. Ungated: there is no mode in which NOP is the better answer.
- The SYS `case` in `deep16_core3.sv` currently has no `default`, so sub-op 7
  falls through. `SAPF` (6) and `NIO` (7) both need explicit arms; the
  five-stage core needs the same treatment in its SYS decode.
- Assembler: mnemonic `NIO`, no operands, encodes `0xFFF7`.
- Disassembler: slot 7 of the SYS table (`js/deep16_disassembler.js:11`).
- Ungated means a stray `0xFFF7` in a delay slot also faults, which is the
  intended behaviour but makes `LR-1` the delay-slot word rather than the
  branch that led to it.
- The trap is not re-entrant: `NIO` inside a handler is a double fault, so it
  cannot serve as a debugger break from handler code.
- The full D16 core has no trap yet, so `NIO` NOPs there. Same P1 gap as the
  FPU words; do not fix one without the other.
- `0xFFFF` (HALT) is decoded before instruction decode and is unaffected.

Open: whether the handler reports `NIO` distinctly from an undefined FPU word.
It already fetches the trapped opcode at `LR-1`, so distinguishing `0xFFF7` is
a comparison and a message, not new logic — but a distinct fault code is more
useful than a single "illegal instruction" for debugging a half-finished build.

## Benchmark (TODO once the board build is exercised)

- Measure DIV and DIV32 through the trap vs the hardware divider on the full
  D16: cycles per operation from `cycle_count`/`get_cycle_count`.
- The core3 runs at 6.75 MHz, the full D16 at 13.5 MHz; report ns/divide for
  both, and the handler's fixed entry/exit cost separately from the software
  divide loop.
- A Forth-level loop (for example 1,000 `/` or `/mod` operations) on the nano
  vs the full build, to show the practical compatibility cost.
