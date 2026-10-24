\ LILA garbage collector
\ ----------------------
\ Heap strings, table headers, and table bucket arrays are GC objects.  Objects
\ are linked through their headers and reclaimed by a conservative mark-sweep
\ pass.  Collection happens between compiled statements, so the roots are the
\ registered LILA variable cells, live table slots, and the data stack.
\
\ Object header (4 cells): [next][size][mark][type]
\ Payload starts after the header.
\ Types: 0 = string, 1 = table, 2 = table bucket array.

: lila-error ( c-addr u -- )  cr type cr abort ;

4 constant gc-header-cells
: gc-header-bytes ( -- n )  gc-header-cells cells ;
: gc-payload ( header -- payload )  gc-header-bytes + ;
: gc-size@ ( header -- bytes )  cell+ @ ;
: gc-mark@ ( header -- n )  2 cells + @ ;
: gc-mark! ( n header -- )  2 cells + ! ;
: gc-type@ ( header -- type )  3 cells + @ ;
: gc-next@ ( header -- next )  @ ;
: gc-size-of ( payload -- bytes )  gc-header-bytes - cell+ @ ;

create gc-objects 0 ,
create gc-since 0 ,
create gc-bytes 0 ,

\ Static roots: (address, cell count) pairs.  A root cell may hold a payload
\ pointer to any GC object.
create gc-roots 8192 cells allot
create gc-root-cells 8192 allot
create gc-root-count 0 ,

: lila-gc-register-root ( addr cells -- )
  dup 1 3 within 0= if s" lila: bad GC root size" lila-error then
  gc-root-count @ 8192 >= if s" lila: too many GC roots" lila-error then
  over gc-root-count @ cells gc-roots + !
  gc-root-count @ gc-root-cells + c!
  drop
  1 gc-root-count +! ;

create gc-new 0 ,
: gc-alloc { bytes type -- payload }
  bytes 0< if s" lila: negative GC allocation" lila-error then
  bytes gc-header-bytes + allocate throw gc-new !
  gc-new @ dup gc-objects @ swap !
  gc-new @ gc-objects !
  bytes gc-new @ cell+ !
  0 gc-new @ 2 cells + !
  type gc-new @ 3 cells + !
  bytes gc-since +!
  bytes gc-bytes +!
  gc-new @ gc-payload ;

: gc-mark-cell { x -- }
  x 0= if exit then
  x
  gc-objects @ { obj }
  begin obj while
    x obj >= if
      x obj obj gc-size@ gc-header-bytes + + < if
        obj gc-mark@ 0= if 1 obj gc-mark! then
        drop exit
      then
    then
    obj gc-next@ to obj
  repeat
  drop ;

create gc-root-addr 0 ,
: gc-mark-roots ( -- )
  gc-root-count @ 0 ?do
    gc-roots i cells + @ gc-root-addr !
    gc-root-addr @ @ gc-mark-cell
    gc-root-cells i + c@ 2 = if
      gc-root-addr @ cell+ @ gc-mark-cell
    then
  loop ;

create gc-sp 0 ,
: gc-scan-stack ( -- )
  sp@ gc-sp !
  depth 0 ?do
    gc-sp @ i cells + @ gc-mark-cell
  loop ;

\ Tables are scanned when marked.  hash.fs installs the scanner.
defer gc-scan-table ( table -- )

create gc-changed 0 ,
create gc-cur 0 ,
: gc-table-object? ( header -- flag )  gc-type@ 1 = ;
: gc-scan-table-pass ( -- flag )
  0 gc-changed !
  gc-objects @ gc-cur !
  begin gc-cur @ while
    gc-cur @ gc-table-object? if
      gc-cur @ gc-mark@ 1 = if
        2 gc-cur @ gc-mark!
        gc-cur @ gc-payload gc-scan-table
        -1 gc-changed !
      then
    then
    gc-cur @ gc-next@ gc-cur !
  repeat
  gc-changed @ ;
: gc-scan-table-graph ( -- )
  begin gc-scan-table-pass 0= until ;

create gc-prev 0 ,
create gc-next 0 ,
: gc-sweep ( -- )
  0 gc-prev !
  gc-objects @ gc-cur !
  begin gc-cur @ while
    gc-cur @ gc-next@ gc-next !
    gc-cur @ gc-mark@ 0= if
      gc-prev @ if
        gc-next @ gc-prev @ !
      else
        gc-next @ gc-objects !
      then
      gc-cur @ gc-size@ negate gc-bytes +!
      gc-cur @ gc-free throw
    else
      gc-cur @ gc-prev !
    then
    gc-next @ gc-cur !
  repeat ;

: gc-collect ( -- )
  ." <GC> "
  0 gc-since !
  gc-objects @ gc-cur !
  begin gc-cur @ while
    0 gc-cur @ 2 cells + !
    gc-cur @ gc-next@ gc-cur !
  repeat
  gc-mark-roots
  gc-scan-stack
  gc-scan-table-graph
  gc-sweep ;

: gc-maybe ( -- )
  gc-since @ 65536 >= if gc-collect then ;

: lila-gc-maybe ( -- )  gc-maybe ;

: gc-object-count ( -- n )
  0 gc-objects @
  begin dup while
    swap 1+ swap gc-next@
  repeat drop ;
