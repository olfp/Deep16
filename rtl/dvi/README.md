# DVI / HDMI output — black-and-white text

Status: **implemented and simulated; board confirmation pending.**

The D16MINI console has always been the UART. This directory adds a second
console: a hardware mirror of the terminal on the Tang Nano 9K's HDMI connector,
80 x 24 cells of 8 x 15 pixels in 640 x 480 @ 60, black on white (white on
black, actually) with a blinking block cursor. The CPU and kernel are untouched;
the screen listens to the same `uart_txd` pin the USB-UART bridge sees.

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

`tmds_encoder` is the HDMI 5.4 algorithm evaluated combinationally and
registered once; at 25.2 MHz the combinational path is not a concern. It was
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

## Fit (with the packed image and the two-word PSRAM burst)

```
Logic 8,173/8,640 (95%)   CLS 4,211/4,320 (98%)
Registers 2,577/6,771     BSRAM 20/26 (16 image + 2 cache + 2 DVI)
rPLL 2/2                  0 TNS on every clocked domain
```

The margin is tight: 109 CLS. Any further logic needs an area trade first (the
colour mode in `VIDEO.md` estimates 6 BSRAM blocks and more CLS, so it will not
fit alongside this without a diet).

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
