# TILE256 — BSRAM budget and a plan for 256 tiles

Status: **analysis; route B is implemented.** The bank is 16 sprite groups
and the tile bank is 256 tiles. Phase 2 synthesis reported **22 SDPB**; Phase 3
reports **23 SDPB**, CLS 4,316 / 4,320, logic 8,584 / 8,640, registers 2,818.
Five tilemap blocks freed three; the 4 KB cache spends one, and the I2S FIFO
moved to SSRAM frees another.
The 2,132-word banks were split into five 1Kx16 tilemap arrays, which uses
five blocks instead of eight and leaves three free.
The 24-group numbers below are the historical baseline.
Route B now has an implementation plan: [`TILE256B.md`](TILE256B.md).
Related: `MEMMAP.md` §7.4, `doc/FiT-Graphics-howto.md`, `PS2LAYOUT.md` §9,
`rtl/dvi/dvi_tile.sv`, `rtl/deep16_i2s.sv`, `rtl/psram/deep16_psram_mem.sv`.

## 1. Summary

The pre-segmentation tile bitstream used **26 SDPB blocks (26/26)**; the current
tilemap segmentation brings that to **23 SDPB (23/26)**. The original netlist shows
**~299,648 bits of array data in 425,984 bits of inferred block capacity
(~70 % full)**, but the blocks are stranded by width and depth granularity,
not by total bits.

A 256-tile bank needs **four more tilefont blocks** (128 -> 256 tiles doubles
the 16-bit, 32-word tile bank from 4 to 8 blocks). There is no spare today.

Two routes fit the four-block requirement.

**Route A — transparent, keeps 24 groups.**
1. **Split the tilemap tail** (`2,132 -> 2,048` words in the BSRAM part and
   `84` words per bank in a small SSRAM/register tail). This turns the two
   2,132-word banks into one 4,096-word BSRAM array and frees **4 blocks**.
2. Move the **I2S FIFO** (128 x 16 bits, currently one 16,384-bit block for
   2,048 bits) into SSRAM/flops. This frees **1 block**.
3. Spend the 4 tilefont blocks. The result is **25/26**, leaving one block of
   headroom.

The tilemap tail split preserves the 82 x 26 map and all scroll behaviour. It
costs a 12-bit comparator, a 16-bit read mux and 168 x 16 bits of tail storage,
so CLS and the renderer timing must be measured before committing.

**Route B — simpler BRAM, 16 groups.** Cut the sprite bank to 16 groups:
-4 sprite blocks, +4 tilefont blocks = 26/26; the optional I2S move gives
25/26. No tilemap surgery, no tail comparator, no renderer mux. With Pole
deferred and the menu plain text, the remaining games fit: Flappy copies one
selected bird page, Pac-Man uses three horizontal + three vertical frames plus
H/V flips, and Frogger uses groups 0..6. The cost is per-game sprite-pack
loading, a Flappy page copy in `reset_play`, and a Pac-Man group remap — not a
loss of visible sprites (§6.4.1).

Route B is now the simpler BRAM plan if that software work is acceptable;
Route A is the transparent plan if 24 groups must stay. The fallback if
neither fits is a smaller map (`81 x 25` or `78 x 26`).

## 2. Measurement basis

From `fpga/gowin/impl/pnr/deep16_board_tile_flash.rpt.html` and
`fpga/gowin/impl/gwsynthesis/deep16_board_tile_flash.vg`:

| Resource | Measured |
|---|---|
| BSRAM | `26 SDPB`, 100 % (pre-segmentation) |
| SSRAM (RAM16) | 178 |
| CLS | 4,191 / 4,320 (129 free) |
| Logic | 8,226 / 8,640 (414 free) |
| Registers | 2,814 / 6,771 |

The netlist has 26 named `SDPB` primitives. The 4-bit arrays are
`4,096 x 4` (16,384 bits per inferred block); the 16-bit arrays use
`1,024 x 16` or smaller modes, also 16,384 bits maximum. This is the post-PS/2
baseline: the pROM is gone, but its removal did not reduce the top-level SDPB
count (`PS2LAYOUT.md` §9).

## 3. Current block map

Implemented Route B map (256 tiles, 16 sprite groups):

| Array | Logical size | Bits used | SDPB | Capacity | Util. | Notes |
|---|---|---:|---:|---:|---:|---|
| `tilemap` | 2 banks x 2,132 x 16 | 68,224 | 5 | 81,920 | 83 % | five 1Kx16 segments; read mux registered |
| `tilefont` | 256 x 32 x 16 | 131,072 | 8 | 131,072 | 100 % | 96 ASCII + 7 German glyphs, game art and free slots |
| `sprite` | 16 x 256 x 16 | 65,536 | 4 | 65,536 | 100 % | 16 groups, 4 KiB window |
| `linebuf` | 3 x 1,024 x 8 | 24,576 | 2 | 32,768 | 75 % | triple line buffer |
| `scene_mem` | 1,024 x 16 | 16,384 | 1 | 16,384 | 100 % | OAM + palettes |
| I2S FIFO | 128 x 16 | 2,048 | 0 | — | — | SSRAM (RAM16 total 210) |
| PSRAM cache data | 2,048 x 16 | 32,768 | 2 | 32,768 | 100 % | 1,024 lines x 2 words (4 KB) |
| PSRAM cache tags | 1,024 x 16 | 16,384 | 1 | 16,384 | 100 % | one block, 4 KB cache |
| **Total** | | **354,944** | **23** | **376,832** | **94 %** | 23/26 blocks |

The pre-Route-B 24-group/128-tile baseline was 299,648 bits in 26 SDPB
(70 %). Route B kept 26; the five-segment tilemap then freed three blocks,
and the 4 KB cache spends one: 24/26 with two spare.

The `row_scroll_mem` (32 x 16), `row_scroll_next` (32 x 16), `spw`
(8 x 8), small counters and the palette read register are in flops/SSRAM, not
BSRAM.

## 4. Why the blocks are stranded

The limiting dimension is the **inferred RAM mode**, not the total bit count:

- **4-bit SDPB is 4,096 words deep.** A 2,132-word bank uses only 52 % of its
  four slices. Two banks cannot share one 4,096-deep slice because
  `2 x 2,132 = 4,264`, which is 168 words over.
- **6,144-word sprite bank** is 2,048 words over one 4,096-deep block per
  4-bit slice, so each slice needs two blocks. The data occupies 75 % of the
  resulting capacity.
- **3,072-word line buffer** is under 4,096 words, but the 8-bit array is
  split into 4-bit slices, so two blocks hold 32,768 bits for 24,576 bits of
  data.
- **Small arrays** (`scene_mem`, I2S FIFO) still take a whole block because
  the inferred SDPB is the smallest block primitive available to that
  access pattern. The I2S FIFO is the clearest waste: 2,048 bits in a
  16,384-bit block.

## 5. What 256 tiles requires

### 5.1 Tile bank

`TILE_COUNT = 128` gives `128 x 32 = 4,096` 16-bit words = 65,536 bits = four
SDPB blocks. 256 tiles is `8,192` words = 131,072 bits = **eight blocks**.
That is the whole four-block requirement.

Thirty words per tile would reduce the payload to `256 x 30 = 7,680` words
(122,880 bits), but that is still eight blocks. Packing 4bpp into 8-bit words
does not reduce the bit count. The tilefont is already at its minimum block
count for 256 tiles.

### 5.2 Tilemap cell format

The clean layout keeps the mode bit and splits the remaining 15 bits by mode.
The font restriction makes the 9-bit glyph field safe for text.

Text cell (`bit 15 = 1`):

```
15     mode
14:12  pair 0..7
11:9   style
 8:0   glyph (font uses 0..127; bits 8:7 are 0)
```

Art cell (`bit 15 = 0`):

```
15     mode
14:0   tile address (15 bits; current 256 build uses 7:0)
```

The current board populates only the low 8 bits (7:0), so 256 tiles. The format
reserves bit 8 for 512 tiles and, because the style/pair bits become address
bits in art mode, up to 15 bits (32768 tiles) on a larger BSRAM part.

RTL:

- `fcell = {tile, 5'b0}`; for 256 this is 13 bits, for 512 14 bits, and for
  15-bit art 20 bits.
- Text address = `glyph*8 + 0x20 + page*0x300 + row>>1` for glyphs 0..95; the
  seven German extras at 96..102 use `0x1000 + (glyph-96)*8 + page*0x40`.
- Style = `tm_q[11:9]`; text pair = `tm_q[14:12]`.
- For the current 256-tile build, assert `tm_q[14:8] == 0` for art cells.
- This is a full cell-format break: every text and art writer changes. There
  is no old-cell compatibility; rebuild all slices and game binaries.

### 5.3 CPU window

The CPU tile-bank window is `0xF3000-0xF3FFF` = 4,096 words = 128 tiles. A
256-tile bank needs 8,192 words. Moving the window to 8 KiB would overlap the
sprite bank at `0xF4000`.

Use a **tile-bank page bit** instead: keep the 4 KiB window and add a page
select (control 5 `0xF200A` bit 12 is free) to choose tiles 0-127 or 128-255
for CPU writes. The renderer sees the full 13-bit tile address; only software
writers need to set the page.

This keeps the sprite and OAM windows unchanged. The alternative — moving
the sprite/OAM windows up and making the tile window 8 KiB — is larger and
more disruptive.

### 5.4 Tilefont asset

`scripts/make_tile_font.mjs` now emits 256 tiles (96 ASCII glyphs, seven German
glyphs and 153 art/blank slots); `tilefont.hex` is 8,192 words, and the bitstream asset stamp and `TILE_COUNT`
in `dvi_tile.sv` match. The CPU still writes through a 4 KiB window in two
page-selected passes.

## 6. Freeing four blocks

### 6.1 Recommended — split the tilemap tail (free 4)

Keep the 82 x 26 map and its two banks, but split each bank at 2,048 words:

- `tilemap_main[0:4095]`: two banks x 2,048 words, 16-bit = 65,536 bits =
  **4 SDPB**.
- `tilemap_tail[0:167]`: two banks x 84 words, 16-bit = 2,688 bits. Keep
  this in SSRAM (`RAM16`) or in registers; it must not become a fifth/fifth
  and sixth SDPB.

Addressing:

```
bank_base = bank * 2132
idx       = cell index 0..2131
if idx < 2048: main[bank*2048 + idx]
else:         tail[bank*84 + idx - 2048]
```

The read path needs a 12-bit compare and a 16-bit mux after the registered
RAM output. The write path uses the same compare for the write enable. The
82 x 26 map, margin rows/columns, console ring and scroll code are unchanged.

Cost/risk:

- Tail storage: 168 x 16 = 2,688 bits. At 16 x 4 RAM16 granularity that is
  42 primitives; SSRAM 178 -> 220. Confirm the part's total SSRAM budget
  before relying on this and the I2S move together.
- CLS: comparator + mux + write decode. Current headroom is 129 CLS; measure
  before committing. If the tail is inferred as SDPB, force it to registers or
  SSRAM.
- Timing: the renderer read path gains a mux; `dvi_render` is already the
  tight clock. Measure the post-implementation Fmax.

### 6.2 Recommended — move the I2S FIFO (free 1)

`rtl/deep16_i2s.sv` has a 128 x 16 FIFO with one write port and one registered
read port. It currently takes one SDPB for 2,048 bits. Move it to a
`RAM16`/distributed array (32 primitives) or a register array with a write
case. It runs in the CPU clock, so no CDC is added.

This is the cheapest block in the design and should be done first. It also
gives a spare block if the tilemap tail split needs one more.

### 6.3 Fallback — reduce tilemap geometry (free 4)

If the tail split does not fit, the two banks must total <= 4,096 words:

| Map | Words per bank | Two banks | Visible cost |
|---|---:|---:|---|
| 82 x 26 (current) | 2,132 | 4,264 | none |
| 81 x 25 | 2,025 | 4,050 | one margin column/row |
| 80 x 25 | 2,000 | 4,000 | no horizontal margin |
| 78 x 26 | 2,028 | 4,056 | two visible columns lost |
| 82 x 24 | 1,968 | 3,936 | two visible rows lost |

`81 x 25` is the least visible loss but must be tested against the 0..15
pixel scroll range and the 26-row console ring. The current code uses all 26
rows for the terminal ring, so `25` rows needs a console-ring adjustment.
`78 x 26` keeps all 26 rows but loses two 8-pixel columns.

### 6.4 Sprite options

- **24 -> 16 groups**: 4,096 words -> four blocks, freeing **4** immediately.
  This is the only sprite cut that actually saves blocks: 17 or more groups
  still needs 6,144 words and eight blocks; 16 groups fits one 4,096-deep
  4-bit slice per block, so exactly four blocks. It is only acceptable if
  every game carries its own pack and no scene needs more than 16 groups at
  once. The current games do not meet that today (see §6.4.1).
- **Split the 16-bit sprite array into two 8-bit arrays**: this may let the
  tool use 2,048 x 8 modes (six blocks) and free **2**. It is not guaranteed:
  the current inference splits 16-bit arrays into 4-bit blocks, so a prototype
  synthesis is required. Do not count on this saving until measured.
- **6,144 -> 4,096 words** (16 groups) is the same as the group reduction.

#### 6.4.1 What 16 groups costs with the current games

Sixteen groups are enough for eight visible sprites and, with the facts below,
for every current game once the sprite packs are organised per game. Pole is
deferred and the menu is plain text, so neither constrains the group count.

**Flappy: on-demand one bird page.** There is no hardware blocker. Flappy's
slice already carries the three bird pages at `FLAPPY_SPR_PACK` (0x2000,
6,144 words) and copies all 24 groups into the bank on entry. Only one bird is
visible at a time, so:

- keep the three source pages in the slice/PSRAM;
- after `reset_play` picks the colour, copy that colour's 2,048-word page
  (`FLAPPY_SPR_PACK + colour * 2048`) into groups 0..7;
- set `G_BIRD_GROUP = 0`; the existing relative groups 2 (cloud) and 3..7
  (bird/dizzy) then address the loaded page;
- `FLAPPY_SPR_WORDS` becomes 2,048 for the copy (the source pack stays 6,144
  words until the slice is compacted).

The three birds are different source images, not palette swaps, so this is a
copy, not a palette trick. The copy is 2,048 words, cheaper than today's
6,144-word entry copy. The only work is moving the copy to after the colour
pick (or copying again in `reset_play`) and changing the group base.

**Pac-Man: five or six base frames plus flips.** The expected set is three
horizontal frames (open/half/closed) and three vertical frames
(open/half/closed), with left = H flip and down = V flip. If the closed circle
is shared, that is five base frames; keeping a separate closed frame per axis
makes six. The current game instead has separate right, up and down art in
groups 0/1/8/9/16/17 plus a shared closed group 10. The renderer already
supports both OAM flips (H = 0x2000, V = 0x4000 in OAM word 0), so the pack can
be reduced to:

| Group | Frame |
|---:|---|
| 0 | horizontal open (right) |
| 1 | horizontal half (right) |
| 2 | closed (shared; symmetric) |
| 3 | vertical open (up) |
| 4 | vertical half (up) |

Left is the horizontal frame with H flip; down is the vertical frame with V
flip. `pac_sp_write` becomes: choose base 0 for right/left/stopped, base 3 for
up/down; choose phase 0/1/2; set H for left and V for down. The separate down
frames 16/17 and the up groups 8/9 disappear.

The four ghosts need four groups. A 16-group map can be:

```
0..4   Pac-Man (open/half/closed horizontal, open/half vertical)
5..8   four ghost colours
9..15  free / future
```

Pac-Man already loads its frames and ghosts at entry, so it can overwrite
Flappy's page and Flappy can reload on its next start; no save/restore table is
needed if every game owns its pack. The hardcoded ghost groups 18/5/13/21 and
the `pac_saved_groups` list are removed or rewritten to 5..8.

**Frogger** uses groups 0..6 and already installs its own pack; it fits.

**Pole** is deferred. **The menu is plain text**, so the baked three-page bird
bank is not needed for the menu; `birdsprite.hex` can become one page or be
removed from the menu path entirely.

The resulting group use is comfortably below 16: Pac-Man 9 (5 + 4 ghosts),
Flappy 8, Frogger 7. The limit is now a pack-loading convention, not a
capacity problem.

If 16 groups is chosen, the BSRAM plan simplifies substantially:

| Change | SDPB delta | Total |
|---|---:|---:|
| Current | - | 26 |
| Sprite 24 -> 16 groups | -4 | 22 |
| Tilefont 128 -> 256 | +4 | 26 |
| **Without I2S move** | | **26 / 26** |
| I2S FIFO to SSRAM/regs | -1 | **25 / 26** |

The tilemap tail split becomes unnecessary. The 82 x 26 map, its 52 %
utilisation and its scroll code stay exactly as they are. The 256-tile
cell-format and tile-bank page work in §5 is unchanged.

Implementation points for this variant:

- `SPR_GROUPS = 16`, `SPR_WORDS = 4,096`, `loam_group_ok < 16`.
- Sprite CPU window becomes `0xF4000-0xF4FFF` (4 KiB); the old 6 KiB window
  shrinks. Update `MEMMAP.md` and the dvi tile test.
- Flappy: copy one selected 2,048-word page into groups 0..7; `G_BIRD_GROUP=0`;
  keep the 6,144-word source pack in the slice for now.
- Pac-Man: 5-6 base frames + H/V flips, ghosts at 5..8; remove the separate
  down/up groups and the saved-group table.
- `birdsprite.hex` becomes one page (or 4,096 words if a 16-group default bank
  is kept); the menu does not need it.
- Old 24-group packs are incompatible; rebuild all slices.

## 7. Budget after the recommendation

| Change | SDPB delta | Total |
|---|---:|---:|
| Current | — | 26 |
| Tilefont 128 -> 256 | +4 | 30 |
| Tilemap tail split | -4 | 26 |
| I2S FIFO to SSRAM/regs | -1 | 25 |
| **Final** | | **25 / 26** |

One block remains free for future artwork or a later sprite change. If the
tail split is not accepted, the same budget can be reached with a smaller map
(`81 x 25`). If the 16-group sprite cut is chosen instead (§6.4.1), skip the
tilemap tail split entirely: the tilefont (+4) and sprite cut (-4) balance at
26/26, and the optional I2S move gives 25/26. This variant keeps the tilemap
and all scroll behaviour untouched, but requires per-game sprite packs and the
Pac-Man five/six-frame remap; Pole is deferred and the menu is plain text.

## 8. Implementation order

1. **Measure the candidates first.** On a branch, implement the tilemap tail
   split and the I2S FIFO move without the 256-tile cell change. Run
   `npm run synth:tile`; require `24 SDPB` (or `25 SDPB` with one of them
   still in BSRAM), no new SDPB from the tail, and no CLS/timing regression
   that breaks the 4,320/20.2 MHz budget.
2. **Parameterize the tile bank.** `TILE_COUNT = 256`, `TILE_WORDS = 8,192`,
   `TILE_AW = 13`, `tilefont.hex` 8,192 words, asset stamp updated.
3. **Change the cell format.** Keep the 7-bit field at 11:5, use bit 4 as art
   tile bit 7, widen `fcell` to 13 bits; text cells stay unchanged.
4. **Add the CPU page bit.** Control 5 bit 12 selects tile bank 0/1 for the
   4 KiB write window; renderer uses the full 13-bit address.
5. **Rebuild slices.** Old 7-bit-cell games and Forth art packs are
   incompatible. Bump the slice/format version or regenerate all game
   binaries and the catalog.
6. **Verify.** Renderer parity for tiles 0-127, new tiles 128-255, text
   glyphs, scroll margins, menu/games, `npm test`, `npm run sim:dvi:tile`,
   then board.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Tilemap tail split adds too much CLS (129 free) | Prototype first; fallback to `81 x 25` or `78 x 26` |
| Tail storage inferred as a new SDPB | Force registers/SSRAM; synth-gate `SDPB <= 25` before the tilefont change |
| Renderer timing fails at 24.75 MHz / DVI clock | Measure after the mux; keep the tail in a registered SSRAM with the same latency |
| SSRAM capacity (tail + I2S) | 42 + 32 RAM16 primitives over 178; verify the part's SSRAM total before relying on both |
| Old slices write 7-bit cells | Bump the format, regenerate all game binaries and Forth packs |
| CPU writes only 128 tiles at a time | Page bit documented; menu/game loader writes both pages for a 256-tile pack |
| Tile index >127 breaks text/page arithmetic | Add a focused renderer test for tile 128, 255 and text glyph 95 |
| `tilefont.hex` doubles, bitstream/asset stamp | Regenerate and verify in `build_gowin_tile_flash.sh` / `flash_gowin_tile_flash.sh` |

## 10. Acceptance

Route B was chosen and met the 256-tile gate. The implemented build now uses
**23 SDPB**, CLS 4,316 / 4,320, with three blocks free. The I2S FIFO is in SSRAM
(210 RAM16). The seven German glyphs are
appended at slots 96..102 and render from the free upper half; the PSRAM cache
is now 4 KB (1,024 lines x 2 words). The route A numbers below remain as the
alternative.

- Synthesis before the tilefont change: tilemap tail split + I2S move gives
  `24 SDPB` (or a documented `25 SDPB`), no new tail SDPB, CLS within budget,
  timing clean.
- 256-tile build: `23 SDPB`, 8,192-word tilefont, tiles 0-255 render, text
  pages unchanged, 4 KB PSRAM cache, I2S FIFO in SSRAM.
- `81 x 25`/`78 x 26` fallback is only used if the tail split fails; record
  which was chosen and why.
- All slices using the new cell format are rebuilt; old-game loading fails
  cleanly or is versioned out.
