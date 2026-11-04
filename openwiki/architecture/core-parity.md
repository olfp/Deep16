---
type: verification-architecture
title: Core Parity and Verification
description: How Deep16 holds its JavaScript, Rust/WASM and SystemVerilog cores to the same architectural behaviour, and which tools prove it.
tags: [parity, verification, testing, cores, simulator, rtl, wasm]
verified:
  - by: openwiki/0.7.3
    at: 2026-11-04T15:30:01.509Z
sources:
  - id: openwiki-source-6d9dc09f47fb249425320461
    resource: repo://doc/Deep16-RTL.md
  - id: openwiki-source-558f92ad48bad4c1a8f65265
    resource: repo://js/deep16_simulator.js
  - id: openwiki-source-9355204a406c91981555258c
    resource: repo://rtl/deep16_core.sv
  - id: openwiki-source-6df23aa962f11ba40014c90a
    resource: repo://rtl/deep16_core3.sv
  - id: openwiki-source-de73cd8815fd05f54317660e
    resource: repo://rtl/deep16_top.sv
  - id: openwiki-source-8d3356038273308ccaaf465a
    resource: repo://rtl/sim/core3_irq_tb.sv
  - id: openwiki-source-cdfb565bcc08ea0cd1ad0150
    resource: repo://rtl/sim/dvi_tile_tb.cpp
  - id: openwiki-source-6d184cd85da0b4def46caeb2
    resource: repo://scripts/build_core3_irq_sim.sh
  - id: openwiki-source-1410fae2d4991235b77849f3
    resource: repo://scripts/build_dvi_tile_sim.sh
  - id: openwiki-source-e5dbad1263257a4c2dd2625c
    resource: repo://scripts/rtl_sweep.mjs
  - id: openwiki-source-7077d66a6fdca0d6b851bd74
    resource: repo://scripts/rtl_trace.mjs
  - id: openwiki-source-1ee9fe7206c3906865d4000d
    resource: repo://tests/console-parity.test.js
  - id: openwiki-source-0b039283b04730211698eb2a
    resource: repo://tests/helpers.js
  - id: openwiki-source-4e7b81763273293f36cdd37f
    resource: repo://tests/rtl.test.js
  - id: openwiki-source-e3cbc9bdf6a73d9a2ec96f60
    resource: repo://tests/segmented.test.js
  - id: openwiki-source-227dc2c50999a6b4a5874677
    resource: repo://tests/showcase-boot.test.js
  - id: openwiki-source-8760b0ccefa32cd7e032b553
    resource: repo://tests/wasm-state.test.js
  - id: openwiki-source-8c5558aa55bcb63fa02bf537
    resource: repo://wasm/deep16-wasm/src/lib.rs
generated: { by: "opencode", at: "2026-11-04T15:30:01.509Z" }
---

# Core Parity and Verification

Deep16 ships three implementations of one ISA. `js/deep16_simulator.js` is the
**golden reference**; `wasm/deep16-wasm/src/lib.rs` and the SystemVerilog core in
`rtl/` are ports that must reproduce it. No specification text outranks the
reference: where the architecture document disagrees with measured behaviour,
the cores follow the reference and the divergence is pinned in a test.

Parity is therefore not "the three cores were written from the same manual".
It is a set of executable comparisons with defined observation points.

## What is compared

### Three-way program parity

`tests/rtl.test.js` defines a `parity()` helper that runs one assembled program
on the JS, RTL and (unless excluded) WASM cores and compares:

- `R0`–`R14` and the program counter,
- the PSW,
- the four active segment registers,
- a 25 × 80 text window read from screen memory at `0xF1000`.

The comparison is state-based, not trace-based. Cycle and stall counts are
deliberately outside it — the RTL is a pipeline and the behavioural cores are
not — so tests that care about cost assert those counters separately. The WASM
core can be skipped for a case where a documented difference applies.

Individual cases then widen coverage around the same state comparison: reset and
boot-ROM entry, the ALU/shift/rotate group, shift-count-zero carry retention,
`MUL32`/`DIV32` pair semantics and odd-destination refusal, back-to-back
division, signed `DIV`/`DIV32`, load-use before a divide, negative load/store
offsets, branches and delay slots, `LINK`/`MOV` immediate tables, `MVS`/`SMV`/
`SOP`, `SWI`/`RETI`, the SWI vector fetched through the data port, loads into
`R15`, store-to-load forwarding in free-run, shadow banking, and the polled
keyboard port.

### JS ↔ WASM parity

`tests/cores.test.js` pins the two behavioural cores against each other where
the RTL is not needed: hand-encoded words versus assembler output, `MUL32`
high/low word placement, `DIV32` quotient/remainder, signed division, the ALU
group, bit-index immediates, odd destination registers, `LINK` return address,
fresh/reset state, boot state, the signed five-bit load/store offset across its
whole range, and the system-word space.

### Console byte parity

`tests/console-parity.test.js` assembles the Forth kernel with
`CONSOLE_UART`, boots it on all three cores, types the same line into the UART
receive path, and compares both the terminal grid and the raw transmit byte
stream. This is stronger than comparing each core with its own expected string:
the banner, the prompt, echoed input, backspace handling and line wrapping must
be byte-identical across implementations.

### Segmented map, raster band and console pump

`tests/segmented.test.js` boots the scattered `D16SEG` map in the JS core and
covers what the flat window cannot: the PSRAM dictionary, the data and return
stacks, the SD driver, the catalog words, and the raster band state machine
(an OAM descriptor write at line A and a restore at line B). It also pins the
getstr pump from the caller's side: characters typed without Return sit in TIB
and nothing runs, and Return completes the line the REPL is polling for. The
flat D16D counterpart is `tests/showcase-boot.test.js`: menu cells, `Q` back to
the Forth console, and the idle timer launching attract mode.

### Tile engine and raster bench

`rtl/sim/dvi_tile_tb.cpp`, built by `scripts/build_dvi_tile_sim.sh`, drives
`rtl/dvi/dvi_tile.sv` directly instead of running a CPU program. It checks the
control-7 compare, the raster request edge detector, the ack/re-arm path
(`request set before re-arm`, `re-arm store lands`, `re-arm clears the request`,
`re-armed line still fires once per frame`), the text/art/sprite palette banks,
pair mode, and the OAM/sprite loader.

The board CPU's interrupt entry is a separate bench: `rtl/sim/core3_irq_tb.sv`
(`scripts/build_core3_irq_sim.sh`) pulses IRQ while a store is decoded and
checks that RETI re-runs the parked instruction rather than the following one.
That path is not part of the three-way program parity, because the
parity-tested `deep16_core.sv` has no IRQ input.

## The harness layer

`tests/helpers.js` is the common substrate:

- browser scripts are evaluated in the Node `vm` the way `index.html` loads
  them, and the top-level classes are read back by name;
- `runJs`, `runWasm` and `runRtl` accept the same options and return the same
  shape, including `registers`, `psw`, `segments` and a `memoryAt` reader;
- the WASM and RTL packages are loaded from their committed `pkg/` directories,
  so the suite runs without a rebuild;
- the RTL runner exposes the extra observability the pipeline needs: shadow
  state, cycle/stall/flush/instruction counters and delay state;
- keyboard input is preloaded differently per core because the RTL top has a
  16-entry FIFO and silently drops pushes when full, while the behavioural
  cores accept the whole queue.

Programs can bypass the assembler with `rawProgram()` and hand-built encodings
when a test must execute a word the assembler correctly refuses to emit.

## Exhaustive decode sweep

`scripts/rtl_sweep.mjs` executes **every** 16-bit instruction word on the JS and
RTL cores, once from a normal fetch and once from a delay slot, and compares
return status, registers, PSW, segments, shadow bank, shadow registers, delay
state, recent-access record and the stored word if the instruction wrote memory.

The sweep exists because ordinary programs never execute reserved words, SYS
defaults and ALU corner encodings — exactly the places a behavioural port is
most likely to drift. It runs four register/PSW seeds: a plain context, a
context with stack/extra segment selects active, a context inside the shadow
bank, and a context with shadow plus interrupt-enable and zero flags set. With
two execution paths per word, a full run is 4 × 2 × 65,536 = 524,288
executions.

Two details make the sweep trustworthy:

- every store is tracked through a `Proxy` on the JS memory and undone after
  each word, because one un-restored write would poison all following words;
- the JS fetch is wrapped so the sweep can verify that the behavioural core
  actually executed the word under test; drift is reported instead of silently
  comparing the wrong instruction.

`tests/rtl.test.js` also carries a smaller in-suite version of the same sweep:
all 65,536 words, both paths, one seed, with a bounded failure report. The full
four-seed run stays a separate npm script because of its duration.

## Lockstep trace

`scripts/rtl_trace.mjs` steps the JS and RTL cores in lockstep and stops at the
first retired instruction where machine state (including a memory window)
differs. It accepts an assembly file, a step cap and `--keys` for programs that
read the keyboard; `DUMP=1` prints every retired step instead of only the first
divergence.

The two tools answer different questions. The sweep proves each word in
isolation; the trace proves that a *sequence* of words keeps both cores in the
same state, including delay-slot application, bank switching and flag updates.
The project documents the trace as the tool that found the delay-slot
branch-apply bug in the Forth kernel.

## State mirroring contract

The IDE can switch cores without losing the machine state. For the WASM core
this is a contract tested by `tests/wasm-state.test.js`: after `init`,
`load_program`, `set_segments`, `set_psw` and `set_registers`, execution must
resume exactly at the mirrored program counter with mirrored general registers
intact, rather than at the boot entry that `load_program` alone would leave.

`set_registers` has a subtle rule: element 15 is the **active** program counter.
While `PSW.S` is set it writes the shadow PC and leaves the saved user PC
untouched; with `S` clear it writes ordinary `R15`. `get_registers` reports the
same active view, so the setter and getter round-trip through handler context.

## Divergences: source versus documentation

`doc/Deep16-RTL.md` contains a "Spec ≠ Verhaltenskern" table. Some rows describe
history rather than current source, so verify before quoting it:

| Behaviour | Current source |
|---|---|
| `LD`/`ST` imm5 offset | Sign-extended (−16..+15) in all three cores; the old WASM gap is closed |
| `0xFFFF` fetch | Halts all three |
| `0xFFF1` (FSH) | No-op in all three; WASM now matches JS/RTL |
| `0xFFF8`–`0xFFFE` | No-op in all three; they fall outside the 13-bit SYS prefix |
| `get_registers()[15]` with `PSW.S=1` | Reports the shadow PC in WASM and RTL |
| Physical address | `(segment << 4) + offset`, not the `(segment << 16) | offset` printed in the architecture text |
| Hardware interrupts | JS core has `handleHardwareInterrupt()`; the board's `deep16_core3.sv` takes a level `irq` and enters a synthetic SWI; the parity-tested `deep16_core.sv` and the Rust core have no external IRQ input |

The FSH and `0xFFF8` rows still appear as WASM divergences in the RTL document,
but the Rust decoder now routes only the `0xFFF0`–`0xFFF7` space to `exec_sys`
and treats `FSH` as a behavioural no-op, matching the reference. The pinned test
in `tests/rtl.test.js` only compares JS and RTL for `0xFFF1`, which is why the
stale wording can survive.

Interrupt coverage differs by implementation, and that is architectural: the
JS core has `handleHardwareInterrupt()`, the board's `deep16_core3.sv` has the
`irq` input and the synthetic SWI entry, and the Rust core implements the
trap/PSW side (SWI, RETI, shadow bank) but has no external IRQ input. Programs
that trigger their own `SWI`, keyboard input or Forth execution behave the same
everywhere; externally generated interrupts are proven by the core3 bench and
the board instead of by the three-way parity suite.

## Environment differences that are not parity bugs

- **No cache in the IDE RTL model.** `rtl/deep16_top.sv` explicitly wires the
  cache-flush inputs to nothing and drives hit/miss/penalty counters to zero;
  the PSRAM board build owns the real cache. The IDE still displays the
  counters, so a zero there means "not present", not "perfect hit rate".
- **Keyboard FIFO depth.** The RTL top uses 16 entries and drops a push when
  full, so hosts must pace a typed file by `kbd_available()`; the behavioural
  cores accept the full queue.
- **Timing.** One `step()` retires one instruction in all cores, but only the
  RTL reports cycles, stalls, flushes and retired-instruction counts. Tests
  compare state at retirement boundaries, never wall-clock or cycle counts.

## Related pages

- [JavaScript Reference Core](../cores/js-core.md)
- [WebAssembly Core](../cores/wasm-core.md)
- [RTL Core Microarchitecture](../cores/rtl-core.md)
- [Build, Test and Image Pipeline](../tooling/build-test-and-images.md)
