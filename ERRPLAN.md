# ERRPLAN — error investigations

Status: **open items, newest first.** Each entry records what was observed, how
it was reproduced, the intended behaviour and the fix to investigate. Fixes are
not applied until the entry is updated with the result and tests.

> **Current baseline (2026-11-02, `main`).** `npm test`: **745 pass**. `npm run synth:tile` after 64 OAM descriptors and 8 palette sets:
> **4,260 / 4,320 CLS (60 free)**, BSRAM 26/26, SSRAM 214, registers 2,838;
> `dvi_render` 32.886 MHz, `dvi_pixel` 86.108 MHz, `psram_clk` 86.388 MHz,
> `clk_cpu` 20.246 MHz, all TNS 0. Moving OAM into the palette RAM *freed*
> 177 registers and 79 logic cells. Plan the open RTL items against **60 free
> CLS**. One hold endpoint is flagged
> (`n8_s3/I1 -> clk_div_1_s0/D`, `clk_cpu -> clk`); it is identical on `main`
> and is the generated-clock divider self-path, not a new violation.

---

## 2026-11-04 — The console blocked with I=0, so the raster IRQ had no window

**Priority:** high — this is the missing piece of the raster investigation.

**Area:** `asm/forth_nano.asm` (`bios_f5` getstr, `read_line`, `word_accept`,
`refill`); `screens/flash/catalog.fth` (`raster-probe` once it exists).

**Observed (discussion with Big Pickle, 2026-11-03/04):** the REPL spends
essentially all its time inside BIOS getstr (function 5), which polls the
keyboard FIFO in a loop **inside the SWI**. That context runs with S=1 and I=0,
and the core refuses an IRQ while S=1, so the only window in which the SIC can
be serviced is the handful of microseconds between the handler's RETI and the
next SWI. That matches the earlier measurement exactly: `raster-ticks` advanced
about 2 per console command, and `PENDING` bit 3 was read after the handler had
already acknowledged it. The "request level stays low" reading is the same
artefact: the level is acked as soon as the handler runs, which is between
commands.

So the raster compare/request path may have been healthy all along; the console
simply never waited with interrupts enabled.

**Change:** getstr is now a non-blocking pump. One call drains what the
keyboard FIFO holds and leaves the caller's R0 = 1 when the line ended (CR/LF),
0 when it ran out of keys. The write pointer and an "a line is in progress"
flag are two kernel-data cells (`gs_active`, `gs_ptr`) that every boot copies
fresh, so a warm reset cannot resume a line from a stale pointer. `read_line`,
`word_accept` and `refill` poll it, so the console waits with the caller's PSW
restored (I=1) and the timer and raster IRQs are serviced while it waits.

A test in `tests/segmented.test.js` types a partial line, checks it sits in TIB
and does not run, then presses Return and checks it completes.

**No-input probe (run at the prompt, calls no SWI while it spins):**

```
: rp 0 0xC2 es! 30 raster-line! 0 sic-raster es! 8 sic-enable es!
     2000000 0 do loop 0 sic-enable es! 30 raster-line!
     ." raster " sic-raster es@ . ." ticks, pending " sic-pending es@ . cr ;
rp
```

Expect ~60 ticks in about a second. 0 means the compare or the request/SIC path
is still at fault, and the `raster_seen` latch on LED5 (below) is the next
probe. The word disables the timer source while it runs; `irq-on` restores it.

**Board result (2026-11-04):** the probe reports **135 raster ticks** for the
spin and `PENDING = 10` (decimal) right after — bits 3 (raster) and 1 (timer,
which keeps latching while its source pulses). So the compare, the level
request and SIC `src[3]` were healthy all along; the console's SWI context was
the only thing masking the IRQ, exactly as Big Pickle suspected. The earlier
"request level low / PENDING never sets" readings were taken after the handler
had acked in the window between commands.

**Rate check: two edges per frame, fixed (2026-11-04).** With the 15 kHz timer
as the clock the reading was `raster 243, timer 30174` = **1/124**, i.e. two
requests per frame, not one. The compare was a *level*
(`render_line_end && !render_stall && ry == raster_line`); the render line end
can hold across a fill stall and the handler's acknowledge clears the level, so
the still-true condition set it again for the same line.

The request now fires on the **rising edge of the line match**, registered in
one flop: a stall cannot re-trigger it, an ack cannot re-arm it, and the next
frame (or the split's second line B) still fires because `ry` leaves the line
in between. A ten-bit "line already serviced" register was tried first and made
PnR fail with 180 unrouted nets; the edge detector costs one register and fits
at **4,298 / 4,320 CLS** (22 free), routed. The Verilator tile bench acks each
request like the kernel handler and checks two requests over two frames.

**Visible band (board-verified 2026-11-04):** write palette set 1's text pair 0
as green, then let the handler swap the scene at line 100 and restore at 200.
Line 100 is text row 6 (each row is 15 render lines), so the band only shows
where there is text — print first, then arm. On the board the text in the band
turned green on black, so the handler's control-5 write does land mid-frame.
The first attempt showed nothing because the screen had no text in rows 6..13
yet.

```
: band mem 0xFF 0x6081 es! 0x1C 0x60C1 es! 0x100 15 60 split! ;
band
```

**The palette window is addressed by absolute set**, not by the selected one:
set 0's text pair 0 is 0x6080/0x6081, set 1's is 0x60C0/0x60C1 (0x80 + set*64
+ 2*pair). `pal-set!`/`scene!` only choose which set the *display* samples;
`pal!`/`art-pal!`/`sprite-pal!` always write set 0. The first demo therefore
recoloured set 0 and left the display on it, which is exactly the "all text
turned green" result; the band then switched to the untouched default set 1,
which looks like no change. The one-liner above writes both cells explicitly.

Lines 15..60 are text rows 1..3, so the top of the printed map turns green
and everything below stays white — a band that is easy to see. The earlier
100..200 version only covers rows 7..13, which is where an empty or scrolled
screen has no text at all.

**The handler must not read control 7 back.** `deep16_top` forwards only
*stores* to the tile port (`tile_hit`/`ctrl_hit` both require `mem_we`), so a
read of 0x200E is a PSRAM read; it only appeared to work because the control
store is also written to PSRAM. The band state machine now keeps its own copy
of the armed line in `split-cur` (0xC6), updated by `raster-line!` and by both
handler branches, so it no longer depends on that accident.

`split-off` removes the band; `irq-on` restores the timer source. The band is
expected a couple of lines below 100 because the fill runs ahead of the scan by
the line-buffer depth.

The timer IRQ also runs during console input now, which is worth re-checking
with `ticks` while typing.

**Status:** fixed and board-verified (2026-11-04).

---

## 2026-11-04 — The console has two getstr implementations; I patched the dead one

**Priority:** high — the non-blocking console did nothing because the change
went into code this build never assembles.

**Area:** `asm/forth_nano.asm` (`bios_f5` twice, once in the
`CONSOLE_UART` branch and once in the `.else` screen branch); `read_line`,
`word_accept`, `refill`.

**Observed:** the `CONSOLE_UART` build (this board) assembles the **UART**
getstr (`uart_getstr_loop`, ES:0x0040/0x0042, echo over the wire); the screen
build in the `.else` branch has the tile-console getstr (KBD 0x0060/0x0062,
echo into the tilemap). The non-blocking pump and the "line in progress" cells
were added to the `.else` one, which this image drops before either pass. The
console therefore kept blocking inside the trap, which is why the prompt
serviced no IRQs and why the first kernel-side poll (reading 0x0060) hung the
simulator: only the BIOS ever read that port, and in this build it reads
0x0040.

**Tried:** converting the UART getstr to the same pump. The segmented suite
went green (29/29) but `showcase-boot.test.js` "Q returns from the menu to the
Forth console" then failed: after Q the banner SWI spins in the flat
(non-D16SEG) build. Reverted rather than ship it; the pump needs a pass that
covers the flat build's menu exit too.

**Next:** convert `uart_getstr` to the pump, then let the kernel poll 0x0040
bit 0 itself (where I=1) and only SWI when a byte is waiting. Validate both the
segmented suite and `showcase-boot`.

**Band demo without prompt interrupts:** the handler runs while a *command*
runs, so a self-driving demo shows the split today:

```
: band 0xFF 0x6081 es! 0x1C 0x60C1 es! 0x100 15 60 split! 4000000 0 do loop split-off ;
band
```

**Status:** open; console rework reverted, band pending.

---

## 2026-11-04 — Raster band: scroll_y at 0x2006, and the 16-bit loop limit

**Priority:** done — the raster split works on the board.

**Area:** `asm/forth_nano.asm` (IRQ handler band branch), `catalog.fth`
(`split!`/`split-off`), `ERRPLAN` earlier entries.

**What was wrong, in order:**

1. The handler wrote `0x200C` for "control 6". `0x200C` is the **per-row
   fine-scroll table**; the vertical scroll is `scroll_y` at **`0x2006`**
   (control decode `4'h6`). `5 0x2006 es!` from the console jumps the picture
   immediately, which is the test that separated "wrong register" from
   "frame-latched register".
2. Before that, the palette set (control 5) was tried: the board showed it
   sampled per *frame* (a scene flip driven from a spin washed the whole
   screen instead of striping it, and the raster count did not gain the
   second edge). Control 5 is not usable for a band.
3. The loop counts in the probe commands were truncated: cells are 16-bit, so
   `2000000 0 do loop` runs `0x8480` and `4000000` runs `0x0900` (2 304) —
   "a very short flash". Use 65 535 or less (or a counter) for a timed spin.
   This also explains the inconsistent timer/raster readings earlier.

**Board result:** `band` shifts the picture during the spin and restores it,
and the compare, SIC source, handler and A->B->A re-arm (`split-cur`) are all
verified on the board. But the band is **not partial**: with lines 100..250
armed (`: band2 mem mem 31 100 250 split! 65000 0 do loop split-off ;`) the
*whole* picture jumps, not rows 6..16. The palette set behaved the same way
(a scene flip from a spin washed the whole screen instead of striping it).

So both control-5 and scroll_y are effectively **frame-granular in the
netlist**, although the RTL combines them into the fill per line. That is the
same class of defect as the OAM-base adder Gowin merged on 2026-11-02: the
source is right and the fitted netlist is not. A per-line effect therefore
needs something the renderer reads from RAM per line - sprites/OAM descriptors
or tilemap cells - or a netlist investigation of the control-write path.

**Status:** raster IRQ verified on the board; per-line control changes not
working in the fitted build (netlist).

**Status:** raster split working on the board (2026-11-04).

---

## 2026-11-04 — The raster band ran twice per edge (SIC W1C before tile ack)

**Priority:** fixed and board-verified. This was the cause of the “frame-granular
control registers” symptom, not the netlist.

**Area:** `asm/forth_nano.asm` (`irq_handler`), `deep16_sic.sv`,
`dvi_tile.sv` raster request.

**What was wrong:** the raster source is a **level** - `dvi_tile` holds
`raster_toggle` until a control-7 write acknowledges it. The handler read
PENDING and did the W1C **first**, while the synchronised level was still high,
so `pending <= pending | src` re-latched the bit on that clock. The handler
then ran a second time after `RETI`, took the *other* branch (`cur` had just
changed) and undid the first write. Every raster edge cost two entries.

**Measured:** with one edge armed and `lineA` set to a line that never matches,
`0xB8` (handler raster count) read **2**; after the fix it reads **1**. The
segment test `A/B` counters could not show this because both entries increment
different counters.

**Fix:** each band path acknowledges the tile engine first (the control-7
write) and clears the SIC bit at the end, after a few NOPs let the
synchronised level fall. One edge is now one entry.

**Board result:** the sprite multiplexer works: one OAM slot shows two solid
32x32 squares at the same time, one above line 250 and one inside the band
(A=100 writes Y=200, B=250 restores Y=40). This also means the earlier
2026-11-04 entry (“control registers are frame-granular in the fitted build”)
is **superseded**: those tests ran with the double-service handler, and the
`ctest` spin it also cited had a truncated loop (`4000000` became `0x0900`, so
it wrote one scene for the whole spin). Control-5/control-6 bands need a fresh
test with this fix.

**Status:** raster IRQ, per-line OAM writes and sprite multiplexing verified on
the board (2026-11-04).

---

## 2026-11-02 — Open discussion: extend the art tile bank using spare cell bits

**Priority:** low — discussion only; no encoding or memory-map decision yet.

**Area:** `rtl/dvi/dvi_tile.sv` (tile-cell decode, `fcell`, `tilefont`,
`tf_raddr`); `rtl/deep16_top.sv` (`bank_hit`, `tile_addr`); the board tile
FIFO; `scripts/make_tile_font.mjs`; `MEMMAP.md` and the FiT how-to.

**Context:** an art cell currently stores a 12-bit **word address** in bits
11:0, and the low five bits are always zero because an art tile is 32 words.
The tile index is therefore 7 bits, **128 tiles**. Bits 14:12 are the text
palette pair and are unused in art mode. The PS/2 block removal is expected to
free one 1,024-word block = **32 more art tiles**.

**Idea:** decode an art cell as a tile **index**, not as a word address:

```text
tileIndex = {cell[14:12], cell[11:5]}   // 10 bits
tileWord  = tileIndex << 5              // 32-word art tiles
```

- Text cells keep bits 14:12 as the palette pair.
- Old art cells have those bits zero, so they keep their meaning.
- Font pages remain in the low tile-bank addresses; art grows above them.
- One freed block grows the bank from 128 to 160 tiles. A 256-tile bank would
  need four additional blocks, not one.

Do **not** use `cell << 4`: art tiles are 32 words, so the alignment shift is
five bits. A four-bit shift would address 16-word units and make adjacent art
tiles overlap.

**CPU-window issue:** the renderer can decode 160 tiles and the CPU now writes
all 128 of `0xF3000–0xF3FFF`. A 160-tile bank would need a paged window over
the extra 32 slots; the current 32-tile block at `0xF3C00–0xF3FFF` is already
in use, so this needs a page register:

```text
page 0 -> tiles 96–127   (existing baked art)
page 1 -> tiles 128–159  (new block)
```

This needs:

- a page-select register in the render domain;
- 13-bit absolute tile addresses in the board FIFO and `tilefont`
  (160 x 32 = 5,120 words);
- an extended `tilefont.hex` / `TILE_COUNT`;
- a decision on whether page 0 stays read-only or becomes writable;
- mirror semantics: the same CPU address now maps to two absolute tiles, so a
  flat PSRAM/Forth mirror cannot represent both. The page window must be
  page-aware or explicitly write-only.

**Open questions:**

1. Is 160 tiles enough to justify the page register, or is this only useful if
   the bank grows to 256 (four more blocks)?
2. Should page 0 keep the 32 baked art slots read-only?
3. Does anything rely on the mirror at `0xF3C00`?
4. Does the extra 13th address bit and page mux fit the current CLS budget?
5. Is a global tile-bank page acceptable, or does software expect per-cell
   access to all extended tiles?

**Status:** open discussion — low priority, not accepted or implemented.

---

## 2026-11-02 — Move PS/2 scan-code mapping to software and free its BSRAM block

**Priority:** medium — the PS/2 ASCII map is currently an unexpected hardware
table; moving it to software frees one BSRAM block for tile/sprite memory, but
changes the keyboard interface and the BIOS/game input path.

**Area:** `rtl/ps2_rx.sv` (`ps2map`, `ascii`, `valid`, modifiers);
`rtl/deep16_board.sv` (PS/2 push into both FIFOs); `rtl/deep16_top.sv`
(`KBD_STATUS`/`KBD_DATA`); `asm/forth_nano.asm` (`getch`/`getstr`);
`asm/showcase/*.asm` (menu and Flappy key polling);
`scripts/make_ps2map.mjs`; the simulation keyboard path.

**Observed:** `ps2_rx.sv` contains a 2,048 x 8 BSRAM pROM addressed by
`{ctrl, caps, shift, scan_code}` and emits ASCII directly. The board then
pushes that ASCII into **both** the architectural keyboard FIFO
(`0xF0060`/`0xF0062`) and the UART receive FIFO, so the current BIOS and the
showcase games poll UART status and never see a raw scan code.

The table itself is one 1,024-word BSRAM block. It is fully used (2K x 8) but
the mapping is a software concern; the hardware only needs to deliver the
Set-2 make code and modifier state.

**Proposal:**

1. **Reduce `ps2_rx` to a receiver/decoder.**
   - Keep frame/parity/timeout handling, break (`0xF0`), extended (`0xE0`),
     Shift/Ctrl/Alt/Caps tracking and `frame_error`.
   - Remove `ps2map`, the registered map pipeline and the ASCII output.
   - Emit a one-cycle `raw_valid` for a make code, plus `scan_code`,
     `modifiers`, and `extended`. Optionally emit a `break_event` for future
     key-up support; current software only needs make codes.
2. **Change the board push format.**
   - Push `{modifiers[3:0], extended, 3'b0, scan_code[7:0]}` into the
     architectural keyboard FIFO (16 bits per event).
   - Stop pushing PS/2 events into the UART RX FIFO. UART RX remains the host
     terminal input; the two sources stay distinguishable.
3. **Map in software.**
   - Move the 2,048-byte `{ctrl,caps,shift,code}` table to PSRAM, loaded from
     flash or the boot image, or generate a compact equivalent.
   - Add a BIOS/kernel key layer:
     - `key?` checks both UART RX-ready (`0xF0040`/b0 or the BIOS status) and
       `KBD_STATUS` (`0xF0060`);
     - `key` returns an ASCII byte from either source, mapping raw PS/2
       events through the table;
     - `getch`/`getstr` use that layer for echo and line editing.
   - Decide priority when both sources have bytes (recommended: keyboard
     first, then host UART) and document it.
4. **Update the showcase/game input.**
   - Menu (`F`, `Q`) and Flappy (flap, `Q`) must use the same key layer rather
     than polling UART directly.
   - The raster/game loop needs a non-blocking `key?`; add a BIOS function or a
     shared showcase routine so the tile game does not depend on UART bytes.
5. **Re-dedicate the freed BSRAM block.**
   - Removing `ps2map` takes the build from 26/26 to **25/26**.
   - Preferred one-block allocation: **sprite pattern bank 24 → 28 groups**
     (`+4 groups x 256 words = 1,024 words`). The OAM group field already
     supports 0–31; control 5 page 3 exposes groups 24–27 and leaves 28–31
     disabled. No tile-cell format change is needed.
   - A **tilemap third bank** needs three blocks, not one. Expanding the
     **tile bank beyond 128 tiles** is blocked by the 7-bit tile field in a
     cell; it would need a cell-format change, not just another block. Do not
     assume this block can simply become “more tiles”.
   - If the intended target is a second 32-tile art bank, that needs a new
     global tile-bank select (or a cell-format change) and is a separate
     design decision.

**Verification:** PS/2 simulation (`npm run sim:ps2`) for raw codes, modifiers,
break/extended and parity errors; new software key tests with raw events from
the keyboard FIFO and ASCII from UART; console parity and showcase input tests
(menu `F`/`Q`, Flappy flap/quit); `npm run synth:tile` to confirm BSRAM 25/26
and measure CLS. The map generator becomes a software asset rather than a
bitstream pROM.

**Risks:** dual input sources can stall if both FIFOs fill; the map must be
loaded before the first key; the showcase currently assumes UART polling; the
IDE keyboard path pushes ASCII and must remain compatible with the software
mapper (host UART versus raw PS/2). The freed block should not be allocated
until the BIOS/game input path is proven.

**Status:** open — design only, not applied.

---

## 2026-11-02 — 64 OAM descriptors and 8 palette sets, swapped by one register

**Priority:** medium — enables raster-time OAM/palette set swaps without a new
BSRAM block; requires a control-register and memory-window change, and has to
be ordered against the 2026-11-01 sprite-window proposal.

**Area:** `rtl/dvi/dvi_tile.sv` (`oam_bits`, `pal_mem`, `sprite_page`,
`pal_raddr`); `rtl/deep16_top.sv` (`attr_hit`, `tile_addr`); `MEMMAP.md` §7.4;
`doc/FiT-Graphics-howto.md` §7; `asm/showcase/*.asm`; the simulation tile
engine.

**Observed:** OAM is 16 words of flops (eight descriptors) and the palette is a
64-word BSRAM block holding three fixed banks (text, art, sprite) plus one
unused bank. Control 5 only selects the sprite pattern **write** page. There is
no OAM base index and no palette set index, so a raster handler cannot swap
sprite or palette sets without rewriting every descriptor or every palette
entry.

**Proposal:**

- **64 OAM descriptors** (128 words) and **8 palette sets** of four 16-entry
  banks (512 words), total **640 words**, in the existing 1,024-word palette
  BSRAM block. No extra block for this size; 384 words remain spare.
- OAM set layout: visible slot `n` reads descriptor
  `(oamBase + n) % 64`. Keep `oamBase` aligned to eight in software; wrap at
  the end so a set at 63 continues at 0.
- Palette set layout: bank 0 text, bank 1 art, bank 2 sprite, bank 3 spare;
  `pal_raddr = {paletteSet[2:0], type[1:0], entry[3:0]}`.
- Put both indices in the unused upper bits of control 5 at `0xF200A`:
  - bits 1:0: sprite pattern write page (unchanged),
  - bits 7:2: OAM base descriptor 0–63,
  - bits 10:8: palette set 0–7.
  A raster handler writes one word to swap OAM and palette together.
- Window layout, at the shipped `0xF6000` base:
  - `0xF6000–0xF607F`: 64 OAM descriptors;
  - `0xF6080–0xF627F`: eight palette sets;
  - `0xF6280–0xF62FF`: spare.
  The 2026-11-01 sprite-window work landed first (`5641adc`), so this base is
  final and set 0 is byte-identical to the current layout.

**Ports and timing:** the palette is read on active pixels and OAM only during
line blanking, so the block can use one read port muxed between them and one
write port muxed for palette/OAM CPU stores (pseudo-dual-port). The OAM loader
needs a one-cycle BSRAM read latency (preload before blanking), an explicit
reset clear (128 words) or valid bits, and a read-after-write rule. Latch the
OAM base at the start of the line loader so a mid-line write cannot mix two
descriptor sets.

**Raster use:** write control 5 at the raster line compare. Palette changes
apply to pixels after the store; OAM changes apply to the **next** line's
loader. This gives one split per raster compare. Multiple splits require
chaining control 7 to the next line in the handler, or a small raster table;
that is a separate decision. The eight visible comparators and priority chain
stay unchanged — this is set swapping, not more simultaneous sprites.

**Budget:** no new BSRAM block for 64 OAM + 8 palette sets. Sixteen palette sets
would consume the full 1,024-word block and leave no room for OAM in it; that
variant needs OAM in flops or a second block. The control/mux/reset logic adds
CLS against the current **14-free** budget, so this must be measured, not
assumed. Implementation plan: [`OAMPLAN.md`](OAMPLAN.md).

**Verification:** extend `rtl/sim/dvi_tile_tb.cpp` for OAM base wrap, palette
set selection, one-store swap, reset clear, write/read latency and a raster
split; run `npm run sim:dvi:tile`, the showcase tests and `npm run synth:tile`
(compare CLS and BSRAM). Update `MEMMAP.md`, the FiT how-to, the Forth `SEG_*`
constants and the simulation tile engine/tests.

**Status:** **implemented (2026-11-02).** Phases 1 and 2 shipped together:
Phase 1 alone did not place, and removing the OAM descriptor mux paid for the
palette sets. Window `0xF6000–0xF627F`, control 5 = scene select, 1,024-word
`tilepal3.hex`, 128-word reset clear, BIOS clear widened to 128, Forth
`scene!`/`oam-base!`/`pal-set!`. Result: 4,260 / 4,320 CLS, BSRAM 26/26,
745 tests, tile sim covers sets, base wrap and the reset clear. Details and the
measurement: [`OAMPLAN.md`](OAMPLAN.md).

**Board-verified (2026-11-02).** Palette sets, OAM base and descriptor
addressing all work. A first build failed above base 8: Gowin had merged the
`oam_base + slot` adder with the palette address arithmetic, so the high base
bits never reached the RAM address. Replacing the adder with a 6-bit
descriptor counter loaded at the line start (`c3ec403`) fixed it; the board
sweep shows descriptor `n` at base `n` for 0…56, the netlist takes the address
straight from `oam_desc[5:0]`, and base 60 wraps to slots 4–7 = descriptors 0–3
on the board. **Lesson:** do not put a variable-start adder in the tile RAM
address path; use a counter.

**Raster IRQ: pending (2026-11-03).** The tile engine's compare is verified in
simulation and the fitted netlist connects the synchronised request level to
SIC `src[3]`, yet on the board the request level stays low (LED5 steady on),
`PENDING` bit 3 never sets and only `raster-ticks` advances ~2 per console
command. The handler disassembles correctly and acknowledges control 7. Next
step (agreed): a one-bit `raster_seen` latch set at the compare and cleared only
by reset, driving LED5 — if it lights, the compare fires and the fault is the
request/SIC path; if not, the compare (`raster_line`/`ry`/`render_stall`) is at
fault. Everything else from `OAMPLAN.md` is verified. Prior status: design recommendation only; no RTL or
simulation change
applied.

---

## 2026-11-01 — Sprite pattern window is 8 groups; expand it to all 24 (option A)

**Priority:** medium — architectural cleanup; no BSRAM cost, but a memory-map
change.

**Area:** `rtl/dvi/dvi_tile.sv` (`SPR_GROUPS`, `SPR_PAGE_WORDS`, `sprite_page`,
`sprite[{sprite_page, cpu_addr[10:0]}]`); `rtl/deep16_top.sv` (`spr_hit`,
`tile_addr`); `rtl/deep16_board.sv` (tile FIFO width); `MEMMAP.md` §7.4;
`doc/FiT-Graphics-howto.md` §1/§7.

**Observed:** the sprite pattern bank holds 24 groups x 256 words = 6,144
words, but the CPU window `0xF4000–0xF47FF` exposes only 2,048 words = 8
groups. Control 5 (`0xF200A`) selects which 8-group page the writes land in:

```systemverilog
localparam int SPR_GROUPS = 24;
localparam int SPR_PAGE_WORDS = 8 * 256;      // 2,048
sprite[{sprite_page, cpu_addr[10:0]}] <= cpu_data;
```

All eight OAM sprites are writable at any time; the paging is on the pattern
bank, not on the sprites. Any group can be written after one control-5 store,
but there is no contiguous window over all 24 groups, and `0xF4800–0xF4FFF`
is unused because `spr_hit` stops at `0xF47FF`.

**Why it exists:** the map packs OAM/palette immediately after the sprite
window at `0xF5000`, leaving room for only 2K words. The 24 groups need 6K
words. The page register is two extra address bits, not a storage or bandwidth
limit.

**Proposal (option A):**

- Extend the sprite window to `0xF4000–0xF57FF` (6,144 words, all 24 groups).
- Move OAM/palette from `0xF5000–0xF50AF` to `0xF6000–0xF60AF` (keep the
  existing 0x80/0x90/0xA0 bank offsets inside the page).
- Remove `sprite_page` and control 5, or keep the register as a no-op for
  compatibility.
- Grow the CPU-side sprite/FIFO address from 12 to 13 bits: `tile_addr`,
  `tf_addr`, `dvi_cpu_addr`, and the top-level `spr_hit` decode all need the
  wider path. The sprite array itself is already 6,144 words, so **no extra
  BSRAM is required**.
- Update `MEMMAP.md`, `doc/FiT-Graphics-howto.md`, `rtl/dvi/README.md` and the
  Forth `gfx`/palette address constants.

Options B (4K window, 16 groups, page for the last 8) and C (reduce to 16
groups) were considered and are not requested. Option D (keep the page) is the
current state.

**Verification:** write group 0 and group 23 through the extended window and
render both; check OAM and all three palette banks at the new base; extend
`rtl/sim/dvi_tile_tb.cpp`; run `npm run sim:dvi:tile` and
`tests/showcase-*.test.js`; run `npm run synth:tile` and compare CLS/timing
(the wider decode should not change BSRAM).

**Status:** **fixed (2026-11-02, branch `fit-windows`, option A).** The sprite
window is `0xF4000–0xF57FF` (6,144 words, all 24 groups) and OAM/palette moved
to `0xF6000–0xF60AF`, with the 0x80/0x90/0xA0 bank offsets unchanged inside the
page. `tile_addr`, `tf_addr` and `dvi_cpu_addr` are 13 bits; only the sprite
window uses bit 12, every other window decodes from its low 12 bits. Control 5
is kept as a compatibility no-op. `0xF4800–0xF5FFF` is now either sprite
(through `0xF57FF`) or the deliberate `0xF5800–0xF5FFF` gap.

Verified by `rtl/sim/dvi_tile_tb.cpp`: group 8 and group 23 are written through
the flat window and render, a page-2 store still lands in group 0 (proving the
page no longer redirects), the legacy register still latches and clamps, and
group 24 stays disabled. `tests/tile-engine.test.js`,
`tests/flash-assets.test.js` and the showcase palette/OAM constants
(`0xF60A0`/`0xF60A1`…, OAM `0xF6000`) were updated. `npm run synth:tile`:
**4,306 / 4,320 CLS**, BSRAM 26/26, all TNS 0.

**Board test (2026-11-02).** The first flash showed the bird and clouds but no
pipes or ground. Cause: `deep16_top` forwarded `mem_waddr[12:0]` for every
window, and the tilemap base `0xF1000` has bit 12 set (`0xF1000 & 0x1FFF =
0x1000`), so `cpu_addr < TM_WORDS` rejected every tilemap store; the sprite
bank and tile bank were unaffected because they index from bit 11 down. Fixed
by forwarding the window offset (`mem_waddr[11:0]`) for every window except the
sprite bank, and by slicing the tilemap guard to `cpu_addr[11:0]`, so the upper
window bits can never drop a store again. `dvi_tile_tb.cpp` now writes a
tilemap cell with bit 12 set and checks it lands at offset 40.

**Board-verified (2026-11-02, `e4a4b00`).** After the reflash: pipes, ground,
clouds, bird and all text styles render, and Flappy collides exactly where the
pipes are drawn. The upper tile bank writes and the flat sprite window are in
the shipped bitstream. `cf-protect` must be run again (status `0x38`).

---

## 2026-11-01 — Move graphics assets out of the image and load them from flash

**Priority:** low — future architecture; depends on the tile-bank and sprite
window work.

**Area:** `rtl/dvi/dvi_tile.sv` (`$readmemh` of `tilefont.hex`,
`birdsprite.hex`, `tilepal3.hex`); `asm/forth_nano.asm` and its `cf-*`/`slice`
loader; `scripts/make_image.mjs`; `js/deep16_simulator.js` (`SpiFlash`);
`TILESIM.md`.

**Observed:** the tile bank, sprite bank and palette are initialised from
files baked into the bitstream. The boot image also carries the showcase code.
The CPU can now rewrite all 128 tile slots and all 24 sprite groups (see the
2026-10-31 and 2026-11-01 entries), so the only remaining blocker for a
runtime loader is the flash-to-window path itself.

This is a leftover from the time when there was no runtime storage. It is no
longer necessary: the board has a 4 MB P25Q32U on SPI CS1, the nano boot
script already has config-flash helpers (`cf-wren`, `cf-status`,
`cf-read-burst`, `cf-protect`/`cf-unprotect`, `slice`), and the JS simulator
already models that flash byte for byte (`SpiFlash`).

**Proposal:** store font, art, sprites, palettes and eventually the showcase
module in config flash; load them at runtime through the existing SPI port and
CPU windows. Remove the `$readmemh` initial contents and the baked graphics
from the boot image once the loader path is proven.

Dependencies and constraints:

- **All 128 tile slots must be writable** for a full flash-loaded tile bank;
  the current window covers 96 (see the upper tile-bank entry).
- **Sprite groups:** resolved — the flat 24-group window (`0xF4000–0xF57FF`)
  lets a loader copy the bank linearly; control 5 is a no-op.
- **Palette:** already fully writable at `0xF6080–0xF60AF`; no window change.
- **Format and loader:** define an asset blob (slices or a dedicated section),
  decide whether the kernel stays resident or also loads, and measure boot
  latency (loading ~10K words over SPI is not free).
- **Simulation:** this reverses the current `TILESIM.md` video-ROM decision.
  The engine must power on blank; assets live in the simulated flash; a loader
  writes the banks; tests and the headless renderer run the loader first. No
  `js/deep16_video_rom.js` seeding.
- **RTL parity:** the board still bakes graphics today, so simulation would run
  ahead of the bitstream until the RTL follows. Pixel comparisons must be made
  after the loader has written the same assets.

**Verification:** a loader test that starts blank, reads the flash blob, writes
tile/sprite/palette windows and renders the expected frame; compare the loaded
banks word for word with the current `tilefont.hex`/`birdsprite.hex`/
`tilepal3.hex`; measure boot time; check `npm run sim:dvi:tile` and the full
test suite. No synthesis change is expected until the `$readmemh` removal.

**Status:** open — logged as low priority 2026-11-01, design only. Do not
remove the baked ROM until the loader and the writable-window prerequisites
are in place.

---

## 2026-10-31 — 81 vs 82 columns, and a low-CLS four-direction scroll proposal

**Area:** `rtl/dvi/dvi_tile.sv` (`scroll_x`, `scroll_y`, `wrap_rows`);
`asm/forth_nano.asm` (`tile_off`, tile cursor); `doc/FiT-Graphics-howto.md` §5.

### Column count

The visible area is 80 cells; the map is 82 columns.

With the current 16-pixel Flappy scheme (`scroll_x = 0..15`):

| `scroll_x` | start | reaches |
|---|---|---|
| 0..7 | column 0, phase 0..7 | column 80 |
| 8 | column 1, phase 0 | column 80 |
| 9..15 | column 1, phase 1..7 | **column 81** |

So **82 columns are required** for the current scheme. 81 columns only cover
`scroll_x = 0..8`; the last seven phases would read past the map.

81 is enough only if the game changes the scheme:

- limit the phase to 0..7 and rewrite the edge column at the wrap, or
- redraw the map every 8 pixels instead of every 16.

The bird's H-flip itself costs no map columns (OAM bit 13). If the **world**
must scroll both ways, the 80 visible columns need a margin on each side:
visible columns 1..80, margins 0 and 81. That again means **82**.

### Proposal: one 26-row wrap, centered window, software ring

The existing engine already has almost everything needed:

- 82x26 map;
- `scroll_x` 0..15, split into a coarse column and a 0..7 fine phase;
- `scroll_y` 0..30, with carry into the next row;
- two tilemap banks and a per-row fine-scroll table.

The cheapest route to four directions is:

1. **Use the whole 26-row map.** Change `wrap_rows` from `ROWS = 24` to
   `TILE_ROWS = 26`. The terminal also moves to a 26-row ring: `tile_off`
   becomes 0..25 and its row arithmetic uses `%26`. The visible window stays
   24 rows; rows 24–25 become the two hidden ring rows the map was sized for.
   This is a constant change plus console software, with **no new registers,
   tables or BSRAM**.

   Careful: the current function subtracts from `s[4:0]`, which is only safe
   while the sum stays below 48. With a 26-row ring the sum can reach
   `25 + 25 = 50`, so the subtract must use the full 6-bit sum (or two
   conditional subtracts). Otherwise sums 48–50 alias to the wrong row.
2. **Center the visible window.** Visible cells are map columns **1..80** and
   rows **1..24**. Margins are column 0/81 and row 0/25.
3. **Use existing registers as signed offsets.**
   - `scroll_x = 8` is center; 0..15 covers roughly -8..+7 pixels.
   - `scroll_y = 15` is center; 0..30 covers -15..+15 pixels once the wrap is
     26.
   No new scroll register is needed.
4. **Ring-shift in software at the extremes.**
   - At `scroll_x = 0` or 15, shift the whole map one column left/right,
     reset `scroll_x` to 8, and write the new margin column. With 26 rows this
     is 2,132 tile writes (26 x 82).
   - At `scroll_y = 0` or 30, shift the whole map one row up/down, reset
     `scroll_y` to 15, and write the new margin row. This is also 2,132 tile
     writes (26 x 82).
   - At 1 pixel/frame that is roughly 24k writes/s (about 7.5 horizontal and
     4 vertical shifts per second); at several pixels/frame it rises toward
     100k writes/s. Measure the CPU cost before promising fast scrolling; a
     full back-bank redraw or a small coarse-origin register are the fallbacks
     if it is too high.
5. **Keep `scroll_x` and the display bank latched together.** `scroll_x` is
   latched with the tilemap page; `scroll_y` is not, so write it in vblank.
   The per-row table remains available for Frogger-style lanes; a free-camera
   game uses the global `scroll_x`.
6. **Do not add a per-column fine-scroll table.** It would be the vertical
   equivalent of control 6 and is the expensive option; the ring shift already
   gives 1-pixel motion.

### CLS budget

The preferred path adds **no new state**: only the `wrap_rows` constant
changes, and the console's `%24` arithmetic becomes `%26`. The constant
comparator/subtractor may even synthesise to the same size; this must be
checked with `npm run synth:tile`, not assumed.

If changing the terminal to 26 rows is too invasive, the fallback is to keep
the terminal on 24 rows and select a 26-row wrap for games when
`scroll_y != 0`. That adds a small comparator/mux in the fill path, likely a
few CLS — measure it against the **8 free CLS**. In that fallback the game
keeps `row_off = 0`, so its sum stays below 26 and the existing 5-bit
subtraction is enough; the terminal keeps its 24-row range. If the fallback
does not fit either, the zero-RTL option is a full-frame redraw into the back
tilemap bank; that supports arbitrary four-direction movement but costs about
1,920 tile writes per frame and needs a CPU-cost measurement.

**Verification:** `npm run sim:dvi:tile`; add tests for `scroll_y` 0/7/15/30,
rows 24/25 actually visible, both `scroll_x` extremes, and terminal row
arithmetic at `tile_off = 24/25`; run `npm run synth:tile` and compare CLS.

**Status:** RTL/terminal and the game-side helper/demo are implemented;
`tests/scroll4.test.js` verifies the margins and measures the cost. At
1 px/frame the helper costs about 10.7 % of a 60 Hz frame on core3.
**Gowin check (2026-11-02):** 4,312 / 4,320 CLS (8 free), BSRAM 26/26,
SSRAM 190; `dvi_render` 28.011, `dvi_pixel` 75.017, `psram_clk` 93.009 MHz,
all TNS 0. The bitstream is built; board flash/test of the ring is pending.
See `SCROLLPLAN.md`.

---

## 2026-10-31 — Upper tile bank (tiles 96–127) is not CPU-writable

**Area:** `rtl/dvi/dvi_tile.sv` (`TILE_CPU_WORDS`, `bank_hit`,
`tilefont[cpu_addr]`); `rtl/deep16_top.sv` (`bank_hit`);
`MEMMAP.md` §7.4; `doc/FiT-Graphics-howto.md` §2.3/§2.4.

**Observed:** the tile bank has `TILE_COUNT = 128` tiles x 32 words (4,096
words), and `tilefont` is sized for all 128. The CPU window is nevertheless
limited to 96 tiles:

```systemverilog
localparam int TILE_CPU_WORDS = 96 * 32;      // 3,072
wire bank_hit = mem_we && (mem_waddr >= 21'h0F3000) &&
                         (mem_waddr <= 21'h0F3BFF);
2'd1: if (cpu_addr < 12'(TILE_CPU_WORDS)) tilefont[cpu_addr] <= cpu_data;
```

A write to `0xF3C00`–`0xF3FFF` is ignored. Tiles 96–127 can therefore only be
loaded by `$readmemh("tilefont.hex", tilefont)` at power-up; the CPU cannot
change them at runtime. The 32 baked art slots are read-only in practice.

**Impact:** a game that wants to replace or animate the baked art slots cannot
do so without rebuilding the bitstream. Runtime art is limited to the 47 free
gap slots plus tile 0 (and the text pages, if the font is sacrificed), even
though 32 more tile slots exist in the bank. The memory map also shows an
unexplained 1,024-word hole between the documented tile window and the sprite
window at `0xF4000`.

**Investigate:**

1. Is the 96-tile window deliberate (the old "96 glyph tiles" contract) or a
   leftover from before the bank grew to 128 tiles?
2. Check the board path: the tile FIFO, `deep16_top.sv` decode, and the
   PSRAM/Forth mirror must all accept `0xF3C00`–`0xF3FFF` before the window can
   grow. Confirm `cpu_addr`/`tile_addr` widths and the `tile_tgt` routing.
3. Decide whether the intended contract is:
   - **read-only baked art** (keep 96 and document it), or
   - **all 128 tiles CPU-writable** (extend the window to `0xF3FFF`).
4. If extending: change `TILE_CPU_WORDS` to `TILE_COUNT * 32`, extend
   `bank_hit` to `0xF3FFF`, update `MEMMAP.md`, `rtl/dvi/README.md` and the
   how-to, and add a test that writes tile 96 and tile 127 and renders them.
   Check the Gowin fit; no extra BSRAM should be needed because the array is
   already 4,096 words.

**Files:** `rtl/dvi/dvi_tile.sv`, `rtl/deep16_top.sv`,
`rtl/deep16_board.sv` (FIFO/decode), `rtl/sim/dvi_tile_tb.cpp`,
`MEMMAP.md`, `rtl/dvi/README.md`, `doc/FiT-Graphics-howto.md`.

**Status:** **fixed (2026-11-02, branch `fit-windows`).** The 32-tile hole was
a leftover from the old 96-glyph contract, not a design requirement.
`TILE_CPU_WORDS` is now `TILE_COUNT * 32`, `bank_hit` covers `0xF3000–0xF3FFF`,
and `tilefont[cpu_addr[11:0]]` is written for every address in the window.
`rtl/sim/dvi_tile_tb.cpp` writes solid tiles 96 and 127, maps each and checks
the rendered pixel; `tests/tile-engine.test.js` does the same for both slots.
`MEMMAP.md`, `doc/FiT-Graphics-howto.md`, `rtl/dvi/README.md` and the JS
engine/loader were updated. No extra BSRAM: the array was already 4,096 words.
`npm run synth:tile`: **4,291 / 4,320 CLS**, BSRAM 26/26, all TNS 0.

---

## 2026-10-31 — FiT vertical scroll wraps at 24 rows, not the 26-row map

**Area:** `rtl/dvi/dvi_tile.sv` (`wrap_rows`, `frow` in the fill path);
`doc/FiT-Graphics-howto.md` §5.2; `rtl/dvi/README.md`.

**Observed:** `scroll_y` is documented as a 0..30 pixel offset over the 82x26
tilemap, with rows 24–25 described as vertical margin. In the RTL the fill does:

```systemverilog
frow <= wrap_rows({1'b0, fill_trow_val} + {1'b0, row_off});
```

and `wrap_rows` subtracts `ROWS = 24`, not `TILE_ROWS = 26`. Rows 24–25 are
therefore not part of the normal `scroll_y`/terminal ring. (At the extreme
`row_off` value the single subtraction can emit row 24, but that is not a
usable off-screen margin.) `scroll_y` is a **24-row circular scroll**, not a
26-row scroll with two off-screen rows.

**Reproduced** with the tile simulation (`npm run sim:dvi:tile` plus a probe on
`dbg_fline`/`dbg_frow`):

| `scroll_y` | top visible row | bottom visible row |
|---|---|---|
| 0 | 0 | 23 |
| 7 | 0 | 0 (wrapped) |
| 15 | 1 | 0 (wrapped) |
| 30 | 2 | 1 (wrapped) |

Rows 24–25 do not appear in the normal `scroll_y` path.

**Impact:** a vertical tile-based scroller has no hidden row in which to
prepare the next row. Every one of the 24 map rows is always somewhere on
screen, so updating a row at the wrap can produce a visible one-row pop. A
Flappy-style game rotated to vertical movement can still use `scroll_y` as a
24-row ring, but it should either use the second tilemap bank as the off-screen
buffer, use sprites for moving content, or accept the update at the wrap.

**Fix applied:** the 26-row map is now used by both the fill path and the
terminal:

1. `wrap_rows` subtracts from the full six-bit sum and uses `TILE_ROWS` (26).
2. The terminal uses a 26-row ring (`tile_off = 0..25`, physical row `% 26`);
   the visible window remains 24 rows.
3. `rtl/sim/dvi_tile_tb.cpp` now checks `scroll_y` 0/7/15/30 and observes map
   rows 24/25; `tests/tile-console.test.js` checks the 26-row terminal ring and
   its wrap at 25 -> 0.
4. `doc/FiT-Graphics-howto.md`, `rtl/dvi/README.md` and `MEMMAP.md` describe
   the centred four-direction window.

**Remaining:** the game-side ring helper is in `SCROLLPLAN.md`; the Gowin
check is in the 2026-10-31 scroll entry (4,312 / 4,320 CLS, all TNS 0).

**Status:** fixed in RTL and terminal; tile simulation and full test suite pass.
