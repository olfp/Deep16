---
type: "Reference"
title: "Video and Peripherals"
openwiki_generated: true
verified:
  - by: openwiki/0.7.2
    at: 2026-11-01T09:36:37.731Z
sources:
  - id: openwiki-source-a28946850ce54d03e71935f2
    resource: repo://asm/forth_nano.asm
  - id: openwiki-source-b57ab1606c48ec3ea7344623
    resource: repo://MEMMAP.md
  - id: openwiki-source-10121f209c268e2bcf7976c9
    resource: repo://rtl/deep16_board.cst
  - id: openwiki-source-bf2a0339ada6a56de8b7a79c
    resource: repo://rtl/deep16_board.sv
  - id: openwiki-source-6df23aa962f11ba40014c90a
    resource: repo://rtl/deep16_core3.sv
  - id: openwiki-source-12362f149a825ecbda9614f2
    resource: repo://rtl/deep16_i2s.sv
  - id: openwiki-source-779a6281faa33512e4845cb6
    resource: repo://rtl/deep16_sic.sv
  - id: openwiki-source-95286e137f58528ddfb9984d
    resource: repo://rtl/deep16_spi.sv
  - id: openwiki-source-708b1ebb352e175426b11b79
    resource: repo://rtl/deep16_timer.sv
  - id: openwiki-source-de73cd8815fd05f54317660e
    resource: repo://rtl/deep16_top.sv
  - id: openwiki-source-6a76c8a50a08a606b2724b3c
    resource: repo://rtl/deep16_uart.sv
  - id: openwiki-source-88b220d3f01731ffaa0ed8e2
    resource: repo://rtl/dvi/dvi_text.sv
  - id: openwiki-source-2f8a040dcce7a74f3dd3ca04
    resource: repo://rtl/dvi/dvi_tile.sv
  - id: openwiki-source-0f5d192ee0a4e0e00eacca5f
    resource: repo://rtl/ps2_rx.sv
generated: { by: "opencode", at: "2026-11-01T09:36:37.731Z" }
---


# Video and Peripherals

The D16nano build is a small games machine: a tile/sprite display, a PS/2
keyboard, a timer, an SD card and audio. The D16MINI build keeps only the
console path and a DVI mirror of it.

Every device is memory-mapped in the `0xFxxxx` window. Software reaches it with
ordinary loads and stores under `ES = 0xF000`, so the Forth kernel uses `es@` and
`es!` and the BIOS needs no I/O instructions.

## Console mirror (`DVI`, text build)

`rtl/dvi/dvi_text.sv` is not a framebuffer. It listens to the CPU's `uart_txd`
line — the same signal the USB bridge sees — and maintains an 80 × 24 character
image from the 115200 8N1 stream.

- 8 × 15 cells give 640 × 360, centred vertically in 640 × 480 @ 60 Hz with 60
  lines of border above and below.
- The parser handles CR, LF, BS, printable ASCII, `ESC[H`, `ESC[r;cH`,
  `ESC[2J`/`3J`, `ESC[K`, ignores SGR, and treats the `?1049` alternate-screen
  requests as clear-and-home.
- Scrolling is deferred to vertical blanking, where the renderer is idle.
- Cost: 960 words of cell image (two characters per word) and a 768-word font,
  two BSRAM blocks total, no PSRAM traffic and no CPU time.

Because it mirrors the UART rather than the CPU's tilemap, the mirror works with
any software that prints, including a host terminal session.

## Graphics (`DVI_TILE`, D16nano)

`rtl/dvi/dvi_tile.sv` renders 80 × 24 cells at 24.75 MHz into two line buffers
and scans them out as 1280 × 720 @ 60 Hz. While line *N* is displayed, line
*N+1* is built from the tilemap and tile bank, so a palette lookup cannot stall
the scan.

Memory windows are one 4K-word page each, and the CPU write path is
write-through to the renderer and to the PSRAM/Forth mirror of the same address.

| Window | Contents |
|---|---|
| `0xF1000`–`0xF1853` | 82 × 26 tilemap: 80 × 24 visible plus a one-tile margin on each side; two banks |
| `0xF2000` | control 0: cursor `{row, col, enable}` |
| `0xF2002` | control 1: 26-row circular row offset |
| `0xF2004` | control 2: `scroll_x` 0..15, latched at the frame boundary |
| `0xF2006` | control 3: `scroll_y` 0..30 |
| `0xF2008` | control 4: bit 0 write bank, bit 1 display bank |
| `0xF200A` | control 5: sprite write page (Red / Purple / Yellow) |
| `0xF200C` | control 6: per-row fine scroll `{en, row, fine}` |
| `0xF200E` | control 7: raster line compare 0..359 |
| `0xF3000`–`0xF3BFF` | tile bank: 96 of 128 tiles × 32 words |
| `0xF4000`–`0xF47FF` | sprite bank: 8 groups × 16 patterns × 16 words per write page |
| `0xF5000`–`0xF500F` | OAM: 8 sprites × 2 words |
| `0xF5080`–`0xF50AF` | text, art and sprite palettes |

A tile cell carries a mode bit. Mode 0 is an art cell whose low 12 bits are a
32-word-aligned tile address; mode 1 is a text cell encoding a palette pair,
style and glyph, `0x8000 | (pair << 12) | style | ((ch - 0x20) * 32)`. Style
bits select underline, bold smear and the italic font page. Sprites are 32 × 32
(16 8 × 8 tiles), with OAM priority, flip bits and a signed x that lets a sprite
clip at the left edge.

`doc/FiT-Graphics-howto.md` is the programming guide, including the tile-cell
arithmetic, scrolling behaviour, row scrolling and sprite composition.

The renderer costs about seven BSRAM blocks: three for the tilemap, three for
the tile bank and one for the line buffer; the palette is distributed logic.

## Keyboard input

Two doors see the same keystroke:

- the architectural FIFO at `0xF0060` (status) / `0xF0062` (data), 16 entries,
  polled by the CPU;
- the UART receive FIFO, which is what the D16nano BIOS and boot script actually
  poll.

`rtl/ps2_rx.sv` decodes PS/2 Set-2 frames — start bit, eight data bits LSB
first, odd parity, stop — sampling on the falling edge of the synchronised PS/2
clock. It tracks break (`0xF0`), extended (`0xE0`), Shift/Ctrl/Alt/Caps, and
looks the ASCII up in a 2048 × 8 BSRAM table addressed by
`{ctrl, caps, shift, scan_code}`, generated by `scripts/make_ps2map.mjs`.
Extended keys are deliberately unmapped for now because their make codes
collide with the numeric keypad. A bad frame is dropped and raises a sticky
frame error.

The board pushes each decoded ASCII byte into both FIFOs. Each build's software
reads only one, so a key is not consumed twice.

## Timing

`rtl/deep16_timer.sv` at `0xF0020` is a 32-bit millisecond counter with a 32-bit
compare, a sticky match flag and a 15 kHz tick that drives SIC source bit 1.

| Address | Meaning |
|---|---|
| `0xF0020` | control: b0 enable, b1 clear match, b2 IRQ enable |
| `0xF0022` / `0xF0024` | millisecond value, low / high |
| `0xF0026` / `0xF0028` | compare, low / high |
| `0xF002A` | status: b0 match, b1 enabled, b2 IRQ enable |

The counter is enabled out of reset with its compare at `0xFFFFFFFF`, so a fresh
machine never matches until software programs it. At 6.75 MHz the prescaler is
6750 cycles and the 32-bit count wraps after about 49.7 days.

The D16nano build also exposes a read-only 32-bit CPU cycle counter at
`0xF0068`/`0xF006A` and a status word at `0xF0066`: bit 0 vertical blank and bit
1 frame toggle (both synchronised from the pixel domain), bit 2 the S2 button and
bit 3 the UART RX-ready level. The cycle counter is the benchmark time base.

Note that the timer's own IRQ-enable bit is stored but not used by the SIC: the
SIC enable mask selects sources, and the tick is wired to bit 1 unconditionally.

## Storage

`rtl/deep16_spi.sv` at `0xF0080` is a byte-wide mode-0 master, MSB first, with
two active-low chip selects:

| Address | Meaning |
|---|---|
| `0xF0080` | control: bits 1:0 chip selects (1 = asserted; CS0 SD, CS1 config flash) |
| `0xF0082` | status: b0 busy, b1 done, bits 3:2 chip selects |
| `0xF0084` | write a byte to start a transfer; read the byte received last |
| `0xF0086` | half-period divider: SCK = CPU clock / (2 × (DIV + 1)) |

`DIV` resets to 0 (3.375 MHz on a 6.75 MHz CPU); software writes 8 for the
~375 kHz SD initialisation clock. One master serves the microSD socket and the
configuration flash through a board-level pin mux; the flash path is described on
the [PSRAM and flash page](psram-cache-and-flash.md).

The SD protocol lives entirely in software: the boot script bit-bangs CMD0,
CMD8, CMD55/ACMD41, CMD58 and CMD16 to identify the card, then CMD17/CMD24 for
one 512-byte sector at a time.

## Audio

`rtl/deep16_i2s.sv` at `0xF00A0` drives a MAX98357A-style I2S DAC directly:

| Address | Meaning |
|---|---|
| `0xF00A0` | write a signed 16-bit sample; read the FIFO level (0..128) |
| `0xF00A2` | control: b0 enable, b1 reset, b2 loop, b3 IRQ enable |
| `0xF00A4` | status: b0 empty, b1 full, b2 low, b3 underrun, b4 running, b5 IRQ |

BCLK is the CPU clock / 10 (675 kHz) and LRCLK is BCLK / 32 (21.09 kHz) on the
6.75 MHz part. The right channel repeats the left sample, so output is mono. The
FIFO is 128 samples; the IRQ fires when the level falls to 32 or below.

## Interrupts

`rtl/deep16_sic.sv` at `0xF00B0` aggregates four sources into one level IRQ
into `core3`.

| Address | Meaning |
|---|---|
| `0xF00B0` | pending: b3 raster, b2 audio, b1 timer, b0 keyboard; write 1 clears |
| `0xF00B2` | enable mask |
| `0xF00B4` | status: b0 IRQ level, b1 any pending |
| `0xF00B6` | 16-bit scratch counter for the handler |
| `0xF00B8` | 16-bit raster counter |

The IRQ is `pending & enable`. There is no priority encoder in hardware: the
handler clears the serviced bit and returns, so any still-pending bit re-enters
after `RETI`. The documented order (raster, audio, timer, keyboard) is a
software convention, not a circuit. Level sources re-latch while still active;
pulse sources stay pending until written one to clear.

The vector cell is 1: `core3` takes the interrupt target from physical address
1, which is a different cell from the SWI vector at 2, and the kernel installs
`irq_handler` there.

Only the timer tick is actually wired. The instantiation passes
`{raster_src, 1'b0, timer_tick, 1'b0}`, so the audio and keyboard bits are
constant zero, and `raster_src` is guarded by `` `D16_NANO `` — a macro that no
project file defines (the builds define `` `D16NANO ``). The raster bit is
therefore dead in every shipped build, and the I2S `fifo_irq` output is left
unconnected. In practice there is one interrupt source: the 15 kHz timer.

## Documentation drift

`MEMMAP.md` is mostly accurate here, but two passages predate the current board:

- It says the on-board configuration flash "is not used" and that CS1 is pin 25.
  The tile build now boots from that flash at `0x100000`, and pin 25 is the I2S
  BCLK; the flash is on MSPI pins 59–62.
- The UART divisor note calls 234 "the 27 MHz value". The RTL derives the
  divisor from `CLK_HZ / BAUD`, which is 117 at 13.5 MHz and 59 at 6.75 MHz; 234
  is only right for a 27 MHz CPU clock.

Check the RTL register decode and the pin constraints before trusting either.

## Related pages

- [FPGA Board Builds](board-builds.md)
- [PSRAM, Cache and Flash Boot](psram-cache-and-flash.md)
- [Console, Terminal and Boot Scripts](../software/bios-and-console.md)
- [Memory Map and Memory Model](../architecture/memory-map-and-memory-model.md)
