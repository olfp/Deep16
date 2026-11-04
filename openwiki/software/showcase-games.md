---
type: "Reference"
title: "D16D Showcase, Flappy, Pac-Man and Frogger"
openwiki_generated: true
sources:
  - id: openwiki-source-a28946850ce54d03e71935f2
    resource: repo://asm/forth_nano.asm
  - id: openwiki-source-8f8006fec71d6ef06fff2570
    resource: repo://asm/showcase/flappy_game.asm
  - id: openwiki-source-994b8d8fad4641d652ea31d4
    resource: repo://asm/showcase/frogger_demo.asm
  - id: openwiki-source-55f1d0179bc5e3939c5653e6
    resource: repo://asm/showcase/pacman_map.asm
  - id: openwiki-source-a8e49bad3e0cb80eca5069d8
    resource: repo://asm/showcase/showcase.asm
  - id: openwiki-source-b57ab1606c48ec3ea7344623
    resource: repo://MEMMAP.md
  - id: openwiki-source-ea2bb1d1b243f8f87d7dcc7a
    resource: repo://rtl/flash/flash_boot.sv
  - id: openwiki-source-e1fceea6c897878bdf0ab247
    resource: repo://scripts/make_bird_sprite.mjs
  - id: openwiki-source-8502374633e1d98b94216053
    resource: repo://scripts/make_frogger_art.mjs
  - id: openwiki-source-f0a7f20aa1f4899a42cf52d2
    resource: repo://scripts/make_pacman_art.mjs
  - id: openwiki-source-91dbd2aac6f60eec7eacf72d
    resource: repo://scripts/make_showcase.mjs
  - id: openwiki-source-41517f64370d769c203d48a3
    resource: repo://scripts/make_slices.mjs
  - id: openwiki-source-65da0d5192db8e4738ae307f
    resource: repo://scripts/make_tile_font.mjs
  - id: openwiki-source-ec855bf52d0f49509d504925
    resource: repo://tests/d16d-image.test.js
  - id: openwiki-source-8455325ffcce9d2e397028bf
    resource: repo://tests/frogger.test.js
  - id: openwiki-source-6e20ddc663ad06d95cd35018
    resource: repo://tests/pacman.test.js
  - id: openwiki-source-e3cbc9bdf6a73d9a2ec96f60
    resource: repo://tests/segmented.test.js
  - id: openwiki-source-3c07bfc0a532e3b861560036
    resource: repo://tests/showcase-render.test.js
generated: { by: "opencode", at: "2026-11-04T16:08:29.597Z" }
verified:
  - by: openwiki/0.7.3
    at: 2026-11-04T16:08:29.597Z
---


# D16D Showcase, Flappy, Pac-Man and Frogger

The D16D demo is the power-on screen of the tile machine: a BIOS-segment menu
with **Flappy**, **Pac-Man**, the **Frogger** backdrop and **Forth** as the exit
back to the interpreter. The BIOS calls it through function 6 (`gfx`), parks its
`R5`/`R6` and resumes the console when the menu returns.

The menu and Flappy are one assembled block in the BIOS segment `0x04A0`
(physical `0x4A00`). Pac-Man is a separate block that is **not in the 24K
image** any more: the kernel grew to `0x434F`, so the game is a type-4 binary
slice in config flash and is copied to segment `0x2000` at run time. Frogger is
a small backdrop block baked directly into the flat image at physical `0x4350`
(CS=DS=`0x0435`).

## Menu and launch

| Offset | Contents |
|---|---|
| `0x334` | trampoline: sets `DS=0x04A0` and jumps to `menu_entry` |
| `0x339` | menu strings, cloud table and the game palette |
| `0x3E4` | four-word header: magic `0x0D16`, format 1, entry `0x334`, reserved |
| `0x500` | menu code |
| `0x5AF`–`0x5D2` | menu launch/quit stubs, `menu_ret`, `menu_frames`, `menu_last` |
| `0x5D3`–`0x5D4` | free (2 words) |
| `0x5D5` | Flappy bird colours and dizzy sprite groups |
| `0x5E0` | default palette table |
| `0xA00`–`0xDFF` | Flappy game |

The menu draws `D16 SHOW 29`, `F  FLAPPY`, `P  PAC-MAN`, `Q  FORTH`,
`G  FROGGER` and the `AUTORUN FLAPPY 10s` note. `F` starts Flappy, `P` starts
Pac-Man, `G` starts the Frogger backdrop, `Q` returns to the BIOS, and the idle
timer starts Flappy in attract mode after ten seconds. The Pac-Man entry was
added in the free `0x3E8` string gap; the G entry is at `0x3F3` and row 13, just
past the P string's terminator, and its draw helper lives at `0x4B0`.

The Pac-Man launcher still sets `R10=0x04A0`, `R11=menu_after` and jumps to
`0x4330`, the old image address. With Pac-Man now in config flash that entry
needs the `games.fth` `game-load`/`call-far` hookup; the game itself is runnable
from the Forth prompt with `s" pacman" game-run`. This is the known integration
gap. The Frogger launcher at `0x4C0` instead jumps to `0x0435:0`, which points
at the always-baked block.

The showcase block is sparse: `buildShowcase()` writes from offset `0x334` to
`0xDFF`, and `checkShowcase()` refuses any write into `0x600`–`0x9FF`
(physical `0x5000`–`0x53FF`). That gap is reserved, not used, which is why the
BIOS keeps its UART mirror at `0x5346` and the non-blocking getstr at `0x5356`
there. The BIOS code itself ends at `0x4CD5`, just below the menu trampoline at
`0x4D34`.

## Shared art and sprites

The tile bank is written at build time by `scripts/make_tile_font.mjs`; the
sprite bank by `scripts/make_bird_sprite.mjs`; the Pac-Man data, wall art and
frames by `scripts/make_pacman_art.mjs`. `scripts/make_flash_assets.mjs` packs
the result into the graphics blob the IDE and the board loader use.

| Asset | Slots | Used by |
|---|---|---|
| Pipes, caps, grass, dirt, clouds | tiles 96–109 | Flappy |
| Dot left/right, pellet left/right | tiles 49–52 | Pac-Man maze |
| Ghost left/right, frightened left/right | tiles 53–56 | Pac-Man ghosts |
| Wall shapes (8 left + 8 mirrored) | tiles 110–125 | Pac-Man maze |
| Six flat colour fills (water, road, grass, red/yellow car, log) | tiles 57–62 | Frogger backdrop |
| Bird, dizzy poses, cloud | sprite groups 2–7 per bird page | Flappy |
| Pac-Man right/up/down open+closed | sprite groups 0/1, 8/9, 16/17 | Pac-Man |

Flappy selects a bird page by colour and keeps relative groups 3–7; the cloud
is duplicated on each page. Pac-Man's sprite groups are the six groups Flappy
leaves free; the OAM H flip draws the left direction. Pac-Man's ghosts are **tile
art**, not sprites, because the sprite bank has no groups to spare. Frogger needs
no art or sprites: six single-colour tiles fill the remaining font gap.

Palette set 0 is the menu/Flappy scene; set 1 is Pac-Man's; set 2 is Frogger's.
Pac-Man installs text black/white, art black/white/wall blue/ghost red/fright
cyan/dot pink/pellet yellow and sprite key/Pac-Man yellow. Frogger writes set 2
entries 1–6 at run time for water, road, grass, the two cars and the log.
Control 5 selects the set and the OAM base.

## Flappy

Flappy is the reference implementation for the tile/sprite layer:

- an 80 × 24 double-buffered map holds the pipes and ground; the bird and four
  clouds are 32 × 32 OAM sprites, so parallax is free;
- the bird flaps on `F`/Space and on the S2 button; the menu's idle timer starts
  the same game in attract mode;
- the sprite page (bird colour) is picked per reset from the cycle counter and a
  play counter; the palette entries 2/13 carry body and belly;
- three pipes with gaps, a scrolling cloud layer, a death sequence with dizzy
  poses and a falling vflip, a best score in the kernel data cells, and `Q` as
  the immediate exit;
- the game installs its art palette on entry and restores `pal_default` on exit,
  so the menu comes back with the default colours.

The block is documented in `asm/showcase/flappy_game.asm`; its state cells sit
just below the menu at `0x4D5`–`0x4FF`.

## Frogger backdrop

`asm/showcase/frogger_demo.asm` is a backdrop-only demo, not a game: it exists
to exercise **per-row scrolling** (control 6) with five river lanes and five road
lanes moving independently. There is no player, collision or score.

| Property | Value |
|---|---|
| Block | 466 words, max offset `0x316` |
| Location | physical `0x4350`–`0x4665`, CS=DS=`0x0435` |
| Lane layout | rows 0–3 grass, 4–8 river, 9 median, 10–14 road, 15–23 grass |
| River (top to bottom) | right, left, fast right, right, left |
| Road (top to bottom) | left, right, left, right, left (top truck lane goes left) |
| Writable state | `0x300` coarse starts, `0x30A` phases, `0x314` frame bit, `0x315`/`0x316` return pair |

Each lane keeps a `0..15` coarse start cell and a `0..7` fine phase. Every frame
the demo advances the phase (`+1`, or `+2` for the fast river lane) and writes
control 6 as `0x100 | row << 3 | phase`. Only when the phase wraps does it
rewrite that row's 80 visible cells shifted by one coarse cell and wrap the start
modulo 16. That split is the point of the demo: the register gives sub-cell
motion, while the CPU touches the tilemap once per eight pixels.

Entry installs palette set 2, clears OAM, fills the screen with grass and paints
the ten lanes; `Q` or `q` clears the per-row table, restores palette set 0 and
scroll_x, and returns through the saved `R10`/`R11` pair. `G` on the menu runs
it, and `tests/frogger.test.js` checks the block/tile layout, the lane directions
and speeds, and the Q return.

## Pac-Man

Pac-Man is a 30 × 23 logical-cell maze (16 × 15 px per cell), a deliberate
compression and widening of the arcade 28 × 31 layout. The playfield is 480 px
wide, centred with 80 px margins, and fills tilemap rows 1–23; row 0 is the
score HUD.

| Property | Value |
|---|---|
| Small dots + power pellets | **246 + 4 = 250 pickups** |
| Map storage | 2 bits/cell, 8 cells/word, 4 words/row, 92 words |
| House / door | rows 10–13, cols 11–18, door at row 10 cols 14/15 |
| Tunnel | row 12, wraps between cols 0 and 29 |
| Pac-Man start | `(14,16)` |
| Block size | 1,695 words; code ends at `0x5FB` |
| Load segment | `0x2000` (flash slice 10 at `0x20A000`) |

The maze is generated as base rows plus one corridor column on each side;
`pacmanGrid()` exposes the resulting 30-column grid and `checkMaze()` walks it
from the start, verifies every dot is reachable, checks the 250/4 counts and the
house. The map is packed into `asm/showcase/pacman_map.asm`, with the direction
tables at `0x678` and the palette table at `0x688`.

Gameplay:

- Pac-Man moves one cell every four frames; the requested direction wins when
  open, otherwise the current direction continues, and the tunnel row wraps.
- Dots score 10, pellets 50, ghosts 200. A pellet sets the frightened timer
  (240 frames) and repaints the ghosts cyan.
- Ghosts move every seven frames and greedily minimise (or, when frightened,
  maximise) Manhattan distance to Pac-Man, skipping the reverse direction. They
  spawn on the roof corridor at row 9 and the door is closed, so the house is
  decorative for now.
- Collision is checked both after a Pac-Man move and after the ghost tick, so
  Pac-Man cannot pass through a ghost between ticks. A frightened ghost goes
  back to `(14,9)`.
- `WASD` steers; `Q` quits. Winning or dying shows `YOU WIN!`/`GAME OVER` and
  returns to the menu after 600 frames.
- The score HUD is four BCD digits at columns 40–43, drawn by repeated
  subtraction because `DIV` traps on the D16nano.

The game block is assembled with `.org 0`, sets `DS=CS` on entry and returns
through `JML R10`; the loader supplies `R10`/`R11`. Its static map, tables and
writable state live at offsets `0x600`–`0x6C9`. `buildPacman()` returns the
block, `checkPacman()` enforces the code/map/state limits, and
`scripts/make_slices.mjs` wraps it in the type-4 slice.

## Build and preview

```sh
npm run assets:gfx      # tile/sprite/palette blob from the art generators
npm run image           # D16D image; Pac-Man is not baked into the 24K window
npm run render:tile -- --scene=menu --frames=1
npm run render:tile -- --scene=flappy --frames=5
npm run render:tile -- --scene=pacman --frames=30 --key=0x64
npm run render:tile -- --scene=frogger --frames=24
npm run flash:slices    # write the source and Pac-Man slices at 0x200000
```

`scripts/make_showcase.mjs` assembles the menu+Flappy block and builds/checks
the Pac-Man and Frogger blocks. `scripts/make_image.mjs` places the showcase at
`0x4A00`, always bakes Frogger at `0x4350` and writes the D16D image; with
`BAKE_PACMAN=1` (or the browser `bakePacman` option) it can bake Pac-Man at
`0x4330` for a preview, but the current board image leaves it in flash.
`npm run render:tile` bakes the Pac-Man preview only.

## What the tests pin

| Test | Covers |
|---|---|
| `tests/frogger.test.js` | Frogger block/tile layout, lane directions/speeds, Q return |
| `tests/pacman.test.js` | 30×23 packing, 250 pickups, block limits, movement/eating, win/death return, frightened ghost |
| `tests/segmented.test.js` | type-4 `game-load` into `0x2000`, `game-run` far call and return, dots/column after play |
| `tests/showcase-art.test.js` | sprite groups, Pac-Man art slots, bird palette table |
| `tests/showcase-death.test.js` | Flappy OAM groups, death poses, Q exit |
| `tests/showcase-render.test.js` | deterministic menu/Flappy/Pac-Man/Frogger/console PNGs |
| `tests/d16d-image.test.js`, `tests/ui-d16d.test.js` | browser builder, non-baked image, Frogger placement, source loading |
| `tests/slices-binary.test.js` | type-4 slice layout and chaining |

## Known gaps

- The menu **P** entry still points at `0x4330`; the flash-loader hookup is
  pending. `s" pacman" game-run` is the working route.
- Frogger is a scrolling backdrop only: it has no player, collision, score or
  win/lose state. The playable game is still a plan in `FROGPLAN.md`.
- Pac-Man has one maze and no fruit bonus, level progression, scatter/chase
  schedule or Cruise Elroy. `docs`/notes record the arcade tables for a future
  level pass.
- All four ghosts share the red art; classic per-ghost colours would need more
  art slots.
- The ghost AI is greedy Manhattan chase with reverse-skip; the four distinct
  targeting personalities are not implemented yet.

## Related pages

- [Console, Terminal and Boot Scripts](../software/bios-and-console.md)
- [PSRAM, Cache and Flash Boot](../hardware/psram-cache-and-flash.md)
- [Video and Peripherals](../hardware/video-and-peripherals.md)
- [Build, Test and Image Pipeline](../tooling/build-test-and-images.md)
