# FPU Emulation via ILL — Design Plan

Status: **P0-P4 implemented, including D16D, plus the Forth surface.** Written
against `932815c` ("Snapshot: D16nano tile console, ILL trap, 720p DVI"). The
soft-float library and the ILL FPU dispatch are complete and tested on both
the non-D16D nano kernel and the D16D BIOS-segment path. The D16D BIOS copy
now carries `0x4A00..0x6FFF`, so the library at flat `0x5800` is reachable at
BIOS offset `0x0E00`. `asm/forth_float.asm` adds `f+`, `f-`, `f*`, `f/`,
`fsqrt`, `fnegate`, `fabs`, `f<`, `f=`, `f0<`, `s>f`, `f>s`, `f@` and `f!`.

---

## 0. Summary

`doc/Deep16-FPU.md` specifies seven floating-point instructions in the
reserved opcode range `0xFFF8..0xFFFE`. No core implements them, no
assembler emits them, and — the important part — **the range currently
decodes to NOP in every core**, so the instructions are silently ignored
rather than trapped.

The plan is therefore:

1. Add the general undefined-opcode ILL trap (a prerequisite, not a side
   quest — today reserved words are NOPs, which is a bug on its own).
2. Add one SYS instruction, **`SAPF` — Set Alternate PSW Flags**, so an emulating
   handler can deliver condition codes to the interrupted code.
3. Build the soft-float routines as ordinary callable subroutines and test
   them directly.
4. Wire the trap to the routines.

Steps 1 and 2 are small and low-risk. Step 3 is the project.

---

## 1. Where the machine stands

| Thing | State |
|---|---|
| `SMV ARy, Rx` write form | **Done.** APSW moved `0100` → `1100`, `0100..0111` are the writes; assembler, disassembler, JS, WASM, both RTL cores |
| ILL trap | **Done (P1).** All four cores trap DIV/DIV32 on the nano and NIO/reserved words; a trap inside the handler resets/stops the core |
| FPU opcodes `0xFFF8..0xFFFE` | **Trap to ILL** in all four cores; no mnemonics yet |
| Assembler FPU mnemonics | None |
| FPU tests | None |
| `doc/Deep16-FPU.md` | 732 lines of spec, no implementation, several bugs (§10) |

`0xFFFF` (halt) is caught before decode, so `ext_id == 10` is *exactly*
`0xFFF8..0xFFFF`. Trapping on it traps precisely the FPU/reserved space and
nothing else.

**Which core runs where.** `D16NANO` selects `core3`
(`rtl/deep16_top.sv:208`); every other build — the standard D16, D16MINI and
the PSRAM machine — uses the five-stage `deep16_core` with the hardware
divider. P1 added the ILL trap to that core too, so the FPU range traps on
both machines (and in the JS and WASM models).

Anchors:

- `rtl/deep16_core.sv:235,258` — `d.ext = 4'd10` for reserved words
- `rtl/deep16_core.sv:1088` — `default: ; // reserved: NOP`
- `rtl/deep16_core3.sv:231` — `ext_id`, `:740` — the same `default: ;`
- `rtl/deep16_core3.sv:278` — `ill_div`, the existing trap condition
- `rtl/deep16_core3.sv:973` — double-fault handling
- `js/deep16_disassembler.js:11` — `systemOps` table, slots 6 and 7 are `''`
- `js/deep16_assembler.js:1577` — `encodeSystem` (`0xFFF0 | subop`)

---

## 2. Decisions

| # | Decision |
|---|---|
| D1 | FCMP delivers condition codes through **`SAPF`**, a new SYS instruction (§3). Not through a RETI semantic change. |
| D2 | The FPU keeps the spec's encodings `0xFFF8..0xFFFE`. They are *not* assembler macros and *not* a Forth-only library. |
| D3 | The general undefined-opcode trap is implemented **before** the FPU work (§5). |
| D4 | Soft-float routines are written and tested as plain subroutines first; the trap is wired last (§11). |
| D5 | An immediate form (`SAPFI imm4`) is **not** adopted. `LDI R0, n` + `SAPF` already covers static sites; `APC`/`ALINK` are not spent on it (§3.7). |

D1 was chosen over "RETI merges flags" because that would make condition
codes stop being part of the interrupted context — a semantic debt that
comes due the moment the timer or raster IRQ lands.

D4 exists because the current failure mode for anything wrong in a handler
is a **processor reset** (`core3:973` resets the context and stops). That
is the worst possible place to debug soft-float.

---

## 3. `SAPF` — Set Alternate PSW Flags

### 3.1 Encoding

SYS sub-opcode 6, word **`0xFFF6`**. Sub-op 7 (`0xFFF7`) is **`NIO`**, the
non-implemented-opcode trap (`archive/ILLTRAP.md`), not free.

| File | Change |
|---|---|
| `js/deep16_assembler.js` | `SAPF` (no operands) → `encodeSystem(6)` |
| `js/deep16_disassembler.js:11` | `systemOps[6] = 'SAPF'` |
| `rtl/deep16_core.sv` | SYS `case` → `3'd6` |
| `rtl/deep16_core3.sv` | same |
| `js/deep16_simulator.js` | same |
| `wasm/deep16-wasm/src/lib.rs` | same |
| `doc/Deep16-Arch.md` | §3.3/§4.9 opcode tables |

### 3.2 Semantics

```
SAPF:  spsw[3:0] <- R0[3:0]        ; R0 of the handler bank
      spsw[15:4] unchanged
```

Flags are `N=0, Z=1, V=2, C=3`. `spsw` is the PSW saved by the trap; `RETI`
restores it. So `SAPF` is the only way a handler can hand condition codes
back to the interrupted instruction.

Ungated: `SAPF` outside a handler writes a stale `spsw`, which the next trap
overwrites at entry. Nothing consumes `spsw` except `RETI` with `S == 1` and
the `SMV Rx, APSW` read.

### 3.3 Why flags only, not the whole PSW

`spsw` **is readable**: `SMV Rx, APSW` returns the other context's PSW —
inside a handler, the interrupted PSW (`Arch §3.3` table, §4.8;
`rtl/deep16_core.sv:1009-1010`, `js/deep16_simulator.js:947`,
`wasm/…/lib.rs:803-806`). There is no write form.

A full-word `SAPF` would therefore have to be used as a read-modify-write:
`SMV R0, APSW`, mask, OR in the nibble, `SAPF`. Three problems with that:

- It is three to five instructions per delivery instead of one.
- It requires the handler to hold a `0xFFF0` mask in a register.
- A handler bug that lets `S` through writes `S=1` into the return PSW, and
  `RETI` then never leaves the shadow context. Flags-only cannot express
  that failure.

Only the condition codes are writable; bits 15:4 are preserved by hardware.

### 3.4 Why the source is a register, not the current flags

The alternative — `spsw[3:0] <- psw[3:0]` — is cheaper for DIV (`CMP Q, 0`
then `SAPF`) but cannot express everything:

- `V` is only ever set by add/sub overflow, so `V=1` with `Z=0, N=0, C=0`
  is unreachable from ALU flags. FCMP's "unordered" needs exactly that.
- It is fragile: any flag-setting instruction inserted between the `CMP` and
  the `SAPF` silently changes the delivered value.

An explicit nibble in `R0` is immune to both. `R0'` is scratch *with respect
to the interrupted context* - the banks are separate - but since ARCHREV §3
it may carry a previous handler's persistent value, so a handler that owns
`R0'` must not use it as the `SAPF` carrier.

Cost: the handler must build the nibble and, where the value has to survive
a table dispatch (which uses `R0..R3`), park it on the caller's stack. A few
cycles against a ~400-cycle software divide.

### 3.5 Placement rules in a handler

- Build the nibble in `R0` last; `SAPF` may sit anywhere after that. The
  handler's own PSW flags are irrelevant to it.
- `ill_put_dispatch` (`asm/forth_nano.asm:15036`) clobbers `R0..R3`, so a
  nibble built before the write-back must be saved across it.
- `SAPF` must precede `RETI`.

### 3.6 Worked example — DIV (§4)

```
; quotient Q in R0, divisor was non-zero
    LSI  R1, 0          ; nibble
    CMP  R0, 0
    JNZ  sap_nz
    OR   R1, 1          ; Z (bit 1)
sap_nz:
    CMP  R0, 0
    JNN  sap_done
    OR   R1, 0          ; N (bit 0)
sap_done:
    ; ... park R1, write the destination, restore R4..R12 ...
    LD   R0, SP, 0      ; nibble back
    ADD  SP, 1
    SAPF
    RETI
```

(`OR` takes a bit *index*, so `OR R1, 1` sets bit 1.)

### 3.7 Alternative considered: an immediate form (`SAPFI imm4`)

> Naming note: the adopted instruction is **`SAPF`**, register-sourced. The
> immediate variant discussed in this section was proposed under the same
> working name; it is called **`SAPFI imm4`** here to keep the two apart.

Proposal: drop `SMV Rx, APC` (freeing alt_sel `1111`), move `ALINK` to a SYS
opcode, and encode `SAPFI imm4` — set the alternate PSW flags from a 4-bit
immediate — in the freed SMV slot.

**Fact check on the premise.** `SMV Rx, APC` is not ALINK-only:

- `ALNK Rx` is the general form; `ALINK` is `SMV LR, APC`
  (`assembler:752-758`).
- It is used by `asm/link_delay_slot.asm`, which is in the examples suite
  (`tests/examples.test.js:20`).
- `APC` reads the **active** PC (`pc_own1`, `core.sv:722,1014`) — own+1 with
  no forwarding. So inside a handler it reads the *handler's* PC, not the
  interrupted one. It is a normal-context call primitive, not a handler
  primitive: a cell that needs the caller's address uses the LR the trap
  already wrote, not APC.

So the exchange is: lose the documented 2-cycle call idiom and the general
architectural-PC read (`Arch §6.2.2`) in return for one word saved at each
*static* flag-delivery site.

**Why that is a poor trade.**

- `LDI R0, n` followed by `SAPF` already *is* `SAPFI n`: `LDI` writes `R0`,
  and `R0` is exactly the nibble source. The immediate form saves one word and
  one cycle per static site — three sites in the FCMP handler.
- At *dynamic* sites it is worse. DIV's flags come from the quotient, so
  `SAPFI` needs a 16-entry table plus a computed jump (or a two-branch chain)
  where `SAPF` needs six instructions of nibble building. And the quotient
  still has to be preserved across `ill_put_dispatch`, so the "no register to
  clobber" advantage does not materialise.
- ALINK-as-SYS is feasible — SYS executes in a delay slot and would read the
  same `pc_own1` — but it is churn in the one decode path where PC reads are
  timing-sensitive, and it costs `ALNK Rx`.

**If an immediate form is still wanted**, the cheap routes are, in order:

1. An assembler-level `SAPFI imm4` that emits `LDI n` + `SAPF` (two words).
   The assembler is one source line = one word today (`LWI` rejects rather
   than expands), so this is a small assembler change — still no encoding
   spent, no instruction removed.
2. A real single-word `SAPFI` in the **AR14** slot (`1110`), not APC. Its only
   user is `ill_get_r14` (`forth_nano.asm:15103`), one stub for the case
   `archive/ILLTRAP.md` already documents as unsupported. Then `SAPF` (SYS `0xFFF6`,
   dynamic) and `SAPFI` (SMV `1110`, static) both exist, and ALINK, ALNK and
   APC are untouched.

**Outcome: `SAPF` stands.** `SAPFI` is not adopted. If it is ever revisited,
take `AR14`, never `APC`.

---

## 4. DIV/DIV32 need condition codes too — and the nano loses them

**Yes.** DIV and DIV32 set NZVC in the full core, and the current nano ILL
handler does **not** reproduce them. Nothing tests it, and the kernel does
not notice because it never branches on flags right after a division.

### 4.1 What the hardware defines

From `rtl/deep16_alu.sv:222-250` and
`rtl/deep16_pkg.sv:71-91` (`apply_nzvc`): DIV and DIV32 both leave
`last32 = {16'h0000, quotient}`.

| Case | Q | Z | N | C | V |
|---|---|---|---|---|---|
| DIV, Rs ≠ 0 | signed quotient | Q == 0 | Q[15] | 0 | 0 |
| DIV, Rs = 0 | `0xFFFF` | 0 | 1 | 0 | 0 |
| DIV32, even Rd, Rs ≠ 0 | signed quotient | Q == 0 | Q[15] | 0 | 0 |
| DIV32, Rs = 0 | `0xFFFF` | 0 | 1 | 0 | 0 |
| DIV32, odd Rd | not written | 0 | 1 | 1 | 0 |

The last three rows never trap on the nano — `div_needs_hw`
(`core3:270`) excludes them, so the ALU handles them and their flags are
already correct. Only the trapping case used to lose its flags. **P2 fixed
this**: both `ill_div16` and `ill_div32` build the quotient nibble
(N = Q[15], Z = Q == 0, V = C = 0) and deliver it with `SAPF` before `RETI`.

### 4.2 Why the existing handler cannot fix it

`asm/forth_nano.asm:14743` saves `R4..R12`, emulates, restores, `RETI`s.
Flags set with ordinary ALU ops write the *handler's* PSW, and `RETI`
overwrites it from `spsw`. There is no path from handler flags to the
interrupted PSW today.

### 4.3 The fix

`SAPF`, exactly as in §3.6, inserted after the write-back and before `RETI`
in both `ill_div16` and `ill_div32`.

Note that `CMP Q, 0` alone would produce the right nibble *if* `SAPF` read the
current flags; with the register form the nibble is built explicitly, as
above. It is six instructions, against ~400 for the software divide.

### 4.4 Test

`divtest` (`asm/forth_nano.asm:15183`) already compares the trapped divide
against `div16_call`. It checks the quotient only. Extend it to run a
division whose quotient is 0, one that is negative, and one that is
non-zero/non-negative, comparing `PSW & 0x000F` against the software
divide's flags.

---

## 5. The general undefined-opcode trap

Before P1, `0xFFF8..0xFFFE` was a silent NOP in all four cores. They now trap
to vector 0; HALT (`0xFFFF`) stays a halt, including in a delay slot.

Design mirrors the existing DIV trap (`core3:750-790`):

```
ill_undef = ex.valid && cls == 5 && ext_id == 10 && !ctx.psw[FLG_S];
           (0xFFFF is already killed before decode)
ill_double = ex.valid && cls == 5 && ext_id == 10 &&  ctx.psw[FLG_S];
```

Entry (identical to `ill_div`): `spsw <- psw`, `psw <- 0x0020`, shadow
segments zeroed, `reg_we_b` writes R14 of the shadow bank with
`pc_own1` (the instruction *after* the trapped one, so the handler reads the
opcode at `LR-1`), `mem_addr = 0` (vector 0), `branch_taken = 0`,
`delay_active = 0`, `flags_we = 0`.

Changes:

- `rtl/deep16_core3.sv` — new condition beside `ill_div`; the trap body is
  the existing one, generalised.
- `rtl/deep16_core.sv` — the same trap, new (the full core has none).
- `js/deep16_simulator.js` — reserved decode currently falls through; add
  the trap, gated the same way as `d16nano`'s DIV trap.
- `wasm/deep16-wasm/src/lib.rs` — same.
- `asm/forth_nano.asm:15000` — `ill_unknown` already exists and restores
  and `RETI`s; it becomes the fall-through for unhandled codes.

**Double fault.** Currently resets the context and stops the core
(`core3:973`, `ctx <= CTX_RESET; run <= 0; halt_sticky <= 1`). For
development, make the trapped PC observable: in the simulator, report the
PC and the offending word instead of silently resetting; on the board, at
minimum keep the halt sticky and expose the PC on the debug bus.

Cost: ~20 lines per core, roughly 15–25 LUT / 2 FF.

---

## 6. The FPU trap

### 6.1 Opcode map (`doc/Deep16-FPU.md` §3.1)

| Word | Prefix | Op |
|---|---|---|
| `0xFFF8` | `11111111111110 00` | FADD |
| `0xFFF9` | `… 01` | FMUL |
| `0xFFFA` | `… 10` | FDIV |
| `0xFFFB` | `… 11` | FSQRT |
| `0xFFFC` | `111111111111110 0` | FEXP |
| `0xFFFD` | `… 1` | FLOG |
| `0xFFFE` | `1111111111111110` | FCMP |
| `0xFFFF` | — | HALT, never decoded |

### 6.2 Handler shape

Easier than the DIV handler in the one place that usually hurts: **there is
no operand decode and no dispatch**. The window is fixed, so the handler
reads the opcode, switches on the low bits, and the operands are at known
registers.

1. `MOV R3, LR` — the interrupted PC; store it.
2. `SMV R13, AR13` — `SP'` = caller's data stack.
3. Save caller `R4..R12` (they are both caller state and handler scratch
   space; the DIV handler does exactly this).
4. Read the caller's `F1` from `R4:R5` **before** reusing them, into
   scratch; read `F0` with `SMV Rx, AR2` / `SMV Rx, AR3`.
5. Call the routine.
6. Write the result with `SMV AR2, Rx` / `SMV AR3, Rx` (FCMP writes
   nothing; it uses `SAPF` instead).
7. Restore `R4..R12`, `RETI`.

The existing scaffolding is directly reusable: opcode fetch through the
caller's CS (`SMV R1, ACS` / `MVS DS`), the save/restore block, and the
"restore shared registers before writing a shared result" ordering.

**Implemented (P4).** `ill_handler` checks `0xFFF8..0xFFFE` before the normal
extended decode and jumps to `ill_fpu`. That routine reads `F0` with
`SMV R6, AR2` / `SMV R7, AR3`, reads the still-live `F1` from `R4:R5`, calls
`fadd32`/`fmul32`/`fdiv32`/`fsqrt32`/`fcmp32`, and writes the result with
`SMV AR2, R6` / `SMV AR3, R7`. FCMP leaves F0 alone and delivers its nibble
through `SAPF`. FEXP/FLOG call `fexp32`/`flog32` at `0x6000`. The routines and
the dispatch are position-independent: all internal calls and tail jumps use
PC-relative deltas, so the library can live above `0x4000` where `LDI`
sign-extends.

Build recipe: assemble `asm/forth_nano.asm`, `asm/softfloat.asm` and
`asm/forth_float.asm` with `CONSOLE_UART`, `D16NANO`, `FPU_KERNEL` and
`FPU_WORDS` defined. The library places itself at `0x5800`; the Forth words
place themselves at `0x417D`, and the float-literal scanner uses the free
`0x4330` gap, the `0x42EC` parse slot, the `0x48A9` probe slot and the tail
after `f.` for its build half. `scripts/make_image.mjs` does this whenever
`D16D` is set (or `D16NANO=1 D16SEG=1 FPU=1` for a test image), and
`js/deep16_d16d_image.js` appends the same sources when they are passed as
`softfloat` and `forthFloat`.

D16D relocation: the flash loader now copies `0x4A00..0x6FFF`, not
`0x4A00..0x57FF`. Flat `0x5800` therefore lands at physical `0x30E00`
(BIOS `CS=0x3000`, offset `0x0E00`). The library needs no per-label fixup:
its internal calls and tail jumps are PC-relative deltas, which are the same
at either origin. `tests/d16d-fpu.test.js` poisons the flat copy after the
scatter, so a pass proves the BIOS copy executed.

### 6.3 Register window

- `F0 = R2:R3`, `F1 = R4:R5` (IEEE single, R2 = high half).
- `F0` is banked: caller state lives in the normal bank, so the handler
  reaches it only through `SMV` — both directions exist since the write
  form landed.
- `F1` is shared: the handler must preserve it, hence the save.
- Consequence: a handler cannot keep anything in `F0`/`F1` across the trap,
  which is exactly what the spec means by a fixed window.

---

## 7. The soft-float library

### 7.1 Layering

| Layer | Contents | Tested by |
|---|---|---|
| 1 | Unpack/pack, add/sub magnitude, normalise, round | Direct unit tests |
| 2 | `fadd32`, `fsub32`, `fmul32`, `fdiv32`, `fsqrt32`, `fcmp32` | Direct unit tests + golden vectors |
| 3 | ILL handler dispatch | `tests/ill-trap.test.js` |
| 4 | Forth words: `f+ f- f* f/ fsqrt fnegate fabs f< f= f0< s>f f>s f@ f! fdup fdrop fswap fover f.` | `tests/forth-float.test.js` |

Layer 2 convention (documented per routine, plain subroutines, no trap):

```
; fadd32: A in R6:R7, B in R8:R9  ->  result in R6:R7
;         clobbers R0..R3, R10..R12; no memory; no Forth stack
```

Layer 3 marshals: caller `F0` → `R6:R7`, caller `F1` → `R8:R9`, result back
through `SMV`. Because layer 2 is memory-free and stack-free, it can be
unit-tested by loading registers and calling it.

### 7.2 Missing from the spec

- **No `FSUB`, `FNEG`, `FABS` opcodes.** They are software conventions. Fine
  — but they should be written down as such, and `fsub32` still needs to
  exist in the library.
- **No integer↔float conversion.** `i2f`/`f2i` are the first things real
  code needs; they must be in the library even though they have no opcode.

### 7.3 P3 implemented (2026-11)

`asm/softfloat.asm` now contains the layer-1 helpers (`f_unpack`, `f_pack`),
`i2f`/`u2f`/`f2i`, `fadd32`/`fsub32`, `fmul24`/`fmul32`, `fdiv32`, `fsqrt32`
and `fcmp32`. `tests/softfloat.test.js` checks:

- `i2f` and `u2f` exhaustively over all 65,536 inputs, and `i2f -> f2i`
  round-trips all 65,536 values;
- the `f2i` clamp/truncation table, including NaN, infinities and both zeros;
- 100 deterministic 24×24 mantissa products against a BigInt reference;
- FADD/FSUB/FMUL vectors (including +/-Inf, NaN, signed zero, overflow,
  underflow and the sub-ulp truncation cases) on the JS and RTL cores;
- FCMP vectors (signed order, infinities, zeros, NaN) plus 100 random finite
  pairs against JS ordering;
- FDIV vectors and 100 random finite pairs against an exact BigInt division
  reference, on JS and RTL;
- FSQRT vectors (including truncation at 10, 1.5, 1e9), 100 random positive
  normals, NaN/Inf/signed-zero cases, on JS and RTL.

Measured size: **1,498 words** from `f_unpack` through `fsqrt_ret`, or
**1,629 words** including the P4 dispatch, occupying `0x5800..0x5E5C`. The
non-D16D nano data-stack top is `0x5FF0`, so the library leaves about 403
words of headroom: usable for tests and shallow Forth code, but tight for a
deep stack. The D16SEG profile puts the data stack in SS=0x2000, which avoids
the collision but needs the slice loader.

D16D uses the D16SEG map: the return stack is at `0x2FF0`, the dictionary is
in PSRAM, and flat `0x5800` is free. The BIOS copy extension makes the whole
library reachable at `CS=0x3000` offset `0x0E00`; `checkImage` accepts a BIOS
that runs up to the `0x6000` window edge for an FPU image instead of stopping
at the `0x5800` return-stack base. `tests/d16d-fpu.test.js` covers FADD,
FMUL, FDIV, FSQRT, FCMP and a repeated trap through that path, and the flash
boot bench checks the `0x5800` word at physical `0x30E00`.

Subtraction is exact on both sides of the guard-bit boundary. The `d >= 24`
case returns the previous float below |A| directly; the `d < 24` case aligns A
to the smaller exponent, subtracts the full 48-bit value, and keeps the top 24
bits after normalisation. `tests/softfloat.test.js` includes close
subtractions across powers of two (`1 - nextbelow(1)`, `2 - nextbelow(2)`,
`3 - nextbelow(3)`, etc.) and 100 random finite pairs checked against a BigInt
truncating reference.

### 7.4 Forth surface

`asm/forth_float.asm` is appended after the library when `FPU_WORDS` is
defined. Its headers and main code live in the free `0x417D..0x42EB` gap, and
its headers link the oldest float word to `h_segbase`; `forth_wl` names
`h_fdot`. The `f.` printer starts at `fpu_lib_end` (above the library at
`0x5E5D`), and its CS-relative scratch cells sit in the free `0x1F3C..0x1F45`
gap so an `LDI` address reaches them without sign-extending.

The float-literal scanner is split so it does not touch any D16D code block:
the probe lives at `0x48A9` (below the BIOS/showcase), the scan/validate half
uses `0x4330..0x43FF`, the parse half `0x42EC..0x432F`, the low trampolines
`0x2D2F`, and the build half sits after `f.` in the tail. The scanner keeps
its state in fifteen cells it allocates on the data stack, so it needs no
fixed cell block, and it saves the caller's `R10` in the `0x18E7` cell. The
BAKE_PACMAN block also starts at `0x4330`, so `FPU` and `BAKE_PACMAN` are
mutually exclusive; the build says so instead of silently overwriting the
scanner.

A float is two cells with the high half on top, like the kernel's double-cell
words. `f+` reads B from `SP+0/1` and A from `SP+2/3`, puts them in
`F1`/`F0`, executes `FADD`, and leaves the result with its high half on top.
`f-` flips B's sign and uses `FADD`; `fsqrt` uses the trap; `fnegate`/`fabs`
just flip/clear the sign bit. The comparisons use `FCMP`, capture the PSW
with `LPSW` immediately (a `MOV` would clobber the flags), and test N/Z/V with
`AND` against a mask. `s>f`/`f>s` call `i2f`/`f2i` in the flat library
directly, since there is no conversion trap word.

`R5` is `>IN` and `R6` is `TIB`. Binary and comparison words park `>IN` in
`R9` across the trap, and `s>f`/`f>s` park `TIB` there around the direct
library call. `R8` (the cursor) is never touched. The words assume the
operands are present; they do not duplicate the kernel's underflow checks.

`f.` prints a sign, the integer part and exactly four fractional digits. It
uses `f2i`/`i2f` and the FADD/FMUL traps; the integer part is limited to the
signed-16-bit range, and nonzero values below `1e-4`; both use scientific
notation (`3.2768e4`, `1.6516e38`, `9.0000e-5`). The four printed fractional
digits are rounded half up, with a carry into the integer or exponent. NaN and
infinities
print `nan`/`inf`.

Float literals use `[-]digits[.digits][e[+/-]digits]`. The integer part is
limited to five digits and must fit 16 bits; the fraction is limited to nine,
and extra fraction digits are validated and ignored. Interpreted, the literal pushes its two cells (high on
top); compiled, it emits `LIT low LIT high`. Anything that does not match the
grammar falls back to the ordinary word scanner.

`FEXP`/`FLOG` are implemented by `fexp32`/`flog32` at `0x6000`: range
reduction plus a degree-5 polynomial for exp, and the atanh series for log.
The flash loader copies the same words to BIOS offset `0x1600`, so the ILL
handler can run them. `fexp`/`flog` are Forth words in the `0x417D` block.
`tests/forth-float.test.js` boots the D16SEG nano kernel and types real Forth
lines for every implemented word, including literals, `f.` and the shufflers.

---

## 8. Numeric policy — decide before coding

This paragraph determines several hundred lines of assembly. The spec does
not pin any of it.

| Question | Recommendation | Why |
|---|---|---|
| Denormals | Flush to zero on input and output | Denormal handling is the most expensive branch per operation, for a value range nobody will use here |
| NaN | One canonical quiet NaN (`0x7FC00000`); any NaN input produces it | Payload propagation is pointless without a payload consumer |
| Rounding | Truncate (round toward zero) | Nearest-even costs a guard/sticky analysis in every operation; truncation is one compare. Document the 1-ulp bias |
| Infinity | Generate and consume per IEEE | Cheap once NaN is canonical |
| Overflow / underflow flags | Not signalled; saturate to ±inf / ±0 | There is no exception mechanism to deliver them to |

If nearest-even is wanted later, it is a localised change in the rounding
step of `fadd32`/`fmul32`/`fdiv32`.

---

## 9. Cost

### 9.1 Cycles (estimates, 16-bit ALU, 32-bit single)

| Op | Cycles | at 6.75 MHz |
|---|---|---|
| Trap entry + exit | 100–150 | 15–22 µs |
| FCMP | 80–150 | 12–22 µs |
| FADD / FSUB | 250–450 | 37–67 µs |
| FMUL | 350–700 | 52–104 µs |
| FDIV | 700–1400 | 104–207 µs |
| FSQRT | 900–1800 | 133–267 µs |
| FEXP / FLOG | 2000–5000 | 0.30–0.74 ms |

The spec's table (~60 cycles FADD, ~150 FDIV) is optimistic by close to an
order of magnitude. The trap overhead is a minority of the total — which is
an argument that the trap is cheap and the library is the work.

Usable for teaching and demos; not for real-time.

### 9.2 Hardware

| Item | LUT | FF |
|---|---|---|
| `SAPF` × 4 cores | 10–20 each | 0 |
| Undefined-opcode trap | 15–25 each | 2 each |
| Handler + library | 0 | 0 |

The library is instruction space, not logic. On D16MINI the boot image is
range-packed into 16 BSRAM blocks (BSRAM 20/26 overall) with the dictionary
in PSRAM, so a library of a few hundred to a couple of thousand words
probably fits — but it is not free and must be measured. On the nano the
kernel is loaded at `0x5000`, so it competes with the demo area there.

---

## 10. Bugs found in `doc/Deep16-FPU.md`

1. **§9.4 does not assemble.** `XOR R4, 0x8000` is rejected — `XOR`'s
   immediate is a bit *index* (0–15), so negation is `XOR R4, 15`. And
   `AND R2, 0x7FFF` is rejected — `AND` has no immediate form (that slot is
   `CLRB`); clearing the sign is `CLRB R2, 15`. Both verified against the
   assembler.
2. **§2.3 invents a CPU configuration register at `0xF0010`.** It is not in
   `MEMMAP.md` and is not backed by anything.
3. **§1.2 cycle estimates** are aspirational (§9.1).
4. **No conversions** between integer and float (§7.2).
5. **`FSUB`/`FNEG`/`FABS`** are presented alongside real opcodes without a
   clear "software convention" marker.

---

## 11. Phases

| Phase | Work | Exit criterion |
|---|---|---|
| P0 | `SAPF` in assembler, disassembler, both RTL cores, JS, WASM; arch doc | Encoding tests + a shadow-bank test that `SAPF` sets the restored flags |
| P1 | **Done.** General undefined-opcode trap in all four cores | A reserved word traps on every core; double fault is diagnosable |
| P2 | **Done.** `SAPF` in the DIV/DIV32 handler (§4) | `tests/ill-trap.test.js` covers zero, negative and positive quotients for DIV and DIV32 |
| P3 | **Done.** Layer 1 + `i2f`/`u2f`/`f2i`/FADD/FSUB/FMUL/FDIV/FSQRT/FCMP in `asm/softfloat.asm` | `tests/softfloat.test.js` passes: exhaustive conversions and round trip, `f2i` boundaries, randomized FSUB/FDIV/FSQRT/FMUL references, and JS+RTL vectors for every arithmetic operation |
| P4 | **Done, including D16D.** FPU decode + dispatch in the ILL handler (FADD/FMUL/FDIV/FSQRT/FCMP; FSUB by sign flip) and the Forth surface | `tests/ill-fpu.test.js` covers the flat nano kernel; `tests/d16d-fpu.test.js` covers the BIOS-segment path with the flat copy poisoned; `tests/forth-float.test.js` types every Forth word; the flash boot bench checks the library copy |
| P5 | **Done.** FDIV/FSQRT dispatch (same handler) | `tests/ill-fpu.test.js` covers both |
| P6 | FEXP, FLOG: `fexp32`/`flog32` at 0x6000 plus `fexp`/`flog` words | `tests/ill-fpu.test.js` and `tests/d16d-fpu.test.js` cover the trap; `tests/forth-float.test.js` types the words |

P0–P2 are independent of the FPU and fix real defects. P3 is the long pole
and can proceed in parallel with them.

---

## 12. Test plan

- **Encoding**: `SAPF` assembles to `0xFFF6` and round-trips through the
  disassembler; assembler rejects operands.
- **SAPF semantics**: set the shadow `R0` nibble, trap, `SAPF`, `RETI`, then
  branch on each of N/Z/V/C in the caller. Four cases plus "unchanged".
- **Reserved-opcode trap**: execute `0xFFF8..0xFFFE` and assert vector 0 is
  taken and `LR-1` points at the trapped word, on all four cores.
- **DIV flags**: the three flag cases of §4.4, nano vs full core.
- **Soft float**: golden vectors. `Math.fround` gives exact single-precision
  rounding, so the expected bit patterns can be generated from JS doubles
  and compared exactly — including carry/rounding edge cases
  (`0x7F7FFFFF + tiny`, cancellation, sign of zero).
- **Parity**: JS / WASM / core3 must agree bit-for-bit on every vector.
- **Trap end-to-end**: a program using `FADD` produces the same result and
  flags on the nano (trapped) and the full D16 (trapped) — and, if the
  library is reachable, the same as a direct call.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Soft-float bugs only reproduce inside a trap, whose failure mode is a reset | D4: layers 1–2 are plain subroutines, tested directly |
| Three cores diverge on trap semantics | One shared test vector file, all cores |
| `SAPF` nibble clobbered by the dispatch helper | Park it on the caller's stack (§3.5); test it |
| IEEE edge cases balloon the code | Decide §8 first, write it into the spec |
| FPU work delays the real targets (timer, raster IRQ) | P0–P2 are small and independent; P3+ can wait |

---

## 14. Open questions

1. **Scope**: FADD/FSUB/FMUL/FCMP first, FDIV/FSQRT later, FEXP/FLOG never?
   The transcendentals are more code than everything else combined and can
   be built from the others in Forth when someone wants them.
2. **Does the full D16 get the trap?** If not, the same source silently
   NOPs there — the exact bug we are fixing.
3. **Numeric policy** (§8): flush-to-zero denormals, canonical NaN,
   truncating rounding — accept, or amend?
4. **Assembler mnemonics**: implemented. `FADD`/`FMUL`/`FDIV`/`FSQRT`/`FEXP`/
   `FLOG`/`FCMP` assemble to their trap words and disassemble back.
5. **Forth surface**: implemented for arithmetic, comparisons, conversions,
   memory, the stack shufflers, `f.` printing and float literal tokens.
