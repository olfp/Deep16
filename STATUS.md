# STATUS.md — Fortschritt des Deep16-Buchs

> Ständig gepflegter Arbeitsstand. Letzte Änderung: 2026-10-08.
> Workflow-Regeln: [STYLE.md](STYLE.md).

---

## Überblick

| Kapitel | Titel | Stand | Verifiziert | EPUB |
|---------|-------|-------|-------------|------|
| 1 | Warum eine 16-Bit-CPU? | ✅ fertig | beide Kerne | ✅ SVG-Diagramm |
| 2 | Register und Speicher organisieren | ✅ fertig | beide Kerne | ✅ SVG-Diagramm |
| 3 | Die ALU-Werkstatt: Befehle für Einsteiger | ✅ fertig | beide Kerne | ✅ 32 SVG-Diagramme |
| 4 | Flusskontrolle und Unterprogramme | ✅ fertig | beide Kerne | ✅ 4 SVG-Diagramme |
| 5 | Interrupts und Shadow-Register | ✅ fertig | beide Kerne | ✅ 8 SVG-Diagramme |
| 6 | Der Simulator als Werkbank | ⏳ offen | — | — |
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

## Build & Tooling

| Aufgabe | Befehl |
|---------|--------|
| Tests | `npm test` (alle `tests/*.test.js`) |
| EPUB bauen (SVG, Apple Books) | `./book/build-epub.sh` → `book/Deep16.epub` (Pandoc epub3 + Mermaid-SVG-Filter) |
| EPUB bauen (PNG, Kindle) | `./book/build-epub.sh kindle` → `book/Deep16-kindle.epub` (PNG-Diagramme + normalisierte Metadaten, gegen E016) |
| EPUB bauen (Kindle, Calibre-Round-Trip) | `./book/build-epub.sh kindle-calibre` → `book/Deep16-kindle-calibre.epub` (zusätzlich durch Calibre normalisiert) |
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
| 2026-10-07 | Mermaid wird vor dem EPUB-Build zu **SVG** vorgerendert (Lua-Filter + mmdc); EPUB3 `--embed-resources`. | `book/mermaid_filter.lua`, `book/build-epub.sh` |
| 2026-10-07 | **Jeder neu eingeführte Befehl** bekommt ein Bit-Codierungs-Diagramm. | kap03 (32 Diagramme) |
| 2026-10-08 | Diagramme brauchen eine **Titelzeile** (`**`Mnemonic` — Funktion**`). | kap03 |
| 2026-10-08 | `STYLE.md`/`STATUS.md` angelegt; Workflow ab jetzt verbindlich. | Repo |
| — | `SETS`/`CLRS` (Bit 5) als Footgun **dokumentiert** (Kap. 5), nicht im Kapitel demonstriert. | kap03, kap05 |
| 2026-10-08 | **MOV imm2-Redesign** (`ARCHREV.md`) ins Buch übertragen: §2.1 erklärt `imm2` als Funktionsauswahl (Tabelle 2-1), §4.2 auf Funktion 2 umformuliert. Keine Messung, kein Listing und keine Spezifikations-Verweisung mussten geändert werden; Diagramme unangetastet. | kap02, kap04 |
| 2026-10-09 | **EPUB-XHTML-Wohlgeformtheit** (Apple Books brach mit „Specification mandates value for attribute style" ab): `mermaid_filter.lua` entfernt leere SVG-Attribute (`style=""`, von Pandoc 3.7 sonst zu wertlosem `style` verkürzt) und escapet nackte `&` (SIL-OFL-Lizenzkommentar im eingebetteten `@font-face`) zu `&amp;`. Alle 11 XML-Teile wohlgeformt. | `book/mermaid_filter.lua`, `book/Deep16.epub` |
| 2026-10-09 | **Kindle-Variante gegen E016, 2. Anlauf**: PNG-Diagramme allein haben E016 **nicht** beseitigt (gegen Amazon-Hilfe geprüft: keine SVGs/Gradienten/Mathe mehr, Tabellen max. 15 Zeilen, CSS unauffällig). Ursache ist die Metadaten-Klasse, an der Amazons Parser scheitert: `<dc:language>` mit Attributen bzw. Regions-Subtag sowie die von Pandoc gesetzten Apple-Attribute `prefix="ibooks:…"`/`xml:lang` im `<package>`. `normalize_epub.py` reduziert auf `<dc:language>de</dc:language>`, entfernt beide Attribute, das `com.apple.ibooks.display-options.xml` und Calibres SVG-Umschlag des Titelbilds. Da sich das gegen Amazon nicht prüfen lässt, gibt es zwei Artefakte: `kindle` (EPUB3, Layout erhalten) und `kindle-calibre` (zusätzlich Calibre-Round-Trip — von der Community als wirksam bestätigt). | `book/build-epub.sh`, `book/normalize_epub.py`, `book/Deep16-kindle.epub`, `book/Deep16-kindle-calibre.epub` |

---

## Nächste Schritte

1. ✅ **Kapitel 5** abgeschlossen (Interrupts, Shadow-Register, `SWI`/`RETI`,
   `SMV`/`APSW`; Probe → Listings → Extractor → EPUB → Push).
2. Stichproben-Härtung Delay-Slot-Grenzfälle ist für Kap. 4 abgeschlossen
   (verschachtelte Jcc gemessen: innerer entscheidet, äußerer fällt weg).
3. Danach: Kapitel 6 (Simulator-Werkbank, Memory-Mapped I/O).

## Offene Punkte (aus `book/README.md`)

- Umfang pro Kapitel final kalkulieren.
- Wie viel 6502-Kontrast nach Kap. 1–3 noch erwünscht?
- Diagramm-Stil `block-beta` ist gesetzt; SVG-Export für Druck läuft über den
  bestehenden EPUB-Filter.