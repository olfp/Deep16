\ forth/demo.fth - what the D16MINI image carries in Forth.
\
\ This file is baked into the boot image and read by read_line before the
\ keyboard, once per boot: it defines `free`, `mem` and `demo`, and prints the
\ memory summary under the banner. scripts/embed_forth.mjs copies it into
\ asm/forth.asm between the "generated" markers - edit THIS file and run
\ `node scripts/embed_forth.mjs`; tests/forth.test.js fails if the two drift.
\
\ One script line is one interpreter line, so `\` comments are fine (a
\ single-line script would have to drop them). Keep lines under 120 characters.
\
\ The addresses mirror D16MINI.md §3 and asm/forth.asm's .equ block. The ones
\ that are not fixed addresses - where the kernel and the dictionary end - come
\ from `here` at run time.

here constant dict-base     \ where this script's definitions begin
 256 constant kernel-base    \ 0x0100: forth_start, where the kernel is laid
24576 constant window-words  \ 0x6000: past the 24K BSRAM window
here window-words < 0= constant psram?   \ the kernel moved the dictionary up

\ The limit is the kernel's own ceiling cell: 0x5600 below the BIOS on the
\ BSRAM board, 0xFFF0 (the boot ROM starts there) when the dictionary is in
\ PSRAM. `unused` already reports the cells left, so free is just that.
\ ---- memory -------------------------------------------------------------
: free ( -- d )    unused 0 ;   \ lo, hi=0: unsigned, so d. prints it whole
: .addr ( u -- )    hex 0 u.r decimal ;
: u. ( u -- )       0 u.r space ;

: mem ( -- )
  cr ." Deep16 memory map" cr
  psram? if
    ."   memory   00000-FFFFF  1048576 words, 2 MiB HyperRAM (PSRAM board)" cr
    ."   image    0000-5FFF   24576 words (kernel, data, boot script, BIOS, stacks)" cr
    ."   dict     " dict-base .addr ." -" here 1- .addr
    ."   " here dict-base - u. ." words, " free d. ." free" cr
    ."   UART F0040-F004F   boot ROM FFFF0-FFFFF" cr
  else
    ."   window   0000-5FFF   24576 words, 48 KiB BSRAM" cr
    ."   image    0100-" here 1- .addr ."     " here kernel-base - u. ." words" cr
    ."            (kernel, data and the baked demo source)" cr
    ."   free     " here .addr ." -55FF     " free d. ." words" cr
    ."   BIOS     5600-57FF   reserved for the UART console" cr
    ."   stacks   5800-5FFF   2048 words (RP 5800 up, SP 5FF0 down)" cr
    ."   UART F0040-F004F      boot ROM FFFF0-FFFFF (16 words)" cr
  then
  cr ;

: boot.msg ( -- )
  psram? if
    ." Deep16   1048576 words of PSRAM, " free d. ." free" cr
  else
    ." D16MINI  " window-words u. ." words of BSRAM, " free d. ." free" cr
  then ;

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
\ u.r no longer prints a trailing space (gforth alignment), so u. adds one.
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

boot.msg
