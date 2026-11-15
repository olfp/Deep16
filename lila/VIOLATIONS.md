# LILA — DeepForth compatibility violations

This document lists the places where the current LILA implementation leaves the
DeepForth-compatible subset and depends on gforth/ANS extensions or on host-side
assumptions.  The baseline is the word set and machine model documented in
`FORTH.md` for the DeepForth kernel (`asm/forth.asm`, `asm/forth_nano.asm`).

LILA is currently a **host-side prototype**.  These violations are the reasons it
cannot be moved to the D16nano DeepForth kernel unchanged.

## Summary

| # | Violation | Where | DeepForth has it? | Remedy |
|---|-----------|-------|-------------------|--------|
| 1 | Heap allocation via `allocate`/`free` | `gc.fs` (`gc-alloc`, `gc-sweep`) | No (`unused` only) | Replace the GC heap with a fixed arena/bump allocator, or run LILA without GC |
| 2 | Deferred words via `defer`/`is` | `value.fs`, `gc.fs`, `meta.fs`, `compiler.fs` | No | Store XTs in cells and call through `execute`, or inline dispatch |
| 3 | ANS locals `{ ... }` | `compiler.fs` (almost every word) | No | Rewrite the compiler to use explicit frame slots/`>r`/`r>` or named variables |
| 4 | Stack-pointer access `sp@` | `gc.fs` (`gc-scan-stack`), `stdlib.fs` (`lila-pcall-base`) | No | Keep an explicit stack base/depth protocol; scan a registered stack range |
| 5 | 32-bit numbers split across two 16-bit cells | `value.fs`, `stdlib.fs`, `hash.fs` | Partially (double words) | Provide 32-bit helper words on DeepForth, or reduce LILA to 16-bit integers |
| 6 | Far execution tokens as segment+offset pairs | `farxt.fs` (stubbed) | Yes, via `call-far`/`JML` | Implement real far call/return using D16nano's segmented model |
| 7 | Huge static buffers | `compiler.fs` (`body-bufs`, code buffers) | No (24K-word ceiling) | Shrink buffers or compile to an external store; run LILA as a host tool only |
| 8 | gforth `free` shadowing workaround | `lila.fs` captures `' free` before compat include | N/A (host workaround) | Remove the workaround once a DeepForth allocator exists |
| 9 | Hardware-dependent D16nano limits | `forth_nano.asm` | ILL trap covers only `DIV`/`DIV32` | Add software routines for any other 32-bit operations; avoid divide-heavy paths |

## Detailed violations

### 1. Heap allocation (`allocate`, `free`)

- **Location:** `lila/gc.fs` lines 44-55 (`gc-alloc`) and 129-146 (`gc-sweep`); `lila/lila.fs` lines 5-6 (`gc-free`).
- **Problem:** LILA's garbage collector allocates strings, table headers, bucket arrays, frames, closures, and multi values with `allocate throw`.  DeepForth has no `allocate`/`free`; it only exposes `unused` and a fixed dictionary.
- **Remedy:** Replace `allocate` with a fixed arena allocator (or a bump allocator over a reserved region), and replace `gc-free` with arena reset/sweep logic.  Alternatively, run the LILA compiler as a host tool only and ship compiled output.

### 2. Deferred words (`defer`, `is`)

- **Location:** `lila/value.fs` (metamethod hooks), `lila/gc.fs` (GC scanners), `lila/meta.fs`, `lila/compiler.fs` (`vararg-raw?`, compile hooks).
- **Problem:** DeepForth has no `defer` or `is`.  LILA uses deferred words to install metatable operations and GC scanners.
- **Remedy:** Store execution tokens in ordinary cells and invoke them with `execute`, or replace dispatch with `case`/`if` chains.  This removes the need for deferred words entirely.

### 3. ANS locals (`{ ... }`)

- **Location:** `lila/compiler.fs` uses `{ ... }` locals in nearly every definition.
- **Problem:** DeepForth does not implement the ANS locals word set.  The compiler therefore cannot even be loaded on DeepForth.
- **Remedy:** Rewrite the compiler using explicit frame variables, `>r`/`r>` (with careful balancing), or named `variable`s.  This is the largest single porting task.

### 4. Stack-pointer access (`sp@`)

- **Location:** `lila/gc.fs` (`gc-scan-stack`) and `lila/stdlib.fs` (`lila-pcall-base`).
- **Problem:** DeepForth does not expose `sp@` or a data-stack base word.  LILA's conservative GC scans the live data stack through `sp@`.
- **Remedy:** Maintain an explicit stack base pointer and scan only the registered range, or avoid conservative stack scanning by registering all live values as roots.

### 5. 32-bit integers across two 16-bit cells

- **Location:** `lila/value.fs` (`lila-32`, `lila>value-num`, `lila-num>32`), `lila/stdlib.fs`, `lila/hash.fs`.
- **Problem:** DeepForth cells are 16 bits.  LILA's number tag carries a 32-bit value split across two payload cells and depends on 32-bit arithmetic helpers.
- **Remedy:** Implement 32-bit helper words on DeepForth (using the available `m*`, `um/mod`, `fm/mod`, `d+`, etc.), or restrict LILA to 16-bit integers and adjust the tag format.

### 6. Far execution tokens (segment+offset)

- **Location:** `lila/farxt.fs` (`far-execute`, `far-xt`, `far-call`).
- **Problem:** The current implementation ignores the segment (`nip execute`).  DeepForth on D16nano uses segmented memory and real far calls (`call-far`, `JML`).
- **Remedy:** Implement `far-execute` using the D16nano far-call mechanism and ensure return paths restore DS/SS/ES as `callfar_back` does.

### 7. Memory budget and buffer sizes

- **Location:** `lila/compiler.fs` (`body-bufs 64 65536 * allot`, 262144-byte code/defs buffers).
- **Problem:** D16nano's dictionary ceiling is 24K words (or up to `0xFFF0` with PSRAM).  LILA's static buffers alone exceed that budget.
- **Remedy:** Reduce buffer sizes, compile into an external store, or keep LILA as a host-side compiler that emits DeepForth source instead of running on the board.

### 8. gforth `free` capture workaround

- **Location:** `lila/lila.fs` lines 4-6.
- **Problem:** LILA captures `' free` before the compat layer shadows it, because it needs gforth's heap `free`.  This is a host-only workaround.
- **Remedy:** Remove the workaround and use the DeepForth allocator/arena described in remedy 1.

### 9. D16nano-specific limits (division, interrupts, I/O)

- **Location:** `asm/forth_nano.asm` (ILL trap covers only `DIV`/`DIV32`), `HARDWARE.md`, `D16MINI.md`.
- **Problem:** LILA's 32-bit arithmetic and GC may exercise division and memory patterns that the D16nano core does not support directly.  The ILL trap is narrow and only exists on `core3`.
- **Remedy:** Audit all LILA arithmetic for division usage and provide software routines where needed; test on the JS/WASM/RTL cores with the `d16nano` flag enabled.

## Notes

- Many LILA words (`value`, `to`, `evaluate`, `included`, `catch`, `throw`, `move`, `allot`, `create`, `variable`, `constant`, control-flow words) **are** available in DeepForth and are not violations.
- The violations above are about **portability to DeepForth**, not about correctness of the gforth prototype.  The host prototype can continue to use gforth extensions as long as it is not expected to run on D16nano.