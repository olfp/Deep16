---
type: hardware-platform
title: PSRAM, Cache and Flash Boot
description: How Deep16's main memory is backed by HyperRAM, how the write-through cache and boot loader work, what each flash region holds, and what happens when boot fails.
tags: [psram, hyperram, cache, flash, boot, loader, crc, spi]
sources:
  - id: openwiki-source-a28946850ce54d03e71935f2
    resource: repo://asm/forth_nano.asm
  - id: openwiki-source-02ca194d57796e6a2db00cb9
    resource: repo://fpga/gowin/deep16_board_tile_flash.gprj
  - id: openwiki-source-b57ab1606c48ec3ea7344623
    resource: repo://MEMMAP.md
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
  - id: openwiki-source-91dbd2aac6f60eec7eacf72d
    resource: repo://scripts/make_showcase.mjs
  - id: openwiki-source-41517f64370d769c203d48a3
    resource: repo://scripts/make_slices.mjs
  - id: openwiki-source-e3cbc9bdf6a73d9a2ec96f60
    resource: repo://tests/segmented.test.js
generated: { by: "opencode", at: "2026-11-04T16:08:29.597Z" }
verified:
  - by: openwiki/0.7.3
    at: 2026-11-04T16:08:29.597Z
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
   BIOS/demo block (image words `0x4A00`–`0x57FF`) to segment `0x3000` at
   `0x30000 + (word - 0x4A00)`. The block is `0xE00` words; its
   `0x5000`–`0x53FF` part is reserved by the showcase and used by the
   ILL/divtest/UART tail, including the non-blocking UART getstr at `0x5356`.
   The DS copy covers image words `0x3000`–`0x57DC`, so the always-baked
   Frogger backdrop at `0x4350`–`0x4665` is mirrored at DS
   `0x14350`–`0x14665`; the menu uses the flat copy through `CS=0x0435`.
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
| `0x200000` | 4 KB slices, slice *n* at `0x200000 + n × 0x1000`; slice 0 is the directory |
| `0x209000` | slice 9: `games.fth`, the flash game loader |
| `0x20A000` | slice 10: the Pac-Man type-4 binary block |
| `0x20B000`–`0x3FFFFF` | rest of the writable upper half |

The first 2 MB is block-protected with `BP = 0x38`. That protects the bitstream
and the boot image from a slice writer. A slice is 2,048 cells: eight header
cells (type, link, twelve-character name) and 2,040 payload cells; slice 0 is
the master directory. `npm run flash:tile` writes slices last, after verifying
the boot image by read-back.

**The block protect is not cleared by `--unprotect-flash`.** A protected chip
silently drops the write at `0x100000` and still reports Done, which is why the
flash script dumps the region and compares it before continuing.

## Game slices and the segment-0x2000 loader

A game is a **type-4 binary slice**. Its payload is not source text:

```
cell 0   magic 0xD16B
cell 1   format version 1
cell 2   entry offset inside the load segment (0 today)
cell 3   word count of the block
cell 4   load segment (0x2000 for Pac-Man)
cell 5+  the block words
```

Continuations are raw payload words linked through the slice header, so one game
may span several 4 KB slices. `scripts/make_slices.mjs` assembles the Pac-Man
sources with `buildPacman()`, splits the 1,695-word block into type-4 payloads
and puts the first slice at index 10. `npm run flash:slices` writes the image at
`0x200000`.

`screens/flash/games.fth` (loaded by `9 screen`) provides `game-load` and
`game-run`. `game-load` finds the name in slice 0, follows the link chain,
copies each payload into `ES:offset` after `seg-base!`, restores `ES=0xF000` and
returns the load segment. `game-run` then uses the kernel's `call-far`
primitive, which enters `seg:0` with `R10`/`R11` as the return pair. The block
therefore runs with `CS=DS=0x2000`; its static map, tables and writable state
are all inside the 64K segment. The load area starts at offset 0 while the data
stack grows down from `0xFFF0`, so they only meet under very deep stacks.

The command is `s" pacman" game-run` from the Forth prompt. The showcase menu's
**P** entry still jumps to the old `0x4330` image address and needs this loader
hookup; until then the game is reachable through the prompt. The Frogger
backdrop is not a slice: it is part of the boot image at `0x4350`, and the menu's
**G** entry launches it directly with `CS=0x0435`.

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
