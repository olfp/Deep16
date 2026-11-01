---
type: "Reference"
title: "JavaScript Reference Core"
openwiki_generated: true
verified:
  - by: openwiki/0.7.2
    at: 2026-11-01T09:36:37.731Z
sources:
  - id: openwiki-source-558f92ad48bad4c1a8f65265
    resource: repo://js/deep16_simulator.js
  - id: openwiki-source-a4cdf03124e6a4fc0fb766f9
    resource: repo://js/deep16_terminal.js
  - id: openwiki-source-0cc31ca306d30bed999278fc
    resource: repo://js/deep16_ui_core.js
  - id: openwiki-source-d9cd8fddbb3a3a0b0c1da1cc
    resource: repo://js/deep16_worker.js
generated: { by: "opencode", at: "2026-11-01T09:36:37.731Z" }
---


# JavaScript Reference Core

`js/deep16_simulator.js` is the **golden reference** for Deep16. It is a
single-file behavioural model: one `step()` retires one instruction, memory is
a flat array, and devices are small JavaScript classes or register handlers.

The Rust/WASM and RTL cores are held to this file's observable behaviour. When
the architecture text and this core disagree, this core wins.

## Machine state

`Deep16Simulator` owns:

- `memory`: 1,048,576 words, initialised to `0xFFFF` (the halt word);
- `registers[16]`, with `R13` starting at `0x7FFF` and `R15` as PC;
- normal and shadow segment registers, plus the shadow bank for
  `PSW`, `PC`, `CS`–`ES`, `R0`–`R3`, `R13`, `R14`;
- `psw`, delay-slot bookkeeping, ALU flag temporaries and the recent-access
  record used by the memory panel;
- device state: keyboard queue, UART FIFOs, SPI master plus `SdCard` and
  `SpiFlash`, and the SIC pending/enable/scratch registers.

The constructor installs the boot ROM at `0xFFFF0`, so a fresh instance can run
without an explicit `loadProgram()`. Reset restores the ROM-first state
(`CS=0xFFFF`, `PC=0`), clears memory to `0xFFFF`, empties the keyboard and UART
queues, and replaces the SD card and SPI state.

`loadProgram(memory)` copies a full image, re-installs the ROM and parks PC at
0, leaving the ROM to jump to `0x0100`. Tests therefore normally set segments
explicitly after loading.

## Execution loop

`step()` is the whole architectural contract:

1. If the machine is running and an interrupt is pending (`I` set, not in the
   shadow bank, not in a delay slot), take the hardware vector as the step.
2. If a delay slot is active, fetch and execute the slot instruction, update
   flags, then apply the pending transfer. A jump inside the slot replaces the
   outer transfer; a not-taken branch inside it cancels it.
3. Otherwise fetch `CS:PC`, stop on `0xFFFF`, increment PC first, execute, then
   update flags.

Instruction execution is dispatched by the same prefix hierarchy the ISA
defines: `LDI`, `LD`/`ST`, the ALU group, jumps, `LDS`/`STS`, `MOV`, `LSI`,
`SMV`, `MVS`, `SOP`, `SET`/`CLR`, `JML`, and `SYS`. The core implements the
shadow-bank helpers (`readGPR`/`writeGPR`) so only `R0`–`R3`, `R13` and `R14`
switch banks.

`this.d16nano` selects the reduced-core behaviour: when true, `DIV`/`DIV32`
raise the ILL trap instead of using the software divide, matching `core3` on
the D16nano board. The full machine leaves it false.

The JS core is **not cycle-accurate**. `cycleCount` increments once per step for
the benchmark display; the RTL core owns real cycle, stall and flush counts.

## Devices

### Screen

Screen memory is `0xF1000`–`0xF17BF`, an 80 × 24 grid of words. Every store in
that range calls `checkScreenUpdate()`, which forwards the address and value to
`ui.screenUI.handleScreenMemoryWrite()` when a UI is attached. The simulator
itself does not parse attributes; the panel does.

### Keyboard

The architectural port is `0xF0060` (status) / `0xF0062` (data). A read of
`KBD_DATA` pops `kbdBuffer`; a push is dropped when the buffer is full.
`enqueueKeyCode()` and `kbdAvailable()` are the host-facing hooks. The IDE feeds
them from key events, and file uploads pace themselves by the available count.

### UART console

The UART occupies `0xF0040`–`0xF0046`:

- status: b0 RX ready, b1 TX ready, b2 RX overrun, b3 TX idle;
- data: read pops RX, write pushes TX;
- divisor and control (reset RX/TX FIFOs).

The RX FIFO is 128 bytes deep and sets the overrun bit on a push into a full
queue. TX never blocks; `uartTxTake()` returns and clears the emitted bytes so
the host drains each byte exactly once. The IDE pumps this into
`SerialTerminal`, which turns the byte stream plus a small ANSI subset into an
80 × 24 grid.

### SPI, SD card and configuration flash

The SPI master is a register block at `0xF0080`; a write to `SPI_DATA` performs
one byte exchange immediately, so `busy` never asserts but a polling driver
still works. Chip select 0 is the `SdCard` model, chip select 1 is the
`SpiFlash` model.

`SdCard` is byte-level, not sector-level: it consumes command frames, returns
R1/R3/R7 responses, waits for data tokens and CRC bytes, and stores 512-byte
sectors in a `Map`. It implements the commands a block driver needs (`CMD0`,
`CMD8`, `CMD55`/`ACMD41`, `CMD58`, `CMD16`, `CMD17`, `CMD24`) and reports SDHC.

`SpiFlash` models a 4 MB P25Q32U: command/address framing, read, page program,
4 KB sector erase, status register, write-enable latch, JEDEC ID and the
2 MB block-protect rule. Writes to a protected address are ignored, matching
the board's protection behaviour.

### SIC

The SIC at `0xF00B0` has write-one-to-clear pending bits, an enable mask,
status, and scratch/raster counters. The JS core has no timer or raster source,
so tests raise a bit with `raiseIRQ(bit)`; `irqLine()` reports
`pending & enable`. This models the board's interrupt aggregation without
pretending to model time.

## Host and IDE integration

`setUI(ui)` attaches the page's `DeepWebUI`; the simulator uses it only for the
screen write hook. The current IDE run loop lives in `js/deep16_ui_core.js`:

- a 10 ms `setInterval` executes up to 200 steps per tick;
- the loop checks memory breakpoints before each step and stops on a hit;
- it drains the UART once per tick and paces keyboard uploads;
- it refreshes the memory/register panels when the machine stops.

`js/deep16_worker.js` contains a message-driven worker wrapper, but the current
UI does not instantiate a `Worker`; `workerRun()` only posts a message to a
`this.worker` that is never created. The active execution path is the interval
loop on the main thread. This is worth knowing before assuming long runs are
offloaded.

For tests and Node tooling, the class is loaded through `vm.runInThisContext`
and attached to `globalThis`, which is how `tests/helpers.js` drives it without
a module system.

## Relationship to the other cores

- The JS core is the only one with hardware-interrupt entry
  (`handleHardwareInterrupt`).
- It has the full software divide; the RTL `core3` raises ILL instead.
- It has no cache, no real cycle timing and no DVI/tile hardware.
- Its device models are the specification for the WASM and RTL harness entry
  points (`uart_rx_push`, `uart_tx_take`, `kbd_push`, `spi`/SD exchange).

## Related pages

- [Core Parity and Verification](../architecture/core-parity.md)
- [ISA and CPU State](../architecture/isa-and-cpu-state.md)
- [DeepWeb IDE](../ides/deepweb-ide.md)
- [WebAssembly Core](wasm-core.md)
