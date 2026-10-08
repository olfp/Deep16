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
| 5 | Interrupts und Shadow-Register | ⏳ offen | — | — |
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

### ✅ Kapitel 2 — `book/kap02.md` (504 Zeilen)
- §2.1 Registerbank R0–R15 (Rettungskonvention), `LDI`→R0-Regel,
  §2.2 PSW (Mermaid-Bitdiagramm), §2.3 Adressierung, §2.4 Stack,
  Beispiel „Hallo, Deep16!“.
- EPUB: PSW-Diagramm als SVG.

### ✅ Kapitel 3 — `book/kap03.md` (1180 Zeilen)
- §3.1 `LD`/`ST`/`LDS`/`STS` · §3.2 `ADD`/`SUB`/`CMP`/Logik/Schieber/`MUL`/`DIV` ·
  §3.3 `NEG`/`INV`/`SPSW`/`LPSW`/`SET`/`CLR` · Beispiel „1 bis 200“ (1824 Schritte).
- **10 Listings**, alle gemessen; **32 Bit-Codierungs-Diagramme** mit Titelzeile
  (jeder neu eingeführte Befehl).
- Verifikation: `npm test` 121/121 · Probe 94 Checks · Extractor 107 Checks ·
  EPUB mit 32 SVGs in `ch003.xhtml`.

### ✅ Kapitel 4 — `book/kap04.md` (589 Zeilen)
- **7 Listings, alle gemessen** — 4 Encoding-Diagramme mit Titelzeile
  (`Jcc`, Delay-Slot-Ablauf, `LINK`, `JMP Rx`), dazu Tabelle aller 8 `Jcc`.
- §4.1 `Jcc` & **Delay Slots**: Slot läuft immer (4-1, 28 Schritte),
  Über-Sprung-Falle ohne NOP (4-2a/4-2b), alle 8 Bedingungen im Zähler
  (4-3, `R8 = 4`), Reichweite ±256 (Fehlermeldung gemessen), verschachtelte
  Jcc als Warnhinweis gemessen.
- §4.2 `LINK`/`JMP LR` ohne Adress-Stapel: Aufruf/Rückkehr (4-4,
  `LR = 0x0105`), „ein LR für alle Aufrufe“ — Sicherung in R5 (4-5,
  `R8 = 0xAA`); Gegentest ohne Sicherung läuft 1000 Schritte (beide Kerne).
- **Beispiel: Tokenizer** (4-6): 3 Token aus „eine zwei drei“, Tabelle
  `(0200,4)/(0205,4)/(020A,4)`, **284 Schritte**.
- Verifikation: `npm test` 121/121 · Probe `probe_kap04.mjs` 46 Checks ·
  Extractor `extract_kap04.mjs` 60 Checks · EPUB mit 4 SVGs in `ch004.xhtml`.

### ⏳ Kapitel 5 — Interrupts und Shadow-Register
- Plan in `book/README.md`: `SWI`/`RETI`, Bit `S`, Shadow-Register
  R0′–R3′, R13′, R14′, PC′, PSW′, Segmente — löst das Rettungswesen von
  §4.2 (§2.2) in Hardware.
- Noch offen: Probeskript, Extractor, Kapiteltext, EPUB-Build.

---

## Build & Tooling

| Aufgabe | Befehl |
|---------|--------|
| Tests | `npm test` (alle `tests/*.test.js`) |
| EPUB bauen | `./book/build-epub.sh` (Pandoc epub3 + Mermaid-SVG-Filter) |
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

---

## Nächste Schritte

1. 🔨 **Kapitel 5** schreiben (Interrupts, Shadow-Register, `SWI`/`RETI`,
   `SMV`/`APSW`; Probe → Listings → Extractor → EPUB → Push).
2. Stichproben-Härtung Delay-Slot-Grenzfälle ist für Kap. 4 abgeschlossen
   (verschachtelte Jcc gemessen: innerer entscheidet, äußerer fällt weg).
3. Danach: Kapitel 6 (Simulator-Werkbank, Memory-Mapped I/O).

## Offene Punkte (aus `book/README.md`)

- Umfang pro Kapitel final kalkulieren.
- Wie viel 6502-Kontrast nach Kap. 1–3 noch erwünscht?
- Diagramm-Stil `block-beta` ist gesetzt; SVG-Export für Druck läuft über den
  bestehenden EPUB-Filter.