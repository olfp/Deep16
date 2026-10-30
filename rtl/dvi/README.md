# DVI / HDMI output — black-and-white text

Status: **implemented and simulated; board confirmation pending.**

The D16MINI console has always been the UART. This directory adds a second
console: a hardware mirror of the terminal on the Tang Nano 9K's HDMI connector,
80 x 24 cells of 8 x 15 pixels in 640 x 480 @ 60, black on white (white on
black, actually) with a blinking block cursor. The CPU and kernel are untouched;
the screen listens to the same `uart_txd` pin the USB-UART bridge sees.

The **D16nano tile build** (`dvi_tile`, below) drives standard
**1280 x 720 @ 60 Hz** (1650 x 750 at 74.25 MHz): a 640 x 360 renderer at
24.75 MHz is repeated 2x2 by the scan path. The timing table in this section
describes the `dvi_text` build, which keeps 640 x 480 @ 60.

```
UART TX (115200) -> dvi_text: receiver -> ANSI parser -> cell RAM (80x24)
                                                   |
                          sync generator -> renderer + font ROM -> RGB
                                                   |
                                            dvi_out: 3 TMDS encoders + clock
                                                   |
                                            OSER10 -> ELVDS -> HDMI pairs
```

## Video timing

| | |
|---|---|
| Pixel clock | **25.2 MHz** (27 MHz x 14 / 3 / 5); 800 x 525 total = 60 Hz |
| Active area | 640 x 480; text is 640 x 360, 60 lines of border above and below |
| Cell | 80 x 24, 8 x 15 pixels |
| Serializer | 126 MHz (5x pixel); OSER10 gives 10 bits per pixel over DDR |
| Sync | hsync low at x 656..751, vsync low at y 490..491 (both negative) |

The PLL is `rtl/dvi/dvi_pll.v`: rPLL `IDIV_SEL=2`, `FBDIV_SEL=13`,
`ODIV_SEL=4` (VCO 504 MHz) and `CLKDIV` DIV_MODE 5. The DVI logic is held in
reset until the PLL locks.

## Memory and renderer

| Item | Size | BSRAM |
|---|---|---|
| cells, two chars per 16-bit word | 960 words | 1 block |
| font, 96 glyphs x 15 rows, two rows per word | 768 words | 1 block |

One cell pair (two characters, 16 pixels) needs three reads: the pair word and
the two font rows. The renderer prefetches the next pair and both glyphs during
the current pair; pair 0 of the next line is prefetched during horizontal
blanking. All reads fit easily in 16 pixel clocks.

Scrolling uses a **circular row offset**: on LF at the bottom, `row_off`
advances and one 80-cell row is cleared (40 words, 1.6 us). The renderer maps
logical row R to memory row `(R + row_off) % 24`, so there is no copy and no
UART byte can land on a stale bottom row while a copy waits for blanking (the
bug that overwrote ` ok` with the prompt on the board). A clear writes 960
words in 38 us. A four-byte receive queue covers the UART while a clear or row
clear runs.

The parser handles what the UART BIOS emits: `CR`, `LF`, `BS`, printable ASCII,
`ESC[H`, `ESC[r;cH`, `ESC[2J/3J`, `ESC[K` (ignored), SGR (`m`, ignored) and the
`?1049` alternate-screen requests (treated as clear + home).

## TMDS

`tmds_encoder` is the HDMI 5.4 algorithm pipelined in two stages: stage 1
builds `q_m` and its one/zero counts, stage 2 applies the running disparity.
The same RTL closes at 25.2 MHz (text) and 74.25 MHz (tile/720p). It was
checked against `hdl-util/hdmi`'s `tmds_channel` on 200,000 random pixels
(de/blank and all control combinations) with zero mismatches. Channel order:
lane 0 blue (carries hsync/vsync), lane 1 green, lane 2 red, lane 3 clock.

## Pins (Tang Nano 9K)

| Lane | p / n |
|---|---|
| blue | 71 / 70 |
| green | 73 / 72 |
| red | 75 / 74 |
| clock | 69 / 68 |

Only the p pin of each pair is constrained; `ELVDS_OBUF` drives the n side.
The values come from the Tang Nano 9K minimal-HDMI example, which is the same
board and pinout.

## Simulation

```
npm run sim:dvi
```

`rtl/sim/dvi_text_tb` drives the UART at 115200 (219 pixel clocks per bit),
sends a short ANSI session, checks the packed cell words, compares the rendered
`H` against the font ROM, checks a blank row, verifies one frame is 525 lines / 800 clocks / 307,200
`de` pixels, and sends 28 lines plus ` ok` / prompt to pin the scroll path: the
` ok` must stay on the row above the prompt. The PHY itself (PLL, OSER10, ELVDS)
is Gowin-only and cannot be simulated; board confirmation is the last step.

The TMDS encoder check against `hdl-util/hdmi` is a development test (that
reference is not vendored); re-run it if the encoder is ever changed.

## Area fit (with the packed image and the two-word PSRAM burst)

```
Logic 8,173/8,640 (95%)   CLS 4,211/4,320 (98%)
Registers 2,577/6,771     BSRAM 20/26 (16 image + 2 cache + 2 DVI)
rPLL 2/2                  0 TNS on every clocked domain

With the verified user-flash loader (`USERFLASH.md`) the image is not in
BSRAM: **BSRAM 4/26**, CLS 4,303/4,320 (100%).
```

The margin is tight: 109 CLS. Any further logic needs an area trade first (the
colour mode in `VIDEO.md` estimates 6 BSRAM blocks and more CLS, so it will not
fit alongside this without a diet).

## FiT graphics (text mode, first board build)

**FiT** — *Frogger inspired tile-based* — is the name of this graphics layer:
the 82×26 tilemap, the 32-word 4bpp tile bank, the eight 32×32 sprites, the
three palette banks and the pair-mode text styles. `dvi_tile` is the module
that implements it.

`dvi_tile` is the NES-shaped screen the text console grows into. It drives
standard **1280 x 720 @ 60 Hz** (1650 x 750 at 74.25 MHz). The render side
fills 640 x 360 at 24.75 MHz (1100 clocks = 44.44 us, exactly two output lines); the scan side reads each line
buffer twice horizontally and shows each source line on two output lines, so
every source pixel is a 2x2 block. It replaces the packed character cells
with:

* an **82 x 26 tilemap of 16-bit cells** (80 x 24 visible plus one
  tile of margin on every side; 2,132 words = 3 BSRAM blocks). `bit 15 = 0`
  is an art cell whose low 12 bits are a 32-word-aligned tile address;
  `bit 15 = 1` is a text pair cell,
  `0x8000 | (pair << 12) | tile address`.
* **96 tiles of 32 words**: 30 words of 8x15 4bpp pixels, word 30 is the palette
  pointer, word 31 is flags (H/V flip, priority). The tile address is
  `(ch - 0x20) * 32`; the tilemap never stores indices or attributes.
* **three 16-entry RGB332 palette banks** in one 64 x 16 BSRAM: text
  (`0xF5080`-`0xF508F`, eight paper/ink pairs), art (`0xF5090`-`0xF509F`) and
  the shared sprite bank (`0xF50A0`-`0xF50AF`). Text cells use `pix[0]` to
  select entry `2p` (paper) or `2p+1` (ink); mode-0 tiles read the art bank;
  every sprite reads the sprite bank.
* **text styles in the cell's low bits**: bit 2 is a generated underline (row
  14 forced to ink), bit 1 a bold smear (each ink pixel repeated one to the
  right) and bit 0 an italic shear (two pixels at the top, one in the middle,
  none at the baseline). The shear works on the 8-bit ink row, not the 4bpp
  nibbles; art cells are unaffected. The tile address is 32-word aligned, so
  the fill masks bits 4:0 out of the fetch. No BIOS change is needed: it
  already ORs the whole `text_attr` word into the cell.
* a **line-buffer renderer**: line N is scanned from one 640-byte buffer while
  line N+1 is built from the tilemap/tile bank into the other. The scan is a
  plain 640x8 read, so palette lookups cannot stall the pixel clock.
* `scroll_x`/`scroll_y` inputs and the 26-row margin are present for the game
  path; the terminal parser leaves them at zero.

The UART terminal parser is unchanged in behaviour, but writes text pair cells
instead of ASCII. `scripts/make_tile_font.mjs` expands the same Nixedsys 8x15
font into the 32-word tile bank and writes `tilefont.hex` and `tilepal3.hex`
beside the boot image; `make_image` does this automatically.

```
npm run sim:dvi:tile     # Verilator: tilemap write, H pixels, sync, 80-column wrap
npm run synth:tile       # Gowin: deep16_board_tile.fs
```

Measured on the Tang Nano 9K (23 Oct 2026), after the three-stage D16nano core:

```
packed image, console only (no sprite bank)
  CLS 3,648/4,320 (672 free)   Logic 6,770/8,640   Registers 2,303
  BSRAM 26/26 (16 image + 2 PSRAM + 8 tile), SSRAM 144 (PSRAM tags + UART)

user-flash image, eight 32x32 sprites + D16D demo
  CLS 3,936/4,320 (384 free)   Logic 7,262/8,640   Registers 2,483
  BSRAM 12/26 (tile 7 + sprite 2 + PSRAM 2 + tags 1), SSRAM 176

Current tile build (30 Oct 2026, text/art/sprite palette banks + pair mode):
  CLS 4,311/4,320 (9 free)   Logic 7,397/8,640   Registers 3,014
  BSRAM 26/26, SSRAM 190
  dvi_render 27.013 MHz, dvi_pixel 86.108 MHz, psram_clk 72.888 MHz (TNS 0)

COLORTEXT underline + bold (30 Oct 2026, place_option 1):
  CLS 4,289/4,320 (31 free)  Logic 7,352/8,640   Registers 3,009
  BSRAM 26/26, SSRAM 190
  dvi_render 32.405 MHz, dvi_pixel 86.713 MHz, psram_clk 94.458 MHz (TNS 0)

COLORTEXT underline + bold + italic (30 Oct 2026, place_option 1):
  CLS 4,312/4,320 (8 free)   Logic 7,376/8,640   Registers 3,017
  BSRAM 26/26, SSRAM 190
  dvi_render 27.999 MHz, dvi_pixel 82.140 MHz, psram_clk 103.846 MHz (TNS 0)
```

The packed 8x32 build does **not** fit: the 128-tile bank falls out of BSRAM
into distributed RAM, and the PSRAM tag cache then falls out of distributed RAM
into flip-flops (8,192 DFF against the 6,771 limit). The user-flash build
removes the 16-block CPU image, so the tag cache (1 block) and the bank
(2 blocks) both get real BSRAM. That is the build in use; the installer and the
persistent configuration are described in `USERFLASH.md`. The three-stage core
is `rtl/deep16_core3.sv` (IF/ID/EX-commit, 6.75 MHz on the board); the standard
D16 machine keeps the five-stage 13.5 MHz core. The core3 raises the ILL trap
for DIV/DIV32 (it has no iterative divider); the D16nano kernel installs
vector 0 and emulates them in `ill_handler` at 0x5000. Results return through
the SMV write form, the caller's shared R4..R12 are saved on the data stack,
and R13/R14 destinations are documented as unsupported. The full D16 keeps the
hardware divider.

## Per-row fine scroll and raster IRQ (control 6/7)

Two control registers extend the tile engine without touching the map or OAM
format:

* **control 6, `0xF200C`**: `{en, row[4:0], fine[2:0]}`. The CPU writes the
  next table; the frame boundary copies it to the live table. The fill uses
  `row_scroll[live_row]` in place of `scroll_x[2:0]`; the global coarse column
  is still `scroll_x >> 3`. `en = 0` is the old single-scroll behaviour.
  A mid-frame write never changes the current frame; the tables are two 32x16
  SSRAM arrays.
* **control 7, `0xF200E`**: a 10-bit source line 0..359. The engine toggles
  `raster_toggle` at the end of that line; the board's two-flop synchroniser
  turns the toggle into one `clk_cpu` pulse for SIC bit 3. A line at or beyond
  `R_V_TOTAL` never fires.

`npm run sim:dvi:tile` covers both: independent row phases, the frame-boundary
latch, global+row offsets, the disabled path, and one raster toggle per frame.

## Sprites

The sprite engine is in the same `dvi_tile` pixel domain, so a sprite pixel and
a tile pixel cost the same lookup:

* **Eight sprites, 32x32, 4bpp.** Sprite palette index 0 is transparent; OAM
  bit 15 puts the sprite behind background index 0; sprite 0 wins priority.
* **OAM** is 16 words at `0xF5000`: two words per sprite,
  `w0 = {behind, vflip, hflip, group[2:0], x[9:0]}`,
  `w1 = {1'b0, enable, y[9:0]}`. The shared sprite palette bank is at
  `0xF50A0`.
* **Pattern bank** at `0xF4000..0xF47FF`: 128 8x8 4bpp tiles (2,048 words,
  2 BSRAM blocks). A 32x32 sprite is 16 tiles; `tile = group*16 + (row/8)*4 +
  column`, `word = tile*16 + (row%8)*2 + half`.
* **Per-line row cache.** During the blanking the loader fetches the eight
  4-pixel words of each sprite's row into an 8x8x16 row cache (the flow infers
  distributed RAM: eight read ports, one write port). The fill selects the
  word and nibble from `fx - x0`; there is no per-pixel shift register. Hflip
  is a read-side word/nibble XOR, Vflip is applied to the row index in the
  loader. The loader uses two cycles per word and fits the 160-pixel blanking
  (eight sprites, eight words each).
* The CPU window is the same tile FIFO as the tilemap/bank; the board's pixel
  domain samples it through the existing synchroniser.

The DVI test exercises 32x32 rows, Hflip, Vflip, the behind bit, transparency
and the eight-sprite priority chain (`npm run sim:dvi:tile`).

The tested persistent flash writes both the FPGA configuration and the on-die
user image in one command (see `USERFLASH.md`):

```sh
npm run synth:tile       # 24K D16D image + tile .fs + image.flash.bin
npm run flash:tile       # openFPGALoader -f <tile.fs> --user-flash <image.flash.bin>
# then power-cycle
```

`-f` writes the configuration; the explicit `--user-flash image.flash.bin`
writes the 608 Kbit user flash (the D16D kernel/demo). `-m` alone is SRAM only.
The `.fs` and `image.flash.bin` must come from the same D16D build. The packed
`deep16_board_tile.gprj` is the historical console-only build; the current
eight-sprite source needs the user-flash blocks.

## Colour demo (`D16D`)

The user-flash build carries a separate demo block at PSRAM `0x4E00`
(`CS=0x04A0`), in the gap between the BIOS code (ends at `0x4D2F`) and the
Forth stacks (`0x5800`), inside the same 24K flat image and CRC as the kernel.
Type `gfx` at the Forth prompt:

* the demo fills the 128-tile sprite bank with eight colour-phase patterns,
* paints a diagonal `#` field in the 82x26 tilemap,
* runs eight 32x32 sprites in a wave with `scroll_x`/`scroll_y` moving,
* returns on any UART key.

The BIOS function 6 owns the transition. It parks the Forth's `R5` (`>IN`) and
`R6` (TIB), checks the `0x0D16` header at `0x4E00` (`DS=0x04A0`, offset
`0x400`), jumps to entry `0x404` in the same segment, and on return clears the
tilemap, homes the scroll/cursor, disables all OAM slots, resets the kernel's
`tile_row`/`tile_off`/`tile_col`/`out_col` cells and `RETI`s. The interpreter
then prints ` ok` at the top-left; the UART host sees the same output.

The runtime dictionary stays at PSRAM `0x6000`; the demo at `0x4E00` is below
it and does not move it. The 24K flat image and the proven 12,352-word /
25-page installer are unchanged from the plain console; only the demo words
at `0x4E00` are added. The 16-block packed BSRAM image is built without D16D
(the gfx additions take the tile kernel over the budget); the demo lives only
in the user-flash image.

```
npm run synth:tile   # 24K D16D image + tile .fs + 608 Kbit image.flash.bin
npm run flash:tile   # openFPGALoader -f <tile.fs> --user-flash <image.flash.bin>
# power-cycle
```

The user image is the standard 12,352-word / 25-page image, unchanged from the
plain console; `npm run installer:tile` remains the fallback that writes it via
`openFPGALoader -m fpga/gowin/impl/pnr/deep16_installer.fs` (LED1 steady =
PASS). The `.fs` is the tile configuration (external SPI config flash); the
`image.flash.bin` is the full 77,824-byte (608 Kbit) on-die user-flash image
from the same build. The Gowin Programmer GUI is an alternative, not the tested
route: the `.fs` in External Flash Mode, the same `image.flash.bin` in User
Flash Initialization.

## Font

`font8x15.hex` is the **Nixedsys** 8x15 bitmap font
(github.com/ntwk/nixedsys-font), generated from its BDF by
`scripts/bdf_to_font.mjs`. Two rows share one 16-bit word; the low byte is the
even row, the high byte the odd row, MSB leftmost. 96 glyphs (0x20..0x7F), 8
words per glyph. It was chosen for its Fixedsys look; see `FONT-NOTICE.md` for
its (non-commercial) provenance. The public-domain `font8x8`-derived font is
still available from the converter's description and can be substituted at any
time.

Any 8x15 BDF can replace it:

```
node scripts/bdf_to_font.mjs font.bdf rtl/dvi/font8x15.hex
npm run synth:gowin
```

The converter centres a shorter bitmap vertically. A good candidate is
`ntwk/nixedsys-font` (8x15, 384 glyphs, 96 printable ASCII), but that repository
has **no licence file** (GitHub reports `license: null`), so it should not be
committed here without the author's permission. `scripts/bdf_to_font.mjs` only
converts a file it is given; the licence stays the caller's responsibility.
