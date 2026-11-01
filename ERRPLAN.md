# ERRPLAN — error investigations

Status: **open items, newest first.** Each entry records what was observed, how
it was reproduced, the intended behaviour and the fix to investigate. Fixes are
not applied until the entry is updated with the result and tests.

---

## 2026-11-01 — Sprite pattern window is 8 groups; expand it to all 24 (option A)

**Priority:** medium — architectural cleanup; no BSRAM cost, but a memory-map
change.

**Area:** `rtl/dvi/dvi_tile.sv` (`SPR_GROUPS`, `SPR_PAGE_WORDS`, `sprite_page`,
`sprite[{sprite_page, cpu_addr[10:0]}]`); `rtl/deep16_top.sv` (`spr_hit`,
`tile_addr`); `rtl/deep16_board.sv` (tile FIFO width); `MEMMAP.md` §7.4;
`doc/FiT-Graphics-howto.md` §1/§7.

**Observed:** the sprite pattern bank holds 24 groups x 256 words = 6,144
words, but the CPU window `0xF4000–0xF47FF` exposes only 2,048 words = 8
groups. Control 5 (`0xF200A`) selects which 8-group page the writes land in:

```systemverilog
localparam int SPR_GROUPS = 24;
localparam int SPR_PAGE_WORDS = 8 * 256;      // 2,048
sprite[{sprite_page, cpu_addr[10:0]}] <= cpu_data;
```

All eight OAM sprites are writable at any time; the paging is on the pattern
bank, not on the sprites. Any group can be written after one control-5 store,
but there is no contiguous window over all 24 groups, and `0xF4800–0xF4FFF`
is unused because `spr_hit` stops at `0xF47FF`.

**Why it exists:** the map packs OAM/palette immediately after the sprite
window at `0xF5000`, leaving room for only 2K words. The 24 groups need 6K
words. The page register is two extra address bits, not a storage or bandwidth
limit.

**Proposal (option A):**

- Extend the sprite window to `0xF4000–0xF57FF` (6,144 words, all 24 groups).
- Move OAM/palette from `0xF5000–0xF50AF` to `0xF6000–0xF60AF` (keep the
  existing 0x80/0x90/0xA0 bank offsets inside the page).
- Remove `sprite_page` and control 5, or keep the register as a no-op for
  compatibility.
- Grow the CPU-side sprite/FIFO address from 12 to 13 bits: `tile_addr`,
  `tf_addr`, `dvi_cpu_addr`, and the top-level `spr_hit` decode all need the
  wider path. The sprite array itself is already 6,144 words, so **no extra
  BSRAM is required**.
- Update `MEMMAP.md`, `doc/FiT-Graphics-howto.md`, `rtl/dvi/README.md` and the
  Forth `gfx`/palette address constants.

Options B (4K window, 16 groups, page for the last 8) and C (reduce to 16
groups) were considered and are not requested. Option D (keep the page) is the
current state.

**Verification:** write group 0 and group 23 through the extended window and
render both; check OAM and all three palette banks at the new base; extend
`rtl/sim/dvi_tile_tb.cpp`; run `npm run sim:dvi:tile` and
`tests/showcase-*.test.js`; run `npm run synth:tile` and compare CLS/timing
(the wider decode should not change BSRAM).

**Status:** open — logged as medium priority 2026-11-01, not applied. The
simulation continues to model the current 8-group page until this lands.

---

## 2026-11-01 — Move graphics assets out of the image and load them from flash

**Priority:** low — future architecture; depends on the tile-bank and sprite
window work.

**Area:** `rtl/dvi/dvi_tile.sv` (`$readmemh` of `tilefont.hex`,
`birdsprite.hex`, `tilepal3.hex`); `asm/forth_nano.asm` and its `cf-*`/`slice`
loader; `scripts/make_image.mjs`; `js/deep16_simulator.js` (`SpiFlash`);
`TILESIM.md`.

**Observed:** the tile bank, sprite bank and palette are initialised from
files baked into the bitstream. The boot image also carries the showcase code.
The CPU cannot rewrite the 32 upper tile slots (see the 2026-10-31 upper
tile-bank entry), so those graphics are fixed until a new bitstream is built.

This is a leftover from the time when there was no runtime storage. It is no
longer necessary: the board has a 4 MB P25Q32U on SPI CS1, the nano boot
script already has config-flash helpers (`cf-wren`, `cf-status`,
`cf-read-burst`, `cf-protect`/`cf-unprotect`, `slice`), and the JS simulator
already models that flash byte for byte (`SpiFlash`).

**Proposal:** store font, art, sprites, palettes and eventually the showcase
module in config flash; load them at runtime through the existing SPI port and
CPU windows. Remove the `$readmemh` initial contents and the baked graphics
from the boot image once the loader path is proven.

Dependencies and constraints:

- **All 128 tile slots must be writable** for a full flash-loaded tile bank;
  the current window covers 96 (see the upper tile-bank entry).
- **Sprite groups:** the current 8-group page is sufficient for a loader (set
  control 5 per page), but option A above removes the paging and makes a
  linear copy possible.
- **Palette:** already fully writable at `0xF5080–0xF50AF`; no window change.
- **Format and loader:** define an asset blob (slices or a dedicated section),
  decide whether the kernel stays resident or also loads, and measure boot
  latency (loading ~10K words over SPI is not free).
- **Simulation:** this reverses the current `TILESIM.md` video-ROM decision.
  The engine must power on blank; assets live in the simulated flash; a loader
  writes the banks; tests and the headless renderer run the loader first. No
  `js/deep16_video_rom.js` seeding.
- **RTL parity:** the board still bakes graphics today, so simulation would run
  ahead of the bitstream until the RTL follows. Pixel comparisons must be made
  after the loader has written the same assets.

**Verification:** a loader test that starts blank, reads the flash blob, writes
tile/sprite/palette windows and renders the expected frame; compare the loaded
banks word for word with the current `tilefont.hex`/`birdsprite.hex`/
`tilepal3.hex`; measure boot time; check `npm run sim:dvi:tile` and the full
test suite. No synthesis change is expected until the `$readmemh` removal.

**Status:** open — logged as low priority 2026-11-01, design only. Do not
remove the baked ROM until the loader and the writable-window prerequisites
are in place.

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
