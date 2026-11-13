1920 constant edit-len
80 constant edit-w
24 constant edit-h
variable edit-pos drop
variable edit-done drop
variable ts-lines drop
variable ts-a drop
variable ts-last drop
: edit-clear ( -- ) cls ;                  \ clear, home and reset the scroll offset
: edit-buf ( -- a ) slice-buf 8 cells + ;
: edit-col ( -- c ) edit-pos @ edit-w mod ;
: edit-row ( -- r ) edit-pos @ edit-w / ;
: edit-cursor ( -- )
0xF000 seg-base!
edit-row 8 lshift edit-col 1 lshift or 1 or 0x2000 es!
0 0x2002 es! ;
: edit-tile ( c -- tile )
dup 32 127 within if else drop 32 then
32 - 5 lshift text-attr @ or ;
: edit-draw ( -- )
edit-clear
edit-h 0 do
edit-buf i edit-w * +
dup edit-w +
0 i
tile-row
loop
edit-cursor ;
: edit-left ( -- )
edit-pos @ 0= if exit then
edit-pos @ 1- edit-pos ! ;
: edit-right ( -- )
edit-pos @ edit-len 1- < if edit-pos @ 1+ edit-pos ! then ;
: edit-up ( -- )
edit-pos @ edit-w < if exit then
edit-pos @ edit-w - edit-pos ! ;
: edit-down ( -- )
edit-pos @ edit-len edit-w - < if edit-pos @ edit-w + edit-pos ! then ;
: edit-bol ( -- ) edit-pos @ edit-w / edit-w * edit-pos ! ;
: edit-eol ( -- ) edit-pos @ edit-w / edit-w * edit-w 1- + edit-pos ! ;
: edit-nl ( -- )
edit-pos @ edit-w / 1+ edit-w *  ( next line, column 1 )
dup edit-len < if edit-pos ! else drop then ;
: edit-put ( c -- )
dup edit-buf edit-pos @ + c!
edit-tile
0xF000 seg-base!
edit-pos @ edit-w / 82 * 0x1000 +
edit-pos @ edit-w mod +
es!
edit-right
edit-cursor ;
: edit-bs ( -- )
edit-pos @ 0= if exit then
edit-pos @ 1- edit-pos !
edit-buf edit-pos @ + 32 swap c!
0xF000 seg-base!
edit-pos @ edit-w / 82 * 0x1000 +
edit-pos @ edit-w mod +
0 swap es!
edit-cursor ;
: edit-x ( -- )
key
dup 0x13 = if drop 1 edit-done ! exit then
dup 0x03 = if drop 2 edit-done ! exit then
drop ;
: edit-key ( c -- )
dup 0x18 = if drop edit-x exit then
dup 0x02 = if drop edit-left edit-cursor exit then
dup 0x06 = if drop edit-right edit-cursor exit then
dup 0x10 = if drop edit-up edit-cursor exit then
dup 0x0e = if drop edit-down edit-cursor exit then
dup 0x01 = if drop edit-bol edit-cursor exit then
dup 0x05 = if drop edit-eol edit-cursor exit then
dup 0x0d = if drop edit-nl edit-cursor exit then
dup 0x0a = if drop edit-nl edit-cursor exit then
dup 0x08 = if drop edit-bs exit then
dup 0x7f = if drop edit-bs exit then
dup 32 127 within if edit-put exit then
drop ;
: edit-slice ( n -- )
dup 0 511 within 0= if ." edit-slice: 0..511" cr drop exit then
slice dup slice-valid? 0= if
drop ." edit-slice: no slice" cr exit
then
dup slice-type 0x0C <> if
drop ." edit-slice: not a screen slice" cr exit
then drop
0 edit-done ! 0 edit-pos !
edit-draw
begin key edit-key edit-done @ until
edit-clear 0 edit-pos ! edit-cursor
edit-done @ 1 = if slice-flush else ." discarded" cr then ;
: slice-last ( a -- n )
2040
begin
dup 0= if nip exit then
1-
2dup + c@ 10 =
while repeat
1+ nip ;
: type-slice ( n -- )
dup 0 511 within 0= if ." type-slice: 0..511" cr drop exit then
slice dup slice-valid? 0= if
drop ." type-slice: no slice" cr exit
then
8 cells + dup ts-a ! slice-last ts-last !
cr 0 ts-lines !
ts-last @ 1+ 0 do
ts-a @ i + c@
dup 32 127 within if
emit
else
dup 10 = if
cr
1 ts-lines +!
ts-lines @ 23 = if
i 1+ ts-last @ < if
." -- more --"
key drop cr
0 ts-lines !
then
then
then
drop
then
loop
cr ;
24 constant te-rows
variable te-line drop
variable te-first drop
variable te-col drop
variable te-len drop
variable te-lines drop
variable te-done drop
variable te-xoff drop
variable te-src drop
variable te-dst drop
variable te-endv drop
variable te-row drop
variable te-cur-start drop
variable te-cur-end drop
variable te-tmp drop
variable te-char drop
variable te-ri drop
variable te-wi drop
variable te-dirty drop
variable te-drawn-first drop
variable te-drawn-xoff drop
: te-end ( -- a ) edit-buf te-len @ + ;
: te-skip-line ( a -- a' )
begin
dup te-end = if exit then
dup c@ 10 = if 1+ exit then
1+
again ;
: te-line-start ( n -- a ) edit-buf swap 0 ?do te-skip-line loop ;
: te-line-end ( a -- a' )
begin
dup te-end = if exit then
dup c@ 10 = if exit then
1+
again ;
: te-cur-len ( -- n ) te-cur-end @ te-cur-start @ - ;
: te-normalize ( -- )
0 te-ri ! 0 te-wi !
begin te-ri @ te-len @ < while
te-ri @ edit-buf + c@ 13 = if
te-ri @ 1+ te-len @ < if
te-ri @ 1+ edit-buf + c@ 10 = if
10 te-wi @ edit-buf + c! 1 te-wi +!
2 te-ri +!
else
13 te-wi @ edit-buf + c! 1 te-wi +!
1 te-ri +!
then
else
13 te-wi @ edit-buf + c! 1 te-wi +!
1 te-ri +!
then
else
te-ri @ edit-buf + c@ te-wi @ edit-buf + c! 1 te-wi +!
1 te-ri +!
then
repeat
te-wi @ te-len ! ;
: te-count ( -- n )
0 edit-buf
begin
dup te-end = if
drop te-len @ 0> if edit-buf te-len @ 1- + c@ 10 <> if 1+ then then
exit
then
dup c@ 10 = if swap 1+ swap then
1+
again ;
: te-clamp ( -- )
te-lines @ 0= if 0 te-lines ! 0 te-line ! exit then
te-line @ 0< if 0 te-line ! then
te-line @ te-lines @ 1- > if te-lines @ 1- te-line ! then ;
: te-visible ( -- )
te-line @ te-first @ < if te-line @ te-first ! then
te-line @ te-first @ te-rows + 1- > if te-line @ te-rows 1- - te-first ! then ;
: te-xoff! ( -- )
te-col @ te-xoff @ < if te-col @ te-xoff ! then
te-col @ te-xoff @ 80 + 1- > if te-col @ 79 - te-xoff ! then ;
: te-cursor ( -- )
0xF000 seg-base!
te-line @ te-first @ - 8 lshift
te-col @ te-xoff @ - 1 lshift or 1 or 0x2000 es!
0 0x2002 es! ;
: te-addr ( -- a ) te-cur-start @ te-col @ + ;
: te-tail ( a -- n ) te-end swap - ;
: te-draw ( -- )
te-visible te-xoff!
te-first @ te-line-start te-src !
te-rows 0 do
te-src @ te-line-end te-endv !
te-src @ te-endv @
te-xoff @
i
tile-row
te-endv @ te-end < if
te-endv @ c@ 10 = if te-endv @ 1+ else te-endv @ then
else te-endv @ then
te-src !
loop
te-first @ te-drawn-first !
te-xoff @ te-drawn-xoff !
0 te-dirty !
te-cursor ;
: te-draw-from ( -- )
te-line @ te-first @ - te-row !
te-cur-start @ te-src !
begin te-row @ te-rows < while
te-src @ te-line-end te-endv !
te-src @ te-endv @ te-xoff @ te-row @ tile-row
te-endv @ te-skip-line te-src !
te-row @ 1+ te-row !
repeat
0 te-dirty ! te-cursor ;
: te-draw-line ( -- )
te-visible te-xoff!
te-line @ te-first @ - te-row !
te-cur-start @ te-cur-end @
te-xoff @
te-line @ te-first @ -
tile-row
0 te-dirty !
te-cursor ;
: te-refresh ( -- )
te-line @ te-line-start te-cur-start !
te-cur-start @ te-line-end te-cur-end ! ;
: te-prev ( a -- a' )
dup edit-buf 1+ < if drop edit-buf exit then
1- 1-
begin
dup edit-buf = if exit then
dup c@ 10 = if 1+ exit then
1-
again ;
: move-back ( src dst u -- )
te-tmp ! te-dst ! te-src !
te-tmp @ 0 ?do
te-src @ te-tmp @ + i - 1- c@
te-dst @ te-tmp @ + i - 1- c!
loop ;
: te-insert ( c -- )
te-char !
te-len @ 2040 < 0= if exit then
te-addr te-src !
te-src @ dup te-tail over 1+ swap move-back
te-src @ te-char @ swap c!
1 te-len +!
te-char @ 10 = if 1 te-lines +! 2 te-dirty !
else 1 te-dirty ! te-cur-end @ 1+ te-cur-end ! then
te-clamp ;
: te-delete ( -- )
te-len @ 0= if exit then
te-addr dup te-end = if drop exit then
dup c@ te-char !
dup 1+ te-src !
dup te-tail 1- te-tmp !
te-src @ swap te-tmp @ move
te-len @ 1- te-len !
te-char @ 10 = if te-lines @ 1- te-lines ! 2 te-dirty ! te-refresh
else 1 te-dirty ! te-cur-end @ 1- te-cur-end ! then
te-clamp ;
: te-col-clamp te-col @ te-cur-len > if te-cur-len te-col ! then ;
: te-left
te-col @ 0> if te-col @ 1- te-col ! else
te-line @ 0> if te-line @ 1- te-line ! te-refresh te-cur-len te-col ! then
then ;
: te-right
te-col @ te-cur-len < if te-col @ 1+ te-col ! else
te-line @ 1+ te-lines @ < if te-line @ 1+ te-line ! te-refresh 0 te-col ! then
then ;
: te-up
te-line @ 0> if
te-cur-start @ te-prev te-cur-start !
te-cur-start @ te-line-end te-cur-end !
te-line @ 1- te-line !
te-col-clamp
then ;
: te-down
te-line @ 1+ te-lines @ < if
te-line @ 1+ te-line !
te-cur-end @ te-end < if
te-cur-end @ c@ 10 = if te-cur-end @ 1+ else te-cur-end @ then
else te-cur-end @ then
te-cur-start !
te-cur-start @ te-line-end te-cur-end !
te-col-clamp
then ;
: te-bs
te-col @ 0> if
te-col @ 1- te-col !
te-delete
else
te-line @ 0> if
te-cur-start @ te-prev te-cur-start !
te-line @ 1- te-line !
te-cur-start @ te-line-end te-cur-end !
te-cur-len te-col !
te-delete
then
then ;
: te-enter
10 te-insert
te-line @ 1+ te-line !
0 te-col !
te-refresh
te-clamp ;
: te-put ( c -- ) te-insert 1 te-col +! te-col-clamp ;
: te-x
key
dup 0x13 = if drop 1 te-done ! exit then
dup 0x03 = if drop 2 te-done ! exit then
drop ;
: te-key ( c -- )
dup 0x18 = if drop te-x exit then
dup 0x02 = if drop te-left exit then
dup 0x06 = if drop te-right exit then
dup 0x10 = if drop te-up exit then
dup 0x0e = if drop te-down exit then
dup 0x01 = if drop 0 te-col ! exit then
dup 0x05 = if drop te-cur-len te-col ! exit then
dup 0x0d = if drop te-enter exit then
dup 0x0a = if drop te-enter exit then
dup 0x08 = if drop te-bs exit then
dup 0x7f = if drop te-bs exit then
dup 0x04 = if drop te-delete exit then
dup 32 127 within if te-put exit then
drop ;
: te-save ( -- )
te-len @ 0> if
edit-buf te-len @ 1- + c@ 10 <> if
te-len @ 2040 < if 10 edit-buf te-len @ + c! 1 te-len +! then
then
then
edit-buf te-len @ + 2040 te-len @ - 10 fill
slice-flush ;
: text-edit ( n -- )
dup 0 511 within 0= if ." text-edit: 0..511" cr drop exit then
slice dup slice-valid? 0= if
drop ." text-edit: no slice" cr exit
then
dup slice-type 3 <> if
drop ." text-edit: not a text slice" cr exit
then drop
edit-buf slice-last 1+ te-len !
te-normalize
0 te-line ! 0 te-first ! 0 te-col ! 0 te-xoff ! 0 te-done ! 0 te-dirty !
edit-buf te-cur-start !
te-cur-start @ te-line-end te-cur-end !
te-count te-lines ! te-clamp
edit-clear te-draw
begin
key te-key
te-done @ 0=
while
te-visible te-xoff!
te-first @ te-drawn-first @ <> if te-draw
else
te-xoff @ te-drawn-xoff @ <> if te-draw
else
te-dirty @ 2 = if te-draw-from
else te-dirty @ 1 = if te-draw-line else te-cursor then then
then
then
repeat
edit-clear
te-done @ 1 = if te-save else ." discarded" cr then ;
: list bl word count find type-slice ;
: edit bl word count find text-edit ;
0x40 constant serial-status
0x42 constant serial-data
: serial-emit ( c -- )
begin serial-status es@ 2 and until
serial-data es! ;
: serial-ready? ( -- f ) serial-status es@ 1 and 0<> ;
: serial-key ( -- c )
begin serial-status es@ 1 and until
serial-data es@ 0xff and ;
0x64 constant echo-flag
: mirror-on ( -- )  echo-flag es@ 0x80 or echo-flag es! ;
: mirror-off ( -- ) echo-flag es@ 0x7f and echo-flag es! ;
create serial-buf 128 allot
variable serial-len drop
variable serial-echo drop
: serial-crlf ( -- ) 13 serial-emit 10 serial-emit ;
: serial-eval ( -- )
echo-flag es@ serial-echo !
echo-flag es@ 0x80 or echo-flag es!
serial-buf serial-len @
['] evaluate catch ?dup if
." serial: error " . cr
2drop
then
serial-echo @ echo-flag es! ;
: serial ( -- )
." serial: interpreted, Ctrl-D exits" cr
0 serial-len !
begin
serial-key
dup 0x04 = if drop exit then
dup 0x0d = over 0x0a = or if
drop
serial-crlf
serial-eval
0 serial-len !
else
dup 0x08 = over 0x7f = or if
drop
serial-len @ if
8 serial-emit 32 serial-emit 8 serial-emit
serial-len @ 1- serial-len !
then
else
dup 32 127 within if
dup serial-emit
serial-len @ 128 < if
serial-buf serial-len @ + c!
serial-len @ 1+ serial-len !
else
drop
then
else
drop
then
then
then
again ;
0x01 constant soh
0x04 constant eot
0x06 constant ack
0x15 constant nak
0x18 constant can
0x43 constant crc-req
variable x-buf drop
variable x-len drop
variable x-blk drop
variable x-run drop
variable x-cnext drop
variable x-hs drop
variable x-pblk drop
variable x-pnblk drop
variable x-pcrc drop
variable x-max drop
variable x-abort drop
variable x-done drop
variable x-stage drop
variable x-info drop
variable x-cnt drop
create x-pack 66 allot
create x-frame 132 allot
: x-abort? ( -- f ) key? if key drop true else false then ;
: crc-byte ( crc b -- crc )
8 lshift xor
8 0 do
dup 0x8000 and if 1 lshift 0x1021 xor else 1 lshift then
loop 0xffff and ;
: crc-block ( addr len -- crc )
0 x-run !
0 do
dup i + c@ x-run @ swap crc-byte x-run !
loop drop x-run @ ;
: x-ack ( -- ) ack serial-emit ;
: x-nak ( -- ) nak serial-emit ;
: x-now ( -- ms ) 0x22 es@ ;
: x-unp ( -- )
66 0 do
i x-pack + @
dup 0xff and x-frame i 2* + c!
8 rshift x-frame i 2* 1+ + c!
loop ;
: x-recv ( -- )
begin
x-abort @ if exit then
x-abort? if 9 x-stage ! 1 x-abort ! exit then
serial-ready? if
serial-key
dup soh = if
drop
x-pack 66 serial-read
0 x-hs !
dup x-cnt ! 5 x-stage !
dup 66 <> if ." short " . cr 9 x-stage ! 1 x-abort ! exit then
drop
x-unp
x-frame c@ x-pblk !
x-frame 1+ c@ x-pnblk !
x-pblk @ x-pnblk @ + 0xff <> if ." seq" cr x-nak exit then
x-len @ 128 + x-max @ > if ." big" cr x-nak exit then
x-frame 2 + 128 crc-block
x-frame 130 + c@ 8 lshift x-frame 131 + c@ or x-pcrc !
x-pcrc @ x-info ! 6 x-stage !
x-pcrc @ <> if
." crc " x-pblk @ . ." n " x-cnt @ .
." o " serial-status es@ 4 and .
." g " x-pcrc @ . ." w " x-frame 2 + 128 crc-block . cr
x-nak exit
then
x-frame 2 + x-buf @ x-len @ + 128 move
x-pblk @ x-blk @ = if
x-len @ 128 + x-len !
x-blk @ 1+ 0xff and x-blk !
x-len @ x-info ! 7 x-stage !
." ." x-ack
else
x-pblk @ x-blk @ 1- 0xff and = if ." =" x-ack else x-nak then
then
exit
then
dup eot = if x-hs @ 0= if 8 x-stage ! drop x-ack 1 x-done ! exit then then
drop
else
x-hs @ if
x-now x-cnext @ - 0< 0= if
crc-req serial-emit
x-now 1000 + x-cnext !
then
then
then
again ;
: x-trim ( -- )
begin
x-len @ 0> if
x-buf @ x-len @ 1- + c@
dup 0x1a = swap 0 = or
else false then
while
x-len @ 1- x-len !
repeat ;
: x-flush-kbd ( -- ) 16 0 do key? if key drop then loop ;
: x-flush-uart ( -- ) 1 0x46 es! ;
: xmodem ( -- )
  x-flush-kbd
  x-flush-uart
  2 x-stage !
  ." xmodem: receiving (CRC). Press key to abort" cr
here x-buf !
0 x-len !
1 x-blk !
1 x-hs !
0 x-abort !
0 x-done !
unused 1024 - x-max !
crc-req serial-emit
begin
x-abort @ 0= x-done @ 0= and
while
x-recv
repeat
x-abort @ if
can serial-emit can serial-emit
." xmodem: aborted" cr exit
then
x-trim
x-len @ allot
10 x-stage !
cr ." xmodem: " x-len @ . ." bytes" cr
x-buf @ x-len @ included ;
