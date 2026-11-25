\ screens/flash/graphics.fth - sprites, SIC/raster, scene, palette and I2S.
\ Loaded on demand with: s" graphics" need

: sprite-slice ( n -- )
  slice 8 cells + 0x4200 1536 gfx-cp ;
: slice-run ( n -- )
  dup slice slice-type
  dup 3 = if drop screen exit then
  dup 8 = if drop 0 p-screen exit then
  dup 2 = if drop sprite-slice exit then
  dup 0x0C = if drop ." slice: block screen, use edit-slice" cr exit then
  drop drop ." slice: unsupported type" cr ;

\ ---- interrupts, 0xF00B0 ----------------------------------------------
\ Register offsets only; gfx@/gfx! go through BDOS 24/25. The SIC enable and
\ pending writes stay direct: the raster test pins their cycle behaviour.
0xB0 constant sic-pending
0xB2 constant sic-enable
0xB4 constant sic-status
0xB6 constant sic-scratch
0xB8 constant sic-raster
: irq-on ( -- )        2 sic-enable es! ;
: irq-off ( -- )       0 sic-enable es! ;
: irq-clear ( mask -- ) sic-pending es! ;
: ticks ( -- n )       sic-scratch gfx@ ;
: irq? ( -- f )        sic-status gfx@ 1 and ;
0x200E constant raster-ctrl
: raster-line! ( n -- ) dup 0xC6 gfx! raster-ctrl gfx! ;
: raster-on ( -- )      8 sic-enable es! ;
: raster-off ( -- )     0 sic-enable es! ;
: raster-ticks ( -- n ) sic-raster gfx@ ;
: row-scroll! ( fine row -- ) swap 3 lshift or 0x100 or 0x200C gfx! ;
: row-scroll-off ( -- )    0 0x200C gfx! ;

\ ---- scene select: control 5 at 0xF200A ---------------------------------
: oam-base! ( n -- )   0x3F and 2 lshift 0x200A gfx@ 0x103 and or 0x200A gfx! ;
: pal-set!  ( n -- )   7 and 8 lshift   0x200A gfx@ 0x0FF and or 0x200A gfx! ;
: scene!    ( oam pal -- ) 7 and 8 lshift swap 0x3F and 2 lshift or 0x200A gfx! ;

\ ---- raster split: sprite slot 0 switches at two scan lines ------------
0xC0 constant split-la
0xC2 constant split-val
0xC4 constant split-lb
0xC6 constant split-cur
: split! ( scene a b -- )
   split-lb gfx! split-la gfx! split-val gfx!
   split-la gfx@ raster-line! raster-on ;
: split-off ( -- )
   0 split-val gfx! raster-off 0 raster-line! 0 0x200A gfx! 0 0x2006 gfx! ;

\ ---- text/art/sprite palette banks (BDOS 14 via pal-bank!) ---------------
: pal! ( bg ink pair -- )        0 pal-bank! ;
: art-pal! ( bg ink pair -- )    1 pal-bank! ;
: sprite-pal! ( bg ink pair -- ) 2 pal-bank! ;
: attr ( pair -- )      7 and 12 lshift 0x8000 or  text-attr @ 0x0E00 and or  text-attr ! ;
: style ( flags -- )    7 and 9 lshift  text-attr @ 0xF1FF and or  text-attr ! ;
: attr! ( pair flags -- ) 7 and 9 lshift swap 7 and 12 lshift or 0x8000 or text-attr ! ;
: attr@ ( -- pair )     text-attr @ 12 rshift 7 and ;
: style@ ( -- flags )   text-attr @ 9 rshift 7 and ;

\ ---- I2S sound (BDOS 15-17 via sfx!/sfx-ctl!) ---------------------------
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
