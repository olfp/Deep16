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
s" p = (1 + 2) * (3 + 4)" lila-eval  lila-var-p @ 21 check=
s" pp = ((2 + 3) * (4 - 1)) / 5" lila-eval  lila-var-pp @ 3 check=
s" pn = -(1 + 2)" lila-eval  lila-var-pn @ -3 check=
s" 2 3 +" lila-eval          5 check=   \ Forth pass-through

\ control flow: single-line forms, with ';' separating body statements
s" if x > 0 then t = 1 else t = 0 end" lila-eval   lila-var-t @ 1 check=
s" if x < 0 then u = 1 else u = 0 end" lila-eval   lila-var-u @ 0 check=
s" i = 0" lila-eval
s" while i < 3 do i = i + 1 end" lila-eval          lila-var-i @ 3 check=
s" if i > 0 then j = 2 ; k = j + 1 end" lila-eval  lila-var-k @ 3 check=
s" evsum = 0" lila-eval
s" for evi = 1, 4 do evsum = evsum + evi end" lila-eval  lila-var-evsum @ 10 check=
s" evn = 0" lila-eval
s" while evn < 10 do evn = evn + 1 ; break end" lila-eval  lila-var-evn @ 1 check=
s" evb = 0" lila-eval
s" for evj = 1, 10 do evb = evb + evj ; break end" lila-eval  lila-var-evb @ 1 check=

\ file loader: multi-line if/else, nested while, comments, single-line blocks
s" lila/test.lila" lila-load
lila-var-fy @    5 check=
lila-var-fsum @  3 check=
lila-var-fi @    3 check=
lila-var-fneg @  0 check=
lila-var-fmax @  2 check=
lila-var-fgrade @ 20 check=
lila-var-ffor @  6 check=
lila-var-fstep @ 9 check=
lila-var-fdown @ 6 check=
lila-var-fmod @  5 check=
lila-var-fsingle @ 6 check=
lila-var-fnest @ 9 check=
lila-var-fparen @ 21 check=
lila-var-fprec @  9 check=
lila-var-fnegexpr @ -3 check=
lila-var-fcond @ 1 check=
lila-var-frange @ 10 check=
lila-var-fbrk @ 3 check=
lila-var-fbsum @ 6 check=
lila-var-fbi @ 4 check=
lila-var-fbnest @ 33 check=
lila-var-fbsingle @ 1 check=

\ functions and procedures
s" function add(a, b) return a + b end" lila-eval
s" fnadd = add(2, 3)" lila-eval           lila-var-fnadd @ 5 check=
s" fnmul = add(1, 2) * 4" lila-eval       lila-var-fnmul @ 12 check=
s" fnnest = add(add(1, 2), 4)" lila-eval  lila-var-fnnest @ 7 check=
s" function fortytwo() return 42 end" lila-eval
s" fnzero = fortytwo()" lila-eval         lila-var-fnzero @ 42 check=
s" function inc(p) p = p + 1 ; return p end" lila-eval
s" fnp = inc(6)" lila-eval                lila-var-fnp @ 7 check=
s" fnproc = 0" lila-eval
s" function bump(n) fnproc = fnproc + n end" lila-eval
s" bump(5)" lila-eval
s" bump(2)" lila-eval                     lila-var-fnproc @ 7 check=
s" if fortytwo() > 0 then fncond = 1 else fncond = 0 end" lila-eval
lila-var-fncond @ 1 check=
s" function double(x) return x * 2 end" lila-eval
s" function quad(x) return double(double(x)) end" lila-eval
s" fnquad = quad(3)" lila-eval            lila-var-fnquad @ 12 check=

\ functions loaded from a file
lila-var-ffnadd @   5 check=
lila-var-ffnquad @  12 check=
lila-var-ffnsum @   10 check=
lila-var-ffnfirst @ 4 check=
lila-var-ffnclass @ -1 check=
lila-var-ffnfind @  400 check=
lila-var-ffnbrk @   6 check=
lila-var-fntotal @  8 check=
lila-var-ffnproc @  0 check=
lila-var-ffnnothing @ 0 check=
lila-var-ffnlater @ 7 check=

\ tables and strings from lila-eval
s\" tab = {}" lila-eval
s\" tab[\"k\"] = 3" lila-eval
s\" tabv = tab[\"k\"] + 1" lila-eval        lila-var-tabv @ 4 check=
s\" tab[\"k\"] = 8" lila-eval
s\" tabw = tab[\"k\"]" lila-eval            lila-var-tabw @ 8 check=
s\" tabm = tab[\"no\"]" lila-eval           lila-var-tabm @ 0 check=
s\" tab[\"two words\"] = 2" lila-eval
s\" tabx = tab[\"two words\"]" lila-eval    lila-var-tabx @ 2 check=
s\" tab[\"\"] = 4" lila-eval
s\" tabe = tab[\"\"]" lila-eval             lila-var-tabe @ 4 check=
s\" tabcopy = tab" lila-eval
s\" tabc = tabcopy[\"k\"]" lila-eval        lila-var-tabc @ 8 check=
s\" greet = \"hey\"" lila-eval
s\" tab[greet] = 6" lila-eval
s\" tabg = tab[greet]" lila-eval           lila-var-tabg @ 6 check=
s\" print(\"ok\")" lila-eval

\ table and string checks from test.lila
lila-var-ft @ s" a" table-get drop           9 check=
lila-var-ft @ s" b" table-get drop           7 check=
lila-var-ft @ s" hello world" table-get drop 11 check=
lila-var-ft @ s" " table-get drop            3 check=
lila-var-ft @ s" hello" table-get drop      21 check=
lila-var-ftabsum @   12 check=
lila-var-ftabmiss @   0 check=
lila-var-fnested @    4 check=
lila-var-fparam @     8 check=
lila-str-fstr 2@  s" world" compare 0 check=
lila-str-fstr2 2@ s" hello" compare 0 check=

\ string expressions: concatenation, length, comparison
s\" sa = \"foo\"" lila-eval
s\" sb = sa + \"bar\"" lila-eval
s\" sc = \"x\" + \"y\" + \"z\"" lila-eval
s\" print(sc)" lila-eval
s\" sl = length(sc)" lila-eval              lila-var-sl @ 3 check=
s\" sl2 = len(\"hello\") + 1" lila-eval      lila-var-sl2 @ 6 check=
s\" scmp1 = \"abc\" = \"abc\"" lila-eval     lila-var-scmp1 @ -1 check=
s\" scmp2 = \"abc\" = \"abd\"" lila-eval     lila-var-scmp2 @ 0 check=
s\" scmp3 = \"abc\" < \"abd\"" lila-eval     lila-var-scmp3 @ -1 check=
s\" scmp4 = \"b\" > \"a\"" lila-eval         lila-var-scmp4 @ -1 check=
s\" stab = {}" lila-eval
s\" stab[\"k\" + \"2\"] = 17" lila-eval
s\" stabv = stab[\"k2\"]" lila-eval          lila-var-stabv @ 17 check=
s\" scond = 0" lila-eval
s\" if sa = \"foo\" then scond = 1 end" lila-eval  lila-var-scond @ 1 check=

\ string-expression checks from test.lila
lila-str-fgreet 2@ s" hello, world" compare 0 check=
lila-var-fmatch @ 1 check=
lila-str-fmsg 2@  s" n=42!" compare 0 check=
lila-var-ft @ s" k2" table-get drop 17 check=

." lila tests passed" cr
bye
