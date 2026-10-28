\ screens/starfield.fth - the console starfield, loaded from the SD card.
\
\ This used to be baked into the image's boot script (forth/demo.fth). It moved
\ here so the image could carry `include` instead: load it with
\   1 6 include        ( six sectors from sector 1 - see scripts/make_screens)
\ and `demo` is defined again. Everything it uses - key?, cls, emit, */ - is in
\ the kernel, so the file needs nothing else.
\ ---- the starfield demo -------------------------------------------------
\ Forty stars fly out of the middle of the terminal. Integers only: x*scale/z
\ through `*/` (32-bit intermediate) projects the star, a 16-bit LCG feeds
\ `rnd`, and each frame erases where a star was and draws where it is with ANSI
\ cursor addressing. That is why the console BIOS keeps escape bytes out of its
\ column count (D16MINI.md §5): cursor addresses that counted columns would
\ hard-wrap in the middle of the screen. Stars stay inside columns 1-79, because
\ column 80 is where the machine hard-wraps.
40 constant stars
200 constant z-near
  3400 constant z-far
create sx stars cells allot
create sy stars cells allot
create sz stars cells allot
create px stars cells allot     \ last drawn column, 0 when nothing is drawn
create py stars cells allot
variable seed drop
variable ci drop                     \ the star in hand
variable cx drop                     \ its projected column
variable cy drop                     \ its projected row

: rnd ( -- x )       seed @ 25173 * 13849 + dup seed ! ;
: rnd% ( n -- x )    rnd 32767 and swap mod ;
: esc ( -- )         27 emit ;
\ The baked u. prints no leading space: Return separates it from the input and
\ the REPL's " ok" supplies the following space.
: .d ( n -- )      dup 10 < if 48 + emit exit then
                   10 /mod recurse 48 + emit ;
: at ( row col -- )  esc 91 emit swap .d 59 emit .d 72 emit ;
: reset-star ( i -- )
  ci !
  1600 rnd% 800 -  sx ci @ cells + !
  1200 rnd% 600 -  sy ci @ cells + !
  3200 rnd% z-near + sz ci @ cells + !
  0 px ci @ cells + !  0 py ci @ cells + ! ;
: init ( -- )        12345 seed !  stars 0 do i reset-star loop ;
: erase-star ( i -- )
  ci !
  px ci @ cells + @ ?dup if
    py ci @ cells + @ swap at 32 emit
  then
  0 px ci @ cells + !  0 py ci @ cells + ! ;
: project ( i -- )
  ci !
  sx ci @ cells + @ 40 * sz ci @ cells + @ / 40 + cx !
  sy ci @ cells + @ 20 * sz ci @ cells + @ / 12 + cy ! ;
: glyph ( -- c )
  ci @ sz cells + @ 700 < if 35 exit then
  ci @ sz cells + @ 1400 < if 42 exit then
  ci @ sz cells + @ 2400 < if 58 exit then
  46 ;
: draw ( i -- )
  dup erase-star
  project
  cx @ 1 80 within cy @ 1 25 within and if
    cy @ cx @ at glyph emit
    cx @ px ci @ cells + !  cy @ py ci @ cells + !
  then ;
: frame ( -- )
  stars 0 do
    i sz cells + @ z-near - dup 0< if drop i reset-star
    else sz i cells + ! then
    i draw
  loop ;
: demo ( -- )
  esc 91 emit 63 emit 49 emit 48 emit 52 emit 57 emit 104 emit   \ ESC[?1049h
  cls
  init
  begin frame key? until
  key drop
  esc 91 emit 48 emit 109 emit                                   \ ESC[0m
  esc 91 emit 63 emit 49 emit 48 emit 52 emit 57 emit 108 emit   \ ESC[?1049l
  cr ;
