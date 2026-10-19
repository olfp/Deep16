# D16MINI — a BRAM-only Deep16 with a serial console

> **Status: the machine runs.** The console, the memory interface, the board top,
> the constraints and the boot image are all in the tree, and the board build
> boots DeepForth on Verilator and prints the banner over the UART *pins*
> (`npm run sim:board`). What is left is Gowin synthesis and the real board —
> everything that needs hardware. D16MINI is a *small* Deep16 that actually
> fits the Tang Nano 9K and boots DeepForth: **no PSRAM, no cache, no
> framebuffer** — memory is on-chip BSRAM, the console is a UART, and a host
> terminal owns the screen.
>
> This document unifies the earlier *D16MINI* (the machine) and *D16LIGHT* (the
> serial front end) drafts into one.
>
> Companion documents: [`PLANPSRAM.md`](PLANPSRAM.md) (the full 1 MB machine this
> deliberately is *not*), [`VERILOG.md`](VERILOG.md) (the current three-core RTL),
> [`SERPLAN.md`](SERPLAN.md) (the discarded serial *source loader* — unrelated to
> the console here), [`FLASHPLAN.md`](FLASHPLAN.md) (blocks-on-flash, out of
> scope).
>
> Baseline measured 2026-10-16 against the working tree (`asm/forth.asm` @ 12,622
> lines).

---

## 0. Goal, decisions, non-goals

**Goal.** A synthesizable Deep16 that boots DeepForth and talks over a UART,
using **nothing but the 468 Kbit of BSRAM** for main memory and **no external
memory controller**. The smallest machine that is still DeepForth, with the
screen replaced by a serial terminal.

### Decisions

**Machine**

| # | Decision |
|---|---|
| M1 | BRAM-only: no PSRAM, no SDRAM controller, no `mem_stall` machinery. |
| M2 | **No cache** — the memory is small and near-single-cycle. |
| M3 | **No framebuffer** — `0xF1000` is deleted, not emulated. |
| M4 | No 1 MB address space: ~26 K words, a 15-bit machine. |
| M5 | Relocate the stacks and the BIOS into the low RAM window. |
| M6 | Boot ROM stays a 16-word LUT ROM at `0xFFFF0` (identical reset). |
| M7 | One kernel source, two builds, selected by conditional assembly. |

**Console** (locked 2026-10-16)

| # | Decision |
|---|---|
| C1 | **Dumb byte pipe.** The host terminal owns the screen, cursor and wrapping. The machine keeps no 80×25 array and no cursor. |
| C2 | **Drop colours.** No attributes, no SGR; `CURSOR_ATTR` is gone. |
| C3 | **`form` returns `24 80`** (nominal); `wrap_if` is disabled; the host autowraps. |
| C4 | **Consume-and-drop** terminal escape sequences on input (arrow keys never enter the line buffer). |
| C5 | **Keep the "Datei tippen…" injection** — the browser uploader feeds UART RX in simulation. |
| C6 | **Baud 115200 8N1; TX FIFO 64 deep; RX FIFO 128 deep.** |

**Non-goals.**

- No PSRAM, cache, or memory controller.
- No framebuffer, shadow buffer, or cell-address translation (§7.8 is the
  rejected alternative).
- No colours/attributes; no cursor or scroll bookkeeping in the machine.
- No block store (`FLASHPLAN.md`), no graphics (`GFX.md`), no speed target.
- No ISA change, and no change to the Forth *language* — the console is a swap.

**The one sentence.** DeepForth's kernel image plus a working dictionary fits in
BSRAM; give it a UART and a BSRAM, drop everything else.

---

## 1. Board facts (GW1NR-LV9QN88PC6/I5, Tang Nano 9K)

| Resource | Value | Note |
|---|---|---|
| LUT4 / FF | 8,640 / 6,480 | core needs ≈4,300 LUT / ≈2,100 FF today (`STATUS.md`) |
| **BSRAM** | **468 Kbit = 26 × 18 Kbit** | the entire RAM budget |
| DSP | 20 × 18×18 | `MUL` |
| PLL | 2 | not needed if the CPU runs at 27 MHz |
| Crystal | 27 MHz | clk source |
| On-board USB-UART | via the BL61x debugger, **FPGA pins 17 (TX) / 18 (RX)**, bank 2 | 115200 8N1 in Sipeed examples |
| PSRAM | 64 Mbit | **unused** |

> The UART pin numbers and pin mode (single/dual-purpose) must be confirmed
> against the Sipeed pinout / DS117 and frozen in the `.cst`. They are stated
> from the Sipeed/Lushay examples, not verified on this machine.

---

## 2. Memory budget: the number that decides everything

| | Words (16-bit) | Bytes | Addresses |
|---|---:|---:|---|
| **BSRAM, repo convention** (26 blocks × 1024 × 16) | **26,624** | 52 KiB | `0x0000–0x67FF` |
| BSRAM, theoretical (468 Kbit ÷ 16, width waste ignored) | 29,952 | 58.5 KiB | `0x0000–0x74FF` |
| Deep16 ISA map | 1,048,576 | 2 MiB | `0x00000–0xFFFFF` |

26,624 words is **2.5 %** of the ISA map. Deep16 effectively becomes a **15-bit
machine**: the whole RAM window fits inside a single 32 K-word (15-bit) address.

### What DeepForth needs of it (measured, this tree)

| Item | Extent | Words |
|---|---|---:|
| Kernel image `forth_start`…`dict_free` (`0x0100–0x3BA7`) | 13,150-line source | **15,016** |
| `dict_free` (new definitions grow up from here) | `0x3BA8` | — |
| Headroom `dict_free` → BIOS (`0x5F00`) | `0x3BA8–0x5EFF` | **9,048** |
| BIOS (UART build, relocated) | `0x5F00`, 212 words | §3 |
| Screen buffer | `0xF1000`, 2000 words | **deleted** |

The image grows a little with every Tier-3 word added (it was `0x3A62` three
commits ago); treat `dict_free` as a moving target and leave slack.

### The verdict

- The kernel **fits** with ~9 K words of dictionary to spare — comfortable.
- **The fixed addresses had to move**: the stacks (`SP = 0x7FF0`, `RSTACK_TOP =
  0x6F00`) and the BIOS at `0xF8000` all sat above `0x6800`. §3 relocates them —
  done, and green.
- The framebuffer is deleted, so the 2 BSRAM blocks a screen would cost are not
  spent.

---

## 3. Memory map — decided (M5)

Everything the CPU executes or reads lives in **one low window**, so the core has
a single `pa < RAM_WORDS` test and no high-address ROM decode.

```
0x00000 - 0x067FF   RAM       26 BSRAM blocks (26,624 words)
   0x00100 - 0x03BA7   kernel image (code + data + built-in words)
   0x03BA8 - 0x05EFF   user dictionary  (grows up, ~9.0 K words)
   0x05F00 - 0x05FD3   BIOS (212 words, UART build; segment 0x05F0)
   0x06000 - 0x067FF   stacks          (return 0x6000↑, data 0x67F0↓)
0x0F0000 - 0x0F006F   MMIO       UART (the kernel's echo cell at 0xF0064
                                 is not backed: §6.4)
0x0FFFF0 - 0x0FFFFF   boot ROM   16 words, LUT ROM (reset vector lives here)
```

Measured 2026-10-19 from the working tree. The kernel and dictionary addresses
drift as words are added; the BIOS and stack bases are fixed.

**Decided — was M5.** Relocate the BIOS and both stacks into the window, in the
`CONSOLE_UART` build only. The screen build keeps its 1 MB layout (BIOS at
`0xF8000`, stacks `0x6F00` / `0x7FF0`) and stays **byte-identical**.

- **BIOS** — `.org 0x5F00`, 212 words, segment `0x05F0`. The code is
  base-independent: every internal jump is a `label - BIOS_BASE` delta or a
  relative branch, so only the `.org` and `swi_to_bios`'s segment change.
- **Stacks** — `RSTACK_TOP = 0x6000`; the data stack top is `0x67F0`, loaded from
  a cell, because `0x67F0` has bit 14 set and `LDI` would sign-extend it to
  `0xE7F0` — the trap the kernel already documents for `RSTACK_TOP`.
- Both builds changed again with the register calling convention (§7.3): the
  screen build is no longer byte-identical to what it was. `node
  scripts/make_image.mjs` prints the current image's `build` hash.

Alternative kept for the record: leave the BIOS at `0xF8000` with its own LUT-ROM
decode, teaching the core that `0xF8000` is fetchable while `0x6800…0xF7FFF` is
not. More core plumbing for less kernel churn; rejected for a *mini* machine.

The boot ROM stays at `0xFFFF0` (the core's reset state is `CS=0xFFFF, PC=0`), so
reset behaviour stays identical with the three emulators. 16 words of LUT ROM.

---

## 4. RTL work

### 4.1 Memory: array → BSRAM

`rtl/deep16_top.sv:41` is `reg [15:0] mem [0:MEM_WORDS-1]` — **16.8 Mbit**, 35×
the whole chip. It must go.

- Instantiate/infer **26 blocks at 1024×16**, true dual port: **port A =
  instruction fetch, port B = data read + write**.
- Delete `deep16_cache.sv` from this build. That removes the **8 combinational
  refill reads** (`deep16_top.sv:163-164`) which are the reason the port count is
  11 today.
- Turn the SWI vector into a **register** fed by the write path (the `mem[2]`
  read, `deep16_top.sv:160`, is a wasted port) — `PLANPSRAM.md` §1 recommends
  this and it applies here too.

**Done — differently, and better.** The vector is now read through the **data
port**, like a load into R15: the SWI issues address `0x0002` in its MEM cycle,
the word lands in WB, `pc_from_port` makes the fetch take the redirect from
there, and the WB write patches the shadow PC (and the event's `spc`). No
register, no shadow, no host-write path — the vector stays ordinary RAM and a
`poke(2)` still installs a handler. That removes the asynchronous `mem[2]` read,
so the array is strictly two-port — one *shared* read (fetch or a load) and one
write, which is what makes it fit (§4.6). The
`deep16_core.sv` comments had described this all along (and the `is_swi` bit in
the MEM bundle — "the vector word is patched in from MEM" — had been carried,
unread, waiting for it).

Making it work needed two fetch fixes, both of which the LD-R15 path had needed
too and neither of which had a test: the fetch must not take the still-stale
target in EX (`if_redirect`), and nothing may enter the pipe while the read is
in flight (`pc_pending`) — a halt word directly behind an `SWI` used to stop the
machine before the handler ran. `tests/rtl.test.js` now covers both redirects.

**Done.** `mem` is now `RAM_WORDS` words: 26,624 behind `` `ifdef D16MINI ``
(the board build), the 1 MB array otherwise (simulation). One read decode
(`mem_at`) serves both: RAM, then the 16-word boot ROM, then the `0xFFFF` fill — so an address the board cannot back halts the machine
instead of fetching garbage. The explicit-primitive fallback below stays the
fallback; whether Gowin infers 26 BSRAM blocks *and* honours the init is still
unconfirmed.

### 4.2 The real difficulty: registered reads

The core reads memory **combinationally in the same cycle it presents the
address**:

- IF fetch: `if_rdata` from `if_addr` (`deep16_top.sv:156-158`), consumed same cycle.
- Data load: `mem_addr` is driven from `ex_mem` (`deep16_core.sv:1066`) and
  `mem_rdata` is latched in the same cycle (`deep16_core.sv:1048-1049`).

**Gowin BSRAM read data is registered (one clock later).** So even BRAM-only
needs the interface change `PLANPSRAM.md` §A calls "memory interface honesty":

- Drive the data-read BSRAM address from **EX** (the address is known there), so
  the registered output lands in **MEM** where it is consumed. The load-use stall
  and the MEM→WB capture stay as they are.
- Give the fetch its own address/return path (the BRAM output register becomes
  effectively the IF/ID fetch latch, or a 1-cycle fetch is added). Same shape as
  the PSRAM plan, but at **latency 1** — no stall machinery, no SWI-in-flight
  logic, no write buffer.
- Keep `MEM_WORDS`/`RAM_WORDS` as the decode bound; the core's halt test
  (`deep16_core.sv:994`, `:669`) must use the RAM bound, not 1,048,576.

> This is the central risk. It is *not* "drop in a BSRAM"; it is the same class of
> change as the PSRAM move, minus the controller and minus the bus turnaround.

### 4.3 Strip the simulation scaffolding

- The **debug bus** (`dbg_*`, the 256-entry mux) is Verilator/IDE plumbing;
  `STATUS.md` §4 puts it at 800–1,200 LUT. Put it behind `` `ifdef `` and drop it
  from the board build.
- `i_step` / `i_free` are a single-step handshake. On hardware tie **`i_step=1`,
  `i_free=1`** (free-run) and reset, or add a trivial start bit. No test harness
  reads `o_done` on the board.

**Done.** The board ties `i_step=1`, `i_free=1`; the monitor FIFO the IDE drains
is behind `` `ifndef D16MINI `` and is not built for the board; and the whole
**debug bus** is behind `` `ifndef D16MINI `` — the 256-entry read mux, the
state-seeding write block, the register file's debug port (tied off, so its logic
is dead) and the `dbg_rdata` answer. The board build's core is ~25 % smaller for
it. The event log, the recent-access record and the keyboard depth are read only
through that bus, so on the board they are dead registers the synthesizer prunes;
Verilator notes it, and the board build carries a scoped lint suppression for
exactly those signals rather than for the file.

**The free-run tie-off found a real bug.** The EX-side strobes (`kbd_pop`,
`uart_tx_we`, `uart_rx_take`, `uart_ctrl_we`) were qualified by `!step_done`.
`step_done` is the *retirement* event, and in free-run the machine retires on
almost every clock, so the console was mute on the board while every `step()`
based test stayed green (in single-step, `step_done` is high for one cycle per
step and the strobes happen to fire on another). The freeze the gate meant is
`step_done && !i_free` — the pipeline only holds its stage on the retiring edge
*in step mode*. `deep16_core.sv` now names that `step_freeze` and gates on it;
`tests/rtl-uart.test.js` runs the kernel in free-run so the regression cannot
come back.

### 4.4 UART peripheral

There is **no UART anywhere in the repo** (verified: no `uart`/`serial`/`F0040`
in `js/`, `wasm/`, or `rtl/`). New module `rtl/deep16_uart.sv`:

- **TX**: shift register, start/stop bits, a **64-byte FIFO** so `putstr` does
  not stall per character.
- **RX**: **16× oversampler**, centre-sample, start-bit detect, assemble the
  byte, push to a **128-byte FIFO** (the depth the keyboard FIFO already uses,
  `deep16_top.sv:44`); **overrun** flag.
- **Baud**: 27 MHz ÷ 115200 = 234.375 → divisor **234** (0.16 % error, well
  inside UART tolerance). Run the CPU at 27 MHz; no PLL.
- **Pins**: FPGA **17 (TX) / 18 (RX)**, bank 2 (confirm before the `.cst`).

Integration:

- Add the decode beside the keyboard decode in `deep16_core.sv:740-746`, with new
  core ports: `uart_rx_ready`, `uart_rx_data`, `uart_tx_we`, `uart_tx_data`.
- Mirror the identical port in the **JS and WASM cores** for parity and to let the
  whole thing be built and tested before hardware.

**Done** — `rtl/deep16_uart.sv` is in, with those depths and the divisor 234, and
all three cores decode `0xF0040`/`0xF0042`. The transmit pin is covered by `npm run sim:board`;
the **receive pin** — start-bit detect, oversampling, centre sampling — exists
nowhere else, so it is covered there too, by typing a line into `uart_rxd` and
checking the echo and the evaluation.

### 4.5 Board top, clock, reset, constraints

Nothing board-shaped exists today.

- `rtl/deep16_board.sv`: 27 MHz `clk` in, reset button, optional LED heartbeat,
  UART RX/TX, and the D16MINI `deep16_top`.
- Clock: run the CPU at **27 MHz directly** (no PLL needed for Forth over UART).
- Reset synchroniser.
- A **`.cst`** pin-constraint file: clock, reset/button, LED, UART pins 17/18.
  None exists in the repo.
- The **boot image** — a BSRAM init so the assembled kernel is running at
  power-up (§6).

**Done.** `rtl/deep16_board.sv` (reset synchroniser, free-run tie-offs, UART pins,
LED heartbeat), `rtl/deep16_board.cst` (pins 52 / 4 / 17 / 18 / 10),
`rtl/deep16_board.sdc` (the 27 MHz clock, the async button and RX pin), and the
`$readmemh` init in `deep16_top` behind `` `ifdef D16MINI ``. `npm run lint:board`
lints the board build and `npm run sim:board` runs it on Verilator with the real
image and reads the UART pin.

**Every pin is a documented value, not a measured one** (no board here): confirm
the set against the Sipeed pinout and the schematic before Phase 4. The UART pair
decides whether the console works at all.

### 4.6 The open-source synthesis — measured (2026-10-19)

The board build was taken through the license-free flow — Yosys `read_slang` →
`synth_gowin` → nextpnr-himbaechel (Apicula) → `gowin_pack`, the OSS CAD Suite —
rather than the vendor tools. `npm run synth:board` is that flow. Three results,
one of them decisive.

**The boot image survives into the BSRAM.** The memory is inferred as 26 blocks'
worth of `DPX9B` (the Gowin block primitive) with **64 `INIT_RAM_xx` parameters
per block, 42 of the 52 block-halves carrying non-fill content** — the kernel,
baked in exactly as §6.2.1 claims. The plan's central bet holds: no loader, no
copy, the configuration *is* the load.

**Two portability fixes were needed to get there**, both of which make the RTL
better rather than merely Yosys-shaped:

- **Declarations before use.** slang rejects `div_req`/`div_done`/`div_busy` and
  `step_freeze` being used before they are declared. Verilator tolerates it; the
  declarations now sit where they belong.
- **The RAM read must be unconditional.** With the decode folded into the read —
  `(a < RAM_WORDS) ? mem[a] : fill` — the flow stops recognising the array as
  block RAM and falls back to LUT RAM: **13,320 `RAM16SDP4` and ~69,000 LUTs**,
  eight times the chip. Reading `mem[]` first and muxing the ROM and the fill
  *behind* the read register keeps it a plain two-port RAM (4,824 LUT4s). That is
  why `non_ram()` sits where it does in `deep16_top.sv`.

**Two reads do not fit.** nextpnr could not place it:

```
LUT4:   10508/   8640   121%
BSRAM:      52/     26   200%
ERROR: Unable to place cell 'u_top.mem.0.9',
       no BELs remaining to implement cell type 'DP'
```

The BSRAM number is not a width or depth artifact — it is the **port count**. The
memory was read twice and written once per cycle (instruction fetch, data read,
store), and a Gowin BSRAM block has **two ports**. Measured on minimal cases at
the real geometry (26,624 × 16, fully initialised):

| memory | BSRAM blocks |
|---|---|
| 1 read + 1 write | **26** — fits exactly |
| 2 reads + 1 write | **52** — does not fit |

Yosys does not share a port between a read and a write; it *duplicates* the array,
one copy per read port, and the chip has half the blocks that needs. The plan's
§4.1 assumption — "port A = instruction fetch, port B = data read + write" — is
therefore not something the tool does for you.

**Fixed: one read port, shared.** A load's data read takes the read port and the
instruction fetch yields that cycle — `if_preempted` turns the preempt into a
fetch bubble, which is a one-cycle stall per load. The store keeps the second port
(the write), so a store and a load never share one and no write buffer is needed.
Measured again:

```
BSRAM:      26/     26   100%      <- exactly the chip
LUT4:   10245/   8640   118%
```

The stall is cheap: `npm run sim:board` went from 97,868 to 98,432 clocks, +0.6 %.
The design now fits BSRAM **exactly**, which is the number that decided the plan.

**And it exposed a real bug.** The same work found that a **load one instruction
behind a store to the same address read the old word**: the store commits in WB
and the array write lands a cycle after the load's read. Stepped runs never see it
(the store has retired before the load executes), so it survived the entire test
suite — free-run, the board's mode, showed it immediately (0xFFFF where the JS
core gives 0x1234). The read result is now bypassed from the store, applied
*behind* the read register so the RAM read stays unconditional. There is a
free-run regression test for it in `tests/rtl.test.js`.

**Still open.** The logic is over budget by a fifth (10,245 LUT4 against 8,640),
which is the kind of margin a commercial synthesizer usually closes — unverified.
nextpnr reports a **combinational loop** through the UART strobes (`uart_tx_we`
and friends) and refuses to time the design; Verilator lints clean, so it is
probably a mapping artifact, but with the design over-utilised the flow does not
complete, so **no Fmax has been measured**. The run needs `--vopt family=GW1N-9`;
without it nextpnr refuses the device.

---

## 5. MMIO contract

The manual already reserves a UART at `0xF0040–0xF004F`
(`doc/Deep16-Prog-Man.md` §7.1) and even shows `serial_putc` — but **no core
implements it**. Adopt that address instead of inventing one. `ES = 0xF000`, as
the BIOS already sets.

| Offset | Name | R/W | Meaning |
|---|---|---|---|
| `0x0040` | `UART_STAT` | R | b0 RX-ready, b1 TX-ready, b2 RX-overrun, b3 TX-idle |
| `0x0042` | `UART_DATA` | R/W | read pops RX; write pushes TX |
| `0x0044` | `UART_DIV` | R/W | baud divisor (frozen 234; register kept for testability) |
| `0x0046` | `UART_CTRL` | W | b0 reset RX FIFO, b1 reset TX FIFO |

This is deliberately the **same shape as the keyboard port** (`0x0060`/`0x0062`):
a status word then a data word, via `LDS`/`STS`. `LD`/`ST` keep returning the RAM
fill value for ports, exactly as today (`0xFxxxx` is non-cacheable,
`deep16_cache.sv:13`).

The keyboard ports (`0xF0060`/`0xF0062`) stay decoded but are **dead on the
board** — the UART replaces the keyboard as well as the screen.

---

## 6. Boot and loading — the boot image

The kernel image must be in BSRAM when the FPGA configures. The board has no
loader and no mass storage (§11.D), so the image is **baked into the bitstream**:
one BSRAM init, applied at configuration, and the machine is running DeepForth the
moment the FPGA comes up. No host, no boot sequence.

### 6.1 What the image contains

| Region | Addresses | In the image? |
|---|---|---|
| Kernel (UART build) | `0x0100–0x3B03` | yes — the assembled words |
| BIOS (relocated, §3) | `0x5F00` | yes |
| SWI vector | `0x0002` | no: the kernel installs it at run time |
| Dictionary, stacks | above `dict_free` | no: run-time RAM, filled `0xFFFF` |
| Screen | `0xF1000` | deleted (C1) |
| MMIO (UART) | `0xF0040–0xF0046` | no: registers (§5); `0xF0064` is not backed (§6.4) |
| Boot ROM | `0xFFFF0` | no: 16 words in LUTs (§6.3) |

**The fill value is `0xFFFF`, everywhere.** BSRAM init leaves unspecified words at
`0x0000`, which is `LDI 0` — the machine would *run forever* instead of halting.
The simulation fills all of RAM with `0xFFFF` (the halt word), so the image must
too: every unused word of all 26 blocks, not just the gap around the kernel. This
is the one detail that silently changes behaviour if it is missed.

### 6.2 How the RAM is built, and how it is initialised

The memory is the 26-block synchronous BSRAM of §4.1. Two ways to get the image
into it; the plan takes the first:

- **One SV array, two init files (chosen).** Keep the single `reg [15:0] mem
  [...]` in `deep16_top.sv`, and give it a `$readmemh` init for Verilator and an
  `INIT_FILE` / `.mi` for Gowin. One source, no second memory model to keep in
  step. The open risk is inference — whether Gowin infers 26 BSRAM blocks *and*
  honours the init — which can only be confirmed on the first synthesis (there is
  no toolchain here).
- **Explicit Gowin primitives** (`DPB`/`SDPB`, 26 instantiations, per-block
  `INIT_FILE`). Deterministic and reviewable, at the cost of a hand-written memory
  behind `` `ifdef SYNTHESIS ``. The fallback if inference misbehaves.

The generator emits the image in **both** formats from one set of words, so
Verilator and the board see the same memory.

**Done — and measured.** The array is `RAM_WORDS` words behind `` `ifdef D16MINI ``
and its `initial` does `$readmemh("image.hex", mem)`. The open-source flow infers
it as Gowin BSRAM blocks with the image in their `INIT_RAM_xx` parameters
(§4.6), so the init is not the risk it was thought to be — the *port count* is.
The explicit-primitive fallback stays the fallback, and the `.mi` is emitted and
waiting for the EDK. Note also that the RAM read has to be unconditional for the
inference to happen at all (§4.6).

### 6.2.1 The flash never sees a copy

There is **no runtime copy from flash to RAM, and no loader.** The `.mi` /
`$readmemh` is a *synthesis input*: Gowin EDK bakes the BSRAM initial contents
into the **bitstream** as configuration data. That bitstream sits in the config
SPI flash (`FLASHPLAN.md` §1, its region reserved in §2) — the boot image rides
inside it and needs no region of its own — and the FPGA's configuration
controller loads it at power-up. When configuration completes the 26 blocks
already hold the kernel, and the CPU starts on `forth_start`. "Flash → RAM" *is*
the configuration, done before the first clock the CPU sees.

The init data is bitstream payload: the full window at `0xFFFF` is ~52 KB against
a ~1–2 MB GW1NR-9 bitstream, a few percent — which is why the "fill everything"
of §6.1 is cheap rather than expensive.

A *copy* appears only in the two deferred alternatives: the UART loader (§6.6),
or a flash-resident image read back over MSPI by a ROM loader (`FLASHPLAN.md`).

> Caveat: the init-bits-in-bitstream mechanism is Gowin-tool behaviour that
> cannot be checked here (no toolchain). §6.2 already flags that inference must
> be confirmed on the first synthesis.

### 6.3 The boot ROM

The 16-word ROM at `0xFFFF0` (`BOOT_ROM_PACKED`, `deep16_pkg.sv`) stays a **LUT
ROM**, not part of the image: it zeroes `DS`/`SS`, plants the entry point `0x0100`
at physical 0–2, and jumps to `0000:0100`. Keeping it preserves the core's reset
behaviour byte-for-byte with the three emulators.

One overlap to note: the ROM writes RAM at 0–2 *after* configuration, so it
overwrites the image there. Harmless — the kernel re-installs the SWI vector at
address 2 itself — but it means those three words are not the image's to keep.

### 6.4 The I/O cells need a hardware home

The core treats every address below `MEM_WORDS` as memory, so the top must
**decode the `0xF0000` page explicitly** and answer the fill elsewhere. Two cells
the kernel actually touches:

- **UART** `0xF0040–0xF0046` — `deep16_uart.sv` (§5).
- **`ECHO_FLAG`** `0xF0064` — the keyboard-echo flag the BIOS `getstr` reads. It
  is **neither RAM nor MMIO**: outside the 26 K window and outside the UART's
  decode.

**Decided: the echo flag gets no hardware at all.** It stays where the kernel put
it, outside the window, and the board simply does not back it: a read answers the
fill (`0xFFFF`, i.e. echo "on") and a write is dropped, so the toggle is inert.
That is the *default* behaviour anyway, and it costs nothing. If echo is wanted
later it becomes software's business — the cell moves into the kernel's data
area, which is safe on the board because there is no browser poking it (§7.7).
The first cut had a one-word MMIO register at `0xF0064`; it is gone.

So the board's decode is just RAM, the boot ROM and the fill — no MMIO cell to
read or write. `scripts/make_image.mjs` still reports `0xF0064` as the one word
outside the window, and asserts that nothing *else* is.

The keyboard ports `0xF0060`/`0xF0062` stay decoded but dead (§5).

### 6.5 The generator

`scripts/make_image.mjs` — **done**, `npm run image` writes `artifacts/image/`:

1. Assemble `asm/forth.asm` with `{ CONSOLE_UART: 1 }` — the UART build; the
   screen build is emulator-only.
2. Map the `memoryChanges` into the D16MINI window (§3), with the BIOS relocated
   as M5 dictates.
3. Fill all 26 blocks with `0xFFFF`, then lay the words down.
4. Emit `$readmemh` (Verilator) and `.mi` (Gowin), plus a small manifest: the
   address range, the fill, and a build id (a hash of the source and the defines).
5. Assert `dict_free < STACK_BASE` (§2) and that nothing landed outside the
   window — a build that silently overruns must fail, not boot into garbage.

The image is **final only once M5 (BIOS placement) is fixed**: the BIOS words go
in at whatever low address it is relocated to.

### 6.6 Later: a UART loader

Baking the image in is the bring-up path. A small ROM loader that takes an image
over the UART — the console already exists — is the later alternative, so the
kernel can change without a re-synthesis. Out of scope for the first board.

The current "load a program" path (`loadProgram` in `rtl/sim`,
`js/deep16_simulator.js`) is a **simulation** facility; it is not a hardware
loader. DeepForth's own "Datei tippen…" source loader is **browser-only**
(`SERPLAN.md`): on the board a source file arrives by typing into the UART, or it
is already in the image. There is no on-board mass storage in this design. (In
simulation the injection is kept — §7.7, decision C5.)

---

## 7. The serial terminal front end (console)

### 7.1 What the "screen buffer front end" is today

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
`ES:SCR` leaks in §7.4.

### 7.2 Architecture

Three layers, split so the FPGA stays trivial and the terminal logic stays
editable:

```
DeepForth ──► console layer (kernel BIOS f0–f5) ──► UART MMIO ──► deep16_uart ──► pins 17/18
     ▲                     │                                                          │
     └─────────────────────┴──────────────  host terminal (VT100)  ◄──────────────────┘
                                             or SerialTerminal model (sim / IDE)
```

- **Hardware** (`deep16_uart.sv`, §4.4): a dumb byte pipe. TX/RX FIFOs, baud
  divider. No screen, no cursor, no attributes.
- **Console layer** (kernel BIOS): turns the old cell/attribute/cursor model into
  plain bytes plus a minimal ANSI subset. **This is the front end.**
- **Host terminal**: owns the screen. In simulation, a `SerialTerminal` model
  owns it instead.

Because the host owns the screen (C1), the machine stores **no** terminal state
beyond a byte FIFO. That is the whole point of the design.

### 7.3 Console BIOS: same functions, serial bodies

Same **function numbers and calling convention** (the function number in the
caller's `R0`, parameters in `R1..R3`, the answer in the handler's `R0`), so
`put_char`, `print_text`, `emit`, `key`, `accept`, the prompt and the interpreter
are **not touched**:

| BIOS | Today (screen) | D16MINI (serial) |
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

### 7.4 Kernel helpers to neutralise

| Helper | Today | D16MINI (serial) |
|---|---|---|
| `put_char`, `print_text`, `print_prompt` | BIOS f2 | unchanged (still f2) |
| `newline_direct`, `word_cr` | f2 CR then f2 LF | unchanged (bytes are bytes) |
| `clear_cursor`, `cursor_off` | `AND ATTR_MASK` on `ES:SCR` | **no-op** |
| `after_print_text` | `SCR` row math → next line | **emit CR+LF** (keeps the banner on its own line) |
| `wrap_if` | column from `SCR`, wrap at 80 | **no-op** (`JMP LR`) — host autowraps |
| `word_cls` | f1 + blank top-left cell | **f1 only** |
| `word_scr_fetch`, `word_scr_store` | `ES:SCR` | **removed** (screen-only) |
| `form` | `24 80` | **`24 80`** (nominal; decision C3) |

Consequences:

- **`R8` (`SCR`) becomes a free register** — nothing needs a live screen pointer.
- `scr@`/`scr!` and colour attributes are gone (C2); full-screen programs
  (`hanoi`, `snake`) do not run here — already carved out in `README.md:125`.
- The keyboard FIFO's role is now the UART **RX FIFO**.

### 7.5 Protocol

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
| `ESC …` sequence | **consumed and dropped** (C4) — arrows, function keys |
| everything else | ignored |

Optional later, not in this design: `Ctrl-C` = break; `ESC[A`/`ESC[B` = command
history.

### 7.6 Build switch: one source, two consoles

Add **conditional assembly** to `js/deep16_assembler.js` — it has only
`.org`/`.word`/`.text`/`.equ` today:

```
.if CONSOLE_UART
    ; UART BIOS f0–f5, neutralised helpers (§7.3, §7.4)
.else
    ; the existing screen BIOS and helpers, unchanged
.endif
```

`CONSOLE_UART` selects the build. The screen path is compiled byte-for-byte as
today, so the emulator, the IDE and `tests/forth.test.js` keep working.

If adding conditionals is deferred, the fallback is a delimited-region
substitution in the build script — but the assembler feature is small, reusable,
and also serves the book.

### 7.7 Simulation / IDE front end

This is what makes the design buildable **now**, before a board.

- **`SerialTerminal` model** (in `tests/helpers.js`): captures the TX byte stream,
  feeds RX, and parses the §7.5 subset back into an 80×25 view.
- **IDE Screen tab** renders the `SerialTerminal` for the UART build instead of
  reading `mem[0xF1000]`. The visual experience survives with no framebuffer.
- **Input injection (C5):** the existing "Datei tippen…" uploader
  (`fileToKeys` → key pump) feeds **UART RX** in the UART build, exactly as it
  feeds the keyboard FIFO in the screen build. The 128-entry RX FIFO is the same
  depth, so the pump's flow control still applies.
- `sim.enqueueKeyCode` (the IDE keyboard) also maps to UART RX.

### 7.8 The rejected alternative (kept for the record)

A **zero-kernel-change adapter**: keep `0xF1000` decoded to a shadow 2000-cell
buffer (not RAM), watch cell writes, and emit `ESC[row;colH` + char derived from
the address. The kernel stays byte-for-byte unchanged.

Rejected because it **keeps a screen buffer** (the thing we are removing), needs
row/col decode, produces verbose cursor positioning, and merely relocates the
attribute problem. Decision C1 chose the dumb pipe instead.

---

## 8. Verification

| # | Test | Gate |
|---|---|---|
| 1 | Byte-exact boot: banner, `>`, prompt | matches the expected stream |
| 2 | Evaluated line: `3 4 + .` | `3 4 + . 7  ok\r\n> ` |
| 3 | Line editing: type, `BS`, type, `CR` | buffer correct, wire shows `BS SP BS` |
| 4 | Escape handling: `ESC[A` mid-line | dropped, buffer unchanged |
| 5 | Clear: `cls` | wire contains `ESC[2J` |
| 6 | **Three-core parity** | identical byte stream on JS, WASM and RTL (`tests/console-parity.test.js`: the banner, a typed line, a backspace) |
| 7 | **Guard: no framebuffer writes** | the UART build stores nothing into `0xF1000–0xF17CF` |
| 8 | Injection: upload a source file | arrives via UART RX, definitions run |
| 9 | **Memory latency** | registered-read model behaves identically to the combinational array at latency 1 |
| 10 | Existing `forth.test.js` (screen build) | stays green, untouched |
| 11 | **Free-run console** | the kernel's banner comes out with `i_step=1, i_free=1` (the board's tie-off), not only under `step()` |
| 12 | **Board boot image and console** | `npm run sim:board`: the board build, the real image, the window decode, and the UART *pins* both ways — the banner decoded off `uart_txd`, then a line typed into `uart_rxd` echoed and evaluated (`3 4 + .` → `7  ok`) |
| 13 | Boot image validity | `tests/image.test.js`: every word in the window, the `0xFFFF` fill, the BIOS at `0x5F00`, the one MMIO word kept out |

Test 7 is the mechanism that pins the two output paths (§7.1) closed — the thing
the "one chokepoint" comment only asserted. Test 9 is `PLANPSRAM.md` §7's
latency-invariance idea reduced to the one latency that matters here.

Tests 11 and 12 exist because the step-based tests could not see the free-run
strobes (§4.3): the board mutes the console and every `step()` test still passes.
Test 11 lives in the ordinary suite; test 12 needs Verilator and `g++`, so it is
a separate command.

> `README.md:74` lists `tests/serial-port.test.js`, which **does not exist**. The
> new test file is `tests/serial-console.test.js`; correct the README entry when
> it lands.

---

## 9. Phases

Each phase ends green and committable. Phases 1–3 need no hardware.

| Phase | Work | Hardware? |
|---|---|---|
| **1** ✅ | Assembler conditionals; UART console BIOS + neutralised helpers; UART model in JS + WASM; `SerialTerminal`; tests 1–8. Screen build stays green. | no |
| **2** ✅ | Memory interface honesty (§4.2): registered reads, `vec` as a register, drop the cache behind a build flag; BSRAM/registered model in Verilator; test 9. | no |
| **3** ✅ | Real `deep16_uart.sv`; core MMIO ports; the 26-block window + decode + boot image behind `` `ifdef D16MINI ``; board top, clock, reset, `.cst`/`.sdc`; `.mi` init; tests 11–13 and `npm run sim:board`. | no |
| **4** | Gowin synthesis, timing closure at 27 MHz, `program`-over-JTAG, terminal bring-up (picocom @115200), boot the real DeepForth. | **yes** |

Phase 1 (console) and Phase 2 (memory) are deliberately separate: one changes
the console, the other the memory model, and a regression must be locatable.

Phase 3 is done *except* for the two things that need the toolchain: confirming
that Gowin infers 26 BSRAM blocks with the init, and closing timing. The board
simulation (`npm run sim:board`) is the strongest check available here — it is
the whole bring-up path minus the vendor tools.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Combinational→registered memory breaks the pipeline (fetch and load) | Phase 2 alone; test 9; keep the array model as reference |
| `dict_free` drifts upward as Tier-3 words land | leave the 11.5 K-word slack; assert at assemble time that `dict_free < STACK_BASE` |
| Two output paths (`putch`, `putstr`) / a third `ES:SCR` writer missed | test 7; grep-gate on `0xF1000` stores |
| `after_print_text` left as SCR math → prompt glued to the banner | explicit CR+LF in §7.4 |
| Escape sequences leak into the line buffer | consume-and-drop state in f5 (§7.5), test 4 |
| Host local echo left on → doubled input | document host setup; initiation banner |
| RX byte loss between polls | 128-byte RX FIFO; injection test 8 mirrors the existing FIFO-brake test |
| BIOS far-jump / segment change breaks SWI | re-run the full forth suite; BIOS `.org` is one constant |
| ~~**The memory needs more BSRAM blocks than the chip has**~~ | **fixed** (§4.6): the read port is shared between the fetch and data loads, and the memory now fits BSRAM exactly — 26/26 |
| **A load behind a store read the old word in free-run** | **fixed** (§4.6): the read result is bypassed from the store, with a free-run regression test in `tests/rtl.test.js` |
| **The logic is ~20 % over the LUT budget** | 10,245 LUT4 against 8,640 in the open flow (§4.6); a commercial synthesizer usually closes that margin — unverified |
| No Gowin toolchain here | the open-source flow answers what it can (§4.6); vendor fit, timing and the licence are Phase 4 unknowns, not assumptions |
| `.cst` UART pins / pin mode wrong | confirm against DS117 + Sipeed pinout before Phase 4 |

---

## 11. What is missing today — the gap list

This list was written before the work started and is kept as the record: struck
through means done, plain means still absent. The residue is short and named at
the end.

### A. Toolchain and project

- **No FPGA toolchain and no synthesis.** No Gowin EDK/Yosys in this environment;
  fit, timing and `.fs` generation cannot be done or verified here. *(still true)*
- ~~No board top-level~~ — `rtl/deep16_board.sv`.
- ~~No constraints file (`.cst`), no project file, no memory-init (`.mi`)~~ —
  `rtl/deep16_board.cst`, `rtl/deep16_board.sdc`, `artifacts/image/image.mi`.
- ~~No hardware load path~~ — the image is a synthesis input (§6.2.1), so no
  runtime loader is needed for bring-up.

### B. RTL memory

- ~~`deep16_top.sv:41` memory is a 16.8 Mbit Verilog array~~ — `RAM_WORDS`:
  26,624 behind `` `ifdef D16MINI ``, the 1 MB array for simulation.
- ~~Memory is read combinationally~~ — registered reads, phase 2.
- ~~The read bus is 11 reads/cycle~~ — the cache is gone; one fetch port and one
  data read/write port, and nothing else (the direct `mem[2]` read is gone too).
- ~~The core's decode treats everything below `MEM_WORDS` as memory~~ — the board
  build decodes RAM / boot ROM / fill in the top, so the core's
  bound is unchanged and an unbacked address reads the halt word.
- ~~The SWI vector is a dedicated array read (`mem[2]`)~~ — read through the data
  port now (§4.1), so the array is two-port.
- ~~The debug bus (256-entry mux)~~ — behind `` `ifndef D16MINI `` and dropped from
  the board build (§4.3), with the register file's debug port tied off.
- ~~The `i_step`/`i_free` single-step handshake~~ — the board ties free-run, and
  doing so found the `step_done` strobe bug (§4.3).

### C. UART / console

- ~~No UART RTL~~ — `rtl/deep16_uart.sv`.
- ~~No UART MMIO in any of the three cores~~ — JS, WASM and RTL all decode it.
- ~~Doc/reality mismatch~~ — the cores implement the manual's `0xF0040` block.
- ~~Stale README: `tests/serial-port.test.js` does not exist~~ — fixed.
- ~~No console-abstraction build~~ — `CONSOLE_UART` in the assembler.
- ~~The kernel's fixed addresses (stacks, BIOS) sit outside the window~~ — M5.
- The keyboard ports stay decoded but dead on the board (intended).
- **No on-board way to enter source** — still true: the image is the bring-up
  path; the UART loader is §6.6.

### D. Tests / tooling

- ~~No UART test, no loopback~~ — `tests/uart-kernel.test.js`,
  `tests/rtl-uart.test.js` (including the free-run case),
  `tests/console-parity.test.js` (all three cores byte-identical) and
  `tests/ui-terminal.test.js`.
- ~~No BSRAM/registered-latency model~~ — the registered-read model, plus
  `npm run sim:board` for the whole board build.

### The residue

1. **Gowin synthesis** — whether the vendor tool closes the ~20 % LUT overage
   (10,245 against 8,640) and closes timing at 27 MHz; the open flow cannot place
   the design while it is over-utilised, so no Fmax has been measured. Needs the
   toolchain and a licence (§10).
2. **Confirm the pins** in `rtl/deep16_board.cst`.
3. **The reported combinational loop** (§4.6) — probably a mapping artifact, but
   unverified.
4. Optional: the **UART loader** (§6.6), so the kernel can change without a
   re-synthesis.

---

## 12. Decisions still open

The six console decisions (C1–C6) are locked (§0). These machine items remain:

1. ~~**BIOS location**~~ — **decided**: relocated into the low window (BIOS
   `0x5F00`, stacks `0x6000` / `0x67F0`), `CONSOLE_UART` build only. §3.
2. ~~**Conditional assembly** in the assembler vs. a build-time substitution~~ —
   **decided**: the assembler does it (`.ifdef` / `.equ`), one source, two builds.
3. ~~**Stack bases**~~ — **decided**: `RSTACK_TOP = 0x6000`, data stack `0x67F0`
   from a cell (§3).
4. ~~**Boot image**~~ — **decided**: one SV array with `$readmemh` + `.mi`, and
   no hardware for `ECHO_FLAG` (it stays software's business, §6.4). The image is
   in the tree (§6.2); the explicit-primitive memory stays the fallback if
   inference misbehaves.
5. **Keep the keyboard ports?** Dead on hardware; harmless in the map. Lean: keep
   the addresses, wire nothing. *(unchanged)*
6. **FIFO/baud beyond C6** — C6 fixes 115200 / TX 64 / RX 128; revisit only if a
   hardware measurement demands it. *(unchanged)*
7. **The `.cst` pin numbers** — the documented values are in; only the board can
   confirm them.
