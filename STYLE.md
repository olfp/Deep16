# STYLE.md — Styleguide für das Deep16-Buch

Dieser Leitfaden dokumentiert die Konventionen, die in `book/kap*.md` gelten.
Er ist aus den Entscheidungen der Kapitel 1–3 destilliert und verbindlich für
neue Kapitel. Alles hier hat einen Grund; wo der nicht aus dem Text hervorgeht,
steht er in Klammern.

---

## 1. Sprache und Ton

- **Deutsch, duzt die Leserin/den Leser**
  („du kopierst", „merke dir"), nicht wissenschaftlich-abgehoben.
- Die **6502 dient nur als Kontrast**, wo er etwas wirklich erhellt
  (Delay Slots, Shadow-Register, Segment-Adressierung, Borrow-Semantik).
  Kein „bei jedem Befehl auch der 6502".
- Fachliche Versprechen werden **messbar** gemacht: Jede Zahl im Text stammt
  aus einem Simulatorlauf (Ziff. 7: Vermessungs-Workflow). Das Wort
  **„gemessen"** oder **„messbar"** markiert solche Stellen ausdrücklich.
- Assembler-Fehlermeldungen, die den Text stützen, werden **wörtlich**
  zitiert (z. B. `Immediate value 16 out of range (0-15)`).

## 2. Kapitelstruktur

Jedes Kapitel folgt gleich auf:

```
# Kapitel N — Titel
(2–4 Absätze Einleitung, die das Kapitel in den Kontext stellt + Versprechen)

## N.1, N.2, …   — die Abschnitte
### Unterabschnitte, wo nötig

## Beispiel: Titel          — ein zusammenhängendes Beispiel am Ende
## Das solltest du mitnehmen — 4–6 Merksätze als nummerierte Liste
**Nächstes Kapitel:** …      — ein Teaser-Satz
```

- Überschriften: `#`, `##` nur mit Nummerierung (`## 3.2`), `###` frei.
- Querverweise immer mit Paragraf-Nummer: `§1.3`, `Listing 2-1`, „Tabelle 3-3".
- Das Beispiel am Kapitelende nutzt die **ganze Registerbank** und schließt
  eine Messung mit ein (Endregister + Taktschritte).

## 3. Listings (```assembly)

- **Jedes** `assembly`-Listing ist ein **vollständiges Programm**:
  beginnt mit `.org 0x0100` und endet mit `HALT`. Keine Fragmente!
- Die erste Kommentarzeile nennt Nummer und Zweck:

  ```assembly
  ; listing 3-1: vier Wörter summieren — LD/ST mit Offset
  .org 0x0100
          LDI  tabelle
          MOV  R1, R0           ; R1 → Datenanfang
          ...
          HALT
  ```

- **Gemessene Ergebnisse** stehen als Kommentar an der Zeile, die sie
  erzeugt (`; R1 = 0x2234`). Zahlen im *Fließtext* müssen mit den
  Messergebnissen übereinstimmen.
- Mnemonics und Register im Text immer in Backticks: `` `ADD R1, R2` ``.
- **Codefragmente gehören nie in `assembly`-Fences** — dafür gibt es
  ```` ```text ```` (Merkregel aus kap03, sonst muss jedes Fragment ein
  vollständiges Programm sein):

  ```text
          LDI  0
          MOV  R1, R0
          SUB  R1, 1            ; 0 − 1 = 0xFFFF, N und C
          LPSW R2               ; R2 = 0x0009 — N|C
  ```

- 6502-Vergleichscode (z. B. in kap01) steht in einer **unbenannten**
  Fence, damit er nicht als Deep16-Listing gilt.

## 4. Bit-Codierungs-Diagramme (Mermaid)

- **Jeder neu eingeführte Deep16-Befehl bekommt ein Diagramm mit seiner
  Bit-Codierung.** (Entscheidung: kap03, nachträglich auf alle 32 angewandt.)
- Vor dem Diagramm steht eine **Titelzeile** als fette Zeile:

  ```
  **`ADD Rd, imm` — Addieren mit Immediate 0–15**
  ```

- Diagramm-Stil: `block-beta`, eine Spalte pro Bitfeld, Farben über
  `classDef` (Farbpalette für EPUB und GitHub identisch):

  | Feld          | Farbe          | Hex (fill/stroke)          |
  |---------------|----------------|----------------------------|
  | Opcode        | grau           | `#e5e7eb` / `#374151`      |
  | Register (`Rd/Rs/Rx/Rb`) | blau | `#dbeafe` / `#1d4ed8` |
  | Immediate/Bit-Nr | gelb      | `#fef3c7` / `#b45309`      |
  | Offset/Anzahl/Ziel | grün   | `#dcfce7` / `#15803d`      |
  | Segment       | lila           | `#ede9fe` / `#6d28d9`      |

  Mehrzeilige Labels mit `<br/>`: `b2["Rd<br/>4"]:1`.

- **Zwingend:** Die schließende ```` ``` ```` eines Mermaid-Blocks muss allein
  auf ihrer Zeile stehen — folgt Text auf derselben Zeile, wirft GitHub
  einen *Lexical error* („Unable to render rich display"). Mermaid-Blöcke
  niemals innerhalb von Tabellen, Listen oder Blockquotes einfügen.
- Die Encodings stammen aus `doc/Deep16-Arch.md` (Quelle = Spezifikation),
  die *Semantik* aus Messung.

## 5. Hervorhebungen und Tabellen

- **Blockquote `>`** für Merksätze und Warnungen, fett markiert:
  `> **Zusammengefasst:**`, `> **Borrow bedeutet `C = 1`.**`, ….
- **Tabellen** (Pipe-Tabellen) für Befehlsübersichten, Registerrollen,
  Flag-Aliasse, Ergebniszellen — Kopfzeile mit `|---|`-Trenner.
- Register-Rettungskonvention (§2.1, Spezifikation §6.1) gilt für alle
  Listings: Aufrufer rettet `R0–R11`, Gerufener `R12–R14`.

## 6. EPUB-Build (book/build-epub.sh)

- Befehl: `./book/build-epub.sh` aus dem Repo-Root.
- Pipeline: Pandoc `--to epub3 --embed-resources --lua-filter=mermaid_filter.lua`
  über alle `book/kap*.md` → `book/Deep16.epub`.
- Der Lua-Filter `mermaid_filter.lua` rendert jede ```` ```mermaid ````-Fence
  vorab per `mmdc` (@mermaid-js/mermaid-cli) zu SVG und bettet es als
  `RawInline` ein — der E-Reader braucht kein JavaScript.
  Chromium kommt aus `/tmp/chromium/chrome-linux/chrome`, Puppeteer-Argumente
  aus `/tmp/mmdc_conf.json` (`--no-sandbox` für den headless Container).
- **Nach jedem Build verifizieren:**
  - `zip -T` / Python-Zipfile: CRC intakt;
  - `EPUB/text/ch00N.xhtml` enthält je Kapitel so viele `<svg>` wie
    Mermaid-Blöcke vorhanden waren;
  - `pre class="mermaid"` kommt **nicht** mehr vor (kein roher Quelltext);
  - TOC enthält alle Kapitel (`--toc-depth=2 --split-level=1`).
- GitHub rendert Mermaid direkt aus dem Markdown — deshalb müssen die
  Fences dort zusätzlich sauber geschlossen sein (Ziffer 4).

## 7. Vermessungs-Workflow (vor jedem „fertig")

Jede Behauptung wird **gemessen, nicht behauptet**:

1. **`node tests/...`** — `npm test` (derzeit 121 Tests) muss grün sein.
2. **Probe-Skript** `/tmp/opencode/probe_kapNN.mjs` — prüft jede einzelne
   Aussage des Kapitels gegen den JS- **und** WASM-Kern (Endregister,
   PSW, Speicher, Taktschritte). Kanonische Quelle der Messwerte.
3. **Extractor-Skript** `/tmp/opencode/extract_kapNN.mjs` — assembliert
   **jedes** `assembly`-Listing des `book/kapNN.md`, führt es auf beiden
   Kernen aus und gleicht Endzustände + Schrittanzahl gegen die
   Erwartungstabelle ab. Strukturwächter: enthält `.org 0x0100`, endet
   mit `HALT`, Listing-Nummer vorhanden.
4. **EPUB neu bauen** (Ziff. 6) und verifizieren.
5. Erst dann committen.

## 8. Git-Workflow

- Kapitel-Änderungen und EPUB werden **direkt auf `main`** gepusht.
- Commit-Messages:
  - `book(kapNN): <Änderung>` für Kapitel-Markdown;
  - `book: rebuild EPUB …` für den zugehörigen EPUB-Build;
  - ein Tippfehler-/QA-Commit darf separat kommen.
- Kapitel + EPUB erscheinen immer als **zwei Commits** (Lesbarkeit des
  EPUB-Diffs), gehören aber in eine Überarbeitungsrunde.

## 9. Gemessene Fakten (eingefroren)

Die folgenden Ergebnisse sind durch Tests und Kapitel-Läufe eingefroren —
neue Kapitel dürfen sie nutzen, aber nicht widersprechen:

| Fakultät | Wert |
|----------|------|
| PSW-Flagbits | `N=1`, `Z=2`, `V=4`, `C=8` (niedrige Nibble) |
| `ADD`/`ADD imm`/`SUB`/`CMP` | setzen `N Z V C` ehrlich |
| Logik-Gruppe (`AND`/`OR`/`XOR`/`CLRB`) | nur `N Z`, löscht `V` und `C` |
| Borrow bei `SUB` | `C = 1` (umgekehrt zur 6502!) |
| `LD`/`ST` | setzen **keine** Flags |
| `MUL32`/`DIV32` | Registerpaar `Rd:Rd+1`, `Rd` muss gerade sein |
| Division durch 0 | ergibt `0xFFFF` (erkennbarer Fehlerwert) |
| `LDI` | lädt immer `R0`, 15-Bit mit Vorzeichenfortsetzung; Werte `>0x7FFF` abgelehnt |
| `SET 4` | No-op (Interrupt-Bit nur via `SETI`/`CLRI`) |
| `SET 5`/`SETS` | **Falle:** schaltet in den Schatten-Kontext → Kapitel 5, nie im Beispiel |
| Sprünge | nutzen den Delay Slot — Befehl danach läuft immer |