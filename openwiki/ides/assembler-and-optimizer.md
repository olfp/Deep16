---
type: "Reference"
title: "Assembler, Disassembler and Optimizer"
openwiki_generated: true
verified:
  - by: openwiki/0.7.2
    at: 2026-11-01T09:36:37.731Z
sources:
  - id: openwiki-source-ea83bb2e7b5258f744ae4311
    resource: repo://asm/examples.json
  - id: openwiki-source-f8d10828394c4129061d5b0e
    resource: repo://index.html
  - id: openwiki-source-a645ee6d38e662b081be60ab
    resource: repo://js/deep16_assembler.js
  - id: openwiki-source-d7f2e5f5d0bc05e1f2853d72
    resource: repo://js/deep16_disassembler.js
  - id: openwiki-source-bb3fa7e4893b4b80cbca555c
    resource: repo://js/deep16_optimizer.js
  - id: openwiki-source-0cc31ca306d30bed999278fc
    resource: repo://js/deep16_ui_core.js
  - id: openwiki-source-7be1d3a27c67ffa3d8ff9800
    resource: repo://tests/disassembler.test.js
  - id: openwiki-source-0b039283b04730211698eb2a
    resource: repo://tests/helpers.js
  - id: openwiki-source-847e2b3e9c92bba0173a97da
    resource: repo://tests/optimizer.test.js
generated: { by: "opencode", at: "2026-11-01T09:36:37.731Z" }
---


# Assembler, Disassembler and Optimizer

Everything in this page lives under `js/` and runs in the browser without a
build step: the IDE loads the three scripts with `<script>` tags and the Node
tests load the same files through `vm.runInThisContext`. There is one
implementation of each, shared by the IDE and the test suite.

| File | Role |
|---|---|
| `js/deep16_assembler.js` | Two-pass assembler: source text → words, symbols, listing |
| `js/deep16_disassembler.js` | Word → source text, used by the memory panel |
| `js/deep16_optimizer.js` | Source-to-source peephole optimizer |
| `asm/examples.json` | Manifest of the bundled demo programs |

## Assembly pipeline

`assemble(source, { defines })` does three things in a fixed order.

1. **Conditional assembly.** `.if NAME`, `.ifdef NAME`, `.ifndef NAME` (and the
   `.ifnot` alias), `.else` and `.endif` are resolved against the caller's
   `defines` before either pass. An inactive line is replaced with an empty
   string rather than removed, so line numbers in errors and listings still
   match the file the user is looking at. Nesting is tracked on a stack, and
   `.else` without `.if`, a duplicate `.else`, `.endif` without `.if` and an
   unterminated block are reported as errors.
2. **First pass.** Walk every line, track `address`, honour `.org`, follow
   `.code`/`.data`, record labels (and their segment) and evaluate `.word`,
   `.text`, `.string` and `.equ` only far enough to know how many words they
   occupy. First-pass errors are swallowed on purpose — the second pass reports
   them with the same line numbers.
3. **Second pass.** Reset `address`, re-walk, and encode each instruction.
   Every emitted word becomes a `memoryChanges` entry, and every line becomes a
   `listing` entry (address, raw text, encoded word or error). A failing line
   still advances `address` so subsequent absolute addresses stay aligned.

The result object is:

```
{ success, memoryChanges, symbols, errors, listing, segmentMap }
```

`success` is simply "no errors", and unresolved forward references are appended
to `errors` at the end rather than thrown.

### Directives

| Directive | Effect |
|---|---|
| `.org expr` | Set the assembly address |
| `.code` / `.data` | Set the current segment label used by `segmentMap` |
| `.word v, v*count, ...` | Emit values; `v*N` repeats |
| `.text "..."` | Emit one word per character, then a null word |
| `.string "..."` | Emit two characters per word, high byte first, then a null word |
| `.equ NAME, expr` | Bind a constant; a register value makes `NAME` a register alias |

`.equ` deliberately keeps everything after the name, so `.equ D, f0 - f1`
binds the whole expression. Splitting on every separator silently truncated it
to the first token.

## Encoding constraints worth knowing

The assembler is the place where most ISA-level mistakes surface, and it rejects
them at assembly time rather than producing a wrong word.

- **`LDI` is a 15-bit pattern, not a signed range.** The CPU sign-extends bit
  14, so the accepted spellings are `0..0x7FFF` and `-16384..-1`; they denote
  the same 32768 fields. Anything else is an error. `LDI 0x4000` therefore loads
  `0xC000`, and that is correct behaviour, not a defect.
- **`LWI` is a convenience mnemonic, not an opcode.** It takes a full 16-bit
  pattern and emits the `LDI` field that sign-extends to it. Only patterns with
  matching top two bits are expressible (`0x0000–0x3FFF` and `0xC000–0xFFFF`);
  the middle third is refused with a recipe: load the low 14 bits with `LDI`,
  then set bits 14/15 with `OR R0, 14` / `OR R0, 15`. The recipe is tested, so
  the suggested fix really assembles.
- **The ALU immediate form is 4 bits.** `ADD`/`SUB`/`CMP` take a literal
  `0..15`; `TBC`/`OR`/`XOR`/`TBS`/`CLRB` take a **bit index** in the same field,
  which the core expands to `1 << imm`. The assembler stores the index
  unshifted.
- **`AND` has no immediate form.** That slot is `CLRB`; a mask has to be loaded
  with `LDI`/`LSI` first. `CLRB` requires an immediate bit number, and a
  register operand is an error.
- **32-bit results need even destinations.** `MUL32` and `DIV32` write
  `Rd:Rd+1`, so an odd `Rd` is rejected.
- **`LD`/`ST` offsets are 5-bit signed:** `-16..15`. Both the bracket form
  (`LD R1, [R2+4]`) and the older `LD R1, R2, 4` are accepted.
- **Branches store `target - (address + 1)`.** All cores post-increment the PC
  before executing, so the nine-bit field is relative to the instruction after
  the branch; the range is `-256..255`.
- **`LSI` is `-16..15`; `SET`/`CLR` are `0..15`.** `SET2`/`CLR2` share the
  `SET`/`CLR` encoding.

Several mnemonics are aliases rather than encodings: `JMP Rx` becomes
`MOV PC, Rx`, `LNK Rx`/`LINK` become `MOV Rd, PC, 2`, and `ALNK`/`ALINK` become
`SMV` from the architectural PC. `HALT` and `HLT` are the same word.

## Disassembler

`disassemble(word)` decodes by prefix, in this order: `0xFFFF` as `HLT`, bit 15
clear as `LDI`, bits 15–14 `10` as `LD`/`ST`, bits 15–13 `110` as the ALU group,
and bits 15–13 `111` as the extended group, which then splits into jumps,
`LDS`/`STS`, `MOV`, `LSI`, `SOP`, `SET`/`CLR`, `MVS`/`SMV` and the system words.
Registers print as `R0`–`R14` with `R15` shown as `PC`.

`LDI` prints its operand as raw hexadecimal. That is a contract, not a
cosmetic choice: the disassembler output has to be assemblable again, so the
assembler must accept every `0x0000–0x7FFF` pattern.

`tests/disassembler.test.js` pins three round trips: every listed mnemonic
disassembles to something the assembler accepts; the ALU group re-encodes to the
identical word; and all 32768 `LDI` patterns survive disassemble → assemble. It
also checks that `MUL32`/`DIV32` print even destinations and that `HALT`/`HLT`
agree.

## Optimizer

`optimize(source, options)` is a text-to-text peephole pass. Labels stay
symbolic, so deleted instructions cost no relocation work: the existing
two-pass assembler re-resolves every branch after the rewrite. Nothing in this
file touches the simulator or a memory image.

### Analysis scope

Liveness and copy propagation are exact inside a basic block and deliberately
conservative at block boundaries — a block ends with every register and flag
considered live. That is a response to the language: Deep16 control flow is
largely computed (`LDI label; MOV PC, R0`), so a whole-program claim would have
to assume the worst at every entry anyway.

### Fusion rules

The rules exist because the ISA has opcodes that absorb a second instruction:
the `MOV` immediate selector (`Rd <- Rs`, `Rs << 1`, `Rs + 2`, `(Rs << 1) | 1`),
`LSI`'s 5-bit immediate, the 4-bit ALU literal, and the bit-index forms.

| Rule | Rewrite |
|---|---|
| `A1` | `MOV Rd,Rs; SL Rd,1` → `MOV Rd, Rs << 1` |
| `A2` | `SL Rs,1; MOV Rd,Rs` → `MOV Rd, Rs << 1` (or drop the copy when `Rd == Rs`) |
| `A3` | `MOV Rd,Rs; ADD Rd,2` → `MOV Rd, Rs + 2` |
| `A4` | `MOV Rd,Rs; ADD Rd,Rs` → `MOV Rd, Rs << 1` |
| `A5` | `MOV Rd,Rs<<1; OR Rd,0` / `ADD Rd,1` → `MOV Rd, Rs << 1 + 1` |
| `A6` | `LDI k; MOV Rd,R0; SL Rd,1` → `LDI k; MOV Rd, R0 << 1` |
| `B1` | `LDI k; MOV Rd,R0` → `LSI Rd,k` (k in −16..15) |
| `B2` | `LDI k; CMP Rd,R0` → `CMP Rd,k` (k in 0..15) |
| `B3` | `LDI k; ADD/SUB Rd,R0` → `ADD/SUB Rd,k` (k in 0..15) |
| `B4` | `LDI 1<<b; OR/XOR/TBC/TBS Rd,R0` → same op with bit `b` |
| `B5` | `LDI ~(1<<b); AND Rd,R0` → `CLRB Rd,b` |
| `C2` | `MOV Rd,Rd` → nothing |

Copy propagation and dead-code elimination run alongside the table.

### Safety guards

The rules are only as good as their refusals:

- **Delay slots are untouchable.** `markDelaySlots` marks the instruction after
  a branch, jump or indirect control transfer; that word always executes, so it
  is never deleted and no fusion window may span it. Deleting it would promote
  the next instruction into the slot.
- **`LDI` always writes `R0`.** Any rule that removes one must prove `R0` is
  dead afterwards, or that `R0` is the rule's own destination.
- **Flags are tracked per bit** (`N`, `Z`, `V`, `C`). Every rewrite that
  replaces a shift or ALU operation with the flag-free `MOV` immediate form is
  guarded by flag liveness, which is why a shift whose carry reaches `JC`
  survives.
- **Opaque instructions are barriers.** PSW, segment, shadow and system words
  are treated as reading everything: they block deletion and copy propagation
  and never take part in a fusion.

### Options and reporting

Defaults are `copyProp: true`, `deadCode: true`, `fusions: true`,
`maxSweeps: 8`. `fuseAllowed` and `deadAllowed` narrow the work to named rules
or mnemonics; they exist for tests and for bisecting a suspected miscompile.

The result is `{ source, stats, changed }`. `stats` counts `byRule`, `fusions`,
`copies`, `dead`, `identities`, `wordsRemoved`, `wordsRewritten`, `blocks`,
`sweeps`, and `removed` — the original line and text of every deleted
instruction.

### Testing the optimizer

Rule-level tests pin text in → text out. The real contract is differential:
assemble the program twice, run both versions, and require the same machine
state with no more steps. That harness runs on the **shipped Forth kernel**
(`asm/forth.asm`), because a 5000-line real program is the only oracle that
catches a locally plausible but globally wrong rule. A further test runs the
optimized program on the WASM core and compares registers and PSW with the JS
core.

## How the IDE uses it

The **Optimize** button calls `optimizeSource()`, which runs the optimizer over
the editor text, replaces the editor contents, marks the file modified and
prints the stats (`wordsRemoved`, `copies`, `byRule`) as a transcript entry. It
is never applied automatically: Assemble uses whatever text is in the editor, so
the user sees the optimized source before it becomes a program. If the optimizer
is not loaded, or the pass throws, the editor is left untouched and an error is
shown.

## Bundled examples

`asm/examples.json` is a flat list of `{ name, filename, description, category }`
entries pointing at programs in `asm/`:

| Example | File | Category |
|---|---|---|
| Fibonacci Sequence | `fibonacci.asm` | Mathematics |
| Far Call & Long Jump | `far_call.asm` | Advanced |
| Screen Demo | `screen_demo.asm` | I/O |
| String Demo | `string_demo.asm` | I/O |
| DeepForth | `forth.asm` | I/O |
| Link in Delay Slot | `link_delay_slot.asm` | Advanced |

## Related pages

- [ISA and CPU State](../architecture/isa-and-cpu-state.md)
- [DeepWeb IDE](deepweb-ide.md)
- [JavaScript Reference Core](../cores/js-core.md)
