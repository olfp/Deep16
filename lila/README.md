# LILA host prototype

LILA is a small Lua-like language compiled to Forth and run on the gforth
compatibility layer.

## Run

```sh
gforth lila/test.fs
```

or run a file directly from the shell:

```sh
gforth -e 'include lila/lila.fs s" lila/examples/demo.lila" lila-load bye'
```

From an interactive gforth session:

```forth
include lila/lila.fs
s" lila/examples/demo.lila" lila-load
```

`lila-load` reads a LILA source file, compiles it into one Forth definition,
and executes it.  A single statement can also be evaluated interactively:

```forth
s" x = 5" lila-eval
s" print(x + 1)" lila-eval
```

## Supported syntax

Assignments, infix arithmetic, comparison, `print`, and `if`/`while`.
Blocks may span lines or stay on one line:

```lisp
-- LILA comment
x = 5
y = x * 2 + 1
print(y)

if x > 0 then
  y = 1
  z = y + 1
else
  y = 0
end

while x < 10 do
  x = x + 1
end

if x > 0 then y = 1 else y = 0 end
while x < 10 do x = x + 1 end
```

A body may contain several statements separated by `;`:

```lisp
if x > 0 then y = 1 ; z = y + 1 end
```

Blocks nest.  Expressions support `+ - * /`, comparisons `< > =`;
parentheses are not yet supported.  LILA variables are prefixed in Forth as
`lila-var-<name>`.

## Limitations

- `lila-eval` handles one statement or one single-line block.
- `if`/`while` only; no `for`, functions, tables, or strings in expressions.
- Variables are global.
- A variable must be assigned before it is read.
