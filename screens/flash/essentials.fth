\ screens/flash/essentials.fth - SPI/config flash and the directory/slice tools.
\ Loaded by name from the boot loader after start.

\ ---- SPI master (0xF0080): SD card CS0, config flash CS1 ------------------
0x80 constant spi-ctrl
0x82 constant spi-stat
0x84 constant spi-data
0x86 constant spi-div
: cs! ( f -- )      3 and spi-ctrl es! ;
: spi> ( c -- c )   spi-data es! begin spi-stat es@ 1 and 0= until
                    spi-data es@ 0xff and ;
: spi! ( c -- )     spi> drop ;

\ ---- config flash, SPI CS1 ------------------------------------------------
: cf-addr ( sector off -- )
  over 4 rshift 0xff and spi!
  over 0xf and 4 lshift
  over 8 rshift 0xf and or spi!
  0xff and spi! drop ;
: cf-wren ( -- )    0 spi-div es! 2 cs! 6 spi! 0 cs! ;
: cf-status ( -- b ) 0 spi-div es! 2 cs! 5 spi! 0xff spi> 0 cs! ;
: cf-wait ( -- )    begin cf-status 1 and 0= until ;
: cf-id ( -- )
  0 spi-div es!  2 cs! 0x9f spi!  hex 0xff spi> . 0xff spi> . 0xff spi> .
  decimal 0 cs! cr ;
: cf-protect ( -- ) cf-wren  2 cs! 1 spi! 0x38 spi!  0 cs! cf-wait ;
: cf-unprotect ( -- ) cf-wren  2 cs! 1 spi! 0x00 spi!  0 cs! cf-wait ;
: cf-erase ( sector -- ) cf-wren 2 cs! 0x20 spi! 0 cf-addr 0 cs! cf-wait ;

\ The console attribute cell: 0x8000 | text pair << 12. The editor needs it
\ without loading graphics, so it lives here with the console-adjacent words.
0x3C1F constant text-attr

create dir-tmp 8 cells allot
variable add-n drop
variable sn-a drop
variable sn-l drop

: cf-page ( sector cell -- )
  cf-wren  2 cs! 2 spi!  swap over 2* cf-addr
  slice-buf swap cells +  128 0 do
    dup @ dup 0xff and spi!  8 rshift 0xff and spi!  cell+
  loop drop 0 cs! cf-wait ;

\ ---- directory and slice editor ------------------------------------------
: slice-force ( -- ) 0 slice-wp ! ;
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
  slice-sec @ 512 + cf-erase
  16 0 do slice-sec @ 512 + i 128 * cf-page loop
  ." slice written" cr ;
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
: p-screen ( n which -- )
  dup 0 2 within 0= if ." p-screen: 0 or 1" cr 2drop exit then
  swap slice 8 cells + swap 1020 cells * +
  text-buf 1020 unpack text-buf 2040 included ;
