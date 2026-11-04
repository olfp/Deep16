---
type: hardware-platform
title: FPGA Board Builds
description: The two current Tang Nano 9K machines, how ifdefs compose them, how they are clocked, pinned, built and flashed with the boot image and game slices, and what the dated resource numbers mean.
tags: [fpga, gowin, tang-nano-9k, board, d16mini, d16nano, psram, dvi, slices]
sources:
  - id: openwiki-source-ea70eb6c045047448e446296
    resource: repo://.gitignore
  - id: openwiki-source-86589e93590a1eca60d19cd0
    resource: repo://ERRPLAN.md
  - id: openwiki-source-d0e982a035b1f375bd12ec29
    resource: repo://fpga/gowin/build_tile_flash.tcl
  - id: openwiki-source-6d46228b403a03a9b6b49db0
    resource: repo://fpga/gowin/d16mini.sv
  - id: openwiki-source-e46a8d11a93dc4cb41dbd0c7
    resource: repo://fpga/gowin/d16tile_flash.sv
  - id: openwiki-source-02ca194d57796e6a2db00cb9
    resource: repo://fpga/gowin/deep16_board_tile_flash.gprj
  - id: openwiki-source-370c4e69559fb2fb493422ed
    resource: repo://HARDWARE.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-cbffc6339149dbea2f046205
    resource: repo://rtl/deep16_board_tile.sdc
  - id: openwiki-source-10121f209c268e2bcf7976c9
    resource: repo://rtl/deep16_board.cst
  - id: openwiki-source-bf2a0339ada6a56de8b7a79c
    resource: repo://rtl/deep16_board.sv
  - id: openwiki-source-de73cd8815fd05f54317660e
    resource: repo://rtl/deep16_top.sv
  - id: openwiki-source-2f8a040dcce7a74f3dd3ca04
    resource: repo://rtl/dvi/dvi_tile.sv
  - id: openwiki-source-d6e77d8e641bba2c4fc6f8e4
    resource: repo://scripts/build_gowin_tile_flash.sh
  - id: openwiki-source-da0fe35253069a3157d15bab
    resource: repo://scripts/flash_gowin_tile_flash.sh
  - id: openwiki-source-41517f64370d769c203d48a3
    resource: repo://scripts/make_slices.mjs
generated: { by: "opencode", at: "2026-11-04T15:30:01.509Z" }
verified:
  - by: openwiki/0.7.3
    at: 2026-11-04T15:30:01.509Z
---

# FPGA Board Builds

The FPGA target is a Sipeed **Tang Nano 9K** (GW1NR-9C). One wrapper,
`rtl/deep16_board.sv`, is synthesised into two current machines:

- **D16MINI** — the RTL core at 13.5 MHz, PSRAM as main memory, UART console,
  and a black-and-white DVI mirror of that console.
- **D16nano tile** ("FiT" graphics) — the reduced `core3` at 6.75 MHz with the
  tile/sprite renderer, PS/2 keyboard, timer, SPI/SD, I2S and the interrupt
  controller, booting from configuration flash into a segmented memory map.

Both are the same wrapper plus different macros. The interesting engineering is
in what those macros change: clock, core, memory backing, display path, and
peripheral set.

## Composition by ifdef

Gowin synthesis has no command-line define option, so each build carries a
one-file define header that must be the **first** entry in the project file
list. Gowin parses the list as a single compilation unit, so the `define`s in
that first file are visible to every file after it.

| Build | Define file | Macros |
|---|---|---|
| D16MINI text | `fpga/gowin/d16mini.sv` | `D16MINI`, `PSRAM`, `DVI` |
| D16nano tile, config flash | `fpga/gowin/d16tile_flash.sv` | `GOWIN`, `D16MINI`, `PSRAM`, `DVI`, `DVI_TILE`, `USER_FLASH`, `D16NANO`, `D16_PERIPH`, `D16SEG` |

`D16MINI` selects the board-shaped `deep16_top` (shrunk memory array and full
window decode). `PSRAM` adds the HyperRAM controller and changes the boot path.
`DVI` instantiates the DVI PLL and output serializer; `DVI_TILE` swaps the text
mirror for `dvi_tile`. `D16NANO` selects `core3` and the /4 clock.
`D16_PERIPH` instantiates the SPI, I2S and SIC blocks. `D16SEG` selects the
segmented boot/loader map. `USER_FLASH` makes the loader read the boot image
from configuration flash over the shared SPI master.

The D16D showcase is not an RTL macro: it is an assembler/image tag. The tile
image is built with `D16NANO=1 D16D=1 D16SEG=1`, and the browser IDE's Tiles
mode mirrors that builder. Pac-Man is no longer baked into the image; it is a
type-4 binary slice in the slice area.

## Only one Gowin project is live

`fpga/gowin/` still contains `build.tcl`, `build_flash.tcl` and `build_tile.tcl`,
but the only project file present is `deep16_board_tile_flash.gprj`. The live
path is:

```
npm run synth:tile
  → scripts/build_gowin_tile_flash.sh
  → fpga/gowin/build_tile_flash.tcl
  → fpga/gowin/deep16_board_tile_flash.gprj
```

The 24K BSRAM builds that baked the kernel into block RAM (`synth:board`,
`synth:flash`, `synth:tile:packed`) and their simulations are retired; the
preserved machine is tag `v0.13.5mhz`. Treat references to those scripts in
older text as history, not as runnable targets.

## Clocking

| Domain | Frequency | Source |
|---|---|---|
| Oscillator | 27 MHz | pin 52 |
| Standard CPU | 13.5 MHz | 27 MHz / 2 |
| `core3` CPU | 6.75 MHz | 27 MHz / 4 |
| PSRAM controller | 51 MHz | `psram_pll`, 90° companion clock |
| DVI text | 25.2 MHz pixel / 126 MHz serial | `dvi_pll` |
| DVI tile | 74.25 MHz pixel / 371.25 MHz serial | `dvi_pll` |
| Tile render | 24.75 MHz | DVI PLL / 15 |

The divisor is a two-bit counter on the raw oscillator, so the whole machine is
either 13.5 MHz or 6.75 MHz. The constraint file declares the 27 MHz source,
the divided CPU clock, the 51 MHz PSRAM clock and the two DVI clocks, and marks
the PSRAM and render/pixel groups asynchronous because those boundaries are
request/ack or two-flop synchroniser crossings.

Reset is the S1 button, asynchronous and active low. It is registered into the
CPU clock domain and held for 16 CPU cycles after release so the pipeline starts
settled; the DVI domain gets its own deassert held until its PLL locks.

## Pinout and I/O

`rtl/deep16_board.cst` is the pin constraint file. The header warns that the
values are documented board pinout, not measured on hardware.

| Signal | Pin(s) | Notes |
|---|---|---|
| `clk` | 52 | 27 MHz oscillator, LVCMOS33, pull-up |
| `rst_n`, `btn` | 4, 3 | Bank 3 buttons; no `IO_TYPE` because the bank VCCIO is fixed at 1.8 V |
| `uart_txd`, `uart_rxd` | 17, 18 | on-board USB-UART bridge |
| `ps2_clk`, `ps2_data` | 76, 77 | 3.3 V side of an external 5 V level shifter; inputs only |
| `spi_sck/mosi/cs_n/miso` | 36–39 | microSD socket |
| `cfg_sck/mosi/miso/cs_n` | 59–62 | configuration flash on MSPI pins, reused as GPIO after DONE |
| `i2s_bclk/lrclk/din` | 25, 26, 27 | J5 pins 5–7 |
| `hdmi_tx_p/n` | 69–75 | four TMDS pairs: blue, green, red, clock |
| HyperRAM pads | dedicated | `O_psram_*`, `IO_psram_dq`, `IO_psram_rwds` |

The MSPI pins need `-use_mspi_as_gpio 1` in the project options; without it the
design cannot drive the configuration flash after configuration.

## Memory and console

`deep16_top` has two memory shapes. The simulation build keeps the full
1,048,576-word array. The `D16MINI` build shrinks it to block RAM: 24,576 words
without PSRAM, or 16,384 words for the packed image when PSRAM is present. The
array is read unconditionally and the ROM/fill mux sits behind the read
register, because folding the decode into the read makes the vendor flow infer
LUT RAM instead of block RAM.

On the PSRAM build the CPU window is 1M words backed by a 4 MB HyperRAM die via
an open-source controller at 51 MHz with `LATENCY=3`. Writes are single-word and
write-through; the memory block's own 512 × 2-word cache is described on the
[PSRAM page](psram-cache-and-flash.md).

The console is the on-board USB-UART at 115200 8N1. The FPGA pin is
synchronised and feeds a 64-byte receive FIFO. The PS/2 receiver produces ASCII
and drives **both** the UART receive FIFO and the architectural keyboard FIFO at
`0xF0060`/`0xF0062`; each build's software reads only one door, so a key is not
consumed twice.

## Display paths

With `DVI` but not `DVI_TILE`, `dvi_text` listens to `uart_txd` — the same
signal the USB bridge sees — and renders an 80 × 24 cell image as 640 × 480
black-and-white DVI. It parses the kernel's ANSI output, scrolls with a circular
row offset and draws a block cursor. It costs two BSRAM blocks and no CPU time.

With `DVI_TILE`, the display is the FiT renderer instead. CPU writes to tile
memory, control registers and sprites cross into the 24.75 MHz render domain
through a 16-entry gray-code asynchronous FIFO. A full FIFO drops an entry,
which is a renderer glitch rather than memory corruption: the PSRAM/Forth mirror
of the same address is written by the store regardless. A raster toggle comes
back through a two-flop synchroniser and an edge detect to become SIC bit 3;
the same synchronised toggle is shown on LED5.

## SPI sharing

One SPI master serves both the microSD socket and the configuration flash; there
are two pin sets and a mux keyed on chip select 1. While the boot loader runs,
`USER_FLASH` routes the register accesses to the loader instead of the CPU. The
text build instantiates no SPI master and parks every SPI and config pin idle.

## Build and flash flow

```sh
npm run synth:tile   # D16D image + bitstream
npm run flash:tile   # bitstream, 1 MB boot image, source and game slices
```

`npm run synth:tile` first regenerates the D16D/D16nano/D16SEG image, then runs
Gowin synthesis and place-and-route through `gw_sh`, writing
`deep16_board_tile_flash.fs` and `artifacts/image/image.flash.bin`.

`npm run flash:tile` regenerates the same image again, writes the bitstream with
`openFPGALoader -f`, the boot image with `--external-flash -o 0x100000`, reads it
back and compares before writing the slices at `0x200000`. The slice image is
built by `scripts/make_slices.mjs`; it holds the SD/hello/catalog/games sources
and the Pac-Man type-4 binary at slice 10. The chip's block protect
(`BP = 0x38`) is **not** cleared by `--unprotect-flash`, so a protected board
silently drops the 1 MB write and reports Done; run `cf-unprotect` on the board
before the host flash and `cf-protect` afterwards. The slices go last so the
earlier writes cannot disturb them.

`flash:tile` writes whatever `.fs` sits in `fpga/gowin/impl/pnr/`, so the
bitstream has to be rebuilt with `synth:tile` whenever the RTL changes. A
bitstream older than the RTL boots and runs, but silently lacks the change: the
2026-11-04 raster work was tested against a `.fs` written two minutes before the
edge-detector commit, which is why the board kept behaving like the old level
request. Check the `.fs` timestamp against the RTL commit before trusting a
board measurement.

The console read is non-blocking, so the raster and timer IRQs are serviced
while the kernel waits for input. The raster path is board-verified end to end:
`dvi_tile` raises one request per compare-line visit on the rising edge of the
match, the handler acknowledges the tile engine before clearing the SIC bit,
and one OAM slot therefore draws two sprites (one above line B, one inside the
band). The visible split and the sprite multiplexer were both demonstrated on
the board on 2026-11-04; a control-register band has not been re-tested since
the handler was changed to write OAM instead.

## Resource numbers are dated measurements

Two sets of figures appear in the repository, and both are snapshots rather than
guarantees:

- The archived packed BSRAM build: Logic 8,173 / 8,640 (95 %), CLS
  4,211 / 4,320 (98 %), registers 2,577 / 6,771, BSRAM 20/26 (16 packed image,
  2 cache, 2 screen), 0 TNS.
- The current tile baseline after the 64-OAM / 8-palette-set change:
  **4,260 / 4,320 CLS (60 free)**, BSRAM 26/26, SSRAM 214, registers 2,838;
  `dvi_render` 32.886 MHz, `dvi_pixel` 86.108 MHz, `psram_clk` 86.388 MHz,
  `clk_cpu` 20.246 MHz, all TNS 0, with one generated-clock hold endpoint
  flagged on `main` too.
- The same build after the raster rising-edge detector: **4,298 / 4,320 CLS
  (22 free)**, registers 2,844. The one flop and its fan-out cost 38 CLS, so
  the renderer/raster area is nearly exhausted.

The board is close to full on logic and CLS. Any change to the renderer,
peripherals or loader is an area decision first and a feature decision second.
Re-measure after a synthesis run instead of quoting either line.

## Status LEDs

All LEDs are active low. On PSRAM builds, `led[0]` is the loader heartbeat (slow
when done, fast while loading) unless `o_boot_err` is set; `led[1]` is core busy.
In the tile build `led[2]` blinks with the 24.75 MHz render clock, `led[3]` is
DVI PLL lock, `led[4]` is the scan path started and `led[5]` shows the
synchronised raster toggle. The text build keeps `led[2..5]` on core halt and
retiring-instruction bits.

## Related pages

- [PSRAM, Cache and Flash Boot](psram-cache-and-flash.md)
- [Video and Peripherals](video-and-peripherals.md)
- [Memory Map and Memory Model](../architecture/memory-map-and-memory-model.md)
- [D16D Showcase, Flappy and Pac-Man](../software/showcase-games.md)
- [RTL Core Microarchitecture](../cores/rtl-core.md)
