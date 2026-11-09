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
| `sfx_swooshing.wav` | 44.1 kHz, 16-bit stereo | ~0.60 s |

A future `flappysnd` pack can mix these to mono, trim the silence, resample to
the D16's 21.09375 kHz and load the result into the `0xE000` sound segment.
Confirm the source/licence before shipping the audio.
