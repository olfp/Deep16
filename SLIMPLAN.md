# Slimming the D16nano build

Status: **design note, nothing implemented.** The user-flash tile build (the
one with sprites, the D16D demo, SD, PS/2 and the HDMI console) is at
**4,242 / 4,320 CLS** and has to fit three more features: a timer interrupt, a
raster interrupt and audio. This note records the budget, the levers, and the
one measurement that decides how hard the diet is.

Companions: `AUDIOPLAN.md` (what the audio actually needs), `HARDWARE.md`
(current fit report and what is already built), `DVI720check.md` (why the tile
build exists), `doc/Interrupts.md` (the ISA interrupt model).

## 1. The budget, and why "78 free CLS" is not a LUT count

Measured cost of the tile/user-flash build, 27 Oct 2026
(`HARDWARE.md`, after PS/2, timer, SPI, UART TX and the three-bird sprite
bank):

| | used | total | free |
|---|---|---|---|
| CLS | 4,242 | 4,320 | **78** |
| LUT4 | 8,208 | 8,640 | 432 |
| FF | 2,965 | 6,771 | 3,806 |
| BSRAM | 23 | 26 | 3 |
| I/O | 26 | 71 | 45 |

8,208 LUT4 in 4,242 CLS is **1.93 LUT per slice**: LUT4 utilisation is 95 %,
slice occupancy is 98 %. Free CLS is therefore a *packing* quantity, not a LUT
count — a slice frees only when both of its LUT4 halves go away. Those 432
scattered LUT4 do not become 216 CLS, they become 78.

Practical consequence: the diet must remove **whole blocks**, so that their
slices empty completely. Shaving individual LUTs across many modules will free
LUT4 and almost no CLS.

## 2. What has to fit

Estimates, ±40 % until a synthesis report exists.

| Item | CLS | Note |
|---|---|---|
| Timer IRQ in the core (`core3`, and `core5` for parity) | 12–20 | reuses the SWI entry path |
| 15 kHz tick counter | 8–12 | 450 cycles; 450 divides 6750, so it stays in lock with the ms timebase |
| Raster IRQ (line compare + CDC into the CPU domain) | 10–20 | the tile engine already has the line counter |
| Minimal 2-source SIC (pending + cause/ack) | 8–12 | needed once there are two sources |
| Audio (sigma-delta + sample/volume regs, no FIFO) | 30–40 | `AUDIOPLAN.md` §2, §4 |
| **total** | **68–104** | |

With placement margin the target is to free **150–200 CLS ≈ 300–400 LUT4**.

## 3. Lever 1 — the ALU is carrying ~5–6 % of the device

This is the surprise: the video path is not the problem, the arithmetic unit
is.

`rtl/deep16_alu.sv:74-79`:

```systemverilog
shl     = zext << count;                        // 32-bit barrel, 4 stages
shr     = zext >> count;                        // 32-bit barrel, 4 stages
rot     = (zext << count) | (zext >> sh16);     // plus another 32-bit barrel
rotr    = (zext >> count) | (zext << sh16);     // plus another 32-bit barrel
fill_lo = (count > 0 && cbit) ? (32'h1 << (count - 1))   : 32'h0;
fill_hi = (count > 0 && cbit) ? (32'h1 << (15 - count))  : 32'h0;
```

`count` is `opv_i[3:0]` and `sh16` is `16 - count` (`:56-57`), so the rotates
are **not** reuse of `shl`/`shr` — they are two further independent shift
networks with a different count. Four 32-bit variable shifters and two one-hot
masks, all combinational, all evaluated every cycle, of which at most one
result per instruction is ever used.

Size: a 32-bit, 4-stage barrel is ~128 LUT4, so the four are ~400–500 LUT4
(the one-hot masks are ~32 LUT4 total — only 16 bits of each are used). At
1.93 LUT/CLS that is **roughly 200–260 CLS, ~5–6 % of the device**, in one
module.

The clock does not justify it: the nano core runs at **6.75 MHz = 148 ns per
instruction**, and a barrel-shifter stage is a 2:1 mux, ~1–2 ns. This logic is
built for ~20× the frequency it runs at.

### 3.1 The restructure

- One bidirectional barrel shifter with a count mux (`count` or `sh16`) and a
  direction/mode select; `SL`/`SR`/`SRA`/`ROL`/`ROR` come out of it directly.
- `RLC`/`RRC` are the same shifter plus the carry inject, not a second network.
- `fill_lo`/`fill_hi` stay as small decoders (they are cheap already) or are
  produced by shifting a single `cbit` through the same barrel.

Expected saving **300–500 LUT4 ≈ 150–260 CLS**: on its own, more than the
whole §2 ask.

### 3.2 The two things that will bite

1. **The carry taps.** `carry_bit` is taken from `zext[sh16]` and
   `zext[{1'b0, count} - 5'd1]` (`:183-200`), i.e. from the *input*, not the
   shifter output. If the restructure moves to a shared barrel, those taps must
   come from the same muxed network or `SL`/`SR`/`RLC`/`RRC` carry semantics
   change silently. This is the bug the test suite would catch last.
2. **The ALU is shared.** `deep16_alu.sv` is instantiated by both
   `deep16_core3.sv` and the five-stage `deep16_core.sv`, so the 13.5 MHz full
   build must re-close (74 ns of slack — safe, but it has to be run).

### 3.3 Why it is safe to do

The CPU suite compares every ALU group against the JS golden core, including
the shift/rotate/carry cases. This is a single-file refactor with an existing
oracle, not a speculative rewrite.

## 4. Lever 2 — the multiplier is the coin flip

`prod32 = rdv * opv_i` (`rtl/deep16_alu.sv:81`). The GW1NR-9 has **34 DSP
blocks** (18×18), and nothing in the repo says whether this multiply maps to
one — no synthesis report is committed.

- If it already maps to a DSP: no lever, move on.
- If it does not: a 16×16 in LUTs is ~250–300 LUT4, and
  `(* multstyle = "dsp" *)` (or the corresponding synthesis option) moves it
  into one DSP for free — **~100–150 CLS**.

This single fact decides whether the diet is comfortable or tight, and it costs
one synthesis run to find out.

## 5. Lever 0 — synthesis options, free

`fpga/gowin/build_tile_flash.tcl` sets `-verilog_std`, `-place_option 0` and
`-route_option 1`, and no synthesis options at all, so Gowin defaults apply.
On an ALU this redundant, area optimisation / resource sharing typically
recovers 3–8 %. Try it before refactoring anything: one run, zero risk.

## 6. Lever 3 — sprites 8 → 4

The per-pixel sprite path is the second-largest removable block. For each of
eight sprites, every output pixel builds a candidate from a 16-bit row word, a
nibble shifter, an 11-bit x-compare and a barrel-height test, then a 48-bit
priority chain picks the winner (`rtl/dvi/dvi_tile.sv:424-429`, `:483-500`).

Halving it saves **60–110 LUT4 ≈ 30–55 CLS**. The D16D demo uses three birds,
and the OAM is two words per sprite, so the change is visible in the API
documented in `VIDEO.md`.

## 7. Lever 4 — a 16-bit timer

`rtl/deep16_timer.sv` carries a 32-bit millisecond counter, a 32-bit compare
and a 16-bit prescaler. A 16+16 timer wraps at 65.5 s and frees **~40 LUT4 ≈
20 CLS**, at the cost of a documented wrap. Low risk, small yield.

## 8. Not levers

- **BSRAM-only cuts** (`SPR_GROUPS 24→8`, `TILE_COUNT 128→96`, tilemap
  82×26→80×24, the keyboard FIFO) free blocks, not CLS. Useful if audio wants
  a FIFO block (`AUDIOPLAN.md` §4), not for the interrupt work.
- **The debug bus is already free.** The board ties `dbg_en`/`dbg_we` to 0
  (`rtl/deep16_board.sv:408-412`), so the register file's debug port is
  constant-folded out. Nothing to reclaim.
- **The five-stage core and the text renderer** are already excluded from this
  build by `D16NANO`/`DVI_TILE`; unused modules cost nothing.

## 9. What not to cut

- **720p.** It is the reason the tile build exists and the result of
  `DVI720check.md`. A 480p fallback would free 50–100 LUT4 and is available as
  a last resort, but treat it as a regression, not a diet.
- **The 256×8 PSRAM cache and the PSRAM controller.** This is the machine's
  memory performance; cutting it shows up as "the Forth got slower".

## 10. The structural alternative

If the ALU refactor is too invasive right now, a **feature diet** fits the same
three features immediately: a "sound build" without the eight-sprite bank and
the D16D demo drops both the sprite comparators (CLS) and two BSRAM blocks.
The catch is obvious — it deletes the game, which is presumably why sound is
wanted. Worth naming because it is an afternoon, not a refactor.

## 11. Order of work

1. **Measure.** Produce one synthesis report: total LUT4/CLS, the DSP row, and
   per-module area for `deep16_alu`, `dvi_tile`, `deep16_core3`. Every number
   in this note is ±40 % until then.
2. **Try `-opt_area` / resource sharing.** Zero risk, one run.
3. **If DSPs are unused, map `prod32`.** One attribute, ~100 CLS.
4. **Consolidate the ALU shifters.** The real diet: 150–260 CLS, its own
   commit, CPU suite green, both cores re-closed.
5. Only if still short: sprites 8→4, then the 16-bit timer.
6. Then build the interrupt first (§2), the raster compare, and audio last.

## 12. Measurement checklist

- `synth:tile` with a saved report; record Logic / CLS / Register / BSRAM /
  **DSP** and the per-module table.
- Same for `synth:tile:packed`, so the 672-CLS console build can be compared
  as a control.
- After each lever, re-record CLS *and* LUT4: a lever that frees many LUT4 and
  few CLS has not helped, and that is the signal to look at packing instead.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Estimates are ±40 % and the budget is 1.8 % of the device | report first (§11.1); do not commit to a feature list before it |
| ALU refactor breaks a shift/rotate carry case | the JS golden core is the oracle; land it as its own commit |
| 13.5 MHz full core timing | re-run `synth:board` after the ALU change |
| Fitter cannot place even with free CLS | prefer whole-block removals (§1); leave 100+ CLS of margin, not 20 |
| The diet becomes an excuse to keep adding | this note is about fitting three named features, not free space |

## 14. Open questions

1. **Is `prod32` on a DSP?** One report answers it, and it changes the plan's
   difficulty more than any other fact.
2. **Is the 8-sprite bank load-bearing?** If the demo can live with 4, that is
   the cheapest visible-feature cut.
3. **Is 720p negotiable?** If not, the ALU is the only serious lever.
4. **Does the ALU refactor go in before or after the interrupt work?** Before,
   because it is the only lever that creates margin for the placement step;
   after, if you need the interrupt sooner than the area.
