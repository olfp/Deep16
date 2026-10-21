# User-flash boot loader

Status: **verified, and persistent on the board.**

The working path is:

```sh
# 1. install the image once (SRAM, volatile)
openFPGALoader -m fpga/gowin/impl/pnr/deep16_installer.fs
#    LED1 steady = PASS

# 2. persistent final configuration:
#    Gowin Programmer -> External Flash -> fpga/gowin/impl/pnr/deep16_board_flash.bin
#    power cycle -> LED0 slow blink, terminal + DVI live
```

`deep16_board_flash.bin` (the raw 444 KB bitstream) is the file to write to the
external configuration flash. **Do not use `openFPGALoader -f` with the
USER_FLASH `.fs`:** the `.fs` package contains the user-flash section, so that
write erases/overwrites the on-die image and leaves the config boot broken
(LED0 off, no UART). The packed `deep16_board.fs` is fine with
`openFPGALoader -f` because it has no user-flash section; it remains the
fallback.

SRAM tests remain useful:

```sh
openFPGALoader -m fpga/gowin/impl/pnr/deep16_board_flash.fs   # volatile test
```

The user flash keeps the image across reconfiguration and power cycles. If the
kernel/image changes, re-run the installer (`-m`); the persistent `.bin` only
needs replacing if the loader/RTL changes.

## Image format

`scripts/make_image.mjs` writes `image.flash.hex`:

```
32-bit word 0..7   header
  0  magic 'D16F' (0x44313646)
  1  format 1
  2  image length in 16-bit words (24,576)
  3  CRC-16/CCITT-FALSE over the flat image
  4  build id (first 32 bits of the source hash)
  5..7 reserved
word 64..12351    the flat image, two 16-bit words per 32-bit flash word
```

The image is 48 KB; the user flash is 76 KB (304 rows x 64 x 32 bits). The
installer uses rows 0..192, i.e. **25 pages of 2 KB**; the rest stays free.

## Boot loader

`rtl/flash/flash_boot.sv` runs after the cache tags are cleared:

1. read the 8-word header and check magic/format/length;
2. copy 12,288 32-bit flash words as 24,576 PSRAM words, computing the same
   CRC-16 as the generator;
3. compare the CRC, then read every flash word back and compare it with PSRAM;
4. one retry on the first mismatch; a bad header/CRC or a persistent mismatch
   sets `boot_err` and the core stays held (heartbeat steady, nothing boots);
5. hand the entry word (0x0100) to the cache path, which releases the core.

Measured in `psram_boot_tb`: **boot_done at 454.8 ms**, second boot after a
button reset OK, `boot_err=0`. The 10 us read recovery per flash word dominates
(24,704 reads in copy + verify); the packed build is still 37 ms.

The flash controller (`flash608k_ctrl.v`) follows the sequence in Gowin's own
FLASH608K simulation model: PROG/ERASE leads, NVSTR is the data-storage level,
YE is the write pulse; erase is 120 ms per page.

## Installer

`rtl/flash/flash_installer.sv` is a standalone top with the `image.flash.hex`
ROM. It has no CPU and no PSRAM: erase 25 pages, program 12,352 words (each one
16 us), then compare all of them. The 32-bit ROM uses all 26 BSRAM blocks of the
installer bitstream (one-time build, so that is fine).

LEDs are active low: 0 blinks while working, 1 steady = PASS, 2 steady = FAIL.

## Simulation

```
npm run sim:installer   # blank model -> program -> PASS + header/image check
npm run sim:flash       # preloaded model -> boot -> second boot
```

Both use `rtl/flash/flash608k_model.sv`; the Gowin builds use the hard
`FLASH608K` primitive.

## Fit

| Build | BSRAM | CLS | Logic |
|---|---:|---:|---:|
| packed BSRAM (baseline) | 20/26 | 4,211/4,320 | 8,173/8,640 |
| **user flash (final)** | **4/26** | 4,303/4,320 (100%) | 8,288/8,640 (96%) |
| installer (one-time) | 26/26 | 3,445/4,320 (80%) | 6,679/8,640 (78%) |

The final build trades the CLS margin for **22 free BSRAM blocks**: only **17 CLS** remain. The flash loader/CRC cost 92 CLS over the packed baseline. The colour
mode now has the blocks it needs; the remaining constraint is CLS.

## Files

```
rtl/flash/flash608k_model.sv     behavioural FLASH608K (Verilator)
rtl/flash/flash608k_core.sv      primitive/model wrapper
rtl/flash/flash608k_ctrl.sv      read / program / page-erase timing
rtl/flash/flash_boot.sv          boot copy + CRC + verify
rtl/flash/flash_installer.sv     one-time installer top
fpga/gowin/d16install.sv         installer defines
fpga/gowin/d16flash.sv           final build defines (USER_FLASH)
fpga/gowin/deep16_installer.*    installer project
fpga/gowin/deep16_board_flash.*  final project
```


## Two fixes that made it work

1. **Read cycle:** SE low pulse, SE high, Tacc and a 10 us recovery (UG295
   figure 3-7); the write order is figure 3-8. Without the SE pulse the
   installer's read-back failed with LED2.
2. **Configuration medium:** the `.fs` user-flash section must not be used for
   the external flash write. The `.bin` with the Gowin Programmer leaves the
   installed image alone and boots.

## If the board looks dead

The FPGA is not bricked by this design. Recover with JTAG:

```sh
openFPGALoader --detect                       # should show GW1N(R)-9C
openFPGALoader -m fpga/gowin/impl/pnr/deep16_board.fs   # safe packed build, SRAM
openFPGALoader -f fpga/gowin/impl/pnr/deep16_board.fs   # persist it
```

The USER_FLASH build holds the core on a bad header/CRC (LED0 steady lit in the current build), so no UART and no DVI is expected — that is not a brick.
It also cannot repair itself: the installer is the only writer of the user
flash.

## HDMI +5V caveat (observed on the board)

With the monitor connected, the board's power LED went out; unplugging HDMI
restored it. The monitor is loading or back-feeding the HDMI +5V pin, which is
independent of this RTL. Use USB power, try another monitor/cable or an HDMI
cable with the +5V wire removed, and unplug HDMI first if the power LED drops.
