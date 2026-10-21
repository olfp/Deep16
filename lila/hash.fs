\ LILA hash tables with string keys (c-addr u)
\ Table layout: [nbuckets][buckets*]  (2 header cells)
\ Slot layout: [key-addr][key-len][value][occupied] (4 cells)

: hash-string ( c-addr u nbuckets -- idx )
  >r 0 -rot
  over + swap do i c@ + 31 * loop
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
  table @  ( nbuckets )
  key-addr key-len table @ hash-string  ( idx )
  begin
    dup table @ < while
    table swap slot-addr  ( idx slot )
    dup slot-occupied if
      dup slot-key-addr over slot-key-len
      key-addr key-len key= if
        slot-value swap drop true exit
      then
    else
      2drop 0 false exit
    then
    drop
    1+ table @ mod
  repeat
  2drop 0 false ;

: table-set { table key-addr key-len value -- }
  table @
  key-addr key-len table @ hash-string
  begin
    dup table @ < while
    table swap slot-addr
    dup slot-occupied if
      dup slot-key-addr over slot-key-len
      key-addr key-len key= if
        value swap 2 cells + !   \ update value
        drop exit
      then
      drop
    else
      key-addr over !
      key-len over cell+ !
      value over 2 cells + !
      1 over 3 cells + !
      2drop exit
    then
    1+ table @ mod
  repeat
  2drop ;
