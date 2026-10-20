# Versions and the `ver` word

Status: **agreed 2026-10-20, to be implemented with the next version bump.**
Today a single tag (`v1.1`) names the whole machine; from the next change the
three components are versioned and bumped **independently**.

## Three versions, three components

| Version | Covers | Changes when |
|---|---|---|
| **DeepForth** | the kernel in `asm/forth.asm`: dictionary, compiler, interpreter, REPL, the baked boot script | a word, the compiler, the boot script or the image layout changes |
| **BIOS** | the `f0`–`f5` handler (both the screen and the `CONSOLE_UART` variants), the SWI entry, the UART `putch`/`getstr` | a BIOS function or its contract changes |
| **FPGA** | the RTL and the bitstream: core, PSRAM controller/bridge/cache, board top, pin/timing constraints | any RTL change that alters the shipped bitstream |

A release is the **tuple**, e.g. `DeepForth 1.1 / BIOS 1.0 / FPGA 1.1`. The git
tag still names the release as a whole; the tuple is what `ver` prints and what
the changelog records.

## The `ver` word

`ver ( -- )` prints exactly one line:

```
DeepForth 1.1  BIOS 1.0  FPGA 1.1
```

Rules:

- no arguments, nothing left on the stack, returns to the interpreter;
- decimal `major.minor`, no leading zeroes, two spaces between the fields;
- one trailing CR+LF, no prompt of its own — the REPL adds ` ok` and the next
  `>` like it does for any word;
- works interpreted (`ver`) **and** compiled (`: v ver ;` prints when `v` runs);
- output goes through the normal console path, so it appears even with the echo
  off (only ` ok` and the prompt are echo-gated);
- `bver` (BIOS function 0) must return the same BIOS pair, encoded as
  `major << 8 | minor` (`0x0100` = 1.0), instead of its current fixed `0x0001`.

## One source of truth

Add a `VERSION` file at the repo root:

```
deepforth 1.1
bios 1.0
fpga 1.1
```

A small generator (`scripts/make_version.mjs`) produces both consumers from it:

- `asm/version.inc` — `.equ` constants and the `.text` strings the `ver` word
  prints, included by `asm/forth.asm`;
- `rtl/version.sv` — localparams `DF_VERSION`, `BIOS_VERSION`, `FPGA_VERSION`
  for the top (and, if wanted, the debug bus).

`npm run image`, `npm run synth:gowin` and `npm test` all run the generator
first, so the three copies cannot drift. A test asserts that the strings in the
image match the RTL localparams and the `VERSION` file, and that `bver` returns
the BIOS pair.

## Bumping

1. Edit `VERSION` — bump only the components that changed.
2. `npm run image` (and `npm run synth:gowin` for a bitstream).
3. Tag the release; record the tuple in the commit message and, if the line
   changes, in `README.md` / `D16MINI.md`.

Nothing in this document requires the three numbers to move together: a
DeepForth-only change leaves BIOS and FPGA where they are, which is the point.
