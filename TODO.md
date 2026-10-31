# TODO — FiT scrolling integration

Status: **open.** The tile engine now has the 26-row ring and a working
four-direction helper, but the common game path is still not integrated. This
file tracks the work needed to make scrolling a normal, cheap game feature
rather than a demo.

## Goal

One-way movement with occasional direction changes should be the fast path.
True free four-direction movement is the exception and may use the more
expensive ring shift.

## Tasks

- [ ] **Implement the one-way redraw camera** in a real game/demo.
  - Use `scroll_x = 0..15` and `scroll_y = 0..29`.
  - Draw the next 16-pixel (horizontal) or 30-pixel (vertical) window into the
    back tilemap bank.
  - Swap the display bank and reset the phase at the frame boundary.
  - A direction change only reverses the phase increment; do not recentre or
    shift the map.
  - Keep `scroll_y` writes in vblank; `scroll_x` latches with the bank.
- [ ] **Integrate it into the showcase or an example.**
  - The raw demo `asm/demos/scroll4.asm` exists, but it uses the ring helper.
  - Add a one-way version or a selectable mode that uses the redraw path.
  - Make it reachable from the menu or the IDE tile profile.
- [ ] **Measure the redraw path on core3.**
  - Count instructions and cycles per 16/30-pixel redraw.
  - Confirm the expected ~1–3 % of a 60 Hz frame at 1 pixel/frame.
  - Compare against the ring helper's measured 63,994 cycles/shift.
- [ ] **Keep the ring helper as the four-direction fallback.**
  - Do not delete it; document when it is appropriate.
  - If a game needs fast free 4-way, evaluate a coarse origin register instead
    of shifting the whole map.
- [ ] **Verify the 26-row wrap on hardware/toolchain.**
  - Run `npm run synth:tile`.
  - Record CLS/LUT/FF/BSRAM and timing.
  - Confirm the last measured 4,309/4,320 CLS (11 free) after the wrap change.
- [ ] **Add regression coverage.**
  - One-way redraw, direction reversal, bank swap and `scroll_y` vblank.
  - Map margins and 26-row terminal ring remain covered.

## Acceptance

- A game can scroll one way, reverse, and continue without a visible jump or
  a full-map shift on every reversal.
- Direction changes cost phase arithmetic, not a map redraw.
- The redraw cost is measured on core3 and fits the frame budget.
- The ring helper remains documented as the slow/exceptional path.
- `npm test` passes and `synth:tile` has been run with the result recorded.

## References

- `doc/FiT-Graphics-howto.md` §5.5 — measured cost and recommended path.
- `SCROLLPLAN.md` — implementation history and CPU/resource measurements.
- `ERRPLAN.md` — the original vertical-scroll and tile-bank investigations.
- `asm/demos/scroll4.asm` — current ring helper/demo.
- `tests/scroll4.test.js` — marker and benchmark test.
