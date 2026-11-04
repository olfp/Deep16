---
type: "Reference"
title: "WebAssembly Core"
openwiki_generated: true
sources:
  - id: openwiki-source-f8d10828394c4129061d5b0e
    resource: repo://index.html
  - id: openwiki-source-0cc31ca306d30bed999278fc
    resource: repo://js/deep16_ui_core.js
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-de73cd8815fd05f54317660e
    resource: repo://rtl/deep16_top.sv
  - id: openwiki-source-faa01626de48356b4ee87020
    resource: repo://tests/cores.test.js
  - id: openwiki-source-0b039283b04730211698eb2a
    resource: repo://tests/helpers.js
  - id: openwiki-source-d4e3dbfe70ab966643884b1b
    resource: repo://wasm/deep16-wasm/Cargo.toml
  - id: openwiki-source-c7a6bbd3363bbe0464afaa08
    resource: repo://wasm/deep16-wasm/Makefile
  - id: openwiki-source-8c5558aa55bcb63fa02bf537
    resource: repo://wasm/deep16-wasm/src/lib.rs
generated: { by: "opencode", at: "2026-11-01T09:36:37.731Z" }
verified:
  - by: openwiki/0.7.3
    at: 2026-11-04T15:30:01.509Z
---


# WebAssembly Core

`wasm/deep16-wasm/src/lib.rs` is a Rust port of `js/deep16_simulator.js`. It is
not an independent implementation of the ISA: it reproduces the reference
core's state and its per-step result, and it exists so the browser can run the
machine faster without changing observable behaviour.

The crate is a `cdylib` compiled by `wasm-pack` into `wasm/pkg/`, which is
committed so the IDE and the Node test suite can load it without a Rust
toolchain or a build step.

## Layout and build

| Artifact | Role |
|---|---|
| `wasm/deep16-wasm/src/lib.rs` | The whole core: CPU state, decoder, devices, ABI |
| `wasm/deep16-wasm/Cargo.toml` | `cdylib`, `wasm-bindgen`, release profile with `lto`, `opt-level = "s"`, `panic = "abort"` |
| `wasm/deep16-wasm/Makefile` | `wasm-pack build --target web --out-dir ../pkg` |
| `wasm/pkg/` | Committed `deep16_wasm.js` / `deep16_wasm_bg.wasm` plus typings |

`npm run build:wasm` re-runs the same `wasm-pack` command. The committed package
is deliberate: `tests/helpers.js` imports `wasm/pkg/deep16_wasm.js` directly and
passes the `.wasm` bytes as a module, and `index.html` imports the same files
with a version query string. If the Rust source changes without a rebuild, both
the tests and the IDE keep exercising the old model.

## Exported ABI

The crate exposes a flat C-style surface through `#[wasm_bindgen]`, deliberately
shaped like the Verilator harness so the IDE and tests can treat both compiled
cores through one interface.

**Lifecycle and memory**

| Export | Effect |
|---|---|
| `init(mem_words)` | Allocate a fresh machine and install the boot ROM |
| `reset()` | Restore reset state and reinstall the boot ROM |
| `load_program(ptr, data)` | Copy words in, then clear PC and force `CS = 0xFFFF` |
| `poke(addr, value)` | Write one word without touching any other state |
| `get_memory_slice(start, count)` | Copy a word range out |
| `get_memory_word(addr)` | Read one word, `0xFFFF` when out of range |

**Architectural state**

| Export | Effect |
|---|---|
| `set_registers(regs)` / `get_registers()` | Active-bank view of `R0`–`R15` |
| `set_psw(psw)` / `get_psw()` | Active PSW |
| `set_segments(cs, ds, ss, es)` / `get_segments()` | Active-bank segment view |
| `get_shadow_state()` | Shadow `PC`, `CS`, alternate PSW |
| `get_recent_access()` | Last data access: address, base, offset, segment, direction |
| `get_last_event()` | Last event code, plus shadow/active PC and PSW pair |

**Execution and devices**

| Export | Effect |
|---|---|
| `step()` / `run_steps(n)` | Retire one instruction, or up to `n`, until a halt |
| `kbd_push(code)` / `kbd_clear()` / `kbd_available()` | Polled keyboard buffer |
| `uart_rx_push(code)` / `uart_rx_clear()` / `uart_rx_available()` | Console receive FIFO |
| `uart_tx_available()` / `uart_tx_take()` | Drain transmitted bytes |

## State mirroring contract

The IDE can switch from the JS core to the WASM core mid-session. That works
because `syncStateIntoCore()` in the UI performs a fixed sequence:

1. `init(memory.length)`
2. `load_program(0, memory)` — the whole image, not just the program
3. `set_segments(...)`
4. `set_psw(...)`
5. `set_registers(...)`

The order matters twice over. `load_program` deliberately clears PC and forces
`CS = 0xFFFF` because it means "a fresh program starts here", so it cannot be
used to resume a running machine; the setters after it restore the real state.
And `set_registers` interprets element 15 through the **current** `PSW.S` bit,
so `set_psw` must come first: while `S=1` element 15 writes the shadow PC and
leaves the saved user PC alone, matching what `get_registers` reports.

`get_segments` applies the same active-bank rule: while `S=1` it returns the
shadow `CS`/`DS`/`SS`/`ES`, so the getter and setter round-trip through handler
context instead of silently reporting the interrupted bank.

`poke` exists because no other export can write one cell without side effects.
The IDE needs it for state the host owns — the BIOS keyboard-echo cell at
`0xF0064`, for example — and it pairs with `poke` in the RTL harness so both
compiled cores offer the same write path. The JS core's equivalent is a direct
assignment to `simulator.memory[]`.

## Execution model

`step()` retires exactly one instruction, like the reference:

- if a delay slot is active, the slot instruction executes and the pending
  transfer applies afterwards;
- otherwise the word at the active `CS:PC` is fetched, PC is incremented, the
  instruction executes, and the flags are updated;
- `0xFFFF` stops execution and `0xFFF1` (`FSH`) is a behavioural no-op.

Decoder dispatch follows the same prefix hierarchy: `LDI`, `LD`/`ST`, the ALU
group, jumps, `LDS`/`STS`, `MOV`, `LSI`, `SMV`, `MVS`, `SOP`, `SET`/`CLR`,
`JML` and `SYS`. Only the `0xFFF0`–`0xFFF7` space is routed to the system
handler; `0xFFF8`–`0xFFFE` fall through as no-ops.

One implementation detail differs from the JS core's shape: `step_one` sets
`running = true` on entry when it is false. There is therefore no "stopped"
gate — a caller that keeps calling `step()` after a halt re-fetches `0xFFFF`
and reports halting again. The test harness relies on the returned boolean to
stop, not on the core refusing to run.

## Device models

- **Keyboard:** a simple `Vec<u16>` at `0xF0060`/`0xF0062`. Status is non-zero
  while a code is queued; reading data pops it. Pushes are unbounded, unlike
  the RTL top's 16-entry FIFO. Note that the exported doc comment still says
  "the RTL core has a 128 entry FIFO" — that is stale; the RTL is 16 deep.
- **UART:** the same register block as the reference (`0xF0040`–`0xF0046`),
  with a 128-byte receive FIFO, an overrun flag set on a push into a full
  queue, a 65,536-word transmit backlog, and divisor default `234`
  (27 MHz / 115200, the FPGA value). Transmit never blocks, so the status word
  always reports TX-ready and TX-idle.
- **No SIC, SPI, SD card, timer or screen hook.** The Rust core decodes only
  the keyboard and UART ports. Writes to `0xF1000` and the tile windows are
  ordinary memory writes, and any other `0xFxxxx` address is stored or loaded
  like RAM. The JS core, by contrast, has SD/flash/SIC models and forwards
  screen stores to the UI. Panels work with the WASM core because they read
  memory back through `get_memory_slice`, not because the core pushes updates.

## Differences from the JavaScript reference

| Area | JS reference | WASM port |
|---|---|---|
| Hardware interrupts | `handleHardwareInterrupt()`, vector 1 | No interrupt input or handler entry |
| D16nano ILL trap | `d16nano` flag traps `DIV`/`DIV32` | No `d16nano` mode; divides always execute |
| SD card / SPI flash / SIC | Full register-level models | Absent |
| Screen writes | Forwarded to the UI on every store | Plain memory |
| Keyboard queue | Bounded buffer, drops when full | Unbounded vector |
| `step()` after halt | Returns `false` while `running` is clear | Re-enters and halts again |
| Cycle/stall counters | `cycleCount` only | None |

These are capability gaps, not instruction-semantics gaps. On instruction
behaviour the two cores are pinned together by `tests/cores.test.js`, which
compares full snapshots for fresh and reset state, boot, the ALU group,
`MUL32`/`DIV32`, signed division, bit-index immediates, odd destination
registers, `LINK`, the signed five-bit offset across its whole range, and the
system-word space. `tests/wasm-state.test.js` separately pins the mirroring
contract described above.

## Loading in the IDE and in tests

`index.html` contains a module script that dynamically imports
`./wasm/pkg/deep16_wasm.js` with a cache-busting query, initialises it with the
matching `.wasm` URL, publishes `window.Deep16Wasm` and a `Deep16WasmReady`
promise, then dispatches a `deep16-wasm-ready` event. Failure is caught and
warned, not fatal: the core selector reports WASM as unavailable and the IDE
falls back to JS. Because the import is an HTTP fetch, opening the page over
`file://` never gets a WASM core.

In Node, `tests/helpers.js` performs the same two steps synchronously enough for
tests: dynamic `import()` of the package, then the default init with a
`WebAssembly.Module` built from the committed bytes.

## Related pages

- [JavaScript Reference Core](js-core.md)
- [Core Parity and Verification](../architecture/core-parity.md)
- [ISA and CPU State](../architecture/isa-and-cpu-state.md)
- [DeepWeb IDE](../ides/deepweb-ide.md)
