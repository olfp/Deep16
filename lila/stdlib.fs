\ LILA minimal standard library
\ -----------------------------
\ The basic Lua library functions are native closures.  Every builtin follows
\ the ordinary LILA call ABI: ( args... env argc -- value1 value2 tag ).  It
\ packs its arguments into a multi value immediately, so argument access and
\ multi-value pass-through work like any other call.  Because the compiler
\ emits ordinary calls, these names are first-class values as well:
\ `f = string.sub` and `pcall(f, ...)` work.
\
\ Runtime errors use lila-raise (value.fs), so pcall can catch them without
\ aborting the program.

\ ---------------------------------------------------------------------------
\ Native closure registration

lila-value-allot lila-var-type            lila-var-type 3 lila-gc-register-root
lila-value-allot lila-var-tostring        lila-var-tostring 3 lila-gc-register-root
lila-value-allot lila-var-tonumber        lila-var-tonumber 3 lila-gc-register-root
lila-value-allot lila-var-assert          lila-var-assert 3 lila-gc-register-root
lila-value-allot lila-var-error           lila-var-error 3 lila-gc-register-root
lila-value-allot lila-var-pcall           lila-var-pcall 3 lila-gc-register-root

lila-value-allot lila-var-string.len      lila-var-string.len 3 lila-gc-register-root
lila-value-allot lila-var-string.sub      lila-var-string.sub 3 lila-gc-register-root
lila-value-allot lila-var-string.upper    lila-var-string.upper 3 lila-gc-register-root
lila-value-allot lila-var-string.lower    lila-var-string.lower 3 lila-gc-register-root
lila-value-allot lila-var-string.rep      lila-var-string.rep 3 lila-gc-register-root
lila-value-allot lila-var-string.reverse  lila-var-string.reverse 3 lila-gc-register-root
lila-value-allot lila-var-string.byte     lila-var-string.byte 3 lila-gc-register-root
lila-value-allot lila-var-string.char     lila-var-string.char 3 lila-gc-register-root

lila-value-allot lila-var-math.abs        lila-var-math.abs 3 lila-gc-register-root
lila-value-allot lila-var-math.max        lila-var-math.max 3 lila-gc-register-root
lila-value-allot lila-var-math.min        lila-var-math.min 3 lila-gc-register-root
lila-value-allot lila-var-math.floor      lila-var-math.floor 3 lila-gc-register-root
lila-value-allot lila-var-math.ceil       lila-var-math.ceil 3 lila-gc-register-root
lila-value-allot lila-var-math.type       lila-var-math.type 3 lila-gc-register-root
lila-value-allot lila-var-math.tointeger  lila-var-math.tointeger 3 lila-gc-register-root
lila-value-allot lila-var-math.maxinteger lila-var-math.maxinteger 3 lila-gc-register-root
lila-value-allot lila-var-math.mininteger lila-var-math.mininteger 3 lila-gc-register-root

: lila-native-set { addr xt -- }
  0 xt far-xt 0 lila-closure-new addr lila-value! ;

\ ---------------------------------------------------------------------------
\ Argument and string helpers

: lila-arg { m1 m2 mt idx -- v1 v2 tag }
  m1 m2 mt idx lila-multi-get ;

: lila-str-copy { a u -- a' u' }
  u 0= if s" " exit then
  u 0 gc-alloc { dest }
  a dest u move
  dest u ;

: lila-num>str { n -- a u }
  n 0< if
    n negate s>d <# #s #> lila-str-copy { a u }
    u 1+ 0 gc-alloc { dest }
    [char] - dest c!
    a dest 1+ u move
    dest u 1+
  else
    n s>d <# #s #> lila-str-copy
  then ;

: lila-trim-left { a u -- a' u' }
  begin u 0> if a c@ bl = else false then
  while a 1+ to a  u 1- to u
  repeat
  a u ;

: lila-trim-right { a u -- a' u' }
  begin u 0> if a u + 1- c@ bl = else false then
  while u 1- to u
  repeat
  a u ;

: lila-str-trim ( a u -- a' u' )  lila-trim-left lila-trim-right ;

: lila-digit-value { ch -- n }
  ch [char] 0 >= ch [char] 9 <= and if ch [char] 0 - exit then
  ch [char] a >= ch [char] z <= and if ch [char] a - 10 + exit then
  ch [char] A >= ch [char] Z <= and if ch [char] A - 10 + exit then
  -1 ;

: lila-parse-uint { a u base -- n flag }
  u 0= if false exit then
  0 { acc }
  u 0 ?do
    a i + c@ lila-digit-value { d }
    d 0< d base >= or if false unloop exit then
    acc base * d + to acc
  loop
  acc true ;

\ Parse a Lua-style integer string.  A base of 0 means autodetect: decimal, or
\ hexadecimal when the string starts with 0x/0X.
: lila-parse-number { a u base -- n flag }
  a u lila-str-trim to u to a
  u 0= if false exit then
  0 { sign }
  a c@ [char] - = if
    -1 to sign  a 1+ to a  u 1- to u
  else
    a c@ [char] + = if a 1+ to a  u 1- to u then
  then
  u 0= if false exit then
  base 0= if
    u 2 >= if
      a c@ [char] 0 = if
        a 1+ c@ [char] x = a 1+ c@ [char] X = or if
          16 to base  a 2 + to a  u 2 - to u
        then
      then
    then
    base 0= if 10 to base then
  then
  a u base lila-parse-uint if
    sign 0< if negate then true
  else
    false
  then ;

\ ---------------------------------------------------------------------------
\ Value conversion

: lila-type-name { v1 v2 tag -- a u }
  begin tag lila-tag-multi = while
    v1 v2 tag lila-first to tag to v2 to v1
  repeat
  tag lila-tag-nil = if s" nil" exit then
  tag lila-tag-num = if s" number" exit then
  tag lila-tag-bool = if s" boolean" exit then
  tag lila-tag-str = if s" string" exit then
  tag lila-tag-table = if s" table" exit then
  tag lila-tag-float = if s" float" exit then
  tag lila-tag-fn = if s" function" exit then
  s" userdata" ;

: lila-bi-type { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg lila-type-name lila-tag-str ;

: lila-bi-tostring { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { v1 v2 tag }
  begin tag lila-tag-multi = while
    v1 v2 tag lila-first to tag to v2 to v1
  repeat
  tag lila-tag-nil = if s" nil" lila-tag-str exit then
  tag lila-tag-bool = if
    v1 0<> if s" true" else s" false" then lila-tag-str exit
  then
  tag lila-tag-num = if
    v1 v2 lila-32 lila-num>str lila-tag-str exit
  then
  tag lila-tag-str = if v1 v2 tag exit then
  tag lila-tag-table = if s" <table>" lila-tag-str exit then
  tag lila-tag-fn = if s" <function>" lila-tag-str exit then
  tag lila-tag-float = if s" <float>" lila-tag-str exit then
  s" <value>" lila-tag-str ;

: lila-bi-tonumber { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { v1 v2 tag }
  m1 m2 mt 1 lila-arg { b1 b2 bt }
  bt lila-tag-nil = if
    tag lila-tag-num = if v1 v2 tag exit then
    tag lila-tag-str = if
      v1 v2 0 lila-parse-number if
        lila>value-num
      else
        0 0 lila-tag-nil
      then
      exit
    then
    0 0 lila-tag-nil exit
  then
  bt lila-check-num
  b1 b2 lila-32 { base }
  base 2 < base 36 > or if s" lila: base out of range" lila-raise-msg then
  tag lila-tag-str <> if 0 0 lila-tag-nil exit then
  v1 v2 base lila-parse-number if
    lila>value-num
  else
    0 0 lila-tag-nil
  then ;

\ ---------------------------------------------------------------------------
\ assert/error/pcall

: lila-multi-prepend { m1 m2 mt v1 v2 vt -- r1 r2 rt }
  mt lila-tag-multi = if m1 @ else 1 then { n }
  n 1+ lila-multi-alloc { out }
  v1 v2 vt out cell+ lila-value!
  mt lila-tag-multi = if
    n 0 ?do
      m1 i 3 * 1+ cells + lila-value@
      out i 1+ 3 * 1+ cells + lila-value!
    loop
  else
    m1 m2 mt out 4 cells + lila-value!
  then
  out 0 lila-tag-multi ;

: lila-bi-assert { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg lila-truthy if
    m1 m2 mt exit
  then
  argc 1 > if
    m1 m2 mt 1 lila-arg
  else
    s" assertion failed!" lila-tag-str
  then
  lila-raise ;

: lila-bi-error { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  argc 0> if
    m1 m2 mt 0 lila-arg
  else
    0 0 lila-tag-nil
  then
  lila-raise ;

create lila-pcall-args 3 cells allot
lila-pcall-args 3 lila-gc-register-root
create lila-pcall-base 0 ,

: lila-bi-pcall { env argc -- r1 r2 rt }
  argc lila-multi-pack lila-pcall-args lila-value!
  lila-pcall-args lila-value@ lila-multi-count { n }
  sp@ lila-pcall-base !
  n 1 > if
    n 1 ?do
      lila-pcall-args lila-value@ i lila-arg
    loop
  then
  lila-pcall-args lila-value@ 0 lila-arg
  n 1- 0 max
  ['] lila-call catch
  ?dup if
    dup lila-raise-code <> if
      lila-pcall-base @ sp! throw
    then
    drop
    lila-pcall-base @ sp!
    lila-error-value@
    false lila>value-bool
    lila-multi-prepend
  else
    true lila>value-bool
    lila-multi-prepend
  then ;

\ ---------------------------------------------------------------------------
\ string library

: lila-bi-strlen { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { v1 v2 tag }
  tag lila-check-str
  v2 lila>value-num ;

: lila-bi-strsub { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { s1 s2 st }
  st lila-check-str
  m1 m2 mt 1 lila-arg { i1 i2 it }
  m1 m2 mt 2 lila-arg { j1 j2 jt }
  0 0 { start stop }
  it lila-tag-nil = if 1 else i1 i2 lila-32 then to start
  jt lila-tag-nil = if -1 else j1 j2 lila-32 then to stop
  start 0< if s2 start + 1+ to start then
  start 1 < if 1 to start then
  stop 0< if s2 stop + 1+ to stop then
  stop s2 > if s2 to stop then
  start s2 > start stop > or stop 1 < or if s" " lila-tag-str exit then
  s1 start 1- + stop start - 1+ lila-str-copy lila-tag-str ;

: lila-bi-strupper { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { s1 s2 st }
  st lila-check-str
  s1 s2 lila-str-copy { a u }
  u 0 ?do
    a i + c@ { ch }
    ch [char] a >= ch [char] z <= and if
      ch 32 - a i + c!
    then
  loop
  a u lila-tag-str ;

: lila-bi-strlower { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { s1 s2 st }
  st lila-check-str
  s1 s2 lila-str-copy { a u }
  u 0 ?do
    a i + c@ { ch }
    ch [char] A >= ch [char] Z <= and if
      ch 32 + a i + c!
    then
  loop
  a u lila-tag-str ;

: lila-bi-strrep { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { s1 s2 st }
  st lila-check-str
  m1 m2 mt 1 lila-arg { n1 n2 nt }
  nt lila-check-num
  n1 n2 lila-32 { n }
  n 0<= if s" " lila-tag-str exit then
  s2 n * { total }
  total 0 gc-alloc { dest }
  n 0 ?do
    s1 dest i s2 * + s2 move
  loop
  dest total lila-tag-str ;

: lila-bi-strreverse { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { s1 s2 st }
  st lila-check-str
  s2 0= if s" " lila-tag-str exit then
  s2 0 gc-alloc { dest }
  s2 0 ?do
    s1 s2 1- i - + c@ dest i + c!
  loop
  dest s2 lila-tag-str ;

: lila-bi-strbyte { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { s1 s2 st }
  st lila-check-str
  m1 m2 mt 1 lila-arg { i1 i2 it }
  it lila-tag-nil = if 1 else i1 i2 lila-32 then { idx }
  idx 0< if s2 idx + 1+ to idx then
  idx 1 < idx s2 > or if 0 0 lila-tag-nil exit then
  s1 idx 1- + c@ lila>value-num ;

: lila-bi-strchar { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  argc 0= if s" " lila-tag-str exit then
  argc 0 gc-alloc { dest }
  argc 0 ?do
    m1 m2 mt i lila-arg { v1 v2 tag }
    tag lila-check-num
    v1 v2 lila-32 { n }
    n 0< n 255 > or if s" lila: byte out of range" lila-raise-msg then
    n dest i + c!
  loop
  dest argc lila-tag-str ;

\ ---------------------------------------------------------------------------
\ math library (32-bit integers only)

: lila-bi-mathabs { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { v1 v2 tag }
  tag lila-check-num
  v1 v2 lila-32 dup 0< if negate then lila>value-num ;

: lila-math-fold { argc max? -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  argc 0= if s" lila: value expected" lila-raise-msg then
  m1 m2 mt 0 lila-arg { v1 v2 tag }
  tag lila-check-num
  v1 v2 lila-32 { acc }
  argc 1 ?do
    m1 m2 mt i lila-arg { x1 x2 xt }
    xt lila-check-num
    x1 x2 lila-32 { x }
    max? if x acc > else x acc < then if
      x to acc
    then
  loop
  acc lila>value-num ;

: lila-bi-mathmax { env argc -- r1 r2 rt }  argc true lila-math-fold ;
: lila-bi-mathmin { env argc -- r1 r2 rt }  argc false lila-math-fold ;

: lila-bi-mathfloor { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { v1 v2 tag }
  tag lila-check-num
  v1 v2 tag ;

: lila-bi-mathceil { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { v1 v2 tag }
  tag lila-check-num
  v1 v2 tag ;

: lila-bi-mathtype { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { v1 v2 tag }
  tag lila-tag-num = if s" integer" lila-tag-str else 0 0 lila-tag-nil then ;

: lila-bi-mathint { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { v1 v2 tag }
  tag lila-tag-num = if v1 v2 tag else 0 0 lila-tag-nil then ;

\ ---------------------------------------------------------------------------
\ Install the closures

: lila-stdlib-install ( -- )
  lila-var-type            ['] lila-bi-type            lila-native-set
  lila-var-tostring        ['] lila-bi-tostring        lila-native-set
  lila-var-tonumber        ['] lila-bi-tonumber        lila-native-set
  lila-var-assert          ['] lila-bi-assert          lila-native-set
  lila-var-error           ['] lila-bi-error           lila-native-set
  lila-var-pcall           ['] lila-bi-pcall           lila-native-set

  lila-var-string.len      ['] lila-bi-strlen          lila-native-set
  lila-var-string.sub      ['] lila-bi-strsub          lila-native-set
  lila-var-string.upper    ['] lila-bi-strupper        lila-native-set
  lila-var-string.lower    ['] lila-bi-strlower        lila-native-set
  lila-var-string.rep      ['] lila-bi-strrep          lila-native-set
  lila-var-string.reverse  ['] lila-bi-strreverse      lila-native-set
  lila-var-string.byte     ['] lila-bi-strbyte         lila-native-set
  lila-var-string.char     ['] lila-bi-strchar         lila-native-set

  lila-var-math.abs        ['] lila-bi-mathabs         lila-native-set
  lila-var-math.max        ['] lila-bi-mathmax         lila-native-set
  lila-var-math.min        ['] lila-bi-mathmin         lila-native-set
  lila-var-math.floor      ['] lila-bi-mathfloor       lila-native-set
  lila-var-math.ceil       ['] lila-bi-mathceil        lila-native-set
  lila-var-math.type       ['] lila-bi-mathtype        lila-native-set
  lila-var-math.tointeger  ['] lila-bi-mathint         lila-native-set

  2147483647 lila>value-num lila-var-math.maxinteger lila-value!
  -2147483648 lila>value-num lila-var-math.mininteger lila-value! ;

lila-stdlib-install
