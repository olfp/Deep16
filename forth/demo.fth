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
unused 0x4000 u> constant psram?   \ the PSRAM probe raised the ceiling

\ The limit is the kernel's own ceiling cell: 0x5600 below the BIOS on the
\ BSRAM board, 0xFFF0 (the boot ROM starts there) when the dictionary is in
\ PSRAM. `unused` already reports the cells left, so free is just that.
\ ---- version ------------------------------------------------------------
\ The release tuple (VERSIONING.md): DeepForth / BIOS / FPGA. `bver` (BIOS
\ function 0) returns the same BIOS pair as a number, 0x0100.
: ver ( -- )    ." DeepForth 1.1  BIOS 1.0  FPGA 1.1" cr ;

\ ---- memory -------------------------------------------------------------
: free ( -- d )    unused 0 ;   \ lo, hi=0: unsigned, so d. prints it whole
: .addr ( u -- )    hex 0 u.r decimal ;
: u. ( u -- )       0 u.r ;

: boot.msg ( -- )
  psram? if
    ." Deep16   1048576 words of PSRAM, " free d. ." free" cr
  else
    ." D16MINI  " window-words u. ."  words of BSRAM, " free d. ." free" cr
  then ;

: mem ( -- )
  cr ." Deep16 memory map" cr
  psram? if
    ."   memory   00000-FFFFF  1048576 words, 2 MiB HyperRAM (PSRAM board)" cr
    ."   image    0000-5FFF   24576 words (kernel, data, boot script, BIOS)" cr
    ."   dict     " dict-base .addr ." -" here 1- .addr
    ."   " here dict-base - u. ."  words, " free d. ." free" cr
    ."   UART F0040-F004F   boot ROM FFFF0-FFFFF" cr
  else
    ."   window   0000-5FFF   24576 words, 48 KiB BSRAM" cr
    ."   image    0100-" here 1- .addr ."     " here kernel-base - u. ."  words" cr
    ."            (kernel, data and the baked demo source)" cr
    ."   free     " here .addr ." -55FF     " free d. ." words" cr
    ."   BIOS     5600-57FF   reserved for the UART console" cr
    ."   stacks   5800-5FFF   2048 words (RP 5800 up, SP 5FF0 down)" cr
    ."   UART F0040-F004F      boot ROM FFFF0-FFFFF (16 words)" cr
  then
  cr ;

\ ---- SPI master (0xF0080): SD card CS0, config flash CS1 ----------------
\ The registers are ES-relative (ES = 0xF000); one byte at a time, protocol
\ in software. CS0 is the microSD, CS1 the on-board P25Q32U.
0x80 constant spi-ctrl
0x82 constant spi-stat
0x84 constant spi-data
0x86 constant spi-div

\ CS0 asserted (1) or released (0); one byte out and the byte that came in.
: cs! ( f -- )      3 and spi-ctrl es! ;
: spi> ( c -- c )   spi-data es! begin spi-stat es@ 1 and 0= until
                    spi-data es@ 0xff and ;
: spi! ( c -- )     spi> drop ;

\ ---- config flash, SPI CS1 (0xF0080) -------------------------------------
\ The on-board 4 MB P25Q32U shares SCK/MOSI/MISO with the SD card; the board
\ routes the master to its MSPI pins while CS1 is low. A cell is 16 bits, so
\ a flash address is a sector number (0..1023) plus a 12-bit offset; the
\ address bytes are sector>>4, ((sector&15)<<4)|(off>>8), off&255.
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
\ BP4..0 = 0 1 1 1 0: the lower 2 MB (bitstream and future kernel) is
\ read-only; the slices at sector 512+ stay writable.
: cf-protect ( -- ) cf-wren  2 cs! 1 spi! 0x38 spi!  0 cs! cf-wait ;
: cf-unprotect ( -- ) cf-wren  2 cs! 1 spi! 0x00 spi!  0 cs! cf-wait ;
: cf-erase ( sector -- ) cf-wren 2 cs! 0x20 spi! 0 cf-addr 0 cs! cf-wait ;

\ ---- config-flash slices: 4 KB = 2048 cells, sector 512 + n -------------
\ Header word0: bit15 WP, bits14:12 magic 5, bits11:8 flags/rate, bits7:0
\ type. Cell 1 link, cells 2..7 name (12 chars, 2/cell), payload from cell 8.
create slice-buf 2048 cells allot
create text-buf 8192 cells allot        \ up to three 2040-char source slices
variable slice-sec drop
variable slice-wp drop

: cf-read-burst ( sector -- )
  0 spi-div es!  2 cs! 3 spi!  0 cf-addr
  slice-buf 2048 0 do
    0xff spi> 0xff spi> 8 lshift or   over i cells + !
  loop drop 0 cs! ;

\ The slice words the boot needs are here, before `screen`; the editor in
\ catalog.fth builds on them.
: slice ( n -- a )
  dup 0 511 within 0= if ." slice: 0..511" cr drop slice-buf exit then
  dup slice-sec !  512 + cf-read-burst
  slice-buf dup @ 0x8000 and slice-wp ! ;
: slice-valid? ( a -- f )
  @ dup 0xffff = if drop 0 exit then  0x7000 and 0x5000 = ;
: slice-type ( a -- t )   @ 0xff and ;
: slice-link ( a -- n )   1 cells + @ ;

: screen ( n -- )
  dup 0 511 within 0= if ." screen: 0..511" cr drop exit then
  0 >r  begin
    r@ 8160 < 0= if ." screen: too long" cr r> 2drop exit then
    dup slice  ( n a )
    dup slice-valid? 0= if 2drop r> drop exit then
    dup 8 cells +  text-buf r@ cells +  2040 move
    slice-link  ( n n' )
    r> 2040 + >r
    dup 0xffff = if drop drop r> text-buf swap included exit then
    nip
  again ;


\ load the SD driver and the catalog from the config flash
1 screen
5 screen

boot.msg
