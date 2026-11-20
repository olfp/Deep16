# EDITPLAN — native Deep16 text editor (mxedit-derived)

Goal: a **fast, non-Forth** text editor for Deep16/FiT, derived from
mxedit's editing model but stripped of menus and box drawing. It assumes a
single task (all memory available to it) and a BIOS/BDOS layer that can
perform file-like operations.

This document lists the primitives the editor needs from BIOS/BDOS and the
memory/layout contract the editor will use. It is a planning document, not
an implementation.

---

## 1. Assumptions

- **Single task.** No concurrency, no allocator required: the editor owns one
  contiguous memory region and lays out its buffers statically.
- **No menus, no box drawing.** UI is a text area plus one status line.
- **File-like BIOS/BDOS.** Open/read/write/close (and size/seek) exist or
  will be added; the editor does not speak slices, SD sectors or xmodem.
- **Display.** FiT text mode, 80 columns x 22 text rows + 1 status row.
  Cells are word writes at `0xF1000` using mode-1 text cells:
  `0x8000 | (pair << 12) | style | ((ch - 0x20) * 32)`.
- **Input.** Keyboard delivers bytes via the existing PS/2 decoder; arrows and
  Home/End arrive as Emacs control bytes (`^B ^F ^P ^N ^A ^E`).

---

## 2. Editor architecture

- **Buffer model:** one gap buffer in a single segment. Simpler and faster than
  mxedit's linked line list, and avoids dynamic allocation.
- **Cursor:** `(row, col)` in screen coordinates plus a byte offset into the
  buffer's logical text.
- **Viewport:** 22 visible rows; vertical scroll adjusts the top line.
- **Status row (row 23):** file name, `[row,col]`, dirty flag, and short
  messages (load/save/abort).
- **No menus:** commands are control keys (e.g. `^S` save, `^O` open,
  `^Q` quit, `^G` goto, `^F` find).

---

## 3. Memory layout (single segment)

| Range (words) | Purpose |
|---|---|
| `0x0000`–`0x0FFF` | zero page / vectors (not used by editor) |
| `0x1000`–`0x1FFF` | editor code (entry at `0x0100`) |
| `0x2000`–`0x2FFF` | work area: cursor, viewport, file handle, flags |
| `0x3000`–`0x30FF` | file name buffer (256 words) |
| `0x3100`–`0x31FF` | status / prompt buffer (256 words) |
| `0x4000`–`0xBFFF` | gap buffer (~32K words) |
| `0xC000`–`0xFFFF` | spare / stack region |

The gap buffer size is the single tunable; all other regions are fixed.

---

## 4. Required BIOS functions

These already exist in the D16 BIOS (function number in R0, argument in R1,
return via far jump with R10:R11). The editor depends on:

| # | Name | Signature | Use |
|---|---|---|---|
| 0 | `bver` | `() -> R0 = version` | Startup banner / sanity check |
| 1 | `binit` | `() -> void` | Clear screen, home cursor, reset tile state on exit |
| 2 | `putch` | `(ch in R1) -> void` | Status messages, prompts |
| 3 | `putstr` | `(ptr in R2) -> void` | Status line output (NUL-terminated) |
| 4 | `getch` | `() -> R0 = byte` | Blocking key read (main loop) |
| 8 | `kbdinit` (D16D) | `() -> void` | Reset keyboard on startup (tile build) |

**New / desirable BIOS additions:**

| Name | Signature | Why |
|---|---|---|
| `getkey` | `() -> R0 = byte or 0` | Non-blocking poll for a more responsive loop |
| `memfill` | `(ptr, count, value) -> void` | Clearing regions; can be inlined if not provided |
| `memcpy` | `(dst, src, count) -> void` | Gap moves; can be inlined |

---

## 5. Required BDOS / file functions

BDOS today provides read-only access (functions 0–3). The editor needs a
small file-like API. **Implementation strategy:** reuse the existing Forth
slice machinery (`directory`, `lookup`, `load`, `slice-flush`) and reimplement
it inside BDOS, so the editor sees ordinary files while storage stays
slice-backed. A "file name" is therefore a slice directory entry name, and
read/write operate on that slice's 512-word payload.

Proposed new functions, called the same way as BDOS (function in R0, argument
in R1, return in R0/R1):

| # | Name | Signature | Returns | Use |
|---|---|---|---|---|
| 4 | `fopen` | `R1 = name ptr (NUL)` | `R0 = handle or 0xFFFF`, `R1 = size` | Open for read/write |
| 5 | `fclose` | `R1 = handle` | `R0 = 0 or error` | Close |
| 6 | `fread` | `R1 = handle`, `R2 = buf`, `R3 = count` | `R0 = bytes read` | Load file into gap buffer |
| 7 | `fwrite` | `R1 = handle`, `R2 = buf`, `R3 = count` | `R0 = bytes written` | Save gap buffer to file |
| 8 | `fseek` | `R1 = handle`, `R2 = offset` | `R0 = 0 or error` | Random access (optional) |
| 9 | `fsize` | `R1 = handle` | `R0 = size` | Size a file on open |
| 10 | `fcreate` | `R1 = name ptr` | `R0 = handle or 0xFFFF` | Create/truncate for save-as |
| 11 | `fdelete` | `R1 = name ptr` | `R0 = 0 or error` | Optional |

**Minimum viable subset:** `fopen`, `fclose`, `fread`, `fwrite`, `fcreate`.
`fseek`/`fsize`/`fdelete` are nice-to-have.

**Status 2026-11-20.** The write half of the minimum subset is implemented as
BDOS function 7, `fwrite`: `R1` = slice number, `R4` = source offset in the
caller's DS, `bd_count` = cells. It erases the slice's 4 KiB sector and
page-programs the cells, returns the count in `R0`, and refuses a source whose
header has bit 15 set. Forth reaches it as
`slice-write ( src slice u -- r )` (the primitive at `0x4988`, created by the
boot script), and `essentials`' `slice-flush` now saves through it. Reads stay
on function 11 (`read-slice`), which copies the whole 4 KiB slice into the
caller's DS, so a load/save cycle is `read-slice` -> edit -> `fwrite` -> done.
`fcreate` (function 27), `fdelete` (28) and `fsize` (29) followed: `fcreate`
allocates from the top, writes the header and appends the directory entry, so
save-as is `fcreate` then `fwrite`. `fseek` is deliberately absent: the slice
is the unit and read/write take an explicit source offset, not a hidden file
cursor.

**Slice-backed note:** a single slice holds 512 words. For files larger than
one slice, `fread`/`fwrite` should follow the slice chain (continuation
slices, as BDOS function 3 already does for loads) or expose a flat
multi-slice object. The editor's gap buffer is the in-memory view; the
slice chain is the on-disk view.

---

## 6. Editor operations (mxedit-derived, simplified)

- **Navigation:** left/right/up/down, home/end, page up/down.
- **Editing:** insert char, delete (forward/back), enter (split), tab.
- **Buffer ops:** load file -> gap buffer, save gap buffer -> file, dirty flag.
- **Status:** row/col, file name, dirty marker, short messages.

No menus, no search/replace in v1, no syntax highlighting.

---

## 7. Milestones

1. **Skeleton (2 days):** boot, clear screen, gap buffer init, cursor at 0,0,
   status row, key loop echoing printable chars.
2. **Core editing (4 days):** insert/delete/enter/tab, cursor movement,
   viewport scroll, dirty flag.
3. **File I/O (3 days):** open/read into buffer, save buffer to file,
   file name prompt, status messages.
4. **Polish (2 days):** page up/down, home/end, error handling, exit cleanup.

**Estimated total: ~2 weeks** once the BIOS/BDOS file primitives exist.

---

## 8. Dependencies / risks

- The editor is no longer blocked on writing: BDOS function 7 exists and the
  Forth editor saves through it. **Create** (save-as) is the remaining gap.
- Gap buffer size must fit in the chosen build's RAM (screen build: ~1M words;
  D16nano: 24K words — use the screen/IDE build for serious editing).
- FiT text mode is 80x24, not 80x25; the status row consumes the last visible row.

---

## 9. Out of scope (v1)

- Menus, dialogs, box drawing.
- Search/replace.
- Multiple buffers / split views.
- Syntax highlighting.
- Undo beyond a single clipboard region.