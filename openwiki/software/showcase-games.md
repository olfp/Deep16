---
type: "Reference"
title: "D16D Showcase, Flappy and Pac-Man"
openwiki_generated: true
sources:
  - id: openwiki-source-a28946850ce54d03e71935f2
    resource: repo://asm/forth_nano.asm
  - id: openwiki-source-8f8006fec71d6ef06fff2570
    resource: repo://asm/showcase/flappy_game.asm
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
  - id: openwiki-source-f0a7f20aa1f4899a42cf52d2
    resource: repo://scripts/make_pacman_art.mjs
  - id: openwiki-source-91dbd2aac6f60eec7eacf72d
    resource: repo://scripts/make_showcase.mjs
  - id: openwiki-source-41517f64370d769c203d48a3
    resource: repo://scripts/make_slices.mjs
  - id: openwiki-source-65da0d5192db8e4738ae307f
    resource: repo://scripts/make_tile_font.mjs
  - id: openwiki-source-6e20ddc663ad06d95cd35018
    resource: repo://tests/pacman.test.js
  - id: openwiki-source-e3cbc9bdf6a73d9a2ec96f60
    resource: repo://tests/segmented.test.js
generated: { by: "opencode", at: "2026-11-04T15:30:01.509Z" }
verified:
  - by: openwiki/0.7.3
    at: 2026-11-04T15:30:01.509Z
---


# D16D Showcase, Flappy and Pac-Man

The D16D demo is the power-on screen of the tile machine: a BIOS-segment menu
with **Flappy** and **Pac-Man**, plus **Forth** as the exit back to the
interpreter. The BIOS calls it through function 6 (`gfx`), parks its `R5`/`R6`
and resumes the console when the menu returns.

The menu and Flappy are one assembled block in the BIOS segment `0x04A0`
(physical `0x4A00`). Pac-Man is a separate block that is **not in the 24K
image** any more: the kernel grew to `0x434D`, so the game is a type-4 binary
slice in config flash and is copied to segment `0x2000` at run time.

## Menu and launch

| Offset | Contents |
|---|---|
| `0x334` | trampoline: sets `DS=0x04A0` and jumps to `menu_entry` |
| `0x339` | menu strings, cloud table and the game palette |
| `0x3E4` | four-word header: magic `0x0D16`, format 1, entry `0x334`, reserved |
| `0x500` | menu code |
| `0x5AF`–`0x5CA` | free menu gap |
| `0x5CB` | Flappy bird colours and dizzy sprite groups |
| `0x5E0` | default palette table |
| `0xA00`–`0xDFF` | Flappy game |

The menu draws `D16 SHOW 29`, `F  FLAPPY`, `P  PAC-MAN`, `Q  FORTH` and the
`AUTORUN FLAPPY 10s` note. `F` starts Flappy, `Q` returns to the BIOS, and the
idle timer starts Flappy in attract mode after ten seconds. The Pac-Man entry
was added in the free `0x3E8` string gap and a launcher lives at `0x4A4`.

The launcher still sets `R10=0x04A0`, `R11=menu_after` and jumps to `0x4330`,
the old image address. With Pac-Man now in config flash that entry needs the
`games.fth` `game-load`/`call-far` hookup; the game itself is runnable from the
Forth prompt with `s" pacman" game-run`. This is the known integration gap.

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
| Bird, dizzy poses, cloud | sprite groups 2–7 per bird page | Flappy |
| Pac-Man right/up/down open+closed | sprite groups 0/1, 8/9, 16/17 | Pac-Man |

Flappy selects a bird page by colour and keeps relative groups 3–7; the cloud
is duplicated on each page. Pac-Man's sprite groups are the six groups Flappy
leaves free; the OAM H flip draws the left direction. Pac-Man's ghosts are **tile
art**, not sprites, because the sprite bank has no groups to spare.

Palette set 0 is the menu/Flappy scene; set 1 is Pac-Man's. Pac-Man installs
text black/white, art black/white/wall blue/ghost red/fright cyan/dot
pink/pellet yellow and sprite key/Pac-Man yellow. Control 5 selects the set and
the OAM base.

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
npm run flash:slices    # write the source and Pac-Man slices at 0x200000
```

`scripts/make_showcase.mjs` assembles the menu+Flappy block and builds/checks
the Pac-Man block. `scripts/make_image.mjs` places the showcase at `0x4A00` and
writes the D16D image; with `BAKE_PACMAN=1` (or the browser `bakePacman`
option) it can bake the game at `0x4330` for a preview, but the current board
image leaves it in flash. `npm run render:tile` bakes the preview only.

## What the tests pin

| Test | Covers |
|---|---|
| `tests/pacman.test.js` | 30×23 packing, 250 pickups, block limits, movement/eating, win/death return, frightened ghost |
| `tests/segmented.test.js` | type-4 `game-load` into `0x2000`, `game-run` far call and return, dots/column after play |
| `tests/showcase-art.test.js` | sprite groups, Pac-Man art slots, bird palette table |
| `tests/showcase-death.test.js` | Flappy OAM groups, death poses, Q exit |
| `tests/showcase-render.test.js` | deterministic menu/Flappy/Pac-Man/console PNGs |
| `tests/d16d-image.test.js`, `tests/ui-d16d.test.js` | browser builder, non-baked image, source loading |
| `tests/slices-binary.test.js` | type-4 slice layout and chaining |

## Known gaps

- The menu **P** entry still points at `0x4330`; the flash-loader hookup is
  pending. `s" pacman" game-run` is the working route.
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
