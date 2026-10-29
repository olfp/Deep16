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

: boot.msg ( -- )
  psram? if
    ." Deep16   1048576 words of PSRAM, " free d. ." free" cr
  else
    ." D16MINI  " window-words u. ."  words of BSRAM, " free d. ." free" cr
  then ;

\ ---- SD card, SPI CS0 (0xF0080) -------------------------------------------
\ One 512-byte sector, held as 512 characters, one per cell, in a dictionary
\ buffer - not at address 0, where the flat builds keep the vectors and kernel.
\ The registers are ES-relative (ES = 0xF000), so the driver uses es@ and es!.
\ Block numbers are 16 bits: 32 MB of the card, which is a Forth block system's
\ own limit as much as this driver's.
0x80 constant spi-ctrl
0x82 constant spi-stat
0x84 constant spi-data
0x86 constant spi-div
create sd-buf 6144 cells allot      \ a staging sector in front of 11 payload sectors
variable sd-hi drop
variable sd-lo drop
variable sd-hc drop
variable sd-res drop
variable sd-r1 drop
variable sd-clk drop
variable sd-c drop
variable blk drop
32 sd-clk !                \ the identification clock: ~100 kHz, the safe end
-1 blk !

\ CS0 asserted (1) or released (0); one byte out and the byte that came in.
: cs! ( f -- )      3 and spi-ctrl es! ;   \ CS0 = SD, CS1 = config flash
: spi> ( c -- c )   spi-data es! begin spi-stat es@ 1 and 0= until
                    spi-data es@ 0xff and ;
: spi! ( c -- )     spi> drop ;
\ The 32-bit command argument, sent high byte first.
: >arg ( hi lo -- ) sd-lo ! sd-hi ! ;
: arg4 ( -- )       sd-hi @ dup 8 rshift spi! 0xff and spi!
                    sd-lo @ dup 8 rshift spi! 0xff and spi! ;
\ 0xFF is an idle bus, so a response is the first byte that is not 0xFF.
: sd-wait ( -- b )  0x100 begin 0xff spi> dup 0xff <> if nip exit then drop
                    1- dup 0= if drop 0xff exit then again ;
: sd-token ( -- b ) 0x8000 begin 0xff spi> dup 0xff <> if nip exit then drop
                    1- dup 0= if drop 0xff exit then again ;
: sd-idle ( -- )    0x8000 begin 0xff spi> 0xff = if drop 1
                    else 1- dup 0= then until ;
: sd-cmd ( n crc -- r1 )  1 cs! swap 0x40 or spi! arg4 spi! sd-wait ;
\ CMD17/CMD24 take a block number on SDHC and a byte address before it.
: sd-arg ( n -- )   sd-hc @ if sd-lo ! 0 sd-hi ! exit then
                    dup 9 lshift sd-lo ! 7 rshift sd-hi ! ;
: sd-bytes ( n -- ) 0 do 0xff spi> 0xff and sd-buf i + c! loop ;

\ Poll the init command in sd-c (41 = ACMD41 after CMD55, 1 = CMD1 for an MMC)
\ with the argument in sd-hi/sd-lo. True when the card left idle: a v1 card
\ wants HCS=0 and an MMC has no ACMD41, so one loop serves all three attempts.
\ sd-r1 keeps the last response.
: sd-poll ( -- f )
  1 sd-res !
  0x400 0 do
    0 cs!  sd-c @ 41 = if 55 0xff sd-cmd drop then
    0 cs!  sd-c @ 0xff sd-cmd dup sd-r1 !
    dup 0xff = if drop leave then
    0= if 0 sd-res ! leave then
  loop
  sd-res @ 0= ;

\ 0 is ready, otherwise the stage that failed: 1 CMD0, 2 the CMD8 echo, 3 the
\ init poll, 4 CMD58, 5 the read token, 6 the write response. CMD8 is optional
\ (a card that does not answer it is a v1 card; CMD58's CCS decides addressing),
\ CMD0 is retried three times, and every command gets its own CS edge.
: sd-init ( -- n )
  0 sd-hc !  sd-clk @ spi-div es!  0 cs!  0x10 0 do 0xff spi! loop
  1 sd-res !
  3 0 do
    0 0x95 sd-cmd dup sd-r1 ! 1 = if 0 sd-res ! leave then
    0 cs!  0x10 0 do 0xff spi! loop
  loop
  sd-res @ if 0 cs! 1 exit then
  0 cs!
  0 0x1aa >arg  8 0x87 sd-cmd dup sd-r1 !
  1 = if
    0xff spi! 0xff spi!
    0xff spi> dup sd-r1 ! 1 <> if 0 cs! 2 exit then
    0xff spi> 0xaa <> if 0 cs! 2 exit then
  then
  0x4000 0 >arg  41 sd-c !
  sd-poll 0= if
    0 0 >arg  sd-poll 0= if
      0 0 >arg  1 sd-c !  sd-poll 0= if 0 cs! 3 exit then
    then
  then
  0 cs!  58 0xff sd-cmd dup sd-r1 ! if 0 cs! 4 exit then
  0xff spi> 0x40 and if 1 sd-hc ! then
  0xff spi! 0xff spi! 0xff spi!
  0 cs!  0 0x200 >arg  16 0xff sd-cmd drop
  0 spi-div es!  0 cs!  0 ;

: sd-read ( n -- n )
  sd-arg  17 0xff sd-cmd ?dup if 0 cs! exit then
  sd-token dup sd-r1 ! 0xfe <> if 0 cs! 5 exit then
  512 sd-bytes  0xff spi! 0xff spi!
  0 cs!  0 ;

: sd-write ( n -- n )
  sd-arg  24 0xff sd-cmd ?dup if 0 cs! exit then
  0xfe spi!
  512 0 do sd-buf i + c@ 0xff and spi! loop
  0xff spi! 0xff spi!
  sd-wait dup sd-r1 ! 0x1f and 5 <> if 0 cs! 6 exit then
  sd-idle  0 cs!  0 ;

\ The block layer: sector n is read once and then stays in sd-buf.
: block ( n -- a )
  dup blk @ = if drop sd-buf exit then
  dup sd-read ?dup if ." SD read error " . cr drop sd-buf exit then
  dup blk ! drop sd-buf ;
: save-block ( -- n )    blk @ sd-write ;

\ ---- source from the card ------------------------------------------------
\ A screen is one 512-byte sector of text: lines separated by LF, the rest of
\ the sector padded with LF (an empty line is a no-op; a tail of zeros would be
\ one over-long line, and a load throws -22 past 128 characters).
\ include ( first count -- ) reads count sectors and interprets them as one
\ source file. sd-buf is the staging sector in front of the payload - sector i
\ lands at 512*(i+1) - so a read never overwrites one already moved into place.
\ The payload is 11 sectors; the length goes on the return stack because `do`
\ eats the count. -1 blk ! because the load overwrites the block buffer.
: include ( first count -- )
  dup 11 > if ." include: at most 11 sectors" cr 2drop exit then
  dup 512 * >r
  0 ?do
    -1 blk !
    dup i + sd-read drop
    sd-buf  sd-buf 512 + i 512 * +  512 move
  loop
  drop r>
  sd-buf 512 + swap included ;

: sd ( -- )              sd-init ?dup if ." SD init error " . else ." SD card ready" then cr ;

\ ---- source from the user flash -------------------------------------------
\ The on-die FLASH608K has a CPU read port at 0xF00A0 (one 32-bit word per
\ request): 0xA0 the word address, 0xA2 bit 0 starts a read and reads back
\ busy, 0xA4/0xA6 the two halves. The read takes ~16 us, so Forth polls.
0xA0 constant flash-addr
0xA2 constant flash-go
0xA4 constant flash-lo
0xA6 constant flash-hi
: flash@ ( word -- lo hi )
  flash-addr es!
  1 flash-go es!
  begin flash-go es@ 1 and 0= until
  flash-lo es@ flash-hi es@ ;

\ A screen is one 2 KB flash page: 512 32-bit words, four characters each.
\ The characters are unpacked one per cell (the form `included` reads) into a
\ 2048-cell buffer. Pages 0..12 are free; the image ends in page 24.
create screen-buf 2048 cells allot
: !chars ( lo hi a -- )
  >r
  over 0xff and r@ c!
  over 8 rshift r@ 1+ c!
  dup 0xff and r@ 2 + c!
  8 rshift r@ 3 + c!
  drop r> drop ;
: screen ( n -- )
  dup 0 13 within 0= if ." screen: 0..12" cr drop exit then
  512 * 0x3200 +
  screen-buf 512 0 do
    over i + flash@
    2 pick i 4 * + !chars
  loop
  2drop
  screen-buf 2048 included ;

\ ---- config flash, SPI CS1 (0xF0080) -------------------------------------
\ The on-board 4 MB P25Q32U shares SCK/MOSI/MISO with the SD card; the board
\ routes the master to its MSPI pins while CS1 is low. This is the phase-1
\ bring-up: JEDEC ID, status, BP = lower 2 MB, and a test 4 KB sector at
\ 0x200000 (sector 512, above the protected bitstream region). A cell is 16
\ bits, so a flash address is a sector number (0..1023) plus a 12-bit offset;
\ the address bytes are sector>>4, ((sector&15)<<4)|(off>>8), off&255.
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
: cf-read ( sector -- lo hi )
  0 spi-div es!  2 cs! 3 spi!  0 cf-addr
  0xff spi> 0xff spi> 0xff spi> 0xff spi> 0 cs!
  >r >r 8 lshift or r> r> 8 lshift or ;
: cf-write ( sector lo hi -- )
  cf-wren  2 cs! 2 spi!  rot 0 cf-addr
  dup 0xff and spi!
  dup 8 rshift 0xff and spi!
  swap dup 0xff and spi!
  8 rshift 0xff and spi!
  drop 0 cs! cf-wait ;
: cf-erase ( sector -- ) cf-wren 2 cs! 0x20 spi! 0 cf-addr 0 cs! cf-wait ;
: cf-test ( -- )
  ." config flash id: " cf-id
  ." status: " cf-status hex . decimal cr
  cf-protect
  ." after BP: " cf-status hex . decimal cr
  512 cf-erase
  512 0x1234 0xabcd cf-write
  512 cf-read
  ." read back (hi lo): " hex . . decimal cr
  ." protected word: " 256 cf-erase 256 cf-read hex . . decimal cr ;

boot.msg
