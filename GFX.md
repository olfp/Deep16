# Design-Spezifikation: Deep16 Grafik-Subsystem (GCoP)

Projekt-Status: **Design-Phase / Planungsgrundlage.** GFX ist ferne Zukunft; dieses
Dokument beschreibt eine beabsichtigte Richtung, **keine** Implementierungs-Spezifikation.
Es ersetzt die frühere Fassung (Commit `3710b63`) nach einer Architektur-Review.

Ziel-Hardware: Sipeed Tang Nano 9K (Gowin GW1NR-9K, 8.640 LUT4 / 26 BSRAM / 64 Mbit PSRAM).
Referenzen: `doc/Deep16-Arch.md`, `doc/Deep16-Prog-Man.md`, `rtl/*.sv`, `VERILOG.md`.

Kern-Konzept: Framebuffer-lose, objektorientierte Grafik-Engine via mikroprogrammierter
Spezial-CPU (GCoP – Graphics Co-Processor), Beam-Racer-Prinzip.

---

## 0. Revisionsstand – Änderungen gegenüber `3710b63`

Dieses Dokument hat **zwei** Review-Durchläufe durchlaufen. Die erste Fassung der
Korrekturen (Commit `12eebb3`) enthob einen Fehler; §1.1 dokumentiert die Korrektur.

| # | Befund | Status |
|---|---|---|
| 1 | ~~H-Blank-Timing war falsch~~ | **zurückgenommen** – die erste Fassung `3710b63` hatte mit 370 Pixelclocks **recht**; die Erstkorrektur verwechselte 720p60 mit 1080p60. Korrigiert in §1.1. |
| 2 | ~~PSRAM-Bandbreite im Maximalfall über Budget~~ → **zurückgenommen:** die Rechnung war methodisch richtig, beruhte aber auf 16 gleichzeitigen Objekten. Mit ~7 (§4.4) liegt selbst der Worst-Case bei 60 %. Siehe §6.2 |
| 3 | Paletten-Schema (pro 16 px) war als Normalfall modelliert | **neu gefasst als Betriebsmodi**, §5 |
| 4 | OAM-Scan-Budget fehlte; keine Obergrenze für Objekte benannt | **ergänzt**, §4.3 + §6.3 |
| 5 | Kein CPU/GCoP-Memory-Arbiter | **als offener Punkt aufgenommen**, §4.5 |
| 6 | Aktuelles Deep16-RTL passt nicht auf den GW1NR-9K (Speicher!) | **als Voraussetzung aufgenommen**, §9 |
| 7 | „gesamter Speicher" per 20-Bit-Leitung widersprüchlich | **korrigiert**, §2.1 |
| 8 | Kein CPU-sichtbares Register-Interface | **Entwurf ergänzt**, §7 |
| 9 | Keine Interrupts | **Entwurf ergänzt**, §7.2 |
| 10 | Textmodus 80×25 ohne Lebensraum | **als offene Entscheidung festgehalten**, §8 |
| 11 | Überschriften-Kollision, Alpha-Blending-Begriff, fehlendes Clipping, fehlender Hintergrund, `Interlacing`-Flag ohne Modus, Chat-Reste am Dokumentende | **korrigiert** |
| 12 | OAM-Scan-Budget zu optimistisch (669 statt 269 Zyklen, ~16 statt ~7 Objekte) | **korrigiert**, §4.4 |
| 13 | Non-executable Video-RAM als Enabler für die PSRAM-Port-Aufteilung | **neu aufgenommen**, §2.4 + §9.2 |

---

## 1. Systemübersicht & Display-Spezifikationen

Das System nutzt das Beam-Racer-Prinzip. Bilder werden in Echtzeit zeilenweise während des
HDMI-Auswurfs generiert. Ein klassischer, permanenter Vollbild-Framebuffer entfällt.

* Target-Auflösung (Logisch): 640 × 360 Pixel (exakt 16:9).
* Ausgabe-Auflösung (Physisch): 1280 × 720p @ 60 Hz via HDMI, CTA-861-Timing.
* Skalierung: 2×2 Integer-Scaling (perfekt verdoppelte Pixel, kein Unschärfe-Flimmern).
* Farbtiefe: 4 Bit pro Pixel (16 Indizes: 0x0 = transparent, 0x1–0xF = Palettenfarbe).
* Ausgabefarben: 16 Bit HighColor (RGB 565) über die aufgelöste Palette.

### 1.1 Zeitbasis (CTA-861 VIC 4, 720p60 @ 74,25 MHz)

> **Warnung – die Erstkorrektur war falsch.** Commit `12eebb3` behauptete, die
> ursprünglichen 370 Pixelclocks H-Blank ergäben 40 Hz und seien durch 920 zu ersetzen.
> Das war ein Verwechslungsfehler: die Werte 2200/1125/148,5 MHz gehören zu **1080p60**,
> nicht zu 720p60. Übernommen wurden sie bei 74,25 MHz und ergaben folgerichtig 30 Hz.
> **Die Ursprungsfassung `3710b63` hatte recht.** Die folgenden Werte sind gegen
> CEA-861 Table 4 geprüft und sollen künftig zitiert statt neu abgeleitet werden.

| Größe | Wert | Quelle |
|---|---|---|
| Pixelclk | 74,25 MHz | VIC 4 |
| H_active | 1280 Pixelclocks = 17,24 µs | VIC 4 |
| **H_blank** | **370 Pixelclocks = 4,98 µs** | VIC 4 |
| H_total | 1650 Pixelclocks = 22,22 µs | VIC 4 |
| Zeilenfrequenz | 45,0 kHz | VIC 4 |
| V_active / V_total | 720 / 750 Zeilen (30 V-Blank) | VIC 4 |
| **V_blank (ganzes Bild)** | 30 Zeilen × 22,22 µs = **666,7 µs** | abgeleitet |
| Bildrate | 74,25 MHz / (1650 × 750) = 60,00 Hz | VIC 4 |

**Konsequenz für die Auslegung:** Das H-Blank beträgt **4,98 µs** – knapp die Hälfte der
Zeit, die der erste Korrekturversuch annahm. Das OAM-Scan-Budget (§4.4) ist entsprechend
**knapper als in `12eebb3` behauptet**, nicht reichlicher. Ein Y-Bucket-Index ist damit
**zwingend**, nicht als Folgeprojekt verschiebbar.

Unverändert gültig bleiben: die aktive Videozeit von 17,24 µs und damit die
Bandbreitenrechnung in §6.2, denn `H_active = 1280` ist von der Blanking-Korrektur nicht
berührt. Ebenso bleibt V_blank mit 666,7 µs ein großzügiges Fenster für den ISR (§7.2).

---

## 2. Speicher-Architektur & Segmentierung

### 2.1 Adressbreite

Das Hauptsystem nutzt 16-Bit-Wortadressierung. Der physische Adressraum umfasst
**2²⁰ Worte × 16 Bit = 2 MB** (`rtl/deep16_pkg.sv:10` `MEM_WORDS = 1048576`,
`rtl/deep16_top.sv:32`).

> **Korrektur:** Die frühere Fassung behauptete, ein 20-Bit-Bus erschließe „den gesamten
> Speicher inkl. des 64-Mbit-PSRAMs". Das ist unmöglich: 2 MB sind **25 %** der 8 MB PSRAM.
> Der GCoP sieht 2 MB. Ob der Grafikbus auf 22 Bit (wortadressiert) erweitert wird, um mehr
> PSRAM nutzbar zu machen, ist eine **offene Entscheidung** (§10, E-2).

> **Klärung zur Dokumentation:** `doc/Deep16-Arch.md` §8.1 nennt
> `PA = (Segment << 16) | Offset`. Das widerspricht der Hardware: `rtl/deep16_core.sv:571`
> rechnet `pa_m = {seg_val, 4'h0} + offset`, also `seg << 4`. **§8.1 des Arch-Dokuments ist
> fehlerhaft und sollte korrigiert werden** – nicht dieses Dokument.

### 2.2 Segment-Adressierung (seg << 4)

Um Objektdaten kompakt zu halten, übergibt die Deep16-CPU dem GCoP für Grafikobjekte lediglich
eine 16-Bit-Segmentadresse (seg). Die Hardware berechnet die physikalische Adresse im RAM
über festverdrahtete Bit-Shifts:

    Adresse_20bit = (seg << 4) + Wort-Offset

**Ausrichtung:** Jedes Grafikobjekt muss auf einer durch **16 Worte** teilbaren Adresse liegen.
Ein Objekt umfasst zwingend mindestens 16 Worte (Kopfblock) – und seine **Größe muss ebenfalls
ein Vielfaches von 16 Worten sein**, sonst lässt sich das Folgobjekt nicht regelkonform
platzieren. Beides ist vom Linker/Assembler zu erzwingen.

### 2.3 Layout eines Grafik-Objekts (Buffer-Segments)

    +-------------------------------------------------------------+
    | Wort 0x00: X-Position (signed 16-Bit)                        |
    | Wort 0x01: Y-Position (signed 16-Bit)                        |
    | Wort 0x02: Breite (Pixel)                                    |
    | Wort 0x03: Höhe (Pixel)                                      |
    | Wort 0x04: Z-Position (8 Bit genutzt: 0 = hinten, 255 = vorn)|
    |         Bits 8–15 reserviert                                  |
    | Wort 0x05: Flags (Bit 0: Aktiv, Bit 1: Mode, Bit 2: Clip)   |
    | Wort 0x06: Palettenbasis (Wort-Offset im BSRAM)              |
    | Wort 0x07–0x0F: reserviert für System/Effekte               |
    +-------------------------------------------------------------+
    | Wort 0x10 – X: Zeilen-Daten (siehe §5, abhängig vom Modus)   |
    +-------------------------------------------------------------+
    | Danach: 4-Bit gepackte Pixeldaten (4 Pixel pro 16-Bit-Wort)  |
    +-------------------------------------------------------------+

### 2.4 Non-executable Video-RAM

**Festlegung:** Ein Speicherbereich von **64 K Worten** (128 KB) wird als Video-RAM
reserviert und **als nicht-ausführbar** gekennzeichnet. Er ist weder über den
Instruction-Fetch-Port lesbar noch als Sprungziel gültig.

**Größenwahl:** 640 × 360 bei 4 Bit/Pixel = 57.600 Worte. Ein 64-K-Wort-Bereich fasst damit
**genau einen Vollbild-Objektsatz** inklusive Kopfblöcken. Kleinere Schnitte passen ebenso.

**Warum das drei Probleme gleichzeitig löst:**

1. **Port-Aufteilung für die PSRAM (→ §9.2).** Weil der Fetch-Pfad Video-RAM nachweislich
   nie berührt, sind die Konsumenten disjunkt: Fetch + Daten nur auf Haupt-RAM, GCoP-Read
   und CPU-Write nur auf Video-RAM. Ohne diese Zusicherung müsste jederzeit mit einem Fetch
   in den Videobereich gerechnet werden und die Aufteilung wäre nicht beweisbar.
2. **Fehlerklasse Beseitigung.** In einer framebufferlosen Engine liest der GCoP Sprite-Daten
   aus demselben RAM, aus dem die CPU läuft – es gibt keine Framebuffer-Hardware, die beide
   trennt. Ein verirrter Zeiger oder Sprung in Sprite-Daten ist damit kein seltener Bug,
   sondern ein strukturell wahrscheinlicher: die CPU führt Bilddaten als Befehle aus. NX
   wandelt das in einen sauberen ILL-Trap (der Trap-Mechanismus existiert bereits).
3. **Abgrenzung gegen die PSRAM-Umsetzung (→ §9.1).** Die Auszeichnung macht die
   Adressaufteilung der PSRAM überprüfbar, statt sie per Konvention anzunehmen.

**Mechanismus:** base+limit in MMIO, ein Komparator im Fetch-Pfad – **kein** NX-Bit je
Segment. Begründung: die 16-Bit-Segmentregister ergeben bei `seg << 4` und 16-Bit-Offset
überlappende 128-KB-Fenster (§2.2), keine 64-KB-Partitionen; ein Segment-Bit wäre die
falsche Granularität. Der Video-Bereich wird stattdessen per Basis- und Endadresse beschrieben,
ein Zugriff im Fetch-Pfad fällt in den ILL-Trap.

**Regel: Video-RAM ist schreib-only für die CPU.** Die CPU schreibt Objekt- und Pixeldaten
ausschließlich im V-Blank (ISR, §7.2) und liest sie **nie** zurück, solange der GCoP liest.
Diese Regel ist tragend – fällt sie, konkurrieren CPU-Read und GCoP-Read wieder um denselben
Port und der Vorteil aus §9.2 entfällt. Kollisionsdetektion o. Ä. ist entsprechend auf Kopien
im Haupt-RAM umzuleiten.

**Landbar vor GFX – unabhängig.** Diese Funktion muss nicht auf die Grafik-Engine warten.
Der bestehende 80×25-Textpuffer bei `0xF1000` ist bereits reserviert, wird nach Konvention
nie ausgeführt und ist von der Testsuite abgedeckt. Ihn als erstes NX-Gebiet zu verwenden
prüft und testet den kompletten Pfad gegen einen bereits vertrauten Bereich – damit ist NX
vor GFX ausgereift und nicht neu.

---

## 3. Clock-Domänen-Spezifikation (Taktdomänen)

Vier PLLs, gespeist vom 27-MHz-Onboard-Quarz:

1. **`clk_cpu` (54 MHz)** – Deep16-Haupt-CPU, Kontrollfluss des GCoP in H-Blank.
2. **`clk_pixel` (74,25 MHz)** – HDMI-Timing (H-Sync, V-Sync, Active Video).
3. **`clk_hdmi_serial` (371,25 MHz)** – 5× Pixeltakt, DDR-Betrieb (OSER10) zur
   TMDS-Serialisierung direkt an die HDMI-Pins.
4. **`clk_psram` (162 MHz)** – PSRAM-IP-Controller, Bereitstellung der Pixeldaten.

**Noch zu spezifizieren (offen, §10 E-3):** Der GCoP wechselt in §4 zwischen `clk_cpu`
(H-Blank) und `clk_pixel` (Active Video). Das ist ein Moduswechsel über eine Domänengrenze
hinweg. Er ist machbar, verlangt aber ein sauberes Handshake-/Gray-Code-Protokoll für das
Line-OAM-Registerarray, das in beiden Domänen lebt. Das ist bisher **nirgends beschrieben**
und gehört in die Entwurfsphase.

---

## 4. Die Grafik-Spezial-CPU (GCoP)

Der GCoP ist ein dedizierter, mikroprogrammierter 20-Bit-Kern. Sein Kontrollfluss wird durch
ein fest in das FPGA-Block-RAM (BSRAM) eingebranntes Mikrocode-ROM gesteuert.

### 4.1 Phase A – Horizontal Blanking (H-Blank), 370 Pixelclocks = 4,98 µs

Während der HDMI-Strahl unsichtbar zur nächsten Zeile springt, arbeitet der GCoP im
Kontrollfluss-Modus auf CPU-/Speichertaktung:

1. **OAM-Scan** – sequentielles Durchlaufen der Liste aktiver Grafiksegmente im RAM.
2. **Kollisionsprüfung** – trifft die aktuelle Zeile Y das Objekt, d. h.
   `Y_pos <= Y < Y_pos + Höhe`?
3. **Line-OAM-Caching** – die gültigen Treffer werden in ein internes Registerarray im
   FPGA (Distributed RAM) kopiert. Mit dem Y-Bucket-Index (§4.4) sind es höchstens ~7;
   ein Array von 8 × 6 Registern genügt.
4. **Z-Sortierung** – die Treffer werden nach Z von hinten nach vorne priorisiert.
5. **Zeilen-Datenzeiger holen** – je Objekt der Zeilen-Datenzeiger für die aktuelle Y-Position.

### 4.2 Phase B – Active Video, 1280 Pixelclocks = 17,24 µs

Sobald die Zeile gezeichnet wird, schaltet der GCoP in den DMA-/Streaming-Modus synchron zur
Pixelclock:

1. Die GCoP fordert die 4-Bit-Pixeldaten der gecachten Objekte per Burst-Read aus dem PSRAM an.
2. Der Index wird über die Palette (§5) in eine 16-Bit-RGB565-Farbe übersetzt und in den
   aktiven Line-Buffer geschrieben. Alle 16 horizontalen Pixel wechselt die Engine zum
   nächsten Paletten-Zeiger (nur im Modus `PER_16PX`, §5).
3. **Alpha-Test (Colorkey):** Index `0x0` ist transparent und **schreibt nicht**. Höhere
   Z-Werte überschreiben niedrigere.

> **Korrektur:** Die frühere Fassung sprach hier von „Alpha-Blending". Implementiert ist ein
> reiner Alpha-*Test* (1-Bit-Transparenz) – es wird **nicht** gemischt. Begriff korrigiert.

> **Noch offen (E-4):** Der **Hintergrund** ist nicht definiert. Schreibt ein transparenter
> Pixel nicht, muss der Line-Buffer beim Zeilenbeginn mit einer Hintergrundfarbe vorbelegt
> werden (global oder ggf. als eigenes Objekt mit Z = 0). Ohne diese Festlegung ist der
> Zeilenanfang undefiniert.

### 4.3 Clipping

Objekte können negative oder jenseits von 640 liegende X-Positionen haben. Vor dem Rastern
ist auf das horizontale Sichtfenster zu clippen; insbesondere beginnt der 16-Pixel-Blocklauf
nicht zwangsläufig auf einer Blockgrenze. Ein Clipping-Pfad ist in der früheren Fassung
**vollständig gefehlt** und gehört in den Entwurf.

### 4.4 OAM-Scan-Budget

> **Korrigiert in `12eebb3` → hier richtiggestellt.** Die Erstfassung dieses Abschnitts
> rechnete mit 12,39 µs / 669 Zyklen und kam auf ~16 Objekte. Das beruhte auf dem
> H-Blank-Fehler aus §1.1. Die korrekten Zahlen sind deutlich schlechter.

Mit `H_blank = 4,98 µs` (§1.1):

| Größe | Wert |
|---|---|
| H-Blank-Dauer | 4,98 µs |
| Zyklen @ `clk_cpu` 54 MHz | **269** |
| Kosten pro Objekt (16-Wort-Kopf, PSRAM-Latenz + Burst) | ≈ 40 Zyklen |
| **Objekte pro Zeile @ 54 MHz** | **≈ 6 – 7** |
| Objekte pro Zeile @ 162 MHz (Scan auf PSRAM-Takt) | ≈ 20 |

**Das ist die kritischste Zahl im ganzen Dokument.** Ein Scan auf CPU-Takt erlaubt
**6 – 7 Objekte** – nicht die früher angenommenen 16. Selbst bei 162 MHz bleiben es nur ~20.

**Festlegung:** Ein Grob-Y-Bucket-Index (360 Einträge, Zeile → Objektliste) ist damit
**zwingende Voraussetzung der ersten Stufe**, nicht deren Nachfolger. Er ist die einzige
Variante, die eine sinnvolle Objektzahl mit 4,98 µs vereinbart. Alternative – Scan auf
PSRAM-Takt (162 MHz) und damit ~20 Objekte – ist eine schwache Ausrede und verdrängt den
Index vermutlich nur.

Zwei weitere Posten, die in dasselbe Budget gehören und bisher fehlen:

* **Z-Sortierer** – ein Bubble-Sort über *n* Treffer kostet ~n²/2 Vergleiche. Bei n = 7 sind
  das ~24 Vergleiche (~0,45 µs @ 54 MHz) und passen; bei n = 16 wären es ~120 (~2,2 µs) und
  würden das Budget halb auffressen. Sortiertiefe ist damit eine *Folge* der Objektzahl.
* **Sortierer und Scan sind seriell, nicht parallel.** Sie teilen sich dieselben 269 Zyklen.
  Frühere Fassungen gingen von Parallelität aus – das ist im Mikrocodedesign nicht
  vorgesehen und wäre ein zusätzlicher Grund, den Bucket-Index vorzuziehen.

**Nebenwirkung:** Der OAM-Scan liest nur Objektköpfe, keine Pixeldaten. Nur er konkurriert
mit dem GCoP-Streaming (§4.5); der Scan selbst liest ausschließlich Metadaten.

### 4.5 Memory-Arbitration (Neu, offen)

In Phase B liest der GCoP per Burst aus dem PSRAM, während die Deep16-Haupt-CPU weiterläuft.
Die Tang-Nano-9K-PSRAM ist **einzelportig**. Es ist daher zwingend festzulegen:

* Wer bekommt bei Kollision Vorrang – CPU oder GCoP?
* Wird der GCoP hart präemptiert (Pixelverlust) oder per Warteschlange verzögert?
* Was kostet das die CPU-Durchsatzrate?

Ohne diese Regel ist §6 nicht belastbar, weil jede Budgetrechnung eine CPU-Ruhigannahme
trägt. **Diese Frage ist vor dem RTL-Entwurf zu beantworten (E-1).**

---

## 5. Palette: Betriebsmodi (Neu gefasst)

Die frühere Fassung modellierte die „Palette pro 16 Pixel" als *den* Normalfall. Tatsächlich
ist die Palettenauflösung ein **Spektrum**, und der realistische Betrieb liegt nahe dem
billigen Ende:

| Modus | Auflösung | Zeilenzugriffe je Objekt (Breite W) | Zweck |
|---|---|---|---|
| `GLOBAL` | 1 Palette für alle Objekte | `1 + ⌈W/4⌉` | **Normalfall.** Einheitliche Farbwelt, Sprite-Retro-Look, geringste Last. |
| `PER_OBJ` | 1 Palette je Objekt | `2 + ⌈W/4⌉` | Teambaren pro Objekt, z. B. gegnerische Einheiten. |
| `PER_16PX` | Palette je 16-Pixel-Block | `2·⌈W/16⌉ + ⌈W/4⌉` | **Maximalfall.** Bewusst spezialisiert, wird voraussichtlich nie verwendet. |

Der Modus wird **pro Objekt** in Flags Bit 1 gewählt; `GLOBAL` ist der Default. Im
`GLOBAL`-Modus liegen die Paletten im **BSRAM** (16 Farben × 16 Bit = 32 Worte) und werden
nicht pro Zeile nachgeladen – sie kosten dann einmalig gar nichts.

**Kostenbewertung `PER_16PX`:** Bei W = 640 entfallen 1280 Byte Palette auf 320 Byte
Pixeldaten – die Palette ist **viermal so groß wie das Bild**. Das ist der Grund, warum dieser
Modus als Extremfall dokumentiert, aber nicht als Ziel geführt wird.

---

## 6. Ressourcen- & Machbarkeits-Check (Tang Nano 9K)

### 6.1 Logik und BSRAM

* **LUT4:** Der GCoP (Mikrocode-Decoder, Adress-Shifter, Alpha-Tester, Skalierer) wird mit
  ca. 1.200–1.500 LUTs angesetzt (~17 % der 8.640 LUTs).
  > **Zu prüfen:** Diese Schätzung stammt aus der Erstfassung und umfasst **weder** das
  > Line-OAM-Array **noch** den Z-Sortierer. Beide sind LUTRAM bzw. Logik und dürfen den
  > Aufpreis nicht ignorieren. Erneute Schätzung nach dem RTL-Entwurf nötig.
  > *Neu:* Mit der korrigierten Objektzahl (§4.4) ist das Line-OAM **kleiner als geplant** –
  > statt 16 Treffern je Zeile sind höchstens ~7 gleichzeitig möglich. Ein Array von
  > 8 × 6 Registern genügt, was die Schätzung eher verbessert als verschlechtert. Der
  > Z-Sortierer schrumpft analog (n²/2: 24 statt 120 Vergleiche).
* **BSRAM:**
  * Mikrocode-ROM: 1 Block.
  * Line-Buffer: 2 × 640 Wörter à 16 Bit RGB565 = 2 × 10.240 Bit. Ein 18-Kbit-BSRAM-Block
    fasst das **mehrfach**; die Angabe „2 Blöcke" ist also konservativ und unkritisch.
  * Paletten (Modus `GLOBAL`): 32 Worte pro Palette, mehrere Paletten in einem Block.
  * Verbleibende Blöcke für Stack, Cache, Bootloader.

### 6.2 Speicherbandbreite (korrigiert)

PSRAM liefert bei 162 MHz × 16 Bit = **324 MB/s**. Bedarf je Zeile (17,24 µs Active Video),
gerechnet mit 4 Bit/Pixel (4 Pixel pro Wort) und den Zeilenzugriffen aus §5:

| Szenario | `GLOBAL` | MB/s | `PER_16PX` | MB/s |
|---|---|---|---|---|
| 7 × 640 px – **neuer Worst-Case**, volle Überdeckung | 1.127 W | **131** (40 %) | 1.680 W | **195** (60 %) |
| 7 × 320 px | 567 W | 66 (20 %) | 840 W | 97 (30 %) |
| 7 × 160 px | 287 W | 33 (10 %) | 420 W | 49 (15 %) |
| 7 × 80 px – typisch | 147 W | 17 (5 %) | 210 W | 24 (8 %) |
| *(16 × 640 px – entfällt, ≥ 16 Objekte sind nicht erreichbar)* | ~~3.840 W~~ | ~~445 (137 %)~~ | | |

**Befund – geändert gegenüber der Erstfassung:** Der zuvor angeführte
**Bandbreiten-Engpass existiert nicht.** Er beruhte auf der Annahme von 16 gleichzeitigen
Objekten. Mit der korrigierten OAM-Zahl (§4.4) sind aber höchstens **~7** gleichzeitig in
Flight – der Überschreitungsfall ist nicht erreichbar.

Selbst der **absolute Worst-Case** (7 Objekte über die volle Bildbreite, vollständig
überlappend, im teuersten Modus `PER_16PX`) liegt mit **60 %** der verfügbaren Bandbreite
klar im Budget. Reale Szenarien liegen bei **5–20 %**.

> **Wie dieser Befund zu lesen ist:** Die Rechnung der Erstfassung war methodisch richtig,
> ihr Eingangswert (16 Objekte) war falsch. Unter der korrigierten Objektzahl ist die
> Bandbreite **kein limitierender Faktor** – weder im Normalfall noch im Extremfall. Das
> verschiebt das Risiko im gesamten Dokument auf den **OAM-Scan** (§4.4), der die eigentliche
> Engstelle bleibt.

> Der Wert von 60 % im neuen Worst-Case ist ohne CPU-Anteil gerechnet. Sobald die Deep16
> CPU parallel mitliest/schreibt (§4.5), ist das die harte Obergrenze, aus der die
> CPU-Politik abgeleitet werden muss.

### 6.3 Zusammenfassung der Machbarkeit

| Punkt | Bewertung |
|---|---|
| Grundkonzept (Beam-Racer, objektbasiert) | tragfähig |
| **Bandbreite – auch absoluter Worst-Case** | **unkritisch (60 % im Extremfall, 5–20 % real)** – kein limitierender Faktor |
| OAM-Scan @ CPU-Takt | **~6–7 Objekte – die kritische Engstelle**; Y-Bucket-Index zwingend (§4.4) |
| Logikbedarf | Schätzung zu niedrig, aber durch kleinere Objektzahl tendenziell besser (§6.1) |
| Non-executable Video-RAM | löst Port-Aufteilung + Fehlerklasse (§2.4), vor GFX landbar |
| **Voraussetzung PSRAM-Umbau** | **blockierend, siehe §9** |

---

## 7. CPU-Anbindung: Register und Interrupts (Neu)

Ohne diese Schnittstelle ist die Engine nicht steuerbar und nicht testbar. Die Deep16-CPU
belegt laut `doc/Deep16-Prog-Man.md` §7.1 bereits den Bereich `0xF0030–0xF003F`
(16 Wörter) für den Video Display Controller.

### 7.1 Registerentwurf

| Offset | Register | Zugriff | Bedeutung |
|---|---|---|---|
| `0xF0030` | `VDC_CTRL` | RW | Bit 0 Enable, Bit 1 Reset, Bit 2 Interlace (reserviert), Bit 3 DMA-Test |
| `0xF0031` | `VDC_STATUS` | RO | Bit 0 Busy-in-H-Blank, Bit 1 VBlank-Flag, Bit 2 OAM-Überlauf |
| `0xF0032` | `VDC_OAMLIST` | RW | Segmentadresse der Objektliste |
| `0xF0033` | `VDC_OBJCOUNT` | RW | Anzahl der Objekte (≤ 16, siehe §4.4) |
| `0xF0034` | `VDC_BGPAL` | RW | Basis der globalen Palette im BSRAM |
| `0xF0035` | `VDC_BGCOLOR` | RW | Hintergrundfarbe RGB565 (siehe E-4) |
| `0xF0036` | `VDC_SCALING` | RW | logische Breite/Höhe, Default 640×360 |
| `0xF0037` | `VDC_IRQEN` | RW | Interrupt-Maske |
| `0xF0038–0xF003F` | – | – | reserviert |

### 7.2 VBlank-Interrupt (Neu)

Deep16 verfügt mit den 12 Shadow-Registern über einen Interrupt-Eintritt von 2 Zyklen
(`doc/Deep16-Arch.md` §2.3). Das ist ideal für eine VBlank-ISR, die die Objektliste
mid-frame neu aufbaut – und ist der Grund, warum der Ansatz zum Core passt:

* `VDC_IRQEN` Bit 0: VBlank → ISR, Objektliste neu aufbauen, Palette ändern.
* `VDC_IRQEN` Bit 1: OAM-Überlauf (mehr als 16 Treffer) → Diagnose.
* Der Kontextwechsel ist hardwareverwaltet; die ISR kehrt mit einem einzigen
  Rücksprung in den Anwendungscode zurück.

Ohne VBlank-Interrupt gibt es keinen rissfreien Szenenwechsel – das war in der früheren
Fassung ungeregelt.

---

## 8. Textmodus 80×25 (Entscheidung offen)

**Festgelegt: Der Textmodus bleibt erhalten und wird nicht aufgegeben.**

Der bestehende 80×25-Modus ist real: `js/deep16_ui_screen.js:5` legt den Puffer auf `0xF1000`
fest, 2000 Wörter (80 × 25), Bit 15 = Reverse Video. Er funktioniert heute ohne Framebuffer,
weil die **UI** die Glyphen on demand in den Canvas zeichnet.

Die offene Frage ist, wie er auf einem FPGA-Ziel mit dem GCoP zusammenlebt. Kandidaten:

1. **Zeichenzelle als GCoP-Objekt** – jede Zelle verweist auf eine Glyphe im ROM, wird wie
   jedes andere Objekt gerastert. Unification, ein einziger Rasterpfad.
2. **Eigene Textebene im GCoP** – der Rasterer liest zusätzlich 80 × 5 Zeilenzeiger.
3. **Framebuffer für den Textmodus** – widerspricht dem Grundkonzept, nur als Notlösung.

**Diese Entscheidung ist bewusst vertagt.** Festgehalten ist nur: Der Puffer bei `0xF1000`
bleibt gültig, und die FPGA-Variante muss mit dem JS-Emulator formatgleich bleiben
(Kompatibilitätstest §10, E-5).

---

## 9. Voraussetzungen (Neu – blockierend)

### 9.1 PSRAM-Umbau der Haupt-CPU

**Der heutige Deep16-Kern lässt sich auf dem GW1NR-9K nicht bauen.** Das ist keine
Feinheit, sondern die vorrangige Voraussetzung für alles Weitere:

| Größe | Wert |
|---|---|
| `MEM_WORDS` (`rtl/deep16_pkg.sv:10`) | 1.048.576 Worte |
| Deklarierte On-Chip-Matrix (`rtl/deep16_top.sv:32`) | `reg [15:0] mem [0:1048575]` = **16,8 Mbit** |
| Verfügbares BSRAM (GW1NR-9K, 26 × 18 Kbit) | **≈ 468 Kbit** |
| **Überhang** | **≈ 35×** |

`VERILOG.md` begründet die On-Chip-Matrix mit „ein On-Chip-FPGA-Build braucht kein externes
Speichermodell". Für diesen Baustein gilt das nicht. **Erforderlich:** Verlagerung des
Hauptspeichers in die PSRAM mit echtem Memory-Controller, dual-portfähig für CPU und GCoP.

Diese Arbeit ist **größer als der GCoP selbst** und sollte als eigenes Projekt geführt
werden. GFX ist erst danach sinnvoll terminierbar.

### 9.2 Port-Aufteilung der PSRAM (durch §2.4 möglich gemacht)

Die On-Chip-Matrix versorgt heute **drei Read-Ports und einen Write-Port** aus einem einzigen
Array (`rtl/deep16_top.sv:92-102`): `if_rdata` (Fetch), `mem_rdata` (Daten), `vec_rdata`
(SWI-Vektor, Konstante `0x0002`) und der Store. Eine **einzelportige** PSRAM kann das nicht.

Mit dem non-executable Video-RAM (§2.4) zerfällt das in zwei Bänke mit **unterschiedlichen
Zugriffsmustern**:

| Bank | Konsumenten | Bedarf | Bemerkung |
|---|---|---|---|
| Haupt-RAM | CPU-Fetch, CPU-Daten | 2R + 1W | Durch den **unified Cache** (VERILOG.md Phase 3, noch nicht gebaut) auf Treffer abgedeckt; die PSRAM sieht nur Fehlzugriffe. |
| Video-RAM | GCoP (Read), CPU (Write) | 1R + 1W | **Zeitlich disjunkt:** CPU schreibt nur im V-Blank (666,7 µs, §1.1), der GCoP liest in H-Blank + Active Video. |

Der eigentliche Gewinn liegt in der letzten Zeile: Weil sich Schreib- und Lesezugriffe
**zeitlich nie überlappen**, genügt für den Video-Bank **ein einziger physischer Port ohne
Arbitration und ohne FIFO**. Genau das bedient eine einzelportige PSRAM von Haus aus.

**Was das nicht löst:** Der Haupt-Bank bleibt bei 2R + 1W und braucht den Cache – NX verkleinert
die **Video**-Last, nicht die Haupt-Last. Ebenso ist die Regel „Video-RAM ist schreib-only"
tragend; wird sie verletzt, konkurrieren CPU- und GCoP-Reads wieder um denselben Port
(§2.4).

### 9.3 Weitere Voraussetzungen

* Takt- und Reset-Strategie für den Betrieb ohne On-Board-Speicher-Array.
* Debug-Zugang (JTAG/UART über `0xF0040`) für Bildschirmausgaben während der Fehlersuche.
* **Reihenfolge im Fetch-Pfad:** Ein späterer unified Cache muss **hinter** der NX-Prüfung
  liegen. Andernfalls bleiben zwischengespeicherte Zeilen aus dem Videobereich ausführbar und
  die Prüfung wäre nachträglich nur schwer einzuziehen. Diese Reihenfolge ist jetzt zu fixieren,
  obwohl der Cache noch nicht existiert.

---

## 10. Offene Entscheidungen

| ID | Frage | Blockiert |
|---|---|---|
| **E-1** | Memory-Arbitration CPU ↔ GCoP: Vorrang, Preemption, CPU-Kosten (§4.5) | Bandbreiten-Budget, RTL |
| **E-2** | Grafikbus auf 22 Bit erweitern oder bei 2 MB bleiben (§2.1)? | Adresskonzept |
| **E-3** | Clock-Domain-Crossing-Protokoll für das Line-OAM (§3) | RTL |
| **E-4** | Hintergrundfarbe und Vorbelegung des Line-Buffers (§4.2) | Bildqualität |
| **E-5** | Textmodus-Strategie FPGA ↔ JS-Emulator (§8) | Kompatibilität, UI |
| **E-6** | ~~Max. Objektzahl fest 16 oder Y-Bucket-Index vorsehen?~~ → **entschieden: Y-Bucket-Index ist zwingend**, 4,98 µs erlauben nur 6–7 Objekte (§4.4) | Timing-Budget |
| **E-7** | Z-Sortierung: Bubble oder Auswahl-Sortierung; Sortierer und Scan teilen sich seriell dieselben 269 Zyklen (§4.4) | Timing-Budget |
| **E-8** | NX-Mechanismus: base+limit gegen NX-Bit je Segment (§2.2 zeigt: Segmente sind überlappende 128-KB-Fenster) | Fetch-Pfad |
| **E-9** | Video-Bank-Anbindung: ein Port ohne FIFO (nur bei strikt schreib-only-Regel) oder FIFO/Portdopplung für Ausnahmen (§2.4, §9.2) | PSRAM-Controller |
| **E-10** | Kollisionsdetektion und ähnliche Lesefälle: Kopie im Haupt-RAM statt Rücklesen aus Video-RAM (§2.4) | API-Form |

Nächster sinnvoller Schritt ist **nicht** die Ausarbeitung des Mikrocode-Worts. Es sind
diese drei, in dieser Reihenfolge:

1. **§2.4 / E-8** – NX für den Textpuffer bei `0xF1000`, unabhängig von GFX und vor dem
   PSRAM-Umbau machbar. Damit ist der Fetch-Pfad geprüft, bevor eine PSRAM-Plattform existiert.
2. **§9.1** – PSRAM-Umsetzung der Haupt-CPU. Ohne externen Hauptspeicher gibt es keine
   FPGA-Instanz, auf der eine Grafik-Engine laufen könnte.
3. **E-1** – Arbitration-Politik, sobald die Aufteilung aus §9.2 steht.