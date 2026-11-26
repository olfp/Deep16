# Deep16 ISA evaluation

I grounded this in the ISA docs, assembler, and the current kernel sources. My ranking of the three worst "coding tax" features:

| Rank | ISA feature | Symptom in this tree |
|---|---|---|
| 1 | `LDI` writes only `R0` and sign-extends a 15-bit field | Constant generation dominates the code; whole address ranges are unencodable |
| 2 | Segmented memory with manual bank switching and far jumps | Every address is a project-wide coordination problem — the source of the collisions in `MEMLAYOUT.md` |
| 3 | Mandatory one-instruction branch delay slots (and no real `CALL`/`RET`) | Thousands of explicit `NOP`s and subtle return-address bugs |

---

## 1. `LDI`: one destination, 15 sign-extended bits

The ISA says it outright: *"LDI instruction **always** loads R0. To load other registers, use MOV or LSI"* (`doc/Deep16-Arch.md:57`). The 15-bit field is sign-extended from bit 14, so a single `LDI` can produce only `0x0000–0x3FFF` or `0xC000–0xFFFF`; **`0x4000–0xBFFF` is unreachable** (`js/deep16_assembler.js:1385-1397`). `LDI 0x4000` really means `0xC000`, and the assembler deliberately preserves that behaviour (`js/deep16_assembler.js:1355-1376`).

The workarounds are everywhere:

- `LDI x; MOV Rn, R0` — a simple adjacency count finds **~1,631 such pairs** among **3,232 `LDI`s** in `asm/forth_nano.asm`.
- Constants in the unreachable third need bit-setting tricks: `LDI 0x0070; SL R0, 8` for `0x7000`, or `OR R0, 14/15` — the assembler literally prints a recipe in its error message (`js/deep16_assembler.js:1405-1432`).
- Even segment setup needs a trick: `LDI 0x0FFF; INV R0; MVS ES, R0` to get `ES=0xF000` (`doc/Deep16-Prog-Man.md:48-53`); the PSRAM probe uses `LDI PSRAM_BASE_HI; SL R0, 1` (`asm/forth_nano.asm:558-563`).
- The `LWI` mnemonic was added only as a *diagnostic*: it emits one `LDI` when possible and otherwise refuses to assemble (`js/deep16_assembler.js:1416-1432`). It cannot hide the hardware quirk.

**Fix that would matter:** a `MOVI Rd, imm16` (or at least `LDI Rd, imm15` with zero extension) and a real 16-bit immediate form would remove a large fraction of the kernel's instruction count and eliminate an entire class of "wrong high bits" bugs.

## 2. Segments: `phys = (seg << 4) + offset`, switched by hand

Four segment registers, PSW bits selecting `SR`/`ER`/`DE` banks, and no base+index addressing (`doc/Deep16-Arch.md:70`, `:125-134`). Far jumps require an **even register pair**, `CS=R[Rx]`, `PC=R[Rx+1]` (`doc/Deep16-Arch.md:510-512`), which is why the kernel and BDOS reserve `R10:R11` and why callers must park function codes in other registers (`asm/forth_nano.asm:1512-1527`).

Concrete cost in this tree:

- **146 `MVS` segment writes** in `asm/forth_nano.asm` alone.
- Handlers must explicitly re-establish shadow `DS`/`SS` before touching anything (`asm/forth_nano.asm:17340-17345`).
- BIOS code cannot use absolute labels: it is written as `foo - BIOS_BASE` so the same words run at two origins (`asm/softfloat.asm:1-10`). BDOS's jump table does the opposite — absolute `CS=0` addresses — which is exactly why moving it needs relocation (`MEMLAYOUT.md:112-118`).
- Most importantly: there is **no linker**. `.org` rewinds and silently overwrites; one flat image is scattered into three physical windows; the dictionary grows up and the return stack grows down into the same hand-placed blocks. That is the entire collision story in `MEMLAYOUT.md` §3 and the reason `D16NANO=1 D16SEG=1 node scripts/make_image.mjs` currently fails.

**Fix that matters:** not necessarily an ISA change — `MEMFIXPLAN.md`'s thin chapter linker plus one system segment for BIOS/ILL/FloatLib and one for BDOS would remove the collisions. Longer term, a base+offset addressing mode or a 20-bit base register pair would make segment code far less ritualistic.

## 3. Delay slots on every branch, plus a hand-managed link register

Every conditional jump carries a one-instruction delay slot (`doc/Deep16-Arch.md:501-518`); `JMP`, `JML`, `LINK` and `RETI` follow the same rule. A call is `LDI target; MOV Rn,R0; LINK; JMP Rn; NOP`, and the return address is `A+3`, *not* the next instruction — `LINK` = `MOV LR, PC, 2` because a PC source reads own-address+1 (`doc/Deep16-Arch.md:850-870`). `ALINK`/`SMV LR, APC` exists purely to put that special value in the slot (`doc/Deep16-Arch.md:874-895`).

The measured nuisance factor: of **2,167 `NOP` lines** in `asm/forth_nano.asm`, **2,143 immediately follow a control-flow instruction**; `softfloat.asm` adds another 479. The programming manual's advice is simply *"Always fill delay slots"* (`doc/Deep16-Prog-Man.md:904-920`), and the three cores have already disagreed about `MOV Rx,PC` inside a slot (`ARCHREV.md:59`). Nested calls additionally require saving `LR`, which the Forth kernel does manually throughout.

**Fix that matters:** a revised core with no architectural delay slot (assembler inserts padding if a pipeline needs it) would immediately shrink code and remove a whole category of "works on core A, fails on core B" bugs. Short of that, an assembler warning for unfilled slots would help.

---

**Honourable mention:** the shadow bank is asymmetric — only `R0–R3`, `R13`, `R14` are shadowed; `R4–R12` are shared (`README.md:215-217`). Every handler therefore saves the shared registers (`asm/forth_nano.asm:18915`), and the tree has repeated bug fixes for clobbered `R11`, `R9–R12`, `R7`, etc. (`ADVARCH.md:456`, `asm/forth_nano.asm:11163`, `:15897`). If I had to pick a fourth, this would be it; it is effectively part of the calling-convention tax imposed by #2 and #3.

No files were changed; this is an evaluation only.