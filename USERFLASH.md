# User-flash boot loader

Status: **SRAM boot verified; config-flash persistence under investigation.**
Installer LED1 PASS and the final USER_FLASH build boots correctly when loaded
with `-m`. Writing the final build to the external configuration flash (`-f`)
makes the board unresponsive on the next power-up. The packed-BSRAM build is the
persistent default and the fallback.

> **Keep the two-stage order:** the installer is an **SRAM-only** step (`-m`);
> its LED1 must be steady PASS before the final build is tried, and the final
> build must be tried in SRAM (`-m`) before it is written to the config flash
> (`-f`). A bad header/CRC holds the core (no UART, LEDs off), which looks like
> a dead board but is not. The recovery command is
> `openFPGALoader -f fpga/gowin/impl/pnr/deep16_board.fs`.

The boot image normally lives in 16 BSRAM blocks, which is why the image is
range-packed. This path moves it to the **on-die 608 Kbit user flash**
(`FLASH608K`, 76 KB) instead. The final bitstream then has **4/26 BSRAM**
(cache 2 + DVI 2), leaving **22 blocks free**.

## Why there are two bitstreams

The FLASH608K has **no initial value**, and the Gowin programmer cannot write
it: only FPGA logic can reach it (UG295). So the image needs a one-time
**installer**:

```
1. npm run synth:installer
   openFPGALoader -m fpga/gowin/impl/pnr/deep16_installer.fs
      -> erases 25 pages, programs 12,352 words, verifies
      -> LED1 steady = PASS, LED2 steady = FAIL
2. npm run synth:flash
   openFPGALoader -f fpga/gowin/impl/pnr/deep16_board_flash.fs
      -> the machine boots from the user flash
```

The installer is loaded to **SRAM** (`-m`), so it does not persist; the final
bitstream goes to the configuration flash (`-f`). The user flash keeps the image
across reconfiguration and power cycles. If the kernel changes, rebuild and
re-run the installer once.

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


## Config-flash persistence (open issue)

`-m` (SRAM) works. `-f` (external config flash) followed by a power cycle does
not. The bitstream is the same, so the difference is in the config-boot path or
the loader's first read after a cold configuration.

The final build now reports on LED0:

| LED0 | meaning |
|---|---|
| slow blink | booted |
| fast blink | loader still working (PSRAM init or flash read not finished) |
| steady lit | boot error (user-flash header/CRC/verify failed) |
| off | FPGA did not configure from the config flash |

Diagnostic order:

1. `-f` the packed `deep16_board.fs`; power cycle. If that boots, the config
   flash path is healthy and only the USER_FLASH bitstream is affected.
2. `-f` the final `deep16_board_flash.fs`; power cycle; note LED0.
3. Load the final with `-m` again. If it still boots, the user flash survived;
   if not, the user flash was erased/invalidated by the config boot.
4. Load the installer with `-m`; LED1 PASS means the user flash is still valid
   and writable, LED2 means it is not.

## The board sequence that worked

```sh
openFPGALoader -m fpga/gowin/impl/pnr/deep16_installer.fs   # LED1 PASS, ~4 s
openFPGALoader -m fpga/gowin/impl/pnr/deep16_board_flash.fs # first test
openFPGALoader -f fpga/gowin/impl/pnr/deep16_board_flash.fs # persist
```

The read cycle fix was the key: SE low pulse, SE high, Tacc and a 10 us
recovery (UG295 figure 3-7); the write order is figure 3-8. Without the SE
pulse the installer's read-back failed with LED2.

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
