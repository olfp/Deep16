# SERPLAN — Quelltext über eine simulierte serielle Schnittstelle laden (2026-10-10)

Entwurf für die nächste Ausbaustufe des DeepForth-Kernels (`asm/forth.asm`):
Quelltext soll sich über eine simulierte serielle Schnittstelle in die
Maschine schieben und dort interpretieren lassen. Vier Punkte sind entschieden:
EOF über einen eigenen Statuswert, zu lange Zeilen brechen ab, das Wort heißt
`SERLOAD`, und `EVALUATE` kommt mit.

Nicht Teil dieses Plans: Dateinamen, ein Dateisystem in der Maschine, Blöcke.

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

---

## 7. Tests

| Datei | Inhalt |
|-------|--------|
| `tests/forth.test.js` | Wort aus geladener Quelle aufrufen; Fehler in der Quelle bricht ab und der REPL lebt weiter; leere Übertragung; EOF ohne Newline; zu lange Zeile; `SERLOAD` mitten in einer Definition; `EVALUATE` über einen Puffer |
| `tests/shadow.test.js` | JS↔WASM-Parität für `SERLOAD` und `EVALUATE` |
| `tests/rtl.test.js` | Port-Dekodierung; **`every LDS SER_DATA consumes exactly one char`** |

Der RTL-Porttest ist die einzige Stelle, an der ein Fehler beim Einlesen
stillschweigend Daten verschlucken würde — deshalb zuerst und einzeln.

---

## 8. Reihenfolge

1. Port in einem Kern (Empfehlung: JS, weil die Tests dort am schnellsten sind)
2. Paritätstest für den Port
3. BIOS `f6`
4. `SERLOAD` mit `src_mode` und den drei Abfangstellen
5. Kernel-Tests
6. `EVALUATE`
7. WASM nachziehen, Parität
8. RTL nachziehen, Porttest
9. Host-Anbindung (`serial_push`, Dateidialog)

Die drei Kerne ziehen am Schluss synchron nach; jeder Schritt ist einzeln
prüfbar, und kein Schritt setzt einen anderen voraus.

---

## 9. Risiken

- **Der Serial-Port muss in allen drei Kernen synchron entstehen.** Ein Kern, der
  `SER_STATUS` immer `0` liefert, sieht eine Warteschlange, die leer ist — kein
  Absturz, nur stille Wirkungslosigkeit. Deshalb der Porttest je Kern.
- **Die Doppel-Pop-Falle im RTL** ist der wahrscheinlichste Fehler beim
  Einlesen. Der Test in `tests/rtl.test.js:538` ist die Vorlage.
- **Fehler innerhalb geladener Quellen** sind der wahrscheinlichste Stolperstein
  für den Nutzer, nicht für die Implementierung. Deshalb brechen sie ab, statt
  halb geladen weiterzulaufen.
- **174 Bytes** sind eine schmale Zeile. Für echte Forth-Programme ist das wenig;
  das ist eine Eigenschaft des vorhandenen Puffers, keine des Plans. Wer mehr
  braucht, braucht einen größeren Puffer.

---

## 10. Offen für später

- `INCLUDE` als zweite Ebene, sobald `SERLOAD` steht
- Blockgeraet über reserviertes RAM, falls Blöcke doch gewünscht sind
- Ein größerer TIB oder mehrere Puffer pro Eingabequelle, falls Zeilenlänge
  regelmäßig anstoßt