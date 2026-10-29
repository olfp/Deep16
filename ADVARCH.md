# ADVARCH — config-flash storage, software PCM, and the interrupt plan

Status: **agreed design; phase 1 (config-flash bring-up) in progress.**
Started 2026-10-29. Supersedes the storage half of `FLASHPLAN.md` and the I2S
half of `AUDIOPLAN.md`. `SOFTPCM.md` is the audio design; `ARCHREV.md` §2–§4
is the ISA change that pays for the interrupt work.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Config flash is the non-removable store.** Puya P25Q32U, 4 MB, 32 Mbit, on the MSPI pins. |
| D2 | **Share the SD SPI master.** One byte engine, divider and MMIO; a 4-LUT pin mux sends it to the SD socket (CS0) or the config flash (CS1). |
| D3 | **Lower 2 MB block-protected** (`BP4..0 = 0 1 1 1 0`, status `0x38`). The bitstream lives there; the slices are in the upper 2 MB. |
| D4 | **512 slices**, 4 KB each, at `0x200000 + n*0x1000`. One slice = one P25Q32U sector = 2048 cells. |
| D5 | **Slice 0 is the master directory** (type 7, WP). Data slices are 1..511. |
| D6 | **Header**: WP, magic 5, flags/rate, type, link, 12-char name; payload from cell 8. |
| D7 | **The on-die user flash keeps the boot image for now.** The 68-LUT read controller stays until CLS runs out; then the boot image moves to the config flash at 1 MB and the on-die path is deleted. |
| D8 | **I2S at 21.094 kHz** (6.75 MHz / 10 / 32), MAX98357A on J5 pins 5/6/7 (FPGA 25/26/27). 128 × 16 FIFO in FFs. |
| D9 | **Audio FIFO low is the fourth IRQ**; FIFO low threshold 32, burst 64. |
| D10 | **SIC priority high → low: raster, audio, timer, keyboard.** |
| D11 | **Sound window 0xE0000–0xEFFFF** (64K cells, segment `0xE000`), just below the I/O area. |
| D12 | **ARCHREV §2+§3 together**: SAPF plus no shadow-bank zeroing; net ~+15 CLS on the tile build. |
| D13 | **Deferred**: boot move, then 6 OAM slots, then the register file, only when CLS runs out. |

## 2. Config flash access

### 2.1 Pins

| FPGA pin | signal | note |
|---:|---|---|
| 59 | `cfg_sck` | MSPI MCLK, GPIO after configuration |
| 60 | `cfg_cs_n` | MSPI MCS_N, active low |
| 61 | `cfg_mosi` | MSPI MO |
| 62 | `cfg_miso` | MSPI MI, pull-up |

`set_option -use_mspi_as_gpio 1` is required in the tile build Tcl. The MSPI
pins are still configuration pins at power-up; they become GPIOs after DONE.

The SD stays on 36 (SCK), 37 (MOSI), 38 (CS0), 39 (MISO). FPGA pin 25 is no
longer CS1; it is freed for I2S BCLK (J5 pin 5).

### 2.2 Sharing the master

| CS | target | pin |
|---|---|---|
| `spi_cs_n[0]` | microSD | 38 |
| `spi_cs_n[1]` | config flash | 60 |

`cfg_sel = ~spi_cs_n[1]`. When set, SCK/MOSI go to the config pins and MISO
comes from `cfg_miso`; the SD pins idle. A Forth `cs!` is `3 and`, so the SD
uses CS0 and the flash CS1. There is no concurrency: one master, one transfer
at a time.

### 2.3 Commands

The P25Q32U does erase/program internally; the CPU only sends:

| command | use |
|---|---|
| `0x9F` | JEDEC ID (3 bytes) |
| `0x05` | status (WIP/BP) |
| `0x06` | write enable |
| `0x03` | read, 24-bit address |
| `0x02` | page program, 256 B max |
| `0x20` | 4 KB sector erase |
| `0x01` | write status (BP) |

Read 4 KB ≈ 10 ms at 3.375 MHz; erase ≤ 45 ms; 16 page programs ≈ 15 ms; one
slice load/save ≈ 10 ms / 60–90 ms.

### 2.4 Protection

`BP4..0 = 0 1 1 1 0` protects `0x000000–0x1FFFFF` (bitstream and, later, the
kernel image). The slices at `0x200000+` are unprotected. `openFPGALoader
--unprotect-flash` is required to rewrite the bitstream; the design sets BP
again after boot. The slice writer also checks `n < 512`.

## 3. Slice format

One slice = 4 KB = 2048 cells. Header cells 0..7; payload 8..2047 (2040 cells).

| cell | bits | meaning |
|---|---|---|
| 0 | 15 | WP (1 = write-protected) |
| 0 | 14:12 | magic `5` |
| 0 | 11:8 | flags / rate code |
| 0 | 7:0 | type |
| 1 | 15:0 | link: next slice, `0xFFFF` = none |
| 2..7 | | name: 12 chars, 2/cell, low byte first, NUL-padded |
| 8..2047 | | payload |

Rate codes: `0` default/none, `1` 8.11 k, `2` 11.10 k, `3` 16.23 k, `4`
**21.09 k**, `5` 26.37 k, `6` 42.19 k, `7` 52.73 k.

### 3.1 Types

| type | name | payload |
|---:|---|---|
| `0x00` | empty | formatted, no payload |
| `0x01` | test | pattern |
| `0x02` | sprite | 1536 words = 6 groups, rel 2..7 |
| `0x03` | screen | 2040 chars, one per cell |
| `0x04` | binary | 2040 words |
| `0x05` | PCM | 2040 16-bit samples, flags = rate |
| `0x06` | font/tile | future |
| `0x07` | directory | 255 × 8-cell entries |
| `0x08` | packed source | 2 × 2040 chars, 2 chars/cell |
| `0x09` | RLL sprite | PackBits stream → 2048 words = 8 groups |
| `0x0A` | μ-law | 4080 8-bit samples, flags = rate |
| `0x0B` | chunked binary | `[type][len][addr_lo][addr_hi][data][sum]` |
| `0x0C..0x7F` | reserved | |
| `0x80..0xFE` | user | |
| `0xFF` | erased | blank `0xFFFF` |

### 3.2 Master directory

Slice 0: type 7, WP=1, magic 5, name `master`, link = continuation directory
or `0xFFFF`. Payload: 255 entries × 8 cells:

| cell | meaning |
|---|---|
| 0 | low byte type, bits 11:8 flags/rate, bit 15 hidden/system |
| 1 | first slice (`0xFFFF` = empty entry) |
| 2..7 | name (12 chars) |

`dir`, `find`, `dir-add`, `dir-remove`, `slice-alloc`. Data slices 1..511.
Continuation directories use the link.

### 3.3 API

Implemented in the boot script (the editor in `catalog.fth` builds on it):

```text
slice ( n -- a )              read 4 KB into the 2048-cell buffer
slice-valid? ( a -- f )       magic 5 and a live header
slice-type ( a -- t )
slice-link ( a -- n )         the next slice in the chain
screen ( n -- )               follow the chain, concatenate 2040 cells/slice
                              into text-buf, interpret the result
cf-erase                      sector erase
cf-protect / cf-unprotect     BP = 2 MB / clear BP
```

Catalog words (`5 screen`): `cf-page ( sector cell -- )` (256-byte page
program), `slice-create ( n t -- )`, `slice-name!`, `slice-flush`, `dir`,
`find`, `dir-add`, `dir-remove`, `slice-alloc`,
`p-screen ( n which -- )` (packed source, type 8), `sprite-slice` (type 2),
`slice-run ( n -- )`. `slice-flush` refuses a WP slice.

Packed source: screen 0 = cells 8..1027, screen 1 = 1028..2047, 2 chars/cell.
RLL: PackBits, bit 7=1 literal `(n&0x7F)+1`, bit 7=0 repeat, `0x00` end.
Chunked binary: type 0 end, 1 copy, 2 entry, 3 fill; 20-bit address in two
cells; 16-bit sum.

## 4. I2S and audio

- **21.09375 kHz** (N=10). BCLK 0.675 MHz. CPU: 9 / 15 / 21 / 28 % for 1/2/3/4
  synthesised voices.
- **128 × 16 FIFO in FFs** (2,048 FFs, no CLS, 6.1 ms). Low threshold 32,
  burst 64; zero-order hold on underrun.
- **Pins:** J5 5/6/7 = FPGA 25/26/27 = BCLK/LRCLK/DIN. MAX98357A at 3.3 V, no
  MCLK, no I2C.
- **MMIO** in the freed `0xF00A0` block: FIFO data/status, divider, enable,
  FIFO-low IRQ.
- **Sound window** `0xE0000–0xEFFFF` (segment `0xE000`, 64K cells = 128 KB):
  μ-law table cells 0..127, samples from 128. Loader uses `ES=0xE000`;
  player/ISR uses `DS=0xE000`, `ES=0xF000`, and restores `DS=0x1000`.
- **μ-law** 4080 samples/slice = 193 ms at 21.09 kHz. **PCM** 2040 samples =
  96.7 ms. Rate code 4 default; 6 (42.19) available per slice.
- **Flash is storage only**: the slice loader copies into the sound window,
  the player streams from PSRAM.

## 5. Interrupts and ARCHREV

- **ARCHREV §2 SAPF** (`0xFFF6`): `spsw[3:0] ← R0'[3:0]`; 5–9 CLS.
- **ARCHREV §3 no shadow zeroing**: `R0'..R3'`/`SP'` persist; SWI/ILL/IRQ share
  the bank; cold DIV/FPU paths save/restore it; no handler assumes zeros.
- **Net tile build**: ~+15 CLS planning (+7…+31).
- **SIC priority high → low**: raster, audio, timer, keyboard.
- **Owner map**: `R0'` raster (SAPF builds its nibble in `R0'` only inside the
  saved/restored cold context), `R1'`/`R2'` audio ring/phase, `R3'` timer,
  `SP'` common handler stack; keyboard uses memory.
- **Timer** 15 kHz tick (450 cycles) and the ms timebase.
- **Raster** line compare from the tile engine, CDC into the CPU domain.
- **Keyboard** PS/2 byte ready.
- **Audio** FIFO low, threshold 32, burst 64.

## 6. Budget (planning, measure each phase)

| step | CLS | free |
|---|---:|---:|
| now | | 83 |
| remove on-die flash CPU port | +6 | 89 |
| config-flash mux + slice layer | −2 | 87 |
| ARCHREV §2+§3 | +15 | 102 |
| I2S + FIFO | −35…−40 | 62–67 |
| timer IRQ | −20…−32 | 30–47 |
| 4-source SIC | −12…−16 | 14–35 |
| raster + keyboard | −14…−28 | −14…21 |
| boot move | +15…+20 | 1–41 |
| 6 OAM slots | +15…+28 | 16–69 |
| register file (last) | +~250 | |

The full secondary goal needs the boot move; 6 slots are the margin if the high
ends land. The boot move is deferred until CLS runs out.

## 7. Phases

1. **Bring-up** (this phase): MSPI GPIOs, pin mux, JEDEC ID, status, BP=2 MB,
   test sector at `0x200000`, SD still works. Forth words `cf-id`,
   `cf-status`, `cf-protect`, `cf-test` (`cf-test` was removed in 2b: sector
   512 is now slice 0).
2. **Slice layer** (done, §10): directory, header/flags/rate, types, JS
   `SpiFlash`, tests; remove the on-die flash CPU port (`flash@`/old `screen`).
3. **ARCHREV §2+§3**: SAPF + no zeroing, software save/restore, BIOS audit,
   tests; measure.
4. **I2S**: 21.09 kHz, FIFO, FIFO-low IRQ, sound window, μ-law/PCM player,
   J5 5/6/7.
5. **Interrupts**: timer, raster, keyboard, audio, SIC4, persistent bank.
6. **When out of CLS**: boot move, then 6 OAM slots, then the register file.

## 8. Phase 1 result (measured, verified on the board)

Built, flashed and verified 2026-10-29.

| | value |
|---|---|
| CLS | **4,274 / 4,320** (46 free) |
| Logic | 8,346 / 8,640 |
| LUT | 6,536 + 742 ALU |
| FF | 2,985 / 6,771 |
| BSRAM | 23 / 26 |
| dvi_pixel Fmax | **72.755 MHz** vs 74.25 (TNS **−0.553 ns**, 2 endpoints) |
| clk_cpu / dvi_render | 17.302 / 27.619 MHz (TNS 0) |

The pin mux itself is ~5 LUT; the rest of the +37 CLS over the 4,237 build is
packing movement (`u_regfile` +37 LUT without an RTL change). The **DVI pixel
path is now the binding constraint**: the previous build closed at 79.26 MHz,
this one is 0.55 ns short. The next phase must record Fmax as well as CLS, and
the ARCHREV §3 removal is the first chance to recover it. If it does not, the
choices are a DVI retime or a 480p fallback, not more features.

The boot-script source now ends at `dict_free 0x49D6`, only **42 cells** below
the BIOS at `0x4A00`. Phase 2 must remove the on-die `flash@`/`screen` source
and move the SD driver/`include` to a source slice before adding the slice
layer, or the image will not build. The SD driver source (slices 1..3) and
the catalog (slices 5..6) are auto-loaded at boot (`1 screen`, `5 screen`) so
`sd`/`include`/`dir` exist at the prompt.

Board test (tio, 115200):

```text
cf-id                     85 60 16
cf-status hex . decimal   38          (2 MB BP set)
cf-test                   status 38, after BP 38,
                          read back ABCD 1234,
                          protected word FFFF FFFF   (removed in 2b)
sd                        SD card ready
```

The `38` is the 2 MB block protect; the test wrote sector 512 above it. The
protected sector 256 is unchanged. `openFPGALoader --unprotect-flash` did not
clear the P25Q32U BP on this board (`cf-status` still 38 after a reflash), so
`cf-unprotect` (WRSR 0x00) was added; use it before a bitstream update, then
`cf-protect` re-arms the guard (and `dir`/slices exercise the upper half).

## 9. Phase 2a result: the DVI retime (gate passes)

Removed the on-die flash CPU path (top decode, psram_mem ports, flash_boot
u_*), the user-flash `flash@`/`screen`/`screen-buf`, the JS flash model and
the three user-flash tests. `npm test`: 662 pass; the tile sim passes. The
boot-script source ends at **`dict_free 0x4897`**, 361 cells below the BIOS.

The first build without the port put `dvi_pixel` at **65.973 MHz** (TNS
−4.090). Two fixes recovered it:

- **`psram_clk` constraint.** The 51 MHz PSRAM PLL is now a named clock in an
  asynchronous group with `clk_cpu` (the bridge is a handshake; the read data
  is synchronized). The false CDC paths no longer drive placement:
  `dvi_pixel` 65.973 → **71.308 MHz**.
- **Line-pair control retime.** `next_line`/`next_buf` are registered
  (`line_next_q`/`buf_next_q`) and the `ready_seen` enable uses those, not a
  combinational path from `sy`. The last failing path was
  `sy_1 → ready_seen_*/CE` at −0.743 ns.

Final measured, same netlist otherwise:

| | value |
|---|---|
| CLS | **4,278 / 4,320 (42 free)** |
| Logic / LUT | 8,297 / 6,485 + 744 ALU |
| FF | 2,939 |
| dvi_pixel | **84.777 MHz**, TNS **0** (6 levels) |
| dvi_render | 26.801 MHz, TNS 0 |
| clk_cpu / psram_clk | 18.576 / 88.931 MHz, TNS 0 |

The DVI now has ~10.5 MHz of margin (14 % of the period) instead of failing.
The retime cost ~19 CLS (4,259 → 4,278); the net against the phase-1 4,274 is
+4 CLS, with the source diet and the port gone.

The board is **not flashed yet**: the current image has the config-flash BP at
`38`, so run `cf-unprotect` first, then `npm run flash:tile`. The 2a bitstream
is safe to flash and the DVI gate passes; after boot, `cf-protect` re-arms
the 2 MB guard.

Phase 2b (slice layer + SD-driver source slice + JS `SpiFlash`) is next, on
this 42-free base.

## 10. Phase 2b result: the slice layer (board-verified)

The on-board config flash now carries a 7-slice, 28 KB source image at
`0x200000` (sector 512), built by `scripts/make_slices.mjs`:

| slice | object | chars |
|---:|---|---:|
| 0 | master directory (WP) | 255 entries |
| 1..3 | `sd.fth` - the SD/block driver | 4,695 |
| 4 | `hello.fth` | 350 |
| 5..6 | `catalog.fth` - slice editor, `dir`/`find`, `p-screen` | 3,593 |

At boot the script reads the SD source, interprets it (so `sd`, `block`,
`include` exist), then reads the catalog. The boot source ends at
**`dict_free 0x4325`** (17,189 cells free); the image is still 24,576 words.
The JS core models the P25Q32U byte by byte (`SpiFlash` on CS1: 0x9F, 0x05,
0x06, 0x03, 0x02, 0x20, 0x01, the 2 MB BP, little-endian cells).

`tests/segmented.test.js` now covers the flash path: `cf-id`, `dir`, loading
`hello` with `4 screen`, creating/flushing/reading a slice, `dir-add`/`find`,
the BP protect/unprotect round trip, `dir-remove` and `p-screen`. `npm test`:
**668 pass**.

Bugs found and fixed while bringing it up:

- `screen` used `begin ... repeat` without a `while`; this kernel's `repeat`
  pops two control cells, so the branch offset was built from a stale cell and
  overwrote the body with `here-orig`. Changed to `begin ... again` with
  explicit `exit`s and an 8,160-cell guard.
- `slice-valid?` kept the address on the stack (`dup @` instead of `@ dup`),
  leaking one cell per slice load.
- `dir` and `find` used `over` with a one-item stack; the entry pointer is now
  `dup i 8 * cells +`.
- `slice-flush` erased/programmed sector `slice-sec`, not `slice-sec + 512`.
- `slice-name!` and `name=` stored the length where the address belonged;
  `dir-add` moved the temporary entry the wrong way; `p-screen`'s range check
  excluded page 1. `slice-create` now LF-fills a blank source.
- `.r` lost its sign across the padding `putch` (the UART BIOS clobbers R11);
  the sign is kept in `dotr_neg`. `dir` uses `u.r` for the non-negative
  type/slice columns.
- `included` now resets the return stack when a load ends: a load called from
  `screen` or `p-screen` ends the line, so the caller's frame is stale.

The board now runs the phase-2b image: `dir` lists sd/hello/catalog,
`4 screen` loads `hello.fth`, and the slice area reads back byte-for-byte
(`npm run flash:slices`, `openFPGALoader -f --external-flash --file-type bin
-o 0x200000`). A full `npm run flash:tile` needs `cf-unprotect` first, because
the configuration half is written in the same pass; after boot run
`cf-protect` to re-arm the 2 MB BP (the slices at `0x200000+` stay writable).

## 11. Bring-up test

After the build and flash:

```text
cf-id                 \ JEDEC ID, expect 85 60 16 (Puya P25Q32U)
cf-status hex . decimal   \ BP = 38 (lower 2 MB) after cf-protect
dir                   \ 3 entries: sd 1, hello 4, catalog 5
4 screen              \ load hello.fth
hello                 \ hello from the user flash
sd                    \ SD card ready
8 3 slice-create      \ create slice 8 as a source, name it, flush, dir-add
s" test" find .       \ 8
cf-protect            \ re-arm the 2 MB guard
```

A Forth cell is 16 bits, so the flash address is a sector number (0..1023)
plus a 12-bit offset; `cf-addr` sends `sector>>4`,
`((sector&15)<<4)|(off>>8)`, `off&255`. Slices start at sector **512** =
`0x200000`, above the protected 2 MB; the erase at sector 256 = `0x100000`
must never be issued by slice code (it is inside the bitstream guard).

If the flash ID is wrong, check the MSPI option, the pin mode of 59–62 and
`cfg_sel`; if the SD breaks, check the CS1 select and the MISO mux.

## 12. Open items

- The slice allocator: scan-for-blank (simple) or a free list in the directory.
- The RLL encoder worst case for an 8-group page.
- The chunked-binary chunk type set.
- The sound-window ring/playlist policy.
- The `use_mspi_as_gpio` option in the archived text build if it is revived.
