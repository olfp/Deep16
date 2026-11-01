---
type: "Reference"
title: "System Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.7.2
    at: 2026-11-01T09:36:37.731Z
sources:
  - id: openwiki-source-05b57c87f4341692de6b154c
    resource: repo://asm/forth.asm
  - id: openwiki-source-6d9dc09f47fb249425320461
    resource: repo://doc/Deep16-RTL.md
  - id: openwiki-source-f8d10828394c4129061d5b0e
    resource: repo://index.html
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-bf2a0339ada6a56de8b7a79c
    resource: repo://rtl/deep16_board.sv
  - id: openwiki-source-9355204a406c91981555258c
    resource: repo://rtl/deep16_core.sv
  - id: openwiki-source-de73cd8815fd05f54317660e
    resource: repo://rtl/deep16_top.sv
  - id: openwiki-source-4e7b81763273293f36cdd37f
    resource: repo://tests/rtl.test.js
generated: { by: "opencode", at: "2026-11-01T09:36:37.731Z" }
---


# System Overview

Deep16 is a complete small computer built around a 16-bit RISC ISA: an
assembler and disassembler, three interchangeable CPU implementations, a
browser IDE, a Forth operating layer, and FPGA boards that run the same
software on real hardware.

The important architectural property is not the feature list but the **trust
direction**: one implementation defines behaviour, and the others are held to
it by executable comparison.

## Layers

| Layer | Main artifacts | Responsibility |
|---|---|---|
| ISA | `doc/Deep16-Arch.md`, `doc/Deep16-Prog-Man.md` | Encoding, registers, PSW, segments, traps, delay slots |
| Reference core | `js/deep16_simulator.js` | Golden behavioural model and device models |
| Ports | `wasm/deep16-wasm/src/lib.rs`, `rtl/*.sv` | Same architecture in Rust/WASM and SystemVerilog |
| Toolchain | `js/deep16_assembler.js`, `disassembler`, `optimizer` | Source to words and back |
| IDE | `index.html`, `js/deep16_ui_*.js`, `js/deep16_worker.js` | Editor, panels, core switching, terminal |
| Software | `asm/forth.asm`, `asm/forth_nano.asm`, `forth/*.fth` | Forth kernel, BIOS, boot scripts, demos |
| Hardware | `rtl/deep16_board.sv`, `rtl/dvi/`, `rtl/psram/`, `rtl/flash/`, `fpga/gowin/` | D16MINI and D16nano tile machines |
| Verification | `tests/`, `scripts/rtl_sweep.mjs`, `scripts/rtl_trace.mjs` | Parity, decode sweep, per-device simulations |

## One ISA, three cores

- **JS** (`js/deep16_simulator.js`) is the behavioural reference. It is the
  simplest to read and the first place a semantic question is answered.
- **WASM** (`wasm/deep16-wasm/src/lib.rs`) is a Rust port with the same
  observable state and the same `step()` contract, used for speed.
- **RTL** (`rtl/`) is a five-stage SystemVerilog pipeline compiled to a native
  binary and to WASM through Verilator and Emscripten. It is a microarchitecture,
  not a second behaviour model: one `step()` still retires one instruction, but
  the internal timing is real and the diagnostic counters are exposed.

The JS core is authoritative. `tests/rtl.test.js` compares registers, PSW,
segments and screen output across all three, and a full decode sweep executes
every 16-bit word on the JS and RTL cores, normal and in a delay slot. Where the
architecture document disagrees with measured behaviour, the cores follow the
reference and the difference is pinned in a test.

The RTL's IDE model is deliberately cacheless: `rtl/deep16_top.sv` wires the
cache-flush inputs to nothing and drives the cache counters to zero. The PSRAM
board path owns the real cache. The README's "4 KB cache" describes the board
machine, not the model the IDE instantiates.

## The IDE

The IDE is a static page. `index.html` loads plain browser scripts, the
assembler and simulator classes attach to the page, and the committed `wasm/pkg/`
and `rtl/pkg/` packages are fetched over HTTP. There is no build step to run it.

Core selection is a first-class feature: switching cores mirrors the current
machine state (segments, PSW, registers, memory) into the newly selected core so
the assembled program and register contents survive. The choice is persisted in
`localStorage`. A worker boundary keeps long runs off the UI thread.

Opening the page over `file://` cannot fetch the WASM modules; the IDE then
falls back to the JS core.

## Software stack

`asm/forth.asm` is an assembler-written Forth kernel plus a BIOS. It provides
the tokenizer, interpreter/compiler loop, dictionary, vocabularies and console
words. The BIOS is reached through `SWI` and dispatches by function number;
`putch` is the single output funnel, so a new console only changes one routine.

The same source serves several builds through assembler defines: the screen/IDE
build writes cell memory, the D16MINI build talks to the UART, and the D16nano
build targets the tile engine. `asm/forth_nano.asm` adds the ILL handler that
emulates divides on the reduced `core3`. `forth/*.fth` contains boot scripts and
application demos, and `lila/` is a separate Lila-to-Forth compiler experiment
that runs on the gforth compatibility layer.

## Hardware

Two board classes matter today, both on the Tang Nano 9K:

- **D16MINI**: Forth on the RTL core, 2 MiB PSRAM, UART console, and a
  black-and-white DVI text mirror that listens to the UART stream.
- **D16nano tile** (FiT graphics): the same core plus the FiT tile/sprite engine,
  PS/2 keyboard, timer, SPI/SD, I2S audio and an interrupt controller, with the
  program image in configuration flash.

Both use a 24K-word boot image copied into PSRAM, with the dictionary continuing
at `0x6000`. Build variants are selected by `ifdef` (`D16MINI`, `D16NANO`,
`D16_PERIPH`, `D16SEG`) and by the Gowin project files under `fpga/gowin/`.

## Build and verification flow

- `npm test` runs the Node suite, including three-way parity and the Forth
  kernel on the RTL core.
- `npm run sweep:rtl` runs the exhaustive decode comparison.
- `npm run build:wasm` rebuilds the Rust core.
- `npm run build:rtl:wasm` rebuilds the RTL WASM package; `rtl/pkg/` is
  committed on purpose, so changing RTL source without rebuilding makes tests
  exercise the old model.
- `npm run synth:tile` and `npm run flash:tile` build and program the board.

## What is intentionally unfinished

- The FPU is specified in `doc/Deep16-FPU.md` but not implemented in any core.
- The ILL trap only covers `DIV`/`DIV32` on D16nano; the general
  undefined-opcode/FPU trap is missing.
- Hardware interrupt handling exists only in the JS core; RTL and WASM have no
  external interrupt input.
- Cycle/stall/flush counters are desktop-only in practice; narrow-screen display
  is incomplete.

These are documented gaps, not hidden assumptions. The project's own status text
in `README.md` should be preferred over the archived original summary that
claims "PRODUCTION READY".

## Related pages

- [ISA and CPU State](isa-and-cpu-state.md)
- [Memory Map and Memory Model](memory-map-and-memory-model.md)
- [Core Parity and Verification](core-parity.md)
- [JavaScript Reference Core](../cores/js-core.md)
- [RTL Core Microarchitecture](../cores/rtl-core.md)
