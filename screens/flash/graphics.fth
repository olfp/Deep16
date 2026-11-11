\ screens/flash/graphics.fth - sprites, SIC/raster, scene, palette and I2S.
\ Loaded on demand with: s" graphics" need

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
0xB0 constant sic-pending
0xB2 constant sic-enable
0xB4 constant sic-status
0xB6 constant sic-scratch
0xB8 constant sic-raster
: irq-on ( -- )        2 sic-enable es! ;
: irq-off ( -- )       0 sic-enable es! ;
: irq-clear ( mask -- ) sic-pending es! ;
: ticks ( -- n )       sic-scratch es@ ;
: irq? ( -- f )        sic-status es@ 1 and ;
0x200E constant raster-ctrl
: raster-line! ( n -- ) dup 0xC6 es! raster-ctrl es! ;
: raster-on ( -- )      8 sic-enable es! ;
: raster-off ( -- )     0 sic-enable es! ;
: raster-ticks ( -- n ) sic-raster es@ ;
: row-scroll! ( fine row -- ) swap 3 lshift or 0x100 or 0x200C es! ;
: row-scroll-off ( -- )    0 0x200C es! ;

\ ---- scene select: control 5 at 0xF200A ---------------------------------
: oam-base! ( n -- )   0x3F and 2 lshift 0x200A es@ 0x103 and or 0x200A es! ;
: pal-set!  ( n -- )   7 and 8 lshift   0x200A es@ 0x0FF and or 0x200A es! ;
: scene!    ( oam pal -- ) 7 and 8 lshift swap 0x3F and 2 lshift or 0x200A es! ;

\ ---- raster split: sprite slot 0 switches at two scan lines ------------
0xC0 constant split-la
0xC2 constant split-val
0xC4 constant split-lb
0xC6 constant split-cur
: split! ( scene a b -- )
   split-lb es! split-la es! split-val es!
   split-la es@ raster-line! raster-on ;
: split-off ( -- )
   0 split-val es! raster-off 0 raster-line! 0 0x200A es! 0 0x2006 es! ;

\ ---- text/art/sprite palette banks, 0xF6080/90/A0 -----------------------
: pal! ( bg ink pair -- )        dup 2* 0x6080 + >r drop r@ 1+ es! r> es! ;
: art-pal! ( bg ink pair -- )    dup 2* 0x6090 + >r drop r@ 1+ es! r> es! ;
: sprite-pal! ( bg ink pair -- ) dup 2* 0x60A0 + >r drop r@ 1+ es! r> es! ;
: attr ( pair -- )      7 and 12 lshift 0x8000 or  text-attr @ 0x1F and or  text-attr ! ;
: style ( flags -- )    0x1F and  text-attr @ 0xF000 and or  text-attr ! ;
: attr! ( pair flags -- ) swap 7 and 12 lshift or 0x8000 or text-attr ! ;
: attr@ ( -- pair )     text-attr @ 12 rshift 7 and ;
: style@ ( -- flags )   text-attr @ 0x1F and ;

\ ---- I2S sound, 0xF00A0 ------------------------------------------------
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
: beep ( -- )
  2 sfx-ctl!
  128 0 do
    i 64 < if 0x2000 else -8192 then sfx!
  loop
  5 sfx-ctl! ;
