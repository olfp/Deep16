# TYPEPLAN — three-cell tagged values for LILA

Status: **implemented in the host prototype, 4 Nov 2026.** This records the
three-cell tagged-value ABI used by `lila/value.fs`, `lila/hash.fs`,
`lila/gc.fs` and `lila/compiler.fs`. `TYPEPLAN.md` is kept as the design and
migration record; the source and tests are authoritative.

Verification: `gforth lila/test.fs` passes, including three-cell at/! checks,
boolean results, nil for missing keys and no-return functions, mixed-tag
tables, dynamically retyped variables, and tables with 100 keys. The original
`lila/test.lila` program also loads and runs.

Companions: `lila/README.md` (current language semantics), `lila/compiler.fs`
(type stack and code generation), `lila/hash.fs` (table layout), `lila/gc.fs`
(roots and scanning), `FORTH.md` (Deep16 double-cell words), `FLOATIMPL.md`
(the float pair layout) and `D16MINI.md` (stack and memory budget).

## 1. Decision

Every LILA value is **three cells**: one tag cell and two payload cells.

```text
stack, top on the right:   value1  value2  tag
memory, value first:       [value1] [value2] [tag]
```

The tag is part of the value everywhere: on the expression stack, in a
variable, in a parameter slot, in a return slot and in a table slot. There is no
place where a LILA value is only two cells.

The consequences that matter:

* A tag is a whole cell. Nothing is bit-shifted, packed or stolen from the
  payload. Table pointers keep 16 bits, string lengths keep 16 bits and numbers
  keep 32 bits.
* Numbers are double-cell signed integers: `value1` is the low half and
  `value2` the high half, so the high half is on top of the pair, matching the
  Deep16 double-cell convention.
* Strings are the existing `c-addr u` descriptor: `value1` is the address and
  `value2` the length.
* Tables are a single pointer in `value1`; `value2` is always zero.
* Tags are runtime and per-value. This is what allows a table to hold a number
  in one slot and a string in the next, and a variable to change from a number
  to a string to a table.
* Static type information is still useful, but only as an optimization and
  checking layer. It never changes the value ABI: every value, whether its tag
  is known at compile time or not, is still three cells.

Three cells is the smallest uniform representation that can carry a tagged
32-bit number, a tagged string descriptor, a tagged pointer, and a tag that is
available on the stack without side storage. Two cells cannot hold a tagged
32-bit number or a tagged string. Four cells would work but waste a cell for
every value.

## 2. Tag ABI

Reserve small tag numbers. They are ordinary cells, not bit fields, so there is
room to grow without changing the layout.

| Tag | Name | `value1` | `value2` | Notes |
|---:|---|---|---|---|
| 0 | nil | 0 | 0 | missing field, no value |
| 1 | number | low half | high half | signed 32-bit, two's complement |
| 2 | boolean | 0 or `0xFFFF` | 0 | false / true |
| 3 | string | `c-addr` | `u` | immutable bytes, GC-managed |
| 4 | table | header pointer | 0 | GC-managed |
| 5 | float | low word | high word | reserved; high word on top, as `FLOATIMPL.md` |
| 6 | function | xt | 0 | reserved |
| 7… | — | — | — | reserved |

Invariants:

* The tag is the last cell pushed on the stack and the last cell stored in
  memory. A variable's address points at `value1`; the tag is at `addr+2 cells`.
* An unused payload cell is zero. A table is `( ptr 0 table )`, nil is
  `( 0 0 nil )`, and a boolean is `( flag 0 boolean )`. This makes a zero-filled
  three-cell block read as nil.
* A tag cell never stores a payload value and a payload cell never stores a
  tag. Code that wants the payload must use the tag to decide what it means.
* No runtime value is ever "untagged". The compiler may know the tag statically
  and skip a check, but the tag is still emitted and stored.

Stack examples:

```text
42          ->  42 0 1
-1          ->  65535 65535 1
"abc"       ->  c-addr 3 3
t           ->  ptr 0 4
nil         ->  0 0 0
true        ->  65535 0 2
```

### Memory helpers

All storage uses one pair of helpers rather than raw `@`, `!`, `2@` or `2!`.
The names below are the intended ABI; they belong in the LILA runtime, not in
each compiler emitter.

```forth
\ addr points at [value1][value2][tag]
: lila-value@ ( addr -- value1 value2 tag )
  dup 2 cells + @ >r
  dup @ swap cell+ @ r> ;

: lila-value! ( value1 value2 tag addr -- )
  dup >r 2 cells + ! r@ cell+ ! r> ! ;

: lila-value-drop ( value1 value2 tag -- )
  drop drop drop ;

: lila-value-check ( value1 value2 tag want -- value1 value2 tag )
  over <> if s" lila: value tag mismatch" lila-error then drop ;
```

Tag test and dispatch words are ordinary comparisons or `case` statements. No
masking is needed.

## 3. Numeric payload

`value1` is the low 16 bits and `value2` the high 16 bits of a signed 32-bit
two's-complement integer. Putting the high half in `value2` means the pair is
`( low high )`, which is the order Deep16 doubles already use: `d+`, `d-`,
`d<`, `m*`, `sm/rem` and `d.` all take or produce the high half on top.

Literal emission must not use `s>d`. On Deep16 `s>d` sign-extends a single
16-bit cell, which is wrong for every value outside `-32768…32767`. The
compiler already runs on the host, so it can split a literal into two raw cells
and emit them directly:

```text
 100000  ->  34464 1 1
-100000  ->  31072 65534 1
```

Each half is emitted as an unsigned decimal in `0…65535`, which the Deep16
scanner accepts. The high half is not written as a negative number; it is a raw
cell and the 32-bit interpretation supplies the sign.

Deep16 provides `d+`, `d-`, `dnegate`, `d=`, `d0=`, `d<`, `dmax`, `dmin`,
`m*`, `um*`, `sm/rem`, `fm/mod`, `d.` and `d.r`, but not `d*`, `d/`, `d<=`,
`d>=` or `d>`. LILA needs runtime helpers for the missing operations:

* addition/subtraction/negation: `d+`, `d-`, `dnegate`;
* equality/ordering: `d=`, `d<`, with `<=`, `>=` and `>` derived;
* multiplication: `m*`/`um*` only multiply two single cells, so a 32-bit
  multiply is a partial-product routine. The low 32 bits of the product are
  `lo1*lo2 + ((lo1*hi2 + hi1*lo2) << 16)` modulo 2^32; the low half is the
  same for signed and unsigned two's-complement operands;
* division: `sm/rem`, `fm/mod` and `um/mod` divide a 32-bit double by a
  **single-cell** divisor. A 32-bit divisor needs a shift/subtract routine (or
  another software divide); there is no `d/` in the Deep16 word set;
* printing: `d.` for numbers.

The host prototype has 64-bit gforth cells, while the target has 16-bit cells.
The normative value layer must therefore reconstruct a 32-bit value from the
two halves and mask/sign-extend after arithmetic instead of relying on the
host's own `d+` signedness. Otherwise host-only tests will pass values that the
target cannot represent. The interim host layer may use one host cell for a
32-bit intermediate, but the stored ABI remains two 16-bit halves.

Overflow policy is not settled yet. The recommendation is fixed-width
two's-complement wrap, matching the hardware, with division by zero raising a
LILA error rather than returning a sentinel.

## 4. Storage and call ABI

Every LILA variable becomes a three-cell buffer, declared and initialised to
nil. The old split between `variable` (numeric) and `2variable`
(`lila-str-<name>`, string) disappears, and so do the `lila-str-*` buffers and
the `str-vars` registry.

```text
lila-var-x       [value1][value2][tag]
lila-fn-f-p      [value1][value2][tag]
lila-fn-f-val    [value1][value2][tag]   plus a separate one-cell -ret flag
```

Function calls keep the direct Forth call, but the ABI is uniform:

* the caller pushes each argument as three cells, left to right;
* the function wrapper stores each argument into its three-cell parameter slot
  with `lila-value!`;
* an expression call pushes the three-cell return value with `lila-value@`;
* a call used as a statement discards three cells;
* the `-ret` flag stays a single cell; it is control state, not a LILA value.

The uniform ABI removes the reason for the current "a string-returning function
must be defined before its call" rule. Arity still has to be known when the call
is compiled (or checked when a forward-declared function is later defined), but
the return tag no longer has to be known to emit the call. This also means a
function can return a table, nil or a boolean without a new calling convention.

Internal compiler state is not a LILA value and does not become three cells:

* `loop-break-vars` stay one-cell flags;
* table `occupied` flags stay one cell;
* `for` bounds and steps are stored as ordinary three-cell tagged numbers in
  the compiler's `for-end-vars` / `for-step-vars` arrays;
* the `for` loop variable itself is an ordinary three-cell LILA variable.

The main cost is stack pressure. Every intermediate on the data stack is now
three cells, and every local or parameter is three words. `D16MINI.md` puts the
stack window at `0x5800–0x5FFF` with the data stack growing down from `0x5FF0`;
deep expressions and multi-argument calls need measuring after the change.

## 5. Tables

Tables become heterogeneous. The per-table value kind disappears; the tag on
each stored value decides how that slot is read.

Current header and slot:

```text
header: [nbuckets][buckets*][count][value-kind]
slot:   [key-addr][key-len][value][occupied]
```

New header and slot:

```text
header: [nbuckets][buckets*][count]
slot:   [key-addr][key-len][value1][value2][tag][occupied]
```

The slot's value layout mirrors the normal value layout, so `slot-value` can
return an address for `lila-value@`. The slot grows from four
cells to six; a 64-key table grows from 256 to 384 cells, a 50% increase in the
bucket array.

The low-level table operations become:

```text
table-get  ( table key-addr key-len -- value1 value2 tag found )
table-set  ( table key-addr key-len value1 value2 tag -- )
```

A missing key returns `( 0 0 nil false )` at the low level. The language-level
read then yields nil; `length(nil)` is `0`. This replaces both the current "missing key is numeric
zero" rule and the `lila: table holds strings`/`lila: table holds numbers`
aborts. A wrong operation is now a tag error at the point of use: adding a
string, calling `length` on a number, and so on.

Keys remain string `c-addr u` descriptors. They are not three-cell values yet;
that can come later if numeric or table keys are wanted.

Table aliases no longer carry a value kind, because there is no kind to carry.
`copy = names` copies one table pointer; every read through either name uses the
tag stored in the slot. The compiler's `table-reg-names`, `table-reg-types`,
`rhs-alias-type` and the static `table-type-find/set/forget` machinery can go
away once table reads are treated as dynamically tagged.

Table storage is GC-managed exactly as now, but the scanner must mark both
payload cells of every live slot, not just one `slot-value` cell. See §7.

## 6. Compiler impact

The compiler still translates LILA to postfix Forth, and still uses a static
type stack. The stack becomes a **tag-inference stack**: each expression entry
is a known tag or "unknown". Known tags enable fast paths and early errors;
unknown tags emit the generic tag-checking helper. The runtime representation
does not change either way.

### Expression emission

`emit-operand` and related emitters change as follows:

| Source | New emission |
|---|---|
| numeric literal | `low high tag-number` |
| string literal | `c-addr u tag-string` |
| `nil` | `0 0 tag-nil` |
| `true` / `false` | `0xFFFF 0 tag-boolean` / `0 0 tag-boolean` |
| variable | `addr lila-value@` |
| parameter | `addr lila-value@` |
| string parameter/variable | same as any other variable; no `2@` |
| function call | arguments then call word, leaving three cells |
| `length(s)` | value then `lila-length`, which checks the string tag |

The existing special cases for `str-param?`, `string-var?`, `2@`, `@`,
`lila-str-<name>` and `2variable` are removed; parameters and variables use the
same three-cell path. The optional `$` suffix remains a call-site string
constraint.

### Assignment and declaration

`assign-code` becomes one path: compile the right-hand side, then store three
cells with `lila-value!`. There is no string/number split and no
"a numeric parameter cannot hold a string" check; a parameter or variable may
hold any tag.

`lila-store-lhs` declares a three-cell buffer, initialises it to nil and
registers a three-cell GC root. A previously unseen variable is still created
on first assignment, but its storage is three cells rather than one.

`compile-rhs` no longer needs `rhs-table-new` / `rhs-alias-type` bookkeeping for
table kinds. A table literal `{}` produces a table-tagged value; an alias
produces whatever tag the source variable has.

### Operators and conditions

`plus-op`, `cmp-op` and `num-op` become tag-aware:

* when both static tags are known and compatible, emit the fast path
  (`d+`, `dnegate`, `compare`, the existing string concatenation, and so on)
  and push the resulting constant tag;
* when a tag is unknown, emit a generic helper such as `lila-add`, `lila-sub`,
  `lila-mul`, `lila-div`, `lila-lt`, `lila-gt` or `lila-eq`, which checks the
  runtime tags and dispatches;
* when both tags are known and incompatible, keep the compile-time error.

`+` remains string concatenation for two strings and numeric addition for two
numbers. Mixing them is an error, now optionally at runtime when either side is
dynamic.

`lila-compile-if` and `lila-compile-while` stop requiring a numeric condition.
They compile the expression, then call `lila-truthy`, which consumes a
three-cell value and leaves one Forth flag. `lila-compile-for` still requires
numeric bounds and step, but checks the runtime tag when the static tag is
unknown. The loop body and `break` machinery keep their single-cell flags.

### Functions

`declare-param`, `emit-fn-prologue` and `emit-fn-epilogue` use three-cell
parameter and return slots. `compile-return` stores three cells and sets the
one-cell return flag. A function without a return yields nil.

`call-result-type` returns a known tag or unknown. Function signatures can keep
arity and optional tag constraints, but an unannotated parameter must accept
any tag. The `$` suffix can remain as an optional string constraint and a
compatibility spelling; it is no longer needed to make the ABI work. The
early-call machinery can become uniform: all calls now leave three cells, so the
old split between numeric and string forward calls disappears.

### Print and table access

`compile-print-code` always emits `lila-print`, which dispatches on the tag:
`d.` for numbers, `type` for strings, `true`/`false` (or a compatible spelling)
for booleans, `nil` for nil, and a table representation for tables. It no
longer chooses between `type` and `.` at compile time.

`table-assign-code` and `close-index` always emit the generic `table-set` and
`table-get`. A table read has an unknown tag unless the compiler later adds
flow-sensitive inference, which is not part of this decision. The old split
between `lila-table-get-num`, `lila-table-get-str`, `lila-table-set-num` and
`lila-table-set-str` goes away; string extraction becomes "check the tag, then
take `value1` and `value2`".

### Example

```lisp
x = 100000
y = x * 2
print(y)
```

becomes approximately:

```forth
34464 1 1  lila-var-x lila-value!
lila-var-x lila-value@  2 0 1  lila-mul  lila-var-y lila-value!
lila-var-y lila-value@  lila-print
```

With both tags known statically, the middle line can use the 32-bit add and
multiply helpers and a constant tag instead of `lila-mul`; the stored
representation is identical.

## 7. GC and roots

`lila-gc-register-root` already accepts one to three cells, but `gc-mark-roots`
currently marks the second cell only when the root size is two. It must mark
every cell in a root, or at least both payload cells of a three-cell value.
Scanning the tag cell is harmless because a tag is a small integer and cannot
alias a heap address.

`table-gc-scan` must mark the key address and both value payload cells. The
table header itself becomes three cells; the bucket array stays a separate GC
object. String data and table bucket arrays are unchanged.

The collector is conservative, so marking both numeric halves can retain an
object if a number happens to look like a heap address. The current collector
already accepts this for single-cell numeric roots; three cells slightly widen
the window. Exact tag-directed scanning can later skip number payloads, but it
is an optimization, not a correctness requirement.

## 8. Migration stages

Do not land this as one change. Each stage should keep the LILA test program
runnable.

1. **Freeze the ABI.** Add the tag constants, `lila-value@`, `lila-value!`,
   `lila-value-drop`, `lila-value-check` and the 32-bit numeric helpers. Test
   them directly from Forth, including values above `32767`, negative values and
   the `0x8000` sign boundary.
2. **Variables and literals.** Convert declarations, loads, stores and
   assignment to three cells. Update the smoke tests from `lila-var-x @` to
   `lila-var-x lila-value@`.
3. **Expressions, print and conditions.** Add the tag-aware operators,
   `lila-print`, `lila-truthy` and `lila-length`, and update `if`/`while`/`for`.
4. **Functions.** Convert parameters, return slots, prologues, epilogues and
   call statements. Remove the string-only forward-call restriction.
5. **Tables.** Convert the header, slot size, get/set, rehash and GC scan.
   Remove the table value-kind field and the kind checks.
6. **Remove the old static machinery.** Delete `str-vars`, `lila-str-*`,
   `table-reg-*`, `rhs-alias-type` and the split table helpers. Keep static tag
   inference only as an optimization.
7. **Port and measure.** Implement the missing 32-bit helpers on Deep16,
   measure code size and stack use, and update `lila/README.md` and the LILA
   sections of `FORTH.md`/`D16MINI.md` as needed.

## 9. Tests

The current `lila/test.fs` reads variable and table internals directly, so most
of it needs an ABI update rather than a semantic change. Add coverage for:

* **Value layout:** `lila-value@`/`lila-value!` round-trips for every tag;
  zero-filled storage reads as nil; `value2` is zero for tables, booleans and
  nil.
* **Numbers:** `32767`, `32768`, `-32768`, `-32769`, `0x7FFFFFFF`,
  `-0x80000000`, addition/subtraction/negation, product truncation, signed
  division, division by zero, and comparisons across the sign boundary.
  Run the boundary cases on both the host layer and the target.
* **Tags and errors:** string `+` number, `nil + 1`, table arithmetic,
  `length(number)`, a non-string table key, and wrong-tag returns.
* **Heterogeneous tables:** numbers, strings, tables, booleans and nil in one
  table; overwriting one slot with a different tag; missing keys yielding nil;
  table aliases seeing the same tags; GC preserves both payload cells.
* **Dynamic variables:** one variable assigned a number, then a string, then a
  table, then nil; reading and printing after each assignment.
* **Functions:** numeric, string, table, boolean and nil arguments and returns;
  mixed-tag calls; forward calls; call results used as statements; return from
  inside loops and nested blocks.
* **Control flow:** conditions on booleans, numbers and nil; `for` bounds and
  steps outside the 16-bit range; `break` still a one-cell flag.
* **GC:** allocate strings and tables, store them in variables, parameters and
  table slots, force a collection and verify every surviving value.
* **Print:** every tag, including nil and a table, and the chosen boolean
  spelling.

## 10. Rejected alternatives

### 2-bit tags packed into payload bits

Stealing two bits from every cell would cut the usable address space to a
quarter or require masking at every pointer access, truncate the 32-bit numeric
range, and leave no room for full 32-bit floats. It would also need side data or masking
for heterogeneous table slots. The saving is one cell per value; the cost is
that every operation, comparison and GC scan has to unpack a tag. Rejected:
the tag is a whole cell precisely so payloads stay full-width and dispatch stays
simple.

### Storage-only tags

Store the tag in variables and table slots but leave expression temporaries as
two cells. This fails as soon as a value is produced and consumed inside an
expression, passed as an argument or returned from a call: the compiler would
need a parallel tag stack or hidden temporary slots, and every branch would have
to keep that side stack in sync. A value read from a table would lose its tag
exactly where dynamic typing matters most. Rejected: tags must travel with the
value on the stack.

### Two cells: one tag plus one payload

A `(tag, payload)` pair gives only 16 payload bits. Numbers would be 16-bit
again, strings would not fit, and floats would not fit. Rejected because
double-cell numerics are a requirement, not an optional extra.

### Boxed heap values

Allocating a heap object for every number would make arithmetic and stack traffic
far too expensive on Deep16 and would turn every value operation into a GC
concern. Rejected.

### NaN boxing or pointer tagging

These depend on spare bits in a 32-bit or 64-bit cell. Deep16 has 16-bit cells
and uses most of the address space, so there is no safe spare-bit budget.
Rejected.

### Static-only types

The current model, where a table is numeric or string-valued for its whole life
and parameters are declared `$` or numeric. It cannot represent mixed tables or
dynamically retyped variables without a separate boxed representation. Rejected
as the target model; static information is kept only as an optimization layer.

### A parallel tag stack

This is the storage-only failure mode with more bookkeeping: every push, pop,
call, return, branch and GC scan must update two stacks, and a value that moves
through a table or a variable still loses its tag. Rejected.

## 11. Resolved semantics and remaining questions

The representation decisions below are implemented in the host prototype.
Items marked resolved are part of the current language behaviour.

1. **Missing table fields and no-return functions.** Resolved: a missing key is
   nil, distinguishing "absent" from a stored zero, and a function with no
   `return` yields nil.
2. **Truthiness.** Resolved: nil and boolean false are false; numbers are false
   only when zero; strings and tables are true, including the empty string.
3. **Mixed-type operators.** Recommendation: `+` is string concatenation only
   for two strings and arithmetic only for two numbers; every other pairing is
   an error. `=` may return false for different tags, while `<`/`>` should
   reject different tags rather than invent an ordering.
4. **Numeric overflow and division.** Recommendation: wrap to 32 bits, and
   raise a LILA error on division by zero. Decide explicitly whether
   `INT_MIN / -1` wraps or errors.
5. **Static versus dynamic signatures.** Recommendation: parameters are
   untyped by default; `$` remains an optional string constraint and a
   compatibility spelling; return tags are inferred when possible and unknown
   otherwise; arity is still checked. The uniform ABI means the old
   string-returning forward-call restriction can be removed.
6. **Boolean behaviour.** Resolved: comparisons produce boolean-tagged values,
   booleans print as `true`/`false`, and arithmetic on booleans is a tag error.
7. **Equality and identity.** Recommendation: strings compare by content,
   numbers and booleans by value, tables by pointer identity, nil only equal to
   nil. Decide whether cross-tag `=` is false or an error.
8. **Table keys.** Keep string keys for now. Numeric keys, nil keys and table
   keys are a later extension; they do not need a new tag layout.
9. **Records and structs.** Defer a separate record tag. Tables already provide
   named fields, and `t["field"]` can later gain `t.field` sugar without changing
   the three-cell ABI. If records need fixed layout, a distinct tag can be added
   in the reserved range.

## 12. Non-goals

This note does not add packed tags, a boxed object model, a full structural type
system, record syntax, numeric table keys or a new garbage collector. It also
does not change the rule that a table's bucket array is growable and never
freed, or the rule that function parameters are not re-entrant. Those are
separate problems.

The implementation and the updated host test suite live in `lila/`; future
stages are target porting and performance measurement.
