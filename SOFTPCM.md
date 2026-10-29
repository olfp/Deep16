# Software PCM on the 9K: I2S to a MAX98357A

Status: **design note, nothing implemented.** The question is whether the
D16nano can generate its own PCM — a wave function and an envelope in Forth or
machine code — through an I2S transmitter into a MAX98357A, with no companion
board and no sound hardware beyond the serialiser. The answer is yes for one to
three voices, marginally for four, and the binding constraints are the
**sample clock** and the **83 free CLS**, not the CPU.

Companions: `COMPANION.md` (the hardware sound chip on a second board),
`AUDIOPLAN.md` (the on-die sigma-delta design), `SLIMPLAN.md` (the area
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

## 7. Quality

At 26.37 kHz the Nyquist limit is 13.2 kHz, so a 1 kHz sawtooth's harmonics
above 13 kHz fold back. It sounds "8-bit gritty", which may be exactly right.

If it is not, a **global one-pole tilt** after the mix costs three instructions
per sample (~4 cycles, 1.5 %):

```
tmp = mix - prev
tmp = tmp >> k
prev = prev + tmp
```

Cheaper than band-limiting each voice, and it gets rid of the worst of the
fizz. Do not bother with PolyBLEP-style correction; at 26 kHz it is not worth
the 20+ instructions.

The envelope table from §2 should be **exponential, not linear**: the same
code, a different table. Linearity is the cheapest upgrade to a crash, where
the decay *is* the effect.

## 8. Versus the companion

| | 9K software PCM | Companion APU (`COMPANION.md`) |
|---|---|---|
| 9K CLS | 35–40 | ~1 (`cs_n[2]`) |
| 9K CPU | 11–34 % while sounding | 0 % |
| Voices | 1–4, envelopes, noise | 4 hardware voices + sweep |
| Sample rate | 16.2–52.7 kHz, none standard | 24 kHz (chosen) |
| Extra hardware | MAX98357A (~$5) + 3 wires | second board + 4 wires |
| Recorded audio | no (rate mismatch) | no (by design) |
| Fails without | nothing | keyboard *and* sound |

The companion buys CPU and hardware envelopes; this route buys the feature
without a board. For the 9K as the cheap machine, software PCM is the only
option that needs no second bitstream.

## 9. When to choose which

- **Choose software PCM** if sound is beeps, effects and a title tune, if the
  game can afford 15–25 %, and if the 9K must stay a single board. Recipe:
  26.367 kHz, 128-sample FIFO, polled mix, zero-order hold on underrun.
- **Choose the companion** if sound must be free (0 % CPU), if four independent
  hardware envelopes and sweeps are wanted, or if the 9K has no room at all.
- **Choose neither, use the 20K** if 42–48 kHz four-voice music is the goal:
  the 20K runs the core at 13.5 MHz, which halves every percentage in §2, and
  has 20,736 LUT4 for the serialiser and an APU.

## 10. Open questions

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
