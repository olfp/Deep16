# BIRDPLAN — visible flap + idle blink

Status: **plan only, nothing implemented.** This file records the agreed
design; the code, tests and docs are unchanged.

> **FiT hardware update (2026-10-30).** The bird is a sprite and uses the
> shared **sprite palette bank** at `0xF50A0`; body/belly/wing are entries
> `0xA2`/`0xAD`/`0xAE`, not `0x82`/`0x8D`/`0x8E`. The art bank is `0xF5090`;
> the text bank `0xF5080` must not be touched. The text pages are now 1bpp
> (ttyp0) and cannot collide with sprite index 14. The current game block ends
> at `0xDF6`; the `bird_group` +1 is expected at `0xDF7`, under the `0xDF8`
> test guard (the old `0xDF0` figure is stale).

The Flappy showcase already runs: three birds from the source art packs, a
per-bird weight, and one flap per S2/UART input. Two sprite problems remain:

1. the flapping wing is invisible, and
2. the bird never blinks when it is not flapping.

---

## 1. Why the wing disappears

The 40×30 source frames are resized to 32×30 and then quantised to the shared
16-entry RGB332 palette. The resize thins the wing but keeps it; **the palette
step is what erases it**, because the wing is a darker shade of the body and
there is only one slot for "body".

| bird | source body | source wing | wing lands on |
|---|---|---|---|
| Red | `rgb(210,47,35)` = `0xC4` | `rgb(156,35,26)` = `0x84` | index **2** — the body entry is literally `0x84`, so wing = body |
| Purple | `rgb(163,145,185)` = `0x92` | `rgb(136,120,156)` = `0x8E` | index **2**, because `birdPalette()` parks index 5 (where `0x8E` lives) on magenta to keep the dizzy flower out of the body |
| Yellow | `rgb(255,255,0)` = `0xFC` | `rgb(203,131,26)` = `0xD0` | index **13** (belly), so it reads as an orange belly patch, not a wing |

The wing pixels survive the resize (about 20% thinner); after quantisation
there is nothing left to see except a moving black outline. The bird's
palette is the **sprite bank** (`0xF50A0`); the body/belly/wing writes go to
`0xA2`/`0xAD`/`0xAE`. The art bank has its own copy of the background palette,
and the text bank is separate.

A second, independent flaw: the game currently alternates source frames 0 and
1, which differ mostly in the **eye**. Frames 1 and 3 are the clean pair — same
open eye, wing high vs wing low.

## 2. Fix: reserve palette index 14 for the wing (Option A)

Index 14 is used **only** by bird and dizzy pixels; no tile, cloud or font
pixel uses it (verified over `artTiles()`, `cloudSprite()`, `birdFrames()` and
`dizzyFrames()` for all three birds). In the FiT layout this is sprite-bank
index 14 at `0xF50AE`; the text pages are 1bpp and use the text bank, so they
cannot collide. Recolouring it per bird is free.

| bird | body (2) | belly (13) | wing (14) |
|---|---|---|---|
| Red | `0xC4` (was `0x84`) | `0xF1` unchanged | `0x84` |
| Purple | `0xAE` unchanged | `0xB6` unchanged | `0x6E` |
| Yellow | `0xFC` unchanged | `0xF4` unchanged | `0xD0` |

With these entries nearest-colour quantisation splits the wing automatically —
no per-pixel special-casing. Red's body brightens to the source's real red and
the old body value becomes the wing; Purple and Yellow get a wing two steps
darker than the body.

Change `ART_PALETTE[14]` from `0x28` (dark olive) to `0x84` so a bird whose
palette did not override it still looks sane. `set_palette` copies `pal_art`
into both the art and sprite banks, so the sprite bank starts at `0x84` too;
`reset_play` then writes the per-bird wing value at `0xAE`. The art bank entry
14 stays `0x84`. A few eye-shading pixels also use index 14 and will shift with
it; that is acceptable.

Success criterion: for every bird the body↔wing RGB distance is ≥ 60 and the
flap pair differs in ≥ 40 index-14 pixels.

## 3. Frame → group mapping

The four source frames are two wing poses × two eye states:

| source frame | wing | eye | becomes |
|---|---|---|---|
| 0 | folded | closed | **blink closed** — relative group 0 |
| 2 | folded | open | **idle open** — relative group 1 |
| 1 | extended high | open | **flap A** — relative group 6 |
| 3 | extended low | open | **flap B** — relative group 7 |

`make_bird_sprite.mjs` writes groups 0/1 from frames 0/2 and 6/7 from frames
1/3, on all three pages. `BIRD_GROUPS` stays `[6,7]`; add
`BLINK_GROUPS = [0,1]`. Groups 3/4/5 stay the dizzy ping-pong and group 2 the
cloud, so all eight relative groups per page are now used.

## 4. Runtime behaviour

- **Flapping** (`G_FLAP_TIMER != 0`, the same six physics frames): groups 6/7,
  alternating on `G_BIRD_ANIM` bit 3, eye open — as today but with the correct
  frame pair.
- **Gliding** (`G_FLAP_TIMER == 0`): group 1 (open) normally, group 0 (closed)
  while `(G_BIRD_ANIM & 0x7F) < 8` — a ~130 ms blink about every 2.1 s at the
  current frame rate.
- **Death** is unchanged: dizzy groups 3/4/5, then group 5 vflipped while
  falling.

`G_BIRD_ANIM` already increments once per `set_bird` and drives the dizzy
cycle, so it is the natural clock for the blink too.

### Code shape

Add a `bird_group` helper in the free gap at `0x4A0` (~22 words; 55 words free
before `G_START_MODE` at `0x4D5`). It reads `G_FLAP_TIMER` and `G_BIRD_ANIM`
and returns the relative group in `R4`.

`set_bird` saves LR in `R10` on entry (`MOV R10, LR`), calls the helper, and
restores it before `JMP LR`. The `sb_alive` block collapses to a call, so the
net change to the game block is about **+1 word**. The current game block ends
at **`0xDF6`** after the menu `draw_text` fix; the expected end is **`0xDF7`**,
under the current `0xDF8` test guard and the `0xE00` stack. The old `0xDF0`
figure is stale; measure after the change.

## 5. Data tables in `showcase.asm`

- `pal_art[14]` (at `0x3D0 + 14`) becomes `0x0084`.
- `bird_colors` at `0x5CB` stays 6 words: `(body, belly)` per bird, with Red's
  body updated to `0x00C4`.
- New 3-word `wing_colors` table at `0x5D5` (free: `dizzy_groups` ends at
  `0x5D4`, `pal_default` starts at `0x5E0`): `0x0084`, `0x006E`, `0x00D0`.
- `reset_play` keeps its 2-word stride load over `bird_colors` and additionally
  writes **sprite-bank entry `0xAE`** (index 14) from `wing_colors`. It must
  not write `0x8E`: that is the text bank now.

## 6. Tests

`tests/showcase-art.test.js`:

- groups 0/1 and 6/7 are non-empty and identical across the three pages;
- blink pair 0/1 differs in the eye only (no index-14 change);
- flap pair 6/7 differs only in the wing, ≥ 40 index-14 pixels;
- body↔wing palette distance ≥ 60 for each bird;
- index 14 appears in no background tile or cloud;
- `pal_art[14]`, `bird_colors` and `wing_colors` agree with `BIRD_COLOURS`;
- **remove** the "page 0 groups 0..1 stay free" assertion — 0/1 are now the
  blink pair.

`tests/showcase-death.test.js`:

- update `BIRD_COLOURS` to the new body/wing values and assert sprite palette
  entry 14 (`0xF50AE`) on reset;
- with no input the OAM group stays in `{0,1}` and both values appear over
  ~200 frames;
- after a flap the group becomes `{6,7}`.

The current `showcase-death` constants are `PAL_BODY = 0xF50A2`,
`PAL_BELLY = 0xF50AD`; add `PAL_WING = 0xF50AE`. The `showcase block` guard is
`showcase.max < 0x0DF8`.

`tests/showcase-weights.test.js` should not change (physics untouched).

## 7. Docs

`doc/FiT-Graphics-howto.md` needs its palette section updated: the bird uses
the **sprite bank** (`0xF50A0`), indices 2/13/14 are body/belly/wing, the game
writes all three per bird, and the blink/flap group roles are 0/1 and 6/7. The
art bank (`0xF5090`) and text bank (`0xF5080`) are separate.

## 8. Build and flash

`birdsprite.hex` is baked into the sprite bank at synthesis
(`$readmemh("birdsprite.hex", sprite)` in `rtl/dvi/dvi_tile.sv`), and
`make_image.mjs` regenerates it. A CPU-image-only rebuild is **not** enough:

```
npm test
npm run synth:tile
npm run flash:tile
```

then power-cycle the board. If BP is `0x38`, run `cf-unprotect` on the board
first; run `cf-protect` again after the power-cycle.

## 9. Files touched by the implementation

| file | change |
|---|---|
| `scripts/make_art.mjs` | `ART_PALETTE[14]`, `BIRD_COLOURS[*].wing`, `pal[14] = wing` in `birdPalette()` |
| `scripts/make_bird_sprite.mjs` | groups 0/1 ← frames 0/2, groups 6/7 ← frames 1/3; export `BLINK_GROUPS` |
| `asm/showcase/showcase.asm` | `pal_art[14] = 0x84`, Red body `0xC4`, new `wing_colors` at `0x5D5` |
| `asm/showcase/flappy_game.asm` | `reset_play` writes sprite entry `0xAE`; `sb_alive` calls `bird_group`; new helper at `0x4A0` |
| `tests/showcase-art.test.js` | new palette/group assertions, drop the free-group check; sprite-bank entry 14 |
| `tests/showcase-death.test.js` | new palette values, `PAL_WING = 0xF50AE`, blink/flap group runtime checks |
| `doc/FiT-Graphics-howto.md` | body/belly/wing and blink/flap roles |

No RTL change: the sprite format, OAM fields, page select and `$readmemh` are
all unchanged.

## 10. Open question

Blink cadence. The plan above uses **8 closed frames out of every 128**
(~130 ms blink every 2.1 s). The alternative is a literal **50/50 alternation
every 32 frames** — one line shorter in `bird_group`, but a permanent slow
wink rather than a blink. This is the only unresolved choice; it changes one
mask in the helper and the runtime test bounds.
