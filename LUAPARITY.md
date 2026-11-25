# LUAPARITY — LILA gaps relative to Lua 5.4

Status: current audit, 15 Nov 2026. Checked against the working tree and
`gforth lila/test.fs`.

LILA has three-cell tagged values, mixed-tag tables, dynamically retyped
variables, growable tables, lexical `local` declarations, and first-class
functions with closures. Relative to Lua 5.4 it is still a small core
language. This note records the remaining language, library, and runtime gaps,
and ends with an ordered next-step plan.

Companions: `lila/README.md` (current LILA semantics), `TYPEPLAN.md` (tagged
value ABI), `lila/compiler.fs`, `lila/hash.fs`, `lila/tablelib.fs`,
`lila/stdlib.fs`, `lila/meta.fs`, `lila/gc.fs`, and `FORTH.md` (target string
primitives).

## 1. Core language semantics

Lexical scoping, `local`, block shadowing, upvalues, first-class functions,
closures, recursion, mutual recursion, multiple returns, varargs, standalone
`do ... end`, `repeat ... until`, generic `for ... in`, Lua truthiness, and
multiple assignment are implemented. Multiple assignment supports mixed table
and variable targets and pre-evaluates the target subexpressions. The remaining
core-language gaps are:

- **Local storage is capped at 256 slots.** Frames are dynamically sized, so a
  function may have any number of parameters and locals up to that limit.
- **Function literals are accepted only in assignment/local-initializer
  position.** `f = function(...) ... end` and `local f = function(...) ... end`
  work, but a literal cannot be used as a call argument, a return value, or a
  subexpression.
- **Multi-value expansion is context-limited.** `return f()`, `print(f())`, and
  `a, b = f()` expand a final call. Ordinary call arguments do not: `h(g())`
  fails arity checking when `g` returns two values, and `h(9, g())` passes only
  `g`'s first result. A final call in a vararg argument list likewise supplies
  one value. `select` itself is complete, including `#`, negative indexes, and
  trailing multi-value arguments.
- **Different assignment/equality syntax.** LILA uses `=` for both assignment
  and equality; Lua uses `=` for assignment and `==` for equality. LILA also
  accepts `==` and `~=` as equality/inequality aliases.
- **No `goto` or labels.**

## 2. Tables

- **Arbitrary non-nil keys.** Strings, numbers, booleans, tables, and functions
  are accepted as keys and compared by value or identity as appropriate.
  Storing a `nil` key raises an error, and assigning `nil` to an existing key
  deletes it, matching Lua.
- **Sequences are implemented as ordinary tables.** `t[1]`, the unary `#`
  border operator, and `ipairs` work. There is no separate array part, and `#`
  stops at the first hole rather than providing Lua's arbitrary-hole result.
- **No table constructors with contents.** Only `{}`; `{1, 2, 3}`,
  `{name = "x"}`, and `{...}` are rejected (`lila: comma outside call`).
- **Generic `for ... in` is implemented.** `next`, `pairs`, and `ipairs` drive
  generic `for ... in` loops; the older call/multiple-assignment form still
  works too.
- **Partial `table` library.** `insert`, `remove`, `concat`, `unpack`, `pack`,
  and `sort` are implemented. `table.move` is missing, as are some of Lua's
  edge-case checks.
- **Metatables and metamethods are a documented subset.** `setmetatable`,
  `getmetatable`, `rawget`, `rawset`, `rawequal`, `__index`, `__newindex`,
  `__add`, `__sub`, `__mul`, `__div`, `__idiv`, `__mod`, `__pow`, `__unm`,
  `__eq`, `__lt`, `__le`, and `__tostring` are implemented. Missing are
  `__call`, `__len`, `__metatable`, `__gc`, weak tables, and finalizers.
- **Metamethods apply only to table operands.** There is no string or number
  metatable, and the built-in numeric/string operations take priority.
- **Nested assignment remains unsupported.** `t["a"]["b"] = 1` is rejected;
  assign the inner table to a variable (or use `rawset`) instead. Nested reads
  such as `t["a"]["b"]` do work.

## 3. Strings

- **Escape sequences and `..` concatenation are implemented.** String literals
  support `\a`, `\b`, `\f`, `\n`, `\r`, `\t`, `\v`, `\\`, `\"`, `\'`, one to
  three decimal digits (`\ddd`), exactly two hexadecimal digits (`\xXX`),
  whitespace skipping (`\z`), and UTF-8 codepoints (`\u{...}`). Unknown or
  malformed escapes are compile errors. The two-character `..` operator is
  right-associative and concatenates strings.
- **No long strings** (`[[...]]`) or long comments.
- **Concatenation is stricter than Lua.** `..` accepts two strings only: it
  does not coerce numbers and there is no `__concat` metamethod. Conversely,
  `+` is numeric addition only; table operands may still use `__add`.
- **Partial string library.** `len`, `sub`, `upper`, `lower`, `rep`,
  `reverse`, `byte`, `char`, and plain `find` are implemented. `string.find`
  currently matches literal substrings only but already handles `init`,
  negative indexes, and the empty needle; `format`, `match`, `gmatch`, and
  `gsub` are not implemented, and there are no Lua patterns.
- **No number/string coercion** in arithmetic or concatenation.
  `"n=" .. 1` raises `lila: cannot concatenate these values`, while
  `"n=" + 1` raises `lila: cannot add these values`.
- **`print` is not Lua-like.** It writes each argument directly: strings,
  booleans, `nil`, and tables have no separator between them, while numbers are
  emitted through Forth `.` and carry a trailing space. There are no tab
  separators and no trailing newline. For example, `print("a", "b")` emits
  `ab`, `print(1, 2)` emits `1 2 `, and two separate `print` calls run
  together on one line.
- **Strings are byte strings.** `\u{...}` emits UTF-8 bytes, but there is no
  UTF-8-aware string API and the `utf8` library is absent.

## 4. Numbers

- **32-bit signed integers only.** The range is `-2147483648` through
  `2147483647` (`math.mininteger` and `math.maxinteger`); `2147483648` wraps to
  `-2147483648`. There are no 64-bit integers.
- **The native profile rejects out-of-range literals.** On the device,
  `lila/native/lila-native.fth` accepts literals only in `0 .. 2147483647` and
  reports code `-22` for a larger one instead of wrapping it at parse time.
  Runtime arithmetic still wraps to 32 bits. The host prototype continues to
  wrap the literal.
- **No floats in the host prototype.** The float tag is reserved but
  unimplemented. `1.5` is not tokenized as a number and currently evaluates to
  `nil`; `tonumber("1.5")` also returns `nil`. The native profile on the
  device does have floats: `lila/native/lila-native.fth` reads them as IEEE
  754 singles and implements the Lua 5.4 numeric tower, with the deviations
  listed in `lila/LILANATIVE.md`.
- **Integer-only `math` library.** `abs`, `max`, `min`, `floor`, `ceil`,
  `type`, `tointeger`, `maxinteger`, and `mininteger` are implemented. Missing:
  `random`, trigonometry, logarithms, and the rest of Lua's `math` table.
- **No bitwise operators.** `&`, `|`, `~`, `<<`, and `>>` are not parsed. `%`,
  `^`, and floor division `//` are implemented with 32-bit integer semantics;
  `^` rejects negative exponents.
- **No integer/float distinction, `NaN`, infinities, or 64-bit integers in the
  host prototype.** `tonumber`, `tostring`, and `math.type` exist but cover
  32-bit integers only.
- **Overflow and division edge cases are not Lua-compatible.**

## 5. Errors and runtime facilities

- **`error`, `assert`, and `pcall` are implemented.** There is no `xpcall`.
- Runtime tag errors produce error values and can be caught by `pcall`; an
  uncaught error aborts the running chunk.
- **No stack traces or traceback API.**
- **No `collectgarbage`.** The collector has no public control or statistics
  API.
- **No coroutines:** no `coroutine.create`, `resume`, `yield`, `wrap`, or
  `status`.
- **No modules or packages:** no `require`, `package`, `_ENV`, or environments.
- **No `io`, `os`, `debug`, `utf8`, or `coroutine` libraries.**
- **`rawget`, `rawset`, `rawequal`, `setmetatable`, and `getmetatable` are
  implemented,** along with `next`, `pairs`, `ipairs`, and the basic `table`
  library.

## 6. Implementation-level differences

- LILA compiles to Forth, not Lua bytecode.
- **A second implementation runs on the device.** `lila/native/lila-native.fth`
  compiles a deliberately smaller Lua subset directly to bytecode on Deep16 and
  runs it there. It supports globals, 32-bit integers, single-precision floats,
  strings, `+ - * / // % ^`, relationals, `..`, `print`, `if`, `while` and
  `do`; functions, locals, tables, bitwise operators, `and`/`or`/`not`,
  varargs and the libraries are rejected with negative codes. Its value ABI
  matches `TYPEPLAN.md`; its limits and codes are in
  `lila/native/README.md`.
- The collector is a simple conservative mark-sweep, without Lua's
  generational or incremental behavior.
- The standard library is implemented as native closures installed as dotted
  globals (`string.sub`, `table.insert`, `math.abs`). These namespaces are not
  first-class tables: `type(string)`, `type(table)`, and `type(math)` are all
  `nil`, and `pairs(string)` raises `lila: table expected`. Library tables
  cannot be enumerated, copied, or passed around as Lua allows.
- Only part of Lua's library surface exists: base functions, string basics,
  integer math, and table sequence helpers. There is no `io`, `os`, `debug`,
  `utf8`, `coroutine`, or `package` implementation to expose yet.
- Strings are immutable GC-managed byte slices. `lila-str-concat` is binary
  and allocates a fresh string for every call, so repeated concatenation
  (including `table.concat`) is quadratic in the number of fragments.
- The target is Deep16 with 16-bit cells, so 64-bit integers and floats require
  more than a small change. The current prototype runs under gforth with larger
  cells.

## 7. Change history

Completed work, newest first:

- **Float datatype in the native profile:** `lila/native/lila-native.fth` now
  has Lua 5.4's numeric tower. Integers and floats are distinct types, a
  mixed operation promotes to float, `/` and `^` always give a float, `//` and
  `%` keep the operand type, and an integer compares with a float by value.
  A float is an IEEE 754 single in the three-cell ABI under tag 5, printed
  with the kernel's `f.`. The kernel has to be an FPU image.
- **Native compiler and VM:** `lila/native/lila-native.fth` tokenizes, parses and
  compiles a Lua subset on Deep16, then runs the bytecode on a small VM. Values
  use the three-cell ABI with signed 32-bit number pairs, `(0xFFFF 0 2)`/`(0 0 2)`
  booleans, `(address length 3)` strings and zero-filled globals that read as
  nil. Out-of-range literals are rejected with `-22`; the test checks the
  `lua5.4` output and a depth-0 data stack.
- **String escapes and `..` concatenation:** control-character, quoted-string,
  decimal, hexadecimal, whitespace-skipping, and UTF-8 escapes; a
  right-associative string-only `..` operator; numeric-only `+`; and
  escape-aware source scanners for comments, commas, and delimiters.
- **Plain `string.find`:** literal substring search with 1-based/negative
  `init`, empty-needle handling, and a stable four-argument signature. The
  shared `lila-str-index` normalization now also backs `string.sub` and
  `string.byte`, and `lila-str-find` wraps Forth `search`.
- **Current batch:** Lua truthiness, `nil` deletes a table key, standalone
  `do ... end`, `repeat ... until`, generic `for ... in`, mixed table/index
  multiple-assignment targets with pre-evaluated targets, final-list
  multi-value expansion in `return`/`print`/assignment, full `select` behavior,
  and dynamically sized frames (up to 256 locals).
- Full table keys and sequence support: arbitrary non-nil keys, `#`,
  `next`/`pairs`/`ipairs`, and `table.insert`, `remove`, `concat`, `unpack`,
  `pack`, and `sort`.
- Boolean/logical operators and a Lua-like operator set: `and`, `or`, `not`,
  `==`, `~=`, `<=`, `>=`, `%`, `//`, and `^`.
- Multiple returns and varargs: multi-value returns, varargs, `select`,
  forwarding, and multiple assignment.
- Minimal standard library: `type`, `tostring`, `tonumber`, `assert`, `error`,
  `pcall`, string basics, and integer `math` basics.
- Metatables: the documented metamethod subset, `rawget`/`rawset`/`rawequal`,
  and `setmetatable`/`getmetatable`.

## 8. Remaining next steps toward Lua parity

Plain `string.find` is complete (see §7). The rest of the string work is the
clearest self-contained next target. The order below is dependency-driven, not
just a wish list.

### 8.1 String work, in dependency order

1. **Growable string builder (the second primitive).** A builder that appends
   slices and freezes into one GC string. It is independent of the pattern
   engine, but `gsub` needs it, and `table.concat` should switch to it to lose
   its current quadratic behavior. Prerequisites: `gc-alloc`, a GC-rooted
   builder state (hidden native object or rooted host variables), and a
   freeze/copy-out step that is safe across nested LILA calls.
2. **Lua pattern engine.** Implement the matcher as its own Forth module
   (for example `lila/pattern.fs`): `%` character classes, `.`, `*`, `+`, `-`,
   `?`, `[]`, `^`/`$`, captures `()`, `%b`, `%f`, and backreferences. Expose a
   find-with-captures entry point. Prerequisites: the index/find conventions
   established by plain `string.find` and a test corpus covering every
   construct.
3. **`string.match` and `string.gmatch`.** Thin wrappers over the engine.
   `match` returns captures or the whole match; `gmatch` returns an iterator
   closure holding the subject, pattern, and current position. Prerequisites:
   the pattern engine, closures (already present), and GC-rooted iterator
   state.
4. **`string.gsub`.** Combine the engine and the builder, then add replacement
   dispatch for strings, tables, and functions, plus the match limit and
   `%0`/`%1` expansion. Prerequisites: steps 1–3.
5. **`string.format`.** Independent of `find` and patterns, so it can be done
   in parallel, but it should follow the builder so width/precision padding is
   not quadratic. Prerequisites: a format parser, integer/string conversions,
   and padding/alignment rules.

### 8.2 Other parity gaps, in rough priority order

- **`table.move`.** Copy a range between tables with overlap handling and
  Lua's index checks. Small, isolated, and mostly a `tablelib.fs` change.
- **`xpcall`.** Wrap the protected call in a handler call; requires a protected
  call path that can invoke LILA code during error handling.
- **`collectgarbage`.** Expose the existing collector's collect/count/step
  controls through a builtin. Requires deciding which Lua options LILA will
  honor and what `"count"` means with 16-bit cells.
- **Bitwise operators.** Add `&`, `|`, `~`, `<<`, and `>>` to the lexer,
  precedence table, and tag-aware arithmetic. Straightforward once the
  operator table is extended; needs tests for 32-bit wrap and shift counts.
- **Table constructors with contents.** Parse array and keyed fields,
  including `{...}` and a final multi-value expression. Depends on deciding
  whether constructors expand a final call the way Lua does.
- **Long strings/comments and Lua-compatible concatenation coercion.** Add
  `[[...]]`/`[=[...]=]` and long comments. Separately, decide whether `..`
  should adopt Lua's number-to-string coercion and whether a `__concat`
  metamethod belongs in the supported subset.
- **Nested lvalues.** Compile `t["a"]["b"] = 1` by evaluating the outer table
  once and storing through it. Needs lvalue code generation beyond the current
  single-index form.
- **First-class library tables.** Turn `string`, `table`, `math`, and friends
  into real tables of closures so `type`, `pairs`, `require`-style access, and
  `local s = string` behave like Lua. Depends on table constructors or a native
  table-building path and may change how builtins are installed.
- **Coroutines.** A much larger runtime change: separate stacks or
  continuations, resumable call frames, and `yield` across native builtins.
  Treat as a separate project, not a small parity patch.

## 9. Out of scope for the tagged-value pass

The three-cell tagged-value implementation is complete for the host prototype.
`TYPEPLAN.md` coverage includes three-cell values, mixed tables, dynamically
retyped variables, nil semantics, booleans, and tables beyond the old 64-key
limit. Lua parity work is a separate, much larger effort.
