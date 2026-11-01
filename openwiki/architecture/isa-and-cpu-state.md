---
type: architecture-reference
title: ISA and CPU State
description: The Deep16 instruction encoding, register and PSW state, flag rules, shadow banking, delay slots and trap semantics as the cores actually implement them.
tags: [isa, cpu, encoding, psw, flags, interrupts, shadow-registers]
verified:
  - by: openwiki/0.7.2
    at: 2026-11-01T09:36:37.731Z
sources:
  - id: openwiki-source-8014e939fc84f1df33209131
    resource: repo://doc/Deep16-Arch.md
  - id: openwiki-source-558f92ad48bad4c1a8f65265
    resource: repo://js/deep16_simulator.js
  - id: openwiki-source-b57ab1606c48ec3ea7344623
    resource: repo://MEMMAP.md
  - id: openwiki-source-9e32d1e057dbf502fe769f73
    resource: repo://rtl/deep16_pkg.sv
  - id: openwiki-source-0c322f41fb3643b953b4bfa5
    resource: repo://rtl/deep16_regfile.sv
generated: { by: "opencode", at: "2026-11-01T09:36:37.731Z" }
---

# ISA and CPU State

Deep16 is a 16-bit word-addressed RISC machine with a segmented 20-bit physical
address space, a banked register context for exception handlers, and a
one-instruction delay slot on every jump.

This page describes the encoding and the state transitions. The architecture
manual in `doc/Deep16-Arch.md` is the long-form reference, but the cores follow
the measured behaviour of the JS reference where the text disagrees; those
places are called out below.

## Words, addresses and reset

- Every cell and every instruction is **16 bits**. The data address space is
  **2^20 words** (2 MiB at one word per address).
- A physical address is `(segment << 4) + offset` with the offset truncated to
  16 bits. The architecture text once printed `(segment << 16) | offset`; no
  core implements that.
- Reset state: `PSW = 0`, `CS = 0xFFFF`, `DS = SS = ES = 0`, `PC = 0`. Execution
  therefore starts in the 16-word boot ROM at physical `0xFFFF0`.
- The ROM zeroes `DS`/`SS`, builds `0x0100` in `R1`, plants it at physical
  `0x0000`–`0x0002` as a breadcrumb, and jumps to `0000:0100`.
- `0xFFFF` in the instruction stream is the halt word. An unbacked read returns
  `0xFFFF` and an unpopulated write is dropped, so the machine stops rather than
  executing garbage.

## Registers

| Register | Convention |
|---|---|
| `R0` | Implicit destination of `LDI`; scratch |
| `R1`–`R11` | General purpose |
| `R12` | `FP`, frame pointer |
| `R13` | `SP`, stack pointer |
| `R14` | `LR`, link register |
| `R15` | `PC`; not a general register in the usual sense |

`LDI` can only target `R0`; loading any other register needs `MOV` or `LSI`.
`R15` as a destination is a jump: `MOV PC, Rx` is the assembler's `JMP Rx` and
takes a delay slot.

## PSW layout

| Bits | Field | Meaning |
|---|---|---|
| 0 | N | Negative |
| 1 | Z | Zero |
| 2 | V | Signed overflow |
| 3 | C | Carry / borrow |
| 4 | I | Interrupt enable |
| 5 | S | Shadow bank active |
| 6–9 | SR | Stack-register selector |
| 10 | DS | Dual stack selector (use `SR` and `SR+1`) |
| 11–14 | ER | Extra-register selector |
| 15 | DE | Dual extra selector (use `ER` and `ER+1`) |

`SR`/`DS` choose which base register makes a `LD`/`ST` use `SS` instead of
`DS`; `ER`/`DE` do the same for `ES`. Selector value 0 disables the mapping.

Bit 5 is the context selector. When it is set, the active bank is the shadow
bank; when clear, the normal bank. The manual sometimes names this selector
`PSW'.S`, but implementations test bit 5 of the **active** PSW, and the
alternate PSW register holds the interrupted PSW.

## Encoding hierarchy

Instruction length is encoded by a prefix, from one to sixteen bits:

| Prefix | Group | Format |
|---|---|---|
| `0` | `LDI` | `0 imm15` |
| `10` | `LD`/`ST` | `10 d Rd4 Rb4 off5` |
| `110` | ALU / shift / multiply / divide | `110 func5 Rd4 Rs4-or-imm4` |
| `1110` | Conditional jump | `1110 cond3 target9` |
| `11110` | `LDS`/`STS` | `11110 d seg2 Rd4 Rs4` |
| `111110` | `MOV` | `111110 Rd4 Rs4 imm2` |
| `1111110` | `LSI` | `1111110 Rd4 imm5` |
| `11111110` | `SMV` | `11111110 Rx4 alt4` |
| `111111110` | `MVS` | `111111110 d Rd4 seg2` |
| `1111111110` | `SOP` | `1111111110 type2 Rx4` |
| `11111111110` | `SET`/`CLR` | `11111111110 d imm4` |
| `111111111110` | `JML` | `111111111110 Rx4` |
| `1111111111110` | `SYS` | `1111111111110 op3` |
| `11111111111110xx` … | FPU space, `FCMP`, `HLT` | Reserved / halt |

Only `0xFFF0`–`0xFFF7` are system instructions. `0xFFF8`–`0xFFFE` fall outside
the 13-bit SYS prefix and are no-ops; `0xFFFF` is `HLT`. `0xFFF1` (`FSH`) is a
behavioural no-op in all three cores — it does not stop the machine.

The FPU encodings are reserved for an ILL trap that is not implemented as a
general trap (see below).

## Immediates

`LDI` holds a 15-bit field and sign-extends bit 14 into bit 15. The reachable
set is therefore not all 16-bit values:

- `0x0000`–`0x3FFF` (top two bits `00`) and `0xC000`–`0xFFFF` (top two bits
  `11`) are reachable directly.
- `0x4000`–`0x7FFF` and `0x8000`–`0xBFFF` are unreachable in one instruction.
  `LDI 0x7000` silently loads `0xF000`; the assembler's `LWI` mnemonic refuses
  such a value and points at the `LDI` + `OR` recipe instead.

`LSI` sign-extends a 5-bit field (`-16..+15`). `MOV`'s two-bit `imm2` is a
function selector, not an immediate: `0` copies, `1` shifts left once, `2` adds
two, `3` shifts left and sets bit 0. `LINK` is `MOV Rd, PC, 2`, which yields the
instruction after the delay slot because a PC source reads `own address + 1`.

## Data movement and addressing

`LD`/`ST` add a **sign-extended** 5-bit offset (`-16..+15`) to the base
register, then select a segment: `SS` if the base is selected by `SR`/`DS`,
`ES` if selected by `ER`/`DE`, otherwise `DS`.

`LDS`/`STS` name the segment explicitly in a two-bit field (`CS`, `DS`, `SS`,
`ES`) and use the base register unchanged.

`MVS` moves a segment register to or from a general register. `SMV` accesses the
**inactive** bank: reads select `ACS`/`ADS`/`ASS`/`AES`, `AR0`–`AR3`,
`APSW`, `AR13`, `AR14`, or `APC`; the write form stores an active register into
the inactive bank. `APC` is the exception on the read side: it returns the
active architectural PC, which is what makes it usable inside a delay slot.

## Arithmetic and logic

The `110` group is selected by a five-bit function code:

- `ADD`, `SUB`, `CMP` have register and 4-bit-immediate forms; the immediate
  is a value (`ADD Rd, 3`).
- `AND`, `OR`, `XOR` have register forms; their immediate forms read the low
  four bits as a **bit index**, expanding it to `1 << imm`. `CLRB` clears that
  bit. `TBC`/`TBS` test a bit and set only N/Z.
- `AND Rd, imm` does not exist; the slot is `CLRB`, and the assembler rejects
  the old spelling.
- `MUL` produces the low 16 bits of the product.
- `MUL32` writes a 32-bit product to `Rd:Rd+1`; `Rd` must be even.
- `DIV` is signed, truncates toward zero, and returns `0xFFFF` for a zero
  divisor.
- `DIV32` divides a 32-bit dividend in `Rd:Rd+1` by `Rs`, leaving quotient in
  `Rd` and remainder in `Rd+1`; `Rd` must be even. A zero divisor leaves the
  remainder untouched.
- An odd destination for `MUL32`/`DIV32` writes nothing and reports all ones as
  the ALU result.

The shift/rotate functions (`SL`, `SLA`, `SLAC`, `SLC`, `SR`, `SRC`, `SRA`,
`SRAC`, `ROL`, `RLC`, `ROR`, `RRC`) use the low four bits as a count. The carry
out is the bit shifted out; a count of zero **keeps the previous carry**.

## Flags

Only the ALU and shift groups update NZVC. Loads, stores, `LDI`, `LSI`, `MOV`,
`MVS`, `SMV`, `SOP` moves, branches, `SWI` and `RETI` leave the flags alone.
This is why code that branches on a loaded value first compares it with `CMP`.

- N and Z come from the low 16 bits of the ALU result.
- V is computed at the `ADD`/`SUB`/`CMP` sites and is false elsewhere.
- C is the explicitly shifted-out bit for shifts; otherwise it is the
  heuristic “the 32-bit result is greater than `0xFFFF` or negative”. `SUB` and
  `CMP` report the exact signed difference, so borrow works.
- `SAPF` copies the low nibble of the shadow `R0` into the low nibble of the
  shadow PSW and preserves bits 15:4.

## Control flow and delay slots

Conditional jumps use a 9-bit signed target relative to `PC + 1`. Because the
core increments `PC` before executing the instruction, the implementation
computes `target = currentPC + offset` where `currentPC` is already the next
word.

Every taken conditional jump, `JMP` (`MOV PC, Rx`) and `JML` starts a delay
slot. The next instruction executes unconditionally; only after it does the
pending transfer apply. A jump inside the delay slot replaces the outer target,
and a not-taken branch inside the slot discards it. A PC read inside a delay
slot still returns `own address + 1`, not the slot address.

`JML Rx` requires an even register: `CS = R[Rx]`, `PC = R[Rx+1]`.

## Shadow banking and interrupt context

While `PSW.S=1`, only `R0`–`R3`, `R13` and `R14` are banked. `R4`–`R12` are
shared by both contexts. This is a deliberate area/behaviour trade-off and is
implemented identically in the JS, WASM and RTL register files.

Traps and interrupts enter the handler with a fresh context:

- the interrupted PSW is parked in the alternate PSW;
- the active PSW becomes `0x0020` (S=1, I=0, flags clear);
- the shadow `CS`, `DS`, `SS`, `ES` are zeroed;
- the shadow `PC` is loaded from the vector word at physical `0x0002` (SWI) or
  `0x0000` (ILL);
- the handler bank (`R0'`–`R3'`, `SP'`) is **not** cleared — it persists across
  entries.

`RETI` restores the parked PSW and clears the alternate PSW. A spurious `RETI`
outside handler context merely keeps S clear. `SWI` does not check `PSW.I`; an
ILL inside handler context is a double fault and halts the JS core.

The ILL entry additionally places the interrupted PC — the word **after** the
trapped instruction — in the shadow `R14`, so the handler can fetch the opcode
at `LR - 1`. The ILL vector is `0x0000`, hardware interrupts would use `0x0001`,
and SWI uses `0x0002`.

### What the ILL trap actually covers

The full `D16` core keeps the hardware divider and does not trap `DIV`/`DIV32`.
The reduced `core3` used by D16nano raises the ILL for a divide the full core
would have executed; `asm/forth_nano.asm` installs a handler that emulates it in
software. The general undefined-opcode/FPU trap described in the manual is still
missing, and the FPU itself does not exist.

## Spec versus implementation

Points where the architecture text and the cores differ, or where the text is
easy to misread:

- Physical address is `(segment << 4) + offset`, not `(segment << 16) | offset`.
- `LDI` sign-extends bit 14; it cannot reach the middle two quarters of the
  16-bit space in one instruction.
- `0xFFF1` is `FSH`, a no-op, not an early halt. `0xFFF8`–`0xFFFE` are no-ops.
- The active PSW bit 5 selects the bank; the alternate PSW holds the
  interrupted PSW. Some manual passages label the selector `PSW'.S`.
- Hardware interrupts are implemented only in the JS core. RTL and WASM have
  `SWI` and trap entry but no external interrupt input.

## Related pages

- [Memory Map and Memory Model](memory-map-and-memory-model.md)
- [Core Parity and Verification](core-parity.md)
- [JavaScript Reference Core](../cores/js-core.md)
- [RTL Core Microarchitecture](../cores/rtl-core.md)
