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

## Values

Every LILA value is three cells. On the Forth stack the order is

```text
value1  value2  tag
```

and in memory the order is

```text
[value1] [value2] [tag]
```

A tag is a whole cell; payloads are never bit-packed. The current tags are:

| Tag | Type | `value1` | `value2` |
|---:|---|---|---|
| 0 | nil | 0 | 0 |
| 1 | number | low half | high half |
| 2 | boolean | 0 or `0xFFFF` | 0 |
| 3 | string | address | length |
| 4 | table | header pointer | 0 |

Numbers are signed 32-bit two's-complement values split across the two payload
cells. Strings are `c-addr u` descriptors allocated by the garbage collector.
Tables are pointers.

Because every value carries its tag, variables and table slots are dynamically
typed. One variable or table slot can hold a number, then a string, then a
table, then nil.

## Supported syntax

Assignments, infix arithmetic, string concatenation and comparison, `print`,
`if`/`elseif`/`while`, numeric `for` loops, `break`, functions, tables, and
strings. Blocks may span lines or stay on one line:

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
t = {}
t["a"] = 1
n = {}
n["name"] = "alice"
print("hi")
print("a" + "b")
print(length("hello"))
function greet(name$)
  return "hello, " + name$
end
print(greet("world"))
```

`break` exits the innermost `while` or `for` loop. Breaking out of a loop
body works from nested `if`/`elseif` blocks as well.

`for` is inclusive and takes an optional step: `for i = start, end` or
`for i = start, end, step`. Steps may be negative. The loop variable is a
normal LILA variable, so assigning to it inside the body changes the next
iteration.

## Truthiness and printing

- nil and boolean false are false.
- Numbers are false only when zero.
- Strings and tables are true, including the empty string.
- `if`/`elseif`/`while` accept any value and apply these rules.
- Comparisons produce boolean-tagged values.
- `print` writes numbers, strings, `true`/`false`, `nil`, and `<table>` for a
  table.

## Functions

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
A function without `return` yields nil, so a call used as a statement simply
discards that value:

```lisp
function addto(n)
  total = total + n
end
addto(5)
```

Parameters are local to the function: the compiler gives them Forth names such
as `lila-var-sumto-n`. Assigning to a parameter updates that function's copy.
Other names assigned in a function are ordinary global LILA variables.
Parameters are separated by commas, and the call parenthesis must follow the
function name directly (`sumto(4)`, not `sumto (4)`). Zero-argument calls are
written `f()`.

Parameters accept any tag. A parameter name ending in `$` is an optional string
constraint at the call site; otherwise parameters are untyped:

```lisp
function greet(name$)
  return "hello, " + name$
end

function identity(v)
  return v
end

print(greet("world"))          -- hello, world
print(identity(42))            -- 42
print(identity("text"))        -- text
```

A function's return tag is dynamic: the same function may return a number,
string, table, boolean or nil on different calls. There is no requirement that
all `return` statements use the same type.

A top-level call may appear before the called function's definition in the
source, because function definitions are compiled before the main program runs.
A function body may call functions that are defined earlier (or already
loaded); a function defined later is not available to an earlier body.

## Tables

Tables are created with `{}` and use string keys:

```lisp
scores = {}
scores["alice"] = 10
scores["bob"] = 7
print(scores["alice"] + scores["bob"])   -- 17
```

Reading a missing key yields `nil`:

```lisp
scores = {}
print(scores["missing"])       -- nil
print(length(scores["missing"])) -- 0
```

Keys may be any string expression, such as a literal, a string variable, or a
concatenation. Values may carry any tag, and different slots in the same table
may hold different types:

```lisp
mixed = {}
mixed["n"] = 1
mixed["s"] = "two"
mixed["b"] = true
mixed["z"] = nil
mixed["t"] = {}
print(mixed["n"])              -- 1
print(mixed["s"])              -- two
print(mixed["t"])              -- <table>
```

A table can be stored in another table and read with chained brackets
(`outer["inner"]["x"]`), but nested assignment is not supported; assign through
the inner table variable instead:

```lisp
outer = {}
inner = {}
outer["inner"] = inner
inner["x"] = 4
print(outer["inner"]["x"])     -- 4
```

Tables grow automatically as needed. There is no fixed 64-key limit. A table
alias copies the table pointer, so both names see the same slots and tags.

A function can write a string into a table passed as a parameter:

```lisp
function put(tbl, s$)
  tbl["value"] = s$
end

t = {}
t["kind"] = "string"
put(t, "bob")
print(t["value"])              -- bob
```

## Variables and strings

Variables are global, except function parameters. A variable may change tag
between assignments:

```lisp
v = 1
print(v)                       -- 1
v = "now a string"
print(v)                       -- now a string
v = true
print(v)                       -- true
v = nil
print(v)                       -- nil
```

A string variable is written with a string literal:

```lisp
name = "lila"
print(name)                    -- lila
scores = {}
scores[name] = 3
print(scores["lila"])          -- 3
```

Assigning one variable to another copies the three-cell value; string data
itself is immutable and GC-managed.

Strings can be concatenated with `+`, compared with `<`, `>` and `=`, and
measured with `length(s)` (or `len(s)`):

```lisp
name = "lila"
greeting = "hello, " + name
print(greeting)                  -- hello, lila
print(length(greeting))          -- 11
print(greeting = "hello, lila")  -- true
if name = "lila" then
  print("match")
end
```

`+` requires both operands to be strings or both to be numbers; mixing them is
a tag error. The comparison operators likewise compare two strings or two
numbers. String comparisons are lexicographic. Comparison results are boolean
values, printed as `true` or `false`. Concatenation allocates a new GC string.
Strings can be printed, used as table keys, stored as table values, passed to
`$` parameters, and returned from functions. `length` and `len` are built-ins
and cannot be used as function names. `--` inside a string literal is part of
the string, not a comment.

A body may contain several statements separated by `;`:

```lisp
if x > 0 then y = 1 ; z = y + 1 end
```

Blocks nest. Expressions support `+ - * /`, comparisons `< > =`, parentheses,
unary minus, function calls, string concatenation with `+`, and `length(s)`.
LILA variables are prefixed in Forth as `lila-var-<name>` and are three-cell
tagged values accessible with `lila-value@` and `lila-value!`.

## Limitations

- `lila-eval` handles one source line. Use `lila-load` for multi-line blocks
  and `elseif` chains.
- `lila-eval` compiles LILA; use gforth directly to define Forth words.
- A single-line function body separates statements with `;`, as other
  single-line blocks do.
- Function parameters are not re-entrant: each parameter lives in one global
  slot per function, so functions cannot recurse or call themselves through
  another function. Function calls must form an acyclic graph.
- Functions must be defined at top level.
- Nested table assignment such as `t["a"]["b"] = 1` is not supported; assign
  through the inner table variable instead.
- String literals cannot contain a `"` and there are no escape sequences.
- In a single-line loop body, `break` works as a plain statement, but nested
  single-line control blocks in that same body are not parsed. Use a
  multi-line loop body for conditional breaks.
