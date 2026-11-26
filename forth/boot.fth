\ forth/boot.fth - the baked D16MINI boot loader.
\
\ scripts/embed_forth.mjs bakes this file into asm/forth_nano.asm. The D16NANO
\ kernel uses forth/boot-nano.fth instead, which reads source slices through
\ BDOS. This loader contains the SPI-free cf-burst hookup, slice, screen, and
\ `need`. The first line loads slice 1 (start); the next lines bring up
\ essentials and edit by name.
\
\ `screen` reads the source one slice at a time and interprets it one line at a
\ time, so the text never sits in the dictionary and a chain can be as long as
\ the flash holds.  The load ends the line, so the module loads must still be
\ separate boot-script lines.
\
\ The baked block has room for 941 cells (0x3C20..0x3FCC); the BDOS slice file
\ code starts at 0x3FCD. Every line of this file costs cells, so the loader is
\ written short.

create slice-buf 2048 cells allot
create slice-sec 0 ,
create slice-wp 0 ,
create sf-a 0 ,
create sf-l 0 ,
create ea 0 , create ec 0 , create en 0 , create es 0 , create el 0 , create lfc 10 ,

\ cf-burst remains the raw 4 KiB streaming primitive (0x2F49), but the boot
\ loader reads through BDOS function 11 so the copy and bus polling live in
\ the system layer. cf-burst stays available for the slice editor/tests.
create cf-burst-prim 0x2F49 ,
: cf-burst ( sector buf -- ) cf-burst-prim execute ;
: cf-read-burst ( sector -- ) slice-buf cf-burst ;

\ BDOS 7 writes one 4 KiB slice back to the config flash. The primitive at
\ 0x4988 erases the slice's sector and page-programs it from the buffer.
create slice-write-prim 0x4988 ,
: slice-write ( src n u -- r ) slice-write-prim execute ;

: slice ( n -- a )
  dup 0 511 within 0= if ." slice: 0..511" cr drop slice-buf exit then
  dup slice-sec ! slice-buf bdos-slice
  slice-buf dup @ 0x8000 and slice-wp ! ;
: slice-valid? ( a -- f )
  @ dup 0xffff = if drop 0 exit then 0x7000 and 0x5000 = ;
: slice-type ( a -- t ) @ 0xff and ;
: slice-link ( a -- n ) 1 cells + @ ;

\ A source slice holds 2040 characters, one per cell.  `screen` reads one
\ slice at a time into slice-buf and interprets its lines as they arrive, so
\ the source never sits in the dictionary: a chain can be as long as the flash
\ holds, and the dictionary keeps the room for the words the source defines.
\ The slicer cuts the chain on line boundaries, so a line is never split
\ across two slices.  `evaluate` inside a colon word works, and the compile
\ state survives from one evaluation to the next, so a definition that spans
\ a line - or a whole slice - is compiled as the one word it is.
\
\ The whole chain is walked by this one colon word, and that matters: the
\ kernel keeps the placeholders of `if`, `then`, `begin` and `do` on the
\ return stack while it compiles, so a definition that spans a line leaves
\ its placeholder there.  A word of ours that returned in between would pop
\ that placeholder instead of its own return address.  One colon word for the
\ whole chain means there is no return in between, and the placeholders stay
\ the source's own business.  The scan keeps its place in variables for the
\ same reason: a `do` loop of ours would put a frame on the return stack too,
\ where the source's `i` and `unloop` would find it.
\
\ ea is the cell the current line starts in, ec the cell the line ends at (the
\ LF), es the slice to load next and en the number of slices in the chain so
\ far.  el is the number of cells left in the slice.  All of them live in
\ variables, not on the stack: the source runs on the same data stack and may
\ leave values there.
\
\ `search` is a kernel word and it walks the slice natively, so the scan
\ costs one native call per line instead of one interpreted step per
\ character; that is the difference between a loader that boots in three
\ times the steps and one that boots in about the same time as the old
\ copy-and-include loader.  `search` gives back the address of the match and
\ the number of cells from the match to the end of the range, so the line is
\ ec - ea cells long, the next line starts one cell past the LF, and the
\ range for the next line is one cell shorter than the cells that are left.
\ The range is the rest of the slice, so a slice that has no LF in it is not
\ a source slice and the load stops there.
\
\ One trap worth naming: `create` does not reserve the data cell the way
\ `variable` does - the next definition would land on top of it - so every
\ one of these words is written `create name 0 ,`.
: screen
  es ! 0 en !
  begin
    en @ 511 > if quit then
    es @ slice dup slice-valid? 0= if drop quit then
    8 cells + ea ! 2040 el !
    begin el @ while
      ea @ el @ lfc 1 search if swap ec ! 1- el ! else 2drop quit then
      ec @ ea @ - ea @ swap evaluate
      ec @ 1+ ea !
    repeat
    slice-buf slice-link dup es ! 0xffff = if quit then
    en @ 1+ en !
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
