# How to do sprite graphics on D16nano

The tile build has a sprite layer on top of the tilemap: **eight 32x32
sprites, 4 bits per pixel**, composited into the same 640x360 frame the tiles
draw into. Each sprite has its own x/y, a pattern group, an enable bit and
hardware H/V flip; the whole layer shares one 16-entry RGB332 palette with the
tiles.

The Flappy showcase (`asm/showcase/flappy_game.asm`) is the reference
implementation: a bird, four parallax clouds and three animated poses.

## 1. The windows

All sprite memory is word-addressed, written by the CPU like ordinary RAM.

| Address | Words | What |
|---|---|---|
| `0xF4000`–`0xF47FF` | 2,048 | sprite pattern bank, **one page** (8 groups) |
| `0xF5000`–`0xF500F` | 16 | OAM, two words per sprite |
| `0xF5080`–`0xF508F` | 16 | palette, RGB332 |
| `0xF200A` | 1 | control 5: sprite page, bits 1:0 |

The bank at `0xF4000` is a window, not the whole memory: the hardware holds
24 groups (3 pages of 8) and control 5 selects which page the CPU sees. OAM
and palette are plain registers: they are write-only from the CPU and can be
updated at any time.

## 2. OAM: where a sprite is and what it shows

Two words per sprite, sprite 0 first:

| Word | Bits | Field |
|---|---|---|
| `w0` | 15 | behind (draw only over background pixel 0) |
| | 14 | V flip |
| | 13 | H flip |
| | 12:10 | group, relative to the page (0–7) |
| | 9:0 | x, left edge |
| `w1` | 11 | negative x |
| | 10 | enable |
| | 9:0 | y, top edge |

* The visible frame is **640x360** source pixels (shown 2x2 on 1280x720).
  `x` and `y` are the top-left corner; a 32x32 sprite clips at the right and
  bottom edges by itself.
* To put a sprite partly off the **left** edge, store `1024 + x` with `x`
  negative and set `w1` bit 11. For example `x = -20` is `1004` plus the sign
  bit.
* **Sprite 0 wins.** The compositor combines slots 7 down to 0 and a lower
  number replaces a higher one, so put the thing that must be in front in
  slot 0 (the bird) and scenery in slots 1–7 (the clouds).
* **behind** only matters against the tilemap: a behind sprite is hidden where
  the background tile pixel is non-zero, which is how the clouds stay behind
  the pipes and the ground. Clear it to draw over everything.

## 3. The pattern bank and its pages

A 32x32 sprite is 16 8x8 patterns of 16 words each, so one group is 256
words. The bank holds 24 groups:

```
absolute group = page * 8 + relative_group
page           = 0, 1 or 2        (control 5, bits 1:0)
relative group = OAM w0 bits 12:10
```

Pattern addresses inside a group, for `row` and `col` in 0..31:

```
tile  = (row / 8) * 4 + (col / 8)       ; 0..15
word  = group * 256 + tile * 16 + (row % 8) * 2 + (col % 8) / 4
shift = (col % 4) * 4                   ; low nibble is the leftmost pixel
```

Each word is four pixels. Empty pixels **must be 0** — that is the transparent
key (§4).

There are two ways to get art into the bank:

* **Bake it into the bitstream.** `rtl/dvi/dvi_tile.sv` does
  `$readmemh("birdsprite.hex", sprite)` at power-up, so 24 groups are already
  there. `scripts/make_bird_sprite.mjs` builds that file (and
  `scripts/make_image.mjs` writes it next to the boot image). This is how the
  three bird pages and the shared cloud ship.
* **Write it at runtime.** Set the page with control 5, then store words at
  `0xF4000 + offset`. Only the selected page is addressable, and a write
  changes what is on screen immediately, so treat another page as the back
  buffer if you redraw animated art.

## 4. Palette

16 entries of **RGB332** (`RRRGGGBB`) at `0xF5080 + index`, shared by tiles
and sprites. Sprite pixels are indices 0–15 into that table.

* Index 0 is **transparent for sprites**, and the showcase also uses it for
  the sky, so an empty sprite pixel shows the sky.
* Changing an entry changes every pixel of that index, tile and sprite alike.
  The showcase picks a bird by writing entries 2 (body) and 13 (belly) on
  reset, while all three birds share the same pattern layout and differ only
  in the page.
* Power-up colours come from `tilepal.hex`. Leaving Flappy restores the
  console palette, and the BIOS `gfx` handler clears OAM, so the console
  comes back with no sprites.

## 5. A sprite in six steps

```asm
.equ SEG_CTRL -0x0E00        ; ES 0xF200 -> window 0xF2000 (control)
.equ SEG_SPR  -0x0C00        ; ES 0xF400 -> window 0xF4000 (sprite bank)
.equ SEG_OAM  -0x0B00        ; ES 0xF500 -> window 0xF5000 (OAM/palette)

; 1. select the page (0..2) the OAM group numbers refer to
    LDI SEG_CTRL
    MVS ES, R0
    LSI R2, 0x0A
    LSI R3, 0
    STS R3, ES, R2

; 2. (optional) load patterns into 0xF4000 + group*256 + ...
;    or use the art already baked into the bitstream.

; 3. (optional) set palette entries, e.g. body colour at index 2
    LDI SEG_OAM
    MVS ES, R0
    LSI R2, 0x82
    LDI 0x84                 ; RGB332
    MOV R3, R0
    STS R3, ES, R2

; 4. w0 = group 0, x = 100
    LSI R2, 0
    LDI 100
    MOV R3, R0
    STS R3, ES, R2

; 5. w1 = enable | y = 60
    LSI R2, 1
    LDI 60
    MOV R3, R0
    LDI 0x0400
    OR R3, R0
    STS R3, ES, R2

; 6. move it later by rewriting w0 (x) and w1 (y); both words are latched by
;    the line loader, so update them together between frames.
```

To animate, change bits 12:10 of `w0` to another group (or the page). To flip,
set bit 13 (H) or 14 (V) — no second copy of the art is needed.

## 6. Filling the bank from art

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

For a runtime loader, do the same in D16 assembly: one 16-bit word covers four
neighbouring pixels, so a 32-pixel row is eight stores. Remember the page in
control 5 belongs to the write, not to the OAM.

## 7. Things that catch people out

* **Invisible sprite** — `w1` bit 10 (enable) is not set, or the page does not
  match the pattern's page, or the group bits point at an empty group.
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
  `xsign` (value `1024 + x`); otherwise the 10-bit x wraps to the far right.
* **Leaving the game** — the BIOS `gfx` handler clears OAM and the scroll
  when the showcase returns, so the console comes back with no sprites.
* **No sprite layer in the text build** — the bank and OAM exist only in the
  `dvi_tile` / D16nano tile build.

## 8. Where to look

| File | Contents |
|---|---|
| `rtl/dvi/dvi_tile.sv` | OAM decode, line loader, compositor, priority |
| `asm/showcase/flappy_game.asm` | `sb_emit` (bird), `set_clouds`, `set_palette` |
| `asm/showcase/showcase.asm` | palette tables, bird pages, OAM cells |
| `scripts/make_art.mjs` | source art to 16-colour RGB332 |
| `scripts/make_bird_sprite.mjs` | patterns, 24 groups, `birdsprite.hex` |
| `tests/showcase-art.test.js` | bank layout and palette agreement |
| `tests/showcase-death.test.js` | OAM, sprite page and animation checks |

Simulation: `npm run sim:dvi:tile` exercises 32x32 rows, H/V flip, the behind
bit, transparency and the eight-sprite priority chain.
