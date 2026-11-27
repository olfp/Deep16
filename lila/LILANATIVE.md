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

Load the compiler into a booted DeepForth and call `lila`. The word is a
session: it reads one line at a time, compiles that line and runs it, so every
line is a program of its own and the state carries from one line to the next:

```text
lila
L> x = 3
L> y = x + 4 * 2
L> print(y)
11
L> print("a" .. "b" .. "c")
abc
L> print(z)
nil
L> 
 ok
```

`lila` prints a CR when it starts and its own prompt, `L> `, before every
line it reads; it echoes a CR for the Return the user pressed, because the
BIOS stops at the Return without echoing the newline. The prompt is the
DeepForth prompt `> ` with an `L` in front of it, so the two are easy to tell
apart. An empty line ends the session. A line of spaces is whitespace, not a
terminator.

A line that ends in the middle of a statement is not an error. The session
asks for another line and tries the whole pending source again, so a block can
be spread over as many lines as it takes:

```text
lila
L> if x > 2 then
L> print("big")
L> end
big
L> 
 ok
```

The state that carries from line to line is the symbol table and the globals:
`x = 3` on one line and `print(x)` on the next work on the same `x`. The two
string arenas live as long as the session does, so a string assigned on one
line is still there on the next.

The regression test does the same thing in the JS simulator and needs no host
Lua:

```sh
node --test tests/native-lila.test.js
```

It boots the segmented D16D image, types the compiler in one line at a time,
runs a fixture whose expected output was captured from `lua5.4` 5.4.8, and
asserts that the run leaves the data stack at depth 0.

### Getting the compiler onto the board

The compiler is 27,482 characters, so it does not fit in one source slice
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
reads the whole slice chain into `slice-buf` one slice at a time and
interprets it line by line. The chain is fourteen slices long, but the loader
has no length cap: it follows the links until the chain ends, and the source
text never sits in the dictionary. A board that already carries an older boot
loader needs `npm run flash:tile` for the new loader.

That cost lands on the data stack. In the D16SEG map the dictionary grows up
from `0x5800` and the data stack grows down from `0xFFF0` in the same
region, so the dictionary and the stack share their cells. The old loader
reserved a 22,528-cell `text-buf` for the source text and took that room out
of the stack; the new loader keeps only the 2,048-cell `slice-buf` - and the
packed loader's own buffer is taken from the dictionary only when a packed
slice is actually loaded - so the gap between the two is 29,618 cells where
the old loader left 9,178, and a D16D boot leaves 32,782 free dictionary
cells instead of 10,302.

After the load the compiler has taken about 10.8k cells, leaving about 22.0k
free in a D16D dictionary.

**XMODEM over the serial line.** `xmodem` lives in the `edit` slice, which
the boot loader loads at power-on. It receives a file and runs it with
`included`, so sending `lila/native/lila-native.fth` as XMODEM-CRC leaves
the compiler in the dictionary without reflashing anything. This path also
keeps the received text in the dictionary, so it wants roughly 16k free
cells: check before you start.

### Packed slices are future work

A source slice stores one character per cell, so the fourteen slices of the
compiler hold 28,560 characters. The slice type table already has
`PACKED` (type 8) and `p-screen` unpacks two characters per cell, which
would halve the compiler to seven slices. It does not work yet:

- `p-screen` loads one slice at a time. `included` cannot span a definition
  across two calls, so a packed chain would have to be split on definition
  boundaries - and any later edit to the file would break that split.
- Nothing in the repository builds a PACKED object; `buildSlices` registers
  TEXT, BINARY and ULAW objects only.
- `screen`, the TEXT loader, interprets each line as it arrives, so chain
  boundaries do not matter there - only the 128-character limit of
  `evaluate` does.

The text path is used today. A packed loader that collects a whole chain
before including it is the obvious next step.

## The language

### Lexical structure

A program is a sequence of tokens. Whitespace (space, tab, CR, LF) separates
tokens. `--` starts a comment that runs to the next newline. There are five
token kinds:

| kind | token | examples |
|---:|---|---|
| 1 | decimal integer | `0`, `42`, `2147483647` |
| 2 | name | `x`, `total_2`, `print`, `while`, `_tmp` |
| 3 | string | `"abc"`, `""` |
| 4 | operator or punctuation | `+`, `==`, `..`, `(`, `,`, `=`, `[`, `{`, `#` |
| 5 | float | `1.5`, `0.25`, `1.5e3`, `1e3` |

Names start with an ASCII letter or `_` and continue with letters, digits or
`_`. They are case-sensitive. Numbers are unsigned decimal digit strings; a
leading `-` is the unary operator, not part of the literal. A float is a digit
string with a point and at least one fraction digit, or with an exponent, or
with both; `1.`, `.5` and `1.5e` are not literals and are rejected. Strings are
double-quoted byte strings and carry the escape sequences listed under
[String escapes](#string-escapes). A newline inside a string is an error, and
so is an unterminated string.

The recognized operators and punctuation are:

```text
+  -  *  /  //  %  ^  ==  ~=  <  >  <=  >=  ..  (  )  ,  =
[  ]  {  }  #
```

`=` is assignment. It is not an equality operator; `==` is equality. There is
no `!=`, `&`, `|`, `<<`, or `>>`. The brackets and braces belong to the table
syntax, and `#` is the length or border operator.

### Values

Every value is three cells, `( value1 value2 tag )`, matching `lila/value.fs`:

| tag | kind | `value1` | `value2` |
|---:|---|---|---|
| 0 | nil | 0 | 0 |
| 1 | number | low 16 bits | high 16 bits |
| 2 | boolean | `0xFFFF` (true) or 0 (false) | 0 |
| 3 | string | address of the bytes | length |
| 4 | table | address of the table's slot block | 0 |
| 5 | float | low 16 bits | high 16 bits |

A number is a signed 32-bit two's-complement value split into low and high
halves, with the high half on top — the same order as a DeepForth double. The
representable range is `-2147483648` through `2147483647`. Runtime arithmetic
wraps modulo 2^32; a *literal* outside `0 .. 2147483647` is rejected with code
`-22`, because the parser cannot store it without silently changing the
program.

A float is an IEEE 754 single-precision value, split into low and high halves
with the low half first and the high half on top — the order the kernel float
words use, so the pair can be handed to `f+`, `f-`, `f*`, `f/`, `f<`, `f=`,
`flog`, `fexp`, `s>f` and `f>s` unchanged. The kernel has to be an FPU image:
the compiler only loads on a board that carries the soft-float library.

One consequence: `-2147483648` cannot be written directly, because the parser
sees the positive literal `2147483648` before applying unary minus. Write
`-2147483647 - 1` instead; the runtime result is the minimum value.

A variable is a three-cell slot. Slots are zero-filled at the start of every
run, so an unassigned global reads as nil. All variables are global; there is
no `local`, no block scope, and no shadowing.

A table is a block of slots, and the value carries the block's address. A
slot is seven cells:

```text
[ key value1 ][ key value2 ][ key tag ][ value value1 ][ value value2 ][ value tag ][ occupied ]
```

The key is a whole tagged value, so a number, a string, a boolean, a table or
a float can be a key. Two keys match when their tags are the same and their
payloads are equal: a number by its 32-bit value, a string by its bytes, a
boolean by its flag, and a table or a float by its payload. The last case
gives tables identity semantics, as in Lua. A nil key is rejected.

Truthiness follows Lua: only nil and boolean false are false. Every number,
including zero, is true, and every string, including the empty string, is true.

`print` writes each argument and separates arguments with a tab, then writes a
newline. Numbers print as signed 32-bit decimals, booleans as `true`/`false`,
nil as `nil`, and strings as their bytes. The output for those tags matches
Lua's `print`. Floats print with the kernel's `f.`, which writes the sign, the
integer part, exactly four decimals and a trailing space — `1.5000 `, not Lua's
`1.5`. A table prints as `<table>`, where Lua prints its address.

### Expressions

An expression is a primary, optionally negated with unary `-` or measured
with `#`, combined with binary operators:

```text
primary   := number | float | string | name | table | "(" expression ")"
            | primary "[" expression "]"
table     := "{" "}"
unary     := "-" unary | "#" unary | primary
binary    := unary ( binop unary )*
```

Precedence, from tightest to loosest:

| level | operators | associativity | emitted opcode |
|---:|---|---|---|
| 7 | `^` | right | `POW` |
| unary | `-` `#` | right | `NEG` `LEN` |
| 6 | `*` `/` `//` `%` | left | `MUL` `DIV` `IDIV` `MOD` |
| 5 | `+` `-` | left | `ADD` `SUB` |
| 4 | `..` | right | `CONCAT` |
| 3 | `<` `>` `<=` `>=` `==` `~=` | left | `LT` `GT` `LE` `GE` `EQ` `NE` |

This ordering is Lua's: `..` sits below `+`/`-` and above the comparisons, `..`
is right-associative, so `"a" .. "b" .. "c"` groups as `"a" .. ("b" .. "c")`,
and `^` is tighter than the unary minus, so `-2 ^ 2` is `-(2 ^ 2)` and
answers `-4.0000`.

The table index binds tighter than every binary operator: `t[a + 1]` parses
the key as a whole expression, and `t[a][b]` chains. The key is parsed with
the parser's own state saved and put back, because a key that changed the
precedence would change how the *outer* expression is parsed.

`#` is a unary operator with the same precedence as the unary minus, so it
takes an operand at precedence 7. On a string it is the length in bytes; on a
table it is the *border* — the largest `n` for which the keys `1..n` are all
present — which is what the host compiler answers, not the count of the
entries. On anything else it is `-33`.

**The numeric tower.** Integers and floats are distinct types, as in Lua 5.4:

- `+`, `-` and `*` keep the type of their operands. A float operand makes the
  result a float; two integers give an integer.
- `/` always gives a float, even for two integers: `3 / 2` is `1.5000`.
- `^` always gives a float: `2 ^ 10` is `1024.0000`.
- `//` and `%` keep the type of their operands: `7 // 2` is the integer `3`,
  `7.5 // 2` is the float `3.0000`, `7 % 3` is the integer `1` and
  `7.5 % 2` is the float `1.5000`.
- A comparison between an integer and a float compares their numeric values:
  `2 == 2.0` is `true`.

Arithmetic and comparison reject a non-numeric operand with `-26`, so
`"a" + 1` is an error instead of a number built from the payload cells. `..`
still assumes two strings.

`//` and `%` are computed in floating point and then rounded, because the
kernel has no 32-bit division: the quotient has to fit in a signed cell (`-25`
otherwise), and both operands have to be exactly representable as
single-precision floats. `7 % 3` is exact, but a quotient that needs more than
16 bits of integer precision is not.

Comparisons operate on the two payload cells as a signed 32-bit double when
both operands are integers, and on the float pair when either is a float.
Strings, booleans and nil are not comparable and are rejected with `-26`.
Ordering is meaningful for numbers only.

### Statements

The statement forms are:

```text
assignment := name "=" expression
            | name "[" expression "]" "=" expression
print      := "print" "(" expression ( "," expression )* ")"
if         := "if" expression "then" block ( "else" block )? "end"
while      := "while" expression "do" block "end"
do         := "do" block "end"
```

`block` is a sequence of statements and stops at `end` or `else`. A program is
a sequence of statements. `print` needs at least one argument; `print()` is an
error. Assignment creates the global on first use.

An assignment to `t[key]` writes the table's entry instead of a global.
Assigning nil deletes the key, as in Lua. The target may not be chained:
`t[a][b] = v` is rejected with `-21`, because the parser has no way to name
the inner table as an assignment target. Reading a chained index is fine:
`t[a][b]` is a read of the table that `t[a]` names.

A table is built with `{}` — an empty table. A constructor with contents,
`{1, 2}`, is rejected with `-27`.

There is no `break`, `return`, `repeat`, numeric `for`, generic `for`,
`function`, `local`, or method call. There is also no
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

Floats print with the kernel's `f.`, so they carry four decimals and a
trailing space:

```lua
print(1.5)
print(1.5e3)
print(3 / 2)
print(2 ^ 10)
print(1.5 + 2)
print(7 // 2)
print(7.5 // 2)
print(7 % 3)
print(7.5 % 2)
print(-2 ^ 2)
```

```text
1.5000 
1500.0000 
1.5000 
1024.0000 
3.5000 
3
3.0000 
1
1.5000 
-4.0000 
```

### What is rejected

The profile has no fallback interpretation. These constructs are recognized
only far enough to reject them:

| construct | example | code |
|---|---|---|
| `and` / `or` / `not` | `if 1 and 2 then print(1) end` | -14 |
| `function` statement | `function f() end` | -21 |
| `local` declaration | `local x = 1` | -21 |
| a table constructor with contents | `t = {1, 2}` | -27 |
| a missing `]` | `t["x" = 1` | -28 |
| a nested assignment | `t["a"]["b"] = 1` | -21 |
| a non-table before `[` | `t = 5` then `t["x"]` | -29 |
| a nil key | `t[nil] = 1` | -30 |
| a table with nine entries | nine assignments to one table | -31 |
| a ninth table in one session | nine `x = {}` lines | -32 |
| `#` on a number | `print(#5)` | -33 |
| a float without a leading digit | `print(.5)` | -9 |
| newline inside a string | `print("a` / `b")` | -3 |
| an unknown escape | `print("\\q")` | -4 |
| a `\x` with one digit | `print("\\x4")` | -4 |
| a decimal escape over 255 | `print("\\300")` | -4 |
| a `\u` without the brace | `print("\\u{41")` | -4 |
| a code point over `0xFFFF` | `print("\\u{10000}")` | -4 |
| literal above `2147483647` | `print(2147483648)` | -22 |
| a float with a trailing point | `print(1.)` | -20 |
| a float with a malformed exponent | `print(1.5e)` | -20 |
| division by zero | `print(1 / 0)` | -24 |
| a quotient that does not fit in a cell | `print(100000 // 1)` | -25 |
| a non-numeric operand | `print("a" + 1)`, `print("a" == "a")` | -26 |

A source that ends in the middle of a statement is not in this table: it is
`-23`, and the session asks for another line instead of rejecting the
program. `if 1 then print(1)` on its own, `while 1 do print(1)` and
`print((1 + 2)` are all such sources, as is `x =` and `print(1`.

A comment-only source and an empty source compile to a single `HALT` and print
nothing.

### Differences from Lua 5.4

The profile follows Lua for the constructs it accepts, with these deliberate
exceptions:

- **Floats are single-precision.** Lua's floats are doubles, so a literal
  beyond the single-precision range or with more than seven significant digits
  is rounded here, and `0.1 + 0.2` is not exactly `0.3`.
- **Floats print with four decimals.** The kernel's `f.` writes `1.5000 `, not
  Lua's `1.5`.
- **`//` and `%` go through the float path.** The quotient has to fit in a
  signed cell and the operands have to be exactly representable as
  single-precision floats.
- **Comparisons are numeric only.** `==` and the relationals reject a string,
  a boolean or nil with `-26`; Lua compares strings and answers `false` for
  values of different types.
- **Literals are range-checked.** `2147483648` is rejected with `-22` instead
  of wrapping to `-2147483648`, and `-2147483648` therefore has to be written
  as `-2147483647 - 1`. Runtime arithmetic still wraps, and it wraps at 32
  bits rather than Lua's 64.
- **Arithmetic rejects a non-numeric operand.** `1 + "a"` raises `-26`.
- **`print()` is rejected.** Lua allows it.
- **Reading an unknown global creates a slot.** The value is nil, as in Lua,
  but the name is consumed from the 16-name budget.
- **A `\u` code point is at most `0xFFFF`.** Lua allows the whole range up to
  `0x7FFFFFFF`, with surrogate pairs for the astral planes; a larger code
  point is `-4` here.
- **`\z` cannot skip a line feed.** The native source is line-based, so the
  tokenizer rejects the line feed inside the string before the decoder runs.
- **A table has eight entries and there are eight tables.** The profile has no
  growth and no rehash: a ninth entry in a table is `-31`, and a ninth table in
  a session is `-32`. The host compiler's tables grow, so a program that fits
  in the host may run out here.
- **A table constructor has no contents.** Only `{}`; `{1, 2, 3}` and
  `{name = "x"}` are rejected with `-27`. The host rejects them too, but with
  a different message.
- **Nested assignment is rejected.** `t["a"]["b"] = 1` is `-21`, as on the
  host. Nested reads work.
- **A table prints as `<table>`.** Lua prints its address.
- **There is no `local`, function, bitwise operator, `and`/`or`/`not`,
  `break`, `return`, `repeat`, `for`, vararg, multiple return, multiple
  assignment, long string, long comment, or library.** Each is rejected with a
  code.

## How it is implemented

### Pipeline

```text
console lines
    |
    v
  l-line            prompt "L> ", echo the CR, append the line to l-src
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

The session loop is `l-session`: read a line, compile it, run it, repeat. A
compile that ends in the middle of a statement throws `-23`; the session then
reads another line and compiles the whole pending source again. That is what
lets a block span several lines, and it is why the pending source is kept in
`l-src` until it compiles.

### Storage

`create`/`allot` count cells, so on Deep16 each entry below is a 16-bit cell.

| array | cells | use |
|---|---:|---|
| `l-src` | 768 | concatenated source, LF after each line |
| `l-tok-a`, `l-tok-n`, `l-tok-k` | 256 each | token start, length, kind |
| `l-code` | 1024 | bytecode |
| `l-sym` | 256 | 16 name entries of 16 cells |
| `l-sym-n` | 16 | name lengths |
| `l-vars` | 48 | 16 three-cell slots |
| `l-arena` | 500 | compiled string literals |
| `l-rstr` | 200 | concatenation results |
| `l-tslot` | 448 | 8 tables of 8 slots of 7 cells |

The rest are scalar variables for parser and VM state. The arrays account for
most of the compiler's footprint. On the D16SEG image used by the test, the
booted kernel has `here = 0x7fe2`: the boot loader keeps no copy of the
source text in the dictionary, and 32,782 of the 65,520 cells below
`limit = 0xfff0` are still free. Loading the compiler from the flash takes
10,756 cells, leaving 22,026 free; typing it in takes the same 10,756 cells.

`l-tslot` is the whole table pool: eight tables, each with eight slots of
seven cells. A table's value is the address of its own block of slots, so the
value carries no header and no count. `l-tn` counts the tables handed out so
far, and it is reset at the start of a session, so the pool starts empty.

### Input

`l-line` calls `120 accept` into `l-src + l-src-n`, appends an LF, advances
`l-src-n`, and returns. A line that is empty ends the session. The
700-character source limit is enforced here (`-1`): a source that grows past
it is dropped and the session carries on with the next line. `accept` reads at
most 120 characters and cuts a longer line at that boundary, so the rest of
the line is lost — keep source lines shorter than 120 characters.

The console echoes the characters as they are typed, but the BIOS stops at the
Return without echoing the newline: the cursor would stay on the line the user
just typed, and the next output would land on top of it. So `l-line` echoes a
CR of its own after every `accept`, and `l-session` prints the prompt `L> `
before each line it reads. The prompt is printed by `l-prompt`, which is
`." L> "`.

The stored source is a flat byte sequence, not an array of lines. The LF is
kept so the tokenizer can end `--` comments, and every subsequent line is
separated by at least that LF. The bytes stay in `l-src` until the pending
source compiles, so a block that spans several lines is tokenized as one
source.

### Tokenizer

`l-tokenize` walks `l-ti` from 0 to `l-src-n`. `l-token` looks at the current
character and dispatches:

- whitespace (`32`, `9`, `10`, `13`) advances one character;
- `-` followed by `-` skips through the next LF;
- a digit scans a run of digits as kind 1, or as kind 5 when the number has a
  point with fraction digits or an exponent;
- a letter or `_` scans a run of name characters as kind 2;
- `"` scans to the closing quote as kind 3. A backslash skips the next
  character, so the scanner has to know where the closing quote is: a
  backslash before the line feed is `-4`, a line feed inside the string is
  `-3`, and a line feed at the end of a string that held an escape is `-5`,
  because the escape may have eaten the closing quote;
- a character that begins a two-character operator scans both characters as
  kind 4. The pairs are `..`, `==`, `~=`, `<=`, `>=`, `//`;
- anything else is a one-character kind 4 token.

The number scanner is `l-scan-number`. It reads the digits, then looks for a
point: a point followed by a digit makes the token a float and the fraction
digits are part of it. `l-exp` then looks for `e` or `E`, an optional sign and
at least one digit; an exponent also makes the token a float. A malformed
exponent is left in the text, so it is read as a name and the line is
rejected. A point that is not followed by a digit is not a point at all, so
`1.` is the integer `1` followed by a `.` operator, and `.5` is a `.` operator
followed by the integer `5`; both are rejected by the parser.

For each token, `l-tok-add` records the start index, length and kind in the
three parallel arrays. `l-tok-a` stores an index into `l-src`; the helpers
`l-tstart` and `l-tlen` turn a token index into an address and length.
`l-cur` is the current token, and `l-cur=` compares its bytes with a static
fragment using `compare`.

`l-eof?` is true when the token stream is exhausted. `l-cur` and `l-op?` are
EOF-safe: at the end of the stream `l-cur` answers an empty string rather
than reading the uninitialized token arrays, and `l-op?` answers false.

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
tag, high half and low half. `l-session` zero-fills all 96 `l-vars` cells at
the start of a session, so every slot starts as `(0 0 nil)`.

Because both a load and a store call `l-slot`, merely reading a new name
creates a slot. That is harmless for Lua semantics — the slot reads as nil —
but it consumes one of the 16 names. The symbol table and the variables are
set up once at the start of a session and live until the session ends, so
both the names and their values survive from line to line. A new `lila` call
starts a new session with an empty table and nil globals.

### Parser and code generation

The parser is recursive descent with precedence climbing:

- `l-primary0` handles a number, a float, a string, a name, a parenthesized
  expression, or the table constructor `{}`. Integers call `l-num` and emit
  `PUSH`; floats call `evaluate` and emit `PUSHF`; strings call `l-astr`;
  names call `l-slot` and emit `LOAD`; `(` parses a full expression and
  expects `)`. `{}` emits `TNEW` and expects the closing `}`.
- `l-primary` calls `l-primary0` and then loops over the table indexes: while
  the current token is `[`, it parses the key as a whole expression, expects
  `]`, and emits `TGET`. The loop is what chains the indexes, so `t[a][b]`
  emits two `TGET`s.
- `l-unary` handles a leading `-` by parsing its operand at precedence 7 and
  emitting `NEG`, and a leading `#` the same way, emitting `LEN`. Otherwise it
  calls `l-primary`. Precedence 7 is the power, so the operand of a unary
  operator may be a power and nothing else: `-2 ^ 2` is `-(2 ^ 2)`.
- `l-expr ( min -- )` parses a unary, then repeatedly asks `l-binop` for the
  next operator's precedence. It consumes the operator when its precedence is
  at least `min`, recurses with `min` set to the operator's precedence (left
  associative) or to the same precedence (right associative, for `..`), and
  emits the operator opcode afterwards.
- `l-stmt` requires a kind 2 name at the start, then matches the four keyword
  forms by text; anything else is an assignment.
- `l-assign` is the one statement with two forms. A plain `name = expression`
  emits `LOAD`/`STORE` for the global's slot. A `name[key] = expression`
  emits a `LOAD` of the global, parses the key, expects `]`, expects `=`,
  parses the value, and emits `TSET`. The nested form `t[a][b] = v` has no
  place to put the inner table, so it is rejected.
- `l-block` calls statements until the current token is `end` or `else`.
  Nested statements consume their own `end` before returning.
- `l-program` parses until the token stream ends and appends `HALT`.

Two helpers decide what the parser expects of the current token:

```forth
: l-want ( ca cn code -- )
  >r
  l-eof? if r> -23 throw then
  l-cur compare 0= if 1 l-pos +! r> drop exit then
  r> throw ;

: l-op! ( ca cn code -- )
  l-eof? if -23 throw then
  l-pos @ l-tok-k + @ 4 <> if throw then
  l-want ;
```

`l-want` matches a keyword and `l-op!` an operator; both consume the token
when it matches and throw the caller's code when it does not. At the end of
the token stream they throw `-23` instead: the statement is unfinished, and
the session asks for another line. Every rule that needs a token goes through
one of them, so a source that ends mid-statement is always `-23` and never a
syntax error.

The parser's state is the variables `l-min` (the minimum precedence the
current expression accepts) and `l-bop` (the operator to emit when the
expression ends). A table key and a unary operand are parsed with that state
saved and put back around the call, because a key that changed `l-min` would
change how the *outer* expression is parsed. `l-operand` is the helper that
does this for a unary operand: it parses at precedence 7 and restores the
state afterwards.

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

A float literal is not parsed here. The compiler hands the token text to the
kernel's own number scanner with `evaluate`, which reads `1.5`, `0.25`,
`1.5e3` and `1e3` exactly as the kernel reads them, and leaves the pair on the
stack as `(low high)`. The compiler emits those two cells as a `PUSHF`
operand. `evaluate` inside a colon word works, and the kernel's scanner
accepts the same forms the tokenizer recognizes, so the two agree.

### Compiled strings

`l-astr` copies a string token into `l-arena` as `[length][bytes...]` and
returns the address of the length cell. `PUSHS` stores that address as its
operand. At runtime `vpushs` pushes `address+1`, `length`, tag 3. The compiler
therefore keeps one length cell per literal even though the runtime value is
just an `(address length)` pair.

The compile-time arena is 500 cells and refuses to exceed 500 bytes used
(`-7`). It is never reused during a run. Because a run compiles from scratch,
the next `lila` call starts with `l-ap = 0`.

### String escapes

A string literal carries the same escapes as the host compiler in
`lila/compiler.fs`:

| escape | result |
|---|---|
| `\a` `\b` `\f` `\n` `\r` `\t` `\v` | bell, backspace, form feed, line feed, carriage return, tab, vertical tab |
| `\\` | a backslash |
| `\"` `\'` | a double quote, a single quote |
| `\ddd` | the byte of a decimal number, one to three digits, at most 255 |
| `\xXX` | the byte of two hexadecimal digits |
| `\z` | nothing: it skips the spaces and tabs after it |
| `\u{...}` | the UTF-8 encoding of a code point |

`\ddd` is decimal, as in Lua: `\101` is `e`, not `A`. `\xXX` is hexadecimal:
`\x41` is `A`. An escape that is not in the table is `-4`.

The decoder is `l-esc`, called by `l-astr` for every backslash in the token.
`l-astr` walks the raw text and writes the decoded bytes into `l-arena`, so a
string literal is no longer a copy of the token but the bytes it stands for.
The length cell in front of the bytes holds the *decoded* length, which is
never longer than the text it came from: `\u{20ac}` is eight characters of
source and three bytes of output.

The seven simple escapes are a table, `l-esct`: the index is the letter minus
97, so the table covers `a` to `v`, and a zero entry means the letter is not a
simple escape. `"`, `'` and `\` are identity escapes and are handled before
the table. `\x`, `\z`, `\u` and `\ddd` have their own branches.

`\u{...}` takes at least one hexadecimal digit and a closing brace. The code
point is at most `0xFFFF`, because the profile has no surrogate pairs and no
code point above the basic multilingual plane; a larger one is `-4`. The
emitter `l-u8` writes the leading byte first and then the continuation bytes,
the same order as the host's `utf8-emit`.

`\z` skips a space, a tab, a line feed, a vertical tab, a form feed and a
carriage return, the same set as the host's `space-char?`. The native source
is line-based, so the line feed is rejected by the tokenizer before the
decoder ever sees it: `\z` cannot skip a line feed here.

Two limits come from the 16-bit cell. A code point above `0xFFFF` does not
fit, and the UTF-8 bytes have to be masked to eight bits on the way out.

### Bytecode

There are 30 opcodes. Column "operands" counts cells after the opcode; a cell
is 16 bits on the target.

| # | opcode | operands | action |
|---:|---|---:|---|
| 0 | `PUSH` | 2 | push `(lo hi 1)` |
| 1 | `LOAD` | 1 | push the slot's value |
| 2 | `STORE` | 1 | pop a value into the slot |
| 3 | `ADD` | 0 | pop two numbers, push the sum |
| 4 | `SUB` | 0 | pop two numbers, push `a - b` |
| 5 | `MUL` | 0 | pop two numbers, push the product |
| 6 | `DIV` | 0 | pop two numbers, push the float quotient |
| 7 | `NE` | 0 | push `a ~= b` |
| 8 | `EQ` | 0 | push `a == b` |
| 9 | `GE` | 0 | push `a >= b` |
| 10 | `LT` | 0 | push `a < b` |
| 11 | `LE` | 0 | push `a <= b` |
| 12 | `GT` | 0 | push `a > b` |
| 13 | `JMP` | 1 | set `pc` to the target cell |
| 14 | `JZ` | 1 | pop a value; jump when falsy |
| 15 | `PRINT` | 0 | pop and print a value |
| 16 | `TAB` | 0 | emit a tab |
| 17 | `EOL` | 0 | emit a newline |
| 18 | `PUSHS` | 1 | push a compiled string |
| 19 | `CONCAT` | 0 | pop two strings, push their concatenation |
| 20 | `HALT` | 0 | stop |
| 21 | `NEG` | 0 | pop a number, push its negation |
| 22 | `PUSHF` | 2 | push `(flo fhi 5)` |
| 23 | `POW` | 0 | pop two numbers, push the float power |
| 24 | `IDIV` | 0 | pop two numbers, push the quotient |
| 25 | `MOD` | 0 | pop two numbers, push the remainder |
| 26 | `TNEW` | 0 | push a new empty table |
| 27 | `TGET` | 0 | pop a key and a table, push the value |
| 28 | `TSET` | 0 | pop a value, a key and a table, write the entry |
| 29 | `LEN` | 0 | pop a string or a table, push its length or border |

Every opcode except `PUSH` and `PUSHF` has at most one operand, and those two
are the only ones that push a literal payload directly. Branches are absolute,
so patching is a single cell store. There is no explicit code-size check: the
256-token cap keeps emission inside the 1024-cell buffer.

The comparison opcodes are packed: an odd opcode negates the answer, an opcode
above 10 swaps the operands, and an opcode above 8 is a less-test rather than
an equality test. So `NE`, `GE` and `LE` negate, `LE` and `GT` swap, and
`GE`, `LT`, `LE` and `GT` use the less-test. One handler covers all six.

### VM

`l-run` resets `l-pc` and loops:

```forth
: l-run ( -- )
  0 l-pc !
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

- `vnum` appends the number tag: `(lo hi -- lo hi 1)`.
- `vbool` turns any flag into `(0xFFFF 0 2)` or `(0 0 2)`.
- `d*` multiplies two 32-bit pairs modulo 2^32 using three `um*` products:
  `lo1*lo2`, plus the low halves of `lo1*hi2` and `hi1*lo2` folded into the
  high cell.
- `v-take` takes the two operands off the value stack and checks that both
  carry a number or a float tag; anything else is `-26`.
- `NEG` is `dnegate` for an integer and `fnegate` for a float.

The binary operators share handlers. `op-arith` reads the opcode, picks the
kernel word from `l-fops` (`f+`, `f-`, `f*`) or from `l-iops` (`d+`, `d-`,
`d*`), and converts an integer operand with `v-i2f` when the other operand is
a float. A division always takes the float path. `op-cmp` works the same way
with `l-fcmp` (`f=`, `f<`) and `l-icmp` (`d=`, `d<`).

`v-i2f` converts an integer pair to a float. The high half is signed and the
low half is the plain magnitude, so the two halves are converted separately:
the low half contributes its value below 32768 plus 32768 when bit 15 is set,
and the high half contributes 65536 times its signed value. The kernel's `s>f`
sign-extends a cell, so the mask has to be tested before the conversion, not
after it.

`v-ffloor` is the floor of a float. The kernel's `f>s` truncates toward zero,
so one is taken off when the value is below the truncated one. `v-qt` is the
quotient as a whole number: it rejects a quotient outside the signed 16-bit
range with `-25`.

`v-falsy?` implements Lua truthiness: tag 0 is falsy, tag 2 is falsy when
`value1` is zero, and the other tags are always truthy. `v-print` dispatches on
the tag: tag 5 prints with `f.`, tag 1 with `0 d.r`, tag 3 with `type`, tag 2
as `true`/`false`, tag 4 as `<table>`, and tag 0 as `nil`.

The table handlers are `op-tnew`, `op-tget`, `op-tset` and `op-len`. The
runtime helpers behind them are:

- `t-key?` answers whether a slot holds the key the caller is looking for.
  The tags have to match first; a number matches by its 32-bit value, a
  string by its bytes, a boolean by its flag, and anything else by its
  payload.
- `t-find` scans all eight slots of a table and answers whether the key is
  there, leaving the slot in `l-ts`. Every slot is looked at, so a slot freed
  by a delete does not hide the keys behind it.
- `t-free` finds the first slot whose occupied flag is clear.
- `t-setk` and `t-setv` write a key and a value into a slot; `t-setk` also
  sets the occupied flag.
- `t-border` walks the keys `1, 2, 3, ...` and stops at the first one that is
  not there. The answer is the largest `n` for which `1..n` are all present.

`op-tnew` takes the next block of eight slots out of `l-tslot`, clears it, and
pushes the block's address with the table tag. A ninth table is `-32`.
`op-tget` answers nil for a missing key. `op-tset` writes a new entry into
the first free slot, updates an entry that is already there, or — when the
value is nil — clears the occupied flag of the entry, which deletes it. A
table with no free slot left is `-31`. A nil key is `-30` in both, and a value
that is not a table is `-29`.

`v-concat` copies both inputs into `l-rstr` as `[total length][bytes...]`,
advances `l-rp` by the length plus the length cell, and pushes
`(address+1 length 3)`. The 200-byte watermark is checked before the copy and
raises `-11` when full. Nothing is reclaimed, so a loop that concatenates
forever eventually fails; a fixed number of concatenations is fine.

### Errors

The session compiles and runs each line separately, so there are two catches:

```forth
: l-pending ( -- f )
  l-nsym @ l-save-nsym !
  l-ap @ l-save-ap !
  ['] l-compile catch ?dup if
    l-save-nsym @ l-nsym !
    l-save-ap @ l-ap !
    dup -23 = if drop true exit then
    l-err
  else
    ['] l-run catch ?dup if l-err then
  then
  0 l-src-n !
  false ;
```

A compile error prints `LERR <code>` and drops the pending source; the
session carries on with the next line. A run error prints the same and drops
the pending source as well, but keeps the symbol table and the globals: the
program may have stored values before it stopped. A compile that ends in the
middle of a statement is not an error at all: it throws `-23`, the pending
source stays, and the session reads another line.

`catch` restores the data stack, so a rejected line does not leave temporary
values behind. A successful program must also be balanced by construction;
`tests/native-lila.test.js` checks that with `depth . cr`.

Both catches print the message on a line of its own. `l-line` echoes the CR
of the Return before the line is compiled, so the cursor is already at the
start of a line; a run-time error cannot be in the middle of one, because
every `print` ends with a newline.

| code | meaning |
|---:|---|
| -1 | source too long |
| -2 | too many tokens |
| -3 | newline inside a string |
| -4 | invalid escape sequence |
| -5 | unterminated string |
| -6 | too many global names (or a name over 15 characters) |
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
| -27 | expected `}` after `{` |
| -28 | expected `]` after the key |
| -29 | the value is not a table |
| -30 | the table index is nil |
| -31 | the table is full |
| -32 | too many tables |
| -33 | `#` needs a string or a table |

Several codes name the point where parsing stopped, not the construct itself.
`print(1.)` reports `-20` because the `.` is an operator the expression
grammar does not know and the parser then expects `)`. `function f() end` and
`local x = 1` are parsed as assignments until the missing `=`, so they report
`-21`.

`-3`, `-4` and `-5` are the three string errors. `-3` is a line feed that fell
inside a string, `-4` is an escape that is not in the set, and `-5` is a string
that held an escape and was still open when the source ended. The last one
happens when an escape ate the closing quote: `print("a\")` leaves the string
open, so it is `-5` rather than `-3`.

The last three codes are run-time errors, thrown by the VM: `-24` by a
division, `-25` by a quotient that is too large, and `-26` by an operator
that gets a string, a boolean or nil where a number belongs.

The table codes split between the parser and the VM. `-27` and `-28` are
parse errors: the constructor's `}` and the index's `]` are missing. `-29`,
`-30`, `-31`, `-32` and `-33` are run-time errors, thrown by the table
handlers: the value is not a table, the key is nil, the table has no free
slot, the session has no free table, and `#` got something that is neither a
string nor a table.

`-23` is the one code that is not a failure. It says the line ended where a
statement was still open, so the session waits for the next line and tries
the whole pending source again. `-8` and `-12` are the two codes that used to
mean "the source ended here"; they are unreachable now, because every rule
that needs a token reports `-23` at the end of the stream instead.

An empty line ends the session. If a statement was still open, the session
reports `-23` first, so the user learns why the session ended.

## Limits

| area | limit | reason |
|---|---|---|
| source text | 700 characters | `l-src` reserves 768 cells; the source is byte-packed |
| input line | 120 characters | the `accept` buffer size |
| tokens | 256 | three 256-cell token arrays |
| global names | 16 names, 15 characters each | 16 name entries in `l-sym` |
| bytecode | 1024 cells | `l-code` |
| compiled strings | 500 bytes | `l-arena` is 500 cells |
| `\u` code point | `0xFFFF` | the profile has no surrogate pairs |
| concatenation | 200 bytes, never reclaimed | `l-rstr` is 200 cells |
| float quotient | a signed 16-bit cell | the kernel has no 32-bit division |
| tables | 8 per session | `l-tslot` holds 8 blocks |
| table entries | 8 per table | 8 slots of 7 cells per block |

The compiler is intentionally fixed-size. There is no heap, no GC and no
allocation during compilation: every array is reserved when the Forth file is
loaded, and the limits that matter — source length, token count, name count,
name length and the two arenas — are checked before anything is written. The
bytecode buffer is the one exception; it relies on the token cap to stay
inside 1024 cells. That is what makes it possible to run the whole pipeline in
a dictionary that already has about 22k cells free.

The escape decoder is what the profile gave up the most room for before the
tables. The compiler grew by 762 cells, from 8,519 to 9,281. The loader no
longer holds the source text in the dictionary, so the load left 23,501
dictionary cells free.

The tables are the next step up in size. The pool is 448 cells of slots and
the code around it is about 1,000 cells, so the compiler grew from 9,281
cells to 10,756, leaving 22,026 free. The pool is not reclaimed either: a
table that has had eight entries stays full for the rest of the session, and
a ninth table in the same session is refused.

The name budget, the globals and the two string arenas are per *session*, not
per line. That is what makes the state carry from one line to the next, and
it is also what bounds a session: 16 names for the whole session, 500 bytes
of string literals and 200 bytes of concatenation results, none of it
reclaimed.

## Testing

`tests/native-lila.test.js` is the executable specification. It:

1. assembles `asm/forth_nano.asm` with the D16SEG defines and the soft-float
   library, and scatters the flat image into the segmented map, matching
   `flash_boot.sv`;
2. loads the SPI slices, types the compiler into the console one line at a
   time, and fails if the outer interpreter reports an error;
3. types a fixture program line by line and compares the machine output with
   the `lua5.4` 5.4.8 fixture;
4. types `depth . cr` and requires `0`;
5. runs the float cases and checks the kernel's `f.` output;
6. runs the escape cases, including the UTF-8 ones as bytes, and checks the
   invalid escapes;
7. runs the table cases — the constructor, the reads and writes, the border,
   the delete, a table in a table, a table in a global, a table in a block and
   in a loop — and checks the eight-entry and eight-table limits;
8. runs every rejection case and checks its negative code;
9. runs every unfinished-source case and checks that it reports `-23`;
10. checks that the state carries from one line to the next, that a block can
    be spread over several lines, and that a rejected line does not poison the
    next one;
11. checks that comment-only and empty sources compile to a halt.

To add a language case, add its lines to `program` and its expected lines to
`expected` in the test, keeping them in `lua5.4` agreement. A float case does
not fit that fixture, because the float output is the kernel's and not Lua's:
add it to `floats` instead. A table case fits the `tables` list, with its
expected output as a string. To add a rejection, append `[name, source, code]`
to `rejected`; to add a source that may be continued, append `[name, source]`
to `unfinished` and expect `-23`. The test embeds the expected output, so it
does not need Lua installed.

`gforth lila/test.fs` is the separate host-compiler suite; it does not load
the native profile.

`tests/native-lila-slice.test.js` is the device-faithful twin: it loads the
same compiler from the config flash with `s" lila" need` instead of typing it
in, then runs the same fixture and checks the same depth. It also checks the
float profile and the table profile on the compiler that came out of the
flash. The two tests share a boot harness in `tests/native-lila-harness.js`.

## Extending the profile

The implementation is arranged so each extension touches a small number of
places:

- **New binary operator:** add its static fragment near `p-plus`, give it a
  precedence and opcode in `l-binop`, add an opcode constant, add a handler
  (`v-take`, the operation, `vnum`), and append the handler to `l-ops`.
- **New unary operator:** add a fragment, match it in `l-unary`, and emit a
  new opcode that consumes one value and pushes one.
- **New statement:** add a keyword fragment, match it in `l-stmt`, and write a
  handler that emits code. Use `l-block` for a body and `l-jz`/`l-jmp` plus
  `l-patch` for branches.
- **New type:** add a tag, extend `v-falsy?`, `v-print` and `v-take`, and
  decide what arithmetic and comparison mean for it. The value size is fixed
  at three cells.
- **Locals or functions:** these need more than a parser hook. They need
  storage beyond the 16 global slots, a frame or heap layout, and a calling
  convention. The host compiler already has designs for both; see
  `TYPEPLAN.md` and `lila/README.md`.
- **Bigger tables:** the pool in `l-tslot` is fixed at eight tables of eight
  slots. Making it grow means either a heap (the profile has none) or a
  larger fixed pool, and the pool's size is a hard limit on the dictionary.

Some DeepForth-specific traps are worth remembering when editing the file:

- `variable` leaves its cell address on the stack, so the declarations here
  end in `drop`.
- There is no `>=` or `<=`; use `< 0=` or the double-cell equivalents.
- `do`/`?do`/`loop` only compile inside a definition.
- `code,` stores cells, not bytes, and jump targets are cell indices.
- Every opcode handler must advance `l-pc` by the opcode's total size,
  including operand cells.
- `v-take` deliberately keeps two-cell doubles while discarding tags; the
  stack order is `(low high)` with high on top.
- The kernel's `s>f` sign-extends its cell, so a cell with bit 15 set cannot
  be converted to a float directly; mask it first.
- The float pair is `(low high)` with the high half on top, the same order the
  kernel float words read.

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
