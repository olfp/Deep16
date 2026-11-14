\ LILA hash tables with arbitrary non-nil keys
\ Table header: [nbuckets][buckets*][count][metatable*] (4 cells)
\ Bucket array:  [slot ...] (7 cells per slot)
\ Slot layout:   [key1][key2][keytag][value1][value2][valuetag][occupied]
\ Keys are full three-cell LILA values.  Strings are hashed by bytes, numbers by
\ their 32-bit payload, and booleans, tables and functions by their payload.
\ Tables grow by doubling their bucket count at 3/4 load.  There is no fixed
\ element limit.

7 constant table-slot-cells
4 constant table-header-cells
16 constant table-initial-buckets

: hash-string ( c-addr u nbuckets -- idx )
  >r 0 -rot
  over + swap ?do i c@ + 31 * loop
  r> mod ;

\ Hash any key value.  A nil key is rejected by table-set before it gets here.
: hash-key { k1 k2 kt nbuckets -- idx }
  kt lila-tag-str = if k1 k2 nbuckets hash-string exit then
  kt lila-tag-num = if
    k1 k2 lila-32 dup 0< if negate then nbuckets mod exit
  then
  kt lila-tag-nil = if 0 exit then
  k1 nbuckets mod ;

: table-new { nbuckets -- table }
  nbuckets table-initial-buckets max to nbuckets
  table-header-cells cells 1 gc-alloc { table -- }
  nbuckets table-slot-cells * cells 2 gc-alloc { buckets -- }
  buckets nbuckets table-slot-cells * cells 0 fill
  nbuckets table !
  buckets table cell+ !
  0 table 2 cells + !
  0 table 3 cells + !
  table ;

: table-count@ ( table -- n )  2 cells + @ ;

: table-metatable@ ( table -- mt )  3 cells + @ ;
: table-metatable! ( mt table -- )  3 cells + ! ;

: slot-addr ( table idx -- addr )
  swap cell+ @  swap table-slot-cells * cells + ;

: slot-key-addr ( slot -- addr )  ;
: slot-value-addr ( slot -- addr )  3 cells + ;
: slot-occupied ( slot -- flag )  6 cells + @ ;
: slot-key@ ( slot -- k1 k2 kt )  slot-key-addr lila-value@ ;
: slot-value@ ( slot -- v1 v2 vt )  slot-value-addr lila-value@ ;
: slot-key! ( k1 k2 kt slot -- )  slot-key-addr lila-value! ;
: slot-value! ( v1 v2 tag slot -- )  slot-value-addr lila-value! ;

\ Raw equality, used for keys and by rawequal.  nil is never a key but is
\ included so the predicate is total.
: key= { a1 a2 at b1 b2 bt -- flag }
  at bt <> if false exit then
  at lila-tag-num = if
    a1 a2 lila-32 b1 b2 lila-32 = exit
  then
  at lila-tag-str = if
    a1 a2 b1 b2 compare 0= exit
  then
  at lila-tag-bool = if a1 b1 = exit then
  at lila-tag-nil = if true exit then
  a1 b1 = ;

: lila-check-key { k1 k2 kt -- }
  kt lila-tag-nil = if s" lila: table index is nil" lila-raise-msg then ;

: lila-table-find { table k1 k2 kt -- slot flag }
  table @ { n }
  k1 k2 kt n hash-key { idx }
  n 0 ?do
    table idx slot-addr
    dup slot-occupied if
      dup slot-key@
      k1 k2 kt key= if
        true unloop exit
      then
      drop
    else
      drop 0 false unloop exit
    then
    idx 1+ n mod to idx
  loop
  0 false ;

: table-get { table k1 k2 kt -- value1 value2 tag found }
  table k1 k2 kt lila-table-find if
    slot-value@ true
  else
    drop
    0 0 lila-tag-nil false
  then ;

: table-put-raw { table k1 k2 kt v1 v2 vt -- }
  table @ { n }
  k1 k2 kt n hash-key { idx }
  begin
    table idx slot-addr
    dup slot-occupied 0= if
      dup >r
      k1 k2 kt r@ slot-key!
      v1 v2 vt r@ slot-value!
      1 r> 6 cells + !
      drop
      exit
    then
    drop
    idx 1+ n mod to idx
  again ;

create table-grow-slot 0 ,
: table-grow { table -- }
  table @ { oldn }
  oldn 2* { newn }
  table cell+ @ { oldb }
  newn table-slot-cells * cells 2 gc-alloc { newb -- }
  newb newn table-slot-cells * cells 0 fill
  newn table !
  newb table cell+ !
  0 table 2 cells + !
  oldn 0 ?do
    i table-slot-cells * cells oldb + table-grow-slot !
    table-grow-slot @ slot-occupied if
      table
      table-grow-slot @ slot-key@
      table-grow-slot @ slot-value@
      table-put-raw
      table table-count@ 1+ table 2 cells + !
    then
  loop ;

\ Rebuild the bucket array without SLOT.  Removing an entry from an
\ open-addressed table would break probe chains, so the remaining entries are
\ reinserted into a fresh array of the same size.
: table-delete-slot { table slot -- }
  table @ { n }
  table cell+ @ { oldb }
  n table-slot-cells * cells 2 gc-alloc { newb -- }
  newb n table-slot-cells * cells 0 fill
  newb table cell+ !
  0 table 2 cells + !
  n 0 ?do
    oldb i table-slot-cells * cells + { cur -- }
    cur slot-occupied if
      cur slot <> if
        table cur slot-key@ cur slot-value@ table-put-raw
        table table-count@ 1+ table 2 cells + !
      then
    then
  loop ;

: table-delete { table k1 k2 kt -- }
  table k1 k2 kt lila-table-find if
    table swap table-delete-slot
  else
    drop
  then ;

: table-set { table k1 k2 kt v1 v2 vt -- }
  k1 k2 kt lila-check-key
  \ Assigning nil removes the key, matching Lua.
  vt lila-tag-nil = if
    table k1 k2 kt table-delete exit
  then
  table k1 k2 kt lila-table-find if
    v1 v2 vt 3 roll slot-value!
  else
    drop
    table table-count@ 4 *  table @ 3 * >= if table table-grow then
    table k1 k2 kt v1 v2 vt table-put-raw
    table table-count@ 1+ table 2 cells + !
  then ;

\ Sequence border: the largest n such that 1..n are present and non-nil.
\ This is O(n) in the border length; Lua's binary search is not required for
\ the prototype.
: table-border { table -- n }
  0 { n }
  begin
    n 1+ { k }
    table k lila>value-num table-get
    if
      dup lila-tag-nil <>
    else
      false
    then
  while
    lila-value-drop
    1 n + to n
  repeat
  lila-value-drop
  n ;

\ Locate an existing key's bucket index.  Used by next/2.
: table-slot-index { table k1 k2 kt -- idx found }
  table @ { n }
  n 0 ?do
    table i slot-addr
    dup slot-occupied if
      dup slot-key@
      k1 k2 kt key= if
        drop i true unloop exit
      then
      drop
    else
      drop
    then
  loop
  0 false ;

\ Iterate raw slots from START, skipping empty slots and nil-valued entries.
: table-next-from { table start -- nk1 nk2 nkt nv1 nv2 nvt found }
  begin
    start table @ <
  while
    table start slot-addr
    dup slot-occupied if
      >r
      r@ slot-key@
      r@ slot-value@
      dup lila-tag-nil <> if
        r> drop
        true exit
      then
      lila-value-drop
      lila-value-drop
      r> drop
    else
      drop
    then
    1 start + to start
  repeat
  0 0 lila-tag-nil 0 0 lila-tag-nil false ;

\ next(t, key) scan: a nil key starts at the first bucket, any other key must
\ already be in the table.
: table-next { table k1 k2 kt -- nk1 nk2 nkt nv1 nv2 nvt found }
  kt lila-tag-nil = if
    table 0 table-next-from
  else
    table k1 k2 kt table-slot-index
    0= if s" lila: invalid key to next" lila-raise-msg then
    table swap 1+ table-next-from
  then ;

\ Tagged table operations used by the compiler.  Keys are full LILA values;
\ values are full three-cell LILA values.
: lila-table-new ( -- value1 value2 tag )
  table-initial-buckets table-new 0 lila-tag-table ;

: lila-table-get { tv1 tv2 ttag kv1 kv2 ktag -- value1 value2 tag }
  ttag lila-check-table
  kv1 kv2 ktag lila-check-key
  tv1 kv1 kv2 ktag table-get
  if exit then
  lila-value-drop
  0 0 lila-tag-nil ;

: lila-table-set { tv1 tv2 ttag kv1 kv2 ktag value1 value2 tag -- }
  ttag lila-check-table
  kv1 kv2 ktag lila-check-key
  tv1 kv1 kv2 ktag value1 value2 tag table-set ;

\ GC integration: mark the bucket array, the metatable, and every occupied
\ slot's key and value.  Marking tags is harmless.
: table-gc-scan { table -- }
  table cell+ @ gc-mark-cell
  table table-metatable@ gc-mark-cell
  table @ { n }
  n 0 ?do
    table i slot-addr
    dup slot-occupied if
      slot-key-addr
      6 0 ?do
        dup i cells + @ gc-mark-cell
      loop
      drop
    else
      drop
    then
  loop ;
' table-gc-scan is gc-scan-table

' table-border is lila-table-length
