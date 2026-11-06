# PS2PLAN — PS/2 host init at boot, and the move into `binit`

Status: **Phase A implemented and board-verified (2026-11-06); Phase B is the
plan for the BIOS rework.** The receiver, the open-drain host GPIO, the
assembly sender and the boot init all work on a Periboard 409P, and the board
also boots to the prompt with no keyboard attached; see `HARDWARE.md`.

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
| Sender | `asm/ps2_host.asm` | 151 words, type-4 slice `ps2host` (slice 12), loaded to segment `0x4000` |
| Forth | `screens/flash/games.fth` | `ps2-load`, `ps2-send`, `ps2-drain`, `ps2-flush`, `ps2-init`, `ps2-auto` |

The sender is assembly because threaded Forth is far too slow for the PS/2 bit
period: a `\`es!` chain costs about a millisecond per bit against a 60–100 µs
bit, so the keyboard clocked the start bit and then stopped. The block runs at
CPU speed and meets the timing easily.

Frame format both ways: start (0), 8 data bits LSB first, odd parity, stop (1),
one bit per keyboard clock. A host frame is requested by holding CLK low with
DATA high for ≥ 100 µs, then pulling DATA low and releasing CLK; the keyboard
then supplies all 11 clocks.

## 2. Phase A — auto-init at boot (implemented)

`ps2-auto` is the last definition in `screens/flash/games.fth`, and the screen
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

## 3. Phase B — `binit` becomes the home

Target architecture (decided): **Forth, Flappy and Frogger move out of the
bitstream and are loaded at run time; the BIOS stays.** PS/2 init therefore
belongs in **BIOS function 1, `binit`**, which runs before the console banner
and before anything else is loaded.

**Unblocked 2026-11-06:** Flappy and Frogger are flash slices now (BDOS loads
them), so the game block at `0x5400`–`0x57FF` is gone. The menu ends at
`0x540A`, leaving `0x540B`–`0x57FF` (1,013 words) for the BIOS — the sender is
151 words and the init is a few more, so the move below fits today. Forth
still lives in the image and can follow later.

Phase B steps, now that the BIOS can grow into `0x540B`–`0x57FF`:

1. **Move the sender into the BIOS.** `asm/ps2_host.asm` is ~151 words, trivial
   next to the ~2.7K words the showcase frees. Call it from `binit` before the
   console clear: request, `0xFF`, wait for the answer, `0xF4`.
2. **Make the wait deterministic.** Expose the receiver's **last scan code**
   and a sticky **"a valid frame was seen"** bit in the spare `0xF0066` bits
   7–15 (bits 5/6 are the levels). That is one register plus the existing
   scan-code flop — a couple of CLS — and lets `binit` poll for `0xFA`/`0xAA`
   instead of sleeping for a fixed second.
3. **Retire the boot-time software path.** Drop the `ps2host` slice,
   `ps2-load` and the `ps2-auto` call; `binit` has already done the work. Keep
   a manual re-init: BIOS `f7` with a far-call helper, or the small Forth word
   calling it.
4. **Keep `ps2-send` available** for diagnostics (scan-code set 2, typematic,
   LED state) without a slice read.

The runtime-loaded Forth and games then find the keyboard already scanning,
and the boot has no slice dependency on the keyboard.

## 4. If `binit` is needed before the showcase move

One bridge fits the current image: put the host routine in the free kernel
code at `0x2D4A`–`0x2FFF` (694 words, below the `.org 0x3000` data section)
and have BIOS `f1` far-call it with the `R10`/`R11` return pair, like
`call-far`. That avoids growing the BIOS block but is more intricate than
waiting for Phase B and would be thrown away when the BIOS grows. Not chosen.

## 5. Verification

- `npm run sim:ps2` — pin-level receiver/map, no board.
- `npm test` — the JS boot must stay green: the levels guard keeps `ps2-auto`
  out of the simulator (769/769).
- Board: power-cycle with the keyboard connected and do *not* type anything;
  the keyboard LEDs flash once and typing echoes at the prompt. For the
  negative case, boot with the keyboard disconnected — the guarded init must
  still reach the prompt.
