# SPEEDFLASH — interactive config-flash reads

Status: **plan, nothing implemented (2026-11-05).** Scope: the interactive
screen/catalog/slice path on the D16nano board. Cold-boot time and the SD card
are separate targets; see the end of this note.

## 1. The complaint, and what actually costs the time

Interactive loads (`screen n`, `dir`, `find`, `slice-run`, `p-screen`, the
editor's slice operations) feel very slow. The flash wire is not the main
reason. The dominant cost is the **threaded Forth loop** that drives the SPI
master byte by byte.

`cf-read-burst` in `forth/boot.fth` is:

```forth
: cf-read-burst ( sector -- )
  0 spi-div es!  2 cs! 3 spi!  0 cf-addr
  slice-buf 2048 0 do
    0xff spi> 0xff spi> 8 lshift or   over i cells + !
  loop drop 0 cs! ;
```

Two `spi>` calls per 16-bit word. `spi>` is itself a colon word:

```forth
: spi> ( c -- c )   spi-data es! begin spi-stat es@ 1 and 0= until
                    spi-data es@ 0xff and ;
```

Every `es!`/`es@` is a threaded word with a stack check and `next`; the SPI
transfer is only 16 CPU clocks. A realistic cost is **~250–300 cycles per
byte**, so a 4 KB slice is **~150–200 ms**, not the ~10 ms the wire alone
allows. On top of that:

| Operation | What it does now | Rough cost |
|---|---|---|
| `dir`, `find` | `0 slice` every call: one 4 KB flash read | ~150–200 ms each |
| `slice-alloc` | probes slices 1, 2, 3 … sector by sector | ~1.5–2 s for the current 10-slice image |
| `p-screen`, `slice-run` | re-reads the slice even if it is already in `slice-buf` | a second full read |
| `screen 5` (catalog) | 4 slices | ~0.6–0.8 s plus compile time |

The SPI master is clocked by `clk_cpu` (6.75 MHz), so `DIV=0` caps SCK at
**3.375 MHz** (`rtl/deep16_spi.sv`). That is the floor for any loop, but the
Forth overhead is currently about ten times the wire time.

For reference, the cold boot is measured in `USERFLASH.md`: **~0.37 s** for the
12,352-word image via `boot_spi_read` (8 bytes per 32-bit word, one `0x03`
command each, plus a bit-by-bit CRC). That is a separate, later target.

## 2. Phase 1 — software only, no RTL, no CLS

All of this fits in the kernel/boot-script/catalog. Free kernel code space
exists at `0x2D4A`–`0x2FFF` (694 words below the `.org 0x3000` data section);
the DS dictionary has room for new buffers.

### 2.1 Assembly block reader (the big win)

Add one new kernel primitive that streams a whole 4 KB slice:

```text
cf-burst ( sector -- )      \ or ( sector buf -- )
```

- assert CS1, send `0x03` + the three address bytes (same encoding as
  `cf-addr`), then loop 2048 times: send `0xFF`, poll `SPI_STAT.busy`, read
  `SPI_DATA`, combine two bytes into a word, store;
- deassert CS1;
- a tight `STS / LDS / AND / branch` loop, no threaded-word calls.

Expected **~20–25 ms per slice** (the wire is ~10 ms), i.e. **8–10× faster**
than the current loop. `cf-read-burst` becomes a thin Forth wrapper (or is
replaced by the primitive).

The kernel is assembled into the image; the primitive needs its header/word
registration, the usual register and stack conventions, and a test that reads
the SPI flash model in the segmented suite.

### 2.2 One-slice cache

`slice` already reads into `slice-buf`. Add a `slice-cached` cell (the slice
number, or a sentinel) and skip `cf-read-burst` when the requested slice is
already there. Invalidate it when `cf-page`/`slice-flush` writes the current
slice.

Effect: `p-screen` on both halves of one slice, repeated `slice-run` and any
repeated read of the last slice become free.

### 2.3 Directory cache

The directory is slice 0 (4 KB, 255 entries × 8 cells). `dir`, `find`,
`dir-add`, `dir-remove` and `slice-alloc` all read it. Add a separate
`dir-buf` (2048 cells) so it does not fight with `slice-buf`:

- read slice 0 once into `dir-buf`; refresh after `slice-flush`, `dir-add`,
  `dir-remove`;
- `dir`/`find` walk the cached buffer;
- `name=`/`find` already take an address, so the change is local to the
  words that currently call `0 slice`.

Expected: `dir`/`find` from ~150–200 ms to effectively instant after the first
use (and ~20–25 ms for that first read with 2.1).

### 2.4 Allocate from the directory, not from the flash

`slice-alloc` currently reads every slice sector until it finds an erased or
invalid header:

```forth
: slice-alloc ( -- n )
  512 1 do i slice
    dup @ 0xffff = if drop i unloop exit then
    slice-valid? 0= if i unloop exit then
  loop 0 ;
```

Replace it with one of:

- a **free-slice bitmap** (512 bits = 32 cells) built once from the directory
  and its chains, then updated on allocate/remove; or
- a `slice-next` cursor initialised from the directory once and advanced after
  a successful allocation (the common case is contiguous slices).

Either removes the ~1.5–2 s scan. The directory's free-entry marker is
`link == 0xffff`; the entry's link cell is the first slice of the chain, and a
slice's own link is the next slice. This needs to be pinned down in the code
before changing allocation.

### 2.5 Optional: PSRAM slice cache

If the one-slice cache is not enough for the editor workflow, keep the last
2–4 slices in a PSRAM region outside the used segments (for example a
dedicated segment at physical `0x80000`). A hit is a PSRAM copy (~0.3 ms for
4 KB), but the first read still needs 2.1. This is a second step, not a
replacement for the assembly reader.

## 3. Expected result

| Operation | Now (estimate) | Phase 1 |
|---|---|---|
| `dir` / `find` | ~150–200 ms each | ~0 (cached), ~20 ms first |
| `slice-alloc` | ~1.5–2 s | ~0–25 ms |
| `p-screen` same slice twice | ~2 × 150–200 ms | ~20–25 ms once |
| `screen 5` first load | ~0.6–0.8 s + compile | ~0.1 s + compile |
| Any 4 KB slice read | ~150–200 ms | ~20–25 ms |

`included` (tokenising and compiling the source) is separate and remains; this
plan removes the I/O stall, not the compiler cost.

## 4. Phase 2 — only if Phase 1 is not enough

The board has **~22 CLS free** after the raster edge detector
(4,298/4,320), so these are area decisions first:

1. **Fast SPI clock domain.** Move the SPI master to the 27 MHz oscillator
   (13.5 MHz SCK) with a small CDC between the CPU register interface and the
   shifter. Another 4× on misses. The P25Q32U is comfortable at 13.5 MHz;
   the SD data clock can follow (its init stays ~100 kHz).
2. **Streaming/DMA reader.** A descriptor (`flash address`, `length`,
   `destination`) filled by the CPU, with the engine writing into PSRAM and
   raising an IRQ at the end. Near-wire speed and no polling; the largest and
   most useful long-term change for screens/games.
3. **Dual-output read (`0x3B`)** using MOSI as IO1: 2× data rate on the same
   four pins. Quad is not available — `WP#`/`HOLD#` are not routed in
   `rtl/deep16_board.cst`.

## 5. Not first: cold boot

The boot path has its own easy wins, deferred here because the complaint is
interactive:

- burst the whole image under one `0x03` command instead of one command per
  32-bit word (halves the wire time);
- byte-wise CRC instead of bit-by-bit (~50 ms);
- skip the redundant D16SEG flat copies;
- optionally overlap the flash read with PSRAM init.

Together these take the ~0.37 s boot toward ~0.12–0.15 s before any clock
change. A fast SPI/DMA engine would help both paths.

## 6. Files and tests

Touched by Phase 1:

| File | Change |
|---|---|
| `asm/forth_nano.asm` | new assembly block-read primitive (free code 0x2D4A–0x2FFF); word headers |
| `forth/boot.fth` | `cf-read-burst` uses the primitive; one-slice cache; `dir-buf`; `slice` |
| `screens/flash/essentials.fth` | `dir`/`find`/`dir-add`/`dir-remove`/`slice-alloc` use the directory cache and the new allocation |
| tests | segmented/slices tests: flash model read, cache invalidation, allocation |

Remember to run `node scripts/embed_forth.mjs` after editing `forth/boot.fth`
and `node scripts/make_slices.mjs` after editing `screens/flash/essentials.fth`;
the board image and slices then need `npm run flash:tile` / `flash:slices`.

## 7. Open questions

- Where should the primitive live: a kernel word (code space is free) or a
  BIOS call in the 0x5000 tail (nearly full after the getstr move)?
- Is the free-slice bitmap worth the 32 cells, or is a `slice-next` cursor
  enough for the editor's workflow?
- Does the editor ever need two different slices live at once (`dir` while a
  screen is open), which decides whether `dir-buf` must be separate from
  `slice-buf`? Yes, `dir` is called while editing, so keep them separate.
- Should the one-slice cache also cover the directory (i.e. cache slice 0 in
  `dir-buf` and leave `slice-buf` for screens)? That is the proposed split.
