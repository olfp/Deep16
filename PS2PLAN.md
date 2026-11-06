# PS2PLAN — PS/2 host init at boot, and the move into `binit`

Status: **Phase A implemented (2026-11-06); Phase B is the plan for the BIOS
rework.** The receiver, the open-drain host GPIO and the assembly sender are
board-verified with a Periboard 409P; see `HARDWARE.md`.

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
: ps2-enable ( -- )
  0xFF ps2-send ps2-delay ps2-delay ps2-delay
  0xF4 ps2-send ps2-delay
  0xF4 ps2-send ps2-delay ;

: ps2-auto ( -- )
  ps2-clk@ ps2-data@ and 0= if
    8000 0 do loop
    ps2-clk@ ps2-data@ and 0= if exit then
  then
  ps2-load ps2-enable ps2-flush ;

ps2-auto
```

- **Guard.** Both lines idle high on a live keyboard; the JS core has no PS/2
  model and their levels read 0. A single sample can land inside the
  keyboard's power-on self test, hence the second sample after ~25 ms.
- **Order.** `0xFF` (reset, expects ACK `0xFA` and BAT `0xAA`), three
  `ps2-delay`, then `0xF4` (enable scanning) twice with a delay between them:
  a keyboard still in its power-on self test can swallow the first enable,
  and a repeated enable is harmless.
- **`ps2-flush`** quietly drains the keyboard FIFO and resets the UART RX FIFO
  (`0xF0046` b0), so the ACK/BAT bytes do not appear in front of the prompt.
- The manual words stay: `ps2-init` still prints and drains, so a re-init at
  the prompt is unchanged.

Cost at boot: one 4 KB slice read (`ps2-load`, ~150–200 ms) plus ~0.8 s of
delays, ahead of `boot.msg`. It is the earliest place available today; the
boot script itself cannot grow (the image has one word of slack before the
frogger block at `0x4350`).

## 3. Phase B — `binit` becomes the home

Target architecture (decided): **Forth, Flappy and Frogger move out of the
bitstream and are loaded at run time; the BIOS stays.** PS/2 init therefore
belongs in **BIOS function 1, `binit`**, which runs before the console banner
and before anything else is loaded.

Phase B steps, after the showcase and Forth leave the image and the BIOS can
grow into the freed `0x4D34`–`0x57FF`:

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
