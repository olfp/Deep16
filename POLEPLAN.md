# POLEPLAN — Pole Position-style racer for Deep16 FiT

Status: **milestones 1–2 complete; milestone 3 art and dirty redraw built;
milestones 4–5 implemented 2026-11-20.** The on-board harness ran on the real
FPGA: 99,127 cycles per frame, 88.1% of the 60 Hz budget. The art pipeline's
core3 baseline is 52,173 cycles per frame (46.4% of the budget) with the
dirty skip; it was 56,697 (50.4%) after the scrolling grass and the
alternating mountain row. The dirty redraw saves 8.33% of the board harness's
simulated steps on the JS core (848,191 against 925,284, identical picture). The playable game is now the `pole` slice and the
showcase menu launches it with **R**. The board run with the art and the dirty
redraw is done (92,891 cycles/frame, 82.6% of the budget), and the functional
milestone-6 checks pass; the visual pass is still open.

## Objective

Build a Pole Position-inspired pseudo-3D racing game on the current Deep16
FiT tile/sprite subsystem. The target is a convincing 2.5D racer with a
perspective road, curves, hills, changing road width, opponents, and a HUD.
It is not intended to reproduce Namco's scanline-exact rendering.

## Hard hardware constraint: no RTL changes

**RTL changes are not possible for this project. All available FPGA space is
already used by the current tile build.** Recent synthesis records leave only
a few CLS at most and use all 26 available BSRAM blocks.

This is therefore a **software-only plan**:

- no new FiT registers, memory windows, scanline modes, sprite scalers, or
  render-path changes;
- no assumption that another BSRAM block is available;
- no GCoP features may be assumed; `GFX.md` describes a future architecture,
  not the current FiT implementation;
- features that cannot fit the CPU, tile, sprite, or palette budgets must be
  simplified or omitted rather than moved into RTL.

The prototype must therefore establish that the visual and CPU approach fits
the existing hardware before substantial assembly work begins.

## Current FiT capabilities and limits

| Capability | Current FiT | Design consequence |
|---|---|---|
| Frame | 640x360 internally, repeated 2x2 at 1280x720p60 | Render and profile only 640x360 |
| Background | 80x24 cells, 8x15 pixels each | Use roughly 18-24 projected road bands |
| Tilemap | 82x26 cells with two banks | Maintain a back bank and swap only after it is complete |
| Art tiles | 128 writable 4bpp slots; slots 0-95 normally hold the font | Keep prototype game art within slots 96-127 if the font is retained |
| Scrolling | Global X/Y plus a 0-7 pixel fine phase per row | Use redraws for road curvature; fine scroll is only an optional refinement |
| Sprites | Eight visible fixed-size 32x32 sprites | Keep the player and nearby opponents in sprites; embed distant objects in the road |
| Sprite art | 24 groups of 32x32 patterns | Store object scale bins in groups |
| Effects | One raster compare IRQ | Reserve it for HUD/palette effects, not per-line rendering |

The absence of polygons, perspective texture sampling, arbitrary per-row
coarse origins, and sprite scaling is the main visual-fidelity limit.

## Software renderer architecture

### Track and projection model

Represent the track as a sequence of world-space segments containing curve,
hill/elevation, width, and texture parameters. Keep world coordinates in
signed 16.16 fixed point in the eventual CPU implementation.

For each visible depth band, calculate:

- screen Y from distance and elevation;
- road center X from curve, camera position, and lateral position;
- road half-width from distance and the current segment width;
- the screen-space positions and scale bins of opponents.

Quantize projected geometry to the 8x15 tile grid. The host prototype may use
floating point to validate the model, but the assembly implementation must use
fixed point and precomputed lookup tables.

### Tilemap composition

The visible map is the road rasterizer:

- upper rows contain sky and a tiled mountain horizon;
- lower rows contain grass, road, rumble edges, and a center stripe;
- each road row is derived from a left boundary, right boundary, center, and
  texture phase;
- fill runs of cells rather than rendering individual pixels.

Boundary tiles with eight possible sub-cell offsets provide smoother edges
than whole-cell steps. They must fit alongside sky, grass, road, and stripe
tiles in the 32 game-art slots when the normal font is retained.

### Double buffering and dirty updates

The first prototype writes a complete back bank. The assembly renderer should
then compare the new map with a CPU-side shadow and update only changed cells.
A correct dirty-update scheme must preserve this invariant: the inactive map
bank must represent the current displayed frame before it is selected as the
next back bank. A pending-copy scheme or synchronized updates to both banks
are possible solutions.

### Sprites and object scales

Use the eight visible OAM slots for the player and the most important nearby
objects. Pre-render each object model at several discrete scale bins in the
24 sprite groups. Use hysteresis when selecting a bin so distance changes do
not cause visible size flicker.

Objects beyond the sprite budget can be represented by tile runs in the road.
A far object uses fewer pixels than a near object, so it is also cheaper on
the CPU.

### CPU budget

The D16nano core runs at 6.75 MHz, giving approximately 112,500 cycles per
60 Hz frame. Initial targets are:

| Work | Target per frame |
|---|---:|
| Input, physics, AI, and collisions | 20-25k cycles |
| Road projection | 15-20k cycles |
| Tilemap generation and updates | 35-45k cycles |
| Sprites and HUD | 5-10k cycles |
| Safety margin | At least 20k cycles |

These are targets, not measured results. `DIV` and `DIV32` trap to software
emulation and must not be used in the frame loop. Use 16.16 fixed point,
`MUL32`, reciprocal-depth tables, and precomputed segment constants.

## Milestones

### Milestone 1 — headless visual prototype (complete)

Build a deterministic host-side prototype that runs through the existing FiT
tile-engine twin and writes PNG frames.

Acceptance criteria:

- straight road with correct perspective;
- visible curve;
- changing road width;
- visible hill/elevation treatment;
- sky and mountain horizon;
- projected opponent cars using discrete scale groups;
- frames reproducible from the same command line;
- geometry and map/OAM state covered by focused tests.

Prototype command:

```sh
npm run render:pole -- --scene=curve --frames=3 --scale=2
```

The command writes under `artifacts/pole/`. Available scenes are `straight`,
`curve`, `hill`, `width`, and `all`.

Implementation:

- `js/deep16_pole_renderer.js` owns the host projection model, procedural FiT
  art, map-bank composition, and OAM projection;
- `scripts/render_pole.mjs` provides the deterministic PNG command;
- `tests/pole-renderer.test.js` checks perspective, curve, hill, width, scale
  selection, determinism, map-bank swapping, and FiT palette/OAM state.

The prototype uses all 32 normal game-art tile slots (96-127), two map banks,
and 13 of the 24 sprite groups. The hill scene currently approximates a crest
by moving the horizon and changing road pitch/width; the D16 version may
refine this after cycle profiling.

### Milestone 2 — cycle-counted D16 renderer (complete on the core3 model)

Port the projection and tile-run generation to D16 assembly. Benchmark on the
core3 model and then on the board. Gate on:

- no `DIV`/`DIV32` in the frame loop;
- renderer within its allocated cycle budget;
- no missed 60 Hz frames in sustained play;
- deterministic geometry matching the host prototype within tile quantization.

Test 24, 20, and 16 effective road bands if the initial renderer does not
fit the budget.

#### What was built

One integer model, written twice:

- `js/deep16_pole_model.js` is the host reference: Q8 curve accumulator in
  half-width units, half width `(0.68_Q16 * dy) >> 16`, width factor in Q8,
  and no division anywhere. The curve and width patterns are 64-entry tables
  indexed by `(phase + band) & 63`; the phase advances by 3 per frame and the
  hill phase by 1 through a 32-entry offset table.
- `asm/pole/pole_render.asm` is the D16 renderer: it projects the bands,
  composes the 80x24 map, writes the OAM, and swaps the map bank. It uses
  `MUL32` and table lookups only, so the frame loop can never reach the
  core3 `DIV`/`DIV32` ILL trap.
- `asm/pole/pole_tables.asm` holds the same tables, generated by
  `scripts/make_pole_tables.mjs` from the model.

The two implementations agree exactly, not just within tile quantization: for
frame counts 1, 2, 5, 17, and 60 the map matches cell for cell and the OAM
matches word for word, with zero differences.

#### Measured result

`npm run bench:pole` runs the program on the core3 RTL model and times it by
difference: the same image is run with and without the renderer call, and the
difference is the renderer's own cost.

| Work | Cycles per frame | Share of the 60 Hz budget |
|---|---:|---:|
| Renderer, dirty (projection + tilemap + sprites + skip) | 52,173 | 46.4% |
| State advance (phase, hill, horizon) | 169 | 0.2% |
| **Total** | **52,380** | **46.6%** |
| 60 Hz budget at 6.75 MHz | 112,500 | 100% |

That is 12,501 instructions per frame at about 4.17 cycles per instruction
(the core3 needs four cycles for an ALU op and five for a load or a store).
Before the dirty skip the same measurement was 13,565 instructions and 56,697
cycles.

The measurement is against the plan's allocation of 15-20k for the road
projection, 35-45k for the tilemap, and 5-10k for the sprites: the renderer
does all three in 52.2k, the low end of that range. With 20-25k for input,
physics, AI, and collisions, the frame lands near 81k of the 112.5k budget
and keeps the planned 20k safety margin.

Two caveats:

- The core3 harness has combinational memory, so these are the core's own
  cycles with no memory latency. The board figure will be a little higher.
- The harness proves the RTL core against the host model: it dumps the map
  and the OAM after the run and the benchmark compares them with
  `js/deep16_pole_model.js`. The board still has to be measured.

#### Where the cycles go

About 55% of the instructions are the per-cell fill loop: the renderer writes
1,867 cells per frame at four instructions each (store, decrement, branch,
and the address bump in the branch delay slot). The rest is the band
projection, the per-row edge and stripe arithmetic, and the eight sprites.

The remaining lever is the full redraw. The renderer paints the whole 80x24
back bank every frame because the bank is swapped every frame; the dirty
scheme (now implemented, see milestone 3) keeps the rows that are plain sky in
both banks and cuts about a twelfth of the renderer's steps. On the board the
margin is only 13,373 cycles per frame, so the dirty scheme moved up from
milestone 4 into milestone 3.

#### Board measurement (measured 17 November 2026)

The board run was the gate for milestone 2, and it is now closed:
`asm/pole/pole_board.asm` is the same renderer and the same state handling as
the core3 benchmark, wrapped in a timing loop that uses the board's own clocks.

- the 32-bit millisecond timer at `0xF0022`/`0xF0024` (6,750 clocks to a
  millisecond at 6.75 MHz) is the primary measurement;
- the 16-bit CPU cycle counter at `0xF0068` is the cross-check;
- the cycles per frame are `(the millisecond delta * 6750) >> 10`, one
  `MUL32` and a shift, so there is still no divide in the frame path;
- the report goes out over the UART and is drawn into the first tilemap row,
  so it can be read off the screen as well as off the serial console:

  ```
  POLE frames=01024 ms=08300 cyc16=12345 cyc_per_frame=054693 core3=052173
  ```

  The core3 baseline (52,173) is printed alongside the board number, so the
  two are directly comparable. The millisecond and cycles-per-frame fields
  are full decimal numbers, because the board is slower than the core3 with
  its combinational memory and may pass 65,535 cycles per frame. A `!` in
  front of the line means the run was longer than 65.5 seconds, so the
  millisecond delta needed both halves of the timer.

The harness is published as a type-4 binary slice named `polebench` at segment
`0x7000`, which is free in the D16D segment map (`MEMMAP.md`), so the board
loads it with the same loader as the games. It is a separate object from the
playable `pole` slice and sits at the end of the slice image:

```sh
npm run flash:slices          # or npm run flash:tile for a full update
# power-cycle, then in the Forth console (PS/2 keyboard):
s" games" need
s" polebench" game-run
```

`npm run bench:pole:board` prints those instructions and, with
`--port=/dev/ttyUSB0`, captures the report and prints the difference against
the core3 baseline. `--sim` dry-runs the harness on the JS core.

**The measured result** (a D16nano tile board, core3 at 6.75 MHz, 1,024
frames). This run was taken with the milestone-2 renderer, before the art
pipeline added the scrolling grass, so the core3 field quotes the baseline of
the day:

```
POLE frames=01024 ms=15038 cyc16=56906 cyc_per_frame=99127 core3=055824
```

| | cycles per frame | share of the 60 Hz budget |
|---|---:|---:|
| core3, combinational memory | 55,824 | 49.6% |
| **board, real PSRAM** | **99,127** | **88.1%** |
| 60 Hz budget at 6.75 MHz | 112,500 | 100% |

- the board is 1.78x the core3 figure: the PSRAM misses cost about 43,300
  cycles per frame;
- 15,038 ms for 1,024 frames is 14.69 ms per frame, so the renderer alone
  reaches 68 fps and leaves 2.0 ms per frame for everything else;
- the cycle counter agrees with the timer: 101,506,500 cycles is 56,772
  modulo 65,536, and the counter read 56,906 - 134 cycles apart, well inside
  the one-millisecond truncation of the timer;
- the margin is 13,373 cycles per frame, not the 20,000 the plan assumed.
  The renderer still fits 60 Hz, but the headroom is now thin, so the fill
  loop has to get cheaper before the gameplay slice asks for time.

The art pipeline of milestone 3 changed the renderer slightly: the grass now
scrolls with the road and the mountain row alternates two profiles, which
costs 873 core3 cycles per frame and takes the core3 baseline from 55,824 to
56,697 (50.4% of the budget). The dirty redraw then took the core3 figure to
52,173 (46.4%), which is the number the harness now prints.

**The 2026-11-20 run** (art pipeline and dirty redraw, 1,024 frames):

```
POLE frames=01024 ms=14092 cyc16=27782 cyc_per_frame=92891 core3=052173
```

| | cycles per frame | share of the 60 Hz budget |
|---|---:|---:|
| core3, combinational memory | 52,173 | 46.4% |
| **board, real PSRAM** | **92,891** | **82.6%** |
| 60 Hz budget at 6.75 MHz | 112,500 | 100% |

- the board is still 1.78x the core3 figure: the PSRAM misses cost about
  40,700 cycles per frame;
- 14,092 ms for 1,024 frames is 13.76 ms per frame, so the renderer alone
  reaches 72.7 fps and leaves 2.9 ms per frame for input, physics and the HUD;
- the cycle counter agrees with the timer: 95,120,384 cycles is 27,648
  modulo 65,536, and the counter read 27,782 - 134 cycles apart, well inside
  the one-millisecond truncation of the timer;
- the margin is 19,609 cycles per frame (17.4%), up from 13,373 before the
  dirty work. Against the milestone-2 run the net is -6,236 cycles: the art
  costs about 1,700 on the board and the dirty skip saves about 8,000, which
  matches the core3 drop scaled by the board's 1.78x memory factor.

This run predates the wide player car and the diagonal edge; those change one
sprite and drop one opponent, so the board number has to be re-measured with
the new art (the core3 figure moved from 52,211 to 52,173).

The screen during the milestone-2 run showed the report line, the console's
own text and the road, but the road was drawn with the wrong tiles: the slice
carried no tile art, so tiles 96..120 held whatever the last game left in
the tile bank. The geometry was right (the road, its edges, the centre line
and the sprites sat where the model puts them); the pixels were not.
Milestone 3 gives the pole a tile pack like the other games have, and the
slice copies it into the banks itself.

`tests/pole-board.test.js` (12 tests) runs the harness on the JS core and
checks that it renders exactly the host model's picture, that its arithmetic
follows from the timer delta, that the cycle counter agrees with the timer,
that a board slower than 65,535 cycles per frame still prints its own
number, that a run longer than 65.5 seconds is measured with both halves of
the timer, that the screen and the UART carry the same report, and that the
board and bench drivers leave the same state behind.

#### Files

- `asm/pole/pole_render.asm`, `asm/pole/pole_state.asm`, `asm/pole/pole_bench.asm`
- `asm/pole/pole_board.asm`, `asm/pole/pole_tables.asm`
- `scripts/pole_program.mjs`, `scripts/make_pole_tables.mjs`
- `scripts/bench_pole.mjs`, `scripts/bench_pole_board.mjs`
- `rtl/sim/core3_pole_bench_tb.sv`, `rtl/sim/core3_pole_bench_tb.cpp`
- `scripts/build_core3_pole_bench.sh`
- `tests/pole-asm.test.js` (10 tests), `tests/pole-board.test.js` (12 tests),
  `tests/pole-dirty.test.js` (1 test)

### Milestone 3 — final art pipeline (art built, board run pending)

The board run of milestone 2 showed the road geometry is right but the pixels
are not: the pole slice carried no tile art, so the renderer pointed at slots
96..127 and the bank still held whatever the last game left there. Milestone
3 replaces that with real art, in the FiT's own formats.

**What was built**

- `scripts/make_pole_art.mjs` is the source of truth for the art: the tile
  grids (sky, mountains, treeline, grass, asphalt, kerbs, the centre stripe),
  the car sprites, the palettes, and the three bank blocks. The shapes are
  drawn as pixel grids and packed into the hardware formats there, so there
  is no second copy of the art anywhere.
- `scripts/render_pole_art.mjs` previews the *hardware* picture: the integer
  model writes the map and the OAM, the art goes into the banks, and the
  behavioural tile engine composites the frame. What comes out is what the
  board shows, down to the last pixel. `npm run render:pole:art` writes it to
  `artifacts/pole/`.
- `asm/pole/pole_art.asm` copies the art into the banks when the slice
  starts: three block moves, one per bank. The tile art is the last 32 tiles
  of the tile bank, the sprite art is the first 18 groups of the sprite bank,
  and the three palettes are three consecutive 16-word banks of the palette
  window. The console font and the bird sprite are left alone.
- The slice carries the art, so it is no longer one 4 KB slice but five
  (9,776 words). The loader already follows the link and copies the
  continuations, so `game-run` works unchanged.

**Two bugs the art work found**

- The model's sprite group table was `[0, 1, 5, 9]`: group 0 is the player's
  car, so the first model started on top of it and the third model overlapped
  the second. The table is now `[1, 5, 9, 13]` (the player, then four models
  of four scale bins), and `scripts/make_pole_tables.mjs` regenerates the
  assembly table from it.
- The ground stood still: every row used the same grass tile. The grass now
  takes the same band parity as the road texture, so the ground scrolls with
  the road. The model and the assembly changed together, and the parity test
  still passes cell for cell.

**The cost**

The art copy is 5,424 words moved once, before the measured loop, so it costs
nothing per frame. The renderer changes do cost: the scrolling grass and the
alternating mountain row take the core3 baseline from 55,824 to 56,697
cycles per frame (50.4% of the 60 Hz budget). The dirty redraw then brings it
to 52,173 (46.4%), and the report and the plan quote the new number. On the board the same change should cost roughly 1,500
cycles per frame.

The mountain row needed a restructure to fit: a conditional branch reaches
nine bits, and the row body was already 243 words against a 255-word limit.
The sky path moved out of the row body into a helper, which brought the body
back to 228 words and left room to grow again.

**Both board runs closed (2026-11-20)**

- The board run with the art and the dirty redraw measured 92,891 cycles per
  frame (82.6% of the budget); the report is in the board-measurement section.

#### Dirty redraw (implemented and measured on the simulator, 2026-11-20)

The back bank is swapped every frame, so a row can only be left alone when it
is plain sky in both banks. `pole_dirty_prepare` (at `0x0B00` in
`pole_state.asm`) computes

```
T0 = floor((H - 22) / 15)          ; H is the horizon in pixels
skip = min(T0 of the back bank's last paint, T0 now)
```

and stores it in `SCR_SKIP`. Rows below the horizon stay plain sky whatever
their depth (the band projection gives them no road), so everything from
`skip` down is repainted: the mountain and tree rows and every road row. Each
bank's last T0 is kept at `BANKT0_0`/`BANKT0_1` (`0x04DD`/`0x04DF`) and reset
to 0 at state init, so the first paint of a bank is always full.

The renderer keeps only the per-row skip check and the post-swap T0 store; the
bench, board and game drivers call `pole_dirty_prepare` before `pole_render`.
A build define, `POLE_NODIRTY`, forces the skip to 0 and is used by
`tests/pole-dirty.test.js` to run both variants on the JS core.

Measured on the 64-frame board harness: **848,191 steps dirty against 925,284
full, a saving of 77,093 steps (8.33%)**, with the final map identical. The
core3 renderer benchmark agrees: 52,173 cycles per frame with the skip against
56,697 without it (7.9%), and its map and OAM still match the host model. The
quarter the plan expected was optimistic: at the usual horizon only four of
the 24 rows are plain sky, and the per-row skip check eats a few instructions
of what those four rows save.

Moving the renderer's grown code and the T0 helper needed room: the tables
moved from `0x0400` to `0x0A00`, the helper sits at `0x0B00`, and the art copy
moved from `0x0900` to `0x0C00`.

### Milestone 4 — gameplay slice (v1 implemented 2026-11-20)

`asm/pole/pole_game.asm` is now the slice driver in place of the timing
harness. It keeps the same renderer and state helpers and adds:

- direct PS/2 polling (the slice has no SWI vector of its own): arrows or
  A/D steer, Up/W accelerates, Down/S brakes, Esc/Q quits;
- steering through `ST_PLAYER_X` (clamped to ±128), speed through the phase
  advance (`phase += speed >> 5`) and the coast;
- six opponents in `ST_OPP`, recycled to bands 18–21 with a frame-derived
  lateral position and model;
- world-space collision on `|lateral - playerX| < 28` for bands 0–2, with a
  45-frame crash timer and a stopped car;
- lap/time/speed HUD on row 0 (`LAP n/3  TIME sss  SPEED sss`), messages on
  row 1, drawn after the renderer selects the visible bank so it lands on the
  frame being shown;
- a 3-lap finish that stops the car and prints `FINISH  Q=QUIT`.

The HUD text uses the console font cells in the pole palette's text bank.
`tests/pole-game.test.js` boots the slice in segment `0x7000`, accelerates,
checks the HUD glyphs in the tilemap and returns through Esc.

Milestone 3's board run is closed: the art and dirty redraw measured 92,891
cycles per frame on the board (82.6% of the budget), and the game now paces
itself to the frame toggle. The visual pass is the remaining milestone-6 item.

### Milestone 5 — config-flash and menu integration (done 2026-11-20)

The game is a type-4 binary slice at segment `0x7000`, five slices in the
current image (the art blocks at `0x1000`/`0x1400`/`0x2600` force the span).
The directory lists it as `pole`, and the showcase menu launches it with
**R** (the `str_name_pole` name lives in the free `0x4C0` gap, because the
app-name block at `0x4E0` is full). The launch copies the slice and the game
installs its own tile/sprite/palette banks; the menu's standard tile-pack copy
skips the pole art because the block at `0x1000` is raw words, not a
`0x0A57` pack.

### Milestone 6 — board validation (functional checks pass 2026-11-20)

Validate sustained 60 Hz operation, curve stability, map-bank swapping,
sprite priority, input latency, and behavior with several opponents visible.

**Result.** The board run above covers the timing: 92,891 cycles per frame,
82.6% of the 60 Hz budget, with the cycle counter agreeing with the
millisecond timer. Playing the `pole` slice on the board confirmed smooth
motion, working curves, clean bank swapping (no tearing), the player and
opponents in the right order, immediate steering and acceleration, several
opponents visible at once, and a clean return to the console with Q/Esc.

The game needed one fix for this: `pole_game.asm` did not wait for the frame
toggle, so it free-ran at about 67 Hz and the HUD clock and lap physics were
12% fast. `game_loop` now calls `game_wait_frame`, which spins on bit 1 of
`0xF0066`; the work fits the 16.7 ms period, so every iteration is one display
frame and `TIME` advances one second per 60 frames. `tests/pole-game.test.js`
drives that toggle in the simulator.

**Visual pass (first round).** The functional checks exposed the picture:
the player car was 28x22 in one 32x32 sprite, too small against a road about
356 pixels wide, and the border was a thick red/white bar that stepped a whole
tile at every band. The car is now 64x32, built from two sprite halves
(groups 0 and 17); the player uses two of the eight OAM slots, so the game
shows six opponents instead of seven. The edge is a two-pixel red/white line
that walks eight pixels across the tile, so it reads as a diagonal instead of
a vertical bar; the tile grid still steps at band boundaries, but the step is
much smaller than before. The road colours are unchanged.

The slice grows to 9,776 words and the palettes move to `0x2600`; the core3
baseline is 52,173 cycles per frame (46.4%), and the board is re-measured with
the new art.

## Decision gates

- If the headless result is not visually convincing, stop before assembly
  and revise the projection or art approach.
- If the D16 renderer exceeds its budget, reduce depth bands, improve dirty
  granularity, and precompute more projection data.
- Do not respond to a performance shortfall by proposing RTL. Reduce or
  remove the feature instead.

The core3 measurement (55.8k cycles per frame) is inside the allocation, so
no feature has been cut. The board measurement is still the gate: if the
board's real memory latency pushes the renderer past its share, the dirty sky
scheme (now implemented, 8.33% of the board harness's simulated steps) and the
reduced band count are the next steps, in that order.

## References

- `doc/FiT-Graphics-howto.md` — authoritative FiT programming guide.
- `rtl/dvi/dvi_tile.sv` — current renderer behavior.
- `doc/Deep16-Arch.md` — ISA, fixed-point arithmetic, and divide behavior.
- `HARDWARE.md` — D16nano clocking and board resources.
- `ERRPLAN.md` — latest synthesis/resource measurements.
- `SCROLLPLAN.md` — measured scrolling alternatives.
- `js/deep16_tile_engine.js` — behavioral FiT twin.
- `scripts/render_tile.mjs` — existing deterministic PNG workflow.
- `screens/flash/games.fth` — type-4 game loader and `game-run`.
- `SCROLLPLAN.md` — the core3 measurement conventions this benchmark follows.
