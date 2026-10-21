\ LILA compiler smoke tests for the gforth host prototype.
\ Run with: gforth lila/test.fs

include lila.fs

: check= ( actual expected -- )
  = 0= if ." lila test FAILED" cr bye then ;

s" x = 5" lila-eval          lila-var-x @ 5 check=
s" y = x + 3" lila-eval      lila-var-y @ 8 check=
s" z = x * 2 + 1" lila-eval  lila-var-z @ 11 check=
s" w = x + 3 * 2" lila-eval  lila-var-w @ 11 check=
s" n = -3" lila-eval         lila-var-n @ -3 check=
s" q = x-3" lila-eval        lila-var-q @ 2 check=
s" r = x + -3" lila-eval     lila-var-r @ 2 check=
s" s = 10 / 2" lila-eval     lila-var-s @ 5 check=
s" 2 3 +" lila-eval          5 check=   \ Forth pass-through

\ control flow: single-line forms, with ';' separating body statements
s" if x > 0 then t = 1 else t = 0 end" lila-eval   lila-var-t @ 1 check=
s" if x < 0 then u = 1 else u = 0 end" lila-eval   lila-var-u @ 0 check=
s" i = 0" lila-eval
s" while i < 3 do i = i + 1 end" lila-eval          lila-var-i @ 3 check=
s" if i > 0 then j = 2 ; k = j + 1 end" lila-eval  lila-var-k @ 3 check=

\ file loader: multi-line if/else, nested while, comments, single-line blocks
s" lila/test.lila" lila-load
lila-var-fy @    5 check=
lila-var-fsum @  3 check=
lila-var-fi @    3 check=
lila-var-fneg @  0 check=
lila-var-fmax @  2 check=

." lila tests passed" cr
bye
