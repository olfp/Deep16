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

`lila-load` reads a LILA source file, compiles it to Forth, and executes it.
A single line can also be evaluated interactively, including one-line
`if`/`while`/`for` blocks and function definitions:

```forth
s" x = 5" lila-eval
s" print(x + 1)" lila-eval
```

## Supported syntax

Assignments, infix arithmetic, comparison, `print`, `if`/`elseif`/`while`,
numeric `for` loops, `break`, and functions.  Blocks may span lines or stay
on one line:

```lisp
-- LILA comment
x = 5
y = x * 2 + 1
z = (x + 1) * (x - 2)
n = -(1 + 2)
print(y)

if x = 1 then
  y = 1
elseif x = 2 then
  y = 2
else
  y = 0
end

while x < 10 do
  x = x + 1
  if x = 8 then
    break
  end
end

for i = 1, 3 do
  y = y + i
end

for i = 1, 5, 2 do
  y = y + i
end

if x > 0 then y = 1 else y = 0 end
while x < 10 do x = x + 1 end
for i = 1, 3 do y = y + i end
function twice(v) return v * 2 end
function inc(a) a = a + 1 ; return a end
```

`break` exits the innermost `while` or `for` loop.  Breaking out of a loop
body works from nested `if`/`elseif` blocks as well.

`for` is inclusive and takes an optional step: `for i = start, end` or
`for i = start, end, step`.  Steps may be negative.  The loop variable is a
normal LILA variable, so assigning to it inside the body changes the next
iteration.

Functions are declared with `function name(parameters)` and closed by `end`:

```lisp
function sumto(n)
  acc = 0
  for k = 1, n do
    acc = acc + k
  end
  return acc
end

print(sumto(4))
```

`return expr` may appear anywhere in a function, including inside
`if`/`elseif`, `while`, and `for` blocks; it leaves the function immediately.
A function without `return` acts as a procedure and yields `0`, so a call used
as a statement simply discards that value:

```lisp
function addto(n)
  total = total + n
end
addto(5)
```

Parameters are local to the function: the compiler gives them Forth names such
as `lila-var-sumto-n`.  Assigning to a parameter updates that function's copy.
Other names assigned in a function are ordinary global LILA variables.
Parameters are separated by commas, and the call parenthesis must follow the
function name directly (`sumto(4)`, not `sumto (4)`).  Zero-argument calls are
written `f()`.

A function may be called before its definition in the source, because all
function definitions are compiled before the main program runs.  A function
body may call functions that were defined earlier (or are already loaded), but
not one defined later.

A body may contain several statements separated by `;`:

```lisp
if x > 0 then y = 1 ; z = y + 1 end
```

Blocks nest.  Expressions support `+ - * /`, comparisons `< > =`,
parentheses, unary minus, and function calls.  LILA variables are prefixed in
Forth as `lila-var-<name>`.

## Limitations

- `lila-eval` handles one source line.  Use `lila-load` for multi-line blocks
  and `elseif` chains.
- `lila-eval` compiles LILA; use gforth directly to define Forth words.
- A single-line function body separates statements with `;`, as other
  single-line blocks do.
- Function parameters are not re-entrant: each parameter lives in one global
  slot per function, so functions cannot recurse or call themselves through
  another function.  Function calls must form an acyclic graph.
- Functions must be defined at top level, and a function body may only call a
  function defined earlier (or already loaded).
- No tables or strings yet.
- Variables are global, except function parameters.  A variable must be
  assigned before it is read.
- In a single-line loop body, `break` works as a plain statement, but nested
  single-line control blocks in that same body are not parsed.  Use a
  multi-line loop body for conditional breaks.
