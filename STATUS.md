# STATUS.md — Fortschritt des Deep16-Buchs

> Ständig gepflegter Arbeitsstand. Letzte Änderung: 2026-10-10.
> Workflow-Regeln: [STYLE.md](STYLE.md).
>
> **2026-10-10:** Neuer Abschnitt „FPGA-Ziel Tang Nano 9K — Auslegungsbefunde"
> und „Iterativer Teiler"; „Bekannte Mängel" ist nicht mehr leer. Für den
> künftigen Hardware-Interrupt ist **Option 4 (Drain)** entschieden, für den
> Teiler ein **handgeschriebener iterativer Radix-4-Kern**.

---

## Überblick

| Kapitel | Titel | Stand | Verifiziert | EPUB |
|---------|-------|-------|-------------|------|
| 1 | Warum eine 16-Bit-CPU? | ✅ fertig | beide Kerne | ✅ SVG-Diagramm |
| 2 | Register und Speicher organisieren | ✅ fertig | beide Kerne | ✅ SVG-Diagramm |
| 3 | Die ALU-Werkstatt: Befehle für Einsteiger | ✅ fertig | beide Kerne | ✅ 32 SVG-Diagramme |
| 4 | Flusskontrolle und Unterprogramme | ✅ fertig | beide Kerne | ✅ 4 SVG-Diagramme |
| 5 | Interrupts und Shadow-Register | ✅ fertig | beide Kerne | ✅ 8 SVG-Diagramme |
| 6 | Der Simulator als Werkbank | ✅ fertig | beide Kerne | ✅ 1 SVG-Diagramm |
| 7 | Ein Mini-Forth | ⏳ offen | — | — |
| 8 | Terminal-Uhr / Snake-Projekt | ⏳ offen | — | — |
| A–D | Anhänge | ⏳ offen | — | — |

Buchplan (Entwurf): `book/README.md`. Gesamtumfang Ziel ~120–160 Seiten.

---

## Aktueller Stand im Detail

### ✅ Kapitel 1 — `book/kap01.md` (262 Zeilen)
- Größenvergleich 6502 ↔ Simulator (27 Mio. IPs), §1.1 drei Grenzen des 8-Bitters,
  §1.2 Deep16 im Überblick (Mermaid-Registerbank), §1.3 Konventionen & Delay-Slot-Regel.
- EPUB: Mermaid-Registerbank als SVG gerendert.

### ✅ Kapitel 2 — `book/kap02.md` (545 Zeilen)
- §2.1 Registerbank R0–R15 (Rettungskonvention), `LDI`→R0-Regel,
  §2.2 PSW (Mermaid-Bitdiagramm), §2.3 Adressierung, §2.4 Stack,
  Beispiel „Hallo, Deep16!“.
- **imm2-Redesign übertragen (2026-10-08):** §2.1 erklärt den dritten
  Operanden als vierteilige **Funktionsauswahl** statt als addiertes
  Immediate — **Tabelle 2-1** (Spec §3.4/§5.1.2), neues gemessenes
  Listing der vier Funktionen (16 Schritte, `PSW = 0x0000`, JS = WASM),
  PC-Regel mit Delay-Slot-Verweis (§3.4/§6.2.2), Ablehnungs-Text für
  `, 1`/`, 3`/`+1`/`+3` wörtlich zitiert.
- Verifikation: Extractor `extract_kap02.mjs` jetzt **beide Kerne**
  (75 Checks in 9 Blöcken) · Strukturwächter `check_kap02_04.mjs` 61 Checks.
- EPUB: PSW-Diagramm als SVG.

### ✅ Kapitel 3 — `book/kap03.md` (1180 Zeilen)
- §3.1 `LD`/`ST`/`LDS`/`STS` · §3.2 `ADD`/`SUB`/`CMP`/Logik/Schieber/`MUL`/`DIV` ·
  §3.3 `NEG`/`INV`/`SPSW`/`LPSW`/`SET`/`CLR` · Beispiel „1 bis 200“ (1824 Schritte).
- **10 Listings**, alle gemessen; **32 Bit-Codierungs-Diagramme** mit Titelzeile
  (jeder neu eingeführte Befehl).
- Verifikation: `npm test` 121/121 · Probe 94 Checks · Extractor 107 Checks ·
  EPUB mit 32 SVGs in `ch003.xhtml`.

### ✅ Kapitel 4 — `book/kap04.md` (593 Zeilen)
- **7 Listings, alle gemessen** — 4 Encoding-Diagramme mit Titelzeile
  (`Jcc`, Delay-Slot-Ablauf, `LINK`, `JMP Rx`), dazu Tabelle aller 8 `Jcc`.
- §4.1 `Jcc` & **Delay Slots**: Slot läuft immer (4-1, 28 Schritte),
  Über-Sprung-Falle ohne NOP (4-2a/4-2b), alle 8 Bedingungen im Zähler
  (4-3, `R8 = 4`), Reichweite ±256 (Fehlermeldung gemessen), verschachtelte
  Jcc als Warnhinweis gemessen.
- §4.2 `LINK`/`JMP LR` ohne Adress-Stapel: Aufruf/Rückkehr (4-4,
  `LR = 0x0105`), „ein LR für alle Aufrufe“ — Sicherung in R5 (4-5,
  `R8 = 0xAA`); Gegentest ohne Sicherung läuft 1000 Schritte (beide Kerne).
  Die Rechnung läuft seit dem imm2-Redesign über **Funktion 2** (`Rs + 2`);
  die `, 1`-Schreibweise, die „eigene Adresse + 2“ ergeben hätte, wird
  abgelehnt (Querverweis §2.1, Tabelle 2-1). Diagramme unverändert.
- **Beispiel: Tokenizer** (4-6): 3 Token aus „eine zwei drei“, Tabelle
  `(0200,4)/(0205,4)/(020A,4)`, **284 Schritte**.
- Verifikation: `npm test` 142/143 — der eine offene Fall (`forth.test.js`:
  „stack underflow …“) stammt aus paralleler Forth-Arbeit und berührt kein
  `book/`; Probe `probe_kap04.mjs` 46 Checks · Extractor `extract_kap04.mjs`
  60 Checks · EPUB mit 4 SVGs in `ch004.xhtml`.

### ✅ Kapitel 5 — `book/kap05.md` (730 Zeilen)
- **8 Listings, alle gemessen** — 8 Bit-Codierungs-Diagramme mit Titelzeile
  (`SWI`, `RETI`, `SMV`, `SETI`, `CLRI`, `SETS`, `CLRS`, `MVS`/`MOV Rd, Sx`).
- §5.1 Das Problem (Stapel vs. zweite Bank; ehrliche Note: kein
  Hardware-Interrupt feuert in einem der beiden Kerne) · §5.2 `SWI`/`RETI`,
  der Reparatur-Stummel für den Boot-Vektor, `SMV` + `alt_sel`-Tabelle,
  was `SWI` zurücksetzt, `SETI`/`CLRI` und die `SETS`-Falle ·
  §5.3 `APSW`, Schatten-Segmente, OS-Aufruf mit zwei Banken, Shadow-Block
  im Simulator · Beispiel „Drei Interrupts, ein Zähler“ (48 Schritte).
- **Frozen Fact eingehalten:** `SETS` kommt nur in Listing 5-4 (der Falle)
  vor, **nie im Beispiel**; `SET`/`CLR` mit Bitnummer fehlen komplett.
- Verifikation: `npm test` 134/134 · Probe `probe_kap05.mjs` 42 Checks
  (Boot, ungepakter SWI-Vektor, RETI ohne Delay Slot, Schattenzustand,
  Code-/Spec-Inspektion) · Extractor `extract_kap05.mjs` 150 Checks ·
  EPUB mit 8 SVGs in `ch005.xhtml` (46 insgesamt, `raw_pre` = 0).

---

### ✅ Kapitel 6 — `book/kap06.md`
- §6.1 Peripherie ist Speicher: **Tabelle 6-1** Speicherkarte, **Tabelle 6-2**
  Tastaturports, `ES = 0xF000` als Peripherie-Segment (Offsets `0x0060`,
  `0x0062`, `0x1000`), Bildschirmzelle (Low-Byte = Zeichen, Bit 15 =
  Reverse-Video und Cursor) mit Mermaid-Bitdiagramm, Listing 6-1/6-2.
- §6.2 Debuggen: Delay-Slot-Falle **messbar** (`R1` = 5 statt 1, 30 statt 31
  Schritte), LDI-Vorzeichengrenze, Debugger-Hooks `getRecentMemoryView()` /
  `get_recent_access()`, Begründung der Doppel-Implementierung.
- **Beispiel:** Terminal-Schleife (Listing 6-5), Tastatur → Bildschirm, mit
  Wartebudget statt Endlosschleife.
- Kernbefund: **nur `LDS`/`STS` dekodieren Ports** — `LD`/`ST` liefern an
  `0xF0060` den RAM-Füllwert `0xFFFF`. Auf beiden Kernen gemessen.
- Nebenbefund, dokumentiert statt verschwiegen: der Assembler prüft `LDI`
  nach unten (`-16384..16383`), nach oben nur gegen die Bitbreite — so ergibt
  `LDI 20000` auf der CPU `0xCE20` (gemessen `−12992`). Beide Kerne irren
  sich gleich.
- Verifikation: `npm test`, `tests/cores.test.js`, `tests/rtl.test.js`,
  Probe `probe_kap06.mjs` 71/71, Extractor `extract_kap06.mjs` 94/94,
  alle drei EPUB-Varianten mit 6 Kapiteln und 47 Diagrammen.
- **Nachtrag (2026-10-10):** Absatz „Warum zwei Kerne" auf **drei** Kerne
  umgestellt — JS, Rust/WASM und das Verilog-Modell (`VERILOG.md`). Messwerte
  unverändert (die Schrittzahlen stimmen auch auf dem RTL-Kern), nur die
  Begründung trägt jetzt eine Pipeline *und* zwei Interpreter.

---

## Build & Tooling

| Aufgabe | Befehl |
|---------|--------|
| Tests | `npm test` (alle `tests/*.test.js`) |
| EPUB bauen (SVG, Apple Books) | `./book/build/build-epub.sh` → `book/epub/Deep16.epub` (Pandoc epub3 + Mermaid-SVG-Filter) |
| EPUB bauen (PNG, Kindle) | `./book/build/build-epub.sh kindle` → `book/epub/Deep16-kindle.epub` (PNG-Diagramme + normalisierte Metadaten, gegen E016) |
| EPUB bauen (Kindle, Calibre-Round-Trip) | `./book/build/build-epub.sh kindle-calibre` → `book/epub/Deep16-kindle-calibre.epub` — **die für Amazon gültige Datei** (E016 gelöst, am Gerät bestätigt) |
| WASM neu bauen | `npm run build:wasm` (nur bei Kernel-Änderung nötig) |
| Mess-Probe pro Kapitel | `/tmp/opencode/probe_kapNN.mjs` |
| Book-Extractor pro Kapitel | `/tmp/opencode/extract_kapNN.mjs` |

Voraussetzungen für den EPUB-Build (headless-Container):
- Chromium unter `/tmp/chromium/chrome-linux/chrome`,
- `@mermaid-js/mermaid-cli` (`mmdc`) im npx-Pfad
  `/home/ubuntu/.npm/_npx/…/node_modules/.bin`,
- Puppeteer-Args in `/tmp/mmdc_conf.json` (`--no-sandbox …`).

---

## Entscheidungs-Log

| Datum | Entscheidung | Betroffen |
|-------|--------------|-----------|
| 2026-10-07 | Mermaid wird vor dem EPUB-Build zu **SVG** vorgerendert (Lua-Filter + mmdc); EPUB3 `--embed-resources`. | `book/build/mermaid_filter.lua`, `book/build/build-epub.sh` |
| 2026-10-07 | **Jeder neu eingeführte Befehl** bekommt ein Bit-Codierungs-Diagramm. | kap03 (32 Diagramme) |
| 2026-10-08 | Diagramme brauchen eine **Titelzeile** (`**`Mnemonic` — Funktion**`). | kap03 |
| 2026-10-08 | `STYLE.md`/`STATUS.md` angelegt; Workflow ab jetzt verbindlich. | Repo |
| — | `SETS`/`CLRS` (Bit 5) als Footgun **dokumentiert** (Kap. 5), nicht im Kapitel demonstriert. | kap03, kap05 |
| 2026-10-08 | **MOV imm2-Redesign** (`ARCHREV.md`) ins Buch übertragen: §2.1 erklärt `imm2` als Funktionsauswahl (Tabelle 2-1), §4.2 auf Funktion 2 umformuliert. Keine Messung, kein Listing und keine Spezifikations-Verweisung mussten geändert werden; Diagramme unangetastet. | kap02, kap04 |
| 2026-10-09 | **EPUB-XHTML-Wohlgeformtheit** (Apple Books brach mit „Specification mandates value for attribute style" ab): `mermaid_filter.lua` entfernt leere SVG-Attribute (`style=""`, von Pandoc 3.7 sonst zu wertlosem `style` verkürzt) und escapet nackte `&` (SIL-OFL-Lizenzkommentar im eingebetteten `@font-face`) zu `&amp;`. Alle 11 XML-Teile wohlgeformt. | `book/build/mermaid_filter.lua`, `book/epub/Deep16.epub` |
| 2026-10-09 | **Kindle-Variante gegen E016, 2. Anlauf**: PNG-Diagramme allein haben E016 **nicht** beseitigt (gegen Amazon-Hilfe geprüft: keine SVGs/Gradienten/Mathe mehr, Tabellen max. 15 Zeilen, CSS unauffällig). Ursache ist die Metadaten-Klasse, an der Amazons Parser scheitert: `<dc:language>` mit Attributen bzw. Regions-Subtag sowie die von Pandoc gesetzten Apple-Attribute `prefix="ibooks:…"`/`xml:lang` im `<package>`. `normalize_epub.py` reduziert auf `<dc:language>de</dc:language>`, entfernt beide Attribute, das `com.apple.ibooks.display-options.xml` und Calibres SVG-Umschlag des Titelbilds. Da sich das gegen Amazon nicht prüfen lässt, gibt es zwei Artefakte: `kindle` (EPUB3, Layout erhalten) und `kindle-calibre` (zusätzlich Calibre-Round-Trip — von der Community als wirksam bestätigt). | `book/build/build-epub.sh`, `book/build/normalize_epub.py`, `book/epub/Deep16-kindle.epub`, `book/epub/Deep16-kindle-calibre.epub` |
| 2026-10-10 | **E016 gelöst — bestätigt am Gerät**: `Deep16-kindle-calibre.epub` wird von Send to Kindle akzeptiert und liest sich reflowable; Layout und Diagramme sind einwandfrei. Damit ist der Calibre-Round-Trip die entscheidende Maßnahme, `normalize_epub.py` bleibt als Absicherung (Sprache, Apple-Attribute, SVG-Titelbild). **Für Amazon ist damit `kindle-calibre` die gültige Datei**; `Deep16-kindle.epub` und `Deep16.epub` bleiben für Apple Books. | `book/epub/Deep16-kindle-calibre.epub` |
| 2026-10-10 | **JS-Kern führt `LDS`/`STS` im Debugger mit**: `executeLDSSTS` setzte `recentMemoryAccess` nicht, das Speicherfenster zeigte nach einem `STS` auf den Bildschirm weiterhin die Brotkrume des Boot-ROMs (Adresse `0x0002`) statt `0xF1000` — der WASM-Kern (`recent_addr`) hatte es richtig. Das war die einzige Divergenz, die Kapitel 6 beim „gleiche Bitgenauigkeit"-Vergleich aufgedeckt hat; `tests/cores.test.js` 22/22 grün. | `js/deep16_simulator.js` |
| 2026-10-10 | **Architektur-Revisionen abgeglichen**: Die Revisionsdokumente im Repo-Root sind in STATUS.md unter „Architektur-Revisionen im Repo-Root" nach Thema, Stand und Buchrelevanz eingeordnet. Zwei sind bewusst **kein** Buchthema: `GFX.md`/`GFXOVERV.md` (Grafik-Kern GCoP, Design-Phase, ferne Zukunft) und `PLANPSRAM.md` (PSRAM-Backing-Store, **nicht umgesetzt**). `SERPLAN.md` (8/9 Schritte fertig) ist Material für Kapitel 7. Der aus `VERILOG.md` folgende dritte Kern **wurde ins Buch übernommen**: Kapitel 6 §6.2 spricht jetzt von drei Kernen, und Probe (71/71) wie Extractor (94/94) messen auf JS, WASM und RTL — die Schrittzahlen stimmen auch auf dem Verilog-Kern. Vermessungs-Workflow in `STYLE.md` §7 entsprechend auf drei Kerne gestellt. | `book/kap06.md`, `STYLE.md`, `STATUS.md` |
| 2026-10-10 | **Kapitel 6 „Der Simulator als Werkbank"** geschrieben: Speicherkarte (Tabelle 6-1), Tastaturports (Tabelle 6-2), Bildschirmzelle mit Bitdiagramm, die Kernfalle `LD`/`ST` sehen keine Ports, Delay-Slot-Falle messbar (`R1` = 5 statt 1), LDI-Mustergrenze, Debugger-Hooks. Alle Zahlen auf **allen drei** Kernen gemessen (Probe 71/71, Extractor 94/94). | `book/kap06.md`, `book/epub/*` |
| 2026-10-10 | **`LDI`-Bereich: Vermerk zurückgenommen, Semantik festgeschrieben.** Der vormerkte „Bereichsfehler" war eine **Fehldiagnose** — die obere Grenze `0x7FFF` ist korrekt. Spec §3.4 lautet `R0 ← sign_extend(imm15)`: der Operand ist ein **15-Bit-Muster**, alle 32768 Muster sind legal, und die Vorzeichenerweiterung findet in der **CPU** statt, nicht im Assembler. `LDI 20000` → `0xCE20` (`−12992`) ist auf beiden Kernen das *richtige* Ergebnis. Ein Versuch, die Grenze auf `16383` zu ziehen, hat `forth.asm`, `swi-test.asm`, `screen_demo.asm`, `string_demo.asm` und `asm/backup` zerlegt (80 Testfehler) sowie den Disassembler-Round-Trip gebrochen — der Disassembler gibt Immediates als rohes Hex aus, das sich dann nicht wieder laden ließ. **Regel:** Assembler prüft nur, ob der Wert in ein 15-Bit-Feld passt (`0..0x7FFF` oder `-16384..-1`, dieselben Muster in zwei Schreibweisen), nicht ob er in einen Vorzeichenbereich passt. Absicherung: `tests/disassembler.test.js` prüft jetzt alle 32768 Muster auf `disassemble → assemble`, STYLE.md §9 als eingefrorener Fact präzisiert, die irreführenden TODO-Kommentare in `js/deep16_assembler.js` ersetzt. Kapitel 2/3/6 und alle EPUBs bleiben unverändert — sie hatten recht. | `js/deep16_assembler.js`, `tests/disassembler.test.js`, `STYLE.md` §9 |
| 2026-10-10 | **`book/` aufgeräumt**: Ergebnisse nach `book/epub/`, Zwischenergebnisse (Pandoc-Stufe, Calibre-Round-Trip, Mermaid-PNGs) nach `book/build/` — bei jedem Build geleert, per `.gitignore` nicht versioniert. `book/` enthält damit nur noch Quellen (`kap*.md`), Werkzeuge (`build-epub.sh`, `mermaid_filter.lua`, `normalize_epub.py`), das Mermaid-Test-Fixture `test/` und die beiden Artefaktordner. | `book/epub/`, `book/build/`, `book/build/build-epub.sh`, `STYLE.md` §6 |
| 2026-10-10 | **Divider neu: handgeschrieben, iterativ, Radix-4.** Drei Befunde führten dazu. **(a)** Das RTL benutzt die Verilog-Operatoren `quot32 = dividend32 / {16'h0000, opv_i}` und `rem32 = dividend32 % {...}` (`rtl/deep16_alu.sv:235-236`) — Verilog sieht **32/32**, ein Synthesizer inferiert zwei volle 32-Bit-Teiler. Die Architektur meint aber 32÷16 mit **16-Bit-Quotient und 16-Bit-Rest**; `quot32[15:0]`/`rem32[15:0]` verwerfen die oberen Hälften ohnehin. Ein echter 32÷16 braucht nur ein **18-Bit-Arbeitsregister**, nicht 33 — das war in der ersten Auslegung dieses Dokuments falsch angesetzt. **(b)** Unverändert ergäbe das ~1200–2000 LUT und **8–16 MHz**; der Teiler wäre der Taktbegrenzer des ganzen Kerns. **(c)** Iterativ **entkoppelt die Breite vom Takt**: der kritische Pfad ist nur noch *eine* Iteration (18-Bit-Kette + 2 LUT-Level + Routing = 2,2–4,5 ns), also **222–455 MHz** und bei 54 MHz 4–8× Reserve. Gewählt wird **Radix-4** (2 Dividend-Bits je Iteration, **16 statt 32 Takte**) für den Durchsatz: Misch-CPI 6,20 → **3,53**, also 8,7 → **15,3 MIPS @54 MHz**. ⚠ *Korrigiert nach der Umsetzung:* die erste Fassung nannte **8 Takte / 24,5 MIPS**. Falsch — der 32÷16-Quotient ist 32 Bit breit und wird erst am Ende auf 16 Bit gekürzt, also müssen alle 32 Dividend-Bits aus `rem = 0` verbraucht werden. Radix-4 bleibt die richtige Wahl (es halbiert die Iterationen gegenüber Radix-2), ist aber halb so schnell wie zunächst behauptet. **Gemessen: 16,0 Takte** über `ADD`. Fläche: **~300–450 LUT** (gegenüber ~100–160 für Radix-2 und ~1200–2000 für den inferierten) — bei 300–450 LUT bleibt der Fmax bei ~5–7 ns je Iteration, also ~2,6–3,7× Reserve bei 54 MHz. `DIV` (16÷16) und `DIV32` (32÷16) teilen **einen** Kern (16÷16 = 32÷16 mit Nullbits im Dividend); Quotient und Rest fallen im Restoring-Verfahren gemeinsam an, die Doppel-Operatoren entfallen. Preis: 16 Takte statt 1 je Division. **Bleibt zu erhalten:** die Sonderfälle `opv == 0 → 0xFFFF` und die Ablehnung ungerader Zielregister bei `DIV32` (`rd[0]`). Danach ist der Teiler **nicht mehr** der kritische Pfad — der ist dann der Rest von EX (228-Bit-State-Bypass, ALU mit 32 Funktionen, Schieberegister, Ergebnisauswahl), geschätzt 8–15 ns. | `rtl/deep16_alu.sv`, `rtl/deep16_core.sv` (`stall`) |
| 2026-10-10 | **Dritter CPU-Kern in SystemVerilog** (`rtl/`, Verilator + Emscripten), 5-Stufen-Pipeline und 4KB-Cache, in der IDE als **Kern** wählbar (JS / WASM / RTL). Zwei Grundsätze haben sich als tragend erwiesen und sollten bei einem vierten Kern wiederholt werden: **(a)** Der Cache ist **per Konstruktion transparent** — bei einem Miss liefert das Top-Level weiter aus dem Speicherarray aus, die Pipeline stallt nie und die (verifizierte) Pipeline-Steuerung bleibt unangetastet. **(b)** Nebenwirkungen außerhalb von WB brauchen eine Bedingung *„verlässt die Stufe in diesem Takt"* — sonst feuert der Tastatur-Pop über die Schrittgrenze hinweg mehrfach. Drei Kernfehler dieser Runde waren jeweils **eine** fehlende Bedingung, nicht schlechte Logik: `fill_base` nach Cachebarkeit statt nach dem Miss gewaehlt, Invalidierung per `eval()` ohne posedge (stiller No-op), veraltete Zeile nach Store ohne Write-Allocate. Dazu zwei Fehler im Prüfwerkzeug selbst, die beide wie eine Kerndivergenz aussahen: `set_registers()` legt Index 15 auf den *aktiven* PC, und ein Seed, der nur einen PC setzt, laesst im Schattenkontext den anderen auf 0. **Lehre:** bei einer Divergenz zuerst *das Werkzeug* prüfen, nicht das Werk. Verifikation: Decode-Sweep 524288 Ausführungen, 0 Abweichungen (4 Seeds), `tests/fuzz.test.js` mit 60 Zufallsprogrammen, 239/239 Tests gruen. Für die Doku: `README.md` auf drei Kerne gezogen, `VERILOG.md` als Plan- und Entscheidungslog geführt. | `rtl/`, `index.html`, `js/deep16_ui_core.js`, `tests/rtl.test.js`, `tests/fuzz.test.js`, `README.md`, `VERILOG.md` |

## Architektur-Revisionen im Repo-Root

Das Buch erzählt die Deep16 so, wie sie **heute** ist. Damit es dabei nicht
stillschweigend veraltet, sind hier die Architektur-Dokumente aus dem
Repo-Root eingeordnet: Thema, tatsächlicher Stand, und was daraus für das
Buch folgt. Zwei davon sind bewusst **kein** Buchthema.

| Dokument | Thema | Stand | Bedeutung für das Buch |
|---|---|---|---|
| `ARCHREV.md` | `MOV imm2` als Funktionsauswahl statt Addition | ✅ umgesetzt **und im Buch** | 2026-10-08 in Kap. 2 (§2.1, Tabelle 2-1) und Kap. 4 (§4.2) übertragen |
| `VERILOG.md` | dritter Kern: Verilog → Verilator + Emscripten | ✅ Phase 0–2 abgeschlossen, dreifache Parität grün, Decode-Sweep über alle 65 536 Befehlswörter ohne Abweichung | **im Buch eingearbeitet** — Kap. 6 §6.2 spricht jetzt von drei Kernen, `STYLE.md` §7 misst auf allen drei |
| `SERPLAN.md` | Quelltext über seriellen Port in den DeepForth-Kern (`SERLOAD`) | 🟡 7 von 9 Schritten abgeschlossen, `EVALUATE` bewusst zurückgestellt, Host-Anbindung im Browser unbestätigt | **Material für Kapitel 7** (Mini-Forth) — noch kein Kapiteltext |
| `PLANPSRAM.md` | PSRAM-Backing-Store für die FPGA | ⛔ **nicht umgesetzt** (Plan) | ❌ **kein Buchinhalt** |
| `GFX.md`, `GFXOVERV.md` | Grafik-Subsystem GCoP | 🟡 Design-Phase, **ferne Zukunft** | ❌ **kein Buchinhalt** |
| `deep16_project_summary.md` | IDE-Entwicklungsstand (alt) | ⚪ überholt | — |

### Warum GFX und PSRAM draußen bleiben

- **`GFX.md` / `GFXOVERV.md` sind ferne Zukunft.** Beide Dokumente sagen das
  selbst: Projekt-Status *Design-Phase / Planungsgrundlage*, „keine
  Implementierungs-Spezifikation". Der Grafik-Co-Prozessor ist entworfen, nicht
  gebaut; es gibt weder einen Kern noch Messwerte dazu. Solange das so bleibt,
  darf kein Kapitel ein GCoP-Verhalten behaupten — eine ungebaute Architektur
  zu beschreiben hieße, das Buch kaputtzuschreiben, sobald sie gebaut wird.
  **Auslöser für eine Neubewertung:** sobald `rtl/` GCoP-Bausteine enthält,
  gibt es Messwerte und das Thema gehört in den Buchplan (Kandidat: Anhang).
- **`PLANPSRAM.md` ist nicht durchgeführt.** Der Plan beschreibt, den
  Speicher-Backing-Store des RTL-Kerns vom Verilog-Array auf den PSRAM der
  Tang Nano 9K umzuziehen. Der Ist-Stand ist unverändert: `rtl/deep16_top.sv:48`
  deklariert weiterhin `reg [15:0] mem [0:MEM_WORDS-1]`, und die
  `always_comb` ab Zeile 207 bedient genau dieses Array (elf kombinatorische
  Leseports plus ein Schreibport je Takt). Nichts davon ist messbar, also
  nichts davon darf im Buch stehen.
  **Auslöser:** sobald Schritt 1 der Umsetzung (Memory-Interface) im RTL
  steht, ist der Kapitel-6-Speicherkarte die PSRAM-Aufteilung hinzuzufügen.

Beide bleiben hier sichtbar, damit niemand sie für vergessen hält: ein
Revisionsdokument im Repo-Root, das nichts mit dem Buch zu tun hat, ist eine
bewusste Entscheidung und keine Lücke.

---

## Nächste Schritte

1. ✅ **Kapitel 5** abgeschlossen (Interrupts, Shadow-Register, `SWI`/`RETI`,
   `SMV`/`APSW`; Probe → Listings → Extractor → EPUB → Push).
2. Stichproben-Härtung Delay-Slot-Grenzfälle ist für Kap. 4 abgeschlossen
   (verschachtelte Jcc gemessen: innerer entscheidet, äußerer fällt weg).
3. ✅ **Kapitel 6** abgeschlossen (Memory-Mapped I/O, Delay-Slot-Diagnose,
   JS-/WASM-Vergleich).
4. Danach: Kapitel 7 (Mini-Forth) — die Schleife aus Listing 6-5 wird zur
   REPL-Zeile, `asm/forth.asm` liegt dafür bereits vor. Material liefert
   `SERPLAN.md`: `SERLOAD`, EOF-Statuswert und die Zeilenlängengrenze sind
   gemessen und im Kernel getestet; offen sind nur `EVALUATE` und die
   Bestätigung der Host-Anbindung im Browser.

---

## Zurückgestellt (2026-10-10)

Zwei Punkte, die am 2026-10-10 gemeldet und bewusst **nicht** jetzt bearbeitet
wurden. Beide sind offen, keiner davon ist erledigt.

### 1. `SERLOAD` funktioniert im Browser noch nicht

Der Quelltext-Transfer über die serielle Leitung läuft in den Tests, im Browser
aber nicht. Was daran **unbestätigt** ist:

- **Der ganze Ablauf im Browser ist nie gelaufen.** In dieser Umgebung gab es
  keinen steuerbaren Browser; die Pump-Logik ist nur gegen den echten Kernel auf
  dem JS-Kern getestet (`tests/ui-core.test.js`).
- **Der Dateidialog ist ungetestet.** `queueSerialSource` braucht einen echten
  `FileReader`, den die Tests nicht haben — dort wird der Zustand direkt gesetzt.
- **Unbekannt ist, an welcher Stelle es bricht**: am Dialog, an der Übergabe an
  die Warteschlange, am Warten des Kernels oder am EOF.

Erste Schritte, wenn das aufgegriffen wird:

1. Im Browser `SERLOAD…` klicken und prüfen, ob die Datei überhaupt im
   Transkript auftaucht (`addTranscriptEntry` in `queueSerialSource`). Fehlt
   dieser Eintrag, liegt der Fehler im Dialog.
2. Steht der Eintrag drin, prüfen, ob `pumpSerialQueue()` etwas schiebt — bzw.
   ob sie die Meldung „line is full" bringt, weil die Maschine nicht läuft.
3. **Reihenfolge beachten:** Erst den Kernel starten (`forth.asm` laden,
   Assemble, Run), **dann** `SERLOAD` eintippen. Solange der Kernel nicht im
   Lademodus ist, liest er nichts aus der Leitung — die Leitung läuft dann voll
   und die Pumpe wartet mit der Warnung „line is full".

### 2. Das mobile UI muss aufgeräumt werden

Kein Fehler, sondern Struktur. Die bekannten Stellen:

- **Ein Knopf muss an drei Orten eingetragen werden**: im Markup, in
  `initializeMobileControls()` und in `restoreDesktopLayout()`. Das war genau die
  Ursache, warum `SERLOAD` auf dem Handy verschwunden war — im Markup stand es,
  in den beiden Layout-Funktionen nicht. Ein Test (`tests/ui-core.test.js`)
  prüft das inzwischen für alle Knöpfe im Panel-Kopf, trägt aber nicht das
  Markup selbst.
- **`.memory-panel-controls` steht zweimal in `css/memory.css`** (zweimal
  `display:flex`, einmal `gap: 4px` mit `margin-left:auto`, einmal `gap: 18px`
  ohne) — die spätere Regel gewinnt still.
- **Drei ineinander geschachtelte Media Queries** (768 / 900 / 480 px) mit
  Überschneidungen; die 900-px-Regel liegt zwischen den beiden anderen.
- **Die Knopfbreiten kommen aus JavaScript** (`--mobile-btn-w`, gesetzt in
  `initializeMobileControls` aus der gemessenen Breite des View-Schalters).
  Das Label muss deshalb fürs Handy gekürzt werden — `SERLOAD` tut das, aber das
  ist kein Ort, an dem man danach suchen würde.

## FPGA-Ziel Tang Nano 9K — Auslegungsbefunde

**Stand 2026-10-10. Schätzung, keine Synthese** — auf dieser Maschine gibt es weder
Yosys noch GowinE. Die Registerzahl ist exakt aus den Struct-Breiten gezählt, LUT-Zahl
und Taktfrequenz sind Schätzungen.

Zielressourcen (Sipeed-Wiki, GW1NR-9K): 8.640 LUT4, **6.480 FF**, 468 Kbit BSRAM
(26 Blöcke), 20 × DSP 18×18, **2 PLL**, 64 Mbit PSRAM.

### Passt der Kern?

| Ressource | Bedarf | verfügbar | Anteil |
|---|---|---|---|
| FF | ~2.100 | 6.480 | **32 %** |
| LUT4 | ~4.300 | 8.640 | **50 %** |
| BSRAM (Cache 4 KB) | ~37 Kbit ≈ 2 Blöcke | 26 Blöcke | 8 % |

Die FF-Verteilung: `ctx` 228, `if_id`+`id_ex` 100, `ex_mem`+`mem_wb` 896,
Registerbank 688, Rest ~150. Der State-Bundle-Entwurf („EX rechnet den ganzen
Folgezustand") kostet 2 × 228 = 456 FF allein für `ctx_next` durch die beiden
Rückstufen — der Preis der Architektur, hier bezahlbar.

### Befunde

1. **Speicher passt nicht in BSRAM.** Die On-Chip-Matrix
   (`rtl/deep16_top.sv:41`, `MEM_WORDS` in `rtl/deep16_pkg.sv:10`) belegt
   16,8 Mbit bei 468 Kbit verfügbar — **35×**. Unverändert bestätigt:
   PSRAM-Umbau ist Voraussetzung, nicht Kür.
2. ~~**`DIV`/`DIV32` schließt den Takt nicht**~~ — **behoben am 2026-10-10.**
   War als einzyklischer 32/32-Operator ein Taktbegrenzer (~8–16 MHz). Ersetzt
   durch `rtl/deep16_divider.sv`, einen handgeschriebenen iterativen
   Radix-4-Kern mit 18-Bit-Arbeitsregister, geteilt von `DIV` und `DIV32`
   (Details unten, Abschnitt „Iterativer Teiler"). Kostet 16 Takte je Division.
3. **Nur 2 PLL, aber `GFX.md` §3 plant vier Taktbereiche** (54 / 74,25 / 162 /
   371,25 MHz) bei 27-MHz-Quarz. 74,25 = 27 × 2,75 ist brüchig, braucht also ein
   echtes PLL. 371,25 = 5 × 74,25 geht über OSER. Weg aus 2 PLL:
   PLL1 → 74,25 (+5×), PLL2 → 162, CPU an **162/3 = 54 MHz**. Damit wird die
   CPU-Takt aber eine *abgeleitete dritte* Domäne — eine Festlegung, die
   `GFX.md` noch nicht getroffen hat.
4. **Debug-Bus gehört synthesefrei.** Der `DBG_*`-Kanal (`harness.cpp`,
   `get/set_debug_state`) ist reine Simulationsgerüstrüstung: ein
   256-Eintrags-Mux über die ganze Maschine. Per `ifdef` entfernt spart er
   ~800–1.200 LUTs und viel Routing.
5. **GFX obendrauf:** Line-OAM ~600 FF, GCoP-Logik ~2.000–2.500 LUT ⇒
   ~2.700 FF (42 %) und ~6.300–6.800 LUT (**73–79 %**). Passt, lässt aber keinen
   Raum für die GFX-Domain-Grenze — dort ist der erste Überlauf zu erwarten.

### Konfidenz

* **Register: hoch** — exakt aus den Struct-Breiten gezählt.
* **LUT: mittel** — ±25 %, ohne Synthese.
* **54 MHz: gering** — der Baustein bringt auf mittlerer Logik ~100–150 MHz;
  16-Bit-ALU plus breites Bypass-Netz in 18,5 ns ist *plausibel*, aber
  ungeprüft. Der Teiler allein verhindert es heute.
* Größte Unbekannte ist der **PSRAM-Controller**, den es noch nicht gibt.
  Dessen Arbitrationslogik ist nicht geschätzt — und er ist der eigentliche
  kritische Pfad des ganzen Projekts.

---

## Iterativer Teiler — gilt das für jeden FPGA?

**Im Kern ja, mit zwei Einschränkungen.** Der Befund ist nicht FPGA-spezifisch
zwitterhaft, sondern folgt aus einer Eigenschaft, die auf *allen* FPGAs gilt:

**Es gibt keinen Teiler-Makro.** DSP-Blöcke können multiplizieren, nicht
teilen. Eine Division ist auf jedem FPGA zwingend LUT-basiert, und die
Restwertkette ist prinzipiell tief. Ein in einem Takt ausgerollter 32÷16-Teiler
liegt damit auf keiner heutigen LUT-Struktur. Vergleichsweise: `MUL32` ist
16×16→32 und passt bequem in einen DSP (20 sind vorhanden) — der Teiler ist der
Ausreißer, nicht das Rechenwerk insgesamt.

**Einschränkung 1 — „jeder" ist zu stark.** Auf einem schnellen Baustein
(Speed-Grad -7/-8, gute Carry-Ketten) mag ein *einzelzyklisches* 16÷16 im
Taktbereich liegen. In ASIC ist es erst recht machbar (~2.000–3.000 Gatter,
100–200 MHz). Ein iterativer Teiler ist dort also *vorzuziehen*, nicht
*notwendig*. Für Deep16 ist er trotzdem richtig: die Teilung ist 32÷16, und
der Bruch ist eindeutig.

**Einschränkung 2 — Durchsatz.** Iterativ heißt 1 Teilung pro N Zyklen. Wer
viele Teilungen braucht, rollt teilweise aus (2 Bit pro Iteration) oder
pipeliniert. Für Deep16 ist Durchsatz kein Thema.

### Wie schnell ohne Änderung? — und zwei Korrekturen (2026-10-10)

**Erste Schätzung: 33 Bit pro Iteration.** Das war falsch. Eine 32÷16-Teilung
braucht ein **18-Bit-Arbeitsregister** (Divisor 16, um 2 verschoben, + 2-Bit-Digit), nicht 33 —
der Quotient ist 16 Bit, der Rest 16 Bit, beides passt in dieselbe
Zwischenstufe.

**Zweite, wichtigere Korrektur:** Das RTL nutzt die Verilog-Operatoren
(`rtl/deep16_alu.sv:235-236`)

    quot32  = dividend32 / {16'h0000, opv_i};
    rem32   = dividend32 % {16'h0000, opv_i};

Verilog sieht damit **32/32**, nicht 32/16 — der Divisor ist auf 32 Bit
hochnullifiziert. Ein Synthesizer inferiert daraus **zwei** volle 32-Bit-Teiler,
von denen nur die unteren 16 Bit benutzt werden.

| Variante | Arbeitsbreite | Zyklen | Logik | Fmax |
|---|---|---|---|---|
| unverändert (`/` + `%` inferiert) | 33 | 1 | 1200–2000 LUT + 2 Teiler | **8–16 MHz** |
| handgeschrieben, kombinational | 18 | 1 | ~700–1100 LUT | 18–31 MHz |
| **handgeschrieben, iterativ (gewählt)** | **18** | **16 (Radix-4)** | **~300–450 LUT** | **54+ MHz** |

Die Arbeitsbreite ist **18**, nicht 17: Radix-4 schiebt den Restwert um **2**, nicht
um 1, und addiert ein 2-Bit-Digit dazu — `4·0xFFFF−1 = 0x3FFFF` braucht 18 Bit.

**Und warum iterativ die Breite entkoppelt:** der kritische Pfad ist dann nur
noch *eine* Iteration — Carry-Kette (0,5–1,0 ns) + Compare/Mux
(0,7–1,5 ns) + Routing (1,0–2,0 ns) = **2,2–4,5 ns**, also 222–455 MHz. Bei
54 MHz bleibt 4–8× Reserve. Genau hier liegt der eigentliche Gewinn: nicht nur
Takt, sondern **~25–30 % des gesamten LUT-Budgets** (4.300 geschätzt) kommt
zurück, weil ein ausgerollter Teilerarray Breite × Iterationen kostet, ein
iterativer nur eine Iteration Breite.

**Der Preis sind Zyklen, nicht Takt.** Radix-4 verbraucht **2 Dividend-Bits je
Iteration**, also 16 statt 32 Takten — die Hälfte, die Radix-2 bräuchte:

    Misch-CPI  Radix-2: (5 × 1,04 + 32) / 6 = 6,20  ->   8,7 MIPS @ 54 MHz
    Misch-CPI Radix-4: (5 × 1,04 + 16) / 6 = 3,53  ->  15,3 MIPS @ 54 MHz

**Korrektur vom 2026-10-10 (nach der Messung).** Dieser Abschnitt behauptete
zuvor *8 Takte* und 24,5 MIPS. Das war falsch gerechnet: der Quotient einer
32÷16-Teilung ist **32 Bit** lang und wird erst am Ende auf 16 Bit abgeschnitten
(`quot32[15:0]`). Man muss deshalb **alle 32 Dividend-Bits** aus `rem = 0`
verbrauchen — 2 je Iteration ⇒ **16 Takte**. Der Trick, den Restwert mit
`dividend[31:16]` zu seedsen, ist nur legal, wenn diese obere Hälfte bereits
kleiner als der Divisor ist; bei kleinem Divisor ist das falsch
(`0xFFFFFFFF / 1` hätte oben `0xFFFF` gegen Divisor `1`). Radix-4 bleibt die
richtige Wahl — es halbiert die Iterationen gegenüber Radix-2 — ist aber nicht
so schnell, wie hier stand.

**Gemessen:** `DIV` kostet **exakt 16,0 Takte mehr als `ADD`** (100fach
vergleichsweise über den Zyklenzähler). Die Tabelle oben ist damit bestätigt.

### Entscheidung (2026-10-10): Radix-4, ein Kern für DIV und DIV32 — **umgesetzt**

Siehe Entscheidungs-Log. `DIV` und `DIV32` teilen **einen** iterativen
Radix-4-Kern (`rtl/deep16_divider.sv`); Quotient und Rest fallen gemeinsam an,
die Doppel-Operatoren `/` und `%` entfallen. `DIV32` mit ungeradem Zielregister
und beide mit Divisor 0 umgehen den Kern (feste Ergebnisse) — 1 Takt statt 16.

Der Kern brauchte mehr als einen `stall`, und das ist der eigentliche Punkt:

* `stall` ist ein **Einzeltakt**-Mechanismus — er schiebt in jedem
  gestallten Takt eine Blase nach MEM. `ctx_e` (der State-Bundle, den EX liest)
  ist aber nur zwei Stufen tief: `ex_mem`, dann `mem_wb`, dann fällt er auf das
  bereits committete `ctx` zurück. Über 16 Takte leert sich diese Kette, und EX
  rechnet aus veraltetem State.
* Deshalb zwei Phasen: **drain** (die ein bis zwei Instruktionen vor der DIV
  treten normal aus, `ex_mem` bekommt eine Blase) und danach **freeze** (wenn
  `ex_mem` und `mem_wb` leer sind, rührt sich nichts mehr — dann ist der
  Fallback auf `ctx` legitim, weil alles davor retired ist).

**Zwei Fehler, die erst die Messung gefunden hat** — beide waren vor dem
Einchecken nicht sichtbar, und der zweite wäre in keinem bestehenden Test
aufgefallen:

1. Der Dividend für `DIV` muss ins **untere** Halbwort: `{16'h0000, r1}`.
   `{r1, 16'h0000}` rechnet `r1·65536 / Rs` statt `r1 / Rs`. Symptom: `100/7`
   lieferte 18724 (= `936228 mod 65536`) statt 14.
2. Der Startpuls muss sich **pro Division** neu spannen, nicht pro Verweilzeit
   in EX. Zwei `DIV` hintereinander halten `div_req` durchgehend hoch, ein auf
   `!div_req` verankertes Nachspannen feuert nie — die zweite Division hätte
   still den ersten Quotienten wiederverwendet. Kein bestehender Test stellt
   zwei Divisionen hintereinander; `tests/rtl.test.js` hat jetzt einen.

Nachgemessen: `DIV` kostet **exakt 16,0 Takte mehr als `ADD`**. Lint sauber,
`npm test` 296/296 grün (inkl. Fuzz), plus ein eigener 22k-Fälle-Abgleich des
Teilers gegen Verilogs eigenes `/` und `%` (`rtl/sim/divtest.cpp`).

### Der eigentliche Preis — er fällt aus (2026-10-10 geprüft)

Erste Einschätzung war: die Shadow-Register existieren **genau damit**, einen
Interrupt in 2 Zyklen eintreten zu lassen (`doc/Deep16-Arch.md` §2.3); ein
iterativer Teiler hält Zwischenergebnisse über mehrere Takte *innerhalb eines
Befehls* und ein Interrupt mitten darin träfe auf architektonischen Zustand, den
es noch nicht gibt. **Geprüft: das kann nicht eintreten.**

1. **Es gibt keine Hardware-Interrupt-Leitung.** Kein `irq`, `int_req` oder `nmi`
   im RTL; die Ports von `deep16_top` sind `clk/rst/i_step/i_free/o_*/kbd_*/dbg_*/cache_*`.
2. **`SWI` ist der einzige Interrupt-Weg** — und wird in **EX** dekodiert
   (`rtl/deep16_core.sv:546`, `is_swi_ex`).
3. **`stall` friert die Pipeline** (`rtl/deep16_core.sv:1089-1095`): `ex_mem`,
   `id_ex`, `if_id`, `if_pc` werden nicht weitergeschrieben, **EX hält seinen
   Befehl**.
4. Ein iterativer Teiler setzt `stall`, solange er iteriert → **EX hält das `DIV`
   → kein folgender Befehl, auch kein `SWI`, erreicht EX.**

**Folgerung:** Ein Interrupt kann den Teiler strukturell nie mitten im
Flug erwischen. **Die vier Optionen sind für den heutigen Stand gegenstandslos —
es ist nichts zu tun.** Auch die Spezifikationszusage „Interrupt latency:
2 cycles" (`doc/Deep16-Arch.md` §1.3) bleibt unverändert *wahr*; der
ursprünglich erwogene Zusatz „+6 Zyklen bei Division" ist nicht nötig.

Der Teiler hält übrigens **8 Takte** (Radix-4), nicht ~32 — die allererste
Schätzung war doppelt daneben: sie nannte 33 Bit pro Iteration *und* ~32 Takte.
Beides korrigiert im Abschnitt „Wie schnell ohne Änderung?".

### Entscheidung (2026-10-10): Option 4 (Drain) für den künftigen HW-Interrupt

`doc/Interrupts.md` Zeile 64 spezifiziert `0x0001: HW_INT_VECTOR` — ein
**geplantes, aber nicht gebautes** Hardware-Interrupt-System. Sobald es kommt,
kann ein *asynchrones* IRQ mitten in einer Division eintreffen.

**Festgelegt ist Option 4 (Drain).** Im Interrupt-Annahme-Pfad:

    irq_pending <= irq_pending | irq_in;
    take        <= irq_pending & PSW.I & !div_busy;   // div_busy = Teiler iteriert

Kosten: **ein** zusätzliches FF (`irq_pending`) und ein UND in der
Annahmebedingung. Worst Case steigt die Interrupt-Latenz von 2 auf 2 + ~6 Takte
(bei 54 MHz: 37 ns → ~148 ns).

**Begründung der Wahl:**

* Das Problem ist für den heutigen Stand gegenstandslos (siehe oben). Option 4
  kostet deshalb *jetzt* nichts und ist die Antwort, die man nicht neu
  herleiten muss, wenn das HW-Interrupt-System gebaut wird.
* Die Auswahl bindet kein Versprechen der Architektur: der Kern bleibt
  Echtzeit-tauglich, nur die *Latenz* ist in diesem einen Fenster variabel.
* **Option 1 (Shadow) bleibt bewusst abgelehnt**, weil sie den meistgelehrten
  Begriff Shadow-Register auf Ausführungseinheiten-Zustand ausdehnen würde
  (`book/kap05.md`, 730 Zeilen). Das wäre ein dauerhaftes zusätzliches
  Versprechen in Spezifikation, Kapitel und Test — erkauft für ein Fenster, das
  kein Deep16-Anwendungsfall enthält.

Falls jemals ein echter Echtzeit-Anspruch gestellt wird, ist Option 1 der
Ausweg: sie ist dann billig, weil der Mechanismus (Shadow-Bank) bereits
existiert; es kommen ~60–80 FF und ein paar Muxer im SWI-Pfad dazu.

Für den Teiler selbst ist der Ausweg aus dem Stall-Pfad klar: `stall` ist heute
allein vom Load-Use-Hazard gesetzt (`rtl/deep16_core.sv:365-374`), ein Teiler
OR-t seine eigene Bedingung dazu — derselbe Mechanismus, nur länger. Das ist
die einzige Änderung, die für die Iterativ-Teilung überhaupt nötig ist.

---

## Bekannte Mängel

* **Nicht getestet:** `npm run lint:rtl` scheitert an
  `Cannot find file containing module: 'deep16_cache'` — die Datei fehlt in der
  Quellliste des npm-Skripts. Vorbestehend, mit `rtl/deep16_cache.sv` in der
  Liste ist der Build lint-frei. Einzeilige Korrektur.
* **Verhindert FPGA-Bau:** `DIV`/`DIV32` im Einzelzyklus (siehe oben).
* Der am 2026-10-10 vormerkte `LDI`-Bereichsfehler ist **kein Fehler** —
  die Vermerkung war eine Fehldiagnose (siehe Entscheidungs-Log).

---

## Geschätzte Performance (mit korrigierter Messung)

`run_cycles()` (Commit `3e7b5b4`) macht die Zyklenzahl erst lesbar; vorher lag
CPI konstant bei 2,0, weil `step()` je Befehl eine feste Pipeline-Füllphase
zahlt. Nachgemessen, geradliniger Code:

| ALU-Befehle pro Sprung | CPI | MIPS @ 54 MHz |
|---|---|---|
| 4 | 1,286 | 42,0 |
| 12 | 1,133 | 47,6 |
| 48 | 1,039 | 52,0 |

Deckt den spezifizierten Bereich 1,0–1,3 (`doc/Deep16-Arch.md` §1.3). Referenz
6502 @ 1 MHz: 0,43 MIPS. **Die Zahlen in `book/kap01.md` §1.1 (27 Mio. IPs,
63× , 22×) stammen aus derselben Messung und sind entsprechend zu korrigieren.**

---

## Offene Punkte (aus `book/README.md`)

- Umfang pro Kapitel final kalkulieren.
- Wie viel 6502-Kontrast nach Kap. 1–3 noch erwünscht?
- Diagramm-Stil `block-beta` ist gesetzt; SVG-Export für Druck läuft über den
  bestehenden EPUB-Filter.