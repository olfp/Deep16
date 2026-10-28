# Sound output for the D16nano

Status: **design note, nothing implemented.** The D16nano has no audio of any
kind — no pin, no register, no signal path. This note fixes the architecture,
the register map, the analogue parts, and the two ways to pace it (a hardware
FIFO, or a timer interrupt), so the choice can be made before any RTL.

Companions: `SLIMPLAN.md` (where the area comes from), `HARDWARE.md` (current
fit and the MMIO decode pattern), `doc/Interrupts.md` (the interrupt model the
timer IRQ would use).

## 1. What is free

| Build | CLS free | BSRAM free | Verdict |
|---|---|---|---|
| D16MINI 1.1 (text/UART) | 109 | ~1 | no: below the floor for any audio |
| nano tile, packed console | 672 | **0** | tone-only fits; no room for a sample buffer |
| **nano tile, user-flash + sprites** | **78** | **3** | the target, and it is the last 1.8 % of the device |

I/O is 26 / 71, so pin count is not the constraint — the header is. See
`SLIMPLAN.md` §2 for what a diet can add.

## 2. The modulator is the cheap part

A first-order 1-bit sigma-delta is a 16-bit accumulator with feedback:

```
acc  <= acc + sample - (out ? 65535 : 0)
out  <= acc[15]
```

| Block | CLS |
|---|---|
| 16-bit accumulator + comparator + feedback | 18–24 |
| sample-rate divider (or the timer tick, §6) | 8–12 |
| volume shift, mute | 4–8 |
| register decode (5 regs) | 6–10 |
| **subtotal, no buffering** | **36–52** |

Oversampling at the 6.75 MHz CPU clock:

| fs | OSR | in-band SNR (1st order, practical) |
|---|---|---|
| 8 kHz | 844 | 60–70 dB |
| 10 kHz | 675 | ~60 dB |
| 15 kHz | 450 | ~55 dB |

That is well past what a small class-D speaker and a two-pole RC will
resolve. A second-order modulator would add ~25 CLS; not worth it here.

Useful coincidence: the millisecond timebase is **6,750 cycles** at 6.75 MHz
(`rtl/deep16_timer.sv`, `DIV = (CLK_HZ+500)/1000`), and

```
6750 = 450 × 15 = 675 × 10 = 375 × 18 = 270 × 25
```

so **15, 10, 18 and 25 kHz all divide the millisecond period exactly**: a
free-running counter modulo 450 (15 kHz), 675 (10 kHz), 375 (18 kHz) or 270
(25 kHz) stays in lock with the wall clock, and every 15 ticks is exactly 1 ms.
It costs a counter plus a comparator, **~8–12 CLS**.

The existing prescaler cannot simply be tapped: it counts 0..6749 and produces
one pulse per millisecond, not one per 450 cycles.

## 3. Register map

`0xF0090`, immediately after the SPI block at `0x80–0x8F`. It must join the
`timer_hit` / `spi_hit` decode in `rtl/deep16_top.sv:164-205`: those addresses
are inside the Forth dictionary ceiling, so a store must be **claimed by the
peripheral and acknowledged immediately**, never forwarded to the PSRAM bridge.

| Addr | Name | Function |
|---|---|---|
| `0x90` | CTRL | b0 enable, b1 loop, b2 FIFO reset, b3 mute |
| `0x92` | RATE | divider, fs = 6.75 MHz / (RATE+1); 449 = 15 kHz |
| `0x94` | DATA | write pushes a signed 16-bit sample; read returns free space |
| `0x96` | LEVEL | samples queued |
| `0x98` | VOLUME | 0–15 right shift |

All waveform logic stays in software: `BEEP` fills the buffer with a
square/sine once, `PLAY` streams samples, noise is an LFSR in Forth. The
hardware stays generic — the right split when the budget is 78 CLS.

## 4. Pacing: the real constraint

There is **no timer interrupt** on the D16nano (`HARDWARE.md`: the enable bit
is stored "for a later SIC but no interrupt is wired into the CPU yet"). So
audio cannot be interrupt-paced *today*. Feeding one sample every 66–125 µs
(10–15 kHz) from a main loop means any frame longer than that clicks — exactly
when a game is busy.

Hence a small BSRAM FIFO:

| Addition | CLS | BSRAM |
|---|---|---|
| 512×16 dual-port sample FIFO, read pointer, level, wrap | 12–18 | 1 |

512 words is 64 ms at 8 kHz, 32 ms at 16 kHz. At 60 fps the main loop refills
twice a frame with 4× margin, and the hardware pops the samples for free.
**Total: 52–68 CLS, 1 BSRAM, 1 pin.**

This is the configuration to build if *sound* is the goal: no ISA change, no
simulator work, testable in Verilator today.

## 5. Pin and analogue

One 3.3 V pin on J6. Pin 25 is already the second SPI CS and 76/77 are PS/2
(`rtl/deep16_board.cst`); pick another and confirm against the Sipeed 9K
pinout before writing the `.cst` — that file's own header warns that every pin
is documented rather than measured.

```
pin ──1k──┬──1k──┬──┬── 100R ── 3.5 mm tip
          │      │  │
         10n    10n 10µ (AC coupling)
          │      │
         GND    GND ──────────────── sleeve
```

- **Two RC sections.** A single pole cannot suppress a 6.75 MHz one-bit
  stream; 12 dB/oct is the minimum that sounds clean.
- **AC-couple.** Silence is a 50 % duty stream, so the filtered node sits at
  VDD/2 ≈ 1.65 V. A 10 µF cap into the jack removes the DC thump.
- **Speaker instead of headphones:** feed the filtered node into a PAM8302A
  (mono class-D, 2.5 W at 5 V and much less at 3.3 V). The FPGA pin cannot
  drive a speaker.

BOM: 3 resistors, 3 capacitors, one jack (or one amp module).

## 6. With a timer interrupt first

A timer IRQ changes *which* sound is cheap, but not the area bill
(`SLIMPLAN.md` §2: 12–20 CLS for the IRQ input in the core, 8–12 for the tick
counter, 8–12 for a two-source SIC).

### 6.1 What the ISR costs

Entry zeroes the shadow bank, so a ring pointer cannot live in a register. Per
tick:

```
LDI ptr_cell ; LDS ptr ; LDS sample ; (write DATA) ; ADD ; wrap ; STS ptr ; clear match ; RETI
```

~14 instructions, two PSRAM reads and one PSRAM write at the 12-cycle
non-bursting rate (the DAC store is MMIO and immediate) ≈ **50–75 cycles per
tick**:

| fs | ISR alone | share of 6.75 MHz |
|---|---|---|
| 10 kHz | ~60 | ~9 % |
| 15 kHz | ~60 | ~13 % |

and that is before the sample is *generated*.

### 6.2 The two cases

| | No IRQ + FIFO | IRQ, no FIFO |
|---|---|---|
| Modulator + regs | 30–40 | 30–40 |
| Tick source | counter (~10) | counter (~10) |
| Buffer | 12–18 + **1 BSRAM**, 64 ms | — |
| IRQ in core + SIC | — | 20–32 |
| CPU per tick | **0** | 50–75 cycles (9–13 %) |
| Buffer depth | 64 ms, cache-clean | PSRAM ring, deep but cache-thrashing |
| **total** | **52–68 CLS, 1 block** | **60–82 CLS, 0 blocks** |

So the IRQ route trades one BSRAM block for about 10 CLS **and** 9–13 % of the
CPU.

- **Sampled playback gets worse.** It still needs a buffer, now in PSRAM at
  12+ cycles per read. A 400 ms ring at 10 kHz is 4,000 words — twice the
  2,048-word (256-line) cache — so it cannot stay resident, and every ISR read
  is a miss that evicts a line the interpreter wants.
- **Synthesised tones get very cheap.** A phase accumulator, a square/noise
  compare and the write are **15–25 cycles** (2–4 % at 10 kHz) with no pointer,
  no buffer and no tone generator in hardware. This is the only configuration
  where "music while the game runs" is affordable.

### 6.3 Interaction rules

- **Non-nested.** Entry sets `I=0`; handlers must not re-enable it. Nested
  entry would zero the shadow bank and destroy the trap or audio handler state.
  Consequence: one `DIV` emulation (~300 cycles) is two thirds of a 15 kHz
  period, and a trap plus its emulation (~400–700 cycles, `FLOATIMPL.md` §8)
  exceeds a 450-cycle period, so it swallows a sample. With a FIFO that is one
  skipped sample; without one, a click.
- **Persistent shadow (proposal).** Entry currently zeroes `R0'..R2', R13',
  R14'` (`doc/Interrupts.md`). For a HW IRQ, *not* clearing the shadow GP
  registers would give an ISR a persistent 3-register state for free — saving
  two memory accesses (~25 cycles) per tick. Zero area, but it is a spec
  change: "clean context" would apply to SWI/ILL only.
- **Delay slots.** The IRQ must be taken only at an instruction boundary and
  must not swallow or duplicate a delay-slot instruction. This is the bug class
  to test explicitly.
- **Cache.** A PSRAM ring contends with fetch and evicts lines. If the ISR
  drains a ring, keep it small enough to stay resident, or accept the cost.

## 7. I2S — and "T2S"

"T2S" is not a name this note can resolve; it reads as **I2S-class serial
audio** (BCK / WS / SD). If it means a particular DAC's mode, name the part.

I2S costs about the same logic — a 64×fs bit clock, a 32-bit shift register,
a WS toggle, plus the *same* sample pacing — so **~40–55 CLS + a buffer + 3
pins**, and it needs an external DAC (PCM5102A for line out, MAX98357A for a
speaker).

| | Delta-sigma | I2S |
|---|---|---|
| Pins | 1 | 3 |
| External parts | 3 R, 3 C, jack | DAC module |
| Resolution | ~1 bit at 450× OSR (~55 dB) | 16 bit, ~96 dB |
| Stereo | second pin + second modulator | free |
| Filter design | two-pole RC | none |

Recommendation: **delta-sigma** if the goal is "the machine makes sound" —
two resistors and a capacitor. **I2S** if a DAC module is already on the bench,
or if stereo/line level is wanted. The register map, FIFO and IRQ work are
identical either way, so this is a pinout/BOM decision, not an architecture
one.

## 8. The zero-CLS fallback

If even 50 CLS is too many: an **8-bit output register** (~4 CLS) plus
software PWM, or a 1-bit GPIO bit (~1 CLS). It needs the CPU to hit every
sample, so it only works inside a tight dedicated loop — fine for a `BEEP`,
not for game audio. Worth knowing it exists, not worth choosing.

## 9. Build gating

Put all of this behind `D16_AUDIO`, not inside `D16_PERIPH`. The tile build is
at 99 % CLS; audio has to be a choice the build makes, and the packed console
build (672 CLS, 0 BSRAM) must be able to take the buffer-less variant.

## 10. Tests

- **`sim:audio` (Verilator):** render 1 kHz and 100 Hz tones, filter the
  one-bit stream in the testbench, assert frequency (±1 %) and SNR > 40 dB;
  assert silence is a 50 % duty stream.
- **FIFO:** write 512 samples, assert level/space arithmetic, loop and stop
  behaviour, and no sample is dropped or duplicated across the wrap.
- **Register decode:** a store to `0xF0090` must not reach the PSRAM bridge
  (mirror the timer/SPI test).
- **Forth:** `BEEP` produces a tone; `PLAY` of a 64 ms buffer returns after
  ~64 ms and the tone is continuous across the refill.

## 11. Phases

| Phase | Work | Exit criterion |
|---|---|---|
| A0 | MMIO decode `0xF0090` + registers, no audio | reads/writes behave, stores claimed |
| A1 | sigma-delta modulator + pin | `sim:audio` tone and SNR pass |
| A2 | BSRAM FIFO + rate divider | 512-sample buffer plays gaplessly |
| A3 | Forth words `BEEP`, `NOISE`, `PLAY` | dictionary test |
| A4 | optional: timer IRQ consumer (see §6) | ISR-paced tones at 2–4 % CPU |

A4 is deliberately last: it needs the interrupt work from `SLIMPLAN.md` §11
and it makes samples *worse*, so it should only land for synthesis.

## 12. Risks

| Risk | Mitigation |
|---|---|
| CLS is at 99 %, audio may not place | `D16_AUDIO` gate; land the diet (`SLIMPLAN.md`) first if the full feature is wanted |
| ISR audio starves the Forth interpreter | prefer the FIFO; keep ISR rates ≤15 kHz and bodies ≤25 cycles |
| PSRAM ring thrashes the cache | keep the ring resident or use the BSRAM FIFO |
| Analog noise / DC thump | two-pole RC, AC coupling, 50 % silence |
| Pin choice is unverified | confirm against the Sipeed pinout before committing `deep16_board.cst` |

## 13. Open questions

1. **"T2S"** — I2S, or a specific part/mode?
2. **Mono or stereo?** Stereo is a second pin and a second modulator, shared
   FIFO.
3. **Sound for what** — beeps/SFX, or music/speech? The first wants the FIFO
   and a software synth; the second wants a deeper buffer and probably I2S.
4. **Sample rate** — 8 kHz (64 ms per 512-word block) or 15 kHz (32 ms, and
   phase-locked to the ms tick)?
5. **Is the 78-CLS build the target, or does audio get its own build?**
6. **Persistent shadow registers across a HW IRQ** — accept the spec change?
