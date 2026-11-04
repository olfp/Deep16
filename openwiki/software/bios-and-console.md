---
type: "Reference"
title: "Console, Terminal and Boot Scripts"
openwiki_generated: true
sources:
  - id: openwiki-source-a28946850ce54d03e71935f2
    resource: repo://asm/forth_nano.asm
  - id: openwiki-source-05b57c87f4341692de6b154c
    resource: repo://asm/forth.asm
  - id: openwiki-source-a8e49bad3e0cb80eca5069d8
    resource: repo://asm/showcase/showcase.asm
  - id: openwiki-source-956d9e1f2f5615b80a8d4ba0
    resource: repo://forth/demo.fth
  - id: openwiki-source-a4cdf03124e6a4fc0fb766f9
    resource: repo://js/deep16_terminal.js
  - id: openwiki-source-0cc31ca306d30bed999278fc
    resource: repo://js/deep16_ui_core.js
  - id: openwiki-source-8eb5da3ff50c8a997cf24572
    resource: repo://js/deep16_ui_screen.js
  - id: openwiki-source-b57ab1606c48ec3ea7344623
    resource: repo://MEMMAP.md
  - id: openwiki-source-de73cd8815fd05f54317660e
    resource: repo://rtl/deep16_top.sv
  - id: openwiki-source-6a76c8a50a08a606b2724b3c
    resource: repo://rtl/deep16_uart.sv
  - id: openwiki-source-2a8f6d13d52eff24d8527d38
    resource: repo://scripts/embed_forth.mjs
  - id: openwiki-source-c14f3342b8ee81b2c622be55
    resource: repo://scripts/make_image.mjs
  - id: openwiki-source-1d8266be33d0b23cd8643d88
    resource: repo://tests/boot-script.test.js
  - id: openwiki-source-1ee9fe7206c3906865d4000d
    resource: repo://tests/console-parity.test.js
  - id: openwiki-source-62679011b2c82f805f23d87e
    resource: repo://tests/terminal.test.js
generated: { by: "opencode", at: "2026-11-04T16:08:29.597Z" }
verified:
  - by: openwiki/0.7.3
    at: 2026-11-04T16:08:29.597Z
---


# Console, Terminal and Boot Scripts

Deep16 has two consoles behind one interface:

- the **screen build** (default) writes character cells into the memory-mapped
  screen at `0xF1000`;
- the **UART build** (`CONSOLE_UART`) writes bytes to the serial port at
  `0xF0040` and lets a host terminal own the display.

The Forth kernel and its BIOS do not change between them. What changes is the
console BIOS below `putch`, which the kernel calls through `SWI`. The D16nano
kernel adds `gfx` as function 6 for the showcase handoff; the flat screen/UART
BIOS stops at function 5.

## The BIOS contract

Every console operation is a system call, not a direct port access. The BIOS
lives at `0xF8000` in the screen build, at `0x5600` in the D16MINI UART image and
at `0x4A00` in the D16nano tile image so the whole machine fits the 24K window.

The calling convention is fixed and is the same in both builds:

- caller puts the **function number in its own `R0`**, parameters in `R1`–`R3`;
- the handler runs in the shadow bank, so it reaches the caller's registers with
  `SMV` (for example `SMV R1, AR0` reads the function code);
- the answer is left in the **handler's `R0`**, which the caller reads back with
  `SMV Rx, AR0`, because `RETI` copies nothing;
- `R0`–`R3` and `R13`/`R14` are banked and survive the call; `R4`, `R7`,
  `R9`–`R12` are scratch; `R8` (`SCR`) is the shared cursor and is expected to
  change.

Dispatch is a six-entry jump table indexed by the function number, with an
explicit out-of-range path. The functions are:

| Code | Name | Meaning |
|---|---|---|
| 0 | `bver` | Return `0x0100` (BIOS 1.0, `major << 8 \| minor`) |
| 1 | `binit` | Initialise the console and clear it |
| 2 | `putch` | Write one character from `R1` |
| 3 | `putstr` | Write the NUL-terminated string at `R1` |
| 4 | `getch` | Wait for and return one key byte |
| 5 | `getstr` | Pump an echoed line into the buffer at `R1` (non-blocking) |
| 6 | `gfx` | D16nano only: run the showcase menu in the BIOS segment |

## The screen build

`binit` sets `ES = 0xF000`, points `SCR` at offset `0x1000` and clears 2,000
cells to space. The buffer is 80 × 25 cells even though only 24 rows are
visible: row 24 is the off-screen staging row for scrolling.

`putch` handles three cases:

- **CR** (`13`) moves `SCR` back to the start of the current row by subtracting
  `(SCR - base) mod 80`;
- **LF** (`10`) advances one row and scrolls at the bottom;
- **anything else** clears the old cursor attribute, stores the character in the
  current cell, advances `SCR`, and — if that crossed into row 24 (`0x1780`) —
  copies rows 1–24 up one row and blanks row 24.

The cursor is not a separate bit. The new cell gets the reversed colour
attribute `0x7000`, built as `LDI 0x0070; SL R0, 8` because a 15-bit signed
`LDI` cannot express `0x7000` directly. Leaving the cell masks the attribute off
with `ATTR_MASK = 0x00FF`, so the character survives and the block disappears.

`putstr` is the cheap path: it copies bytes into consecutive cells and advances
`SCR`, without the cursor bookkeeping. `getch` polls `KBD_STATUS` at `0xF0060`
and pops `KBD_DATA` at `0xF0062`, masking the answer to eight bits.

`getstr` is a **pump**, not a blocking read: one call consumes the keys the FIFO
holds right now, updates the line and returns the caller's `R0 = 1` when CR/LF
completed the line and `0` when it ran out of input. The write pointer and a
line-in-progress flag live in two kernel data cells (`gs_active`, `gs_ptr`) and
are reset at boot, so a warm reset cannot resume a stale line. `read_line`,
`word_accept` and `refill` poll it; because the SWI returns with the caller's
PSW (`I=1`), timer and raster interrupts are served while the console waits.
Inside the handler they could not be: a trap runs with `S=1` and `I=0`.

## The UART build

The `CONSOLE_UART` build keeps the six function numbers and changes only the
transport:

- `binit` emits `ESC[H`, `ESC[2J` and `ESC[3J` — home, erase display, erase
  scrollback. `2J` alone does not move the cursor, which is why `H` is sent
  first; `3J` is ignored by terminals that do not know it.
- `putch` sends the byte as-is. CR, LF and every other control byte are the
  host's business.
- `putstr` walks the string and sends each byte through the same `uart_tx`.
- `getch` waits on status bit 0 (RX ready) at `ES:0x0040`, then reads
  `ES:0x0042`.
- `getstr` is the same pump over the UART: one call drains the bytes the RX FIFO
  holds, updates the line and returns caller `R0 = 1` on CR/LF and `0` when it
  runs out. It uses the same `gs_active`/`gs_ptr` cells and the same polling
  callers. Erasing is the three-byte sequence `BS SP BS` on the wire, because
  the terminal, not the machine, owns the screen.

The UART build cannot keep `getstr` in place below the D16D menu: the BIOS code
ends at `0x4CD5` and the showcase starts at `0x4D34`. The routine lives at
`0x5356`, in the `0x5000`–`0x53FF` ILL/divtest/UART tail that the showcase
reserves but never writes. The BIOS jump table stores a segment offset, so the
move changes no caller. `rtl/sim` and the board both run the same code.

`uart_tx` also maintains the machine's own idea of its output column. It tracks
a three-state ANSI parser (idle, saw `ESC`, inside CSI) and charges **no
columns** for an escape sequence, resetting the column when one starts. Without
that, a cursor-addressed screen would advance the counter mid-sequence and the
hard wrap would fire in the wrong place. `wrap_if` then breaks long lists at a
space before column 80, so the host's autowrap never splits a name.

## Echo policy and its board limitation

The echo flag is a cell at `0xF0064`, beside the keyboard port. Both `getstr`
builds consult it, and the Forth word `echo` writes it. Two constraints matter:

- On the **BSRAM board build**, `0xF0064` is outside the backed memory window by
  design, so a write to it is dropped. The echo flag therefore cannot be turned
  off on the board; it is always on. The IDE's echo toggle still works on the
  simulation cores, where the cell exists.
- The **boot script** therefore cannot use the echo flag to stay quiet. It uses
  a separate `boot_quiet` cell, which `ok_after` checks instead.

## RTL transport versus host rendering

The hardware is a byte pipe. It does not parse ANSI and has no notion of a
screen:

| Layer | Owns |
|---|---|
| Forth kernel | When to print, prompt, ` ok`, error text, `wrap_if` line breaking |
| BIOS | Cursor position, screen cells or UART bytes, line editing, CR/LF |
| RTL UART | 8N1 framing, TX/RX FIFOs, status bits, overrun |
| RTL/board keyboard | PS/2 decode and the 16-entry key FIFO |
| Host terminal | Autowrap, scroll, escape interpretation, colours (none) |
| IDE | Which console mode is active and where input goes |

The UART registers are `0xF0040` (status: b0 RX ready, b1 TX ready, b2 overrun,
b3 TX idle), `0xF0042` (data), `0xF0044` (divisor) and `0xF0046` (control: b0
reset RX, b1 reset TX). FIFOs are 64 bytes in the simulation builds; the current
tile build uses a **one-byte TX holding register** with a 64-byte RX FIFO, and
the older packed-image build was RX-only. The divisor is derived from the clock,
not fixed.

`SerialTerminal` in `js/deep16_terminal.js` is the host side: an 80 × 24 grid
that applies printable ASCII with autowrap, CR, LF with scroll, BS, TAB, CSI `J`
(clear and home) and CSI `H`/`f` (home only). Every other escape — including an
arrow key's `ESC [ A` — is consumed and dropped, so terminal input cannot leak
parser junk onto the screen.

The IDE screen panel can show three consoles. In terminal mode it hands the UART
byte stream to `SerialTerminal`; in screen mode it reads the `0xF1000` buffer
directly; in Tiles mode it paints the FiT canvas. A write to the buffer outside
screen mode is deliberately ignored, because the serial/tile kernels still poke
the cursor cell and those writes used to draw over the terminal or canvas.

## The baked boot script

The D16MINI image carries a Forth program in its data section. It is **not**
loaded over the console: `read_line` reads it once, before it ever looks at the
keyboard.

- The source of truth is `forth/demo.fth`.
- `scripts/embed_forth.mjs` rewrites the block between the `generated from
  forth/demo.fth` markers in both `asm/forth.asm` and `asm/forth_nano.asm`,
  using the assembler's `.string`, which packs two characters per 16-bit cell
  (high byte first) and terminates a line with a zero cell. Packing halves the
  cost; one cell per character cost about 3,610 words.
- `read_line` checks `boot_ptr`. If it is non-zero it unpacks the next line into
  `tib_kbd` (one character per cell, which is what the tokenizer expects) and
  interprets it with the prompt and ` ok` suppressed via `boot_quiet`. An empty
  line ends the script; `boot_done` is set, echo is restored and the prompt is
  stood for the user.
- If `boot_ptr` is zero, `read_line` marks boot done immediately and goes
  straight to the keyboard path.

The script defines `free`, `mem`, `demo` and `ver`, prints the banner summary
(memory map, dictionary range, free count) under `Hello DeepForth!`, and loads
the flash screens (`1 screen`, `5 screen`, `9 screen`). The `9 screen`
`games.fth` defines the game loader; the D16nano `gfx` call runs the showcase
menu from the BIOS segment. On that menu **F** runs Flappy, **G** runs the
image-resident Frogger backdrop, and **P** still needs the flash loader. Because
it is ordinary Forth, the boot script compiles at boot rather than being a
special image format.

## What the tests pin

- `tests/boot-script.test.js` boots the **JS core** and checks that the script
  compiles, prints the summary, and that `free`/`unused`/`mem`/`key?`/`ver`
  behave. The script costs roughly a million steps, so this suite runs it once
  rather than in every console test.
- `tests/console-parity.test.js` boots with `boot_ptr` zeroed and compares the
  **terminal grid and the raw byte stream** across JS, WASM and RTL for the
  banner, a typed line, backspace (`BS SP BS`), an 80-column hard wrap, and the
  `words` listing. Those three cores must produce identical bytes, not merely
  each match its own expectation.
- `tests/terminal.test.js` tests `SerialTerminal` directly as a byte-level state
  machine: printable characters, CR, LF, backspace, `ESC[2J`, unknown escapes,
  scroll and autowrap.

That split matters. The parity test proves the machine's output is
core-independent; the terminal test proves the host interprets exactly the
protocol the BIOS emits, and nothing else.

## Related pages

- [Forth Kernel and Boot Image](forth-kernel.md)
- [Video and Peripherals](../hardware/video-and-peripherals.md)
- [Memory Map and Memory Model](../architecture/memory-map-and-memory-model.md)
- [Core Parity and Verification](../architecture/core-parity.md)
