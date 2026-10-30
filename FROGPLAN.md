# FROGPLAN — Frogger on the tile engine

> **FiT hardware update (2026-10-30).** The tile bank is no longer 96
> CPU-writable 4bpp glyph tiles + 32 art. Tile 0 is a blank 32-word art tile,
> the regular/italic text pages are 1bpp at `0x020`/`0x320` (ttyp0), the gap
> `0x620–0xBFF` is 47 free 32-word slots for game art, and the 32 art slots
> remain at `0xC00`. Palettes are text/art/sprite banks at `0x80`/`0x90`/`0xA0`;
> Frogger tiles use the art bank, the frog sprite the shared sprite bank. The
> CPU is the 6.75 MHz D16nano core, not 13.5 MHz. HUD text is mode-1 cells from
> the 1bpp text pages; the map art stays mode 0. Control 6/7 and the raster IRQ
> are already in place.

Status: **plan only, nothing implemented.** This file records the agreed
mapping; the RTL, tests, game code and docs are unchanged.

The tile engine renders 80 x 24 cells of 8 x 15 pixels (640 x 360) from an
82 x 26 tilemap, has one global `scroll_x`/`scroll_y`, one tilemap layer and
eight 32 x 32 sprites. Frogger needs 20-30 logs, cars and turtles moving both
ways, plus one independently moving frog. This plan shows how to map that onto
the existing tile graphics with a small optional scroll extension.

---

## 1. What the engine gives us

| Item | Value |
|---|---|
| Visible canvas | 640 x 360, 80 x 24 cells of 8 x 15 px |
| Tilemap | 82 x 26 words, **two banks**, 2,132 words each |
| Tile bank | 128 tiles x 32 words, 4bpp; glyphs 0-95 CPU-writable, art 96-127 baked |
| Art slots | 32 total, 14 used by the birds/showcase, **18 free** |
| Global scroll | `scroll_x` 0..15 and `scroll_y` 0..30, latched at the frame boundary |
| Sprites | 8 x 32 x 32, 4bpp, 24 pattern groups, shared 16-entry palette |
| CPU | 13.5 MHz; tilemap window at `0xF1000`, control at `0xF2000` |
| Resources | 42 CLS, 343 logic cells (LUT/ALU), 3,832 FF and 3 BSRAM free |

The missing piece is **per-row horizontal scroll**. Today `scroll_x` applies to
the whole frame, so every lane must move together. Frogger needs each lane to
have its own phase and direction.

## 2. The key mapping: a lane is a row

Do not give every car and log its own x coordinate. In Frogger every object in a
lane moves at the same speed and direction, so the **lane itself is the moving
object**:

```
lane row (82 cells, 80 visible):
  [water][water][=== log ===][water][== log ==][water] ...
  <-- scroll phase p (0..7) ------------------------------
```

A row is a ring of 80 visible cells (plus two margin cells). The row's phase is
the only per-lane animation state. Moving the row one pixel moves every log,
car and turtle in it by one pixel. The ring loops, so a log that leaves the
right edge re-enters on the left.

Opposite directions are simply opposite per-row phases. The model relies on one
invariant:

> **One speed and one direction per lane.**

That is true for Frogger. If a future game needs two directions in the *same*
row, row scrolling cannot do it; that needs sprites or a separate object layer.

## 3. Playfield layout

One text row per lane; the game can use 16-20 of the 24 rows and keep the rest
for HUD/score. A workable layout:

| Rows | Content | Motion |
|---|---|---|
| 0-1 | HUD: score, lives, time | static text |
| 2 | five home slots | static |
| 3-7 | five water lanes: logs, turtles | five signed phases |
| 8 | median / safe bank | static |
| 9-14 | six road lanes: cars, trucks | six signed phases |
| 15 | start bank | static |
| 16-23 | spare / HUD | static |

Use a 16-px logical horizontal grid (two 8-px cells) and a 15-px row height:
the frog hops two cells sideways and one row up. That keeps the original
proportions on the 640-px-wide screen without needing 40-px objects.

Object sizes in cells:

| Object | Width |
|---|---|
| turtle | 2 cells |
| car | 2-3 cells |
| truck | 3 cells |
| log | 4-6 cells |
| home | 4 cells |

## 4. Art

Tiles are opaque, so each moving tile must include the lane background:

- a log tile carries water above and below the log;
- a car tile carries road under the car;
- the row scroll moves the background with the object, so there are no seams.

A minimal set is 15-17 tiles:

| Art | Tiles |
|---|---|
| water, road, safe bank, home | 4 |
| log left / middle / right | 3 |
| car left / middle / right | 3 |
| truck left / middle / right | 3 |
| turtle up / down | 2 |

That fits the 18 free art slots. If the game needs more, it can load its own
tiles into the 96 CPU-writable glyph tiles at `0xF3000` and keep a compact HUD
font in the rest; a standalone game does not need the console font while it
runs.

Keep art cells in **mode 0** (the top nibble zero). COLORTEXT pair mode is for
text; it would reduce a 4bpp car or log to two colours.

## 5. The frog is a sprite

The frog must be the one independent object:

- a frog tile in a road lane would be carried along by the cars;
- a frog tile in a log lane would ride correctly, but the same tile in a road
  lane would not — so a tile cannot serve both.

Use one 32 x 32 sprite with a 16 x 15 frog in its top-left corner. The unused
pixels are index 0 (transparent). One OAM slot, updated once per frame:

- `x` is the frog's pixel column; `y = row * 15`;
- when riding a log, `x += lane_speed` every frame;
- when on a bank or road, `x` stays put while the lane scrolls underneath;
- horizontal flip is available in OAM if the art has a facing direction.

The sprite does **not** follow the hardware row scroll. Software owns its x, so
the frog stays independent of the lane phase. Sprite groups 0 and 1 are free in
the current bank, but `BIRDPLAN.md` allocates them to the bird blink. A
standalone Frogger build can overwrite the sprite bank/page; if Frogger and
Flappy must coexist, give the frog its own page or reload the bank on entry.

Eight sprites are not enough for the traffic: 20-30 objects would need 24-32
OAM slots, a 3x larger line cache (about 3,000 FF) and 24-32 comparators. The
row table is far cheaper.

## 6. Motion: three levels

| Level | RTL cost | Result |
|---|---|---|
| **A. Software coarse** | 0 | Rewrite the lane row every 8 px; objects move in 8-px steps. Good prototype. |
| **B. Per-row fine** | ~14 LUT4, 156 FF, 0 BSRAM, ~7-9 CLS | 3-bit fine phase per row; software shifts the row when the phase wraps. Smooth 1-px motion. **Recommended.** |
| **C. Full ring phase** | ~45 LUT4, 520 FF, 0 BSRAM, ~20-25 CLS | 10-bit pixel phase per row plus hardware wrap at 82 columns. No row rewriting. |

Level B fits alongside the current COLORTEXT plan (about 22-30 CLS combined).
Level C fits alone but is tight with COLORTEXT (about 35-46 CLS against 42
free).

### Level A — software coarse

With no RTL, the game rewrites a lane row whenever an object would cross a cell
boundary. Motion is 8-px granular; at 60 fps and 1 px/frame that is a jump every
8 frames (~7.5 Hz). The frog sprite still moves smoothly, so the mismatch is
visible but playable. This is the quickest way to validate the lane model, art
and collision.

Cost per shift: 80-82 tilemap writes. At 13 lanes and 1 px/frame, roughly
8,000 writes/s; negligible against the tilemap port.

### Level B — per-row fine scroll (recommended)

Add one 3-bit fine phase per map row, latched at the frame boundary. The fill
path uses it instead of `scroll_x[2:0]`:

```systemverilog
fpix <= row_scroll_en ? row_scroll[fill_trow_val] : scroll_x[2:0];
fcol <= 7'(scroll_x >> 3);
```

The CPU still shifts the row content when the fine phase wraps, but the visible
motion is 1 px/frame in both directions. The global coarse `scroll_x[3]` still
applies; set `scroll_x = 0` for Frogger.

A full 82 x 26 map copy to the back bank each frame is about 128,000 word
writes/s. At 13.5 MHz and roughly 5-8 cycles per copied word that is about
5-8 % of the CPU; the tilemap port itself is under 1 %. Copying only changed
rows or applying the same delta to both banks reduces this further.

### Level C — full ring phase

Store a 10-bit pixel phase per row (82 cells x 8 px = 656 positions) and let the
fill wrap the column address at 82. The map row becomes a static ring; the CPU
writes only 26 phase values per frame and never touches the tilemap after setup.
This removes all row-shift work and tearing, at the cost of a 10-bit 32:1 mux,
a modulo-82 column counter and about 520 FF. Keep it as the upgrade if Level B
proves too expensive on the CPU or if the 8-px coarse shift is visible.

## 7. Control 6: the per-row fine table

Add control 6 at `0xF200C`:

```
0xF200C  { en, row[4:0], fine[2:0] }
         bit 8   = per-row scroll enable (sticky until rewritten)
         bits 7:3 = map row 0..25
         bits 2:0 = fine scroll 0..7
```

A write with `en = 0` disables per-row mode; the table is ignored and the
engine behaves exactly as today. Rows 0..25 are used; other row values are
ignored. One write updates one row, so a frame with 13 moving lanes costs 13
writes.

### RTL shape

```systemverilog
logic [2:0] row_scroll      [0:31];
logic [2:0] row_scroll_next [0:31];
logic       row_scroll_en, row_scroll_en_next;

// control write
if (cpu_we && cpu_ctrl && cpu_addr[3:0] == 4'hC) begin
  row_scroll_en_next <= cpu_data[8];
  if (cpu_data[7:3] < 5'd26)
    row_scroll_next[cpu_data[7:3]] <= cpu_data[2:0];
end
```

At the render frame boundary (the same place that latches `scroll_x` and
`map_dpage`):

```systemverilog
for (int r = 0; r < 26; r++) row_scroll[r] <= row_scroll_next[r];
row_scroll_en <= row_scroll_en_next;
```

Reset clears the table and the enable. The fill's `start_fill` uses the mux
shown in §6.2.

### Board decode

`rtl/deep16_top.sv` currently decodes only the six control addresses
`0xF2000/2/4/6/8/A`. Add `0xF200C` to `ctrl_hit`; `tile_addr` already passes
`mem_waddr[3:0]`, so the engine sees register 6 as `cpu_addr = 4'hC`.

### Optional spawn margin

The map's two margin columns can hold off-screen spawn cells. With the visible
window at columns 0-79, columns 80-81 are hidden on the right for left-moving
rows. For right-moving rows, use a per-row base column of 2 and visible columns
2-81; columns 0-1 are then hidden on the left. The row shift adds the new cell
at the hidden end, and it enters the screen after two shifts.

That refinement needs one more bit per row (`base2`), extending the table to
4 bits: +52 FF, +3 LUT4 and about +2 CLS. The optional control layout moves the
fields up one bit: bit 9 = enable, bits 8:4 = row, bit 3 = base, bits 2:0 =
fine. The fill adds 2 to `fcol` when the base bit is set. Without it,
right-moving objects appear at the visible left edge, which is acceptable for a
first version.

## 8. Software model

Keep the authoritative 82 x 26 map in CPU RAM. The tilemap is write-only from
the CPU, so a shadow map is required anyway.

```
lane[r] = { phase: 0..7, speed: signed px/frame, base: 0 or 2 }

each frame:
    for each moving lane:
        phase += speed
        while (phase >= 8) { phase -= 8; shift_left(lane); }
        while (phase <  0) { phase += 8; shift_right(lane); }
        write_control6(row, phase)
    if frog is on a log: frog_x += lane.speed
    update frog OAM
    collision and game rules
    copy the map to the back bank
    request the bank swap at the frame boundary
```

### Row shift

Left-moving row (`base = 0`):

```
for c = 0..80: row[c] = row[c + 1];
row[81] = spawn_next_cell();
```

Right-moving row (`base = 2`):

```
for c = 81..1: row[c] = row[c - 1];
row[0] = spawn_next_cell();
```

The 82-cell row includes the two hidden cells. A new object gets two shifts of
lead time before it reaches the visible window.

### Collision

The frog's centre cell is:

```
c   = (frog_x + 8) >> 3
idx = c + lane.base
tile = map[row][idx] >> 5      ; tile index 0..127
```

Tile ranges double as object classes:

| Range | Class | Rule |
|---|---|---|
| water | water | drown |
| road, bank, home, text | static | safe, or win at a home |
| log range | log | ride; add lane speed to frog x |
| car range | car/truck | death |
| turtle range | turtle | ride while up, drown while down |

No per-object list is needed: the map cell under the frog is the collision
query. A 128-byte class table in RAM is enough; ranges are cheaper still.

### Map double buffer

The tilemap has two banks and the display bank swaps at the frame boundary.
Building the entire next map in the back bank and swapping gives tear-free
updates:

- 2,132 words copied per frame;
- about 128,000 writes/s;
- roughly 5-8 % of the 13.5 MHz CPU with a simple copy loop;
- the tilemap port itself uses under 1 % of its 24.75 MHz bandwidth.

If that is too much, apply each row delta to both banks instead of copying, or
copy only the rows that changed since the previous frame.

### HUD

The font tiles 0-95 remain available for score, lives and time. Write the HUD
row directly into the back bank, or use the console `EMIT` if it targets the
same bank. A standalone game can replace unused glyph tiles with extra art and
keep a compact font for the few characters it needs.

## 9. Costs

| Piece | LUT4 | FF | BSRAM | CLS |
|---|---|---|---|---|
| Level B table, mux, decode | ~14 | 156 | 0 | ~7-9 |
| Optional base/spawn bit | ~3 | 52 | 0 | ~2 |
| Level C (instead of B) | ~45 | 520 | 0 | ~20-25 |
| Full-map copy, per frame | 0 | 0 | 0 | CPU ~5-8 % |

Current free budget: 42 CLS, 343 logic cells, 3,832 FF, 3 BSRAM. Level B leaves
ample headroom; Level C is possible but competes with COLORTEXT and any later
art work.

## 10. Tests

RTL (`rtl/sim/dvi_tile_tb.cpp`):

- with control 6 disabled or zero, a known screen is pixel-identical to the
  current build;
- row 5 fine=3 and row 6 fine=5 shift independently; all other rows unchanged;
- two adjacent rows scroll in opposite directions;
- a mid-frame control write does not change the current frame; it takes effect
  at the next frame boundary (no 15-line shear);
- global `scroll_x=8` plus per-row fine=2 gives a total 10-px offset;
- the sprite compositor still uses absolute x; per-row scroll does not move a
  sprite;
- the cursor and console path are unchanged with control 6 disabled.

Board decode:

- a write to `0xF200C` reaches the engine as control 6;
- writes to the other `0xF200x` registers are unaffected.

Game/model:

- left and right row shifts wrap the 82-cell ring correctly;
- the spawn cell enters the visible window after two shifts with the base bit;
- phase stays in 0..7 after thousands of frames, with signed speeds;
- collision maps the frog's cell to the correct map index for both base values;
- the frog rides a log (x changes by lane speed) and stays put on a bank;
- a full map copy plus bank swap never shows a torn frame.

Console regression:

- `tests/tile-console.test.js` still passes with control 6 at its reset value.

## 11. Implementation order

1. **Game skeleton, Level A.** Build the map, lanes, art, frog sprite and
   collision with software coarse scrolling. Prove the layout and rules before
   spending RTL.
2. **Level B RTL.** Add control 6, the table, frame-boundary latch and fill mux.
   Add the RTL tests; keep the feature disabled by default.
3. **Switch the game to Level B.** Write the 13 per-frame phases and remove the
   8-px stepping; keep the row shift and map copy.
4. **Polish.** Optional base/spawn bit, turtle animation, death/win animation,
   HUD.
5. **Level C only if needed.** If the map copy is too expensive or the coarse
   shift still tears, move to the full ring phase.

No tile-format or OAM-format change is required for Level B; the frog needs one
32 x 32 group of art. Level C changes only the fill address path and the control
table width, not the map or art format.

## 12. Files touched by the implementation

| File | Change |
|---|---|
| `rtl/dvi/dvi_tile.sv` | control 6 table, frame latch, `start_fill` mux |
| `rtl/deep16_top.sv` | add `0xF200C` to `ctrl_hit` |
| `rtl/sim/dvi_tile_tb.cpp` | per-row scroll, latch, sprite and cursor tests |
| `tests/tile-console.test.js` | default/disabled compatibility |
| `MEMMAP.md` | control 6 at `0xF200C` |
| `rtl/dvi/README.md` | per-row scroll contract and frame-boundary rule |
| `asm/showcase/frogger_game.asm` (new) | lanes, frog sprite, collision, map copy |
| `scripts/make_art.mjs` / `scripts/make_tile_font.mjs` | only if Frogger art is baked into the 18 free slots |
| `doc/FiT-Graphics-howto.md` | optional note on the frog sprite group |

Build and flash after the RTL or baked-art change:

```
npm test
npm run sim:dvi:tile
npm run synth:tile
npm run flash:tile
```

## 13. Open questions

1. **Playfield height.** Use 16 rows with a taller HUD, or 20 rows with a
   smaller HUD? The 24-row screen allows either.
2. **Baked art or runtime tiles?** The 18 free art slots need a synthesis; the
   96 writable glyph tiles allow a game-only image with no bitstream change.
3. **Frog size.** 16 x 15 (two cells) is closest to the original; 8 x 15 saves
   horizontal room but looks thin.
4. **Spawn margin.** Is the optional base column worth +52 FF, or is edge
   spawning acceptable?
5. **Coexistence with BIRDPLAN.** Groups 0/1 are the blink pair in that plan. A
   standalone Frogger build is fine; a shared build needs a page/group budget.
6. **Turtle animation.** Two tiles swapped in the row, or a second sprite page?
   Swapping cells is simpler but touches the scrolling row.
7. **Entry point.** Boot menu, BIOS `gfx` mode, or a standalone game image?
8. **Level C timing.** Only after measuring Level B on the board; do not spend
   the 520 FF and 20-25 CLS speculatively.
