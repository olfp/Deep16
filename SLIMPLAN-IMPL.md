> **Inactive for the current task.** This file plans RTL area changes to the
> D16nano bitstream. The current work is **simulation alignment only** and must
> not change the D16nano implementation. Use
> [`TILESIM-IMPL.md`](TILESIM-IMPL.md) for the active plan; keep this file only
> as a hardware-area reference.

# D16nano slim-down — implementation plan

Status: **plan, 1 Nov 2026.** Derived from `SLIMPLAN.md`, `HARDWARE.md`,
`doc/FiT-Graphics-howto.md` and the current RTL. No Gowin toolchain or build
reports exist in this checkout, so the first task is a fresh measurement, not a
code change.

## 0.0 The newest numbers are not in SLIMPLAN

`doc/FiT-Graphics-howto.md` §5.6 records a later synthesis than SLIMPLAN's
28 Oct figure:

| | used | total | free |
|---|---:|---:|---:|
| CLS | **4,309** | 4,320 | **11** |
| Logic | 7,410 | 8,640 | 1,230 |
| Registers | 3,011 | 6,771 | 3,760 |
| BSRAM | **26** | 26 | **0** |
| SSRAM | 190 | – | – |

Timing in that report: `dvi_render` 30.125 MHz, `dvi_pixel` 78.013 MHz,
`psram_clk` 86.351 MHz, TNS 0. The guide also warns that the **26-row wrap is
not in that measurement**, so the current tree may be slightly smaller or
larger.

Consequences for this plan:

- the starting point is **11 free CLS, not 83**;
- **BSRAM is full** — any register-file-in-BSRAM work must first free blocks,
  and the audio FIFO can no longer be treated as free;
- the scroll ring is already implemented and must be preserved (§4a below), not
  cut for area.

## 0. What changed since SLIMPLAN was written

SLIMPLAN's §2 says the build "has to fit three more features: a timer interrupt,
a raster interrupt and audio". All three are already in the tree; what is missing
is wiring and area:

| Feature | State in tree | Blocker |
|---|---|---|
| 15 kHz timer tick + 32-bit timer | `rtl/deep16_timer.sv`, wired to SIC bit 1 | Working |
| Four-source SIC at `0xF00B0` | `rtl/deep16_sic.sv` | Only timer input is live |
| `core3` IRQ entry at vector 1 | `rtl/deep16_core3.sv` | Working |
| Raster line compare | `dvi_tile` control 7, `raster_toggle` + board synchroniser | `raster_src` is guarded by `` `D16_NANO `` but builds define `` `D16NANO `` |
| I2S audio + 128-sample FIFO | `rtl/deep16_i2s.sv` | `fifo_irq` is left unconnected in the top |
| Keyboard interrupt | PS/2 receiver + FIFO | Deliberately not wired (no consumer yet) |

So the work is two-track:

1. **connect** raster and audio so the existing hardware does what the software
   interface claims;
2. **recover area**, because the latest recorded build is 4,309 / 4,320 CLS
   with BSRAM 26/26. There is no room left for the D16D image's next change,
   and the 26-row wrap may already push it over.

Two SLIMPLAN statements need correcting before they become tasks:

- There is no `core5`. The full five-stage `deep16_core` has no IRQ input and is
  not in the D16nano build. Do not add interrupt logic to it "for parity".
- "Sprites 8 → 4" collides with the shipped demo: Flappy uses **five**
  concurrent sprites (bird in OAM slot 0, four clouds in 1–4). Cutting to four
  changes the game, not just the RTL. An 8 → 6 (or 5) cut is the compatible
  version; the plan treats 8 → 4 as a separate feature decision.

## 1. Target and ground rules

- **Target:** at least **100 CLS free** after the build includes timer, raster,
  SIC, audio and the D16D demo. SLIMPLAN's 150–200 CLS was padding for features
  that have since landed; 100 is the minimum that survives placement noise.
- **BSRAM target is separate:** 26/26 is acceptable if no BSRAM feature is
  added. Phase 5 needs one or two free blocks (depending on the option) and
  therefore needs a block-releasing decision first (see Phase 5).
- Free CLS is a packing quantity. Only whole-block removals count. A change that
  frees LUT4 without emptying slices is not a win (`SLIMPLAN.md` §1).
- Synthesis noise is ±30 CLS / ±60 LUT4. Any lever smaller than that needs two
  runs or a larger structural change to be believable.
- One lever per commit, with its own measurement and rollback.
- The JS core remains the oracle; no area change lands without
  `npm test` and the relevant Verilator sims.

## 2. Phase 0 — baseline (first, blocking)

**Tasks**

1. On a machine with Gowin EDA, run `npm run synth:tile` on the current tree.
2. Record from `fpga/gowin/impl/pnr/deep16_board_tile_flash.rpt.txt`:
   Logic, CLS, registers, BSRAM, DSP.
3. Record per-module LUT/ALU/FF/BSRAM from
   `fpga/gowin/impl/gwsynthesis/deep16_board_tile_flash_syn_rsc.xml`.
4. Run it twice; keep both reports to establish this machine's noise floor.
5. Record the BSRAM block inventory (which module owns how many blocks), not
   just the total. Phase 5 cannot start without it.
6. Save the commit hash and the defines (`d16tile_flash.sv`).
7. Flash the resulting `.fs` + `image.flash.bin` and confirm the demo boots.

**Gate G0:** a baseline table exists and the bitstream runs on the board.
Compare against the guide's 4,309 / 4,320 CLS, BSRAM 26/26 and
`dvi_pixel` 78.013 MHz. If CLS is already above 4,320, P&R failed and every
later phase is mandatory; if it is at or below 4,270 (≥50 free), Phases 3–5
become optional.

## 3. Phase 1 — connect raster and audio (0.5–1 day)

These are functional fixes, not diets. Measure the cost; expect under 20 LUT.

### 1a. Fix the macro typo

Replace `` `D16_NANO `` with `` `D16NANO `` in:

- `rtl/deep16_top.sv` — the `raster_src` guard (around line 242);
- `rtl/deep16_board.sv` — the raster synchroniser guard (around line 276);
- `rtl/deep16_board.sv` — the `DVI_TILE`-absent tie-off (around line 395);
- `rtl/deep16_board.sv` — the `.raster_irq` port connection guard (around line 409).

Acceptance: with `DVI_TILE`, a control-7 line compare produces one `clk_cpu`
pulse per frame, SIC PENDING bit 3 sets, and the vector-1 handler increments
`RASTER` at `0xF00B8`.

### 1b. Connect the audio interrupt

In `rtl/deep16_top.sv`, replace

```systemverilog
.src ({raster_src, 1'b0, timer_tick, 1'b0})
```

with a source vector that uses `i2s_irq` for bit 2, and delete the
`i2s_irq_unused` signal. Keep the keyboard bit at 0: an interrupt per key would
storm until a consumer masks it, and the BIOS polls the FIFO today.

Acceptance: enabling I2S `CTRL.b3` and letting the FIFO fall to 32 raises SIC
PENDING bit 2 and the handler increments `SCRATCH`.

### 1c. Tests and docs

- `npm run sim:sic`, `npm run sim:irq`, `npm run sim:i2s`.
- Add a small `core3` interrupt test (or extend `tests/ill-trap.test.js` /
  `sim:irq`) that asserts both sources enter the handler and that W1C clears.
- Update `MEMMAP.md` control-7 text, `HARDWARE.md` and
  `openwiki/project/known-gaps-and-docs.md` once the bits are live.

**Gate G1:** both interrupts observed in simulation and on the board. Record the
area delta.

## 4. Phase 2 — low-risk cleanups (1–2 days)

Order matters: do these before any feature cut, because they preserve behaviour.

### 2a. ALU shifter merge (hygiene, ~20–40 CLS)

`rtl/deep16_alu.sv` has separate `shl`/`shr`/`rot`/`rotr` networks. Merge them
into one bidirectional barrel with a shared count mux and explicit carry taps.

Note a discrepancy with SLIMPLAN §3.1: it says the shift helper is 16 bits, but
the current source declares `zext` and all four shift results as **32-bit**
(`rtl/deep16_alu.sv:35-38, 69-77`). The whole ALU is only 128 LUT, so the
achievable saving is bounded by that; treat 20–40 CLS as optimistic and measure.

- Keep the carry-out taps bit-exact; they are the hazard this refactor exists to
  remove.
- Validate against the JS core on the whole shift/rotate space, including
  `SLC`/`SRC`/`RLC`/`RRC`.
- Run `npm run sweep:rtl` and `node --test tests/flags.test.js tests/rtl.test.js`.

Measure. If it frees fewer than 10 CLS, keep it as hygiene and move on; do not
count it toward the budget.

### 2b. Regfile shadow-array simplification (low risk, target ≥10 CLS)

The shadow bank is stored as six entries and every read port computes
`shad[shad_idx(raddr)]`, then the core selects normal or shadow. Store a full
16-entry shadow array instead, writing only the six banked indexes when `S=1`.
Reads still select the shadow array only for banked indexes, but the
six-entry index mapping and its muxes disappear. This trades ~160 spare FF for
simpler read/write muxing.

- Keep the two write ports A/B and the three read ports; this is **not** the
  BSRAM conversion.
- Watch `SMV`'s inactive-bank write and debug windows.
- Measure, then keep only if it clears noise.

### 2c. Remove whatever the baseline shows as dead

Only from the Phase-0 report: unused debug paths, stale counter muxes, or
constant-folded logic that the tool did not collapse. Do not speculate.

**Gate G2:** CLS reduced by ≥30 from baseline with all tests green. If not, skip
to Phase 3 with the measured shortfall.

## 4a. Scrolling and raster are not levers

The FiT guide describes a working scrolling model that is easy to mistake for
redundant logic. It is not; each part has a distinct job:

| Control | Behaviour to preserve |
|---|---|
| 1 (`0xF2002`) | 5-bit row offset, 26-row ring; visible rows 0–23 map to `(r + off) % 26`; rows 24–25 are margins |
| 2 (`0xF2004`) | `scroll_x` 0–15, coarse `>>3` plus fine phase; latched with the display bank |
| 3 (`0xF2006`) | `scroll_y` 0–30, carries into the next map row; **not** latched |
| 4 (`0xF2008`) | write/display bank; display bank and `scroll_x` swap at the frame boundary |
| 6 (`0xF200C`) | 26-entry per-row fine-phase table, copied to a live table at the frame boundary; replaces only `scroll_x[2:0]` |
| 7 (`0xF200E`) | line compare 0–359, one toggle per frame, synchronised to SIC bit 3 |

Do **not**:

- shrink the map from 82 × 26 to 80 × 24 to save BSRAM. The two margin columns
  and rows are what make the ring and the true four-direction path work
  (guide §5.2–§5.3);
- merge the terminal row ring with the smooth scroll. They are independent
  mechanisms and games combine them;
- make the raster compare a per-scanline scroll register. The guide is explicit:
  the per-row table is latched once per frame, and raster is a timing pulse for
  palette splits / early frame work (§6.4);
- replace the ring helper with the redraw path for area. The helper is raw
  assembly and costs CPU time, not FPGA resources; the guide's recommendation
  (redraw for one-way, ring for true four-way) is about CPU budget, not CLS.

The measured cost is in guide §5.5: one ring shift is ~63,994 core3 cycles,
about 9.5 ms, and 1 px/frame is ~10.7 % of a 60 Hz frame. Any change here is a
performance regression, not a diet.

Any change to `dvi_tile` (OAM count, sprite pages, register file) must keep
`tests/scroll4.test.js`, `tests/tile-console.test.js`, the showcase tests and
`npm run sim:dvi:tile` green. That simulator exercises scroll, per-row phases,
the raster toggle and the eight-sprite chain.

## 5. Phase 3 — sprite count (2–3 days, visible feature)

The guide is explicit about the shape of the layer:

- **eight visible OAM slots**, two words each (`0xF5000`–`0xF500F`);
- **24 pattern groups** in hardware, three pages of eight; control 5 selects
  only the CPU's write page, never what the renderer displays;
- slot 0 wins priority; Flappy is "a bird, four parallax clouds and animated
  wing/dizzy poses" and uses **five** slots (bird 0, clouds 1–4).

So:

- **8 → 4 is not compatible** with the shipped demo. Four slots hold the bird
  and only three of the four clouds.
- The compatible cuts are **8 → 6** (one spare, two fewer comparators) or
  **8 → 5** (exactly Flappy, three fewer).
- Reducing OAM slots does **not** reduce pattern groups or BSRAM. If BSRAM is
  the constraint, that is a separate change (24 → 16 or 8 groups), with the
  documented cost that dropping to one page loses the red/purple/yellow bird
  selection (SLIMPLAN §6.1 measured +33 CLS and −6 BSRAM, i.e. no CLS win).

**Tasks**

1. Parameterise the OAM depth and priority chain in `rtl/dvi/dvi_tile.sv`
   (OAM slots, comparators, priority width). Leave `SPR_GROUPS = 24` alone
   unless the BSRAM decision below explicitly changes it.
2. Decide 6 or 5 with the game owner; 5 is the minimum that preserves Flappy.
3. Update `MEMMAP.md` (`0xF5000` OAM), `VIDEO.md`,
   `doc/FiT-Graphics-howto.md` §1/§7, and `openwiki/hardware/` if the slot
   count changes.
4. Adjust `asm/showcase/flappy_game.asm` only if the chosen count is below 5.
5. Run `tests/tile-console.test.js`, `tests/showcase-*.test.js`,
   `tests/scroll4.test.js`, `npm run sim:dvi:tile`, and `npm run ui:shot`.

Expected, using SLIMPLAN's measured 8 → 4 range (60–110 LUT4 for four
comparators): 8 → 6 is 30–55 LUT4 ≈ **15–28 CLS**; 8 → 5 is 45–82 LUT4 ≈
**22–41 CLS**. Still not enough alone; it is a contributing feature decision.

**Gate G3:** demo unchanged at the chosen count, screenshot matches, measured
delta recorded. If the cut breaks the cloud count, stop and choose a different
lever.

## 6. Phase 4 — 16-bit timer (0.5 day, only if short)

`rtl/deep16_timer.sv` is 32-bit count + 32-bit compare + 16-bit prescaler.

- Make the visible counter 16-bit with a 16-bit compare; document the 65.5 s
  wrap.
- Update `FORTH.md`, `MEMMAP.md` `0xF0020` block, and any timer words.
- Run `npm run sim:timer` and a wrap test that crosses 0xFFFF.
- Expected 10–15 CLS. Reject if it costs a software-visible compatibility break
  the kernel does not already tolerate.

## 7. Phase 5 — register file into BSRAM (spike, 2–3 days, decision gate)

SLIMPLAN calls this "1-write/2-read BSRAM". The actual interface is **3 read
ports and 2 write ports**, which no single BSRAM port set provides. Do not start
this as an implementation; start it as a timeboxed prototype.

**Blockers to resolve first**

- **BSRAM is 26/26.** The latest report has zero free blocks. Two blocks must be
  released before this prototype can even be placed.
- Three read ports (`raddr1/2/3`: operand 1, operand 2, and the third for `ST`
  source / `Rd+1` / `LDS`/`STS` data / `SMV` source).
- Two write ports (A = `Rd`, B = `Rd+1` for `MUL32`/`DIV32`, and the inactive
  bank for `SMV`).
- Bank switching driven by `PSW.S` at commit, which affects which bank a younger
  instruction reads.
- Board debug is tied off, so the debug port is already free; do not design for
  it.

**Ways to release the two blocks (choose before prototyping)**

- Reduce the sprite pattern bank from 24 groups (3 pages) to 8 (1 page): frees
  ~6 blocks, but loses the red/purple/yellow bird choice. SLIMPLAN §6.1 measured
  this at +33 CLS (noise) and BSRAM 23 → 17 on the older build, so it is a
  **BSRAM enabler with a feature cost**, not a CLS lever.
- Reduce the tile bank from 128 to 96 tiles only if the baked art tiles are
  relocated; the CPU window already covers 96, and the showcase uses 14 of the
  baked 32. This is not a simple parameter change.
- Find blocks the baseline report shows as unused or duplicated. Do not guess;
  use the per-module BSRAM numbers from Phase 0.

**Options to prototype**

1. Two true-dual-port BSRAMs for the normal bank (mirrored contents) → 4R/2W,
   **2 blocks**, with the six-entry shadow bank left in flops. The real cost is
   mirroring every write into both blocks and proving the two write ports never
   target diverging contents.
2. One dual-port BSRAM for the normal bank plus a one-cycle operand-3 read with
   a stall for the classes that need it. Costs a pipeline bubble on `ST`,
   `LDS`/`STS`, `MUL32`/`DIV32`; re-times the core, but needs one block, not
   two.
3. Keep the normal bank in flops and move only the shadow bank (six entries) to
   a BSRAM. Almost no CLS win; listed to show why the shadow alone is not worth
   it.

**Gate G5:** prototype reaches ≥150 CLS saving *and* closes timing at the target
clock, with full tests and a board boot. If it cannot get the blocks its chosen
option needs, or either check fails, abandon and keep the flop register file. Do
not let this phase block Phases 1–4.

## 8. Phase 6 — fallbacks (only if still short)

In order:

1. **720p → 480p** tile output: 50–100 LUT4, a visible regression. Needs a
   product decision, not an engineering one.
2. **Feature diet:** drop the D16D demo/sprite bank and ship a sound build
   without the game. This is an afternoon, but it deletes the reason the tile
   build exists.

Both are named so they are not discovered late, not because they are preferred.

## 9. Order and decision tree

```
Phase 0  baseline + board boot
   |
   +--> Phase 1  fix D16NANO typo, wire i2s_irq     (do regardless)
   |
   +--> Phase 2a ALU merge        (~20-40 CLS)
   +--> Phase 2b shadow full array (~10-20 CLS)
   |
   |   after 2: free >= 100 CLS? -- yes --> Phase 3 optional, stop
   |                              -- no  --> Phase 3 (OAM 8->6/5)
   |
   |   still short? --> Phase 4 (16-bit timer)
   |   still short? --> Phase 5 spike (regfile BSRAM)
   |   still short? --> Phase 6 fallback (product decision)
```

Phase 1 is not optional: without it the hardware does not match the documented
interrupt model, regardless of area.

## 10. Measurement protocol (every phase)

1. `npm run synth:tile`.
2. Copy `rpt.txt` and `syn_rsc.xml` into a phase-named folder outside the repo
   (or attach the numbers to the commit message).
3. Record CLS, LUT4, FF, BSRAM, DSP, and the worst timing path (the phase-2a
   `dvi_pixel` 65.973 MHz note in `HARDWARE.md` shows area work can move Fmax).
4. Run `npm test`; run the phase-specific sim.
5. Flash and boot the demo; for sprite/interrupt changes, exercise the feature
   on hardware, not only in simulation.
6. Revert the commit if it does not clear the noise floor or if timing regresses.

## 11. Risks

| Risk | Mitigation |
|---|---|
| No Gowin toolchain in this checkout | Phase 0 must run on the synthesis host; do not guess numbers |
| Current build already exceeds the device | Phase 1 measures it; Phases 2–4 are the minimum path |
| Synthesis noise hides a small win | two runs, and a >30 CLS threshold for "landed" |
| ALU merge breaks a carry tap | JS oracle, full shift space, `sweep:rtl`, own commit |
| OAM cut breaks Flappy | choose 5 or 6, or change the demo explicitly |
| BSRAM regfile cannot serve 3R2W | timebox the spike; fall back to flop regfile |
| Raster IRQ storms every frame | software W1C + enable mask; test a masked and an unmasked frame |
| Area work moves Fmax | record timing every phase; 720p is the hard constraint |

## 12. Definition of done

- Raster and audio interrupts are live on the board, with tests.
- `npm test` green, `sweep:rtl` reports 0 divergences, board demo boots and
  plays.
- The flashed bitstream leaves **≥100 CLS** free with the D16D image.
- `SLIMPLAN.md`, `HARDWARE.md`, `MEMMAP.md` and the OpenWiki hardware/gaps pages
  agree with the measured state.
