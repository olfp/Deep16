\ screens/flash/essentials.fth - SPI/config flash and the directory/slice tools.
\ Loaded by name from the boot loader after start.

\ ---- SPI master: SD card CS0, config flash CS1 ----------------------------
\ New kernels expose the BDOS-backed spi-ctrl!/spi-xfer (functions 12/13,
\ BIOS f20..f22) and set the capability cell at DS 0xFFC0 on the PSRAM board
\ (the flat BSRAM image keeps the old 0x4D20 cell). An older boot image may
\ still be at 0x100000 while a newer slice image is written to 0x200000
\ (flash:slices), so define the same two words here when the kernel does not.
\ This keeps a slice-only update bootable instead of dying on the first line
\ with "undefined word: spi-ctrl!".
\ A top-level `if` does not skip interpreted source here, so install the
\ fallback from a colon word: it exits at run time on a kernel that has the
\ BDOS words, and otherwise defines them from strings.
: spi-install ( -- )
  0xFFC0 @ 0xD16C =  0x4D20 @ 0xD16C =  or if exit then
  s" 0x80 constant spi-ctrl  0x82 constant spi-stat  0x84 constant spi-data  0x86 constant spi-div" evaluate
  s" : spi-ctrl! ( control div -- ) spi-div es! spi-ctrl es! ;" evaluate
  s" : spi-xfer ( c -- c ) spi-data es! begin spi-stat es@ 1 and 0= until spi-data es@ 0xff and ;" evaluate ;
spi-install
variable spi-ctrl-val drop
variable spi-div-val drop
: spi-program ( -- ) spi-ctrl-val @ spi-div-val @ spi-ctrl! ;
: spi-div! ( n -- ) spi-div-val ! spi-program ;
: cs! ( f -- )      3 and spi-ctrl-val ! spi-program ;
: spi> ( c -- c )   0xff and spi-xfer 0xff and ;
: spi! ( c -- )     spi> drop ;

\ ---- config flash, SPI CS1 ------------------------------------------------
: cf-addr ( sector off -- )
  over 4 rshift 0xff and spi!
  over 0xf and 4 lshift
  over 8 rshift 0xf and or spi!
  0xff and spi! drop ;
: cf-wren ( -- )    0 spi-div! 2 cs! 6 spi! 0 cs! ;
: cf-status ( -- b ) 0 spi-div! 2 cs! 5 spi! 0xff spi> 0 cs! ;
: cf-wait ( -- )    begin cf-status 1 and 0= until ;
: cf-id ( -- )
  0 spi-div!  2 cs! 0x9f spi!  hex 0xff spi> . 0xff spi> . 0xff spi> .
  decimal 0 cs! cr ;
: cf-protect ( -- ) cf-wren  2 cs! 1 spi! 0x38 spi!  0 cs! cf-wait ;
: cf-unprotect ( -- ) cf-wren  2 cs! 1 spi! 0x00 spi!  0 cs! cf-wait ;

\ The console attribute cell: 0x8000 | text pair << 12 | style << 9. The editor
\ needs it without loading graphics, so it lives here with the console words.
0x3C1F constant text-attr

create dir-tmp 8 cells allot
variable add-n drop
variable sn-a drop
variable sn-l drop

\ ---- directory and slice editor ------------------------------------------
: slice-force ( -- ) slice-buf dup @ 0x7FFF and swap ! 0 slice-wp ! ;
: slice-create ( n t -- )
  swap slice swap 0x5000 or over !
  0xffff over 1 cells + !
  dup 2 cells + 6 0 fill  dup 8 cells + 2040 10 fill
  0 slice-wp ! drop ;
: slice-name! ( addr len -- )
  12 min dup sn-l ! drop sn-a !  6 0 do
    i 2* sn-l @ < if
      sn-a @ i 2* + c@
      i 2* 1+ sn-l @ < if sn-a @ i 2* 1+ + c@ 8 lshift or then
    else 0 then
    slice-buf 2 cells + i cells + !
  loop ;
: slice-flush ( -- )
  slice-wp @ if ." slice: write protected" cr exit then
  slice-buf slice-sec @ 2048 slice-write
  0< if ." slice: write failed" cr else ." slice written" cr then ;
: .name ( a -- )
  2 cells + 6 0 do
    dup i cells + @  ( a c )
    dup 0xff and dup 32 127 within if emit else drop then
    8 rshift dup 32 127 within if emit else drop then
  loop drop ;
: dir ( -- )
  cr ." type slice  name" cr
  0 slice 255 0 do
    dup i 8 * cells +  ( a e )
    dup 1 cells + @ dup 0xffff <> if
      ."   " over @ 0xff and 4 u.r  ."  " dup 5 u.r  ."  " over .name cr
    then 2drop
  loop drop ;
: find ( addr len -- n ) slice-find ;
: dir-add ( n -- )
  dup add-n ! slice  8 0 do dup i cells + @ dir-tmp i cells + ! loop drop
  0 slice slice-force 255 0 do
    dup i 8 * cells +  ( a e )
    dup 1 cells + @ 0xffff = if
      dir-tmp over 8 move
      dir-tmp @ 0x0fff and over !
      add-n @ over 1 cells + !
      2drop slice-flush unloop exit
    then 2drop
  loop drop ;
: dir-remove ( n -- )
  0 slice slice-force 255 0 do
    dup i 8 * cells +  ( n a e )
    dup 1 cells + @ 3 pick = if
      dup 8 cells 0 fill 2drop drop slice-flush unloop exit
    then 2drop
  loop drop ;
: slice-alloc ( -- n )
  512 1 do i slice
    dup @ 0xffff = if drop i unloop exit then
    slice-valid? 0= if i unloop exit then
  loop 0 ;
: unpack ( src dst u -- )
  0 do
    over i cells + @
    dup 0xff and 2 pick i 2* cells + c!
    8 rshift 0xff and 1 pick i 2* 1+ cells + c!
  loop 2drop ;
\ A packed slice carries two characters per cell, so one slice holds twice the
\ text a TEXT slice does - but the loader takes one half at a time, and a
\ definition cannot span the two calls.  The unpacked half needs a buffer of
\ its own: the source is no longer copied into a text-buf.  `included` reads
\ that buffer a line at a time, so the load ends the line, as it always did.
\
\ The buffer is taken from the dictionary the first time a packed slice is
\ loaded.  A board that never loads one does not pay for it, and a board
\ that does pays for it once.
create p-buf 0 ,
: p-screen ( n which -- )
  dup 0 2 within 0= if ." p-screen: 0 or 1" cr 2drop exit then
  p-buf @ 0= if here p-buf ! 2040 cells allot then
  swap slice 8 cells + swap 1020 cells * +
  p-buf @ 1020 unpack p-buf @ 2040 included ;
