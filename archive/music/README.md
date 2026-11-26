# Music experiment — offline ABC synthesizer (archived 2026-11-26)

Archived on request. The offline synthesizer works, but it is not the live
synth path we want for background music, so it is no longer part of the slice
set or the test suite.

## What is here

| File | Purpose |
|---|---|
| `make_music.mjs` | ABC subset parser → square/ADSR melody + triangle chord bass → G.711 µ-law; `--wav` writes a 16-bit mono audition file |
| `music.test.js` | Parser/render/µ-law tests; not run by `npm test` (it lives outside `tests/`) |
| `flappy-loop.wav` | The four-bar 7.27 s loop it rendered |

Run it:

```sh
node archive/music/make_music.mjs --wav /tmp/flappy-loop.wav
```

## Why archived

The I2S path is fixed at 21.09375 kHz mono 16-bit and the existing µ-law player
duplicates each sample, so it plays at ~10.55 kHz with about 4 % CPU. An
**on-chip** synth is the alternative, but the current bitstream is at
**26/26 BSRAM, 8,369/8,640 logic and 4,239/4,320 CLS**; a two-voice DDS plus
envelope, mixer and FIFO arbitration does not fit without taking resources from
something else. A software synth in the FIFO ISR has 320 cycles per sample at
21 kHz, which is too tight while Flappy runs.

The offline route itself is sound: 11.1 kB/s of µ-law, and the 0xE000 sound
window holds about **11.8 s** (64K cells), enough for a short loop. Reviving it
needs two changes:

1. re-add the `music` ULAW object to `scripts/make_slices.mjs` (the code is in
   the git history of 2026-11-26), and
2. start/stop the player from Flappy, either through a small BIOS entry called
   with `SWI` or from the menu launcher in the kernel.

The µ-law player (`screens/flash/audio.fth`) already supports looping and the
FIFO-low IRQ, so no RTL change was needed for the prototype.
