# Integer ↔ float conversion

Status: **design note, nothing implemented.** `FPUEMUPLAN.md` §7.2 records that
the FPU specification has no conversions at all. This note fixes the ABI, the
algorithms, the edge cases and the test strategy *before* any arithmetic is
written, because every float operation downstream depends on them.

Companion documents: `FPUEMUPLAN.md` (FPU trap, `SAPF`, phases),
`ILLTRAP.md` (trap mechanics, `NIO`), `doc/Deep16-FPU.md` (the specification
being corrected).

## 1. Encoding: conversions get no opcode

The trap range is full. `cls = 5, ext_id = 10` is "twelve leading ones that
are not a SYS word" (`rtl/deep16_core3.sv:111-130`), i.e. `0xFFF8..0xFFFF`, and
`0xFFFF` is HALT. `doc/Deep16-FPU.md` §3.1 then spends all seven surviving
words on its nested prefix scheme: FADD/FMUL/FDIV/FSQRT at `...1000..1011`,
FEXP/FLOG at `...1100/1101`, FCMP at `...1110`. `0xFFF7` becomes `NIO`
(`ILLTRAP.md`) and nothing else in the 65,536-word space is free.

So conversions are **library subroutines**, not opcodes, and they join
`fsub32`, `fneg` and `fabs` as documented software conventions (FPUEMUPLAN
§7.2). Three reasons this is not a compromise:

* A subroutine is **faster** than a trap: CALL + body ≈ 60 cycles against
  100–150 for trap entry, save/restore and exit.
* It needs no `SAPF`. A subroutine sets `N`/`Z`/`V` with the ordinary one-word
  `SETV` / `CLRV` / `SETC` instructions (`Arch` Table 10, `0xFFC0..0xFFDF`);
  `SAPF` exists only because a trapped operation must hand flags back through
  the shadow PSW.
* It keeps the story "the FPU opcode set is exactly seven words" true.

Cost: one `CALL` at the call site (plus a `RET` in the routine) instead of one
word in place. At the call site that is two words either way, and the routine
body is shared.

## 2. ABI — freeze this before writing code

| Routine | Input | Output | Flags | Scratch |
|---|---|---|---|---|
| `i2f` | `R0`, signed 16-bit | `F0 = R2:R3` | none | `R0`, `R1` |
| `u2f` | `R0`, unsigned 16-bit | `F0 = R2:R3` | none | `R0`, `R1` |
| `f2i` | `F0 = R2:R3` | `R0`, signed 16-bit | `N`, `Z`, `V` = clamped | `R0`, `R1`, `R6` |

`R4..R12` are preserved. **No memory, no stack, no `DIV`** (see §6). Every
routine is re-entrant and callable from inside the ILL handler.

Why `R0` for the integer port: it is already the handler's scratch/return
register (`ill_put_dispatch` clobbers `R0..R3`), and `LDI R0, n; CALL i2f`
reads correctly. Why `F0` for the float port: a conversion feeds `f+` with no
shuffling, and `F0` is the accumulator by definition.

**`R2` is the high half.** This is not a new convention:

* `doc/Deep16-FPU.md:197-199` already writes `LDI 0x3F80 ; high word` then
  `MOV R2, R0`,
* `rtl/deep16_alu.sv:215` writes `prod32[31:16]` to `R[d]` for
  `MUL32 R[d]:R[d+1]`.

So float pairs and MUL32 pairs share one layout, which `fmul32` depends on.
(`DIV32` is *not* a word pair — it is quotient in `R[d]`, remainder in
`R[d+1]` — so do not treat it as one.)

Both routines are register-only on purpose. The handler runs with the caller's
`SS` after `SMV R13, AR13`, so a push inside a conversion would land on the
*caller's* stack: legal, but a source of bugs that a stack-free routine simply
does not have.

## 3. `i2f` is exact — exploit it

Every 16-bit integer fits in float32's 24-bit significand. Therefore:

* there is no rounding question, and no inexact flag;
* `f2i(i2f(x)) == x` for all 65,536 values, which is a free exhaustive test.

Algorithm, ~25–35 cycles, no loop. `SL Rd, count` takes a **4-bit immediate**
(`Arch` Table 7), which is exactly what the classic shift ladder wants:

```
; R0 = x
  MOV  R1, R0
  CLR  <sign>                  ; sign = x < 0
  ; if negative: R1 = 0 - R0  (unsigned magnitude; works for 0x8000), sign = 1
  MOV  R3, 0                   ; R3 = k (shift count applied)
  CMP  R1, 0x0100  / JC  +8    ; if R1 < 0x0100: SL R1,8 ; ADD R3,8
  CMP  R1, 0x1000  / JC  +4    ; if R1 < 0x1000: SL R1,4 ; ADD R3,4
  CMP  R1, 0x4000  / JC  +2    ; if R1 < 0x4000: SL R1,2 ; ADD R3,2
  CMP  R1, 0x8000  / JC  +1    ; if R1 < 0x8000: SL R1,1 ; ADD R3,1
  ; now m = R1 in [0x8000,0xFFFF], unbiased exponent = 15 - k
```

Then pack:

```
  R3 = (m & 0x7FFF) << 8                       ; mantissa low half
  R2 = sign | (((15 - k + 127) << 7))          ; exponent, biased
     | ((m & 0x7FFF) >> 8)                     ; mantissa high half
```

`& 0x7FFF` is `CLRB Rd, 15` in this ISA. The exponent field `e << 7` peaks at
142 × 128 = `0x4700`, so it never reaches bit 15 and the sign ORs on cleanly.

Sanity checks: `x = 1` → `m = 0x8000`, `k = 15`, `e = 127`, mantissa 0 →
`0x3F800000`. `x = -32768` → `m = 0x8000`, `k = 0`, `e = 142`, sign →
`0xC7000000`.

Two implementation traps:

1. **`-32768`.** Negating it as a *signed* value overflows to itself. Take the
   magnitude as **unsigned** (`0 - x` yields `0x8000` with `C = 1`) and never
   branch on `V`.
2. **Branch delay slots.** `Jcc` consumes a delay slot (`Arch` Table 11), and
   a delay-slot instruction executes whether or not the branch is taken, so
   the conditional shift cannot live there. Each ladder step is
   `CMP / JC / NOP / SL / ADD` = 5 words. Four steps ≈ 20 words, ~20 cycles.
   That is the code-size price of the branchy form; it is still smaller and
   faster than a 15-iteration shift loop.

## 4. `u2f`

The same body without the sign step: sign = 0, magnitude = `R0`. Normalisation
and packing are identical, so it is a second entry point into the same code
(3–4 extra words), not a separate routine. Worth having: addresses and
unsigned counters are the natural inputs to a printer.

## 5. `f2i`

Truncate-toward-zero is the cheap policy *because* it is sign-magnitude:
shift the magnitude, then apply the sign. Round-to-nearest or floor would need
rounding logic in the middle of the shift, which is a real cost on this ISA.
The numeric policy in `FPUEMUPLAN.md` §8 therefore already picked the
implementation with the lowest price.

### 5.1 Range split — the useful reduction

Let `u = e - 127` be the unbiased exponent and `mant24 = 0x800000 | mantissa`
in `[0x800000, 0xFFFFFF]` (`R6` = bits 23..16, `R7` = bits 15..0).

| condition | result | note |
|---|---|---|
| `e == 0` (zero/denormal) | `0` | denormals are flushed by policy |
| `e == 255` | NaN → `0`; `±Inf` → clamp | see §5.3 |
| `u < 0` | `0` | `abs(x) < 1` |
| `u >= 15` | **saturate, never shift** | only `-32768.0` is exact |
| `0 <= u <= 14` | `V >> (15 - u)` | the only shifting case |

and for that last case the 24-bit shift collapses to a 16-bit one:

```
V = (R6 << 8) | (R7 >> 8)      ; bits 23..8 of mant24, one cross-word step
result = V >> (15 - u)         ; count in [1,15] - fits the 4-bit field
```

`R6` is already in `[0x80,0xFF]` after unpacking, so the shift left needs no
mask. Checks: `1.9999 × 2^14` → `V = 0xFFFF`, shift 1 → `0x7FFF` = 32767;
`1.5 × 2^8` → `V = 0xC000`, shift 7 → 384; `u = 0` → shift 15 → 0 or 1.

### 5.2 The variable shift is the real difficulty

`SR Rd, count` also takes an immediate, so `V >> (15 - u)` cannot be a single
instruction. Two options:

* **Shared helper `shr16v`** (recommended): value in `R6`, count in `R1`.
  Shift 8 at a time, then 1 at a time, so at most 8 loop iterations.
  ≈ 20 words, ≈ 30 cycles worst case, and it is reused by the post-rounding
  normalisation in `fadd32`/`fmul32`, so it pays for itself twice more.
* **15-entry jump table** dispatched by `JML R6` (`Arch`: `JML Rx`, Rx even),
  O(1) but ≈ 45 words and a table to maintain.

Either way, this is an ISA property to write down: **there is no
shift-by-register**, so every variable shift in the library is a loop or a
table, and there should be exactly one of each shape.

### 5.3 Saturation and flags

| input | `R0` | `V` |
|---|---|---|
| NaN | `0` | 1 |
| `+Inf`, or `x >= 32768.0` | `32767` | 1 |
| `32767.9` | `32767` | 0 |
| `-32768.0` exactly | `-32768` | **0** |
| `x < -32768.0`, `-Inf` | `-32768` | 1 |
| `-0.0`, `±0.999...` | `0` | 0 |
| denormal | `0` | 0 |

`N` and `Z` come from the result as usual (`N = R0[15]`, `Z = R0 == 0`). `V`
means "the value was not representable and was clamped" — a property of the
result, not an IEEE exception record, so it does not conflict with the "no
exception flags" policy in §8 of the plan.

`C` is left alone in v1. If an "inexact" indication is ever wanted it belongs
in `C`, and it is two words — but **decide now that `C` is not inexact** so
tests do not encode the opposite. See §13.

`-32768.0` deserves its own test: it is the only value with `u = 15` that is
exact (`mant24 == 0x800000`, sign set), and the only case where "saturate at
`u >= 15`" must not fire.

## 6. Constraints the implementer will trip on

1. **No `DIV` / `DIV32` anywhere in the library.** On D16nano those trap; a
   divide inside the ILL handler re-traps and is a double fault. `f2i` looks
   like a natural place for a divide — it is not. Shifts and `MUL32` only
   (`MUL32` does not trap). `div16_call` already lives under this restriction;
   copy its idioms.
2. **Immediate-only shift counts** (§5.2).
3. **`-32768` cannot be negated as a signed value** (§3).
4. **Truncation must be sign-magnitude**, not "convert, then negate a signed
   intermediate" — the magnitude path is the one that reaches `0x8000`.
5. **No stack.** The handler's `SS` is the caller's.
6. **`CALL`/`RET` are register-window-neutral**, so a conversion can be called
   from normal code and from `ill_handler` without a second entry point.

## 7. Shared helpers to build first

| Helper | Purpose | Reused by |
|---|---|---|
| `f_unpack` | pair → sign, exponent, `mant24` in `R6:R7` | `f2i`, `fadd32`, `fmul32`, `fcmp32`, the printer |
| `f_pack` | sign, exponent, `mant24` → pair, with flush/NaN rules | `i2f`, `fadd32`, `fmul32`, `fdiv32` |
| `shr16v` | `R6 >>= R1` | `f2i`, post-rounding normalisation |
| `shl16v` | `R6 <<= R1` | post-rounding normalisation |

This is the layer-1 split `FPUEMUPLAN.md` §7.1 already calls for; the
conversions are thin wrappers over `f_pack`/`f_unpack`, which is why they are a
good first thing to write — they force the helpers into existence with a
cheap, exactly-checkable result.

## 8. Cost (estimated, 6.75 MHz core3)

| Routine | Cycles | Notes |
|---|---|---|
| `i2f` / `u2f` | 25–40 | ladder, exact, no loop |
| `f2i` | 60–90 | includes `shr16v`; saturating cases are faster |

Plus `CALL`/`RET` at the call site. These are the numbers that make the FPU
usable or not, so measure them rather than trusting the table.

## 9. Tests

All conversions are tested as **plain subroutines** — no trap, no FPU, no
board. This is the first thing that can be verified end to end.

* `i2f`, exhaustive: 65,536 signed and 65,536 unsigned values. One assembly
  loop writes results into a buffer; the JS test compares word for word
  against `Math.fround` / `DataView`. The same `.asm` runs on the RTL model and
  the buffer is diffed.
* Round trip, exhaustive: `f2i(i2f(x)) == x` for every `x`.
* `f2i`, table: every row of §5.3, both signs of zero, the largest denormal,
  `2^15` and `2^15 - 1 ulp`, all 256 exponents with a few mantissas each, plus
  a random slice.
* `f2i` invariant: no value in `[-32768.0, 32767.0]` may set `V`.
* `f2i` truncation direction: `0.9999 → 0`, `-0.9999 → 0`, `-1.9999 → -1`
  (toward zero, not floor).
* Register hygiene: `R4..R12` unchanged across every routine (the layer-2
  harness checks this once and applies to all routines).

The routines live in `asm/` so JS and RTL share one source. Feeding them from
a test harness means the assembler, simulator and RTL all agree on the
encoding before the first FPU opcode is wired.

## 10. Phases

| Phase | Work | Exit criterion |
|---|---|---|
| C0 | `f_unpack` / `f_pack` / `shr16v` / `shl16v` | unit tests against JS bit operations |
| C1 | `i2f`, `u2f` | exhaustive against `Math.fround` on JS and RTL |
| C2 | `f2i` | boundary table + invariant + round trip |
| C3 | wire into `fadd32` golden vectors | FADD vectors readable, no hand-built patterns |
| C4 | Forth words `s>f`, `f>s`, `u>f` | dictionary test |

C1 is also the cheapest way to find out whether the `SL` ladder and the
`-32768` path are right, which is why it comes before any arithmetic.

## 11. Doc debt this touches

`doc/Deep16-FPU.md` needs a **§3.4 Conversions (software conventions, no
opcode)** with the ABI, the saturation table and the flag rules, plus these
existing defects which the conversion work runs straight into:

* §9.4 does not assemble (`XOR R4, 0x8000` — `XOR`'s immediate is a bit index;
  `AND R2, 0x7FFF` — `AND` has no immediate form, use `CLRB Rd, 15`).
* §9.2 says FCMP "uses R0:R1 and R2:R3", contradicting the fixed window
  `F0 = R2:R3`, `F1 = R4:R5` in §2.1. The window is the one that is real.
* §2.3's configuration register at `0xF0010` does not exist.
* §1.2's cycle estimates are an order of magnitude optimistic.

## 12. The alternative worth a decision, not a default

On a 6.75 MHz machine `fadd32` at ~300 cycles is ~44 µs. If the FPU exists to
serve a game or demo path rather than IEEE compatibility, **16.16 fixed point**
is 3–5× cheaper, exact, and has no NaN, denormal or saturation questions — one
`MUL32` and a shift. Float32 buys dynamic range and keeps the existing
specification text. This is much harder to change after the arithmetic exists
than before, so it should be an explicit decision rather than an inheritance.

## 13. Open questions

1. **`f2i` flags**: `V` only (recommended, and what §5.3 assumes), or `V` plus
   `C = inexact`? Decide before the tests, because the tests encode it.
2. **NaN → `0` or NaN → `32767`?** §5.3 assumes `0`; the alternative is
   "largest negative / largest positive" style saturation. It must match what
   `F.` does when it prints a NaN.
3. **`u2f` / `f2u` in v1?** Recommendation: ship `u2f` (free, same body) and
   defer `f2u` until a consumer exists.
4. **Where does the code live?** D16MINI has PSRAM and ~39,000 free dictionary
   words, so the library is free there. The D16nano packed image is at 26/26
   BSRAM: ~100 words of conversion plus ~1–2k words of arithmetic may not fit
   at all, which would make the FPU D16MINI-only, or force the nano onto the
   user-flash loader. Measure before promising the nano an FPU.
5. **32-bit integers.** `d2f`/`f2d` are the only conversions where rounding is
   observable (32 bits do not fit a 24-bit significand). Defer them, but say
   so in the spec, because `MUL32`/`DIV32` make double-cell values real on this
   machine.
6. **Printer.** Decimal `F.` needs the exponent/mantissa split, not `f2i` — a
   value like `1e9` has no 16-bit integer form. `f_unpack` is shared; the
   scaling loop is not. Confirm that the printer is a separate routine before
   claiming `f2i` "completes" the float story.
