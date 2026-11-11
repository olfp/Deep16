\ LILA compiler smoke tests for the gforth host prototype.
\ Run with: gforth lila/test.fs

include lila.fs

: lila-test-fail ( -- )
  ." lila test FAILED" cr bye ;

: check-num { addr n -- }
  addr lila-value@ { v1 v2 tag }
  tag lila-tag-num <> if lila-test-fail then
  v1 v2 lila-32 n <> if lila-test-fail then ;

: check-bool { addr flag -- }
  addr lila-value@ { v1 v2 tag }
  tag lila-tag-bool <> if lila-test-fail then
  v1 0<> flag 0<> <> if lila-test-fail then ;

: check-nil { addr -- }
  addr lila-value@ nip nip lila-tag-nil <> if lila-test-fail then ;

: check-str { addr c-addr u -- }
  addr lila-value@ { v1 v2 tag }
  tag lila-tag-str <> if lila-test-fail then
  v1 v2 c-addr u compare 0<> if lila-test-fail then ;

: check-table { addr -- }
  addr lila-value@ nip nip lila-tag-table <> if lila-test-fail then ;

: check-table-num { addr keyaddr keylen n -- }
  addr lila-value@ keyaddr keylen lila-tag-str lila-table-get { v1 v2 tag }
  tag lila-tag-num <> if lila-test-fail then
  v1 v2 lila-32 n <> if lila-test-fail then ;

: check-table-str { addr keyaddr keylen c-addr u -- }
  addr lila-value@ keyaddr keylen lila-tag-str lila-table-get { v1 v2 tag }
  tag lila-tag-str <> if lila-test-fail then
  v1 v2 c-addr u compare 0<> if lila-test-fail then ;

: check-table-nil { addr keyaddr keylen -- }
  addr lila-value@ keyaddr keylen lila-tag-str lila-table-get nip nip
  lila-tag-nil <> if lila-test-fail then ;

: check= ( actual expected -- )
  = 0= if ." lila test FAILED" cr bye then ;

: check-true ( flag -- )
  0= if ." lila test FAILED" cr bye then ;

\ Arithmetic: every value is three cells, but numbers still use signed 32-bit
\ payloads split across the low and high halves.
s" x = 5" lila-eval          lila-var-x 5 check-num
s" y = x + 3" lila-eval      lila-var-y 8 check-num
s" z = x * 2 + 1" lila-eval  lila-var-z 11 check-num
s" w = x + 3 * 2" lila-eval  lila-var-w 11 check-num
s" n = -3" lila-eval         lila-var-n -3 check-num
s" q = x-3" lila-eval        lila-var-q 2 check-num
s" r = x + -3" lila-eval     lila-var-r 2 check-num
s" s = 10 / 2" lila-eval     lila-var-s 5 check-num
s" p = (1 + 2) * (3 + 4)" lila-eval  lila-var-p 21 check-num
s" pp = ((2 + 3) * (4 - 1)) / 5" lila-eval  lila-var-pp 3 check-num
s" pn = -(1 + 2)" lila-eval  lila-var-pn -3 check-num
s" big = 100000" lila-eval   lila-var-big 100000 check-num
s" big2 = big + big" lila-eval  lila-var-big2 200000 check-num
s" negbig = -100000" lila-eval  lila-var-negbig -100000 check-num
s" 2 3 +" lila-eval          5 check=   \ Forth pass-through

\ control flow: single-line forms, with ';' separating body statements
s" if x > 0 then t = 1 else t = 0 end" lila-eval   lila-var-t 1 check-num
s" if x < 0 then u = 1 else u = 0 end" lila-eval   lila-var-u 0 check-num
s" bt = 3 > 2" lila-eval      lila-var-bt true check-bool
s" bf = 3 < 2" lila-eval      lila-var-bf false check-bool
s" i = 0" lila-eval
s" while i < 3 do i = i + 1 end" lila-eval          lila-var-i 3 check-num
s" if i > 0 then j = 2 ; k = j + 1 end" lila-eval  lila-var-k 3 check-num
s" evsum = 0" lila-eval
s" for evi = 1, 4 do evsum = evsum + evi end" lila-eval  lila-var-evsum 10 check-num
s" evn = 0" lila-eval
s" while evn < 10 do evn = evn + 1 ; break end" lila-eval  lila-var-evn 1 check-num
s" evb = 0" lila-eval
s" for evj = 1, 10 do evb = evb + evj ; break end" lila-eval  lila-var-evb 1 check-num

\ file loader: multi-line if/else, nested while, comments, single-line blocks
s" lila/test.lila" lila-load
lila-var-fy 5 check-num
lila-var-fsum 3 check-num
lila-var-fi 3 check-num
lila-var-fneg 0 check-num
lila-var-fmax 2 check-num
lila-var-fgrade 20 check-num
lila-var-ffor 6 check-num
lila-var-fstep 9 check-num
lila-var-fdown 6 check-num
lila-var-fmod 5 check-num
lila-var-fsingle 6 check-num
lila-var-fnest 9 check-num
lila-var-fparen 21 check-num
lila-var-fprec 9 check-num
lila-var-fnegexpr -3 check-num
lila-var-fcond 1 check-num
lila-var-frange 10 check-num
lila-var-fbrk 3 check-num
lila-var-fbsum 6 check-num
lila-var-fbnest 33 check-num
lila-var-fbsingle 1 check-num

\ functions and procedures
s" function add(a, b) return a + b end" lila-eval
s" fnadd = add(2, 3)" lila-eval           lila-var-fnadd 5 check-num
s" fnmul = add(1, 2) * 4" lila-eval       lila-var-fnmul 12 check-num
s" fnnest = add(add(1, 2), 4)" lila-eval  lila-var-fnnest 7 check-num
s" function fortytwo() return 42 end" lila-eval
s" fnzero = fortytwo()" lila-eval         lila-var-fnzero 42 check-num
s" function inc(p) p = p + 1 ; return p end" lila-eval
s" fnp = inc(6)" lila-eval                lila-var-fnp 7 check-num
s" fnproc = 0" lila-eval
s" function bump(n) fnproc = fnproc + n end" lila-eval
s" bump(5)" lila-eval
s" bump(2)" lila-eval                     lila-var-fnproc 7 check-num
s" if fortytwo() > 0 then fncond = 1 else fncond = 0 end" lila-eval
lila-var-fncond 1 check-num
s" function double(x) return x * 2 end" lila-eval
s" function quad(x) return double(double(x)) end" lila-eval
s" fnquad = quad(3)" lila-eval            lila-var-fnquad 12 check-num

\ functions loaded from a file
lila-var-ffnadd 5 check-num
lila-var-ffnquad 12 check-num
lila-var-ffnsum 10 check-num
lila-var-ffnfirst 4 check-num
lila-var-ffnclass -1 check-num
lila-var-ffnfind 400 check-num
lila-var-ffnbrk 6 check-num
lila-var-fntotal 8 check-num
lila-var-ffnproc check-nil
lila-var-ffnnothing check-nil
lila-var-ffnlater 7 check-num

\ A function without an explicit return produces nil rather than a number.
s" function noret() end" lila-eval
s" nr = noret()" lila-eval                lila-var-nr check-nil

\ Function results are dynamically tagged, so different return tags are fine.
s\" function retdyn(v) return v end" lila-eval
s\" rd1 = retdyn(\"yes\")" lila-eval            lila-var-rd1 s" yes" check-str
s\" rd2 = retdyn(7)" lila-eval                lila-var-rd2 7 check-num

\ Tables: mixed value tags, missing keys are nil, and dynamic variable retyping.
s\" tab = {}" lila-eval
s\" tab[\"k\"] = 3" lila-eval
s\" tabv = tab[\"k\"] + 1" lila-eval        lila-var-tabv 4 check-num
s\" tab[\"k\"] = 8" lila-eval
s\" tabw = tab[\"k\"]" lila-eval            lila-var-tabw 8 check-num
s\" tabm = tab[\"no\"]" lila-eval           lila-var-tabm check-nil
s\" tab[\"two words\"] = 2" lila-eval
s\" tabx = tab[\"two words\"]" lila-eval    lila-var-tabx 2 check-num
s\" tab[\"\"] = 4" lila-eval
s\" tabe = tab[\"\"]" lila-eval             lila-var-tabe 4 check-num
s\" tabcopy = tab" lila-eval
s\" tabc = tabcopy[\"k\"]" lila-eval        lila-var-tabc 8 check-num
s\" greet = \"hey\"" lila-eval
s\" tab[greet] = 6" lila-eval
s\" tabg = tab[greet]" lila-eval           lila-var-tabg 6 check-num
s\" print(\"ok\")" lila-eval

\ table and string checks from test.lila
lila-var-ft s" a" 9 check-table-num
lila-var-ft s" b" 7 check-table-num
lila-var-ft s" hello world" 11 check-table-num
lila-var-ft s" " 3 check-table-num
lila-var-ft s" hello" 21 check-table-num
lila-var-ft s" nope" check-table-nil
lila-var-ftabsum 12 check-num
lila-var-ftabmiss check-nil
lila-var-fnested 4 check-num
lila-var-fparam 8 check-num
lila-var-fstr s" world" check-str
lila-var-fstr2 s" hello" check-str

\ string expressions: concatenation, length, comparison
s\" sa = \"foo\"" lila-eval
s\" sb = sa + \"bar\"" lila-eval           lila-var-sb s" foobar" check-str
s\" sc = \"x\" + \"y\" + \"z\"" lila-eval
s\" print(sc)" lila-eval
s\" sl = length(sc)" lila-eval             lila-var-sl 3 check-num
s\" sl2 = len(\"hello\") + 1" lila-eval     lila-var-sl2 6 check-num
s\" scmp1 = \"abc\" = \"abc\"" lila-eval    lila-var-scmp1 true check-bool
s\" scmp2 = \"abc\" = \"abd\"" lila-eval    lila-var-scmp2 false check-bool
s\" scmp3 = \"abc\" < \"abd\"" lila-eval    lila-var-scmp3 true check-bool
s\" scmp4 = \"b\" > \"a\"" lila-eval        lila-var-scmp4 true check-bool
s\" stab = {}" lila-eval
s\" stab[\"k\" + \"2\"] = 17" lila-eval
s\" stabv = stab[\"k2\"]" lila-eval         lila-var-stabv 17 check-num
s\" scond = 0" lila-eval
s\" if sa = \"foo\" then scond = 1 end" lila-eval  lila-var-scond 1 check-num

\ string-expression checks from test.lila
lila-var-fgreet s" hello, world" check-str
lila-var-fmatch 1 check-num
lila-var-fmsg s" n=42!" check-str
lila-var-ft s" k2" 17 check-table-num

\ string parameters and string returns from test.lila
lila-var-ffnstr s" hello, lila" check-str
lila-var-ffnshout s" hello, world!" check-str
lila-var-ffe s" abab" check-str
lila-var-ffex s" hey!" check-str
lila-var-ffzed s" zed" check-str

\ strings as table values from test.lila
lila-var-fnames s" first" s" alice!" check-table-str
lila-var-ffncopyname s" alice!" check-str
lila-var-fmissinglength 0 check-num
lila-var-ffnfullname s" alice!?" check-str
lila-var-ffnnameok 1 check-num
lila-var-fmarked s" value" s" bob" check-table-str

\ A table can hold different tags at once and can grow past 64 elements.
s\" mix = {}" lila-eval
s\" mix[\"n\"] = 1" lila-eval
s\" mix[\"s\"] = \"two\"" lila-eval
s\" mix[\"b\"] = true" lila-eval
s\" mix[\"z\"] = nil" lila-eval
s\" mix[\"t\"] = {}" lila-eval
s\" mixt = mix[\"t\"]" lila-eval
s\" mixt[\"x\"] = 3" lila-eval
lila-var-mix s" n" 1 check-table-num
lila-var-mix s" s" s" two" check-table-str
lila-var-mix s" z" check-table-nil
lila-var-mixt s" x" 3 check-table-num

: key-i { n -- c-addr u }
  n s>d <# #s #> { a u -- }
  a u s" " lila-str-concat ;

s\" gt = {}" lila-eval
: grow-test ( -- )
  100 0 ?do
    i key-i { a u -- }
    lila-var-gt lila-value@ a u lila-tag-str i lila>value-num lila-table-set
  loop ;
grow-test
lila-var-gt @ table-count@ 100 check=
lila-var-gt @ @ 16 > check-true
lila-var-gt s" 0" 0 check-table-num
lila-var-gt s" 64" 64 check-table-num
lila-var-gt s" 99" 99 check-table-num

\ Variables are dynamically typed and may change tag between assignments.
s\" dyn = 1" lila-eval
s\" dyn = \"text\"" lila-eval              lila-var-dyn s" text" check-str
s\" dyn = 5" lila-eval                     lila-var-dyn 5 check-num
s\" dyn = true" lila-eval                  lila-var-dyn true check-bool
s\" dyn = nil" lila-eval                   lila-var-dyn check-nil

\ locals, lexical scope, recursion, and closures loaded from test.lila
lila-var-flbase 2 check-num
lila-var-flinner 3 check-num
lila-var-flouter 2 check-num
lila-var-flfact 120 check-num
lila-var-flfib 55 check-num
lila-var-flca 1 check-num
lila-var-flcb 2 check-num
lila-var-flcc 11 check-num
lila-var-flcd 3 check-num
lila-var-fladder 15 check-num
lila-var-flapply 42 check-num
lila-var-flsame true check-bool
lila-var-flother false check-bool

\ boolean/logical operators and the Lua-like operator set from test.lila
lila-var-op_and_val 5 check-num
lila-var-op_and_false false check-bool
lila-var-op_and_nil check-nil
lila-var-op_and_str s" yes" check-str
lila-var-op_or_val 7 check-num
lila-var-op_or_true true check-bool
lila-var-op_or_nil 3 check-num
lila-var-op_or_zero 5 check-num
lila-var-op_not_true false check-bool
lila-var-op_not_false true check-bool
lila-var-op_not_nil true check-bool
lila-var-opshort1 false check-bool
lila-var-opshort2 true check-bool
lila-var-opshort3 97 check-num
lila-var-opshort4 96 check-num
lila-var-opcalls 2 check-num
lila-var-op_eq true check-bool
lila-var-op_ne true check-bool
lila-var-op_le true check-bool
lila-var-op_ge true check-bool
lila-var-op_lt false check-bool
lila-var-op_str_le true check-bool
lila-var-op_str_ge true check-bool
lila-var-op_str_ne true check-bool
lila-var-op_mod 3 check-num
lila-var-op_mod_neg 1 check-num
lila-var-op_mod_div_neg -1 check-num
lila-var-op_idiv 3 check-num
lila-var-op_idiv_neg -4 check-num
lila-var-op_idiv_div_neg -4 check-num
lila-var-op_pow 1024 check-num
lila-var-op_prec 19 check-num
lila-var-op_rpow 512 check-num
lila-var-op_negpow -4 check-num
lila-var-op_cond1 1 check-num
lila-var-op_cond2 0 check-num
lila-var-op_cond3 1 check-num
lila-var-op_cond4 1 check-num
lila-var-op_short_zero1 false check-bool
lila-var-op_short_zero2 true check-bool

\ anonymous function literals and captured upvalues from a single eval
s" anon = function(v) return v + 1 end" lila-eval
s" anonv = anon(4)" lila-eval              lila-var-anonv 5 check-num

\ expected compiler errors, with output suppressed
: quiet-eval ( c-addr u -- flag )
  outfile-id >r
  s" /dev/null" w/o open-file throw dup >r to outfile-id
  ['] lila-eval catch
  r> close-file throw
  r> to outfile-id
  0<> ;

: expect-error ( flag -- )
  0= if ." lila test FAILED: expected an error" cr bye then ;

s\" function estring(s$) return s$ end" lila-eval
s" en = estring(3)" quiet-eval expect-error

s\" ert = {}" lila-eval
s\" function ertput(tbl, s$) tbl[\"x\"] = s$ end" lila-eval
s\" ertput(ert, \"v\")" lila-eval
s\" ertn = ert[\"x\"]" lila-eval
lila-var-ertn s" v" check-str
s\" ertbad = ert[\"x\"] + 1" quiet-eval expect-error

s" function eargs(a, b) return a + b end" lila-eval
s" eargsn = eargs(1)" quiet-eval expect-error

\ arithmetic and logic runtime errors
s" op_err_and = true and 1 / 0" quiet-eval expect-error
s" op_err_or = false or 1 / 0" quiet-eval expect-error
s" op_err_pow = 2 ^ -1" quiet-eval expect-error
s" op_err_mod = 5 % 0" quiet-eval expect-error
s" op_err_idiv = 5 // 0" quiet-eval expect-error

\ multiple returns and varargs from test.lila
lila-var-mra 10 check-num
lila-var-mrb 20 check-num
lila-var-mrc 10 check-num
lila-var-mrx 1 check-num
lila-var-mry 2 check-num
lila-var-mrz 3 check-num
lila-var-msa 8 check-num
lila-var-msb 7 check-num
lila-var-mlsum 30 check-num
lila-var-mta 11 check-num
lila-var-mtb 12 check-num

\ minimal standard library: type, conversions, strings, math, errors
lila-var-std_type_num s" number" check-str
lila-var-std_type_str s" string" check-str
lila-var-std_type_bool s" boolean" check-str
lila-var-std_type_nil s" nil" check-str
lila-var-std_type_table s" table" check-str
lila-var-std_type_fn s" function" check-str
lila-var-std_numstr s" -45" check-str
lila-var-std_boolstr s" true" check-str
lila-var-std_nilstr s" nil" check-str
lila-var-std_tonum 42 check-num
lila-var-std_tonum_hex 31 check-num
lila-var-std_tonum_bad check-nil

lila-var-std_sub s" bcd" check-str
lila-var-std_sub_neg s" ef" check-str
lila-var-std_upper s" MIXED" check-str
lila-var-std_lower s" mixed" check-str
lila-var-std_rep s" ababab" check-str
lila-var-std_rev s" cba" check-str
lila-var-std_len 5 check-num
lila-var-std_byte 98 check-num
lila-var-std_char s" ABC" check-str

lila-var-std_abs 9 check-num
lila-var-std_max 9 check-num
lila-var-std_min 3 check-num
lila-var-std_mtype s" integer" check-str
lila-var-std_toint 5 check-num
lila-var-std_maxint 2147483647 check-num
lila-var-std_minint -2147483648 check-num
lila-var-std_firstout s" 88" check-str

\ pcall returns a success flag plus results, or a failure flag plus the error
lila-var-std_pok true check-bool
lila-var-std_pval 5 check-num
lila-var-std_perr false check-bool
lila-var-std_pmsg s" boom" check-str
lila-var-std_pbad false check-bool
lila-var-std_pbadmsg s" lila: cannot add these values" check-str
lila-var-std_pas false check-bool
lila-var-std_pamsg s" nope" check-str
lila-var-std_assertval 5 check-num
lila-var-std_ax 1 check-num
lila-var-std_ay 2 check-num
lila-var-std_pnone false check-bool
lila-var-std_pnonemsg s" lila: function expected" check-str

." lila tests passed" cr
bye
