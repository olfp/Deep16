# LILA native compiler and VM

`lila-native.fth` is a small on-device LILA compiler for DeepForth. It reads
Lua-subset source from the console one line at a time (a blank line ends the
source), tokenizes and parses it with recursive descent, emits bytecode into a
dictionary buffer, and runs that bytecode on a small VM. No part of the user
program is compiled by the host.

Load the file into a booted DeepForth and type `lila`. The regression test does
exactly that in the JS simulator and needs no host Lua:

```sh
node --test tests/native-lila.test.js
```

It boots the segmented D16D image, types the compiler in, runs the fixture
program, compares the output with what `lua5.4` 5.4.8 prints, and asserts that
the run leaves the data stack at depth 0. The compiler takes about 7.7k
dictionary cells after the kernel boots, leaving about 9.3k free.

## On the device

The compiler is 14,636 characters, so it needs eight source slices. It is
registered in the config-flash catalog as the TEXT object `lila`:

```sh
npm run flash:slices       # writes artifacts/image/slices.bin at 0x200000
```

After a power cycle, at the DeepForth prompt:

```text
s" lila" need
Loading lila

 ok
```

`need` finds the object in the master directory and calls `screen`, which
copies the slice chain into `text-buf` and includes it. The chain is eight
slices long, so the boot loader's cap moved from 14,280 to 16,320 characters
and `text-buf` grew to 16,384 cells; `text-buf` lives in the dictionary, not
in the image, so a board with the old boot loader needs `npm run flash:tile`
for the new cap.

`tests/native-lila-slice.test.js` runs that path in the simulator.

The alternative is `xmodem` over the serial console: send
`lila/native/lila-native.fth` as XMODEM-CRC and it is interpreted as it
arrives, which needs no reflashing but also keeps the received text in the
dictionary.

Packed slices (type 8) would halve the slice count, but the packed loader
`p-screen` loads one slice at a time and `included` cannot span a definition
across two calls. Packed sources are future work; see `lila/LILANATIVE.md`.

## Values

Values use the three-cell ABI from `lila/value.fs`, `( value1 value2 tag )`:

| tag | kind | `value1` | `value2` |
|-----|------|----------|----------|
| 0 | nil | 0 | 0 |
| 1 | number | low 16 bits | high 16 bits |
| 2 | boolean | `0xFFFF` (true) or 0 (false) | 0 |
| 3 | string | address of the bytes | length |

Numbers are signed 32-bit two's-complement pairs with the high half on top, so
they are ordinary DeepForth doubles. Arithmetic uses `d+`, `d-`, `dnegate`,
`d=` and `d<`; multiplication multiplies the low halves with `um*` and folds
the cross products into the high half. A global is a three-cell slot that is
zero-filled at the start of a run, so an unassigned global reads as nil rather
than 0. Literals outside `0 .. 2147483647` are rejected with code `-22`, and
unary minus produces the signed negative.

Booleans print `true`/`false`, nil prints `nil`, strings print with `type`, and
numbers print with `0 d.r`, so the output matches Lua's `print`. Conditions
use Lua truthiness: only nil and false are falsy, so `if 0 then` runs.
Comparisons work on the payload cells, so `==` does not compare tags
(`nil == false` is `true`) and string equality is descriptor equality, not
content equality.

## Supported subset

Supported today:

- global variables and assignment
- decimal integer literals, string literals (no escapes), unary minus
- `+`, `-`, `*`, `==`, `~=`, `<`, `>`, `<=`, `>=`, `..`
- parentheses; `..` is right-associative
- `print(...)` with comma-separated expressions (tab separated, one line)
- `if ... then ... else ... end`
- `while ... do ... end`
- `do ... end`
- `--` comments to the end of the line

Everything else is rejected with a negative code rather than given a new
meaning. In particular this profile has no functions, locals, tables, floats,
`/`, `//`, `%`, `^`, bitwise operators, `and`/`or`/`not`, varargs, multiple
values, `#`, or libraries. Arithmetic and comparisons do not type-check their
operands; only `..` concatenates, and it expects strings.

## Bytecode

Operands follow the opcode inline. `PUSH` stores the low cell then the high
cell; `LOAD`, `STORE` and `PUSHS` store one cell; `JMP` and `JZ` store an
absolute target. Every other opcode has no operand.

| op | word | op | word |
|----|------|----|------|
| 0 | `PUSH` | 11 | `NE` |
| 1 | `LOAD` | 12 | `JMP` |
| 2 | `STORE` | 13 | `JZ` |
| 3 | `ADD` | 14 | `PRINT` |
| 4 | `SUB` | 15 | `TAB` |
| 5 | `MUL` | 16 | `EOL` |
| 6 | `EQ` | 17 | `PUSHS` |
| 7 | `LT` | 18 | `CONCAT` |
| 8 | `GT` | 19 | `HALT` |
| 9 | `LE` | 20 | `NEG` |
| 10 | `GE` |  |  |

## Limits

| area | limit |
|------|-------|
| source text | 700 characters, input lines up to 120 |
| tokens | 256 |
| global names | 16 |
| bytecode | 1024 cells |
| compiled string arena | 500 bytes (512 reserved) |
| concatenation arena | 200 bytes (256 reserved) |

The concatenation arena is not reclaimed; a program that keeps concatenating
in a loop eventually gets `-11`.

## Error codes

`lila` catches a failure, prints `LERR <code>`, and returns to the prompt.

| code | meaning |
|------|---------|
| -1 | source too long |
| -2 | too many tokens |
| -3 | newline inside a string |
| -4 | backslash escape inside a string |
| -5 | unterminated string |
| -6 | too many global names |
| -7 | compiled string arena full |
| -8 | expression expected at the end of the source |
| -9 | unexpected token where a value or `(` was expected |
| -10 | expected `)` after a parenthesized expression |
| -11 | concatenation arena full |
| -12 | expected a statement |
| -13 | a statement must start with a name |
| -14 | expected `then` in `if` |
| -15 | expected `end` after `if` |
| -16 | expected `do` in `while` |
| -17 | expected `end` after `while` |
| -18 | expected `end` after `do` |
| -19 | expected `(` after `print` |
| -20 | expected `)` or an operator after an expression |
| -21 | expected `=` in an assignment |
| -22 | integer literal outside the signed 32-bit range |

## Verified

`tests/native-lila.test.js` covers compilation, the 32-bit payload in
arithmetic, comparisons and printing, nil for an unassigned global, Lua
truthiness for 0, the rejection cases above, and the depth-0 assertion.
`tests/native-lila-slice.test.js` repeats the program and the depth check
with the compiler loaded from the config flash.
