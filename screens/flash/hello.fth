\ screens/flash/hello.fth - config-flash slice 4, loaded with `4 screen`.
\
\ A source slice is one 4 KB file-system sector: 2040 characters in cells
\ 8..2047. `screen` copies it one character per cell into text-buf and runs it
\ through `included`, so this is ordinary Forth source like any other.
: hello ( -- ) ." hello from the user flash" cr ;
