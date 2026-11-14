# LUAPARITY — LILA gaps relative to Lua 5.4

Status: working note, 14 Nov 2026.

LILA now has three-cell tagged values, mixed-tag tables, dynamically retyped
variables, growable tables, lexical `local` declarations, and first-class
functions with closures. Relative to Lua 5.4 it is still a small core
language. This note records the remaining language, library, and runtime gaps.

Companions: `lila/README.md` (current LILA semantics), `TYPEPLAN.md` (tagged
value ABI), `lila/compiler.fs`, `lila/hash.fs`, `lila/tablelib.fs`,
`lila/meta.fs`, and `lila/gc.fs`.

## 1. Core language semantics

Lexical scoping, `local`, block shadowing, upvalues, first-class functions,
closures, recursion, mutual recursion, multiple returns, varargs, and multiple
assignment are implemented. The remaining core-language gaps are:

- **Local storage is capped at 256 slots.** Frames are dynamically sized, so a
  function may have any number of parameters and locals up to that limit.
- **Anonymous functions only in assignment position.** `f = function(...) ... end`
  and `local f = function(...) ... end` work, but a function literal cannot be
  used directly as an argument or return expression.
- **Multiple returns/varargs are nearly complete.** `return a, b`,
  `return f()` (forwarding), `return ...`, `...` in vararg functions,
  `select('#', ...)`, `select(n, ...)`, `select` with explicit trailing
  arguments or a trailing call, negative `select` indexes, `f(...)` to spread
  varargs in a sole-argument call, and multi-value adjustment (the final
  expression in a list expands; earlier ones yield one value) are implemented.
  Remaining differences are edge cases in expression contexts rather than the
  core adjustment rule.
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
- **No table constructors with contents.** Only `{}`; no `{1, 2, 3}` or
  `{name = "x"}`.
- **Generic `for ... in` is implemented.** `next`, `pairs`, and `ipairs` drive
  generic `for ... in` loops; the older call/multiple-assignment form still
  works too.
- **Partial `table` library.** `insert`, `remove`, `concat`, `unpack`, `pack`,
  and `sort` are implemented. `move` and the full set of Lua edge-case checks
  are missing.
- **Metatables and metamethods are a documented subset.** `setmetatable`,
  `getmetatable`, `rawget`, `rawset`, `rawequal`, `__index`, `__newindex`,
  `__add`, `__sub`, `__mul`, `__div`, `__idiv`, `__mod`, `__pow`, `__unm`,
  `__eq`, `__lt`, `__le`, and `__tostring` are implemented. Missing are
  `__call`, `__len`, `__metatable`, `__gc`, weak tables, and finalizers.
- **Metamethods apply only to table operands.** There is no string or number
  metatable, and the built-in numeric/string operations take priority.
- **Nested assignment remains unsupported.** `t["a"]["b"] = 1` must be written
  through an inner table variable.

## 3. Strings

- **No escape sequences** and no quotes inside literals.
- **No long strings** (`[[...]]`) or long comments.
- **No `..` concatenation operator**; LILA uses `+`.
- **Partial string library.** `len`, `sub`, `upper`, `lower`, `rep`,
  `reverse`, `byte`, and `char` are implemented. `format`, `find`, `match`,
  `gmatch`, and `gsub` are not.
- **No Lua patterns.**
- **No number/string coercion** in arithmetic or concatenation.
- **`print` is not Lua-like.** LILA prints values back-to-back without Lua's
  tab separators and trailing newline.

## 4. Numbers

- **32-bit signed integers only.** No 64-bit integers and no floats; the float
  tag is reserved but unimplemented.
- **Integer-only `math` library.** `abs`, `max`, `min`, `floor`, `ceil`,
  `type`, `tointeger`, `maxinteger`, and `mininteger` are implemented. Missing:
  `random`, trigonometry, logarithms, and the rest of Lua's `math` table.
- **No bitwise operators.** `%`, `^`, and floor division `//` are implemented
  with 32-bit integer semantics; `^` rejects negative exponents.
- **No integer/float distinction, `NaN`, infinities, or 64-bit integers.**
  `tonumber`, `tostring`, and `math.type` exist but cover 32-bit integers only.
- **Overflow and division edge cases are not Lua-compatible.**

## 5. Errors and runtime facilities

- **`error`, `assert`, and `pcall` are implemented.** There is no `xpcall`.
- Runtime tag errors produce error values and can be caught by `pcall`; an
  uncaught error aborts the running chunk.
- **No stack traces or traceback API.**
- **No `collectgarbage`.**
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
- The minimal standard library is implemented as native closures. Most of
  Lua's larger libraries (table, io, os, string patterns) are still absent.
- The target is Deep16 with 16-bit cells, so 64-bit integers and floats require
  more than a small change.

## 7. Highest-value next steps toward Lua parity

1. ~~**Full table keys and sequence support**, plus `pairs`/`ipairs` and basic
   `table` functions.~~ Done: arbitrary non-nil keys, `#`, `next`/`pairs`/
   `ipairs`, and `table.insert`, `remove`, `concat`, `unpack`, `pack`, `sort`.
2. ~~**Boolean/logical operators** and a Lua-like operator set.~~ Done: `and`,
   `or`, `not`, `==`, `~=`, `<=`, `>=`, `%`, `//`, and `^`.
3. ~~**Multiple returns and varargs.**~~ Done: multi-value returns, varargs,
   `select`, forwarding, and multiple assignment.
4. ~~**Minimal standard library:** `type`, `tostring`, `tonumber`, `assert`,
   `error`, `pcall`, string basics, and `math` basics.~~ Done: native builtins,
   dotted globals, string basics, integer math, and `pcall` error handling.
5. ~~**Metatables** once the value and table models are stable.~~ Done: the
   documented metamethod subset, `rawget`/`rawset`/`rawequal`, and
   `setmetatable`/`getmetatable`.
6. ~~**Lua core-language semantics.**~~ Done: Lua truthiness, `nil` deletes a
   table key, standalone `do ... end`, `repeat ... until`, generic
   `for ... in`, mixed table/index multiple-assignment targets, final-list
   multi-value expansion, full `select` behavior, and dynamically sized
   frames (up to 256 locals).

## 8. Out of scope for the tagged-value pass

The three-cell tagged-value implementation is complete for the host
prototype. `TYPEPLAN.md` coverage includes three-cell values, mixed tables,
dynamically retyped variables, nil semantics, booleans, and tables beyond the
old 64-key limit. Lua parity work is a separate, much larger effort.
