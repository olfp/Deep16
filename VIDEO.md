# Video: what a text screen costs

Target: DVI (4 TMDS pairs, second rPLL free) at **640×480@60**, pixel clock
25.2 MHz (27 MHz x 14/3/5), 252 Mbit/s per lane. Active text area **640×360** =
80 columns x 24 rows of **8×15** cells, centred with borders.

Budget today: **109 CLS free**, 20/26 BSRAM in the default build. With the
verified user-flash loader (`USERFLASH.md`): **4/26 BSRAM (22 free)**, but only
17 CLS free.

## a) Black and white text, 8×15 — **implemented**

| Item | Cost |
|---|---|
| 1,920 cells, two per 16-bit word | 960 words = **1 BSRAM block** |
| font, 96 glyphs x 15 rows, two per word | 768 words = **1 block** |
| sync + renderer + prefetch + cursor | part of the measured total |
| terminal mirror: UART RX, ANSI parser, scroll | part of the measured total |
| TMDS: 3 encoders + clock lane + OSER10/ELVDS | part of the measured total |
| **Measured total** | **2 blocks, +203 CLS** over the pre-DVI build |
| **New budget** | **4,211 / 4,320 CLS (98 %)**, Logic 8,173/8,640 |

Per scanline: 40 cell-pair reads + 80 font-row reads = 120 BSRAM reads, against
800 pixel clocks — 15 % of the slots at one read per pixel clock.
**Zero PSRAM traffic.** The console mirrors the UART at 115200, parses the ANSI
the kernel emits, scrolls with a circular row offset and draws a blinking
block cursor. See `rtl/dvi/README.md`.

The 109-CLS margin is thin: the colour mode below cannot be added without taking
area back first. The terminal parser and the sync/renderer prefetch are the
obvious candidates; the TMDS encoder is already the compact spec form.

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

Verdict: the user-flash build gives the colour mode its **blocks** (6 of 22
free) but not its **area**: 220–280 CLS against 16 free. 256 tiles needs 11
blocks, so it has the blocks too. B/W text is working; colour needs a CLS diet
first, independent of where the boot image lives.
