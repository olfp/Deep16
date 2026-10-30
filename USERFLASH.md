# Config-flash boot (1 MB) and the installer fallback

Status: **the tile build boots the 24K image from the on-board config flash at
`0x100000`.** The on-die 608 Kbit FLASH608K is no longer used by the tile
build; it remains only for the one-time installer fallback below.

## Flash layout

| Byte range | Contents | Protection |
|---|---|---|
| `0x000000`–`0x0FFFFF` | FPGA configuration (the `.fs` bitstream) | BP = `0x38` |
| `0x100000`–`0x112FFF` | boot image: 64-word header + the 24K flat image | BP = `0x38` |
| `0x200000`–`0x3FFFFF` | source slices, 4 KB each (`0x200000 + n*0x1000`) | writable |

`BP = 0x38` protects the lower 2 MB (bitstream and boot image). The slices sit
above it, so `cf-erase`/slice writes cannot corrupt the boot. Run
`cf-unprotect` on the board first (the host `--unprotect-flash` does not clear
this P25Q32H's BP); `npm run flash:tile` then writes all three regions, and
the boot script's `cf-protect` re-arms the guard.

## Boot image

| Item | Value |
|---|---|
| Size | 76 KB = 608 Kbit = `0x13000` bytes |
| Header | 8 × 32-bit words at image words 0..7 |
| Header fields | magic `'D16F'` `0x44313646`, format 1, image length 24,576 words, CRC-16/CCITT-FALSE, build id, reserved |
| Flat image | image words 64..12,351; two 16-bit CPU words per 32-bit flash word |
| Transport | mode-0 SPI `0x03` reads through the shared SPI master |

`scripts/make_image.mjs` writes:

- `image.flash.hex`: the 12,352 32-bit words the installer writes (header +
  flat image), one 32-bit word per line.
- `image.flash.bin`: the same words as the full 76 KB boot image, little-endian
  and `0xFF`-padded. `npm run flash:tile` writes it at config-flash `0x100000`.

## Boot loader

`rtl/flash/flash_boot.sv` runs after the PSRAM controller's power-on init:

1. read the 8-word header through `boot_spi_read` and check
   magic/format/length;
2. copy 12,288 32-bit words as 24,576 PSRAM words while computing CRC-16;
3. copy the D16SEG data and BIOS blocks into PSRAM `0x10000`/`0x30000`;
4. compare the CRC; a bad header or CRC sets `boot_err` and holds the core
   (heartbeat steady, nothing boots);
5. hand the entry word (`0x0100`) to the cache path and release the core.

`boot_spi_read` drives the same `deep16_spi` master the CPU uses, while the
core is held in reset. One word is command `0x03`, a 24-bit address and four
data bytes; at DIV=0 (3.375 MHz SCK) the 12,352-word image takes about
**0.37 s** in the Verilator boot test. The on-die loader took about 0.18 s; the
extra ~0.2 s buys 15 CLS by deleting the 68-LUT on-die read controller and the
FLASH608K primitive.

## Slices in the config flash

The upper 2 MB holds the source/slice image at `0x200000` (sectors 512+):

```sh
npm run flash:slices       # node scripts/make_slices.mjs + openFPGALoader
# openFPGALoader -f --external-flash --file-type bin \
#   -o 0x200000 artifacts/image/slices.bin
```

The current image is 9 slices / 36 KB: directory 0, SD driver 1–3, hello 4,
catalog 5–8 (editor, `dir`/`find`, `p-screen`, I2S, IRQ and palette words). The boot
script loads the SD driver and the catalog before the prompt, so `sd`, `dir`,
`find`, `beep`, `irq-on` and `4 screen` are available at power-on.

The boot script's `cf-protect` sets BP = `0x38` after boot, so every later
`npm run flash:tile` must start with `cf-unprotect` on the board. The script
verifies the `0x100000` image after writing and aborts with that instruction if
the write was dropped.

## Flash (tested)

```sh
cd /Users/olf/Projects/Trae/Deep16/Deep16

npm run synth:tile         # .fs + image.flash.bin

# On the board, at the Forth console:
#   cf-unprotect
#   cf-status hex . decimal      \ must read 0
#
# openFPGALoader --unprotect-flash does NOT clear this P25Q32H's BP; the raw
# boot-image write at 0x100000 is silently dropped while BP = 0x38.
npm run flash:tile         # .fs + boot image at 0x100000 + slices at 0x200000
# power-cycle, then cf-protect -> 38
```

What `flash:tile` runs:

```sh
openFPGALoader --unprotect-flash -f fpga/gowin/impl/pnr/deep16_board_tile_flash.fs
openFPGALoader -f --external-flash --file-type bin \
  -o 0x100000 artifacts/image/image.flash.bin
openFPGALoader -f --external-flash --file-type bin \
  -o 0x200000 artifacts/image/slices.bin
```

| Flag | Region | Persistent |
|---|---|---|
| `-m` | FPGA SRAM | no (runs until power-off) |
| `-f <build>.fs` | FPGA configuration at 0 | **yes** |
| `-o 0x100000 image.flash.bin` | boot image | **yes** |
| `-o 0x200000 slices.bin` | source slices | **yes** |
| `programmer_cli --run 13` | external config flash (Gowin CLI path) | yes, but openFPGALoader is the tested route |

## Installer fallback (on-die FLASH608K)

`rtl/flash/flash_installer.sv` is a standalone top with the `image.flash.hex`
ROM. It has no CPU and no PSRAM: it erases the pages it needs, programs the
image (12,352 words) and compares all of them. LEDs are active low: 0 blinks
while working, 1 steady = PASS, 2 steady = FAIL.

```sh
openFPGALoader -m fpga/gowin/impl/pnr/deep16_installer.fs   # LED1 steady = PASS
```

The Gowin Programmer GUI is an alternative, not the tested route. Do **not**
write the 444 KB tile bitstream into the 608 Kbit user flash: it does not fit.

## D16D tile image

The tile build uses the same 24K flat image as the console, but `D16SEG`
scatters it: `CS=0` flat code, `DS=0x1000` data and dictionary (base `0x5800`),
`SS=0x2000` stack, and `CS=0x3000` for the BIOS/demo copied from image
`0x4A00..0x57FF`. The flat image is 48 KB; the rest of the 76 KB boot image is
`0xFF`.

## Simulation

```sh
npm run sim:flashboot   # full loader: header, CRC, flat/DS/BIOS copies
npm run sim:bootspi     # 0x03 reader through the real SPI master
npm run sim:installer   # on-die installer fallback
```

`sim:flashboot` preloads `image.flash.hex`, answers the SPI reads, models the
PSRAM writes and checks the entry word, the flat image and both D16SEG copies.

## Fit

| Build | BSRAM | CLS | Logic |
|---|---:|---:|---:|
| **tile config-flash + D16D (29 Oct 2026)** | **24/26** | **4,279/4,320** | **8,435/8,640** |
| installer (one-time) | 26/26 | 3,445/4,320 | 6,679/8,640 |

The boot move freed **15 CLS** over the 4,294/4,320 timer build: the on-die
read controller and the FLASH608K primitive are gone, and the loader reuses the
SPI master. **41 CLS free** remain.

## Files

```
rtl/flash/boot_spi_read.sv       config-flash 0x03 reader (shares the SPI master)
rtl/flash/flash_boot.sv          boot copy + CRC + D16SEG scatter
rtl/flash/flash608k_ctrl.sv      on-die installer read/program/erase
rtl/flash/flash_installer.sv     one-time installer top
rtl/sim/flash_boot_tb.sv         full loader + PSRAM write model
rtl/sim/boot_spi_tb.sv           reader + SPI master + flash model
scripts/flash_gowin_tile_flash.sh config + boot image + slices
artifacts/image/image.flash.hex  installer ROM, 12,352 32-bit words
artifacts/image/image.flash.bin  76 KB boot image for 0x100000
```

## If the board looks dead

The FPGA is not bricked by this design. Recover with the same one-command, or
with JTAG:

```sh
openFPGALoader --detect                       # should show GW1N(R)-9C
openFPGALoader -m fpga/gowin/impl/pnr/deep16_board_tile_flash.fs  # tile in SRAM
npm run flash:tile                                               # persist all three
```

The build holds the core on a bad header/CRC (LED0 steady lit), so no UART and
no DVI is expected — that is not a brick. If the config flash was overwritten,
run the installer fallback above (LED1 steady = PASS).

## HDMI +5V caveat (observed on the board)

With the monitor connected, the board's power LED went out; unplugging HDMI
restored it. The monitor is loading or back-feeding the HDMI +5V pin, which is
independent of this RTL. Use USB power, try another monitor/cable or an HDMI
cable with the +5V wire removed, and unplug HDMI first if the power LED drops.
