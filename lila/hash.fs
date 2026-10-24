\ LILA hash tables with string keys (c-addr u)
\ Table payload: [nbuckets][buckets*][count][value-kind] (4 cells)
\ Bucket array:  [slot ...] (4 cells per slot)
\ Slot layout:   [key-addr][key-len][value][occupied]
\ The value kind is 0 for numbers, 1 for strings, and 2 when not known yet.
\ Tables grow by doubling their bucket count at 3/4 load.

: hash-string ( c-addr u nbuckets -- idx )
  >r 0 -rot
  over + swap ?do i c@ + 31 * loop
  r> mod ;

: table-new { nbuckets -- table }
  4 cells 1 gc-alloc { table -- }
  nbuckets 4 * cells 2 gc-alloc { buckets -- }
  buckets nbuckets 4 * cells 0 fill
  nbuckets table !
  buckets table cell+ !
  0 table 2 cells + !
  2 table 3 cells + !
  table ;

: table-kind@ ( table -- kind )  3 cells + @ ;
: table-kind! ( table kind -- )  3 cells + ! ;
: table-count@ ( table -- n )  2 cells + @ ;

: slot-addr ( table idx -- addr )
  swap cell+ @  swap 4 * cells + ;

: slot-key-addr ( slot -- addr )  @ ;
: slot-key-len  ( slot -- u )     cell+ @ ;
: slot-value    ( slot -- x )     2 cells + @ ;
: slot-occupied ( slot -- flag )  3 cells + @ ;

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

: table-get { table key-addr key-len -- value flag }
  table key-addr key-len lila-table-find if
    slot-value true
  else
    drop 0 false
  then ;

: table-put-raw { table key-addr key-len value -- }
  table @ { n }
  key-addr key-len n hash-string { idx }
  begin
    table idx slot-addr
    dup slot-occupied 0= if
      key-addr over !
      key-len over cell+ !
      value over 2 cells + !
      1 over 3 cells + !
      drop exit
    then
    drop
    idx 1+ n mod to idx
  again ;

create table-grow-slot 0 ,
: table-grow { table -- }
  table @ { oldn }
  oldn 2* { newn }
  table cell+ @ { oldb }
  newn 4 * cells 2 gc-alloc { newb -- }
  newb newn 4 * cells 0 fill
  newn table !
  newb table cell+ !
  0 table 2 cells + !
  oldn 0 ?do
    i 4 * cells oldb + table-grow-slot !
    table-grow-slot @ slot-occupied if
      table
      table-grow-slot @ slot-key-addr @
      table-grow-slot @ slot-key-len @
      table-grow-slot @ slot-value
      table-put-raw
      table table-count@ 1+ table 2 cells + !
    then
  loop ;

: table-set { table key-addr key-len value -- }
  table key-addr key-len lila-table-find if
    value swap 2 cells + !
  else
    drop
    table table-count@ 4 *  table @ 3 * >= if table table-grow then
    table key-addr key-len value table-put-raw
    table table-count@ 1+ table 2 cells + !
  then ;

\ GC integration: mark the bucket array and every live slot.
: table-gc-scan { table -- }
  table cell+ @ gc-mark-cell
  table @ { n }
  n 0 ?do
    table i slot-addr
    dup slot-occupied if
      dup slot-key-addr @ gc-mark-cell
      slot-value gc-mark-cell
    else
      drop
    then
  loop ;
' table-gc-scan is gc-scan-table
