\ Towers of Hanoi for the Deep16 Forth kernel.
\
\ It draws the board itself: three pegs, a ground line and a
\ stack of coloured disks on each, in the screen buffer. Nothing
\ here goes through emit, and nothing scrolls.
\
\ --- how it reaches the screen -------------------------------------
\
\ The buffer is at physical 0xF1000, which is ES:0x1000, and
\ that is out of reach of `!`. ! and @ address through DS, whose
\ base is 0 and whose offset is 16 bits, so between them they
\ cover 0x00000-0x0FFFF; the buffer is 20 bits up, and a Forth
\ literal cannot even name it. This file used to say here that
\ drawing was impossible, and it was right until scr@ and scr!
\ arrived: the same two words with ES in place of DS. The offset
\ is still 16 bits, which is no hindrance - the whole buffer is
\ 0x1000 to 0x17BF.
\
\ A cell is its character in the low byte and an attribute in
\ the high one, foreground in the low nibble and background in
\ the high nibble. Attribute 0 is "no colour", which leaves the
\ terminal's own default alone, so black needs no special case.
\ 892 is a yellow '|' and 856 a yellow 'X'; the disk colours are
\ in dclr below, which is why no arithmetic on colour appears at
\ the call sites.
\
\ --- what the kernel will not do ----------------------------------
\
\ These four are worked around here rather than fixed in the
\ kernel, because the fix belongs in the kernel.
\
\   1. `!` leaves its value on the stack. Inside a definition
\      `0 p !` therefore leaves a 0 behind, and the comparison
\      after it sees the wrong stack. set! and clr below
\      swallow that leftover, and every store in this file goes
\      through them.
\
\   2. `to` stores nothing at all. It is IMMEDIATE, so it
\      swallows the token behind it as a name and leaves the
\      variable untouched. Hence set! and not `to`.
\
\   3. if compiled INSIDE a begin/while/repeat body runs its
\      body only on the first pass. while, repeat, if and then
\      all push and pop the same return stack at compile time,
\      and inside a loop the if's patch is the wrong entry. The
\      loop itself still runs the right number of times - only
\      the branch inside it is lost. So no word below has an if
\      between its begin and its repeat. An if in a word that a
\      loop calls is fine: that is compiled outside the loop.
\
\   4. The input buffer holds 86 characters, so a line longer
\      than that is not interpreted as it was typed. Keep lines
\      at 78 or below.
\
\ What the kernel does not have, and this file therefore does
\ not use:
\   0x1000      no hex literals in the number scanner
\   ." text"    not IMMEDIATE, so inside a definition it runs
\               while the definition is COMPILED - the text
\               would appear once, at definition time, and
\               never when the word is called
\   do/loop/i   not implemented; begin/until and while/repeat
\               are
\   and,lshift  no bit operations, so not even the colour byte
\               can be built from Forth
\
\ create and allot work and are used below - a created word
\ behaves like a variable whose data field starts at the address
\ here had when create ran. What a variable cannot give you is a
\ second and third cell: see the pegs below.
\
\ --- the pegs ---------------------------------------------------------
\
\ A peg is ND contiguous cells holding the disk sizes from the top
\ down, 0 meaning empty. They have to be contiguous: move shifts
\ all of them at once and reaches the lower ones by 1 + and 2 +,
\ so a peg has to be one address, and that is what @ and ! take.
\
\ ND is 6 because the widest disk is 13 columns wide and has to
\ fit between two pegs with a gap, and because that is also the
\ most disks this screen can show: a 7th disk would be 15 wide
\ and would run off the left of peg A.
\
\ create plus allot, NOT variable. A variable reserves a single
\ cell - the cell above it is already the next word's header, and
\ the one above that its flags and name length. Writing 1 peg-a +
\ therefore overwrites a header and the vocabulary chain breaks
\ with it: every word defined after that peg answers "undefined
\ word", and the disk slots fill up with link and length values.
\ ND cells allotted in one go are the only way to get a multi-cell
\ row out of this kernel.
\
\ pa, pb and pc hold the three peg addresses, because a created
\ word is a thing to run and this file prefers plain variables in
\ the loops below.

create peg-a 6 cells allot
create peg-b 6 cells allot
create peg-c 6 cells allot

\ --- storing ----------------------------------------------------------

\ set! and clr are ! plus the drop that ! omits. That is also why
\ every variable in this file is written through set! and not with
\ a bare !: one leftover per store grows without bound inside a
\ loop, and the growth lands under the peg the next dup expects.
\
\ They come before anything that uses them, which sounds obvious
\ and was not: pa, pb and pc below are set through set!, and with
\ these two words defined afterwards all three silently fail and
\ the board draws from three uninitialised cells.

: set! ( value addr -- ) ! drop ;
: clr  ( addr -- ) 0 swap ! drop ;

variable pa  peg-a pa set!
variable pb  peg-b pb set!
variable pc  peg-c pc set!

\ --- the board --------------------------------------------------------

\ nd is the number of slots in a peg, and the board is laid out
\ around it: pegs 12 columns apart at 12, 39 and 66, so the widest
\ disk (13 wide) fits three times over without touching.

variable nd  6 nd set!
variable ca  12 ca set!
variable cb  39 cb set!
variable cc  66 cc set!

\ The colours of the disks, smallest first. A cell is the value,
\ so a disk of size 3 reads dclr + 2. Eight entries, and a ninth
\ disk takes the first colour again.

create dclr
    803 , 1059 , 1315 , 1571 , 291 , 547 , 2339 , 2595 ,  8 cells allot

\ Scratch, for the drawing loops. None of them may be live across
\ a call to another word below that also uses one - they are all
\ leaf helpers except peg-row, which is the only one that reads
\ tc and tn after calling anything.

variable ts
variable tr
variable tc
variable td
variable tn
variable tp
variable r0
variable r1

\ scr turns a row and a column into the ES offset of that cell.
\ put takes the cell's value, a row and a column.

: scr ( row col -- offset ) swap 80 * + 4096 + ;
: put ( cell row col -- ) scr scr! drop ;

\ blank is put with a space for the cell. The value goes on AFTER scr, not
\ before: scr spends the top two items as row and column, so a 32 pushed
\ first would be read as the column and the address would land nowhere near
\ row 18. The swap is what puts the value under the address for scr!, which
\ takes its address on top.

: blank ( row col -- ) scr 32 swap scr! drop ;

\ pcol answers which column a peg stands in. The drop on the
\ fall-through path is not optional: without it the peg address
\ stays on the stack, and the caller that expected only a column
\ finds an address under it.

: pcol ( peg -- col )
    dup pa @ = if drop ca @ exit then
    dup pb @ = if drop cb @ exit then
    drop cc @ ;

\ pcount is how many disks are on a peg. The disks are always
\ contiguous from slot 0 - move closes the gap it opens - so the
\ count is the index of the first empty slot.
\
\ It cannot use if: see note 3 above. Instead it runs while the
\ slot it is looking at is NOT empty, which leaves the condition
\ on the stack for the while branch and never needs a branch of
\ its own. It relies on peg-clr having emptied every slot past the
\ disks, which it does; a peg with a hole in the middle would
\ count the whole peg.

: pcount ( peg -- n )
    0 ts set!
    begin dup ts @ + @ 0 <> while
        ts @ 1 + ts set!
    repeat drop ts @ ;

\ wipe-row clears one row across the widest a disk can be, so a
\ disk that has just left its peg leaves nothing behind.
\
\ The window is the whole reach of a disk, and it has to be
\ centred: the widest disk is nd*2+1 wide and sits on the peg
\ column, so it runs nd*2 either side of it. Clearing only one
\ side - which is what this did, nd*2+1 cells running from
\ tc-nd*2 - gets the left half and leaves the right half of every
\ disk that moves, and the pegs fill up with a stub of each one.

: wipe-row
    0 ts set!
    begin ts @ nd @ 4 * 1 + < while
        tr @ tc @ nd @ 2 * - ts @ + blank
        ts @ 1 + ts set!
    repeat ;

\ draw-disk draws one disk: the character's in every cell and the
\ colour is the disk's own, taken from dclr by size.
\
\ The column runs left to right from tc - td, so the disk sits
\ centred on the peg. Getting that subtraction the wrong way round
\ sends the column negative, and the cell lands on the row above
\ at the far right - which looks like a drawing bug and is one.

: draw-disk ( disk row col -- )
    tc set! tr set! td set!
    0 ts set!
    begin ts @ td @ 2 * 1 + < while
        td @ 1 - 8 mod dclr + @
        tr @ tc @ td @ - ts @ + put
        ts @ 1 + ts set!
    repeat ;

\ peg-row draws one row of one peg: the pole, and the disk that
\ belongs on that row if there is one. The disks of a peg holding
\ n of them sit on rows 23-n to 22, counted up from the ground.

: peg-row ( peg row -- )
    tr set! tp set!
    tp @ pcount tn set!
    tp @ pcol tc set!
    wipe-row
    892 tr @ tc @ put
    tr @ 23 - tn @ + ts set!
    ts @ 0 < if exit then
    ts @ tn @ < if
        tp @ ts @ + @ dup 0 <> if
            tr @ tc @ draw-disk
        else drop then
    then ;

\ peg-draw is all 23 rows above the ground.

: peg-draw ( peg -- )
    tp set!
    0 tr set!
    begin tr @ 23 < while
        tp @ tr @ peg-row
        tr @ 1 + tr set!
    repeat ;

: clr-screen
    0 ts set!
    begin ts @ 1920 < while
        32 ts @ 4096 + scr! drop
        ts @ 1 + ts set!
    repeat ;

\ The ground is the bottom row, and drawing it before the pegs is
\ what stops a peg's wipe-row from cutting a hole in it.

: draw-ground
    0 ts set!
    begin ts @ 80 < while
        856 23 ts @ put
        ts @ 1 + ts set!
    repeat ;

\ draw-board starts from a blank screen. That is also what hides
\ the cursor: the block sits in the cell at the hardware cursor
\ position, and blanking that cell leaves nothing of it. Nothing
\ below emits, so it never comes back.
\
\ What does print is the REPL's own ` ok` and prompt, which land
\ at the cursor once this word returns - that is the top left, and
\ the cursor cell there is peg A's pole, which the prompt blanks.
\ Everything from row 4 down is untouched by that, and the board is
\ left where it is until the next word draws.

: draw-board
    clr-screen draw-ground
    pa @ peg-draw pb @ peg-draw pc @ peg-draw ;

\ --- the pegs, emptied and filled --------------------------------------

: peg-clr ( peg -- )
    0 ts set!
    begin ts @ nd @ < while
        dup ts @ + clr
        ts @ 1 + ts set!
    repeat drop ;

\ fill-a stacks n disks on peg A, smallest on top.
\
\ Slot 0 is the top, and move takes slot 0 off one peg and puts
\ it on slot 0 of another, so slot i has to hold disk i+1.
\
\ It held n-i instead, which is the same stack upside down: the
\ largest disk went in slot 0, move therefore moved the largest
\ one first, and the board drew the widest disk at the top. The
\ puzzle still solved - every disk is still moved once, from one
\ peg to another - so nothing checked the order and the mistake
\ only showed as a picture with the big end in the air.

: fill-a ( n -- )
    tn set!
    0 ts set!
    begin ts @ tn @ < while
        ts @ 1 + pa @ ts @ + set!
        ts @ 1 + ts set!
    repeat ;

\ init leaves nothing on the stack on any path. It used to handle
\ 1, 2 and 3 disks in three separate branches, which capped the
\ puzzle at three; the loop does any number up to nd, and taking
\ n above nd writes past peg A into the dictionary, which is the
\ failure the pegs note above describes.

: init ( n -- )
    dup tn set!
    pa @ peg-clr pb @ peg-clr pc @ peg-clr
    tn @ fill-a ;

\ --- moving one disk --------------------------------------------------
\
\ The disk count and the roles of the three pegs. The count rides
\ on the DATA stack, not in a variable: a variable is global, so a
\ recursive call overwrites it and the outer level comes back to
\ the wrong count - which is what this did with mv-n, and the
\ symptom was one move per level instead of the 2^n-1 a Hanoi
\ needs. The data stack is per-invocation and LIFO, so each level
\ keeps its own n until it is done with it.
\
\ mv-src, mv-dst and mv-tmp are declared before move and do-move
\ because those two words are compiled against them: a word that
\ is not in the dictionary yet when its caller is compiled is an
\ undefined word there and then.

variable mv-src
variable mv-dst
variable mv-tmp
variable mv-disk
\
\ shift-peg closes a peg up: every disk moves one slot towards
\ slot 0, and the slot it vacated is emptied. open-peg does the
\ reverse, walking the other way down so that a disk is read
\ before the slot above it is overwritten.
\
\ Neither has an if between its begin and its repeat - see note 3
\ - because a branch there runs once and not at all.

: shift-peg ( peg -- )
    tp set!
    0 ts set!
    begin ts @ nd @ 1 - < while
        tp @ ts @ 1 + + @ tp @ ts @ + set!
        ts @ 1 + ts set!
    repeat ;

: open-peg ( peg -- )
    tp set!
    nd @ 2 - ts set!
    0 tn set!
    begin tn @ nd @ 1 - < while
        tp @ ts @ + @ tp @ ts @ 1 + + set!
        ts @ 1 - ts set!
        tn @ 1 + tn set!
    repeat ;

\ One disk leaves the top of the source and lands on the top of
\ the destination, and BOTH pegs shift: the source closes up (its
\ other disks move one slot towards slot 0) and the destination
\ opens up (what was on top of it moves one slot away). Copying all
\ three slots across, which is what this did at first, moves the
\ whole peg instead of the top disk - and the recursion then
\ reports 1 from A to B over and over, because peg-a still has a 1
\ sitting in slot 0 the whole time.
\
\ The shifts are loops over all ND slots and not the three lines
\ they replaced, which is a change of peg size rather than of
\ logic. Those three lines were written for a three-slot peg and
\ say nothing about the rest: with ND raised to 6 they still moved
\ slots 0 to 2 and zeroed slot 2, so the disks that were in slots
\ 3 and above stayed where they were and the one in slot 2 was
\ destroyed. The peg then read [4 3 0 2 1 0] instead of
\ [4 3 2 1 0 0], pcount stopped at the first hole and answered 2,
\ and the board below drew disks on peg A that were not there.
\
\ move reads the two pegs out of mv-src and mv-dst rather than
\ taking them off the stack, so that the data stack holds nothing
\ but the disk count. do-move does the same. Both run strictly
\ above the saved n and leave it alone - which matters more than it
\ sounds, because hanoi counts down with `1 -` and a single stray
\ item underneath would be what that `1 -` saw.
\
\ Slot 0 is read once into mv-disk before anything is written,
\ because the shifts overwrite the very cells the later ones would
\ otherwise read. Note the SECOND @ on the first line: mv-disk has
\ to end up holding the DISK, not the address of the peg the disk
\ sits on. With one @ it came back holding peg-a itself, and the
\ last line below then dropped that address into the destination
\ peg, and the next pcount read it back out as a full peg.
\
\ Every set! here pushes the value first and the address second,
\ because ! takes the address on TOP. A pair written the other way
\ round stores into the wrong cell, and the two pegs end up a step
\ out of step with each other - which is very hard to see, because
\ the moves still come out in the right order.
\
\ A swap must not keep what it needs to undo itself in a variable.
\ The undo runs AFTER the recursive call returns, and that call has
\ run swaps of its own, so a shared cell comes back holding the
\ inner level's value: the outer level then restores the wrong peg,
\ and the roles are wrong from the second level down. So the two
\ variables are swapped, the recursion runs, and they are swapped
\ back straight - they are back in their original positions when
\ the call returns - and no copy is kept at all.

: move
    mv-src @ @ mv-disk set!       \ the disk that travels
    mv-src @ shift-peg            \ the source closes up
    mv-src @ nd @ 1 - + clr       \ and its top slot is empty
    mv-dst @ open-peg             \ the destination opens up
    mv-disk @ mv-dst @ set! ;     \ and the disk lands on it

\ The disk count and the roles of the three pegs. The count rides
\ on the DATA stack, not in a variable: a variable is global, so a
\ recursive call overwrites it and the outer level comes back to
\ the wrong count - which is what this did with mv-n, and the
\ symptom was one move per level instead of the 2^n-1 a Hanoi
\ needs. The data stack is per-invocation and LIFO, so each level
\ keeps its own n until it is done with it.

\ A move is the top disk of one peg becoming the top disk of
\ another, so exactly TWO rows change: the row the disk left goes
\ back to being bare pole, and the row it landed on becomes a disk.
\ Redrawing those two rows is the whole of the animation, and it
\ costs a fifth of redrawing all three pegs.
\
\ The rows have to be worked out BEFORE the move, because the pegs
\ are different pegs with different heights afterwards: the source
\ had n disks and its top one was on row 23-n, while the
\ destination had m and its new disk lands on row 22-m.

: do-move
    23 mv-src @ pcount - r0 set!
    22 mv-dst @ pcount - r1 set!
    \ Row 23 is the ground. A source peg that is empty gives 23-0, and
    \ wiping that row would saw a gap out of the ground - hanoi never
    \ moves off an empty peg, so this only happens if do-move is driven
    \ by hand from one peg. Row 22 is the one above the ground and is
    \ the right place for the answer anyway.
    r0 @ 23 = if 22 r0 set! then
    move
    mv-src @ r0 @ peg-row
    mv-dst @ r1 @ peg-row ;

\ --- the game ---------------------------------------------------------

: swap-dst-tmp
    mv-dst @ mv-tmp @ mv-dst set! mv-tmp set! ;

: swap-src-tmp
    mv-src @ mv-tmp @ mv-src set! mv-tmp set! ;

\ recurse, not the word's own name: a word cannot call itself by
\ name while it is still being compiled - the name is not in the
\ dictionary yet and the call goes nowhere. recurse compiles the
\ current word's own xt.
\
\ n rides on the data stack under everything else, which is why
\ do-move and both swaps have to be perfectly balanced. `dup 1 -`
\ leaves n on the stack and hands n-1 to the recursive call; after
\ do-move the same `1 -` finds n still on top and hands n-1 to the
\ second half. If any of them leaves one item behind, that item is
\ what this `1 -` sees, and the count stops meaning what it says.

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
    draw-board
    hanoi ;

\ Five disks is 31 moves, which is long enough to watch and short
\ enough to sit through. The screen holds six; see nd above.

: hanoi-demo  5 hanoi-solve ;