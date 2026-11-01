---
type: project-status
title: Known Gaps, Documentation and Plans
description: Verified limitations of the current machine, how the documentation set is organised, which plan documents are proposals rather than features, and the book and LILA side projects.
tags: [status, gaps, documentation, plans, roadmap, book, lila]
verified:
  - by: openwiki/0.7.2
    at: 2026-11-01T09:36:37.731Z
sources:
  - id: openwiki-source-a28946850ce54d03e71935f2
    resource: repo://asm/forth_nano.asm
  - id: openwiki-source-5a38679f1897efcf5329ca59
    resource: repo://BIRDPLAN.md
  - id: openwiki-source-f78e662d4c24a8a09e381fad
    resource: repo://book/README.md
  - id: openwiki-source-83a08a8d1943fb1613dd04b3
    resource: repo://css/responsive.css
  - id: openwiki-source-9f28c9e48c1e648300a3ace1
    resource: repo://doc/Deep16-FPU.md
  - id: openwiki-source-86589e93590a1eca60d19cd0
    resource: repo://ERRPLAN.md
  - id: openwiki-source-514d4eeac936df3c8e2da0ea
    resource: repo://FLOATIMPL.md
  - id: openwiki-source-51d253a42d7ce952940bdcb9
    resource: repo://FPUEMUPLAN.md
  - id: openwiki-source-cc1b971e04f30ee54fe7e77d
    resource: repo://FROGPLAN.md
  - id: openwiki-source-3a8c2c486916b0c5b3d4874a
    resource: repo://IMPROVE.md
  - id: openwiki-source-558f92ad48bad4c1a8f65265
    resource: repo://js/deep16_simulator.js
  - id: openwiki-source-0cc31ca306d30bed999278fc
    resource: repo://js/deep16_ui_core.js
  - id: openwiki-source-d9cd8fddbb3a3a0b0c1da1cc
    resource: repo://js/deep16_worker.js
  - id: openwiki-source-0410d8f7ff4c372786b09cb7
    resource: repo://lila/README.md
  - id: openwiki-source-b57ab1606c48ec3ea7344623
    resource: repo://MEMMAP.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-10121f209c268e2bcf7976c9
    resource: repo://rtl/deep16_board.cst
  - id: openwiki-source-9355204a406c91981555258c
    resource: repo://rtl/deep16_core.sv
  - id: openwiki-source-6df23aa962f11ba40014c90a
    resource: repo://rtl/deep16_core3.sv
  - id: openwiki-source-9185f059d0cd601b0bcd94ee
    resource: repo://rtl/deep16_divider.sv
  - id: openwiki-source-de73cd8815fd05f54317660e
    resource: repo://rtl/deep16_top.sv
  - id: openwiki-source-6a76c8a50a08a606b2724b3c
    resource: repo://rtl/deep16_uart.sv
  - id: openwiki-source-af7d4628c4b6576ed8554612
    resource: repo://SCROLLPLAN.md
  - id: openwiki-source-f8c122a10ffdf7b7f28c6ae5
    resource: repo://SLIMPLAN.md
  - id: openwiki-source-ea71d94906bd6f78a53ccbda
    resource: repo://STATUS.md
  - id: openwiki-source-e74227ee06b16f894c3e3826
    resource: repo://TODO.md
  - id: openwiki-source-73d3f48a29e92b24797106c2
    resource: repo://VERSIONING.md
  - id: openwiki-source-8c5558aa55bcb63fa02bf537
    resource: repo://wasm/deep16-wasm/src/lib.rs
generated: { by: "opencode", at: "2026-11-01T09:36:37.731Z" }
---

# Known Gaps, Documentation and Plans

This page separates three things that look alike in a repository this size:

- **verified limitations** — behaviour the code does not have today;
- **documentation drift** — text that describes an older machine;
- **plans** — design notes and proposals, some explicitly unimplemented.

The rule used throughout: source code and tests decide what is true. A plan
document is evidence of intent, never of implementation.

## Verified gaps

### The FPU does not exist

`doc/Deep16-FPU.md` is a 732-line manual for a floating-point unit: a fixed
two-register window (`F0 = R2:R3`, `F1 = R4:R5`), IEEE-754 single precision, and
transcendental `FEXP`/`FLOG` operations. It reads like a specification because
that is all it is — **no core contains floating-point code**, and no FPU
instruction is decoded by the assembler, the JS core, the WASM core or the RTL.

`FPUEMUPLAN.md` proposes implementing the operations as an ILL trap and software
emulation; it is marked "design agreed, nothing implemented". `FLOATIMPL.md`
adds integer↔float conversion design, also unimplemented. Treat the FPU manual
as a design target, not as documentation of a feature.

### The ILL trap is narrow

The ILL trap exists **only in the reduced `core3`** used by the D16nano build,
and it covers **only `DIV`/`DIV32`**:

- `core3` has no iterative divider. When a division actually needs one — a
  non-zero divisor, and an even destination for `DIV32` — the core redirects to
  the ILL vector at physical address 0 instead of executing it.
- A trap taken while already in the shadow bank is a double fault and is not
  trapped again.
- The D16nano kernel (`asm/forth_nano.asm`) installs a vector-0 handler that
  emulates both instructions in software.
- The full D16 core keeps the hardware divider (`rtl/deep16_divider.sv`), so it
  has no need for this trap.

There is still **no general undefined-opcode trap** and no FPU trap. An unknown
word does not raise ILL.

### Interrupt wiring is much narrower than the documentation suggests

Three separate facts are easy to conflate:

1. The **SIC** decodes four sources (raster, audio, timer, keyboard) at
   `0xF00B0`, but the board wires only the timer tick. The source vector is
   `{raster_src, 1'b0, timer_tick, 1'b0}`, and `raster_src` is guarded by
   `` `D16_NANO ``, a macro no build file defines (the builds define
   `` `D16NANO ``). Audio and keyboard are constant zero; the I2S `fifo_irq`
   output is unconnected.
2. The **RTL `core3` does implement hardware-interrupt entry** — IRQ input,
   instruction-boundary acceptance, vector cell 1, shadow-bank switch. The
   full `deep16_core` has no IRQ input at all.
3. The **WASM core has no interrupt input**. The **JS core** has the most
   complete model, with `handleHardwareInterrupt()` and an `irqLine()` hook.

`README.md` still says hardware-interrupt handling "exists only in the JS core"
and that "the RTL core has neither". That sentence predates `core3`; the RTL
does handle interrupts in the D16nano build, and it is the only RTL variant that
does. What remains true is that the three cores do not model interrupts
identically.

### Per-core capability gaps

These follow from the cores being different implementations rather than one
shared model:

| Feature | JS | WASM | RTL |
|---|---|---|---|
| Keyboard port | Yes | Yes | Yes (16-entry FIFO) |
| UART | Yes | Yes | Yes |
| SD card / SPI | Model | Absent | Yes (D16_PERIPH) |
| SIC / timer | Model | Absent | Yes (timer wired) |
| Screen write hook | Yes | Absent | Via board/tile path |
| Hardware IRQ | Yes | No | `core3` only |
| D16nano ILL trap | Yes (`d16nano` flag) | No | `core3` only |

### Core counters on phones

`README.md` says the short counter line "is not yet visible on phones". The CSS
now disagrees: `@media (max-width: 900px)` hides `.core-stats` and shows
`.core-stats-mini`, and the controller fills both elements with CPI and cache
hit rate. The README note is stale.

### The worker is scaffolding

`js/deep16_worker.js` is a complete simulator worker, but nothing constructs it:
there is no `new Worker(...)` anywhere, no script tag loads it, and `workerRun()`
posts to an undefined `this.worker`. Execution is main-thread only. See
[DeepWeb IDE](../ides/deepweb-ide.md).

## Documentation landscape

### `doc/` is the current reference

`doc/` is the single current documentation set; `old/` keeps superseded
versions (v2.0 through v5.2 once coexisted). The important files:

| File | Covers | Reliability |
|---|---|---|
| `doc/Deep16-Arch.md` | ISA, PSW, traps, addressing | Current; the assembler follows it |
| `doc/Deep16-RTL.md` | Pipeline, debug bus | Partly stale (see below) |
| `doc/Deep16-FPU.md` | FPU specification | Design only; nothing implemented |
| `doc/Deep16-Prog-Man.md`, `User-man.md` | Programming and IDE manuals | Current at the feature level |
| `doc/Deep16-features.md`, `Deep16-programming-examples.md` | Feature survey, examples | Descriptive |
| `doc/FiT-Graphics-howto.md` | Tile engine programming | Current, detailed |
| `doc/Interrupts.md`, `BLOCKARCH.md`, `Changes.md` | Interrupts, block diagram, changelog | Reference |

### Known drift in the reference docs

Documentation is secondary to source, and several passages are known to lag:

| Document | Claim | Source reality |
|---|---|---|
| `MEMMAP.md` §SPI | "CS1 is pin 25 for an external flash; the on-board configuration flash is not used" | The tile build boots from that flash at `0x100000`; flash pins are MSPI 59–62; pin 25 is I2S BCLK |
| `MEMMAP.md` §UART | Divisor 234 presented as "the 27 MHz value" | The RTL derives `CLK_HZ / BAUD`: 117 at 13.5 MHz, 59 at 6.75 MHz |
| WASM keyboard comment | "the RTL core has a 128 entry FIFO" | `deep16_top` uses 16 entries |
| `README.md` | RTL has no interrupt handling | `core3` does; only the full core does not |
| `README.md` | Counter short form not visible on phones | `responsive.css` shows it below 900 px |

The pattern is consistent: docs describe the machine at the time they were
written, and the board build has moved fastest. When a doc and the RTL disagree,
check the RTL register decode, the pin constraints and the tests.

### Root-level plans

The repository root carries plan and design documents. None of these are
features; each states its own status:

| Document | Subject | Status it declares |
|---|---|---|
| `TODO.md` | FiT scrolling integration | Open |
| `SCROLLPLAN.md` | Four-direction FiT scrolling | In progress (RTL and terminal switched) |
| `FROGPLAN.md` | Frogger on the tile engine | Plan, with a hardware update note |
| `BIRDPLAN.md` | Visible flap and idle blink | Plan only, nothing implemented |
| `TILESIM.md` | FiT graphics in the simulation | Design/implementation brief |
| `SLIMPLAN.md` | Slimming the D16nano build | Design note with measured budget |
| `IMPROVE.md` | Instruction-decode cleanup | Planned, not applied |
| `ERRPLAN.md` | Error investigations | Open items |
| `FPUEMUPLAN.md` | FPU via ILL | Design agreed, nothing implemented |
| `FLOATIMPL.md` | Integer↔float conversion | Design note, nothing implemented |
| `VERSIONING.md` | Independent component versions | Agreed, to be implemented |
| `OPTIMIZE.md`, `GFX.md`, `VIDEO.md`, `SOFTPCM.md`, `USERFLASH.md` | Optimizer, graphics, video, audio, flash notes | Mixed; check each header |

`archive/` holds retired plans and older status material, including
`archive/deep16_project_summary.md`. That summary calls the project "PRODUCTION
READY"; both its own header and `README.md` say the phrase was aspirational
marketing copy rather than a measurement.

### `STATUS.md` is the book's log

`STATUS.md` (1,381 lines, last edited 2026-10-16) is written in German and tracks
the **book and Forth kernel**, not the machine's release status. It contains a
decision log, a memory map of the kernel, next steps, and a "Bekannte Mängel"
(known defects) section whose headline answer is "none" — that refers to the
book's own defect list, not to the FPU/ILL/interrupt gaps above. It also
records open work: the Forth CORE/CORE-EXT tier-3 word set, typing a source file
in the browser (never run there), chapters 9+, and `GFX` as unimplemented.

Read it as a working journal with dates, not as a specification.

## Versioning is still a proposal

`VERSIONING.md` proposes splitting one release tag into three independently
bumped versions:

| Version | Covers |
|---|---|
| DeepForth | Kernel, compiler, interpreter, REPL, boot script |
| BIOS | `f0`–`f5` handlers, SWI entry, UART `putch`/`getstr` |
| FPGA | RTL, PSRAM/cache, board top, constraints |

It specifies a root `VERSION` file, a generator producing `asm/version.inc` and
`rtl/version.sv`, a `ver` word printing `DeepForth x.y  BIOS x.y  FPGA x.y`, and
a test keeping all copies aligned.

**None of that exists yet.** There is no `VERSION` file, no
`scripts/make_version.mjs`, no `asm/version.inc` and no `rtl/version.sv`. The
document's own status line is "agreed 2026-10-20, to be implemented with the
next version bump", and that is exactly how it should be read.

## The book

`book/` is a German-language book project, *Deep16 für 6502-Programmierer*
("Deep16 for 6502 programmers"). The 6502 is only a comparison point; the
subject is the Deep16.

`book/README.md` is the draft plan: three parts (arriving from 8-bit, what makes
the Deep16 different, practice), eight chapters, and appendices for an
instruction reference, PSW layout, glossary and tool sources. It ends with open
questions about chapter length and how much 6502 contrast to keep.

The chapters themselves (`book/kap01.md` … `kap08.md`, `book/anhang.md`) and the
build tooling under `book/build/` and `book/epub/` exist, but the plan is the
authoritative statement of scope. The book is documentation of the machine, not
part of its runtime.

## LILA

`lila/` is a **host-side prototype**, not Deep16 software: a small Lua-like
language compiled to Forth and run on gforth's compatibility layer. It is
invoked as `gforth lila/test.fs`, or by including `lila/lila.fs` and calling
`lila-load` / `lila-eval`.

It supports assignments, infix arithmetic, string concatenation and comparison,
`print`, `if`/`elseif`/`while`, numeric `for`, `break`, functions, tables and
strings, with a garbage collector and hash table in the same directory. Nothing
in it runs on the Deep16, in the IDE or on the FPGA; it is a separate experiment
that happens to use Forth as a compilation target.

## What "works today" means

`README.md` states the verified positive case, and it is worth keeping next to
the gaps:

- all three cores agree on the instruction set;
- the assembler and disassembler round trip;
- the example programs assemble and run;
- the Forth kernel is a working REPL with interactive keyboard input on all
  three cores;
- the RTL core is verified across the instruction space (decode sweep with zero
  divergences, plus random-program step comparison).

The limitations above are about absent features, not about a broken machine.
The way to settle any statement on this page is the test suite, and the way to
settle a hardware claim is the RTL plus the constraints — not a plan document.

## Related pages

- [System Overview](../architecture/system-overview.md)
- [Quickstart](../quickstart.md)
- [Core Parity and Verification](../architecture/core-parity.md)
- [DeepWeb IDE](../ides/deepweb-ide.md)
