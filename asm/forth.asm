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
; D16MINI places the whole machine in the 26K-word BSRAM window (0x0000-0x67FF),
; so the BIOS and both stacks move down. The screen build keeps the 1 MB layout:
; its BIOS stays at 0xF8000 and its stacks at 0x6F00 / 0x7FF0.
.ifdef CONSOLE_UART
.equ RSTACK_TOP 0x6000   ; Forth return stack top (grows down), below the BIOS
.else
.equ RSTACK_TOP 0x6F00   ; Forth return stack top (grows down)
.endif

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
.ifdef CONSOLE_UART
    LDI sp_top
    MOV R2, R0
    LD R0, R2, 0
    MOV SP, R0
.else
    LDI 0x7FF0
    MOV SP, R0
.endif
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

    ; BIOS binit, which takes no parameters: the function number is the whole
    ; message, so it is set with the LDI that loads it.
    LDI 1
    SWI

cursor_on:
    LDS R1, ES, SCR
    LDI 0x0070          ; fg 0 / bg 7. Nicht LDI 0x7000: das Immediate
    SL  R0, 8           ; ist 15 Bit und signiert, 0x7000 laege als 0xF000
    OR  R1, R0              ; the cursor attribute, the character stays
    STS R1, ES, SCR
    LDI hello_msg        ; BIOS putstr: the address is the parameter ...
    MOV R1, R0
    LDI 3                ; ... and the function number goes in R0 last, since
    SWI                  ; the LDI that loads it writes R0
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
    LDI '>'              ; BIOS putch
    MOV R1, R0
    LDI 2
    SWI
    LDI ' '
    MOV R1, R0
    LDI 2
    SWI
    JMP LR
    NOP
bios_putch_direct:
    MOV R1, R0           ; the character is the parameter
    LDI 2                ; BIOS putch
    SWI
    JMP LR
    NOP
bios_putstr_direct:
    MOV R1, R0           ; the string address is the parameter
    LDI 3                ; BIOS putstr
    SWI
    JMP LR
    NOP
bios_getch_direct:
    LDI 4                ; BIOS getch, which answers in its own R0
    SWI
    SMV R0, AR0          ; so the key comes home into the caller's R0
    JMP LR
    NOP
bios_getstr_direct:
    MOV R1, R0           ; the buffer address is the parameter
    LDI 5                ; BIOS getstr
    SWI
    JMP LR
    NOP
newline_direct:
    ; CR + LF via BIOS putch so the cursor moves to a fresh line (with
    ; scrolling on the last row). Same newline the interpreter prints
    ; after " ok".
    LDI 13               ; CR
    MOV R1, R0
    LDI 2                ; BIOS putch
    SWI
    LDI 10               ; LF
    MOV R1, R0
    LDI 2
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
.ifdef CONSOLE_UART
    ; The terminal owns the line, so there is no cursor to move: end the banner
    ; line and let the reader start on a fresh row.
    LDI newline_direct
    MOV R2, R0
    LINK
    JMP R2
    NOP
.else
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
.endif
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
    LDI read_line
    MOV PC, R0
    NOP

; Bridge SWI handler: set CS to BIOS segment and jump to offset 0
swi_to_bios:
    ; Build the target CS and PC=0 and far jump via JML
.ifdef CONSOLE_UART
    ; D16MINI: the BIOS is relocated into the low window, segment 0x05F0.
    LDI 0x05F0
    MOV R2, R0           ; R2 = 0x05F0 (target CS)
.else
    LDI 0x0FFF
    INV R0               ; R0 = 0xF000
    MOV R2, R0           ; R2 = 0xF000
    LDI 0x0800
    MOV R3, R0           ; R3 = 0x0800
    ADD R2, R3           ; R2 = 0xF800 (target CS)
.endif
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
    ; Bare string opening: step inside the string and drop the one blank that
    ; delimits the text, the way `s"` and `."` do, so `" x"` and `"x"` both mean
    ; the text `x`. Whether it prints now or is compiled is string_action's call.
    ADD >IN, 1
    MOV R3, TIB
    ADD R3, >IN
    LD R3, R3, 0
    LDI ' '
    CMP R3, R0
    JNZ bare_string_no_blank
    NOP
    ADD >IN, 1
bare_string_no_blank:
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
    ADD >IN, 2               ; past the quote and the delimiter blank
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
; arrive here with >IN past the quote and past the one blank that delimits the
; text, so the text is what was written between them. Interpreted, they print it
; and throw it away. Compiled, they have to leave something behind that prints
; the text when the word is CALLED, so the characters are copied into the
; definition and the definition gets
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
    LDI print_string_body
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
    ; The number scanner is a unit of its own now and lives in the roomy block;
    ; this three-word stub keeps the interpreter's short branch landing here.
    LDI scan_number
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
    ; Inside a catch an unknown name is the standard's -13, thrown from here so
    ; the handler sees it as the exception it is. With no handler the token is
    ; reported and the line abandoned, exactly as before.
    LDI active_handler
    MOV R2, R0
    LD R1, R2, 0
    LDI 0
    CMP R1, R0
    JZ sk_report
    NOP
    LDI 0
    MOV R1, R0
    SUB R1, 13              ; -13: undefined word
    LDI throw_code
    MOV PC, R0
    NOP
sk_report:
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
    LDI read_line
    MOV PC, R0
    NOP

stack_underflow_error:
    ; Inside a catch a stack underflow is the standard's -4, not a message: it
    ; unwinds to the handler and lets the program deal with it. With no handler
    ; in reach the old behaviour stands, message and fresh prompt together.
    LDI active_handler
    MOV R2, R0
    LD R1, R2, 0
    LDI 0
    CMP R1, R0
    JZ su_report
    NOP
    LDI 0
    MOV R1, R0
    SUB R1, 4               ; -4: stack underflow
    LDI throw_code
    MOV PC, R0
    NOP
su_report:
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
    LDI read_line      ; recover: fresh prompt, then read the next line
    MOV PC, R0
    NOP
interpret_done:
    ; A nested evaluation ends here too, so the check lives in the roomy block
    ; and this end of the line stays as short as it was: the 0x0100 block has
    ; only a few words to spare, and growing it past 0x0500 means the .org
    ; there silently overwrites the tail of this one.
    LDI eval_check
    MOV PC, R0
    NOP
line_done:
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
    LDI ok_msg           ; BIOS putstr
    MOV R1, R0
    LDI 3
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
    LDI 13               ; CR
    MOV R1, R0
    LDI 2                ; BIOS putch
    SWI
    LDI 10               ; LF
    MOV R1, R0
    LDI 2
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
    LDI read_line
    MOV PC, R0
    NOP

; =============================================
; Data Section
; =============================================

.org 0x3000
sp0_base:
    .word 0
.ifdef CONSOLE_UART
; The data stack top for D16MINI. 0x67F0 has bit 14 set, so `LDI 0x67F0` would
; sign-extend to 0xE7F0 - the same trap RSTACK_TOP documents. It lives in a cell
; and is loaded with LD, like rp0_base.
sp_top:
    .word 0x67F0
.endif
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
uncaught_msg:
    .text "uncaught exception"
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
    .word dovar           ; a variable, as the standard says: `state @` works
state_var:
    .word 0              ; 0 = interpret, 1 = compile
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
    .word h_lt_hash
    .word 4
    .text "roll"
    .word word_roll
; The sixth batch: pictured numeric output, chained in at the same place. `#`
; and `#s` are the same step twice, and `#>` closes the picture.
h_lt_hash:
    .word h_hash
    .word 2
    .text "<#"
    .word word_lt_hash
h_hash:
    .word h_hash_s
    .word 1
    .text "#"
    .word word_hash
h_hash_s:
    .word h_hash_gt
    .word 2
    .text "#s"
    .word word_hash_s
h_hash_gt:
    .word h_hold
    .word 2
    .text "#>"
    .word word_hash_gt
h_hold:
    .word h_sign
    .word 4
    .text "hold"
    .word word_hold
h_sign:
    .word h_stod
    .word 4
    .text "sign"
    .word word_sign
; The double-cell words. A double is two cells with the high half on top, which
; is the order `#`/`#>` and the standard's own examples already use.
h_stod:
    .word h_dplus
    .word 3
    .text "s>d"
    .word word_stod
h_dplus:
    .word h_dminus
    .word 2
    .text "d+"
    .word word_dplus
h_dminus:
    .word h_dnegate
    .word 2
    .text "d-"
    .word word_dminus
h_dnegate:
    .word h_mplus
    .word 7
    .text "dnegate"
    .word word_dnegate
h_mplus:
    .word h_deq
    .word 2
    .text "m+"
    .word word_mplus
h_deq:
    .word h_d0eq
    .word 2
    .text "d="
    .word word_deq
h_d0eq:
    .word h_dlt
    .word 3
    .text "d0="
    .word word_d0eq
h_dlt:
    .word h_umstar
    .word 2
    .text "d<"
    .word word_dlt
h_umstar:
    .word h_mstar
    .word 3
    .text "um*"
    .word word_umstar
h_mstar:
    .word h_smrem
    .word 2
    .text "m*"
    .word word_mstar
h_smrem:
    .word h_fmmod
    .word 6
    .text "sm/rem"
    .word word_smrem
h_fmmod:
    .word h_ummod
    .word 6
    .text "fm/mod"
    .word word_fmmod
h_ummod:
    .word h_case
    .word 6
    .text "um/mod"
    .word word_ummod
; The case words. All four are IMMEDIATE: they act while the definition is being
; translated, and what they leave in the thread is `over = (0branch) drop`
; and branches - words the runtime already knows.
h_case:
    .word h_of
    .word 0x8004          ; IMMEDIATE | length 4
    .text "case"
    .word word_case
h_of:
    .word h_endof
    .word 0x8002          ; IMMEDIATE | length 2
    .text "of"
    .word word_of
h_endof:
    .word h_endcase
    .word 0x8005          ; IMMEDIATE | length 5
    .text "endof"
    .word word_endof
h_endcase:
    .word h_cmove
    .word 0x8007          ; IMMEDIATE | length 7
    .text "endcase"
    .word word_endcase
; The string words. `cmove` and `blank` only exist because a character is a cell
; here, which makes them `move` and `fill` with a space; `cmove>` is the one that
; walks the other way. All seven are ordinary words.
h_cmove:
    .word h_cmove_gt
    .word 5
    .text "cmove"
    .word word_cmove
h_cmove_gt:
    .word h_blank
    .word 6
    .text "cmove>"
    .word word_cmove_gt
h_blank:
    .word h_minustrailing
    .word 5
    .text "blank"
    .word word_blank
h_minustrailing:
    .word h_compare
    .word 9
    .text "-trailing"
    .word word_minustrailing
h_compare:
    .word h_search
    .word 7
    .text "compare"
    .word word_compare
h_search:
    .word h_slash_string
    .word 6
    .text "search"
    .word word_search
h_slash_string:
    .word h_catch
    .word 7
    .text "/string"
    .word word_slash_string
; The exception words. `catch` and `throw` are ordinary words; `abort` is the
; standard's -1 throw.
h_catch:
    .word h_throw
    .word 5
    .text "catch"
    .word word_catch
h_throw:
    .word h_abort
    .word 5
    .text "throw"
    .word word_throw
h_abort:
    .word h_abortq
    .word 5
    .text "abort"
    .word word_abort
h_abortq:
    .word h_evaluate
    .word 0x8006          ; IMMEDIATE | length 6
    .text "abort\""
    .word word_abortq
h_evaluate:
    .word h_dtos
    .word 8
    .text "evaluate"
    .word word_evaluate
; The rest of the double family, chained in at the same place. Only 2literal is
; immediate; the others are ordinary words, and d. and d.r print through the hold
; area `#` uses.
h_dtos:
    .word h_dabs
    .word 3
    .text "d>s"
    .word word_dtos
h_dabs:
    .word h_dmax
    .word 4
    .text "dabs"
    .word word_dabs
h_dmax:
    .word h_dmin
    .word 4
    .text "dmax"
    .word word_dmax
h_dmin:
    .word h_2literal
    .word 4
    .text "dmin"
    .word word_dmin
h_2literal:
    .word h_2tor
    .word 0x8008          ; IMMEDIATE | length 8
    .text "2literal"
    .word word_2literal
h_2tor:
    .word h_2rfrom
    .word 3
    .text "2>r"
    .word word_2tor
h_2rfrom:
    .word h_2rfetch
    .word 3
    .text "2r>"
    .word word_2rfrom
h_2rfetch:
    .word h_2constant
    .word 3
    .text "2r@"
    .word word_2rfetch
h_2constant:
    .word h_2variable
    .word 9
    .text "2constant"
    .word word_2constant
h_2variable:
    .word h_ddot
    .word 9
    .text "2variable"
    .word word_2variable
h_ddot:
    .word h_ddotr
    .word 2
    .text "d."
    .word word_ddot
h_ddotr:
    .word h_form
    .word 3
    .text "d.r"
    .word word_ddotr
; FORM answers the screen's shape, ( -- rows cols ), so a program can wrap its own
; output. It is the two-inline-cell constant runtime, the same one 2CONSTANT uses:
; 24 is the last visible row index plus one and 80 is the width, both from the
; screen the BIOS drives. Non-standard, so it is documented as an extension.
h_form:
    .word h_included
    .word 4
    .text "form"
    .word doconst2
    .word 24
    .word 80
h_included:
    .word h_dotparen
    .word 8
    .text "included"
    .word word_included
; Tier 3, first batch. */ and */MOD are threaded bodies (m* then sm/rem; */ drops
; the remainder), and CHAR+ is 1+; CHARS, ALIGN and ALIGNED are empty bodies, the
; identity on a machine where a character is a cell. A threaded cell holds the
; word's xt - its header + 3 + the name length - and the body ends at xt_exit,
; exactly what `;` compiles. SOURCE-ID is a constant: -1, the user input device.
h_dotparen:
    .word h_udotr
    .word 0x8002          ; IMMEDIATE | length 2
    .text ".("
    .word word_dotparen
h_udotr:
    .word h_dotr
    .word 3
    .text "u.r"
    .word word_udotr
h_dotr:
    .word h_sourceid
    .word 2
    .text ".r"
    .word word_dotr
h_sourceid:
    .word h_unused
    .word 9
    .text "source-id"
    .word doconst
    .word 0xFFFF          ; -1: the input comes from the keyboard
h_unused:
    .word h_pad
    .word 6
    .text "unused"
    .word word_unused
h_pad:
    .word h_aligned
    .word 3
    .text "pad"
    .word word_pad
h_aligned:
    .word h_align
    .word 7
    .text "aligned"
    .word docol
    .word xt_exit
h_align:
    .word h_chars
    .word 5
    .text "align"
    .word docol
    .word xt_exit
h_chars:
    .word h_charplus
    .word 5
    .text "chars"
    .word docol
    .word xt_exit
h_charplus:
    .word h_starslash
    .word 5
    .text "char+"
    .word docol
    .word h_1plus + 5     ; 1+'s xt
    .word xt_exit
h_starslash:
    .word h_starslashmod
    .word 2
    .text "*/"
    .word docol
    .word h_tor + 5       ; the divisor is on top: keep it, m* the pair below,
    .word h_mstar + 5     ; then bring it back for sm/rem
    .word h_rfrom + 5
    .word h_smrem + 9
    .word h_nip + 6       ; */ drops the remainder
    .word xt_exit
h_starslashmod:
    .word h_tonumber
    .word 5
    .text "*/MOD"
    .word docol
    .word h_tor + 5
    .word h_mstar + 5
    .word h_rfrom + 5
    .word h_smrem + 9
    .word xt_exit
; Tier 3, second batch. The strings are this kernel's (one cell per character,
; NUL-terminated), so FIND looks for `bl word`'s answer and `c" abc" count type`
; prints `abc`. C" is compile-only: it throws -14 when the state is interpreting.
h_tonumber:
    .word h_find
    .word 7
    .text ">number"
    .word word_tonumber
h_find:
    .word h_word
    .word 4
    .text "find"
    .word word_find
h_word:
    .word h_parse
    .word 4
    .text "word"
    .word word_word
h_parse:
    .word h_cquote
    .word 5
    .text "parse"
    .word word_parse
h_cquote:
    .word h_compilecomma
    .word 0x8002          ; IMMEDIATE | length 2
    .text "c\""
    .word word_cquote
; Tier 3, third batch. [compile] and postpone are immediate; :noname and marker
; are ordinary words. compile, is the one step of the compiler, exposed.
h_compilecomma:
    .word h_bracketcompile
    .word 8
    .text "compile,"
    .word word_compilecomma
h_bracketcompile:
    .word h_postpone
    .word 0x8009          ; IMMEDIATE | length 9
    .text "[compile]"
    .word word_bracketcompile
h_postpone:
    .word h_noname
    .word 0x8008          ; IMMEDIATE | length 8
    .text "postpone"
    .word word_postpone
h_noname:
    .word h_marker
    .word 7
    .text ":noname"
    .word word_noname
h_marker:
    .word h_in
    .word 6
    .text "marker"
    .word word_marker
; Tier 3, fourth batch: the input source. >IN is the one approximation - an
; address that reads the live offset, but a store to it does not move the parse
; pointer, which is the register R5 here.
h_in:
    .word h_source
    .word 3
    .text ">in"
    .word word_in
h_source:
    .word h_refill
    .word 6
    .text "source"
    .word word_source
h_refill:
    .word h_saveinput
    .word 6
    .text "refill"
    .word word_refill
h_saveinput:
    .word h_restoreinput
    .word 10
    .text "save-input"
    .word word_saveinput
h_restoreinput:
    .word h_quit
    .word 13
    .text "restore-input"
    .word word_restoreinput
h_quit:
    .word h_environment
    .word 4
    .text "quit"
    .word word_quit
h_environment:
    .word h_tobody
    .word 12
    .text "environment?"
    .word word_environment
h_tobody:
    .word h_see
    .word 5
    .text ">body"
    .word word_tobody

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
; R1 is the register the BIOS reads a call's first parameter from, and the
; kernel's printing routines keep their own pointers in it, so put_char parks
; the caller's R1 here for the duration of the call as well.
saved_r1:
    .word 0

; --- P2 threading state ---
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
; The exception threads. `catch` runs its xt with IP pointing at one of these
; one-cell lists, so however the xt ends - a primitive falls back into `next`, a
; colon word `exit`s - it arrives at the word that finishes the catch. Which of
; the two it lands in is what tells the difference between an xt that returned
; and one that threw.
xt_catch_ok:
    .word word_catch_ok
catch_resume_list:
    .word xt_catch_ok
xt_catch_thrown:
    .word word_catch_thrown
throw_resume_list:
    .word xt_catch_thrown
active_handler:
    .word 0              ; the innermost catch frame, or 0 for none
throw_code_save:
    .word 0              ; the code kept across the handler lookup

; --- evaluate's nested input source ---
; `evaluate` copies its string into one of these buffers - one level each, so a
; nested evaluation cannot overwrite the text its caller is still reading - then
; points TIB at the copy and lets the ordinary interpreter loop run over it. That
; loop ends at a NUL cell, which is why the copy is terminated, and the end of
; the line hands the outer source back (see interpret_done). The depth is one of
; the things a catch frame remembers, so a throw out of an evaluation puts it
; back rather than leaving the next line believing it is still nested.
eval_depth:
    .word 0
eval_tib:
    .word 0, 0
eval_in:
    .word 0, 0
eval_ip:
    .word 0, 0
eval_buf0:
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0
eval_buf1:
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0
; --- included: interpret a buffer of source text, one line at a time ---
; `included` takes the same copy-and-interpret path `evaluate` uses, but the end
; of one line does not return to the caller: eval_check, finding no evaluation
; running, looks at inc_state and reads the next line instead. The buffer is its
; own, so a line that calls `evaluate` cannot overwrite the text still being
; read, and a load takes no evaluation depth - its limit is that it needs the top
; level, because it drives TIB itself.
inc_state:
    .word 0              ; non-zero while `included` is loading
inc_ptr:
    .word 0              ; the next line to read
inc_end:
    .word 0              ; one past the last character
inc_refill:
    .word 0              ; 1 while `refill` asks include_line for a line, which
                         ; then answers instead of driving the load itself
inc_buf:
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0
; pad_buf is what PAD answers: a transient scratch region, one ANS `PAD`'s worth
; of room (the standard asks for at least 84 characters).
pad_buf:
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
word_buf:
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
; accept's own line buffer: one whole BIOS line plus the NUL the BIOS puts after
; it, so the caller's buffer can be smaller than the line without being overrun.
accept_buf:
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0
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
xt_cqstr:
    .word word_cqstr
xt_compilecomma:
    .word h_compilecomma + 11 ; compile,'s xt (header + 3 + 8)
; marker's snapshot, only live while one marker is being defined
mk_head_cell:
    .word 0
mk_old_head:
    .word 0
mk_old_dp:
    .word 0
; `>IN` is the register R5; this cell mirrors it, written by the tokenizer.
in_var:
    .word 0
; What execute_xt last wrote into in_var. The two part only when a word moved the
; pointer by hand (`>IN !`): in_var then holds the new offset, in_shadow the one
; the kernel left, and outer_resume adopts the cell.
in_shadow:
    .word 0
num_neg:
    .word 0              ; 1 while a signed number is being scanned

; environment queries: name cells, length, value. A name not here answers false.
env_core:
    .text "CORE"
env_coreext:
    .text "CORE-EXT"
env_maxn:
    .text "MAX-N"
env_maxu:
    .text "MAX-U"
env_aub:
    .text "ADDRESS-UNIT-BITS"
env_counted:
    .text "/COUNTED-STRING"
env_table:
    .word env_core, 4, 0xFFFF
    .word env_coreext, 8, 0xFFFF
    .word env_maxn, 5, 32767
    .word env_maxu, 5, 0xFFFF
    .word env_aub, 17, 16
    .word env_counted, 14, 255
    .word 0
xt_abortq:
    .word word_abortq_rt
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
; `of` compiles three ordinary words into the thread, so their xts need cells of
; their own: `over = if drop` is what `of` means. Each cell holds the xt `'`
; would hand out - the header's CFA cell, header + 3 + the name length - rather
; than the code label, because that is the address `see` recognises when it
; names a thread cell. A test pins all three against `' over`, `' =` and
; `' drop`, so renaming one of those words fails the suite instead of quietly
; compiling the wrong address.
xt_over:
    .word h_over + 7
xt_eq:
    .word h_eq + 4
xt_drop:
    .word h_drop + 7
current_xt:
    .word 0              ; xt of the definition being compiled (for recurse)
created_xt:
    .word 0              ; xt of the newest CREATE'd word (for DOES>)
loop_depth:
    .word 0              ; DO/LOOP pairs open while compiling
case_depth:
    .word 0              ; CASE/ENDCASE pairs open while compiling
pn_lr:
    .word 0              ; print_number's return address across its putch call
pzs_lr:
    .word 0              ; the same for print_zstring
lit2_save:
    .word 0              ; 2literal's second cell across compile_lit
pcs_lr:
    .word 0              ; print_cells' return address across its put_char call
hd_lr:
    .word 0              ; hold_double's, across its hld_put and hld_step calls
hd_neg:
    .word 0              ; its sign, held after the digits so the minus reads first
wif_lr:
    .word 0              ; wrap_if's return address, across its put_char calls
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
see_str_2constant:
    .text "2constant "
see_str_create:
    .text "create "
see_str_does:
    .text "does> "
see_str_vocab:
    .text "vocabulary "
see_str_dotq:
    ; With the space, like `s"`: the parsed word swallows the one blank that
    ; delimits the text, so the stored characters are the string itself and the
    ; blank has to come back for the source to mean the same when it is read
    ; again.
    .text ".\" "
see_str_sq:
    ; With the space, because `s"` is the other way round: it swallows the one
    ; blank that delimits the text, so the stored characters are the string
    ; itself and the blank has to come back for the source to mean the same
    ; thing when it is read again.
    .text "s\" "
see_str_abortq:
    ; Same shape as `s"`, for the same reason: the parsed word swallows the
    ; delimiting blank, so see puts it back.
    .text "abort\" "
see_str_cq:
    ; `c"` compiles a counted string, like `word` builds one: the length in the
    ; first cell and the characters behind it. The printed source is the same
    ; form again.
    .text "c\" "
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
    ; Park >IN (R5) across the BIOS call: R5 is not one of the banked
    ; registers, so the handler has no copy of its own and overwrites it. R2
    ; *is* banked, which is why it can carry the park cell across untouched.
    LDI saved_in
    MOV R2, R0
    ST >IN, R2, 0
    LDI 2                ; BIOS putch; the masked char is already in R1, where
    SWI                  ; putch reads its parameter
    LD >IN, R2, 0        ; R2 is banked, so it survives the SWI
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
    ; BIOS getch -> the key comes back in the handler's R0
    ; Park >IN (R5) across the BIOS call: R5 is not banked, so the handler has
    ; no copy of its own.
    LDI saved_in
    MOV R2, R0
    ST >IN, R2, 0
    LDI 4                ; BIOS getch
    SWI
    SMV R0, AR0          ; bring it home into the caller's R0
    LD >IN, R2, 0        ; R2 is banked, so it survives the SWI
    SUB SP, 1
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP

read_line:
    ; The REPL's own reader, behind the prompt: BIOS getstr fills TIB (whether it
    ; echoes the characters on the way in is the echo_flag cell, not a fixed
    ; property - see word_echo below), >IN goes back to 0 and the line is
    ; interpreted. This is **not** the standard `ACCEPT`; that is word_accept,
    ; which reads into a buffer of the caller's and answers how much it took.
    ;
    ; A fresh keyboard line also ends any `included` load that was running: the
    ; REPL only comes back here after an error (recover_prompt) or at the top of
    ; the next line, and a failed line must not be resumed after the user has
    ; typed the recovery line.
    LDI inc_state
    MOV R2, R0
    LDI 0
    ST R0, R2, 0
    LDI tib_kbd
    MOV TIB, R0
    MOV R1, TIB          ; BIOS getstr: the buffer is the parameter
    LDI 5
    SWI
    ; reset input index
    LDI 0
    MOV >IN, R0
    LDI interpret_loop
    MOV PC, R0
    NOP

; accept ( c-addr +n1 -- +n2 ) is the standard reader, and a different word from
; read_line above: it takes a buffer of the caller's and answers how many
; characters it put there, instead of filling TIB and starting the interpreter.
;
; The line is read into a buffer of the kernel's own first, through the same
; BIOS getstr, and then copied out: the BIOS stops at its own TIB_LIMIT, not at
; +n1, so handing it the caller's buffer would run a long line past the end of
; it. The two arguments need no parking: R2 and R3 are *banked*, so the handler
; works on copies of its own and cannot disturb them. >IN (R5) is not banked and
; still needs the park cell.
word_accept:
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wac_ok
    NOP
    JN wac_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wac_ok:
    LD R2, SP, 1            ; c-addr. R2 and R3 are banked, so the handler
    LD R3, SP, 0            ; +n1     cannot disturb them across the SWI
    ADD SP, 2
    LDI saved_in
    MOV R4, R0
    ST >IN, R4, 0           ; park the parse pointer (R4 is scratch from here)
    LDI accept_buf
    MOV R1, R0              ; BIOS getstr: read the whole line into our buffer
    LDI 5
    SWI
    LDI saved_in
    MOV R4, R0
    LD >IN, R4, 0           ; put the parse pointer back
    LDI accept_buf
    MOV R10, R0             ; the read pointer
    LDI 0
    MOV R9, R0              ; +n2
wac_copy:
    LD R4, R10, 0
    LDI 0
    CMP R4, R0
    JZ wac_done             ; the BIOS put its NUL at the end of the line
    NOP
    LDI 0
    CMP R3, R0
    JZ wac_done             ; the caller's buffer is full
    NOP
    ST R4, R2, 0
    ADD R2, 1
    ADD R10, 1
    ADD R9, 1
    SUB R3, 1
    LDI wac_copy
    MOV PC, R0
    NOP
wac_done:
    SUB SP, 1
    ST R9, SP, 0            ; +n2, what went into the buffer
    LDI next
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
    ; >IN (R5) is parked across the call: it is not banked, so the handler
    ; overwrites it. R2 carries the park cell, and R2 is banked itself.
    LDI saved_in
    MOV R2, R0
    ST >IN, R2, 0
    LDI 13               ; CR
    MOV R1, R0
    LDI 2                ; BIOS putch
    SWI
    LDI 10               ; LF
    MOV R1, R0
    LDI 2
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
    SWI                     ; BIOS binit, with no parameters: the function
                            ; number is the whole call
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

doconst2:
    ; Runtime of a 2CONSTANT: the two cells behind the code field, pushed in the
    ; order they were given, so x2 ends on top as the input left it.
    LD R1, R10, 1
    LD R3, R10, 2
    SUB SP, 2
    ST R1, SP, 1
    ST R3, SP, 0
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

; --- evaluate ------------------------------------------------------------
; `evaluate` interprets a string the way the keyboard line is interpreted: the
; same tokenizer, the same words, the same state. It copies the text into a
; buffer of its own (one per nesting level, so a nested evaluation cannot
; overwrite the text its caller is still reading), terminates it, points TIB at
; it, and lets the ordinary interpreter loop run. That loop stops at a NUL cell,
; which is why the copy is terminated - and interpret_done knows to hand the
; outer source back instead of printing a prompt.
;
; Two levels are supported; the standard asks for two. Past that, or for a string
; longer than a line, the exception is -22.

word_evaluate:              ; evaluate ( i*x c-addr u -- j*x )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wev_ok
    NOP
    JN wev_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wev_ok:
    LD R1, SP, 1            ; c-addr
    LD R3, SP, 0            ; u
    ADD SP, 2               ; both are consumed
    LDI 128                 ; a line, and so one level, is at most that long
    MOV R7, R0
    CMP R7, R3
    JC wev_bad              ; carry: u is above 128
    NOP
    LDI eval_depth
    MOV R2, R0
    LD R4, R2, 0            ; the level this evaluation would use
    LDI 2
    MOV R7, R0
    CMP R4, R7
    JC wev_room             ; carry: level 0 or 1, there is a buffer for it
    NOP
wev_bad:
    LDI -22                 ; -22: too long, or nested deeper than two
    MOV R1, R0
    LDI throw_code
    MOV PC, R0
    NOP
wev_room:
    ; Remember the source and the thread that is running.
    LDI eval_tib
    MOV R7, R0
    ADD R7, R4
    MOV R11, TIB
    ST R11, R7, 0
    LDI eval_in
    MOV R7, R0
    ADD R7, R4
    MOV R11, >IN
    ST R11, R7, 0
    LDI eval_ip
    MOV R7, R0
    ADD R7, R4
    LDI ip_ptr
    MOV R11, R0
    LD R11, R11, 0
    ST R11, R7, 0           ; the cell that was about to run
    ; Copy the text into this level's buffer.
    LDI eval_buf0
    MOV R7, R0
    LDI 0
    CMP R4, R0
    JZ wev_copy
    NOP
    LDI eval_buf1
    MOV R7, R0
wev_copy:
    MOV R11, R7             ; the destination cursor
    MOV R12, R1             ; the source cursor
    MOV R10, R3             ; the count
wev_copy_loop:
    LDI 0
    CMP R10, R0
    JZ wev_copied
    NOP
    LD R2, R12, 0
    ST R2, R11, 0
    ADD R12, 1
    ADD R11, 1
    SUB R10, 1
    LDI wev_copy_loop
    MOV PC, R0
    NOP
wev_copied:
    LDI 0
    ST R0, R11, 0           ; the interpreter stops at this NUL
    ADD R4, 1
    LDI eval_depth
    MOV R2, R0
    ST R4, R2, 0
    MOV TIB, R7
    LDI 0
    MOV >IN, R0
    LDI interpret_loop
    MOV PC, R0
    NOP

; eval_check: one line has ended (interpret_done landed here). If an evaluation
; is running, hand the outer input source and the thread that was in the middle
; of it back; if not, carry on into the line's end, the " ok" and the prompt,
; which is what interpret_done used to fall into directly.
eval_check:
    LDI eval_depth
    MOV R2, R0
    LD R1, R2, 0
    LDI 0
    CMP R1, R0
    JNZ evc_pop             ; an evaluation is running: pop it
    NOP
    ; No evaluation is running. An `included` load may still be, in which case
    ; the next line is read from its buffer instead of the line ending.
    LDI inc_state
    MOV R3, R0
    LD R3, R3, 0
    LDI 0
    CMP R3, R0
    JNZ include_line
    NOP
    LDI line_done
    MOV PC, R0
    NOP
evc_pop:
    SUB R1, 1
    ST R1, R2, 0
    LDI eval_tib
    MOV R3, R0
    ADD R3, R1
    LD R7, R3, 0
    MOV TIB, R7
    LDI eval_in
    MOV R3, R0
    ADD R3, R1
    LD R7, R3, 0
    MOV >IN, R7
    LDI eval_ip
    MOV R3, R0
    ADD R3, R1
    LD R7, R3, 0            ; the cell that was about to run
    ; If that cell is resume_list, evaluate was called from the keyboard line
    ; rather than from a definition: the interpreter had just handed the word its
    ; turn, so carrying on means going back to the interpreter loop at the outer
    ; >IN, not jumping into a thread. Compiled, it is a real thread cell and
    ; restoring IP is exactly right.
    LDI resume_list
    MOV R3, R0
    CMP R7, R3
    JNZ evc_thread
    NOP
    LDI interpret_loop
    MOV PC, R0
    NOP
evc_thread:
    LDI ip_ptr
    MOV R3, R0
    ST R7, R3, 0
    LDI next
    MOV PC, R0
    NOP

; =============================================
; included: interpret a buffer of source, line by line
; =============================================
; `included ( i*x c-addr u -- j*x )` walks a buffer and evaluates it the way the
; keyboard line is evaluated, one line at a time. Each line is copied into
; inc_buf and terminated with a NUL, because the interpreter stops at a NUL and
; the newlines in the buffer are not one. When a line ends, eval_check finds no
; evaluation running and calls include_line again; the load ends when the buffer
; is spent, and the " ok" the REPL prints at the end belongs to the line that was
; running when it started - the one that said `included`.
;
; It drives TIB itself and takes no evaluation depth, so it must be at the top
; level: called from inside an `evaluate`, or while another load is running, it
; throws -22. A line longer than 128 characters throws the same -22 `evaluate`
; throws for too long a string.

include_line:
    LDI inc_ptr
    MOV R2, R0
    LD R1, R2, 0            ; the cursor
    LDI inc_end
    MOV R3, R0
    LD R7, R3, 0            ; one past the last character
    CMP R1, R7
    JC include_have         ; carry = borrow: cursor < end, chars remain
    NOP
include_fin:
    LDI inc_state
    MOV R2, R0
    LDI 0
    ST R0, R2, 0            ; the load is over
    ; A `refill` asked for this line, so it wants the answer back rather than the
    ; line ending: false, there is no further source.
    LDI inc_refill
    MOV R3, R0
    LD R3, R3, 0
    LDI 0
    CMP R3, R0
    JNZ include_refill_no
    NOP
    LDI line_done
    MOV PC, R0
    NOP
include_refill_no:
    LDI inc_refill
    MOV R3, R0
    LDI 0
    ST R0, R3, 0            ; driving the load from eval_check again
    SUB SP, 1
    ST R0, SP, 0            ; false
    LDI next
    MOV PC, R0
    NOP
include_have:
    LDI inc_buf
    MOV R11, R0             ; the destination cursor
    LDI 0
    MOV R9, R0              ; characters copied
include_copy:
    CMP R1, R7
    JC include_copy_body
    NOP
    ; end of buffer: this line runs to the end
    LDI inc_ptr
    MOV R2, R0
    ST R7, R2, 0
    LDI include_settib
    MOV PC, R0
    NOP
include_copy_body:
    LD R4, R1, 0
    LDI 10
    CMP R4, R0
    JZ include_line_end
    NOP
    LDI 13
    CMP R4, R0
    JZ include_line_end
    NOP
    LDI 128
    CMP R9, R0
    JZ include_toolong      ; a full line already: one more would overflow
    NOP
    ST R4, R11, 0
    ADD R11, 1
    ADD R1, 1
    ADD R9, 1
    LDI include_copy
    MOV PC, R0
    NOP
include_line_end:
    ADD R1, 1               ; past the newline (or the CR of a CRLF)
    LDI inc_ptr
    MOV R2, R0
    ST R1, R2, 0
include_settib:
    LDI 0
    ST R0, R11, 0           ; the interpreter stops at this NUL
    LDI inc_buf
    MOV TIB, R0
    LDI 0
    MOV >IN, R0
    ; A `refill` asked for this line: answer true and let the outer interpreter
    ; carry on from the new line. Otherwise the line is the load's next one.
    LDI inc_refill
    MOV R3, R0
    LD R3, R3, 0
    LDI 0
    CMP R3, R0
    JNZ include_refill_yes
    NOP
    LDI interpret_loop
    MOV PC, R0
    NOP
include_refill_yes:
    LDI inc_refill
    MOV R3, R0
    LDI 0
    ST R0, R3, 0            ; driving the load from eval_check again
    LDI -1
    SUB SP, 1
    ST R0, SP, 0            ; true
    LDI next
    MOV PC, R0
    NOP
include_toolong:
    LDI inc_refill
    MOV R3, R0
    LDI 0
    ST R0, R3, 0            ; and no answer is owed
    LDI inc_state
    MOV R2, R0
    LDI 0
    ST R0, R2, 0            ; give up the load, then report
    LDI -22
    MOV R1, R0
    LDI throw_code
    MOV PC, R0
    NOP

word_included:              ; included ( i*x c-addr u -- j*x )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ win_ok
    NOP
    JN win_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
win_ok:
    LDI inc_state
    MOV R2, R0
    LD R1, R2, 0
    LDI 0
    CMP R1, R0
    JNZ win_busy            ; a load is already running
    NOP
    LDI eval_depth
    MOV R2, R0
    LD R1, R2, 0
    LDI 0
    CMP R1, R0
    JNZ win_busy            ; an evaluation owns TIB
    NOP
    LD R1, SP, 1            ; c-addr
    LD R3, SP, 0            ; u
    ADD SP, 2
    LDI inc_ptr
    MOV R2, R0
    ST R1, R2, 0
    LDI inc_end
    MOV R2, R0
    MOV R4, R1
    ADD R4, R3
    ST R4, R2, 0            ; one past the last byte
    LDI inc_state
    MOV R2, R0
    LDI 1
    ST R0, R2, 0            ; loading
    LDI include_line
    MOV PC, R0
    NOP
win_busy:
    LDI -22
    MOV R1, R0
    LDI throw_code
    MOV PC, R0
    NOP

; ---------------------------------------------
; Tier 2, sixth batch: the rest of the double family, and STATE
; ---------------------------------------------
; d>s, dabs, dmax, dmin, 2literal, 2>r/2r>/2r@, 2constant, 2variable and the two
; printing words d. and d.r. The three comparisons share one routine, `dless`,
; which is what d< decides with; and d. builds its digits with the same
; hold-area step `#` uses, so a double prints in the current base and follows the
; current hold rules. `state` becomes a variable, as the standard says and as the
; manual already claimed: it pushes the address of the cell the compiler keeps
; its state in, so `state @` works.

word_dtos:                  ; d>s ( d -- n )  the low cell, the high one dropped
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdts_ok
    NOP
    JN wdts_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdts_ok:
    ADD SP, 1               ; the high cell goes away
    LDI next
    MOV PC, R0
    NOP

word_dabs:                  ; dabs ( d -- ud )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdab_ok
    NOP
    JN wdab_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdab_ok:
    LD R1, SP, 0            ; the high cell carries the sign
    LDI 0
    CMP R1, R0
    JNN wdab_done
    NOP
    LD R3, SP, 1            ; the low cell
    INV R1                  ; two's complement, the way dnegate does it
    INV R3
    ADD R3, 1
    JC wdab_carry
    NOP
    ST R1, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP
wdab_carry:
    ADD R1, 1
    ST R1, SP, 0
    ST R3, SP, 1
wdab_done:
    LDI next
    MOV PC, R0
    NOP

word_2literal:              ; 2literal ( x1 x2 -- ) IMMEDIATE
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ w2lit_ok
    NOP
    JN w2lit_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2lit_ok:
    LD R7, SP, 1            ; x1, which the thread has to push first
    LD R3, SP, 0            ; x2
    ADD SP, 2
    LDI lit2_save
    MOV R2, R0
    ST R3, R2, 0            ; x2 waits here: compile_lit uses R2-R4
    MOV R1, R7
    LDI compile_lit
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI lit2_save
    MOV R2, R0
    LD R1, R2, 0
    LDI compile_lit
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_2tor:                  ; 2>r ( x1 x2 -- ) ( R: -- x1 x2 )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ w2t_ok
    NOP
    JN w2t_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2t_ok:
    LD R1, SP, 0            ; x2, the top of the data stack
    LD R3, SP, 1            ; x1
    ADD SP, 2
    LDI rp_ptr
    MOV R4, R0
    LD R2, R4, 0            ; RP
    SUB R2, 2
    ST R1, R2, 0            ; [RP] = x2, so 2r> hands it back first
    ST R3, R2, 1            ; [RP+1] = x1
    ST R2, R4, 0            ; RP
    LDI next
    MOV PC, R0
    NOP

word_2rfrom:                ; 2r> ( -- x1 x2 ) ( R: x1 x2 -- )
    LDI rp_ptr
    MOV R4, R0
    LD R2, R4, 0            ; RP
    LDI rp0_base
    MOV R1, R0
    LD R1, R1, 0            ; the base the return stack grows down from
    MOV R3, R2
    ADD R3, 2               ; RP + 2: at the base there are exactly two cells
    CMP R3, R1
    JZ w2f_ok
    NOP
    JN w2f_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2f_ok:
    LD R1, R2, 1            ; x1
    LD R7, R2, 0            ; x2
    ADD R2, 2
    ST R2, R4, 0            ; RP
    SUB SP, 2
    ST R1, SP, 1            ; x1 deeper, as it was
    ST R7, SP, 0            ; x2 on top
    LDI next
    MOV PC, R0
    NOP

word_2rfetch:               ; 2r@ ( -- x1 x2 ) ( R: x1 x2 -- x1 x2 )
    LDI rp_ptr
    MOV R4, R0
    LD R2, R4, 0
    LDI rp0_base
    MOV R1, R0
    LD R1, R1, 0
    MOV R3, R2
    ADD R3, 2
    CMP R3, R1
    JZ w2rf_ok
    NOP
    JN w2rf_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2rf_ok:
    LD R1, R2, 1
    LD R7, R2, 0
    SUB SP, 2
    ST R1, SP, 1
    ST R7, SP, 0
    LDI next
    MOV PC, R0
    NOP

; dless ( R1 = a.hi, R2 = b.hi, R3 = a.lo, R4 = b.lo ) answers R7 = 1 when
; a < b and 0 otherwise. The high cells decide as signed values, with the same
; N/V test the single `<` uses, and only when they are equal do the low cells get
; a say - unsigned, because -2 is 0xFFFF:0xFFFE and -1 is 0xFFFF:0xFFFF. It
; touches neither the data stack nor a register its callers keep, except R7.
dless:
    CMP R1, R2              ; a.hi - b.hi
    JO dl_hi_ovf
    NOP
    JN dl_true              ; no overflow: the sign of the difference is it
    NOP
    JZ dl_low               ; equal highs: the low cells decide
    NOP
    LDI dl_false
    MOV PC, R0
    NOP
dl_hi_ovf:
    JN dl_false             ; the overflow inverted the sign
    NOP
dl_true:
    LDI 1
    MOV R7, R0
    JMP LR
    NOP
dl_false:
    LDI 0
    MOV R7, R0
    JMP LR
    NOP
dl_low:
    CMP R3, R4              ; C is a borrow: a.lo < b.lo unsigned
    JC dl_true
    NOP
    LDI dl_false
    MOV PC, R0
    NOP

; The three comparison words put dless to work. Each loads the four cells,
; calls it, drops or keeps a pair and answers.
word_dmax:                  ; dmax ( d1 d2 -- d )
    MOV R9, SP
    ADD R9, 4
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdmax_ok
    NOP
    JN wdmax_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdmax_ok:
    LD R1, SP, 2            ; a.hi
    LD R2, SP, 0            ; b.hi
    LD R3, SP, 3            ; a.lo
    LD R4, SP, 1            ; b.lo
    LDI dless
    MOV R9, R0
    LINK
    JMP R9
    NOP
    LDI 0
    CMP R7, R0
    JZ wdmax_take_a         ; a is not below b, so a is the larger one
    NOP
    LD R1, SP, 0            ; else b is
    LD R3, SP, 1
    LDI wdmax_store
    MOV PC, R0
    NOP
wdmax_take_a:
    LD R1, SP, 2
    LD R3, SP, 3
wdmax_store:
    ADD SP, 2               ; two cells in, two out: a's slots hold the answer
    ST R1, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP

word_dmin:                  ; dmin ( d1 d2 -- d )
    MOV R9, SP
    ADD R9, 4
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdmin_ok
    NOP
    JN wdmin_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdmin_ok:
    LD R1, SP, 2
    LD R2, SP, 0
    LD R3, SP, 3
    LD R4, SP, 1
    LDI dless
    MOV R9, R0
    LINK
    JMP R9
    NOP
    LDI 0
    CMP R7, R0
    JNZ wdmin_take_a        ; a is below b, so a is the smaller one
    NOP
    LD R1, SP, 0            ; else b is
    LD R3, SP, 1
    LDI wdmin_store
    MOV PC, R0
    NOP
wdmin_take_a:
    LD R1, SP, 2
    LD R3, SP, 3
wdmin_store:
    ADD SP, 2
    ST R1, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP

; print_cells ( R7 = address, R3 = count ) prints one character per cell. R2
; carries the cursor and R3 the count, which is what put_char keeps; LR is parked
; because put_char takes it.
print_cells:
    LDI pcs_lr
    MOV R2, R0
    ST LR, R2, 0
    MOV R2, R7
pc_loop:
    LDI 0
    CMP R3, R0
    JZ pcs_done
    NOP
    LD R1, R2, 0
    LDI put_char
    MOV R4, R0
    MOV R0, R1
    LINK
    JMP R4
    NOP
    ADD R2, 1
    SUB R3, 1
    LDI pc_loop
    MOV PC, R0
    NOP
pcs_done:
    LDI pcs_lr
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

; hold_double: hold the digits of the double on the top of the data stack, in the
; current base, with a minus held last when it is negative - the buffer fills
; backwards, so the minus then reads first. LINK-called, and the data stack is
; left alone: d. and d.r drop the double themselves.
hold_double:
    ; LR is parked: hld_put and hld_step are LINK-called, and LINK takes it.
    LDI hd_lr
    MOV R2, R0
    ST LR, R2, 0
    LDI hd_neg
    MOV R3, R0
    LDI 0
    ST R0, R3, 0            ; no sign yet
    LDI hld_ptr
    MOV R2, R0
    LDI hld_end
    ST R0, R2, 0            ; the cursor starts at the end of the buffer
    LD R1, SP, 0            ; the high cell
    LDI 0
    CMP R1, R0
    JNN hd_digits
    NOP
    LDI hd_neg
    MOV R3, R0
    LDI 1
    ST R0, R3, 0            ; remember the sign: it is held last
    LD R1, SP, 0            ; negative: negate first
    LD R3, SP, 1
    INV R1
    INV R3
    ADD R3, 1
    JC hd_carry
    NOP
    ST R1, SP, 0
    ST R3, SP, 1
    LDI hd_digits
    MOV PC, R0
    NOP
hd_carry:
    ADD R1, 1
    ST R1, SP, 0
    ST R3, SP, 1
hd_digits:
    LDI hld_step
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LD R1, SP, 0
    LD R3, SP, 1
    OR R1, R3
    LDI 0
    CMP R1, R0
    JNZ hd_digits
    NOP
    LDI hd_neg
    MOV R2, R0
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JZ hd_done
    NOP
    LDI '-'                ; held now, so it reads first: the buffer fills
    MOV R4, R0             ; backwards, as `sign` relies on
    LDI hld_put
    MOV R2, R0
    LINK
    JMP R2
    NOP
hd_done:
    LDI hd_lr
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

word_ddot:                  ; d. ( d -- )  print the double and a space
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdd_ok
    NOP
    JN wdd_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdd_ok:
    LDI hold_double
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI hld_ptr
    MOV R2, R0
    LD R7, R2, 0            ; the first character held
    LDI hld_end
    MOV R3, R0
    SUB R3, R7              ; and how many there are
    ADD SP, 2               ; the double goes away
    LDI print_cells
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
    LDI next
    MOV PC, R0
    NOP

word_ddotr:                 ; d.r ( d n -- )  print the double right-aligned
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdr_ok
    NOP
    JN wdr_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdr_ok:
    LD R7, SP, 0            ; the field width
    ADD SP, 1
    LDI hold_double
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI hld_ptr
    MOV R2, R0
    LD R1, R2, 0            ; the first character
    LDI hld_end
    MOV R3, R0
    SUB R3, R1              ; the length
    ADD SP, 2               ; the double goes away
    MOV R2, R7
    SUB R2, R3              ; the padding: width - length
    JC wdr_print            ; carry: the field is narrower, so there is none
    NOP
    LDI 0
    CMP R2, R0
    JZ wdr_print
    NOP
wdr_pad:
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    SUB R2, 1
    LDI 0
    CMP R2, R0
    JNZ wdr_pad
    NOP
wdr_print:
    MOV R7, R1              ; print_cells reads the address in R7
    LDI print_cells
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI next
    MOV PC, R0
    NOP

word_2constant:             ; 2constant ( x1 x2 "name" -- )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ w2c_ok
    NOP
    JN w2c_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
w2c_ok:
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; R2 is the CFA cell and R12 the dictionary pointer
    LD R7, SP, 0            ; x2, the top
    LD R3, SP, 1            ; x1
    ADD SP, 2
    LDI doconst2
    MOV R1, R0
    ST R1, R2, 0            ; CFA = the runtime that pushes both
    ADD R2, 1
    ST R3, R2, 0            ; x1 first, so x2 ends on top
    ADD R2, 1
    ST R7, R2, 0            ; x2
    ADD R2, 1
    ST R2, R12, 0           ; DP
    LDI interpret_loop
    MOV PC, R0
    NOP

word_2variable:             ; 2variable ( "name" -- )
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI dovar
    MOV R1, R0
    ST R1, R2, 0            ; CFA = dovar
    MOV R7, R2
    ADD R7, 1               ; the address dovar will push
    LDI 0
    ST R0, R7, 0            ; the first cell
    ST R0, R7, 1            ; and the second, so 2@ has its pair
    ADD R2, 3               ; past the CFA and both cells
    ST R2, R12, 0           ; DP
    SUB SP, 1
    ST R7, SP, 0            ; leave the address, as `variable` does
    LDI interpret_loop
    MOV PC, R0
    NOP

; =============================================
; Wrapping output at the right edge
; =============================================
; The screen is 80 columns wide and the BIOS putch hard-wraps a character at the
; edge, which splits a long word name or a long `see` line through the border.
; The two printing walks that emit many short tokens - `words` and `see` - break
; at the space before a token instead: when the token plus its separator space
; would not fit, they print CR+LF first and start the token on the next line.
;
; The cursor position is the machine truth, so the column comes from SCR. This
; is the one place the output layer asks the screen where it is; a UART port
; would change this routine alone. CRC 0x1000 is the screen's base (see the
; BIOS), 80 its width.

; wrap_if: R7 is the width of the token about to be printed. If the token plus
; its separator space would pass the right edge, and the cursor is not already
; at the start of a line, print CR+LF. R7 is read and destroyed; nothing else the
; callers carry (R1-R3, R10-R12) is touched - only the registers put_char uses
; as scratch (R0, R4, R7, R9) are, so a walker can hold its place across a call.
wrap_if:
    LDI wif_lr
    ST LR, R0, 0            ; R0 = wif_lr; park LR, which put_char takes
    MOV R9, SCR             ; the cursor, as an offset in the screen
    LDI 0x1000
    MOV R4, R0
    SUB R9, R4              ; offset from the screen's base
    LDI 80
    MOV R4, R0              ; the screen's width
    MOV R0, R9
    DIV R0, R4              ; R0 = row (DIV keeps only the quotient)
    MUL R0, R4
    SUB R9, R0              ; R9 = column
    LDI 0
    CMP R9, R0
    JZ wif_done             ; column 0: the token already starts a line
    NOP
    ADD R9, R7              ; the column, plus the token
    ADD R9, 1               ; plus the space that follows it
    CMP R9, R4              ; 80: does it still fit?
    JN wif_done
    NOP
    JZ wif_done
    NOP
    ; Drop the cursor block before the break walks away from it. A regular putch
    ; sets the cursor attribute on the cell it advanced to; CR and LF only move
    ; SCR, so without this every wrapped line keeps a reversed block at its end
    ; (the same reason ok_after and word_cr clear it first). R4, not R1: see_puts
    ; carries the string pointer in R1 across this call.
    LDS R4, ES, SCR
    LDI ATTR_MASK
    AND R4, R0
    STS R4, ES, SCR
    LDI put_char
    MOV R4, R0
    LDI 13                  ; CR: column 0
    LINK
    JMP R4
    NOP
    LDI put_char
    MOV R4, R0
    LDI 10                  ; LF: next row, scrolling at the bottom
    LINK
    JMP R4
    NOP
wif_done:
    LDI wif_lr
    LD LR, R0, 0            ; R0 = wif_lr again
    JMP LR
    NOP

; number_width: R2 is a magnitude; answers its digit count in the current base in
; R12, for the wrap decision in see_num. It runs on a copy of R2, so the value
; the caller is about to print survives. The unsigned 32-bit division is the one
; print_number uses: the dividend's high half is zero and the dividend's low half
; is the value, so a magnitude above 0x7FFF is not read as negative. The count
; stops at sixteen digits, the same bound the printer and the pictured-number
; words keep, so a base below two cannot run away.
number_width:
    LDI 0
    MOV R12, R0
    LDI 0
    CMP R2, R0
    JNZ nw_div
    NOP
    LDI 1
    MOV R12, R0             ; zero is one digit
    JMP LR
    NOP
nw_div:
    LDI base_var
    LD R4, R0, 0            ; the base in force (R0 = base_var's address)
    MOV R7, R2              ; the running value, so R2 survives
nw_step:
    MOV R1, R7
    LDI 0
    DIV32 R0, R4            ; R0 = quotient, R1 = remainder
    ADD R12, 1
    MOV R7, R0
    LDI 0
    CMP R7, R0
    JZ nw_done
    NOP
    LDI 16
    CMP R12, R0
    JNZ nw_step
    NOP
nw_done:
    JMP LR
    NOP

; udiv: exact UNSIGNED 32÷16. In: R0 = dividend high, R1 = dividend low,
; R12 = divisor (non-zero). Out: R0 = quotient high, R1 = quotient low,
; R4 = remainder. It clobbers R2, R3, R7, R9, R10, R11; every other register the
; callers carry is left alone. Nothing is called, so LR is safe too.
;
; The machine's divider is SIGNED, so it is used only where its operands are
; non-negative. Two cases:
;
;  * Divisor below 0x8000: the answer is two signed DIV32 steps. A zero high
;    half keeps the first dividend positive, and its remainder is below the
;    divisor, so the second dividend's high half is positive too. Both quotients
;    and the final remainder are then the unsigned answer, q = qH*65536 + qL.
;    That covers every real base and gives `#` its full 32-bit quotient.
;
;  * Divisor 0x8000 or more: the divider would read it as negative, so the
;    division is done a bit at a time (restoring, sixteen steps). The remainder
;    is a 16-bit cell; when its top bit is set the shifted value is above
;    0xFFFF and therefore certainly above the divisor, so the subtraction is
;    unconditional and the 0x10000 the shift produced cancels the borrow.
udiv:
    MOV R9, R12
    SL R9, 1                ; C = bit 15 of the divisor
    JC udiv_slow            ; set: 0x8000 or more, the signed divider would
    NOP                     ; read it as negative
    MOV R7, R1              ; hold the low half across the first divide
    MOV R1, R0
    LDI 0                   ; (0 : high) / divisor - a positive 32-bit dividend
    DIV32 R0, R12           ; R0 = quotient high, R1 = remainder
    MOV R3, R0
    MOV R0, R1
    MOV R1, R7
    DIV32 R0, R12           ; (remainder : low) / divisor
    MOV R4, R1              ; the remainder
    MOV R1, R0              ; the quotient low
    MOV R0, R3              ; the quotient high
    JMP LR
    NOP

udiv_slow:
    MOV R7, R0              ; remainder = dividend high
    LDI 0
    MOV R11, R0             ; quotient high = 0
    MOV R3, R1              ; the low half, to be shifted out bit by bit
    CMP R7, R12
    JC udiv_slow_init       ; carry = borrow: remainder < divisor, no subtract
    NOP
    SUB R7, R12
    LDI 1
    MOV R11, R0             ; one whole divisor went in
udiv_slow_init:
    LDI 0
    MOV R10, R0             ; quotient low = 0
    LDI 16
    MOV R9, R0              ; sixteen dividend bits to shift in
udiv_loop:
    MOV R2, R3
    SR R2, 15               ; the next dividend bit
    SL R3, 1
    MOV R0, R7
    SL R0, 1                ; C = the remainder's top bit
    JC udiv_ovf
    NOP
    SL R7, 1
    OR R7, R2
    CMP R7, R12
    JC udiv_nosub           ; carry = borrow: still below the divisor
    NOP
    SUB R7, R12
    SL R10, 1
    ADD R10, 1
    LDI udiv_next
    MOV PC, R0
    NOP
udiv_nosub:
    SL R10, 1
    LDI udiv_next
    MOV PC, R0
    NOP
udiv_ovf:
    SL R7, 1
    OR R7, R2
    SUB R7, R12
    SL R10, 1
    ADD R10, 1
udiv_next:
    SUB R9, 1
    LDI 0
    CMP R9, R0
    JNZ udiv_loop
    NOP
    MOV R4, R7              ; the remainder
    MOV R1, R10             ; the quotient low
    MOV R0, R11             ; the quotient high
    JMP LR
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
    LDI doconst2
    CMP R3, R0
    JZ see_2constant
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

see_2constant:
    LDI see_str_2constant
    MOV R1, R0
    LDI see_head
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; x1 then x2 live in the two cells after the CFA, in the order the runtime
    ; pushes them.
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
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    LDI see_cfa
    MOV R3, R0
    LD R3, R3, 0
    ADD R3, 2
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
; put_char, first measuring it and breaking to the next line if it would cross
; the right edge. It disturbs R0, R4, R7, R9 and R12 (and R5/SCR via the BIOS),
; so a walker can keep its place in R10/R11 across the call; R1-R3 are shadow
; copies and put_char leaves them alone.
see_puts:
    LDI see_lrp
    MOV R3, R0
    ST LR, R3, 0
    ; Measure the string first: the width is what the wrap decision needs. R1 is
    ; walked to the NUL and put back; R12 carries the count.
    LDI 0
    MOV R12, R0
see_puts_measure:
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ see_puts_measured
    NOP
    ADD R1, 1
    ADD R12, 1
    LDI see_puts_measure
    MOV PC, R0
    NOP
see_puts_measured:
    SUB R1, R12             ; back to the first character
    MOV R7, R12
    LDI wrap_if
    MOV R2, R0
    LINK
    JMP R2
    NOP
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
; space print_number adds. The width is the digit count plus the minus, measured
; before anything is printed so the token can be moved to the next line whole.
see_num:
    LDI see_lrs
    MOV R3, R0
    ST LR, R3, 0
    LDI 0
    CMP R2, R0
    JN see_num_neg
    NOP
    LDI number_width
    MOV R3, R0
    LINK
    JMP R3
    NOP
    MOV R7, R12
    LDI wrap_if
    MOV R3, R0
    LINK
    JMP R3
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
    NEG R2
    LDI number_width
    MOV R3, R0
    LINK
    JMP R3
    NOP
    MOV R7, R12
    ADD R7, 1              ; and the minus reads first
    LDI wrap_if
    MOV R3, R0
    LINK
    JMP R3
    NOP
    LDI put_char
    MOV R4, R0
    LDI '-'
    LINK
    JMP R4
    NOP
    LDI print_number       ; -32768 is unrepresentable and stays put, exactly
    MOV R3, R0             ; like "."; print_number then shows it unsigned
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
    JZ sb_miss_there
    NOP
    LDI sb_abort
    MOV PC, R0
    NOP
sb_miss_there:
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
    LDI xt_abortq
    CMP R3, R0
    JZ sb_string_abortq
    NOP
    LDI xt_cqstr
    CMP R3, R0
    JZ sb_string_cq
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
; `c"` stores a counted string, so its LIT pushed the count cell and the
; characters sit one behind it; the rest of the walk is the same.
sb_string_cq:
    LDI see_str_cq
    MOV R7, R0
    LDI sb_string_cq_common
    MOV PC, R0
    NOP
sb_string_cq_common:
    MOV R1, R7
    LDI see_puts
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI see_ptr
    MOV R3, R0
    LD R10, R3, 0
    LD R11, R10, 1
    ADD R11, 1
    LDI sb_string_loop
    MOV PC, R0
    NOP
sb_string_sq:
    LDI see_str_sq
    MOV R7, R0
    LDI sb_string_common
    MOV PC, R0
    NOP
sb_string_abortq:
    LDI see_str_abortq
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
; Tier 3, first batch: the small standard words
; =============================================
; `*/`, `*/MOD`, `CHAR+`, `CHARS`, `ALIGN` and `ALIGNED` are pure compositions of
; words the kernel already has, so their headers carry a threaded body and they
; cost no code. `PAD`, `UNUSED`, `SOURCE-ID`, `.R`, `U.R` and `.(` need a little
; code of their own and live here.
;
; `.R` and `U.R` right-align a number in a field; like `.` and `u.` they add a
; trailing space (they print through print_number). A number wider than the field
; is printed whole - no truncation. On this machine a character is a cell, so
; CHARS, ALIGN and ALIGNED change nothing.

word_pad:                   ; pad ( -- addr )  the transient scratch region
    LDI pad_buf
    MOV R1, R0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_unused:                ; unused ( -- u )  dictionary cells left below 0x4000
    LDI 0x2000              ; 0x4000 has bit 14 set, so LDI cannot hold it;
    SL R0, 1                ; 0x2000 shifted left once is 0x4000
    MOV R1, R0
    LDI dp_var
    MOV R2, R0
    LD R2, R2, 0            ; HERE
    SUB R1, R2
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_udotr:                 ; u.r ( u width -- )  right-aligned, unsigned
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wur_ok
    NOP
    JN wur_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wur_ok:
    LD R3, SP, 0            ; the field width
    LD R2, SP, 1            ; the value
    ADD SP, 2
    LDI number_width
    MOV R10, R0
    LINK
    JMP R10
    NOP
    MOV R1, R3              ; width - digits
    SUB R1, R12
    JC wur_print            ; carry: the field is narrower than the number
    NOP
    LDI 0
    CMP R1, R0
    JZ wur_print
    NOP
wur_pad:
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    SUB R1, 1
    LDI 0
    CMP R1, R0
    JNZ wur_pad
    NOP
wur_print:
    LDI print_number
    MOV R10, R0
    LINK
    JMP R10
    NOP
    LDI next
    MOV PC, R0
    NOP

word_dotr:                  ; .r ( n width -- )  right-aligned, signed
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wnr_ok
    NOP
    JN wnr_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wnr_ok:
    LD R3, SP, 0            ; the field width
    LD R2, SP, 1            ; the value
    ADD SP, 2
    LDI 0
    MOV R11, R0             ; not negative
    LDI 0
    CMP R2, R0
    JNN wnr_count
    NOP
    LDI 1
    MOV R11, R0             ; negative
    NEG R2                  ; the magnitude (-32768 stays put, as everywhere)
wnr_count:
    LDI number_width
    MOV R10, R0
    LINK
    JMP R10
    NOP
    MOV R7, R12             ; the digit count
    LDI 0
    CMP R11, R0
    JZ wnr_pad
    NOP
    ADD R7, 1               ; and the minus
wnr_pad:
    MOV R1, R3
    SUB R1, R7              ; width - count
    JC wnr_sign
    NOP
    LDI 0
    CMP R1, R0
    JZ wnr_sign
    NOP
wnr_pad_loop:
    LDI put_char
    MOV R4, R0
    LDI ' '
    LINK
    JMP R4
    NOP
    SUB R1, 1
    LDI 0
    CMP R1, R0
    JNZ wnr_pad_loop
    NOP
wnr_sign:
    LDI 0
    CMP R11, R0
    JZ wnr_digits
    NOP
    LDI put_char
    MOV R4, R0
    LDI '-'
    LINK
    JMP R4
    NOP
wnr_digits:
    LDI print_number
    MOV R10, R0
    LINK
    JMP R10
    NOP
    LDI next
    MOV PC, R0
    NOP

word_dotparen:              ; .( "ccc<paren>" -- ) IMMEDIATE: print up to the )
    MOV R1, TIB
    ADD R1, >IN
wdp_loop:
    LD R2, R1, 0
    LDI 0
    CMP R2, R0
    JZ wdp_done             ; the line ended first: stop there
    NOP
    LDI ')'
    CMP R2, R0
    JZ wdp_close
    NOP
    LDI put_char
    MOV R4, R0
    MOV R0, R2
    LINK
    JMP R4
    NOP
    ADD R1, 1
    LDI wdp_loop
    MOV PC, R0
    NOP
wdp_close:
    ADD R1, 1               ; step past the ')'
wdp_done:
    MOV R2, R1
    SUB R2, TIB
    MOV >IN, R2             ; leave >IN after the parsed text
    LDI next
    MOV PC, R0
    NOP


; =============================================
; Tier 3, second batch: parsing and conversion
; =============================================
; `>NUMBER`, `FIND`, `WORD`, `PARSE` and `C"`. The strings follow this kernel's
; convention rather than the standard's counted byte: a string is one character
; per cell, terminated by a zero cell - what `count`, `type`, `s"` and `."`
; already use. So `bl word count type` echoes the token and `c" abc" count type`
; prints `abc`; a counted *byte* is not something this machine has anywhere.

word_tonumber:              ; >number ( ud1 c-addr1 u1 -- ud2 c-addr2 u2 )
    MOV R9, SP
    ADD R9, 4
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ tn_ok
    NOP
    JN tn_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
tn_ok:
    LD R11, SP, 0           ; u1
    LD R7, SP, 1            ; c-addr1
    LD R3, SP, 2            ; ud1.lo
    LD R2, SP, 3            ; ud1.hi
    LDI base_var
    MOV R12, R0
    LD R12, R12, 0          ; the base in force
tn_loop:
    LDI 0
    CMP R11, R0
    JZ tn_done              ; nothing left to convert
    NOP
    LD R4, R7, 0            ; the character
    LDI base_digit          ; R10 = value, R9 = is-a-hex-digit (R4 is the input)
    MOV R1, R0
    LINK
    JMP R1
    NOP
    LDI 0
    CMP R9, R0
    JZ tn_done              ; not a digit at all
    NOP
    CMP R10, R12
    JC tn_digit             ; carry = borrow: the digit is below the base
    NOP
    LDI tn_done
    MOV PC, R0
    NOP
tn_digit:
    ; ud = ud*base + digit, in the low 32 bits
    MOV R1, R2              ; keep ud.hi
    MOV R2, R3              ; the low half
    MUL32 R2, R12           ; R2:R3 = low*base
    MOV R0, R1
    MUL32 R0, R12           ; R0:R1 = high*base
    ADD R3, R10             ; the product's low half, plus the digit
    JNC tn_nocarry
    NOP
    ADD R2, 1               ; carry into the middle
tn_nocarry:
    ADD R1, R2              ; the new high half
    MOV R2, R1
    ADD R7, 1
    SUB R11, 1
    LDI tn_loop
    MOV PC, R0
    NOP
tn_done:
    ST R3, SP, 2
    ST R2, SP, 3
    ST R7, SP, 1
    ST R11, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_find:                  ; find ( c-addr -- c-addr 0 | xt 1 | xt -1 )
    MOV R9, SP
    ADD R9, 1
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wf_ok
    NOP
    JN wf_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wf_ok:
    LD R7, SP, 0            ; the counted string, kept for the not-found answer
    LD R11, R7, 0           ; its length: the first cell, as ANS FIND wants
    LDI 0
    MOV R12, R0             ; search-order index
wf_wl:
    LDI search_order
    MOV R2, R0
    ADD R2, R12
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JZ wf_none
    NOP
    LD R10, R2, 0           ; newest header of this wordlist
wf_hdr:
    LDI 0
    CMP R10, R0
    JZ wf_next_wl
    NOP
    LD R2, R10, 1
    LDI 0x00FF
    AND R2, R0              ; the header's name length
    CMP R2, R11
    JNZ wf_next
    NOP
    MOV R3, R7
    ADD R3, 1               ; the counted string's characters
    MOV R1, R10
    ADD R1, 2               ; the header's name
    MOV R9, R11
wf_cmp:
    LDI 0
    CMP R9, R0
    JZ wf_match
    NOP
    LD R2, R3, 0
    LD R4, R1, 0
    CMP R2, R4
    JNZ wf_next
    NOP
    ADD R3, 1
    ADD R1, 1
    SUB R9, 1
    LDI wf_cmp
    MOV PC, R0
    NOP
wf_match:
    MOV R1, R10
    ADD R1, 3
    ADD R1, R11             ; the xt: header + 3 + the name length
    LD R2, R10, 1
    LDI 1
    SL R0, 15               ; 0x8000, the IMMEDIATE bit
    AND R2, R0
    LDI -1
    MOV R4, R0              ; -1: not immediate
    LDI 0
    CMP R2, R0
    JZ wf_push
    NOP
    LDI 1
    MOV R4, R0              ; 1: immediate
wf_push:
    SUB SP, 2
    ST R7, SP, 2
    ST R1, SP, 1
    ST R4, SP, 0
    LDI next
    MOV PC, R0
    NOP
wf_next:
    LD R10, R10, 0
    LDI wf_hdr
    MOV PC, R0
    NOP
wf_next_wl:
    ADD R12, 1
    LDI wf_wl
    MOV PC, R0
    NOP
wf_none:
    SUB SP, 1
    ST R7, SP, 1
    LDI 0
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_parse:                 ; parse ( char -- c-addr u )
    MOV R9, SP
    ADD R9, 1
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wpa_ok
    NOP
    JN wpa_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wpa_ok:
    LD R2, SP, 0            ; the delimiter
    MOV R1, TIB
    ADD R1, >IN
    MOV R7, R1              ; where the text starts
    MOV R3, R1              ; the scanner
wpa_scan:
    LD R4, R3, 0
    LDI 0
    CMP R4, R0
    JZ wpa_eol
    NOP
    CMP R4, R2
    JZ wpa_found
    NOP
    ADD R3, 1
    LDI wpa_scan
    MOV PC, R0
    NOP
wpa_found:
    MOV R1, R3
    SUB R1, R7              ; u
    ADD R3, 1               ; step past the delimiter, for >IN
    LDI wpa_store
    MOV PC, R0
    NOP
wpa_eol:
    MOV R1, R3
    SUB R1, R7
wpa_store:
    MOV R2, R3
    SUB R2, TIB
    MOV >IN, R2
    LDI in_var
    MOV R3, R0
    ST R2, R3, 0            ; mirror for `>IN @`
    ST R7, SP, 0            ; c-addr over the delimiter
    SUB SP, 1
    ST R1, SP, 0            ; u on top
    LDI next
    MOV PC, R0
    NOP

word_word:                  ; word ( char -- c-addr )  text to the delimiter
    MOV R9, SP
    ADD R9, 1
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ ww_ok
    NOP
    JN ww_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
ww_ok:
    LD R2, SP, 0            ; the delimiter
    LDI word_buf
    MOV R11, R0
    ADD R11, 1              ; the characters go behind the count cell
    MOV R1, TIB
    ADD R1, >IN
ww_skip:
    LD R4, R1, 0
    LDI 0
    CMP R4, R0
    JZ ww_empty             ; the line ended: an empty token
    NOP
    CMP R4, R2
    JNZ ww_copy_setup
    NOP
    ADD R1, 1               ; a leading delimiter: skip it
    LDI ww_skip
    MOV PC, R0
    NOP
ww_copy_setup:
    LDI 0
    MOV R9, R0              ; characters copied
ww_copy:
    LD R4, R1, 0
    LDI 0
    CMP R4, R0
    JZ ww_done
    NOP
    CMP R4, R2
    JZ ww_done
    NOP
    LDI 63                  ; word_buf holds 63 characters, behind the count cell
    CMP R9, R0
    JZ ww_skip_store        ; full: keep advancing, do not copy
    NOP
    ST R4, R11, 0
    ADD R11, 1
    ADD R9, 1
ww_skip_store:
    ADD R1, 1
    LDI ww_copy
    MOV PC, R0
    NOP
ww_done:
    LDI 0
    ST R0, R11, 0           ; NUL after the characters
    LDI word_buf
    MOV R3, R0
    ST R9, R3, 0            ; and the count in the first cell
    LD R4, R1, 0
    LDI 0
    CMP R4, R0
    JZ ww_noeol
    NOP
    ADD R1, 1               ; step past the delimiter
ww_noeol:
    MOV R2, R1
    SUB R2, TIB
    MOV >IN, R2
    LDI in_var
    MOV R3, R0
    ST R2, R3, 0            ; mirror for `>IN @`
    LDI word_buf
    ST R0, SP, 0            ; the answer replaces the delimiter
    LDI next
    MOV PC, R0
    NOP
ww_empty:
    LDI word_buf
    MOV R3, R0
    LDI 0
    ST R0, R3, 0            ; the count of an empty token ...
    ST R0, R3, 1            ; ... and its NUL
    LDI word_buf
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_cqstr:                 ; the C" runtime: skip the inline counted string
    LDI ip_ptr
    MOV R2, R0
    LD R7, R2, 0            ; IP = the count cell
    ADD R7, 1               ; past it, on the first character
cw_scan:
    LD R3, R7, 0
    LDI 0
    CMP R3, R0
    JZ cw_done
    NOP
    ADD R7, 1
    LDI cw_scan
    MOV PC, R0
    NOP
cw_done:
    MOV R4, R7
    ADD R4, 1
    ST R4, R2, 0            ; IP past the NUL; the LIT cell left the address
    LDI next
    MOV PC, R0
    NOP

word_cquote:                ; c" "ccc" IMMEDIATE compile-only: an inline string
    LDI state_var
    MOV R2, R0
    LD R1, R2, 0
    LDI 0
    CMP R1, R0
    JNZ cq_compile
    NOP
    LDI -14                 ; -14: interpreting a compile-only word
    MOV R1, R0
    LDI throw_code
    MOV PC, R0
    NOP
cq_compile:
    MOV R1, TIB
    ADD R1, >IN
    LD R2, R1, 0
    LDI ' '                 ; drop one blank, as `s"` does
    CMP R2, R0
    JNZ cq_no_blank
    NOP
    ADD >IN, 1
cq_no_blank:
    LDI dp_var
    MOV R2, R0
    LD R11, R2, 0           ; HERE: LIT, the address, the marker, the counted string
    LDI xt_lit
    MOV R4, R0
    ST R4, R11, 0
    ADD R11, 1
    ADD R11, 1
    ADD R11, 1              ; R11 = the count cell, which is what the LIT pushes
    MOV R7, R11             ; held in R7: R9 as a store base goes through ES
    ST R7, R11, -2          ; the address the LIT will push
    LDI xt_cqstr
    MOV R4, R0
    ST R4, R11, -1          ; the marker, which is the runtime word
    ADD R11, 1              ; the characters go behind the count cell
    LDI copy_string
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; The count is the span the copy filled: R7 + 1 up to the NUL now in R11 - 1.
    MOV R4, R11
    SUB R4, R7
    SUB R4, 2
    ST R4, R7, 0            ; the count in the first cell
    LDI dp_var
    MOV R2, R0
    ST R11, R2, 0           ; publish HERE
    LDI interpret_loop
    MOV PC, R0
    NOP


; =============================================
; Tier 3, third batch: compiler and dictionary
; =============================================
; `COMPILE,`, `[COMPILE]`, `POSTPONE`, `:NONAME` and `MARKER`.
;
; dp_store appends the cell in R1 to the definition being built - the one step
; `COMPILE,` is. `[COMPILE]` parses a name and appends its xt whatever its
; immediacy; `POSTPONE` does the same for an immediate word, and for one that is
; not immediate it appends `LIT <xt> COMPILE,`, so the current definition will
; compile that word when it runs. find_token answers the immediacy in R9 for it.
;
; `:NONAME` builds a definition with **no header at all**: just a CFA cell
; holding docol, so its xt is the cell's own address and nothing can find it by
; name. `MARKER` builds an ordinary header whose runtime puts the dictionary
; pointer and the wordlist head back the way they were before it.

dp_store:                   ; LINK: append the call to the xt in R1
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0
    ST R1, R3, 0
    ADD R3, 1
    ST R3, R2, 0
    JMP LR
    NOP

word_compilecomma:          ; compile, ( xt -- )
    MOV R9, SP
    ADD R9, 1
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wcc_ok
    NOP
    JN wcc_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wcc_ok:
    LD R1, SP, 0
    ADD SP, 1
    LDI dp_store
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI next
    MOV PC, R0
    NOP

word_bracketcompile:        ; [compile] ( "name" -- ) IMMEDIATE
    LDI find_token
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R1, R0
    JZ wbc_unknown
    NOP
    LDI dp_store
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI interpret_loop
    MOV PC, R0
    NOP
wbc_unknown:
    LDI skip_unknown
    MOV PC, R0
    NOP

word_postpone:              ; postpone ( "name" -- ) IMMEDIATE
    LDI find_token
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R1, R0
    JZ wpp_unknown
    NOP
    LDI 0
    CMP R9, R0
    JZ wpp_nonimm
    NOP
    ; immediate: append a call to it, which runs it while compiling
    LDI dp_store
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI interpret_loop
    MOV PC, R0
    NOP
wpp_nonimm:
    ; not immediate: append LIT <xt> COMPILE,
    MOV R7, R1              ; the name's xt
    LDI dp_store
    MOV R2, R0
    LDI xt_lit
    MOV R1, R0              ; the LIT marker cell
    LINK
    JMP R2
    NOP
    LDI dp_store
    MOV R2, R0
    MOV R1, R7
    LINK
    JMP R2
    NOP
    LDI dp_store
    MOV R2, R0
    LDI xt_compilecomma
    LD R1, R0, 0            ; COMPILE,'s own xt
    LINK
    JMP R2
    NOP
    LDI interpret_loop
    MOV PC, R0
    NOP
wpp_unknown:
    LDI skip_unknown
    MOV PC, R0
    NOP

word_noname:                ; :noname ( -- xt )  a definition with no header
    LDI dp_var
    MOV R2, R0
    LD R7, R2, 0            ; the xt is HERE
    LDI docol
    MOV R3, R0
    ST R3, R7, 0            ; the CFA cell, and nothing before it
    LDI current_xt
    MOV R3, R0
    ST R7, R3, 0            ; RECURSE inside it calls this
    MOV R3, R7
    ADD R3, 1
    ST R3, R2, 0            ; DP past the CFA
    LDI state_var
    MOV R3, R0
    LDI 1
    MOV R4, R0
    ST R4, R3, 0            ; STATE = compiling
    SUB SP, 1
    ST R7, SP, 0            ; the xt, before the body is compiled
    LDI interpret_loop
    MOV PC, R0
    NOP

marker_rt:                  ; the runtime of a MARKER: rewind dictionary and head
    LD R2, R10, 1           ; the wordlist head cell to restore
    LD R3, R10, 2           ; the head it had before the marker
    ST R3, R2, 0
    LD R2, R10, 3           ; DP before the marker
    LDI dp_var
    MOV R3, R0
    ST R2, R3, 0
    LDI next
    MOV PC, R0
    NOP

word_marker:                ; marker ( "name" -- )
    ; Snapshot before the header exists, so the runtime can put it all back.
    LDI current
    MOV R2, R0
    LD R2, R2, 0            ; the head cell of the current wordlist
    LDI mk_head_cell
    MOV R3, R0
    ST R2, R3, 0
    LD R2, R2, 0
    LDI mk_old_head
    MOV R3, R0
    ST R2, R3, 0
    LDI dp_var
    MOV R2, R0
    LD R2, R2, 0
    LDI mk_old_dp
    MOV R3, R0
    ST R2, R3, 0
    LDI define_name
    MOV R2, R0
    LINK
    JMP R2
    NOP
    ; R2 = CFA cell address, R12 = &DP
    LDI marker_rt
    MOV R1, R0
    ST R1, R2, 0            ; CFA = the runtime
    ADD R2, 1
    LDI mk_head_cell
    MOV R3, R0
    LD R4, R3, 0
    ST R4, R2, 0            ; [W+1]
    ADD R2, 1
    LDI mk_old_head
    MOV R3, R0
    LD R4, R3, 0
    ST R4, R2, 0            ; [W+2]
    ADD R2, 1
    LDI mk_old_dp
    MOV R3, R0
    LD R4, R3, 0
    ST R4, R2, 0            ; [W+3]
    ADD R2, 1
    ST R2, R12, 0           ; publish HERE
    LDI interpret_loop
    MOV PC, R0
    NOP


; =============================================
; Tier 3, fourth batch: the input source
; =============================================
; `>IN`, `SOURCE`, `REFILL`, `SAVE-INPUT`, `RESTORE-INPUT`, `QUIT` and
; `ENVIRONMENT?`. This kernel's input pointer is the register R5, not a cell,
; so `>IN` is the one place the standard's address is approximated: `in_var` is
; a mirror the tokenizer writes whenever it moves the pointer, so `>IN @` reads
; the live offset, while a store to it is accepted but does not move the parse
; pointer. `SOURCE` measures the line to its NUL; `REFILL` answers false, because
; the line the BIOS read is the only source and a word cannot read another one
; mid-line. `QUIT` empties the return stack, returns to interpretation and ends
; the line, which is the outer interpreter waiting for the next one.

word_in:                    ; >in ( -- addr )
    LDI in_var
    MOV R1, R0
    SUB SP, 1
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_source:                ; source ( -- c-addr u )  the line, and its length
    MOV R1, TIB
    LDI 0
    MOV R3, R0
    MOV R2, R1
src_scan:
    LD R4, R2, 0
    LDI 0
    CMP R4, R0
    JZ src_done
    NOP
    ADD R2, 1
    ADD R3, 1
    LDI src_scan
    MOV PC, R0
    NOP
src_done:
    SUB SP, 2
    ST R1, SP, 1            ; c-addr
    ST R3, SP, 0            ; u
    LDI next
    MOV PC, R0
    NOP

word_refill:                ; refill ( -- flag )
    ; The next line of whatever is being read: a load's buffer, the keyboard, or
    ; nothing at all when the source is a string (`evaluate`), which has no
    ; lines to give.
    LDI inc_state
    MOV R2, R0
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JNZ refill_include
    NOP
    LDI eval_depth
    MOV R2, R0
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JNZ refill_none         ; a string is one line, and it is already here
    NOP
    ; The keyboard is the source. Read the next line into TIB, as the prompt
    ; does, and answer true: an empty line is still a line.
    LDI tib_kbd
    MOV TIB, R0
    MOV R1, TIB             ; BIOS getstr: the buffer is the parameter
    LDI 5
    SWI
    LDI 0
    MOV >IN, R0
    LDI -1
    SUB SP, 1
    ST R0, SP, 0            ; true
    LDI next
    MOV PC, R0
    NOP
refill_include:
    ; Let include_line read the line and answer through its own exits.
    LDI inc_refill
    MOV R2, R0
    LDI 1
    ST R0, R2, 0
    LDI include_line
    MOV PC, R0
    NOP
refill_none:
    SUB SP, 1
    ST R0, SP, 0            ; false
    LDI next
    MOV PC, R0
    NOP

word_saveinput:             ; save-input ( -- >in tib 2 )
    MOV R1, TIB
    MOV R2, >IN
    SUB SP, 3
    ST R1, SP, 2            ; TIB
    ST R2, SP, 1            ; >IN
    LDI 2
    ST R0, SP, 0            ; how many cells follow
    LDI next
    MOV PC, R0
    NOP

word_restoreinput:          ; restore-input ( >in tib 2 -- flag )
    MOV R9, SP
    ADD R9, 1
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ rin_ok
    NOP
    JN rin_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
rin_ok:
    LD R1, SP, 0            ; n
    ADD SP, 1
    LDI 2
    CMP R1, R0
    JNZ rin_bad             ; only this kernel's own format is understood
    NOP
    LD R2, SP, 0            ; >IN
    LD R3, SP, 1            ; TIB
    ADD SP, 2
    MOV >IN, R2
    MOV TIB, R3
    SUB SP, 1
    LDI 0
    ST R0, SP, 0            ; restored
    LDI next
    MOV PC, R0
    NOP
rin_bad:
    SUB SP, 1
    LDI -1
    ST R0, SP, 0            ; could not restore
    LDI next
    MOV PC, R0
    NOP

word_quit:                  ; quit ( -- )  empty the return stack, end the line
    LDI rp0_base
    MOV R2, R0
    LD R2, R2, 0
    LDI rp_ptr
    MOV R3, R0
    ST R2, R3, 0
    LDI state_var
    MOV R3, R0
    LDI 0
    ST R0, R3, 0            ; interpretation state
    LDI line_done
    MOV PC, R0
    NOP

word_environment:           ; environment? ( c-addr u -- false | i*x true )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ env_ok
    NOP
    JN env_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
env_ok:
    LD R7, SP, 1            ; the query string
    LD R11, SP, 0           ; its length
    LDI env_table
    MOV R12, R0
env_next:
    LD R2, R12, 0           ; a name, or 0 at the end of the table
    LDI 0
    CMP R2, R0
    JZ env_none
    NOP
    LD R3, R12, 1
    CMP R3, R11
    JNZ env_skip
    NOP
    MOV R1, R2              ; name cursor
    MOV R4, R7              ; query cursor
    MOV R9, R11
env_cmp:
    LDI 0
    CMP R9, R0
    JZ env_hit
    NOP
    LD R2, R4, 0
    LDI 'a'                 ; fold the query to upper case: the names are upper
    CMP R2, R0
    JN env_folded
    NOP
    LDI 'z'
    CMP R0, R2
    JN env_folded
    NOP
    LDI 32
    SUB R2, R0
env_folded:
    LD R3, R1, 0
    CMP R2, R3
    JNZ env_skip
    NOP
    ADD R4, 1
    ADD R1, 1
    SUB R9, 1
    LDI env_cmp
    MOV PC, R0
    NOP
env_hit:
    LD R2, R12, 2           ; the value, with true above it
    ST R2, SP, 1
    LDI -1
    ST R0, SP, 0
    LDI next
    MOV PC, R0
    NOP
env_skip:
    ADD R12, 3
    LDI env_next
    MOV PC, R0
    NOP
env_none:
    ADD SP, 1
    LDI 0
    ST R0, SP, 0            ; not a query this kernel answers
    LDI next
    MOV PC, R0
    NOP


word_tobody:                ; >body ( xt -- addr )  a CREATE'd word's data field
    MOV R9, SP
    ADD R9, 1
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wtb_ok
    NOP
    JN wtb_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wtb_ok:
    LD R1, SP, 0            ; the xt: the CFA cell address
    ADD R1, 2               ; CREATE reserves one cell for the DOES> pointer
    ST R1, SP, 0
    LDI next
    MOV PC, R0
    NOP

; the number scanner. It sat in the tokenizer's block until the sign handling
; needed room; it is a unit, so it moved whole. The token entry is a stub up
; there that jumps here.
;
; A leading '-' can open a negative number: -5, -1, -FF in hex. The token stays
; a word when what follows the sign is not a digit of the base in force - -rot,
; -, and also -$10 and -0x10, because the sign is not allowed to combine with a
; hex prefix.
scan_number:
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI '-'
    CMP R4, R0
    JNZ scan_unsigned
    NOP
    MOV R10, R3
    ADD R10, 1
    LD R10, R10, 0          ; the character after the sign
    LDI '0'
    CMP R10, R0
    JN scan_sign_letter
    NOP
    LDI '9'
    CMP R0, R10
    JN scan_sign_letter
    NOP
    LDI scan_sign_go
    MOV PC, R0
    NOP
scan_sign_letter:
    ; above base ten a letter is a digit too, so -FF is a number in hex
    LDI base_var
    MOV R2, R0
    LD R2, R2, 0
    LDI 10
    CMP R2, R0
    JZ scan_unsigned         ; base ten or below: the sign opens a word
    NOP
    JN scan_unsigned
    NOP
    MOV R4, R10
    LDI base_digit
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    CMP R9, R0
    JZ scan_unsigned         ; not a hex letter: a word
    NOP
scan_sign_go:
    LDI num_neg
    MOV R2, R0
    LDI 1
    ST R0, R2, 0            ; remember the sign
    ADD >IN, 1              ; the scan starts on the first digit
    LDI number_scan
    MOV PC, R0
    NOP

; The scanner gave up on the token. If a sign had been taken, put >IN back on it
; and forget the sign, so the whole token is looked up as the word it is.
scan_word:
    LDI num_neg
    MOV R2, R0
    LD R4, R2, 0
    LDI 0
    CMP R4, R0
    JZ scan_word_plain
    NOP
    SUB >IN, 1
    LDI 0
    ST R0, R2, 0
scan_word_plain:
    LDI parse_word
    MOV PC, R0
    NOP

scan_unsigned:
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
    JN scan_word             ; base below ten: no letter is a digit
    NOP
    JZ scan_word             ; base ten: only 0-9 are digits
    NOP
    LDI number_scan
    MOV PC, R0
    NOP
number_scan:
    ; The look-ahead cursor. number_scan walks R3 and leaves >IN alone, so a
    ; token that turns out to be a word (2dup, 1+) is still whole for
    ; parse_word; only parse_number commits >IN. R3 is derived here, from the
    ; same TIB + >IN that every other reader uses, so a caller can never hand
    ; the scan a stale start - the loop is a separate label because deriving
    ; R3 there would reset it and never advance.
    MOV R3, TIB
    ADD R3, >IN
number_scan_loop:
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
    JZ scan_word            ; not a digit at all makes it a word
    NOP
    LDI base_var
    MOV R2, R0
    LD R2, R2, 0             ; the current base
    CMP R10, R2
    JN number_scan_next      ; value < base: a digit here
    NOP
    LDI scan_word           ; a digit of some other base makes it a word
    MOV PC, R0
    NOP
number_scan_next:
    ADD R3, 1
    LDI number_scan_loop
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
    ; A leading minus left a sign to apply, and it is cleared for the next one.
    LDI num_neg
    MOV R4, R0
    LD R2, R4, 0
    LDI 0
    CMP R2, R0
    JZ finish_number_plain
    NOP
    NEG R7
    LDI 0
    ST R0, R4, 0
finish_number_plain:
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
    LDI in_var
    MOV R2, R0
    ST >IN, R2, 0         ; mirror the input pointer for `>IN @`
    LDI in_shadow
    MOV R2, R0
    ST >IN, R2, 0         ; and remember it, so a hand store can be told apart
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
    ; A word may have stored a new offset into `>IN`'s cell. in_var follows the
    ; pointer whenever the kernel moves it, so it differs from in_shadow - what
    ; execute_xt left there - only when a word moved the pointer by hand; then
    ; the cell wins and the line is read on from where it was put.
    LDI in_var
    MOV R2, R0
    LD R2, R2, 0
    LDI in_shadow
    MOV R3, R0
    LD R3, R3, 0
    CMP R2, R3
    JZ outer_pointer_kept
    NOP
    MOV >IN, R2
outer_pointer_kept:
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
    LDI in_var
    MOV R3, R0
    ST >IN, R3, 0           ; mirror for `>IN @`
    ; R9 = 1 when the word is immediate, 0 otherwise; POSTPONE reads it.
    LD R4, R7, 1
    LDI 1
    SL R0, 15             ; 0x8000, the IMMEDIATE bit
    AND R4, R0
    LDI 0
    MOV R9, R0
    CMP R4, R0
    JZ ft_ret
    NOP
    LDI 1
    MOV R9, R0
ft_ret:
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
    LDI 0
    MOV R9, R0
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
    MOV R7, R2
    LDI wrap_if           ; break before the name if it will not fit the line
    MOV R4, R0
    LINK
    JMP R4
    NOP
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

; put_char prints the character in R0 through BIOS putch (function 2). The
; character travels in R1, which is where putch reads its parameter; >IN (R5) is
; parked across the call, because R5 is not banked and the handler overwrites it.
; The rest of R0-R3 are banked as well and survive the call, but put_char spends
; R1 itself, so a caller must not expect that one back.
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
    MOV R9, R0            ; the character: R0 is needed to load the cells below
    LDI saved_r1
    MOV R7, R0
    ST R1, R7, 0          ; park the caller's R1: putch reads its parameter from
    MOV R1, R9            ; R1, and the printing routines keep pointers of their
                          ; own there
    LDI saved_in
    MOV R7, R0
    ST >IN, R7, 0         ; park >IN: R5 is not banked, so the handler
                          ; overwrites it. R7 does not have to survive - the
                          ; address is loaded again after the SWI.
    LDI 2                 ; BIOS putch
    SWI
    LDI saved_in
    MOV R7, R0
    LD R7, R7, 0
    MOV >IN, R7           ; >IN back
    LDI saved_r1
    MOV R7, R0
    LD R1, R7, 0          ; and the caller's R1 back
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

word_count:                 ; count ( c-addr -- c-addr+1 u )
    ; The counted string ANS CORE uses: the length in the first cell and the
    ; characters behind it, so `addr count type` prints it. `word` and `c"` build
    ; one; the strings that `s"` answers and `type` eats are the plain
    ; ( c-addr u ) pairs, and this is where one becomes the other.
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wct_under
    NOP
    LD R1, SP, 0            ; c-addr
    LD R2, R1, 0            ; u, from the first cell
    ADD R1, 1               ; the characters themselves
    SUB SP, 1               ; one operand in, two cells out
    ST R2, SP, 0            ; u on top
    ST R1, SP, 1            ; c-addr+1 beneath it
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

; ---------------------------------------------
; Tier 1, sixth batch: pictured numeric output
; ---------------------------------------------
; `<# # #s #> hold sign` build a number in a hold area of their own instead of
; printing it, so a program can format what `type` will write. The number is a
; DOUBLE, two cells with the HIGH half on top - the order `S>D` would leave, and
; the order the standard's own `dup abs 0 <# #s rot sign #>` example assumes.
; `#` divides that double by the CURRENT base (DIV32, so bases above ten and
; magnitudes above 0x7FFF both come out right) and holds the remainder's digit;
; `#s` repeats until the double is zero, at least once; `sign` holds a minus for
; a negative single; `#>` ends the picture and answers ( c-addr u ).
;
; The hold area is a fixed buffer, and the cursor walks DOWN from its end, so
; the characters come out in reading order without anything being reversed. A
; program that holds more characters than the buffer holds sees the extra ones
; dropped: the cursor stops at the bottom instead of writing through whatever
; data follows, the same trade the printer makes for a base below two.

word_lt_hash:               ; <# ( -- )  begin a pictured number
    LDI hld_ptr
    MOV R2, R0
    LDI hld_end
    ST R0, R2, 0            ; the cursor starts at the end of the buffer
    LDI next
    MOV PC, R0
    NOP

word_hash:                  ; # ( ud1 -- ud2 )  one more digit
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wh_ok                ; exactly two cells, or more
    NOP
    JN wh_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wh_ok:
    LDI hld_step
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI next
    MOV PC, R0
    NOP

word_hash_s:                ; #s ( ud1 -- ud0 )  every digit, at least one
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ whs_ok
    NOP
    JN whs_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
whs_ok:
    LDI hld_step
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LD R1, SP, 0            ; high
    LD R3, SP, 1            ; low
    OR R1, R3
    LDI 0
    CMP R1, R0
    JNZ whs_ok              ; another digit while the double is not zero
    NOP
    LDI next
    MOV PC, R0
    NOP

word_hash_gt:               ; #> ( ud -- c-addr u )  the answer, for `type`
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ whg_ok
    NOP
    JN whg_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
whg_ok:
    ; The double goes away and its two cells become ( c-addr u ).
    LDI hld_ptr
    MOV R2, R0
    LD R3, R2, 0            ; the cursor: the first character held
    LDI hld_end
    MOV R4, R0
    SUB R4, R3              ; and the length is everything above it
    ST R3, SP, 1            ; c-addr into the lower of the two cells
    ST R4, SP, 0            ; u on top
    LDI next
    MOV PC, R0
    NOP

word_hold:                  ; hold ( c -- )  one character into the picture
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ whd_under
    NOP
    LD R4, SP, 0
    ADD SP, 1
    LDI 0x00FF
    AND R4, R0              ; one character per cell, low 8 bits
    LDI hld_put
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI next
    MOV PC, R0
    NOP
whd_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_sign:                  ; sign ( n -- )  hold a minus when n is negative
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wsg_under
    NOP
    LD R4, SP, 0
    ADD SP, 1
    LDI 0
    CMP R4, R0
    JN wsg_neg
    NOP
    LDI next
    MOV PC, R0
    NOP
wsg_neg:
    LDI '-'
    MOV R4, R0
    LDI hld_put
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI next
    MOV PC, R0
    NOP
wsg_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; hld_put ( R4 = character ): store it one cell below the cursor and move the
; cursor down. The cursor stops at the bottom of the buffer rather than walking
; out of it. LINK-called, so it uses no register the callers need.
hld_put:
    LDI hld_ptr
    MOV R2, R0
    LD R3, R2, 0
    LDI hld_buf
    MOV R1, R0
    CMP R3, R1
    JZ hld_put_done         ; the buffer is full: drop the character
    NOP
    SUB R3, 1
    ST R3, R2, 0
    ST R4, R3, 0
hld_put_done:
    JMP LR
    NOP

; hld_step: one digit of the picture - the body of `#`, shared with `#s`. It
; reads the double at [SP] (high) and [SP+1] (low), divides it by the current
; base with the exact unsigned udiv (so the whole 32-bit range prints, in any
; base) and holds the remainder's digit. LR is parked while it LINK-calls
; hld_put, because LINK overwrites it.
hld_step:
    LDI hld_lr
    MOV R3, R0
    ST LR, R3, 0
    LDI hld_r7
    MOV R2, R0
    ST R7, R2, 0            ; udiv clobbers R7; `d.r` keeps its field width there
    ; The base has to be in R12 before the dividend is read into R0:R1: LDI
    ; writes R0, and the high half of the dividend lives there.
    LDI base_var
    MOV R12, R0
    LD R12, R12, 0          ; the base
    LDI udiv
    MOV R2, R0
    LD R0, SP, 0            ; the high half of the dividend
    LD R1, SP, 1            ; the low half
    LINK
    JMP R2
    NOP
    ; udiv answers the exact UNSIGNED 32÷16: R0 = quotient high, R1 = quotient
    ; low, R4 = remainder - which is the digit. The new double is the whole
    ; 32-bit quotient, so `#` prints a full unsigned double, not only one below
    ; base*65536.
    ST R0, SP, 0
    ST R1, SP, 1
    LDI 10
    CMP R4, R0
    JN hld_step_dec
    NOP
    LDI 55                  ; 'A' is 65, so the value 10 becomes 'A'
    ADD R4, R0
    LDI hld_step_hold
    MOV PC, R0
    NOP
hld_step_dec:
    LDI '0'
    ADD R4, R0
hld_step_hold:
    LDI hld_put
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI hld_r7
    MOV R2, R0
    LD R7, R2, 0
    LDI hld_lr
    MOV R3, R0
    LD LR, R3, 0
    JMP LR
    NOP

; The hold area. `<#` points the cursor at hld_end and every character is stored
; one cell lower, so the run `#>` answers starts at the cursor and ends at
; hld_end - exactly the shape `type` wants.
hld_ptr:
    .word 0
hld_lr:
    .word 0              ; hld_step's return address across its hld_put call
hld_r7:
    .word 0              ; and the caller's R7, which udiv clobbers
hld_buf:
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    .word 0, 0, 0, 0, 0, 0, 0, 0
hld_end:                    ; one past the last cell of the buffer

; ---------------------------------------------
; Tier 2, first batch: double-cell numbers
; ---------------------------------------------
; A double is two cells with the HIGH half on top, the order `#`/`#>` and the
; standard's own examples already assume. `s>d` widens a single, `m+` adds a
; single to a double, and the rest are the double forms of +, -, negate, = and
; <. The carry flag is what makes them work: ADD sets it on carry-out and SUB on
; borrow, and it has to be read IMMEDIATELY, because LDI clears the whole flag
; nibble and every later instruction would overwrite it.

word_stod:                  ; s>d ( n -- d )  the sign as the high cell
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wsd_under
    NOP
    LD R1, SP, 0            ; n
    LDI 0
    CMP R1, R0
    JN wsd_neg
    NOP
    LDI 0
    MOV R3, R0              ; non-negative: the high cell is zero
    LDI wsd_push
    MOV PC, R0
    NOP
wsd_neg:
    LDI 0
    MOV R3, R0
    SUB R3, 1               ; negative: it is minus one
wsd_push:
    SUB SP, 1
    ST R3, SP, 0
    LDI next
    MOV PC, R0
    NOP
wsd_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_dplus:                 ; d+ ( d1 d2 -- d3 )
    MOV R9, SP
    ADD R9, 4
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdp_ok
    NOP
    JN wdp_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdp_ok:
    LD R1, SP, 3            ; a.lo
    LD R2, SP, 1            ; b.lo
    ADD R1, R2              ; the result's low cell; C = the carry into the high
    LD R3, SP, 2            ; a.hi
    LD R4, SP, 0            ; b.hi
    JC wdp_carry
    NOP
    ADD R3, R4
    LDI wdp_store
    MOV PC, R0
    NOP
wdp_carry:
    ADD R3, R4
    ADD R3, 1
wdp_store:
    ADD SP, 2               ; b's two cells go away, a's slots hold the result
    ST R3, SP, 0
    ST R1, SP, 1
    LDI next
    MOV PC, R0
    NOP

word_dminus:                ; d- ( d1 d2 -- d3 )
    MOV R9, SP
    ADD R9, 4
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdm_ok
    NOP
    JN wdm_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdm_ok:
    LD R1, SP, 3            ; a.lo
    LD R2, SP, 1            ; b.lo
    SUB R1, R2              ; C = the borrow out of the low cell
    LD R3, SP, 2            ; a.hi
    LD R4, SP, 0            ; b.hi
    JC wdm_borrow
    NOP
    SUB R3, R4
    LDI wdm_store
    MOV PC, R0
    NOP
wdm_borrow:
    SUB R3, R4
    SUB R3, 1
wdm_store:
    ADD SP, 2
    ST R3, SP, 0
    ST R1, SP, 1
    LDI next
    MOV PC, R0
    NOP

word_dnegate:               ; dnegate ( d -- -d )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdn_ok
    NOP
    JN wdn_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdn_ok:
    LD R1, SP, 0            ; hi
    INV R1
    LD R3, SP, 1            ; lo
    INV R3
    ADD R3, 1               ; ~lo + 1, and C carries into the high cell
    JC wdn_carry
    NOP
    LDI wdn_store
    MOV PC, R0
    NOP
wdn_carry:
    ADD R1, 1               ; ~hi + 1
wdn_store:
    ST R1, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP
wdn_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_mplus:                 ; m+ ( d1 n -- d2 )  a single added to a double
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wmp_ok
    NOP
    JN wmp_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wmp_ok:
    LD R1, SP, 2            ; d.lo
    LD R2, SP, 0            ; n
    ADD R1, R2              ; the low cell of the sum
    ; The carry has to be caught here: every instruction after this one either
    ; sets or clears the flags.
    JC wmp_carry            ; the carry into the high cell
    NOP
    LDI 0
    MOV R7, R0
    LDI wmp_sign
    MOV PC, R0
    NOP
wmp_carry:
    LDI 1
    MOV R7, R0
wmp_sign:
    LD R3, SP, 1            ; d.hi
    LD R2, SP, 0            ; n again
    LDI 0
    MOV R4, R0              ; the sign cell: zero for n >= 0
    CMP R2, R0
    JN wmp_neg
    NOP
    LDI wmp_add
    MOV PC, R0
    NOP
wmp_neg:
    LDI 0
    MOV R4, R0
    SUB R4, 1               ; minus one
wmp_add:
    ADD R3, R4
    ADD R3, R7              ; the high cell of the sum
    ADD SP, 1               ; n goes away
    ST R3, SP, 0
    ST R1, SP, 1
    LDI next
    MOV PC, R0
    NOP

word_deq:                   ; d= ( d1 d2 -- flag )
    MOV R9, SP
    ADD R9, 4
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wde_ok
    NOP
    JN wde_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wde_ok:
    LD R1, SP, 3
    LD R2, SP, 1
    CMP R1, R2
    JNZ wde_false
    NOP
    LD R1, SP, 2
    LD R2, SP, 0
    CMP R1, R2
    JNZ wde_false
    NOP
wde_true:
    ADD SP, 3
    LDI cmp_true
    MOV PC, R0
    NOP
wde_false:
    ADD SP, 3
    LDI cmp_false
    MOV PC, R0
    NOP

word_d0eq:                  ; d0= ( d -- flag )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdz_ok
    NOP
    JN wdz_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdz_ok:
    LD R1, SP, 0
    LD R2, SP, 1
    OR R1, R2
    LDI 0
    CMP R1, R0
    JZ wdz_true
    NOP
    ADD SP, 1
    LDI cmp_false
    MOV PC, R0
    NOP
wdz_true:
    ADD SP, 1
    LDI cmp_true
    MOV PC, R0
    NOP

word_dlt:                   ; d< ( d1 d2 -- flag )
    MOV R9, SP
    ADD R9, 4
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdl_ok
    NOP
    JN wdl_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdl_ok:
    ; The high cells decide, as signed values, with the same N/V test the single
    ; `<` uses. Only if they are equal do the low cells get a say, and then the
    ; comparison is UNSIGNED: for a negative double the high cell is negative,
    ; so two doubles with equal high cells order like their unsigned low cells
    ; (-2 is 0xFFFF:0xFFFE and -1 is 0xFFFF:0xFFFF).
    LD R1, SP, 2            ; a.hi
    LD R2, SP, 0            ; b.hi
    CMP R1, R2
    JO wdl_hi_ovf
    NOP
    JN wdl_hi_neg
    NOP
    JZ wdl_low
    NOP
    LDI wdl_false           ; a.hi > b.hi
    MOV PC, R0
    NOP
wdl_hi_neg:
    LDI wdl_true            ; a.hi < b.hi
    MOV PC, R0
    NOP
wdl_hi_ovf:
    JN wdl_false            ; the overflow inverted the sign
    NOP
    LDI wdl_true
    MOV PC, R0
    NOP
wdl_low:
    LD R1, SP, 3            ; a.lo
    LD R2, SP, 1            ; b.lo
    CMP R1, R2              ; C = borrow, so C means a.lo < b.lo unsigned
    JC wdl_true
    NOP
    LDI wdl_false
    MOV PC, R0
    NOP
wdl_true:
    ADD SP, 3
    LDI cmp_true
    MOV PC, R0
    NOP
wdl_false:
    ADD SP, 3
    LDI cmp_false
    MOV PC, R0
    NOP

word_umstar:                ; um* ( u1 u2 -- ud )  the unsigned 32-bit product
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wus_ok
    NOP
    JN wus_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wus_ok:
    LD R1, SP, 0            ; u2, on top
    LD R2, SP, 1            ; u1
    MUL32 R2, R1            ; R2:R3 = the product: R2 high, R3 low
    ST R2, SP, 0            ; the high half on top
    ST R3, SP, 1            ; and the low half below
    LDI next
    MOV PC, R0
    NOP

word_mstar:                 ; m* ( n1 n2 -- d )  the signed 32-bit product
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wms_ok
    NOP
    JN wms_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wms_ok:
    ; MUL32 is an unsigned multiply, and the high half of a product DOES depend
    ; on the signs: 3 * -4 is -12, while 3 * 0xFFFC is 0x0002FFF4. An operand
    ; whose top bit is set stands for itself minus 65536, and 65536 times the
    ; other operand lands entirely in the high half - so each negative operand
    ; costs the other one, once.
    LD R1, SP, 0            ; n2
    LD R2, SP, 1            ; n1
    MUL32 R2, R1            ; R2:R3 = the unsigned product
    LD R1, SP, 0            ; n2 again
    LD R4, SP, 1            ; n1 again
    LDI 0
    CMP R4, R0              ; n1 negative?
    JNN wms_n1_pos
    NOP
    SUB R2, R1              ; the high half loses n2
wms_n1_pos:
    LDI 0
    CMP R1, R0              ; n2 negative?
    JNN wms_store
    NOP
    SUB R2, R4              ; the high half loses n1
wms_store:
    ST R2, SP, 0
    ST R3, SP, 1
    LDI next
    MOV PC, R0
    NOP

word_smrem:                 ; sm/rem ( d1 n1 -- n2 n3 )  symmetric division
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wsr_ok
    NOP
    JN wsr_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wsr_ok:
    ; The ISA's division IS symmetric: the quotient is truncated toward zero and
    ; the remainder takes the dividend's sign, which is what sm/rem asks for. The
    ; dividend is the pair R0:R1 (R0 even), high half first.
    LD R0, SP, 1            ; d.hi
    LD R1, SP, 2            ; d.lo
    LD R12, SP, 0           ; n1
    DIV32 R0, R12           ; R0 = quotient, R1 = remainder
    ADD SP, 1               ; n1's cell goes away
    ST R1, SP, 1            ; the remainder below
    ST R0, SP, 0            ; the quotient on top, as the standard's n3
    LDI next
    MOV PC, R0
    NOP

word_fmmod:                 ; fm/mod ( d1 n1 -- n2 n3 )  floored division
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wfm_ok
    NOP
    JN wfm_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wfm_ok:
    LD R0, SP, 1
    LD R1, SP, 2
    LD R12, SP, 0           ; n1, still needed for the correction
    DIV32 R0, R12           ; symmetric first
    MOV R7, R0              ; the quotient
    MOV R3, R1              ; the remainder
    LDI 0
    CMP R3, R0              ; a zero remainder needs no correction
    JZ wfm_store
    NOP
    MOV R4, R3
    XOR R4, R12             ; sign(remainder) xor sign(divisor)
    LDI 0
    CMP R4, R0
    JN wfm_correct          ; the signs differ: floor is one less
    NOP
wfm_store:
    ADD SP, 1
    ST R3, SP, 1            ; the remainder below
    ST R7, SP, 0            ; the quotient on top
    LDI next
    MOV PC, R0
    NOP
wfm_correct:
    SUB R7, 1               ; one from the quotient
    ADD R3, R12             ; and the divisor back onto the remainder
    LDI wfm_store
    MOV PC, R0
    NOP

word_ummod:                 ; um/mod ( ud u1 -- u2 u3 )  unsigned division
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wum_ok
    NOP
    JN wum_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wum_ok:
    ; Exact unsigned 32÷16 through udiv: two signed DIV32 steps for a divisor
    ; below 0x8000, a bit-at-a-time restoring division above it, so a divisor of
    ; 32768 or more is no longer read as negative. The quotient is one cell, as
    ; the standard's u3 is; a quotient that needs more is undefined and its low
    ; cell is what comes out, exactly as before.
    LDI udiv
    MOV R2, R0
    LD R0, SP, 1            ; ud.hi
    LD R1, SP, 2            ; ud.lo
    LD R12, SP, 0           ; u1
    LINK
    JMP R2
    NOP
    ADD SP, 1
    ST R4, SP, 1            ; u2, the remainder
    ST R1, SP, 0            ; u3, the quotient
    LDI next
    MOV PC, R0
    NOP

; ---------------------------------------------
; Tier 2, second batch: case / of / endof / endcase
; ---------------------------------------------
; `case` chooses a clause by comparing a selector with each test value. In Forth
; it is usually spelled out of words the kernel already has - `of` means
; `over = if drop` - and that is exactly what it compiles here, so the runtime
; needs nothing new at all. What it does need is bookkeeping on the compile-time
; return stack: `case` pushes a marker (zero, which is no address) so `endcase`
; knows where its clauses begin, `of` pushes the placeholder its branch is
; patched through, and `endof` is `else` word for word.
;
; case_depth counts the open pairs the way loop_depth counts loops. A stray
; `endcase` would otherwise walk up the compile-time stack patching whatever it
; finds - call frames included - and take the machine down with it; with the
; count it compiles nothing at all. A stray `endof` stays as harmless as a stray
; `then`.

word_case:                  ; case ( -- ) IMMEDIATE
    LDI case_depth
    MOV R2, R0
    LD R1, R2, 0
    ADD R1, 1
    ST R1, R2, 0
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    SUB R7, 1
    ST R7, R4, 0
    LDI 0
    ST R0, R7, 0            ; the marker: no clause branch is pending yet
    LDI interpret_loop
    MOV PC, R0
    NOP

word_of:                    ; of ( -- ) IMMEDIATE  compile: over = if drop
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0            ; HERE
    LDI xt_over
    MOV R4, R0
    LD R4, R4, 0            ; the cell holds `over`'s own xt
    ST R4, R3, 0
    ADD R3, 1
    LDI xt_eq
    MOV R4, R0
    LD R4, R4, 0
    ST R4, R3, 0            ; the selector against the test value
    ADD R3, 1
    LDI xt_0branch
    MOV R4, R0
    ST R4, R3, 0            ; not equal: on to the next clause
    ADD R3, 1
    LDI 0
    ST R0, R3, 0            ; the offset, patched by endof
    MOV R9, R3              ; where endof will find it
    ADD R3, 1
    LDI xt_drop
    MOV R4, R0
    LD R4, R4, 0
    ST R4, R3, 0            ; equal: the selector goes and the body runs
    ADD R3, 1
    ST R3, R2, 0            ; publish HERE
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    SUB R7, 1
    ST R9, R7, 0            ; push the placeholder, as `if` does
    ST R7, R4, 0
    LDI interpret_loop
    MOV PC, R0
    NOP

word_endof:                 ; endof ( -- ) IMMEDIATE  this clause is finished
    ; endof is `else` with another name: it patches the clause's branch to here
    ; and leaves behind the branch that skips the rest of the case. The jump is
    ; a tail call, so nothing of endof's own has to be undone.
    LDI word_else
    MOV PC, R0
    NOP

word_endcase:               ; endcase ( -- ) IMMEDIATE
    LDI case_depth
    MOV R2, R0
    LD R1, R2, 0
    LDI 0
    CMP R1, R0
    JNZ wec_open
    NOP
    LDI interpret_loop      ; no case is open: compile nothing
    MOV PC, R0
    NOP
wec_open:
    SUB R1, 1
    ST R1, R2, 0
    LDI dp_var
    MOV R2, R0
    LD R3, R2, 0            ; HERE
    LDI xt_drop
    MOV R4, R0
    LD R4, R4, 0            ; the cell holds `drop`'s own xt
    ST R4, R3, 0            ; the default path drops the selector
    ADD R3, 1
    ST R3, R2, 0            ; publish HERE
wec_resolve:
    LDI rp_ptr
    MOV R4, R0
    LD R7, R4, 0
    LD R3, R7, 0            ; the top of the compile-time stack
    LDI 0
    CMP R3, R0
    JZ wec_done             ; the marker: everything above it is patched
    NOP
    ; Anything outside the dictionary is not a placeholder - a stale return-stack
    ; cell, say, after a `case` that was never closed. Stop rather than write an
    ; offset into whatever such a value points at. The two bounds are compared
    ; with the CARRY, which is an exact unsigned test: the obvious `LDI 0x4000`
    ; would arrive as 0xC000, because bit 14 of the immediate is its sign.
    LDI dict_free
    MOV R1, R0
    CMP R3, R1
    JC wec_stop             ; below the dictionary
    NOP
    LDI 0x3FFF
    MOV R1, R0
    CMP R1, R3
    JC wec_stop             ; above the dictionary area
    NOP
    ADD R7, 1
    ST R7, R4, 0            ; pop the placeholder
    LDI dp_var              ; and patch it the way `then` does
    MOV R2, R0
    LD R2, R2, 0
    MOV R1, R2
    SUB R1, R3
    ST R1, R3, 0
    LDI wec_resolve
    MOV PC, R0
    NOP
wec_stop:
    LDI interpret_loop      ; leave the stack alone and carry on
    MOV PC, R0
    NOP
wec_done:
    ADD R7, 1
    ST R7, R4, 0            ; pop the marker
    LDI interpret_loop
    MOV PC, R0
    NOP

; ---------------------------------------------
; Tier 2, third batch: strings
; ---------------------------------------------
; A string here is a run of one-character cells, so a character is a cell and
; every step from one character to the next is one address. That is why `cmove`
; is `move` and `blank` is `fill` with a space: the two differ only in a system
; where a cell holds two characters. `cmove>` is the one that really is
; different - it copies from the top down, which is what makes it safe when the
; destination is above the source, the case `move` documents as the caller's
; problem. Comparisons read the CELLS, so the high byte of a character, which
; `type` and `c@` mask away, travels through a copy and is ignored by a
; comparison; and they compare UNSIGNED, which is what the standard asks for.

word_cmove:                 ; cmove ( c-addr1 c-addr2 u -- )
    LDI word_move
    MOV PC, R0
    NOP

word_cmove_gt:              ; cmove> ( c-addr1 c-addr2 u -- )
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wcm_ok
    NOP
    JN wcm_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wcm_ok:
    LD R1, SP, 2            ; the source
    LD R4, SP, 1            ; the destination
    LD R3, SP, 0            ; the count
    ADD SP, 3               ; the operands are read; the copy may land on them
    ADD R1, R3              ; start one past the last character, and step down
    ADD R4, R3
wcm_loop:
    LDI 0
    CMP R3, R0
    JZ wcm_done
    NOP
    SUB R1, 1
    SUB R4, 1
    LD R9, R1, 0
    ST R9, R4, 0
    SUB R3, 1
    LDI wcm_loop
    MOV PC, R0
    NOP
wcm_done:
    LDI next
    MOV PC, R0
    NOP

word_blank:                 ; blank ( c-addr u -- )
    ; A blank is `fill` with a space, so push one and let fill do the work.
    LDI 32
    MOV R3, R0
    SUB SP, 1
    ST R3, SP, 0
    LDI word_fill
    MOV PC, R0
    NOP

word_minustrailing:         ; -trailing ( c-addr u1 -- c-addr u2 )
    MOV R9, SP
    ADD R9, 2
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wdt_ok
    NOP
    JN wdt_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wdt_ok:
    LD R1, SP, 1            ; c-addr
    LD R3, SP, 0            ; u1
wdt_loop:
    LDI 0
    CMP R3, R0
    JZ wdt_done             ; nothing left to look at
    NOP
    MOV R4, R1
    ADD R4, R3
    SUB R4, 1               ; the last character
    LD R9, R4, 0
    LDI 32
    CMP R9, R0
    JNZ wdt_done            ; not a blank: the text ends here
    NOP
    SUB R3, 1
    LDI wdt_loop
    MOV PC, R0
    NOP
wdt_done:
    ST R3, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_slash_string:          ; /string ( c-addr1 u1 n -- c-addr2 u2 )
    MOV R9, SP
    ADD R9, 3
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wstr_ok
    NOP
    JN wstr_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wstr_ok:
    LD R1, SP, 2            ; c-addr1
    LD R3, SP, 1            ; u1
    LD R4, SP, 0            ; n
    ADD R1, R4              ; c-addr2 = c-addr1 + n
    SUB R3, R4              ; u2 = u1 - n
    ADD SP, 1               ; n's cell goes away
    ST R1, SP, 1
    ST R3, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_compare:               ; compare ( c-addr1 u1 c-addr2 u2 -- n )
    MOV R9, SP
    ADD R9, 4
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wcpr_ok
    NOP
    JN wcpr_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wcpr_ok:
    LD R1, SP, 3            ; c-addr1, the first cursor
    LD R3, SP, 2            ; u1
    LD R4, SP, 1            ; c-addr2, the second cursor
    LD R7, SP, 0            ; u2
wcpr_loop:
    LDI 0
    CMP R3, R0
    JZ wcpr_short1          ; the first string ran out
    NOP
    LDI 0
    CMP R7, R0
    JZ wcpr_short2          ; the second ran out
    NOP
    LD R2, R1, 0            ; a character of each
    LD R9, R4, 0
    CMP R2, R9
    JC wcpr_less            ; the carry is a borrow: unsigned, so this is less
    NOP
    JNZ wcpr_greater
    NOP
    ADD R1, 1
    ADD R4, 1
    SUB R3, 1
    SUB R7, 1
    LDI wcpr_loop
    MOV PC, R0
    NOP
wcpr_less:
    LDI 0
    MOV R3, R0
    SUB R3, 1               ; -1
    LDI wcpr_store
    MOV PC, R0
    NOP
wcpr_greater:
    LDI 1
    MOV R3, R0
    LDI wcpr_store
    MOV PC, R0
    NOP
wcpr_short1:
    ; The first string is out of characters, so they are equal so far: it is the
    ; shorter one, unless the second ended with it.
    LDI 0
    CMP R7, R0
    JZ wcpr_equal
    NOP
    LDI 0
    MOV R3, R0
    SUB R3, 1
    LDI wcpr_store
    MOV PC, R0
    NOP
wcpr_short2:
    LDI 1                   ; the second is the shorter one
    MOV R3, R0
    LDI wcpr_store
    MOV PC, R0
    NOP
wcpr_equal:
    LDI 0
    MOV R3, R0
wcpr_store:
    ADD SP, 3               ; four cells in, one out
    ST R3, SP, 0
    LDI next
    MOV PC, R0
    NOP

word_search:                ; search ( c-addr1 u1 c-addr2 u2 -- c-addr3 u3 flag )
    MOV R9, SP
    ADD R9, 4
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP R9, R1
    JZ wsearch_ok
    NOP
    JN wsearch_ok
    NOP
    LDI stack_underflow_error
    MOV PC, R0
    NOP
wsearch_ok:
    LD R11, SP, 3           ; c-addr1, kept for both answers
    LD R3, SP, 2            ; u1, kept for u3
    LD R4, SP, 1            ; c-addr2
    LD R2, SP, 0            ; u2
    MOV R7, R4
    ADD R7, R2              ; the needle's end
    MOV R10, R3
    SUB R10, R2             ; u1 - u2
    JC wsearch_none         ; the needle is longer than the string
    NOP
    ADD R10, R11
    ADD R10, 1              ; one past the last candidate
    MOV R1, R11             ; the first candidate
wsearch_next:
    MOV R12, R1             ; the candidate cursor
    LD R4, SP, 1            ; and the needle cursor, from the stack every time
wsearch_inner:
    CMP R4, R7
    JZ wsearch_found        ; the needle ran out: it matched
    NOP
    LD R2, R4, 0            ; a character of each
    LD R9, R12, 0
    CMP R2, R9
    JNZ wsearch_advance     ; a difference: try the next position
    NOP
    ADD R4, 1
    ADD R12, 1
    LDI wsearch_inner
    MOV PC, R0
    NOP
wsearch_advance:
    ADD R1, 1
    CMP R1, R10
    JNZ wsearch_next
    NOP
wsearch_none:
    ADD SP, 1
    ST R11, SP, 2           ; c-addr1
    ST R3, SP, 1            ; u1
    LDI cmp_false
    MOV PC, R0
    NOP
wsearch_found:
    ADD SP, 1
    ST R1, SP, 2            ; c-addr3: where the match starts
    MOV R2, R3
    SUB R2, R1
    ADD R2, R11             ; u3 = u1 - (c-addr3 - c-addr1)
    ST R2, SP, 1
    LDI cmp_true
    MOV PC, R0
    NOP

; ---------------------------------------------
; Tier 2, fourth batch: exceptions
; ---------------------------------------------
; `catch` runs an xt with a frame on the return stack that records where to carry
; on, how deep the data stack was, and the frame of the catch outside it.
; `throw` finds that frame, cuts the data stack back to the recorded depth,
; unwinds the return stack to the frame and resumes there with the code on top -
; which is why a throw from the bottom of a chain of calls arrives as if the
; calls had returned. Zero is not an exception.
;
; The frame is three cells below the return stack pointer:
;
;     RP+0  the handler that was active before this catch (0 if none was)
;     RP+1  the IP to carry on at: the caller's own thread
;     RP+2  the data stack depth the catch was entered at
;
; The caught xt is entered the way `execute` enters one - W set, IP left alone -
; except that IP first points at a one-cell thread of its own, so the xt's end
; arrives in word_catch_ok rather than in the interpreter. A throw points IP at
; the other thread, word_catch_thrown, which does the same bookkeeping without
; pushing the zero. The xt itself needs to know none of this.

word_catch:                 ; catch ( i*x xt -- j*x 0 | i*x n )
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wca_under            ; the xt itself is missing
    NOP
    LD R7, SP, 0            ; the xt
    ADD SP, 1               ; and the data stack is at the caught depth now
    LDI rp_ptr
    MOV R4, R0
    LD R3, R4, 0            ; RP
    SUB R3, 6
    LDI active_handler
    MOV R2, R0
    LD R1, R2, 0            ; the handler that is active at this moment
    ST R1, R3, 0            ; RP+0
    LDI ip_ptr
    MOV R11, R0             ; NOT R9: an LD/ST through R8 or R9 goes to ES
    LD R1, R11, 0           ; where the caller stands: where the xt returns to
    ST R1, R3, 1            ; RP+1
    ST SP, R3, 2            ; RP+2: the depth a throw cuts back to
    LDI eval_depth
    MOV R2, R0
    LD R1, R2, 0            ; and how deep in an evaluate this catch was
    ST R1, R3, 3            ; RP+3
    ; The INPUT SOURCE comes along too. A throw out of an evaluation has to put
    ; the outer source back, or the interpreter carries on reading the evaluated
    ; text of a line that has already been abandoned.
    ST TIB, R3, 4           ; RP+4
    MOV R1, >IN
    ST R1, R3, 5            ; RP+5
    LDI active_handler
    MOV R2, R0
    ST R3, R2, 0            ; this frame is the innermost handler now
    ST R3, R4, 0            ; RP
    LDI catch_resume_list
    MOV R1, R0
    ST R1, R11, 0           ; IP = the thread that ends the catch
    LD R4, R7, 0            ; the xt's code field
    MOV R10, R7             ; W = the xt, as `execute` leaves it
    MOV PC, R4
    NOP
wca_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

word_catch_ok:              ; the xt came back of its own accord
    LDI catch_end
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    MOV R3, R0
    SUB SP, 1
    ST R3, SP, 0            ; a normal return answers zero
    LDI next
    MOV PC, R0
    NOP

word_catch_thrown:          ; the xt threw: the code is already on the stack
    LDI catch_end
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI next
    MOV PC, R0
    NOP

; catch_end: the bookkeeping both endings share. LINK-called, and it leaves the
; data stack alone so the caller can push what its ending wants.
catch_end:
    LDI rp_ptr
    MOV R4, R0
    LD R3, R4, 0            ; the frame
    LD R1, R3, 0            ; the handler that was active outside this catch
    LD R7, R3, 1            ; the IP to carry on at
    LD R10, R3, 3           ; the evaluate depth it was taken at
    LD R12, R3, 4           ; and the input source it was reading
    LD R11, R3, 5
    LDI active_handler
    MOV R2, R0
    ST R1, R2, 0
    LDI eval_depth
    MOV R2, R0
    ST R10, R2, 0
    MOV TIB, R12
    MOV >IN, R11
    ADD R3, 6
    ST R3, R4, 0            ; pop the frame
    LDI ip_ptr
    MOV R2, R0
    ST R7, R2, 0
    JMP LR
    NOP

word_throw:                 ; throw ( k*x n -- k*x | i*x n )
    LDI sp0_base
    MOV R2, R0
    LD R1, R2, 0
    CMP SP, R1
    JZ wth_under            ; the code itself is missing
    NOP
    LD R1, SP, 0            ; the code
    ADD SP, 1
    LDI throw_code
    MOV PC, R0
    NOP
wth_under:
    LDI stack_underflow_error
    MOV PC, R0
    NOP

; throw_code: R1 = the exception code, with the cell already off the stack. Zero
; is not an exception. With a handler in reach, the data stack is cut back to
; what its catch saw, the return stack is unwound to its frame, and execution
; resumes there with the code on top; with none, the stack is emptied and the
; line is abandoned, which is what `abort` does - but not silently.
throw_code:
    LDI 0
    CMP R1, R0
    JNZ tc_throwing
    NOP
    LDI next                ; 0: nothing happened
    MOV PC, R0
    NOP
tc_throwing:
    LDI throw_code_save
    MOV R2, R0
    ST R1, R2, 0            ; the code, across the lookup below
    LDI active_handler
    MOV R2, R0
    LD R3, R2, 0            ; the innermost frame, or 0
    LDI 0
    CMP R3, R0
    JZ tc_no_handler
    NOP
    LD R4, R3, 2            ; the depth its catch was entered at
    MOV SP, R4
    LDI throw_code_save
    MOV R2, R0
    LD R7, R2, 0
    SUB SP, 1
    ST R7, SP, 0            ; the code, on top of the restored stack
    LDI rp_ptr              ; the return stack ends at the frame
    MOV R4, R0
    ST R3, R4, 0            ; word_catch_thrown pops it
    LDI ip_ptr
    MOV R2, R0
    LDI throw_resume_list
    MOV R1, R0
    ST R1, R2, 0
    LDI next
    MOV PC, R0
    NOP
tc_no_handler:
    LDI sp0_base            ; nothing is watching: empty the data stack
    MOV R2, R0
    LD R1, R2, 0
    MOV SP, R1
    LDI rp0_base            ; and the return stack, frame by frame: the word that
    MOV R2, R0              ; threw is not going to unwind them itself
    LD R1, R2, 0
    LDI rp_ptr
    MOV R2, R0
    ST R1, R2, 0
    LDI state_var
    MOV R2, R0
    LDI 0
    ST R0, R2, 0            ; and leave any definition in progress
    LDI eval_depth
    MOV R2, R0
    LDI 0
    ST R0, R2, 0            ; no evaluation is running any more either
    LDI uncaught_error
    MOV PC, R0
    NOP

word_abort:                 ; abort ( i*x -- ) ( R: j*x -- )  i.e. -1 throw
    LDI 0
    MOV R3, R0
    SUB R3, 1
    SUB SP, 1
    ST R3, SP, 0
    LDI word_throw
    MOV PC, R0
    NOP

; uncaught_error: a throw with no catch anywhere. It reports and hands the line
; back to the reader, the way the stack underflow path does - the same tail,
; because the screen bookkeeping and the fresh prompt are exactly the same.
uncaught_error:
    LDI print_text
    MOV R2, R0
    LDI uncaught_msg
    LINK
    JMP R2
    NOP
    LDI stack_underflow_after
    MOV PC, R0
    NOP

; --- abort" --------------------------------------------------------------
; `abort"` is the exception with a message attached: a non-zero flag prints the
; text and throws -2 (the standard's own code for it); a zero flag throws
; nothing. The text is parsed as a word of its own - `abort"` is an ordinary
; immediate word, not a tokenizer case - so `' abort"` finds it and `see` can
; print it back. One blank delimits the text, as it does for `s"`.

skip_blank:                 ; step >IN over one delimiting blank, if there is one
    MOV R3, TIB
    ADD R3, >IN
    LD R4, R3, 0
    LDI ' '
    CMP R4, R0
    JNZ skb_done
    NOP
    ADD >IN, 1
skb_done:
    JMP LR
    NOP

print_zstring:              ; R7 = the address; print up to the NUL
    ; The cursor lives in R3, not R7: put_char is a BIOS call and only keeps
    ; R1-R3 (which is why word_litstr scans the same way). LR is parked while
    ; put_char runs, because LINK overwrites it and this routine has to return.
    LDI pzs_lr
    MOV R2, R0
    ST LR, R2, 0
    MOV R3, R7
pzs_loop:
    LD R2, R3, 0
    LDI 0
    CMP R2, R0
    JZ pzs_done
    NOP
    LDI put_char
    MOV R4, R0
    MOV R0, R2
    LINK
    JMP R4
    NOP
    ADD R3, 1
    LDI pzs_loop
    MOV PC, R0
    NOP
pzs_done:
    LDI pzs_lr
    MOV R2, R0
    LD LR, R2, 0
    JMP LR
    NOP

word_abortq:                ; abort" ( "<spaces>ccc" -- ) IMMEDIATE
    LDI skip_blank
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI state_var
    MOV R2, R0
    LD R2, R2, 0
    LDI 0
    CMP R2, R0
    JNZ waqc_compile
    NOP
    ; Interpreting: the flag is on the stack and the text is in the line, so
    ; copy it (which undoes \" and steps over the closing quote) and act on it.
    LDI sq_buf
    MOV R11, R0
    LDI copy_string
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LD R3, SP, 0            ; the flag
    ADD SP, 1
    LDI 0
    CMP R3, R0
    JZ waqc_done            ; zero: nothing to report
    NOP
    LDI sq_buf
    MOV R7, R0
    LDI print_zstring
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    MOV R3, R0
    SUB R3, 2               ; -2: ABORT"
    SUB SP, 1
    ST R3, SP, 0
    LDI word_throw
    MOV PC, R0
    NOP
waqc_done:
    LDI interpret_loop
    MOV PC, R0
    NOP
waqc_compile:
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
    LDI xt_abortq
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

word_abortq_rt:             ; ( flag -- ) the runtime
    LD R7, SP, 0            ; the message's address, pushed by the LIT cell
    LD R3, SP, 1            ; the flag
    ADD SP, 2
    LDI 0
    CMP R3, R0
    JZ waqr_skip            ; zero: the message is not printed at all
    NOP
    LDI print_zstring       ; print the message
    MOV R2, R0
    LINK
    JMP R2
    NOP
    LDI 0
    MOV R3, R0
    SUB R3, 2               ; -2: ABORT"
    SUB SP, 1
    ST R3, SP, 0
    LDI word_throw          ; and throw it: the IP is the handler's business
    MOV PC, R0
    NOP
waqr_skip:
    ; Zero: walk the thread over the message, the way litstr does, and carry on.
waqr_scan:
    LD R2, R7, 0
    LDI 0
    CMP R2, R0
    JZ waqr_done
    NOP
    ADD R7, 1
    LDI waqr_scan
    MOV PC, R0
    NOP
waqr_done:
    LDI ip_ptr
    MOV R2, R0
    MOV R4, R7
    ADD R4, 1               ; one past the NUL
    ST R4, R2, 0
    LDI next
    MOV PC, R0
    NOP

; =============================================
; BIOS Implementation. The screen build keeps it at physical 0xF8000; D16MINI
; relocates it into the low window (segment 0x05F0) so the whole machine fits the
; 26K-word BSRAM (the code itself is base-independent: every internal jump is a
; delta or a relative branch).
; =============================================
.equ BIOS_FN_COUNT, 6
.equ BIOS_BASE, bios_entry   ; segment base; see the LDI note at the dispatch
.ifdef CONSOLE_UART
.org 0x5F00
.else
.org 0xF8000
.endif
.code
bios_entry:
    ; Dispatch on the function code in the **caller's** R0 through the table
    ; below. This used to be a chain of CMP/JNZ tests, one per function, so the
    ; block's length depended on how many functions there were and every routine
    ; had to carry its own number.
    ;
    ; The handler runs in the shadow bank, so the caller's registers are the
    ; *inactive* ones and SMV is the only way to reach them (spec 3.3): R0 is the
    ; function number and R1..R3 are its parameters. The answer travels the other
    ; way - the handler leaves it in its own R0 and the caller reads it back with
    ; SMV Rx, AR0, because RETI copies nothing (spec 4.9).
    SMV R1, AR0               ; R1 = function code
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
    ; 0: bver -> the handler's R0 = 0x0001 (version 0.1), which the caller picks
    ; up with SMV Rx, AR0.
    LDI 0x0001
    RETI
    NOP

; =============================================
; UART console BIOS (CONSOLE_UART) - D16MINI.md §7.3
; =============================================
; The serial build of the same six functions, with the same calling convention
; (function number in the caller's R0, parameters in R1..R3, the answer in the
; handler's R0), so nothing above this block changes: only what "the screen" is.
; The port is at ES:0x0040 (status: b0 RX-ready, b1 TX-ready) and ES:0x0042
; (data), the same shape as the keyboard port at 0x0060/0x0062. Nothing here
; touches SCR or the 0xF1000 buffer.
;
; The screen build below is byte-for-byte what it always was - apart from how
; the parameters arrive: with CONSOLE_UART undefined the whole `.ifdef` branch is
; dropped before either pass runs.
.ifdef CONSOLE_UART

; uart_tx: send the byte in R1 (low 8 bits) once the TX FIFO has room. Clobbers
; R0, R3, R7. Entered with LINK, returns via JMP LR. The target is a segment
; offset, not an absolute address, because LDI's immediate is only 15 bits and
; this block lives at 0xF8000.
uart_tx:
    LDI 0x0040
    MOV R3, R0
uart_tx_wait:
    LDS R7, ES, R3
    LDI 2
    AND R7, R0
    JZ uart_tx_wait
    NOP
    LDI 0x00FF
    AND R1, R0
    LDI 0x0042
    MOV R3, R0
    STS R1, ES, R3
    JMP LR
    NOP

bios_f1:
    ; 1: binit -> clear the terminal (ANSI ESC[2J)
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    LDI 27                  ; ESC
    MOV R1, R0
    LDI uart_tx - BIOS_BASE
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI '['
    MOV R1, R0
    LDI uart_tx - BIOS_BASE
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI '2'
    MOV R1, R0
    LDI uart_tx - BIOS_BASE
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI 'J'
    MOV R1, R0
    LDI uart_tx - BIOS_BASE
    MOV R4, R0
    LINK
    JMP R4
    NOP
    RETI
    NOP

bios_f2:
    ; 2: putch (the character arrives in the caller's R1) -> one byte on the
    ; UART. CR, LF and every other byte go out as-is; the host terminal owns
    ; what they do.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    SMV R1, AR1
    LDI uart_tx - BIOS_BASE
    MOV R4, R0
    LINK
    JMP R4
    NOP
    RETI
    NOP

bios_f3:
    ; 3: putstr (the address arrives in the caller's R1, NUL-terminated) ->
    ; bytes on the UART
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    SMV R2, AR1             ; R2 = string address
uart_putstr_loop:
    LD R1, R2, 0
    LDI 0
    CMP R1, R0
    JZ uart_putstr_done
    NOP
    LDI uart_tx - BIOS_BASE
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ADD R2, 1
    CLRZ
    JNZ uart_putstr_loop
    NOP
uart_putstr_done:
    RETI
    NOP

bios_f4:
    ; 4: getch -> the handler's R0 = one byte from the UART
    LDI 0x0FFF
    INV R0
    MVS ES, R0
uart_getch_wait:
    LDI 0x0040
    MOV R2, R0
    LDS R1, ES, R2
    LDI 1
    AND R1, R0
    JZ uart_getch_wait
    NOP
    LDI 0x0042
    MOV R2, R0
    LDS R1, ES, R2
    LDI 0x00FF
    AND R1, R0
    MOV R0, R1              ; the byte is the answer
    RETI
    NOP

bios_f5:
    ; 5: getstr (the buffer address arrives in the caller's R1); echo over the
    ; UART. CR or LF ends the line, BS (0x08) and DEL (0x7F) erase, and the
    ; erase is "BS SP BS" on the wire because the terminal, not this code, owns
    ; the screen.
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    SMV R2, AR1             ; R2 = buffer
    LDI 0
    MOV R11, R0             ; count
uart_getstr_loop:
    LDI 0x0040
    MOV R3, R0
uart_getstr_wait:
    LDS R1, ES, R3
    LDI 1
    AND R1, R0
    JZ uart_getstr_wait
    NOP
    LDI ECHO_FLAG
    LDS R12, ES, R0         ; R12 = echo flag (R0 = 0x64)
    LDI 0x0042
    MOV R3, R0
    LDS R1, ES, R3          ; R1 = the received byte
    LDI 0x00FF
    AND R1, R0
    LDI 10
    CMP R1, R0
    JZ uart_getstr_done
    NOP
    LDI 13
    CMP R1, R0
    JZ uart_getstr_done
    NOP
    LDI 8
    CMP R1, R0
    JZ uart_bs
    NOP
    LDI 0x007F
    CMP R1, R0
    JNZ uart_store
    NOP
uart_bs:
    LDI 0
    CMP R11, R0
    JZ uart_getstr_loop
    NOP
    SUB R11, 1
    SUB R2, 1
    ; Echo off: nothing was drawn, so there is nothing to erase either.
    AND R12, R12
    JZ uart_getstr_loop
    NOP
    LDI 8
    MOV R1, R0
    LDI uart_tx - BIOS_BASE
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI ' '
    MOV R1, R0
    LDI uart_tx - BIOS_BASE
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI 8
    MOV R1, R0
    LDI uart_tx - BIOS_BASE
    MOV R4, R0
    LINK
    JMP R4
    NOP
    CLRZ
    JNZ uart_getstr_loop
    NOP
uart_store:
    LDI TIB_LIMIT
    CMP R11, R0
    JZ uart_getstr_loop      ; full: drop the byte, keep reading
    NOP
    ST R1, R2, 0
    ADD R2, 1
    ADD R11, 1
    AND R12, R12
    JZ uart_getstr_loop
    NOP
    LDI uart_tx - BIOS_BASE
    MOV R4, R0
    LINK
    JMP R4
    NOP
    CLRZ
    JNZ uart_getstr_loop
    NOP
uart_getstr_done:
    LDI 0
    ST R0, R2, 0
    RETI
    NOP

.else

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
    ; 2: putch (the character arrives in the caller's R1) with CR/LF handling
    ; and scroll
    SMV R2, AR1         ; R2 = char
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
    ; 3: putstr (the address arrives in the caller's R1, null-terminated)
    SMV R2, AR1
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
    ; 4: getch -> the handler's R0 = keycode (low byte)
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
    MOV R0, R1              ; the key is the answer
    RETI
    NOP
bios_f5:
    LDI 0x0FFF
    INV R0
    MVS ES, R0
    ; 5: getstr (the buffer address arrives in the caller's R1), echo
    SMV R2, AR1      ; buf
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
.endif

bios_unknown:
    RETI
    NOP
