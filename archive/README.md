# Archived plans and design notes

Plans and design documents that are **finished or superseded**. Nothing here is
a live plan; the current inventory is the "Pläne und Revisionsdokumente im
Repo-Root" section of [`../STATUS.md`](../STATUS.md). Files are kept for their
history and measurements, not because work is still pending.

Moved here 2026-10-30.

| file | was | why archived |
|---|---|---|
| `AUDIOPLAN.md` | on-die sigma-delta sound: register map, analogue side, FIFO vs timer pacing | superseded by `SOFTPCM.md` (I2S) and `ADVARCH.md` §4 (implemented I2S) |
| `DVI720check.md` | 720p DVI bring-up checklist | resolved 2026-10-26; the tile build runs 1280×720@60 |
| `SERPLAN.md` | serial source loader into DeepForth | abandoned and removed from the code; the keyboard button replaced it |
| `PLANPSRAM.md` | PSRAM backing store for the full 2²⁰-word space | implemented; the board boots the kernel from PSRAM |
| `FLASHPLAN.md` | Forth block store on the config flash (MSPI) | storage half superseded by `ADVARCH.md` |
| `ILLTRAP.md` | ILL trap redesign, `SMV ARy, Rx`, `NIO` | implemented in the D16nano core3 and all cores |
| `VERILOG.md` | third core: Verilog → Verilator + Emscripten | core built, selectable in the IDE, tested and in the book; `doc/Deep16-RTL.md` is the living reference |
| `deep16_project_summary.md` | early IDE status document ("PRODUCTION READY") | outdated; see the "State of the project" section of `README.md` |

To revive one, move it back to the repo root and re-add it to the STATUS
inventory; the archive is not built, linked or tested by the current tree.
