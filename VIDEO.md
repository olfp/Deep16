# Video: what a text screen costs

Target: DVI (4 TMDS pairs, second rPLL free) at **640×480@60**, pixel clock
25.2 MHz (27 MHz x 14/15), bit clock 252 MHz. Active text area **640×360** =
80 columns x 24 rows of **8×15** cells, centred with borders.

Budget today: 424 CLS free, 26/26 BSRAM (range-packed image would free ~8).

## a) Black and white text, 8×15

| Item | Cost |
|---|---|
| 1,920 cells, 8-bit character | 960 words = **1 BSRAM block** |
| font, 96 glyphs x 15 bytes | 1,440 B = 720 words = **1 block** |
| renderer (cell fetch, glyph row, 8-bit shift, sync) | ~60–90 CLS |
| TMDS: 1 active encoder + 2 zero encoders + serializers | ~60–80 CLS |
| **Total** | **2 blocks, ~120–170 CLS** |

Per scanline: 80 cell reads + 80 font-byte reads = 160 BSRAM reads, against 800
pixel clocks at 25.2 MHz with BSRAM at 50 MHz (1,600 slots) — 10 % used.
**Zero PSRAM traffic.** Fits comfortably; this is the first milestone.

## b) Indexed colour text/tile, 4-bit indices

Per cell: tile/character pointer + palette pointer; each tile pixel is a 4-bit
index; 16 palettes of 16 x 16-bit colours (RGB565).

| Item | Cost |
|---|---|
| 1,920 cells: 8-bit tile + 4-bit palette (packed 16-bit) | **2 blocks** |
| tiles: 8x15 px x 4 bpp = 60 B each, 96 tiles | 5,760 B = 2,880 words = **3 blocks** |
| same, 256 tiles | 15,360 B = **8 blocks** |
| palettes: 16 x 16 x 16 bit | 512 B = 256 words = **1 block** |
| renderer + palette mux + 3 TMDS channels | ~220–280 CLS |
| **Total (96 tiles)** | **6 blocks, ~220–280 CLS** |
| **Total (256 tiles)** | **11 blocks — does not fit today** |

Per scanline the pixel pipeline needs: 40 cell reads (two cells per word) + 160
tile reads (2 words per cell row) + 640 palette lookups (one per pixel) = ~840
BSRAM reads against 1,600 slots at 50 MHz — **52 %**, feasible at 1 read per
pixel with a 2:1 BSRAM-to-pixel clock ratio.

Verdict: **96-tile indexed colour fits the current area and (after range packing)
the block budget**; 256 tiles needs either a smaller tile bank, a coarser tile
format, or more free blocks. B/W text is the safe first step, colour is the
second.
