# Slimming the D16nano build

Status: **design note; the budget, the per-module split and the "free" synthesis
lever are measured (28 Oct 2026).** The loader's read-back verify has been
dropped and the user-flash read port (2 KB Forth source screens) has landed —
that pair cost a net **6 CLS**. The user-flash tile build (the one with sprites,
the D16D demo, SD, PS/2 and the HDMI console) is at **4,237 / 4,320 CLS** and
has to fit three more features: a timer interrupt, a raster interrupt and
audio.

Companions: `archive/AUDIOPLAN.md` (what the audio actually needs), `HARDWARE.md`
(current fit report and what is already built), `archive/DVI720check.md` (why the tile
build exists), `doc/Interrupts.md` (the ISA interrupt model),
`archive/24k-bsram/README.md` (the retired 24K builds).

## 1. The budget, and why "83 free CLS" is not a LUT count

Measured cost of the tile/user-flash build, 28 Oct 2026 (`npm run synth:tile`):

| | used | total | free |
|---|---|---|---|
| CLS | 4,237 | 4,320 | **83** |
| LUT4 | 7,215 (6,473 LUT + 742 ALU) | 8,640 | 1,425 |
| SSRAM | 178 | – | – |
| FF | 2,985 | 6,480 | 3,495 |
| BSRAM | 23 | 26 | 3 |
| DSP | 0.5 | 10 | 9.5 |
| I/O | 26 | 71 | 45 |

The segmented map took the build from 4,242 CLS / 78 free to 4,314 / 6: the
three scatter copies, the read-back verify and `es@`/`es!`. Dropping the verify
then freed 83 CLS (Logic 8,483 → 8,203, LUT 6,637 → 6,393) and the flash read
port spent 6 of them (4,231 → 4,237). **83 CLS free** is the margin left for the
interrupts and audio.

7,215 LUT4 in 4,237 CLS is **1.70 LUT per slice**: slice occupancy 99 %, LUT4
utilisation 83 %. Free CLS is a *packing* quantity, not a LUT count — a slice
frees only when both of its LUT4 halves go away. Those 1,425 LUT4 do not become
700 CLS, they become 83.

Practical consequence: the diet must remove **whole blocks**, so that their
slices empty completely. Shaving individual LUTs across many modules will free
LUT4 and almost no CLS.

## 2. What has to fit

Estimates, ±40 % except where a measurement exists.

| Item | CLS | Note |
|---|---|---|
| Timer IRQ in the core (`core3`, and `core5` for parity) | 12–20 | reuses the SWI entry path |
| 15 kHz tick counter | 8–12 | 450 cycles; 450 divides 6750, so it stays in lock with the ms timebase |
| Raster IRQ (line compare + CDC into the CPU domain) | 10–20 | the tile engine already has the line counter |
| Minimal 2-source SIC (pending + cause/ack) | 8–12 | needed once there are two sources |
| ~~Flash read port (2 KB screens from the user flash)~~ | **6 measured** | shares `flash_boot`'s `flash608k_read`; done 28 Oct, net of the verify removal |
| Audio (sigma-delta + sample/volume regs, no FIFO) | 30–40 | `archive/AUDIOPLAN.md` §2, §4 |
| **total (remaining)** | **68–112** | |

With placement margin the target is to free **150–200 CLS ≈ 260–350 LUT4**.

## 3. Where the logic actually is (measured)

From `impl/gwsynthesis/deep16_board_tile_flash_syn_rsc.xml`, which the flow
already writes — per module, excluding children:

| module | LUT | ALU | FF | BSRAM | note |
|---|---|---|---|---|---|
| `u_dvi_tile` | **1,567** | 276 | 833 | 20 | tile engine + sprites, 24 % of the LUT |
| `u_regfile` | **1,180** | – | 336 | – | 16 registers × 2 banks, three read ports |
| `u_core` (excl. children) | 2,010 | 149 | 452 | – | core3 pipeline, decode, control |
| `u_flash_boot` | **297** | 16 | 291 | – | loader, now with the CPU read port |
| `u_psram_mem` (excl. children) | 305 | 36 | 153 | 2 | cache tag/data |
| `u_uart` | 206 | – | 98 | – | 8 SSRAM |
| `u_dvi_out` | 140 | – | 11 | – | mostly the three `enc_*` (135) |
| `u_alu` | **128** | 32 | – | – | **1 DSP**; 2 % of the LUT |
| `u_timer` | 124 | – | 80 | – | 32-bit ms counter |
| `deep16_board` itself | 119 | 29 | 121 | – | pad tristates, heartbeat, muxes |
| `u_ps2` | 95 | – | 72 | 1 | |
| `u_psram_ctrl` | 81 | 13 | 126 | – | |
| `u_spi` | 55 | 7 | 49 | – | |

### 3.1 The ALU is not the lever the last note thought it was

The previous version of this note called the ALU "5–6 % of the device" and the
main lever (150–260 CLS), on the assumption of four **32-bit** barrel shifters.
It is **130 LUT — 2 % of the LUT, ~1.5 % of the CLS**. Two reasons:

- The machine is 16-bit: `zext` is 16 bits wide, so a barrel stage is a 16-bit
  2:1 mux, not 32-bit.
- After synthesis the four shift expressions already share most of their
  network; what is left is the count muxes and the two one-hot carry masks.

Consolidating `shl`/`shr`/`rot`/`rotr` into one bidirectional barrel is still a
good cleanup and removes a real hazard (the carry taps), but it buys **~20–40
CLS, not 150–260**. It is no longer the plan's foundation.

### 3.2 The two blocks that matter

- **`u_dvi_tile`, 1,567 LUT.** The sprite path is the removable part (§6).
- **`u_regfile`, 1,180 LUT.** Not mentioned in the last note at all. 32 words ×
  16 bits is 512 flops worth of state, but three combinational read ports with
  forwarding cost ~1,200 LUT. With **3 BSRAM blocks free**, a 1-write/2-read
  BSRAM register file plus a forwarding stage would free most of that (~250+
  CLS) — but it adds a cycle to operand read and re-times the pipeline, so it is
  a structural change, not a diet. Named here as the biggest single opportunity,
  with the pipeline work as its price.

### 3.3 `u_flash_boot`: 470 LUT → 297, and the read port landed

The loader grew with the segmented map: three scatter copies (flat, `DS=0x1000`
data, `CS=0x3000` BIOS) plus the read-back verify of all three. The verify was
belt-and-braces over the CRC-16 which already covers the flash read; it only
added coverage of the PSRAM *write*. Dropping it removed 173 LUT (470 → 297 own,
Logic 8,483 → 8,203, CLS 4,314 → 4,231), and the flash read port then added
back ~150 LUT / 6 CLS net (u_flash_boot 307, u_top's MMIO 15). That is the pair
this note asked for in §2, and it is in.

The per-module numbers also show **±60 LUT of run-to-run movement** between
synthesis runs (`u_regfile` 1,180↔1,255, `u_core` 1,944↔2,010) when the RTL
barely changes. Treat a single-run LUT delta under ~50 as noise; CLS can move
±30 for the same reason (§6).

## 4. Lever 2 — the multiplier: resolved, no lever

The last note called this the coin flip. It is not: the current report shows
**DSP 0.5 / 10, MULT18X18 = 1**, i.e. `prod32` is already inferred into a DSP.
Nothing to add, nothing to gain. (The note also said 34 DSP blocks; the part has
**10**.)

## 5. Lever 0 — synthesis options: measured, empty

Tried on 28 Oct 2026 with a scratch Tcl (`-output_base_name deep16_area_try`):

- `set_option -opt_area` does not exist in this Gowin version — `unknown option`.
- `set_option -resource_sharing 1` is accepted and changes **nothing**: the P&R
  report is identical to the default run (Logic 8,483, CLS 4,314, registers
  2,969, BSRAM 23, measured before the verify removal). The design has no
  shareable arithmetic left at that level.

`-place_option 0`/`-route_option 1` are already what the build uses. So there is
no free area here; the last note's "try it first, zero risk" is answered with
"tried, zero".

## 6. Lever 3 — sprites 8 → 4

With the per-module numbers, this is now the largest *cheap* cut inside
`u_dvi_tile`. For each of eight sprites, every output pixel builds a candidate
from a 16-bit row word, a nibble shifter, an 11-bit x-compare and a
barrel-height test, then a 48-bit priority chain picks the winner
(`rtl/dvi/dvi_tile.sv:424-429`, `:483-500`).

Halving it should save **60–110 LUT4 ≈ 30–55 CLS**. The D16D demo uses three
birds, and the OAM is two words per sprite, so the change is visible in the API
documented in `VIDEO.md`.

### 6.1 Measured: one sprite page with no page select

Question asked: Flappy shows one bird at a time plus its crash poses and four
clouds — can the bank be one page, and what does dropping the 3-page select
buy? Measured 28 Oct 2026 (`SPR_GROUPS 24 → 8`, `sprite_page` removed, same
otherwise):

| | 3 pages | 1 page | delta |
|---|---:|---:|---:|
| CLS | 4,237 | 4,270 | **+33** |
| Logic | 8,283 | 8,341 | +58 |
| BSRAM | 23 | 17 | **−6** |
| `u_dvi_tile` LUT | 1,567 | 1,564 | −3 |

It fits: one page already holds cloud (rel 2), the three crash poses (3–5) and
two wing poses (6–7), and the demo shows one bird at a time. But the "3× mux"
is not a render-path mux — the page is just two address bits into the sprite
BSRAM — so removing it saves **3 LUT**, and the CLS/Logic movement is packing
noise. The real gain is **6 BSRAM blocks** (for audio's FIFO, if it wants one),
at the price of the red/purple/yellow bird choice. **Not worth it for CLS.**


## 7. Lever 4 — a 16-bit timer

`rtl/deep16_timer.sv` is 126 LUT / 80 FF: a 32-bit millisecond counter, a 32-bit
compare and a 16-bit prescaler. A 16+16 timer wraps at 65.5 s and frees maybe
**20–30 LUT ≈ 10–15 CLS**, at the cost of a documented wrap. Low risk, small
yield.

## 8. Not levers

- **BSRAM-only cuts** (`SPR_GROUPS 24→8`, `TILE_COUNT 128→96`, tilemap
  82×26→80×24, the keyboard FIFO) free blocks, not CLS. Useful if audio wants a
  FIFO block (`archive/AUDIOPLAN.md` §4), not for the interrupt work.
- **The debug bus is already free.** The board ties `dbg_en`/`dbg_we` to 0
  (`rtl/deep16_board.sv:408-412`), so the register file's debug port is
  constant-folded out. Nothing to reclaim.
- **The five-stage core and the text renderer** are already excluded from this
  build by `D16NANO`/`DVI_TILE`; unused modules cost nothing.
- **The ALU shifter merge alone** (§3.1): worth doing as hygiene, not as budget.

## 9. What not to cut

- **720p.** It is the reason the tile build exists and the result of
  `archive/DVI720check.md`. A 480p fallback would free 50–100 LUT4 and is available as a
  last resort, but treat it as a regression, not a diet.
- **The 256×8 PSRAM cache and the PSRAM controller.** This is the machine's
  memory performance; cutting it shows up as "the Forth got slower".

## 10. The structural alternative

If the RTL diet is too invasive right now, a **feature diet** fits the named
features immediately: a "sound build" without the eight-sprite bank and the D16D
demo drops both the sprite comparators (CLS) and two BSRAM blocks. The catch is
obvious — it deletes the game, which is presumably why sound is wanted. Worth
naming because it is an afternoon, not a refactor.

## 11. Order of work

1. ~~Measure (§11.1 of the old note).~~ Done 28 Oct 2026: §1 and §3 are measured
   from the flow's own reports (`impl/pnr/*.rpt.txt`,
   `impl/gwsynthesis/*_syn_rsc.xml`). Note that `simplif`-style per-module CLS
   does not exist in Gowin's report — only per-module LUT/ALU/FF/BSRAM, which is
   what §3 uses.
2. ~~Try `-opt_area` / resource sharing.~~ Done: no such option, and
   `-resource_sharing` is a no-op (§5).
3. ~~Drop the loader's read-back verify (keep the CRC), then add the flash read
   port and `screen ( n -- )`.~~ Done 28 Oct 2026: CLS 4,314 → 4,237 (83 free),
   `tests/segmented.test.js` green, screen 0 runs from the flash in the JS core.
4. **Sprites 8 → 4** if more CLS is needed (§6). The 1-page/3-page question is
   measured and answered: it is a BSRAM trade, not a CLS one (§6.1).
5. **Open question, not a plan: `u_regfile` into BSRAM** (§3.2). Biggest single
   win, needs the pipeline re-timed.
6. Then the interrupt first (§2), the raster compare, and audio last.
7. **The ALU shifter merge** whenever it is convenient (§3.1): hygiene and the
   carry-tap hazard, not budget.

## 12. Measurement checklist

- `npm run synth:tile` writes `impl/pnr/deep16_board_tile_flash.rpt.txt`
  (Logic/CLS/Register/BSRAM/**DSP**) and
  `impl/gwsynthesis/deep16_board_tile_flash_syn_rsc.xml` (**per module**).
- The old control build, `synth:tile:packed` (1959-byte resource file,
  `deep16_board_tile_syn_rsc.xml`, 22 Oct), is archived — if it is needed as a
  control again, restore it from `archive/24k-bsram/` rather than re-creating
  it.
- After each lever, re-record CLS *and* LUT4: a lever that frees many LUT4 and
  few CLS has not helped, and that is the signal to look at packing instead.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Estimates are ±40 % and the budget is 0.14 % of the device (6 of 4,320 CLS) | the measured §3 split, not a feature list, decides what is possible |
| The ALU refactor breaks a shift/rotate carry case | the JS golden core is the oracle; land it as its own commit |
| Timing of the full five-stage core | **no longer checked by a bitstream flow** — `synth:board` is archived; only the nano build has a Gowin target, so the shared ALU's timing is only proven at 6.75 MHz. Functional parity is still covered by the CPU suite (all three cores). |
| Fitter cannot place even with free CLS | prefer whole-block removals (§1); leave 100+ CLS of margin, not 20 |
| The diet becomes an excuse to keep adding | this note is about fitting the named features, not free space |

## 14. Open questions

1. ~~Is `prod32` on a DSP?~~ **Yes** (§4): `DSP 0.5/10`, one MULT18X18.
2. **Is the 8-sprite bank load-bearing?** If the demo can live with 4, that is
   the cheapest visible-feature cut (§6). The related 3-page question is
   answered: one page fits the demo and frees 6 BSRAM blocks, but no CLS (§6.1).
3. **Is 720p negotiable?** If not, the remaining levers are the sprite bank and
   the register file (§3.2); the loader verify is spent.
4. **Does the register file go into BSRAM?** It is 1,180 LUT — nine times the ALU
   — but it costs a pipeline stage. This is the question that decides whether
   the build ever has real margin.
