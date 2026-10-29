# Multi-coloured text: per-cell palette pairs

Status: **design note, nothing implemented.** The tile console can show exactly
one text colour at a time: every glyph uses palette index 0 for paper and 1 for
ink, and the 16-entry palette is global. This note records a scheme that gives
**eight text colours on one screen for about eight CLS**, using the four
reserved bits of every tilemap word and no new palette memory.

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
| 11:0 | tile base address (unchanged) |

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
  reach. Bit 15 has to be written deliberately.
- **Pair 0 equals today's text colour**: entries 0/1 are still paper and ink.
- **The cursor XOR is unaffected** (`lb_wdata ... ^ {8{cursor_fill}}`,
  `:511`) — it inverts the looked-up colour, whichever pair produced it.
- **The 8x8 sprite path is unaffected**; sprites keep the global palette.
- **The D16MINI text build** uses `dvi_text`, not `dvi_tile`, so it is untouched.

## 5. Software

The console's tilemap write — currently `(ch - 0x20) << 5` at
`asm/forth_nano.asm:13958` — becomes:

```
word = 0x8000 | (pair << 12) | ((ch - 0x20) << 5)
```

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

## 6. Tests

- pair mode renders entries `2p`/`2p+1` for every `p` — pixel-exact against the
  palette table;
- a tilemap with bits 15:12 = 0 produces a line buffer identical to the current
  build for a known screen (the compatibility claim, not an assertion of intent);
- the cursor invert still applies in pair mode;
- eight cells, one glyph, eight pairs -> eight colours in one frame;
- the palette window writes entries that pair mode consumes (the two paths agree).

## 7. Alternatives, and why not

| Option | Cost | Why not |
|---|---|---|
| 16 full palettes in LUTs | ~80 CLS | the whole budget, in one dense block at 99 % slice occupancy |
| 16 palettes in 1 BSRAM | 10-15 CLS + 1 block | needs a pipeline stage in the fill path (synchronous read) and a 4th memory port; keep as a fallback if art needs palettes too |
| Per-tile palette in word 30 | ~10 LUT4 + 1 fetch/cell | a glyph would need a copy per colour — the tilemap bit is strictly better for text |
| 1-2 palette bits | 14-24 CLS | buys 2-4 *art* palettes, not 8 text colours |

Pair mode is the cheapest scheme that solves the stated problem, and it is the
only one that costs no table growth at all.

## 8. Open questions

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
