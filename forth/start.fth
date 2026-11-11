\ forth/start.fth - slice 1: the boot start words.
\ Loaded by the baked boot loader with `1 screen`.
here constant dict-base
 256 constant kernel-base
24576 constant window-words
unused 0x4000 u> constant psram?

: ver ." DeepForth 1.1  BIOS 1.0  FPGA 1.1" cr ;
: free ( -- d )    unused 0 ;
: .addr ( u -- )    hex 0 u.r decimal ;
: u. ( u -- )     0 u.r ;

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
    ."            (kernel, data and the baked boot source)" cr
    ."   free     " here .addr ." -55FF     " free d. ." words" cr
    ."   BIOS     5600-57FF   reserved for the UART console" cr
    ."   stacks   5800-5FFF   2048 words (RP 5800 up, SP 5FF0 down)" cr
    ."   UART F0040-F004F      boot ROM FFFF0-FFFFF (16 words)" cr
  then
  cr ;
