# How to do sprite graphics on D16nano

The **FiT** graphics layer (*Frogger inspired tile-based*) has a sprite layer on
top of the tilemap: **eight 32x32
sprites, 4 bits per pixel**, composited into the same 640x360 frame the tiles
draw into. Each sprite has its own x/y, a pattern group, an enable bit and
hardware H/V flip; the whole layer shares one 16-entry RGB332 sprite palette,
separate from the text and art banks (§4).

The Flappy showcase (`asm/showcase/flappy_game.asm`) is the reference
implementation: a bird, four parallax clouds and three animated poses.

## 1. The windows

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

## 2. OAM: where a sprite is and what it shows

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
* **behind** only matters against the tilemap: a behind sprite is hidden where
  the background tile pixel is non-zero, which is how the clouds stay behind
  the pipes and the ground. Clear it to draw over everything.

## 3. The pattern bank and its pages

A 32x32 sprite is 16 8x8 patterns of 16 words each, so one group is 256
words. The bank holds 24 groups, and the OAM group is the flat index:

```
absolute group = OAM w1 bits 15:11     (0..23)
write page     = control 5, bits 1:0   (0..2; page 3 clamps to 0)
```

The write page only selects which 8-group page the CPU window at `0xF4000`
writes; the renderer never adds it to the group. Groups 0,1,8,9,16,17 and the
two duplicate clouds (10 and 18) are free art space in the baked bank.

The eight OAM slots can therefore each select any of the 24 groups: **8 visible
sprites out of 24 graphics**. The six extra OAM slots in the plan are only for
more than eight simultaneous sprites, not for reaching the extra art.

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
* **Write it at runtime.** Set the write page with control 5, then store words
  at `0xF4000 + offset`. Only the selected page is writable, and a write
  changes what is on screen immediately, so treat another page as the back
  buffer if you redraw animated art. The renderer still uses the absolute
  group in OAM.

## 4. Palette

Three banks of 16 **RGB332** (`RRRGGGBB`) entries share one 64 x 16 BSRAM:

| window | bank | used by |
|---|---|---|
| `0xF5080`–`0xF508F` | text | pair-mode tile cells, eight `paper`/`ink` pairs |
| `0xF5090`–`0xF509F` | art | mode-0 tile cells (`pix[3:0]`) |
| `0xF50A0`–`0xF50AF` | sprite | every sprite, shared by all eight slots |

Sprite pixels are indices 0–15 into the sprite bank. A mode-1 text cell
`0x8000 | (pair << 12) | tile` reads text entry `2p` when `pix[0]=0` (paper)
and `2p+1` when `pix[0]=1` (ink), so one glyph image renders in eight colours.

* Index 0 is **transparent for sprites**, and the showcase also uses it for
  the sky, so an empty sprite pixel shows the sky.
* Changing an entry changes every pixel of that index in its bank. The
  showcase picks a bird by writing sprite-bank entries 2 (body) and 13 (belly)
  on reset, while all three birds share the same pattern layout and differ only
  in the page.
* Power-up colours come from `tilepal3.hex` (the same 16 entries copied into
  all three banks). Leaving Flappy restores the art and sprite banks to the
  default and leaves the console text bank alone; the BIOS `gfx` handler
  clears OAM, so the console comes back with no sprites.

## 5. A sprite in six steps

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

; 2. (optional) load patterns into 0xF4000 + group*256 + ...
;    or use the art already baked into the bitstream.

; 3. (optional) set palette entries, e.g. body colour at index 2
    LDI SEG_OAM
    MVS ES, R0
    LSI R2, 0x82
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

## 8. Where to look

| File | Contents |
|---|---|
| `rtl/dvi/dvi_tile.sv` | OAM decode, line loader, compositor, priority |
| `asm/showcase/flappy_game.asm` | `sb_emit` (bird), `set_clouds`, `set_palette` |
| `asm/showcase/showcase.asm` | palette tables, bird pages, OAM cells |
| `scripts/make_art.mjs` | source art to 16-colour RGB332 |
| `scripts/make_bird_sprite.mjs` | patterns, 24 groups, `birdsprite.hex` |
| `tests/showcase-art.test.js` | bank layout and palette agreement |
| `tests/showcase-death.test.js` | OAM, sprite write page and animation checks |

Simulation: `npm run sim:dvi:tile` exercises 32x32 rows, H/V flip, the behind
bit, transparency and the eight-sprite priority chain.
