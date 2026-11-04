\ LILA hash tables with string keys (c-addr u)
\ Table header: [nbuckets][buckets*][count] (3 cells)
\ Bucket array:  [slot ...] (6 cells per slot)
\ Slot layout:   [key-addr][key-len][value1][value2][tag][occupied]
\ Tables grow by doubling their bucket count at 3/4 load.  There is no fixed
\ element limit.

6 constant table-slot-cells
3 constant table-header-cells
16 constant table-initial-buckets

: hash-string ( c-addr u nbuckets -- idx )
  >r 0 -rot
  over + swap ?do i c@ + 31 * loop
  r> mod ;

: table-new { nbuckets -- table }
  nbuckets table-initial-buckets max to nbuckets
  table-header-cells cells 1 gc-alloc { table -- }
  nbuckets table-slot-cells * cells 2 gc-alloc { buckets -- }
  buckets nbuckets table-slot-cells * cells 0 fill
  nbuckets table !
  buckets table cell+ !
  0 table 2 cells + !
  table ;

: table-count@ ( table -- n )  2 cells + @ ;

: slot-addr ( table idx -- addr )
  swap cell+ @  swap table-slot-cells * cells + ;

: slot-key-addr ( slot -- addr )  @ ;
: slot-key-len  ( slot -- u )     cell+ @ ;
: slot-value-addr ( slot -- addr )  2 cells + ;
: slot-occupied ( slot -- flag )  5 cells + @ ;
: slot-value! { v1 v2 tag slot -- }
  v1 v2 tag slot slot-value-addr lila-value! ;

: key= { a1 u1 a2 u2 -- flag }
  u1 u2 <> if 0 exit then
  a1 u1 a2 u2 compare 0= ;

: lila-table-find { table key-addr key-len -- slot flag }
  table @ { n }
  key-addr key-len n hash-string { idx }
  n 0 ?do
    table idx slot-addr
    dup slot-occupied if
      dup slot-key-addr over slot-key-len
      key-addr key-len key= if
        true unloop exit
      then
      drop
    else
      drop 0 false unloop exit
    then
    idx 1+ n mod to idx
  loop
  0 false ;

: table-get { table key-addr key-len -- value1 value2 tag found }
  table key-addr key-len lila-table-find if
    slot-value-addr lila-value@ true
  else
    drop
    0 0 lila-tag-nil false
  then ;

: table-put-raw { table key-addr key-len value1 value2 tag -- }
  table @ { n }
  key-addr key-len n hash-string { idx }
  begin
    table idx slot-addr
    dup slot-occupied 0= if
      key-addr over !
      key-len over cell+ !
      dup >r
      value1 value2 tag r@ slot-value!
      1 r> 5 cells + !
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
      table-grow-slot @ slot-key-addr
      table-grow-slot @ slot-key-len
      table-grow-slot @ slot-value-addr lila-value@
      table-put-raw
      table table-count@ 1+ table 2 cells + !
    then
  loop ;

: table-set { table key-addr key-len value1 value2 tag -- }
  table key-addr key-len lila-table-find if
    value1 value2 tag 3 roll slot-value!
  else
    drop
    table table-count@ 4 *  table @ 3 * >= if table table-grow then
    table key-addr key-len value1 value2 tag table-put-raw
    table table-count@ 1+ table 2 cells + !
  then ;

\ Tagged table operations used by the compiler.  Keys remain plain strings;
\ values are full three-cell LILA values.
: lila-table-new ( -- value1 value2 tag )
  table-initial-buckets table-new 0 lila-tag-table ;

: lila-table-get { tv1 tv2 ttag kv1 kv2 ktag -- value1 value2 tag }
  ttag lila-check-table
  ktag lila-check-str
  tv1 kv1 kv2 table-get
  if exit then
  lila-value-drop
  0 0 lila-tag-nil ;

: lila-table-set { tv1 tv2 ttag kv1 kv2 ktag value1 value2 tag -- }
  ttag lila-check-table
  ktag lila-check-str
  tv1 kv1 kv2 value1 value2 tag table-set ;

\ GC integration: mark the bucket array, every key, and both value payloads.
: table-gc-scan { table -- }
  table cell+ @ gc-mark-cell
  table @ { n }
  n 0 ?do
    table i slot-addr
    dup slot-occupied if
      dup slot-key-addr gc-mark-cell
      slot-value-addr lila-value@
      gc-mark-cell
      gc-mark-cell
      gc-mark-cell
    else
      drop
    then
  loop ;
' table-gc-scan is gc-scan-table
