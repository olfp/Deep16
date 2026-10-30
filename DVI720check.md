# DVI 720p bring-up check

Status: **resolved 2026-10-26.** The D16nano **FiT** graphics build (*Frogger
inspired tile-based*) now shows the console
at **1280x720@60** on the HDMI monitor. The original analysis is kept below as
the bring-up record; sections 11-14 record the fixes and the final board
result.

Reference under review:
<https://github.com/zf3/some-tang-nano-9k-examples/tree/main/01.hdmi>

## 1. Verdict

The reference **does not expose a bug** in our PHY. It confirms the parts that
were guesses:

* the rPLL divisor set that makes 371.25 MHz / 74.25 MHz on GW1NR-9,
* a 742.5 MHz VCO, `ODIV_SEL = 2`,
* 371.25 MHz through `OSER10` on this part,
* the CST convention (one `IO_LOC` for the pair, `p` name only, `DRIVE=8`,
  `PULL_MODE=NONE`, no `IO_TYPE`),
* the TMDS lane order (0 blue, 1 green, 2 red, 3 clock), and
* the sync polarity we send (`ctrl` high during the pulse, i.e. positive for
  720p).

Three things differ. Only the first is worth changing.

## 2. What the reference actually is

Do not trust its prose: `hdmi_top.v` comments say "25.2 MHz / 126 MHz" and
`gowin_rpll.v` has a `271.25/5` typo. The `defparam`s are the truth, and they
are 720p:

| item | reference | ours (`DVI_TILE`) |
|---|---|---|
| FCLKIN / IDIV / FBDIV / ODIV | 27 / 3 / 54 / 2 | same (`rtl/dvi/dvi_pll.v:57-58`) |
| CLKOUT | 371.25 MHz, VCO 742.5 | same |
| pixel clock | `CLKDIV(DIV_MODE=5)` fed 371.25 | rPLL `CLKOUTD`, `DYN_SDIV_SEL=5` (`dvi_pll.v:74,84`) |
| serialiser | `OSER10` x3, `PCLK`/`FCLK`/`RESET(~lock)` | same (`dvi_out.sv:153-177`) |
| clock lane | `clk_pixel` -> `ELVDS_OBUF` directly | 4th `OSER10`, `1111100000` (`dvi_out.sv:169`) |
| output buffer | `ELVDS_OBUF`, `DRIVE=8`, `PULL_MODE=NONE` | same (`deep16_board.cst:46-53`) |
| pins | 71,70 / 73,72 / 75,74 / 69,68 | same |
| sync | `ctrl = {vsync,hsync}`, high during pulse | active-low generator, inverted in `dvi_out.sv:141` -> same result |
| timing | 1664x748 (front 64, sync 128, back 192) | 1650x750 CEA-861 (110/40/220) |
| renderer clock | n/a | 24.75 MHz (`CLKOUTD3` / 3 -> `CLKDIV` / 5) |

Two notes:

* Our timing is the standard CEA-861 720p60 table; the reference uses SVO's
  own 1664x748 table. Ours is the safer one, not a deviation to fix.
* The reference's `CLKDIV` leaves `CALIB` tied low. Our text build ties it high.
  Keep ours high.

## 3. The one structural difference: how 74.25 MHz is made

* Reference, and our **text** build: `CLKOUT` (371.25) -> `CLKDIV(DIV_MODE=5,
  CALIB=1, RESETN=lock)` -> 74.25.
* Our **tile** build: `rPLL.CLKOUTD` with `DYN_SDIV_SEL=5` -> 74.25.

The frequency is not in question; both are exactly 74.25 MHz. What is unproven
is the **PCLK/FCLK phase** presented to `OSER10`. `CLKDIV` is the companion
macro Gowin ships for deriving an `OSER10` parallel clock from a PLL output
(hence its `CALIB` port). `CLKOUTD` is a generic internal divider and nothing
in this design proves its phase against `CLKOUT`.

This is the only place where our 720p build differs structurally from a design
that is claimed to work, and it is a ~10-line change.

It also gives a clean experiment on the same board:

> Flash the **text** build (640x480, `CLKDIV`) and the **tile** build (720p,
> `CLKOUTD`). If 480p shows a picture and 720p shows nothing, the pixel-clock
> source is the suspect - not the pins, not the serialiser, not the encoder.

## 4. What the reference cannot tell us

1. **74.25 MHz timing closure of the whole tile design.** `rtl/dvi/README.md`
   quotes `0 TNS on every clocked domain` for the *text* build at 25.2 MHz. The
   tile fit block lists CLS / Logic / Registers / BSRAM but **no TNS or Fmax**.
   A violated `dvi_pixel` or `dvi_serial` domain is the most likely silent
   failure, and it produces exactly the symptom "we don't know if there is any
   output". No third-party project can substitute for that report.
2. Whether the tile engine ever asserts `de`. The design has a fallback for
   this (section 6), so it is measurable rather than guessable.
3. Anything about the renderer's line rate. `README.md` says 25.5 MHz / 43.9 us;
   the code says 24.75 MHz. See 5.3.

## 5. Defects found in our tree (independent of the reference)

### 5.1 `led[4]` claims to be a pixel-clock heartbeat and is not

`rtl/deep16_board.sv:371-373` documents:

```
led3 lit = DVI PLL locked, led4 blinking = 74.25 MHz pixel clock alive,
led5 blinking = 24.75 MHz render clock alive
```

but the assignment at `rtl/deep16_board.sv:390` is

```systemverilog
assign led[4] = ~o_core_instrs[13];
```

i.e. CPU activity. Nothing in the design proves the `dvi_pclk` domain is
running, which is precisely the domain under suspicion. A one-bit counter in
the pixel domain would close the bring-up matrix.

### 5.2 Reset de-asserts asynchronously to the pixel clock

`rtl/deep16_board.sv:153`:

```systemverilog
assign dvi_rst = dvi_rst_sync[1] | ~dvi_lock;
```

`dvi_lock` is a PLL pin, asynchronous to `dvi_pclk`; the reset therefore falls
asynchronously with respect to the pixel domain (the `rst` term is synchronised,
the lock term is not). The reference registers `locked` and releases the pixel
reset four pixel clocks later. Async release is legal for `OSER10.RESET` but
sloppy for the tile FSM. Low risk, cheap fix.

### 5.3 Stale render-clock text

* `rtl/dvi/README.md:13` and `:120` say the renderer runs at 25.5 MHz with a
  43.9 us line.
* `rtl/deep16_board.sv:140` still says "the PSRAM PLL's 25.5 MHz CLKOUTD".

The code is right and the prose is wrong: `R_H_TOTAL = 1100` at 24.75 MHz is
44.44 us, exactly two 720p output lines (2 x 1650 / 74.25 MHz). Do not "fix"
the code to 25.5. But if that divider chain were ever wrong - for example
`CLKOUTD3` were 74.25 rather than 123.75, giving a 4.95 MHz render clock - the
scan would starve and the picture would be **valid sync with a black screen**.
That is the exact failure mode to rule out.

### 5.4 Comment in `dvi_tile.sv` says ~0.23 s, the counter says ~0.11 s

`boot_wait[23]` at 74.25 MHz trips after 2^23 clocks = 0.113 s, not 0.23 s
(`rtl/dvi/dvi_tile.sv:761-762`). Harmless, mention it so nobody times a
measurement by it.

## 6. Bring-up decision table

The design already carries everything needed to separate "no PHY" from "no
pixels" without new hardware. Read the LEDs first, then the screen.

| LED / screen | Reading |
|---|---|
| `led[3]` lit (off = unlocked; `led[3] = ~dvi_lock`) | rPLL locked: 371.25 and 74.25 exist |
| `led[5]` blinking | 24.75 MHz render clock alive and the tile engine emits frames |
| monitor shows **red/green vertical bars** after ~0.11 s | PHY, scan and serialiser are fine; the *renderer* is broken (`test_mode` fallback, `dvi_tile.sv:761-770`) |
| monitor shows the console | everything fine |
| monitor reports **no signal** | clock tree or `OSER10`/`ELVDS`: try the `CLKDIV` arrangement (section 3) first |
| monitor locks (720p60 shown) but the picture is noise | 74.25 MHz timing closure: get the tile TNS report |
| monitor locks, black screen | renderer starving or `de` never asserted (`dvi_tile.sv:802`) |

The test-pattern fallback is the key asset: it is already built in, and it
proves the whole PHY without the CPU, the PSRAM or the tile engine.

## 7. Work items

Ordered by value per risk. P0-P2 are only worth doing if the board shows no
signal; P3 is worth doing regardless.

**P0 - pixel-clock source (only if the text build works and 720p does not).**
In `rtl/dvi/dvi_pll.v`, for `DVI_TILE`, replace the `CLKOUTD` path with the
reference arrangement:

```systemverilog
`ifdef DVI_TILE
  // 371.25 / 5, the Gowin-documented companion path for OSER10 PCLK.
  CLKDIV #(.DIV_MODE("5"), .GSREN("false")) pixel_div (
    .CLKOUT(clk_pixel), .HCLKIN(clk_serial), .RESETN(lock), .CALIB(1'b1));
`else
  ... unchanged ...
`endif
```

Drop `DYN_SDIV_SEL = 5` / `assign clk_pixel = clk_pixel_d` from the tile branch
(the parameter stays for the text branch or goes away entirely). Keep
`CLKOUTD3` -> `CLKDIV` for the 24.75 MHz render clock.

**P1 - pixel-domain heartbeat.** Feed `led[4]` from a counter bit clocked by
`dvi_pclk` (for example the top bit of a 25-bit counter, ~2 Hz), and correct
the comment at `deep16_board.sv:371-373`. This turns "is the 74.25 MHz domain
alive?" from a guess into an LED.

**P2 - synchronous reset release.** Register `dvi_lock` in the `dvi_pclk`
domain and hold `dvi_rst` for two to four pixel clocks after it rises:

```systemverilog
always_ff @(posedge dvi_pclk) begin
  lock_sync <= {lock_sync[0], dvi_lock};
  if (rst_sync[1] | ~lock_sync[1]) dvi_rst_cnt <= 2'd3;
  else if (dvi_rst_cnt != 2'd0)    dvi_rst_cnt <= dvi_rst_cnt - 2'd1;
end
assign dvi_rst = (dvi_rst_cnt != 2'd0);
```

Same treatment for `dvi_rst_render`. Do not change `OSER10.RESET` polarity.

**P3 - get the tile timing report.** `npm run synth:tile`, then read TNS/Fmax
for `dvi_pixel` and `dvi_serial`. Nothing else in this document matters if
those domains do not close. Note that the vendor tool needs a licence, so this
may have to wait for the Mac.

**P4 - documentation.** Fix `rtl/dvi/README.md:13,120`, the comment at
`deep16_board.sv:140`, and the 0.23 s comment in `dvi_tile.sv:762`. Correct the
led4 description once P1 lands.

## 8. Tests

* `npm run sim:dvi` and `npm run sim:dvi:tile` must stay green. They cover the
  encoder, the scan timing, the sync and the pixel path; they do **not** cover
  the PLL, `OSER10` or `ELVDS_OBUF` (Gowin primitives, no simulation model).
* P0 is untestable in Verilator. Its verification is the board.
* P1 is testable by simulation of the LED expression only if the counter is
  exposed; otherwise it is a board observation.
* Add nothing to the test suite that would fail without a board.

## 9. Risks

* P0 changes the clock tree of a domain that has never been confirmed. If the
  text build is also unconfirmed, P0 could hide a pin or serialiser problem
  behind a second variable. Confirm 480p on the same board first if possible.
* 742.5 MHz VCO is confirmed only by the reference project's claim, not by our
  own report. It is inside the GW1NR-9 range and both PLLs are configured
  identically, so the risk is low.
* The tile build is 3,648-3,936 CLS of 4,320. Any P1/P2 logic must not push the
  scan path over; both are a handful of flops, but the tile budget is the
  binding constraint, not BSRAM.
* `OSER10` clock-lane vs direct `ELVDS_OBUF` clock lane: ours matches the data
  lanes' latency, which is arguably better. Do not "fix" it to match the
  reference unless the `CLKDIV` change fails.

## 10. Open questions

1. Was the tile build ever flashed and powered on, and if so what did the
   monitor report - "no signal", "720p60", or a picture?
2. Do we have a tile-build timing report from the 23 Oct run, or only the CLS /
   Logic / BSRAM numbers in `rtl/dvi/README.md`?
3. Should P0 be done unconditionally (both builds on the same clock path) or
   only if 480p is confirmed working?

---

## 11. Update 2026-10-26 (after the heartbeat build)

The P0 clock change is in the tree; P1/P2 are not in the final timing-clean
build, and the test-pattern fallback was removed to get timing closure.

* **P1 (diagnostic heartbeat)** — a temporary pixel-domain heartbeat was built,
  with a second heartbeat on the CLKDIV path. The board read: `led[3]` lit,
  the CLKDIV /5 heartbeat fast blink, the rPLL CLKOUTD /5 heartbeat **very
  fast** (not 74.25 MHz), and the renderer LED off. That identified the
  CLKOUTD path as wrong and the CLKDIV path as the one to use.
* **P0 (applied)** — the tile pixel clock now uses the reference/Gowin
  companion arrangement, `CLKDIV(DIV_MODE=5, CALIB=1, RESETN=lock)` from
  371.25 MHz, for both builds. The CLKOUTD divider is no longer used for
  `clk_pixel`.
* **P1 in the production build** — the heartbeat was removed after diagnosis:
  both the 24-bit counter and a 4-bit cascade version cost pixel-domain
  timing. `led[3]` lock and `led[5]` renderer-frame heartbeat remain. A
  separate bring-up build can restore the pixel heartbeat if needed.
* **P2 (deferred)** — the lock-registered three-clock reset hold was
  implemented and measured: it pushed the pixel domain from ~75.5 to
  ~67.7 MHz Fmax (three endpoints). The original asynchronous release is
  back for now; revisit with a global reset buffer.
* **Test-pattern fallback (removed)** — the ~0.11 s timeout counter (24-bit or
  cascade) was the remaining pixel-domain timing path. The production build
  now starts the scan only on a real `ready`/`frame` from the renderer; `led[5]`
  tells whether frames are being produced.
* **Encoder** — the pipelined TMDS encoder was checked against a reference
  model: 0 mismatches over 50,000 random samples. It is not the fault.
* **P4** — the 25.5/43.9 µs prose and the timeout comment are fixed; the
  renderer is documented at 24.75 MHz.

The next board test is the CLKDIV pixel clock, no test pattern, with `led[5]`
as the renderer-frame indicator. If the pixel clock is alive and the monitor
still shows nothing, the remaining unproven parts are the OSER10 at 371.25 MHz
and the HDMI PHY; a lower-rate 720p test is the next fallback.

## 12. Reference board test, 2026-10-26

The reference project was cloned to a sibling checkout, built with the
installed Gowin 1.9.12 flow, and flashed with `openFPGALoader -f` (external
config flash only; the D16 user flash was untouched).

Result: **the monitor locks at 1280x720@60 Hz and the SVO test card is stable.**
The card shows bright vertical seams at some (~30%) tile borders; those are the
reference's own pixel-domain artifacts (the project has no timing constraints),
not a missing display.

This confirms the display, cable, HDMI pins, 371.25 MHz PLL, OSER10 data lanes
and 720p receiver path. The structural difference that mattered is the **clock
lane**: the reference drives `clk_pixel` directly into the ELVDS buffer, while
the D16 tile build used a fourth OSER10 with `1111100000`.

The D16 build now does the same direct `clk_pixel` clock lane and uses the
reference's PLL/CLKDIV IP settings (`DYN_DA_EN=true`, `CLKDIV CALIB=0`) for the
tile build. The current tile placement closes `dvi_render` at 26.9 MHz but
`dvi_pixel` at 72.5 MHz (3 endpoints, about -1.0 ns); the next board test will
show whether that marginal path causes seams or a picture. If the picture
appears with seams, the remaining work is to pipeline the last pixel path.

## 13. Root cause of the no-frame / no-scan state

The board LEDs (render clock alive, DVI lock lit, yet no renderer frame and no
scan start) exposed a startup race, not a PHY problem.

The scan domain's `free_toggle` has reset value `3'b111`, but the pixel-domain
reset is gated by the asynchronous PLL lock (`dvi_rst = rst_sync | ~dvi_lock`).
The pixel clock only starts when the PLL locks; the first pixel clock could see
`dvi_rst` already low, so the scan's reset branch never ran and `free_toggle`
stayed at its power-up value `0`. The renderer then saw `line_free = false` at
the first line 0, held `rx/ry` in `render_stall`, and never reached the frame
toggle; the scan therefore never started. That is exactly the observed LED
pattern.

The D16 tile now initializes the handshake flops at declaration
(`free_toggle = 3'b111`, `ready_toggle/frame_toggle/armed/free_seen/wr_buf = 0`)
so the renderer sees the buffers free even if the first reset pulse is missed.
The proper follow-up is the P2 synchronous reset-release hold; it was deferred
only because its reset fanout cost pixel-domain timing. With the initialization
the current placement closes `dvi_pixel` at 76.28 MHz and `dvi_render` at
25.57 MHz, 0 TNS.


## 14. Board result, 2026-10-26

The D16nano tile build now shows the Forth console at **1280x720@60** on the
monitor. Final fixes:

* pixel clock from the Gowin `CLKDIV /5` companion path, not `CLKOUTD /5`;
* direct `clk_pixel` clock lane into the ELVDS buffer, as in the reference;
* reference PLL/CLKDIV IP settings for the tile build;
* line-buffer handshake power-up initialization (`free_toggle = 3'b111`,
  ready/frame/armed = 0), because the asynchronous PLL-lock reset release
  could miss the scan's reset branch and leave the renderer stalled at line 0.

The reference test card confirmed the monitor, cable, HDMI pins, 371.25 MHz
PLL and OSER10 data lanes. The D16 console confirms the complete tile render,
scan, 2x2 pixel repeat and TMDS path at 720p. The bring-up LEDs remain as
documented in section 12 (led2 render clock, led3 DVI lock, led4 scan started,
led5 first rendered frame).

## 15. 2026-10-29: line-pair control retime

The board changes (config-flash pin mux, removals) moved the DVI placement:
79.26 → 72.755 → 65.973 MHz. Two fixes:

* **`psram_clk` named and grouped as asynchronous with `clk_cpu`.** The PSRAM
  bridge is a request/ack handshake and its read data is synchronized, so the
  cross-domain paths must not drive placement.
* **`next_line`/`next_buf` registered (`line_next_q`/`buf_next_q`).** The
  failing path was `sy_1 → ready_seen_*/CE`; the line-pair control is stable
  for a whole line, so the enable now comes from the registered control.

Result: `dvi_pixel` **84.777 MHz** (6 levels, TNS 0), `dvi_render` 26.801 MHz,
all clocks close. The tile simulation passes.

## 16. 2026-10-29: one-hot line-pair select (I2S placement)

The I2S build placed `dvi_pixel` at **70.969 MHz** (TNS −0.780, 2 endpoints).
The failing path was again the line-pair handshake but one level deeper:
`buf_next_q_0 → ready_seen_*/CE` through the 3:1 `ready_seen[buf_next_q]`
mux and the toggle XOR.

Fix: register a one-hot `sel_next_q` beside `buf_next_q`, precompute the
per-buffer `ready_diff = ready_s1 ^ ready_seen`, and write each `ready_seen`
bit under `line_next_q && sel_next_q[i] && ready_diff[i]`. The CE is now one
AND from the registered select, not a mux + XOR from `buf_next_q`.

Result: `dvi_pixel` **76.974 MHz** (9 levels, TNS 0) with the I2S in the
netlist; CLS 4,294 / 4,320 (26 free). The tile simulation passes.

## 17. 2026-10-29: flat OAM pointer and the palette fill path

The flat OAM group pointer re-placed the `fx_1 → linebuf DI` palette path at
40.848 ns, so `dvi_render` fell to **24.455 MHz** (TNS −1.392) and
`dvi_pixel` to 74.083 (TNS −0.030). The logic is unchanged; it is placement.

`place_option 1` recovered it:

* `dvi_render` **26.584 MHz**, `dvi_pixel` **80.643 MHz**, all clocks TNS 0;
* CLS **4,299 / 4,320 (21 free)**, BSRAM 24 / 26.

The palette mux in the line-buffer write data path is still the pressure
point; the palette-BSRAM retime (registered palette + one-cycle delayed
line-buffer write) is the next timing experiment and is in the todo list.

## 18. 2026-10-29: palette RAM + registered line-buffer write

The flat OAM pointer build with `place_option 0` failed at `dvi_render`
24.455 MHz (the `fx_1 → linebuf DI` palette path, 40.848 ns). `place_option 1`
closed the DVI but dropped `psram_clk` to **55.342 MHz**; the board did not
boot that image (PSRAM margin), which is why §17 is not the shipping build.

The palette was a 128-bit register (`pal_bits`) plus a 16:1 mux in front of
the line-buffer write. It is now a 16×16 RAM (`pal_mem`, low 8 bits RGB332,
initialised from `tilepal.hex`), read on a registered port. The line-buffer
write (`we`/address/data) is delayed two `clk_render` cycles to align with the
registered palette; the last pixel of a line still lands long before the scan
reads it.

Result with `place_option 0`, `route_option 1`:

| | value |
|---|---|
| CLS | **4,214 / 4,320 (106 free)** |
| LUT / ALU / FF | 6,309 / 759 / 2,936 |
| BSRAM | 24 / 26 (palette is 2 RAM16 in SSRAM) |
| dvi_render | **32.278 MHz**, TNS 0 |
| dvi_pixel | **86.152 MHz**, TNS 0 |
| psram_clk | **83.996 MHz**, TNS 0 |

The palette experiment freed **85 CLS** as well as fixing the fill path, so
the interrupt blocks now fit without the boot move. The tile simulation
passes; this is the image to flash.

## 19. 2026-10-29: timer IRQ + SIC

The SIC (`rtl/deep16_sic.sv`, `0xF00B0`) adds a 4-bit sticky pending register
with W1C, an enable mask and one level IRQ. The timer's new 15 kHz tick
(450 cycles) drives source bit 1. Core3 takes the IRQ at the ID boundary only
when PSW.I=1, the core is in the normal bank and the instruction is not a delay
slot; a synthetic SWI reads vector 1 and restores the parked PC, so the
interrupted instruction re-runs after RETI. The kernel handler at `0x51A0`
clears the timer bit and increments `SIC SCRATCH`; Forth exposes `irq-on`,
`irq-off`, `irq-clear`, `ticks` and `irq?`.

| | value |
|---|---|
| CLS | **4,294 / 4,320 (26 free)** |
| LUT / ALU / FF | 6,577 / 761 / 2,968 |
| BSRAM | 24 / 26 |
| dvi_render | **30.937 MHz**, TNS 0 |
| dvi_pixel | **78.956 MHz**, TNS 0 |
| psram_clk | **87.255 MHz**, TNS 0 |
| clk_cpu | 15.790 MHz (6.75 required), TNS 0 |

The cost is **80 CLS**, mostly the core's IRQ mux and the SIC decode, so only
26 CLS are left. The raster/keyboard/audio sources need the boot move or a
diet before they go in. `sim:irq` covers the core entry (the parked store
re-runs), `sim:sic` covers W1C/priority/scratch, and the timer test covers the
tick.

## 20. 2026-10-29: boot image moved to the config flash

The 24K boot image left the on-die FLASH608K and now lives in the config flash
at `0x100000`. `boot_spi_read` sends mode-0 `0x03` reads through the existing
`deep16_spi` master while the core is held; `flash_boot` keeps the header, CRC
and D16SEG scatter. The on-die read controller and the FLASH608K primitive are
deleted.

| | timer build | boot move |
|---|---:|---:|
| CLS | 4,294 / 4,320 (26 free) | **4,279 / 4,320 (41 free)** |
| LUT / ALU | 6,577 / 761 | 6,596 / 759 |
| FF | 2,968 | 2,971 |
| dvi_pixel | 78.956 MHz | **82.280 MHz**, TNS 0 |
| dvi_render | 30.937 MHz | **30.594 MHz**, TNS 0 |
| psram_clk | 87.255 MHz | **83.011 MHz**, TNS 0 |
| clk_cpu | 15.790 MHz | 16.603 MHz, TNS 0 |

The move frees **15 CLS**. The boot is ~0.37 s in `sim:flashboot` (3.375 MHz
SPI; the on-die loader was ~0.18 s). `sim:flashboot` checks the entry word,
the flat image and both D16SEG copies against `image.flash.hex`; `sim:bootspi`
checks the reader through the real SPI master.

## 21. 2026-10-29: raster IRQ and per-row fine scroll

Two tile-engine features landed together because they share the control block:

* **control 7** (`0xF200E`) selects a source raster line; the engine toggles
  `raster_toggle` at the end of that line, the board synchronises the toggle
  into `clk_cpu`, and SIC bit 3 latches one pulse. The handler services raster
  before timer and increments `SIC_RASTER` (`0xB8`).
* **control 6** (`0xF200C`) writes `{en, row[4:0], fine[2:0]}` into a 32x16
  next table; the frame boundary copies it to the live table, and the fill
  uses the live row phase in place of `scroll_x[2:0]`. `en=0` is the old path.

| | before | after |
|---|---:|---:|
| CLS | 4,279 / 4,320 (41 free) | **4,281 / 4,320 (39 free)** |
| LUT / ALU / FF | 6,596 / 759 / 2,971 | 6,560 / 769 / 3,012 |
| BSRAM / SSRAM | 24 / 180 | 24 / 184 |
| dvi_pixel | 82.280 MHz | **78.262 MHz**, TNS 0 |
| dvi_render | 30.594 | **30.343 MHz**, TNS 0 |
| psram_clk | 83.011 | **77.841 MHz**, TNS 0 |
| clk_cpu | 16.603 | **15.345 MHz**, TNS 0 |

The 26:1 fine-table read mux the plan feared did not materialise: the 32x16
tables map to SSRAM/registers, so the two features cost only **2 CLS**. The
DVI still closes with TNS 0 on both clocks; `psram_clk` remains above 51 MHz.

`sim:dvi:tile` checks the raster toggle and the mid-frame latch, independent
rows, global+row offsets and the disabled path. `sim:sic` checks the `RASTER`
register, and the segmented test checks the handler's raster-before-timer
priority. Board flash pending.

## 22. 2026-10-30: text/art/sprite palette banks and pair mode

The 16 x 16 palette RAM moved to one 64 x 16 BSRAM split into three banks:
text `0..15` (eight paper/ink pairs), art `16..31` and the shared sprite bank
`32..47`. The CPU window is `0xF5080`-`0xF50AF`; the text bank keeps the
console colours and the game only writes the art and sprite banks. A text
tilemap cell now carries `0x8000 | (pair << 12) | tile address`; the fill
reads entry `2p`/`2p+1` selected by `pix[0]`, while mode-0 cells still read the
art bank and sprites read the sprite bank. The BIOS composes the pair from
`text_attr` (`0x3BEE`, default `0x8000`) so the console path costs one `OR`.

| | raster build | palette + pair |
|---|---:|---:|
| CLS | 4,281 / 4,320 (39 free) | **4,311 / 4,320 (9 free)** |
| LUT / ALU / FF | 6,560 / 769 / 3,012 | 6,628 / 769 / 3,014 |
| BSRAM / SSRAM | 24 / 184 | **26 / 190** |
| dvi_pixel | 78.262 MHz | **86.108 MHz**, TNS 0 |
| dvi_render | 30.343 | **27.013 MHz**, TNS 0 |
| psram_clk | 77.841 | **72.888 MHz**, TNS 0 |
| clk_cpu | 15.345 | **20.435 MHz**, TNS 0 |

The three banks cost **30 CLS and both free BSRAM blocks**, so the build is now
at 100 % BSRAM and 9 CLS. `dvi_render` still closes (27.013 > 24.75 MHz), but a
single hold-violated endpoint remains on the `clk_cpu -> clk` clock-divider
crossing (TNS is 0 for every constrained clock; the path is the divider's own
asynchronous source). `sim:dvi:tile` checks pair 0/1, the art fallback and the
sprite bank; `npm test` covers the console text cells and the game palette
writes. The full COLORTEXT 1bpp font, underline and italic styles do not fit in
9 CLS and are left as design in `COLORTEXT.md` §6. Board flash pending.

## 23. 2026-10-30: COLORTEXT underline and bold smear

The first two §6 styles fit without a font change. Text cells keep the
32-word-aligned tile address; bits 4:0 are free, so bit 2 is a generated
underline and bit 1 a bold smear. The fill captures them with the existing
`tm_q` cell read, forces ink on glyph row 14 for underline, and repeats an ink
pixel one to the right for bold (`prev_ink` is reset at each cell boundary).
The tile-address fetch is now `{tm_q[11:5], 5'b0}`, which masks the style bits
and also removes five address bits from the fill adder.

Software is entirely in the catalog: `ATTR` preserves the style, `STYLE`
preserves the pair, and `ATTR!` sets both. `text_attr` still holds the whole
attribute, so **the BIOS is unchanged** — `utx_char` already ORs it into
`(ch - 0x20) << 5`, and the style bits land in the free low bits.

| | palette build | underline + bold |
|---|---:|---:|
| CLS | 4,311 / 4,320 (9 free) | **4,295 / 4,320 (25 free)** |
| LUT / ALU | 6,628 / 769 | **6,607 / 745** |
| FF | 3,014 | 3,009 |
| BSRAM / SSRAM | 26 / 190 | 26 / 190 |
| dvi_render | 27.013 MHz | 29.462 MHz |
| dvi_pixel | 86.108 MHz | 74.120 MHz, **TNS -0.047** |

The logic is **16 CLS smaller** at the same `place_option 0`. The default
placement then failed `dvi_pixel` by 0.047 ns (two endpoints, a line-buffer
placement artifact), so the branch switches the tile TCL to `place_option 1`.
That gives **4,289 / 4,320 (31 free)** with `dvi_render` 32.405,
`dvi_pixel` 86.713 and `psram_clk` 94.458, all TNS 0; BSRAM stays 26/26. The
single hold-violated endpoint on the `clk_cpu -> clk` divider crossing is
unchanged (the per-clock TNS table is 0).

`sim:dvi:tile` checks underline, bold, the row above the underline, the
art-cell style mask, the plain-text baseline, and both styles with pair 3
(green paper, yellow ink). `npm test` checks that the BIOS writes the style
bits into the tilemap cell and that the catalog words compose `text_attr`.
Board-verified 30 Oct 2026: underline and bold work with the default pair and
with pair 3; a high-contrast paper/ink pair is needed to see the underline,
because it is drawn in the pair's ink colour. The command line that sets the
style is echoed with the old attribute, so the effect starts with the prompt
and the next line.

## 24. 2026-10-30: 1-bit regular and italic text pages

The shear was replaced by a real second font page. Tile 0 stays a blank
32-word art tile (the console's cleared cells are mode 0 tile 0), the regular
1bpp page starts at word 32 and the italic page at word 800; the 32 art tiles
stay at `0x0C00`. A text cell's bits 11:5 are the glyph index, and the fill
reads `32 + index*8 + page*768 + (row >> 1)`; `STYLE` bit 0 selects the italic
page. The BIOS is unchanged: `utx_char` already writes `(ch - 0x20) << 5`.

The regular page is the existing `font8x15.hex` data (8 words per glyph); the
prototype italic page is a font-build-time two-step shear, so a designed
italic font can replace it without touching the RTL.

| | underline + bold | 1bpp pages |
|---|---:|---:|
| CLS | 4,289 / 4,320 (31 free) | **4,309 / 4,320 (11 free)** |
| LUT / ALU | 6,607 / 745 | 6,665 / 745 |
| FF | 3,009 | 3,011 |
| BSRAM / SSRAM | 26 / 190 | 26 / 190 |
| dvi_render | 32.405 MHz | **30.125 MHz** |
| dvi_pixel | 86.713 MHz | **78.013 MHz** |
| psram_clk | 94.458 MHz | **86.351 MHz** |

The two pages and the page-select fetch cost **20 CLS** over underline+bold
(and 3 CLS less than the shear prototype), leaving 11 free. BSRAM is unchanged
because the art stays at `0x0C00`; moving the art to `0x0600` and shrinking the
bank to 2,560 words would free one block, at the cost of the game's `T_*`
constants. `sim:dvi:tile` checks the 1bpp H/A glyphs, the blank tile 0, the
underline/bold/italic styles and the art-cell mask; `npm test` passes 678.
Board flash pending.
