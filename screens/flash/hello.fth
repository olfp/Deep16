\ screens/flash/hello.fth - flash screen 0, loaded with `0 screen`.
\
\ A screen is one 2 KB page of the on-die FLASH608K: 512 words of four
\ characters. `screen` unpacks it one character per cell and runs it through
\ `included`, so this is ordinary Forth source like any other.
: hello ( -- ) ." hello from the user flash" cr ;
