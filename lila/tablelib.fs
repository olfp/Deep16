\ LILA table library and iteration
\ --------------------------------
\ next/pairs/ipairs plus table.insert, table.remove, table.concat,
\ table.unpack, table.pack and table.sort.  These operate on the raw table
\ storage in hash.fs; metamethods are not consulted, matching Lua's table
\ library.
\
\ Static scratch cells: table.sort calls back into LILA code, so every value
\ that must survive a comparator call is kept in a registered GC root.

create lila-table-a 3 cells allot
create lila-table-b 3 cells allot
create lila-table-res 3 cells allot
create lila-sort-tab 3 cells allot
create lila-sort-comp 3 cells allot
create lila-sort-a 3 cells allot
create lila-sort-b 3 cells allot
create lila-ipairs-fn 3 cells allot

lila-table-a 3 lila-gc-register-root
lila-table-b 3 lila-gc-register-root
lila-table-res 3 lila-gc-register-root
lila-sort-tab 3 lila-gc-register-root
lila-sort-comp 3 lila-gc-register-root
lila-sort-a 3 lila-gc-register-root
lila-sort-b 3 lila-gc-register-root
lila-ipairs-fn 3 lila-gc-register-root

\ Accumulator for table.concat.  No user code runs during concatenation, so
\ these raw cells are safe; they are roots anyway.
create lila-concat-addr 0 ,
create lila-concat-len 0 ,
lila-concat-addr 1 lila-gc-register-root

\ Public globals, allocated before any builtin refers to them.
lila-value-allot lila-var-next          lila-var-next 3 lila-gc-register-root
lila-value-allot lila-var-pairs         lila-var-pairs 3 lila-gc-register-root
lila-value-allot lila-var-ipairs        lila-var-ipairs 3 lila-gc-register-root
lila-value-allot lila-var-table.insert  lila-var-table.insert 3 lila-gc-register-root
lila-value-allot lila-var-table.remove  lila-var-table.remove 3 lila-gc-register-root
lila-value-allot lila-var-table.concat  lila-var-table.concat 3 lila-gc-register-root
lila-value-allot lila-var-table.unpack  lila-var-table.unpack 3 lila-gc-register-root
lila-value-allot lila-var-table.pack    lila-var-table.pack 3 lila-gc-register-root
lila-value-allot lila-var-table.sort    lila-var-table.sort 3 lila-gc-register-root

\ Raw accessors that always leave a value (nil when the key is absent).
: table-fetch-to { table k1 k2 kt dest -- }
  table k1 k2 kt table-get if
    dest lila-value!
  else
    lila-value-drop
    0 0 lila-tag-nil dest lila-value!
  then ;

: table-store-from { table k1 k2 kt src -- }
  table k1 k2 kt src lila-value@ table-set ;

\ ---------------------------------------------------------------------------
\ next / pairs / ipairs

: lila-bi-next { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { t1 t2 tt }
  tt lila-check-table
  m1 m2 mt 1 lila-arg { k1 k2 kt }
  t1 k1 k2 kt table-next if
    2 lila-multi-pack
  else
    lila-value-drop lila-value-drop
    0 0 lila-tag-nil
  then ;

: lila-bi-pairs { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { t1 t2 tt }
  tt lila-check-table
  lila-var-next lila-value@
  t1 t2 tt
  0 0 lila-tag-nil
  3 lila-multi-pack ;

\ ipairs iterator: (table, index) -> index+1, value or nothing at the end.
: lila-bi-ipairs-iter { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { t1 t2 tt }
  tt lila-check-table
  m1 m2 mt 1 lila-arg { i1 i2 it }
  it lila-tag-nil = if 0 else i1 i2 lila-32 then { i }
  i 1+ { n }
  n lila>value-num
  t1 n lila>value-num table-get
  if
    dup lila-tag-nil = if
      lila-value-drop lila-value-drop
      0 0 lila-tag-nil
    else
      2 lila-multi-pack
    then
  else
    lila-value-drop lila-value-drop
    0 0 lila-tag-nil
  then ;

: lila-bi-ipairs { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { t1 t2 tt }
  tt lila-check-table
  lila-ipairs-fn lila-value@
  t1 t2 tt
  0 lila>value-num
  3 lila-multi-pack ;

\ ---------------------------------------------------------------------------
\ table.insert

: lila-bi-tinsert { env argc -- r1 r2 rt }
  argc 2 < argc 3 > or if
    s" lila: wrong number of arguments" lila-raise-msg
  then
  argc lila-multi-pack { m1 m2 mt }
  0 0 0 { pos n i }
  m1 m2 mt 0 lila-arg { t1 t2 tt }
  tt lila-check-table
  argc 3 = if
    m1 m2 mt 1 lila-arg { p1 p2 pt }
    pt lila-check-num
    p1 p2 lila-32 to pos
    m1 m2 mt 2 lila-arg lila-table-a lila-value!
  else
    m1 m2 mt 1 lila-arg lila-table-a lila-value!
    t1 table-border 1+ to pos
  then
  t1 table-border to n
  pos 1 < pos n 1+ > or if
    s" lila: position out of bounds" lila-raise-msg
  then
  n to i
  begin i pos >= while
    t1 i lila>value-num table-get drop lila-table-b lila-value!
    t1 i 1+ lila>value-num lila-table-b lila-value@ table-set
    i 1- to i
  repeat
  t1 pos lila>value-num lila-table-a lila-value@ table-set
  0 0 lila-tag-nil ;

\ ---------------------------------------------------------------------------
\ table.remove

: lila-bi-tremove { env argc -- r1 r2 rt }
  argc 1 < argc 2 > or if
    s" lila: wrong number of arguments" lila-raise-msg
  then
  argc lila-multi-pack { m1 m2 mt }
  0 0 0 { pos n i }
  m1 m2 mt 0 lila-arg { t1 t2 tt }
  tt lila-check-table
  t1 table-border to n
  argc 2 = if
    m1 m2 mt 1 lila-arg { p1 p2 pt }
    pt lila-check-num
    p1 p2 lila-32 to pos
  else
    n to pos
  then
  n 0= if
    0 0 lila-tag-nil exit
  then
  pos 1 < pos n > or if
    s" lila: position out of bounds" lila-raise-msg
  then
  t1 pos lila>value-num table-get drop lila-table-res lila-value!
  pos to i
  begin i n < while
    t1 i 1+ lila>value-num table-get drop lila-table-b lila-value!
    t1 i lila>value-num lila-table-b lila-value@ table-set
    i 1+ to i
  repeat
  t1 n lila>value-num 0 0 lila-tag-nil table-set
  lila-table-res lila-value@ ;

\ ---------------------------------------------------------------------------
\ table.concat

: lila-concat-fragment { v1 v2 vt -- a u }
  vt lila-tag-str = if v1 v2 exit then
  vt lila-tag-num = if v1 v2 lila-32 lila-num>str exit then
  s" lila: invalid value in table for concat" lila-raise-msg ;

: lila-concat-append { a u -- }
  lila-concat-addr @ lila-concat-len @ a u lila-str-concat
  lila-concat-len !
  lila-concat-addr ! ;

: lila-bi-tconcat { env argc -- r1 r2 rt }
  argc 1 < argc 4 > or if
    s" lila: wrong number of arguments" lila-raise-msg
  then
  argc lila-multi-pack { m1 m2 mt }
  0 0 0 { lo hi k }
  m1 m2 mt 0 lila-arg { t1 t2 tt }
  tt lila-check-table
  m1 m2 mt 1 lila-arg { s1 s2 st }
  st lila-tag-nil = if
    0 to s2  0 to s1
  else
    st lila-check-str
  then
  m1 m2 mt 2 lila-arg { i1 i2 it }
  it lila-tag-nil = if
    1 to lo
  else
    i1 i2 lila-32 to lo
  then
  m1 m2 mt 3 lila-arg { j1 j2 jt }
  jt lila-tag-nil = if
    t1 table-border to hi
  else
    j1 j2 lila-32 to hi
  then
  0 lila-concat-addr !
  0 lila-concat-len !
  lo to k
  begin k hi <= while
    t1 k lila>value-num table-get drop lila-table-a lila-value!
    k lo <> if
      s1 s2 lila-concat-append
    then
    lila-table-a lila-value@ lila-concat-fragment lila-concat-append
    k 1+ to k
  repeat
  lila-concat-addr @ lila-concat-len @ lila-tag-str ;

\ ---------------------------------------------------------------------------
\ table.unpack / table.pack

: lila-bi-tunpack { env argc -- r1 r2 rt }
  argc 1 < argc 3 > or if
    s" lila: wrong number of arguments" lila-raise-msg
  then
  argc lila-multi-pack { m1 m2 mt }
  0 0 0 { lo hi cnt }
  m1 m2 mt 0 lila-arg { t1 t2 tt }
  tt lila-check-table
  m1 m2 mt 1 lila-arg { i1 i2 it }
  it lila-tag-nil = if
    1 to lo
  else
    i1 i2 lila-32 to lo
  then
  m1 m2 mt 2 lila-arg { j1 j2 jt }
  jt lila-tag-nil = if
    t1 table-border to hi
  else
    j1 j2 lila-32 to hi
  then
  hi lo - 1+ 0 max to cnt
  cnt lila-multi-alloc { out }
  cnt 0 ?do
    t1 lo i + lila>value-num table-get drop
    out i 3 * 1+ cells + lila-value!
  loop
  out 0 lila-tag-multi ;

: lila-bi-tpack { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  table-initial-buckets table-new { t }
  argc 0 ?do
    t i 1+ lila>value-num m1 m2 mt i lila-arg table-set
  loop
  t s" n" lila-tag-str argc lila>value-num table-set
  t 0 lila-tag-table ;

\ ---------------------------------------------------------------------------
\ table.sort.  Selection sort keeps the control flow simple; comparisons go
\ through the optional comparator, which may run arbitrary LILA code.

: lila-table-less { a1 a2 at b1 b2 bt c1 c2 ct -- flag }
  ct lila-tag-nil = if
    a1 a2 at b1 b2 bt lila-lt lila-first lila-truthy exit
  then
  a1 a2 at b1 b2 bt c1 c2 ct 2 lila-call
  lila-first lila-truthy ;

: lila-bi-tsort { env argc -- r1 r2 rt }
  argc 1 < argc 2 > or if
    s" lila: wrong number of arguments" lila-raise-msg
  then
  argc lila-multi-pack { m1 m2 mt }
  0 0 0 0 { n i j m }
  m1 m2 mt 0 lila-arg lila-sort-tab lila-value!
  lila-sort-tab lila-value@ nip nip lila-check-table
  m1 m2 mt 1 lila-arg lila-sort-comp lila-value!
  lila-sort-comp lila-value@ nip nip
  dup lila-tag-nil <> if
    lila-check-fn
  else
    drop
  then
  lila-sort-tab lila-value@ { t1 t2 tt }
  t1 table-border to n
  1 to i
  begin i n < while
    i to m
    i 1+ to j
    begin j n <= while
      t1 j lila>value-num lila-sort-a table-fetch-to
      t1 m lila>value-num lila-sort-b table-fetch-to
      lila-sort-a lila-value@ lila-sort-b lila-value@
      lila-sort-comp lila-value@ lila-table-less if
        j to m
      then
      j 1+ to j
    repeat
    i m <> if
      t1 i lila>value-num lila-sort-a table-fetch-to
      t1 m lila>value-num lila-sort-b table-fetch-to
      t1 m lila>value-num lila-sort-a table-store-from
      t1 i lila>value-num lila-sort-b table-store-from
    then
    i 1+ to i
  repeat
  0 0 lila-tag-nil ;

\ ---------------------------------------------------------------------------
\ Install the closures

: lila-tablelib-install ( -- )
  lila-var-next          ['] lila-bi-next          lila-native-set
  lila-var-pairs         ['] lila-bi-pairs         lila-native-set
  lila-var-ipairs        ['] lila-bi-ipairs        lila-native-set
  lila-var-table.insert  ['] lila-bi-tinsert       lila-native-set
  lila-var-table.remove  ['] lila-bi-tremove       lila-native-set
  lila-var-table.concat  ['] lila-bi-tconcat       lila-native-set
  lila-var-table.unpack  ['] lila-bi-tunpack       lila-native-set
  lila-var-table.pack    ['] lila-bi-tpack         lila-native-set
  lila-var-table.sort    ['] lila-bi-tsort         lila-native-set
  0 ['] lila-bi-ipairs-iter far-xt 0 lila-closure-new
  lila-ipairs-fn lila-value! ;

lila-tablelib-install
