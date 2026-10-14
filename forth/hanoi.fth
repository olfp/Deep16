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
\ Only 4 is still true. 1 is fixed, 2 is narrower than it says, and
\ 3 was never a bug - all three are written up here because this
\ file once believed otherwise and the reasons are worth keeping.
\
\   1. `!` used to leave its value on the stack: it popped the
\      address and then read the value off the top without popping
\      it, so one leftover grew per store, without bound inside a
\      loop and under the peg the next dup expected. Fixed in the
\      kernel, and every store below is now a plain !.
\
\   2. `to` is narrower than this file once said. It does store -
\      at the prompt and inside a definition - and it takes the
\      name AFTER itself, so it is `5 to tv` and not `5 tv to`.
\      What it cannot do is reach a CREATE'd word's data field: it
\      writes the DOES> cell, and the word then jumps through the
\      value on its next use and the interpreter dies. peg-a and
\      its sisters are CREATE'd, so this file uses ! and not `to`.
\
\   3. Not a bug, and this file used to believe it was. An if
\      compiled inside a begin/while/repeat body runs on every
\      pass, not only the first. The claim rested on a loop spelled
\      begin...repeat with no while at all - and a repeat with no
\      while patches begin's compile-time entry as if it were the
\      branch's and jumps into nothing. pcount below is the
\      branch-free form it was rewritten into on that false belief.
\      It answers the same either way.
\
\   4. The input buffer holds 128 characters and drops the rest, so
\      a line longer than that is typed but cut off. Keep lines at
\      78 or below. It was 86 and nothing checked the write against
\      it, so a longer line ran past the end into the messages that
\      follow the buffer and quietly overwrote them.
\
\ What the kernel used not to have, and what this file therefore
\ does not use. Three of these four arrived on 2026-10-14; only the
\ loop is still missing:
\   0x1000      hex literals, once missing from the number
\               scanner, so a colour byte had to be written as
\               decimal; $1F and 0x1F both work now
\   ." text"    once not IMMEDIATE, so inside a definition it ran
\               while the definition was COMPILED - the text
\               appeared once, at definition time, and never when
\               the word was called. It is IMMEDIATE now: the text
\               is copied into the definition and printed on the
\               call
\   and,lshift  bit operations, once missing, so not even the
\               colour byte could be built from Forth
\   do/loop/i   still not implemented; begin/until and while/repeat
\               are, and this file uses those
\
\ What this file does with the newer ones anyway: the colour bytes
\ below are still decimal, because hex literals were the later
\ arrival and the decimals were already in place - both are the
\ same bytes either way.
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
\ A bare variable reserves ONE cell, and the cell above it is
\ already the next word's header, with its flags and name length
\ above that. Writing 1 peg-a + then overwrites a header and the
\ vocabulary chain breaks with it: every word defined after that peg
\ answers "undefined word", and the disk slots fill up with link and
\ length values. So the peg needs ND cells RESERVED, and `6 cells
\ allot` after a variable does that just as well as after a create -
\ the dictionary steps over the allotted cells either way.
\
\ This used to say create plus allot was the ONLY way to get a
\ multi-cell row out of this kernel. It is not. Variable plus allot
\ was measured, not assumed: the board comes out byte-identical at 3,
\ 4 and 5 disks, and the dictionary survives a write to the last
\ allotted cell.
\
\ dclr below does need create, for a different reason: `,` stores
\ at HERE, and HERE is a created word's body but is already past a
\ variable's cell. That is the classic CREATE-and-comma idiom, and
\ it is why the two declarations here do not look alike.
\
\ pa, pb and pc hold the three peg addresses, so the loops below
\ use plain variables. A variable pushes its own address, so with
\ `variable peg-a` the line below stores that address; a created
\ word would have had to be RUN to produce the same thing.

variable peg-a 6 cells allot
variable peg-b 6 cells allot
variable peg-c 6 cells allot

\ --- storing ----------------------------------------------------------

\ set! and clr used to be ! and 0 swap ! plus the drop that ! omitted.
\ ! popped the address and then read the value off the top without popping
\ it, so one leftover grew per store - without bound inside a loop, and
\ in a loop it landed under the peg the next dup expected. ! pops both
\ now, so nothing in this file needs a wrapper for it any more and
\ clr below is only 0 swap !.

: clr  ( addr -- ) 0 swap ! ;

variable pa  peg-a pa !
variable pb  peg-b pb !
variable pc  peg-c pc !

\ --- the board --------------------------------------------------------

\ nd is the number of slots in a peg, and the board is laid out
\ around it: pegs 12 columns apart at 12, 39 and 66, so the widest
\ disk (13 wide) fits three times over without touching.

variable nd  6 nd !
variable ca  12 ca !
variable cb  39 cb !
variable cc  66 cc !

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
: put ( cell row col -- ) scr scr! ;

\ blank is put with a space for the cell. The value goes on AFTER scr, not
\ before: scr spends the top two items as row and column, so a 32 pushed
\ first would be read as the column and the address would land nowhere near
\ row 18. The swap is what puts the value under the address for scr!, which
\ takes its address on top.

: blank ( row col -- ) scr 32 swap scr! ;

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
\ It runs while the slot it is looking at is NOT empty, which leaves
\ the condition on the stack for the while branch and needs no branch
\ of its own. That is a choice and not a workaround: an if compiled
\ inside a begin/while/repeat body runs on every pass, so note 3's
\ claim that it could not was wrong. What this form does rely on is
\ peg-clr having emptied every slot past the disks, which it does -
\ and a peg with a hole in the middle would UNDERCOUNT, stopping at
\ the hole rather than counting past it.

: pcount ( peg -- n )
    0 ts !
    begin dup ts @ + @ 0 <> while
        ts @ 1 + ts !
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
    0 ts !
    begin ts @ nd @ 4 * 1 + < while
        tr @ tc @ nd @ 2 * - ts @ + blank
        ts @ 1 + ts !
    repeat ;

\ draw-disk draws one disk: the character's in every cell and the
\ colour is the disk's own, taken from dclr by size.
\
\ The column runs left to right from tc - td, so the disk sits
\ centred on the peg. Getting that subtraction the wrong way round
\ sends the column negative, and the cell lands on the row above
\ at the far right - which looks like a drawing bug and is one.

: draw-disk ( disk row col -- )
    tc ! tr ! td !
    0 ts !
    begin ts @ td @ 2 * 1 + < while
        td @ 1 - 8 mod dclr + @
        tr @ tc @ td @ - ts @ + put
        ts @ 1 + ts !
    repeat ;

\ peg-row draws one row of one peg: the pole, and the disk that
\ belongs on that row if there is one. The disks of a peg holding
\ n of them sit on rows 23-n to 22, counted up from the ground.

\ peg-row0 draws one row of one peg without clearing it first: the
\ pole, and the disk that belongs on that row if there is one. The
\ disks of a peg holding n of them sit on rows 23-n to 22, counted up
\ from the ground.
\
\ It is a word rather than a block inside peg-draw because it is a
\ different job: peg-draw clears the column before it draws, and do-move
\ needs the row drawn WITHOUT that clear, since the row is bare pole with
\ no disk on it. Note 3 once claimed an if could not be inlined into a
\ loop body at all; that was wrong, and the separate word is here for the
\ clear-or-not difference rather than for the compiler.

: peg-row0 ( peg row -- )
    tr ! tp !
    tp @ pcount tn !
    tp @ pcol tc !
    892 tr @ tc @ put
    tr @ 23 - tn @ + ts !
    ts @ 0 < if exit then
    ts @ tn @ < if
        tp @ ts @ + @ dup 0 <> if
            tr @ tc @ draw-disk
        else drop then
    then ;

\ peg-row is peg-row0 after clearing the row, for a redraw in place:
\ a disk has just left this peg and something of it is still there.
\
\ draw-board does NOT use this one, and that is what it is for. draw-board
\ clears the screen itself and then draws every peg, so all 1725 blanks
\ this would write are writing a space over a space - nearly half the
\ cost of drawing the board, spent on nothing. do-move does use it,
\ because there the screen is not being cleared and the row really is
\ dirty.
\
\ tr and tc are set here rather than left to peg-row0, because
\ wipe-row reads them and runs FIRST. It used to wipe the row and column
\ of whatever peg was drawn before it - which put a gap in the ground
\ one out of every peg row it touched, and looked for all the world
\ like the ground itself was being drawn wrong.
\
\ The dup and the over are both needed, and they are not
\ interchangeable: dup copies the TOP of the stack, which after
\ `dup tr !` is the row, so `dup tp !` stores the ROW into tp
\ and pcol is then handed a row number. It answers with cc - the
\ fall-through, the one column it has for a peg it does not
\ recognise - and every disk lands on peg C.

: peg-row ( peg row -- )
    dup tr !
    over tp !
    tp @ pcol tc !
    wipe-row peg-row0 ;

\ peg-draw is all 23 rows above the ground.

: peg-draw ( peg -- )
    tp !
    0 tr !
    begin tr @ 23 < while
        tp @ tr @ peg-row0
        tr @ 1 + tr !
    repeat ;

\ cls is the BIOS's own screen clear and is about five times cheaper than
\ doing it here: a screenful from Forth is a word call and some address
\ arithmetic per cell, roughly 29 steps, where the BIOS does five. draw-board
\ wants exactly what cls does - clear, cursor home - so it says cls rather
\ than repeating it badly.
\ The screen goes blank and the cursor block at the top left is cleared by cls
\ itself, so the board does not have to blank that cell again.

: clr-screen  cls ;

\ The ground is the bottom row, and drawing it before the pegs is
\ what stops a peg's wipe-row from cutting a hole in it.

: draw-ground
    0 ts !
    begin ts @ 80 < while
        856 23 ts @ put
        ts @ 1 + ts !
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
    0 ts !
    begin ts @ nd @ < while
        dup ts @ + clr
        ts @ 1 + ts !
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
    tn !
    0 ts !
    begin ts @ tn @ < while
        ts @ 1 + pa @ ts @ + !
        ts @ 1 + ts !
    repeat ;

\ init leaves nothing on the stack on any path. It used to handle
\ 1, 2 and 3 disks in three separate branches, which capped the
\ puzzle at three; the loop does any number up to nd, and taking
\ n above nd writes past peg A into the dictionary, which is the
\ failure the pegs note above describes.

: init ( n -- )
    dup tn !
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
\ Neither needs a branch: each loop walks a fixed number of slots and the
\ work per slot is the same copy in both. shift-peg walks up from 0 and
\ open-peg walks down from nd-1, because each overwrites the cell the other
\ would read next.

: shift-peg ( peg -- )
    tp !
    0 ts !
    begin ts @ nd @ 1 - < while
        tp @ ts @ 1 + + @ tp @ ts @ + !
        ts @ 1 + ts !
    repeat ;

: open-peg ( peg -- )
    tp !
    nd @ 2 - ts !
    0 tn !
    begin tn @ nd @ 1 - < while
        tp @ ts @ + @ tp @ ts @ 1 + + !
        ts @ 1 - ts !
        tn @ 1 + tn !
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
\ Every store here pushes the value first and the address second,
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
    mv-src @ @ mv-disk !       \ the disk that travels
    mv-src @ shift-peg            \ the source closes up
    mv-src @ nd @ 1 - + clr       \ and its top slot is empty
    mv-dst @ open-peg             \ the destination opens up
    mv-disk @ mv-dst @ ! ;     \ and the disk lands on it

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
    23 mv-src @ pcount - r0 !
    22 mv-dst @ pcount - r1 !
    \ Row 23 is the ground. A source peg that is empty gives 23-0, and
    \ wiping that row would saw a gap out of the ground - hanoi never
    \ moves off an empty peg, so this only happens if do-move is driven
    \ by hand from one peg. Row 22 is the one above the ground and is
    \ the right place for the answer anyway.
    r0 @ 23 = if 22 r0 ! then
    move
    mv-src @ r0 @ peg-row
    mv-dst @ r1 @ peg-row ;

\ --- the game ---------------------------------------------------------

: swap-dst-tmp
    mv-dst @ mv-tmp @ mv-dst ! mv-tmp ! ;

: swap-src-tmp
    mv-src @ mv-tmp @ mv-src ! mv-tmp ! ;

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
    peg-a mv-src !
    peg-c mv-dst !
    peg-b mv-tmp !
    draw-board
    hanoi ;

\ Five disks is 31 moves, which is long enough to watch and short
\ enough to sit through. The screen holds six; see nd above.

: hanoi-demo  5 hanoi-solve ;