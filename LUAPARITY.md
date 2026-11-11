# LUAPARITY — LILA gaps relative to Lua 5.4

Status: working note, 11 Nov 2026.

LILA now has three-cell tagged values, mixed-tag tables, dynamically retyped
variables, growable tables, lexical `local` declarations, and first-class
functions with closures. Relative to Lua 5.4 it is still a small core
language. This note records the remaining language, library, and runtime gaps.

Companions: `lila/README.md` (current LILA semantics), `TYPEPLAN.md` (tagged
value ABI), `lila/compiler.fs`, `lila/hash.fs`, `lila/meta.fs`, and `lila/gc.fs`.

## 1. Core language semantics

Lexical scoping, `local`, block shadowing, upvalues, first-class functions,
closures, recursion, mutual recursion, multiple returns, varargs, and multiple
assignment are implemented. The remaining core-language gaps are:

- **Limited local storage.** Each call frame has 96 slots, so a function cannot
  have more than 96 parameters and locals in total.
- **Anonymous functions only in assignment position.** `f = function(...) ... end`
  and `local f = function(...) ... end` work, but a function literal cannot be
  used directly as an argument or return expression.
- **Multiple returns/varargs subset.** `return a, b`, `return f()` (forwarding),
  `return ...`, `...` in vararg functions, `select('#', ...)`, `select(n, ...)`
  (with `...` as the value list), `f(...)` to spread varargs in a sole-argument
  call, and multi-value adjustment (first value in single-value contexts) are
  implemented. Not yet implemented: `select` with explicit trailing arguments,
  `return f(), g()` forwarding beyond the first value, and full Lua adjustment
  in all expression contexts.
- **Multiple assignment subset.** Identifier targets are supported:
  `a, b = f()`, `a, b = b, a`, and `local a, b = f()`. Table/index targets and
  mixed target lists are not yet supported.
- **Different assignment/equality syntax.** LILA uses `=` for both assignment
  and equality; Lua uses `=` for assignment and `==` for equality. LILA also
  accepts `==` and `~=` as equality/inequality aliases.
- **LILA truthiness is not Lua truthiness.** LILA treats numeric zero as
  falsey; Lua treats every number, including zero, as truthy.
- **No `repeat ... until`, `goto`, labels, or generic `for ... in`.**
- **No standalone `do ... end` block.**
- **No `nil`-deletes-key behavior.** LILA stores `nil` as a value; assigning
  `nil` in Lua removes the table entry.

## 2. Tables

- **String keys only.** No numeric, boolean, table, or function keys.
- **No array/sequence part.** No `t[1]`, `#t`, `ipairs`, or sequence
  semantics.
- **No table constructors with contents.** Only `{}`; no `{1, 2, 3}` or
  `{name = "x"}`.
- **No `pairs`, `ipairs`, or `next`.**
- **No `table` library.** No `insert`, `remove`, `sort`, `concat`, `pack`,
  `unpack`, or `move`.
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
  implemented.** `next`/`pairs`/`ipairs` are still missing.

## 6. Implementation-level differences

- LILA compiles to Forth, not Lua bytecode.
- The collector is a simple conservative mark-sweep, without Lua's
  generational or incremental behavior.
- The minimal standard library is implemented as native closures. Most of
  Lua's larger libraries (table, io, os, string patterns) are still absent.
- The target is Deep16 with 16-bit cells, so 64-bit integers and floats require
  more than a small change.

## 7. Highest-value next steps toward Lua parity

1. **Full table keys and sequence support**, plus `pairs`/`ipairs` and basic
   `table` functions.
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

## 8. Out of scope for the tagged-value pass

The three-cell tagged-value implementation is complete for the host
prototype. `TYPEPLAN.md` coverage includes three-cell values, mixed tables,
dynamically retyped variables, nil semantics, booleans, and tables beyond the
old 64-key limit. Lua parity work is a separate, much larger effort.
