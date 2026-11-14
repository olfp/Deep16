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
| 5 | float | reserved | reserved |
| 6 | function | closure pointer | 0 |
| 7 | multi | payload pointer | 0 |

Numbers are signed 32-bit two's-complement values split across the two payload
cells. Strings are `c-addr u` descriptors allocated by the garbage collector.
Tables are pointers. The float tag is reserved for future use. A function value
points at a GC-managed closure that records the code entry point and the
lexical frame in which the function was created. A multi value (tag 7) is an
internal GC-managed list of values used for multiple returns and varargs.

Because every value carries its tag, variables and table slots are dynamically
typed. One variable or table slot can hold a number, then a string, then a
table, then nil.

## Supported syntax

Assignments, infix arithmetic, comparison and logical operators, string
concatenation, `print`, `if`/`elseif`/`while`, numeric `for` loops, generic
`for ... in` loops, `repeat ... until`, standalone `do ... end` blocks,
`break`, functions, tables, strings, multiple returns, varargs, and multiple
assignment. Blocks may span lines or stay on one line:

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
`for i = start, end, step`. Steps may be negative. The loop variable is a local
to the loop, so assigning to it inside the body changes the next iteration, and
the name is not visible after the loop.

A generic `for` iterates with an iterator function:

```lisp
for k, v in pairs(t) do
  print(k, v)
end

for i, v in ipairs(sequence) do
  print(i, v)
end
```

The expressions after `in` are evaluated once and adjusted to the iterator
triple `f, state, control`. Each iteration calls `f(state, control)` and stops
when the first result is `nil`; the loop variables receive the call's results.
The iterator variables are local to the loop.

`repeat ... until condition` always runs its body at least once and repeats
while the condition is falsey. `break` leaves the loop immediately. A
standalone `do ... end` block adds a scope without any other effect:

```lisp
repeat
  x = x + 1
until x >= 3

do
  local temporary = 1
end
```

## Truthiness and printing

- nil and boolean false are false.
- Every number, including zero, is true.
- Strings and tables are true, including the empty string.
- `if`/`elseif`/`while` accept any value and apply these rules.
- Comparisons produce boolean-tagged values.
- `print` writes numbers, strings, `true`/`false`, `nil`, and `<table>` for a
  table. A table with a `__tostring` metamethod is printed using its result.
  `print` accepts multiple comma-separated expressions and prints each
  value back-to-back. If an expression produces multiple values, all of them are
  printed.

## Operators

Operators, from highest to lowest precedence:

| Operators | Meaning |
|---|---|
| `not`, unary `-`, `#` | logical negation, numeric negation, length |
| `^` | integer power (right-associative) |
| `*` `/` `%` `//` | multiply, divide, modulo, floor division |
| `+` `-` | add/subtract numbers, concatenate strings |
| `<` `>` `<=` `>=` | ordering (numbers and strings) |
| `=` `==` `~=` | equality, equality, inequality |
| `and` | short-circuit logical and |
| `or` | short-circuit logical or |

`and` and `or` short-circuit and return one of their operands. `a and b`
evaluates to `a` when `a` is falsey and to `b` otherwise; `a or b` evaluates to
`a` when `a` is truthy and to `b` otherwise. The unused operand is not
evaluated, so `false and 1 / 0` is `false` and `true or 1 / 0` is `true`.
`not` always produces a boolean. Logical operators use the truthiness rules
above, so zero is truthy.

`==`, `~=`, `<=`, and `>=` are available alongside the original `=`, `<`, and
`>`; `=` still works as equality as well as assignment. `%` and `//` use
floor semantics: the quotient rounds toward negative infinity and the remainder
has the sign of the divisor (`-7 // 2` is `-4`, `-7 % 2` is `1`). `^` requires
a non-negative integer exponent.

## Multiple returns and varargs

A function can return multiple values, and callers can receive them with
multiple assignment:

```lisp
function pair()
  return 1, 2
end
a, b = pair()         -- a=1, b=2
c = pair()            -- c=1 (first value)
a, b = b, a           -- swap
local x, y = pair()   -- local multi assignment
t["a"], b = pair()    -- table/index targets may be mixed with identifiers
```

The final expression of a value list keeps all of its values; earlier
expressions are adjusted to one value. Thus `a, b, c = pair(), pair()` assigns
`1, 1, 2`:

```lisp
m1, m2, m3 = pair(), pair()
print(m1, m2, m3)     -- 1 1 2
```

When assignment targets are indexed places, every target's table and key
expressions are evaluated before any store. Therefore
`i, t[i] = 2, 3` uses the old `i` for `t[i]` and does not depend on the order
in which the stores run.

`return f()` forwards all values returned by `f`. In a single-value context (an
ordinary assignment, an argument, or most expressions) a call or multi value is
adjusted to its first value (or nil if empty).

A vararg function declares `...` in its parameter list. Extra arguments are
kept as the call's varargs, and `...` reads them:

```lisp
function sum(...)
  local total = 0
  local i = 1
  local n = select("#", ...)
  while i <= n do
    total = total + select(i, ...)
    i = i + 1
  end
  return total
end
print(sum(1, 2, 3))   -- 6
```

`select("#", ...)` returns the number of varargs. `select(n, ...)` returns the
nth vararg (1-based); a negative index counts from the end, and an index of
zero or an out-of-range negative index raises `"lila: index out of range"`. A
positive index past the end yields nil. `select` accepts explicit trailing
arguments as well as `...`, and a trailing call keeps all of its results:
`select(2, f())`. `...` may be returned (`return ...`) or forwarded in a
sole-argument call (`f(...)`) to pass all varargs through.

## Locals and lexical scope

A `local` declaration introduces a block-scoped variable. Locals shadow globals
and outer locals, and disappear at the end of the enclosing block:

```lisp
x = 1
local x = 2
print(x)              -- 2
if true then
  local x = 3
  print(x)            -- 3
end
print(x)              -- 2
```

`local x = expr` evaluates the right-hand side before `x` becomes visible, so
`local x = x + 1` reads the outer `x`. Writing `local x` without a value
initializes it to nil. Each call has its own frame, so locals and parameters
are re-entrant and support recursion.

A nested function captures the locals and parameters of its enclosing function
as upvalues. The captured frame stays alive after the enclosing call returns:

```lisp
function makecounter(start)
  local n = start
  local function step()
    n = n + 1
    return n
  end
  return step
end

c = makecounter(0)
print(c())            -- 1
print(c())            -- 2
```

## Functions

Functions are first-class values. `function name(...)` defines a global,
`local function name(...)` defines a local, and assigning a `function(...)
... end` literal stores an anonymous function:

```lisp
function sumto(n)
  acc = 0
  for k = 1, n do
    acc = acc + k
  end
  return acc
end

print(sumto(4))

local function fact(n)
  if n < 2 then
    return 1
  end
  return n * fact(n - 1)
end

print(fact(5))        -- 120

function makeadder(a)
  local add = function(b) return a + b end
  return add
end

add10 = makeadder(10)
print(add10(5))       -- 15
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

Parameters are locals of the call: the compiler assigns them frame slots.
Assigning to a parameter updates this call's copy, not the caller's value.
Other names assigned in a function are ordinary global LILA variables unless
declared `local`. Parameters are separated by commas, and the call parenthesis
must follow the function name directly (`sumto(4)`, not `sumto (4)`).
Zero-argument calls are written `f()`.

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

A function value may be stored in a variable, passed as an argument, returned
from another function, and compared with `=` (identity of the closure):

```lisp
function twice(v) return v * 2 end
function apply(fn, v) return fn(v) end

print(apply(twice, 21))        -- 42
same = twice = twice
other = twice = apply
print(same)                    -- true
print(other)                   -- false
```

A top-level call may appear before the called function's definition in the
source, because top-level function definitions are compiled before the main
program runs. Function names are resolved when the body runs, so recursion and
mutual recursion work; a function defined later is available once its
definition has executed.

## Tables

Tables are created with `{}`. A key may be any value except `nil`: strings,
numbers, booleans, tables, and functions all work. String keys are written with
brackets:

```lisp
scores = {}
scores["alice"] = 10
scores["bob"] = 7
print(scores["alice"] + scores["bob"])   -- 17
```

Numeric and boolean keys use the same syntax:

```lisp
t = {}
t[1] = 10
t[2] = 20
t[true] = "yes"
print(t[1])                    -- 10
print(t[true])                 -- yes
```

Tables and functions compare and hash by identity, so a table or function can
be used as a key as well.

Reading a missing key yields `nil`:

```lisp
scores = {}
print(scores["missing"])       -- nil
print(length(scores["missing"])) -- 0
```

String keys may be any string expression, such as a literal, a string
variable, or a concatenation. Values may carry any tag, and different slots in
the same table may hold different types:

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

### Sequences and `#`

A sequence is a table with values at `1, 2, 3, ...`. The unary `#` operator
returns the border: the largest `n` such that every index from 1 through `n`
has a non-nil value. A table with only string keys has border 0, and `#s`
returns the length of a string.

```lisp
t = {}
t[1] = 10
t[2] = 20
t[3] = 30
print(#t)                      -- 3
print(#"hello")                -- 5
t[2] = nil
print(#t)                      -- 1
```

Assigning `nil` to an existing key deletes that entry, matching Lua. The
sequence operations (`#`, `next`, `pairs`, `ipairs`, and the `table` functions)
therefore see the key as absent. Lua leaves `#` unspecified for tables with
holes; LILA stops at the first hole.

### Iteration

`next(t, key)` returns the next key/value pair, or `nil` when the iteration is
finished. A `nil` key starts at the beginning. `pairs(t)` returns `next, t,
nil`, and `ipairs(t)` returns an integer iterator, `t, 0`. They are normally
used with a generic `for ... in` loop, or through the ordinary call and
multiple-assignment syntax:

```lisp
t = {}
t["a"] = 1
t["b"] = 2

for k, v in pairs(t) do
  print(k, v)
end

k, v = next(t, nil)
print(k)                       -- a or b
print(v)                       -- 1 or 2

f, state, control = pairs(t)
key, value = f(state, control)
while key ~= nil do
  print(key)
  key, value = f(state, key)
end
```

`ipairs` visits indices `1, 2, ...` and stops at the first missing or `nil`
value.

### Table library

The dotted globals `table.insert`, `table.remove`, and the rest provide the
common sequence helpers. They operate on the raw table and do not consult
metamethods.

| Function | Result |
|---|---|
| `table.insert(t, v)` | appends `v` at the border |
| `table.insert(t, pos, v)` | inserts `v`, shifting later elements right |
| `table.remove(t [, pos])` | removes and returns the last element, or the one at `pos` |
| `table.concat(t [, sep, i, j])` | joins string/number elements, default separator `""` |
| `table.unpack(t [, i, j])` | returns the elements from `i` through `j` |
| `table.pack(...)` | an array of the arguments, plus `n` |
| `table.sort(t [, comp])` | sorts the border in place, optionally with a comparator |

```lisp
t = {}
table.insert(t, "a")
table.insert(t, "c")
table.insert(t, 2, "b")
print(table.concat(t, "-"))    -- a-b-c
print(table.remove(t))         -- c
print(#t)                      -- 2

packed = table.pack("x", "y")
print(packed["n"])             -- 2
print(packed[1])               -- x

numbers = {}
numbers[1] = 3
numbers[2] = 1
numbers[3] = 2
table.sort(numbers)
print(numbers[1])              -- 1
```

`table.concat` accepts strings and numbers; any other value raises an error.
`table.sort` uses the default ordering when no comparator is given and calls
`comp(a, b)` otherwise. Passing a position outside the sequence to
`table.insert` or `table.remove` raises an error.

## Metatables

A table may carry a metatable. Metatables control missing-key lookup, stores,
operators, and conversion to string. `setmetatable(t, mt)` returns `t`,
`getmetatable(t)` returns the metatable or `nil`, and `setmetatable(t, nil)`
removes it. Only tables can have metatables, and a metatable must be a table or
`nil`.

```lisp
base = {}
base["x"] = 7
m = {}
m["__index"] = base
t = {}
setmetatable(t, m)
print(t["x"])                  -- 7
print(t["absent"])             -- nil
```

`__index` may also be a function, which receives the table and the key:

```lisp
function lookup(t, key) return "missing:" + key end
m = {}
m["__index"] = lookup
t = {}
setmetatable(t, m)
print(t["name"])               -- missing:name
```

`__newindex` controls stores of keys that are not already present. A table
value receives the store through its own indexing, and a function is called as
`(t, key, value)`. Storing to an existing key always writes the table directly:

```lisp
function note(t, key, value) seen = key end
m = {}
m["__newindex"] = note
t = {}
setmetatable(t, m)
t["a"] = 1                     -- calls note; does not create the key
print(seen)                    -- a
print(rawget(t, "a"))          -- nil
rawset(t, "a", 2)
print(t["a"])                  -- 2
```

The arithmetic metamethods are `__add`, `__sub`, `__mul`, `__div`, `__idiv`,
`__mod`, `__pow`, and `__unm`, and the comparison metamethods are `__eq`,
`__lt`, and `__le`. LILA looks up the left operand's metatable first, then the
right operand's. `>` and `>=` use `__lt` and `__le` with the operands swapped,
and comparison results are converted to booleans.

```lisp
function add(a, b) return 42 end
m = {}
m["__add"] = add
t = {}
setmetatable(t, m)
print(t + 1)                   -- 42
print(1 + t)                   -- 42
```

`__tostring` is used by `print` and `tostring`, and must return a string. The
raw operations `rawget`, `rawset`, and `rawequal` bypass all metamethods.

Metamethod lookup is limited to table operands; the built-in numeric and string
operations still take priority. Not implemented: `__call`, `__len`,
`__metatable`, `__gc`, weak tables, and finalizers.

## Variables and strings

Variables are global unless declared `local`; function parameters are locals.
A variable may change tag between assignments:

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
unary minus, `#`, function calls, string concatenation with `+`, and
`length(s)`.
LILA variables are prefixed in Forth as `lila-var-<name>` and are three-cell
tagged values accessible with `lila-value@` and `lila-value!`.

## Standard library

The basic library functions are native closures installed as globals, so they
are ordinary first-class values. A builtin may be stored, passed to another
function, returned, and called through a variable:

```lisp
f = string.sub
print(f("abcdef", 2, 4))       -- bcd
print(type(string.sub))        -- function
```

The global functions are:

| Function | Result |
|---|---|
| `type(v)` | `"nil"`, `"number"`, `"boolean"`, `"string"`, `"table"`, or `"function"` |
| `tostring(v)` | the value as `print` renders it |
| `tonumber(s)` / `tonumber(s, base)` | a number, or `nil` when `s` is not a numeral |
| `assert(v, message)` | all its arguments when `v` is truthy; raises an error otherwise |
| `error(value)` | raises `value` as an error |
| `pcall(f, ...)` | `true, results...` on success; `false, error` on failure |
| `setmetatable(t, mt)` | sets `t`'s metatable and returns `t` |
| `getmetatable(t)` | the metatable of `t`, or `nil` |
| `rawget(t, k)` | reads `t[k]` without `__index` |
| `rawset(t, k, v)` | writes `t[k]` without `__newindex` and returns `t` |
| `rawequal(a, b)` | equality without `__eq` |
| `next(t [, key])` | the next key/value pair, or `nil` at the end |
| `pairs(t)` | `next, t, nil` for iterating all keys |
| `ipairs(t)` | an iterator, `t, 0` for the sequence part |

`tonumber` trims surrounding spaces, accepts an optional sign, and understands
an optional `0x`/`0X` prefix. An explicit base must be between 2 and 36. A
failed conversion returns `nil` rather than raising:

```lisp
print(tonumber(" 42 "))        -- 42
print(tonumber("-17"))         -- -17
print(tonumber("0x1f"))        -- 31
print(tonumber("ff", 16))      -- 255
print(tonumber("nope"))        -- nil
```

The string functions are `string.len(s)`, `string.sub(s, i [, j])`,
`string.upper(s)`, `string.lower(s)`, `string.rep(s, n)`,
`string.reverse(s)`, `string.byte(s [, i])`, and `string.char(...)`.
Indexes are 1-based; a negative index counts from the end of the string.
`string.sub` returns the empty string for an out-of-range slice,
`string.rep` returns the empty string when `n <= 0`, and `string.byte`
returns `nil` when the index is outside the string. `string.char` builds a
string from byte values 0 through 255. Case conversion is ASCII-only.

```lisp
print(string.sub("abcdef", 2, 4))   -- bcd
print(string.sub("abcdef", -2))     -- ef
print(string.upper("MiXeD"))        -- MIXED
print(string.rep("ab", 3))          -- ababab
print(string.byte("abc", 2))        -- 98
print(string.char(65, 66, 67))      -- ABC
```

The math functions are `math.abs`, `math.max`, `math.min`, `math.floor`,
`math.ceil`, `math.type`, `math.tointeger`, `math.maxinteger`, and
`math.mininteger`. All arithmetic is signed 32-bit integer arithmetic.
`math.floor` and `math.ceil` return their integer argument unchanged,
`math.type` returns `"integer"` for a number and `nil` for other values, and
`math.tointeger` returns the number or `nil`.

```lisp
print(math.abs(-9))            -- 9
print(math.max(3, 9, 4))       -- 9
print(math.min(3, 9, 4))       -- 3
print(math.type(7))            -- integer
print(math.maxinteger)         -- 2147483647
print(math.mininteger)         -- -2147483648
```

## Errors and pcall

A runtime error carries a LILA value. A wrong operation raises a string such as
`"lila: cannot add these values"`, while `error(value)` raises whatever value
it is given. `pcall` catches these errors and returns them as the second
result instead of stopping the program:

```lisp
function add(a, b) return a + b end
ok, value = pcall(add, 2, 3)
print(ok, value)               -- true 5

function bad(v) return v + 1 end
ok, message = pcall(bad, "x")
print(ok, message)             -- false lila: cannot add these values
```

`assert(v, message)` returns its arguments when `v` is truthy and otherwise
raises `message` (or `"assertion failed!"` when no message is supplied). In a
multi-value context it passes its arguments through, so
`a, b = assert(1, 2)` gives `a = 1` and `b = 2`.

An error that is not caught by `pcall` aborts the running chunk. Compile-time
diagnostics still abort immediately and are not catchable.

## Limitations

- `lila-eval` handles one source line. Use `lila-load` for multi-line blocks
  and `elseif` chains.
- `lila-eval` compiles LILA; use gforth directly to define Forth words.
- A single-line function body separates statements with `;`, as other
  single-line blocks do.
- Function parameters and locals are re-entrant: every call gets its own frame,
  so functions may recurse or be called from within another call. Each frame
  is sized to the function's maximum slot use, up to 256 slots including
  parameters; exceeding that raises an error.
- `function name(...)` defines a global, `local function name(...)` defines a
  local, and either may be nested in a multi-line function or block body. A
  single-line block body can contain `local function` but not a plain
  `function` definition. Anonymous `function(...) ... end` literals are
  recognized only as the whole right-hand side of an assignment
  (`f = function...` or `local f = function...`).
- A `local` is visible from the point of declaration to the end of its block.
  The `for` loop variable is local to the loop.
- Calls through a known function name are checked for arity at compile time.
  A call through a function-valued variable is not arity-checked.
- Nested table assignment such as `t["a"]["b"] = 1` is not supported; assign
  through the inner table variable instead.
- `#` walks the sequence from index 1, so its cost grows with the border. It
  does not use `__len`.
- Table constructors are limited to `{}`; there are no `{1, 2, 3}` or
  `{name = "x"}` forms.
- Metatables support the documented subset: `__index`, `__newindex`, the
  arithmetic metamethods, `__eq`, `__lt`, `__le`, and `__tostring`. `__call`,
  `__len`, `__metatable`, `__gc`, weak tables, and finalizers are not
  implemented.
- String literals cannot contain a `"` and there are no escape sequences.
- In a single-line loop body, `break` works as a plain statement, but nested
  single-line control blocks in that same body are not parsed. Use a
  multi-line loop body for conditional breaks.
