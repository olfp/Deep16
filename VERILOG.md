# VERILOG.md — Deep16 in Verilog: dritter Kern via Verilator + Emscripten

## Ziel

Ein dritter CPU-Kern für Deep16 als echtes RTL (SystemVerilog-Subset), das
nicht nur das Behavioural-Modell abbildet, sondern die in
`doc/Deep16-Arch.md` spezifizierte Mikroarchitektur: 5-Stufen-Pipeline mit
Forwarding/Hazards (§7) und 4KB-Unified-Cache (§7.4). Verilator erzeugt C++
daraus, Emscripten kompiliert es zu WASM — der Kern läuft dann im IDE neben
dem JS-Core und dem Rust/WASM-Core.

## Getroffene Entscheidungen (2026-10-08)

1. **Stufenweise Vorgehen:** erst einfacher (multizyklischer) Core mit
   vollständiger ISA und Retire-Parität, dann Pipeline-Umbau, dann Cache.
   Jede Stufe endet grün in `npm test`.
2. **`step()` = ein retireter Befehl** (Taktzyklen bis zum nächsten Retire,
   mit Cap). Bestehende Testassertions und Single-Step-UI laufen unverändert
   weiter; Zyklen/CPI/Cache-Statistiken kommen als *zusätzliche* Exporte
   (`get_cycle_count()` etc.) obendrauf.
3. **Umfang der ersten Runde:** RTL + Tests + IDE-Integration + Doku.
4. **Speicher innen im RTL:** `reg [15:0] mem [0:1048575]` im Top-Modul,
   MMIO-Decode on-chip (entspricht künftigem FPGA-Build, macht
   `get_memory_slice` trivial). Traces via `/*verilator public*/`-Signale,
   nicht über externe Speichermodelle.

## Stand

**Phase 0 und Phase 1 sind abgeschlossen** (Details in `doc/Deep16-RTL.md`):

* Phase 0: Verilator 5.032 + Emscripten 3.1.69, natives und WASM-Build
  laufen. Zwei Stolpersteine, die der Spike gefangen hat: das wasm32-Target
  braucht `-DVL_IGNORE_UNKNOWN_ARCH`, und `verilated_threads.cpp` muss
  dazukompiliert werden, sonst fehlt `VlThreadPool`.
* Phase 1: `rtl/` mit pkg/alu/regfile/core/top, C++-Harness, CLI,
  Build-Skripten, committetem `rtl/pkg/`, dreifacher Parität in
  `tests/rtl.test.js` (20 Tests) und dem Decode-Sweep über alle 65536
  Befehlswörter (524288 Ausführungen, 0 Abweichungen).

**Phase 2 ist abgeschlossen.** `rtl/deep16_core.sv`
ist jetzt eine 5-Stufen-Pipeline (IF/ID/EX/MEM/WB) mit

* Zustandsbündel `d16_ctx_t` (PC, PSW, Segmente, Shadow-Bank, Delay-Zustand),
  das in EX berechnet und aus MEM/WB in EX weitergeleitet wird — damit sieht
  jeder Befehl exakt den Zustand aller älteren Befehle;
* GPR-Bypass EX/MEM und WB inklusive Bank-Prüfung, Load-Use-Stall mit Blase in
  MEM (ein Freezing von MEM wäre ein Deadlock gewesen);
* PC als Architekturzustand: der Fetch folgt dem aktiven PC der Zustandskette,
  der Delay-Slot-Apply findet in EX statt und leitet den Fetch um;
* Stores, Register, Kontext, Event- und Recent-Access-Commit **alle in WB** —
  ein Commit in MEM wäre einen Schritt zu früh sichtbar;
* Exporte `get_stall_count()`, `get_flush_count()`, `get_instr_count()`.

Stand der Verifikation: **226 von 226 Tests grün**, darunter die komplette
dreifache Parität, der Decode-Sweep im Test (131072 Fälle), die
Beispielprogramme und der Forth-REPL. CPI in geradlinigem Code ≈ 1,2
Zyklen/Befehl (vorher 3–4).

Zwei Kernfehler aus Phase 2 sind gefunden und behoben:

1. **Bypass im Schattenkontext.** `fwd_val()` wählte den Schatten-Tap für
   *jeden* Index, sobald PSW.S=1. Banked sind aber nur R0–R3, R13, R14 —
   jeder Leseport auf R4–R12 lieferte im Handler `shad[idx[2:0]]`. Das war
   außerhalb von Handlern unsichtbar und brach jedes Programm, das einen
   benutzt (der Forth-Keyhandler ist einer).
2. **Tastatur-Pop über die Schrittgrenze.** `kbd_pop` ist die einzige
   Nebenwirkung, die nicht in WB committet (siehe unten), und war an
   `id_ex` allein gekoppelt. Zwischen zwei `step()` hält `step_done` ID/EX —
   der gehaltene `LDS KBD_DATA` poppte erneut und verbrauchte die ganze
   Warteschlange. Jetzt `run && !step_done && !stall`.

Beide sind als Regressionstests in `tests/rtl.test.js` festgenagelt.

`scripts/rtl_sweep.mjs` hatte zusätzlich zwei eigene Fehler, die es unmöglich
machten, die Abweichungen zu sehen: der Schatten-Seed steuerte den aktiven
(shadow) PC nicht auf das Testwort, sodass Seed 3 nur Haltworte ausführte, und
das `at`-Feld las 0x2F *nach* dem Schritt (das ist der nächste Befehl). Nach
der Korrektur sind die Seeds 0–2 (393216 Wortausführungen) fehlerfrei.

**Sweep-Abgleich abgeschlossen — alle vier Seeds fehlerfrei.** Die previously
als „3724 + 7895 Wörter im Schattenkontext" gemeldete Abweichung hatte zwei
Ursachen, keine davon in der Ausführungslogik des Schattenpfads:

1. **Der Seed selbst war unsymmetrisch.** `set_registers()` im Harness legt
   Index 15 auf den *aktiven* PC — im Schatten-Seed also auf den Schatten-PC.
   Der Normalbank-PC blieb 0, während der JS-Seed beide setzt. Da
   PC-relative Adressierung im Schattenkontext den Normalbank-PC liest, lud
   jedes PC-relative `LD` aus Adresse 0. `rtlSeed()` setzt 0x0F jetzt explizit.
2. ** Echter RTL-Fehler im Debug-Fenster.** Das Schatten-Fenster ist als
   0x1B–0x20 dokumentiert (R0'–R3', R13', R14'), die Verriegelung prüfte aber
   nur `dbg_idx[3:0] >= 0xB` — das endet bei 0x1F, weil 0x20 `[7:4] == 2` hat.
   Schatten-**R14'** war über den Debug-Bus weder schreib- noch lesbar und
   behielt deshalb seinen Resetwert 0xFFFF. Das traf jeden ALU-Befehl mit
   R14 als Operand.

Ergebnis: `node scripts/rtl_sweep.mjs 4` → **524288 Wortausführungen,
0 Abweichungen** (Seed 3 eingeschlossen), 232/232 Tests grün.

Der native/wasm-Inversion bleibt davon unberührt und weiter ungeklärt (siehe
unten); sie ist ein Werkzeug-Thema, kein Kern-Thema.

**Aufgelöst: die native/wasm-Inversion gab es nicht.** `main_native.cpp`
parst `--run` mit `strtoul(..., 16)` — jede Schrittzahl, die ich übergab, wurde
als Hexadezimal gelesen. `--run 400000` waren 4.194.304 Schritte, nicht
400.000. Daraus entstand der Schein, der native Verilator-Kern sei rund
achtmal langsamer als derselbe Code unter wasm.

Korrigierte Werte (µs je retired Befehl, kleiner ist besser):

| Kern | µs/Schritt | MIPS |
|---|---|---|
| Rust/WASM (Verhaltenskern) | 0,04 | ~25 |
| RTL nativ (Verilator, aarch64) | 1,15 | ~0,9 |
| RTL → WASM (Verilator/Emscripten) | 2,6 | ~0,4 |

Der native Kern ist also rund 2,3× schneller als die WASM-Fassung — die
übliche Reihenfolge. Nicht die Simulation ist der Preis, sondern der
Verhaltenskern ist ~28× schneller als jeder taktgenaue Kern, selbst nativ
kompiliert. Das ist der ehrliche Preis für die zyklengenaue Mikroarchitektur.

`--run` ist jetzt dezimal, `--run-hex` für die alte Form; alle anderen Zahlen
der CLI (Adressen, Segmente, `--fill`) bleiben hexadezimal. Die JSON-Ausgabe
meldete die gelaufene Schrittzahl immer schon, sie war nur nicht mitgedacht
worden.

**Phase 3, 5, 6 stehen aus** (Cache, Resttests, Doku).

## Phase 4 — IDE-Anbindung (Kern-Auswahl steht)

Der dritte Kern ist jetzt in der IDE wählbar. Statt des binären
WASM-Schalters gibt es eine Auswahl **JS / WASM (Rust) / RTL (Verilator)**;
gespeichert wird der Kernname (`deep16_core`), das alte `deep16_use_wasm`-Flag
wird einmalig übernommen.

Die IDE redet nicht mehr direkt mit einem Modul, sondern mit dem *aktiven*
Kern:

* `this.coreName` ist die einzige gespeicherte Wahrheit (`'js' | 'wasm' | 'rtl'`),
* `this.useWasm` bleibt als abgeleitetes Flag, weil viele Anzeigepfade darauf
  verzweigen,
* `activeCoreModule()` liefert das Modulobjekt des aktiven kompilierten Kerns,
  `compiledCoreReady()` prüft zusätzlich, ob er geladen *und* gespiegelt ist,
* `syncStateIntoWasm()` → `syncStateIntoCore()` spiegelt den JS-Kern in welchen
  kompilierten Kern auch immer aktiv ist.

Damit musste keine Verzweigung dreifach werden: alle ~100
`window.Deep16Wasm.*`-Aufrufe gingen auf `activeCoreModule()` — auch in den
Panels `deep16_ui_memory.js` und `deep16_ui_screen.js`, die vorher hart auf das
WASM-Modul zugreifen konnten und sonst still den JS-Speicher angezeigt hätten.
`tests/ui-core.test.js` sichert das ab: es fährt die echten IDE-Methoden gegen
das echte `rtl/pkg`-Glue und prüft, dass ein gespiegeltes Programm im RTL-Kern
dasselbe rechnet wie im JS-Kern.

**Nicht abgesichert:** die Darstellung selbst. Register-, Speicher- und
Bildschirmpanel lesen jetzt `this.ui.activeCoreModule()`, sind aber ohne
Browser nicht durchgetestet; der Schattenzustand `[spc, scs, spsw]` ist als
zwischen beiden kompilierten Kernen identisch beigelegt.

Die Durchsatzbegrenzung der IDE (200 Schritte je 10-ms-Takt) gilt für alle
Kerne, die ~45-fache Rohgeschwindigkeit des RTL-Kerns fällt im Bedienbetrieb
daher nicht auf.

## Phase 2 — Pipeline-Umbau (abgeschlossen)

- 5 Stufen IF/ID/EX/MEM/WB, volles Forwarding (EX/MEM/WB→EX),
  Load-Use-Stall, Predict-Not-Taken + Squash des falsch-path-Fetches.
- Delay-Slots sind architekturbedingt → kein Flush nötig, solange der Slot
  läuft; Branch-Resolution in EX.
- `SMV APC`-No-Forward-Kontrakt (Arch §3.3) und Pipeline-Drain bei
  SWI/RETI/HLT-Eintritt (ARCHREV §3) — die typischen Paritätsfallen.
- `step()` = Taktzyklen bis zum Retire (Cap), Exporte
  `get_cycle_count()`/`get_stall_count()`/`get_flush_count()`.
- Regel: Pipeline wird erst angefasst, wenn Phase 1 auf allen Tests grün ist
  — dann zeigt jede Differenz ein Hazard-/Forwarding-Problem.
- Achtung: der jetzige Kern braucht **3–4 Zyklen** pro Befehl. Die
  Pipeline-Zyklen sind damit nicht direkt mit den bisherigen
  `get_cycle_count()`-Werten vergleichbar; CPI-Statistiken starten erst in
  Phase 4 und sind dann eine neue Größe.

## Phase 3 — Cache (Spec §7.4)

- 4KB unified, direkt-gemapped, 256 Zeilen × 8 Wörter, write-through;
  I/O-Region (0xFxxxx) non-cacheable; `FSH` invalidiert alle Zeilen.
- Hit = 1 Takt, Miss = Block-Fill (8 Wörter); Statistik-Counter
  (hits/misses/stalls/flushes) als Exporte.
- Garantie: Cache ändert die Architektur-Semantik nicht →
  Retire-Trace-Parität läuft unverändert weiter.

## Phase 4 — IDE-Integration

- `index.html`: aus `wasm-toggle`-Checkbox wird ein 3-Wege-Kernwähler
  (JS / WASM / RTL).
- `js/deep16_ui_core.js`: `useWasm` wird zu `activeCore`-Dispatch; JS-Pfad
  bleibt unberührt; Programm-Spiegelung in den RTL-Core beim Einschalten
  (wie heute JS→WASM), Tastatur über `kbd_push`.
- Screen/Lese-Wege (`deep16_ui_memory.js`, `deep16_ui_screen.js`) müssen den
  RTL-Core mit abdecken.
- Stats-Zeile im Transcript: **CPI, Stalls, Flushed, Cache-Hitrate** — der
  sichtbare Unterschied zum Behavioural-Modell.
- `rtl/pkg/` wird committen wie `wasm/pkg/` → IDE läuft ohne Build-Schritt.

## Phase 5 — Tests

- `tests/helpers.js`: `loadRtl()`/`runRtl()` ✅ (bereits vorhanden).
- `tests/rtl.test.js` ✅ (20 Tests: dreifache Parität für ALU, MUL32/DIV32
  inkl. Odd-Dest, Bit-Ops, LINK/Delay-Slots, Boot- und Reset-Zustand,
  MOV-imm2, Shadow-Tests, Beispiele, Forth-REPL mit Tastatur, Sweep).
- ✅ Decode-Sweep aller 65536 Wörter (in `rtl.test.js`, ausführbar mit
  4 Seeds über `scripts/rtl_sweep.mjs`).
- ✅ Seedierter Zufalls-Befehlsstrom-Test gegen den JS-Kern — **offen**,
  der Sweep deckt Einzelwörter ab, aber keine Zufallsprogramme.
- ✅ Nativer Trace-Diff-Modus (`scripts/rtl_trace.mjs`, `obj_dir/deep16_rtl`).

## Phase 6 — Doku

- `README.md`: dritter Kern, Layout, Build-Befehle — **offen**.
- `STATUS.md`: Entscheidungs-Log-Eintrag — **offen**.
- `doc/Deep16-RTL.md` ✅ (Microarchitektur, Debug-Bus, Prüfwerkzeuge,
  Divergenzliste).
- Optionaler Anschluss fürs Buch (Kap. 6/7 Pipeline-Statistiken) — nicht Teil
  dieser Runde.

## Risiken / offene Punkte

| Risiko | Gegenmittel |
|---|---|
| apt-emcc × Verilator inkompatibel | ✅ geklärt im Spike (zwei Flags, s. o.) |
| Decode-Fehler in reservierten Wörtern | ✅ Sweep grün (524288 Ausführungen) |
| Pipeline-Semantik ≠ Kern (APC, Drain) | Retire-Trace pro Phase, Kern bleibt gold |
| `get_recent_access`/`get_last_event`-UI-Kopplung | Bus-Tracking via Debug-Bus (0x24–0x2C) |
| WASM-Größe | ✅ 179 KB gemessen (`rtl/pkg/deep16_rtl_gen.wasm`) |
| Verilator-Parser-Eigenheiten | 5.032 parst `case`-Ranges falsch (`8'hC0-8'hCF` überlappt `8'h00-8'h0F`) — im Code vermieden, siehe doc/Deep16-RTL.md |

## Reihenfolge

1. ✅ Phase 0: Toolchain-Spike.
2. ✅ Phase 1: `rtl/` + Harness + Sweep + Trace.
3. Phase 2: Pipeline (höchstes Risiko, jetzt auf grüner Basis).
4. Phase 3: Cache.
5. Phase 4: IDE-Kernwähler + Statistik.
6. Phase 5/6: Resttests, Doku.