\ lila-native.fth - an on-device LILA compiler and bytecode VM.
\
\ `lila` reads Lua-subset source lines from the console (a blank line ends the
\ source), tokenizes them in place, parses them with recursive descent, emits
\ compact bytecode into a dictionary buffer, and runs the bytecode on a small
\ VM.  No part of the user program is compiled by the host.
\
\ Supported subset (anything else is rejected with a negative code):
\   globals, integer literals, string literals (no escapes), unary minus,
\   + - *  relationals  == ~=  .. (right associative)  parentheses,
\   assignment, print(...), if / else / end, while / do / end, do / end,
\   -- comments.
\ Not in this profile: functions, locals, tables, floats (/ // % ^), bitwise
\ operators, and / or / not, varargs, multiple values, #, libraries.
\
\ A value is three cells ( value1 value2 tag ) with the same tags as
\ lila/value.fs: 0 nil, 1 number, 2 boolean, 3 string.  A number is a signed
\ 32-bit two's-complement pair (low high); a boolean is (0xFFFF 0 2) or
\ (0 0 2); a string is (address length 3).  A variable is a three-cell slot,
\ zero-filled so an unassigned global reads as nil.  Compiled strings live in
\ a compile-time arena; concatenation results in a run-time arena.

\ ------------------------------- bytecode -------------------------------
 0 constant OP-PUSH
 1 constant OP-LOAD
 2 constant OP-STORE
 3 constant OP-ADD
 4 constant OP-SUB
 5 constant OP-MUL
 6 constant OP-EQ
 7 constant OP-LT
 8 constant OP-GT
 9 constant OP-LE
10 constant OP-GE
11 constant OP-NE
12 constant OP-JMP
13 constant OP-JZ
14 constant OP-PRINT
15 constant OP-TAB
16 constant OP-EOL
17 constant OP-PUSHS
18 constant OP-CONCAT
19 constant OP-HALT
20 constant OP-NEG

\ ------------------------------- storage --------------------------------
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
create l-vars 96 allot
create l-arena 512 allot
variable l-ap drop
create l-rstr 256 allot
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

\ ------------------------- static text fragments ------------------------
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

\ ------------------------------- helpers --------------------------------
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

\ current token access
: l-tstart ( i -- a ) l-tok-a + @ l-src + ;
: l-tlen ( i -- n ) l-tok-n + @ ;
: l-cur ( -- a n ) l-pos @ l-tstart l-pos @ l-tlen ;
: l-cur= ( ca cn -- f ) l-cur compare 0= ;
: l-op? ( ca cn -- f )
  l-pos @ l-tok-k + @ 4 <> if 2drop false exit then
  l-cur= ;
: l-kind@ ( -- k ) l-pos @ l-tok-k + @ ;

\ bytecode emission
: code, ( x -- ) l-cp @ l-code + ! 1 l-cp +! ;
: code2, ( x op -- ) code, code, ;
: here-cp ( -- i ) l-cp @ ;
: l-patch ( slot -- ) here-cp swap l-code + ! ;
: l-jz ( -- slot ) OP-JZ code, here-cp 1 l-cp +! ;
: l-jmp ( -- slot ) OP-JMP code, here-cp 1 l-cp +! ;

\ ------------------------------ source input ----------------------------
: l-read ( -- )
  0 l-src-n !
  begin
    l-src-n @ l-src + 120 accept l-got !
    l-got @ 0= if exit then
    l-src l-src-n @ + l-got @ + 10 swap c!
    l-src-n @ l-got @ + 1+ l-src-n !
    l-src-n @ 700 > if -1 throw then
  again ;

\ ------------------------------- tokenizer ------------------------------
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
: l-scan-number
  l-ti @ >r
  begin l-ti @ l-src-n @ < while
    l-ti @ l-src@ l-digit? 0= if
      r@ l-ti @ r@ - 1 l-tok-add r> drop exit then
    1 l-ti +!
  repeat
  r@ l-ti @ r@ - 1 l-tok-add r> drop ;
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

\ ------------------------------ symbol table ----------------------------
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

\ compile a string into the arena; return the length-cell address
: l-astr ( a n -- addr )
  l-alen !
  l-ap @ l-alen @ + 1+ 500 > if -7 throw then
  l-ap @ >r
  l-alen @ r@ l-arena + !
  r@ 1+ l-arena +
  l-alen @ cmove
  l-ap @ l-alen @ 1+ + l-ap !
  r> l-arena + ;

\ ------------------------------- parser ---------------------------------
\ Multiply an unsigned 32-bit pair by ten.  The low half goes through um*;
\ its high half and ten times the old high half form the new high half.
\ Any carry out of 32 bits or into the sign bit is a literal we cannot store.
: l-10* ( lo hi -- lo' hi' )
  swap 10 um* rot 10 um*
  l-qhi ! l-qlo ! l-phi ! l-plo !
  l-qhi @ 0<> if -22 throw then
  l-phi @ l-qlo @ +
  dup l-phi @ u< if -22 throw then
  l-plo @ swap ;

\ Accumulate into a 32-bit unsigned pair, then reject values the signed
\ payload cannot represent.
: l-num ( a n -- lo hi )
  l-num-n ! l-num-a !
  0 0
  l-num-n @ 0 ?do
    l-10*
    l-num-a @ i + c@ 48 - 0 d+
  loop
  dup 0< if -22 throw then ;
: l-expr0 ( -- ) 0 l-expr-xt @ execute ;

: l-primary ( -- )
  l-pos @ l-ntok @ < 0= if -8 throw then
  l-kind@
  dup 1 = if drop
    l-pos @ l-tstart l-pos @ l-tlen l-num
    OP-PUSH code, swap code, code,
    1 l-pos +! exit then
  dup 3 = if drop
    l-pos @ l-tstart l-pos @ l-tlen l-astr
    OP-PUSHS code2, 1 l-pos +! exit then
  dup 2 = if drop
    l-pos @ l-tstart l-pos @ l-tlen l-slot
    OP-LOAD code2, 1 l-pos +! exit then
  drop
  p-lp 1 l-op? 0= if -9 throw then
  1 l-pos +!
  l-expr0
  p-rp 1 l-op? 0= if -10 throw then
  1 l-pos +! ;

: l-unary ( -- )
  p-minus 1 l-op? if
    1 l-pos +!
    recurse
    OP-NEG code,
  else l-primary then ;

: l-setop ( prec op right -- prec ) l-bright? ! l-bop ! ;
: l-binop ( -- prec )
  l-pos @ l-ntok @ < 0= if 0 exit then
  p-cat   2 l-op? if 4 OP-CONCAT 1 l-setop exit then
  p-le    2 l-op? if 3 OP-LE 0 l-setop exit then
  p-ge    2 l-op? if 3 OP-GE 0 l-setop exit then
  p-eq    2 l-op? if 3 OP-EQ 0 l-setop exit then
  p-ne    2 l-op? if 3 OP-NE 0 l-setop exit then
  p-plus  1 l-op? if 5 OP-ADD 0 l-setop exit then
  p-minus 1 l-op? if 5 OP-SUB 0 l-setop exit then
  p-star  1 l-op? if 6 OP-MUL 0 l-setop exit then
  p-lt    1 l-op? if 3 OP-LT 0 l-setop exit then
  p-gt    1 l-op? if 3 OP-GT 0 l-setop exit then
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
    r> l-bop !
    r> l-min !
    l-bop @ code,
  repeat drop ;
' l-expr l-expr-xt !

\ ----------------------------- statements -------------------------------
: l-assign ( -- )
  l-pos @ l-tstart l-pos @ l-tlen l-slot
  1 l-pos +!
  p-set 1 l-op? 0= if -21 throw then
  1 l-pos +!
  l-expr0
  OP-STORE code2, ;

: l-print ( -- )
  1 l-pos +!
  p-lp 1 l-op? 0= if -19 throw then
  1 l-pos +!
  l-expr0 OP-PRINT code,
  begin p-comma 1 l-op? while
    1 l-pos +!
    OP-TAB code,
    l-expr0 OP-PRINT code,
  repeat
  p-rp 1 l-op? 0= if -20 throw then
  1 l-pos +!
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
  k-then 4 l-cur= 0= if -14 throw then
  1 l-pos +!
  l-block
  k-else 4 l-cur= if
    1 l-pos +!
    l-jmp
    swap l-patch
    l-block
    l-patch
  else l-patch then
  k-end 3 l-cur= 0= if -15 throw then
  1 l-pos +! ;

: l-while-stmt ( -- )
  1 l-pos +!
  here-cp
  l-expr0
  l-jz
  k-do 2 l-cur= 0= if -16 throw then
  1 l-pos +!
  l-block
  OP-JMP code,
  >r
  code,
  r> l-patch
  k-end 3 l-cur= 0= if -17 throw then
  1 l-pos +! ;

: l-do-stmt ( -- )
  1 l-pos +!
  l-block
  k-end 3 l-cur= 0= if -18 throw then
  1 l-pos +! ;

: l-stmt ( -- )
  l-pos @ l-ntok @ < 0= if -12 throw then
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

\ --------------------------------- VM -----------------------------------
: vnum ( lo hi -- lo hi 1 ) 1 ;
: vbool ( f -- b 0 2 ) if -1 else 0 then 0 2 ;
: v2pop ( a1 a2 atag b1 b2 btag -- a1 a2 b1 b2 )
  drop >r >r drop r> r> ;

\ Multiply two 32-bit pairs modulo 2^32; only the low halves of the cross
\ products can reach the high cell.
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

: op-push
  l-code l-pc @ 1+ + @
  l-code l-pc @ 2 + + @
  1 3 l-pc +! ;
: op-load  l-code l-pc @ 1+ + @ v-load 2 l-pc +! ;
: op-store l-code l-pc @ 1+ + @ v-store 2 l-pc +! ;
: op-add v2pop d+ vnum 1 l-pc +! ;
: op-sub v2pop d- vnum 1 l-pc +! ;
: op-mul v2pop d* vnum 1 l-pc +! ;
: op-eq  v2pop d= vbool 1 l-pc +! ;
: op-lt  v2pop d< vbool 1 l-pc +! ;
: op-gt  v2pop 2swap d< vbool 1 l-pc +! ;
: op-le  v2pop 2swap d< 0= vbool 1 l-pc +! ;
: op-ge  v2pop d< 0= vbool 1 l-pc +! ;
: op-ne  v2pop d= 0= vbool 1 l-pc +! ;
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
: op-neg drop dnegate vnum 1 l-pc +! ;
: op-halt ;

create l-ops
' op-push , ' op-load , ' op-store , ' op-add , ' op-sub , ' op-mul ,
' op-eq , ' op-lt , ' op-gt , ' op-le , ' op-ge , ' op-ne ,
' op-jmp , ' op-jz , ' op-print , ' op-tab , ' op-eol , ' op-pushs ,
' op-concat , ' op-halt , ' op-neg ,

: l-run ( -- )
  0 l-pc ! 0 l-rp !
  begin
    l-code l-pc @ + @
    dup OP-HALT = if drop exit then
    dup l-ops + @ swap drop execute
  again ;

\ ------------------------------- top level ------------------------------
: lila-build ( -- )
  decimal
  0 l-nsym ! 0 l-pos ! 0 l-cp ! 0 l-ap ! 0 l-rp ! 0 l-ntok !
  l-vars 96 0 fill
  l-read
  0 l-ti !
  l-tokenize
  l-program ;

: lila-exec ( -- ) l-run ;

: lila-inner ( -- ) lila-build lila-exec ;

: lila ( -- )
  ['] lila-inner catch ?dup if
    cr m-lerr 4 type space . cr
  then ;

cr
