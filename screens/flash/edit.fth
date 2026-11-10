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

\ ---- serial port (0xF0040/42), separate from the console ------------------
0x40 constant serial-status
0x42 constant serial-data

: serial-emit ( c -- )
  begin serial-status es@ 2 and until
  serial-data es! ;
: serial-ready? ( -- f ) serial-status es@ 1 and 0<> ;
: serial-key ( -- c )
  begin serial-status es@ 1 and until
  serial-data es@ 0xff and ;

\ Ctrl-D ends the session. Typed bytes go to the serial stream only.
0x64 constant echo-flag
: mirror-on ( -- )  echo-flag es@ 0x80 or echo-flag es! ;
: mirror-off ( -- ) echo-flag es@ 0x7f and echo-flag es! ;
create serial-buf 128 allot
variable serial-len drop
variable serial-echo drop

: serial-crlf ( -- ) 13 serial-emit 10 serial-emit ;

: serial-eval ( -- )
  echo-flag es@ serial-echo !
  echo-flag es@ 0x80 or echo-flag es!
  serial-buf serial-len @
  ['] evaluate catch ?dup if
    ." serial: error " . cr
    2drop
  then
  serial-echo @ echo-flag es! ;

: serial ( -- )
  ." serial: interpreted, Ctrl-D exits" cr
  0 serial-len !
  begin
    serial-key
    dup 0x04 = if drop exit then
    dup 0x0d = over 0x0a = or if
      drop
      serial-crlf
      serial-eval
      0 serial-len !
    else
      dup 0x08 = over 0x7f = or if
        drop
        serial-len @ if
          8 serial-emit 32 serial-emit 8 serial-emit
          serial-len @ 1- serial-len !
        then
      else
        dup 32 127 within if
          dup serial-emit
          serial-len @ 128 < if
            serial-buf serial-len @ + c!
            serial-len @ 1+ serial-len !
          else
            drop
          then
        else
          drop
        then
      then
    then
  again ;

\ ---- XMODEM receive with CRC, run the source directly --------------------
0x01 constant soh
0x04 constant eot
0x06 constant ack
0x15 constant nak
0x43 constant crc-req

variable x-buf drop
variable x-len drop
variable x-blk drop
variable x-run drop
variable x-wait drop
variable x-started drop
variable x-pblk drop
variable x-pnblk drop
variable x-pcrc drop
variable x-max drop

\ XMODEM CRC-16 (poly 0x1021, initial 0), high byte first on the wire.
: crc-byte ( crc b -- crc )
  8 lshift xor
  8 0 do
    dup 0x8000 and if 1 lshift 0x1021 xor else 1 lshift then
  loop 0xffff and ;

: crc-block ( addr len -- crc )
  0 x-run !
  0 do
    dup i + c@ x-run @ swap crc-byte x-run !
  loop drop x-run @ ;

: x-ack ( -- ) ack serial-emit ;
: x-nak ( -- ) nak serial-emit ;

\ Wait for the next SOH or EOT. 0 means the sender has been quiet long enough
\ for the receiver to send another 'C'.
: x-wait-soh ( -- c )
  0 x-wait !
  begin
    serial-ready? if
      serial-key
      dup soh = if exit then
      dup eot = if exit then
      drop
    then
    1 x-wait +!
    x-wait @ 20000 > if 0 exit then
  again ;

\ One 128-byte block after the SOH: blk, ~blk, data, CRC high, CRC low.
: x-block ( -- )
  serial-key x-pblk !
  serial-key x-pnblk !
  x-len @ 128 + x-max @ > if
    ." xmodem: too big" cr x-nak exit
  then
  128 0 do
    serial-key
    x-buf @ x-len @ + i + c!
  loop
  serial-key 8 lshift serial-key or x-pcrc !
  x-buf @ x-len @ + 128 crc-block
  x-pcrc @ <> if x-nak exit then
  x-pblk @ x-pnblk @ + 0xff <> if x-nak exit then
  x-pblk @ x-blk @ = if
    x-len @ 128 + x-len !
    x-blk @ 1+ 0xff and x-blk !
    x-ack
  else
    x-pblk @ x-blk @ 1- 0xff and = if x-ack else x-nak then
  then ;

\ XMODEM pads the last block with SUB (0x1A); drop that and any NULs so the
\ interpreter does not see them as tokens.
: x-trim ( -- )
  begin
    x-len @ 0> if
      x-buf @ x-len @ 1- + c@
      dup 0x1a = swap 0 = or
    else false then
  while
    x-len @ 1- x-len !
  repeat ;

\ Receive a Forth source file into the free dictionary space above `here`,
\ move `here` past it, then `included` it. The serial stream is binary; progress
\ is printed on the DVI console only.
: xmodem ( -- )
  ." xmodem: receiving (CRC)" cr
  here x-buf !
  0 x-len !
  1 x-blk !
  0 x-started !
  unused 1024 - x-max !
  begin
    x-started @ 0= if crc-req serial-emit then
    x-wait-soh
    dup soh = if
      drop x-block 1 x-started ! false
    else dup eot = if
      drop x-ack true
    else
      drop 0 x-started ! false
    then then
  until
  x-trim
  x-len @ allot
  ." xmodem: " x-len @ . ." bytes" cr
  x-buf @ x-len @ included ;
