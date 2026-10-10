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

**Phase 2–6 stehen aus.** Der Kern ist derzeit eine reine
Verhaltens-Portierung mit 4 Zyklen pro Befehl — kein Forwarding, kein Cache,
keine IDE-Anbindung.

## Phase 2 — Pipeline-Umbau (nächster Schritt)

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