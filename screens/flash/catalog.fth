\ screens/flash/catalog.fth - the slice editor/catalog, loaded with 5 screen.
\ The boot script provides slice, slice-buf, text-buf, slice-sec, slice-wp,
\ cf-addr, cf-wren, cf-status, cf-wait, cf-erase, spi>, cs!, es! and screen.

create dir-tmp 8 cells allot
variable find-a drop
variable find-l drop
variable add-n drop
variable sn-a drop
variable sn-l drop
variable nm-a drop
variable nm-l drop

: cf-page ( sector cell -- )
  cf-wren  2 cs! 2 spi!  swap over 2* cf-addr
  slice-buf swap cells +  128 0 do
    dup @ dup 0xff and spi!  8 rshift 0xff and spi!  cell+
  loop drop 0 cs! cf-wait ;


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
: name= ( addr len e -- f )
  >r nm-l ! nm-a ! r>  6 0 do
    i 2* nm-l @ < if
      nm-a @ i 2* + c@
      i 2* 1+ nm-l @ < if nm-a @ i 2* 1+ + c@ 8 lshift or then
    else 0 then
    over 2 cells + i cells + @ <> if drop 0 unloop exit then
  loop
  nm-l @ 12 < if
    dup 2 cells + nm-l @ 2/ cells + @
    nm-l @ 1 and 0= if 0xff and else 8 rshift 0xff and then
    0= if drop 1 else drop 0 then
  else drop 1 then ;
: find ( addr len -- n )
  find-l ! find-a ! 0 slice 255 0 do
    dup i 8 * cells + dup 1 cells + @ ?dup if
      drop
      find-a @ find-l @ 2 pick name= if 1 cells + @ nip unloop exit then
    then drop
  loop drop 0xffff ;
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
: sprite-slice ( n -- )
  slice 8 cells + 1536 0 do
    dup i cells + @ 0x4200 i cells + es!
  loop drop ;
: slice-run ( n -- )
  dup slice slice-type
  dup 3 = if drop screen exit then
  dup 8 = if drop 0 p-screen exit then
  dup 2 = if drop sprite-slice exit then
  drop drop ." slice: unsupported type" cr ;

\ ---- interrupts, 0xF00B0 ----------------------------------------------
\ The SIC has one level IRQ: pending bits stick, ENABLE selects sources and
\ the kernel's handler at vector 1 clears the serviced bit. Bits: 0 keyboard,
\ 1 timer, 2 audio, 3 raster. SCRATCH is the handler's tick counter.
0xB0 constant sic-pending    \ read; writing a 1 clears that bit
0xB2 constant sic-enable
0xB4 constant sic-status     \ b0 IRQ, b1 any pending
0xB6 constant sic-scratch
0xB8 constant sic-raster
: irq-on ( -- )        2 sic-enable es! ;   \ timer tick only
: irq-off ( -- )       0 sic-enable es! ;
: irq-clear ( mask -- ) sic-pending es! ;
: ticks ( -- n )       sic-scratch es@ ;
: irq? ( -- f )        sic-status es@ 1 and ;
\ Raster: control 7 at 0xF200E selects the scan line (0..359), then
\ raster-on enables SIC bit 3.  raster-ticks is the handler's count.
0x200E constant raster-ctrl
: raster-line! ( n -- ) raster-ctrl es! ;
: raster-on ( -- )      8 sic-enable es! ;
: raster-off ( -- )     0 sic-enable es! ;
: raster-ticks ( -- n ) sic-raster es@ ;
\ Per-row fine scroll, control 6: ( fine row -- ) with fine 0..7, row 0..25.
: row-scroll! ( fine row -- ) swap 3 lshift or 0x100 or 0x200C es! ;
: row-scroll-off ( -- )    0 0x200C es! ;

\ ---- text/art/sprite palette banks, 0xF5080/90/A0 -----------------------
\ The text bank holds 8 pairs (2p paper, 2p+1 ink); art cells read the art
\ bank; sprites read the sprite bank. The console ATTR selects the text pair.
\ 0x3BEE is the D16D kernel cell immediately before boot_script.
\ The same cell carries the style bits: bit 2 underline, bit 1 bold (smear).
0x3BEE constant text-attr
: pal! ( bg ink pair -- )        dup 2* 0x5080 + >r drop r@ 1+ es! r> es! ;
: art-pal! ( bg ink pair -- )    dup 2* 0x5090 + >r drop r@ 1+ es! r> es! ;
: sprite-pal! ( bg ink pair -- ) dup 2* 0x50A0 + >r drop r@ 1+ es! r> es! ;
: attr ( pair -- )      7 and 12 lshift 0x8000 or  text-attr @ 0x1F and or  text-attr ! ;
: style ( flags -- )    0x1F and  text-attr @ 0xF000 and or  text-attr ! ;
: attr! ( pair flags -- ) swap 7 and 12 lshift or 0x8000 or text-attr ! ;
: attr@ ( -- pair )     text-attr @ 12 rshift 7 and ;
: style@ ( -- flags )   text-attr @ 0x1F and ;

\ ---- I2S sound, 0xF00A0 ------------------------------------------------
\ 128-sample FIFO, 21.09375 kHz (6.75 MHz / 10 / 32), BCLK/LRCLK/DIN on
\ J5 5/6/7 (FPGA 25/26/27).  DATA read = level, STATUS bits:
\ b0 empty b1 full b2 low b3 underrun b4 running b5 irq.
0xA0 constant i2s-data
0xA2 constant i2s-ctrl
0xA4 constant i2s-status
: sfx! ( s -- )       i2s-data es! ;
: sfx-level ( -- n )  i2s-data es@ ;
: sfx-status ( -- n ) i2s-status es@ ;
: sfx-ctl! ( c -- )   i2s-ctrl es! ;
: sfx-reset ( -- )    2 sfx-ctl! ;
: sfx-off ( -- )      0 sfx-ctl! ;
: sfx-on ( -- )       1 sfx-ctl! ;
: sfx-loop ( -- )     5 sfx-ctl! ;
: sound ( -- )
  ." I2S level " sfx-level u. ."  status " sfx-status hex u. decimal cr ;
\ A 128-sample square at 21.09375 kHz / 128 = 164.8 Hz, looped in hardware.
: beep ( -- )
  2 sfx-ctl!
  128 0 do
    i 64 < if 0x2000 else -8192 then sfx!
  loop
  5 sfx-ctl! ;
