# Flappy sound effects

User-provided Flappy sound effects, copied here for a future sample player. The
build does **not** convert or use these files yet; the game currently uses the
BIOS 128-sample effects (the flap is a decaying noise burst).

| File | Format | Trimmed length |
|---|---|---|
| `sfx_wing.wav` | 44.1 kHz, 16-bit mono | ~0.30 s |
| `sfx_point.wav` | 44.1 kHz, 16-bit stereo | ~0.81 s |
| `sfx_hit.wav` | 44.1 kHz, 16-bit stereo | ~0.43 s |
| `sfx_die.wav` | 44.1 kHz, 16-bit stereo | ~0.76 s |
| `sfx_swooshing.wav` | 44.1 kHz, 16-bit stereo | ~2.01 s |

`sfx_swooshing.wav` is now decoded by `scripts/make_samples.mjs`, mixed to
mono, resampled to 11.10 kHz and shipped as the six-slice `swoosh` μ-law demo
in the `0xE000` sound window. The other files can follow the same path later.
Confirm the source/licence before shipping more of the audio.
