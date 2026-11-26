# TILE256B — 256 tiles, and the sprite bank back at 24 groups

Status: **implemented.** Phase 2/3 shipped 16 sprite groups; Phase 5 restored
24 after the 8 KB cache experiment showed the freed blocks bought no speed.
Final synthesis: **26 SDPB / 26**, CLS 4,239 / 4,320, logic 8,369 / 8,640,
registers 2,821.
The text pages carry the seven German glyphs at slots 96..102.
Pole is excluded from the default image and slice set, developer-only.
Parent analysis: `TILE256.md`. Related: `MEMMAP.md` §7.4,
`doc/FiT-Graphics-howto.md`, `rtl/dvi/dvi_tile.sv`, `rtl/deep16_top.sv`,
`asm/showcase/flappy_game.asm`, `asm/showcase/pacman_game.asm`.

## 1. Decision

Phase 3 funded 256 tiles by cutting the sprite bank from 24 to 16 groups
(Phase 5 restored it; see §7):

| Change | SDPB |
|---|---:|
| Current | 26 |
| Sprite 24 -> 16 groups | -4 |
| Tilefont 128 -> 256 | +4 |
| **Subtotal** | **26 / 26** |
| Optional I2S FIFO -> SSRAM/registers | -1 |
| **With I2S move** | **25 / 26** |

No tilemap tail split and no renderer read-path mux are needed. The tilemap
stays 82 x 26 and keeps its current scroll behaviour.

Pole is deferred. The menu is plain text. Flappy loads one bird page on
demand. Pac-Man uses three horizontal + three vertical frames with OAM H/V
flips. Frogger uses groups 0..6.

## 2. Phase 1 — game/art prep (implemented)

This phase runs with the current 24-group RTL; it validates the group and
frame conventions before the bank shrinks.

### Flappy: one page, not three

- `flappy_start` now copies one 2,048-word page (red) instead of all 6,144.
- `reset_play` picks the colour and calls `bird_page_copy` with
  `R1 = colour`; it copies `FLAPPY_SPR_PACK + colour*2048` into groups 0..7.
- `G_BIRD_GROUP` is 0; the relative groups 2 (cloud), 3..5 (dizzy) and 3..7
  (bird) address the loaded page.
- The source slice still carries all three pages at `0x2000`; only 2,048
  words are resident.
- `tests/showcase-death.test.js` now checks the selected page and groups 3..7.

### Pac-Man: five base frames plus flips

`scripts/make_pacman_art.mjs` now emits:

| Group | Frame |
|---:|---|
| 0 | horizontal open (right) |
| 1 | horizontal half (right) |
| 2 | closed (shared, symmetric) |
| 3 | vertical open (up) |
| 4 | vertical half (up) |

- Left is the horizontal frame with H flip (`0x2000`).
- Down is the vertical frame with V flip (`0x4000`).
- Ghosts moved from `18/5/13/21` to **5/6/7/8**.
- `pac_sp_dir`/`pac_sp_write` select base 0 or 3 and set H/V; the separate
  down groups and `pac_saved_groups` are gone.
- The runtime pack drops from six frames (1,536 words) to five (1,280 words);
  Pac-Man's slice max fell from `0x1F7F` to `0x1E7F`.
- `tests/pacman.test.js` and `tests/showcase-art.test.js` pin the new groups,
  five frames and the V-flip convention.

### Phase 1 verification

- `npm test`: 987 pass, 0 fail.
- `node scripts/make_slices.mjs`: assembles the new Pac-Man and Flappy slices.
- Phase 1 ran with the old 24-group bank; Phase 2 below shrinks it.

## 3. Phase 2 — shrink the bank to 16 groups (implemented)

### 3.1 RTL

`rtl/dvi/dvi_tile.sv`:

- `SPR_GROUPS = 16`, `SPR_WORDS = 4,096`.
- `spr_raddr` is 12 bits; `laddr`/`ltile` are 12/8 bits.
- `loam_group_ok = (loam_group < 5'd16)`.
- CPU sprite write: `sprite[cpu_addr[11:0]]`.
- Comments and the `MEMMAP` window text describe 16 groups.

`rtl/deep16_top.sv`:

- `spr_hit` range is `0xF4000..0xF4FFF`.
- `tile_addr` uses the low 12 bits for every window; the tile bank's page bit
  is in control 5 rather than the window address.

`js/deep16_simulator.js` / tile engine:

- Match the 0xF4000..0xF4FFF window and 4,096-word sprite bank in the
  simulation and any test harness that writes group 17+.

### 3.2 Baked bird bank and Flappy source

`scripts/make_bird_sprite.mjs` keeps 24 groups (6,144 words) for Flappy's
source pack, and Flappy still copies one 2,048-word page into groups 0..7.

Phase 3 baked only the red page (4,096 words). Phase 5 restored the full
three-page bank, so `bakedBirdSpriteWords()` returns all 6,144 words again,
split into `birdsprite_lo.hex` (groups 0..15) and `birdsprite_hi.hex`
(groups 16..23) for the two RTL arrays. `birdsprite.hex` remains the full
file for tooling and archives.

The menu is plain text and does not depend on the baked bird/cloud page.

### 3.3 Pole (excluded from the shipped image)

Pole still uses 18 groups (0 and 17 are the player halves). Phase 3 updated
its map cells to the clean format, but its sprite groups are not ported, so it
is developer-only and **not in the default slice set**. `make_slices.mjs`
excludes `pole` and `polebench` unless `--with-pole` is passed; the menu's R
binding and the `pole` app name are removed. `npm run flash:slices:pole`
builds a local developer image, and `s" pole" game-run` (or
`s" polebench" game-run`) launches it from the prompt. The source, unit tests
and `bench_pole_board` remain in the repo.

Do not ship Pole until it is ported to 16 groups by dropping two model groups
or merging the player halves with a flip.

### 3.4 Verification gate (passed)

`npm run synth:tile` after Phase 2: **BSRAM 22 SDPB (85 %)**, CLS
**4,181 / 4,320**, logic 8,276 / 8,640, registers 2,812 / 6,771.
`npm test`: 987 pass, 0 fail. The gate was:

- BSRAM **22 SDPB** (26 - 4), not 26 and not a new sprite SDPB.
- CLS/logic/timing within the current 4,320/20.2 MHz budget.
- `npm test` green with Pole tests skipped/ported.
- Flappy page copy, Pac-Man frames, Frogger, and the menu still render.

## 4. Phase 3 — 256 tiles (implemented)

### 4.1 Tile bank

- `TILE_COUNT = 256`, `TILE_WORDS = 8,192`, `TILE_AW = 13`.
- `tilefont` is 8,192 x 16 = 131,072 bits = **8 SDPB** (+4).
- `tilefont.hex` is 8,192 words; `scripts/make_tile_font.mjs` emits 256 tiles
  (96 font + 160 art slots) and the asset stamp is updated.
- The JS tile engine, the flash asset blob and the GFX loader all use the
  same 8,192-word bank. The loader writes tiles 0–127, sets control-5 bit 12,
  writes tiles 128–255, then clears the page bit.

### 4.2 Cell format

The clean representation uses the mode bit to split the remaining 15 bits into
two layouts. This is possible because text/font tiles are restricted to the
first 128 tiles.

**Text cell (bit 15 = 1):**

```
15     mode = 1
14:12  text pair 0..7
11:9   style (bit 2 underline, bit 1 bold, bit 0 italic page)
 8:0   glyph index (9 bits; font uses the first 128, so 8:7 are 0)
```

**Art cell (bit 15 = 0):**

```
15     mode = 0
14:0   tile address (15 bits; current 256-tile board uses 7:0 with 14:8 = 0)
```

This is the field split the user requested: style is 11:9 and the tile/glyph
index is 8:0 for both kinds of cell, with the art cell free to use the pair
and style bits as tile high bits on a larger BSRAM part. On the current board
only the low 8 bits are populated, so 256 tiles; a board with more BSRAM can
use bits 8..14 for 512..32768 tiles without changing the format.

RTL (`rtl/dvi/dvi_tile.sv`):

- `fsty = tm_q[11:9]`.
- Text `fpal = tm_q[15:12]`; glyph = cell bits 6:0 (the 128-glyph font).
  `fcell` holds cell[7:0] shifted left five, so `fcell[11:5]` is the glyph.
- Text font address = `glyph*8 + 0x20 + page*0x300 + row>>1` for glyphs 0..95;
  glyphs 96..102 (the seven German extras) use `0x1000 + (glyph-96)*8 +
  page*0x40 + row>>1`. Glyph bits 8:7 stay 0 for the 128-glyph font.
- Art tile = cell bits 7:0; `fcell = {tile, 5'b0}`. Bits 14:8 are reserved
  and masked. The art address is `tile*32`, not an old packed `tm_q[11:5]`
  address.
- Control 5 `0xF200A` bit 12 selects the CPU tile-write page; the renderer
  always uses the full 13-bit tile address.

Software:

- Text cell: `0x8000 | pair<<12 | style<<9 | glyph`.
- Art cell: `tile` (bits 7:0 for 256); no `tile<<5`.
- Existing text cells changed (glyph moved from 11:5 to 8:0; style from 2:0
  to 11:9). Existing art cells changed (tile index replaces `tile<<5`). This
  is a full cell-format break; all slices, game binaries and Forth cell
  builders were rebuilt.
- `utx_char` maps keyboard bytes through a 256-entry table (ASCII plus the
  seven German Latin-1 codes). The native editor and `edit-tile` use the same
  slots; `fd_text`, `screen_demo`, `string_demo`, the showcase menu, Flappy,
  Pac-Man, Frogger and the Pole renderer use the clean cell format.

### 4.3 CPU window

The 4 KiB tile bank window holds 128 tiles, so the 256-tile bank uses a page
bit instead of a wider window:

- Control 5 `0xF200A` bit 12 selects tile bank 0/1 for CPU writes.
- The renderer uses the full 13-bit tile address.
- Sprite/OAM windows stay unchanged (the sprite window is 4 KiB).
- A 256-tile art pack is written in two 128-tile passes.

### 4.4 Tests

Added or updated coverage:

- Renderer parity for tiles 0–127, new tiles 128–255 and text glyphs.
- Cell format: tile 127/128/255, text styles and the reserved art high bits.
- CPU page write: low and high 4 KiB windows map to tiles 0–127/128–255.
- Flappy page copy, Pac-Man frames, Frogger, Pole cells, scroll margins.
- `npm run sim:dvi:tile` now drives clean text cells and clean art cells.

### 4.5 Verification

- `npm test`: **992 pass, 0 fail**.
- `npm run sim:dvi:tile`: all CPU tile-console checks passed.
- `npm run lint:rtl` and `npm run lint:board`: clean.
- `npm run synth:tile`: **BSRAM 23/26 SDPB**, CLS **4,316 / 4,320 (99.9 %)**,
  logic **8,584 / 8,640 (99.4 %)**, registers **2,818 / 6,771**, timing clean.
  The 23 blocks are tilemap 5, tilefont 8, sprite 4, line buffers 2,
  scene/OAM-palette 1, PSRAM data 2 and PSRAM tags 1; the I2S FIFO is in
  SSRAM (RAM16 210).
- 4 KB PSRAM cache: 500k-instruction post-boot window went from 5.092 CPI /
  94.24 % hit to 4.616 CPI / 97.34 %, i.e. **10.3 % fewer cycles**.
- Slice image: **57 slices**, `pole` and `polebench` absent; the boot image
  contains no `pole` name and the menu has no R binding.

## 5. Phase 4 — optional I2S and board

- Move the 128 x 16 I2S FIFO to SSRAM/registers: frees one of the two
  remaining blocks (22 -> 21 before tilefont, 25/26 after).
- Synth and board-verify: 256-tile art, page bit, Flappy bird copy, Pac-Man
  down V flip, Frogger, menu text.
- Record the final BSRAM/CLS/timing in `MEMMAP.md` and `TILE256.md`.

## 6. File checklist

| Area | Files |
|---|---|
| Sprite RTL | `rtl/dvi/dvi_tile.sv`, `rtl/deep16_top.sv`, `js/deep16_simulator.js` |
| Sprite art | `scripts/make_bird_sprite.mjs`, `scripts/make_showcase.mjs`, `asm/showcase/flappy_game.asm`, `asm/showcase/flappy_defs.asm` |
| Pac-Man | `scripts/make_pacman_art.mjs`, `asm/showcase/pacman_map.asm`, `asm/showcase/pacman_game.asm` |
| Tile bank | `rtl/dvi/dvi_tile.sv`, `scripts/make_tile_font.mjs`, `artifacts/image/tilefont.hex`, cell writers in `asm/showcase/*`, `screens/flash/*.fth` |
| Window | `rtl/deep16_top.sv`, `rtl/deep16_board.sv`, `js/deep16_simulator.js`, `MEMMAP.md` |
| Slices | `scripts/make_slices.mjs`, `screens/flash/*.fth`, game binaries |
| Docs/tests | `TILE256.md`, `TILE256B.md`, `MEMMAP.md`, `HARDWARE.md`, `tests/pacman.test.js`, `tests/showcase-*.test.js`, `tests/pole-*.test.js` |

## 7. Phase 5 — restore the 24-group sprite bank

The 8 KB PSRAM cache experiments are recorded in `rtl/psram/README.md`:
4-word lines were **4.1 % slower**, and 2-word lines were only 1.2 % faster
while taking 26/26 blocks. Neither justified the 16-group sprite cut, so the
bank went back to 24 groups (6,144 words, `0xF4000..0xF57FF`).

The first attempt made one 6,144-word array and failed synthesis at
**8,676 logic / 8,640** with the I2S FIFO in BSRAM, and 8,761 with it in SSRAM.
The cause was not the extra address bit: a depth that is not a power of two
makes the tool widen the BSRAM read mux, costing over 300 cells.

Splitting the bank into two power-of-two arrays fixes it:

- `sprite_lo[0:4095]` = groups 0..15 (4 SDPB)
- `sprite_hi[0:2047]` = groups 16..23 (2 SDPB)
- one 2:1 output mux, selected by `laddr[12]` (= group bit 4)
- `birdsprite_lo.hex` / `birdsprite_hi.hex` are written by
  `scripts/make_bird_sprite.mjs`; the full `birdsprite.hex` is still emitted
  for tooling and archives

The sprite word address needs no adder at all: the group, row and column
fields occupy disjoint bits, so
`laddr = {group, row[4:3], lw[2:1], row[2:0], lw[0]}`.

Final build:

| Resource | Result |
|---|---|
| BSRAM | **26 / 26 SDPB** |
| CLS | **4,239 / 4,320** |
| Logic | **8,369 / 8,640** |
| Registers | **2,821 / 6,771** |
| SSRAM | 178 RAM16 |
| Setup violations | 0 |

The 26 blocks are tilemap 5, tilefont 8, sprite 6, line buffers 2,
scene/OAM-palette 1, I2S FIFO 1, PSRAM data 2 and PSRAM tags 1. The I2S FIFO
went back to BSRAM: with the 24-group bank the SSRAM version counts
8,480 logic and 4,320 CLS, then fails placement with 8 LUTs unplaced.

**Hardware (2026-11-25).** The config flash at `0x100000`/`0x200000` was
written with the 76 KB boot image and 57 slices (both read back byte-identical),
and the board booted after a power cycle: LED 0 slow blink (`boot_done`), menu
text, then Flappy. The PS/2 bring-up needed its own fix: the old init sent the
reset during the keyboard's BAT, never saw an ACK, and then skipped the enable,
so some cold boots came up with no keyboard. The new sequence (1.2 s settle,
one reset, 0.8 s BAT guard, 8 x `0xF4`, ACK-independent; see `PS2PLAN.md`)
started the keyboard on **five cold power cycles in a row**. That exercises the 4 KB cache (the kernel runs from PSRAM),
the five-block tilemap and the sprite loader. Groups 16..23 are covered by
`npm run sim:dvi:tile` (group 23 drawn from palette 4) and by the CPU window
test; no shipped game uses them yet, they are there for Pole.

## 8. Acceptance

- Phase 2 synthesis: **22 SDPB**, timing clean.
- Phase 3 synthesis: **23 SDPB** after the tilemap segmentation and 4 KB
  cache, with the I2S FIFO in SSRAM.
- Phase 5 synthesis: **26 SDPB**, 24 sprite groups, I2S FIFO back in BSRAM,
  0 setup violations.
- 256 tiles render, text page unchanged, page bit works, the seven German
glyphs render, Flappy/Pac/Frogger behave. Pole is excluded from the default
  image and slice set as developer-only; its 18 groups would fit the 24-group
  bank but it has not been re-enabled.
- `npm test` green; the RTL tile console covers 256-tile art, text styles and
  the selected sprite pages.
