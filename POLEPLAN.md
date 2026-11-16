# POLEPLAN — Pole Position-style racer for Deep16 FiT

Status: **milestone 1 complete; milestone 2 complete on the core3 model
(16 November 2026).** The on-board harness is built and published as a
config-flash slice, but the board run itself is still open; the art pipeline
and the gameplay slice follow.

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
| Renderer (projection + tilemap + sprites) | 55,824 | 49.6% |
| State advance (phase, hill, horizon) | 169 | 0.2% |
| **Total** | **55,993** | **49.8%** |
| 60 Hz budget at 6.75 MHz | 112,500 | 100% |

That is 13,394 instructions per frame at about 4.16 cycles per instruction
(the core3 needs four cycles for an ALU op and five for a load or a store).

The measurement is against the plan's allocation of 15-20k for the road
projection, 35-45k for the tilemap, and 5-10k for the sprites: the renderer
does all three in 55.8k, the low end of that range. With 20-25k for input,
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

The remaining lever is the full redraw. The renderer paints the whole
80x24 back bank every frame because the bank is swapped every frame; a dirty
scheme that keeps the sky rows in both banks would cut roughly a quarter of
the cells, and fewer effective road bands would cut the projection. Neither
is needed to fit the current budget, so both stay open for milestone 4 if the
gameplay slice needs the headroom.

#### Board measurement (harness ready, run pending)

The board run is the open gate for milestone 2, so the harness that makes it
is built and tested: `asm/pole/pole_board.asm` is the same renderer and the
same state handling as the core3 benchmark, wrapped in a timing loop that
uses the board's own clocks.

- the 32-bit millisecond timer at `0xF0022`/`0xF0024` (6,750 clocks to a
  millisecond at 6.75 MHz) is the primary measurement;
- the 16-bit CPU cycle counter at `0xF0068` is the cross-check;
- the cycles per frame are `(the millisecond delta * 6750) >> 10`, one
  `MUL32` and a shift, so there is still no divide in the frame path;
- the report goes out over the UART and is drawn into the first tilemap row,
  so it can be read off the screen as well as off the serial console:

  ```
  POLE frames=01024 ms=08300 cyc16=12345 cyc_per_frame=054693 core3=055824
  ```

  The core3 baseline (55,824) is printed alongside the board number, so the
  two are directly comparable. The millisecond and cycles-per-frame fields
  are full decimal numbers, because the board is slower than the core3 with
  its combinational memory and may pass 65,535 cycles per frame. A `!` in
  front of the line means the run was longer than 65.5 seconds, so the
  millisecond delta needed both halves of the timer.

The harness is published as a type-4 binary slice at segment `0x7000`, which
is free in the D16D segment map (`MEMMAP.md`), so the board loads it with the
same loader as the other games:

```sh
npm run flash:slices          # or npm run flash:tile for a full update
# power-cycle, then in the Forth console:
s" games" need
s" pole" game-run
```

`npm run bench:pole:board` prints those instructions and, with
`--port=/dev/ttyUSB0`, captures the report and prints the difference against
the core3 baseline. `--sim` dry-runs the harness on the JS core.

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
- `tests/pole-asm.test.js` (10 tests), `tests/pole-board.test.js` (12 tests)

### Milestone 3 — final art pipeline

Produce the final 32-slot game-art set, 24 sprite groups, scale-bin metadata,
palettes, and a runtime tile-pack loader. Build checks must reject art that
exceeds the tile or group budgets.

### Milestone 4 — gameplay slice

Implement fixed-step input, steering, acceleration, opponents, world-space
collision, lap/timer/speed HUD, and start/finish flow. Collision must use
world-space X/Z coordinates rather than rendered pixel positions.

### Milestone 5 — config-flash and menu integration

Package the game as a type-4 binary slice, add it to the config-flash
directory, copy its tile pack on launch, and expose it from the showcase
menu. Existing loader segments include Pac-Man at `0x2000`, Flappy at
`0x5000`, and Frogger at `0x0600`; the racer uses segment `0x7000`, which is
free in the D16D map and is already checked by the milestone-2 harness.

### Milestone 6 — board validation

Validate sustained 60 Hz operation, curve stability, map-bank swapping,
sprite priority, input latency, and behavior with several opponents visible.

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
scheme and the reduced band count are the next steps, in that order.

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
