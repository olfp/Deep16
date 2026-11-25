\ lila-native.fth - an on-device LILA compiler and bytecode VM.
\
\ `lila` is a session: it reads one line at a time from the console, tokenizes
\ it, parses it, emits bytecode into l-code and runs that bytecode on a small
\ VM.  The globals and the symbol table carry from line to line; an unfinished
\ statement asks for another line, an empty line ends the session.
\
\ Supported subset (anything else is rejected with a negative code):
\   globals, integer and float literals, string literals (no escapes),
\   unary minus, + - * / // % ^, relationals, == ~=, .. (right associative),
\   parentheses, assignment, print(...), if / else / end, while / do / end,
\   do / end, -- comments.
\ Not in this profile: functions, locals, tables, bitwise operators, and /
\ or / not, varargs, multiple values, #, libraries.
\
\ A value is three cells ( value1 value2 tag ) with the same tags as
\ lila/value.fs: 0 nil, 1 number, 2 boolean, 3 string, 5 float.  A number is
\ a signed 32-bit two's-complement pair (low high); a float is the IEEE
\ single with the low half first, the order the kernel float words use.
\
\ The long form of this design lives in lila/LILANATIVE.md.

\ --- bytecode ---
 0 constant OP-PUSH
 1 constant OP-LOAD
 2 constant OP-STORE
 3 constant OP-ADD
 4 constant OP-SUB
 5 constant OP-MUL
 6 constant OP-DIV
 7 constant OP-NE
 8 constant OP-EQ
 9 constant OP-GE
10 constant OP-LT
11 constant OP-LE
12 constant OP-GT
13 constant OP-JMP
14 constant OP-JZ
15 constant OP-PRINT
16 constant OP-TAB
17 constant OP-EOL
18 constant OP-PUSHS
19 constant OP-CONCAT
20 constant OP-HALT
21 constant OP-NEG
22 constant OP-PUSHF
23 constant OP-POW
24 constant OP-IDIV
25 constant OP-MOD

\ --- storage ---
create l-src 768 allot
variable l-src-n drop
variable l-ti drop
create l-tok-a 256 allot
create l-tok-n 256 allot
create l-tok-k 256 allot
variable l-ntok drop
variable l-pos drop
create l-code 1024 allot
variable l-pc drop
variable l-cp drop
create l-sym 256 allot
create l-sym-n 16 allot
variable l-nsym drop
create l-vars 48 allot
create l-arena 500 allot
variable l-ap drop
create l-rstr 200 allot
variable l-rp drop
variable l-bop drop
variable l-bright? drop
variable l-bprec drop
variable l-min drop
variable l-got drop
variable l-alen drop
variable l-sa drop
variable l-sn drop
variable c-tot drop
variable c-a1 drop
variable c-n1 drop
variable c-a2 drop
variable c-n2 drop
variable l-num-a drop
variable l-num-n drop
variable l-plo drop
variable l-phi drop
variable l-qlo drop
variable l-qhi drop
variable m-alo drop
variable m-ahi drop
variable m-blo drop
variable m-bhi drop
variable l-expr-xt drop
variable l-stmt-xt drop
variable l-save-nsym drop
variable l-save-ap drop

\ --- static text fragments ---
create k-if    105 c, 102 c,
create k-then  116 c, 104 c, 101 c, 110 c,
create k-else  101 c, 108 c, 115 c, 101 c,
create k-end   101 c, 110 c, 100 c,
create k-while 119 c, 104 c, 105 c, 108 c, 101 c,
create k-do    100 c, 111 c,
create k-print 112 c, 114 c, 105 c, 110 c, 116 c,
create p-plus  43 c,
create p-minus 45 c,
create p-star  42 c,
create p-slash 47 c,
create p-dslash 47 c, 47 c,
create p-percent 37 c,
create p-caret 94 c,
create p-lt    60 c,
create p-gt    62 c,
create p-le    60 c, 61 c,
create p-ge    62 c, 61 c,
create p-eq    61 c, 61 c,
create p-set   61 c,
create p-ne    126 c, 61 c,
create p-cat   46 c, 46 c,
create p-lp    40 c,
create p-rp    41 c,
create p-comma 44 c,
create m-lerr  76 c, 69 c, 82 c, 82 c,
create s-true  116 c, 114 c, 117 c, 101 c,
create s-false 102 c, 97 c, 108 c, 115 c, 101 c,
create s-nil   110 c, 105 c, 108 c,

\ --- helpers ---
: l-err ( code -- ) m-lerr 4 type space . cr ;

: l-ws? ( c -- f )
  dup 32 = over 10 = or over 9 = or swap 13 = or ;
: l-digit? ( c -- f )
  dup 48 < 0= swap 58 < and ;
: l-lower? ( c -- f )
  dup 97 < 0= swap 123 < and ;
: l-upper? ( c -- f )
  dup 65 < 0= swap 91 < and ;
: l-id0? ( c -- f )
  dup l-lower? over l-upper? or swap 95 = or ;
: l-id? ( c -- f )
  dup l-id0? over l-digit? or nip ;
: l-src@ ( i -- c )
  dup l-src-n @ < 0= if drop 0 else l-src + c@ then ;

\ Current token access; an empty stream means the statement is unfinished.
: l-eof? ( -- f ) l-pos @ l-ntok @ < 0= ;
: l-tstart ( i -- a ) l-tok-a + @ l-src + ;
: l-tlen ( i -- n ) l-tok-n + @ ;
: l-cur ( -- a n ) l-eof? if l-src 0 else l-pos @ l-tstart l-pos @ l-tlen then ;
: l-cur= ( ca cn -- f ) l-cur compare 0= ;
: l-op? ( ca cn -- f )
  l-eof? if 2drop false exit then
  l-pos @ l-tok-k + @ 4 <> if 2drop false exit then
  l-cur= ;
: l-kind@ ( -- k ) l-pos @ l-tok-k + @ ;

\ l-want: the current token has to be the keyword; -23 at the end.
: l-want ( ca cn code -- )
  >r
  l-eof? if r> -23 throw then
  l-cur compare 0= if 1 l-pos +! r> drop exit then
  r> throw ;

: l-op! ( ca cn code -- )
  l-eof? if -23 throw then
  l-pos @ l-tok-k + @ 4 <> if throw then
  l-want ;

\ bytecode emission
: code, ( x -- ) l-cp @ l-code + ! 1 l-cp +! ;
: code2, ( x op -- ) code, code, ;
: here-cp ( -- i ) l-cp @ ;
: l-patch ( slot -- ) here-cp swap l-code + ! ;
: l-jz ( -- slot ) OP-JZ code, here-cp 1 l-cp +! ;
: l-jmp ( -- slot ) OP-JMP code, here-cp 1 l-cp +! ;

\ --- source input ---
\ The prompt is "L> "; lila prints the newline the BIOS does not.
: l-prompt ( -- ) ." L> " ;

\ Read one line into the pending source; true when the line was empty.
: l-line ( -- f )
  l-src-n @ l-src + 120 accept l-got !
  cr
  l-got @ 0= if true exit then
  l-src l-src-n @ + l-got @ + 10 swap c!
  l-src-n @ l-got @ + 1+ l-src-n !
  l-src-n @ 700 > if -1 l-err 0 l-src-n ! then
  false ;

\ --- tokenizer ---
: l-tok-add ( start len kind -- )
  l-ntok @ 255 > if -2 throw then
  l-ntok @ l-tok-k + !
  l-ntok @ l-tok-n + !
  l-ntok @ l-tok-a + !
  1 l-ntok +! ;
: l-skip-comment
  begin l-ti @ l-src-n @ < while
    l-ti @ l-src@ 10 = if 1 l-ti +! exit then
    1 l-ti +!
  repeat ;

\ An exponent marker: e or E, an optional sign and a digit.
: l-exp ( -- f )
  l-ti @ l-src@ dup 101 = swap 69 = or 0= if false exit then
  l-ti @ 1+ l-src@ dup 43 = over 45 = or if
    drop l-ti @ 2 + l-src@
  else
    drop l-ti @ 1+ l-src@
  then
  l-digit? 0= if false exit then
  1 l-ti +!
  l-ti @ l-src@ dup 45 = over 43 = or if drop 1 l-ti +! else drop then
  begin l-ti @ l-src@ l-digit? while
    1 l-ti +!
  repeat
  true ;

\ A number: digits, maybe a point with fraction digits, maybe an exponent.
: l-scan-number
  l-ti @ >r
  begin l-ti @ l-src@ l-digit? while
    1 l-ti +!
  repeat
  1 l-alen !
  r@ 1+ l-src@ 46 = r@ 1+ 1+ l-src@ l-digit? and if
    2 l-ti +!
    begin l-ti @ l-src@ l-digit? while
      1 l-ti +!
    repeat
    5 l-alen !
  then
  l-exp if 5 l-alen ! then
  r@ l-ti @ r@ - l-alen @ l-tok-add r> drop ;
: l-scan-name
  l-ti @ >r
  begin l-ti @ l-src-n @ < while
    l-ti @ l-src@ l-id? 0= if
      r@ l-ti @ r@ - 2 l-tok-add r> drop exit then
    1 l-ti +!
  repeat
  r@ l-ti @ r@ - 2 l-tok-add r> drop ;
: l-scan-string
  l-ti @ 1+ l-ti !
  l-ti @ >r
  begin l-ti @ l-src-n @ < while
    l-ti @ l-src@
    dup 34 = if
      drop
      r@ l-ti @ r@ - 3 l-tok-add
      r> drop 1 l-ti +! exit
    then
    dup 10 = if drop -3 throw then
    dup 92 = if drop -4 throw then
    drop 1 l-ti +!
  repeat
  -5 throw ;
: l-2nd= ( c -- f ) l-ti @ 1+ l-src@ = ;
: l-pair? ( c -- f )
  dup 60 = if drop 61 l-2nd= exit then
  dup 62 = if drop 61 l-2nd= exit then
  dup 61 = if drop 61 l-2nd= exit then
  dup 126 = if drop 61 l-2nd= exit then
  dup 46 = if drop 46 l-2nd= exit then
  dup 47 = if drop 47 l-2nd= exit then
  drop false ;
: l-token ( -- )
  l-ti @ l-src@
  dup l-ws? if drop 1 l-ti +! exit then
  dup 45 = if
    l-ti @ 1+ l-src@ 45 = if drop l-skip-comment exit then
    drop l-ti @ 1 4 l-tok-add 1 l-ti +! exit
  then
  dup l-digit? if drop l-scan-number exit then
  dup l-id0? if drop l-scan-name exit then
  dup 34 = if drop l-scan-string exit then
  dup l-pair? if
    drop l-ti @ 2 4 l-tok-add 2 l-ti +! exit then
  drop l-ti @ 1 4 l-tok-add 1 l-ti +! ;
: l-tokenize
  0 l-ntok ! 0 l-ti !
  begin l-ti @ l-src-n @ < while l-token repeat ;

\ --- symbol table ---
: l-sym-addr ( i -- a ) 16 * l-sym + ;
: l-sym-len@ ( i -- n ) l-sym-n + @ ;
: l-slot ( a n -- slot )
  l-sn ! l-sa !
  l-sn @ 15 > if -6 throw then
  l-nsym @ 0 ?do
    l-sn @ i l-sym-len@ = if
      l-sa @ l-sn @ i l-sym-addr i l-sym-len@ compare 0= if
        i unloop exit
      then
    then
  loop
  l-nsym @ 15 > if -6 throw then
  l-nsym @ >r
  l-sa @ r@ l-sym-addr l-sn @ cmove
  l-sn @ r@ l-sym-n + !
  r> 1 l-nsym +! ;

\ compile a string into the arena
: l-astr ( a n -- addr )
  l-alen !
  l-ap @ l-alen @ + 1+ 500 > if -7 throw then
  l-ap @ >r
  l-alen @ r@ l-arena + !
  r@ 1+ l-arena +
  l-alen @ cmove
  l-ap @ l-alen @ 1+ + l-ap !
  r> l-arena + ;

\ --- parser ---
\ Multiply an unsigned 32-bit pair by ten; a carry out is -22.
: l-10* ( lo hi -- lo' hi' )
  swap 10 um* rot 10 um*
  l-qhi ! l-qlo ! l-phi ! l-plo !
  l-qhi @ 0<> if -22 throw then
  l-phi @ l-qlo @ +
  dup l-phi @ u< if -22 throw then
  l-plo @ swap ;

\ Accumulate into a 32-bit pair; reject what the payload cannot hold.
: l-num ( a n -- lo hi )
  l-num-n ! l-num-a !
  0 0
  l-num-n @ 0 ?do
    l-10*
    l-num-a @ i + c@ 48 - 0 d+
  loop
  dup 0< if -22 throw then ;
: l-expr0 ( -- ) 0 l-expr-xt @ execute ;

\ A float literal goes through the kernel's own number scanner.
: l-primary ( -- )
  l-eof? if -23 throw then
  l-kind@
  dup 1 = if drop
    l-pos @ l-tstart l-pos @ l-tlen l-num
    OP-PUSH code, swap code, code,
    1 l-pos +! exit then
  dup 5 = if drop
    l-pos @ l-tstart l-pos @ l-tlen evaluate
    OP-PUSHF code, swap code, code,
    1 l-pos +! exit then
  dup 3 = if drop
    l-pos @ l-tstart l-pos @ l-tlen l-astr
    OP-PUSHS code2, 1 l-pos +! exit then
  dup 2 = if drop
    l-pos @ l-tstart l-pos @ l-tlen l-slot
    OP-LOAD code2, 1 l-pos +! exit then
  drop
  p-lp 1 -9 l-op!                 \ -23 at the end, -9 for anything else
  l-expr0
  p-rp 1 -10 l-op! ;               \ -23 at the end, -10 for anything else

\ Unary minus binds looser than the power: -2^2 is -(2^2).
: l-unary ( -- )
  p-minus 1 l-op? if
    1 l-pos +!
    l-min @ >r l-bop @ >r
    7 l-expr-xt @ execute
    r> l-bop ! r> l-min !
    OP-NEG code,
  else l-primary then ;

: l-setop ( prec op right -- prec ) l-bright? ! l-bop ! ;
: l-binop ( -- prec )
  l-pos @ l-ntok @ < 0= if 0 exit then
  p-caret  1 l-op? if 7 OP-POW  1 l-setop exit then
  p-dslash 2 l-op? if 6 OP-IDIV 0 l-setop exit then
  p-percent 1 l-op? if 6 OP-MOD 0 l-setop exit then
  p-slash  1 l-op? if 6 OP-DIV  0 l-setop exit then
  p-cat   2 l-op? if 4 OP-CONCAT 1 l-setop exit then
  p-eq    2 l-op? if 3 OP-EQ 0 l-setop exit then
  p-ne    2 l-op? if 3 OP-NE 0 l-setop exit then
  p-lt    1 l-op? if 3 OP-LT 0 l-setop exit then
  p-le    2 l-op? if 3 OP-LE 0 l-setop exit then
  p-ge    2 l-op? if 3 OP-GE 0 l-setop exit then
  p-gt    1 l-op? if 3 OP-GT 0 l-setop exit then
  p-plus  1 l-op? if 5 OP-ADD 0 l-setop exit then
  p-minus 1 l-op? if 5 OP-SUB 0 l-setop exit then
  p-star  1 l-op? if 6 OP-MUL 0 l-setop exit then
  0 ;

: l-expr ( min -- )
  l-min !
  l-unary
  begin
    l-binop
    dup 0<> over l-min @ < 0= and
  while
    l-bprec !
    1 l-pos +!
    l-bright? @ if l-bprec @ else l-bprec @ 1+ then
    l-min @ >r
    l-bop @ >r
    recurse
    r> l-bop ! r> l-min !
    l-bop @ code,
  repeat drop ;
' l-expr l-expr-xt !

\ --- statements ---
: l-assign ( -- )
  l-pos @ l-tstart l-pos @ l-tlen l-slot
  1 l-pos +!
  p-set 1 -21 l-op!                \ -23 at the end, -21 for anything else
  l-expr0
  OP-STORE code2, ;

: l-print ( -- )
  1 l-pos +!
  p-lp 1 -19 l-op!                 \ -23 at the end, -19 for anything else
  l-expr0 OP-PRINT code,
  begin p-comma 1 l-op? while
    1 l-pos +!
    OP-TAB code,
    l-expr0 OP-PRINT code,
  repeat
  p-rp 1 -20 l-op!                 \ -23 at the end, -20 for anything else
  OP-EOL code, ;

: l-block ( -- )
  begin
    l-pos @ l-ntok @ < 0= if exit then
    k-end 3 l-cur= if exit then
    k-else 4 l-cur= if exit then
    l-stmt-xt @ execute
  again ;

: l-if-stmt ( -- )
  1 l-pos +!
  l-expr0
  l-jz
  k-then 4 -14 l-want              \ -23 at the end, -14 for anything else
  l-block
  k-else 4 l-cur= if
    1 l-pos +!
    l-jmp
    swap l-patch
    l-block
    l-patch
  else l-patch then
  k-end 3 -15 l-want ;             \ -23 at the end, -15 for anything else

: l-while-stmt ( -- )
  1 l-pos +!
  here-cp
  l-expr0
  l-jz
  k-do 2 -16 l-want                \ -23 at the end, -16 for anything else
  l-block
  OP-JMP code,
  >r
  code,
  r> l-patch
  k-end 3 -17 l-want ;             \ -23 at the end, -17 for anything else

: l-do-stmt ( -- )
  1 l-pos +!
  l-block
  k-end 3 -18 l-want ;             \ -23 at the end, -18 for anything else

: l-stmt ( -- )
  l-eof? if -23 throw then
  l-kind@ 2 <> if -13 throw then
  k-if    2 l-cur= if l-if-stmt exit then
  k-while 5 l-cur= if l-while-stmt exit then
  k-do    2 l-cur= if l-do-stmt exit then
  k-print 5 l-cur= if l-print exit then
  l-assign ;

: l-program ( -- )
  begin l-pos @ l-ntok @ < while l-stmt repeat
  OP-HALT code, ;

' l-stmt l-stmt-xt !

\ --- VM ---
: vnum ( lo hi -- lo hi 1 ) 1 ;
: vbool ( f -- b 0 2 ) if -1 else 0 then 0 2 ;

\ Multiply two 32-bit pairs modulo 2^32.
: d* ( alo ahi blo bhi -- lo hi )
  m-bhi ! m-blo ! m-ahi ! m-alo !
  m-alo @ m-blo @ um*
  m-alo @ m-bhi @ um* drop +
  m-ahi @ m-blo @ um* drop + ;

: v-load ( slot -- )
  3 * l-vars +
  dup @ over 1+ @ rot 2 + @ ;
: v-store ( p1 p2 tag slot -- )
  3 * l-vars + >r
  r@ 2 + !
  r@ 1+ !
  r@ !
  r> drop ;
\ Lua truthiness: only nil and false are falsy.
: v-falsy? ( v1 v2 tag -- f )
  dup 0 = if drop 2drop true exit then
  dup 2 = if drop drop 0= exit then
  drop 2drop false ;
: v-print ( v1 v2 tag -- )
  dup 5 = if drop f. exit then
  dup 1 = if drop 0 d.r exit then
  dup 3 = if drop type exit then
  dup 2 = if drop drop if s-true 4 type else s-false 5 type then exit then
  drop 2drop s-nil 3 type ;
: vpushs ( a -- a+1 len 3 ) dup @ swap 1+ swap 3 ;
: v-concat ( a1 n1 t1 a2 n2 t2 -- a n 3 )
  drop c-n2 ! c-a2 ! drop c-n1 ! c-a1 !
  c-n1 @ c-n2 @ + c-tot !
  l-rp @ c-tot @ + 1+ 200 > if -11 throw then
  l-rp @ l-rstr + >r
  c-tot @ r@ !
  c-a1 @ r@ 1+ c-n1 @ cmove
  c-a2 @ r@ 1+ c-n1 @ + c-n2 @ cmove
  l-rp @ c-tot @ 1+ + l-rp !
  r> 1+ c-tot @ 3 ;

\ --- floats ---
\ A float is a pair of cells, the low half of the IEEE single first, the
\ order the kernel float words use.  The kernel has to be an FPU image.
\ The operands of a binary operator are A (m-alo m-ahi, tag l-plo) and
\ B (m-blo m-bhi, tag l-phi); an int is converted with v-i2f, which reads
\ the signed high half and the plain low half of the pair separately.
: v-i2f ( lo hi -- flo fhi )
  c-a1 !
  dup 32768 and c-n2 !
  c-n2 @ -
  s>f
  c-n2 @ if 0x0000 0x4700 f+ then
  0x0000 0x4780
  c-a1 @ s>f
  f* f+ ;

: v-fa ( -- flo fhi )
  m-alo @ m-ahi @ l-plo @ 5 = if exit then v-i2f ;
: v-fb ( -- flo fhi )
  m-blo @ m-bhi @ l-phi @ 5 = if exit then v-i2f ;

\ Take the two operands off the value stack and check that both are numbers.
: v-take ( a1 a2 atag b1 b2 btag -- )
  >r m-bhi ! m-blo ! l-plo ! m-ahi ! m-alo ! r> l-phi !
  l-plo @ 1 = l-plo @ 5 = or l-phi @ 1 = l-phi @ 5 = or and 0= if -26 throw then ;

\ The floor of a float: f>s truncates toward zero, so one is taken off
\ when the value is below the truncated one.
: v-ffloor ( flo fhi -- t )
  2dup f>s >r
  2dup r@ s>f f<
  if 2drop r> 1- else 2drop r> then ;

: v-fdiv ( -- flo fhi )
  m-blo @ 0= m-bhi @ 0= and if -24 throw then
  v-fa v-fb f/ ;

\ The quotient as a whole number: it has to fit in a signed cell.
: v-qt ( -- t )
  v-fdiv
  fdup 0x0000 0x4700 f< 0= if -25 throw then
  fdup 0x0000 0xC700 f< if -25 throw then
  v-ffloor ;

\ The arithmetic operators share a word: the opcode picks the kernel float
\ word or the 32-bit word; a division is always a float.
create l-fops ' f+ , ' f- , ' f* ,
create l-iops ' d+ , ' d- , ' d* ,
: op-arith
  v-take
  l-code l-pc @ + @ 3 - l-qlo !
  l-plo @ 5 = l-phi @ 5 = or l-qlo @ 3 = or l-qhi !
  l-qlo @ 3 = if v-fdiv else
    l-qhi @ if l-fops else l-iops then l-qlo @ + @ >r
    l-qhi @ if v-fa v-fb else m-alo @ m-ahi @ m-blo @ m-bhi @ then
    r> execute
  then
  l-qhi @ if 5 else 1 then
  1 l-pc +! ;

\ The six comparisons share a word: the opcode picks the test (f= or f<),
\ whether to swap the operands and whether to negate the answer.
create l-fcmp ' f= , ' f< ,
create l-icmp ' d= , ' d< ,
: op-cmp
  v-take
  l-code l-pc @ + @ l-qlo !
  l-plo @ 5 = l-phi @ 5 = or l-qhi !
  l-qlo @ 8 > if 1 else 0 then c-tot !
  l-qhi @ if v-fa v-fb else m-alo @ m-ahi @ m-blo @ m-bhi @ then
  l-qlo @ 10 > if 2swap then
  l-qhi @ if l-fcmp else l-icmp then c-tot @ + @ execute
  dup l-qlo @ 1 and if 0= swap drop else drop then
  vbool 1 l-pc +! ;

\ The power is a float in Lua.  An integer exponent up to 64 is a chain
\ of multiplications; anything else goes through exp and log.
: op-pow
  v-take
  l-phi @ 1 = m-bhi @ 0= and m-blo @ 65 u< and if
    0x0000 0x3F80
    m-blo @ 0 ?do
      v-fa f*
    loop
  else
    v-fa flog
    v-fb f*
    fexp
  then
  5 1 l-pc +! ;

: op-idiv
  v-take
  v-qt c-a2 !
  l-plo @ 1 = l-phi @ 1 = and if
    c-a2 @ s>d vnum
  else
    c-a2 @ s>f 5
  then
  1 l-pc +! ;

\ The remainder is the dividend less the floor of the quotient times the
\ divisor, so it takes the sign of the divisor.
: op-mod
  v-take
  v-qt c-a2 !
  l-plo @ 1 = l-phi @ 1 = and if
    m-alo @ m-ahi @
    c-a2 @ s>d
    m-blo @ m-bhi @ d*
    d- vnum
  else
    v-fa
    c-a2 @ s>f
    v-fb f*
    f- 5
  then
  1 l-pc +! ;

: op-push
  l-code l-pc @ 1+ + @
  l-code l-pc @ 2 + + @
  1 3 l-pc +! ;
: op-load  l-code l-pc @ 1+ + @ v-load 2 l-pc +! ;
: op-store l-code l-pc @ 1+ + @ v-store 2 l-pc +! ;
: op-jmp l-code l-pc @ 1+ + @ l-pc ! ;
: op-jz
  v-falsy? >r
  l-code l-pc @ 1+ + @
  r> if l-pc ! else drop 2 l-pc +! then ;
: op-print v-print 1 l-pc +! ;
: op-tab 9 emit 1 l-pc +! ;
: op-eol cr 1 l-pc +! ;
: op-pushs l-code l-pc @ 1+ + @ vpushs 2 l-pc +! ;
: op-concat v-concat 1 l-pc +! ;
: op-pushf
  l-code l-pc @ 1+ + @
  l-code l-pc @ 2 + + @
  5 3 l-pc +! ;
: op-neg
  dup 5 = if drop fnegate 5 else drop dnegate vnum then
  1 l-pc +! ;
: op-halt ;

create l-ops
' op-push , ' op-load , ' op-store , ' op-arith , ' op-arith , ' op-arith ,
' op-arith , ' op-cmp , ' op-cmp , ' op-cmp , ' op-cmp , ' op-cmp , ' op-cmp ,
' op-jmp , ' op-jz , ' op-print , ' op-tab , ' op-eol , ' op-pushs ,
' op-concat , ' op-halt , ' op-neg , ' op-pushf , ' op-pow , ' op-idiv ,
' op-mod ,

\ The runtime string arena is not reset here: a concatenation result that
\ lives in a global has to survive the next line of the session.
: l-run ( -- )
  0 l-pc !
  begin
    l-code l-pc @ + @
    dup OP-HALT = if drop exit then
    dup l-ops + @ swap drop execute
  again ;

\ --- top level ---
\ A session keeps the symbol table and the globals from line to line, so
\ `x = 3` on one line and `print(x)` on the next work on the same `x`.

: l-compile ( -- )
  0 l-pos ! 0 l-cp ! 0 l-ntok ! 0 l-ti !
  l-tokenize
  l-program ;

\ Compile and run the pending source.  The flag is true when the source
\ ended in the middle of a statement, so the session asks for another line.
\ A failed compile gives the symbol table and the string arena back; a
\ failed run keeps them, because the program may have stored values.
: l-pending ( -- f )
  l-nsym @ l-save-nsym !
  l-ap @ l-save-ap !
  ['] l-compile catch ?dup if
    l-save-nsym @ l-nsym !
    l-save-ap @ l-ap !
    dup -23 = if drop true exit then
    l-err
  else
    ['] l-run catch ?dup if l-err then
  then
  0 l-src-n !
  false ;

\ The session itself: the tables live as long as the session does.  An empty
\ line ends the session; an unfinished statement is reported first.
: l-session ( -- )
  decimal
  0 l-nsym ! 0 l-ap ! 0 l-rp ! 0 l-src-n !
  l-vars 48 0 fill
  begin
    l-prompt
    l-line if
      l-src-n @ 0> if -23 l-err then
      exit
    then
    l-pending drop
  again ;

: lila ( -- )
  cr
  l-session ;

cr
