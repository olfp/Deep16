# OPTIMIZE — the Deep16 peephole optimizer

`js/deep16_optimizer.js` rewrites Deep16 assembly so that idioms which need
two or more instructions become the single instruction the ISA already
provides for them. It reads assembly text and writes assembly text: labels
stay symbolic, so the existing two-pass assembler re-resolves every offset
after a deletion. It never touches a memory image, the simulator, or a loaded
program.

The instruction it leans on most is the `MOV imm2` function select
(`doc/ARCHREV.md`):

| imm2 | operation | syntax | absorbs |
|------|-----------|--------|---------|
| 0 | `Rd ← Rs` | `MOV Rd, Rs` | a copy |
| 1 | `Rd ← Rs << 1` | `MOV Rd, Rs << 1` | `MOV` + `SL 1` |
| 2 | `Rd ← Rs + 2` | `MOV Rd, Rs + 2` | `MOV` + `ADD 2`, `LINK` |
| 3 | `Rd ← (Rs << 1) \| 1` | `MOV Rd, Rs << 1 + 1` | `<< 1` + set bit 0 |

plus `LSI` (5-bit immediate), the literal-immediate ALU forms (`ADD`/`SUB`/`CMP`,
0..15) and the bit-index forms (`OR`/`XOR`/`TBC`/`TBS`/`CLRB`, `1 << imm`).

## Using it

From script, from a test, or from a plugin:

```js
const { source, stats, changed } = new Deep16Optimizer().optimize(asmText);
// source is assemblable directly:
const result = new Deep16Assembler().assemble(source);
```

Options (all default on):

| option | meaning |
|--------|---------|
| `copyProp` | intra-block copy propagation |
| `deadCode` | dead-store elimination |
| `fusions` | the A/B/C2 rewrite rules |
| `maxSweeps` | rewrite passes per block (default 8) |
| `fuseAllowed` / `deadAllowed` | narrow the work to specific rule names / mnemonics, for tests and for bisecting a miscompile |

`stats.removed` lists the dropped words by original line (`{ line, text }`), so
a caller can point at them or measure the dynamic saving without diffing text.

In the browser IDE, the **Optimize** button next to **Assemble** replaces the
editor text with the optimized source and reports the rule counts in the
transcript. The optimizer is opt-in: nothing runs it unless asked.

A worked example (positions in `R1`, `R2` here are register names):

```text
before                          after
    LDI 2                           LSI R2, 2              ; B1: LDI;MOV -> LSI
    MOV R2, R0                      LDI swi_to_bios
    LDI swi_to_bios                 MOV R1, R0
    MOV R1, R0                      MOV R3, R0 << 1        ; A1: MOV;SL -> imm2=1
    MOV R3, R1                      MOV R4, R0 + 2         ; A3: MOV;ADD 2 -> imm2=2
    SL  R3, 1                       LDI 0x0080
    MOV R4, R1                      OR  R5, R0
    ADD R4, 2
    LDI 0x0080
    OR  R5, R0
```

## Rule catalog

### A — MOV imm2 fusions

| rule | before | after | guard |
|------|--------|-------|-------|
| A1 | `MOV Rd,Rs` ; `SL Rd,1` | `MOV Rd, Rs << 1` | C dead |
| A2 | `SL Rs,1` ; `MOV Rd,Rs` | `MOV Rd, Rs << 1` | C dead (if `Rd==Rs`, just drop the copy: `SL` already did the work) |
| A3 | `MOV Rd,Rs` ; `ADD Rd,2` | `MOV Rd, Rs + 2` | NZVC dead |
| A4 | `MOV Rd,Rs` ; `ADD Rd,Rs` | `MOV Rd, Rs << 1` | NZVC dead |
| A5 | `MOV Rd,Rs<<1` ; `OR Rd,0` or `ADD Rd,1` | `MOV Rd, Rs << 1 + 1` | NZVC dead |
| A6 | `LDI k` ; `MOV Rd,R0` ; `SL Rd,1` | `LDI k` ; `MOV Rd, R0 << 1` | C dead |

A6 runs before B1 so that a scaled constant keeps `R0` (and its value) when a
later instruction still needs it.

### B — R0 materialization

`LDI`/`LWI` always write `R0`, so every fold that drops one proves `R0` is
dead afterwards (or that `R0` is the fold's own destination).

| rule | before | after |
|------|--------|-------|
| B1 | `LDI k` ; `MOV Rd,R0` (`-16 ≤ k ≤ 15`) | `LSI Rd, k` |
| B2 | `LDI k` ; `CMP Rd,R0` (`0 ≤ k ≤ 15`) | `CMP Rd, k` |
| B3 | `LDI k` ; `ADD`/`SUB Rd,R0` (`0 ≤ k ≤ 15`) | `ADD`/`SUB Rd, k` |
| B4 | `LDI 1<<b` ; `OR`/`XOR`/`TBC`/`TBS Rd,R0` | `… Rd, b` |
| B5 | `LDI ~(1<<b)` ; `AND Rd,R0` | `CLRB Rd, b` |

B2..B5 additionally require `Rd ≠ R0`: with `Rd == R0` the `LDI` changes the
very value the operation reads, so the fold would compute something else.
B4 reasons about the value `LDI` actually loads (`LDI 0x4000` loads `0xC000`,
two bits, so it is *not* foldable into a single-bit op).

### C — copies and dead code

| rule | before | after |
|------|--------|-------|
| C2 | `MOV Rd,Rd` | deleted |
| copy prop | `MOV Rx,Ry` then a value use of `Rx` | the use reads `Ry`, invalidated whenever either is redefined |
| DSE | a pure instruction whose results and flags are dead | deleted |

C2 and DSE never delete a delay-slot word (see below).

## The analysis

Liveness and copy propagation are exact **within a basic block** and
conservative at every boundary: a block that can be entered from elsewhere, a
control transfer, or a block end treats the tracked state as live.

That is deliberate. Deep16 control flow is largely computed — `LDI label ;
MOV PC, R0` and register dispatch are everywhere in the Forth kernel — so a
whole-program liveness claim would have to seed every block from an unknown
predecessor and would collapse to "everything is live". The intra-block
analysis is what the local rules need; it cannot be wrong in either direction.

Values are tracked for the sixteen registers and for four flag bits
(`N`, `Z`, `V`, `C`) separately, so a fold that drops a `C`-only shift write is
rejected only when `C` is actually read later.

## Safety

- **Delay slots are sacred.** The instruction after a branch or jump always
  executes. It is never deleted and no fusing window may contain it, because
  removing that word would promote the next instruction into the slot.
- **Flags are values.** Every fold that replaces a shift or ALU op with a
  flag-free `MOV` is guarded by per-flag liveness.
- **Labels survive deletion.** A label on a deleted line is emitted on its own
  line; branch targets and jump-table entries keep resolving.
- **Opaque instructions are barriers.** PSW, segment, shadow and system
  operations are never rewritten and block copy propagation and deletion
  across them.
- **A control transfer ends a deadness proof.** `regDeadAfter` /
  `flagsDeadAfter` stop at any branch, jump or halt: the target may read the
  value, and this block cannot see it. (Without this, a value used only at the
  branch target looked dead.)
- **LD/ST bases are not copies.** The segment of a memory access is chosen by
  the **base register number** (`isStackRegister` / `isExtraRegister` in the
  core, and `PSW.SR`/`ER` at run time), so two registers holding equal values
  are not interchangeable as a base. Only value operands are substituted.
- **PC is not a copyable value.** A PC read is position-dependent, so `MOV Rd,
  PC` never creates a copy that a later use could be rewritten into.

## Measured effect

Over the repository's own sources (executable words = instruction lines, not
directives or labels):

| file | instructions | rules fired |
|------|--------------|-------------|
| `asm/forth.asm` | 3660 → 3553 (−107) | B1×60, A3×28, 5 identity, 14 dead |
| `asm/swi-test.asm` | 83 → 77 | B1×1, +5 dead |
| `asm/string_demo.asm` | 42 → 39 | B1×1, +2 dead |
| `asm/far_call.asm` | 20 → 19 | B1×1 |
| `asm/fibonacci.asm`, `screen_demo.asm`, `link_delay_slot.asm` | unchanged | copy substitutions only |

## Runtime effect (measured)

Executed instructions on the JS core, both kernels run until the REPL returns
to idle (empty keyboard queue and a poll of `KBD_STATUS` at 0xF0060), same
input on both sides. `steps` counts retired instructions, delay slots included.

| workload | original | optimized | speedup |
|----------|---------:|----------:|--------:|
| boot to prompt | 10 500 | 10 471 | 1.003× |
| `1 2 + .` | 14 762 | 14 667 | 1.007× |
| `: sq dup * ;` then `5 sq .` | 20 380 | 20 213 | 1.008× |
| `fib 18` (recursive) | 2 094 191 | 2 073 018 | 1.010× |
| `: cnt 0 begin 1+ dup 2000 < until drop ;` | 25 034 | 24 833 | 1.008× |
| `12345 . 9876 . 42 . 7 .` | 19 654 | 19 534 | 1.006× |

DeepForth runs about **1% faster** (0.3–1.1% here). The dynamic saving is
essentially all one instruction removed from the stack-underflow prologue that
every primitive runs — `MOV R9, SP ; ADD R9, 2` folds to `MOV R9, SP + 2`
(rule A3) — plus `ADD R10, 2` in the dictionary search and `LDI;MOV → LSI` in
setup paths. The primitive bodies and the inner interpreter still dominate.
The `<< 1` / `<< 1 + 1` rules fire zero times on the current sources: the kernel
does not write those idioms next to a `MOV`. That is the opportunity the
optimizer exists to take — once the Forth compiler emits `cells`/`2*` as
`MOV Rd, Rs << 1`, A1/A2/A4/A5 start firing on the hot path.

These are retired instructions, not cycles: no pipeline or cache effects are
modelled, so the RTL core's cycle count could differ.

## Verification

`tests/optimizer.test.js` (29 tests) pins:

- each rule and its guards as text in → text out (live `R0`, live flags,
  delay-slot position, `CMP R0,R0`);
- that a label on a deleted instruction survives, that a rewritten instruction
  keeps its comment, and that no label definition is ever dropped;
- **differential execution**: assemble and run a program with and without the
  optimizer and require the same registers (minus PC, which legitimately
  moves), PSW and step count, on the JS and WASM cores;
- the strongest oracle: the shipped 5000-line Forth kernel, optimized and
  driven through the REPL across arithmetic, control flow, recursion,
  variables, `does>` and error paths, compared screen row by row against the
  original and required to use no more steps.

Run everything with `npm test`.

## Limitations and future work

- No cross-block liveness, so folds that need a value dead at a branch target
  (notably `LDI 0 ; CMP Rd,R0` followed by a branch) are skipped. Recovering
  them needs a CFG and a treatment of the computed jumps, not more local rules.
- Only shift-by-1 is foldable (imm2 shifts by exactly one); `SL Rd,2` has no
  single-instruction form.
- Not yet wired into a build step or the assembler itself — it is a
  source-to-source pass called on request.
