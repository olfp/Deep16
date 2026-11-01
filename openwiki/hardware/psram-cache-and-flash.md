---
type: hardware-platform
title: PSRAM, Cache and Flash Boot
description: How Deep16's main memory is backed by HyperRAM, how the write-through cache and boot loader work, what each flash region holds, and what happens when boot fails.
tags: [psram, hyperram, cache, flash, boot, loader, crc, spi]
verified:
  - by: openwiki/0.7.2
    at: 2026-11-01T09:36:37.731Z
sources:
  - id: openwiki-source-02ca194d57796e6a2db00cb9
    resource: repo://fpga/gowin/deep16_board_tile_flash.gprj
  - id: openwiki-source-274c2b02d5002e6597ae2b44
    resource: repo://rtl/flash/boot_spi_read.sv
  - id: openwiki-source-ea2bb1d1b243f8f87d7dcc7a
    resource: repo://rtl/flash/flash_boot.sv
  - id: openwiki-source-0b51981156a85fe04fee776f
    resource: repo://rtl/flash/flash_installer.sv
  - id: openwiki-source-2db4e14fcf160e58b5bbb279
    resource: repo://rtl/psram/deep16_psram_bridge.sv
  - id: openwiki-source-b2325b4e0f4b5f9a156f872b
    resource: repo://rtl/psram/deep16_psram_mem.sv
  - id: openwiki-source-85086b0015bec854191b11d1
    resource: repo://rtl/psram/psram_word_bridge.sv
  - id: openwiki-source-da0fe35253069a3157d15bab
    resource: repo://scripts/flash_gowin_tile_flash.sh
  - id: openwiki-source-c14f3342b8ee81b2c622be55
    resource: repo://scripts/make_image.mjs
  - id: openwiki-source-41517f64370d769c203d48a3
    resource: repo://scripts/make_slices.mjs
generated: { by: "opencode", at: "2026-11-01T09:36:37.731Z" }
---

# PSRAM, Cache and Flash Boot

The 24K-word Forth image does not fit in the Tang Nano 9K's block RAM once the
renderer and peripherals have taken their share. Current boards therefore run
out of the on-board **64 Mbit HyperRAM**, with a small write-through cache in
front of it, and take the boot image from the **4 MB configuration flash**.

The chain is: configuration flash → `flash_boot` → PSRAM bridge → PSRAM → cache
→ CPU. Each link has its own failure mode, and the design generally reports a
failure and keeps the core held rather than running a corrupt image.

## The PSRAM path

Two bridge implementations exist in `rtl/psram/`:

- `psram_word_bridge.sv` — used by the current board. One word per transaction,
  or a two-word burst for a cache line, against the open-source controller
  (`psram_controller.v`) running 1:1 at 51 MHz.
- `deep16_psram_bridge.sv` — the alternative Gowin HS-IP path, whose minimum
  transfer is a 32-byte burst-16 line with a 14-clock command spacing.

The live Gowin project includes `psram_controller.v`, `psram_word_bridge.sv` and
`deep16_psram_mem.sv`; it does not include `deep16_psram_bridge.sv` or the IP
model.

Requests cross clock domains as toggles with stable payloads. The CPU side is
one transaction at a time: `req`, `we`, `addr`, `wdata` in, then `busy` until
`ready` with `rdata`. The controller side receives a 22-bit **byte** address
derived from the 20-bit word address. `burst` is a level held for the whole
transaction because the controller samples it in the read state, not only at
the command.

## Cache shape and policy

`deep16_psram_mem` is the cache and the machine's memory controller at once:

- **512 lines × 2 words**, direct-mapped, giving 1,024 words of data (one BSRAM
  block) and 512 tags (a second block);
- word address split: `[19:10]` tag, `[9:1]` line, `[0]` word in line;
- **write-through with update on hit**, so the cache always matches PSRAM;
- `0xFFFF0`–`0xFFFFF` is served from a local boot-ROM constant, never cached;
- `FSH` only has to clear tags, because there is no dirty data to write back.

Two-word lines are a deliberate compromise. A cold fill costs one burst
transaction instead of two individual reads, while a longer line would make the
first pass through fresh code slower than an uncached machine, since a fill
costs what the individual reads cost. The win is reuse: the Forth inner
interpreter, number parser and stacks are tiny hot loops.

The fill writes the two words on consecutive cycles on purpose. Two different
addresses written on one `always_ff` edge cannot be inferred as BSRAM, and the
vendor flow then builds the cache out of flip-flops.

## Runtime arbitration

The memory block serves **store, then load, then fetch**, and the core advances
one cycle per completed word:

- a retiring store is latched first and always written through to PSRAM, even on
  a cache hit, so a later load cannot see stale data;
- a load in MEM is served next;
- instruction fetch fills the remaining slot.

A cache hit returns the word immediately. A miss issues one two-word burst,
writes both words and the tag, and presents the requested half. The ROM range is
detected on the fetch address and served without a PSRAM transaction.

## Boot: configuration flash (`USER_FLASH`)

When `USER_FLASH` is defined, the PSRAM block starts in `S_INIT`, waits for the
controller's power-on init, then hands the SPI master to `flash_boot` while the
CPU is held in reset. The sequence is:

1. Read the flash header at byte `0x100000`. Four fields are validated: magic
   `D16F`, format 1, image word count 24,576, and a CRC-16/CCITT-FALSE value.
2. Stream the image, two CPU words per 32-bit flash word, writing each pair into
   PSRAM through the same bridge the CPU uses.
3. Accumulate the CRC over the bytes of every fetched 32-bit word, low byte
   first, exactly as `scripts/make_image.mjs` computes it.
4. With `D16SEG`, also copy the kernel data block to `DS=0x1000` and the
   BIOS/demo block to segment `0x3000`.
5. On a CRC match, release the core and hand over the kernel entry word saved
   from image word `0x0080` (CPU word `0x0100`).

A bad header or a CRC mismatch sets `boot_err` and parks in `S_FERR`; the core
is never released and the heartbeat LED shows the failure. There is **no
read-back verify of PSRAM** in this path: the CRC covers the flash read, and the
PSRAM write is covered by the cache's write-through plus the machine actually
running.

## Boot: packed image in BSRAM (non-`USER_FLASH`)

The older path is still present for builds that keep the image on chip. The
generator range-packs the flat image into runs of non-`0xFFFF` words, which fits
the ~15.7k live words into 16 BSRAM blocks instead of 24. Format:

```
word 0        range count N
words 1..2N   (start, end) pairs, inclusive, ascending
words 2N+1..  payload words, concatenated
```

The loader clears the tag array, reads the table, walks all 24,576 destination
words (payload or `0xFFFF` fill), then **walks the same path again as a
verify**. On a mismatch it retries the whole copy once; a second mismatch sets
`boot_err`, which is persistent, and execution continues so the failure is
observable rather than silent. Finally it reads word `0x0100` through the cache
and compares it with the expected entry word from the table before releasing the
core.

`packImage`, `expandImage`, `checkPacked` and `crc16` in `scripts/make_image.mjs`
are the generator side; `checkPacked` enforces both the 16-block budget and the
31-range limit imposed by the loader's 5-bit counter.

## Flash layout and protection

The P25Q32U is 4 MB and holds three regions:

| Byte address | Contents |
|---|---|
| `0x000000` | FPGA bitstream |
| `0x100000` | boot image: 64-word header, then the packed image |
| `0x200000` | 4 KB source slices, slice *n* at `0x200000 + n × 0x1000` |
| `0x300000`–`0x3FFFFF` | rest of the writable upper half |

The first 2 MB is block-protected with `BP = 0x38`. That protects the bitstream
and the boot image from a slice writer. A slice is 2,048 cells: eight header
cells (type, link, twelve-character name) and 2,040 payload cells; slice 0 is
the master directory. `npm run flash:tile` writes slices last, after verifying
the boot image by read-back.

**The block protect is not cleared by `--unprotect-flash`.** A protected chip
silently drops the write at `0x100000` and still reports Done, which is why the
flash script dumps the region and compares it before continuing.

## Installer fallback

The on-die FLASH608K can only be written by FPGA logic, not by the programmer.
`flash_installer.sv` is a one-time bitstream that loads `image.flash.hex`,
erases the 25 pages it needs (50 KB), programs 12,352 32-bit words, and reads
them back. LED1 steady means PASS, LED2 means FAIL. The tile build no longer
reads the on-die flash; the installer exists only as a recovery path.

## Failure semantics

| Failure | Detected by | Result |
|---|---|---|
| SPI/flash read error during load | header mismatch / CRC | `boot_err`, core stays held (`S_FERR`) |
| Bad image length or format | header check | `boot_err`, core stays held |
| Packed-image mismatch on the BSRAM path | verify walk | one retry, then `boot_err` and continue |
| Wrong word at `0x0100` | entry check through the cache | `boot_err` before release |
| Protected flash write | host read-back compare | flash script aborts before slices |

The LED policy makes these visible: `led[0]` blinks fast while loading, slow when
done, and stays lit on `o_boot_err`.

## Related pages

- [FPGA Board Builds](board-builds.md)
- [Memory Map and Memory Model](../architecture/memory-map-and-memory-model.md)
- [Build, Test and Image Pipeline](../tooling/build-test-and-images.md)
- [RTL Core Microarchitecture](../cores/rtl-core.md)
