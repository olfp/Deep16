# SERIALERR — `serial` on the D16D board

Status: **fixed in `screens/flash/edit.fth`** (2026-11-25); hardware re-test
pending.

## Symptom

At the D16D prompt, `serial` printed `serial: error -13` before anything could
be typed, echoed the typed line to the DVI screen but not to the serial
terminal, never echoed the `> ` prompt, and **Ctrl-D on the PS/2 keyboard did
not exit**.

`-13` is the interpreter's "undefined word" code from `evaluate` on the line
`serial` had just read; it was not a UART transport error.

## Root cause

The serial words addressed the I/O segment with the kernel's `es@`/`es!` and
assumed **ES = 0xF000**. That is true at boot, but ES is not preserved across
BIOS and interpreter calls: many routines set it for their own use and leave
it. In the D16D build ES can therefore be something else when `serial` starts.

Consequences:

- `serial-status es@` / `serial-data es!` read and wrote the wrong segment, so
  the UART was never really driven.
- `echo-flag es@ 0x80 or echo-flag es!` set bit 7 somewhere else, so
  `put_char`'s UART mirror stayed off. The D16D build deliberately does not
  mirror in `uart_tx_keep`; the mirror lives in `put_char` and is gated by
  `ECHO_FLAG` bit 7 at `0xF0064`. The screen still echoed because the tile
  write always happens.
- `1 0x46 es!` (the RX flush) wrote 1 into DS instead of the UART control
  register and could corrupt kernel state. That is the likely reason the loop
  stopped responding and the local Ctrl-D was never seen.

## Fix

Set ES explicitly with `seg-base!` before every I/O-segment access. The kernel
has no word that reads ES back, but the Forth-level convention is ES = 0xF000,
so the serial words set it themselves instead of trusting the previous caller:

```forth
: serial-emit ( c -- )
  0xF000 seg-base!
  begin serial-status es@ 2 and until serial-data es! ;
: serial-ready? ( -- f )
  0xF000 seg-base! serial-status es@ 1 and 0<> ;
: serial-key ( -- c )
  0xF000 seg-base!
  begin serial-status es@ 1 and until serial-data es@ 0xff and ;
: mirror-on  ( -- ) 0xF000 seg-base! echo-flag es@ 0x80 or echo-flag es! ;
: mirror-off ( -- ) 0xF000 seg-base! echo-flag es@ 0x7f and echo-flag es! ;
```

An earlier version of this fix used `gfx@`/`gfx!` (BDOS 24/25). Those words are
not in the archived D16MINI kernel that `tests/boot-script.test.js` boots, so
the shared `edit` screen failed to load there; `seg-base!` exists in every
profile and keeps the same guarantee.

`serial` now:

- prints **` ok` after a good line** and the **`ser> ` prompt** after the banner
  and after every line, through the console with mirror bit 7 raised. That is
  the same path the result already uses; direct `serial-emit` prompt writes
  did not reach the terminal on the board (the result did, so the mirror path
  is the reliable one),
- echoes typed characters to the **screen only**: the mirror bit is clear while
  input is read, so `emit` draws the tile console and nothing is mirrored to
  the UART; the line-ending `cr` follows the same rule. The evaluated result,
  ` ok` and the prompt reach both because `serial-eval` raises mirror bit 7
  around `evaluate` and `serial-prompt` does the same for the `ser> ` prompt,
- polls both the UART and the local keyboard (`serial-wait`), so typing and
  **Ctrl-D** work locally,
- does **not** flush the RX FIFO on entry: that discarded typed-ahead input
  (and broke the simulator's xmodem/serial tests, which preload the stream),
- prints a final CR and returns to the interpreter on Ctrl-D.

## Why the simulator missed it

`tests/segmented.test.js` assembles with `CONSOLE_MIRROR`, which makes the
BIOS mirror every console byte to the UART. That hides both the ES bug and the
missing mirror bit: the test sees the typed line in the UART log even though
the board build would not. A regression test needs the **board profile** (no
`CONSOLE_MIRROR`) and should assert the UART echo from the `put_char` mirror.

## Verification

- `npm test`: 997 pass, 0 fail. The serial tests pump past the initial serial
  prompt, then assert the result and the next prompt. They cannot see the
  screen-only echo because the test profile sets `CONSOLE_MIRROR` (every
  console byte reaches the UART there); the board build's `put_char` mirrors
  only when bit 7 is set, which is exactly the input-time state.
- Hardware: the prompt and local Ctrl-D need a slice reflash
  (`npm run flash:slices`, then power-cycle or `s" edit" need`).
- The sprite upper-bank poke is unrelated and works (groups 16..23 render;
  only the sprite palette needs entries 2/13 set for yellow).
