\ ============================================
\ Towers of Hanoi with colored disks
\ for Deep16 Forth kernel (asm/forth.asm)
\ Size of disk = foreground color attribute (high byte foreground nibble)
\ Pegs: 0=left, 1=middle, 2=right
\ ============================================

\ === Screen & memory constants ===
0x1000 constant screen-start   \ screen memory start address
80 constant ncols              \ columns per row
25 constant nrows              \ rows

\ === Screen positioning ===

\ Set screen position variable to (row, col). Byte offset = row*80 + col from screen start.
\ We use POS instead of SCR to avoid conflict with kernel's SCR variable.
: screenset ( row col -- )
    dup ncols * + screen-start +  \ compute byte offset
    to POS ;                      \ store in our position variable

\ === Attribute color words ===

\ Clear the attribute byte (keep character, set attr to 0)
: clear-attr ( -- )
    0 0 ATTR_MASK and
    STS R0, ES, POS
    ADD POS, 1
    ;

\ Set foreground attribute to disk size (0-7), clear background
: set-fg-attr ( size -- )     \ size 0-7, sets foreground color
    dup 15 and                \ ensure size fits in 4 bits
    0 0 ATTR_MASK and         \ clear existing attribute, preserve character
    over 4 lshift             \ size << 4 puts size in foreground position
    OR                        \ combine with cleared attribute
    STS R0, ES, POS           \ write the 16-bit cell
    ADD POS, 1
    ;

\ Write a character with disk-size foreground color at current POS position.
\ char = display character, size = color (0=smallest, 7=largest)
: disk! ( char size -- )
    dup set-fg-attr ;        \ sets attribute, advances POS by 1

\ === Peg & disk state ===

\ Peg states: each peg has 3 disk positions (for up to 3 disks initially)
\ Array index 0 = top disk, index 2 = bottom disk
\ Value = disk size (1=smallest, 2=medium, 3=largest, 0=empty)
\ Created with: create peg-left 3 cells allot

create peg-left  3 cells allot   \ left peg disk positions
create peg-mid   3 cells allot   \ middle peg
create peg-right 3 cells allot   \ right peg

\ === Disk drawing characters ===

\ Disk representation: use [ and ] bracket chars with color attribute
\ Small disk (size 1): [   with color 1
\ Medium disk (size 2): ]   with color 2  
\ Large disk (size 3): \   with color 3 (or another char)

\ === Utility: peg disk at position ===

\ Get disk size at peg position pos (0=top, 2=bottom). Peg addr on stack.
: peg-disk ( peg-addr pos -- size )    \ pos 0=top, 2=bottom
    over + @ ;                          \ addr pos -> addr+pos -> value

\ === Move disk words (specific peg transitions) ===

\ Move top disk from left peg to middle peg
: left-to-mid ( -- )
    peg-left 0 @  dup 0= if
        ." Moving disk size " . 
        0 peg-left !  \ clear top position on left (index 0)
        peg-mid 0 !  \ place disk on top of middle peg
        cr
    else
        ." Left peg empty" cr
    then
    ;

\ Move top disk from left peg to right peg
: left-to-right ( -- )
    peg-left 0 @  dup 0= if
        ." Moving disk size " . 
        0 peg-left !  \ clear top position on left
        peg-right 0 !  \ place on top of right peg
        cr
    else
        ." Left peg empty" cr
    then
    ;

\ Move top disk from middle peg to left peg
: mid-to-left ( -- )
    peg-mid 0 @  dup 0= if
        ." Moving disk size " . 
        0 peg-mid !  \ clear top position on middle
        peg-left 0 !  \ place on top of left peg
        cr
    else
        ." Middle peg empty" cr
    then
    ;

\ Move top disk from middle peg to right peg
: mid-to-right ( -- )
    peg-mid 0 @  dup 0= if
        ." Moving disk size " . 
        0 peg-mid !  \ clear top position on middle
        peg-right 0 !  \ place on top of right peg
        cr
    else
        ." Middle peg empty" cr
    then
    ;

\ Move top disk from right peg to left peg
: right-to-left ( -- )
    peg-right 0 @  dup 0= if
        ." Moving disk size " . 
        0 peg-right !  \ clear top position on right
        peg-left 0 !  \ place on top of left peg
        cr
    else
        ." Right peg empty" cr
    then
    ;

\ Move top disk from right peg to middle peg
: right-to-mid ( -- )
    peg-right 0 @  dup 0= if
        ." Moving disk size " . 
        0 peg-right !  \ clear top position on right
        peg-mid 0 !  \ place on top of middle peg
        cr
    else
        ." Right peg empty" cr
    then
    ;

\ === Initialize game state ===

\ Initialize with n disks on left peg (size 1=smallest on top, size n at bottom)
: init-game ( n -- )    \ n = number of disks (1-3 for our array sizes)
    \ Clear all peg arrays (set all positions to 0 = empty)
    3 0 do peg-left i + ! loop
    3 0 do peg-mid i + ! loop
    3 0 do peg-right i + ! loop
    
    \ Place n disks on left peg from top to bottom: sizes 1,2,3,...,n
    \ Position 0 (top) gets size 1, position 1 gets size 2, etc.
    dup 0 do 
        i 1+ peg-left i + !  \ disk size = i+1 at position i
    loop
    ;

\ === Draw the current game state to screen ===

\ Draw all three pegs with their disks using colored blocks
: draw-pegs ( -- )
    \ Draw left peg at column 10, row 8
    8 10 screenset
    \ Position 0 (top disk)
    peg-left 0 @ 0= if
        ." ["
        peg-left 0 @ 
        disk!
    else
        blank!
    then
    \ Position 1 (middle disk)
    8 11 screenset
    peg-left 1 @ 0= if
        ." ["
        peg-left 1 @ 
        disk!
    else
        blank!
    then
    \ Position 2 (bottom disk)
    8 12 screenset
    peg-left 2 @ 0= if
        ." ["
        peg-left 2 @ 
        disk!
    else
        blank!
    then
    
    \ Draw middle peg at column 40, row 8
    8 40 screenset
    peg-mid 0 @ 0= if
        ." ["
        peg-mid 0 @ 
        disk!
    else
        blank!
    then
    8 41 screenset
    peg-mid 1 @ 0= if
        ." ["
        peg-mid 1 @ 
        disk!
    else
        blank!
    then
    8 42 screenset
    peg-mid 2 @ 0= if
        ." ["
        peg-mid 2 @ 
        disk!
    else
        blank!
    then
    
    \ Draw right peg at column 70, row 8
    8 70 screenset
    peg-right 0 @ 0= if
        ." ["
        peg-right 0 @ 
        disk!
    else
        blank!
    then
    8 71 screenset
    peg-right 1 @ 0= if
        ." ["
        peg-right 1 @ 
        disk!
    else
        blank!
    then
    8 72 screenset
    peg-right 2 @ 0= if
        ." ["
        peg-right 2 @ 
        disk!
    else
        blank!
    then
    ;

\ === Hanoi recursive solver with screen updates ===

\ Move n disks from peg src to peg dst, using temp peg
\ After each single disk move, the screen is updated
: hanoi ( n src dst temp -- )
    dup 0 > if
        \ Step 1: Move n-1 disks from src to temp (using dst as auxiliary)
        hanoi 1 - src temp dst
        
        \ Step 2: Move the nth disk from src to dst (single disk move)
        \ Dispatch to the correct move word based on peg numbers
        \ src dst are 0=left, 1=middle, 2=right
        dup 0= if  \ if src=0 (left peg)
            dup 2= if  \ if dst=2 (right peg)
                left-to-right
            else if 1= if  \ if dst=1 (middle peg)
                left-to-mid
            then
            then
        else if 1= if  \ if src=1 (middle peg)
            dup 2= if  \ if dst=2 (right peg)
                mid-to-right
            else if 0= if  \ if dst=0 (left peg)
                mid-to-left
            then
            then
        else if 2= if  \ if src=2 (right peg)
            dup 0= if  \ if dst=0 (left peg)
                right-to-left
            else if 1= if  \ if dst=1 (middle peg)
                right-to-mid
            then
            then
        then
        then
        
        \ Step 3: Update screen display after the move
        draw-pegs
        
        \ Step 4: Move n-1 disks from temp to dst (using src as auxiliary)
        hanoi 1 - temp dst src
    then
    ;

\ === Demo mode ===

\ Solve Towers of Hanoi with 3 disks, showing each move with screen display
: demo-mode ( -- )
    \ Initialize with 3 disks on left peg
    3 init-game
    
    \ Draw initial state
    draw-pegs
    
    ." Starting Towers of Hanoi solve..." cr
    
    \ Solve: move 3 disks from peg 0 (left) to peg 2 (right), using peg 1 (middle)
    3 0 2 1 hanoi
    
    ." Solved!" cr
    ;

\ === Command words ===

: hanoi-demo ( -- )  demo-mode ;
: hanoi-solve ( n -- )  init-game draw-pegs 3 0 2 1 hanoi ;
: hanoi-help ( -- )
    ." Towers of Hanoi for Deep16 Forth" cr
    ." Size of disk = foreground color attribute" cr
    ." Pegs: 0=left 1=middle 2=right" cr
    ." Disks: 1=smallest, 3=largest" cr
    ." Recursive solution with colored screen display" cr
    ;

\ Quick test
: .test ( -- )
    hanoi-help
    ." Initializing and solving..." cr
    demo-mode
    ;