# LILA native compiler and VM

`lila-native.fth` is a small on-device LILA compiler for DeepForth. It is a
session: it reads one line of Lua-subset source at a time, tokenizes and
parses it with recursive descent, emits bytecode into a dictionary buffer, and
runs that bytecode on a small VM. Every line is a program of its own, and the
state — the globals and the symbol table — carries from one line to the next.
No part of the user program is compiled by the host.

Load the file into a booted DeepForth and type `lila`. The word prints a CR
and its own prompt `L> ` before every source line, and echoes a CR for the
Return the user pressed — the BIOS stops at the Return without echoing the
newline, so the compiler does it itself:

```text
lila
L> x = 3
L> print(x)
3
L> 
 ok
```

An empty line ends the session. A line that ends in the middle of a statement
is not an error: the session asks for another line and tries the whole pending
source again, so a block can be spread over several lines:

```text
lila
L> if x > 2 then
L> print("big")
L> end
big
L> 
 ok
```

The regression test does exactly that in the JS simulator and needs no host
Lua:

```sh
node --test tests/native-lila.test.js
```

It boots the segmented D16D image with the soft-float library, types the
compiler in, runs the fixture program, compares the output with what
`lua5.4` 5.4.8 prints, and asserts that the run leaves the data stack at
depth 0. The compiler takes about 8.5k dictionary cells after the kernel
boots, leaving about 4.1k free.

## On the device

The compiler is 20,036 characters, so it needs ten source slices. It is
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
copies the slice chain into `text-buf` and includes it. The chain is ten
slices long, so the boot loader's cap moved from 16,320 to 20,400 characters
and `text-buf` grew to 20,480 cells; `text-buf` lives in the dictionary, not
in the image, so a board with the old boot loader needs `npm run flash:tile`
for the new cap. The buffer is allocated at boot, so every board pays the
4,096 extra cells whether it loads LILA or not.

The dictionary and the data stack share one region in the D16SEG map, so
those 4,096 cells come out of the data stack: the gap between the two fell
from 15,671 cells to 11,575. The stack still holds thousands of cells - far
more than the LILA VM needs - but it is a real cost on every board.

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
| 5 | float | low 16 bits | high 16 bits |

Numbers are signed 32-bit two's-complement pairs with the high half on top, so
they are ordinary DeepForth doubles. Arithmetic uses `d+`, `d-`, `dnegate`,
`d=` and `d<`; multiplication multiplies the low halves with `um*` and folds
the cross products into the high half. A global is a three-cell slot that is
zero-filled at the start of a run, so an unassigned global reads as nil rather
than 0. Literals outside `0 .. 2147483647` are rejected with code `-22`, and
unary minus produces the signed negative.

Floats are IEEE 754 singles, split into low and high halves with the high half
on top — the order the kernel float words read, so the pair goes straight into
`f+`, `f-`, `f*`, `f/`, `f=`, `f<`, `flog`, `fexp` and `s>f`. The kernel has to
be an FPU image: the compiler only loads on a board that carries the soft-float
library.

Booleans print `true`/`false`, nil prints `nil`, strings print with `type`,
numbers print with `0 d.r` and floats print with `f.`, so the output of the
first four matches Lua's `print`. A float prints as `1.5000 `, with four
decimals and a trailing space, not Lua's `1.5`. Conditions use Lua truthiness:
only nil and false are falsy, so `if 0 then` runs. Arithmetic and comparison
reject a non-numeric operand with code `-26`.

## Supported subset

Supported today:

- global variables and assignment
- decimal integer and float literals, string literals (no escapes), unary minus
- `+`, `-`, `*`, `/`, `//`, `%`, `^`, `==`, `~=`, `<`, `>`, `<=`, `>=`, `..`
- parentheses; `..` is right-associative, `^` is right-associative and binds
  tighter than the unary minus
- the Lua 5.4 numeric tower: `+`, `-` and `*` keep the operand type, `/` and
  `^` always give a float, `//` and `%` keep the operand type, and an integer
  and a float compare by value
- `print(...)` with comma-separated expressions (tab separated, one line)
- `if ... then ... else ... end`
- `while ... do ... end`
- `do ... end`
- `--` comments to the end of the line

Everything else is rejected with a negative code rather than given a new
meaning. In particular this profile has no functions, locals, tables, bitwise
operators, `and`/`or`/`not`, varargs, multiple values, `#`, or libraries.
Arithmetic and comparison reject a non-numeric operand with `-26`; only `..`
concatenates, and it expects strings.

## Bytecode

Operands follow the opcode inline. `PUSH` and `PUSHF` store the low cell then
the high cell; `LOAD`, `STORE` and `PUSHS` store one cell; `JMP` and `JZ` store
an absolute target. Every other opcode has no operand.

| op | word | op | word |
|----|------|----|------|
| 0 | `PUSH` | 13 | `JMP` |
| 1 | `LOAD` | 14 | `JZ` |
| 2 | `STORE` | 15 | `PRINT` |
| 3 | `ADD` | 16 | `TAB` |
| 4 | `SUB` | 17 | `EOL` |
| 5 | `MUL` | 18 | `PUSHS` |
| 6 | `DIV` | 19 | `CONCAT` |
| 7 | `NE` | 20 | `HALT` |
| 8 | `EQ` | 21 | `NEG` |
| 9 | `GE` | 22 | `PUSHF` |
| 10 | `LT` | 23 | `POW` |
| 11 | `LE` | 24 | `IDIV` |
| 12 | `GT` | 25 | `MOD` |

## Limits

| area | limit |
|------|-------|
| source text | 700 characters, input lines up to 120 |
| tokens | 256 |
| global names | 16 |
| bytecode | 1024 cells |
| compiled string arena | 500 bytes (500 reserved) |
| concatenation arena | 200 bytes (200 reserved) |
| float quotient | a signed 16-bit cell |

The global names, the globals themselves and the two string arenas live as
long as the session does: a string assigned on one line is still there on the
next. Nothing is reclaimed, so a session that keeps concatenating eventually
gets `-11`, and one that keeps adding literals eventually gets `-7`.

## Error codes

`lila` catches a failure, prints `LERR <code>`, and goes on with the next
line. `-23` is not a failure: it means the line ended in the middle of a
statement, and the session waits for the next line.

| code | meaning |
|------|---------|
| -1 | source too long |
| -2 | too many tokens |
| -3 | newline inside a string |
| -4 | backslash escape inside a string |
| -5 | unterminated string |
| -6 | too many global names |
| -7 | compiled string arena full |
| -8 | expression expected (superseded by -23) |
| -9 | unexpected token where a value or `(` was expected |
| -10 | expected `)` after a parenthesized expression |
| -11 | concatenation arena full |
| -12 | expected a statement (superseded by -23) |
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
| -23 | the source ended in the middle of a statement |
| -24 | division by zero |
| -25 | the quotient does not fit in a signed cell |
| -26 | a non-numeric operand |

## Verified

`tests/native-lila.test.js` covers compilation, the 32-bit payload in
arithmetic, comparisons and printing, the float profile, nil for an
unassigned global, Lua truthiness for 0, the rejection cases above, the state
carrying from one line to the next, a block spread over several lines, and the
depth-0 assertion. `tests/native-lila-slice.test.js` repeats the program, the
float profile and the depth check with the compiler loaded from the config
flash.
