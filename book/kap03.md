# Kapitel 3 — Die ALU-Werkstatt: Befehle für Einsteiger

Kapitel 2 hat die Bühne aufgebaut: Registerbank, Statuswort, Adressmodell
und Stack. Jetzt betreten die Befehle die Bühne, mit denen du den größten
Teil deiner Programme schreibst: Werte holen und ablegen (§3.1), rechnen
und bitknobeln (§3.2), ein paar Sonderfälle mit `NEG`/`INV` und `SET`/`CLR`
(§3.3) — und am Ende ein Beispiel, das die ganze Registerbank in Bewegung
zeigt.

Ein Versprechen vorweg: Dieser Band messbar zu halten, ist die Regel aus
§1.3 geblieben. Jede Zahl im Text stammt aus einem Lauf über beide
Simulator-Kerne (JS und WASM), die sich in nichts unterscheiden — du kannst
jedes Listing kopieren und wirst genau das sehen, was hier steht.

---

## 3.1 Laden und Speichern: `LD`, `ST` — und ihre Geschwister

Vier Befehle bewegen Wörter zwischen Registern und Speicher. Zwei davon
kennst du schon flüchtig aus Kapitel 2 — hier werden sie Arbeitspferde:

| Mnemonic | Beispiel | Wofür? |
|----------|----------|--------|
| `LD` | `LD R1, R2, 0` | Wort aus dem Speicher holen |
| `ST` | `ST R1, R2, 0` | Wort in den Speicher legen |
| `LDS` | `LDS R1, ES, R8` | Wort holen, Segment explizit |
| `STS` | `STS R1, ES, R8` | Wort legen, Segment explizit |

Das Adressmodell stammt aus §2.3: Das Basisregister `Rb` liefert die Adresse,
ein fester Offset verschiebt sie um −16 bis +15 Wörter. `LD R1, R2, 3` liest
also das Wort bei `R2 + 3` — im von §2.3 geschnürten Befehl die Zelle
`phys(R2)` drei Wörter weiter. Wer die Klammer-Schreibweise mag, bekommt
dasselbe Ergebnis mit `LD R1, [R2+3]`; beide Formen sind messbar identisch
und im Simulator frei austauschbar.

`LD` und `ST` sind die Segment-Auswahl über das Basisregister
(genau wie §2.3 sagt). Nach dem Boot zeigen `DS`, `SS` und `ES` alle auf
Segment 0, die Welt ist flach — die Listings dieses Kapitels brauchen deshalb
kein `MVS`, bis ein eigener Abschnitt es verlangt.

Wichtig ist eine Eigenheit, die dir schon in Listing 2-3 über den Weg
gelaufen ist:

> **`LD` und `ST` setzen keine Flags.** Holt dir `LD` eine Null, bleibt das
> `Z`-Bit an, wo es war. Ein `JZ` direkt nach `LD` ist blind; erst ein
> Null-Addit wie `ADD R1, 0` schaltet die Flags scharf — das Muster aus dem
> „Hallo, Deep16!“-Beispiel in Kapitel 2. Messung: presst du vorher `SETC`
> und `SETN` ins PSW, stehen nach `LD`/`ST` beide unverändert da.

Listing 3-1 nutzt die Befehle zum ersten Mal ernsthaft: vier Wörter aus der
Tabelle holen, summieren, das Ergebnis zurücklegen.

```assembly
; listing 3-1: vier Wörter summieren — LD/ST mit Offset
.org 0x0100
        LDI  tabelle
        MOV  R1, R0           ; R1 → Datenanfang
        LD   R2, R1, 0        ; R2 = w[0]
        LD   R3, R1, 1        ; R3 = w[1]
        ADD  R2, R3
        LD   R3, R1, 2        ; R3 = w[2]
        ADD  R2, R3
        LD   R3, R1, 3        ; R3 = w[3]
        ADD  R2, R3           ; R2 = 10 + 20 + 30 + 40
        ST   R2, R1, 4        ; Summe in w[4] schreiben
        HALT

.org 0x0200
tabelle:
        .word 10, 20, 30, 40, 0
```

Der Ablauf ist der Klassiker: `LDI tabelle` legt die Adresse der Tabelle in
`R0`, `MOV R1, R0` schenkt sie dem Basisregister — ein Muster, das du in
jedem Listing des Buches wiederfindest. Danach holen vier `LD` die Wörter
mit den Offsets 0 bis 3, drei `ADD` summieren in `R2`, und das letzte `ST`
legt die Summe in `w[4]` ab. Die Messung endet mit `R2 = 0x0064` (100) und
derselben Summe in Zelle `0x0204` — nach 21 Taktschritten, identisch auf
beiden Kernen. Der `ADD R2, R3` macht nebenbei deutlich, warum die Tabelle
bei 0x0200 liegen darf: Wortadressierung aus §1.2, jeder Eintrag ein Wort,
die Offsets zählen Wörter, nicht Bytes.

---

## 3.2 Arithmetik und Logik: 16 Bit ohne Überraschungen

Auf einem 8-Bitter musstest du für große Zahlen Tricks lernen. Hier ist die
Regel kurz und schnörkellos, sie gilt für den Rest des Kapitels:

> **Die ALU rechnet 16 Bit, rund und ehrlich.** Addieren ohne
> Übertrags-Kaskade, Subtrahieren mit sauberem Borrow im Carry, Vergleichen
> ohne Seiteneffekt — und kein dezimaler Modus wie beim 6502, der im
> BCD-Betrieb plötzlich anders addiert.

### Addieren — ein Befehl statt einer Kaskade

```assembly
; listing 3-2: 16-Bit-Plus in einem Befehl
.org 0x0100
        LDI  0x1234
        MOV  R1, R0
        LDI  0x0FFF
        MOV  R2, R0
        ADD  R1, R2           ; R1 = 0x2233
        ADD  R1, 1            ; R1 = 0x2234 — Immediate 0..15
        HALT
```

Auf dem 6502 sieht eine 16-Bit-Addition anders aus: erst `CLC`, dann `ADC`
auf die niederwertigen Bytes, dann `ADC` auf die höherwertigen — der zweite
`ADC` verschluckt den Übertrag. Hier schluckt `ADD R1, R2` zweimal 16 Bit und
produziert 16 Bit, fertig. `0x1234 + 0x0FFF = 0x2233`, und der letzte Befehl
zeigt die zweite Form: `ADD R1, 1` addiert ein **Immediate**, und dessen
Platz ist klein — 4 Bit, also 0 bis 15. Alles Größere lädt `LDI` und rechnet
in Registern:

> Bei `ADD R1, 16` protestiert der Assembler messbar: *`Immediate value 16
> out of range (0-15)`*. Nicht ärgern — ist die Grenze zu eng, kommt der
> Wert eben aus einem Register.

Die enge Grenze heißt bei Weitem nicht, dass 16-Bit-Werte rar wären:
Register halten 16 Bit, `ADD` verarbeitet 16 Bit — verzichtet wird nur auf
die Immediate-Konstante am Befehlsende.

### Die Flags sind ehrlich — `V` und `C` in Aktion

Kapitel 2 hat die Bits vorgestellt, jetzt beweisen sie sich. `N` kopiert das
Bit 15 des Ergebnisses, `Z` meldet Null, `V` den *vorzeichenbehafteten*
Überlauf, `C` den *vorzeichenlosen*. Listing 3-3 rechnet beide Fälle
sichtbar aus (gemessen: `R2 = 0x0005` und `R3 = 0x000A`):

```assembly
; listing 3-3: N, Z, V und C — ehrlich berechnet
.org 0x0100
        LDI  0x3FFF          ; R0 = 0x3FFF (LDI kann 0x7FFF nicht direkt)
        MOV  R1, R0
        SL   R1, 1           ; R1 = 0x7FFE
        ADD  R1, 1           ; R1 = 0x7FFF — größte positive Zahl
        ADD  R1, 1           ; 0x7FFF + 1 = 0x8000 → N und V
        LPSW R2              ; R2 = 0x0005 (N|V)
        LDI  -1              ; R0 = 0xFFFF
        MOV  R1, R0
        ADD  R1, 1           ; 0xFFFF + 1 = 0x0000 → Z und C
        LPSW R3              ; R3 = 0x000A (Z|C)
        HALT
```

Zwei Dinge am ersten Block sind Unterricht pur. Erstens: `0x7FFF` ist die
größte positive 16-Bit-Zahl — und direkt per `LDI` **nicht** erreichbar,
weil dessen Immediate nur 15 Bit trägt und das Bit 14 das Vorzeichen ist
(§2.1). `LDI 0x7FFF` liefert gemessen `0xFFFF`, `LDI 0x4000` gemessen
`0xC000`: Die Werte `0x4000` bis `0x7FFF` holst du dir per Shift oder
Addition — hier per `SL` und `ADD`, genau das macht das Listing. Zweitens:
`0x7FFF + 1 = 0x8000`. Für die vorzeichenlose Welt ist das ein Riesenwert
(bis 0xFFFF okay, kein `C`), aber als *vorzeichenbehaftet* gerät er von
`+32767` zu `−32768` — deshalb setzt `V`. `LPSW R2` liest das PSW in ein
Register (§2.2) und beweist: `N|V = 0x0005`.

Der zweite Block zeigt die Gegenrichtung. `LDI -1` lädt `0xFFFF` (die
15-Bit-Regel wieder), `+1` schlägt alle 16 Bit des Ergebnisses um: `0x0000`, mit
`Z`, und `C` durch die Übertrags-Messung über `0xFFFF` hinaus. `R3 = 0x000A`
ist `Z|C` — beide Fälle, beide ehrlich.

### Subtrahieren mit Borrow — und der Unterschied zur 6502

`SUB` rechnet wie `ADD`, nur mit umgekehrtem Vorzeichen — und hier liegt die
größte Falle für Umsteiger. Rechnest du `0 − 1`, borgt sich die CPU ein Bit
von oben:

```text
        LDI  0
        MOV  R1, R0
        SUB  R1, 1            ; 0 − 1 = 0xFFFF, N und C
        LPSW R2               ; R2 = 0x0009 — N|C
```

> **Borrow bedeutet `C = 1`.** Nach `SUB` steht das Carry für „ich musste
> borgen“. Bei der 6502 ist es genau andersherum: Nach `SBC` heißt `C = 0`
> „geborgt“, und vorher schaltest du mit `SEC` den Borrow aus. Daran
> scheitern erste Portierungen zuverlässig — merk dir: hier `C = 1` beim
> Unterlauf.

Die Rechnungen laufen glatt, solange das Ergebnis in die 16-Bit-Grenzen
passt: `200 − 199 = 1` ohne jedes Flaggen-Geflatter, und der Zähler in
Listing 3-10 steht den ganzen Lauf über unterhalb von allem, was `N`
anrühren könnte.

### Vergleichen, ohne zu schreiben — `CMP`

`CMP` rechnet wie `SUB`, **aber** es schreibt das Ergebnis nicht zurück.
Das Zielregister bleibt unangetastet, nur die Flags erzählen vom Vergleich.
Das ist der Unterschied zu `SUB` — und die Grundlage für saubere
Verzweigungen: Nach `CMP Ra, Rb` gilt `C = 1` genau dann, wenn `Ra < Rb`
ist, weil dann ein Borrow fällig war; `C = 0` heißt `Ra ≥ Rb`.

```assembly
; listing 3-4: CMP vergleicht — und schreibt nicht
.org 0x0100
        LDI  200
        MOV  R1, R0           ; R1 = 200
        LDI  7
        MOV  R2, R0           ; R2 = 7

        CMP  R1, R2           ; 200 − 7 = 193 → kein Borrow
        JNC  kein_borrow
        NOP                   ; Delay Slot
        ADD  R3, 1            ; nie erreicht
kein_borrow:
        CMP  R2, R1           ; 7 − 200 = −193 → Borrow
        JC   kleiner
        NOP                   ; Delay Slot
        ADD  R3, 1            ; nie erreicht
kleiner:
        ADD  R3, 1            ; R3 = 1
        HALT
```

Das Listing durchläuft beide Zweige (gemessen: `R3 = 1`): Erst ist
`200 ≥ 7`, `JNC` nimmt den Sprung; dann ist `7 < 200`, `JC` nimmt ihn — und
weil `CMP` nicht schreibt, stehen `R1 = 200` und `R2 = 7` am Ende unberührt
da. Die `NOP`s nach den Sprüngen sind der Delay Slot aus §1.3: Er läuft
immer, den Zweig betreten die Sprünge erst eine Zeile später.

### Die Logik-Gruppe: `AND`, `OR`, `XOR` und `CLRB`

Die vier Befehlspaare zum Bitknobeln — Registerform und Immediate-Form mit
Bit-Nummer — hat Kapitel 2 schon erwähnt. Jetzt arbeiten sie:

```assembly
; listing 3-5: AND, OR, XOR und CLRB — die Logik-Gruppe
.org 0x0100
        LDI  -256             ; R0 = 0xFF00
        MOV  R1, R0
        LDI  0x0F0F
        MOV  R2, R0
        AND  R1, R2           ; R1 = 0x0F00
        OR   R1, R2           ; R1 = 0x0F0F
        XOR  R1, R2           ; R1 = 0x0000
        LDI  0x00FF
        MOV  R1, R0
        CLRB R1, 7            ; Bit 7 löschen → R1 = 0x007F

        SETV
        SETC
        AND  R1, R2           ; 0x007F & 0x0F0F = 0x000F, V/C gelöscht
        LPSW R4               ; R4 = 0x0000 (nur N/Z aus dem Ergebnis)
        HALT
```

`AND` maskiert ausgewählte Bits durch, `OR` setzt sie, `XOR` kippt sie,
`CLRB` macht eines gezielt frei — das mündet in `R1 = 0x007F`, gemessen.
Der Nachsatz ist der wichtige Teil: Vor dem letzten `AND` werden `V` und `C`
von Hand gesetzt (`SETV`, `SETC`), und das `AND` **löscht beide** — `LPSW
R4` liest die Null (`0x0000`).

> **Die Logik-Gruppe setzt `V` und `C` auf Null.** `AND`, `OR`, `XOR` und
> `CLRB` füllen nur `N` und `Z` aus dem Ergebnis; `V` und `C` gehen auf
> `0`. Bei der 6502 überleben `AND`/`ORA`/`EOR` dagegen beide Flags —
> wieder ein Punkt, an dem Portierungen abbiegen.

Wer einzelne Bits abfragen will statt sie zu ändern, nimmt die Test-Zwillinge
`TBS` und `TBC`. Sie rechnen nicht in ein Register zurück, sondern nur in
Flags — mit dem passenden Sprung dahinter:

```text
        TBS  R1, 6            ; ist Bit 6 gesetzt?
        JNZ  bit_gesetzt      ;   ja → JNZ greift
        ...
        TBC  R1, 5            ; oder: ist Bit 5 gelöscht?
        JNZ  bit_frei         ;   ja → JNZ greift
```

Die Merkregel sitzt im Namen, wenn man `JNZ` als „ja“ liest: `TBS` fragt
**B**it-**S**etzt → `JNZ` bei gesetzt, `TBC` fragt **B**it-**C**lear →
`JNZ` bei gelöscht. Beide sind gemessen; `R1` bleibt dabei unangetastet.

### Schieben und Rotieren: 0 bis 15 in einem Zug

Beim 6502 drehen `ASL`/`LSR`/`ROL`/`ROR` genau **ein** Bit pro Befehl — ein
`ASL` nach dem anderen. Die Deep16-Schieber nehmen einen Zähl-Operanden,
und der passt von 0 bis 15 ins Wort:

```assembly
; listing 3-6: Schieben und Rotieren — Zähl-Operand und Carry
.org 0x0100
        LDI  0x0001
        MOV  R1, R0           ; R1 = 0x0001
        SL   R1, 8            ; R1 = 0x0100 — acht Stellen in einem Befehl
        MOV  R2, R1           ; R2 = 0x0100
        ROL  R1, 8            ; R1 = 0x0001 — das Bit kommt durchs Carry zurück
        MOV  R3, R1           ; R3 = 0x0001

        LDI  0x0001
        MOV  R4, R0           ; R4 = 0x0001
        SL   R4, 15           ; R4 = 0x8000 — Bit 15 erreicht man per Shift
        SL   R4, 1            ; R4 = 0x0000, Bit 15 fällt ins Carry
        JC   carry_kam
        NOP                   ; Delay Slot
        HALT                  ; nie erreicht
carry_kam:
        ADD  R5, 1            ; R5 = 1 — das Carry kam wirklich
        HALT
```

`SL R1, 8` schiebt acht Stellen in einem Zug; `ROL R1, 8` rollt sie durch
das Carry zurück (§2.2 — das `C` arbeitet dabei als zusätzliche
Ringposition). Gemessen enden `R2 = 0x0100` und `R3 = 0x0001`. Der zweite
Teil zeigt, wie ein Shift das Carry füttert: `SL R4, 1` auf `0x8000`
schiebt Bit 15 hinaus — es landet in `C`, und das `JC` (Carry gesetzt)
nimmt den Zweig. Und ein Sonderfall der Messung: Bei Zählwert 0 schiebt
nichts, das Carry bleibt stehen — nach `SETC` liefert ein `SL R1, 0`
messbar `0x0008` als PSW.

### Multiplizieren und Dividieren: eingebaut

Der 6502 kann nur addieren; für `MUL` brauchst du dort eine
Bibliotheksroutine. Hier gehören die Rechenarten zum Befehlssatz:

```assembly
; listing 3-7: MUL und DIV32 — multiplizieren und teilen
.org 0x0100
        ; MUL: 16 × 16 Bit, das untere Ergebniswort
        LDI  0x0100
        MOV  R2, R0
        LDI  0x0025
        MOV  R1, R0
        MUL  R2, R1           ; R2 = 0x2500 (256 × 37)

        ; MUL32: 32-Bit-Ergebnis in einem Registerpaar
        LDI  -1               ; R0 = 0xFFFF
        MOV  R4, R0
        LDI  -1
        MOV  R1, R0
        MUL32 R4, R1          ; R4:R5 = 0xFFFE:0x0001

        ; DIV32: 32-Bit-Dividend in einem Paar
        LDI  0x0012
        MOV  R6, R0
        LDI  0x3456
        MOV  R7, R0
        LDI  0x0025
        MOV  R1, R0
        DIV32 R6, R1          ; R6 = 0x7DF4 (Quotient), R7 = 0x0012 (Rest)
        HALT
```

`MUL R2, R1` multipliziert 16 × 16 Bit und behält die unteren 16 Bit des
Produkts — `256 · 37 = 9472 = 0x2500`. Willst du alle 32 Bit, gibt es
`MUL32`: Es schreibt das hohe Wort in `Rd` und das niedere nach `Rd+1`.
`0xFFFF · 0xFFFF = 0xFFFE:0x0001` — die zwei Register sehen das als Paar
(gemessen: `R4 = 0xFFFE`, `R5 = 0x0001`). Die Division ist das Pendant:
`DIV32 R6, R1` teilt das 32-Bit-Paar `R6:R7` durch den Divisor in `R1`,
Quotient landet in `R6`, Rest in `R7`. Die Probe `0x123456 : 37` ergibt
`32244 = 0x7DF4` und Rest `18 = 0x0012`. Das schlichte `DIV` ohne die `32`
liefert nur den Quotienten; ein Divisor 0 mündet messbar in `0xFFFF` — ein
Wert, an dem du den Fehler erkennst.

Dazwischen steht ein Satz, der zum 6502-Umsteiger spricht: Die Deep16 hat
**keinen** Dezimal-Modus und kein `D`-Bit im PSW (Kapitel 2 hat das
Statuswort vorgestellt — dort ist keins). Die 6502 dagegen kippt mit dem
`D`-Flag in den BCD-Betrieb, in dem `ADC`/`SBC` plötzlich im Dezimalsystem
rechnen. Hier bleibt alles binär: `0x99 + 1 = 0x9A`, nie `0x00` mit
Dezimal-Übertrag — das berüchtigte `SED`/`CLD`-Handling entfällt.

---

## 3.3 Besonderheiten: `NEG`, `INV`, `SPSW`, `LPSW` und die `SET`/`CLR`-Familie

Der Befehlssatz versteckt eine kleine Gruppe hinter dem Sammelnamen `SOP`
(messbar vier Befehle: `NEG`, `INV`, `SPSW`, `LPSW`). Zwei davon hast du
in Kapitel 2 schon benutzt, zwei lernst du jetzt.

### `NEG` und `INV` — negieren und invertieren

`INV` kippt jedes Bit (`0x0042` → `0xFFBD`), `NEG` kippt und addiert 1 —
die Zweierkomplement-Negation. Zusammen bilden sie ein hübsches Paar:

```assembly
; listing 3-8: NEG und INV — zweimal Null, einmal komplett
.org 0x0100
        LDI  0x0042
        MOV  R1, R0           ; R1 = 0x0042
        NEG  R1               ; R1 = 0xFFBE (−66)
        INV  R1               ; R1 = 0x0041
        NEG  R1               ; R1 = 0xFFBF
        HALT
```

Verfolgt man die Werte (gemessen endet `R1 = 0xFFBF`): `NEG 0x42` liefert
`0xFFBE`, `INV` darauf `0x0041` — das Komplement hebt den „−1“-Anteil auf —
und `NEG` macht daraus `0xFFBF`. Noch zwei gemessene Details: `NEG` und
`INV` setzen `N`/`Z` aus dem Ergebnis und löschen — wie die ganze
ALU-Gruppe — `V`/`C`. Und für den Alltagsfall gilt: Willst du das
Vorzeichen eines Wertes umdrehen, ist `NEG` der direkte Weg — jeder
16-Bit-Wert ist erlaubt, ohne Umweg über die `LDI`-Grenze.

`SPSW` und `LPSW` haben in §2.2 ihren Auftritt gehabt: `LPSW Rd` liest das
PSW in ein Register (`R2 = 0x0005` aus Listing 3-3), `SPSW Rd` schreibt
sein Register ins PSW (Listing 2-1 stellte so den Stack-Zeiger ein). Sie
gehören zur selben Familie und sind die vorhersehbarsten Befehle des
Befehlssatzes.

### `SET` und `CLR` — Flags bitweise schalten

Hinter `SET` und `CLR` verbirgt sich ein Befehl mit 16 Operanden: Im Wort
steht die Bit-Nummer und das Kommando setzen oder löschen. Die vier unteren
Bits steuern die Flags, die Aliase sparen Schreibarbeit:

| Alias | numerisch | Bit | Rolle |
|-------|-----------|-----|-------|
| `SETN` / `CLRN` | `SET 0` / `CLR 0` | `N` | Negativ (Bit 15 des Ergebnisses) |
| `SETZ` / `CLRZ` | `SET 1` / `CLR 1` | `Z` | Null |
| `SETV` / `CLRV` | `SET 2` / `CLR 2` | `V` | Vorzeichen-Überlauf |
| `SETC` / `CLRC` | `SET 3` / `CLR 3` | `C` | Carry / Borrow |
| `SETI` / `CLRI` | — | `I` | Interrupt-Sperre (Kapitel 5) |
| `SETS` / `CLRS` | `SET 5` / `CLR 5` | `S` | Shadow-Kontext (Kapitel 5) |

```assembly
; listing 3-9: SET und CLR — Flags von Hand schalten
.org 0x0100
        SETN
        SETZ
        SETV
        SETC
        LPSW R1               ; R1 = 0x000F — alle vier Flag-Bits
        CLR 2                 ; CLR 2 löscht V (SET 2 = V)
        LPSW R2               ; R2 = 0x000B (N|Z|C)
        CLRN
        CLRZ
        CLRC
        SET 2                 ; SET 2 setzt V
        LPSW R3               ; R3 = 0x0004 (nur V)
        HALT
```

Das Listing setzt alle vier Flag-Bits, liest sie mit `LPSW` (`R1 = 0x000F`),
löscht `V` per Zahlenform (`R2 = 0x000B`) und räumt den Rest ab, bis nur
noch `V` steht (`R3 = 0x0004`) — beides gemessen. Die Zahlenform und die
Aliase sind austauschbar: `SET 2` und `SETV` erzeugen messtechnisch
dasselbe Wort.

Zwei System-Flagbits gehören nicht in die Rechenstraße. `SET 4` ist
messbar ein No-op — das Interrupt-Bit `I` ist gegen die Zahlenform
geschützt; es schalten nur `SETI`/`CLRI` (Kapitel 5). Und `SET 5` (=
`SETS`) ist geradezu eine Falle:

> **`SETS` schaltet den Ablauf in den Schatten-Kontext.** Ist `S` gesetzt,
> holt die CPU den nächsten Befehl nicht mehr über `R15`, sondern über den
> Schatten-Programmzeiger (§1.2) — der steht nach dem Boot auf 0. Ein
> Programm, das mittendrin `SET 5` ausführt, verlässt messbar seinen
> normalen Ablauf (der PC bleibt stehen, die Wörter bei Adresse 0 werden
> ausgeführt) und findet nicht zurück. Bis Kapitel 5 gilt deshalb: `SETS`/
> `CLRS` nur lesen, nicht ausprobieren.

---

## Beispiel: `1 bis 200` — drei Summen aus einer Registerbank

Jetzt kommt alles zusammen — und zwar in einer Form, die der 6502 so nicht
könnte. Drei Summen sollen gleichzeitig entstehen: über alle Zahlen
`1..200`, über die geraden und über die ungeraden. Auf dem 6502 mit seinen
drei Akkus `A`, `X`, `Y` wäre das ein Registerpotpourri; hier nimmt die
Bank drei Arbeitsregister und einen Zähler gleichzeitig auf.

```assembly
; listing 3-10: 1 bis 200 — drei Summen aus einer Registerbank
.org 0x0100
        LDI  200
        MOV  R5, R0           ; R5 = Zähler (200 → 0)
        LDI  ergebnis
        MOV  R8, R0           ; R8 → Ergebnis-Tabelle
        LDI  weiter
        MOV  R6, R0           ; R6 = Klammer-Sprungziel der Schleife
        LDI  0
        MOV  R1, R0           ; R1 = Summe aller Zahlen
        MOV  R2, R0           ; R2 = Summe der geraden
        MOV  R3, R0           ; R3 = Summe der ungeraden

schleife:
        ADD  R1, R5           ; alle Zahlen
        TBS  R5, 0            ; Bit 0 gesetzt → ungerade
        JNZ  ungerade
        NOP                   ; Delay Slot
        ADD  R2, R5           ; gerade
        JMP  R6               ; Klammer zu: weiter
        NOP                   ; Delay Slot
ungerade:
        ADD  R3, R5           ; ungerade
weiter:
        SUB  R5, 1            ; 16-Bit-Zähler einen Schritt zurück
        JNZ  schleife
        NOP                   ; Delay Slot

        ST   R1, R8, 0        ; Summe aller → Speicher
        ST   R2, R8, 1        ; Summe der geraden → Speicher
        ST   R3, R8, 2        ; Summe der ungeraden → Speicher
        HALT

.org 0x0200
ergebnis:
        .word 0
        .word 0
        .word 0
```

Die Initialisierung ist das Register-Shuffle aus §2.1: `LDI` lädt `R0`, und
`MOV` verteilt — einmal den Zähler, einmal den Tabellenzeiger, einmal das
Rücksprungziel (denn `JMP` nimmt nur Register, und der Delay Slot aus §1.3
verlangt das `NOP` danach). Dann drei Nullen für die Summen.

Der Schleifenkörper ist die Logik-Gruppe von eben: `ADD R1, R5` sammelt
alles; `TBS R5, 0` prüft das Bit `0` des Zählers — gesetzt ist eine
ungerade Zahl, und `JNZ` nimmt den Zweig. Gerade Zahlen fallen durch und
landen mit `ADD R2, R5` in der zweiten Summe; ungerade gehen nach `R3`.
Beide Wege treffen bei `weiter` wieder zusammen, und `SUB R5, 1` arbeitet
den Zähler ab — ein 16-Bit-Zähler in einem einzelnen Register. Auf der 6502
müsstest du dafür zwei Register und eine eigene Übertrags-Kette
verschwenden, damit der Zähler je über 255 hinauskommt.

Nach 200 Durchläufen ist `R5 = 0`, und die drei `ST` schreiben das Ergebnis
nach `0x0200` (gemessen, beide Kerne identisch):

| Zelle | Wert | Bedeutung |
|-------|------|-----------|
| `R1` | `0x4E84` = 20100 | Summe `1..200` (200 · 201 : 2) |
| `R2` | `0x2774` = 10100 | Summe der geraden (2 · 5050) |
| `R3` | `0x2710` = 10000 | Summe der ungeraden |
| Speicher `0x0200` | `0x4E84` | Rückweg über `ST` |

Die Messung zählt **1824 Taktschritte** bis zum `HALT` — auf beiden Kernen
exakt gleich. Und der 8-Bit-Gedanke dazu: Schon beim 23. Durchlauf hätte
`R1` auf einer 8-Bit-CPU überlaufen (die Summe klettert über 255); hier
läuft sie bis 20100 und kein Sonderfall stellt sich ein. Das ist die
Werkstatt, die Kapitel 2 versprochen hat: sechzehn Register, 16-Bit-Rechnen
ohne Tricks — und drei Summen gehen gleichzeitig von der Hand.

---

## Das solltest du mitnehmen

1. **`LD`/`ST` bewegen Wörter, `LDS`/`STS` entscheiden über Segmente.**
   Offsets von −16 bis +15, die Klammer-Form `[Rb+Off]` ist identisch, und
   keine dieser Operationen fasst die Flags an — für ein `JZ` braucht es
   das Null-Addit.
2. **Die ALU rechnet 16 Bit ehrlich.** `ADD`/`SUB` setzen `N Z V C` mit
   wahren Werten; `V` meldet den vorzeichenbehafteten Überlauf, `C` beim
   Abziehen den Borrow (`C = 1` heißt „geliehen“ — anders als beim 6502!),
   Immediate sind 4 Bit klein.
3. **Die Logik-Gruppe löscht `V` und `C`.** `AND`/`OR`/`XOR`/`CLRB`
   liefern `N`/`Z`; `TBS`/`TBC` fragen einzelne Bits ab, ohne zu ändern
   (`JNZ` = „ja“).
4. **Schieben und Rechnen sind eingebaut.** Schieber mit Zähl-Operand
   0–15 und Carry-Rundlauf, `MUL`/`DIV` mit 32-Bit-Paar-Varianten, kein
   Dezimalmodus, kein `ASL`-Trommeln.
5. **`SET`/`CLR` beherrschen die Flags.** `SET 0..3` = `SETN`/`Z`/`V`/`C`,
   `SET 4` ist ein No-op, und `SETS` wandert in den Schatten-Kontext —
   das bleibt der Interrupt-Welt von Kapitel 5 vorbehalten.

**Nächstes Kapitel:** Flusskontrolle und Unterprogramme — die `Jcc`-Familie
mit ihren Delay Slots als größter Falle für Neuankömmlinge (§1.3 hat den
Verdacht geweckt, Kapitel 4 stellt ihn vor Gericht), sowie `LINK`/`JMP LR`
für den Sprung in Unterprogramme ohne Adress-Stapel.