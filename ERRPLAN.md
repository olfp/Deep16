# ERRPLAN — error investigations

Status: **open items, newest first.** Each entry records what was observed, how
it was reproduced, the intended behaviour and the fix to investigate. Fixes are
not applied until the entry is updated with the result and tests.

---

## 2026-10-31 — 81 vs 82 columns, and a low-CLS four-direction scroll proposal

**Area:** `rtl/dvi/dvi_tile.sv` (`scroll_x`, `scroll_y`, `wrap_rows`);
`asm/forth_nano.asm` (`tile_off`, tile cursor); `doc/FiT-Graphics-howto.md` §5.

### Column count

The visible area is 80 cells; the map is 82 columns.

With the current 16-pixel Flappy scheme (`scroll_x = 0..15`):

| `scroll_x` | start | reaches |
|---|---|---|
| 0..7 | column 0, phase 0..7 | column 80 |
| 8 | column 1, phase 0 | column 80 |
| 9..15 | column 1, phase 1..7 | **column 81** |

So **82 columns are required** for the current scheme. 81 columns only cover
`scroll_x = 0..8`; the last seven phases would read past the map.

81 is enough only if the game changes the scheme:

- limit the phase to 0..7 and rewrite the edge column at the wrap, or
- redraw the map every 8 pixels instead of every 16.

The bird's H-flip itself costs no map columns (OAM bit 13). If the **world**
must scroll both ways, the 80 visible columns need a margin on each side:
visible columns 1..80, margins 0 and 81. That again means **82**.

### Proposal: one 26-row wrap, centered window, software ring

The existing engine already has almost everything needed:

- 82x26 map;
- `scroll_x` 0..15, split into a coarse column and a 0..7 fine phase;
- `scroll_y` 0..30, with carry into the next row;
- two tilemap banks and a per-row fine-scroll table.

The cheapest route to four directions is:

1. **Use the whole 26-row map.** Change `wrap_rows` from `ROWS = 24` to
   `TILE_ROWS = 26`. The terminal also moves to a 26-row ring: `tile_off`
   becomes 0..25 and its row arithmetic uses `%26`. The visible window stays
   24 rows; rows 24–25 become the two hidden ring rows the map was sized for.
   This is a constant change plus console software, with **no new registers,
   tables or BSRAM**.

   Careful: the current function subtracts from `s[4:0]`, which is only safe
   while the sum stays below 48. With a 26-row ring the sum can reach
   `25 + 25 = 50`, so the subtract must use the full 6-bit sum (or two
   conditional subtracts). Otherwise sums 48–50 alias to the wrong row.
2. **Center the visible window.** Visible cells are map columns **1..80** and
   rows **1..24**. Margins are column 0/81 and row 0/25.
3. **Use existing registers as signed offsets.**
   - `scroll_x = 8` is center; 0..15 covers roughly -8..+7 pixels.
   - `scroll_y = 15` is center; 0..30 covers -15..+15 pixels once the wrap is
     26.
   No new scroll register is needed.
4. **Ring-shift in software at the extremes.**
   - At `scroll_x = 0` or 15, shift the whole map one column left/right,
     reset `scroll_x` to 8, and write the new margin column. With 26 rows this
     is 2,132 tile writes (26 x 82).
   - At `scroll_y = 0` or 30, shift the whole map one row up/down, reset
     `scroll_y` to 15, and write the new margin row. This is also 2,132 tile
     writes (26 x 82).
   - At 1 pixel/frame that is roughly 24k writes/s (about 7.5 horizontal and
     4 vertical shifts per second); at several pixels/frame it rises toward
     100k writes/s. Measure the CPU cost before promising fast scrolling; a
     full back-bank redraw or a small coarse-origin register are the fallbacks
     if it is too high.
5. **Keep `scroll_x` and the display bank latched together.** `scroll_x` is
   latched with the tilemap page; `scroll_y` is not, so write it in vblank.
   The per-row table remains available for Frogger-style lanes; a free-camera
   game uses the global `scroll_x`.
6. **Do not add a per-column fine-scroll table.** It would be the vertical
   equivalent of control 6 and is the expensive option; the ring shift already
   gives 1-pixel motion.

### CLS budget

The preferred path adds **no new state**: only the `wrap_rows` constant
changes, and the console's `%24` arithmetic becomes `%26`. The constant
comparator/subtractor may even synthesise to the same size; this must be
checked with `npm run synth:tile`, not assumed.

If changing the terminal to 26 rows is too invasive, the fallback is to keep
the terminal on 24 rows and select a 26-row wrap for games when
`scroll_y != 0`. That adds a small comparator/mux in the fill path, likely a
few CLS — measure it against the **11 free CLS**. In that fallback the game
keeps `row_off = 0`, so its sum stays below 26 and the existing 5-bit
subtraction is enough; the terminal keeps its 24-row range. If the fallback
does not fit either, the zero-RTL option is a full-frame redraw into the back
tilemap bank; that supports arbitrary four-direction movement but costs about
1,920 tile writes per frame and needs a CPU-cost measurement.

**Verification:** `npm run sim:dvi:tile`; add tests for `scroll_y` 0/7/15/30,
rows 24/25 actually visible, both `scroll_x` extremes, and terminal row
arithmetic at `tile_off = 24/25`; run `npm run synth:tile` and compare CLS.

**Status:** RTL/terminal and the game-side helper/demo are implemented;
`tests/scroll4.test.js` verifies the margins and measures the cost. At
1 px/frame the helper costs about 10.7 % of a 60 Hz frame on core3; the Gowin
CLS check is still pending. See `SCROLLPLAN.md`.

---

## 2026-10-31 — Upper tile bank (tiles 96–127) is not CPU-writable

**Area:** `rtl/dvi/dvi_tile.sv` (`TILE_CPU_WORDS`, `bank_hit`,
`tilefont[cpu_addr]`); `rtl/deep16_top.sv` (`bank_hit`);
`MEMMAP.md` §7.4; `doc/FiT-Graphics-howto.md` §2.3/§2.4.

**Observed:** the tile bank has `TILE_COUNT = 128` tiles x 32 words (4,096
words), and `tilefont` is sized for all 128. The CPU window is nevertheless
limited to 96 tiles:

```systemverilog
localparam int TILE_CPU_WORDS = 96 * 32;      // 3,072
wire bank_hit = mem_we && (mem_waddr >= 21'h0F3000) &&
                         (mem_waddr <= 21'h0F3BFF);
2'd1: if (cpu_addr < 12'(TILE_CPU_WORDS)) tilefont[cpu_addr] <= cpu_data;
```

A write to `0xF3C00`–`0xF3FFF` is ignored. Tiles 96–127 can therefore only be
loaded by `$readmemh("tilefont.hex", tilefont)` at power-up; the CPU cannot
change them at runtime. The 32 baked art slots are read-only in practice.

**Impact:** a game that wants to replace or animate the baked art slots cannot
do so without rebuilding the bitstream. Runtime art is limited to the 47 free
gap slots plus tile 0 (and the text pages, if the font is sacrificed), even
though 32 more tile slots exist in the bank. The memory map also shows an
unexplained 1,024-word hole between the documented tile window and the sprite
window at `0xF4000`.

**Investigate:**

1. Is the 96-tile window deliberate (the old "96 glyph tiles" contract) or a
   leftover from before the bank grew to 128 tiles?
2. Check the board path: the tile FIFO, `deep16_top.sv` decode, and the
   PSRAM/Forth mirror must all accept `0xF3C00`–`0xF3FFF` before the window can
   grow. Confirm `cpu_addr`/`tile_addr` widths and the `tile_tgt` routing.
3. Decide whether the intended contract is:
   - **read-only baked art** (keep 96 and document it), or
   - **all 128 tiles CPU-writable** (extend the window to `0xF3FFF`).
4. If extending: change `TILE_CPU_WORDS` to `TILE_COUNT * 32`, extend
   `bank_hit` to `0xF3FFF`, update `MEMMAP.md`, `rtl/dvi/README.md` and the
   how-to, and add a test that writes tile 96 and tile 127 and renders them.
   Check the Gowin fit; no extra BSRAM should be needed because the array is
   already 4,096 words.

**Files:** `rtl/dvi/dvi_tile.sv`, `rtl/deep16_top.sv`,
`rtl/deep16_board.sv` (FIFO/decode), `rtl/sim/dvi_tile_tb.cpp`,
`MEMMAP.md`, `rtl/dvi/README.md`, `doc/FiT-Graphics-howto.md`.

**Status:** open — determine whether the 32-tile write hole is intentional.
If it is not, expose the full bank and test it.

---

## 2026-10-31 — FiT vertical scroll wraps at 24 rows, not the 26-row map

**Area:** `rtl/dvi/dvi_tile.sv` (`wrap_rows`, `frow` in the fill path);
`doc/FiT-Graphics-howto.md` §5.2; `rtl/dvi/README.md`.

**Observed:** `scroll_y` is documented as a 0..30 pixel offset over the 82x26
tilemap, with rows 24–25 described as vertical margin. In the RTL the fill does:

```systemverilog
frow <= wrap_rows({1'b0, fill_trow_val} + {1'b0, row_off});
```

and `wrap_rows` subtracts `ROWS = 24`, not `TILE_ROWS = 26`. Rows 24–25 are
therefore not part of the normal `scroll_y`/terminal ring. (At the extreme
`row_off` value the single subtraction can emit row 24, but that is not a
usable off-screen margin.) `scroll_y` is a **24-row circular scroll**, not a
26-row scroll with two off-screen rows.

**Reproduced** with the tile simulation (`npm run sim:dvi:tile` plus a probe on
`dbg_fline`/`dbg_frow`):

| `scroll_y` | top visible row | bottom visible row |
|---|---|---|
| 0 | 0 | 23 |
| 7 | 0 | 0 (wrapped) |
| 15 | 1 | 0 (wrapped) |
| 30 | 2 | 1 (wrapped) |

Rows 24–25 do not appear in the normal `scroll_y` path.

**Impact:** a vertical tile-based scroller has no hidden row in which to
prepare the next row. Every one of the 24 map rows is always somewhere on
screen, so updating a row at the wrap can produce a visible one-row pop. A
Flappy-style game rotated to vertical movement can still use `scroll_y` as a
24-row ring, but it should either use the second tilemap bank as the off-screen
buffer, use sprites for moving content, or accept the update at the wrap.

**Fix applied:** the 26-row map is now used by both the fill path and the
terminal:

1. `wrap_rows` subtracts from the full six-bit sum and uses `TILE_ROWS` (26).
2. The terminal uses a 26-row ring (`tile_off = 0..25`, physical row `% 26`);
   the visible window remains 24 rows.
3. `rtl/sim/dvi_tile_tb.cpp` now checks `scroll_y` 0/7/15/30 and observes map
   rows 24/25; `tests/tile-console.test.js` checks the 26-row terminal ring and
   its wrap at 25 -> 0.
4. `doc/FiT-Graphics-howto.md`, `rtl/dvi/README.md` and `MEMMAP.md` describe
   the centred four-direction window.

**Remaining:** the game-side ring helper (see `SCROLLPLAN.md`) and the Gowin
CLS/timing check. The toolchain is not available in this environment.

**Status:** fixed in RTL and terminal; tile simulation and full test suite pass.
