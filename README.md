# Deep16

A 16-bit RISC ISA with a browser-based assembler, disassembler and simulator
("DeepWeb IDE" / "DeepCode"), and **three interchangeable CPU cores** that
implement it:

| Core | What it is | Speed (µs per retired instruction) |
|---|---|---|
| **JS** | `js/deep16_simulator.js`, the behavioural reference | 0.04 |
| **WASM** | `wasm/deep16-wasm/`, Rust port for speed | 0.04 |
| **RTL** | `rtl/`, SystemVerilog → Verilator → WASM, a real 5-stage pipeline with a 4KB cache | 1.15 native / 2.6 in the browser |

The JS core is the golden reference: the other two are held to it, and
`tests/rtl.test.js` compares all three instruction by instruction. The RTL core
is a *microarchitecture*, not a second behaviour model — it is ~28× slower than
the behavioural cores even compiled natively, which is the price of being
cycle-accurate, and buys structure rather than speed.

Written as a personal architecture project between late November and mid
December 2025 and left unfinished. This repository is the result of picking it
back up: the core is real and works, several bugs are fixed, and the gaps are
documented below instead of being papered over.

## Running the IDE

The IDE is a static page; no build step is needed because both `wasm/pkg/` and
`rtl/pkg/` are committed.

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

A plain file:// open will not work: the WASM modules have to be fetched over
HTTP. Without a server the IDE falls back to the JavaScript core.

Pick the core from the **Kern** dropdown in the header. Switching mirrors the
current machine state into the newly selected core, so the assembled program and
the register contents survive the change. The choice is remembered in
`localStorage`.

To rebuild either compiled core after changing its source:

```sh
npm run build:wasm        # Rust core; needs rustup + wasm-pack
npm run build:rtl:wasm    # RTL core; needs verilator + emscripten
npm run build:rtl         # RTL core, native binary (obj_dir/deep16_rtl)
```

**If you change anything under `rtl/`, re-run `npm run build:rtl:wasm`.**
`rtl/pkg/` is committed, so without the rebuild the tests silently exercise
the previous model.

## Tests

```sh
npm test                        # the whole suite, ~70 s on a single core
node --test tests/rtl.test.js   # just the RTL core (~36 s)
```

Coverage, by file:

| File | What it pins |
|---|---|
| `assembler.test.js` | every encoding, `LDI` range, bit-index immediates |
| `disassembler.test.js` | round trip over all 32768 `LDI` patterns |
| `cores.test.js` | JS↔WASM agreement, `MUL32`/`DIV32` pair semantics |
| `shadow.test.js` | the shadow-register bank across contexts |
| `flags.test.js` | NZVC, including the carry heuristic |
| `mov-imm2.test.js` | the `imm2` function selector |
| `examples.test.js` | all seven programs in `asm/` |
| `forth.test.js` | the Forth kernel, including the keyboard port |
| `wasm-state.test.js` | WASM core state round trips |
| `serial-port.test.js` | the serial port |
| **`rtl.test.js`** | **three-way parity, decode sweep, the pipeline** |
| **`fuzz.test.js`** | **random *programs* against all three cores** |
| `ui-core.test.js`, `ui-stats.test.js` | the IDE's core selection and counter line |

Two of those earn their keep differently. `rtl.test.js` runs a **decode sweep**
— every one of the 65536 instruction words, from four register/PSW seeds, each
executed in isolation and compared against the JS core.

`fuzz.test.js` covers what a sweep structurally cannot: it generates random
*programs* and compares after every step, because every real core bug found
while building the pipeline was a property of a *sequence*, not of a word — the
shadow-bank bypass only appeared inside a handler, the keyboard FIFO pop only
while a program polled for keys. It asserts its own coverage (49 of 60 random
programs must enter the shadow bank) so it cannot quietly stop testing that.
Deepen it with `FUZZ_SEEDS=500 FUZZ_STEPS=1000`.

Two more checks are not part of `npm test`:

```sh
npm run sweep:rtl    # 524288 word executions, 4 seeds — must report 0
npm run trace:rtl -- asm/forth.asm 200 --keys "1 2 + .\n"
node scripts/bench.mjs   # MIPS of all three cores
```

## Architecture in one page

- **Registers** `R0`–`R15`, `R15` is the PC. 16-bit words.
- **Memory** 20-bit address space, 1M words. Segmented via `CS`/`DS`/`SS`/`ES`,
  effective address `phys = (segment << 4) + offset`.
- **Shadow registers** `R0`, `R1`, `R2`, `R3`, `R13`, `R14`, plus `PSW`/`PC` and
  the four segment registers, swapped in while `PSW` bit 5 is set (handler
  context) and restored on return. `R4`–`R12` are **not** shadowed — they
  belong to both contexts. All three cores implement the same banking.
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
rtl/                  SystemVerilog core: core, regfile, cache, pkg glue
rtl/deep16_cache.sv   4KB unified cache (spec 7.4)
rtl/pkg/              Verilator+Emscripten output, committed like wasm/pkg
rtl/sim/              C harness driving the model from tests and the IDE
asm/                  example programs, incl. a Forth kernel
doc/                  current documentation
book/                 the book sources, EPUB/Kindle builds
old/                  earlier documents and prototypes, kept for reference
scripts/              bench, decode sweep, trace diff
tests/                the test suite
```

Further reading: [`VERILOG.md`](VERILOG.md) is the plan and decision log for
the RTL core; [`doc/Deep16-RTL.md`](doc/Deep16-RTL.md) documents its
microarchitecture, debug bus and verification tooling.

## State of the project

`deep16_project_summary.md` is the author's original status document and claims
"PRODUCTION READY". That is aspirational marketing text, not a status report.

What works today: all three cores agree, the assembler and disassembler round
trip, all seven examples assemble and run, and the Forth kernel in
`asm/forth.asm` is a working REPL — including interactive keyboard input, on
all three cores. The RTL core is verified across the entire instruction space:
the decode sweep reports 0 divergences over 524288 executions from four seeds,
and random programs agree step for step.

Known gaps, all verified rather than assumed:

- **The FPU does not exist.** `doc/Deep16-FPU.md` specifies 732 lines of it;
  no core contains a line of floating-point code.
- **No ILL trap.** Described in `doc/Deep16-Arch.md` §3.2 and §4.7, implemented
  nowhere.
- **Hardware-interrupt handling exists only in the JS core.** The JS core has
  `handleHardwareInterrupt()`; `lib.rs` and the RTL core have neither, so
  generated interrupts behave differently. Everything a program triggers
  itself — SWI, the keyboard, the Forth kernel — works everywhere.
- **The core counters are desktop-only.** The IDE shows CPI, stalls, flushes and
  the cache hit rate next to the run indicator, with a short form for narrow
  screens. The short form is not yet visible on phones — see `VERILOG.md`,
  "Risiken / offene Punkte".
- **Documentation versions** v2.0 through v5.2 once coexisted. `doc/` is now the
  single current version; `old/` holds the rest.

Known ISA quirks that are not bugs: `LDI` always targets `R0` regardless of
what you write, and `MUL32`/`DIV32` require an *even* destination register
because the 32-bit value lives in the pair `R[d]:R[d+1]`. Writing `MUL32 R14, x`
therefore overwrites the PC.

Two things the assembler enforces from `doc/Deep16-Arch.md` §3.7 that older
examples do not: `AND` has no immediate form (slot `110 00111` belongs to
`CLRB`, so `AND R1, 3` is rejected - load a mask and use `AND Rd, Rs`), and
the immediates of `OR`/`XOR`/`TBC`/`TBS`/`CLRB` are bit *indexes* 0-15, not
values: `OR R1, 3` sets bit 3, not bits 0 and 1.