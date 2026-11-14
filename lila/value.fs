\ LILA three-cell tagged values
\ -----------------------------
\ Every LILA value is three cells: [value1][value2][tag] in memory, and
\ ( value1 value2 tag ) on the stack.  The tag is a whole cell; payloads are
\ never bit-packed.  Numbers are signed 32-bit two's-complement pairs with the
\ high half in value2, matching the Deep16 double-cell convention.

0 constant lila-tag-nil
1 constant lila-tag-num
2 constant lila-tag-bool
3 constant lila-tag-str
4 constant lila-tag-table
5 constant lila-tag-float
6 constant lila-tag-fn
7 constant lila-tag-multi
255 constant lila-tag-unknown

\ Defining words for three-cell values and ordinary internal cells.  They do
\ not leave an address on the stack, so they are safe to use from EVALUATE.
: lila-value-allot ( -- )  create 0 , 0 , 0 , ;
: lila-cell-allot  ( -- )  create 0 , ;

\ Memory layout: addr -> value1, addr+cell -> value2, addr+2cells -> tag.
: lila-value@ ( addr -- value1 value2 tag )
  dup 2 cells + @ >r
  dup @ swap cell+ @ r> ;

: lila-value! ( value1 value2 tag addr -- )
  dup >r 2 cells + ! r@ cell+ ! r> ! ;

: lila-value-drop ( value1 value2 tag -- )
  drop drop drop ;

: lila-value-init ( addr -- )
  0 over !
  0 over cell+ !
  0 swap 2 cells + ! ;

\ Runtime errors carry a LILA value.  lila-raise stores it in a GC root and
\ throws a private code so pcall can catch it, leaving the message intact.
\ Compile-time diagnostics still use lila-error, which aborts immediately.
-4096 constant lila-raise-code
create lila-error-value 3 cells allot
lila-error-value 3 lila-gc-register-root

: lila-raise ( value1 value2 tag -- )
  lila-error-value lila-value!
  lila-raise-code throw ;

: lila-raise-msg ( c-addr u -- )
  lila-tag-str lila-raise ;

: lila-error-value@ ( -- value1 value2 tag )
  lila-error-value lila-value@ ;

: lila-value-check ( value1 value2 tag want -- value1 value2 tag )
  over <> if s" lila: value tag mismatch" lila-raise-msg then drop ;

\ ---------------------------------------------------------------------------
\ 32-bit numeric payloads

\ Combine two raw 16-bit cells into a signed 32-bit value in one host cell.
: lila-32 { lo hi -- n }
  hi 65535 and 16 lshift lo 65535 and or
  dup 0x80000000 and if 0x100000000 - then ;

\ Truncate and sign-extend to 32 bits.
: lila-s32 ( n -- n' )
  0xFFFFFFFF and
  dup 0x80000000 and if 0x100000000 - then ;

: lila-32>lo ( n -- lo )  65535 and ;
: lila-32>hi ( n -- hi )  16 rshift 65535 and ;

: lila>value-num ( n -- value1 value2 tag )
  lila-s32 dup lila-32>lo swap lila-32>hi lila-tag-num ;

: lila>value-bool ( flag -- value1 value2 tag )
  if 65535 else 0 then 0 lila-tag-bool ;

: lila-check-num ( tag -- )
  lila-tag-num <> if s" lila: number expected" lila-raise-msg then ;

: lila-check-str ( tag -- )
  lila-tag-str <> if s" lila: string expected" lila-raise-msg then ;

: lila-check-table ( tag -- )
  lila-tag-table <> if s" lila: table expected" lila-raise-msg then ;

: lila-num>32 { value1 value2 tag -- n }
  tag lila-check-num
  value1 value2 lila-32 ;

\ Turn a tagged number into its raw ( low high ) halves.
: lila-to-num { value1 value2 tag -- lo hi }
  tag lila-check-num
  value1 value2 lila-32
  dup lila-32>lo swap lila-32>hi ;

\ Metatable hooks.  value.fs is loaded before hash.fs, so the operators call
\ deferred words that meta.fs replaces once tables and metatables exist.
defer lila-meta-add
defer lila-meta-sub
defer lila-meta-mul
defer lila-meta-div
defer lila-meta-idiv
defer lila-meta-mod
defer lila-meta-pow
defer lila-meta-unm
defer lila-meta-eq
defer lila-meta-lt
defer lila-meta-le
defer lila-meta-tostring

\ hash.fs installs the table border implementation once tables exist.
defer lila-table-length
: lila-table-length-default ( table -- n )  drop 0 ;
' lila-table-length-default is lila-table-length

: lila-meta-binop-default ( a1 a2 ta b1 b2 tb -- )
  lila-value-drop lila-value-drop
  s" lila: operator not supported" lila-raise-msg ;

: lila-meta-unm-default ( a1 a2 ta -- )
  lila-value-drop
  s" lila: operator not supported" lila-raise-msg ;

: lila-meta-eq-default ( a1 a2 ta b1 b2 tb -- r1 r2 tr )
  lila-value-drop lila-value-drop
  false lila>value-bool ;

: lila-meta-tostring-default ( v1 v2 tag -- r1 r2 rt found )
  lila-value-drop
  0 0 0 false ;

' lila-meta-binop-default is lila-meta-add
' lila-meta-binop-default is lila-meta-sub
' lila-meta-binop-default is lila-meta-mul
' lila-meta-binop-default is lila-meta-div
' lila-meta-binop-default is lila-meta-idiv
' lila-meta-binop-default is lila-meta-mod
' lila-meta-binop-default is lila-meta-pow
' lila-meta-unm-default is lila-meta-unm
' lila-meta-eq-default is lila-meta-eq
' lila-meta-binop-default is lila-meta-lt
' lila-meta-binop-default is lila-meta-le
' lila-meta-tostring-default is lila-meta-tostring

\ ---------------------------------------------------------------------------
\ String concatenation (the result is a GC-managed payload)

create lila-str-total 0 ,
: lila-str-concat { a1 u1 a2 u2 -- addr u }
  u1 u2 + 0= if s" " drop 0 exit then
  u1 u2 + dup lila-str-total !
  0 gc-alloc { addr -- }
  a1 addr u1 move
  a2 addr u1 + u2 move
  addr lila-str-total @ ;

\ ---------------------------------------------------------------------------
\ Tag-aware arithmetic

: lila-table-op? { ta tb -- flag }
  ta lila-tag-table = tb lila-tag-table = or ;

: lila-add { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta lila-tag-num = tb lila-tag-num = and if
    a1 a2 lila-32 b1 b2 lila-32 + lila>value-num exit
  then
  ta lila-tag-str = tb lila-tag-str = and if
    a1 a2 b1 b2 lila-str-concat lila-tag-str exit
  then
  ta tb lila-table-op? if a1 a2 ta b1 b2 tb lila-meta-add exit then
  s" lila: cannot add these values" lila-raise-msg ;

: lila-sub { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta tb lila-table-op? if a1 a2 ta b1 b2 tb lila-meta-sub exit then
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 b1 b2 lila-32 - lila>value-num ;

: lila-mul { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta tb lila-table-op? if a1 a2 ta b1 b2 tb lila-meta-mul exit then
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 b1 b2 lila-32 * lila>value-num ;

: lila-div { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta tb lila-table-op? if a1 a2 ta b1 b2 tb lila-meta-div exit then
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 b1 b2 lila-32
  dup 0= if s" lila: division by zero" lila-raise-msg then
  / lila>value-num ;

: lila-neg { a1 a2 ta -- r1 r2 tr }
  ta lila-tag-table = if a1 a2 ta lila-meta-unm exit then
  ta lila-check-num
  a1 a2 lila-32 negate lila>value-num ;

\ Floor division and modulo, matching Lua's integer semantics: the quotient
\ rounds toward negative infinity and the remainder has the sign of the
\ divisor.
: lila-floor-div { a b -- q r }
  b 0= if s" lila: division by zero" lila-raise-msg then
  a b /mod { r q -- }
  r 0<> if
    r b xor 0< if
      q 1- to q
      r b + to r
    then
  then
  q r ;

: lila-idiv { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta tb lila-table-op? if a1 a2 ta b1 b2 tb lila-meta-idiv exit then
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 b1 b2 lila-32 lila-floor-div drop lila>value-num ;

: lila-mod { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta tb lila-table-op? if a1 a2 ta b1 b2 tb lila-meta-mod exit then
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 b1 b2 lila-32 lila-floor-div nip lila>value-num ;

: lila-pow { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta tb lila-table-op? if a1 a2 ta b1 b2 tb lila-meta-pow exit then
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 { base }
  b1 b2 lila-32 { exp }
  exp 0< if s" lila: negative exponent" lila-raise-msg then
  1 { acc }
  begin exp 0> while
    exp 1 and if acc base * to acc then
    base base * to base
    exp 2/ to exp
  repeat
  acc lila>value-num ;

\ ---------------------------------------------------------------------------
\ Tag-aware comparisons.  A comparison result is a boolean value.

: lila-eq { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta tb <> if 0 lila>value-bool exit then
  ta lila-tag-num = if
    a1 a2 lila-32 b1 b2 lila-32 = lila>value-bool exit
  then
  ta lila-tag-str = if
    a1 a2 b1 b2 compare 0= lila>value-bool exit
  then
  ta lila-tag-bool = if
    a1 b1 = lila>value-bool exit
  then
  ta lila-tag-nil = if
    true lila>value-bool exit
  then
  ta lila-tag-table = if
    a1 b1 = if true lila>value-bool exit then
    a1 a2 ta b1 b2 tb lila-meta-eq exit
  then
  ta lila-tag-fn = if
    a1 b1 = lila>value-bool exit
  then
  0 lila>value-bool ;

: lila-ne { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  a1 a2 ta b1 b2 tb lila-eq { r1 r2 tr }
  r1 0= lila>value-bool ;

: lila-lt { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta lila-tag-num = tb lila-tag-num = and if
    a1 a2 lila-32 b1 b2 lila-32 < lila>value-bool exit
  then
  ta lila-tag-str = tb lila-tag-str = and if
    a1 a2 b1 b2 compare 0< lila>value-bool exit
  then
  ta tb lila-table-op? if a1 a2 ta b1 b2 tb lila-meta-lt exit then
  ta tb <> if s" lila: cannot compare different types" lila-raise-msg then
  s" lila: cannot order these values" lila-raise-msg ;

: lila-gt { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  b1 b2 tb a1 a2 ta lila-lt ;

: lila-le { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta lila-tag-num = tb lila-tag-num = and if
    a1 a2 lila-32 b1 b2 lila-32 <= lila>value-bool exit
  then
  ta lila-tag-str = tb lila-tag-str = and if
    a1 a2 b1 b2 compare 0<= lila>value-bool exit
  then
  ta tb lila-table-op? if a1 a2 ta b1 b2 tb lila-meta-le exit then
  ta tb <> if s" lila: cannot compare different types" lila-raise-msg then
  s" lila: cannot order these values" lila-raise-msg ;

: lila-ge { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  b1 b2 tb a1 a2 ta lila-le ;

\ ---------------------------------------------------------------------------
\ Conditions, length and printing

\ Lua truthiness: only nil and boolean false are false.  In particular every
\ number, including zero, is true.
: lila-truthy { value1 value2 tag -- flag }
  tag lila-tag-nil = if false exit then
  tag lila-tag-bool = if value1 0<> exit then
  true ;

: lila-not { value1 value2 tag -- r1 r2 tr }
  value1 value2 tag lila-truthy 0= lila>value-bool ;

: lila-length { value1 value2 tag -- lo hi tnum }
  tag lila-tag-nil = if 0 0 lila-tag-num exit then
  tag lila-tag-table = if value1 lila-table-length lila>value-num exit then
  tag lila-check-str
  value2 lila>value-num ;

\ ---------------------------------------------------------------------------
\ Multiple values and varargs
\
\ A multi value (tag 7) points at a GC payload [count][v1][v2][v3]... .  It is
\ how a function hands back more than one result and how a function keeps its
\ extra arguments.  A multi used where one value is expected is reduced to its
\ first element (or nil when empty) by lila-first.

: lila-multi-alloc { count -- m }
  count 0< if s" lila: bad value count" lila-raise-msg then
  count 3 * 1+ cells 5 gc-alloc
  dup count swap ! ;

: lila-multi-pack { n -- m1 m2 tag }
  n lila-multi-alloc { m }
  n 0 ?do
    n 1- i - 3 * 1+ cells m + lila-value!
  loop
  m 0 lila-tag-multi ;

: lila-multi-ensure { v1 v2 tag -- m1 m2 mt }
  tag lila-tag-multi = if v1 v2 tag exit then
  v1 v2 tag 1 lila-multi-pack ;

: lila-first { v1 v2 tag -- r1 r2 tr }
  tag lila-tag-multi = if
    v1 @ 0= if 0 0 lila-tag-nil else v1 cell+ lila-value@ then
  else
    v1 v2 tag
  then ;

: lila-multi-count { v1 v2 tag -- n }
  tag lila-tag-multi <> if 1 exit then
  v1 @ ;

: lila-multi-get { m1 m2 mt idx -- r1 r2 tr }
  mt lila-tag-multi <> if
    idx 0= if m1 m2 mt else 0 0 lila-tag-nil then exit
  then
  idx 0< idx m1 @ >= or if
    0 0 lila-tag-nil
  else
    idx 3 * 1+ cells m1 + lila-value@
  then ;

\ Multi assignment keeps the right-hand values here between stores.  Collection
\ only happens between statements, but the cells are roots anyway.
create lila-multi-hold-cells 3 cells allot
lila-multi-hold-cells 3 lila-gc-register-root
create lila-multi-stash-cells 3 cells allot
lila-multi-stash-cells 3 lila-gc-register-root

: lila-multi-hold ( v1 v2 tag -- )
  lila-multi-hold-cells lila-value! ;

: lila-multi-stash ( v1 v2 tag -- )
  lila-multi-stash-cells lila-value! ;

: lila-multi-fetch { idx -- v1 v2 tag }
  lila-multi-hold-cells lila-value@
  idx lila-multi-get ;

\ Append the values of B to the value list held in lila-multi-hold-cells.
\ Used for Lua adjustment of the final expression in a list: `return a, f()`.
: lila-multi-chain { b1 b2 bt -- m1 m2 mt }
  b1 b2 bt lila-multi-ensure { c1 c2 ct }
  lila-multi-hold-cells lila-value@ { a1 a2 at }
  a1 a2 at lila-multi-count { na }
  c1 c2 ct lila-multi-count { nb }
  na nb + lila-multi-alloc { m }
  na 0 ?do
    a1 a2 at i lila-multi-get
    m i 3 * 1+ cells + lila-value!
  loop
  nb 0 ?do
    c1 c2 ct i lila-multi-get
    m na i + 3 * 1+ cells + lila-value!
  loop
  m 0 lila-tag-multi ;

\ select(selector, ...).  A string selector must be "#", which yields the
\ number of values; a numeric selector yields the value at that 1-based
\ position, counting from the end when negative.  An index below 1 raises an
\ error, matching Lua.
: lila-select { s1 s2 st m1 m2 mt -- r1 r2 tr }
  st lila-tag-str = if
    s1 s2 s" #" compare 0= if
      m1 @ lila>value-num exit
    then
  then
  st lila-check-num
  m1 @ { nargs -- }
  s1 s2 lila-32 { i -- }
  i 0< if nargs 1+ i + to i
  else i nargs 1+ > if nargs 1+ to i then
  then
  i 1 < if s" lila: index out of range" lila-raise-msg then
  m1 m2 mt i 1- lila-multi-get ;

: lila-print1 { value1 value2 tag -- }
  tag lila-tag-nil = if ." nil" exit then
  tag lila-tag-num = if value1 value2 lila-32 . exit then
  tag lila-tag-bool = if
    value1 0<> if ." true" else ." false" then exit
  then
  tag lila-tag-str = if value1 value2 type exit then
  tag lila-tag-table = if
    value1 value2 tag lila-meta-tostring
    if drop type else lila-value-drop ." <table>" then exit
  then
  tag lila-tag-float = if ." <float>" exit then
  tag lila-tag-fn = if ." <function>" exit then
  ." <value>" ;

: lila-print { value1 value2 tag -- }
  tag lila-tag-multi = if
    value1 @ 0 ?do
      i 3 * 1+ cells value1 + lila-value@ lila-print1
    loop
    exit
  then
  value1 value2 tag lila-print1 ;

: lila-report-error ( -- )
  lila-error-value@ { v1 v2 tag }
  tag lila-tag-str = if v1 v2 type else v1 v2 tag lila-print1 then
  cr ;

\ ---------------------------------------------------------------------------
\ Loop support.  Bounds, steps and the loop variable are ordinary tagged
\ numbers; this predicate keeps the generated Forth small.

: lila-for-cond { v1 v2 vtag e1 e2 etag s1 s2 stag -- flag }
  vtag lila-check-num
  etag lila-check-num
  stag lila-check-num
  s1 s2 lila-32
  dup 0= if s" lila: for step must not be zero" lila-raise-msg then
  0> if
    v1 v2 lila-32 e1 e2 lila-32 <=
  else
    v1 v2 lila-32 e1 e2 lila-32 >=
  then ;

\ ---------------------------------------------------------------------------
\ Frames and closures
\
\ A frame is a GC object (type 3) with a lexical parent, a caller link for
\ active-frame reachability, a per-call return value, the extra arguments of a
\ vararg call, a slot count, and a dynamically sized local array:
\   [parent][caller][retflag][ret1][ret2][rettag]
\   [varargs1][varargs2][varargstag][slotcount][slot0 ...]
\ A closure (type 4) is [seg][off][env].  A tag-6 value points at it.

10 constant lila-frame-slot0

variable lila-active-frame
variable lila-frame-tmp
lila-active-frame 1 lila-gc-register-root

: lila-check-fn ( tag -- )
  lila-tag-fn <> if s" lila: function expected" lila-raise-msg then ;

: lila-frame-slot-count ( frame -- n )  9 cells + @ ;

: lila-frame-bytes-of ( frame -- bytes )
  lila-frame-slot-count 3 * lila-frame-slot0 + cells ;

: lila-frame-new { parent slots -- frame }
  slots 0 max { n }
  n 3 * lila-frame-slot0 + cells 3 gc-alloc { frame -- }
  frame n 3 * lila-frame-slot0 + cells 0 fill
  parent frame !
  lila-active-frame @ frame cell+ !
  n frame 9 cells + !
  frame ;

: lila-frame-parent ( frame -- parent )  @ ;

: lila-frame-varargs ( frame -- addr )  6 cells + ;

: lila-frame-slot { frame slot -- addr }
  frame slot 3 * lila-frame-slot0 + cells + ;

: lila-frame-ret! { v1 v2 tag -- }
  lila-active-frame @ { frame }
  v1 v2 tag frame 3 cells + lila-value!
  1 frame 2 cells + ! ;

: lila-frame-ret? ( -- flag )
  lila-active-frame @ 2 cells + @ 0<> ;

: lila-frame-result ( -- v1 v2 tag )
  lila-active-frame @ dup 2 cells + @ if
    3 cells + lila-value@
  else
    drop 0 0 lila-tag-nil
  then ;

\ The active frame holds this call's extra arguments.  `...` reads it.
: lila-vararg ( -- v1 v2 tag )
  lila-active-frame @ lila-frame-varargs lila-value@ ;

: lila-vararg-first ( -- v1 v2 tag )
  lila-vararg lila-first ;

: lila-closure-new { seg off env -- v1 v2 tag }
  3 cells 4 gc-alloc { closure -- }
  seg closure !
  off closure cell+ !
  env closure 2 cells + !
  closure 0 lila-tag-fn ;

\ Generic indirect call: ( args... closure-value argc -- result ).  The
\ wrapper receives the captured frame pointer and the argument count so it can
\ keep the arguments beyond the declared parameters as this call's varargs.
variable lila-call-argc

: lila-call { v1 v2 tag argc -- }
  tag lila-check-fn
  v1 2 cells + @
  argc
  v1 @
  v1 cell+ @
  far-execute ;

\ Call a function with the values of a multi as its whole argument list.
: lila-call-multi { m1 m2 mt cv1 cv2 ctag -- r1 r2 tr }
  mt lila-tag-multi <> if s" lila: argument list expected" lila-raise-msg then
  m1 @ { n }
  n 0 ?do
    i 3 * 1+ cells m1 + lila-value@
  loop
  cv1 cv2 ctag
  n lila-call ;

\ Conservative scanners for the GC.
: lila-frame-gc-scan { frame -- }
  frame lila-frame-bytes-of 0 ?do
    frame i + @ gc-mark-cell
  loop ;
: lila-closure-gc-scan { closure -- }
  closure @ gc-mark-cell
  closure cell+ @ gc-mark-cell
  closure 2 cells + @ gc-mark-cell ;
: lila-multi-gc-scan { m -- }
  m @ 3 * 0 ?do
    m i cells + cell+ @ gc-mark-cell
  loop ;
' lila-frame-gc-scan is gc-scan-frame
' lila-closure-gc-scan is gc-scan-closure
' lila-multi-gc-scan is gc-scan-multi
