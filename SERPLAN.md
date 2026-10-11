# Quelldatei eintippen — statt SERLOAD

> **Stand: verworfen.** Dieser Plan beschrieb eine serielle Leitung, über die der
> Host Forth-Quelltext in die Maschine schiebt. Das ist **nicht mehr gebaut** und
> auch nicht mehr im Code. Der Grund steht unten. Das Dokument bleibt, weil der
> Weg dorthin und die Gründe dagegen festhalten wollen.

---

## Warum verworfen

Der Zweck war, eine Forth-Quelldatei in den laufenden Interpreter zu bringen.
Dafür gab es zwei Wege, und der offensichtliche wurde übersehen:

**Der Repl kennt bereits eine Tastatur.** Die BIOS-Funktion `getstr` liest eine
Zeile über `KBD_STATUS`/`KBD_DATA`, spiegelt sie auf den Bildschirm und beendet
sie bei **LF oder CR**. Eine Datei als Folge von Tastendrücken einzutippen ist
damit dasselbe wie getippt zu werden — gleicher Puffer (`tib_kbd`), gleiche
Zeilengrenze, gleicher Interpreter. Es braucht dafür **keinen** zweiten
Eingangsweg.

Der serielle Weg war damit eine zusätzliche Betriebsart für etwas, das der
Rechner bereits konnte. Er brachte mit sich:

- einen zweiten Memory-mapped Port (0xF0064/0xF0066) in **allen drei Kernen**,
- einen eigenen Zustand im Interpreter (`src_mode`) mit **drei** Eingriffsstellen,
- eine neue BIOS-Funktion (`f6`),
- eine eigene Warteschlange, einen Füllstand, ein EOF-Protokoll,
- und eine Fehlerbehandlung dafür, die man getestet und abgeglichen hat.

Und am Ende war die Funktion im Browser trotzdem nie gelaufen. Für ein Problem,
das die vorhandene Tastatur schon gelöst hat.

## Was jetzt da ist

Im **Screen-Tab** liegt die Schaltfläche **„Datei tippen…"**. Sie nimmt eine
ASCII-Datei und tippt sie ein — jedes Zeichen wird ein Tastendruck, jedes
Zeilenende ein Return:

```
Datei tippen…  →  fileToKeys()  →  pumpKeyQueue()  →  kbd_push / enqueueKeyCode
```

- **Zeilenenden:** LF, CRLF und ein einzelnes CR gelten alle als ein Zeilenende.
  Eine Windows-Datei ergibt dadurch keine Leerzeile nach jeder Zeile.
- **Die letzte Zeile bekommt immer ihr Return** — auch ohne abschließenden
  Zeilenumbruch. Das Return führt die Zeile aus; ohne es bliebe die letzte
  Definition unausgeführt im Puffer liegen.
- **Ein BOM wird abgeschnitten**, sonst stünde er als erstes Token der ersten
  Zeile da.
- **Getaktet wird nach Füllstand.** Die Tastatur-FIFO des RTL-Kerns fasst 128
  Zeichen und verwirft bei Überlauf still. Deshalb fragt die Pumpe vorher ab und
  schiebt höchstens 64 Zeichen pro Takt nach — so viel, wie frei ist. Ohne diese
  Bremse ginge auf genau diesem Kern die Mitte einer Datei verloren, auf den
  beiden anderen nicht.
- **Reset und Kernwechsel brechen ab**, statt halb einzutippen.

## Bedienung

1. **Datei tippen…** wählen (Screen-Tab).
2. Programm laden, **Assemble**, **Run**.
3. Die Datei tippt sich selbst ein.

Schritt 3 ist wichtig: solange das Programm nicht läuft und nicht auf Eingabe
wartet, wird nichts gelesen. Der Warteschlangenfüllstand läuft dann voll, die
Pumpe wartet, und das Transkript meldet „queue is full — press Run".

## Tests

| Datei | Inhalt |
|-------|--------|
| `tests/ui-core.test.js` | `fileToKeys` (LF/CRLF/CR, letzte Zeile, Leerzeilen), die Pumpe am echten Kernel: eine Datei kommt an und ihre Definitionen lassen sich aufrufen, eine Datei weit über der FIFO auch, Bremse bei voller Warteschlange, unbekannter Füllstand, Abbruch bei Reset und Kernwechsel |
| `tests/forth.test.js` | Der `getstr`-Weg, den die Tastatur benutzt — Zeilenende bei LF und CR |