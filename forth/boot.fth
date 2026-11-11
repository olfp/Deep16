\ forth/boot.fth - the baked boot loader.
\
\ scripts/embed_forth.mjs bakes this file into asm/forth.asm and
\ asm/forth_nano.asm. It contains only what is needed to read a source slice:
\ the SPI-free cf-burst hookup, slice, screen, and `need`. The first line loads
\ slice 1 (start); the next lines bring up essentials and edit by name.
\
\ `screen` ends the current line (included does not nest), so the module loads
\ must be separate boot-script lines, not calls from inside start.

create slice-buf 2048 cells allot
create text-buf 8192 cells allot        \ up to four 2040-char source slices
variable slice-sec drop
variable slice-wp drop
variable sf-a drop
variable sf-l drop

\ cf-burst is the assembly block reader in the kernel image (0x2F49).
create cf-burst-prim 0x2F49 ,
: cf-burst ( sector buf -- ) cf-burst-prim execute ;
: cf-read-burst ( sector -- ) slice-buf cf-burst ;

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

\ Compare a directory entry name with sf-a/sf-l, 12 packed bytes.
: slice-name= ( e -- f )
  12 0 do
    i sf-l @ < if sf-a @ i + c@ else 0 then
    over 2 cells + i 1 rshift cells + @
    i 1 and 0= if 0xff and else 8 rshift 0xff and then
    <> if drop 0 unloop exit then
  loop drop 1 ;

: slice-find ( a u -- n )
  sf-l ! sf-a !
  0 slice
  255 0 do
    dup i 8 * cells +
    dup 1 cells + @ ?dup if
      drop
      dup slice-name= if 1 cells + @ nip unloop exit then
    then drop
  loop drop 0xffff ;

\ A missing module is silent; the banner still comes up without slices.
: need ( a u -- )
  slice-find dup 0xffff = if drop exit then
  >r ." Loading " sf-a @ sf-l @ type cr r> screen ;

\ start replaces this; it keeps a slice-less boot quiet.
: boot.msg ;

1 screen
s" essentials" need
s" edit" need
boot.msg
