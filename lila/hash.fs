\ LILA hash tables with string keys (c-addr u)
\ Table layout: [nbuckets][buckets*]  (2 header cells)
\ Slot layout: [key-addr][key-len][value][occupied] (4 cells)

: hash-string ( c-addr u nbuckets -- idx )
  >r 0 -rot
  over + swap ?do i c@ + 31 * loop
  r> mod ;

: table-new ( nbuckets -- table )
  2 cells allocate throw
  >r
  dup r@ !
  4 * cells allocate throw
  r@ cell+ !
  r@ cell+ @  r@ @ 4 * cells  0 fill
  r> ;

: slot-addr ( table idx -- addr )
  swap cell+ @  swap 4 * cells + ;

: slot-key-addr ( slot -- addr )  @ ;
: slot-key-len  ( slot -- u )     cell+ @ ;
: slot-value    ( slot -- x )     2 cells + @ ;
: slot-occupied ( slot -- flag )  3 cells + @ ;

: key= { a1 u1 a2 u2 -- flag }
  u1 u2 <> if 0 exit then
  a1 u1 a2 u2 compare 0= ;

: table-get { table key-addr key-len -- value flag }
  table @ { n }
  key-addr key-len n hash-string { idx }
  n 0 ?do
    table idx slot-addr
    dup slot-occupied if
      dup slot-key-addr over slot-key-len
      key-addr key-len key= if
        slot-value true unloop exit
      then
      drop
    else
      drop 0 false unloop exit
    then
    idx 1+ n mod to idx
  loop
  0 false ;

: table-set { table key-addr key-len value -- }
  table @ { n }
  key-addr key-len n hash-string { idx }
  n 0 ?do
    table idx slot-addr
    dup slot-occupied if
      dup slot-key-addr over slot-key-len
      key-addr key-len key= if
        value swap 2 cells + !   \ update value
        unloop exit
      then
      drop
    else
      key-addr over !
      key-len over cell+ !
      value over 2 cells + !
      1 over 3 cells + !
      unloop exit
    then
    idx 1+ n mod to idx
  loop
  abort" lila: table full" ;
