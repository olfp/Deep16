# LILANATIVE — the on-device LILA compiler

`lila/native/lila-native.fth` is a self-contained LILA compiler and bytecode
VM that runs on Deep16 itself. It reads a Lua subset from the console, tokenizes
and parses it, emits bytecode into a dictionary buffer, and executes that
bytecode on a small VM. No host process participates in compiling or running
the program.

This note explains the language the profile accepts and how the implementation
works. `lila/native/README.md` is the short reference; `TYPEPLAN.md` is the
normative description of the three-cell value ABI; `tests/native-lila.test.js`
is the executable specification.

## Where it fits

The repository has two LILA implementations:

| | host prototype | native profile |
|---|---|---|
| entry point | `lila/lila.fs`, `lila-load`, `lila-eval` | `lila/native/lila-native.fth`, the `lila` word |
| runs on | gforth on the host | DeepForth on Deep16 |
| input | source files or `s" ..."` | console lines |
| output | Forth, executed by gforth | bytecode, executed by the native VM |
| language | large Lua subset: tables, closures, libraries | small conformance subset |
| tests | `gforth lila/test.fs` | `node --test tests/native-lila.test.js` |

The native profile exists to prove that the target can compile and run LILA
without a host, and to pin the value ABI on 16-bit cells. It is not a
replacement for the host compiler, and it does not try to accept the whole
language. Unsupported syntax is rejected with a negative code rather than
being given a different meaning.

## Running it

Load the compiler into a booted DeepForth and call `lila`. The word reads
source lines until an empty line, compiles them, then runs the program:

```text
lila
x = 3
y = x + 4 * 2
print(y)
print("a" .. "b" .. "c")
print(z)

11
abc
nil
 ok
```

Only an empty line ends the source; a line of spaces is whitespace, not a
terminator. Newlines inside the source are ordinary whitespace, so line breaks
are not part of the grammar.

The regression test does the same thing in the JS simulator and needs no host
Lua:

```sh
node --test tests/native-lila.test.js
```

It boots the segmented D16D image, types the compiler in one line at a time,
runs a fixture whose expected output was captured from `lua5.4` 5.4.8, and
asserts that the run leaves the data stack at depth 0.

### Getting the compiler onto the board

The compiler is 14,636 characters, so it does not fit in one source slice
(2,040 characters). There are two ways to get it onto the device.

**The config-flash catalog.** `scripts/make_slices.mjs` registers the
compiler as the TEXT object `lila`, last in the image, so every other object
keeps its slice number. `npm run flash:slices` writes the image to
`0x200000` in the upper half of the on-board SPI flash and leaves the
bitstream and the boot image alone. After a power cycle:

```text
s" lila" need
Loading lila

 ok
```

`need` finds the object in the master directory and calls `screen`, which
copies the whole slice chain into `text-buf` and includes it in one go. The
chain is eight slices long, so the boot loader's cap moved from seven slices
(14,280 characters) to eight (16,320), and `text-buf` grew from 14,336 to
16,384 cells to match. `text-buf` is allocated in the dictionary at boot, not
in the image, so the image layout did not change - but the boot loader is
baked into the image, so a board that already carries one needs
`npm run flash:tile` for the new cap.

After the load the compiler has taken about 7.7k cells, leaving about 9.3k
free in a D16D dictionary.

**XMODEM over the serial line.** `xmodem` lives in the `edit` slice, which
the boot loader loads at power-on. It receives a file and runs it with
`included`, so sending `lila/native/lila-native.fth` as XMODEM-CRC leaves
the compiler in the dictionary without reflashing anything. This path also
keeps the received text in the dictionary, so it wants roughly 16k free
cells: check before you start.

### Packed slices are future work

A source slice stores one character per cell, so the eight slices of the
compiler cost 16,320 cells of `text-buf`. The slice type table already has
`PACKED` (type 8) and `p-screen` unpacks two characters per cell, which
would halve the compiler to four slices. It does not work yet:

- `p-screen` loads one slice at a time. `included` cannot span a definition
  across two calls, so a packed chain would have to be split on definition
  boundaries - and any later edit to the file would break that split.
- Nothing in the repository builds a PACKED object; `buildSlices` registers
  TEXT, BINARY and ULAW objects only.
- `screen`, the TEXT loader, copies the whole chain into `text-buf` and
  includes it once, so chain boundaries do not matter there.

The text path is used today. A packed loader that collects a whole chain
before including it is the obvious next step.

## The language

### Lexical structure

A program is a sequence of tokens. Whitespace (space, tab, CR, LF) separates
tokens. `--` starts a comment that runs to the next newline. There are four
token kinds:

| kind | token | examples |
|---:|---|---|
| 1 | decimal integer | `0`, `42`, `2147483647` |
| 2 | name | `x`, `total_2`, `print`, `while`, `_tmp` |
| 3 | string | `"abc"`, `""` |
| 4 | operator or punctuation | `+`, `==`, `..`, `(`, `,`, `=` |

Names start with an ASCII letter or `_` and continue with letters, digits or
`_`. They are case-sensitive. Numbers are unsigned decimal digit strings; a
leading `-` is the unary operator, not part of the literal. Strings are
double-quoted byte strings with no escape processing: a backslash inside a
string is an error, as is a newline, and an unterminated string is an error.

The recognized operators and punctuation are:

```text
+  -  *  ==  ~=  <  >  <=  >=  ..  (  )  ,  =
```

`=` is assignment. It is not an equality operator; `==` is equality. There is
no `!=`, `//`, `%`, `^`, `&`, `|`, `~`, `<<`, `>>`, or `#`.

### Values

Every value is three cells, `( value1 value2 tag )`, matching `lila/value.fs`:

| tag | kind | `value1` | `value2` |
|---:|---|---|---|
| 0 | nil | 0 | 0 |
| 1 | number | low 16 bits | high 16 bits |
| 2 | boolean | `0xFFFF` (true) or 0 (false) | 0 |
| 3 | string | address of the bytes | length |

A number is a signed 32-bit two's-complement value split into low and high
halves, with the high half on top — the same order as a DeepForth double. The
representable range is `-2147483648` through `2147483647`. Runtime arithmetic
wraps modulo 2^32; a *literal* outside `0 .. 2147483647` is rejected with code
`-22`, because the parser cannot store it without silently changing the
program.

One consequence: `-2147483648` cannot be written directly, because the parser
sees the positive literal `2147483648` before applying unary minus. Write
`-2147483647 - 1` instead; the runtime result is the minimum value.

A variable is a three-cell slot. Slots are zero-filled at the start of every
run, so an unassigned global reads as nil. All variables are global; there is
no `local`, no block scope, and no shadowing.

Truthiness follows Lua: only nil and boolean false are false. Every number,
including zero, is true, and every string, including the empty string, is true.

`print` writes each argument and separates arguments with a tab, then writes a
newline. Numbers print as signed 32-bit decimals, booleans as `true`/`false`,
nil as `nil`, and strings as their bytes. The output for those tags matches
Lua's `print`.

### Expressions

An expression is a primary, optionally negated with unary `-`, combined with
binary operators:

```text
primary   := number | string | name | "(" expression ")"
unary     := "-" unary | primary
binary    := unary ( binop unary )*
```

Precedence, from tightest to loosest:

| level | operators | associativity | emitted opcode |
|---:|---|---|---|
| unary | `-` | right | `NEG` |
| 6 | `*` | left | `MUL` |
| 5 | `+` `-` | left | `ADD` `SUB` |
| 4 | `..` | right | `CONCAT` |
| 3 | `<` `>` `<=` `>=` `==` `~=` | left | `LT` `GT` `LE` `GE` `EQ` `NE` |

This ordering places `..` below `+`/`-` and above the comparisons, which is
Lua's relative order. `..` is right-associative, so `"a" .. "b" .. "c"` groups
as `"a" .. ("b" .. "c")`.

Comparisons operate on the two payload cells as a signed 32-bit double, and
`v2pop` discards the tags before comparing. Equality is therefore correct for
numbers and for the two canonical booleans, but it is not tag-aware:
`nil == false` answers `true` here, because both carry the payload `(0 0)`,
whereas Lua answers `false`. Strings compare as `(address length)`
descriptors, so two separately compiled literals are not equal even when their
bytes match. Ordering is meaningful for numbers only; applying `<` to
booleans or nil is not.

Arithmetic does not check tags. `+`, `-`, `*` and unary `-` assume both
operands are numbers; applying them to a string or nil produces a value built
from those payload cells, not a runtime error. `..` assumes both operands are
strings.

### Statements

The statement forms are:

```text
assignment := name "=" expression
print      := "print" "(" expression ( "," expression )* ")"
if         := "if" expression "then" block ( "else" block )? "end"
while      := "while" expression "do" block "end"
do         := "do" block "end"
```

`block` is a sequence of statements and stops at `end` or `else`. A program is
a sequence of statements. `print` needs at least one argument; `print()` is an
error. Assignment creates the global on first use.

There is no `break`, `return`, `repeat`, numeric `for`, generic `for`,
`function`, `local`, table constructor or method call. There is also no
multiple assignment: `a = b = 1` is rejected.

`if` requires `then`; `else` is optional; `end` is required. `while` requires
`do` and re-evaluates its condition before each iteration. `do ... end` groups
statements without changing scope. Because braces and indentation are not
part of the grammar, a one-line program is as valid as a multi-line one:

```text
i = 1 total = 0 while i <= 5 do total = total + i i = i + 1 end print(total)
```

prints `15`.

### Examples

```lua
x = 3
y = x + 4 * 2
if y > 10 then print(y) else print(0) end
while x < 6 do x = x + 1 end
print(x)
print("a" .. "b")
print("a" .. "b" .. "c")
print(y > 10)
print(1 ~= 2, 2 <= 2)
print(-y)
print((1 + 2) * 3)
```

Output:

```text
11
6
ab
abc
true
true	true
-11
9
```

Lua truthiness and nil defaults:

```lua
if 0 then print("zero is true") else print("no") end
print(undefined_global)
```

```text
zero is true
nil
```

A 32-bit payload survives parsing, arithmetic and printing:

```lua
print(70000)
print(100000 * 3)
print(2147483647)
print(-2147483647)
print(65536 + 1)
print(-1 < 0, 100000 > 99999)
```

```text
70000
300000
2147483647
-2147483647
65537
true	true
```

### What is rejected

The profile has no fallback interpretation. These constructs are recognized
only far enough to reject them:

| construct | example | code |
|---|---|---|
| division, modulo, power | `print(1 / 2)`, `print(5 % 2)`, `print(2 ^ 3)` | -20 |
| `and` / `or` / `not` | `if 1 and 2 then print(1) end` | -14 |
| `function` statement | `function f() end` | -21 |
| `local` declaration | `local x = 1` | -21 |
| table constructor | `t = {}` | -9 |
| missing `end` after `if` | `if 1 then print(1)` | -15 |
| missing `end` after `while` | `while 1 do print(1)` | -17 |
| newline inside a string | `print("a` / `b")` | -3 |
| unbalanced parenthesis | `print((1 + 2)` | -20 |
| literal above `2147483647` | `print(2147483648)` | -22 |

A comment-only source and an empty source compile to a single `HALT` and print
nothing.

### Differences from Lua 5.4

The profile follows Lua for the constructs it accepts, with these deliberate
exceptions:

- **`==` does not compare tags.** `nil == false` is `true`, because both are
  `(0 0)` after the tags are dropped. Lua compares tags as well.
- **String equality is descriptor equality.** Two literals with the same bytes
  are different values, so `"a" == "a"` is `false`. Lua compares the bytes.
- **Literals are range-checked.** `2147483648` is rejected with `-22` instead
  of wrapping to `-2147483648`, and `-2147483648` therefore has to be written
  as `-2147483647 - 1`. Runtime arithmetic still wraps, and it wraps at 32
  bits rather than Lua's 64.
- **Operators do not type-check.** `1 + "a"` does not raise an error; it
  combines the payload cells.
- **`print()` is rejected.** Lua allows it.
- **Reading an unknown global creates a slot.** The value is nil, as in Lua,
  but the name is consumed from the 16-name budget.
- **There is no `local`, function, table, float, division, modulo, power,
  bitwise operator, `and`/`or`/`not`, `break`, `return`, `repeat`, `for`,
  vararg, multiple return, multiple assignment, escape sequence, long string,
  long comment, or library.** Each is rejected with a code.

## How it is implemented

### Pipeline

```text
console lines
    |
    v
  l-read            concatenate lines into l-src, append LF
    |
    v
l-tokenize          l-src -> l-tok-a / l-tok-n / l-tok-k
    |
    v
  l-program         recursive descent, emits cells into l-code
    |
    v
   l-run            fetch, dispatch, execute
    |
    v
  console output
```

There is no AST or intermediate representation. Parsing and code generation
are one pass: each grammar production appends opcodes and operands directly to
`l-code`. All compiler state lives in fixed arrays in the dictionary, so a run
needs no allocation beyond the words already compiled.

### Storage

`create`/`allot` count cells, so on Deep16 each entry below is a 16-bit cell.

| array | cells | use |
|---|---:|---|
| `l-src` | 768 | concatenated source, LF after each line |
| `l-tok-a`, `l-tok-n`, `l-tok-k` | 256 each | token start, length, kind |
| `l-code` | 1024 | bytecode |
| `l-sym` | 256 | 16 name entries of 16 cells |
| `l-sym-n` | 16 | name lengths |
| `l-vars` | 96 | 32 three-cell slots (16 used) |
| `l-arena` | 512 | compiled string literals |
| `l-rstr` | 256 | concatenation results |

The rest are scalar variables for parser and VM state. The arrays account for
most of the compiler's footprint. On the D16SEG image used by the test, the
booted kernel has `here = 0xb5af`; after the compiler is typed in,
`here = 0xd396`. That is 7,655 dictionary cells, leaving 11,354 of the 65,536
below `limit = 0xfff0`.

### Input

`l-read` calls `120 accept` into `l-src + l-src-n`, appends an LF, advances
`l-src-n`, and repeats. An `accept` that returns zero cells is an empty line
and ends the source. The 700-character source limit is enforced here (`-1`).
`accept` reads at most 120 characters and cuts a longer line at that
boundary, so the rest of the line is lost — keep source lines shorter than
120 characters.

The stored source is a flat byte sequence, not an array of lines. The LF is
kept so the tokenizer can end `--` comments, and every subsequent line is
separated by at least that LF.

### Tokenizer

`l-tokenize` walks `l-ti` from 0 to `l-src-n`. `l-token` looks at the current
character and dispatches:

- whitespace (`32`, `9`, `10`, `13`) advances one character;
- `-` followed by `-` skips through the next LF;
- a digit scans a run of digits as kind 1;
- a letter or `_` scans a run of name characters as kind 2;
- `"` scans to the closing quote as kind 3, rejecting LF (`-3`), backslash
  (`-4`) and end of source (`-5`);
- a character that begins a two-character operator scans both characters as
  kind 4. The pairs are `..`, `==`, `~=`, `<=`, `>=`;
- anything else is a one-character kind 4 token.

For each token, `l-tok-add` records the start index, length and kind in the
three parallel arrays. `l-tok-a` stores an index into `l-src`; the helpers
`l-tstart` and `l-tlen` turn a token index into an address and length.
`l-cur` is the current token, and `l-cur=` compares its bytes with a static
fragment using `compare`.

Tokens are capped at 256 (`-2`). The tokenizer does not classify keywords:
`if`, `while`, `do`, `print`, `then`, `else` and `end` are ordinary kind 2
names. The parser compares their text when it needs to.

### Symbols and variables

`l-slot` implements a global environment:

1. Reject a name longer than 15 characters (`-6`).
2. Linear-scan the entries in `l-sym`, comparing length first and then bytes.
3. If found, return its index.
4. Otherwise append the name to the next 16-cell entry, store its length in
   `l-sym-n`, and return the new index. More than 16 names is `-6`.

A slot index `i` maps to `l-vars + 3*i`, giving three cells for
`(value1 value2 tag)`. `v-load` reads those three cells; `v-store` writes the
tag, high half and low half. `lila-build` zero-fills all 96 `l-vars` cells, so
every slot starts as `(0 0 nil)`.

Because both a load and a store call `l-slot`, merely reading a new name
creates a slot. That is harmless for Lua semantics — the slot reads as nil —
but it consumes one of the 16 names. The symbol table and the variables are
reset at the start of every `lila` call; nothing survives between runs.

### Parser and code generation

The parser is recursive descent with precedence climbing:

- `l-primary` handles a number, a string, a name, or a parenthesized
  expression. Numbers call `l-num`; strings call `l-astr`; names call
  `l-slot` and emit `LOAD`; `(` parses a full expression and expects `)`.
- `l-unary` handles a leading `-` by parsing another unary and emitting
  `NEG`; otherwise it calls `l-primary`.
- `l-expr ( min -- )` parses a unary, then repeatedly asks `l-binop` for the
  next operator's precedence. It consumes the operator when its precedence is
  at least `min`, recurses with `min` set to the operator's precedence (left
  associative) or to the same precedence (right associative, for `..`), and
  emits the operator opcode afterwards.
- `l-stmt` requires a kind 2 name at the start, then matches the four keyword
  forms by text; anything else is an assignment.
- `l-block` calls statements until the current token is `end` or `else`.
  Nested statements consume their own `end` before returning.
- `l-program` parses until the token stream ends and appends `HALT`.

`l-expr` and `l-stmt` are reached through the execution variables
`l-expr-xt` and `l-stmt-xt`: `l-expr0` and `l-block` are defined before the
definitions they call, so they cannot call them by name. The recursive parts
use DeepForth's `recurse`, which re-enters the definition that contains it —
`l-unary` for a nested negation, `l-expr` for the right-hand side of a binary
operator.

Emission helpers are cell-oriented:

```forth
: code,  ( x -- ) l-cp @ l-code + ! 1 l-cp +! ;
: code2, ( x op -- ) code, code, ;
: l-jz   ( -- slot ) OP-JZ code, here-cp 1 l-cp +! ;
: l-jmp  ( -- slot ) OP-JMP code, here-cp 1 l-cp +! ;
: l-patch ( slot -- ) here-cp swap l-code + ! ;
```

`code2,` emits an opcode followed by one operand. `l-jz` and `l-jmp` emit the
opcode and reserve an operand cell, returning that cell's index; `l-patch`
fills it with the current code position. Jump targets are absolute cell
indices, not byte offsets.

A number literal emits three cells — opcode, low half, high half:

```text
x = 3 + 4 * 2
```

compiles to:

| pc | cell | meaning |
|---:|---|---|
| 0 | `PUSH` | |
| 1 | 3 | low half |
| 2 | 0 | high half |
| 3 | `PUSH` | |
| 4 | 4 | low half |
| 5 | 0 | high half |
| 6 | `PUSH` | |
| 7 | 2 | low half |
| 8 | 0 | high half |
| 9 | `MUL` | |
| 10 | `ADD` | |
| 11 | `STORE` | |
| 12 | 0 | slot `x` |
| 13 | `HALT` | |

An `if` statement compiles a forward `JZ` over the then-block and a forward
`JMP` over the else-block, patching both when their targets are known. With
`x` in slot 0 and `y` in slot 1, `if y > 10 then print(y) else print(0) end`
compiles to:

| pc | cell | meaning |
|---:|---|---|
| 0 | `LOAD` | |
| 1 | 1 | slot `y` |
| 2 | `PUSH` | |
| 3 | 10 | low half |
| 4 | 0 | high half |
| 5 | `GT` | |
| 6 | `JZ` | |
| 7 | 14 | target: first cell of else |
| 8 | `LOAD` | |
| 9 | 1 | slot `y` |
| 10 | `PRINT` | |
| 11 | `EOL` | |
| 12 | `JMP` | |
| 13 | 19 | target: `HALT` |
| 14 | `PUSH` | |
| 15 | 0 | low half |
| 16 | 0 | high half |
| 17 | `PRINT` | |
| 18 | `EOL` | |
| 19 | `HALT` | |

A `while` loop records the current code position before the condition, emits a
`JZ` to the end, emits the body, then emits a `JMP` back to the recorded
position and patches the `JZ` to fall just past the `JMP`.

### Number parsing

`l-num` does not call `s>d`. On a 16-bit cell `s>d` sign-extends a single cell,
which is wrong for any value outside `-32768 .. 32767`. Instead it accumulates
the digits into an unsigned pair `(lo hi)`:

```forth
: l-num ( a n -- lo hi )
  ... 0 0
  <n> 0 ?do
    l-10*
    digit 0 d+
  loop
  dup 0< if -22 throw then ;
```

`l-10*` multiplies the pair by ten. `lo` goes through `um*`, yielding a low
half and a carry; ten times the old high half plus that carry becomes the new
high half. `l-10*` rejects a carry out of 32 bits, and `l-num` rejects a final
high half with the sign bit set. Both are `-22`. Adding the digit uses the
DeepForth double `d+`, so a carry from the low half is handled normally.

At the end the two cells are emitted as raw operands. A negative number is not
a negative literal: the tokenizer sees digits only, and `-` is unary `NEG`.

### Compiled strings

`l-astr` copies a string token into `l-arena` as `[length][bytes...]` and
returns the address of the length cell. `PUSHS` stores that address as its
operand. At runtime `vpushs` pushes `address+1`, `length`, tag 3. The compiler
therefore keeps one length cell per literal even though the runtime value is
just an `(address length)` pair.

The compile-time arena is 512 cells and refuses to exceed 500 bytes used
(`-7`). It is never reused during a run. Because a run compiles from scratch,
the next `lila` call starts with `l-ap = 0`.

### Bytecode

There are 20 opcodes. Column "operands" counts cells after the opcode; a cell
is 16 bits on the target.

| # | opcode | operands | action |
|---:|---|---:|---|
| 0 | `PUSH` | 2 | push `(lo hi 1)` |
| 1 | `LOAD` | 1 | push the slot's value |
| 2 | `STORE` | 1 | pop a value into the slot |
| 3 | `ADD` | 0 | pop two numbers, push the wrapped sum |
| 4 | `SUB` | 0 | pop two numbers, push `a - b` |
| 5 | `MUL` | 0 | pop two numbers, push the low 32 bits |
| 6 | `EQ` | 0 | push `a == b` |
| 7 | `LT` | 0 | push `a < b` |
| 8 | `GT` | 0 | push `a > b` |
| 9 | `LE` | 0 | push `a <= b` |
| 10 | `GE` | 0 | push `a >= b` |
| 11 | `NE` | 0 | push `a ~= b` |
| 12 | `JMP` | 1 | set `pc` to the target cell |
| 13 | `JZ` | 1 | pop a value; jump when falsy |
| 14 | `PRINT` | 0 | pop and print a value |
| 15 | `TAB` | 0 | emit a tab |
| 16 | `EOL` | 0 | emit a newline |
| 17 | `PUSHS` | 1 | push a compiled string |
| 18 | `CONCAT` | 0 | pop two strings, push their concatenation |
| 19 | `HALT` | 0 | stop |
| 20 | `NEG` | 0 | pop a number, push its negation |

Every opcode except `PUSH` has at most one operand, and `PUSH` is the only one
that pushes a literal payload directly. Branches are absolute, so patching is
a single cell store. There is no explicit code-size check: the 256-token cap
keeps emission inside the 1024-cell buffer.

### VM

`l-run` resets `l-pc` and the runtime string watermark `l-rp`, then loops:

```forth
: l-run ( -- )
  0 l-pc ! 0 l-rp !
  begin
    l-code l-pc @ + @
    dup OP-HALT = if drop exit then
    dup l-ops + @ swap drop execute
  again ;
```

`l-ops` is a table of execution tokens indexed by opcode. `HALT` is
special-cased before dispatch. Each handler is responsible for advancing
`l-pc` by its own size, so a mistake in a handler shows up immediately as an
instruction-boundary error. The VM's value stack is the Forth data stack
itself; values are left there in `(value1 value2 tag)` order.

The arithmetic helpers are small:

- `v2pop` drops the two tags and keeps both doubles:
  `(a1 a2 atag b1 b2 btag -- a1 a2 b1 b2)`.
- `vnum` appends the number tag: `(lo hi -- lo hi 1)`.
- `vbool` turns any flag into `(0xFFFF 0 2)` or `(0 0 2)`.
- `d*` multiplies two 32-bit pairs modulo 2^32 using three `um*` products:
  `lo1*lo2`, plus the low halves of `lo1*hi2` and `hi1*lo2` folded into the
  high cell.
- Comparisons use `d=` and `d<`. `>` swaps the two pairs with `2swap` before
  `d<`; `<=` and `>=` negate the opposite comparison.
- `NEG` is `dnegate`.

`v-falsy?` implements Lua truthiness: tag 0 is falsy, tag 2 is falsy when
`value1` is zero, and tags 1 and 3 are always truthy. `v-print` dispatches on
the tag: tag 1 prints with `0 d.r`, tag 3 with `type`, tag 2 as `true`/`false`,
and tag 0 as `nil`.

`v-concat` copies both inputs into `l-rstr` as `[total length][bytes...]`,
advances `l-rp` by the length plus the length cell, and pushes
`(address+1 length 3)`. The 200-byte watermark is checked before the copy and
raises `-11` when full. Nothing is reclaimed, so a loop that concatenates
forever eventually fails; a fixed number of concatenations is fine.

### Errors

`lila` wraps the whole build-and-run in `catch`:

```forth
: lila ( -- )
  ['] lila-inner catch ?dup if
    cr m-lerr 4 type space . cr
  then ;
```

Compile-time and runtime `throw`s therefore take the same path: print
`LERR <code>`, return to the prompt, and leave the data stack at the depth it
had when `lila` was entered. The next call resets the symbol table, code
pointer, arenas, token count and globals, so a failed program does not poison
the next one.

Because `catch` restores the data stack, a rejected program does not leave
temporary values behind. A successful program must also be balanced by
construction; `tests/native-lila.test.js` checks that with `depth . cr`.

| code | meaning |
|---:|---|
| -1 | source too long |
| -2 | too many tokens |
| -3 | newline inside a string |
| -4 | backslash escape inside a string |
| -5 | unterminated string |
| -6 | too many global names (or a name over 15 characters) |
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

Several codes name the point where parsing stopped, not the construct itself.
`print(1 / 2)` reports `-20` because `/` is not an operator in the expression
grammar and the parser then expects `)`; `print(2 ^ 3)` and `print(5 % 2)` fail
the same way. `function f() end` and `local x = 1` are parsed as assignments
until the missing `=`, so they report `-21`.

## Limits

| area | limit | reason |
|---|---|---|
| source text | 700 characters | `l-src` reserves 768 cells; the source is byte-packed |
| input line | 120 characters | the `accept` buffer size |
| tokens | 256 | three 256-cell token arrays |
| global names | 16 names, 15 characters each | 16 name entries in `l-sym` |
| bytecode | 1024 cells | `l-code` |
| compiled strings | 500 bytes | `l-arena` is 512 cells |
| concatenation | 200 bytes, never reclaimed | `l-rstr` is 256 cells |

The compiler is intentionally fixed-size. There is no heap, no GC and no
allocation during compilation: every array is reserved when the Forth file is
loaded, and the limits that matter — source length, token count, name count,
name length and the two arenas — are checked before anything is written. The
bytecode buffer is the one exception; it relies on the token cap to stay
inside 1024 cells. That is what makes it possible to run the whole pipeline in
a dictionary that already has about 9.3k cells free.

## Testing

`tests/native-lila.test.js` is the executable specification. It:

1. assembles `asm/forth_nano.asm` with the D16SEG defines and scatters the
   flat image into the segmented map, matching `flash_boot.sv`;
2. loads the SPI slices, types the compiler into the console one line at a
   time, and fails if the outer interpreter reports an error;
3. types a fixture program, ends it with an empty line, and compares the
   machine output with the `lua5.4` 5.4.8 fixture;
4. types `depth . cr` and requires `0`;
5. runs every rejection case and checks its negative code;
6. checks that comment-only and empty sources compile to a halt.

To add a language case, add its lines to `program` and its expected lines to
`expected` in the test, keeping them in `lua5.4` agreement. To add a rejection,
append `[name, source, code]` to `rejected`. The test embeds the expected
output, so it does not need Lua installed.

`gforth lila/test.fs` is the separate host-compiler suite; it does not load
the native profile.

`tests/native-lila-slice.test.js` is the device-faithful twin: it loads the
same compiler from the config flash with `s" lila" need` instead of typing it
in, then runs the same fixture and checks the same depth. The two tests share
a boot harness in `tests/native-lila-harness.js`.

## Extending the profile

The implementation is arranged so each extension touches a small number of
places:

- **New binary operator:** add its static fragment near `p-plus`, give it a
  precedence and opcode in `l-binop`, add an opcode constant, add a handler
  (`v2pop`, the operation, `vnum`), and append the handler to `l-ops`.
- **New unary operator:** add a fragment, match it in `l-unary`, and emit a
  new opcode that consumes one value and pushes one.
- **New statement:** add a keyword fragment, match it in `l-stmt`, and write a
  handler that emits code. Use `l-block` for a body and `l-jz`/`l-jmp` plus
  `l-patch` for branches.
- **New type:** add a tag, extend `v-falsy?` and `v-print`, and decide what
  arithmetic and comparison mean for it. The value size is fixed at three
  cells.
- **Locals, functions or tables:** these need more than a parser hook. They
  need storage beyond the 16 global slots, a frame or heap layout, and a
  calling convention. The host compiler already has designs for all three;
  see `TYPEPLAN.md` and `lila/README.md`.

Some DeepForth-specific traps are worth remembering when editing the file:

- `variable` leaves its cell address on the stack, so the declarations here
  end in `drop`.
- There is no `>=` or `<=`; use `< 0=` or the double-cell equivalents.
- `do`/`?do`/`loop` only compile inside a definition.
- `code,` stores cells, not bytes, and jump targets are cell indices.
- Every opcode handler must advance `l-pc` by the opcode's total size,
  including operand cells.
- `v2pop` deliberately keeps two-cell doubles while discarding tags; the
  stack order is `(low high)` with high on top.

## File map

| path | contents |
|---|---|
| `lila/native/lila-native.fth` | compiler and VM |
| `lila/native/README.md` | short reference: ABI, subset, opcodes, limits, codes |
| `lila/LILANATIVE.md` | this guide |
| `tests/native-lila.test.js` | boot, compile, fixture, depth and rejection tests |
| `tests/native-lila-slice.test.js` | the same, loading the compiler from the flash |
| `tests/native-lila-harness.js` | the shared boot and console harness |
| `scripts/make_slices.mjs` | the slice catalog, including the `lila` object |
| `lila/value.fs` | normative tag constants and three-cell helpers |
| `TYPEPLAN.md` | value ABI, numeric payload and migration record |
| `LUAPARITY.md` | intended differences from Lua 5.4 |
