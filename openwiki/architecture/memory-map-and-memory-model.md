---
type: memory-architecture
title: Memory Map and Memory Model
description: The Deep16 word-addressed 20-bit memory model, the three build layouts, FiT MMIO windows, PSRAM and config-flash slices, and what unbacked accesses return.
tags: [memory, memory-map, mmio, segments, psram, flash, slices, stacks]
sources:
  - id: openwiki-source-a28946850ce54d03e71935f2
    resource: repo://asm/forth_nano.asm
  - id: openwiki-source-558f92ad48bad4c1a8f65265
    resource: repo://js/deep16_simulator.js
  - id: openwiki-source-d495d08ebea00cef39154011
    resource: repo://js/deep16_tile_engine.js
  - id: openwiki-source-b57ab1606c48ec3ea7344623
    resource: repo://MEMMAP.md
  - id: openwiki-source-2f8a040dcce7a74f3dd3ca04
    resource: repo://rtl/dvi/dvi_tile.sv
  - id: openwiki-source-91dbd2aac6f60eec7eacf72d
    resource: repo://scripts/make_showcase.mjs
  - id: openwiki-source-41517f64370d769c203d48a3
    resource: repo://scripts/make_slices.mjs
generated: { by: "opencode", at: "2026-11-04T15:30:01.509Z" }
verified:
  - by: openwiki/0.7.3
    at: 2026-11-04T15:30:01.509Z
---

# Memory Map and Memory Model

Deep16 addresses **16-bit words**, not bytes. The CPU sees a 20-bit physical
space of 1,048,576 words (2 MiB), reached through four 16-bit segment registers.

## Address model

- Physical address: `(segment << 4) + (offset & 0xFFFF)`, truncated to 20 bits.
- Active segments: `CS`, `DS`, `SS`, `ES`; each has a shadow-bank copy used while
  `PSW.S=1`.
- `0xFxxxx` is the non-cacheable MMIO window on builds that implement it.
- Unbacked reads return `0xFFFF` (the halt word); unbacked writes are dropped.
- Reset: `CS=0xFFFF`, `PC=0` → physical `0xFFFF0`, the 16-word boot ROM.

The vectors live at physical `0x0000` (ILL), `0x0001` (hardware IRQ) and
`0x0002` (SWI), with `0x0000`–`0x00FF` reserved as the zero page and boot
staging area. The boot ROM zeroes `DS`/`SS`, builds `0x0100` in `R1`, plants it
at physical 0–2 and jumps to `0000:0100`.

`MEMMAP.md` is the maintained address reference. **Fixed hardware addresses**
(MMIO, boot ROM, vectors, BIOS entry per build) do not move; **kernel symbols**
(`dict_free`, `boot_script`, `ok_msg`, handler cells) drift whenever the kernel
grows. Re-derive those from the assembler symbol dump after a kernel change
instead of trusting a copied number.

In the tile build the video windows are not ordinary RAM: stores to
`0xF1000`–`0xF627F` are forwarded to the FiT engine, which keeps the two tilemap
banks, the tile and sprite banks, the OAM descriptors and the palette sets. A
plain memory dump of those addresses therefore does not describe what the
display will show.

## The three build profiles

| | Screen / IDE | D16MINI (UART) | D16nano (tile) |
|---|---|---|---|
| CPU image | 1 MiB flat array | 24K words, PSRAM-backed | 24K words from config flash, PSRAM-backed |
| BIOS entry | `0xF8000` | `0x5600` | `0x4A00` |
| Dictionary ceiling | `0x4000` | `0x5600`, raised to `0xFFF0` with PSRAM | `0x4A00` flat / `0x5800` in `D16SEG`; raised to `0xFFF0` with PSRAM |
| Return stack top | `0x6F00` | `0x5800` | `0x5800` flat / DS `0x2FF0` in `D16SEG` |
| Data stack top | `0x7FF0` | `0x5FF0` | `0x5FF0` flat / SS `0xFFF0` in `D16SEG` |
| Display | cell/attribute RAM at `0xF1000` | DVI text mirror with its own cells | tilemap + FiT engine at `0xF1000` |
| Console | UART | UART | UART |
| Boot script | none | `demo.fth` baked in | `demo.fth` + the `9 screen` game loader |

Both small builds probe word `0x6000` after boot. If it reads back (PSRAM
present), the kernel moves `HERE` to `0x6000` and raises the dictionary ceiling
to `0xFFF0`, turning a few thousand free words into roughly 39,000. The same
image works on a BSRAM-only machine, where the probe fails and the old layout
stays.

Both stacks grow **down**. In the flat 24K image the return stack starts at
`0x5800` and the data stack at `0x5FF0`; the return stack has only about 1,136
words before it reaches the BIOS tail at `0x53CE`, so a deeply
nested line can overwrite the BIOS. The `D16SEG` build removes that shared
window by giving each stack its own segment.

## Common map and MMIO windows

| Range | Contents |
|---|---|
| `0x00000`–`0x000FF` | zero page, vectors, boot staging |
| `0x00100` | conventional kernel/program entry (`forth_start`) |
| `0x0F0020`–`0x0F002F` | timer (D16nano) |
| `0x0F0040`–`0x0F004F` | UART console |
| `0x0F0060`–`0x0F0064` | keyboard FIFO and echo cell |
| `0x0F0068`–`0x0F006B` | 32-bit cycle counter (D16nano, read-only) |
| `0x0F0080`–`0x0F008F` | SPI master (SD card / external flash) |
| `0x0F00A0`–`0x0F00BF` | I2S and SIC |
| `0x0F1000`–`0x0F1853` | display window: screen cells or the 82×26 FiT tilemap |
| `0x0F2000`–`0x0F200E` | FiT controls: `0x2000` cursor, `0x2002` row offset, `0x2004` scroll_x, `0x2006` scroll_y, `0x2008` map page, `0x200A` scene (palette set + OAM base), `0x200C` per-row fine-scroll table, `0x200E` raster compare |
| `0x0F3000`–`0x0F3FFF` | FiT tile bank, all 128 tiles × 32 words |
| `0x0F4000`–`0x0F57FF` | FiT sprite bank, all 24 groups × 16 patterns × 16 words |
| `0x0F6000`–`0x0F607F` | FiT OAM, 64 descriptors × 2 words |
| `0x0F6080`–`0x0F627F` | FiT palette, 8 sets × 4 banks × 16 entries |
| `0x0F8000` | BIOS entry in the 1 MiB screen build |
| `0x0FFFF0`–`0x0FFFFF` | boot ROM |

Addresses in the `0xFxxxx` range that the selected build does not decode read
`0xFFFF`; writes are dropped. This is why `0xF1000` is absent on the D16MINI
console build and why `0xF0064` (echo) is ordinary RAM in the 1 MiB IDE build
but unbacked on the 24K UART boards.

Device register layouts live on the hardware pages; the memory model only owns
their addresses and the read/write-fault convention.

## Screen / IDE build

The 1 MiB image keeps the Forth kernel from `0x0100`, then a small dictionary
ending at `0x4000`, free RAM, and the two stacks near `0x6F00`/`0x7FF0`. The
screen is 2,000 words at `0xF1000`–`0xF17CF`, one cell per character:
low byte is the character, high byte is `(background << 4) | foreground`.
`CURSOR_ATTR = 0x7000` is the reverse-video cursor; there is no separate cursor
bit.

The BIOS entry is at `0xF8000` (segment `0xF800`), and the UART and keyboard
ports are present even in the IDE. The screen build has no baked boot script.

## D16MINI UART build

A 24,576-word image from `0x0000` to `0x5FFF`, loaded into PSRAM. The kernel and
boot script occupy the low part, the BIOS sits at `0x5600`, and the stacks use
`0x5800`–`0x5FF0`. The console is the UART at `0xF0040`; the DVI text mirror
keeps its cell RAM inside the DVI block, not at `0xF1000`, so the CPU has no
framebuffer in this build.

The runtime dictionary lives at `0x6000`–`0xFFEF` when PSRAM responds.

## D16nano tile build

The flat D16nano map packs the kernel, ILL handler at `0x5000`, IRQ handler at
`0x51A0`, `divtest` at `0x5300`, BIOS at `0x4A00`, the D16D showcase in the BIOS
segment, and the stacks at `0x5800`/`0x5FF0`. The dictionary starts at `0x6000`
on PSRAM.

The BIOS code proper ends at `0x4CD5`, because the D16D menu starts at
`0x4D34`. The UART mirror (`0x5346`) and the non-blocking UART getstr
(`0x5356`) use the ILL/divtest tail: the showcase reserves `0x5000`–`0x53FF`
but never writes it, so that whole block is available to BIOS code. The BIOS
jump table stores a segment offset, so a routine can move there without
changing a caller.

The D16D showcase is a menu and a Flappy game in the BIOS block. Pac-Man is not
in this image: the kernel grew to `0x434D`, which removes the old `0x4330` game
gap, so the game is stored as a type-4 binary slice in config flash and copied
to segment `0x2000` at run time.

### Segmented variant (`D16SEG`, current board)

`D16SEG` scatters the flat image into separate physical segments at boot:

| Segment | Physical base | Contents |
|---|---|---|
| `CS=0x0000` | `0x00000` | kernel code, vectors, ILL/IRQ handlers, `divtest` |
| `DS=0x1000` | `0x10000` | kernel data `0x3000`–`0x434C`, free `0x434D`–`0x49FF`, BIOS/demo data `0x4A00`–`0x57DC`, dictionary from `0x5800` |
| `SS=0x2000` | `0x20000` | data stack, top `0xFFF0`; also the flash game block load area at the bottom of the segment |
| `CS=0x3000` | `0x30000` | BIOS code and D16D showcase |
| `ES=0xF000` | `0xF0000` | MMIO and boot ROM |

Inside `DS`, the return stack is the `0x2000`–`0x2FFF` window (not a segment of
its own, because Forth reaches it with ordinary `LD`/`ST` through `DS`), and the
dictionary grows up from `0x5800`. BIOS and ILL handlers set `DS=0x1000` and
`SS=0x2000` on entry because they run in the shadow bank with zeroed segments.

The `0x434D`–`0x49FF` gap is now free (`dict_free = 0x434D`); the Pac-Man block
no longer occupies it. The `game-load` word copies the 1,695-word block to the
bottom of the `SS=0x2000` segment (offset 0–`0x69E`), far below the data stack
top at `0xFFF0`.

The scatter is performed by `rtl/flash/flash_boot.sv`; `tests/segmented.test.js`
exercises the same map in the JS core, including a 1,000-deep recursion and a
20,000-cell data stack.

## PSRAM and flash backing

- **CPU-visible PSRAM:** HyperRAM, 4 MB die, of which the 20-bit window exposes
  1 M words. The 24K boot image lands at `0x0000`–`0x5FFF`; the runtime
  dictionary follows at `0x6000`; the boot ROM stays at `0xFFFF0`.
- **Boot image in config flash:** bytes `0x100000`–`0x112FFF`, with an eight-word
  header (magic `D16F`, format 1, length 24,576 words, CRC-16/CCITT-FALSE) and
  two CPU words per 32-bit flash word. The loader checks the header and CRC; a
  bad image sets `boot_err` and holds the core.
- **Configuration flash:** the bitstream at byte 0, the boot image at 1 MB, and
  the **slice area** from 2 MB. The first 2 MB is block-protected; the upper
  2 MB is writable.
- **Source slices:** 4 KB sectors, slice 0 is the master directory. The screen
  sources occupy slices 1–9 (SD driver, `hello.fth`, catalog, `games.fth`); the
  Pac-Man block is slice 10 at `0x20A000`.
- **Binary game slices:** a type-4 slice's payload starts with magic `0xD16B`,
  version 1, the entry offset, the word count, the load segment (`0x2000`), then
  the block. `games.fth` walks the link chain, copies the block into the load
  segment and `call-far`s it; `game-run` returns to the interpreter.
- **On-die FLASH608K:** retained only for the installer fallback; the tile build
  no longer reads it.

The flash is reachable by the CPU only through the SPI master (chip select 1),
never as memory.

## Boot and vector flow

1. Reset to the boot ROM at `0xFFFF0`.
2. ROM writes `0x0100` at physical 0–2 and jumps to `0000:0100`.
3. Kernel installs its vectors, clears the console, probes `0x6000` for PSRAM,
   and moves the dictionary if present.
4. Baked `demo.fth` is interpreted from `boot_ptr`; the D16D image also loads
   the `9 screen` `games.fth` loader.
5. REPL/BIOS dispatch: version, init, putch, putstr, getch, getstr, and the
   optional D16D `gfx` call.
6. `s" pacman" game-run` finds the type-4 slice, copies it to segment `0x2000`
   and far-calls the game; `q` returns to the prompt.
7. On D16nano `core3`, an ILL for `DIV`/`DIV32` reaches the handler at `0x5000`,
   which saves the caller PC in `ill_pc_save` and emulates the divide.

## Related pages

- [ISA and CPU State](isa-and-cpu-state.md)
- [Video and Peripherals](../hardware/video-and-peripherals.md)
- [PSRAM, Cache and Flash Boot](../hardware/psram-cache-and-flash.md)
- [D16D Showcase, Flappy and Pac-Man](../software/showcase-games.md)
- [Forth Kernel and BIOS](../software/forth-kernel.md)
