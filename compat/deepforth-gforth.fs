\ DeepForth compatibility layer for gforth
\ ---------------------------------------
\ Lets DeepForth programs run under gforth for logic exploration.
\ DeepForth is a 16-bit Forth for the Deep16 machine; gforth is 64-bit and
\ native, so cell-size and timing differ, but the word set and output spacing
\ are aligned as closely as practical.

\ ---- screen -------------------------------------------------------------
24 constant df-rows
80 constant df-cols
df-rows df-cols * constant df-screen-size
create df-screen df-screen-size cells allot

: cls ( -- )  \ clear screen and home cursor
  page
  df-screen df-screen-size cells 32 fill ;

: scr@ ( off -- x )  \ read screen cell at ES offset off
  cells df-screen + @ ;

: scr! ( x off -- )  \ write screen cell at ES offset off
  cells df-screen + ! ;

\ ---- echo --------------------------------------------------------------
variable echo-flag
1 echo-flag !
: echo ( flag -- )  0<> if 1 else 0 then echo-flag ! ;
: echo? ( -- flag )  echo-flag @ ;

\ ---- DeepForth's non-standard `variable` (leaves its address) ----------
: variable ( -- addr )  create 0 , here cell - ;
: 2variable ( -- addr ) create 0 , 0 , here 2 cells - ;

\ ---- form --------------------------------------------------------------
\ DeepForth's form reports the visible screen: 24 rows, 80 cols.
: form ( -- rows cols )  24 80 ;

\ ---- helpers used by forth/demo.fth ------------------------------------
: .addr ( u -- )  hex 0 u.r decimal ;

: free ( -- d )  unused 0 ;

: mem ( -- )
  cr ." DeepForth memory map (gforth compat)" cr ;

: ver ( -- )
  ." DeepForth (gforth compat)" cr ;

: bver ( -- n )  $0100 ;
