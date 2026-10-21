# IMPROVE — Instruction-decode cleanup (Deep16 CPU)

Status: planned, not applied. Work in progress elsewhere; do not merge with
in-flight changes without rebasing.

## Problem

Instruction decoding in the RTL core (`rtl/deep16_core.sv`) makes several
decisions too early: register-read enables and divider arming are derived from
the instruction *class* only, not from whether the read/operation is actually
used. Decode is also scattered across several independent `always_comb` blocks
(`cls`/`ext_id`, `ra1..ra3`, `smv_idx`, `sel_stack`/`sel_extra`), each
re-deriving pieces from `id_ex.instr`. Consequences:

- False load-use stalls: `LD`/`LDS` read a store source that does not exist;
  `ALU` always reads `Rs` (even immediate forms) and `Rd+1` (even when only
  `DIV32` needs it); `MOV` reads `Rs` even when `Rs==15` (PC source);
  `LSI`, `SMV` and `SOP`/`LPSW` read registers they never use.
- Spurious divider arming: `alu_is_div`/`alu_is_div32` key off `alu_func5`
  alone, so a non-ALU word can arm `deep16_divider`.
- Scattered decode is where future opcode changes desync one block from another.

Observable decode is already consistent (decode sweep 0 divergences / 524k
executions); this is a cleanliness/performance cleanup, not a correctness fix.
Architectural state must not change; stall counts may drop.

## Plan (RTL-first, behaviour-preserving)

All edits in `rtl/deep16_core.sv`. Steps 1-5 are small and safe; Step 6 is
optional and larger.

### Step 1 — Add "actual use" flags to the decode block
In the `cls`/`ext_id` combinational block also compute:
- `alu_uses_rs`  = `(alu_func5[4]==0 && alu_func5[0]==0) || (alu_func5[4:2]==3'b111)`
  (mirrors `is_reg` in `deep16_alu.sv`)
- `alu_reads_rd1` = `(alu_func5 == 5'b11111)` (DIV32 only; MUL32 writes but
  does not read `Rd+1`)

### Step 2 — Gate divider arming by class
AND `alu_is_div`/`alu_is_div32` with `cls == 3'd4` (ALU) in `div_needs_hw`.

### Step 3 — Gate register-read enables by actual need
Rewrite the `ra1/ra2/ra3` block:
- `LD`/`ST` (cls 3): `ra1` (base) always; `ra3` (source) only if `instr[13]` (ST).
- `ALU` (cls 4): `ra1` (Rd) always; `ra2` (Rs) only if `alu_uses_rs`;
  `ra3` (Rd+1) only if `alu_reads_rd1`.
- `LDS`/`STS` (ext 1): `ra1` (base) always; `ra3` (data) only if `instr[10]` (STS).
- `MOV` (ext 2): `ra1` (Rs) only if `instr[5:2] != 4'd15`.
- `LSI` (ext 3): no read enable.
- `SMV` (ext 4): no read enable (uses `r_inact`/context).
- `SOP` (ext 6): `ra1` only if `instr[5:4] != 2'd3` (not LPSW).
- `JML` (ext 8): both as before.
- else: no enables.

### Step 4 — Centralize scattered decode
Move `smv_idx` and `sel_stack`/`sel_extra` computation into the same decode
block so all instruction-derived signals originate in one place; keep
`cls`/`ext_id` as the single source of truth.

### Step 5 — Verify
- `npm test` (decode sweep + fuzz + rtl parity) green.
- `npm run sweep:rtl` (4 seeds) still 0 divergences.
- Re-check `get_stall_count()` on representative programs; expect <= previous.

### Step 6 (optional, larger)
Move the decode block into the ID stage and carry `cls`/`ext_id`/read-enables
in `id_ex`, letting EX consume the decoded bundle. Do Steps 1-5 first and
measure before touching the pipeline.

## Out of scope
- Behavioural cores (JS/WASM): decode is already class-gated by switch/match.
- Spec/docs: FPU opcodes remain reserved no-ops; encoding unchanged.
- Architectural state changes: none intended.