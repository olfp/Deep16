# ARCHREV — MOV imm2 Redesign (2026-10-08)

Short record of the `MOV Rd, Rs, imm2` redesign: what changed, why, and what
it breaks. Normative text: `doc/Deep16-Arch.md` (Tables 1/2, §3.3, §5.1.2,
Table R, §6.2); longer rationale: `doc/Changes.md` §14.

## What changed

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

## Migration

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

## Files

- `js/deep16_simulator.js` — delay-slot PC increment order; new imm2 table
- `wasm/deep16-wasm/src/lib.rs` — new imm2 table (`exec_mov`); pkg rebuilt
- `js/deep16_assembler.js` — shift syntax, `,1`/`,3`/`+1`/`+3` rejection,
  `ALNK`/`ALINK` → `encodeSMV(..., 'APC')`
- `js/deep16_disassembler.js` — shift rendering, SMV/APC alias rendering
- `index.html` — starter snippet (`MOV R1, R0 << 1`)
- `doc/Deep16-Arch.md`, `doc/Deep16-Prog-Man.md`, `doc/Changes.md` (§14),
  `deep16_project_summary.md` — spec/text updates
- `tests/mov-imm2.test.js` — new tests (below)

## Tests (`tests/mov-imm2.test.js`)

- imm2 function table on both cores (including wrap cases)
- delay-slot PC reads on both cores, asserting LR: `SMV LR, APC`, `ALNK LR`,
  `MOV LR, PC`, `MOV LR, PC + 2` — these fail on the old JS core (verified
  by mutation), fixing a divergence the previous tests could not see
- end-to-end ALNK call/return capturing the in-flight return address
- golden words: LINK unchanged, ALNK/ALINK = SMV, disassembly round-trip
- assembler accept/reject matrix with hint-message assertions
- constant reachability: all 65536 values arithmetically, sampled values
  executed on both cores
