\ LILA compiler (host prototype)
\ Supported: assignments, infix expressions with parentheses and unary minus,
\ strings, print, if/elseif/while/for, break, functions, and tables.
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
\ Internal operator codes for multi-character and keyword operators.  Input
\ bytes are plain chars; these codes only travel on the operator stack.
128 constant op-eq
129 constant op-ne
130 constant op-le
131 constant op-ge
132 constant op-idiv
133 constant op-and
134 constant op-or
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
create for-end-vars 64 3 * cells allot
create for-step-vars 64 3 * cells allot
\ Functions: every function has its own Forth variables for its parameters,
\ a three-cell return value, and a one-cell return flag.  Function bodies
\ become top-level words in defs-buf, like loop bodies.
create fn-name 64 allot
variable fn-body-addr
variable fn-body-len
create fn-params 16 64 * allot
create fn-param-types 16 allot
variable fn-param-count
variable fn-vararg
\ Function signatures: parameter count and optional parameter type constraints.
create sig-names 64 64 * allot
create sig-parm-types 64 16 * allot
create sig-pcnt 64 allot
create sig-vararg 64 allot
variable sig-count
create call-arg-types 16 allot
\ Function calls in expressions: name stack and one flag per open parenthesis.
create call-names 64 64 * allot
create call-starts 64 cells allot
variable call-top
create paren-args 64 allot
create arg-counts 64 allot
\ String literals.  Strings are c-addr u payloads inside tagged values.
create str-buf 1024 allot
variable str-len
create em-buf 2048 allot
variable in-string

\ Lexical environments.  Context 0 is the top-level chunk; each active
\ function gets a child context.  Locals are recorded in a single binding
\ stack, and scopes record where a block began so its locals can be dropped.
64 constant lila-max-ctx
256 constant lila-max-locals
64 constant lila-max-scopes
create ctx-parent lila-max-ctx cells allot
create ctx-slots lila-max-ctx cells allot
create ctx-base-local lila-max-ctx cells allot
create ctx-base-scope lila-max-ctx cells allot
variable ctx-top
create local-names lila-max-locals 64 * allot
create local-lens lila-max-locals allot
create local-ctx lila-max-locals allot
create local-slot lila-max-locals cells allot
variable local-count
create scope-local-base lila-max-scopes cells allot
variable scope-top
variable bf-found
variable lr-idx
variable lr-bctx
variable lr-c
variable lr-level

\ Function metadata is saved/restored around nested function compilation.
create fn-name-stack 64 64 * allot
create fn-paramcount-stack 64 cells allot
create fn-paramtypes-stack 64 16 * allot
create fn-vararg-stack 64 cells allot
create fn-id-stack 64 cells allot
variable fn-stack-top
variable fn-counter
variable fn-id

\ Pending closure assignment target, one per function being compiled.
\ kind: 0 global, 1 existing local, 2 local declared at function end.
create tgt-kind 64 allot
create tgt-level 64 cells allot
create tgt-slot 64 cells allot
create tgt-name 64 64 * allot
create tgt-dest 64 allot
variable tgt-top

\ Loop control state lives in frame slots, so recursive calls cannot clobber
\ an outer loop.
create loop-break-slots 256 cells allot
create loop-end-slots 256 cells allot
create loop-step-slots 256 cells allot

code-buf0 code-buf !

\ Expression types are LILA tag numbers; lila-tag-unknown means the compiler
\ cannot prove the tag statically.  Runtime representation never changes.
create expr-types 128 allot
variable type-top
variable expr-type

\ Output positions of the operands currently on the expression stack.  They
\ let `and` and `or` insert a short-circuit guard in front of the right-hand
\ operand after it has already been emitted.
128 constant lila-max-starts
create expr-starts lila-max-starts cells allot
variable start-top

\ Multi-value and vararg compilation state.  `expr-expand` lets the final call
\ (or `...`) of a return or multi-assignment keep all of its values instead of
\ being reduced to the first one.  The `tx-*` cells expose the current input
\ position to the call emitter so it can tell whether a call ends the
\ expression.
variable expr-expand
variable expr-call-base
variable arg-vararg
variable tx-addr
variable tx-u
variable tx-i

: start-push ( n -- )
  start-top @ lila-max-starts >= if s" lila: expression too complex" lila-error then
  expr-starts start-top @ cells + !
  1 start-top +! ;
: start-pop ( -- n )
  start-top @ 0= if s" lila: internal start stack underflow" lila-error then
  -1 start-top +!
  expr-starts start-top @ cells + @ ;

: type-push ( t -- )
  type-top @ 128 >= if s" lila: expression too complex" lila-error then
  expr-types type-top @ + c!
  1 type-top +! ;
: type-pop ( -- t )
  type-top @ 0= if s" lila: internal type stack underflow" lila-error then
  -1 type-top +!
  expr-types type-top @ + c@ ;

: type-known? ( t -- flag )  lila-tag-unknown <> ;

: check-num-static ( -- )
  expr-type @ dup type-known? if
    lila-tag-num <> if s" lila: number expected" lila-error then
  else drop then ;

: check-str-static ( -- )
  expr-type @ dup type-known? if
    lila-tag-str <> if s" lila: string expected" lila-error then
  else drop then ;

: check-table-static ( -- )
  expr-type @ dup type-known? if
    lila-tag-table <> if s" lila: table expected" lila-error then
  else drop then ;

: code-reset ( -- )  0 code-len ! ;
: code-base ( -- )  code-buf0 code-buf !  0 code-len ! ;
: code+ { c-addr u -- }
  code-len @ u + 65536 > if s" lila: code buffer overflow" lila-error then
  u 0> if
    c-addr code-buf @ code-len @ + u move
    code-len @ u + code-len !
  then ;
: code-run ( -- )  code-buf @ code-len @ evaluate ;

: code-eval ( -- )
  ['] code-run catch ?dup if
    dup lila-raise-code = if
      drop lila-report-error abort
    then
    throw
  then ;
: defs+ { c-addr u -- }
  defs-len @ u + 65536 > if s" lila: definitions buffer overflow" lila-error then
  u 0> if
    c-addr defs-buf defs-len @ + u move
    defs-len @ u + defs-len !
  then ;
: defs-number ( n -- )  0 <# #s #> defs+ ;

: buf-reset ( buf -- )  0 swap c! ;
: buf+ ( c-addr u buf -- )  +place ;

: code-number ( n -- )  0 <# #s #> code+ ;
: buf-number  ( n -- )  0 <# #s #> lila-buf buf+ ;

\ Insert a byte string at a content offset of the counted expression buffer.
\ `move` handles the overlapping shift.
: buf-insert { c-addr u pos -- }
  lila-buf c@ { len }
  len u + 255 > if s" lila: expression too long" lila-error then
  lila-buf 1+ pos +  lila-buf 1+ pos + u +  len pos -  move
  c-addr lila-buf 1+ pos + u move
  len u + lila-buf c! ;

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
  ch [char] = = or  ch [char] % = or
  ch [char] ^ = or  ch [char] ~ = or ;

: op-precedence { ch -- n }
  ch [char] ~ = ch [char] ! = or if 4 exit then
  ch [char] ^ = if 5 exit then
  ch [char] * = ch [char] / = or ch [char] % = or ch op-idiv = or if 3 exit then
  ch [char] + = ch [char] - = or if 2 exit then
  ch [char] < = ch [char] > = or ch [char] = = or
  ch op-eq = or ch op-ne = or ch op-le = or ch op-ge = or if 1 exit then
  ch op-and = if 0 exit then
  ch op-or = if -1 exit then
  0 ;

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

\ ---------------------------------------------------------------------------
\ Lexical environment helpers

: ctx-current ( -- idx )  ctx-top @ 1- ;

: ctx-reset ( -- )
  0 local-count !  1 scope-top !  1 ctx-top !
  -1 0 cells ctx-parent + !
  0 0 cells ctx-slots + !
  0 0 cells ctx-base-local + !
  0 0 cells ctx-base-scope + !
  0 scope-local-base ! ;

: scope-push ( -- )
  scope-top @ lila-max-scopes >= if
    s" lila: scopes nested too deeply" lila-error
  then
  local-count @ scope-top @ cells scope-local-base + !
  1 scope-top +! ;

: scope-pop ( -- )
  scope-top @ 1 <= if s" lila: scope stack underflow" lila-error then
  -1 scope-top +!
  scope-top @ cells scope-local-base + @ local-count ! ;

: ctx-push ( -- )
  ctx-top @ lila-max-ctx >= if s" lila: functions nested too deeply" lila-error then
  ctx-top @ 1- ctx-top @ cells ctx-parent + !
  local-count @ ctx-top @ cells ctx-base-local + !
  scope-top @ ctx-top @ cells ctx-base-scope + !
  0 ctx-top @ cells ctx-slots + !
  1 ctx-top +! ;

: ctx-pop ( -- )
  ctx-top @ 1 <= if s" lila: context stack underflow" lila-error then
  -1 ctx-top +!
  ctx-top @ cells ctx-base-local + @ local-count !
  ctx-top @ cells ctx-base-scope + @ scope-top ! ;

: local-reserve ( -- slot )
  ctx-current { c }
  ctx-slots c cells + @
  dup lila-frame-slot-count >= if s" lila: too many locals" lila-error then
  dup 1+ ctx-slots c cells + !
  ;

: local-declare { c-addr u -- slot }
  c-addr u trim to u to c-addr
  u 0= if s" lila: empty local name" lila-error then
  local-count @ lila-max-locals >= if s" lila: too many locals" lila-error then
  c-addr u local-count @ 64 * local-names + place
  u local-count @ local-lens + c!
  ctx-current local-count @ local-ctx + c!
  local-reserve dup local-count @ cells local-slot + !
  1 local-count +! ;

: binding-find ( c-addr u -- idx )
  -1 bf-found !
  local-count @ 0 ?do
    2dup local-names i 64 * + 1+ local-lens i + c@ compare 0= if
      i bf-found !
    then
  loop
  2drop bf-found @ ;

: local-resolve { c-addr u -- }
  c-addr u binding-find lr-idx !
  lr-idx @ 0< if 0 0 false exit then
  lr-idx @ local-ctx + c@ lr-bctx !
  ctx-current lr-c !
  0 lr-level !
  begin
    lr-c @ 0< if 0 0 false exit then
    lr-c @ lr-bctx @ = if
      lr-level @ lr-idx @ cells local-slot + @ true exit
    then
    lr-c @ cells ctx-parent + @ lr-c !
    lr-level @ 1+ lr-level !
  again ;

: global-name { c-addr u -- c-addr' u' }
  s" lila-var-" lila-name place
  c-addr u lila-name +place
  lila-name count ;

: ensure-global { c-addr u -- }
  c-addr u global-name 2drop
  lila-name find nip 0= if
    s" lila-value-allot " lila-name count s+
    s"  " s+
    evaluate
    s" " lila-name count s+
    s"  3 lila-gc-register-root " s+
    evaluate
  then ;

: code-global-ref { c-addr u -- }
  c-addr u ensure-global
  s"  lila-var-" code+ c-addr u code+ s"  lila-value@ " code+ ;

: code-global-addr { c-addr u -- }
  c-addr u ensure-global
  s"  lila-var-" code+ c-addr u code+ ;

: buf-global-ref { c-addr u -- }
  c-addr u ensure-global
  s"  lila-var-" lila-buf buf+ c-addr u lila-buf buf+ s"  lila-value@ " lila-buf buf+ ;

: code-local-addr { level slot -- }
  s"  lila-active-frame @ " code+
  level 0 ?do s" lila-frame-parent " code+ loop
  slot code-number s"  lila-frame-slot " code+ ;

: code-local-ref { level slot -- }
  level slot code-local-addr s" lila-value@ " code+ ;

: code-var-ref { c-addr u -- }
  c-addr u local-resolve if
    code-local-ref
  else
    2drop c-addr u code-global-ref
  then ;

: code-var-addr { c-addr u -- }
  c-addr u local-resolve if
    code-local-addr
  else
    2drop c-addr u code-global-addr
  then ;

: buf-local-ref { level slot -- }
  s"  lila-active-frame @ " lila-buf buf+
  level 0 ?do s" lila-frame-parent " lila-buf buf+ loop
  slot buf-number s"  lila-frame-slot lila-value@ " lila-buf buf+ ;

: buf-var-ref { c-addr u -- }
  c-addr u local-resolve if
    buf-local-ref
  else
    2drop c-addr u buf-global-ref
  then ;

\ ---------------------------------------------------------------------------
\ Function metadata save/restore, closure targets, and loop state

: fn-save ( -- )
  fn-stack-top @ 64 >= if s" lila: functions nested too deeply" lila-error then
  fn-name count fn-stack-top @ 64 * fn-name-stack + place
  fn-param-count @ fn-stack-top @ cells fn-paramcount-stack + !
  fn-param-count @ 0 ?do
    fn-param-types i + c@
    fn-stack-top @ 16 * i + fn-paramtypes-stack + c!
  loop
  fn-vararg @ fn-stack-top @ cells fn-vararg-stack + !
  fn-id @ fn-stack-top @ cells fn-id-stack + !
  1 fn-stack-top +! ;

: fn-restore ( -- )
  -1 fn-stack-top +!
  fn-stack-top @ 64 * fn-name-stack + count fn-name place
  fn-stack-top @ cells fn-paramcount-stack + @ fn-param-count !
  fn-param-count @ 0 ?do
    fn-stack-top @ 16 * i + fn-paramtypes-stack + c@
    fn-param-types i + c!
  loop
  fn-stack-top @ cells fn-vararg-stack + @ fn-vararg !
  fn-stack-top @ cells fn-id-stack + @ fn-id ! ;

: next-fn-id ( -- id )  fn-counter @ 1 fn-counter +! ;

: tgt-push-global { c-addr u dest -- }
  tgt-top @ 64 >= if s" lila: functions nested too deeply" lila-error then
  c-addr u tgt-top @ 64 * tgt-name + place
  0 tgt-top @ tgt-kind + c!
  dest tgt-top @ tgt-dest + c!
  1 tgt-top +! ;

: tgt-push-local { level slot dest -- }
  tgt-top @ 64 >= if s" lila: functions nested too deeply" lila-error then
  level tgt-top @ cells tgt-level + !
  slot tgt-top @ cells tgt-slot + !
  1 tgt-top @ tgt-kind + c!
  dest tgt-top @ tgt-dest + c!
  1 tgt-top +! ;

: tgt-push-pending { c-addr u dest -- }
  tgt-top @ 64 >= if s" lila: functions nested too deeply" lila-error then
  c-addr u tgt-top @ 64 * tgt-name + place
  2 tgt-top @ tgt-kind + c!
  dest tgt-top @ tgt-dest + c!
  1 tgt-top +! ;

: loop-break-alloc ( -- )
  local-reserve current-loop-id @ cells loop-break-slots + ! ;

: loop-state-alloc ( -- )
  local-reserve current-loop-id @ cells loop-break-slots + !
  local-reserve current-loop-id @ cells loop-end-slots + !
  local-reserve current-loop-id @ cells loop-step-slots + ! ;

: code-loop-slot { slot -- }
  s" lila-active-frame @ " code+
  slot code-number s"  lila-frame-slot " code+ ;

: code-loop-break ( -- )
  current-loop-id @ cells loop-break-slots + @ code-loop-slot ;

: code-loop-end ( -- )
  current-loop-id @ cells loop-end-slots + @ code-loop-slot ;

: code-loop-step ( -- )
  current-loop-id @ cells loop-step-slots + @ code-loop-slot ;

: em-reset ( -- )  0 em-buf c! ;
: em+ ( c-addr u -- )  em-buf +place ;
: em-char ( ch -- )
  em-buf c@ 2040 >= if s" lila: literal too long" lila-error then
  em-buf count + c!
  em-buf c@ 1+ em-buf c! ;
: s-lit-em { c-addr u -- }
  s" s" em+
  [char] " em-char
  bl em-char
  c-addr u em+
  [char] " em-char ;

: append-space ( -- )
  lila-buf c@ if
    lila-buf count + 1- c@ bl <> if s"  " lila-buf buf+ then
  then ;

: param-string-name? { c-addr u -- flag }
  u 0> if c-addr u + 1- c@ [char] $ = else false then ;

: sig-find { c-addr u -- idx }
  c-addr u trim to u to c-addr
  sig-count @ 0 ?do
    c-addr u i 64 * sig-names + count compare 0= if
      i unloop exit
    then
  loop -1 ;

: sig-register ( -- )
  fn-name count sig-find { idx -- }
  idx 0< if
    sig-count @ 64 >= if s" lila: too many functions" lila-error then
    sig-count @ to idx
    fn-name count idx 64 * sig-names + place
    1 sig-count +!
  then
  fn-param-count @ idx sig-pcnt + c!
  fn-vararg @ idx sig-vararg + c!
  fn-param-count @ 0 ?do
    fn-param-types i + c@ idx 16 * i + sig-parm-types + c!
  loop ;

: call-result-type { n -- type }
  n 0 ?do
    type-pop  n 1- i - call-arg-types + c!
  loop
  call-top @ 1- 64 * call-names + count sig-find { idx -- }
  idx 0>= if
    idx sig-vararg + c@ if
      n idx sig-pcnt + c@ < if
        s" lila: not enough arguments" lila-error
      then
    else
      n idx sig-pcnt + c@ <> if
        s" lila: wrong number of arguments" lila-error
      then
    then
    n idx sig-pcnt + c@ min 0 ?do
      idx 16 * i + sig-parm-types + c@ 1 = if
        call-arg-types i + c@ dup type-known? if
          lila-tag-str <> if
            s" lila: argument to $ parameter must be a string" lila-error
          then
        else drop then
      then
    loop
  then
  lila-tag-unknown ;

: emit-string { c-addr u -- }
  lila-buf c@ start-push
  append-space
  em-reset
  c-addr u s-lit-em
  em-buf count lila-buf buf+
  s"  3 " lila-buf buf+
  lila-tag-str type-push ;

variable number-negative
: parse-number { c-addr u -- n }
  0 number-negative !
  c-addr c@ [char] - = if
    -1 number-negative !
    c-addr 1+ to c-addr
    u 1- to u
  then
  0 0 c-addr u >number 2drop drop
  number-negative @ if negate then ;

: lila-buf-number ( n -- )  0 <# #s #> lila-buf buf+ ;

: tx-rest-blank? ( -- flag )
  tx-i @ 1+ { j -- }
  begin j tx-u @ < while
    tx-addr @ j + c@ bl <> if false exit then
    j 1+ to j
  repeat true ;

defer vararg-raw?

: emit-number { n -- }
  append-space
  n lila>value-num
  >r
  over lila-buf-number s"  " lila-buf buf+
  dup lila-buf-number s"  " lila-buf buf+
  drop drop
  r> lila-buf-number s"  " lila-buf buf+ ;

: emit-operand { c-addr u -- }
  lila-buf c@ start-push
  c-addr u is-number? if
    c-addr u parse-number emit-number
    lila-tag-num type-push exit
  then
  c-addr u s" {}" compare 0= if
    append-space s" lila-table-new " lila-buf buf+
    lila-tag-table type-push exit
  then
  c-addr u s" nil" compare 0= if
    append-space s" 0 0 0 " lila-buf buf+
    lila-tag-nil type-push exit
  then
  c-addr u s" true" compare 0= if
    append-space s" 65535 0 2 " lila-buf buf+
    lila-tag-bool type-push exit
  then
  c-addr u s" false" compare 0= if
    append-space s" 0 0 2 " lila-buf buf+
    lila-tag-bool type-push exit
  then
  c-addr u s" ..." compare 0= if
    append-space
    vararg-raw? if
      s" lila-vararg " lila-buf buf+
      lila-tag-multi type-push
      call-top @ expr-call-base @ <> if 1 arg-vararg ! then
    else
      s" lila-vararg-first " lila-buf buf+
      lila-tag-unknown type-push
    then
    exit
  then
  c-addr u keyword? if
    append-space
    c-addr u lila-buf buf+
    lila-tag-num type-push exit
  then
  append-space
  c-addr u buf-var-ref
  lila-tag-unknown type-push ;

: num-op { ch -- }
  start-pop drop
  type-pop { rt } type-pop { lt }
  lt type-known? rt type-known? and if
    lt lila-tag-num <> rt lila-tag-num <> or if
      s" lila: number expected before operator" lila-error
    then
  then
  append-space
  ch [char] * = if s" lila-mul " else
    ch [char] / = if s" lila-div " else
      ch [char] % = if s" lila-mod " else
        ch op-idiv = if s" lila-idiv " else s" lila-pow " then
      then
    then
  then
  lila-buf buf+
  lila-tag-num type-push ;

: plus-op ( -- )
  start-pop drop
  type-pop { rt } type-pop { lt }
  lt type-known? rt type-known? and if
    lt rt <> if
      s" lila: cannot mix different types with +" lila-error
    then
    lt lila-tag-num <> lt lila-tag-str <> and if
      s" lila: + needs numbers or strings" lila-error
    then
  then
  append-space s" lila-add " lila-buf buf+
  lt type-known? rt type-known? and if
    lt type-push
  else
    lila-tag-unknown type-push
  then ;

: sub-op ( -- )
  start-pop drop
  type-pop { rt } type-pop { lt }
  lt type-known? rt type-known? and if
    lt lila-tag-num <> rt lila-tag-num <> or if
      s" lila: number expected before operator" lila-error
    then
  then
  append-space s" lila-sub " lila-buf buf+
  lila-tag-num type-push ;

: cmp-op { ch -- }
  start-pop drop
  type-pop { rt } type-pop { lt }
  lt type-known? rt type-known? and if
    lt rt <> if
      ch [char] = <> ch op-eq <> and ch op-ne <> and if
        s" lila: cannot compare different types" lila-error
      then
    then
  then
  append-space
  ch [char] = = ch op-eq = or if
    s" lila-eq " lila-buf buf+
  else
    ch op-ne = if
      s" lila-ne " lila-buf buf+
    else
      ch [char] < = if
        s" lila-lt " lila-buf buf+
      else
        ch [char] > = if
          s" lila-gt " lila-buf buf+
        else
          ch op-le = if
            s" lila-le " lila-buf buf+
          else
            s" lila-ge " lila-buf buf+
          then
        then
      then
    then
  then
  lila-tag-bool type-push ;

: emit-short { and? -- }
  start-pop { rs }
  and? if
    s" 2 pick 2 pick 2 pick lila-truthy 0= IF ELSE drop drop drop "
  else
    s" 2 pick 2 pick 2 pick lila-truthy IF ELSE drop drop drop "
  then
  rs buf-insert
  s"  THEN " lila-buf buf+
  type-pop drop type-pop drop
  lila-tag-unknown type-push ;

: emit-operator { ch -- }
  ch op-and = if true emit-short exit then
  ch op-or = if false emit-short exit then
  ch [char] ! = if
    type-pop drop
    append-space s" lila-not " lila-buf buf+
    lila-tag-bool type-push exit
  then
  ch [char] ~ = if
    type-pop dup type-known? if
      lila-tag-num <> if s" lila: number expected after unary minus" lila-error then
    else drop then
    append-space s" lila-neg " lila-buf buf+
    lila-tag-num type-push exit
  then
  ch [char] + = if plus-op exit then
  ch [char] - = if sub-op exit then
  ch [char] * = if ch num-op exit then
  ch [char] / = if ch num-op exit then
  ch [char] % = if ch num-op exit then
  ch op-idiv = if ch num-op exit then
  ch [char] ^ = if ch num-op exit then
  ch [char] < = if ch cmp-op exit then
  ch [char] > = if ch cmp-op exit then
  ch [char] = = if ch cmp-op exit then
  ch op-eq = if ch cmp-op exit then
  ch op-ne = if ch cmp-op exit then
  ch op-le = if ch cmp-op exit then
  ch op-ge = if ch cmp-op exit then
  drop ;

: push-op ( ch -- )  op-top @ op-stack + c!  1 op-top +! ;
: top-op ( -- ch )  op-top @ 0= if 0 else op-top @ 1- op-stack + c@ then ;
: pop-op ( -- )  top-op  -1 op-top +!  emit-operator ;
: marker-open? { ch -- flag }
  ch [char] ( =  ch [char] { = or  ch [char] [ = or
  ch [char] L = or  ch [char] S = or ;
: pop-while { prec -- }
  begin
    op-top @ 0> if
      top-op dup marker-open? if
        drop false
      else
        dup [char] ^ = prec 5 = and if
          drop false
        else
          op-precedence prec >=
        then
      then
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
: call-pop-emit { argc -- }
  call-top @ 0= if s" lila: call stack underflow" lila-error then
  -1 call-top +!
  call-top @ 64 * call-names + count buf-var-ref
  argc buf-number
  s"  lila-call " lila-buf buf+ ;

\ A call whose only argument is `...` passes the whole vararg list.
: call-pop-emit-multi ( -- )
  call-top @ 0= if s" lila: call stack underflow" lila-error then
  -1 call-top +!
  call-top @ 64 * call-names + count buf-var-ref
  s"  lila-call-multi " lila-buf buf+ ;

\ A call used as one value yields its first result; a call that ends a return
\ list or multi assignment keeps all of them.
: maybe-normalize-call ( -- )
  expr-expand @ if
    call-top @ expr-call-base @ = tx-rest-blank? and if exit then
  then
  s"  lila-first " lila-buf buf+ ;

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
    dup op-stack + c@ dup [char] { = swap [char] S = or if
      paren-args + 1 swap c!
      unloop exit
    then
    drop
  loop ;

:noname ( -- flag )
  call-top @ expr-call-base @ <> if true exit then
  innermost-marker drop [char] S = if true exit then
  expr-expand @ if tx-rest-blank? else false then ; is vararg-raw?

: flush-tok ( -- )
  tok-len @ 0= if exit then
  0 arg-vararg !
  tok-buf tok-len @ s" not" compare 0= if
    expect-operand @ 0= if
      s" lila: operator expected before not" lila-error
    then
    [char] ! push-op
    0 tok-len !
    exit
  then
  tok-buf tok-len @ s" and" compare 0= if
    expect-operand @ if
      s" lila: operand expected before and" lila-error
    then
    0 tok-len !
    op-and op-precedence pop-while
    op-and push-op
    1 expect-operand !
    exit
  then
  tok-buf tok-len @ s" or" compare 0= if
    expect-operand @ if
      s" lila: operand expected before or" lila-error
    then
    0 tok-len !
    op-or op-precedence pop-while
    op-or push-op
    1 expect-operand !
    exit
  then
  expect-operand @ 0= if
    s" lila: operator expected" lila-error
  then
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

: builtin-length? { c-addr u -- flag }
  c-addr u s" length" compare 0=
  c-addr u s" len" compare 0= or ;

: open-call ( -- )
  tok-buf tok-len @ identifier? 0= if
    s" lila: invalid function name" lila-error
  then
  tok-buf tok-len @ builtin-length? if
    0 tok-len !
    [char] L push-op
    0 op-top @ 1- paren-args + c!
    0 op-top @ 1- arg-counts + c!
    1 expect-operand !
    exit
  then
  tok-buf tok-len @ s" select" compare 0= if
    0 tok-len !
    [char] S push-op
    0 op-top @ 1- paren-args + c!
    0 op-top @ 1- arg-counts + c!
    1 expect-operand !
    exit
  then
  tok-buf tok-len @ call-push
  lila-buf c@ call-top @ 1- cells call-starts + !
  0 tok-len !
  [char] { push-op
  0 op-top @ 1- paren-args + c!
  0 op-top @ 1- arg-counts + c!
  1 expect-operand ! ;

: close-paren ( -- )
  flush-tok
  innermost-marker { ch idx }
  ch 0< if s" lila: unmatched )" lila-error then
  ch [char] L = if
    expect-operand @ if s" lila: length needs a string" lila-error then
    -1 pop-while
    -1 op-top +!
    type-pop dup type-known? if
      lila-tag-str <> if s" lila: length needs a string" lila-error then
    else drop then
    append-space s" lila-length " lila-buf buf+
    lila-tag-num type-push
    mark-arg
    0 expect-operand !
    exit
  then
  ch [char] S = if
    expect-operand @ if s" lila: select needs two arguments" lila-error then
    idx arg-counts + c@ 1+ 2 <> if
      s" lila: select needs a selector and ..." lila-error
    then
    -1 pop-while
    -1 op-top +!
    type-pop drop type-pop drop
    append-space s" lila-select " lila-buf buf+
    lila-tag-unknown type-push
    start-pop drop
    0 arg-vararg !
    mark-arg
    0 expect-operand !
    exit
  then
  ch [char] { = if
    idx paren-args + c@ 0= if
      idx arg-counts + c@ 0= if
        expect-operand @ if
          -1 op-top +!
          call-top @ 1- cells call-starts + @ { cs -- }
          0 call-result-type type-push
          0 call-pop-emit
          maybe-normalize-call
          cs start-push
          0 expect-operand !
          mark-arg
          exit
        then
      then
    then
  then
  expect-operand @ if
    s" lila: operand expected before )" lila-error
  then
  -1 pop-while
  -1 op-top +!
  ch [char] { = if
    idx paren-args + c@ if
      idx arg-counts + c@ 0= arg-vararg @ and if
        call-top @ 1- cells call-starts + @ { cs -- }
        type-pop drop
        lila-tag-unknown type-push
        call-pop-emit-multi
        maybe-normalize-call
        start-pop drop
        cs start-push
      else
        idx arg-counts + c@ 1+ { n -- }
        call-top @ 1- cells call-starts + @ { cs -- }
        n call-result-type type-push
        n call-pop-emit
        maybe-normalize-call
        n 0 ?do start-pop drop loop
        cs start-push
      then
    then
    mark-arg
  then
  0 expect-operand ! ;

: comma ( -- )
  flush-tok
  innermost-marker { ch idx }
  ch [char] { <> ch [char] S <> and if
    s" lila: comma outside call" lila-error
  then
  expect-operand @ if
    s" lila: operand expected before ," lila-error
  then
  0 arg-vararg !
  -1 pop-while
  1 idx paren-args + c!
  idx arg-counts + dup c@ 1+ swap c!
  1 expect-operand ! ;

: open-index ( -- )
  flush-tok
  expect-operand @ if s" lila: table expected before [" lila-error then
  [char] [ push-op
  0 op-top @ 1- paren-args + c!
  1 expect-operand ! ;

: close-index ( -- )
  flush-tok
  innermost-marker { ch idx }
  ch [char] [ <> if s" lila: unmatched ]" lila-error then
  expect-operand @ if s" lila: key expected before ]" lila-error then
  -1 pop-while
  -1 op-top +!
  type-pop { kt } type-pop { tt }
  kt type-known? if
    kt lila-tag-str <> if s" lila: table key must be a string" lila-error then
  then
  tt type-known? if
    tt lila-tag-table <> if s" lila: table expected before [" lila-error then
  then
  start-pop drop
  append-space s" lila-table-get " lila-buf buf+
  lila-tag-unknown type-push
  mark-arg
  0 expect-operand ! ;

\ Map an operator byte to its internal code.  `has-next` is true when a
\ second byte was available.  The result is ( code bytes-consumed ).
: op-code { ch next has-next -- code consumed }
  ch [char] = = has-next and next [char] = = and if op-eq 2 exit then
  ch [char] ~ = has-next and next [char] = = and if op-ne 2 exit then
  ch [char] < = has-next and next [char] = = and if op-le 2 exit then
  ch [char] > = has-next and next [char] = = and if op-ge 2 exit then
  ch [char] / = has-next and next [char] / = and if op-idiv 2 exit then
  ch 1 ;

: keyword-op? { c-addr u -- flag }
  c-addr u s" and" compare 0=
  c-addr u s" or" compare 0= or
  c-addr u s" not" compare 0= or ;

: transform-expr { c-addr u -- }
  lila-buf buf-reset  0 tok-len !  0 op-top !  1 expect-operand !
  0 in-string !  0 str-len !  0 type-top !  0 start-top !
  c-addr tx-addr !  u tx-u !  call-top @ expr-call-base !
  0 arg-vararg !
  0 { i }
  begin i u < while
    i tx-i !
    c-addr i + c@ { ch }
    ch [char] " = if
      in-string @ if
        str-buf str-len @ emit-string
        mark-arg
        0 expect-operand !
        0 in-string !
      else
        expect-operand @ 0= if
          s" lila: operator expected before string" lila-error
        then
        -1 in-string !
        0 str-len !
      then
    else
      in-string @ if
        str-len @ 1023 >= if s" lila: string literal too long" lila-error then
        ch str-buf str-len @ + c!
        1 str-len +!
      else
        ch bl = if
          flush-tok
        else
          ch [char] ( = if
            tok-len @ 0> if
              tok-buf tok-len @ keyword-op? if
                flush-tok open-group
              else
                open-call
              then
            else
              open-group
            then
          else
            ch [char] ) = if
              close-paren
            else
              ch [char] [ = if
                open-index
              else
                ch [char] ] = if
                  close-index
                else
                  ch [char] , = if
                    comma
                  else
                    ch op-char? if
                      flush-tok
                      ch [char] - = expect-operand @ and if
                        [char] ~ push-op
                      else
                        expect-operand @ if
                          s" lila: operand expected before operator" lila-error
                        then
                        ch
                        i 1+ u < if c-addr i 1+ + c@ true else 0 false then
                        op-code { code consumed -- }
                        code [char] ~ = if
                          s" lila: invalid operator" lila-error
                        then
                        code op-precedence pop-while
                        code push-op
                        consumed 2 = if i 1+ to i then
                        1 expect-operand !
                      then
                    else
                      ch tok-buf tok-len @ + c!
                      tok-len @ 1+ tok-len !
                    then
                  then
                then
              then
            then
          then
        then
      then
    then
    i 1+ to i
  repeat
  in-string @ if s" lila: unterminated string" lila-error then
  flush-tok
  expect-operand @ if s" lila: operand expected" lila-error then
  pop-all
  op-top @ 0<> if s" lila: unmatched (" lila-error then
  type-top @ 1 <> if s" lila: expression must leave one value" lila-error then
  start-top @ 1 <> if s" lila: internal start stack mismatch" lila-error then
  expr-types c@ expr-type ! ;

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
  c-addr u trim lila-lhs place ;

: code-lhs-ref ( -- )   lila-lhs count code-var-ref ;
: code-lhs-addr ( -- )  lila-lhs count code-var-addr ;

: assignment? { line len -- flag }
  line len s" =" split-at if
    2drop trim identifier?
  else
    2drop 2drop false
  then ;

: table-lhs? { c-addr u -- flag }
  c-addr u trim to u to c-addr
  u 2 < if false exit then
  c-addr u + 1- c@ [char] ] <> if false exit then
  c-addr u s" [" split-at if
    2drop trim identifier?
  else
    2drop 2drop false
  then ;

: table-assign? { line len -- flag }
  line len s" =" split-at if
    2drop table-lhs?
  else
    2drop 2drop false
  then ;

: compile-expr ( c-addr u -- )
  transform-expr
  lila-buf count code+
  s"  " code+ ;

: compile-rhs { c-addr u -- }
  c-addr u trim compile-expr ;

\ Compile an expression that may hand back a multi value (a call, `...`, or a
\ single ordinary value).  Used for return and the right side of a multi
\ assignment.
: compile-rhs-expand { c-addr u -- }
  -1 expr-expand !
  c-addr u compile-rhs
  0 expr-expand ! ;

\ First top-level comma, ignoring commas inside parentheses, brackets, braces,
\ and strings.
: split-top-comma { c-addr u -- lhs llen rhs rlen flag }
  0 { i }
  0 { depth }
  0 { q }
  begin i u < while
    c-addr i + c@ { ch }
    q 0<> if
      ch [char] " = if 0 to q then
    else
      ch [char] " = if
        -1 to q
      else
        ch [char] ( = ch [char] [ = or ch [char] { = or if
          depth 1+ to depth
        else
          ch [char] ) = ch [char] ] = or ch [char] } = or if
            depth 0> if depth 1- to depth then
          else
            ch [char] , = depth 0= and if
              c-addr i
              c-addr i + 1+ u i - 1-
              true exit
            then
          then
        then
      then
    then
    i 1+ to i
  repeat
  c-addr u 0 0 false ;

: top-comma? { c-addr u -- flag }
  c-addr u split-top-comma if 2drop 2drop true else 2drop 2drop false then ;

: lhs-list? ( c-addr u -- flag )
  trim
  2dup split-top-comma if
    2>r 2swap 2drop
    trim identifier? 0= if 2r> 2drop false exit then
    2r> recurse
  else
    2drop 2drop trim identifier?
  then ;

\ Split a comma-separated right-hand list.  With more than one expression the
\ expressions are packed into one multi value; with exactly one expression the
\ expression may already produce a multi value (a call or `...`).
: compile-rhs-list { c-addr u -- }
  c-addr u top-comma? if
    0 { n }
    begin
      c-addr u split-top-comma
    while
      { lhs llen rhs rlen }
      lhs llen compile-rhs
      n 1+ to n
      rhs to c-addr  rlen to u
    repeat
    2drop
    c-addr u compile-rhs
    n 1+ code-number s"  lila-multi-pack " code+
  else
    c-addr u compile-rhs-expand
  then ;

\ Multiple assignment: a, b = f() or a, b = b, a.  Targets are identifiers.
: multi-assignment? { line len -- flag }
  line len s" =" split-at 0= if 2drop 2drop false exit then
  \ lhs llen rhs rlen
  2drop  \ lhs llen
  2dup s" ," split-at 0= if 2drop 2drop 2drop false exit then
  \ lhs llen x y z w
  2drop 2drop  \ lhs llen
  lhs-list? ;

: emit-var-multi-stores { c-addr u idx -- }
  c-addr u split-top-comma if
    { lhs llen rhs rlen }
    idx code-number s"  lila-multi-fetch " code+
    lhs llen trim code-var-addr
    s"  lila-value! " code+
    rhs rlen idx 1+ recurse
  else
    2drop
    idx code-number s"  lila-multi-fetch " code+
    c-addr u trim code-var-addr
    s"  lila-value! " code+
  then ;

: compile-multi-assign { line len -- }
  line len s" =" split-at 0= if
    2drop 2drop s" lila: assignment needs =" lila-error
  then
  { lhs llen rhs rlen }
  lhs llen lhs-list? 0= if s" lila: invalid assignment target" lila-error then
  rhs rlen compile-rhs-list
  s"  lila-multi-ensure  lila-multi-hold " code+
  lhs llen 0 emit-var-multi-stores drop ;

\ local a, b = f().  The right side runs before the names exist.
: local-multi? { line len -- flag }
  line len s" local " string-prefix? 0= if false exit then
  line len 6 /string trim
  2dup s" =" split-at 0= if 2drop 2drop 2drop false exit then
  2drop
  2dup s" ," split-at 0= if 2drop 2drop 2drop 2drop false exit then
  2drop 2drop
  lhs-list? { flag }
  2drop flag ;

: emit-local-multi-stores { c-addr u idx -- }
  c-addr u split-top-comma if
    { lhs llen rhs rlen }
    lhs llen trim local-declare { slot }
    idx code-number s"  lila-multi-fetch " code+
    0 slot code-local-addr
    s"  lila-value! " code+
    rhs rlen idx 1+ recurse
  else
    2drop
    c-addr u trim local-declare { slot }
    idx code-number s"  lila-multi-fetch " code+
    0 slot code-local-addr
    s"  lila-value! " code+
  then ;

: compile-local-multi { line len -- }
  line len 6 /string trim
  s" =" split-at 0= if
    2drop 2drop s" lila: local assignment needs =" lila-error
  then
  { lhs llen rhs rlen }
  lhs llen lhs-list? 0= if s" lila: invalid local name" lila-error then
  rhs rlen compile-rhs-list
  s"  lila-multi-ensure  lila-multi-hold " code+
  lhs llen 0 emit-local-multi-stores drop ;

: parse-table-lhs { c-addr u -- key klen }
  c-addr u trim 1- to u
  c-addr u s" [" split-at 0= if
    s" lila: table name expected" lila-error
  then
  2over trim identifier? 0= if
    2drop 2drop 2drop s" lila: invalid table name" lila-error
  then
  2over trim lila-lhs place
  2swap 2drop
  trim ;

: table-assign-code { lhs llen rhs rlen -- }
  lhs llen parse-table-lhs { key-addr key-len -- }
  code-lhs-ref
  key-addr key-len compile-expr
  expr-type @ dup type-known? if
    lila-tag-str <> if s" lila: table key must be a string" lila-error then
  else drop then
  rhs rlen compile-rhs
  s"  lila-table-set " code+ ;

: compile-table-assign { line len -- }
  line len s" =" split-at if
    table-assign-code
  else
    2drop 2drop s" lila: table assignment needs =" lila-error
  then ;

: assign-code { lhs llen rhs rlen -- }
  rhs rlen compile-rhs
  lhs llen lila-store-lhs
  code-lhs-addr
  s"  lila-value! " code+ ;

: compile-assign-code { line len -- }
  line len s" =" split-at if
    assign-code
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
  compile-rhs-list
  s"  lila-print " code+ ;

: strip-cr ( c-addr u -- c-addr' u' )
  dup 0> if
    2dup + 1- c@ 13 = if 1- then
  then ;

: comment-at? { c-addr u i -- flag }
  i 1+ u >= if false exit then
  c-addr i + c@ [char] - <> if false exit then
  c-addr i 1+ + c@ [char] - = ;

: strip-comment { c-addr u -- c-addr' u' }
  0 0 { i q }
  begin i u < while
    c-addr i + c@ [char] " = if
      q 0= to q
    else
      q 0= if
        c-addr u i comment-at? if
          c-addr i trim exit
        then
      then
    then
    i 1+ to i
  repeat
  c-addr u trim ;

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

: lila-compile-break ( -- )
  body-id-current dup 0< if
    drop s" lila: break outside loop" lila-error
  then
  s" 1 " code+
  code-loop-break
  s" ! EXIT " code+ ;

: compile-return { line len -- }
  ctx-top @ 1 <= if s" lila: return outside function" lila-error then
  line len 6 /string trim
  dup 0= if
    2drop s" 0 0 0 " code+
  else
    compile-rhs-list
  then
  s"  lila-frame-ret! EXIT " code+ ;

: call-stmt? { c-addr u -- flag }
  c-addr u trim to u to c-addr
  c-addr u s" (" split-at if
    2drop trim identifier?
  else
    2drop 2drop false
  then ;

: compile-call-stmt { line len -- }
  line len compile-expr
  s"  lila-value-drop " code+ ;

defer lila-compile-local
defer lila-compile-local-function
defer lila-compile-anon-assign

: rhs-function? { line len -- flag }
  line len s" =" split-at if
    2swap 2drop trim
    2dup s" function" string-prefix? if
      2drop true
    else
      2drop false
    then
  else
    2drop 2drop false
  then ;

: compile-stmt-code { line len -- }
  line len trim
  2dup s" break" compare 0= if
    2drop lila-compile-break exit
  then
  2dup s" local function " string-prefix? if
    lila-compile-local-function exit
  then
  2dup local-multi? if
    compile-local-multi exit
  then
  2dup s" local " string-prefix? if
    lila-compile-local exit
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
  2dup rhs-function? if
    lila-compile-anon-assign exit
  then
  2dup table-assign? if
    compile-table-assign exit
  then
  2dup multi-assignment? if
    compile-multi-assign exit
  then
  2dup assignment? if
    compile-assign-code exit
  then
  2dup call-stmt? if
    compile-call-stmt exit
  then
  code+
  s"  " code+ ;

: find-delim { c-addr u ch -- idx }
  0 0 { i q -- }
  begin i u < while
    c-addr i + c@ [char] " = if
      q 0= to q
    else
      q 0= if
        c-addr i + c@ ch = if i exit then
      then
    then
    i 1+ to i
  repeat
  -1 ;

: split-stmt { c-addr u -- lhs llen rhs rlen flag }
  c-addr u [char] ; find-delim { idx -- }
  idx 0< if
    c-addr u 0 0 false exit
  then
  c-addr idx
  c-addr idx + 1+  u idx - 1-
  true ;

: compile-block { c-addr u -- }
  c-addr u split-stmt if
    2over compile-stmt-code
    s"  lila-gc-maybe " code+
    2swap 2drop
    recurse
  else
    2drop compile-stmt-code
    s"  lila-gc-maybe " code+
  then ;

: strip-end { c-addr u -- c-addr' u' flag }
  u 3 >= if
    c-addr u + 3 - 3 s" end" compare 0= if
      u 3 = if c-addr u 3 - true exit then
      c-addr u + 4 - c@ bl = if c-addr u 3 - true exit then
    then
  then
  c-addr u false ;

: fn-set-name { c-addr u -- }
  c-addr u trim to u to c-addr
  u 0= if s" lila: invalid function name" lila-error then
  c-addr u identifier? 0= if s" lila: invalid function name" lila-error then
  u 63 > if s" lila: function name too long" lila-error then
  c-addr u fn-name place ;

\ Returns ( body blen params plen ).
: fn-header { c-addr u -- body blen params plen }
  c-addr u s" (" split-at 0= if
    2drop 2drop s" lila: function needs a parameter list" lila-error
  then
  2over fn-set-name
  2swap 2drop
  s" )" split-at 0= if
    2drop 2drop s" lila: function needs )" lila-error
  then
  2swap ;

\ Parse the parameter list of an anonymous function body starting at "(".
: fn-anon-header { c-addr u -- body blen params plen }
  c-addr u trim
  dup 0= if drop s" lila: function needs a parameter list" lila-error then
  over c@ [char] ( <> if s" lila: function needs a parameter list" lila-error then
  1 /string
  s" )" split-at 0= if
    2drop 2drop s" lila: function needs )" lila-error
  then
  2swap ;

: add-param { c-addr u -- }
  c-addr u trim to u to c-addr
  u 0= if s" lila: empty parameter" lila-error then
  c-addr u identifier? 0= if s" lila: invalid parameter" lila-error then
  fn-param-count @ 16 >= if s" lila: too many parameters" lila-error then
  c-addr u  fn-param-count @ 64 * fn-params + place
  c-addr u param-string-name? if 1 else 0 then
  fn-param-count @ fn-param-types + c!
  c-addr u local-declare drop
  1 fn-param-count +! ;

: parse-param-part { c-addr u -- }
  c-addr u trim
  2dup s" ..." compare 0= if
    2drop -1 fn-vararg !
  else
    add-param
  then ;

: parse-params { c-addr u -- }
  c-addr u trim to u to c-addr
  u 0= if exit then
  c-addr u s" ," split-at if
    2swap
    2dup parse-param-part
    2drop
    recurse
  else
    2drop 2drop
    c-addr u parse-param-part
  then ;

: function-body-start ( -- )
  code-push
  code-top @ 1- 65536 * body-bufs + code-buf !
  0 code-len ! ;

\ ---------------------------------------------------------------------------
\ Closure creation and function wrappers

create tb-buf 1024 allot
: tb-reset ( -- )  0 tb-buf c! ;
: tb+ ( c-addr u -- )  tb-buf +place ;
: tb-number ( n -- )  0 <# #s #> tb+ ;
: tb-append { dest -- }
  tb-buf count  dest 0= if code+ else defs+ then ;

: closure-buf { id dest -- }
  tb-reset
  s" 0 " tb+
  dest 0= if s" ['] " tb+ else s" ' " tb+ then
  s" lila-fn-" tb+
  id tb-number
  s"  far-xt lila-active-frame @ lila-closure-new " tb+ ;

: closure-store-global { id c-addr u dest -- }
  id dest closure-buf
  s" lila-var-" tb+ c-addr u tb+ s"  lila-value! " tb+
  dest tb-append ;

: closure-store-local { id level slot dest -- }
  id dest closure-buf
  s" lila-active-frame @ " tb+
  level 0 ?do s" lila-frame-parent " tb+ loop
  slot tb-number s"  lila-frame-slot lila-value! " tb+
  dest tb-append ;

: closure-store-pending { id c-addr u dest -- }
  c-addr u local-declare { slot -- }
  id 0 slot dest closure-store-local ;

: emit-fn-definition ( -- )
  s" : lila-fn-body-" defs+ fn-id @ defs-number s"  " defs+
  code-buf @ code-len @ defs+
  s"  ; " defs+
  s" : lila-fn-" defs+ fn-id @ defs-number s"  " defs+
  s" lila-call-argc ! lila-active-frame @ >r lila-frame-new " defs+
  s" dup lila-active-frame ! dup lila-frame-tmp ! drop " defs+
  s" lila-call-argc @ " defs+
  fn-param-count @ defs-number
  s"  - lila-multi-pack " defs+
  s" lila-frame-tmp @ lila-frame-varargs lila-value! " defs+
  fn-param-count @ 0 ?do
    s" lila-frame-tmp @ " defs+
    fn-param-count @ 1- i - defs-number
    s"  lila-frame-slot lila-value! " defs+
  loop
  s" lila-fn-body-" defs+ fn-id @ defs-number s"  " defs+
  s" lila-frame-result r> lila-active-frame ! ; " defs+ ;

\ The body is its own word so `return` can EXIT it from anywhere, including
\ a nested loop body.  The wrapper builds the call frame, stores arguments,
\ and always reaches the epilogue, so every call leaves exactly one result.
: function-end ( -- )
  sig-register
  emit-fn-definition
  code-pop
  fn-id @ { id -- }
  tgt-top @ 1- { ti -- }
  fn-restore
  ctx-pop
  tgt-kind ti + c@ 0= if
    id tgt-name ti 64 * + count tgt-dest ti + c@ closure-store-global
  else
    tgt-kind ti + c@ 1 = if
      id tgt-level ti cells + @ tgt-slot ti cells + @
      tgt-dest ti + c@ closure-store-local
    else
      id tgt-name ti 64 * + count tgt-dest ti + c@ closure-store-pending
    then
  then
  -1 tgt-top +! ;

: lila-fn-from-line { line len local? -- }
  fn-save
  line len local? if 15 else 9 then /string trim fn-header
  2swap fn-body-len ! fn-body-addr !
  local? if
    0 fn-name count local-declare 0 tgt-push-local
  else
    fn-name count local-resolve if
      0 tgt-push-local
    else
      2drop
      fn-name count ensure-global
      ctx-top @ 1 = block-top @ 0= and >r
      fn-name count r> tgt-push-global
    then
  then
  next-fn-id fn-id !
  ctx-push
  scope-push
  0 fn-param-count !
  0 fn-vararg !
  parse-params
  function-body-start
  fn-body-addr @ fn-body-len @ trim
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

: lila-compile-function { line len -- }
  line len 0 lila-fn-from-line ;

: lila-compile-local-function-do { line len -- }
  line len 1 lila-fn-from-line ;

' lila-compile-local-function-do is lila-compile-local-function

: lila-fn-anon { lhs llen rhs rlen local? -- }
  fn-save
  lhs llen fn-set-name
  rhs rlen trim
  dup 0= if 2drop s" lila: function expected" lila-error then
  2dup s" function" string-prefix? 0= if
    2drop s" lila: function expected" lila-error
  then
  8 /string fn-anon-header
  2swap fn-body-len ! fn-body-addr !
  local? if
    lhs llen trim 0 tgt-push-pending
  else
    lhs llen trim local-resolve if
      0 tgt-push-local
    else
      2drop
      lhs llen trim ensure-global
      lhs llen trim 0 tgt-push-global
    then
  then
  next-fn-id fn-id !
  ctx-push
  scope-push
  0 fn-param-count !
  0 fn-vararg !
  parse-params
  function-body-start
  fn-body-addr @ fn-body-len @ trim
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

: lila-compile-anon-assign-do { line len -- }
  line len trim s" =" split-at 0= if
    2drop 2drop s" lila: assignment expected" lila-error
  then
  2over trim identifier? 0= if
    2drop 2drop s" lila: invalid assignment target" lila-error
  then
  0 lila-fn-anon ;

' lila-compile-anon-assign-do is lila-compile-anon-assign

: lila-compile-local-do { line len -- }
  line len 6 /string trim
  s" =" split-at if
    ( name nlen rhs rlen )
    2dup trim
    2dup s" function" string-prefix? if
      2drop
      2over trim identifier? 0= if
        2drop 2drop s" lila: invalid local name" lila-error
      then
      1 lila-fn-anon
    else
      2drop
      2over trim identifier? 0= if
        2drop 2drop s" lila: invalid local name" lila-error
      then
      2dup compile-expr
      2swap
      local-declare
      0 swap code-local-addr
      s"  lila-value! " code+
      2drop
    then
  else
    2drop
    2dup trim identifier? 0= if
      2drop s" lila: invalid local name" lila-error
    then
    local-declare
    s"  0 0 0 " code+
    0 swap code-local-addr
    s"  lila-value! " code+
  then ;

' lila-compile-local-do is lila-compile-local

: lila-compile-else ( -- )
  block-top@ [char] i <> if s" lila: else without if" lila-error then
  scope-pop
  s" ELSE " code+
  scope-push
  [char] e block-set-top ;

: lila-compile-elseif { line len -- }
  block-top@ [char] i <> if s" lila: elseif without if" lila-error then
  line len 7 /string trim
  s" then" split-at if
    ( cond clen rest rlen )
    scope-pop
    s" ELSE " code+
    2over compile-expr
    s"  lila-truthy IF " code+
    2swap 2drop
    trim
    dup 0<> if
      2drop s" lila: elseif body must start on a new line" lila-error
    then
    2drop
    scope-push
    1 block-extra+!
  else
    2drop 2drop
    s" lila: elseif without then" lila-error
  then ;

: emit-fn-ret-check ( -- )
  ctx-top @ 1 > if
    s" lila-frame-ret? IF EXIT THEN " code+
  then ;

: emit-fn-cond ( -- )
  ctx-top @ 1 > if
    s" lila-frame-ret? 0= AND " code+
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
    scope-pop
    emit-fn-ret-check
    exit
  then
  dup [char] w = if
    drop drop
    loop-body-end
    s" REPEAT " code+
    scope-pop
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
    scope-pop
    exit
  then
  drop drop s" lila: bad block type" lila-error ;

: lila-compile-if { line len -- }
  line len 3 /string trim
  s" then" split-at if
    ( cond clen rest rlen )
    2over compile-expr
    s"  lila-truthy IF " code+
    2swap 2drop
    trim
    dup 0= if
      2drop [char] i block-push scope-push exit
    then
    s" end" split-at if
      ( body blen tail tlen )
      2drop
      s" else" split-at if
        ( thenbody tlen elsebody elen )
        2swap
        scope-push compile-block scope-pop
        s" ELSE " code+
        scope-push compile-block scope-pop
        s" THEN " code+
      else
        2drop
        scope-push compile-block scope-pop
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
    loop-break-alloc
    s" 0 " code+
    code-loop-break
    s" ! BEGIN " code+
    2over compile-expr
    s"  lila-truthy " code+
    code-loop-break
    s" @ 0= AND " code+
    emit-fn-cond
    s" WHILE " code+
    2swap 2drop
    trim
    dup 0= if
      2drop
      current-loop-id @ loop-body-start
      scope-push
      [char] w block-push
      exit
    then
    s" end" split-at if
      2drop
      current-loop-id @ loop-body-start
      scope-push
      compile-block
      scope-pop
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
        loop-state-alloc
        for-end count compile-expr
        code-loop-end
        s"  lila-value! " code+
        for-step count compile-expr
        code-loop-step
        s"  lila-value! " code+
        for-start count compile-expr
        code-loop-step
        s"  lila-value@  lila-sub " code+
        scope-push
        lila-lhs count local-declare drop
        code-lhs-addr
        s"  lila-value! " code+
        s" 0 " code+
        code-loop-break
        s"  ! BEGIN " code+
        code-loop-break
        s"  @ 0= IF " code+
        code-lhs-ref
        code-loop-step
        s"  lila-value@  lila-add " code+
        code-lhs-addr
        s"  lila-value! " code+
        code-loop-step
        s"  lila-value@  lila-num>32 0> IF " code+
        code-lhs-ref
        code-loop-end
        s"  lila-value@  lila-le  lila-truthy ELSE " code+
        code-lhs-ref
        code-loop-end
        s"  lila-value@  lila-ge  lila-truthy THEN " code+
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
          1 for-depth +!
          compile-block
          -1 for-depth +!
          scope-pop
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
  2dup s" local function " string-prefix? if lila-compile-local-function exit then
  2dup local-multi? if compile-local-multi exit then
  2dup s" local " string-prefix? if lila-compile-local exit then
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
  0 fn-param-count !
  0 fn-vararg !
  0 fn-stack-top !
  0 fn-id !
  0 tgt-top !
  0 call-top !
  0 expr-expand !
  ctx-reset
  s" 0 lila-frame-new dup lila-active-frame ! drop " defs+ ;

: lila-compile-finish ( -- )
  block-top @ 0<> if s" lila: unterminated block" lila-error then
  for-depth @ 0<> if s" lila: unbalanced for loop" lila-error then
  code-top @ 0<> if s" lila: code stack not empty" lila-error then
  body-id-top @ 0<> if s" lila: body stack not empty" lila-error then
  ctx-top @ 1 <> if s" lila: unterminated function" lila-error then
  fn-stack-top @ 0<> if s" lila: function stack not empty" lila-error then
  tgt-top @ 0<> if s" lila: function target stack not empty" lila-error then
  scope-top @ 1 <> if s" lila: scope stack not empty" lila-error then
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
