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
(`ILLTRAP.md`) and nothing else in the 65,536-word space is free — §14.1
audits the 30 architecturally dead sub-cases and says why they are deliberately
not reclaimed.

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
result = V >> (15 - u)         ; count in [1,15] -> p2 index 16-n, see 5.2
```

`R6` is already in `[0x80,0xFF]` after unpacking, so the shift left needs no
mask. Checks: `1.9999 × 2^14` → `V = 0xFFFF`, shift 1 → `0x7FFF` = 32767;
`1.5 × 2^8` → `V = 0xC000`, shift 7 → 384; `u = 0` → shift 15 → 0 or 1.

### 5.2 The variable shift — `MUL32` is the barrel shifter

`SR Rd, count` takes an immediate, so `V >> (15 - u)` cannot be a single
instruction. But the ISA already has a variable shifter: the multiplier.
`MUL32 R[d]:R[d+1]` is 16×16→32 with the **high** half in `R[d]`
(`rtl/deep16_alu.sv:209-220`, odd `Rd` refused), so

```
x >> n  ==  MUL32 R6:R7 = x * p2[16-n]     ; answer is already in R6
x << n  ==  MUL32 R6:R7 = x * p2[n]        ; answer is in R7
```

with a 16-word table `p2 = 2^0 .. 2^15`, indexed by `ADD Rt, n` (the 4-bit
immediate covers 0..15 exactly) followed by `LD Rt2, [Rt]`.

The ranges match by a coincidence worth writing down: the left shift indexes
with `n`, the right shift with `16 - n`, and *this* routine's count is
`15 - u` ∈ **[1,15]**, so `16 - n` ∈ **[1,15]** too. The one entry a 16-word
table cannot hold — `2^16`, a right shift by 0 — is never asked for. So there
is no `n = 0` special case and no overflow.
≈ 4 words and ≈ 5 cycles, and the library gets *smaller*, which is the
resource the nano is actually short of (26/26 BSRAM). Details and the limits
in §14.2.

Superseded: the earlier proposal was a `shr16v`/`shl16v` loop (≈ 20 words,
≈ 30 cycles). Keep that shape only where the count is **not** known in
advance — normalising an add/sub result, where the count is the thing being
searched for; a 4/2/1 ladder (§3) is the right form there.

This is the ISA property to write down: **there is no shift-by-register**, so
every variable shift in the library is a multiply, a ladder or a loop — and
there should be exactly one implementation of each shape.

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
| `mulshift` | `R6:R7 ← R6:R7 × p2[n]`, i.e. a variable shift (§14.2) | `f2i`, `fadd32` alignment |
| `p2` | 16-word table `2^0..2^15`, the `mulshift` operand | `mulshift` |
| `clz24` | leading-zero count of `mant24` (table in the MINI build, ladder in the nano build, §14.3) | normalise, `f_pack` |
| `ladder` | 8/4/2/1 fixed-step normalise, shared with `i2f` §3 | `i2f`, `fadd32`, `fmul32` |

This is the layer-1 split `FPUEMUPLAN.md` §7.1 already calls for; the
conversions are thin wrappers over `f_pack`/`f_unpack`, which is why they are a
good first thing to write — they force the helpers into existence with a
cheap, exactly-checkable result.

## 8. Cost (estimated, 6.75 MHz core3)

| Routine | Cycles | Notes |
|---|---|---|
| `i2f` / `u2f` | 25–40 | ladder, exact, no loop |
| `f2i` | 45–70 | shift is one `MUL32` (§14.2); saturating cases are faster |

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
* `mulshift`, exhaustive: all 65,536 values × counts 0..15 for the left form
  and 1..15 for the right form, against JS `<<`/`>>>`. It is three
  instructions and the whole library's correctness rests on it, so it gets the
  full grid rather than a sample.

The routines live in `asm/` so JS and RTL share one source. Feeding them from
a test harness means the assembler, simulator and RTL all agree on the
encoding before the first FPU opcode is wired.

## 10. Phases

| Phase | Work | Exit criterion |
|---|---|---|
| C0 | `f_unpack` / `f_pack` / `mulshift`+`p2` / `clz24` | unit tests against JS bit operations |
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
7. **`clz24`: table or ladder?** The byte table is smaller and faster on
   D16MINI (39,000 free dictionary words) and costs half a BSRAM block on the
   nano, where the ladder wins. Decide whether that is a build-time
   conditional in the assembler or two routines selected by the kernel
   (§14.3).
8. **Reclaim the dead words?** The 8 odd-Rx `JML` words and 22 `SET`/`CLR`
   words on reserved PSW bits are architecturally dead (§14.1). Recommendation:
   do not reclaim them now — make them ILL, and only consider spending them if
   measurement shows a single instruction beats the software alternatives. If
   anything is ever taken, take **one** word for a hardware `CLZ`, not a set.
9. **Does the nano get `mulshift`?** It needs a 16-word writable table `p2`.
   That is trivial, but it must be placed where the packed image does not pay a
   BSRAM block for it (§14.2).

## 14. The encoding space is full — speedups that need no opcode

Context: the closely related ideas (a `CLZ` instruction, a 24-bit normaliser)
would need new opcodes, and there appear to be none. This section records the
audit and the alternatives, because the correct conclusion is not "therefore
soft-float cannot get faster".

### 14.1 Audit: the prefix code is complete

The instruction hierarchy is a full prefix tree — every one of the 65,536
words decodes to something:

| Class | Range | Words |
|---|---|---|
| `LDI` | `0000..7FFF` | 32,768 |
| `LD`/`ST` | `8000..BFFF` | 16,384 |
| ALU | `C000..DFFF` | 8,192 |
| `Jcc` | `E000..EFFF` | 4,096 |
| `LDS`/`STS` | `F000..F7FF` | 2,048 |
| `MOV` | `F800..FBFF` | 1,024 |
| `LSI` | `FC00..FDFF` | 512 |
| `SMV` | `FE00..FEFF` | 256 |
| `MVS` | `FF00..FF7F` | 128 |
| `SOP` | `FF80..FFBF` | 64 |
| `SET`/`CLR` | `FFC0..FFDF` | 32 |
| `JML` | `FFE0..FFEF` | 16 |
| `SYS` | `FFF0..FFF7` | 8 |
| FPU + `HALT` | `FFF8..FFFF` | 8 |
| **total** | | **65,536** |

And the sub-spaces are full too: all 32 `func5` slots are used
(`rtl/deep16_alu.sv:85-245`), mostly as reg/imm pairs — which is why `AND` has
no immediate form — plus all 4 `MOV` `imm2` functions and all 16 `SMV`
selectors after the `SMV ARy,Rx` change. So there is no clean word to take.

What *is* dead is a small number of sub-cases:

| Dead encoding | Count | Evidence |
|---|---|---|
| `JML` with odd `Rx` | **8** (`FFE1, FFE3 … FFEF`) | `rtl/deep16_core3.sv:723-733` decodes it, then `if (!f_rx[0])` — an odd `Rx` does nothing at all |
| `SET`/`CLR` on PSW bits 6–15 | 20 | PSW defines only `N,Z,V,C,I,S` = bits 0–5 (`rtl/deep16_pkg.sv:23-28`); the RTL still writes bits 6–15 |
| `SET`/`CLR` on the `S` flag | 2 | `deep16_core3.sv:716` explicitly skips `imm4 == 4` |

That is 30 words out of 65,536, i.e. 0.05 %. Only the 8 `JML` words are
contiguous and unambiguously ignored; the other 22 change the meaning of
`SET 9`, which is a bad look for an assembler.

Recommendation: **do not spend them on float ops.** Eight words cannot hold a
float ISA (the trap range already has seven), and reusing odd-`Rx` `JML` means
a plausible bug (`JML R3`) silently becomes a different instruction — the same
argument that produced `NIO` (`ILLTRAP.md`). Make them trap as ILL instead,
so the holes are honest, and leave the words alone unless a measurement later
justifies exactly one of them.

### 14.2 `MUL32` is already a barrel shifter

`MUL32 R[d]:R[d+1]` is 16×16→32 with the high half in `R[d]`
(`rtl/deep16_alu.sv:209-220`), so multiply-by-`2^n` is a variable shift:

| Operation | Sequence | Result |
|---|---|---|
| `x >> n` | `ADD Rt, n` … `LD Rt2, [Rt]` … `MUL32 R6:R7 = x × p2[16-n]` | `R6` |
| `x << n` | same with `p2[n]` | `R7` |

`p2` is a 16-word table `2^0..2^15`; the 4-bit `ADD` immediate covers index
0..15 exactly, and `LD Rd, [Rb+off5]` reaches it with `off5 = 0`. ≈ 4 words,
≈ 5 cycles, against ≈ 20 words / ≈ 30 cycles for the loop in the earlier plan
— *and the library gets smaller*, which is the resource the nano is short of
(26/26 BSRAM).

Applied to the library:

* **`f2i`** — count `15-u` ∈ [1,15], so `16-n` ∈ [1,15]: the table range
  matches the required range exactly. No `n = 0` case, no `2^16` overflow,
  and the answer lands in `R6`, which is where `f2i` wants it (`FLOATIMPL` §5.1).
* **`fadd32` alignment** — the count is the exponent difference, so it is
  known. A 24-bit mantissa is a two-word shift: `mulshift` each 16-bit half
  and OR in the fixed 8-bit cross term (the same shape as §5.1's
  `V = (R6<<8)|(R7>>8)`). For `d >= 16` the high half drops out; for `d >= 24`
  the operand contributes nothing. ≈ 2 multiplies, no loop.
* **Normalising a result** — *not* solvable this way. The shift count is the
  unknown being searched for, and `mulshift` needs the count to index the
  table. That case stays a 4/2/1 ladder, shared with `i2f` (§3).

So `mulshift` replaces `shr16v`/`shl16v` for the two data-dependent shifts
that have a known count, and leaves exactly one ladder for the one that does
not. Cost: 16 words of writable data memory for `p2`. Trivial on D16MINI;
on the nano it must not cost a BSRAM block at the packed-image boundary.

### 14.3 `CLZ` as a table, not an instruction

A 256-entry leading-zero table turns `clz24` into three indexed loads (top
byte, next, next) with no branches: ≈ 10 cycles, ≈ 12 words of code, **zero
encodings**. The resource trade is machine-dependent, and that is the point:

| Build | Implementation | Why |
|---|---|---|
| D16MINI | 256-word table | 39,000 free dictionary words; memory is the cheap resource |
| D16nano packed | 4/2/1 ladder | a 256-word table needs a BSRAM block (blocks are allocated whole, so half is wasted) and the build is at 26/26 |

Same algorithm, two implementations, chosen per build (open question §13.7).
This is the general answer to "no opcode": convert the missing instruction
into a data-memory lookup, because memory is the resource you actually have.

### 14.4 Remove the trap

On the nano, 100–150 of FADD's ~300 cycles *is* trap entry, save/restore and
`RETI`. Since the interface is a Forth word rather than an instruction,
compiling `f+` as an inline or threaded subroutine removes that overhead
entirely — roughly 3× on the nano, for zero encodings. The trap is only
needed for the compatibility story: an unmodified binary running on a machine
that does not have the library.

### 14.5 Fill the delay slots

The ladder is `CMP / JC / NOP / SL` because a conditional shift cannot live in
a delay slot (§3), but the delay-slot `NOP` *does* execute on both paths, so it
can carry the shift's setup work instead. An estimated 10–15 % across the
library, no encoding.

### 14.6 Fixed point

§12 stands, and the encoding argument strengthens it: 16.16 needs `MUL32` and
a fixed shift, ≈ 6 cycles against ≈ 300, and no opcode. If the floats serve a
game or demo path rather than IEEE compatibility, this is a 50× answer that
the coding space cannot block.

### 14.7 Why an opcode is nearly worthless here

Two facts make "no encoding space" much less painful than it sounds.

1. **The FPU range is software-defined.** The CPU traps on `FFF8..FFFE` and
   the handler reads the word at `LR-1`; the "seven opcodes" are a dispatcher
   convention (`FPUEMUPLAN.md`), not hardware. Nothing stops the handler from
   reading the *following* word as a selector and stepping `LR` over it:
   that is 65,536 software-defined operations with no RTL change. The cost is
   2 words per operation and the trap — which §14.4 removes anyway.
2. **An opcode buys one word and no `CALL`/`RET`.** At the Forth level `f+` is
   already one word, so the saving is negligible. Opcodes matter for
   *portability of binaries*, which is what the seven trap words already give.

And when speed is the goal, encoding space is irrelevant to that too:

* **Memory-mapped coprocessor.** `0xF0000..0xF1FFF` is the I/O page, uncached
  by design (`rtl/deep16_cache.sv:10-17`), with the UART already at
  `0x0F0040` (`rtl/deep16_pkg.sv:17-20`). Store operands, load the result:
  ≈ 2 memory accesses, no ISA change, no cache-coherence question, and the
  seven trap words stay as the portable interface. This is the only route to
  hardware speed that spends zero encodings.
* **`FSH` as a prefix** would give unbounded space (one mnemonic, 65,536
  extensions, like x86), and it is tempting: nothing in `asm/` emits it and
  the JS core already treats `0xFFF1` as a no-op (`rtl/deep16_pkg.sv:6-7`).
  But the RTL uses it to invalidate the cache after code is overwritten
  (`rtl/deep16_core.sv:729`, `rtl/deep16_cache.sv:16`), so taking it means
  relocating that guarantee first. Available, not free.

### 14.8 What to do

1. Do **not** spend the 30 dead words on float ops; make odd-`Rx` `JML` and
   `SET`/`CLR` on reserved PSW bits trap as ILL, consistent with `NIO`.
2. Implement `mulshift` + `p2` (§14.2). It replaces the `shr16v`/`shl16v`
   loops, is faster *and* smaller, and shrinks the nano's binding constraint.
3. `clz24`: table on D16MINI, ladder on the nano (§14.3).
4. Fill the delay slots (§14.5); inline the hot words instead of trapping
   (§14.4).
5. Measure. Only if normalisation still dominates, spend **one** dead word on
   a hardware `CLZ` — one, not a set.
6. Keep fixed point (§14.6) as the deliberate choice for demo-class numerics.

Honest limit: none of this gets FADD below roughly 60–80 cycles at 6.75 MHz
(≈ 10 µs). Removing loops and the trap moves soft-float from ~44 µs to
~10 µs; only a hardware unit moves it to ~1 µs, and that arrives through the
I/O page or a 20K build's fabric, not through an opcode.
