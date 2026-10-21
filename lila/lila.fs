\ LILA - Lua-light on Forth
\ Prototype host layer (runs under gforth via compat/deepforth-gforth.fs)

include ../compat/deepforth-gforth.fs
include farxt.fs
include hash.fs
include compiler.fs

\ Strings are c-addr u (ANS Forth).

\ A LILA table is a hash table (see lila/hash.fs).
\ Far XTs are two words: ( segment offset ).

\ Placeholder LILA top-level
: lila ( -- )  ." LILA ready" cr ;
