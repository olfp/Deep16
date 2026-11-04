# LUAPARITY — LILA gaps relative to Lua 5.4

Status: working note, 4 Nov 2026.

LILA now has three-cell tagged values, mixed-tag tables, dynamically retyped
variables, and growable tables. Relative to Lua 5.4 it is still a small core
language. This note records the remaining language, library, and runtime gaps.

Companions: `lila/README.md` (current LILA semantics), `TYPEPLAN.md` (tagged
value ABI), `lila/compiler.fs`, `lila/hash.fs`, and `lila/gc.fs`.

## 1. Core language semantics

- **No lexical scoping or `local`.** All variables except parameters are global.
  There are no block-scoped locals, shadowing, or upvalues.
- **No closures or function values.** Functions are top-level named
  definitions, not first-class values. No lambdas, no closures, and no
  function-valued variables.
- **No recursion or reentrancy.** Parameters live in one global slot per
  function, so recursive and mutually recursive calls are unsupported.
- **No multiple returns or varargs.** No `return a, b`, no `...`, and no
  `select`.
- **No multiple assignment.** No `a, b = b, a`.
- **Different assignment/equality syntax.** LILA uses `=` for both assignment
  and equality; Lua uses `=` for assignment and `==` for equality.
- **No `and`, `or`, or `not`.** No short-circuit boolean operators.
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
- **No metatables or metamethods.** No `__index`, `__newindex`, `__add`,
  `__tostring`, inheritance, or operator overloading.
- **No weak tables or finalizers.**
- **Nested assignment remains unsupported.** `t["a"]["b"] = 1` must be written
  through an inner table variable.

## 3. Strings

- **No escape sequences** and no quotes inside literals.
- **No long strings** (`[[...]]`) or long comments.
- **No `..` concatenation operator**; LILA uses `+`.
- **No string library:** no `sub`, `byte`, `char`, `format`, `find`, `match`,
  `gmatch`, `gsub`, `rep`, `upper`, `lower`, or `reverse`.
- **No Lua patterns.**
- **No number/string coercion** in arithmetic or concatenation.
- **`print` is not Lua-like.** LILA prints values back-to-back without Lua's
  tab separators and trailing newline.

## 4. Numbers

- **32-bit signed integers only.** No 64-bit integers and no floats; the float
  tag is reserved but unimplemented.
- **No `math` library.**
- **No `%`, `^`, floor division `//`, or bitwise operators.**
- **No `tonumber`, `tostring`, `math.type`, integer/float distinction, `NaN`,
  or infinities.**
- **Overflow and division edge cases are not Lua-compatible.**

## 5. Errors and runtime facilities

- **No `error`, `assert`, `pcall`, or `xpcall`.**
- Runtime tag errors abort the program rather than producing an error value.
- **No stack traces or traceback API.**
- **No `collectgarbage`.**
- **No coroutines:** no `coroutine.create`, `resume`, `yield`, `wrap`, or
  `status`.
- **No modules or packages:** no `require`, `package`, `_ENV`, or environments.
- **No `io`, `os`, `debug`, `utf8`, or `coroutine` libraries.**
- **No `type`, `tostring`, `tonumber`, `rawget`, `rawset`, `rawequal`,
  `setmetatable`, `getmetatable`, `next`, or `select`.**

## 6. Implementation-level differences

- LILA compiles to Forth, not Lua bytecode.
- The collector is a simple conservative mark-sweep, without Lua's
  generational or incremental behavior.
- There is no standard-library boundary yet; most Lua programs depend heavily
  on it.
- The target is Deep16 with 16-bit cells, so 64-bit integers and floats require
  more than a small change.

## 7. Highest-value next steps toward Lua parity

1. **Locals and lexical scope**, then **first-class functions and closures**.
2. **Full table keys and sequence support**, plus `pairs`/`ipairs` and basic
   `table` functions.
3. **Boolean/logical operators** and a Lua-like operator set.
4. **Multiple returns and varargs.**
5. **Minimal standard library:** `type`, `tostring`, `tonumber`, `assert`,
   `error`, `pcall`, string basics, and `math` basics.
6. **Metatables** once the value and table models are stable.

## 8. Out of scope for the tagged-value pass

The three-cell tagged-value implementation is complete for the host
prototype. `TYPEPLAN.md` coverage includes three-cell values, mixed tables,
dynamically retyped variables, nil semantics, booleans, and tables beyond the
old 64-key limit. Lua parity work is a separate, much larger effort.
