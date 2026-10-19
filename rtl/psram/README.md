# PSRAM (HyperRAM) controller — vendored

`psram_controller.v` is **vendored**, not written here.

- Source: <https://github.com/zf3/psram-tang-nano-9k>, `src/psram_controller.v`
- Author: Feng Zhou, 2022
- License: Apache License 2.0 — see `LICENSE.txt` in this directory.
- Not modified.

## Why this one

The QN88P package's embedded 64 Mbit part is a **HyperRAM** (HyperBus), not
the SDRAM-style part `PLANPSRAM.md` §12 originally described. Gowin's official
"PSRAM Memory Interface HS" IP builds for this device, but costs **CLS 663
(16 %) / LUT 1,054 / SSRAM 18** on its own, and the board build already sits at
CLS 4,163/4,320 (97 %). This controller is under 200 logic units, so it fits.

Trade-off accepted: it is **non-bursting**. A read is 12 cycles (1x latency) and
a write 7; an 8-word cache-line refill is therefore eight transactions
(~96 cycles) instead of one burst. The cache hides most of it; the alternative
(official IP) does not fit.

## Interface

```
clk, clk_p     // clk_p is clk shifted 90 degrees (HyperRAM DDR interface)
resetn
read, write    // one-cycle request, `busy` while the transaction runs
addr[21:0]     // BYTE address (word address << 1)
din[15:0], byte_write, dout[15:0]
busy
O_psram_ck[1:0], IO_psram_rwds[1:0], IO_psram_dq[15:0], O_psram_cs_n[1:0]
```

Only die 0 is used (4 MB). The PSRAM ports are "magic": the tool binds them to
the package's dedicated pads, so they need **no `.cst` entries**.

## Clocking (chosen)

Run the controller 1:1 with the CPU at **13.5 MHz** so the cache needs no clock
domain crossing:

- one rPLL: 27 MHz in, `CLKOUT` = 13.5 MHz (`FBDIV_SEL=0, IDIV_SEL=1`),
  `CLKOUTP` = 90° (`PSDA_SEL="0100"`);
- `FREQ=13_500_000`, `LATENCY=3` (the part's tACC for ≤ 83 MHz).

## Status

A standalone self-test (the upstream test top: write/read 1 MiB, report over
UART and LEDs) builds with this repo's Gowin 1.9.12 flow.

**First attempt, 13.5 MHz from the PLL: UART garbage.** Logic, controller and
UART all ran from the PLL's 13.5 MHz output and the console decoded noise - the
baud divisor and the actual clock disagreed, so the rPLL is the suspect at that
output frequency (or its 90-degree phase shift).

**Diagnostic build: logic and UART on the 27 MHz crystal, PLL only for `clk_p`.**
`clk_freq`/`FREQ` = 27 MHz, so the baud is exact regardless of the PLL, and the
controller's 90-degree clock is the PLL's `CLKOUTP`.

**Root cause of the failures: the rPLL's VCO.** `VCO = CLKOUT x ODIV` and the
VCO must sit in the part's range (~400-1200 MHz). The first builds set
`ODIV=1/2`, so the VCO was 27/13.5 MHz: the PLL never locked, there was no
valid 90-degree shift, and the reads sampled at the wrong edge ("Read wrong
data"), while everything clocked from the crystal looked fine. With
`ODIV=16` (VCO 432 MHz) the timing report shows `CLKOUTP` rising at 9.259 ns
of a 37.037 ns period - exactly 90 degrees. For a 13.5 MHz controller clock the
same rule gives `ODIV=32` (VCO 432).

```
Logic 1,070 (13 %)  CLS 647 (15 %)  Registers 478
27 MHz + CLKOUTP: 0 setup / 0 hold violations
bitstream: artifacts/psram-ctl-test/impl/pnr/psram_ctl_test.fs (not committed)
```

That isolates the two questions: if the UART is clean but the memory test fails,
the phase shift is the problem; if the UART is still noise, it is the test's
UART path rather than the PLL. Once the controller is proven, decide whether to
run it at 27 MHz with a CDC to the 13.5 MHz CPU or retry the PLL at 13.5.

It is not yet instantiated by `deep16_board`.
