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

Assignments, infix arithmetic, string concatenation and comparison, `print`,
`if`/`elseif`/`while`, numeric `for` loops, `break`, functions, tables, and
strings.  Blocks may span lines or stay on one line:

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

A parameter name ending in `$` is a string parameter; every other parameter is
numeric (or a table, which is passed as one cell).  A string parameter is
declared and passed as `c-addr u`, and `return` may return a string:

```lisp
function greet(name$)
  return "hello, " + name$
end

function shout(msg$)
  return msg$ + "!"
end

function exclaim(s$)
  s$ = s$ + "!"
  return s$
end

print(greet("world"))          -- hello, world
print(shout(greet("lila")))    -- hello, lila!
print(exclaim("hey"))          -- hey!
```

Function calls are checked against the parameter types and arity of the
function's signature.  A called function's return type is also known, so a
string-returning call can be printed, concatenated, compared, or assigned to a
string variable.  All `return` statements in one function must return the same
kind of value (all numbers or all strings).  A function with no `return` is a
procedure and yields `0`.

A function may be called before its definition in the source, because all
function definitions are compiled before the main program runs.  A function
body may call functions that were defined earlier (or are already loaded), but
not one defined later.  A string-returning function, or any call that passes a
string argument, must be defined (or loaded) before the call is compiled;
numeric calls may still be forward.

Tables are created with `{}` and use string keys:

```lisp
scores = {}
scores["alice"] = 10
scores["bob"] = 7
print(scores["alice"] + scores["bob"])   -- 17
```

Reading a missing key yields `0`.  Keys may be any string expression, such as
a literal, a string variable, or a concatenation.  A value is a number, another
table, or a string.  A table can be stored in another table and read with
chained brackets (`outer["inner"]["x"]`), but nested assignment is not
supported; assign through the inner table variable instead.

String values are stored as a two-cell `c-addr u` descriptor allocated when the
value is assigned.  A table is either numeric-valued or string-valued, decided
by its first assignment (or by an earlier read), and assigning the other kind
later is an error:

```lisp
names = {}
names["first"] = "alice"
print(names["first"])          -- alice
print(length(names["first"]))  -- 5
names["first"] = names["first"] + "!"
print(names["first"])          -- alice!

scores = {}
scores["alice"] = 10
scores["bob"] = 7
print(scores["alice"] + scores["bob"])   -- 17
```

A table alias copies the value kind, so `copy = names` makes later reads such
as `copy["first"]` string reads.  A function can write a string into a table
passed as a parameter:

```lisp
function put(tbl, s$)
  tbl["value"] = s$
end

t = {}
t["kind"] = "string"     -- mark t as string-valued at the call site
put(t, "bob")
print(t["value"])        -- bob
```

Table value kinds are tracked per variable name, not per runtime table.
Reading a table whose kind is not known yet defaults to a numeric read and
fixes the kind to numeric, so assign a string value first if the table is meant
to hold strings.  Each table also carries a runtime kind, so reading a
string-valued table as a number aborts with `lila: table holds strings`
instead of returning a pointer.  Likewise, the caller must already know that a
table holds strings before passing it to a function that writes string values.

A string variable is written with a string literal:

```lisp
name = "lila"
print(name)              -- lila
scores[name] = 3
print(scores["lila"])    -- 3
```

Strings are `c-addr u` pairs at the Forth level (the compiler stores them in a
two-cell `lila-str-<name>` buffer).  Assigning one string variable to another
copies both cells; the string data itself is immutable.

Strings can be concatenated with `+`, compared with `<`, `>` and `=`, and
measured with `length(s)` (or `len(s)`):

```lisp
name = "lila"
greeting = "hello, " + name
print(greeting)                  -- hello, lila
print(length(greeting))          -- 11
print(greeting = "hello, lila")  -- -1
if name = "lila" then
  print("match")
end
```

`+` requires both operands to be strings or both to be numbers; the comparison
operators likewise compare either two strings or two numbers.  String
comparisons are lexicographic and yield `-1`, `0`, or `1`.  Concatenation
allocates a new buffer and never frees it, so avoid building strings inside
long-running loops.  Strings can be printed, used as table keys, stored as
table values, passed to `$` parameters, and returned from functions.
`length` and `len` are built-ins and cannot be used as function names.  `--`
inside a string literal is part of the string, not a comment.

A body may contain several statements separated by `;`:

```lisp
if x > 0 then y = 1 ; z = y + 1 end
```

Blocks nest.  Expressions support `+ - * /`, comparisons `< > =`,
parentheses, unary minus, function calls, string concatenation with `+`, and
`length(s)`.  LILA variables are prefixed in Forth as `lila-var-<name>`.

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
  function defined earlier (or already loaded).  Numeric calls may be forward,
  but a call that passes a string, and any call to a string-returning function,
  requires the function to be defined before the call.
- All `return` statements in a function must return the same kind of value.
- Tables hold at most 64 keys and are never freed.  Inserting into a full
  table aborts with `lila: table full`.  A table's value kind is fixed by its
  first value assignment; mixing numbers and strings in one table is an error.
  A table passed to a function that writes string values must already be
  string-valued at the call site; if it is not, a later numeric read aborts
  with `lila: table holds strings`.  Reading a string value through a table
  parameter works only after that function has itself stored a string in that
  parameter.
- Nested table assignment such as `t["a"]["b"] = 1` is not supported; assign
  through the inner table variable instead.
- String parameters use a `$` suffix.  A literal cannot contain a `"`, and
  there are no escape sequences.  Concatenation and string table values
  allocate and never free their buffers.  A name assigned a string literal
  stays a string variable; assigning it a number later is not supported.  At
  most 64 string variables are tracked.  Numeric parameters cannot hold
  strings, and string parameters cannot hold numbers.
- Variables are global, except function parameters.  A variable must be
  assigned before it is read.
- In a single-line loop body, `break` works as a plain statement, but nested
  single-line control blocks in that same body are not parsed.  Use a
  multi-line loop body for conditional breaks.
