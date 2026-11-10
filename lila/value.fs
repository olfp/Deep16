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

: lila-value-check ( value1 value2 tag want -- value1 value2 tag )
  over <> if s" lila: value tag mismatch" lila-error then drop ;

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
  lila-tag-num <> if s" lila: number expected" lila-error then ;

: lila-check-str ( tag -- )
  lila-tag-str <> if s" lila: string expected" lila-error then ;

: lila-check-table ( tag -- )
  lila-tag-table <> if s" lila: table expected" lila-error then ;

: lila-num>32 { value1 value2 tag -- n }
  tag lila-check-num
  value1 value2 lila-32 ;

\ Turn a tagged number into its raw ( low high ) halves.
: lila-to-num { value1 value2 tag -- lo hi }
  tag lila-check-num
  value1 value2 lila-32
  dup lila-32>lo swap lila-32>hi ;

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

: lila-add { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta lila-tag-num = tb lila-tag-num = and if
    a1 a2 lila-32 b1 b2 lila-32 + lila>value-num exit
  then
  ta lila-tag-str = tb lila-tag-str = and if
    a1 a2 b1 b2 lila-str-concat lila-tag-str exit
  then
  s" lila: cannot add these values" lila-error ;

: lila-sub { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 b1 b2 lila-32 - lila>value-num ;

: lila-mul { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 b1 b2 lila-32 * lila>value-num ;

: lila-div { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 b1 b2 lila-32
  dup 0= if s" lila: division by zero" lila-error then
  / lila>value-num ;

: lila-neg { a1 a2 ta -- r1 r2 tr }
  ta lila-check-num
  a1 a2 lila-32 negate lila>value-num ;

\ Floor division and modulo, matching Lua's integer semantics: the quotient
\ rounds toward negative infinity and the remainder has the sign of the
\ divisor.
: lila-floor-div { a b -- q r }
  b 0= if s" lila: division by zero" lila-error then
  a b /mod { r q -- }
  r 0<> if
    r b xor 0< if
      q 1- to q
      r b + to r
    then
  then
  q r ;

: lila-idiv { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 b1 b2 lila-32 lila-floor-div drop lila>value-num ;

: lila-mod { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 b1 b2 lila-32 lila-floor-div nip lila>value-num ;

: lila-pow { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta lila-check-num
  tb lila-check-num
  a1 a2 lila-32 { base }
  b1 b2 lila-32 { exp }
  exp 0< if s" lila: negative exponent" lila-error then
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
    a1 b1 = lila>value-bool exit
  then
  ta lila-tag-fn = if
    a1 b1 = lila>value-bool exit
  then
  0 lila>value-bool ;

: lila-ne { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  a1 a2 ta b1 b2 tb lila-eq { r1 r2 tr }
  r1 0= lila>value-bool ;

: lila-lt { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta tb <> if s" lila: cannot compare different types" lila-error then
  ta lila-tag-num = if
    a1 a2 lila-32 b1 b2 lila-32 < lila>value-bool exit
  then
  ta lila-tag-str = if
    a1 a2 b1 b2 compare 0< lila>value-bool exit
  then
  s" lila: cannot order these values" lila-error ;

: lila-gt { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta tb <> if s" lila: cannot compare different types" lila-error then
  ta lila-tag-num = if
    a1 a2 lila-32 b1 b2 lila-32 > lila>value-bool exit
  then
  ta lila-tag-str = if
    a1 a2 b1 b2 compare 0> lila>value-bool exit
  then
  s" lila: cannot order these values" lila-error ;

: lila-le { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta tb <> if s" lila: cannot compare different types" lila-error then
  ta lila-tag-num = if
    a1 a2 lila-32 b1 b2 lila-32 <= lila>value-bool exit
  then
  ta lila-tag-str = if
    a1 a2 b1 b2 compare 0<= lila>value-bool exit
  then
  s" lila: cannot order these values" lila-error ;

: lila-ge { a1 a2 ta b1 b2 tb -- r1 r2 tr }
  ta tb <> if s" lila: cannot compare different types" lila-error then
  ta lila-tag-num = if
    a1 a2 lila-32 b1 b2 lila-32 >= lila>value-bool exit
  then
  ta lila-tag-str = if
    a1 a2 b1 b2 compare 0>= lila>value-bool exit
  then
  s" lila: cannot order these values" lila-error ;

\ ---------------------------------------------------------------------------
\ Conditions, length and printing

: lila-truthy { value1 value2 tag -- flag }
  tag lila-tag-nil = if false exit then
  tag lila-tag-bool = if value1 0<> exit then
  tag lila-tag-num = if value1 value2 lila-32 0<> exit then
  true ;

: lila-not { value1 value2 tag -- r1 r2 tr }
  value1 value2 tag lila-truthy 0= lila>value-bool ;

: lila-length { value1 value2 tag -- lo hi tnum }
  tag lila-tag-nil = if 0 0 lila-tag-num exit then
  tag lila-check-str
  value2 lila>value-num ;

: lila-print { value1 value2 tag -- }
  tag lila-tag-nil = if ." nil" exit then
  tag lila-tag-num = if value1 value2 lila-32 . exit then
  tag lila-tag-bool = if
    value1 0<> if ." true" else ." false" then exit
  then
  tag lila-tag-str = if value1 value2 type exit then
  tag lila-tag-table = if ." <table>" exit then
  tag lila-tag-float = if ." <float>" exit then
  tag lila-tag-fn = if ." <function>" exit then
  ." <value>" ;

\ ---------------------------------------------------------------------------
\ Loop support.  Bounds, steps and the loop variable are ordinary tagged
\ numbers; this predicate keeps the generated Forth small.

: lila-for-cond { v1 v2 vtag e1 e2 etag s1 s2 stag -- flag }
  vtag lila-check-num
  etag lila-check-num
  stag lila-check-num
  s1 s2 lila-32
  dup 0= if s" lila: for step must not be zero" lila-error then
  0> if
    v1 v2 lila-32 e1 e2 lila-32 <=
  else
    v1 v2 lila-32 e1 e2 lila-32 >=
  then ;

\ ---------------------------------------------------------------------------
\ Frames and closures
\
\ A frame is a GC object (type 3) with a lexical parent, a caller link for
\ active-frame reachability, a per-call return value, and fixed local slots:
\   [parent][caller][retflag][ret1][ret2][rettag][slot0 ...]
\ A closure (type 4) is [seg][off][env].  A tag-6 value points at it.

96 constant lila-frame-slot-count
6 constant lila-frame-slot0
lila-frame-slot-count 3 * lila-frame-slot0 + cells constant lila-frame-bytes

variable lila-active-frame
variable lila-frame-tmp
lila-active-frame 1 lila-gc-register-root

: lila-check-fn ( tag -- )
  lila-tag-fn <> if s" lila: function expected" lila-error then ;

: lila-frame-new { parent -- frame }
  lila-frame-bytes 3 gc-alloc { frame -- }
  frame lila-frame-bytes 0 fill
  parent frame !
  lila-active-frame @ frame cell+ !
  frame ;

: lila-frame-parent ( frame -- parent )  @ ;

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

: lila-closure-new { seg off env -- v1 v2 tag }
  3 cells 4 gc-alloc { closure -- }
  seg closure !
  off closure cell+ !
  env closure 2 cells + !
  closure 0 lila-tag-fn ;

\ Generic indirect call: ( args... closure-value argc -- result ).  The
\ closure value sits just below argc; it is replaced by the captured frame
\ pointer, which the function wrapper expects on top of its arguments.
: lila-call { v1 v2 tag argc -- }
  tag lila-check-fn
  v1 2 cells + @
  v1 @
  v1 cell+ @
  far-execute ;

\ Conservative scanners for the GC.
: lila-frame-gc-scan { frame -- }
  lila-frame-bytes 0 ?do
    frame i + @ gc-mark-cell
  loop ;
: lila-closure-gc-scan { closure -- }
  closure @ gc-mark-cell
  closure cell+ @ gc-mark-cell
  closure 2 cells + @ gc-mark-cell ;
' lila-frame-gc-scan is gc-scan-frame
' lila-closure-gc-scan is gc-scan-closure
