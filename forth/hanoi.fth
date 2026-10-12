\ Towers of Hanoi for the Deep16 Forth kernel.
\
\ Reports the moves as text. It cannot draw the pegs,
\ and that is not taste: Forth in this kernel reaches the
\ program counter and the data stack, but not the screen.
\ There is no word to position the cursor, none that
\ writes a cell, and no inline assembler. `!` cannot
\ reach it either - the screen sits at 0xF1000, a 20-bit
\ address, while a Forth literal is 16 bits and truncates.
\
\ Four kernel quirks shape this file. All four are
\ worked around rather than fixed here, because the fix
\ belongs in the kernel.
\
\   1. `!` leaves its value on the stack. Inside a
\      definition `0 p !` therefore leaves a 0 behind,
\      and the comparison after it sees the wrong stack.
\      set! and clr below swallow that leftover, and
\      every store in this file goes through them.
\
\   2. `to` stores nothing at all. It is IMMEDIATE, so it
\      swallows the token behind it as a name and leaves
\      the variable untouched. Hence set! and not `to`.
\
\   3. `emit` of 10 is a carriage return, not a newline.
\      It moves the cursor to column 0 of the row it is
\      already on; 13 is the line feed. Use cr.
\
\   4. A line longer than 74 characters pushes the cursor
\      onto row 24, the row the 24-row display does not
\      show, and from there the screen never scrolls
\      again. Keep every line here at 74 or below.

\ What the kernel does not have, and this file therefore
\ does not use:
\
\   0x1000      no hex literals in the number scanner
\   ." text"    not IMMEDIATE, so inside a definition it
\               runs while the definition is COMPILED -
\               the text would appear once, at definition
\               time, and never when the word is called.
\   do/loop/i   not implemented; begin/until and
\               while/repeat are
\   lshift,and  no bit operations at all, so not even the
\               colour byte can be built from Forth.
\
\ create and allot work and are used below - a created
\ word behaves like a variable whose data field starts at
\ the address here had when create ran. What a variable
\ cannot give you is a second and third cell: see the pegs
\ below.

\ --- the pegs ---------------------------------------------------------
\
\ A peg is three contiguous cells holding the disk sizes
\ from the top down, 0 meaning empty. They have to be
\ contiguous: move shifts all three slots at once and
\ reaches the lower two by 1 + and 2 +, so a peg has to
\ be one address, and that is what @ and ! take.
\
\ create plus allot, NOT variable. A variable reserves a
\ single cell - the cell above it is already the next
\ word's header, and the one above that its flags and name
\ length. Writing 1 peg-a + therefore overwrites a header
\ and the vocabulary chain breaks with it: every word
\ defined after that peg answers "undefined word", and
\ the disk slots fill up with link and length values.
\ Three cells allotted in one go are the only way to get
\ a three-cell row out of this kernel.

create peg-a 3 cells allot
create peg-b 3 cells allot
create peg-c 3 cells allot

\ --- storing ----------------------------------------------------------
\
\ set! and clr are ! plus the drop that ! omits.

: set! ( value addr -- ) ! drop ;
: clr  ( addr -- ) 0 swap ! drop ;

\ --- output ----------------------------------------------------------
\
\ Text is emitted one character at a time, because the
\ string words do not work inside a definition. Peg
\ letters follow the pegs by address.

: say-disk  68 emit 105 emit 115 emit 107 emit 32 emit ;
: say-from  32 emit 102 emit 114 emit 111 emit 109 emit 32 emit ;
: say-to    32 emit 116 emit 111 emit 32 emit ;

\ 10 emit is not a newline. In this kernel 10 is the
\ carriage return - it puts the cursor in column 0 of the
\ row it is already on - and 13 is the line feed. cr does
\ both, and cr it is: with 10 emit alone every move report
\ overwrote the previous one on the same row.

: newline  cr ;

\ The three pegs live in variables, because report and move
\ both read the pair of them straight out of these, and the
\ recursion passes the peg roles round by swapping two of
\ the three and undoing each swap the moment the recursive
\ call returns.
\
\ The disk count, by contrast, rides on the DATA stack, not
\ in a variable. A variable is global, so a recursive call
\ overwrites it and the outer level comes back to the wrong
\ count - which is what this did with mv-n and mv-n2, and
\ the symptom was one move per level instead of the 2^n-1
\ a Hanoi needs. The data stack is per-invocation and LIFO,
\ so each level keeps its own n until it is done with it.

variable mv-src
variable mv-dst
variable mv-tmp
variable mv-disk

\ peg-letter spends its argument and nothing else. The
\ fall-through needs a drop of its own, and without it the
\ peg address stayed on the stack. Every move whose target
\ was peg-c then left that address behind, the next `1 -`
\ counted it down instead of the disk count, and the whole
\ recursion stopped matching the puzzle.
\
\ Note also that `=` gives -1 for equal and 0 for not
\ equal. if only asks for non-zero, so that is fine here,
\ but a true flag is not always 1 in this kernel.

: peg-letter ( peg -- )
    dup peg-a = if drop 65 emit exit then
    dup peg-b = if drop 66 emit exit then
    drop 67 emit ;

\ The report names the two pegs the recursion has set up,
\ read out of mv-src and mv-dst rather than off the stack,
\ because the data stack belongs to the disk count and
\ nothing else. It runs before the move: after the move
\ that slot on the source is empty and there is nothing
\ left to report.

: report
    say-disk mv-src @ @ . say-from mv-src @ peg-letter
    say-to mv-dst @ peg-letter newline ;

\ --- moving one disk --------------------------------------------------
\
\ One disk leaves the top of the source and lands on the
\ top of the destination, and BOTH pegs shift: the source
\ closes up (its other two disks move one slot towards slot
\ 0) and the destination opens up (what was on top of it
\ moves one slot away). Copying all three slots across,
\ which is what this did at first, moves the whole peg
\ instead of the top disk - and the recursion then reports
\ 1 from A to B over and over, because peg-a still has a 1
\ sitting in slot 0 the whole time.
\
\ move reads the two pegs out of mv-src and mv-dst rather
\ than taking them off the stack, so that the data stack
\ holds nothing but the disk count. report does the same.
\ Both run strictly above the saved n and leave it alone -
\ which matters more than it sounds, because hanoi counts
\ down with `1 -` and a single stray item underneath would
\ be what that `1 -` saw.
\
\ Slot 0 is read once into mv-disk before anything is
\ written, because the shifts overwrite the very cells the
\ later ones would otherwise read. Note the SECOND @ on the
\ first line: mv-disk has to end up holding the DISK, not
\ the address of the peg the disk sits on. With one @ it
\ came back holding peg-a itself, and the last line below
\ then dropped that address into the destination peg, and
\ the next report read it back out as "Disk 13046" - a peg
\ address printed as though it were a disk size.
\
\ Every set! here pushes the value first and the address
\ second, because ! takes the address on TOP. A pair
\ written the other way round stores into the wrong cell,
\ and the two pegs end up a step out of step with each
\ other - which is very hard to see, because the moves
\ still come out in the right order.
\
\ A swap must not keep what it needs to undo itself in a
\ variable. The undo runs AFTER the recursive call returns,
\ and that call has run swaps of its own, so a shared cell
\ comes back holding the inner level's value: the outer
\ level then restores the wrong peg, and the roles are
\ wrong from the second level down. So the two variables
\ are swapped, the recursion runs, and they are swapped
\ back straight - they are back in their original positions
\ when the call returns - and no copy is kept at all.

: move
    mv-src @ @ mv-disk set!       \ the disk that travels
    mv-src @ 1 + @ mv-src @ set!   \ src 0 <- src 1
    mv-src @ 2 + @ mv-src @ 1 + set!   \ src 1 <- src 2
    mv-src @ 2 + clr               \ src 2 = 0
    mv-dst @ 1 + @ mv-dst @ 2 + set!   \ dst 2 <- dst 1
    mv-dst @ @ mv-dst @ 1 + set!       \ dst 1 <- dst 0
    mv-disk @ mv-dst @ set! ;      \ dst 0 <- the disk

: do-move
    report move ;

\ --- the game ---------------------------------------------------------
\
\ At most three disks: that is what three slots hold.
\
\ init leaves the stack as its comment says on every
\ path: the two `if` branches drop the copy they made
\ for the test, the last branch spends n on peg-a.

: init ( n -- )
    peg-a clr  peg-a 1 + clr  peg-a 2 + clr
    peg-b clr  peg-b 1 + clr  peg-b 2 + clr
    peg-c clr  peg-c 1 + clr  peg-c 2 + clr
    dup 3 = if drop
        3 peg-a 2 + set!  2 peg-a 1 + set!  1 peg-a set!
        exit
    then
    dup 2 = if drop
        2 peg-a 1 + set!  1 peg-a set!
        exit
    then
    peg-a set! ;

\ set!, not !: a raw ! leaves the value it stored on the
\ stack. These two run once per recursion level, so the
\ litter would grow with the disk count.

: swap-dst-tmp
    mv-dst @ mv-tmp @ mv-dst set! mv-tmp set! ;

: swap-src-tmp
    mv-src @ mv-tmp @ mv-src set! mv-tmp set! ;

\ recurse, not the word's own name: a word cannot call
\ itself by name while it is still being compiled - the
\ name is not in the dictionary yet and the call goes
\ nowhere. recurse compiles the current word's own xt.
\
\ n rides on the data stack under everything else, which
\ is why report, move and both swaps have to be perfectly
\ balanced. `dup 1 -` leaves n on the stack and hands n-1
\ to the recursive call; after do-move the same `1 -` finds
\ n still on top and hands n-1 to the second half. If any
\ of them leaves one item behind, that item is what this
\ `1 -` sees, and the count stops meaning what it says.

: hanoi ( n -- )
    dup 0> if
        dup 1 -                    \ n n-1: keep n, recurse on n-1
        swap-dst-tmp   recurse   swap-dst-tmp
        do-move
        1 -                        \ back to n-1 for the second half
        swap-src-tmp   recurse   swap-src-tmp
    else
        drop
    then ;

: hanoi-solve ( n -- )
    dup init
    peg-a mv-src set!
    peg-c mv-dst set!
    peg-b mv-tmp set!
    hanoi ;

: hanoi-demo  3 hanoi-solve ;
