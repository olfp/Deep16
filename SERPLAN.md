# SERPLAN — Quelltext über eine simulierte serielle Schnittstelle laden (2026-10-10)

Entwurf für die nächste Ausbaustufe des DeepForth-Kernels (`asm/forth.asm`):
Quelltext soll sich über eine simulierte serielle Schnittstelle in die
Maschine schieben und dort interpretieren lassen. Vier Punkte sind entschieden:
EOF über einen eigenen Statuswert, zu lange Zeilen brechen ab, das Wort heißt
`SERLOAD`, und `EVALUATE` kommt mit.

Nicht Teil dieses Plans: Dateinamen, ein Dateisystem in der Maschine, Blöcke.

---

## 0. Stand

| Schritt | Inhalt | Status |
|---------|--------|--------|
| 1 | Port im JS-Kern | ✅ erledigt (`js/deep16_simulator.js`) |
| 2 | Porttest | ✅ erledigt (`tests/serial-port.test.js`) |
| 3 | BIOS `f6` | ✅ erledigt (`asm/forth.asm`) |
| 4 | `SERLOAD` mit `src_mode` und den drei Abfangstellen | ✅ erledigt |
| 5 | Kernel-Tests | ✅ erledigt (7 Tests in `tests/forth.test.js`) |
| 6 | `EVALUATE` | offen (bewusst zurückgestellt) |
| 7 | WASM nachziehen | ✅ erledigt (`serial_push`, `serial_set_eof`, `serial_clear`, `serial_available`) |
| 8 | RTL nachziehen | ✅ erledigt (zweite FIFO in `deep16_top.sv`) |
| 9 | Host-Anbindung | ✅ erledigt (Dateidialog, getaktete Pumpe) |

**Nachtrag zu Schritt 7/8:** Die Toolchain war vorhanden, nur nicht im `PATH`
(`~/.cargo/bin` fehlte). Der serielle Port liegt jetzt in allen drei Kernen.
Zusätzlich kam in Schritt 9 **`serial_available()`** hinzu — die Anzahl der
wartenden Zeichen. Ohne sie kann der Host die 128 tiefe RTL-FIFO nicht
verwalten: ein Schreibvorgang in eine volle FIFO wird stillschweigend
verworfen, und eine Datei mit mehr als 128 Zeichen käme mittendrin zu Ende.

**Nachtrag zu Schritt 9:** Der Host schiebt die Datei nicht auf einmal hinein.
`pumpSerialQueue()` reicht pro Takt (10 ms, 200 Befehle) höchstens 64 Zeichen
nach — so viel, wie die Warteschlange gerade fasst. Eine geladene Zeile wird
nicht gespiegelt: nach `SERLOAD` steht auf der Bildschirmzeile, was die
übertragene Zeile ausgegeben hat, nicht ihr Text.

**Was Schritt 4 festlegt:**
- Die Zeilen landen im selben Puffer wie die Tastatureingabe (`tib_kbd`, ein Wort
  pro Zeichen, **86 Wörter**). Both `src_mode` und der Schreibzeiger werden pro
  Zeile zurückgesetzt — ohne das hängt die nächste Zeile an die vorherige und
  `: a 1 ;` + `: b 2 ;` wird zu einem Token `;:;`.
- Der Ladevorgang bricht bei EOF **ohne** den letzten Newline nicht ab: die
  Restzeile läuft noch einmal mit `src_mode = 2`.
- LF und CR beenden beide eine Zeile, wie am Keyboard.
- Jeder Fehler setzt `src_mode` über den gemeinsamen Pfad `recover_prompt` auf 0
  zurück. `stack_underflow_error` nimmt davon bewusst **nicht** Gebrauch: seine
  Meldung endet bereits auf einer frischen Zeile, der zusätzliche Zeilenumbruch
  würde eine Leerzeile einfügen.

**Blocker Schritte 7 und 8 — aufgehoben:** Es fehlten `wasm-pack` und `cargo` auf
dem `PATH`, nicht auf der Maschine; sie liegen unter `~/.cargo/bin`. Verilator
und Emscripten waren vorhanden. Beide Schritte sind erledigt, die Artefakte in
`wasm/pkg/` und `rtl/pkg/` sind neu gebaut.

**Korrektur an Schritt 1/2:** Der ursprüngliche Entwurf sah „Port in einem
Kern" und danach „Paritätstest" vor — ein Paritätstest braucht aber zwei Kerne.
Deshalb war der Porttest vorerst eine Prüfung des JS-Kerns allein. Schritt 7 hat
ihn auf WASM erweitert, Schritt 8 auf den RTL-Kern: derselbe Programmtext,
derselbe Transfer, alle drei Kerne, mit fest verdrahteten Sollwerten.

**Was Schritt 1 festlegt:**
- `SER_STATUS` meldet `2` erst, wenn die Warteschlange leer ist. Ein EOF kann
  Zeichen deshalb nie verdecken.
- Ein Lesen auf `SER_DATA` verbraucht genau ein Zeichen und lässt das
  EOF-Flag unberührt — ein leerer Lesevorgang schluckt kein EOF.
- `reset()` leert die Leitung, damit ein Neustart keinen halben Quelltext und
  kein altes EOF-Flag erbt.
- Host-API: `serialPush`, `serialPushString`, `serialSetEof`, `serialClear`;
  `runJs` nimmt `serial` und `serialEof` entgegen.

---

## 1. Ausgangslage

Die emulierte Maschine hat **kein Dateisystem**. Die BIOS bietet fünf
Funktionen (`asm/forth.asm`, `bios_f1`–`bios_f5`): Version, Init, putch,
putstr, getch, getstr. Weder `js/deep16_simulator.js` noch
`wasm/deep16-wasm/src/lib.rs` noch der RTL-Kern kennt Dateizugriff.

Der Interpreter liest ausschließlich aus `TIB` (`>IN` als Offset), und am
Zeilenende springt er unbedingt in den interaktiven Pfad. 25 Stellen im Kernel
lesen direkt aus `TIB`/`>IN`.

Es gibt aber bereits eine funktionierende Vorrichtung, an die sich das Vorhaben
anhängen lässt: die Tastatur ist ein abfragter Memory-Mapped-Port im I/O-Bereich
`0xF0000–0xF1FFF`, implementiert in allen drei Kernen, mit Host-Brücke.

---

## 2. Entscheidungen

| # | Frage | Entscheidung |
|---|-------|--------------|
| 1 | Wie signalisiert der Host das Ende der Übertragung? | **Eigener Statuswert** `2` auf `SER_STATUS` |
| 2 | Was passiert bei einer Zeile über 174 Bytes? | **Ladevorgang abbrechen**, mit Fehlermeldung |
| 3 | Wie heißt das Wort? | **`SERLOAD`** |
| 4 | `EVALUATE` mitnehmen? | **Ja** — dieselbe Schleife ohne Serial-Port |

Zu 1: Ein Steuerzeichen im Datenstrom hätte den Nachteil, dass es in einer
Zeile vorkommen könnte. Ein eigener Statuswert hält das Protokoll sauber und
lässt sich direkt testen.

---

## 3. Der Port

Direkt nach dem Tastaturpaar, gleiches Muster in allen Kernen:

| Port | Adresse | Bedeutung |
|------|---------|-----------|
| `SER_STATUS` | `0xF0064` | `0` = nichts da, `1` = Zeichen da, `2` = EOF signalisiert |
| `SER_DATA`   | `0xF0066` | liest **und konsumiert genau ein Zeichen** |

`2` ist ein eigener Zustand neben „Zeichen da“. Ein Host, der die Warteschlange
leert und danach EOF meldet, kommt nie in die Lage, ein EOF zu übersehen.

**Bestehende Adresse belegen, nicht überschreiben:** `0xF0060`/`0xF0062` bleiben
die Tastatur. `0xF0064`/`0xF0066` sind das nächste freie Paar.

### Umsetzung je Kern

| Ort | Änderung |
|-----|----------|
| `rtl/deep16_pkg.sv:14` | `SER_STATUS_ADDR`, `SER_DATA_ADDR` neben den KBD-Konstanten |
| `rtl/deep16_core.sv:655` | Dekoderzweig für die zwei Adressen; `ser_take_ex` analog `kbd_take_ex` (`:458`) |
| `rtl/deep16_top.sv:42` | zweite FIFO neben `kbd_fifo`, gleiche Tiefe (128) |
| `wasm/deep16-wasm/src/lib.rs:949` | Dekoderzweig neben `KBD_STATUS_ADDR`/`KBD_DATA_ADDR` |
| `js/deep16_simulator.js:963` | ebenso; plus `serial_push` / `serial_clear` |
| `tests/helpers.js:107` | `serialPush` im Stil von `kbdPush` |

> **Falle aus der eigenen Vergangenheit:** `VERILOG.md` dokumentiert, dass ein
> gehaltener `LDS KBD_DATA` im RTL-Kern die FIFO doppelt leerte. Dieselbe Gefahr
> besteht für `SER_DATA`. Der Paritätstest
> `every LDS SER_DATA consumes exactly one char` ist deshalb **Pflicht**, nicht
> Kür — als Vorbild dient der gleichnamige Tastaturtest in `tests/rtl.test.js:538`.

---

## 4. BIOS

Neue Funktion **`f6` — SER_GETCH**. Sie passt in das bestehende Schema „Status
nach `DS:0`, Ergebnis nach `DS:1`" und verbraucht keinen zusätzlichen Puffer.

- `DS:0` ← Status (`0`/`1`/`2`)
- `DS:1` ← Zeichen, wenn Status `1`; sonst `0`

Der Kernel fragt den Port in einer Schleife und braucht daher **kein Busy-Wait im
BIOS**: die Warteschlangenlogik bleibt beim Host.

**Festgelegt in Schritt 3:** Bei Status `0` oder `2` liest `f6` `SER_DATA`
**nicht**. Ein Lesevorgang verbraucht ein Zeichen, und ein bedingungsloser
Lesevorgang ist auf dem RTL-Kern genau der Ort, an dem ein Doppel-Pop entstehen
könnte. Der Test `BIOS f6 does not consume a character on an idle line` hält
das fest.

**Eigenheit beim Testen des BIOS:** Der SWI-Vektor liegt in `DS:[2]`, nicht in
`DS:[0]` — dort steht der Funktionscode. Das fällt auf, sobald ein Test-Stub den
Kernel bei `0x0100` überschreibt und eine eigene Trampoline braucht: schreibt
er nach `DS:[0]`, springt der SWI über den ROM-Breadcrumb wieder in den Stub
hinein. Der Testaufbau in `tests/serial-port.test.js` macht es richtig.

---

## 5. Der Kernel

Der eigentliche Eingriff ist kleiner, als er aussieht. Der Interpreter muss
nicht umgebaut werden — er braucht nur drei Abfangstellen.

### 5.1 Zustand

Eine Zelle `src_mode` (0 = interaktiv, 1 = lade) und für `SERLOAD` ein
gespeicherter Rückkehrweg.

### 5.2 Die Schleife

```
Zeile lesen:  SER_STATUS pollen → bei 2 fertig, bei 1 nach TIB, bei 0 warten
Zeile auswerten:  interpret_loop über TIB
```

`TIB` (`tib_kbd`) ist **174 Bytes**. Das ist die Zeilenlänge, die `SERLOAD`
begrenzt — und damit auch die Grenze aus Entscheidung 2.

### 5.3 Die drei Abfangstellen

| Stelle | Zeile | Verhalten bei `src_mode` |
|--------|-------|--------------------------|
| `interpret_done` | `asm/forth.asm:810` | zurück in die Ladeschleife statt `word_accept` |
| `skip_unknown` | `asm/forth.asm:666` | Ladevorgang abbrechen, Meldung bleibt |
| `stack_underflow_error` | `asm/forth.asm:764` | Ladevorgang abbrechen, Meldung bleibt |

Fehler brechen den Ladevorgang ab — genau die Philosophie, die heute schon eine
Definition im Fehlerfall abbricht (`skip_unknown` setzt `STATE = 0`). Danach
geht es zurück an den Prompt, die Maschine lebt weiter.

`word_accept` liegt an vier Stellen (`asm/forth.asm:283`, `:760`, `:807`,
`:903`); davon sind nur die Fehlerpfade und das Zeilenende betroffen, der
interaktive Einstieg in `word_accept` (`:2013`) bleibt unverändert.

### 5.4 Zu lange Zeilen (Entscheidung 2)

Beim Lesen wird mitgezählt. Überschreitet eine Zeile 174 Bytes, bricht
`SERLOAD` mit einer eigenen Meldung ab und kehrt zum Prompt zurück. Nicht
stillschweigend trennen: eine abgeschnittene Definition ist schlimmer als ein
sichtbarer Fehler.

### 5.5 EVALUATE

Dieselbe Schleife, aber ohne Serial-Port: `EVALUATE` setzt `TIB` auf einen Puffer,
der bereits im Speicher liegt, und `>IN` auf 0. Es ist die natürlichere Form für
Quelltext, den ein Wort erzeugt hat — etwa eine Kolonne, die `create`/`does>`
vorbereitet. Da die Schleife identisch ist, kostet es fast nichts und rundet
das Bild ab.

---

## 6. Host und Oberfläche

Der Host schiebt die Datei in die Warteschlange und meldet danach EOF.

Wichtig: Die Warteschlange fasst endlich viele Zeichen (RTL: 128 Einträge).
Der Host muss **chunkweise** füttern und der Maschine Zeit zum Abarbeiten
lassen — dasselbe Muster wie die Tastatur, wo `kbd_push` je Tastendruck ein
Zeichen nachlegt und die Maschine pollt.

Ein Dateidialog im Stil des vorhandenen Beispiel-Ladens (`loadExample` in
`js/deep16_ui_core.js:2857`, der Abruf in `:2865`) genügt; die Übertragung läuft
dann asynchron in Chunks, während der Simulator steppt.

### Bedienung

1. `SERLOAD…` neben **Reset** anklicken und eine Datei wählen. Sie liegt im
   Protokoll, wartet aber noch in der Leitung.
2. Den Kernel starten (Beispiel **forth.asm** laden, **Assemble**, **Run**).
3. `SERLOAD` auf der Tastatur eingeben. Ab da liest der Kernel nur noch von der
   Leitung, nicht mehr von der Tastatur.
4. Die Datei wird im Takt übertragen; das Transkript meldet, wann alle Zeichen
   drin sind und wann die Maschine EOF sieht.

**Wie der Host bremst:** `pumpSerialQueue()` fragt vorher
`serial_available()` und schiebt höchstens so viel nach, wie in die Warteschlange
passt — höchstens 64 Zeichen pro Takt. Ist die Leitung voll (die Maschine
läuft nicht oder ist langsam), meldet das Transkript einmal „line is full —
press Run". Ein Kern, der seinen Füllstand nicht melden kann, bekommt
vorsichtshalber ein einziges Zeichen pro Aufruf: die einzige Rate, die keine
FIFO überlaufen kann, deren Tiefe man nicht kennt.

**Was beim Wechsel passiert:** Ein **Reset** und ein **Kernwechsel** brechen
eine laufende Übertragung ab und leeren die Leitung. Grund: die neue Maschine
oder der neue Kern kennt die bisher geschobenen Zeichen nicht — halber Quelltext
ist schlechter als keiner. Das Transkript sagt, dass es passiert ist.

**Was die Oberfläche nicht umformatieren muss:** Der Kernel beendet eine Zeile
sowohl mit LF als auch mit CR (`word_serload`), deshalb darf die Datei so
weitergegeben werden, wie sie ist. Nur ein UTF-8-BOM wird abgeschnitten, weil
er sonst als erstes Token der ersten Zeile ankäme.

---

## 7. Tests

| Datei | Inhalt |
|-------|--------|
| `tests/serial-port.test.js` | **neu** — Portvertrag in allen drei Kernen: Status 0/1/2, Reihenfolge, **ein Lesevorgang = ein Zeichen**, EOF verdeckt keine Zeichen, leerer Lesevorgang schluckt kein EOF, Reset, `serialClear`, `serial_available` zählt herunter |
| `tests/forth.test.js` | Wort aus geladener Quelle aufrufen; Fehler in der Quelle bricht ab und der REPL lebt weiter; leere Übertragung; EOF ohne Newline; zu lange Zeile; `SERLOAD` mitten in einer Definition |
| `tests/ui-core.test.js` | Die Host-Pumpe: eine Datei kommt beim echten Kernel an, eine Datei länger als die FIFO auch, die Pumpe bremst sich am Füllstand, EOF erst nach dem letzten Zeichen, Reset und Kernwechsel brechen ab |

Der Porttest ist die einzige Stelle, an der ein Fehler beim Einlesen
stillschweigend Daten verschlucken würde — deshalb zuerst und einzeln.

---

## 8. Reihenfolge

1. Port in einem Kern (Empfehlung: JS, weil die Tests dort am schnellsten sind)
2. Porttest — siehe §0 zur Korrektur: ohne zweiten Kern nur eine Einzelprüfung
3. BIOS `f6`
4. `SERLOAD` mit `src_mode` und den drei Abfangstellen ✅
5. Kernel-Tests ✅
6. `EVALUATE`
7. WASM nachziehen, Parität ✅
8. RTL nachziehen, Porttest ✅
9. Host-Anbindung (Dateidialog, getaktete Pumpe) ✅

Die drei Kerne ziehen nach; jeder Schritt ist einzeln prüfbar, und kein Schritt
setzt einen anderen voraus. `EVALUATE` bleibt als einziger offener Schritt und
kommt bewusst später: es braucht dieselbe Schleife wie `SERLOAD` nur ohne
Port — ohne Serial-Port ist es an dieser Stelle auch noch nirgends benutzt.

---

## 9. Risiken

- **Die Sektionsgrenze war die eigentliche Falle.** Der Code ab `.org 0x0400`
  überschrieb die Sektion ab `.org 0x0100`, als `SERLOAD` den Interpreter um
  zwanzig Wörter wachsen ließ: `.org` setzt den Adresszähler zurück, ohne
  Fehlermeldung, und die REPL blieb nach einer geladenen Definition hängen.
  Vorher standen nur zehn Wörter Reserve. Der Abschnitt startet jetzt bei
  `0x0A00`, und ein Test vergleicht die aus der Listing-Ausgabe ermittelten
  Bereiche paarweise.
- **Der Serial-Port muss in allen drei Kernen synchron entstehen.** Ein Kern, der
  `SER_STATUS` immer `0` liefert, sieht eine Warteschlange, die leer ist — kein
  Absturz, nur stille Wirkungslosigkeit. Deshalb der Porttest je Kern.
- **Die Doppel-Pop-Falle im RTL** ist der wahrscheinlichste Fehler beim
  Einlesen. Der Test in `tests/rtl.test.js:538` ist die Vorlage.
- **Fehler innerhalb geladener Quellen brechen den Ladevorgang ab.** Vorsicht:
  bricht die Quelle **mitten in einer Colon-Definition** ab, bleibt deren Header
  im Wörterbuch, obwohl der Rumpf unvollständig ist. Ein späterer Aufruf dieses
  Wortes läuft dann bis `HLT` ins Leere. Das ist **vorbestehend** und nicht von
  `SERLOAD` verursacht — `: foo nope` gefolgt von `foo` zeigt dasselbe über die
  Tastatur. Ein Zurückrollen des halben Headers wäre eine eigene Aufgabe.
- **86 Wörter** sind eine schmale Zeile. Für echte Forth-Programme ist das wenig;
  das ist eine Eigenschaft des vorhandenen Puffers, keine des Plans. Wer mehr
  braucht, braucht einen größeren Puffer.

---

## 10. Offen für später

- `INCLUDE` als zweite Ebene, sobald `SERLOAD` steht
- Blockgeraet über reserviertes RAM, falls Blöcke doch gewünscht sind
- Ein größerer TIB oder mehrere Puffer pro Eingabequelle, falls Zeilenlänge
  regelmäßig anstoßt