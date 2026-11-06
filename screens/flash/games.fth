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
\ The game-load screen is loaded at boot (`9 screen`), so the host init lives
\ here until the BIOS can own it: see PS2PLAN.md. Bits 9/10 of 0x200C are
\ unused by the tile engine: 1 = drive low, 0 = release. 0xF0066 bits 5/6 are
\ the synchronised CLK/DATA levels.
: ps2! ( clk data -- )     swap 9 lshift swap 10 lshift or 0x200C es! ;
: ps2-clk@ ( -- f )        0xF0066 es@ 5 rshift 1 and ;
: ps2-data@ ( -- f )       0xF0066 es@ 6 rshift 1 and ;
: ps2-send ( b -- )        0x4000 call-far ;

\ 0xF006A is the high half of the D16nano cycle counter: one tick is 65,536
\ clocks, about 9.7 ms at 6.75 MHz, so the waits keep their real length
\ whatever the interpreter is doing. The loop exits on the counter itself
\ (signed difference, so the 16-bit wrap is harmless).
: ps2-ticks ( n -- )
  0xF006A es@ +
  begin  dup 0xF006A es@ swap - 0<  while  repeat
  drop ;
: ps2-settle ( -- )        31 ps2-ticks ;       \ ~0.3 s: let it power up

: ps2-load ( -- )          s" ps2host" game-load drop ;
: ps2-drain ( -- )         begin 0x60 es@ while 0x62 es@ . repeat cr ;
\ The PS/2 bytes also reach the console through the UART RX FIFO; clear both.
: ps2-flush ( -- )         begin 0x60 es@ while 0x62 es@ drop repeat
                           1 0xF0046 es! ;

\ Reset, then enable scanning. A keyboard answers the reset with ACK and then
\ runs its power-on self test, which can swallow the enable command, so 0xF4
\ is repeated; a repeated enable is harmless.
: ps2-enable ( -- )
  0xFF ps2-send
  103 ps2-ticks                                 \ ~1.0 s
  0xF4 ps2-send  41 ps2-ticks
  0xF4 ps2-send  41 ps2-ticks
  0xF4 ps2-send  41 ps2-ticks
  0xF4 ps2-send ;
: ps2-init ( -- )
  ." PS/2 init" cr ps2-load ps2-enable ps2-drain ;

\ Boot init. The JS core has no PS/2 model and reads 0xF0066 as erased
\ memory (0xFFFF); the board never drives bits 15:11.
: ps2-auto ( -- )
  0xF0066 es@ 0xFFFF = if exit then
  ps2-load ps2-settle ps2-enable ps2-flush ;

ps2-auto
