# DVI 720p bring-up check

Status: **analysis only, nothing changed.** The 720p D16nano build has never
produced a confirmed picture on a monitor. This note compares it against a
third-party Tang Nano 9K HDMI project that is claimed to work at 1280x720, so
the board time that is left is spent on the paths that are actually unproven.

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
