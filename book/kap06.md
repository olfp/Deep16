# Kapitel 6 — Der Simulator als Werkbank

Bisher war der Simulator für dich ein Ausstellungsstück: ein Programm
hineinkopieren, `HALT` sehen, Register ablesen. Ab jetzt ist er eine
Werkbank. An ihm lässt sich zeigen, was die Deep16 an den Rändern macht —
wie sie auf Bildschirm und Tastatur zugreift, wie eine Adresse zum Port
wird und wie man einen Fehler findet, der sich nicht als Fehler meldet.

Dabei hilft ein Umstand, den es in den ersten fünf Kapiteln noch nicht gab:
Der Simulator ist **dreimal** implementiert. Einmal in JavaScript, einmal in
Rust und zu WebAssembly übersetzt, und einmal als Verilog-Modell, das über
Verilator läuft. Alle drei sind unabhängig voneinander geschrieben, und alle
drei rechnen dasselbe — nicht „ungefähr“, sondern Bit für Bit. Jede Zahl in
diesem Kapitel stammt aus einem Lauf auf **allen drei** Kernen, und wo sie
unterschiedlich herauskämen, stünde es hier.

Und noch etwas ist neu: Der Simulator ist keine Blackbox. Er hat
Schnittstellen, mit denen du den **letzten Speicherzugriff** und den
**Schattenzustand** aus der Maschine herausbekommst. Das ist der Unterschied
zwischen „das Programm tut nicht, was ich will" und „der Zugriff ging nach
`0x0060` statt nach `0xF0060`". Dieses Kapitel macht beide Werkzeuge
benutzbar.

---

## 6.1 Peripherie ist Speicher

Die Deep16 hat keine `IN`- und keine `OUT`-Befehle. Wer mit dem Bildschirm
reden will, schreibt in den Speicher — und wer eine Taste lesen will, liest
ihn. Das ist *Memory-mapped I/O*, und der Simulator zieht einen Strich durch
die Speicherkarte aus §2.3, den dort noch keiner gezogen hat:

**Tabelle 6-1: Speicherkarte des Simulators — was liegt wo**

| Bereich | Größe | Inhalt |
|---|---|---|
| `0x00000`–`0x000FF` | 256 Wörter | Interrupt-Vektoren (Kapitel 5), Globals |
| `0x00100`–`0x1FFFF` | 64 KW | RAM — deine Programme und Daten |
| `0xF0000`–`0xF0FFF` | 4 KW | Peripherie-Fenster, darin die Tastatur |
| `0xF1000`–`0xF17CF` | 2000 Wörter | Bildschirmpuffer, 80 × 25 Zeichen |
| `0xF8000`–`0xFFFEF` | 32 KW | System-ROM (BIOS) |
| `0xFFFF0`–`0xFFFFF` | 16 Wörter | Boot-ROM — der Sprung nach `0x0100` |

Die 20-Bit-Adresse aus §2.3 gilt hier ohne Sonderregeln. Nur zwei Adressen
sind besonders, und beide liegen im Segment `0xF000`:

- **`0xF0060`** liest den **Status-Port** der Tastatur,
- **`0xF0062`** liest den **Daten-Port** der Tastatur.

Für *beide* gilt dieselbe Regel, und die ist angenehm simpel: Wenn `ES` (oder
`DS`) auf `0xF000` steht, sind die Offsets `0x0060`, `0x0062` und `0x1000`
genau die drei Adressen, die dich interessieren. Der Bildschirmpuffer ist
also *kein* Sonderfall — er ist das dritte Fenster desselben Segments, das
Listing 2-3 schon benutzt hat:

> **Zusammengefasst:** `ES = 0xF000` ist das Peripherie-Segment. Offset
> `0x0060` = Tastaturstatus, `0x0062` = Tastaturdaten, `0x1000` = erste
> Bildschirmzelle. Eine Formel, drei Geräte.

### Der Bildschirm: 2000 Wörter, ein Zeichen pro Wort

Der Puffer besteht aus 2000 Wörtern (`0xF17CF` − `0xF1000` + 1 = 2000), die
der Simulator als 80 Spalten zu 25 Zeilen darstellt. Jedes Wort ist **eine
Zelle**, und ein Wort hat genau zwei Bedeutungen: die unteren acht Bits sind
der Zeichencode, Bit 15 ist ein Schalter.

**`Bildschirmzelle` — ein Wort, zwei Felder**

```mermaid
block-beta
  columns 16
  classDef op fill:#e5e7eb,stroke:#374151
  classDef all fill:#fee2e2,stroke:#b91c1c
  classDef reg fill:#dbeafe,stroke:#1d4ed8
  b15["Reverse<br/>Video<br/>15"]:1
  b14["14"]:1
  b13["13"]:1
  b12["12"]:1
  b11["11"]:1
  b10["10"]:1
  b9["9"]:1
  b8["8"]:1
  b7["7"]:1
  b6["6"]:1
  b5["5"]:1
  b4["4"]:1
  b3["3"]:1
  b2["2"]:1
  b1["1"]:1
  b0["0"]:1
  class b15 all
  class b14,b13,b12,b11,b10,b9,b8 op
  class b7,b6,b5,b4,b3,b2,b1,b0 reg
```

Setzt du Bit 15, wird das Zeichen **invertiert** dargestellt — und der
Simulator nutzt das praktisch als Cursor: Er merkt sich die letzte so
markierte Zelle und setzt den Cursor von dort auf die nächste. Ein Cursor ist
damit kein Register, sondern ein Wort im Bildschirmpuffer.

Das Wort `0x8020` ist also ein Leerzeichen (`0x20` = 32) mit gesetztem
Reverse-Bit: der Cursor. Leider kannst du es nicht direkt in einen
Immediate schreiben — `LDI` kennt nur 15 Bit mit Vorzeichenfortsetzung und
scheitert an jeder Zahl mit Bit 15:

```text
        LDI  0x8020
        → LDI immediate 32800 out of range (0..0x7FFF)
```

Für solche Konstanten brauchst du einen **Literalpool** — ein Wort im
Speicher, das du mit `LD` holst. Das ist Listing 6-1; danach steht in
`0xF1000` der Buchstabe `A` und in `0xF1001` der Cursor.

```assembly
; listing 6-1: eine Bildschirmzelle — Zeichen und Cursor
.org 0x0100

        LDI  -4096
        MVS  ES, R0          ; ES = 0xF000
        LDI  0x1000
        MOV  R8, R0          ; R8 -> 0xF1000, erste Zelle
        LDI  0x0041          ; 'A'
        MOV  R1, R0
        STS  R1, ES, R8      ; 0xF1000 = 0x0041
        ADD  R8, 1           ; naechste Zelle
        LDI  cursor
        MOV  R3, R0
        LD   R3, R3, 0       ; R3 = 0x8020 aus dem Literalpool
        STS  R3, ES, R8      ; 0xF1001 = 0x8020
        HALT

.org 0x0400
cursor:
        .word 0x8020
```

Gemessen (alle drei Kerne, 23 Schritte): `0xF1000` = `0x0041`, `0xF1001` =
`0x8020`. Der Reiter *Screen* zeigt ein `A` mit blinkendem Cursor dahinter.

### Die Tastatur: zwei Ports, ein Pufferschlitz

**Tabelle 6-2: Die beiden Tastaturports**

| Adresse | Zugriff | Bedeutung |
|---|---|---|
| `0xF0060` | lesen | `1`, wenn ein Tastendruck wartet, sonst `0` |
| `0xF0062` | lesen | nächster Tastendruck als Zeichencode; **leert** den Puffer |

Der Daten-Port arbeitet wie ein **Schlitz**, nicht wie ein Register: Jeder
Lesevorgang nimmt genau eine Taste aus der Warteschlange und stellt sie in
`R0x0000`, wenn nichts mehr da ist. Drei Tasten `H`, `i`, `!` (also `72`,
`105`, `33`) ergeben deshalb vier Lesevorgänge mit den Werten `0x0048`,
`0x0069`, `0x0021` und zuletzt `0x0000` — 19 Schritte auf allen drei Kernen.
Der vierte Wert ist nicht „Fehler", sondern die ehrliche Antwort auf eine
leere Frage.

> **Merke:** Der Status-Port lügt nicht, der Daten-Port straft nicht. Ein
> `0` vom Daten-Port heißt „nichts da" — genau wie ein `0` vom Status-Port.
> Wer beides prüft, bekommt keine Geister.

### Die Falle: nur `LDS`/`STS` sehen die Ports

Hier liegt die wichtigste Falle des ganzen Kapitels, und sie ist eine
Stolperstelle, die man genau einmal macht. `LDS`/`STS` sind die Formen mit
**explizitem Segment** — und nur sie wissen, dass `0xF0060` ein Port ist.
Die einfachen `LD`/`ST` kennen nur den Speicher. Sie lesen an derselben
Adresse schlicht das RAM-Wort, das dort steht.

Listing 6-2 stellt `ES` **und** `DS` auf `0xF000`, damit beide Befehle
ausdrücklich dieselbe Adresse `0xF0060` treffen. Der Vergleich ist damit
sauber: nicht die Adresse unterscheidet sich, sondern der Befehl.

```assembly
; listing 6-2: derselbe Port, zwei Befehle
.org 0x0100

        LDI  -4096
        MVS  ES, R0          ; ES = 0xF000
        MVS  DS, R0          ; DS = 0xF000 — LD trifft dieselbe Adresse
        LDI  0x0060
        MOV  R6, R0          ; R6 = 0x0060 -> 0xF0060
        LDS  R2, ES, R6      ; liest den Port
        LD   R3, R6, 0       ; liest die Speicherzelle 0xF0060
        HALT
```

Gemessen, mit einer wartenden Taste:

| Register | Wert | Bedeutung |
|---|---|---|
| `R2` | `0x0001` | Status: eine Taste wartet |
| `R3` | `0xFFFF` | RAM-Inhalt — kein Port |

`0xFFFF` ist der Füllwert des Simulator-RAMs, also das, was in einer nie
beschriebenen Speicherzelle steht. Liest du mit `LD`, bekommst du diesen
Füllwert und **nicht** den Port: `LDI`-Programm, `0xFFFF` im Register, und
deine Abfrage `JNZ` sagt dir prompt „Taste da!". Der Daten-Port liefert
danach `0x0000`, weil ja keine da ist. Das ist der Moment, in dem ein
Programm „manchmal" funktioniert.

Dazu passt die zweite Hälfte der Falle: Selbst wenn du die Adresse richtig
würdest, kannst du sie mit `LDI` nicht erreichen.

```text
        LDI  0xF060          ; die Portadresse selbst
        → LDI immediate 61536 out of range (0..0x7FFF)
```

`0xF060` ist größer als `0x7FFF`. Genau deshalb führt der Weg über das
Segment: `LDI -4096` (das ist `0xF000`) plus der kleine Offset `0x0060`.

> **Zusammengefasst:** Für Ports und Bildschirm brauchst du `LDS`/`STS`.
> `LD`/`ST` lesen und schreiben RAM — auch dann, wenn die Adresse stimmt.

---

## 6.2 Debuggen: Zustand lesen, Fallen erkennen

Ein Simulator ist dann eine Werkbank, wenn er mehr zeigt als „läuft noch /
fertig". Der Deep16-Simulator hat zwei Stellen, an denen er dir erzählt, was
er gerade getan hat. Und die Delay-Slot-Falle aus Kapitel 4 — die größte
Stolperstelle der ganzen Architektur — lernst du hier, sie zu *sehen*.

### Ein Delay Slot, der mitzählt

Listing 6-3 lässt den `JNZ` direkt auf einen `ADD` fallen. Das ist genau die
Form, die in Kapitel 4 als „immer ein `NOP` daneben" beschrieben wurde. Der
Unterschied ist hier nur, dass der Schaden *messbar* ist: `R1` zählt, wie
oft der Delay Slot gelaufen ist.

```assembly
; listing 6-3: ein Delay Slot, der mitzählt
.org 0x0100

        LDI  0
        MOV  R1, R0          ; R1 = Treffer
        LDI  5
        MOV  R2, R0          ; R2 = Schleifenzähler
schleife:
        SUB  R2, 1
        JNZ  schleife
        ADD  R1, 1           ; Delay Slot — läuft bei jedem Sprung
        HALT
```

Gemessen (alle drei Kerne): `R2` läuft von `5` auf `0`, und `R1` steht am Ende
bei **`5`** — in 30 Schritten. Fünfmal, weil `ADD` fünfmal im Delay Slot
stand: viermal bei genommenem Sprung, einmal bei nicht genommenem.

Listing 6-4 ist dasselbe Programm mit einem `NOP` im Slot:

```assembly
; listing 6-4: derselbe Loop mit geleertem Delay Slot
.org 0x0100

        LDI  0
        MOV  R1, R0          ; R1 = Treffer
        LDI  5
        MOV  R2, R0          ; R2 = Schleifenzähler
schleife:
        SUB  R2, 1
        JNZ  schleife
        NOP                 ; <-- der Slot wird geleert
        ADD  R1, 1
        HALT
```

Gemessen (alle drei Kerne): `R1` = **`1`**, in 31 Schritten. Genau eine
Ausführung, ein zusätzlicher Schritt. Der Unterschied zwischen 5 und 1 ist
das ganze Kapitel über Delay Slots in einer Zahl.

### `LDI` hat kein Vorzeichen — es hat ein Muster

Der zweite Fallstrick ist subtiler, weil *kein* Fehlertext erscheint. In §2.1
hast du gelernt, dass `LDI` einen 15-Bit-Wert vorzeichenfortsetzt — und damit
eine Grenze, die man leicht zu eng ansetzt. Die Spezifikation
(`doc/Deep16-Arch.md` §3.4) schreibt `R0 ← sign_extend(imm15)` vor, und das
Wortlaut ist wichtiger als er klingt: `imm15` ist ein **Muster** aus 15 Bit,
keine vorzeichenbehaftete Zahl. Die Vorzeichenerweiterung findet in der CPU
statt, nicht im Assembler. Damit sind **alle 32768 Muster** zulässig — du
darfst sie entweder roh (`0..0x7FFF`) oder vorzeichenbehaftet
(`-16384..-1`) schreiben, beides meint dasselbe Muster. Erst darüber hinaus
weist der Assembler die Schreibweise zurück:

```text
        LDI  -16385
        → LDI immediate -16385 out of range (-16384..16383)
```

Die Folge hat einen Preis, den man leicht übersieht: Die **größte positive
Zahl**, die in ein `LDI` passt, ist `16383`. Alles darüber wird vom
Vorzeichenbit zu einer negativen Zahl:

| Quelle | `R0` danach | gelesen als |
|---|---|---|
| `LDI 16383` | `0x3FFF` | `16383` ✔ |
| `LDI 16384` | `0xC000` | `−16384` |
| `LDI 20000` | `0xCE20` | `−12992` |
| `LDI -16384` | `0xC000` | `−16384` ✔ |

Alle drei Kerne liefern exakt diese vier Werte — und sie liefern sie
**richtig**, denn genau so ist es spezifiziert. Der Preis ist ein anderer als
ein Fehler: Die Zahl, die du wolltest, gibt es auf dieser Maschine nicht. Ein
Budget von 20000 Poll-Durchläufen wird zu einem Budget, das erst nach
**52767** Durchläufen auf null kommt (gemessen auf allen drei Kernen:
`R10` = `0x0000` nach 316622 Schritten). Wer `LDI 20000` notiert und später
auf `0x270C` trifft, hat zwei verschiedene Zahlen in der Hand — beide aus
demselben Muster.

> **Merke:** `LDI` transportiert ein Muster, keinen Zahlenwert. Alles über
> `0x3FFF` kann nicht positiv sein — baue es aus zwei `LDI` oder per `ADD`
> aus einem Muster zusammen.

### Der letzte Speicherzugriff

Der zweite Ort, an dem der Simulator arbeitet, ist das Speicherfenster. Nach
jedem Zugriff hält er fest, **was** adressiert wurde: Adresse, Basisregister,
Offset und Segment. Im JavaScript-Kern ist das `getRecentMemoryView()`, im
WASM-Kern und im Verilog-Kern je `get_recent_access()`.

Nach einem `STS R1, ES, R8` aus Listing 6-1 melden alle drei Kerne dieselben
sechs Werte:

| Feld | Wert | Herkunft |
|---|---|---|
| Adresse | `0xF1000` | phys aus `(ES << 4) + R8` |
| Basisregister | `0x1000` | Inhalt von `R8` |
| Offset | `0` | `LDS`/`STS` haben keinen Offset |
| Segmentwert | `0xF000` | Inhalt von `ES` |
| Segmentindex | `3` | `CS=0`, `DS=1`, `SS=2`, `ES=3` |
| Zugriff | `1` | Store (sonst Load) |

Das ist genau das Werkzeug für die Falle aus §6.1. Ein `LD` mit `R6 = 0x0060`
zeigt dir im Speicherfenster den **Offset `0x0060` im Segment `DS`** — und
damit, dass du die Portadresse verlassen hast, ohne es zu ahnen.

### Warum drei Kerne

Diese Dreifach-Implementierung ist unbeabsichtigt nützlich. Die drei Kerne
sind unabhängig voneinander in JavaScript, in Rust und in Verilog geschrieben,
und alle drei müssen für jedes Kapitel dieses Buches dieselben Ergebnisse
liefern: Endregister, `PSW`, Speicherinhalt, Schrittzahl. Das ist keine
Formalie — Divergenzen zwischen den Kernen haben in diesem Projekt schon echte
Fehler aufgedeckt, etwa die Vorzeichenfortsetzung im Offset von `LD`/`ST`
(§3.1).

Der Verilog-Kern ist der jüngste. Er beschreibt die Architektur unmittelbar —
fünf Stufen, PC als Architekturzustand, sichtbare Wirkung jedes Befehls erst im
Write-Back — und kommt deshalb auf ganz anderem Weg zu denselben Ergebnissen
wie die beiden verhaltensmäßigen Kerne. Dass eine Pipeline und ein
Schritt-für-Schritt-Modell Bit für Bit übereinstimmen, ist eine stärkere
Aussage als die Übereinstimmung zweier Interpreter. Er ist inzwischen über
einen Sweep geprüft, der **alle 65 536 Befehlswörter** einmal ausführt und
keine Abweichung findet. Seine eigenen Fehler hat die Entwicklung gefunden und
behoben, nicht die anderen Kerne; der JavaScript-Kern bleibt die Referenz, an
der die anderen beiden gemessen werden.

Für dieses Kapitel heißt das: jede Tabelle oben ist dreimal gemessen, und die
Schrittzahlen stimmen auf der Nase — auch die. Ein Kern, der dir `0xFFFF` statt
`0x0001` liefert, wäre ein Befund. Keiner tut es.

---

## Beispiel: Eine Terminal-Schleife

Jetzt wird alles zusammen gebaut: ein Programm, das auf einen Tastendruck
wartet, das Zeichen auf den Bildschirm schreibt und bei `Enter` aufhört. Es
nutzt die Ports aus §6.1 und lässt den Debugger aus §6.2 im Hinterkopf.

Das Programm hat keinen BIOS-Aufruf — der Simulator hat keines (§2.3) — und
darum genau zwei Regeln, die Kapitel 3 und 4 beigebracht haben: `LDS` setzt
keine Flags (also `ADD Rx, 0` nach jedem Port-Lesen), und jeder Sprung
braucht seinen `NOP`.

```assembly
; listing 6-5: Terminal-Schleife — Taste lesen, Zeichen auf den Bildschirm
.org 0x0100

        LDI  -4096
        MVS  ES, R0                  ; ES = 0xF000 — Peripherie-Fenster
        LDI  0x0060
        MOV  R6, R0                  ; R6 -> Status-Port 0xF0060
        LDI  0x0062
        MOV  R7, R0                  ; R7 -> Daten-Port  0xF0062
        LDI  0x1000
        MOV  R8, R0                  ; R8 -> Bildschirmzelle 0xF1000
        LDI  0
        MOV  R9, R0                  ; R9  = Zeichenzaehler
        LDI  10000
        MOV  R10, R0                 ; R10 = Wartebudget
        LDI  warte
        MOV  R11, R0                 ; R11 = Adresse Warteschleife
        LDI  taste
        MOV  R12, R0                 ; R12 = Adresse Tastenverarbeitung

warte:
        SUB  R10, 1
        JZ   fertig                  ; Budget aufgebraucht
        NOP                          ; Delay Slot
        LDS  R1, ES, R6              ; Status lesen
        ADD  R1, 0                   ; LDS setzt keine Flags
        JZ   warte                   ; 0 = nichts da, weiter pollen
        NOP                          ; Delay Slot
        JMP  R12                     ; 1 = Taste da, verarbeiten
        NOP                          ; Delay Slot

taste:
        LDS  R2, ES, R7              ; Zeichen holen (Schlitz leert sich)
        CMP  R2, 10                  ; Enter? (10 = 0x0A, auch Immediate)
        JZ   fertig
        NOP                          ; Delay Slot
        STS  R2, ES, R8              ; Zeichen an den Bildschirm
        ADD  R8, 1                   ; Bildschirmposition +1
        ADD  R9, 1                   ; Zeichenzaehler +1
        JMP  R11                     ; zurueck zum Pollen
        NOP                          ; Delay Slot

fertig:
        LDI  cursor
        MOV  R3, R0
        LD   R3, R3, 0               ; R3 = 0x8020 (Leerzeichen, reverse)
        STS  R3, ES, R8              ; Cursor an die aktuelle Position
        HALT

.org 0x0400
cursor:
        .word 0x8020
```

Elf Register haben eine Rolle: `R6`/`R7` die Ports, `R8` die
Bildschirmposition, `R9` der Zähler, `R10` das Wartebudget, `R11`/`R12` die
beiden Sprungadressen, `R1`/`R2` die Arbeitswerte, `R3` das Cursorwort. Das
Budget ist wichtig: Eine Warteschleife, die endlos pollt, sieht in einem
Debugger *hängt* aus, statt „wartet auf Eingabe" zu sagen. Nach 10000
Durchläufen gibt `R10` = `0x0000` den Ausstieg, und das Programm beendet
sich wie jedes andere.

`CMP R2, 10` verdient einen Blick: `10` ist hier der *Immediate*-Wert der
Compare-Form, und er ist zufällig genau der Code, den die Tastatur für
`Enter` liefert. Das funktioniert, weil `0x0A` im Immediate-Feld (0–15)
steckt — nicht, weil der Port es so zurückgibt.

**Gemessen** (JS-, WASM- und Verilog-Kern, Tasten `H`, `i`, `!`, `Enter`):

| Größe | Wert |
|---|---|
| Schritte bis `HALT` | `98` |
| `R9` (Zeichen) | `3` |
| `R8` (Bildschirmposition) | `0x1003` |
| `R10` (Budget) | `0x270C` = 9996 — vier Durchläufe verbraucht |
| `0xF1000`…`0xF1003` | `0x0048` `0x0069` `0x0021` `0x8020` |
| `PSW` | `0x0000` |

Auf dem Bildschirm steht `Hi!` mit Cursor dahinter. `R8` steht auf `0x1003` —
drei Zellen nach dem Anfang, weil drei Zeichen geschrieben wurden; der Cursor
selbst wurde **nicht** mitgezählt, er hängt in `0xF1003`.

Und dieselbe Datei **ohne** Tastendruck? Das Budget läuft in 70027 Schritten
in `R10` = `0x0000` herunter, `R9` bleibt `0`, und `R8` steht unberührt auf
`0x1000`. In `0xF1000` landet trotzdem `0x8020` — der Cursor. Das Programm
stellt sich also an den Anfang und blinkt auf dich; es beendet sich
ordentlich, statt zu hängen. Genau daran erkennst du im Debugger, ob ein
Programm *wartet* oder *hängt*: ein wartendes Programm hat noch Schritte im
Budget, ein hängendes nicht.

---

## Das solltest du mitnehmen

1. **Peripherie ist Speicher.** Der Bildschirm liegt bei `0xF1000`–`0xF17CF`
   (2000 Wörter, 80 × 25), die Tastatur bei `0xF0060` (Status) und `0xF0062`
   (Daten). Beide erreichst du mit `ES = 0xF000` und den Offsets `0x1000`,
   `0x0060`, `0x0062` — eine Formel für alle drei.
2. **Nur `LDS`/`STS` sehen die Ports.** `LD`/`ST` lesen RAM: an `0xF0060`
   liefern sie `0xFFFF` (Füllwert), nicht den Portstatus. Die
   `LDS`-Form ist nicht die umständlichere Variante, sondern die einzige
   richtige.
3. **Eine Bildschirmzelle ist ein Wort.** Unten acht Bits Zeichencode, Bit 15
   Reverse-Video — und der Simulator nutzt Bit 15 als Cursor. `LDI` kann
   Bit 15 nicht setzen (`LDI immediate 32800 out of range (0..0x7FFF)`),
   also braucht es einen Literalpool.
4. **Der Daten-Port ist ein Schlitz.** Jedes Lesen nimmt eine Taste und gibt
   `0x0000`, wenn nichts wartet — dreimal lesen liefert drei Zeichen, das
   vierte `0`.
5. **Delay Slots kann man zählen.** `ADD` im Slot läuft fünfmal statt einmal
   (`R1` = `5` statt `1`), kostet aber nur einen Schritt Unterschied (30
   gegen 31). Das `NOP` ist billig, die Diagnose ist es nicht.
6. **`LDI` transportiert ein Muster, keinen Zahlenwert.** Die Vorzeichenerweiterung
   macht die CPU (Spec §3.4), nicht der Assembler — alle 32768 Muster sind
   zulässig. Die größte positive Zahl, die hineinpasst, ist `16383`;
   `LDI 16384` ergibt gemessen `0xC000`, `LDI 20000` ergibt `0xCE20` — beide
   korrekt, beide negativ gelesen. Wer eine größere positive Zahl braucht,
   baut sie aus zwei `LDI` oder per `ADD`.
7. **Der Simulator erzählt, was er tat.** `getRecentMemoryView()` (JS) und
   `get_recent_access()` (WASM und Verilog) nennen Adresse, Basisregister,
   Offset und Segment des letzten Zugriffs — damit wird „ich lese `0xF0060`"
   von einer Hoffnung zu einer Tatsache. Und weil drei getrennt implementierte
   Kerne übereinstimmen müssen, ist ihre Einigkeit ein Test, keine Behauptung.

**Nächstes Kapitel:** Kapitel 7 baut ein Mini-Forth — die Schleife aus
Listing 6-5 wird zur Zeile des REPL, der Daten-Port zur Tastatureingabe und
der Bildschirmpuffer zum Ausgabepuffer eines Wörterbuchs.