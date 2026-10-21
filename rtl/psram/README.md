# PSRAM (HyperRAM) controller — vendored, **not used**

> **Status: rejected on hardware — including the pristine upstream design.**
> The unmodified upstream project (their test top, their PLL at 81 MHz, their
> UART print) was built with our toolchain and flashed: it prints
> `FAIL. Read wrong data.` exactly like the modified builds. So the failure is
> not caused by our changes; the design as committed does not run on this board
> with Gowin 1.9.12. Matches its own issues #4 (broken below 30 MHz) and #5
> ("Read wrong data"; the official IP works on the same board).
>
> Real bugs found and fixed while investigating (kept in the analysis, not in
> the vendored file): the 1x/2x latency indicator is sampled after the memory
> has released RWDS (it is driven during the CA), the write data-mask preamble
> is missing, and the init delay counter is hardcoded to 15 bits so it never
> elapsed below ~30 MHz. None of that made it work - the remaining failure is
> the DDR PHY/CA layer.
>
> The Gowin official "PSRAM Memory Interface HS" IP is the working path; this
> directory is kept for reference.

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

**The 27 MHz run failed at read ~1,062** (not the first), with 198 writes already
having taken the rare 2x/refresh path: a phase error would fail at read 1, so the
suspect is the rare-latency path, not the clock. To separate that from the
controller itself, the upstream author's exact 81 MHz point was built: with the
print module removed (`NO_UART_PRINT`) **every clock closes with 0 violations**;
with the print module the only failing paths are inside it (`print_buffer*`,
`print_seq*`), which is why that switch exists upstream. Two bitstreams are in
`artifacts/psram-ctl-test/`: `psram_81_led.fs` (LED-only: steady = fail, slow
blink = pass, fast blink = running) and `psram_81_uart.fs` (print included, its
timing marginal).

**Known upstream limitations (from its issue tracker).** Issue #4 reports the
controller is broken *below 30 MHz* ("Read wrong data"), which is why the
27 MHz and 13.5 MHz builds failed no matter the PLL phase. Issue #5 ("Example
test code fails with Read wrong data") is open and notes that the Gowin
official IP works on the same board. PR #10 ("Fix problems when running at
81 MHz") is an unmerged one-byte configuration fix (CR byte `0x8f` -> `0x9f`).
The 81 MHz builds here include that fix.

**LED polarity:** the Tang Nano 9K LEDs are active-low; the test display now
inverts so a lit LED reads as 1 in `{error, TEST_DONE, state[3:0]}`.

It is not yet instantiated by `deep16_board`.

## Bring-up on the board: how the machine boots

The machine fetches every instruction, load and store through
`deep16_psram_mem` one word at a time. The loader copies the image from the
on-chip BSRAM into PSRAM, reads the kernel entry word at `0x0100` back, and only
then releases the core; the boot ROM at `0xFFFF0..0xFFFFF` is served from the
local constant, not from PSRAM.

The six on-board LEDs (active low, pins 10/11/13/14/15/16) show:

| LED | meaning |
|---|---|
| 0 | heartbeat: slow blink = booted, fast = loading, off = read-back mismatch |
| 1 | core running |
| 2 | core halted on `0xFFFF` |
| 3..5 | retired instructions (counter bits 9, 13, 17) |

## Two core bugs the serial memory exposed

Both are invisible on the BSRAM machine, where `mem_stall` is always 0.

1. **Stale fetch tags across a segment change.** `if_cs_q`/`if_pc_q` were
   re-latched every cycle. The serial memory issues the fetch for the address
   current at the start of the transaction, but a `JML` that commits meanwhile
   changes `if_cs`; the tags then matched the stale word (read for
   `{old CS, new PC}`, truncated to an address in the image) against a fetch
   that wanted `{new CS, new PC}`. The boot ROM's jump to `0000:0100` read
   `0xFFFF` filler that way and halted. Fixed by holding the tags while
   `mem_stall` is high.

2. **`mem_late` redirects lost in a stall.** The SWI vector word and a load into
   PC redirect through `mem_rdata` when the instruction is in WB. With a serial
   memory every WB cycle is a `mem_stall` cycle, and the stall branch skipped
   the advance block that applies `if_redirect` - so every SWI fell through and
   ran the next instruction in line. Fixed by applying the redirect in the
   stall branch as well.

## Verifying the boot without a board

`rtl/sim/psram_boot_tb.sv` instantiates the real top (D16MINI + PSRAM) against
`psram_word_model`, whose memory starts erased, so the loader copy is exercised
too. It decodes the console pin and reports the halt address when the core
halts. Build and run:

```
node scripts/make_image.mjs
verilator --cc --exe --build -O2 -DD16MINI -DPSRAM --top-module psram_boot_tb \
  -Mdir obj_psram_boot rtl/deep16_pkg.sv rtl/deep16_alu.sv rtl/deep16_regfile.sv \
  rtl/deep16_cache.sv rtl/deep16_divider.sv rtl/deep16_uart.sv rtl/deep16_core.sv \
  rtl/deep16_top.sv rtl/psram/psram_word_bridge.sv rtl/psram/psram_word_model.sv \
  rtl/psram/deep16_psram_mem.sv rtl/sim/psram_boot_tb.sv rtl/sim/psram_boot_tb.cpp \
  -o psram_boot_tb
cd artifacts/image && ../../obj_psram_boot/psram_boot_tb
```

It prints `boot_done=1 boot_err=0 halt=0` and the banner.

## The cache

`deep16_psram_mem` now carries a write-through cache in front of the bridge:
512 lines x 2 words (1,024 words of data, one BSRAM block, plus a 512-entry tag
block), direct-mapped.

- Two-word lines are deliberate. A fill costs what the individual reads cost, so
  a longer line would make the first pass through fresh code slower than the
  uncached machine; the cache earns its keep on reuse, and Forth is all reuse.
- Write-through with update-on-hit. The cache always matches PSRAM, so code
  compiled into the dictionary is coherent the moment it is stored; FSH only
  dumps the tags (512 cycles, stalled).
- The tag array is uninitialised at power-up, so the loader clears it before the
  boot read-back.

Measured in `psram_boot_tb` over the boot window: **94 % hit rate**, 6.1
cycles/instruction (was ~17), 883k instructions in the same simulated time
instead of 311k. On the board: Logic 7,923/8,640, CLS 4,270/4,320,
**BSRAM 26/26**, 0 violations.

The hit path is three CPU cycles (lookup, compare, present). Presenting from the
lookup cycle would make it two; that is the next cheap win if it still fits.

## The dictionary uses the PSRAM

The kernel probes word `0x6000` at boot (two NOPs between the store and the
load: the BSRAM top's store-to-load bypass would otherwise answer the load from
the store, outside the window and all, and every board would look like it had
PSRAM). If the word reads back, the dictionary moves to `0x6000` and its ceiling
to `0xFFF0` - the top of segment 0, below the boot ROM. On the BSRAM board the
probe fails and the old layout stands, so one image runs on both.

`free` is `unused`, which reads the ceiling cell; `mem` prints the map it finds:

```
Deep16 memory map
  memory   00000-FFFFF  1048576 words, 2 MiB HyperRAM (PSRAM board)
  image    0000-5FFF   24576 words (kernel, data, boot script, BIOS, stacks)
  dict     6000 -6690   1681 words, 39263 free
  UART F0040-F004F   boot ROM FFFF0-FFFFF
```

The ceiling is 0xFFF0, not the full megaword: Forth addresses are 16-bit
offsets within a segment, so one dictionary can hold 64K words. Above that the
addressing would need segment switching in the kernel, which is not done.

`free` returns the headroom as a **double** (`unused 0`: low cell, high cell 0),
so `free d.` prints it whole and unsigned. A plain `free .` still sees only the
low cell, and `.` is signed, so it prints a negative number once the headroom
passes 32767 - use `d.` (or `u.`).

## The copy is verified

The loader reads the whole image back from PSRAM after copying it and compares
it with the BSRAM source. The first mismatch re-copies the image once; a second
mismatch sets `boot_err` (heartbeat LED steady) and boots anyway.

This exists because one board hung after the banner with a transient bad copy —
the same bitstream and the same image booted correctly on the next flash, and
the script's first bytes were provably intact, so a single wrong word elsewhere
in the dictionary was the only consistent explanation. The verify costs about
22 ms of boot (14.5 ms copy + verify) and 41 CLS of the 4,320.

`BOOT_DIAG=1 npm run image` adds a one-line boot diagnostic (probe result plus
the script's first bytes) for bring-up; the normal image does not carry it.

## The boot image is read-only at runtime

The image array in BSRAM is the *source* the loader copies from, and **a button
reset does not reconfigure the FPGA** — BSRAM keeps whatever it held. That made
two things go wrong together:

1. The top's write port was still live, so every store the kernel made inside
   `0x0000–0x5FFF` (its own `boot_ptr`, `boot_done`, the wordlist head, `HERE`…)
   also landed in the image. After the first boot the BSRAM image was last
   boot's variables. A button reset re-copied *that*, the verify compared PSRAM
   against the same corrupted source and passed, and the machine came up with
   `boot_done = 1` and `boot_ptr` pointing past the script: banner, no summary,
   no prompt, interpretation hanging. A power cycle restored BSRAM from the
   bitstream, which is why unplugging worked and the reset button did not.
2. The cache tags (also BSRAM) survived the reset, so the loader and the core
   could hit last boot's lines.

Fixes:

- The image write is gated with `!boot_done`. Keeping the write port (rather
  than deleting it) matters: with no write port the flow stops inferring BSRAM
  and builds the image out of LUTs — 15,008 LUTs, over the device.
- The tag clear now runs **before** the copy, not after.

Regression: `rtl/sim/psram_boot_tb` presses reset without reconfiguring and
boots a second time; it must print banner, summary and prompt again. Before the
fix the second boot stopped after the banner, exactly like the board.

## Where the cycles go (CPI)

Measured on the PSRAM boot window: **4.6 clk_cpu cycles per retired instruction**
(5.3 M instructions, 99 % cache hits). It is an average over a real workload, not
a pipeline depth or a fixed cost per instruction; a tight cached loop reads ~3.

The core is a four-stage pipeline with forwarding, so the datapath itself could
sustain one instruction per cycle. The **memory interface is not pipelined**: one
word transaction at a time, and the core is frozen (`mem_stall`) until the word is
presented. Each completed word releases exactly one pipeline advance.

| Event | clk_cpu cycles |
|---|---|
| cache hit fetch (`S_IDLE → S_LOOK → S_PRESENT`) | 3 |
| cache miss (two-word fill, ~12 x 51 MHz + CDC) | ~13 + present |
| load (one transaction, also costs the fetch slot) | 3–4 |
| store (write-through transaction) | 3–5 |
| load-use stall, branch redirect | 1–2 each |

So ~3 (fetch) + ~1.0 (data) + ~0.6 (hazards). Without the cache the same machine
measured ~17, which is the proof that the limiter is memory, not the pipeline.
Deeper/wider pipelines buy nothing here; decode-in-ID only shortens the cycle
time (Fmax), not the cycle count. The levers, in payoff order: present from the
lookup cycle (3 → 2), a write buffer, burst fills, a bigger cache.
