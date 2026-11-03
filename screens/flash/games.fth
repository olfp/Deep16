\ screens/flash/games.fth - the flash game loader, loaded with `9 screen`.
\ A game is a type-4 binary slice; its payload is
\   cell 0  magic 'D16B' (0xD16B)
\   cell 1  format version (1)
\   cell 2  entry offset inside the load segment
\   cell 3  word count of the block
\   cell 4  load segment
\   cell 5+ the block words
\ Continuations are a raw payload and linked, so a game may span any number of
\ 4 KB slices. game-load copies the block into its segment and answers the
\ segment; game-run also far-calls the entry and comes back to the interpreter.
0xFFFF constant no-link
5 constant game-hdr
variable gnext drop
variable goff drop
variable gleft drop
variable gseg drop
variable gentry drop
: gcopy ( a n -- )              \ copy n words from DS:a to ES:goff
  0 do
    dup @  goff @ es!
    goff @ 1+ goff !
    cell+
  loop drop ;
: game-load ( a n -- seg )
  find dup no-link = if drop ." game: not found" cr 0 exit then
  gnext !
  gnext @ slice 8 cells +                    ( payload )
  dup @ 0xD16B <> if drop ." game: bad header" cr 0 exit then
  dup 2 cells + @ gentry !
  dup 3 cells + @ gleft !
  dup 4 cells + @ gseg !
  gseg @ seg-base!
  0 goff !
  game-hdr cells +  gleft @ 2035 min          ( src n )
  dup gleft @ swap - gleft !
  gcopy
  gnext @ slice 1 cells + @ gnext !
  begin
    gleft @ 0>  gnext @ no-link <>  and
  while
    gnext @ slice 8 cells +                  ( src )
    2040 gleft @ min                         ( src n )
    dup gleft @ swap - gleft !
    gcopy
    gnext @ slice 1 cells + @ gnext !
  repeat
  0xF000 seg-base!
  gseg @ ;
: game-run ( a n -- ) game-load call-far ;
