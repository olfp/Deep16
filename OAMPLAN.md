# OAMPLAN — 64 OAM descriptors and 8 palette sets

Status: **plan only, nothing implemented.** This file records the agreed design
for the next FiT change; the RTL, tests, tools and docs are unchanged until it
is implemented.

Baseline: `main` at `5641adc` (all 128 tiles CPU-writable, flat 24-group sprite
bank, OAM/palette at `0xF6000`). `npm run synth:tile`: **4,306 / 4,320 CLS (14
free)**, BSRAM 26/26.

---

## 1. What this buys

Today the engine has exactly **eight** sprite descriptors and **one** palette
set. A game that wants a different set of sprites or colours for a status bar,
a split screen or an animated scene has to rewrite descriptors or palette
entries from the CPU while the beam runs — the visible result is tearing, and
the CPU cost is per-frame.

With this change:

- **64 descriptors**, addressed as eight scenes of eight, selected by a 6-bit
  base in control 5. Slot `n` reads descriptor `(base + n) % 64`.
- **8 palette sets** of four 16-entry banks (text, art, sprite, spare),
  selected by a 3-bit index in the same control 5 word.
- **One store swaps OAM and palette together**, so a raster handler can change
  the whole visual scene at a scan line without touching 128 words.

The **eight visible sprites do not change**. This is set swapping, not sixteen
sprites on one line: the eight comparators and the priority chain stay exactly
as they are. "64 OAM" means 64 descriptors to choose from, eight drawn.

Storage: 128 OAM words + 512 palette words = **640 words**, all inside the
palette BSRAM block that already exists. **No new BSRAM block.**

---

## 2. Current state (what is being replaced)

| Item | Current | Location |
|---|---|---|
| OAM | 256 flops, 8 descriptors × 2 words | `dvi_tile.sv` `oam_bits` |
| Palette | 64 × 16-bit BSRAM, 3 banks used | `dvi_tile.sv` `pal_mem` |
| Palette read | `pal_q <= pal_mem[pal_raddr]`, 1 clock | `dvi_tile.sv` |
| Sprite loader | reads `oam_bits[...]` combinationally at `L_SPR` | `dvi_tile.sv` |
| Control 5 | legacy sprite pattern page, now a no-op | `0xF200A` |
| OAM window | `0xF6000–0xF600F` | `deep16_top.sv` `attr_hit` |
| Palette window | `0xF6080–0xF60AF` | `deep16_top.sv` `attr_hit` |

The palette block is one 1,024 × 16 BSRAM (18,432 bits available, 1,024 used).
Growing it to 1,024 words of real data uses 16,384 bits and still fits one
block.

---

## 3. Memory map

`attr_hit` grows from `0xF6000–0xF60FF` to **`0xF6000–0xF627F`**. The window
offset is the RAM word, so every store is a straight write:

| Address | Words | Contents |
|---|---|---|
| `0xF6000`–`0xF607F` | 128 | OAM descriptors 0–63, two words each |
| `0xF6080`–`0xF627F` | 512 | 8 palette sets × 4 banks × 16 entries |
| `0xF6280`–`0xF62FF` | 128 | spare (no RAM backing; stores are dropped) |

Set `s`, bank `b` (0 text, 1 art, 2 sprite, 3 spare), entry `e`:

```text
address = 0xF6080 + s*64 + b*16 + e
```

Set 0 is byte-for-byte the current layout, so `0xF6080/90/A0` keep their
meaning and no existing image changes.

Descriptor `d`, word `w` (0 = w0, 1 = w1):

```text
address = 0xF6000 + d*2 + w
```

`d*2 + w` is the existing descriptor encoding, so descriptors 0–7 are still the
eight sprites Flappy writes today.

---

## 4. RAM layout and ports

One 1,024 × 16 block:

```text
word   0..127   OAM descriptors (64 x 2)
word 128..639   palette sets (8 x 4 x 16)
word 640..1023  spare
```

- **Write port:** muxed between the CPU window store and the reset clear
  sequencer. The CPU write index is `cpu_addr[9:0]`; the palette writes only
  the low byte (`{8'h00, cpu_data[7:0]}`) exactly as today, OAM writes all 16
  bits.
- **Read port:** muxed by time. During active pixels (`rx < H_ACTIVE`) the
  address is the palette word; during blanking it is the OAM descriptor word.
  This is safe because the line-buffer fill never reads the palette during
  blanking. The last palette read for a line is issued at `H_ACTIVE-1`; the
  loader's first OAM read is issued at `H_ACTIVE+1`, after `pal_q` for the last
  pixel has been captured. Verify this in simulation, not by inspection.
- **No second block:** keep exactly one write port and one read port so both
  the simulator and Gowin infer a single BSRAM.

Palette read address:

```text
pal_addr = 10'(128) + {pal_set[2:0], bank[1:0], entry[3:0]}
```

OAM read address (during blanking):

```text
descriptor = (oam_base_lat + slot) & 6'h3F        // 6-bit add, wraps at 64
oam_addr   = 7'({descriptor, word})               // word = 0 or 1
```

The base is **latched at `rx == H_ACTIVE`** with the line loader, so a mid-line
control-5 write cannot mix two descriptor sets within one line.

---

## 5. Control 5 (`0xF200A`)

The two legacy pattern-page bits are all that is used today; they are free
because the sprite window no longer pages.

| Bits | Field | Meaning |
|---|---|---|
| 1:0 | page | legacy sprite pattern page; kept, clamped, unused |
| 7:2 | `oam_base` | first descriptor of the visible eight (0–63) |
| 10:8 | `pal_set` | palette set 0–7 |

```text
control5 = (pal_set << 8) | (oam_base << 2) | page
```

One store swaps both. Existing code writes 0/1/2, which leaves `oam_base = 0`
and `pal_set = 0` — full backward compatibility.

Because contrast is a real risk, control 5 is renamed in the docs to
**scene select**, while the register name stays where the code already uses it.

---

## 6. Latency and raster use

| Change | Applies from |
|---|---|
| `pal_set` | the next palette read (first affected pixel ~3 render clocks after the store is visible in the render domain) |
| `oam_base` | the next line's sprite loader (latched at `H_ACTIVE`) |

The CPU store crosses the 16-entry tile FIFO into the render domain, and the
raster IRQ has its own latency, so a split lands a few pixels (and possibly one
line) later than the compare value. For a pixel-exact split, set control 7 one
or two lines early and calibrate on the board. Document the measured offset.

This gives **one split per control-7 compare**. More splits need either
chaining control 7 to the next line inside the handler (one split per handler
pass) or a small raster table; that is a separate decision and is not in this
plan.

---

## 7. Reset and initial contents

- `rst_render` clears OAM words 0–127 with a **128-clock sequencer** (about
  5.2 µs at 24.75 MHz), preserving today's "reset clears OAM" behaviour
  without a 128-word flop array. The palette is **not** cleared, matching
  today.
- `tilepal3.hex` grows from 48 to **1,024 words**: 128 zero words for OAM,
  then eight complete sets (text/art/sprite = the current default table, spare
  = zero), then zero fill. All eight sets therefore start usable, and a game
  can switch to set 3 without loading it.
- The BIOS `gfx` handler clears OAM; it must widen its loop from 16 to 128
  words (`asm/forth_nano.asm`), otherwise descriptors 8–63 survive a return to
  the console.

---

## 8. Compatibility

| Consumer | Effect |
|---|---|
| Flappy / showcase | unchanged: writes descriptors 0–7 and `0xF6080/A0`, base 0 / set 0 |
| Forth `pal!`/`art-pal!`/`sprite-pal!` | unchanged addresses (set 0) |
| BIOS `gfx` | one loop count changes (16 → 128) |
| JS loader (`0xF6080`) | unchanged (set 0) |
| Control 5 writers | unchanged (0/1/2 → base 0, set 0) |

A game that wants scenes pre-loads descriptors 8–15, 16–23, … and palette sets
1–7 once, then writes control 5 only at the split.

---

## 9. RTL changes

### `rtl/dvi/dvi_tile.sv`

1. Replace `oam_bits`/`pal_mem` with one `logic [15:0] scene_mem [0:1023]`.
2. Add `oam_base` (6), `oam_base_lat` (6), `pal_set` (3).
3. Control 5 decode: keep the page clamp, add the two fields.
4. Write path: one write port, address `cpu_addr[9:0]`, data muxed
   (OAM 16-bit / palette low byte), plus the reset-clear source.
5. Reset: 128-cycle clear counter for words 0–127.
6. Palette read: `pal_addr` with the set field; add the blanking mux to the
   OAM fetch.
7. Loader: add `L_OAM` before `L_SPR` to fetch w0 and w1 into a 32-bit latch
   (two reads), then use the latched values in `L_SPR`. The loader budget is
   `~136 + 16` render clocks per line against 460 blanking clocks, so there is
   ample room.
8. `$readmemh("tilepal3.hex", scene_mem)`.

### `rtl/deep16_top.sv`

- `attr_hit` upper bound `0xF60FF` → `0xF627F`. The offset path already uses
  `mem_waddr[11:0]`, which covers `0x000–0x27F`; no width change.

### `scripts/make_tile_font.mjs`

- Emit the 1,024-word `tilepal3.hex` described in §7.

---

## 10. Simulation and JS

`js/deep16_tile_engine.js`:

- `oam` 16 → **128** words, `palette` 48 → **512** entries.
- `oamBase` and `palSet` in `resetControls`; control 5 decode as in §5.
- `write()`: `0xF6000–0xF607F` → OAM, `0xF6080–0xF627F` → palette.
- Render: descriptor `((oamBase + slot) & 63) * 2`, palette index
  `palSet*64 + bank*16 + entry`.
- Telemetry: add `oamBase`, `palSet` next to `spritePage`.

`js/deep16_ui_screen.js`: info line `OAM 0xF6000 · palettes 0xF6080`.

`js/deep16_gfx_loader.js`: no change (set 0). A future loader may carry all
eight sets; the blob format already has a palette section.

---

## 11. Forth / asm

`screens/flash/catalog.fth` — three small words, all writing control 5 once:

```forth
: oam-base! ( n -- )  ... ;   \ bits 7:2
: pal-set!  ( n -- )  ... ;   \ bits 10:8
: scene!    ( oam pal -- ) ... ;  \ one store for a raster split
```

`asm/forth_nano.asm`: `gfx_oam` loop 16 → 128 words.
`asm/showcase/flappy_game.asm`: no code change; drop the now-pointless
control-5 page store or keep it (harmless either way).

---

## 12. Tests

`rtl/sim/dvi_tile_tb.cpp`:

1. Palette set 1 with different art/sprite colours renders differently; set 0
   is untouched; a control-5 store swaps them.
2. Palette read latency: a mid-frame set change affects the next pixels only,
   not the pixels already in the pipeline.
3. OAM base 8 draws descriptors 8–15; base 60 wraps (slot 4 → descriptor 0).
4. A descriptor written while it is not visible appears on the next line.
5. Reset clears all 128 descriptors (write descriptor 63, reset, no sprite).
6. The palette survives reset.
7. Legacy control 5 values 0/1/2 keep base 0 / set 0.

`tests/tile-engine.test.js`: the same scenarios in the JS model, plus power-on
blank, reset semantics and the write windows.

`tests/segmented.test.js` / `tests/ui-tiles.test.js`: addresses already point at
set 0, so they should pass unchanged — that is itself the compatibility check.

---

## 13. Budget and gates

| Step | Cost | Gate |
|---|---|---|
| Palette sets (Phase 1) | RAM stays one block; 3 flops + address field | synth ≤ 4,320 CLS, BSRAM 26/26 |
| OAM into RAM (Phase 2) | −256 flops, +read mux, +fetch state, +clear counter, +base adder | synth ≤ 4,320 CLS, BSRAM 26/26 |
| Docs/sim/tests (Phase 3) | none | `npm test`, `sim:dvi:tile` |
| Board demo (Phase 4) | none | two scenes split at one raster line |

Estimate: Phase 1 is close to free (+5–15 CLS). Phase 2 removes 256 flops and
their 16-way write decode, and adds roughly the same amount of LUT logic, so it
may be a wash; **14 free CLS is not enough to assume it**. Each phase ends with
`npm run synth:tile` and the measured number goes into `ERRPLAN.md`.

Sequencing matters: do Phase 1 first and measure. If Phase 1 already eats the
margin, stop and re-plan before moving OAM.

---

## 14. Fallback

If Phase 2 does not fit:

1. **8 palette sets + 64 OAM, no reset sequencer** — rely on the ROM init and
   the BIOS clear; saves the 128-cycle counter.
2. **4 palette sets (256 words) + 64 OAM** — halves the palette RAM, same
   logic; no help for CLS.
3. **Palette sets only** — keeps the whole CLS saving for later and still
   removes the per-frame palette rewrite.

Dropping to 32 descriptors does not save meaningful logic (the base adder and
fetch state dominate), so it is not a useful fallback.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| The merged RAM infers two blocks or LUTRAM | check BSRAM 26/26 and the fitter report after Phase 1; keep one write and one read port |
| Read-port switch at `H_ACTIVE` corrupts the last pixel | the palette pipeline drains at `H_ACTIVE`; assert it in the sim |
| Reset clear races a CPU store | gate the sequencer to `rst_render` and block CPU writes until done |
| Raster split lands late | document the measured offset; place control 7 early |
| Old images break | base 0 / set 0 is bit-identical to today; the whole existing test suite is the regression check |
| `$readmemh` size mismatch | 1,024-word file, generated by `make_tile_font.mjs`, checked by a unit test |

---

## 16. Task list

- [ ] Phase 0: rename control 5 in docs to scene select; add the map and
      constants to `MEMMAP.md`, `doc/FiT-Graphics-howto.md`, `rtl/dvi/README.md`,
      `TILESIM.md`; no code change.
- [ ] Phase 1: `scene_mem` at 1,024 words, palette sets, control 5 fields,
      1,024-word `tilepal3.hex`; synth gate.
- [ ] Phase 2: OAM into `scene_mem` 0–127, `oam_base` latch, OAM fetch state,
      reset clear; synth gate.
- [ ] Phase 3: JS engine + tests + BIOS clear count + `catalog.fth` words;
      `npm test`, `sim:dvi:tile`, lint.
- [ ] Phase 4: board demo with one raster split; measure the split offset;
      record in `ERRPLAN.md`.

---

## 17. Open questions

1. **OAM base latch point.** Latch at `H_ACTIVE` with the loader (proposed) or
   apply immediately? Latching prevents a torn line but makes the swap take
   effect one line later than the palette set.
2. **Eight fixed slots or best-eight?** This plan keeps eight fixed slots and
   swaps sets. Selecting eight of 64 by y and priority is a much larger change
   and is not proposed here.
3. **One split or a table?** Chained control-7 compares give one split per ISR
   pass. Is that enough for the splash and the games?
4. **BIOS OAM clear.** Clear all 128 descriptors on `gfx` entry (proposed), or
   leave 8–63 to the game?
5. **Spare bank.** Reserve palette bank 3 for a future 8bpp/other use, or use
   it as a second sprite bank?
6. **Naming.** "Scene select" for control 5, and `scene!` in Forth — preferred
   names?
