# LUAHEAP — a heap for the native LILA profile

*Status: a plan, not an implementation. Written 2026-11-28.*

## 1. The problem

The native LILA profile (`lila/native/lila-native.fth`) has no heap. Everything
it needs is a static pool, reserved when the compiler is loaded:

| pool | size | the limit it imposes |
|---|---|---|
| `l-arena` (string literals) | 500 cells | `-7` when it is full |
| `l-rstr` (concatenations) | 200 cells | `-11` when it is full |
| `l-tslot` (table slots) | 448 cells = 8 tables × 8 slots × 7 cells | `-32` (a ninth table), `-31` (a ninth entry) |
| `l-code` (bytecode) | 1,024 cells | the token cap |
| `l-sym` / `l-vars` | 256 / 48 cells | `-6` (a seventeenth name) |

The table bounds are the ones that bite: **eight tables, eight entries each** is
less than a first non-trivial program needs. The point of this plan is a heap,
so that a table grows until the memory runs out and no further.

The host compiler does not have this problem: it allocates strings, table
headers, bucket arrays, frames and closures with `allocate` and reclaims them
with a conservative mark-sweep collector (`lila/gc.fs`). DeepForth has neither
`allocate` nor `sp@` (`lila/VIOLATIONS.md` items 1 and 4), so the native
profile cannot simply copy the host's design.

## 2. The target

**D16nano** is the `D16D` + `D16SEG` build — the `D16BOARD` define that
`scripts/make_image.mjs:122` derives. It is the only live target; the flat
model is archived (`MEMLAYOUT.md:19,35-45`). The live board carries
HyperRAM/PSRAM: the boot probes for it (`asm/forth_nano.asm:581-591`) and,
finding it, puts the dictionary at `dict_free`, the ceiling at `0xEF80` and
the data stack top at `0xF000` (`asm/forth_nano.asm:592-606`).

Measured on the image `tests/native-lila-harness.js` boots. That image is
assembled with `{D16D, CONSOLE_MIRROR}`; assembling the board's define set
(`D16NANO` + `D16SEG` + `D16D` + FPU) gives the same `dict_free` and the same
ceiling, so the figures below are the board's:

| | value |
|---|---|
| dictionary base (`dict_free`) | `0x3FBA` |
| dictionary ceiling | `0xEF80` |
| data stack top (`sp0_base`) | `0xF000` |
| the gap the dictionary and the data stack share | **44,998 cells** |
| `here` after the boot | `0x67AC` |
| `here` after `s" lila" need` | `0x91B0` |
| free cells after the compiler is loaded | **24,016** |

> The prose in `MEMLAYOUT.md:63,117` and `MEMFIXPLAN.md:610` still says
> `dict_free = 0x3FC4`. The assembled value is `0x3FBA`, ten words lower (the
> phase-5b relocation moved the keyboard block out of the way). This file uses
> the assembled value.

The data stack really is in the same segment as the dictionary: the kernel
sets `DS = 0x1000` and `SS = 0x2000` (`asm/forth_nano.asm:136-139`), but the
stack lives in **DS** — a push lands at `DS:0xEFFE`, not in `SS`
(`sp0_base = 0xF000`, and `MEMFIXPLAN.md:23-25` is wrong about this). The
dictionary grows up from `0x3FBA`, the stack grows down from `0xF000`, and
they meet in the 44,998 cells between.

## 3. What was measured, and what it decides

Measured with the simulator (`tests/native-lila-harness.js`), on the layout
above:

| measurement | value |
|---|---|
| peak data-stack depth during the boot | **15 cells** |
| peak data-stack depth while loading the compiler | **15 cells** |
| peak data-stack depth during an 8-entry table program | **12 cells** |
| cost of one LILA line (compile + run) | ~3–4.2 M steps |
| cost of a lookup in the 8-entry table | below the noise of that per-line cost |

Three consequences:

1. **The stack needs tens of cells, not 24,016.** Give it 1,000 (67× the
   measured peak, and enough for the kernel's `1000 deep` test) and the rest
   of the gap — about 23,000 cells — is the heap's or the dictionary's.
2. **Hashing is not needed.** The host hashes because its per-operation cost
   is negligible. Here one line costs ~4 M steps, while a linear scan of
   1,000 slots costs ~50 k steps (≈1 % of one line). Keep the linear scan:
   no hash, no rehash-on-delete, much less code.
3. **The per-line cost dominates everything.** Any heap access that costs a
   few hundred steps is invisible next to a 4 M-step line. That is what makes
   the slower, segment-relative heap of §5 affordable.

## 4. The design

### 4.1 The heap

A cell-granular allocator with a bump pointer and a free list:

```
create l-heap N allot        \ the block; N is the budget of §5
```

- `halloc ( cells -- addr )` — bump, or the first free block that fits;
- `hfree ( addr -- )` — return a block to the free list;
- `hget ( addr -- x )`, `hset ( x addr -- )` — the access path (§5.3);
- `hmove ( src dst n -- )`, `hfill ( addr n char -- )` — bulk operations;
- `hreset` — the session reset (`lila` restarts; `lila-native.fth:1019`).

Every object carries the host's four-cell header, `[next][size][mark][type]`
(`lila/gc.fs:9-12`), so the object list is already there and a collector can
be added later without changing the representation. `mark` is unused until
then; the heap keeps the object list anyway, because a free list needs the
size and the link.

**Why a heap and not a collector yet.** Growth needs *allocate a bigger slot
array* and *free the old one*, and the old array belongs to exactly one
table, so an explicit free is safe. What is *not* safe is freeing a table
when it is dropped: `a = b` aliases one table under two names, so freeing on
overwrite would free a live table. A dropped table therefore **leaks its
four-cell header** — no worse than today, where nothing is reclaimed at all,
and the heap resets with the session. A collector is needed only to reclaim
*unreachable* objects; when that becomes necessary, the host's non-moving
mark-sweep (`lila/gc.fs`) ports directly: stable addresses, no pointer
fix-ups, and the tagged `(value1 value2 tag)` ABI untouched.

### 4.2 Growing tables

The table value stays `(address, 0, tag 4)`, but the address is now a header
in the heap:

```
header:  [ capacity ][ slots ][ count ][ flags ]     4 cells
slot:    [ k1 ][ k2 ][ ktag ][ v1 ][ v2 ][ vtag ][ occupied ]   7 cells
```

- `op-tnew` (`lila-native.fth:922`) allocates a header and an initial slot
  array. `8 constant L-TMAX` (`:101`) and `variable l-tn` (`:104`) go away.
- `op-tget` (`:930`) reads the header to find the slots.
- `op-tset` (`:944`) inserts; when the table is 75 % full it **grows**:
  allocate twice the capacity, copy the occupied slots, free the old array.
  The 75 % threshold is the host's (`lila/hash.fs:173`).
- Assigning nil clears the `occupied` flag. The host rebuilds the whole
  bucket array on a delete (`lila/hash.fs:139-154`) because open addressing
  breaks its probe chains; a linear scan has no chains, so the native side
  does not rebuild.
- `t-find` (`:735`), `t-free` (`:746`) and `t-border` (`:769`) walk the
  header's capacity instead of `L-SMAX` (`:102`).
- `create l-tslot 448 allot` (`:103`) goes away.
- `-31` (table full) and `-32` (too many tables) disappear; the limit becomes
  the heap, and a new error code reports it (say `-34`, out of memory).

### 4.3 Strings (optional, same heap)

The two arenas (`l-arena` 500, `l-rstr` 200 cells) can move onto the same
heap: a literal allocates an object, a concatenation allocates an object, and
`-7` and `-11` disappear as well. A string value is `(bytes, length, tag 3)`
today (`vpushs`, `lila-native.fth:701`), which is exactly the shape a heap
object wants. This is one extra batch, not extra design.

### 4.4 The collector, later

If the leaks of §4.1 start to matter (many dropped tables, many strings), the
collector is the host's algorithm with three changes:

- `sp@` does not exist; the live stack range is `depth` cells below
  `sp0_base`, so the scan needs one new kernel word (`sp-base`) — or the
  collector scans only registered roots, which means the VM must guarantee an
  empty data stack at collection points;
- `defer` does not exist (`lila/VIOLATIONS.md` item 2), so the object-type
  dispatch is nested `if`s on the type cell;
- the host's `gc-mark-cell` walks the whole object list for every candidate
  cell — O(objects × stack cells), which needs an address-ordered list or a
  page summary to stay affordable on a 16-bit machine.

The heap of §4.1 is built so that adding this is additive.

## 5. Where should the heap live?

Two candidates: **inside the DS gap** (the 24,016 free cells) or **in a
segment of its own**. The exploration below says the hardware allows the
second one without touching the RTL, the ISA, the loader or the bitstream —
but it is not free of consequences.

### 5.1 The two candidates

| | A: in the DS gap | B: its own segment |
|---|---|---|
| size | ~23,000 cells (24,016 minus the stack's 1,000) | 65,536 words nominal (`0xB000`, physical `0xB0000`–`0xBFFFF`) |
| access | plain `@` / `!` — the fastest path there is | segment-relative: ES must point at the heap |
| new kernel code | none | an access layer, and ES juggling around the I/O segment |
| what it leaves to the dictionary | ~23,000 cells | the whole 44,998-cell gap minus the stack |
| BSRAM-only builds | works | no RAM there — the heap must be optional |
| loader, image, FPGA | untouched | untouched (see §5.2) |

### 5.2 What the hardware allows

- **The RAM is there.** On the PSRAM board every normal fetch, load and store
  goes to the PSRAM bridge (`rtl/deep16_top.sv:525-591`,
  `rtl/psram/deep16_psram_mem.sv:436-532`); the local block RAM is only the
  packed image (`rtl/deep16_top.sv:115-121`). The CPU window is 1 Mi words
  (`MEMMAP.md:21-32`), so segment `0xB000` is ordinary writable PSRAM. **No
  RTL change.**
- **The ISA is enough.** `seg-base! ( seg -- )` already sets ES
  (`asm/forth_nano.asm:10796-10812`), `es@` and `es!` are primitives that
  read and write through ES (`:10873-10913`), and `MVS` writes any segment
  register. Explicit `LDS`/`STS` address a segment too. **No ISA change.**
  (`LDI` cannot encode `0xB000` — its immediate is sign-extended 15 bits — but
  a Forth literal is a full 16-bit word, so the Forth side does not care; the
  kernel side uses a `.word` cell, as it already does for `bdos_seg_cell`,
  `asm/forth_nano.asm:4414-4416`.)
- **The loader does not need to know.** A heap that the allocator initializes
  at runtime needs no image content and no table entry. A heap that the
  *loader* staged would need one: the format-2 chapter table is **exactly
  full** — 18 entries of 3 words in a 64-word header (`rtl/flash/flash_boot.sv:44`,
  `MAX_ENTRIES = 18`), and the generated table already has 18
  (`scripts/make_image.mjs:474-493`: 2 + 9 BDOS windows + 4 header ranges + 3
  high cells; `MEMFIXPLAN.md:615-622` calls it "the header capacity"). A
  nineteenth entry does not fit. The
  table's fields are also narrow: the segment is 4 bits
  (`ent_seg <= f_rdata[15:12]`, `rtl/flash/flash_boot.sv:309`) and the count
  is 12 bits (`:80`), so a copy is at most 4,095 words and only segments
  `0x0`–`0xF` are expressible — `0xB000` is, an arbitrary segment is not.
  **The flat payload is also fixed** at 28,672 words
  (`rtl/flash/flash_boot.sv:40`), so the image cannot grow without a format
  change.
- **The bitstream does not change.** A runtime-only heap adds no RTL, so the
  FPGA budget is untouched — which matters, because the tile build is at
  **4,320 / 4,320 CLS** (no margin) and 8,513 / 8,640 logic
  (`MEMFIXPLAN.md:615-622`). A loader-format change would need a fresh fit.
- **There is room in the flat image for the kernel code.** The assembled image
  has ~7,600 words in runs of 32 or more that are still fill or zero; some of
  those runs are reserved (the showcase menu's fill gaps, the PS/2 layout
  tables). The largest usable ones are `0x19FA`–`0x1E87` (1,166 words) and
  `0x699C`–`0x6FFF` (1,636, partly the PS/2 tables). The runs at `0x2E05`,
  `0x40E8`, `0x67D5`, `0x5FE3`, `0x688B`, `0x6A85` and `0x52C0` are spoken
  for: they are the phase-4a sources for the BDOS and system chapters.
- **PSRAM powers up undefined.** Nothing in the controller clears the array
  (`rtl/psram/psram_controller.v` has an initialization delay and no sweep)
  and the loader copies only what the image holds. The allocator must write
  its own metadata, and the tests should poison the segment before the
  allocator runs, so that a missing initialization cannot hide behind the
  simulator's `0xFFFF` fill.

### 5.3 What the segment costs

- **ES is the I/O segment.** The kernel sets `ES = 0xF000` at boot
  (`asm/forth_nano.asm:155-157`) and the console and the SD driver need it.
  A heap in ES means saving and restoring ES around every heap access, or
  giving the heap the segment for as long as it lives — and the console
  breaks in the second case.
- **There is no ES-relative bulk move.** `move`, `cmove` and `fill` are
  DS-relative; copying a slot array or a string inside the heap needs a new
  word (`hmove` above).
- **Every cell access becomes a call.** The LILA VM reads and writes slot
  cells with `@` and `!` today. With the heap elsewhere, each of those
  becomes `hget`/`hset`. At ~30 steps per call and ~7 cells per slot, a
  1,000-entry scan is ~200 k steps — still ~5 % of one line's 4 M-step cost
  (§3), so it is affordable, but it is not free.
- **A pointer is one 16-bit cell.** The value ABI has no room for a segment
  number, so the heap must live in one known segment and every access must go
  through the heap's segment. A heap that spanned two segments would not fit
  the ABI at all.
- **Only the PSRAM board has the RAM.** A BSRAM build has 16,384 or 24,576
  words of block RAM and reads fill outside it
  (`rtl/deep16_top.sv:104-149,485-520`); the heap has to be refused or
  emulated there.

### 5.4 The recommendation

**Put the heap behind the access layer of §4.1 from the start, and start it in
the DS gap; move it to segment `0xB000` when the dictionary needs the room.**

- The access layer (`hget`, `hset`, `hmove`, `hfill`) costs little and is the
  same work either way; with it in place, moving the backing store from DS
  to a segment is a change in the layer, not in the LILA VM.
- The DS gap is enough for the tables of §4.2 right now: ~23,000 cells is
  ~3,000 table entries, or thirty tables of a hundred entries.
- The segment is worth doing *when the dictionary needs it*. The dictionary is
  the other thing that will grow — functions, closures, frames and a standard
  library will take the compiler well past its present 10,756 cells — and it
  can only grow inside the same 44,998 cells. With the heap in DS, the
  dictionary and the heap split that gap; with the heap in a segment, the
  dictionary keeps all of it.
- Segment `0xB000` is the right one: `0x5000` (Flappy), `0x0600` (Frogger),
  `0x7000` (Pole) and `0x8000` (the BDOS directory buffer) are taken
  (`MEMFIXPLAN.md:20-22`), `0x9000` and `0xA000` are documented as the
  candidates for moving ILL and FloatLib into segments of their own
  (`MEMFIXPLAN.md:94-96`), and `0xF000` is the I/O window the kernel points
  ES at. `0xB000`–`0xE000` are free.
- If the dictionary roadmap turns out to need the room *now*, skip step A and
  go straight to B: the hardware allows it with no RTL, ISA, loader or FPGA
  change. The cost is the access layer and the ES juggling of §5.3.

## 6. The stages

On a branch (`exp/heap`), in a worktree, one commit each. `main` is touched
only by the documentation of the last stage.

| stage | work | acceptance |
|---|---|---|
| **E0** | the measurements of §3, re-run and recorded | this file |
| **E1** | the allocator and its access layer (DS first), plus `tests/native-lila-heap.test.js`: alloc, free, reuse, reset, exhaustion, a poisoned heap | the free list returns blocks; exhaustion is a clean error; the data stack is back at depth 0 |
| **E2** | growing tables (§4.2): the header, growth at 75 %, delete and reinsert, identity semantics, the nested-read and nested-assignment rules unchanged | a 100-entry table and ten tables work; the 19 parity programs still match `lua5.4` 5.4.8; the `-31`/`-32` tests become out-of-memory tests |
| **E3** | strings on the heap (§4.3) | `-7` and `-11` are gone; the string programs still match |
| **E4** | the verdict and the documentation: `LILASTATUS`, `lila/LILANATIVE.md`, `lila/native/README.md`, `LUAPARITY`, and the budget figures re-measured | the numbers in the docs match the board |

## 7. Risks

- **The dictionary and the heap want the same cells.** This is the reason to
  keep the segment option open (§5.4).
- **A leak is a leak.** Dropped tables keep their four-cell header until the
  session ends. A session that creates thousands of tables exhausts the heap.
  The alternative is a collector (§4.4), not a cleverer free.
- **The first fit is not the best fit.** The free list is first fit; tables
  grow by doubling, so the blocks are large and few. If fragmentation shows
  up, the free list can sort or coalesce.
- **The loader's table is full.** Any future *boot-loaded* chunk needs a
  format change, and the FPGA has no CLS margin (§5.2).
- **The flat image's free runs are spoken for** in places (§5.2): new kernel
  code has to be placed carefully, and the phase-0 audit's duplicate-label
  and `.org` overlap checks must stay green.
- **The per-line cost of ~4 M steps dwarfs everything** (§3). It is not this
  plan's problem, but it is what makes this plan affordable, and it is what
  will make a LILA program feel slow.

## 8. The decisions to take

1. **Heap size**: ~23,000 cells (the whole gap minus a 1,000-cell stack) or
   ~12,000 (a 12,000-cell stack margin)? The recommendation is 20,000 — a
   4,000-cell stack, 267× the measured peak.
2. **Heap placement**: in the DS gap now (recommended), or straight into
   segment `0xB000`?
3. **Strings**: in the same batch as the tables, or a separate one (§4.3)?
4. **Growth threshold**: 75 % (host parity, recommended) or 50 %?
5. **Dropped tables may leak their header**: acceptable (recommended), or
   should the collector come with the heap?

## 9. References

- the profile: `lila/native/lila-native.fth` (pools `:47-114`, tables `:713-776`,
  opcodes `:922-980`, session `:1016-1032`)
- the host: `lila/gc.fs` (the collector), `lila/hash.fs:116-176` (growth and
  delete), `lila/value.fs` (the value ABI)
- the kernel: `asm/forth_nano.asm` (segments `:136-139`, the PSRAM probe
  `:581-606`, `seg-base!` `:10796`, `es@`/`es!` `:10873-10913`,
  `depth` `:6104`, `unused` `:9258`)
- the machine: `MEMLAYOUT.md` (the live audit), `MEMFIXPLAN.md` (the phases
  and the FPGA budget), `MEMMAP.md` (the address model)
- the hardware: `rtl/deep16_top.sv`, `rtl/psram/`, `rtl/flash/flash_boot.sv`
- the tools: `tests/native-lila-harness.js` (the simulator harness),
  `js/deep16_simulator.js`, `js/deep16_linker.js`, `js/deep16_d16d_image.js`
