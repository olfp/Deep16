# MEMFIXPLAN — clean up the memory map with chapters and a thin linker

Status: **phases 0–4b implemented**, 2026-11-27; phase 5 remains. Companion
to `MEMLAYOUT.md` (audit) and `MEMMAP.md` (hardware/MMIO reference).

## 0. Goal, scope, non-goals

**Goal:** stop silent address collisions by construction, and give BIOS, BDOS,
the ILL handler and FloatLib their own address space so none of them can ever
grow into the Forth dictionary or stacks.

**Scope:** the D16nano tile image (`D16SEG`/`D16D`, 24 K / 28 K flat image,
scattered into segments by `flash_boot`). The 1 MiB D16SIM (screen/IDE) build
stays flat and untouched; archived D16MINI and the flat `D16NANO` test harness
are ignored.

**Non-goals:**

* No ISA change. `phys = (segment << 4) + offset` stays.
* No runtime relocation of game slices. `bdos_load`, Flappy (`seg 0x5000`),
  Frogger (`seg 0x0600`), Pole (`seg 0x7000`) and the BDOS directory buffer
  (`seg 0x8000`) keep their fixed segments.
* No separate segment for the **return stack**: every access is a DS-relative
  `LD`/`ST`, so it stays a DS window below the dictionary. The data stack
  already is its own segment (`SS`).
* No "full" linker with dynamic objects. This is a build-time chapter linker.
* No blanket replacement of immediates with table lookups: small `LDI` values
  stay inline; the constant pool introduced in §3.5 is for addresses, far
  pointers and constants the 15-bit `LDI` field cannot express.

## 1. Why a linker, and which kind

Today the assembler is a two-pass absolute-address assembler: `.org` rewinds
the counter and duplicate writes are last-write-wins; labels resolve to
absolute numbers; `memoryChanges` has no relocation metadata. There is no
object format, no fixup records, no duplicate-label or overlap check
(`js/deep16_assembler.js:34-36`, `:127-130`, `:41-45`, `:266-273`).

Two options:

| Option | What it is | Cost | Verdict |
|---|---|---|---|
| **A — thin chapter linker** (recommended) | Build-time driver that assembles each chapter at its final physical origin, injects cross-chapter `.equ` symbols, merges words with overlap checks, and emits a chapter table for the loader. Assembler core unchanged. | New `js/deep16_linker.js` + source edits for base-relative addresses; image/RTL format change. | Does everything the project needs now. Keyboard/IDE can import the same browser-safe module. |
| B — relocation-aware assembler | Add `.section`, `.reloc`, relocation records and a fixup pass to `js/deep16_assembler.js`. | Touches every assembly path, symbol dump, optimizer and assembler test; needed only for *runtime*-relocatable modules. | Defer. Revisit if slices ever need position independence. |

A works because the code that already moves (Jcc offsets,
`LDI target - local_label`, BIOS `foo - BIOS_BASE`, all of `softfloat.asm`) is
**position-independent under a whole-chapter move**. The only things a linker
must resolve are cross-chapter absolute addresses and chapter boundaries —
both can be expressed with generated `.equ` prologues, which the assembler
already understands (`js/deep16_assembler.js:213-228`).

The other half of the answer is to take absolute addresses *out of the
instructions altogether*. `LDI` writes only `R0` and sign-extends a 15-bit
field, so `0x4000`–`0xBFFF` is unencodable and the kernel is full of shift/OR
workarounds (`js/deep16_assembler.js:1385-1397`, `asm/softfloat.asm:183`). A
small index *is* always encodable, so code can do
`LDI CONST_foo; LDS Rx, CS, R0` and read the real value from a
linker-generated constant pool (§3.5). The kernel already uses precisely this
idiom for the BDOS far-call pair (`bps2_done` reads its CS:PC pair with
`LDS R10/R11, CS, R2`, `asm/forth_nano.asm:13048-13056`) and for the
CS-resident `bd_poll` cell (`:1663-1672`, `:2164`). With a pool, a layout
change rewrites pool words only; the instructions never change.

## 2. Target map

| Segment | Physical | Chapters | Notes |
|---|---|---|---|
| `CS=0x0000` | `0x00000` | the **whole `CS=0` segment**: vectors `0..2`, kernel code `0x0100`–`0x2D49`, the Forth float surface (`0x417D`, scanner `0x3FE9`, printer cells `0x67C8`, parser `0x6800`), short far trampolines, the ILL entry stub and IRQ handler `0x51A0`, constant pool (§3.5) | entry stays at physical `0x00100` so PSRAM boot verification is unchanged; pool indices stay `< 0x4000` |
| `DS=0x1000` | `0x10000` | kernel data + boot script, return stack `0x2000`–`0x2FFF`, dictionary | no system code in this segment at all |
| `SS=0x2000` | `0x20000` | data stack | unchanged |
| **`CS=0x3000`** | `0x30000` | **BIOS + ILL handler + FloatLib + PS/2 tables + showcase menu** (~13 K words of 64 K) | one *system* chapter: ILL reaches BIOS division and FloatLib without far calls or duplicated code |
| **`CS=0x4000`** | `0x40000` | **BDOS entry, jump table, all 30 handlers and scratch** (~2 K words) | far-called; callers unchanged except the entry address constants |
| `ES=0xF000` | `0xF0000` | MMIO, echo cell, boot ROM | unchanged |
| `CS=0xE000` | `0xE0000` | sound window | unchanged |
| reserved | `0x50000`, `0x6000`, `0x70000`, `0x80000` | Flappy / Frogger / Pole / BDOS dir | runtime slices — do not use for chapters |

A chapter is a **destination range in one segment**, not a source range in the
flat image. The kernel chapter is therefore the entire `CS=0` segment
(`0x00000`–`0x0FFFF`): everything left in `CS=0` after Phases 2–3 belongs to it,
including the sparse float surface and free gaps. Spelling it out this way
keeps the §3.3 "every word falls in exactly one chapter" rule trivial instead
of fragile, and lets the linker treat unwritten words as owned-but-FILL rather
than as an overlap. The other chapters are `DS=0x1000` (the mirror of the
kernel-data range), `CS=0x3000` (system) and `CS=0x4000` (BDOS).

Why two new segments and not one per component:

* ILL **must** be near BIOS today (division routines) and near FloatLib by
  design; splitting those into separate segments just adds far-call overhead
  and a second trampoline for no isolation benefit.
* BDOS is the one component with a clean far-call ABI already (`JML R2`,
  `R10:R11` return pair), so it is the natural separate segment.
* If stronger isolation is wanted later, ILL can move to `CS=0x9000` and
  FloatLib to `CS=0xA000` (both unused); the chapter table makes that a
  one-line layout change plus two trampolines.

## 3. The chapter linker

### 3.1 Module

`js/deep16_linker.js` — browser-safe (no `node:fs`, no `crypto`, no CLI side
effects), consumed by both `scripts/make_image.mjs` and
`js/deep16_d16d_image.js`. `scripts/link_image.mjs` is a thin Node CLI wrapper
for debugging/manifests.

### 3.2 Layout declaration

```js
linker.link({
  chapters: [
    { id: 'kernel', seg: 0x0000, base: 0x00000, sources: [{ name: 'forth_nano.asm', text }], fill: 0xFFFF },
    { id: 'sys',    seg: 0x3000, base: 0x30000, sources: [{ name: 'bios', text }, /* ... */] },
    { id: 'bdos',   seg: 0x4000, base: 0x40000, sources: [{ name: 'bdos_block.asm', text }] },
  ],
  imports: {
    bdos: ['bdos_entry', 'bdos_version', /* ... */],
    sys:  ['ill_restore_shared', 'bios_div16_call', /* ... */],
  },
  window: 0x7000,
  fill: 0xFFFF,
});
```

The chapter list is a value passed to `link()`, not an ES export: the linker
is a browser script loaded by `index.html` and the Node builders, so it has no
module exports. `Deep16Linker.flat()` is the Phase 1 single-chapter shorthand.
Each chapter has its own assembler instance (so label names cannot clash) and
its own `.org`s rewritten to `base + offset`. `entry` / `trampoline` metadata
is attached to the chapter, not hard-coded in the loader.

### 3.3 Twomake: Nothing to be done for `default'.
- V e r i l a t i o n   R e p o r t: Verilator 5.052 2026-09-05 rev vUNKNOWN-built20260905
- Verilator: Built from 0.000 MB sources in 0 modules, into 0.000 MB in 0 C++ files needing 0.000 MB
- Verilator: Walltime 0.158 s (elab=0.000, cvt=0.000, bld=0.156); cpu 0.001 s on 1 threads; allocated 3.188 MB
ok   loader finished without error    = 0x0000
ok   loader done                      = 0x0001
ok   entry word 0x0100                = 0x1000
ok   flat word 0x0000                 = 0xf880
ok   flat word 0x0100                 = 0x1000
ok   flat word 0x3000                 = 0x0000
ok   DS copy of 0x3000                = 0x0000
ok   BIOS copy of 0x4A00              = 0x1000
ok   BIOS copy of 0x5800 (FPU)        = 0xfa98
ok   BIOS copy of 0x6000 (FEXP)       = 0xc3d8
ok   BDOS chapter entry at 0x40000    = 0xf880
ok   BDOS chapter tail at 0x406F2     = 0xf880
cycles: 3249142
PASS passes, no assembler changes

1. **Placement pass.** Assemble every chapter with its final physical origin
   and a generated prologue `.equ <CHAPTER>_BASE, <base>` etc. Collect the
   symbol table per chapter.
2. **Resolve pass.** Re-assemble each chapter with an additional generated
   prologue of `.equ` lines for its imported cross-chapter symbols, e.g.
   `.equ bdos_entry, 0x40000`. Source code refers to those names directly for
   far targets; local labels and all deltas stay as they are. Imported symbols
   that cross a chapter boundary are instead assigned a small pool index and
   injected as `.equ CONST_<name>, <index>`; code reaches them with the
   `LDC` / `LDC_FAR` macros of §3.5, never with a hand-built immediate.
3. **Merge.** Every `memoryChanges` record must fall into exactly one chapter
   range. Same address written twice with a different value is an **error**
   (not last-write-wins). Unwritten words inside a chapter get `fill`.
4. **Validate.** Chapter ranges do not overlap; each fits in 64 K words;
   vectors are in the kernel chapter; far targets are inside their chapter;
   `dict_free < dictionary base` and dictionary top `<= 0xFFEF`. Pool indices
   are unique and `<= 0x3FFF`, and the pool lives in a fixed code segment.
   The linker rejects a relocated absolute address in **every** form, not just
   `LDI`: any `LDI <symbol>` or `MOV PC, <symbol>` whose resolved value is not
   in `0x0000`–`0x3FFF` or `0xC000`–`0xFFFF` once rebased, and any
   `LDI <symbol> / 2`/`>>`/`SL`-based address builder (the `sread` return-PC
   trick, `asm/forth_nano.asm:20160`) that no longer fits the field. These are
   not only in the jump tables: `LDI bdos_unknown; MOV PC, R0`
   (`asm/forth_nano.asm:1577`) is a >16-bit PC once BDOS is assembled at
   `0x40000`. `.word` entries that hold absolute addresses are checked the
   same way and must become `symbol - <CHAPTER>_BASE`.
5. **Emit.** `{ chapters[], symbols, flatView, manifest }`. `flatView` is a
   compatibility view for the old scatter/tests during migration.

### 3.4 Image/loader format

Keep the existing 64-word flash header (`FLASH_HDR_WORDS = 64`) and payload
start (flash word 64). Put the chapter table **inside the unused header words**:

```
word 0  magic 0x44313646
word 1  format = 2            (1 = legacy hardcoded-window scatter, still accepted)
word 2  total 32-bit flash words
word 3  payload CRC-16        (unchanged, low byte of each CPU word first)
word 4  build id
word 5  chapter count
word 6  header CRC-16, computed over words 0..63 with word 6 read as 0
word 7  reserved
word 8..  per destination: { id, seg, base, srcPairStart, wordCount, flags }
word 63 reserved / pad
```

Word 6 must not cover itself: verify with word 6 treated as zero, or the check
is circular. Cover every other header word (including `format` and the payload
CRC field), so a corrupted `format` cannot slip past on its way to selecting a
parser. Header words 0..63 are **32-bit flash words**; the payload after word
64 still packs two 16-bit CPU words per flash word. The header CRC processes
each 32-bit word's four little-endian bytes.

A format-2 entry is three 32-bit header words:

```
word 0  seg[15:0], id[23:16]
word 1  base[15:0], srcPairStart[31:16]
word 2  wordCount[15:0], flags[31:16]   (flags bit 0 = source starts high)
```

A table entry names **one destination**, not one source. The loader still
writes the same source range to two destinations (flat `0x3000..0x57DC` →
`DS=0x1000`; flat `0x4A00..` → `CS=0x3000`), and those source ranges overlap
each other. Format 2 therefore allows several entries to point at the same or
overlapping source ranges — the DS mirror is simply a second entry with
`seg=0x1000`, `base=<kernel-data offset>` and the same `srcPairStart`. The RTL
loop must not assume entries are sorted or that source ranges are disjoint; it
iterates entries and, for each, copies `wordCount` words from `srcPairStart`.
The flat image itself stays implicit: the canonical payload pass copies it and
captures `entry_exp`.

The payload CRC must also stay **per source pair, not per destination**: the
DS mirror re-reads flash words the flat copy already streamed, and feeding them
to the CRC twice changes the value the header was built with. The current shape
keeps one canonical pass over the payload and drives the table copies after it.

`flash_boot.sv` reads the 64-word header with a 6-bit counter, checks the
header CRC and payload CRC, then uses **one generic copy loop**. Destination is
`(seg << 4) + base + index`; `baddr` is already 20 bits. Format 1 still takes
the hardcoded-window path from Phase 4a (DS mirror, system copy and the nine
BDOS windows), so old bitstreams/images and the installer still work.

The copy happens **before the CPU is released** (`done`/`entry_exp` gate the
core), so no software can read the chapter table first: `flash_boot.sv` *is*
the machine's only reader of config flash at that point. The header layout and
payload start are `localparam`s compiled into the bitstream (`FLASH_WORDS =
14400`, `IMG_WORDS = 28672`, `IMG_PAIRS = 14336`).

### 3.5 Constant pool (`LDC`) — addresses without `LDI` bit tricks

**Mechanism.** A small index is always encodable, so store the real constant
in a linker-emitted pool and read it back:

```asm
LDI CONST_foo          ; index 0..0x3FFF, no sign-extension trap
LDS Rx, CS, R0         ; Rx = [CS:index], one word (doc/Deep16-Arch.md:466)
```

`LD Rx, R0` is the DS-default spelling (offset 0,
`js/deep16_assembler.js:1323-1327`), but **prefer the explicit `LDS`**: DS is
rewritten more than a hundred times in `asm/forth_nano.asm`, and
`DS:0x0000–0x1FFF` is scratch/SD-buffer space that the segmented loader does
not fill from the image. Handlers in the shadow bank must also name their
segment explicitly.

A far target is just two consecutive entries, generalising the kernel's
existing CS:PC pair read (`bps2_done`, `asm/forth_nano.asm:13048-13056`):

```asm
LDI CONST_far_bdos
LDS R10, CS, R0
ADD R0, 1
LDS R11, CS, R0
JML R10
```

**Linker contract.**

* `LDC Rx, foo` emits `LDI CONST_foo; LDS Rx, CS, R0` (2 words).
* `LDC_FAR foo` emits the four-word pair above; the caller keeps the existing
  `R0`/`R1` argument and `R10:R11` return-pair ABI.
* The linker assigns one index per imported symbol, injects
  `.equ CONST_<name>, <index>`, emits the `.word` pool into the kernel chapter
  at a low CS offset, and checks index range/uniqueness (`<= 0x3FFF`).
* If a handler needs a constant in its own segment (e.g. the system chapter),
  give that chapter its own small pool; the macro takes the pool segment as a
  parameter.

**Scope and cost.** Use the pool for addresses, far pointers and the
`0x4000–0xBFFF` range that one `LDI` cannot produce. Do **not** blanket-replace
small values: `LDI 0` occurs ~370 times in the kernel and `LDI 0x1000` ~36 times,
where an inline `LDI` is cheaper. A lookup costs one extra word and a load-use
stall (`doc/Deep16-Prog-Man.md:1235-1241`), and loads do not set flags
(`doc/Deep16-Arch.md:140-151`), so schedule an independent instruction or a
`CMP` before branching; do not put it in a softfloat inner loop without a
measurement. For hard constants it is still 2 words versus 3 for
`LDI low; OR R0,14; OR R0,15`, plus one pool word.

**Relocation payoff.** Because code holds indices rather than addresses,
moving BDOS or FloatLib changes only pool `.word`s. Phase 2 adds a diff test
that changes a chapter base in a scratch layout and asserts no instruction word
outside the pool differs.

## 4. Phases

Every phase ends with `npm test` green and a byte-identical legacy image where
stated. Rollback is `git revert` of that phase; no format changes are
committed before their RTL counterpart is tested.

### Phase 0 — stop silent corruption (and move the colliding blocks)

* Add duplicate-label and overlapping-`.org` detection to
  `js/deep16_assembler.js`; return an explicit `overlap[]` (address, previous,
  value, both source lines, and whether the value changed). A changed-value
  second write is an assembly error by default; `strictOverlap: false` reports
  without failing.
* Duplicate labels are **hard errors**. The shipping sources had three, all
  renamed without moving a word: `bdos_fwrite` (the unimplemented stub) became
  `bdos_fwrite_stub`, the fwrite name cell became `bd_wr_name` so it no longer
  collides with the fcreate/fdelete `bd_name`, and Pac-Man's fall-through
  `pac_k_done` became `pac_k_set_done`.
* Replace last-write-wins **at the component level** with a build error: a
  baked Pac-Man block now claims only FILL words, as the showcase and PS/2
  layout table already did. A component write over live kernel code fails both
  the Node and browser builders.
* Make the browser IDE validate before scattering: `Deep16D16DImage.checkImage`
  now runs inside `buildNano()`/`build()` (bounds, `dict_free`, BIOS block,
  out-of-window words, component collisions), and `scripts/make_image.mjs`
  reports the BIOS range and limit in its error.
* Refresh stale `FPUEMUPLAN.md:499` (`0x2D2F` → `0x2D3F`; the trampolines moved
  to the slot the audit recorded, which also clears `waqr_scan`).
* **Pre-Phase-1 layout pass.** Detection found 17 changed-value double writes
  in the shipping `D16D+FPU` kernel. They were block-into-neighbour collisions,
  not deliberate overlays, and each was moved inside an existing free run:

  | Block | Old | New | Collision removed |
  |---|---|---|---|
  | `bdos_word_call` + wrappers | `0x18C3` | `0x1FC2` (before `post_next`) | `word_esstore` tail at `0x18C3`–`0x18C7` |
  | fitdemo code/data | `0x4480` | `0x447F` | `h_pal_bank` at `0x4579` |
  | `bios_f14`/`bios_f15` stubs | `0x4D00` | `0x5FD7` (softfloat gap) | D16D `bios_f6` gfx tail at `0x4D00`–`0x4D0A` |
  | `sfx_table` | `0x576F` (flow) | `0x6863` (after `sf_parse`) | `bios_out_col`..`bios_gfx_r6` at `0x5790` |
  | `ill_pc_save_bios` | `0x57D0` | `0x57DF` | `bios_f22` code at `0x57D0` |

  All ten assembly units now have zero duplicate labels and zero overlaps:
  D16D+FPU, nano FPU, nano no-FPU, UART flat, UART+`D16SEG`, the legacy kernel,
  and the four showcase slices. `strictOverlap` is therefore the default with
  no baseline or allowlist, and the builders no longer need one.
* **Acceptance:** an overlapping `.org` with a different value fails assembly
  with no options; `D16NANO=1 D16SEG=1 node scripts/make_image.mjs` still
  reports the known `BIOS block 0x4a00..0x5fd6 (5591 words) overruns the
  stacks at 0x5800` error; the shipping `D16D` image builds; `npm test` green.
* **Files:** `js/deep16_assembler.js`, `scripts/make_image.mjs`,
  `js/deep16_d16d_image.js`, `js/deep16_ui_core.js`, `scripts/render_tile.mjs`,
  `tests/assembler.test.js`, `tests/image.test.js`, `asm/forth_nano.asm`,
  `asm/forth_float.asm`, `asm/showcase/pacman_game.asm`, `FPUEMUPLAN.md`.

### Phase 1 — linker scaffold, identical output

* Add `js/deep16_linker.js` and `scripts/link_image.mjs` with the chapter
  schema but a *single* chapter equal to today's flat image.
* Add the constant-pool plumbing and `LDC`/`LDC_FAR` macros to the linker, but
  emit an empty pool and leave existing sources unchanged, so this phase stays
  byte-identical.
* Route Node and browser builders through it; keep `flatView` as the output
  used by the existing scatter.
* **Acceptance:** `image.hex`, `image.mi`, `image.flash.bin` and the manifest
  are byte-for-byte identical to the Phase 0 build (hash comparison test);
  `tests/d16d-image.test.js` Node/browser parity still passes.
* **Implementation note:** `js/deep16_linker.js` is the browser-safe linker;
  `scripts/link_image.mjs` prints/writes the chapter manifest;
  `Deep16Linker.flat()` is the single-chapter layout the builders use.
  `tests/linker.test.js` pins the Phase 0 build id (`8861a2f61fa02c4c`) and
  image CRC (`0xbf4d`), so the routing cannot drift silently. The constant pool
  (`constantPool`, `ldc`, `ldcFar`) and the import prologue are tested but
  receive no entries, so the emitted pool is empty and no source changes.
* **Files:** new linker modules, `scripts/make_image.mjs`,
  `js/deep16_d16d_image.js`, `js/deep16_ui_core.js`, new `tests/linker.test.js`,
  `index.html` (script order), `tests/helpers.js` and the loader lists.

### Phase 2 — BDOS → `CS=0x4000`

**What the source actually looks like.** BDOS is not one block. Its 30 handlers
live in about fifteen `.org` islands, interleaved with Forth words and headers:

* `0x2D4A`–`0x2F3F` — entry, jump table, fns 0–13, `spi_put`/`spi_get`,
  `slice_read`;
* `0x3FCD`–`0x417C` — fns 27–29 (`fcreate`/`fdelete`/`fsize`);
* `0x4680`, `0x4780`, `0x47C0`, `0x4800`, `0x48E0`, `0x4900`, `0x4988`,
  `0x49A0`, `0x49C3` — serial, SPI, palette/I2S/SIC/sample/gfx, fwrite;
* `0x1F78` — `bdos_ps2_init`;
* `0x464E` — `fw_restore` (fwrite), reached through a hard-coded
  `LDI fw_restore - 0x4000` builder.

Between those islands are Forth wrappers and headers that must stay in `CS=0`
(`word_serialread`, `word_pal_bank`, `word_bslice`, `word_spi_ctrl`, the
`h_*` catalog headers, fitdemo). The handlers also depend on kernel-side
helpers: `slice_read`/`spi_put`/`spi_get` (shared with `word_bslice`),
`fd_program`/`fd_cmd`/`fd_wait`/`fd_wren` at `0x0475` (shared with the flash
words), and `bps2_send`/`bps2_wait_ticks` (shared with the PS/2 host code).
Scratch is **CS-relative**: the 0x3FCD block alone has 31 `CS,` accesses, so
moving a handler changes which cells it reads unless the cells move too or get
mirrors. Two hard-coded `-0x4000` address builders (`fw_restore`,
`fd_pg_part2`) need rebasing.

**Split so each step is independently testable:**

* **2a — enabler (done).** The linker now supports *segment-relative* chapters:
  the source keeps its in-segment offsets (`.org 0x2D4A` → `PC=0x2D4A` at
  `CS=0x4000`), and the linker lays that chapter at `(seg << 4) + offset` and
  returns per-chapter images. `tests/linker.test.js` covers a relative chapter
  at `CS=0x4000` and keeps the Phase 1 fingerprint. Next: a `bdos_seg` pool
  entry (`0x4000`) in the kernel chapter and an ABI test that `JML R2` with
  `R2=0x4000` enters the chapter and returns via `JML R10`.
* **2b — the dictionary-blocking block (done).** `asm/bdos_block.asm` holds the
  `0x3FCD`–`0x417C` slice (`fd_pack` + `fcreate`/`fdelete`/`fsize`) plus copies
  of `slice_read`/`spi_put`/`spi_get`, `bdos_abort`, `fw_restore`, the
  config-flash drivers and the `bd_*` cells it touches. It assembles with its
  original in-segment offsets and is placed at `CS=0x4000`. The kernel jump
  table now points at `bdos_fcreate_far`/`bdos_fdelete_far`/`bdos_fsize_far`
  at `0x3FCE`/`0x3FD4`/`0x3FDB`; the cell at `0x3FCD` holds `0x4000`. The old
  flat range is FILL. The chapter's copied `fd_pack` mirrors the packed name
  to `CS` for the fcreate/fdelete compare and writes the driver buffer to
  `ES`, because the original relied on `CS=0`.
  `tests/bdos.test.js` places the chapter at `0x40000`, asserts the flat
  `0x3FFC` is gone and poisons it; `tests/editor.test.js` places the chapter
  for the editor's save path.
  **Intermediate state:** the flat image and `scatterD16SEG()` do not carry
  the chapter yet, so fns 27..29 are simulator-tested only until Phase 4a.
  Do not flash a board from this commit.
* **2c-0 — put the chapter into the loader (done).** Moving the *entry* means
  every kernel boot enters `CS=0x4000`: the showcase menu, the editor slice and
  the boot-time ps2-init call all go through it. The loader now carries the
  chapter in every JS path:
  - `scatterD16SEG(..., { bdos })` writes the chapter's offsets at `0x40000`;
  - `assembleNano`/`buildNano`/`build` accept `bdosBlock` and expose
    `image.bdos`; the page fetches `asm/bdos_block.asm` for both tile builds;
  - `scripts/make_image.mjs` links the chapter and returns `img.bdos`;
  - `tests/helpers.js buildMemory()`/`placeBdos()` place it for kernel images;
    every manual-memory harness (segmented, ps2-raw, spi-bios, …) calls
    `placeBdos`;
  - the browser builder/Node builder parity test compares `bdos.words`.
  The **board** loader still cannot carry it until Phase 4a; this is
  simulator-only.
* **2c-1 — entry, table and fns 0..7 (done).** The chapter owns the entry
  (`0x2D4A`), the jump table and fns 0..7. Fns 8..26 still run in the kernel
  and are reached through far stubs at `0x5000` that set CS=0 and jump to the
  handler; fns 27..29 are the chapter's own. A shared `bdos_call` stub at
  `0x3FE2` (`R7` carries the function) is how every kernel caller enters
  CS=0x4000. The non-nano build keeps the old flat entry and fns 0..7 under
  `.ifndef D16NANO`, so the legacy/D16SIM examples still build (gated call
  sites). The editor and menu slices jump to the shared kernel stub at
  `0x3FE2`, so they do not hard-code `0x4000`.
* **2c-2 — the gap handlers (done).** The chapter now owns `bdos_serial_read`,
  `bdos_read_slice`, `bdos_spi_ctrl`/`spi_xfer`, `bdos_fwrite`, the
  palette/I2S/SIC/sample handlers, the gfx handlers, `bdos_ps2_init`, the
  `bps2_send`/`bps2_wait_ticks` helpers, `fw_part2`/`fw_err5` and the
  `bd_src_*`/`bd_count` cells. The `0x5000` far stubs are gone; the chapter's
  table points straight at the real handlers, and the total is 1,789 words.
  The kernel keeps its flat copies of the gap handlers because the non-nano
  profile still dispatches through the restored flat table; under D16D those
  copies are unreachable (the chapter table is the only dispatcher). Gating or
  deleting them belongs with retiring the flat profile (Phase 4a/5), not this
  step. `bd_count` stays DS-relative and shared; the other cells are
  chapter-local. The flash drivers (`fd_pg_part2`, the `0x0475` block) and
  `fw_restore` remain in both places for the same reason.

  Note: the 2b `fd_pack` CS mirror adds one word, so the chapter handlers are
  at `0x3FFD`/`0x40AB`/`0x411F`; the kernel's 2b trampolines were corrected to
  match. The 2c-1 table uses the chapter's labels, not hard-coded offsets.

**Target bullets (2c finishes them):**

* Extract the BDOS block from `asm/forth_nano.asm` into its own source;
  `.org` it at `0x40000` under a `BDOS_BASE` equ. Change `BDOS_JTABLE` entries
  to `handler - BDOS_BASE` and dispatch with `LDS R2,CS,R3` after establishing
  `CS=BDOS_SEG` in the far entry stub.
* Keep kernel-side far-call stubs at `CS=0`, but have them read the CS:PC pair
  with `LDC_FAR` (the generalisation of the `bps2_done` pair at
  `asm/forth_nano.asm:13048-13056`);
  no `LDI 0x4000`-class constant remains in those stubs. Existing `call-far`,
  menu and BIOS callers keep their ABI.
* Move `bd_count`/scratch out of DS `0x2F40` into the BDOS segment, except the
  cells the kernel writes directly (those get a tiny kernel-side mirror).
* **Acceptance:** `tests/bdos.test.js` drives all functions from the new
  segment; a test poisons flat `0x2D4A` and confirms calls still work;
  `dict_free` no longer has to skip `0x3FCD`–`0x417C` in the D16D build; a
  scratch-layout diff changes a chapter base and proves only pool words move.
* Phases 2–3 are simulator-verified only until Phase 4a adds the `CS=0x4000`
  window to the loader. Do not flash a board from an intermediate commit.
* **Files:** `asm/forth_nano.asm`, new `asm/bdos_block.asm`, linker layout,
  `tests/bdos.test.js`, `tests/segmented.test.js`.

### Phase 3 — ILL + FloatLib into the system segment

* **3a — ILL handler (done).** `asm/ill_block.asm` holds the handler, its
  dispatch/get/put stubs and the `ill_save_sp`/`ill_flags` cells at their
  system offsets (`0x0600`, `0x044C`, `0x0743`). The linker places it as a
  `seg=0x3000` relative chapter; `scatterD16SEG(..., { sys })` writes it at
  `0x30000` after the BIOS copy, so the `0x4D24` trampoline still enters
  `CS=0x3000:0x0600`. Under D16D the flat `0x5000`–`0x519F` is FILL; the
  non-D16D profiles keep the flat handler under `.ifndef`/`.else` for their
  direct vector. `ill_fpu` is imported as the system offset `0x151B`;
  `ill_pc_save_bios`/`bios_div16_call` keep their BIOS-copy offsets.
  The browser builder, Node builder, UI, render harness and `buildMemory()`
  all carry the sys chapter; `tests/d16d-fpu.test.js` asserts the handler is
  in the system chapter and the flat ILL range is FILL.
* **3b — FloatLib (done).** `systemSoftfloat()` shifts the flat library's two
  `.org` blocks by `-0x4A00` (`0x0E00`/`0x1600`) and defines
  `ill_restore_shared=0x0728`; the result joins the `sys` chapter after the ILL
  block. Flat `0x5800`–`0x6475` is FILL; `ill_fpu` is at system `0x151B`,
  `f_unpack` at `0x0E00` and `fexp32` at `0x1600`.
* **3c — direct calls (done).** There are **nine**, not five: `i2f` at `s>f`
  and the `f.` integer/fraction, `f2i` at `f>s` and the `f.` fraction, plus
  four `u2f` calls in the literal builder. `CS=0` shims at
  `0x46DC`/`0x46EA` store the `LINK` return PC in the cell `0x2F36` and
  far-jump; system stubs read it via `ES=0` and return (4a moved them to
  `0x049F`/`0x04A7` so their flat image span stays free).
  The i2f/u2f stub preserves `R2:R3`; the f2i stub preserves both `R0` and the
  `R10` flags. The stubs sit after the library and before the PS/2 decoder
  copy (`0x1F9C`). The call sites are gated so the non-D16D flat FPU build
  keeps the old PC-relative calls.
* **3d — scanner relocation (done).** The literal scanner and probe no longer
  sit in the PACMAN gap (`0x4330`/`0x48A9`); they occupy the declared
  `0x3FE9..0x40E7` run at the head of the freed BDOS slice. The float words
  stay in `0x417D..0x42EF`, the transcendental headers/words at
  `0x42EF..0x430F`, and the build/parse halves plus the `f.` cells in the
  `0x6724..0x6862` tail. The old `BAKE_PACMAN` image path was removed, so the
  `0x4330` gap is free and Pac-Man exists only as the config-flash slice.
  `tests/d16d-fpu.test.js` pins the scanner run, and
  `scripts/make_image.mjs` rejects an out-of-run scanner.
* **Acceptance:** the library exists *only* in the system chapter; the
  un-staged flat `0x5800`–`0x6475` is FILL (Phase 4a later stages it for the
  loader), and `s>f`, `f>s`, `f+`, `fexp` and float literals
  all run through the chapter (verified by `d16d-fpu`, `ps2-raw`,
  `native-lila` and the full suite). The `CS=0` ILL entry trampoline remains a
  far jump. The scanner no longer touches the PACMAN gap.
* **Files:** `asm/forth_nano.asm`, new `asm/ill_block.asm`,
  `asm/softfloat.asm`, `asm/forth_float.asm`, the linker/builders,
  `tests/d16d-fpu.test.js`, `tests/ill-fpu.test.js`, `tests/forth-float.test.js`.

### Phase 4a — loader windows for the chapters (done, format 1)

* BDOS was re-laid densely at `CS=0x4000`: entry `0x0000`, jump table
  `0x000F`, fns 27–29 `0x0236`/`0x02DE`/`0x034E`; the whole chapter is 1,821
  words ending at `0x0725`. The stale `-0x4000`/OR-bit-14 entry builders are
  gone, the kernel stubs use the new offsets, and `bd_count` stays the shared
  DS cell at `0x2FB8`.
* `flash_boot.sv` keeps `FORMAT = 1`, the 64-word header, `IMG_WORDS = 28672`
  and the 14,400-word installer. It gains nine hard-coded windows that copy
  the dense BDOS chapter from free flat runs to `CS=0x4000` after the CRC
  pass. The system chapter is staged at flat `0x4A00 + offset`, so the existing
  BIOS window carries it; the two FPU return stubs moved to system
  `0x049F`/`0x04A7` to keep their flat span free.
* `Deep16D16DImage.stageChapters()` and `scripts/make_image.mjs` write the same
  staging words into the flat image; the browser and Node images stay
  word-for-word equal. `scatterD16SEG()` still overlays the chapter images
  directly, so simulator memory equals the board windows.
* **Acceptance:** `scripts/build_flash_boot_sim.sh` passes, including
  the BDOS entry at `0x40000` and the last staged word at `0x406F2`; the full
  `npm test` suite passes; the image was still format 1 at this step and the
  installer is unchanged. Phase 4b then adds the format-2 table. The dictionary
  reclaim remains Phase 5.
* **Files:** `rtl/flash/flash_boot.sv`, `rtl/sim/flash_boot_tb.*`,
  `asm/bdos_block.asm`, `asm/forth_nano.asm`, `asm/ill_block.asm`,
  `asm/forth_float.asm`, `js/deep16_d16d_image.js`, `scripts/make_image.mjs`,
  boot tests.

### Phase 4b — format 2 chapter table (done)

* `flash_boot.sv` now reads the 64-word header with a 6-bit counter, checks
  magic/format/count and the payload CRC, then parses three-word entries at
  words 8..: `{seg,id}`, `{base,srcPairStart}`, `{wordCount,flags}`. One
  generic loop copies each entry to `(seg << 4) + base`; entries may be
  unsorted and may repeat source ranges. The source half is selected by
  `flags[0]`, so odd starts work. The generator enforces table capacity and
  entry bounds; the fitted loader checks only a nonzero count.
* Format 1 is legacy: word 2 is the image word count; it copies the flat image,
  DS mirror and BIOS window but stages no chapters. Format 2 word 2 is the
  total 32-bit flash words (14,400) and is the only format that carries BDOS,
  relocated headers and the high DS cells. The header CRC field is generated
  for software, but the fitted GW1NR-9 loader does not verify it; the payload
  CRC still covers the image.
* `flashImage()` emits format 2 for D16D images and still accepts
  `{ format: 1 }`; `chapterTable()` emits the DS mirror, system copy and nine
  BDOS entries. `Deep16D16DImage.chapterTable()`/`scatterD16SEG(..., {table})`
  mirror it in the browser and IDE, so simulator memory follows the same table.
* **Acceptance:** `scripts/build_flash_boot_sim.sh` boots **both** formats and
  checks the BDOS entry/tail; the full `npm test` suite passes; the image is
  still within the 14,400-word installer window.
* **Files:** `rtl/flash/flash_boot.sv`, `rtl/sim/flash_boot_tb.*`,
  `scripts/make_image.mjs`, `scripts/build_flash_boot_sim.sh`,
  `js/deep16_d16d_image.js`, `js/deep16_ui_core.js`, boot tests.

### Phase 5a — relocate the built-in Forth surface

The range `0x3FBA`–`0x57FF` is not empty: it holds 40 built-in Forth headers
(`h_bslice`, `h_spi_xfer`, `h_fexp`, …) plus the DS-resident `spi_caps`,
`ps2_layout` and keyboard-ring cells. The dictionary can only start at
`dict_free` after those data are moved to the top of DS:

| DS range | What | Source |
|---|---|---|
| `0xFB80`–`0xFD01` | relocated headers | flat `0x417D`–`0x42FE` (386 words) |
| `0xFD02`–`0xFF9D` | relocated headers | flat `0x4440`–`0x46DB` (668 words) |
| `0xFF9E`–`0xFFA7` | relocated headers | flat `0x4D2A`–`0x4D33` (10 words) |
| `0xFFA8`–`0xFFB7` | relocated headers | flat `0x5480`–`0x548F` (16 words) |
| `0xFFC0` | `spi_caps` | flat `0x4D20` (old cell kept) |
| `0xFFC1` | `ps2_layout` | flat `0x57DC` (old cell kept) |
| `0xF000`–`0xF085` | keyboard head/tail/ring and the two `divtest` strings | flat `0x52C0`–`0x5345` (134 words) |

Header ranges keep their source-relative offsets, so code gaps are copied too;
only the link fields are rewritten. `relocateHeaders()` traverses the
`forth_wl` chain, groups headers whose addresses are within `0x120`, assigns
the high destinations, patches every link (including below-`dict_free` headers
that point upward), and patches the `forth_wl` cell. The old flat headers and
data cells remain as loader sources but are no longer in the DS mirror.

Dictionary base becomes `dict_free` (`0x3FBA`) and the ceiling `0xEF80`.
The keyboard/string block sits at `0xF000`, above the data stack top, so the
stack cannot reach the relocated headers at `0xFB80`. The PC-visible probe
stays at DS `0x5800`.

### Phase 5b — loader, kernel and module integration

* Format 2 adds four header entries and three high-data entries to the chapter
  table (11 existing + 7 = 18, the header capacity); format 1 remains the
  legacy flat/BIOS path and does not stage chapters. The first fitted attempt
  with nine format-1 BDOS windows plus the seven high windows exceeded the
  GW1NR-9 logic/CLS budget; the final tile build fits at 8513/8640 logic
  (CLS 4320/4320).
* The DS mirror ends at `dict_free-1`; the system copy is unchanged.
* `asm/forth_nano.asm`: split `PSRAM_PROBE_HI` from the dictionary base, point
  `dp_var`/`dict_base_var` at `dict_free`, set the PSRAM limit to `0xEF80` and
  the data stack top to `0xF000`; give `spi_caps`, `ps2_layout` and `kbd` high
  labels and the keyboard/string block a high base under `D16BOARD`; move the
  IRQ/BIOS keyboard base and the PS/2 decoder to the high cells. The flat and
  generic `D16SEG` builds keep the old low layout.
* `screens/flash/essentials.fth` checks the high capability cell and the old
  `0x4D20`; `forth/start.fth` chooses `0xFFC1` on PSRAM and `0x57DC` on BSRAM.
* `js/deep16_d16d_image.js` and `scripts/make_image.mjs` emit the relocation,
  the format-2 table and the matching `scatterD16SEG()` fallback. `D16D`
  images use the `0x7000` window even without the FPU library.
* Update `MEMLAYOUT.md`, `MEMMAP.md`, `USERFLASH.md`, `HARDWARE.md`,
  `FPUEMUPLAN.md` and the tests that pinned `dict_base_var`, `forth_wl`,
  `h_fexp`, `spi_caps` or `ps2_layout`.
* **Acceptance:** D16D `free` grows by about 5 K words; the full `npm test`
  suite and both format boots pass; `1000 deep`, editor input, PS/2 layout,
  BDOS and FPU smoke tests run from the relocated cells.

#### Phase 5b implementation notes

The first trial failed because the range `0x3FBA`–`0x57FF` is not only headers
and three cells. Flat code still needs the `divtest` strings at `0x532E`, and
the core's data stack is DS-relative even though the boot writes `SS=0x2000`.
The committed layout handles both without moving the showcase:

* The keyboard ring and the two `divtest` strings are copied as one 134-word
  block from flat `0x52C0`–`0x5345` to DS `0xF000`–`0xF085`. The strings are
  reached through `divtest_ok_hi`/`divtest_fail_hi`, so `print_text` still reads
  the live DS copy.
* The data stack top is `0xF000` and the dictionary ceiling `0xEF80`; the
  relocated headers at `0xFB80` are above the stack and cannot be reached by a
  deep stack. The existing `1000 deep` test exercises this.
* The D16D showcase stays at physical `0x4A00`/segment `0x04A0`; it is flat
  memory, not a DS copy, so the DS dictionary does not touch it.
* `irq_audio_fill` is kept at an even address (two NOPs before it, one timing
  NOP removed later), because its loop-back uses `label / 2; SL`.
* Generic nano and flat `D16D` builds use the old low layout; only the
  `D16BOARD` build (`D16D && D16SEG`) relocates.

### Phase 5c — remove the obsolete flat checks

* Delete the old `BIOS_BASE`/`STACK_BASE` assertions from `checkImage` once
  the dictionaries and chapters are measured from the linker output.
* Replace them with per-chapter bounds and a `dict_free < 0x4000` guard so the
  boot probe's `LDI dict_free` stays encodable.
* **Files:** `asm/forth_nano.asm`, `screens/flash/essentials.fth`,
  `forth/start.fth`, `js/deep16_d16d_image.js`, `scripts/make_image.mjs`,
  `rtl/flash/flash_boot.sv`, `tests/segmented.test.js`,
  `tests/d16d-image.test.js`, `tests/d16d-fpu.test.js`, docs.

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| FPGA is nearly full (39–83 CLS free, `HARDWARE.md:183-192`, `USERFLASH.md:190-199`) | Run `synth:tile` after Phase 4a (window retune) and again before committing format 2 in 4b; keep the chapter table in header RAM/ROM, not registers; 4a's constants-only change is the fallback if the fit fails. |
| 15-bit signed `LDI` cannot hold physical addresses like `0x40000` (`tests/forth.test.js:2002`) | All cross-chapter targets use `seg` + `base-relative delta` pairs or the `LDC`/`LDC_FAR` pool of §3.5; the linker generates base equ's, assigns indices and checks the delta range. |
| ILL entry is hardware-fixed to `CS'=0` with a single 16-bit vector word (`doc/Deep16-Arch.md:218`) | Keep a thin `CS=0` entry stub (the `swi_to_bios` shape, `asm/forth_nano.asm:703`); the far target comes from the pool. Never assume the handler can be vectored directly. |
| Pool lookup adds a load-use stall and loads do not set flags (`doc/Deep16-Prog-Man.md:1235-1241`, `doc/Deep16-Arch.md:140-151`) | Schedule an independent instruction or a `CMP` after `LDC`; keep hot loops and small immediates inline; measure before converting softfloat constants. |
| Pool index lands in `0x4000–0xBFFF` or the pool sits in a swapped DS window | Linker rejects indices `> 0x3FFF` and places the pool in a named code segment; handlers use explicit `LDS`, with a per-chapter pool copy where needed. |
| Header/CRC mismatch bricks the board | Keep format 1 accepted; add header CRC; A/B test old and new images on the same bitstream; verify `0x100000` boot and `0x13000` file size with the flashing scripts. |
| IDE duplicates Node layout rules | Phase 1 forces both through one browser-safe linker module; keep the word-for-word parity test. |
| Test churn (≈15 test files pin flat addresses) | Phases 2–4b update tests to assert chapter metadata instead of flat addresses; `flatView` keeps unrelated tests alive until their phase. |
| Runtime segment conflicts | Layout reserves `0x5000`, `0x6000`, `0x7000`, `0x8000` for game slices/dir; linker rejects a chapter that overlaps a reserved segment. |
| Boot probe false positive if dictionary base moves into BSRAM | Phase 5 keeps the probe address unchanged and moves only the assigned dictionary base. |

## 6. Definition of done

* No `.org` in a shipped source can silently overwrite another block.
* BIOS, BDOS, ILL handler and FloatLib live outside `DS=0x1000`; Forth code
  and data cannot grow into them, and they cannot grow into Forth.
* `D16NANO=1 D16D=1 D16SEG=1 node scripts/make_image.mjs` succeeds (today it
  fails with `BIOS (5591 words) overruns the stacks`).
* `npm test` green, RTL flash-boot test green, board boots from a format-2
  image and runs Forth, BDOS file ops, `1000 deep` and float arithmetic.
* The ILL and SWI entries remain thin `CS=0` far stubs; no vector holds a
  20-bit call target, and no stub embeds its target as a literal.
* All cross-chapter addresses and far pointers come from the linker-generated
  pool; moving a chapter in a scratch layout changes only pool words (verified
  by diff test), with no hand-built `LDI` bit tricks for addresses.
* `MEMLAYOUT.md` matches the assembler/loader symbols again.
