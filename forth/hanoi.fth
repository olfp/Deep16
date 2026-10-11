\ Towers of Hanoi with colored disks
\ for Deep16 Forth kernel (asm/forth.asm)
\ Size of disk = foreground colour attribute.
\ The high byte of a screen cell is (background << 4) | foreground - the
\ usual ANSI order, as in an SGR sequence. Foreground is therefore the LOW
\ nibble: mask with 15, never shift by 4.
\ Pegs: 0=left, 1=middle, 2=right

0x1000 constant screen-start
80 constant ncols
24 constant nrows

\ Set screen position (row, col). Byte offset = row*80 + col from screen start.
: screenset ( row col -- )
    dup ncols * + screen-start +
    to POS

\ Clear the attribute byte (keep character, set attr to 0)
: clear-attr ( -- )
    0 0 ATTR_MASK and
    STS R0, ES, POS
    ADD POS, 1

\ Set foreground attribute to disk size (0-7), clear background.
\ No shift: the foreground belongs in the low nibble, the background in the
\ high one. "over 4 lshift" would put the disk size into the background and
\ paint the whole screen in its colour.
: set-fg-attr ( size -- )
    dup 15 and          \ size in the low nibble, where the foreground is
    0 0 ATTR_MASK and   \ the character, attribute cleared
    OR
    STS R0, ES, POS
    ADD POS, 1

\ Write a character with disk-size foreground color at current POS position.
: disk! ( char size -- )
    dup set-fg-attr

\ Peg states: each peg has 3 disk positions (index 0=top, 2=bottom).
\ Value = disk size (1=smallest, 2=medium, 3=largest, 0=empty).

create peg-left  3 cells allot
create peg-mid   3 cells allot
create peg-right 3 cells allot

\ Move top disk from left peg to middle peg
: left-to-mid ( -- )
    peg-left 0 @
    dup 0=
    if
        ." Moving disk size " .
        0 peg-left !
        peg-mid 0 !
        cr
    else
        ." Left peg empty" cr
    then

\ Move top disk from left peg to right peg
: left-to-right ( -- )
    peg-left 0 @
    dup 0=
    if
        ." Moving disk size " .
        0 peg-left !
        peg-right 0 !
        cr
    else
        ." Left peg empty" cr
    then

\ Move top disk from middle peg to left peg
: mid-to-left ( -- )
    peg-mid 0 @
    dup 0=
    if
        ." Moving disk size " .
        0 peg-mid !
        peg-left 0 !
        cr
    else
        ." Middle peg empty" cr
    then

\ Move top disk from middle peg to right peg
: mid-to-right ( -- )
    peg-mid 0 @
    dup 0=
    if
        ." Moving disk size " .
        0 peg-mid !
        peg-right 0 !
        cr
    else
        ." Middle peg empty" cr
    then

\ Move top disk from right peg to left peg
: right-to-left ( -- )
    peg-right 0 @
    dup 0=
    if
        ." Moving disk size " .
        0 peg-right !
        peg-left 0 !
        cr
    else
        ." Right peg empty" cr
    then

\ Move top disk from right peg to middle peg
: right-to-mid ( -- )
    peg-right 0 @
    dup 0=
    if
        ." Moving disk size " .
        0 peg-right !
        peg-mid 0 !
        cr
    else
        ." Right peg empty" cr
    then

\ Initialize with n disks on left peg (size 1=smallest on top, size n at bottom).
: init-game ( n -- )
    3 0 do peg-left i + ! loop
    3 0 do peg-mid i + ! loop
    3 0 do peg-right i + ! loop
    dup 0 do
        i 1+ peg-left i + !
    loop

\ Draw all three pegs with their disks using colored blocks.
: draw-pegs ( -- )
    8 10 screenset
    peg-left 0 @ 0= if ." [ ]" peg-left 0 @ disk! else blank! then
    8 11 screenset
    peg-left 1 @ 0= if ." [ ]" peg-left 1 @ disk! else blank! then
    8 12 screenset
    peg-left 2 @ 0= if ." [ ]" peg-left 2 @ disk! else blank! then
    8 40 screenset
    peg-mid 0 @ 0= if ." [ ]" peg-mid 0 @ disk! else blank! then
    8 41 screenset
    peg-mid 1 @ 0= if ." [ ]" peg-mid 1 @ disk! else blank! then
    8 42 screenset
    peg-mid 2 @ 0= if ." [ ]" peg-mid 2 @ disk! else blank! then
    8 70 screenset
    peg-right 0 @ 0= if ." [ ]" peg-right 0 @ disk! else blank! then
    8 71 screenset
    peg-right 1 @ 0= if ." [ ]" peg-right 1 @ disk! else blank! then
    8 72 screenset
    peg-right 2 @ 0= if ." [ ]" peg-right 2 @ disk! else blank! then

\ Recursive Hanoi solver with screen update after each move.
\ Dispatches to correct move word based on peg numbers (0=left, 1=middle, 2=right).
: hanoi ( n src dst temp -- )
    dup 0 > if
        hanoi 1 - src temp dst
        \ Dispatch based on source peg
        dup 0= if
            dup 2= if
                left-to-right
            else if 1=
                left-to-mid
            then
        else if 1=
            dup 2= if
                mid-to-right
            else if 0=
                mid-to-left
            then
        then
        else if 2=
            dup 0= if
                right-to-left
            else if 1=
                right-to-mid
            then
        then
        then
        draw-pegs
        hanoi 1 - temp dst src
    then

\ Solve Towers of Hanoi with 3 disks, showing each move with screen display.
: demo-mode ( -- )
    3 init-game
    draw-pegs
    3 0 2 1 hanoi

\ Command words.

: hanoi-demo ( -- )  demo-mode
: hanoi-solve ( n -- )  init-game draw-pegs 3 0 2 1 hanoi