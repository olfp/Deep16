# User-flash boot loader

Status: **verified and persistent on the Tang Nano 9K.**

The tested one-command flash writes both halves of the machine: the **FPGA
configuration** (external config flash) and the **D16 kernel/user image** (the
on-die 608 Kbit FLASH608K). Both survive a power cycle.

## Slices in the config flash

The config flash's upper 2 MB holds the source/slice image at `0x200000`
(sectors 512+). It is separate from both the bitstream (lower 2 MB, BP = `38`)
and the on-die user flash:

```sh
npm run flash:slices       # node scripts/make_slices.mjs + openFPGALoader
# openFPGALoader -f --external-flash --file-type bin \
#   -o 0x200000 artifacts/image/slices.bin
```

The current image is 7 slices / 28 KB: directory 0, SD driver 1–3, hello 4,
catalog 5–6. The boot script loads the SD driver and the catalog before the
prompt, so `sd`, `dir`, `find` and `4 screen` are available at power-on. The
slice write leaves the bitstream untouched; `npm run flash:tile` writes the
configuration, the user image and the slices in one go.

## Flash (tested)

```sh
cd /Users/olf/Projects/Trae/Deep16/Deep16

# Tile build: 24K D16D image + tile .fs + the full 608 Kbit image.flash.bin
npm run synth:tile

# Write both halves, then power-cycle
npm run flash:tile
# equivalent:
# openFPGALoader -f fpga/gowin/impl/pnr/deep16_board_tile_flash.fs \
#   --user-flash artifacts/image/image.flash.bin
```

For the plain standard build:

```sh
npm run synth:tile      # the archived 24K flash build was `synth:flash`
npm run flash:flash
# openFPGALoader -f fpga/gowin/impl/pnr/deep16_board_flash.fs \
#   --user-flash artifacts/image/image.flash.bin
```

What the flags do:

| Flag | Region | Persistent |
|---|---|---|
| `-m` | FPGA SRAM | no (tile runs until power-off) |
| `-f <build>.fs` | FPGA configuration (external config flash) | **yes** |
| `--user-flash image.flash.bin` | on-die 608 Kbit FLASH608K user flash | **yes** |
| `-o 0x200000 slices.bin` | config-flash slice area (upper 2 MB) | **yes** |
| `programmer_cli --run 1` | FPGA SRAM | no |
| `programmer_cli --run 13` | external config flash (Gowin CLI path) | yes, but the openFPGALoader route is the tested one |

The explicit raw `--user-flash image.flash.bin` is the part that makes the 9K
persistent. The earlier note that `--user-flash` was LittleBee-only applied to
the `.fs`'s user-flash section and was wrong for this raw-file form. Passing
`-f` alone on a USER_FLASH `.fs` still writes the `.fs`'s user-flash section
rather than the raw image and does not give the tested result.

The `.fs` and `image.flash.bin` must come from the **same D16D build**.
`npm run synth:tile` builds the tile `.fs`; `npm run flash:tile` regenerates the
D16D `image.flash.bin`, checks the `.fs`, and runs the command above. A power
cycle then boots the tile console; `gfx` runs the demo.

The `deep16_installer.fs` remains the fallback for the user-flash half:

```sh
openFPGALoader -m fpga/gowin/impl/pnr/deep16_installer.fs   # LED1 steady = PASS
```

The Gowin Programmer GUI is an alternative, not the tested route: the
configuration is the `.fs` (External Flash Mode) and the user flash is the same
`image.flash.bin` (User Flash Initialization). Do **not** write the 444 KB tile
bitstream into the 608 Kbit user flash: it does not fit and overwrites the D16
kernel, which is why the installer had to be re-run.

## D16D tile demo

The tile build uses the same 24K flat image as the plain console, but `D16SEG`
scatters it: `CS=0` flat code, `DS=0x1000` data and dictionary (base `0x5800`),
`SS=0x2000` stack, and `CS=0x3000` for the BIOS/demo copied from image
`0x4A00..0x57FF`. The user image is the standard 12,352-word / 25-page image;
the source screens follow at page 25 (`0x3200`). `npm run synth:tile` generates the tile `.fs` and
`artifacts/image/image.flash.bin`; `npm run flash:tile` writes both; a power
cycle gives the tile console and `gfx`. `npm run installer:tile` remains the
installer fallback for the user-flash half.

## Image format

`scripts/make_image.mjs` writes:

- `image.flash.hex`: the 12,352 32-bit words the installer writes (header +
  the flat image), one 32-bit word per line.
- `image.flash.bin`: the full 608 Kbit (77,824-byte, `0x13000`) user-flash image
  for openFPGALoader `--user-flash` / the Gowin User Flash Initialization. The
  first 12,352 words match `image.flash.hex`; the remainder is `0xFF`.

`image.flash.hex` layout:

```
32-bit word 0..7   header
  0  magic 'D16F' (0x44313646)
  1  format 1
  2  image length in 16-bit words (24,576)
  3  CRC-16/CCITT-FALSE over the flat image
  4  build id (first 32 bits of the source hash)
  5..7 reserved
word 64..12351    the flat image, two 16-bit words per 32-bit flash word
word 12800..      legacy baked screens (unreachable after the phase-2a read-port
                  removal; the 4 KB config-flash slices replace them)
```

The flat image is 48 KB; the user flash is 76 KB (608 Kbit, 304 rows x 64 x
32 bits). The installer uses **25 pages of 2 KB** for both the plain and D16D
images; the D16D demo at 0x4E00 is inside the same 24K image. The 13 pages
after it (`0x3200`..`0x49FF`) are legacy screen slots; the CPU read port that
used them was removed in phase 2a, and the config-flash slices replace them.

The **external SPI flash** holds the FPGA configuration (written by `-f`); the
**on-die 608 Kbit FLASH608K** holds the D16 user image (written by
`--user-flash` or the installer). Keep them separate: the 444 KB tile bitstream
does not fit the 76 KB user flash.

## Boot loader

`rtl/flash/flash_boot.sv` runs after the cache tags are cleared:

1. read the 8-word header and check magic/format/length;
2. copy 12,288 32-bit flash words as 24,576 PSRAM words, computing the same
   CRC-16 as the generator;
3. compare the CRC (the read-back verify was dropped to pay for the CPU read
   port); a bad header or CRC sets `boot_err` and the core stays held
   (heartbeat steady, nothing boots);
4. hand the entry word (0x0100) to the cache path, which releases the core.

Measured in `psram_boot_tb` before the verify was removed: **boot_done at
454.8 ms**, second boot after a button reset OK, `boot_err=0`. The 10 us read
recovery per flash word dominates; dropping the verify halved the reads (12,296
instead of 24,704), and the port adds no boot-time read.

The flash controller (`flash608k_ctrl.v`) follows the sequence in Gowin's own
FLASH608K simulation model: PROG/ERASE leads, NVSTR is the data-storage level,
YE is the write pulse; erase is 120 ms per page.

## CPU read port removed (phase 2a)

The on-die read port at `0xF00A0` and the boot-script `flash@`/`screen` words
were removed: they cost 6–15 CLS and the DVI placement could not afford it.
The FLASH608K is boot storage only again (`flash_boot` + `flash608k_read`).
The on-board 4 MB P25Q32U config flash is the non-removable store for 4 KB
slices (`ADVARCH.md`); the `image.flash.bin` screen pages at `0x3200` are no
longer reachable and will be replaced by the slice image.

## Installer

`rtl/flash/flash_installer.sv` is a standalone top with the `image.flash.hex`
ROM. It has no CPU and no PSRAM: erase the pages it needs, program the image
(12,352 words, 16 us each), then compare all of them. The 32-bit ROM uses all
26 BSRAM blocks of the installer bitstream (one-time build, so that is fine).

LEDs are active low: 0 blinks while working, 1 steady = PASS, 2 steady = FAIL.

## Simulation

```
npm run sim:installer   # blank model -> program -> PASS + header/image check
npm run sim:flash       # archived with the 24K builds
```

Both use `rtl/flash/flash608k_model.sv`; the Gowin builds use the hard
`FLASH608K` primitive.

## Fit

| Build | BSRAM | CLS | Logic |
|---|---:|---:|---:|
| **tile user flash + D16D (28 Oct 2026)** | **23/26** | **4,237/4,320** | **8,283/8,640** |
| installer (one-time) | 26/26 | 3,445/4,320 | 6,679/8,640 |

The tile build trades BSRAM for the sprite bank and the PSRAM cache. It now has
**83 CLS free**: the read-back verify freed 83 CLS and the flash read port spent
6 of them. The older standard user-flash and packed rows were measured before
the segmented map and are archived (`archive/24k-bsram/README.md`).

## Files

```
rtl/flash/flash608k_model.sv     behavioural FLASH608K (Verilator)
rtl/flash/flash608k_core.sv      primitive/model wrapper
rtl/flash/flash608k_ctrl.sv      read / program / page-erase timing
rtl/flash/flash_boot.sv          boot copy + CRC (no CPU read port)
rtl/flash/flash_installer.sv     one-time installer top
fpga/gowin/d16install.sv         installer defines
fpga/gowin/d16flash.sv           final build defines (USER_FLASH)
fpga/gowin/deep16_installer.*    installer project
fpga/gowin/deep16_board_flash.*  final project
artifacts/image/image.flash.hex  installer/user image, 12,352 32-bit words
artifacts/image/image.flash.bin  full 608 Kbit image for --user-flash
scripts/flash_gowin_flash.sh     standard one-command flash
scripts/flash_gowin_tile_flash.sh tile one-command flash
```

## Two fixes that made it work

1. **Read cycle:** SE low pulse, SE high, Tacc and a 10 us recovery (UG295
   figure 3-7); the write order is figure 3-8. Without the SE pulse the
   installer's read-back failed with LED2.
2. **Configuration medium:** the tested path is `openFPGALoader -f <build>.fs`
   (configuration) plus `--user-flash image.flash.bin` (on-die user flash).
   The `.fs`'s embedded user-flash section alone is not the raw image and does
   not give the tested result.

## If the board looks dead

The FPGA is not bricked by this design. Recover with the same one-command, or
with JTAG:

```sh
openFPGALoader --detect                       # should show GW1N(R)-9C
openFPGALoader -m fpga/gowin/impl/pnr/deep16_board_tile_flash.fs  # tile in SRAM
openFPGALoader -f fpga/gowin/impl/pnr/deep16_board_tile_flash.fs \
  --user-flash artifacts/image/image.flash.bin                     # persist both
```

The USER_FLASH build holds the core on a bad header/CRC (LED0 steady lit in the
current build), so no UART and no DVI is expected — that is not a brick. If the
user flash was overwritten by a bad write, `openFPGALoader -m
fpga/gowin/impl/pnr/deep16_installer.fs` restores the D16 image (LED1 steady =
PASS).

## HDMI +5V caveat (observed on the board)

With the monitor connected, the board's power LED went out; unplugging HDMI
restored it. The monitor is loading or back-feeding the HDMI +5V pin, which is
independent of this RTL. Use USB power, try another monitor/cable or an HDMI
cable with the +5V wire removed, and unplug HDMI first if the power LED drops.
