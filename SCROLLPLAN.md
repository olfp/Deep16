# SCROLLPLAN — four-direction FiT scrolling

Status: **in progress, 2026-10-31.** RTL and terminal are switched to the
26-row ring and the six-bit wrap; the tile simulation and the full test suite
pass. The game-side ring helper and the Gowin CLS/timing check remain open.
CLS is the primary constraint: the tile build has very little headroom, free
CLS may go to zero in the extreme, but must not go negative.

## Target

One camera convention that works in all four directions:

- visible window: map columns **1..80**, rows **1..24**;
- `scroll_x = 8` is centre, range 0..15 (about -8..+7 pixels);
- `scroll_y = 15` is centre, range 0..30 (-15..+15 pixels);
- `row_off = 0` for games; per-row scroll stays available for Frogger lanes;
- the 82x26 map is a ring: two margin columns and two margin rows;
- software shifts the map by one cell/row when an axis reaches its extreme,
  writes the new margin, and resets that axis to centre.

The 82x26 map is wide enough for 80 visible columns plus one margin on each
side. 81 columns are only enough for the old one-direction 8-pixel scheme.

## Phases

### Phase 0 — baseline

1. `npm test`, `npm run sim:dvi:tile`, `npm run synth:tile`.
2. Record CLS/LUT/FF/BSRAM/TNS and image size.
3. Branch: `fit-scroll-26`.

### Phase 1 — row-wrap arithmetic

Fix `wrap_rows` before changing its modulus:

```systemverilog
function automatic logic [4:0] wrap_rows(input logic [5:0] s);
  logic [5:0] r;
  r = s;
  if (r >= 6'(TILE_ROWS)) r = r - 6'(TILE_ROWS);
  wrap_rows = r[4:0];
endfunction
```

The full 6-bit subtraction is required: sums 48–50 alias if the low five bits
are subtracted. Valid ranges (`row_off` 0..25, `fill_trow_val` 0..25) top out at
50, so one subtraction is enough. Keep `ROWS = 24` as the visible row count.

Gate: existing tests/simulation pass and CLS does not increase materially.

### Phase 2 — 26-row ring

1. Change the map wrap from `ROWS` to `TILE_ROWS` (26).
2. Terminal (`asm/forth_nano.asm`):
   - add `TILE_MAP_ROWS = 26`;
   - `tile_off` wraps at 26;
   - tile-console physical rows use `(tile_row + tile_off) % 26`;
   - LF clears `(23 + tile_off) % 26`;
   - `tile_row` stays 0..23 and the cursor row stays logical.
3. Tests:
   - `tests/tile-console.test.js`: visible rows 24, physical ring 26, scroll
     at offset 24/25 and wrap to 0;
   - `rtl/sim/dvi_tile_tb.cpp`: `scroll_y` 0/7/15/30 with rows 24/25 visible;
   - Flappy and Frogger regressions.

Gate: `npm test`, `npm run sim:dvi:tile`, `npm run synth:tile`; timing TNS 0
and CLS within budget. If the 26-row arithmetic does not fit, stop and use the
fallback below.

### Phase 3 — camera convention and reference helper

No new RTL registers.

1. Document the centre values and ring rule.
2. Add a small software helper:
   - horizontal shift: move the whole 82x26 map one column (2,132 writes),
     write the new margin column, reset `scroll_x` to 8;
   - vertical shift: move the whole map one row (2,132 writes), write the new
     margin row, reset `scroll_y` to 15;
   - update `scroll_x` with the display bank; `scroll_y` in vblank;
   - measure the CPU cost: at 1 px/frame this is ~24k writes/s, at several
     px/frame it approaches 100k writes/s.
3. Add a deterministic test/demo that moves diagonally, shifts the ring in both
   axes, and checks the margins are updated.

### Phase 4 — docs and status

Update `doc/FiT-Graphics-howto.md` §5, `rtl/dvi/README.md`, `MEMMAP.md`,
`ERRPLAN.md` and `STATUS.md`.

## CLS policy

- Prefer **zero new CLS**.
- The 26-row ring adds no state; only the wrap arithmetic changes.
- If the full 6-bit wrap is too expensive, first try restricting `row_off` to
  0..25 in software (one subtract is then sufficient). Do not add a second
  subtract unless the synthesis report shows it is free.
- If the global 26-row ring does not fit, fall back to keeping the terminal at
  24 rows and selecting 26 rows when `scroll_y != 0`; measure the mux.
- Last resort: zero-RTL full-frame redraw in the back tilemap bank, with a
  measured CPU cost.
- Do not add a per-column fine-scroll table.

## Rollback

Phase 2 is the only risky step. If it fails the CLS/timing gate, revert its
commit and keep Phase 1 plus the documented 24-row contract. The terminal and
RTL must change together; never ship a 26-row RTL wrap with a 24-row terminal
ring.
