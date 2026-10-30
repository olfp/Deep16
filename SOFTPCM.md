# Software PCM on the 9K: I2S to a MAX98357A

Status: **design note.** The I2S transmitter with its FIFO and MMIO is built
(`rtl/deep16_i2s.sv`, `ADVARCH.md` §4); the Forth-side wave function and
envelope player are not. The question is whether the
D16nano can generate its own PCM — a wave function and an envelope in Forth or
machine code — through an I2S transmitter into a MAX98357A, with no companion
board and no sound hardware beyond the serialiser. The answer is yes for one to
three voices, marginally for four, and the binding constraints are the
**sample clock** and the **83 free CLS**, not the CPU.

Companions: `COMPANION.md` (the hardware sound chip on a second board),
`archive/AUDIOPLAN.md` (the on-die sigma-delta design), `SLIMPLAN.md` (the area
budget), `doc/Deep16-Arch.md` (instruction set and CPI).

## 1. The machine you would be spending

| | Value | Source |
|---|---|---|
| CPU clock, `D16NANO` build | **6.75 MHz** (27 MHz / 4) | `rtl/deep16_board.sv:68` |
| Cycle | 148 ns | |
| Base CPI | 1.0–1.3 | `doc/Deep16-Arch.md:30` |
| General registers | R0–R12 (R13 = SP, R14 = LR) | |
| Multiply | `MUL` 16×16, one DSP, one cycle | `doc/Deep16-Arch.md:445` |
| Indexed load | `LD Rd, Rb, offset`, signed 5-bit | `doc/Deep16-Arch.md:464` |
| Variable shift | by register, 0–15 | `rtl/deep16_alu.sv:56-77` |

That set is unusually well suited to a sample loop: the indexed load makes a
wavetable or envelope lookup a single instruction, and the multiplier is not
emulated.

## 2. Cost per voice per sample

A sawtooth voice with a table-driven envelope:

```
ADD  phase, inc        ; advance the phase
SR   tmp, phase, 8     ; top 8 bits = waveform
ADD  ptr, step         ; walk the envelope table, 8.8 fixed point
SR   idx, ptr, 8       ; integer part of the pointer
ADD  idx, tblbase      ; table address (entry-sized)
LD   env, idx, 0       ; cache-resident
MUL  tmp, env          ; 8 × 8
SR   tmp, tmp, 8
MUL  tmp, vol
SR   tmp, tmp, 8
ADD  mix, tmp          ; accumulate
```

Eleven instructions, **~20 cycles per voice per sample** at CPI 1.5 (the two
loads carry latency), plus ~8 cycles per sample for the FIFO check, the DAC
store and the loop branch.

The table earns its four instructions two ways. A linear envelope needs a
clamp, and this ISA puts a **delay slot** after a branch, so the clamp costs
about as much and still sounds like a ramp. With the table, the decay *rate* is
the `step` and the shape is the table — one register write changes a 40 ms
click into a 600 ms crash.

| fs from 6.75 MHz | cycles/sample | 1 voice | 2 | 3 | 4 |
|---|---|---|---|---|---|
| **42.19 kHz** (BCLK /5) | 160 | 18 % | 30 % | 43 % | 55 % |
| **26.37 kHz** (BCLK /8) | 256 | 11 % | 19 % | 27 % | 34 % |
| **21.09 kHz** (BCLK /10) | 320 | 9 % | 15 % | 21 % | 28 % |
| **16.23 kHz** (BCLK /13) | 416 | 7 % | 12 % | 16 % | 21 % |

So **~8 % of the machine per voice at 26 kHz**, and the cost scales with the
voices that are *open*: a game that only starts a voice on a collision pays
nothing the rest of the time. A two-voice effects mix is ~19 %; a four-voice
music screen is ~34 %.

The loop is ~120 bytes of code and ~40 bytes of state, so it stays
cache-resident (256 lines of 8 words) and CPI stays near 1.5. Fetch is not the
problem.

## 3. The sample clock is the real constraint

`BCLK = 6.75 MHz / N`, and I2S needs `BCLK = 32 × fs` for 16-bit stereo slots.
48 kHz wants 1.536 MHz, which is `N = 4.39`: **there is no integer divider that
gives 44.1 or 48 kHz.**

| N | BCLK | fs (16-bit slots) | Use |
|---|---|---|---|
| 4 | 1.688 MHz | 52.73 kHz | too expensive (50 %+ CPU) |
| 5 | 1.350 MHz | **42.1875 kHz** | best quality, ~50 % CPU at 4 voices |
| 8 | 0.844 MHz | **26.367 kHz** | the sane default |
| 10 | 0.675 MHz | **21.094 kHz** | matches a game's CPU budget |
| 13 | 0.519 MHz | **16.227 kHz** | cheapest |

32-bit slots double the frame (64 × fs), so N = 4 also gives 26.37 kHz — same
result, more shift register.

None of these is a defect **as long as the synth computes its pitch increments
from the actual fs**:

```
inc = f_note * 65536 / fs
```

What it does rule out is playing pre-rendered 48 kHz material at the right
pitch: that would come out 2.6 semitones flat at 26.37 kHz and 1.6 sharp at
42.19 kHz. Recorded audio needs either the companion or a re-tuned sample set.

There is a 48.34 kHz option from the DVI PLL (24.75 MHz / 16 / 32), but it is a
different clock domain, so the sample path would need an asynchronous FIFO for
a 0.7 % rate accuracy. Not worth it.

## 4. Interrupts, polling and underruns

A per-sample mix wants ~20 words of state. An interrupt handler gets **four**
registers in the shadow bank (R0′–R3′) and must preserve R4–R12, so an
ISR-paced mix pays a save/restore per sample — 18 memory operations plus vector
and RTI, roughly **+45–60 cycles per sample**, i.e. another 18–23 % at
26 kHz. A four-voice mix in an ISR is ~55 %, not 34 %.

| Shape | Cost | Use |
|---|---|---|
| Blocking player | §2 cost, no overhead | a title tune or `PLAY` |
| **Polled mix in the main loop** | +5 cycles per poll | in-game effects (recommended) |
| ISR-paced | +45–60 cycles per sample | only with register-light state |

Polling has a cadence problem, and the FIFO depth is what buys tolerance. One
sample is 37.9 µs at 26.37 kHz:

| FIFO | Backs | Refill interval | Burst cost | Blocking |
|---|---|---|---|---|
| 8 × 16 | 303 µs | 150 µs | 4 samples, 320 cycles | none |
| 32 × 16 | 1.2 ms | 600 µs | 16 samples, 1,280 cycles | 0.19 ms |
| **128 × 16** | 4.9 ms | 2.4 ms | 64 samples, 5,120 cycles | 0.76 ms per 2.4 ms |
| 1,024 (BSRAM) | 39 ms | one frame | 440 samples, 35,000 cycles | 5.2 ms per 16.7 ms |

128 × 16 costs 2,048 FFs and essentially no LUT (3,495 FFs are free), and it
absorbs the worst stall the machine can produce: a `DIV` emulation or FPU trap
is 300–700 cycles = 44–104 µs, well inside 4.9 ms.

**Make the serialiser hold the last sample on underrun** (zero-order hold, not
silence). A missed deadline then becomes a marginally longer sample, which is
inaudible, instead of a click — and that removes the hard real-time
requirement entirely.

## 5. Area: the fit is tighter than the CPU

An I2S transmitter is small: bit divider, frame counter, 16-bit load/shift,
LRCLK/BCLK, FIFO, MMIO port. **~60–70 LUT4 ≈ 35–40 CLS**, two pins.

| | CLS |
|---|---|
| I2S + FIFO + write port | 35–40 |
| timer IRQ + 15 kHz tick | 20–32 |
| 2-source SIC | 8–12 |
| **total** | **63–84 of 83 free** |

It fits only if every item lands at the low end, and the **raster IRQ (10–20)
does not fit on top**. The margin would have to come from the shifter merge
(~20–40, `SLIMPLAN.md` §3) or sprites 8→4 (30–55).

If the sound is polled rather than interrupt-driven, **no timer IRQ and no
tick counter are needed for audio at all** — the serialiser's own divider is
the sample clock. The 20–32 CLS for a tick drops out, so the cheapest
configuration is **35–40 CLS for the whole feature**, which is also the only
one that leaves room for a raster IRQ later.

## 6. MAX98357A wiring

| Pin | Connection |
|---|---|
| VDD | **3.3 V**, not 5 V (see below) |
| GND | common |
| BCLK, LRCLK, DIN | three FPGA pins, 3.3 V LVCMOS |
| GAIN | strap: 3 / 6 / 9 / 12 / 15 dB |
| SD | strap: left / right / (L+R)/2, or pull low to mute |
| OUT+, OUT− | 4–8 Ω speaker, no coupling capacitor needed |

- **Power it from 3.3 V.** The digital-input thresholds scale with VDD (around
  0.7 × VDD on this family), so at 5 V a 3.3 V logic high is marginal — check
  the datasheet table for the exact part. At 3.3 V it still delivers ~1.4 W
  into 4 Ω (3.2 W at 5 V scales as V²), which is loud.
- **No MCLK, no I2C.** It recovers the clock from BCLK, which is why it copes
  with 26.367 kHz and 42.1875 kHz.
- **Do not gate BCLK for power saving.** The part mutes and needs a restart
  sequence when the clock stops.
- Mono costs nothing extra: put the same sample in both slots, or use the `SD`
  strap to take one channel.

## 7. PCM streaming: size, rate matching and placement

Streaming a waveform instead of computing it changes the currency of the
problem: **memory becomes the cost and the CPU nearly disappears**.

### 7.1 Size

Bytes = rate × seconds × (bits / 8). The machine is word-addressed, so 8-bit
samples pack two per 16-bit word (4-bit packs four).

| Effect | Duration | 8 kHz 8-bit | 11 kHz 8-bit | 8 kHz 4-bit ADPCM |
|---|---|---|---|---|
| blip / beep | 60 ms | **480 B** | 660 B | 240 B |
| coin / pickup | 200 ms | 1.6 kB | 2.2 kB | 800 B |
| laser | 250 ms | 2.0 kB | 2.8 kB | 1.0 kB |
| hit / collision | 120 ms | 960 B | 1.3 kB | 480 B |
| crash | 600 ms | **4.8 kB** | 6.6 kB | 2.4 kB |
| explosion | 900 ms | 7.2 kB | 9.9 kB | 3.6 kB |

A realistic set — blip, coin, laser, hit, jump, powerup, crash, explosion — is
**~20 kB at 8 kHz / 8-bit** (10,000 words), ~27 kB at 11 kHz, ~10 kB with
ADPCM. Against the machine's pools:

| Pool | Size | A 20 kB library is |
|---|---|---|
| dictionary `free` (runtime) | 32,578 words ≈ 65 kB | 31 % |
| PSRAM | 1 M words ≈ 2 MB | 1 % |
| SD card (16-bit sectors) | 32 MB reachable | 0.06 % |
| on-die image flash | 608 Kbit ≈ 76 kB | would not fit with the kernel |

### 7.2 Quality per byte

- **8 kHz / 8-bit linear** is telephone-grade: fine for anything with a
  transient, hiss on long decays.
- **8-bit µ-law** is the best value: same bytes, roughly 12-bit perceived,
  decoding is a 256-byte table lookup (2 instructions per sample).
- **4-bit IMA ADPCM** halves it again. Excellent for crashes and explosions,
  where noise masks the error; poor for beeps, where it is a tunable buzz.
  The decoder is 6–8 instructions per sample.
- **6 kHz** only for thumps and noise; tonal effects get dull.
- **Above 11 kHz is wasted for effects** — the amp and speaker give up first.

Rule of thumb: **tonal → 8-bit at 11 kHz; noise → 4-bit at 8 kHz.**

### 7.3 Why streaming is cheaper than synthesis

| Per output sample | Cycles |
|---|---|
| cache miss amortised (12 cycles per 2-word line = 4 samples) | ~3 |
| unpack a byte (shift + and) | 2 |
| store to the I2S FIFO | 1 |
| **total** | **~6** |

At 11.1 kHz that is **~1 % of the machine per voice**, against ~20
cycles/sample for synthesis at the same rate (~3.3 %), and ~8 % per voice at
26 kHz. Four streaming voices cost less than one synthesised voice at full
rate, and they sound better. Bandwidth is not a factor either: 11 kB/s against
a PSRAM path that delivers far more.

### 7.4 Rate matching

Playback is a pure copy **only if the stored rate divides the I2S rate**.
Choose from `6.75 MHz / (32 N)`:

| N | fs | Bytes/s at 8-bit | Use |
|---|---|---|---|
| 26 | 8.11 kHz | 8.1 k | effects, cheapest |
| 19 | 11.10 kHz | 11.1 k | effects, cleaner |
| 10 | 21.09 kHz | 21.1 k | music and effects |
| 8 | 26.37 kHz | 26.4 k | music |

Make the divider part of the play call, so a buffer header carries its own
rate: `{rate_div, length, loop_point, flags}`. Effects then play at 8.11 or
11.10 kHz and music at 26.37 kHz, with the MAX98357A relocking each time.
Resampling 8 kHz up to 26.37 kHz with linear interpolation costs ~15–18
cycles/sample — as expensive as synthesis — and pre-expanding costs 3.3x the
storage. Matching avoids both.

### 7.5 Where the bytes live

- **Playback source: PSRAM**, addressed with plain `LD`, cacheable, ~1 % CPU.
- **Flash is storage, not a source.** `flash@ ( word -- lo hi )` is a polled
  MMIO round trip — address, go, wait for busy, two reads — plus the call:
  ~40–70 cycles per 16-bit word, i.e. two samples. Copying a 4.8 kB crash out
  of flash costs ~130k cycles (20 ms) once: fine at load time, a stutter at
  play time.
- **SD is storage too**: 512-byte sectors, ~1.2 ms per sector, and one sector
  is 46 ms of 8 kHz audio. Right for a library loaded on demand, wrong for
  per-sample access.

So: library on the card or in flash → loaded into PSRAM at boot or on demand →
streamed from there. At 20–30 kB the whole set fits the free dictionary, so
the simple version is "load everything at boot".

**A dedicated sound segment.** The 65 kB dictionary is not the right place for
a sample library, and it does not have to be. A 16-bit segment value plus a
16-bit offset gives a 64K-word (128 kB) window — `phys = (seg << 4) + offset`
(`doc/Deep16-Arch.md:70`), and `MVS DS, Rx` sets a segment register in one
instruction (`asm/forth_nano.asm:113`). So:

- one window holds **64K words = 128 kB = 16.4 s of 8 kHz 8-bit audio**, or
  about thirty crash-length effects;
- the whole range above the dictionary (`0x10000..0xFFFFF`) is free, which is
  15 windows = 1.9 MB = **four minutes** of the same audio, without touching
  data-segment space at all;
- **loader:** `MVS ES, Rx` points ES at the window, and the existing `es!`
  primitive writes it (ES is the I/O segment, `asm/forth_nano.asm:2687`),
  while DS stays the dictionary;
- **player:** `MVS DS, Rx` points DS at the window and plain `LD` streams it,
  while ES stays the I/O segment for the DAC port — both registers useful at
  once, one `MVS` per phase, no extra segment register, no new encoding, no
  LUTs.

Two constraints: a Forth word called from inside the player while DS is
repointed would read the wrong data, so the player must be self-contained
(state in registers, no dictionary access); and calls and stacks still work,
because they use SS, not DS.

One cache note: the PSRAM cache is 512 lines × 2 words = **2 kB**, so a 4.8 kB
crash streams straight through. No reuse means no waste, but each play evicts
the interpreter's lines — about 256 extra misses, ~3,000 cycles, a third of a
millisecond. Irrelevant.

### 7.6 What you lose versus synthesis

- **No pitch variation** without resampling. `SFX n` replays at the recorded
  pitch; a rising laser needs three variants or the interpolator.
- **Volume** is one multiply per sample (~3 cycles), so distance-attenuated
  effects are nearly free.
- **Loop points** need one word in the header, not a feature.
- **Fixed content**: 20 kB buys eight sounds, not eight sounds plus a music
  engine. Music still wants the synthesiser at 26 kHz; the two coexist because
  the divider is per-stream.

### 7.7 A starting budget

| | Words | Bytes |
|---|---|---|
| 8 effects, 8 kHz 8-bit, 40–900 ms | ~8,000 | 16 kB |
| voice/prop buffer (128 samples, double-buffered) | 128 | 256 B |
| Forth player + headers | ~200 | 400 B |
| **total** | **~8,300** | **~17 kB** |

That leaves ~24,000 words of dictionary free — or nothing at all, if the set
lives in its own segment — and the CPU cost is under 1 % per voice at
11.1 kHz.

## 8. Quality

At 26.37 kHz the Nyquist limit is 13.2 kHz, so a 1 kHz sawtooth's harmonics
above 13 kHz fold back. It sounds "8-bit gritty", which may be exactly right.

If it is not, a **global one-pole tilt** after the mix costs three instructions
per sample (~4 cycles, 1.5 %):

```
tmp = mix — prev
tmp = tmp >> k
prev = prev + tmp
```

Cheaper than band-limiting each voice, and it gets rid of the worst of the
fizz. Do not bother with PolyBLEP-style correction; at 26 kHz it is not worth
the 20+ instructions.

The envelope table from §2 should be **exponential, not linear**: the same
code, a different table. Linearity is the cheapest upgrade to a crash, where
the decay *is* the effect.

## 9. Versus the companion

| | 9K software PCM | Companion APU (`COMPANION.md`) |
|---|---|---|
| 9K CLS | 35–40 | ~1 (`cs_n[2]`) |
| 9K CPU | 1–4 % streamed, 11–34 % synthesised | 0 % |
| Voices | 1–4, envelopes, noise | 4 hardware voices + sweep |
| Sample rate | 16.2–52.7 kHz, none standard | 24 kHz (chosen) |
| Extra hardware | MAX98357A (~$5) + 3 wires | second board + 4 wires |
| Recorded audio | no (rate mismatch) | no (by design) |
| Fails without | nothing | keyboard *and* sound |

The companion buys CPU and hardware envelopes; this route buys the feature
without a board. For the 9K as the cheap machine, software PCM is the only
option that needs no second bitstream.

## 10. When to choose which

- **Choose software PCM** if sound is beeps, effects and a title tune, if the
  game can afford 15–25 %, and if the 9K must stay a single board. Recipe:
  26.367 kHz, 128-sample FIFO, polled mix, zero-order hold on underrun.
  Stream recorded effects (§7) and synthesise the music: streaming costs ~1 %
  per voice, synthesis ~8 %.
- **Choose the companion** if sound must be free (0 % CPU), if four independent
  hardware envelopes and sweeps are wanted, or if the 9K has no room at all.
- **Choose neither, use the 20K** if 42–48 kHz four-voice music is the goal:
  the 20K runs the core at 13.5 MHz, which halves every percentage in §2, and
  has 20,736 LUT4 for the serialiser and an APU.

## 11. Open questions

1. **Is 26.37 kHz acceptable** as the machine's only rate? If recorded audio is
   ever wanted, this decision is permanent.
2. **Polled or interrupt-paced?** Polling is cheaper and needs no shadow-bank
   change; an ISR is more robust but ~20 % more expensive and would benefit
   from a persistent shadow bank (`doc/Interrupts.md`).
3. **How many voices must a *game* have at once?** Two (one tone, one noise) is
   ~19 %; three is ~27 %; four is only for music.
4. **128-sample FIFO in FFs, or 1,024 in a BSRAM block?** FFs cost no CLS and
   buy 4.9 ms; BSRAM buys 39 ms at the cost of one of the three free blocks.
5. **Does the tilt filter go in software (4 cycles/sample) or hardware
   (~10 LUT4)?**
6. **How steep should the envelope table be?** Exponential content, linear
   space; the code is the same either way.
7. **Should the I2S block land before the timer/raster IRQ**, given that it
   consumes 35–40 of the 83 free CLS and the interrupts want 30–44?
8. **What is the third wire budget on the header?** BCLK, LRCLK, DIN are three
   pins; check against `rtl/deep16_board.cst` and the free J6 list.
9. **Which window becomes the sound segment**, and does the player repoint DS
   while the loader repoints ES (§7.5)? One `MVS` per phase and no new
   register, but it needs a rule so nothing else assumes DS is the dictionary
   during playback.
