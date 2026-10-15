# STATUS.md — Fortschritt des Deep16-Buchs

> Ständig gepflegter Arbeitsstand. Letzte Änderung: 2026-10-15.
> Workflow-Regeln: [STYLE.md](STYLE.md).
>
> **2026-10-15:** **`see name`** — der Kern kann jetzt ein Wort **auseinandernehmen**
> statt es auszuführen. Eine Colon-Definition kommt als `: name … ;` zurück: der
> Thread wird Zelle für Zelle abgelaufen und jede `xt` über das Wörterbuch wieder
> zu einem Namen. Zellen mit **Inline-Daten** erkennt der Vorgänger: `lit` (Zahl),
> `litstr` (Zeichenkette, wieder als `." … "`), `(do)`/`(?do)` (die Ausstiegsadresse),
> `branch`/`0branch` (der Versatz). Andere Bauarten nennen das Wort, das sie gemacht
> hat — `variable`, `constant`, `create … does> …`, `vocabulary`, sonst `code`.
> Zwei Dinge werden **nicht** rekonstruiert: `if`/`then`/`begin`/`until` erscheinen
> als `(branch)`/`(0branch)` mit dem gespeicherten Versatz, und ein Wort, das die
> Suchordnung nicht erreicht, als `?<xt>`. Das Ende erkennt `see` an der **Adresse
> von `xt_exit`** (`;` kompiliert genau die, `exit` seine eigene Kennung) — deshalb
> bleibt der Rumpf nach einem `exit` mitten in der Definition sichtbar. Eine Zelle,
> die **kein** Wort benennt, ist keine Thread-Zelle: dort endet der Ablauf, statt in
> den Rest des Speichers zu laufen (das passiert bei einer Definition, deren `;`
> nie gelaufen ist). Details im Entscheidungs-Log.
>
> **2026-10-14 (dritter Teil):** **`do`/`loop` sind da** — mit `?do`, `leave`
> und `i`. Der Loop-Rahmen liegt auf dem Rückstapel, vier Zellen unter den
> Aufrufsrahmen. Die teuerste Falle war nicht der Inhalt, sondern die
> **Disziplin**: bei einer Zelle sind „RP zeigt auf die eben geschriebene" und
> „RP zeigt auf den untersten Rahmen" dasselbe, bei vier nicht — der Rahmen lag
> eine Zelle zu tief, `exit` bekam den Loop-Limit als Rücksprungadresse und die
> Maschine blieb stehen, lange nachdem alle Werte richtig aussahen. Damit sind
> **alle vier** „das kann der Kern nicht"-Vermerke in `forth/hanoi.fth`
> erledigt; der vierte (`2dup`) war nie einer. Offen bleibt nur Ausstattung, die
> kein Beispiel im Repo braucht (`+do`, `j`, `r@`/`r!`).
>
> **2026-10-14 (zweiter Teil):** `."` ist als IMMEDIATE-Wort fertig — in einer
> Definition wird der Text **beim Aufruf** gedruckt, nicht beim Übersetzen. Der
> als „Store schreibt nicht" notierte Blocker lag drei Ebenen darüber: der
> Assembler ließ den dritten Operanden einer dreistelligen ALU-Zeile fallen,
> **R9 ist ein ES-Base-Register** (PSW.ER = 8 mit Dual-Bit), und ein
> Leerzeichen im String galt als Trenner. Und von den vier „das kann der Kern
> nicht"-Vermerken in `forth/hanoi.fth` ist der vierte (**`2dup`**) zurückgenommen:
> der Testfall war falsch, nicht das Wort. Offen bleibt **`do`/`loop`**.
>
> **2026-10-14:** Am **Forth-Kern** (`asm/forth.asm`) — dem Kernprogramm des
> Projekts — wurde die älteste Lücke geschlossen. `forth/hanoi.fth` trug vier
> „das kann der Kernel nicht"-Vermerke; **zwei** davon sind erledigt
> (Hex-Literale, Bitoperationen), zwei bleiben (`.` `"` als IMMEDIATE-Wort,
> `do`/`loop`). Zusätzlich sind zwei Umwege weggefallen, die sich `hanoi.fth`
> wegen dieser Lücken selbst auferlegt hatte (`LWI`, Türme als `variable`).
> Die beiden teuersten Fehlerkategorien dieser Runde stehen im
> Entscheidungs-Log: eine verletzte **SP-Disziplin** meldet sich erst im
> *nächsten* Wort, und im Tokenizer sind nur **drei** Register frei — R5 und R6
> sind Aliase für `>IN` und `TIB`. Stand und Reihenfolge des Rests in
> „Nächste Schritte" Nr. 8.
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
| 7 | Ein Mini-Forth | ✅ fertig | beide Kerne | ✅ 1 SVG-Diagramm |
| 8 | Snake auf dem Bildschirmpuffer | ✅ fertig | beide Kerne | ✅ 1 SVG-Diagramm |
| A–D | Anhänge | ✅ fertig | alle drei Kerne | ✅ 1 SVG-Diagramm |

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
  `0x0062`, `0x1000`), Bildschirmzelle (Low-Byte = Zeichen, High-Byte =
  4 Bit Hintergrund über 4 Bit Vordergrund) mit Mermaid-Bitdiagramm,
  Listing 6-1/6-2.

  ⚠️ **Kapitel 6 beschreibt noch die alte Fassung** mit Bit 15 als
  Reverse-Video/Cursor und einem `0x8020` als Cursorwort. Die Beschreibung und
  Listing 6-1 gehören auf den neuen Stand gebracht.
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

### ✅ Kapitel 7 — `book/kap07.md` (1006 Zeilen)
- §7.1 Die REPL-Schleife: Listing 7-1 (Zeile lesen + Echo), Listing 7-2
  (Wort schneiden) samt der Lektion, dass `CMP R5, 32` am 4-Bit-Immediate
  scheitert (`Immediate value 32 out of range (0-15)`).
- §7.2 Wörterbuch: Listing 7-3 — lineare Suche über XOR-und-OR, dazu der
  Fehlerpfad. Sieben Eingaben (`ABC`, `DEF`, `GHI`, `AB`, `ABCD`, `XYZ`,
  `A`) mit gemessenen Opcodes und einem Fragezeichen für alles Unbekannte.
- §7.3 Zahlen: Listing 7-4 — Ziffernprüfung per `DIV` als Türsteher,
  Dezimalwandler mit `DIV32` (Quotient und Rest in einem Rutsch).
- **Beispiel:** Listing 7-5, das Schlussprogramm (261 Zeilen, die drei
  Stufen zusammengesetzt) — Zahl ausgeben oder Wörterbuch befragen.
- Zwei Fallen, die beim Schreiben real aufgetreten sind und jetzt im Text
  stehen: `MUL32` **überschreibt beide Operandenregister** (danach war
  `R10` = 0 und der nächste `DIV` teilte durch Null → `0xFFFF`), und das
  32-Bit-Paar steht **hoch in `Rd`**, niedrig in `Rd+1` — für Ergebnis
  *und* Dividenden. Beides fällt nicht auf, es rechnet nur falsch.
- Verifikation: `npm test` 296/296, Extractor `extract_kap07.mjs` 276/276
  (fünf Listings × Eingabefälle auf allen drei Kernen), Dreikern-Gleichlauf
  31 Listings ohne Abweichung.

### ✅ Kapitel 8 — `book/kap08.md` (669 Zeilen)
- §8.1 Adressrechnung: Listing 8-1 (Zelle (2,7) → `0x10A7`), Tabelle 8-1 mit
  den drei Randadressen, Listing 8-2 zeichnet den Rahmen (206 `*`, 1794
  Leerzeichen, 54463 Schritte, alle drei Kerne).
- §8.2 Scrollen: Listing 8-3 schiebt 1920 Wörter r��ckwärts; **1920/1920 Zellen
  wie erwartet**, 0 Abweichungen zwischen den Kernen. Die letzten 80 Zellen
  bleiben unberührt — korrekt, denn die unterste Zeile steht still.
- §8.3 Das Spiel: Listing 8-4 (247 Zeilen, zwei Unterprogramme `feld`/`setz`).
  Tabelle 8-3 listet **zehn gemessene Spielzüge** — einzelne Schritte, ein
  geschlossenes Quadrat (`dswa`), eine ignorierte Taste, `Enter` als Ausstieg
  (71 Schritte) und alle vier Randtreffer mit sichtbarem `X`.
- **Drei Fehler, die beim Bauen real aufgetreten sind und jetzt im Buch stehen:**
  Der Spaltenzähler stand *im Kopf* der Schleife, die ihn hochzählt (500000
  Schritte ohne `HALT`); `LINK` ist kein Aufruf, sondern setzt nur `LR`; und
  das Ergebnisregister der Adressrechnung wurde vom `LDI`-Scratch überschrieben
  — das Spiel schrieb daraufhin nach `0x0110` und `0x01C4`, also in den
  **Programmspeicher statt auf den Bildschirm**.
- Verifikation: `npm test` 296/296, Extractor `extract_kap08.mjs` 172/172
  (vier Listings × Fälle auf allen drei Kernen, inklusive vollständiger
  Bildschirmprüfung aller 2000 Zellen), Dreikern-Gleichlauf 35 Listings ohne
  Abweichung.

### ✅ Anhänge A–D — `book/anhang.md` (495 Zeilen)
- **Anhang A — Befehlsreferenz** in sieben Abschnitten (Laden/Segment,
  ALU/Schieben/MUL-DIV, Speicher, Sprünge, System, Pseudonyme, „Was es nicht
  gibt"). **67 von 67 Beispielwörtern am Assembler gemessen.** Zwei Korrekturen
  ergaben sich daraus, beide gegen die Intuition:
  `LDI -1` kodiert `7FFF` (nicht `FFFF` — die CPU erweitert vorzeichenrichtig,
  §6.2), und `JMP LR` ist `FBF8`, das Pseudonym für `MOV PC, LR, 0`.
- **Anhang B — PSW** mit dem Spickzettel-Diagramm (aus `book/test/mmtest.md`
  übernommen) und **Tabelle B-2**: welcher Befehl welches Flag setzt.
  Kernaussage: Lade- und Speicherbefehle setzen **keine** Flags.
- **Anhang C — Glossar** mit je einer Spalte „Bedeutung" und „auf dem 6502?",
  dazu eine zweite Tabelle der 6502-Begriffe und ihrer Entsprechung.
- **Anhang D — Quellen und Werkzeuge**: die drei Kerne, die Prüfbefehle, das
  Simulator-Fenster, die Spezifikation (mit dem Hinweis auf ihre veraltete
  Opcode-Tabelle), die bewusst ausgelassenen Themen **GFX, PSRAM**
  samt Wiedervorlage-Bedingung, und die Werkzeuge der Buchproduktion.
- **Befund an der Spezifikation:** Die **Opcode-Tabellen der Spec stimmen mit
  dem Assembler überein** — Schiebegruppe `110 10000`–`110 11011` (12/12),
  `MUL`/`DIV` `110 11100`–`110 11111` (4/4), Systemgruppe ab `11111111110`
  (4/4), jeweils durch Nachmessen des Assemblers belegt. Die frühere Notiz,
  die drei Opcode-Bereiche für veraltet hielt, war **selber veraltet**: der
  abweichende `MUL32`-Entwurf `[110][101][Rd4][w1][i1][Rs4]` wurde durch
  `110 11101` ersetzt, und die Spec-Zeilen standen in **jeder** Revision
  identisch (10 Commits zurück bis `1bce2ee`, ebenso in `old/`). Der
  einzige verbliebene Spec-Fehler ist semantischer Natur: Tabelle 14
  etikettierte `DIV32` als „32÷16→32-bit divide", obwohl der Quotient auf
  16 Bit gekappt wird (siehe Entscheidungs-Log). Die **33 Opcode-Diagramme
  der Kapitel 3–6 wurden gegen den Assembler geprüft und stimmen alle.**
- **Verifikation:** `probe_anhang_a.mjs` 67/67 Beispielwörter,
  `probe_diagramme.mjs` 33/33 Diagramme, `probe_reject.mjs` 26/26 abgelehnte
  6502-Befehle mit wörtlichen Fehlertexten, `npm test` 296/296.

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
| 2026-10-10 | **`npm run lint:rtl` wieder benutzbar**: Die Quellliste im npm-Skript kannte weder `deep16_cache.sv` noch `deep16_divider.sv`, obwohl `deep16_top` den Cache und `deep16_core` den Teiler instanziiert — Verilator brach mit „Cannot find file containing module" ab. Die Liste entspricht jetzt der des Build-Skripts (`scripts/build_rtl_native.sh`); Lint läuft mit `-Wall` fehler- und warnungsfrei durch. | `package.json` |
| 2026-10-10 | **Die vier offenen imm2-Punkte abgearbeitet**: **(1)** `MOV` hatte als einziger häufig benutzter Befehl **kein** Bit-Diagramm — ergänzt in Kap. 3 §3.1 mit den vier `imm2`-Funktionen (Tabelle 3-1, Listing 3-11, auf allen drei Kernen gemessen). **(2)** „Jede 16-Bit-Konstante kostet zwei Instruktionen" steht jetzt als Merksatz dort, gestützt auf die Messung `LDI 0x1234` + `MOV R5, R0` → `0x1234`. **(3)** `ALINK`/`ALNK` (Alias für `SMV Rx, APC`) fehlten im Buch — jetzt in Kap. 4 §4.2 mit Vergleichstabelle gegen `LINK` (gemessen `0x0101` gegen `0x0103`, bytegleiches Befehlswort `0xFEEF`) und Querverweis aus Tabelle 5-2 in Kap. 5. **(4)** Das `Jcc`-Ablaufdiagramm in Kap. 4 war mehrdeutig: „PC + 1" meinte die Adresse des `Jcc`, während die CPU im Slot bereits `PC + 2` ausgibt — neu beschriftet mit der **Ankunftsadresse `A`** und den gemessenen Werten (Slot `0x0105`, `MOV Rx, PC` im Slot liest `0x0106`). | `book/kap03.md`, `book/kap04.md`, `book/kap05.md` |
| 2026-10-11 | **Die vier Anhänge geschrieben** (`book/anhang.md`). Zwei Dinge, die beim Messen auffielen und deshalb jetzt dokumentiert sind: **(1)** Die Opcode-Tabelle in `doc/Deep16-Arch.md` ist in drei Bereichen veraltet — der Assembler kodiert die Schiebegruppe `110 10000`–`110 11011`, `MUL`/`DIV` `110 11100`–`110 11111` und die Systemgruppe ab `11111111110`. Die Spec wurde **nicht** geändert (sie gehört dem Parallelautor); Anhang A nennt die gemessenen Werte und weist die Abweichung aus, die 33 Opcode-Diagramme im Buch wurden gegenprüft und stimmen. **(2)** `LDI -1` kodiert `7FFF` und nicht `FFFF` — die einzige Codierung für `FFFF` ist `HLT`; genau die Lektion aus §6.2, jetzt an der Referenz sichtbar. `book/build/build-epub.sh` nimmt `anhang*.md` jetzt mit in den Build. | `book/anhang.md`, `book/build/build-epub.sh`, `book/epub/*` |
| 2026-10-11 | **Kapitel 8 „Snake"** geschrieben. Der Buchplan nannte „Terminal-Uhr oder Snake"; gewählt wurde Snake, weil der Simulator **keinen Timer-Port** kennt (nur `0xF0060`/`0xF0062` und den Bildschirmpuffer) — eine Uhr wäre damit nur über eine Schleifenzählung gegangen und hätte nichts über die Maschine gezeigt. Snake nutzt Adressrechnung, Blockverschiebung, Unterprogramme und Tastatureingabe gemeinsam. Vier Listings, alle drei Kerne, Extractor 172/172. | `book/kap08.md`, `book/epub/*` |
| 2026-10-11 | **Kapitel 7 „Ein Mini-Forth"** geschrieben, gestufter Aufbau nach Buchplan: Listing 7-1/7-2 (Zeile lesen, Wort schneiden), 7-3 (Wörterbuch mit Fehlerpfad), 7-4 (Zahl lesen und dezimal ausgeben), 7-5 (Schlussprogramm). Der Zwischenstand zum eintippen einer Quelldatei (`SERPLAN.md`: Zeilenlängengrenze, Taktung nach Warteschlangenfüllstand) ist noch nicht im Buch — Kapitel 8 oder Anhang D. Alle Zahlen auf JS-, WASM- und Verilog-Kern gemessen (Extractor 276/276). | `book/kap07.md`, `book/epub/*` |
| 2026-10-10 | **Architektur-Revisionen abgeglichen**: Die Revisionsdokumente im Repo-Root sind in STATUS.md unter „Architektur-Revisionen im Repo-Root" nach Thema, Stand und Buchrelevanz eingeordnet. Zwei sind bewusst **kein** Buchthema: `GFX.md`/`GFXOVERV.md` (Grafik-Kern GCoP, Design-Phase, ferne Zukunft) und `PLANPSRAM.md` (PSRAM-Backing-Store, **nicht umgesetzt**). `SERPLAN.md` (8/9 Schritte fertig) ist Material für Kapitel 7. Der aus `VERILOG.md` folgende dritte Kern **wurde ins Buch übernommen**: Kapitel 6 §6.2 spricht jetzt von drei Kernen, und Probe (71/71) wie Extractor (94/94) messen auf JS, WASM und RTL — die Schrittzahlen stimmen auch auf dem Verilog-Kern. Vermessungs-Workflow in `STYLE.md` §7 entsprechend auf drei Kerne gestellt. | `book/kap06.md`, `STYLE.md`, `STATUS.md` |
| 2026-10-10 | **Kapitel 6 „Der Simulator als Werkbank"** geschrieben: Speicherkarte (Tabelle 6-1), Tastaturports (Tabelle 6-2), Bildschirmzelle mit Bitdiagramm, die Kernfalle `LD`/`ST` sehen keine Ports, Delay-Slot-Falle messbar (`R1` = 5 statt 1), LDI-Mustergrenze, Debugger-Hooks. Alle Zahlen auf **allen drei** Kernen gemessen (Probe 71/71, Extractor 94/94). | `book/kap06.md`, `book/epub/*` |
| 2026-10-10 | **`LDI`-Bereich: Vermerk zurückgenommen, Semantik festgeschrieben.** Der vormerkte „Bereichsfehler" war eine **Fehldiagnose** — die obere Grenze `0x7FFF` ist korrekt. Spec §3.4 lautet `R0 ← sign_extend(imm15)`: der Operand ist ein **15-Bit-Muster**, alle 32768 Muster sind legal, und die Vorzeichenerweiterung findet in der **CPU** statt, nicht im Assembler. `LDI 20000` → `0xCE20` (`−12992`) ist auf beiden Kernen das *richtige* Ergebnis. Ein Versuch, die Grenze auf `16383` zu ziehen, hat `forth.asm`, `swi-test.asm`, `screen_demo.asm`, `string_demo.asm` und `asm/backup` zerlegt (80 Testfehler) sowie den Disassembler-Round-Trip gebrochen — der Disassembler gibt Immediates als rohes Hex aus, das sich dann nicht wieder laden ließ. **Regel:** Assembler prüft nur, ob der Wert in ein 15-Bit-Feld passt (`0..0x7FFF` oder `-16384..-1`, dieselben Muster in zwei Schreibweisen), nicht ob er in einen Vorzeichenbereich passt. Absicherung: `tests/disassembler.test.js` prüft jetzt alle 32768 Muster auf `disassemble → assemble`, STYLE.md §9 als eingefrorener Fact präzisiert, die irreführenden TODO-Kommentare in `js/deep16_assembler.js` ersetzt. Kapitel 2/3/6 und alle EPUBs bleiben unverändert — sie hatten recht. | `js/deep16_assembler.js`, `tests/disassembler.test.js`, `STYLE.md` §9 |
| 2026-10-10 | **`book/` aufgeräumt**: Ergebnisse nach `book/epub/`, Zwischenergebnisse (Pandoc-Stufe, Calibre-Round-Trip, Mermaid-PNGs) nach `book/build/` — bei jedem Build geleert, per `.gitignore` nicht versioniert. `book/` enthält damit nur noch Quellen (`kap*.md`), Werkzeuge (`build-epub.sh`, `mermaid_filter.lua`, `normalize_epub.py`), das Mermaid-Test-Fixture `test/` und die beiden Artefaktordner. | `book/epub/`, `book/build/`, `book/build/build-epub.sh`, `STYLE.md` §6 |
| 2026-10-10 | **Divider neu: handgeschrieben, iterativ, Radix-4.** Drei Befunde führten dazu. **(a)** Das RTL benutzt die Verilog-Operatoren `quot32 = dividend32 / {16'h0000, opv_i}` und `rem32 = dividend32 % {...}` (`rtl/deep16_alu.sv:235-236`) — Verilog sieht **32/32**, ein Synthesizer inferiert zwei volle 32-Bit-Teiler. Die Architektur meint aber 32÷16 mit **16-Bit-Quotient und 16-Bit-Rest**; `quot32[15:0]`/`rem32[15:0]` verwerfen die oberen Hälften ohnehin. Ein echter 32÷16 braucht nur ein **18-Bit-Arbeitsregister**, nicht 33 — das war in der ersten Auslegung dieses Dokuments falsch angesetzt. **(b)** Unverändert ergäbe das ~1200–2000 LUT und **8–16 MHz**; der Teiler wäre der Taktbegrenzer des ganzen Kerns. **(c)** Iterativ **entkoppelt die Breite vom Takt**: der kritische Pfad ist nur noch *eine* Iteration (18-Bit-Kette + 2 LUT-Level + Routing = 2,2–4,5 ns), also **222–455 MHz** und bei 54 MHz 4–8× Reserve. Gewählt wird **Radix-4** (2 Dividend-Bits je Iteration, **16 statt 32 Takte**) für den Durchsatz: Misch-CPI 6,20 → **3,53**, also 8,7 → **15,3 MIPS @54 MHz**. ⚠ *Korrigiert nach der Umsetzung:* die erste Fassung nannte **8 Takte / 24,5 MIPS**. Falsch — der 32÷16-Quotient ist 32 Bit breit und wird erst am Ende auf 16 Bit gekürzt, also müssen alle 32 Dividend-Bits aus `rem = 0` verbraucht werden. Radix-4 bleibt die richtige Wahl (es halbiert die Iterationen gegenüber Radix-2), ist aber halb so schnell wie zunächst behauptet. **Gemessen: 16,0 Takte** über `ADD`. Fläche: **~300–450 LUT** (gegenüber ~100–160 für Radix-2 und ~1200–2000 für den inferierten) — bei 300–450 LUT bleibt der Fmax bei ~5–7 ns je Iteration, also ~2,6–3,7× Reserve bei 54 MHz. `DIV` (16÷16) und `DIV32` (32÷16) teilen **einen** Kern (16÷16 = 32÷16 mit Nullbits im Dividend); Quotient und Rest fallen im Restoring-Verfahren gemeinsam an, die Doppel-Operatoren entfallen. Preis: 16 Takte statt 1 je Division. **Bleibt zu erhalten:** die Sonderfälle `opv == 0 → 0xFFFF` und die Ablehnung ungerader Zielregister bei `DIV32` (`rd[0]`). Danach ist der Teiler **nicht mehr** der kritische Pfad — der ist dann der Rest von EX (228-Bit-State-Bypass, ALU mit 32 Funktionen, Schieberegister, Ergebnisauswahl), geschätzt 8–15 ns. | `rtl/deep16_alu.sv`, `rtl/deep16_core.sv` (`stall`) |
| 2026-10-11 | **MUL/DIV-Abgleich Spec ↔ drei Kerne: zwei Befunde, ein echter, ein Fehlalarm.** Anlass war die Meldung, die Opcode-Tabelle der Spec weiche für Schiebegruppe, `MUL`/`DIV` und Systemgruppe vom Assembler ab. **(1) Echter Fehler, semantisch:** Spec Tabelle 14 etikettierte `DIV32` als „32÷16→32-bit divide". Gemessen rechnet `DIV32` **32÷16 mit 16-Bit-Quotient und 16-Bit-Rest** — der Quotient wird gekappt (`0xFFFFFFFF / 1` → `Rd=0xFFFF`, nicht `0xFFFFFFFF`; `0x00012345 / 1` → `Rd=0x2345`). Das ist gewollt und in `rtl/deep16_alu.sv` sowie `rtl/deep16_divider.sv` kommentiert; nur das Etikett war falsch. Spec Tabelle 8, Anhang A und die Buchkapitel waren bereits richtig, `MUL32` trägt dasselbe Etikett und ist korrekt (32 Bit bleiben vollständig erhalten). Etikett in `doc/Deep16-Arch.md` berichtigt — die einzige angefasste Spec-Zeile, nach ausdrücklicher Freigabe, weil die Spec dem Parallelautor gehört. **(2) Fehlalarm:** die drei behaupteten Opcode-Abweichungen existieren nicht. Nachgemessen Schiebegruppe 12/12, `MUL`/`DIV` 4/4, Systemgruppe 4/4 MATCH; die Spec-Zeilen standen in **jeder** Revision identisch (10 Commits zurück bis `1bce2ee`, ebenso in `old/Deep16-Arch-M3r1.md` und `old/Deep16-Arch-v5.2.md`). Der Zusatz „statt `110 10…`" hat keine Entsprechung in irgendeiner Spec-Fassung. Historisch abweichend war nur der `MUL32`-Entwurf `[110][101][Rd4][w1][i1][Rs4]` im Assembler, ersetzt durch `110 11101` — die Doku-Aussage war damals berechtigt und wurde beim Umbau nicht nachgezogen, sie war also selbst das, was sie bei der Spec kritisiert. **Lehre:** eine Doku-Aussage über eine andere Quelle ist selbst eine Behauptung und braucht denselben Nachweis wie der Code. Verifikation: 211 gerichtete + 800 Zufallsfälle über `MUL`/`MUL32`/`DIV`/`DIV32` gegen JS-, WASM- und RTL-Kern, **0 Abweichungen**; `divtest.cpp` (Radix-4 gegen Verilogs `/` und `%`) besteht; `npm test` 296/296. **Kein Code geändert.** | `doc/Deep16-Arch.md`, `STATUS.md`, `book/anhang.md` |
| 2026-10-10 | **Dritter CPU-Kern in SystemVerilog** (`rtl/`, Verilator + Emscripten), 5-Stufen-Pipeline und 4KB-Cache, in der IDE als **Kern** wählbar (JS / WASM / RTL). Zwei Grundsätze haben sich als tragend erwiesen und sollten bei einem vierten Kern wiederholt werden: **(a)** Der Cache ist **per Konstruktion transparent** — bei einem Miss liefert das Top-Level weiter aus dem Speicherarray aus, die Pipeline stallt nie und die (verifizierte) Pipeline-Steuerung bleibt unangetastet. **(b)** Nebenwirkungen außerhalb von WB brauchen eine Bedingung *„verlässt die Stufe in diesem Takt"* — sonst feuert der Tastatur-Pop über die Schrittgrenze hinweg mehrfach. Drei Kernfehler dieser Runde waren jeweils **eine** fehlende Bedingung, nicht schlechte Logik: `fill_base` nach Cachebarkeit statt nach dem Miss gewaehlt, Invalidierung per `eval()` ohne posedge (stiller No-op), veraltete Zeile nach Store ohne Write-Allocate. Dazu zwei Fehler im Prüfwerkzeug selbst, die beide wie eine Kerndivergenz aussahen: `set_registers()` legt Index 15 auf den *aktiven* PC, und ein Seed, der nur einen PC setzt, laesst im Schattenkontext den anderen auf 0. **Lehre:** bei einer Divergenz zuerst *das Werkzeug* prüfen, nicht das Werk. Verifikation: Decode-Sweep 524288 Ausführungen, 0 Abweichungen (4 Seeds), `tests/fuzz.test.js` mit 60 Zufallsprogrammen, 239/239 Tests gruen. Für die Doku: `README.md` auf drei Kerne gezogen, `VERILOG.md` als Plan- und Entscheidungslog geführt. | `rtl/`, `index.html`, `js/deep16_ui_core.js`, `tests/rtl.test.js`, `tests/fuzz.test.js`, `README.md`, `VERILOG.md` |
| 2026-10-14 | **Hex-Literale im Zahlen-Scanner** (`0x1F`, `0X1F`, `$1F`). Bisher nur dezimal, deshalb war ein Hex-Literal ein „undefined word" — und deshalb führt `forth/hanoi.fth` seine Farbbytes als Dezimalzahlen und der Kommentar neben dem Attributcode baut die Maske von Hand. Der Präfix-Test steht **vor** dem Ziffern-Test: `'$'` sortiert unter `'0'`, ein `$FF` wäre also als Wort gelesen worden, und `0x..` muss abgefangen werden, solange `>IN` noch auf dem `'0'` steht. Ein Präfix ohne Ziffern wird als **Wort** gemeldet, nicht stillschweigend zu 0 — eine 0 ist eine Zahl, die richtig aussieht. **Registerbudget:** im Tokenizer leben R0, R1, R2, R3, R4, R7, R12 plus die Aliase R5 (`>IN`), R6 (`TIB`), R13/R14 (SP/LR); R8 ist `SCR`. Es bleiben **R9, R10, R11** und sonst nichts — zwei Fehlversuche habenjeweils R5 oder R6 gegriffen, also `>IN` selbst und `TIB`. `>IN` taugt auch nicht als „Ziffer gelesen"-Flag, weil schon das Präfix es weiterzählt: `0x .` sieht exakt aus wie eine Zahl, die am Leerzeichen endete. Suite 377/377. ⚠ *Korrigiert am 2026-10-14:* die Liste der freien Register war falsch — **R9 ist keines**. `PSW.ER = 8` mit Dual-Bit macht R8 **und R9** zum ES-Base-Paar, jedes `ST/LD Rx, R9, n` geht über ES. Als *Wert* bleibt R9 benutzbar, als Adressregister nicht; frei sind R10 und R11. Siehe den `."`-Eintrag unten, dem dieser Fehler zugrunde lag. | `asm/forth.asm`, `tests/forth.test.js` |
| 2026-10-14 | **Die Bitoperationen `and` `or` `xor` `invert` `lshift` `rshift`.** Die ersten vier sind je **ein** Befehl. Die Schiebungen nicht: `SL`/`SR` nehmen ihre Zahl als **4-Bit-Immediate** (Tabelle 6) und haben keine Registerform — eine Laufzeit-Zahl muss Bit für Bit getaktet werden, wobei der Wert jedes Mal wieder vom Stapel geholt wird, weil es keinen Platz gibt, der den Schiebevorgang übersteht. Eine Zahl ≥ 16 schiebt alles heraus und wird auf 0 verkürzt: `1 100 lshift` wären sonst 100 Runden, `1 65535 lshift` 65535. Der Standard lässt den Typ offen und verlangt keinen 16-Bit-Schiebebereich — die Gesamtheit zurückzugeben ist brauchbarer, als eine große Zahl in einen Hänger zu verwandeln. **Die teuerste Lektion dieser Runde, vier Fehlversuche:** ein binäres Wort liest `b` von SP, erhöht SP **einmal** und liest `a` durch dieselbe Instruktion — `a`s Platz wird damit der Ergebnisplatz. `word_mul` ist die Vorlage und tut **genau einen** Schritt. Ein zweiter Schritt landet auf der Leer-Marke, und der Fehler wird vom **nächsten** Wort gemeldet: `12 10 and .` zeigte „stack underflow", und der Unterlauf war in `.`, sechs Instruktionen weiter. Alle vier Versuche lasen das als „die Bitwörter laufen unter" und haben Prolog, Header-Verdrahtung und Befehlskodierung ausgechlossen — alle drei waren korrekt. **Zweite Falle:** in `x n lshift` liegt `n` **oben**, weil `x` zuerst gelegt wurde. Liest man das oberste als `x`, zählt jedes Schieben mit `x` und schiebt `n`; das ergab bei jedem Ergebnis `2 × n` und hat den Fehler benannt. `rshift` ist logisch (Nullen ab Bit 15); die ISA hat **keine** arithmetische Schiebung, wonach man fragen könnte. Die Header liegen zwischen `h_cls` und `h_scr_fetch`, damit der Schwanz der Kette seine alten Verbindungen behält, und `forth_wl` zeigt weiter auf `h_cls`; ein Test läuft die Kette ab und prüft Zyklusfreiheit und Vollständigkeit. **Nicht adressiert:** `drop` akzeptiert einen leeren Stapel — vorbestehend, nicht von dieser Änderung berührt. Suite 377/377. | `asm/forth.asm`, `tests/forth.test.js` |
| 2026-10-14 | **`LWI` ergänzt** (`R0 ← b15(b15(Rx))`, Fehler, wenn es kein solches Feld gibt) und die **Türme in `hanoi.fth` auf `variable … 6 cells allot` umgestellt.** Damit fallen die beiden Umwege weg, die `hanoi.fth` sich wegen dieser Lücken selbst auferlegt hatte. Bildschirminhalte bei 3/4/5 Scheiben byteweise gleich. | `asm/forth.asm`, `forth/hanoi.fth`, `tests/assembler.test.js` |
| 2026-10-14 | **`."` als IMMEDIATE-Wort — fertig.** In einer Definition erscheint der Text jetzt **beim Aufruf**, nicht beim Übersetzen: beim Übersetzen wandern die Zeichen in die Definition, und es bleibt `xt_lit <adresse> xt_litstr <zeichen> 0` liegen; `litstr` druckt zur Laufzeit und schiebt den Thread über den String, wie `lit` über seine Inline-Zelle. Der Weg war im Vermerk vom selben Tag als „`ST R4, R9, 0` schreibt nicht" notiert — **die Stores waren nicht das Problem**, und die Diagnose „der Store-Encoder behandelt R9 anders" ging an der Sache vorbei. Drei Fehler lagen übereinander, jeder für sich harmlos aussehend: **(1) Der Assembler ließ den dritten Operanden einer dreistelligen ALU-Zeile ohne ein Wort fallen.** Die ALU-Gruppe ist in beiden Formen zweistellig (Spec Tabelle 6): `Rd, Rs` rechnet `Rd ← Rd OP Rs`, `Rd, imm` rechnet `Rd ← Rd OP imm`. `ADD R11, R9, 1` wurde deshalb als `R11 ← R11 + R9` übersetzt — im Wörterbuch stand danach eine Unsinnsadresse. Dreistellige Zeilen werden jetzt abgewiesen, wie `MOV … +1`. **(2) R9 ist kein freies Register.** `PSW.ER = 8` mit Dual-Bit (PSW-Setup am Dateianfang) macht **R8 und R9** zum ES-Base-Paar; jedes `ST Rx, R9, n` landete auf `ES:R9 = 0xF0000 + R9`, also auf dem **Bildschirm**. Der Zielzeiger ist jetzt R11; R9 bleibt als *Wert* in Ordnung. Damit ist die Notiz vom 2026-10-14, nach der im Tokenizer „R9, R10, R11" frei seien, **falsch** —siehe dort. **(3)** Ein Leerzeichen im String galt als Trenner und fiel stillschweigend weg. Der Sprung über den String war die vierte, erst beim Aufruf sichtbare Falle: ohne ihn liest `next` das erste Zeichen als xt und springt in den ASCII-Wert. Tests: acht Fälle in `forth.test.js` (Aufrufzeit, zwei Strings in einer Definition, Maskierung `\"`, leerer String, nacktes `"`, Mehrfachaufruf, Stapelverhalten), ein JS/WASM-Paritätsfall in `shadow.test.js` und zwei Assembler-Fälle in `assembler.test.js`. Alle drei Kerne liefern byteweise dasselbe Bild. | `asm/forth.asm`, `js/deep16_assembler.js`, `tests/forth.test.js`, `tests/shadow.test.js`, `tests/assembler.test.js` |
| 2026-10-14 | **`do`, `?do`, `loop`, `leave`, `i` — die letzte der vier Lücken.** Der Kern hatte keinen Loop mit eigenem Parameter-Stapel; die einzige Stelle, die einen Rumpf überlebt, ist der **Rückstapel**: der Datenstapel gehört dem Rumpf, der ihn nach Belieben benutzt. Der Loop-Rahmen liegt dort wie ein Aufrufsrahmen und ist **vier Zellen** breit: `RP+0 exit`, `RP+1 body`, `RP+2 index`, `RP+3 limit`. `do` ist IMMEDIATE und legt `LIT <ausstieg>` + `xt_do` ab; die Ausstiegsadresse kennt erst `loop`, deshalb ein Platzhalter auf dem Kompilier-RP, den `if`/`then` genauso benutzt. Zur Laufzeit sieht `10 0 do i . loop` so aus: `LIT 10  LIT 0  LIT <exit>  (do)  i  .  (loop)` — beim Zählen steht `i` im Weg, deshalb schiebt es sich beim Rücksprung in den Rahmen und ersetzt die Sprungzelle durch `index++; if (index == limit) pop else IP = body`. `(loop)` fällt einfach durch, wenn IP schon hinter seiner eigenen Zelle steht: **es braucht gar keinen Sprung im Thread**, nur eine Adresse, die einmal beim Übersetzen geflickt wird. **Die teuerste Falle dieser Runde war die RP-Disziplin.** `docol` schreibt *eine* Zelle, und RP landet darauf — bei einer Zelle sind „RP zeigt auf die eben geschriebene" und „RP zeigt auf den untersten Rahmen" ununterscheidbar. Bei vier Zellen sind sie es nicht, und der Rahmen wurde zuerst in umgekehrter Reihenfolge gelegt: RP stand danach **eine Zelle zu tief**, `loop` las den Index aus der **Rücksprungadresse des Aufrufs**, und `exit` bekam beim Abbau den **Limit** als Rücksprungadresse — der Kern lief in unbeschriebenen Speicher und blieb stehen. Nicht die Werte waren falsch, sondern die Maschine war tot, und der Fehler meldete sich als „Hänger" an der falschen Stelle: die Definition lief, der Aufruf danach nicht mehr. **Zweite Falle, gleiche Gegend:** ein `loop` ohne `do` davor ist undefiniert, popped aber blind — es schlägt in den Kompilier-RP, flickt, wohin es will, und killt die Maschine. `loop_depth` zählt die Paare beim Übersetzen, ein verwaistes `loop` übersetzt gar nichts. Das ist die einzige unausgeglichene Kontrollanweisung im Kernel, die geprüft wird (`then` ohne `if` schreibt in eine harmlose Zelle), und aus genau dem Grund: der verhinderte Fehler ist der, der die Maschine mitnimmt. **`?do` ist nichtBeiwerk:** der Standard zählt **nach** dem Rumpf, `0 0 do ... loop` läuft deshalb 65536-mal, bis der Index über den Zellwert herum wieder auf dem Limit landet — der klassische 16-Bit-Fallstrick. `?do` überspringt den ganzen Loop (nicht nur den Rumpf: das passende `(loop)` fände sonst keinen Rahmen) und springt auf dieselbe Ausstiegsadresse, die `loop` ohnehin flickt. Tests: elf Fälle in `forth.test.js` (Zählen, `limit = start`, `?do`, Verschachtelung, `leave`, Rahmen über Aufrufsgrenzen, zwei Loops in einer Definition, verwaistes `loop`, Unterlauf in `(do)`, Kette), ein RTL-Fall in `rtl.test.js` und die Kette in `forth.test.js`. JS, WASM und RTL liefern byteweise dasselbe Bild. | `asm/forth.asm`, `tests/forth.test.js`, `tests/rtl.test.js`, `forth/hanoi.fth` |
| 2026-10-14 | **`2dup` und `drop` — der vermerkte Fehler war keiner.** Zwei Einträge von heute Nachmittag sind zurückgenommen, beide mit derselben Ursache: der *Testfall* war falsch, nicht das Wort. `1 2dup . . .` meldet „stack underflow" — das ist **richtig**, `2dup` braucht zwei Werte und es lag nur einer da. Nachgemessen an der ganzen Familie: `1 2 2dup . . . .` → `2 1 2 1`, `1 2 2dup depth .` → 4, `1 2 2drop . .` → underflow (der Stapel war leer, `.` bekam nichts), `2dup` auf leerem Stapel → underflow, ebenso `dup` und `drop` einzeln. Der zweite vermerkte Punkt, „`drop` nimmt einen leeren Stapel ohne Meldung", war derselbe Irrtum: `12 10 and drop` meldet `ok`, weil `and` einen Wert hinterlässt und `drop` ihn nimmt — danach ist der Stapel leer, und das folgende `.` meldet zu Recht underflow. Was den Befund erzeugt hat, ist der **Fehlerpfad**: er lässt den Datenstapel unangetastet, sodass nach einem underflow die Reste weiter unten liegen bleiben und das *nächste* Wort sie sieht. Das ist in diesem Kernel gewollt (ANS definiert den Stapel nach einem Fehler als undefiniert) und wird hier **nicht** geändert; `tests/forth.test.js` pinnt das Verhalten inzwischen an beiden Stellen. **Lehre:** ein gemeldeter Unterlauf beweist einen Unterlauf — er beweist nicht, welches Wort ihn ausgelöst hat. | `asm/forth.asm` (unverändert), `STATUS.md` |
| 2026-10-15 | **`see name` — der Decompiler.** Der Kern kann jetzt den **Bau** eines Wortes zeigen statt es auszuführen. Fünf Bauarten werden unterschieden, jede über ihr **Code-Feld** (`[CFA]`): `docol` → `: name … ;`, `dovar` → `variable name`, `doconst` → `constant name <wert>`, `dodoes` → `create name` (und `does> … ;`, wenn der DOES>-Zeiger `[CFA+1]` nicht Null ist), `dovoc` → `vocabulary name`, alles andere → `code name`. **(1) Der Thread-Ablauf** liest Zelle für Zelle ab `CFA+1` und löst jede `xt` über **umgekehrte** Suche wieder zu einem Namen auf: die Suchordnung ablaufen, je Wortliste die Header-Kette (neueste zuerst), `CFA = header + 3 + len` rechnen und mit dem Ziel vergleichen — nicht gefunden heißt `?<xt>`. Eine Zelle, die **kein** Wort benennt, ist damit keine Thread-Zelle — der Ablauf **endet** dort, statt in den Rest des Speichers zu laufen; ohne diese Schranke lief `see` bei `: n 1 2 nosuchword ;` (die Definition, deren `;` nie lief) bis zum Bildschirmrand, weil sie jeden 0xFFFF-Zellenrest als „Wort" ausgab. **(2) Inline-Zellen** erkennt der Vorgänger, sonst stünde eine Zahl oder ein Zeichen als „Wort" im Ausdruck: `lit` + Operand (signed), `lit` + Adresse + `litstr` + Zeichen (als `." … "`, bis zur NUL), `lit` + Ausstiegsadresse + `(do)`/`(?do)`, `branch`/`0branch` + Versatz, `(loop)`/`leave` je eine Zelle. **(3) Das Ende** ist die **Adresse von `xt_exit`**, nicht das Code-Feld `exit`: `;` kompiliert genau diese Adresse, `exit` seine eigene Kennung — mit dem Code-Feld als Kriterium hätte ein `exit` **mitten** in einer Definition den Rest verschluckt (`: f 1 exit 2 ;` zeigte `: f 1 ;`). **(4) Registerdisziplin:** R5 (`>IN`) und R6 (`TIB`) müssen überleben, R8 (`SCR`) ist der Ausgabezeiger und wird absichtlich weitergezählt; R9 ist wie in `."` ES-Base und nie Adressregister. Der Thread-Zeiger lebt in `see_ptr` statt in einem Register, weil `print_number` und die Namenssuche jeden Arbeitsregister-Wert zerstören; die Helfer kommen je mit einem eigenen LR-Platz aus, weil `LINK` das LR überschreibt. **(5) Ausgabe** geht als direkter `STS`-Schreibzugriff auf den Bildschirm (kein BIOS/SWI, damit RP und Register unangetastet bleiben), mit führendem Leerzeichen, weil die REPL die Eingabezeile **ohne** abschließendes Leerzeichen zurückspiegelt. **Falle, die den ersten Testlauf kostete:** `LDI ';'` ist unzulässig — der Assembler schneidet die Zeile am ersten `;` ab (`line.split(';')[0]`), dieselbe Ursache, aus der `h_semicolon` sein Semikolon als `.word 59` ablegt. **Nicht rekonstruiert (bewusst):** `if`/`then`/`begin`/`until`/`while`/`repeat` erscheinen als `(branch)`/`(0branch)` mit dem gespeicherten Versatz — die Struktur dafür bräuchte den ganzen Kontrollfluss-Baum, und der Versatz ist das, was wirklich im Wörterbuch steht. Elf Tests in `forth.test.js` pinnen die Ausgabeformen; `see` steht außerdem in der `words`-Liste. Suite 156/156 (`forth`) grün. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md`, `STATUS.md` |

## Architektur-Revisionen im Repo-Root

Das Buch erzählt die Deep16 so, wie sie **heute** ist. Damit es dabei nicht
stillschweigend veraltet, sind hier die Architektur-Dokumente aus dem
Repo-Root eingeordnet: Thema, tatsächlicher Stand, und was daraus für das
Buch folgt. Drei davon sind bewusst **kein** Buchthema.

| Dokument | Thema | Stand | Bedeutung für das Buch |
|---|---|---|---|
| `ARCHREV.md` | `MOV imm2` als Funktionsauswahl statt Addition | ✅ umgesetzt **und im Buch** | 2026-10-08 in Kap. 2 (§2.1, Tabelle 2-1) und Kap. 4 (§4.2) übertragen |
| `VERILOG.md` | dritter Kern: Verilog → Verilator + Emscripten | ✅ Phase 0–2 abgeschlossen, dreifache Parität grün, Decode-Sweep über alle 65 536 Befehlswörter ohne Abweichung | **im Buch eingearbeitet** — Kap. 6 §6.2 spricht jetzt von drei Kernen, `STYLE.md` §7 misst auf allen drei |
| `SERPLAN.md` | Quelltext über die Tastatur in den DeepForth-Kern eintippen | 🟡 Der serielle Weg ist **verworfen** und zurückgebaut; übrig bleibt der Knopf im Screen-Tab, im Browser unbestätigt | **Material für Kapitel 7** (Mini-Forth) — noch kein Kapiteltext |
| `PLANPSRAM.md` | PSRAM-Backing-Store für die FPGA | ⛔ **nicht umgesetzt** (Plan) | ❌ **kein Buchinhalt** |
| `FLASHPLAN.md` | Forth-Blocks auf dem Tang Nano 9K (Config-Flash via MSPI) | ⛔ **nicht umgesetzt** (Design); Block = 4-KB-Sektor, 80×24-Textfenster | ❌ **kein Buchinhalt** — Kandidat für Kapitel 9, sobald gebaut |
| `GFX.md`, `GFXOVERV.md` | Grafik-Subsystem GCoP | 🟡 Design-Phase, **ferne Zukunft** | ❌ **kein Buchinhalt** |
| `deep16_project_summary.md` | IDE-Entwicklungsstand (alt) | ⚪ überholt | — |

### Warum GFX, PSRAM und Flash draußen bleiben

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
- **`FLASHPLAN.md` ist ein Entwurf, kein Bau.** Er beschreibt einen
  Forth-Blockspeicher auf dem Config-Flash des Tang Nano 9K (über MSPI), mit
  Block = 4-KB-Sektor. Es gibt weder Gerätemodell noch RTL noch Messwerte.
  **Auslöser:** sobald das Gerätemodell im JS-Kern läuft (Phase 1), ist die
  Kapitel-6-Speicherkarte um die Storage-Ports zu ergänzen und ein Kapitel 9
  über den Forth-Kern möglich.

Alle drei bleiben hier sichtbar, damit niemand sie für vergessen hält: ein
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
4. ✅ **Kapitel 7** abgeschlossen (Mini-Forth, Listings 7-1 bis 7-5) und
   ✅ **Kapitel 8** abgeschlossen (Snake, Listings 8-1 bis 8-4).
5. ✅ **Anhänge A–D** abgeschlossen (`book/anhang.md`). Damit ist der
   Buchplan aus `book/README.md` ausgeschöpft: 8 Kapitel + 4 Anhänge.
6. ✅ **Kommentare** (2026-10-11): `\` bis zum Zeilenende und `( … )` bis zur
   schließenden Klammer. Beide werden vom **Tokenizer** erkannt und nicht im
   Wörterbuch nachgeschlagen — deshalb funktionieren sie am Prompt und in einer
   Definition gleichermaßen, denn ein Kommentar wird dem Compiler nie
   angeboten. Details unten.
7. **Offen, wenn es weitergeht:** `EVALUATE` und die Bestätigung, dass eine
   Quelldatei im Browser eingetippt wird — beides Material für ein Kapitel 9
   über den Forth-Kern, der das Kernprogramm des Projekts ist.
8. **Der Forth-Kern ist das Kernprogramm des Projekts und war der am
   längsten liegengebliebene Teil.** `forth/hanoi.fth` trug vier „das kann der
   Kern nicht"-Vermerke; **alle vier** sind erledigt (Hex-Literale,
   Bitoperationen, `."`, `do`/`loop`) — der vierte (`2dup`) war nie einer, der
   Testfall dahinter war falsch. Dazu sind zwei Umwege weggefallen, die sich
   `hanoi.fth` wegen dieser Lücken selbst auferlegt hatte (`LWI`, Türme als
   `variable`).
   1. ✅ **`."` als IMMEDIATE-Wort** — der Text wird in die Definition kopiert
      und beim Aufruf gedruckt.
   2. ✅ **`do`/`loop`** — mit `?do`, `leave` und `i`. Der Rahmen liegt auf dem
      Rückstapel. `hanoi.fth` rechnet trotzdem mit `begin`/`until` und
      `while`/`repeat`: die Schleifen dort sind geschrieben und getestet, und
      eine funktionierende Datei umzuschreiben, nur weil das Werkzeug später
      kam, wäre Bewegung ohne Fehlerbehebung.
   3. ~~**`2dup`**~~ — **kein Fehler.** `1 2dup` meldet zu Recht Unterlauf,
      weil nur ein Wert auf dem Stapel liegt; der Testfall war falsch, nicht
      das Wort. Siehe Entscheidungs-Log.
   4. ✅ **`see name`** (2026-10-15) — der Decompiler: ein Wort wird nicht
      ausgeführt, sondern gezeigt (`: name … ;`, `variable`, `constant`,
      `create … does> …`, `vocabulary`, `code`). Was **bewusst** offen bleibt:
      `if`/`then`/`begin`/`until` erscheinen als `(branch)`/`(0branch)` mit
      dem gespeicherten Versatz statt als rekonstruierte Struktur — dafür
      bräuchte es den ganzen Kontrollfluss-Baum. Siehe Entscheidungs-Log.
   **Was an `do`/`loop` noch fehlt** (nicht auf der Liste, nur notiert):
   `+do` (Startabstand), `j` (Index der äußeren Schleife), `u`/`unloop` und
   die Rückstapelwörter `r@`/`r!`. Für `hanoi.fth` wird keines gebraucht.
   **Methode, die sich bewährt hat:** erst die strukturelle Bedingung prüfen
   (Registerbudget, Header-Kette, SP-Disziplin), dann das Verhalten. Bei den
   Bitwörtern hat die umgekehrte Reihenfolge vier Anläufe gekostet. Der
   Satz gilt in beide Richtungen: bei `."` hat die Verhaltenssuche
   (`ST R4, R9, 0` schreibt nicht) den Verdacht auf den Store-Encoder gelenkt,
   der Fehler lag in drei Ebenen darüber — ein stillschweigend fallengelassener
   Operand, ein ES-Base-Register und ein Trenner im Text. Beim Loop war es die
   andere Richtung: die Werte stimmten, und die Maschine starb trotzdem, weil
   die **Disziplin** des Rückstapels stimmen muss, nicht nur sein Inhalt.

---

## Zurückgestellt

Punkte, die gemeldet und bewusst **nicht sofort** bearbeitet wurden. Punkt 1
ist inzwischen erledigt, Punkt 4 kam am 2026-10-11 dazu und ist abgeschlossen.

**Offen ist nur noch Punkt 2 (mobiles UI).**

### 1. ~~`SERLOAD` funktioniert im Browser noch nicht~~ — erledigt auf anderem Weg

Der serielle Weg ist am 2026-10-11 **verworfen und vollständig zurückgebaut**:
Es gab eine zweite Betriebsart für etwas, das die Tastatur schon kann. Jetzt
tippt der Knopf **„Datei tippen…"** im Screen-Tab die Datei als Tastatureingabe
ein. Die Begründung und die Details stehen in `SERPLAN.md`.

Offen bleibt nur, dass der Ablauf **im Browser nie gelaufen ist**.

### 2. Das mobile UI muss aufgeräumt werden

Kein Fehler, sondern Struktur. Die bekannten Stellen:

- **Ein Knopf muss an drei Orten eingetragen werden**: im Markup, in
  `initializeMobileControls()` und in `restoreDesktopLayout()`. Genau daran ist
  der frühere `SERLOAD`-Knopf auf dem Handy verschwunden. Ein Test
  (`tests/ui-core.test.js`) prüft das inzwischen für alle Knöpfe im Panel-Kopf,
  trägt aber nicht das Markup selbst.
- **`.memory-panel-controls` steht zweimal in `css/memory.css`** (zweimal
  `display:flex`, einmal `gap: 4px` mit `margin-left:auto`, einmal `gap: 18px`
  ohne) — die spätere Regel gewinnt still.
- **Drei ineinander geschachtelte Media Queries** (768 / 900 / 480 px) mit
  Überschneidungen; die 900-px-Regel liegt zwischen den beiden anderen.
- **Die Knopfbreiten kommen aus JavaScript** (`--mobile-btn-w`, gesetzt in
  `initializeMobileControls` aus der gemessenen Breite des View-Schalters).
  Ein Label muss deshalb fürs Handy gekürzt werden, damit es nicht abschneidet —
  ein Ort, an dem man danach nicht suchen würde.

### 3. Die BIOS-Routinen dürfen ihre Länge nicht ändern  *(NEU, 2026-10-11)*

**Beim Umbau des Farbbytes gefunden.** `swi_to_bios` ist ein verzögerter
Fernsprung nach `CS=0xF800`, und der Kern lässt beim Zurückkehren den
Sprungzustand stehen. Solange der anhängt, gilt die *nächste* Instruktion als
Delay-Slot **dieses alten Sprungs** und der alte Zielpunkt wird erneut genommen.
Normalausgang ist, dass die Instruktion nach dem Sprung ihn aufräumt — im BIOS
klappt das nur, solange die Adressen stehen bleiben.

Messbar: nimmt man **ein einziges Wort** aus `bios_clr` oder `bios_f2`, läuft
der REPL 22 Eingabezeilen einwandfrei und hängt bei der **23.** mit leerem
Bildschirm, PC fest auf `LDI print_prompt`. Der Assembler meldet nichts, und
alle bisherigen Tests bleiben grün, weil keiner 23 Zeilen tippt.

Deshalb sind die Routinenadressen in `tests/forth.test.js` festgeschrieben
(`the BIOS block keeps its exact layout`) und die Eingriffe in `asm/forth.asm`
mit Füll-`NOP`s auf ihrer bisherigen Länge gehalten. Wer eine BIOS-Routine
kürzt, muss nachpolstern — oder das Aufräumen im Kern nachziehen und den Test
mit ihm abschaffen.

### 4. Das High Byte trägt jetzt ein volles 4+4-Bit-Farbbyte

**Erledigt 2026-10-11.** Vier Bit Vordergrund, vier Bit Hintergrund, alle
sechzehn Werte beiderseits erreichbar.

Der Schlüssel war die naheliegende Frage, ob „invertieren" mit zwei belegten
Nibbles überhaupt noch etwas anderes bedeuten kann: **nein, invertieren heißt
Vorder- und Hintergrund vertauschen.** Der Cursor ist damit keine Zusatz-
information mehr, sondern die umgekehrte Standardfarbe — Schwarz auf Hellgrau,
`0x70` im High Byte — und ihn zu löschen heißt, das Attribut auf `0` zu
setzen. Ein eigenes Bit ist damit überflüssig, und genau das war die Blockade:
vorher belegte Bit 15 den Cursor und nahm dem Hintergrund sein viertes Bit.

Umgesetzt an allen sieben Stellen, die den Cursor anfassten (`cursor_on`,
`cursor_off`, `clear_cursor`, `bios_clr`, `bios_f2` sowie Backspace und Echo
in `bios_getstr`). Der Bildschirm zeichnet die Farbe, die er bekommt, und
braucht keinen Sonderfall mehr; den grünen Rand als Lesehilfe setzt er als
reine Oberflächenmarkierung `.screen-cursor`.

**Die ISA-Falle dabei:** `LDI` signiert sein 15-Bit-Immediate, `LDI 0x7000`
lädt also `0xF000`. Die Konstante wird über `LDI 0x0070` + `SL R0, 8`
gebildet. Genau deshalb ist der erste Versuch gescheitert und nicht der
Farbplan.

Der Bildschirm ist 80×24 Zellen groß (640×360 px bei 8×15 px je Zeichen), was
ohne Kernel-Änderung geht: der Kernel löscht weiter 80×25 Wörter, schreibt aber
nie in die letzte Zeile. Ein Test hält diese Annahme fest.

### 5. Kommentare: `\` und `( … )`

**Stand 2026-10-11.** Beide Formen sitzen im Tokenizer zwischen der
Apostroph-Prüfung und dem Punkt-Token, erkannt am **ersten Zeichen** des
Tokens. Damit braucht keine von beiden einen Wörterbucheintrag, und keine
kann durch ein gleichnamiges Wort verdeckt werden.

```forth
( ein Kommentar ) 1 2 + .          \ und einer bis zum Zeilenende
: sq ( n -- n2 ) dup * ;
5 sq . 25
```

Zwei Entscheidungen, die nicht selbstverständlich sind:

- **Klammern verschachteln sich nicht.** `( eins ( zwei )` endet an der ersten
  `)`. Wer sie verschachtelt erwarten würde, bekäme verschluckten Code.
- **Eine nicht geschlossene `(` frisst nur die restliche Zeile** und nicht jede
  folgende `)` in der Datei. Das ist die verzeihende Lesart eines Tippfehlers.

Beide Formen teilen sich nur den Absprung `comment_done` und haben je eine
eigene Schleife. Das ist Absicht: der erste Versuch hatte **eine** Schleife mit
einer `)`-Prüfung am Ende, und `LDI label` + `MOV PC, R0` ist in diesem Kernel
ein *unbedingter* Sprung — die Prüfung wurde nie erreicht, toter Code, und
`( … ) 1 2 + .` lief nie. Genau dieselbe Form von Fehler hatte vorher schon
zwei Stunden gekostet; deshalb steht es jetzt so ausdrücklich im Quelltext.

Der `0x0100`-Block darf sich dabei verschieben (nachgewiesen: eine Wortgröße
Drift stört nichts), der BIOS-Block nicht.

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

* **Keine.** Die beiden am 2026-10-10 vermerkten Punkte sind erledigt:
  - ~~`npm run lint:rtl` scheitert an `deep16_cache`~~ — behoben am 2026-10-10,
    die Quellliste entspricht jetzt `scripts/build_rtl_native.sh`; Lint läuft mit
    `-Wall` fehler- **und warnungsfrei** durch.
  - ~~`DIV`/`DIV32` im Einzelzyklus verhindert den FPGA-Bau~~ — behoben am
    2026-10-10 durch `rtl/deep16_divider.sv` (iterativer Radix-4-Kern, 16 Takte,
    **ein** Kern für `DIV` und `DIV32`).
* Der am 2026-10-10 vormerkte `LDI`-Bereichsfehler ist **kein Fehler** —
  die Vermerkung war eine Fehldiagnose (siehe Entscheidungs-Log).
* **Drei Mängel, die am 2026-10-14 gemeldet und am selben Tag zurückgenommen
  wurden** — alle drei waren Fehlalarme aus falschen Testfällen:
  - ~~`drop` nimmt einen leeren Stapel ohne Meldung~~ — `12 10 and drop`
    hinterlässt `and` genau einen Wert, den `drop` nimmt; danach ist der
    Stapel leer und das *folgende* `.` meldet zu Recht Unterlauf.
  - ~~`1 2dup . . .` meldet „stack underflow"~~ — zu Recht: `2dup` braucht
    zwei Werte, da lag einer. Nachgemessen: `1 2 2dup . . . .` → `2 1 2 1`,
    `1 2 2dup depth .` → 4, und `2dup`/`dup`/`drop` melden auf leerem Stapel
    alle drei Unterlauf.
  - ~~das nackte `"` frisst zusätzlich das schließende `;`~~ — `;` schließt in
    beiden String-Formen sauber.
  Gemeinsame Ursache der ersten beiden: der **Fehlerpfad lässt den Datenstapel
  unangetastet**, sodass nach einem Unterlauf Reste liegen bleiben und das
  nächste Wort sie sieht. Das ist gewollt (ANS: Stapel nach Fehler undefiniert)
  und wird nicht geändert.
* **Ein echter Fehler, gefunden am 2026-10-14 und behoben:** der Assembler
  ließ bei `ADD/SUB/CMP/… Rd, Rs, imm` den dritten Operanden **ohne Meldung**
  fallen (die ALU-Gruppe ist in beiden Formen zweistellig, Spec Tabelle 6).
  `ADD R11, R9, 1` wurde als `R11 ← R11 + R9` übersetzt. Dreistellige Zeilen
  werden jetzt abgewiesen.

**Was tatsächlich offen bleibt** — nicht Mängel, sondern Arbeit:

| Punkt | Wo | Warum offen |
|---|---|---|
| **Forth-Kern: `+do`, `j`, `r@`/`r!`** | `asm/forth.asm` | Der Kern hat jetzt `do`, `?do`, `loop`, `leave`, `i`. Was fehlt, ist die Ausstattung, die kein Beispiel im Repo braucht; siehe „Nächste Schritte" Nr. 8 |
| Opcode-Tabelle in `doc/Deep16-Arch.md` | drei Bereiche veraltet | Die Spec gehört dem Parallelautor; Anhang A nennt die gemessenen Werte, die Buchdiagramme stimmen (33/33 geprüft) |
| Quelldatei im Browser eintippen | `SERPLAN.md` | Nie im Browser gelaufen; die Pumpe ist nur gegen den echten Kernel auf dem JS-Kern getestet |
| `EVALUATE` | `SERPLAN.md` | Ein Wort, das einen Puffer auswertet — ohne zweiten Eingangsweg sinnvoll |
| Kapitel 9 ff. | `book/README.md` | Buchplan ist mit Kapitel 8 + Anhängen ausgeschöpft |
| `PSRAM` / `GFX` | `PLANPSRAM.md`, `GFX.md` | Nicht implementiert — bewusst kein Buchinhalt (Anhang D.4) |

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