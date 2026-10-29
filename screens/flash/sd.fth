\ screens/flash/sd.fth - the SD card driver, loaded from config-flash slices.
\ `spi>`, `spi!` and `cs!` come from the boot script; CS0 is the card.

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
