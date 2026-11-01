---
type: "Reference"
title: "RTL Core Microarchitecture"
openwiki_generated: true
verified:
  - by: openwiki/0.7.2
    at: 2026-11-01T09:36:37.731Z
sources:
  - id: openwiki-source-6d9dc09f47fb249425320461
    resource: repo://doc/Deep16-RTL.md
  - id: openwiki-source-f1071c416f562f4ca742093e
    resource: repo://rtl/deep16_cache.sv
  - id: openwiki-source-9355204a406c91981555258c
    resource: repo://rtl/deep16_core.sv
  - id: openwiki-source-6df23aa962f11ba40014c90a
    resource: repo://rtl/deep16_core3.sv
  - id: openwiki-source-9185f059d0cd601b0bcd94ee
    resource: repo://rtl/deep16_divider.sv
  - id: openwiki-source-0c322f41fb3643b953b4bfa5
    resource: repo://rtl/deep16_regfile.sv
  - id: openwiki-source-de73cd8815fd05f54317660e
    resource: repo://rtl/deep16_top.sv
  - id: openwiki-source-b2325b4e0f4b5f9a156f872b
    resource: repo://rtl/psram/deep16_psram_mem.sv
  - id: openwiki-source-6be0127e9bef0fdf99aa2d93
    resource: repo://rtl/sim/harness.cpp
generated: { by: "opencode", at: "2026-11-01T09:36:37.731Z" }
---


# RTL Core Microarchitecture

The SystemVerilog CPU in `rtl/` is the third Deep16 core. It is not a second
behaviour model: one `step()` still retires exactly one instruction and leaves
the same architectural state as the JS reference. What it adds is real timing,
hazards, a debug bus and board-level peripherals.

Two CPU variants are built from the same package:

- `deep16_core` — the five-stage pipeline used by the IDE model and the
  D16MINI board.
- `deep16_core3` — the reduced D16nano core with one instruction in flight and
  no hardware divider.

## Why ordering survives a pipeline

`deep16_core` is IF / ID / EX / MEM / WB. The design preserves sequential
semantics without a conventional scoreboard by making each instruction in EX
compute the **complete state after itself**: `d16_ctx_t` carries PC, PSW, normal
and shadow segments, the shadow GP registers, delay-slot bookkeeping and the FSH
flag. That bundle is bypassed from MEM and WB back into EX, so an instruction
sees all older writes and none of the younger ones. PSW flags therefore do not
need to be written back before a dependent conditional jump reads them.

GPRs stay in the register file with EX/MEM and WB bypass. The program counter is
architectural state in the bundle, not a private fetch register; fetch follows
the active PC and applies a pending transfer only after the delay slot.

## Hazards, stalls and flushes

- **Load-use:** a load result appears in MEM, so a consumer one instruction later
  stalls for one cycle. IF/ID and ID/EX freeze while a bubble is pushed into
  MEM; MEM must keep draining or the load never reaches WB.
- **Divider:** `DIV`/`DIV32` hold the pipeline for the iterative divider's
  latency. The start pulse must re-arm per divide, not per residence in EX.
- **Memory:** the top can stall the front end while a fetch or data word is in
  flight (`mem_stall`); the core freezes IF/ID/EX and lets WB drain.
- **Redirects:** the word fetched behind a delay slot or `SWI`/`RETI` is usually
  wrong-path and is squashed. The flush counter reports discarded fetches.
- **Data-port redirects:** `SWI`'s vector word and a load into `R15` only become
  known in MEM/WB. `pc_pending` and `mem_late` span those clocks and prevent the
  fetch from taking a stale target or letting a younger word enter the pipe.

Side effects outside WB are rare and deliberately gated by “this instruction
leaves the stage this cycle”. The keyboard pop and UART strobes use
`run && !step_freeze && !stall && !mem_stall`; gating on retirement alone
silences the board console, a failure that no `step()` test sees.

## Register file

R15 is not stored in the file; the core maps it to the bundle. The file holds
the normal bank and the six shadow registers `R0'`–`R3'`, `R13'`, `R14'`.
`is_banked()` names exactly that set; all other registers are shared.

Three read ports return both banks raw, and bank selection happens in EX with
the instruction's effective PSW. That is what makes a context switch in front of
the pipeline affect younger, already-fetched instructions correctly.

Two write ports commit in WB: port B (the low word of `MUL32`/`DIV32`) has lower
priority than port A (the instruction's `Rd`), and each carries the bank of its
own instruction. The debug bus has a third write path for state seeding. Older
documentation describing three *architectural* write ports predates moving PC
into the bundle.

## Divider

`deep16_divider` is an iterative radix-4 restoring divider: 16 iterations, two
dividend bits per iteration, producing a 16-bit quotient and a 16-bit remainder.
The 18-bit working value is enough because the operation is architecturally
32/16, not 32/32. `DIV` is the same circuit with the top dividend half zeroed.

`busy` holds the pipeline; `done` is sticky and clears on the next start, so a
new divide cannot observe the previous quotient for a cycle. `core3` omits this
block entirely and traps `DIV`/`DIV32` to software instead.

## Cache: module versus build

`rtl/deep16_cache.sv` implements a 4 KB unified cache: 256 lines × 8 words,
direct-mapped, write-through with update on hit. A miss still returns the
requested word from memory in the same cycle, so the pipeline never stalls and
retirement parity is unchanged. `0xFxxxx` is never cached, because MMIO, screen
memory and both ROMs have side effects or must stay replaceable. `FSH`
invalidates every line.

Important build fact: **the IDE RTL top does not instantiate this cache.**
`deep16_top.sv` wires the flush inputs to nothing and drives hit/miss/penalty
counters to zero. The PSRAM board path has its own cache inside
`deep16_psram_mem`: 512 lines × 2 words, write-through with update on hit.

## Reduced core3 (D16nano)

`deep16_core3` is IF / ID / EX-commit with one instruction in flight. It reuses
the proven EX semantics (delay slots, `SWI`/`RETI`, shadow bank, `MUL32`, flags,
segment arithmetic) but drops the speculative front end, forwarding network and
load-use interlock. Memory is synchronous and shared with fetch; a load commits
one cycle later or after the serial PSRAM transaction.

`core3` is the only RTL variant with a hardware `irq` input, taken at an
instruction boundary when `PSW.I` is set, the core is in the normal bank and the
current instruction is not a delay slot. It targets 6.75 MHz on the Tang Nano 9K
and trades throughput for area.

## Top level and debug bus

`deep16_top` owns the 2^20-word memory array, boot ROM, 16-entry keyboard FIFO,
UART monitor FIFO and the debug bus. It selects `deep16_core3` under the D16nano
configuration and `deep16_core` otherwise, and converts the core's memory ports
into array accesses (or PSRAM transactions on the board).

The debug bus is the harness/IDE seam:

- `0x00`–`0x0F` normal registers and PC, `0x10`–`0x14` PSW and segments;
- `0x15`–`0x20` shadow state and shadow GPRs;
- `0x21`–`0x23` delay/branch state, `0x24`–`0x2C` event and recent access;
- `0x2D`–`0x2E` cycles, `0x54`–`0x59` stalls, flushes and retired instructions;
- `0x60`–`0x6E` pipeline internals and keyboard FIFO state.

Writes are only honoured while the pipeline is stopped (`run=0`), and a write
flushes the pipeline: already-fetched instructions belong to the state the
caller is replacing.

## Harness

`rtl/sim/harness.cpp` exposes a C ABI that mirrors the Rust core's exports, so
tests and the IDE treat both compiled cores the same way:

- `init`, `reset`, `step`, `run_steps`, `load_program`, `poke`/`peek`;
- getters/setters for registers, PSW, segments, memory slices, shadow state;
- device hooks `kbd_push`, `kbd_available`, `uart_rx_push`, `uart_tx_take`;
- counters for cycles, stalls, flushes, retired instructions and cache stats.

`run_cycles(n)` is the free-run diagnostic: it keeps the pipeline running across
retirements and samples cycle/instructor counts at the n-th retirement, so CPI
reflects the core rather than the per-step refill. Its architectural result is
identical to n calls of `step()`; tests assert exactly that.

The native CLI (`rtl/sim/main_native.cpp`) and the ASM harnesses under
`rtl/sim/` drive individual peripherals — UART FIFO, PS/2 receiver, timer, SPI,
I2S, SIC, PSRAM, flash boot and the installer.

## Related pages

- [Core Parity and Verification](../architecture/core-parity.md)
- [ISA and CPU State](../architecture/isa-and-cpu-state.md)
- [FPGA Board Builds](../hardware/board-builds.md)
- [PSRAM, Cache and Flash Boot](../hardware/psram-cache-and-flash.md)
