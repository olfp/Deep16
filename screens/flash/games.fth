\ screens/flash/games.fth - the flash game loader, loaded with `9 screen`.
\ A game is a type-4 binary slice; its payload is
\   cell 0  magic 'D16B' (0xD16B)
\   cell 1  format version (1)
\   cell 2  entry offset inside the load segment (must be 0 today)
\   cell 3  word count of the block
\   cell 4  load segment
\   cell 5+ the block words
\ Continuations are a raw payload and linked, so a game may span any number of
\ 4 KB slices. game-load copies the block into its segment and answers the
\ segment; game-run also far-calls the entry and comes back to the interpreter.
\
\ ES is the one global here: every slice read goes through the SPI words, which
\ address the I/O window with ES, while the copy must address the game's
\ segment. gcopy therefore sets ES for the copy and puts it back, so a slice
\ read never lands inside the block it just wrote.
0xFFFF constant no-link
5 constant game-hdr
0xF000 constant io-seg
variable gnext drop
variable goff drop
variable gleft drop
variable gseg drop
variable gentry drop
: gcopy ( a n -- )              \ copy n words from DS:a to ES:goff
  gseg @ seg-base!
  0 do
    dup @  goff @ es!
    goff @ 1+ goff !
    cell+
  loop drop
  io-seg seg-base! ;
: game-load ( a n -- seg )
  find dup no-link = if drop ." game: not found" cr 0 exit then
  gnext !
  io-seg seg-base!
  gnext @ slice 8 cells +                    ( payload )
  dup @ 0xD16B <> if drop ." game: bad header" cr 0 exit then
  dup 2 cells + @ gentry !
  dup 3 cells + @ gleft !
  dup 4 cells + @ gseg !
  0 goff !
  game-hdr cells +  gleft @ 2035 min          ( src n )
  dup gleft @ swap - gleft !
  gcopy
  gnext @ slice 1 cells + @ gnext !
  begin
    gleft @ 0>  gnext @ no-link <>  and
  while
    gnext @ slice 8 cells +                  ( src )
    2040 gleft @ min                         ( src n )
    dup gleft @ swap - gleft !
    gcopy
    gnext @ slice 1 cells + @ gnext !
  repeat
  io-seg seg-base!
  gseg @ ;
: game-run ( a n -- ) game-load call-far ;

\ ---- PS/2 host: open-drain GPIO through control 6 (0x200C) -------------
\ The game-load screen is loaded at boot, so the host init lives here.
\ Bits 9/10 of 0x200C are unused by the tile engine: 1 = drive low, 0 =
\ release. 0xF0066 bits 5/6 are the synchronised CLK/DATA levels.
: ps2! ( clk data -- )     swap 9 lshift swap 10 lshift or 0x200C es! ;
: ps2-clk@ ( -- f )        0xF0066 es@ 5 rshift 1 and ;
: ps2-data@ ( -- f )       0xF0066 es@ 6 rshift 1 and ;
: ps2-bit! ( bit -- )      0= 0 swap ps2! ;
: ps2-wait-low ( -- f )
  0 2000 0 do  ps2-clk@ 0= if 1 unloop exit then  loop 0 ;
: ps2-wait-high ( -- f )
  0 2000 0 do  ps2-clk@ if 1 unloop exit then  loop 0 ;
: ps2-parity ( b -- p )
  0 swap 8 0 do  dup 1 and rot xor swap 1 rshift  loop  drop 1 xor 1 and ;
: ps2-send ( b -- )
  dup ps2-parity swap
  1 0 ps2! 20 0 do loop          \ CLK low, DATA high: request
  1 1 ps2!                       \ DATA low: start
  0 1 ps2!                       \ release CLK; the keyboard clocks
  ps2-wait-low 0= if 2drop 0 0x200C es! exit then
  ps2-wait-high drop
  8 0 do
    dup 1 and if 0 else 0x400 then 0x200C es!   \ set the bit early
    ps2-wait-low drop
    ps2-wait-high drop
    1 rshift
  loop drop
  dup 1 and if 0 else 0x400 then 0x200C es!     \ parity
  ps2-wait-low drop ps2-wait-high drop
  0 0x200C es!                                  \ stop bit = release
  ps2-wait-low drop ps2-wait-high drop
  0 0x200C es! ;                                \ release both lines
: ps2-delay ( -- )         65535 0 do loop ;
: ps2-drain ( -- )         begin 0x60 es@ while 0x62 es@ . repeat cr ;
: ps2-init ( -- )
  ." PS/2 init" cr
  0xFF ps2-send ps2-delay ps2-delay ps2-delay ps2-drain
  0xF4 ps2-send ps2-delay ps2-drain ;
