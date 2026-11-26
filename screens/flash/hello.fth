\ screens/flash/hello.fth - a config-flash source slice, loaded with `30 screen`
\ (or `s" hello" find screen`).
\
\ A source slice is one 4 KB file-system sector: 2040 characters in cells
\ 8..2047. `screen` reads it into slice-buf and interprets it line by line,
\ so this is ordinary Forth source like any other.
: hello ( -- ) ." hello from the user flash" cr ;
