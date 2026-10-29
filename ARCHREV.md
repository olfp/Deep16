# ARCHREV — architecture revision log

Short, dated records of Deep16 architecture changes: what changed, why, and
what breaks. Normative text lives in `doc/Deep16-Arch.md`; the long-form
rationale for each entry stays in its own design note (`doc/Changes.md`,
`FPUEMUPLAN.md`, `doc/Interrupts.md`). Entries are chronological and are never
rewritten — a later entry that supersedes part of an earlier one says so.

| Entry | Date | Change | Status |
|---|---|---|---|
| §1 | 2026-10-08 | `MOV imm2` is a four-way function select | implemented |
| §2 | 2026-10-29 | `SAPF` (`0xFFF6`) — set alternate PSW flags | implemented |
| §3 | 2026-10-29 | trap entry no longer zeroes the shadow bank | implemented |
| §4 | 2026-10-29 | area cost of §2 and §3 | measured, §5 |

## 1. `MOV imm2` redesign (2026-10-08)

Short record of the `MOV Rd, Rs, imm2` redesign: what changed, why, and what
it breaks. Normative text: `doc/Deep16-Arch.md` (Tables 1/2, §3.3, §5.1.2,
Table R, §6.2); longer rationale: `doc/Changes.md` §14.

### What changed

**1. imm2 is now a four-way function select** (was `Rs + imm2`):

| imm2 | Operation | Syntax |
|------|-----------|--------|
| 0 | `Rd ← Rs` | `MOV Rd, Rs` |
| 1 | `Rd ← Rs << 1` | `MOV Rd, Rs << 1` |
| 2 | `Rd ← Rs + 2` | `MOV Rd, Rs + 2` (`LINK`/`LNK`) |
| 3 | `Rd ← (Rs << 1) \| 1` | `MOV Rd, Rs << 1 + 1` |

A PC source yields the architectural own address + 1 for every imm2
(spec 3.3/6.2.1), so `LINK` still returns past a delay slot. Every 16-bit
constant now loads in two instructions (`LDI x` + one MOV shift); the test
suite checks this for all 65536 values.

**2. ALNK/ALINK re-encoded.** The architectural PC read moved to
`SMV Rx, APC` / `SMV LR, APC` (0xFEEF), exactly as Arch Table R already
specified — this also resolves the Arch-doc vs Program-Man conflict in
favour of the Arch doc. `LNK`/`LINK` are unchanged (`MOV Rx, PC, 2`).

**3. AMV retired.** The general unforwarded GPR read (`MOV Rd, Rs, 3`)
is gone, and no encoding remains for it: SMV is full and has no source field
for a general Rs (Rx is the destination, the reserved alt_sel codes name
fixed sources), the opcode tree is full down to `HLT`, ALU2's `func5` is
32/32. Committed reads of GPRs are no longer expressible — the spec relies
on pipeline drains at exception entry; the no-forward contract lives on for
`APC` in SMV (Arch §3.3).

**4. Assembler rejects the meaning-changed forms.** `MOV Rd, Rs, 1`,
`, 3`, `+1`, `+3` (and the old `MOV LR, PC, 3` spelling of ALINK) now error
with a hint pointing at the shift syntax, so pre-redesign sources fail
loudly instead of silently yielding shifted values. `, 0` and `+2` keep
their meanings.

**5. JS core delay-slot PC fix.** The JS core executed the delay-slot
instruction *before* incrementing PC, so `SMV Rx, APC` / `MOV Rx, PC`
inside a delay slot returned the slot address while the WASM core returned
own+1 (measured 0x0103 vs 0x0104). JS now increments first, matching
`step_one` in `lib.rs`; both cores derive MOV's PC source from the
instruction's original address, so LINK/ALNK values do not depend on PC
bookkeeping order.

**6. Disassembler.** imm2=1/2/3 render as `<< 1`, `+ 2`, `<< 1 + 1`
(re-assemblable); `SMV Rx, APC` prints as `ALNK Rx` / `ALINK`; the old
imm2=3 alias branch is gone (`0xFBBF` is now `MOV R14, PC << 1 + 1`).

### Migration

| Before | After |
|--------|-------|
| `MOV Rd, Rs` , `MOV Rd, Rs, 0` | unchanged |
| `MOV Rd, Rs +2` , `, 2` | unchanged (`LINK`, `LNK`, `MOV LR, PC, 2`) |
| `MOV Rd, Rs, 1` , `+1` | `MOV Rd, Rs << 1` (error otherwise) |
| `MOV Rd, Rs, 3` , `+3` | `MOV Rd, Rs << 1 + 1` (error otherwise) |
| `ALNK Rx` / `ALINK` | source text unchanged; now encodes `SMV Rx, APC` |
| `MOV LR, PC, 3` (old ALINK) | `ALINK` or `SMV LR, APC` |

**Binary compatibility:** ALNK/ALINK words change (`0xFBBF`-style MOV form →
SMV form), so previously assembled binaries must be reassembled. Assembly
sources need no change except old `, 1`/`, 3`/`+1`/`+3` spellings.

### Files

- `js/deep16_simulator.js` — delay-slot PC increment order; new imm2 table
- `wasm/deep16-wasm/src/lib.rs` — new imm2 table (`exec_mov`); pkg rebuilt
- `js/deep16_assembler.js` — shift syntax, `,1`/`,3`/`+1`/`+3` rejection,
  `ALNK`/`ALINK` → `encodeSMV(..., 'APC')`
- `js/deep16_disassembler.js` — shift rendering, SMV/APC alias rendering
- `index.html` — starter snippet (`MOV R1, R0 << 1`)
- `doc/Deep16-Arch.md`, `doc/Deep16-Prog-Man.md`, `doc/Changes.md` (§14),
  `deep16_project_summary.md` — spec/text updates
- `tests/mov-imm2.test.js` — new tests (below)

### Tests (`tests/mov-imm2.test.js`)

- imm2 function table on both cores (including wrap cases)
- delay-slot PC reads on both cores, asserting LR: `SMV LR, APC`, `ALNK LR`,
  `MOV LR, PC`, `MOV LR, PC + 2` — these fail on the old JS core (verified
  by mutation), fixing a divergence the previous tests could not see
- end-to-end ALNK call/return capturing the in-flight return address
- golden words: LINK unchanged, ALNK/ALINK = SMV, disassembly round-trip
- assembler accept/reject matrix with hint-message assertions
- constant reachability: all 65536 values arithmetically, sampled values
  executed on both cores

## 2. `SAPF` — Set Alternate PSW Flags (2026-10-29)

### What changed

Word `0xFFF6` (SYS sub-op 6) becomes an instruction; today it falls through
the SYS `case` to a NOP.

| | |
|---|---|
| Encoding | SYS, low three bits `110` — word `0xFFF6` |
| Semantics | `spsw[3:0] ← R0'[3:0]`, `spsw[15:4]` unchanged |
| Flags | `N=0, Z=1, V=2, C=3` |
| Operands | none — the source is the handler bank's `R0` |
| Gating | none |

The SYS block is now **full**: 0 NOP, 1 FSH, 2 SWI, 3 RETI, 4 SETI, 5 CLRI,
6 `SAPF`, 7 `NIO` (the non-implemented-opcode trap, `ILLTRAP.md`). `NIO` is
deliberately not the 8th FPU opcode.

### Why

`RETI` restores `spsw`, so condition codes reach the interrupted instruction
only through `spsw` — and there is no other write path: `SMV Rx, APSW` reads
it, nothing writes it. Two emulated instructions need exactly that:

- the **DIV/DIV32 trap** in `rtl/deep16_core3.sv`: the core has no divider, the
  instruction traps, and the handler must return `N/Z/V/C` as if the ALU had
  produced the quotient. This closes the DIV flag gap recorded in `ILLTRAP.md`;
- **FCMP** in the soft-float library, where "unordered" needs `V=1` with
  `N=0, Z=0, C=0` (`FLOATIMPL.md` §8).

### Why flags only, and why from a register

- **Flags only.** `spsw` is readable, so a full-word form would be a
  read-modify-write (`SMV R0, APSW`, mask, merge, write): three to five
  instructions instead of one, plus a `0xFFF0` mask to hold. Worse, a handler
  bug that let `S` through would write `S=1` into the return PSW and `RETI`
  would never leave the shadow context. Bits 15:4 are hardware-preserved, so
  `S` cannot be written by construction.
- **From `R0'`, not from the live flags.** `V=1` with `N=0, Z=0, C=0` is
  unreachable from ALU flags (only add/sub set `V`), and a flag-sourced form
  would be corrupted by any flag-setting instruction inserted between the
  comparison and the `SAPF`. An explicit nibble in `R0` is immune to both.

### What it breaks

Nothing in the field. `0xFFF6` executed as NOP, so no source depends on its
behaviour and no binary changes meaning except code that deliberately encoded
it. Cost is a nibble write port into `spsw`: **5–9 CLS**, which §3 pays for
several times over (§4).

### Interaction with §3

The original rationale called `R0` scratch "because `sh_clear` wipes the
shadow bank on entry". After §3 the wipe is gone. `R0'` is still scratch *with
respect to the interrupted context* — the banks are separate — but it may now
carry a previous handler's persistent value, so a handler that owns `R0'`
across invocations must not use it as the `SAPF` carrier. One owner per
register, documented with the handler.

### Files

| File | Change |
|---|---|
| `js/deep16_assembler.js` | `SAPF` (no operands) → `encodeSystem(6)` |
| `js/deep16_disassembler.js` | `systemOps[6] = 'SAPF'` |
| `rtl/deep16_core.sv` | SYS `case` → `3'd6` |
| `rtl/deep16_core3.sv` | SYS `case` → `3'd6` |
| `js/deep16_simulator.js` | SYS sub-op 6 |
| `wasm/deep16-wasm/src/lib.rs` | SYS sub-op 6 |
| `doc/Deep16-Arch.md` | §3.3 and §4.9 opcode tables, SYS row |

### Tests

- assemble/disassemble round trip; `0xFFF6` and `0xFFF7` no longer read as NOP;
- all three cores: `spsw[3:0]` takes `R0'[3:0]`, bits 15:4 are unchanged, and
  `SMV Rx, APSW` observes the new nibble;
- `SAPF` then `RETI` delivers the flags to the interrupted instruction;
- the DIV handler's quotient flags, and FCMP's unordered result.

## 3. No shadow-bank zeroing on trap entry (2026-10-29)

### What changed

Trap entry stops writing the shadow general registers. Everything else in the
entry sequence is unchanged.

| Entry step | Before | After |
|---|---|---|
| `spsw ← psw` | yes | yes |
| `psw ← 0x0020` (S=1, I=0, flags clear) | yes | yes |
| `sCS/sDS/sSS/sES ← 0` | yes | yes |
| `PC' ← vector` | yes | yes |
| `R0'..R3' ← 0` | yes | **no** |
| `R13'` (SP') `← 0` | yes | **no** |
| `R14'` (LR') | SWI: 0, ILL: interrupted PC | SWI: untouched, ILL: interrupted PC (unchanged) |

### Why

The zeroing costs **no cycles**: it is six register writes on an edge the entry
already uses. Its cost is architectural — it makes the shadow bank *ephemeral*,
so every handler rebuilds its state from memory on every entry. That is the
largest fixed cost of a short ISR, and it is the reason a 450-cycle tick cannot
afford a handler.

Area is a **gain**, not a cost: §3 removes logic from the register file and
from the core's forwarding path (§4).

Without the wipe, `R0'..R3'` and `SP'` become a **persistent handler context**:
a timer or audio ISR keeps a ring pointer, a phase accumulator, a counter and
its stack there and reloads nothing.

| Per ISR entry | Cycles |
|---|---|
| today: reload pointer + counter from PSRAM (12-cycle non-bursting, cached after the first pass) | 20–30 |
| after §3: already in registers | 0 |

At 10 kHz that is roughly 9 % → 5–6 % of the CPU and at 15 kHz 13 % → 8 %,
before the handler's own work (`AUDIOPLAN.md` §6.1). For the ~400-cycle ILL
emulation it is 7 %; for a 60-cycle tick it is 40 %. The `SLIMPLAN.md`
interrupt plan assumes the tick case.

### What breaks — the rules this creates

1. **No handler may assume `R0'..R3'` or `SP'` are zero.** Both kernel entry
   paths already comply: `ill_handler` (`asm/forth_nano.asm:14969`) writes
   `R0..R3` and takes `SP'` from `AR13` before use, and `swi_to_bios`
   (`:508`) builds its target in `R2`/`R3`; neither reads a banked register it
   has not written. The BIOS body still needs an audit for the same rule.
2. **All handlers share one shadow bank.** SWI, ILL and (later) a hardware IRQ
   run in the same context. A synchronous trap taken *inside* a hot handler is
   reachable — `I=0` blocks IRQs but not a DIV/FPU trap — and would destroy the
   hot handler's persistent registers. The cold paths must therefore save and
   restore `R0'..R3'`/`SP'` around their work: ~6 stores + 6 loads, 30–40
   cycles against a ~400-cycle emulation, invisible. Without that, the change
   buys nothing and breaks the first ISR that used it.
3. **Double fault is unchanged**: the ILL entry still refuses to trap when
   `S=1`.

### What this does not decide

A dedicated third register bank would remove the sharing problem, but it needs
16 registers plus an encoding, and the encoding tree has no spare word
(`FLOATIMPL.md` §14). Not worth it; rule 2 is the cheaper answer.

### Files

| File | Change |
|---|---|
| `rtl/deep16_regfile.sv` | drop the `sh_clear` port and the clear branch (`:39`, `:86`) |
| `rtl/deep16_core.sv` | drop `sh_clear` plumbing and the `id_sh_clear` forwarding bypass (`:463`, `:479-491`) |
| `rtl/deep16_core3.sv` | drop `sh_clear_ex` (`:470` SWI, `:770` ILL) |
| `js/deep16_simulator.js` | drop the six zero stores in `executeSWI`, `executeILL`, `executeInterrupt` (`:1275`, `:1304`, `:1367`) |
| `wasm/deep16-wasm/src/lib.rs` | same in `exec_sys` SWI and the ILL / interrupt entry |
| `asm/forth_nano.asm` | `ill_handler` and the SWI bridge save/restore `R0'..R3'`/`SP'` (rule 2) |
| `doc/Interrupts.md` | entry sequence: delete the zero lines, add the persistence rule |
| `doc/Deep16-Arch.md` | §4.4 entry sequence |
| `FPUEMUPLAN.md` §3.4 | the "`sh_clear` wipes the shadow bank" sentence (§2 above) |
| `tests/shadow.test.js` | stop asserting zeros; add persistence and parity cases |

### Tests

- entry leaves `R0'..R3'`/`SP'` untouched — RTL, JS and WASM agree;
- a handler writes a value, `RETI`, and a second trap sees it: the persistence
  the change exists for;
- a DIV (or FPU trap) inside a handler, then `RETI`, leaves the outer handler's
  banked registers intact — the rule-2 defence, and the test that fails if the
  save/restore is ever dropped;
- existing behaviour unchanged: `tests/shadow.test.js`,
  `tests/ill-trap.test.js` and `npm test` stay green.

## 4. Area cost of §2 and §3 (2026-10-29)

Estimate, ±40 % (measured in §5). Baseline is the measured 28 Oct tile build:
**4,237 / 4,320 CLS, 83 free**, 1.70 LUT4 per slice (`SLIMPLAN.md` §1, §3).

### Per component

| Change | LUT4 | CLS | Where |
|---|---|---|---|
| §2 `SAPF`: SYS decode + `spsw` nibble write port | 8–16 | 5–9 | both cores |
| §3 regfile: drop the `sh_clear` priority level | 24–48 | 14–28 | both builds |
| §3 core3: `sh_clear_ex` plumbing and bypass | 4–8 | 2–5 | tile build only |
| §3 core5: `id_sh_clear` forwarding bypass (3 × 16-bit) + plumbing | 30–50 | 18–30 | text build only |

`sh_clear` sits at the top of a four-level write-priority chain for the six
16-bit shadow registers (`rtl/deep16_regfile.sv:86-95`: clear, MUL32 low word,
Rd, debug). Removing one level is about one LUT4 per two destination bits over
96 bits — a dense, regular block, which is exactly the logic that frees whole
slices rather than scattered LUTs.

The text build gains more because the five-stage core carries the
`id_sh_clear` forwarding bypass on three operand ports
(`rtl/deep16_core.sv:479-491`); core3 has no such path.

### Net per build

| Build | Core | §2 | §3 | Net | Free before → after |
|---|---|---|---|---|---|
| tile / user-flash (`D16NANO`) | core3 | +5…+9 | −16…−33 | **−7…−31** | 83 → **~90–114** |
| D16MINI text (`D16MINI`) | core5 | +5…+9 | −32…−58 | **−23…−53** | 15 → **~40–68** |

Planning figures: **~15 CLS back on the tile build, ~35 on the text build.**

**Land §2 and §3 in one commit.** Alone, §2 costs 5–9 CLS in a build that has
83 free — affordable, but pointless to pay separately when §3 gives several
times as much back. Together the tile build never sees the cost.

### What does not change

- **Registers:** the six shadow registers stay (96 FFs). §3 removes a write
  path, not the bank. No FF change.
- **BSRAM, DSP, pins:** untouched.
- **Packability:** CLS is a packing quantity at 99 % slice occupancy. A dense
  removal from the regfile frees slices; a scattered addition in the SYS decode
  frees none. That asymmetry favours the good end of the range when both land
  together, and is the reason §2 alone is the worst order.

### Software side

- `ill_handler` gains the §3 rule-2 save/restore, ~12 instructions (±24 image
  words, 48 bytes); `swi_to_bios` ~8. Image space, not fabric.
- **Cycle budget:** ISR entry drops 20–30 cycles — at 15 kHz 13 % → ~8 % of the
  CPU, at 10 kHz 9 % → 5–6 %.

### How to verify

Re-run `synth:tile` and `synth:board` and read three rows of
`impl/gwsynthesis/*_syn_rsc.xml`:

1. `u_regfile` should drop ~24–48 LUT. If it drops nothing, the clear was
   folded into the FF reset and §3's saving is only the core-side bypass.
2. `u_core` (text) should drop ~30–50 LUT; `u_core3` (tile) roughly flat apart
   from the SAPF nibble port.
3. Total CLS and LUT4: whether ~15 freed CLS is real or absorbed by packing.

### Interaction with the interrupt plan

~15 CLS does not fund an I2S transmitter (35–40) plus a timer IRQ (20–32). With
the shifter merge in `SLIMPLAN.md` §3 (20–40) it does, without cutting sprites.

## 5. Measured result (2026-10-29)

§2+§3 landed together on the tile build, measured after the phase-2b source
changes:

| | before | after |
|---|---:|---:|
| CLS | 4,278 / 4,320 (42 free) | **4,193 / 4,320 (127 free)** |
| dvi_pixel | 84.777 MHz | **83.419 MHz**, TNS 0 |
| dvi_render | 26.801 MHz | **26.198 MHz**, TNS 0 |
| clk_cpu / psram_clk | 18.576 / 88.931 | **19.469 / 104.490** |

That is **85 CLS back**, more than the 15 the estimate promised: removing the
`sh_clear` priority level also unpacks the register file and removes the ID
forwarding bypass, and the retime's placement shifted with it. The new headroom
is what the I2S FIFO and the timer/raster/keyboard interrupts will spend.

The kernel change is small: `SAPF` is in all three cores and the tools,
`ill_handler` saves/restores `R0'..R3'`/`SP'` (the handler stack is the
reserved 0x5200 block, initialized by SWI function 0xFF at boot), and the SWI
bridge no longer assumes a zeroed bank. `tests/shadow.test.js` and
`tests/ill-trap.test.js` cover the SAPF nibble, persistence across traps and
the handler-bank save. `npm test`: **671 pass**.

The same RTL is rebuilt into `rtl/pkg` and `wasm/pkg`; the committed cores
agree on the new semantics (the fuzz parity test runs all three).
