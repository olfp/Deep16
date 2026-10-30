# DeepForth — mini manual

DeepForth is the Forth in `asm/forth.asm`. It boots to a `>` prompt: type a
line, press enter, and each word on it runs. `: name ... ;` starts and ends a
compiled definition; inside one, words are compiled instead of run. A mistake
prints `undefined word: X` or `stack underflow` and the prompt comes back.

```text
: square dup * ;      \ compile a word
5 square .            \ 25  ok
-7 2/ .               \ -4  ok   (the sign is part of the literal)
```

## Conventions

- Stack effects are written `( before -- after )`, top of stack on the right.
- `n` / `u` — a 16-bit cell, signed / unsigned; `flag` — `-1` (true) or `0`
  (false); `addr` — a cell address; `c` — a character; `--` means nothing.
- **One cell is one address unit** (a 16-bit word): `cells` is the identity and
  `cell+` adds 1. Memory is word-addressed, not byte-addressed.
- Numbers are read in `base` — decimal until `hex` says otherwise. `0x10` and
  `$10` are hex whatever `base` is. A leading `-` makes the literal negative
  (`-7`), but only where a digit follows it: `-rot` is still the word `-rot`,
  and `-$10` and `-0x10` are words too, because the sign is not allowed to
  combine with a hex prefix. Above base ten a letter digit counts as well, so
  `hex -FF` is -255.
- Words marked **imm** run while compiling (`if`, `do`, `;`, …).
- `/`, `mod` and `/mod` are signed and truncate toward zero; the remainder
  takes the sign of the dividend. `2/` is an arithmetic shift and floors.
  Dividing by zero yields `0xFFFF`, and `mod` by zero yields the dividend.

## Numbers and the base

Both the scanner and the printer read `base`, which is a variable.

| word | stack effect | meaning |
|------|--------------|---------|
| `base` | `( -- addr )` | the cell holding the current base: 10 at boot |
| `hex` | `( -- )` | read and print in base 16 (`16 base !`) |
| `decimal` | `( -- )` | read and print in base 10 (`10 base !`) |
| `>number` | `( ud1 c-addr1 u1 -- ud2 c-addr2 u2 )` | convert the leading digits into `ud1`, in the current base |

In base sixteen `ff`, `FF` and `Ff` are all 255, and `0x10` and `$10` stay hex
in every base. A token is a number only if every character is a digit of the
current base; anything else is looked up as a word, so `hex dup` is still `dup`
(and reports the empty stack) while `hex zz` is `undefined word: zz`. A `-`
before the digits makes it negative: `-7` is a literal, while `-`, `-rot` and
`-$10` are words, because the sign has to be followed by a digit of the current
base (`hex -FF` is a number, `decimal -FF` is not). The one token that cannot
have both readings is a name that is all digits in the current base: `hex : beef
7 ; beef` reads 0xBEEF, so define names like that in decimal, where they keep
their meaning.

Printing follows the base as well: `hex 0 1 - u.` prints `FFFF`, `hex 0x8000 .`
prints `-8000`, and `65535 2 base ! u. decimal` prints sixteen ones. Printing
works in any base from two upwards; a digit above fifteen comes out as `G`
onwards, but the scanner stops at `F`, so such a digit cannot be typed back in.
A base below two is undefined — the standard allows two to thirty-six — and is
only a cell here, so it can be stored; the printer then stops after sixteen
digits instead of dividing by zero or by one for ever.

`>number` is the scanner's own step, exposed: it folds the leading digits of a
string into the double it is given (multiply by the base, add the digit) and
answers the rest of the string, so it stops at the first character that is not a
digit of the current base. `0 0 s" 123" >number` leaves `123`, and
`hex 0 0 s" ff" >number` leaves `255`. It takes the same digit vocabulary the
scanner does — `0`-`9` and `A`-`F`/`a`-`f` — so a base above sixteen cannot be
typed in even though the printer can write it.

## Pictured numbers

`<# #s #> type` is the other way to write a number: instead of printing it,
these words build it in a hold area of their own.

| word | stack effect | meaning |
|------|--------------|---------|
| `<#` | `( -- )` | begin a pictured number |
| `#` | `( ud1 -- ud2 )` | divide the double by the base and hold one digit |
| `#s` | `( ud1 -- ud0 )` | hold every digit, at least one |
| `#>` | `( ud -- c-addr u )` | end the picture: the string, ready for `type` |
| `hold` | `( c -- )` | put one character into the picture |
| `sign` | `( n -- )` | hold a minus when `n` is negative |

The number is a **double**: two cells, the high half on top. A positive number
leaves a zero in that high cell and a negative one a minus there, which is what
the standard's own idiom relies on. `#` divides the double by the base that is
in force, so the same words print in whatever base is set:

```text
: .n  dup abs 0 <# #s rot sign #> type ;  \ -5  ok
5 negate .n
hex 255 .n                                \ FF  ok
```

`hold` prepends, so `0 0 <# 66 hold 65 hold #> type` writes `AB`. The hold area
is a fixed buffer whose cursor walks down from its end, so nothing has to be
reversed; more than forty characters in one picture are dropped rather than
written past the buffer. `#` divides with the kernel's **exact unsigned** 32÷16
(`udiv`), so the whole unsigned 32-bit range converts, in any base:
`0xFFFF 0xFFFF <# #s #> type` is `4294967295`, and the quotient it keeps is a
full double, not one cell.

## Double-cell numbers

A double is two cells with the **high half on top** — the order `#`/`#>` build
and consume, the order `s>d` produces, and for a negative number the sign lives
in that high cell.

| word | stack effect | meaning |
|------|--------------|---------|
| `s>d` | `( n -- d )` | widen a single to a double |
| `d>s` | `( d -- n )` | drop the high cell, keeping the low one |
| `d+` | `( d1 d2 -- d3 )` | double add |
| `d-` | `( d1 d2 -- d3 )` | double subtract |
| `dnegate` | `( d -- -d )` | double negate |
| `dabs` | `( d -- ud )` | absolute value |
| `m+` | `( d1 n -- d2 )` | add a single to a double |
| `d=` | `( d1 d2 -- flag )` | equal |
| `d0=` | `( d -- flag )` | zero |
| `d<` | `( d1 d2 -- flag )` | signed less than |
| `dmax` | `( d1 d2 -- d )` | the larger of two |
| `dmin` | `( d1 d2 -- d )` | the smaller of two |
| `um*` | `( u1 u2 -- ud )` | the unsigned 32-bit product |
| `m*` | `( n1 n2 -- d )` | the signed 32-bit product |
| `um/mod` | `( ud u1 -- u2 u3 )` | unsigned division: `u2` remainder, `u3` quotient |
| `sm/rem` | `( d1 n1 -- n2 n3 )` | symmetric division: `n2` remainder, `n3` quotient |
| `fm/mod` | `( d1 n1 -- n2 n3 )` | floored division, the same two cells |
| `d.` | `( d -- )` | print a signed double, then a space |
| `d.r` | `( d n -- )` | print it right-aligned in a field `n` wide |

The divisions answer the **quotient on top** and the remainder below it, which is
what the standard's `u3` and `n3` are. `sm/rem` truncates the quotient toward
zero and gives the remainder the dividend's sign, so `-7 2 sm/rem` is the
quotient `-3` and the remainder `-1`; `fm/mod` floors, so the remainder takes the
divisor's sign and the same pair is `-4` and `1`. Both are exact.

One limit comes from the divider the machine has, which is the **signed** 32÷16
one:

- `m*` is not `um*`: the high half of a product does depend on the signs
  (`3 × -4` is `-12` while `3 × 0xFFFC` is `0x0002FFF4`), so `m*` corrects the
  unsigned result of `MUL32`.

`um/mod` does **not** share that limit. The kernel's `udiv` divides unsigned
32÷16 exactly: for a divisor below `0x8000` it is two signed `DIV32` steps (a
zero high half keeps the first dividend positive, and its remainder stays below
the divisor, so the second dividend is positive too), and for a divisor of
`0x8000` or more, which the signed divider would read as negative, it divides a
bit at a time. So `0 0x0001 0x8000 um/mod` is `2 0` where it used to be `-2 0`,
and any divisor up to `0xFFFF` is exact. The quotient is still one cell, as the
standard's `u3` is; a quotient that needs more is undefined.

`d>s`, `dabs`, `dmax` and `dmin` are the short ones, and all four are decided by
the high cell, which is where a double's sign lives. `dmax` and `dmin` share the
comparison `d<` uses, so they take the overflow flag into account and answer
correctly across the sign boundary (`0 0x8000` is the most negative double, and
`dmax` against `1 0` picks the `1`).

`d.` and `d.r` print through the **same hold area** as `<#`/`#`/`#>` and the same
digit step, so a double prints in the current base and follows the hold rules. The
minus is held **last**, because the buffer fills backwards — exactly why `sign` is
called after `#s`; without that a negative double would print as `5-`. `d.r` is
right-aligned in a field of `n`: it pads with spaces when the digits are narrower
and prints everything when they are not, so `123 s>d 8 d.r` is `     123` and
`1234 s>d 2 d.r` is `1234`.

## Stack

| word | stack effect | meaning |
|------|--------------|---------|
| `drop` | `( x -- )` | discard the top cell |
| `dup` | `( x -- x x )` | duplicate the top cell |
| `swap` | `( a b -- b a )` | exchange the top two |
| `over` | `( a b -- a b a )` | copy the second cell to the top |
| `rot` | `( a b c -- b c a )` | bring the third cell to the top |
| `nip` | `( a b -- b )` | drop the second cell |
| `2drop` | `( a b -- )` | discard the top two |
| `2dup` | `( a b -- a b a b )` | duplicate the top pair |
| `?dup` | `( x -- x \| x x )` | duplicate the top cell, but only if it is nonzero |
| `tuck` | `( a b -- b a b )` | copy the top cell under the second |
| `-rot` | `( a b c -- c a b )` | rotate the other way: the third cell to the top |
| `2over` | `( a b c d -- a b c d a b )` | copy the second pair to the top |
| `2swap` | `( a b c d -- c d a b )` | exchange the two top pairs |
| `depth` | `( -- n )` | number of cells on the data stack |
| `pick` | `( xu … x0 u -- xu … x0 xu )` | copy the u-th cell, counting the top as 0 |
| `roll` | `( xu … x0 u -- xu-1 … x0 xu )` | move the u-th cell to the top |

`0 pick` is `dup` and `0 roll` does nothing.

## Return stack

`>r`, `r>` and `r@` move a cell between the data stack and the return stack.
Keeping the two in balance is the program's job: the machine also keeps call
frames and loop parameters on the return stack, so an `r>` with nothing pushed
reads a return address, and a `>r` left open when a loop word runs moves the
pointer out from under the loop's own frame.

| word | stack effect | meaning |
|------|--------------|---------|
| `>r` | `( x -- )` | move `x` from the data stack to the return stack |
| `r>` | `( -- x )` | move the top of the return stack to the data stack |
| `r@` | `( -- x )` | copy the top of the return stack to the data stack |
| `2>r` | `( x1 x2 -- )` | move two cells, the way `>r >r` would |
| `2r>` | `( -- x1 x2 )` | move them back, in order |
| `2r@` | `( -- x1 x2 )` | copy both, leaving the pair in place |

`>r` needs a cell on the data stack; `r>` and `r@` need one on the return
stack, and at the prompt the return stack is empty, so both report
`stack underflow` rather than reading past its base. The three pair words
(`2>r`, `2r>`, `2r@`) work the same way two cells at a time and check for two,
and they leave the pair in the order it was given — `5 6 2>r 2r>` is `5 6`.

## Arithmetic

| word | stack effect | meaning |
|------|--------------|---------|
| `+` | `( a b -- a+b )` | add |
| `-` | `( a b -- a-b )` | subtract |
| `*` | `( a b -- a*b )` | multiply, keeping the low 16 bits |
| `/` | `( n1 n2 -- quot )` | signed quotient, truncated toward zero (`n2=0` gives `0xFFFF`) |
| `mod` | `( n1 n2 -- rem )` | signed remainder, sign of `n1` (`n2=0` gives `n1`) |
| `/mod` | `( n1 n2 -- rem quot )` | both at once |
| `negate` | `( n -- -n )` | two's complement negate |
| `abs` | `( n -- \|n\| )` | magnitude (`-32768` stays itself) |
| `min` | `( a b -- min )` | signed minimum |
| `max` | `( a b -- max )` | signed maximum |
| `1+` | `( n -- n+1 )` | increment |
| `1-` | `( n -- n-1 )` | decrement |
| `2*` | `( n -- n*2 )` | shift left one bit |
| `2/` | `( n -- n/2 )` | arithmetic shift right (floors) |
| `*/` | `( n1 n2 n3 -- quot )` | `n1*n2/n3`, the product formed as a double |
| `*/MOD` | `( n1 n2 n3 -- rem quot )` | both at once, same double product |

## Bit and logic

| word | stack effect | meaning |
|------|--------------|---------|
| `and` | `( a b -- a&b )` | bitwise AND |
| `or` | `( a b -- a\|b )` | bitwise OR |
| `xor` | `( a b -- a^b )` | bitwise XOR |
| `invert` | `( a -- ~a )` | bitwise NOT |
| `lshift` | `( x u -- x<<u )` | logical left shift by `u` bits |
| `rshift` | `( x u -- x>>u )` | logical right shift (fills with 0) |

## Comparison

All push `-1` for true and `0` for false.

| word | stack effect | meaning |
|------|--------------|---------|
| `=` | `( a b -- flag )` | equal |
| `<>` | `( a b -- flag )` | not equal |
| `<` | `( a b -- flag )` | signed less than |
| `>` | `( a b -- flag )` | signed greater than |
| `0=` | `( n -- flag )` | zero |
| `0<>` | `( n -- flag )` | nonzero |
| `0<` | `( n -- flag )` | negative |
| `0>` | `( n -- flag )` | positive |
| `u<` | `( u1 u2 -- flag )` | unsigned less than |
| `u>` | `( u1 u2 -- flag )` | unsigned greater than |
| `within` | `( n lo hi -- flag )` | `lo <= n < hi`, read unsigned |
| `true` | `( -- -1 )` | the true flag itself |
| `false` | `( -- 0 )` | the false flag itself |

`<`, `>`, `min` and `max` are signed and are right at the sign boundary, where
the subtraction they compare overflows: `0x8000` counts as negative there, and
so `0x8000 1 <` is true while `0x8000 1 max` is `1`. `u<` and `u>` read the
borrow instead, which is why the same pair of cells can come out opposite ways:
`0 1 - 1 <` is true while `0 1 - 1 u<` is false, and `1 0 1 - u<` is true
although signed `<` would deny it. `within` is the unsigned form too, so a
value below `lo` wraps to a large number and stays outside rather than being
mistaken for a value above `lo`.

## Memory

| word | stack effect | meaning |
|------|--------------|---------|
| `@` | `( addr -- x )` | fetch the cell at `addr` |
| `!` | `( x addr -- )` | store `x` in the cell at `addr` |
| `c@` | `( addr -- c )` | fetch the low 8 bits of the cell |
| `c!` | `( c addr -- )` | store the low 8 bits of `c` in the cell |
| `es@` | `( off -- x )` | fetch the cell at ES offset `off` |
| `es!` | `( x off -- )` | store `x` at ES offset `off` |
| `+!` | `( n addr -- )` | add `n` to the cell at `addr` |
| `2@` | `( addr -- x1 x2 )` | fetch the pair: `x1` at `addr+1`, `x2` at `addr` |
| `2!` | `( x1 x2 addr -- )` | store the pair, `x2` low and `x1` high |
| `move` | `( src dst u -- )` | copy `u` cells from `src` to `dst`, low address first |
| `fill` | `( addr u c -- )` | store `c` in `u` cells from `addr` |
| `erase` | `( addr u -- )` | store `0` in `u` cells from `addr` |
| `here` | `( -- addr )` | next free dictionary cell |
| `allot` | `( n -- )` | reserve `n` cells at `here` |
| `,` | `( x -- )` | compile `x` at `here` and advance |
| `c,` | `( c -- )` | same as `,`: one cell carries one character |
| `cells` | `( n -- n )` | cells to address units (the identity) |
| `cell+` | `( addr -- addr+1 )` | address of the next cell |
| `align` | `( -- )` | nothing: every address is cell-aligned here |
| `aligned` | `( addr -- a-addr )` | the identity, for the same reason |
| `pad` | `( -- addr )` | a transient scratch region (128 cells) |

`move`, `fill` and `erase` move upwards and expect `u >= 0`. Two things to
watch: a `variable` owns exactly **one** cell, and the next definition's header
begins right behind it, so a `2!` or a `fill` at a `variable` writes over the
next name's link and the dictionary search never comes back — reserve the room
first.

```text
variable x 2 allot  7 9 x 2!  x 2@ . .    \ 9 7  ok
```

`es@` and `es!` are the same two operations through **ES**, which the kernel
keeps at `0xF000` — the MMIO segment. `@`/`!` cannot reach a peripheral, because
DS points at the kernel's own data (segment 0 in the flat builds, `0x1000` on
the board); `0x80 es@` reads the SPI control register, for example.

## Characters and strings

| word | stack effect | meaning |
|------|--------------|---------|
| `bl` | `( -- 32 )` | the space character |
| `space` | `( -- )` | write one blank |
| `spaces` | `( n -- )` | write `n` blanks |
| `count` | `( c-addr -- c-addr+1 u )` | the characters and length of the counted string at `c-addr` |
| `char+` | `( c-addr -- c-addr+1 )` | the next character (one cell), so `1+` |
| `chars` | `( n -- n )` | characters to address units (the identity) |
| `type` | `( c-addr u -- )` | write `u` characters from `c-addr` |
| `s"` | `( "ccc" -- c-addr u )` | the text between the quotes, as a string |
| `c"` **imm** | `( "ccc" -- )` | compile an inline counted string; at run time it pushes its address |
| `/string` | `( c-addr1 u1 n -- c-addr2 u2 )` | the string from character `n` on |
| `blank` | `( c-addr u -- )` | fill `u` characters with blanks |
| `-trailing` | `( c-addr u1 -- c-addr u2 )` | drop the blanks at the end |
| `compare` | `( c-addr1 u1 c-addr2 u2 -- n )` | `-1`, `0` or `1`, compared unsigned |
| `search` | `( c-addr1 u1 c-addr2 u2 -- c-addr3 u3 flag )` | find a substring |
| `cmove` | `( c-addr1 c-addr2 u -- )` | copy `u` characters, low address first |
| `cmove>` | `( c-addr1 c-addr2 u -- )` | copy them high address first |

Two shapes of string live here, because one cell is one address unit. The
ordinary one is what `type`, `compare`, `search` and `s"` use: a slice of
one-character cells, given as an address and a length. The **counted** one is
what `word`, `find` and `c"` use, as ANS CORE asks: the length in the first cell
and the characters behind it, so a zero character is allowed inside it:

```text
here 2 c, 72 c, 73 c,  count type    \ HI  ok
```

`count` turns the first into the second: it reads the length from the first cell
and answers `c-addr+1` with it, which is exactly what `type` wants. `type` masks
each cell to its low 8 bits, so a NUL character writes nothing rather than
stopping.

`bl word` parses the next token into a counted buffer and answers its address, so
`bl word count type` echoes what was typed; `find` reads the length from that
first cell, and `c"` compiles one inline. The buffer `word` fills is also
NUL-terminated, so the cell after the characters is a zero either way.

A character is one cell, so `cmove` is `move` and `blank` is `fill` with a space —
the two only differ where a cell holds two characters. `cmove>` is the one that
really moves the other way, and it is what to reach for when the destination sits
above the source, the case `move` documents as the caller's problem. `compare`
and `search` read the cells and compare them **unsigned**, so a byte above `0x7F`
is greater than one below it; the high byte of a character travels through a copy
and is ignored by a comparison, exactly as `type` and `c@` ignore it. `search`
answers the **rest of the string from the match**, so `search type` prints what is
left after it:

```text
: a s" hello world" ;   : b s" wor" ;
a b search . type       \ -1 world  ok
a b search nip .        \ 5  ok
```

`."` and `s"` are written into the tokenizer and not into the dictionary — the
text between the quotes is not a token, so it could never be looked up. Both
drop the single blank that delimits the text, so `s" xy"` is the two-character
string `xy` and `." xy"` prints `xy`: what is written between the quotes is what
the value is and what the printout shows, and a blank that belongs to the text
needs a second blank in the source. Interpreted, `s"` answers a copy in a buffer
of its own — a second `s"` overwrites it, which is what the standard means by a
transient buffer — and compiled it copies the text into the definition, so the
answer is the same on every call. `\"` is unescaped while the text is stored, in
both halves of both words. A quote with no blank behind it is not a string at
all: `s"x"` reports itself as an undefined word.

## Names and execution

| word | stack effect | meaning |
|------|--------------|---------|
| `'` | `( "<spaces>name" -- xt )` | execution token of the next word |
| `char` | `( "<spaces>name" -- c )` | first character of the next token |
| `execute` | `( xt -- )` | run the word `xt` names |
| `[']` **imm** | `( "<spaces>name" -- )` | compile the xt of the next word |
| `[char]` **imm** | `( "<spaces>name" -- )` | compile the first character of the next token |
| `literal` **imm** | `( x -- )` | compile the value on the stack |
| `2literal` **imm** | `( x1 x2 -- )` | compile two values, the second ending on top |
| `evaluate` | `( i*x c-addr u -- j*x )` | interpret the string as a line of input |
| `included` | `( i*x c-addr u -- j*x )` | interpret the buffer as source, one line at a time |

An *execution token* is the address of a word's code field, which is the cell
the interpreter jumps through when it runs the word. `'` finds the next word and
leaves its xt; `execute` takes one and runs it, so a word can be chosen while
the program runs:

```text
: square dup * ;   5 ' square execute .    \ 25  ok
```

`evaluate` puts a string through the same tokenizer and the same words the
keyboard goes through, in the state that is current, so a string can define words
or compute. It copies the text into a buffer of its own — one per nesting level,
so a nested evaluation cannot overwrite the text its caller is still reading —
and terminates it, which is what the interpreter's end of line looks for. Two
levels nest; the standard asks for two. A string longer than a line, or a third
level, throws `-22`.

An unknown name inside an evaluation reaches a `catch` as `-13` — the only way to
get at that code, since the interpreter is what finds the name. A throw out of an
evaluation also puts the **input source** back, so the line that was being read
when it happened carries on instead of re-reading text that was abandoned.

```text
s" 1 2 + ." evaluate                  \ 3  ok
: c s" nosuch" evaluate ;
' c catch .                           \ -13  ok
```

`included` loads a buffer of **source text** rather than one line: it walks the
buffer, evaluates each line through the same machinery `evaluate` uses (a copy of
its own, so a line may itself `evaluate` without losing the text), and continues
at the next line when one ends, so a whole file produces a single ` ok` and a
single prompt. Newlines separate the lines; blank lines and comments are just
short harmless lines. It is the load path for a file that has been read into
memory, and it is what the browser uses to run a source file in one go. A loaded
line may call `refill` to take the load's next line by hand — the same step the
loader takes when a line ends.

It drives the input buffer itself, so it must run at the top level: called from
inside an `evaluate`, or while another `included` is running, it throws `-22`, as
it does for a line longer than 128 characters. An error in a loaded line (`-13`
included) ends the load and hands the keyboard back:

```text
1024 40 included        \ the 40 characters at 1024 as source, line by line
```

`'` and `char` are **not** immediate, so inside a definition they are compiled
like any other word and parse when the definition runs — a definition that says
`'` reads whatever follows its call at the prompt. `[']` and `[char]` are the
compile-time forms and are what a definition usually wants. `literal` takes a
value from the stack at compile time, which is how a computed number becomes a
compiled one:

```text
: width [ 6 7 * ] literal ;   width .      \ 42  ok
```

`2literal` is the pair: it takes two cells from the compile-time stack and
compiles both, so at run time they are pushed in the same order. It reads the
compile-time stack the same way, so the values come from between `[` and `]`:

```text
: pair [ 3 4 ] 2literal ;   pair . .        \ 4 3  ok
```

`char` reads the parse area and not the dictionary, so a token that names
nothing still names its own first character: `char abc` is `97`. A name that is
missing, for `'` or `[']`, is reported as `undefined word:` just as an unknown
word is.

## Defining words

| word | stack effect | meaning |
|------|--------------|---------|
| `:` | `( -- )` | `: name` begin a definition |
| `;` **imm** | `( -- )` | end the definition and stop compiling |
| `variable` | `( -- )` | `variable name`; `name` pushes its cell address |
| `2variable` | `( -- )` | like `variable`, but two cells: `2@` and `2!` have their pair |
| `constant` | `( x -- )` | `constant name`; `name` pushes `x` |
| `2constant` | `( x1 x2 -- )` | `2constant name`; `name` pushes both cells, in order |
| `value` | `( x -- )` | like `constant`, but changeable with `to` |
| `to` **imm** | `( x -- )` | `to name` stores `x` in a `value`'s cell |
| `create` | `( -- )` | `create name`; `name`'s body starts at `here` |
| `>body` | `( xt -- addr )` | the data field of a `create`d word (its CFA + 2) |
| `does>` | `( -- )` | attach the following code as a created word's action |
| `immediate` | `( -- )` | mark the most recent definition immediate |
| `state` | `( -- addr )` | address of STATE: `0` while interpreting, `1` while compiling |
| `[` **imm** | `( -- )` | switch to interpret state |
| `]` | `( -- )` | switch to compile state |
| `recurse` **imm** | `( -- )` | compile a call to the definition being built |
| `:noname` | `( -- xt )` | start a definition with no name; leaves its xt |
| `compile,` | `( xt -- )` | append a call to `xt` to the definition being built |
| `[compile]` **imm** | `( "name" -- )` | append a call to `name` whatever its immediacy |
| `postpone` **imm** | `( "name" -- )` | compile the compilation semantics of `name` |
| `marker` | `( "name" -- )` | `marker name`; running `name` rewinds the dictionary |
| `exit` | `( -- )` | return from the current definition |

```text
: const create , does> @ ;    \ a defining word
42 const answer answer .       \ 42  ok
```

`2constant` and `2variable` are the two-cell versions. A `2constant` has a
runtime of its own: it pushes both cells, in the order they were given, so the
second ends on top. A `2variable` owns **two** cells and leaves the address of
the first, which is what `2@` and `2!` expect. `see` names both — a `2constant`
prints as `2constant name x1 x2`, and it is still a variable that `see` reports
like any other.

`state` is a real variable. Its cell sits behind its code field the way `base`'s
does, so `state @` is `0` while the interpreter is reading a line and `1` while a
definition is being translated. An immediate word is the way to look at the `1`:

```text
: peek state @ . ; immediate   : t peek ;    \ t prints 1 while it is compiled
```

`compile,`, `[compile]` and `postpone` are how a program builds compiling
words. `compile,` appends the call to an xt it is handed — the one step the
compiler itself takes — so it needs the xt at compile time, the idiom being
`[ ' dup ] compile,` or, inside an immediate word, `['] dup compile,`.
`[compile]` parses a name and appends a call to it even when it is immediate.
`postpone` is the careful version: an immediate word is compiled as a call (so it
runs while the definition is being built), and a word that is not immediate is
compiled as `LIT <xt> COMPILE,` (so the definition compiles it when it runs).
That is what makes `: my-if postpone if ; immediate` an alias for `if`.

`:noname` starts a definition with **no header at all** — one cell holding
`docol` — and leaves its xt, so it can be stored and run but never found by
name. `recurse` inside it still calls it. `marker name` records where the
dictionary and the wordlist head stand; running `name` puts both back, so the
marker and everything defined after it are gone.

## Control flow

Inside a definition only; all are **imm** except `i`, `j` and `unloop`.

| word | stack effect | meaning |
|------|--------------|---------|
| `if` | `( flag -- )` | begin a conditional (`then`/`else` close it) |
| `else` | `( -- )` | the alternative branch |
| `then` | `( -- )` | close `if` / `else` |
| `begin` | `( -- )` | start a loop |
| `until` | `( flag -- )` | loop back while `flag` is false |
| `again` | `( -- )` | loop back forever |
| `while` | `( flag -- )` | leave the loop when `flag` is false |
| `repeat` | `( -- )` | close `begin` … `while` |
| `do` | `( limit start -- )` | counted loop: `limit start do … loop` |
| `?do` | `( limit start -- )` | `do`, but skip the body if `limit = start` |
| `loop` | `( -- )` | end `do`; increment the index and repeat |
| `+loop` | `( n -- )` | end `do`; add `n` to the index and repeat while it is short of the limit |
| `leave` | `( -- )` | leave the innermost loop |
| `unloop` | `( -- )` | drop the loop frame, so a following `exit` leaves the loop |
| `i` | `( -- index )` | current loop index |
| `j` | `( -- index )` | the index of the loop one level out |
| `case` | `( -- )` | begin a case: pick a clause by comparing a selector |
| `of` | `( -- )` | a clause whose test value the selector is compared with |
| `endof` | `( -- )` | end a clause |
| `endcase` | `( -- )` | end the case, dropping a selector that matched nothing |

`do` counts after the increment, so `10 0 do … loop` runs ten times while
`0 0 do … loop` runs 65536 times — use `?do` to skip when the bounds are equal.
`+loop` carries its own step and ends the loop at the first index that reaches
the limit, so a step that does not divide the range still terminates:
`10 0 do i . 3 +loop` prints `0 3 6 9`, and a negative step counts down to the
limit from above. `unloop` must be followed by `exit` (or the end of the
definition) for the loop to be left early.

`case` compares the selector with each clause's test value and runs the first
clause that matches; the selector is then dropped — by the clause that matched,
or by `endcase` when none did. A case that answers a value therefore has to put
the selector back where `endcase` can drop it, or keep it with `dup` in the
default clause:

```text
: .digit  ( n -- ) case 0 of ." zero" endof 1 of ." one" endof ." many" endcase ;
: pick2   ( n -- x ) case 1 of 100 endof 2 of 200 endof 0 swap endcase ;
```

`of` and `endof` compile nothing new: `of` is `over = if drop` and `endof` is
`else`, so `see` prints a case as the branches it really is.

## Exceptions

| word | stack effect | meaning |
|------|--------------|---------|
| `catch` | `( i*x xt -- j*x 0 \| i*x n )` | run `xt`: `0` if it returns, `n` if it throws |
| `throw` | `( k*x n -- k*x \| i*x n )` | `0` does nothing, anything else unwinds to the innermost `catch` |
| `abort` | `( i*x -- )` | the standard's `-1 throw` |
| `abort"` | `( flag "ccc" -- )` (imm) | print `ccc` and `-2 throw` when `flag` is non-zero |

`catch` runs an xt with a frame on the return stack that records where execution
should carry on, how deep the data stack was, and the frame of the catch outside
it. `throw` finds that frame, cuts the data stack back to the recorded depth,
unwinds the return stack to it, and resumes there with the code on top. A throw
from the bottom of a chain of calls therefore arrives as if the calls had
returned: everything the xt pushed is gone, and everything below the catch is
untouched.

The kernel's own errors are exceptions too while a handler is in reach: a stack
underflow throws `-4`, and an unknown name throws `-13` — that one becomes
reachable once a string can be interpreted, which needs `evaluate`. With no
handler in reach both behave exactly as they did before, a message and a fresh
prompt — and so does a throw that nothing is watching.

```text
: t 8 1 throw 9 ;        5 ' t catch . .     \ 1  5  ok
: inner 42 7 throw ;
: outer inner 99 ;       ' outer catch .     \ 7  ok
1 throw                                       \ uncaught exception
```

`abort"` is an ordinary immediate word and not a tokenizer case, so `' abort"`
finds it and `see` prints a compiled one back. One blank delimits its message,
as it does for `s"`; `catch` then receives `-2` with the message already on the
screen.

## Input, output and screen

| word | stack effect | meaning |
|------|--------------|---------|
| `emit` | `( c -- )` | write character `c` |
| `.` | `( n -- )` | print `n` signed, then a space |
| `u.` | `( u -- )` | print `u` unsigned, then a space |
| `cr` | `( -- )` | carriage return + line feed |
| `key` | `( -- c )` | wait for a key and push its low byte |
| `accept` | `( c-addr +n1 -- +n2 )` | read a line from the keyboard, at most `+n1` characters, into `c-addr` |
| `cls` | `( -- )` | clear the screen and home the cursor |
| `scr@` | `( off -- x )` | read screen cell at ES offset `off` |
| `scr!` | `( x off -- )` | write screen cell at ES offset `off` |
| `echo` | `( flag -- )` | turn keyboard echo on (`-1`) or off (`0`) |
| `echo?` | `( -- flag )` | keyboard echo state |
| `form` | `( -- rows cols )` | the screen's shape: `24` rows, `80` columns |
| `.r` | `( n width -- )` | print `n` right-aligned in `width` columns |
| `u.r` | `( u width -- )` | the same, unsigned |
| `.(` **imm** | `( "ccc)" -- )` | write the text up to the next `)` |
| `source-id` | `( -- -1 )` | the input source: `-1`, the keyboard |
| `word` | `( char -- c-addr )` | parse the next token, delimited by `char`, into a counted buffer |
| `parse` | `( char -- c-addr u )` | the input up to the next `char`, as a slice of the line |
| `>in` | `( -- addr )` | the parse offset, as a writable cell (see below) |
| `source` | `( -- c-addr u )` | the input line and its length |
| `refill` | `( -- flag )` | make the next line of the input source current |
| `save-input` | `( -- >in tib 2 )` | the input-source state, for `restore-input` |
| `restore-input` | `( >in tib 2 -- flag )` | put it back; `0` when it worked |
| `quit` | `( -- )` | empty the return stack, end the line, await the next |
| `environment?` | `( c-addr u -- false \| i*x true )` | answer an environment query |

`accept` is the standard reader: `( c-addr +n1 -- +n2 )` reads a line from the
keyboard into the caller's buffer — at most `+n1` characters, since the BIOS
reads the whole line into a buffer of its own first — and answers how much it
put there. The line is echoed as it is typed unless the echo is off, and a line
longer than `+n1` is simply cut. The routine behind the prompt is a different
one: it fills the input buffer, resets `>in`, and starts the interpreter.

`>in` is where the standard's model does not fit cleanly: the pointer into the
input buffer is the **register** `R5`, not a cell, so there is nothing whose
address it could answer. `>in` returns the address of `in_var`, a cell the
tokenizer writes whenever it moves the pointer, so `>in @` reads the live offset
(just past the word that ran it). A **store** into that cell is honoured: the
interpreter remembers the offset it last wrote there, so it can tell a hand store
from its own pointer moves and reads on from wherever the cell was put —
`80 >in !` ends the line, and a word may skip over the rest of it. `source`
measures the line the BIOS read up to its NUL. `refill` makes the next line of
whatever is being read current and answers true: at the keyboard it reads
another line, and inside a load (`included`) it hands over the next line of the
buffer, answering false once the buffer is spent. A string source (`evaluate`)
has no next line, so there `refill` is `0`. The line that called `refill` is
replaced by the new one, so the rest of it does not run — that is what makes the
answer the next line's to consume.
`save-input`/`restore-input` save and put back `(>in, tib)` — the count is `2`,
and any other count is refused with `-1`. `quit` empties the return stack,
returns to interpretation and ends the line, which is the outer interpreter
waiting for the next one. `environment?` answers `CORE`, `CORE-EXT`, `MAX-N`,
`MAX-U`, `ADDRESS-UNIT-BITS` and `/COUNTED-STRING` (case-insensitively) and is
false for anything else.

`form` is an extension, not standard Forth, and it answers the **visible**
screen: 24 rows, not the 25 the BIOS clears, because row 24 is the off-screen
row the scroll uses. Cols are on top, so `form swap drop` is the width. It lets a
program wrap its own output, and the two listings here already use it: `words`
and `see` never split a name or a number at the right edge. When the next token
plus its separator space would cross column 80, they print CR+LF first and start
the token on the next line whole — the break lands on the last space, not through
the middle of a word.

## Dictionary and the search order

| word | stack effect | meaning |
|------|--------------|---------|
| `words` | `( -- )` | list the first wordlist's names, newest first |
| `see` | `( -- )` | `see name` print how `name` is built instead of running it |
| `forget` | `( -- )` | `forget name` drops `name` and everything after it |
| `vocabulary` | `( -- )` | `vocabulary name` makes a new wordlist |
| `definitions` | `( -- )` | new definitions go into the first searched wordlist |
| `also` | `( -- )` | duplicate the first search-order entry |
| `previous` | `( -- )` | drop the first search-order entry |
| `only` | `( -- )` | search order is FORTH alone |
| `forth` | `( -- )` | make the FORTH wordlist the first searched |
| `find` | `( c-addr -- c-addr 0 \| xt 1 \| xt -1 )` | look a name up in the search order |
| `unused` | `( -- u )` | dictionary cells left before `0x4000` |

```text
vocabulary foo  also foo  definitions  \ define into foo
: bar 42 ;
only forth definitions                  \ back to FORTH
```

`see` prints a definition the way it was written: a colon word as `: name … ;`
(with each compiled word named, and a compiled string back as `." … "`), and
anything else as the word that made it — `variable name`, `constant name value`,
`2constant name x1 x2`, `create name does> …`, `vocabulary name`, or `code name`
for a primitive. It
walks the thread until the `;` the compiler put there, so an `exit` in the
middle of a body still shows the rest. Two things are not reconstructed:
`if`/`then`/`begin`/`until` appear as `(branch)`/`(0branch)` with the stored
offset, and a word the current search order cannot reach prints as `?<xt>` —
which is also where the listing stops if the thread runs past its own end (a
definition whose `;` never ran).

That is the whole dictionary: 213 words. New words are added at the head of the
current wordlist and found newest-first; `forget` rewinds to a name.

## SD card and blocks (boot-script words)

These are not part of the image's kernel dictionary: they are compiled by
`forth/demo.fth` at boot, so they appear in `words` only after the boot script
has run.

| word | stack effect | meaning |
|---|---|---|
| `sd ( -- )` | print whether the card answered, running `sd-init` |
| `sd-init ( -- n )` | reset and identify the card; `0` when it is ready |
| `sd-clk ( -- a )` | the identification clock divider (32 = ~100 kHz), a cell to store into |
| `sd-r1 ( -- a )` | the raw response byte of the stage that failed (`255` = an idle bus) |
| `sd-read ( n -- n )` | read sector `n` into `sd-buf`; `0` when it worked |
| `sd-write ( n -- n )` | write `sd-buf` to sector `n`; `0` when it worked |
| `sd-buf ( -- a )` | the 512-cell sector buffer (one character per cell) |
| `blk ( -- a )` | the sector currently in the buffer, `-1` before the first `block` |
| `block ( n -- a )` | sector `n`, read on a miss, then `sd-buf` |
| `include ( first count -- )` | read `count` sectors and interpret them as one source file |
| `save-block ( -- n )` | write `blk`'s buffer back to the card |

```text
sd                     \ SD card ready
5 block 40 type cr     \ sector 5, first 40 characters
```

A screen is one 512-byte sector of text: lines separated by LF, the rest of the
sector padded with LF (an empty line is a no-op). `include 1 7` loads the seven
sectors from sector 1 as one file; the payload limit is 11 sectors.
`scripts/make_screens.mjs` pads sources into such a blob and prints the sector
range and the `dd` command.

`sd-init`'s error codes name the stage that failed: `1` CMD0, `2` the CMD8
echo, `3` the init poll, `4` CMD58, `5` the read token, `6` the write response.
CMD0 is retried three times with a fresh 80-clock preamble, at the `sd-clk`
divider (32 is ~100 kHz; a smaller number is faster, `64` slower), and every
command gets its own CS edge. **CMD8 is optional**: a card that does not answer
it is a v1 card, and CMD58's CCS bit decides block or byte addressing, so only
a wrong echo stops the init. The poll then tries ACMD41 with HCS=1, ACMD41
with HCS=0 and finally CMD1 (MMC), 1,024 tries each, and gives up as soon as
the card stops answering. `sd-r1 @` keeps the raw byte the card sent in the
stage that failed (`255` = an idle bus).
Sector numbers are 16 bits — 32 MB of the card, a block system's own limit as
much as the driver's. The card is the only thing on SPI CS0 (`0xF0080`); CS1 is
the on-board 4 MB P25Q32U config flash, shared through the same master
(`ADVARCH.md`).

## Source screens: config-flash slices

The on-die flash CPU read port and its `flash@`/`screen` words were removed in
phase 2a. Sources now live in the on-board 4 MB P25Q32U config flash (SPI CS1)
as **4 KB slices** at `0x200000`, in the unprotected upper half. Slice 0 is the
master directory; `scripts/make_slices.mjs` packs `screens/flash/*.fth` into
`artifacts/image/slices.bin` and `npm run flash:slices` writes it at
`0x200000`.

The boot script loads the SD driver (slices 1..3) and the catalog (5..8):

```text
1 screen               \ the SD/block driver: sd, block, include
5 screen               \ the slice editor: dir, find, slice-create, ...
4 screen               \ hello.fth
hello                  \ hello from the user flash
```

`screen ( n -- )` follows the link chain, concatenates 2040 characters per
slice into `text-buf` (8,192 cells, four slices) and interprets the result.
The source slices are LF-padded, so each 2040-character chunk ends on a line
boundary. `screen` ends its line: `1 screen` does not return to the words that
follow it on the same line.

| word | effect |
|---|---|
| `slice ( n -- a )` | read slice `n` into `slice-buf` |
| `slice-valid? ( a -- f )` | magic `5` and a live header |
| `slice-type ( a -- t )` / `slice-link ( a -- n )` | header fields |
| `screen ( n -- )` | chain + concatenate + interpret |
| `dir` | list the master directory |
| `find ( addr len -- n )` | first slice of a named entry, `0xFFFF` if absent |
| `slice-create ( n t -- )` | blank header + payload in `slice-buf` |
| `slice-name! ( addr len -- )` | write the name into `slice-buf` |
| `slice-flush` | erase + program the current slice (refuses WP) |
| `dir-add ( n -- )` / `dir-remove ( n -- )` | edit the directory |
| `p-screen ( n which -- )` | run one 1020-cell half of a type-8 packed source |
| `sprite-slice ( n -- )` | copy a type-2 sprite slice to the sprite bank |

The SD card's `include ( first count -- )` remains the other source path: it
reads 512-byte sectors (not slices) from the card and interprets them.

### Tile console colours

The console writes text cells as `0x8000 | (pair << 12) | glyph`. The text
palette bank holds eight paper/ink pairs; `attr` chooses the pair for every
character that follows, and the three `*pal!` words write the banks at
`0xF5080`/`0xF5090`/`0xF50A0`. Writes are not frame-latched, so change them
during vblank or at a screen transition.

| word | effect |
|---|---|
| `pal! ( bg ink pair -- )` | write text-bank pair `p`: paper `2p`, ink `2p+1` |
| `art-pal! ( bg ink pair -- )` | write the art-bank pair used by mode-0 tiles |
| `sprite-pal! ( bg ink pair -- )` | write the shared sprite-bank pair |
| `attr ( pair -- )` | select the console pair (`0..7`), keep the style |
| `style ( flags -- )` | set style bits, keep the pair: `2` bold, `4` underline, `6` both |
| `attr! ( pair flags -- )` | set pair and style together |
| `attr@ ( -- pair )` | read the current console pair |
| `style@ ( -- flags )` | read the current style bits |

```text
0x1C 0xFC 3 pal!        \ text pair 3: green paper, yellow ink
3 attr                  \ the rest of the console uses pair 3
4 style                 \ underline everything printed next
attr@ .  style@ .       \ 3 4  ok
0 style                 \ plain text again
```

Bold is a real one-pixel smear in the tile engine (`2 style`). A cheaper
look is to reserve a bright-ink pair and select it with `attr`; the palette
has eight pairs, so pair 7 can be the bold one.

## Sound: I2S on J5 5/6/7

The D16nano drives a MAX98357A from `0xF00A0` (BCLK/LRCLK/DIN on FPGA 25/26/27,
J5 pins 5/6/7). The rate is fixed at 21.09375 kHz (6.75 MHz / 10 / 32) and the
128-sample FIFO runs in hardware; the CPU only pushes samples.

| word | effect |
|---|---|
| `sfx! ( s -- )` | push one signed 16-bit sample |
| `sfx-level ( -- n )` | samples queued (0..128) |
| `sfx-status ( -- n )` | b0 empty, b1 full, b2 low, b3 underrun, b4 running, b5 irq |
| `sfx-ctl! ( c -- )` | b0 enable, b1 reset, b2 loop, b3 irq enable |
| `sfx-on` / `sfx-off` | enable / stop |
| `sfx-reset` | clear pointers, level and flags |
| `sfx-loop` | enable + loop: repeat the 128-sample buffer |
| `beep` | fill 128 samples with a 164.8 Hz square and loop it |
| `sound` | print the level and status |

```text
beep        \ a low square tone until sfx-off
sound       \ I2S level 128  status 0
sfx-off
```

The FIFO is one BSRAM slice; the low-water mark is fixed at 32 and the
FIFO-low IRQ is an output for the SIC (bit 2, not wired yet). A slice of type
`0x0A` (μ-law) or `0x05` (PCM) is 4,080 or 2,040 samples; the loader copies it
into the sound window `0xE0000` and `sfx!` streams it.

## Interrupts: the SIC and the 15 kHz timer

The SIC at `0xF00B0` has one IRQ vector (`0x0001`), a 4-bit sticky pending
register and an enable mask. The kernel's handler at `0x51A0` runs in the
shadow bank with interrupts disabled; it services raster before timer, clears
the serviced bit and returns with `RETI`, so the interrupted instruction
re-runs. The timer and raster sources are wired; audio and keyboard are
reserved bits.

| word | effect |
|---|---|
| `irq-on` | enable the 15 kHz timer source |
| `raster-line! ( n -- )` | control 7: scan line 0..359 |
| `raster-on` / `raster-off` | enable / disable raster source bit 3 |
| `irq-off` | disable every source |
| `irq-clear ( mask -- )` | write-1-to-clear pending bits |
| `ticks ( -- n )` | timer interrupts the handler has serviced |
| `raster-ticks ( -- n )` | raster interrupts the handler has serviced |
| `irq? ( -- f )` | true while an enabled source is pending |

Bits: **3 raster, 2 audio, 1 timer, 0 keyboard**. Priority is high to low in
that order; one handler reads `PENDING` and dispatches. `ticks` is the SIC
SCRATCH counter (`0xF00B6`), so it needs no kernel variable.

```text
irq-on
1 2 + . cr          \ the console keeps working with the timer running
ticks . cr          \ serviced IRQs so far
irq-off

200 raster-line!    \ fire once per frame at source line 200
raster-on
raster-ticks . cr   \ climbs once per frame during normal-mode code
raster-off
```

`ticks` is the number of IRQs the handler has serviced, not a free-running
timer. The console spends most of its time inside the BIOS keyboard SWI with
`PSW.I=0`, and the IRQ entry only runs in the normal bank, so a pending tick
coalesces into one while you type. A busy loop shows the real rate:

```text
: spin 20000 0 do loop ;
: now ( -- n ) 0x22 es@ ;
: rate ( -- )
  ticks >r  now >r  spin  now r> -  ticks r> -
  swap . ." ms, " . ." ticks" cr ;
irq-on rate irq-off
```

The **delta** should be about 15 times the millisecond figure. Reading
`ticks` without subtracting its starting value includes the console time
before the loop, which looks like a few percent extra. Flappy is
unaffected: it runs inside the `gfx` SWI with `I=0`, so the timer IRQ is off
for the whole game.
