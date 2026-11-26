# Deep16 memory layout audit — where the system blocks live, and why they collide

Audited 2026-11-26 against the current tree. All addresses are **16-bit word
addresses** (not bytes) and are **offsets in a segment** unless the column says
*physical*. Physical address = `(segment << 4) + offset`, 20 bits, 1 Mi words.
`MEMMAP.md` is the broader MMIO/storage reference; this file is the compact
"who sits where / who calls whom / why do they keep hitting each other" table.

**Source of truth:** the `Deep16Assembler` symbol dump, not the hand-written
comments in `MEMMAP.md` (that file warns itself that `dict_free` and the boot
script drift). The D16nano numbers below were measured by assembling
`asm/forth_nano.asm` + `asm/softfloat.asm` + `asm/forth_float.asm` with
`DEFINES = { CONSOLE_UART, D16NANO, D16SEG, D16D, FPU_KERNEL, FPU_WORDS }`.

---

## 1. Quick table: the four subsystems

| Block | D16SIM (screen/IDE, 1 Mi) | D16MINI (archived, ignored) | D16nano (D16SEG/D16D, current board) | How it is entered |
|---|---|---|---|---|
| Vectors ILL / IRQ / SWI | `0x0000` / `0x0001` / `0x0002` | same | same, written through `CS=0` (`STS R1,CS,R2`) | hardware |
| Forth kernel code | `0x0100`–`0x2D49` | `0x0100`–`0x2F47` | `0x0100`–`0x2D49` (`swi_to_bios` `0x232`) | direct / threaded |
| Forth static data, `dict_free` | `0x3000`–`0x3BFB`, ceiling `0x4000` | `0x3000`–`0x3F5E`, ceiling `0x5600` | DS=0x1000 `0x3000`–`0x3FC4`; dictionary from `DS:0x5800` to `0xFFEF` | DS-relative |
| **BDOS** entry + jump table | `0x2D4A` / `0x2D59` | **none** (pre-split) | `0x2D4A` / `0x2D59` | **far jump `JML R2`**, `R0`=fn, `R1`=arg, `R10:R11`=return CS:PC; 30 fns with D16NANO, 27 otherwise |
| BDOS scattered handlers | `0x4400`–`0x49FB` | – | `0x3FFC`–`0x417C` (fns 27–29), `0x4400`–`0x49FB`, `bdos_ps2_init` `0x1F78`, D16D bridge `0x5400`–`0x548D` | table of absolute `CS=0` addresses |
| **BIOS** code | `0xF8000`–`0xF8156` (physical, `CS=0xF800`), 6 fns | `0x5600`–`0x576F`, 6 fns | image `0x4A00`–`0x6C8F`; **copied to `CS=0x3000:0x0000`** by `flash_boot`, SWI target `0x3000:0` | **SWI** vector 2 → `swi_to_bios`, shadow bank, `I=0` |
| **ILL handler** | `0x5000` (+ save area `0x5200`) | `0x5000` | flat `0x5000`, but D16D vector → trampoline `0x4D24` → `CS=0x3000:0x0600` (the BIOS copy, so division routines are reachable) | vector 0, shadow bank |
| IRQ handler | `0x51A0` | `0x51A0` | `0x51A0` (vector 1) | vector 1 |
| **FloatLib / softfloat** | absent | absent | flat `0x5800`–`0x5FD6`, `0x6000`–`0x6475`; **copied to `CS=0x3000:0x0E00` / `0x1600`** | from `ill_fpu` (`0x5F1B`), PC-relative `LINK`/`JMP` |
| Forth float word surface | absent | absent | `0x417D`–`0x430B`, scanner `0x4330`–`0x43FD`, `0x48A9`–`0x48D8`, `0x6800`–`0x6862`, tables `0x6900`/`0x6950`, low trampolines `0x2D3F`–`0x2D49` | Forth threading + trap words `0xFFF8`–`0xFFFE` |
| Return stack (down) | `0x6F00` | `0x5800` | DS `0x2FF0` → `0x2000` (4,080 frames) | `LD`/`ST` through DS |
| Data stack (down) | `0x7FF0` | `0x5FF0` | SS `0xFFF0` (64 K words) | `SP` |
| Boot ROM | `0xFFFF0`–`0xFFFFF` | same | same | reset `CS=0xFFFF:0` |

Flat `D16NANO` without `D16SEG`/`D16D` is **not a built or flashed image**: no
script emits it — every image-producing command adds `D16D=1 D16SEG=1`
(`scripts/build_gowin_tile_flash.sh:21`, `scripts/flash_gowin_tile_flash.sh:39`,
`scripts/build_installer.sh:20`, `scripts/build_flash_boot_sim.sh:7`). It
survives only as a unit-test harness configuration
(`tests/ill-trap.test.js:15`, `tests/nano-uart-echo.test.js:14`,
`tests/tile-console.test.js:28`, `tests/ill-fpu.test.js:16`;
`tests/forth-float.test.js:29` even uses `D16SEG` without `D16D`). Its former
column values were kernel/data `0x0100`–`0x2D49`, `dict_free` `0x3FAF`,
BDOS `0x2D4A`, BIOS `0x4A00`, RP `0x5800`, SP `0x5FF0`; FloatLib was absent.
It is archived/ignored here, not a build profile.

D16nano extra fixed blocks in the same flat image: showcase menu `0x4D34`–`0x547F`
(sparse), Pac-Man gap `0x4330` (normally a config-flash slice, `BAKE_PACMAN`
only), PS/2 layout tables `0x6A90`–`0x6C8F`, echo cell `0xF0064` (the one
deliberate word outside the image window).

### 1.1 Measured D16nano symbols

| Symbol | Value | Symbol | Value |
|---|---:|---|---:|
| `forth_start` | `0x0100` | `bios_entry` | `0x4A00` |
| `swi_to_bios` | `0x0232` | `BIOS_JTABLE` | `0x4A14` |
| `scan_number_entry` | `0x1FF9` | `ill_trampoline` | `0x4D24` |
| `bdos_entry` | `0x2D4A` | `ill_handler` | `0x5000` |
| `BDOS_JTABLE` | `0x2D59` | `irq_handler` | `0x51A0` |
| `sf_parse_tramp` | `0x2D3F` | `f_unpack` | `0x5800` |
| `fpu_lit_tramp_end` | `0x2D49` | `ill_fpu` | `0x5F1B` |
| `dict_free` | `0x3FC4` | `fexp32` | `0x6000` |
| `fpu_words_base` / `end` | `0x417D` / `0x42EB` | `fpu_lib_end` | `0x6476` |
| `fpu_trans_base` / `end` | `0x42EB` / `0x430B` | `ps2_decode` | `0x699C` |
| `scan_float_probe` | `0x48A9` | `ps2_layout` | `0x57DC` |

---

## 2. Who calls whom — the actual ABI

| Caller → callee | Mechanism | Consequence for moving the callee |
|---|---|---|
| Forth → BIOS | SWI vector 2, `swi_to_bios`, shadow registers, returns with `RETI`, `I=0` inside handler | segment-independent; jump table is CS-relative already |
| Forth / menu / BIOS → BDOS | `JML` far jump, `R10:R11` return pair, preserves DS/SS/ES, clobbers R2–R9, `I=1` | **already relocatable in principle** — but the jump table holds absolute `CS=0` handler addresses and its scratch cells (`0x2F40`) are DS-relative |
| Forth float words → FloatLib | trap word `0xFFF8`–`0xFFFE` → vector 0 → ILL decoder → `ill_fpu` | only needs the ILL handler to reach the library; register-only ABI (F0=R2:R3, F1=R4:R5, no stack, no DIV) |
| `s>f` / `f>s` / literal builder / `f.` → FloatLib | **direct PC-relative `LDI i2f - here` / `f2i - here`, `LINK; JMP`** (`forth_float.asm:311,331,1114,1147,1201`) | the "only the ILL handler calls it" assumption is *almost* right: 5 direct call sites must get a far-call shim or be converted to trap words |
| ILL → kernel | `ill_fpu` ends with a PC-relative jump back to `ill_restore_shared` (`softfloat.asm:2419`, `forth_nano.asm:19249`) | moving the library needs a far return trampoline back to the handler |
| Boot loader → segments | `flash_boot.sv` copies flat `0x0000..last`, `DS=0x1000` copy of `0x3000..0x57DC`, `CS=0x3000` copy of `0x4A00..last` | **the same flat word address has a different meaning in each bank** — e.g. flat `0x5800` is FloatLib, `DS:0x5800` is dictionary base, `CS=0x3000:0x0E00` is the FloatLib copy |

---

## 3. Why we keep getting collisions

There is no linker. The assembler has `.org`, which **rewinds** the address
counter and silently overwrites whatever was emitted there. Fixed blocks are
hand-placed, and every time a routine grows it pushes into the next block's
address. The build has guards, but they are pairwise and after-the-fact.

| # | Mechanism | Concrete evidence |
|---|---|---|
| 1 | **`.org` rewind = silent overwrite** | `tests/forth.test.js:33` ("silently overwrote `interpret_done` — the REPL hung"); `forth_nano.asm:4818` ("grew the interpreter by twenty words … silently overran it"); `forth_nano.asm:1405` (`0x0100` block vs `.org 0x0500`); `tests/segmented.test.js:960` (`gfx_back` ran into the ILL trampoline at `0x4CF4`) |
| 2 | **The working tree is fixing exactly this** | `forth_float.asm:1635` moves literal trampolines `0x2D2F` → `0x2D3F` because `waqr_scan` now owns the old slot; `forth_nano.asm:20770` adds a fixed `scan_number_entry` at `0x1FF9` instead of inline `FPU_WORDS` code that shifted hand-placed words; `forth_nano.asm:10718` notes five extra words would push `es!` under `.org 0x18C3`. `FPUEMUPLAN.md:499` still says `0x2D2F` — stale docs are part of the problem. |
| 3 | **Dictionary grows *up* into fixed blocks** | Static data ends at `dict_free=0x3FC4`; BDOS 27–29 occupy `0x3FCD`–`0x417C`, float words `0x417D`–`0x430B`, `BAKE_PACMAN` `0x4330`, BIOS `0x4A00`. `checkImage` rejects `dict_free >= 0x5800` and dictionary-into-BIOS; `FPU && BAKE_PACMAN` is rejected outright. |
| 4 | **Return stack grows *down* into everything** | Flat nano puts RP at `0x5800`, only ~144 words above the nano BIOS end and 0 words above the FPU library start — hence `FPU && !D16SEG` is rejected ("the `0x5800` return stack would collide with the library", `make_image.mjs:118`). Historical segmented build had RP at `0x5FF0` with dictionary from `0x5800`: ~300 frames, `1000 deep` overwrote the running word and froze the board (`HARDWARE.md:302`). Both stacks share `0x5800`–`0x5FFF` in the flat map. |
| 5 | **One flat address, three owners after the loader scatter** | Flat `0x4A00..0x5FFF` is BIOS/FloatLib in `CS=0`, the same words are BIOS/data in `DS=0x1000` and executable code in `CS=0x3000`. Adding a block at a flat address changes three physical maps at once. `MEMMAP.md:64` calls the flat stack/BIOS gap "a deeply nested line can overwrite the BIOS". |
| 6 | **Sparse blocks planted over live words** | Showcase menu writes only into `0xFFFF` FILL gaps; `serial-read` once sat at `0x4E42` under the menu and xmodem died on the first SOH (`make_image.mjs:235`, `tests/d16d-image.test.js:71`). PS/2 layout table overwrites are rejected (`deep16_d16d_image.js:210`). |
| 7 | **Non-D16D `D16SEG` is currently invalid** | `checkImage`: `BIOS (5591 words) overruns the stacks`; the browser IDE builder still scatters it without calling `checkImage`. So "segmented" and "valid" are not the same thing today. |
| 8 | **Register clobbers masquerade as memory bugs** | R13 = SP used as a game horizon (`POLEPLAN.md:545`), UART BIOS clobbering R11 lost `r`'s sign (`ADVARCH.md:456`), `put_char` losing R1–R3 corrupted the boot-script cursor (`LAYERPLAN.md:65`), SWI/ILL had to save caller segments (`554a413`). Worth separating from genuine address collisions when triaging. |

Existing guardrails: `tests/forth.test.js` (`.org` overlap), `tests/bdos.test.js`
(kernel must stop before `0x2D4A`), `tests/segmented.test.js` (BIOS block
overlap), `tests/forth-float.test.js` (float blocks land only in free gaps),
`tests/d16d-image.test.js` (showcase vs live words), and
`scripts/make_image.mjs:checkImage` (bounds, out-of-window words, collisions).
They catch a collision only after someone added a new fixed block — they cannot
grow the next block automatically.

---

## 4. Assessment of the proposed split

> FloatLib only needs to be callable from the ILL handler and BDOS is far
> called, so they can all sit in their own (up to 64 K) segments and not
> interfere with Forth.

**Mostly yes, with three corrections.** Every segment is a 64 K-word window,
so there is plenty of room: BDOS ≈ 2 K words, FloatLib ≈ 3.1 K, BIOS ≈ 3.5 K
in the flat test map / ≈ 8.8 K in the D16nano showcase image (its manifest
counts `biosWords=8848` after the PS/2 decoder and layout tables), ILL ≈ 0.3 K
— all of them fit in *one* segment together, let alone one segment each. The
1 MiB D16SIM build does not need this; the 24 K/28 K D16nano image does.

1. **BDOS is cleanest.** It is already a far `JML` target with a return pair,
   so callers need no changes. What must change: the absolute addresses in
   `BDOS_JTABLE` (`0x2D59`), the scattered handlers (`0x3FFC`–`0x417C`,
   `0x4400`–`0x49FB`, `0x1F78`), the DS-based scratch cells at `0x2F40`, and
   `bdos_load`'s segment bearing headers. Put them in one contiguous new
   segment (e.g. `CS=0x4000:0x0000..`) and the Forth dictionary can start
   right after `dict_free` instead of skipping to `0x5800`.
2. **FloatLib is register-only and position-independent** (all internal calls
   and tail jumps are PC-relative), which is why it works both at flat
   `0x5800` and at `CS=0x3000:0x0E00`. But it is *not* called only from the ILL
   handler: `s>f`, `f>s`, the literal builder and `f.` call `i2f`/`f2i`
   directly (`forth_float.asm:311,331,1114,1147,1201`). Those five sites need
   a small far-call shim in `CS=0`, or must be re-expressed as trap words. The
   ILL side needs a far return to `ill_restore_shared` instead of the current
   PC-relative jump.
3. **The return stack cannot be a segment.** Every access is `LD`/`ST` through
   DS (`docol`, `exit`, `>r`, `r>`, `catch`), so it must stay a DS offset window
   below the dictionary — it is already at DS `0x2000`–`0x2FFF`. The data
   stack *is* its own segment (`SS=0x2000`). So "all of them in their own
   segments" holds for BIOS, BDOS, ILL and FloatLib, not for the return stack.

A useful side effect: the D16D ILL trampoline (`0x4D24` → `CS=0x3000:0x0600`)
exists only because the handler lives in `CS=0` but the division routines live
in the BIOS copy. If ILL + BIOS + FloatLib share one system segment, the
trampoline and the duplicated FloatLib copy go away, and the flash loader's
three overlapping copy windows can become one copy per segment.

### Proposed target map (subject to a build/loader change)

| Segment | Physical | Contents | Frees |
|---|---|---|---|
| `CS=0x0000` | `0x00000` | vectors `0..2`, Forth kernel code `0x0100`–`0x2D49`, short far trampolines | no overlap with data |
| `DS=0x1000` | `0x10000` | `0x0000`–`0x1FFF` scratch, `0x2000`–`0x2FFF` return stack, `0x3000`–`dict_free` kernel data/boot script, dictionary `dict_free`–`0xFFEF` | BDOS 27–29, float words, BIOS data no longer reserve `0x3FCD`–`0x57FF`: ~6–9 K more dictionary words |
| `SS=0x2000` | `0x20000` | data stack, top `0xFFF0` | full 64 K window |
| `CS=0x3000` | `0x30000` | BIOS + ILL handler + FloatLib + PS/2 tables + D16D showcase (~13 K words, far below the 64 K limit) | handler/library copies unified, no trampoline |
| `CS=0x4000` | `0x40000` | BDOS entry, jump table, all 30 handlers, `bd_count`/scratch | far-called, never in Forth's DS space |
| `ES=0xF000` | `0xF0000` | MMIO, echo cell `0xF0064`, boot ROM | unchanged |
| `CS=0xE000` | `0xE0000` | sound window | unchanged |

### What implementing it touches

- `asm/forth_nano.asm` (BDOS table/handlers, ILL entry, BIOS base constants,
  `PSRAM_BASE_HI`, `RSTACK_TOP` stays), `asm/softfloat.asm` (ILL return),
  `asm/forth_float.asm` (direct `i2f`/`f2i` sites),
- `scripts/make_image.mjs` (`BIOS_BASE`, `checkImage`, per-segment bounds,
  symbol checks), `js/deep16_d16d_image.js` (`scatterD16SEG`),
  `rtl/flash/flash_boot.sv` (copy windows),
- tests: `tests/bdos.test.js`, `tests/d16d-fpu.test.js` (poisons flat
  `0x5000`–`0x6FFF` to prove the BIOS copy ran), `tests/segmented.test.js`,
  `tests/forth-float.test.js`, `tests/d16d-image.test.js`.
- The assembler has no relocation pass: either assemble each segment with its
  own origin and emit a load map, or keep PC-relative code and relocate only
  the absolute jump tables/scratch-cell references.

Until that work lands, the pragmatic collision policy is: keep every fixed
block in the free window (`0x417D`–`0x49FF`, `0x4A00`–`0x6C8F`) behind an
explicit occupancy test, never grow a block into a hand-placed `.org`, and
treat `checkImage` failures as hard build errors including in the browser IDE.
