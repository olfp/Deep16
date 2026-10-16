# STATUS.md — Fortschritt des Deep16-Buchs

> Ständig gepflegter Arbeitsstand. Letzte Änderung: 2026-10-16.
> Workflow-Regeln: [STYLE.md](STYLE.md).
>
> **2026-10-15:** **`see name`** — der Kern kann jetzt ein Wort **auseinandernehmen**
> statt es auszuführen. Eine Colon-Definition kommt als `: name … ;` zurück: der
> Thread wird Zelle für Zelle abgelaufen und jede `xt` über das Wörterbuch wieder
> zu einem Namen. Zellen mit **Inline-Daten** erkennt der Vorgänger: `lit` (Zahl),
> `litstr` (Zeichenkette, wieder als `." … "`), `(do)`/`(?do)` (die Ausstiegsadresse),
> `branch`/`0branch` (der Versatz). Andere Bauarten nennen das Wort, das sie gemacht
> hat — `variable`, `constant`, `create … does> …`, `vocabulary`, sonst `code`.
> Zwei Dinge werden **nicht** rekonstruiert: `if`/`then`/`begin`/`until` erscheinen
> als `(branch)`/`(0branch)` mit dem gespeicherten Versatz, und ein Wort, das die
> Suchordnung nicht erreicht, als `?<xt>`. Das Ende erkennt `see` an der **Adresse
> von `xt_exit`** (`;` kompiliert genau die, `exit` seine eigene Kennung) — deshalb
> bleibt der Rumpf nach einem `exit` mitten in der Definition sichtbar. Eine Zelle,
> die **kein** Wort benennt, ist keine Thread-Zelle: dort endet der Ablauf, statt in
> den Rest des Speichers zu laufen (das passiert bei einer Definition, deren `;`
> nie gelaufen ist). Details im Entscheidungs-Log.
>
> **2026-10-15 (zweiter Teil):** **Tier 1 — der Kern wächst zum Standard-Forth.**
> Der erste Schub fehlender Standardwörter ist da, 22 an der Zahl: `bl true false
> space spaces ?dup tuck -rot 2over 2swap u< u> 0<> within 2@ 2! count c, move
> fill erase type`. Zwei Fehler dieser Runde waren **Vorzeichen- und Richtungs-
> fehler an einer Stelle**, und beide hat erst die Probe gezeigt, nicht das Lesen:
> **(1)** In `move`, `fill`, `erase` und `type` stand der erste Operand dort, wo
> der **letzte** liegt — bei `erase` war der „Adress"operand damit die Länge, und
> das Wort schrieb ~13000 Zellen ab Adresse 1 aufwärts Null. **(2)** `count` schob
> mit `ADD SP, 1` statt `SUB`, also **hinter** die Leer-Marke; die zwei
> Ergebniszellen lagen außerhalb des Stapels und `depth` meldete Unsinn. Beide
> sind jetzt gepinnt. Dazu ein Befund über das Wörterbuch selbst, der als
> „Hänger" aussah und keiner war: **ein `variable` besitzt genau eine Datenzelle,
> und der Header des nächsten Wortes folgt unmittelbar dahinter** — ein `2!` auf
> ein `variable` überschreibt den Link des nächsten Namens, die Suche läuft dann
> in den Zahlenwert und kommt nicht zurück. Die Tests reservieren mit `2 allot`.
> **Nebenbei gefunden und nicht angefasst:** `<`, `>` und mit ihnen `min`/`max`
> lesen das **Vorzeichen einer Differenz** und sind falsch, sobald diese
> Differenz überläuft — `0x8000 1 <` ist falsch (richtig wäre wahr), `1 0x8000 >`
> ebenso, `0x8000 1 min` antwortet `1` statt `-32768`. Das ist vorbestehend, nicht
> Teil dieses Schubs, und im Entscheidungs-Log mit Reparaturweg vermerkt.
> Suite 463/463, `FORTH.md` und die Wörterbuchzahl auf **115**.
>
> **2026-10-15 (dritter Teil):** **Tier 1, zweiter Schub: Namen und Ausführung.**
> `'`, `char`, `execute`, `[']`, `[char]` und `literal` sind da — 121 Wörter.
> `'` war bis jetzt ein **Tokenizer**-Sonderfall: der Zweig hat das Zeichen
> stillschweigend geschluckt, `5 ' dup .` lief als `5 dup .`. Der Zweig ist weg,
> und `'` wird wie jedes andere Wort nachgeschlagen; geparst wird es von
> `find_token`, demselben Sucher, den `to` und `forget` benutzen, damit ein
> unbekannter Name sich genauso meldet wie dort.
> **Der Fund der Runde war ein alter Fehler im Zahlenscanner — `execute` war am
> Prompt gar nicht benutzbar.** Die „0x"-Erkennung prüfte nur das **zweite**
> Zeichen auf ein `x` und ließ jedes Zeichen über `'0'` bis dorthin durch. Also
> wurde `exe` die Zahl 0xE und `execute` die Zahl 0xEC; der Rest `ute` kam als
> unbekanntes Wort zurück. `exit` entkam nur, weil „xi" keine Hexziffer enthält
> und `parse_hex_finish` einen Präfix **ohne** Ziffer hinter sich zurück an
> `parse_word` schickt. Der Wächter ist jetzt `JNZ` statt `JN`: nur eine führende
> **`0`** öffnet „0x". Beide Seiten sind gepinnt — `0xec` ist 236, `exe` ist ein
> Wort — und ebenso `exit` und ein selbst definiertes `2x`.
> **`execute` springt auf das Code-Feld, nicht in die Resume-Liste.**
> `execute_xt` setzt IP auf die Liste des äußeren Interpreters; das ist am Prompt
> richtig und **in** einer Definition falsch, denn dort muss es in den
> aufrufenden Thread zurück. Weil der Sprung das IP unangetastet lässt, schiebt
> eine Colon-Definition ihre Rücksprungadresse selbst — `: t ['] + execute 10 + ;`
> gibt deshalb 13 und nicht 3 mit einem Absturz dahinter.
> `'` und `char` sind **nicht** immediat und parsen erst, wenn die Definition
> läuft (`: getxt ' ; getxt dup` findet wirklich `dup`); `[']`, `[char]` und
> `literal` arbeiten beim Übersetzen und teilen sich einen LINK-Unterprogramm
> `compile_lit`, der `LIT <Wert>` kompiliert. Was sie hinterlassen, zeigt `see`
> als **nackte Zahl** (`: t ['] dup ;` → `: t 12530 ;`): die Zelle *ist* eine
> Zahl, und eine xt, die zufällig auf ein Wort zeigt, ist keine Zusage.
> Suite **468/468**, `FORTH.md` mit neuem Abschnitt „Names and execution" und
> Wörterbuchzahl **121**.
>
> **2026-10-15 (vierter Teil):** **`<`/`>`/`min`/`max` sind repariert, und Tier 1
> hat seinen dritten Schub** — `>r`, `r>`, `r@`, `+loop`, `j`, `unloop`, jetzt
> **127 Wörter**. Der vorbestehende Vergleichsfehler ist zuerst weg, weil
> `+loop` dieselbe Frage stellt: `CMP a, b` setzt N aus dem **Vorzeichen** von
> `a-b` und V, wenn diese Differenz **überläuft**; `a < b` gilt genau dann, wenn
> **N und V sich unterscheiden**. Nur N zu lesen — was `JN` tut — ist richtig,
> solange `a-b` in eine Zelle passt, und `0x8000 1 <` antwortete deshalb falsch
> (nicht „kleiner", obwohl `-32768` es ist). Jede der vier Stellen wertet jetzt
> beide Flags aus: `JO` führt in einen zweiten Zweig, der das Vorzeichen
> umdreht. `loop` bleibt unangetastet — es prüft auf **Gleichheit**, und die
> stört ein Überlauf nicht.
> **Die teuerste Falle der Runde war wieder eine Zahl, die nicht passt:**
> `LDI RSTACK_TOP` lädt **nicht** `0x6F00`. Der Operand ist ein 15-Bit-Muster
> und die CPU **vorzeichenerweitert** Bit 14 nach Bit 15 — `0x6F00` kommt als
> `0xEF00` an, also als **negative** Zahl, und „RP liegt unter der Basis" war
> damit für jeden Rückstapelzeiger wahr. Der Fehler sah aus wie „`r>` findet den
> Stapel nicht": `5 >r r>` meldete Unterlauf, obwohl `5 >r` nachweislich
> schrieb (`rp_ptr @` zeigte `0x6EFF`). Die Basis liegt jetzt wie `sp0_base` in
> einer **Zelle** (`rp0_base`) — dieselbe Ursache, dieselbe Lösung, und der
> Grund steht als Kommentar an der Zelle.
> `>r`, `r>` und `r@` prüfen den Stapel, aus dem sie **nehmen**: `>r` den
> Datenstapel, `r>`/`r@` den Rückstapel gegen seine Basis, damit ein `r>` am
> Prompt „stack underflow" sagt statt freien Speicher zu lesen. Ein aus dem
> eigenen Aufrufrahmen genommener Wert bleibt undefiniert, wie der Standard es
> lässt. `+loop` zählt wie `loop` am **Rückstapel** und teilt dessen
> `loop_depth`; es endet beim ersten Index **jenseits** des Limits (`index <
> limit` für `n >= 0`, `index >= limit` für `n < 0`), und die Grenze ist
> dieselbe signierte Frage wie oben — `0x8000 0x8000 do i . 1 +loop` läuft
> **einmal**, nicht 65536-mal. `j` liest den Index vier Zellen weiter oben,
> `unloop` gibt den Rahmen zurück. **7 neue Tests**, 181 in der Datei,
> `FORTH.md` mit neuem Abschnitt „Return stack" und Zahl 121 → **127**.
>
> **2026-10-15 (fünfter Teil):** **Tier 1, vierter Schub: `base`, `hex`,
> `decimal`** — **130 Wörter**. `base` ist eine **Variable** (CFA `dovar`, die
> Datenzelle direkt dahinter), kein Konstantenwort wie `state`: Scanner und
> Drucker lesen dieselbe Zelle, deshalb wirkt `16 base !` genauso wie `hex`.
> Der Scanner folgt der Basis in **beide** Richtungen — über Basis zehn sind
> `A`–`F` Ziffern, also wird ein Token, das mit einem Buchstaben beginnt, zum
> Zahlenkandidaten (`ff` in hex), während ein Name, der nicht ganz aus Ziffern
> besteht, weiter zum Wörterbuch geht (`hex dup` läuft unter, statt zu 0xDUP zu
> werden). Nur ein Name, der in der aktuellen Basis **ganz** aus Ziffern
> besteht, kann nicht beides sein: `hex : beef 7 ; beef` liest 0xBEEF — solche
> Namen gehören ins Dezimale.
> **Der Drucker teilt durch die Basis statt durch zehn.** Der alte Kehrwert
> (`floor(u/10) = (u * 0xCCCD) >> 19`) konnte nur dezimal, und `DIV` ist
> **vorzeichenbehaftet** — ein Betrag über `0x7FFF` wäre falsch geteilt worden.
> Stattdessen die 32-Bit-Form mit **Null im hohen Halbwort**: Dividend
> `0:Betrag`, Divisor Basis, und Quotient wie Rest sind die **vorzeichenlose**
> Antwort. Deshalb druckt Basis zwei alle sechzehn Einsen von 65535 und
> `hex 0x8000 .` gibt `-8000`.
> Eine Basis **unter zwei** ist undefiniert (der Standard erlaubt zwei bis
> sechsunddreißig) und hier nur eine Zelle, also speicherbar: durch eins läuft
> die Division nie aus, durch null antwortet sie für immer `0xFFFF`. Der Drucker
> zählt deshalb bei **sechzehn Ziffern** ab statt beim Wert — der Puffer (32
> Zellen) läuft nicht über, und die Eingabeaufforderung kommt zurück.
> `FORTH.md` hat einen Abschnitt „Numbers and the base", Zahl 127 → **130**;
> **5 neue Tests**, 186 in der Datei.
> **Und der Fund, den erst die Suite gemacht hat:** der **Optimierer** kannte
> `DIV32` nur halb. Er wusste, dass das **Paar** `Rd:Rd+1` geschrieben wird,
> aber nicht, dass es auch **gelesen** wird — `Rd:Rd+1` *ist* der Dividend. Die
> Zuweisung, die das niedrige Halbwort füllt, sah damit wie ein toter Store aus
> und wurde entfernt; der Quotient entstand aus dem, was zufällig im Register
> stand. Genau das zeigte der Vergleich „optimierter Kern gegen Original": `3 4
> * .` druckte **22** statt **12**. `MUL32` hat diesen Eingang nicht (sein Paar
> ist reines Ergebnis), deshalb war der Fehler unsichtbar, solange der Drucker
> den Kehrwert über `MUL32` rechnete — der Test hat ihn in dem Moment gefunden,
> in dem der Drucker auf `DIV32` umgestellt wurde. Das Modell ist gerade gezogen
> und mit einem eigenen Test gepinnt.
>
> **2026-10-15 (sechster Teil):** **Tier 1, fünfter Schub: `s"`, `pick`, `roll`**
> — **132 Wörter**. `s"` ist wie `."` ein **Tokenizer**-Wort — was zwischen den
> Anführungszeichen steht, ist kein Token und kann nie im Wörterbuch landen — und
> unterscheidet sich von ihm an genau der Stelle, die für einen **Wert** zählt:
> das trennende Leerzeichen wird **geschluckt**. `s" xy"` ist also die zwei
> Zeichen lange Zeichenkette `xy`; `."` behält es, weil es nichts tut außer die
> gespeicherten Zeichen zu drucken und die Quelle dabei wieder hergeben muss.
> `see` setzt das Leerzeichen beim Drucken zurück (`s" ` + Zeichen + `"`), die
> Definition liest sich also wieder wie das Original. Interpretiert legt `s"`
> eine **Kopie** in einen eigenen Puffer und antwortet `( c-addr u )` — ein
> zweites `s"` überschreibt ihn, genau das meint der Standard mit „transient
> buffer"; übersetzt wandert der Text in die Definition und jeder Aufruf
> antwortet dieselben zwei Zellen. `\"` wird in beiden Hälften aufgelöst, und
> `s"x"` ohne Leerzeichen ist gar keine Zeichenkette (undefined word).
> **Struktur:** die Parser-Hälfte (`sq_token_check`, `sq_action`, `sq_compile`,
> `sq_interpret`) liegt im zweiten Code-Block, weil im ersten nur noch **22
> Wörter** frei waren; die Kopierschleife von `."` ist dabei zu **copy_string**
> geworden, das beide teilen, und der Tokenizer-Zweig selbst bleibt sechs Wörter
> lang. Die **Sprungweite** hat wieder zugeschlagen: zwei bedingte Sprünge über
> die Blockgrenze (2130 Wörter) und ein `JZ sb_end` in `see`, das durch die
> neuen Zeilen auf 258 Wörter rutschte, mussten zu `LDI` + `MOV PC, R0` werden —
> der Assembler meldet das, statt stillschweigend falsch zu kodieren.
> `pick` und `roll` brauchen **u+1** Zellen und zählen von oben; jede prüft das
> selbst. `roll` schiebt **von unten** nach, weil ein Offset von −1 in diesem
> Befehlssatz stillschweigend 31 hieße und quer über den Stapel schriebe.
> **2 neue Tests**, 188 in der Datei.
>
> **2026-10-15 (siebter Teil):** **Tier 1, sechster Schub: `<# # #s #> hold
> sign`** — **138 Wörter**, damit ist die Tier-1-Liste abgearbeitet. Diese sechs
> Wörter *drucken* eine Zahl nicht, sondern **bauen** sie in einem Halte-Bereich,
> den danach `type` schreibt. Die Zahl ist ein **Doppel** aus zwei Zellen mit dem
> **hohen Halbwort oben** — genau die Ordnung, die das Standard-Beispiel
> `dup abs 0 <# #s rot sign #>` voraussetzt. `#` teilt es durch die **aktuelle
> Basis**, deshalb druckt dasselbe Idiom nach `hex` hexadezimal.
> **Der Halte-Bereich** ist ein fester Puffer, dessen Zeiger von **oben nach
> unten** läuft: so stehen die Zeichen schon in Leserichtung und nichts muss
> umgedreht werden. Mehr als vierzig Zeichen in einem Bild werden **verworfen**
> statt hinter den Puffer geschrieben — dieselbe Abwägung wie beim Drucker für
> eine Basis unter zwei. **Grenze, dokumentiert:** `#` teilt mit dem 32-Bit-`DIV`,
> dessen Dividend ein **vorzeichenbehaftetes** Paar ist, während der `ud` des
> Standards vorzeichenlos ist — ein Doppel ab `0x80000000` rechnet also falsch.
> Jede Art, hier ein Doppel zu bauen (`dup abs 0`, `s>d` von Hand), lässt das
> hohe Halbwort 0, und das ist der Fall, für den die Wörter da sind.
> **Ein echter Fund dieser Runde:** in `hld_step` stand `LDI base_var` **zwischen**
> dem Laden des Dividenden und `DIV32` — `LDI` schreibt R0, und R0 hält das hohe
> Halbwort, also bekam die Division eine **Adresse** als Dividend (`0/10` ergab
> `0xCCCC`, `#s` lief deshalb **endlos**). Die Basis wird jetzt **vor** dem
> Dividenden geladen; das ist genau die Falle, die `print_number` mit seinem
> `LDI 0; MOV R1, R2` in der richtigen Reihenfolge schon vermeidet.
> **2 neue Tests**, 190 in der Datei.
>
> **2026-10-15 (achter Teil):** **Doppelzellen-Arithmetik** — **151 Wörter**. Ein
> Doppel sind **zwei Zellen mit dem hohen Halbwort oben**: die Ordnung, die
> `#`/`#>` schon benutzen und die `s>d` herstellt. `d+`, `d-`, `m+` und
> `dnegate` tragen vom niedrigen ins hohe Halbwort — genau dafür ist das
> **Carry-Flag** da, und es muss **sofort** gelesen werden: `LDI` löscht das
> ganze Flag-Nibble, und jede spätere Instruktion überschreibt es. `d<`
> vergleicht die hohen Halbwörter vorzeichenbehaftet (derselbe N/V-Test wie
> `<`) und die niedrigen **vorzeichenlos**, sobald die hohen gleich sind: −2 ist
> `0xFFFF:0xFFFE` und −1 ist `0xFFFF:0xFFFF`, dort entscheiden die niedrigen
> Zellen also als vorzeichenlose.
> **Zwei Funde dieser Runde.** *Erstens:* **`MUL32` ist unsigniert**, und das
> **hohe** Halbwort eines Produkts hängt sehr wohl von den Vorzeichen ab
> (`3 × −4 = −12`, aber `3 × 0xFFFC = 0x0002FFF4`) — der Satz „das niedrige
> Halbwort hängt nicht vom Vorzeichen ab" gilt eben nur für das *niedrige*.
> `m*` korrigiert den unsignierten Wert: jeder negative Operand zieht den
> anderen einmal ab, und das landet ganz im hohen Halbwort. *Zweitens:* die
> **Antwortreihenfolge** der drei Divisionen — der Standard gibt **Quotient
> oben**, Rest darunter (`u3`/`n3`) — die erste Fassung hatte es umgekehrt, und
> zwar so konsequent, dass die ersten Tests die falsche Ordnung mitgeschrieben
> haben; aufgefallen ist es erst, als eine Zeile mit `u.` den Rest oben sah.
> **Grenzen, dokumentiert:** `um/mod` ist exakt, solange der Quotient in eine
> Zelle passt *und* der Divisor unter `0x8000` liegt — dann ist auch das hohe
> Halbwort des Dividenden kleiner als der Divisor, also sind beide Operanden
> nicht-negativ und die signierte Division *ist* die unsignierte. Ein
> unsignierter Divisor ab `32768` wird als negativ gelesen und kommt signiert
> heraus; abgestürzt ist dabei nichts (geprüft: der `INT_MIN / −1`-Fall liefert
> 0/0, kein Hänger). **6 neue Tests**, 196 in der Datei.
>
> **2026-10-15 (neunter Teil):** **Tier 2, zweiter Schub: `case of endof
> endcase`** — **155 Wörter**. `case` wählt eine Klausel, indem es einen Selektor
> mit den Testwerten vergleicht. Die vier Wörter sind **immediate** und
> kompilieren nichts Neues: **`of` ist `over = if drop`**, `endof` ist `else`
> Wort für Wort (ein Sprung auf `word_else`, damit der Rumpf nicht doppelt
> dasteht), und `endcase` kompiliert ein `drop` und löst die Zweige auf. `see`
> zeigt eine `case`-Definition deshalb als das, was sie ist: `1 over = (0branch)
> 7 drop 65 emit (branch) 17 …`.
> **Die Buchhaltung liegt auf dem Kompilier-Rückstapel** — derselbe wie der
> Laufzeit-Rückstapel: `case` legt eine **Marke** ab (Null, und Null ist keine
> Adresse), `of` den Platzhalter, den `endof` flickt. **Zwei Wächter:**
> `case_depth` zählt die offenen Paare, damit ein verwaistes `endcase` nichts
> tut, und die Auflöseschleife **flickt nur Adressen im Wörterbuch**
> (`dict_free` … `0x3FFF`), damit ein nie geschlossenes `case` einen späteren
> `endcase` nicht dazu bringt, einen Versatz irgendwohin zu schreiben.
> **Zwei Funde, beide von den Tests gemacht:** *(1)* die vier Header hatten das
> **IMMEDIATE-Bit nicht** — die Wörter wurden also **kompiliert** statt
> ausgeführt, und `see` zeigte die Quelle (`case 1 of …`) statt der Zweige; der
> `see`-Ausdruck hat es verraten. *(2)* **`LDI 0x4000` ist nicht `0x4000`** (Bit
> 14 ist das Vorzeichen, geladen wird `0xC000`): die obere Grenze des
> Wächter-Bereichs wurde damit negativ, der Wächter schlug bei **jeder** echten
> Platzhalteradresse zu, `endcase` flickte nichts — und das `(branch)` eines
> `endof` blieb auf Versatz 0 stehen, sodass die Maschine nach dem ersten `emit`
> in unbeschriebenen Speicher lief. Jetzt entscheiden **Carry-Vergleiche** (exakt
> unsigniert) gegen `dict_free` und `0x3FFF`.
> **Die Standard-Regel**, die man beim Schreiben kennen muss: den Selektor
> verwirft die passende Klausel, sonst `endcase`. Wer ein *Ergebnis* will, legt
> es mit `0 swap endcase` unter den Selektor oder hält ihn mit `dup` in der
> Standardklausel. **3 neue Tests**, 199 in der Datei.
>
> **2026-10-15 (zehnter Teil):** **Tier 2, dritter Schub: Zeichenkettenwörter** —
> **162 Wörter**: `cmove`, `cmove>`, `blank`, `-trailing`, `compare`, `search`,
> `/string`. Weil hier ein **Zeichen eine Zelle** ist, sind `cmove` = `move` und
> `blank` = `fill` mit einem Leerzeichen — sie unterscheiden sich nur dort, wo
> eine Zelle zwei Zeichen hält — und `/string` addiert `n` direkt auf die
> Adresse. **`cmove>`** ist das eine Wort, das wirklich anders läuft: es kopiert
> von **oben nach unten**, die Richtung, die `move` als Aufgabe des Aufrufers
> dokumentiert (dass `cmove` mit dem Ziel über der Quelle das erste Zeichen
> verdoppelt, ist gepinnt). `compare` und `search` lesen Zellen und vergleichen
> **vorzeichenlos**: 128 ist größer als 127, und `search` antwortet den **Rest
> der Zeichenkette ab dem Treffer**, sodass `search type` druckt, was übrig
> bleibt.
> **Zwei Funde.** *(1)* `cmove>` setzte seine Zeiger eine Zelle zu tief an: die
> Zeiger müssen erst um `u` erhöht und **dann** schrittweise gesenkt werden. Das
> Ergebnis sah wie „falsche Richtung" aus, war aber eine falsche **Startlage**.
> *(2)* Ein **doppelter Labelname**: `/string` benutzte `wls_ok`, das schon
> `word_lshift` gehört — der Assembler nimmt die *letzte* Definition und sagt
> nichts dazu, gemeldet wurde nur ein Sprung „zu weit". Dafür gibt es jetzt einen
> Test, der die ~850 Labels der Quelldatei auf Eindeutigkeit prüft.
> **5 neue Tests**, 204 in der Datei.
>
> **2026-10-15 (elfter Teil):** **Tier 2, vierter Schub: Ausnahmen** —
> **166 Wörter**: `catch`, `throw`, `abort`, `abort"`. `catch` führt ein xt mit
> einem **Rahmen auf dem Rückstapel** aus, der festhält, wo es weitergeht, wie
> tief der Datenstapel war und welcher `catch` außen liegt; `throw` sucht diesen
> Rahmen, **schneidet den Datenstapel auf die gemerkte Tiefe zurück**, wickelt den
> Rückstapel bis zum Rahmen ab und setzt dort mit dem Code obenauf fort — ein
> `throw` aus der Tiefe einer Aufrufkette kommt also an, als wären die Aufrufe
> zurückgekehrt. Null ist keine Ausnahme, `abort` ist der `-1 throw` des
> Standards, und `abort"` druckt seinen Text und wirft `-2`.
> **Das xt wird so betreten wie von `execute`** (W gesetzt, IP unangetastet),
> außer dass IP vorher auf einen **einzelligen Thread** zeigt: so landet das Ende
> des xt in `word_catch_ok` statt im Interpreter. Ein `throw` zeigt auf den
> anderen Thread (`word_catch_thrown`), der dieselbe Buchhaltung ohne die Null
> macht. **Die Kernel-Fehler sind jetzt Ausnahmen**, solange ein Handler in
> Reichweite ist: ein Stapelunterlauf wirft `-4`, ein unbekannter Name `-13`
> (der wird erst mit `evaluate` erreichbar). Ohne Handler bleibt alles wie vorher:
> Meldung und frische Eingabeaufforderung.
> **Zwei Funde, beide wieder von der Maschine:** *(1)* `LDI`-Falle Nummer vier:
> `LD R1, R9, 0` liest über **ES** — der IP des Aufrufers landete im Bildschirm,
> der Rahmen war falsch, und die Maschine lief in den Acker. Ein neuer Test
> verbietet jetzt **jedes** `LD`/`ST` mit R8 oder R9 als Adressbasis in der
> Quelldatei. *(2)* `print_zstring` ist LINK-aufgerufen **und** ruft selbst per
> LINK `put_char` — das überschreibt LR, also kehrte es irgendwohin zurück. Ein
> LR-Platz ist jetzt geparkt; nebenbei steht dort auch, dass nur R1–R3 den
> BIOS-Aufruf überleben (deshalb läuft der Zeiger in R3, wie in `word_litstr`).
> **5 neue Tests**, 209 in der Datei.
>
> **2026-10-15 (zwölfter Teil):** **Tier 2, fünfter Schub: `evaluate`** —
> **167 Wörter**. `evaluate` schickt eine Zeichenkette durch **denselben
> Tokenizer und dieselben Wörter** wie die Tastaturzeile, im aktuellen Zustand:
> eine Zeichenkette kann also Wörter definieren oder rechnen. Sie wird in einen
> **eigenen Puffer je Verschachtelungstiefe** kopiert (eine innere Auswertung darf den
> Text, den der Aufrufer noch liest, nicht überschreiben) und mit einer
> **Nullzelle** abgeschlossen, weil der Interpreter dort endet. Zwei Ebenen
> verschachteln (der Standard verlangt zwei); eine zu lange Zeile oder eine
> dritte Ebene wirft `-22`.
> **Zwei Dinge folgen daraus, und beide sind gepinnt:** ein **unbekannter Name**
> innerhalb einer Auswertung erreicht einen Handler als `-13` — das ist der
> erste Weg, diesen Code überhaupt zu erreichen, denn *der Interpreter* findet
> den Namen; und ein `throw` aus einer Auswertung setzt die **Eingabequelle**
> zurück, sodass die Zeile, in der es passierte, weiterläuft, statt den
> abgebrochenen Text noch einmal zu lesen.
> **Drei Funde, alle von der Maschine.** *(1)* Der Endeverweis `interpret_done`
> liegt im **engen 0x0100-Block** — mein `eval_check` sprengte ihn, und `.org
> 0x0500` hat den Schwanz **stillschweigend überschrieben**, sodass der Ablauf in
> `word_plus` fiel: jede Zeile endete mit einem Unterlauf. Die Prüfung liegt
> jetzt im 0x0500-Block, `interpret_done` ist drei Wörter kurz. *(2)* `SUB R1, 22`
> passt nicht: das ALU-Immediate ist **vier Bit** — `LDI -22` ist die richtige
> Form. *(3)* Bei einer **interpretierten** Auswertung zeigt IP auf `resume_list`
> (der Interpreter hat das Wort gerade aufgerufen), nicht auf einen Thread: der
> Rücksprung muss dort in `interpret_loop` gehen, damit der Rest der Zeile noch
> läuft. **2 neue Tests**, 211 in der Datei.
>
> **2026-10-15 (dreizehnter Teil):** **Tier 2, sechster Schub: der Rest der
> Doppelzellen, und `state` ist eine Variable** — **179 Wörter**. Zwölf neue
> Wörter: `d>s dabs dmax dmin 2literal 2>r 2r> 2r@ 2constant 2variable d. d.r`.
> `dmax`/`dmin` teilen sich die Vergleichsroutine `dless`, mit der auch `d<`
> entscheidet — die alten `d<`-Tests halten den Umbau fest, und der Überlauf am
> Vorzeichenrand (`0 0x8000` gegen `1 0`) stimmt weiterhin. `d.`/`d.r` bauen ihre
> Ziffern **im selben Haltebereich wie `#`**, in der aktuellen Basis.
> **Der Fund der Runde war die Reihenfolge des Minus: `d.` druckte `5-`.** Der
> Bereich füllt sich **rückwärts** (der Zeiger sinkt), also liest sich das
> zuletzt Gehaltene zuerst — genau deshalb ruft der Standard `sign` **nach**
> `#s`. `hold_double` merkt sich das Vorzeichen in einer Zelle und hält das Minus
> erst nach der Ziffernschleife.
> **Zwei alte Fallen, beide wieder zugeschnappt.** *(1)* `hold_double` ruft
> `hld_put` und `hld_step` über `LINK`, und `LINK` zerstört `LR`: dieselbe
> Parkzelle wie bei `print_zstring` ist jetzt auch hier Pflicht, sonst kehrt der
> `JMP LR` an die falsche Stelle zurück. *(2)* Ein **doppeltes Label** `pc_done`
> (in `print_cells` und im 0x2000-Block) ließ den Assembler den weiten Sprung
> melden — der Test über eindeutige Label hat beide Seiten; das lokale heißt
> jetzt `pcs_done`.
> **`state` ist jetzt wirklich eine Variable.** Der Header zeigt nicht mehr auf
> eine Zelle, die den **Wert** schiebt, sondern auf `dovar`, und die Zelle liegt
> direkt hinter dem Code-Feld — wie bei `base`. `state @` ist `0` beim
> Interpretieren und `1` beim Übersetzen (ein immediate-Wort ist der Weg, das zu
> sehen). Der alte `word_state` ist weg; der Test pinnte bisher den Wert und heißt
> jetzt `state @ .`. **`see` nennt ein `2constant`** (`2constant name x1 x2`) über
> eine `doconst2`-Verzweigung, statt es als `code` auszugeben.
> **6 neue Tests**, 512 in der Suite.
>
> **2026-10-15 (vierzehnter Teil):** **`form` und Umbruch an der rechten Kante**
> — **180 Wörter**. `form` antwortet `( -- rows cols )` = `24 80` (die **sichtbaren**
> 24 Zeilen, nicht die 25, die `binit` löscht: Zeile 24 ist die Scroll-Reservezeile)
> und ist die **erste nichstandard-Erweiterung** dieses Schubs; die Zellen liegen
> wie bei `2constant` hinter dem Code-Feld. Damit können `words` und `see`
> **an der letzten Lücke vor dem Rand** umbrechen statt mitten durch ein Wort: passt
> das nächste Token samt Trenn-Leerzeichen nicht mehr, kommt vorher CR+LF, sodass
> das Token ganz in der nächsten Zeile beginnt. Die Spalte kommt aus dem
> Bildschirmcursor `SCR` — das ist die **einzige** Stelle, an der die Ausgabe den
> Bildschirm fragt, wo er steht; ein UART-Port würde nur diese Routine ändern.
> **Drei Funde, alle von der Maschine:** *(1)* `wrap_if` ruft `put_char` über
> `LINK` und muss `LR` parken — dieselbe Falle wie `print_zstring` und
> `hold_double`; ohne sie kehrte der Umbruch an eine beliebige Stelle zurück und
> `words`/`see` hingen nach der Eingabezeile. *(2)* **`DIV` liefert nur den
> Quotienten, keinen Rest** (den Rest gibt es nur bei `DIV32` in `Rd+1`): die
> Spalte ist `Offset − row*80`, wie es `bios_putch_cr` schon rechnet. *(3)*
> `R9` als `LD`/`ST`-Basis geht über `ES` (den Bildschirm); die Zellbasis musste
> `R10` werden — der bestehende Test „keine Adressbasis R8/R9" hat es gefangen.
> **Nebenbei:** der 0x2000-Block schrumpfte auf **40 freie Wörter**; die neuen
> Helfer (`wrap_if`, `number_width`) liegen deshalb im 0x0500-Block. **3 neue
> Tests**, 515 im Repo. `FORTH.md`: `form`-Zeile und Umbruch-Absatz in „Input,
> output and screen", Zahl 179 → **180**.
>
> **2026-10-16 (fünfzehnter Teil):** **Der Umbruch ließ Cursor-Reste stehen.**
> Der vom Nutzer gesehene Fehler: am Ende jeder umbrochenen Zeile blieb ein
> **reverser Block** stehen. Ursache ist die Cursor-Darstellung der Maschine:
> ein normales `putch` setzt das Cursor-Attribut auf die Zelle, auf die es
> vorrückt, aber **CR und LF bewegen nur `SCR`** — das Attribut bleibt also am
> Zeilenende liegen, und die neue Zeile bekommt keins. Der Kernel macht das an
> jeder anderen Stelle richtig: `ok_after` und `word_cr` rufen vor dem Umbruch
> `clear_cursor` („sonst behält jede fertige Zeile einen Block am Ende").
> `wrap_if` tut jetzt dasselbe, aber **inline mit `R4`** statt über
> `clear_cursor`, weil `see_puts` seinen Zeiger in `R1` über den Aufruf trägt und
> `clear_cursor` `R1` benutzt. Ein Test zählt die Cursor-Zellen: vorher 10 (9
> Reste), jetzt genau **eine**, und auf der Umbruchzeile keine. **1 neuer Test**,
> 516 im Repo.
>
> **2026-10-14 (dritter Teil):** **`do`/`loop` sind da** — mit `?do`, `leave`
> und `i`. Der Loop-Rahmen liegt auf dem Rückstapel, vier Zellen unter den
> Aufrufsrahmen. Die teuerste Falle war nicht der Inhalt, sondern die
> **Disziplin**: bei einer Zelle sind „RP zeigt auf die eben geschriebene" und
> „RP zeigt auf den untersten Rahmen" dasselbe, bei vier nicht — der Rahmen lag
> eine Zelle zu tief, `exit` bekam den Loop-Limit als Rücksprungadresse und die
> Maschine blieb stehen, lange nachdem alle Werte richtig aussahen. Damit sind
> **alle vier** „das kann der Kern nicht"-Vermerke in `forth/hanoi.fth`
> erledigt; der vierte (`2dup`) war nie einer. Offen bleibt nur Ausstattung, die
> kein Beispiel im Repo braucht (`+do`, `j`, `r@`/`r!`).
>
> **2026-10-14 (zweiter Teil):** `."` ist als IMMEDIATE-Wort fertig — in einer
> Definition wird der Text **beim Aufruf** gedruckt, nicht beim Übersetzen. Der
> als „Store schreibt nicht" notierte Blocker lag drei Ebenen darüber: der
> Assembler ließ den dritten Operanden einer dreistelligen ALU-Zeile fallen,
> **R9 ist ein ES-Base-Register** (PSW.ER = 8 mit Dual-Bit), und ein
> Leerzeichen im String galt als Trenner. Und von den vier „das kann der Kern
> nicht"-Vermerken in `forth/hanoi.fth` ist der vierte (**`2dup`**) zurückgenommen:
> der Testfall war falsch, nicht das Wort. Offen bleibt **`do`/`loop`**.
>
> **2026-10-14:** Am **Forth-Kern** (`asm/forth.asm`) — dem Kernprogramm des
> Projekts — wurde die älteste Lücke geschlossen. `forth/hanoi.fth` trug vier
> „das kann der Kernel nicht"-Vermerke; **zwei** davon sind erledigt
> (Hex-Literale, Bitoperationen), zwei bleiben (`.` `"` als IMMEDIATE-Wort,
> `do`/`loop`). Zusätzlich sind zwei Umwege weggefallen, die sich `hanoi.fth`
> wegen dieser Lücken selbst auferlegt hatte (`LWI`, Türme als `variable`).
> Die beiden teuersten Fehlerkategorien dieser Runde stehen im
> Entscheidungs-Log: eine verletzte **SP-Disziplin** meldet sich erst im
> *nächsten* Wort, und im Tokenizer sind nur **drei** Register frei — R5 und R6
> sind Aliase für `>IN` und `TIB`. Stand und Reihenfolge des Rests in
> „Nächste Schritte" Nr. 8.
>
> **2026-10-10:** Neuer Abschnitt „FPGA-Ziel Tang Nano 9K — Auslegungsbefunde"
> und „Iterativer Teiler"; „Bekannte Mängel" ist nicht mehr leer. Für den
> künftigen Hardware-Interrupt ist **Option 4 (Drain)** entschieden, für den
> Teiler ein **handgeschriebener iterativer Radix-4-Kern**.

---

## Überblick

| Kapitel | Titel | Stand | Verifiziert | EPUB |
|---------|-------|-------|-------------|------|
| 1 | Warum eine 16-Bit-CPU? | ✅ fertig | beide Kerne | ✅ SVG-Diagramm |
| 2 | Register und Speicher organisieren | ✅ fertig | beide Kerne | ✅ SVG-Diagramm |
| 3 | Die ALU-Werkstatt: Befehle für Einsteiger | ✅ fertig | beide Kerne | ✅ 32 SVG-Diagramme |
| 4 | Flusskontrolle und Unterprogramme | ✅ fertig | beide Kerne | ✅ 4 SVG-Diagramme |
| 5 | Interrupts und Shadow-Register | ✅ fertig | beide Kerne | ✅ 8 SVG-Diagramme |
| 6 | Der Simulator als Werkbank | ✅ fertig | beide Kerne | ✅ 1 SVG-Diagramm |
| 7 | Ein Mini-Forth | ✅ fertig | beide Kerne | ✅ 1 SVG-Diagramm |
| 8 | Snake auf dem Bildschirmpuffer | ✅ fertig | beide Kerne | ✅ 1 SVG-Diagramm |
| A–D | Anhänge | ✅ fertig | alle drei Kerne | ✅ 1 SVG-Diagramm |

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

### ✅ Kapitel 6 — `book/kap06.md`
- §6.1 Peripherie ist Speicher: **Tabelle 6-1** Speicherkarte, **Tabelle 6-2**
  Tastaturports, `ES = 0xF000` als Peripherie-Segment (Offsets `0x0060`,
  `0x0062`, `0x1000`), Bildschirmzelle (Low-Byte = Zeichen, High-Byte =
  4 Bit Hintergrund über 4 Bit Vordergrund) mit Mermaid-Bitdiagramm,
  Listing 6-1/6-2.

  ⚠️ **Kapitel 6 beschreibt noch die alte Fassung** mit Bit 15 als
  Reverse-Video/Cursor und einem `0x8020` als Cursorwort. Die Beschreibung und
  Listing 6-1 gehören auf den neuen Stand gebracht.
- §6.2 Debuggen: Delay-Slot-Falle **messbar** (`R1` = 5 statt 1, 30 statt 31
  Schritte), LDI-Vorzeichengrenze, Debugger-Hooks `getRecentMemoryView()` /
  `get_recent_access()`, Begründung der Doppel-Implementierung.
- **Beispiel:** Terminal-Schleife (Listing 6-5), Tastatur → Bildschirm, mit
  Wartebudget statt Endlosschleife.
- Kernbefund: **nur `LDS`/`STS` dekodieren Ports** — `LD`/`ST` liefern an
  `0xF0060` den RAM-Füllwert `0xFFFF`. Auf beiden Kernen gemessen.
- Nebenbefund, dokumentiert statt verschwiegen: der Assembler prüft `LDI`
  nach unten (`-16384..16383`), nach oben nur gegen die Bitbreite — so ergibt
  `LDI 20000` auf der CPU `0xCE20` (gemessen `−12992`). Beide Kerne irren
  sich gleich.
- Verifikation: `npm test`, `tests/cores.test.js`, `tests/rtl.test.js`,
  Probe `probe_kap06.mjs` 71/71, Extractor `extract_kap06.mjs` 94/94,
  alle drei EPUB-Varianten mit 6 Kapiteln und 47 Diagrammen.
- **Nachtrag (2026-10-10):** Absatz „Warum zwei Kerne" auf **drei** Kerne
  umgestellt — JS, Rust/WASM und das Verilog-Modell (`VERILOG.md`). Messwerte
  unverändert (die Schrittzahlen stimmen auch auf dem RTL-Kern), nur die
  Begründung trägt jetzt eine Pipeline *und* zwei Interpreter.

### ✅ Kapitel 7 — `book/kap07.md` (1006 Zeilen)
- §7.1 Die REPL-Schleife: Listing 7-1 (Zeile lesen + Echo), Listing 7-2
  (Wort schneiden) samt der Lektion, dass `CMP R5, 32` am 4-Bit-Immediate
  scheitert (`Immediate value 32 out of range (0-15)`).
- §7.2 Wörterbuch: Listing 7-3 — lineare Suche über XOR-und-OR, dazu der
  Fehlerpfad. Sieben Eingaben (`ABC`, `DEF`, `GHI`, `AB`, `ABCD`, `XYZ`,
  `A`) mit gemessenen Opcodes und einem Fragezeichen für alles Unbekannte.
- §7.3 Zahlen: Listing 7-4 — Ziffernprüfung per `DIV` als Türsteher,
  Dezimalwandler mit `DIV32` (Quotient und Rest in einem Rutsch).
- **Beispiel:** Listing 7-5, das Schlussprogramm (261 Zeilen, die drei
  Stufen zusammengesetzt) — Zahl ausgeben oder Wörterbuch befragen.
- Zwei Fallen, die beim Schreiben real aufgetreten sind und jetzt im Text
  stehen: `MUL32` **überschreibt beide Operandenregister** (danach war
  `R10` = 0 und der nächste `DIV` teilte durch Null → `0xFFFF`), und das
  32-Bit-Paar steht **hoch in `Rd`**, niedrig in `Rd+1` — für Ergebnis
  *und* Dividenden. Beides fällt nicht auf, es rechnet nur falsch.
- Verifikation: `npm test` 296/296, Extractor `extract_kap07.mjs` 276/276
  (fünf Listings × Eingabefälle auf allen drei Kernen), Dreikern-Gleichlauf
  31 Listings ohne Abweichung.

### ✅ Kapitel 8 — `book/kap08.md` (669 Zeilen)
- §8.1 Adressrechnung: Listing 8-1 (Zelle (2,7) → `0x10A7`), Tabelle 8-1 mit
  den drei Randadressen, Listing 8-2 zeichnet den Rahmen (206 `*`, 1794
  Leerzeichen, 54463 Schritte, alle drei Kerne).
- §8.2 Scrollen: Listing 8-3 schiebt 1920 Wörter r��ckwärts; **1920/1920 Zellen
  wie erwartet**, 0 Abweichungen zwischen den Kernen. Die letzten 80 Zellen
  bleiben unberührt — korrekt, denn die unterste Zeile steht still.
- §8.3 Das Spiel: Listing 8-4 (247 Zeilen, zwei Unterprogramme `feld`/`setz`).
  Tabelle 8-3 listet **zehn gemessene Spielzüge** — einzelne Schritte, ein
  geschlossenes Quadrat (`dswa`), eine ignorierte Taste, `Enter` als Ausstieg
  (71 Schritte) und alle vier Randtreffer mit sichtbarem `X`.
- **Drei Fehler, die beim Bauen real aufgetreten sind und jetzt im Buch stehen:**
  Der Spaltenzähler stand *im Kopf* der Schleife, die ihn hochzählt (500000
  Schritte ohne `HALT`); `LINK` ist kein Aufruf, sondern setzt nur `LR`; und
  das Ergebnisregister der Adressrechnung wurde vom `LDI`-Scratch überschrieben
  — das Spiel schrieb daraufhin nach `0x0110` und `0x01C4`, also in den
  **Programmspeicher statt auf den Bildschirm**.
- Verifikation: `npm test` 296/296, Extractor `extract_kap08.mjs` 172/172
  (vier Listings × Fälle auf allen drei Kernen, inklusive vollständiger
  Bildschirmprüfung aller 2000 Zellen), Dreikern-Gleichlauf 35 Listings ohne
  Abweichung.

### ✅ Anhänge A–D — `book/anhang.md` (495 Zeilen)
- **Anhang A — Befehlsreferenz** in sieben Abschnitten (Laden/Segment,
  ALU/Schieben/MUL-DIV, Speicher, Sprünge, System, Pseudonyme, „Was es nicht
  gibt"). **67 von 67 Beispielwörtern am Assembler gemessen.** Zwei Korrekturen
  ergaben sich daraus, beide gegen die Intuition:
  `LDI -1` kodiert `7FFF` (nicht `FFFF` — die CPU erweitert vorzeichenrichtig,
  §6.2), und `JMP LR` ist `FBF8`, das Pseudonym für `MOV PC, LR, 0`.
- **Anhang B — PSW** mit dem Spickzettel-Diagramm (aus `book/test/mmtest.md`
  übernommen) und **Tabelle B-2**: welcher Befehl welches Flag setzt.
  Kernaussage: Lade- und Speicherbefehle setzen **keine** Flags.
- **Anhang C — Glossar** mit je einer Spalte „Bedeutung" und „auf dem 6502?",
  dazu eine zweite Tabelle der 6502-Begriffe und ihrer Entsprechung.
- **Anhang D — Quellen und Werkzeuge**: die drei Kerne, die Prüfbefehle, das
  Simulator-Fenster, die Spezifikation (mit dem Hinweis auf ihre veraltete
  Opcode-Tabelle), die bewusst ausgelassenen Themen **GFX, PSRAM**
  samt Wiedervorlage-Bedingung, und die Werkzeuge der Buchproduktion.
- **Befund an der Spezifikation:** Die **Opcode-Tabellen der Spec stimmen mit
  dem Assembler überein** — Schiebegruppe `110 10000`–`110 11011` (12/12),
  `MUL`/`DIV` `110 11100`–`110 11111` (4/4), Systemgruppe ab `11111111110`
  (4/4), jeweils durch Nachmessen des Assemblers belegt. Die frühere Notiz,
  die drei Opcode-Bereiche für veraltet hielt, war **selber veraltet**: der
  abweichende `MUL32`-Entwurf `[110][101][Rd4][w1][i1][Rs4]` wurde durch
  `110 11101` ersetzt, und die Spec-Zeilen standen in **jeder** Revision
  identisch (10 Commits zurück bis `1bce2ee`, ebenso in `old/`). Der
  einzige verbliebene Spec-Fehler ist semantischer Natur: Tabelle 14
  etikettierte `DIV32` als „32÷16→32-bit divide", obwohl der Quotient auf
  16 Bit gekappt wird (siehe Entscheidungs-Log). Die **33 Opcode-Diagramme
  der Kapitel 3–6 wurden gegen den Assembler geprüft und stimmen alle.**
- **Verifikation:** `probe_anhang_a.mjs` 67/67 Beispielwörter,
  `probe_diagramme.mjs` 33/33 Diagramme, `probe_reject.mjs` 26/26 abgelehnte
  6502-Befehle mit wörtlichen Fehlertexten, `npm test` 296/296.

---

## Build & Tooling

| Aufgabe | Befehl |
|---------|--------|
| Tests | `npm test` (alle `tests/*.test.js`) |
| EPUB bauen (SVG, Apple Books) | `./book/build/build-epub.sh` → `book/epub/Deep16.epub` (Pandoc epub3 + Mermaid-SVG-Filter) |
| EPUB bauen (PNG, Kindle) | `./book/build/build-epub.sh kindle` → `book/epub/Deep16-kindle.epub` (PNG-Diagramme + normalisierte Metadaten, gegen E016) |
| EPUB bauen (Kindle, Calibre-Round-Trip) | `./book/build/build-epub.sh kindle-calibre` → `book/epub/Deep16-kindle-calibre.epub` — **die für Amazon gültige Datei** (E016 gelöst, am Gerät bestätigt) |
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
| 2026-10-07 | Mermaid wird vor dem EPUB-Build zu **SVG** vorgerendert (Lua-Filter + mmdc); EPUB3 `--embed-resources`. | `book/build/mermaid_filter.lua`, `book/build/build-epub.sh` |
| 2026-10-07 | **Jeder neu eingeführte Befehl** bekommt ein Bit-Codierungs-Diagramm. | kap03 (32 Diagramme) |
| 2026-10-08 | Diagramme brauchen eine **Titelzeile** (`**`Mnemonic` — Funktion**`). | kap03 |
| 2026-10-08 | `STYLE.md`/`STATUS.md` angelegt; Workflow ab jetzt verbindlich. | Repo |
| — | `SETS`/`CLRS` (Bit 5) als Footgun **dokumentiert** (Kap. 5), nicht im Kapitel demonstriert. | kap03, kap05 |
| 2026-10-08 | **MOV imm2-Redesign** (`ARCHREV.md`) ins Buch übertragen: §2.1 erklärt `imm2` als Funktionsauswahl (Tabelle 2-1), §4.2 auf Funktion 2 umformuliert. Keine Messung, kein Listing und keine Spezifikations-Verweisung mussten geändert werden; Diagramme unangetastet. | kap02, kap04 |
| 2026-10-09 | **EPUB-XHTML-Wohlgeformtheit** (Apple Books brach mit „Specification mandates value for attribute style" ab): `mermaid_filter.lua` entfernt leere SVG-Attribute (`style=""`, von Pandoc 3.7 sonst zu wertlosem `style` verkürzt) und escapet nackte `&` (SIL-OFL-Lizenzkommentar im eingebetteten `@font-face`) zu `&amp;`. Alle 11 XML-Teile wohlgeformt. | `book/build/mermaid_filter.lua`, `book/epub/Deep16.epub` |
| 2026-10-09 | **Kindle-Variante gegen E016, 2. Anlauf**: PNG-Diagramme allein haben E016 **nicht** beseitigt (gegen Amazon-Hilfe geprüft: keine SVGs/Gradienten/Mathe mehr, Tabellen max. 15 Zeilen, CSS unauffällig). Ursache ist die Metadaten-Klasse, an der Amazons Parser scheitert: `<dc:language>` mit Attributen bzw. Regions-Subtag sowie die von Pandoc gesetzten Apple-Attribute `prefix="ibooks:…"`/`xml:lang` im `<package>`. `normalize_epub.py` reduziert auf `<dc:language>de</dc:language>`, entfernt beide Attribute, das `com.apple.ibooks.display-options.xml` und Calibres SVG-Umschlag des Titelbilds. Da sich das gegen Amazon nicht prüfen lässt, gibt es zwei Artefakte: `kindle` (EPUB3, Layout erhalten) und `kindle-calibre` (zusätzlich Calibre-Round-Trip — von der Community als wirksam bestätigt). | `book/build/build-epub.sh`, `book/build/normalize_epub.py`, `book/epub/Deep16-kindle.epub`, `book/epub/Deep16-kindle-calibre.epub` |
| 2026-10-10 | **E016 gelöst — bestätigt am Gerät**: `Deep16-kindle-calibre.epub` wird von Send to Kindle akzeptiert und liest sich reflowable; Layout und Diagramme sind einwandfrei. Damit ist der Calibre-Round-Trip die entscheidende Maßnahme, `normalize_epub.py` bleibt als Absicherung (Sprache, Apple-Attribute, SVG-Titelbild). **Für Amazon ist damit `kindle-calibre` die gültige Datei**; `Deep16-kindle.epub` und `Deep16.epub` bleiben für Apple Books. | `book/epub/Deep16-kindle-calibre.epub` |
| 2026-10-10 | **JS-Kern führt `LDS`/`STS` im Debugger mit**: `executeLDSSTS` setzte `recentMemoryAccess` nicht, das Speicherfenster zeigte nach einem `STS` auf den Bildschirm weiterhin die Brotkrume des Boot-ROMs (Adresse `0x0002`) statt `0xF1000` — der WASM-Kern (`recent_addr`) hatte es richtig. Das war die einzige Divergenz, die Kapitel 6 beim „gleiche Bitgenauigkeit"-Vergleich aufgedeckt hat; `tests/cores.test.js` 22/22 grün. | `js/deep16_simulator.js` |
| 2026-10-10 | **`npm run lint:rtl` wieder benutzbar**: Die Quellliste im npm-Skript kannte weder `deep16_cache.sv` noch `deep16_divider.sv`, obwohl `deep16_top` den Cache und `deep16_core` den Teiler instanziiert — Verilator brach mit „Cannot find file containing module" ab. Die Liste entspricht jetzt der des Build-Skripts (`scripts/build_rtl_native.sh`); Lint läuft mit `-Wall` fehler- und warnungsfrei durch. | `package.json` |
| 2026-10-10 | **Die vier offenen imm2-Punkte abgearbeitet**: **(1)** `MOV` hatte als einziger häufig benutzter Befehl **kein** Bit-Diagramm — ergänzt in Kap. 3 §3.1 mit den vier `imm2`-Funktionen (Tabelle 3-1, Listing 3-11, auf allen drei Kernen gemessen). **(2)** „Jede 16-Bit-Konstante kostet zwei Instruktionen" steht jetzt als Merksatz dort, gestützt auf die Messung `LDI 0x1234` + `MOV R5, R0` → `0x1234`. **(3)** `ALINK`/`ALNK` (Alias für `SMV Rx, APC`) fehlten im Buch — jetzt in Kap. 4 §4.2 mit Vergleichstabelle gegen `LINK` (gemessen `0x0101` gegen `0x0103`, bytegleiches Befehlswort `0xFEEF`) und Querverweis aus Tabelle 5-2 in Kap. 5. **(4)** Das `Jcc`-Ablaufdiagramm in Kap. 4 war mehrdeutig: „PC + 1" meinte die Adresse des `Jcc`, während die CPU im Slot bereits `PC + 2` ausgibt — neu beschriftet mit der **Ankunftsadresse `A`** und den gemessenen Werten (Slot `0x0105`, `MOV Rx, PC` im Slot liest `0x0106`). | `book/kap03.md`, `book/kap04.md`, `book/kap05.md` |
| 2026-10-11 | **Die vier Anhänge geschrieben** (`book/anhang.md`). Zwei Dinge, die beim Messen auffielen und deshalb jetzt dokumentiert sind: **(1)** Die Opcode-Tabelle in `doc/Deep16-Arch.md` ist in drei Bereichen veraltet — der Assembler kodiert die Schiebegruppe `110 10000`–`110 11011`, `MUL`/`DIV` `110 11100`–`110 11111` und die Systemgruppe ab `11111111110`. Die Spec wurde **nicht** geändert (sie gehört dem Parallelautor); Anhang A nennt die gemessenen Werte und weist die Abweichung aus, die 33 Opcode-Diagramme im Buch wurden gegenprüft und stimmen. **(2)** `LDI -1` kodiert `7FFF` und nicht `FFFF` — die einzige Codierung für `FFFF` ist `HLT`; genau die Lektion aus §6.2, jetzt an der Referenz sichtbar. `book/build/build-epub.sh` nimmt `anhang*.md` jetzt mit in den Build. | `book/anhang.md`, `book/build/build-epub.sh`, `book/epub/*` |
| 2026-10-11 | **Kapitel 8 „Snake"** geschrieben. Der Buchplan nannte „Terminal-Uhr oder Snake"; gewählt wurde Snake, weil der Simulator **keinen Timer-Port** kennt (nur `0xF0060`/`0xF0062` und den Bildschirmpuffer) — eine Uhr wäre damit nur über eine Schleifenzählung gegangen und hätte nichts über die Maschine gezeigt. Snake nutzt Adressrechnung, Blockverschiebung, Unterprogramme und Tastatureingabe gemeinsam. Vier Listings, alle drei Kerne, Extractor 172/172. | `book/kap08.md`, `book/epub/*` |
| 2026-10-11 | **Kapitel 7 „Ein Mini-Forth"** geschrieben, gestufter Aufbau nach Buchplan: Listing 7-1/7-2 (Zeile lesen, Wort schneiden), 7-3 (Wörterbuch mit Fehlerpfad), 7-4 (Zahl lesen und dezimal ausgeben), 7-5 (Schlussprogramm). Der Zwischenstand zum eintippen einer Quelldatei (`SERPLAN.md`: Zeilenlängengrenze, Taktung nach Warteschlangenfüllstand) ist noch nicht im Buch — Kapitel 8 oder Anhang D. Alle Zahlen auf JS-, WASM- und Verilog-Kern gemessen (Extractor 276/276). | `book/kap07.md`, `book/epub/*` |
| 2026-10-10 | **Architektur-Revisionen abgeglichen**: Die Revisionsdokumente im Repo-Root sind in STATUS.md unter „Architektur-Revisionen im Repo-Root" nach Thema, Stand und Buchrelevanz eingeordnet. Zwei sind bewusst **kein** Buchthema: `GFX.md`/`GFXOVERV.md` (Grafik-Kern GCoP, Design-Phase, ferne Zukunft) und `PLANPSRAM.md` (PSRAM-Backing-Store, **nicht umgesetzt**). `SERPLAN.md` (8/9 Schritte fertig) ist Material für Kapitel 7. Der aus `VERILOG.md` folgende dritte Kern **wurde ins Buch übernommen**: Kapitel 6 §6.2 spricht jetzt von drei Kernen, und Probe (71/71) wie Extractor (94/94) messen auf JS, WASM und RTL — die Schrittzahlen stimmen auch auf dem Verilog-Kern. Vermessungs-Workflow in `STYLE.md` §7 entsprechend auf drei Kerne gestellt. | `book/kap06.md`, `STYLE.md`, `STATUS.md` |
| 2026-10-10 | **Kapitel 6 „Der Simulator als Werkbank"** geschrieben: Speicherkarte (Tabelle 6-1), Tastaturports (Tabelle 6-2), Bildschirmzelle mit Bitdiagramm, die Kernfalle `LD`/`ST` sehen keine Ports, Delay-Slot-Falle messbar (`R1` = 5 statt 1), LDI-Mustergrenze, Debugger-Hooks. Alle Zahlen auf **allen drei** Kernen gemessen (Probe 71/71, Extractor 94/94). | `book/kap06.md`, `book/epub/*` |
| 2026-10-10 | **`LDI`-Bereich: Vermerk zurückgenommen, Semantik festgeschrieben.** Der vormerkte „Bereichsfehler" war eine **Fehldiagnose** — die obere Grenze `0x7FFF` ist korrekt. Spec §3.4 lautet `R0 ← sign_extend(imm15)`: der Operand ist ein **15-Bit-Muster**, alle 32768 Muster sind legal, und die Vorzeichenerweiterung findet in der **CPU** statt, nicht im Assembler. `LDI 20000` → `0xCE20` (`−12992`) ist auf beiden Kernen das *richtige* Ergebnis. Ein Versuch, die Grenze auf `16383` zu ziehen, hat `forth.asm`, `swi-test.asm`, `screen_demo.asm`, `string_demo.asm` und `asm/backup` zerlegt (80 Testfehler) sowie den Disassembler-Round-Trip gebrochen — der Disassembler gibt Immediates als rohes Hex aus, das sich dann nicht wieder laden ließ. **Regel:** Assembler prüft nur, ob der Wert in ein 15-Bit-Feld passt (`0..0x7FFF` oder `-16384..-1`, dieselben Muster in zwei Schreibweisen), nicht ob er in einen Vorzeichenbereich passt. Absicherung: `tests/disassembler.test.js` prüft jetzt alle 32768 Muster auf `disassemble → assemble`, STYLE.md §9 als eingefrorener Fact präzisiert, die irreführenden TODO-Kommentare in `js/deep16_assembler.js` ersetzt. Kapitel 2/3/6 und alle EPUBs bleiben unverändert — sie hatten recht. | `js/deep16_assembler.js`, `tests/disassembler.test.js`, `STYLE.md` §9 |
| 2026-10-10 | **`book/` aufgeräumt**: Ergebnisse nach `book/epub/`, Zwischenergebnisse (Pandoc-Stufe, Calibre-Round-Trip, Mermaid-PNGs) nach `book/build/` — bei jedem Build geleert, per `.gitignore` nicht versioniert. `book/` enthält damit nur noch Quellen (`kap*.md`), Werkzeuge (`build-epub.sh`, `mermaid_filter.lua`, `normalize_epub.py`), das Mermaid-Test-Fixture `test/` und die beiden Artefaktordner. | `book/epub/`, `book/build/`, `book/build/build-epub.sh`, `STYLE.md` §6 |
| 2026-10-10 | **Divider neu: handgeschrieben, iterativ, Radix-4.** Drei Befunde führten dazu. **(a)** Das RTL benutzt die Verilog-Operatoren `quot32 = dividend32 / {16'h0000, opv_i}` und `rem32 = dividend32 % {...}` (`rtl/deep16_alu.sv:235-236`) — Verilog sieht **32/32**, ein Synthesizer inferiert zwei volle 32-Bit-Teiler. Die Architektur meint aber 32÷16 mit **16-Bit-Quotient und 16-Bit-Rest**; `quot32[15:0]`/`rem32[15:0]` verwerfen die oberen Hälften ohnehin. Ein echter 32÷16 braucht nur ein **18-Bit-Arbeitsregister**, nicht 33 — das war in der ersten Auslegung dieses Dokuments falsch angesetzt. **(b)** Unverändert ergäbe das ~1200–2000 LUT und **8–16 MHz**; der Teiler wäre der Taktbegrenzer des ganzen Kerns. **(c)** Iterativ **entkoppelt die Breite vom Takt**: der kritische Pfad ist nur noch *eine* Iteration (18-Bit-Kette + 2 LUT-Level + Routing = 2,2–4,5 ns), also **222–455 MHz** und bei 54 MHz 4–8× Reserve. Gewählt wird **Radix-4** (2 Dividend-Bits je Iteration, **16 statt 32 Takte**) für den Durchsatz: Misch-CPI 6,20 → **3,53**, also 8,7 → **15,3 MIPS @54 MHz**. ⚠ *Korrigiert nach der Umsetzung:* die erste Fassung nannte **8 Takte / 24,5 MIPS**. Falsch — der 32÷16-Quotient ist 32 Bit breit und wird erst am Ende auf 16 Bit gekürzt, also müssen alle 32 Dividend-Bits aus `rem = 0` verbraucht werden. Radix-4 bleibt die richtige Wahl (es halbiert die Iterationen gegenüber Radix-2), ist aber halb so schnell wie zunächst behauptet. **Gemessen: 16,0 Takte** über `ADD`. Fläche: **~300–450 LUT** (gegenüber ~100–160 für Radix-2 und ~1200–2000 für den inferierten) — bei 300–450 LUT bleibt der Fmax bei ~5–7 ns je Iteration, also ~2,6–3,7× Reserve bei 54 MHz. `DIV` (16÷16) und `DIV32` (32÷16) teilen **einen** Kern (16÷16 = 32÷16 mit Nullbits im Dividend); Quotient und Rest fallen im Restoring-Verfahren gemeinsam an, die Doppel-Operatoren entfallen. Preis: 16 Takte statt 1 je Division. **Bleibt zu erhalten:** die Sonderfälle `opv == 0 → 0xFFFF` und die Ablehnung ungerader Zielregister bei `DIV32` (`rd[0]`). Danach ist der Teiler **nicht mehr** der kritische Pfad — der ist dann der Rest von EX (228-Bit-State-Bypass, ALU mit 32 Funktionen, Schieberegister, Ergebnisauswahl), geschätzt 8–15 ns. | `rtl/deep16_alu.sv`, `rtl/deep16_core.sv` (`stall`) |
| 2026-10-11 | **MUL/DIV-Abgleich Spec ↔ drei Kerne: zwei Befunde, ein echter, ein Fehlalarm.** Anlass war die Meldung, die Opcode-Tabelle der Spec weiche für Schiebegruppe, `MUL`/`DIV` und Systemgruppe vom Assembler ab. **(1) Echter Fehler, semantisch:** Spec Tabelle 14 etikettierte `DIV32` als „32÷16→32-bit divide". Gemessen rechnet `DIV32` **32÷16 mit 16-Bit-Quotient und 16-Bit-Rest** — der Quotient wird gekappt (`0xFFFFFFFF / 1` → `Rd=0xFFFF`, nicht `0xFFFFFFFF`; `0x00012345 / 1` → `Rd=0x2345`). Das ist gewollt und in `rtl/deep16_alu.sv` sowie `rtl/deep16_divider.sv` kommentiert; nur das Etikett war falsch. Spec Tabelle 8, Anhang A und die Buchkapitel waren bereits richtig, `MUL32` trägt dasselbe Etikett und ist korrekt (32 Bit bleiben vollständig erhalten). Etikett in `doc/Deep16-Arch.md` berichtigt — die einzige angefasste Spec-Zeile, nach ausdrücklicher Freigabe, weil die Spec dem Parallelautor gehört. **(2) Fehlalarm:** die drei behaupteten Opcode-Abweichungen existieren nicht. Nachgemessen Schiebegruppe 12/12, `MUL`/`DIV` 4/4, Systemgruppe 4/4 MATCH; die Spec-Zeilen standen in **jeder** Revision identisch (10 Commits zurück bis `1bce2ee`, ebenso in `old/Deep16-Arch-M3r1.md` und `old/Deep16-Arch-v5.2.md`). Der Zusatz „statt `110 10…`" hat keine Entsprechung in irgendeiner Spec-Fassung. Historisch abweichend war nur der `MUL32`-Entwurf `[110][101][Rd4][w1][i1][Rs4]` im Assembler, ersetzt durch `110 11101` — die Doku-Aussage war damals berechtigt und wurde beim Umbau nicht nachgezogen, sie war also selbst das, was sie bei der Spec kritisiert. **Lehre:** eine Doku-Aussage über eine andere Quelle ist selbst eine Behauptung und braucht denselben Nachweis wie der Code. Verifikation: 211 gerichtete + 800 Zufallsfälle über `MUL`/`MUL32`/`DIV`/`DIV32` gegen JS-, WASM- und RTL-Kern, **0 Abweichungen**; `divtest.cpp` (Radix-4 gegen Verilogs `/` und `%`) besteht; `npm test` 296/296. **Kein Code geändert.** | `doc/Deep16-Arch.md`, `STATUS.md`, `book/anhang.md` |
| 2026-10-10 | **Dritter CPU-Kern in SystemVerilog** (`rtl/`, Verilator + Emscripten), 5-Stufen-Pipeline und 4KB-Cache, in der IDE als **Kern** wählbar (JS / WASM / RTL). Zwei Grundsätze haben sich als tragend erwiesen und sollten bei einem vierten Kern wiederholt werden: **(a)** Der Cache ist **per Konstruktion transparent** — bei einem Miss liefert das Top-Level weiter aus dem Speicherarray aus, die Pipeline stallt nie und die (verifizierte) Pipeline-Steuerung bleibt unangetastet. **(b)** Nebenwirkungen außerhalb von WB brauchen eine Bedingung *„verlässt die Stufe in diesem Takt"* — sonst feuert der Tastatur-Pop über die Schrittgrenze hinweg mehrfach. Drei Kernfehler dieser Runde waren jeweils **eine** fehlende Bedingung, nicht schlechte Logik: `fill_base` nach Cachebarkeit statt nach dem Miss gewaehlt, Invalidierung per `eval()` ohne posedge (stiller No-op), veraltete Zeile nach Store ohne Write-Allocate. Dazu zwei Fehler im Prüfwerkzeug selbst, die beide wie eine Kerndivergenz aussahen: `set_registers()` legt Index 15 auf den *aktiven* PC, und ein Seed, der nur einen PC setzt, laesst im Schattenkontext den anderen auf 0. **Lehre:** bei einer Divergenz zuerst *das Werkzeug* prüfen, nicht das Werk. Verifikation: Decode-Sweep 524288 Ausführungen, 0 Abweichungen (4 Seeds), `tests/fuzz.test.js` mit 60 Zufallsprogrammen, 239/239 Tests gruen. Für die Doku: `README.md` auf drei Kerne gezogen, `VERILOG.md` als Plan- und Entscheidungslog geführt. | `rtl/`, `index.html`, `js/deep16_ui_core.js`, `tests/rtl.test.js`, `tests/fuzz.test.js`, `README.md`, `VERILOG.md` |
| 2026-10-14 | **Hex-Literale im Zahlen-Scanner** (`0x1F`, `0X1F`, `$1F`). Bisher nur dezimal, deshalb war ein Hex-Literal ein „undefined word" — und deshalb führt `forth/hanoi.fth` seine Farbbytes als Dezimalzahlen und der Kommentar neben dem Attributcode baut die Maske von Hand. Der Präfix-Test steht **vor** dem Ziffern-Test: `'$'` sortiert unter `'0'`, ein `$FF` wäre also als Wort gelesen worden, und `0x..` muss abgefangen werden, solange `>IN` noch auf dem `'0'` steht. Ein Präfix ohne Ziffern wird als **Wort** gemeldet, nicht stillschweigend zu 0 — eine 0 ist eine Zahl, die richtig aussieht. **Registerbudget:** im Tokenizer leben R0, R1, R2, R3, R4, R7, R12 plus die Aliase R5 (`>IN`), R6 (`TIB`), R13/R14 (SP/LR); R8 ist `SCR`. Es bleiben **R9, R10, R11** und sonst nichts — zwei Fehlversuche habenjeweils R5 oder R6 gegriffen, also `>IN` selbst und `TIB`. `>IN` taugt auch nicht als „Ziffer gelesen"-Flag, weil schon das Präfix es weiterzählt: `0x .` sieht exakt aus wie eine Zahl, die am Leerzeichen endete. Suite 377/377. ⚠ *Korrigiert am 2026-10-14:* die Liste der freien Register war falsch — **R9 ist keines**. `PSW.ER = 8` mit Dual-Bit macht R8 **und R9** zum ES-Base-Paar, jedes `ST/LD Rx, R9, n` geht über ES. Als *Wert* bleibt R9 benutzbar, als Adressregister nicht; frei sind R10 und R11. Siehe den `."`-Eintrag unten, dem dieser Fehler zugrunde lag. | `asm/forth.asm`, `tests/forth.test.js` |
| 2026-10-14 | **Die Bitoperationen `and` `or` `xor` `invert` `lshift` `rshift`.** Die ersten vier sind je **ein** Befehl. Die Schiebungen nicht: `SL`/`SR` nehmen ihre Zahl als **4-Bit-Immediate** (Tabelle 6) und haben keine Registerform — eine Laufzeit-Zahl muss Bit für Bit getaktet werden, wobei der Wert jedes Mal wieder vom Stapel geholt wird, weil es keinen Platz gibt, der den Schiebevorgang übersteht. Eine Zahl ≥ 16 schiebt alles heraus und wird auf 0 verkürzt: `1 100 lshift` wären sonst 100 Runden, `1 65535 lshift` 65535. Der Standard lässt den Typ offen und verlangt keinen 16-Bit-Schiebebereich — die Gesamtheit zurückzugeben ist brauchbarer, als eine große Zahl in einen Hänger zu verwandeln. **Die teuerste Lektion dieser Runde, vier Fehlversuche:** ein binäres Wort liest `b` von SP, erhöht SP **einmal** und liest `a` durch dieselbe Instruktion — `a`s Platz wird damit der Ergebnisplatz. `word_mul` ist die Vorlage und tut **genau einen** Schritt. Ein zweiter Schritt landet auf der Leer-Marke, und der Fehler wird vom **nächsten** Wort gemeldet: `12 10 and .` zeigte „stack underflow", und der Unterlauf war in `.`, sechs Instruktionen weiter. Alle vier Versuche lasen das als „die Bitwörter laufen unter" und haben Prolog, Header-Verdrahtung und Befehlskodierung ausgechlossen — alle drei waren korrekt. **Zweite Falle:** in `x n lshift` liegt `n` **oben**, weil `x` zuerst gelegt wurde. Liest man das oberste als `x`, zählt jedes Schieben mit `x` und schiebt `n`; das ergab bei jedem Ergebnis `2 × n` und hat den Fehler benannt. `rshift` ist logisch (Nullen ab Bit 15); die ISA hat **keine** arithmetische Schiebung, wonach man fragen könnte. Die Header liegen zwischen `h_cls` und `h_scr_fetch`, damit der Schwanz der Kette seine alten Verbindungen behält, und `forth_wl` zeigt weiter auf `h_cls`; ein Test läuft die Kette ab und prüft Zyklusfreiheit und Vollständigkeit. **Nicht adressiert:** `drop` akzeptiert einen leeren Stapel — vorbestehend, nicht von dieser Änderung berührt. Suite 377/377. | `asm/forth.asm`, `tests/forth.test.js` |
| 2026-10-14 | **`LWI` ergänzt** (`R0 ← b15(b15(Rx))`, Fehler, wenn es kein solches Feld gibt) und die **Türme in `hanoi.fth` auf `variable … 6 cells allot` umgestellt.** Damit fallen die beiden Umwege weg, die `hanoi.fth` sich wegen dieser Lücken selbst auferlegt hatte. Bildschirminhalte bei 3/4/5 Scheiben byteweise gleich. | `asm/forth.asm`, `forth/hanoi.fth`, `tests/assembler.test.js` |
| 2026-10-14 | **`."` als IMMEDIATE-Wort — fertig.** In einer Definition erscheint der Text jetzt **beim Aufruf**, nicht beim Übersetzen: beim Übersetzen wandern die Zeichen in die Definition, und es bleibt `xt_lit <adresse> xt_litstr <zeichen> 0` liegen; `litstr` druckt zur Laufzeit und schiebt den Thread über den String, wie `lit` über seine Inline-Zelle. Der Weg war im Vermerk vom selben Tag als „`ST R4, R9, 0` schreibt nicht" notiert — **die Stores waren nicht das Problem**, und die Diagnose „der Store-Encoder behandelt R9 anders" ging an der Sache vorbei. Drei Fehler lagen übereinander, jeder für sich harmlos aussehend: **(1) Der Assembler ließ den dritten Operanden einer dreistelligen ALU-Zeile ohne ein Wort fallen.** Die ALU-Gruppe ist in beiden Formen zweistellig (Spec Tabelle 6): `Rd, Rs` rechnet `Rd ← Rd OP Rs`, `Rd, imm` rechnet `Rd ← Rd OP imm`. `ADD R11, R9, 1` wurde deshalb als `R11 ← R11 + R9` übersetzt — im Wörterbuch stand danach eine Unsinnsadresse. Dreistellige Zeilen werden jetzt abgewiesen, wie `MOV … +1`. **(2) R9 ist kein freies Register.** `PSW.ER = 8` mit Dual-Bit (PSW-Setup am Dateianfang) macht **R8 und R9** zum ES-Base-Paar; jedes `ST Rx, R9, n` landete auf `ES:R9 = 0xF0000 + R9`, also auf dem **Bildschirm**. Der Zielzeiger ist jetzt R11; R9 bleibt als *Wert* in Ordnung. Damit ist die Notiz vom 2026-10-14, nach der im Tokenizer „R9, R10, R11" frei seien, **falsch** —siehe dort. **(3)** Ein Leerzeichen im String galt als Trenner und fiel stillschweigend weg. Der Sprung über den String war die vierte, erst beim Aufruf sichtbare Falle: ohne ihn liest `next` das erste Zeichen als xt und springt in den ASCII-Wert. Tests: acht Fälle in `forth.test.js` (Aufrufzeit, zwei Strings in einer Definition, Maskierung `\"`, leerer String, nacktes `"`, Mehrfachaufruf, Stapelverhalten), ein JS/WASM-Paritätsfall in `shadow.test.js` und zwei Assembler-Fälle in `assembler.test.js`. Alle drei Kerne liefern byteweise dasselbe Bild. | `asm/forth.asm`, `js/deep16_assembler.js`, `tests/forth.test.js`, `tests/shadow.test.js`, `tests/assembler.test.js` |
| 2026-10-14 | **`do`, `?do`, `loop`, `leave`, `i` — die letzte der vier Lücken.** Der Kern hatte keinen Loop mit eigenem Parameter-Stapel; die einzige Stelle, die einen Rumpf überlebt, ist der **Rückstapel**: der Datenstapel gehört dem Rumpf, der ihn nach Belieben benutzt. Der Loop-Rahmen liegt dort wie ein Aufrufsrahmen und ist **vier Zellen** breit: `RP+0 exit`, `RP+1 body`, `RP+2 index`, `RP+3 limit`. `do` ist IMMEDIATE und legt `LIT <ausstieg>` + `xt_do` ab; die Ausstiegsadresse kennt erst `loop`, deshalb ein Platzhalter auf dem Kompilier-RP, den `if`/`then` genauso benutzt. Zur Laufzeit sieht `10 0 do i . loop` so aus: `LIT 10  LIT 0  LIT <exit>  (do)  i  .  (loop)` — beim Zählen steht `i` im Weg, deshalb schiebt es sich beim Rücksprung in den Rahmen und ersetzt die Sprungzelle durch `index++; if (index == limit) pop else IP = body`. `(loop)` fällt einfach durch, wenn IP schon hinter seiner eigenen Zelle steht: **es braucht gar keinen Sprung im Thread**, nur eine Adresse, die einmal beim Übersetzen geflickt wird. **Die teuerste Falle dieser Runde war die RP-Disziplin.** `docol` schreibt *eine* Zelle, und RP landet darauf — bei einer Zelle sind „RP zeigt auf die eben geschriebene" und „RP zeigt auf den untersten Rahmen" ununterscheidbar. Bei vier Zellen sind sie es nicht, und der Rahmen wurde zuerst in umgekehrter Reihenfolge gelegt: RP stand danach **eine Zelle zu tief**, `loop` las den Index aus der **Rücksprungadresse des Aufrufs**, und `exit` bekam beim Abbau den **Limit** als Rücksprungadresse — der Kern lief in unbeschriebenen Speicher und blieb stehen. Nicht die Werte waren falsch, sondern die Maschine war tot, und der Fehler meldete sich als „Hänger" an der falschen Stelle: die Definition lief, der Aufruf danach nicht mehr. **Zweite Falle, gleiche Gegend:** ein `loop` ohne `do` davor ist undefiniert, popped aber blind — es schlägt in den Kompilier-RP, flickt, wohin es will, und killt die Maschine. `loop_depth` zählt die Paare beim Übersetzen, ein verwaistes `loop` übersetzt gar nichts. Das ist die einzige unausgeglichene Kontrollanweisung im Kernel, die geprüft wird (`then` ohne `if` schreibt in eine harmlose Zelle), und aus genau dem Grund: der verhinderte Fehler ist der, der die Maschine mitnimmt. **`?do` ist nichtBeiwerk:** der Standard zählt **nach** dem Rumpf, `0 0 do ... loop` läuft deshalb 65536-mal, bis der Index über den Zellwert herum wieder auf dem Limit landet — der klassische 16-Bit-Fallstrick. `?do` überspringt den ganzen Loop (nicht nur den Rumpf: das passende `(loop)` fände sonst keinen Rahmen) und springt auf dieselbe Ausstiegsadresse, die `loop` ohnehin flickt. Tests: elf Fälle in `forth.test.js` (Zählen, `limit = start`, `?do`, Verschachtelung, `leave`, Rahmen über Aufrufsgrenzen, zwei Loops in einer Definition, verwaistes `loop`, Unterlauf in `(do)`, Kette), ein RTL-Fall in `rtl.test.js` und die Kette in `forth.test.js`. JS, WASM und RTL liefern byteweise dasselbe Bild. | `asm/forth.asm`, `tests/forth.test.js`, `tests/rtl.test.js`, `forth/hanoi.fth` |
| 2026-10-14 | **`2dup` und `drop` — der vermerkte Fehler war keiner.** Zwei Einträge von heute Nachmittag sind zurückgenommen, beide mit derselben Ursache: der *Testfall* war falsch, nicht das Wort. `1 2dup . . .` meldet „stack underflow" — das ist **richtig**, `2dup` braucht zwei Werte und es lag nur einer da. Nachgemessen an der ganzen Familie: `1 2 2dup . . . .` → `2 1 2 1`, `1 2 2dup depth .` → 4, `1 2 2drop . .` → underflow (der Stapel war leer, `.` bekam nichts), `2dup` auf leerem Stapel → underflow, ebenso `dup` und `drop` einzeln. Der zweite vermerkte Punkt, „`drop` nimmt einen leeren Stapel ohne Meldung", war derselbe Irrtum: `12 10 and drop` meldet `ok`, weil `and` einen Wert hinterlässt und `drop` ihn nimmt — danach ist der Stapel leer, und das folgende `.` meldet zu Recht underflow. Was den Befund erzeugt hat, ist der **Fehlerpfad**: er lässt den Datenstapel unangetastet, sodass nach einem underflow die Reste weiter unten liegen bleiben und das *nächste* Wort sie sieht. Das ist in diesem Kernel gewollt (ANS definiert den Stapel nach einem Fehler als undefiniert) und wird hier **nicht** geändert; `tests/forth.test.js` pinnt das Verhalten inzwischen an beiden Stellen. **Lehre:** ein gemeldeter Unterlauf beweist einen Unterlauf — er beweist nicht, welches Wort ihn ausgelöst hat. | `asm/forth.asm` (unverändert), `STATUS.md` |
| 2026-10-15 | **`see name` — der Decompiler.** Der Kern kann jetzt den **Bau** eines Wortes zeigen statt es auszuführen. Fünf Bauarten werden unterschieden, jede über ihr **Code-Feld** (`[CFA]`): `docol` → `: name … ;`, `dovar` → `variable name`, `doconst` → `constant name <wert>`, `dodoes` → `create name` (und `does> … ;`, wenn der DOES>-Zeiger `[CFA+1]` nicht Null ist), `dovoc` → `vocabulary name`, alles andere → `code name`. **(1) Der Thread-Ablauf** liest Zelle für Zelle ab `CFA+1` und löst jede `xt` über **umgekehrte** Suche wieder zu einem Namen auf: die Suchordnung ablaufen, je Wortliste die Header-Kette (neueste zuerst), `CFA = header + 3 + len` rechnen und mit dem Ziel vergleichen — nicht gefunden heißt `?<xt>`. Eine Zelle, die **kein** Wort benennt, ist damit keine Thread-Zelle — der Ablauf **endet** dort, statt in den Rest des Speichers zu laufen; ohne diese Schranke lief `see` bei `: n 1 2 nosuchword ;` (die Definition, deren `;` nie lief) bis zum Bildschirmrand, weil sie jeden 0xFFFF-Zellenrest als „Wort" ausgab. **(2) Inline-Zellen** erkennt der Vorgänger, sonst stünde eine Zahl oder ein Zeichen als „Wort" im Ausdruck: `lit` + Operand (signed), `lit` + Adresse + `litstr` + Zeichen (als `." … "`, bis zur NUL), `lit` + Ausstiegsadresse + `(do)`/`(?do)`, `branch`/`0branch` + Versatz, `(loop)`/`leave` je eine Zelle. **(3) Das Ende** ist die **Adresse von `xt_exit`**, nicht das Code-Feld `exit`: `;` kompiliert genau diese Adresse, `exit` seine eigene Kennung — mit dem Code-Feld als Kriterium hätte ein `exit` **mitten** in einer Definition den Rest verschluckt (`: f 1 exit 2 ;` zeigte `: f 1 ;`). **(4) Registerdisziplin:** R5 (`>IN`) und R6 (`TIB`) müssen überleben, R8 (`SCR`) ist der Ausgabezeiger und wird absichtlich weitergezählt; R9 ist wie in `."` ES-Base und nie Adressregister. Der Thread-Zeiger lebt in `see_ptr` statt in einem Register, weil `print_number` und die Namenssuche jeden Arbeitsregister-Wert zerstören; die Helfer kommen je mit einem eigenen LR-Platz aus, weil `LINK` das LR überschreibt. **(5) Ausgabe** geht als direkter `STS`-Schreibzugriff auf den Bildschirm (kein BIOS/SWI, damit RP und Register unangetastet bleiben), mit führendem Leerzeichen, weil die REPL die Eingabezeile **ohne** abschließendes Leerzeichen zurückspiegelt. **Falle, die den ersten Testlauf kostete:** `LDI ';'` ist unzulässig — der Assembler schneidet die Zeile am ersten `;` ab (`line.split(';')[0]`), dieselbe Ursache, aus der `h_semicolon` sein Semikolon als `.word 59` ablegt. **Nicht rekonstruiert (bewusst):** `if`/`then`/`begin`/`until`/`while`/`repeat` erscheinen als `(branch)`/`(0branch)` mit dem gespeicherten Versatz — die Struktur dafür bräuchte den ganzen Kontrollfluss-Baum, und der Versatz ist das, was wirklich im Wörterbuch steht. Elf Tests in `forth.test.js` pinnen die Ausgabeformen; `see` steht außerdem in der `words`-Liste. Suite 156/156 (`forth`) grün. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md`, `STATUS.md` |
| 2026-10-15 | **Tier 1 — 22 fehlende Standardwörter (1. Schub).** Aus der Lückenliste gegen ANS CORE/CORE-EXT sind die Wörter gebaut, die einem gewöhnlichen Programm im Weg stehen: `bl true false space spaces ?dup tuck -rot 2over 2swap u< u> 0<> within 2@ 2! count c, move fill erase type`. `bl`/`true`/`false` sind gewöhnliche `doconst`-Konstanten (CFA-Zelle `doconst`, Wertzelle dahinter), damit `see` sie als `constant name <wert>` zeigt. **Die zwei echten Fehler:** *Erstens* die **Operandenreihenfolge** — `move`, `fill`, `erase`, `type` luden den ersten Operanden von `[SP]`, wo der **letzte** liegt (`( src dst u -- )` heißt `u` oben). `erase` bekam damit die Länge als Zieladresse und schrieb ~13000 Zellen ab Adresse 1 aufwärts Null; das sah wie ein Absturz aus, war aber ein Adressfehler. *Zweitens* ein **Richtungsfehler**: `count` schob mit `ADD SP, 1`, wo `SUB` gehört — bei einem Operanden und zwei Ergebnissen wächst der Stapel um eine Zelle nach unten; mit `ADD` landeten beide Ergebniszellen hinter der Leer-Marke. **Die teuerste Erkenntnis kam aus einem scheinbaren Hänger:** `variable x variable y 7 9 x 2! x @ .` blieb stehen, und kein Wort war schuld — ein `variable` besitzt **eine** Datenzelle, der Header des nächsten Wortes beginnt unmittelbar dahinter, und `2!` überschrieb den **Link** des nächsten Namens; die Suche läuft dann auf den Zahlenwert 7 zu und kehrt nicht zurück. Deshalb reservieren die Tests mit `2 allot`, und `FORTH.md` sagt es. **Struktur:** die 22 Header liegen zwischen `h_cls` und `h_see` (neueste zuerst), damit `forth_wl` weiter auf `h_cls` zeigt; die zwei Pins in `tests/forth.test.js` (Kette endet auf `h_cls`, jedes `h_*` erreichbar) decken die neuen Header automatisch ab. **Sprungweite:** bedingte Sprünge reichen ±256 Wörter, `cmp_true`/`cmp_false` liegen aber weit vor dem neuen Block — `u<`, `u>`, `within` und `0<>` springen auf lokale Marken und laden das Ziel mit `LDI <marke>`+`MOV PC, R0`. **Semantik, bewusst abweichend:** `count` antwortet `( c-addr u )` und nicht ANS' `( c-addr+1 u )` — hier ist eine Zeichenkette eine Zellenfolge bis zur Nullzelle, und `addr count type` zu drucken ist die einzige Lesart, die etwas nützt. `c,` ist identisch mit `,` (eine Zelle trägt ein Zeichen). `u<`/`u>` lesen das **Carry** (Ausleihe, exakt), `within` rechnet `(n-lo) < (hi-lo)` unsigned; die Testpaare stehen so, dass die **signierte** Antwort die andere wäre. **Vorbestehend gefunden, nicht angefasst:** `<`, `>` und mit ihnen `min`/`max` leiten ihr Ergebnis aus dem **Vorzeichen einer Differenz** ab (`JN` auf `a-b` bzw. `b-a`) — das ist genau dann falsch, wenn die Differenz überläuft: `0x8000 1 <` → `0` (richtig: `-1`), `1 0x8000 >` → `0` (richtig: `-1`), `0x8000 1 min` → `1` (richtig: `-32768`). Reparaturweg (nicht in diesem Schub): `CMP a, b` und dann `N xor V` über `JO`/`JNO` auswerten, also vier Zweige statt zwei; `print_number`, `do`/`loop` und `hanoi.fth` rechnen nicht an der Vorzeichengrenze und bleiben davon unberührt. **Tests:** 13 neue Fälle in `forth.test.js` (Konstanten, Schieber, unsigned Vergleiche, Speicher/Zeichenketten, Tiefenprüfung jedes neuen Wortes, Übersetzen in einer Definition), zusammen 169 Fälle in der Datei, **463/463** im ganzen Repo. `FORTH.md`: neue Tabellenabschnitte (Stack, Vergleich, Speicher, „Characters and strings"), Zahl 93 → **115**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-15 | **Tier 1, 2. Schub: Namen und Ausführung** (`' char execute ['] [char] literal`). `'` war bisher ein **Tokenizer**-Sonderfall und wurde **stillschweigend geschluckt** (`5 ' dup .` lief als `5 dup .`) — der Zweig ist entfernt, `'` wird nachgeschlagen und parst mit `find_token`, dem Sucher von `to`/`forget`, damit ein unbekannter Name sich genauso meldet. **Der Fund, der diese Runde bestimmt hat:** der **Hex-Erkenner** öffnete „0x" auf **jedem** ersten Zeichen, weil er nur das **zweite** auf `x` prüfte — damit war `exe` die Zahl 0xE und **`execute` die Zahl 0xEC**, und der Rest `ute` kam als unbekanntes Wort zurück: das neue Wort war am Prompt nicht benutzbar. `exit` entkam nur, weil „xi" keine Hexziffer enthält und `parse_hex_finish` einen **ziffernlosen** Präfix zurück an `parse_word` schickt. Der Wächter ist jetzt `JNZ` statt `JN`: nur eine führende `0` öffnet „0x"; gepinnt sind `0xec` = 236, `exe` und `2x` als Wörter und `exit`. **`execute` springt auf das Code-Feld, nicht in die Resume-Liste:** `execute_xt` setzt IP auf die Liste des äußeren Interpreters (richtig am Prompt, falsch **in** einer Definition); weil der Sprung das IP unangetastet lässt, schiebt die Colon-Definition ihre Rücksprungadresse selbst und `: t ['] + execute 10 + ;` gibt 13. `'` und `char` sind **nicht** immediat und parsen zur Laufzeit (`: getxt ' ; getxt dup` findet wirklich `dup`); `[']`, `[char]` und `literal` arbeiten beim Übersetzen und teilen sich den LINK-Unterprogramm `compile_lit`, der `LIT <Wert>` kompiliert. `see` zeigt deren zwei Zellen als **nackte Zahl** (`: t ['] dup ;` → `: t 12530 ;`), denn eine 16-Bit-Zahl, die zufällig auf ein Wort zeigt, ist keine Zusage. Header liegen zwischen `h_type` und `h_see`, die Kette bleibt bei `forth_wl → h_cls`; **6 neue Tests**, 174 in der Datei, **468/468** im Repo. `FORTH.md`: neuer Abschnitt „Names and execution", Zahl 115 → **121**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-15 | **Vergleichsfehler bei Überlauf behoben, Tier 1 Schub 3** (`>r r> r@ +loop j unloop`). **Der Fehler zuerst**, weil `+loop` dieselbe Frage stellt: `<`, `>`, `min` und `max` lasen nur **N** aus `a-b`, richtig aber ist `N xor V` — `0x8000 1 <` war falsch. Alle vier Stellen werten jetzt **beide** Flags aus (`JO` in einen zweiten Zweig), wie `+loop` auch; `loop` bleibt bei der **Gleichheit**, die ein Überlauf nicht stört. **Die Falle der Runde:** `LDI RSTACK_TOP` lädt **nicht** `0x6F00` — der 15-Bit-Operand wird vorzeichenerweitert (Bit 14 → Bit 15), also kam `0xEF00` an, und „RP unter der Basis" war für **jeden** Zeiger wahr. Das sah wie ein Fehler in `r>` aus (`5 >r r>` → Unterlauf, obwohl `5 >r` schrieb). Die Basis liegt jetzt in einer **Zelle** `rp0_base`, genau wie `sp0_base` — dieselbe Ursache, dieselbe Lösung, als Kommentar dort festgehalten. `>r` prüft den Datenstapel, `r>`/`r@` den Rückstapel gegen seine Basis (am Prompt: „stack underflow" statt freiem Speicher); ein angebrochener Aufrufrahmen bleibt undefiniert. `+loop` endet am ersten Index **jenseits** des Limits (`index < limit` für `n >= 0`, `index >= limit` für `n < 0`) und teilt `loop_depth` mit `loop`; `j` liest `[RP+6]`, `unloop` gibt den Rahmen frei. `see` kennt `(+loop)`. **7 neue Tests** (Vergleichsgrenze, Rückstapel in beide Richtungen, Tiefenprüfung, `+loop` positiv/negativ/über die Vorzeichengrenze, `j` zwei- und dreistufig, `unloop`, `see`), 181 in der Datei, **475/475** im Repo. `FORTH.md`: neuer Abschnitt „Return stack", Zahl 121 → **127**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-15 | **Tier 1, 4. Schub: `base`, `hex`, `decimal`** — 130 Wörter. `base` ist eine **Variable** (CFA `dovar`, Datenzelle direkt dahinter, `see` sagt `variable base`), kein Konstantenwort wie `state`: **Scanner und Drucker teilen sich die Zelle**, deshalb ist `hex` nur die höfliche Schreibweise von `16 base !`. **Scanner:** `word_first_is_digit` kennt jetzt einen Buchstaben-Zweig — über Basis zehn sind `A`-`F` Ziffern, also wird ein Token, das mit einem beginnt, zum Kandidaten (`ff` in hex), und `number_scan` entscheidet über das **ganze** Token; alles, was nicht ganz aus Ziffern der aktuellen Basis besteht, geht weiter an `parse_word`, damit `hex dup` das Wort bleibt (Unterlauf) statt 0xDUP zu werden. Nur ein Name, der in der aktuellen Basis ganz aus Ziffern besteht, kann nicht beides sein: `hex : beef 7 ; beef` liest 0xBEEF — dokumentierte Grenze, solche Namen definiert man dezimal. Die Ziffernwerte kommen aus dem neuen LINK-Unterprogramm `base_digit` (0-9, a-f, A-F → R10, Gültigkeit → R9); der Hex-Präfix-Pfad behält seine eigene Kopie, weil er direkt in seinen Akkumulator springt. `0x`/`$` bleiben **immer** hex, in jeder Basis. **Drucker:** der Kehrwert `floor(u/10) = (u * 0xCCCD) >> 19` war dezimal-only, und `DIV` ist **vorzeichenbehaftet** — ein Betrag über `0x7FFF` wäre falsch geteilt worden. Jetzt die 32-Bit-Form mit **Null im hohen Halbwort** (`LDI 0` / `MOV R1, R2` / `DIV32 R0, Basis`): Dividend `0:Betrag`, Divisor Basis, Quotient wie Rest sind die **vorzeichenlose** Antwort — für jede Basis, auf allen drei Kernen. Ziffern 10-15 werden zu `A`-`F` (und darüber hinaus weitergezählt, was aber nichts erzeugen kann, weil der Scanner bei `F` endet). **Basis unter zwei:** undefiniert, aber eine Zelle ist eine Zelle — durch eins läuft die Division nie aus, durch null antwortet sie für immer `0xFFFF`; der Drucker zählt deshalb bei **sechzehn Ziffern** ab statt beim Wert (der Puffer hat 32 Zellen), also begrenzte Ausgabe statt Schreibzugriff über den Puffer hinaus, und die Eingabeaufforderung kommt zurück (gepinnt). **5 neue Tests** (Variable/`hex`/`decimal` inkl. `see base` und Zelllage, der **Namens-Satz** — kein eingebauter Name besteht ganz aus Hexziffern, weil er sonst in Hex-Modus als Zahl gelesen würde —, Scanner in Basis 2/8/10/16 und die Namensgrenze, Drucker in Basis 2/3/16 inkl. Betrag über `0x7FFF`, die Basis-0/1-Grenze), 186 in der Datei, **481/481** im Repo. **Nebenbefund im Optimierer, von der Suite gefunden:** `effectsALU` modellierte `DIV32` als „schreibt das Paar `Rd:Rd+1`", aber nicht als „liest es" — der Dividend *ist* das Paar, also wurde die Zuweisung an das niedrige Halbwort als toter Store entfernt und der Quotient aus dem Rest des Registers gerechnet (`3 4 * .` druckte 22 statt 12 im optimierten Kern). Der Fall blieb unsichtbar, solange `print_number` per `MUL32`-Kehrwert rechnete, weil `MUL32`s Paar wirklich nur Ergebnis ist. Modell korrigiert, ein Test pinnt beide Richtungen (`js/deep16_optimizer.js`, `tests/optimizer.test.js`, 31 Tests). `FORTH.md`: neuer Abschnitt „Numbers and the base", Zahl 127 → **130**. | `asm/forth.asm`, `js/deep16_optimizer.js`, `tests/forth.test.js`, `tests/optimizer.test.js`, `FORTH.md` |
| 2026-10-15 | **Tier 1, 5. Schub: `s"`, `pick`, `roll`** — 132 Wörter. **`s"`** ist wie `."` ein **Tokenizer**-Wort und **keine** Wörterbuch-Zelle: der Text zwischen den Anführungszeichen ist kein Token, es gibt also kein `' s"` und `forget` hat nichts zu entfernen. Der Unterschied zu `."` sitzt an genau der Stelle, die für einen Wert zählt: **das trennende Leerzeichen wird geschluckt**, `s" xy"` ist die zwei Zeichen lange Zeichenkette `xy` (ein Wert muss das sein, was dasteht), während `."` es behält, weil das Drucken der gespeicherten Zeichen die Quelle exakt zurückgeben muss. `see` stellt es wieder her (`see_str_sq` ist `s" ` **mit** Leerzeichen, dann die Zeichen, dann `"`), sodass die gedruckte Definition dasselbe bedeutet; `sb_string` nimmt die Vorsilbe jetzt in R7 und dient beiden. Interpretiert kopiert `s"` nach `sq_buf` (130 Zellen, so lang wie die längste Eingabezeile plus NUL) und antwortet `( c-addr u )`; ein zweites `s"` überschreibt den Puffer — genau die „transient buffer"-Zusage des Standards. Übersetzt entstehen **dieselben drei Zellen** wie bei `."`, nur mit `xt_sqstr` als Marke: `xt_lit <Adresse> xt_sqstr <Zeichen> 0`; `word_sqstr` misst die Länge am NUL und **setzt IP hinter den String**, denn ohne diesen Schritt läse `next` das erste Zeichen als xt. `\"` löst `copy_string` für beide auf (die Schleife ist aus `dotq_compile` herausgezogen, weil `."` und beide Hälften von `s"` sie brauchen). **Platz und Sprungweite:** der erste Code-Block hatte nur noch **22 Wörter** frei, deshalb liegt die Parser-Hälfte im zweiten (`sq_token_check`, `sq_action`, `sq_compile`, `sq_interpret`) und der Tokenizer-Zweig selbst ist sechs Wörter lang; zwei bedingte Sprünge über die Blockgrenze (2130 Wörter) und ein `JZ sb_end` in `see`, das die neuen Zeilen auf 258 Wörter schoben, mussten `LDI` + `MOV PC, R0` werden — der Assembler meldet solche Fälle, statt sie stillschweigend falsch zu kodieren. **`pick`/`roll`** kopieren bzw. bewegen die u-te Zelle (von oben gezählt) und prüfen ihre **u+1** Zellen selbst; `roll` schiebt **von unten** nach, weil ein LD/ST-Offset von −1 in fünf Bits stillschweigend 31 hieße und quer über den Stapel schriebe. **2 neue Tests**, 188 in der Datei, **483/483** im Repo. `FORTH.md`: `s"` in „Characters and strings", `pick`/`roll` im Stapel-Abschnitt, Zahl 130 → **132**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-15 | **Tier 1, 6. Schub: `<# # #s #> hold sign`** — 138 Wörter, die Tier-1-Liste ist damit **abgearbeitet**. Die sechs Wörter drucken eine Zahl nicht, sondern bauen sie in einem Halte-Bereich, den danach `type` schreibt; die Zahl ist ein **Doppel** (zwei Zellen, **hohes Halbwort oben** — die Ordnung des Standard-Beispiels `dup abs 0 <# #s rot sign #>`), und `#` teilt es durch die **aktuelle Basis**, weshalb dasselbe Idiom nach `hex` hexadezimal druckt. `hold` stellt voran (`66 hold 65 hold` ergibt `AB`). **Der Zeiger läuft von oben nach unten**, damit die Zeichen ohne Umkehren in Leserichtung stehen; mehr als **vierzig** Zeichen in einem Bild werden verworfen statt hinter den Puffer geschrieben (dieselbe Abwägung wie beim Drucker für Basis < 2), und `#`/`#s`/`#>` prüfen ihre zwei Zellen selbst. **Grenze, bewusst dokumentiert:** `#` teilt mit dem 32-Bit-`DIV`, dessen Dividend ein *vorzeichenbehaftetes* Paar ist, der `ud` des Standards aber vorzeichenlos — ein Doppel ab `0x80000000` rechnet falsch (`65535 65535 <# #s #>` gibt `/`, weil der Rest −1 ist). Jede Art, hier ein Doppel zu bauen, lässt das hohe Halbwort 0; eine vorzeichenlose 32-Bit-Division bräuchte eine eigene Korrektur um 2³¹ und wäre für ein 16-Bit-Gerät der falsche Preis. **Der Fund der Runde:** in `hld_step` stand `LDI base_var` **zwischen** dem Laden des Dividenden und `DIV32` — `LDI` schreibt R0, und R0 hält das hohe Halbwort, also dividierte die Maschine eine **Adresse** durch die Basis (`0/10` → `0xCCCC`, und `#s` lief **endlos**, weil das Doppel nie null wurde). Die Basis wird jetzt **vor** dem Dividenden geladen — genau die Reihenfolge, die `print_number` mit `LDI 0; MOV R1, R2` schon hatte. **2 neue Tests** (Idiome in Basis 10/16/2, Doppel über eine Zelle, `hold`-Reihenfolge, Puffergrenze, Tiefenprüfungen, `see`), 190 in der Datei, **485/485** im Repo. `FORTH.md`: neuer Abschnitt „Pictured numbers", Zahl 132 → **138**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-15 | **Tier 2: Doppelzellen-Arithmetik** (`s>d d+ d- dnegate m+ d= d0= d< um* m* um/mod sm/rem fm/mod`) — 151 Wörter. Ein Doppel ist **zwei Zellen mit dem hohen Halbwort oben**; `s>d` stellt das her, `d+`/`d-`/`m+`/`dnegate` tragen über das **Carry-Flag** (das sofort gelesen werden muss, weil `LDI` das ganze Nibble löscht), und `d<` vergleicht hohe Halbwörter vorzeichenbehaftet (N/V-Test wie `<`) und die niedrigen **vorzeichenlos**, wenn die hohen gleich sind. **Fund 1: `MUL32` ist unsigniert** — das hohe Halbwort eines Produkts *hängt* von den Vorzeichen ab (`3 × −4 = −12` gegen `3 × 0xFFFC = 0x0002FFF4`); `m*` korrigiert den unsignierten Wert, indem jeder negative Operand den anderen einmal abzieht (das landet ganz im hohen Halbwort). **Fund 2: die Reihenfolge der Divisionsantwort** — der Standard gibt Quotient oben (`u3`/`n3`) und Rest darunter; die erste Fassung hatte es umgekehrt, und die ersten Tests pinnten den Irrtum mit, bis eine `u.`-Zeile den Rest oben zeigte. `sm/rem` ist exakt die ISA-Division (truncate toward zero, Rest mit dem Vorzeichen des Dividenden), `fm/mod` ergänzt die Bodenkorrektur (Rest mit dem Vorzeichen des Divisors). **Grenzen:** `um/mod` ist exakt, solange der Quotient passt *und* der Divisor < `0x8000` ist (dann sind beide Operanden nicht-negativ, signiert = unsigniert); ein unsignierter Divisor ≥ `32768` kommt signiert heraus, ohne Absturz (`INT_MIN/−1` → 0/0). **6 neue Tests**, 196 in der Datei, **491/491** im Repo. `FORTH.md`: neuer Abschnitt „Double-cell numbers", Zahl 138 → **151**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-15 | **Tier 2, 2. Schub: `case`/`of`/`endof`/`endcase`** — 155 Wörter. Die vier sind **immediate** und kompilieren nur vorhandene Wörter: **`of` ist `over = if drop`**, `endof` ist `else` (per Sprung auf `word_else` geteilt, damit der Rumpf nicht zweimal dasteht), `endcase` kompiliert `drop` und löst die Zweige auf — deshalb zeigt `see` eine `case`-Definition als ihre Zweige. Buchhaltung auf dem Kompilier-Rückstapel: `case` legt eine **Marke 0** ab (keine Adresse), `of` den Platzhalter. **Wächter:** `case_depth` (wie `loop_depth`) lässt ein verwaistes `endcase` nichts tun, und die Auflöseschleife flickt nur Adressen in `[dict_free, 0x3FFF]`. Die drei `xt`-Zellen, die `of` kompiliert, halten die **echten xts** (Header + 3 + Namenslänge), damit `see` sie benennen kann; ein Test pinnt alle drei gegen `' over`, `' =`, `' drop`. **Fund 1:** den vier Headern fehlte das IMMEDIATE-Bit — die Wörter wurden kompiliert statt ausgeführt (`see` zeigte `case 1 of …`); gefunden am `see`-Ausdruck. **Fund 2:** `LDI 0x4000` lädt `0xC000` (Bit 14 = Vorzeichen), womit die Obergrenze des Wächters negativ wurde, der Wächter bei **jeder** echten Platzhalteradresse zuschlug und `endcase` nichts flickte — das `(branch)` blieb auf 0 und die Maschine lief nach dem ersten `emit` ins Leere. Jetzt Carry-Vergleiche gegen `dict_free` und `0x3FFF`. Dazu die **Standard-Regel** im Manual: den Selektor verwirft die passende Klausel, sonst `endcase`; ein Ergebnis gehört mit `0 swap endcase` darunter. **3 neue Tests**, 199 in der Datei, **494/494** im Repo. `FORTH.md`: vier Zeilen in „Control flow" plus ein Absatz zur Selektor-Regel, Zahl 151 → **155**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-15 | **Tier 2, 3. Schub: Zeichenkettenwörter** (`cmove cmove> blank -trailing compare search /string`) — 162 Wörter. Ein Zeichen ist hier **eine Zelle**, also ist `cmove` = `move` (per Sprung geteilt) und `blank` = `fill` mit einem Leerzeichen (der Stub schiebt 32 und springt nach `word_fill`); `/string` addiert `n` direkt. **`cmove>`** kopiert von oben nach unten (Zeiger erst um `u` erhöhen, dann senken) und ist damit für Ziel über Quelle sicher, während `cmove` dort das erste Zeichen verdoppelt (gepinnt: `ABAABAAA`). `compare` liefert −1/0/1 nach dem ersten Unterschied bzw. der Länge und vergleicht **unsigniert** (128 > 127, gepinnt); `search` antwortet **den Rest ab dem Treffer** (`( c-addr3 u3 flag )`, leerer Nadel beginnt bei 0). **Fund 1:** `cmove>` startete eine Zelle zu tief — sah wie eine Richtungs-, war eine Startlagenfrage. **Fund 2 (Werkzeug):** `/string` benutzte `wls_ok`, das schon `word_lshift` gehört; der Assembler nimmt stillschweigend die letzte Definition und meldete nur einen zu weiten Sprung. Neuer Test: **alle ~850 Labels der Quelldatei sind eindeutig**. **5 neue Tests**, 204 in der Datei, **499/499** im Repo. `FORTH.md`: sieben Zeilen und ein Absatz in „Characters and strings", Zahl 155 → **162**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-15 | **Tier 2, 4. Schub: Ausnahmen** (`catch throw abort abort"`) — 166 Wörter. `catch` führt ein xt mit einem **3-Zellen-Rahmen auf dem Rückstapel** aus (voriger Handler / IP des Aufrufers / gemerkte Datenstapeltiefe); das xt wird wie von `execute` betreten, aber IP zeigt vorher auf einen **einzelligen Thread**, damit sein Ende in `word_catch_ok` landet statt im Interpreter — `throw` benutzt den zweiten Thread (`word_catch_thrown`) und dieselbe Buchhaltung ohne die Null. `throw` schneidet den Datenstapel auf die gemerkte Tiefe, setzt RP auf den Rahmen und den Handler auf den äußeren; `abort` = `-1 throw`, `abort"` (immediate, **kein** Tokenizer-Wort: `' abort"` findet es, `see` druckt es zurück) druckt seinen Text und wirft `-2`. **Die Kernel-Fehler sind Ausnahmen, solange ein Handler in Reichweite ist** (`stack_underflow_error` → `-4`, `skip_unknown` → `-13`, beide an *einer* Stelle geprüft); ohne Handler bleibt der alte Weg. **Fund 1:** `LD R1, R9, 0` liest über ES (LDI-Falle #4) — der gespeicherte IP landete im Bildschirm; neuer Test: **kein `LD`/`ST` darf R8/R9 als Basis benutzen**. **Fund 2:** `print_zstring` ist LINK-gerufen und ruft selbst `put_char` per LINK — LR war weg, es kehrte irgendwohin zurück; LR wird jetzt in `pzs_lr` geparkt (und nur R1–R3 überleben den BIOS-Aufruf, also läuft der Zeiger in R3). **5 neue Tests**, 209 in der Datei, **504/504** im Repo. `FORTH.md`: neuer Abschnitt „Exceptions", Zahl 162 → **166**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-15 | **Tier 2, 5. Schub: `evaluate`** — 167 Wörter. `evaluate` führt eine Zeichenkette durch **denselben Tokenizer** wie die Tastaturzeile (im aktuellen Zustand, also auch `:`/`;`), kopiert sie in einen **Puffer je Tiefe** (zwei Ebenen, der Standard verlangt zwei) und schließt sie mit einer Nullzelle ab; `interpret_done` erkennt eine laufende Auswertung und gibt **Quelle und Thread** zurück, statt eine Eingabeaufforderung zu drucken. Zu lange Zeilen oder eine dritte Ebene werfen `-22`. **Wichtig für `catch`:** ein unbekannter Name in einer Auswertung ist jetzt `-13` (erster erreichbarer Weg dorthin), und ein `throw` setzt die **Eingabequelle** zurück — dafür merkt sich der **catch-Rahmen** jetzt auch TIB und `>IN` (Rahmen 4 → **6 Zellen**), sonst liest der Interpreter den abgebrochenen Text noch einmal. **Drei Funde:** *(1)* `interpret_done` liegt im **engen 0x0100-Block** (19 Wörter frei); der Hook sprengte ihn und `.org 0x0500` überschrieb den Schwanz **stillschweigend**, sodass der Ablauf in `word_plus` fiel — jede Zeile endete mit Unterlauf; die Prüfung liegt jetzt im 0x0500-Block. *(2)* `SUB R1, 22` ist unmöglich (ALU-Immediate = 4 Bit) → `LDI -22`. *(3)* Bei interpretiertem `evaluate` zeigt IP auf `resume_list`, nicht auf einen Thread → der Rücksprung muss in `interpret_loop` gehen, damit der Rest der Zeile läuft. **2 neue Tests**, 211 in der Datei, **506/506** im Repo. `FORTH.md`: Zeile und Absatz in „Names and execution", Zahl 166 → **167**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-15 | **Tier 2, 6. Schub: Rest der Doppelzellen + `state` als Variable** (`d>s dabs dmax dmin 2literal 2>r 2r> 2r@ 2constant 2variable d. d.r`) — 179 Wörter. `dmax`/`dmin` teilen die Vergleichsroutine **`dless`**, mit der auch `d<` entscheidet (die alten `d<`-Tests halten den Umbau fest, inklusive Überlauf am Vorzeichenrand); `d.`/`d.r` bauen ihre Ziffern im **selben Haltebereich wie `#`** in der aktuellen Basis. **Fund der Runde: die Reihenfolge des Minus** — `d.` druckte `5-`, weil sich der Haltebereich **rückwärts** füllt und das zuletzt Gehaltene zuerst liest; genau deshalb ruft der Standard `sign` **nach** `#s`, und `hold_double` hält das Minus jetzt ebenfalls zuletzt (Vorzeichen in einer Zelle gemerkt). **Zwei alte Fallen:** *(1)* `hold_double` ruft `hld_put`/`hld_step` über `LINK`, das `LR` zerstört → Parkzelle nötig, dieselbe Falle wie bei `print_zstring`. *(2)* doppeltes Label `pc_done` (in `print_cells` und im 0x2000-Block) → lokaler Name `pcs_done`. **`state` ist jetzt eine echte Variable:** der Header zeigt auf `dovar` und die Zelle liegt direkt dahinter (wie `base`), `state @` ist `0`/`1`; `word_state` entfällt, der Test pinnt jetzt `state @ .`. **`see` nennt `2constant`** über eine `doconst2`-Verzweigung. **6 neue Tests**, 512 im Repo. `FORTH.md`: Doppelzellen-Tabelle + Prosa, `2literal`/`2>r`/`2r>`/`2r@`/`2constant`/`2variable`-Zeilen, Zahl 167 → **179**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-15 | **`form` + Umbruch an der rechten Kante** — 180 Wörter. `form ( -- rows cols )` = `24 80` (sichtbare Zeilen; Zeile 24 ist die Scroll-Reserve) über den `doconst2`-Laufzeitkern; erste nichstandard-Erweiterung. `words` und `see` brechen jetzt **an der letzten Lücke vor dem Rand**: passt das nächste Token samt Trenn-Leerzeichen nicht, kommt vorher CR+LF, das Token beginnt ganz in der nächsten Zeile — kein Wort wird durchtrennt. Die Spalte kommt aus `SCR` (einzige Bildschirmabfrage der Ausgabe; UART-Port ändert nur diese Routine). **Drei Funde:** *(1)* `wrap_if` ruft `put_char` über `LINK` → `LR` parken (wie `print_zstring`/`hold_double`), sonst hängen `words`/`see`. *(2)* **`DIV` gibt nur den Quotienten** (Rest nur bei `DIV32` in `Rd+1`) → Spalte = `Offset − row*80` wie in `bios_putch_cr`. *(3)* `R9` als `LD`/`ST`-Basis geht über `ES` → Zellbasis `R10`; der R8/R9-Test fing es. Helfer (`wrap_if`, `number_width`) im 0x0500-Block, weil 0x2000 auf **40 freie Wörter** fiel. **3 neue Tests**, 515 im Repo. `FORTH.md`: `form`-Zeile + Absatz, Zahl 179 → **180**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-16 | **Umbruch ließ Cursor-Reste stehen** (vom Nutzer gesehen). Ein normales `putch` setzt das Cursor-Attribut auf die Zelle, auf die es vorrückt; **CR/LF bewegen nur `SCR`**, also blieb das Attribut am Ende jeder umbrochenen Zeile liegen und die neue Zeile bekam keins (10 Cursor-Zellen nach `words`, davon 9 Reste). `wrap_if` löscht die Zelle jetzt vor dem Umbruch — **inline mit `R4`**, nicht über `clear_cursor`, weil `see_puts` seinen Zeiger in `R1` über den Aufruf trägt und `clear_cursor` `R1` benutzt. Dieselbe Regel, die `ok_after` und `word_cr` schon befolgen. **1 neuer Test** (zählt die Cursor-Zellen: jetzt genau eine), 516 im Repo. | `asm/forth.asm`, `tests/forth.test.js` |
| 2026-10-16 | **Opcode-Referenz geprüft; zwei echte Fehler im Buch behoben.** Die Spec (`doc/Deep16-Arch.md`) wurde gegen den Assembler nachgemessen: Schiebegruppe `110 10000`–`110 11011` (12/12), `MUL`/`MUL32`/`DIV`/`DIV32` (4/4) und System-/Flag-Gruppe (8/8) stimmen — die Meldung „drei Bereiche veraltet" war ein **Fehlalarm** (so bereits am 2026-10-11 im Log zurückgenommen). **Echt waren zwei Fehler in `book/anhang.md` Tabelle A-1:** `LSI Rd, imm` schreibt **`Rd`** direkt (der Simulator `writeGPR(rd, imm)`; die Zeile behauptete einen Umweg über `R0`), und die beiden `MVS`-Zeilen hatten das `d`-Bit vertauscht — `0` liest das Segmentregister in ein GPR (`MVS Rd, Sx`, `FF07`), `1` schreibt eines hinein (`MVS Sx, Rd`, `FF43`). Beide Zeilen sind korrigiert, eine `d`-Bit-Notiz ergänzt; die drei EPUBs neu gebaut. | `book/anhang.md`, `book/epub/*`, `STATUS.md` |
| 2026-10-16 | **Exakte vorzeichenlose 32÷16-Division** (`udiv`) — 180 Wörter (keine neuen). `um/mod` war bis jetzt nur exakt, solange der Divisor < `0x8000` war (der signierte `DIV32` liest einen Divisor ≥ `0x8000` als negativ), und `#`/`#s` konnten nur ein Doppel unterhalb `Basis*65536` drucken, weil der Quotient in **eine** Zelle gelegt wurde. Neuer LINK-Helfer **`udiv`** (R0:R1 Dividend, R12 Divisor → R0:R1 Quotient, R4 Rest, clobbert R2/R3/R7/R9/R10/R11): für Divisor < `0x8000` **zwei signierte `DIV32`-Schritte** — Null im hohen Halbwort hält den ersten Dividenden positiv, sein Rest bleibt unter dem Divisor, also ist auch der zweite Dividend (Rest:Tief) positiv; für Divisor ≥ `0x8000` eine **bitweise restaurierende Division** (16 Schritte, Rest in 16 Bit; ist sein oberstes Bit gesetzt, liegt der verschobene Wert über `0xFFFF` und damit sicher über dem Divisor, also wird unbedingt subtrahiert, und der 0x10000-Übertrag hebt sich genau auf). `#` behält jetzt den **vollen 32-Bit-Quotienten** (32÷16 → 32-Bit-Quotient). `um/mod` gibt weiter eine Zelle aus, wie der Standard-`u3`; ein Quotient, der mehr braucht, ist undefiniert. **Zwei Funde:** *(1)* `TBC Rd, imm` setzt `Z`, wenn das Bit **gesetzt** ist — entgegen der Registerform (`Z` bei Null) und entgegen meiner Annahme; beide Bittestellen sprangen falsch. Jetzt über `SL`/Carry getestet (eindeutig). *(2)* `udiv` zerstört `R7`, und **`d.r` hält seine Feldbreite genau dort** — `hld_step` parkt `R7` jetzt in `hld_r7`. **Verifikation:** 250 Zufallsfälle Divisor ≥ `0x8000` (0 Abweichungen, BigInt-Referenz), 117 < `0x8000` (0), 200 dezimale + 200 hexadezimale Zufallsdoppel über den vollen 32-Bit-Bereich (0); **2 neue Tests**, 222 in `forth.test.js`, `d.r`-Polsterung wieder gepinnt. `FORTH.md`: die `um/mod`-Grenze und der `#`-Absatz richtiggestellt. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-16 | **`included` — der Ladepfad** — 181 Wörter. `included ( i*x c-addr u -- j*x )` wertet einen **Puffer Quelltext** Zeile für Zeile aus, aufgebaut auf `evaluate`: jede Zeile kommt in einen **eigenen Puffer** (`inc_buf`, 128 Zeichen, NUL-terminiert — der Interpreter endet an einer Nullzelle, die Zeilenumbrüche der Quelle sind keine) und läuft durch denselben `interpret_loop`. Das Neue ist das **Zeilenende**: `eval_check` findet keine Auswertung laufen und liest dann — statt die Zeile zu beenden — die **nächste Zeile** aus dem Puffer (`include_line`). So ergibt eine ganze Datei **ein** ` ok` und **eine** Eingabeaufforderung. Umbrüche trennen; Leerzeilen und Kommentare sind einfach kurze Zeilen. **Grenzen:** der Puffer wird selbst getrieben und verbraucht keine Auswertungstiefe, also muss `included` auf der **obersten Ebene** laufen; aus einer Auswertung heraus oder während ein Ladepfad schon läuft → `-22`, ebenso eine Zeile über 128 Zeichen. Ein Fehler in einer Zeile (z. B. `-13`) **beendet den Ladevorgang** und gibt die Tastatur zurück (`word_accept` löscht `inc_state`). **2 Funde:** *(1)* Der `inc_state`-Räumpunkt lag zuerst in `recover_prompt` — der liegt im **engen 0x0100-Block**, und die 6 Wörter schoben ein `JZ interpret_done` in `parse_word` auf 258 Wörter (über die ±256-Grenze, der Assembler meldete es). Jetzt steht das Räumen in `word_accept` im **0x0500-Block**. *(2)* `inc_buf` musste ein **eigener** Puffer sein: die Zeile eines Ladepfads kann `evaluate` rufen, und das benutzt `eval_buf0` — mit einem gemeinsamen Puffer wäre der eben gelesene Text überschrieben. **Verifikation:** drei Zeilen (drucken/definieren/benutzen) → ein ` ok`; Leerzeilen, Kommentare, CRLF; eine Zeile, die `evaluate` ruft; ein unbekanntes Wort beendet den Ladevorgang; zu lange Zeile, `included` in `evaluate`, verschachteltes `included` → je `-22`. **1 neuer Test** (eigener Boot, weil der Puffer vor dem Tippen in den Speicher muss), 223 in `forth.test.js`. `FORTH.md`: `included`-Zeile + Absatz in „Names and execution", Zahl 180 → **181**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-16 | **`see` umgezogen, dann Tier-3-Schub A** — **193 Wörter**. Zuerst wanderte der ganze Dekompilierer (`word_see`, `see_body`, `sb_*`, `see_find_name`, `see_num`, `see_puts` — ca. 16 KB Quelltext) vom engen **0x2000**-Block in den **0x0500**-Block; das gab dem 0x2000-Block die **747 Wörter** zurück (von 28), ohne eine Zeile Logik zu ändern (nur die neuen Header-Ziele per `LDI`). Dann der Schub: `*/`, `*/MOD`, `CHAR+`, `CHARS`, `ALIGN`, `ALIGNED`, `PAD`, `UNUSED`, `SOURCE-ID`, `.R`, `U.R`, `.(`. **Die ersten sechs sind reine gefädelte Rümpfe** (`docol` + Xt-Zellen + `xt_exit`, wie `;` sie kompiliert) — kein neuer Laufzeitcode: `*/` ist `>r m* r> sm/rem nip`, `*/MOD` ist `>r m* r> sm/rem`, `CHAR+` ist `1+`, und `CHARS`/`ALIGN`/`ALIGNED` sind **leer**, weil ein Zeichen hier eine Zelle ist und jede Adresse damit ausgerichtet. `PAD` antwortet einen 128-Zellen-Puffer, `UNUSED` rechnet `0x4000 − HERE`, `SOURCE-ID` ist die Konstante `-1`, `.R`/`U.R` richten über `number_width` + `print_number` rechtsbündig aus (Feldbreite, kein Abschneiden), `.(` parst bis `)` und druckt, immediat. **Zwei Funde:** *(1)* `*/MOD` trug die **Länge 4** statt 5 — der Wörterbucheintrag hieß damit „*/MO" und war nicht auffindbar; der `see`-Durchlauf und die Suche zeigten es. *(2)* Die erste Rumpffassung war `m* sm/rem …`, aber der **Divisor liegt oben**: `m*` multipliziert die beiden obersten, also die falschen; jetzt wird er mit `>r`/`r>` über die Multiplikation gerettet. Dazu eine Label-Kollision (`wdr_ok`, `wdr_pad` gab es schon in `d.r`) — der Assembler meldete weite Sprünge, umbenannt auf `wnr_*`. **3 neue Tests**, 226 in `forth.test.js`. `FORTH.md`: Zeilen in Arithmetic/Memory/Characters/I-O/Dictionary, Zahl 181 → **193**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-16 | **Tier-3-Schub B: `>NUMBER`, `FIND`, `WORD`, `PARSE`, `C"`** — **198 Wörter**. `>NUMBER` ist der Schritt des Scanners, freigelegt: die führenden Ziffern der Zeichenkette in das gegebene Doppel falten (`ud*Basis + Ziffer` über `MUL32`, Ziffernwert aus `base_digit`) und den Rest der Kette zurückgeben. `WORD` parst ein Token in einen eigenen Puffer (`word_buf`, NUL-terminiert), `PARSE` gibt ein **Stück der Eingabezeile** (bis zum Trennzeichen, das geschluckt wird — kein Kopieren, keine Nullzelle, also `type` statt `count`). `FIND` sucht in der Suchordnung und antwortet `( c-addr 0 | xt 1 | xt -1 )` — `1` für immediat (Bit 15 der Flags-Zelle), `-1` sonst, `0` nicht gefunden. `C"` ist **compile-only** (immediate; interpretierend → `-14`) und legt eine NUL-terminierte Zeichenkette **inline** in die Definition (`xt_lit <Adresse> xt_cqstr <Zeichen> 0`), mit einem eigenen Laufzeitwort `word_cqstr`, das IP über die Zeichen setzt. **Bewusste Abweichung, dokumentiert:** `WORD`/`FIND`/`C"` folgen der hiesigen Zeichenketten-Konvention (**eine Zelle je Zeichen, NUL-terminiert**) statt der gezählten Byte-Kette des Standards — `bl word count type` gibt das Getippte zurück, und eine gezählte Kette hätte hier nichts, was sie baut. **Ein Fund:** Label-Kollision `wp_ok` (schon in `word_pick`) — der Assembler meldete einen 3636-Wörter-Sprung; umbenannt auf `wpa_*`. **5 neue Tests**, 231 in `forth.test.js`. `FORTH.md`: Zeilen in Numbers/Memory/Characters/Dictionary, Absatz zur Ketten-Konvention, Zahl 193 → **198**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-16 | **Tier-3-Schub C: `COMPILE,`, `[COMPILE]`, `POSTPONE`, `:NONAME`, `MARKER`** — **203 Wörter**. `dp_store` ist der eine Schritt des Compilers (Zelle anhängen) und damit `compile,`. `[COMPILE]` parst einen Namen und hängt dessen xt an, egal ob immediat. `POSTPONE` ist die vorsichtige Fassung: ein **immediates** Wort wird als **Aufruf** kompiliert (läuft also beim Übersetzen der aktuellen Definition), ein **nicht-immediates** als `LIT <xt> COMPILE,` (die Definition kompiliert es dann, wenn sie läuft) — das macht `: my-if postpone if ; immediate` zu einem `if`-Alias. Dafür liefert `find_token` die **Immediatheit jetzt in R9** (kleine Ergänzung, keine Aufrufer braucht R9 über den Aufruf). `:NONAME` baut eine Definition **ganz ohne Header** — nur eine CFA-Zelle mit `docol` —, sodass ihre xt die Adresse der Zelle selbst ist und sie per Name nie gefunden wird; `RECURSE` darin ruft sie weiterhin. `MARKER` legt einen gewöhnlichen Header an, dessen Laufzeit **DP und den Kopf der Wortliste** zurücksetzt; DP und Kopf werden vor dem Header in Zellen gemerkt (`mk_*`), die Momentaufnahme steckt hinter dem CFA. **Kein Maschinenfund** — dafür zwei eigene Testfehler, beide Stack-Reihenfolge: `['] dup compile,` (falsch, `[']` legt den xt erst zur Laufzeit) statt `[ ' dup ] compile,` bzw. `['] dup compile,` **in einem immediaten Wort**; und `7 execute` bei `:NONAME` (execute nimmt `7`, nicht den xt — richtig ist `5 swap execute`). Danach lief `:NONAME` samt `RECURSE` sauber. **5 neue Tests**, 236 in `forth.test.js`. `FORTH.md`: Zeilen und zwei Absätze in „Defining words", Zahl 198 → **203**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-16 | **Tier-3-Schub D: die Eingabequelle — und damit ist Tier 3 durch** — **211 Wörter**. `>in`, `source`, `refill`, `save-input`, `restore-input`, `quit`, `environment?`, dazu `>body`. **`>IN` ist die eine Stelle, an der das Standardmodell nicht passt:** der Zeiger in den Eingabepuffer ist das **Register R5**, es gibt also nichts, dessen Adresse das Wort liefern könnte. `>in` antwortet deshalb die Adresse von **`in_var`**, einer Zelle, die der Tokenizer bei jeder Verschiebung des Zeigers schreibt (in `execute_xt` vor jedem Wort, in `parse`, `word`, `find_token`): `>in @` liest den lebenden Offset, ein **Store hinein bewegt den Zeiger aber nicht** — dokumentierte Grenze. `source` misst die BIOS-Zeile bis zur NUL, `refill` antwortet `0` (die Zeile ist die einzige Quelle), `save-input`/`restore-input` sichern `(>in, tib)` mit Zähler `2` (jeder andere Zähler → `-1`), `quit` leert den Rückstapel, geht in den Interpretierzustand und beendet die Zeile, `environment?` beantwortet `CORE`, `CORE-EXT`, `MAX-N`, `MAX-U`, `ADDRESS-UNIT-BITS`, `/COUNTED-STRING` (Groß-/Kleinschreibung egal) und sonst `false`, `>body` gibt das Datenfeld eines `create`-Wortes (CFA+2, eine Zelle für den DOES>-Zeiger). **Ein Fund:** der `in_var`-Spiegel in `find_execute` sprengte den **engen 0x0100-Block** (ein `JZ interpret_done` in `parse_word` auf 257 Wörter) — der Spiegel liegt jetzt in **`execute_xt`** im 0x2000-Block, wo Platz ist und wohin ohnehin jedes dispatchte Wort kommt. **Damit ist die CORE/CORE-EXT-Lücke geschlossen**; `gap.mjs` meldet nur noch `(`, `."`, `s"`, `\` — Tokenizer-Wörter ohne Zelle, bewusst. **6 neue Tests**, 242 in `forth.test.js`. `FORTH.md`: Zeilen und ein Absatz in „Input, output and screen", `>body` in „Defining words", Zahl 203 → **211**. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |
| 2026-10-16 | **Negative Literale scannen** — **211 Wörter** (keine neuen). Bis jetzt war keine Ziffernfolge vorzeichenbehaftet: der Scanner prüfte `0`–`9` und schickte alles darunter — auch `-` — an `parse_word`, also war `-5` ein `undefined word: -5`, und jedes negative Literal musste `0 5 -` oder `5 negate` geschrieben werden. Der Scanner liegt jetzt **ganz im 0x0500-Block**: der enge 0x0100-Block hatte nur **19 Wörter** frei, die Vorzeichenlogik braucht mehr, und der Scanner war mit seinen rund 300 Wörtern ohnehin eine Einheit — er verließ 0x0100 durch **einen** kurzen `JNZ` in `check_s_token`, dort steht jetzt ein Drei-Wort-Stub, der nach `scan_number` springt. **Die Vorzeichenregel:** ein führendes `-` öffnet ein Literal nur, wenn eine **Ziffer der aktuellen Basis** folgt — `-5`, `hex -FF`; `-rot`, `-` sowie `-$10` und `-0x10` bleiben Wörter, weil sich das Vorzeichen **nicht** mit einem Hex-Präfix verbinden darf. Der Scanner merkt das Vorzeichen in der neuen Zelle `num_neg`, schiebt `>IN` über das Minus und läuft die normale Zahlenprüfung; gibt die auf, setzt **`scan_word`** `>IN` auf das Minus zurück und löscht `num_neg`, damit das ganze Token nachgeschlagen wird (`-abc` → `undefined word: -abc`). `finish_number` wendet das Vorzeichen an und löscht es für die nächste Zahl. **Ein Fund, der die Runde kostete:** `number_scan` liest die Zeichen durch **R3**, nicht durch `>IN` — der erste Versuch schob nur `>IN` und ließ R3 auf dem Minus stehen, also lief es wieder in `undefined word: -5`; jetzt wandert `ADD R3, 1` mit. **Verifikation:** `-5`, `-32768`, `-9 negate`, `hex -FF`, `: t -7 ;`, `see t` (druckt `-7`), und die Wortfälle `-rot`/`-`/`-0x10`/`-$10`. `>number` bleibt unberührt (es teilt nur `base_digit`, nicht den Scanner). **2 neue Tests** (245 in `forth.test.js`), **540/540** im Repo. `FORTH.md`: Beispiel, Konvention und der Basis-Absatz. | `asm/forth.asm`, `tests/forth.test.js`, `FORTH.md` |

## Architektur-Revisionen im Repo-Root

Das Buch erzählt die Deep16 so, wie sie **heute** ist. Damit es dabei nicht
stillschweigend veraltet, sind hier die Architektur-Dokumente aus dem
Repo-Root eingeordnet: Thema, tatsächlicher Stand, und was daraus für das
Buch folgt. Drei davon sind bewusst **kein** Buchthema.

| Dokument | Thema | Stand | Bedeutung für das Buch |
|---|---|---|---|
| `ARCHREV.md` | `MOV imm2` als Funktionsauswahl statt Addition | ✅ umgesetzt **und im Buch** | 2026-10-08 in Kap. 2 (§2.1, Tabelle 2-1) und Kap. 4 (§4.2) übertragen |
| `VERILOG.md` | dritter Kern: Verilog → Verilator + Emscripten | ✅ Phase 0–2 abgeschlossen, dreifache Parität grün, Decode-Sweep über alle 65 536 Befehlswörter ohne Abweichung | **im Buch eingearbeitet** — Kap. 6 §6.2 spricht jetzt von drei Kernen, `STYLE.md` §7 misst auf allen drei |
| `SERPLAN.md` | Quelltext über die Tastatur in den DeepForth-Kern eintippen | 🟡 Der serielle Weg ist **verworfen** und zurückgebaut; übrig bleibt der Knopf im Screen-Tab, im Browser unbestätigt | **Material für Kapitel 7** (Mini-Forth) — noch kein Kapiteltext |
| `PLANPSRAM.md` | PSRAM-Backing-Store für die FPGA | ⛔ **nicht umgesetzt** (Plan) | ❌ **kein Buchinhalt** |
| `FLASHPLAN.md` | Forth-Blocks auf dem Tang Nano 9K (Config-Flash via MSPI) | ⛔ **nicht umgesetzt** (Design); Block = 4-KB-Sektor, 80×24-Textfenster | ❌ **kein Buchinhalt** — Kandidat für Kapitel 9, sobald gebaut |
| `GFX.md`, `GFXOVERV.md` | Grafik-Subsystem GCoP | 🟡 Design-Phase, **ferne Zukunft** | ❌ **kein Buchinhalt** |
| `deep16_project_summary.md` | IDE-Entwicklungsstand (alt) | ⚪ überholt | — |

### Warum GFX, PSRAM und Flash draußen bleiben

- **`GFX.md` / `GFXOVERV.md` sind ferne Zukunft.** Beide Dokumente sagen das
  selbst: Projekt-Status *Design-Phase / Planungsgrundlage*, „keine
  Implementierungs-Spezifikation". Der Grafik-Co-Prozessor ist entworfen, nicht
  gebaut; es gibt weder einen Kern noch Messwerte dazu. Solange das so bleibt,
  darf kein Kapitel ein GCoP-Verhalten behaupten — eine ungebaute Architektur
  zu beschreiben hieße, das Buch kaputtzuschreiben, sobald sie gebaut wird.
  **Auslöser für eine Neubewertung:** sobald `rtl/` GCoP-Bausteine enthält,
  gibt es Messwerte und das Thema gehört in den Buchplan (Kandidat: Anhang).
- **`PLANPSRAM.md` ist nicht durchgeführt.** Der Plan beschreibt, den
  Speicher-Backing-Store des RTL-Kerns vom Verilog-Array auf den PSRAM der
  Tang Nano 9K umzuziehen. Der Ist-Stand ist unverändert: `rtl/deep16_top.sv:48`
  deklariert weiterhin `reg [15:0] mem [0:MEM_WORDS-1]`, und die
  `always_comb` ab Zeile 207 bedient genau dieses Array (elf kombinatorische
  Leseports plus ein Schreibport je Takt). Nichts davon ist messbar, also
  nichts davon darf im Buch stehen.
  **Auslöser:** sobald Schritt 1 der Umsetzung (Memory-Interface) im RTL
  steht, ist der Kapitel-6-Speicherkarte die PSRAM-Aufteilung hinzuzufügen.
- **`FLASHPLAN.md` ist ein Entwurf, kein Bau.** Er beschreibt einen
  Forth-Blockspeicher auf dem Config-Flash des Tang Nano 9K (über MSPI), mit
  Block = 4-KB-Sektor. Es gibt weder Gerätemodell noch RTL noch Messwerte.
  **Auslöser:** sobald das Gerätemodell im JS-Kern läuft (Phase 1), ist die
  Kapitel-6-Speicherkarte um die Storage-Ports zu ergänzen und ein Kapitel 9
  über den Forth-Kern möglich.

Alle drei bleiben hier sichtbar, damit niemand sie für vergessen hält: ein
Revisionsdokument im Repo-Root, das nichts mit dem Buch zu tun hat, ist eine
bewusste Entscheidung und keine Lücke.

---

## Speicherkarte des Forth-Kerns

`LDI` lädt **kein** Ziel ≥ `0x4000`: das 15-Bit-Immediate wird vorzeichenerweitert,
`0x4000` wird `0xC000`. Jede Marke, die der Kern per `LDI <marke>` erreicht, muss
also **unter `0x4000`** liegen — das erklärt die drei Code-Blöcke und die
Datengrenze, und es ist der Grund, warum `RSTACK_TOP` in einer Zelle (`rp0_base`)
steht, statt direkt geladen zu werden.

| Bereich | Größe | Inhalt | Frei* |
|---|---|---|---|
| `0x0000–0x00FF` | 256 | Niedrigspeicher; `DS:0`/`DS:1` = BIOS-Funktion/Argument | — |
| `0x0100–0x0500` | 1024 | **Code-Block 1**: `forth_start`, Tokenizer, `interpret_loop`, Fehler-Tail (`ok_after`, `line_done`, `interpret_done`); der Zahlen-Scanner ist hier nur noch ein Drei-Wort-Stub | **266** |
| `0x0500–0x2000` | 6912 | **Code-Block 2**: `word_plus` ff., Tokenizer-Helfer, **Zahlen-Scanner** (`scan_number`, `scan_word`, `number_scan`, `parse_number`, `parse_hex`), Zahlenausgabe, Schleifen, Doppelzellen, `evaluate`, `included`, `see`, `>number`/`find`/`word`/`parse`/`c"`, `compile,`/`postpone`/`:noname`/`marker`, `>in`/`source`/`refill`/`save-input`/`environment?`/`>body`, Umbruch-, Divisions- und `.R`/`.(`-Helfer; Puffer `print_buf`, `sq_buf` | **2426** |
| `0x2000–0x3000` | 4096 | **Code-Block 3 / Threading**: `next`, die indirekt-gefädelte Maschine, viele Primitive, `words`, `hld_buf` | **728** |
| `0x3000–0x4000` | 4096 | **Daten + Wörterbuch**: `sp0_base`, `tib_kbd`, Header-Kette, Variablen, eval-/include-/pad-/word-Puffer, `in_var`, `num_neg`, `marker`-Momentaufnahme, env-Tabelle; `dict_free` wächst nach oben | **1266** |
| `0x4000–0x6F00` | — | frei | — |
| `0x6F00` | | **Rückstapel-Oberkante** (wächst nach unten) | |
| `0x7FF0` | | **Datenstapel-Oberkante** (wächst nach unten) | |
| `0x8000–0xEFFFF` | | frei (nur über Zeiger erreichbar) | |
| `0xF0000` (ES) | | E/A: Tastatur `0xF0060/62`, Echo-Flag `0xF0064` | |
| `0xF1000–0xF17CF` | 2000 | **Bildschirm** 80×25 Wörter (24 sichtbar + Scroll-Reservezeile) | |
| `0xF8000` | | **BIOS** (`CS=0xF800`) | |

\* Stand 2026-10-16; die Zahl wandert mit jedem Schub.

**Die Grenzen sind hart.** `.org` setzt den Adresszähler und **wickelt still
zurück** — deshalb gibt es den Test „die .org-Abschnitte überlappen nicht".
Bedingte Sprünge reichen nur ±256 Wörter; ein Unterprogramm muss seine lokalen
Sprungmarken also im selben Block halten, während Aufrufe über Blockgrenzen mit
`LDI <marke>` + `MOV PC, R0` gehen. Der `0x0100`-Block ist nach dem Umzug des
Zahlen-Scanners wieder bei **266 Wörtern** frei (er war auf **19** gefallen, und
sein Tail ist der heiße Ausgang des Interpreters — der frühere Überlauf
überschrieb `interpret_done` ohne einen einzigen Assemblerfehler), der
`0x2000`-Block nach dem Umzug von `see` bei **747**. Das **Wörterbuch**
endet ebenfalls hart bei `0x4000`, weil Header per `LDI` adressiert werden.

**Was schon umgezogen ist:** `see` (der ganze Dekompilierer samt Zeichenketten)
saß bis zum 2026-10-16 im `0x2000`-Block und liegt jetzt im `0x0500`-Block; das
gab dem engen Block ~720 Wörter zurück. Am selben Tag folgte der **Zahlen-Scanner**
(`check_number_or_word` → `scan_number` und alles, was er ruft — rund 300 Wörter),
weil die Vorzeichen-Logik im 0x0100-Block keinen Platz hatte; er verließ ihn
durch **einen** kurzen `JNZ`, der jetzt auf einen Drei-Wort-Stub zeigt.
Neuer Code geht weiterhin bevorzugt in den **0x0500-Block**; reicht der nicht
mehr, zieht das nächste geschlossene Teilsystem als Ganzes um.

---

## Nächste Schritte

1. ✅ **Kapitel 5** abgeschlossen (Interrupts, Shadow-Register, `SWI`/`RETI`,
   `SMV`/`APSW`; Probe → Listings → Extractor → EPUB → Push).
2. Stichproben-Härtung Delay-Slot-Grenzfälle ist für Kap. 4 abgeschlossen
   (verschachtelte Jcc gemessen: innerer entscheidet, äußerer fällt weg).
3. ✅ **Kapitel 6** abgeschlossen (Memory-Mapped I/O, Delay-Slot-Diagnose,
   JS-/WASM-Vergleich).
4. ✅ **Kapitel 7** abgeschlossen (Mini-Forth, Listings 7-1 bis 7-5) und
   ✅ **Kapitel 8** abgeschlossen (Snake, Listings 8-1 bis 8-4).
5. ✅ **Anhänge A–D** abgeschlossen (`book/anhang.md`). Damit ist der
   Buchplan aus `book/README.md` ausgeschöpft: 8 Kapitel + 4 Anhänge.
6. ✅ **Kommentare** (2026-10-11): `\` bis zum Zeilenende und `( … )` bis zur
   schließenden Klammer. Beide werden vom **Tokenizer** erkannt und nicht im
   Wörterbuch nachgeschlagen — deshalb funktionieren sie am Prompt und in einer
   Definition gleichermaßen, denn ein Kommentar wird dem Compiler nie
   angeboten. Details unten.
7. ✅ **`EVALUATE`** (2026-10-15): führt eine Zeichenkette durch **denselben
   Tokenizer und dieselben Wörter** wie die Tastaturzeile, im aktuellen Zustand
   — zwei Ebenen verschachteln, `-13` (unbekannter Name) und `-22` (zu lang/zu
   tief) sind Ausnahmen. Offen bleibt nur die Bestätigung, dass eine Quelldatei
   im Browser eingetippt wird (`SERPLAN.md`): Material für ein Kapitel 9 über den
   Forth-Kern, der das Kernprogramm des Projekts ist.
8. **Der Forth-Kern ist das Kernprogramm des Projekts und war der am
   längsten liegengebliebene Teil.** `forth/hanoi.fth` trug vier „das kann der
   Kern nicht"-Vermerke; **alle vier** sind erledigt (Hex-Literale,
   Bitoperationen, `."`, `do`/`loop`) — der vierte (`2dup`) war nie einer, der
   Testfall dahinter war falsch. Dazu sind zwei Umwege weggefallen, die sich
   `hanoi.fth` wegen dieser Lücken selbst auferlegt hatte (`LWI`, Türme als
   `variable`).
   1. ✅ **`."` als IMMEDIATE-Wort** — der Text wird in die Definition kopiert
      und beim Aufruf gedruckt.
   2. ✅ **`do`/`loop`** — mit `?do`, `leave` und `i`. Der Rahmen liegt auf dem
      Rückstapel. `hanoi.fth` rechnet trotzdem mit `begin`/`until` und
      `while`/`repeat`: die Schleifen dort sind geschrieben und getestet, und
      eine funktionierende Datei umzuschreiben, nur weil das Werkzeug später
      kam, wäre Bewegung ohne Fehlerbehebung.
   3. ~~**`2dup`**~~ — **kein Fehler.** `1 2dup` meldet zu Recht Unterlauf,
      weil nur ein Wert auf dem Stapel liegt; der Testfall war falsch, nicht
      das Wort. Siehe Entscheidungs-Log.
   4. ✅ **`see name`** (2026-10-15) — der Decompiler: ein Wort wird nicht
      ausgeführt, sondern gezeigt (`: name … ;`, `variable`, `constant`,
      `create … does> …`, `vocabulary`, `code`). Was **bewusst** offen bleibt:
      `if`/`then`/`begin`/`until` erscheinen als `(branch)`/`(0branch)` mit
      dem gespeicherten Versatz statt als rekonstruierte Struktur — dafür
      bräuchte es den ganzen Kontrollfluss-Baum. Siehe Entscheidungs-Log.
   **Was an `do`/`loop` noch fehlte**, ist mit Schub 3 nachgekommen:
   `+loop` (Schrittweite), `j` (Index der äußeren Schleife) und `unloop`, dazu
   die Rückstapelwörter `>r`, `r>` und `r@`. Für `hanoi.fth` wird keines
   gebraucht — die Datei bleibt bei `begin`/`until`, solange nichts sie
   zwingt.
   **Methode, die sich bewährt hat:** erst die strukturelle Bedingung prüfen
   (Registerbudget, Header-Kette, SP-Disziplin), dann das Verhalten. Bei den
   Bitwörtern hat die umgekehrte Reihenfolge vier Anläufe gekostet. Der
   Satz gilt in beide Richtungen: bei `."` hat die Verhaltenssuche
   (`ST R4, R9, 0` schreibt nicht) den Verdacht auf den Store-Encoder gelenkt,
   der Fehler lag in drei Ebenen darüber — ein stillschweigend fallengelassener
   Operand, ein ES-Base-Register und ein Trenner im Text. Beim Loop war es die
   andere Richtung: die Werte stimmten, und die Maschine starb trotzdem, weil
   die **Disziplin** des Rückstapels stimmen muss, nicht nur sein Inhalt.
9. **Der Weg zum Standard-Forth, in Schüben.** Das Ziel ist Tier 3, gegangen
   wird es in Schüben, jeder mit eigener Probe und eigenem Commit.
   *Schub 1 (erledigt, 2026-10-15):* die 22 Wörter oben.
   *Schub 2 (erledigt, 2026-10-15):* `'`, `[']`, `execute`, `literal`, `char`,
   `[char]` — `'` ist dafür aus dem **Tokenizer** gefallen (`5 ' dup .` hieß
   vorher `5 dup .`), und der **Hex-Erkenner** brauchte einen Wächter, weil
   sonst `execute` als 0xEC gelesen wird (`exe` war wirklich die Zahl 14).
   *Schub 3 (erledigt, 2026-10-15):* `>r`, `r>`, `r@`, `+loop`, `j`, `unloop` —
   dieselbe Gegend wie `do`/`loop`, aber der Rückstapel gehört dann auch dem
   Anwender. Dabei ist der vorbestehende Vergleichsfehler behoben worden (siehe
   unten), weil `+loop` dieselbe signierte Frage stellt.
   *Schub 4 (erledigt, 2026-10-15):* `base`, `hex`, `decimal` — der invasivste,
   weil er `parse_number` **und** `print_number` umstellt. `base` ist eine
   Variable; der Scanner liest Ziffern der aktuellen Basis (über Basis zehn
   auch `A`-`F`, solange das ganze Token aus Ziffern besteht), und der Drucker
   teilt mit der 32-Bit-Form durch die Basis, weil `DIV` vorzeichenbehaftet ist.
   *Schub 5 (erledigt, 2026-10-15):* `s"`, `pick` und `roll`. `s"` ist ein
   Tokenizer-Wort und schluckt das trennende Leerzeichen (der Unterschied zu
   `."`, das es behält); interpretiert antwortet es aus einem eigenen Puffer,
   übersetzt aus einer Kopie in der Definition. `pick`/`roll` zählen von oben
   und prüfen ihre Tiefe selbst.
   *Schub 6 (erledigt, 2026-10-15):* die Zahlenausgabe als Umkehrstapel-Variante
   — `<# # #s #> hold sign` mit eigenem Halte-Puffer (Zeiger läuft von oben nach
   unten) und doppelzelliger Dividendenzahl, die `#` per `DIV32` durch die
   aktuelle Basis teilt. Damit ist die **Tier-1-Liste abgearbeitet**.
   *Erledigt (2026-10-15, Tier 2):* die **Doppelzellen-Arithmetik** — `s>d`,
   `d+`, `d-`, `dnegate`, `m+`, `d=`, `d0=`, `d<`, `um*`, `m*`, `um/mod`,
   `sm/rem`, `fm/mod`; damit steht auch `: d. <# #s #> type space ;` als
   Anwenderwort da.
   *Erledigt (2026-10-15, Tier 2):* `case`/`of`/`endof`/`endcase` — sie
   kompilieren nur `over = if drop` und `else`, also nichts, was der Laufzeit
   fehlte.
   *Erledigt (2026-10-15, Tier 2):* die **Zeichenkettenwörter** `cmove`,
   `cmove>`, `blank`, `-trailing`, `compare`, `search`, `/string`.
   *Erledigt (2026-10-15, Tier 2):* die **Ausnahmen** — `catch`, `throw`,
   `abort`, `abort"`; die Kernel-Fehler selbst werfen jetzt, solange ein Handler
   in Reichweite ist.
   *Erledigt (2026-10-15, Tier 2):* die **Doppel-Restliste** — `d>s`, `dabs`,
   `dmax`, `dmin`, `2literal`, `2>r`, `2r>`, `2r@`, `2constant`, `2variable`,
   `d.`, `d.r`; dabei wurde **`state` eine echte Variable** (Zelle hinter dem
   Code-Feld, `state @` ist `0`/`1`, wie `base`).
   *Erledigt (2026-10-15):* **`form`** und der **Umbruch an der rechten Kante** —
   `words` und `see` brechen an der letzten Lücke vor dem Rand statt mitten durch
   ein Wort; die Spalte kommt aus `SCR`. *Erledigt (2026-10-16):* der
   **Cursor-Fix** dazu (der Umbruch löschte die Cursor-Zelle vorher nicht und
   ließ an jeder umbrochenen Zeile einen reversen Block stehen), und **STATUS
   aufgefrischt**.
   **Als Nächstes:** der **Tier-3-Block**: die restlichen CORE/CORE-EXT-Wörter
   (`WORD PARSE FIND >BODY >IN SOURCE SOURCE-ID REFILL SAVE-INPUT RESTORE-INPUT
   COMPILE, [COMPILE] POSTPONE :NONAME MARKER PAD UNUSED QUIT ENVIRONMENT? */
   */MOD CHAR+ CHARS .R U.R ALIGN ALIGNED >NUMBER .( C"`).
   *Erledigt (2026-10-16):* die **exakte vorzeichenlose 32÷16-Division**
   (`udiv`): `um/mod` ist jetzt für **jeden** Divisor exakt, auch für einen
   ≥ `0x8000`, und `#`/`#s` drucken den vollen 32-Bit-Bereich. Dazu STATUS
   aufgefrischt und die Opcode-Referenz geprüft (die Spec stimmt mit dem
   Assembler; zwei echte Fehler im Buch behoben).
   *Erledigt (2026-10-16):* der **Ladepfad** — `included ( c-addr u -- )` wertet
   einen Puffer Quelltext Zeile für Zeile aus (auf `evaluate` aufgebaut, eine
   Zeile = ein Durchlauf), sodass eine ganze Datei ein einziges ` ok` und eine
   Eingabeaufforderung ergibt.
   *Erledigt (2026-10-16):* **Tier 3, Schub A** — `*/`, `*/MOD`, `CHAR+`,
   `CHARS`, `ALIGN`, `ALIGNED`, `PAD`, `UNUSED`, `SOURCE-ID`, `.R`, `U.R`, `.(`.
   Dabei wurde außerdem `see` vom engen `0x2000`- in den `0x0500`-Block
   verschoben (~747 Wörter zurück).
   *Erledigt (2026-10-16):* **Tier 3, Schub B** — `>NUMBER`, `FIND`, `WORD`,
   `PARSE`, `C"`.
   *Erledigt (2026-10-16):* **Tier 3, Schub C** — `COMPILE,`, `[COMPILE]`,
   `POSTPONE`, `:NONAME`, `MARKER`.
   *Erledigt (2026-10-16):* **Tier 3, Schub D — und damit Schluss** — `>IN`,
   `SOURCE`, `REFILL`, `SAVE-INPUT`, `RESTORE-INPUT`, `QUIT`, `ENVIRONMENT?`,
   dazu `>BODY`. Damit ist die **CORE/CORE-EXT-Lücke geschlossen**: die
   Lückenliste führt nur noch `(`, `."`, `s"` und `\`, und das sind
   **Tokenizer-Wörter ohne Wörterbuchzelle** (bewusst so, sie funktionieren).
   Der Kern steht bei **211 Wörtern**.
   **Was danach noch offen ist** (kein Tier-3-Stoff mehr): der BIOS-Umzug nach
   `asm/bios.asm` (braucht den Assembler-`include`, siehe `NEXT.md`),
   PSRAM/Flash/GFX (bewusst kein Buchinhalt) und das mobile UI.
   **Erledigt statt vormerkt:** `<`, `>` und mit ihnen `min`/`max` sind bei
   Überlauf **nicht mehr** falsch — sie lesen N und V zusammen (`N xor V`), und
   `+loop` tut dasselbe. Der Fehler war kein fehlendes Wort, sondern ein Fehler,
   und er ist vor dem Tier-3-Anlauf repariert worden, wie hier vermerkt.

---

## Zurückgestellt

Punkte, die gemeldet und bewusst **nicht sofort** bearbeitet wurden. Punkt 1
ist inzwischen erledigt, Punkt 4 kam am 2026-10-11 dazu und ist abgeschlossen.

**Offen ist nur noch Punkt 2 (mobiles UI).**

### 1. ~~`SERLOAD` funktioniert im Browser noch nicht~~ — erledigt auf anderem Weg

Der serielle Weg ist am 2026-10-11 **verworfen und vollständig zurückgebaut**:
Es gab eine zweite Betriebsart für etwas, das die Tastatur schon kann. Jetzt
tippt der Knopf **„Datei tippen…"** im Screen-Tab die Datei als Tastatureingabe
ein. Die Begründung und die Details stehen in `SERPLAN.md`.

Offen bleibt nur, dass der Ablauf **im Browser nie gelaufen ist**.

### 2. Das mobile UI muss aufgeräumt werden

Kein Fehler, sondern Struktur. Die bekannten Stellen:

- **Ein Knopf muss an drei Orten eingetragen werden**: im Markup, in
  `initializeMobileControls()` und in `restoreDesktopLayout()`. Genau daran ist
  der frühere `SERLOAD`-Knopf auf dem Handy verschwunden. Ein Test
  (`tests/ui-core.test.js`) prüft das inzwischen für alle Knöpfe im Panel-Kopf,
  trägt aber nicht das Markup selbst.
- **`.memory-panel-controls` steht zweimal in `css/memory.css`** (zweimal
  `display:flex`, einmal `gap: 4px` mit `margin-left:auto`, einmal `gap: 18px`
  ohne) — die spätere Regel gewinnt still.
- **Drei ineinander geschachtelte Media Queries** (768 / 900 / 480 px) mit
  Überschneidungen; die 900-px-Regel liegt zwischen den beiden anderen.
- **Die Knopfbreiten kommen aus JavaScript** (`--mobile-btn-w`, gesetzt in
  `initializeMobileControls` aus der gemessenen Breite des View-Schalters).
  Ein Label muss deshalb fürs Handy gekürzt werden, damit es nicht abschneidet —
  ein Ort, an dem man danach nicht suchen würde.

### 3. Die BIOS-Routinen dürfen ihre Länge nicht ändern  *(NEU, 2026-10-11)*

**Beim Umbau des Farbbytes gefunden.** `swi_to_bios` ist ein verzögerter
Fernsprung nach `CS=0xF800`, und der Kern lässt beim Zurückkehren den
Sprungzustand stehen. Solange der anhängt, gilt die *nächste* Instruktion als
Delay-Slot **dieses alten Sprungs** und der alte Zielpunkt wird erneut genommen.
Normalausgang ist, dass die Instruktion nach dem Sprung ihn aufräumt — im BIOS
klappt das nur, solange die Adressen stehen bleiben.

Messbar: nimmt man **ein einziges Wort** aus `bios_clr` oder `bios_f2`, läuft
der REPL 22 Eingabezeilen einwandfrei und hängt bei der **23.** mit leerem
Bildschirm, PC fest auf `LDI print_prompt`. Der Assembler meldet nichts, und
alle bisherigen Tests bleiben grün, weil keiner 23 Zeilen tippt.

Deshalb sind die Routinenadressen in `tests/forth.test.js` festgeschrieben
(`the BIOS block keeps its exact layout`) und die Eingriffe in `asm/forth.asm`
mit Füll-`NOP`s auf ihrer bisherigen Länge gehalten. Wer eine BIOS-Routine
kürzt, muss nachpolstern — oder das Aufräumen im Kern nachziehen und den Test
mit ihm abschaffen.

### 4. Das High Byte trägt jetzt ein volles 4+4-Bit-Farbbyte

**Erledigt 2026-10-11.** Vier Bit Vordergrund, vier Bit Hintergrund, alle
sechzehn Werte beiderseits erreichbar.

Der Schlüssel war die naheliegende Frage, ob „invertieren" mit zwei belegten
Nibbles überhaupt noch etwas anderes bedeuten kann: **nein, invertieren heißt
Vorder- und Hintergrund vertauschen.** Der Cursor ist damit keine Zusatz-
information mehr, sondern die umgekehrte Standardfarbe — Schwarz auf Hellgrau,
`0x70` im High Byte — und ihn zu löschen heißt, das Attribut auf `0` zu
setzen. Ein eigenes Bit ist damit überflüssig, und genau das war die Blockade:
vorher belegte Bit 15 den Cursor und nahm dem Hintergrund sein viertes Bit.

Umgesetzt an allen sieben Stellen, die den Cursor anfassten (`cursor_on`,
`cursor_off`, `clear_cursor`, `bios_clr`, `bios_f2` sowie Backspace und Echo
in `bios_getstr`). Der Bildschirm zeichnet die Farbe, die er bekommt, und
braucht keinen Sonderfall mehr; den grünen Rand als Lesehilfe setzt er als
reine Oberflächenmarkierung `.screen-cursor`.

**Die ISA-Falle dabei:** `LDI` signiert sein 15-Bit-Immediate, `LDI 0x7000`
lädt also `0xF000`. Die Konstante wird über `LDI 0x0070` + `SL R0, 8`
gebildet. Genau deshalb ist der erste Versuch gescheitert und nicht der
Farbplan.

Der Bildschirm ist 80×24 Zellen groß (640×360 px bei 8×15 px je Zeichen), was
ohne Kernel-Änderung geht: der Kernel löscht weiter 80×25 Wörter, schreibt aber
nie in die letzte Zeile. Ein Test hält diese Annahme fest.

### 5. Kommentare: `\` und `( … )`

**Stand 2026-10-11.** Beide Formen sitzen im Tokenizer zwischen der
Apostroph-Prüfung und dem Punkt-Token, erkannt am **ersten Zeichen** des
Tokens. Damit braucht keine von beiden einen Wörterbucheintrag, und keine
kann durch ein gleichnamiges Wort verdeckt werden.

```forth
( ein Kommentar ) 1 2 + .          \ und einer bis zum Zeilenende
: sq ( n -- n2 ) dup * ;
5 sq . 25
```

Zwei Entscheidungen, die nicht selbstverständlich sind:

- **Klammern verschachteln sich nicht.** `( eins ( zwei )` endet an der ersten
  `)`. Wer sie verschachtelt erwarten würde, bekäme verschluckten Code.
- **Eine nicht geschlossene `(` frisst nur die restliche Zeile** und nicht jede
  folgende `)` in der Datei. Das ist die verzeihende Lesart eines Tippfehlers.

Beide Formen teilen sich nur den Absprung `comment_done` und haben je eine
eigene Schleife. Das ist Absicht: der erste Versuch hatte **eine** Schleife mit
einer `)`-Prüfung am Ende, und `LDI label` + `MOV PC, R0` ist in diesem Kernel
ein *unbedingter* Sprung — die Prüfung wurde nie erreicht, toter Code, und
`( … ) 1 2 + .` lief nie. Genau dieselbe Form von Fehler hatte vorher schon
zwei Stunden gekostet; deshalb steht es jetzt so ausdrücklich im Quelltext.

Der `0x0100`-Block darf sich dabei verschieben (nachgewiesen: eine Wortgröße
Drift stört nichts), der BIOS-Block nicht.

## FPGA-Ziel Tang Nano 9K — Auslegungsbefunde

**Stand 2026-10-10. Schätzung, keine Synthese** — auf dieser Maschine gibt es weder
Yosys noch GowinE. Die Registerzahl ist exakt aus den Struct-Breiten gezählt, LUT-Zahl
und Taktfrequenz sind Schätzungen.

Zielressourcen (Sipeed-Wiki, GW1NR-9K): 8.640 LUT4, **6.480 FF**, 468 Kbit BSRAM
(26 Blöcke), 20 × DSP 18×18, **2 PLL**, 64 Mbit PSRAM.

### Passt der Kern?

| Ressource | Bedarf | verfügbar | Anteil |
|---|---|---|---|
| FF | ~2.100 | 6.480 | **32 %** |
| LUT4 | ~4.300 | 8.640 | **50 %** |
| BSRAM (Cache 4 KB) | ~37 Kbit ≈ 2 Blöcke | 26 Blöcke | 8 % |

Die FF-Verteilung: `ctx` 228, `if_id`+`id_ex` 100, `ex_mem`+`mem_wb` 896,
Registerbank 688, Rest ~150. Der State-Bundle-Entwurf („EX rechnet den ganzen
Folgezustand") kostet 2 × 228 = 456 FF allein für `ctx_next` durch die beiden
Rückstufen — der Preis der Architektur, hier bezahlbar.

### Befunde

1. **Speicher passt nicht in BSRAM.** Die On-Chip-Matrix
   (`rtl/deep16_top.sv:41`, `MEM_WORDS` in `rtl/deep16_pkg.sv:10`) belegt
   16,8 Mbit bei 468 Kbit verfügbar — **35×**. Unverändert bestätigt:
   PSRAM-Umbau ist Voraussetzung, nicht Kür.
2. ~~**`DIV`/`DIV32` schließt den Takt nicht**~~ — **behoben am 2026-10-10.**
   War als einzyklischer 32/32-Operator ein Taktbegrenzer (~8–16 MHz). Ersetzt
   durch `rtl/deep16_divider.sv`, einen handgeschriebenen iterativen
   Radix-4-Kern mit 18-Bit-Arbeitsregister, geteilt von `DIV` und `DIV32`
   (Details unten, Abschnitt „Iterativer Teiler"). Kostet 16 Takte je Division.
3. **Nur 2 PLL, aber `GFX.md` §3 plant vier Taktbereiche** (54 / 74,25 / 162 /
   371,25 MHz) bei 27-MHz-Quarz. 74,25 = 27 × 2,75 ist brüchig, braucht also ein
   echtes PLL. 371,25 = 5 × 74,25 geht über OSER. Weg aus 2 PLL:
   PLL1 → 74,25 (+5×), PLL2 → 162, CPU an **162/3 = 54 MHz**. Damit wird die
   CPU-Takt aber eine *abgeleitete dritte* Domäne — eine Festlegung, die
   `GFX.md` noch nicht getroffen hat.
4. **Debug-Bus gehört synthesefrei.** Der `DBG_*`-Kanal (`harness.cpp`,
   `get/set_debug_state`) ist reine Simulationsgerüstrüstung: ein
   256-Eintrags-Mux über die ganze Maschine. Per `ifdef` entfernt spart er
   ~800–1.200 LUTs und viel Routing.
5. **GFX obendrauf:** Line-OAM ~600 FF, GCoP-Logik ~2.000–2.500 LUT ⇒
   ~2.700 FF (42 %) und ~6.300–6.800 LUT (**73–79 %**). Passt, lässt aber keinen
   Raum für die GFX-Domain-Grenze — dort ist der erste Überlauf zu erwarten.

### Konfidenz

* **Register: hoch** — exakt aus den Struct-Breiten gezählt.
* **LUT: mittel** — ±25 %, ohne Synthese.
* **54 MHz: gering** — der Baustein bringt auf mittlerer Logik ~100–150 MHz;
  16-Bit-ALU plus breites Bypass-Netz in 18,5 ns ist *plausibel*, aber
  ungeprüft. Der Teiler allein verhindert es heute.
* Größte Unbekannte ist der **PSRAM-Controller**, den es noch nicht gibt.
  Dessen Arbitrationslogik ist nicht geschätzt — und er ist der eigentliche
  kritische Pfad des ganzen Projekts.

---

## Iterativer Teiler — gilt das für jeden FPGA?

**Im Kern ja, mit zwei Einschränkungen.** Der Befund ist nicht FPGA-spezifisch
zwitterhaft, sondern folgt aus einer Eigenschaft, die auf *allen* FPGAs gilt:

**Es gibt keinen Teiler-Makro.** DSP-Blöcke können multiplizieren, nicht
teilen. Eine Division ist auf jedem FPGA zwingend LUT-basiert, und die
Restwertkette ist prinzipiell tief. Ein in einem Takt ausgerollter 32÷16-Teiler
liegt damit auf keiner heutigen LUT-Struktur. Vergleichsweise: `MUL32` ist
16×16→32 und passt bequem in einen DSP (20 sind vorhanden) — der Teiler ist der
Ausreißer, nicht das Rechenwerk insgesamt.

**Einschränkung 1 — „jeder" ist zu stark.** Auf einem schnellen Baustein
(Speed-Grad -7/-8, gute Carry-Ketten) mag ein *einzelzyklisches* 16÷16 im
Taktbereich liegen. In ASIC ist es erst recht machbar (~2.000–3.000 Gatter,
100–200 MHz). Ein iterativer Teiler ist dort also *vorzuziehen*, nicht
*notwendig*. Für Deep16 ist er trotzdem richtig: die Teilung ist 32÷16, und
der Bruch ist eindeutig.

**Einschränkung 2 — Durchsatz.** Iterativ heißt 1 Teilung pro N Zyklen. Wer
viele Teilungen braucht, rollt teilweise aus (2 Bit pro Iteration) oder
pipeliniert. Für Deep16 ist Durchsatz kein Thema.

### Wie schnell ohne Änderung? — und zwei Korrekturen (2026-10-10)

**Erste Schätzung: 33 Bit pro Iteration.** Das war falsch. Eine 32÷16-Teilung
braucht ein **18-Bit-Arbeitsregister** (Divisor 16, um 2 verschoben, + 2-Bit-Digit), nicht 33 —
der Quotient ist 16 Bit, der Rest 16 Bit, beides passt in dieselbe
Zwischenstufe.

**Zweite, wichtigere Korrektur:** Das RTL nutzt die Verilog-Operatoren
(`rtl/deep16_alu.sv:235-236`)

    quot32  = dividend32 / {16'h0000, opv_i};
    rem32   = dividend32 % {16'h0000, opv_i};

Verilog sieht damit **32/32**, nicht 32/16 — der Divisor ist auf 32 Bit
hochnullifiziert. Ein Synthesizer inferiert daraus **zwei** volle 32-Bit-Teiler,
von denen nur die unteren 16 Bit benutzt werden.

| Variante | Arbeitsbreite | Zyklen | Logik | Fmax |
|---|---|---|---|---|
| unverändert (`/` + `%` inferiert) | 33 | 1 | 1200–2000 LUT + 2 Teiler | **8–16 MHz** |
| handgeschrieben, kombinational | 18 | 1 | ~700–1100 LUT | 18–31 MHz |
| **handgeschrieben, iterativ (gewählt)** | **18** | **16 (Radix-4)** | **~300–450 LUT** | **54+ MHz** |

Die Arbeitsbreite ist **18**, nicht 17: Radix-4 schiebt den Restwert um **2**, nicht
um 1, und addiert ein 2-Bit-Digit dazu — `4·0xFFFF−1 = 0x3FFFF` braucht 18 Bit.

**Und warum iterativ die Breite entkoppelt:** der kritische Pfad ist dann nur
noch *eine* Iteration — Carry-Kette (0,5–1,0 ns) + Compare/Mux
(0,7–1,5 ns) + Routing (1,0–2,0 ns) = **2,2–4,5 ns**, also 222–455 MHz. Bei
54 MHz bleibt 4–8× Reserve. Genau hier liegt der eigentliche Gewinn: nicht nur
Takt, sondern **~25–30 % des gesamten LUT-Budgets** (4.300 geschätzt) kommt
zurück, weil ein ausgerollter Teilerarray Breite × Iterationen kostet, ein
iterativer nur eine Iteration Breite.

**Der Preis sind Zyklen, nicht Takt.** Radix-4 verbraucht **2 Dividend-Bits je
Iteration**, also 16 statt 32 Takten — die Hälfte, die Radix-2 bräuchte:

    Misch-CPI  Radix-2: (5 × 1,04 + 32) / 6 = 6,20  ->   8,7 MIPS @ 54 MHz
    Misch-CPI Radix-4: (5 × 1,04 + 16) / 6 = 3,53  ->  15,3 MIPS @ 54 MHz

**Korrektur vom 2026-10-10 (nach der Messung).** Dieser Abschnitt behauptete
zuvor *8 Takte* und 24,5 MIPS. Das war falsch gerechnet: der Quotient einer
32÷16-Teilung ist **32 Bit** lang und wird erst am Ende auf 16 Bit abgeschnitten
(`quot32[15:0]`). Man muss deshalb **alle 32 Dividend-Bits** aus `rem = 0`
verbrauchen — 2 je Iteration ⇒ **16 Takte**. Der Trick, den Restwert mit
`dividend[31:16]` zu seedsen, ist nur legal, wenn diese obere Hälfte bereits
kleiner als der Divisor ist; bei kleinem Divisor ist das falsch
(`0xFFFFFFFF / 1` hätte oben `0xFFFF` gegen Divisor `1`). Radix-4 bleibt die
richtige Wahl — es halbiert die Iterationen gegenüber Radix-2 — ist aber nicht
so schnell, wie hier stand.

**Gemessen:** `DIV` kostet **exakt 16,0 Takte mehr als `ADD`** (100fach
vergleichsweise über den Zyklenzähler). Die Tabelle oben ist damit bestätigt.

### Entscheidung (2026-10-10): Radix-4, ein Kern für DIV und DIV32 — **umgesetzt**

Siehe Entscheidungs-Log. `DIV` und `DIV32` teilen **einen** iterativen
Radix-4-Kern (`rtl/deep16_divider.sv`); Quotient und Rest fallen gemeinsam an,
die Doppel-Operatoren `/` und `%` entfallen. `DIV32` mit ungeradem Zielregister
und beide mit Divisor 0 umgehen den Kern (feste Ergebnisse) — 1 Takt statt 16.

Der Kern brauchte mehr als einen `stall`, und das ist der eigentliche Punkt:

* `stall` ist ein **Einzeltakt**-Mechanismus — er schiebt in jedem
  gestallten Takt eine Blase nach MEM. `ctx_e` (der State-Bundle, den EX liest)
  ist aber nur zwei Stufen tief: `ex_mem`, dann `mem_wb`, dann fällt er auf das
  bereits committete `ctx` zurück. Über 16 Takte leert sich diese Kette, und EX
  rechnet aus veraltetem State.
* Deshalb zwei Phasen: **drain** (die ein bis zwei Instruktionen vor der DIV
  treten normal aus, `ex_mem` bekommt eine Blase) und danach **freeze** (wenn
  `ex_mem` und `mem_wb` leer sind, rührt sich nichts mehr — dann ist der
  Fallback auf `ctx` legitim, weil alles davor retired ist).

**Zwei Fehler, die erst die Messung gefunden hat** — beide waren vor dem
Einchecken nicht sichtbar, und der zweite wäre in keinem bestehenden Test
aufgefallen:

1. Der Dividend für `DIV` muss ins **untere** Halbwort: `{16'h0000, r1}`.
   `{r1, 16'h0000}` rechnet `r1·65536 / Rs` statt `r1 / Rs`. Symptom: `100/7`
   lieferte 18724 (= `936228 mod 65536`) statt 14.
2. Der Startpuls muss sich **pro Division** neu spannen, nicht pro Verweilzeit
   in EX. Zwei `DIV` hintereinander halten `div_req` durchgehend hoch, ein auf
   `!div_req` verankertes Nachspannen feuert nie — die zweite Division hätte
   still den ersten Quotienten wiederverwendet. Kein bestehender Test stellt
   zwei Divisionen hintereinander; `tests/rtl.test.js` hat jetzt einen.

Nachgemessen: `DIV` kostet **exakt 16,0 Takte mehr als `ADD`**. Lint sauber,
`npm test` 296/296 grün (inkl. Fuzz), plus ein eigener 22k-Fälle-Abgleich des
Teilers gegen Verilogs eigenes `/` und `%` (`rtl/sim/divtest.cpp`).

### Der eigentliche Preis — er fällt aus (2026-10-10 geprüft)

Erste Einschätzung war: die Shadow-Register existieren **genau damit**, einen
Interrupt in 2 Zyklen eintreten zu lassen (`doc/Deep16-Arch.md` §2.3); ein
iterativer Teiler hält Zwischenergebnisse über mehrere Takte *innerhalb eines
Befehls* und ein Interrupt mitten darin träfe auf architektonischen Zustand, den
es noch nicht gibt. **Geprüft: das kann nicht eintreten.**

1. **Es gibt keine Hardware-Interrupt-Leitung.** Kein `irq`, `int_req` oder `nmi`
   im RTL; die Ports von `deep16_top` sind `clk/rst/i_step/i_free/o_*/kbd_*/dbg_*/cache_*`.
2. **`SWI` ist der einzige Interrupt-Weg** — und wird in **EX** dekodiert
   (`rtl/deep16_core.sv:546`, `is_swi_ex`).
3. **`stall` friert die Pipeline** (`rtl/deep16_core.sv:1089-1095`): `ex_mem`,
   `id_ex`, `if_id`, `if_pc` werden nicht weitergeschrieben, **EX hält seinen
   Befehl**.
4. Ein iterativer Teiler setzt `stall`, solange er iteriert → **EX hält das `DIV`
   → kein folgender Befehl, auch kein `SWI`, erreicht EX.**

**Folgerung:** Ein Interrupt kann den Teiler strukturell nie mitten im
Flug erwischen. **Die vier Optionen sind für den heutigen Stand gegenstandslos —
es ist nichts zu tun.** Auch die Spezifikationszusage „Interrupt latency:
2 cycles" (`doc/Deep16-Arch.md` §1.3) bleibt unverändert *wahr*; der
ursprünglich erwogene Zusatz „+6 Zyklen bei Division" ist nicht nötig.

Der Teiler hält übrigens **8 Takte** (Radix-4), nicht ~32 — die allererste
Schätzung war doppelt daneben: sie nannte 33 Bit pro Iteration *und* ~32 Takte.
Beides korrigiert im Abschnitt „Wie schnell ohne Änderung?".

### Entscheidung (2026-10-10): Option 4 (Drain) für den künftigen HW-Interrupt

`doc/Interrupts.md` Zeile 64 spezifiziert `0x0001: HW_INT_VECTOR` — ein
**geplantes, aber nicht gebautes** Hardware-Interrupt-System. Sobald es kommt,
kann ein *asynchrones* IRQ mitten in einer Division eintreffen.

**Festgelegt ist Option 4 (Drain).** Im Interrupt-Annahme-Pfad:

    irq_pending <= irq_pending | irq_in;
    take        <= irq_pending & PSW.I & !div_busy;   // div_busy = Teiler iteriert

Kosten: **ein** zusätzliches FF (`irq_pending`) und ein UND in der
Annahmebedingung. Worst Case steigt die Interrupt-Latenz von 2 auf 2 + ~6 Takte
(bei 54 MHz: 37 ns → ~148 ns).

**Begründung der Wahl:**

* Das Problem ist für den heutigen Stand gegenstandslos (siehe oben). Option 4
  kostet deshalb *jetzt* nichts und ist die Antwort, die man nicht neu
  herleiten muss, wenn das HW-Interrupt-System gebaut wird.
* Die Auswahl bindet kein Versprechen der Architektur: der Kern bleibt
  Echtzeit-tauglich, nur die *Latenz* ist in diesem einen Fenster variabel.
* **Option 1 (Shadow) bleibt bewusst abgelehnt**, weil sie den meistgelehrten
  Begriff Shadow-Register auf Ausführungseinheiten-Zustand ausdehnen würde
  (`book/kap05.md`, 730 Zeilen). Das wäre ein dauerhaftes zusätzliches
  Versprechen in Spezifikation, Kapitel und Test — erkauft für ein Fenster, das
  kein Deep16-Anwendungsfall enthält.

Falls jemals ein echter Echtzeit-Anspruch gestellt wird, ist Option 1 der
Ausweg: sie ist dann billig, weil der Mechanismus (Shadow-Bank) bereits
existiert; es kommen ~60–80 FF und ein paar Muxer im SWI-Pfad dazu.

Für den Teiler selbst ist der Ausweg aus dem Stall-Pfad klar: `stall` ist heute
allein vom Load-Use-Hazard gesetzt (`rtl/deep16_core.sv:365-374`), ein Teiler
OR-t seine eigene Bedingung dazu — derselbe Mechanismus, nur länger. Das ist
die einzige Änderung, die für die Iterativ-Teilung überhaupt nötig ist.

---

## Bekannte Mängel

* **Keine.** Die beiden am 2026-10-10 vermerkten Punkte sind erledigt:
  - ~~`npm run lint:rtl` scheitert an `deep16_cache`~~ — behoben am 2026-10-10,
    die Quellliste entspricht jetzt `scripts/build_rtl_native.sh`; Lint läuft mit
    `-Wall` fehler- **und warnungsfrei** durch.
  - ~~`DIV`/`DIV32` im Einzelzyklus verhindert den FPGA-Bau~~ — behoben am
    2026-10-10 durch `rtl/deep16_divider.sv` (iterativer Radix-4-Kern, 16 Takte,
    **ein** Kern für `DIV` und `DIV32`).
* Der am 2026-10-10 vormerkte `LDI`-Bereichsfehler ist **kein Fehler** —
  die Vermerkung war eine Fehldiagnose (siehe Entscheidungs-Log).
* **Drei Mängel, die am 2026-10-14 gemeldet und am selben Tag zurückgenommen
  wurden** — alle drei waren Fehlalarme aus falschen Testfällen:
  - ~~`drop` nimmt einen leeren Stapel ohne Meldung~~ — `12 10 and drop`
    hinterlässt `and` genau einen Wert, den `drop` nimmt; danach ist der
    Stapel leer und das *folgende* `.` meldet zu Recht Unterlauf.
  - ~~`1 2dup . . .` meldet „stack underflow"~~ — zu Recht: `2dup` braucht
    zwei Werte, da lag einer. Nachgemessen: `1 2 2dup . . . .` → `2 1 2 1`,
    `1 2 2dup depth .` → 4, und `2dup`/`dup`/`drop` melden auf leerem Stapel
    alle drei Unterlauf.
  - ~~das nackte `"` frisst zusätzlich das schließende `;`~~ — `;` schließt in
    beiden String-Formen sauber.
  Gemeinsame Ursache der ersten beiden: der **Fehlerpfad lässt den Datenstapel
  unangetastet**, sodass nach einem Unterlauf Reste liegen bleiben und das
  nächste Wort sie sieht. Das ist gewollt (ANS: Stapel nach Fehler undefiniert)
  und wird nicht geändert.
* **Ein echter Fehler, gefunden am 2026-10-14 und behoben:** der Assembler
  ließ bei `ADD/SUB/CMP/… Rd, Rs, imm` den dritten Operanden **ohne Meldung**
  fallen (die ALU-Gruppe ist in beiden Formen zweistellig, Spec Tabelle 6).
  `ADD R11, R9, 1` wurde als `R11 ← R11 + R9` übersetzt. Dreistellige Zeilen
  werden jetzt abgewiesen.

**Was tatsächlich offen bleibt** — nicht Mängel, sondern Arbeit:

| Punkt | Wo | Warum offen |
|---|---|---|
| **Forth-Kern: der Rest von CORE/CORE-EXT** | `asm/forth.asm` | `j`, `r@` und `+loop` sind da (Tier 1/2 abgeschlossen). Offen ist der **Tier-3-Block**: `WORD PARSE FIND >BODY >IN SOURCE SOURCE-ID REFILL SAVE-INPUT RESTORE-INPUT COMPILE, [COMPILE] POSTPONE :NONAME MARKER PAD UNUSED QUIT ENVIRONMENT? */ */MOD CHAR+ CHARS .R U.R ALIGN ALIGNED >NUMBER .( C"`, dazu die exakte vorzeichenlose 32÷16-Division und der Ladepfad. Siehe „Nächste Schritte" Nr. 9 |
| Opcode-Referenz | `doc/Deep16-Arch.md`, `book/anhang.md` | **Geprüft 2026-10-16:** die Spec stimmt an jeder Stelle mit dem Assembler überein (Schiebegruppe 12/12, `MUL`/`DIV` 4/4, System- und Flag-Gruppe 8/8) — die frühere Meldung „drei Bereiche veraltet" war ein **Fehlalarm** (so schon am 2026-10-11 im Log vermerkt; echt war nur die `DIV32`-Etikettierung, längst behoben). In `book/anhang.md` Tabelle A-1 standen dagegen **zwei echte Fehler**, jetzt behoben: `LSI` schreibt **`Rd`** (nicht über `R0`), und die beiden `MVS`-Zeilen hatten das `d`-Bit vertauscht (`0` = lesen, `1` = schreiben) |
| Quelldatei im Browser eintippen | `SERPLAN.md` | Nie im Browser gelaufen; die Pumpe ist nur gegen den echten Kernel auf dem JS-Kern getestet |
| Kapitel 9 ff. | `book/README.md` | Buchplan ist mit Kapitel 8 + Anhängen ausgeschöpft |
| `PSRAM` / `GFX` | `PLANPSRAM.md`, `GFX.md` | Nicht implementiert — bewusst kein Buchinhalt (Anhang D.4) |

---

## Geschätzte Performance (mit korrigierter Messung)

`run_cycles()` (Commit `3e7b5b4`) macht die Zyklenzahl erst lesbar; vorher lag
CPI konstant bei 2,0, weil `step()` je Befehl eine feste Pipeline-Füllphase
zahlt. Nachgemessen, geradliniger Code:

| ALU-Befehle pro Sprung | CPI | MIPS @ 54 MHz |
|---|---|---|
| 4 | 1,286 | 42,0 |
| 12 | 1,133 | 47,6 |
| 48 | 1,039 | 52,0 |

Deckt den spezifizierten Bereich 1,0–1,3 (`doc/Deep16-Arch.md` §1.3). Referenz
6502 @ 1 MHz: 0,43 MIPS. **Die Zahlen in `book/kap01.md` §1.1 (27 Mio. IPs,
63× , 22×) stammen aus derselben Messung und sind entsprechend zu korrigieren.**

---

## Offene Punkte (aus `book/README.md`)

- Umfang pro Kapitel final kalkulieren.
- Wie viel 6502-Kontrast nach Kap. 1–3 noch erwünscht?
- Diagramm-Stil `block-beta` ist gesetzt; SVG-Export für Druck läuft über den
  bestehenden EPUB-Filter.