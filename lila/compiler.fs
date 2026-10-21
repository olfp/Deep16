\ LILA compiler (host prototype)
\ Supported: assignments, infix expressions, print, if/elseif/while/for.
\ Expressions are translated to postfix Forth.  LILA variables are stored as
\ Forth variables named `lila-var-<name>`, so LILA names do not collide with
\ the host Forth word set.

create lila-buf 4096 allot
create lila-lhs 256 allot
create lila-name 256 allot
create tok-buf 64 allot
variable tok-len
create op-stack 64 allot
variable op-top
create code-buf 65536 allot
variable code-len
variable lila-fid
create line-buf 65536 allot
create block-stack 64 allot
create block-extra 64 cells allot
variable block-top
create for-start 256 allot
create for-end 256 allot
create for-step 256 allot
create for-tail 256 allot
variable for-depth
create for-end-vars 64 cells allot
create for-step-vars 64 cells allot

: code-reset ( -- )  0 code-len ! ;
: code+ { c-addr u -- }
  u 0> if
    c-addr code-buf code-len @ + u move
    code-len @ u + code-len !
  then ;
: code-eval ( -- )  code-buf code-len @ evaluate ;

: buf-reset ( buf -- )  0 swap c! ;
: buf+ ( c-addr u buf -- )  +place ;

: trim { c-addr u -- c-addr' u' }
  begin
    u 0> if c-addr c@ bl = else false then
  while
    c-addr 1+ to c-addr  u 1- to u
  repeat
  begin
    u 0> if c-addr u + 1- c@ bl = else false then
  while
    u 1- to u
  repeat
  c-addr u ;

: is-number? { c-addr u -- flag }
  u 0= if false exit then
  c-addr c@ [char] - = if
    c-addr 1+ to c-addr  u 1- to u
  then
  u 0= if false exit then
  true
  c-addr u bounds ?do
    i c@ [char] 0 [char] 9 1+ within 0= if
      drop false unloop exit
    then
  loop ;

: keyword? { c-addr u -- flag }
  c-addr u s" print" compare 0=
  c-addr u s" true" compare 0= or
  c-addr u s" false" compare 0= or ;

: op-char? { ch -- flag }
  ch [char] + =  ch [char] - = or
  ch [char] * = or  ch [char] / = or
  ch [char] < = or  ch [char] > = or
  ch [char] = = or ;

: op-precedence { ch -- n }
  ch [char] * =  ch [char] / =  or if 2 else
  ch [char] + =  ch [char] - =  or if 1 else
  ch [char] < =  ch [char] > =  or  ch [char] = =  or if 0 else
  0 then then then ;

: identifier? { c-addr u -- flag }
  u 0= if false exit then
  c-addr c@ [char] 0 [char] 9 1+ within if false exit then
  c-addr u bounds ?do
    i c@
    dup bl = if drop false unloop exit then
    dup op-char? if drop false unloop exit then
    [char] = = if false unloop exit then
  loop
  true ;

: append-space ( -- )
  lila-buf c@ if
    lila-buf count + 1- c@ bl <> if s"  " lila-buf buf+ then
  then ;

: emit-operand ( c-addr u -- )
  2dup is-number? if
    lila-buf buf+
  else
    2dup keyword? if
      lila-buf buf+
    else
      s"  lila-var-" lila-buf buf+
      lila-buf buf+
      s"  @" lila-buf buf+
    then
  then
  append-space ;

: flush-tok ( -- )
  tok-len @ 0= if exit then
  tok-buf tok-len @ emit-operand
  0 tok-len ! ;

: unary-start? ( -- flag )
  tok-len @ 0<> if false exit then
  op-top @ 0> if true exit then
  lila-buf c@ 0= if true exit then
  lila-buf count
  dup 1 > if
    + 2 - c@ op-char?
  else
    2drop false
  then ;

: emit-operator ( ch -- )
  append-space
  tok-buf c!  tok-buf 1 lila-buf buf+
  s"  " lila-buf buf+ ;

: push-op ( ch -- )  op-top @ op-stack + c!  1 op-top +! ;
: top-op ( -- ch )  op-top @ 0= if 0 else op-top @ 1- op-stack + c@ then ;
: pop-op ( -- )  top-op  -1 op-top +!  emit-operator ;
: pop-while { prec -- }
  begin
    op-top @ 0> if top-op op-precedence prec >= else false then
  while
    pop-op
  repeat ;
: pop-all ( -- )
  begin op-top @ 0> while pop-op repeat ;

: transform-expr { c-addr u -- }
  lila-buf buf-reset  0 tok-len !  0 op-top !
  c-addr u bounds ?do
    i c@
    dup bl = if
      drop flush-tok
    else
      dup [char] - =  unary-start?  and  if
        tok-buf tok-len @ + c!
        tok-len @ 1+ tok-len !
      else
        dup op-char? if
          flush-tok
          dup op-precedence pop-while
          push-op
        else
          tok-buf tok-len @ + c!
          tok-len @ 1+ tok-len !
        then
      then
    then
  loop
  flush-tok
  pop-all ;

: split-at { src slen pat plen -- lhs llen rhs rlen flag }
  0 0 { maddr mlen -- }
  src slen pat plen search if
    to mlen to maddr
    src  maddr src -
    maddr plen +  mlen plen -
    true
  else
    2drop
    src slen 0 0 false
  then ;

: lila-store-lhs { c-addr u -- }
  c-addr u trim
  s" lila-var-" lila-name place
  lila-name +place
  lila-name count lila-lhs place
  lila-name find nip 0= if
    s" variable " lila-name count s+ evaluate drop
  then ;

: assignment? { line len -- flag }
  line len s" =" split-at if
    2drop trim identifier?
  else
    2drop 2drop false
  then ;

: lila-assign { line len -- }
  line len s" =" split-at if
    ( lhs llen rhs rlen )
    2over lila-store-lhs
    trim transform-expr
    s"  " lila-buf +place
    lila-lhs count lila-buf +place
    s"  !" lila-buf +place
    2drop
    lila-buf count evaluate
  else
    2drop 2drop
  then ;

: lila-print { line len -- }
  line len trim
  dup 0> if
    over c@ [char] ( = if 1 /string then
  then
  trim
  s" )" split-at
  2drop drop
  trim transform-expr
  s"  ." lila-buf +place
  lila-buf count evaluate ;

: compile-expr ( c-addr u -- )
  transform-expr
  lila-buf count code+
  s"  " code+ ;

: compile-assign-code { line len -- }
  line len s" =" split-at if
    ( lhs llen rhs rlen )
    2over lila-store-lhs
    trim transform-expr
    s"  " lila-buf +place
    lila-lhs count lila-buf +place
    s"  !" lila-buf +place
    2drop
    lila-buf count code+
    s"  " code+
  else
    2drop 2drop
  then ;

: compile-print-code { line len -- }
  line len 5 /string trim
  dup 0> if
    over c@ [char] ( = if 1 /string then
  then
  trim
  s" )" split-at
  2drop drop
  trim transform-expr
  s"  ." lila-buf +place
  lila-buf count code+
  s"  " code+ ;

: compile-stmt-code { line len -- }
  line len trim
  2dup s" print" string-prefix? if
    compile-print-code exit
  then
  2dup assignment? if
    compile-assign-code exit
  then
  code+
  s"  " code+ ;

: compile-block { c-addr u -- }
  c-addr u s" ;" split-at if
    2over compile-stmt-code
    2swap 2drop
    recurse
  else
    2drop compile-stmt-code
  then ;

: lila-error ( c-addr u -- )  cr type cr abort ;

: strip-cr ( c-addr u -- c-addr' u' )
  dup 0> if
    2dup + 1- c@ 13 = if 1- then
  then ;

: strip-comment ( c-addr u -- c-addr' u' )
  s" --" split-at 2drop drop trim ;

: block-push ( ch -- )
  block-top @ 64 >= if s" lila: blocks nested too deeply" lila-error then
  block-top @ block-stack + c!
  0 block-top @ cells block-extra + !
  1 block-top +! ;
: block-pop ( -- ch )  -1 block-top +!  block-top @ block-stack + c@ ;
: block-top@ ( -- ch )
  block-top @ 0= if 0 else block-top @ 1- block-stack + c@ then ;
: block-set-top ( ch -- )
  block-top @ 0= if drop else block-top @ 1- block-stack + c! then ;
: block-extra@ ( -- n )
  block-top @ 0= if 0 else block-top @ 1- cells block-extra + @ then ;
: block-extra+! ( n -- )
  block-top @ 0= if drop else block-top @ 1- cells block-extra + +! then ;
: block-set-extra ( n -- )
  block-top @ 0= if drop else block-top @ 1- cells block-extra + ! then ;

: code-number ( n -- )  0 <# #s #> code+ ;
: code-for-end ( -- )
  s" for-end-vars " code+ for-depth @ code-number s"  cells + " code+ ;
: code-for-step ( -- )
  s" for-step-vars " code+ for-depth @ code-number s"  cells + " code+ ;
: code-lila-var ( -- )  lila-lhs count code+ ;

: lila-compile-else ( -- )
  block-top@ [char] i <> if s" lila: else without if" lila-error then
  s" ELSE " code+
  [char] e block-set-top ;

: lila-compile-elseif { line len -- }
  block-top@ [char] i <> if s" lila: elseif without if" lila-error then
  line len 7 /string trim
  s" then" split-at if
    ( cond clen rest rlen )
    s" ELSE " code+
    2over compile-expr
    s" IF " code+
    2swap 2drop
    trim
    dup 0<> if
      2drop s" lila: elseif body must start on a new line" lila-error
    then
    2drop
    1 block-extra+!
  else
    2drop 2drop
    s" lila: elseif without then" lila-error
  then ;

: lila-compile-end ( -- )
  block-top @ 0= if s" lila: end without block" lila-error then
  block-extra@
  block-pop
  dup [char] f = if
    drop drop
    s" REPEAT " code+
    -1 for-depth +!
    exit
  then
  dup [char] w = if drop drop s" REPEAT " code+ exit then
  dup [char] i = over [char] e = or if
    drop
    1+ 0 ?do s" THEN " code+ loop
    exit
  then
  drop drop s" lila: bad block type" lila-error ;

: lila-compile-if { line len -- }
  line len 3 /string trim
  s" then" split-at if
    ( cond clen rest rlen )
    2over compile-expr
    s" IF " code+
    2swap 2drop
    trim
    dup 0= if
      2drop [char] i block-push exit
    then
    s" end" split-at if
      ( body blen tail tlen )
      2drop
      s" else" split-at if
        ( thenbody tlen elsebody elen )
        2swap
        compile-block
        s" ELSE " code+
        compile-block
        s" THEN " code+
      else
        2drop
        compile-block
        s" THEN " code+
      then
    else
      2drop 2drop
      s" lila: if body must end with end or start on a new line" lila-error
    then
  else
    2drop 2drop
    s" lila: if without then" lila-error
  then ;

: lila-compile-while { line len -- }
  line len 5 /string trim
  s" do" split-at if
    ( cond clen rest rlen )
    s" BEGIN " code+
    2over compile-expr
    s" WHILE " code+
    2swap 2drop
    trim
    dup 0= if
      2drop [char] w block-push exit
    then
    s" end" split-at if
      2drop
      compile-block
      s" REPEAT " code+
    else
      2drop 2drop
      s" lila: while body must end with end or start on a new line" lila-error
    then
  else
    2drop 2drop
    s" lila: while without do" lila-error
  then ;

: lila-compile-for { line len -- }
  line len 4 /string trim
  s" =" split-at if
    ( var vlen rest rlen )
    2over trim identifier? 0= if
      2drop 2drop s" lila: invalid for variable" lila-error
    then
    2over lila-store-lhs
    2swap 2drop
    s" do" split-at if
      ( ranges rlen tail tlen )
      for-tail place
      trim
      s" ," split-at if
        ( start slen rest2 rlen2 )
        2over for-start place
        2swap 2drop
        s" ," split-at if
          ( end elen step plen )
          2over for-end place
          2swap 2drop
          for-step place
        else
          2drop
          for-end place
          s" 1" for-step place
        then
        for-depth @ 64 >= if
          s" lila: for loops nested too deeply" lila-error
        then
        for-end count compile-expr
        code-for-end
        s" ! " code+
        for-step count compile-expr
        code-for-step
        s" ! " code+
        for-start count compile-expr
        code-for-step
        s" @ - " code+
        code-lila-var
        s"  ! " code+
        s" BEGIN " code+
        code-lila-var
        s"  @ " code+
        code-for-step
        s" @ + " code+
        code-lila-var
        s"  ! " code+
        code-for-step
        s" @ 0> IF " code+
        code-lila-var
        s"  @ " code+
        code-for-end
        s" @ <= ELSE " code+
        code-lila-var
        s"  @ " code+
        code-for-end
        s" @ >= THEN " code+
        s" WHILE " code+
        for-tail count trim
        dup 0= if
          2drop
          [char] f block-push
          for-depth @ block-set-extra
          1 for-depth +!
          exit
        then
        s" end" split-at if
          2drop
          compile-block
          s" REPEAT " code+
        else
          2drop 2drop
          s" lila: for body must end with end or start on a new line" lila-error
        then
      else
        2drop 2drop
        s" lila: for needs start, end" lila-error
      then
    else
      2drop 2drop
      s" lila: for without do" lila-error
    then
  else
    2drop 2drop
    s" lila: for without =" lila-error
  then ;

: lila-compile-line { line len -- }
  line len strip-cr strip-comment
  dup 0= if 2drop exit then
  2dup s" if " string-prefix? if lila-compile-if exit then
  2dup s" elseif " string-prefix? if lila-compile-elseif exit then
  2dup s" while " string-prefix? if lila-compile-while exit then
  2dup s" for " string-prefix? if lila-compile-for exit then
  2dup s" else" compare 0= if 2drop lila-compile-else exit then
  2dup s" end" compare 0= if 2drop lila-compile-end exit then
  compile-block ;

: lila-load { c-addr u -- }
  code-reset
  s" :noname " code+
  0 block-top !
  0 for-depth !
  c-addr u r/o open-file throw lila-fid !
  begin
    line-buf 65536 lila-fid @ read-line throw
  while
    line-buf swap lila-compile-line
  repeat
  drop
  lila-fid @ close-file throw
  block-top @ 0<> if s" lila: unterminated block" lila-error then
  for-depth @ 0<> if s" lila: unbalanced for loop" lila-error then
  s" ; execute" code+
  code-eval ;

: lila-if { line len -- }
  line len 3 /string trim
  s" then" split-at if
    s" end" split-at if
      ( cond clen body blen tail tlen )
      2drop
      code-reset
      s" :noname " code+
      2over compile-expr
      s" IF " code+
      s" else" split-at if
        ( cond clen thenbody tlen elsebody elen )
        2swap
        compile-block
        s" ELSE " code+
        compile-block
        s" THEN " code+
        s" ; execute" code+
        2drop
        code-eval
      else
        2drop
        compile-block
        s" THEN " code+
        s" ; execute" code+
        2drop
        code-eval
      then
    else
      2drop 2drop 2drop
    then
  else
    2drop 2drop
  then ;

: lila-while { line len -- }
  line len 5 /string trim
  s" do" split-at if
    s" end" split-at if
      ( cond clen body blen tail tlen )
      2drop
      code-reset
      s" :noname " code+
      s" BEGIN " code+
      2over compile-expr
      s" WHILE " code+
      compile-block
      s" REPEAT " code+
      s" ; execute" code+
      2drop
      code-eval
    else
      2drop 2drop 2drop
    then
  else
    2drop 2drop
  then ;

: lila-eval { line len -- }
  line len trim
  2dup s" if " string-prefix? if
    lila-if exit
  then
  2dup s" while " string-prefix? if
    lila-while exit
  then
  2dup s" print" string-prefix? if
    5 /string trim lila-print exit
  then
  2dup assignment? if
    lila-assign exit
  then
  evaluate ;
