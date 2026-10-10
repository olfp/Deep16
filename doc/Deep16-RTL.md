# Deep16 RTL — Microarchitektur des Verilog-Kerns

Der Kern in `rtl/` ist eine **verhaltensgleiche RTL-Fassung** der beiden
bestehenden Verhaltenskerne. Er ist der dritte Kern des Projekts und läuft
neben `js/deep16_simulator.js` (JS) und `wasm/deep16-wasm` (Rust/WASM) im IDE.

```
rtl/deep16_pkg.sv      Konstanten, PSW-Helfer, Boot-ROM
rtl/deep16_alu.sv      kombinatorische ALU (32 ALU-Ops, NZVC)
rtl/deep16_regfile.sv  16 GPR + Schattenbank (R0-R3, R13, R14)
rtl/deep16_core.sv     FSM: IDLE -> FETCH -> INC -> EXEC
rtl/deep16_top.sv      Speicher (2^20 Wörter), Boot-ROM, Tastatur-FIFO
rtl/sim/harness.cpp    C-API, spiegelt wasm/deep16-wasm/src/lib.rs
rtl/sim/main_native.cpp CLI für den Differenz-Debug (JSON-Ausgabe)
rtl/pkg/               erzeugtes WASM-Paket (committet, wie wasm/pkg/)
```

## Was der Kern ist — und was noch nicht

**Phase 1 (dieser Stand):** ein Multi-Zyklus-Controller. Ein `step()` ist
**ein retireter Befehl**: `i_step` pulst, die FSM läuft FETCH → INC → EXEC,
`o_done` meldet den Retire, `o_result` entspricht dem Rückgabewert von
`step()` in den Verhaltenskernen. `get_cycle_count()` zählt die Takte mit.

Noch **nicht** enthalten (bewusst, siehe `VERILOG.md` für den Plan):

* keine 5-Stufen-Pipeline, kein Forwarding, kein Stall/Flush (Phase 2),
* kein Cache (Phase 3) — `FSH` ist wie in den Verhaltenskernen ein No-op,
* die IDE kennt den Kern noch nicht (Phase 4).

Der Kern ist damit eine **fünfte Zyklen-Implementierung** des
Verhaltensmodells, keine Mikroarchitektur. Das ist Absicht: die
Paritätsprüfung ist erst mit einem Kernel abgeschlossen, der sich in jedem
Taktzustand wie das Modell verhält — danach wird Phase 2 auf grüner Basis
gebaut, und jede dortige Abweichung ist ein Hazard-Fehler und kein
Portierungsfehler.

## Die FSM im Detail

| Zustand | Arbeit |
|---|---|
| `S_IDLE` | wartet auf `i_step`; holt den aktiven PC in `pc_fetch`; reaktiviert `running` (wie `step_one()` in Rust und `step()` im JS-Kern) |
| `S_FETCH` | legt die physikalische Adresse auf den Bus, merkt sich den Befehl in `instr`, entscheidet über `halt_word` (0xFFFF im Normal-Fetch) |
| `S_INC` | schreibt das PC-`+1` (Steuerregister bzw. Schatten-PC), löscht `delay_active` im Delay-Slot-Pfad |
| `S_EXEC` | Dekodierung, Ausführung, Write-back, Flag-Berechnung, Branch-Apply |

`S_INC` ist ein eigener Zustand, weil die PC-Erhöhung und der Halt-Entscheid
das *gelesene* Befehlswort brauchen; im selben Takt wie die Adresse, die es
geliefert hat, ergäbe das eine kombinatorische Schleife (Verilator meldet
`UNOPTFLAT`). Dasselbe gilt für den Datenpfad von `LD`/`LDS` und für den
SWI-Vektor: beide lesen `mem_rdata`, ohne den Adressrechner zu beeinflussen
(`rf_da_mux`, `spc_wd_mux`).

## Semantik, die portsensitiv war

Der Kern ist eine wörtliche Portierung von `step()`/`executeInstruction()`
aus `js/deep16_simulator.js`. Die Stellen, an denen das nichttrivial war:

* **Delay-Slot-Zustandsmaschine.** `delay_active`, `delayed_pc/cs`,
  `branch_taken`, `delayed_to_shadow` sind eigene Register. Der Apply erfolgt
  *nach* der Slot-Instruktion und benutzt die danach gültigen Werte — ein
  Sprung im Delay-Slot überschreibt damit den äußeren Transfer, ein *nicht*
  genommener Sprung im Slot verwirft ihn. Genau dieses Verhalten haben die
  Verhaltenskerne (und der Buchabschnitt dazu).
* **Schatten-PC im Delay-Slot.** `pc_fetch` wird beim Eintritt in den
  Fetch-Zustand geholt; der Apply im Slot schreibt in das Bankregister, in
  dem der Slot lief.
* **`SMV APC`** liest `pc0 + 1` (eigene Adresse + 1), weil das PC-Koninkrement
  vor der Ausführung passiert — so wie in beiden Verhaltenskernen.
* **PC-Lesen im Delay-Slot** liefert ebenfalls `own + 1` (Spec 3.3/6.2.2).
* **Flag-Heuristik.** `apply_nzvc()` in `deep16_pkg.sv` bildet
  `updatePSWFlags()` nach: NZ aus den unteren 16 Bit des letzten
  ALU-Ergebnisses, C aus der Schiebe-/Rotate-Tabelle (bei Zähler 0 bleibt C
  stehen) bzw. sonst aus `|last32[31:16]` (das deckt „> 0xFFFF oder < 0"
  ab, inklusive des 17-Bit-Masken-ADD und des exakten Signed-SUB ab).
* **ALU-`lastALUResult`.** Fast alle Operationen melden den Wert, den sie in
  `Rd` schreiben — nicht die Quelle. `MUL32` meldet das 32-Bit-Produkt, ein
  ungerades Ziel meldet `0xFFFFFFFF`, `SUB`/`CMP` melden die exakte
  Differenz (17 Bit, signiert).
* **MUL32/DIV32 schreiben zwei Register.** Dafür hat die Registermdatei
  drei Schreibports mit der Priorität C (PC/Branch-Apply) > A (Rd) > B (Rd+1).
* **Out-of-range-Zugriffe.** `LD`/`ST`/`LDS`/`STS` jenseits von 0xFFFFF werden
  verworfen, ein Fetch dort hält an — und der Recent-Access-Eintrag wird
  trotzdem gesetzt (wie im JS-Kern).
* **Tastatur.** Nur `LDS` auf 0xF0060/0xF0062 sieht die FIFO; ein gewöhnliches
  `LD` auf diese Adressen liest Speicher. FIFO-Tiefe 128, Überlauf verwirft.

## Debug-Bus

Der Harness spricht den Kern über einen schmalen Debug-Bus an (0x00–0x5F),
damit Zustand und Speicher ohne Wellenformviewer lesbar sind:

| Index | Inhalt |
|---|---|
| 0x00–0x0F | Normalregister R0–R15 |
| 0x10–0x14 | PSW, CS, DS, SS, ES (aktiv) |
| 0x15–0x1A | Schatten-PSW, -PC, -CS, -DS, -SS, -ES |
| 0x1B–0x20 | Schattenregister R0'–R3', R13', R14' |
| 0x21 | `{running, delayed_to_shadow, branch_taken, delay_active}` |
| 0x22/0x23 | `delayed_pc` / `delayed_cs` |
| 0x24–0x26 | letztes Event (Code, PC, CS) |
| 0x27–0x2C | Recent-Access (Adresse, Basis, Offset, Segment, Store-Flag) |
| 0x2D/0x2E | Zyklenzähler |
| 0x2F | aktuell ausgeführter Befehl |
| 0x30–0x3F | Registerbank in der aktiven Sicht (Shadow, wenn PSW.S=1) |
| 0x3F/0x4F | zuletzt geholte Fetch-Adresse (low/high) |
| 0x50–0x53 | FSM-Zustand, Schrittfahne, `pc_fetch`, Tastatur-FIFO-Tiefe |
| 0xC0–0xCF | Boot-ROM-Wörter (der Harness setzt das ROM daraus neu) |

Schreibzugriffe auf diesen Bus sind nur im Zustand `S_IDLE` wirksam, damit
die IDE Zustand spiegeln kann, ohne einen Schritt zu zerreißen.

## Bauen

```sh
npm run build:rtl        # nativ: obj_dir/deep16_rtl (CLI)
npm run build:rtl:wasm   # rtl/pkg/deep16_rtl_gen.{js,wasm}
npm run lint:rtl         # Verilator-Lint, Warnungen sind fatal
```

`rtl/pkg/` ist committet (wie `wasm/pkg/`), Tests und IDE laufen also ohne
Build-Schritt. Neu bauen muss man nur nach einer Änderung an `rtl/*.sv` oder
`rtl/sim/*.cpp`.

## Prüfen

```sh
npm test                       # enthält tests/rtl.test.js (dreifache Parität)
npm run sweep:rtl              # alle 65536 Befehlswörter, 4 Seeds, 2 Pfade
npm run trace:rtl -- asm/forth.asm 200000 --keys "1 2 + .
"
```

`scripts/rtl_sweep.mjs` führt **jedes** der 65536 möglichen Befehlswörter je
zweimal aus (Normal-Fetch und Delay-Slot) und vergleicht Register, PSW,
Segmente, Schattenbank, Delay-Zustand und Recent-Access mit dem JS-Kern —
524288 Ausführungen, keine Abweichung. Reservierte Wörter, SYS-Defaults und
die ALU-Ecken werden von keinem Programm ausgeführt; genau deshalb gibt es
den Sweep.

`scripts/rtl_trace.mjs` läuft ein Programm in Lockstep auf beiden Kernen und
meldet die erste retired Instruktion, bei der die Zustände auseinanderlaufen
(inklusive Speicherfenster). Das war beim Forth-Kern die schnellste Spur auf
den echten Fehler: der Branch-Apply im Delay-Slot schrieb den Schatten-PC
nicht, weil die Write-Back-Bedingung genau dann die Ausführung übersprungen
hatte.

## Spec ≠ Verhaltenskern

Der Kern folgt den Verhaltenskernen, nicht dem Spec-Text. Wo die drei
auseinandergehen, ist es in `tests/rtl.test.js` festgenagelt:

| Stelle | JS-Kern | Rust/WASM-Kern | RTL |
|---|---|---|---|
| `LD`/`ST` Offset imm5 | sign-erweitert (−16..+15) | ebenfalls sign-erweitert | wie JS |
| `0xFFFF` im Fetch | Halt | Halt | Halt |
| `0xFFF1` (FSH) | No-op | `exec_sys` setzt `running=false`, `step()` läuft weiter | No-op wie JS |
| `0xFFF8`–`0xFFFE` | kein Befehl (13-Bit-SYS-Präfix) | 12-Bit-Präfix → SWI/RETI/SETI/CLRI | kein Befehl wie JS |
| Fetch außerhalb 2^20 | Halt | Halt | Halt |
| Recent-Access außerhalb 2^20 | wird gesetzt | wird verworfen | wird gesetzt wie JS |
| `get_registers()[15]` | normales R15 | Schatten-PC, wenn PSW.S=1 | Schatten-PC wie Rust |

Arch-Text, der vom Messverhalten abweicht und bewusst *nicht* nachgebaut
wurde: `PA = (seg << 16) | off` (Arch §8.1). Beide Verhaltenskerne rechnen
`(seg << 4) + (off & 0xFFFF)`, und der Kern tut das auch.