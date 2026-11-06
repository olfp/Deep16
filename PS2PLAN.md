# PS2PLAN — PS/2 host init at boot, and the move into `binit`

Status: **Phase B implemented (2026-11-06); board verification is the only
step left.** Phase A (the Forth-loaded sender and `ps2-auto`) was board-verified
on a Periboard 409P and is now retired: the sender and the init live in the
BIOS, `binit` runs them, and the `ps2host` slice is gone. The receiver, the
open-drain host GPIO and the board pinout are unchanged; see `HARDWARE.md`.

## 1. Why the keyboard needs a host and not just a receiver

The port was receive-only until 2026-11-06. Some keyboards (the Periboard 409P)
come up in a state where they do not scan until the host resets them: the host
must send `0xFF` (Reset) and `0xF4` (Enable Scanning) over the same two wires.
A receive-only port can never do that, so the pads became open-drain `inout`s
and the software got a sender.

What exists today:

| Piece | Where | Notes |
|---|---|---|
| Receiver | `rtl/ps2_rx.sv` | 2-FF sync, 11-bit frame, odd parity, Set-2 decode, ASCII map |
| Drive bits | control 6 `0x200C` bits 9/10 | 1 = pull CLK/DATA low, 0 = release; the tile engine only uses bit 8 |
| Level bits | `0xF0066` bits 5/6 | synchronised CLK/DATA, for the sender's timing |
| Frame toggle | `0xF0066` bit 7 | flips on every valid frame (ACK/BAT included) |
| Sender | `asm/forth_nano.asm`, BIOS `0x5490` | `ps2_send`, BIOS function 7 |
| Init | `asm/forth_nano.asm`, BIOS `0x5490` | `ps2_init`, BIOS function 8; `binit` calls it |
| Forth | `screens/flash/games.fth` | no PS/2 words: `cls` (BIOS function 1) is the manual re-init |

The sender is assembly because threaded Forth is far too slow for the PS/2 bit
period: a `\`es!` chain costs about a millisecond per bit against a 60–100 µs
bit, so the keyboard clocked the start bit and then stopped. The block runs at
CPU speed and meets the timing easily.

Frame format both ways: start (0), 8 data bits LSB first, odd parity, stop (1),
one bit per keyboard clock. A host frame is requested by holding CLK low with
DATA high for ≥ 100 µs, then pulling DATA low and releasing CLK; the keyboard
then supplies all 11 clocks.

## 2. Phase A — auto-init at boot (retired)

This was the bridge while the sender still had to be a slice; it is kept here
as the record of what was board-verified. The definitions are gone from
`screens/flash/games.fth` now that Phase B has moved them into the BIOS.

`ps2-auto` was the last definition in `screens/flash/games.fth`, and the screen
is loaded by the boot script (`9 screen`, before the banner and the prompt), so
the init runs with no image growth and no RTL change:

```forth
: ps2-ticks ( n -- )                          \ n * 65,536 clocks (~9.7 ms)
  0xF006A es@ +
  begin  dup 0xF006A es@ swap - 0<  while  repeat
  drop ;

: ps2-enable ( -- )
  0xFF ps2-send
  103 ps2-ticks                               \ ~1.0 s
  0xF4 ps2-send  41 ps2-ticks
  0xF4 ps2-send  41 ps2-ticks
  0xF4 ps2-send  41 ps2-ticks
  0xF4 ps2-send ;

: ps2-auto ( -- )
  0xF0066 es@ 0xFFFF = if exit then           \ the JS core reads erased memory
  ps2-load ps2-settle ps2-enable ps2-flush ;

ps2-auto
```

- **Timing** is counted in D16nano cycle-counter ticks (`0xF006A` is the high
  half of the 32-bit counter at 6.75 MHz, so one tick is ~9.7 ms), not in
  interpreter loops. The first version used `65535 0 do loop` and the loop's
  length depended on the dictionary and on how much the console had printed;
  that made the waits unpredictable.
- **Settle** (`31 ps2-ticks`, ~0.3 s) runs after `ps2-load`, before the reset,
  so the keyboard is not still in its own power-on self test.
- **Order.** `0xFF` (reset, expects ACK `0xFA` and BAT `0xAA`), then `0xF4`
  (enable scanning) at ~1.0, 1.4, 1.8 and 2.2 s: a keyboard still running its
  self test swallows the early ones, and a repeated enable is harmless.
- **Guard.** The JS core has no PS/2 model and reads `0xF0066` as erased
  memory (`0xFFFF`); the board never drives bits 15:11, so the guard fires
  only in the core. An earlier version sampled the CLK/DATA levels instead,
  which could skip a live keyboard during its self test.
- **`ps2-flush`** quietly drains the keyboard FIFO and resets the UART RX FIFO
  (`0xF0046` b0), so the ACK/BAT bytes do not appear in front of the prompt.
- The manual `ps2-init` uses the same `ps2-enable`; it now takes ~2.5 s
  instead of ~20 s.

Cost at boot: one 4 KB slice read (`ps2-load`) plus ~2.5 s of settled reset and
enable, ahead of `boot.msg`. It is the earliest place available today; the
boot script itself cannot grow (the image has one word of slack before the
frogger block at `0x4350`). Phase B removes the wait entirely by polling for
the keyboard's answer.

## 3. Phase B — `binit` is the home (implemented)

The sender and the init are now in `asm/forth_nano.asm`, in the free BIOS gap
at `0x5490` (segment offset `0xA90`), and **BIOS function 1 (`binit`)** calls
`ps2_init` before the banner and before the showcase menu. The `ps2host`
slice, `asm/ps2_host.asm`, the Forth words and the `ps2-auto` call are gone;
the kernel dictionary still ends at `dict_free = 0x434F`, so the `0x4350`
gap is untouched.

The block is:

| Entry | Purpose |
|---|---|
| BIOS 7 | `ps2-send`: byte in the caller's `R1`, answer in `R0` (1 = clocked, 0 = no keyboard) |
| BIOS 8 | `ps2-init`: reset + enable, then drain both input queues |
| `ps2_send` | start + 8 data bits LSB first + odd parity + stop; saves R5/R6 in BIOS cells |
| `ps2_init` | reset with retries, wait for ACK/BAT, guard, `0xF4` ×4, flush |
| `ps2_wait_ticks` | waits N high-word cycle-counter ticks (`0xF006A`) |
| `ps2_wait_frame` | waits up to N ticks for the `0xF0066` bit-7 toggle |

`binit` runs as soon as the FPGA is configured, which can be before the
keyboard has finished its own power-on test. The init therefore retries the
reset while `ps2_send` reports no keyboard clock (four attempts, ~0.3 s
apart), and the host request holds CLK low for 400 sender-loop iterations
(>100 µs at 6.75 MHz, with margin). Once a reset is clocked it records the
`0xF0066` bit-7 toggle and waits for ACK then BAT, with a 1 s cap each,
followed by a 0.4 s guard before the four `0xF4`s (0.4 s cap each). A late
keyboard is caught by a retry; a missing one makes the sender time out and the
init returns to the console.

Register safety: the sender saves the kernel's `R5` (`>IN`) and `R6` (`TIB`)
and uses `R12` instead of the shared `SCR`; `ps2_init` saves its own `LR`
because it calls the helpers. The four cells live at `0x5700`–`0x5703` and are
addressed `CS`-relative, so they cost the dictionary nothing. The `0xFFFF`
guard at the top of `ps2_init` keeps the JS core out: it has no PS/2 model and
reads erased memory at `0xF0066`, while the board never drives bits 15:11.

Manual re-init: `cls` runs BIOS function 1, so it repeats the init (and clears
the screen); BIOS function 8 repeats it without clearing. There is no new
Forth word, which keeps the kernel code region below the BDOS at `0x2D4A`.

## 4. If `binit` is needed before the showcase move

One bridge fits the current image: put the host routine in the free kernel
code at `0x2D4A`–`0x2FFF` (694 words, below the `.org 0x3000` data section)
and have BIOS `f1` far-call it with the `R10`/`R11` return pair, like
`call-far`. That avoids growing the BIOS block but is more intricate than
waiting for Phase B and would be thrown away when the BIOS grows. Not chosen.

## 5. Verification

- `npm run sim:ps2` — pin-level receiver/map, no board.
- `npm test` — the JS boot stays green: the `0xFFFF` guard keeps `ps2_init`
  out of the simulator (778/778).
- `npm run lint:board` and `npm test` cover the `frame_valid`/toggle wiring in
  `rtl/ps2_rx.sv` and `rtl/deep16_board.sv`.
- Board: power-cycle with the keyboard connected and do *not* type anything;
  the keyboard's LEDs flash once and typing echoes at the menu/prompt. For the
  negative case, boot with the keyboard disconnected — the sender times out and
  the boot still reaches the menu and the prompt.
- Manual re-init: at the Forth prompt, `cls` (BIOS function 1) runs the same
  init again; BIOS function 8 does it without clearing.
