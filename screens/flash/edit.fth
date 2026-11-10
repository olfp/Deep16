\ screens/flash/edit.fth - slice text inspector and 24x80 editor.
\
\ Loaded after the catalog and the games (`21 screen` in the boot script).
\ type-slice prints a slice's printable payload; edit-slice edits the first
\ 1920 cells (24 lines of 80) in slice-buf and writes the whole 4 KB sector
\ back with slice-flush.
\
\ Keys: the PS/2 arrows/Home/End produce C-B/C-F/C-P/C-N/C-A/C-E (see the
\ German map), Backspace/DEL delete, printable keys overwrite. C-X C-S saves
\ and exits; C-X C-C exits without writing the sector.

1920 constant edit-len
80 constant edit-w
24 constant edit-h

variable edit-pos drop
variable edit-done drop

\ decimal without a trailing space, for the ANSI CUP parameters
: .dec ( u -- ) 0 <# #s #> type ;
: at-xy ( col row -- )
  0x1b emit 0x5b emit
  1+ .dec 0x3b emit 1+ .dec 0x48 emit ;
: edit-clear ( -- )
  0x1b emit 0x5b emit 0x32 emit 0x4a emit ;

: edit-buf ( -- a ) slice-buf 8 cells + ;
: edit-col ( -- c ) edit-pos @ edit-w mod ;
: edit-row ( -- r ) edit-pos @ edit-w / ;
: edit-cursor ( -- ) edit-col edit-row at-xy ;

\ A LF (or any other control) in the buffer shows as a space, so a source
\ slice's LF padding cannot break the 24x80 grid.
: edit-cell ( c -- )
  dup 32 127 within if emit else drop 32 emit then ;

: edit-draw ( -- )
  edit-clear
  edit-h 0 do
    0 i at-xy
    edit-buf i edit-w * +
    edit-w 0 do dup i + c@ edit-cell loop
    drop
  loop
  edit-cursor ;

: edit-left ( -- )
  edit-pos @ 0= if exit then
  edit-pos @ 1- edit-pos ! ;
: edit-right ( -- )
  edit-pos @ edit-len 1- < if edit-pos @ 1+ edit-pos ! then ;
: edit-up ( -- )
  edit-pos @ edit-w < if exit then
  edit-pos @ edit-w - edit-pos ! ;
: edit-down ( -- )
  edit-pos @ edit-len edit-w - < if edit-pos @ edit-w + edit-pos ! then ;
: edit-bol ( -- ) edit-pos @ edit-w / edit-w * edit-pos ! ;
: edit-eol ( -- ) edit-pos @ edit-w / edit-w * edit-w 1- + edit-pos ! ;
: edit-nl ( -- )
  edit-pos @ edit-w / 1+ edit-w *  ( next line, column 1 )
  dup edit-len < if edit-pos ! else drop then ;

: edit-put ( c -- )
  dup edit-buf edit-pos @ + c!
  emit
  edit-right
  edit-cursor ;
: edit-bs ( -- )
  edit-pos @ 0= if exit then
  edit-pos @ 1- edit-pos !
  edit-buf edit-pos @ + 32 swap c!
  32 emit
  edit-cursor ;

: edit-x ( -- )
  key
  dup 0x13 = if drop 1 edit-done ! exit then
  dup 0x03 = if drop 2 edit-done ! exit then
  drop ;

: edit-key ( c -- )
  dup 0x18 = if drop edit-x exit then
  dup 0x02 = if drop edit-left edit-cursor exit then
  dup 0x06 = if drop edit-right edit-cursor exit then
  dup 0x10 = if drop edit-up edit-cursor exit then
  dup 0x0e = if drop edit-down edit-cursor exit then
  dup 0x01 = if drop edit-bol edit-cursor exit then
  dup 0x05 = if drop edit-eol edit-cursor exit then
  dup 0x0d = if drop edit-nl edit-cursor exit then
  dup 0x0a = if drop edit-nl edit-cursor exit then
  dup 0x08 = if drop edit-bs exit then
  dup 0x7f = if drop edit-bs exit then
  dup 32 127 within if edit-put exit then
  drop ;

: edit-slice ( n -- )
  dup 0 511 within 0= if ." edit-slice: 0..511" cr drop exit then
  slice dup slice-valid? 0= if
    drop ." edit-slice: no slice" cr exit
  then drop
  0 edit-done ! 0 edit-pos !
  edit-draw
  begin key edit-key edit-done @ until
  edit-clear 0 0 at-xy
  edit-done @ 1 = if slice-flush else ." discarded" cr then ;

\ The last non-LF cell, so a source slice's LF padding does not print as
\ thousands of blank lines. An all-LF payload answers 0.
: slice-last ( a -- n )
  2040
  begin
    dup 0= if nip exit then
    1-
    2dup + c@ 10 =
  while repeat
  1+ nip ;

: type-slice ( n -- )
  dup 0 511 within 0= if ." type-slice: 0..511" cr drop exit then
  slice dup slice-valid? 0= if
    drop ." type-slice: no slice" cr exit
  then
  8 cells + dup slice-last
  0 do
    dup i + c@
    dup 32 127 within if emit
    else dup 10 = if cr then drop
    then
  loop drop ;
