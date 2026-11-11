\ LILA metatables
\ --------------
\ A table header carries a metatable pointer in its fourth cell.  The subset
\ implemented here covers get/setmetatable, rawget/rawset/rawequal, and the
\ __index, __newindex, __add, __sub, __mul, __div, __idiv, __mod, __pow, __unm,
\ __eq, __lt, __le, and __tostring metamethods.  __call, __len, __metatable,
\ __gc, weak tables and finalizers are intentionally out of scope.
\
\ Metamethod lookups follow Lua's order: the left operand's metatable first,
\ then the right operand's.  Results are reduced to one value with lila-first,
\ and comparison results are coerced to booleans.

\ ---------------------------------------------------------------------------
\ Metatable lookup

\ Look up FIELD in TABLE's metatable.  Missing tables, missing metatables,
\ missing fields and nil fields all report not-found.
: meta-method { table-addr field-addr field-len -- value1 value2 tag found }
  table-addr 0= if 0 0 lila-tag-nil false exit then
  table-addr table-metatable@
  dup 0= if drop 0 0 lila-tag-nil false exit then
  field-addr field-len table-get
  if
    dup lila-tag-nil = if
      lila-value-drop 0 0 lila-tag-nil false
    else
      true
    then
  else
    lila-value-drop 0 0 lila-tag-nil false
  then ;

\ The selected metamethod lives here between lookup and its call.  User code
\ can allocate, so the cells are GC roots.
create meta-hold 3 cells allot
meta-hold 3 lila-gc-register-root

: meta-hold! ( value1 value2 tag -- )  meta-hold lila-value! ;
: meta-hold@ ( -- value1 value2 tag )  meta-hold lila-value@ ;
: meta-hold-tag ( -- tag )  meta-hold 2 cells + @ ;

: meta-find2 { a1 a2 ta b1 b2 tb field-addr field-len -- found }
  ta lila-tag-table = if
    a1 field-addr field-len meta-method
    if
      meta-hold! true exit
    else
      lila-value-drop
    then
  then
  tb lila-tag-table = if
    b1 field-addr field-len meta-method
    if
      meta-hold! true exit
    else
      lila-value-drop
    then
  then
  false ;

: meta-find1 { a1 a2 ta field-addr field-len -- found }
  ta lila-tag-table = if
    a1 field-addr field-len meta-method
    if
      meta-hold! true exit
    else
      lila-value-drop
    then
  then
  false ;

\ ---------------------------------------------------------------------------
\ Arithmetic metamethods

: meta-op-bin { a1 a2 ta b1 b2 tb field-addr field-len -- r1 r2 rt }
  a1 a2 ta b1 b2 tb field-addr field-len meta-find2 0= if
    s" lila: operator not supported" lila-raise-msg
  then
  a1 a2 ta b1 b2 tb meta-hold@ 2 lila-call lila-first ;

: meta-op-add  ( a1 a2 ta b1 b2 tb -- r1 r2 rt )  s" __add"  meta-op-bin ;
: meta-op-sub  ( a1 a2 ta b1 b2 tb -- r1 r2 rt )  s" __sub"  meta-op-bin ;
: meta-op-mul  ( a1 a2 ta b1 b2 tb -- r1 r2 rt )  s" __mul"  meta-op-bin ;
: meta-op-div  ( a1 a2 ta b1 b2 tb -- r1 r2 rt )  s" __div"  meta-op-bin ;
: meta-op-idiv ( a1 a2 ta b1 b2 tb -- r1 r2 rt )  s" __idiv" meta-op-bin ;
: meta-op-mod  ( a1 a2 ta b1 b2 tb -- r1 r2 rt )  s" __mod"  meta-op-bin ;
: meta-op-pow  ( a1 a2 ta b1 b2 tb -- r1 r2 rt )  s" __pow"  meta-op-bin ;
: meta-op-unm  { a1 a2 ta -- r1 r2 rt }
  a1 a2 ta s" __unm" meta-find1 0= if
    s" lila: operator not supported" lila-raise-msg
  then
  a1 a2 ta meta-hold@ 1 lila-call lila-first ;

' meta-op-add  is lila-meta-add
' meta-op-sub  is lila-meta-sub
' meta-op-mul  is lila-meta-mul
' meta-op-div  is lila-meta-div
' meta-op-idiv is lila-meta-idiv
' meta-op-mod  is lila-meta-mod
' meta-op-pow  is lila-meta-pow
' meta-op-unm  is lila-meta-unm

\ ---------------------------------------------------------------------------
\ Comparison metamethods

: meta-op-compare { a1 a2 ta b1 b2 tb field-addr field-len -- r1 r2 rt }
  a1 a2 ta b1 b2 tb field-addr field-len meta-find2 0= if
    s" lila: cannot order these values" lila-raise-msg
  then
  a1 a2 ta b1 b2 tb meta-hold@ 2 lila-call lila-first
  lila-truthy lila>value-bool ;

: meta-op-lt ( a1 a2 ta b1 b2 tb -- r1 r2 rt )  s" __lt" meta-op-compare ;
: meta-op-le ( a1 a2 ta b1 b2 tb -- r1 r2 rt )  s" __le" meta-op-compare ;

: meta-op-eq { a1 a2 ta b1 b2 tb -- r1 r2 rt }
  a1 a2 ta b1 b2 tb s" __eq" meta-find2 0= if
    false lila>value-bool exit
  then
  a1 a2 ta b1 b2 tb meta-hold@ 2 lila-call lila-first
  lila-truthy lila>value-bool ;

' meta-op-eq is lila-meta-eq
' meta-op-lt is lila-meta-lt
' meta-op-le is lila-meta-le

\ ---------------------------------------------------------------------------
\ __index and __newindex

: lila-index { tv1 tv2 ttag kv1 kv2 ktag -- r1 r2 rt }
  ttag lila-check-table
  ktag lila-check-str
  tv1 kv1 kv2 table-get if exit then
  lila-value-drop
  tv1 s" __index" meta-method
  if
    meta-hold!
    meta-hold-tag lila-tag-fn = if
      tv1 tv2 ttag kv1 kv2 ktag meta-hold@ 2 lila-call lila-first exit
    then
    meta-hold-tag lila-tag-table = if
      meta-hold@ kv1 kv2 ktag recurse exit
    then
    s" lila: invalid __index metamethod" lila-raise-msg
  else
    lila-value-drop
  then
  0 0 lila-tag-nil ;

: lila-newindex { tv1 tv2 ttag kv1 kv2 ktag value1 value2 tag -- }
  ttag lila-check-table
  ktag lila-check-str
  tv1 kv1 kv2 table-get
  if
    lila-value-drop
    tv1 kv1 kv2 value1 value2 tag table-set exit
  then
  lila-value-drop
  tv1 s" __newindex" meta-method
  if
    meta-hold!
    meta-hold-tag lila-tag-fn = if
      tv1 tv2 ttag kv1 kv2 ktag value1 value2 tag meta-hold@
      3 lila-call lila-value-drop exit
    then
    meta-hold-tag lila-tag-table = if
      meta-hold@ kv1 kv2 ktag value1 value2 tag recurse exit
    then
    s" lila: invalid __newindex metamethod" lila-raise-msg
  else
    lila-value-drop
  then
  tv1 kv1 kv2 value1 value2 tag table-set ;

\ The compiler emits these names for t[k] and t[k] = v, so redefining them
\ here makes ordinary table access metatable-aware while table-get and
\ table-set above remain the raw primitives.
: lila-table-get  lila-index ;
: lila-table-set  lila-newindex ;

\ ---------------------------------------------------------------------------
\ __tostring

: meta-op-tostring { v1 v2 tag -- r1 r2 rt found }
  tag lila-tag-table = 0= if 0 0 lila-tag-nil false exit then
  v1 v2 tag s" __tostring" meta-find1 0= if
    0 0 lila-tag-nil false exit
  then
  v1 v2 tag meta-hold@ 1 lila-call lila-first
  dup lila-tag-str <> if
    lila-value-drop
    s" lila: __tostring must return a string" lila-raise-msg
  then
  true ;

' meta-op-tostring is lila-meta-tostring

\ ---------------------------------------------------------------------------
\ Native library functions

lila-value-allot lila-var-setmetatable  lila-var-setmetatable 3 lila-gc-register-root
lila-value-allot lila-var-getmetatable  lila-var-getmetatable 3 lila-gc-register-root
lila-value-allot lila-var-rawget        lila-var-rawget 3 lila-gc-register-root
lila-value-allot lila-var-rawset        lila-var-rawset 3 lila-gc-register-root
lila-value-allot lila-var-rawequal      lila-var-rawequal 3 lila-gc-register-root

: lila-bi-setmetatable { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { tv1 tv2 ttag }
  m1 m2 mt 1 lila-arg { mv1 mv2 mtag }
  ttag lila-check-table
  mtag lila-tag-nil = mtag lila-tag-table = or 0= if
    s" lila: setmetatable expects a table or nil" lila-raise-msg
  then
  mtag lila-tag-nil = if 0 else mv1 then tv1 table-metatable!
  tv1 tv2 ttag ;

: lila-bi-getmetatable { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { v1 v2 tag }
  tag lila-tag-table <> if 0 0 lila-tag-nil exit then
  v1 table-metatable@ dup 0= if drop 0 0 lila-tag-nil else 0 lila-tag-table then ;

: lila-bi-rawget { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { tv1 tv2 ttag }
  m1 m2 mt 1 lila-arg { k1 k2 kt }
  ttag lila-check-table
  kt lila-tag-str <> if 0 0 lila-tag-nil exit then
  tv1 k1 k2 table-get if exit then
  lila-value-drop
  0 0 lila-tag-nil ;

: lila-bi-rawset { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { tv1 tv2 ttag }
  m1 m2 mt 1 lila-arg { k1 k2 kt }
  m1 m2 mt 2 lila-arg { v1 v2 tag }
  ttag lila-check-table
  kt lila-check-str
  tv1 k1 k2 v1 v2 tag table-set
  tv1 tv2 ttag ;

: lila-bi-rawequal { env argc -- r1 r2 rt }
  argc lila-multi-pack { m1 m2 mt }
  m1 m2 mt 0 lila-arg { a1 a2 ta }
  m1 m2 mt 1 lila-arg { b1 b2 tb }
  ta tb <> if false lila>value-bool exit then
  ta lila-tag-nil = if true lila>value-bool exit then
  ta lila-tag-num = if
    a1 a2 lila-32 b1 b2 lila-32 = lila>value-bool exit
  then
  ta lila-tag-str = if a1 a2 b1 b2 compare 0= lila>value-bool exit then
  a1 b1 = lila>value-bool ;

: lila-meta-install ( -- )
  lila-var-setmetatable  ['] lila-bi-setmetatable  lila-native-set
  lila-var-getmetatable  ['] lila-bi-getmetatable  lila-native-set
  lila-var-rawget        ['] lila-bi-rawget        lila-native-set
  lila-var-rawset        ['] lila-bi-rawset        lila-native-set
  lila-var-rawequal      ['] lila-bi-rawequal      lila-native-set ;

lila-meta-install
