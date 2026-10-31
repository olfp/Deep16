# FiT graphics — a how-to

**FiT** (*Frogger inspired tile-based*) is the D16nano graphics layer: a
640x360 tile console with 8x15 character cells, 4bpp art tiles, eight
selectable text colour pairs, three font styles, hardware scrolling and eight
32x32 sprites. The same frame is sent to the HDMI connector as 1280x720p60,
each source pixel shown as a 2x2 block.

FiT lives in `rtl/dvi/dvi_tile.sv` and is used by the **D16nano tile build**
(`D16NANO`, `DVI_TILE`, `deep16_board_tile`). The older `dvi_text` build is a
plain black-and-white terminal and has no tile bank, palette or sprite layer.
The Flappy showcase (`asm/showcase/flappy_game.asm`) is the reference
implementation for everything described here.

This document starts with the memory map and the tile pipeline, then covers
art tiles, text styles, global scrolling, per-row scrolling and finally
sprites.

---

## 1. The memory map in one page

The CPU sees the tile engine as word-addressed windows. A write goes to the
tile engine and to the PSRAM/Forth mirror at the same address.

| Address | What |
|---|---|
| `0xF1000`–`0xF1853` | tilemap, 82x26 16-bit cells; one of two banks selected by control 4 |
| `0xF2000` | control 0: cursor `{row[4:0], col[6:0], enable}` |
| `0xF2002` | control 1: row offset; the terminal uses 0..25 as a 26-row ring |
| `0xF2004` | control 2: smooth `scroll_x` 0..15, latched with the display bank |
| `0xF2006` | control 3: smooth `scroll_y` 0..30 |
| `0xF2008` | control 4: b0 write bank, b1 display bank |
| `0xF200A` | control 5: sprite **write** page 0..2 (3 clamps to 0) |
| `0xF200C` | control 6: per-row fine scroll `{en, row[4:0], fine[2:0]}` |
| `0xF200E` | control 7: raster line compare 0..359 |
| `0xF3000`–`0xF3BFF` | tile bank, 96 CPU-writable tiles x 32 words |
| `0xF4000`–`0xF47FF` | sprite bank, 8 groups x 16 patterns x 16 words (one write page) |
| `0xF5000`–`0xF500F` | OAM, eight sprites x two words |
| `0xF5080`–`0xF508F` | text palette, eight paper/ink pairs |
| `0xF5090`–`0xF509F` | art palette, 16 RGB332 entries |
| `0xF50A0`–`0xF50AF` | sprite palette, 16 RGB332 entries |

The board has a 16-entry FIFO between the CPU and the pixel clock. Tile
writes are asynchronous: a write lands in the pixel domain within a few clocks
and affects any line composed after it. Use the frame flag at `0xF0066` (b1
toggles once per frame, b0 is vblank) to pace animation instead of assuming a
write is already visible.

The **visible area** is 80x24 cells, 640x360 pixels. The tilemap is 82x26,
with two margin columns and two margin rows. The terminal shows rows 0–23 and
columns 0–79; a four-direction game normally centres its window at columns
1–80 and rows 1–24, leaving column 0/81 and row 0/25 as the scroll margins.
All 128 tile slots can be on screen at once because the map has 1,920 visible
cells; the eight sprites add eight more distinct graphics, so the engine can
show **136 distinct graphics** in one frame.

---

## 2. Tile graphics basics

### 2.1 The pipeline

The renderer builds one scanline ahead:

```
tilemap cell -> tile bank fetch -> palette lookup -> line buffer -> DVI scan
```

While line N is scanned out, line N+1 is composed from the tilemap and the
tile bank into the other line buffer. The scan side is a plain 640-byte read,
so a palette lookup can never stall the pixel clock.

A cell is 8x15 pixels. The tilemap stores only tile addresses, never pixel
data; the same tile can appear in any number of cells.

### 2.2 The cell word

Every tilemap word is 16 bits:

| Bits | Field |
|---|---|
| 15 | mode: 0 = art tile, 1 = text pair |
| 14:12 | text pair 0..7 (mode 1 only) |
| 11:5 | tile address / glyph index, 32-word aligned |
| 4:0 | zero for art; text style in bits 2:0, bits 4:3 reserved |

For an art cell bits 11:0 are the tile's word address in the tile bank (the
low five bits are always zero). For a text cell bits 11:5 are the glyph index
and bits 2:0 are style (see §4); bits 4:3 are reserved and ignored. The fill
masks bits 4:0 out of the fetch.

Write a cell in the selected write bank at:

```
address = 0xF1000 + row * 82 + col
```

`row` is 0..25 and `col` is 0..81. The terminal's visible cells are rows 0–23
and columns 0–79. Columns 80–81 and rows 24–25 are the scroll margins; a
four-direction game centres its window on columns 1–80 and rows 1–24 (see
§5.2).

### 2.3 The tile bank

The tile bank holds 128 tiles of 32 words:

| Range | Contents |
|---|---|
| `0x000` | tile 0: a blank 32-word art tile |
| `0x020`–`0x31F` | regular 1bpp text page: 96 glyphs x 8 words |
| `0x320`–`0x61F` | italic 1bpp text page: 96 glyphs x 8 words |
| `0x620`–`0xBFF` | 47 free 32-word slots for game art |
| `0xC00`–`0xFFF` | 32 baked 4bpp art tiles (14 used by the showcase) |

The CPU window `0xF3000`–`0xF3BFF` covers the first 96 tiles (words 0–3071).
Tiles 96–127 at `0xC00` are baked into the bitstream by
`scripts/make_tile_font.mjs`; the CPU cannot rewrite them at runtime.

### 2.4 Art tile format

A mode-0 tile is 30 words of pixels plus two reserved words:

```
word 2r+0   pixels 0..3 of row r, pixel 0 in bits 3:0
word 2r+1   pixels 4..7 of row r, pixel 4 in bits 3:0
word 30     reserved (the build writes a palette pointer, currently 0)
word 31     reserved (the build writes flags, currently 0)
```

`r` is 0..14. Each pixel is a 4-bit index into the **art palette bank**
(`0xF5090`–`0xF509F`). Index 0 is a normal colour for art tiles, not a
transparent key: art tiles are opaque. The current renderer reads only words
0–29; flipping and priority are sprite features, not tile features.

To fill one tile at runtime, use a CPU-writable slot (`0..95`) and write its
base plus `2*r` and `2*r+1`. For example, tile 49 is the first free gap slot:

```asm
; art tile 49 (base 0x620), row 3
; word = 0x620 + 3*2 = 0x626
; four pixels p0..p3: value = p0 | p1<<4 | p2<<8 | p3<<12
```

Tiles 96–127 are the baked art slots and cannot be written through the CPU
window; use them read-only, or bake new art at build time.

### 2.5 Text tile format

A text glyph is 1bpp: one bit per pixel, two glyph rows per 16-bit word, MSB
leftmost. Glyph 0x20 is index 0 and glyph 0x7F is index 95.

```
regular page word = 0x020 + index * 8 + (row >> 1)
italic  page word = 0x320 + index * 8 + (row >> 1)
```

Row 0 uses the low byte of the word, row 1 the high byte, and so on. The
renderer selects paper or ink with the cell's pair, so one glyph image can be
drawn in eight colours without another copy.

### 2.6 Palettes

All three banks hold 16 **RGB332** entries (`RRRGGGBB`):

| Bank | Window | Used by |
|---|---|---|
| text | `0xF5080`–`0xF508F` | text cells: entry `2p` paper, `2p+1` ink |
| art | `0xF5090`–`0xF509F` | mode-0 tiles, index `pix[3:0]` |
| sprite | `0xF50A0`–`0xF50AF` | every sprite, index 0 transparent |

Power-up colours come from `tilepal3.hex`, which copies the same 16 entries
into all three banks. Palette writes are not frame-latched, so change them
during vblank or at a screen transition.

### 2.7 Drawing a cell

Put the letter `A` (0x41) in pair 3:

```
index = 0x41 - 0x20 = 0x21
tile  = index * 32  = 0x420
cell  = 0x8000 | (3 << 12) | 0x420 = 0xB420
```

Put the baked art tile 96 (base `0xC00`, one of the showcase pipes) in the
same place:

```
cell = 0x0C00
```

An art cell needs no mode bit; bit 15 stays zero. A text cell must set bit 15,
or the renderer treats the glyph address as a 4bpp art tile.

---

## 3. Art tiles vs. text tiles

| | Art tile (mode 0) | Text tile (mode 1) |
|---|---|---|
| Cell bit 15 | 0 | 1 |
| Storage | 30 words of 4bpp pixels | 8 words of 1bpp per glyph |
| Colour | 16 entries from the art bank | two entries from the text bank, eight pairs |
| Capacity | 128 tile slots, 80 without giving up text | 96 glyphs per page, regular + italic |
| Transparency | none; index 0 is a colour | paper/ink only |
| Styles | H/V flip and priority not implemented | italic, underline, bold |
| Best for | backgrounds, pipes, cars, logs, tiles | HUD, menus, console, labels |

### 3.1 How much art fits

With the text pages left alone there are **80 art-capable slots**: tile 0
(blank), the 47 free slots in the gap, and the 32 baked art slots. Fourteen of
the baked slots are used by the showcase, leaving **65 free art tiles** (47
gap + 18 baked) without touching text or the blank tile. Tile 0 itself is one
more if a program does not need a blank tile.

If a game gives up the console font it can use the 96 CPU-writable slots for
its own art, and the 32 baked slots are still there. That gives the full 128
tile slots, but tiles 96–127 have to be baked into the bitstream.

Text costs 48 slots: 24 for the regular page and 24 for the italic page. A
game that only needs uppercase and digits can build a smaller page, but the
current build always writes all 96 glyphs.

### 3.2 Choosing

* Use **art tiles** for anything with more than two colours, for opaque
  backgrounds, and for tiles that should look the same in every cell.
* Use **text tiles** for the console, HUD and menus: they are cheap, can be
  recoloured per cell, and need no tile-bank writes.
* Do not put a 4bpp art address in a text cell. The fill will read the 1bpp
  page at `0x020 + index*8` and show unrelated glyph rows.
* Do not put a text address in an art cell. The fill will read 30 words of
  4bpp data and show noise.

---

## 4. Text styles

### 4.1 Pair colours

A mode-1 cell selects one of eight paper/ink pairs:

```
cell = 0x8000 | (pair << 12) | style | ((ch - 0x20) * 32)
```

Pair `p` uses text-bank entries `2p` (paper) and `2p+1` (ink). Pair 0 is the
ordinary console colour. The eight pairs share the 16-entry text bank, so a
mixed screen should budget them deliberately; the art and sprite banks are
separate and unaffected.

```text
0x1C 0xFC 3 pal!        \ pair 3: green paper, yellow ink
3 attr                  \ the rest of the console uses pair 3
```

`pal!` writes `0xF5080 + 2p` and `0xF5080 + 2p + 1`. The art and sprite
equivalents are `art-pal!` (`0xF5090`) and `sprite-pal!` (`0xF50A0`).

### 4.2 The style bits

The low three bits of a text cell are style; bits 4:3 are reserved and zero:

| Bit | Style |
|---|---|
| 2 | underline |
| 1 | bold |
| 0 | italic font page |

They are ORed into the 32-word-aligned glyph address, so they do not move the
tile fetch. Console writes that already OR `text_attr` (which contains
`0x8000 | pair<<12`) keep working: with style zero the cell is plain text. A
program that writes only `(ch - 0x20) * 32` without bit 15 writes an art cell,
not a text cell.

* **Italic** selects the second 1bpp page at `0x320`. It is a designed ttyp0
  italic page, not a runtime shear, so it costs no extra logic per pixel.
* **Underline** forces row 14 of the cell to ink. It is generated in the
  renderer, not stored in the glyph.
* **Bold** smears ink one pixel to the right: if the previous pixel was ink,
  the current pixel becomes ink. The smear is reset at the cell boundary, so
  it never bleeds into the next character.

The styles combine: `7` is italic + bold + underline.

### 4.3 Console state and Forth words

In the D16D board kernel the console keeps its current pair and style in the
kernel cell `0x3BEE` (`text_attr`). The catalog exposes them:

| Word | Effect |
|---|---|
| `pal! ( bg ink pair -- )` | write a text-bank pair |
| `art-pal! ( bg ink pair -- )` | write an art-bank pair |
| `sprite-pal! ( bg ink pair -- )` | write a sprite-bank pair |
| `attr ( pair -- )` | select the console pair, keep the style |
| `style ( flags -- )` | set the style bits, keep the pair |
| `attr! ( pair flags -- )` | set pair and style together |
| `attr@ ( -- pair )` | read the current pair |
| `style@ ( -- flags )` | read the current style bits |

```text
0x1C 0xFC 3 pal!        \ green on yellow for pair 3
3 attr                  \ select pair 3
4 style                 \ underline
7 style                 \ italic + bold + underline
```

`style` and `attr` compose the next cell as
`0x8000 | pair<<12 | style | glyph`. A program that writes the tilemap itself
must do the same; writing only `glyph` produces a plain pair-0 cell.

---

## 5. Scrolling

There are two independent mechanisms: the terminal's circular row offset and
the game's smooth `scroll_x`/`scroll_y`. They can be combined, but most games
use one or the other.

### 5.1 Terminal row offset (control 1)

`0xF2002` holds a five-bit row offset. The terminal uses 0..25 as a 26-row
ring: the renderer maps visible row `r` to map row `(r + row_off) % 26`, so a
line feed at the bottom of the screen only increments `row_off`; no row is
copied (the new bottom row is cleared). The visible window is still 24 rows;
rows 24–25 are the two margin rows the ring rotates through.

### 5.2 Smooth global scroll (controls 2 and 3)

`scroll_x` (`0xF2004`) is a 4-bit pixel offset 0..15. The renderer splits it
into:

```
coarse column = scroll_x >> 3   ; 0 or 1
fine phase    = scroll_x[2:0]  ; 0..7
```

The coarse bit chooses the starting map column and the fine phase skips that
many pixels inside the first cell. Increasing `scroll_x` moves the picture
left. The range is 0..15 pixels: two possible starting columns plus a fine
phase. Flappy uses the whole range as a leftward scroll; a four-direction
game uses 8 as the centre, so 0..7 shifts the picture right and 8..15 shifts
it left.

`scroll_y` (`0xF2006`) is a 5-bit pixel offset 0..30. It shifts the glyph row
inside the 15-line cell and carries into the next map row, so it scrolls the
whole picture vertically by up to two cell rows. Increasing `scroll_y` moves
the picture up.

The fill wraps at 26 rows (`TILE_ROWS`), so `scroll_y` uses the whole map:
with 15 as the centre, the visible window is rows 1–24; 0 moves it to rows
0–23 and 30 to rows 2–25. The two margin rows are real.

For free four-direction movement:

* centre the window at columns **1–80** and rows **1–24**;
* use `scroll_x = 8` and `scroll_y = 15` as the neutral position;
* when `scroll_x` reaches 0 or 15, shift the whole map one column, write the
  new margin column and reset to 8 (2,132 tile writes);
* when `scroll_y` reaches 0 or 30, shift the whole map one row, write the new
  margin row and reset to 15 (2,132 tile writes).

The shift puts the new cell in a margin that is hidden after the reset, so it
can be written during vblank without tearing. At 1 pixel/frame this is about
24k writes/s; at several pixels/frame it approaches 100k writes/s. `scroll_x`
is latched with the display bank;
`scroll_y` is not, so write it in vblank. The per-row table remains for
Frogger-style lanes; a free-camera game leaves it disabled and uses the global
scroll.

Both registers are pixel offsets, not cell offsets. A game that moves one
pixel per frame writes `scroll_x` or `scroll_y` every frame; the map itself
does not move.

### 5.3 Double-buffered maps (control 4)

The tilemap has two banks. `0xF2008` selects them:

| Bit | Field |
|---|---|
| 0 | write bank |
| 1 | display bank |

The CPU always writes the selected write bank. Draw the next frame into the
back bank, then set the display bit and the matching `scroll_x` together. The
display bank and `scroll_x` are latched at the render frame boundary, so the
new map and its pixel offset become visible on the same frame. This is how the
Flappy wrap avoids a one-frame tear between the map and the scroll.

`scroll_y` is not part of that latch; write it during vblank or at the same
frame boundary.

### 5.4 Timing

* `0xF0066` b1 toggles once per frame. Wait for a change before updating OAM,
  the map bank or the scroll registers.
* `scroll_x` and the display bank take effect at the frame boundary.
* `scroll_y` and the palette banks apply as written.
* A tile write goes through the board's 16-entry FIFO and affects lines
  composed after it. Bursts are fine at normal CPU speed; do not assume a
  write is visible in the same scanline.

---

## 6. Per-row scrolling (control 6)

The global `scroll_x` moves every row together. Some games need each row to
have its own phase — Frogger lanes, parallax backgrounds, raster splits. The
engine provides one 3-bit fine phase per map row.

### 6.1 The register

Write control 6 at `0xF200C`:

```
bits 8    enable
bits 7:3  map row 0..25
bits 2:0  fine phase 0..7
```

The CPU writes one entry at a time into the **next** table. At the frame
boundary the engine copies all 26 entries into the **live** table, so a
mid-frame write never changes the current frame and the table never tears.
`en = 0` restores the global single-scroll behaviour.

In the fill path the row's fine phase replaces `scroll_x[2:0]`:

```systemverilog
fpix <= row_scroll_en ? row_scroll[map_row] : scroll_x[2:0];
fcol <= scroll_x >> 3;
```

The coarse column is still `scroll_x >> 3`. For pure per-row scrolling set
`scroll_x = 0`; use the coarse bit only when the whole screen also needs a
one-cell offset.

The table is indexed by the **map row being composed**, before the terminal
`row_off` is applied. If a program uses `row_off`, the phase follows the
logical row, not the physical row in the bank.

### 6.2 The lane model

A row is a ring of 80 visible cells plus the two margin cells. The phase is
the only per-lane animation state:

```
lane row:  [water][water][=== log ===][water][== log ==] ...
           <-- phase 0..7 ---------------------------------
```

Moving the row one pixel moves every object in it by one pixel. When the
phase wraps, rewrite the row's cells to shift the ring by one cell:

* content moving **left**: increase the phase 0 -> 7, then shift the cells
  left and reset the phase to 0;
* content moving **right**: decrease the phase 7 -> 0, then shift the cells
  right and reset the phase to 7.

Opposite directions are simply opposite phase counters. The model assumes
**one speed and one direction per lane**; two objects moving opposite ways in
the same row need sprites or a second layer.

### 6.3 Forth words

The catalog provides:

```text
: row-scroll! ( fine row -- ) swap 3 lshift or 0x100 or 0x200C es! ;
: row-scroll-off ( -- )       0 0x200C es! ;
```

`5 12 row-scroll!` gives map row 12 a fine phase of 5. Call
`row-scroll-off` to return to global scrolling. The table is latched, so the
new phases appear on the next frame.

### 6.4 Raster IRQ (control 7)

`0xF200E` holds a source line 0..359. The engine toggles a signal at the end
of that line; the board synchronises it into one CPU-clock pulse on SIC bit 3.
Values 360..374 fall in the vertical blanking; a line at or beyond the vertical
total never fires.

The raster IRQ is a timing tool, not a per-scanline scroll register: the
per-row table is latched once per frame. Use the IRQ for effects that can
change at a known line — palette updates, a status split, or starting the
next frame's work early — and use the per-row table for the scroll itself.

---

## 7. Sprites

The sprite layer sits on top of the tilemap: **eight 32x32 sprites, 4 bits per
pixel**, composited into the same 640x360 frame. Each sprite has its own x/y,
a pattern group, an enable bit and hardware H/V flip; the whole layer shares
one 16-entry RGB332 sprite palette, separate from the text and art banks.

The Flappy showcase is the reference implementation: a bird, four parallax
clouds and animated wing/dizzy poses.

### 7.1 The windows

All sprite memory is word-addressed, written by the CPU like ordinary RAM.

| Address | Words | What |
|---|---|---|
| `0xF4000`–`0xF47FF` | 2,048 | sprite pattern bank, **one page** (8 groups) |
| `0xF5000`–`0xF500F` | 16 | OAM, two words per sprite |
| `0xF5080`–`0xF508F` | 16 | text palette bank: eight paper/ink pairs |
| `0xF5090`–`0xF509F` | 16 | art palette bank (mode-0 tiles) |
| `0xF50A0`–`0xF50AF` | 16 | sprite palette bank, RGB332 |
| `0xF200A` | 1 | control 5: sprite **write** page, bits 1:0 |

The bank at `0xF4000` is a **write** window, not the whole memory: the
hardware holds 24 groups (3 pages of 8) and control 5 selects which page the
CPU writes. The renderer uses the absolute OAM group 0..23, so the write page
never constrains what is on screen. Page 3 is not a page and clamps to 0. OAM
is a register file and the palette banks are writable RAM; both can be updated
at any time.

### 7.2 OAM: where a sprite is and what it shows

Two words per sprite, sprite 0 first:

| Word | Bits | Field |
|---|---|---|
| `w0` | 15 | behind (draw only over background pixel 0) |
| | 14 | V flip |
| | 13 | H flip |
| | 12 | free |
| | 11 | enable |
| | 10 | negative x |
| | 9:0 | x, left edge |
| `w1` | 15:11 | group, absolute 0–23 (24–31 disables the sprite) |
| | 10 | free |
| | 9:0 | y, top edge |

* The visible frame is **640x360** source pixels (shown 2x2 on 1280x720).
  `x` and `y` are the top-left corner; a 32x32 sprite clips at the right and
  bottom edges by itself.
* To put a sprite partly off the **left** edge, store `1024 + x` with `x`
  negative and set `w0` bit 10. For example `x = -20` is `1004` plus the sign
  bit.
* **Sprite 0 wins.** The compositor combines slots 7 down to 0 and a lower
  number replaces a higher one, so put the thing that must be in front in
  slot 0 (the bird) and scenery in slots 1–7 (the clouds).
* **behind** only matters against the tilemap: for an art background, a behind
  sprite is hidden where the art pixel index is non-zero, which is how the
  clouds stay behind the pipes and the ground. Clear it to draw over
  everything. The test uses the 4-bit tile pixel index, so it is not a
  reliable paper/ink test over text cells.

### 7.3 The pattern bank and its pages

A 32x32 sprite is 16 8x8 patterns of 16 words each, so one group is 256
words. The bank holds 24 groups, and the OAM group is the flat index:

```
absolute group = OAM w1 bits 15:11     (0..23)
write page     = control 5, bits 1:0   (0..2; page 3 clamps to 0)
```

The write page only selects which 8-group page the CPU window at `0xF4000`
writes; the renderer never adds it to the group. Groups 0,1,8,9,16,17 are
unused in the baked bank. Groups 10 and 18 are duplicates of the page-1 and
page-2 clouds, so they can be repurposed only if those pages do not need the
cloud.

The eight OAM slots can therefore each select any of the 24 groups: **8
visible sprites out of 24 graphics**. More OAM slots would only add more
simultaneous sprites, not a way to reach the extra art.

Pattern addresses inside a group, for `row` and `col` in 0..31:

```
tile  = (row / 8) * 4 + (col / 8)       ; 0..15
word  = group * 256 + tile * 16 + (row % 8) * 2 + (col % 8) / 4
shift = (col % 4) * 4                   ; low nibble is the leftmost pixel
```

`group` is the absolute bank group for baking. For a runtime write through the
`0xF4000` window, set control 5 to `group >> 3` and use `group & 7` in the
formula; the window only exposes one page.

Each word is four pixels. Empty pixels **must be 0** — that is the
transparent key.

There are two ways to get art into the bank:

* **Bake it into the bitstream.** `rtl/dvi/dvi_tile.sv` does
  `$readmemh("birdsprite.hex", sprite)` at power-up, so 24 groups are already
  there. `scripts/make_bird_sprite.mjs` builds that file (and
  `scripts/make_image.mjs` writes it next to the boot image). This is how the
  three bird pages and the shared cloud ship.
* **Write it at runtime.** Set the write page with control 5, then store words
  at `0xF4000 + offset`, where `offset` is relative to that page:
  `offset = (group & 7) * 256 + tile * 16 + ...`. Only the selected page is
  writable, and a write changes the sprite on the next composed line, so treat
  another page as the back buffer if you redraw animated art. The renderer
  still uses the absolute group in OAM.

### 7.4 Palette

Three banks of 16 **RGB332** (`RRRGGGBB`) entries share one 64 x 16 BSRAM:

| Window | Bank | Used by |
|---|---|---|
| `0xF5080`–`0xF508F` | text | pair-mode tile cells, eight `paper`/`ink` pairs |
| `0xF5090`–`0xF509F` | art | mode-0 tile cells (`pix[3:0]`) |
| `0xF50A0`–`0xF50AF` | sprite | every sprite, shared by all eight slots |

Sprite pixels are indices 0–15 into the sprite bank. A mode-1 text cell
`0x8000 | (pair << 12) | tile` reads text entry `2p` when the glyph bit is 0
(paper) and `2p+1` when it is 1 (ink), so one glyph image renders in eight
colours.

* Index 0 is **transparent for sprites**, and the showcase also uses it for
  the sky, so an empty sprite pixel shows the sky.
* Changing an entry changes every pixel of that index in its bank. The
  showcase picks a bird by writing sprite-bank entries 2 (body) and 13 (belly)
  on reset, while all three birds share the same pattern layout and differ
  only in the page.
* Power-up colours come from `tilepal3.hex` (the same 16 entries copied into
  all three banks). Leaving Flappy restores the art and sprite banks to the
  default and leaves the console text bank alone; the BIOS `gfx` handler
  clears OAM, so the console comes back with no sprites.

### 7.5 A sprite in six steps

```asm
.equ SEG_CTRL -0x0E00        ; ES 0xF200 -> window 0xF2000 (control)
.equ SEG_SPR  -0x0C00        ; ES 0xF400 -> window 0xF4000 (sprite bank)
.equ SEG_OAM  -0x0B00        ; ES 0xF500 -> window 0xF5000 (OAM/palette)

; 1. select the CPU write page (0..2); the render group is absolute
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 0x0A
    LSI R3, 0
    STS R3, ES, R2

; 2. (optional) load patterns into 0xF4000 + (group&7)*256 + ...
;    after selecting the group's page; or use the baked art.

; 3. (optional) set sprite palette entry 2 (the body colour)
    LDI SEG_OAM
    MVS ES, R0
    LSI R2, 0xA2             ; 0xF50A0 + 2: sprite bank, entry 2
    LDI 0x84                 ; RGB332
    MOV R3, R0
    STS R3, ES, R2

; 4. w0 = enable | x = 100
    LSI R2, 0
    LDI 100
    MOV R3, R0
    LDI 0x0800
    OR R3, R0
    STS R3, ES, R2

; 5. w1 = group 0 << 11 | y = 60
    LSI R2, 1
    LDI 60
    MOV R3, R0
    STS R3, ES, R2          ; group 0, so no OR needed; group 8 would OR 0x4000

; 6. move it later by rewriting w0 (x) and w1 (y); both words are latched by
;    the line loader, so update them together between frames.
```

To animate, change bits 15:11 of `w1` to another absolute group (for example,
the next bird page's groups 8–15). To flip, set bit 13 (H) or 14 (V) — no
second copy of the art is needed.

### 7.6 Filling the bank from art

The packing loop is small; the showcase builds its patterns in
`scripts/make_bird_sprite.mjs` and writes `birdsprite.hex`:

```js
for (const [row, pixels] of art.entries())
  for (const [col, pixel] of pixels.entries()) {
    const tile = (row >> 3) * 4 + (col >> 3);
    const word = group * 256 + tile * 16 + (row % 8) * 2 + ((col % 8) >> 2);
    const shift = (col % 4) * 4;
    bank[word] |= (pixel & 0xF) << shift;
  }
```

For a runtime loader, do the same in D16 assembly but replace `group` with
`group & 7` after setting control 5 to the group's page. One 16-bit word covers
four neighbouring pixels, so a 32-pixel row is eight stores. Remember the page
in control 5 belongs to the write, not to the OAM.

### 7.7 Things that catch people out

* **Invisible sprite** — `w0` bit 11 (enable) is not set, the group is 24–31,
  or the group bits point at an empty group.
* **Everything is transparent** — the art has 0 where you meant a colour, or
  you wrote the palette entry but not the pattern.
* **Wrong sprite in front** — priority is fixed by slot number, not by the
  order you write OAM. Slot 0 wins.
* **The clouds eat the pipes** — a behind sprite is only hidden by non-zero
  tile pixels; clearing `w0` bit 15 draws it over the map.
* **Tearing** — OAM and the bank are read during the line blanking. Update
  them after the frame flag (the game's `wait_frame`) or on a page that is not
  displayed.
* **Left-edge pop** — a sprite that moves off the left must switch to
  `xsign` (value `1024 + x`, `w0` bit 10); otherwise the 10-bit x wraps to the
  far right.
* **Leaving the game** — the BIOS `gfx` handler clears OAM and the scroll
  when the showcase returns, so the console comes back with no sprites.
* **No sprite layer in the text build** — the bank and OAM exist only in the
  `dvi_tile` / D16nano tile build.

---

## 8. Where to look

| File | Contents |
|---|---|
| `rtl/dvi/dvi_tile.sv` | tilemap, tile bank, palette, scrolling, OAM, compositor |
| `rtl/dvi/README.md` | DVI builds, timing, resource use, control 6/7 |
| `scripts/make_tile_font.mjs` | text pages, tile layout, palette file |
| `scripts/make_art.mjs` | source art to 16-colour RGB332 art tiles |
| `scripts/make_bird_sprite.mjs` | sprite patterns, 24 groups, `birdsprite.hex` |
| `asm/showcase/flappy_game.asm` | `sb_emit` (bird), `set_clouds`, `set_palette` |
| `asm/showcase/showcase.asm` | palette tables, bird pages, OAM cells |
| `screens/flash/catalog.fth` | `row-scroll!`, raster and palette words |
| `FORTH.md` | console colours, styles and Forth words |
| `MEMMAP.md` §7.4 | the FiT address map |
| `FROGPLAN.md` | per-row lane mapping and the Frogger plan |
| `COLORTEXT.md` | pair-mode design notes and area cost |
| `tests/showcase-art.test.js` | bank layout and palette agreement |
| `tests/showcase-death.test.js` | OAM, sprite write page and animation checks |

Simulation: `npm run sim:dvi:tile` exercises the tilemap, text/art fetch,
palette pairs, styles, scroll, per-row phases, the raster toggle, 32x32 sprite
rows, H/V flip, the behind bit, transparency and the eight-sprite priority
chain.
