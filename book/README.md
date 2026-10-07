# Deep16 für 6502-Programmierer

> Buchplan (Entwurf) · Die 6502 dient als vertrauter Ausgangspunkt — ein Beispiel
> für einen einfachen, klassischen Prozessor. Im Buch steht aber die Deep16 selbst:
> jede Idee wird am laufenden Beispiel erklärt, die 6502 taucht nur dort auf, wo
> ein Vergleich wirklich erhellt (Delay-Slots, Shadow-Register, Segment-Adressierung).

---

## Teil I — Ankommen: Vom 8-Bitter zum 16-Bitter

### 1. Warum eine 16-Bit-CPU?
- Was einen klassischen 8-Bitter (z. B. die 6502) an der Leistungsgrenze aufhält:
  Registermangel, 8-Bit-Arithmetik, fester Stack
- Die Deep16 im Überblick: 16 GP-Register, 20-Bit-Adressraum, Segmente, Shadow-Register
- Mit dem Buch arbeiten: der Simulator im Browser, Assembler-Snippets, Konventionen

### 2. Register und Speicher organisieren
- 2.1 Die Registerbank R0–R15 — Arbeit auf zwei Dutzend „Akkus" statt drei
- 2.2 Das PSW: Flags `N Z V C`, Interrupt-Bit `I` und der spannende Bit 5 (`S`)
- 2.3 Adressierung: CS/DS/SS/ES, 20-Bit-Effektivadresse — wie ein einziges Speichermodell
     entsteht
- 2.4 Der Stack: `SP`, `SR[3:0]`, Dual-Stack-Modus `DS`; CALL/RET-Semantik
- **Beispiel:** „Hallo, Deep16!" auf dem Bildschirm (Bios-putchr, Screen-Segment)

### 3. Die ALU-Werkstatt: Befehle für Einsteiger
- 3.1 Laden und Speichern: `LD`/`ST` vs. `LDS`/`STS` (Segmentwahl, Adressierungsarten)
- 3.2 Arithmetik & Logik: 16-Bit ohne Überraschungen — Flags, keine dezimale Arithmetik
- 3.3 Besonderheiten: `SOP` (nur `NEG`, `INV`, `SPSW`, `LPSW`), `SET`/`CLR` auf Flags
- **Beispiel:** 16-Bit-Zählschleife mit Registerbank statt drei Registernglück

### 4. Flusskontrolle und Unterprogramme
- 4.1 `Jcc` & **Delay Slots** — die größte Falle für Neuankömmlinge (JNZ braucht ein NOP daneben)
- 4.2 Unterprogramme ohne Adress-Stapel: `LINK`/`JMP LR`, Rekursion, der Preis dafür
- **Beispiel:** Ein Tokenizer (die Basis fürs Mini-Forth in Kapitel 7)

---

## Teil II — Das Besondere der Deep16

### 5. Interrupts und Shadow-Register
- 5.1 Das Problem: Kontext retten bei einem Interrupt
     (ein klassischer Prozessor schiebt den ganzen Registerberg auf den Stack)
- 5.2 Die Deep16-Lösung: `SWI`/`RETI`, Bit `S`, der automatische Kontextwechsel,
     Shadow-Register R0′–R3′, R13′, R14′, PC′, PSW′, CS′, DS′, SS′, ES′
- 5.3 Von außen lesen: `SMV`/`APSW`, `LPSW`/`SPSW`, Zustand im Simulator
     (`get_shadow_state()`)
- **Beispiel:** Ein Tastendruck-Interrupt, der einen Zähler erhöht

### 6. Der Simulator als Werkbank
- 6.1 Aufbau: Memory-Mapped I/O — Screen, Keyboard-Port (`0xF0060`/`0xF0062`)
- 6.2 Debuggen: Delay-Slot-Fallen erkennen, Zustand prüfen,
     JS- und WASM-Kern im Vergleich (gleiche Bitgenauigkeit)

---

## Teil III — Praxis

### 7. Ein Mini-Forth (unser „Hello World“-Projekt)
- 7.1 Die REPL-Schleife: Puffer, Parser, Wörterbuch (genau wie im 6502-Forth)
- 7.2 Fehlerbehandlung: „undefined word" abfangen statt abstürzen
- 7.3 Ausbau: Zahlen, Operatoren, `drop`/`dup`/`swap` …
- **Übung:** Eine eigene Forth-Zeile im REPL tippen und schrittweise nachvollziehen

### 8. Ein kleines Projekt: Terminal-Uhr oder Snake
- Tastatureingabe werbefrei, Strahl-Cursor, Scroll — die Bausteine aus Kap. 2–6
- Von der Idee zum laufenden Programm (JS- und WASM-Kern)

---

## Anhang

- **A. Befehlsreferenz** (kompakt, mit Beispielen)
- **B. PSW-Belegung** (das Diagramm aus `test/mmtest.md`, als „Spickzettel“)
- **C. Glossar**: wichtige Begriffe (mit Hinweisen, wo ein 6502-Begriff weiterhelfen kann)
- **D. Quellen & Werkzeuge**: Simulator, Tests, Assembler

---

## Offene Punkte

- Umfang pro Kapitel (Ziel? ~120–160 Seiten gesamt?)
- Wie viel 6502-Kontrast ist nach den ersten Kapiteln noch erwünscht?
- Diagramm-Stil: `block-beta` (empfohlen) — ggf. SVG-Export für Druck