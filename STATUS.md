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
| 4 | Flusskontrolle und Unterprogramme | 🔨 in Arbeit | — | — |
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

### 🔨 Kapitel 4 — Flusskontrolle und Unterprogramme
- Aus dem Buchplan: §4.1 `Jcc` & **Delay Slots** (größte Falle für Neuankömmlinge),
  §4.2 Unterprogramme ohne Adress-Stapel (`LINK`/`JMP LR`, Rekursion, der Preis dafür),
  Beispiel **Tokenizer** (Basis für das Mini-Forth in Kap. 7).
- Natur des Kapitels: Messungen zu Delay-Slot-Semantik (genommen/nicht genommen),
  `Jcc`-Encoding-Tabelle, `LINK`-Rücksprungadresse, `JSR`/`RTS`-Fallstricke.
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

1. 🔨 **Kapitel 4** schreiben (Probe → Listings → Extractor → EPUB → Push).
2. Stichproben-Härtung kontroverser Aussagen (Delay-Slot-Grenzfälle: Sprungziel =
   Slot, `Jcc` mit Ziel im Slot, verschachtelte Sprünge).
3. Danach: Kapitel 5 (Interrupts, Shadow-Register, `SWI`/`RETI`, `SMV`/`APSW`).

## Offene Punkte (aus `book/README.md`)

- Umfang pro Kapitel final kalkulieren.
- Wie viel 6502-Kontrast nach Kap. 1–3 noch erwünscht?
- Diagramm-Stil `block-beta` ist gesetzt; SVG-Export für Druck läuft über den
  bestehenden EPUB-Filter.