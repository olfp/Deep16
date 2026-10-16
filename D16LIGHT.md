# D16LIGHT — a serial terminal front end for Deep16

> **Status: design. No code.** This document specifies the console that replaces
> the `0xF1000` screen buffer for the FPGA target: a **dumb byte pipe** to a host
> terminal, with the terminal logic split cleanly out of the kernel's BIOS.
>
> Companion documents: [`D16MINI.md`](D16MINI.md) (the BSRAM-only machine this
> console belongs to), [`VERILOG.md`](VERILOG.md) (the three-core RTL),
> [`SERPLAN.md`](SERPLAN.md) (the earlier serial *source loader*, discarded and
> unrelated to this).
>
> Scope of this document: the **console front end** only. Memory, clock, reset,
> constraints, the UART pins and board bring-up live in `D16MINI.md`.

---

## 0. Goal, decisions, non-goals

**Goal.** Replace the memory-mapped text screen with a **serial terminal front
end**: the machine emits bytes to a UART, a host terminal owns the screen, and
the same DeepForth kernel words keep working. No framebuffer is kept anywhere in
the machine.

### Decisions (locked 2026-10-16)

| # | Decision |
|---|---|
| 1 | **Dumb byte pipe.** The host terminal owns the screen, cursor, colours and wrapping. The machine keeps no 80×25 array and no cursor. |
| 2 | **Drop colours.** No attributes, no SGR. The fg/bg nibbles and `CURSOR_ATTR` are gone. |
| 3 | **`form` returns `24 80`** (nominal); `wrap_if` is disabled and the host autowraps. |
| 4 | **Consume-and-drop** terminal escape sequences on input (arrow keys etc. never enter the line buffer). |
| 5 | **Keep the "Datei tippen…" injection** — the browser uploader feeds UART RX in simulation. |
| 6 | **Baud 115200 8N1; TX FIFO 64 deep; RX FIFO 128 deep.** |

**Non-goals.**

- No framebuffer, shadow buffer, or cell-address translation (§10 is the rejected
  alternative).
- No colours/attributes.
- No cursor bookkeeping or scrolling in the machine — the host terminal scrolls.
- No change to the ISA or to the Forth *language*; this is a console swap.

---

## 1. What the "screen buffer front end" is today

The kernel has **no single output chokepoint**, though `README.md` and the
comment above `put_char` claim one. The real coupling, by call site:

**Output**

| Path | Reaches the screen by |
|---|---|
| `word_emit` | BIOS `putch` (f2) |
| `print_text`, `print_prompt` | `put_char` → BIOS f2 |
| `newline_direct`, `word_cr` | BIOS f2 (CR, then LF) |
| `bios_putch_direct`, `bios_putstr_direct` | BIOS f2 / **f3** |
| **BIOS `putstr` (f3)** | **writes `ES:SCR` directly** — the second writer |
| **BIOS `putch` (f2)** | cell write + attribute + cursor + scroll |
| `clear_cursor`, `cursor_off` | `AND ATTR_MASK` on `ES:SCR` |
| `after_print_text` | `SCR` row arithmetic |
| `wrap_if` | column computed from `SCR`, wraps at 80 |
| `word_cls` | BIOS f1 + blanks the top-left cell |
| `word_scr_fetch`, `word_scr_store` | `ES:SCR` |

The live output pointer is the register **`R8` (`SCR`)**.

**Input**

| Path | Reads by |
|---|---|
| `word_key` | BIOS `getch` (f4) |
| `word_accept` | BIOS `getstr` (f5) into `TIB` |
| BIOS `getch` (f4), `getstr` (f5) | poll `KBD_STATUS`/`KBD_DATA` = `0xF0060`/`0xF0062` |
| BIOS `getstr` | also **echoes into the screen** with cursor/backspace handling |

`ECHO_FLAG` (`0xF0064`) gates that echo; `word_echo` sets it.

**The honest boundary is BIOS f0–f5.** The front end must also close the
`ES:SCR` leaks in the helper table of §4.

---

## 2. Architecture

Three layers, split so the FPGA stays trivial and the terminal logic stays
editable:

```
DeepForth ──► console layer (kernel BIOS f0–f5) ──► UART MMIO ──► deep16_uart ──► pins 17/18
     ▲                     │                                                          │
     └─────────────────────┴──────────────  host terminal (VT100)  ◄──────────────────┘
                                             or SerialTerminal model (sim / IDE)
```

- **Hardware** (`rtl/deep16_uart.sv`): a dumb byte pipe. TX/RX FIFOs, baud
  divider. No screen, no cursor, no attributes.
- **Console layer** (kernel BIOS): turns the old cell/attribute/cursor model into
  plain bytes plus a minimal ANSI subset. **This is the front end.**
- **Host terminal**: owns the screen. In simulation, a `SerialTerminal` model
  owns it instead.

Because the host owns the screen, the machine stores **no** terminal state beyond
a byte FIFO. That is the whole point of the design.

---

## 3. Hardware layer

### 3.1 `rtl/deep16_uart.sv` (does not exist today)

No UART exists anywhere in the repo (verified: no `uart`/`serial`/`F0040` in
`rtl/`, `js/`, `wasm/`).

- **TX**: shift register, start/stop bits, a **64-byte FIFO** so `putstr` does
  not stall per character.
- **RX**: **16× oversampler**, centre-sample, start-bit detect, assemble the
  byte, push to a **128-byte FIFO** (the depth the keyboard FIFO already uses,
  `deep16_top.sv:44`); **overrun** flag.
- **Baud**: from the CPU clock. 27 MHz ÷ 115200 = 234.375 → divisor **234**
  (0.16 % error, well inside UART tolerance). Run the CPU at 27 MHz; no PLL.
- **Pins**: FPGA **17 (TX) / 18 (RX)**, bank 2, per the Sipeed/Lushay examples.
  Confirm pins and pin mode against DS117 + the Sipeed pinout before fixing the
  `.cst` — not verifiable on this machine.

### 3.2 MMIO contract

Adopt the address the manual already reserves but **no core implements**
(`doc/Deep16-Prog-Man.md` §7.1: `0xF0040–0xF004F`, "Serial Port"), rather than
inventing one. `ES = 0xF000`, as the BIOS already sets.

| Offset | Name | R/W | Meaning |
|---|---|---|---|
| `0x0040` | `UART_STAT` | R | b0 RX-ready, b1 TX-ready, b2 RX-overrun, b3 TX-idle |
| `0x0042` | `UART_DATA` | R/W | read pops RX; write pushes TX |
| `0x0044` | `UART_DIV` | R/W | baud divisor (frozen 234; register kept for testability) |
| `0x0046` | `UART_CTRL` | W | b0 reset RX FIFO, b1 reset TX FIFO |

This is deliberately the **same shape as the keyboard port** (`0x0060`/`0x0062`):
a status word then a data word, read/written with `LDS`/`STS`. `LD`/`ST` keep
returning the RAM fill value for ports, exactly as today (`0xFxxxx` is
non-cacheable, `deep16_cache.sv:13`).

### 3.3 Integration

- Add the decode beside the keyboard decode in `deep16_core.sv:740-746`, with new
  core ports: `uart_rx_ready`, `uart_rx_data`, `uart_tx_we`, `uart_tx_data`.
- Mirror the identical port in the **JS and WASM cores** for parity and to let the
  whole thing be built and tested before hardware.
- The keyboard ports (`0xF0060`/`0xF0062`) stay decoded but are **dead on the
  board**; the UART replaces the keyboard as well as the screen. Keep them harmless
  and wired to nothing, or drop them in the D16MINI build.

---

## 4. Software layer — the console BIOS

### 4.1 BIOS functions: same numbers, same calling convention

`DS:[0] = fn`, `DS:[1] = arg` — unchanged, so `put_char`, `print_text`, `emit`,
`key`, `accept`, the prompt and the interpreter are **not touched**.

| BIOS | Today (screen) | D16LIGHT (serial) |
|---|---|---|
| f0 `bver` | `R0 = 1` | unchanged |
| f1 `binit` | clear 2000 cells, home cursor | **emit `ESC[2J`**; host homes |
| f2 `putch` | cell write + attribute + cursor + scroll | **TX one byte** |
| f3 `putstr` | direct `ES:SCR` cell writes | **TX loop** |
| f4 `getch` | poll keyboard | **poll `UART_STAT.b0`, read `UART_DATA`** |
| f5 `getstr` | keyboard + screen echo + cursor/BS | **RX line + TX echo + `BS SP BS`** |

f5 keeps its current shape — accumulate into `TIB`, end on CR **or** LF, refuse
past `TIB_LIMIT`, NUL-terminate — with only the source and the erase changed:
source `0x0060/0x0062` → `0x0040/0x0042`; erase `ES:SCR` manipulation →
`BS SP BS` on the wire. `ECHO_FLAG` keeps its meaning (the host should have local
echo **off**).

### 4.2 Kernel helpers to neutralise

| Helper | Today | D16LIGHT |
|---|---|---|
| `put_char`, `print_text`, `print_prompt` | BIOS f2 | unchanged (still f2) |
| `newline_direct`, `word_cr` | f2 CR then f2 LF | unchanged (bytes are bytes) |
| `clear_cursor`, `cursor_off` | `AND ATTR_MASK` on `ES:SCR` | **no-op** |
| `after_print_text` | `SCR` row math → next line | **emit CR+LF** (keeps the banner on its own line) |
| `wrap_if` | column from `SCR`, wrap at 80 | **no-op** (`JMP LR`) — host autowraps |
| `word_cls` | f1 + blank top-left cell | **f1 only** |
| `word_scr_fetch`, `word_scr_store` | `ES:SCR` | **removed** (screen-only) |
| `form` | `24 80` | **`24 80`** (nominal; decision 3) |

Consequences:

- **`R8` (`SCR`) becomes a free register** — nothing needs a live screen pointer.
- `scr@`/`scr!` and colour attributes are gone; full-screen programs (`hanoi`,
  `snake`) do not run here — already carved out in `README.md:125`.
- The keyboard FIFO's role is now the UART **RX FIFO**.

### 4.3 Where the code lives

The console BIOS and the helpers above are guarded by a conditional build (§6).
The **screen BIOS stays exactly as it is** for the emulator/IDE build; the UART
BIOS is the `CONSOLE_UART` branch. Both share the same file
(`asm/forth.asm`) and the same function numbers.

---

## 5. Protocol

The minimal VT100 subset — enough for a REPL, nothing more.

**Emitted by the machine**

| Bytes | Meaning |
|---|---|
| printable ASCII | the character |
| `CR` `LF` (0x0D 0x0A) | end of line — a terminal renders it correctly |
| `BS SP BS` (0x08 0x20 0x08) | erase the previous character (backspace) |
| `ESC[2J` | clear screen (`binit` / `cls`) |

**Accepted by the machine**

| Input | Action |
|---|---|
| printable ASCII | store + echo |
| `CR` or `LF` | end line (the existing `bios_getstr` rule) |
| `BS` (0x08) or `DEL` (0x7F) | erase one char (rewind buffer, `BS SP BS`) |
| `ESC …` sequence | **consumed and dropped** (decision 4) — arrows, function keys |
| everything else | ignored |

Optional later, not in this design: `Ctrl-C` = break; `ESC[A`/`ESC[B` = command
history.

---

## 6. Build switch

One source, two builds. Add **conditional assembly** to
`js/deep16_assembler.js` — it has only `.org`/`.word`/`.text`/`.equ` today:

```
.if CONSOLE_UART
    ; UART BIOS f0–f5, neutralised helpers (§4)
.else
    ; the existing screen BIOS and helpers, unchanged
.endif
```

`CONSOLE_UART` selects the build. The screen path is compiled byte-for-byte as
today, so the emulator, the IDE and `tests/forth.test.js` keep working. This is
the mechanism `D16MINI.md` §7.3 calls for; the console is its first user.

If adding conditionals is deferred, the fallback is a delimited-region
substitution in the build script — but the assembler feature is small, reusable,
and also serves the book.

---

## 7. Simulation / IDE front end

This is what makes the design buildable **now**, before a board.

- **`SerialTerminal` model** (in `tests/helpers.js`): captures the TX byte stream,
  feeds RX, and parses the §5 subset back into an 80×25 view.
- **IDE Screen tab** renders the `SerialTerminal` for the UART build instead of
  reading `mem[0xF1000]`. The visual experience survives with no framebuffer.
- **Input injection (decision 5):** the existing "Datei tippen…" uploader
  (`fileToKeys` → key pump) feeds **UART RX** in the UART build, exactly as it
  feeds the keyboard FIFO in the screen build. The 128-entry RX FIFO is the same
  depth, so the pump's flow control still applies.
- `sim.enqueueKeyCode` (the IDE keyboard) also maps to UART RX.

---

## 8. Verification

| # | Test | Gate |
|---|---|---|
| 1 | Byte-exact boot: banner, `>`, prompt | matches the expected stream |
| 2 | Evaluated line: `3 4 + .` | `3 4 + . 7  ok\r\n> ` |
| 3 | Line editing: type, `BS`, type, `CR` | buffer correct, wire shows `BS SP BS` |
| 4 | Escape handling: `ESC[A` mid-line | dropped, buffer unchanged |
| 5 | Clear: `cls` | wire contains `ESC[2J` |
| 6 | **Three-core parity** | identical byte stream on JS, WASM, RTL |
| 7 | **Guard: no framebuffer writes** | the UART build stores nothing into `0xF1000–0xF17CF` |
| 8 | Injection: upload a source file | arrives via UART RX, definitions run |

Test 7 is the mechanism that pins the two output paths (§1) closed — the thing
the "one chokepoint" comment only asserted.

`README.md:74` lists `tests/serial-port.test.js`, which **does not exist**. The
new test file is `tests/serial-console.test.js`; the README entry is stale and
should be corrected when the test lands.

---

## 9. The rejected alternative (kept for the record)

A **zero-kernel-change adapter**: keep `0xF1000` decoded to a shadow 2000-cell
buffer (not RAM), watch cell writes, and emit `ESC[row;colH` + char derived from
the address. The kernel stays byte-for-byte unchanged.

Rejected because it **keeps a screen buffer** (the thing we are removing), needs
row/col decode, produces verbose cursor positioning, and merely relocates the
attribute problem. Decision 1 chose the dumb pipe instead.

---

## 10. Phases

| Phase | Work | Hardware? |
|---|---|---|
| **1** | MMIO contract; UART model in JS + WASM; console BIOS behind `CONSOLE_UART`; `SerialTerminal`; tests 1–8. | no |
| **2** | Verilator UART model in the harness; three-core byte parity. | no |
| **3** | Real `deep16_uart.sv`; core MMIO ports; board top, `.cst`. | no |
| **4** | Terminal bring-up: picocom/minicom @ 115200, type at the `>` prompt. | **yes** |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| A third `ES:SCR` writer is missed (the "one chokepoint" claim was already false) | test 7; grep-gate on `0xF1000` stores |
| `after_print_text` left as SCR math → prompt glued to the banner | explicit CR+LF in §4.2 |
| Host local echo left on → doubled input | document host setup; terminal initiation banner |
| RX byte loss between polls (input is polled, as the keyboard is) | 128-byte RX FIFO; injection test 8 mirrors the existing FIFO-brake test |
| Escape sequences leak into the line buffer | consume-and-drop state in f5 (§5), test 4 |
| `README.md` serial-test entry is already stale | correct it when `tests/serial-console.test.js` lands |

---

## 12. Resolved questions

All six decisions are recorded in §0. No open console questions remain; the
memory/boot/constraint items that remain open belong to `D16MINI.md`.
