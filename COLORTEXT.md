# Multi-coloured text: per-cell palette pairs

Status: **design note, nothing implemented.** The tile console can show exactly
one text colour at a time: every glyph uses palette index 0 for paper and 1 for
ink, and the 16-entry palette is global. This note records a scheme that gives
**eight text colours on one screen for about eight CLS**, using the top nibble
of every tilemap word and no new palette memory. Section 6 extends the same word
with **italic and underline**, and makes **bold** a palette choice rather than a
second font.

Companions: `doc/Deep16nano-Sprites.md` (tile/sprite/palette contract),
`SLIMPLAN.md` (the 83 CLS budget), `ARCHREV.md` (change log),
`rtl/dvi/dvi_tile.sv` (the implementation).

## 1. The problem

| | Today |
|---|---|
| Palette | 16 entries of RGB332, global, writable at `0xF5080 + n` (`dvi_tile.sv:253`) |
| Shared by | tiles **and** sprites (`dvi_tile.sv:510-511`) |
| A glyph's pixels | index 0 = paper, index 1 = ink (`scripts/make_tile_font.mjs:13-14`) |
| Tilemap word | low 12 bits = tile base; **bits 15:12 reserved** (`dvi_tile.sv:220`) |

Because the text indices are 0 and 1, the palette entries 0 and 1 decide the
colour of *every character on screen*. A program can change them at runtime —
which is how the console recolours itself today — but only globally, and only
between frames.

## 2. The scheme

Use the reserved top nibble of each tilemap entry:

| Bits | Meaning |
|---|---|
| 15 | mode: **0 = art** (index = `pix[3:0]`, today's behaviour), **1 = pair** |
| 14:12 | pair 0..7 |
| 11:0 | tile base address (unchanged; 32-word aligned, so bits 4:0 are zero) |

The 32-word alignment is what keeps bits 4:0 free. Section 6 uses them for a
font page and style flags; every cell written today has them zero, so this
layout is unchanged for existing programs.

In pair mode the palette index becomes:

```
index = {pair[2:0], |pix[3:0]}      ; entries 2p (paper) and 2p+1 (ink)
```

so palette entries come in pairs: pair 0 = entries 0/1, pair 1 = 2/3, …,
pair 7 = 14/15. One glyph image renders in eight different colours depending on
the cell that places it — no extra tile-bank storage, no extra palette memory.

`|pix` (any non-zero index is ink) rather than `pix[0]`: a text tile only uses
0 and 1, but the reduce makes a 16-colour tile in pair mode a predictable
two-colour silhouette instead of an LSB accident. It costs 3 LUT4.

## 3. Cost

| Item | LUT4 | FF | Note |
|---|---|---|---|
| `fpal`/`fnpal` carry through the fill pipeline | 4 | 8 | mirror of `fcell`/`fncell` (`:559`, `:587`, `:613`) |
| `\|pix` reduce | 3 | – | any non-zero = ink |
| 4-bit index mux in `lb_wdata` | 4 | – | pair mode vs art mode |
| mode/pair wiring | ~3 | – | |
| **total** | **~14 (12-16)** | **8** | **≈ 6-10 CLS** |

Zero BSRAM, zero tile-bank growth, zero palette-table growth — the table stays
128 bits / 8 LUT4. Timing is untouched: the pair bits come from `tm_q`, which
is already registered, and the fill FSM keeps its cycle structure.

For contrast, *widening* the palette table instead doubles with each palette
bit — 2^(4+bits) x 8 bits, so 16 LUT4 at one bit and 128 at four:

| Scheme | Table LUT4 | Total CLS |
|---|---|---|
| 1 bit (2 palettes x 16) | 16 | ~14 |
| 2 bits (4 x 16) | 32 | ~24 |
| 3 bits (8 x 16) | 64 | ~43 |
| 4 bits (16 x 16) | 128 | ~80 |

Pair mode gets the same *visual* result as the 4-bit scheme for text, for a
tenth of the area, because it does not need 16 colours per cell — it needs two.

## 4. Compatibility

- **Bits 15:12 = 0 renders exactly as today.** Every existing tilemap write is
  `(ch - 0x20) << 5`, which leaves the top nibble zero, so the current console,
  the D16D demo and every game are unaffected. This is a pure addition.
- **The mode bit cannot be set by accident.** The console composes the word as
  `(ch - 0x20) << 5` (`asm/forth_nano.asm:13958`); for the largest possible byte
  (`ch = 0xFF`) that is `0x1BE0`, so bit 12 is the highest bit any character can
  reach. Bit 15 has to be written deliberately. Bit 12 stops being harmless once
  pair mode is in use — see the `EMIT` mask caveat in §6.8.
- **Pair 0 equals today's text colour**: entries 0/1 are still paper and ink.
- **The cursor XOR is unaffected** (`lb_wdata ... ^ {8{cursor_fill}}`,
  `:511`) — it inverts the looked-up colour, whichever pair produced it.
- **The 8x8 sprite path is unaffected**; sprites keep the global palette.
- **The D16MINI text build** uses `dvi_text`, not `dvi_tile`, so it is untouched.

## 5. Software

The console's tilemap write — currently `(ch - 0x20) << 5` at
`asm/forth_nano.asm:13958` — becomes:

```
word = 0x8000 | (pair << 12) | ((ch - 0x20) << 5) | style
```

`style` is the page/underline/bold field of §6.1, zero for plain text. With
`style = 0` this is exactly the pair-mode word; §6 builds on it without changing
the encoding.

Palette pairs are set through the existing window, entry by entry:

```
0xF5080 + 2p   paper of pair p
0xF5080 + 2p+1 ink   of pair p
```

Suggested words:

| Word | Effect |
|---|---|
| `PAL! ( bg ink pair -- )` | write both entries of a pair |
| `ATTR ( pair -- )` | set the pair `EMIT` composes into the tilemap |
| `COLOR ( pair ch -- )` | place one character in a pair without touching `ATTR` |
| `ATTR@ ( -- pair )` | read the current pair |

**Palette budget.** The 16 entries are shared with art tiles, so a mixed screen
should partition them deliberately: for example four text pairs (entries 0-7)
plus eight art colours (8-15). Eight text pairs consume the whole palette.

**Attribute clash.** One pair per 8 x 15 cell is inherent to a character grid
and is what the scheme is for. Per-8x8 sub-cell attributes would need two pairs
per cell and are not proposed.

## 6. Font styles: italic, underline, bold

Status: design only, not implemented. Pair mode fixes colour; this section uses
the alignment bits it leaves over to give each cell a font style. It is built so
that the three birds, the Flappy showcase and every existing sprite stay
untouched.

### 6.1 Cell layout

In pair mode the full 16-bit cell is:

| Bits | Field | Values |
|---|---|---|
| 15 | mode | 0 = art, 1 = pair/font |
| 14:12 | pair | 0..7 |
| 11:5 | tile index | 0..127: glyph 0-95, art 96-127 |
| 4:3 | font page | 0 regular, 1 italic, 2 underline, 3 italic+underline |
| 2 | underline | 1 = generated underline row (see 6.4) |
| 1 | bold smear | 1 = duplicate ink one pixel right (optional) |
| 0 | spare | 0; kept for a later superscript/subscript |

A text cell is therefore:

```
0x8000 | (pair << 12) | (index << 5) | (page << 3) | (ul << 2) | (bold << 1)
```

Mode 0 still treats bits 11:0 as a pure 32-word-aligned address, so art cells
keep `address` and ignore every style bit. Because no existing write sets bits
4:0, the new fields can never collide with an old address.

### 6.2 One font page is one block, because text is 1bpp

The current font is stored 4bpp: 96 glyphs x 30 pixel words = 5,760 B (6,144 B
with the per-tile words), three blocks for the glyphs alone, plus 2,048 B of art.
A 1bpp glyph is 8 x 15 bits = 15 B, padded to 16 B = 8 words; a whole 96-glyph
page is 1,536 B = 768 words, one block.

| Storage | Font bytes | + art 2,048 B | BSRAM |
|---|---|---|---|
| Today: one 4bpp font | 6,144 | 8,192 | 4 |
| 1bpp regular only | 1,536 | 3,584 | 2 |
| 1bpp regular + italic | 3,072 | 5,120 | 3 |
| Four 1bpp pages (full family) | 6,144 | 8,192 | 4 |
| Four 4bpp pages (the tempting route) | 24,576 | 26,624 | ~12 |

Four 1bpp pages occupy exactly the bytes one 4bpp font occupies today. The
4,096-word bank is **re-partitioned, not enlarged**: four pages x 768 words =
3,072 words, then art at word 3,072 (96 x 32) exactly where it is now. Art
tiles, the sprite bank and the showcase need no change at all.

Pages 2 and 3 exist only if a *stored* underline is wanted. The generated
underline (6.4) is cheaper, so the recommended build stores pages 0 and 1 only:
regular plus italic, three blocks, one block freed for SLIMPLAN's
register-file/audio budget.

Text rows are addressed within the 8-word tile: row `r` is byte `r&1` of word
`r>>1`. During `F_PIX` the text path reads one word per row instead of two, then
selects the byte by `row[0]` and the pixel by `fpix`; the nibble unpacker is
bypassed for text. Art keeps its 32-word tile and 4bpp unpacker. The shared cost
is a mode/index mux in front of the tile address, about 4-6 LUT4:

```
text_word = page*768 + index*8 + (row >> 1)
art_word  = 3072 + (index - 96)*32 + 2*row      ; mode 1, index >= 96
```

Mode 0 is unchanged: `art_word = address + 2*row`, with `address = tm_q[11:0]`.

### 6.3 Which slots pair mode can address

Glyph indices 0-95 read the selected font page; indices 96-127 ignore the page
bits and read the shared art bank, so a pair can also tint a 4bpp art tile via
`|pix` as described in §2. This keeps one index space for text and art and lets
a cell mix pairs without a second bank.

### 6.4 Underline is generated, not stored

Force ink on row 14 in the text path:

```
ink = pix_bit | (ul && row == 14)
```

That is about 4 LUT4 and zero BSRAM, applies to regular and italic alike, works
with every pair, and cannot be forgotten by a font page. Row 14 is the descender
row, so OR-ing the whole row joins the descenders into a continuous rule instead
of cutting them. A stored underline page is only worth it if a font ever wants a
double rule or a different row.

### 6.5 Italic: shear first, designed page as the fallback

| Route | Cost | Trade-off |
|---|---|---|
| 1-px shear per row | ~8 LUT4, 0 BSRAM | top rows shift right by 0-2 px; the right column clips first; only two steps at 8 px wide |
| Designed 1bpp italic page | +1 block, 0 LUT | correct slope, no clipping, just another page select |

Implement the shear first: `row` picks a 0/1/2-pixel shift, and the shifted row
feeds the pair index. Judge it on the three birds' captions and the Flappy HUD.
If the clipped right column or the two-step staircase is visible, switch to the
designed page — the cell format does not change, only where page 1 comes from.
Never shear 4bpp art tiles.

### 6.6 Bold is a colour, not a page

The pair already chooses the ink, so bold is a pair whose ink is brighter or more
saturated. Today palette entries 1 and 15 are both `0xFF` white, so pairs 0 and 7
are equally bright; the palette must define a normal ink and a bold ink (for
example normal `0xB6`, bold `0xFF`) on a dark paper. That reads as weight at zero
RTL cost and works with every glyph, including the italic page.

Bit 1 is the optional true smear: `ink | (ink << 1)` duplicates each pixel one
to the right for ~4 LUT4 and clips the right column like the italic shear. It is
not part of the first implementation.

### 6.7 Cost and order

| Piece | LUT4 | FF | BSRAM | CLS |
|---|---|---|---|---|
| Pair mode (§3) | ~14 | 8 | 0 | 6-10 |
| Page/tile mux and 1bpp row select | 6-10 | 0 | 0 | 3-5 |
| Generated underline | ~4 | 0 | 0 | ~2 |
| Italic shear | ~8 | 0 | 0 | ~4 |
| Bold smear (optional) | ~4 | 0 | 0 | ~2 |
| **Generated build (no smear)** | **~32-40** | **8** | **0** | **~15-21** |
| Designed italic page | 0 | 0 | +1 | 0 |
| Bold smear, if added | ~4 | 0 | 0 | ~2 |

Against 42 free CLS and 3 free BSRAM (latest P&R 4,278/4,320), the generated
build leaves roughly 20 CLS spare.

Implementation order:

1. Pair mode alone; prove that bit-15-zero cells are pixel-identical and that
   eight pairs render eight colours.
2. 1bpp regular page and the text fetch; confirm the console, the three birds
   and the Flappy showcase are unchanged with style bits zero.
3. Generated underline (bit 2).
4. Italic shear (page 1); fall back to the designed page if 8 px is too narrow.
5. Bold as a palette convention; add the smear only if colour is not enough.
6. Stored underline pages only for a future double rule.

Steps 1-3 cost no BSRAM. The designed italic fallback is the only variant that
spends a block; regular plus italic leaves the bank at three blocks and frees
one.

### 6.8 The `EMIT` character mask

Moving the tile index to bits 11:5 means `(ch - 0x20) << 5` sets bit 12 for
every byte `>= 0xA0`, and in pair mode bit 12 is pair bit 0. Bytes `0x80-0x9F`
are nearly as bad: they land in the art slots 96-127. An arbitrary byte would
silently recolour a cell or show art. `EMIT` must reject anything outside
`0x20-0x7F` (map it to `?`) rather than composing the raw byte; masking to seven
bits is only safe after that check. The console already prints printable ASCII,
so this is a guard rather than a behaviour change. The §4 claim that bit 15 is
unreachable stays true; bit 12 is no longer unreachable.

## 7. Tests

- pair mode renders entries `2p`/`2p+1` for every `p` — pixel-exact against the
  palette table;
- a tilemap with bits 15:12 = 0 produces a line buffer identical to the current
  build for a known screen (the compatibility claim, not an assertion of intent);
- the cursor invert still applies in pair mode;
- eight cells, one glyph, eight pairs -> eight colours in one frame;
- the palette window writes entries that pair mode consumes (the two paths agree);
- style bits zero render exactly like pair mode, and art cells with noise in
  bits 4:0 (mode 0) still render from the low 12 bits;
- underline sets every pixel of row 14 for every glyph and pair, and leaves the
  other rows alone;
- the italic page renders unclipped, or the shear clips only the right column;
- bold is observable as the chosen pair's ink with no extra tile fetch.

## 8. Alternatives, and why not

| Option | Cost | Why not |
|---|---|---|
| 16 full palettes in LUTs | ~80 CLS | the whole budget, in one dense block at 99 % slice occupancy |
| 16 palettes in 1 BSRAM | 10-15 CLS + 1 block | needs a pipeline stage in the fill path (synchronous read) and a 4th memory port; keep as a fallback if art needs palettes too |
| Per-tile palette in word 30 | ~10 LUT4 + 1 fetch/cell | a glyph would need a copy per colour — the tilemap bit is strictly better for text |
| 1-2 palette bits | 14-24 CLS | buys 2-4 *art* palettes, not 8 text colours |
| Three extra 4bpp fonts | +18,432 B ≈ 8 blocks | only 3 blocks are free, and that is SLIMPLAN's register-file/audio budget; 1bpp pages plus generated underline do the same for zero blocks |
| Shear applied to 4bpp art | 8 LUT4 | art is 4bpp and shares the path; styles belong to the text page only |

Pair mode is the cheapest scheme that solves the stated problem, and it is the
only one that costs no table growth at all.

## 9. Open questions

1. **Eight pairs (all 16 entries) or four pairs plus eight art colours?** The
   console probably wants 4; a game screen mixing text and art needs the budget
   split written down.
2. **`|pix` or `pix[0]`?** Recommend `|pix` for predictable art-in-pair-mode;
   `pix[0]` saves 3 LUT4 and is enough for pure text.
3. **Does `EMIT` carry an attribute, or does the console stay one colour and
   only games use `COLOR`?** The former changes the kernel; the latter is a
   two-word addition.
4. **Should the cursor/underline invert within the cell's pair** (it does now)
   or always use a fixed highlight pair?
5. **Sprite palettes** are a separate question; OAM words have spare bits, and
   the sprite path indexes the same 16 entries.
6. **Is the 8-pair scheme enough for the console's menus**, or does a UI want a
   background colour per cell too? A pair already carries paper and ink, so it
   does — the question is only how many pairs to spend.
7. **Does `ATTR` carry the style bits, or does each `COLOR` write them?** Pair,
   page, underline and bold all live in the same word; one attribute word for
   all four is probably simpler than separate setters.
8. **Is the 2-step shear acceptable at 8 px**, or should the designed italic page
   be the first implementation? The cost is one block out of three free.
9. **Which pair is bold?** The palette must leave a brighter ink for it; if all
   16 entries are already spoken for, bold has to be a separate pair.
