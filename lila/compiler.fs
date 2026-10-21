\ LILA compiler (host prototype)
\ Supported: assignments, infix expressions with parentheses and unary minus,
\ print, if/elseif/while/for, break, and functions.
\ Expressions are translated to postfix Forth.  LILA variables are stored as
\ Forth variables named `lila-var-<name>`, so LILA names do not collide with
\ the host Forth word set.  Function parameters are stored as
\ `lila-var-<function>-<parameter>`.

create lila-buf 4096 allot
create lila-lhs 256 allot
create lila-name 256 allot
create tok-buf 64 allot
variable tok-len
create op-stack 64 allot
variable op-top
variable expect-operand
\ Loop bodies become separate top-level words so `break` can EXIT the body.
\ Definitions are collected in defs-buf and evaluated before the main word.
create code-buf0 65536 allot
variable code-buf
variable code-len
create defs-buf 65536 allot
variable defs-len
create loop-break-vars 256 cells allot
variable loop-id
variable load-serial
create code-stack 64 2* cells allot
variable code-top
create body-id-stack 64 cells allot
variable body-id-top
create body-bufs 64 65536 * allot
variable current-loop-id
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
\ Functions: every function has its own Forth variables for its parameters,
\ a return value, and a return flag.  Function bodies become top-level words
\ in defs-buf, like loop bodies.
create fn-name 64 allot
create fn-params 16 64 * allot
variable fn-param-count
variable fn-active
\ Function calls in expressions: name stack and one flag per open parenthesis.
create call-names 64 64 * allot
variable call-top
create paren-args 64 allot

code-buf0 code-buf !

: lila-error ( c-addr u -- )  cr type cr abort ;

: code-reset ( -- )  0 code-len ! ;
: code-base ( -- )  code-buf0 code-buf !  0 code-len ! ;
: code+ { c-addr u -- }
  code-len @ u + 65536 > if s" lila: code buffer overflow" lila-error then
  u 0> if
    c-addr code-buf @ code-len @ + u move
    code-len @ u + code-len !
  then ;
: code-eval ( -- )  code-buf @ code-len @ evaluate ;
: defs+ { c-addr u -- }
  defs-len @ u + 65536 > if s" lila: definitions buffer overflow" lila-error then
  u 0> if
    c-addr defs-buf defs-len @ + u move
    defs-len @ u + defs-len !
  then ;
: defs-number ( n -- )  0 <# #s #> defs+ ;

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

: strip-trailing-paren { c-addr u -- c-addr' u' }
  c-addr u trim
  dup 0> if
    2dup + 1- c@ [char] ) = if 1- then
  then ;

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
  ch [char] ~ = if 3 else
  ch [char] * =  ch [char] / =  or if 2 else
  ch [char] + =  ch [char] - =  or if 1 else
  ch [char] < =  ch [char] > =  or  ch [char] = =  or if 0 else
  0 then then then then ;

: identifier? { c-addr u -- flag }
  u 0= if false exit then
  c-addr c@ [char] 0 [char] 9 1+ within if false exit then
  c-addr u bounds ?do
    i c@
    dup bl = if drop false unloop exit then
    dup op-char? if drop false unloop exit then
    dup [char] ( = over [char] ) = or if drop false unloop exit then
    [char] = = if false unloop exit then
  loop
  true ;

: append-space ( -- )
  lila-buf c@ if
    lila-buf count + 1- c@ bl <> if s"  " lila-buf buf+ then
  then ;

: param? { c-addr u -- flag }
  fn-active @ 0= if false exit then
  fn-param-count @ 0 ?do
    c-addr u  i 64 * fn-params + count compare 0= if
      true unloop exit
    then
  loop false ;

: emit-operand { c-addr u -- }
  c-addr u is-number? if
    c-addr u lila-buf buf+
  else
    c-addr u keyword? if
      c-addr u lila-buf buf+
    else
      s"  lila-var-" lila-buf buf+
      c-addr u param? if
        fn-name count lila-buf buf+
        s" -" lila-buf buf+
      then
      c-addr u lila-buf buf+
      s"  @" lila-buf buf+
    then
  then
  append-space ;

: emit-operator ( ch -- )
  dup [char] ~ = if
    drop append-space s" negate " lila-buf buf+ exit
  then
  append-space
  tok-buf c!  tok-buf 1 lila-buf buf+
  s"  " lila-buf buf+ ;

: push-op ( ch -- )  op-top @ op-stack + c!  1 op-top +! ;
: top-op ( -- ch )  op-top @ 0= if 0 else op-top @ 1- op-stack + c@ then ;
: pop-op ( -- )  top-op  -1 op-top +!  emit-operator ;
: marker-open? { ch -- flag }
  ch [char] ( =  ch [char] { = or ;
: pop-while { prec -- }
  begin
    op-top @ 0> if
      top-op dup marker-open? if drop false else op-precedence prec >= then
    else false then
  while
    pop-op
  repeat ;
: pop-all ( -- )
  begin
    op-top @ 0> if top-op marker-open? 0= else false then
  while
    pop-op
  repeat ;

: call-push { c-addr u -- }
  u 63 > if s" lila: function name too long" lila-error then
  call-top @ 64 >= if s" lila: calls nested too deeply" lila-error then
  c-addr u call-top @ 64 * call-names + place
  1 call-top +! ;
: call-pop-emit ( -- )
  call-top @ 0= if s" lila: call stack underflow" lila-error then
  -1 call-top +!
  append-space
  s" lila-fn-" lila-buf buf+
  call-top @ 64 * call-names + count lila-buf buf+
  s"  " lila-buf buf+ ;

: innermost-marker ( -- ch idx )
  op-top @ 0 ?do
    op-top @ 1- i -
    dup op-stack + c@
    dup marker-open? if
      swap unloop exit
    then
    drop drop
  loop
  -1 -1 ;

\ Record that the innermost call has at least one argument.  This makes
\ zero-argument calls such as f() distinguishable from a missing operand.
: mark-arg ( -- )
  op-top @ 0 ?do
    op-top @ 1- i -
    dup op-stack + c@ [char] { = if
      paren-args + 1 swap c!
      unloop exit
    then
    drop
  loop ;

: flush-tok ( -- )
  tok-len @ 0= if exit then
  tok-buf tok-len @ emit-operand
  mark-arg
  0 tok-len !
  0 expect-operand ! ;

: open-group ( -- )
  flush-tok
  expect-operand @ 0= if
    s" lila: operator expected before (" lila-error
  then
  [char] ( push-op
  0 op-top @ 1- paren-args + c! ;

: open-call ( -- )
  tok-buf tok-len @ identifier? 0= if
    s" lila: invalid function name" lila-error
  then
  tok-buf tok-len @ call-push
  0 tok-len !
  [char] { push-op
  0 op-top @ 1- paren-args + c!
  1 expect-operand ! ;

: close-paren ( -- )
  flush-tok
  innermost-marker { ch idx }
  ch 0< if s" lila: unmatched )" lila-error then
  ch [char] { = if
    idx paren-args + c@ 0= if
      expect-operand @ if
        -1 op-top +!
        call-pop-emit
        0 expect-operand !
        mark-arg
        exit
      then
    then
  then
  expect-operand @ if
    s" lila: operand expected before )" lila-error
  then
  -1 pop-while
  -1 op-top +!
  ch [char] { = if
    call-pop-emit
    mark-arg
  then
  0 expect-operand ! ;

: comma ( -- )
  flush-tok
  innermost-marker { ch idx }
  ch [char] { <> if s" lila: comma outside call" lila-error then
  expect-operand @ if
    s" lila: operand expected before ," lila-error
  then
  -1 pop-while
  1 idx paren-args + c!
  1 expect-operand ! ;

: transform-expr { c-addr u -- }
  lila-buf buf-reset  0 tok-len !  0 op-top !  1 expect-operand !
  c-addr u bounds ?do
    i c@
    dup bl = if
      drop flush-tok
    else
      dup [char] ( = if
        drop
        tok-len @ 0> if open-call else open-group then
      else
        dup [char] ) = if
          drop close-paren
        else
          dup [char] , = if
            drop comma
          else
            dup op-char? if
              flush-tok
              dup [char] - = expect-operand @ and if
                drop [char] ~ push-op
              else
                expect-operand @ if
                  s" lila: operand expected before operator" lila-error
                then
                dup op-precedence pop-while
                push-op
                1 expect-operand !
              then
            else
              tok-len @ 0= expect-operand @ 0= and if
                s" lila: operator expected" lila-error
              then
              tok-buf tok-len @ + c!
              tok-len @ 1+ tok-len !
            then
          then
        then
      then
    then
  loop
  flush-tok
  expect-operand @ if s" lila: operand expected" lila-error then
  pop-all
  op-top @ 0<> if s" lila: unmatched (" lila-error then ;

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
  c-addr u trim to u to c-addr
  s" lila-var-" lila-name place
  c-addr u param? if
    fn-name count lila-name +place
    s" -" lila-name +place
  then
  c-addr u lila-name +place
  lila-name count lila-lhs place
  c-addr u param? 0= if
    lila-name find nip 0= if
      s" variable " lila-name count s+ evaluate drop
    then
  then ;

: assignment? { line len -- flag }
  line len s" =" split-at if
    2drop trim identifier?
  else
    2drop 2drop false
  then ;

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
    over c@ [char] ( = if
      1 /string strip-trailing-paren
    then
  then
  transform-expr
  s"  ." lila-buf +place
  lila-buf count code+
  s"  " code+ ;

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

: code-push ( -- )
  code-top @ 64 >= if s" lila: code nesting too deep" lila-error then
  code-buf @ code-top @ 2* cells code-stack + !
  code-len @ code-top @ 2* cells code-stack + cell+ !
  1 code-top +! ;
: code-pop ( -- )
  code-top @ 0= if s" lila: code stack underflow" lila-error then
  -1 code-top +!
  code-top @ 2* cells code-stack + cell+ @ code-len !
  code-top @ 2* cells code-stack + @ code-buf ! ;

: body-id-push ( id -- )
  body-id-top @ 64 >= if drop s" lila: loops nested too deeply" lila-error then
  body-id-top @ cells body-id-stack + !
  1 body-id-top +! ;
: body-id-current ( -- id )
  body-id-top @ 0= if -1 else body-id-top @ 1- cells body-id-stack + @ then ;
: body-id-pop ( -- )
  body-id-top @ 0= if s" lila: body stack underflow" lila-error then
  -1 body-id-top +! ;

: next-loop-id ( -- id )
  loop-id @ 256 >= if s" lila: too many loops" lila-error then
  loop-id @ 1 loop-id +! ;

\ Each loop body is compiled into its own buffer.  Ending it appends a
\ top-level definition to defs-buf and emits a call in the parent buffer.
: loop-body-start ( id -- )
  code-push
  code-top @ 1- 65536 * body-bufs + code-buf !
  0 code-len !
  body-id-push ;
: loop-body-end ( -- )
  0 { id -- }
  body-id-current dup 0< if
    drop s" lila: body end without loop" lila-error
  then
  to id
  s" : lila-loop-body-" defs+
  load-serial @ defs-number
  s" -" defs+
  id defs-number
  s"  " defs+
  code-buf @ code-len @ defs+
  s"  ; " defs+
  code-pop
  body-id-pop
  s" lila-loop-body-" code+
  load-serial @ code-number
  s" -" code+
  id code-number
  s"  " code+ ;

: code-loop-break-id ( id -- )
  s" loop-break-vars " code+ code-number s"  cells + " code+ ;
: code-loop-break ( -- )  current-loop-id @ code-loop-break-id ;

: lila-compile-break ( -- )
  body-id-current dup 0< if
    drop s" lila: break outside loop" lila-error
  then
  s" 1 " code+
  code-loop-break-id
  s" ! EXIT " code+ ;

: compile-return { line len -- }
  fn-active @ 0= if s" lila: return outside function" lila-error then
  line len 6 /string trim
  dup 0= if
    2drop s" 0 " code+
  else
    compile-expr
  then
  s"  lila-fn-" code+ fn-name count code+ s" -val ! 1 lila-fn-" code+
  fn-name count code+ s" -ret ! EXIT " code+ ;

: call-stmt? { c-addr u -- flag }
  c-addr u trim to u to c-addr
  c-addr u s" (" split-at if
    2drop trim identifier?
  else
    2drop 2drop false
  then ;

: compile-call-stmt { line len -- }
  line len compile-expr
  s"  drop " code+ ;

: compile-stmt-code { line len -- }
  line len trim
  2dup s" break" compare 0= if
    2drop lila-compile-break exit
  then
  2dup s" print" string-prefix? if
    compile-print-code exit
  then
  2dup s" return" compare 0= if
    2drop compile-return exit
  then
  2dup s" return " string-prefix? if
    compile-return exit
  then
  2dup s" function " string-prefix? if
    2drop s" lila: function must be top-level" lila-error
  then
  2dup assignment? if
    compile-assign-code exit
  then
  2dup call-stmt? if
    compile-call-stmt exit
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

: strip-end { c-addr u -- c-addr' u' flag }
  u 3 >= if
    c-addr u + 3 - 3 s" end" compare 0= if
      u 3 = if c-addr u 3 - true exit then
      c-addr u + 4 - c@ bl = if c-addr u 3 - true exit then
    then
  then
  c-addr u false ;

: declare-fn-vars ( -- )
  s" variable lila-fn-" defs+ fn-name count defs+ s" -ret " defs+
  s" variable lila-fn-" defs+ fn-name count defs+ s" -val " defs+ ;

: fn-set-name { c-addr u -- }
  c-addr u trim to u to c-addr
  u 0= if s" lila: invalid function name" lila-error then
  c-addr u identifier? 0= if s" lila: invalid function name" lila-error then
  u 63 > if s" lila: function name too long" lila-error then
  c-addr u fn-name place ;

: fn-header { c-addr u -- params plen body blen }
  c-addr u s" (" split-at 0= if
    2drop 2drop s" lila: function needs a parameter list" lila-error
  then
  2over fn-set-name
  2swap 2drop
  s" )" split-at 0= if
    2drop 2drop s" lila: function needs )" lila-error
  then
  2swap ;

: declare-param { c-addr u -- }
  s" variable lila-var-" defs+ fn-name count defs+ s" -" defs+
  c-addr u defs+
  s"  " defs+ ;

: add-param { c-addr u -- }
  c-addr u trim to u to c-addr
  u 0= if s" lila: empty parameter" lila-error then
  c-addr u identifier? 0= if s" lila: invalid parameter" lila-error then
  fn-param-count @ 16 >= if s" lila: too many parameters" lila-error then
  c-addr u  fn-param-count @ 64 * fn-params + place
  c-addr u declare-param
  1 fn-param-count +! ;

: parse-params { c-addr u -- }
  c-addr u trim to u to c-addr
  u 0= if exit then
  c-addr u s" ," split-at if
    2swap
    2dup add-param
    2drop
    recurse
  else
    2drop 2drop
    c-addr u add-param
  then ;

: function-body-start ( -- )
  code-push
  code-top @ 1- 65536 * body-bufs + code-buf !
  0 code-len ! ;

: emit-fn-prologue ( -- )
  s" 0 lila-fn-" defs+ fn-name count defs+ s" -ret ! " defs+
  fn-param-count @ 0 ?do
    fn-param-count @ 1- i - 64 * fn-params + count
    s" lila-var-" defs+ fn-name count defs+ s" -" defs+
    defs+
    s"  ! " defs+
  loop ;

: emit-fn-epilogue ( -- )
  s" lila-fn-" defs+ fn-name count defs+ s" -ret @ IF lila-fn-" defs+
  fn-name count defs+ s" -val @ ELSE 0 THEN " defs+ ;

\ The body is its own word so `return` can EXIT it from anywhere, including
\ a nested loop body.  The wrapper stores the arguments and always reaches
\ the epilogue, so every call leaves exactly one result.
: function-end ( -- )
  s" : lila-fn-body-" defs+
  load-serial @ defs-number
  s" -" defs+
  fn-name count defs+
  s"  " defs+
  code-buf @ code-len @ defs+
  s"  ; " defs+
  s" : lila-fn-" defs+ fn-name count defs+ s"  " defs+
  emit-fn-prologue
  s" lila-fn-body-" defs+
  load-serial @ defs-number
  s" -" defs+
  fn-name count defs+
  s"  " defs+
  emit-fn-epilogue
  s" ; " defs+
  code-pop
  0 fn-active !
  0 fn-param-count ! ;

: lila-compile-function { line len -- }
  fn-active @ if
    s" lila: nested functions are not supported" lila-error
  then
  block-top @ 0<> if
    s" lila: function must be top-level" lila-error
  then
  line len 9 /string trim fn-header
  fn-active on
  declare-fn-vars
  parse-params
  function-body-start
  trim
  dup 0= if
    2drop
    [char] n block-push
    exit
  then
  strip-end 0= if
    2drop 2drop
    s" lila: function body must end with end or start on a new line" lila-error
  then
  compile-block
  function-end ;

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

: emit-fn-ret-check ( -- )
  fn-active @ if
    s" lila-fn-" code+ fn-name count code+ s" -ret @ IF EXIT THEN " code+
  then ;

: emit-fn-cond ( -- )
  fn-active @ if
    s" lila-fn-" code+ fn-name count code+ s" -ret @ 0= AND " code+
  then ;

: lila-compile-end ( -- )
  block-top @ 0= if s" lila: end without block" lila-error then
  block-extra@
  block-pop
  dup [char] f = if
    drop drop
    loop-body-end
    s" REPEAT " code+
    -1 for-depth +!
    emit-fn-ret-check
    exit
  then
  dup [char] w = if
    drop drop
    loop-body-end
    s" REPEAT " code+
    emit-fn-ret-check
    exit
  then
  dup [char] n = if
    drop drop
    function-end
    exit
  then
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
    next-loop-id current-loop-id !
    s" 0 " code+
    code-loop-break
    s" ! BEGIN " code+
    2over compile-expr
    code-loop-break
    s" @ 0= AND " code+
    emit-fn-cond
    s" WHILE " code+
    2swap 2drop
    trim
    dup 0= if
      2drop
      current-loop-id @ loop-body-start
      [char] w block-push
      exit
    then
    s" end" split-at if
      2drop
      current-loop-id @ loop-body-start
      compile-block
      loop-body-end
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
        next-loop-id current-loop-id !
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
        s" 0 " code+
        code-loop-break
        s" ! BEGIN " code+
        code-loop-break
        s" @ 0= IF " code+
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
        emit-fn-cond
        s" ELSE 0 THEN WHILE " code+
        for-tail count trim
        dup 0= if
          2drop
          current-loop-id @ loop-body-start
          [char] f block-push
          for-depth @ block-set-extra
          1 for-depth +!
          exit
        then
        s" end" split-at if
          2drop
          current-loop-id @ loop-body-start
          compile-block
          loop-body-end
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
  2dup s" break" compare 0= if 2drop lila-compile-break exit then
  2dup s" function " string-prefix? if lila-compile-function exit then
  2dup s" if " string-prefix? if lila-compile-if exit then
  2dup s" elseif " string-prefix? if lila-compile-elseif exit then
  2dup s" while " string-prefix? if lila-compile-while exit then
  2dup s" for " string-prefix? if lila-compile-for exit then
  2dup s" else" compare 0= if 2drop lila-compile-else exit then
  2dup s" end" compare 0= if 2drop lila-compile-end exit then
  compile-block ;

: lila-compile-reset ( -- )
  1 load-serial +!
  code-base
  0 defs-len !
  0 loop-id !
  0 code-top !
  0 body-id-top !
  0 block-top !
  0 for-depth !
  0 fn-active !
  0 fn-param-count !
  0 call-top ! ;

: lila-compile-finish ( -- )
  block-top @ 0<> if s" lila: unterminated block" lila-error then
  for-depth @ 0<> if s" lila: unbalanced for loop" lila-error then
  code-top @ 0<> if s" lila: code stack not empty" lila-error then
  body-id-top @ 0<> if s" lila: body stack not empty" lila-error then
  s" ; execute" code+
  defs-len @ 0> if defs-buf defs-len @ evaluate then
  code-eval ;

: lila-load { c-addr u -- }
  lila-compile-reset
  s" :noname " code+
  c-addr u r/o open-file throw lila-fid !
  begin
    line-buf 65536 lila-fid @ read-line throw
  while
    line-buf swap lila-compile-line
  repeat
  drop
  lila-fid @ close-file throw
  lila-compile-finish ;

: lila-eval { line len -- }
  lila-compile-reset
  s" :noname " code+
  line len lila-compile-line
  lila-compile-finish ;
