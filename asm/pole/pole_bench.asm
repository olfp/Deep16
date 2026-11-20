; pole_bench.asm - the benchmark driver for the Pole renderer.
;
; The program fills the state block and then renders FRAMES frames. With
; BENCH_RENDER defined it calls the renderer; without it, it only advances the
; state, so the difference between the two runs is the renderer cost.
;
; The driver never waits for a frame: the core3 bench measures the renderer,
; not the frame timing. A game waits for the frame toggle around this call.
;
; The state handling lives in pole_state.asm, which the on-board driver uses
; as well, so the board measures exactly the same work.

; The state block (shared with pole_render.asm):
.equ ST_FRAMES   0x0520

.org 0x0120
pole_program:
    ; ---- the state ------------------------------------------------------
    LDI pole_state_init
    MOV R4, R0
    LINK
    JMP R4
    NOP

    ; ---- the frame loop -------------------------------------------------
    ; The frame count lives in the image, so the benchmark script can change
    ; it. It is kept in memory, not in a register: the renderer uses every
    ; general-purpose register, so a counter in one would not survive the call.
bench_loop:
    LDI pole_state_advance
    MOV R4, R0
    LINK
    JMP R4
    NOP
    ; the renderer
.ifdef BENCH_RENDER
    LDI pole_dirty_prepare
    MOV R4, R0
    LINK
    JMP R4
    NOP
    LDI pole_render
    MOV R4, R0
    LINK
    JMP R4
    NOP
.endif
    ; the frame counter: decrement it in memory and test it there
    LDI ST_FRAMES
    MOV R2, R0
    LD R3, R2, 0
    SUB R3, 1
    ST R3, R2, 0
    CMP R3, 0
    JNZ bench_loop
    NOP
    HALT

.org 0x0520
bench_frames:
    .word 60
