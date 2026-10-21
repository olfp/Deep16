# LILA host prototype

LILA is a small Lua-like language compiled to Forth and run on the gforth
compatibility layer.

## Run

```sh
gforth lila/test.fs
```

or from gforth:

```forth
include lila/lila.fs
s" x = 5" lila-eval
s" print(x + 1)" lila-eval
```

## Supported syntax

Assignments, infix arithmetic, comparison, `print`, and single-line
`if`/`while` statements:

```lisp
x = 5
y = x * 2 + 1
print(y)

if x > 0 then y = 1 else y = 0 end
while x < 10 do x = x + 1 end
```

A body may contain several statements separated by `;`:

```lisp
if x > 0 then y = 1 ; z = y + 1 end
```

Expressions support `+ - * /`, comparisons `< > =`, parentheses are not yet
supported.  LILA variables are prefixed in Forth as `lila-var-<name>`.

## Limitations

- Each `lila-eval` call handles one statement or one single-line control block.
- Nested control flow is not compiled yet.
- Only `if`/`while`; no `for`, functions, tables, or strings in expressions.
- Variables are global.
