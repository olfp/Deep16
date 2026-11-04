---
type: "Reference"
title: "Forth Kernel and BIOS"
openwiki_generated: true
sources:
  - id: openwiki-source-a28946850ce54d03e71935f2
    resource: repo://asm/forth_nano.asm
  - id: openwiki-source-05b57c87f4341692de6b154c
    resource: repo://asm/forth.asm
  - id: openwiki-source-c14f3342b8ee81b2c622be55
    resource: repo://scripts/make_image.mjs
  - id: openwiki-source-41517f64370d769c203d48a3
    resource: repo://scripts/make_slices.mjs
  - id: openwiki-source-7e7e29e4631f6834da144f22
    resource: repo://tests/forth.test.js
  - id: openwiki-source-e9622fb0632e821af1bdf060
    resource: repo://tests/uart-kernel.test.js
generated: { by: "opencode", at: "2026-11-04T15:30:01.509Z" }
verified:
  - by: openwiki/0.7.3
    at: 2026-11-04T15:30:01.509Z
---


# Forth Kernel and BIOS

DeepForth is written in Deep16 assembly, not generated from a host language.
There are two sources:

| File | Role |
|---|---|
| `asm/forth.asm` | The portable kernel: one source, several build variants |
| `asm/forth_nano.asm` | The D16nano fork: adds the ILL/IRQ handlers, software divide, segmented layout and tile/flash words |

Both are assembled by `js/deep16_assembler.js`, so the kernel is also a
continuous test of the toolchain. `FORTH.md` is the user-facing manual; this
page is about how the system is put together.

## Build variants

The same source is assembled with different defines:

| Define | Effect |
|---|---|
| `CONSOLE_UART` | Serial BIOS, board memory layout (dictionary below the BIOS) |
| `D16NANO` | Selects `forth_nano.asm` and the software-divide path |
| `D16SEG` | Segmented data/stack layout for the tile build |
| `D16D` | Adds the gfx BIOS call, `gfx` word and the showcase entry |
| `BOOT_DIAG` | Temporary boot diagnostics |

The D16nano fork also adds `psw`, `seg-base!` and `call-far` for segment
loaders, plus the `9 screen` flash-screen loader.

`scripts/make_image.mjs` selects the file and defines, assembles it, and lays the
result into the 24K-word window; it also asserts that the BIOS size and the
sections still fit.

## Image layout

The image is a set of `.org` sections, and the headroom between them is part of
the design:

| Address | Contents |
|---|---|
| `0x0064` | Echo cell, deliberately outside the kernel data area |
| `0x0100` | Entry (`forth_start`), REPL and the text interpreter |
| `0x0500` | Second block of kernel word bodies |
| `0x2000` | Threading engine: `next`, `docol`, `exit`, `lit` |
| `0x3000` | Data section: stack bases, dictionary pointer, state cells |
| `0x5600` | BIOS in the D16MINI `CONSOLE_UART` build |
| `0x4A00` | BIOS in the D16nano tile build |
| `0xF8000` | BIOS in the screen build |

The D16nano fork adds `0x4A00` (larger tile BIOS), `0x5000` (ILL handler),
`0x51A0` (IRQ handler) and `0x5300` (`divtest`). Its `DICT_LIMIT` is `0x4A00`,
because the tile BIOS starts there; the static data ends at `0x434C`, with
`0x434D`–`0x49FF free. With `D16SEG` the return stack moves to `0x2FF0` (DS
offset), since every return-stack access is `LD`/`ST` through `DS`, and the
dictionary starts at `0x5800`.

Sections are separated because `.org` rewinds the assembler's address counter.
A routine that grows one section past the next is silently overwritten, which is
why `tests/forth.test.js` asserts that the `.org` sections do not overlap.

## Threaded code and the dictionary

DeepForth is an indirect-threaded Forth.

- A word's **xt** is the address of its code-field cell: `header + 3 + length`.
- The code field holds the address of the routine that executes the word.
- `next` loads `IP` from `ip_ptr`, fetches the xt from `[IP]`, increments `IP`,
  then jumps through the xt's code field.
- A colon definition's code field points at `docol`, which pushes the caller's
  `IP` on the return stack and sets `IP` to the body (`W + 1`).
- `exit` pops the return stack back into `IP`; `lit` copies the next inline cell
  to `R0`.

A header is five fields:

```
link | flags+length | name characters | NUL | code field
```

`link` points at the previous header in the same wordlist, so the list is
newest-first. Bit 15 of the flags cell is the IMMEDIATE flag; the low byte is the
name length. `find` walks the search order, compares lengths first, then the
characters, and computes the xt from the header address.

`current` holds the wordlist that receives new definitions, and `search_order`
is a zero-terminated array of wordlist heads. `definitions`, `also`, `previous`,
`only` and `forth` manipulate those two structures; `vocabulary` creates a new
wordlist and sets the new word's code field to `dovoc`.

## Interpreter and compiler

The text interpreter is a tokenizer over `TIB` with `>IN` as the offset:

1. skip blanks; a NUL ends the line;
2. handle the syntax that is recognised by first character rather than by name:
   `\` to end of line, `(` to the matching `)`, and a bare `"` which opens a
   string;
3. otherwise measure the token, search the dictionary, and either compile its xt
   (`state` non-zero, word not immediate) or execute it;
4. if the token is not a word, try to parse it as a number in the current base.

Numbers accept `0x`/`$` prefixes regardless of base, and a leading `-` only when
a digit follows, so `-rot` remains a word. Failure to parse leaves an unknown
token: with no exception handler it prints `undefined word: …` and abandons the
line; inside `catch` it throws the standard `-13`.

`: name` builds the header at `DP`, sets `state = 1`; `;` compiles `xt_exit` and
clears `state`. Immediate words run during compilation instead of being
compiled. `[` and `]` switch state by hand, `recurse` compiles `current_xt`, and
`create`/`does>` set the code field of the newest created word and patch it with
`dodoes`. Control-flow words (`if`, `else`, `then`, `begin`, `until`, `while`,
`repeat`, `do`, `loop`, `case`) compile ordinary branch words plus inline
targets, which is why `see` can print them back as `(branch)`/`(0branch)`.

`ok_after` prints ` ok` and the prompt only when echo is on. Errors are
deliberately outside that gate: a quiet load must still say what failed.

## Output goes through putch

The single most important portability rule in the kernel: **no Forth word writes
the screen or the UART directly**. Every printing word ends in `SWI` with BIOS
function 2, and the BIOS owns the cursor, CR, LF and scrolling.

`emit` is the clearest case. It masks the character and calls `putch`, with a
comment explaining that keeping local copies of CR, LF and scroll in the kernel
once produced three places that had to agree about the cursor, two of which
clamped instead of scrolling. `ok_after` similarly sends CR and LF through
`putch` rather than rolling its own scroll.

This indirection is what lets one kernel run as:

- the screen build, where `putch` writes `ES:SCR` cells at `0xF1000`;
- the UART build, where `putch` writes `ES:0x0042`;
- the JS, WASM and RTL cores without source changes.

The kernel keeps `ES = 0xF000` after boot so that `ES:0x0060`, `ES:0x0040` and
`ES:0x1000` are the keyboard, UART and screen windows. Device words such as
`es@`/`es!` expose the same segment for driver code.

## BIOS

The BIOS block is a six-function console table (`bver`, `binit`, `putch`,
`putstr`, `getch`, `getstr`) called through `SWI`, with the function number in
the caller's `R0` and the answer in the handler's `R0`. The D16nano fork extends
the table to function 6 `gfx`, which enters the D16D showcase menu in the BIOS
segment and restores the console on return. The detailed calling convention,
screen/terminal behaviour, echo policy and boot script handling are on the
[console page](bios-and-console.md); from the kernel's side the only contract
that matters is that every character leaves through those functions.

## The D16nano fork

`asm/forth_nano.asm` is the kernel plus the parts the tile machine needs.

### Software divide through the ILL trap

`core3` has no iterative divider, so a `DIV`/`DIV32` that needs one traps to
the ILL vector at physical 0. The fork installs that vector at boot and provides
a handler at `0x5000`:

- the entry has already cleared `DS`/`SS` and switched to the shadow bank, with
  `I = 0`;
- the handler saves the persistent shadow bank on `SP'` (reserved area above the
  handler) before using the banked registers;
- it reads the trapped opcode at `PC - 1`, dispatches through small get/put
  stubs that map a register number to `SMV` or direct access, and emulates the
  signed 16/16 or 32/16 division.

`divtest` at `0x5300` is a self-check of the trap against the software divide.

### Interrupt handler

The IRQ handler at `0x51A0` is installed at vector cell 1. It sets `DS = 0x1000`,
`SS = 0x2000`, `ES = 0xF000`, reads SIC `PENDING` at `0xF00B0`, services raster
before the timer, increments the `RASTER`/`SCRATCH` counters and returns with
`RETI`.

The raster source is a level held by the tile engine, so each raster path writes
control 7 (the acknowledge) first and clears the SIC bit last, after a few NOPs
let the synchronised level fall. Clearing pending before the ack re-latches the
bit and makes the handler run twice; that ordering was the 2026-11-04
double-service bug.

The optional band keeps its parameters just past the SIC page: `0xC0` lineA,
`0xC2` the value written at A, `0xC4` lineB, `0xC6` the armed line (software
copy) and `0xCC` the restore Y. The A branch writes OAM descriptor 0 word 1 as
`{group 1, 0xC2}` and re-arms control 7 at lineB; the B branch restores
`{group 1, 0xCC}` and re-arms at lineA. One hardware slot therefore shows two
sprites. `split!` arms lineA; `split-off` clears the parameters and the raster
enable. The board showed two squares at once, and the polling `getstr` keeps
the handler running while the REPL waits.

### Segmented layout and flash words

With `D16SEG`, the boot image is split so that kernel data lives in `DS`, the
data stack in `SS`, BIOS/demo data at `0x4A00` and the dictionary at `0x5800`
with a PSRAM ceiling. The boot script gains config-flash helpers (`cf-wren`,
`cf-status`, `cf-read-burst`, `cf-protect`/`cf-unprotect`, `slice`,
`slice-valid?`, `slice-type`, `screen`) built on the SPI port, which is how the
tile machine loads source screens from flash slices. It loads screens `1`, `5`
and `9`; `9 screen` is `games.fth`, the `game-load`/`game-run` pair for type-4
game slices.

### Far calls, segment loaders and the pristine PSW

`seg-base! ( seg -- )` writes `ES`; `call-far ( seg -- )` saves a return pair in
`R10`/`R11`, sets `CS`/`PC` to `seg:0` with `JML`, and returns through
`callfar_back`, which restores `DS`, `SS` and `ES`. The entry uses a **pristine
PSW**: the kernel runs with the extra-register selection pointing at `R8`, so
without clearing it the loaded block's `R8` reads would alias `ES` and its
direction logic would never see its own registers. `callfar_back` also restores
the console state.

The game loader uses this pair: `game-load` copies the type-4 slice into segment
`0x2000`, and `game-run` calls `call-far`. Pac-Man is slice 10 at `0x20A000`
(1,695 words); the showcase menu's P entry still needs to be switched from the
old `0x4330` jump to this path.

### Graphics

With `D16D` the fork adds a gfx BIOS call and a `gfx` word; the demo/graphics
words live in the kernel image. The tile writer composes text cells from a
palette pair and a glyph address held in `text_attr`.

## Tests

`tests/forth.test.js` is the behavioural contract: it boots the kernel in the JS
core, types into the keyboard FIFO, reads the 80 × 25 screen back, and pins echo,
prompt, ` ok`, results, errors, recovery, arithmetic, comparisons, control flow,
`do`/`loop`, exceptions, `see`, the search order and the sections' fit.

`tests/uart-kernel.test.js` assembles the same source with `CONSOLE_UART`, boots
it, feeds the UART RX and reads the TX through `SerialTerminal`. It checks the
initial `ESC[H ESC[2J ESC[3J`, a typed line, backspace and a colon definition on
the wire. That test closes the loop the screen tests cannot: the kernel really
emits on `0xF0042` and polls `0xF0040`.

Core agreement is covered separately by
[console parity](../architecture/core-parity.md) and the boot-script test.

## Related pages

- [Console, Terminal and Boot Scripts](bios-and-console.md)
- [Memory Map and Memory Model](../architecture/memory-map-and-memory-model.md)
- [FPGA Board Builds](../hardware/board-builds.md)
- [Assembler, Disassembler and Optimizer](../ides/assembler-and-optimizer.md)
