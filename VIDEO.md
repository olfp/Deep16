# Video: what a text screen costs

Target: DVI (4 TMDS pairs, second rPLL free). The text build is
**640×480@60** at 25.2 MHz with the 80×24 text (640×360, 8×15 cells) centred
with borders. The D16nano tile build is **1280×720@60**: its renderer fills
640×360 at 25.5 MHz and the scan path repeats every pixel and every line 2×2
at 74.25 MHz (1650×750).

Budget today: **109 CLS free**, 20/26 BSRAM in the default build. With the
verified, persistent user-flash loader (`USERFLASH.md`): **4/26 BSRAM (22
free)**, but only 17 CLS free.

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

### b.1 Measured state (23 Oct 2026)

The three-stage D16nano core (`rtl/deep16_core3.sv`, 6.75 MHz) made the sprite
work possible. The user-flash tile build has:

```
tile console + D16D colour demo, 8 sprites x 32x32, 128-tile bank
  CLS 3,936 / 4,320 (384 free)   Logic 7,262 / 8,640
  Registers 2,482                BSRAM 12 / 26
```

The tile console drives a standard **1280×720 @ 60 Hz** signal. The render
side fills 640×360 at 25.5 MHz; the scan side reads each line buffer twice
horizontally and repeats each source line on two output lines, so the DVI
signal is 1650×750 at 74.25 MHz. Every pixel is a crisp 2×2 block. The
`dvi_text` build above keeps 640×480@60.

The 16-block CPU image is the reason the packed build could not hold the bank:
it leaves no BSRAM for the 128 tiles or the PSRAM tag cache. With the image in
the on-die FLASH608K, the tag cache and the 2-block sprite bank are BSRAM. The
sprite rows are an 8x8x16 register file selected by the scan (no shift mux),
and Hflip/Vflip are read/loader transformations. Details and the OAM format are
in `rtl/dvi/README.md`.

The D16D demo is a separate block at PSRAM 0x4E00 in the 24K user-flash image:
eight 32x32 sprites over a scrolling '#' field, started by typing `gfx` at the
Forth prompt. It lives in the BIOS segment (CS=DS=0x04A0), between the BIOS code
and the Forth stacks, so the dictionary stays at 0x6000 and the plain 24K image
and standard 25-page installer are unchanged. A BIOS SWI (function 6) parks the
Forth's R5/R6, jumps to entry 0x404, and on return clears the tilemap/scroll/OAM
and resets the kernel cursor cells. The packed BSRAM console is built without
the gfx additions (they take the tile kernel over the 16-block budget); the demo
only exists in the flash image.

The tested persistent flash writes both halves and survives a power cycle:

```sh
npm run synth:tile   # 24K D16D image + tile .fs + image.flash.bin
npm run flash:tile   # openFPGALoader -f <tile.fs> --user-flash <image.flash.bin>
# power-cycle
```

`-f` is the FPGA configuration; the explicit `--user-flash image.flash.bin` is
the full 608 Kbit on-die user image (the D16D kernel/demo), from the same build.
`-m` is SRAM only, and `npm run installer:tile` remains the user-flash fallback.
The Gowin GUI is an alternative, not the tested route.

The earlier per-pixel palette estimate was too pessimistic; the tile engine's
line-buffer path absorbed the palette lookup, and the remaining pressure moved
from CLS to BSRAM.

See `rtl/dvi/README.md`.

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

### b.1 Measured text-mode tile engine (22 Oct 2026)

The first 4bpp tile console is built: `rtl/dvi/dvi_tile.sv` uses an 82x26
pure-address tilemap (3 blocks), a 96-tile 32-word 4bpp bank (3 blocks: 30 data
words + palette pointer + flags) and a double line buffer (1 block), with a
16-entry RGB332 palette in distributed ROM. The terminal parser writes tile
addresses; the renderer fills the next line while scanning the current one.

```
CLS 4,316 / 4,320 (4 free)     BSRAM 23 / 26 (3 free)
Logic 8,533 / 8,640            clk_cpu 15.739 MHz max at 13.5 MHz
```

That is **+105 CLS** over the `dvi_text` build, not the 220–280 estimate: the
line-buffer fill is cheaper than the per-pixel palette prefetch, and the 16
palettes are not wired yet (one palette, no flips). The 4-CLS margin is the
real constraint. The sprite bank (2 blocks) and sprite line buffer/OAM (1 block)
use the three free BSRAM blocks; the CLS for sprites has to come from the
D16nano divider removal, the RX-only UART and dropping the DVI-side ANSI
parser. See `rtl/dvi/README.md`.

