# Tile engine in the simulation

Bring the D16nano tile graphics — tilemap, 4bpp tiles, sprites, palette,
double buffering and hardware scroll — into the browser IDE and into a headless
PNG renderer, driven by the same D16D image the board flashes.

Status: **planned.**

The CPU half already works. `tests/showcase-death.test.js`,
`tests/gfx-demo.test.js` and `tests/tile-console.test.js` run the D16D showcase,
the colour demo and the nano console on the JS core. What is missing is the
video half: nothing in the simulation interprets the tile windows as a picture.
The Screen tab's box is already 640x360 in `css/screen.css`, which is exactly
`dvi_tile`'s source canvas.

Decisions taken:

- The headless PNG renderer is part of the feature and shares the same engine.
- The D16D image is built in the browser from the four sources
  (`forth_nano.asm`, `showcase.asm`, `flappy_game.asm`, `gfx_demo.asm`), not
  loaded from a committed binary.
- The store model is bank-aware from the start, so the double-buffered map and
  the frame-boundary page/scroll latch are exact.
- `dvi_tile.sv` and `rtl/sim/dvi_tile_tb.cpp` remain the hardware reference. The
  JS model mirrors them, including their quirks.

Verified before planning: assembling the four sources with
`CONSOLE_UART + D16NANO + D16D`, placing the showcase at `0x4A00 + offset` and
the demo at `0x4E00`, reproduces `buildImage()` with both env flags word for
word (24,576 words, 0 differences). The browser builder can therefore be held
to the flashed image exactly.

## 1. Tile engine model

New file: `js/deep16_tile_engine.js`, a plain browser script (no modules, no
DOM, no timing), so both the IDE and the Node scripts can load it.

State, mirroring `rtl/dvi/dvi_tile.sv`:

| State | Size | Source |
|---|---|---|
| `tilemap[2]` | 2 x 2,132 words | `0xF1000..0xF1853`, bank from control 4 b0 |
| `tileBank` | 4,096 words (128 tiles x 32) | `0xF3000..0xF3FFF` |
| `spriteBank` | 2,048 words (128 patterns x 16) | `0xF4000..0xF47FF` |
| `oam` | 16 words | `0xF5000..0xF500F` |
| `palette` | 16 x RGB332 | `0xF5080..0xF508F` |
| controls | cursor, `row_off`, `scroll_x_next`, `scroll_y`, write/display page | `0xF2000..0xF2008` |

Methods:

- `write(addr, value)` — the CPU window. Routes to the current tilemap bank,
  the tile/sprite banks, OAM/palette or the control registers, with the same
  address masks and range checks as `dvi_tile.sv:218-284`. Writes outside a
  window are ignored, as on the board.
- `tick()` — one render frame boundary. Copies `display_page_next` to
  `display_page` and `scroll_x_next` to `scroll_x`, and advances the cursor
  blink (the RTL toggles `blink[23]` at 24.75 MHz, ~0.34 s visible half-period).
- `render()` — fills a 640x360 RGBA buffer and returns it (plus the canvas
  path). No memory reads.
- `powerOn()` — loads the video ROM into the banks/palette, clears the tilemap,
  OAM, controls. Called when a program is assembled/loaded.
- `reset()` — clears OAM and the controls, keeps the banks/palette/tilemap,
  matching `rst_render` (`$readmemh` is initial-only; OAM has a reset).
- `snapshot()` — optional, for tests and for the headless renderer to compare
  state rather than pixels.

Render rules, taken from `dvi_tile.sv`:

1. Visible area is 80 x 24 cells of 8 x 15 pixels; cell row is
   `(tile_row + row_off) mod 24` (`wrap_rows`, `dvi_tile.sv:317-320`).
2. `scroll_y` adds a carry into the tile row and shifts the glyph row;
   `scroll_x` starts the fill at `scroll_x >> 3` with `scroll_x & 7` pixels into
   the first tile. The display/`scroll_x` pair is latched together at `tick()`.
3. Tile pixel = 4-bit nibble, word `tile*32 + 2*row` for pixels 0..3 and `+1` for
   4..7, low nibble leftmost. Word 30 (palette pointer) is **not** added; the
   RTL does not wire it yet. Word 31 flags are unused.
4. Background index indexes the 16-entry palette directly.
5. Cursor: when enabled, blinking, `fline < 360`, `tile_row == cur_row` and
   `cell_col == cur_col`, XOR the palette byte with `0xFF`.
6. Sprites: 8 x 32x32, 4bpp, index 0 transparent; pattern
   `tile = group*16 + (row/8)*4 + column`, word `tile*16 + (row%8)*2 + half`;
   Hflip reverses word and nibble, Vflip reads row 31-row; behind bit hides the
   sprite behind background index 0; sprite 0 wins the priority chain.
7. RGB332 expands exactly as the RTL output: red `{7:5,7:5,6:5}`, green
   `{4:2,4:2,3:2}`, blue `{1:0,1:0,1:0,1:0}`.

## 2. Store hooks

The engine must see writes in order; polling memory cannot represent two
tilemap banks or the page latch.

- JS core: `checkScreenUpdate(address, value)` is already called by both `ST`
  (`deep16_simulator.js:460`) and `STS` (`:1064`). Extend it to feed
  `0xF1000..0xF50FF` to the engine. In tile mode it must not also drive the
  text-cell handler; the two views share `0xF1000`.
- Compiled cores: the IDE mirrors each store into JS memory at
  `deep16_ui_core.js:3034` and `:3090`. Both points feed the engine.
- Reset/assemble paths call `powerOn()`/`reset()` on the engine as described
  above.
- A manual Memory-panel poke bypasses the hooks. Note it in the UI/docs; the
  engine's single-buffer windows can be resynced from memory, back-buffer
  contents cannot.

The engine is fed even in screen/terminal mode, so switching to Tiles shows the
current state rather than a blank.

## 3. Video ROM

On the board the tile bank, sprite bank and palette are BSRAM initial contents
(`$readmemh` of `tilefont.hex`, `birdsprite.hex`, `tilepal3.hex`,
`rtl/dvi/dvi_tile.sv:189-193`). CPU memory does not contain them and PSRAM reads
stay `0xFFFF`, so they are engine state, never seeded into the CPU address
space.

- New generator `scripts/make_video_rom.mjs` reusing `tileFontWords()`,
  `artTiles()` and `PALETTE_RGB332` from `make_tile_font.mjs` /
  `make_art.mjs`, and the bird groups from `make_bird_sprite.mjs`.
- Output `js/deep16_video_rom.js`, committed and compact (hex or base64), like
  `wasm/pkg` and `rtl/pkg`, so the IDE needs no build step.
- Test regenerates and compares word for word, so the art pipeline stays the
  single source of truth.

## 4. D16D image builder

New file: `js/deep16_d16d_image.js`:

```
Deep16D16DImage.build({ kernel, showcase, flappy, demo })
  -> { words: Uint16Array(0x6000), build, dictFree, biosEntry, ... }
```

- Kernel: `Deep16Assembler` with
  `{ CONSOLE_UART: 1, D16NANO: 1, D16D: 1 }`.
- Showcase: `showcase.asm` + `\n` + `flappy_game.asm` assembled together, every
  word written at physical `0x4A00 + address`.
- Demo: `gfx_demo.asm` assembled at its `.org 0x404`, header
  `0x0D16 / 1 / 0x0404 / 0` at `0x4E00`, words from `0x404` at `0x4E00 + (addr - 0x400)`.
- Fill `0xFFFF`; drop anything outside `0x6000` (the echo cell `0xF0064` is
  expected out of window).
- Return the same facts the manifest uses (build hash optional in the browser;
  the images must match word for word regardless).

Ports the placement rules from `make_image.mjs:94-112`, `make_showcase.mjs` and
`make_demo.mjs`; no crypto or filesystem in the browser copy.

Test: build the same four sources in Node and compare every word with
`buildImage()` under `D16NANO=1 D16D=1` (validated: 0 differences). The browser
version is source-driven, so edits to the kernel/showcase are picked up by
Assemble.

## 5. Display clock and status

`0xF0066` is the D16nano display/input status. The game's `wait_frame`
(`asm/showcase/flappy_game.asm:91-106`) spins until bit 1 changes, so without a
clock it hangs.

New small module (inside the screen/tile UI or `js/deep16_tile_engine.js`'s
host): at 60 Hz, compose

```
b0 vblank    (short pulse at the start of the tick; unused by the game)
b1 frame     (toggle once per tick; the render frame boundary)
b2 S2 button (optional; Space via UART already works)
b3 UART ready (uart_rx_available() / sim.uartRxAvailable())
```

then write `0xF0066` to JS memory and `poke()` the active core (the IDE already
pokes the echo cell), and call `engine.tick()`.

- Runs only for the tile profile, not for the screen/terminal builds.
- Stops with Run and with a hidden tab; the game resumes on the next tick.
- The IDE run loop executes 200 steps per 10 ms. That is 20k instructions/s and
  the game's loop needs a few thousand per frame, so the tile profile raises the
  per-tick budget (measure the game's work; start around 6,000 steps for ~60 fps)
  and keeps the per-step store mirroring.

The display tick is wall-clock based in the IDE; the headless renderer uses a
fixed step budget, so PNGs are reproducible.

## 6. UI

- Third console mode `tiles` alongside `screen` and `terminal`: the Console
  button cycles Screen -> Terminal -> Tiles, persisted in `localStorage`.
- Entering Tiles sets the nano build defines and routes keyboard input to UART
  (the tile kernel polls UART, not the PS/2 FIFO). `ensureTerminalCore()` covers
  it too.
- `Deep16ScreenUI.setConsoleView('tiles')` hides the 80x24 grid and the pager,
  shows a `<canvas width=640 height=360>` inside `#screen-display`, and paints
  `engine.render()` on `requestAnimationFrame` (only when the state changed or
  a tick happened). The box stays 640x360; `image-rendering: pixelated`; scale
  down on narrow layouts.
- Info line: tilemap `0xF1000`, controls `0xF2000`, bank `0xF3000`, sprites
  `0xF4000`, OAM/palette `0xF5000`.
- The palette legend is meaningless in tile mode (the view uses RGB332 from
  `0xF5080`); hide it.
- Keep the hidden keyboard hook in the tab; clicking the canvas focuses it.

Example: add `D16D Showcase (tiles)` to `asm/examples.json`
(`filename: forth_nano.asm`, `build: d16d`, category I/O). `loadExample()`
remembers the build and selects Tiles; `assemble()` then:
1. fetches `asm/showcase/showcase.asm`, `asm/showcase/flappy_game.asm`,
   `asm/gfx_demo.asm` with `cache: 'no-store'`,
2. builds the composite image from the editor (the kernel) and the three
   sources,
3. fills `this.simulator.memory` with `0xFFFF` over `0x0000..0x5FFF`, copies the
   image, sets `CS=0xFFFF`, `DS=SS=ES=0`, `PC=0`, `d16nano = true`, calls
   `engine.powerOn()`, syncs the active core, and shows the tile view.

Typing `gfx` at the prompt reaches the menu; `F` starts Flappy, `C` the colour
demo, `Q` returns. Guard the mode: if the editor does not hold the nano kernel,
say so rather than assembling the screen build with the wrong defines.

## 7. Headless renderer

`scripts/render_tile.mjs`, wired as `npm run render:tile`:

- Loads the assembler, the image builder and the engine through the same
  browser-script path the tests use.
- Sources from disk; scenes:
  - `console` — plain nano kernel (`CONSOLE_UART + D16NANO`), prompt rendered.
  - `menu` — boot, type `gfx`, one frame.
  - `flappy` — menu, `F`, N frames (optionally keystrokes for flaps).
  - `demo` — menu, `C`, N frames.
- Drives the JS core with a deterministic frame clock (steps per frame, status
  at `0xF0066`, `uartRxPush` for keys) and calls `engine.render()` at frame
  boundaries.
- Writes PNGs to `artifacts/tile/<scene>-<frame>.png` (artifacts are ignored),
  optionally `--scale 2` for 1280x720. A minimal PNG encoder on `node:zlib` is
  enough; `scripts/lib_png.mjs` only decodes.
- `--keys`/`--frames` options for ad-hoc captures.

## 8. Tests

| Test | Pins |
|---|---|
| `tests/video-rom.test.js` | committed ROM equals the generated tile/art/bird/palette data |
| `tests/tile-engine.test.js` | H cell from the font, row-offset scroll, `scroll_x` 8 px, palette write, 32x32 sprite bands, transparency, behind, sprite-0 priority, H/V flip, cursor XOR/blink, RGB332 expansion, bank write page + latch, reset keeps banks |
| `tests/d16d-image.test.js` | browser builder = `buildImage()` with `D16NANO + D16D`, word for word; no words outside the window except the echo cell |
| `tests/showcase-render.test.js` | run the image under the deterministic clock, render menu/Flappy frames, assert sky/pipe/bird pixels and motion; Q during death still returns |
| `tests/ui-terminal.test.js` (extend) | three console modes, label cycle, build defines, UART input route in Tiles, canvas visible only in Tiles |
| `tests/ui-core.test.js` (extend) | store hook routes video windows to the engine, not the text grid, in tile mode |

The RTL scenarios in `rtl/sim/dvi_tile_tb.cpp` (H, scroll, bank/palette, sprite
transparency/behind/flips/priority, double buffer, vblank/frame) are the spec for
the engine tests; they are copied as writes and expected probes, not run from
the tb. A full pixel-parity harness against Verilator is possible later; it is
not part of this plan.

## 9. Order of work

1. `scripts/make_video_rom.mjs` + `js/deep16_video_rom.js` + test.
2. `js/deep16_tile_engine.js` + unit tests from the RTL scenarios.
3. Store hooks in the simulator and the IDE; verify against a real showcase run.
4. Canvas, `tiles` console mode, input routing, info line.
5. Status clock, engine tick, run-loop budget.
6. `js/deep16_d16d_image.js` + example + equality test.
7. `scripts/render_tile.mjs` + PNGs + showcase render test.
8. Docs (`README.md`, `VIDEO.md`, MEMMAP note), `package.json` scripts, script
   tags and `?v=` bumps in `index.html`.

## 10. Risks and non-goals

- **Line timing.** The IDE snapshots per display frame; the RTL fills line by
  line at 24.75 MHz, so a write in the middle of a line can affect that frame in
  hardware. Bank swap, scroll latch, cursor and sprite row selection are exact;
  sub-frame line timing is not, and will be documented.
- **`scroll_y` wrap.** Mirrored as 24 rows, not 26, and word 30's palette
  pointer is ignored, because that is what the current RTL does. Fixing either
  is a hardware change, out of scope.
- **Performance.** 640x360 per frame is 230k pixels; use one `ImageData` and a
  precomputed 256-entry RGBA table. If it is too slow, render only on tick.
- **Reset semantics.** Power-on seeds the ROM; Reset keeps the banks and clears
  OAM/controls, like the RTL; Assemble starts from `powerOn()`.
- **Memory panel.** Manual pokes bypass the bank model; documented, with a
  resync for the single-buffer windows.
- **Not in scope:** a tile engine in the RTL core, a committed D16D binary,
  audio, S2 hardware emulation beyond the status bit, and changing the tile
  format or palette pointer wiring.
