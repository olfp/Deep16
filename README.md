# Deep16

A 16-bit RISC ISA with a browser-based assembler, disassembler and simulator
("DeepWeb IDE" / "DeepCode"), plus a Rust→WASM core for speed.

Written as a personal architecture project between late November and mid
December 2025 and left unfinished. This repository is the result of picking it
back up: the core is real and works, several bugs are fixed, and the gaps are
documented below instead of being papered over.

## Running the IDE

The IDE is a static page; no build step is needed because `wasm/pkg/` is
committed.

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

A plain file:// open will not work: the WASM module has to be fetched over
HTTP. Without a server the IDE falls back to the JavaScript core.

To rebuild the WASM core after changing `wasm/deep16-wasm/src/lib.rs`:

```sh
npm run build:wasm     # needs rustup + wasm-pack
```

## Tests

```sh
npm test
```

41 assertions over four files: `tests/assembler.test.js`,
`tests/disassembler.test.js`, `tests/cores.test.js`, `tests/examples.test.js`.
They cover the ALU encodings, an assembler/disassembler round trip, agreement
between the JS and WASM cores, and all seven example programs in `asm/`.

The four older scripts in `scripts/` also run again but only print output -
they make no assertions.

## Architecture in one page

- **Registers** `R0`–`R15`, `R15` is the PC. 16-bit words.
- **Memory** 20-bit address space, 1M words. Segmented via `CS`/`DS`/`SS`/`ES`,
  effective address `phys = (segment << 4) + offset`.
- **Shadow registers** `R0`, `R1`, `R2`, `R13`, `R14`, plus `PSW`/`PC` and the
  four segment registers, saved on hardware-interrupt entry and restored on
  return. `PSW` bit 5 selects the shadow bank.
- **Instructions** are 16 bits, with variable-length opcode prefixes: `0`
  is `LDI`, `10` is LD/ST, `110` is the ALU and shift group, `111` prefixes the
  control-flow, system and extended instructions.
- **I/O** 80×25 text screen memory-mapped at `0xF1000`, keyboard on
  `0xF0060`/`0xF0062`.
- **Startup** a 16-word ROM at `0xFFFF0` zeroes `DS`/`SS`, builds `0x0100` in
  `R1`, and jumps there, so programs conventionally start at `0x0100`.

Full reference: [`doc/Deep16-Arch.md`](doc/Deep16-Arch.md).
Programming guide: [`doc/Deep16-Prog-Man.md`](doc/Deep16-Prog-Man.md).

## Layout

```
index.html            the IDE
js/                   assembler, disassembler, simulator, UI
wasm/deep16-wasm/     Rust core (mirrors js/deep16_simulator.js)
wasm/pkg/             built WASM, committed on purpose - the IDE loads it
asm/                  example programs, incl. a Forth kernel
doc/                  current documentation
old/                  earlier documents and prototypes, kept for reference
scripts/              older manual test scripts
tests/                the test suite
```

## State of the project

`deep16_project_summary.md` is the author's original status document and claims
"PRODUCTION READY". That is aspirational marketing text, not a status report.

What works today: both CPU cores agree, the assembler and disassembler round
trip, all seven examples assemble and run, and the Forth kernel in
`asm/forth.asm` is a working REPL.

Known gaps, all verified rather than assumed:

- **The FPU does not exist.** `doc/Deep16-FPU.md` specifies 732 lines of it;
  neither core contains a line of floating-point code.
- **No ILL trap.** Described in `doc/Deep16-Arch.md` §3.2 and §4.7, implemented
  nowhere.
- **The WASM core has no hardware-interrupt handling.** The JS core has
  `handleHardwareInterrupt()`, `lib.rs` has nothing, so the two cores behave
  differently in WASM mode. Keyboard input therefore only reaches the Forth
  kernel with the JS core selected.
- **`CLRB` is specified but absent.** `doc/Deep16-Arch.md` §3.7 puts it at
  `110 00111`; both cores execute that slot as a plain `AND Rd, imm` and the
  assembler rejects the mnemonic. For the same reason the spec's reading of
  `OR`/`XOR Rd, imm` as a bit-index operation does not match the
  implementation, which ANDs/ORs/XORs with the 4-bit literal. `asm/swi-test.asm`
  is written against the implementation, not the spec, and runs correctly.
- **Documentation versions** v2.0 through v5.2 once coexisted. `doc/` is now the
  single current version; `old/` holds the rest.

Known ISA quirks that are not bugs: `LDI` always targets `R0` regardless of
what you write, and `MUL32`/`DIV32` require an *even* destination register
because the 32-bit value lives in the pair `R[d]:R[d+1]`. Writing `MUL32 R14, x`
therefore overwrites the PC.