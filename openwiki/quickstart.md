---
type: guide
title: Quickstart
description: The shortest path to a running Deep16 machine, a typed Forth line, a passing test, and a rebuilt core, plus where to read next by task.
tags: [quickstart, onboarding, ide, tests, build]
sources:
  - id: openwiki-source-05b57c87f4341692de6b154c
    resource: repo://asm/forth.asm
  - id: openwiki-source-86589e93590a1eca60d19cd0
    resource: repo://ERRPLAN.md
  - id: openwiki-source-956d9e1f2f5615b80a8d4ba0
    resource: repo://forth/demo.fth
  - id: openwiki-source-f8d10828394c4129061d5b0e
    resource: repo://index.html
  - id: openwiki-source-0cc31ca306d30bed999278fc
    resource: repo://js/deep16_ui_core.js
  - id: openwiki-source-b57ab1606c48ec3ea7344623
    resource: repo://MEMMAP.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-6df23aa962f11ba40014c90a
    resource: repo://rtl/deep16_core3.sv
  - id: openwiki-source-de73cd8815fd05f54317660e
    resource: repo://rtl/deep16_top.sv
  - id: openwiki-source-d6e77d8e641bba2c4fc6f8e4
    resource: repo://scripts/build_gowin_tile_flash.sh
  - id: openwiki-source-2a8f6d13d52eff24d8527d38
    resource: repo://scripts/embed_forth.mjs
  - id: openwiki-source-da0fe35253069a3157d15bab
    resource: repo://scripts/flash_gowin_tile_flash.sh
  - id: openwiki-source-41517f64370d769c203d48a3
    resource: repo://scripts/make_slices.mjs
  - id: openwiki-source-712026ece84f99a81e00872e
    resource: repo://scripts/serve.mjs
  - id: openwiki-source-1d8266be33d0b23cd8643d88
    resource: repo://tests/boot-script.test.js
generated: { by: "opencode", at: "2026-11-04T17:50:52.684Z" }
verified:
  - by: openwiki/0.7.3
    at: 2026-11-04T17:50:52.684Z
---

# Quickstart

Deep16 is a 16-bit RISC machine: sixteen general-purpose registers, a 20-bit
word-addressed address space (1,048,576 cells), segment registers, a shadow
register bank for traps, and delay slots. It ships with three implementations of
the same ISA — a JavaScript reference core, a Rust/WASM port, and a Verilator
RTL model — plus an assembler, a Forth kernel and a browser IDE.

Nothing needs to be built to try it: the compiled cores are committed.

## Run the IDE

```sh
npm run serve          # http://127.0.0.1:8000, no-cache static server
# or: python3 -m http.server 8000
```

Open the URL. A plain `file://` open will not load the WASM or RTL cores; the
page still works, on the JavaScript core.

Then:

1. open the settings cog in the header and pick a core (`JS`, `WASM`, `RTL`);
2. press **Assemble**, then **Run**;
3. type into the **Screen** tab (screen mode) or the terminal view (terminal
   mode, also behind the settings cog).

The editor starts with a small sample program. The **Optimize** button rewrites
the editor text in place; it never runs automatically.

For the tile machine choose **Tiles** in the same settings menu and load the
**D16D Showcase (tiles)** example. Tiles mode assembles the nano/D16D kernel,
loads the graphics blob from the simulated config flash and paints the 640×360
FiT canvas. The menu runs Flappy; Pac-Man is a flash slice in the current image,
so use `s" pacman" game-run` from the Forth prompt until the menu's **P** hookup
lands.

## The 60-second Forth check

Choose **Terminal** in the settings menu, press **Assemble** and **Run**, then
type:

```forth
: square dup * ;
5 square .
```

You should see `25  ok` and a fresh `>` prompt. Backspace works, and `words`
lists the dictionary. The same kernel also runs in screen mode, where output
goes to the `0xF1000` character buffer instead of the UART.

The board image additionally carries a boot script (`forth/demo.fth`) that
compiles at power-on and prints a memory summary. It defines `free`, `mem` and
`demo`; in the IDE the boot script is part of the image, but console tests skip
it for speed.

## Run the tests

```sh
npm test                        # about 40 files, minutes on one core
node --test tests/rtl.test.js   # just the RTL core
npm run sweep:rtl               # all 65,536 instruction words, 4 seeds
```

`npm test` assembles programs, boots the kernel on the JS core, loads the
committed WASM and RTL packages, and compares machine state. If a test fails,
start with the smallest file that reproduces it:

| Area | File |
|---|---|
| Assembler / ISA encoding | `tests/assembler.test.js` |
| JS ↔ WASM agreement | `tests/cores.test.js` |
| Three-core parity and pipeline | `tests/rtl.test.js` |
| Random programs on all cores | `tests/fuzz.test.js` |
| Forth REPL behaviour | `tests/forth.test.js` |
| Console bytes on three cores | `tests/console-parity.test.js` |
| Segmented map, raster band and getstr pump | `tests/segmented.test.js` |
| Shipped examples (legacy sources excluded) | `tests/examples.test.js` |

## Rebuild a core

Only needed if you change that core's source:

```sh
npm run build:wasm       # Rust core  → wasm/pkg/
npm run build:rtl:wasm   # RTL core   → rtl/pkg/
npm run build:rtl        # native RTL binary, for debugging
```

`wasm/pkg/` and `rtl/pkg/` are committed on purpose. If you change anything
under `rtl/` and skip `build:rtl:wasm`, the tests will quietly keep exercising
the old model.

If you change the kernel or the boot script:

```sh
node scripts/embed_forth.mjs   # after editing forth/demo.fth
npm run image                  # regenerate the image set
```

## Build for the board

This is optional and needs Gowin EDA plus a Tang Nano 9K:

```sh
npm run synth:tile   # D16D image + bitstream
npm run flash:tile   # bitstream, boot image, source and Pac-Man slices
```

The scripts fail early when `gw_sh` or `openFPGALoader` is missing. The tested
machine is the D16nano tile/config-flash build; the older 24K BSRAM builds are
retired. `flash:tile` writes the bitstream, the 1 MB boot image and the slice
image (source screens plus the type-4 Pac-Man block) at `0x200000`; run
`cf-unprotect` on the board first if the block protect is set, and `cf-protect`
afterwards.

`flash:tile` writes the `.fs` already in `fpga/gowin/impl/pnr`, so an RTL change
needs `synth:tile` before it. A bitstream older than the RTL boots and runs but
silently lacks the change; check the `.fs` timestamp against the RTL commit
before trusting a board measurement. `synth:tile` also records hashes of the
tile/sprite/palette/font ROMs in `deep16_board_tile_flash.assets.sha256`, and
`flash:tile` refuses to write if those assets changed, which catches a new boot
image over an old tile bank.

## Where to read next

| If you want to… | Read |
|---|---|
| Understand the machine as a whole | [System Overview](architecture/system-overview.md) |
| Learn the instruction set and CPU state | [ISA and CPU State](architecture/isa-and-cpu-state.md) |
| See the address map and MMIO | [Memory Map and Memory Model](architecture/memory-map-and-memory-model.md) |
| Compare the three cores | [Core Parity and Verification](architecture/core-parity.md) |
| Use or extend the IDE | [DeepWeb IDE](ides/deepweb-ide.md) |
| Work on the assembler or optimizer | [Assembler, Disassembler and Optimizer](ides/assembler-and-optimizer.md) |
| Work on the Forth kernel or BIOS | [Forth Kernel and BIOS](software/forth-kernel.md), [Console, Terminal and Boot Scripts](software/bios-and-console.md) |
| Play or change the showcase games | [D16D Showcase, Flappy and Pac-Man](software/showcase-games.md) |
| Understand the tile/sprite engine | [Video and Peripherals](hardware/video-and-peripherals.md) |
| Add a per-line raster effect or sprite multiplexer | [Video and Peripherals](hardware/video-and-peripherals.md), [Forth Kernel and BIOS](software/forth-kernel.md) |
| Keep interrupts alive at the console prompt | [Console, Terminal and Boot Scripts](software/bios-and-console.md) |
| Understand the FPGA build | [FPGA Board Builds](hardware/board-builds.md) |
| Understand PSRAM, cache and flash boot | [PSRAM, Cache and Flash Boot](hardware/psram-cache-and-flash.md) |
| Change the build or test pipeline | [Build, Test and Image Pipeline](tooling/build-test-and-images.md) |
| Know what is missing or only planned | [Known Gaps, Documentation and Plans](project/known-gaps-and-docs.md) |

## Repository map

| Directory | Contents |
|---|---|
| `js/` | Reference core, assembler, disassembler, optimizer, IDE |
| `wasm/deep16-wasm/` | Rust core and its committed package |
| `rtl/` | SystemVerilog cores, peripherals, DVI, PSRAM/flash, harness |
| `rtl/pkg/` | Committed Verilator→WASM model |
| `asm/` | Forth kernels and example programs |
| `forth/` | Boot-script and demo Forth sources |
| `doc/` | Current architecture, RTL, FPU and programming manuals |
| `tests/` | Node test suite (35 files) |
| `scripts/` | Generators, simulations, synthesis and flash wrappers |
| `fpga/gowin/` | Gowin project, defines and Tcl flows |
| `book/` | German book project |
| `lila/` | Host-side Lua-like language on gforth (not Deep16 software) |

## Gotchas worth knowing on day one

- The **settings cog** hides both the core selector and the console mode; they
  are not in the main toolbar.
- Switching cores mirrors state; it does not reset the machine.
- The **Optimize** button edits your source. It is not applied silently.
- The board's echo cell at `0xF0064` is outside the backed memory window, so
  echo is always on there; the IDE toggle only works on simulation cores.
- Docs and plans are secondary to source. `doc/` is current, `archive/` is
  history, and several root `*PLAN.md` files describe work that does not exist.
- The board's SIC has the timer and the raster compare wired, and `core3` is the
  RTL variant that accepts the IRQ. The raster path is board-verified (one
  request per compare-line visit, two sprites from one OAM slot); the keyboard
  and audio SIC sources remain unconnected.

## Related pages

- [System Overview](architecture/system-overview.md)
- [DeepWeb IDE](ides/deepweb-ide.md)
- [Build, Test and Image Pipeline](tooling/build-test-and-images.md)
- [Known Gaps, Documentation and Plans](project/known-gaps-and-docs.md)
