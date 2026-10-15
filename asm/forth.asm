; =============================================
; Enhanced Deep16 Forth Kernel - FIXED PARSING
; =============================================

; The kernel proper starts at 0x0100, further down, just before forth_start.
; The echo cell comes first because it sits in the I/O segment.

.equ SP R13
.equ SCR R8
.equ TIB R6           ; Text Input Buffer pointer
.equ >IN R5           ; Input pointer offset
; Reserve R14 as LR (link register). Store stack base in memory.
.equ KBD_STATUS 0x0060
.equ KBD_DATA   0x0062
; Echo on/off, inside the Keyboard Controller block. See echo_flag below: it is
; pinned to an address rather than living in the kernel's data area, because the
; Screen tab writes it from the browser with nothing of the kernel running.
.equ ECHO_FLAG  0x0064
.equ TIB_LIMIT 128        ; characters tib_kbd holds, one word per character.
                         ; tib_kbd has one more word than this, for the NUL
                         ; that bios_getstr_done writes after the last one
; The high byte of a screen word is four bits of background and four bits of
; foreground, (bg << 4) | fg. Attribute 0 means "no colour set" and the
; terminal default draws it, so a blank cell is written as 0x0020 and the
; kernel never has to store a colour of its own.
;
; The order is the ANSI one, so the foreground is the LOW nibble and the
; background the high one. A program that paints a foreground therefore masks
; the colour with 0x0F and ORs it in; shifting the value left by four puts it
; into the background instead, which shows up as a fully painted cell in the
; colour that was meant for the character. See forth/hanoi.fth set-fg-attr.
;
; The cursor is not a bit of its own: with both nibbles in use there is no bit
; left for it, and there does not need to be. Reverse video is the two nibbles
; swapped, so the cursor cell is the default colour reversed - black on light
; grey, 0x70 in the high byte - and "clear the cursor" is simply the attribute
; back to 0. Both operations keep the character in the low byte untouched.
.equ CURSOR_ATTR 0x7000  ; high byte 0x70: fg 0 (black) on bg 7 (light grey)
.equ ATTR_MASK   0x00FF  ; the character alone, i.e. a cell with no attribute
.equ RSTACK_TOP 0x6F00   ; Forth return stack top (grows down)

; =============================================
; Terminal echo on/off (0xF0064, ES-relative)
; =============================================
;
; Non-zero echoes, zero does not. This is the one screen switch that is read
; inside the BIOS rather than by Forth, because the keyboard echo is drawn
; there and nowhere else: accept hands the line buffer to BIOS getstr (function
; 5) and getstr draws each character itself. Nothing in the interpreter takes
; part, which is exactly why this cell had to be somewhere the browser can reach
; on its own - the Screen tab switches it off around a file upload without
; running a single Forth word.
;
; It sits in the Keyboard Controller block next to KBD_STATUS/KBD_DATA, and both
; sides already address that block with ES = 0xF000: the kernel sets ES once at
; boot (forth_start) and writes the screen through it 87 times, and the BIOS sets
; it again before it touches the screen. Only 0xF0060 and 0xF0062 are decoded as
; real registers; every core treats 0xF0064 as ordinary memory, so a write from
; outside the machine lands and is read back by getstr. A cell in the kernel's
; own data area would have been the wrong home: that address moves every time the
; interpreter grows, and a UI that hard-codes a moving address breaks silently.
;
; This silences the keyboard echo and nothing else. What a program prints still
; appears: " ok" after every line goes out through putstr, and emit sends
; ordinary characters to putch. That is the useful half - a source file is mostly
; its own text, and nobody wants to read it twice off a 25-row screen.
.org 0xF0064
echo_flag:
    .word 1                  ; echo on, so a freshly loaded machine behaves as before

; =============================================
; Forth Kernel Implementation
; =============================================

.org 0x0100
.code
forth_start:
    ; Initialize stack pointer
    LDI 0x7FF0
    MOV SP, R0
    LDI sp0_base
    MOV R2, R0
    ST  SP, R2, 0
    
    ; Set up screen segment for output
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x1000
    MOV SCR, R0
    ; Configure PSW: ER=8 (R8), DE=1 via LPSW/SPSW
    LPSW R12
    LDI 0x07FF
    AND R12, R0
    LDI 0x4000      ; Sign-extends to 0xC000 (DE=1, ER=8)
    OR  R12, R0
    SPSW R12
    ; Ready for screen output at ES:SCR

    ; Install SWI vector early to enable BIOS calls
    LDI 0
    MVS DS, R0
    LDI 2
    MOV R2, R0
    LDI swi_to_bios
    MOV R1, R0
    STS R1, DS, R2

    LDI 1
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    SWI
    
cursor_on:
    LDS R1, ES, SCR
    LDI 0x0070          ; fg 0 / bg 7. Nicht LDI 0x7000: das Immediate
    SL  R0, 8           ; ist 15 Bit und signiert, 0x7000 laege als 0xF000
    OR  R1, R0              ; the cursor attribute, the character stays
    STS R1, ES, SCR
    LDI 3               ; BIOS putstr
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 3
    LDI 1
    MOV R7, R0
    LDI hello_msg
    STS R0, DS, R7      ; DS:[1] = hello_msg
    SWI
    LDI after_print_text
    MOV PC, R0
    NOP

; -------------------------
; Common subroutines
.code
; print_text prints the NUL-terminated string at R0 through putch (the single
; choke point for character output) and returns via LR. LR is saved because
; put_char is itself called with LINK.
print_text:
    MOV R1, R0
    LDI pt_lr
    MOV R3, R0
    ST LR, R3, 0
pt_loop:
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ pt_done
    NOP
    LDI put_char
    MOV R4, R0
    MOV R0, R2
    LINK
    JMP R4
    NOP
    ADD R1, 1
    LDI pt_loop
    MOV PC, R0
    NOP
pt_done:
    LDI pt_lr
    MOV R3, R0
    LD LR, R3, 0
    JMP LR
    NOP
print_prompt:
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 1               ; DS offset 1
    MOV R7, R0
    LDI '>'
    STS R0, DS, R7      ; DS:[1] = '>'
    SWI
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 1               ; DS offset 1
    MOV R7, R0
    LDI ' '
    STS R0, DS, R7      ; DS:[1] = ' '
    SWI
    JMP LR
    NOP
bios_putch_direct:
    MOV R2, R0           ; park the character: R0 is rebuilt below
    LDI 2
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    MOV R0, R2
    STS R0, DS, R7
    SWI
    JMP LR
    NOP
bios_putstr_direct:
    MOV R2, R0           ; park the string address: R0 is rebuilt below
    LDI 3
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    MOV R0, R2
    STS R0, DS, R7
    SWI
    JMP LR
    NOP
bios_getch_direct:
    LDI 4
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    SWI
    LDI 1
    MOV R7, R0
    LDS R0, DS, R7
    JMP LR
    NOP
bios_getstr_direct:
    MOV R2, R0           ; park the buffer address: R0 is rebuilt below
    LDI 5
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    MOV R0, R2
    STS R0, DS, R7
    SWI
    JMP LR
    NOP
newline_direct:
    ; CR + LF via BIOS putch so the cursor moves to a fresh line (with
    ; scrolling on the last row). Same newline the interpreter prints
    ; after " ok".
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    LDI 13              ; CR
    STS R0, DS, R7
    SWI
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7
    LDI 1
    MOV R7, R0
    LDI 10              ; LF
    STS R0, DS, R7
    SWI
    JMP LR
    NOP
cursor_off:
    LDS R1, ES, SCR
    LDI ATTR_MASK
    MOV R7, R0
    AND R1, R7           ; drop the attribute, keep the character
    STS R1, ES, SCR
    LDI interpret_loop
    MOV PC, R0
    NOP

; clear_cursor erases the block cursor at ES:SCR and returns. The error paths
; need it because they move SCR to the next line without writing over the cell
; the cursor sits in — on the success path the result overwrites that cell, so
; nothing is left behind.
;
; The mask must be built by hand: LDI takes a sign-extended 15-bit immediate,
; so "LDI 0x7FFF" loads 0xFFFF and the AND would clear nothing. (The BIOS gets
; away with the broken mask because it overwrites the cell with the character
; right afterwards.)
clear_cursor:
    LDS R1, ES, SCR
    LDI ATTR_MASK
    MOV R7, R0
    AND R1, R7           ; drop the attribute, keep the character
    STS R1, ES, SCR
    JMP LR
    NOP
    ; Ensure Data Segment points to physical 0x0000
    LDI 0
    MVS DS, R0
    ; Ensure Code/Stack segments are also 0x0000 for correct jumps/stack
    MVS SS, R0
    MVS CS, R0
    LDI 2
    MOV R2, R0
    LDI swi_to_bios
    MOV R1, R0
    STS R1, DS, R2

    ; Print greeting only
    LDI hello_msg
    MOV R1, R0
    LDI after_print_text
    MOV LR, R0
    LDI print_text
    MOV R2, R0
    MOV R0, R1
    JMP R2
    NOP
after_print_text:
    ; Advance to start of next line (column 0)
    LDI 0x1000
    MOV R8, R0           
    MOV R9, SCR          
    SUB R9, R8           
    LDI 80               
    MOV R10, R0          
    MOV R11, R9          
    DIV R11, R10         
    ADD R11, 1           
    MUL R11, R10         
    ADD R8, R11          
    MOV SCR, R8          
    ; Prepare input buffer and counters
    LDI tib_kbd
    MOV TIB, R0
    LDI 0
    MOV >IN, R0
    LDI 0
    MOV R11, R0
    LDI print_prompt
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI word_accept
    MOV PC, R0
    NOP

; Bridge SWI handler: set CS to BIOS segment and jump to offset 0
swi_to_bios:
    ; Build target CS=0xF800 and PC=0 and far jump via JML
    LDI 0x0FFF
    INV R0               ; R0 = 0xF000
    MOV R2, R0           ; R2 = 0xF000
    LDI 0x0800
    MOV R3, R0           ; R3 = 0x0800
    ADD R2, R3           ; R2 = 0xF800 (target CS)
    LDI 0
    MOV R3, R0           ; R3 = 0x0000 (target PC)
    JML R2               ; delayed far jump to CS=R2, PC=R3

; =============================================
; Text Interpreter Core - SIMPLIFIED
; =============================================

text_interpreter:    
interpret_loop:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JNZ not_eol
    NOP
    LDI interpret_done
    MOV PC, R0
    NOP
not_eol:
    LDI ' '
    CMP R2, R0
    JNZ token_start
    NOP
    ADD >IN, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
token_start:
    LDI '"'
    CMP R2, R0
    JNZ check_backslash
    NOP
    ; Bare string opening: step inside the string. Whether it prints now or is
    ; compiled depends on the state, so string_action decides.
    ADD >IN, 1
    LDI string_action
    MOV PC, R0
    NOP
check_backslash:
    ; A backslash comments out the rest of the line. It is recognised by its
    ; first character, exactly like the parenthesis below, so it needs no entry
    ; in the dictionary and cannot be shadowed by a word of the same name.
    ;
    ; The apostrophe was swallowed here the same way back when `'` had nothing
    ; behind it. It is a dictionary word now, so that branch is gone and `'`
    ; reaches parse_word like any other token.
    LDI 92
    CMP R2, R0
    JNZ check_paren
    NOP
    ADD >IN, 1               ; step over the backslash itself
    LDI comment_scan
    MOV PC, R0
    NOP
check_paren:
    ; An opening parenthesis comments out everything up to the matching close,
    ; which may sit in the middle of a line:  1 2 + ( three ) .  works.
    LDI 40
    CMP R2, R0
    JNZ check_dot_token
    NOP
    ADD >IN, 1               ; step over the '(' itself
    LDI paren_scan
    MOV PC, R0
    NOP
check_dot_token:
    LDI '.'
    CMP R2, R0
    JNZ check_s_token
    NOP
    MOV R3, TIB
    ADD R3, >IN
    ADD R3, 1
    LD R4, R3, 0
    LDI '"'
    CMP R4, R0
    JNZ dot_plain
    NOP
    LD R5, R3, 1
    LDI ' '
    CMP R5, R0
    JZ farpatch304
    NOP
    LDI skip_unknown
    MOV PC, R0
    NOP
farpatch304:
    NOP
    MOV R1, R3
    SUB R1, TIB
    MOV >IN, R1
    ADD >IN, 1
    LDI string_action
    MOV PC, R0
    NOP
dot_plain:
    ; `.` is an ordinary dictionary word; route it through parse_word so the
    ; compile state and immediate flag are honoured. >IN still sits on '.'.
    LDI parse_word
    MOV PC, R0
    NOP
; A bare `"` and a `."` differ only in whether a dot precedes them, and both
; arrive here with >IN on the first character inside the quotes. Interpreted,
; they print and throw the text away. Compiled, they have to leave something
; behind that prints the text when the word is CALLED, so the characters are
; copied into the definition and the definition gets
;
;     xt_lit  <address of the characters>  xt_litstr  <characters>  0
;
; The address cannot be known until the three header cells have been reserved,
; so it is reserved first and filled in afterwards.
;
; The destination pointer is R11, NOT R9. PSW.ER = 8 with the dual bit set
; (see the PSW setup at the top of this file) makes R8 *and* R9 the ES-base
; register pair, so every `ST Rx, R9, n` lands at ES:R9 = 0xF0000 + R9 — on
; the screen, silently. R11 is neither an ER nor an SR register, so it is an
; ordinary DS base. R9 is still usable as a *value*, which is all it is here.
string_action:
    LDI state_var
    MOV R2, R0
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JNZ dotq_compile        ; compiling: emit code instead of printing
    NOP
    LDI print_string_skip
    MOV PC, R0
    NOP

dotq_compile:
    LDI dp_var
    MOV R2, R0
    LD R11, R2, 0            ; R11 = HERE, where the three header cells go
    LDI xt_lit
    MOV R4, R0
    ST R4, R11, 0            ; LIT
    ADD R11, 1
    ADD R11, 1
    ADD R11, 1               ; R11 = HERE + 3, where the characters start
    MOV R9, R11              ; the characters' address, kept for the second cell
    ST R9, R11, -2           ; the address of the characters
    LDI xt_litstr
    MOV R4, R0
    ST R4, R11, -1           ; litstr
    ; The characters, the NUL and the step over the closing quote live in
    ; copy_string, which `s"` copies with as well.
    LDI copy_string
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI dp_var
    MOV R2, R0
    ST R11, R2, 0            ; publish HERE, one past the NUL
    LDI interpret_loop
    MOV PC, R0
    NOP

print_string_skip:
    MOV R1, TIB
    ADD R1, >IN
psk_loop:
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ after_string
    NOP
    LDI ' '
    CMP R2, R0
    JNZ psk_go
    NOP
    ADD >IN, 1
    ADD R1, 1
    LDI psk_loop
    MOV PC, R0
    NOP
psk_go:
    LDI print_string_body
    MOV PC, R0
    NOP
print_string_body:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ after_string
    NOP
    LDI '"'
    CMP R2, R0
    JZ after_string
    NOP
    ; Handle escaped quote \" -> print '"' and continue
    LDI '\\'
    CMP R2, R0
    JNZ print_string_normal
    NOP
    LD R5, R1, 1
    LDI '"'
    CMP R5, R0
    JNZ print_string_normal
    NOP
    LDI put_char
    MOV R4, R0
    LDI '"'
    LINK
    JMP R4
    NOP
    ADD >IN, 2
    LDI print_string_body
    MOV PC, R0
    NOP
print_string_normal:
    LDI put_char
    MOV R4, R0
    MOV R0, R2
    LINK
    JMP R4
    NOP
    ADD >IN, 1
    LDI print_string_body
    MOV PC, R0
    NOP
after_string:
    ADD >IN, 1
    LDI interpret_loop
    MOV PC, R0
    NOP
; ----------------------------------------------------------------------
; Comments
;
; Both forms are handled by the tokenizer rather than by the dictionary, so
; they work at the prompt and inside a definition alike - a comment is simply
; never offered to the compiler:
;
;     : hypot ( a b -- c )  a a * b b * + sqrt ;
;
; comment_scan is entered with >IN on the first character behind the backslash
; and paren_scan with >IN on the first character behind the '('; they share the
; scan loop and differ only in what ends them. Both leave >IN where the scan
; stopped, which is on the NUL for a backslash and behind the ')' for a
; parenthesis - in both cases a position the interpret loop already knows how to
; continue from.
;
; A '(' without a ')' on the same line is treated as a comment to the end of
; the line. That is the forgiving reading of a typo: the rest of the line is
; dropped instead of every ')' afterwards in the file being swallowed.
comment_scan:               ; \ - up to the end of the line
    MOV R1, TIB
    ADD R1, >IN
comment_eol_next:
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ comment_done
    NOP
    ADD >IN, 1
    ADD R1, 1
    LDI comment_eol_next
    MOV PC, R0
    NOP
paren_scan:                 ; ( - up to the ')', or the end of the line
    MOV R1, TIB
    ADD R1, >IN
paren_next:
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ comment_done          ; no ')' on this line: see the note above
    NOP
    LDI ')'
    CMP R2, R0
    JNZ paren_go
    NOP
    ADD >IN, 1               ; over the ')' - the comment ends behind it
    LDI comment_done
    MOV PC, R0
    NOP
paren_go:
    ADD >IN, 1
    ADD R1, 1
    LDI paren_next
    MOV PC, R0
    NOP
comment_done:
    LDI interpret_loop
    MOV PC, R0
    NOP

check_s_token:
    ; `s"` is the string that answers an address and a length instead of
    ; printing. It is recognised by its first two characters, like `."` above
    ; and for the same reason: what follows it is not a token, so it can never
    ; reach the dictionary. The branch itself is six words - this block has no
    ; room to spare - and sq_token_check does the peeking.
    LDI 's'
    CMP R2, R0
    JNZ check_number_or_word
    NOP
    LDI sq_token_check
    MOV PC, R0
    NOP

check_number_or_word:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    ; Hex first, before the digit test: '$' sorts below '0', so "$FF" would be
    ; read as a word, and "0x.." has to be caught while >IN still sits on the '0'.
    ; The peek uses R10 and R11: R5 is >IN, R6 is TIB and R13/R14 are SP/LR, so
    ; the only free registers here are R9, R10 and R11.
    LDI '$'
    CMP R4, R0
    JZ hex_prefix_one
    NOP
    ; Only a leading '0' may open "0x". This is JNZ and not JN on purpose: JN
    ; would let every character above '0' through to the 'x' peek below, and
    ; then any token whose SECOND character is 'x' became a hex number. That is
    ; how `exe` turned into 0xE and `execute` into 0xEC, leaving "ute" behind as
    ; an undefined word: `exit` only escaped because "xi" holds no hex digit and
    ; parse_hex_finish sends a digit-less prefix back to parse_word anyway.
    LDI '0'
    CMP R4, R0
    JNZ word_first_is_digit
    NOP
    MOV R10, R3
    ADD R10, 1
    LD R10, R10, 0
    LDI 'x'
    CMP R10, R0
    JZ hex_prefix_two
    NOP
    LDI 'X'
    CMP R10, R0
    JZ hex_prefix_two
    NOP
word_first_is_digit:
    LDI '0'
    CMP R4, R0
    JN number_letter          ; below '0': a letter, or punctuation
    NOP
    LDI '9'
    CMP R0, R4
    JN number_letter          ; above '9': a letter, or punctuation
    NOP
    ; The first character is a digit, but the word is a number only if the
    ; whole token is digits. Words such as 2dup, 1+ or 0= start with a digit.
    LDI number_scan
    MOV PC, R0
    NOP
number_letter:
    ; Above base ten the letters A-F are digits too, so a token that starts
    ; with one may be a number (`FF` in hex) or a word (`dup`). number_scan
    ; still reads the whole token and hands anything that is not all digits to
    ; parse_word, so every name that is not a number keeps its meaning: `ff`
    ; would shadow a word of that name, which is the standard's own "undefined"
    ; case, but `dup` never becomes a number.
    LDI base_var
    MOV R2, R0
    LD R4, R2, 0
    LDI 10
    CMP R4, R0
    JN parse_word             ; base below ten: no letter is a digit
    NOP
    JZ parse_word             ; base ten: only 0-9 are digits
    NOP
    LDI number_scan
    MOV PC, R0
    NOP
number_scan:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ parse_number          ; NUL ends the token => number
    NOP
    LDI ' '
    CMP R4, R0
    JZ parse_number          ; space ends the token => number
    NOP
    ; Every character has to be a digit OF THE CURRENT BASE: 'A' is one in hex
    ; and a word character in decimal. The digit itself comes from base_digit,
    ; which knows 0-9 and A-F, and the base decides whether it counts here.
    LDI base_digit
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R9, R0
    JZ parse_word            ; not a digit at all makes it a word
    NOP
    LDI base_var
    MOV R2, R0
    LD R2, R2, 0             ; the current base
    CMP R10, R2
    JN number_scan_next      ; value < base: a digit here
    NOP
    LDI parse_word           ; a digit of some other base makes it a word
    MOV PC, R0
    NOP
number_scan_next:
    ADD R3, 1
    LDI number_scan
    MOV PC, R0
    NOP
parse_number:
    LDI 0
    MOV R7, R0               ; the accumulator
parse_number_loop:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ finish_number
    NOP
    LDI ' '
    CMP R4, R0
    JZ finish_number
    NOP
    LDI base_digit
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R9, R0
    JZ finish_number        ; not a digit: the number ends here
    NOP
    LDI base_var
    MOV R2, R0
    LD R2, R2, 0
    CMP R10, R2
    JN number_digit_ok
    NOP
    LDI finish_number       ; a digit of some other base ends the number
    MOV PC, R0
    NOP
number_digit_ok:
    ; digit in range: acc = acc * base + digit, with the base still in R2
    MOV R1, R7
    MUL R1, R2
    ADD R1, R10
    MOV R7, R1
    ADD >IN, 1
    LDI parse_number_loop
    MOV PC, R0
    NOP
finish_number:
    ; A number pushes its value; while compiling it becomes LIT <value>.
    LDI state_var
    MOV R2, R0
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JNZ compile_number
    NOP
    MOV R1, R7
    SUB SP, 1
    ST R1, SP, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
compile_number:
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    LDI xt_lit
    MOV R4, R0
    ST R4, R3, 0             ; LIT
    ADD R3, 1
    ST R7, R3, 0             ; the literal
    ADD R3, 1
    ST R3, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
hex_prefix_one:              ; >IN on the '$'
    MOV R11, >IN             ; where the token began
    LDI 0
    MOV R9, R0               ; R9 = 0 until a digit is consumed
    ADD >IN, 1               ; step over the prefix
    LDI parse_hex
    MOV PC, R0
    NOP
hex_prefix_two:              ; >IN on the '0' of "0x"
    MOV R11, >IN
    LDI 0
    MOV R9, R0
    ADD >IN, 2               ; step over "0x"
    LDI parse_hex
    MOV PC, R0
    NOP
parse_hex:
    LDI 0
    MOV R7, R0               ; the accumulator, exactly as parse_number keeps it
parse_hex_loop:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ parse_hex_finish      ; NUL ends the token
    NOP
    LDI ' '
    CMP R4, R0
    JZ parse_hex_finish      ; space ends the token
    NOP
    LDI hex_digit_value      ; R10 = the digit 0..15, or the token ends
    MOV PC, R0
    NOP
parse_hex_accumulate:
    LDI 1
    MOV R9, R0               ; a digit was consumed
    MOV R4, R10              ; the digit, ready for the multiply-add
    LDI 16
    MOV R12, R0
    MOV R1, R7
    MUL R1, R12
    ADD R1, R4
    MOV R7, R1
    ADD >IN, 1
    LDI parse_hex_loop
    MOV PC, R0
    NOP
parse_hex_finish:
    ; A prefix with no digits behind it was never a number: "0x", "0X" and a
    ; bare "$" are words, and saying so beats silently pushing 0. The test is
    ; R9, not >IN: the prefix itself moves >IN, so "0x ." would otherwise look
    ; exactly like a number that stopped at a space. >IN goes back to where the
    ; token started (R11) so parse_word reads the whole thing, which is what
    ; turns "0x ." into "undefined word: 0x" rather than a silent no-op.
    LDI 0
    CMP R9, R0
    JNZ hex_got_digits
    NOP
    MOV >IN, R11
    LDI parse_word
    MOV PC, R0
    NOP
hex_got_digits:
    LDI state_var
    MOV R3, R0
    LD R3, R3, 0
    LDI 0
    CMP R3, R0
    JZ parse_hex_push
    NOP
    LDI compile_number
    MOV PC, R0
    NOP
parse_hex_push:
    MOV R1, R7
    SUB SP, 1
    ST R1, SP, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
; The character in R4 becomes its value 0..15 in R10. A character that is not a
; hex digit ends the token, and where that leaves the parser decides the
; message: "0x1g" has a digit already, so it is the number 1 followed by the
; word "g", while "0xZZ" has none and the whole token is the word.
hex_digit_value:
    LDI '0'
    CMP R4, R0
    JN hex_digit_alpha
    NOP
    LDI '9'
    CMP R0, R4
    JN hex_digit_alpha
    NOP
    LDI '0'
    SUB R4, R0
    MOV R10, R4
    LDI parse_hex_accumulate
    MOV PC, R0
    NOP
hex_digit_alpha:
    LDI 'a'
    CMP R4, R0
    JN hex_digit_upper
    NOP
    LDI 'f'
    CMP R0, R4
    JN hex_digit_upper
    NOP
    LDI 87                  ; 'a' is 97, and 97 - 87 = 10
    SUB R4, R0
    MOV R10, R4
    LDI parse_hex_accumulate
    MOV PC, R0
    NOP
hex_digit_upper:
    LDI 'A'
    CMP R4, R0
    JN parse_hex_finish
    NOP
    LDI 'F'
    CMP R0, R4
    JN parse_hex_finish
    NOP
    LDI 55                  ; 'A' is 65, and 65 - 55 = 10
    SUB R4, R0
    MOV R10, R4
    LDI parse_hex_accumulate
    MOV PC, R0
    NOP
parse_word:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ interpret_done
    NOP
    LDI ' '
    CMP R4, R0
    JZ interpret_done
    NOP
    ; Measure the token first: R11 = length. The delimiters stay
    ; untouched so a match can advance >IN by exactly the token length.
    LDI 0
    MOV R11, R0
word_len_loop:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ word_len_done
    NOP
    LDI ' '
    CMP R4, R0
    JZ word_len_done
    NOP
    ADD R3, 1
    ADD R11, 1
    LDI word_len_loop
    MOV PC, R0
    NOP
word_len_done:
    ; Search each wordlist in the search order (R12 = index). Within a
    ; wordlist the headers chain newest first: link | flags+len | name | CFA.
    LDI 0
    MOV R12, R0
find_wl:
    LDI search_order
    MOV R2, R0
    ADD R2, R12
    LD R2, R2, 0             ; head cell address of this wordlist
    LDI 0
    CMP R2, R0
    JZ skip_unknown          ; end of the search order: token is unknown
    NOP
    LD R7, R2, 0             ; newest header in this wordlist
find_loop:
    LDI 0
    CMP R7, R0
    JZ find_next_wl
    NOP
    LD R2, R7, 1             ; flags+len cell
    LDI 0x00FF
    AND R2, R0               ; name length stored in this header
    CMP R2, R11
    JNZ find_next
    NOP
    ; Lengths agree: compare the name characters.
    MOV R10, R7
    ADD R10, 2               ; name starts at header+2
    MOV R3, TIB
    ADD R3, >IN
    MOV R9, R11              ; character countdown
find_cmp:
    LD R2, R3, 0
    LD R4, R10, 0
    CMP R2, R4
    JNZ find_next
    NOP
    ADD R3, 1
    ADD R10, 1
    SUB R9, 1
    LDI 0
    CMP R9, R0
    JNZ find_cmp
    NOP
    ; Match: the CFA (xt) cell sits at header + 2 + length + 1 (NUL from .text).
    MOV R2, R7
    ADD R2, 3
    ADD R2, R11
    MOV R1, R2               ; R1 = xt = CFA cell address
    LD R4, R7, 1             ; flags+len cell
    LDI 1
    SL R0, 15                ; R0 = 0x8000 (IMMEDIATE mask; LDI is 15-bit)
    AND R4, R0               ; R4 = IMMEDIATE flag
    ADD >IN, R11             ; step over the token
    ; While compiling, a non-immediate word is appended to the definition.
    LDI state_var
    MOV R3, R0
    LD R3, R3, 0
    LDI 0
    CMP R3, R0
    JZ find_execute
    NOP
    LDI 0
    CMP R4, R0
    JNZ find_execute
    NOP
    LDI dp_var
    MOV R3, R0
    LD R2, R3, 0
    ST R1, R2, 0             ; compile the xt
    ADD R2, 1
    ST R2, R3, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
find_execute:
    LDI execute_xt
    MOV PC, R0
    NOP
find_next:
    LD R7, R7, 0             ; follow the link field
    LDI find_loop
    MOV PC, R0
    NOP
find_next_wl:
    ADD R12, 1
    LDI find_wl
    MOV PC, R0
    NOP

skip_unknown:
    ; An error aborts any definition in progress, so the next line is
    ; interpreted rather than compiled into the broken word.
    LDI state_var
    MOV R3, R0
    LDI 0
    ST R0, R3, 0
    ; Drop the block cursor before SCR jumps to the next line
    LDI clear_cursor
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; The offending token's offset lives in >IN (R5), but the computation
    ; below reuses R5 for the column width. Park the token offset in R12
    ; (a scratch register on this path) so the bad word can be echoed.
    MOV R12, R5
    LDI 0x1000
    MOV R2, R0
    MOV R4, SCR
    SUB R4, R2
    LDI 80
    MOV R5, R0
    MOV R9, R4
    DIV R9, R5
    ADD R9, 1
    MUL R9, R5
    ADD R2, R9
    MOV SCR, R2
    LDI print_text
    MOV R2, R0
    LDI unknown_word_msg
    LINK
    JMP R2
    NOP
skip_unknown_after_prefix:
    MOV R3, TIB
    ADD R3, R12
    LDI print_buf
    MOV R10, R0
    LDI 0
    MOV R11, R0
print_bad_loop:
    LD R2, R3, 0
    LDI 0x00FF
    AND R2, R0
    LDI 0
    CMP R2, R0
    JZ print_bad_done
    NOP
    LDI ' '
    CMP R2, R0
    JZ print_bad_done
    NOP
    LDI 10
    CMP R2, R0
    JZ print_bad_done
    NOP
    LDI 13
    CMP R2, R0
    JZ print_bad_done
    NOP
    ST R2, R10, 0
    ADD R10, 1
    ADD R3, 1
    ADD R11, 1
    LDI print_bad_loop
    MOV PC, R0
    NOP
print_bad_done:
    LDI 0
    ST R0, R10, 0
    ; The message above returned to skip_unknown_after_prefix via the LINK
    ; return address; arm a fresh return point for the putstr call below.
    LDI err_continue
    MOV LR, R0
    LDI bios_putstr_direct
    MOV R2, R0
    LDI print_buf
    MOV R0, R0
    JMP R2
    NOP
err_continue:
    LDI recover_prompt
    MOV PC, R0
    NOP

; Every error ends up here: throw the rest of the line away and offer a fresh
; prompt.
recover_prompt:
    ; Discard the rest of the line: fresh line, prompt, next input.
    LDI newline_direct
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI print_prompt
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI word_accept
    MOV PC, R0
    NOP

stack_underflow_error:
    ; Drop the block cursor before SCR jumps to the next line
    LDI clear_cursor
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0x1000
    MOV R2, R0
    MOV R4, SCR
    SUB R4, R2
    LDI 80
    MOV R12, R0          ; width (R5 is >IN — leave it alone)
    MOV R9, R4
    DIV R9, R12
    ADD R9, 1
    MUL R9, R12
    ADD R2, R9
    MOV SCR, R2
    LDI print_text
    MOV R2, R0
    LDI stack_underflow_msg
    LINK
    JMP R2
    NOP
stack_underflow_after:
    LDI 0x1000
    MOV R2, R0
    MOV R4, SCR
    SUB R4, R2
    LDI 80
    MOV R12, R0          ; width (R5 is >IN — leave it alone)
    MOV R9, R4
    DIV R9, R12
    ADD R9, 1
    MUL R9, R12
    ADD R2, R9
    MOV SCR, R2
    LDI print_prompt
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI word_accept      ; recover: fresh prompt, then read the next line
    MOV PC, R0
    NOP
interpret_done:
    ; No repositioning and no scrolling here: the cursor stays where the line
    ; left it, and the CR+LF that ok_after sends through BIOS putch moves to the
    ; next row and scrolls the screen if that is the bottom one. The kernel used
    ; to roll its own scroll first and then let putch scroll again, which is two
    ; cursors' worth of bookkeeping for one newline.
ok_after:
    ; The REPL's routine output - " ok" and the "> " prompt - is part of the
    ; echo, so the echo flag silences it as well. Without this the flag only
    ; hides the typed characters and a file still types itself in by writing one
    ; " ok" and one prompt per line, which is 269 lines of scrolling for
    ; hanoi.fth: the source text gone and the noise it replaced still there.
    ;
    ; Errors are deliberately NOT part of this. An undefined word or a stack
    ; underflow still prints while the echo is off, so a load that goes wrong
    ; says so instead of failing silently - which is the one thing a quiet load
    ; must never do.
    LDI ECHO_FLAG
    LDS R7, ES, R0
    LDI 0
    CMP R7, R0
    JZ interpret_next
    NOP
    ; Print " ok"
    LDI 3               ; BIOS putstr
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 3
    LDI 1               ; DS offset 1
    MOV R7, R0
    LDI ok_msg
    STS R0, DS, R7      ; DS:[1] = ok_msg
    SWI
    ; Drop the cursor cell before the CR below walks away from it - same reason
    ; as in word_cr. Without this every line the REPL finishes keeps a reversed
    ; block at its end.
    LDI clear_cursor
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; Newline via BIOS: CR then LF
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 1               ; DS offset 1
    MOV R7, R0
    LDI 13              ; CR
    STS R0, DS, R7      ; DS:[1] = 13
    SWI
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0               ; DS offset 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 1               ; DS offset 1
    MOV R7, R0
    LDI 10              ; LF
    STS R0, DS, R7      ; DS:[1] = 10
    SWI
    ; Prompt
    LDI print_prompt
    MOV R2, R0
    LINK
    JMP R2
    NOP
interpret_next:
    ; Read next line into TIB via BIOS and then interpret. Reached with the echo
    ; on and off alike: the REPL still reads, it just says less about it.
    LDI word_accept
    MOV PC, R0
    NOP

; =============================================
; Data Section
; =============================================

.org 0x3000
sp0_base:
    .word 0
hello_msg:
    .text "Hello DeepForth!"

tib_kbd:
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0

unknown_word_msg:
    .text "undefined word: "
stack_underflow_msg:
    .text "stack underflow"
ok_msg:
    .text " ok"

; --------------------------------------------
; Wort-Header der eingebauten Wörter.
; Format: link | flags+len | name (NUL kommt von .text) | CFA
;   link     Adresse des Vorgänger-Headers, 0 = Ende der Kette
;   flags+len High-Byte Flags (Bit 15 = IMMEDIATE, ab P2), Low-Byte Namenslänge
; Die Kette läuft vom neuesten zum ältesten Wort; die Kopfzelle wird vom
; jeweiligen Wordlist-Kopf (forth_wl oder einem Vokabular) gehalten.
; --------------------------------------------
h_accept:
    .word h_key
    .word 6
    .text "accept"
    .word word_accept
h_key:
    .word h_cr
    .word 3
    .text "key"
    .word word_key
h_cr:
    .word h_drop
    .word 2
    .text "cr"
    .word word_cr
h_drop:
    .word h_swap
    .word 4
    .text "drop"
    .word word_drop
h_swap:
    .word h_emit
    .word 4
    .text "swap"
    .word word_swap
h_emit:
    .word h_dot
    .word 4
    .text "emit"
    .word word_emit
h_dot:
    .word h_dup
    .word 1
    .text "."
    .word word_dot
h_dup:
    .word h_mul
    .word 3
    .text "dup"
    .word word_dup
h_mul:
    .word h_plus
    .word 1
    .text "*"
    .word word_mul
h_plus:
    .word 0
    .word 1
    .text "+"
    .word word_plus

; --- P2 compiler words (chain is newest first, `current` holds its head) ---
h_immediate:
    .word h_state
    .word 0x8009          ; IMMEDIATE flag (0x8000) | length 9
    .text "immediate"
    .word word_immediate
h_state:
    .word h_bracket_end
    .word 5
    .text "state"
    .word word_state
h_bracket_end:
    .word h_bracket_begin
    .word 1
    .text "]"
    .word word_bracket_end
h_bracket_begin:
    .word h_semicolon
    .word 0x8001          ; IMMEDIATE | length 1
    .text "["
    .word word_bracket_begin
h_semicolon:
    .word h_colon
    .word 0x8001          ; IMMEDIATE | length 1
    .word 59              ; name ";" — written as a word because ';' in .text
    .word 0               ; starts a comment
    .word word_semicolon
h_colon:
    .word h_accept
    .word 1
    .text ":"
    .word word_colon

; --- P3 stack, arithmetic and comparison words (newest first) ---
h_depth:
    .word h_0gt
    .word 5
    .text "depth"
    .word word_depth
h_0gt:
    .word h_0lt
    .word 2
    .text "0>"
    .word word_0gt
h_0lt:
    .word h_0eq
    .word 2
    .text "0<"
    .word word_0lt
h_0eq:
    .word h_gt
    .word 2
    .text "0="
    .word word_0eq
h_gt:
    .word h_lt
    .word 1
    .text ">"
    .word word_gt
h_lt:
    .word h_ne
    .word 1
    .text "<"
    .word word_lt
h_ne:
    .word h_eq
    .word 2
    .text "<>"
    .word word_ne
h_eq:
    .word h_2star
    .word 1
    .text "="
    .word word_eq
h_2star:
    .word h_1minus
    .word 2
    .text "2*"
    .word word_2star
h_1minus:
    .word h_1plus
    .word 2
    .text "1-"
    .word word_1minus
h_1plus:
    .word h_2drop
    .word 2
    .text "1+"
    .word word_1plus
h_2drop:
    .word h_2dup
    .word 5
    .text "2drop"
    .word word_2drop
h_2dup:
    .word h_nip
    .word 4
    .text "2dup"
    .word word_2dup
h_nip:
    .word h_rot
    .word 3
    .text "nip"
    .word word_nip
h_rot:
    .word h_over
    .word 3
    .text "rot"
    .word word_rot
h_over:
    .word h_slash_mod
    .word 4
    .text "over"
    .word word_over
h_slash_mod:
    .word h_mod
    .word 4
    .text "/mod"
    .word word_slash_mod
h_mod:
    .word h_div
    .word 3
    .text "mod"
    .word word_mod
h_div:
    .word h_negate
    .word 1
    .text "/"
    .word word_div
h_negate:
    .word h_minus
    .word 6
    .text "negate"
    .word word_negate
h_minus:
    .word h_immediate
    .word 1
    .text "-"
    .word word_minus

; --- additional arithmetic: u. 2/ abs min max, and the two echo words ---
; These are the newest entries in the whole dictionary, so the oldest of them
; links into the vocabulary chain below and forth_wl names the newest.
;
; scr@ and scr! are newer still, and sit above them for the same reason.
h_cls:
    .word h_bl
    .word 3
    .text "cls"
    .word word_cls

; --- Tier 1: the standard words the kernel was missing (newest first) ---
; These sit between h_cls and h_see rather than at the head of the chain, which
; keeps forth_wl naming h_cls: the chain test in tests/forth.test.js pins that,
; and find walks the whole chain anyway, so a word is reachable from anywhere.
;
; BL, TRUE and FALSE are ordinary CONSTANTs: the CFA cell names doconst and the
; value lives in the cell behind it, so SEE prints them as constants instead of
; as code. FALSE takes no value cell - see below.
h_bl:
    .word h_true
    .word 2
    .text "bl"
    .word doconst
    .word 32
h_true:
    .word h_false
    .word 4
    .text "true"
    .word doconst
    .word 0xFFFF
h_false:
    .word h_space
    .word 5
    .text "false"
    .word doconst
    .word 0
h_space:
    .word h_spaces
    .word 5
    .text "space"
    .word word_space
h_spaces:
    .word h_qdup
    .word 6
    .text "spaces"
    .word word_spaces
h_qdup:
    .word h_tuck
    .word 4
    .text "?dup"
    .word word_qdup
h_tuck:
    .word h_minusrot
    .word 4
    .text "tuck"
    .word word_tuck
h_minusrot:
    .word h_2over
    .word 4
    .text "-rot"
    .word word_minusrot
h_2over:
    .word h_2swap
    .word 5
    .text "2over"
    .word word_2over
h_2swap:
    .word h_ult
    .word 5
    .text "2swap"
    .word word_2swap
h_ult:
    .word h_ugt
    .word 2
    .text "u<"
    .word word_ult
h_ugt:
    .word h_znoteq
    .word 2
    .text "u>"
    .word word_ugt
h_znoteq:
    .word h_within
    .word 3
    .text "0<>"
    .word word_znoteq
h_within:
    .word h_2fetch
    .word 6
    .text "within"
    .word word_within
h_2fetch:
    .word h_2store
    .word 2
    .text "2@"
    .word word_2fetch
h_2store:
    .word h_count
    .word 2
    .text "2!"
    .word word_2store
h_count:
    .word h_ccomma
    .word 5
    .text "count"
    .word word_count
h_ccomma:
    .word h_move
    .word 2
    .text "c,"
    .word word_ccomma
h_move:
    .word h_fill
    .word 4
    .text "move"
    .word word_move
h_fill:
    .word h_erase
    .word 4
    .text "fill"
    .word word_fill
h_erase:
    .word h_type
    .word 5
    .text "erase"
    .word word_erase
h_type:
    .word h_tick
    .word 4
    .text "type"
    .word word_type

; --- Tier 1, second batch: the parsing and execution words (newest first) ---
; `'` and `char` parse the next token at RUN time, which is where the standard
; puts them; `[']`, `[char]` and `literal` do their work while a definition is
; being translated and are therefore IMMEDIATE. The dictionary keeps the words
; newest-first, so these sit between h_type and h_see and h_type points at the
; newest of them.
h_tick:
    .word h_char
    .word 1
    .word 39              ; name "'" — a word, so the quote stays out of .text
    .word 0
    .word word_tick
h_char:
    .word h_execute
    .word 4
    .text "char"
    .word word_char
h_execute:
    .word h_bracket_tick
    .word 7
    .text "execute"
    .word word_execute
h_bracket_tick:
    .word h_bracket_char
    .word 0x8003          ; IMMEDIATE | length 3
    .word 91              ; "[']" — brackets and a quote: written as words
    .word 39
    .word 93
    .word 0
    .word word_bracket_tick
h_bracket_char:
    .word h_literal
    .word 0x8006          ; IMMEDIATE | length 6
    .text "[char]"
    .word word_bracket_char
h_literal:
    .word h_tor
    .word 0x8007          ; IMMEDIATE | length 7
    .text "literal"
    .word word_literal
; The return-stack words and `+loop`, the third Tier 1 batch, chained in here
; for the same reason as the two batches above: the newest headers sit just
; before h_see, so h_cls stays the head of the chain and every older link keeps
; its old target. `+loop` is IMMEDIATE like `loop` — it acts while the
; definition is being translated and leaves xt_plusloop behind — and the other
; five are ordinary words.
h_tor:
    .word h_rfrom
    .word 2
    .text ">r"
    .word word_tor
h_rfrom:
    .word h_rfetch
    .word 2
    .text "r>"
    .word word_rfrom
h_rfetch:
    .word h_plusloop
    .word 2
    .text "r@"
    .word word_rfetch
h_plusloop:
    .word h_j
    .word 0x8005          ; IMMEDIATE | length 5
    .text "+loop"
    .word word_plusloop
h_j:
    .word h_unloop
    .word 1
    .text "j"
    .word word_j
h_unloop:
    .word h_base
    .word 6
    .text "unloop"
    .word word_unloop
; The fourth Tier 1 batch: the number base. `base` is a real VARIABLE, not a
; constant like `state`: it carries the cell the scanner and the printer read,
; so `16 base !` works the way the standard says. Its data cell sits directly
; behind the CFA, which is where dovar finds it.
h_base:
    .word h_hex
    .word 4
    .text "base"
    .word dovar
base_var:
    .word 10              ; decimal until something says otherwise
h_hex:
    .word h_decimal
    .word 3
    .text "hex"
    .word word_hex
h_decimal:
    .word h_pick
    .word 7
    .text "decimal"
    .word word_decimal
; The fifth batch, chained in at the same place for the same reason. `s"` has no
; header at all: it is a tokenizer word like `."` and the comments, so there is
; nothing to find in the dictionary and nothing for `forget` to remove.
h_pick:
    .word h_roll
    .word 4
    .text "pick"
    .word word_pick
h_roll:
    .word h_see
    .word 4
    .text "roll"
    .word word_roll

; SEE is a dictionary word, so it needs a header like any other. It sits between
; h_cls and h_do rather than at the head of the chain, which keeps forth_wl
; naming h_cls: the chain test in tests/forth.test.js pins that, and find walks
; the whole chain anyway, so a word is reachable from any position.
h_see:
    .word h_do
    .word 3
    .text "see"
    .word word_see
; The loop words, inserted after h_cls for the same reason as the bit words
; below: the headers are newest-first and forth_wl names the newest, so new
; ones go at the head of the chain and the tail keeps its old links. `do`,
; `loop` and `leave` are IMMEDIATE because they act while the definition is
; being translated; what they leave behind are the runtime halves whose xts
; are xt_do, xt_loop and xt_leave below.
h_do:
    .word h_qdo
    .word 0x8002          ; IMMEDIATE | length 2
    .text "do"
    .word word_do
h_qdo:
    .word h_loop
    .word 0x8003          ; IMMEDIATE | length 3
    .text "?do"
    .word word_qdo
h_loop:
    .word h_leave
    .word 0x8004          ; IMMEDIATE
    .text "loop"
    .word word_loop
h_leave:
    .word h_i
    .word 0x8005          ; IMMEDIATE
    .text "leave"
    .word word_leave
h_i:
    .word h_and
    .word 1
    .text "i"
    .word word_i
; Bit operations, inserted after h_cls so the tail of the chain keeps its
; original links: h_scr_fetch is what h_cls used to point at, and h_invert now
; points there instead. The chain must still reach every header.
h_and:
    .word h_or
    .word 3
    .text "and"
    .word word_and
h_or:
    .word h_xor
    .word 2
    .text "or"
    .word word_or
h_xor:
    .word h_lshift
    .word 3
    .text "xor"
    .word word_xor
h_lshift:
    .word h_rshift
    .word 6
    .text "lshift"
    .word word_lshift
h_rshift:
    .word h_invert
    .word 6
    .text "rshift"
    .word word_rshift
h_invert:
    .word h_scr_fetch
    .word 6
    .text "invert"
    .word word_invert
h_scr_fetch:
    .word h_scr_store
    .word 4
    .text "scr@"
    .word word_scr_fetch
h_scr_store:
    .word h_echo_query
    .word 4
    .text "scr!"
    .word word_scr_store
h_echo_query:
    .word h_echo
    .word 5
    .text "echo?"
    .word word_echo_query
h_echo:
    .word h_udot
    .word 4
    .text "echo"
    .word word_echo
h_udot:
    .word h_max
    .word 2
    .text "u."
    .word word_udot
h_max:
    .word h_min
    .word 3
    .text "max"
    .word word_max
h_min:
    .word h_abs
    .word 3
    .text "min"
    .word word_min
h_abs:
    .word h_twoshift
    .word 3
    .text "abs"
    .word word_abs
h_twoshift:
    .word h_forget
    .word 2
    .text "2/"
    .word word_two_slash

; --- P3 control-flow words (immediate where they act at compile time) ---
h_recurse:
    .word h_exit
    .word 0x8007          ; IMMEDIATE | length 7
    .text "recurse"
    .word word_recurse
h_exit:
    .word h_repeat
    .word 4
    .text "exit"
    .word exit
h_repeat:
    .word h_while
    .word 0x8006          ; IMMEDIATE
    .text "repeat"
    .word word_repeat
h_while:
    .word h_again
    .word 0x8005          ; IMMEDIATE
    .text "while"
    .word word_while
h_again:
    .word h_until
    .word 0x8005          ; IMMEDIATE
    .text "again"
    .word word_again
h_until:
    .word h_begin
    .word 0x8005          ; IMMEDIATE
    .text "until"
    .word word_until
h_begin:
    .word h_else
    .word 0x8005          ; IMMEDIATE
    .text "begin"
    .word word_begin
h_else:
    .word h_then
    .word 0x8004          ; IMMEDIATE
    .text "else"
    .word word_else
h_then:
    .word h_if
    .word 0x8004          ; IMMEDIATE
    .text "then"
    .word word_then
h_if:
    .word h_depth
    .word 0x8002          ; IMMEDIATE
    .text "if"
    .word word_if

; --- vocabularies (newest first) ---
h_forget:
    .word h_words
    .word 6
    .text "forget"
    .word word_forget
h_words:
    .word h_vocabulary
    .word 5
    .text "words"
    .word word_words
h_vocabulary:
    .word h_definitions
    .word 10
    .text "vocabulary"
    .word word_vocabulary
h_definitions:
    .word h_also
    .word 11
    .text "definitions"
    .word word_definitions
h_also:
    .word h_only
    .word 4
    .text "also"
    .word word_also
h_only:
    .word h_previous
    .word 4
    .text "only"
    .word word_only
h_previous:
    .word h_forth
    .word 8
    .text "previous"
    .word word_previous
h_forth:
    .word h_to
    .word 5
    .text "forth"
    .word word_forth

; --- P3 memory words and the simple defining words (newest first) ---
h_to:
    .word h_value
    .word 0x8002          ; IMMEDIATE | length 2
    .text "to"
    .word word_to
h_value:
    .word h_create
    .word 5
    .text "value"
    .word word_value
h_create:
    .word h_does
    .word 6
    .text "create"
    .word word_create
h_does:
    .word h_variable
    .word 5
    .text "does>"
    .word word_does
h_variable:
    .word h_constant
    .word 8
    .text "variable"
    .word word_variable
h_constant:
    .word h_cellplus
    .word 8
    .text "constant"
    .word word_constant
h_cellplus:
    .word h_cells
    .word 5
    .text "cell+"
    .word word_cellplus
h_cells:
    .word h_comma
    .word 5
    .text "cells"
    .word word_cells
h_comma:
    .word h_allot
    .word 1
    .word 44, 0           ; "," + NUL (a bare comma is assembler syntax)
    .word word_comma
h_allot:
    .word h_here
    .word 5
    .text "allot"
    .word word_allot
h_here:
    .word h_plusstore
    .word 4
    .text "here"
    .word word_here
h_plusstore:
    .word h_cstore
    .word 2
    .text "+!"
    .word word_plusstore
h_cstore:
    .word h_cfetch
    .word 2
    .text "c!"
    .word word_cstore
h_cfetch:
    .word h_store
    .word 2
    .text "c@"
    .word word_cfetch
h_store:
    .word h_fetch
    .word 1
    .text "!"
h_store_cfa:               ; xt cell of `!`, compiled by TO
    .word word_store
h_fetch:
    .word h_recurse
    .word 1
    .text "@"
    .word word_fetch

; --- wordlists: a vocabulary is identified by the address of its head cell,
; --- which chains its definitions newest-first and ends in 0.
forth_wl:
    .word h_cls               ; newest built-in header in the FORTH vocabulary
search_order:            ; wordlists searched by FIND, first one first, 0-ended
    .word forth_wl
    .word 0, 0, 0, 0, 0, 0, 0
current:
    .word forth_wl       ; wordlist new definitions are added to
found_wl:
    .word 0              ; head cell of the wordlist FIND matched last

; BIOS runs in the shadow bank and uses R5 for its own purposes, so a
; primitive that calls SWI must park >IN here and reload it afterwards.
saved_in:
    .word 0

; --- P2 threading state ---
state_var:
    .word 0              ; 0 = interpret, 1 = compile
dp_var:
    .word dict_free      ; next free dictionary cell (grows upwards)
ip_ptr:
    .word resume_list    ; indirect-threaded instruction pointer
rp_ptr:
    .word RSTACK_TOP     ; Forth return stack pointer (grows down)
xt_resume:
    .word outer_resume   ; code of the "back to outer interpreter" word
resume_list:
    .word xt_resume      ; synthetic one-cell thread for execute_xt
xt_lit:
    .word lit
xt_exit:
    .word exit
xt_branch:
    .word branch
xt_0branch:
    .word zbranch
xt_litstr:
    .word word_litstr
xt_sqstr:
    .word word_sqstr
xt_do:
    .word word_do_rt
xt_qdo:
    .word word_qdo_rt
xt_loop:
    .word word_loop_rt
xt_plusloop:
    .word word_plusloop_rt
xt_leave:
    .word word_leave_rt
current_xt:
    .word 0              ; xt of the definition being compiled (for recurse)
created_xt:
    .word 0              ; xt of the newest CREATE'd word (for DOES>)
loop_depth:
    .word 0              ; DO/LOOP pairs open while compiling
pn_lr:
    .word 0              ; print_number's return address across its putch call
pt_lr:
    .word 0              ; print_text's return address across its putch call

; --- SEE: decompiler state and its fixed strings ---
; see_cfa/see_hdr are the word under inspection, see_ptr walks its thread and
; see_xt carries an xt into the reverse lookup. The five ..._lr cells hold a
; return address across the helpers' nested LINKs: LINK overwrites LR, so a
; routine that calls another keeps its own slot instead of sharing one.
see_cfa:
    .word 0              ; the target word's CFA (xt) cell
see_hdr:
    .word 0              ; the target word's header
see_ptr:
    .word 0              ; cell of the thread being decompiled
see_xt:
    .word 0              ; the xt being resolved back to a name
see_miss:
    .word 0              ; set by the reverse lookup when no word matched
see_lrb:
    .word 0              ; see_body's return address
see_lrf:
    .word 0              ; see_find_name's return address
see_lrh:
    .word 0              ; see_head's return address
see_lrn:
    .word 0              ; see_print_name's return address
see_lrp:
    .word 0              ; see_puts's return address
see_lrs:
    .word 0              ; see_num's return address
see_str_colon:
    .text ": "
see_str_code:
    .text "code "
see_str_variable:
    .text "variable "
see_str_constant:
    .text "constant "
see_str_create:
    .text "create "
see_str_does:
    .text "does> "
see_str_vocab:
    .text "vocabulary "
see_str_dotq:
    ; No space after the quote: the compiler stores the characters starting at
    ; the one after `."`, so a source `." x"` keeps a leading space in the
    ; thread. Printing `."` + those characters gives the source back exactly.
    .text ".\""
see_str_sq:
    ; With the space, because `s"` is the other way round: it swallows the one
    ; blank that delimits the text, so the stored characters are the string
    ; itself and the blank has to come back for the source to mean the same
    ; thing when it is read again.
    .text "s\" "
see_str_do:
    .text "do "
see_str_qdo:
    .text "?do "
see_str_loop:
    .text "loop "
see_str_plusloop:
    .text "(+loop) "
see_str_leave:
    .text "leave "
see_str_branch:
    .text "(branch) "
see_str_0branch:
    .text "(0branch) "
; The return stack's base, the way sp0_base is the data stack's. It has to be a
; cell rather than an immediate because `LDI` reads its fifteen bits as signed:
; 0x6F00 has bit 14 set, so loading it would sign-extend to 0xEF00 and any
; comparison against it would answer the opposite of the truth.
rp0_base:
    .word RSTACK_TOP
dict_free:               ; colon definitions are built upwards from here

.code
; The second block of kernel code. It used to start at 0x0400, which left only
; ten words of headroom after the 0x0100 section — and a routine that grew the
; interpreter by twenty words silently overran it: .org rewinds the address
; counter, so everything past the boundary was overwritten by the code emitted
; below (the REPL hung, with no assembler error). The block that caused it (the
; serial line loader) is gone, and with it the pressure — but 0x0500 keeps real
; headroom rather than the seven words that are left at 0x0400 today. The data
; section sits at 0x3000, the threading engine at 0x2000.
.org 0x0500
word_plus:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wp_ok
    NOP
    JN wp_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wp_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    ADD R1, R2
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
word_mul:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wm_ok
    NOP
    JN wm_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wm_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    MUL R1, R2
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
word_dup:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wd_under
    NOP
    LD R1, SP, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
wd_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP
; litstr is the runtime half of `."` and of a bare `"`. The characters were
; copied into the definition when it was compiled, so what arrives here is
; only their address, and this prints up to the NUL that terminates them.
; There is no escaping to undo at this point: `." say \"hi\""` was unescaped
; while compiling, so the copy in the definition is already `say "hi"`.
;
; ( addr -- )
word_litstr:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ lstr_under
    NOP
    LD R3, SP, 0             ; the address
    ADD SP, 1
lstr_loop:
    LD R2, R3, 0
    LDI 0
    CMP R2, R0
    JZ lstr_done
    NOP
    LDI put_char
    MOV R4, R0
    MOV R0, R2
    LINK
    JMP R4
    NOP
    ADD R3, 1
    LDI lstr_loop
    MOV PC, R0
    NOP
lstr_done:
    ; The thread still sits on the first character, so the string has to be
    ; stepped over the way `lit` steps over its inline cell: IP moves to the
    ; cell after the NUL, which is where the next word of the definition is.
    ; Without this, `next` reads 'h' as an xt and the core jumps into ASCII.
    ; ip_ptr IS the IP cell — its own address is where `next` keeps it.
    LDI ip_ptr
    MOV R2, R0
    MOV R4, R3               ; R3 = the address of the NUL
    ADD R4, 1
    ST R4, R2, 0             ; IP = one past the NUL
    LDI next
    MOV PC, R0
    NOP
lstr_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; . prints the signed value, u. the raw cell. Both share print_number, which
; prints R2 as an unsigned magnitude followed by a trailing space; the leading
; space belongs to the caller.
word_dot:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ dot_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    MOV R2, R1          ; value
    LDI put_char        ; leading space, through the normal output path
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    LDI 0
    CMP R2, R0          ; signed test against zero
    JN dot_signed
    NOP
    LDI print_number
    MOV R3, R0          ; R3 carries the target so R2 keeps the value
    LINK
    JMP R3
    NOP
    LDI dot_next        ; JMP LR returns here, not into the signed path
    MOV PC, R0
    NOP
dot_signed:
    LDI put_char
    MOV R4, R0
    LDI '-'
    LINK
    JMP R4
    NOP
    NEG R2              ; magnitude; -32768 negates to itself and prints as 32768
    LDI print_number
    MOV R3, R0
    LINK
    JMP R3
    NOP
dot_next:
    LDI next
    MOV PC, R0
    NOP
dot_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; u. displays the cell as it stands, without looking at bit 15.
word_udot:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ udot_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    MOV R2, R1
    LDI put_char        ; leading space, through the normal output path
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    LDI print_number
    MOV R3, R0
    LINK
    JMP R3
    NOP
    LDI next            ; return lands here, not into the error path
    MOV PC, R0
    NOP
udot_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; print_number prints R2 as an unsigned magnitude in the current base, followed
; by a trailing space, through putch, and returns to the caller. LR is saved
; because put_char is a subroutine (LINK overwrites LR).
print_number:
    LDI pn_lr
    MOV R3, R0
    ST LR, R3, 0
    LDI 0
    CMP R2, R0
    JNZ pn_digits
    NOP
    LDI put_char
    MOV R4, R0
    LDI '0'
    LINK
    JMP R4
    NOP
    LDI pn_done
    MOV PC, R0
    NOP
pn_digits:
    LDI print_buf
    MOV R10, R0         ; buffer pointer
    LDI 0
    MOV R3, R0          ; digit count
    LDI base_var
    MOV R12, R0
    LD R12, R12, 0      ; the base to print in
    ; print_number prints an *unsigned* magnitude, but the ISA DIV is signed,
    ; so a magnitude above 0x7FFF would divide wrong. The 32-bit form with the
    ; high half zero gives the unsigned answer instead: the dividend pair is
    ; 0:magnitude, the divisor is the base, and the quotient/remainder pair is
    ; value/base and value mod base. That works for every base; the reciprocal
    ; that used to stand here (floor(u/10) = (u * 0xCCCD) >> 19) was decimal
    ; only, and this kernel prints in the base the program asked for.
pn_div_loop:
    LDI 0
    MOV R1, R2          ; the 32-bit dividend R0:R1 = 0:magnitude
    DIV32 R0, R12       ; R0 = quotient, R1 = remainder
    MOV R4, R1          ; this digit's value
    MOV R9, R0          ; the quotient, kept across the digit's own arithmetic
    LDI 10
    CMP R4, R0
    JN pn_digit_dec
    NOP
    LDI 55              ; 'A' is 65, so the value 10 becomes 'A'
    ADD R4, R0
    LDI pn_digit_store
    MOV PC, R0
    NOP
pn_digit_dec:
    LDI '0'
    ADD R4, R0
pn_digit_store:
    ST R4, R10, 0
    ADD R10, 1
    MOV R2, R9          ; the next magnitude is value / base
    ADD R3, 1           ; count++
    LDI 0
    CMP R2, R0
    JZ pn_print_setup   ; nothing left to divide
    NOP
    ; Sixteen digits is the worst case for any base from two upwards, and the
    ; buffer holds more than that. A base below two (undefined, but a cell is a
    ; cell) would divide by zero or by one and never run out, so the count ends
    ; the loop instead of the value: a bounded answer beats a write that walks
    ; out of the buffer.
    LDI 16
    CMP R3, R0
    JZ pn_print_setup
    NOP
    LDI pn_div_loop
    MOV PC, R0
    NOP
pn_print_setup:
    MOV R2, R10         ; buffer pointer in a shadow register: put_char keeps R2
pn_print_loop:
    LDI 0
    CMP R3, R0
    JZ pn_done
    NOP
    SUB R3, 1
    SUB R2, 1
    LD R1, R2, 0        ; the digit
    LDI put_char
    MOV R4, R0
    MOV R0, R1
    LINK
    JMP R4
    NOP
    LDI pn_print_loop
    MOV PC, R0
    NOP
pn_done:
    LDI put_char
    MOV R4, R0
    LDI ' '             ; the trailing space
    LINK
    JMP R4
    NOP
    LDI pn_lr
    MOV R3, R0
    LD LR, R3, 0
    JMP LR
    NOP
word_emit:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ we_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    LDI 0x00FF
    AND R1, R0
    ; Every character goes to the BIOS, 10 and 13 included. Carriage return,
    ; line feed and the scroll at the bottom row belong to putch; the kernel
    ; used to keep its own copies of all three (emit_do_cr, emit_do_lf and a
    ; scroll loop), which meant three places that had to agree about where the
    ; cursor was. Two of them clamped at the last row instead of scrolling, so
    ; a long run of output stopped dead at the bottom of the screen.
    ; Park >IN (R5) across the BIOS call: the shadow-bank BIOS clobbers R5.
    LDI saved_in
    MOV R2, R0
    ST >IN, R2, 0
    LDI 2               ; value = 2
    MOV R3, R0
    LDI 0               ; offset = 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 1               ; offset = 1
    MOV R7, R0
    STS R1, DS, R7      ; DS:[1] = char (R1 still holds the masked char)
    SWI
    LD >IN, R2, 0       ; N.B.: R2 is shadowed, so it survives the SWI
    LDI next
    MOV PC, R0
    NOP
we_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_swap:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ ws_ok
    NOP
    JN ws_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
ws_ok:
    LD R1, SP, 0
    LD R2, SP, 1
    ST R1, SP, 1
    ST R2, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_drop:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wd2_under
    NOP
    ADD SP, 1
    LDI next
    MOV PC, R0
    NOP
wd2_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

print_buf:
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0
    .word 0

; The buffer interpreted `s"` copies into: one cell per character of the longest
; input line the reader accepts, plus the NUL. A second `s"` overwrites it,
; which is all the standard's transient buffer promises.
sq_buf:
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0
word_key:
    ; BIOS getch -> char in R0
    ; Park >IN (R5) across the BIOS call: the shadow-bank BIOS clobbers R5.
    LDI saved_in
    MOV R2, R0
    ST >IN, R2, 0
    LDI 4               ; value = 4
    MOV R4, R0
    LDI 0               ; offset = 0
    MOV R7, R0
    STS R4, DS, R7      ; DS:[0] = 4
    SWI
    LDI 1               ; offset = 1
    MOV R7, R0
    LDS R0, DS, R7      ; R0 = DS:[1]
    LD >IN, R2, 0       ; R2 is shadowed, so it survives the SWI
    SUB SP, 1
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_accept:
    ; Use BIOS getstr to read a line into TIB. Whether that getstr echoes the
    ; characters on the way in is the echo_flag cell, not a fixed property: see
    ; word_echo below.
    LDI tib_kbd
    MOV TIB, R0
    LDI 5               ; value = 5
    MOV R4, R0
    LDI 0               ; offset = 0
    MOV R7, R0
    STS R4, DS, R7      ; DS:[0] = 5
    LDI 1               ; offset = 1
    MOV R7, R0
    STS TIB, DS, R7     ; DS:[1] = TIB
    SWI
    ; reset input index
    LDI 0
    MOV >IN, R0
    LDI interpret_loop
    MOV PC, R0
    NOP

; echo ( flag -- ) - set whether typed input is drawn on the screen.
;
; FIG Forth-83 has an ECHO word for exactly this, and that is where the name
; comes from. It is not a toggle here. A toggle is fine for a person at a
; terminal, who can see whether echo is currently on; the Screen tab has to
; put it into a *known* state - an upload silences the echo, loads, and
; switches it back on - and it cannot afford to guess which way round a toggle
; would leave it. So echo takes a flag, and echo? reads it back.
;
; Only the keyboard echo is affected. What the program prints still goes to
; the screen: " ok" after every line, and everything emit puts out, are drawn
; whether this flag is 0 or not. That is the useful half of it - a source file
; is mostly its own text, and the screen is 25 rows of it that nobody reads
; twice.
;
; R7 is the scratch here, never R13: .equ SP R13, so R13 is the data stack
; pointer and this word is reading a value off that very stack.
word_echo:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1              ; SP == sp0_base means the stack is empty
    JZ echo_under
    NOP
    LD R2, SP, 0           ; the flag the caller wants
    ADD SP, 1
    LDI ECHO_FLAG          ; ES is still 0xF000 from forth_start
    MOV R7, R0
    STS R2, ES, R7         ; store it; ! keeps the value, so this drops it
    LDI next
    MOV PC, R0
    NOP
echo_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; echo? ( -- flag ) - non-zero while typed input is drawn on the screen.
word_echo_query:
    LDI ECHO_FLAG          ; ES is still 0xF000 from forth_start
    MOV R2, R0
    LDS R1, ES, R2
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_cr:
    ; CR LF, both through the BIOS, which owns carriage return, line feed and the
    ; scroll at the bottom row. This used to compute the row and the column here
    ; and clamp at row 24 instead of scrolling, so `cr` at the bottom of the
    ; screen left the cursor sitting on the same line forever.
    ;
    ; clear_cursor first: putch leaves the cursor attribute on the cell after the
    ; last character, and CR walks away from it without cleaning up, so every
    ; finished line used to keep a reversed block at its end. ok_after does the
    ; same thing before its own CR.
    LDI clear_cursor
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; >IN (R5) is parked across the call: the shadow-bank BIOS clobbers R5.
    LDI saved_in
    MOV R2, R0
    ST >IN, R2, 0
    LDI 2               ; BIOS putch
    MOV R3, R0
    LDI 0
    MOV R7, R0
    STS R3, DS, R7      ; DS:[0] = 2
    LDI 13              ; CR
    MOV R1, R0
    LDI 1
    MOV R7, R0
    STS R1, DS, R7      ; DS:[1] = 13
    SWI
    LDI 10              ; LF
    MOV R1, R0
    LDI 1
    MOV R7, R0
    STS R1, DS, R7      ; DS:[1] = 10
    SWI
    LD >IN, R2, 0
    LDI next
    MOV PC, R0
    NOP

; =============================================
; P3: stack, arithmetic and comparison primitives
; =============================================
; Every primitive ends in NEXT so it can be compiled into a colon
; definition as well as run from the outer interpreter.
; ---------------------------------------------
word_minus:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wminus_ok
    NOP
    JN wminus_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wminus_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    SUB R1, R2
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_negate:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wnegate_under
    NOP
    LD R1, SP, 0
    NEG R1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
wnegate_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_div:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdiv_ok
    NOP
    JN wdiv_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdiv_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    DIV R1, R2
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_mod:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wmod_ok
    NOP
    JN wmod_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wmod_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    MOV R9, R1
    DIV R9, R2
    MUL R9, R2
    SUB R1, R9
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_slash_mod:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wslashmod_ok
    NOP
    JN wslashmod_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wslashmod_ok:
    LD R2, SP, 0          ; b
    ADD SP, 1
    LD R1, SP, 0          ; a
    MOV R9, R1
    DIV R9, R2            ; quotient
    MOV R7, R9
    MUL R7, R2
    SUB R1, R7            ; remainder = a - quotient*b
    ST R1, SP, 0          ; a's slot becomes the remainder
    SUB SP, 1
    ST R9, SP, 0          ; push the quotient on top
    LDI next
    MOV PC, R0
    NOP

; 2/ is an arithmetic right shift, so it floors as the Forth standard asks:
; -3 2/ is -2, not -1.
word_two_slash:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wtwoshift_under
    NOP
    LD R1, SP, 0
    SRA R1, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
wtwoshift_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_abs:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wabs_under
    NOP
    LD R1, SP, 0
    LDI 0
    CMP R1, R0             ; is n < 0 ?
    JN wabs_neg
    NOP
    LDI next               ; n >= 0 is already its own magnitude
    MOV PC, R0
    NOP
wabs_neg:
    NEG R1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
wabs_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; Bit operations. and/or/xor/invert are one machine instruction each, on the
; shape word_mul uses: b is read from SP, SP is stepped up once, and that same
; instruction reads a - so the slot a occupied becomes the result slot and SP
; ends one above where it started, which is exactly one item for one.
;
; The shifts are not one instruction. SL and SR take their count as a 4-bit
; IMMEDIATE (Table 6) with no register form, so a runtime count has to be
; stepped one bit at a time, reloading the value from the stack each round
; because there is nowhere to keep it that survives the shift.
;
; A count of 16 or more shifts every bit out, so it short-circuits to 0 rather
; than looping. The standard leaves the count type-defined and does not
; require a 16-bit shift to be in range; returning the total keeps the word
; useful instead of turning a large count into a hang.
;
; SR is the logical shift, filling from bit 15 with zeros. Note the ISA has no
; separate arithmetic shift - there is no way to ask for sign fill.

word_and:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wand_ok
    NOP
    JN wand_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wand_ok:
    LD R2, SP, 0            ; b, on top
    ADD SP, 1
    LD R1, SP, 0            ; a, whose slot becomes the result slot
    AND R1, R2
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_or:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wor_ok
    NOP
    JN wor_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wor_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    OR R1, R2
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_xor:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wxor_ok
    NOP
    JN wxor_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wxor_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    XOR R1, R2
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

; invert works in place: one item in, one item out, so SP does not move.
word_invert:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ winv_under
    NOP
    LD R1, SP, 0
    INV R1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
winv_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; n is on top and x below it. Stepping SP up once leaves R1 holding n and
; makes SP point at x's slot, so x is already where the result belongs and
; the loop only has to shift it in place.
word_lshift:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wls_ok
    NOP
    JN wls_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wls_ok:
    LD R1, SP, 0            ; n, the count, on top
    ADD SP, 1
    LD R2, SP, 0            ; x, already in the slot the result belongs in
    LDI 16
    CMP R1, R0              ; n - 16
    JN wls_loop             ; fewer than 16: step it
    NOP
    LDI 0                   ; 16 or more: every bit is shifted out
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP
wls_loop:
    LDI 0
    CMP R1, R0              ; count down to zero
    JZ wls_done
    NOP
    LD R2, SP, 0            ; reload: R2 is both value and shift source
    SL R2, 1
    ST R2, SP, 0
    SUB R1, 1
    LDI wls_loop
    MOV PC, R0
    NOP
wls_done:
    LDI next
    MOV PC, R0
    NOP

word_rshift:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wrs_ok
    NOP
    JN wrs_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wrs_ok:
    LD R1, SP, 0            ; n, the count, on top
    ADD SP, 1
    LD R2, SP, 0            ; x, already in the slot the result belongs in
    LDI 16
    CMP R1, R0
    JN wrs_loop
    NOP
    LDI 0
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP
wrs_loop:
    LDI 0
    CMP R1, R0
    JZ wrs_done
    NOP
    LD R2, SP, 0
    SR R2, 1
    ST R2, SP, 0
    SUB R1, 1
    LDI wrs_loop
    MOV PC, R0
    NOP
wrs_done:
    LDI next
    MOV PC, R0
    NOP

; min and max keep one of the two operands: b is popped first, so the result
; slot is always a's slot.
;
; Which one to keep is a signed comparison, and the machine cannot answer one
; from a single flag: `CMP a, b` sets N from the sign of a - b and V when that
; subtraction overflowed, and a < b exactly when N and V differ. Reading N
; alone - what `JN` does - is only right while a - b fits in a cell, and that is
; how `0x8000 1 min` came to answer 1: -32768 - 1 overflows to +32767, so the
; smaller operand looked like the larger one. `<`, `>`, `max` and `+loop` need
; the same two-flag test; it is written out at each of them rather than shared,
; because what gets compared sits in different registers in each word.
word_min:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wmin_ok
    NOP
    JN wmin_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wmin_ok:
    LD R2, SP, 0          ; b
    ADD SP, 1
    LD R1, SP, 0          ; a, and the slot the result stays in
    CMP R1, R2            ; a - b
    JO wmin_ovf
    NOP
    JN wmin_done          ; no overflow, a - b < 0: a is the smaller one
    NOP
wmin_take_b:              ; a >= b
    ST R2, SP, 0
wmin_done:
    LDI next
    MOV PC, R0
    NOP
wmin_ovf:
    JN wmin_take_b        ; overflow inverted the sign, so a negative a - b
    NOP                   ;   means a > b and b is the smaller one
    LDI next
    MOV PC, R0
    NOP

word_max:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wmax_ok
    NOP
    JN wmax_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wmax_ok:
    LD R2, SP, 0          ; b
    ADD SP, 1
    LD R1, SP, 0          ; a, and the slot the result stays in
    CMP R2, R1            ; b - a: keep a when b < a
    JO wmax_ovf
    NOP
    JN wmax_done          ; no overflow, b - a < 0: a is the larger one
    NOP
wmax_take_b:              ; b >= a
    ST R2, SP, 0
wmax_done:
    LDI next
    MOV PC, R0
    NOP
wmax_ovf:
    JN wmax_take_b        ; overflow inverted the sign
    NOP
    LDI next
    MOV PC, R0
    NOP

word_over:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wover_ok
    NOP
    JN wover_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wover_ok:
    LD R1, SP, 1
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_rot:
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wrot_ok
    NOP
    JN wrot_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wrot_ok:
    LD R1, SP, 2          ; a
    LD R2, SP, 1          ; b
    LD R3, SP, 0          ; c
    ST R2, SP, 2          ; b (deepest)
    ST R3, SP, 1          ; c
    ST R1, SP, 0          ; a (top)
    LDI next
    MOV PC, R0
    NOP

word_nip:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wnip_ok
    NOP
    JN wnip_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wnip_ok:
    LD R1, SP, 0          ; b
    ADD SP, 1             ; drop a
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_2dup:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ w2dup_ok
    NOP
    JN w2dup_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2dup_ok:
    LD R1, SP, 1          ; a
    LD R2, SP, 0          ; b
    SUB SP, 1
    ST R1, SP, 0          ; push a first (deeper)
    SUB SP, 1
    ST R2, SP, 0          ; push b last (on top)
    LDI next
    MOV PC, R0
    NOP

word_2drop:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ w2drop_ok
    NOP
    JN w2drop_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2drop_ok:
    ADD SP, 2
    LDI next
    MOV PC, R0
    NOP

word_1plus:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w1plus_under
    NOP
    LD R1, SP, 0
    ADD R1, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
w1plus_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_1minus:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w1minus_under
    NOP
    LD R1, SP, 0
    SUB R1, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
w1minus_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_2star:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w2star_under
    NOP
    LD R1, SP, 0
    ADD R1, R1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
w2star_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_depth:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0          ; stack base
    MOV R3, SP
    SUB R1, R3            ; depth = base - SP
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

; Shared boolean results for the comparisons. True is the Forth
; convention -1 (0xFFFF); LDI cannot load 0xFFFF directly, so build it.
cmp_false:
    LDI 0
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP
cmp_true:
    LDI 1
    NEG R0
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_eq:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ weq_ok
    NOP
    JN weq_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
weq_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    CMP R1, R2
    JZ cmp_true
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP

word_ne:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wne_ok
    NOP
    JN wne_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wne_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    CMP R1, R2
    JNZ cmp_true
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP

word_lt:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wlt_ok
    NOP
    JN wlt_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wlt_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    CMP R1, R2            ; a - b
    JO wlt_ovf
    NOP
    JN cmp_true           ; no overflow: the sign of a - b is the answer
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP
wlt_ovf:
    JN cmp_false          ; overflow inverted the sign, so a - b < 0 now
    NOP                   ;   means a > b
    LDI cmp_true
    MOV PC, R0
    NOP

word_gt:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wgt_ok
    NOP
    JN wgt_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wgt_ok:
    LD R2, SP, 0
    ADD SP, 1
    LD R1, SP, 0
    CMP R2, R1            ; b - a: `a > b` is the same question as `b < a`
    JO wgt_ovf
    NOP
    JN cmp_true           ; no overflow, b - a < 0: a is the larger one
    NOP
    LDI cmp_false         ; equal, or b > a
    MOV PC, R0
    NOP
wgt_ovf:
    JN cmp_false          ; overflow inverted the sign
    NOP
    LDI cmp_true
    MOV PC, R0
    NOP

word_0eq:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w0eq_under
    NOP
    LDI 0
    MOV R2, R0
    LD R1, SP, 0
    CMP R1, R2
    JZ cmp_true
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP
w0eq_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_0lt:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w0lt_under
    NOP
    LDI 0
    MOV R2, R0
    LD R1, SP, 0
    CMP R1, R2
    JN cmp_true
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP
w0lt_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_0gt:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w0gt_under
    NOP
    LDI 0
    MOV R2, R0
    LD R1, SP, 0
    CMP R1, R2
    JZ cmp_false
    NOP
    JN cmp_false
    NOP
    LDI cmp_true
    MOV PC, R0
    NOP
w0gt_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; Unconditional branch: the thread holds an inline offset right after the
; xt. NEXT leaves IP on the offset cell, so target = IP + offset.
branch:
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0
    LD R1, R3, 0
    ADD R3, R1
    ST R3, R2, 0
    LDI next
    MOV PC, R0
    NOP

; Conditional branch: pop a flag, jump when it is zero, else skip the offset.
zbranch:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ zbranch_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    LDI 0
    CMP R1, R0
    JZ zbranch_take
    NOP
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, 1
    ST R3, R2, 0          ; not taken: skip the offset cell
    LDI next
    MOV PC, R0
    NOP
zbranch_take:
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0
    LD R1, R3, 0
    ADD R3, R1
    ST R3, R2, 0
    LDI next
    MOV PC, R0
    NOP
zbranch_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; ---------------------------------------------
; P3: memory words (word-addressed cells, DS segment)
; ---------------------------------------------
word_fetch:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wfetch_under
    NOP
    LD R1, SP, 0          ; addr
    LD R2, R1, 0
    ST R2, SP, 0
    LDI next
    MOV PC, R0
    NOP
wfetch_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_store:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wstore_ok
    NOP
    JN wstore_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wstore_ok:
    LD R2, SP, 0          ; addr
    ADD SP, 1
    LD R1, SP, 0          ; n
    ADD SP, 1             ; and pop it: ! is ( n addr -- )
    ST R1, R2, 0
    LDI next
    MOV PC, R0
    NOP

word_cfetch:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wcfetch_under
    NOP
    LD R1, SP, 0          ; addr
    LD R2, R1, 0
    LDI 255
    MOV R3, R0
    AND R2, R3
    ST R2, SP, 0
    LDI next
    MOV PC, R0
    NOP
wcfetch_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_cstore:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wcstore_ok
    NOP
    JN wcstore_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wcstore_ok:
    LD R2, SP, 0          ; addr
    ADD SP, 1
    LD R1, SP, 0          ; char
    ADD SP, 1             ; and pop it: c! is ( char addr -- )
    LDI 255
    MOV R3, R0
    AND R1, R3
    ST R1, R2, 0
    LDI next
    MOV PC, R0
    NOP

; ---------------------------------------------
; P3b: the same two words, but through ES
; ---------------------------------------------
; @ and ! address through DS. DS is 0 and an effective address is 16 bits, so
; between them they reach physical 0x00000-0x0FFFF - and the screen buffer is at
; 0xF1000, well outside that. No Forth word could touch the screen: not to draw
; on it, not to read it, not to clear it. A Forth literal cannot even name the
; address, because it is 16 bits too.
;
; ES is the second segment, and forth_start leaves it at 0xF000, so ES:0x1000 is
; exactly the screen buffer. These two are @ and ! with ES in place of DS, which
; is all it takes: the offset is still 16 bits, but 0x1000-0x17BF fits.
;
; They are named for the screen and not for the segment because ES is not a
; general-purpose segment here: nothing else in this kernel puts anything behind
; it, and nothing sets it but forth_start. es@ and es! would have said how they
; work; scr@ and scr! say what they are for.
;
; scr! leaves its value on the stack, exactly as ! does. Callers drop it.
word_scr_fetch:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ scrf_under
    NOP
    LD R1, SP, 0           ; the ES offset
    LDS R2, ES, R1
    ST R2, SP, 0
    LDI next
    MOV PC, R0
    NOP
scrf_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_scr_store:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ scrstore_ok
    NOP
    JN scrstore_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
scrstore_ok:
    LD R1, SP, 0           ; the ES offset
    ADD SP, 1
    LD R2, SP, 0           ; the value
    ADD SP, 1              ; and pop it: scr! is ( cell offset -- )
    STS R2, ES, R1
    LDI next
    MOV PC, R0
    NOP

; cls ( -- ) - clear the screen.
;
; A screenful of blanks written from Forth costs about 55,000 steps: a word
; call per cell, plus the address arithmetic and the loop. The BIOS already has
; the same loop in assembly, five instructions a cell, so the same 2000 cells
; are about 10,000 steps - and it is the routine that owns the buffer, so this
; is where the work belongs.
;
; Function code 1 is binit, which clears 80x25 and homes the cursor. Reusing it
; avoids a second copy of the clear loop in the kernel; the price is that cls
; also homes the cursor and re-sets ES and SCR, which is what a Forth cls is
; expected to do anyway.
;
; One thing binit leaves behind has to be undone: it puts the cursor attribute
; back on, so the top-left cell would show a reversed block. Blank that one
; cell. The cursor itself stays at the top left, which is the point of cls.
;
; There is no general swi word, and there should not be one: this is a job the
; kernel does for the program, not a door left open for it. ( value -- ) is how
; the !-family words here work; cls leaves nothing behind.
word_cls:
    LDI 1
    MOV R1, R0
    LDI 0
    MOV R2, R0
    STS R1, DS, R2          ; function code 1 at DS:0, the BIOS dispatch cell
    SWI                     ; the BIOS clears; the next instruction runs after
    LDI ' '                 ; and now the cell binit left its cursor on
    MOV R1, R0
    LDI 0x1000              ; ES:0x1000, the top-left cell of the buffer
    MOV R2, R0
    STS R1, ES, R2
    LDI next
    MOV PC, R0
    NOP

word_plusstore:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wplusstore_ok
    NOP
    JN wplusstore_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wplusstore_ok:
    LD R2, SP, 0          ; addr
    ADD SP, 1
    LD R1, SP, 0          ; n
    LD R3, R2, 0          ; old
    ADD R3, R1
    ST R3, R2, 0
    LDI next
    MOV PC, R0
    NOP

word_here:
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_allot:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wallot_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    ADD R3, R1
    ST R3, R2, 0
    LDI next
    MOV PC, R0
    NOP
wallot_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_comma:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wcomma_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    ST R1, R3, 0
    ADD R3, 1
    ST R3, R2, 0
    LDI next
    MOV PC, R0
    NOP
wcomma_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; A cell is one address unit on Deep16, so `cells` is the identity and
; `cell+` adds one unit.
word_cells:
    LDI next
    MOV PC, R0
    NOP

word_cellplus:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wcellplus_under
    NOP
    LD R1, SP, 0
    ADD R1, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
wcellplus_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; Runtime bodies for defining words. W (R10) is the xt at entry; the data
; cell for a VARIABLE or a CONSTANT lives directly after the CFA cell.
dovar:
    ADD R10, 1            ; data address
    SUB SP, 1
    ST R10, SP, 0
    LDI next
    MOV PC, R0
    NOP

doconst:
    LD R1, R10, 1         ; inline constant
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

; Runtime of a CREATE'd word. W (R10) is the xt; the cell at W+1 holds the
; DOES> thread that was attached (0 when there is none), and the data field
; begins at W+2. A plain created word behaves like a variable.
dodoes:
    LD R1, R10, 1         ; DOES> thread, if any
    ADD R10, 2            ; data field address
    SUB SP, 1
    ST R10, SP, 0         ; push it
    LDI 0
    CMP R1, R0
    JZ dodoes_plain
    NOP
    LDI rp_ptr
    MOV R2, R0
    LD R3, R2, 0
    SUB R3, 1
    LDI ip_ptr
    MOV R4, R0
    LD R7, R4, 0          ; caller's IP
    ST R7, R3, 0
    ST R3, R2, 0          ; RP--
    ST R1, R4, 0          ; IP = DOES> thread
    LDI next
    MOV PC, R0
    NOP
dodoes_plain:
    LDI next
    MOV PC, R0
    NOP

; Runtime of a VOCABULARY word: its body cell is the wordlist head. Executing
; it searches that wordlist first and keeps the built-ins reachable via FORTH.
dovoc:
    ADD R10, 1
    LDI search_order
    MOV R2, R0
    ST R10, R2, 0         ; order[0] = this vocabulary
    ADD R2, 1
    LDI forth_wl
    MOV R1, R0
    ST R1, R2, 0          ; order[1] = FORTH
    ADD R2, 1
    LDI 0
    ST R0, R2, 0
    LDI next
    MOV PC, R0
    NOP

; =============================================
; `s"` — the string that answers instead of printing
; =============================================
; `s"` is recognised by the tokenizer (check_s_token in the first block) for the
; same reason `."` is: what follows it is not a token, so it cannot reach the
; dictionary. It differs from `."` in the one place that matters to a value: ONE
; blank after the quote is the delimiter and is not part of the string, so
; `s" xy"` is the two-character string `xy`. `see` puts that blank back when it
; prints the definition, so the source still round-trips. `."` keeps the blank
; instead, because printing the stored characters is the only thing it does.
;
; Interpreted, `s"` copies the characters into a buffer of its own and answers
; ( c-addr u ). The standard allows a transient buffer, and a copy is the only
; way to answer exactly what the compiled form answers, `\"` included.
; Compiled, it leaves the three cells `."` leaves, with a different marker:
;
;     xt_lit  <address of the characters>  xt_sqstr  <characters>  0
;
; so the runtime half, word_sqstr, finds the characters and steps the thread
; over them the way word_litstr does.

sq_token_check:
    ; Entered from the tokenizer with R2 = the first character of the token,
    ; which is 's'. R3 is the address of the character after it. This routine
    ; lives in the second code block, too far for a conditional jump to reach
    ; the tokenizer's fall-through, so the two exits are long jumps.
    MOV R3, TIB
    ADD R3, >IN
    ADD R3, 1
    LD R4, R3, 0             ; the character after the 's'
    LDI '"'
    CMP R4, R0
    JZ sq_check_quote
    NOP
    LDI check_number_or_word
    MOV PC, R0
    NOP
sq_check_quote:
    LD R4, R3, 1             ; the character after the quote
    LDI ' '
    CMP R4, R0
    JZ sq_token
    NOP
    LDI skip_unknown         ; `s"x"` has no delimiter, so it is not a string
    MOV PC, R0
    NOP
sq_token:
    MOV R1, R3
    SUB R1, TIB
    MOV >IN, R1              ; >IN on the quote
    ADD >IN, 2               ; past the quote and past the delimiter blank
    LDI sq_action
    MOV PC, R0
    NOP

sq_action:
    LDI state_var
    MOV R2, R0
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JNZ sq_compile
    NOP
    LDI sq_interpret
    MOV PC, R0
    NOP

sq_compile:
    LDI dp_var
    MOV R2, R0
    LD R11, R2, 0            ; HERE: the three cells go there
    LDI xt_lit
    MOV R4, R0
    ST R4, R11, 0            ; LIT
    ADD R11, 1
    ADD R11, 1
    ADD R11, 1               ; the characters start after the three cells
    MOV R9, R11
    ST R9, R11, -2           ; their address, for the LIT to push
    LDI xt_sqstr
    MOV R4, R0
    ST R4, R11, -1           ; the marker, which is the runtime word
    LDI copy_string
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI dp_var               ; R11 is one past the NUL
    MOV R2, R0
    ST R11, R2, 0            ; publish HERE
    LDI interpret_loop
    MOV PC, R0
    NOP

sq_interpret:
    LDI sq_buf
    MOV R11, R0
    LDI copy_string
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; ( -- c-addr u ), the length from the two ends of the copy. R11 is one
    ; past the NUL the copy wrote.
    LDI sq_buf
    MOV R2, R0
    MOV R9, R11
    SUB R9, R2
    SUB R9, 1
    SUB SP, 1
    ST R2, SP, 0             ; c-addr
    SUB SP, 1
    ST R9, SP, 0             ; u, on top
    LDI interpret_loop
    MOV PC, R0
    NOP

; copy_string: copy the characters of a string literal out of the parse area
; into the cells at R11, undoing `\"`, and write the terminating NUL. >IN ends
; past the closing quote (or at the end of the line) and R11 one cell past the
; NUL, so the caller can publish HERE from it. LINK-called; `."` and both halves
; of `s"` go through here, which is also why the two agree about escapes.
copy_string:
cs_copy:
    MOV R10, TIB
    ADD R10, >IN             ; the source cursor, inside the quotes
    LD R2, R10, 0
    LDI '"'
    CMP R2, R0
    JZ cs_end                ; the closing quote ends the string
    NOP
    LDI 0
    CMP R2, R0
    JZ cs_end                ; so does the end of the line
    NOP
    LDI 92
    CMP R2, R0
    JNZ cs_put
    NOP
    LD R3, R10, 1            ; a backslash only matters when it quotes
    LDI '"'
    CMP R3, R0
    JNZ cs_put               ; a backslash before anything else is literal
    NOP
    LDI '"'
    MOV R2, R0               ; copy the quote, not the backslash
    ST R2, R11, 0
    ADD R11, 1
    ADD >IN, 2               ; consume both characters
    LDI cs_copy
    MOV PC, R0
    NOP
cs_put:
    ST R2, R11, 0
    ADD R11, 1
    ADD >IN, 1
    LDI cs_copy
    MOV PC, R0
    NOP
cs_end:
    LDI 0
    ST R0, R11, 0            ; NUL terminate: the runtime scans for it
    ADD R11, 1
    ADD >IN, 1               ; step over the closing quote
    JMP LR
    NOP

; =============================================
; P2: Indirect-threaded code engine
; =============================================
; A word is addressed by its execution token (xt): the address of its CFA
; cell. The CFA cell of a primitive holds the address of the primitive's
; machine code; for a colon definition it holds `docol` and the threaded
; body (a list of xts) follows immediately after the CFA cell.
;
; The working register W (R10) holds the xt of the word whose code is about
; to run. It is reloaded by NEXT for every word, so primitives may use R10
; freely. IP and the return-stack pointer live in memory because the shadow
; bank BIOS clobbers R9-R12 and would otherwise corrupt the VM state.
.org 0x2000
.code

next:
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0          ; R3 = IP
    LD R10, R3, 0         ; W = [IP] = xt of the next word
    ADD R3, 1
    ST R3, R2, 0          ; IP++
    LD R4, R10, 0         ; code field = [W]
    MOV PC, R4
    NOP

docol:
    ; Enter a colon definition: W (R10) is its xt, body = W + 1.
    LDI rp_ptr
    MOV R2, R0
    LD R3, R2, 0          ; RP
    SUB R3, 1
    LDI ip_ptr
    MOV R4, R0
    LD R1, R4, 0          ; caller's IP
    ST R1, R3, 0          ; push IP on the return stack
    ST R3, R2, 0          ; RP--
    ADD R10, 1
    ST R10, R4, 0         ; IP = body
    LDI next
    MOV PC, R0
    NOP

exit:
    LDI rp_ptr
    MOV R2, R0
    LD R3, R2, 0
    LD R1, R3, 0          ; pop IP
    ADD R3, 1
    ST R3, R2, 0
    LDI ip_ptr
    MOV R4, R0
    ST R1, R4, 0          ; IP = return address
    LDI next
    MOV PC, R0
    NOP

lit:
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0
    LD R1, R3, 0          ; inline literal
    ADD R3, 1
    ST R3, R2, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

execute_xt:
    ; R1 = xt of a word to run from the outer interpreter. A synthetic
    ; one-cell thread makes the word return to outer_resume via NEXT/EXIT.
    LDI ip_ptr
    MOV R2, R0
    LDI resume_list
    MOV R3, R0
    ST R3, R2, 0          ; IP = resume_list
    MOV R10, R1           ; W = xt
    LD R4, R1, 0          ; code field
    MOV PC, R4
    NOP

outer_resume:
    LDI interpret_loop
    MOV PC, R0
    NOP

; ---------------------------------------------
; Compiler words
; ---------------------------------------------
word_colon:
    ; Skip blanks, then measure the name at >IN (R10 = start, R11 = length).
    LDI 0
    MOV R11, R0
colon_skip:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI ' '
    CMP R4, R0
    JNZ colon_name
    NOP
    ADD >IN, 1
    LDI colon_skip
    MOV PC, R0
    NOP
colon_name:
    MOV R10, R3
colon_len:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ colon_len_done
    NOP
    LDI ' '
    CMP R4, R0
    JZ colon_len_done
    NOP
    ADD R3, 1
    ADD R11, 1
    LDI colon_len
    MOV PC, R0
    NOP
colon_len_done:
    ADD >IN, R11          ; step past the name
    ; Build the header at DP: link | flags+len | name | NUL | CFA=docol
    LDI dp_var
    MOV R12, R0
    LD R9, R12, 0         ; R9 = header = old DP
    MOV R2, R9
    LDI current
    MOV R3, R0
    LD R3, R3, 0          ; address of the current wordlist head cell
    LD R4, R3, 0
    ST R4, R2, 0          ; link field
    ADD R2, 1
    ST R11, R2, 0         ; flags+len
    ADD R2, 1
    MOV R1, R10
colon_copy:
    LD R7, R1, 0
    ST R7, R2, 0
    ADD R1, 1
    ADD R2, 1
    SUB R11, 1
    LDI 0
    CMP R11, R0
    JNZ colon_copy
    NOP
    LDI 0
    ST R0, R2, 0          ; NUL terminator (FIND compares lengths first)
    ADD R2, 1
    LDI docol
    MOV R1, R0
    ST R1, R2, 0          ; CFA = docol
    LDI current_xt
    MOV R3, R0
    ST R2, R3, 0          ; remember this definition's xt for recurse
    ADD R2, 1
    ST R2, R12, 0         ; DP = end of CFA
    LDI current
    MOV R3, R0
    LD R3, R3, 0
    ST R9, R3, 0          ; current wordlist head = new header
    LDI state_var
    MOV R3, R0
    LDI 1
    MOV R4, R0
    ST R4, R3, 0          ; STATE = compiling
    LDI interpret_loop
    MOV PC, R0
    NOP

word_semicolon:
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    LDI xt_exit
    MOV R4, R0
    ST R4, R3, 0          ; compile EXIT
    ADD R3, 1
    ST R3, R2, 0
    LDI state_var
    MOV R2, R0
    LDI 0
    ST R0, R2, 0          ; STATE = interpret
    LDI interpret_loop
    MOV PC, R0
    NOP

word_immediate:
    LDI current
    MOV R2, R0
    LD R2, R2, 0          ; address of the current wordlist head cell
    LD R3, R2, 0          ; newest header in it
    LD R4, R3, 1
    LDI 1
    SL R0, 15                ; R0 = 0x8000
    OR R4, R0
    ST R4, R3, 1          ; set IMMEDIATE on the newest header
    LDI interpret_loop
    MOV PC, R0
    NOP

word_state:
    LDI state_var
    MOV R2, R0
    LD R1, R2, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_bracket_begin:
    LDI state_var
    MOV R2, R0
    LDI 0
    ST R0, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_bracket_end:
    LDI state_var
    MOV R2, R0
    LDI 1
    ST R0, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

; ---------------------------------------------
; P3: control-flow compiler words
; They are immediate and run while compiling. Compile-time branch targets
; are kept on the Forth return stack (rp), which is unused at compile time.
; ---------------------------------------------
word_if:
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    LDI xt_0branch
    MOV R4, R0
    ST R4, R3, 0          ; compile 0branch
    ADD R3, 1
    LDI 0
    ST R0, R3, 0          ; placeholder offset
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    SUB R7, 1
    ST R3, R7, 0          ; push the placeholder
    ST R7, R4, 0
    ADD R3, 1
    ST R3, R2, 0          ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_then:
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0          ; placeholder
    ADD R7, 1
    ST R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R2, R2, 0          ; here
    MOV R1, R2
    SUB R1, R3            ; offset = here - placeholder
    ST R1, R3, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_else:
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0          ; addr1 (the if's placeholder)
    ADD R7, 1
    ST R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0          ; DP
    LDI xt_branch
    MOV R9, R0
    ST R9, R1, 0          ; compile branch
    ADD R1, 1
    LDI 0
    ST R0, R1, 0          ; addr2 = placeholder
    MOV R9, R1
    ADD R9, 1             ; here
    SUB R9, R3            ; offset = here - addr1
    ST R9, R3, 0          ; patch the if
    LD R7, R4, 0
    SUB R7, 1
    ST R1, R7, 0          ; push addr2
    ST R7, R4, 0
    ADD R1, 1
    ST R1, R2, 0          ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_begin:
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0          ; here
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    SUB R7, 1
    ST R3, R7, 0          ; push the loop start
    ST R7, R4, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_until:
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0          ; dest
    ADD R7, 1
    ST R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0          ; DP
    LDI xt_0branch
    MOV R9, R0
    ST R9, R1, 0
    ADD R1, 1             ; ph
    MOV R9, R3
    SUB R9, R1            ; offset = dest - ph
    ST R9, R1, 0
    ADD R1, 1
    ST R1, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_again:
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0          ; dest
    ADD R7, 1
    ST R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0          ; DP
    LDI xt_branch
    MOV R9, R0
    ST R9, R1, 0
    ADD R1, 1             ; ph
    MOV R9, R3
    SUB R9, R1            ; offset = dest - ph
    ST R9, R1, 0
    ADD R1, 1
    ST R1, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_while:
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0          ; DP
    LDI xt_0branch
    MOV R9, R0
    ST R9, R1, 0
    ADD R1, 1             ; orig = placeholder
    LDI 0
    ST R0, R1, 0
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    SUB R7, 1
    ST R1, R7, 0          ; push orig on top of dest
    ST R7, R4, 0
    ADD R1, 1
    ST R1, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_repeat:
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0          ; orig
    ADD R7, 1
    LD R1, R7, 0          ; dest
    ADD R7, 1
    ST R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R7, R2, 0          ; DP
    LDI xt_branch
    MOV R10, R0
    ST R10, R7, 0
    ADD R7, 1             ; ph
    LDI 0
    ST R0, R7, 0
    MOV R10, R1
    SUB R10, R7           ; offset = dest - ph
    ST R10, R7, 0
    ADD R7, 1             ; here
    ST R7, R2, 0
    MOV R10, R7
    SUB R10, R3           ; offset = here - orig
    ST R10, R3, 0         ; patch the while
    LDI interpret_loop
    MOV PC, R0
    NOP

word_recurse:
    LDI current_xt
    MOV R4, R0
    LD R7, R4, 0
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    ST R7, R3, 0          ; compile the current definition's xt
    ADD R3, 1
    ST R3, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

; ---------------------------------------------
; DO / LOOP
;
; The loop needs a place for its two parameters that survives the body, and the
; only such place in this kernel is the return stack: the data stack belongs to
; the body, which may use it freely. So the loop frame lives on the RP, the
; same place a call frame does, and the frame is four cells, pushed below
; everything that is already there:
;
;     RP+0  exit      RP+2  index
;     RP+1  body      RP+3  limit
;
; RP points at the FIRST cell of the frame, so that dropping it is one add.
; A single-cell frame cannot tell the two conventions apart — `docol` writes
; one cell and RP lands on it either way — and getting it wrong here left RP
; one cell too low, so the pop handed the loop's limit to `exit` as a return
; address and the core walked into unwritten memory. Nothing but `loop` and
; `leave` touches the frame, and `exit` inside a loop is refused by the
; standard anyway, so the two cannot collide.
;
; `do` is immediate: it lays down `LIT <exit>` and `xt_do`, and leaves the
; placeholder on the compile-time RP stack that `if`/`then` also uses. The exit
; address is not known until `loop` arrives, hence the placeholder. `loop` pops
; it, compiles `xt_loop` and writes the address just past that cell into it.
;
; At run time the compiled form of `10 0 do i . loop` is
;
;     LIT 10   LIT 0   LIT <exit>   (do)   i   .   (loop)
;
; so `(do)` finds limit, index and exit on the data stack and moves them to the
; loop frame. `(loop)` counts the index up; equal to the limit, it drops the
; frame and falls through - IP already points past its own cell - and otherwise
; sends IP back to the body. That is why no branch cell is needed at all.
;
; As with `if` and `while`, these are compile-time words: at the prompt (STATE
; = 0) every word is executed, so a lone `10 0 do` there lays down half a
; definition, exactly as a lone `if` does.
;
; A `loop` with no `do` in front of it is what the standard calls undefined, and
; the compile-time RP stack is what would be popped from: it would hand the
; loop a return address out of thin air, patch it, and the core would walk into
; unwritten memory and stop — the REPL would be gone, not just the definition.
; So `loop_depth` counts the pairs while compiling and a stray `loop` compiles
; nothing at all. That is a smaller sin than the alternative; it is the only
; unbalanced control word in the kernel that is checked (`then` without `if`
; writes to one harmless cell), and it is checked here because the failure it
; prevents is the one that takes the machine down.
; ---------------------------------------------
word_do:
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0           ; DP
    LDI xt_lit
    MOV R3, R0
    ST R3, R1, 0           ; compile LIT
    ADD R1, 1
    LDI 0
    ST R0, R1, 0           ; the exit address; `loop` fills it in
    MOV R3, R1             ; R3 = the placeholder cell
    ADD R1, 1
    LDI xt_do
    MOV R4, R0
    ST R4, R1, 0           ; compile (do)
    ADD R1, 1
    ST R1, R2, 0           ; DP
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    SUB R7, 1
    ST R3, R7, 0           ; push the placeholder
    ST R7, R4, 0
    LDI loop_depth
    MOV R4, R0
    LD R7, R4, 0
    ADD R7, 1
    ST R7, R4, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

; ?do is `do` with one difference at run time: limit = start skips the loop
; altogether. That case is the reason it exists - `do` counts after the
; increment, so `0 0 do ... loop` runs the body 65536 times, once per cell
; value, before the index wraps round onto the limit again. Everything else is
; the same code with another xt, so the compile side differs in one
; instruction, and the skip reuses the exit address `loop` patches in.
word_qdo:
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0           ; DP
    LDI xt_lit
    MOV R3, R0
    ST R3, R1, 0           ; compile LIT
    ADD R1, 1
    LDI 0
    ST R0, R1, 0           ; the exit address; `loop` fills it in
    MOV R3, R1             ; R3 = the placeholder cell
    ADD R1, 1
    LDI xt_qdo
    MOV R4, R0
    ST R4, R1, 0           ; compile (?do)
    ADD R1, 1
    ST R1, R2, 0           ; DP
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    SUB R7, 1
    ST R3, R7, 0           ; push the placeholder
    ST R7, R4, 0
    LDI loop_depth
    MOV R4, R0
    LD R7, R4, 0
    ADD R7, 1
    ST R7, R4, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_loop:
    LDI loop_depth
    MOV R4, R0
    LD R7, R4, 0
    LDI 0
    CMP R7, R0
    JZ loop_stray          ; no `do` open: compile nothing
    NOP
    LDI 1
    SUB R7, 1
    ST R7, R4, 0
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0           ; the placeholder DO pushed
    ADD R7, 1
    ST R7, R4, 0           ; pop it
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0           ; DP
    LDI xt_loop
    MOV R4, R0
    ST R4, R1, 0           ; compile (loop)
    ADD R1, 1
    ST R1, R2, 0           ; DP, which is now the cell after (loop)
    ST R1, R3, 0           ; the exit address, and the only patch DO needs
loop_stray:
    LDI interpret_loop
    MOV PC, R0
    NOP

; leave pops the frame and sends IP to the exit address the frame carries, so
; the rest of the body is skipped and the cell after `loop` runs next.
word_leave:
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0
    LDI xt_leave
    MOV R4, R0
    ST R4, R1, 0           ; compile (leave)
    ADD R1, 1
    ST R1, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_do_rt:
    ; ( limit start exit -- )  three values, so the check is SP + 3
    LDI sp0_base
    MOV R2, R0
    LDI rp_ptr
    MOV R3, R0
    LDI ip_ptr
    MOV R4, R0
    MOV R9, SP
    ADD R9, 3
    LD R1, R2, 0
    CMP R9, R1
    JZ dor_ok             ; exactly three: SP + 3 == base
    NOP
    JN dor_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
dor_ok:
    LD R7, SP, 0           ; exit
    LD R10, SP, 1          ; start, which is the first index
    LD R11, SP, 2          ; limit
    ADD SP, 3
    LD R9, R4, 0           ; IP: the body starts right after this cell
    LD R1, R3, 0           ; RP
    SUB R1, 4
    ST R1, R3, 0           ; RP first, while R1 still holds the frame's base
    ST R7, R1, 0           ; exit
    ADD R1, 1
    ST R9, R1, 0           ; body
    ADD R1, 1
    ST R10, R1, 0          ; index
    ADD R1, 1
    ST R11, R1, 0          ; limit
dor_next:
    LDI next
    MOV PC, R0
    NOP

word_qdo_rt:
    LDI sp0_base
    MOV R2, R0
    LDI rp_ptr
    MOV R3, R0
    LDI ip_ptr
    MOV R4, R0
    MOV R9, SP
    ADD R9, 3
    LD R1, R2, 0
    CMP R9, R1
    JZ qdor_ok            ; exactly three: SP + 3 == base
    NOP
    JN qdor_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
qdor_ok:
    LD R7, SP, 0           ; exit
    LD R10, SP, 1          ; start
    LD R11, SP, 2          ; limit
    ADD SP, 3
    CMP R11, R10
    JNZ qdor_frame         ; limit <> start: run the body
    NOP
    ; Equal: no loop at all. Skipping the body is not enough - the (loop) that
    ; closes it would find no frame and read whatever the return stack held.
    ; So this jumps to the exit address `loop` patched in, which is one cell
    ; past the (loop): the body and the loop are both skipped.
    LDI ip_ptr
    MOV R2, R0
    ST R7, R2, 0           ; IP = exit
    LDI next
    MOV PC, R0
    NOP
qdor_frame:
    LD R9, R4, 0           ; IP: the body starts right after this cell
    LD R1, R3, 0           ; RP
    SUB R1, 4
    ST R1, R3, 0
    ST R7, R1, 0           ; exit
    ADD R1, 1
    ST R9, R1, 0           ; body
    ADD R1, 1
    ST R10, R1, 0          ; index
    ADD R1, 1
    ST R11, R1, 0          ; limit
    LDI next
    MOV PC, R0
    NOP

word_loop_rt:
    LDI rp_ptr
    MOV R2, R0
    LD R1, R2, 0           ; RP
    LD R3, R1, 2           ; index
    ADD R3, 1
    LD R4, R1, 3           ; limit
    CMP R3, R4
    JZ loop_rt_done        ; index == limit: the loop is over
    NOP
    ST R3, R1, 2           ; index = index + 1
    LD R3, R1, 1           ; body
    LDI ip_ptr
    MOV R2, R0
    ST R3, R2, 0           ; IP = body, and `next` carries on from there
    LDI next
    MOV PC, R0
    NOP
loop_rt_done:
    ADD R1, 4              ; drop the four-cell frame
    ST R1, R2, 0
    LDI next
    MOV PC, R0
    NOP

word_leave_rt:
    LDI rp_ptr
    MOV R2, R0
    LD R1, R2, 0           ; RP
    LD R3, R1, 0           ; exit
    ADD R1, 4              ; drop the frame
    ST R1, R2, 0
    LDI ip_ptr
    MOV R2, R0
    ST R3, R2, 0           ; IP = exit
    LDI next
    MOV PC, R0
    NOP

word_i:
    LDI rp_ptr
    MOV R2, R0
    LD R1, R2, 0           ; RP
    LD R3, R1, 2           ; the innermost index
    SUB SP, 1
    ST R3, SP, 0
    LDI next
    MOV PC, R0
    NOP

; ---------------------------------------------
; P3: simple defining words (variable, constant)
; ---------------------------------------------
; define_name parses the next token, builds a header at DP (link | flags+len |
; name | NUL), links it in and leaves the CFA cell for the caller to fill.
; Returns R9 = header, R2 = CFA cell address, R12 = dp_var.
; It is called with LINK; an empty name returns to the interpreter.
define_name:
    LDI 0
    MOV R11, R0
dname_skip:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI ' '
    CMP R4, R0
    JNZ dname_start
    NOP
    ADD >IN, 1
    LDI dname_skip
    MOV PC, R0
    NOP
dname_start:
    MOV R10, R3
dname_len:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ dname_done
    NOP
    LDI ' '
    CMP R4, R0
    JZ dname_done
    NOP
    ADD R3, 1
    ADD R11, 1
    LDI dname_len
    MOV PC, R0
    NOP
dname_done:
    ADD >IN, R11
    LDI 0
    CMP R11, R0
    JNZ dname_build
    NOP
    LDI interpret_loop     ; no name: nothing to define
    MOV PC, R0
    NOP
dname_build:
    LDI dp_var
    MOV R12, R0
    LD R9, R12, 0         ; header = old DP
    MOV R2, R9
    LDI current
    MOV R3, R0
    LD R3, R3, 0          ; address of the current wordlist head cell
    LD R4, R3, 0
    ST R4, R2, 0          ; link
    ADD R2, 1
    ST R11, R2, 0         ; flags+len
    ADD R2, 1
    MOV R1, R10
dname_copy:
    LD R7, R1, 0
    ST R7, R2, 0
    ADD R1, 1
    ADD R2, 1
    SUB R11, 1
    LDI 0
    CMP R11, R0
    JNZ dname_copy
    NOP
    LDI 0
    ST R0, R2, 0          ; NUL terminator
    ADD R2, 1             ; R2 = CFA cell address
    LDI current
    MOV R3, R0
    LD R3, R3, 0
    ST R9, R3, 0          ; current wordlist head = new header
    JMP LR
    NOP

; create builds a header whose runtime is dodoes. One cell is reserved after
; the CFA for the DOES> thread pointer, so the data field starts at CFA+2.
; It is a threaded primitive: defining words compile it, so it must return
; via NEXT instead of jumping back to the interpreter.
word_create:
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI created_xt
    MOV R4, R0
    ST R2, R4, 0          ; remember the newest created word
    LDI dodoes
    MOV R1, R0
    ST R1, R2, 0          ; CFA = dodoes
    ADD R2, 1
    LDI 0
    ST R0, R2, 0          ; DOES> pointer = 0 (not attached yet)
    ADD R2, 1
    ST R2, R12, 0         ; DP = data field
    LDI next
    MOV PC, R0
    NOP

; does> attaches the thread that follows it to the most recently created word
; and then leaves the defining word, so that thread runs only when the created
; word itself is executed.
word_does:
    LDI ip_ptr
    MOV R2, R0
    LD R3, R2, 0          ; R3 = IP = start of the DOES> thread
    LDI created_xt
    MOV R4, R0
    LD R1, R4, 0
    ADD R1, 1             ; the word's DOES> pointer cell
    ST R3, R1, 0
    LDI rp_ptr
    MOV R2, R0
    LD R3, R2, 0
    LD R1, R3, 0          ; pop the defining word's return address
    ADD R3, 1
    ST R3, R2, 0
    LDI ip_ptr
    MOV R4, R0
    ST R1, R4, 0          ; IP = caller of the defining word
    LDI next
    MOV PC, R0
    NOP

word_variable:
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI dovar
    MOV R1, R0
    ST R1, R2, 0          ; CFA = dovar
    ADD R2, 1             ; data cell
    LDI 0
    ST R0, R2, 0          ; initial value
    SUB SP, 1
    ST R2, SP, 0          ; leave the variable's address
    ADD R2, 1
    ST R2, R12, 0         ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_constant:
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JNZ wconst_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wconst_ok:
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LD R7, SP, 0          ; value to freeze
    ADD SP, 1
    LDI doconst
    MOV R1, R0
    ST R1, R2, 0          ; CFA = doconst
    ADD R2, 1
    ST R7, R2, 0          ; constant value
    ADD R2, 1
    ST R2, R12, 0         ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_value:
    ; Like constant, but the cell may be rewritten with `to`.
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JNZ wvalue_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wvalue_ok:
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LD R7, SP, 0          ; initial value
    ADD SP, 1
    LDI doconst
    MOV R1, R0
    ST R1, R2, 0          ; CFA = doconst
    ADD R2, 1
    ST R7, R2, 0          ; value cell
    ADD R2, 1
    ST R2, R12, 0         ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_to:
    ; `to name` stores the top of stack into name's value cell. Immediate so
    ; it runs while compiling; it then emits code to store at run time.
    LDI find_token
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R1, R0
    JZ to_unknown
    NOP
    ; R1 is the word's code field. A variable's data is the one cell past it,
    ; but a CREATE'd word keeps its DOES> thread there and its data one cell
    ; further on - so `to` has to ask which kind of word it found. Writing the
    ; value over a created word's thread made dodoes take it for an xt and jump
    ; there, and the interpreter died on the word's next use.
    LD R3, R1, 0           ; the word's runtime
    LDI dodoes
    CMP R3, R0
    JZ to_created
    NOP
    ADD R1, 1             ; value cell address
    LDI to_got_cell
    MOV PC, R0
    NOP
to_created:
    ADD R1, 2             ; past the DOES> thread
to_got_cell:
    LDI state_var
    MOV R2, R0
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JZ to_store_now
    NOP
    ; compiling: emit LIT <cell> and the xt of `!`
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    LDI xt_lit
    MOV R4, R0
    ST R4, R3, 0
    ADD R3, 1
    ST R1, R3, 0          ; the value cell address
    ADD R3, 1
    LDI h_store_cfa
    MOV R4, R0
    ST R4, R3, 0          ; xt of `!`
    ADD R3, 1
    ST R3, R2, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
to_store_now:
    LDI sp0_base
    MOV R2, R0
    LD R3, R2, 0
    CMP SP, R3
    JNZ to_have
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
to_have:
    LD R4, SP, 0
    ADD SP, 1
    ST R4, R1, 0
    LDI interpret_loop
    MOV PC, R0
    NOP
to_unknown:
    LDI skip_unknown
    MOV PC, R0
    NOP

; find_token parses the next blank-delimited token and searches the header
; chain. Returns R1 = xt (CFA cell address) and steps >IN past the token on a
; match, or R1 = 0 and >IN at the token start otherwise. Called with LINK.
find_token:
    LDI 0
    MOV R11, R0
ft_skip:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ ft_none
    NOP
    LDI ' '
    CMP R4, R0
    JNZ ft_len
    NOP
    ADD >IN, 1
    LDI ft_skip
    MOV PC, R0
    NOP
ft_len:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ ft_have
    NOP
    LDI ' '
    CMP R4, R0
    JZ ft_have
    NOP
    ADD R3, 1
    ADD R11, 1
    LDI ft_len
    MOV PC, R0
    NOP
ft_have:
    LDI 0
    MOV R12, R0
ft_wl:
    LDI search_order
    MOV R2, R0
    ADD R2, R12
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JZ ft_none
    NOP
    LDI found_wl
    MOV R3, R0
    ST R2, R3, 0          ; remember which wordlist is being searched
    LD R7, R2, 0
ft_loop:
    LDI 0
    CMP R7, R0
    JZ ft_next_wl
    NOP
    LD R2, R7, 1
    LDI 0x00FF
    AND R2, R0
    CMP R2, R11
    JNZ ft_next
    NOP
    MOV R10, R7
    ADD R10, 2
    MOV R3, TIB
    ADD R3, >IN
    MOV R9, R11
ft_cmp:
    LD R2, R3, 0
    LD R4, R10, 0
    CMP R2, R4
    JNZ ft_next
    NOP
    ADD R3, 1
    ADD R10, 1
    SUB R9, 1
    LDI 0
    CMP R9, R0
    JNZ ft_cmp
    NOP
    MOV R1, R7
    ADD R1, 3
    ADD R1, R11           ; R1 = CFA cell address
    ADD >IN, R11
    JMP LR
    NOP
ft_next:
    LD R7, R7, 0
    LDI ft_loop
    MOV PC, R0
    NOP
ft_next_wl:
    ADD R12, 1
    LDI ft_wl
    MOV PC, R0
    NOP
ft_none:
    LDI 0
    MOV R1, R0
    JMP LR
    NOP

; ---------------------------------------------
; P4: vocabularies and the search order
; ---------------------------------------------
; search_order holds wordlist head-cell addresses, first searched first, and
; is 0-terminated. A definition goes into the wordlist in `current`.
word_vocabulary:
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI dovoc
    MOV R1, R0
    ST R1, R2, 0          ; CFA = dovoc
    ADD R2, 1
    LDI 0
    ST R0, R2, 0          ; the new wordlist starts empty
    ADD R2, 1
    ST R2, R12, 0         ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_definitions:
    LDI search_order
    MOV R2, R0
    LD R1, R2, 0          ; first wordlist in the order
    LDI current
    MOV R2, R0
    ST R1, R2, 0          ; new definitions go there
    LDI next
    MOV PC, R0
    NOP

word_also:
    LDI search_order
    MOV R2, R0
    LDI 0
    MOV R9, R0
also_count:
    MOV R4, R2
    ADD R4, R9
    LD R4, R4, 0
    LDI 0
    CMP R4, R0
    JZ also_have
    NOP
    ADD R9, 1
    LDI also_count
    MOV PC, R0
    NOP
also_have:
    LDI 8
    MOV R4, R0
    CMP R9, R4
    JN also_go
    NOP
    LDI next              ; order full: ignore
    MOV PC, R0
    NOP
also_go:
    MOV R1, R9            ; duplicate order[0] by shifting 1..N up
also_shift:
    LDI 0
    CMP R1, R0
    JZ also_done
    NOP
    MOV R4, R2
    ADD R4, R1
    MOV R3, R2
    ADD R3, R1
    SUB R3, 1
    LD R7, R3, 0
    ST R7, R4, 0
    SUB R1, 1
    LDI also_shift
    MOV PC, R0
    NOP
also_done:
    LDI next
    MOV PC, R0
    NOP

word_previous:
    LDI search_order
    MOV R2, R0
    MOV R3, R2
    ADD R3, 1
    LD R7, R3, 0
    LDI 0
    CMP R7, R0
    JNZ prev_go
    NOP
    LDI next              ; only one wordlist: keep it
    MOV PC, R0
    NOP
prev_go:
    LDI 0
    MOV R9, R0
prev_loop:
    MOV R4, R2
    ADD R4, R9
    MOV R3, R4
    ADD R3, 1
    LD R7, R3, 0
    ST R7, R4, 0
    LDI 0
    CMP R7, R0
    JZ prev_done
    NOP
    ADD R9, 1
    LDI prev_loop
    MOV PC, R0
    NOP
prev_done:
    LDI next
    MOV PC, R0
    NOP

word_only:
    LDI forth_wl
    MOV R1, R0
    LDI search_order
    MOV R2, R0
    ST R1, R2, 0
    ADD R2, 1
    LDI 0
    ST R0, R2, 0
    LDI next
    MOV PC, R0
    NOP

word_forth:
    LDI forth_wl
    MOV R1, R0
    LDI search_order
    MOV R2, R0
    ST R1, R2, 0          ; FORTH becomes the first searched wordlist
    LDI next
    MOV PC, R0
    NOP

; words lists the names in the first wordlist of the search order, separated by
; spaces and printed newest-first, through the normal output path (BIOS putch)
; so it wraps and scrolls like any other output. It does not clear the screen
; and never pokes the screen buffer directly.
word_words:
    LDI search_order
    MOV R3, R0
    LD R3, R3, 0          ; first wordlist head-cell address
    LDI 0
    CMP R3, R0
    JZ wwords_ret         ; empty search order
    NOP
    LD R3, R3, 0          ; newest header (0 if that wordlist is empty)
    LDI 0
    CMP R3, R0
    JZ wwords_ret         ; nothing to list: print nothing at all
    NOP
    ; A leading space, like . and see: the REPL echoes the input line without a
    ; trailing space, so the list would otherwise butt against the "words".
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
wwords_hdr:
    LDI 0
    CMP R3, R0
    JZ wwords_ret
    NOP
    LD R2, R3, 1
    LDI 0x00FF
    AND R2, R0            ; name length
    MOV R1, R3
    ADD R1, 2             ; name pointer
wwords_char:
    LDI 0
    CMP R2, R0
    JZ wwords_space
    NOP
    LDI put_char        ; call target (R4 is a scratch register)
    MOV R4, R0
    LD R0, R1, 0          ; the character
    ADD R1, 1
    SUB R2, 1
    LINK
    JMP R4
    NOP
    LDI wwords_char
    MOV PC, R0
    NOP
wwords_space:
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    LD R3, R3, 0          ; follow the link field
    LDI wwords_hdr
    MOV PC, R0
    NOP
wwords_ret:
    LDI next
    MOV PC, R0
    NOP

; put_char prints the character in R0 through BIOS putch (function 2), parking
; >IN (R5) across the call - the shadow-bank BIOS clobbers it. R1-R3 are
; shadow-bank copies and survive the BIOS, so they are left alone for the
; caller; R4, R7 and R9 are transient scratch.
;
; >>> OUTPUT RULE (hardware portability) <<<
; Every character printed goes through putch (BIOS function 2), and every
; kernel routine that prints a character reaches it through this helper (or
; `emit`, its Forth-level twin). putch is the ONE place the kernel talks to the
; outside world: it drives the memory-mapped screen today, and it will drive a
; UART on hardware. That swap must not touch any other routine, so kernel code
; must NOT write ES:SCR (the screen buffer) directly. The only exceptions are
; the screen-specific words (scr@, scr!, cls) and full-screen graphics programs
; like hanoi or snake, which address the framebuffer on purpose and simply do
; not exist on a UART-only machine.
put_char:
    MOV R4, R0            ; the character
    LDI saved_in
    MOV R7, R0
    ST >IN, R7, 0         ; park >IN
    LDI 2                 ; BIOS putch
    MOV R7, R0
    LDI 0
    MOV R9, R0
    STS R7, DS, R9        ; DS:[0] = 2
    LDI 1
    MOV R9, R0
    STS R4, DS, R9        ; DS:[1] = the character
    SWI
    LDI saved_in
    MOV R7, R0
    LD R7, R7, 0
    MOV >IN, R7           ; >IN back
    JMP LR
    NOP

; forget name drops `name` and everything defined after it, reclaims the
; dictionary space and returns to the FORTH vocabulary.
word_forget:
    LDI find_token
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R1, R0
    JZ forget_unknown
    NOP
    LDI found_wl
    MOV R2, R0
    LD R2, R2, 0          ; containing wordlist head cell
    LD R3, R7, 0          ; R7 = header, R3 = its link
    ST R3, R2, 0          ; drop the header and everything newer
    LDI dp_var
    MOV R2, R0
    ST R7, R2, 0          ; HERE = forgotten header
    LDI forth_wl
    MOV R1, R0
    LDI search_order
    MOV R2, R0
    ST R1, R2, 0
    ADD R2, 1
    LDI 0
    ST R0, R2, 0
    LDI current
    MOV R2, R0
    ST R1, R2, 0
    LDI next
    MOV PC, R0
    NOP
forget_unknown:
    LDI skip_unknown
    MOV PC, R0
    NOP

; =============================================
; P5: SEE, the decompiler
; =============================================
; `see name` prints how a word is built instead of running it. A colon
; definition comes back as `: name ... ;`: the thread is walked cell by cell and
; each xt is resolved back to its header, so the body prints as the words that
; compiled it. The cells carrying inline data are recognised by the word in
; front of them - `lit` is followed by the literal, a compiled string by
; `litstr` and the characters (printed as `.\" text"`), `(do)`/`(?do)` by the
; loop's exit address, and `branch`/`0branch` by their offset. The definition ends
; at the address of `xt_exit`, which is what `;` compiles and nothing else does -
; keying on the code field `exit` instead would also stop at an `exit` the source
; put in the middle of a body.
;
; Other kinds of word print as the word that made them - variable, constant,
; create (with its `does>` action), vocabulary - or as `code` when the CFA is
; machine code. The name lookup runs through the search order, so a word that is
; not currently searched prints as `?<n>`; a cell that names no word at all is
; not a thread cell, so the walk stops there (see sb_abort).
;
; Register use follows the kernel: R5 (>IN) and R6 (TIB) must survive, R8 (SCR)
; is the output cursor, R13 is the data stack. The walk keeps its place in
; see_ptr rather than a register because print_number and the reverse lookup
; clobber every scratch register.
word_see:
    ; Resolve the next token to an xt and a header.
    LDI find_token
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R1, R0
    JZ see_unknown
    NOP
    ; R1 = CFA cell address, R7 = header.
    LDI see_cfa
    MOV R3, R0
    ST R1, R3, 0
    LDI see_hdr
    MOV R3, R0
    ST R7, R3, 0
    ; A leading space keeps the output off the echoed name.
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    ; Dispatch on the code field.
    LD R3, R1, 0
    LDI docol
    CMP R3, R0
    JZ see_colon
    NOP
    LDI dovar
    CMP R3, R0
    JZ see_variable
    NOP
    LDI doconst
    CMP R3, R0
    JZ see_constant
    NOP
    LDI dodoes
    CMP R3, R0
    JZ see_created
    NOP
    LDI dovoc
    CMP R3, R0
    JZ see_vocabulary
    NOP
    ; Anything else is a primitive.
    LDI see_str_code
    MOV R1, R0
    LDI see_head
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_done
    MOV PC, R0
    NOP

see_colon:
    LDI see_str_colon
    MOV R1, R0
    LDI see_head
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; CFA + 1 is the first cell of the body.
    LDI see_cfa
    MOV R3, R0
    LD R3, R3, 0
    ADD R3, 1
    LDI see_ptr
    MOV R2, R0
    ST R3, R2, 0
    LDI see_body
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_done
    MOV PC, R0
    NOP

see_variable:
    LDI see_str_variable
    MOV R1, R0
    LDI see_head
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_done
    MOV PC, R0
    NOP

see_constant:
    LDI see_str_constant
    MOV R1, R0
    LDI see_head
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; The constant lives in the cell after the CFA.
    LDI see_cfa
    MOV R3, R0
    LD R3, R3, 0
    ADD R3, 1
    LD R2, R3, 0
    LDI see_num
    MOV R3, R0
    LINK
    JMP R3
    NOP
    LDI see_done
    MOV PC, R0
    NOP

see_created:
    LDI see_str_create
    MOV R1, R0
    LDI see_head
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; The cell after the CFA holds the DOES> thread, 0 when there is none.
    LDI see_cfa
    MOV R3, R0
    LD R3, R3, 0
    ADD R3, 1
    LD R2, R3, 0
    LDI 0
    CMP R2, R0
    JZ see_done
    NOP
    LDI see_str_does
    MOV R1, R0
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_cfa
    MOV R3, R0
    LD R3, R3, 0
    ADD R3, 1
    LD R2, R3, 0
    LDI see_ptr
    MOV R1, R0
    ST R2, R1, 0
    LDI see_body
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_done
    MOV PC, R0
    NOP

see_vocabulary:
    LDI see_str_vocab
    MOV R1, R0
    LDI see_head
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_done
    MOV PC, R0
    NOP

see_done:
    LDI next
    MOV PC, R0
    NOP

see_unknown:
    LDI skip_unknown
    MOV PC, R0
    NOP

; see_head: print the prefix string in R1, then the name in see_hdr and a space,
; so the five kind-specific entries share one line of output code.
see_head:
    LDI see_lrh
    MOV R3, R0
    ST LR, R3, 0
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_print_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_lrh
    MOV R3, R0
    LD LR, R3, 0
    JMP LR
    NOP

; see_print_name: print the name held in the header at see_hdr, then a space.
see_print_name:
    LDI see_lrn
    MOV R3, R0
    ST LR, R3, 0
    LDI see_hdr
    MOV R3, R0
    LD R1, R3, 0
    ADD R1, 2              ; name; .text left a NUL after it
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    LDI see_lrn
    MOV R3, R0
    LD LR, R3, 0
    JMP LR
    NOP

; see_puts: print the NUL-terminated string whose address is in R1, through
; put_char. It disturbs R0, R4, R7 and R9 (and R5/SCR via the BIOS), so
; see_find_name and see_body can keep their header walk in R10/R11/R12 across
; the call; R1-R3 are shadow copies and put_char leaves them alone.
see_puts:
    LDI see_lrp
    MOV R3, R0
    ST LR, R3, 0
see_puts_loop:
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ see_puts_done
    NOP
    LDI put_char
    MOV R4, R0
    MOV R0, R2
    LINK
    JMP R4
    NOP
    ADD R1, 1
    LDI see_puts_loop
    MOV PC, R0
    NOP
see_puts_done:
    LDI see_lrp
    MOV R3, R0
    LD LR, R3, 0
    JMP LR
    NOP

; see_num: print the signed value in R2 the way "." does, then the trailing
; space print_number adds.
see_num:
    LDI see_lrs
    MOV R3, R0
    ST LR, R3, 0
    LDI 0
    CMP R2, R0
    JN see_num_neg
    NOP
    LDI print_number
    MOV R3, R0
    LINK
    JMP R3
    NOP
    LDI see_num_done
    MOV PC, R0
    NOP
see_num_neg:
    LDI put_char
    MOV R4, R0
    LDI '-'
    LINK
    JMP R4
    NOP
    NEG R2                 ; -32768 is unrepresentable and stays put, exactly
    LDI print_number       ; like "."; print_number then shows it unsigned
    MOV R3, R0
    LINK
    JMP R3
    NOP
see_num_done:
    LDI see_lrs
    MOV R3, R0
    LD LR, R3, 0
    JMP LR
    NOP

; see_find_name: print the name of the word whose CFA cell address is in see_xt,
; then a space. A word that the current search order does not reach prints as
; "?<xt>", which is also what a Corrupted body would produce.
see_find_name:
    LDI see_lrf
    MOV R3, R0
    ST LR, R3, 0
    LDI see_miss
    MOV R3, R0
    LDI 0
    ST R0, R3, 0           ; cleared here, set again only if nothing matched
    LDI see_xt
    MOV R3, R0
    LD R11, R3, 0          ; R11 = the target xt
    LDI 0
    MOV R12, R0            ; index into search_order
sfn_wl:
    LDI search_order
    MOV R3, R0
    ADD R3, R12
    LD R3, R3, 0
    LDI 0
    CMP R3, R0
    JZ sfn_none
    NOP
    LD R10, R3, 0          ; newest header of that wordlist
sfn_hdr:
    LDI 0
    CMP R10, R0
    JZ sfn_next_wl
    NOP
    LD R3, R10, 1
    LDI 0x00FF
    AND R3, R0             ; name length
    MOV R4, R10
    ADD R4, 3
    ADD R4, R3             ; R4 = the header's CFA cell address
    CMP R4, R11
    JNZ sfn_next
    NOP
    MOV R1, R10
    ADD R1, 2
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    LDI sfn_done
    MOV PC, R0
    NOP
sfn_next:
    LD R10, R10, 0
    LDI sfn_hdr
    MOV PC, R0
    NOP
sfn_next_wl:
    ADD R12, 1
    LDI sfn_wl
    MOV PC, R0
    NOP
sfn_none:
    LDI put_char
    MOV R4, R0
    LDI '?'
    LINK
    JMP R4
    NOP
    LDI see_xt
    MOV R3, R0
    LD R2, R3, 0
    LDI see_num
    MOV R3, R0
    LINK
    JMP R3
    NOP
    ; Tell see_body no word matched: that cell cannot be a thread cell.
    LDI see_miss
    MOV R3, R0
    LDI 1
    ST R0, R3, 0
sfn_done:
    LDI see_lrf
    MOV R3, R0
    LD LR, R3, 0
    JMP LR
    NOP

; see_body: decompile the thread at see_ptr up to (and including) its exit cell.
; see_store advances see_ptr by the delta in R12 and loops, so no element
; handler has to keep the pointer in a register across a helper call.
see_body:
    LDI see_lrb
    MOV R3, R0
    ST LR, R3, 0
sb_loop:
    LDI see_ptr
    MOV R3, R0
    LD R10, R3, 0
    LD R11, R10, 0         ; the xt in the current cell
    ; `;` compiles the address of xt_exit and nothing else does, so that value
    ; alone marks the end. Testing the code field instead would also stop at an
    ; `exit` the source put in the middle, dropping the rest of the body.
    LDI xt_exit
    CMP R11, R0
    JNZ sb_not_exit          ; not the `;` marker: keep walking
    NOP
    LDI sb_end               ; sb_end is too far for a conditional jump
    MOV PC, R0
    NOP
sb_not_exit:
    LDI xt_lit
    CMP R11, R0
    JZ sb_lit
    NOP
    LDI xt_do
    CMP R11, R0
    JZ sb_dort
    NOP
    LDI xt_qdo
    CMP R11, R0
    JZ sb_qdort
    NOP
    LDI xt_loop
    CMP R11, R0
    JZ sb_loop_rt
    NOP
    LDI xt_plusloop
    CMP R11, R0
    JZ sb_plusloop_rt
    NOP
    LDI xt_leave
    CMP R11, R0
    JZ sb_leave_rt
    NOP
    LDI xt_0branch
    CMP R11, R0
    JZ sb_0branch
    NOP
    LDI xt_branch
    CMP R11, R0
    JZ sb_branch
    NOP
    ; An ordinary name: hand the xt to the reverse lookup.
    LDI see_xt
    MOV R3, R0
    ST R11, R3, 0
    LDI see_find_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; A cell that resolves to no word is not a thread cell, so the walk has run
    ; past the definition. That happens when `;` never compiled - the source was
    ; still being written when something failed - and the cells beyond hold
    ; whatever the machine was initialised with. Stop instead of walking on.
    LDI see_miss
    MOV R3, R0
    LD R3, R3, 0
    LDI 0
    CMP R3, R0
    JNZ sb_abort
    NOP
    LDI 1
    MOV R12, R0
    LDI see_store
    MOV PC, R0
    NOP

sb_dort:
    LDI see_str_do
    MOV R1, R0
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 1
    MOV R12, R0
    LDI see_store
    MOV PC, R0
    NOP
sb_qdort:
    LDI see_str_qdo
    MOV R1, R0
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 1
    MOV R12, R0
    LDI see_store
    MOV PC, R0
    NOP
sb_loop_rt:
    LDI see_str_loop
    MOV R1, R0
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 1
    MOV R12, R0
    LDI see_store
    MOV PC, R0
    NOP
sb_plusloop_rt:
    LDI see_str_plusloop
    MOV R1, R0
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 1
    MOV R12, R0
    LDI see_store
    MOV PC, R0
    NOP
sb_leave_rt:
    LDI see_str_leave
    MOV R1, R0
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 1
    MOV R12, R0
    LDI see_store
    MOV PC, R0
    NOP

; A branch prints its mnemonic and the stored offset. Reconstructing if/then
; would need the whole control-flow structure; the offset is what is really in
; the dictionary, and a forward one points past the body it guards.
sb_branch:
    LDI see_str_branch
    MOV R1, R0
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_ptr
    MOV R3, R0
    LD R10, R3, 0
    LD R2, R10, 1
    LDI see_num
    MOV R3, R0
    LINK
    JMP R3
    NOP
    LDI 2
    MOV R12, R0
    LDI see_store
    MOV PC, R0
    NOP
sb_0branch:
    LDI see_str_0branch
    MOV R1, R0
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_ptr
    MOV R3, R0
    LD R10, R3, 0
    LD R2, R10, 1
    LDI see_num
    MOV R3, R0
    LINK
    JMP R3
    NOP
    LDI 2
    MOV R12, R0
    LDI see_store
    MOV PC, R0
    NOP

; A literal is a `lit` cell and the value behind it. The cell past the value
; says whether it is really something else: `litstr` means the value is the
; address of a compiled string, and (do)/(?do) mean the value is the loop's
; exit address, which the source never showed.
sb_lit:
    LD R3, R10, 2
    LDI xt_litstr
    CMP R3, R0
    JZ sb_string
    NOP
    LDI xt_sqstr
    CMP R3, R0
    JZ sb_string_sq
    NOP
    LDI xt_do
    CMP R3, R0
    JZ sb_lit_do
    NOP
    LDI xt_qdo
    CMP R3, R0
    JZ sb_lit_qdo
    NOP
    LD R2, R10, 1
    LDI see_num
    MOV R3, R0
    LINK
    JMP R3
    NOP
    LDI 2
    MOV R12, R0
    LDI see_store
    MOV PC, R0
    NOP
sb_lit_do:
    LDI see_str_do
    MOV R1, R0
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 3
    MOV R12, R0
    LDI see_store
    MOV PC, R0
    NOP
sb_lit_qdo:
    LDI see_str_qdo
    MOV R1, R0
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 3
    MOV R12, R0
    LDI see_store
    MOV PC, R0
    NOP

; A compiled string: `lit <addr> <marker> <chars>` and a NUL. The characters are
; printed in place and the walk skips to the cell after the NUL, so the string
; bytes are never mistaken for xts. `."` and `s"` differ only in the marker and
; in the prefix printed in front: `."` keeps its delimiter blank in the stored
; text, `s"` does not, so its prefix is the three characters `s" `.
sb_string:
    LDI see_str_dotq
    MOV R7, R0
    LDI sb_string_common
    MOV PC, R0
    NOP
sb_string_sq:
    LDI see_str_sq
    MOV R7, R0
sb_string_common:
    MOV R1, R7
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_ptr
    MOV R3, R0
    LD R10, R3, 0
    LD R11, R10, 1         ; the characters' address
sb_string_loop:
    LD R2, R11, 0
    LDI 0
    CMP R2, R0
    JZ sb_string_end
    NOP
    LDI put_char
    MOV R4, R0
    MOV R0, R2
    LINK
    JMP R4
    NOP
    ADD R11, 1
    LDI sb_string_loop
    MOV PC, R0
    NOP
sb_string_end:
    LDI put_char
    MOV R4, R0
    LDI '"'
    LINK
    JMP R4
    NOP
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    ADD R11, 1             ; R11 sits on the NUL: step past it
    LDI see_ptr
    MOV R3, R0
    ST R11, R3, 0
    LDI sb_loop
    MOV PC, R0
    NOP

sb_end:
    LDI 59                 ; ';' has to be a number: the line parser splits on
    STS R0, ES, SCR        ; a ';' before it ever reads the operand, the same
    ADD SCR, 1             ; reason h_semicolon stores it as a word
    LDI see_lrb
    MOV R3, R0
    LD LR, R3, 0
    JMP LR
    NOP

see_store:
    LDI see_ptr
    MOV R3, R0
    LD R10, R3, 0
    ADD R10, R12
    ST R10, R3, 0
    LDI sb_loop
    MOV PC, R0
    NOP

; The walk met a cell that is not a thread cell (see the check above). Return
; without the closing `;`: the definition did not end where a thread ends, and
; printing a `;` would claim it did.
sb_abort:
    LDI see_lrb
    MOV R3, R0
    LD LR, R3, 0
    JMP LR
    NOP

; =============================================
; Tier 1: the standard words the kernel was missing
; =============================================
; Small stack shufflers, unsigned comparisons, the string and memory helpers and
; the constants BL/TRUE/FALSE. Each is a plain primitive entered through NEXT,
; so it can be compiled into a colon definition as well as run from the outer
; interpreter. The operand checks follow the arithmetic words above: with n
; operands on the stack, SP + n must not sit above the empty-stack base.
;
; SPACE, SPACES and TYPE print through putch like every other character the
; kernel emits (see the OUTPUT RULE at put_char). CR and EMIT reach the same
; putch through the BIOS, which owns carriage return, line feed and the scroll
; at the bottom row.

word_space:
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    LDI next
    MOV PC, R0
    NOP

word_spaces:                ; ( n -- )  n blanks
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wsp_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
wsp_loop:
    LDI 0
    CMP R1, R0
    JZ wsp_done
    NOP
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    SUB R1, 1
    LDI wsp_loop
    MOV PC, R0
    NOP
wsp_done:
    LDI next
    MOV PC, R0
    NOP
wsp_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_qdup:                  ; ( x -- 0 | x x )  duplicate only a nonzero cell
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wqd_under
    NOP
    LD R1, SP, 0
    LDI 0
    CMP R1, R0
    JZ wqd_done             ; zero: the single cell is already the answer
    NOP
    SUB SP, 1
    ST R1, SP, 0
wqd_done:
    LDI next
    MOV PC, R0
    NOP
wqd_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_tuck:                  ; ( a b -- b a b )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wtk_ok
    NOP
    JN wtk_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wtk_ok:
    ; ( a b -- b a b ): a and b swap places and b is copied in below them,
    ; which is `swap over` without the intermediate state.
    LD R1, SP, 0            ; b
    LD R2, SP, 1            ; a
    SUB SP, 1
    ST R1, SP, 0            ; b on top
    ST R2, SP, 1            ; a beneath it
    ST R1, SP, 2            ; and b at the bottom
    LDI next
    MOV PC, R0
    NOP

word_minusrot:              ; ( a b c -- c a b )
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wmr_ok
    NOP
    JN wmr_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wmr_ok:
    LD R1, SP, 0            ; c
    LD R2, SP, 1            ; b
    LD R3, SP, 2            ; a
    ST R2, SP, 0
    ST R3, SP, 1
    ST R1, SP, 2
    LDI next
    MOV PC, R0
    NOP

word_2over:                 ; ( x1 x2 x3 x4 -- x1 x2 x3 x4 x1 x2 )
    MOV R9, SP
    ADD R9, 4
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ w2o_ok
    NOP
    JN w2o_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2o_ok:
    LD R1, SP, 2            ; x2
    LD R2, SP, 3            ; x1
    SUB SP, 2
    ST R1, SP, 0            ; x2 on top
    ST R2, SP, 1            ; x1 beneath it
    LDI next
    MOV PC, R0
    NOP

word_2swap:                 ; ( x1 x2 x3 x4 -- x3 x4 x1 x2 )
    MOV R9, SP
    ADD R9, 4
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ w2s_ok
    NOP
    JN w2s_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2s_ok:
    LD R1, SP, 0            ; x4
    LD R2, SP, 1            ; x3
    LD R3, SP, 2            ; x2
    LD R4, SP, 3            ; x1
    ST R3, SP, 0
    ST R4, SP, 1
    ST R1, SP, 2
    ST R2, SP, 3
    LDI next
    MOV PC, R0
    NOP

word_ult:                   ; u< ( u1 u2 -- flag )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wult_ok
    NOP
    JN wult_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wult_ok:
    LD R2, SP, 0            ; u2
    ADD SP, 1
    LD R1, SP, 0            ; u1
    ; CMP leaves the carry set when the difference borrows, and the ISA defines
    ; that carry as "the result fell below zero" - so JC here is u1 < u2 read
    ; unsigned, which the signed JN could not tell from an ordinary negative.
    CMP R1, R2
    JC wult_yes
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP
wult_yes:
    LDI cmp_true
    MOV PC, R0
    NOP

word_ugt:                   ; u> ( u1 u2 -- flag )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wugt_ok
    NOP
    JN wugt_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wugt_ok:
    LD R2, SP, 0            ; u2
    ADD SP, 1
    LD R1, SP, 0            ; u1
    CMP R2, R1              ; u2 - u1
    JC wugt_yes             ; borrowed: u2 < u1, which is u1 > u2
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP
wugt_yes:
    LDI cmp_true
    MOV PC, R0
    NOP

word_znoteq:                ; 0<> ( x -- flag )
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wzn_under
    NOP
    LD R1, SP, 0
    LDI 0
    CMP R1, R0
    JNZ wzn_yes
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP
wzn_yes:
    LDI cmp_true
    MOV PC, R0
    NOP
wzn_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_within:                ; within ( n lo hi -- flag )  lo <= n < hi
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wwi_ok
    NOP
    JN wwi_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wwi_ok:
    ; lo <= n < hi is (n - lo) < (hi - lo) read unsigned: both sides wrap the
    ; same way, so an n below lo needs no special case.
    LD R1, SP, 0            ; hi
    LD R2, SP, 1            ; lo
    LD R3, SP, 2            ; n
    SUB R3, R2              ; n - lo
    SUB R1, R2              ; hi - lo
    ADD SP, 2
    CMP R3, R1
    JC wwi_yes
    NOP
    LDI cmp_false
    MOV PC, R0
    NOP
wwi_yes:
    LDI cmp_true
    MOV PC, R0
    NOP

word_2fetch:                ; 2@ ( a-addr -- x1 x2 )  x2 at a-addr, x1 at a-addr+1
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ w2f_under
    NOP
    LD R1, SP, 0            ; a-addr
    LD R2, R1, 1            ; x1
    LD R3, R1, 0            ; x2
    SUB SP, 1
    ST R3, SP, 0            ; x2 on top
    ST R2, SP, 1            ; x1 beneath it
    LDI next
    MOV PC, R0
    NOP
w2f_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_2store:                ; 2! ( x1 x2 a-addr -- )
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ w2st_ok
    NOP
    JN w2st_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2st_ok:
    LD R1, SP, 0            ; a-addr
    LD R2, SP, 1            ; x2
    LD R3, SP, 2            ; x1
    ST R2, R1, 0
    ST R3, R1, 1
    ADD SP, 3
    LDI next
    MOV PC, R0
    NOP

word_count:                 ; count ( c-addr -- c-addr u )
    ; A string here is a run of cells ending in a zero cell, so the length is
    ; found by scanning and the string keeps its own address: `addr count type`
    ; prints it. ANS count expects a count byte in front of the characters and
    ; answers c-addr+1, but there are no counted strings here to give that
    ; reading a meaning.
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wct_under
    NOP
    LD R1, SP, 0            ; c-addr
    LDI 0
    MOV R2, R0              ; length
    MOV R3, R1
wct_scan:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ wct_done
    NOP
    ADD R3, 1
    ADD R2, 1
    LDI wct_scan
    MOV PC, R0
    NOP
wct_done:
    SUB SP, 1               ; one operand in, two cells out
    ST R2, SP, 0            ; u on top
    ST R1, SP, 1            ; c-addr beneath it
    LDI next
    MOV PC, R0
    NOP
wct_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_ccomma:                ; c, ( char -- )  append one cell to the dictionary
    ; A cell holds a character, so c, and , are the same store here.
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wcc_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    ST R1, R3, 0
    ADD R3, 1
    ST R3, R2, 0
    LDI next
    MOV PC, R0
    NOP
wcc_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_move:                  ; move ( src dst u -- )  copy u cells upwards
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wmv_ok
    NOP
    JN wmv_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wmv_ok:
    LD R1, SP, 2            ; src
    LD R2, SP, 1            ; dst
    LD R3, SP, 0            ; u
    ADD SP, 3
wmv_loop:
    LDI 0
    CMP R3, R0
    JZ wmv_done
    NOP
    LD R4, R1, 0
    ST R4, R2, 0
    ADD R1, 1
    ADD R2, 1
    SUB R3, 1
    LDI wmv_loop
    MOV PC, R0
    NOP
wmv_done:
    LDI next
    MOV PC, R0
    NOP

word_fill:                  ; fill ( addr u char -- )
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wfl_ok
    NOP
    JN wfl_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wfl_ok:
    LD R1, SP, 2            ; addr
    LD R2, SP, 1            ; u
    LD R3, SP, 0            ; char
    ADD SP, 3
wfl_loop:
    LDI 0
    CMP R2, R0
    JZ wfl_done
    NOP
    ST R3, R1, 0
    ADD R1, 1
    SUB R2, 1
    LDI wfl_loop
    MOV PC, R0
    NOP
wfl_done:
    LDI next
    MOV PC, R0
    NOP

word_erase:                 ; erase ( addr u -- )  fill with zero
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wer_ok
    NOP
    JN wer_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wer_ok:
    LD R1, SP, 1            ; addr
    LD R2, SP, 0            ; u
    ADD SP, 2
wer_loop:
    LDI 0
    CMP R2, R0
    JZ wer_done
    NOP
    LDI 0
    ST R0, R1, 0
    ADD R1, 1
    SUB R2, 1
    LDI wer_loop
    MOV PC, R0
    NOP
wer_done:
    LDI next
    MOV PC, R0
    NOP

word_type:                  ; type ( c-addr u -- )  print u characters
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wty_ok
    NOP
    JN wty_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wty_ok:
    LD R1, SP, 1            ; c-addr
    LD R2, SP, 0            ; u
    ADD SP, 2
wty_loop:
    LDI 0
    CMP R2, R0
    JZ wty_done
    NOP
    LD R3, R1, 0
    LDI 0x00FF
    AND R3, R0              ; the single character emit would print
    LDI put_char
    MOV R4, R0
    MOV R0, R3
    LINK
    JMP R4
    NOP
    ADD R1, 1
    SUB R2, 1
    LDI wty_loop
    MOV PC, R0
    NOP
wty_done:
    LDI next
    MOV PC, R0
    NOP

; ---------------------------------------------
; Tier 1, second batch: ' char execute ['] [char] literal
; ---------------------------------------------
; `'` and `char` are ordinary words: the standard has them parse the next token
; at RUN time, so inside a definition they are compiled as calls and do their
; parsing when the definition runs. `[']`, `[char]` and `literal` do their work
; while the definition is being translated and are IMMEDIATE.

word_tick:                  ; ' ( "<spaces>name" -- xt )
    ; find_token does the parsing: it skips blanks, walks the search order and
    ; leaves >IN past the token on a match. A miss leaves >IN on the token, so
    ; the error path can echo it — the path `to` and `forget` already take.
    LDI find_token
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R1, R0
    JZ wtick_unknown
    NOP
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP
wtick_unknown:
    LDI skip_unknown
    MOV PC, R0
    NOP

parse_char:                 ; LINK-called: R1 = first char of the next token
    ; `char` reads the PARSE AREA, not the dictionary, so a token that names
    ; nothing still names its own first character. Blanks are skipped, the
    ; character is taken, and >IN then runs on to the token's end so the
    ; interpreter sees the delimiter rather than the characters.
    ;
    ; The result goes to R1 and the cursor is R3, an ordinary DS base. R9 would
    ; not do: with PSW.ER = 8 it is half of the ES base pair.
pc_skip:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI ' '
    CMP R4, R0
    JNZ pc_take
    NOP
    ADD >IN, 1
    LDI pc_skip
    MOV PC, R0
    NOP
pc_take:
    LDI 0
    CMP R4, R0
    JZ pc_missing            ; nothing left on this line
    NOP
    MOV R1, R4
    ADD >IN, 1
pc_eat:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ pc_done
    NOP
    LDI ' '
    CMP R4, R0
    JZ pc_done
    NOP
    ADD >IN, 1
    LDI pc_eat
    MOV PC, R0
    NOP
pc_done:
    JMP LR
    NOP
pc_missing:
    ; An empty parse area. Report it the way a name that is not there is
    ; reported, which is what `to` and `forget` do; this never returns.
    LDI skip_unknown
    MOV PC, R0
    NOP

word_char:                  ; char ( "<spaces>name" -- c )
    LDI parse_char
    MOV R2, R0
    LINK
    JMP R2
    NOP
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_execute:               ; execute ( xt -- )
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wexec_under
    NOP
    ; W takes the xt and the jump goes to its code field, which is exactly what
    ; NEXT does with a compiled cell. That is what keeps the caller's thread
    ; alive: a colon word pushes the current IP as its return address, so it
    ; comes back into the definition that ran `execute`. execute_xt is the
    ; wrong tool here — it points IP at the outer interpreter's resume list,
    ; which is right only when `execute` was typed at the prompt.
    LD R10, SP, 0
    ADD SP, 1
    LD R4, R10, 0
    MOV PC, R4
    NOP
wexec_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

compile_lit:                ; LINK-called: compile `LIT <value>` with R1 = value
    ; Shared by `literal`, `[']` and `[char]`. All three compile a value that is
    ; only known while the definition is being translated, and all three leave
    ; the same two cells behind: LIT and the value.
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    LDI xt_lit
    MOV R4, R0
    ST R4, R3, 0
    ADD R3, 1
    ST R1, R3, 0
    ADD R3, 1
    ST R3, R2, 0
    JMP LR
    NOP

word_literal:               ; literal ( x -- ) IMMEDIATE: compile x as a literal
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wlit_under
    NOP
    LD R1, SP, 0
    ADD SP, 1
    LDI compile_lit
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI interpret_loop
    MOV PC, R0
    NOP
wlit_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_bracket_tick:          ; ['] ( "<spaces>name" -- ) IMMEDIATE: compile the xt
    LDI find_token
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R1, R0
    JZ wbt_unknown
    NOP
    LDI compile_lit
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI interpret_loop
    MOV PC, R0
    NOP
wbt_unknown:
    LDI skip_unknown
    MOV PC, R0
    NOP

word_bracket_char:          ; [char] ( "<spaces>name" -- ) IMMEDIATE: compile it
    LDI parse_char
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI compile_lit
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI interpret_loop
    MOV PC, R0
    NOP

; ---------------------------------------------
; Tier 1, third batch: the return stack and the stepped loop
; ---------------------------------------------
; `>r`, `r>` and `r@` move cells between the data stack and the return stack the
; machine already uses for call frames and loop parameters. `>r` checks the data
; stack it takes from; `r>` and `r@` check the return stack pointer against its
; base, because at the prompt the pointer sits exactly on that base and a stray
; `r>` there would read free memory and push whatever it found. From inside a
; definition the pointer is below the base and the check passes, so taking one's
; own call frame apart stays what the standard calls it: undefined.

word_tor:                   ; >r ( x -- ) ( R: -- x )
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wtor_under
    NOP
    LD R1, SP, 0           ; x
    ADD SP, 1
    LDI rp_ptr
    MOV R2, R0
    LD R3, R2, 0           ; RP
    SUB R3, 1
    ST R3, R2, 0           ; RP first, while R3 still holds the new cell
    ST R1, R3, 0
    LDI next
    MOV PC, R0
    NOP
wtor_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_rfrom:                 ; r> ( -- x ) ( R: x -- )
    LDI rp0_base
    MOV R1, R0
    LD R4, R1, 0           ; the return stack's base
    LDI rp_ptr
    MOV R2, R0
    LD R3, R2, 0           ; RP
    CMP R3, R4
    JN wrfrom_ok          ; below the base: there is a frame to take from
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wrfrom_ok:
    LD R1, R3, 0           ; x
    ADD R3, 1
    ST R3, R2, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_rfetch:                ; r@ ( -- x ) ( R: x -- x )
    LDI rp0_base
    MOV R1, R0
    LD R4, R1, 0
    LDI rp_ptr
    MOV R2, R0
    LD R3, R2, 0
    CMP R3, R4
    JN wrfetch_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wrfetch_ok:
    LD R1, R3, 0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

; `do` leaves four cells per loop on the return stack, index and limit at +2 and
; +3 of the frame. `i` reads the innermost index and `j` the one four cells
; further up; `unloop` drops the frame without touching IP, which is what makes
; `unloop exit` leave a loop early. Between them the frame has to be on top of
; the return stack: a `>r` that is still open when `i`, `j` or the loop word
; runs moves the pointer and the frame below it is what gets read. That is the
; standard's ambiguous condition, and it is the reason the tests pair every
; `>r` with an `r>` before the loop word.
word_j:                     ; j ( -- n )
    LDI rp_ptr
    MOV R2, R0
    LD R1, R2, 0           ; RP
    LD R3, R1, 6           ; the outer frame starts four cells up, +2 for index
    SUB SP, 1
    ST R3, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_unloop:                ; unloop ( -- ) ( R: frame -- )
    LDI rp_ptr
    MOV R2, R0
    LD R1, R2, 0
    ADD R1, 4
    ST R1, R2, 0
    LDI next
    MOV PC, R0
    NOP

; `+loop` is the compile-time half: it does what `loop` does — take the
; placeholder `do` pushed, patch the exit address into it, compile the runtime
; word — and differs only in the xt it compiles. loop_depth is the same counter,
; so `+loop` closes a `do` or a `?do` and a stray one compiles nothing.
word_plusloop:
    LDI loop_depth
    MOV R4, R0
    LD R7, R4, 0
    LDI 0
    CMP R7, R0
    JZ wpl_stray          ; no `do` open: compile nothing, as `loop` does
    NOP
    LDI 1
    SUB R7, 1
    ST R7, R4, 0
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0           ; the placeholder DO pushed
    ADD R7, 1
    ST R7, R4, 0           ; pop it
    LDI dp_var
    MOV R2, R0
    LD R1, R2, 0           ; DP
    LDI xt_plusloop
    MOV R4, R0
    ST R4, R1, 0           ; compile (+loop)
    ADD R1, 1
    ST R1, R2, 0           ; DP, one past the cell
    ST R1, R3, 0           ; and that address is what DO carries out
wpl_stray:
    LDI interpret_loop
    MOV PC, R0
    NOP

; (+loop) adds n to the index and continues while the index has not reached the
; limit: index < limit for a step of n >= 0, index >= limit for n < 0. Both are
; signed comparisons and both take the N/V pair for the reason written out at
; `min`. `loop` only tests for equality, so a `+loop` step that jumps over the
; limit ends the loop here, which is what the standard asks of a "crossed the
; boundary" test and what keeps `0 10 do ... -3 +loop` from running for ever.
word_plusloop_rt:
    LDI sp0_base
    MOV R2, R0
    MOV R9, SP
    ADD R9, 1
    LD R1, R2, 0
    CMP R9, R1
    JZ wplr_ok            ; exactly one operand: SP + 1 == base
    NOP
    JN wplr_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wplr_ok:
    LD R7, SP, 0           ; n
    ADD SP, 1
    LDI rp_ptr
    MOV R4, R0
    LD R3, R4, 0           ; RP
    LD R1, R3, 2           ; index
    LD R2, R3, 3           ; limit
    ADD R1, R7
    ST R1, R3, 2           ; index = index + n
    LDI 0
    CMP R7, R0
    JN wplr_down
    NOP
    CMP R1, R2             ; n >= 0
    JO wplr_up_ovf
    NOP
    JN wplr_again          ; no overflow, index - limit < 0: still inside
    NOP
wplr_done:
    ADD R3, 4              ; the loop is over: drop the frame and carry on
    ST R3, R4, 0
    LDI next
    MOV PC, R0
    NOP
wplr_up_ovf:
    JN wplr_done           ; overflow inverted the sign of index - limit
    NOP
wplr_again:
    LD R1, R3, 1           ; body
    LDI ip_ptr
    MOV R2, R0
    ST R1, R2, 0           ; IP = body, and `next` carries on from there
    LDI next
    MOV PC, R0
    NOP
wplr_down:
    CMP R1, R2             ; n < 0: continue while index >= limit
    JO wplr_down_ovf
    NOP
    JN wplr_done           ; index < limit: the step has taken it past the end
    NOP
    LDI wplr_again
    MOV PC, R0
    NOP
wplr_down_ovf:
    JN wplr_again          ; overflow inverted the sign
    NOP
    LDI wplr_done
    MOV PC, R0
    NOP

; ---------------------------------------------
; Tier 1, fourth batch: the number base
; ---------------------------------------------
; base_digit ( R4 = character ) is the digit reader the scanner shares: R10
; comes back as the value 0..15, and R9 as 1 when the character is a digit at
; all (0-9, a-f, A-F) and 0 when it is not. The hex prefix path keeps its own
; copy (hex_digit_value), which jumps straight into its accumulator; this one
; is LINK-called because number_scan and parse_number both have to look at the
; answer before deciding what to do with it.
base_digit:
    LDI '0'
    CMP R4, R0
    JN bd_alpha
    NOP
    LDI '9'
    CMP R0, R4
    JN bd_alpha
    NOP
    LDI '0'
    SUB R4, R0
    MOV R10, R4
    LDI 1
    MOV R9, R0
    JMP LR
    NOP
bd_alpha:
    LDI 'a'
    CMP R4, R0
    JN bd_upper
    NOP
    LDI 'f'
    CMP R0, R4
    JN bd_upper
    NOP
    LDI 87                  ; 'a' is 97, and 97 - 87 = 10
    SUB R4, R0
    MOV R10, R4
    LDI 1
    MOV R9, R0
    JMP LR
    NOP
bd_upper:
    LDI 'A'
    CMP R4, R0
    JN bd_none
    NOP
    LDI 'F'
    CMP R0, R4
    JN bd_none
    NOP
    LDI 55                  ; 'A' is 65, and 65 - 55 = 10
    SUB R4, R0
    MOV R10, R4
    LDI 1
    MOV R9, R0
    JMP LR
    NOP
bd_none:
    LDI 0
    MOV R9, R0              ; R9 = 0: a digit of no base at all
    JMP LR
    NOP

word_hex:                   ; hex ( -- )  read and print numbers in base 16
    LDI base_var
    MOV R2, R0
    LDI 16
    ST R0, R2, 0
    LDI next
    MOV PC, R0
    NOP

word_decimal:               ; decimal ( -- )  read and print them in base 10
    LDI base_var
    MOV R2, R0
    LDI 10
    ST R0, R2, 0
    LDI next
    MOV PC, R0
    NOP

; ---------------------------------------------
; Tier 1, fifth batch: `s"` at run time, pick and roll
; ---------------------------------------------
; `s"` is a tokenizer word (the block at 0x0500 parses and compiles it); what is
; left here is the compiled runtime half. The thread arrives on the address of
; the characters - the LIT cell in front of this word pushed it - and the answer
; is ( c-addr u ). The length is measured by scanning for the NUL the compiler
; wrote, because the string is stored as characters and nothing else, and the
; thread then has to be walked past them: without that, `next` reads the first
; character as an xt and the core jumps into ASCII.
word_sqstr:                 ; ( -- c-addr u )
    LD R3, SP, 0            ; the address the LIT cell pushed
    MOV R7, R3
    LDI 0
    MOV R9, R0              ; the length
sqs_scan:
    LD R2, R7, 0
    LDI 0
    CMP R2, R0
    JZ sqs_done
    NOP
    ADD R7, 1
    ADD R9, 1
    LDI sqs_scan
    MOV PC, R0
    NOP
sqs_done:
    LDI ip_ptr
    MOV R2, R0
    MOV R4, R7
    ADD R4, 1
    ST R4, R2, 0            ; IP = one past the NUL
    SUB SP, 1
    ST R9, SP, 0            ; u, on top of the c-addr that is already there
    LDI next
    MOV PC, R0
    NOP

word_pick:                  ; pick ( xu … x0 u -- xu … x0 xu )
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wpk_under            ; u itself is missing
    NOP
    LD R7, SP, 0            ; u
    ADD SP, 1
    ; u+1 cells have to be there: SP + u + 1 at or below the base, where the
    ; empty stack sits.
    MOV R4, SP
    ADD R4, R7
    ADD R4, 1
    CMP R4, R1
    JZ wpk_ok
    NOP
    JN wpk_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wpk_ok:
    MOV R4, SP
    ADD R4, R7
    LD R3, R4, 0            ; the u-th cell, counting the top as 0
    SUB SP, 1
    ST R3, SP, 0            ; and a copy of it goes on top
    LDI next
    MOV PC, R0
    NOP
wpk_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_roll:                  ; roll ( xu … x0 u -- xu-1 … x0 xu )
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wrl_under
    NOP
    LD R7, SP, 0            ; u
    ADD SP, 1
    MOV R4, SP
    ADD R4, R7
    ADD R4, 1
    CMP R4, R1
    JZ wrl_ok
    NOP
    JN wrl_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wrl_ok:
    ; The cell u places down from the top moves to the top and everything above
    ; it slides down one place. Walking down from that cell keeps every store at
    ; a positive offset, which matters: an LD/ST offset is five unsigned bits,
    ; so -1 would silently encode as 31 and write across the stack.
    MOV R4, SP
    ADD R4, R7
    LD R9, R4, 0            ; the value that moves to the top
    LDI 0
    CMP R7, R0
    JZ wrl_finish           ; u = 0: roll does nothing
    NOP
wrl_shift:
    SUB R4, 1
    LD R3, R4, 0
    ST R3, R4, 1            ; the cell below slides up one place
    SUB R7, 1
    LDI 0
    CMP R7, R0
    JNZ wrl_shift
    NOP
wrl_finish:
    ST R9, R4, 0            ; and the saved value lands on top
    LDI next
    MOV PC, R0
    NOP
wrl_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; =============================================
; BIOS Implementation (at physical 0xF8000)
; =============================================
.equ BIOS_FN_COUNT, 6
.equ BIOS_BASE, bios_entry   ; segment base; see the LDI note at the dispatch
.org 0xF8000
.code
bios_entry:
    ; Dispatch on the function code at DS:0 through the table below. This used
    ; to be a chain of CMP/JNZ tests, one per function, so the block's length
    ; depended on how many functions there were and every routine had to carry
    ; its own number.
    LDI 0
    MOV R3, R0
    LDS R1, DS, R3            ; R1 = function code
    LDI BIOS_FN_COUNT
    CMP R1, R0
    JN bios_jtab_ok           ; in range: 0 .. BIOS_FN_COUNT-1
    NOP
    ; Out of range. The old chain fell off the end into the last routine, so
    ; an unknown code silently ran getstr and waited for a key.
    ; A label resolves to a 20-bit address, but LDI takes a 15-bit signed
    ; immediate, so the delta is what fits. CS is already 0xF800, so the
    ; segment offset is also the jump target.
    ; MOV PC, Rx is the jump form, not ADD PC, Rx: an ALU write to R15 is a
    ; plain store - the PC is already post-incremented, so it would land short
    ; of the target, and it takes no delay slot.
    LDI bios_unknown - BIOS_BASE
    MOV PC, R0
    NOP
bios_jtab_ok:
    MOV R3, PC                ; own address + 1, so no address is baked in
bios_jtab_add:
    ADD R3, BIOS_JTABLE - bios_jtab_add
    ADD R3, R1                ; one word per entry, so the code is the index
    LDS R1, CS, R3            ; the table sits in this segment
    JMP R1
    NOP
BIOS_JTABLE:
    .word bios_f0 - BIOS_BASE
    .word bios_f1 - BIOS_BASE
    .word bios_f2 - BIOS_BASE
    .word bios_f3 - BIOS_BASE
    .word bios_f4 - BIOS_BASE
    .word bios_f5 - BIOS_BASE
bios_f0:
    ; 0: bver -> R0 = 0x0001 (version 0.1)
    LDI 0x0001
    RETI
    NOP
bios_f1:
    ; 1: binit -> init screen/keyboard, clear screen
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 0x1000
    MOV SCR, R0
    ; Clear 80*25 to ' ' using SCR as base (ES selection requires R8)
    LDI 2000
    MOV R2, R0
    LDI ' '
    MOV R3, R0
bios_clr_loop:
    STS R3, ES, SCR
    ADD SCR, 1
    SUB R2, 1
    JNZ bios_clr_loop
    NOP
    ; Place cursor at start, on top of its attribute
    LDI 0x1000
    MOV SCR, R0
    LDI 0x0070          ; fg 0 / bg 7. Nicht LDI 0x7000: das Immediate
    SL  R0, 8           ; ist 15 Bit und signiert, 0x7000 laege als 0xF000
    LDS R1, ES, SCR
    OR  R1, R0
    STS R1, ES, SCR
    RETI
    NOP
bios_f2:
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 2: putch (char from DS:1) with CR/LF handling and scroll
    LDI 1
    MOV R3, R0
    LDS R2, DS, R3      ; R2=char
    LDI 10
    CMP R2, R0
    JZ bios_putch_lf
    NOP
    LDI 13
    CMP R2, R0
    JZ bios_putch_cr
    NOP
    ; regular character: clear old cursor, write char, advance, set new cursor
    LDI ATTR_MASK
    MOV R5, R0
    LDS R1, ES, SCR
    AND R1, R5              ; the cell we leave loses the cursor attribute
    STS R1, ES, SCR
    STS R2, ES, SCR         ; the character alone, so no attribute of its own
    ADD SCR, 1
    ; Implicit wrap has moved the cursor to the next row. If that row is past
    ; the 24 visible rows (row 24 is off-screen), scroll one line and put the
    ; cursor at the start of the last visible row. Without this a wide line
    ; walks off the bottom of the buffer instead of scrolling.
    LDI 0x1780              ; 0x1000 + 24*80: the first off-screen row
    MOV R1, R0
    CMP SCR, R1
    JN putch_cursor
    NOP
    ; scroll: copy rows 1..24 up into 0..23, then clear row 24. Only R0-R3 and
    ; SCR are touched; R0-R3 are shadow-bank copies, so a caller's shared
    ; registers survive the BIOS call.
    LDI 0x1000
    MOV R2, R0              ; dest = base
    MOV R3, R2
    LDI 80
    ADD R3, R0              ; src = base + 80
putch_scroll_copy:
    LD R0, R3, 0
    ST R0, R2, 0
    ADD R2, 1
    ADD R3, 1
    CMP R2, R1
    JNZ putch_scroll_copy
    NOP
    LDI 0x17D0              ; base + 2000: end of row 24
    MOV R3, R0
    LDI ' '
    MOV R1, R0
    LDI 0x1780
    MOV R2, R0
putch_scroll_clear:
    ST R1, R2, 0
    ADD R2, 1
    CMP R2, R3
    JNZ putch_scroll_clear
    NOP
    LDI 0x1730              ; 0x1000 + 23*80: the last visible row, column 0
    MOV SCR, R0
putch_cursor:
    LDI 0x0070          ; fg 0 / bg 7. Nicht LDI 0x7000: das Immediate
    SL  R0, 8           ; ist 15 Bit und signiert, 0x7000 laege als 0xF000
    LDS R3, ES, SCR
    OR  R3, R0              ; and the new cell gets the reversed colour
    STS R3, ES, SCR
    RETI
    NOP
bios_putch_cr:
    ; carriage return: go to start of current line
    LDI 0x1000
    MOV R9, R0
    MOV R10, SCR
    SUB R10, R9
    LDI 80
    MOV R11, R0
    DIV R10, R11
    MUL R10, R11
    ADD R9, R10
    MOV SCR, R9
    RETI
    NOP
bios_putch_lf:
    ; line feed: same column next row, scroll at last row
    LDI 0x1000
    MOV R9, R0           ; base
    MOV R10, SCR         ; current
    SUB R10, R9          ; offset
    LDI 80
    MOV R11, R0          ; width
    MOV R4, R10          ; save offset
    DIV R10, R11         ; R10=row
    ; compute column
    MOV R12, R10
    MUL R12, R11
    SUB R4, R12          ; col
    ; clamp row+1 to last row
    ADD R10, 1
    LDI 24
    MOV R3, R0
    CMP R10, R3
    JN bios_lf_row_lt
    NOP
    ; need to scroll: copy rows 1..24 up, clear last row
    LDI 0
    MOV R2, R0
    LDI 1920
    MOV R5, R0
    LDI 80
    MOV R12, R0
bios_lf_scroll_copy:
    MOV R13, R9
    ADD R13, R2
    MOV R7, R9
    ADD R7, R2
    ADD R7, R12
    LDS R1, ES, R7
    STS R1, ES, R13
    ADD R2, 1
    CMP R2, R5
    JNZ bios_lf_scroll_copy
    NOP
    ; clear last row. The down-counter goes in R12, which the copy loop above
    ; already uses as scratch. It must not be R15: that register is PC, so
    ; "MOV R15, Rx" is a jump, not a store, and this loop was skipped whole.
    ; Not R6 either -- the kernel keeps the text input buffer pointer there.
    LDI 0
    MOV R2, R0
    LDI 80
    MOV R12, R0
    LDI ' '
    MOV R1, R0
bios_lf_scroll_clear:
    MOV R13, R9
    ADD R13, R2
    ADD R13, R5
    STS R1, ES, R13
    ADD R2, 1
    SUB R12, 1
    LDI 0
    CMP R12, R0
    JNZ bios_lf_scroll_clear
    NOP
    ; the content moved up one row, so the cursor keeps its row index. The
    ; last visible row is 23; row 24 is already below the screen.
    LDI 23
    MOV R10, R0
bios_lf_row_lt:
    MUL R10, R11
    ADD R9, R10
    ADD R9, R4          ; +col
    MOV SCR, R9
    RETI
    NOP
bios_f3:
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 3: putstr (address in DS:1, null-terminated)
    LDI 1
    MOV R3, R0
    LDS R2, DS, R3
bios_putstr_loop:
    LD R1, R2, 0
    LDI 0
    CMP R1, R0
    JZ bios_putstr_done
    NOP
    STS R1, ES, SCR
    ADD SCR, 1
    ADD R2, 1
    CLRZ
    JNZ bios_putstr_loop
    NOP
bios_putstr_done:
    RETI
    NOP
bios_f4:
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 4: getch -> R0 = keycode (low byte)
bios_getch_wait:
    LDI KBD_STATUS
    MOV R2, R0
    LDS R1, ES, R2
    LDI 0
    CMP R1, R0
    JZ bios_getch_wait
    NOP
    LDI KBD_DATA
    MOV R2, R0
    LDS R1, ES, R2
    LDI 0x00FF
    AND R1, R0
    ; Store result to DS:1 for caller
    LDI 1
    MOV R3, R0
    STS R1, DS, R3
    RETI
    NOP
bios_f5:
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 5: getstr (buffer addr in DS:1), echo
    LDI 1
    MOV R3, R0
    LDS R2, DS, R3   ; buf
    LDI 0
    MOV R11, R0      ; count
bios_getstr_loop:
    LDI KBD_STATUS
    LDS R1, ES, R0         ; the offset is in R0 already, no scratch needed
    LDI 0
    CMP R1, R0
    JZ bios_getstr_loop
    NOP
    LDI ECHO_FLAG
    LDS R12, ES, R0        ; R12 = the echo flag, read once per keystroke
    LDI KBD_DATA
    LDS R1, ES, R0
    LDI 0x00FF
    AND R1, R0
    LDI 10
    CMP R1, R0
    JZ bios_getstr_done
    NOP
    LDI 13
    CMP R1, R0
    JZ bios_getstr_done
    NOP
    ; backspace
    LDI 8
    CMP R1, R0
    JNZ bios_store_char
    NOP
    LDI 0
    CMP R11, R0
    JZ bios_getstr_loop
    NOP
    SUB R11, 1
    SUB R2, 1              ; R2 is the write pointer: rewind it too, otherwise
                          ; the erased character stays in the buffer and the
                          ; next key lands one cell past it
    ; Echo off: nothing was drawn for this line, so there is nothing to erase
    ; either, and stepping SCR back would move the cursor off a cell this run
    ; never touched. AND R12, R12 sets Z exactly when the flag is 0 and leaves
    ; the flag itself alone, so this is one word shorter than LDI 0 / CMP.
    AND R12, R12
    JZ bios_getstr_loop
    NOP
    ; Clear the cursor in the cell we are about to leave. Unlike the character
    ; echo below, backspace writes nothing over that cell, so the stale block
    ; would stay visible.
    LDI ATTR_MASK
    LDS R3, ES, SCR
    AND R3, R0              ; the attribute back to 0, the character stays
    STS R3, ES, SCR
    SUB SCR, 1
    LDI ' '
    STS R0, ES, SCR
    LDI 0x0070          ; fg 0 / bg 7. Nicht LDI 0x7000: das Immediate
    SL  R0, 8           ; ist 15 Bit und signiert, 0x7000 laege als 0xF000
    LDS R3, ES, SCR
    OR  R3, R0
    STS R3, ES, SCR
    CLRZ
    JNZ bios_getstr_loop
    NOP
bios_store_char:
    ; Refuse the character rather than write past the buffer. Nothing checked
    ; the write pointer before, so a line longer than TIB_LIMIT ran on into the
    ; message strings that follow tib_kbd and overwrote them - quietly, because
    ; the interpreter splits on spaces and reads whatever cells are there.
    LDI TIB_LIMIT
    CMP R11, R0
    JZ bios_getstr_loop      ; full: drop the key and go back for the next one.
    NOP                      ; Count can only grow through here, so it never
                             ; passes TIB_LIMIT and this one test is enough.
    ST R1, R2, 0
    ADD R2, 1
    ADD R11, 1
    ; Echo off: the character is in the buffer and that is all that happens.
    ; Same one-word test as in the backspace path above.
    AND R12, R12
    JZ bios_getstr_loop
    NOP
    ; echo directly: write, advance, set cursor. The cell the cursor is leaving
    ; is the one written here, so clearing its attribute first - as bios_f2's
    ; putch does, for a cell that is then left behind - would be overwritten a
    ; moment later. R1 holds the character masked to 0x00FF, so this store puts
    ; the character down with no attribute of its own.
    STS R1, ES, SCR
    ADD SCR, 1
    LDI 0x0070          ; fg 0 / bg 7. Nicht LDI 0x7000: das Immediate
    SL  R0, 8           ; ist 15 Bit und signiert, 0x7000 laege als 0xF000
    LDS R7, ES, SCR
    OR  R7, R0              ; and the new cell gets the reversed colour
    STS R7, ES, SCR
    ; A routine used to have to keep its length, or pad back with NOPs, because
    ; the dispatch was a chain of CMP/JNZ tests and a routine was only reached
    ; if it sat at the offset the branch had been told about. The jump table
    ; made that go away: every call is a label difference now, so the whole
    ; block shifts together and a routine can change size freely. The last of
    ; those padding NOPs is gone; the NOP after a JMP, MOV PC or RETI stays,
    ; because that one is the delay slot the branch needs. The test "every BIOS
    ; label is distinct, ordered, and inside the block" in tests/forth.test.js
    ; enforces what the offsets used to.
    CLRZ
    JNZ bios_getstr_loop
    NOP
bios_getstr_done:
    LDI 0
    ST R0, R2, 0
    RETI
    NOP
bios_unknown:
    RETI
    NOP
