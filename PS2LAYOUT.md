# PS2LAYOUT — software Set-2 decoding, multiple layouts, and the freed BSRAM block

Status: **implemented vertical slice (2026-11-23).** The receiver emits raw
events, the BIOS decoder maps DE/US, the pROM is gone, and the full test suite
passes. Board verification, persistence and the freed-BSRAM follow-up remain
open.
Supersedes the open 2026-11-02 entry in `ERRPLAN.md` ("Move PS/2 scan-code
mapping to software and free its BSRAM block").
Related: `PS2PLAN.md` (host init and sender), `HARDWARE.md`, `MEMMAP.md`,
`COMPANION.md`.

## 1. Decision in one paragraph

Stop translating Set-2 scan codes to ASCII in `rtl/ps2_rx.sv`. The receiver
keeps the frame, parity, break/extended and modifier state, but pushes a
**16-bit raw key event** into the architectural keyboard FIFO. A single BIOS
decoder maps that event through a **layout table in the boot image**, and the
existing console and games consume the same ASCII bytes they consume today.
The 2048 × 8 pROM disappears, so layouts become data: DE stays the default,
and US/FR/UK/ES can be added or selected without touching the bitstream. The
pre-move report showed `25 SDPB + 1 pROM`; the first post-move synthesis still
reports 26 SDPB, so the block-reuse follow-up is open (§9).

The pROM is **one** 18 Kbit block, not two. A hardware implementation of a
second layout would need a second pROM page; a software implementation needs
none.

## 2. What exists today (measured)

Resource snapshot from `fpga/gowin/impl/pnr/deep16_board_tile_flash.rpt.html`
(2026-11-20):

| Resource | Usage | Note |
|---|---|---|
| BSRAM | `25 SDPB + 1 pROM` = 26/26 | the pROM is `u_ps2/ps2map` |
| CLS | 4,293 / 4,320 | 27 free |
| Logic | 8,495 / 8,640 | 145 free |
| Registers | 2,841 / 6,771 | |
| `clk_cpu` | 20.246 MHz | TNS 0 |

The data path:

| Piece | Where | Behaviour |
|---|---|---|
| Frame receiver | `rtl/ps2_rx.sv` | start/8 data/odd parity/stop, timeout, `frame_error`, `frame_valid` for ACK/BAT |
| Set-2 state | `rtl/ps2_rx.sv` | break `0xF0`, extended `0xE0`, Shift/Ctrl/Alt/Caps |
| Hardware remap | `rtl/ps2_rx.sv` | extended arrows/Home/End -> synthetic `0x90..`; AltGr -> synthetic `0x80..` |
| Character map | `rtl/ps2_rx.sv` + `scripts/make_ps2map.mjs` | 2048 × 8 pROM, address `{ctrl, caps, shift, scan_code}`, German QWERTZ |
| Board push | `rtl/deep16_board.sv` | decoded ASCII -> `kbd_push` and (if enabled) UART RX |
| FIFO | `rtl/deep16_top.sv` | 16 × 16-bit, `0xF0060`/`0xF0062` |
| Console | `asm/forth_nano.asm` | BIOS f4 `getch`, f5 `getstr`, both read FIFO bytes |
| Keyboard IRQ | `asm/forth_nano.asm` | drains the FIFO into a 32-cell ring at DS `0x52C0`; BIOS f12 pops one byte |
| Games/menu | `asm/showcase/*.asm`, `asm/pole/pole_game.asm` | poll `0xF0060`/`0xF0062` directly and compare ASCII |
| Host cores | `js/deep16_simulator.js`, WASM core | push ASCII through `enqueueKeyCode`/`kbd_push` |

The map generator is the only source of layout truth. `ps2map.hex` is baked
into the bitstream by `$readmemh`; it is also part of the bitstream/asset stamp
in `scripts/build_gowin_tile_flash.sh`.

## 3. Target architecture

```
PS/2 pins
   |
   v
ps2_rx.sv            frame + parity + break/extended + modifiers
   |                  (no character table, no synthetic code remap)
   |  16-bit raw event, one pulse per make
   v
kbd FIFO 16 x 16     0xF0060 status / 0xF0062 data
   |
   +--> BIOS f4 / f5 / f12  ---> ps2_decode ---> ASCII ---> console
   +--> showcase menu       ---> ps2_decode ---> ASCII ---> menu keys
   +--> games (via BIOS f4) ---> ps2_decode ---> ASCII ---> game keys
                                 ^
                                 |
                         layout tables in the boot image
                         (DE default, up to five layouts)
```

ASCII hosts (the browser IDE and the WASM core) keep pushing ASCII. The decoder
recognises a legacy byte by bit 15 = 0 and passes it through, so no host-side
change is needed.

## 4. Raw event transport

One 16-bit word per **make** event. Modifier, prefix and break frames update
the receiver state but do not push an event; key-up is still not part of the
software contract.

| Bits | Meaning |
|---|---|
| 15 | `1` = raw event, `0` = legacy ASCII byte in bits 7:0 |
| 14 | extended (`E0` prefix) |
| 13 | Caps Lock state |
| 12 | Alt / AltGr state |
| 11 | Ctrl state |
| 10 | Shift state |
| 9 | reserved: break (0 today) |
| 8 | reserved: 0 |
| 7:0 | Set-2 make code |

So the board push is:

```systemverilog
kbd_push_data = {1'b1, ext, caps, alt, ctrl, shift, 1'b0, 1'b0, scan_code};
```

Keeping Caps/Shift/Ctrl/Alt in the event, rather than making software track
them, preserves the existing behaviour and avoids a second FIFO protocol. A
layout change only changes the table, not the state machine. Typematic repeats
are make codes and are forwarded like any other make; key-up is not part of the
contract today and stays that way.

## 5. RTL changes

### 5.1 `rtl/ps2_rx.sv`

- Keep: synchronisers, timeout, frame/parity/stop checking, `frame_error`,
  `frame_valid`, break/extended tracking, Shift/Ctrl/Alt/Caps state,
  `scan_code` and `modifiers` outputs.
- Remove: `ps2map`, `map_q`, `map_wait`, the registered ASCII pipeline, the
  synthetic `remap_code` case block, the `ascii` and `valid`-as-ASCII path.
- Add output `extended`; drive `valid` for one cycle on a non-modifier make
  code (including extended keys and AltGr keys). Do not emit for ACK/BAT
  (`0xFA`/`0xAA`), echo, resend/error, break frames or the modifier keys
  themselves; those still update state and `frame_valid`.
- Keep `valid` and `frame_valid` distinct: `frame_valid` still covers ACK/BAT
  for `ps2_init`.
- The module no longer needs `ps2map.hex` or `$readmemh`; `CLK_HZ` stays for
  the frame timeout.
- The host sender and `ps2_init` (BIOS functions 7/8, `PS2PLAN.md`) are
  untouched; they use `frame_valid`/the frame toggle, not the character path.

### 5.2 `rtl/deep16_board.sv`

- `ps2_key = ps2_valid` (no ASCII-nonzero filter).
- Push the raw word from §4 into `kbd_push_data`.
- Delete `ps2_ascii`, the `uart_push_en` gate and control-6 bit 11. The old
  PS/2 -> UART RX bridge cannot work without a decoder in the board, and it
  already resets disabled. The UART remains the separate `serial`/XMODEM
  stream. Document control-6 bit 11 as reserved.
- Keep control-6 bits 9/10 (host GPIO), the frame toggle, and the level bits.
- Measured placement note from `HARDWARE.md`: the disabled bridge was left in
  the netlist because a hard tie lost 15 CLS. Removing the whole mux is a
  deliberate change: re-run `npm run synth:tile` and do not assume a CLS win.

### 5.3 FIFO and IRQ

- `rtl/deep16_top.sv` needs no change: the FIFO is already 16 × 16-bit.
- `irq_keyboard` in `asm/forth_nano.asm` already copies the full 16-bit
  `KBD_DATA` word into its ring; it now carries raw events and needs no storage
  change. BIOS f12 `bios_kbd_read` decodes the event when it pops it, and skips
  events that produce no character.

### 5.4 Simulation

- `rtl/sim/ps2_rx_tb.sv` and `.cpp` expect `ascii`; change them to collect
  `{extended, modifiers, scan_code}` and assert the raw event stream.
- `scripts/build_ps2_sim.sh` no longer runs `make_ps2map.mjs` and no longer
  changes directory to `artifacts/image`; there is no `$readmemh` file.

## 6. Software decoder

### 6.1 Where it lives

The BIOS/demo segment is copied from image `0x4A00..0x6FFF` to CS `0x3000`, and
the FPU currently ends at `0x699B`. The free tail `0x699C..0x6FFF` is the only
large hole left after the showcase overlay and the FPU.

| Range (word address) | Use |
|---|---|
| `0x699C..0x6A8F` | `ps2_decode` and its small fixed tables (244 words maximum) |
| `0x6A90..0x6F8F` | five layout entries × 256 words |
| `0x6F90..0x6FFF` | slack / future header |

Reasons for this home:

- it is in the boot image, so the menu (which runs before the boot script) can
  use it;
- it is reached from BIOS code with a 15-bit offset
  (`0x699C - 0x4A00 = 0x1F9C`);
- it costs no BSRAM and no extra segment;
- the image already copies that range, so no loader change is needed.

Add a build assertion that the decoder end is `<= 0x6A90`, that the tables end
at `<= 0x7000`, and that the FPU still ends at `<= 0x699B`. If the FPU grows,
the build must fail rather than silently overwrite the decoder.

If 228 words is not enough, the first fallback is four layouts instead of five
(frees 256 words); the second is a larger image window, which is a separate
loader change and is not part of this plan.

### 6.2 Inputs, state and callers

- Input `R1` = the 16-bit FIFO word. Output `R1` = ASCII, `0` = no character.
- Use only `R1`-`R4`, `R7` and `R9`; preserve `R5`/`R6` (`>IN`/`TIB`),
  `R10`-`R12` (f5's line state) and the caller's DS, as every BIOS routine
  must.
- The active layout index is a word at **DS `0x57DC`**, initialised to 0 in the
  image. It is the last free word in the BIOS data block. The decoder saves DS,
  selects DS `0x1000`, reads the cell, restores DS, clamps the index to
  `0..4` and uses the clamped value.
- The tables are read `CS`-relative, so the decoder does not depend on the
  caller's DS after the index read.
- Callers:
  - BIOS f4 (`getch`) and f5 (`getstr`) call it directly, in the same CS.
  - BIOS f12 (`bios_kbd_read`) calls it after popping the ring.
  - The showcase menu runs in the BIOS CS after BIOS f6; it calls it directly
    at a published offset.
  - Games in their own segments call BIOS f4 through `SWI`.

### 6.3 Decode order

This mirrors `scripts/make_ps2map.mjs` today, so default DE output is
byte-for-byte unchanged:

1. `bit15 == 0` -> return `event & 0xFF` (legacy ASCII host).
2. `code >= 0x80` -> return 0. Set-2 has a few make codes above `0x7F`
   (`0x83` is F7); the table has 128 entries, and none of those keys type.
3. `extended` -> fixed navigation table; return `C-B/C-F/C-P/C-N/C-A/C-E` or
   0 for an unmapped extended key. Extended keys bypass the layout table, as
   they do today.
4. Read the active layout.
5. Read `plain[code]`: low byte = unshifted, high byte = shifted.
6. If Alt/AltGr is down, read `alt[code]`: low byte = AltGr,
   high byte = AltGr+Shift. A zero AltGr byte means "fall through".
7. Letters: Caps and Shift both select the shifted form and cancel each other;
   Ctrl maps ASCII `a..z` to `0x01..0x1A` and Latin-1 letters (the umlauts) to
   0, exactly as the current table does.
8. Non-letters: Shift selects the shifted byte; Ctrl and Caps do nothing.
9. Return 0 for an unmapped key; `getch`/`getstr` consume it and try the next
   event.

Pseudo-code:

```
decode(event):
    if not (event & 0x8000): return event & 0xFF
    code = event & 0xFF
    if code >= 0x80: return 0
    if event & 0x4000: return ext_fixed[code]

    layout = clamp(active, 0, 4)
    plain  = keys[layout].plain[code]
    base   = plain & 0xFF
    upper  = plain >> 8
    alt    = keys[layout].alt[code]

    if mods.alt and alt:
        return mods.shift ? (alt >> 8) : (alt & 0xFF)

    if is_letter(base):
        ch = (mods.shift ^ mods.caps) ? upper : base
        if mods.ctrl: ch = (base in 'a'..'z') ? base & 0x1F : 0
        return ch
    return mods.shift ? upper : base
```

`is_letter` covers ASCII `a..z` and Latin-1 `0xE0..0xFE` except `0xF7`.

### 6.4 Table format

Each layout entry is 256 words:

| Offset | Contents |
|---|---|
| `+0x000` | `plain[128]`: one word per scan code, low = base, high = shifted |
| `+0x080` | `alt[128]`: one word per scan code, low = AltGr, high = AltGr+Shift |

A 512-byte entry fits five layouts in `0x6A90..0x6F8F`. There is no per-layout
BSRAM; adding a layout is a data-only image change.

## 7. Layout data and generator

`scripts/make_ps2map.mjs` becomes a layout generator and keeps its tests:

- Keep the physical scan-code definitions (`KEYS`, `ALTGR`, `EXT`) or refactor
  them into a physical-key-id map so each layout can differ in letters as well
  as punctuation. AZERTY needs a per-layout letter map, so a physical-key-id
  layer is the cleaner shape.
- Export `LAYOUTS` with at least:
  - `de` — current German QWERTZ, default, including umlauts and the current
    AltGr set;
  - `us` — QWERTY, proving that a second layout is data-only;
  - then `fr` (AZERTY), `uk`, `es` as the table capacity allows.
- Export `layoutWords()` (the 256-word entries) and a reference
  `decodeEvent(event, layout)` used by tests. `ps2MapWords()` and
  `ps2map.hex` go away; the pROM consumer is gone.
- `scripts/make_image.mjs` overlays `layoutWords()` at `0x6A90` for D16D and
  asserts the range. The data is in the image, so `buildMemory(res)` in tests
  can load it by overlaying the same words.
- Default is layout 0 (DE). A Forth word in `forth/start.fth` or
  `screens/flash/essentials.fth` exposes selection:

  ```forth
  0x57DC constant layout-cell
  : layout@ ( -- n )  layout-cell @ ;
  : layout! ( n -- )  0 max 4 min layout-cell ! ;
  ```

  A UI that lists names can live in the same Forth file. The decoder clamps an
  out-of-range cell, so an erased or stale value cannot read past the table.

Persistence across a power cycle is deliberately out of the first cut. If it
is wanted, a one-cell settings object in config flash (written by an explicit
`layout-save`, read by `start.fth` before the prompt) is the natural follow-up;
it must not write flash on every key or on every switch.

## 8. Consumers to update

| Consumer | Today | Change |
|---|---|---|
| BIOS f4 `getch` | reads FIFO byte, masks `0x00FF` | decode each event until a character or the FIFO is empty |
| BIOS f5 `getstr` | reads FIFO byte, masks `0x00FF` | same decode; keep its line/echo state |
| `irq_keyboard` | ring already holds the full 16-bit `KBD_DATA` word | no storage change; the ring now carries raw events |
| BIOS f12 `bios_kbd_read` | returns ring word | decode the event; skip unmapped events |
| `asm/showcase/showcase.asm` menu | direct `0xF0060`/`0xF0062`, compares ASCII | direct decoder call at the published BIOS offset; skip unmapped events |
| `asm/showcase/flappy_game.asm` | direct FIFO, `Q`/`F`/Space | BIOS f4 helper (SWI), same ASCII comparisons |
| `asm/showcase/pacman_game.asm` | direct FIFO, arrows as `0x10/0x0E/0x02/0x06` | BIOS f4 helper; extended arrows still decode to those bytes |
| `asm/showcase/frogger_demo.asm` | direct FIFO | BIOS f4 helper |
| `asm/pole/pole_game.asm` `game_poll` | direct FIFO | BIOS f4 helper |
| `asm/forth_nano.asm` `word_key`/`word_keyq` | f4/f16 | no change; f4 now decodes, f16 still tests FIFO-ready |
| JS/WASM hosts | push ASCII | no change (legacy bit 15 = 0) |
| `serial`/XMODEM | UART RX | no change; PS/2 no longer mirrors into UART |

The menu is the special case: it runs inside the BIOS shadow bank before the
boot script, so it must call the decoder routine directly, not through SWI.
Give it a published constant (`PS2_DECODE_OFF = 0x1F9C`) and add a test that
the symbol in `forth_nano.asm` still matches it.

`key?` still reports "FIFO has data", not "FIFO has a decodable character". An
unmapped key (for example F1) can make `key?` true once; the following `key`
consumes it and keeps waiting. Document that, or add a "peek decoded" check
later. It is not a correctness problem for the console or the games.

## 9. The freed BSRAM block

- Removing the pROM removes the `pROM` instance, but the first synthesis after the move still reports **26 SDPB (26/26)**: the freed block is not visible at
the top level yet. The next step is to find which RAM inference grew (the
netlist shows `kbd_fifo` now as `RAM16SDP4`, and the tile/sprite banking may
have repacked). Do not claim a free block until the SDPB count drops.
- Do not allocate it in the same change as the decode move. First prove the
  keyboard on the board, then choose.
- Preferred use, from the old `ERRPLAN` analysis: extend the sprite pattern
  bank from **24 to 28 groups** (`+4 × 256 words = 1,024 words`, one block).
  The OAM group field is already 5 bits and the window is contiguous; the
  change is `SPR_GROUPS 24 -> 28` and the `loam_group_ok < 28` compare. It
  needs a renderer/window update and new memory-map documentation.
- Keep the block free if the CLS cost of the sprite change does not fit; CLS
  has only 27 words of margin and is the real constraint.

## 10. Build, assets and documentation

- `scripts/build_gowin_tile_flash.sh`: drop `ps2map.hex` from the asset stamp.
- `scripts/flash_gowin_tile_flash.sh`: drop the same file from verification.
- `scripts/build_ps2_sim.sh`: no map generation, no `artifacts/image` cwd.
- `scripts/make_image.mjs`: overlay the layout data at `0x6A90`; assert the
  decoder end and table end; include the tables in the image manifest/build
  hash.
- Delete `artifacts/image/ps2map.hex` and any stale pROM init references.
- The archived 24k-BSRAM projects include `rtl/ps2_rx.sv`; they are not part
  of the current build but will no longer elaborate if they expect `.ascii`.
  Either leave them frozen with a note or update them to the raw-event
  interface when they are next touched.
- Update:
  - `HARDWARE.md` PS/2 section (raw events, layouts, FIFO depth 16 not 8);
  - `MEMMAP.md` §7.2 and §4.1 (new event format, DS `0x57DC`, decoder/table
    addresses);
  - `PS2PLAN.md` with a pointer to this plan (Phase C);
  - `ERRPLAN.md` status for the 2026-11-02 entry;
  - `COMPANION.md` where it describes the pROM;
  - the generated OpenWiki pages are regenerated by the workflow, not edited
    by hand.

## 11. Verification

### Unit and generator

- `tests/ps2map.test.js` becomes `tests/ps2layout.test.js`: table shape,
  DE y/z, umlauts, AltGr, AltGr+Shift, Ctrl, Caps, non-letters, empty entries.
- A second layout (US) pins y/z, `@`, `"`, `#`, and the same Ctrl rules.
- `decodeEvent()` reference tests cover every scan code and modifier
  combination for each layout, including `code >= 0x80` (must return 0, not
  index past the 128-entry table).

### RTL

- `npm run sim:ps2`: raw make codes, extended, Shift/Ctrl/Alt/Caps snapshots,
  parity errors, timeout, ACK/BAT `frame_valid`.
- `npm run lint:rtl` and `npm run lint:board`.

### Software/integration

- New `tests/ps2-raw.test.js`: build the D16D image, load it in the JS core,
  push raw events into `kbdBuffer`, and type `1 2 +` through the BIOS; check
  the console and `getstr`.
- Same harness for US: `layout! 1`, type `y`/`z`, check the swap.
- Arrows/Home/End through the console and Pac-Man; AltGr `@ { [ ] } \ | ~`;
  Caps+Shift cancels.
- Legacy ASCII host tests (`enqueueKeyCode`) stay green.
- `console-parity`, `tile-console`, `scroll4`, `forth` and the showcase tests.
- Update the white-box harnesses that cap the image at `0x6000`
  (`tests/segmented.test.js`, `tests/segmented-showcase.test.js`,
  `tests/ps2-bios.test.js`) to copy the D16D tail `0x4A00..0x6FFF` and inject
  the tables, or to use `buildImage()`.

### Synthesis

- `npm run synth:tile`: record BSRAM, CLS, logic, registers and all clock
  Fmax. The first run after the move is `26 SDPB` (100 %), CLS 4,191 / 4,320,
  logic 8,226 / 8,640; the pROM is gone but the SDPB count has not dropped, so
  the freed-block follow-up is still open.

### Board

- Power-cycle with the DE layout: menu, console echo, umlauts/AltGr, arrows,
  Flappy/Pac-Man/Frogger/Pole keys, no-keyboard boot, button reset.
- `layout! 1` then type: US y/z and punctuation change without reflashing.
- `npm test`, then `npm run flash:tile` only after the asset stamp no longer
  names `ps2map.hex`.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A direct FIFO reader is missed; it sees a raw word as ASCII | grep every `0xF0060`/`0xF0062`/`0x20`/`0x22` reader; update the menu, all four games and Pole; add a test per game input |
| The decoder's table read is slow or breaks in an IRQ context | tables are in the same CS and image; test f12 with the keyboard IRQ enabled; measure one decode per key |
| The menu runs before the layout word or the boot script | menu calls the decoder directly with layout 0; the decoder handles an erased/out-of-range cell |
| The decoder competes with the FPU for `0x699C` | build assertions on `fpu_*_end`, decoder end and table end; fall back to four layouts if code grows |
| Removing the disabled UART bridge changes placement and CLS | synth before/after; keep the bridge netlist if the placement cost is worse, even though it is functionally dead |
| AltGr+Shift or FR AZERTY needs more combinations | the `alt[code]` high byte already carries AltGr+Shift; add layouts only after the DE/US path is proven |
| Legacy IDE/WASM hosts break | bit 15 distinguishes raw events; test ASCII passthrough first |
| `key?` is true for an unmapped key | document it; `key` consumes and continues; add a decoded-peek only if a real consumer needs it |
| Asset stamp/flash mismatch after deleting `ps2map.hex` | update both build and flash scripts in the same commit |

## 13. Phased checklist

- [x] **0. Baseline.** Recorded the 2026-11-20 synth report; ran `npm test`,
      `npm run sim:ps2`, `npm run lint:board`.
- [x] **1. Receiver-only RTL.** Removed the pROM/remap/ASCII pipeline, added
      `extended`, emit raw events, updated board push and `ps2_rx_tb`. No
      rollback branch was kept.
- [x] **2. Decoder and DE table.** Added `ps2_decode` at `0x699C`, the DS
      `0x57DC` cell, the layout overlay in `make_image`, and the DE entry.
      BIOS f4/f5/f12 now decode; the IRQ ring carries raw events. Console and
      `ps2-raw` tests pass.
- [x] **3. Menu and games.** The menu calls the decoder directly; the four
      games plus Pole use BIOS f4. Console, game and render tests pass.
- [x] **4. Second layout and selection.** US is index 1; the DS cell is the
      selection point and `tests/ps2-raw.test.js` types DE, US and Shift raw
      events. `layout!`/`layout@` are in `forth/start.fth`. FR/UK/ES remain
      data-only additions.
- [ ] **5. Optional persistence.** A settings cell in config flash, written
      only by an explicit save word, read by `start.fth`.
- [ ] **6. Free the block.** After board verification, either extend the
      sprite bank 24 -> 28 or record why the block stays free. Update
      `MEMMAP.md`, `HARDWARE.md` and the OpenWiki source.
- [x] **7. Cleanup.** Deleted `ps2map.hex`, dropped it from the asset stamp,
      and updated `HARDWARE.md`, `MEMMAP.md` and `COMPANION.md`. The board
      result still has to be recorded in `PS2PLAN.md`.

## 14. Acceptance criteria

1. `ps2_rx` has no character pROM and no synthetic AltGr/extended remap.
2. The pROM is gone. A later synthesis must show either one fewer BSRAM block
   or a documented reason why the inferred SDPB count stayed at 26.
3. Default DE typing, umlauts, AltGr, arrows/Home/End and Ctrl produce exactly
   the bytes the old pROM produced.
4. `layout! 1` changes y/z and punctuation on the console and in a game without
   rebuilding the bitstream.
5. The browser IDE and WASM ASCII hosts still type normally.
6. All console, game, PS/2, image and segmentation tests pass; board smoke
   tests pass with and without a keyboard.
7. No `ps2map.hex` is referenced by the bitstream build or the flash asset
   stamp.

## 15. Open decisions

1. **Default and persistence.** Keep DE as layout 0 and switch per session, or
   add the optional settings slice in the first cut?
2. **Menu layout.** The menu always uses layout 0 because it runs before the
   boot script. Accept that a US user sees DE menu letters (F/Q are unaffected),
   or persist the choice and move the selection earlier?
3. **Breadth.** Ship DE + US first, or author FR/UK/ES in the same change?
4. **Freed block.** Commit it to sprite groups 24–27 now, or hold it as
   headroom until a graphics change needs it?
5. **`key?` semantics.** Leave "FIFO ready" as the contract, or add a
   non-consuming "decodable key ready" check?
6. **UART bridge.** Remove the disabled mux entirely, or keep the dead netlist
   if removing it costs CLS?
7. **Left vs right Alt.** Both still set the same Alt/AltGr state, as today.
   Adding a separate right-Alt bit is a later event-format change and is not
   needed for DE/US.
