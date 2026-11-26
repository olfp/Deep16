# MEMFIXPLAN — clean up the memory map with chapters and a thin linker

Status: **plan only**, 2026-11-26. Companion to `MEMLAYOUT.md` (audit) and
`MEMMAP.md` (hardware/MMIO reference). Nothing in this file has been
implemented yet.

## 0. Goal, scope, non-goals

**Goal:** stop silent address collisions by construction, and give BIOS, BDOS,
the ILL handler and FloatLib their own address space so none of them can ever
grow into the Forth dictionary or stacks.

**Scope:** the D16SEG/D16D tile image (24 K / 28 K flat image, scattered into
segments by `flash_boot`). The 1 MiB screen/IDE build stays flat and untouched.

**Non-goals:**

* No ISA change. `phys = (segment << 4) + offset` stays.
* No runtime relocation of game slices. `bdos_load`, Flappy (`seg 0x5000`),
  Frogger (`seg 0x0600`), Pole (`seg 0x7000`) and the BDOS directory buffer
  (`seg 0x8000`) keep their fixed segments.
* No separate segment for the **return stack**: every access is a DS-relative
  `LD`/`ST`, so it stays a DS window below the dictionary. The data stack
  already is its own segment (`SS`).
* No "full" linker with dynamic objects. This is a build-time chapter linker.

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

## 2. Target map

| Segment | Physical | Chapters | Notes |
|---|---|---|---|
| `CS=0x0000` | `0x00000` | vectors `0..2`, kernel code `0x0100`–`0x2D49`, short far trampolines, IRQ handler `0x51A0` | entry stays at physical `0x00100` so PSRAM boot verification is unchanged |
| `DS=0x1000` | `0x10000` | kernel data + boot script, return stack `0x2000`–`0x2FFF`, dictionary | no system code in this segment at all |
| `SS=0x2000` | `0x20000` | data stack | unchanged |
| **`CS=0x3000`** | `0x30000` | **BIOS + ILL handler + FloatLib + PS/2 tables + showcase menu** (~13 K words of 64 K) | one *system* chapter: ILL reaches BIOS division and FloatLib without far calls or duplicated code |
| **`CS=0x4000`** | `0x40000` | **BDOS entry, jump table, all 30 handlers and scratch** (~2 K words) | far-called; callers unchanged except the entry address constants |
| `ES=0xF000` | `0xF0000` | MMIO, echo cell, boot ROM | unchanged |
| `CS=0xE000` | `0xE0000` | sound window | unchanged |
| reserved | `0x50000`, `0x6000`, `0x70000`, `0x80000` | Flappy / Frogger / Pole / BDOS dir | runtime slices — do not use for chapters |

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
export const CHAPTERS_D16D = [
  { id: 'kernel',  seg: 0x0000, base: 0x00000, sources: ['forth_nano.asm'],        fill: 0xFFFF },
  { id: 'sys',     seg: 0x3000, base: 0x30000, sources: ['bios', 'ill', 'softfloat', 'forth_float'] },
  { id: 'bdos',    seg: 0x4000, base: 0x40000, sources: ['bdos_block.asm'] },
];
export const IMPORTS = {
  bdos:  ['bdos_entry', 'bdos_version', /* ... */],
  sys:   ['ill_restore_shared', 'bios_div16_call', /* ... */],
};
```

Each chapter has its own assembler instance (so label names cannot clash) and
its own `.org`s rewritten to `base + offset`. `entry` / `trampoline` metadata
is attached to the chapter, not hard-coded in the loader.

### 3.3 Two passes, no assembler changes

1. **Placement pass.** Assemble every chapter with its final physical origin
   and a generated prologue `.equ <CHAPTER>_BASE, <base>` etc. Collect the
   symbol table per chapter.
2. **Resolve pass.** Re-assemble each chapter with an additional generated
   prologue of `.equ` lines for its imported cross-chapter symbols, e.g.
   `.equ bdos_entry, 0x40000`. Source code refers to those names directly for
   far targets; local labels and all deltas stay as they are.
3. **Merge.** Every `memoryChanges` record must fall into exactly one chapter
   range. Same address written twice with a different value is an **error**
   (not last-write-wins). Unwritten words inside a chapter get `fill`.
4. **Validate.** Chapter ranges do not overlap; each fits in 64 K words;
   vectors are in the kernel chapter; far targets are inside their chapter;
   `dict_free < dictionary base` and dictionary top `<= 0xFFEF`.
5. **Emit.** `{ chapters[], symbols, flatView, manifest }`. `flatView` is a
   compatibility view for the old scatter/tests during migration.

### 3.4 Image/loader format

Keep the existing 64-word flash header (`FLASH_HDR_WORDS = 64`) and payload
start (flash word 64). Put the chapter table **inside the unused header words**:

```
word 0  magic 0x44313646
word 1  format = 2            (1 = legacy flat scatter, still accepted)
word 2  total 32-bit flash words
word 3  payload CRC-16        (unchanged, low byte of each CPU word first)
word 4  build id
word 5  chapter count
word 6  header CRC-16 over words 0,2,4..63
word 7  reserved
word 8..  per chapter: { id, seg, base, srcPairStart, wordCount, flags }
word 63 reserved / pad
```

`flash_boot.sv` reads the table (it currently reads 8 header words with a
3-bit `hdr_i`: `rtl/flash/flash_boot.sv:109-135`), checks both CRCs and bounds,
then uses **one generic copy loop** instead of the three hard-coded windows at
`:168-239`. Destination is `(seg << 4) + base + index`; `baddr` is already 20
bits. For format 1 it keeps the current path, so old bitstreams/images and the
installer still work.

## 4. Phases

Every phase ends with `npm test` green and a byte-identical legacy image where
stated. Rollback is `git revert` of that phase; no format changes are
committed before their RTL counterpart is tested.

### Phase 0 — stop silent corruption (no layout change)

* Add duplicate-label and overlapping-`.org` errors to
  `js/deep16_assembler.js`; add an explicit `overlap` field to the result.
  Replace last-write-wins in `make_image.mjs:132-135` and
  `deep16_d16d_image.js:62-68` with a build error.
* Make the browser IDE call `checkImage` (it currently scatters without it).
* Refresh stale `FPUEMUPLAN.md:499` (`0x2D2F` → `0x2D3F`).
* **Acceptance:** an intentional overlapping `.org` in a test fails assembly;
  `D16NANO=1 D16SEG=1 node scripts/make_image.mjs` still reports the known
  `BIOS (5591 words) overruns the stacks` error, now with per-block detail.
* **Files:** `js/deep16_assembler.js`, `scripts/make_image.mjs`,
  `js/deep16_d16d_image.js`, `tests/assembler.test.js`, `FPUEMUPLAN.md`.

### Phase 1 — linker scaffold, identical output

* Add `js/deep16_linker.js` and `scripts/link_image.mjs` with the chapter
  schema but a *single* chapter equal to today's flat image.
* Route Node and browser builders through it; keep `flatView` as the output
  used by the existing scatter.
* **Acceptance:** `image.hex`, `image.mi`, `image.flash.bin` and the manifest
  are byte-for-byte identical to the pre-change build (hash comparison test);
  `tests/d16d-image.test.js` Node/browser parity still passes.
* **Files:** new linker modules, `scripts/make_image.mjs`,
  `js/deep16_d16d_image.js`, `js/deep16_ui_core.js`, new `tests/linker.test.js`.

### Phase 2 — BDOS → `CS=0x4000`

* Extract the BDOS block from `asm/forth_nano.asm` into its own source;
  `.org` it at `0x40000` under a `BDOS_BASE` equ. Change `BDOS_JTABLE` entries
  to `handler - BDOS_BASE` and dispatch with `LDS R2,CS,R3` after establishing
  `CS=BDOS_SEG` in the far entry stub.
* Keep kernel-side far-call stubs at `CS=0` that set `R2=0x4000, R3=offset`;
  existing `call-far`, menu and BIOS callers keep their ABI.
* Move `bd_count`/scratch out of DS `0x2F40` into the BDOS segment, except the
  cells the kernel writes directly (those get a tiny kernel-side mirror).
* **Acceptance:** `tests/bdos.test.js` drives all functions from the new
  segment; a test poisons flat `0x2D4A` and confirms calls still work;
  `dict_free` no longer has to skip `0x3FCD`–`0x417C` in the D16D build.
* **Files:** `asm/forth_nano.asm`, new `asm/bdos_block.asm`, linker layout,
  `tests/bdos.test.js`, `tests/segmented.test.js`.

### Phase 3 — ILL + FloatLib into the system segment

* Move the ILL handler (`0x5000`) and `softfloat.asm` (`0x5800`, `0x6000`)
  into the system chapter at `CS=0x3000`, next to BIOS. Delete the D16D
  trampoline at `0x4D24` and vector 0 directly to the handler.
* Route the five direct `i2f`/`f2i` call sites
  (`asm/forth_float.asm:311,331,1114,1147,1201`) through a short far-call shim
  in `CS=0`, or convert them to trap words. Replace `ill_fpu`'s PC-relative
  return to `ill_restore_shared` with a far return.
* Keep the Forth float word surface, scanner, trampolines and power tables in
  the kernel chapter but move them out of the old free gaps (`0x417D`,
  `0x4330`, `0x48A9`, `0x6900`) into declared space — no more
  `FPU && BAKE_PACMAN` mutual exclusion.
* **Acceptance:** `tests/d16d-fpu.test.js` now asserts the library exists
  *only* at `CS=0x3000`, with flat `0x5800`–`0x6475` left as FILL; `s>f`,
  `f>s`, `f+`, `fexp` and float literals all run; no trampoline test remains.
* **Files:** `asm/forth_nano.asm`, `asm/softfloat.asm`,
  `asm/forth_float.asm`, `tests/d16d-fpu.test.js`, `tests/ill-fpu.test.js`,
  `tests/forth-float.test.js`.

### Phase 4 — format 2 in the loader and IDE

* Implement format-2 chapter parsing in `rtl/flash/flash_boot.sv` (keep
  format 1). Replace `scatterD16SEG()` in `js/deep16_d16d_image.js` with
  `applyChapters()` driven by the same table, and mirror it into simulator
  memory in `js/deep16_ui_core.js`.
* Update flash/installer word counts only if the total grows past the existing
  14,400 words / `0x13000` byte window; the table lives in already-reserved
  header words, so it should not.
* **Acceptance:** `rtl/sim/flash_boot_tb.sv/.cpp` checks both format-1 and
  format-2 boots (`make -f ... build_flash_boot_sim`);
  `tests/ui-d16d.test.js`, `tests/showcase-boot.test.js`,
  `tests/segmented-showcase.test.js`, `tests/ps2-raw.test.js`,
  `tests/ps2-bios.test.js`, `tests/spi-bios.test.js` boot from chaptered
  memory; `tests/d16d-image.test.js` parity holds.
* **Files:** `rtl/flash/flash_boot.sv`, `rtl/sim/flash_boot_tb.*`,
  `js/deep16_d16d_image.js`, `js/deep16_ui_core.js`, above tests.

### Phase 5 — reclaim the dictionary and finish the cleanup

* Split `PSRAM_PROBE_HI` from `DICT_BASE_HI` in `asm/forth_nano.asm:552-585`.
  The probe must stay outside the 24 K BSRAM window (flat `0x5800` / `0x6000`),
  but once PSRAM is found, `HERE` and the dictionary base can move to just
  after `dict_free` (~`DS:0x3FC4`) because no system block occupies
  `0x3FCD`–`0x57FF` any more. Ceiling stays `0xFFEF`.
* Delete the now-obsolete flat assertions in `scripts/make_image.mjs:139-213`
  and `checkImage`'s `BIOS_BASE`/`STACK_BASE` rules; replace with per-chapter
  bounds from the linker.
* Update `MEMLAYOUT.md`, `MEMMAP.md`, `USERFLASH.md` (still describes the old
  24 K / 12,352-word format), `HARDWARE.md`, `FPUEMUPLAN.md`.
* **Acceptance:** board `free` grows by ~5 K words; `1000 deep`, deep mixed
  recursion and a board FPU smoke test all pass; no source file contains a
  hard-coded BIOS/BDOS/FloatLib origin outside the layout declaration.
* **Files:** `asm/forth_nano.asm`, `scripts/make_image.mjs`, docs.

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| FPGA is nearly full (39–83 CLS free, `HARDWARE.md:183-192`, `USERFLASH.md:190-199`) | Run `synth:tile` after Phase 4 before committing format 2; keep the chapter table in header RAM/ROM, not registers; keep the legacy path if the fit fails. |
| 15-bit signed `LDI` cannot hold physical addresses like `0x40000` (`tests/forth.test.js:2002`) | All cross-chapter targets use `seg` + `base-relative delta` pairs; the linker generates base equ's and checks the delta range. |
| Header/CRC mismatch bricks the board | Keep format 1 accepted; add header CRC; A/B test old and new images on the same bitstream; verify `0x100000` boot and `0x13000` file size with the flashing scripts. |
| IDE duplicates Node layout rules | Phase 1 forces both through one browser-safe linker module; keep the word-for-word parity test. |
| Test churn (≈15 test files pin flat addresses) | Phases 2–4 update tests to assert chapter metadata instead of flat addresses; `flatView` keeps unrelated tests alive until their phase. |
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
* `MEMLAYOUT.md` matches the assembler/loader symbols again.
