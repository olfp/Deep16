# DeepForth — mini manual

DeepForth is the Forth in `asm/forth.asm`. It boots to a `>` prompt: type a
line, press enter, and each word on it runs. `: name ... ;` starts and ends a
compiled definition; inside one, words are compiled instead of run. A mistake
prints `undefined word: X` or `stack underflow` and the prompt comes back.

```text
: square dup * ;      \ compile a word
5 square .            \ 25  ok
0 7 - 2/ .            \ -4  ok   (there are no negative literals)
```

## Conventions

- Stack effects are written `( before -- after )`, top of stack on the right.
- `n` / `u` — a 16-bit cell, signed / unsigned; `flag` — `-1` (true) or `0`
  (false); `addr` — a cell address; `c` — a character; `--` means nothing.
- **One cell is one address unit** (a 16-bit word): `cells` is the identity and
  `cell+` adds 1. Memory is word-addressed, not byte-addressed.
- Numbers are unsigned decimal (`255`) or hex (`0x10`). A bare `-7` is an
  unknown word: use `0 7 -` or `7 negate`.
- Words marked **imm** run while compiling (`if`, `do`, `;`, …).
- `/`, `mod` and `/mod` are signed and truncate toward zero; the remainder
  takes the sign of the dividend. `2/` is an arithmetic shift and floors.
  Dividing by zero yields `0xFFFF`, and `mod` by zero yields the dividend.

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
| `depth` | `( -- n )` | number of cells on the data stack |

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
| `0<` | `( n -- flag )` | negative |
| `0>` | `( n -- flag )` | positive |

## Memory

| word | stack effect | meaning |
|------|--------------|---------|
| `@` | `( addr -- x )` | fetch the cell at `addr` |
| `!` | `( x addr -- )` | store `x` in the cell at `addr` |
| `c@` | `( addr -- c )` | fetch the low 8 bits of the cell |
| `c!` | `( c addr -- )` | store the low 8 bits of `c` in the cell |
| `+!` | `( n addr -- )` | add `n` to the cell at `addr` |
| `here` | `( -- addr )` | next free dictionary cell |
| `allot` | `( n -- )` | reserve `n` cells at `here` |
| `,` | `( x -- )` | compile `x` at `here` and advance |
| `cells` | `( n -- n )` | cells to address units (the identity) |
| `cell+` | `( addr -- addr+1 )` | address of the next cell |

## Defining words

| word | stack effect | meaning |
|------|--------------|---------|
| `:` | `( -- )` | `: name` begin a definition |
| `;` **imm** | `( -- )` | end the definition and stop compiling |
| `variable` | `( -- )` | `variable name`; `name` pushes its cell address |
| `constant` | `( x -- )` | `constant name`; `name` pushes `x` |
| `value` | `( x -- )` | like `constant`, but changeable with `to` |
| `to` **imm** | `( x -- )` | `to name` stores `x` in a `value`'s cell |
| `create` | `( -- )` | `create name`; `name`'s body starts at `here` |
| `does>` | `( -- )` | attach the following code as a created word's action |
| `immediate` | `( -- )` | mark the most recent definition immediate |
| `state` | `( -- addr )` | address of STATE (`0` interpret, `1` compile) |
| `[` **imm** | `( -- )` | switch to interpret state |
| `]` | `( -- )` | switch to compile state |
| `recurse` **imm** | `( -- )` | compile a call to the definition being built |
| `exit` | `( -- )` | return from the current definition |

```text
: const create , does> @ ;    \ a defining word
42 const answer answer .       \ 42  ok
```

## Control flow

Inside a definition only; all are **imm** except `i`.

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
| `leave` | `( -- )` | leave the innermost loop |
| `i` | `( -- index )` | current loop index |

`do` counts after the increment, so `10 0 do … loop` runs ten times while
`0 0 do … loop` runs 65536 times — use `?do` to skip when the bounds are equal.

## Input, output and screen

| word | stack effect | meaning |
|------|--------------|---------|
| `emit` | `( c -- )` | write character `c` |
| `.` | `( n -- )` | print `n` signed, then a space |
| `u.` | `( u -- )` | print `u` unsigned, then a space |
| `cr` | `( -- )` | carriage return + line feed |
| `key` | `( -- c )` | wait for a key and push its low byte |
| `accept` | `( -- )` | read the next input line into the buffer and interpret it |
| `cls` | `( -- )` | clear the screen and home the cursor |
| `scr@` | `( off -- x )` | read screen cell at ES offset `off` |
| `scr!` | `( x off -- )` | write screen cell at ES offset `off` |
| `echo` | `( flag -- )` | turn keyboard echo on (`-1`) or off (`0`) |
| `echo?` | `( -- flag )` | keyboard echo state |

`accept` is the REPL's own reader, not the standard `( addr n -- n2 )`: it
fills the input buffer and re-enters the interpreter, so it takes nothing and
returns nothing.

## Dictionary and the search order

| word | stack effect | meaning |
|------|--------------|---------|
| `words` | `( -- )` | clear the screen and list the first wordlist |
| `see` | `( -- )` | `see name` print how `name` is built instead of running it |
| `forget` | `( -- )` | `forget name` drops `name` and everything after it |
| `vocabulary` | `( -- )` | `vocabulary name` makes a new wordlist |
| `definitions` | `( -- )` | new definitions go into the first searched wordlist |
| `also` | `( -- )` | duplicate the first search-order entry |
| `previous` | `( -- )` | drop the first search-order entry |
| `only` | `( -- )` | search order is FORTH alone |
| `forth` | `( -- )` | make the FORTH wordlist the first searched |

```text
vocabulary foo  also foo  definitions  \ define into foo
: bar 42 ;
only forth definitions                  \ back to FORTH
```

`see` prints a definition the way it was written: a colon word as `: name … ;`
(with each compiled word named, and a compiled string back as `." … "`), and
anything else as the word that made it — `variable name`, `constant name value`,
`create name does> …`, `vocabulary name`, or `code name` for a primitive. It
walks the thread until the `;` the compiler put there, so an `exit` in the
middle of a body still shows the rest. Two things are not reconstructed:
`if`/`then`/`begin`/`until` appear as `(branch)`/`(0branch)` with the stored
offset, and a word the current search order cannot reach prints as `?<xt>` —
which is also where the listing stops if the thread runs past its own end (a
definition whose `;` never ran).

That is the whole dictionary: 93 words. New words are added at the head of the
current wordlist and found newest-first; `forget` rewinds to a name.
