# FiT graphics in the simulation — implementation plan

Status: **active plan, revised 1 Nov 2026.** Scope is the **simulation only**:
the browser IDE, the JS core and the headless renderer. The D16nano RTL, its
defines, constraints and bitstream are not edited.

Sources of truth: `rtl/dvi/dvi_tile.sv`, `rtl/sim/dvi_tile_tb.cpp`,
`doc/FiT-Graphics-howto.md`. Where the guide and the RTL disagree, the RTL wins.

## 0. Current state

The CPU half already runs:

- `tests/tile-console.test.js` boots the nano kernel and checks the BIOS's
  82x26 tilemap, 26-row ring and clear-on-scroll.
- `tests/showcase-*.test.js` run the D16D showcase, Flappy and the art/palette
  layout on the JS core.

The video half does not exist:

- no tile/sprite/palette engine in `js/`;
- the Screen tab only draws the 80x24 text buffer at `0xF1000`;
- no D16D image builder in the browser;
- no headless renderer.

`TILESIM.md` is the feature brief but is stale in five places; this plan
supersedes them:

| TILESIM.md says | Current RTL / tree |
|---|---|
| Row offset wraps at 24 | **26-row ring**; visible rows 0–23, margins 24–25 |
| Sprite bank 2,048 words, one page | **24 groups** (6,144 words) in one flat CPU window; control 5 is a legacy no-op |
| Palette 16 entries at `0xF5080` | **3 banks** (text/art/sprite) at `0xF6080`, `0xF6090`, `0xF60A0`; 48 visible entries in a 64-entry RAM |
| Render rule is 4bpp tiles only | Cells are **art (4bpp)** or **text (1bpp, pair + styles)** |
| D16D image needs `gfx_demo.asm` at `0x4E00` | No such file; D16D is `showcase.asm` + `flappy_game.asm` at `0x4A00` |

TILESIM also omits control 6 (per-row fine scroll) and control 7 (raster line).

## 0.1 Decisions for this revision

These are the rules the implementation follows.

1. **No graphics ROM in the simulation.** The engine does not seed the tile
   bank, sprite bank or palettes from a committed ROM. It powers on blank.
2. **Graphics live in simulated flash and are loaded at runtime.** The JS core
   already models the 4 MB P25Q32U (`SpiFlash`) on SPI CS1. The asset blob is
   flash contents, not engine state.
3. **The hardware map is mirrored exactly.** The sprite bank is the flat
   24-group window and the tile bank is **all 128 tiles writable** (both landed
   in the RTL on 2026-11-02; see `ERRPLAN.md`). No forward divergence remains.
4. **A reference loader stands in for the future Forth/flash loader.** It
   writes the same CPU windows a loader would, through `engine.write()` and the
   JS memory image. It is test infrastructure, not engine ROM. The real CPU
   loader replaces it when the flash path lands.

## 1. Behavioural contract to mirror

Extracted from `dvi_tile.sv` and `dvi_tile_tb.cpp`. The engine models these, not
a reinterpretation:

| Area | Contract |
|---|---|
| Visible area | 80x24 cells, 8x15 pixels, 640x360 source; 2x2 on 1280x720 |
| Map | 82x26, two banks; visible row `r` reads `wrap26(r + row_off)` |
| Tile bank | 128 tiles x 32 words; **simulation: all 128 writable** (target) |
| Text tiles | 1bpp pages, regular and italic; pair 0–7; underline, bold smear |
| Art tiles | 4bpp nibbles, low nibble leftmost; word 30 palette pointer ignored |
| Palettes | 8 sets x 4 banks in one 1,024x16 RAM; set 0 text `0xF6080`, art `0xF6090`, sprite `0xF60A0` |
| Controls | 0 cursor, 1 row offset, 2 `scroll_x`, 3 `scroll_y`, 4 write/display bank, 5 scene select (palette set + OAM base), 6 per-row table, 7 raster compare |
| Frame latch | display bank, `scroll_x`, per-row table and enable copy at the frame boundary |
| Sprites | 8 visible slots over 64 descriptors, 24 groups, 32x32, index 0 transparent, slot 0 wins, H/V flip, behind, negative x |
| Cursor | XOR palette byte with `0xFF`; blink from a 24-bit counter, bit 23 |
| Status | `0xF0066`: b0 vblank, b1 frame toggle, b2 S2, b3 UART ready |
| Not modelled | sub-line write timing; rendering happens at frame boundaries |

The `dvi_tile_tb.cpp` checks are the unit-test list: H glyph, blank row, row
offset, margin row, `scroll_y`, writable bank/palette, `scroll_x`, per-row
phases, raster count, palette banks, styles, sprite bands, transparency,
behind, flips, priority, write/display pages, sprite page, group range,
negative x, vblank/frame.

## 2. Deliverables

| File | Role |
|---|---|
| `scripts/make_flash_assets.mjs` | Build the graphics asset blob from the art generators |
| `js/deep16_flash_assets.js` | Committed blob (flash contents, base64/hex), no engine seeding |
| `js/deep16_gfx_loader.js` | Reference loader: flash blob -> CPU windows |
| `js/deep16_tile_engine.js` | Pure state + renderer, no DOM, no timing |
| `js/deep16_d16d_image.js` | Browser builder for the D16D code image |
| `scripts/render_tile.mjs` | Headless PNG renderer |
| `tests/flash-assets.test.js` | Blob freshness and loader round trip |
| `tests/tile-engine.test.js` | Engine behaviour against the tb cases |
| `tests/d16d-image.test.js` | Browser image = `buildImage()` word for word |
| `tests/showcase-render.test.js` | Deterministic scene pixels |
| `tests/ui-*.test.js` | Console modes and store routing |

No file under `rtl/`, `fpga/` or `asm/` is edited by this plan.

## 3. Phase 1 — flash asset blob and loader

**Status:** implemented 1 Nov 2026 — `scripts/make_flash_assets.mjs`,
`js/deep16_flash_assets.js`, `js/deep16_gfx_loader.js`,
`tests/flash-assets.test.js`, npm script `assets:gfx`.

**Blob contents**

A simple versioned container, little-endian 16-bit cells:

```
magic "D16G" | version 1 | tileWords 4096 | spriteWords 6144 | paletteWords 48
tileBank[4096] | spriteBank[6144] | palette[48]
```

- `tileBank` from `tileFontWords()` (font pages + 32 art tiles).
- `spriteBank` from `birdSpriteWords()` (24 groups).
- `palette` from three copies of `PALETTE_RGB332`, matching `tilepal3.hex`.
- The blob is stored in the simulated config flash at a fixed base, e.g.
  `0x300000` in the upper writable half. The loader reads it through the same
  window/format, not from JS constants at run time.

**Generator**

`scripts/make_flash_assets.mjs` imports the existing exports and writes
`js/deep16_flash_assets.js` as a committed base64 string plus metadata. A test
regenerates it and compares byte for byte.

**Reference loader**

`js/deep16_gfx_loader.js`:

- `loadFlash(sim, blob, base)` copies the blob into `sim.spiFlash.mem`;
- `loadGraphics(engine, sim, blob)` reads it back and writes:
  - tiles `0xF3000 + i` for all 4,096 words (all 128 slots);
  - sprite groups page by page through control 5, eight groups at a time;
  - palettes `0xF6080..0xF60AF`;
  - then clears control 5 to page 0.
- The loader also writes the same addresses into `sim.memory`, so a later CPU
  run sees the loaded image.

The loader is a stand-in for the CPU/Forth loader. It must not touch engine
state directly beyond `engine.write()`.

**Acceptance:** `tests/flash-assets.test.js` proves the blob matches the
generators, and that loading it into a blank engine makes every tile, sprite
word and palette entry equal to the generated source.

## 4. Phase 2 — the engine

**Status:** core implemented 1 Nov 2026 — `js/deep16_tile_engine.js` and
`tests/tile-engine.test.js` (23 tests). Store hooks and UI are still Phase 3–4.

`js/deep16_tile_engine.js` is a plain browser script (same loading style as the
simulator), with no DOM or timers.

### State

```
tilemap[2][2132]
tileBank[4096]              // all 128 tiles writable in the simulation
spriteBank[6144]            // 24 groups x 256
oam[16]
palette[48]                 // text 0..15, art 16..31, sprite 32..47
cursor { row, col, enable }
rowOff
scrollX, scrollXNext
scrollY
mapWrite, mapDisplay, mapDisplayNext
spritePage
rowScroll[26], rowScrollNext[26], rowScrollEnable, rowScrollEnableNext
rasterLine
frame, blink
```

### API

- `write(addr, value)` — route exactly as the CPU window, with the tile range
  extended to `0xF3FFF`:
  - `0xF1000..0xF1853` -> selected write bank;
  - `0xF2000..0xF200E` (even) -> controls 0..7;
  - `0xF3000..0xF3FFF` -> tile bank (all 128 tiles);
  - `0xF4000..0xF57FF` -> sprite bank (all 24 groups, flat);
  - `0xF6000..0xF607F` -> 64 OAM descriptors;
  - `0xF6080..0xF627F` -> 8 palette sets of 4 banks;
  - `0xF6080..0xF60AF` -> palettes via `{addr[5:4], addr[3:0]}`.
  Ignore writes outside windows.
- `tick()` — frame boundary: latch display bank, `scrollX`, per-row table and
  enable; advance `blink`; increment `frame`.
- `rasterAt(line)` — status/IRQ hook; no pixel effect.
- `render()` — 640x360 RGBA, pure read.
- `powerOn()` — **clear** map/OAM/controls; leave banks and palette zero.
- `reset()` — clear OAM and controls, keep banks/palette/map.
- `snapshot()` — state for tests and the headless renderer.

### Render rules

1. Visible row 0..23: `mapRow = wrap26(row + rowOff)`.
2. `scrollY` adds a carry into the map row and a glyph-row shift; `scrollX`
   gives coarse `>>3` and fine `&7`. Control 6, when enabled for that map row,
   replaces only the fine phase.
3. Cell mode:
   - art: 4bpp nibble from `tile*32 + 2*row` / `+1`, low nibble leftmost;
   - text: 1bpp glyph word from the regular or italic page; underline on row 14;
     bold smears the previous ink pixel; palette entry `2*pair + ink`.
4. Palette bank: art -> art bank; text -> text bank; sprite -> sprite bank.
5. Cursor: enabled, blinking (`blink[23]`), same visible row/column, XOR the
   palette byte with `0xFF`.
6. Sprites: slots 7 down to 0, 32x32; index 0 transparent; `behind` hides it
   where the background index is non-zero; slot 0 wins. Hflip reverses word and
   nibble; Vflip reads row 31-row; negative x uses `1024 + x` and clips left.
7. RGB332 expands exactly as the RTL: red `{7:5,7:5,6:5}`, green
   `{4:2,4:2,3:2}`, blue `{1:0,1:0,1:0,1:0}`.

### Tests

`tests/tile-engine.test.js` mirrors the tb checks, at minimum:

- H glyph; blank neighbour; row offset moves a margin row in;
- `scroll_x` 8 moves one tile; `scroll_y` carry; per-row phases;
- tile bank write renders (including tile 96 and tile 127 in the simulation);
- palette bank writes change only their bank;
- text pair, underline, bold, italic; art ignores style bits;
- sprite transparency/behind/priority, second 8-row band, H/V flip, negative x;
- write/display page latch; sprite page and absolute group; group 24 draws
  nothing; page 3 clamps to 0;
- cursor XOR and blink; RGB332 expansion; `reset()` keeps banks;
- blank power-on: no tile, sprite or palette data appears before loading.

**Acceptance:** unit tests green; `snapshot()` matches expected state after a
scripted write sequence.

## 5. Phase 3 — store hooks

**Status:** JS and compiled-core hook points implemented 1 Nov 2026 —
`deep16_simulator.checkScreenUpdate()`, the compiled-core mirror in
`deep16_ui_core.js`, and `tests/tile-store-hook.test.js`. The IDE still has to
create/attach the engine and the tile view (Phase 4).

The engine must see writes in order; polling memory cannot represent two banks
or the page latch.

**Tasks**

1. JS core: widen `checkScreenUpdate` from `0xF1000..0xF17BF` to the video
   window and feed the engine. In `tiles` mode the text-cell handler must not
   also draw the same writes.
2. Compiled cores: the IDE mirrors each store into JS memory in the run loop
   (`deep16_ui_core.js`, `get_recent_access` block). Feed the engine there too.
3. Assemble and Reset call `powerOn()` / `reset()` at the same points the
   simulator is reset/loaded.
4. Document that a manual Memory-panel poke bypasses the hooks; single-buffer
   windows can be resynced from memory, back-buffer state cannot.

**Core support:** JS first. RTL models the devices and can follow once the hook
is proven. WASM has no SIC/timer/`0xF0066` status model, so `tiles` mode falls
back to JS until those models exist.

**Acceptance:** after loading the flash blob and booting the D16D image, engine
`tilemap` equals `sim.memory[0xF1000..]` for the displayed bank; page swaps and
OAM match.

## 6. Phase 4 — UI and console mode

**Status:** implemented 1 Nov 2026 — `tiles` mode, 640x360 canvas, build
profiles, flash-asset load during Assemble, and `tests/ui-tiles.test.js`
(7 tests). The frame clock and D16D example are still Phase 5–6.

**Tasks**

1. Add a third console mode `tiles` to the Screen/Terminal cycle, persisted in
   `localStorage` as `deep16_console`.
2. `Deep16ScreenUI.setConsoleView('tiles')`:
   - hide the 80x24 grid, pager and palette legend;
   - show a `<canvas width="640" height="360">` inside `#screen-display`;
   - `image-rendering: pixelated`, scale down on narrow layouts;
   - paint `engine.render()` on `requestAnimationFrame`, only when state changed
     or a frame tick happened.
3. Info line: tilemap `0xF1000`, controls `0xF2000`, bank `0xF3000`, sprites
   `0xF4000`, OAM/palette `0xF6000`.
4. Input: tile mode routes keys to the UART, not the PS/2 FIFO; canvas click
   focuses the hidden `#terminal-kbd-hook`.
5. Build profile: `tiles` sets `{ CONSOLE_UART: 1, D16NANO: 1 }`; the D16D
   example adds `{ D16D: 1 }`. Refuse to assemble a screen kernel in tile mode.

**Acceptance:** `tests/ui-terminal.test.js` and `tests/ui-core.test.js` cover
three modes, build defines, input route and canvas visibility; screenshot via
`npm run ui:shot`.

## 7. Phase 5 — frame clock and run budget

**Status:** implemented 1 Nov 2026 — `sim.tileStatus` at `0xF0066`, the 60 Hz
tile clock, 6,000 steps/tick in tile mode, JS-core enforcement, and
`tests/tile-clock.test.js` / `tests/ui-tiles.test.js` clock tests. Bit 0
(vblank) is left low; the game synchronizes on bit 1.

1. At 60 Hz, compose `0xF0066`: b0 vblank, b1 frame toggle, b2 S2 (optional),
   b3 `uart_rx_available()`; write it to JS memory and `poke()` the active core.
2. Call `engine.tick()` at the same boundary.
3. Raise the tile-mode step budget. The current loop is 10 ms / 200 steps; the
   game needs a few thousand instructions per frame. Start at 6,000 steps/tick
   and measure; keep per-step store mirroring.
4. Stop with Run and with a hidden tab; resume on the next tick.
5. Headless runs use a fixed steps-per-frame, not wall clock.

**Acceptance:** Flappy's `wait_frame` advances; no hang; frame counter and
`0xF0066` toggle observed; performance measured.

## 8. Phase 6 — D16D image builder and example

**Status:** implemented 1 Nov 2026 — `js/deep16_d16d_image.js`, browser
kernel+showcase image, `D16D Showcase (tiles)` example, script tag and
`tests/d16d-image.test.js` / `tests/ui-d16d.test.js`. The 24K image is code
only; graphics still come from the flash blob loader.

**Tasks**

1. `js/deep16_d16d_image.js` builds **code only**:
   - kernel: editor text, assembled with `CONSOLE_UART + D16NANO + D16D`;
   - showcase: `asm/showcase/showcase.asm` + `flappy_game.asm`, concatenated,
     words at `0x4A00 + address`;
   - fill `0xFFFF`; drop out-of-window words (echo cell `0xF0064` expected);
   - return `{ words, dictFree, biosEntry, build }`.
2. Test against Node `buildImage()` with `D16NANO=1 D16D=1`, word for word.
3. Add `D16D Showcase (tiles)` to `asm/examples.json` with
   `filename: forth_nano.asm`, `build: d16d`, category I/O.
4. Assemble in tile mode:
   - build the code image;
   - seed `sim.spiFlash` with the flash asset blob;
   - `engine.powerOn()`, then `loadGraphics(...)`;
   - fill memory `0x0000..0x5FFF`, set `CS=0xFFFF`, `DS=SS=ES=0`, `PC=0`,
     `d16nano=true`, sync the active core and show the canvas.

The loader runs before the CPU starts, matching a boot loader. Later, when the
CPU flash loader lands, it moves into the image and this host call disappears.

**Acceptance:** equality test passes; example boots to the menu; `gfx`, `F`,
`C`, `Q` work.

## 9. Phase 7 — headless renderer

**Status:** implemented 1 Nov 2026 — `scripts/render_tile.mjs`, PNG encoder
in `scripts/lib_png.mjs`, `npm run render:tile`, and
`tests/showcase-render.test.js` (menu, Flappy motion, console, PNG framing).
Deterministic scenes run at 0x1000 steps/frame.

`scripts/render_tile.mjs`, wired as `npm run render:tile`:

- loads the assembler, image builder, engine, flash blob and loader through the
  browser-script path used by tests;
- scenes: `console` (nano kernel prompt), `menu`, `flappy` (N frames, optional
  keys);
- deterministic frame clock (fixed steps per frame, status poked at `0xF0066`);
- loads graphics from the flash blob before the first frame;
- writes PNGs to `artifacts/tile/<scene>-<frame>.png` (ignored), optional
  `--scale 2`;
- minimal PNG encoder on `node:zlib` is sufficient.

**Acceptance:** `tests/showcase-render.test.js` renders a menu frame and a
Flappy frame, asserts sky/pipe/bird pixels and motion between frames.

## 10. Phase 8 — integration and docs

**Status:** implemented 1 Nov 2026 — script tags, `assets:gfx` and
`render:tile`, README, `VIDEO.md`, `MEMMAP.md` simulation notes and
`TILESIM.md` status. The generated `openwiki/` pages are intentionally left to
the OpenWiki workflow.

- Add script tags in `index.html` in dependency order (flash assets, loader,
  engine, UI), bump `?v=` strings.
- Add `package.json` scripts: `assets:gfx`, `render:tile`.
- Update `README.md`, `VIDEO.md`, `MEMMAP.md` (simulation note), `TILESIM.md`
  status.
- Update OpenWiki hardware/IDE pages after the code lands.
- Do not touch `rtl/`, `fpga/`, `asm/forth_nano.asm` or the build defines.
- Record the deliberate divergence: simulation makes all 128 tiles writable and
  loads graphics from flash; the current bitstream still bakes them. Link the
  ERRPLAN entries.

## 11. Order and effort

| Phase | Depends on | Effort |
|---|---|---|
| 1 Flash blob + loader | art generators | 1 day |
| 2 Engine | blob/loader (for tests) | 2–3 days |
| 3 Hooks | engine | 1 day |
| 4 UI/mode | hooks | 1–1.5 days |
| 5 Clock/budget | UI | 0.5–1 day |
| 6 Image/example | UI, hooks | 1 day |
| 7 Headless | engine, image | 1 day |
| 8 Docs | all | 0.5 day |

JS-first is the critical path. RTL-core support follows; WASM either gains the
missing devices or stays out of tile mode.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Model drifts from RTL | `dvi_tile_tb.cpp` cases become engine tests |
| No-ROM simulation runs ahead of the bitstream | document the 128-tile target and the flash loader; compare post-load state |
| Sprite window still paged | model control 5 exactly; option A is an ERRPLAN item, not applied |
| Sub-frame line timing differs | render at frame boundaries; document |
| 230k pixels per frame is slow | one `ImageData`, 256-entry RGBA table, render on tick |
| Compiled-core mirroring is noisy | JS first; RTL after state tests; WASM out until devices exist |
| Manual pokes bypass hooks | document; resync single-buffer windows |
| Blob and generators drift | byte-for-byte freshness test |
| Scope creep into hardware | no `rtl/`/`fpga/` edits; mismatches become ERRPLAN entries |

## 13. Definition of done

- The D16D code image runs in the IDE and renders the menu, Flappy and the
  console through the tile engine.
- The engine powers on blank; graphics come from the flash blob through the
  loader, with no video ROM and no `$readmemh`-style seeding.
- All 128 tiles load in simulation; sprite groups load through control 5.
- Engine tests cover every `dvi_tile_tb.cpp` behaviour.
- Browser code image and Node `buildImage()` agree word for word.
- Headless renderer produces stable PNGs.
- Three console modes work, with tile mode routing input and status correctly.
- Docs record the forward divergence and link the ERRPLAN entries.
