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
UART and LEDs) was built with this repo's Gowin 1.9.12 flow at 13.5 MHz:

```
Logic 1,086 (13 %)  CLS 647 (15 %)  Registers 492
clk_cpu 13.5 MHz + 90-degree CLKOUTP: 0 setup / 0 hold violations
bitstream: artifacts/psram-ctl-test/impl/pnr/psram_ctl_test.fs (not committed)
```

It is not yet instantiated by `deep16_board`. The next step is the board
integration: PLL + controller + a power-on self-test, then the 4-way cache and
the `mem_stall` path that make PSRAM the machine's memory.
