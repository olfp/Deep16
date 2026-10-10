# Deep16 RTL — Microarchitektur des Verilog-Kerns

Der Kern in `rtl/` ist eine **verhaltensgleiche RTL-Fassung** der beiden
bestehenden Verhaltenskerne. Er ist der dritte Kern des Projekts und läuft
neben `js/deep16_simulator.js` (JS) und `wasm/deep16-wasm` (Rust/WASM) im IDE.

```
rtl/deep16_pkg.sv      Konstanten, PSW-Helfer, Boot-ROM
rtl/deep16_alu.sv      kombinatorische ALU (32 ALU-Ops, NZVC)
rtl/deep16_regfile.sv  16 GPR + Schattenbank (R0-R3, R13, R14)
rtl/deep16_core.sv     5-Stufen-Pipeline: IF / ID / EX / MEM / WB
rtl/deep16_top.sv      Speicher (2^20 Wörter), Boot-ROM, Tastatur-FIFO
rtl/sim/harness.cpp    C-API, spiegelt wasm/deep16-wasm/src/lib.rs
rtl/sim/main_native.cpp CLI für den Differenz-Debug (JSON-Ausgabe)
rtl/pkg/               erzeugtes WASM-Paket (committet, wie wasm/pkg/)
```

## Was der Kern ist — und was noch nicht

**Phase 2 (dieser Stand):** eine 5-Stufen-Pipeline. Ein `step()` ist
weiterhin **ein retireter Befehl**: `i_step` pulst, die Pipeline läuft, bis in
WB ein Befehl eintrifft, `o_result` entspricht dem Rückgabewert von `step()`
in den Verhaltenskernen (0 = Haltwort erreicht). Geradliniger Code braucht
≈ 1,2 Zyklen pro Befehl (der Multi-Zyklus-Kern aus Phase 1 brauchte 3–4).

Noch **nicht** abgeschlossen bzw. enthalten:

* **offen:** in einer SWI-Handler-Sequenz mit zwei aufeinanderfolgenden SWI
  verliert der Kern genau einen Befehl (ein Schritt ohne Retire). Betrifft den
  Forth-REPL-Test und den Sweep mit den Seeds 0–3; Details und Werkzeuge in
  `VERILOG.md`,
* kein Cache (Phase 3) — `FSH` ist wie in den Verhaltenskernen ein No-op,
* die IDE kennt den Kern noch nicht (Phase 4).

Der Kern ist damit eine **fünfte Zyklen-Implementierung** des
Verhaltensmodells, keine Mikroarchitektur. Das ist Absicht: die
Paritätsprüfung ist erst mit einem Kernel abgeschlossen, der sich in jedem
Taktzustand wie das Modell verhält — danach wird Phase 2 auf grüner Basis
gebaut, und jede dortige Abweichung ist ein Hazard-Fehler und kein
Portierungsfehler.

## Die Pipeline im Detail

| Stufe | Arbeit |
|---|---|
| IF | holt über `if_pc` plus aktivem CS der Zustandskette; erkennt Haltwörter (0xFFFF / außerhalb) |
| ID | Dekodierung (rein aus dem Befehlswort); die Pipeline-Register `if_id`/`id_ex` tragen nur Befehl, eigene Adresse, aktiven CS und das Halt-Bit |
| EX | führt aus und berechnet das **komplette Zustandsergebnis** (`d16_ctx_t`: PC, PSW, Segmente, Shadow-Bank, Delay-Zustand) sowie alle Schreib- und Speicheraktionen |
| MEM | liest `mem_rdata` für Loads (Patch in das WB-Register), schreibt Stores, übernimmt den SWI-Vektor |
| WB | committet alles: Zustandsbündel, Register, Speicher, Event, Recent-Access |

Die vier Punkte, an denen die Pipeline der Verhaltensvorlage trotz Vorlauf
rechtlich gleichbleibt:

* **Zustandsbündel statt Einzelregistern.** Jeder Befehl rechnet in EX den
  *kompletten* Zustand nach sich, der aus MEM und WB weitergeleitet wird.
  Dadurch sieht ein Befehl alle älteren Schreibvorgänge und keine jüngeren —
  auch die PSW-Flags, die dadurch nicht mehr vor einem abhängigen `Jcc`
  zurückgeschrieben werden müssen.
* **Der PC bleibt Architekturzustand.** Der Fetch hält keinen eigenen PC,
  sondern folgt dem aktiven PC der Kette. Der Delay-Slot-Apply läuft in EX des
  Slot-Befehls und leitet den nächsten Fetch um — dadurch stimmen auch die
  Eckfälle (Branch im Slot, nicht genommener Branch im Slot, doppelte
  Ausführung am Sprungziel) automatisch.
* **Alles committet in WB.** Registerschreibungen, Stores, Kontextwechsel,
  Event-Log und Recent-Access werden erst beim Retire sichtbar. Ein Commit in
  MEM wäre einen Schritt zu früh — der Decode-Sweep merkt das sofort.
* **Haltwörter werden in EX verworfen**, und der Fetch-PC wird auf das
  Haltwort zurückgesetzt: ein erneut gestarteter Schritt findet es wieder und
  meldet wieder `false`, genau wie die Verhaltenskerne.

Ein Load-Use-Stall friert IF/ID und ID/EX ein und schiebt eine Blase nach MEM —
MEM muss weiterlaufen, sonst erreicht der Load WB nie (Deadlock). Der Fetch
liest `if_rdata` in einem eigenen Block; im selben Block wie der Adressrechner
entstünde eine kombinatorische Schleife (`UNOPTFLAT`).

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
| 0x54/0x55 | Stall-Zähler (Load-Use) |
| 0x56/0x57 | Flush-Zähler (verworfene Fetches) |
| 0x58/0x59 | Zahl der retired Befehle |
| 0x5A–0x5D | Pipeline-Interna: Belegung, EX-Steuersignale, Halt-Bits |
| 0x60/0x61 | Schreibadresse/-wert der MEM-Stufe |
| 0x63/0x64 | eigene Adresse und aktiver CS des Befehls in IF/ID |
| 0x2F | aktuell ausgeführter Befehl |
| 0x30–0x3F | Registerbank in der aktiven Sicht (Shadow, wenn PSW.S=1) |
| 0x3F/0x4F | zuletzt geholte Fetch-Adresse (low/high) |
| 0x50–0x53 | Lauf-/Halt-/Stall-Flag, Delay-Flags, nächste Fetch-Adresse, Tastatur-FIFO-Tiefe |
| 0xC0–0xCF | Boot-ROM-Wörter (der Harness setzt das ROM daraus neu) |

Schreibzugriffe auf diesen Bus sind nur wirksam, wenn die Pipeline stillsteht
(`run = 0`), damit die IDE Zustand spiegeln kann, ohne einen Schritt zu
zerreißen. Solch ein Schreiben leert die Pipeline: die bereits geholten
Befehle gehören zu einem Zustand, den der Aufrufer gerade ersetzt.

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