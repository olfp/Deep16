# LUAPARITY — LILA gaps relative to Lua 5.4

Status: current audit, 14 Nov 2026. Checked against the working tree and
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

- **No escape sequences** and no quotes inside literals. `"a\"b"` is a parse
  error.
- **No long strings** (`[[...]]`) or long comments.
- **No `..` concatenation operator**; LILA uses `+`, and only for
  string-with-string or number-with-number operands.
- **Partial string library.** `len`, `sub`, `upper`, `lower`, `rep`,
  `reverse`, `byte`, and `char` are implemented. `format`, `find`, `match`,
  `gmatch`, and `gsub` are not. There are no Lua patterns.
- **No number/string coercion** in arithmetic or concatenation.
  `"n=" + 1` raises `lila: cannot mix different types with +`.
- **`print` is not Lua-like.** It writes each argument directly: strings,
  booleans, `nil`, and tables have no separator between them, while numbers are
  emitted through Forth `.` and carry a trailing space. There are no tab
  separators and no trailing newline. For example, `print("a", "b")` emits
  `ab`, `print(1, 2)` emits `1 2 `, and two separate `print` calls run
  together on one line.
- **Strings are byte strings.** There is no UTF-8 awareness; the `utf8`
  library is absent.

## 4. Numbers

- **32-bit signed integers only.** The range is `-2147483648` through
  `2147483647` (`math.mininteger` and `math.maxinteger`); `2147483648` wraps to
  `-2147483648`. There are no 64-bit integers.
- **No floats.** The float tag is reserved but unimplemented. `1.5` is not
  tokenized as a number and currently evaluates to `nil`;
  `tonumber("1.5")` also returns `nil`.
- **Integer-only `math` library.** `abs`, `max`, `min`, `floor`, `ceil`,
  `type`, `tointeger`, `maxinteger`, and `mininteger` are implemented. Missing:
  `random`, trigonometry, logarithms, and the rest of Lua's `math` table.
- **No bitwise operators.** `&`, `|`, `~`, `<<`, and `>>` are not parsed. `%`,
  `^`, and floor division `//` are implemented with 32-bit integer semantics;
  `^` rejects negative exponents.
- **No integer/float distinction, `NaN`, infinities, or 64-bit integers.**
  `tonumber`, `tostring`, and `math.type` exist but cover 32-bit integers only.
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

## 8. Next steps toward Lua parity

The string work is the clearest self-contained next target. The order below is
dependency-driven, not just a wish list.

### 8.1 Immediate step: `string.find` with plain substrings

Add `string.find(s, needle [, init [, plain]])`, returning the 1-based start
and end indexes of the match, or `nil`. For the first slice, matching is
literal regardless of `plain`; the pattern engine in 8.2 will supply the
`plain=false` behavior. This is the narrowest useful piece because it exercises
the string argument and index helpers and returns a multi-value result without
needing a pattern matcher or a string builder.

Prerequisites and supporting work:

- **`lila-str-index` (shared index primitive).** Normalize a 1-based or
  negative index against a string length, with a way to signal out-of-range.
  `string.sub` and `string.byte` currently duplicate this logic in
  `lila/stdlib.fs`; move it into one helper so `find` uses identical rules.
- **`lila-str-find` (shared search primitive).** Wrap Forth `search`
  (`c-addr1 u1 c-addr2 u2 -- c-addr3 u3 flag`). `search` returns the tail of
  the haystack, so the 0-based match offset is `u1 - u3` and the 1-based start
  index is `u1 - u3 + 1`; the end index is `start + needle-length - 1`. Handle
  the empty needle, no match, and a start index past the end.
- **Argument plumbing.** Use the existing `lila-arg`, `lila-check-str`,
  `lila-32`, and `lila-tag-multi` helpers in `lila/stdlib.fs`, declare a rooted
  `lila-var-string.find`, and install the builtin with `lila-native-set`.
- **No growable builder is required for this step.**
- **Tests:** match at the start, middle, and end; absent needle; empty needle
  (`find("abc", "")` should report `1, 0`); negative `init`; and `init` past
  the end. Accept the `plain` argument now so the signature is stable; until
  the engine lands, both values select literal matching. Run
  `gforth lila/test.fs` and keep `lila/test.lila` runnable.

Files: `lila/stdlib.fs`, `lila/test.fs`, `lila/test.lila`.

### 8.2 Follow-on string work, in dependency order

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
   from 8.1 and a test corpus covering every construct.
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

### 8.3 Other parity gaps, in rough priority order

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
- **Escapes and long strings/comments.** Extend the string lexer with `\n`,
  `\t`, `\\`, `\"`, `\ddd`, and `[[...]]`/`[=[...]=]`. Needed before string
  literals can express most real-world patterns.
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
